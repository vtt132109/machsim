/**
 * `.meas` on OP, TF and noise results (round 4 step 3), against closed-form references:
 *   divider 1 kΩ / 3 kΩ from 10 V:  V(out) = 7.5 V,  TF gain 0.75,  rin 4 kΩ,  rout 750 Ω
 *   two 1 kΩ in parallel to ground: output noise density sqrt(4 k T · 500 Ω),  PSD flat, so the
 *   integral over a band is S · Δf
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../index';
import { parseSpice } from '../spice/parser';
import { formatMeasCard, parseMeasCard } from '../spice/measure';

const DIVIDER = `divider
V1 in 0 DC 10
R1 in out 1k
R2 out 0 3k
`;

function run(deck: string) {
  const parsed = parseSpice(deck);
  expect(parsed.errors).toEqual([]);
  return runAnalyses(parsed.netlist);
}

describe('.meas op', () => {
  it('reads a node voltage, a branch current and a PARAM expression of the operating point', () => {
    const [r] = run(`${DIVIDER}.op
.meas op vo FIND V(out)
.meas op ratio PARAM vo/10
.meas op idc FIND I(R2)
.meas op vd FIND V(in,out)
.end`);
    expect(r.error).toBeUndefined();
    const m = Object.fromEntries((r.measurements ?? []).map((x) => [x.name, x]));
    expect(m.vo.error).toBeUndefined();
    expect(m.vo.value).toBeCloseTo(7.5, 9);
    expect(m.ratio.value).toBeCloseTo(0.75, 9);
    expect(m.idc.value).toBeCloseTo(2.5e-3, 9);
    expect(m.vd.value).toBeCloseTo(2.5, 9);
    expect(m.vo.analysis).toBe('op');
  });

  it('reports a node that does not exist instead of a number', () => {
    const [r] = run(`${DIVIDER}.op
.meas op bad FIND V(nowhere)
.end`);
    const bad = r.measurements!.find((x) => x.name === 'bad')!;
    expect(Number.isNaN(bad.value)).toBe(true);
    expect(bad.error).toContain('nowhere');
  });

  it('is evaluated for every step of a sweep', () => {
    const parsed = parseSpice(`${DIVIDER}.param Rb=3k
.step param Rb list 1k 3k 9k
.op
.meas op vo FIND V(out)
.end`.replace('R2 out 0 3k', 'R2 out 0 {Rb}'));
    expect(parsed.errors).toEqual([]);
    const [r] = runAnalyses(parsed.netlist);
    const got = r.runs!.map((x) => x.result.measurements!.find((y) => y.name === 'vo')!.value);
    expect(got[0]).toBeCloseTo(5, 6);
    expect(got[1]).toBeCloseTo(7.5, 6);
    expect(got[2]).toBeCloseTo(9, 6);
  });

  it('refuses a measurement that needs an x axis', () => {
    const p = parseSpice(`${DIVIDER}.meas op x MAX V(out)\n.end`);
    expect(p.errors[0].message).toContain('one point');
  });
});

describe('.meas tf', () => {
  it('reads the gain and the resistances of a transfer-function analysis', () => {
    const [r] = run(`${DIVIDER}.tf V(out) V1
.meas tf g FIND gain
.meas tf zin FIND rin
.meas tf zout FIND rout
.meas tf db PARAM 20*log10(g)
.end`);
    expect(r.type).toBe('tf');
    const m = Object.fromEntries(r.measurements!.map((x) => [x.name, x]));
    expect(m.g.value).toBeCloseTo(0.75, 9);
    expect(m.zin.value).toBeCloseTo(4000, 6);
    expect(m.zout.value).toBeCloseTo(750, 6);
    expect(m.db.value).toBeCloseTo(20 * Math.log10(0.75), 9);
  });

  it('PARAM sees the scalars of the result by name', () => {
    const [r] = run(`${DIVIDER}.tf V(out) V1
.meas tf load PARAM rout*2
.end`);
    expect(r.measurements![0].value).toBeCloseTo(1500, 6);
  });
});

describe('.meas noise', () => {
  const NOISE = `noise
V1 in 0 DC 0
R1 in out 1k
R2 out 0 1k
.noise V(out) V1 dec 20 10 100k
`;
  const kT4 = 4 * 1.380649e-23 * 300.15;

  it('finds the output noise density at a frequency and integrates the band', () => {
    const [r] = run(`${NOISE}.meas noise vn FIND onoise_spectrum AT=1k
.meas noise psd FIND onoise_psd AT=1k
.meas noise tot INTEG onoise_psd FROM=10 TO=100k
.meas noise vtot PARAM sqrt(tot)
.end`);
    expect(r.type).toBe('noise');
    expect(r.error).toBeUndefined();
    const m = Object.fromEntries(r.measurements!.map((x) => [x.name, x]));
    const density = kT4 * 500;
    expect(m.psd.value / density).toBeCloseTo(1, 2);
    expect(m.vn.value / Math.sqrt(density)).toBeCloseTo(1, 2);
    expect(m.tot.value / (density * (1e5 - 10))).toBeCloseTo(1, 2);
    expect(m.vtot.value / Math.sqrt(density * (1e5 - 10))).toBeCloseTo(1, 2);
  });

  it('can name the engine scalars (total noise) and search for a frequency', () => {
    const [r] = run(`${NOISE}.meas noise total PARAM onoise_total
.meas noise lo MIN onoise_spectrum
.end`);
    const m = Object.fromEntries(r.measurements!.map((x) => [x.name, x]));
    expect(m.total.value / Math.sqrt(kT4 * 500 * (1e5 - 10))).toBeCloseTo(1, 2);
    expect(m.lo.value / Math.sqrt(kT4 * 500)).toBeCloseTo(1, 2);
  });
});

describe('card text', () => {
  it('round-trips an OP card and a NOISE card', () => {
    const num = (v: number) => String(v);
    const op = parseMeasCard('.meas op vo FIND V(out)', Number);
    expect(op).toMatchObject({ analysis: 'op', kind: 'find', expr: 'V(out)' });
    expect(formatMeasCard(op, num)).toBe('.meas OP vo FIND V(out)');
    const again = parseMeasCard(formatMeasCard(op, num), Number);
    expect(again).toEqual(op);
    const noise = parseMeasCard('.meas noise tot INTEG onoise_psd FROM=10 TO=1000', Number);
    expect(noise.analysis).toBe('noise');
    expect(parseMeasCard(formatMeasCard(noise, num), Number)).toEqual(noise);
  });
});

describe('.meas in the SPICE text of a schematic', () => {
  it('measures the operating point and the transfer function of the drawn circuit', () => {
    const b = new DesignBuilder('divider');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
    const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '3k' });
    const g = b.part('sources/ground', 'G1', 200, 200);
    b.labelPin(v, '+', 'IN');
    b.labelPin(r1, '1', 'IN');
    b.labelPin(r1, '2', 'OUT');
    b.labelPin(r2, '1', 'OUT');
    b.labelPin(r2, '2', 'GND0');
    b.labelPin(v, '-', 'GND0');
    b.labelPin(g, '1', 'GND0');
    b.design.customSpice = ['.meas op vo FIND V(OUT)', '.meas tf gain1 FIND gain'].join('\n');
    const build = buildNetlist(b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const [op, tf] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }, { type: 'tf', output: 'V(OUT)', src: 'V1' }] });
    expect(op.measurements!.find((m) => m.name === 'vo')!.value).toBeCloseTo(7.5, 6);
    expect(tf.measurements!.find((m) => m.name === 'gain1')!.value).toBeCloseTo(0.75, 6);
  });
});
