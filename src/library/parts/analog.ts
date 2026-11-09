/**
 * Analog group: ideal and macromodel op-amps, comparators, instrumentation amplifier, 555
 * timer, TL431-style shunt reference and analog control-function blocks.
 *
 * MachSim op-amp macromodel (original design, one subcircuit per parameter set)
 *   RIN   inp-inn differential input resistance
 *   RM1/2 mid-supply reference node "mid" (1 MΩ + 1 MΩ)
 *   BQ    quiescent supply current IQ (scaled down when V(vcc,vee) < 1 V)
 *   BG    slew-limited transconductor: I = Imax·tanh(gm·(vin + VOS) / Imax) into node n1
 *   R1,C1 dominant pole: R1 = 1 MΩ, gm·R1 = AVOL, pole at GBW/AVOL; Imax = SR·C1
 *   BCL   1 S clamp keeping n1 within ±(supply span / 2 + 1 V) of mid (fast overload recovery)
 *   BO    output: V(n1) limited to V(out) ± ISC·ROUT (short-circuit current limit) and to the
 *         rails V(vee) + VSATN .. V(vcc) - VSATP
 *   RO    output resistance ROUT
 *   BSRC/BSNK  the output current is drawn from V+ when sourcing and returned through V- when
 *         sinking, so supply currents and power are realistic.
 * Real op-amps are this macromodel with datasheet typical values ("MachSim macromodel
 * parameterised from the datasheet"), not vendor models. Pins: IN+, IN-, OUT, V+, V-.
 *
 * Behavioral expressions use V(), I(), time and the built-in functions of src/sim/spice/expr.ts.
 */

import type { ElementIR, SubcktDef } from '../../sim/netlist';
import {
  sawtoothOf,
  defaultNums,
  elB,
  elC,
  elD,
  elE,
  elG,
  elH,
  elI,
  elR,
  elSense,
  elX,
  card,
  ex,
  internalNode,
  numParam,
  paramModelName,
  pinConnected,
  selectParam,
  subckt,
  textOf,
  type LibraryPartDef,
} from '../partkit';
import { ampSymbol, boxSymbol, diodeBody, line, makeSymbol, pin, poly, text } from '../symbols';
import type { ParamDef, ToSpiceContext } from '../types';

// ---------------------------------------------------------------------------
// Op-amp macromodel
// ---------------------------------------------------------------------------

export interface OpampParams {
  /** open-loop DC gain, V/V */
  avol: number;
  /** gain-bandwidth product, Hz */
  gbw: number;
  /** slew rate, V/s */
  slew: number;
  /** differential input resistance, Ω */
  rin: number;
  /** open-loop output resistance, Ω */
  rout: number;
  /** input offset voltage, V */
  vos: number;
  /** quiescent supply current, A */
  iq: number;
  /** output swing headroom from V+ / above V-, V */
  vsatp: number;
  vsatn: number;
  /** output short-circuit current, A */
  isc: number;
}

const OPAMP_KEYS: (keyof OpampParams)[] = ['avol', 'gbw', 'slew', 'rin', 'rout', 'vos', 'iq', 'vsatp', 'vsatn', 'isc'];

/** Build the macromodel subcircuit (ports: inp inn out vcc vee). */
export function opampSubckt(name: string, p: OpampParams): SubcktDef {
  for (const k of OPAMP_KEYS) if (!Number.isFinite(p[k])) throw new Error(`bad value for ${k}`);
  if (!(p.avol > 0 && p.gbw > 0 && p.slew > 0 && p.rin > 0 && p.rout > 0 && p.isc > 0)) {
    throw new Error('bad value for op-amp parameters: avol, gbw, slew, rin, rout and isc must be > 0');
  }
  const r1 = 1e6;
  const gm = p.avol / r1;
  const c1 = p.avol / (2 * Math.PI * p.gbw * r1);
  const imax = p.slew * c1;
  const swing = p.isc * p.rout;
  const els: ElementIR[] = [
    elR('RIN', 'inp', 'inn', p.rin),
    elR('RM1', 'vcc', 'mid', 1e6),
    elR('RM2', 'mid', 'vee', 1e6),
    elB('BQ', 'vcc', 'vee', 'I', `${ex(p.iq)}*limit(V(vcc,vee),0,1)`),
    elB('BG', 'mid', 'n1', 'I', `${ex(imax)}*tanh(${ex(gm / imax)}*(V(inp,inn)+${ex(p.vos)}))`),
    elR('R1', 'n1', 'mid', r1),
    elC('C1', 'n1', 'mid', c1),
    elB('BCL', 'n1', 'mid', 'I', 'max(V(n1,mid)-(abs(V(vcc,vee))/2+1),0)+min(V(n1,mid)+(abs(V(vcc,vee))/2+1),0)'),
    elB('BO', 'o1', '0', 'V', `limit(limit(V(n1),V(out)-${ex(swing)},V(out)+${ex(swing)}),V(vee)+${ex(p.vsatn)},V(vcc)-${ex(p.vsatp)})`),
    elR('RO', 'o1', 'out', p.rout),
    elB('BSRC', 'vcc', '0', 'I', 'max(-I(BO),0)'),
    elB('BSNK', '0', 'vee', 'I', 'max(I(BO),0)'),
  ];
  return subckt(name, ['inp', 'inn', 'out', 'vcc', 'vee'], els);
}

export function opampNodes(ctx: ToSpiceContext): string[] {
  return [ctx.node('IN+'), ctx.node('IN-'), ctx.node('OUT'), ctx.node('V+'), ctx.node('V-')];
}

export interface RealOpamp {
  pn: string;
  description: string;
  p: OpampParams;
  source: string;
  footprint: string;
  keywords: string[];
}

export const REAL_OPAMPS: RealOpamp[] = [
  {
    pn: 'LM741',
    description: 'Classic general-purpose bipolar op-amp (±15 V)',
    p: { avol: 200e3, gbw: 1e6, slew: 0.5e6, rin: 2e6, rout: 75, vos: 1e-3, iq: 1.7e-3, vsatp: 1.5, vsatn: 1.5, isc: 25e-3 },
    source: 'AVOL 200 V/mV, GBW 1 MHz, SR 0.5 V/µs, RIN 2 MΩ, ROUT 75 Ω, VOS 1 mV, IQ 1.7 mA, ISC 25 mA',
    footprint: 'DIP-8',
    keywords: ['741', 'ua741'],
  },
  {
    pn: 'LM358',
    description: 'Single-supply dual op-amp (one section); input and output range include ground',
    p: { avol: 100e3, gbw: 1e6, slew: 0.3e6, rin: 10e6, rout: 50, vos: 2e-3, iq: 0.35e-3, vsatp: 1.5, vsatn: 0.02, isc: 40e-3 },
    source: 'AVOL 100 V/mV, GBW 1 MHz, SR 0.3 V/µs, VOS 2 mV, output swings to within 20 mV of V-, ISC 40 mA',
    footprint: 'DIP-8',
    keywords: ['358', 'single supply'],
  },
  {
    pn: 'LM324',
    description: 'Single-supply quad op-amp (one section); input and output range include ground',
    p: { avol: 100e3, gbw: 1e6, slew: 0.5e6, rin: 10e6, rout: 50, vos: 2e-3, iq: 0.18e-3, vsatp: 1.5, vsatn: 0.02, isc: 40e-3 },
    source: 'AVOL 100 V/mV, GBW 1.2 MHz, SR 0.5 V/µs, VOS 2 mV, IQ 0.7 mA / 4 sections, ISC 40 mA',
    footprint: 'DIP-14',
    keywords: ['324', 'quad', 'single supply'],
  },
  {
    pn: 'TL071',
    description: 'Low-noise JFET-input op-amp',
    p: { avol: 200e3, gbw: 3e6, slew: 13e6, rin: 1e12, rout: 100, vos: 3e-3, iq: 1.4e-3, vsatp: 1.5, vsatn: 1.5, isc: 40e-3 },
    source: 'AVOL 200 V/mV, GBW 3 MHz, SR 13 V/µs, RIN 1 TΩ, VOS 3 mV, IQ 1.4 mA',
    footprint: 'DIP-8',
    keywords: ['tl071', 'jfet input', 'audio'],
  },
  {
    pn: 'TL081',
    description: 'General-purpose JFET-input op-amp',
    p: { avol: 200e3, gbw: 3e6, slew: 13e6, rin: 1e12, rout: 100, vos: 3e-3, iq: 1.4e-3, vsatp: 1.5, vsatn: 1.5, isc: 40e-3 },
    source: 'AVOL 200 V/mV, GBW 3 MHz, SR 13 V/µs, RIN 1 TΩ, VOS 3 mV, IQ 1.4 mA',
    footprint: 'DIP-8',
    keywords: ['tl081', 'jfet input'],
  },
  {
    pn: 'OP07',
    description: 'Ultra-low-offset precision op-amp',
    p: { avol: 500e3, gbw: 0.6e6, slew: 0.3e6, rin: 33e6, rout: 60, vos: 30e-6, iq: 2.5e-3, vsatp: 1.0, vsatn: 1.0, isc: 30e-3 },
    source: 'AVOL 500 V/mV, GBW 0.6 MHz, SR 0.3 V/µs, RIN 33 MΩ, VOS 30 µV, IQ 2.5 mA',
    footprint: 'DIP-8',
    keywords: ['op07', 'precision', 'low offset'],
  },
  {
    pn: 'NE5532',
    description: 'Low-noise high-speed audio op-amp (one section of the dual)',
    p: { avol: 100e3, gbw: 10e6, slew: 9e6, rin: 300e3, rout: 50, vos: 0.5e-3, iq: 4e-3, vsatp: 1.0, vsatn: 1.0, isc: 38e-3 },
    source: 'AVOL 100 V/mV, GBW 10 MHz, SR 9 V/µs, RIN 300 kΩ, VOS 0.5 mV, IQ 4 mA, ISC 38 mA',
    footprint: 'DIP-8',
    keywords: ['5532', 'audio', 'low noise'],
  },
];

function realOpamp(o: RealOpamp): LibraryPartDef {
  const sub = opampSubckt(`MS_${o.pn}`, o.p);
  return {
    id: `analog/${o.pn.toLowerCase()}`,
    name: o.pn,
    group: 'analog',
    family: 'Op-amp',
    description: o.description,
    prefix: 'U',
    symbol: ampSymbol({ supplies: true }),
    params: [],
    toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), opampNodes(ctx), sub.name)], subckts: [sub] }),
    provenance: `MachSim op-amp macromodel parameterised from ${o.pn} datasheet typical values: ${o.source}`,
    footprint: o.footprint,
    keywords: ['op-amp', 'opamp', 'operational amplifier', ...o.keywords],
  };
}

function opampParamDefs(): ParamDef[] {
  return [
    numParam('avol', 'Open-loop gain', '200k', 'V/V', { group: 'model', min: 0 }),
    numParam('gbw', 'Gain-bandwidth product', '1M', 'Hz', { group: 'model', min: 0, showOnSchematic: false }),
    numParam('slew', 'Slew rate', '1M', 'V/s', { group: 'model', min: 0 }),
    numParam('rin', 'Input resistance', '10M', 'Ω', { group: 'model', min: 0 }),
    numParam('rout', 'Output resistance', '50', 'Ω', { group: 'model', min: 0 }),
    numParam('vos', 'Input offset voltage', '0', 'V', { group: 'model' }),
    numParam('iq', 'Quiescent current', '1m', 'A', { group: 'model', min: 0 }),
    numParam('vsatp', 'Output headroom to V+', '1', 'V', { group: 'model', min: 0 }),
    numParam('vsatn', 'Output headroom to V-', '1', 'V', { group: 'model', min: 0 }),
    numParam('isc', 'Short-circuit current', '25m', 'A', { group: 'model', min: 0 }),
  ];
}

const genericOpampParams = opampParamDefs();

const genericOpamp: LibraryPartDef = {
  id: 'analog/opamp',
  name: 'Op-Amp (macromodel)',
  group: 'analog',
  family: 'Op-amp',
  description: 'General op-amp macromodel: finite gain, single-pole GBW, slew rate, offset, output limits and supply currents',
  prefix: 'U',
  symbol: ampSymbol({ supplies: true }),
  params: genericOpampParams,
  toSpice: (ctx) => {
    const p = {} as OpampParams;
    for (const k of OPAMP_KEYS) p[k] = ctx.num(k);
    const name = paramModelName('MS_OPAMP', p as unknown as Record<string, number>, defaultNums(genericOpampParams, OPAMP_KEYS));
    const sub = opampSubckt(name, p);
    return { elements: [elX(ctx.name('X'), opampNodes(ctx), sub.name)], subckts: [sub] };
  },
  provenance: 'MachSim original op-amp macromodel (see module documentation)',
  footprint: 'DIP-8',
  keywords: ['op-amp', 'opamp', 'operational amplifier', 'macromodel', 'generic'],
};

const idealOpamp3: LibraryPartDef = {
  id: 'analog/opamp-ideal-3',
  name: 'Ideal Op-Amp (3-terminal)',
  group: 'analog',
  family: 'Op-amp',
  description: 'Ideal op-amp without supply pins: V(OUT) = gain·V(IN+,IN-) limited to [Vmin, Vmax]',
  prefix: 'U',
  symbol: ampSymbol(),
  params: [
    numParam('gain', 'Open-loop gain', '1e6', 'V/V', { min: 0 }),
    numParam('vmax', 'Output upper limit', '15', 'V'),
    numParam('vmin', 'Output lower limit', '-15', 'V'),
  ],
  toSpice: (ctx) => {
    const vmax = ctx.num('vmax');
    const vmin = ctx.num('vmin');
    if (!(vmax > vmin)) throw new Error('bad value for vmax: must exceed vmin');
    return {
      elements: [elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', `limit(${ex(ctx.num('gain'))}*V(${ctx.node('IN+')},${ctx.node('IN-')}),${ex(vmin)},${ex(vmax)})`)],
    };
  },
  provenance: 'Ideal behavioral op-amp (textbook)',
  keywords: ['ideal op-amp', 'opamp', 'virtual'],
  virtual: true,
};

const idealOpamp5: LibraryPartDef = {
  id: 'analog/opamp-ideal-5',
  name: 'Ideal Op-Amp (5-terminal)',
  group: 'analog',
  family: 'Op-amp',
  description: 'Ideal op-amp with supply pins: V(OUT) = gain·V(IN+,IN-) limited to the rails (rail-to-rail, no supply current)',
  prefix: 'U',
  symbol: ampSymbol({ supplies: true }),
  params: [numParam('gain', 'Open-loop gain', '1e6', 'V/V', { min: 0 })],
  toSpice: (ctx) => ({
    elements: [
      elB(
        ctx.name('B'),
        ctx.node('OUT'),
        '0',
        'V',
        `limit(${ex(ctx.num('gain'))}*V(${ctx.node('IN+')},${ctx.node('IN-')}),V(${ctx.node('V-')}),V(${ctx.node('V+')}))`,
      ),
    ],
  }),
  provenance: 'Ideal behavioral op-amp (textbook)',
  keywords: ['ideal op-amp', 'opamp', 'virtual'],
  virtual: true,
};

// ---------------------------------------------------------------------------
// Comparators
// ---------------------------------------------------------------------------

export interface CompParams {
  tresp: number;
  vhys: number;
  iq: number;
  oc: boolean;
}

/** Comparator subcircuit (ports inp inn out vcc vee); decision node s1 in [0, 1] with time constant tresp. */
export function comparatorSubckt(name: string, p: CompParams): SubcktDef {
  if (!(p.tresp > 0)) throw new Error('bad value for tresp: must be > 0');
  const els: ElementIR[] = [
    elB('BS', 's0', '0', 'V', `0.5+0.5*tanh(2000*(V(inp,inn)+${ex(p.vhys)}*(V(s1)-0.5)))`),
    elR('RS', 's0', 's1', 1000),
    elC('CS', 's1', '0', p.tresp / 1000),
    elB('BQ', 'vcc', 'vee', 'I', `${ex(p.iq)}*limit(V(vcc,vee),0,1)`),
  ];
  if (p.oc) {
    els.push(elB('BOC', 'out', 'vee', 'I', '(1-V(s1))*V(out,vee)/20+1e-9*V(out,vee)'));
  } else {
    els.push(
      elB('BO', 'o1', '0', 'V', 'V(vee)+V(s1)*V(vcc,vee)'),
      elR('RO', 'o1', 'out', 50),
      elB('BSRC', 'vcc', '0', 'I', 'max(-I(BO),0)'),
      elB('BSNK', '0', 'vee', 'I', 'max(I(BO),0)'),
    );
  }
  return subckt(name, ['inp', 'inn', 'out', 'vcc', 'vee'], els);
}

export function comparatorSymbol() {
  return ampSymbol({ supplies: true, plusOnTop: true, extra: [poly([-14, 4, -8, 4, -8, -4, 0, -4]), poly([-12, 4, -4, 4, -4, -4, 2, -4])] });
}

const COMP_KEYS = ['tresp', 'vhys', 'iq'];
const comparatorParams: ParamDef[] = [
  selectParam('output', 'Output stage', 'push-pull', [['push-pull', 'Push-pull'], ['open-collector', 'Open collector (to V-)']]),
  numParam('tresp', 'Response time constant', '100n', 's', { group: 'model', min: 0 }),
  numParam('vhys', 'Hysteresis', '0', 'V', { group: 'model', min: 0 }),
  numParam('iq', 'Quiescent current', '0.5m', 'A', { group: 'model', min: 0 }),
];

const genericComparator: LibraryPartDef = {
  id: 'analog/comparator',
  name: 'Comparator',
  group: 'analog',
  family: 'Comparator',
  description: 'Voltage comparator: OUT high (V+) when IN+ > IN-, low (V-) otherwise; optional open-collector output and hysteresis',
  prefix: 'U',
  symbol: comparatorSymbol(),
  params: comparatorParams,
  toSpice: (ctx) => {
    const p: CompParams = { tresp: ctx.num('tresp'), vhys: ctx.num('vhys'), iq: ctx.num('iq'), oc: textOf(ctx, 'output').trim().toLowerCase() === 'open-collector' };
    const base = p.oc ? 'MS_COMP_OC' : 'MS_COMP';
    const name = paramModelName(base, { tresp: p.tresp, vhys: p.vhys, iq: p.iq }, defaultNums(comparatorParams, COMP_KEYS));
    const sub = comparatorSubckt(name, p);
    return { elements: [elX(ctx.name('X'), opampNodes(ctx), sub.name)], subckts: [sub] };
  },
  provenance: 'MachSim behavioral comparator (tanh decision with RC response and optional hysteresis)',
  footprint: 'DIP-8',
  keywords: ['comparator', 'schmitt', 'threshold'],
};

function realComparator(pn: string, description: string, tresp: number, iq: number, footprint: string): LibraryPartDef {
  const sub = comparatorSubckt(`MS_${pn}`, { tresp, vhys: 0, iq, oc: true });
  return {
    id: `analog/${pn.toLowerCase()}`,
    name: pn,
    group: 'analog',
    family: 'Comparator',
    description,
    prefix: 'U',
    symbol: comparatorSymbol(),
    params: [],
    toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), opampNodes(ctx), sub.name)], subckts: [sub] }),
    provenance: `MachSim behavioral comparator with open-collector output (20 Ω saturation) parameterised from the ${pn} datasheet: response ≈ ${tresp * 1e9} ns time constant, IQ ${iq * 1e3} mA`,
    footprint,
    keywords: ['comparator', 'open collector', pn.toLowerCase()],
  };
}

const comparators = [
  genericComparator,
  realComparator('LM393', 'Dual low-power comparator (one section), open-collector output, single supply', 300e-9, 0.2e-3, 'DIP-8'),
  realComparator('LM339', 'Quad low-power comparator (one section), open-collector output, single supply', 300e-9, 0.2e-3, 'DIP-14'),
  realComparator('LM311', 'Fast comparator, open-collector output (emitter tied to V-)', 50e-9, 5e-3, 'DIP-8'),
];

// ---------------------------------------------------------------------------
// Instrumentation amplifier
// ---------------------------------------------------------------------------

const INAMP_KEYS = ['gain', 'gbw', 'rin', 'vsat', 'iq'];
const inampParams: ParamDef[] = [
  numParam('gain', 'Gain', '10', 'V/V', { showOnSchematic: true, min: 0 }),
  numParam('gbw', 'Gain-bandwidth product', '1M', 'Hz', { group: 'model', min: 0 }),
  numParam('rin', 'Input resistance (each input)', '10G', 'Ω', { group: 'model', min: 0 }),
  numParam('vsat', 'Output headroom', '1', 'V', { group: 'model', min: 0 }),
  numParam('iq', 'Quiescent current', '1m', 'A', { group: 'model', min: 0 }),
];

const inamp: LibraryPartDef = {
  id: 'analog/instrumentation-amplifier',
  name: 'Instrumentation Amplifier',
  group: 'analog',
  family: 'Instrumentation amplifier',
  description: 'V(OUT) = V(REF) + gain·V(IN+,IN-), first-order bandwidth GBW/gain, limited to the rails',
  prefix: 'U',
  symbol: ampSymbol({
    plusOnTop: false,
    label: 'IA',
    extra: [line(-10, -20, -10, -30), line(-10, 20, -10, 30), line(10, 10, 10, 30), text(-6, -24, 'V+', 7, 'start'), text(-6, 30, 'V−', 7, 'start'), text(14, 28, 'REF', 7, 'start')],
    extraPins: [pin('V+', -10, -30, 'up', { type: 'power', number: '7' }), pin('V-', -10, 30, 'down', { type: 'power', number: '4' }), pin('REF', 10, 30, 'down', { number: '5' })],
  }),
  params: inampParams,
  toSpice: (ctx) => {
    const v: Record<string, number> = {};
    for (const k of INAMP_KEYS) v[k] = ctx.num(k);
    if (!(v.gain > 0 && v.gbw > 0 && v.rin > 0)) throw new Error('bad value for gain/gbw/rin: must be > 0');
    const name = paramModelName('MS_INAMP', v, defaultNums(inampParams, INAMP_KEYS));
    const bw = v.gbw / v.gain;
    const sub = subckt(name, ['inp', 'inn', 'out', 'vcc', 'vee', 'ref'], [
      elR('RINP', 'inp', '0', v.rin),
      elR('RINN', 'inn', '0', v.rin),
      elB('BA', 'a', '0', 'V', `${ex(v.gain)}*V(inp,inn)`),
      elR('RF', 'a', 'n1', 1000),
      elC('CF', 'n1', '0', 1 / (2 * Math.PI * bw * 1000)),
      elB('BO', 'o1', '0', 'V', `limit(V(ref)+V(n1),V(vee)+${ex(v.vsat)},V(vcc)-${ex(v.vsat)})`),
      elR('RO', 'o1', 'out', 0.1),
      elB('BQ', 'vcc', 'vee', 'I', `${ex(v.iq)}*limit(V(vcc,vee),0,1)`),
      elB('BSRC', 'vcc', '0', 'I', 'max(-I(BO),0)'),
      elB('BSNK', '0', 'vee', 'I', 'max(I(BO),0)'),
    ]);
    return {
      elements: [elX(ctx.name('X'), [ctx.node('IN+'), ctx.node('IN-'), ctx.node('OUT'), ctx.node('V+'), ctx.node('V-'), ctx.node('REF')], sub.name)],
      subckts: [sub],
    };
  },
  provenance: 'MachSim behavioral instrumentation amplifier (ideal differential gain, single-pole bandwidth, rail limits)',
  footprint: 'DIP-8',
  keywords: ['instrumentation amplifier', 'in-amp', 'differential amplifier'],
};

// ---------------------------------------------------------------------------
// 555 timer
// ---------------------------------------------------------------------------

/**
 * Behavioral 555 (ports gnd trig out rst ctrl thr dis vcc):
 * 3 × 5 kΩ divider (CTRL = 2/3 VCC, lo = 1/3 VCC); trigger comparator s = [TRIG < lo];
 * threshold comparator r = [THR > CTRL]; active-low reset x = [RST < 0.7 V]; latch
 * q' = ½ + ½·tanh(8(q - ½) + 24 s - 12 r - 40 x) through a 10 ns RC (trigger wins over threshold,
 * reset wins over both); the stages below use the sharpened state qd = ½ + ½·tanh(20(q - ½)) so a
 * latch output a little below 1 cannot leak through the discharge stage and stall the timing
 * capacitor at a threshold; output = qd·(VCC - 1.7 V) + (1 - qd)·0.1 V via 10 Ω, sourcing current
 * drawn from VCC; discharge = 10 Ω to GND while qd is low (limited to 200 mA); internal 100 kΩ
 * reset pull-up; 3 mA supply current.
 * Power-up state: while time = 0 (operating point, including the one that starts a transient)
 * the latch is held reset (output low, discharge on). An astable circuit has no stable DC
 * solution, so this gives the operating point a definite state; the timing capacitor then starts
 * near 0 V exactly as after switching the supply on, and the hold is released for t > 0.
 */
const TIMER555 = subckt(
  'MS_555',
  ['gnd', 'trig', 'out', 'rst', 'ctrl', 'thr', 'dis', 'vcc'],
  [
    elR('R1', 'vcc', 'ctrl', 5000),
    elR('R2', 'ctrl', 'lo', 5000),
    elR('R3', 'lo', 'gnd', 5000),
    elR('RRST', 'vcc', 'rst', 100e3),
    elB('BS', 's', '0', 'V', '0.5+0.5*tanh(200*(V(lo)-V(trig)))'),
    elB('BR', 'r', '0', 'V', '0.5+0.5*tanh(200*(V(thr)-V(ctrl)))'),
    elB('BX', 'x', '0', 'V', '0.5+0.5*tanh(200*(0.7-V(rst,gnd)))'),
    elB('BL', 'qr', '0', 'V', '0.5+0.5*tanh(8*(V(q)-0.5)+24*V(s)-12*V(r)-40*V(x)-60*(1-u(time)))'),
    elR('RQ', 'qr', 'q', 1000),
    elC('CQ', 'q', '0', 10e-12),
    elB('BQD', 'qd', '0', 'V', '0.5+0.5*tanh(20*(V(q)-0.5))'),
    elB('BO', 'o1', 'gnd', 'V', 'V(qd)*max(V(vcc,gnd)-1.7,0)+(1-V(qd))*min(0.1,max(V(vcc,gnd),0))'),
    elR('RO', 'o1', 'out', 10),
    elB('BD', 'dis', 'gnd', 'I', '(1-V(qd))*limit(V(dis,gnd)/10,-0.2,0.2)'),
    elB('BQ', 'vcc', 'gnd', 'I', '0.003*limit(V(vcc,gnd)/4.5,0,1)+max(-I(BO),0)'),
  ],
);

const timer555: LibraryPartDef = {
  id: 'analog/555',
  name: '555 Timer',
  group: 'analog',
  family: 'Timer',
  description: 'Behavioral 555 timer (astable / monostable); f ≈ 1.44 / ((RA + 2RB)·C) in astable mode',
  prefix: 'U',
  symbol: boxSymbol({
    w: 80,
    h: 60,
    left: [{ name: 'TRIG', number: '2', type: 'input' }, { name: 'THR', number: '6', type: 'input' }, { name: 'CTRL', label: 'CV', number: '5' }],
    right: [{ name: 'OUT', number: '3', type: 'output' }, { name: 'DIS', number: '7' }],
    top: [{ name: 'RST', label: 'R', number: '4', type: 'input' }, { name: 'VCC', label: 'V', number: '8', type: 'power' }],
    bottom: [{ name: 'GND', label: 'G', number: '1', type: 'power' }],
    title: '555',
    titlePos: { x: 0, y: 4 },
  }),
  params: [],
  optionalPins: ['CTRL', 'RST'],
  toSpice: (ctx) => ({
    elements: [
      elX(
        ctx.name('X'),
        [ctx.node('GND'), ctx.node('TRIG'), ctx.node('OUT'), ctx.node('RST'), ctx.node('CTRL'), ctx.node('THR'), ctx.node('DIS'), ctx.node('VCC')],
        TIMER555.name,
      ),
    ],
    subckts: [TIMER555],
  }),
  provenance: 'MachSim behavioral 555 (divider, comparators, latch, output and discharge stages modelled after the NE555 block diagram; output high ≈ VCC - 1.7 V)',
  footprint: 'DIP-8',
  keywords: ['555', 'ne555', 'timer', 'astable', 'monostable', 'oscillator'],
};

// ---------------------------------------------------------------------------
// TL431-style shunt reference
// ---------------------------------------------------------------------------

const tl431: LibraryPartDef = {
  id: 'analog/tl431',
  name: 'TL431 Shunt Reference',
  group: 'analog',
  family: 'Voltage reference',
  description: 'Programmable shunt regulator: sinks cathode current to hold V(REF,A) at 2.495 V (VKA = 2.495·(1 + R1/R2) with a divider)',
  prefix: 'U',
  symbol: makeSymbol(
    [...diodeBody('zener'), line(-30, 0, -20, 0), line(20, 0, 30, 0), line(0, 7, 0, 20)],
    [pin('A', -30, 0, 'left', { number: '3' }), pin('K', 30, 0, 'right', { number: '1' }), pin('REF', 0, 20, 'down', { label: undefined, number: '2' })],
    { refPos: { x: 0, y: -16 }, valuePos: { x: 18, y: 24 } },
  ),
  params: [
    numParam('vref', 'Reference voltage', '2.495', 'V', { min: 0 }),
    numParam('gm', 'Transconductance', '5', 'A/V', { group: 'model', min: 0 }),
    numParam('iref', 'REF input current', '2u', 'A', { group: 'model', min: 0 }),
  ],
  toSpice: (ctx) => {
    const a = ctx.node('A');
    const k = ctx.node('K');
    const r = ctx.node('REF');
    const vref = ctx.num('vref');
    const gm = ctx.num('gm');
    if (!(gm > 0)) throw new Error('bad value for gm: must be > 0');
    const x = `(V(${r},${a})-${ex(vref)})`;
    const vka = `max(V(${k},${a}),0)`;
    const model = card('MS_TL431_D', 'D', { is: 1e-14, n: 1, rs: 1 });
    return {
      elements: [
        elB(ctx.name('B'), k, a, 'I', `${ex(gm)}*(${x}+sqrt(${x}*${x}+1e-8))/2*${vka}/(${vka}+0.1)`),
        elI(ctx.name('I', 'ref'), r, a, { dc: ctx.num('iref') }),
        elD(ctx.name('D'), a, k, model.name),
        elR(ctx.name('R', 'leak'), k, a, 1e8),
      ],
      models: [model],
    };
  },
  provenance: 'MachSim behavioral shunt reference: VREF 2.495 V, dynamic impedance ≈ 0.2 Ω (TL431 datasheet typicals), anode-cathode protection diode',
  footprint: 'TO-92',
  keywords: ['tl431', 'shunt regulator', 'reference', '2.5v'],
};

// ---------------------------------------------------------------------------
// Control-function blocks (single-ended, referenced to ground)
// ---------------------------------------------------------------------------

function blockSymbol(title: string, inputs: string[], output = 'OUT') {
  return boxSymbol({
    // single-input blocks are 60 units pin-to-pin like every two-terminal part
    w: inputs.length === 1 ? 40 : 60,
    h: Math.max(40, inputs.length * 20),
    left: inputs.map((n) => ({ name: n, type: 'input' as const })),
    right: [{ name: output, label: '', type: 'output' }],
    title,
  });
}

/** Signal of an input pin for block expressions: V(node), or 0 when the pin is unconnected. */
function inSig(ctx: ToSpiceContext, pinName: string): string {
  return pinConnected(ctx, pinName) ? `V(${ctx.node(pinName)})` : '0';
}

function block(slug: string, name: string, description: string, title: string, inputs: string[], params: ParamDef[], build: (ctx: ToSpiceContext) => { elements: ElementIR[] }, keywords: string[]): LibraryPartDef {
  return {
    id: `analog/${slug}`,
    name,
    group: 'analog',
    family: 'Control functions',
    description,
    prefix: 'A',
    symbol: blockSymbol(title, inputs),
    params,
    optionalPins: inputs.length > 1 ? inputs : [],
    toSpice: build,
    provenance: 'Ideal behavioral function block',
    virtual: true,
    keywords: ['control function', 'block', ...keywords],
  };
}

const controlBlocks: LibraryPartDef[] = [
  block(
    'multiplier',
    'Multiplier',
    'V(OUT) = k·V(X)·V(Y) + offset',
    '×',
    ['X', 'Y'],
    [numParam('k', 'Gain k', '1', '1/V', { showOnSchematic: true }), numParam('offset', 'Output offset', '0', 'V')],
    (ctx) => ({ elements: [elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', `${ex(ctx.num('k'))}*${inSig(ctx, 'X')}*${inSig(ctx, 'Y')}+${ex(ctx.num('offset'))}`)] }),
    ['multiplier', 'mixer', 'product'],
  ),
  block(
    'divider',
    'Divider',
    'V(OUT) = k·V(X)/V(Y) (smoothly bounded when V(Y) ≈ 0)',
    '÷',
    ['X', 'Y'],
    [numParam('k', 'Gain k', '1', 'V', { showOnSchematic: true })],
    (ctx) => {
      const y = inSig(ctx, 'Y');
      return { elements: [elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', `${ex(ctx.num('k'))}*${inSig(ctx, 'X')}*${y}/(${y}*${y}+1e-12)`)] };
    },
    ['divider', 'ratio'],
  ),
  block(
    'summer',
    'Summer',
    'V(OUT) = ka·V(A) + kb·V(B) + kc·V(C) + offset (unconnected inputs count as 0 V)',
    'Σ',
    ['A', 'B', 'C'],
    [numParam('ka', 'Gain A', '1', ''), numParam('kb', 'Gain B', '1', ''), numParam('kc', 'Gain C', '1', ''), numParam('offset', 'Offset', '0', 'V')],
    (ctx) => ({
      elements: [
        elB(
          ctx.name('B'),
          ctx.node('OUT'),
          '0',
          'V',
          `${ex(ctx.num('ka'))}*${inSig(ctx, 'A')}+${ex(ctx.num('kb'))}*${inSig(ctx, 'B')}+${ex(ctx.num('kc'))}*${inSig(ctx, 'C')}+${ex(ctx.num('offset'))}`,
        ),
      ],
    }),
    ['summer', 'adder', 'sum'],
  ),
  block(
    'gain-block',
    'Voltage Gain Block',
    'V(OUT) = k·V(IN) (ideal buffer amplifier referenced to ground)',
    'K',
    ['IN'],
    [numParam('k', 'Gain', '10', 'V/V', { showOnSchematic: true })],
    (ctx) => ({ elements: [elE(ctx.name('E'), ctx.node('OUT'), '0', ctx.node('IN'), '0', ctx.num('k'))] }),
    ['gain', 'amplifier', 'buffer'],
  ),
  block(
    'integrator',
    'Integrator',
    'V(OUT) = k·∫V(IN)dt + initial value',
    '∫',
    ['IN'],
    [numParam('k', 'Gain', '1', '1/s', { showOnSchematic: true }), numParam('ic', 'Initial output', '0', 'V')],
    (ctx) => {
      const n = internalNode(ctx, 'int');
      return {
        elements: [
          elG(ctx.name('G'), '0', n, ctx.node('IN'), '0', ctx.num('k')),
          elC(ctx.name('C'), n, '0', 1, { ic: ctx.num('ic') }),
          elR(ctx.name('R', 'leak'), n, '0', 1e12),
          elE(ctx.name('E'), ctx.node('OUT'), '0', n, '0', 1),
        ],
      };
    },
    ['integrator', 'integral'],
  ),
  block(
    'differentiator',
    'Differentiator',
    'V(OUT) = k·dV(IN)/dt',
    'd/dt',
    ['IN'],
    [numParam('k', 'Gain', '1m', 's', { showOnSchematic: true })],
    (ctx) => {
      const a = internalNode(ctx, 'a');
      const b = internalNode(ctx, 'b');
      const sense = ctx.name('V', 'sense');
      return {
        elements: [
          elE(ctx.name('E', 'in'), a, '0', ctx.node('IN'), '0', 1),
          elC(ctx.name('C'), a, b, 1),
          elSense(sense, b, '0'),
          elH(ctx.name('H'), ctx.node('OUT'), '0', sense, ctx.num('k')),
        ],
      };
    },
    ['differentiator', 'derivative'],
  ),
  block(
    'limiter',
    'Voltage Limiter',
    'V(OUT) = V(IN) clamped to [low, high]',
    'LIM',
    ['IN'],
    [numParam('high', 'Upper limit', '5', 'V'), numParam('low', 'Lower limit', '-5', 'V')],
    (ctx) => {
      const hi = ctx.num('high');
      const lo = ctx.num('low');
      if (!(hi > lo)) throw new Error('bad value for high: must exceed low');
      return { elements: [elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', `limit(V(${ctx.node('IN')}),${ex(lo)},${ex(hi)})`)] };
    },
    ['limiter', 'clamp', 'saturation'],
  ),
  block(
    'vco',
    'Voltage-Controlled Oscillator',
    'Output at f = f0 + kf·V(IN): sine, square, triangle or sawtooth of the given amplitude around the offset',
    'VCO',
    ['IN'],
    [
      numParam('f0', 'Free-running frequency', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
      numParam('kf', 'Tuning gain', '1k', 'Hz/V'),
      numParam('amplitude', 'Amplitude', '1', 'V', { min: 0 }),
      numParam('offset', 'Offset', '0', 'V'),
      selectParam('waveform', 'Waveform', 'sine', ['sine', 'square', 'triangle', 'sawtooth']),
    ],
    (ctx) => {
      const ph = internalNode(ctx, 'phase');
      const w = textOf(ctx, 'waveform', 'sine').trim().toLowerCase();
      const s = `sin(2*pi*V(${ph}))`;
      const shape = w === 'square' ? `tanh(20*${s})` : w === 'triangle' ? `(2/pi)*asin(${s})` : w === 'sawtooth' ? sawtoothOf(`V(${ph})`) : s;
      // phase (in cycles) integrates f: the u(time) factor keeps it at 0 in the operating point
      return {
        elements: [
          elB(ctx.name('B', 'f'), '0', ph, 'I', `u(time)*(${ex(ctx.num('f0'))}+${ex(ctx.num('kf'))}*${inSig(ctx, 'IN')})`),
          elC(ctx.name('C'), ph, '0', 1),
          elR(ctx.name('R', 'leak'), ph, '0', 1e15),
          elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', `${ex(ctx.num('offset'))}+${ex(ctx.num('amplitude'))}*${shape}`),
        ],
      };
    },
    ['vco', 'oscillator', 'voltage controlled oscillator'],
  ),
];

export const ANALOG_PARTS: LibraryPartDef[] = [
  idealOpamp3,
  idealOpamp5,
  genericOpamp,
  ...REAL_OPAMPS.map(realOpamp),
  ...comparators,
  inamp,
  timer555,
  tl431,
  ...controlBlocks,
];
