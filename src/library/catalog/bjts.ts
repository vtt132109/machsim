/**
 * Bipolar transistor catalogue (groups Transistors and RF): small-signal, high-voltage and power
 * NPN / PNP transistors, Darlingtons, Darlington driver arrays and RF transistors.
 *
 * Each row holds datasheet figures: VCEO, IC(max), Ptot, typical hFE at a test current, fT and
 * Cob. `fitBjt` turns them into a Gummel-Poon card (MachSim fit, approximate away from the test
 * point):
 *   IS    VBE = 0.70 V at IC = IC(max) / 10
 *   VAF   100 V (small signal), 60 V (power), 200 V (high voltage)
 *   IKF   0.6·IC(max) (high-current β roll-off)
 *   BF, ISE (NE = 1.5)  solved so that β = IC / IB equals the typical hFE at the test current
 *         and VCE = 5 V, with the ISE term carrying 10 % of the base current (low-current
 *         roll-off), using the same base-charge equations as the engine (q1, q2, qb)
 *   CJC   Cob at VCB = 10 V referred to 0 V (MJC = 0.33, VJC = 0.75 V); CJE = 2.5·CJC
 *   TF    from fT at the test current: 1 / (2π fT) − (CJE + CJC)·Vt / IC; TR = 50·TF
 *   RB, RC, RE scaled with the current rating.
 * Darlingtons are a driver + output pair (with the usual 8 kΩ / 120 Ω base-emitter resistors and
 * a freewheel diode for power types) whose β product is the typical hFE.
 */
import { thermalVoltage } from '../../sim/device';
import type { ModelCard } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { card, elD, elQ, elR, elX, modelOverride, subckt, type LibraryPartDef } from '../partkit';
import { bjtSymbol, boxSymbol } from '../symbols';
import type { PartGroup } from '../types';
import { eng, modelName, modelOverrideParam, slug, withMeta } from './kit';

const VT = thermalVoltage(300.15);

export interface BjtRow {
  pn: string;
  pnp: boolean;
  vceo: number;
  ic: number;
  ptot: number;
  hfe: number;
  icTest: number;
  ft: number;
  cob: number;
  pkg: string;
  /** s small signal, p power, h high voltage, r RF, d Darlington */
  kind: 's' | 'p' | 'h' | 'r' | 'd';
}

/** "BC547A N 45 0.1 0.5 180 2m 300M 2.5p TO-92 s" (user-number syntax: m = milli, M = mega). */
function row(text: string): BjtRow {
  const [pn, pol, vceo, ic, ptot, hfe, icTest, ft, cob, pkg, kind] = text.trim().split(/\s+/);
  const n = (s: string) => {
    const v = parseUserNumber(s);
    if (!Number.isFinite(v)) throw new Error(`bad BJT row value '${s}' in ${pn}`);
    return v;
  };
  return { pn, pnp: pol === 'P', vceo: n(vceo), ic: n(ic), ptot: n(ptot), hfe: n(hfe), icTest: n(icTest), ft: n(ft), cob: n(cob), pkg, kind: kind as BjtRow['kind'] };
}

/** Expand "BC546A|B|C ..." style suffix lists: one row per suffix with its own hFE. */
function variants(base: string, suffixes: [string, number][], rest: string): string[] {
  return suffixes.map(([s, hfe]) => `${base}${s} ${rest.replace('{hfe}', String(hfe))}`);
}

const ABC: [string, number][] = [
  ['A', 180],
  ['B', 290],
  ['C', 520],
];
const AB: [string, number][] = ABC.slice(0, 2);
const BC: [string, number][] = ABC.slice(1);
const G16: [string, number][] = [
  ['-16', 160],
  ['-25', 250],
  ['-40', 400],
];
const ABCV = (base: string, pol: string, ic: number, ptot: number, hfe: number, icT: string, ft: string, cob: string, pkg: string, kind: string, volts: [string, number][]) =>
  volts.map(([s, v]) => `${base}${s} ${pol} ${v} ${ic} ${ptot} ${hfe} ${icT} ${ft} ${cob} ${pkg} ${kind}`);

const ROWS_TEXT: string[] = [
  // ---- small-signal TO-92 (BC54x / BC55x families: A/B/C hFE groups)
  ...variants('BC546', AB, 'N 65 0.1 0.5 {hfe} 2m 300M 2.5p TO-92 s'),
  ...variants('BC547', [ABC[0], ABC[2]], 'N 45 0.1 0.5 {hfe} 2m 300M 2.5p TO-92 s'),
  ...variants('BC548', ABC, 'N 30 0.1 0.5 {hfe} 2m 300M 2.5p TO-92 s'),
  ...variants('BC549', BC, 'N 30 0.1 0.5 {hfe} 2m 300M 2.5p TO-92 s'),
  ...variants('BC550', BC, 'N 45 0.1 0.5 {hfe} 2m 300M 2.5p TO-92 s'),
  ...variants('BC556', AB, 'P 65 0.1 0.5 {hfe} 2m 150M 4.5p TO-92 s'),
  ...variants('BC557', [ABC[0], ABC[2]], 'P 45 0.1 0.5 {hfe} 2m 150M 4.5p TO-92 s'),
  ...variants('BC558', ABC, 'P 30 0.1 0.5 {hfe} 2m 150M 4.5p TO-92 s'),
  ...variants('BC559', BC, 'P 30 0.1 0.5 {hfe} 2m 150M 4.5p TO-92 s'),
  ...variants('BC560', BC, 'P 45 0.1 0.5 {hfe} 2m 150M 4.5p TO-92 s'),
  ...variants('BC337', G16, 'N 45 0.8 0.625 {hfe} 100m 210M 12p TO-92 s'),
  ...variants('BC338', G16, 'N 25 0.8 0.625 {hfe} 100m 210M 12p TO-92 s'),
  ...variants('BC327', G16, 'P 45 0.8 0.625 {hfe} 100m 100M 12p TO-92 s'),
  ...variants('BC328', G16, 'P 25 0.8 0.625 {hfe} 100m 100M 12p TO-92 s'),
  'BC635 N 45 1 1 100 150m 130M 10p TO-92 s',
  'BC637 N 60 1 1 100 150m 130M 10p TO-92 s',
  'BC639 N 80 1 1 100 150m 130M 10p TO-92 s',
  'BC636 P 45 1 1 100 150m 130M 15p TO-92 s',
  'BC638 P 60 1 1 100 150m 130M 15p TO-92 s',
  'BC640 P 80 1 1 100 150m 130M 15p TO-92 s',
  // ---- small-signal SOT-23
  ...variants('BC846', AB, 'N 65 0.1 0.25 {hfe} 2m 300M 1.5p SOT-23 s'),
  ...variants('BC847', ABC, 'N 45 0.1 0.25 {hfe} 2m 300M 1.5p SOT-23 s'),
  ...variants('BC848', ABC, 'N 30 0.1 0.25 {hfe} 2m 300M 1.5p SOT-23 s'),
  ...variants('BC849', BC, 'N 30 0.1 0.25 {hfe} 2m 300M 1.5p SOT-23 s'),
  ...variants('BC850', BC, 'N 45 0.1 0.25 {hfe} 2m 300M 1.5p SOT-23 s'),
  ...variants('BC856', AB, 'P 65 0.1 0.25 {hfe} 2m 150M 3p SOT-23 s'),
  ...variants('BC857', ABC, 'P 45 0.1 0.25 {hfe} 2m 150M 3p SOT-23 s'),
  ...variants('BC858', ABC, 'P 30 0.1 0.25 {hfe} 2m 150M 3p SOT-23 s'),
  ...variants('BC859', BC, 'P 30 0.1 0.25 {hfe} 2m 150M 3p SOT-23 s'),
  ...variants('BC860', BC, 'P 45 0.1 0.25 {hfe} 2m 150M 3p SOT-23 s'),
  ...variants('BC807', G16, 'P 45 0.5 0.31 {hfe} 100m 100M 10p SOT-23 s'),
  ...variants('BC817', G16, 'N 45 0.5 0.31 {hfe} 100m 100M 10p SOT-23 s'),
  'MMBT3904 N 40 0.2 0.35 150 10m 300M 4p SOT-23 s',
  'MMBT3906 P 40 0.2 0.35 150 10m 250M 4.5p SOT-23 s',
  'MMBT2222A N 40 0.6 0.35 200 150m 300M 8p SOT-23 s',
  'MMBT2907A P 60 0.6 0.35 200 150m 200M 8p SOT-23 s',
  'MMBT4401 N 40 0.6 0.35 150 150m 250M 6.5p SOT-23 s',
  'MMBT4403 P 40 0.6 0.35 150 150m 200M 8.5p SOT-23 s',
  'MMBT5551 N 160 0.6 0.35 100 10m 100M 6p SOT-23 h',
  'MMBT5401 P 150 0.6 0.35 100 10m 100M 6p SOT-23 h',
  // ---- 2N small signal and switching
  '2N2222 N 30 0.8 0.5 150 150m 250M 8p TO-92 s',
  '2N2219A N 40 0.8 0.8 200 150m 300M 8p TO-39 s',
  '2N2369A N 15 0.2 0.36 60 10m 500M 4p TO-18 s',
  '2N2484 N 60 0.05 0.36 400 1m 60M 6p TO-18 s',
  '2N2905A P 60 0.6 0.6 150 150m 200M 8p TO-39 s',
  '2N2907 P 40 0.6 0.4 150 150m 200M 8p TO-92 s',
  '2N3019 N 80 1 0.8 150 150m 100M 12p TO-39 s',
  '2N3053 N 40 0.7 1 120 150m 100M 15p TO-39 s',
  '2N3439 N 350 1 1 60 20m 15M 10p TO-39 h',
  '2N3440 N 250 1 1 60 20m 15M 10p TO-39 h',
  '2N3903 N 40 0.2 0.625 100 10m 250M 4p TO-92 s',
  '2N3905 P 40 0.2 0.625 100 10m 200M 4.5p TO-92 s',
  '2N3704 N 30 0.8 0.625 200 50m 100M 12p TO-92 s',
  '2N3705 N 30 0.8 0.625 100 50m 100M 12p TO-92 s',
  '2N3706 N 20 0.8 0.625 100 50m 100M 12p TO-92 s',
  '2N4123 N 30 0.2 0.625 100 2m 250M 4p TO-92 s',
  '2N4124 N 25 0.2 0.625 250 2m 300M 4p TO-92 s',
  '2N4125 P 30 0.2 0.625 100 2m 200M 4.5p TO-92 s',
  '2N4126 P 25 0.2 0.625 250 2m 250M 4.5p TO-92 s',
  '2N4400 N 40 0.6 0.625 100 150m 200M 6.5p TO-92 s',
  '2N4401 N 40 0.6 0.625 150 150m 250M 6.5p TO-92 s',
  '2N4402 P 40 0.6 0.625 100 150m 150M 8.5p TO-92 s',
  '2N4403 P 40 0.6 0.625 150 150m 200M 8.5p TO-92 s',
  '2N5087 P 50 0.05 0.625 400 100u 40M 4p TO-92 s',
  '2N5088 N 30 0.05 0.625 600 100u 50M 4p TO-92 s',
  '2N5089 N 25 0.05 0.625 800 100u 50M 4p TO-92 s',
  '2N5210 N 50 0.05 0.625 400 1m 30M 4p TO-92 s',
  '2N5400 P 120 0.6 0.625 100 10m 100M 6p TO-92 h',
  '2N5401 P 150 0.6 0.625 100 10m 100M 6p TO-92 h',
  '2N5550 N 140 0.6 0.625 100 10m 100M 6p TO-92 h',
  '2N5551 N 160 0.6 0.625 100 10m 100M 6p TO-92 h',
  '2N6517 N 350 0.5 0.625 60 30m 40M 6p TO-92 h',
  '2N6520 P 350 0.5 0.625 60 30m 40M 6p TO-92 h',
  'MPSA05 N 60 0.5 0.625 100 100m 100M 8p TO-92 s',
  'MPSA06 N 80 0.5 0.625 100 100m 100M 8p TO-92 s',
  'MPSA55 P 60 0.5 0.625 100 100m 50M 12p TO-92 s',
  'MPSA56 P 80 0.5 0.625 100 100m 50M 12p TO-92 s',
  'MPSA42 N 300 0.5 0.625 60 30m 50M 3p TO-92 h',
  'MPSA43 N 200 0.5 0.625 60 30m 50M 3p TO-92 h',
  'MPSA92 P 300 0.5 0.625 60 30m 50M 6p TO-92 h',
  'MPSA93 P 200 0.5 0.625 60 30m 50M 6p TO-92 h',
  'MPSA18 N 45 0.2 0.625 800 1m 160M 3p TO-92 s',
  'MPSA20 N 40 0.1 0.625 200 5m 125M 4p TO-92 s',
  'MPS2222A N 40 0.6 0.625 150 150m 300M 8p TO-92 s',
  'MPS2907A P 60 0.6 0.625 150 150m 200M 8p TO-92 s',
  'PN2222A N 40 1 0.625 150 150m 300M 8p TO-92 s',
  'PN2907A P 60 0.8 0.625 150 150m 200M 8p TO-92 s',
  'PN100 N 45 0.5 0.625 100 10m 250M 5p TO-92 s',
  'PN200 P 45 0.5 0.625 100 10m 200M 6p TO-92 s',
  '2SC945 N 50 0.15 0.25 200 1m 250M 3p TO-92 s',
  '2SA733 P 50 0.15 0.25 200 1m 180M 4.5p TO-92 s',
  '2SC1815-Y N 50 0.15 0.4 170 2m 80M 2p TO-92 s',
  '2SC1815-GR N 50 0.15 0.4 280 2m 80M 2p TO-92 s',
  '2SC1815-BL N 50 0.15 0.4 500 2m 80M 2p TO-92 s',
  '2SA1015-Y P 50 0.15 0.4 170 2m 80M 4p TO-92 s',
  '2SA1015-GR P 50 0.15 0.4 280 2m 80M 4p TO-92 s',
  '2SC3198 N 50 0.15 0.4 200 2m 130M 3p TO-92 s',
  '2SC2120 N 30 0.8 0.6 200 100m 120M 12p TO-92 s',
  '2SA950 P 30 0.8 0.6 200 100m 120M 20p TO-92 s',
  '2SC2655 N 50 2 0.9 100 500m 100M 25p TO-92L s',
  '2SA1020 P 50 2 0.9 100 500m 100M 40p TO-92L s',
  '2SC1384 N 50 1 1 100 500m 200M 12p TO-92L s',
  '2SA684 P 50 1 1 100 500m 200M 18p TO-92L s',
  '2SC2383 N 160 1 0.9 100 200m 100M 15p TO-92L h',
  '2SA1013 P 160 1 0.9 100 200m 50M 20p TO-92L h',
  'S8050 N 25 1.5 1 200 100m 100M 9p TO-92 s',
  'S8550 P 25 1.5 1 200 100m 100M 9p TO-92 s',
  'SS8050 N 25 1.5 1 200 100m 100M 9p TO-92 s',
  'SS8550 P 25 1.5 1 200 100m 100M 9p TO-92 s',
  'S9012 P 25 0.5 0.625 200 50m 150M 6p TO-92 s',
  'S9013 N 25 0.5 0.625 200 50m 150M 6p TO-92 s',
  'S9014 N 45 0.1 0.45 400 1m 150M 3p TO-92 s',
  'S9015 P 45 0.1 0.45 400 1m 150M 4p TO-92 s',
  'MJE13001 N 400 0.2 0.75 20 50m 8M 15p TO-92 h',
  // ---- medium / high-power
  'BD135 N 45 1.5 12.5 100 150m 190M 20p TO-126 p',
  'BD137 N 60 1.5 12.5 100 150m 190M 20p TO-126 p',
  'BD136 P 45 1.5 12.5 100 150m 190M 30p TO-126 p',
  'BD138 P 60 1.5 12.5 100 150m 190M 30p TO-126 p',
  'BD233 N 45 2 25 100 150m 3M 50p TO-126 p',
  'BD235 N 60 2 25 100 150m 3M 50p TO-126 p',
  'BD237 N 80 2 25 100 150m 3M 50p TO-126 p',
  'BD234 P 45 2 25 100 150m 3M 70p TO-126 p',
  'BD236 P 60 2 25 100 150m 3M 70p TO-126 p',
  'BD238 P 80 2 25 100 150m 3M 70p TO-126 p',
  ...ABCV('BD239', 'N', 2, 30, 60, '1', '3M', '60p', 'TO-220', 'p', [['', 45], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('BD240', 'P', 2, 30, 60, '1', '3M', '80p', 'TO-220', 'p', [['', 45], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('BD241', 'N', 3, 40, 60, '1', '3M', '100p', 'TO-220', 'p', [['', 45], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('BD242', 'P', 3, 40, 60, '1', '3M', '120p', 'TO-220', 'p', [['', 45], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('BD243', 'N', 6, 65, 60, '3', '3M', '200p', 'TO-220', 'p', [['', 45], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('BD244', 'P', 6, 65, 60, '3', '3M', '250p', 'TO-220', 'p', [['', 45], ['A', 60], ['B', 80], ['C', 100]]),
  'BD249C N 100 25 125 40 10 3M 600p TO-247 p',
  'BD250C P 100 25 125 40 10 3M 800p TO-247 p',
  ...([['BD433', 22], ['BD435', 32], ['BD437', 45], ['BD439', 60], ['BD441', 80]] as const).map(([pn, v]) => `${pn} N ${v} 4 36 100 2 3M 150p TO-126 p`),
  ...([['BD434', 22], ['BD436', 32], ['BD438', 45], ['BD440', 60], ['BD442', 80]] as const).map(([pn, v]) => `${pn} P ${v} 4 36 100 2 3M 200p TO-126 p`),
  'BD911 N 100 15 90 60 5 3M 400p TO-220 p',
  'BD912 P 100 15 90 60 5 3M 500p TO-220 p',
  ...ABCV('TIP29', 'N', 1, 30, 60, '0.2', '3M', '50p', 'TO-220', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP30', 'P', 1, 30, 60, '0.2', '3M', '70p', 'TO-220', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP31', 'N', 3, 40, 50, '1', '3M', '100p', 'TO-220', 'p', [['', 40], ['A', 60], ['B', 80]]),
  ...ABCV('TIP32', 'P', 3, 40, 50, '1', '3M', '120p', 'TO-220', 'p', [['', 40], ['A', 60], ['B', 80]]),
  ...ABCV('TIP33', 'N', 10, 80, 50, '3', '3M', '400p', 'TO-247', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP34', 'P', 10, 80, 50, '3', '3M', '500p', 'TO-247', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP35', 'N', 25, 125, 40, '15', '3M', '600p', 'TO-247', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP36', 'P', 25, 125, 40, '15', '3M', '800p', 'TO-247', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP41', 'N', 6, 65, 50, '3', '3M', '200p', 'TO-220', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...ABCV('TIP42', 'P', 6, 65, 50, '3', '3M', '250p', 'TO-220', 'p', [['', 40], ['A', 60], ['B', 80], ['C', 100]]),
  ...([['TIP47', 250], ['TIP48', 300], ['TIP49', 350], ['TIP50', 400]] as const).map(([pn, v]) => `${pn} N ${v} 1 40 60 0.3 10M 30p TO-220 h`),
  'TIP2955 P 60 15 90 50 4 3M 400p TO-247 p',
  'TIP3055 N 60 15 90 50 4 3M 300p TO-247 p',
  'MJE340 N 300 0.5 20 60 50m 10M 10p TO-126 h',
  'MJE350 P 300 0.5 20 60 50m 10M 15p TO-126 h',
  'MJE13003 N 400 1.5 40 20 0.5 4M 30p TO-126 h',
  'MJE13005 N 400 4 75 20 1 4M 60p TO-220 h',
  'MJE13007 N 400 8 80 20 2 4M 110p TO-220 h',
  'MJE13009 N 400 12 100 20 5 4M 180p TO-220 h',
  'MJE3055T N 60 10 75 50 4 2M 300p TO-220 p',
  'MJE2955T P 60 10 75 50 4 2M 400p TO-220 p',
  'MJE180 N 40 3 12.5 100 0.5 50M 40p TO-126 p',
  'MJE181 N 60 3 12.5 100 0.5 50M 40p TO-126 p',
  'MJE182 N 80 3 12.5 100 0.5 50M 40p TO-126 p',
  'MJE170 P 40 3 12.5 100 0.5 50M 50p TO-126 p',
  'MJE171 P 60 3 12.5 100 0.5 50M 50p TO-126 p',
  'MJE172 P 80 3 12.5 100 0.5 50M 50p TO-126 p',
  'MJE200 N 25 5 15 100 0.5 65M 80p TO-126 p',
  'MJE210 P 25 5 15 100 0.5 65M 120p TO-126 p',
  ...([['MJE15028', 'N', 120], ['MJE15029', 'P', 120], ['MJE15030', 'N', 150], ['MJE15031', 'P', 150]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 8 50 60 3 30M 150p TO-220 p`),
  ...([['MJE15032', 'N', 250], ['MJE15033', 'P', 250]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 8 50 50 1 30M 150p TO-220 h`),
  ...([['MJE15034', 'N', 350], ['MJE15035', 'P', 350]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 4 50 50 0.5 30M 120p TO-220 h`),
  '2N3772 N 60 20 150 30 10 200k 500p TO-3 p',
  '2N3773 N 140 16 150 30 8 200k 500p TO-3 p',
  'MJ2955 P 60 15 115 50 4 2.5M 400p TO-3 p',
  '2N6107 P 70 7 40 60 2 10M 250p TO-220 p',
  '2N6109 P 50 7 40 60 2 10M 250p TO-220 p',
  '2N6111 P 30 7 40 60 2 10M 250p TO-220 p',
  '2N6288 N 30 7 40 60 2 4M 200p TO-220 p',
  '2N6292 N 70 7 40 60 2 4M 200p TO-220 p',
  'MJ15003 N 140 20 250 25 5 2M 1n TO-3 p',
  'MJ15004 P 140 20 250 25 5 2M 1.5n TO-3 p',
  'MJ15015 N 120 15 180 30 4 1M 800p TO-3 p',
  'MJ15016 P 120 15 180 30 4 1M 1n TO-3 p',
  'MJ15022 N 200 16 250 25 8 4M 500p TO-3 p',
  'MJ15023 P 200 16 250 25 8 4M 700p TO-3 p',
  'MJ15024 N 250 16 250 25 8 4M 500p TO-3 p',
  'MJ15025 P 250 16 250 25 8 4M 700p TO-3 p',
  'MJ802 N 90 30 200 25 7.5 2M 1n TO-3 p',
  'MJ4502 P 90 30 200 25 7.5 2M 1.5n TO-3 p',
  'MJL21193 P 250 16 200 40 8 4M 1n TO-264 p',
  'MJL21194 N 250 16 200 40 8 4M 800p TO-264 p',
  'MJL21195 P 250 16 200 40 8 4M 1n TO-264 p',
  'MJL21196 N 250 16 200 40 8 4M 800p TO-264 p',
  'MJL3281A N 260 15 200 75 5 30M 600p TO-264 p',
  'MJL1302A P 260 15 200 75 5 30M 600p TO-264 p',
  'MJL4281A N 350 15 230 80 5 35M 600p TO-264 p',
  'MJL4302A P 350 15 230 80 5 35M 600p TO-264 p',
  '2SC2073 N 150 1.5 25 80 0.5 4M 30p TO-220 p',
  '2SA940 P 150 1.5 25 80 0.5 4M 45p TO-220 p',
  '2SC2238 N 160 1.5 25 100 0.1 100M 25p TO-220 p',
  '2SA968 P 160 1.5 25 100 0.1 100M 40p TO-220 p',
  '2SC4793 N 230 1 20 100 0.1 100M 20p TO-220 p',
  '2SA1837 P 230 1 20 100 0.1 70M 30p TO-220 p',
  '2SC5200 N 230 15 150 80 1 30M 200p TO-264 p',
  '2SA1943 P 230 15 150 80 1 30M 360p TO-264 p',
  '2SC3281 N 200 15 150 80 1 30M 200p TO-3P p',
  '2SA1302 P 200 15 150 80 1 25M 360p TO-3P p',
  '2SD882 N 30 3 10 150 1 90M 45p TO-126 p',
  '2SB772 P 30 3 10 150 1 80M 70p TO-126 p',
  '2SD669 N 160 1.5 20 100 0.15 140M 25p TO-126 p',
  '2SB649 P 160 1.5 20 100 0.15 140M 35p TO-126 p',
  '2SD1047 N 140 12 100 80 1 20M 200p TO-3P p',
  '2SB817 P 140 12 100 80 1 15M 300p TO-3P p',
  // ---- Darlingtons
  'MPSA13 N 30 0.5 0.625 10000 100m 125M 8p TO-92 d',
  'MPSA14 N 30 0.5 0.625 20000 100m 125M 8p TO-92 d',
  'MPSA63 P 30 0.5 0.625 10000 100m 125M 8p TO-92 d',
  'MPSA64 P 30 0.5 0.625 20000 100m 125M 8p TO-92 d',
  'MJE800 N 60 4 40 2000 1.5 1M 80p TO-126 d',
  'MJE700 P 60 4 40 2000 1.5 1M 100p TO-126 d',
  ...([['BD675', 'N', 45], ['BD677', 'N', 60], ['BD679', 'N', 80], ['BD681', 'N', 100], ['BD676', 'P', 45], ['BD678', 'P', 60], ['BD680', 'P', 80], ['BD682', 'P', 100]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 4 40 2000 1.5 1M 80p TO-126 d`),
  ...([['TIP100', 'N', 60], ['TIP101', 'N', 80], ['TIP102', 'N', 100], ['TIP105', 'P', 60], ['TIP106', 'P', 80], ['TIP107', 'P', 100]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 8 80 2500 3 1M 150p TO-220 d`),
  ...([['TIP110', 'N', 60], ['TIP111', 'N', 80], ['TIP112', 'N', 100], ['TIP115', 'P', 60], ['TIP116', 'P', 80], ['TIP117', 'P', 100]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 2 50 1000 1 1M 80p TO-220 d`),
  ...([['TIP121', 'N', 80], ['TIP122', 'N', 100], ['TIP126', 'P', 80], ['TIP127', 'P', 100]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 5 65 2500 3 1M 150p TO-220 d`),
  ...([['TIP140', 'N', 60], ['TIP141', 'N', 80], ['TIP142', 'N', 100], ['TIP145', 'P', 60], ['TIP146', 'P', 80], ['TIP147', 'P', 100]] as const).map(([pn, p, v]) => `${pn} ${p} ${v} 10 125 2000 5 1M 300p TO-247 d`),
  'MJ11015 P 120 30 200 1000 20 4M 1n TO-3 d',
  'MJ11016 N 120 30 200 1000 20 4M 800p TO-3 d',
  'MJH6284 N 100 20 160 1000 10 4M 600p TO-247 d',
  'MJH6287 P 100 20 160 1000 10 4M 800p TO-247 d',
  // ---- RF
  '2N5179 N 12 0.05 0.2 70 3m 1.4G 0.7p TO-72 r',
  '2N918 N 15 0.05 0.2 50 3m 900M 1.7p TO-72 r',
  '2N3866 N 30 0.4 1 50 50m 700M 3p TO-39 r',
  '2N5109 N 20 0.4 2.5 70 50m 1.2G 3.5p TO-39 r',
  'BFR92A N 15 0.025 0.3 90 14m 5G 0.6p SOT-23 r',
  'BFR93A N 12 0.035 0.3 90 30m 6G 0.8p SOT-23 r',
  'BFR91 N 12 0.05 0.3 90 30m 5G 0.7p SOT-37 r',
  'BFR96 N 15 0.1 0.7 80 50m 5G 1.5p SOT-37 r',
  'BFR106 N 15 0.1 0.5 80 50m 5G 1.2p SOT-23 r',
  'BFR520 N 15 0.07 0.3 120 20m 9G 0.5p SOT-23 r',
  'BFG591 N 15 0.2 2 90 70m 7G 1.4p SOT-223 r',
  'BF199 N 25 0.025 0.5 40 7m 550M 0.3p TO-92 r',
  'BF494 N 20 0.03 0.5 100 1m 260M 0.8p TO-92 r',
  'BF495 N 20 0.03 0.5 50 1m 200M 0.8p TO-92 r',
  'BF240 N 40 0.025 0.3 70 1m 380M 0.3p TO-92 r',
  'BF241 N 40 0.025 0.3 50 1m 380M 0.3p TO-92 r',
  'BF959 N 20 0.1 0.625 70 20m 700M 1p TO-92 r',
  'BFT92 P 15 0.025 0.3 50 14m 5G 0.7p SOT-23 r',
  'BFT93 P 12 0.035 0.3 50 30m 5G 0.8p SOT-23 r',
  'S9018 N 15 0.05 0.4 100 1m 1.1G 1.3p TO-92 r',
  '2SC3355 N 12 0.1 0.6 120 20m 6.5G 0.65p TO-92 r',
  '2SC3356 N 12 0.1 0.2 120 20m 7G 0.65p SOT-23 r',
];

export const BJT_ROWS: BjtRow[] = ROWS_TEXT.map(row);

const clampv = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const p3 = (v: number) => Number(v.toPrecision(4));

/** Gummel-Poon card from a datasheet row (see the module header). */
export function fitBjt(name: string, r: Pick<BjtRow, 'pnp' | 'ic' | 'hfe' | 'icTest' | 'ft' | 'cob' | 'kind'>, vce = 5): ModelCard {
  const is = (0.1 * r.ic) / Math.exp(0.7 / VT);
  const vaf = r.kind === 'h' ? 200 : r.kind === 'p' ? 60 : 100;
  const ikf = 0.6 * r.ic;
  const ne = 1.5;
  // base charge at the test point: x = IS·exp(vbe/Vt) solves IC = x / qb(x)
  const ic = r.icTest;
  let x = ic;
  let vbe = 0.65;
  for (let k = 0; k < 60; k++) {
    vbe = VT * Math.log(x / is);
    const q1 = 1 / (1 + (vce - vbe) / vaf);
    const q2 = x / ikf;
    const qb = (q1 * (1 + Math.sqrt(1 + 4 * q2))) / 2;
    x = ic * qb;
  }
  vbe = VT * Math.log(x / is);
  const ib = ic / r.hfe;
  const bf = x / (0.9 * ib);
  const ise = (0.1 * ib) / Math.exp(vbe / (ne * VT));
  const cjc = r.cob * Math.pow(1 + 10 / 0.75, 0.33);
  const cje = 2.5 * cjc;
  const tf = Math.max(0.2 / (2 * Math.PI * r.ft), 1 / (2 * Math.PI * r.ft) - ((cje + cjc) * VT) / ic);
  return card(name, r.pnp ? 'PNP' : 'NPN', {
    is: p3(is),
    bf: p3(bf),
    nf: 1,
    vaf,
    ikf: p3(ikf),
    ise: p3(ise),
    ne,
    br: r.kind === 'p' || r.kind === 'h' ? 5 : 2,
    nr: 1,
    rb: r.ic <= 0.2 ? 10 : r.ic <= 1.5 ? 5 : 2,
    re: p3(clampv(0.02 / r.ic, 0.005, 1)),
    rc: p3(clampv(0.25 / r.ic, 0.02, 3)),
    cje: p3(cje),
    vje: 0.75,
    mje: 0.33,
    cjc: p3(cjc),
    vjc: 0.75,
    mjc: 0.33,
    fc: 0.5,
    tf: p3(tf),
    tr: p3(clampv(50 * tf, 10e-9, 5e-6)),
    xtb: 1.5,
    eg: 1.11,
    xti: 3,
  });
}

const SYM = { npn: bjtSymbol(false), pnp: bjtSymbol(true), dnpn: bjtSymbol(false, { darlington: true }), dpnp: bjtSymbol(true, { darlington: true }) };

const KIND_EN: Record<BjtRow['kind'], string> = { s: 'small-signal', p: 'power', h: 'high-voltage', r: 'RF', d: 'Darlington' };
const KIND_VI: Record<BjtRow['kind'], string> = { s: 'tín hiệu nhỏ', p: 'công suất', h: 'cao áp', r: 'cao tần', d: 'Darlington' };

function specsOf(r: BjtRow): Record<string, number | string> {
  return { polarity: r.pnp ? 'PNP' : 'NPN', vceo: r.vceo, ic: r.ic, power: r.ptot, hfe: r.hfe, ft: r.ft, package: r.pkg };
}

function textOf(r: BjtRow): { en: string; vi: string } {
  const t = r.pnp ? 'PNP' : 'NPN';
  const tail = `${r.vceo} V / ${eng(r.ic, 'A')}, ${eng(r.ptot, 'W')}, hFE ≈ ${r.hfe} @ ${eng(r.icTest, 'A')}, fT ${eng(r.ft, 'Hz')}`;
  return { en: `${KIND_EN[r.kind]} ${t} transistor, ${tail}`.replace(/^./, (c) => c.toUpperCase()), vi: `Transistor ${t} ${KIND_VI[r.kind]}, ${tail}` };
}

function singleBjt(r: BjtRow): LibraryPartDef {
  const model = fitBjt(modelName(r.pn), r);
  const group: PartGroup = r.kind === 'r' ? 'rf' : 'transistors';
  const { en, vi } = textOf(r);
  return withMeta(
    {
      id: `${group}/${slug(r.pn)}`,
      name: r.pn,
      group,
      family: r.kind === 'r' ? 'RF transistor' : r.pnp ? 'PNP BJT' : 'NPN BJT',
      description: en,
      prefix: 'Q',
      symbol: r.pnp ? SYM.pnp : SYM.npn,
      params: [modelOverrideParam()],
      toSpice: (ctx) => {
        const m = modelOverride(ctx, model.name);
        return { elements: [elQ(ctx.name('Q'), ctx.node('C'), ctx.node('B'), ctx.node('E'), m)], models: m === model.name ? [model] : [] };
      },
      provenance: `MachSim Gummel-Poon fit to ${r.pn} datasheet figures: VCEO ${r.vceo} V, IC ${eng(r.ic, 'A')}, Ptot ${eng(r.ptot, 'W')}, hFE ≈ ${r.hfe} @ ${eng(r.icTest, 'A')} / 5 V, fT ${eng(r.ft, 'Hz')}, Cob ${eng(r.cob, 'F')} (approximate away from the test point)`,
      footprint: r.pkg,
      keywords: [r.pn.toLowerCase(), 'bjt', 'transistor', r.pnp ? 'pnp' : 'npn', KIND_EN[r.kind].toLowerCase()],
    },
    { vi, specs: specsOf(r), sortKey: r.vceo + r.ic / 1000, series: `BJT ${KIND_EN[r.kind]}` },
  );
}

function darlingtonPart(r: BjtRow): LibraryPartDef {
  const hfeOut = clampv(Math.sqrt(r.hfe) / 2, 15, 60);
  const hfeDrv = r.hfe / hfeOut;
  const power = r.ic > 1;
  const out = fitBjt(modelName(r.pn, 'OUT'), { pnp: r.pnp, ic: r.ic, hfe: hfeOut, icTest: r.icTest, ft: r.ft * 2, cob: r.cob, kind: power ? 'p' : 's' });
  const drv = fitBjt(modelName(r.pn, 'DRV'), { pnp: r.pnp, ic: r.ic / 10, hfe: hfeDrv, icTest: r.icTest / hfeOut, ft: r.ft * 4, cob: r.cob / 4, kind: 's' });
  const els = [elQ('Q1', 'c', 'b', 'm', drv.name), elQ('Q2', 'c', 'm', 'e', out.name)];
  const models = [drv, out];
  if (power) {
    const fw = card(modelName(r.pn, 'FW'), 'D', { is: 1e-12, n: 1, rs: 0.05, bv: r.vceo * 1.2, ibv: 1e-6, tt: 100e-9, cjo: 100e-12 });
    els.push(elR('R1', 'b', 'm', 8000), elR('R2', 'm', 'e', 120), r.pnp ? elD('DFW', 'c', 'e', fw.name) : elD('DFW', 'e', 'c', fw.name));
    models.push(fw);
  }
  const sub = subckt(modelName(r.pn), ['c', 'b', 'e'], els, models);
  const { en, vi } = textOf(r);
  const t = r.pnp ? 'PNP' : 'NPN';
  return withMeta(
    {
      id: `transistors/${slug(r.pn)}`,
      name: r.pn,
      group: 'transistors',
      family: `${t} Darlington`,
      description: en,
      prefix: 'Q',
      symbol: r.pnp ? SYM.dpnp : SYM.dnpn,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('C'), ctx.node('B'), ctx.node('E')], sub.name)], subckts: [sub] }),
      provenance: `MachSim Darlington subcircuit (driver β ≈ ${Math.round(hfeDrv)} × output β ≈ ${Math.round(hfeOut)}${power ? ', 8 kΩ / 120 Ω base-emitter resistors, freewheel diode' : ''}) fitted to ${r.pn} datasheet figures: VCEO ${r.vceo} V, IC ${eng(r.ic, 'A')}, hFE ≈ ${r.hfe} @ ${eng(r.icTest, 'A')}`,
      footprint: r.pkg,
      keywords: [r.pn.toLowerCase(), 'darlington', t.toLowerCase(), power ? 'power' : 'small signal'],
    },
    { vi, specs: specsOf(r), sortKey: r.vceo + r.ic / 1000, series: 'Darlington' },
  );
}

// ---------------------------------------------------------------------------------------------
// Darlington driver arrays (ULN200x / ULN280x style): channel i = IN i -> OUT i, emitters at GND,
// freewheel diodes from every OUT to COM

interface ArrayRow {
  pn: string;
  channels: number;
  rin: number;
  description: string;
  vi: string;
}

const ARRAYS: ArrayRow[] = [
  { pn: 'ULN2003A', channels: 7, rin: 2700, description: '7-channel Darlington sink driver, 50 V / 500 mA per channel, 2.7 kΩ inputs for 5 V logic', vi: 'Mảng 7 Darlington kéo xuống, 50 V / 500 mA mỗi kênh, điện trở vào 2.7 kΩ cho logic 5 V' },
  { pn: 'ULN2004A', channels: 7, rin: 10500, description: '7-channel Darlington sink driver, 50 V / 500 mA per channel, 10.5 kΩ inputs for 6–15 V CMOS', vi: 'Mảng 7 Darlington kéo xuống, 50 V / 500 mA mỗi kênh, điện trở vào 10.5 kΩ cho CMOS 6–15 V' },
  { pn: 'ULN2803A', channels: 8, rin: 2700, description: '8-channel Darlington sink driver, 50 V / 500 mA per channel, 2.7 kΩ inputs for 5 V logic', vi: 'Mảng 8 Darlington kéo xuống, 50 V / 500 mA mỗi kênh, điện trở vào 2.7 kΩ cho logic 5 V' },
  { pn: 'ULN2804A', channels: 8, rin: 10500, description: '8-channel Darlington sink driver, 50 V / 500 mA per channel, 10.5 kΩ inputs for 6–15 V CMOS', vi: 'Mảng 8 Darlington kéo xuống, 50 V / 500 mA mỗi kênh, điện trở vào 10.5 kΩ cho CMOS 6–15 V' },
];

function arrayPart(a: ArrayRow): LibraryPartDef {
  const drv = fitBjt(modelName(a.pn, 'DRV'), { pnp: false, ic: 0.05, hfe: 100, icTest: 5e-3, ft: 100e6, cob: 3e-12, kind: 's' });
  const out = fitBjt(modelName(a.pn, 'OUT'), { pnp: false, ic: 0.5, hfe: 30, icTest: 0.2, ft: 50e6, cob: 15e-12, kind: 's' });
  const fw = card(modelName(a.pn, 'FW'), 'D', { is: 1e-12, n: 1.5, rs: 0.5, bv: 60, ibv: 1e-6, tt: 50e-9, cjo: 15e-12 });
  const els = [
    elR('RIN', 'in', 'b', a.rin),
    elQ('Q1', 'out', 'b', 'm', drv.name),
    elQ('Q2', 'out', 'm', 'gnd', out.name),
    elR('RB1', 'b', 'm', 7200),
    elR('RB2', 'm', 'gnd', 3000),
    elD('DFW', 'out', 'com', fw.name),
    elD('DSUB', 'gnd', 'in', fw.name),
  ];
  const ch = subckt(modelName(a.pn, 'CH'), ['in', 'out', 'gnd', 'com'], els, [drv, out, fw]);
  const ins = Array.from({ length: a.channels }, (_, i) => ({ name: `IN${i + 1}`, number: String(i + 1), type: 'input' as const }));
  const outs = Array.from({ length: a.channels }, (_, i) => ({ name: `OUT${i + 1}`, number: String(2 * a.channels + 2 - i), type: 'output' as const }));
  const sym = boxSymbol({ w: 80, h: a.channels * 20 + 20, left: ins, right: outs, top: [{ name: 'COM', number: String(a.channels + 2), type: 'power' }], bottom: [{ name: 'GND', number: String(a.channels + 1), type: 'power' }], title: a.pn, titleSize: 8, titlePos: { x: 0, y: -a.channels * 10 - 2 } });
  return withMeta(
    {
      id: `transistors/${slug(a.pn)}`,
      name: a.pn,
      group: 'transistors',
      family: 'Transistor array',
      description: a.description,
      prefix: 'U',
      symbol: sym,
      params: [],
      optionalPins: [...ins.map((p) => p.name), ...outs.map((p) => p.name), 'COM'],
      toSpice: (ctx) => ({
        elements: Array.from({ length: a.channels }, (_, i) => elX(ctx.name('X', String(i + 1)), [ctx.node(`IN${i + 1}`), ctx.node(`OUT${i + 1}`), ctx.node('GND'), ctx.node('COM')], ch.name)),
        subckts: [ch],
      }),
      provenance: `MachSim channel subcircuit after the published ${a.pn} equivalent schematic: ${eng(a.rin, 'Ω')} input resistor, 7.2 kΩ / 3 kΩ base-emitter resistors, Darlington output, freewheel diode to COM`,
      footprint: a.channels === 7 ? 'DIP-16' : 'DIP-18',
      keywords: [a.pn.toLowerCase(), 'darlington array', 'relay driver', 'stepper driver', 'sink driver'],
    },
    { vi: a.vi, specs: { vceo: 50, ic: 0.5, package: a.channels === 7 ? 'DIP-16' : 'DIP-18' }, sortKey: a.channels, series: 'Darlington array' },
  );
}

export const BJT_CATALOG: LibraryPartDef[] = [...BJT_ROWS.map((r) => (r.kind === 'd' ? darlingtonPart(r) : singleBjt(r))), ...ARRAYS.map(arrayPart)];
