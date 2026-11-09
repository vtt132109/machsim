/**
 * Catalogue depth of round 3 (group Basic): standard values in the packages and series a learner
 * meets in kits and shops, next to the E24 axial resistors / E12 ceramics of passives.ts.
 *
 *   SMD thick-film resistor   E24, 1 Ω … 10 MΩ, ±1 %: 0805 (0.125 W) and 1206 (0.25 W)
 *   Metal-oxide resistor      E12, 1 Ω … 100 kΩ, ±5 %, 1 W axial
 *   Cement wirewound resistor E12, 0.1 Ω … 10 kΩ, ±5 %, 5 W
 *   Current-sense shunt       E6, 1 mΩ … 100 mΩ, ±1 %, 1 W (2512)
 *   Aluminium electrolytic    E6, 1 µF … 4.7 mF at 16 / 25 / 35 / 50 / 63 V
 *   Tantalum                  E6, 100 nF … 100 µF at 16 / 35 V
 *   Polyester film (MKT)      E6, 1 nF … 10 µF, 100 V, ±5 %
 *   Polypropylene film (MKP)  E6, 1 nF … 1 µF, 400 V, ±5 %
 *   MLCC 0805 X7R             E6, 100 pF … 10 µF (50 V up to 100 nF, 25 V up to 1 µF, 16 V above)
 *
 * Electrolytic and tantalum capacitors carry an ESR derived from the typical dissipation factor
 * tan δ at 120 Hz, ESR = tan δ / (2π·120 Hz·C) (tan δ: aluminium 0.16 / 0.14 / 0.12 / 0.10 / 0.09
 * from 16 to 63 V, tantalum 0.08) — the ripple-relevant value for a mains rectifier filter; it can
 * be edited (0 = ideal). These are typical figures of the generic series, not one maker's data.
 * Every part keeps its value editable (with the E-series picker) and the "burn out when
 * overloaded" option of the rated parts (power for resistors, voltage / reverse voltage for
 * capacitors).
 */
import { elC, elR, internalNode, numParam, optNum, type LibraryPartDef } from '../partkit';
import { capacitorBody, rect, resistorBody, text, twoPinH } from '../symbols';
import { seriesValues } from '../series';
import type { ESeriesName, ParamDef, ToSpiceContext } from '../types';
import type { ElementIR } from '../../sim/netlist';
import { burnParam, eng, tauParam, userNum, withMeta } from './kit';
import { RES_RATINGS, icParam, resistorParams, resistorSpice, valueCode } from './passives';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// resistors

const RES_SYMBOL = twoPinH(resistorBody());
const SMD_SYMBOL = twoPinH([rect(-20, -6, 40, 12), text(0, 3, 'SMD', 6)], {});
const POWER_SYMBOL = twoPinH([rect(-20, -7, 40, 14), ...resistorBody().map((p) => (p.kind === 'polyline' ? { ...p, points: p.points.map((v, i) => (i % 2 ? v * 0.6 : v * 0.8)) } : p))]);

interface ResSeries {
  slug: string;
  family: string;
  series: string;
  e: ESeriesName;
  min: number;
  max: number;
  tol: string;
  power: string;
  pkg: string;
  /** short tag after the value in the part name */
  tag: string;
  footprint: string;
  kind: string;
  kindVi: string;
  symbol: typeof RES_SYMBOL;
  keywords: string[];
}

const RES_SERIES: ResSeries[] = [
  { slug: 'r0805', family: 'Resistor', series: '0805 thick-film resistor', e: 'E24', min: 1, max: 10e6, tol: '1', power: '0.125', pkg: '0805', tag: '0805', footprint: 'R0805', kind: 'SMD thick-film resistor (0805)', kindVi: 'Điện trở dán màng dày (0805)', symbol: SMD_SYMBOL, keywords: ['smd', '0805', 'chip resistor'] },
  { slug: 'r1206', family: 'Resistor', series: '1206 thick-film resistor', e: 'E24', min: 1, max: 10e6, tol: '1', power: '0.25', pkg: '1206', tag: '1206', footprint: 'R1206', kind: 'SMD thick-film resistor (1206)', kindVi: 'Điện trở dán màng dày (1206)', symbol: SMD_SYMBOL, keywords: ['smd', '1206', 'chip resistor'] },
  { slug: 'rmo1w', family: 'Resistor', series: '1 W metal-oxide resistor', e: 'E12', min: 1, max: 100e3, tol: '5', power: '1', pkg: 'Axial 1 W', tag: '1 W', footprint: 'RES-AXIAL-400', kind: '1 W metal-oxide resistor', kindVi: 'Điện trở ô-xít kim loại 1 W', symbol: RES_SYMBOL, keywords: ['metal oxide', '1w', 'power resistor'] },
  { slug: 'r5w', family: 'Resistor', series: '5 W cement resistor', e: 'E12', min: 0.1, max: 10e3, tol: '5', power: '5', pkg: 'Cement 5 W', tag: '5 W', footprint: 'RES-CEMENT-5W', kind: '5 W cement wirewound resistor', kindVi: 'Điện trở sứ dây quấn 5 W', symbol: POWER_SYMBOL, keywords: ['cement', 'wirewound', '5w', 'power resistor'] },
  { slug: 'shunt', family: 'Resistor', series: 'Current-sense shunt', e: 'E6', min: 1e-3, max: 0.1, tol: '1', power: '1', pkg: '2512', tag: '2512 1 W', footprint: 'R2512', kind: 'current-sense shunt resistor (2512, 1 W)', kindVi: 'Điện trở sun đo dòng (2512, 1 W)', symbol: POWER_SYMBOL, keywords: ['shunt', 'current sense', 'low ohm', 'milliohm'] },
];

function resistorPart(s: ResSeries, v: number): LibraryPartDef {
  const watts = Number(s.power);
  return withMeta(
    {
      id: `basic/${s.slug}-${valueCode(v)}`,
      name: `${eng(v, 'Ω')} ${s.tag}`,
      group: 'basic',
      family: s.family,
      description: `${eng(v, 'Ω')} ±${s.tol} % ${s.kind} (${s.e} series), ${eng(watts, 'W')}`,
      prefix: 'R',
      symbol: s.symbol,
      params: resistorParams(v, false, s.power, s.tol).map((p): ParamDef => (p.key === 'value' ? { ...p, picker: s.e } : p)),
      toSpice: resistorSpice,
      ratings: RES_RATINGS,
      footprint: s.footprint,
      keywords: ['resistor', s.e.toLowerCase(), userNum(v).toLowerCase(), 'ohm', ...s.keywords],
    },
    { vi: `${s.kindVi} ${eng(v, 'Ω')} ±${s.tol} % (dãy ${s.e}), công suất ${eng(watts, 'W')}`, specs: { resistance: v, tolerance: Number(s.tol), power: watts, package: s.pkg }, sortKey: v, series: s.series },
  );
}

const resistors: LibraryPartDef[] = RES_SERIES.flatMap((s) => seriesValues(s.e, s.min, s.max).map((v) => resistorPart(s, v)));

// ---------------------------------------------------------------------------------------------
// capacitors

/** Capacitor with an optional ESR in series (polarised parts keep + on the left). */
function capEsrSpice(a: string, b: string) {
  return (ctx: ToSpiceContext): { elements: ElementIR[] } => {
    const ic = optNum(ctx, 'ic');
    const esr = optNum(ctx, 'esr') ?? 0;
    if (esr < 0) throw new Error('bad value for esr: must be >= 0');
    const c = pos(ctx, 'value');
    const ip: Record<string, number> = ic === undefined ? {} : { ic };
    if (esr === 0) return { elements: [elC(ctx.name('C'), ctx.node(a), ctx.node(b), c, ip)] };
    const m = internalNode(ctx, 'esr');
    return { elements: [elR(ctx.name('R', 'esr'), ctx.node(a), m, esr), elC(ctx.name('C'), m, ctx.node(b), c, ip)] };
  };
}

/** ESR from the dissipation factor at 120 Hz, rounded to 2 significant digits. */
export const esrFromTanDelta = (tanDelta: number, c: number): number => Number((tanDelta / (2 * Math.PI * 120 * c)).toPrecision(2));

const CAP_SYMBOL = twoPinH(capacitorBody());
const ECAP_SYMBOL = twoPinH(capacitorBody(true), { names: ['+', '-'] });
const FILM_SYMBOL = twoPinH([...capacitorBody(), rect(-9, -14, 18, 28)]);

const esrParam = (esr: number): ParamDef => numParam('esr', 'Equivalent series resistance (ESR)', userNum(esr), 'Ω', { group: 'advanced', min: 0, help: 'Series loss resistance (from tan δ at 120 Hz); it heats the capacitor with the ripple current; 0 = ideal' });

interface PolarSeries {
  slug: string;
  series: string;
  kind: string;
  kindVi: string;
  values: number[];
  voltages: number[];
  tanDelta: (vr: number) => number;
  tol: string;
  pkg: string;
  keywords: string[];
}

const ALU_TAN: Record<number, number> = { 16: 0.16, 25: 0.14, 35: 0.12, 50: 0.1, 63: 0.09 };

const POLAR_SERIES: PolarSeries[] = [
  { slug: 'ecap', series: 'Aluminium electrolytic', kind: 'aluminium electrolytic capacitor', kindVi: 'Tụ hoá nhôm', values: seriesValues('E6', 1e-6, 4.7e-3), voltages: [16, 25, 35, 50, 63], tanDelta: (vr) => ALU_TAN[vr], tol: '20', pkg: 'Radial', keywords: ['electrolytic', 'aluminium', 'radial'] },
  { slug: 'tant', series: 'Tantalum', kind: 'tantalum capacitor', kindVi: 'Tụ tantalum', values: seriesValues('E6', 100e-9, 100e-6), voltages: [16, 35], tanDelta: () => 0.08, tol: '10', pkg: 'Tantalum bead', keywords: ['tantalum', 'tant', 'bead'] },
];

function polarPart(s: PolarSeries, v: number, vr: number): LibraryPartDef {
  const esr = esrFromTanDelta(s.tanDelta(vr), v);
  return withMeta(
    {
      id: `basic/${s.slug}-${valueCode(v)}-${vr}v`,
      // "100 µF, 16 V": the comma keeps the older E6 electrolytic of the same value ("100 µF 25 V") first among equal search matches
      name: `${eng(v, 'F')}, ${vr} V${s.slug === 'tant' ? ' Ta' : ''}`,
      group: 'basic',
      family: 'Capacitor',
      description: `${eng(v, 'F')} ±${s.tol} % ${s.kind} (E6 series), ${vr} V, ESR ${eng(esr, 'Ω')} (tan δ at 120 Hz); + terminal on the left`,
      prefix: 'C',
      symbol: ECAP_SYMBOL,
      params: [
        numParam('value', 'Capacitance', userNum(v), 'F', { showOnSchematic: true, min: 0, picker: 'E6' }),
        icParam('V', 'Initial voltage'),
        esrParam(esr),
        numParam('tolerance', 'Tolerance', s.tol, '%', { group: 'advanced', min: 0 }),
        numParam('vrating', 'Voltage rating', String(vr), 'V', { group: 'advanced', min: 0 }),
        burnParam(false),
      ],
      toSpice: capEsrSpice('+', '-'),
      ratings: { enable: 'burn', voltages: [{ param: 'vrating', pins: ['+', '-'] }, { value: s.slug === 'tant' ? 0.5 : 1, pins: ['+', '-'], sign: -1 }] },
      footprint: 'CAP-RADIAL-250',
      keywords: ['capacitor', 'polarized', userNum(v).toLowerCase(), `${vr}v`, ...s.keywords],
    },
    { vi: `${s.kindVi} ${eng(v, 'F')} ±${s.tol} % (dãy E6), ${vr} V, ESR ${eng(esr, 'Ω')} (tan δ ở 120 Hz); cực + ở bên trái`, specs: { capacitance: v, tolerance: Number(s.tol), vrating: vr, package: s.pkg, polarity: 'polarized' }, sortKey: v + vr * 1e-9, series: s.series },
  );
}

/** Voltage of the E6 electrolytic of passives.ts with this value (those value / voltage pairs are not repeated). */
const baseEcapVoltage = (v: number): number => (v <= 10.1e-6 ? 50 : v <= 101e-6 ? 25 : v <= 1.01e-3 ? 16 : 10);

const polarCaps: LibraryPartDef[] = POLAR_SERIES.flatMap((s) => s.voltages.flatMap((vr) => s.values.filter((v) => s.slug !== 'ecap' || baseEcapVoltage(v) !== vr).map((v) => polarPart(s, v, vr))));

interface FilmSeries {
  slug: string;
  series: string;
  kind: string;
  kindVi: string;
  values: number[];
  vr: (c: number) => number;
  tol: string;
  pkg: string;
  footprint: string;
  symbol: typeof CAP_SYMBOL;
  keywords: string[];
}

const FILM_SERIES: FilmSeries[] = [
  { slug: 'film', series: 'Polyester film (MKT)', kind: 'polyester film (MKT) capacitor', kindVi: 'Tụ màng polyester (MKT)', values: seriesValues('E6', 1e-9, 10e-6), vr: () => 100, tol: '5', pkg: 'Box (MKT)', footprint: 'CAP-RADIAL-200', symbol: FILM_SYMBOL, keywords: ['film', 'polyester', 'mkt', 'mylar'] },
  { slug: 'mkp', series: 'Polypropylene film (MKP)', kind: 'polypropylene film (MKP) capacitor', kindVi: 'Tụ màng polypropylene (MKP)', values: seriesValues('E6', 1e-9, 1e-6), vr: () => 400, tol: '5', pkg: 'Box (MKP)', footprint: 'CAP-RADIAL-200', symbol: FILM_SYMBOL, keywords: ['film', 'polypropylene', 'mkp', 'low loss'] },
  { slug: 'cap-0805', series: 'MLCC 0805 X7R', kind: 'multilayer ceramic capacitor (0805, X7R)', kindVi: 'Tụ gốm nhiều lớp dán (0805, X7R)', values: seriesValues('E6', 100e-12, 10e-6), vr: (c) => (c <= 100.1e-9 ? 50 : c <= 1.01e-6 ? 25 : 16), tol: '10', pkg: '0805', footprint: 'C0805', symbol: CAP_SYMBOL, keywords: ['mlcc', 'smd', '0805', 'x7r', 'ceramic', 'chip capacitor'] },
];

function filmPart(s: FilmSeries, v: number): LibraryPartDef {
  const vr = s.vr(v);
  return withMeta(
    {
      id: `basic/${s.slug}-${valueCode(v)}`,
      name: `${eng(v, 'F')} ${s.pkg}`,
      group: 'basic',
      family: 'Capacitor',
      description: `${eng(v, 'F')} ±${s.tol} % ${s.kind} (E6 series), ${vr} V`,
      prefix: 'C',
      symbol: s.symbol,
      params: [
        numParam('value', 'Capacitance', userNum(v), 'F', { showOnSchematic: true, min: 0, picker: 'E6' }),
        icParam('V', 'Initial voltage'),
        numParam('tolerance', 'Tolerance', s.tol, '%', { group: 'advanced', min: 0 }),
        numParam('vrating', 'Voltage rating', String(vr), 'V', { group: 'advanced', min: 0 }),
        burnParam(false),
      ],
      toSpice: (ctx) => {
        const ic = optNum(ctx, 'ic');
        return { elements: [elC(ctx.name('C'), ctx.node('1'), ctx.node('2'), pos(ctx, 'value'), ic === undefined ? {} : { ic })] };
      },
      ratings: { enable: 'burn', voltages: [{ param: 'vrating', pins: ['1', '2'] }] },
      footprint: s.footprint,
      keywords: ['capacitor', userNum(v).toLowerCase(), ...s.keywords],
    },
    { vi: `${s.kindVi} ${eng(v, 'F')} ±${s.tol} % (dãy E6), ${vr} V`, specs: { capacitance: v, tolerance: Number(s.tol), vrating: vr, package: s.pkg }, sortKey: v, series: s.series },
  );
}

const filmCaps: LibraryPartDef[] = FILM_SERIES.flatMap((s) => s.values.map((v) => filmPart(s, v)));

/** Thermal time constant of the power resistors (bigger bodies heat up more slowly). */
const slowTau = (p: LibraryPartDef): LibraryPartDef => (Number(p.specs?.power) >= 5 ? { ...p, params: p.params.map((d) => (d.key === 'tau' ? tauParam('1') : d)) } : p);

export const PASSIVE_SERIES_CATALOG: LibraryPartDef[] = [...resistors.map(slowTau), ...polarCaps, ...filmCaps];

/** Round 4 (library breadth): the part builders and symbols, for the extra series (more/passivesMore.ts). */
export { resistorPart, filmPart, SMD_SYMBOL, RES_SYMBOL, CAP_SYMBOL, FILM_SYMBOL };
export type { ResSeries, FilmSeries };
