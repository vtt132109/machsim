/**
 * CMOS group: 4000B-series logic ICs.
 *
 * Param 'vdd' (3..18 V, default 5 V) sets the nominal levels (0 / VDD), threshold (VDD/2),
 * output resistance, delays and edge times (kit.ts cmosLevels). VDD / VSS are hidden power
 * pins on the VDD net (see kit.ts): with a VDD net the outputs track it and the thresholds
 * scale with it. The 4066 analog switch is modelled with voltage-controlled switches (S),
 * on above VDD/2 of the vdd param.
 */
import type { LibraryPartDef } from '../../partkit';
import { swModel } from '../../partkit';
import type { ParamDef, ToSpiceContext } from '../../types';
import { cmosLevels, icSymbol, inp, levelsFor, out, powerNodes, powerParams, vddParam, type IcPin } from './kit';
import { HEX1_14, IcBuilder, SEGMENT_PINS, g, gateSlots, type GateDef } from './ttl';

interface CmosSpec {
  pn: string;
  name: string;
  description: string;
  pinCount: 14 | 16;
  left: (IcPin | null)[];
  right: (IcPin | null)[];
  build(b: IcBuilder, vdd: number): void;
  keywords?: string[];
  params?: ParamDef[];
  /** strong output stage (4049 / 4050 buffers) */
  strong?: boolean;
  /** provenance text when it differs from the code-model default (4066 switches) */
  provenance?: string;
}

const POWER: Record<number, string> = { 14: 'VDD = 14, VSS = 7', 16: 'VDD = 16, VSS = 8' };

function vddOf(ctx: ToSpiceContext): number {
  const v = ctx.num('vdd');
  if (!(v >= 3 && v <= 18)) throw new Error(`bad value for vdd: ${v} V (3..18 V)`);
  return v;
}

function cmosPart(s: CmosSpec, powerPins?: string): LibraryPartDef {
  return {
    id: `cmos/${s.pn}`,
    name: s.pn,
    group: 'cmos',
    family: '4000',
    description: `${s.name}. ${s.description} Hidden power pins (${powerPins ?? POWER[s.pinCount]}) on the VDD net.`,
    prefix: 'U',
    symbol: icSymbol(s.pn, s.left, s.right),
    params: [vddParam(), ...(s.params ?? []), ...powerParams('vddnet', 'VDD')],
    toSpice: (ctx) => {
      const vdd = vddOf(ctx);
      const b = new IcBuilder(ctx, levelsFor(ctx, cmosLevels(vdd, s.strong)), `MS_CD${s.pn}`, powerNodes(ctx, 'vddnet', 'VDD'));
      s.build(b, vdd);
      return { elements: b.elements, models: b.models };
    },
    footprint: s.pinCount === 14 ? 'DIP-14' : 'DIP-16',
    keywords: [s.pn, `cd${s.pn}`, 'cmos', '4000', ...(s.keywords ?? [])],
    provenance:
      s.provenance ??
      `MachSim code model (${s.name.toLowerCase()}); 4000B-series levels and typical delays scaled with VDD from public datasheet figures (60 ns gate delay, 100 ns edges at 5 V)`,
  };
}

function gateIc(pn: string, name: string, type: string, gates: GateDef[], description: string, keywords: string[], extra: (vdd: number) => Record<string, number> = () => ({}), strong = false, powerPins?: string): LibraryPartDef {
  const { left, right } = gateSlots(gates);
  return cmosPart(
    {
      pn,
      name,
      description,
      pinCount: strong ? 16 : 14, // the 4049 / 4050 buffers are 16-pin parts (pins 13 and 16 not connected)
      left,
      right,
      keywords,
      strong,
      build: (b, vdd) => {
        const m = b.model(type, strong ? 0.75 : 1, extra(vdd));
        gates.forEach((gd, i) => b.add(String(i + 1), [...gd.ins.map(([p]) => p), gd.out[0]], m));
      },
    },
    powerPins,
  );
}

/** 4049 / 4050 pinout: section k input / output pin numbers. */
const HEX_BUFFER: GateDef[] = [g(1, ['3'], '2'), g(2, ['5'], '4'), g(3, ['7'], '6'), g(4, ['9'], '10'), g(5, ['11'], '12'), g(6, ['14'], '15')];

function dualFf(pn: string, name: string, type: 'D_DFF' | 'D_JKFF', s1: Record<string, string>, s2: Record<string, string>, factor: number, description: string): LibraryPartDef {
  const data = type === 'D_DFF' ? ['D'] : ['J', 'K'];
  const section = (k: number, p: Record<string, string>) => ({
    left: [...data.map((d) => inp(`${k}${d}`, p[d])), inp(`${k}CLK`, p.CLK, `${k}CLK`, true), inp(`${k}SET`, p.SET), inp(`${k}RESET`, p.RESET)],
    right: [out(`${k}Q`, p.Q), out(`${k}QN`, p.QN, `~${k}Q`)],
  });
  const a = section(1, s1);
  const c = section(2, s2);
  const pad = <T,>(xs: (T | null)[], n: number) => [...xs, ...Array<null>(Math.max(0, n - xs.length)).fill(null)];
  const rows = a.left.length;
  return cmosPart({
    pn,
    name,
    description,
    pinCount: type === 'D_DFF' ? 14 : 16,
    left: [...a.left, null, ...c.left],
    right: [...pad(a.right, rows), null, ...c.right],
    keywords: ['flip-flop', type === 'D_DFF' ? 'd flip-flop' : 'jk flip-flop'],
    build: (b) => {
      const m = b.model(type, factor);
      for (const k of [1, 2]) b.add(String(k), [...data.map((d) => `${k}${d}`), `${k}CLK`, `${k}SET`, `${k}RESET`, `${k}Q`, `${k}QN`], m);
    },
  });
}

const cd4017 = cmosPart({
  pn: '4017',
  name: 'Decade counter / divider with 10 decoded outputs',
  description: 'Johnson counter: counts on CLK rising while ~INH (clock enable) is low, or on ~INH falling while CLK is high; RST high returns to Q0; CO is high for counts 0-4.',
  pinCount: 16,
  left: [inp('CLK', '14', 'CLK', true), inp('INH', '13', '~INH'), inp('RST', '15')],
  right: [...['3', '2', '4', '7', '10', '1', '5', '6', '9', '11'].map((n, k) => out(`Q${k}`, n)), null, out('CO', '12')],
  keywords: ['counter', 'decade', 'johnson', 'divider', 'led chaser'],
  build: (b) => b.add(undefined, ['CLK', 'INH', 'RST', ...Array.from({ length: 10 }, (_, k) => `Q${k}`), 'CO'], b.model('D_CNT_JOHNSON', 3)),
});

const cd4040 = cmosPart({
  pn: '4040',
  name: '12-stage ripple-carry binary counter',
  description: 'Counts on the falling clock edge; RST high clears.',
  pinCount: 16,
  left: [inp('CLK', '10', 'CLK', true), inp('RST', '11')],
  right: ['9', '7', '6', '5', '3', '2', '4', '13', '12', '14', '15', '1'].map((n, k) => out(`Q${k + 1}`, n)),
  keywords: ['counter', 'binary', 'ripple', 'divider'],
  build: (b) => b.add(undefined, ['CLK', 'RST', ...Array.from({ length: 12 }, (_, k) => `Q${k + 1}`)], b.model('D_CNT_RIPPLE', 5, { stages: 12 })),
});

/** Stages brought out by the 4060: Q4..Q10, Q12..Q14. */
const CD4060_STAGES = [4, 5, 6, 7, 8, 9, 10, 12, 13, 14];

const cd4060 = cmosPart({
  pn: '4060',
  name: '14-stage ripple-carry binary counter with oscillator',
  description:
    'Oscillator stages: φO = ~φI (RTC) and φO̅ = φI (CTC, the complement of φO, modelled with the same delay so the RC loop switches cleanly); connect Rs to φI, Rt to φO and Ct to φO̅ for an RC oscillator (f ≈ 1 / (2.3 Rt Ct)). Counts on the falling edge of φI; RST high clears the counter.',
  pinCount: 16,
  left: [inp('PHI_I', '11', 'φI', true), inp('RST', '12'), null, out('PHI_O', '10', 'φO'), out('PHI_ON', '9', '~φO')],
  right: CD4060_STAGES.map((s, k) => out(`Q${s}`, ['7', '5', '4', '6', '14', '13', '15', '1', '2', '3'][k])),
  keywords: ['counter', 'oscillator', 'divider', 'ripple', 'timer'],
  build: (b) => {
    const tapmask = CD4060_STAGES.reduce((acc, s) => acc + 2 ** (s - 1), 0);
    b.add('cnt', ['PHI_I', 'RST', ...CD4060_STAGES.map((s) => `Q${s}`)], b.model('D_CNT_RIPPLE', 6, { stages: 14, tapmask }));
    b.add('o1', ['PHI_I', 'PHI_O'], b.model('D_INVERTER', 1));
    b.add('o2', ['PHI_I', 'PHI_ON'], b.model('D_BUFFER', 1));
  },
});

const cd4066 = cmosPart({
  pn: '4066',
  name: 'Quad bilateral analog switch',
  description: 'Each switch conducts between its two I/O pins (RON ≈ 1350 Ω·V / VDD) while its control input is above VDD/2.',
  pinCount: 14,
  left: [inp('1C', '13', '1CTRL'), { name: '1A', number: '1', label: '1 I/O', type: 'passive' }, { name: '1B', number: '2', label: '1 O/I', type: 'passive' }, null, inp('2C', '5', '2CTRL'), { name: '2A', number: '4', label: '2 I/O', type: 'passive' }, { name: '2B', number: '3', label: '2 O/I', type: 'passive' }],
  right: [inp('3C', '6', '3CTRL'), { name: '3A', number: '8', label: '3 I/O', type: 'passive' }, { name: '3B', number: '9', label: '3 O/I', type: 'passive' }, null, inp('4C', '12', '4CTRL'), { name: '4A', number: '11', label: '4 I/O', type: 'passive' }, { name: '4B', number: '10', label: '4 O/I', type: 'passive' }],
  keywords: ['analog switch', 'bilateral', 'transmission gate', 'multiplexer'],
  provenance: 'MachSim voltage-controlled switch model: threshold VDD/2, RON ≈ 1350 Ω·V / VDD (270 Ω at 5 V, 90 Ω at 15 V, typical 4066B figures), ROFF 10 GΩ',
  build: (b, vdd) => {
    const m = swModel(`MS_CD4066_SW_${String(vdd).replace(/[^0-9]/g, 'p')}`, vdd / 2, 0.05 * vdd, 1350 / vdd, 1e10);
    b.models.push(m);
    for (const k of [1, 2, 3, 4]) {
      b.elements.push({ type: 'S', name: b.ctx.name('S', String(k)), nodes: [b.n(`${k}A`), b.n(`${k}B`), b.n(`${k}C`), '0'], model: m.name, params: {} });
    }
  },
});

const cd4511 = cmosPart({
  pn: '4511',
  name: 'BCD to 7-segment latch / decoder / driver',
  description: 'Active-high source-driver outputs for common-cathode displays; LE high holds the latched code, ~BL blanks, ~LT lights every segment; codes 10-15 are blank.',
  pinCount: 16,
  left: [inp('A', '7'), inp('B', '1'), inp('C', '2'), inp('D', '6'), null, inp('LT', '3', '~LT'), inp('BL', '4', '~BL'), inp('LE', '5')],
  right: SEGMENT_PINS.map((s, k) => out(s, ['13', '12', '11', '10', '9', '15', '14'][k], s.slice(3).toLowerCase())),
  keywords: ['7-segment', 'seven segment', 'decoder', 'latch', 'driver', 'bcd'],
  build: (b, vdd) => b.add(undefined, ['A', 'B', 'C', 'D', 'LT', 'BL', 'LE', ...SEGMENT_PINS], b.model('D_BCD7SEG_LATCH', 5, { rhigh: (90 * 5) / vdd })),
});

export const CMOS_PARTS: LibraryPartDef[] = [
  gateIc('4001', 'Quad 2-input NOR gate', 'D_NOR', CD_QUAD(), 'Y = ~(A+B).', ['nor', 'gate']),
  gateIc('4011', 'Quad 2-input NAND gate', 'D_NAND', CD_QUAD(), 'Y = ~(A·B).', ['nand', 'gate']),
  dualFf('4013', 'Dual D flip-flop with set and reset', 'D_DFF', { Q: '1', QN: '2', CLK: '3', RESET: '4', D: '5', SET: '6' }, { SET: '8', D: '9', RESET: '10', CLK: '11', QN: '12', Q: '13' }, 2.3, 'Positive-edge triggered; SET / RESET active high and asynchronous.'),
  cd4017,
  dualFf('4027', 'Dual JK flip-flop with set and reset', 'D_JKFF', { Q: '1', QN: '2', CLK: '3', RESET: '4', K: '5', J: '6', SET: '7' }, { SET: '9', J: '10', K: '11', RESET: '12', CLK: '13', QN: '14', Q: '15' }, 2.5, 'Positive-edge triggered; SET / RESET active high and asynchronous.'),
  cd4040,
  gateIc('4049', 'Hex inverting buffer / converter', 'D_INVERTER', HEX_BUFFER, 'High sink current (≈110 Ω at 5 V).', ['inverter', 'buffer', 'level shifter'], () => ({}), true, 'VCC = 1, VSS = 8'),
  gateIc('4050', 'Hex non-inverting buffer / converter', 'D_BUFFER', HEX_BUFFER, 'High sink current (≈110 Ω at 5 V).', ['buffer', 'level shifter'], () => ({}), true, 'VCC = 1, VSS = 8'),
  cd4060,
  cd4066,
  gateIc('4069', 'Hex inverter', 'D_INVERTER', HEX1_14, 'Y = ~A.', ['inverter', 'not', 'gate']),
  gateIc('4070', 'Quad 2-input XOR gate', 'D_XOR', CD_QUAD(), 'Y = A⊕B.', ['xor', 'exclusive or', 'gate']),
  gateIc('4071', 'Quad 2-input OR gate', 'D_OR', CD_QUAD(), 'Y = A+B.', ['or', 'gate']),
  gateIc('4081', 'Quad 2-input AND gate', 'D_AND', CD_QUAD(), 'Y = A·B.', ['and', 'gate']),
  gateIc('4093', 'Quad 2-input NAND Schmitt trigger', 'D_NAND', CD_QUAD(), 'Y = ~(A·B) with input hysteresis (VT+ ≈ 0.58 VDD, VT- ≈ 0.38 VDD).', ['nand', 'schmitt', 'hysteresis'], (vdd) => ({ vtp: 0.58 * vdd, vtn: 0.38 * vdd })),
  cd4511,
];

/** Quad 2-input gate pinout shared by 4001 / 4011 / 4070 / 4071 / 4081 / 4093. */
function CD_QUAD(): GateDef[] {
  return [g(1, ['1', '2'], '3'), g(2, ['5', '6'], '4'), g(3, ['8', '9'], '10'), g(4, ['12', '13'], '11')];
}
