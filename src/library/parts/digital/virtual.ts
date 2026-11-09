/**
 * Misc-digital group: ideal ("virtual") logic elements without package or power pins.
 *
 * Levels 0 / vhigh referenced to ground, input threshold `threshold`, propagation delay
 * `delay`, 1 ns edges, 10 Ω outputs. Gates use IEEE distinctive-shape symbols (inputs A, B, C,
 * D; output Y). Flip-flops have optional active-low ~SET / ~RESET pins: an unconnected pin is
 * an XSPICE NULL port (inactive).
 */
import type { ParamDef, ToSpiceContext } from '../../types';
import { boolParam, numParam, selectParam, textParam, type LibraryPartDef } from '../../partkit';
import { parseWordPattern } from '../instruments';
import { aElement, bufferSymbol, familyModel, gateSymbol, icSymbol, idealLevels, inp, optionalNode, out, type FamilyLevels, type PowerNodes } from './kit';

const GROUND_REF: PowerNodes = { nodes: ['0'], pwr: 1 };

function levelParams(delay = '10n'): ParamDef[] {
  return [
    numParam('delay', 'Propagation delay', delay, 's', { min: 0, group: 'model' }),
    numParam('vhigh', 'Output high level', '5', 'V', { min: 0.1, group: 'model' }),
    numParam('threshold', 'Input threshold', '2.5', 'V', { group: 'model' }),
  ];
}

function levelsOf(ctx: ToSpiceContext): FamilyLevels {
  const vhigh = ctx.num('vhigh');
  if (!(vhigh > 0)) throw new Error('bad value for vhigh: must be > 0');
  return idealLevels(vhigh, Math.max(0, ctx.num('delay')), ctx.num('threshold'));
}

function virtualPart(p: Omit<LibraryPartDef, 'group' | 'prefix' | 'virtual'>): LibraryPartDef {
  return { group: 'misc-digital', prefix: 'U', virtual: true, ...p };
}

const GATES: [string, string, 'and' | 'or' | 'xor', boolean, number][] = [
  ['and2', 'AND', 'and', false, 2],
  ['and3', 'AND', 'and', false, 3],
  ['and4', 'AND', 'and', false, 4],
  ['or2', 'OR', 'or', false, 2],
  ['or3', 'OR', 'or', false, 3],
  ['or4', 'OR', 'or', false, 4],
  ['nand2', 'NAND', 'and', true, 2],
  ['nand3', 'NAND', 'and', true, 3],
  ['nand4', 'NAND', 'and', true, 4],
  ['nor2', 'NOR', 'or', true, 2],
  ['nor3', 'NOR', 'or', true, 3],
  ['xor2', 'XOR', 'xor', false, 2],
  ['xnor2', 'XNOR', 'xor', true, 2],
];

const gateParts: LibraryPartDef[] = GATES.map(([slug, fn, shape, invert, n]) => {
  const names = ['A', 'B', 'C', 'D'].slice(0, n);
  return virtualPart({
    id: `misc-digital/${slug}`,
    name: `${fn}${n}`,
    family: 'Virtual gates',
    description: `Ideal ${n}-input ${fn} gate`,
    symbol: gateSymbol(shape, n, invert, names),
    params: levelParams(),
    toSpice: (ctx) => {
      const m = familyModel(`MS_VIRT_${fn}`, `D_${fn}`, levelsOf(ctx));
      return { elements: [aElement(ctx.name('A'), [...names.map((p) => ctx.node(p)), ctx.node('Y')], GROUND_REF, m.name)], models: [m] };
    },
    keywords: [fn.toLowerCase(), 'gate', 'logic', 'virtual'],
  });
});

function bufferPart(slug: string, name: string, type: string, invert: boolean, description: string, schmitt = false): LibraryPartDef {
  const extraParams: ParamDef[] = schmitt
    ? [numParam('vtp', 'Upper threshold VT+', '3', 'V', { group: 'model' }), numParam('vtn', 'Lower threshold VT-', '2', 'V', { group: 'model' })]
    : [];
  return virtualPart({
    id: `misc-digital/${slug}`,
    name,
    family: 'Virtual gates',
    description,
    symbol: bufferSymbol(invert, { schmitt }),
    params: [...levelParams(), ...extraParams],
    toSpice: (ctx) => {
      const extra: Record<string, number> = schmitt ? { vtp: ctx.num('vtp'), vtn: ctx.num('vtn') } : {};
      if (schmitt && !(extra.vtp > extra.vtn)) throw new Error('bad value for vtp: VT+ must be above VT-');
      const m = familyModel(`MS_VIRT_${name.replace(/\W/g, '')}`, type, levelsOf(ctx), 1, extra);
      return { elements: [aElement(ctx.name('A'), [ctx.node('A'), ctx.node('Y')], GROUND_REF, m.name)], models: [m] };
    },
    keywords: [name.toLowerCase(), 'gate', 'logic', 'virtual', ...(schmitt ? ['schmitt', 'hysteresis'] : [])],
  });
}

const tristate = virtualPart({
  id: 'misc-digital/tristate-buffer',
  name: 'Tri-state buffer',
  family: 'Virtual gates',
  description: 'Ideal non-inverting buffer with 3-state output: Y = A while EN is active, high impedance otherwise',
  symbol: bufferSymbol(false, { enable: true }),
  params: [...levelParams(), selectParam('enable', 'Enable polarity', 'high', [['high', 'Active high'], ['low', 'Active low']], { group: 'model' })],
  toSpice: (ctx) => {
    const m = familyModel('MS_VIRT_TRI', 'D_TRISTATE', levelsOf(ctx), 1, { enable_low: ctx.params.enable === 'low' ? 1 : 0 });
    return { elements: [aElement(ctx.name('A'), [ctx.node('A'), ctx.node('EN'), ctx.node('Y')], GROUND_REF, m.name)], models: [m] };
  },
  keywords: ['tri-state', '3-state', 'buffer', 'bus', 'virtual'],
});

interface FfSpec {
  slug: string;
  name: string;
  type: string;
  data: string[];
  clockName: string;
  defaultEdge: 'rising' | 'falling';
  description: string;
  latch?: boolean;
}

function ffPart(s: FfSpec): LibraryPartDef {
  const clockPin = s.clockName ? [s.latch ? inp(s.clockName) : inp(s.clockName, undefined, s.clockName, true)] : [];
  const left = [...s.data.map((d) => inp(d)), ...clockPin];
  const hasAsync = !s.latch || s.type === 'D_DLATCH';
  const params: ParamDef[] = [...levelParams()];
  if (!s.latch) params.push(selectParam('edge', 'Clock edge', s.defaultEdge, [['rising', 'Rising'], ['falling', 'Falling']], { group: 'model' }));
  return virtualPart({
    id: `misc-digital/${s.slug}`,
    name: s.name,
    family: s.latch ? 'Virtual latches' : 'Virtual flip-flops',
    description: s.description,
    symbol: icSymbol(s.name, left, [out('Q'), out('QN', undefined, '~Q')], hasAsync ? { w: 60, top: [inp('SET', undefined, '~S')], bottom: [inp('RESET', undefined, '~R')] } : { w: 60 }),
    params,
    optionalPins: hasAsync ? ['SET', 'RESET'] : [],
    toSpice: (ctx) => {
      const extra: Record<string, number> = { set_low: 1, reset_low: 1 };
      if (!s.latch) extra.clk_edge = (ctx.params.edge ?? s.defaultEdge) === 'falling' ? 0 : 1;
      const m = familyModel(`MS_VIRT_${s.type.replace(/^D_/, '')}`, s.type, levelsOf(ctx), 1, extra);
      const asyncNodes = hasAsync ? [optionalNode(ctx, 'SET'), optionalNode(ctx, 'RESET')] : ['null', 'null'];
      const ports = s.type === 'D_SRLATCH' ? [ctx.node('S'), ctx.node('R'), 'null', ...asyncNodes] : [...s.data.map((d) => ctx.node(d)), ctx.node(s.clockName), ...asyncNodes];
      return { elements: [aElement(ctx.name('A'), [...ports, ctx.node('Q'), ctx.node('QN')], GROUND_REF, m.name)], models: [m] };
    },
    keywords: [s.name.toLowerCase(), s.latch ? 'latch' : 'flip-flop', 'virtual'],
  });
}

const ffParts: LibraryPartDef[] = [
  ffPart({ slug: 'dff', name: 'D FF', type: 'D_DFF', data: ['D'], clockName: 'CLK', defaultEdge: 'rising', description: 'Ideal edge-triggered D flip-flop with optional active-low asynchronous set / reset' }),
  ffPart({ slug: 'jkff', name: 'JK FF', type: 'D_JKFF', data: ['J', 'K'], clockName: 'CLK', defaultEdge: 'falling', description: 'Ideal edge-triggered JK flip-flop (J = K = 1 toggles) with optional active-low set / reset' }),
  ffPart({ slug: 'tff', name: 'T FF', type: 'D_TFF', data: ['T'], clockName: 'CLK', defaultEdge: 'rising', description: 'Ideal toggle flip-flop: Q changes on each active clock edge while T is high' }),
  ffPart({ slug: 'sr-latch', name: 'SR latch', type: 'D_SRLATCH', data: ['S', 'R'], clockName: '', defaultEdge: 'rising', description: 'Ideal set / reset latch (S = R = 1 keeps the state)', latch: true }),
  ffPart({ slug: 'd-latch', name: 'D latch', type: 'D_DLATCH', data: ['D'], clockName: 'EN', defaultEdge: 'rising', description: 'Ideal transparent D latch: Q follows D while EN is high', latch: true }),
];

const patternSource = virtualPart({
  id: 'misc-digital/pattern-source',
  name: 'Pattern source',
  family: 'Virtual sources',
  description: 'Eight-bit word pattern source (D_SOURCE): word k drives D0..D7 during [k·period, (k+1)·period); words are hex numbers',
  symbol: icSymbol('PATTERN', [], Array.from({ length: 8 }, (_, k) => out(`D${k}`)), { w: 80 }),
  params: [
    textParam('pattern', 'Words (hex)', '00 01 02 04 08 10 20 40 80', { help: 'Hexadecimal words separated by spaces or commas, e.g. "0F A5 FF"' }),
    numParam('period', 'Word period', '1u', 's', { min: 0, showOnSchematic: true }),
    boolParam('repeat', 'Repeat', true),
    numParam('vhigh', 'Output high level', '5', 'V', { min: 0.1, group: 'model' }),
  ],
  optionalPins: Array.from({ length: 8 }, (_, k) => `D${k}`),
  toSpice: (ctx) => {
    const words = parseWordPattern(ctx.params.pattern ?? '', 8);
    if (words.length === 0) throw new Error('bad value for pattern: no words');
    const period = ctx.num('period');
    if (!(period > 0)) throw new Error('bad value for period: must be > 0');
    const inst: Record<string, number> = { nwords: words.length, period, repeat: /^(true|1|yes|on)$/i.test(ctx.params.repeat ?? 'true') ? 1 : 0 };
    words.forEach((w, k) => (inst[`w${k}`] = w));
    const lv = idealLevels(ctx.num('vhigh'), 0, ctx.num('vhigh') / 2, 1);
    const m = familyModel('MS_VIRT_SOURCE', 'D_SOURCE', lv);
    return { elements: [aElement(ctx.name('A'), Array.from({ length: 8 }, (_, k) => optionalNode(ctx, `D${k}`)), GROUND_REF, m.name, inst)], models: [m] };
  },
  keywords: ['pattern', 'word', 'source', 'stimulus', 'd_source'],
});

function pullPart(up: boolean): LibraryPartDef {
  return virtualPart({
    id: `misc-digital/${up ? 'pullup' : 'pulldown'}`,
    name: up ? 'Pull-up' : 'Pull-down',
    family: 'Virtual sources',
    description: `Weak logic ${up ? 'high' : 'low'} driver (resistance to the ${up ? 'high' : 'low'} level): any normal output overrides it`,
    symbol: icSymbol(up ? 'PU' : 'PD', [], [out('Y')], { w: 40 }),
    params: [numParam('resistance', 'Resistance', '1k', 'Ω', { min: 1e-3, showOnSchematic: true }), numParam('vhigh', 'High level', '5', 'V', { min: 0.1, group: 'model' })],
    toSpice: (ctx) => {
      const r = ctx.num('resistance');
      if (!(r > 0)) throw new Error('bad value for resistance: must be > 0');
      const lv = idealLevels(ctx.num('vhigh'), 0, ctx.num('vhigh') / 2, r);
      const m = familyModel(`MS_VIRT_${up ? 'PULLUP' : 'PULLDOWN'}`, up ? 'D_PULLUP' : 'D_PULLDOWN', lv);
      return { elements: [aElement(ctx.name('A'), [ctx.node('Y')], GROUND_REF, m.name)], models: [m] };
    },
    keywords: [up ? 'pullup' : 'pulldown', 'resistor', 'weak'],
  });
}

export const VIRTUAL_PARTS: LibraryPartDef[] = [
  ...gateParts,
  bufferPart('not', 'NOT', 'D_INVERTER', true, 'Ideal inverter'),
  bufferPart('buf', 'BUF', 'D_BUFFER', false, 'Ideal non-inverting buffer'),
  bufferPart('schmitt-not', 'Schmitt NOT', 'D_INVERTER', true, 'Ideal inverting Schmitt trigger (switches at VT+ rising and VT- falling)', true),
  tristate,
  ...ffParts,
  patternSource,
  pullPart(true),
  pullPart(false),
];
