/**
 * TTL group: 74xx-pinout logic ICs (family selectable: LS default, STD, S, ALS, HC, HCT).
 *
 * Each IC is drawn as a rectangular body with its logic pins and physical pin numbers; VCC
 * and GND are hidden power pins (see kit.ts: tied to the VCC net when the design has one,
 * otherwise ideal family levels). Every gate / flip-flop / function block is one code-model
 * element ('A', src/sim/devices/digital), named A_<refdes>_<section>.
 *
 * Timing: the family gate delay (FAMILIES) times a per-part factor approximating the typical
 * datasheet path delay (flip-flop clock-to-output, counter clock-to-Q, decoder / adder
 * propagation). Values are typical public datasheet figures, not worst case.
 */
import type { ElementIR, ModelCard } from '../../../sim/netlist';
import type { LibraryPartDef } from '../../partkit';
import { internalNode, numParam } from '../../partkit';
import type { ParamDef, ToSpiceContext } from '../../types';
import {
  FAMILIES,
  aElement,
  familyModel,
  familyOf,
  familyParam,
  icSymbol,
  inp,
  levelsFor,
  out,
  powerNodes,
  powerParams,
  type FamilyLevels,
  type IcPin,
  type PowerNodes,
} from './kit';

/** Collects the models and elements of one IC instance. */
export class IcBuilder {
  readonly models: ModelCard[] = [];
  readonly elements: ElementIR[] = [];
  constructor(
    readonly ctx: ToSpiceContext,
    readonly levels: FamilyLevels,
    readonly base: string,
    readonly power: PowerNodes,
  ) {}

  /** Model card name for a code-model type with the part's levels. */
  model(type: string, delayFactor = 1, extra: Record<string, number> = {}, levels: FamilyLevels = this.levels): string {
    const m = familyModel(`${this.base}_${type.replace(/^D_/, '')}`, type, levels, delayFactor, extra);
    if (!this.models.some((c) => c.name === m.name)) this.models.push(m);
    return m.name;
  }

  /** Node of a pin; '0' and 'null' pass through. */
  n(pinName: string): string {
    return pinName === '0' || pinName === 'null' ? pinName : this.ctx.node(pinName);
  }

  /** Add one code-model element whose ports are pins (or '0' / 'null'). */
  add(suffix: string | undefined, pins: string[], model: string, params: Record<string, number> = {}): void {
    this.elements.push(aElement(this.ctx.name('A', suffix), pins.map((p) => this.n(p)), this.power, model, params));
  }

  /** Private node of this IC instance ("<refdes>.<suffix>"), for signals between its elements. */
  node(suffix: string): string {
    return internalNode(this.ctx, suffix);
  }

  /**
   * Add one code-model element whose ports are already node names (pins through n(), private
   * nodes through node()); `ports` is an optional XSPICE port template marking inverted ports.
   */
  addNodes(suffix: string | undefined, nodes: string[], model: string, params: Record<string, number> = {}, ports?: string): void {
    const el = aElement(this.ctx.name('A', suffix), nodes, this.power, model, params);
    this.elements.push(ports ? { ...el, stringParams: { ports } } : el);
  }
}

interface TtlSpec {
  pn: string;
  name: string;
  description: string;
  pinCount: 14 | 16 | 20;
  left: (IcPin | null)[];
  right: (IcPin | null)[];
  build(b: IcBuilder): void;
  keywords?: string[];
  params?: ParamDef[];
  optionalPins?: string[];
  w?: number;
  /** hidden power pin numbers when they differ from the usual corners */
  powerPins?: string;
  /**
   * Output stage of the device. It sets the ERC pin type of the output pins, so the pin-type
   * matrix rows for open-collector and 3-state lines fire (src/model/ercMatrix.ts): two
   * open-collector segment drivers on one pull-up are normal, two push-pull outputs are not.
   * Absent = push-pull ('totem-pole').
   */
  output?: 'totem-pole' | 'open-collector' | '3-state';
}

/** Output pins retyped after the device's output stage (see TtlSpec.output). */
function withOutputType(pins: (IcPin | null)[], output: TtlSpec['output']): (IcPin | null)[] {
  const type = output === '3-state' ? 'tristate' : output === 'open-collector' ? 'open-collector' : undefined;
  if (type === undefined) return pins;
  return pins.map((p) => (p && p.type === 'output' ? { ...p, type } : p));
}

const DIP: Record<number, string> = { 14: 'DIP-14', 16: 'DIP-16', 20: 'DIP-20' };
const POWER_PINS: Record<number, string> = { 14: 'VCC = 14, GND = 7', 16: 'VCC = 16, GND = 8', 20: 'VCC = 20, GND = 10' };

function ttlPart(s: TtlSpec): LibraryPartDef {
  return {
    id: `ttl/${s.pn.toLowerCase()}`,
    name: s.pn,
    group: 'ttl',
    family: '74xx',
    description: `${s.name}. ${s.description} Hidden power pins (${s.powerPins ?? POWER_PINS[s.pinCount]}) on the VCC net.`,
    prefix: 'U',
    symbol: icSymbol(s.pn, withOutputType(s.left, s.output), withOutputType(s.right, s.output), { w: s.w }),
    params: [familyParam(), ...(s.params ?? []), ...powerParams('vccnet', 'VCC')],
    toSpice: (ctx) => {
      const fam = familyOf(ctx);
      const b = new IcBuilder(ctx, levelsFor(ctx, FAMILIES[fam]), `MS_${fam}${s.pn}`, powerNodes(ctx, 'vccnet', 'VCC'));
      s.build(b);
      return { elements: b.elements, models: b.models };
    },
    optionalPins: s.optionalPins,
    footprint: DIP[s.pinCount],
    keywords: [s.pn, `74ls${s.pn.slice(2)}`, 'ttl', '74xx', ...(s.keywords ?? [])],
    provenance: `MachSim code model (${s.name.toLowerCase()}); levels, loading and typical delays of the selected 74xx family from public datasheet figures`,
  };
}

// ---------------------------------------------------------------------------------------------
// gate packages

export type GateDef = { ins: [string, string][]; out: [string, string] };

/** Gate section k (1-based) with input pin numbers and output pin number. */
export const g = (k: number, ins: string[], o: string): GateDef => ({
  ins: ins.map((num, i) => [`${k}${String.fromCharCode(65 + i)}`, num] as [string, string]),
  out: [`${k}Y`, o],
});

/** Left / right slots: inputs of each gate stacked, output on the middle row. */
export function gateSlots(gates: GateDef[]): { left: (IcPin | null)[]; right: (IcPin | null)[] } {
  const left: (IcPin | null)[] = [];
  const right: (IcPin | null)[] = [];
  for (const gd of gates) {
    const n = gd.ins.length;
    const rows = n === 1 ? 1 : n === 2 ? 3 : n + 1;
    const base = left.length;
    for (let r = 0; r < rows; r++) {
      left.push(null);
      right.push(null);
    }
    if (n === 1) left[base] = inp(gd.ins[0][0], gd.ins[0][1]);
    else if (n === 2) {
      left[base] = inp(gd.ins[0][0], gd.ins[0][1]);
      left[base + 2] = inp(gd.ins[1][0], gd.ins[1][1]);
    } else gd.ins.forEach(([name, num], i) => (left[base + i] = inp(name, num)));
    right[base + (n === 1 ? 0 : 1)] = out(gd.out[0], gd.out[1]);
  }
  while (left.length && left[left.length - 1] === null && right[right.length - 1] === null) {
    left.pop();
    right.pop();
  }
  return { left, right };
}

export const QUAD2_14: GateDef[] = [g(1, ['1', '2'], '3'), g(2, ['4', '5'], '6'), g(3, ['9', '10'], '8'), g(4, ['12', '13'], '11')];
const NOR2_14: GateDef[] = [g(1, ['2', '3'], '1'), g(2, ['5', '6'], '4'), g(3, ['8', '9'], '10'), g(4, ['11', '12'], '13')];
export const HEX1_14: GateDef[] = [g(1, ['1'], '2'), g(2, ['3'], '4'), g(3, ['5'], '6'), g(4, ['9'], '8'), g(5, ['11'], '10'), g(6, ['13'], '12')];
const TRIPLE3_14: GateDef[] = [g(1, ['1', '2', '13'], '12'), g(2, ['3', '4', '5'], '6'), g(3, ['9', '10', '11'], '8')];
const DUAL4_14: GateDef[] = [g(1, ['1', '2', '4', '5'], '6'), g(2, ['9', '10', '12', '13'], '8')];

/** Schmitt thresholds of the 7414 / 74xx14 for a family. */
function schmittExtra(levels: FamilyLevels): Record<string, number> {
  return levels.thresh_scale ? { vtp: 0.55 * levels.vnom, vtn: 0.35 * levels.vnom } : { vtp: 1.6, vtn: 0.8 };
}

function gateIc(pn: string, name: string, type: string, gates: GateDef[], description: string, keywords: string[], schmitt = false): LibraryPartDef {
  const { left, right } = gateSlots(gates);
  return ttlPart({
    pn,
    name,
    description,
    pinCount: 14,
    left,
    right,
    keywords,
    build: (b) => {
      const m = b.model(type, 1, schmitt ? schmittExtra(b.levels) : {});
      gates.forEach((gd, i) => b.add(String(i + 1), [...gd.ins.map(([p]) => p), gd.out[0]], m));
    },
  });
}

// ---------------------------------------------------------------------------------------------
// flip-flops

/** One flip-flop section of a dual package: pin name -> number. */
type FfPins = Record<string, string>;

function ffSlots(sections: { k: number; pins: FfPins; data: string[] }[], hasPre: boolean): { left: (IcPin | null)[]; right: (IcPin | null)[] } {
  const left: (IcPin | null)[] = [];
  const right: (IcPin | null)[] = [];
  sections.forEach(({ k, pins, data }, si) => {
    if (si > 0) {
      left.push(null);
      right.push(null);
    }
    const start = left.length;
    for (const d of data) left.push(inp(`${k}${d}`, pins[d]));
    left.push(inp(`${k}CLK`, pins.CLK, `${k}CLK`, true));
    if (hasPre) left.push(inp(`${k}PRE`, pins.PRE, `~${k}PRE`));
    left.push(inp(`${k}CLR`, pins.CLR, `~${k}CLR`));
    while (right.length < start) right.push(null);
    right.push(out(`${k}Q`, pins.Q), out(`${k}QN`, pins.QN, `~${k}Q`));
    while (right.length < left.length) right.push(null);
  });
  return { left, right };
}

function dualFf(
  pn: string,
  name: string,
  type: string,
  data: string[],
  s1: FfPins,
  s2: FfPins,
  factor: number,
  extra: Record<string, number>,
  hasPre: boolean,
  pinCount: 14 | 16,
  description: string,
  powerPins?: string,
): LibraryPartDef {
  const { left, right } = ffSlots(
    [
      { k: 1, pins: s1, data },
      { k: 2, pins: s2, data },
    ],
    hasPre,
  );
  return ttlPart({
    pn,
    name,
    description,
    pinCount,
    powerPins,
    left,
    right,
    keywords: ['flip-flop', type === 'D_DFF' ? 'd flip-flop' : 'jk flip-flop'],
    build: (b) => {
      const m = b.model(type, factor, { set_low: 1, reset_low: 1, ...extra });
      for (const k of [1, 2]) b.add(String(k), [...data.map((d) => `${k}${d}`), `${k}CLK`, hasPre ? `${k}PRE` : 'null', `${k}CLR`, `${k}Q`, `${k}QN`], m);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// the catalogue

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/**
 * Segment output pins of the 7-segment decoders: SEGA..SEGG (labels a..g). Distinct from the
 * BCD inputs A..D also when compared case-insensitively, as SPICE names are.
 */
export const SEGMENT_PINS = ['SEGA', 'SEGB', 'SEGC', 'SEGD', 'SEGE', 'SEGF', 'SEGG'];

const ttl7447 = ttlPart({
  pn: '7447',
  name: 'BCD to 7-segment decoder / driver',
  output: 'open-collector',
  description: 'Open-collector active-low segment outputs (tailless 6 and 9); ~LT lamp test, ~RBI ripple-blanking input, ~BI/~RBO blanking input / ripple-blanking output.',
  pinCount: 16,
  left: [inp('A', '7'), inp('B', '1'), inp('C', '2'), inp('D', '6'), null, inp('LT', '3', '~LT'), inp('RBI', '5', '~RBI'), { name: 'BIRBO', number: '4', label: '~BI/RBO', type: 'bidir' }],
  right: SEGMENT_PINS.map((s, i) => out(s, ['13', '12', '11', '10', '9', '15', '14'][i], `~${s.slice(3).toLowerCase()}`)),
  keywords: ['7-segment', 'seven segment', 'decoder', 'driver', 'bcd'],
  build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'LT', 'RBI', 'BIRBO', ...SEGMENT_PINS], b.model('D_BCD7SEG', 5)),
});

const ttl7490 = ttlPart({
  pn: '7490',
  name: 'Decade counter (÷2 and ÷5)',
  description: 'Connect QA to CKB for BCD counting. Falling-edge clocks; R0(1)·R0(2) resets to 0, R9(1)·R9(2) sets 9.',
  pinCount: 14,
  powerPins: 'VCC = 5, GND = 10',
  left: [inp('CKA', '14', 'CKA', true), inp('CKB', '1', 'CKB', true), null, inp('R01', '2', 'R0(1)'), inp('R02', '3', 'R0(2)'), inp('R91', '6', 'R9(1)'), inp('R92', '7', 'R9(2)')],
  right: [out('QA', '12'), out('QB', '9'), out('QC', '8'), out('QD', '11')],
  keywords: ['counter', 'decade', 'bcd', 'ripple'],
  build: (b) => b.add(undefined, ['CKA', 'CKB', 'R01', 'R02', 'R91', 'R92', 'QA', 'QB', 'QC', 'QD'], b.model('D_CNT_DIV2_DIV5', 1.6)),
});

const ttl7493 = ttlPart({
  pn: '7493',
  name: '4-bit binary counter (÷2 and ÷8)',
  description: 'Connect QA to CKB for a ÷16 ripple counter. Falling-edge clocks; R0(1)·R0(2) resets.',
  pinCount: 14,
  powerPins: 'VCC = 5, GND = 10',
  left: [inp('CKA', '14', 'CKA', true), inp('CKB', '1', 'CKB', true), null, inp('R01', '2', 'R0(1)'), inp('R02', '3', 'R0(2)')],
  right: [out('QA', '12'), out('QB', '9'), out('QC', '8'), out('QD', '11')],
  keywords: ['counter', 'binary', 'ripple'],
  build: (b) => b.add(undefined, ['CKA', 'CKB', 'R01', 'R02', 'QA', 'QB', 'QC', 'QD'], b.model('D_CNT_DIV2_DIV8', 1.6)),
});

function syncCounter(pn: string, syncClear: boolean): LibraryPartDef {
  return ttlPart({
    pn,
    name: `Synchronous 4-bit binary counter (${syncClear ? 'synchronous' : 'asynchronous'} clear)`,
    description: `Rising-edge clock, synchronous ~LOAD, count enables ENP / ENT, ripple carry RCO = ENT·(Q = 15); ~CLR ${syncClear ? 'acts on the next clock edge' : 'clears immediately'}.`,
    pinCount: 16,
    left: [inp('CLK', '2', 'CLK', true), inp('CLR', '1', '~CLR'), inp('LOAD', '9', '~LOAD'), inp('ENP', '7'), inp('ENT', '10'), null, inp('A', '3'), inp('B', '4'), inp('C', '5'), inp('D', '6')],
    right: [out('QA', '14'), out('QB', '13'), out('QC', '12'), out('QD', '11'), null, out('RCO', '15')],
    keywords: ['counter', 'synchronous', 'binary', 'presettable'],
    build: (b) =>
      b.add(undefined, ['CLK', 'CLR', 'LOAD', 'ENP', 'ENT', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'RCO'], b.model('D_CNT_SYNC', 2, { sync_clear: syncClear ? 1 : 0 })),
  });
}

const ttl74164 = ttlPart({
  pn: '74164',
  name: '8-bit serial-in parallel-out shift register',
  description: 'Serial data A·B enters QA on the rising clock edge; ~CLR clears asynchronously.',
  pinCount: 14,
  left: [inp('A', '1'), inp('B', '2'), null, inp('CLK', '8', 'CLK', true), inp('CLR', '9', '~CLR')],
  right: ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'].map((q, i) => out(q, ['3', '4', '5', '6', '10', '11', '12', '13'][i])),
  keywords: ['shift register', 'sipo', 'serial'],
  build: (b) => b.add(undefined, ['A', 'B', 'CLK', 'CLR', 'QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'], b.model('D_SHIFT_SIPO', 2)),
});

const ttl74165 = ttlPart({
  pn: '74165',
  name: '8-bit parallel-load shift register',
  description: 'SH/~LD low loads A..H asynchronously; shifts toward QH on the rising edge of CLK OR CLK INH, SER enters stage A.',
  pinCount: 16,
  left: [inp('SHLD', '1', 'SH/~LD'), inp('CLK', '2', 'CLK', true), inp('INH', '15', 'CLK INH'), inp('SER', '10'), null, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((d, i) => inp(d, ['11', '12', '13', '14', '3', '4', '5', '6'][i]))],
  right: [out('QH', '9'), out('QHN', '7', '~QH')],
  keywords: ['shift register', 'piso', 'parallel load'],
  build: (b) => b.add(undefined, ['SHLD', 'CLK', 'INH', 'SER', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'QH', 'QHN'], b.model('D_SHIFT_PISO', 2.2)),
});

const ttl74138 = ttlPart({
  pn: '74138',
  name: '3-to-8 line decoder / demultiplexer',
  description: 'Active-low outputs, enabled when G1 is high and ~G2A, ~G2B are low.',
  pinCount: 16,
  left: [inp('A', '1'), inp('B', '2'), inp('C', '3'), null, inp('G1', '6'), inp('G2A', '4', '~G2A'), inp('G2B', '5', '~G2B')],
  right: Array.from({ length: 8 }, (_, k) => out(`Y${k}`, ['15', '14', '13', '12', '11', '10', '9', '7'][k], `~Y${k}`)),
  keywords: ['decoder', 'demultiplexer', '3 to 8'],
  build: (b) => b.add(undefined, ['A', 'B', 'C', 'G1', 'G2A', 'G2B', ...range('Y', 8)], b.model('D_DECODER', 2.2, { en_high: 1, en_low: 2 })),
});

const ttl74139 = ttlPart({
  pn: '74139',
  name: 'Dual 2-to-4 line decoder / demultiplexer',
  description: 'Active-low outputs and enable ~G per section.',
  pinCount: 16,
  left: [inp('1A', '2'), inp('1B', '3'), inp('1G', '1', '~1G'), null, null, inp('2A', '14'), inp('2B', '13'), inp('2G', '15', '~2G')],
  right: [...['4', '5', '6', '7'].map((n, k) => out(`1Y${k}`, n, `~1Y${k}`)), null, ...['12', '11', '10', '9'].map((n, k) => out(`2Y${k}`, n, `~2Y${k}`))],
  keywords: ['decoder', 'demultiplexer', '2 to 4'],
  build: (b) => {
    const m = b.model('D_DECODER', 2, { en_low: 1 });
    for (const k of [1, 2]) b.add(String(k), [`${k}A`, `${k}B`, `${k}G`, ...range(`${k}Y`, 4)], m);
  },
});

const ttl74151 = ttlPart({
  pn: '74151',
  name: '8-to-1 line data selector / multiplexer',
  description: 'Y = selected input, W = ~Y; ~G high forces Y low.',
  pinCount: 16,
  left: [inp('A', '11'), inp('B', '10'), inp('C', '9'), inp('G', '7', '~G'), null, ...range('D', 8).map((d, k) => inp(d, ['4', '3', '2', '1', '15', '14', '13', '12'][k]))],
  right: [out('Y', '5'), out('W', '6', '~W')],
  keywords: ['multiplexer', 'data selector', '8 to 1'],
  build: (b) => b.add(undefined, ['A', 'B', 'C', ...range('D', 8), 'G', 'Y', 'W'], b.model('D_MUX', 2, { strobe: 1, has_w: 1 })),
});

const ttl74153 = ttlPart({
  pn: '74153',
  name: 'Dual 4-to-1 line data selector / multiplexer',
  description: 'Common select inputs A, B; ~G strobe per section.',
  pinCount: 16,
  left: [inp('A', '14'), inp('B', '2'), null, inp('1G', '1', '~1G'), ...['6', '5', '4', '3'].map((n, k) => inp(`1C${k}`, n)), null, inp('2G', '15', '~2G'), ...['10', '11', '12', '13'].map((n, k) => inp(`2C${k}`, n))],
  right: [null, null, null, out('1Y', '7'), null, null, null, null, null, out('2Y', '9')],
  keywords: ['multiplexer', 'data selector', '4 to 1'],
  build: (b) => {
    const m = b.model('D_MUX', 2, { strobe: 1 });
    for (const k of [1, 2]) b.add(String(k), ['A', 'B', ...range(`${k}C`, 4), `${k}G`, `${k}Y`], m);
  },
});

const ttl74157 = ttlPart({
  pn: '74157',
  name: 'Quad 2-to-1 line data selector / multiplexer',
  description: 'Select A/~B low passes the A inputs, high the B inputs; ~G high forces the outputs low.',
  pinCount: 16,
  left: [inp('S', '1', 'A/~B'), inp('G', '15', '~G'), null, inp('1A', '2'), inp('1B', '3'), inp('2A', '5'), inp('2B', '6'), inp('3A', '11'), inp('3B', '10'), inp('4A', '14'), inp('4B', '13')],
  right: [null, null, null, out('1Y', '4'), null, out('2Y', '7'), null, out('3Y', '9'), null, out('4Y', '12')],
  keywords: ['multiplexer', 'data selector', '2 to 1'],
  build: (b) => {
    const m = b.model('D_MUX', 1.5, { strobe: 1 });
    for (const k of [1, 2, 3, 4]) b.add(String(k), ['S', `${k}A`, `${k}B`, 'G', `${k}Y`], m);
  },
});

const ttl74174 = ttlPart({
  pn: '74174',
  name: 'Hex D flip-flop with clear',
  description: 'Rising-edge clock, common ~CLR.',
  pinCount: 16,
  left: [inp('CLK', '9', 'CLK', true), inp('CLR', '1', '~CLR'), null, ...['3', '4', '6', '11', '13', '14'].map((n, k) => inp(`${k + 1}D`, n))],
  right: [null, null, null, ...['2', '5', '7', '10', '12', '15'].map((n, k) => out(`${k + 1}Q`, n))],
  keywords: ['register', 'flip-flop', 'latch'],
  build: (b) => b.add(undefined, [...[1, 2, 3, 4, 5, 6].map((k) => `${k}D`), 'CLK', 'CLR', ...[1, 2, 3, 4, 5, 6].map((k) => `${k}Q`)], b.model('D_REGISTER', 2)),
});

const ttl74175 = ttlPart({
  pn: '74175',
  name: 'Quad D flip-flop with clear (Q and ~Q)',
  description: 'Rising-edge clock, common ~CLR.',
  pinCount: 16,
  left: [inp('CLK', '9', 'CLK', true), inp('CLR', '1', '~CLR'), null, ...['4', '5', '12', '13'].map((n, k) => inp(`${k + 1}D`, n))],
  right: [...['2', '7', '10', '15'].map((n, k) => out(`${k + 1}Q`, n)), null, ...['3', '6', '11', '14'].map((n, k) => out(`${k + 1}QN`, n, `~${k + 1}Q`))],
  keywords: ['register', 'flip-flop'],
  build: (b) => b.add(undefined, [...[1, 2, 3, 4].map((k) => `${k}D`), 'CLK', 'CLR', ...[1, 2, 3, 4].map((k) => `${k}Q`), ...[1, 2, 3, 4].map((k) => `${k}QN`)], b.model('D_REGISTER', 2, { has_qn: 1 })),
});

const ttl74193 = ttlPart({
  pn: '74193',
  name: 'Synchronous 4-bit up / down binary counter',
  description: 'Counts up on the rising edge of UP (DOWN high) and down on DOWN (UP high); CLR (high) and ~LOAD are asynchronous; ~CO / ~BO carry and borrow outputs.',
  pinCount: 16,
  left: [inp('UP', '5', 'UP', true), inp('DOWN', '4', 'DOWN', true), inp('CLR', '14'), inp('LOAD', '11', '~LOAD'), null, inp('A', '15'), inp('B', '1'), inp('C', '10'), inp('D', '9')],
  right: [out('QA', '3'), out('QB', '2'), out('QC', '6'), out('QD', '7'), null, out('CO', '12', '~CO'), out('BO', '13', '~BO')],
  keywords: ['counter', 'up down', 'presettable'],
  build: (b) => b.add(undefined, ['UP', 'DOWN', 'CLR', 'LOAD', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'CO', 'BO'], b.model('D_CNT_UPDOWN', 2.2)),
});

const ttl74283 = ttlPart({
  pn: '74283',
  name: '4-bit binary full adder with fast carry',
  description: 'Σ = A + B + C0, carry out C4.',
  pinCount: 16,
  left: [inp('A1', '5'), inp('A2', '3'), inp('A3', '14'), inp('A4', '12'), null, inp('B1', '6'), inp('B2', '2'), inp('B3', '15'), inp('B4', '11'), null, inp('C0', '7')],
  right: [out('S1', '4', 'Σ1'), out('S2', '1', 'Σ2'), out('S3', '13', 'Σ3'), out('S4', '10', 'Σ4'), null, out('C4', '9')],
  keywords: ['adder', 'full adder', 'arithmetic'],
  build: (b) => b.add(undefined, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C0', 'S1', 'S2', 'S3', 'S4', 'C4'], b.model('D_ADDER', 2.4)),
});

const ttl7485 = ttlPart({
  pn: '7485',
  name: '4-bit magnitude comparator',
  description: 'Outputs A>B, A=B, A<B; cascading inputs decide when A = B (tie IA=B high on the least significant stage).',
  pinCount: 16,
  left: [inp('A0', '10'), inp('A1', '12'), inp('A2', '13'), inp('A3', '15'), null, inp('B0', '9'), inp('B1', '11'), inp('B2', '14'), inp('B3', '1'), null, inp('IGT', '4', 'IA>B'), inp('IEQ', '3', 'IA=B'), inp('ILT', '2', 'IA<B')],
  right: [out('OGT', '5', 'A>B'), out('OEQ', '6', 'A=B'), out('OLT', '7', 'A<B')],
  keywords: ['comparator', 'magnitude'],
  build: (b) => b.add(undefined, ['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'IGT', 'IEQ', 'ILT', 'OGT', 'OEQ', 'OLT'], b.model('D_MAGCOMP', 2.4)),
});

const ttl74244 = ttlPart({
  pn: '74244',
  name: 'Octal buffer / line driver with 3-state outputs',
  output: '3-state',
  description: 'Two groups of four non-inverting buffers, each enabled by an active-low ~G.',
  pinCount: 20,
  left: [inp('1G', '1', '~1G'), ...['2', '4', '6', '8'].map((n, k) => inp(`1A${k + 1}`, n)), null, inp('2G', '19', '~2G'), ...['11', '13', '15', '17'].map((n, k) => inp(`2A${k + 1}`, n))],
  right: [null, ...['18', '16', '14', '12'].map((n, k) => out(`1Y${k + 1}`, n)), null, null, ...['9', '7', '5', '3'].map((n, k) => out(`2Y${k + 1}`, n))],
  keywords: ['buffer', 'line driver', 'tri-state', '3-state', 'bus'],
  build: (b) => {
    const m = b.model('D_TRISTATE', 1.2, { enable_low: 1 });
    for (const grp of [1, 2]) for (let k = 1; k <= 4; k++) b.add(`${grp}${k}`, [`${grp}A${k}`, `${grp}G`, `${grp}Y${k}`], m);
  },
});

const ttl74245 = ttlPart({
  pn: '74245',
  name: 'Octal bus transceiver with 3-state outputs',
  description: 'DIR high: A drives B; DIR low: B drives A; ~G high isolates both buses.',
  pinCount: 20,
  left: [inp('DIR', '1'), inp('G', '19', '~G'), null, ...Array.from({ length: 8 }, (_, k) => ({ name: `A${k + 1}`, number: String(k + 2), type: 'bidir' as const }))],
  right: [null, null, null, ...Array.from({ length: 8 }, (_, k) => ({ name: `B${k + 1}`, number: String(18 - k), type: 'bidir' as const }))],
  keywords: ['transceiver', 'bus', 'tri-state', 'bidirectional'],
  build: (b) =>
    b.add(undefined, ['DIR', 'G', ...Array.from({ length: 8 }, (_, k) => `A${k + 1}`), ...Array.from({ length: 8 }, (_, k) => `B${k + 1}`)], b.model('D_TRANSCEIVER', 1.2)),
});

const timingParams = (suffix = ''): ParamDef[] => [
  numParam(`rext${suffix}`, `Timing resistor${suffix ? ` (section ${suffix})` : ''}`, suffix ? '10k' : '2k', 'Ω', { min: 1, group: 'value', showOnSchematic: !suffix, help: 'External timing resistance (2 kΩ = internal Rint of the 74121)' }),
  numParam(`cext${suffix}`, `Timing capacitor${suffix ? ` (section ${suffix})` : ''}`, '10n', 'F', { min: 0, group: 'value', showOnSchematic: !suffix }),
];

const ttl74121 = ttlPart({
  pn: '74121',
  name: 'Monostable multivibrator (non-retriggerable)',
  description:
    'Triggers on B rising while ~A1 or ~A2 is low, or on ~A falling while B is high. Pulse width tw = ln2 · Rext · Cext (params; the Rint / Cext / Rext/Cext pins are for wiring only and are not simulated).',
  pinCount: 14,
  left: [inp('A1', '3', '~A1'), inp('A2', '4', '~A2'), inp('B', '5'), null, { name: 'RINT', number: '9', label: 'Rint', type: 'passive' }, { name: 'CEXT', number: '10', label: 'Cext', type: 'passive' }, { name: 'RCEXT', number: '11', label: 'Rext/Cext', type: 'passive' }],
  right: [out('Q', '6'), out('QN', '1', '~Q')],
  params: timingParams(),
  optionalPins: ['RINT', 'CEXT', 'RCEXT'],
  keywords: ['monostable', 'one-shot', 'multivibrator', 'pulse'],
  build: (b) => {
    const tw = Math.max(30e-9, Math.LN2 * b.ctx.num('rext') * b.ctx.num('cext'));
    b.add(undefined, ['A1', 'A2', 'B', 'Q', 'QN'], b.model('D_ONESHOT', 4, { mode: 121, tw }));
  },
});

const ttl74123 = ttlPart({
  pn: '74123',
  name: 'Dual retriggerable monostable multivibrator with clear',
  description:
    'Triggers on ~A falling (B high), B rising (~A low) or ~CLR rising; retriggering restarts the pulse, ~CLR low ends it. tw ≈ 0.45 · Rext · Cext per section (params; the Cext / Rext/Cext pins are not simulated).',
  pinCount: 16,
  left: [inp('1A', '1', '~1A'), inp('1B', '2'), inp('1CLR', '3', '~1CLR'), { name: '1CEXT', number: '14', label: '1Cext', type: 'passive' }, { name: '1RCEXT', number: '15', label: '1Rext/Cext', type: 'passive' }, null, inp('2A', '9', '~2A'), inp('2B', '10'), inp('2CLR', '11', '~2CLR'), { name: '2CEXT', number: '6', label: '2Cext', type: 'passive' }, { name: '2RCEXT', number: '7', label: '2Rext/Cext', type: 'passive' }],
  right: [out('1Q', '13'), out('1QN', '4', '~1Q'), null, null, null, null, out('2Q', '5'), out('2QN', '12', '~2Q')],
  params: [...timingParams('1'), ...timingParams('2')],
  optionalPins: ['1CEXT', '1RCEXT', '2CEXT', '2RCEXT'],
  keywords: ['monostable', 'one-shot', 'retriggerable', 'multivibrator'],
  build: (b) => {
    for (const k of [1, 2]) {
      const tw = Math.max(30e-9, 0.45 * b.ctx.num(`rext${k}`) * b.ctx.num(`cext${k}`));
      b.add(String(k), [`${k}A`, `${k}B`, `${k}CLR`, `${k}Q`, `${k}QN`], b.model('D_ONESHOT', 3, { mode: 123, tw }));
    }
  },
});

export const TTL_PARTS: LibraryPartDef[] = [
  gateIc('7400', 'Quad 2-input NAND gate', 'D_NAND', QUAD2_14, 'Y = ~(A·B).', ['nand', 'gate']),
  gateIc('7402', 'Quad 2-input NOR gate', 'D_NOR', NOR2_14, 'Y = ~(A+B).', ['nor', 'gate']),
  gateIc('7404', 'Hex inverter', 'D_INVERTER', HEX1_14, 'Y = ~A.', ['inverter', 'not', 'gate']),
  gateIc('7408', 'Quad 2-input AND gate', 'D_AND', QUAD2_14, 'Y = A·B.', ['and', 'gate']),
  gateIc('7410', 'Triple 3-input NAND gate', 'D_NAND', TRIPLE3_14, 'Y = ~(A·B·C).', ['nand', 'gate']),
  gateIc('7414', 'Hex Schmitt-trigger inverter', 'D_INVERTER', HEX1_14, 'Y = ~A with input hysteresis (VT+ ≈ 1.6 V, VT- ≈ 0.8 V for TTL families).', ['schmitt', 'inverter', 'hysteresis'], true),
  gateIc('7420', 'Dual 4-input NAND gate', 'D_NAND', DUAL4_14, 'Y = ~(A·B·C·D); pins 3 and 11 are not connected.', ['nand', 'gate']),
  gateIc('7432', 'Quad 2-input OR gate', 'D_OR', QUAD2_14, 'Y = A+B.', ['or', 'gate']),
  gateIc('7486', 'Quad 2-input XOR gate', 'D_XOR', QUAD2_14, 'Y = A⊕B.', ['xor', 'exclusive or', 'gate']),
  dualFf('7474', 'Dual D flip-flop with preset and clear', 'D_DFF', ['D'], { CLR: '1', D: '2', CLK: '3', PRE: '4', Q: '5', QN: '6' }, { QN: '8', Q: '9', PRE: '10', CLK: '11', D: '12', CLR: '13' }, 2, {}, true, 14, 'Positive-edge triggered; ~PRE / ~CLR asynchronous (both low: Q = ~Q = high).'),
  dualFf('7476', 'Dual JK flip-flop with preset and clear', 'D_JKFF', ['J', 'K'], { CLK: '1', PRE: '2', CLR: '3', J: '4', K: '16', Q: '15', QN: '14' }, { CLK: '6', PRE: '7', CLR: '8', J: '9', K: '12', Q: '11', QN: '10' }, 2, { clk_edge: 0 }, true, 16, 'Negative-edge triggered (LS type), J = K = 1 toggles.', 'VCC = 5, GND = 13'),
  dualFf('74107', 'Dual JK flip-flop with clear', 'D_JKFF', ['J', 'K'], { J: '1', QN: '2', Q: '3', K: '4', CLK: '12', CLR: '13' }, { Q: '5', QN: '6', J: '8', CLK: '9', CLR: '10', K: '11' }, 2, { clk_edge: 0 }, false, 14, 'Negative-edge triggered, ~CLR asynchronous.'),
  dualFf('74112', 'Dual negative-edge JK flip-flop with preset and clear', 'D_JKFF', ['J', 'K'], { CLK: '1', K: '2', J: '3', PRE: '4', Q: '5', QN: '6', CLR: '15' }, { QN: '7', Q: '9', PRE: '10', J: '11', K: '12', CLK: '13', CLR: '14' }, 2, { clk_edge: 0 }, true, 16, 'Negative-edge triggered; ~PRE / ~CLR asynchronous.'),
  ttl7447,
  ttl7490,
  ttl7493,
  syncCounter('74161', false),
  syncCounter('74163', true),
  ttl74164,
  ttl74165,
  ttl74138,
  ttl74139,
  ttl74151,
  ttl74153,
  ttl74157,
  ttl74174,
  ttl74175,
  ttl74193,
  ttl74283,
  ttl7485,
  ttl74244,
  ttl74245,
  ttl74121,
  ttl74123,
];
