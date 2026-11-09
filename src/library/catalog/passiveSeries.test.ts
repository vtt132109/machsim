/**
 * Catalogue depth of round 3: the value series are complete (E24 / E12 / E6 between their limits,
 * no duplicates of the older E-series parts), every part keeps its package data, and the ESR of
 * the electrolytic / tantalum parts follows tan δ / (2π·120 Hz·C) in a 120 Hz ripple measurement.
 */
import { describe, expect, it } from 'vitest';
import { getPart, listParts } from '..';
import { asLibraryPart } from '../partkit';
import { seriesValues } from '../series';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import { parseUserNumber } from '../../util/units';
import { PASSIVE_SERIES_CATALOG, esrFromTanDelta } from './passiveSeries';
import { loadAllGroups } from '..';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const bySeries = (series: string) => PASSIVE_SERIES_CATALOG.filter((p) => asLibraryPart(p).series === series);

describe('value series', () => {
  it('cover their E-series between the limits, with package data and unique names', () => {
    expect(bySeries('0805 thick-film resistor')).toHaveLength(seriesValues('E24', 1, 10e6).length);
    expect(bySeries('1206 thick-film resistor')).toHaveLength(seriesValues('E24', 1, 10e6).length);
    expect(bySeries('1 W metal-oxide resistor')).toHaveLength(seriesValues('E12', 1, 100e3).length);
    expect(bySeries('5 W cement resistor')).toHaveLength(seriesValues('E12', 0.1, 10e3).length);
    expect(bySeries('Current-sense shunt')).toHaveLength(13);
    expect(bySeries('Polyester film (MKT)')).toHaveLength(seriesValues('E6', 1e-9, 10e-6).length);
    expect(bySeries('MLCC 0805 X7R')).toHaveLength(seriesValues('E6', 100e-12, 10e-6).length);
    for (const p of PASSIVE_SERIES_CATALOG) {
      expect(asLibraryPart(p).specs?.package, p.id).toBeTruthy();
      expect(p.footprint, p.id).toBeTruthy();
    }
    // no value / voltage pair repeats one of the E6 electrolytics of passives.ts
    const names = listParts().filter((p) => p.group === 'basic' && p.family === 'Capacitor').map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(getPart('basic/ecap-1m-25v')?.name).toBe('1 mF, 25 V');
    expect(getPart('basic/ecap-10u-50v')).toBeUndefined();
    expect(getPart('basic/r0805-4.7k')?.params.find((d) => d.key === 'tolerance')?.default).toBe('1');
  });

  it('resistors follow Ohm’s law and carry their power rating', () => {
    const b = new DesignBuilder('ohm');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '1' });
    const r = b.part('basic/shunt-10m', 'R1', 200, 0);
    b.labelPin(v, '+', 'a');
    b.labelPin(v, '-', '0');
    b.labelPin(r, '1', 'a');
    b.labelPin(r, '2', '0');
    const build = buildNetlist(b.design, { includeAnalysis: false });
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(-op.scalars!['I(V1)']).toBeCloseTo(100, 6);
    expect(asLibraryPart(getPart('basic/r5w-1')!).specs?.power).toBe(5);
    expect(getPart('basic/r5w-1')!.params.find((d) => d.key === 'tau')?.default).toBe('1');
  });
});

describe('electrolytic ESR', () => {
  it('ESR = tan δ / (2π·120 Hz·C) and sets the 120 Hz ripple impedance', () => {
    expect(esrFromTanDelta(0.14, 1e-3)).toBeCloseTo(0.19, 9);
    const part = getPart('basic/ecap-1m-25v')!;
    const esr = parseUserNumber(part.params.find((d) => d.key === 'esr')!.default);
    expect(esr).toBeCloseTo(esrFromTanDelta(0.14, 1e-3), 9);
    const b = new DesignBuilder('ripple');
    const i = b.part('sources/ac-current', 'I1', 0, 0, { amplitude: '0', acmag: '1' });
    const c = b.part('basic/ecap-1m-25v', 'C1', 200, 0);
    const rd = b.part('basic/resistor', 'RD', 400, 0, { value: '1Meg' });
    b.labelPin(i, '+', 'a');
    b.labelPin(i, '-', '0');
    b.labelPin(c, '+', 'a');
    b.labelPin(c, '-', '0');
    b.labelPin(rd, '1', 'a');
    b.labelPin(rd, '2', '0');
    const build = buildNetlist(b.design, { includeAnalysis: false });
    const [ac] = runAnalyses({ ...build.netlist, analyses: [{ type: 'ac', sweep: 'list', points: 1, fstart: 120, fstop: 120, list: [120] }] });
    const z = ac.vectors.find((x) => x.name === 'V(a)')!;
    const xc = 1 / (2 * Math.PI * 120 * 1e-3);
    expect(Math.hypot(z.re[0], z.im![0])).toBeCloseTo(Math.hypot(esr, xc), 3);
    // the real part is the ESR: the loss the ripple current heats the capacitor with
    expect(z.re[0]).toBeCloseTo(esr, 3);
    // tantalum: reverse voltage limit 0.5 V
    expect(asLibraryPart(getPart('basic/tant-10u-16v')!).ratings?.voltages?.[1]).toEqual({ value: 0.5, pins: ['+', '-'], sign: -1 });
  });
});
