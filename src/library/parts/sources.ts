/**
 * Sources group: ground and supply rails, independent voltage / current sources with every
 * SPICE transient waveform, controlled sources, behavioral sources, battery, mains and
 * three-phase supplies.
 *
 * Conventions (see partkit.ts)
 * - Voltage sources: pins '+' / '-', element V [+, -].
 * - Current sources: the current leaves the part through '+' into the external circuit
 *   (element I [-, +], since SPICE current flows from n+ through the source to n-).
 * - Supply rails (VCC, VDD, VEE, VSS) are global nets AND an implicit DC source from the rail to
 *   ground. Every symbol of one rail emits the same element "V_PWR_<rail>", which the netlister
 *   de-duplicates; two symbols of one rail with different voltages are reported as a conflict.
 * - Ideal sources are `virtual` (not listed in a BOM); the battery is a physical part.
 */

import type { ElementIR, SourceSpec, Waveform } from '../../sim/netlist';
import { parseExpression } from '../../sim/spice/expr';
import {
  boolOf,
  boolParam,
  elB,
  elE,
  elF,
  elG,
  elH,
  elI,
  elR,
  elSense,
  elV,
  internalNode,
  mapExpressionNets,
  numParam,
  parsePairs,
  textOf,
  textParam,
  wAm,
  wExp,
  wPulse,
  wPwl,
  wSffm,
  wSin,
  type LibraryPartDef,
} from '../partkit';
import { circle, controlledSourceSymbol, groundSymbol, line, makeSymbol, pin, poly, railSymbol, sourceSymbol, text } from '../symbols';
import type { ParamDef, ToSpiceContext } from '../types';

// ---------------------------------------------------------------------------
// Supply rails
// ---------------------------------------------------------------------------

const ground: LibraryPartDef = {
  id: 'sources/ground',
  name: 'Ground',
  group: 'sources',
  family: 'Power',
  description: 'Reference ground (SPICE node 0). Every circuit needs at least one.',
  prefix: 'GND',
  globalNet: '0',
  virtual: true,
  symbol: groundSymbol(),
  params: [],
  keywords: ['gnd', '0', 'earth', 'reference'],
};

function rail(net: string, volts: string, up: boolean, description: string): LibraryPartDef {
  return {
    id: `sources/${net.toLowerCase()}`,
    name: net,
    group: 'sources',
    family: 'Power',
    description,
    prefix: net,
    globalNet: net,
    virtual: true,
    symbol: railSymbol(net, up),
    params: [numParam('voltage', 'Voltage', volts, 'V', { showOnSchematic: true, help: `DC voltage of the ${net} rail with respect to ground` })],
    toSpice: (ctx) => ({ elements: [elV(`V_PWR_${net}`, ctx.node('1'), '0', { dc: ctx.num('voltage') })] }),
    keywords: ['supply', 'rail', 'power', net.toLowerCase()],
  };
}

const vcc = rail('VCC', '5', true, 'Positive supply rail VCC (global net with an implicit DC source to ground)');
const vdd = rail('VDD', '5', true, 'Positive supply rail VDD (global net with an implicit DC source to ground)');
const vee = rail('VEE', '-5', false, 'Negative supply rail VEE (global net with an implicit DC source to ground)');
const vss = rail('VSS', '0', false, 'Supply rail VSS (global net with an implicit DC source to ground, 0 V by default)');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Kind = 'V' | 'I';

function unitOf(kind: Kind): string {
  return kind === 'V' ? 'V' : 'A';
}

/** Independent source element in the catalogue's pin convention. */
function srcEl(ctx: ToSpiceContext, kind: Kind, spec: SourceSpec, suffix?: string): ElementIR {
  const name = ctx.name(kind, suffix);
  return kind === 'V' ? elV(name, ctx.node('+'), ctx.node('-'), spec) : elI(name, ctx.node('-'), ctx.node('+'), spec);
}

function acParams(defMag = '0'): ParamDef[] {
  return [
    numParam('acmag', 'AC analysis magnitude', defMag, '', { group: 'advanced', help: 'Small-signal magnitude used by AC / noise analyses' }),
    numParam('acphase', 'AC analysis phase', '0', '°', { group: 'advanced' }),
  ];
}

function acSpec(ctx: ToSpiceContext): Pick<SourceSpec, 'acMag' | 'acPhase'> {
  const mag = ctx.num('acmag');
  const out: Pick<SourceSpec, 'acMag' | 'acPhase'> = {};
  if (mag !== 0) {
    out.acMag = mag;
    const ph = ctx.num('acphase');
    if (ph !== 0) out.acPhase = ph;
  }
  return out;
}

function sourcePart(
  kind: Kind,
  slug: string,
  name: string,
  description: string,
  glyph: Parameters<typeof sourceSymbol>[0],
  params: ParamDef[],
  wave: (ctx: ToSpiceContext) => SourceSpec,
  keywords: string[] = [],
): LibraryPartDef {
  return {
    id: `sources/${slug}`,
    name,
    group: 'sources',
    family: kind === 'V' ? 'Voltage sources' : 'Current sources',
    description,
    prefix: kind,
    virtual: true,
    symbol: sourceSymbol(glyph),
    params,
    toSpice: (ctx) => ({ elements: [srcEl(ctx, kind, wave(ctx))] }),
    keywords,
  };
}

// ---------------------------------------------------------------------------
// DC and sinusoidal sources
// ---------------------------------------------------------------------------

const dcVoltage = sourcePart(
  'V',
  'dc-voltage',
  'DC Voltage Source',
  'Ideal DC voltage source',
  'dc',
  [numParam('value', 'Voltage', '12', 'V', { showOnSchematic: true }), ...acParams()],
  (ctx) => ({ dc: ctx.num('value'), ...acSpec(ctx) }),
  ['dc', 'battery', 'supply'],
);

const dcCurrent = sourcePart(
  'I',
  'dc-current',
  'DC Current Source',
  'Ideal DC current source; the current leaves through the + terminal',
  'current',
  [numParam('value', 'Current', '1m', 'A', { showOnSchematic: true }), ...acParams()],
  (ctx) => ({ dc: ctx.num('value'), ...acSpec(ctx) }),
  ['dc', 'constant current'],
);

function sineParams(kind: Kind): ParamDef[] {
  const u = unitOf(kind);
  return [
    numParam('amplitude', 'Amplitude (peak)', kind === 'V' ? '1' : '1m', u, { showOnSchematic: true }),
    numParam('freq', 'Frequency', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('offset', 'Offset', '0', u, { group: 'waveform' }),
    numParam('phase', 'Phase', '0', '°', { group: 'waveform' }),
    numParam('delay', 'Time delay', '0', 's', { group: 'waveform', min: 0 }),
    numParam('damping', 'Damping factor', '0', '1/s', { group: 'waveform', min: 0 }),
    ...acParams('1'),
  ];
}

function sineSpec(ctx: ToSpiceContext): SourceSpec {
  return {
    tran: wSin(ctx.num('offset'), ctx.num('amplitude'), ctx.num('freq'), ctx.num('delay'), ctx.num('damping'), ctx.num('phase')),
    ...acSpec(ctx),
  };
}

const acVoltage = sourcePart('V', 'ac-voltage', 'AC Voltage Source', 'Sinusoidal voltage source (transient SIN + AC magnitude)', 'ac', sineParams('V'), sineSpec, [
  'sine',
  'sinusoid',
  'signal',
]);
const acCurrent = sourcePart('I', 'ac-current', 'AC Current Source', 'Sinusoidal current source (transient SIN + AC magnitude)', 'ac-current', sineParams('I'), sineSpec, [
  'sine',
  'sinusoid',
]);

const acPower: LibraryPartDef = {
  ...sourcePart(
    'V',
    'ac-power',
    'AC Power (Mains)',
    'Mains supply specified by its RMS voltage and line frequency',
    'ac',
    [
      numParam('vrms', 'Voltage (RMS)', '120', 'V', { showOnSchematic: true, min: 0 }),
      numParam('freq', 'Frequency', '60', 'Hz', { showOnSchematic: true, min: 0 }),
      numParam('phase', 'Phase', '0', '°', { group: 'waveform' }),
      ...acParams('0'),
    ],
    (ctx) => ({ tran: wSin(0, ctx.num('vrms') * Math.SQRT2, ctx.num('freq'), 0, 0, ctx.num('phase')), ...acSpec(ctx) }),
    ['mains', 'line', 'grid', '230v', '120v'],
  ),
  family: 'Power',
};

// ---------------------------------------------------------------------------
// Pulse family
// ---------------------------------------------------------------------------

function clockSpec(ctx: ToSpiceContext, lowKey: string, highKey: string): SourceSpec {
  const f = ctx.num('freq');
  if (!(f > 0)) throw new Error('bad value for freq: frequency must be > 0');
  const per = 1 / f;
  const duty = ctx.num('duty') / 100;
  if (!(duty > 0 && duty < 1)) throw new Error('bad value for duty: duty cycle must be between 0 and 100 %');
  const tr = Math.min(ctx.num('rise'), per / 4);
  const tf = Math.min(ctx.num('fall'), per / 4);
  if (!(tr > 0 && tf > 0)) throw new Error('bad value for rise/fall: edge times must be > 0');
  const pw = Math.max(0, duty * per - (tr + tf) / 2);
  return { tran: wPulse(ctx.num(lowKey), ctx.num(highKey), 0, tr, tf, pw, per) };
}

function clockParams(kind: Kind): ParamDef[] {
  const u = unitOf(kind);
  return [
    numParam('freq', 'Frequency', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('duty', 'Duty cycle', '50', '%', { min: 0, max: 100 }),
    numParam('high', 'High level', kind === 'V' ? '5' : '1m', u, { showOnSchematic: true }),
    numParam('low', 'Low level', '0', u),
    numParam('rise', 'Rise time', '1n', 's', { group: 'waveform', min: 0 }),
    numParam('fall', 'Fall time', '1n', 's', { group: 'waveform', min: 0 }),
  ];
}

const clockVoltage = sourcePart('V', 'clock-voltage', 'Clock Voltage Source', 'Square-wave clock (duty cycle measured at the 50 % points)', 'clock', clockParams('V'), (ctx) =>
  clockSpec(ctx, 'low', 'high'),
  ['square', 'clock', 'oscillator'],
);
const clockCurrent = sourcePart('I', 'clock-current', 'Clock Current Source', 'Square-wave current source', 'clock', clockParams('I'), (ctx) => clockSpec(ctx, 'low', 'high'), [
  'square',
  'clock',
]);

function pulseParams(kind: Kind): ParamDef[] {
  const u = unitOf(kind);
  return [
    numParam('v1', 'Initial value', '0', u, { showOnSchematic: true }),
    numParam('v2', 'Pulsed value', kind === 'V' ? '5' : '1m', u, { showOnSchematic: true }),
    numParam('delay', 'Delay time', '0', 's', { group: 'waveform', min: 0 }),
    numParam('rise', 'Rise time', '1n', 's', { group: 'waveform', min: 0 }),
    numParam('fall', 'Fall time', '1n', 's', { group: 'waveform', min: 0 }),
    numParam('width', 'Pulse width', '0.5m', 's', { group: 'waveform', min: 0 }),
    numParam('period', 'Period', '1m', 's', { group: 'waveform', min: 0 }),
    ...acParams(),
  ];
}

function pulseSpec(ctx: ToSpiceContext): SourceSpec {
  const tr = ctx.num('rise');
  const tf = ctx.num('fall');
  if (!(tr > 0 && tf > 0)) throw new Error('bad value for rise/fall: edge times must be > 0');
  return {
    tran: wPulse(ctx.num('v1'), ctx.num('v2'), ctx.num('delay'), tr, tf, ctx.num('width'), ctx.num('period')),
    ...acSpec(ctx),
  };
}

const pulseVoltage = sourcePart('V', 'pulse-voltage', 'Pulse Voltage Source', 'Trapezoidal pulse train (SPICE PULSE)', 'pulse', pulseParams('V'), pulseSpec, ['pulse', 'step']);
const pulseCurrent = sourcePart('I', 'pulse-current', 'Pulse Current Source', 'Trapezoidal current pulse train (SPICE PULSE)', 'pulse', pulseParams('I'), pulseSpec, ['pulse']);

// ---------------------------------------------------------------------------
// PWL, EXP, FM, AM
// ---------------------------------------------------------------------------

function pwlParams(kind: Kind): ParamDef[] {
  return [
    textParam('points', 'Time / value pairs', kind === 'V' ? '0 0, 1m 5, 2m 5, 3m 0' : '0 0, 1m 1m, 2m 0', {
      showOnSchematic: false,
      help: 'Comma-separated "time value" pairs, times non-decreasing (user number syntax, e.g. "0 0, 1m 5")',
    }),
    boolParam('repeat', 'Repeat waveform', false, { group: 'waveform' }),
    ...acParams(),
  ];
}

function pwlSpec(ctx: ToSpiceContext): SourceSpec {
  let pairs: number[];
  try {
    pairs = parsePairs(textOf(ctx, 'points'));
  } catch (e) {
    throw new Error(`bad value for points: ${(e as Error).message}`);
  }
  return { tran: wPwl(pairs, boolOf(ctx, 'repeat')), ...acSpec(ctx) };
}

const pwlVoltage = sourcePart('V', 'pwl-voltage', 'PWL Voltage Source', 'Piecewise-linear voltage source', 'pwl', pwlParams('V'), pwlSpec, ['piecewise', 'pwl', 'arbitrary']);
const pwlCurrent = sourcePart('I', 'pwl-current', 'PWL Current Source', 'Piecewise-linear current source', 'pwl', pwlParams('I'), pwlSpec, ['piecewise', 'pwl']);

function expParams(kind: Kind): ParamDef[] {
  const u = unitOf(kind);
  return [
    numParam('v1', 'Initial value', '0', u, { showOnSchematic: true }),
    numParam('v2', 'Pulsed value', kind === 'V' ? '5' : '1m', u, { showOnSchematic: true }),
    numParam('td1', 'Rise delay', '0', 's', { group: 'waveform', min: 0 }),
    numParam('tau1', 'Rise time constant', '1m', 's', { group: 'waveform', min: 0 }),
    numParam('td2', 'Fall delay', '5m', 's', { group: 'waveform', min: 0 }),
    numParam('tau2', 'Fall time constant', '1m', 's', { group: 'waveform', min: 0 }),
    ...acParams(),
  ];
}

function expSpec(ctx: ToSpiceContext): SourceSpec {
  return { tran: wExp(ctx.num('v1'), ctx.num('v2'), ctx.num('td1'), ctx.num('tau1'), ctx.num('td2'), ctx.num('tau2')), ...acSpec(ctx) };
}

const expVoltage = sourcePart('V', 'exp-voltage', 'Exponential Voltage Source', 'Exponential rise / fall (SPICE EXP)', 'exp', expParams('V'), expSpec, ['exponential', 'exp']);
const expCurrent = sourcePart('I', 'exp-current', 'Exponential Current Source', 'Exponential rise / fall current (SPICE EXP)', 'exp', expParams('I'), expSpec, ['exponential', 'exp']);

function fmParams(kind: Kind): ParamDef[] {
  const u = unitOf(kind);
  return [
    numParam('amplitude', 'Amplitude (peak)', kind === 'V' ? '1' : '1m', u, { showOnSchematic: true }),
    numParam('offset', 'Offset', '0', u),
    numParam('carrier', 'Carrier frequency', '10k', 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('index', 'Modulation index', '5', '', { min: 0 }),
    numParam('modfreq', 'Signal frequency', '1k', 'Hz', { min: 0 }),
    ...acParams(),
  ];
}

function fmSpec(ctx: ToSpiceContext): SourceSpec {
  return { tran: wSffm(ctx.num('offset'), ctx.num('amplitude'), ctx.num('carrier'), ctx.num('index'), ctx.num('modfreq')), ...acSpec(ctx) };
}

const fmVoltage = sourcePart('V', 'fm-voltage', 'FM Voltage Source', 'Single-frequency FM source (SPICE SFFM)', 'fm', fmParams('V'), fmSpec, ['fm', 'frequency modulation', 'sffm']);
const fmCurrent = sourcePart('I', 'fm-current', 'FM Current Source', 'Single-frequency FM current source (SPICE SFFM)', 'fm', fmParams('I'), fmSpec, ['fm', 'sffm']);

function amParams(kind: Kind): ParamDef[] {
  const u = unitOf(kind);
  return [
    numParam('amplitude', 'Carrier amplitude', kind === 'V' ? '1' : '1m', u, { showOnSchematic: true }),
    numParam('carrier', 'Carrier frequency', '10k', 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('index', 'Modulation index', '0.5', '', { min: 0 }),
    numParam('modfreq', 'Modulation frequency', '1k', 'Hz', { min: 0 }),
    numParam('delay', 'Delay', '0', 's', { group: 'waveform', min: 0 }),
    ...acParams(),
  ];
}

/**
 * Carrier amplitude A, index m: v = A (1 + m sin(2π fm t)) sin(2π fc t), written as SPICE
 * AM(VA = A m, VO = 1/m, MF = fm, FC = fc, TD). m = 0 gives the plain carrier (SIN).
 */
function amSpec(ctx: ToSpiceContext): SourceSpec {
  const a = ctx.num('amplitude');
  const m = ctx.num('index');
  const fc = ctx.num('carrier');
  const td = ctx.num('delay');
  const tran: Waveform = m > 0 ? wAm(a * m, 1 / m, ctx.num('modfreq'), fc, td) : wSin(0, a, fc, td);
  return { tran, ...acSpec(ctx) };
}

const amVoltage = sourcePart('V', 'am-voltage', 'AM Voltage Source', 'Amplitude-modulated carrier (SPICE AM)', 'am', amParams('V'), amSpec, ['am', 'amplitude modulation']);
const amCurrent = sourcePart('I', 'am-current', 'AM Current Source', 'Amplitude-modulated current (SPICE AM)', 'am', amParams('I'), amSpec, ['am']);

// ---------------------------------------------------------------------------
// Controlled sources
// ---------------------------------------------------------------------------

const vcvs: LibraryPartDef = {
  id: 'sources/vcvs',
  name: 'Voltage-Controlled Voltage Source',
  group: 'sources',
  family: 'Controlled sources',
  description: 'V(out+,out-) = gain · V(in+,in-)',
  prefix: 'E',
  virtual: true,
  symbol: controlledSourceSymbol('voltage', false),
  params: [numParam('gain', 'Voltage gain', '1', 'V/V', { showOnSchematic: true })],
  toSpice: (ctx) => ({ elements: [elE(ctx.name('E'), ctx.node('out+'), ctx.node('out-'), ctx.node('in+'), ctx.node('in-'), ctx.num('gain'))] }),
  keywords: ['vcvs', 'dependent', 'e source', 'amplifier'],
};

const vccs: LibraryPartDef = {
  id: 'sources/vccs',
  name: 'Voltage-Controlled Current Source',
  group: 'sources',
  family: 'Controlled sources',
  description: 'Current gm · V(in+,in-) leaves through out+',
  prefix: 'G',
  virtual: true,
  symbol: controlledSourceSymbol('current', false),
  params: [numParam('gm', 'Transconductance', '1m', 'S', { showOnSchematic: true })],
  toSpice: (ctx) => ({ elements: [elG(ctx.name('G'), ctx.node('out-'), ctx.node('out+'), ctx.node('in+'), ctx.node('in-'), ctx.num('gm'))] }),
  keywords: ['vccs', 'dependent', 'transconductance', 'g source'],
};

const ccvs: LibraryPartDef = {
  id: 'sources/ccvs',
  name: 'Current-Controlled Voltage Source',
  group: 'sources',
  family: 'Controlled sources',
  description: 'V(out+,out-) = rm · I, where I flows into in+ and out of in- (0 V sense path)',
  prefix: 'H',
  virtual: true,
  symbol: controlledSourceSymbol('voltage', true),
  params: [numParam('rm', 'Transresistance', '1k', 'Ω', { showOnSchematic: true })],
  toSpice: (ctx) => {
    const sense = ctx.name('V', 'sense');
    return {
      elements: [elSense(sense, ctx.node('in+'), ctx.node('in-')), elH(ctx.name('H'), ctx.node('out+'), ctx.node('out-'), sense, ctx.num('rm'))],
    };
  },
  keywords: ['ccvs', 'dependent', 'transresistance', 'h source'],
};

const cccs: LibraryPartDef = {
  id: 'sources/cccs',
  name: 'Current-Controlled Current Source',
  group: 'sources',
  family: 'Controlled sources',
  description: 'Current gain · I leaves through out+, where I flows into in+ and out of in- (0 V sense path)',
  prefix: 'F',
  virtual: true,
  symbol: controlledSourceSymbol('current', true),
  params: [numParam('gain', 'Current gain', '1', 'A/A', { showOnSchematic: true })],
  toSpice: (ctx) => {
    const sense = ctx.name('V', 'sense');
    return {
      elements: [elSense(sense, ctx.node('in+'), ctx.node('in-')), elF(ctx.name('F'), ctx.node('out-'), ctx.node('out+'), sense, ctx.num('gain'))],
    };
  },
  keywords: ['cccs', 'dependent', 'current mirror', 'f source'],
};

// ---------------------------------------------------------------------------
// Behavioral sources
// ---------------------------------------------------------------------------

function checkExpression(expr: string): void {
  if (expr.trim() === '') throw new Error('bad value for expr: expression is empty');
  try {
    parseExpression(expr);
  } catch (e) {
    throw new Error(`bad value for expr: ${(e as Error).message}`);
  }
}

function behavioral(kind: Kind): LibraryPartDef {
  const isV = kind === 'V';
  return {
    id: `sources/behavioral-${isV ? 'voltage' : 'current'}`,
    name: isV ? 'Behavioral Voltage Source' : 'Behavioral Current Source',
    group: 'sources',
    family: 'Controlled sources',
    description: isV
      ? 'Arbitrary voltage V(+,-) = f(...) of node voltages V(net), branch currents I(Vx) and time'
      : 'Arbitrary current f(...) leaving through + (node voltages V(net), branch currents I(Vx), time)',
    prefix: 'B',
    virtual: true,
    symbol: sourceSymbol(isV ? 'expr' : 'current', { diamond: true, extra: isV ? [] : [text(10, 4, 'f', 8, 'start')] }),
    params: [
      textParam('expr', 'Expression', isV ? '5*sin(2*pi*50*time)' : '1m*(1+sin(2*pi*1k*time))', {
        showOnSchematic: true,
        help: 'Expression in node voltages V(net) or V(net1,net2) (net = label name), branch currents I(Vname), time, temper; functions sin, exp, tanh, min, max, limit, if, table ...',
      }),
    ],
    toSpice: (ctx) => {
      const raw = textOf(ctx, 'expr');
      checkExpression(raw);
      const expr = mapExpressionNets(ctx, raw);
      return {
        elements: [isV ? elB(ctx.name('B'), ctx.node('+'), ctx.node('-'), 'V', expr) : elB(ctx.name('B'), ctx.node('-'), ctx.node('+'), 'I', expr)],
      };
    },
    keywords: ['abm', 'behavioral', 'arbitrary', 'expression', 'b source', 'nonlinear'],
  };
}

// ---------------------------------------------------------------------------
// Battery and polyphase supplies
// ---------------------------------------------------------------------------

const battery: LibraryPartDef = {
  id: 'sources/battery',
  name: 'Battery',
  group: 'sources',
  family: 'Power',
  description: 'Battery: ideal EMF in series with an internal resistance',
  prefix: 'BAT',
  symbol: makeSymbol(
    [
      line(0, -30, 0, -8),
      line(-11, -8, 11, -8, 2),
      line(-5, -3, 5, -3, 3),
      line(-11, 3, 11, 3, 2),
      line(-5, 8, 5, 8, 3),
      line(0, 8, 0, 30),
      text(14, -12, '+', 10, 'start'),
    ],
    [pin('+', 0, -30, 'up', { number: '1' }), pin('-', 0, 30, 'down', { number: '2' })],
    { refPos: { x: 18, y: 2 }, valuePos: { x: 18, y: 14 } },
  ),
  params: [
    numParam('value', 'Voltage', '9', 'V', { showOnSchematic: true }),
    numParam('rint', 'Internal resistance', '0.5', 'Ω', { min: 0, help: '0 = ideal' }),
  ],
  toSpice: (ctx) => {
    const r = ctx.num('rint');
    if (r < 0) throw new Error('bad value for rint: must be >= 0');
    if (r === 0) return { elements: [elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), { dc: ctx.num('value') })] };
    const mid = internalNode(ctx, 'emf');
    return { elements: [elV(ctx.name('V'), mid, ctx.node('-'), { dc: ctx.num('value') }), elR(ctx.name('R', 'int'), mid, ctx.node('+'), r)] };
  },
  footprint: 'BATTERY-2P',
  keywords: ['cell', 'battery', 'dc', '9v', 'aa'],
};

export function threePhaseSymbol(wye: boolean): ReturnType<typeof makeSymbol> {
  const prims = [
    circle(0, 0, 20),
    line(20, -20, 30, -20),
    line(20, 0, 30, 0),
    line(20, 20, 30, 20),
    text(0, -6, '3~', 9, 'middle', true),
  ];
  const pins = [pin('L1', 30, -20, 'right', { label: 'L1', number: '1' }), pin('L2', 30, 0, 'right', { label: 'L2', number: '2' }), pin('L3', 30, 20, 'right', { label: 'L3', number: '3' })];
  if (wye) {
    prims.push(line(-6, 4, 0, 9), line(6, 4, 0, 9), line(0, 9, 0, 15), line(-30, 0, -20, 0));
    pins.push(pin('N', -30, 0, 'left', { label: 'N', number: '4' }));
  } else {
    prims.push(poly([-6, 13, 6, 13, 0, 3], true));
  }
  return makeSymbol(prims, pins, { refPos: { x: 0, y: -26 }, valuePos: { x: 0, y: 34 } });
}

const threePhaseWye: LibraryPartDef = {
  id: 'sources/three-phase-wye',
  name: 'Three-Phase Source (Wye)',
  group: 'sources',
  family: 'Power',
  description: 'Balanced three-phase star source; phase voltages L1-N, L2-N, L3-N at 0°, -120°, +120°',
  prefix: 'V',
  virtual: true,
  symbol: threePhaseSymbol(true),
  params: [
    numParam('vrms', 'Phase voltage (RMS)', '120', 'V', { showOnSchematic: true, min: 0 }),
    numParam('freq', 'Frequency', '60', 'Hz', { showOnSchematic: true, min: 0 }),
  ],
  toSpice: (ctx) => {
    const vp = ctx.num('vrms') * Math.SQRT2;
    const f = ctx.num('freq');
    const n = ctx.node('N');
    return {
      elements: [
        elV(ctx.name('V', 'L1'), ctx.node('L1'), n, { tran: wSin(0, vp, f, 0, 0, 0) }),
        elV(ctx.name('V', 'L2'), ctx.node('L2'), n, { tran: wSin(0, vp, f, 0, 0, -120) }),
        elV(ctx.name('V', 'L3'), ctx.node('L3'), n, { tran: wSin(0, vp, f, 0, 0, 120) }),
      ],
    };
  },
  keywords: ['three phase', '3 phase', 'star', 'wye', 'polyphase'],
};

const threePhaseDelta: LibraryPartDef = {
  id: 'sources/three-phase-delta',
  name: 'Three-Phase Source (Delta)',
  group: 'sources',
  family: 'Power',
  description: 'Balanced three-phase delta source given by its line voltage (L1-L2 at 0°, L2-L3 at -120°; L3-L1 follows)',
  prefix: 'V',
  virtual: true,
  symbol: threePhaseSymbol(false),
  params: [
    numParam('vrms', 'Line voltage (RMS)', '208', 'V', { showOnSchematic: true, min: 0 }),
    numParam('freq', 'Frequency', '60', 'Hz', { showOnSchematic: true, min: 0 }),
  ],
  // Two sources only: a closed triangle of three ideal sources would be a voltage-source loop.
  toSpice: (ctx) => {
    const vp = ctx.num('vrms') * Math.SQRT2;
    const f = ctx.num('freq');
    return {
      elements: [
        elV(ctx.name('V', 'L12'), ctx.node('L1'), ctx.node('L2'), { tran: wSin(0, vp, f, 0, 0, 0) }),
        elV(ctx.name('V', 'L23'), ctx.node('L2'), ctx.node('L3'), { tran: wSin(0, vp, f, 0, 0, -120) }),
      ],
    };
  },
  keywords: ['three phase', '3 phase', 'delta', 'polyphase'],
};

export const SOURCE_PARTS: LibraryPartDef[] = [
  ground,
  vcc,
  vdd,
  vee,
  vss,
  dcVoltage,
  dcCurrent,
  acVoltage,
  acCurrent,
  acPower,
  clockVoltage,
  clockCurrent,
  pulseVoltage,
  pulseCurrent,
  pwlVoltage,
  pwlCurrent,
  expVoltage,
  expCurrent,
  fmVoltage,
  fmCurrent,
  amVoltage,
  amCurrent,
  vcvs,
  vccs,
  ccvs,
  cccs,
  behavioral('V'),
  behavioral('I'),
  battery,
  threePhaseWye,
  threePhaseDelta,
];
