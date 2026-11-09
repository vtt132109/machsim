/**
 * 74xx logic catalogue: the common device types of the 74 series, each generated in the families
 * it exists in (STD, LS, S, F, ALS, AS, HC, HCT, AC, ACT; see logicKit.ts for the id / naming
 * rules and the pin text format). Pinouts are the public JEDEC / datasheet DIP pinouts; behaviour
 * comes from the code models of src/sim/devices/digital, timing from the family tables.
 *
 * Delay factors (multiples of the family gate delay) approximate the typical datasheet paths:
 * buffers 1.2, flip-flop clock-to-output 2, counters 2-2.5, decoders / multiplexers 2-2.4,
 * arithmetic 2.4-3, monostables 3-4.
 */
import { numParam } from '../partkit';
import type { ParamDef } from '../types';
import type { IcBuilder } from '../parts/digital/ttl';
import { fams, gates, names, type LogicFamily, type LogicKind, type LogicSpec, type Sections } from './logicKit';

// ---------------------------------------------------------------------------------------------
// gate packages: [inputs 'NAME:NUM' ..., output 'NAME:NUM']

type G = [string[], string];

/** Left / right pin text and element sections of a gate package (inputs stacked, output centred). */
export function gateSides(gs: G[]): { left: string; right: string; sections: Sections } {
  const left: string[] = [];
  const right: string[] = [];
  for (const [ins, o] of gs) {
    const n = ins.length;
    const rows = n === 1 ? 1 : n === 2 ? 3 : n + 1;
    const l: string[] = Array(rows).fill('|');
    const r: string[] = Array(rows).fill('|');
    if (n === 2) {
      l[0] = ins[0];
      l[2] = ins[1];
    } else ins.forEach((p, i) => (l[i] = p));
    r[n === 1 ? 0 : 1] = o;
    left.push(...l);
    right.push(...r);
  }
  while (left.length && left[left.length - 1] === '|' && right[right.length - 1] === '|') {
    left.pop();
    right.pop();
  }
  const pin = (t: string) => t.split(':')[0].replace(/^[~+\-=%]+/, '');
  return { left: left.join(' '), right: right.join(' '), sections: gs.map(([ins, o]) => [ins.map(pin), pin(o)]) };
}

export const QUAD2: G[] = [[['1A:1', '1B:2'], '1Y:3'], [['2A:4', '2B:5'], '2Y:6'], [['3A:9', '3B:10'], '3Y:8'], [['4A:12', '4B:13'], '4Y:11']];
export const NOR2: G[] = [[['1A:2', '1B:3'], '1Y:1'], [['2A:5', '2B:6'], '2Y:4'], [['3A:8', '3B:9'], '3Y:10'], [['4A:11', '4B:12'], '4Y:13']];
export const HEX1: G[] = [[['1A:1'], '1Y:2'], [['2A:3'], '2Y:4'], [['3A:5'], '3Y:6'], [['4A:9'], '4Y:8'], [['5A:11'], '5Y:10'], [['6A:13'], '6Y:12']];
export const TRI3: G[] = [[['1A:1', '1B:2', '1C:13'], '1Y:12'], [['2A:3', '2B:4', '2C:5'], '2Y:6'], [['3A:9', '3B:10', '3C:11'], '3Y:8']];
export const DUAL4: G[] = [[['1A:1', '1B:2', '1C:4', '1D:5'], '1Y:6'], [['2A:9', '2B:10', '2C:12', '2D:13'], '2Y:8']];
/** 74266 / 4000-series quad 2-input pinout. */
export const QUAD2B: G[] = [[['1A:1', '1B:2'], '1Y:3'], [['2A:5', '2B:6'], '2Y:4'], [['3A:8', '3B:9'], '3Y:10'], [['4A:12', '4B:13'], '4Y:11']];
const NAND8: G[] = [[['A:1', 'B:2', 'C:3', 'D:4', 'E:5', 'F:6', 'G:11', 'H:12'], 'Y:8']];
const NAND13: G[] = [[['A:1', 'B:2', 'C:3', 'D:4', 'E:5', 'F:6', 'G:7', 'H:10', 'I:11', 'J:12', 'K:13', 'L:14', 'M:15'], 'Y:9']];

interface GateOpts {
  output?: LogicSpec['output'];
  schmitt?: boolean;
  /** model params added to the gate model (open_drain, vtp / vtn handled by schmitt) */
  extra?: Record<string, number>;
  factor?: number;
  pins?: number;
  keywords?: string[];
}

/** Schmitt thresholds of a family (TTL: 1.6 / 0.8 V; CMOS: 0.55 / 0.35 of the supply). */
export function schmittThresholds(b: IcBuilder): Record<string, number> {
  return b.levels.thresh_scale ? { vtp: 0.55 * b.levels.vnom, vtn: 0.35 * b.levels.vnom } : { vtp: 1.6, vtn: 0.8 };
}

export function gateSpec(pn: string, name: string, vi: string, type: string, gs: G[], fam: string, desc: string, descVi: string, o: GateOpts = {}): LogicSpec {
  const { left, right, sections } = gateSides(gs);
  return {
    pn,
    name,
    vi,
    desc,
    descVi,
    pins: o.pins ?? 14,
    left,
    right,
    fams: fams(fam),
    kind: type === 'D_BUFFER' || type === 'D_INVERTER' ? 'buffer' : 'gate',
    output: o.output,
    schmitt: o.schmitt,
    delay: o.factor ?? 1,
    keywords: o.keywords,
    build: (b) => gates(b, type, sections, o.factor ?? 1, { ...(o.output === 'open-collector' ? { open_drain: 1 } : {}), ...(o.schmitt ? schmittThresholds(b) : {}), ...(o.extra ?? {}) }),
  };
}

const OC = { output: 'open-collector' as const };

const GATES: LogicSpec[] = [
  gateSpec('00', 'Quad 2-input NAND gate', 'Bốn cổng NAND 2 đầu vào', 'D_NAND', QUAD2, 'ALL', 'Y = ~(A·B).', 'Y = ~(A·B).', { keywords: ['nand', 'gate'] }),
  gateSpec('01', 'Quad 2-input NAND gate, open collector', 'Bốn cổng NAND 2 đầu vào, collector hở', 'D_NAND', NOR2, 'STD LS', 'Y = ~(A·B); outputs need a pull-up resistor (02-style pinout).', 'Y = ~(A·B); ngõ ra cần điện trở kéo lên (sơ đồ chân kiểu 02).', { ...OC, keywords: ['nand', 'open collector'] }),
  gateSpec('02', 'Quad 2-input NOR gate', 'Bốn cổng NOR 2 đầu vào', 'D_NOR', NOR2, 'ALL', 'Y = ~(A+B).', 'Y = ~(A+B).', { keywords: ['nor', 'gate'] }),
  gateSpec('03', 'Quad 2-input NAND gate, open collector', 'Bốn cổng NAND 2 đầu vào, collector hở', 'D_NAND', QUAD2, 'STD LS S ALS HC', 'Y = ~(A·B); outputs need a pull-up resistor (wired-AND).', 'Y = ~(A·B); ngõ ra cần điện trở kéo lên (nối dây kiểu AND).', { ...OC, keywords: ['nand', 'open collector'] }),
  gateSpec('04', 'Hex inverter', 'Sáu cổng đảo', 'D_INVERTER', HEX1, 'ALL', 'Y = ~A.', 'Y = ~A.', { keywords: ['inverter', 'not'] }),
  gateSpec('05', 'Hex inverter, open collector', 'Sáu cổng đảo, collector hở', 'D_INVERTER', HEX1, 'STD LS S ALS HC', 'Y = ~A; outputs need a pull-up resistor.', 'Y = ~A; ngõ ra cần điện trở kéo lên.', { ...OC, keywords: ['inverter', 'open collector'] }),
  gateSpec('06', 'Hex inverter buffer / driver, open collector (30 V)', 'Sáu cổng đảo đệm / lái tải, collector hở (30 V)', 'D_INVERTER', HEX1, 'STD LS', 'Y = ~A; high-voltage open-collector outputs sink up to 40 mA (lamps, relays, LEDs).', 'Y = ~A; ngõ ra collector hở chịu áp cao, hút tới 40 mA (đèn, rơ-le, LED).', { ...OC, factor: 1.2, keywords: ['inverter', 'driver', 'open collector', 'high voltage'] }),
  gateSpec('07', 'Hex buffer / driver, open collector (30 V)', 'Sáu cổng đệm / lái tải, collector hở (30 V)', 'D_BUFFER', HEX1, 'STD LS HC', 'Y = A; high-voltage open-collector outputs (level shifting, lamp and relay drivers).', 'Y = A; ngõ ra collector hở chịu áp cao (chuyển mức, lái đèn và rơ-le).', { ...OC, factor: 1.2, keywords: ['buffer', 'driver', 'open collector'] }),
  gateSpec('08', 'Quad 2-input AND gate', 'Bốn cổng AND 2 đầu vào', 'D_AND', QUAD2, 'ALL', 'Y = A·B.', 'Y = A·B.', { keywords: ['and', 'gate'] }),
  gateSpec('09', 'Quad 2-input AND gate, open collector', 'Bốn cổng AND 2 đầu vào, collector hở', 'D_AND', QUAD2, 'STD LS S ALS HC', 'Y = A·B; outputs need a pull-up resistor.', 'Y = A·B; ngõ ra cần điện trở kéo lên.', { ...OC, keywords: ['and', 'open collector'] }),
  gateSpec('10', 'Triple 3-input NAND gate', 'Ba cổng NAND 3 đầu vào', 'D_NAND', TRI3, 'ALL', 'Y = ~(A·B·C).', 'Y = ~(A·B·C).', { keywords: ['nand', 'gate'] }),
  gateSpec('11', 'Triple 3-input AND gate', 'Ba cổng AND 3 đầu vào', 'D_AND', TRI3, 'ALL', 'Y = A·B·C.', 'Y = A·B·C.', { keywords: ['and', 'gate'] }),
  gateSpec('12', 'Triple 3-input NAND gate, open collector', 'Ba cổng NAND 3 đầu vào, collector hở', 'D_NAND', TRI3, 'STD LS ALS', 'Y = ~(A·B·C); outputs need a pull-up resistor.', 'Y = ~(A·B·C); ngõ ra cần điện trở kéo lên.', { ...OC, keywords: ['nand', 'open collector'] }),
  gateSpec('13', 'Dual 4-input NAND Schmitt trigger', 'Hai cổng NAND 4 đầu vào Schmitt', 'D_NAND', DUAL4, 'STD LS', 'Y = ~(A·B·C·D) with input hysteresis (VT+ ≈ 1.6 V, VT- ≈ 0.8 V).', 'Y = ~(A·B·C·D) có trễ đầu vào (VT+ ≈ 1,6 V, VT- ≈ 0,8 V).', { schmitt: true, keywords: ['nand', 'schmitt', 'hysteresis'] }),
  gateSpec('14', 'Hex Schmitt-trigger inverter', 'Sáu cổng đảo Schmitt', 'D_INVERTER', HEX1, 'STD LS F HC HCT AC ACT', 'Y = ~A with input hysteresis: cleans slow or noisy edges, RC oscillators.', 'Y = ~A có trễ đầu vào: làm sạch sườn chậm hoặc nhiễu, mạch dao động RC.', { schmitt: true, keywords: ['inverter', 'schmitt', 'hysteresis'] }),
  gateSpec('15', 'Triple 3-input AND gate, open collector', 'Ba cổng AND 3 đầu vào, collector hở', 'D_AND', TRI3, 'LS S ALS', 'Y = A·B·C; outputs need a pull-up resistor.', 'Y = A·B·C; ngõ ra cần điện trở kéo lên.', { ...OC, keywords: ['and', 'open collector'] }),
  gateSpec('16', 'Hex inverter buffer / driver, open collector (15 V)', 'Sáu cổng đảo đệm, collector hở (15 V)', 'D_INVERTER', HEX1, 'STD', 'Y = ~A; 15 V open-collector outputs sink up to 40 mA.', 'Y = ~A; ngõ ra collector hở 15 V, hút tới 40 mA.', { ...OC, factor: 1.2, keywords: ['inverter', 'driver', 'open collector'] }),
  gateSpec('17', 'Hex buffer / driver, open collector (15 V)', 'Sáu cổng đệm, collector hở (15 V)', 'D_BUFFER', HEX1, 'STD', 'Y = A; 15 V open-collector outputs sink up to 40 mA.', 'Y = A; ngõ ra collector hở 15 V, hút tới 40 mA.', { ...OC, factor: 1.2, keywords: ['buffer', 'driver', 'open collector'] }),
  gateSpec('19', 'Hex Schmitt-trigger inverter', 'Sáu cổng đảo Schmitt', 'D_INVERTER', HEX1, 'LS', 'Y = ~A with input hysteresis (74LS14 function).', 'Y = ~A có trễ đầu vào (chức năng như 74LS14).', { schmitt: true, keywords: ['inverter', 'schmitt'] }),
  gateSpec('20', 'Dual 4-input NAND gate', 'Hai cổng NAND 4 đầu vào', 'D_NAND', DUAL4, 'STD LS S F ALS AS HC HCT', 'Y = ~(A·B·C·D); pins 3 and 11 are not connected.', 'Y = ~(A·B·C·D); chân 3 và 11 để trống.', { keywords: ['nand', 'gate'] }),
  gateSpec('21', 'Dual 4-input AND gate', 'Hai cổng AND 4 đầu vào', 'D_AND', DUAL4, 'LS F ALS HC HCT', 'Y = A·B·C·D; pins 3 and 11 are not connected.', 'Y = A·B·C·D; chân 3 và 11 để trống.', { keywords: ['and', 'gate'] }),
  gateSpec('22', 'Dual 4-input NAND gate, open collector', 'Hai cổng NAND 4 đầu vào, collector hở', 'D_NAND', DUAL4, 'STD LS S ALS', 'Y = ~(A·B·C·D); outputs need a pull-up resistor.', 'Y = ~(A·B·C·D); ngõ ra cần điện trở kéo lên.', { ...OC, keywords: ['nand', 'open collector'] }),
  gateSpec('26', 'Quad 2-input NAND gate, open collector (15 V)', 'Bốn cổng NAND 2 đầu vào, collector hở (15 V)', 'D_NAND', QUAD2, 'STD LS', 'Y = ~(A·B); high-voltage open-collector outputs for interfacing.', 'Y = ~(A·B); ngõ ra collector hở chịu áp cao để giao tiếp.', { ...OC, keywords: ['nand', 'open collector', 'interface'] }),
  gateSpec('27', 'Triple 3-input NOR gate', 'Ba cổng NOR 3 đầu vào', 'D_NOR', TRI3, 'STD LS ALS HC HCT AC', 'Y = ~(A+B+C).', 'Y = ~(A+B+C).', { keywords: ['nor', 'gate'] }),
  gateSpec('28', 'Quad 2-input NOR buffer', 'Bốn cổng NOR 2 đầu vào loại đệm', 'D_NOR', NOR2, 'STD LS ALS', 'Y = ~(A+B) with high-current outputs (02-style pinout).', 'Y = ~(A+B) có ngõ ra dòng lớn (sơ đồ chân kiểu 02).', { factor: 1.2, keywords: ['nor', 'buffer'] }),
  gateSpec('30', '8-input NAND gate', 'Cổng NAND 8 đầu vào', 'D_NAND', NAND8, 'STD LS S ALS HC HCT', 'Y = ~(A·B·C·D·E·F·G·H).', 'Y = ~(A·B·C·D·E·F·G·H).', { keywords: ['nand', '8-input'] }),
  gateSpec('32', 'Quad 2-input OR gate', 'Bốn cổng OR 2 đầu vào', 'D_OR', QUAD2, 'ALL', 'Y = A+B.', 'Y = A+B.', { keywords: ['or', 'gate'] }),
  gateSpec('33', 'Quad 2-input NOR buffer, open collector', 'Bốn cổng NOR 2 đầu vào loại đệm, collector hở', 'D_NOR', NOR2, 'STD LS ALS', 'Y = ~(A+B); high-current open-collector outputs.', 'Y = ~(A+B); ngõ ra collector hở dòng lớn.', { ...OC, factor: 1.2, keywords: ['nor', 'buffer', 'open collector'] }),
  gateSpec('37', 'Quad 2-input NAND buffer', 'Bốn cổng NAND 2 đầu vào loại đệm', 'D_NAND', QUAD2, 'STD LS S F ALS', 'Y = ~(A·B) with high-current outputs (line drivers, clock buffers).', 'Y = ~(A·B) có ngõ ra dòng lớn (lái đường dây, đệm xung nhịp).', { factor: 1.2, keywords: ['nand', 'buffer'] }),
  gateSpec('38', 'Quad 2-input NAND buffer, open collector', 'Bốn cổng NAND 2 đầu vào loại đệm, collector hở', 'D_NAND', QUAD2, 'STD LS S F ALS', 'Y = ~(A·B); high-current open-collector outputs (bus lines, LEDs).', 'Y = ~(A·B); ngõ ra collector hở dòng lớn (đường bus, LED).', { ...OC, factor: 1.2, keywords: ['nand', 'buffer', 'open collector'] }),
  gateSpec('40', 'Dual 4-input NAND buffer', 'Hai cổng NAND 4 đầu vào loại đệm', 'D_NAND', DUAL4, 'STD LS S F ALS', 'Y = ~(A·B·C·D) with high-current outputs.', 'Y = ~(A·B·C·D) có ngõ ra dòng lớn.', { factor: 1.2, keywords: ['nand', 'buffer'] }),
  gateSpec('86', 'Quad 2-input XOR gate', 'Bốn cổng XOR 2 đầu vào', 'D_XOR', QUAD2, 'ALL', 'Y = A⊕B (high when the inputs differ).', 'Y = A⊕B (mức cao khi hai đầu vào khác nhau).', { factor: 1.3, keywords: ['xor', 'exclusive or'] }),
  gateSpec('132', 'Quad 2-input NAND Schmitt trigger', 'Bốn cổng NAND 2 đầu vào Schmitt', 'D_NAND', QUAD2, 'STD LS S F ALS HC HCT AC ACT', 'Y = ~(A·B) with input hysteresis (00-style pinout).', 'Y = ~(A·B) có trễ đầu vào (sơ đồ chân kiểu 00).', { schmitt: true, keywords: ['nand', 'schmitt', 'hysteresis'] }),
  gateSpec('133', '13-input NAND gate', 'Cổng NAND 13 đầu vào', 'D_NAND', NAND13, 'LS S ALS HC', 'Y = ~(A·B·…·M).', 'Y = ~(A·B·…·M).', { pins: 16, keywords: ['nand', '13-input'] }),
  gateSpec('136', 'Quad 2-input XOR gate, open collector', 'Bốn cổng XOR 2 đầu vào, collector hở', 'D_XOR', QUAD2, 'LS ALS', 'Y = A⊕B; outputs need a pull-up resistor.', 'Y = A⊕B; ngõ ra cần điện trở kéo lên.', { ...OC, factor: 1.3, keywords: ['xor', 'open collector'] }),
  gateSpec('266', 'Quad 2-input XNOR gate, open collector', 'Bốn cổng XNOR 2 đầu vào, collector hở', 'D_XNOR', QUAD2B, 'LS HC', 'Y = ~(A⊕B) (high when the inputs are equal); outputs need a pull-up resistor.', 'Y = ~(A⊕B) (mức cao khi hai đầu vào bằng nhau); ngõ ra cần điện trở kéo lên.', { ...OC, factor: 1.3, keywords: ['xnor', 'equality', 'open collector'] }),
];

// ---------------------------------------------------------------------------------------------
// buffers and transceivers

function tri(b: IcBuilder, extra: Record<string, number>, sections: [string, string, string][], prefix = ''): void {
  const m = b.model('D_TRISTATE', 1.2, extra);
  sections.forEach(([a, en, y], i) => b.add(`${prefix}${i + 1}`, [a, en, y], m));
}

const OCTAL_244_LEFT = '1G:1 1A1:2 1A2:4 1A3:6 1A4:8 | 2G:19 2A1:11 2A2:13 2A3:15 2A4:17';
const OCTAL_244_RIGHT = '| 1Y1:18 1Y2:16 1Y3:14 1Y4:12 | | 2Y1:9 2Y2:7 2Y3:5 2Y4:3';

function octal244(pn: string, name: string, vi: string, invert: boolean, g2High: boolean, fam: string, desc: string, descVi: string): LogicSpec {
  return {
    pn,
    name,
    vi,
    desc,
    descVi,
    pins: 20,
    left: OCTAL_244_LEFT.replace('1G:1', '~1G:1').replace('2G:19', g2High ? '2G:19' : '~2G:19'),
    right: OCTAL_244_RIGHT,
    fams: fams(fam),
    kind: 'buffer',
    output: '3-state',
    delay: 1.2,
    keywords: ['buffer', 'line driver', '3-state', 'bus'],
    build: (b) => {
      const g1 = { enable_low: 1, invert: invert ? 1 : 0 };
      const g2 = { enable_low: g2High ? 0 : 1, invert: invert ? 1 : 0 };
      tri(b, g1, [1, 2, 3, 4].map((k) => [`1A${k}`, '1G', `1Y${k}`]), '1');
      tri(b, g2, [1, 2, 3, 4].map((k) => [`2A${k}`, '2G', `2Y${k}`]), '2');
    },
  };
}

function octal540(pn: string, name: string, vi: string, invert: boolean, fam: string): LogicSpec {
  return {
    pn,
    name,
    vi,
    desc: 'Eight buffers in a flow-through pinout (inputs on one side, outputs on the other); outputs enabled while ~G1 and ~G2 are both low.',
    descVi: 'Tám bộ đệm, chân vào một bên, chân ra một bên; ngõ ra hoạt động khi ~G1 và ~G2 cùng ở mức thấp.',
    pins: 20,
    left: `~G1:1 ~G2:19 | ${names('A', 8, 1).map((n, i) => `${n}:${i + 2}`).join(' ')}`,
    right: `| | | ${names('Y', 8, 1).map((n, i) => `${n}:${18 - i}`).join(' ')}`,
    fams: fams(fam),
    kind: 'buffer',
    output: '3-state',
    delay: 1.2,
    keywords: ['buffer', 'line driver', '3-state', 'bus', 'flow-through'],
    build: (b) => {
      // the outputs are enabled while ~G1 and ~G2 are both low: NOR(~G1, ~G2) is the enable
      const en = b.node('en');
      b.addNodes('en', [b.n('G1'), b.n('G2'), en], b.model('D_NOR', 0.2));
      const m = b.model('D_TRISTATE', 1.2, { invert: invert ? 1 : 0 });
      for (let k = 1; k <= 8; k++) b.addNodes(String(k), [b.n(`A${k}`), en, b.n(`Y${k}`)], m);
    },
  };
}

export function transceiver(pn: string, name: string, vi: string, invert: boolean, fam: string): LogicSpec {
  return {
    pn,
    name,
    vi,
    desc: `DIR high: A drives B; DIR low: B drives A; ~G high isolates both buses${invert ? ' (inverting)' : ''}.`,
    descVi: `DIR cao: A lái B; DIR thấp: B lái A; ~G cao cách ly cả hai bus${invert ? ' (đảo mức)' : ''}.`,
    pins: 20,
    left: `DIR:1 ~G:19 | ${names('A', 8, 1).map((n, i) => `=${n}:${i + 2}`).join(' ')}`,
    right: `| | | ${names('B', 8, 1).map((n, i) => `=${n}:${18 - i}`).join(' ')}`,
    fams: fams(fam),
    kind: 'transceiver',
    output: '3-state',
    delay: 1.2,
    keywords: ['transceiver', 'bus', 'bidirectional', '3-state'],
    build: (b) => {
      if (!invert) {
        b.add(undefined, ['DIR', 'G', ...names('A', 8, 1), ...names('B', 8, 1)], b.model('D_TRANSCEIVER', 1.2));
        return;
      }
      // inverting: one 3-state inverter per direction and bit, enables decoded from DIR and ~G
      const ab = b.node('ab');
      const ba = b.node('ba');
      const dirn = b.node('dirn');
      const gn = b.node('gn');
      const inv = b.model('D_INVERTER', 0.2);
      b.addNodes('dn', [b.n('DIR'), dirn], inv);
      b.addNodes('gn', [b.n('G'), gn], inv);
      b.addNodes('ab', [b.n('G'), dirn, ab], b.model('D_NOR', 0.2));
      b.addNodes('ba', [dirn, gn, ba], b.model('D_AND', 0.2));
      const m = b.model('D_TRISTATE', 1.2, { invert: 1 });
      for (let k = 1; k <= 8; k++) {
        b.addNodes(`ab${k}`, [b.n(`A${k}`), ab, b.n(`B${k}`)], m);
        b.addNodes(`ba${k}`, [b.n(`B${k}`), ba, b.n(`A${k}`)], m);
      }
    },
  };
}

function quadTransceiver(pn: string, invert: boolean): LogicSpec {
  return {
    pn,
    name: `Quad bus transceiver with 3-state outputs${invert ? ', inverting' : ''}`,
    vi: `Bốn bộ thu phát bus ba trạng thái${invert ? ', đảo mức' : ''}`,
    desc: '~GAB low drives B from A, GBA high drives A from B (do not enable both).',
    descVi: '~GAB thấp: A lái B; GBA cao: B lái A (không bật cả hai cùng lúc).',
    pins: 14,
    left: `~GAB:1 GBA:13 | ${names('A', 4, 1).map((n, i) => `=${n}:${i + 3}`).join(' ')}`,
    right: `| | | ${names('B', 4, 1).map((n, i) => `=${n}:${11 - i}`).join(' ')}`,
    fams: fams('LS'),
    kind: 'transceiver',
    output: '3-state',
    delay: 1.2,
    keywords: ['transceiver', 'bus', 'bidirectional'],
    build: (b) => {
      const mab = b.model('D_TRISTATE', 1.2, { enable_low: 1, invert: invert ? 1 : 0 });
      const mba = b.model('D_TRISTATE', 1.2, { enable_low: 0, invert: invert ? 1 : 0 });
      for (let k = 1; k <= 4; k++) {
        b.add(`ab${k}`, [`A${k}`, 'GAB', `B${k}`], mab);
        b.add(`ba${k}`, [`B${k}`, 'GBA', `A${k}`], mba);
      }
    },
  };
}

const BUFFERS: LogicSpec[] = [
  {
    pn: '125',
    name: 'Quad bus buffer with 3-state outputs (active-low enables)',
    vi: 'Bốn bộ đệm bus ba trạng thái (chân cho phép tích cực thấp)',
    desc: 'Y = A while ~G is low, high impedance while ~G is high.',
    descVi: 'Y = A khi ~G thấp, trở kháng cao khi ~G cao.',
    pins: 14,
    left: '1A:2 ~1G:1 | 2A:5 ~2G:4 | 3A:9 ~3G:10 | 4A:12 ~4G:13',
    right: '1Y:3 | | 2Y:6 | | 3Y:8 | | 4Y:11',
    fams: fams('STD LS ALS HC HCT AC ACT'),
    kind: 'buffer',
    output: '3-state',
    delay: 1.2,
    keywords: ['buffer', '3-state', 'bus'],
    build: (b) => tri(b, { enable_low: 1 }, [1, 2, 3, 4].map((k) => [`${k}A`, `${k}G`, `${k}Y`])),
  },
  {
    pn: '126',
    name: 'Quad bus buffer with 3-state outputs (active-high enables)',
    vi: 'Bốn bộ đệm bus ba trạng thái (chân cho phép tích cực cao)',
    desc: 'Y = A while G is high, high impedance while G is low.',
    descVi: 'Y = A khi G cao, trở kháng cao khi G thấp.',
    pins: 14,
    left: '1A:2 1G:1 | 2A:5 2G:4 | 3A:9 3G:10 | 4A:12 4G:13',
    right: '1Y:3 | | 2Y:6 | | 3Y:8 | | 4Y:11',
    fams: fams('STD LS ALS HC HCT AC'),
    kind: 'buffer',
    output: '3-state',
    delay: 1.2,
    keywords: ['buffer', '3-state', 'bus'],
    build: (b) => tri(b, {}, [1, 2, 3, 4].map((k) => [`${k}A`, `${k}G`, `${k}Y`])),
  },
  ...(['365', '366'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Hex bus driver with 3-state outputs${pn === '366' ? ', inverting' : ''} (common enables)`,
      vi: `Sáu bộ lái bus ba trạng thái${pn === '366' ? ', đảo mức' : ''} (chân cho phép chung)`,
      desc: `${pn === '366' ? 'Y = ~A' : 'Y = A'} while ~G1 and ~G2 are both low.`,
      descVi: `${pn === '366' ? 'Y = ~A' : 'Y = A'} khi ~G1 và ~G2 cùng thấp.`,
      pins: 16,
      left: '~G1:1 ~G2:15 | 1A:2 2A:4 3A:6 4A:10 5A:12 6A:14',
      right: '| | | 1Y:3 2Y:5 3Y:7 4Y:9 5Y:11 6Y:13',
      fams: fams('STD LS HC'),
      kind: 'buffer',
      output: '3-state',
      delay: 1.2,
      keywords: ['buffer', 'bus driver', '3-state'],
      build: (b) => {
        const en = b.node('en');
        b.addNodes('en', [b.n('G1'), b.n('G2'), en], b.model('D_NOR', 0.2));
        const m = b.model('D_TRISTATE', 1.2, { invert: pn === '366' ? 1 : 0 });
        for (let k = 1; k <= 6; k++) b.addNodes(String(k), [b.n(`${k}A`), en, b.n(`${k}Y`)], m);
      },
    }),
  ),
  ...(['367', '368'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Hex bus driver with 3-state outputs${pn === '368' ? ', inverting' : ''} (4 + 2 enables)`,
      vi: `Sáu bộ lái bus ba trạng thái${pn === '368' ? ', đảo mức' : ''} (nhóm 4 + 2)`,
      desc: `${pn === '368' ? 'Y = ~A' : 'Y = A'}; ~1G enables buffers 1-4, ~2G buffers 5-6 (2A1, 2A2).`,
      descVi: `${pn === '368' ? 'Y = ~A' : 'Y = A'}; ~1G điều khiển 4 bộ đệm đầu, ~2G điều khiển 2 bộ còn lại.`,
      pins: 16,
      left: '~1G:1 1A1:2 1A2:4 1A3:6 1A4:10 | ~2G:15 2A1:12 2A2:14',
      right: '| 1Y1:3 1Y2:5 1Y3:7 1Y4:9 | | 2Y1:11 2Y2:13',
      fams: fams('STD LS HC HCT'),
      kind: 'buffer',
      output: '3-state',
      delay: 1.2,
      keywords: ['buffer', 'bus driver', '3-state'],
      build: (b) => {
        const ex = { enable_low: 1, invert: pn === '368' ? 1 : 0 };
        tri(b, ex, [...[1, 2, 3, 4].map((k) => [`1A${k}`, '1G', `1Y${k}`] as [string, string, string]), ...[1, 2].map((k) => [`2A${k}`, '2G', `2Y${k}`] as [string, string, string])]);
      },
    }),
  ),
  octal244('240', 'Octal buffer / line driver with 3-state outputs, inverting', 'Tám bộ đệm / lái đường dây ba trạng thái, đảo mức', true, false, 'LS S F ALS AS HC HCT AC ACT', 'Two groups of four inverting buffers, each enabled by an active-low ~G.', 'Hai nhóm bốn bộ đệm đảo, mỗi nhóm có chân cho phép ~G tích cực thấp.'),
  octal244('241', 'Octal buffer / line driver with 3-state outputs', 'Tám bộ đệm / lái đường dây ba trạng thái', false, true, 'LS S F ALS AS HC HCT AC ACT', 'Two groups of four buffers: ~1G active low, 2G active high.', 'Hai nhóm bốn bộ đệm: ~1G tích cực thấp, 2G tích cực cao.'),
  octal244('244', 'Octal buffer / line driver with 3-state outputs', 'Tám bộ đệm / lái đường dây ba trạng thái', false, false, 'LS S F ALS AS HC HCT AC ACT', 'Two groups of four buffers, each enabled by an active-low ~G.', 'Hai nhóm bốn bộ đệm, mỗi nhóm có chân cho phép ~G tích cực thấp.'),
  octal540('540', 'Octal buffer / line driver with 3-state outputs, inverting', 'Tám bộ đệm ba trạng thái đảo mức, chân thẳng hàng', true, 'LS ALS HC HCT AC ACT'),
  octal540('541', 'Octal buffer / line driver with 3-state outputs', 'Tám bộ đệm ba trạng thái, chân thẳng hàng', false, 'LS ALS HC HCT AC ACT'),
  transceiver('245', 'Octal bus transceiver with 3-state outputs', 'Tám bộ thu phát bus ba trạng thái', false, 'LS F ALS AS HC HCT AC ACT'),
  transceiver('640', 'Octal bus transceiver with 3-state outputs, inverting', 'Tám bộ thu phát bus ba trạng thái, đảo mức', true, 'LS ALS HC'),
  quadTransceiver('242', true),
  quadTransceiver('243', false),
];

// ---------------------------------------------------------------------------------------------
// flip-flops, latches and registers

type FfPins = Record<string, string>;

/** Dual flip-flop: data names, per-section pin numbers, model type, extra model params. */
function dualFf(o: {
  pn: string;
  name: string;
  vi: string;
  desc: string;
  descVi: string;
  type: 'D_DFF' | 'D_JKFF';
  data: string[];
  s: [FfPins, FfPins];
  pins: 14 | 16;
  power?: string;
  fam: string;
  extra?: Record<string, number>;
  /** pins shared by both sections (114: common clock and clear) */
  shared?: FfPins;
  /** 74109: K input active low */
  kbar?: boolean;
}): LogicSpec {
  const left: string[] = [];
  const right: string[] = [];
  [1, 2].forEach((k, si) => {
    if (si) {
      left.push('|');
      right.push('|');
    }
    const p = o.s[si];
    const start = left.length;
    for (const d of o.data) left.push(`${o.kbar && d === 'K' ? '~' : ''}${k}${d}:${p[d]}`);
    if (p.CLK) left.push(`${k}CLK:${p.CLK}>`);
    if (p.PRE) left.push(`~${k}PRE:${p.PRE}`);
    if (p.CLR) left.push(`~${k}CLR:${p.CLR}`);
    while (right.length < start) right.push('|');
    right.push(`${k}Q:${p.Q}`, `${k}QN@~${k}Q:${p.QN}`);
    while (right.length < left.length) right.push('|');
  });
  if (o.shared) {
    left.push('|');
    if (o.shared.CLK) left.push(`CLK:${o.shared.CLK}>`);
    if (o.shared.CLR) left.push(`~CLR:${o.shared.CLR}`);
  }
  return {
    pn: o.pn,
    name: o.name,
    vi: o.vi,
    desc: o.desc,
    descVi: o.descVi,
    pins: o.pins,
    power: o.power,
    left: left.join(' '),
    right: right.join(' '),
    fams: fams(o.fam),
    kind: 'flip-flop',
    delay: 2,
    keywords: ['flip-flop', o.type === 'D_DFF' ? 'd flip-flop' : 'jk flip-flop'],
    build: (b) => {
      const m = b.model(o.type, 2, { set_low: 1, reset_low: 1, ...(o.extra ?? {}) });
      for (const k of [1, 2]) {
        const p = o.s[k - 1];
        const clk = p.CLK ? `${k}CLK` : 'CLK';
        const clr = p.CLR ? `${k}CLR` : o.shared?.CLR ? 'CLR' : 'null';
        const ports = [...o.data.map((d) => `${k}${d}`), clk, p.PRE ? `${k}PRE` : 'null', clr, `${k}Q`, `${k}QN`];
        b.addNodes(String(k), ports.map((x) => b.n(x)), m, {}, o.kbar ? '# ~# # # # # #' : undefined);
      }
    },
  };
}

/** Octal register / latch with the 273 / 373 / 374 / 377 corner pinout or the 573 / 574 flow-through one. */
export function octalReg(o: { pn: string; name: string; vi: string; desc: string; descVi: string; fam: string; latch?: boolean; ctrl1: 'OE' | 'CLR' | 'EN'; flow?: boolean; invert?: boolean }): LogicSpec {
  const dNums = o.flow ? [2, 3, 4, 5, 6, 7, 8, 9] : [3, 4, 7, 8, 13, 14, 17, 18];
  const qNums = o.flow ? [19, 18, 17, 16, 15, 14, 13, 12] : [2, 5, 6, 9, 12, 15, 16, 19];
  const clkName = o.latch ? 'LE' : 'CLK';
  const ctrl = o.ctrl1 === 'OE' ? '~OE:1' : o.ctrl1 === 'CLR' ? '~CLR:1' : '~EN:1';
  return {
    pn: o.pn,
    name: o.name,
    vi: o.vi,
    desc: o.desc,
    descVi: o.descVi,
    pins: 20,
    left: `${o.latch ? 'LE:11' : 'CLK:11>'} ${ctrl} | ${dNums.map((n, i) => `D${i + 1}:${n}`).join(' ')}`,
    right: `| | | ${qNums.map((n, i) => `Q${i + 1}:${n}`).join(' ')}`,
    fams: fams(o.fam),
    kind: o.latch ? 'latch' : 'register',
    output: o.ctrl1 === 'OE' ? '3-state' : 'totem-pole',
    delay: 2,
    keywords: ['register', o.latch ? 'latch' : 'flip-flop', 'octal', ...(o.ctrl1 === 'OE' ? ['3-state', 'bus'] : [])],
    build: (b) => {
      const extra: Record<string, number> = { n: 8, latch: o.latch ? 1 : 0, invert: o.invert ? 1 : 0 };
      if (o.ctrl1 === 'OE') extra.oe = 1;
      if (o.ctrl1 === 'EN') extra.en = 1;
      if (o.ctrl1 === 'CLR') extra.has_clr = 1;
      b.add(undefined, [...names('D', 8, 1), clkName, o.ctrl1, ...names('Q', 8, 1)], b.model('D_REG', 2, extra));
    },
  };
}

const REGISTERS: LogicSpec[] = [
  dualFf({ pn: '73', name: 'Dual JK flip-flop with clear', vi: 'Hai flip-flop JK có xoá', desc: 'Negative-edge triggered, ~CLR asynchronous; J = K = 1 toggles.', descVi: 'Kích sườn xuống, ~CLR không đồng bộ; J = K = 1 thì lật trạng thái.', type: 'D_JKFF', data: ['J', 'K'], s: [{ CLK: '1', CLR: '2', K: '3', Q: '12', QN: '13', J: '14' }, { CLK: '5', CLR: '6', J: '7', QN: '8', Q: '9', K: '10' }], pins: 14, power: 'VCC = 4, GND = 11', fam: 'STD LS', extra: { clk_edge: 0 } }),
  dualFf({ pn: '74', name: 'Dual D flip-flop with preset and clear', vi: 'Hai flip-flop D có đặt trước và xoá', desc: 'Positive-edge triggered; ~PRE / ~CLR asynchronous (both low: Q = ~Q = high).', descVi: 'Kích sườn lên; ~PRE / ~CLR không đồng bộ (cả hai thấp: Q = ~Q = cao).', type: 'D_DFF', data: ['D'], s: [{ CLR: '1', D: '2', CLK: '3', PRE: '4', Q: '5', QN: '6' }, { QN: '8', Q: '9', PRE: '10', CLK: '11', D: '12', CLR: '13' }], pins: 14, fam: 'ALL' }),
  dualFf({ pn: '76', name: 'Dual JK flip-flop with preset and clear', vi: 'Hai flip-flop JK có đặt trước và xoá', desc: 'Negative-edge triggered; J = K = 1 toggles.', descVi: 'Kích sườn xuống; J = K = 1 thì lật trạng thái.', type: 'D_JKFF', data: ['J', 'K'], s: [{ CLK: '1', PRE: '2', CLR: '3', J: '4', K: '16', Q: '15', QN: '14' }, { CLK: '6', PRE: '7', CLR: '8', J: '9', K: '12', Q: '11', QN: '10' }], pins: 16, power: 'VCC = 5, GND = 13', fam: 'STD LS', extra: { clk_edge: 0 } }),
  dualFf({ pn: '107', name: 'Dual JK flip-flop with clear', vi: 'Hai flip-flop JK có xoá', desc: 'Negative-edge triggered, ~CLR asynchronous.', descVi: 'Kích sườn xuống, ~CLR không đồng bộ.', type: 'D_JKFF', data: ['J', 'K'], s: [{ J: '1', QN: '2', Q: '3', K: '4', CLK: '12', CLR: '13' }, { Q: '5', QN: '6', J: '8', CLK: '9', CLR: '10', K: '11' }], pins: 14, fam: 'STD LS HC', extra: { clk_edge: 0 } }),
  dualFf({ pn: '109', name: 'Dual J-~K positive-edge flip-flop with preset and clear', vi: 'Hai flip-flop J-~K kích sườn lên có đặt trước và xoá', desc: 'J and ~K tied together make a D flip-flop; J = 1, ~K = 0 toggles.', descVi: 'Nối J với ~K thành flip-flop D; J = 1, ~K = 0 thì lật trạng thái.', type: 'D_JKFF', data: ['J', 'K'], kbar: true, s: [{ CLR: '1', J: '2', K: '3', CLK: '4', PRE: '5', Q: '6', QN: '7' }, { QN: '9', Q: '10', PRE: '11', CLK: '12', K: '13', J: '14', CLR: '15' }], pins: 16, fam: 'STD LS F ALS HC HCT' }),
  dualFf({ pn: '112', name: 'Dual negative-edge JK flip-flop with preset and clear', vi: 'Hai flip-flop JK kích sườn xuống có đặt trước và xoá', desc: 'Negative-edge triggered; ~PRE / ~CLR asynchronous.', descVi: 'Kích sườn xuống; ~PRE / ~CLR không đồng bộ.', type: 'D_JKFF', data: ['J', 'K'], s: [{ CLK: '1', K: '2', J: '3', PRE: '4', Q: '5', QN: '6', CLR: '15' }, { QN: '7', Q: '9', PRE: '10', J: '11', K: '12', CLK: '13', CLR: '14' }], pins: 16, fam: 'LS S F ALS HC', extra: { clk_edge: 0 } }),
  dualFf({ pn: '113', name: 'Dual negative-edge JK flip-flop with preset', vi: 'Hai flip-flop JK kích sườn xuống có đặt trước', desc: 'Negative-edge triggered; ~PRE asynchronous (no clear input).', descVi: 'Kích sườn xuống; ~PRE không đồng bộ (không có chân xoá).', type: 'D_JKFF', data: ['J', 'K'], s: [{ CLK: '1', K: '2', J: '3', PRE: '4', Q: '5', QN: '6' }, { QN: '8', Q: '9', PRE: '10', J: '11', K: '12', CLK: '13' }], pins: 14, fam: 'LS S F ALS', extra: { clk_edge: 0 } }),
  dualFf({ pn: '114', name: 'Dual negative-edge JK flip-flop with preset, common clock and clear', vi: 'Hai flip-flop JK kích sườn xuống, chung xung nhịp và chân xoá', desc: 'Both sections share CLK and ~CLR; ~PRE per section.', descVi: 'Hai flip-flop dùng chung CLK và ~CLR; mỗi flip-flop có ~PRE riêng.', type: 'D_JKFF', data: ['J', 'K'], s: [{ K: '2', J: '3', PRE: '4', Q: '5', QN: '6' }, { QN: '8', Q: '9', PRE: '10', J: '11', K: '12' }], shared: { CLK: '13', CLR: '1' }, pins: 14, fam: 'LS S F ALS', extra: { clk_edge: 0 } }),
  {
    pn: '174',
    name: 'Hex D flip-flop with clear',
    vi: 'Sáu flip-flop D có xoá',
    desc: 'Rising-edge clock, common ~CLR.',
    descVi: 'Kích sườn lên, chân ~CLR chung.',
    pins: 16,
    left: 'CLK:9> ~CLR:1 | 1D:3 2D:4 3D:6 4D:11 5D:13 6D:14',
    right: '| | | 1Q:2 2Q:5 3Q:7 4Q:10 5Q:12 6Q:15',
    fams: fams('ALL'),
    kind: 'register',
    delay: 2,
    keywords: ['register', 'flip-flop'],
    build: (b) => b.add(undefined, [...names('', 6, 1, 'D'), 'CLK', 'CLR', ...names('', 6, 1, 'Q')], b.model('D_REGISTER', 2)),
  },
  {
    pn: '175',
    name: 'Quad D flip-flop with clear (Q and ~Q)',
    vi: 'Bốn flip-flop D có xoá (Q và ~Q)',
    desc: 'Rising-edge clock, common ~CLR.',
    descVi: 'Kích sườn lên, chân ~CLR chung.',
    pins: 16,
    left: 'CLK:9> ~CLR:1 | 1D:4 2D:5 3D:12 4D:13',
    right: '1Q:2 2Q:7 3Q:10 4Q:15 | 1QN@~1Q:3 2QN@~2Q:6 3QN@~3Q:11 4QN@~4Q:14',
    fams: fams('ALL'),
    kind: 'register',
    delay: 2,
    keywords: ['register', 'flip-flop'],
    build: (b) => b.add(undefined, [...names('', 4, 1, 'D'), 'CLK', 'CLR', ...names('', 4, 1, 'Q'), ...names('', 4, 1, 'QN')], b.model('D_REGISTER', 2, { has_qn: 1 })),
  },
  {
    pn: '378',
    name: 'Hex D flip-flop with enable',
    vi: 'Sáu flip-flop D có chân cho phép',
    desc: 'Data are loaded on the rising clock edge only while ~G is low.',
    descVi: 'Dữ liệu chỉ được nạp ở sườn lên của xung nhịp khi ~G thấp.',
    pins: 16,
    left: 'CLK:9> ~G:1 | 1D:3 2D:4 3D:6 4D:11 5D:13 6D:14',
    right: '| | | 1Q:2 2Q:5 3Q:7 4Q:10 5Q:12 6Q:15',
    fams: fams('LS F'),
    kind: 'register',
    delay: 2,
    keywords: ['register', 'flip-flop', 'enable'],
    build: (b) => b.add(undefined, [...names('', 6, 1, 'D'), 'CLK', 'G', ...names('', 6, 1, 'Q')], b.model('D_REG', 2, { n: 6, en: 1 })),
  },
  {
    pn: '173',
    name: '4-bit D register with 3-state outputs',
    vi: 'Thanh ghi D 4 bit, ngõ ra ba trạng thái',
    desc: 'Loads on the rising clock edge while ~G1 and ~G2 are low; outputs enabled while M and N are low; CLR (high) clears.',
    descVi: 'Nạp ở sườn lên khi ~G1 và ~G2 thấp; ngõ ra hoạt động khi M và N thấp; CLR (cao) xoá.',
    pins: 16,
    left: 'CLK:7> ~G1:9 ~G2:10 CLR:15 | ~M:1 ~N:2 | 1D:14 2D:13 3D:12 4D:11',
    right: '| | | | | | | 1Q:3 2Q:4 3Q:5 4Q:6',
    fams: fams('STD LS HC HCT'),
    kind: 'register',
    output: '3-state',
    delay: 2,
    keywords: ['register', '3-state'],
    build: (b) => b.add(undefined, [...names('', 4, 1, 'D'), 'CLK', 'M', 'N', 'G1', 'G2', 'CLR', ...names('', 4, 1, 'Q')], b.model('D_REG', 2, { n: 4, oe: 2, en: 2, has_clr: 1, clr_low: 0 })),
  },
  octalReg({ pn: '273', name: 'Octal D flip-flop with clear', vi: 'Tám flip-flop D có xoá', desc: 'Rising-edge clock, ~CLR clears asynchronously.', descVi: 'Kích sườn lên, ~CLR xoá không đồng bộ.', fam: 'LS F ALS HC HCT AC ACT', ctrl1: 'CLR' }),
  octalReg({ pn: '373', name: 'Octal transparent latch with 3-state outputs', vi: 'Tám chốt trong suốt, ngõ ra ba trạng thái', desc: 'Q follows D while LE is high and holds when LE falls; ~OE high releases the outputs.', descVi: 'Q theo D khi LE cao và giữ lại khi LE xuống thấp; ~OE cao thả nổi ngõ ra.', fam: 'LS S F ALS AS HC HCT AC ACT', ctrl1: 'OE', latch: true }),
  octalReg({ pn: '374', name: 'Octal D flip-flop with 3-state outputs', vi: 'Tám flip-flop D, ngõ ra ba trạng thái', desc: 'Rising-edge clock; ~OE high releases the outputs.', descVi: 'Kích sườn lên; ~OE cao thả nổi ngõ ra.', fam: 'LS S F ALS AS HC HCT AC ACT', ctrl1: 'OE' }),
  octalReg({ pn: '377', name: 'Octal D flip-flop with enable', vi: 'Tám flip-flop D có chân cho phép', desc: 'Loads on the rising clock edge only while ~EN is low.', descVi: 'Chỉ nạp ở sườn lên khi ~EN thấp.', fam: 'LS F ALS HC HCT AC', ctrl1: 'EN' }),
  octalReg({ pn: '534', name: 'Octal D flip-flop with 3-state inverting outputs', vi: 'Tám flip-flop D, ngõ ra ba trạng thái đảo', desc: 'As the 374 with complemented outputs.', descVi: 'Như 374 nhưng ngõ ra đảo.', fam: 'LS S F ALS', ctrl1: 'OE', invert: true }),
  octalReg({ pn: '573', name: 'Octal transparent latch with 3-state outputs (flow-through)', vi: 'Tám chốt trong suốt ba trạng thái, chân thẳng hàng', desc: 'As the 373 with inputs on one side and outputs on the other.', descVi: 'Như 373 nhưng chân vào một bên, chân ra một bên.', fam: 'LS F ALS AS HC HCT AC ACT', ctrl1: 'OE', latch: true, flow: true }),
  octalReg({ pn: '574', name: 'Octal D flip-flop with 3-state outputs (flow-through)', vi: 'Tám flip-flop D ba trạng thái, chân thẳng hàng', desc: 'As the 374 with inputs on one side and outputs on the other.', descVi: 'Như 374 nhưng chân vào một bên, chân ra một bên.', fam: 'LS F ALS AS HC HCT AC ACT', ctrl1: 'OE', flow: true }),
  {
    pn: '75',
    name: '4-bit bistable latch (Q and ~Q)',
    vi: 'Chốt 4 bit (Q và ~Q)',
    desc: 'Two pairs of transparent latches: C12 enables latches 1-2, C34 latches 3-4.',
    descVi: 'Hai cặp chốt trong suốt: C12 cho phép chốt 1-2, C34 cho phép chốt 3-4.',
    pins: 16,
    power: 'VCC = 5, GND = 12',
    left: 'C12:13 1D:2 2D:3 | C34:4 3D:6 4D:7',
    right: '1Q:16 1QN@~1Q:1 2Q:15 2QN@~2Q:14 3Q:10 3QN@~3Q:11 4Q:9 4QN@~4Q:8',
    fams: fams('STD LS HC'),
    kind: 'latch',
    delay: 2,
    keywords: ['latch', 'transparent'],
    build: (b) => {
      const m = b.model('D_REG', 2, { n: 2, latch: 1, has_qn: 1 });
      b.add('12', ['1D', '2D', 'C12', '1Q', '2Q', '1QN', '2QN'], m);
      b.add('34', ['3D', '4D', 'C34', '3Q', '4Q', '3QN', '4QN'], m);
    },
  },
  {
    pn: '375',
    name: '4-bit bistable latch (Q and ~Q), 16-pin',
    vi: 'Chốt 4 bit (Q và ~Q), vỏ 16 chân',
    desc: 'Two pairs of transparent latches: C12 enables latches 1-2, C34 latches 3-4.',
    descVi: 'Hai cặp chốt trong suốt: C12 cho phép chốt 1-2, C34 cho phép chốt 3-4.',
    pins: 16,
    left: 'C12:4 1D:1 2D:7 | C34:12 3D:9 4D:15',
    right: '1Q:3 1QN@~1Q:2 2Q:5 2QN@~2Q:6 3Q:11 3QN@~3Q:10 4Q:13 4QN@~4Q:14',
    fams: fams('LS'),
    kind: 'latch',
    delay: 2,
    keywords: ['latch', 'transparent'],
    build: (b) => {
      const m = b.model('D_REG', 2, { n: 2, latch: 1, has_qn: 1 });
      b.add('12', ['1D', '2D', 'C12', '1Q', '2Q', '1QN', '2QN'], m);
      b.add('34', ['3D', '4D', 'C34', '3Q', '4Q', '3QN', '4QN'], m);
    },
  },
  {
    pn: '259',
    name: '8-bit addressable latch',
    vi: 'Chốt 8 bit đánh địa chỉ',
    desc: '~G low writes D into the latch selected by S2..S0; ~CLR low with ~G high clears all, with ~G low acts as a 1-of-8 demultiplexer.',
    descVi: '~G thấp ghi D vào chốt chọn bởi S2..S0; ~CLR thấp khi ~G cao xoá hết, khi ~G thấp thành bộ phân kênh 1 ra 8.',
    pins: 16,
    left: 'S0:1 S1:2 S2:3 | D:13 ~G:14 ~CLR:15',
    right: names('Q', 8).map((n, i) => `${n}:${[4, 5, 6, 7, 9, 10, 11, 12][i]}`).join(' '),
    fams: fams('STD LS HC HCT'),
    kind: 'latch',
    delay: 2,
    keywords: ['addressable latch', 'demultiplexer'],
    build: (b) => b.add(undefined, ['S0', 'S1', 'S2', 'D', 'G', 'CLR', ...names('Q', 8)], b.model('D_ADDR_LATCH', 2)),
  },
  {
    pn: '279',
    name: 'Quad ~S-~R latch',
    vi: 'Bốn chốt ~S-~R',
    desc: 'Active-low set / reset latches (latches 1 and 3 have two ~S inputs); ~S low sets Q, ~R low resets it.',
    descVi: 'Chốt đặt / xoá tích cực thấp (chốt 1 và 3 có hai đầu ~S); ~S thấp đặt Q = 1, ~R thấp xoá Q.',
    pins: 16,
    left: '~1S1:2 ~1S2:3 ~1R:1 | ~2S:6 ~2R:5 | ~3S1:11 ~3S2:12 ~3R:10 | ~4S:15 ~4R:14',
    right: '1Q:4 | | | 2Q:7 | | 3Q:9 | | | 4Q:13',
    fams: fams('STD LS HC'),
    kind: 'latch',
    delay: 1.5,
    keywords: ['sr latch', 'debounce'],
    build: (b) => {
      const m2 = b.model('D_SRLATCH_N', 1.5, { ns: 2 });
      const m1 = b.model('D_SRLATCH_N', 1.5, { ns: 1 });
      b.add('1', ['1S1', '1S2', '1R', '1Q'], m2);
      b.add('2', ['2S', '2R', '2Q'], m1);
      b.add('3', ['3S1', '3S2', '3R', '3Q'], m2);
      b.add('4', ['4S', '4R', '4Q'], m1);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// counters

const SYNC_LEFT = 'CLK:2> ~CLR:1 ~LOAD:9 ENP:7 ENT:10 | A:3 B:4 C:5 D:6';
const SYNC_RIGHT = 'QA:14 QB:13 QC:12 QD:11 | RCO:15';

function syncCounter(pn: string, decade: boolean, syncClear: boolean, fam: string): LogicSpec {
  return {
    pn,
    name: `Synchronous 4-bit ${decade ? 'decade' : 'binary'} counter (${syncClear ? 'synchronous' : 'asynchronous'} clear)`,
    vi: `Bộ đếm đồng bộ 4 bit ${decade ? 'thập phân' : 'nhị phân'} (xoá ${syncClear ? 'đồng bộ' : 'không đồng bộ'})`,
    desc: `Counts ${decade ? '0-9' : '0-15'} on the rising clock edge while ENP and ENT are high; ~LOAD loads A-D on the next edge; RCO = ENT · (Q = ${decade ? 9 : 15}); ~CLR ${syncClear ? 'acts on the next clock edge' : 'clears at once'}.`,
    descVi: `Đếm ${decade ? '0-9' : '0-15'} ở sườn lên khi ENP và ENT cao; ~LOAD nạp A-D ở sườn kế tiếp; RCO = ENT · (Q = ${decade ? 9 : 15}); ~CLR ${syncClear ? 'tác động ở sườn xung nhịp kế tiếp' : 'xoá ngay lập tức'}.`,
    pins: 16,
    left: SYNC_LEFT,
    right: SYNC_RIGHT,
    fams: fams(fam),
    kind: 'counter',
    delay: 2,
    keywords: ['counter', 'synchronous', decade ? 'decade' : 'binary', 'presettable'],
    build: (b) => b.add(undefined, ['CLK', 'CLR', 'LOAD', 'ENP', 'ENT', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'RCO'], b.model('D_CNT_SYNC', 2, { sync_clear: syncClear ? 1 : 0, modulus: decade ? 10 : 16 })),
  };
}

function udCounter(pn: string, decade: boolean, fam: string): LogicSpec {
  return {
    pn,
    name: `Synchronous up / down ${decade ? 'decade' : 'binary'} counter (dual clock)`,
    vi: `Bộ đếm lên / xuống đồng bộ ${decade ? 'thập phân' : 'nhị phân'} (hai xung nhịp)`,
    desc: 'Counts up on the rising edge of UP (DOWN high) and down on DOWN (UP high); CLR (high) and ~LOAD are asynchronous; ~CO / ~BO carry and borrow outputs.',
    descVi: 'Đếm lên ở sườn lên của UP (DOWN cao) và đếm xuống ở sườn lên của DOWN (UP cao); CLR (cao) và ~LOAD không đồng bộ; ~CO / ~BO là ngõ ra nhớ và mượn.',
    pins: 16,
    left: 'UP:5> DOWN:4> CLR:14 ~LOAD:11 | A:15 B:1 C:10 D:9',
    right: 'QA:3 QB:2 QC:6 QD:7 | ~CO:12 ~BO:13',
    fams: fams(fam),
    kind: 'counter',
    delay: 2.2,
    keywords: ['counter', 'up down', 'presettable'],
    build: (b) => b.add(undefined, ['UP', 'DOWN', 'CLR', 'LOAD', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'CO', 'BO'], b.model('D_CNT_UPDOWN', 2.2, { modulus: decade ? 10 : 16 })),
  };
}

const COUNTERS: LogicSpec[] = [
  {
    pn: '90',
    name: 'Decade counter (÷2 and ÷5)',
    vi: 'Bộ đếm thập phân (÷2 và ÷5)',
    desc: 'Connect QA to CKB for BCD counting. Falling-edge clocks; R0(1)·R0(2) resets to 0, R9(1)·R9(2) sets 9.',
    descVi: 'Nối QA vào CKB để đếm BCD. Kích sườn xuống; R0(1)·R0(2) đưa về 0, R9(1)·R9(2) đặt 9.',
    pins: 14,
    power: 'VCC = 5, GND = 10',
    left: 'CKA:14> CKB:1> | R01@R0(1):2 R02@R0(2):3 R91@R9(1):6 R92@R9(2):7',
    right: 'QA:12 QB:9 QC:8 QD:11',
    fams: fams('STD LS'),
    kind: 'counter',
    delay: 1.6,
    keywords: ['counter', 'decade', 'bcd', 'ripple'],
    build: (b) => b.add(undefined, ['CKA', 'CKB', 'R01', 'R02', 'R91', 'R92', 'QA', 'QB', 'QC', 'QD'], b.model('D_CNT_DIV2_DIV5', 1.6)),
  },
  {
    pn: '92',
    name: 'Divide-by-12 counter (÷2 and ÷6)',
    vi: 'Bộ đếm chia 12 (÷2 và ÷6)',
    desc: 'Connect QA to CKB to divide by 12 (QD is the ÷12 output); falling-edge clocks; R0(1)·R0(2) resets.',
    descVi: 'Nối QA vào CKB để chia 12 (QD là ngõ ra ÷12); kích sườn xuống; R0(1)·R0(2) xoá về 0.',
    pins: 14,
    power: 'VCC = 5, GND = 10',
    left: 'CKA:14> CKB:1> | R01@R0(1):6 R02@R0(2):7',
    right: 'QA:12 QB:11 QC:9 QD:8',
    fams: fams('STD LS'),
    kind: 'counter',
    delay: 1.6,
    keywords: ['counter', 'divide by 12', 'ripple'],
    build: (b) => b.add(undefined, ['CKA', 'CKB', 'R01', 'R02', 'QA', 'QB', 'QC', 'QD'], b.model('D_CNT_DIV2_DIV6', 1.6)),
  },
  {
    pn: '93',
    name: '4-bit binary counter (÷2 and ÷8)',
    vi: 'Bộ đếm nhị phân 4 bit (÷2 và ÷8)',
    desc: 'Connect QA to CKB for a ÷16 ripple counter. Falling-edge clocks; R0(1)·R0(2) resets.',
    descVi: 'Nối QA vào CKB để thành bộ đếm gợn ÷16. Kích sườn xuống; R0(1)·R0(2) xoá về 0.',
    pins: 14,
    power: 'VCC = 5, GND = 10',
    left: 'CKA:14> CKB:1> | R01@R0(1):2 R02@R0(2):3',
    right: 'QA:12 QB:9 QC:8 QD:11',
    fams: fams('STD LS'),
    kind: 'counter',
    delay: 1.6,
    keywords: ['counter', 'binary', 'ripple'],
    build: (b) => b.add(undefined, ['CKA', 'CKB', 'R01', 'R02', 'QA', 'QB', 'QC', 'QD'], b.model('D_CNT_DIV2_DIV8', 1.6)),
  },
  syncCounter('160', true, false, 'STD LS F ALS HC HCT'),
  syncCounter('161', false, false, 'ALL'),
  syncCounter('162', true, true, 'STD LS S F ALS HC HCT'),
  syncCounter('163', false, true, 'ALL'),
  ...(['168', '169'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Synchronous 4-bit up / down ${pn === '168' ? 'decade' : 'binary'} counter`,
      vi: `Bộ đếm lên / xuống đồng bộ 4 bit ${pn === '168' ? 'thập phân' : 'nhị phân'}`,
      desc: 'U/~D high counts up, low down, on the rising clock edge while ~ENP and ~ENT are low; ~LOAD loads A-D on the edge; ~RCO low at the end of the count.',
      descVi: 'U/~D cao đếm lên, thấp đếm xuống, ở sườn lên khi ~ENP và ~ENT thấp; ~LOAD nạp A-D ở sườn xung nhịp; ~RCO thấp ở cuối chu kỳ đếm.',
      pins: 16,
      left: 'CLK:2> UD@U/~D:1 ~LOAD:9 ~ENP:7 ~ENT:10 | A:3 B:4 C:5 D:6',
      right: 'QA:14 QB:13 QC:12 QD:11 | ~RCO:15',
      fams: fams('LS S F ALS'),
      kind: 'counter',
      delay: 2.2,
      keywords: ['counter', 'up down', 'synchronous'],
      build: (b) => b.add(undefined, ['CLK', 'UD', 'LOAD', 'ENP', 'ENT', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'RCO'], b.model('D_CNT_UD2', 2.2, { modulus: pn === '168' ? 10 : 16 })),
    }),
  ),
  ...(['190', '191'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Synchronous up / down ${pn === '190' ? 'decade' : 'binary'} counter (single clock)`,
      vi: `Bộ đếm lên / xuống đồng bộ ${pn === '190' ? 'thập phân' : 'nhị phân'} (một xung nhịp)`,
      desc: 'Counts on the rising clock edge while ~CTEN is low (D/~U low = up, high = down); ~LOAD loads A-D at once; MAX/MIN is high at the end of the count, ~RCO pulses low with the clock there.',
      descVi: 'Đếm ở sườn lên khi ~CTEN thấp (D/~U thấp = lên, cao = xuống); ~LOAD nạp A-D ngay lập tức; MAX/MIN cao ở cuối chu kỳ, ~RCO xuống thấp theo xung nhịp lúc đó.',
      pins: 16,
      left: 'CLK:14> ~CTEN:4 DU@D/~U:5 ~LOAD:11 | A:15 B:1 C:10 D:9',
      right: 'QA:3 QB:2 QC:6 QD:7 | MAXMIN@MAX/MIN:12 ~RCO:13',
      fams: fams('STD LS F ALS HC HCT'),
      kind: 'counter',
      delay: 2.2,
      keywords: ['counter', 'up down', 'synchronous'],
      build: (b) => b.add(undefined, ['CLK', 'CTEN', 'DU', 'LOAD', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'MAXMIN', 'RCO'], b.model('D_CNT_UD1', 2.2, { modulus: pn === '190' ? 10 : 16 })),
    }),
  ),
  udCounter('192', true, 'STD LS ALS HC HCT'),
  udCounter('193', false, 'STD LS ALS HC HCT'),
  {
    pn: '390',
    name: 'Dual decade counter (÷2 and ÷5 each)',
    vi: 'Hai bộ đếm thập phân (mỗi bộ ÷2 và ÷5)',
    desc: 'Each half: connect QA to CKB for BCD counting; falling-edge clocks; CLR (high) clears.',
    descVi: 'Mỗi nửa: nối QA vào CKB để đếm BCD; kích sườn xuống; CLR (cao) xoá.',
    pins: 16,
    left: '1CKA:1> 1CKB:4> 1CLR:2 | 2CKA:15> 2CKB:12> 2CLR:14',
    right: '1QA:3 1QB:5 1QC:6 1QD:7 | 2QA:13 2QB:11 2QC:10 2QD:9',
    fams: fams('LS HC HCT'),
    kind: 'counter',
    delay: 1.6,
    keywords: ['counter', 'decade', 'dual', 'ripple'],
    build: (b) => {
      const m = b.model('D_CNT_DIV2_DIV5', 1.6);
      for (const k of [1, 2]) b.add(String(k), [`${k}CKA`, `${k}CKB`, `${k}CLR`, `${k}CLR`, '0', '0', `${k}QA`, `${k}QB`, `${k}QC`, `${k}QD`], m);
    },
  },
  {
    pn: '393',
    name: 'Dual 4-bit binary ripple counter',
    vi: 'Hai bộ đếm gợn nhị phân 4 bit',
    desc: 'Each counter advances on the falling edge of its clock A; CLR (high) clears.',
    descVi: 'Mỗi bộ đếm tăng ở sườn xuống của xung nhịp A; CLR (cao) xoá.',
    pins: 14,
    left: '1A:1> 1CLR:2 | | | 2A:13> 2CLR:12',
    right: '1QA:3 1QB:4 1QC:5 1QD:6 | 2QA:11 2QB:10 2QC:9 2QD:8',
    fams: fams('LS HC HCT'),
    kind: 'counter',
    delay: 2,
    keywords: ['counter', 'binary', 'dual', 'ripple'],
    build: (b) => {
      const m = b.model('D_CNT_RIPPLE', 2, { stages: 4 });
      for (const k of [1, 2]) b.add(String(k), [`${k}A`, `${k}CLR`, `${k}QA`, `${k}QB`, `${k}QC`, `${k}QD`], m);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// shift registers

const SHIFT: LogicSpec[] = [
  {
    pn: '164',
    name: '8-bit serial-in parallel-out shift register',
    vi: 'Thanh ghi dịch 8 bit vào nối tiếp, ra song song',
    desc: 'Serial data A·B enters QA on the rising clock edge; ~CLR clears asynchronously.',
    descVi: 'Dữ liệu nối tiếp A·B vào QA ở sườn lên; ~CLR xoá không đồng bộ.',
    pins: 14,
    left: 'A:1 B:2 | CLK:8> ~CLR:9',
    right: 'QA:3 QB:4 QC:5 QD:6 QE:10 QF:11 QG:12 QH:13',
    fams: fams('STD LS ALS HC HCT'),
    kind: 'shift',
    delay: 2,
    keywords: ['shift register', 'sipo', 'serial'],
    build: (b) => b.add(undefined, ['A', 'B', 'CLK', 'CLR', 'QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'], b.model('D_SHIFT_SIPO', 2)),
  },
  {
    pn: '165',
    name: '8-bit parallel-load shift register',
    vi: 'Thanh ghi dịch 8 bit nạp song song',
    desc: 'SH/~LD low loads A..H at once; shifts toward QH on the rising edge of CLK OR CLK INH, SER enters stage A.',
    descVi: 'SH/~LD thấp nạp A..H ngay lập tức; dịch về phía QH ở sườn lên của CLK OR CLK INH, SER vào tầng A.',
    pins: 16,
    left: 'SHLD@SH/~LD:1 CLK:2> INH@CLK_INH:15 SER:10 | A:11 B:12 C:13 D:14 E:3 F:4 G:5 H:6',
    right: 'QH:9 QHN@~QH:7',
    fams: fams('STD LS F ALS HC HCT'),
    kind: 'shift',
    delay: 2.2,
    keywords: ['shift register', 'piso', 'parallel load'],
    build: (b) => b.add(undefined, ['SHLD', 'CLK', 'INH', 'SER', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'QH', 'QHN'], b.model('D_SHIFT_PISO', 2.2)),
  },
  {
    pn: '166',
    name: '8-bit parallel-load shift register (synchronous load)',
    vi: 'Thanh ghi dịch 8 bit nạp song song (nạp đồng bộ)',
    desc: 'On the rising edge of CLK OR CLK INH: SH/~LD low loads A..H, high shifts toward QH (SER into stage A); ~CLR clears.',
    descVi: 'Ở sườn lên của CLK OR CLK INH: SH/~LD thấp nạp A..H, cao thì dịch về phía QH (SER vào tầng A); ~CLR xoá.',
    pins: 16,
    left: 'SHLD@SH/~LD:15 CLK:7> INH@CLK_INH:6 SER:1 ~CLR:9 | A:2 B:3 C:4 D:5 E:10 F:11 G:12 H:14',
    right: 'QH:13',
    fams: fams('STD LS F ALS HC HCT'),
    kind: 'shift',
    delay: 2.2,
    keywords: ['shift register', 'piso', 'parallel load'],
    build: (b) => b.add(undefined, ['SER', 'CLK', 'INH', 'SHLD', 'CLR', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'QH'], b.model('D_SHIFT_PISO2', 2.2, { n: 8, has_inh: 1, has_clr: 1 })),
  },
  {
    pn: '194',
    name: '4-bit bidirectional universal shift register',
    vi: 'Thanh ghi dịch đa năng 4 bit hai chiều',
    desc: 'S1 S0 = 00 hold, 01 shift right (QA ← SR), 10 shift left (QD ← SL), 11 parallel load, on the rising clock edge; ~CLR clears.',
    descVi: 'S1 S0 = 00 giữ, 01 dịch phải (QA ← SR), 10 dịch trái (QD ← SL), 11 nạp song song, ở sườn lên; ~CLR xoá.',
    pins: 16,
    left: 'S0:9 S1:10 SR:2 SL:7 ~CLR:1 CLK:11> | A:3 B:4 C:5 D:6',
    right: 'QA:15 QB:14 QC:13 QD:12',
    fams: fams('STD LS S F ALS HC HCT'),
    kind: 'shift',
    delay: 2,
    keywords: ['shift register', 'universal', 'bidirectional'],
    build: (b) => b.add(undefined, ['S0', 'S1', 'SR', 'SL', 'CLR', 'CLK', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD'], b.model('D_SHIFT_UNIV', 2)),
  },
  {
    pn: '195',
    name: '4-bit parallel-access shift register (J-~K serial input)',
    vi: 'Thanh ghi dịch 4 bit truy cập song song (vào nối tiếp J-~K)',
    desc: 'On the rising clock edge: SH/~LD low loads A-D, high shifts toward QD with QA ← J·~QA + ~K·QA; ~CLR clears.',
    descVi: 'Ở sườn lên: SH/~LD thấp nạp A-D, cao thì dịch về phía QD với QA ← J·~QA + ~K·QA; ~CLR xoá.',
    pins: 16,
    left: 'J:2 ~K:3 SHLD@SH/~LD:9 CLK:10> ~CLR:1 | A:4 B:5 C:6 D:7',
    right: 'QA:15 QB:14 QC:13 QD:12 QDN@~QD:11',
    fams: fams('STD LS S F HC HCT'),
    kind: 'shift',
    delay: 2,
    keywords: ['shift register', 'parallel access'],
    build: (b) => b.add(undefined, ['J', 'K', 'SHLD', 'CLK', 'CLR', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'QDN'], b.model('D_SHIFT_JK', 2)),
  },
  {
    pn: '595',
    name: '8-bit shift register with output latches (3-state)',
    vi: 'Thanh ghi dịch 8 bit có chốt ngõ ra (ba trạng thái)',
    desc: "SER shifts in on SRCLK rising (QA side first); RCLK rising copies the shift register to the outputs; ~OE high releases QA-QH; QH' feeds the next 595; ~SRCLR clears the shift register.",
    descVi: "SER được dịch vào ở sườn lên SRCLK (phía QA trước); sườn lên RCLK chép thanh ghi dịch ra ngõ ra; ~OE cao thả nổi QA-QH; QH' nối sang 595 kế tiếp; ~SRCLR xoá thanh ghi dịch.",
    pins: 16,
    left: 'SER:14 SRCLK:11> ~SRCLR:10 RCLK:12> ~OE:13',
    right: "QA:15 QB:1 QC:2 QD:3 QE:4 QF:5 QG:6 QH:7 | QH2@QH':9",
    fams: fams('LS HC HCT'),
    kind: 'shift',
    output: '3-state',
    delay: 2,
    keywords: ['shift register', 'sipo', 'latch', 'led driver', 'spi'],
    build: (b) => b.add(undefined, ['SER', 'SRCLK', 'SRCLR', 'RCLK', 'OE', 'QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'QH2'], b.model('D_SHIFT_STORE', 2)),
  },
];

// ---------------------------------------------------------------------------------------------
// decoders, encoders, display drivers

const BCD7_LEFT = 'A:7 B:1 C:2 D:6 | ~LT:3 ~RBI:5 =BIRBO@~BI/RBO:4';
const SEGS = ['SEGA', 'SEGB', 'SEGC', 'SEGD', 'SEGE', 'SEGF', 'SEGG'];
const SEG_NUMS = [13, 12, 11, 10, 9, 15, 14];

function bcd7(pn: string, o: { activeHigh: boolean; tails: boolean; fam: string; name: string; vi: string; desc: string; descVi: string }): LogicSpec {
  return {
    pn,
    name: o.name,
    vi: o.vi,
    desc: o.desc,
    descVi: o.descVi,
    pins: 16,
    left: BCD7_LEFT,
    right: SEGS.map((s, i) => `${o.activeHigh ? '' : '~'}${s}@${o.activeHigh ? '' : '~'}${s.slice(3).toLowerCase()}:${SEG_NUMS[i]}`).join(' '),
    fams: fams(o.fam),
    kind: 'display',
    output: 'open-collector',
    delay: 5,
    keywords: ['7-segment', 'seven segment', 'decoder', 'driver', 'bcd'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'LT', 'RBI', 'BIRBO', ...SEGS], b.model('D_BCD7SEG', 5, { active_high: o.activeHigh ? 1 : 0, tails: o.tails ? 1 : 0 })),
  };
}

const BCD_DEC_RIGHT = names('Y', 10).map((n, i) => `~${n}:${[1, 2, 3, 4, 5, 6, 7, 9, 10, 11][i]}`).join(' ');

const DECODERS: LogicSpec[] = [
  {
    pn: '42',
    name: 'BCD-to-decimal decoder',
    vi: 'Bộ giải mã BCD sang thập phân',
    desc: 'The output selected by the BCD input D C B A goes low; codes 10-15 leave every output high.',
    descVi: 'Ngõ ra được chọn bởi mã BCD D C B A xuống thấp; mã 10-15 để mọi ngõ ra ở mức cao.',
    pins: 16,
    left: 'A:15 B:14 C:13 D:12',
    right: BCD_DEC_RIGHT,
    fams: fams('STD LS HC HCT'),
    kind: 'decoder',
    delay: 2,
    keywords: ['decoder', 'bcd', '1 of 10'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', ...names('Y', 10)], b.model('D_DECODER', 2, { n: 4, outputs: 10 })),
  },
  {
    pn: '145',
    name: 'BCD-to-decimal decoder / driver, open collector (15 V)',
    vi: 'Bộ giải mã / lái BCD sang thập phân, collector hở (15 V)',
    desc: 'As the 7442 with open-collector outputs that sink 80 mA: lamps, relays, Nixie-style drivers.',
    descVi: 'Như 7442 nhưng ngõ ra collector hở hút 80 mA: lái đèn, rơ-le.',
    pins: 16,
    left: 'A:15 B:14 C:13 D:12',
    right: BCD_DEC_RIGHT,
    fams: fams('STD LS'),
    kind: 'decoder',
    output: 'open-collector',
    delay: 2.5,
    keywords: ['decoder', 'driver', 'open collector', '1 of 10'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', ...names('Y', 10)], b.model('D_DECODER', 2.5, { n: 4, outputs: 10, open_drain: 1 })),
  },
  bcd7('46', { activeHigh: false, tails: false, fam: 'STD LS', name: 'BCD to 7-segment decoder / driver, open collector (30 V)', vi: 'Bộ giải mã / lái BCD sang LED 7 đoạn, collector hở (30 V)', desc: 'Active-low segment outputs for common-anode displays (tailless 6 and 9); ~LT lamp test, ~RBI / ~BI-RBO ripple blanking.', descVi: 'Ngõ ra đoạn tích cực thấp cho LED anode chung (số 6 và 9 không đuôi); ~LT thử đèn, ~RBI / ~BI-RBO xoá số 0 dư.' }),
  bcd7('47', { activeHigh: false, tails: false, fam: 'STD LS', name: 'BCD to 7-segment decoder / driver, open collector', vi: 'Bộ giải mã / lái BCD sang LED 7 đoạn, collector hở', desc: 'Active-low segment outputs for common-anode displays (tailless 6 and 9); ~LT lamp test, ~RBI / ~BI-RBO ripple blanking.', descVi: 'Ngõ ra đoạn tích cực thấp cho LED anode chung (số 6 và 9 không đuôi); ~LT thử đèn, ~RBI / ~BI-RBO xoá số 0 dư.' }),
  bcd7('48', { activeHigh: true, tails: false, fam: 'STD LS', name: 'BCD to 7-segment decoder with internal pull-ups', vi: 'Bộ giải mã BCD sang LED 7 đoạn có điện trở kéo lên trong', desc: 'Active-high segment outputs (2 kΩ internal pull-ups) for common-cathode displays or driver transistors.', descVi: 'Ngõ ra đoạn tích cực cao (điện trở kéo lên 2 kΩ bên trong) cho LED cathode chung hoặc transistor lái.' }),
  bcd7('247', { activeHigh: false, tails: true, fam: 'LS', name: 'BCD to 7-segment decoder / driver, open collector (6 and 9 with tails)', vi: 'Bộ giải mã / lái BCD sang LED 7 đoạn, collector hở (6 và 9 có đuôi)', desc: 'As the 7447 with tails on 6 and 9.', descVi: 'Như 7447 nhưng số 6 và 9 có đuôi.' }),
  bcd7('248', { activeHigh: true, tails: true, fam: 'LS', name: 'BCD to 7-segment decoder with pull-ups (6 and 9 with tails)', vi: 'Bộ giải mã BCD sang LED 7 đoạn có kéo lên (6 và 9 có đuôi)', desc: 'As the 7448 with tails on 6 and 9.', descVi: 'Như 7448 nhưng số 6 và 9 có đuôi.' }),
  {
    pn: '138',
    name: '3-to-8 line decoder / demultiplexer',
    vi: 'Bộ giải mã / phân kênh 3 sang 8',
    desc: 'Active-low outputs, enabled when G1 is high and ~G2A, ~G2B are low.',
    descVi: 'Ngõ ra tích cực thấp, hoạt động khi G1 cao và ~G2A, ~G2B thấp.',
    pins: 16,
    left: 'A:1 B:2 C:3 | G1:6 ~G2A:4 ~G2B:5',
    right: names('Y', 8).map((n, i) => `~${n}:${[15, 14, 13, 12, 11, 10, 9, 7][i]}`).join(' '),
    fams: fams('LS S F ALS AS HC HCT AC ACT'),
    kind: 'decoder',
    delay: 2.2,
    keywords: ['decoder', 'demultiplexer', '3 to 8', 'address decoder'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'G1', 'G2A', 'G2B', ...names('Y', 8)], b.model('D_DECODER', 2.2, { en_high: 1, en_low: 2 })),
  },
  {
    pn: '139',
    name: 'Dual 2-to-4 line decoder / demultiplexer',
    vi: 'Hai bộ giải mã / phân kênh 2 sang 4',
    desc: 'Active-low outputs and enable ~G per section.',
    descVi: 'Ngõ ra tích cực thấp, mỗi nửa có chân cho phép ~G.',
    pins: 16,
    left: '1A:2 1B:3 ~1G:1 | | 2A:14 2B:13 ~2G:15',
    right: '~1Y0:4 ~1Y1:5 ~1Y2:6 ~1Y3:7 | ~2Y0:12 ~2Y1:11 ~2Y2:10 ~2Y3:9',
    fams: fams('LS S F ALS AS HC HCT AC ACT'),
    kind: 'decoder',
    delay: 2,
    keywords: ['decoder', 'demultiplexer', '2 to 4'],
    build: (b) => {
      const m = b.model('D_DECODER', 2, { en_low: 1 });
      for (const k of [1, 2]) b.add(String(k), [`${k}A`, `${k}B`, `${k}G`, ...names(`${k}Y`, 4)], m);
    },
  },
  {
    pn: '154',
    name: '4-to-16 line decoder / demultiplexer',
    vi: 'Bộ giải mã / phân kênh 4 sang 16',
    desc: 'Active-low outputs, enabled when ~G1 and ~G2 are both low.',
    descVi: 'Ngõ ra tích cực thấp, hoạt động khi ~G1 và ~G2 cùng thấp.',
    pins: 24,
    left: 'A:23 B:22 C:21 D:20 | ~G1:18 ~G2:19',
    right: names('Y', 16).map((n, i) => `~${n}:${i <= 10 ? i + 1 : i + 2}`).join(' '),
    fams: fams('STD LS HC HCT'),
    kind: 'decoder',
    delay: 2.4,
    keywords: ['decoder', 'demultiplexer', '4 to 16'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'G1', 'G2', ...names('Y', 16)], b.model('D_DECODER', 2.4, { en_low: 2 })),
  },
  ...(['155', '156'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Dual 2-to-4 line decoder / demultiplexer${pn === '156' ? ', open collector' : ''}`,
      vi: `Hai bộ giải mã / phân kênh 2 sang 4${pn === '156' ? ', collector hở' : ''}`,
      desc: 'Common address A, B; section 1 enabled by 1C high and ~1G low, section 2 by ~2C and ~2G low; tie 1C to ~2C for a 3-to-8 decoder.',
      descVi: 'Chung địa chỉ A, B; nửa 1 hoạt động khi 1C cao và ~1G thấp, nửa 2 khi ~2C và ~2G thấp; nối 1C với ~2C thành giải mã 3 sang 8.',
      pins: 16,
      left: 'A:13 B:3 | 1C:1 ~1G:2 | ~2C:15 ~2G:14',
      right: '~1Y0:7 ~1Y1:6 ~1Y2:5 ~1Y3:4 | ~2Y0:9 ~2Y1:10 ~2Y2:11 ~2Y3:12',
      fams: fams('STD LS'),
      kind: 'decoder',
      output: pn === '156' ? 'open-collector' : undefined,
      delay: 2,
      keywords: ['decoder', 'demultiplexer', '2 to 4'],
      build: (b) => {
        const oc: Record<string, number> = pn === '156' ? { open_drain: 1 } : {};
        b.add('1', ['A', 'B', '1C', '1G', ...names('1Y', 4)], b.model('D_DECODER', 2, { en_high: 1, en_low: 1, ...oc }));
        b.add('2', ['A', 'B', '2C', '2G', ...names('2Y', 4)], b.model('D_DECODER', 2, { en_low: 2, ...oc }));
      },
    }),
  ),
  {
    pn: '147',
    name: '10-to-4 line priority encoder (BCD)',
    vi: 'Bộ mã hoá ưu tiên 10 sang 4 (BCD)',
    desc: 'Active-low inputs ~1..~9 (9 has the highest priority); the outputs ~D ~C ~B ~A give the complement of the BCD code; no input low gives 1111 (zero).',
    descVi: 'Đầu vào tích cực thấp ~1..~9 (9 ưu tiên cao nhất); ngõ ra ~D ~C ~B ~A là mã BCD đảo; không có đầu vào nào thấp cho 1111 (số 0).',
    pins: 16,
    left: names('I', 9, 1).map((n, i) => `~${n}@~${i + 1}:${[11, 12, 13, 1, 2, 3, 4, 5, 10][i]}`).join(' '),
    right: '~A:9 ~B:7 ~C:6 ~D:14',
    fams: fams('STD LS HC'),
    kind: 'encoder',
    delay: 2,
    keywords: ['encoder', 'priority', 'bcd', 'keypad'],
    build: (b) => b.add(undefined, [...names('I', 9, 1), 'A', 'B', 'C', 'D'], b.model('D_PRIENC', 2, { mode: 147 })),
  },
  {
    pn: '148',
    name: '8-to-3 line priority encoder',
    vi: 'Bộ mã hoá ưu tiên 8 sang 3',
    desc: 'Active-low inputs (7 has the highest priority) and outputs; ~EI enables, ~GS is low when any input is active, ~EO is low when enabled but no input is active (cascading).',
    descVi: 'Đầu vào và ngõ ra tích cực thấp (7 ưu tiên cao nhất); ~EI cho phép, ~GS thấp khi có đầu vào tích cực, ~EO thấp khi được phép mà không có đầu vào nào (để ghép tầng).',
    pins: 16,
    left: `${names('I', 8).map((n, i) => `~${n}@~${i}:${[10, 11, 12, 13, 1, 2, 3, 4][i]}`).join(' ')} | ~EI:5`,
    right: '~A0:9 ~A1:7 ~A2:6 | ~GS:14 ~EO:15',
    fams: fams('STD LS F HC'),
    kind: 'encoder',
    delay: 2,
    keywords: ['encoder', 'priority', 'interrupt'],
    build: (b) => b.add(undefined, [...names('I', 8), 'EI', 'A0', 'A1', 'A2', 'GS', 'EO'], b.model('D_PRIENC', 2, { mode: 148 })),
  },
];

// ---------------------------------------------------------------------------------------------
// multiplexers

function mux151(pn: string, tri: boolean, fam: string): LogicSpec {
  return {
    pn,
    name: `8-to-1 line data selector / multiplexer${tri ? ' with 3-state outputs' : ''}`,
    vi: `Bộ chọn dữ liệu / dồn kênh 8 sang 1${tri ? ', ngõ ra ba trạng thái' : ''}`,
    desc: tri ? 'Y = selected input, W = ~Y; ~G high releases both outputs.' : 'Y = selected input, W = ~Y; ~G high forces Y low.',
    descVi: tri ? 'Y = đầu vào được chọn, W = ~Y; ~G cao thả nổi cả hai ngõ ra.' : 'Y = đầu vào được chọn, W = ~Y; ~G cao ép Y xuống thấp.',
    pins: 16,
    left: `A:11 B:10 C:9 ~G:7 | ${names('D', 8).map((n, i) => `${n}:${[4, 3, 2, 1, 15, 14, 13, 12][i]}`).join(' ')}`,
    right: 'Y:5 ~W:6',
    fams: fams(fam),
    kind: 'mux',
    output: tri ? '3-state' : undefined,
    delay: 2,
    keywords: ['multiplexer', 'data selector', '8 to 1'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', ...names('D', 8), 'G', 'Y', 'W'], b.model('D_MUX', 2, { strobe: 1, has_w: 1, tri: tri ? 1 : 0 })),
  };
}

function mux153(pn: string, tri: boolean, fam: string): LogicSpec {
  return {
    pn,
    name: `Dual 4-to-1 line data selector / multiplexer${tri ? ' with 3-state outputs' : ''}`,
    vi: `Hai bộ chọn dữ liệu 4 sang 1${tri ? ', ngõ ra ba trạng thái' : ''}`,
    desc: `Common select inputs A, B; ~G per section ${tri ? 'releases its output' : 'forces its output low'}.`,
    descVi: `Chung chân chọn A, B; mỗi nửa có ~G ${tri ? 'thả nổi ngõ ra' : 'ép ngõ ra xuống thấp'}.`,
    pins: 16,
    left: 'A:14 B:2 | ~1G:1 1C0:6 1C1:5 1C2:4 1C3:3 | ~2G:15 2C0:10 2C1:11 2C2:12 2C3:13',
    right: '| | | 1Y:7 | | | | | 2Y:9',
    fams: fams(fam),
    kind: 'mux',
    output: tri ? '3-state' : undefined,
    delay: 2,
    keywords: ['multiplexer', 'data selector', '4 to 1'],
    build: (b) => {
      const m = b.model('D_MUX', 2, { strobe: 1, tri: tri ? 1 : 0 });
      for (const k of [1, 2]) b.add(String(k), ['A', 'B', ...names(`${k}C`, 4), `${k}G`, `${k}Y`], m);
    },
  };
}

function mux157(pn: string, invert: boolean, tri: boolean, fam: string): LogicSpec {
  return {
    pn,
    name: `Quad 2-to-1 line data selector / multiplexer${tri ? ' with 3-state outputs' : ''}${invert ? ', inverting' : ''}`,
    vi: `Bốn bộ chọn dữ liệu 2 sang 1${tri ? ', ngõ ra ba trạng thái' : ''}${invert ? ', đảo mức' : ''}`,
    desc: `Select A/~B low passes the A inputs, high the B inputs${invert ? ' (complemented)' : ''}; ~G high ${tri ? 'releases the outputs' : `forces the outputs ${invert ? 'high' : 'low'}`}.`,
    descVi: `Chân chọn A/~B thấp cho qua các đầu A, cao cho qua các đầu B${invert ? ' (đảo mức)' : ''}; ~G cao ${tri ? 'thả nổi ngõ ra' : `ép ngõ ra ${invert ? 'lên cao' : 'xuống thấp'}`}.`,
    pins: 16,
    left: 'S@A/~B:1 ~G:15 | 1A:2 1B:3 2A:5 2B:6 3A:11 3B:10 4A:14 4B:13',
    right: `| | | ${invert ? '~' : ''}1Y:4 | ${invert ? '~' : ''}2Y:7 | ${invert ? '~' : ''}3Y:9 | ${invert ? '~' : ''}4Y:12`,
    fams: fams(fam),
    kind: 'mux',
    output: tri ? '3-state' : undefined,
    delay: 1.5,
    keywords: ['multiplexer', 'data selector', '2 to 1'],
    build: (b) => {
      const m = b.model('D_MUX', 1.5, { strobe: 1, tri: tri ? 1 : 0, invert: invert ? 1 : 0 });
      for (const k of [1, 2, 3, 4]) b.add(String(k), ['S', `${k}A`, `${k}B`, 'G', `${k}Y`], m);
    },
  };
}

const MUXES: LogicSpec[] = [
  {
    pn: '150',
    name: '16-to-1 line data selector / multiplexer',
    vi: 'Bộ chọn dữ liệu / dồn kênh 16 sang 1',
    desc: 'W = complement of the input selected by D C B A; ~G high forces W high.',
    descVi: 'W = đảo của đầu vào được chọn bởi D C B A; ~G cao ép W lên cao.',
    pins: 24,
    left: `A:15 B:14 C:13 D:11 ~G:9 | ${names('E', 16).map((n, i) => `${n}:${i <= 7 ? 8 - i : 31 - i}`).join(' ')}`,
    right: '~W:10',
    fams: fams('STD LS'),
    kind: 'mux',
    delay: 2.2,
    keywords: ['multiplexer', 'data selector', '16 to 1'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', ...names('E', 16), 'G', 'null', 'W'], b.model('D_MUX', 2.2, { strobe: 1, has_w: 1 })),
  },
  mux151('151', false, 'STD LS S F ALS AS HC HCT AC ACT'),
  mux151('251', true, 'STD LS S F ALS HC HCT'),
  mux153('153', false, 'STD LS S F ALS AS HC HCT AC ACT'),
  mux153('253', true, 'LS S F ALS HC HCT'),
  mux157('157', false, false, 'STD LS S F ALS AS HC HCT AC ACT'),
  mux157('158', true, false, 'LS S F ALS AS HC AC'),
  mux157('257', false, true, 'LS S F ALS AS HC HCT AC ACT'),
  mux157('258', true, true, 'LS S F ALS AS HC HCT'),
];

// ---------------------------------------------------------------------------------------------
// arithmetic, comparators, parity

const ARITH: LogicSpec[] = [
  {
    pn: '83',
    name: '4-bit binary full adder with fast carry',
    vi: 'Bộ cộng nhị phân đầy đủ 4 bit có nhớ nhanh',
    desc: 'Σ = A + B + C0, carry out C4 (older pinout with VCC on pin 5).',
    descVi: 'Σ = A + B + C0, nhớ ra C4 (sơ đồ chân cũ, VCC ở chân 5).',
    pins: 16,
    power: 'VCC = 5, GND = 12',
    left: 'A1:10 A2:8 A3:3 A4:1 | B1:11 B2:7 B3:4 B4:16 | C0:13',
    right: 'S1@Σ1:9 S2@Σ2:6 S3@Σ3:2 S4@Σ4:15 | C4:14',
    fams: fams('STD LS'),
    kind: 'arithmetic',
    delay: 2.4,
    keywords: ['adder', 'full adder', 'arithmetic'],
    build: (b) => b.add(undefined, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C0', 'S1', 'S2', 'S3', 'S4', 'C4'], b.model('D_ADDER', 2.4)),
  },
  {
    pn: '283',
    name: '4-bit binary full adder with fast carry',
    vi: 'Bộ cộng nhị phân đầy đủ 4 bit có nhớ nhanh',
    desc: 'Σ = A + B + C0, carry out C4.',
    descVi: 'Σ = A + B + C0, nhớ ra C4.',
    pins: 16,
    left: 'A1:5 A2:3 A3:14 A4:12 | B1:6 B2:2 B3:15 B4:11 | C0:7',
    right: 'S1@Σ1:4 S2@Σ2:1 S3@Σ3:13 S4@Σ4:10 | C4:9',
    fams: fams('LS S F ALS HC HCT'),
    kind: 'arithmetic',
    delay: 2.4,
    keywords: ['adder', 'full adder', 'arithmetic'],
    build: (b) => b.add(undefined, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C0', 'S1', 'S2', 'S3', 'S4', 'C4'], b.model('D_ADDER', 2.4)),
  },
  {
    pn: '85',
    name: '4-bit magnitude comparator',
    vi: 'Bộ so sánh độ lớn 4 bit',
    desc: 'Outputs A>B, A=B, A<B; the cascading inputs decide when A = B (tie IA=B high on the least significant stage).',
    descVi: 'Ngõ ra A>B, A=B, A<B; các đầu vào ghép tầng quyết định khi A = B (nối IA=B lên cao ở tầng thấp nhất).',
    pins: 16,
    left: 'A0:10 A1:12 A2:13 A3:15 | B0:9 B1:11 B2:14 B3:1 | IGT@IA>B:4 IEQ@IA=B:3 ILT@IA<B:2',
    right: 'OGT@A>B:5 OEQ@A=B:6 OLT@A<B:7',
    fams: fams('STD LS S HC HCT'),
    kind: 'comparator',
    delay: 2.4,
    keywords: ['comparator', 'magnitude'],
    build: (b) => b.add(undefined, ['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'IGT', 'IEQ', 'ILT', 'OGT', 'OEQ', 'OLT'], b.model('D_MAGCOMP', 2.4)),
  },
  {
    pn: '181',
    name: '4-bit arithmetic logic unit (ALU)',
    vi: 'Khối số học - logic (ALU) 4 bit',
    desc: '16 logic functions (M high) or 16 arithmetic functions (M low) of A and B chosen by S3..S0, e.g. S = 1001: A plus B, S = 0110: A minus B minus 1 (active-high data; Cn low adds 1). A=B is open collector; ~P, ~G feed a 74182 look-ahead.',
    descVi: '16 hàm logic (M cao) hoặc 16 hàm số học (M thấp) của A và B chọn bởi S3..S0, ví dụ S = 1001: A cộng B, S = 0110: A trừ B trừ 1 (dữ liệu tích cực cao; Cn thấp cộng thêm 1). A=B là collector hở; ~P, ~G nối sang bộ nhớ nhanh 74182.',
    pins: 24,
    left: 'A0:2 A1:23 A2:21 A3:19 | B0:1 B1:22 B2:20 B3:18 | S0:6 S1:5 S2:4 S3:3 | M:8 CN@Cn:7',
    right: 'F0:9 F1:10 F2:11 F3:13 | AEQB@A=B:14 ~P:15 ~G:17 CN4@Cn+4:16',
    fams: fams('STD LS S F'),
    kind: 'arithmetic',
    output: 'totem-pole',
    delay: 3,
    keywords: ['alu', 'arithmetic logic unit', 'adder', 'subtractor', 'cpu'],
    build: (b) => b.add(undefined, ['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'S0', 'S1', 'S2', 'S3', 'M', 'CN', 'F0', 'F1', 'F2', 'F3', 'AEQB', 'P', 'G', 'CN4'], b.model('D_ALU181', 3)),
  },
  {
    pn: '182',
    name: 'Look-ahead carry generator',
    vi: 'Bộ tạo số nhớ nhanh (look-ahead)',
    desc: 'Computes the carries Cn+x, Cn+y, Cn+z of four 74181 ALUs and the group ~G / ~P from their ~G, ~P outputs.',
    descVi: 'Tính số nhớ Cn+x, Cn+y, Cn+z cho bốn ALU 74181 và ~G / ~P của cả nhóm từ các ngõ ~G, ~P của chúng.',
    pins: 16,
    left: 'CN@Cn:13 | ~G0:3 ~P0:4 ~G1:1 ~P1:2 ~G2:14 ~P2:15 ~G3:5 ~P3:6',
    right: 'CNX@Cn+x:12 CNY@Cn+y:11 CNZ@Cn+z:9 | ~G:10 ~P:7',
    fams: fams('STD S F HC'),
    kind: 'arithmetic',
    delay: 2,
    keywords: ['carry look-ahead', 'alu'],
    build: (b) => b.add(undefined, ['CN', 'G0', 'P0', 'G1', 'P1', 'G2', 'P2', 'G3', 'P3', 'CNX', 'CNY', 'CNZ', 'G', 'P'], b.model('D_CLA182', 2)),
  },
  {
    pn: '280',
    name: '9-bit odd / even parity generator / checker',
    vi: 'Bộ tạo / kiểm tra chẵn lẻ 9 bit',
    desc: 'ΣEVEN is high when an even number of inputs A-I are high, ΣODD when an odd number are.',
    descVi: 'ΣEVEN cao khi số đầu vào A-I ở mức cao là chẵn, ΣODD cao khi là lẻ.',
    pins: 14,
    left: 'A:8 B:9 C:10 D:11 E:12 F:13 G:1 H:2 I:4',
    right: 'EVEN@ΣEVEN:5 ODD@ΣODD:6',
    fams: fams('LS S F ALS HC HCT'),
    kind: 'parity',
    delay: 2.4,
    keywords: ['parity', 'error detection'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'EVEN', 'ODD'], b.model('D_PARITY', 2.4)),
  },
  {
    pn: '180',
    name: '9-bit odd / even parity generator / checker (cascadable)',
    vi: 'Bộ tạo / kiểm tra chẵn lẻ 9 bit (ghép tầng được)',
    desc: '8 data inputs plus the EVEN / ODD cascade inputs: EVEN = 1, ODD = 0 gives ΣEVEN high for an even count of high data inputs.',
    descVi: '8 đầu vào dữ liệu cùng hai đầu ghép tầng EVEN / ODD: EVEN = 1, ODD = 0 cho ΣEVEN cao khi số đầu vào cao là chẵn.',
    pins: 14,
    left: 'A:8 B:9 C:10 D:11 E:12 F:13 G:1 H:2 | EVENIN@EVEN:3 ODDIN@ODD:4',
    right: 'EVEN@ΣEVEN:5 ODD@ΣODD:6',
    fams: fams('STD LS'),
    kind: 'parity',
    delay: 2.4,
    keywords: ['parity', 'error detection'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'EVENIN', 'ODDIN', 'EVEN', 'ODD'], b.model('D_PARITY', 2.4, { ctrl: 1 })),
  },
  {
    pn: '688',
    name: '8-bit identity comparator',
    vi: 'Bộ so sánh bằng 8 bit',
    desc: '~P=Q goes low when P equals Q and ~G is low (address decoders).',
    descVi: '~P=Q xuống thấp khi P bằng Q và ~G thấp (giải mã địa chỉ).',
    pins: 20,
    left: `~G:1 | ${names('P', 8).map((n, i) => `${n}:${[2, 4, 6, 8, 11, 13, 15, 17][i]}`).join(' ')} | ${names('Q', 8).map((n, i) => `${n}:${[3, 5, 7, 9, 12, 14, 16, 18][i]}`).join(' ')}`,
    right: '~PEQ@~P=Q:19',
    fams: fams('LS F ALS HC HCT AC ACT'),
    kind: 'comparator',
    delay: 2.4,
    keywords: ['comparator', 'identity', 'equality', 'address decoder'],
    build: (b) => b.add(undefined, [...names('P', 8), ...names('Q', 8), 'G', 'PEQ'], b.model('D_EQCOMP', 2.4, { n: 8, has_g: 1 })),
  },
  {
    pn: '682',
    name: '8-bit magnitude / identity comparator',
    vi: 'Bộ so sánh độ lớn / bằng 8 bit',
    desc: '~P=Q low when P = Q, ~P>Q low when P > Q.',
    descVi: '~P=Q thấp khi P = Q, ~P>Q thấp khi P > Q.',
    pins: 20,
    left: `${names('P', 8).map((n, i) => `${n}:${[2, 4, 6, 8, 11, 13, 15, 17][i]}`).join(' ')} | ${names('Q', 8).map((n, i) => `${n}:${[3, 5, 7, 9, 12, 14, 16, 18][i]}`).join(' ')}`,
    right: '~PEQ@~P=Q:19 ~PGT@~P>Q:1',
    fams: fams('LS HC'),
    kind: 'comparator',
    delay: 2.4,
    keywords: ['comparator', 'magnitude'],
    build: (b) => b.add(undefined, [...names('P', 8), ...names('Q', 8), 'PEQ', 'PGT'], b.model('D_EQCOMP', 2.4, { n: 8, has_gt: 1 })),
  },
];

// ---------------------------------------------------------------------------------------------
// monostables

const timing = (suffix = '', r = '10k', c = '10n'): ParamDef[] => [
  numParam(`rext${suffix}`, `Timing resistor${suffix ? ` (section ${suffix})` : ''}`, r, 'Ω', { min: 1, group: 'value', showOnSchematic: !suffix, help: 'External timing resistance (the Rext/Cext pins are for wiring only; the pulse width is computed from this value)' }),
  numParam(`cext${suffix}`, `Timing capacitor${suffix ? ` (section ${suffix})` : ''}`, c, 'F', { min: 0, group: 'value', showOnSchematic: !suffix }),
];

function oneShotDual(pn: string, mode: number, k: number, fam: string, retrig: boolean): LogicSpec {
  return {
    pn,
    name: `Dual ${retrig ? 'retriggerable ' : ''}monostable multivibrator with clear`,
    vi: `Hai mạch đơn ổn${retrig ? ' kích lại được' : ''} có xoá`,
    desc: `Triggers on ~A falling (B high), B rising (~A low) or ~CLR rising; ${retrig ? 'retriggering restarts the pulse' : 'a running pulse ignores new triggers'}; ~CLR low ends it. tw ≈ ${k} · Rext · Cext per section (params).`,
    descVi: `Kích khi ~A xuống (B cao), B lên (~A thấp) hoặc ~CLR lên; ${retrig ? 'kích lại thì xung bắt đầu lại' : 'xung đang chạy bỏ qua lần kích mới'}; ~CLR thấp kết thúc xung. tw ≈ ${k} · Rext · Cext mỗi nửa (tham số).`,
    pins: 16,
    left: '~1A:1 1B:2 ~1CLR:3 %1CEXT@1Cext:14 %1RCEXT@1Rext/Cext:15 | ~2A:9 2B:10 ~2CLR:11 %2CEXT@2Cext:6 %2RCEXT@2Rext/Cext:7',
    right: '1Q:13 1QN@~1Q:4 | | | | 2Q:5 2QN@~2Q:12',
    fams: fams(fam),
    kind: 'monostable',
    delay: 3,
    params: [...timing('1'), ...timing('2')],
    optional: ['1CEXT', '1RCEXT', '2CEXT', '2RCEXT'],
    keywords: ['monostable', 'one-shot', 'multivibrator', 'pulse'],
    build: (b) => {
      for (const s of [1, 2]) {
        const tw = Math.max(30e-9, k * b.ctx.num(`rext${s}`) * b.ctx.num(`cext${s}`));
        b.add(String(s), [`${s}A`, `${s}B`, `${s}CLR`, `${s}Q`, `${s}QN`], b.model('D_ONESHOT', 3, { mode, tw }));
      }
    },
  };
}

const MONO: LogicSpec[] = [
  {
    pn: '121',
    name: 'Monostable multivibrator (non-retriggerable)',
    vi: 'Mạch đơn ổn (không kích lại)',
    desc: 'Triggers on B rising while ~A1 or ~A2 is low, or on ~A falling while B is high. tw = ln2 · Rext · Cext (params; the Rint / Cext pins are for wiring only).',
    descVi: 'Kích khi B lên trong lúc ~A1 hoặc ~A2 thấp, hoặc khi ~A xuống trong lúc B cao. tw = ln2 · Rext · Cext (tham số; chân Rint / Cext chỉ để nối dây).',
    pins: 14,
    left: '~A1:3 ~A2:4 B:5 | %RINT@Rint:9 %CEXT@Cext:10 %RCEXT@Rext/Cext:11',
    right: 'Q:6 QN@~Q:1',
    fams: fams('STD LS'),
    kind: 'monostable',
    delay: 4,
    params: timing('', '2k', '10n'),
    optional: ['RINT', 'CEXT', 'RCEXT'],
    keywords: ['monostable', 'one-shot', 'pulse'],
    build: (b) => {
      const tw = Math.max(30e-9, Math.LN2 * b.ctx.num('rext') * b.ctx.num('cext'));
      b.add(undefined, ['A1', 'A2', 'B', 'Q', 'QN'], b.model('D_ONESHOT', 4, { mode: 121, tw }));
    },
  },
  {
    pn: '122',
    name: 'Retriggerable monostable multivibrator with clear',
    vi: 'Mạch đơn ổn kích lại được có xoá',
    desc: 'Triggers when ~(A1·A2)·B1·B2·~CLR goes high; retriggering restarts the pulse. tw ≈ 0.32 · Rext · Cext (params).',
    descVi: 'Kích khi ~(A1·A2)·B1·B2·~CLR chuyển lên cao; kích lại thì xung bắt đầu lại. tw ≈ 0,32 · Rext · Cext (tham số).',
    pins: 14,
    left: '~A1:1 ~A2:2 B1:3 B2:4 ~CLR:5 | %RINT@Rint:9 %CEXT@Cext:11 %RCEXT@Rext/Cext:13',
    right: 'Q:8 QN@~Q:6',
    fams: fams('STD LS'),
    kind: 'monostable',
    delay: 3,
    params: timing(),
    optional: ['RINT', 'CEXT', 'RCEXT'],
    keywords: ['monostable', 'one-shot', 'retriggerable', 'watchdog'],
    build: (b) => {
      const tw = Math.max(30e-9, 0.32 * b.ctx.num('rext') * b.ctx.num('cext'));
      b.add(undefined, ['A1', 'A2', 'B1', 'B2', 'CLR', 'Q', 'QN'], b.model('D_ONESHOT', 3, { mode: 122, tw }));
    },
  },
  oneShotDual('123', 123, 0.45, 'STD LS HC HCT', true),
  oneShotDual('221', 221, 0.7, 'LS HC HCT', false),
];

/** Every 74xx device type of the catalogue. */
export const LOGIC74_SPECS: LogicSpec[] = [...GATES, ...BUFFERS, ...REGISTERS, ...COUNTERS, ...SHIFT, ...DECODERS, ...MUXES, ...ARITH, ...MONO];

/** Types by part number suffix (tests, examples). */
export function logic74Spec(pn: string): LogicSpec | undefined {
  return LOGIC74_SPECS.find((s) => s.pn === pn);
}

export type { LogicFamily, LogicKind };
