/**
 * Passive-component breadth (round 4). A catalogue pack ('passives-more', group Basic): the E96 values
 * a learner meets in the shop, and the capacitor dielectrics and packages that the E6 / 0805 tables of
 * passiveSeries.ts do not cover.
 *
 *   0603 thick-film resistor   E96, 10 Ω … 1 MΩ, ±1 %, 0.1 W
 *   1/4 W metal-film resistor  E96, 10 Ω … 1 MΩ, ±1 %, axial
 *   0402 thick-film resistor   E24, 10 Ω … 1 MΩ, ±5 %, 1/16 W
 *   MLCC C0G (NP0)             E12, 10 pF … 10 nF, ±5 %: 0603 (50 V) and 0805 (100 V)
 *   MLCC X7R                   E12, 100 pF … 1 µF (0603) and 100 pF … 10 µF (1206), ±10 %
 *
 * The parts are built by the same builders as passiveSeries.ts (power rating with the burn-out
 * option, standard-value picker, voltage rating), so they behave exactly like the older series.
 */
import type { LibraryPartDef } from '../../partkit';
import { ALL_PARTS } from '../../parts';
import { seriesValues } from '../../series';
import { PASSIVE_CATALOG } from '../passives';
import { CAP_SYMBOL, PASSIVE_SERIES_CATALOG, SMD_SYMBOL, RES_SYMBOL, filmPart, resistorPart, type FilmSeries, type ResSeries } from '../passiveSeries';

const RES_MORE: ResSeries[] = [
  { slug: 'r0603', family: 'Resistor', series: '0603 thick-film resistor E96', e: 'E96', min: 10, max: 1e6, tol: '1', power: '0.1', pkg: '0603', tag: '0603', footprint: 'R0603', kind: 'SMD thick-film resistor (0603)', kindVi: 'Điện trở dán màng dày (0603)', symbol: SMD_SYMBOL, keywords: ['smd', '0603', 'chip resistor', 'e96'] },
  { slug: 'rmf', family: 'Resistor', series: '1/4 W metal-film resistor E96', e: 'E96', min: 10, max: 1e6, tol: '1', power: '0.25', pkg: 'Axial 1/4 W', tag: '1/4 W 1%', footprint: 'RES-AXIAL-250', kind: '1/4 W metal-film resistor', kindVi: 'Điện trở màng kim loại 1/4 W', symbol: RES_SYMBOL, keywords: ['metal film', 'axial', '1/4w', '1%', 'e96'] },
  { slug: 'r0402', family: 'Resistor', series: '0402 thick-film resistor', e: 'E24', min: 10, max: 1e6, tol: '5', power: '0.0625', pkg: '0402', tag: '0402', footprint: 'R0402', kind: 'SMD thick-film resistor (0402)', kindVi: 'Điện trở dán màng dày (0402)', symbol: SMD_SYMBOL, keywords: ['smd', '0402', 'chip resistor'] },
];

const CAP_MORE: FilmSeries[] = [
  { slug: 'cap-0603-c0g', series: 'MLCC 0603 C0G', kind: 'multilayer ceramic capacitor (0603, C0G / NP0)', kindVi: 'Tụ gốm nhiều lớp dán (0603, C0G / NP0)', values: seriesValues('E12', 10e-12, 10e-9), vr: () => 50, tol: '5', pkg: '0603 C0G', footprint: 'CAP-0603', symbol: CAP_SYMBOL, keywords: ['mlcc', 'smd', '0603', 'c0g', 'np0', 'ceramic', 'chip capacitor', 'stable'] },
  { slug: 'cap-0805-c0g', series: 'MLCC 0805 C0G', kind: 'multilayer ceramic capacitor (0805, C0G / NP0)', kindVi: 'Tụ gốm nhiều lớp dán (0805, C0G / NP0)', values: seriesValues('E12', 10e-12, 10e-9), vr: () => 100, tol: '5', pkg: '0805 C0G', footprint: 'C0805', symbol: CAP_SYMBOL, keywords: ['mlcc', 'smd', '0805', 'c0g', 'np0', 'ceramic', 'chip capacitor', 'stable'] },
  { slug: 'cap-0603-x7r', series: 'MLCC 0603 X7R', kind: 'multilayer ceramic capacitor (0603, X7R)', kindVi: 'Tụ gốm nhiều lớp dán (0603, X7R)', values: seriesValues('E12', 100e-12, 1e-6), vr: (c) => (c <= 100.1e-9 ? 50 : 25), tol: '10', pkg: '0603 X7R', footprint: 'CAP-0603', symbol: CAP_SYMBOL, keywords: ['mlcc', 'smd', '0603', 'x7r', 'ceramic', 'chip capacitor', 'decoupling'] },
  { slug: 'cap-1206-x7r', series: 'MLCC 1206 X7R', kind: 'multilayer ceramic capacitor (1206, X7R)', kindVi: 'Tụ gốm nhiều lớp dán (1206, X7R)', values: seriesValues('E12', 100e-12, 10e-6), vr: (c) => (c <= 100.1e-9 ? 100 : c <= 1.01e-6 ? 50 : 25), tol: '10', pkg: '1206 X7R', footprint: 'C1206', symbol: CAP_SYMBOL, keywords: ['mlcc', 'smd', '1206', 'x7r', 'ceramic', 'chip capacitor', 'decoupling'] },
];

const known = new Set<string>([...ALL_PARTS, ...PASSIVE_CATALOG, ...PASSIVE_SERIES_CATALOG].map((p) => p.id));

/** Resistors: E96 / E24 values, in the E-series picker of the value. */
export const RESISTORS_MORE: LibraryPartDef[] = RES_MORE.flatMap((s) => seriesValues(s.e, s.min, s.max).map((v) => resistorPart(s, v)));
/** Capacitors: C0G and X7R chips. */
export const CAPACITORS_MORE: LibraryPartDef[] = CAP_MORE.flatMap((s) => s.values.map((v) => filmPart(s, v)));

const seen = new Set<string>();
export const PASSIVES_MORE_CATALOG: LibraryPartDef[] = [...RESISTORS_MORE, ...CAPACITORS_MORE].filter((p) => {
  if (known.has(p.id) || seen.has(p.id)) return false;
  seen.add(p.id);
  return true;
});
