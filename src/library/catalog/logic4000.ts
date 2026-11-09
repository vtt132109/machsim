/**
 * 4000B-series CMOS catalogue (and the 74HC / 74HCT versions of 4000-series numbers such as the
 * 74HC4040, 74HC4051 or 74HC4046): gates, flip-flops and latches, counters, shift registers,
 * decoders, encoders, data selectors, arithmetic, monostables, analog switches / multiplexers and
 * the 4046 phase-locked loop. The sixteen 4000 types of src/library/parts/digital/cmos.ts keep
 * their hand-written parts; this table adds the rest and the HC versions.
 *
 * Analog switches and multiplexers are voltage-controlled switches (S elements) driven from
 * internal decoder nodes; RON follows the supply (4000B: ≈ 2350 Ω·V / VDD for the 4051 family,
 * ≈ 5000 Ω·V / VDD for the 4016; 74HC: 90 Ω mux, 40 Ω switch at 4.5-5 V), ROFF 10 GΩ.
 * The 4046 combines the PLL phase comparators (D_PHASE_DET) with a voltage-controlled oscillator
 * (D_VCO) whose range follows the classic design formulas fmax ≈ 1 / (R1 (C1 + 32 pF)) + fmin,
 * fmin ≈ 1 / (R2 (C1 + 32 pF)) (R2 = 0: no offset), linear in VCOin from 0 to the supply.
 */
import { elE, elR, elS, numParam, swModel } from '../partkit';
import type { IcBuilder } from '../parts/digital/ttl';
import { fams, gates, names, type LogicFamily, type LogicSpec } from './logicKit';
import { HEX1, QUAD2B, gateSides, schmittThresholds } from './logic74';

type G = [string[], string];

const CD4IN: G[] = [[['1A:2', '1B:3', '1C:4', '1D:5'], '1Y:1'], [['2A:9', '2B:10', '2C:11', '2D:12'], '2Y:13']];
const CD3IN: G[] = [[['1A:1', '1B:2', '1C:8'], '1Y:9'], [['2A:3', '2B:4', '2C:5'], '2Y:6'], [['3A:11', '3B:12', '3C:13'], '3Y:10']];
const HEXBUF: G[] = [[['1A:3'], '1Y:2'], [['2A:5'], '2Y:4'], [['3A:7'], '3Y:6'], [['4A:9'], '4Y:10'], [['5A:11'], '5Y:12'], [['6A:14'], '6Y:15']];

function gate(pn: string, name: string, vi: string, type: string, gs: G[], fam: string, desc: string, descVi: string, o: { schmitt?: boolean; pins?: number; power?: string; strong?: boolean; factor?: number } = {}): LogicSpec {
  const { left, right, sections } = gateSides(gs);
  return {
    pn,
    name,
    vi,
    desc,
    descVi,
    pins: o.pins ?? 14,
    power: o.power,
    left,
    right,
    fams: fams(fam),
    kind: type === 'D_INVERTER' || type === 'D_BUFFER' ? 'buffer' : 'gate',
    schmitt: o.schmitt,
    strong: o.strong,
    delay: o.factor ?? 1,
    keywords: [type.replace('D_', '').toLowerCase(), 'gate'],
    build: (b) => gates(b, type, sections, o.factor ?? 1, o.schmitt ? cmosSchmitt(b) : {}),
  };
}

/** 4000B / HC Schmitt thresholds (VT+ ≈ 0.58 VDD, VT- ≈ 0.38 VDD for 4093-type inputs). */
function cmosSchmitt(b: IcBuilder): Record<string, number> {
  return b.levels.thresh_scale ? { vtp: 0.58 * b.levels.vnom, vtn: 0.38 * b.levels.vnom } : schmittThresholds(b);
}

const GATES: LogicSpec[] = [
  gate('4002', 'Dual 4-input NOR gate', 'Hai cổng NOR 4 đầu vào', 'D_NOR', CD4IN, '4000 HC', 'Y = ~(A+B+C+D).', 'Y = ~(A+B+C+D).'),
  gate('4012', 'Dual 4-input NAND gate', 'Hai cổng NAND 4 đầu vào', 'D_NAND', CD4IN, '4000', 'Y = ~(A·B·C·D).', 'Y = ~(A·B·C·D).'),
  gate('4023', 'Triple 3-input NAND gate', 'Ba cổng NAND 3 đầu vào', 'D_NAND', CD3IN, '4000', 'Y = ~(A·B·C).', 'Y = ~(A·B·C).'),
  gate('4025', 'Triple 3-input NOR gate', 'Ba cổng NOR 3 đầu vào', 'D_NOR', CD3IN, '4000', 'Y = ~(A+B+C).', 'Y = ~(A+B+C).'),
  gate('4030', 'Quad 2-input XOR gate', 'Bốn cổng XOR 2 đầu vào', 'D_XOR', QUAD2B, '4000', 'Y = A⊕B.', 'Y = A⊕B.'),
  gate('4072', 'Dual 4-input OR gate', 'Hai cổng OR 4 đầu vào', 'D_OR', CD4IN, '4000 HC', 'Y = A+B+C+D.', 'Y = A+B+C+D.'),
  gate('4073', 'Triple 3-input AND gate', 'Ba cổng AND 3 đầu vào', 'D_AND', CD3IN, '4000', 'Y = A·B·C.', 'Y = A·B·C.'),
  gate('4075', 'Triple 3-input OR gate', 'Ba cổng OR 3 đầu vào', 'D_OR', CD3IN, '4000 HC', 'Y = A+B+C.', 'Y = A+B+C.'),
  gate('4077', 'Quad 2-input XNOR gate', 'Bốn cổng XNOR 2 đầu vào', 'D_XNOR', QUAD2B, '4000', 'Y = ~(A⊕B) (high when the inputs are equal).', 'Y = ~(A⊕B) (mức cao khi hai đầu vào bằng nhau).'),
  gate('4082', 'Dual 4-input AND gate', 'Hai cổng AND 4 đầu vào', 'D_AND', CD4IN, '4000', 'Y = A·B·C·D.', 'Y = A·B·C·D.'),
  gate('40106', 'Hex Schmitt-trigger inverter', 'Sáu cổng đảo Schmitt', 'D_INVERTER', HEX1, '4000', 'Y = ~A with input hysteresis: RC oscillators, debouncing, slow edges.', 'Y = ~A có trễ đầu vào: dao động RC, chống dội phím, làm sạch sườn chậm.', { schmitt: true }),
  gate('4584', 'Hex Schmitt-trigger inverter', 'Sáu cổng đảo Schmitt', 'D_INVERTER', HEX1, '4000', 'Y = ~A with input hysteresis (40106 function).', 'Y = ~A có trễ đầu vào (chức năng như 40106).', { schmitt: true }),
  gate('4049', 'Hex inverting buffer / level converter', 'Sáu bộ đệm đảo / chuyển mức', 'D_INVERTER', HEXBUF, 'HC', 'High-current inverters; inputs tolerate voltages above the supply (level down-conversion).', 'Cổng đảo dòng lớn; đầu vào chịu được áp cao hơn nguồn (chuyển mức xuống).', { pins: 16, power: 'VDD = 1, VSS = 8', factor: 0.9 }),
  gate('4050', 'Hex non-inverting buffer / level converter', 'Sáu bộ đệm không đảo / chuyển mức', 'D_BUFFER', HEXBUF, 'HC', 'High-current buffers; inputs tolerate voltages above the supply (level down-conversion).', 'Bộ đệm dòng lớn; đầu vào chịu được áp cao hơn nguồn (chuyển mức xuống).', { pins: 16, power: 'VDD = 1, VSS = 8', factor: 0.9 }),
];

// ---------------------------------------------------------------------------------------------
// flip-flops, latches, registers

const REGISTERS: LogicSpec[] = [
  {
    pn: '4042',
    name: 'Quad clocked D latch with polarity control',
    vi: 'Bốn chốt D có chân chọn cực tính',
    desc: 'The latches are transparent while CLK equals POL and hold otherwise; Q and ~Q outputs.',
    descVi: 'Các chốt trong suốt khi CLK bằng POL và giữ dữ liệu trong trường hợp còn lại; có ngõ Q và ~Q.',
    pins: 16,
    left: 'CLK:5 POL:6 | D1:4 D2:7 D3:13 D4:14',
    right: 'Q1:2 Q2:10 Q3:11 Q4:1 | Q1N@~Q1:3 Q2N@~Q2:9 Q3N@~Q3:12 Q4N@~Q4:15',
    fams: fams('4000'),
    kind: 'latch',
    delay: 2.5,
    keywords: ['latch', 'transparent', 'polarity'],
    build: (b) => b.add(undefined, [...names('D', 4, 1), 'CLK', 'POL', ...names('Q', 4, 1), ...names('Q', 4, 1, 'N')], b.model('D_REG', 2.5, { n: 4, latch: 1, pol: 1, has_qn: 1 })),
  },
  {
    pn: '4099',
    name: '8-bit addressable latch',
    vi: 'Chốt 8 bit đánh địa chỉ',
    desc: 'WD low writes DATA into the latch addressed by A2..A0; RESET high with WD high clears all, with WD low makes a 1-of-8 demultiplexer.',
    descVi: 'WD thấp ghi DATA vào chốt có địa chỉ A2..A0; RESET cao khi WD cao xoá hết, khi WD thấp thành bộ phân kênh 1 ra 8.',
    pins: 16,
    left: 'A0:5 A1:6 A2:7 | DATA:3 WD:4 RESET:2',
    right: names('Q', 8).map((n, i) => `${n}:${[9, 10, 11, 12, 13, 14, 15, 1][i]}`).join(' '),
    fams: fams('4000'),
    kind: 'latch',
    delay: 3,
    keywords: ['addressable latch', 'demultiplexer'],
    build: (b) => b.add(undefined, ['A0', 'A1', 'A2', 'DATA', 'WD', 'RESET', ...names('Q', 8)], b.model('D_ADDR_LATCH', 3, { g_low: 1, clr_low: 0 })),
  },
  {
    pn: '4076',
    name: '4-bit D register with 3-state outputs',
    vi: 'Thanh ghi D 4 bit, ngõ ra ba trạng thái',
    desc: 'Loads on the rising clock edge while G1 and G2 (data disable) are low; outputs enabled while M and N are low; RESET (high) clears.',
    descVi: 'Nạp ở sườn lên khi G1 và G2 (cấm dữ liệu) thấp; ngõ ra hoạt động khi M và N thấp; RESET (cao) xoá.',
    pins: 16,
    left: 'CLK:7> G1:9 G2:10 RESET:15 | M:1 N:2 | D1:14 D2:13 D3:12 D4:11',
    right: '| | | | | | | Q1:3 Q2:4 Q3:5 Q4:6',
    fams: fams('4000'),
    kind: 'register',
    output: '3-state',
    delay: 3,
    keywords: ['register', '3-state'],
    build: (b) => b.add(undefined, [...names('D', 4, 1), 'CLK', 'M', 'N', 'G1', 'G2', 'RESET', ...names('Q', 4, 1)], b.model('D_REG', 3, { n: 4, oe: 2, en: 2, has_clr: 1, clr_low: 0 })),
  },
  {
    pn: '40174',
    name: 'Hex D flip-flop with clear',
    vi: 'Sáu flip-flop D có xoá',
    desc: 'Rising-edge clock, common ~CLR (74174 pinout).',
    descVi: 'Kích sườn lên, chân ~CLR chung (sơ đồ chân như 74174).',
    pins: 16,
    left: 'CLK:9> ~CLR:1 | 1D:3 2D:4 3D:6 4D:11 5D:13 6D:14',
    right: '| | | 1Q:2 2Q:5 3Q:7 4Q:10 5Q:12 6Q:15',
    fams: fams('4000'),
    kind: 'register',
    delay: 3,
    keywords: ['register', 'flip-flop'],
    build: (b) => b.add(undefined, [...names('', 6, 1, 'D'), 'CLK', 'CLR', ...names('', 6, 1, 'Q')], b.model('D_REGISTER', 3)),
  },
  {
    pn: '40175',
    name: 'Quad D flip-flop with clear (Q and ~Q)',
    vi: 'Bốn flip-flop D có xoá (Q và ~Q)',
    desc: 'Rising-edge clock, common ~CLR (74175 pinout).',
    descVi: 'Kích sườn lên, chân ~CLR chung (sơ đồ chân như 74175).',
    pins: 16,
    left: 'CLK:9> ~CLR:1 | 1D:4 2D:5 3D:12 4D:13',
    right: '1Q:2 2Q:7 3Q:10 4Q:15 | 1QN@~1Q:3 2QN@~2Q:6 3QN@~3Q:11 4QN@~4Q:14',
    fams: fams('4000'),
    kind: 'register',
    delay: 3,
    keywords: ['register', 'flip-flop'],
    build: (b) => b.add(undefined, [...names('', 4, 1, 'D'), 'CLK', 'CLR', ...names('', 4, 1, 'Q'), ...names('', 4, 1, 'QN')], b.model('D_REGISTER', 3, { has_qn: 1 })),
  },
];

// ---------------------------------------------------------------------------------------------
// counters

function ripple(pn: string, stages: number, taps: number[], nums: number[], clk: string, rst: string, pins: number, fam: string, name: string, vi: string): LogicSpec {
  return {
    pn,
    name,
    vi,
    desc: `Counts on the falling clock edge; RST high clears. Outputs Q${taps.join(', Q')} (Qk divides by 2^k).`,
    descVi: `Đếm ở sườn xuống của xung nhịp; RST cao xoá. Ngõ ra Q${taps.join(', Q')} (Qk chia tần cho 2^k).`,
    pins,
    left: `CLK:${clk}> RST:${rst}`,
    right: taps.map((k, i) => `Q${k}:${nums[i]}`).join(' '),
    fams: fams(fam),
    kind: 'counter',
    delay: 5,
    keywords: ['counter', 'binary', 'ripple', 'divider'],
    build: (b) => b.add(undefined, ['CLK', 'RST', ...taps.map((k) => `Q${k}`)], b.model('D_CNT_RIPPLE', 5, { stages, tapmask: taps.reduce((a, k) => a + 2 ** (k - 1), 0) })),
  };
}

const COUNTERS: LogicSpec[] = [
  ripple('4020', 14, [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [9, 7, 5, 4, 6, 13, 12, 14, 15, 1, 2, 3], '10', '11', 16, '4000 HC HCT', '14-stage ripple-carry binary counter', 'Bộ đếm gợn nhị phân 14 tầng'),
  ripple('4024', 7, [1, 2, 3, 4, 5, 6, 7], [12, 11, 9, 6, 5, 4, 3], '1', '2', 14, '4000 HC', '7-stage ripple-carry binary counter', 'Bộ đếm gợn nhị phân 7 tầng'),
  ripple('4040', 12, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [9, 7, 6, 5, 3, 2, 4, 13, 12, 14, 15, 1], '10', '11', 16, 'HC HCT', '12-stage ripple-carry binary counter', 'Bộ đếm gợn nhị phân 12 tầng'),
  {
    pn: '4060',
    name: '14-stage ripple-carry binary counter with oscillator',
    vi: 'Bộ đếm gợn nhị phân 14 tầng có mạch dao động',
    desc: 'Oscillator stages φO = ~φI and ~φO = φI: connect Rs to φI, Rt to φO and Ct to ~φO for an RC oscillator (f ≈ 1 / (2.3 Rt Ct)); counts on the falling edge of φI; RST high clears.',
    descVi: 'Tầng dao động φO = ~φI và ~φO = φI: nối Rs vào φI, Rt vào φO và Ct vào ~φO để có dao động RC (f ≈ 1 / (2,3 Rt Ct)); đếm ở sườn xuống của φI; RST cao xoá.',
    pins: 16,
    left: 'PHI_I@φI:11> RST:12 | +PHI_O@φO:10 +PHI_ON@~φO:9',
    right: [4, 5, 6, 7, 8, 9, 10, 12, 13, 14].map((s, k) => `Q${s}:${[7, 5, 4, 6, 14, 13, 15, 1, 2, 3][k]}`).join(' '),
    fams: fams('HC HCT'),
    kind: 'counter',
    delay: 6,
    keywords: ['counter', 'oscillator', 'divider', 'timer'],
    build: (b) => {
      const st = [4, 5, 6, 7, 8, 9, 10, 12, 13, 14];
      b.add('cnt', ['PHI_I', 'RST', ...st.map((s) => `Q${s}`)], b.model('D_CNT_RIPPLE', 6, { stages: 14, tapmask: st.reduce((a, s) => a + 2 ** (s - 1), 0) }));
      b.add('o1', ['PHI_I', 'PHI_O'], b.model('D_INVERTER', 1));
      b.add('o2', ['PHI_I', 'PHI_ON'], b.model('D_BUFFER', 1));
    },
  },
  {
    pn: '4017',
    name: 'Decade counter / divider with 10 decoded outputs',
    vi: 'Bộ đếm / chia 10 có 10 ngõ ra giải mã',
    desc: 'Johnson counter: counts on CLK rising while ~INH is low; RST high returns to Q0; CO is high for counts 0-4.',
    descVi: 'Bộ đếm Johnson: đếm ở sườn lên của CLK khi ~INH thấp; RST cao đưa về Q0; CO cao ở các số đếm 0-4.',
    pins: 16,
    left: 'CLK:14> ~INH:13 RST:15',
    right: `${[3, 2, 4, 7, 10, 1, 5, 6, 9, 11].map((n, k) => `Q${k}:${n}`).join(' ')} | CO:12`,
    fams: fams('HC HCT'),
    kind: 'counter',
    delay: 3,
    keywords: ['counter', 'decade', 'johnson', 'led chaser'],
    build: (b) => b.add(undefined, ['CLK', 'INH', 'RST', ...names('Q', 10), 'CO'], b.model('D_CNT_JOHNSON', 3)),
  },
  {
    pn: '4022',
    name: 'Divide-by-8 counter / divider with 8 decoded outputs',
    vi: 'Bộ đếm / chia 8 có 8 ngõ ra giải mã',
    desc: 'Johnson counter: counts on CLK rising while ~INH is low; RST high returns to Q0; CO is high for counts 0-3.',
    descVi: 'Bộ đếm Johnson: đếm ở sườn lên của CLK khi ~INH thấp; RST cao đưa về Q0; CO cao ở các số đếm 0-3.',
    pins: 16,
    left: 'CLK:14> ~INH:13 RST:15',
    right: `${[2, 1, 3, 7, 11, 4, 5, 10].map((n, k) => `Q${k}:${n}`).join(' ')} | CO:12`,
    fams: fams('4000'),
    kind: 'counter',
    delay: 3,
    keywords: ['counter', 'octal', 'johnson'],
    build: (b) => b.add(undefined, ['CLK', 'INH', 'RST', ...names('Q', 8), 'CO'], b.model('D_CNT_JOHNSON', 3)),
  },
  {
    pn: '4026',
    name: 'Decade counter with decoded 7-segment outputs',
    vi: 'Bộ đếm thập phân có ngõ ra giải mã 7 đoạn',
    desc: 'Counts on CLK rising while INH is low; segment outputs a-g drive a common-cathode display directly (DEI low blanks them); CO is high for counts 0-4 (cascade to the next 4026); UC is the unblanked c segment.',
    descVi: 'Đếm ở sườn lên của CLK khi INH thấp; ngõ ra a-g lái trực tiếp LED cathode chung (DEI thấp tắt hiển thị); CO cao ở số đếm 0-4 (nối sang 4026 kế tiếp); UC là đoạn c không bị tắt.',
    pins: 16,
    left: 'CLK:1> INH:2 RST:15 DEI:3',
    right: 'SEGA@a:10 SEGB@b:12 SEGC@c:13 SEGD@d:9 SEGE@e:11 SEGF@f:6 SEGG@g:7 | CO:5 DEO:4 UC:14',
    fams: fams('4000'),
    kind: 'counter',
    delay: 5,
    keywords: ['counter', 'decade', '7-segment', 'display'],
    build: (b) => b.add(undefined, ['CLK', 'INH', 'RST', 'DEI', 'SEGA', 'SEGB', 'SEGC', 'SEGD', 'SEGE', 'SEGF', 'SEGG', 'CO', 'DEO', 'UC'], b.model('D_CNT_7SEG', 5, { rhigh: 400 })),
  },
  {
    pn: '4029',
    name: 'Presettable up / down counter, binary or decade',
    vi: 'Bộ đếm lên / xuống đặt trước được, nhị phân hoặc thập phân',
    desc: 'Counts on CLK rising while ~CI is low: U/D high = up, B/D high = binary (0-15), low = decade (0-9); PE high loads J1-J4 at once; ~CO low at the end of the count.',
    descVi: 'Đếm ở sườn lên của CLK khi ~CI thấp: U/D cao = đếm lên, B/D cao = nhị phân (0-15), thấp = thập phân (0-9); PE cao nạp J1-J4 ngay; ~CO thấp ở cuối chu kỳ đếm.',
    pins: 16,
    left: 'CLK:15> PE:1 ~CI:5 UD@U/D:10 BD@B/D:9 | J1:4 J2:12 J3:13 J4:3',
    right: 'Q1:6 Q2:11 Q3:14 Q4:2 | ~CO:7',
    fams: fams('4000'),
    kind: 'counter',
    delay: 4,
    keywords: ['counter', 'up down', 'binary', 'decade'],
    build: (b) => b.add(undefined, ['CLK', 'PE', 'CI', 'UD', 'BD', 'J1', 'J2', 'J3', 'J4', 'Q1', 'Q2', 'Q3', 'Q4', 'CO'], b.model('D_CNT_UD3', 4, { has_rst: 0, has_bd: 1 })),
  },
  ...(['4510', '4516'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Presettable ${pn === '4510' ? 'BCD' : 'binary'} up / down counter`,
      vi: `Bộ đếm lên / xuống ${pn === '4510' ? 'BCD' : 'nhị phân'} đặt trước được`,
      desc: 'Counts on CLK rising while ~CI is low (U/D high = up); PE high loads P1-P4 at once, RESET high clears; ~CO low at the end of the count.',
      descVi: 'Đếm ở sườn lên của CLK khi ~CI thấp (U/D cao = đếm lên); PE cao nạp P1-P4 ngay, RESET cao xoá; ~CO thấp ở cuối chu kỳ đếm.',
      pins: 16,
      left: 'CLK:15> PE:1 ~CI:5 UD@U/D:10 RESET:9 | P1:4 P2:12 P3:13 P4:3',
      right: 'Q1:6 Q2:11 Q3:14 Q4:2 | ~CO:7',
      fams: fams('4000'),
      kind: 'counter',
      delay: 4,
      keywords: ['counter', 'up down', pn === '4510' ? 'bcd' : 'binary'],
      build: (b) => b.add(undefined, ['CLK', 'PE', 'CI', 'UD', 'RESET', 'P1', 'P2', 'P3', 'P4', 'Q1', 'Q2', 'Q3', 'Q4', 'CO'], b.model('D_CNT_UD3', 4, { modulus: pn === '4510' ? 10 : 16 })),
    }),
  ),
  ...(['4518', '4520'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Dual ${pn === '4518' ? 'BCD' : '4-bit binary'} up counter`,
      vi: `Hai bộ đếm lên ${pn === '4518' ? 'BCD' : 'nhị phân 4 bit'}`,
      desc: 'Each counter advances on CLK rising while EN is high, or on EN falling while CLK is low (cascade from Q4); RESET high clears.',
      descVi: 'Mỗi bộ đếm tăng ở sườn lên của CLK khi EN cao, hoặc ở sườn xuống của EN khi CLK thấp (ghép tầng từ Q4); RESET cao xoá.',
      pins: 16,
      left: '1CLK:1> 1EN:2 1RESET:7 | 2CLK:9> 2EN:10 2RESET:15',
      right: '1Q1:3 1Q2:4 1Q3:5 1Q4:6 | 2Q1:11 2Q2:12 2Q3:13 2Q4:14',
      fams: fams('4000 HC'),
      kind: 'counter',
      delay: 4,
      keywords: ['counter', 'dual', pn === '4518' ? 'bcd' : 'binary'],
      build: (b) => {
        const m = b.model('D_CNT_EN', 4, { modulus: pn === '4518' ? 10 : 16 });
        for (const k of [1, 2]) b.add(String(k), [`${k}CLK`, `${k}EN`, `${k}RESET`, ...names(`${k}Q`, 4, 1)], m);
      },
    }),
  ),
  ...(['40161', '40163'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Synchronous 4-bit binary counter (${pn === '40163' ? 'synchronous' : 'asynchronous'} clear)`,
      vi: `Bộ đếm đồng bộ nhị phân 4 bit (xoá ${pn === '40163' ? 'đồng bộ' : 'không đồng bộ'})`,
      desc: '74161 / 74163 function and pinout in 4000B CMOS.',
      descVi: 'Chức năng và sơ đồ chân như 74161 / 74163, công nghệ CMOS 4000B.',
      pins: 16,
      left: 'CLK:2> ~CLR:1 ~LOAD:9 ENP:7 ENT:10 | A:3 B:4 C:5 D:6',
      right: 'QA:14 QB:13 QC:12 QD:11 | RCO:15',
      fams: fams('4000'),
      kind: 'counter',
      delay: 4,
      keywords: ['counter', 'synchronous', 'binary'],
      build: (b) => b.add(undefined, ['CLK', 'CLR', 'LOAD', 'ENP', 'ENT', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'RCO'], b.model('D_CNT_SYNC', 4, { sync_clear: pn === '40163' ? 1 : 0 })),
    }),
  ),
  ...(['40192', '40193'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Synchronous up / down ${pn === '40192' ? 'decade' : 'binary'} counter (dual clock)`,
      vi: `Bộ đếm lên / xuống đồng bộ ${pn === '40192' ? 'thập phân' : 'nhị phân'} (hai xung nhịp)`,
      desc: '74192 / 74193 function and pinout in 4000B CMOS.',
      descVi: 'Chức năng và sơ đồ chân như 74192 / 74193, công nghệ CMOS 4000B.',
      pins: 16,
      left: 'UP:5> DOWN:4> CLR:14 ~LOAD:11 | A:15 B:1 C:10 D:9',
      right: 'QA:3 QB:2 QC:6 QD:7 | ~CO:12 ~BO:13',
      fams: fams('4000'),
      kind: 'counter',
      delay: 4,
      keywords: ['counter', 'up down'],
      build: (b) => b.add(undefined, ['UP', 'DOWN', 'CLR', 'LOAD', 'A', 'B', 'C', 'D', 'QA', 'QB', 'QC', 'QD', 'CO', 'BO'], b.model('D_CNT_UPDOWN', 4, { modulus: pn === '40192' ? 10 : 16 })),
    }),
  ),
];

// ---------------------------------------------------------------------------------------------
// shift registers

const PISO_LEFT = 'PS@P/~S:9 CLK:10> SER:11 | P1:7 P2:6 P3:5 P4:4 P5:13 P6:14 P7:15 P8:1';

const SHIFT: LogicSpec[] = [
  ...(['4014', '4021'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `8-stage static shift register, parallel in (${pn === '4014' ? 'synchronous' : 'asynchronous'} load)`,
      vi: `Thanh ghi dịch 8 tầng vào song song (nạp ${pn === '4014' ? 'đồng bộ' : 'không đồng bộ'})`,
      desc: `P/~S high loads P1-P8 ${pn === '4014' ? 'on the rising clock edge' : 'at once'}; low shifts toward Q8 on CLK rising (SER into stage 1); outputs Q6, Q7, Q8.`,
      descVi: `P/~S cao nạp P1-P8 ${pn === '4014' ? 'ở sườn lên của xung nhịp' : 'ngay lập tức'}; thấp thì dịch về phía Q8 ở sườn lên CLK (SER vào tầng 1); ngõ ra Q6, Q7, Q8.`,
      pins: 16,
      left: PISO_LEFT,
      right: 'Q6:2 Q7:12 Q8:3',
      fams: fams('4000'),
      kind: 'shift',
      delay: 4,
      keywords: ['shift register', 'piso', 'parallel load', 'keyboard'],
      build: (b) => b.add(undefined, ['SER', 'CLK', 'PS', ...names('P', 8, 1), 'Q6', 'Q7', 'Q8'], b.model('D_SHIFT_PISO2', 4, { n: 8, load_high: 1, async_load: pn === '4021' ? 1 : 0, taps: 0xe0 })),
    }),
  ),
  {
    pn: '4015',
    name: 'Dual 4-stage static shift register (serial in, parallel out)',
    vi: 'Hai thanh ghi dịch 4 tầng (vào nối tiếp, ra song song)',
    desc: 'Each half shifts D into Q1 on the rising clock edge; RESET high clears.',
    descVi: 'Mỗi nửa dịch D vào Q1 ở sườn lên của xung nhịp; RESET cao xoá.',
    pins: 16,
    left: '1D:7 1CLK:9> 1RESET:6 | 2D:15 2CLK:1> 2RESET:14',
    right: '1Q1:5 1Q2:4 1Q3:3 1Q4:10 | 2Q1:13 2Q2:12 2Q3:11 2Q4:2',
    fams: fams('4000 HC'),
    kind: 'shift',
    delay: 4,
    keywords: ['shift register', 'sipo', 'dual'],
    build: (b) => {
      const m = b.model('D_SHIFT_SIPO', 4);
      for (const k of [1, 2]) b.addNodes(String(k), [`${k}D`, `${k}D`, `${k}CLK`, `${k}RESET`, ...names(`${k}Q`, 4, 1)].map((p) => b.n(p)), m, {}, '# # # ~# # # # #');
    },
  },
  {
    pn: '4094',
    name: '8-stage shift-and-store bus register (3-state)',
    vi: 'Thanh ghi dịch - lưu 8 tầng (ba trạng thái)',
    desc: "DATA shifts in on CLK rising; the storage latch follows the shift register while STROBE is high; OE high enables Q1-Q8; QS (rising clock) and QS' (falling clock) cascade the next stage.",
    descVi: "DATA được dịch vào ở sườn lên CLK; chốt lưu theo thanh ghi dịch khi STROBE cao; OE cao cho phép Q1-Q8; QS (sườn lên) và QS' (sườn xuống) để ghép tầng.",
    pins: 16,
    left: 'DATA:2 CLK:3> STROBE:1 OE:15',
    right: "Q1:4 Q2:5 Q3:6 Q4:7 Q5:14 Q6:13 Q7:12 Q8:11 | QS:9 QS2@QS':10",
    fams: fams('4000 HC HCT'),
    kind: 'shift',
    output: '3-state',
    delay: 4,
    keywords: ['shift register', 'sipo', 'latch', 'led driver'],
    build: (b) => b.add(undefined, ['DATA', 'CLK', 'STROBE', 'OE', ...names('Q', 8, 1), 'QS', 'QS2'], b.model('D_SHIFT_STORE', 4, { has_clr: 0, latch: 1, oe_high: 1, has_qs2: 1 })),
  },
];

// ---------------------------------------------------------------------------------------------
// decoders, encoders, selectors, arithmetic

const DECODERS: LogicSpec[] = [
  {
    pn: '4028',
    name: 'BCD-to-decimal decoder (active-high outputs)',
    vi: 'Bộ giải mã BCD sang thập phân (ngõ ra tích cực cao)',
    desc: 'The output selected by D C B A goes high; codes 10-15 leave every output low.',
    descVi: 'Ngõ ra được chọn bởi D C B A lên cao; mã 10-15 để mọi ngõ ra ở mức thấp.',
    pins: 16,
    left: 'A:10 B:13 C:12 D:11',
    right: [3, 14, 2, 15, 1, 6, 7, 4, 9, 5].map((n, k) => `Q${k}:${n}`).join(' '),
    fams: fams('4000'),
    kind: 'decoder',
    delay: 3,
    keywords: ['decoder', 'bcd', '1 of 10'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', ...names('Q', 10)], b.model('D_DECODER', 3, { n: 4, outputs: 10, out_low: 0 })),
  },
  ...(['4514', '4515'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `4-bit latch / 4-to-16 line decoder (${pn === '4514' ? 'high' : 'low'} outputs)`,
      vi: `Chốt 4 bit / giải mã 4 sang 16 (ngõ ra tích cực ${pn === '4514' ? 'cao' : 'thấp'})`,
      desc: `The address latch is transparent while STROBE is high; the selected output goes ${pn === '4514' ? 'high' : 'low'}; INHIBIT high deselects every output.`,
      descVi: `Chốt địa chỉ trong suốt khi STROBE cao; ngõ ra được chọn ${pn === '4514' ? 'lên cao' : 'xuống thấp'}; INHIBIT cao bỏ chọn mọi ngõ ra.`,
      pins: 24,
      left: 'A:2 B:3 C:21 D:22 | STROBE:1 INHIBIT:23',
      right: [11, 9, 10, 8, 7, 6, 5, 4, 18, 17, 20, 19, 14, 13, 16, 15].map((n, k) => `${pn === '4515' ? '~' : ''}S${k}:${n}`).join(' '),
      fams: fams(pn === '4514' ? '4000 HC' : '4000'),
      kind: 'decoder',
      delay: 4,
      keywords: ['decoder', 'latch', '4 to 16'],
      build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'INHIBIT', 'STROBE', ...names('S', 16)], b.model('D_DECODER', 4, { n: 4, en_low: 1, strobe: 1, out_low: pn === '4515' ? 1 : 0 })),
    }),
  ),
  ...(['4555', '4556'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: `Dual 2-to-4 line decoder / demultiplexer (${pn === '4555' ? 'high' : 'low'} outputs)`,
      vi: `Hai bộ giải mã 2 sang 4 (ngõ ra tích cực ${pn === '4555' ? 'cao' : 'thấp'})`,
      desc: `Enabled while ~E is low; the selected output goes ${pn === '4555' ? 'high' : 'low'}.`,
      descVi: `Hoạt động khi ~E thấp; ngõ ra được chọn ${pn === '4555' ? 'lên cao' : 'xuống thấp'}.`,
      pins: 16,
      left: '1A:2 1B:3 ~1E:1 | | 2A:14 2B:13 ~2E:15',
      right: `${[4, 5, 6, 7].map((n, k) => `${pn === '4556' ? '~' : ''}1Q${k}:${n}`).join(' ')} | ${[12, 11, 10, 9].map((n, k) => `${pn === '4556' ? '~' : ''}2Q${k}:${n}`).join(' ')}`,
      fams: fams('4000'),
      kind: 'decoder',
      delay: 3,
      keywords: ['decoder', 'demultiplexer', '2 to 4'],
      build: (b) => {
        const m = b.model('D_DECODER', 3, { en_low: 1, out_low: pn === '4556' ? 1 : 0 });
        for (const k of [1, 2]) b.add(String(k), [`${k}A`, `${k}B`, `${k}E`, ...names(`${k}Q`, 4)], m);
      },
    }),
  ),
  {
    pn: '4511',
    name: 'BCD to 7-segment latch / decoder / driver',
    vi: 'Chốt / giải mã / lái BCD sang LED 7 đoạn',
    desc: 'Active-high outputs for common-cathode displays; LE high holds the latched code, ~BL blanks, ~LT lights every segment; codes 10-15 are blank.',
    descVi: 'Ngõ ra tích cực cao cho LED cathode chung; LE cao giữ mã đã chốt, ~BL tắt hiển thị, ~LT sáng mọi đoạn; mã 10-15 không hiển thị.',
    pins: 16,
    left: 'A:7 B:1 C:2 D:6 | ~LT:3 ~BL:4 LE:5',
    right: 'SEGA@a:13 SEGB@b:12 SEGC@c:11 SEGD@d:10 SEGE@e:9 SEGF@f:15 SEGG@g:14',
    fams: fams('HC'),
    kind: 'display',
    delay: 3,
    keywords: ['7-segment', 'decoder', 'latch', 'driver'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', 'D', 'LT', 'BL', 'LE', 'SEGA', 'SEGB', 'SEGC', 'SEGD', 'SEGE', 'SEGF', 'SEGG'], b.model('D_BCD7SEG_LATCH', 3)),
  },
  {
    pn: '4543',
    name: 'BCD to 7-segment latch / decoder / driver for LCD and LED',
    vi: 'Chốt / giải mã / lái BCD sang 7 đoạn cho LCD và LED',
    desc: 'LD high makes the latch transparent, BI high blanks; every segment output is XORed with PH (PH low: active-high outputs for LEDs; PH = the LCD back-plane square wave for liquid-crystal displays).',
    descVi: 'LD cao làm chốt trong suốt, BI cao tắt hiển thị; mỗi ngõ ra đoạn được XOR với PH (PH thấp: tích cực cao cho LED; PH = sóng vuông mặt sau cho màn hình tinh thể lỏng).',
    pins: 16,
    left: 'A:5 B:3 C:2 D:4 | LD:1 BI:7 PH:6',
    right: 'SEGA@a:9 SEGB@b:10 SEGC@c:11 SEGD@d:12 SEGE@e:13 SEGF@f:15 SEGG@g:14',
    fams: fams('4000 HC'),
    kind: 'display',
    delay: 4,
    keywords: ['7-segment', 'lcd', 'decoder', 'latch'],
    build: (b) => {
      const segs = ['SEGA', 'SEGB', 'SEGC', 'SEGD', 'SEGE', 'SEGF', 'SEGG'];
      const raw = segs.map((s) => b.node(s.toLowerCase()));
      // 4511 decoder with LD (transparent high) and BI (blank high) inverted onto LE / ~BL; ~LT held inactive
      b.addNodes('dec', [b.n('A'), b.n('B'), b.n('C'), b.n('D'), '0', b.n('BI'), b.n('LD'), ...raw], b.model('D_BCD7SEG_LATCH', 3), {}, '# # # # ~# ~# ~# # # # # # # #');
      const x = b.model('D_XOR', 1);
      segs.forEach((s, i) => b.addNodes(s.toLowerCase(), [raw[i], b.n('PH'), b.n(s)], x));
    },
  },
  {
    pn: '4532',
    name: '8-bit priority encoder (active-high)',
    vi: 'Bộ mã hoá ưu tiên 8 bit (tích cực cao)',
    desc: 'Q2..Q0 give the number of the highest active input D7..D0 while EI is high; GS is high when any input is active, EO when none is (cascading).',
    descVi: 'Q2..Q0 cho số thứ tự của đầu vào tích cực cao nhất D7..D0 khi EI cao; GS cao khi có đầu vào tích cực, EO cao khi không có (để ghép tầng).',
    pins: 16,
    left: `${[10, 11, 12, 13, 1, 2, 3, 4].map((n, k) => `D${k}:${n}`).join(' ')} | EI:5`,
    right: 'Q0:9 Q1:7 Q2:6 | GS:14 EO:15',
    fams: fams('4000'),
    kind: 'encoder',
    delay: 3,
    keywords: ['encoder', 'priority'],
    build: (b) => b.add(undefined, [...names('D', 8), 'EI', 'Q0', 'Q1', 'Q2', 'GS', 'EO'], b.model('D_PRIENC', 3, { mode: 4532 })),
  },
  {
    pn: '4512',
    name: '8-channel data selector with 3-state output',
    vi: 'Bộ chọn dữ liệu 8 kênh, ngõ ra ba trạng thái',
    desc: 'Z = the input X0..X7 selected by C B A; INHIBIT high forces Z low; DIS (3-state disable) high releases Z.',
    descVi: 'Z = đầu vào X0..X7 được chọn bởi C B A; INHIBIT cao ép Z xuống thấp; DIS cao thả nổi Z.',
    pins: 16,
    left: `A:11 B:12 C:13 INHIBIT:10 DIS:15 | ${[1, 2, 3, 4, 5, 6, 7, 9].map((n, k) => `X${k}:${n}`).join(' ')}`,
    right: 'Z:14',
    fams: fams('4000'),
    kind: 'mux',
    output: '3-state',
    delay: 3,
    keywords: ['multiplexer', 'data selector', '8 to 1'],
    build: (b) => b.add(undefined, ['A', 'B', 'C', ...names('X', 8), 'INHIBIT', 'DIS', 'Z'], b.model('D_MUX', 3, { n: 3, strobe: 1, has_oe: 1 })),
  },
  {
    pn: '4008',
    name: '4-bit binary full adder',
    vi: 'Bộ cộng nhị phân đầy đủ 4 bit',
    desc: 'S = A + B + CIN, carry out COUT.',
    descVi: 'S = A + B + CIN, nhớ ra COUT.',
    pins: 16,
    left: 'A1:7 A2:5 A3:3 A4:1 | B1:6 B2:4 B3:2 B4:15 | CIN:9',
    right: 'S1:10 S2:11 S3:12 S4:13 | COUT:14',
    fams: fams('4000'),
    kind: 'arithmetic',
    delay: 4,
    keywords: ['adder', 'full adder'],
    build: (b) => b.add(undefined, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'CIN', 'S1', 'S2', 'S3', 'S4', 'COUT'], b.model('D_ADDER', 4)),
  },
  ...(['4063', '4585'] as const).map(
    (pn): LogicSpec => ({
      pn,
      name: '4-bit magnitude comparator',
      vi: 'Bộ so sánh độ lớn 4 bit',
      desc: 'Outputs A>B, A=B, A<B with cascading inputs (7485 pinout).',
      descVi: 'Ngõ ra A>B, A=B, A<B với các đầu vào ghép tầng (sơ đồ chân như 7485).',
      pins: 16,
      left: 'A0:10 A1:12 A2:13 A3:15 | B0:9 B1:11 B2:14 B3:1 | IGT@IA>B:4 IEQ@IA=B:3 ILT@IA<B:2',
      right: 'OGT@A>B:5 OEQ@A=B:6 OLT@A<B:7',
      fams: fams('4000'),
      kind: 'comparator',
      delay: 4,
      keywords: ['comparator', 'magnitude'],
      build: (b) => b.add(undefined, ['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'IGT', 'IEQ', 'ILT', 'OGT', 'OEQ', 'OLT'], b.model('D_MAGCOMP', 4)),
    }),
  ),
  {
    pn: '4538',
    name: 'Dual precision retriggerable monostable multivibrator',
    vi: 'Hai mạch đơn ổn chính xác kích lại được',
    desc: 'Triggers on +TR rising (−TR high) or −TR falling (+TR low); retriggering restarts the pulse; ~CD low resets. tw = Rx · Cx per section (params; the timing pins are for wiring only).',
    descVi: 'Kích khi +TR lên (−TR cao) hoặc −TR xuống (+TR thấp); kích lại thì xung bắt đầu lại; ~CD thấp đặt lại. tw = Rx · Cx mỗi nửa (tham số; chân định thời chỉ để nối dây).',
    pins: 16,
    left: 'TRP1@+TR1:4 TRN1@−TR1:5 ~CD1:3 %CX1@Cx1:1 %RCX1@Rx/Cx1:2 | TRP2@+TR2:12 TRN2@−TR2:11 ~CD2:13 %CX2@Cx2:15 %RCX2@Rx/Cx2:14',
    right: 'Q1:6 Q1N@~Q1:7 | | | | Q2:10 Q2N@~Q2:9',
    fams: fams('4000 HC'),
    kind: 'monostable',
    delay: 4,
    params: [
      numParam('rx1', 'Timing resistor (section 1)', '100k', 'Ω', { min: 1, help: 'External timing resistance (the Rext/Cext pins are for wiring only; the pulse width is computed from this value)' }),
      numParam('cx1', 'Timing capacitor (section 1)', '10n', 'F', { min: 0 }),
      numParam('rx2', 'Timing resistor (section 2)', '100k', 'Ω', { min: 1, help: 'External timing resistance (the Rext/Cext pins are for wiring only; the pulse width is computed from this value)' }),
      numParam('cx2', 'Timing capacitor (section 2)', '10n', 'F', { min: 0 }),
    ],
    optional: ['CX1', 'RCX1', 'CX2', 'RCX2'],
    keywords: ['monostable', 'one-shot', 'retriggerable', 'timer'],
    build: (b) => {
      for (const k of [1, 2]) {
        const tw = Math.max(100e-9, b.ctx.num(`rx${k}`) * b.ctx.num(`cx${k}`));
        b.add(String(k), [`TRP${k}`, `TRN${k}`, `CD${k}`, `Q${k}`, `Q${k}N`], b.model('D_ONESHOT', 4, { mode: 4538, tw }));
      }
    },
  },
];

// ---------------------------------------------------------------------------------------------
// analog switches and multiplexers

/** RON of a switch / mux element of the family at its nominal supply. */
function ron(b: IcBuilder, fam: LogicFamily, k4000: number, hc: number): number {
  return fam === '4000' ? k4000 / b.levels.vnom : hc;
}

/** Voltage-controlled switches between pin pairs, each closed while its control node is high. */
function switches(b: IcBuilder, pairs: [string, string, string][], r: number): void {
  const vt = b.levels.vnom / 2;
  const m = swModel(`MS_ASW_${Math.round(r)}_${String(vt).replace(/[^0-9]/g, 'p')}`, vt, 0.05 * b.levels.vnom, r, 1e10);
  if (!b.models.some((c) => c.name === m.name)) b.models.push(m);
  pairs.forEach(([a, c, ctrl], i) => b.elements.push(elS(b.ctx.name('S', String(i + 1)), a, c, ctrl, '0', m.name)));
}

/** n-channel analog multiplexer: decoder of the address pins drives one switch per channel. */
function analogMux(b: IcBuilder, addr: string[], inh: string, groups: { com: string; ch: string[] }[], r: number): void {
  const nOut = 2 ** addr.length;
  const sel = Array.from({ length: nOut }, (_, k) => b.node(`s${k}`));
  b.addNodes('dec', [...addr.map((p) => b.n(p)), b.n(inh), ...sel], b.model('D_DECODER', 2, { n: addr.length, en_low: 1, out_low: 0 }));
  const pairs: [string, string, string][] = [];
  for (const g of groups) g.ch.forEach((c, k) => pairs.push([b.n(g.com), b.n(c), sel[k]]));
  switches(b, pairs, r);
}

const ANALOG: LogicSpec[] = [
  {
    pn: '4016',
    name: 'Quad bilateral analog switch',
    vi: 'Bốn công tắc tương tự hai chiều',
    desc: 'Each switch conducts between its two I/O pins while its control input is high (higher on-resistance than the 4066).',
    descVi: 'Mỗi công tắc dẫn giữa hai chân I/O khi chân điều khiển ở mức cao (điện trở dẫn lớn hơn 4066).',
    pins: 14,
    left: '1C@1CTRL:13 %1A@1_I/O:1 %1B@1_O/I:2 | 2C@2CTRL:5 %2A@2_I/O:4 %2B@2_O/I:3',
    right: '3C@3CTRL:6 %3A@3_I/O:8 %3B@3_O/I:9 | 4C@4CTRL:12 %4A@4_I/O:11 %4B@4_O/I:10',
    fams: fams('4000 HC'),
    kind: 'switch',
    output: 'analog',
    keywords: ['analog switch', 'bilateral', 'transmission gate'],
    build: (b, fam) => switches(b, [1, 2, 3, 4].map((k) => [b.n(`${k}A`), b.n(`${k}B`), b.n(`${k}C`)]), ron(b, fam, 5000, 50)),
  },
  {
    pn: '4066',
    name: 'Quad bilateral analog switch (low on-resistance)',
    vi: 'Bốn công tắc tương tự hai chiều (điện trở dẫn thấp)',
    desc: 'Each switch conducts between its two I/O pins while its control input is high.',
    descVi: 'Mỗi công tắc dẫn giữa hai chân I/O khi chân điều khiển ở mức cao.',
    pins: 14,
    left: '1C@1CTRL:13 %1A@1_I/O:1 %1B@1_O/I:2 | 2C@2CTRL:5 %2A@2_I/O:4 %2B@2_O/I:3',
    right: '3C@3CTRL:6 %3A@3_I/O:8 %3B@3_O/I:9 | 4C@4CTRL:12 %4A@4_I/O:11 %4B@4_O/I:10',
    fams: fams('HC HCT'),
    kind: 'switch',
    output: 'analog',
    keywords: ['analog switch', 'bilateral', 'transmission gate'],
    build: (b) => switches(b, [1, 2, 3, 4].map((k) => [b.n(`${k}A`), b.n(`${k}B`), b.n(`${k}C`)]), 40),
  },
  {
    pn: '4051',
    name: '8-channel analog multiplexer / demultiplexer',
    vi: 'Bộ dồn / phân kênh tương tự 8 kênh',
    desc: 'COM connects to the channel X0..X7 selected by C B A while INH is low (signals pass both ways); VEE allows negative analog signals.',
    descVi: 'COM nối với kênh X0..X7 được chọn bởi C B A khi INH thấp (tín hiệu đi được hai chiều); VEE cho phép tín hiệu tương tự âm.',
    pins: 16,
    left: `A:11 B:10 C:9 INH:6 | %VEE:7 | %COM@COM_X:3`,
    right: [13, 14, 15, 12, 1, 5, 2, 4].map((n, k) => `%X${k}:${n}`).join(' '),
    fams: fams('4000 HC HCT'),
    kind: 'switch',
    output: 'analog',
    optional: ['VEE'],
    keywords: ['analog multiplexer', 'mux', 'demultiplexer', '8 channel'],
    build: (b, fam) => analogMux(b, ['A', 'B', 'C'], 'INH', [{ com: 'COM', ch: names('X', 8) }], ron(b, fam, 2350, 90)),
  },
  {
    pn: '4052',
    name: 'Dual 4-channel analog multiplexer / demultiplexer',
    vi: 'Hai bộ dồn / phân kênh tương tự 4 kênh',
    desc: 'X and Y connect to channel X0..X3 / Y0..Y3 selected by B A while INH is low.',
    descVi: 'X và Y nối với kênh X0..X3 / Y0..Y3 được chọn bởi B A khi INH thấp.',
    pins: 16,
    left: 'A:10 B:9 INH:6 | %VEE:7 | %X:13 %Y:3',
    right: '%X0:12 %X1:14 %X2:15 %X3:11 | %Y0:1 %Y1:5 %Y2:2 %Y3:4',
    fams: fams('4000 HC HCT'),
    kind: 'switch',
    output: 'analog',
    optional: ['VEE'],
    keywords: ['analog multiplexer', 'mux', 'dual'],
    build: (b, fam) => analogMux(b, ['A', 'B'], 'INH', [{ com: 'X', ch: names('X', 4) }, { com: 'Y', ch: names('Y', 4) }], ron(b, fam, 2350, 90)),
  },
  {
    pn: '4053',
    name: 'Triple 2-channel analog multiplexer / demultiplexer',
    vi: 'Ba bộ dồn / phân kênh tương tự 2 kênh',
    desc: 'Each common X, Y, Z connects to its channel 0 or 1 chosen by A, B, C; INH high opens every switch.',
    descVi: 'Mỗi chân chung X, Y, Z nối với kênh 0 hoặc 1 do A, B, C chọn; INH cao mở mọi công tắc.',
    pins: 16,
    left: 'A:11 B:10 C:9 INH:6 | %VEE:7 | %X:14 %Y:15 %Z:4',
    right: '%X0:12 %X1:13 | %Y0:2 %Y1:1 | %Z0:5 %Z1:3',
    fams: fams('4000 HC HCT'),
    kind: 'switch',
    output: 'analog',
    optional: ['VEE'],
    keywords: ['analog multiplexer', 'spdt', 'switch'],
    build: (b, fam) => {
      const r = ron(b, fam, 2350, 90);
      ['X', 'Y', 'Z'].forEach((com, i) => {
        const sel = [b.node(`${com.toLowerCase()}0`), b.node(`${com.toLowerCase()}1`)];
        b.addNodes(`dec${com}`, [b.n(['A', 'B', 'C'][i]), b.n('INH'), ...sel], b.model('D_DECODER', 2, { n: 1, en_low: 1, out_low: 0 }));
        const vt = b.levels.vnom / 2;
        const m = swModel(`MS_ASW_${Math.round(r)}_${String(vt).replace(/[^0-9]/g, 'p')}`, vt, 0.05 * b.levels.vnom, r, 1e10);
        if (!b.models.some((c) => c.name === m.name)) b.models.push(m);
        [0, 1].forEach((k) => b.elements.push(elS(b.ctx.name('S', `${com}${k}`), b.n(com), b.n(`${com}${k}`), sel[k], '0', m.name)));
      });
    },
  },
  {
    pn: '4067',
    name: '16-channel analog multiplexer / demultiplexer',
    vi: 'Bộ dồn / phân kênh tương tự 16 kênh',
    desc: 'COM connects to the channel I0..I15 selected by D C B A while ~E (INH) is low.',
    descVi: 'COM nối với kênh I0..I15 được chọn bởi D C B A khi ~E (INH) thấp.',
    pins: 24,
    left: 'A:10 B:11 C:14 D:13 ~E:15 | %COM:1',
    right: names('I', 16).map((n, k) => `%${n}:${k <= 7 ? 9 - k : 31 - k}`).join(' '),
    fams: fams('4000 HC HCT'),
    kind: 'switch',
    output: 'analog',
    keywords: ['analog multiplexer', 'mux', '16 channel'],
    build: (b, fam) => analogMux(b, ['A', 'B', 'C', 'D'], 'E', [{ com: 'COM', ch: names('I', 16) }], ron(b, fam, 2350, 90)),
  },
  {
    pn: '4046',
    name: 'Phase-locked loop (PLL) with VCO',
    vi: 'Vòng khoá pha (PLL) có VCO',
    desc: 'PC1 = SIG XOR COMP; PC2 is an edge-sensitive phase-frequency detector with a 3-state output (PCP high while it is released, i.e. in lock); the VCO runs from fmin (VCOin = 0) to fmax (VCOin = supply), set by R1, C1, R2 (params); INH high stops the VCO; DEMout follows VCOin. Feed VCOout back to COMP (directly or through a divider) and filter PC2 into VCOin.',
    descVi: 'PC1 = SIG XOR COMP; PC2 là bộ so pha - tần kích sườn, ngõ ra ba trạng thái (PCP cao khi PC2 thả nổi, tức là đã khoá pha); VCO chạy từ fmin (VCOin = 0) đến fmax (VCOin = nguồn), đặt bằng R1, C1, R2 (tham số); INH cao dừng VCO; DEMout bám theo VCOin. Nối VCOout về COMP (trực tiếp hoặc qua bộ chia) và lọc PC2 đưa vào VCOin.',
    pins: 16,
    left: 'SIG@SIGin:14 COMP@COMPin:3 | VCOIN@VCOin:9 INH:5 | %C1A:6 %C1B:7 %R1:11 %R2:12',
    right: 'PC1@PC1out:2 PC2@PC2out:13 PCP@PCPout:1 | VCOOUT@VCOout:4 +DEMOUT@DEMout:10 | %ZENER:15',
    fams: fams('4000 HC HCT'),
    kind: 'pll',
    params: [
      numParam('r1', 'VCO resistor R1', '10k', 'Ω', { min: 1, showOnSchematic: true, help: 'Sets the VCO range: fmax ≈ 1 / (R1 (C1 + 32 pF)) + fmin (the R1 / C1 / R2 pins are for wiring only)' }),
      numParam('c1', 'VCO capacitor C1', '1n', 'F', { min: 1e-15, showOnSchematic: true }),
      numParam('r2', 'Offset resistor R2 (0 = none)', '0', 'Ω', { min: 0, help: 'Gives the VCO a minimum frequency fmin ≈ 1 / (R2 (C1 + 32 pF)); 0 = no offset (fmin = 0)' }),
    ],
    optional: ['C1A', 'C1B', 'R1', 'R2', 'ZENER', 'DEMOUT', 'INH'],
    keywords: ['pll', 'phase locked loop', 'vco', 'phase comparator', 'frequency synthesizer'],
    build: (b) => {
      const cc = b.ctx.num('c1') + 32e-12;
      const r2 = b.ctx.num('r2');
      const fmin = r2 > 0 ? 1 / (r2 * cc) : 0;
      const fmax = fmin + 1 / (b.ctx.num('r1') * cc);
      b.add('pc', ['SIG', 'COMP', 'PC1', 'PC2', 'PCP'], b.model('D_PHASE_DET', 1));
      b.add('vco', ['VCOIN', 'INH', 'VCOOUT'], b.model('D_VCO', 0, { has_inh: 1, fmin, fmax, va: 0, vb: b.levels.vnom, fa: fmin, fb: fmax }));
      // demodulator output: source follower of VCOin (ideal buffer behind 1 kΩ)
      b.elements.push(elE(b.ctx.name('E', 'dem'), b.node('dem'), '0', b.n('VCOIN'), '0', 1), elR(b.ctx.name('R', 'dem'), b.node('dem'), b.n('DEMOUT'), 1e3));
    },
  },
];

/** Every 4000-series (and HC 4000-number) device type of the catalogue. */
export const LOGIC4000_SPECS: LogicSpec[] = [...GATES, ...REGISTERS, ...COUNTERS, ...SHIFT, ...DECODERS, ...ANALOG];

export function logic4000Spec(pn: string): LogicSpec | undefined {
  return LOGIC4000_SPECS.find((s) => s.pn === pn);
}
