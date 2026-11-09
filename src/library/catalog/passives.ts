/**
 * Passive-part catalogue (group Basic): standard-value resistors, capacitors and inductors, and
 * the "Rated components" family whose parts burn out when overloaded.
 *
 * Value series (IEC 60063):
 *   Resistor      E24, 1 Ω … 10 MΩ, ±5 %, 0.25 W carbon-film (power rating editable)
 *   Capacitor     E12 ceramic / film, 1 pF … 10 µF, ±10 %, 50 V (16 V above 1 µF)
 *                 E6 aluminium electrolytic, 0.1 µF … 10 mF, ±20 %, voltage by size
 *   Inductor      E12, 1 µH … 100 mH, ±10 %, with a typical winding resistance and current
 * Every value part keeps the full parameter set of the generic part (the value stays editable and
 * offers the E-series picker); "Burn out when overloaded" is off by default and turns the part
 * into a rated one (src/model/ratings.ts).
 *
 * Typical winding resistance / current of the inductor values: DCR ≈ 20 mΩ·√(L / 1 µH),
 * I ≈ 3 A·(1 µH / L)^0.4 — a MachSim approximation of small radial chokes, not one maker's data.
 */
import { M2N2222A, M2N2907A, mosfetFitModel } from '../parts/transistors';
import { ledFragment, ledBinding, ledIndicatorParams, ledModel, ledSymbol } from '../parts/diodes';
import { card, elC, elD, elL, elM, elQ, elR, internalNode, numParam, optNum, type LibraryPartDef } from '../partkit';
import { bjtSymbol, capacitorBody, diodeBody, inductorBody, mosfetSymbol, resistorBody, twoPinH } from '../symbols';
import { seriesValues } from '../series';
import type { ParamDef, ToSpiceContext } from '../types';
import type { ElementIR } from '../../sim/netlist';
import { toSpiceNumber } from '../../util/units';
import { burnParam, eng, tauParam, userNum, withMeta } from './kit';

function positive(ctx: ToSpiceContext, key: string): number {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
}

/** Id code of a value: "4.7k", "100n", "1meg" (SPICE suffixes, so 1 MΩ never reads as 1 mΩ). */
export const valueCode = (v: number): string => toSpiceNumber(Number(v.toPrecision(6))).toLowerCase();

// ---------------------------------------------------------------------------------------------
// resistors

export function resistorParams(value: number, burn: boolean, power = '0.25', tolerance = '5'): ParamDef[] {
  return [
    numParam('value', 'Resistance', userNum(value), 'Ω', { showOnSchematic: true, min: 0, picker: 'E24' }),
    numParam('tolerance', 'Tolerance', tolerance, '%', { group: 'advanced', min: 0, help: 'Used by Monte Carlo / worst-case analyses and the BOM' }),
    numParam('tc1', 'TC1', '0', '1/°C', { group: 'advanced' }),
    numParam('tc2', 'TC2', '0', '1/°C²', { group: 'advanced' }),
    numParam('power', 'Power rating', power, 'W', { group: 'advanced', min: 0 }),
    burnParam(burn),
    tauParam(),
  ];
}

export function resistorSpice(ctx: ToSpiceContext): { elements: ElementIR[] } {
  const r = positive(ctx, 'value');
  const params: Record<string, number> = {};
  const tc1 = ctx.num('tc1');
  const tc2 = ctx.num('tc2');
  if (tc1 !== 0) params.tc1 = tc1;
  if (tc2 !== 0) params.tc2 = tc2;
  return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), r, params)] };
}

const RES_SYMBOL = twoPinH(resistorBody());
export const RES_RATINGS = { enable: 'burn', power: 'power', tau: 'tau' };

const resistors: LibraryPartDef[] = seriesValues('E24', 1, 10e6).map((v) =>
  withMeta(
    {
      id: `basic/res-${valueCode(v)}`,
      name: eng(v, 'Ω'),
      group: 'basic',
      family: 'Resistor',
      description: `${eng(v, 'Ω')} ±5 % carbon-film resistor (E24 series), 0.25 W`,
      prefix: 'R',
      symbol: RES_SYMBOL,
      params: resistorParams(v, false),
      toSpice: resistorSpice,
      ratings: RES_RATINGS,
      footprint: 'RES-AXIAL-400',
      keywords: ['resistor', 'e24', userNum(v).toLowerCase(), 'ohm'],
    },
    { vi: `Điện trở than ${eng(v, 'Ω')} ±5 % (dãy E24), công suất 0.25 W`, specs: { resistance: v, tolerance: 5, power: 0.25, package: 'Axial' }, sortKey: v, series: 'E24 resistor' },
  ),
);

// ---------------------------------------------------------------------------------------------
// capacitors

export function icParam(unit: string, label: string): ParamDef {
  return numParam('ic', label, '', unit, { group: 'advanced', help: 'Initial condition used with "use initial conditions" (blank = none)' });
}

function capSpice(a: string, b: string) {
  return (ctx: ToSpiceContext) => {
    const ic = optNum(ctx, 'ic');
    return { elements: [elC(ctx.name('C'), ctx.node(a), ctx.node(b), positive(ctx, 'value'), ic === undefined ? {} : { ic })] };
  };
}

const CAP_SYMBOL = twoPinH(capacitorBody());
const ECAP_SYMBOL = twoPinH(capacitorBody(true), { names: ['+', '-'] });

const ceramicCaps: LibraryPartDef[] = seriesValues('E12', 1e-12, 10e-6).map((v) => {
  const vr = v > 1.01e-6 ? 16 : 50;
  return withMeta(
    {
      id: `basic/cap-${valueCode(v)}`,
      name: eng(v, 'F'),
      group: 'basic',
      family: 'Capacitor',
      description: `${eng(v, 'F')} ±10 % ${v < 1e-9 ? 'ceramic (C0G)' : v <= 1e-6 ? 'ceramic (X7R)' : 'multilayer ceramic'} capacitor (E12 series), ${vr} V`,
      prefix: 'C',
      symbol: CAP_SYMBOL,
      params: [
        numParam('value', 'Capacitance', userNum(v), 'F', { showOnSchematic: true, min: 0, picker: 'E12' }),
        icParam('V', 'Initial voltage'),
        numParam('tolerance', 'Tolerance', '10', '%', { group: 'advanced', min: 0 }),
        numParam('vrating', 'Voltage rating', String(vr), 'V', { group: 'advanced', min: 0 }),
        burnParam(false),
      ],
      toSpice: capSpice('1', '2'),
      ratings: { enable: 'burn', voltages: [{ param: 'vrating', pins: ['1', '2'] }] },
      footprint: 'CAP-RADIAL-200',
      keywords: ['capacitor', 'ceramic', 'e12', userNum(v).toLowerCase()],
    },
    { vi: `Tụ gốm ${eng(v, 'F')} ±10 % (dãy E12), điện áp ${vr} V`, specs: { capacitance: v, tolerance: 10, vrating: vr, package: 'Radial' }, sortKey: v, series: 'E12 capacitor' },
  );
});

const electrolytics: LibraryPartDef[] = seriesValues('E6', 100e-9, 10e-3).map((v) => {
  const vr = v <= 10.1e-6 ? 50 : v <= 101e-6 ? 25 : v <= 1.01e-3 ? 16 : 10;
  return withMeta(
    {
      id: `basic/ecap-${valueCode(v)}`,
      name: `${eng(v, 'F')} ${vr} V`,
      group: 'basic',
      family: 'Capacitor',
      description: `${eng(v, 'F')} ±20 % aluminium electrolytic capacitor (E6 series), ${vr} V; + terminal on the left`,
      prefix: 'C',
      symbol: ECAP_SYMBOL,
      params: [
        numParam('value', 'Capacitance', userNum(v), 'F', { showOnSchematic: true, min: 0, picker: 'E6' }),
        icParam('V', 'Initial voltage'),
        numParam('tolerance', 'Tolerance', '20', '%', { group: 'advanced', min: 0 }),
        numParam('vrating', 'Voltage rating', String(vr), 'V', { group: 'advanced', min: 0 }),
        burnParam(false),
      ],
      toSpice: capSpice('+', '-'),
      ratings: { enable: 'burn', voltages: [{ param: 'vrating', pins: ['+', '-'] }, { value: 1, pins: ['+', '-'], sign: -1 }] },
      footprint: 'CAP-RADIAL-250',
      keywords: ['electrolytic', 'capacitor', 'polarized', userNum(v).toLowerCase()],
    },
    { vi: `Tụ hoá nhôm ${eng(v, 'F')} ±20 % (dãy E6), điện áp ${vr} V; cực + ở bên trái`, specs: { capacitance: v, tolerance: 20, vrating: vr, package: 'Radial', polarity: 'polarized' }, sortKey: v, series: 'E6 electrolytic' },
  );
});

// ---------------------------------------------------------------------------------------------
// inductors

const IND_SYMBOL = twoPinH(inductorBody());

function indSpice(ctx: ToSpiceContext): { elements: ElementIR[] } {
  const ic = optNum(ctx, 'ic');
  const rser = ctx.num('rser');
  if (rser < 0) throw new Error('bad value for rser: must be >= 0');
  const lp: Record<string, number> = ic === undefined ? {} : { ic };
  const value = positive(ctx, 'value');
  if (rser === 0) return { elements: [elL(ctx.name('L'), ctx.node('1'), ctx.node('2'), value, lp)] };
  const mid = internalNode(ctx, 'r');
  return { elements: [elL(ctx.name('L'), ctx.node('1'), mid, value, lp), elR(ctx.name('R', 'ser'), mid, ctx.node('2'), rser)] };
}

const inductors: LibraryPartDef[] = seriesValues('E12', 1e-6, 100e-3).map((v) => {
  const dcr = Number((0.02 * Math.sqrt(v / 1e-6)).toPrecision(2));
  const irat = Number((3 * Math.pow(1e-6 / v, 0.4)).toPrecision(2));
  return withMeta(
    {
      id: `basic/ind-${valueCode(v)}`,
      name: eng(v, 'H'),
      group: 'basic',
      family: 'Inductor',
      description: `${eng(v, 'H')} ±10 % radial choke (E12 series), DCR ${eng(dcr, 'Ω')}, ${eng(irat, 'A')}`,
      prefix: 'L',
      symbol: IND_SYMBOL,
      params: [
        numParam('value', 'Inductance', userNum(v), 'H', { showOnSchematic: true, min: 0, picker: 'E12' }),
        numParam('rser', 'Series resistance', userNum(dcr), 'Ω', { group: 'advanced', min: 0 }),
        icParam('A', 'Initial current'),
        numParam('tolerance', 'Tolerance', '10', '%', { group: 'advanced', min: 0 }),
        numParam('irating', 'Current rating', userNum(irat), 'A', { group: 'advanced', min: 0 }),
        burnParam(false),
      ],
      toSpice: indSpice,
      ratings: { enable: 'burn', current: { param: 'irating', pin: '1' } },
      footprint: 'IND-RADIAL-500',
      keywords: ['inductor', 'choke', 'coil', 'e12', userNum(v).toLowerCase()],
    },
    { vi: `Cuộn cảm ${eng(v, 'H')} ±10 % (dãy E12), điện trở dây ${eng(dcr, 'Ω')}, dòng định mức ${eng(irat, 'A')}`, specs: { inductance: v, tolerance: 10, resistance: dcr, irating: irat }, sortKey: v, series: 'E12 inductor' },
  );
});

// ---------------------------------------------------------------------------------------------
// rated components (burn out by default)

const RATED_LED = ledModel('MS_RATED_LED', 1.9, 20e-3, 2.0, 3);
const RATED_DIODE = card('MS_RATED_DIODE', 'D', { is: 15e-9, n: 1.9, rs: 0.04, cjo: 30e-12, vj: 0.5, m: 0.33, tt: 4e-6, bv: 1000, ibv: 5e-6 });
const RATED_MOS = mosfetFitModel({ pn: 'RATED_NMOS', pch: false, description: '', vth: 2.1, rdson: 1.2, vgsOn: 10, ciss: 20e-12, crss: 5e-12, lambda: 0.01, bvdss: 200, diodeIs: 1e-14, coss: 11e-12, footprint: 'TO-92' });

interface RatedOpts {
  slug: string;
  name: string;
  nameVi: string;
  description: string;
  vi: string;
  prefix: string;
  part: Omit<LibraryPartDef, 'id' | 'name' | 'group' | 'family' | 'description' | 'prefix'>;
}

function rated(o: RatedOpts): LibraryPartDef {
  return withMeta(
    { id: `basic/rated-${o.slug}`, name: o.name, group: 'basic', family: 'Rated components', description: o.description, prefix: o.prefix, ...o.part, keywords: [...(o.part.keywords ?? []), 'rated', 'burn out', 'overload'] },
    { vi: o.vi, nameVi: o.nameVi },
  );
}

const ratedParts: LibraryPartDef[] = [
  rated({
    slug: 'resistor',
    name: 'Rated Resistor',
    nameVi: 'Điện trở có định mức',
    description: 'Resistor that burns out (opens) when its average power exceeds the power rating',
    vi: 'Điện trở bị cháy (hở mạch) khi công suất trung bình vượt công suất định mức',
    prefix: 'R',
    part: { symbol: RES_SYMBOL, params: resistorParams(1000, true), toSpice: resistorSpice, ratings: RES_RATINGS, footprint: 'RES-AXIAL-400', keywords: ['resistor'] },
  }),
  rated({
    slug: 'capacitor',
    name: 'Rated Capacitor',
    nameVi: 'Tụ điện có định mức',
    description: 'Capacitor that fails open when the voltage across it exceeds the voltage rating',
    vi: 'Tụ điện bị hỏng (hở mạch) khi điện áp trên tụ vượt điện áp định mức',
    prefix: 'C',
    part: {
      symbol: CAP_SYMBOL,
      params: [numParam('value', 'Capacitance', '1u', 'F', { showOnSchematic: true, min: 0, picker: 'E12' }), icParam('V', 'Initial voltage'), numParam('vrating', 'Voltage rating', '16', 'V', { showOnSchematic: true, min: 0 }), burnParam(true)],
      toSpice: capSpice('1', '2'),
      ratings: { enable: 'burn', voltages: [{ param: 'vrating', pins: ['1', '2'] }] },
      footprint: 'CAP-RADIAL-200',
      keywords: ['capacitor'],
    },
  }),
  rated({
    slug: 'electrolytic',
    name: 'Rated Electrolytic Capacitor',
    nameVi: 'Tụ hoá có định mức',
    description: 'Electrolytic capacitor that fails when over-voltaged or reverse biased by more than 1 V',
    vi: 'Tụ hoá bị hỏng khi quá điện áp hoặc bị phân cực ngược quá 1 V',
    prefix: 'C',
    part: {
      symbol: ECAP_SYMBOL,
      params: [numParam('value', 'Capacitance', '100u', 'F', { showOnSchematic: true, min: 0, picker: 'E6' }), icParam('V', 'Initial voltage'), numParam('vrating', 'Voltage rating', '16', 'V', { showOnSchematic: true, min: 0 }), burnParam(true)],
      toSpice: capSpice('+', '-'),
      ratings: { enable: 'burn', voltages: [{ param: 'vrating', pins: ['+', '-'] }, { value: 1, pins: ['+', '-'], sign: -1 }] },
      footprint: 'CAP-RADIAL-250',
      keywords: ['electrolytic', 'capacitor', 'reverse polarity'],
    },
  }),
  rated({
    slug: 'inductor',
    name: 'Rated Inductor',
    nameVi: 'Cuộn cảm có định mức',
    description: 'Inductor whose winding burns open when the current exceeds the current rating',
    vi: 'Cuộn cảm bị đứt dây khi dòng điện vượt dòng định mức',
    prefix: 'L',
    part: {
      symbol: IND_SYMBOL,
      params: [numParam('value', 'Inductance', '1m', 'H', { showOnSchematic: true, min: 0, picker: 'E12' }), numParam('rser', 'Series resistance', '1', 'Ω', { group: 'advanced', min: 0 }), icParam('A', 'Initial current'), numParam('irating', 'Current rating', '500m', 'A', { showOnSchematic: true, min: 0 }), burnParam(true)],
      toSpice: indSpice,
      ratings: { enable: 'burn', current: { param: 'irating', pin: '1' } },
      footprint: 'IND-RADIAL-500',
      keywords: ['inductor', 'coil'],
    },
  }),
  rated({
    slug: 'led',
    name: 'Rated LED',
    nameVi: 'LED có định mức',
    description: 'Red LED that burns out above its maximum forward current or a reverse voltage above 5 V',
    vi: 'LED đỏ bị cháy khi dòng thuận vượt dòng tối đa hoặc điện áp ngược lớn hơn 5 V',
    prefix: 'LED',
    part: {
      symbol: ledSymbol('#e53935'),
      params: [...ledIndicatorParams('red'), numParam('imaxrated', 'Maximum forward current', '30m', 'A', { showOnSchematic: true, min: 0 }), burnParam(true)],
      toSpice: (ctx) => ledFragment(ctx, RATED_LED),
      indicator: { kind: 'led', signal: 'current' },
      ...ledBinding,
      ratings: { enable: 'burn', current: { param: 'imaxrated', pin: 'A' }, voltages: [{ value: 5, pins: ['A', 'K'], sign: -1 }] },
      provenance: 'MachSim fit: typical 5 mm red LED, VF = 1.9 V @ 20 mA',
      footprint: 'LED-5MM',
      keywords: ['led'],
    },
  }),
  rated({
    slug: 'diode',
    name: 'Rated Diode',
    nameVi: 'Diode có định mức',
    description: 'Rectifier diode that fails above its average forward current or peak reverse voltage',
    vi: 'Diode chỉnh lưu bị hỏng khi dòng thuận vượt định mức hoặc điện áp ngược vượt định mức',
    prefix: 'D',
    part: {
      symbol: twoPinH(diodeBody(), { names: ['A', 'K'] }),
      params: [numParam('iorated', 'Forward current rating', '1', 'A', { showOnSchematic: true, min: 0 }), numParam('prvrated', 'Peak reverse voltage', '400', 'V', { min: 0 }), burnParam(true)],
      toSpice: (ctx) => ({ elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), RATED_DIODE.name)], models: [RATED_DIODE] }),
      ratings: { enable: 'burn', current: { param: 'iorated', pin: 'A' }, voltages: [{ param: 'prvrated', pins: ['A', 'K'], sign: -1 }] },
      provenance: 'MachSim 1 A silicon rectifier fit (VF ≈ 0.92 V @ 1 A)',
      footprint: 'DO-41',
      keywords: ['diode', 'rectifier'],
    },
  }),
  ...([false, true] as const).map((pnp) =>
    rated({
      slug: pnp ? 'pnp' : 'npn',
      name: pnp ? 'Rated PNP Transistor' : 'Rated NPN Transistor',
      nameVi: pnp ? 'Transistor PNP có định mức' : 'Transistor NPN có định mức',
      description: `${pnp ? 'PNP' : 'NPN'} transistor that fails above its collector power, collector current or VCE rating`,
      vi: `Transistor ${pnp ? 'PNP' : 'NPN'} bị hỏng khi công suất cực C, dòng cực C hoặc điện áp VCE vượt định mức`,
      prefix: 'Q',
      part: {
        symbol: bjtSymbol(pnp),
        params: [
          numParam('pmax', 'Power rating', '500m', 'W', { showOnSchematic: true, min: 0 }),
          numParam('icmax', 'Maximum collector current', '800m', 'A', { min: 0 }),
          numParam('vcemax', 'Maximum VCE', '40', 'V', { min: 0 }),
          burnParam(true),
          tauParam(),
        ],
        toSpice: (ctx) => ({ elements: [elQ(ctx.name('Q'), ctx.node('C'), ctx.node('B'), ctx.node('E'), pnp ? M2N2907A.name : M2N2222A.name)], models: [pnp ? M2N2907A : M2N2222A] }),
        ratings: { enable: 'burn', power: 'pmax', tau: 'tau', current: { param: 'icmax', pin: 'C' }, voltages: [{ param: 'vcemax', pins: ['C', 'E'], sign: pnp ? -1 : 1 }], openPin: 'C' },
        provenance: `Gummel-Poon parameters following the manufacturer-published ${pnp ? '2N2907A' : '2N2222A'} model`,
        footprint: 'TO-92',
        keywords: ['bjt', 'transistor', pnp ? 'pnp' : 'npn'],
      },
    }),
  ),
  rated({
    slug: 'nmos',
    name: 'Rated N-MOSFET',
    nameVi: 'MOSFET kênh N có định mức',
    description: 'N-channel MOSFET that fails above its power, drain current or VDS rating',
    vi: 'MOSFET kênh N bị hỏng khi công suất, dòng cực máng hoặc điện áp VDS vượt định mức',
    prefix: 'Q',
    part: {
      symbol: mosfetSymbol(false, { bodyDiode: true }),
      params: [numParam('pmax', 'Power rating', '400m', 'W', { showOnSchematic: true, min: 0 }), numParam('idmax', 'Maximum drain current', '200m', 'A', { min: 0 }), numParam('vdsmax', 'Maximum VDS', '60', 'V', { min: 0 }), burnParam(true), tauParam()],
      toSpice: (ctx) => {
        const d = ctx.node('D');
        const s = ctx.node('S');
        return { elements: [elM(ctx.name('M'), d, ctx.node('G'), s, s, RATED_MOS.mos.name, { w: 100e-6, l: 100e-6 }), elD(ctx.name('D', 'body'), s, d, RATED_MOS.diode.name)], models: [RATED_MOS.mos, RATED_MOS.diode] };
      },
      ratings: { enable: 'burn', power: 'pmax', tau: 'tau', current: { param: 'idmax', pin: 'D' }, voltages: [{ param: 'vdsmax', pins: ['D', 'S'], sign: 1 }], openPin: 'D' },
      provenance: 'MachSim level-1 fit to a 60 V / 200 mA small-signal MOSFET (VGS(th) 2.1 V, RDS(on) 1.2 Ω)',
      footprint: 'TO-92',
      keywords: ['mosfet', 'nmos'],
    },
  }),
];

export const PASSIVE_CATALOG: LibraryPartDef[] = [...resistors, ...ceramicCaps, ...electrolytics, ...inductors, ...ratedParts];
