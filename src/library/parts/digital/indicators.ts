/**
 * Digital indicators (group 'indicators'): seven-segment displays, decoded hex display,
 * 10-segment bar graph and a logic probe.
 *
 * Segment / bar LEDs are real diodes (LED models from diodes.ts, chosen by the 'color' param),
 * so drivers see the forward voltage and current of each segment. A display-sensing code model
 * (D_DISPLAY, or D_HEXDISPLAY for the decoded display) drives the internal node
 * "<refdes>.code" to the bit mask of the lit segments, in volts:
 *   seven-segment: a = bit 0, b = 1, c = 2, d = 3, e = 4, f = 5, g = 6, dp = 7
 *   bar graph:     LED k (A_k / K_k, k = 1..10) = bit k-1
 * A segment counts as lit when its forward voltage exceeds the voltage at 1 mA of the LED
 * model (≈ visible glow). bindIndicator returns that node as the indicator signal
 * ({ kind: 'voltage', pos: '<refdes>.code', neg: '0' }); the schematic decodes the mask.
 */
import { thermalVoltage } from '../../../sim/device';
import type { ModelCard } from '../../../sim/netlist';
import { card, elD, elR, internalNode, internalNodeName, numParam, selectParam, type LibraryPartDef } from '../../partkit';
import { circle, line, makeSymbol, pin, rect } from '../../symbols';
import type { ParamDef, ToSpiceContext } from '../../types';
import { ledModel } from '../diodes';
import { aElement, digitGlyph, familyModel, icSymbol, idealLevels, inp, type PowerNodes } from './kit';

const GROUND_REF: PowerNodes = { nodes: ['0'], pwr: 1 };
const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

/** Display LED colours: forward voltage at 20 mA, emission coefficient, series resistance. */
const DISPLAY_LEDS: Record<string, { label: string; vf: number; n: number; rs: number }> = {
  red: { label: 'Red', vf: 2.0, n: 2.0, rs: 5 },
  orange: { label: 'Orange', vf: 2.0, n: 2.0, rs: 5 },
  yellow: { label: 'Yellow', vf: 2.1, n: 2.0, rs: 5 },
  green: { label: 'Green', vf: 2.2, n: 2.0, rs: 5 },
  blue: { label: 'Blue', vf: 3.2, n: 2.6, rs: 10 },
  white: { label: 'White', vf: 3.2, n: 2.6, rs: 10 },
};

const colorParam = (): ParamDef =>
  selectParam(
    'color',
    'Colour',
    'red',
    Object.entries(DISPLAY_LEDS).map(([k, v]) => [k, v.label] as [string, string]),
    { group: 'display' },
  );

function ledFor(ctx: ToSpiceContext): { model: ModelCard; von: number } {
  const key = (ctx.params.color ?? 'red').toLowerCase();
  const spec = DISPLAY_LEDS[key];
  if (!spec) throw new Error(`bad value for color: '${ctx.params.color}'`);
  const model = ledModel(`MS_DISPLAY_LED_${key.toUpperCase()}`, spec.vf, 20e-3, spec.n, spec.rs);
  const vt = thermalVoltage(300.15);
  const von = spec.n * vt * Math.log(1e-3 / model.params.is + 1) + 1e-3 * spec.rs;
  return { model, von };
}

const codeBinding = {
  bindIndicator: (b: { refdes: string }) => ({ signal: { kind: 'voltage' as const, pos: internalNodeName(b.refdes, 'code'), neg: '0' } }),
};

function sevenSeg(anode: boolean): LibraryPartDef {
  const common = anode ? 'CA' : 'CC';
  return {
    id: `indicators/seven-seg-${anode ? 'ca' : 'cc'}`,
    name: `7-segment display (common ${anode ? 'anode' : 'cathode'})`,
    group: 'indicators',
    family: 'Seven-segment',
    description: `Seven-segment LED display with decimal point, common ${anode ? 'anode' : 'cathode'} pin ${common}; segments light with their LED forward voltage (drive through series resistors)`,
    prefix: 'U',
    symbol: icSymbol(common === 'CA' ? '7SEG CA' : '7SEG CC', [inp('a'), inp('b'), inp('c'), inp('d')], [inp('e'), inp('f'), inp('g'), inp('dp', undefined, 'dp')], {
      w: 60,
      top: [{ name: common, type: 'passive' }],
      extra: digitGlyph(0, 2, 34),
    }),
    params: [colorParam()],
    optionalPins: ['dp'],
    indicator: { kind: 'seven-seg', signal: 'code' },
    toSpice: (ctx) => {
      const { model, von } = ledFor(ctx);
      const com = ctx.node(common);
      const elements = SEGMENTS.map((s) => (anode ? elD(ctx.name('D', s), com, ctx.node(s), model.name) : elD(ctx.name('D', s), ctx.node(s), com, model.name)));
      const pairs = SEGMENTS.flatMap((s) => (anode ? [com, ctx.node(s)] : [ctx.node(s), com]));
      const sense = card(`MS_DISPLAY_SENSE_${Math.round(von * 1000)}`, 'D_DISPLAY', { von });
      elements.push(aElement(ctx.name('A'), [...pairs, internalNode(ctx, 'code')], GROUND_REF, sense.name));
      return { elements, models: [model, sense] };
    },
    ...codeBinding,
    footprint: 'DISPLAY-7SEG-10P',
    keywords: ['7-segment', 'seven segment', 'display', 'led', anode ? 'common anode' : 'common cathode'],
    provenance: 'MachSim display: one LED model per segment (MachSim fit, VF at 20 mA per colour) plus a display-sensing code model for the schematic',
  };
}

const hexDisplay: LibraryPartDef = {
  id: 'indicators/hex-display',
  name: 'Hex display (decoded)',
  group: 'indicators',
  family: 'Seven-segment',
  description: 'Seven-segment display with built-in hex decoder: shows the hexadecimal digit of the 4-bit input (D0 = LSB)',
  prefix: 'U',
  symbol: icSymbol('HEX', [inp('D0'), inp('D1'), inp('D2'), inp('D3')], [], { w: 60, extra: digitGlyph(4, -4, 30, false) }),
  params: [numParam('threshold', 'Input threshold', '2.5', 'V', { group: 'model' })],
  indicator: { kind: 'seven-seg', signal: 'code' },
  toSpice: (ctx) => {
    const m = familyModel('MS_HEXDISPLAY', 'D_HEXDISPLAY', idealLevels(5, 0, ctx.num('threshold')));
    return { elements: [aElement(ctx.name('A'), [ctx.node('D0'), ctx.node('D1'), ctx.node('D2'), ctx.node('D3'), internalNode(ctx, 'code')], GROUND_REF, m.name)], models: [m] };
  },
  ...codeBinding,
  footprint: 'DISPLAY-HEX',
  keywords: ['hex display', 'hexadecimal', '7-segment', 'decoded display'],
  provenance: 'MachSim decoded display code model (D_HEXDISPLAY): ideal high-impedance inputs, hex font 0-9 A b C d E F',
};

const barGraph: LibraryPartDef = {
  id: 'indicators/bargraph',
  name: 'Bar graph (10 segments)',
  group: 'indicators',
  family: 'Bar graph',
  description: 'Ten independent LEDs (anodes A1..A10, cathodes K1..K10) in one package',
  prefix: 'U',
  symbol: icSymbol(
    'BAR',
    Array.from({ length: 10 }, (_, k) => inp(`A${k + 1}`)),
    Array.from({ length: 10 }, (_, k) => inp(`K${k + 1}`)),
    { w: 60, extra: Array.from({ length: 10 }, (_, k) => rect(-12, -93 + 20 * k, 24, 6, false)) },
  ),
  params: [colorParam()],
  indicator: { kind: 'bargraph', signal: 'code' },
  toSpice: (ctx) => {
    const { model, von } = ledFor(ctx);
    const ks = Array.from({ length: 10 }, (_, k) => k + 1);
    const elements = ks.map((k) => elD(ctx.name('D', String(k)), ctx.node(`A${k}`), ctx.node(`K${k}`), model.name));
    const sense = card(`MS_DISPLAY_SENSE_${Math.round(von * 1000)}`, 'D_DISPLAY', { von });
    elements.push(aElement(ctx.name('A'), [...ks.flatMap((k) => [ctx.node(`A${k}`), ctx.node(`K${k}`)]), internalNode(ctx, 'code')], GROUND_REF, sense.name));
    return { elements, models: [model, sense] };
  },
  ...codeBinding,
  footprint: 'BARGRAPH-20P',
  keywords: ['bar graph', 'led bar', 'level indicator'],
  provenance: 'MachSim display: ten LED models (MachSim fit, VF at 20 mA per colour) plus a display-sensing code model for the schematic',
};

const logicProbe: LibraryPartDef = {
  id: 'indicators/logic-probe',
  name: 'Logic probe',
  group: 'indicators',
  family: 'Probe',
  description: 'Logic level indicator: H above the high threshold, L below the low threshold, undefined in between (1 GΩ input)',
  prefix: 'X',
  virtual: true,
  symbol: makeSymbol(
    [line(0, 0, 0, 10), rect(-10, 10, 20, 26, false, 3), circle(0, 23, 6, '#e53935')],
    [pin('IN', 0, 0, 'up', { type: 'input' })],
    { refPos: { x: 16, y: 18 }, valuePos: { x: 16, y: 30 } },
  ),
  params: [
    numParam('threshold', 'High threshold', '2', 'V', { showOnSchematic: true, help: 'Indicates H at or above this voltage' }),
    numParam('vlow', 'Low threshold', '0.8', 'V', { help: 'Indicates L at or below this voltage' }),
  ],
  indicator: { kind: 'probe', signal: 'voltage' },
  toSpice: (ctx) => {
    if (!(ctx.num('vlow') <= ctx.num('threshold'))) throw new Error('bad value for vlow: must not exceed the high threshold');
    return { elements: [elR(ctx.name('R'), ctx.node('IN'), '0', 1e9)] };
  },
  bindIndicator: (ctx) => {
    const n = ctx.net('IN');
    return n === null ? null : { signal: { kind: 'voltage', pos: n, neg: '0' } };
  },
  keywords: ['logic probe', 'probe', 'level', 'high', 'low'],
};

export const DIGITAL_INDICATOR_PARTS: LibraryPartDef[] = [sevenSeg(true), sevenSeg(false), hexDisplay, barGraph, logicProbe];
