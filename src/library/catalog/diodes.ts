/**
 * Diode catalogue (group Diodes): Zener series, rectifiers (standard, fast, ultrafast, SMD),
 * Schottky rectifiers and small-signal Schottky diodes, small-signal switching diodes, LEDs by
 * colour and package, TVS suppressors, bridge rectifiers, varactors and PIN diodes.
 *
 * Models (MachSim fits to datasheet figures, not vendor model files):
 *   Zener      the three-element model of src/library/parts/diodes.ts (forward junction,
 *              breakdown junction, ZZT) placed so V(K,A) = VZ at IZT. VZ / IZT / ZZT from each
 *              series' datasheet table; for the 5 W series IZT ≈ 1.25 W / VZ and ZZT is a smooth
 *              approximation. Junction capacitance ≈ 730 pF·P / √VZ (approximate).
 *   rectifier  IS from VF at IO with N = 1.8 (standard) / 1.6 (fast), RS = 40 mΩ·1 A / IO,
 *              TT = 4 µs (standard) or ≈ trr / 1.5, BV = VRRM.
 *   Schottky   IS from VF at the stated current with N ≈ 1.1 (power) / 1.05 (signal).
 *   LED        ledModel(): VF at the rated current; package sets the current (20 mA, 350 mA
 *              for 1 W emitters).
 *   TVS        breakdown at VBR (P6KE / 1.5KE: the part number; SMBJ / SMAJ: VBR ≈ 1.11·VWM +
 *              0.9 V) and a dynamic resistance that reaches the clamping voltage VC at the peak
 *              pulse current IPP = PPK / VC (VC ≈ 1.4·VBR + 0.9 V, resp. 1.6·VWM + 1.2 V).
 *              Bidirectional (CA) parts are two opposed junctions.
 *   varactor   CJO from the capacitance at 4 V (MV21xx) or the stated bias with M = 0.5.
 *   PIN        long carrier lifetime (TT ≈ 1 µs), sub-pF junction capacitance.
 */
import { ledBinding, ledFragment, ledIndicatorParams, ledModel, ledSymbol, zenerFragment, bridgeSymbol } from '../parts/diodes';
import { thermalVoltage } from '../../sim/device';
import { card, elD, elX, internalNode, modelOverride, subckt, type LibraryPartDef } from '../partkit';
import { diodeBody, line, poly, twoPinH } from '../symbols';
import type { ModelCard } from '../../sim/netlist';
import type { SymbolDef, ToSpiceContext } from '../types';
import { eng, modelName, modelOverrideParam, slug, withMeta } from './kit';

const VT = thermalVoltage(300.15);
const D_ID = (pn: string) => `diodes/${slug(pn)}`;

const symbolCache = new Map<string, SymbolDef>();
function dsym(kind: Parameters<typeof diodeBody>[0]): SymbolDef {
  let s = symbolCache.get(kind ?? 'plain');
  if (!s) {
    s = twoPinH(diodeBody(kind), { names: ['A', 'K'] });
    symbolCache.set(kind ?? 'plain', s);
  }
  return s;
}

/** Two-terminal diode with one fixed model card (model override allowed). */
function diodePart(o: { pn: string; family: string; model: ModelCard; kind?: Parameters<typeof diodeBody>[0]; en: string; vi: string; provenance: string; footprint: string; keywords: string[]; specs: Record<string, number | string>; sortKey?: number; series: string }): LibraryPartDef {
  return withMeta(
    {
      id: D_ID(o.pn),
      name: o.pn,
      group: 'diodes',
      family: o.family,
      description: o.en,
      prefix: 'D',
      symbol: dsym(o.kind),
      params: [modelOverrideParam()],
      toSpice: (ctx) => {
        const m = modelOverride(ctx, o.model.name);
        return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), m)], models: m === o.model.name ? [o.model] : [] };
      },
      provenance: o.provenance,
      footprint: o.footprint,
      keywords: [o.pn.toLowerCase(), ...o.keywords],
    },
    { vi: o.vi, specs: o.specs, sortKey: o.sortKey, series: o.series },
  );
}

/** Saturation current putting VF at current I (with series resistance RS and emission N). */
function isFor(vf: number, i: number, n: number, rs: number): number {
  return i / Math.exp((vf - i * rs) / (n * VT));
}

// ---------------------------------------------------------------------------------------------
// Zener diodes

interface ZRow {
  pn: string;
  vz: number;
  izt: number;
  zzt: number;
}

const V_1N47 = [3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1, 10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91, 100];
const IZT_1N47 = [76, 69, 64, 58, 53, 49, 45, 41, 37, 34, 31, 28, 25, 23, 21, 19, 17, 15.5, 14, 12.5, 11.5, 10.5, 9.5, 8.5, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.7, 3.3, 3, 2.8, 2.5];
const ZZT_1N47 = [10, 10, 9, 9, 8, 7, 5, 2, 3.5, 4, 4.5, 5, 7, 8, 9, 10, 14, 16, 20, 22, 23, 25, 35, 40, 45, 50, 60, 70, 80, 95, 110, 125, 150, 175, 200, 250, 350];
const V_1N52 = [2.4, 2.5, 2.7, 2.8, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.0, 6.2, 6.8, 7.5, 8.2, 8.7, 9.1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 27, 28, 30, 33, 36, 39, 43, 47, 51, 56, 60, 62, 68, 75];
const IZT_1N52 = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 9.5, 9.0, 8.5, 7.8, 7.4, 7.0, 6.6, 6.2, 5.6, 5.2, 5.0, 4.6, 4.5, 4.2, 3.8, 3.4, 3.2, 3.0, 2.7, 2.5, 2.2, 2.1, 2.0, 1.8, 1.7];
const ZZT_1N52 = [30, 30, 30, 30, 29, 28, 24, 23, 22, 19, 17, 11, 7, 7, 5, 6, 8, 8, 10, 17, 22, 30, 13, 15, 16, 17, 19, 21, 23, 25, 29, 33, 35, 41, 44, 49, 58, 70, 80, 93, 105, 125, 150, 170, 185, 230, 270];
const V_BZX = [2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1, 10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75];
const ZZT_BZX = [100, 100, 95, 95, 90, 90, 90, 80, 60, 40, 10, 15, 15, 15, 15, 20, 20, 25, 30, 30, 40, 45, 55, 55, 70, 80, 80, 80, 90, 130, 150, 170, 180, 200, 215, 240, 255];
const V_1N53 = [3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.0, 6.2, 6.8, 7.5, 8.2, 8.7, 9.1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 25, 27, 28, 30, 33, 36, 39, 43, 47, 51, 56, 60, 62, 68, 75, 82, 87, 91, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
const V_1N74 = [3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1, 10, 12];
const ZZT_1N74 = [28, 24, 23, 22, 19, 17, 11, 7, 5, 6, 8, 10, 17, 30];

const bzxCode = (v: number): string => (v < 10 ? v.toFixed(1).replace('.', 'V') : String(v));

const ZENER_SERIES: { series: string; power: number; footprint: string; rows: ZRow[]; table: string }[] = [
  { series: '1N47xxA', power: 1, footprint: 'DO-41', table: '1N4728A–1N4764A', rows: V_1N47.map((vz, i) => ({ pn: `1N${4728 + i}A`, vz, izt: IZT_1N47[i] * 1e-3, zzt: ZZT_1N47[i] })) },
  { series: '1N52xxB', power: 0.5, footprint: 'DO-35', table: '1N5221B–1N5267B', rows: V_1N52.map((vz, i) => ({ pn: `1N${5221 + i}B`, vz, izt: IZT_1N52[i] * 1e-3, zzt: ZZT_1N52[i] })) },
  { series: 'BZX79C', power: 0.5, footprint: 'DO-35', table: 'BZX79C2V4–BZX79C75', rows: V_BZX.map((vz, i) => ({ pn: `BZX79C${bzxCode(vz)}`, vz, izt: vz <= 24 ? 5e-3 : 2e-3, zzt: ZZT_BZX[i] })) },
  { series: 'BZX55C', power: 0.5, footprint: 'DO-35', table: 'BZX55C2V4–BZX55C75', rows: V_BZX.map((vz, i) => ({ pn: `BZX55C${bzxCode(vz)}`, vz, izt: vz <= 24 ? 5e-3 : 2.5e-3, zzt: ZZT_BZX[i] })) },
  { series: 'BZX84C', power: 0.3, footprint: 'SOT-23', table: 'BZX84C2V4–BZX84C75', rows: V_BZX.map((vz, i) => ({ pn: `BZX84C${bzxCode(vz)}`, vz, izt: vz <= 24 ? 5e-3 : 2e-3, zzt: ZZT_BZX[i] })) },
  {
    series: '1N53xxB',
    power: 5,
    footprint: 'DO-201AE',
    table: '1N5333B–1N5388B',
    rows: V_1N53.map((vz, i) => ({ pn: `1N${5333 + i}B`, vz, izt: Number((1.25 / vz).toPrecision(2)), zzt: Number((0.5 + 0.0006 * vz * vz).toPrecision(2)) })),
  },
  { series: '1N746A', power: 0.5, footprint: 'DO-35', table: '1N746A–1N759A', rows: V_1N74.map((vz, i) => ({ pn: `1N${746 + i}A`, vz, izt: 20e-3, zzt: ZZT_1N74[i] })) },
];

const ZENER_SYMBOL = dsym('zener');

const zeners: LibraryPartDef[] = ZENER_SERIES.flatMap((s) =>
  s.rows.map((r) => {
    const z = { vz: r.vz, izt: r.izt, zzt: r.zzt, cjo: Number(((730e-12 * s.power) / Math.sqrt(r.vz)).toPrecision(2)) };
    return withMeta(
      {
        id: D_ID(r.pn),
        name: r.pn,
        group: 'diodes',
        family: 'Zener diode',
        description: `${r.vz} V ${s.power} W Zener diode (IZT = ${eng(r.izt, 'A')}, ZZT = ${r.zzt} Ω)`,
        prefix: 'D',
        symbol: ZENER_SYMBOL,
        params: [],
        toSpice: (ctx: ToSpiceContext) => zenerFragment(ctx, r.pn.replace(/[^A-Za-z0-9]/g, '_'), z),
        provenance: `MachSim three-element Zener fit to the ${s.table} datasheet table: VZ = ${r.vz} V and ZZT = ${r.zzt} Ω at IZT = ${eng(r.izt, 'A')}${s.series === '1N53xxB' ? ' (IZT and ZZT approximated for the series)' : ''}; capacitance approximate`,
        footprint: s.footprint,
        keywords: [r.pn.toLowerCase(), 'zener', `${r.vz}v`, s.series.toLowerCase()],
      },
      { vi: `Diode Zener ${r.vz} V ${s.power} W (IZT = ${eng(r.izt, 'A')}, ZZT = ${r.zzt} Ω)`, specs: { vz: r.vz, power: s.power, package: s.footprint }, sortKey: r.vz + s.power / 100, series: s.series },
    );
  }),
);

// ---------------------------------------------------------------------------------------------
// rectifiers

type RecRow = [pn: string, vrrm: number];
interface RecSeries {
  series: string;
  io: number;
  vf: number;
  /** reverse recovery time, s (0 = standard recovery) */
  trr: number | ((vrrm: number) => number);
  vfHigh?: number;
  cj: number;
  footprint: string;
  rows: RecRow[];
}

const letters = (prefix: string, suffix: string, map: [string, number][]): RecRow[] => map.map(([l, v]) => [`${prefix}${l}${suffix}`, v]);
const SMD_LETTERS: [string, number][] = [['A', 50], ['B', 100], ['D', 200], ['G', 400], ['J', 600], ['K', 800], ['M', 1000]];
const V7 = [50, 100, 200, 400, 600, 800, 1000];
const numbered = (prefix: string, first: number, volts: number[], pad = 0): RecRow[] => volts.map((v, i) => [`${prefix}${String(first + i).padStart(pad, '0')}`, v]);

const REC_SERIES: RecSeries[] = [
  { series: '1N539x', io: 1.5, vf: 1.0, trr: 0, cj: 25e-12, footprint: 'DO-15', rows: numbered('1N', 5391, [50, 100, 200, 300, 400, 500, 600, 800, 1000]) },
  { series: '1N540x', io: 3, vf: 0.95, trr: 0, cj: 40e-12, footprint: 'DO-201AD', rows: numbered('1N', 5400, [50, 100, 200, 300, 400, 500, 600, 800, 1000]) },
  { series: 'RL20x', io: 2, vf: 0.95, trr: 0, cj: 20e-12, footprint: 'DO-15', rows: numbered('RL20', 1, V7) },
  { series: '6A', io: 6, vf: 0.9, trr: 0, cj: 150e-12, footprint: 'R-6', rows: [['6A05', 50], ['6A1', 100], ['6A2', 200], ['6A4', 400], ['6A6', 600], ['6A8', 800], ['6A10', 1000]] },
  { series: '10A', io: 10, vf: 0.95, trr: 0, cj: 200e-12, footprint: 'R-6', rows: [['10A05', 50], ['10A1', 100], ['10A2', 200], ['10A4', 400], ['10A6', 600], ['10A8', 800], ['10A10', 1000]] },
  { series: '1N493x', io: 1, vf: 1.0, trr: 200e-9, cj: 15e-12, footprint: 'DO-41', rows: numbered('1N', 4933, [50, 100, 200, 400, 600]) },
  { series: 'FR10x', io: 1, vf: 1.1, trr: (v) => (v <= 400 ? 150e-9 : v <= 600 ? 250e-9 : 500e-9), cj: 15e-12, footprint: 'DO-41', rows: numbered('FR10', 1, V7) },
  { series: 'FR15x', io: 1.5, vf: 1.1, trr: (v) => (v <= 400 ? 150e-9 : v <= 600 ? 250e-9 : 500e-9), cj: 20e-12, footprint: 'DO-15', rows: numbered('FR15', 1, V7) },
  { series: 'FR20x', io: 2, vf: 1.1, trr: (v) => (v <= 400 ? 150e-9 : v <= 600 ? 250e-9 : 500e-9), cj: 25e-12, footprint: 'DO-15', rows: numbered('FR20', 1, V7) },
  { series: 'FR30x', io: 3, vf: 1.1, trr: (v) => (v <= 400 ? 150e-9 : v <= 600 ? 250e-9 : 500e-9), cj: 40e-12, footprint: 'DO-201AD', rows: numbered('FR30', 1, V7) },
  { series: 'FR60x', io: 6, vf: 1.1, trr: (v) => (v <= 400 ? 150e-9 : v <= 600 ? 250e-9 : 500e-9), cj: 80e-12, footprint: 'R-6', rows: numbered('FR60', 1, V7) },
  { series: 'UF400x', io: 1, vf: 0.9, vfHigh: 1.4, trr: (v) => (v <= 400 ? 50e-9 : 75e-9), cj: 17e-12, footprint: 'DO-41', rows: numbered('UF400', 1, V7) },
  { series: 'UF540x', io: 3, vf: 0.9, vfHigh: 1.4, trr: (v) => (v <= 400 ? 50e-9 : 75e-9), cj: 40e-12, footprint: 'DO-201AD', rows: numbered('UF540', 0, [50, 100, 200, 300, 400, 500, 600, 800, 1000]) },
  { series: 'HER10x', io: 1, vf: 0.9, vfHigh: 1.4, trr: (v) => (v <= 400 ? 50e-9 : 75e-9), cj: 15e-12, footprint: 'DO-41', rows: numbered('HER10', 1, [50, 100, 200, 300, 400, 600, 800, 1000]) },
  { series: 'HER20x', io: 2, vf: 0.9, vfHigh: 1.4, trr: (v) => (v <= 400 ? 50e-9 : 75e-9), cj: 25e-12, footprint: 'DO-15', rows: numbered('HER20', 1, [50, 100, 200, 300, 400, 600, 800, 1000]) },
  { series: 'HER30x', io: 3, vf: 0.9, vfHigh: 1.4, trr: (v) => (v <= 400 ? 50e-9 : 75e-9), cj: 40e-12, footprint: 'DO-201AD', rows: numbered('HER30', 1, [50, 100, 200, 300, 400, 600, 800, 1000]) },
  {
    series: 'MUR1xx',
    io: 1,
    vf: 0.8,
    vfHigh: 1.1,
    trr: (v) => (v <= 200 ? 25e-9 : 50e-9),
    cj: 15e-12,
    footprint: 'DO-41',
    rows: [['MUR105', 50], ['MUR110', 100], ['MUR115', 150], ['MUR120', 200], ['MUR130', 300], ['MUR140', 400], ['MUR160', 600]],
  },
  { series: 'MUR4xx', io: 4, vf: 0.8, vfHigh: 1.1, trr: (v) => (v <= 200 ? 25e-9 : 50e-9), cj: 50e-12, footprint: 'DO-201AD', rows: [['MUR405', 50], ['MUR410', 100], ['MUR415', 150], ['MUR420', 200], ['MUR440', 400], ['MUR460', 600]] },
  { series: 'MUR8xx', io: 8, vf: 0.85, vfHigh: 1.2, trr: (v) => (v <= 200 ? 25e-9 : 50e-9), cj: 80e-12, footprint: 'TO-220-2', rows: [['MUR805', 50], ['MUR810', 100], ['MUR815', 150], ['MUR820', 200], ['MUR840', 400], ['MUR860', 600]] },
  { series: 'MUR15xx', io: 15, vf: 0.85, vfHigh: 1.2, trr: (v) => (v <= 200 ? 35e-9 : 60e-9), cj: 150e-12, footprint: 'TO-220-2', rows: [['MUR1505', 50], ['MUR1510', 100], ['MUR1515', 150], ['MUR1520', 200], ['MUR1540', 400], ['MUR1560', 600]] },
  { series: 'S1x', io: 1, vf: 0.95, trr: 0, cj: 12e-12, footprint: 'SMA', rows: letters('S1', '', SMD_LETTERS) },
  { series: 'S2x', io: 2, vf: 0.95, trr: 0, cj: 20e-12, footprint: 'SMB', rows: letters('S2', '', SMD_LETTERS) },
  { series: 'S3x', io: 3, vf: 0.95, trr: 0, cj: 40e-12, footprint: 'SMC', rows: letters('S3', '', SMD_LETTERS) },
  { series: 'M1-M7', io: 1, vf: 0.95, trr: 0, cj: 15e-12, footprint: 'SMA', rows: V7.map((v, i) => [`M${i + 1}`, v]) },
  { series: 'US1x', io: 1, vf: 0.9, vfHigh: 1.4, trr: (v) => (v <= 400 ? 50e-9 : 75e-9), cj: 12e-12, footprint: 'SMA', rows: letters('US1', '', SMD_LETTERS) },
  { series: 'RS1x', io: 1, vf: 1.1, trr: (v) => (v <= 400 ? 150e-9 : v <= 600 ? 250e-9 : 500e-9), cj: 12e-12, footprint: 'SMA', rows: letters('RS1', '', SMD_LETTERS) },
  { series: 'ES1x', io: 1, vf: 0.85, vfHigh: 1.2, trr: 35e-9, cj: 10e-12, footprint: 'SMA', rows: letters('ES1', '', [['A', 50], ['B', 100], ['C', 150], ['D', 200], ['E', 300], ['G', 400], ['J', 600]]) },
  { series: 'BYV26', io: 1, vf: 1.1, trr: 30e-9, cj: 20e-12, footprint: 'SOD-57', rows: [['BYV26A', 200], ['BYV26B', 400], ['BYV26C', 600], ['BYV26D', 800], ['BYV26E', 1000]] },
  { series: 'BY255', io: 3, vf: 0.95, trr: 0, cj: 40e-12, footprint: 'DO-201AD', rows: [['BY255', 1300]] },
];

const rectifiers: LibraryPartDef[] = REC_SERIES.flatMap((s) =>
  s.rows.map(([pn, vrrm]) => {
    const trr = typeof s.trr === 'function' ? s.trr(vrrm) : s.trr;
    const vf = s.vfHigh !== undefined && vrrm > 400 ? s.vfHigh : s.vf;
    const n = trr > 0 ? 1.6 : 1.8;
    const rs = Number((0.04 / s.io).toPrecision(2));
    const model = card(modelName(pn), 'D', { is: Number(isFor(vf, s.io, n, rs).toPrecision(3)), n, rs, cjo: s.cj, vj: 0.5, m: 0.33, tt: trr > 0 ? Number((trr / 1.5).toPrecision(2)) : 4e-6, bv: vrrm, ibv: 5e-6 * s.io });
    const speed = trr === 0 ? 'standard-recovery' : trr <= 75e-9 ? 'ultrafast' : 'fast-recovery';
    const speedVi = trr === 0 ? 'phục hồi thường' : trr <= 75e-9 ? 'phục hồi siêu nhanh' : 'phục hồi nhanh';
    return diodePart({
      pn,
      family: 'Rectifier diode',
      model,
      en: `${eng(s.io, 'A')} ${speed} rectifier, VRRM = ${vrrm} V${trr ? `, trr ${eng(trr, 's')}` : ''}`,
      vi: `Diode chỉnh lưu ${eng(s.io, 'A')} ${speedVi}, VRRM = ${vrrm} V${trr ? `, trr ${eng(trr, 's')}` : ''}`,
      provenance: `MachSim fit to the ${s.series} datasheet: VF ≈ ${vf} V @ ${eng(s.io, 'A')}, CJ ≈ ${eng(s.cj, 'F')}, ${trr ? `trr ${eng(trr, 's')}` : 'standard recovery (TT 4 µs)'}, breakdown at VRRM = ${vrrm} V`,
      footprint: s.footprint,
      keywords: ['rectifier', speed, s.series.toLowerCase()],
      specs: { vrrm, io: s.io, vf, trr, package: s.footprint },
      sortKey: s.io * 1e4 + vrrm,
      series: s.series,
    });
  }),
);

// ---------------------------------------------------------------------------------------------
// Schottky

type SchRow = [pn: string, vrrm: number, io: number, vf: number, atI: number, cj: number, footprint: string];

const SCHOTTKY: SchRow[] = [
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SB1${v === 100 ? '100' : String(v / 10) + '0'}`, v, 1, v <= 40 ? 0.5 : v <= 60 ? 0.7 : 0.85, 1, 110e-12, 'DO-41']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SB2${v === 100 ? '100' : String(v / 10) + '0'}`, v, 2, v <= 40 ? 0.5 : v <= 60 ? 0.7 : 0.85, 2, 170e-12, 'DO-15']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SB3${v === 100 ? '100' : String(v / 10) + '0'}`, v, 3, v <= 40 ? 0.5 : v <= 60 ? 0.74 : 0.85, 3, 250e-12, 'DO-201AD']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SB5${v === 100 ? '100' : String(v / 10) + '0'}`, v, 5, v <= 40 ? 0.55 : v <= 60 ? 0.7 : 0.85, 5, 400e-12, 'DO-201AD']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SS1${v === 100 ? '10' : String(v / 10)}`, v, 1, v <= 40 ? 0.5 : v <= 60 ? 0.7 : 0.85, 1, 110e-12, 'SMA']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SS2${v === 100 ? '10' : String(v / 10)}`, v, 2, v <= 40 ? 0.5 : v <= 60 ? 0.7 : 0.85, 2, 170e-12, 'SMB']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SS3${v === 100 ? '10' : String(v / 10)}`, v, 3, v <= 40 ? 0.5 : v <= 60 ? 0.75 : 0.85, 3, 250e-12, 'SMC']),
  ...([20, 30, 40, 50, 60, 80, 100] as const).map((v): SchRow => [`SS5${v === 100 ? '10' : String(v / 10)}`, v, 5, v <= 40 ? 0.55 : v <= 60 ? 0.7 : 0.85, 5, 400e-12, 'SMC']),
  ['1N5820', 20, 3, 0.475, 3, 250e-12, 'DO-201AD'],
  ['1N5821', 30, 3, 0.5, 3, 250e-12, 'DO-201AD'],
  ['1N5822', 40, 3, 0.525, 3, 250e-12, 'DO-201AD'],
  ['MBR150', 50, 1, 0.75, 1, 80e-12, 'DO-41'],
  ['MBR160', 60, 1, 0.75, 1, 80e-12, 'DO-41'],
  ['MBRS130', 30, 1, 0.395, 1, 110e-12, 'SMB'],
  ['MBRS140', 40, 1, 0.45, 1, 110e-12, 'SMB'],
  ['MBRS340', 40, 3, 0.525, 3, 250e-12, 'SMC'],
  ['MBRS360', 60, 3, 0.74, 3, 250e-12, 'SMC'],
  ['MBR340', 40, 3, 0.6, 3, 250e-12, 'DO-201AD'],
  ['MBR350', 50, 3, 0.74, 3, 250e-12, 'DO-201AD'],
  ['MBR360', 60, 3, 0.74, 3, 250e-12, 'DO-201AD'],
  ['MBR735', 35, 7.5, 0.57, 7.5, 400e-12, 'TO-220-2'],
  ['MBR745', 45, 7.5, 0.57, 7.5, 400e-12, 'TO-220-2'],
  ['MBR1035', 35, 10, 0.57, 10, 500e-12, 'TO-220-2'],
  ['MBR1045', 45, 10, 0.57, 10, 500e-12, 'TO-220-2'],
  ['MBR1060', 60, 10, 0.7, 10, 500e-12, 'TO-220-2'],
  ['MBR10100', 100, 10, 0.8, 10, 400e-12, 'TO-220-2'],
  ['MBR1545', 45, 15, 0.57, 15, 700e-12, 'TO-220-2'],
  ['MBR1645', 45, 16, 0.57, 16, 700e-12, 'TO-220-2'],
  ['MBR2045', 45, 20, 0.57, 20, 900e-12, 'TO-220-3'],
  ['MBR2060', 60, 20, 0.7, 20, 900e-12, 'TO-220-3'],
  ['MBR20100', 100, 20, 0.8, 20, 700e-12, 'TO-220-3'],
  ['MBR3045', 45, 30, 0.6, 30, 1200e-12, 'TO-247'],
  ['11DQ03', 30, 1.1, 0.5, 1, 100e-12, 'DO-41'],
  ['11DQ04', 40, 1.1, 0.55, 1, 100e-12, 'DO-41'],
  ['11DQ06', 60, 1.1, 0.62, 1, 100e-12, 'DO-41'],
  ['11DQ10', 100, 1.1, 0.75, 1, 80e-12, 'DO-41'],
  ['B5819W', 40, 1, 0.6, 1, 110e-12, 'SOD-123'],
  ['B5817W', 20, 1, 0.45, 1, 110e-12, 'SOD-123'],
];

/** Small-signal Schottky: [pn, VR, IF max, VF, at I, CJ, package]. */
const SCHOTTKY_SIGNAL: SchRow[] = [
  ['BAT41', 100, 0.1, 0.45, 1e-3, 2e-12, 'DO-35'],
  ['BAT42', 30, 0.2, 0.4, 10e-3, 7e-12, 'DO-35'],
  ['BAT43', 30, 0.2, 0.33, 2e-3, 7e-12, 'DO-35'],
  ['BAT46', 100, 0.15, 0.45, 10e-3, 6e-12, 'DO-35'],
  ['BAT48', 40, 0.35, 0.4, 10e-3, 15e-12, 'DO-35'],
  ['BAT85', 30, 0.2, 0.32, 1e-3, 10e-12, 'DO-34'],
  ['BAT86', 50, 0.2, 0.38, 1e-3, 8e-12, 'DO-34'],
  ['1N5711', 70, 0.015, 0.41, 1e-3, 2e-12, 'DO-35'],
  ['1N6263', 60, 0.015, 0.41, 1e-3, 2.2e-12, 'DO-35'],
  ['BAS40', 40, 0.2, 0.38, 1e-3, 5e-12, 'SOT-23'],
  ['BAS70', 70, 0.07, 0.41, 1e-3, 2e-12, 'SOT-23'],
  ['SD103A', 40, 0.35, 0.37, 20e-3, 50e-12, 'DO-35'],
  ['SD103B', 30, 0.35, 0.37, 20e-3, 50e-12, 'DO-35'],
  ['SD103C', 20, 0.35, 0.37, 20e-3, 50e-12, 'DO-35'],
];

const schottkys: LibraryPartDef[] = [
  ...SCHOTTKY.map(([pn, vrrm, io, vf, atI, cj, fp]) => {
    const n = 1.1;
    const rs = Number((0.03 / io).toPrecision(2));
    const model = card(modelName(pn), 'D', { is: Number(isFor(vf, atI, n, rs).toPrecision(3)), n, rs, cjo: cj, vj: 0.35, m: 0.5, tt: 0, bv: vrrm, ibv: 1e-3 * Math.min(io, 5) });
    return diodePart({
      pn,
      family: 'Schottky diode',
      model,
      kind: 'schottky',
      en: `${eng(io, 'A')} Schottky barrier rectifier, VRRM = ${vrrm} V, VF ≈ ${vf} V`,
      vi: `Diode Schottky chỉnh lưu ${eng(io, 'A')}, VRRM = ${vrrm} V, VF ≈ ${vf} V`,
      provenance: `MachSim fit to the ${pn} datasheet: VF ≈ ${vf} V @ ${eng(atI, 'A')}, CJ ≈ ${eng(cj, 'F')}, VRRM ${vrrm} V`,
      footprint: fp,
      keywords: ['schottky', 'rectifier', 'low drop'],
      specs: { vrrm, io, vf, package: fp },
      sortKey: io * 1e4 + vrrm,
      series: 'Schottky rectifier',
    });
  }),
  ...SCHOTTKY_SIGNAL.map(([pn, vr, ifm, vf, atI, cj, fp]) => {
    const n = 1.05;
    const rs = Number((0.6 / ifm).toPrecision(2));
    const model = card(modelName(pn), 'D', { is: Number(isFor(vf, atI, n, rs).toPrecision(3)), n, rs, cjo: cj, vj: 0.35, m: 0.5, tt: 0, bv: vr, ibv: 10e-6 });
    return diodePart({
      pn,
      family: 'Schottky diode',
      model,
      kind: 'schottky',
      en: `Small-signal Schottky diode, ${vr} V / ${eng(ifm, 'A')}, VF ${vf} V @ ${eng(atI, 'A')}`,
      vi: `Diode Schottky tín hiệu nhỏ, ${vr} V / ${eng(ifm, 'A')}, VF ${vf} V @ ${eng(atI, 'A')}`,
      provenance: `MachSim fit to the ${pn} datasheet: VF ${vf} V @ ${eng(atI, 'A')}, CD ≈ ${eng(cj, 'F')}, VR ${vr} V`,
      footprint: fp,
      keywords: ['schottky', 'signal', 'detector', 'clamp'],
      specs: { vrrm: vr, io: ifm, vf, package: fp },
      sortKey: ifm * 1e4 + vr,
      series: 'Schottky signal',
    });
  }),
];

// ---------------------------------------------------------------------------------------------
// small-signal switching diodes

type SigRow = [pn: string, vr: number, ifm: number, vf: number, atI: number, trr: number, cj: number, fp: string];
const SIGNAL: SigRow[] = [
  ['1N4448', 100, 0.2, 0.68, 5e-3, 4e-9, 4e-12, 'DO-35'],
  ['1N4150', 50, 0.3, 0.74, 10e-3, 4e-9, 2.5e-12, 'DO-35'],
  ['1N4151', 75, 0.2, 0.74, 10e-3, 2e-9, 2e-12, 'DO-35'],
  ['1N4446', 100, 0.2, 0.72, 10e-3, 4e-9, 4e-12, 'DO-35'],
  ['1N4454', 75, 0.2, 0.72, 10e-3, 4e-9, 2e-12, 'DO-35'],
  ['1N916', 100, 0.2, 0.72, 10e-3, 4e-9, 2e-12, 'DO-35'],
  ['1N3064', 75, 0.1, 0.72, 10e-3, 4e-9, 2e-12, 'DO-35'],
  ['1N4531', 75, 0.2, 0.72, 10e-3, 4e-9, 4e-12, 'DO-35'],
  ['BAV19', 120, 0.25, 0.75, 10e-3, 50e-9, 1.5e-12, 'DO-35'],
  ['BAV20', 200, 0.25, 0.75, 10e-3, 50e-9, 1.5e-12, 'DO-35'],
  ['BAV21', 250, 0.25, 0.75, 10e-3, 50e-9, 1.5e-12, 'DO-35'],
  ['BAS16', 100, 0.2, 0.72, 10e-3, 4e-9, 2e-12, 'SOT-23'],
  ['BAS21', 250, 0.2, 0.8, 10e-3, 50e-9, 2e-12, 'SOT-23'],
  ['BAL99', 70, 0.2, 0.72, 10e-3, 6e-9, 1.5e-12, 'SOT-23'],
  ['LL4148', 100, 0.2, 0.7, 10e-3, 4e-9, 4e-12, 'MiniMELF'],
  ['1N4148W', 100, 0.15, 0.7, 10e-3, 4e-9, 2e-12, 'SOD-123'],
];

const signalDiodes: LibraryPartDef[] = SIGNAL.map(([pn, vr, ifm, vf, atI, trr, cj, fp]) =>
  diodePart({
    pn,
    family: 'Switching diode',
    model: card(modelName(pn), 'D', { is: Number(isFor(vf, atI, 1.8, 0.6).toPrecision(3)), n: 1.8, rs: 0.6, cjo: cj, vj: 0.7, m: 0.35, tt: Number((trr * 1.5).toPrecision(2)), bv: vr, ibv: 100e-6 }),
    en: `Small-signal switching diode, ${vr} V / ${eng(ifm, 'A')}, trr ${eng(trr, 's')}`,
    vi: `Diode chuyển mạch tín hiệu nhỏ, ${vr} V / ${eng(ifm, 'A')}, trr ${eng(trr, 's')}`,
    provenance: `MachSim fit to the ${pn} datasheet: VF ≈ ${vf} V @ ${eng(atI, 'A')}, CD ≤ ${eng(cj, 'F')}, trr ${eng(trr, 's')}, V(BR) ${vr} V`,
    footprint: fp,
    keywords: ['switching', 'signal diode'],
    specs: { vrrm: vr, io: ifm, vf, trr, package: fp },
    sortKey: vr,
    series: 'Signal diode',
  }),
);

// ---------------------------------------------------------------------------------------------
// LEDs (colour × package)

interface LedColor {
  slug: string;
  en: string;
  vi: string;
  css: string;
  /** glow colour option of the LED parameters */
  glow: string;
  vf: number;
  n: number;
  wavelength: string;
}

const LED_COLORS_EXT: LedColor[] = [
  { slug: 'red', en: 'Red', vi: 'đỏ', css: '#e53935', glow: 'red', vf: 1.9, n: 2.0, wavelength: '630 nm' },
  { slug: 'hired', en: 'Bright Red', vi: 'đỏ sáng', css: '#ff1744', glow: 'red', vf: 2.0, n: 2.0, wavelength: '625 nm' },
  { slug: 'orange', en: 'Orange', vi: 'cam', css: '#fb8c00', glow: 'orange', vf: 2.0, n: 2.0, wavelength: '605 nm' },
  { slug: 'amber', en: 'Amber', vi: 'hổ phách', css: '#ffb300', glow: 'yellow', vf: 2.05, n: 2.0, wavelength: '595 nm' },
  { slug: 'yellow', en: 'Yellow', vi: 'vàng', css: '#fdd835', glow: 'yellow', vf: 2.0, n: 2.0, wavelength: '590 nm' },
  { slug: 'green', en: 'Green', vi: 'xanh lá', css: '#43a047', glow: 'green', vf: 2.1, n: 2.0, wavelength: '570 nm' },
  { slug: 'puregreen', en: 'Pure Green', vi: 'xanh lục thuần', css: '#00e676', glow: 'green', vf: 3.1, n: 2.6, wavelength: '525 nm' },
  { slug: 'blue', en: 'Blue', vi: 'xanh dương', css: '#1e88e5', glow: 'blue', vf: 3.1, n: 2.6, wavelength: '470 nm' },
  { slug: 'white', en: 'White', vi: 'trắng', css: '#f5f5f5', glow: 'white', vf: 3.2, n: 2.6, wavelength: 'cool white' },
  { slug: 'warmwhite', en: 'Warm White', vi: 'trắng ấm', css: '#fff3c4', glow: 'white', vf: 3.1, n: 2.6, wavelength: 'warm white' },
  { slug: 'uv', en: 'Ultraviolet', vi: 'tử ngoại', css: '#7c4dff', glow: 'blue', vf: 3.4, n: 2.8, wavelength: '395 nm' },
  { slug: 'ir850', en: 'Infrared 850 nm', vi: 'hồng ngoại 850 nm', css: '#8e24aa', glow: 'infrared', vf: 1.5, n: 1.6, wavelength: '850 nm' },
  { slug: 'ir940', en: 'Infrared 940 nm', vi: 'hồng ngoại 940 nm', css: '#8e24aa', glow: 'infrared', vf: 1.25, n: 1.5, wavelength: '940 nm' },
];

interface LedPackage {
  slug: string;
  label: string;
  footprint: string;
  ifwd: number;
  rs: number;
  /** VF increase at the rated current of high-current emitters */
  dvf: number;
}

const LED_PACKAGES: LedPackage[] = [
  { slug: '3mm', label: '3 mm', footprint: 'LED-3MM', ifwd: 20e-3, rs: 3, dvf: 0 },
  { slug: '5mm', label: '5 mm', footprint: 'LED-5MM', ifwd: 20e-3, rs: 3, dvf: 0 },
  { slug: '10mm', label: '10 mm', footprint: 'LED-10MM', ifwd: 20e-3, rs: 3, dvf: 0 },
  { slug: '0603', label: 'SMD 0603', footprint: 'LED-0603', ifwd: 20e-3, rs: 5, dvf: 0.05 },
  { slug: '0805', label: 'SMD 0805', footprint: 'LED-0805', ifwd: 20e-3, rs: 4, dvf: 0.05 },
  { slug: '1206', label: 'SMD 1206', footprint: 'LED-1206', ifwd: 20e-3, rs: 4, dvf: 0.05 },
  { slug: '1w', label: '1 W', footprint: 'LED-STAR-1W', ifwd: 350e-3, rs: 0.8, dvf: 0.3 },
];

const leds: LibraryPartDef[] = LED_COLORS_EXT.flatMap((c) =>
  LED_PACKAGES.map((p) => {
    const vf = Number((c.vf + p.dvf).toFixed(2));
    const model = ledModel(modelName(`LED_${c.slug}_${p.slug}`), vf, p.ifwd, c.n, p.rs);
    const params = ledIndicatorParams(c.glow).map((d) => (d.key === 'imax' ? { ...d, default: p.ifwd > 0.1 ? '350m' : '20m' } : d));
    return withMeta(
      {
        id: `diodes/led-${c.slug}-${p.slug}`,
        name: `LED ${c.en} ${p.label}`,
        group: 'diodes',
        family: 'LED',
        description: `${c.en} LED (${c.wavelength}), ${p.label}, VF ≈ ${vf} V @ ${eng(p.ifwd, 'A')}`,
        prefix: 'LED',
        symbol: ledSymbol(c.css),
        params: [...params, modelOverrideParam()],
        toSpice: (ctx) => ledFragment(ctx, model),
        indicator: { kind: 'led', signal: 'current' },
        ...ledBinding,
        provenance: `MachSim fit: typical ${p.label} ${c.en.toLowerCase()} LED, VF = ${vf} V @ ${eng(p.ifwd, 'A')} (N = ${c.n}, RS = ${p.rs} Ω), VR(max) 5 V`,
        footprint: p.footprint,
        keywords: ['led', 'light emitting diode', c.en.toLowerCase(), p.label.toLowerCase(), 'indicator'],
      },
      {
        vi: `LED ${c.vi} (${c.wavelength}), ${p.label}, VF ≈ ${vf} V @ ${eng(p.ifwd, 'A')}`,
        nameVi: `LED ${c.vi} ${p.label}`,
        specs: { color: c.en, package: p.label, vf, irating: p.ifwd },
        sortKey: LED_COLORS_EXT.indexOf(c) * 10 + LED_PACKAGES.indexOf(p),
        series: 'LED',
      },
    );
  }),
);

// ---------------------------------------------------------------------------------------------
// TVS diodes

const V_P6KE = [6.8, 7.5, 8.2, 9.1, 10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91, 100, 110, 120, 130, 150, 160, 170, 180, 200, 220, 250, 300, 350, 400, 440];
const V_SMBJ = [5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 33, 36, 40, 43, 45, 48, 51, 54, 58, 60, 64, 70, 75, 78, 85, 90, 100, 110, 120, 130, 150, 160, 170];

const TVS_BI_SYMBOL: SymbolDef = twoPinH(
  [line(-20, 0, -14, 0), poly([-14, -7, -14, 7, 0, 0], true), poly([14, -7, 14, 7, 0, 0], true), line(0, -9, 0, 9), line(0, -9, -3, -11), line(0, 9, 3, 11), line(14, 0, 20, 0)],
  { names: ['A', 'K'] },
);

interface TvsSpec {
  pn: string;
  vbr: number;
  vwm: number;
  vc: number;
  ppk: number;
  bi: boolean;
  footprint: string;
  series: string;
}

function tvsPart(s: TvsSpec): LibraryPartDef {
  const ipp = s.ppk / s.vc;
  const rd = Math.max(1e-3, (s.vc - s.vbr) / ipp);
  const cj = Number((3e-9 * Math.pow(6.8 / s.vbr, 0.8) * (s.ppk / 600)).toPrecision(2));
  const tag = s.pn.replace(/[^A-Za-z0-9]/g, '_');
  const it = s.vbr < 8 ? 10e-3 : 1e-3;
  const uni = { vz: s.vbr, izt: it, zzt: rd, cjo: cj };
  const halfSpec = { vz: Math.max(1, s.vbr - 0.65), izt: it, zzt: rd / 2, cjo: cj * 2 };
  return withMeta(
    {
      id: D_ID(s.pn),
      name: s.pn,
      group: 'diodes',
      family: 'TVS diode',
      description: `${s.ppk} W ${s.bi ? 'bidirectional' : 'unidirectional'} transient-voltage suppressor: VWM ${s.vwm} V, VBR ${s.vbr} V, VC ${s.vc} V @ ${eng(ipp, 'A')}`,
      prefix: 'D',
      symbol: s.bi ? TVS_BI_SYMBOL : dsym('tvs'),
      params: [],
      toSpice: (ctx: ToSpiceContext) => {
        if (!s.bi) return zenerFragment(ctx, `TVS_${tag}`, uni);
        // two opposed junctions in series (anodes joined at the private node m): from either
        // terminal one junction breaks down and the other conducts forward
        const m = internalNode(ctx, 'm');
        const half = (side: 'A' | 'K') =>
          zenerFragment(
            { ...ctx, node: (p: string) => (p === 'A' ? m : ctx.node(side)), name: (t: string, x?: string) => ctx.name(t, `${side.toLowerCase()}${x ?? ''}`), internal: (x: string) => internalNode(ctx, `${side.toLowerCase()}${x}`) } as ToSpiceContext,
            `TVS_${tag}`,
            halfSpec,
          );
        const a = half('A');
        const k = half('K');
        return { elements: [...a.elements, ...k.elements], models: a.models };
      },
      provenance: `MachSim TVS fit to the ${s.series} datasheet: VBR ${s.vbr} V, VWM ${s.vwm} V, clamping VC ${s.vc} V at IPP = PPK / VC = ${eng(ipp, 'A')}${s.series.startsWith('SM') ? ' (VBR and VC approximated from VWM for the series)' : ' (VC approximated for the series)'}`,
      footprint: s.footprint,
      keywords: [s.pn.toLowerCase(), 'tvs', 'transient voltage suppressor', 'esd', 'surge', s.bi ? 'bidirectional' : 'unidirectional'],
    },
    {
      vi: `Diode TVS chống xung ${s.ppk} W ${s.bi ? 'hai chiều' : 'một chiều'}: VWM ${s.vwm} V, VBR ${s.vbr} V, VC ${s.vc} V @ ${eng(ipp, 'A')}`,
      specs: { vbr: s.vbr, vwm: s.vwm, ppk: s.ppk, polarity: s.bi ? 'bidirectional' : 'unidirectional', package: s.footprint },
      sortKey: s.vbr + (s.bi ? 0.001 : 0),
      series: s.series,
    },
  );
}

const r1 = (v: number) => Number(v.toPrecision(3));
const tvs: LibraryPartDef[] = [
  ...V_P6KE.flatMap((v) => [false, true].map((bi) => tvsPart({ pn: `P6KE${v}${bi ? 'CA' : 'A'}`, vbr: v, vwm: r1(v * 0.855), vc: r1(1.4 * v + 0.9), ppk: 600, bi, footprint: 'DO-15', series: 'P6KE' }))),
  ...V_P6KE.flatMap((v) => [false, true].map((bi) => tvsPart({ pn: `1.5KE${v}${bi ? 'CA' : 'A'}`, vbr: v, vwm: r1(v * 0.855), vc: r1(1.4 * v + 0.9), ppk: 1500, bi, footprint: 'DO-201AE', series: '1.5KE' }))),
  ...V_SMBJ.flatMap((v) => [false, true].map((bi) => tvsPart({ pn: `SMBJ${v.toFixed(v % 1 ? 1 : v < 10 ? 1 : 0)}${bi ? 'CA' : 'A'}`, vbr: r1(1.11 * v + 0.9), vwm: v, vc: r1(1.6 * v + 1.2), ppk: 600, bi, footprint: 'SMB', series: 'SMBJ' }))),
  ...V_SMBJ.map((v) => tvsPart({ pn: `SMAJ${v.toFixed(v % 1 ? 1 : v < 10 ? 1 : 0)}A`, vbr: r1(1.11 * v + 0.9), vwm: v, vc: r1(1.6 * v + 1.2), ppk: 400, bi: false, footprint: 'SMA', series: 'SMAJ' })),
];

// ---------------------------------------------------------------------------------------------
// bridge rectifiers

type BridgeRow = [pn: string, vrrm: number, io: number, footprint: string];
const BRIDGES: BridgeRow[] = [
  ...V7.map((v, i): BridgeRow => [`DB10${i + 1}`, v, 1, 'DIP-4']),
  ...V7.map((v, i): BridgeRow => [`W${['005', '01', '02', '04', '06', '08', '10'][i]}G`, v, 1.5, 'WOG']),
  ...V7.map((v, i): BridgeRow => [`KBP2${['005', '01', '02', '04', '06', '08', '10'][i]}`.replace('KBP2005', 'KBP2005'), v, 2, 'KBP']),
  ...SMD_LETTERS.map(([l, v]): BridgeRow => [`GBU4${l}`, v, 4, 'GBU']),
  ...SMD_LETTERS.map(([l, v]): BridgeRow => [`GBU8${l}`, v, 8, 'GBU']),
  ...V7.map((v, i): BridgeRow => [`KBPC10${['005', '01', '02', '04', '06', '08', '10'][i]}`, v, 10, 'KBPC']),
  ['KBPC2510', 1000, 25, 'KBPC'],
  ['KBPC3510', 1000, 35, 'KBPC'],
  ['MB6S', 600, 0.5, 'SOIC-4'],
  ['DF06M', 600, 1, 'DIP-4'],
];

const BRIDGE_SYMBOL = bridgeSymbol();

const bridges: LibraryPartDef[] = BRIDGES.map(([pn, vrrm, io, fp]) => {
  const vf = 0.95;
  const rs = Number((0.04 / io).toPrecision(2));
  const d = card(modelName(pn, 'D'), 'D', { is: Number(isFor(vf, io, 1.8, rs).toPrecision(3)), n: 1.8, rs, cjo: 15e-12 * Math.sqrt(io), vj: 0.5, m: 0.33, tt: 4e-6, bv: vrrm, ibv: 5e-6 });
  const sub = subckt(modelName(pn), ['ac1', 'ac2', 'p', 'n'], [elD('D1', 'ac1', 'p', d.name), elD('D2', 'ac2', 'p', d.name), elD('D3', 'n', 'ac1', d.name), elD('D4', 'n', 'ac2', d.name)], [d]);
  return withMeta(
    {
      id: D_ID(pn),
      name: pn,
      group: 'diodes',
      family: 'Bridge rectifier',
      description: `${eng(io, 'A')} single-phase bridge rectifier, VRRM = ${vrrm} V`,
      prefix: 'D',
      symbol: BRIDGE_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('AC1'), ctx.node('AC2'), ctx.node('+'), ctx.node('-')], sub.name)], subckts: [sub] }),
      provenance: `Four MachSim rectifier junctions fitted to the ${pn} datasheet: VF ≈ ${vf} V per diode @ ${eng(io, 'A')}, VRRM ${vrrm} V`,
      footprint: fp,
      keywords: [pn.toLowerCase(), 'bridge', 'rectifier', 'full wave'],
    },
    { vi: `Cầu chỉnh lưu một pha ${eng(io, 'A')}, VRRM = ${vrrm} V`, specs: { vrrm, io, package: fp }, sortKey: io * 1e4 + vrrm, series: 'Bridge' },
  );
});

// ---------------------------------------------------------------------------------------------
// varactors and PIN diodes

type VarRow = [pn: string, c: number, atV: number, vr: number, rs: number, fp: string];
const MV21 = [6.8, 8.2, 10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82, 100];
const VARACTORS: VarRow[] = [
  ...MV21.map((c, i): VarRow => [`MV21${String(i + 1).padStart(2, '0')}`, c * 1e-12, 4, 30, 1, 'TO-92']),
  ['BB112', 470e-12, 1, 12, 1.5, 'TO-92'],
  ['BB910', 38e-12, 1, 30, 0.4, 'SOD-323'],
  ['BB135', 18e-12, 1, 30, 0.75, 'SOD-323'],
  ['BB149', 31e-12, 1, 30, 0.5, 'SOD-323'],
  ['BB639', 37e-12, 1, 30, 0.6, 'SOD-323'],
];

const varactors: LibraryPartDef[] = VARACTORS.map(([pn, c, atV, vr, rs, fp]) => {
  const vj = 0.7;
  const m = 0.5;
  const cjo = Number((c * Math.pow(1 + atV / vj, m)).toPrecision(3));
  return diodePart({
    pn,
    family: 'Varactor',
    model: card(modelName(pn), 'D', { is: 1e-14, n: 1, rs, cjo, vj, m, bv: vr, ibv: 10e-6 }),
    kind: 'varactor',
    en: `Tuning varactor, ${eng(c, 'F')} @ ${atV} V reverse bias, VR ${vr} V`,
    vi: `Diode biến dung, ${eng(c, 'F')} khi phân cực ngược ${atV} V, VR ${vr} V`,
    provenance: `MachSim fit: CJO = ${eng(cjo, 'F')} gives C = ${eng(c, 'F')} at VR = ${atV} V (M = ${m}, VJ = ${vj} V); RS ${rs} Ω`,
    footprint: fp,
    keywords: ['varactor', 'varicap', 'tuning'],
    specs: { cj: c, vrrm: vr, package: fp },
    sortKey: c,
    series: 'Varactor',
  });
});

type PinRow = [pn: string, cj: number, rs: number, tt: number, vr: number, fp: string];
const PINS: PinRow[] = [
  ['BAP64-02', 0.35e-12, 1.4, 1.5e-6, 175, 'SOD-523'],
  ['BAR64-02', 0.25e-12, 2.1, 1.55e-6, 150, 'SCD-80'],
  ['BA592', 0.6e-12, 0.36, 1.2e-6, 35, 'SOD-323'],
  ['1N5767', 0.4e-12, 2.5, 1e-6, 100, 'DO-35'],
  ['HSMP-3810', 0.35e-12, 3, 1.5e-6, 100, 'SOT-23'],
  ['BAP50-02', 0.4e-12, 3, 0.4e-6, 50, 'SOD-523'],
];

const pinDiodes: LibraryPartDef[] = PINS.map(([pn, cj, rs, tt, vr, fp]) =>
  diodePart({
    pn,
    family: 'PIN diode',
    model: card(modelName(pn), 'D', { is: 1e-12, n: 1.5, rs, cjo: cj, vj: 0.7, m: 0.33, tt, bv: vr, ibv: 10e-6 }),
    en: `RF PIN switching / attenuator diode, CT ${eng(cj, 'F')}, carrier lifetime ${eng(tt, 's')}`,
    vi: `Diode PIN cho chuyển mạch / suy giảm cao tần, CT ${eng(cj, 'F')}, thời gian sống hạt tải ${eng(tt, 's')}`,
    provenance: `MachSim approximation of the ${pn} datasheet: junction capacitance ${eng(cj, 'F')}, series resistance ${rs} Ω at 10 mA, carrier lifetime ${eng(tt, 's')} (SPICE TT)`,
    footprint: fp,
    keywords: ['pin diode', 'rf switch', 'attenuator'],
    specs: { cj, vrrm: vr, package: fp },
    sortKey: cj,
    series: 'PIN',
  }),
);

export const DIODE_CATALOG: LibraryPartDef[] = [...zeners, ...rectifiers, ...schottkys, ...signalDiodes, ...leds, ...tvs, ...bridges, ...varactors, ...pinDiodes];
