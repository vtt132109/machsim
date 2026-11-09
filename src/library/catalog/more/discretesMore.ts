/**
 * Discrete semiconductor breadth (round 4). A catalogue pack ('discretes-more', groups Diodes and
 * Transistors).
 *
 *   Zener diodes     the E24 series 2.4 – 75 V (and the 1N59xx 3 W series up to 200 V) in more makers'
 *                    series and packages: MMSZ52xx / BZT52C (SOD-123), MMBZ52xx (SOT-23), BZV55C /
 *                    ZMM / TZMC (MiniMELF), ZPD (DO-35), BZX85C (1.3 W, DO-41), 1N5913B…1N5956B
 *                    (3 W, DO-201AE) and 1SMB59xxB (3 W, SMB); 0.5 / 1.3 / 3 W
 *   LEDs             every colour in more sizes (8 mm, 5 × 2 mm, 3528, 5050, 0402, 3 W) and as 2 mA
 *                    low-current indicators
 *   BJTs, MOSFETs,   about 250 more part numbers through the row formats and fitted models of
 *   JFETs, IGBTs     bjts.ts / fets.ts, and the lead-free ("…PBF") and D2PAK ("…S") order codes of the
 *                    TO-220 power MOSFETs and the SOT-23 pin-out of the small-signal ones
 *
 * The Zener models are the three-element fit of src/library/parts/diodes.ts (VZ and ZZT from the
 * series' datasheet tables where the catalogue already holds them, the 1.3 W and 3 W series are
 * approximated from VZ and the power rating; the provenance of each part says which). Figures in the
 * new transistor tables are typical datasheet values rounded to one or two digits.
 */
import type { LibraryPartDef } from '../../partkit';
import { ALL_PARTS } from '../../parts';
import { ledBinding, ledFragment, ledIndicatorParams, ledModel, ledSymbol, zenerFragment } from '../../parts/diodes';
import { modelOverrideParam, eng, modelName, userNum, withMeta } from '../kit';
import { DIODE_CATALOG, IZT_1N52, LED_COLORS_EXT, V_1N52, V_BZX, ZENER_SYMBOL, ZZT_1N52, ZZT_BZX, bzxCode } from '../diodes';
import { THYRISTOR_CATALOG } from '../thyristors';
import { BJT_CATALOG, bjtRowFromText, darlingtonPart, singleBjt } from '../bjts';
import { FET_CATALOG, igbtFromText, jfetFromText, mosPart, mosRow } from '../fets';
import { repackage, variantId } from './variants';

const known = new Set<string>([...ALL_PARTS, ...DIODE_CATALOG, ...THYRISTOR_CATALOG, ...BJT_CATALOG, ...FET_CATALOG].map((p) => p.id));
const fresh = (parts: LibraryPartDef[]): LibraryPartDef[] => {
  const seen = new Set<string>();
  return parts.filter((p) => {
    if (known.has(p.id) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
};

// ---------------------------------------------------------------------------------------------
// Zener diodes

interface ZenerSeries {
  series: string;
  power: number;
  footprint: string;
  /** part number of the k-th value */
  pn(vz: number, k: number): string;
  values: number[];
  zzt(vz: number, k: number): number;
  izt(vz: number, k: number): number;
  table: string;
  approx?: string;
}

const E24_BZX_ZZT = (_vz: number, k: number): number => ZZT_BZX[k];
const E24_BZX_IZT = (vz: number): number => (vz <= 24 ? 5e-3 : 2e-3);
const zenerNumber = (vz: number): string => (vz < 10 ? vz.toFixed(1) : String(vz));

const V_3W = [3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1, 10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91, 100, 110, 120, 130, 150, 160, 180, 200];
const approx3W = (vz: number): number => Number((1.5 + 0.0006 * vz * vz).toPrecision(2));
const iztFromPower = (watts: number, k: number) => (vz: number): number => Number(((watts * k) / vz).toPrecision(2));
const BZX85_VALUES = V_BZX.filter((v) => v >= 3.3 && v <= 75);

const ZENER_MORE: ZenerSeries[] = [
  { series: 'MMSZ52xxB', power: 0.5, footprint: 'SOD-123', table: 'MMSZ5221B–MMSZ5267B', values: V_1N52, pn: (_v, k) => `MMSZ${5221 + k}B`, zzt: (_v, k) => ZZT_1N52[k], izt: (_v, k) => IZT_1N52[k] * 1e-3 },
  { series: 'MMBZ52xxB', power: 0.225, footprint: 'SOT-23', table: 'MMBZ5221B–MMBZ5267B', values: V_1N52, pn: (_v, k) => `MMBZ${5221 + k}B`, zzt: (_v, k) => ZZT_1N52[k], izt: (_v, k) => IZT_1N52[k] * 1e-3 },
  { series: 'BZT52C', power: 0.5, footprint: 'SOD-123', table: 'BZT52C2V4–BZT52C75', values: V_BZX, pn: (v) => `BZT52C${bzxCode(v)}`, zzt: E24_BZX_ZZT, izt: E24_BZX_IZT },
  { series: 'BZV55C', power: 0.5, footprint: 'SOD-80', table: 'BZV55C2V4–BZV55C75', values: V_BZX, pn: (v) => `BZV55C${bzxCode(v)}`, zzt: E24_BZX_ZZT, izt: E24_BZX_IZT },
  { series: 'ZMM', power: 0.5, footprint: 'SOD-80', table: 'ZMM2V4–ZMM75', values: V_BZX, pn: (v) => `ZMM${bzxCode(v)}`, zzt: E24_BZX_ZZT, izt: E24_BZX_IZT },
  { series: 'TZMC', power: 0.5, footprint: 'SOD-80', table: 'TZMC2V4–TZMC75', values: V_BZX, pn: (v) => `TZMC${bzxCode(v)}`, zzt: E24_BZX_ZZT, izt: E24_BZX_IZT },
  { series: 'ZPD', power: 0.5, footprint: 'DO-35', table: 'ZPD2.4–ZPD75', values: V_BZX, pn: (v) => `ZPD${zenerNumber(v)}`, zzt: E24_BZX_ZZT, izt: E24_BZX_IZT },
  {
    series: 'BZX85C',
    power: 1.3,
    footprint: 'DO-41',
    table: 'BZX85C3V3–BZX85C75',
    values: BZX85_VALUES,
    pn: (v) => `BZX85C${bzxCode(v)}`,
    zzt: (v) => Number(((ZZT_BZX[V_BZX.indexOf(v)] ?? 20) / 4).toPrecision(2)),
    izt: iztFromPower(1.3, 0.2),
    approx: 'ZZT and IZT approximated from the 0.5 W series and the 1.3 W rating',
  },
  { series: '1N59xxB', power: 3, footprint: 'DO-201AE', table: '1N5913B–1N5956B', values: V_3W, pn: (_v, k) => `1N${5913 + k}B`, zzt: approx3W, izt: iztFromPower(3, 0.125), approx: 'ZZT and IZT approximated from VZ and the 3 W rating' },
  { series: '1SMB59xxB', power: 3, footprint: 'SMB', table: '1SMB5913B–1SMB5956B', values: V_3W, pn: (_v, k) => `1SMB${5913 + k}B`, zzt: approx3W, izt: iztFromPower(3, 0.125), approx: 'ZZT and IZT approximated from VZ and the 3 W rating' },
];

function zenerPart(s: ZenerSeries, vz: number, k: number): LibraryPartDef {
  const pn = s.pn(vz, k);
  const izt = s.izt(vz, k);
  const zzt = s.zzt(vz, k);
  const z = { vz, izt, zzt, cjo: Number(((730e-12 * s.power) / Math.sqrt(vz)).toPrecision(2)) };
  return withMeta(
    {
      id: `diodes/${pn.toLowerCase()}`,
      name: pn,
      group: 'diodes',
      family: 'Zener diode',
      description: `${vz} V ${s.power} W Zener diode (IZT = ${eng(izt, 'A')}, ZZT = ${zzt} Ω), ${s.series} series`,
      prefix: 'D',
      symbol: ZENER_SYMBOL,
      params: [],
      toSpice: (ctx) => zenerFragment(ctx, pn.replace(/[^A-Za-z0-9]/g, '_'), z),
      provenance: `MachSim three-element Zener fit for the ${s.table} series: VZ = ${vz} V and ZZT = ${zzt} Ω at IZT = ${eng(izt, 'A')}${s.approx ? ` (${s.approx})` : ''}; capacitance approximate`,
      footprint: s.footprint,
      keywords: [pn.toLowerCase(), 'zener', `${vz}v`, s.series.toLowerCase()],
    },
    { vi: `Diode Zener ${vz} V ${s.power} W (IZT = ${eng(izt, 'A')}, ZZT = ${zzt} Ω), dãy ${s.series}`, specs: { vz, power: s.power, package: s.footprint }, sortKey: vz + s.power / 100, series: s.series },
  );
}

export const ZENERS_MORE: LibraryPartDef[] = fresh(ZENER_MORE.flatMap((s) => s.values.map((v, k) => zenerPart(s, v, k))));

// ---------------------------------------------------------------------------------------------
// LEDs

interface LedSize {
  slug: string;
  label: string;
  footprint: string;
  ifwd: number;
  rs: number;
  dvf: number;
}

const LED_SIZES_MORE: LedSize[] = [
  { slug: '8mm', label: '8 mm', footprint: 'LED-8MM', ifwd: 20e-3, rs: 3, dvf: 0 },
  { slug: '5x2', label: '5 × 2 mm rectangular', footprint: 'LED-RECT-5X2', ifwd: 20e-3, rs: 3, dvf: 0 },
  { slug: '0402', label: 'SMD 0402', footprint: 'LED-0402', ifwd: 10e-3, rs: 8, dvf: 0.05 },
  { slug: '3528', label: 'SMD 3528', footprint: 'LED-3528', ifwd: 20e-3, rs: 4, dvf: 0.05 },
  { slug: '5050', label: 'SMD 5050', footprint: 'LED-5050', ifwd: 60e-3, rs: 2, dvf: 0.15 },
  { slug: '3w', label: '3 W', footprint: 'LED-STAR-1W', ifwd: 700e-3, rs: 0.5, dvf: 0.5 },
];

const LOW_CURRENT_COLORS = ['red', 'green', 'yellow', 'orange', 'blue', 'white'];
const LOW_CURRENT_SIZES: LedSize[] = [
  { slug: '3mm', label: '3 mm', footprint: 'LED-3MM', ifwd: 2e-3, rs: 3, dvf: -0.1 },
  { slug: '5mm', label: '5 mm', footprint: 'LED-5MM', ifwd: 2e-3, rs: 3, dvf: -0.1 },
  { slug: '0603', label: 'SMD 0603', footprint: 'LED-0603', ifwd: 2e-3, rs: 5, dvf: -0.05 },
  { slug: '0805', label: 'SMD 0805', footprint: 'LED-0805', ifwd: 2e-3, rs: 4, dvf: -0.05 },
];

type Led = (typeof LED_COLORS_EXT)[number];

function ledPart(c: Led, p: LedSize, lowCurrent: boolean): LibraryPartDef {
  const vf = Number((c.vf + p.dvf).toFixed(2));
  const tag = lowCurrent ? '-2ma' : '';
  const idTag = `${c.slug}-${p.slug}${tag}`;
  const model = ledModel(modelName(`LED_${idTag.replace(/-/g, '_')}`), vf, p.ifwd, c.n, p.rs);
  const label = lowCurrent ? `${p.label} low-current` : p.label;
  const params = ledIndicatorParams(c.glow).map((d) => (d.key === 'imax' ? { ...d, default: userNum(p.ifwd) } : d.key === 'ion' && lowCurrent ? { ...d, default: '0.1m' } : d));
  return withMeta(
    {
      id: `diodes/led-${idTag}`,
      name: `LED ${c.en} ${label}`,
      group: 'diodes',
      family: 'LED',
      description: `${c.en} LED (${c.wavelength}), ${label}, VF ≈ ${vf} V @ ${eng(p.ifwd, 'A')}`,
      prefix: 'LED',
      symbol: ledSymbol(c.css),
      params: [...params, modelOverrideParam()],
      toSpice: (ctx) => ledFragment(ctx, model),
      indicator: { kind: 'led', signal: 'current' },
      ...ledBinding,
      provenance: `MachSim fit: typical ${label} ${c.en.toLowerCase()} LED, VF = ${vf} V @ ${eng(p.ifwd, 'A')} (N = ${c.n}, RS = ${p.rs} Ω), VR(max) 5 V`,
      footprint: p.footprint,
      keywords: ['led', 'light emitting diode', c.en.toLowerCase(), label.toLowerCase(), 'indicator', ...(lowCurrent ? ['2 ma', 'low current'] : [])],
    },
    {
      vi: `LED ${c.vi} (${c.wavelength}), ${lowCurrent ? `${p.label} dòng thấp` : p.label}, VF ≈ ${vf} V @ ${eng(p.ifwd, 'A')}`,
      nameVi: `LED ${c.vi} ${lowCurrent ? `${p.label} dòng thấp` : p.label}`,
      specs: { color: c.en, package: p.label, vf, irating: p.ifwd },
      sortKey: 1000 + LED_COLORS_EXT.indexOf(c) * 10 + (lowCurrent ? 100 : 0) + LED_SIZES_MORE.indexOf(p),
      series: lowCurrent ? 'LED low-current' : 'LED',
    },
  );
}

export const LEDS_MORE: LibraryPartDef[] = fresh([
  ...LED_COLORS_EXT.flatMap((c) => LED_SIZES_MORE.map((p) => ledPart(c, p, false))),
  ...LED_COLORS_EXT.filter((c) => LOW_CURRENT_COLORS.includes(c.slug)).flatMap((c) => LOW_CURRENT_SIZES.map((p) => ledPart(c, p, true))),
]);

// ---------------------------------------------------------------------------------------------
// bipolar transistors: "pn pol VCEO IC Ptot hFE IC(test) fT Cob package kind"

const abc = (base: string, pol: string, vceo: number, ic: string, ptot: string, icT: string, ft: string, cob: string, pkg: string, kind: string, grades: [string, number][]): string[] =>
  grades.map(([g, hfe]) => `${base}${g} ${pol} ${vceo} ${ic} ${ptot} ${hfe} ${icT} ${ft} ${cob} ${pkg} ${kind}`);
const A: [string, number][] = [['A', 180]];
const B: [string, number][] = [['B', 290]];
const AB: [string, number][] = [['A', 180], ['B', 290]];
const BC: [string, number][] = [['B', 290], ['C', 520]];
const ABC: [string, number][] = [['A', 180], ['B', 290], ['C', 520]];

const BJT_MORE_TEXT: string[] = [
  // TO-92 and metal-can classics
  'BC547B N 45 0.1 0.5 290 2m 300M 2.5p TO-92 s',
  'BC557B P 45 0.1 0.5 290 2m 150M 4.5p TO-92 s',
  'BC546 N 65 0.1 0.5 250 2m 300M 2.5p TO-92 s',
  'BC547 N 45 0.1 0.5 250 2m 300M 2.5p TO-92 s',
  'BC548 N 30 0.1 0.5 250 2m 300M 2.5p TO-92 s',
  'BC556 P 65 0.1 0.5 200 2m 150M 4.5p TO-92 s',
  'BC557 P 45 0.1 0.5 200 2m 150M 4.5p TO-92 s',
  'BC558 P 30 0.1 0.5 200 2m 150M 4.5p TO-92 s',
  'BC337 N 45 0.8 0.625 250 100m 210M 12p TO-92 s',
  'BC338 N 25 0.8 0.625 250 100m 210M 12p TO-92 s',
  'BC327 P 45 0.8 0.625 250 100m 100M 12p TO-92 s',
  'BC328 P 25 0.8 0.625 250 100m 100M 12p TO-92 s',
  ...abc('BC107', 'N', 45, '0.1', '0.3', '2m', '300M', '4p', 'TO-18', 's', AB),
  ...abc('BC108', 'N', 20, '0.1', '0.3', '2m', '300M', '4p', 'TO-18', 's', ABC),
  ...abc('BC109', 'N', 20, '0.1', '0.3', '2m', '300M', '4p', 'TO-18', 's', BC),
  ...abc('BC177', 'P', 45, '0.1', '0.3', '2m', '150M', '6p', 'TO-18', 's', AB),
  ...abc('BC178', 'P', 25, '0.1', '0.3', '2m', '150M', '6p', 'TO-18', 's', B),
  ...abc('BC179', 'P', 20, '0.1', '0.3', '2m', '150M', '6p', 'TO-18', 's', B),
  ...abc('BC237', 'N', 45, '0.1', '0.5', '2m', '300M', '2.5p', 'TO-92', 's', ABC),
  ...abc('BC238', 'N', 20, '0.1', '0.5', '2m', '300M', '2.5p', 'TO-92', 's', ABC),
  ...abc('BC239', 'N', 20, '0.1', '0.5', '2m', '300M', '2.5p', 'TO-92', 's', BC),
  ...abc('BC307', 'P', 45, '0.1', '0.5', '2m', '150M', '4.5p', 'TO-92', 's', AB),
  ...abc('BC308', 'P', 25, '0.1', '0.5', '2m', '150M', '4.5p', 'TO-92', 's', ABC),
  ...abc('BC309', 'P', 20, '0.1', '0.5', '2m', '150M', '4.5p', 'TO-92', 's', BC),
  'BC182 N 50 0.2 0.35 200 2m 150M 4p TO-92 s',
  'BC183 N 30 0.2 0.35 200 2m 150M 4p TO-92 s',
  'BC184 N 30 0.2 0.35 350 2m 150M 4p TO-92 s',
  'BC212 P 50 0.2 0.35 200 2m 200M 6p TO-92 s',
  'BC213 P 30 0.2 0.35 200 2m 200M 6p TO-92 s',
  'BC214 P 30 0.2 0.35 350 2m 200M 6p TO-92 s',
  'BC140-10 N 40 1 3.7 63 100m 250M 15p TO-39 s',
  'BC140-16 N 40 1 3.7 100 100m 250M 15p TO-39 s',
  'BC160-10 P 40 1 3.7 63 100m 150M 25p TO-39 s',
  'BC160-16 P 40 1 3.7 100 100m 150M 25p TO-39 s',
  'BC517 N 30 1.2 0.625 30000 10m 200M 5p TO-92 d',
  'BC516 P 30 1.2 0.625 30000 10m 200M 7p TO-92 d',
  'BC875 N 45 1 0.8 10000 100m 200M 5p TO-92 d',
  'BC876 P 45 1 0.8 10000 100m 200M 7p TO-92 d',
  'KSP2222A N 40 0.6 0.625 200 150m 300M 8p TO-92 s',
  'KSP2907A P 60 0.6 0.625 200 150m 200M 8p TO-92 s',
  'KSP42 N 300 0.5 0.625 40 10m 50M 3p TO-92 h',
  'KSP92 P 300 0.5 0.625 40 10m 50M 6p TO-92 h',
  'KSP44 N 400 0.3 0.625 50 10m 20M 3p TO-92 h',
  'KSP94 P 400 0.3 0.625 50 10m 20M 6p TO-92 h',
  'KSP13 N 30 0.5 0.625 10000 100m 125M 5p TO-92 d',
  'KSP14 N 30 0.5 0.625 20000 100m 125M 5p TO-92 d',
  '2N2222A N 40 0.8 0.5 200 150m 300M 8p TO-18 s',
  '2N2907A P 60 0.6 0.4 200 150m 200M 8p TO-18 s',
  '2N3053A N 60 0.7 1 120 150m 100M 15p TO-39 s',
  '2N4033 P 80 1 0.8 100 500m 150M 20p TO-39 s',
  '2N5320 N 75 2 10 80 500m 50M 25p TO-39 s',
  '2N5322 P 75 2 10 60 500m 50M 40p TO-39 s',
  '2N718A N 40 0.15 0.5 40 10m 50M 5p TO-18 s',
  '2N930 N 45 0.03 0.6 200 10u 30M 8p TO-18 s',
  // SMD small signal
  ...abc('BCW60', 'N', 32, '0.1', '0.25', '2m', '125M', '4.5p', 'SOT-23', 's', [['A', 150], ['B', 250], ['C', 400], ['D', 600]]),
  ...abc('BCW61', 'P', 32, '0.1', '0.25', '2m', '125M', '6p', 'SOT-23', 's', [['A', 150], ['B', 250], ['C', 400], ['D', 600]]),
  ...abc('BCW65', 'N', 32, '0.8', '0.35', '100m', '100M', '10p', 'SOT-23', 's', [['A', 160], ['B', 250], ['C', 400]]),
  ...abc('BCW66', 'N', 45, '0.8', '0.35', '100m', '100M', '10p', 'SOT-23', 's', [['F', 160], ['G', 250], ['H', 400]]),
  ...abc('BCW68', 'P', 45, '0.8', '0.35', '100m', '100M', '12p', 'SOT-23', 's', [['F', 160], ['G', 250], ['H', 400]]),
  ...abc('BCW69', 'P', 45, '0.1', '0.25', '2m', '150M', '4.5p', 'SOT-23', 's', [['', 250]]),
  ...abc('BCW70', 'P', 45, '0.1', '0.25', '2m', '150M', '4.5p', 'SOT-23', 's', [['', 250]]),
  ...abc('BCX56', 'N', 80, '1', '1.3', '150m', '130M', '10p', 'SOT-89', 's', [['-10', 100], ['-16', 160]]),
  ...abc('BCX53', 'P', 80, '1', '1.3', '150m', '130M', '15p', 'SOT-89', 's', [['-10', 100], ['-16', 160]]),
  ...abc('BCP56', 'N', 80, '1', '1.3', '150m', '130M', '10p', 'SOT-223', 's', [['-10', 100], ['-16', 160]]),
  ...abc('BCP53', 'P', 80, '1', '1.3', '150m', '130M', '15p', 'SOT-223', 's', [['-10', 100], ['-16', 160]]),
  'BCP68 N 20 1 1.3 100 500m 100M 12p SOT-223 s',
  'BCP69 P 20 1 1.3 100 500m 100M 18p SOT-223 s',
  'BCV46 P 60 0.5 0.3 10000 100m 200M 6p SOT-23 d',
  'BCV47 N 60 0.5 0.3 10000 100m 200M 5p SOT-23 d',
  'BSR14 N 40 0.8 0.35 100 150m 250M 8p SOT-23 s',
  'BSR17 N 40 0.8 0.35 100 150m 250M 8p SOT-23 s',
  'MMBT918 N 15 0.05 0.225 20 3m 600M 1.7p SOT-23 r',
  'MMBTA06 N 80 0.5 0.225 100 100m 100M 6p SOT-23 s',
  'MMBTA42 N 300 0.5 0.225 40 10m 50M 3p SOT-23 h',
  'MMBTA92 P 300 0.5 0.225 40 10m 50M 6p SOT-23 h',
  'MMBTA13 N 30 0.3 0.225 10000 100m 125M 8p SOT-23 d',
  'MMBT2369A N 15 0.2 0.225 60 10m 500M 4p SOT-23 s',
  'MMBT5088 N 30 0.1 0.225 350 1m 50M 4p SOT-23 s',
  'MMBT5089 N 25 0.1 0.225 450 1m 50M 4p SOT-23 s',
  'MMBT3640 P 12 0.08 0.225 30 10m 500M 3.5p SOT-23 s',
  'MMBTH10 N 25 0.05 0.225 60 4m 650M 0.7p SOT-23 r',
  // power
  '2N3055 N 60 15 115 40 4 2.5M 600p TO-3 p',
  '2N3054 N 55 4 25 100 500m 3M 100p TO-66 p',
  '2N3771 N 40 30 150 30 15 200k 700p TO-3 p',
  '2N5629 N 100 16 200 40 8 1M 500p TO-3 p',
  '2N6284 N 100 20 160 2000 10 4M 400p TO-3 d',
  '2N6287 P 100 20 160 2000 10 4M 500p TO-3 d',
  'BD139 N 80 1.5 12.5 100 150m 190M 30p TO-126 p',
  'BD140 P 80 1.5 12.5 100 150m 150M 40p TO-126 p',
  'BD139-10 N 80 1.5 12.5 63 150m 190M 30p TO-126 p',
  'BD139-16 N 80 1.5 12.5 100 150m 190M 30p TO-126 p',
  'BD140-10 P 80 1.5 12.5 63 150m 150M 40p TO-126 p',
  'BD140-16 P 80 1.5 12.5 100 150m 150M 40p TO-126 p',
  'BD131 N 45 3 15 40 500m 60M 50p TO-126 p',
  'BD132 P 45 3 15 40 500m 60M 70p TO-126 p',
  'BD179 N 80 3 30 40 500m 3M 60p TO-126 p',
  'BD180 P 80 3 30 40 500m 3M 80p TO-126 p',
  'BD165 N 45 1.5 20 40 150m 3M 50p TO-126 p',
  'BD166 P 45 1.5 20 40 150m 3M 70p TO-126 p',
  'TIP31C N 100 3 40 25 1 3M 100p TO-220 p',
  'TIP32C P 100 3 40 25 1 3M 120p TO-220 p',
  'TIP120 N 60 5 65 1000 3 1M 150p TO-220 d',
  'TIP125 P 60 5 65 1000 3 1M 200p TO-220 d',
  'BDW93C N 100 12 80 750 5 3M 200p TO-220 d',
  'BDW94C P 100 12 80 750 5 3M 300p TO-220 d',
  'BDX53C N 100 8 60 750 3 3M 100p TO-220 d',
  'BDX54C P 100 8 60 750 3 3M 150p TO-220 d',
  'BDV65B N 100 10 125 1000 5 1M 200p TO-247 d',
  'BDV64B P 100 10 125 1000 5 1M 300p TO-247 d',
  'MJE3055 N 60 10 75 20 4 2M 200p TO-220 p',
  'MJE2955 P 60 10 75 20 4 2M 300p TO-220 p',
  'MJE5740 N 300 8 80 30 2 8M 150p TO-220 h',
  'MJE18004 N 450 5 75 20 1 13M 70p TO-220 h',
  'MJE18006 N 450 6 100 20 1.5 14M 90p TO-220 h',
  'MJE13001 N 400 0.2 1 20 100m 4M 12p TO-92 h',
  'BU406 N 200 7 60 30 2 10M 80p TO-220 h',
  'BU508A N 700 8 125 4 4.5 7M 100p TO-3 h',
  'BU2508AF N 700 8 45 6 4.5 7M 100p TO-3P h',
  'BUL128 N 400 4 40 22 800m 14M 50p TO-220 h',
  'BUT11 N 400 5 100 20 1 20M 60p TO-220 h',
  'BUX84 N 400 2 40 40 200m 15M 30p TO-220 h',
  // Japanese complementary audio / small-signal
  'KTC3198 N 50 0.15 0.625 200 2m 130M 3p TO-92 s',
  'KTA1266 P 50 0.15 0.625 200 2m 80M 4p TO-92 s',
  '2SC1815 N 50 0.15 0.4 200 2m 80M 2p TO-92 s',
  '2SA1015 P 50 0.15 0.4 200 2m 80M 4p TO-92 s',
  '2SC2240 N 120 0.1 0.3 300 2m 100M 3p TO-92 s',
  '2SA970 P 120 0.1 0.3 300 2m 100M 5p TO-92 s',
  '2SC2705 N 150 0.05 0.8 200 2m 200M 2.5p TO-92 s',
  '2SA1145 P 150 0.05 0.8 200 2m 180M 3p TO-92 s',
  '2SC3503 N 300 0.1 7 80 20m 150M 4p TO-126 h',
  '2SA1381 P 300 0.1 7 80 20m 150M 6p TO-126 h',
  '2SC2458 N 50 0.15 0.2 200 2m 100M 3p SOT-23 s',
  '2SC1473 N 50 0.7 0.9 150 100m 150M 12p TO-92 s',
  '2SD1273 N 100 3 30 4000 1 20M 40p TO-220 d',
  '2SB1560 P 100 10 80 5000 5 20M 200p TO-247 d',
  '2SD2560 N 100 10 80 5000 5 20M 160p TO-247 d',
  '2SC3955 N 150 0.5 1 120 100m 170M 5p TO-92 s',
  '2SC4793A N 230 1 20 100 100m 100M 20p TO-220 p',
  '2SA1837A P 230 1 20 100 100m 70M 25p TO-220 p',
  '2SC5171 N 180 2 20 100 200m 200M 30p TO-220 p',
  '2SA1930 P 180 2 20 100 200m 200M 40p TO-220 p',
];

export const BJTS_MORE: LibraryPartDef[] = fresh(BJT_MORE_TEXT.map(bjtRowFromText).map((r) => (r.kind === 'd' ? darlingtonPart(r) : singleBjt(r))));

// ---------------------------------------------------------------------------------------------
// MOSFETs: "pn ch VDS ID RDS(on) VGS@RDS Vth Ciss Crss Coss Pd package"

const MOS_MORE_TEXT: string[] = [
  // power N-channel TO-220
  'IRFZ14 N 60 10 0.2 10 3 330p 56p 160p 43 TO-220',
  'IRFZ24 N 60 17 0.1 10 3 640p 100p 360p 60 TO-220',
  'IRFZ34 N 60 30 0.05 10 3 1.2n 190p 540p 88 TO-220',
  'IRFZ44 N 60 50 0.028 10 3 1.9n 200p 780p 150 TO-220',
  'IRFZ44N N 55 49 0.0175 10 3 1.47n 160p 360p 94 TO-220',
  'IRFZ46 N 50 50 0.024 10 3 1.9n 210p 760p 150 TO-220',
  'IRF540N N 100 33 0.044 10 3 1.96n 40p 250p 130 TO-220',
  'IRF740A N 400 10 0.55 10 3 1.1n 20p 190p 125 TO-220',
  'IRFB3077 N 75 210 0.0033 10 3 9.4n 270p 800p 370 TO-220',
  'IRFB4310 N 100 140 0.0056 10 3 7.67n 300p 590p 250 TO-220',
  'IRFB3206 N 60 120 0.003 10 3 6.54n 270p 720p 300 TO-220',
  'IRFB3607 N 75 80 0.009 10 3 3.1n 110p 290p 140 TO-220',
  'IRFB4115 N 150 104 0.0093 10 3 5.27n 160p 390p 380 TO-220',
  'IRFB4227 N 200 65 0.0197 10 3 4.6n 150p 450p 330 TO-220',
  'IRFB4620 N 200 25 0.072 10 3 1.7n 100p 280p 144 TO-220',
  'IRFB5620 N 200 25 0.072 10 3 1.7n 100p 280p 144 TO-220',
  'IRFB260N N 200 56 0.04 10 3 3.9n 100p 590p 380 TO-220',
  'IRF3315 N 150 27 0.082 10 3 1.3n 130p 280p 94 TO-220',
  'IRF3415 N 150 43 0.042 10 3 2.4n 270p 590p 200 TO-220',
  'IRF2204 N 40 210 0.0036 10 3 8.2n 790p 2.2n 330 TO-220',
  'IRF3808 N 75 140 0.007 10 3 5.3n 310p 970p 330 TO-220',
  'IRF4104 N 40 120 0.0055 10 3 3.0n 260p 510p 140 TO-220',
  'IRF1010Z N 55 75 0.0075 10 3 2.8n 150p 390p 140 TO-220',
  'IRF2907Z N 75 170 0.0045 10 3 7.5n 340p 1.0n 310 TO-220',
  'IRF3711 N 20 110 0.006 10 2 3.5n 410p 1.3n 120 TO-220',
  // logic-level N-channel
  'IRL540 N 100 28 0.077 5 1.5 1.7n 130p 650p 150 TO-220',
  'IRLZ14 N 60 10 0.2 5 1.5 400p 74p 170p 43 TO-220',
  'IRLZ24 N 60 17 0.1 5 1.5 880p 110p 360p 60 TO-220',
  'IRLZ34 N 60 30 0.05 5 1.5 1.5n 280p 690p 88 TO-220',
  'IRLZ44 N 60 50 0.028 5 1.5 3.3n 440p 1.1n 150 TO-220',
  'IRL3103 N 30 56 0.014 10 1.5 1.65n 190p 800p 94 TO-220',
  'IRL1004 N 40 130 0.0065 10 1.5 6.1n 220p 660p 200 TO-220',
  'IRL3303 N 30 38 0.026 4.5 1.5 1.65n 190p 470p 68 TO-220',
  'IRL2505 N 55 104 0.008 10 1.5 5.0n 340p 1.0n 200 TO-220',
  'IRLB3034 N 40 343 0.0017 10 1.5 10.3n 1.1n 2.1n 375 TO-220',
  'IRLB3813 N 30 260 0.0016 10 1.5 7.8n 880p 1.9n 230 TO-220',
  'STP55NF06L N 60 55 0.018 5 2 1.2n 130p 400p 110 TO-220',
  'STP36NF06L N 60 30 0.032 5 1.7 1.0n 70p 250p 70 TO-220',
  'FQP19N20C N 200 19 0.15 10 3 960p 14p 250p 150 TO-220',
  'FQP33N10 N 100 33 0.052 10 3 1.25n 80p 380p 127 TO-220',
  'FQP50N06L N 60 52 0.021 5 2 1.4n 110p 530p 121 TO-220',
  'FQP13N06L N 60 13 0.11 5 2 380p 30p 150p 45 TO-220',
  'FQP5N60C N 600 4.5 2.5 10 3 515p 5p 55p 100 TO-220',
  'FQP7N80C N 800 6.6 1.9 10 3 1.0n 12p 140p 167 TO-220',
  'FQPF30N06L N 60 22 0.035 5 2 800p 60p 330p 38 TO-220F',
  'FQPF13N50C N 500 13 0.48 10 3 1.8n 22p 200p 51 TO-220F',
  'IRFI540N N 100 20 0.052 10 3 1.96n 40p 250p 42 TO-220F',
  'IRFI640G N 200 9.8 0.18 10 3 1.3n 120p 430p 40 TO-220F',
  // P-channel
  'IRF9Z14 P 60 6.7 0.5 10 3 270p 42p 150p 43 TO-220',
  'IRF9Z24 P 60 11 0.28 10 3 570p 130p 280p 60 TO-220',
  'IRF9Z34 P 60 18 0.14 10 3 1.1n 190p 530p 88 TO-220',
  'IRF9540N P 100 23 0.117 10 3 1.45n 140p 460p 140 TO-220',
  'IRF9024N P 55 11 0.175 10 3 350p 92p 170p 38 TO-220',
  'FQP27P06 P 60 27 0.07 10 3 1.1n 160p 480p 120 TO-220',
  'FQP9P25 P 250 9.4 0.62 10 3 1.0n 70p 200p 120 TO-220',
  'FQP4P40 P 400 3.5 3.1 10 3 600p 45p 120p 85 TO-220',
  'STP80PF55 P 55 80 0.016 10 3 6.1n 410p 780p 300 TO-220',
  // small-signal SOT-23 / TO-92 / SO-8
  'BSS138 N 50 0.2 3.5 10 1.3 50p 5p 25p 0.36 SOT-23',
  'BSS84 P 50 0.13 10 5 1.7 27p 5p 13p 0.36 SOT-23',
  'BS170 N 60 0.5 5 10 2 40p 8p 30p 0.83 TO-92',
  'BS250 P 45 0.18 14 10 2.2 60p 14p 40p 0.83 TO-92',
  'NDS7002A N 60 0.28 2 10 2.1 40p 8p 20p 0.36 SOT-23',
  'NDS0610 P 60 0.12 10 10 2.2 25p 5p 14p 0.36 SOT-23',
  'FDN335N N 20 1.7 0.07 4.5 0.8 190p 25p 40p 0.5 SOT-23',
  'FDN340P P 20 2 0.07 4.5 0.8 340p 55p 60p 0.5 SOT-23',
  'FDV301N N 25 0.22 5 4.5 0.8 9.5p 1.5p 6p 0.35 SOT-23',
  'FDV302P P 25 0.12 13 4.5 0.8 11p 2p 7p 0.35 SOT-23',
  'AO3414 N 20 4.2 0.05 4.5 0.8 330p 50p 60p 1.4 SOT-23',
  'AO3415 P 20 4 0.05 4.5 0.7 740p 90p 100p 1.4 SOT-23',
  'AO3418 N 30 3.8 0.055 4.5 1.2 280p 30p 40p 1.4 SOT-23',
  'SI2300 N 30 3.6 0.063 4.5 1.2 280p 35p 50p 1.25 SOT-23',
  'SI2303 P 30 1.9 0.19 10 1.5 230p 40p 50p 1.25 SOT-23',
  'SI2305 P 8 3.5 0.052 4.5 0.6 500p 80p 100p 1.25 SOT-23',
  'SI2308 N 60 2.3 0.16 10 1.5 190p 20p 30p 1.25 SOT-23',
  'SI2312 N 20 4 0.04 4.5 0.8 450p 60p 75p 1.25 SOT-23',
  'IRLML5203 P 30 3 0.098 10 1.5 530p 100p 130p 1.25 SOT-23',
  'DMN2075U N 20 4.4 0.05 4.5 0.7 320p 40p 50p 1.4 SOT-23',
  'DMP2305U P 20 4.2 0.052 4.5 0.7 750p 90p 100p 1.4 SOT-23',
  'DMG2301L P 20 3 0.1 4.5 0.9 600p 70p 90p 1.4 SOT-23',
  'BSP89 N 240 0.35 6 10 1.8 150p 8p 20p 1.8 SOT-223',
  'BSP129 N 240 0.05 20 0 -1.4 75p 6p 16p 1.8 SOT-223',
  'BSP322P P 100 1 0.8 10 1.7 150p 20p 40p 1.8 SOT-223',
  'FDS6680A N 30 12.5 0.012 10 1.8 1.7n 190p 380p 2.5 SO-8',
  'FDS4435 P 30 8.8 0.02 10 1.8 1.7n 230p 440p 2.5 SO-8',
  'FDS6670A N 30 13.5 0.008 10 1.8 2.5n 280p 520p 2.5 SO-8',
  'SI4410 N 30 10 0.0135 10 1.5 1.6n 220p 400p 2.5 SO-8',
  'SI9435 P 30 5.3 0.05 10 1.5 800p 130p 250p 2.5 SO-8',
  'IRF7403 N 30 8.5 0.022 10 1 1.1n 150p 330p 2.5 SO-8',
  'IRF7406 P 30 5.8 0.045 10 1 800p 130p 270p 2.5 SO-8',
  'IRF7416 P 30 10 0.02 10 1 1.5n 270p 520p 2.5 SO-8',
  'IRF7314 P 20 5.3 0.058 4.5 0.7 840p 140p 330p 2 SO-8',
  'AO4407 P 30 12 0.012 10 1.8 2.4n 260p 400p 3.1 SO-8',
  'AO4468 N 30 10.5 0.017 10 1.8 1.1n 90p 230p 3.1 SO-8',
  'AO4410 N 30 18 0.007 10 1.8 2.3n 210p 450p 3.1 SO-8',
  // DPAK
  'IRFR024N N 55 17 0.075 10 3 370p 65p 140p 38 TO-252',
  'IRFR120N N 100 9.4 0.21 10 3 330p 53p 100p 39 TO-252',
  'IRFR220N N 200 5 0.6 10 3 310p 35p 85p 42 TO-252',
  'IRFR3910 N 100 16 0.115 10 3 480p 66p 130p 66 TO-252',
  'IRFR9024N P 55 11 0.175 10 3 350p 92p 170p 38 TO-252',
  'IRFR5305 P 55 31 0.065 10 3 1.2n 250p 520p 110 TO-252',
  'IRLR2905 N 55 42 0.027 10 1.5 1.7n 250p 430p 110 TO-252',
  'IRLR024N N 55 17 0.065 5 1.5 480p 60p 130p 45 TO-252',
];

const MOS_ROWS = MOS_MORE_TEXT.map(mosRow);
/** Pin numbers of the SOT-23 MOSFET (1 = G, 2 = S, 3 = D) and SOT-223 / SO-8 style packages are left as drawn. */
const SOT23_MOS = { G: '1', S: '2', D: '3' };

function mosBase(text: string): LibraryPartDef {
  const part = mosPart(mosRow(text));
  if (part.footprint === 'SOT-23') return { ...part, symbol: { ...part.symbol, pins: part.symbol.pins.map((p) => (SOT23_MOS[p.name as 'G' | 'S' | 'D'] !== undefined ? { ...p, number: SOT23_MOS[p.name as 'G' | 'S' | 'D'] } : p)) } };
  return part;
}

export const MOSFETS_MORE: LibraryPartDef[] = fresh(MOS_MORE_TEXT.map(mosBase));

// ---------------------------------------------------------------------------------------------
// JFETs: "pn ch IDSS VGS(off) Ciss Crss package"; IGBTs: "pn VCES IC VCE(sat) VGE(th) Cies package"

const JFET_MORE_TEXT = [
  '2N3820 P 15m -4 32p 8p TO-92',
  '2N3821 N 2.5m -2.5 6p 3p TO-18',
  '2N3822 N 5m -3 6p 3p TO-18',
  '2N3823 N 10m -4 6p 2p TO-18',
  '2N4856 N 50m -6 18p 8p TO-18',
  '2N5638 N 50m -6 10p 4p TO-92',
  '2N5639 N 25m -4 10p 4p TO-92',
  '2N5638A N 50m -6 10p 4p TO-92',
  'J210 N 5m -1.5 5p 1p TO-92',
  'J211 N 10m -2.5 5p 1p TO-92',
  'J212 N 15m -4 5p 1p TO-92',
  'J270 P 4m -1.5 20p 4p TO-92',
  'J271 P 8m -2.5 20p 4p TO-92',
  'J308 N 20m -2 6p 2p TO-92',
  'J310 N 40m -4 6p 2p TO-92',
  'PN4391 N 100m -7 14p 3.5p TO-92',
  'PN4392 N 50m -3.5 14p 3.5p TO-92',
  'PN4393 N 15m -1.7 14p 3.5p TO-92',
  'MMBF4391 N 100m -7 14p 3.5p SOT-23',
  'MMBF4392 N 50m -3.5 14p 3.5p SOT-23',
  'MMBF5457 N 3m -2 7p 3p SOT-23',
  'MMBFJ113 N 5m -1.5 19p 5p SOT-23',
  'MMBFJ177 P 5m -1.5 32p 8p SOT-23',
  'BF244A N 4m -1.5 4p 1.2p TO-92',
  'BF244B N 10m -2.5 4p 1.2p TO-92',
  'BF244C N 18m -4.5 4p 1.2p TO-92',
  'BF246A N 60m -6 9p 2.5p TO-92',
  'BF247A N 100m -8 9p 2.5p TO-92',
  'BFR30 N 10m -3 5p 1.5p SOT-23',
  'BFR31 N 5m -2.5 5p 1.5p SOT-23',
  '2SK184-GR N 4.5m -0.7 15p 3p TO-92',
  '2SK184-BL N 9m -1 15p 3p TO-92',
  '2SK246-GR N 4.5m -0.9 13p 3p TO-92',
  '2SK246-BL N 9m -1.1 13p 3p TO-92',
  '2SK363-GR N 4.5m -0.7 13p 3p TO-92',
  '2SJ103-GR P 4.5m -0.7 30p 6p TO-92',
  '2SJ103-BL P 9m -1 30p 6p TO-92',
];

const IGBT_MORE_TEXT = [
  'IRG4BC20KD 600 16 2.8 4.5 530p TO-220',
  'IRG4BC40K 600 42 2.1 4.5 2.2n TO-220',
  'IRG4BC40UD 600 40 1.7 4.5 2.2n TO-220',
  'IRG4PC30UD 600 23 1.95 4.5 1.1n TO-247',
  'IRG4PC40UD 600 40 1.7 4.5 2.2n TO-247',
  'IRG4PC60UD 600 75 1.65 4.5 4.2n TO-247',
  'IRG4PSC71UD 600 85 1.7 4.5 8.5n TO-247',
  'IRGB4059D 600 8 2.0 5 300p TO-220',
  'IRGB4060D 600 12 1.95 5 450p TO-220',
  'IRGP4066D 600 90 1.7 5 5.3n TO-247',
  'STGP10NC60KD 600 10 2.0 5 600p TO-220',
  'STGP20NC60VD 600 20 2.0 5 1.5n TO-220',
  'STGW40NC60VD 600 40 1.9 5 3.1n TO-247',
  'STGW60V60F 600 60 1.8 5.5 5n TO-247',
  'FGH40N60UFD 600 40 1.8 4.5 2.1n TO-247',
  'FGA40N65SMD 650 40 1.9 4.5 2.0n TO-247',
  'FGA60N65SMD 650 60 1.9 4.5 3.0n TO-247',
  'HGTP12N60A4D 600 23 2.0 5.5 1.0n TO-220',
  'HGTG30N60A4D 600 75 1.8 5.5 3.0n TO-247',
  'IKW25N120H3 1200 25 2.05 5.8 1.5n TO-247',
  'IKW15N120H3 1200 15 2.05 5.8 1.0n TO-247',
  'IKP20N60T 600 20 1.5 5 1.1n TO-220',
  'IKW20N60T 600 20 1.5 5 1.1n TO-247',
  'GT30J322 600 30 2.1 5 2.5n TO-3P',
  'GT60M303 900 60 2.2 5 5n TO-3P',
];

export const JFETS_MORE: LibraryPartDef[] = fresh(JFET_MORE_TEXT.map(jfetFromText));
export const IGBTS_MORE: LibraryPartDef[] = fresh(IGBT_MORE_TEXT.map(igbtFromText));

// ---------------------------------------------------------------------------------------------
// MOSFET order codes: "…PBF" (lead-free, same package) and "…S" (D2PAK) of the TO-220 power MOSFETs

/** Order codes of a power MOSFET in TO-220: lead-free marking and the D2PAK version. */
export function mosfetVariants(base: LibraryPartDef): LibraryPartDef[] {
  if (base.footprint !== 'TO-220' || !/^(IRF|IRL)/.test(base.name)) return [];
  const out: LibraryPartDef[] = [];
  const pbf = `${base.name}PBF`;
  out.push(repackage(base, { id: variantId(base, pbf), name: pbf, footprint: 'TO-220', pkg: 'TO-220', en: 'the lead-free (RoHS) TO-220 order code', vi: 'mã đặt hàng không chì (RoHS), vỏ TO-220', keywords: ['rohs', 'lead free', 'pbf'] }));
  const smd = `${base.name}S`;
  out.push(repackage(base, { id: variantId(base, smd), name: smd, footprint: 'TO-263-3', pkg: 'TO-263-3', en: 'the TO-263 (D2PAK) surface-mount version', vi: 'bản dán TO-263 (D2PAK)', keywords: ['d2pak', 'to-263', 'smd'] }));
  return out;
}

const mosBases = (): LibraryPartDef[] => [...(FET_CATALOG as LibraryPartDef[]), ...MOSFETS_MORE].filter((p) => p.family.endsWith('MOSFET') && !p.variantOf);

/** Everything of the pack. */
export const DISCRETES_MORE_CATALOG: LibraryPartDef[] = fresh([...ZENERS_MORE, ...LEDS_MORE, ...BJTS_MORE, ...MOSFETS_MORE, ...JFETS_MORE, ...IGBTS_MORE, ...mosBases().flatMap(mosfetVariants)]);
