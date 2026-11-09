/**
 * Sensors, optocouplers and displays (round 4, library breadth). A catalogue pack ('sensors-more',
 * groups Basic, Misc and Indicators).
 *
 *   NTC thermistors      R25 1 kΩ … 1 MΩ with B = 3380 / 3435 / 3950 / 4050 K, as a bead and as a
 *                        0603 chip; beta model R(T) = R25·exp(B·(1/T − 1/298.15 K)) with the same
 *                        interactive temperature slider as the generic NTC
 *   silicon PTC (KTY)    KTY81 / 82 / 84 families, linear R(T) = R25·(1 + α·(T − 25 °C))
 *   temperature ICs      LM35 grades and packages, TMP35 / TMP37, LM45 / LM50 / LM60, MCP9700 / 9701,
 *                        TC1047A: the datasheet scale factor and offset
 *   Hall sensors         SS49E, A1301 / A1302 linear and A3144 / US1881 / SS441 switches
 *   optocouplers         4N26 … 4N38, H11A1 … 5, CNY17-1 … 4, SFH615A, PC817 A … D, PC123, EL817,
 *                        LTV-817, TLP521 / 621 / 281 with their typical current-transfer ratio
 *   7-segment displays   common-anode / common-cathode digits 0.28 … 1.0 inch in six colours, and
 *                        the 10-segment bar graph in six colours
 *
 * The temperature curves are the datasheet equations; CTR values are the typical (or the middle of
 * the guaranteed) figure of each part and rank: check the maker's datasheet for the limits.
 */
import { elB, elR, ex, internalNode, type LibraryPartDef } from '../../partkit';
import { ALL_PARTS } from '../../parts';
import { optocoupler } from '../../parts/misc';
import type { ParamDef } from '../../types';
import { SENSOR_CATALOG, IC3_SYMBOL, keyParam, sensorMeta, slider, stepParam } from '../sensors';
import { eng, userNum, withMeta } from '../kit';
import { repackage, variantId } from './variants';

const core = (id: string): LibraryPartDef => {
  const p = ALL_PARTS.find((x) => x.id === id);
  if (!p) throw new Error(`core part ${id} not found`);
  return p as LibraryPartDef;
};

const known = new Set<string>([...ALL_PARTS, ...SENSOR_CATALOG].map((p) => p.id));
const fresh = (parts: LibraryPartDef[]): LibraryPartDef[] => {
  const seen = new Set<string>();
  return parts.filter((p) => {
    if (known.has(p.id) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
};

const withDefaults = (params: ParamDef[], defaults: Record<string, string>): ParamDef[] => params.map((d) => (defaults[d.key] !== undefined ? { ...d, default: defaults[d.key] } : d));

// ---------------------------------------------------------------------------------------------
// thermistors

const NTC_R25 = [1e3, 2.2e3, 4.7e3, 10e3, 22e3, 47e3, 100e3, 220e3, 470e3, 1e6];
const NTC_B = [3380, 3435, 3950, 4050];
const NTC_PACKAGES = [
  { slug: '', label: 'bead', labelVi: 'giọt', footprint: 'RES-RADIAL-100' },
  { slug: '-0603', label: '0603 chip', labelVi: 'chip 0603', footprint: 'R0603' },
];

function ntcPart(r25: number, b: number, pkg: (typeof NTC_PACKAGES)[number]): LibraryPartDef {
  const base = core('basic/ntc-thermistor');
  const name = `NTC ${userNum(r25)} B${b} ${pkg.label}`;
  return {
    ...base,
    id: `basic/ntc-${userNum(r25).toLowerCase()}-b${b}${pkg.slug}`,
    name,
    description: `NTC thermistor ${eng(r25, 'Ω')} at 25 °C, B = ${b} K, ${pkg.label}: R(T) = R25·exp(B·(1/T − 1/298.15 K)); the temperature is an interactive setting`,
    params: withDefaults(base.params, { r25: userNum(r25), beta: String(b) }),
    footprint: pkg.footprint,
    provenance: `Beta-parameter thermistor equation (standard textbook model) with R25 = ${eng(r25, 'Ω')} and B = ${b} K as a typical ${pkg.label} NTC; the maker's B(25/85) and tolerance vary`,
    keywords: ['ntc', 'thermistor', 'temperature sensor', userNum(r25).toLowerCase(), `b${b}`, pkg.label],
    specs: { resistance: r25, package: pkg.label },
    sortKey: r25 + b / 1e5,
    series: 'NTC thermistor',
    textVi: { name: `NTC ${userNum(r25)} B${b} ${pkg.labelVi}`, description: `Nhiệt điện trở NTC ${eng(r25, 'Ω')} ở 25 °C, B = ${b} K, ${pkg.labelVi}: R(T) = R25·exp(B·(1/T − 1/298,15 K)); nhiệt độ là thiết lập tương tác` },
  };
}

const KTY: [string, string, number, number, string][] = [
  ['KTY81-110', 'kty81-110', 1000, 0.0079, 'RES-RADIAL-100'],
  ['KTY81-120', 'kty81-120', 1000, 0.0079, 'RES-RADIAL-100'],
  ['KTY81-121', 'kty81-121', 1000, 0.0079, 'RES-RADIAL-100'],
  ['KTY81-122', 'kty81-122', 1000, 0.0079, 'RES-RADIAL-100'],
  ['KTY81-210', 'kty81-210', 2000, 0.0079, 'RES-RADIAL-100'],
  ['KTY81-220', 'kty81-220', 2000, 0.0079, 'RES-RADIAL-100'],
  ['KTY82-110', 'kty82-110', 1000, 0.0079, 'SOT-23'],
  ['KTY82-210', 'kty82-210', 2000, 0.0079, 'SOT-23'],
  ['KTY84-130', 'kty84-130', 1000, 0.0079, 'RES-RADIAL-100'],
  ['KTY10-6', 'kty10-6', 2000, 0.0077, 'RES-RADIAL-100'],
];

function ptcPart([name, slug, r25, alpha, footprint]: (typeof KTY)[number]): LibraryPartDef {
  const base = core('basic/ptc-thermistor');
  return {
    ...base,
    id: `basic/${slug}`,
    name,
    description: `${name} silicon temperature sensor (PTC), ${eng(r25, 'Ω')} at 25 °C, α ≈ ${(alpha * 100).toFixed(2)} %/°C: R(T) = R25·(1 + α·(T − 25 °C)); the temperature is an interactive setting`,
    params: withDefaults(base.params, { r25: userNum(r25), alpha: String(alpha) }),
    footprint,
    provenance: `Linear temperature-coefficient model of the ${name}: R25 = ${eng(r25, 'Ω')}, α = ${alpha * 100} %/°C (the real curve is slightly non-linear)`,
    keywords: [slug, 'kty', 'ptc', 'silicon', 'temperature sensor'],
    specs: { resistance: r25, package: footprint },
    sortKey: r25,
    series: 'Silicon PTC sensor',
    textVi: { description: `Cảm biến nhiệt silic ${name} (PTC), ${eng(r25, 'Ω')} ở 25 °C, α ≈ ${(alpha * 100).toFixed(2)} %/°C: R(T) = R25·(1 + α·(T − 25 °C)); nhiệt độ là thiết lập tương tác` },
  };
}

// ---------------------------------------------------------------------------------------------
// temperature ICs

type TempRow = [slug: string, pn: string, en: string, vi: string, f: (t: number) => number, tmin: number, tmax: number, footprint: string];

const TEMP_MORE: TempRow[] = [
  ['tmp35', 'TMP35', 'Low-voltage Celsius sensor: VOUT = 10 mV/°C · T', 'Cảm biến nhiệt thang Celsius điện áp thấp: VOUT = 10 mV/°C · T', (t) => 0.01 * t, 10, 125, 'TO-92'],
  ['tmp37', 'TMP37', 'Low-voltage Celsius sensor: VOUT = 20 mV/°C · T', 'Cảm biến nhiệt thang Celsius điện áp thấp: VOUT = 20 mV/°C · T', (t) => 0.02 * t, 5, 100, 'TO-92'],
  ['lm45', 'LM45', 'Celsius sensor: VOUT = 10 mV/°C · T', 'Cảm biến nhiệt thang Celsius: VOUT = 10 mV/°C · T', (t) => 0.01 * t, -20, 100, 'SOT-23'],
  ['lm50', 'LM50', 'Single-supply Celsius sensor: VOUT = 0.5 V + 10 mV/°C · T', 'Cảm biến nhiệt nguồn đơn: VOUT = 0,5 V + 10 mV/°C · T', (t) => 0.5 + 0.01 * t, -40, 125, 'SOT-23'],
  ['lm60', 'LM60', 'Single-supply Celsius sensor: VOUT = 424 mV + 6.25 mV/°C · T', 'Cảm biến nhiệt nguồn đơn: VOUT = 424 mV + 6,25 mV/°C · T', (t) => 0.424 + 0.00625 * t, -40, 125, 'SOT-23'],
  ['mcp9700', 'MCP9700', 'Linear active thermistor IC: VOUT = 0.5 V + 10 mV/°C · T', 'IC nhiệt tuyến tính: VOUT = 0,5 V + 10 mV/°C · T', (t) => 0.5 + 0.01 * t, -40, 125, 'SOT-23'],
  ['mcp9700a', 'MCP9700A', 'Linear active thermistor IC (±2 °C grade): VOUT = 0.5 V + 10 mV/°C · T', 'IC nhiệt tuyến tính (cấp ±2 °C): VOUT = 0,5 V + 10 mV/°C · T', (t) => 0.5 + 0.01 * t, -40, 125, 'SOT-23'],
  ['mcp9701', 'MCP9701', 'Linear active thermistor IC: VOUT = 0.4 V + 19.5 mV/°C · T', 'IC nhiệt tuyến tính: VOUT = 0,4 V + 19,5 mV/°C · T', (t) => 0.4 + 0.0195 * t, -40, 125, 'SOT-23'],
  ['mcp9701a', 'MCP9701A', 'Linear active thermistor IC (±2 °C grade): VOUT = 0.4 V + 19.5 mV/°C · T', 'IC nhiệt tuyến tính (cấp ±2 °C): VOUT = 0,4 V + 19,5 mV/°C · T', (t) => 0.4 + 0.0195 * t, -40, 125, 'SOT-23'],
  ['tc1047a', 'TC1047A', 'Precision temperature-to-voltage converter: VOUT = 0.5 V + 10 mV/°C · T', 'Bộ chuyển nhiệt độ sang điện áp chính xác: VOUT = 0,5 V + 10 mV/°C · T', (t) => 0.5 + 0.01 * t, -40, 125, 'SOT-23'],
];

function tempIc([slug, pn, en, vi, f, tmin, tmax, footprint]: TempRow): LibraryPartDef {
  return withMeta(
    {
      id: `misc/${slug}`,
      name: pn,
      group: 'misc',
      family: 'Temperature sensor',
      description: `${en}; key 'T' changes the temperature`,
      prefix: 'U',
      symbol: IC3_SYMBOL(pn),
      params: [slider('temp', 'Temperature', '25', '°C', tmin, tmax), keyParam('T'), stepParam('5')],
      interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
      toSpice: (ctx) => {
        const o = internalNode(ctx, 'o');
        const vo = f(ctx.num('temp'));
        return {
          elements: [
            elB(ctx.name('B'), o, ctx.node('GND'), 'V', `min(${ex(vo)},max(V(${ctx.node('+VS')},${ctx.node('GND')})-1,0))`),
            elR(ctx.name('R', 'o'), o, ctx.node('VOUT'), 1),
            elR(ctx.name('R', 'q'), ctx.node('+VS'), ctx.node('GND'), 80e3),
          ],
        };
      },
      provenance: `MachSim behavioural model of the ${pn} transfer function (datasheet scale factor and offset), output limited to VS − 1 V`,
      footprint,
      keywords: [pn.toLowerCase(), 'temperature sensor', 'analog temperature', 'interactive'],
    },
    sensorMeta(`${vi}; phím 'T' thay đổi nhiệt độ`, `Cảm biến nhiệt ${pn}`),
  );
}

/** LM35 grades and packages (same transfer function, other order codes). */
function lm35Variants(): LibraryPartDef[] {
  const base = core('misc/lm35') as LibraryPartDef;
  const list: [string, string, string, Record<string, string> | undefined][] = [
    ['LM35A', 'TO-46', 'TO-46 metal can, ±0.5 °C grade', undefined],
    ['LM35CA', 'TO-46', 'TO-46 metal can, ±0.5 °C grade, −40 … 110 °C', undefined],
    ['LM35C', 'TO-46', 'TO-46 metal can, ±1 °C grade, −40 … 110 °C', undefined],
    ['LM35CZ', 'TO-92', 'TO-92 plastic, ±1 °C grade, −40 … 110 °C', undefined],
    ['LM35DZ', 'TO-92', 'TO-92 plastic, ±1.5 °C grade, 0 … 100 °C', undefined],
    ['LM35DT', 'TO-220', 'TO-220 plastic, ±1.5 °C grade, 0 … 100 °C', undefined],
    ['LM35DM', 'SOIC-8', 'SOIC-8 surface-mount, ±1.5 °C grade, 0 … 100 °C', { GND: '4' }],
  ];
  return list.map(([name, footprint, en, renumber]) =>
    repackage(base, { id: variantId(base, name), name, footprint, pkg: footprint, en: `the ${en} version`, vi: `bản ${en}`, renumber, keywords: ['lm35', 'grade'] }),
  );
}

// ---------------------------------------------------------------------------------------------
// Hall sensors

function hallClone(baseId: string, slug: string, pn: string, defaults: Record<string, string>, en: string, vi: string, footprint = 'TO-92'): LibraryPartDef {
  const base = core(baseId);
  return {
    ...base,
    id: `misc/${slug}`,
    name: pn,
    description: `${pn}: ${en}`,
    params: withDefaults(base.params, defaults),
    footprint,
    keywords: [slug, 'hall', 'magnetic', 'interactive'],
    provenance: `${base.provenance ?? 'MachSim Hall sensor'}; parameters set to the typical ${pn} datasheet values`,
    textVi: { name: pn, description: `${pn}: ${vi}` },
    specs: { package: footprint },
    series: 'Sensor',
  };
}

const HALL_MORE: LibraryPartDef[] = [
  hallClone('misc/hall-linear', 'ss49e', 'SS49E', { sens: '14m' }, 'ratiometric linear Hall sensor, typically 1.4 mV/G (14 mV/mT) at 5 V', 'cảm biến Hall tuyến tính tỉ lệ nguồn, điển hình 1,4 mV/G (14 mV/mT) ở 5 V'),
  hallClone('misc/hall-linear', 'a1301', 'A1301', { sens: '25m' }, 'ratiometric linear Hall sensor, typically 2.5 mV/G (25 mV/mT) at 5 V', 'cảm biến Hall tuyến tính tỉ lệ nguồn, điển hình 2,5 mV/G (25 mV/mT) ở 5 V'),
  hallClone('misc/hall-linear', 'a1302', 'A1302', { sens: '13m' }, 'ratiometric linear Hall sensor, typically 1.3 mV/G (13 mV/mT) at 5 V', 'cảm biến Hall tuyến tính tỉ lệ nguồn, điển hình 1,3 mV/G (13 mV/mT) ở 5 V'),
  hallClone('misc/hall-linear', 'ss495a', 'SS495A', { sens: '31m' }, 'ratiometric linear Hall sensor, typically 3.125 mV/G (31 mV/mT) at 5 V', 'cảm biến Hall tuyến tính tỉ lệ nguồn, điển hình 3,125 mV/G (31 mV/mT) ở 5 V'),
  hallClone('misc/hall-switch', 'a3144', 'A3144', { bop: '35' }, 'unipolar Hall switch with open-collector output, operate point typically 35 mT', 'công tắc Hall một cực, ngõ ra collector hở, điểm tác động điển hình 35 mT'),
  hallClone('misc/hall-switch', 'us1881', 'US1881', { bop: '3' }, 'sensitive Hall switch with open-drain output, operate point typically 3 mT', 'công tắc Hall nhạy, ngõ ra cực máng hở, điểm tác động điển hình 3 mT'),
  hallClone('misc/hall-switch', 'ss441a', 'SS441A', { bop: '16' }, 'unipolar Hall switch with open-drain output, operate point typically 16 mT', 'công tắc Hall một cực, ngõ ra cực máng hở, điểm tác động điển hình 16 mT'),
  hallClone('misc/hall-switch', 'oh137', 'OH137', { bop: '10' }, 'unipolar Hall switch with open-drain output, operate point typically 10 mT', 'công tắc Hall một cực, ngõ ra cực máng hở, điểm tác động điển hình 10 mT'),
];

// ---------------------------------------------------------------------------------------------
// optocouplers: [slug, pn, CTR %, pins, family text]

const OPTO_ROWS: [string, string, number, 4 | 6][] = [
  ['4n26', '4N26', 50, 6], ['4n27', '4N27', 30, 6], ['4n28', '4N28', 30, 6], ['4n29', '4N29', 500, 6], ['4n30', '4N30', 500, 6], ['4n31', '4N31', 200, 6],
  ['4n32', '4N32', 500, 6], ['4n33', '4N33', 500, 6], ['4n35', '4N35', 100, 6], ['4n36', '4N36', 100, 6], ['4n37', '4N37', 100, 6], ['4n38', '4N38', 30, 6],
  ['h11a1', 'H11A1', 50, 6], ['h11a2', 'H11A2', 30, 6], ['h11a3', 'H11A3', 30, 6], ['h11a4', 'H11A4', 20, 6], ['h11a5', 'H11A5', 40, 6],
  ['cny17-1', 'CNY17-1', 60, 6], ['cny17-2', 'CNY17-2', 100, 6], ['cny17-3', 'CNY17-3', 150, 6], ['cny17-4', 'CNY17-4', 250, 6],
  ['sfh615a-1', 'SFH615A-1', 60, 4], ['sfh615a-2', 'SFH615A-2', 100, 4], ['sfh615a-3', 'SFH615A-3', 150, 4], ['sfh615a-4', 'SFH615A-4', 250, 4],
  ['pc817a', 'PC817A', 120, 4], ['pc817b', 'PC817B', 190, 4], ['pc817c', 'PC817C', 300, 4], ['pc817d', 'PC817D', 450, 4], ['pc123', 'PC123', 100, 4],
  ['el817', 'EL817', 100, 4], ['el817a', 'EL817A', 120, 4], ['el817b', 'EL817B', 190, 4], ['el817c', 'EL817C', 300, 4], ['el817d', 'EL817D', 450, 4],
  ['ltv-817', 'LTV-817', 100, 4], ['ltv-817a', 'LTV-817A', 120, 4], ['ltv-817b', 'LTV-817B', 190, 4], ['ltv-817c', 'LTV-817C', 300, 4], ['ltv-817d', 'LTV-817D', 450, 4],
  ['tlp521-1', 'TLP521-1', 100, 4], ['tlp621-1', 'TLP621-1', 100, 4], ['tlp621-gr', 'TLP621-GR', 200, 4], ['tlp621-bl', 'TLP621-BL', 400, 4], ['tlp281-1', 'TLP281-1', 100, 4],
];

const OPTO4 = { A: '1', K: '2', E: '3', C: '4' };

function optoPart([slug, pn, ctr, pins]: (typeof OPTO_ROWS)[number]): LibraryPartDef {
  const p = optocoupler(slug, pn, `Phototransistor optocoupler ${pn}, typical CTR ${ctr} %, ${pins}-pin DIP`, String(ctr), `MachSim behavioral optocoupler with the ${pn} typical CTR (${ctr} %), VF 1.2 V @ 10 mA`) as LibraryPartDef;
  return {
    ...p,
    symbol: pins === 4 ? { ...p.symbol, pins: p.symbol.pins.map((x) => ({ ...x, number: OPTO4[x.name as keyof typeof OPTO4] ?? x.number })) } : p.symbol,
    footprint: pins === 4 ? 'DIP-4' : 'DIP-6',
    specs: { package: pins === 4 ? 'DIP-4' : 'DIP-6' },
    series: 'Optocoupler',
    sortKey: ctr,
    textVi: { description: `Opto cách ly transistor quang ${pn}, CTR điển hình ${ctr} %, vỏ DIP ${pins} chân` },
  };
}

// ---------------------------------------------------------------------------------------------
// displays

const DISPLAY_COLORS: [string, string, string][] = [
  ['red', 'Red', 'đỏ'],
  ['orange', 'Orange', 'cam'],
  ['yellow', 'Yellow', 'vàng'],
  ['green', 'Green', 'xanh lá'],
  ['blue', 'Blue', 'xanh dương'],
  ['white', 'White', 'trắng'],
];
const DISPLAY_SIZES: [string, string][] = [
  ['0.28', 'DISPLAY-7SEG-0.28'],
  ['0.36', 'DISPLAY-7SEG-0.36'],
  ['0.8', 'DISPLAY-7SEG-0.8'],
  ['1.0', 'DISPLAY-7SEG-1.0'],
];

function sevenSegPart(common: 'ca' | 'cc', size: [string, string], color: [string, string, string]): LibraryPartDef {
  const base = core(`indicators/seven-seg-${common}`);
  const word = common === 'ca' ? 'Common Anode' : 'Common Cathode';
  const wordVi = common === 'ca' ? 'anode chung' : 'cathode chung';
  const name = `7-Segment ${word} ${size[0]}" ${color[1]}`;
  return {
    ...base,
    id: `indicators/seven-seg-${common}-${size[0]}-${color[0]}`,
    name,
    description: `${color[1]} ${size[0]}-inch single-digit seven-segment LED display, ${word.toLowerCase()}: ${base.description}`,
    params: withDefaults(base.params, { color: color[0] }),
    footprint: size[1],
    keywords: [...(base.keywords ?? []), color[0], `${size[0]} inch`, `${size[0]}"`],
    variantOf: base.id,
    specs: { color: color[1], package: `${size[0]} inch` },
    sortKey: 100 + Number(size[0]) * 10,
    series: '7-segment display',
    textVi: { name: `LED 7 đoạn ${wordVi} ${size[0].replace('.', ',')} in, ${color[2]}`, description: `LED 7 đoạn một chữ số ${color[2]} ${size[0].replace('.', ',')} in, ${wordVi}.` },
  };
}

function barGraphParts(): LibraryPartDef[] {
  const base = core('indicators/bargraph');
  return DISPLAY_COLORS.filter(([c]) => c !== 'red').map(([c, en, vi]) => ({
    ...base,
    id: `indicators/bargraph-${c}`,
    name: `Bar Graph 10-Segment ${en}`,
    description: `${en} 10-segment LED bar graph: ${base.description}`,
    params: withDefaults(base.params, { color: c }),
    keywords: [...(base.keywords ?? []), c],
    variantOf: base.id,
    specs: { color: en, package: 'BARGRAPH-20P' },
    series: 'Bar graph',
    textVi: { name: `Thanh LED 10 vạch ${vi}`, description: `Thanh LED 10 vạch màu ${vi}.` },
  }));
}

/** Everything of the pack. */
export const SENSORS_MORE_CATALOG: LibraryPartDef[] = fresh([
  ...NTC_R25.flatMap((r) => NTC_B.flatMap((b) => NTC_PACKAGES.map((p) => ntcPart(r, b, p)))),
  ...KTY.map(ptcPart),
  ...TEMP_MORE.map(tempIc),
  ...lm35Variants(),
  ...HALL_MORE,
  ...OPTO_ROWS.map(optoPart),
  ...(['ca', 'cc'] as const).flatMap((common) => DISPLAY_SIZES.flatMap((size) => DISPLAY_COLORS.map((color) => sevenSegPart(common, size, color)))),
  ...barGraphParts(),
]);
