/**
 * Built-in example circuits 01–10 (File > Open samples; samples 11–45 are in sampleDesigns.ts).
 *
 * Every example is constructed here in code with {@link DesignBuilder}, so pin positions always
 * match the library symbols and the wiring is exact. The `.msim` files in `examples/` are the
 * serialised output of these builders; `tests/examples.test.ts` checks that both stay identical
 * (run it with MACHSIM_UPDATE_EXAMPLES=1 to rewrite the files after editing a builder).
 *
 * Layout conventions: 10-unit grid, signal flows left to right, supplies on top, ground at the
 * bottom. Net labels join distant points (labels with the same name are one net) to keep the
 * drawings free of crossing wires. Each example has a text note that explains what to look at.
 */
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';
import type { Design, Point } from '../../model/types';
import { DESIGN_EXAMPLES, type SampleTopic } from './examples';
import { SAMPLE_BUILDERS } from './sampleDesigns';

export interface ExampleInfo {
  /** file name in examples/ (also the id used by File > Open samples) */
  file: string;
  topic: SampleTopic;
  title: string;
  /** one-line summary, Vietnamese first */
  summary: string;
  build(): Design;
}

const p = (x: number, y: number): Point => ({ x, y });

/** Text note on the current sheet of a builder. */
function note(b: DesignBuilder, x: number, y: number, text: string, size = 11): void {
  b.sheet.notes.push({ id: `n${b.sheet.notes.length + 1}`, x, y, text, size });
}

function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): void {
  d.analysis = { active, specs: Object.fromEntries(specs.map((s) => [s.type, s])) };
}

/** Wire between two pins of parts (straight or one corner, horizontal first). */
function link(b: DesignBuilder, a: PartHandle, pa: string, c: PartHandle, pc: string): void {
  b.connect(a, pa, c, pc);
}

// ---------------------------------------------------------------------------
// 1. Voltage divider + multimeter
// ---------------------------------------------------------------------------

export function voltageDividerExample(): Design {
  const b = new DesignBuilder('Voltage divider + multimeter');
  const d = b.design;
  d.description =
    'Cầu phân áp: Vout = V1·R2/(R1+R2) = 12·4,7k/14,7k ≈ 3,84 V. Nhấn Run (F5) và mở đồng hồ vạn năng XMM1 (nhấp đúp). ' +
    'Voltage divider: Vout = V1·R2/(R1+R2) ≈ 3.84 V. Press Run (F5) and double-click XMM1 to read it.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 130, { value: '10k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 270, { value: '4.7k' }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 100, 330);
  const xmm = b.part('instruments/multimeter', 'XMM1', 400, 170, { mode: 'v' });
  b.wire(b.pin(v1, '+'), p(100, 100), b.pin(r1, '1'));
  link(b, r1, '2', r2, '1');
  b.wire(b.pin(r2, '2'), p(250, 330), p(100, 330));
  b.wire(b.pin(v1, '-'), p(100, 330));
  b.wire(p(250, 200), b.pin(xmm, '+'));
  b.wire(b.pin(xmm, '-'), p(410, 330), p(250, 330));
  b.label('OUT', 250, 200);
  note(b, 60, 400, 'Vout = 12 V × 4.7k / (10k + 4.7k) ≈ 3.84 V — đo bằng XMM1 (điện áp một chiều).');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 1e-4, tstop: 0.01 },
    { type: 'dc', src: 'V1', start: 0, stop: 12, step: 0.5 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 2. RC low-pass + function generator + oscilloscope + Bode plotter
// ---------------------------------------------------------------------------

export function rcLowPassExample(): Design {
  const b = new DesignBuilder('RC low-pass filter');
  const d = b.design;
  d.description =
    'Lọc thông thấp RC: fc = 1/(2π·R·C) = 1/(2π·1k·100n) ≈ 1,59 kHz. Máy phát XFG1 cấp sin 1 kHz; XSC1 so sánh vào/ra; XBP1 vẽ đáp ứng tần số. ' +
    'RC low-pass, fc ≈ 1.59 kHz: XFG1 drives a 1 kHz sine, XSC1 compares input and output, XBP1 plots the frequency response.';
  const xfg = b.part('instruments/function-generator', 'XFG1', 100, 100, { waveform: 'sine', freq: '1k', amplitude: '1', offset: '0' });
  b.part('sources/ground', 'GND1', 100, 150);
  const r1 = b.part('basic/resistor', 'R1', 230, 200, { value: '1k' });
  const c1 = b.part('basic/capacitor', 'C1', 330, 260, { value: '100n' }, { rotation: 90 });
  b.part('sources/ground', 'GND2', 330, 330);
  b.wire(b.pin(xfg, '+'), p(80, 200), b.pin(r1, '1'));
  b.wire(b.pin(xfg, 'COM'), p(100, 150));
  b.wire(b.pin(r1, '2'), p(330, 200), b.pin(c1, '1'));
  b.wire(b.pin(c1, '2'), p(330, 330));
  b.label('IN', 150, 200);
  b.label('OUT', 300, 200);
  const xsc = b.part('instruments/scope', 'XSC1', 560, 100, {
    timebase: '500u',
    'A.scale': '500m',
    'B.scale': '500m',
    'trig.source': 'A',
    'trig.level': '0',
  });
  b.labelPin(xsc, 'A+', 'IN');
  b.labelPin(xsc, 'B+', 'OUT');
  const xbp = b.part('instruments/bode-plotter', 'XBP1', 560, 260, { fstart: '10', fstop: '1M', points: '50', mmin: '-60', mmax: '10' });
  b.labelPin(xbp, 'IN+', 'IN');
  b.labelPin(xbp, 'OUT+', 'OUT');
  note(b, 60, 400, 'fc = 1/(2π·R1·C1) ≈ 1.59 kHz: tại fc biên độ ra giảm còn 0.707 (−3 dB), pha −45°.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 5e-6, tstop: 5e-3 },
    { type: 'ac', sweep: 'dec', points: 50, fstart: 10, fstop: 1e6 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 3. Half-wave and bridge rectifiers with filter capacitors
// ---------------------------------------------------------------------------

export function rectifierExample(): Design {
  const b = new DesignBuilder('Half-wave and bridge rectifiers');
  const d = b.design;
  d.description =
    'Chỉnh lưu nửa chu kỳ (D1) và cầu (D2) từ nguồn xoay chiều 10 V đỉnh, 50 Hz, lọc bằng tụ 100 µF, tải 1 kΩ. ' +
    'Gợn sóng cầu chỉnh lưu nhỏ hơn và có tần số 100 Hz. Half-wave (D1) and bridge (D2) rectifiers, 10 V peak 50 Hz, 100 µF filter, 1 kΩ load.';
  // half-wave
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 200, { amplitude: '10', freq: '50', acmag: '0' });
  const d1 = b.part('diodes/1n4007', 'D1', 200, 140);
  const c1 = b.part('basic/electrolytic', 'C1', 300, 220, { value: '100u' }, { rotation: 90 });
  const rl1 = b.part('basic/resistor', 'RL1', 400, 220, { value: '1k' }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 140), b.pin(d1, 'A'));
  b.wire(b.pin(d1, 'K'), p(400, 140), b.pin(rl1, '1'));
  b.wire(p(300, 140), b.pin(c1, '+'));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.wire(b.pin(rl1, '2'), p(400, 300), p(100, 300));
  b.wire(b.pin(c1, '-'), p(300, 300));
  b.label('HALF', 360, 140);
  // bridge
  const v2 = b.part('sources/ac-voltage', 'V2', 560, 220, { amplitude: '10', freq: '50', acmag: '0' });
  const br = b.part('diodes/bridge-rectifier', 'D2', 680, 220);
  const c2 = b.part('basic/electrolytic', 'C2', 820, 220, { value: '100u' }, { rotation: 90 });
  const rl2 = b.part('basic/resistor', 'RL2', 900, 220, { value: '1k' }, { rotation: 90 });
  b.part('sources/ground', 'GND2', 680, 300);
  b.part('sources/ground', 'GND3', 820, 300);
  b.part('sources/ground', 'GND4', 900, 300);
  // the AC lines reach the bridge from both sides; the return goes below the bridge's ground lead
  b.wire(b.pin(v2, '+'), p(560, 160), p(620, 160), p(620, 220), b.pin(br, 'AC1'));
  b.wire(b.pin(v2, '-'), p(560, 340), p(760, 340), p(760, 220), b.pin(br, 'AC2'));
  b.wire(b.pin(br, '+'), p(680, 150), p(900, 150), b.pin(rl2, '1'));
  b.wire(p(820, 150), b.pin(c2, '+'));
  b.wire(b.pin(br, '-'), p(680, 300));
  b.wire(b.pin(rl2, '2'), p(900, 300));
  b.wire(b.pin(c2, '-'), p(820, 300));
  b.label('BRIDGE', 860, 150);
  const xsc = b.part('instruments/scope', 'XSC1', 480, 420, {
    timebase: '10m',
    'A.scale': '5',
    'B.scale': '5',
    'trig.source': 'A',
    'trig.level': '5',
  });
  b.labelPin(xsc, 'A+', 'HALF');
  b.labelPin(xsc, 'B+', 'BRIDGE');
  note(b, 60, 540, 'Nửa chu kỳ: gợn ≈ Vp/(f·R·C) ≈ 1.8 V @ 50 Hz.  Cầu: gợn ≈ Vp/(2f·R·C) ≈ 0.8 V @ 100 Hz.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 1e-4, tstop: 0.2 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 4. BJT common-emitter amplifier
// ---------------------------------------------------------------------------

export function commonEmitterExample(): Design {
  const b = new DesignBuilder('BJT common-emitter amplifier');
  const d = b.design;
  d.description =
    'Khuếch đại E chung dùng 2N3904, phân cực cầu chia áp 47k/10k, RE = 100 Ω (không thoát) + 820 Ω (thoát bởi CE). ' +
    'Hệ số khuếch đại ≈ −(RC‖RL)/(re + RE1) ≈ −27. Common-emitter 2N3904 amplifier, gain ≈ −(RC‖RL)/(re + RE1) ≈ −27.';
  b.part('sources/vcc', 'VCC1', 300, 140, { voltage: '12' });
  b.part('sources/vcc', 'VCC2', 410, 140, { voltage: '12' });
  const r1 = b.part('basic/resistor', 'R1', 300, 200, { value: '47k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 300, 400, { value: '10k' }, { rotation: 90 });
  const rc = b.part('basic/resistor', 'RC', 410, 200, { value: '4.7k' }, { rotation: 90 });
  const q1 = b.part('transistors/2n3904', 'Q1', 400, 300);
  const re1 = b.part('basic/resistor', 'RE1', 410, 390, { value: '100' }, { rotation: 90 });
  const re2 = b.part('basic/resistor', 'RE2', 410, 490, { value: '820' }, { rotation: 90 });
  const ce = b.part('basic/electrolytic', 'CE', 480, 490, { value: '100u' }, { rotation: 90 });
  // mirrored so '+' faces the base (≈2.1 V DC) and '−' the generator (0 V DC)
  const cin = b.part('basic/electrolytic', 'CIN', 230, 300, { value: '10u' }, { mirror: true });
  const cout = b.part('basic/electrolytic', 'COUT', 520, 250, { value: '10u' });
  const rl = b.part('basic/resistor', 'RL', 600, 320, { value: '10k' }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 300, 560);
  const xfg = b.part('instruments/function-generator', 'XFG1', 120, 200, { waveform: 'sine', freq: '1k', amplitude: '50m' });
  b.part('sources/ground', 'GND2', 120, 250);
  // supplies
  b.wire(p(300, 140), b.pin(r1, '1'));
  b.wire(p(410, 140), b.pin(rc, '1'));
  // base bias network
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(cin, '+'), p(300, 300));
  b.wire(p(300, 300), b.pin(q1, 'B'));
  // collector, emitter
  b.wire(b.pin(rc, '2'), b.pin(q1, 'C'));
  b.wire(b.pin(q1, 'E'), b.pin(re1, '1'));
  b.wire(b.pin(re1, '2'), b.pin(re2, '1'));
  b.wire(p(410, 440), p(480, 440), b.pin(ce, '+'));
  // ground rail
  b.wire(b.pin(r2, '2'), p(300, 560));
  b.wire(p(300, 560), p(600, 560));
  b.wire(b.pin(re2, '2'), p(410, 560));
  b.wire(b.pin(ce, '-'), p(480, 560));
  // output coupling and load
  b.wire(p(410, 250), b.pin(cout, '+'));
  b.wire(b.pin(cout, '-'), p(600, 250), b.pin(rl, '1'));
  b.wire(b.pin(rl, '2'), p(600, 560));
  // input
  b.wire(b.pin(xfg, '+'), p(100, 300), b.pin(cin, '-'));
  b.wire(b.pin(xfg, 'COM'), p(120, 250));
  b.label('IN', 150, 300);
  b.label('OUT', 600, 270);
  const xsc = b.part('instruments/scope', 'XSC1', 760, 200, {
    timebase: '500u',
    'A.scale': '50m',
    'B.scale': '1',
    'trig.source': 'A',
    'trig.level': '0',
  });
  b.labelPin(xsc, 'A+', 'IN');
  b.labelPin(xsc, 'B+', 'OUT');
  note(b, 60, 610, 'IC ≈ (VB − 0.65)/(RE1+RE2) ≈ 1.5 mA, re = 26 mV/IE ≈ 17 Ω, Av ≈ −(4.7k‖10k)/(17 + 100) ≈ −27.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 5e-6, tstop: 5e-3 },
    { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e8 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 5. Op-amp inverting amplifier
// ---------------------------------------------------------------------------

export function invertingAmplifierExample(): Design {
  const b = new DesignBuilder('Op-amp inverting amplifier');
  const d = b.design;
  d.description =
    'Khuếch đại đảo dùng LM741 nguồn ±15 V: Av = −R2/R1 = −100k/10k = −10. Inverting LM741 amplifier on ±15 V, Av = −R2/R1 = −10.';
  const u1 = b.part('analog/lm741', 'U1', 400, 300);
  const r1 = b.part('basic/resistor', 'R1', 280, 290, { value: '10k' });
  const r2 = b.part('basic/resistor', 'R2', 400, 200, { value: '100k' });
  b.part('sources/vcc', 'VCC1', 400, 250, { voltage: '15' });
  b.part('sources/vee', 'VEE1', 400, 350, { voltage: '-15' });
  b.part('sources/ground', 'GND1', 330, 360);
  const xfg = b.part('instruments/function-generator', 'XFG1', 150, 200, { waveform: 'sine', freq: '1k', amplitude: '500m' });
  b.part('sources/ground', 'GND2', 150, 250);
  b.wire(b.pin(r1, '2'), b.pin(u1, 'IN-'));
  b.wire(p(340, 290), p(340, 200), b.pin(r2, '1'));
  b.wire(b.pin(u1, 'OUT'), p(520, 300));
  b.wire(b.pin(r2, '2'), p(470, 200), p(470, 300));
  b.wire(p(400, 250), b.pin(u1, 'V+'));
  b.wire(b.pin(u1, 'V-'), p(400, 350));
  b.wire(b.pin(u1, 'IN+'), p(330, 310), p(330, 360));
  b.wire(b.pin(xfg, '+'), p(130, 290), b.pin(r1, '1'));
  b.wire(b.pin(xfg, 'COM'), p(150, 250));
  b.label('IN', 200, 290);
  b.label('OUT', 520, 300);
  const xsc = b.part('instruments/scope', 'XSC1', 660, 200, {
    timebase: '500u',
    'A.scale': '500m',
    'B.scale': '5',
    'trig.source': 'A',
    'trig.level': '0',
  });
  b.labelPin(xsc, 'A+', 'IN');
  b.labelPin(xsc, 'B+', 'OUT');
  note(b, 60, 430, 'Av = −R2/R1 = −10: vào 0.5 V đỉnh → ra 5 V đỉnh, ngược pha 180°.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 5e-6, tstop: 5e-3 },
    { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e7 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 6. 555 astable blinking an LED
// ---------------------------------------------------------------------------

export function astable555Example(): Design {
  const b = new DesignBuilder('555 astable LED flasher');
  const d = b.design;
  d.description =
    'IC 555 dao động đa hài: f = 1,44/((R1+2·R2)·C1) = 1,44/(146k·10µ) ≈ 0,99 Hz — LED1 nhấp nháy khoảng 1 lần mỗi giây khi chạy mô phỏng. ' +
    '555 astable: f = 1.44/((R1+2R2)C1) ≈ 0.99 Hz, LED1 blinks about once per second while the simulation runs.';
  const u1 = b.part('analog/555', 'U1', 400, 300);
  b.part('sources/vcc', 'VCC1', 390, 160, { voltage: '9' });
  const r1 = b.part('basic/resistor', 'R1', 480, 220, { value: '10k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 480, 370, { value: '68k' }, { rotation: 90 });
  const c1 = b.part('basic/electrolytic', 'C1', 300, 550, { value: '10u' }, { rotation: 90 });
  const c2 = b.part('basic/capacitor', 'C2', 340, 390, { value: '10n' }, { rotation: 90 });
  const r3 = b.part('basic/resistor', 'R3', 620, 300, { value: '330' });
  const led = b.part('diodes/led-red', 'LED1', 650, 360, {}, { rotation: 90 });
  b.part('sources/ground', 'GND1', 400, 360);
  b.part('sources/ground', 'GND2', 340, 440);
  b.part('sources/ground', 'GND3', 300, 600);
  b.part('sources/ground', 'GND4', 650, 410);
  // supply rail
  b.wire(p(390, 160), p(480, 160));
  b.wire(b.pin(u1, 'RST'), p(390, 160));
  b.wire(b.pin(u1, 'VCC'), p(410, 160));
  b.wire(b.pin(r1, '1'), p(480, 160));
  // timing network
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(u1, 'DIS'), p(480, 310));
  b.wire(p(300, 280), b.pin(c1, '+'));
  b.wire(b.pin(u1, 'TRIG'), p(300, 280));
  b.wire(b.pin(u1, 'THR'), p(300, 300));
  b.wire(b.pin(r2, '2'), p(480, 500), p(300, 500));
  b.wire(b.pin(c1, '-'), p(300, 600));
  // control decoupling and ground
  b.wire(b.pin(u1, 'CTRL'), p(340, 320), b.pin(c2, '1'));
  b.wire(b.pin(c2, '2'), p(340, 440));
  b.wire(b.pin(u1, 'GND'), p(400, 360));
  // LED driver
  b.labelPin(u1, 'OUT', 'OUT');
  b.labelPin(r3, '1', 'OUT');
  b.wire(b.pin(r3, '2'), b.pin(led, 'A'));
  b.wire(b.pin(led, 'K'), p(650, 410));
  b.label('THR', 300, 400);
  const xsc = b.part('instruments/scope', 'XSC1', 740, 160, {
    timebase: '500m',
    'A.scale': '2',
    'B.scale': '5',
    'trig.source': 'B',
    'trig.level': '4',
  });
  b.labelPin(xsc, 'A+', 'THR');
  b.labelPin(xsc, 'B+', 'OUT');
  note(b, 60, 660, 'f = 1.44/((R1 + 2·R2)·C1) ≈ 0.99 Hz;  tH = 0.693(R1+R2)C1 ≈ 0.54 s, tL = 0.693·R2·C1 ≈ 0.47 s.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 1e-3, tstop: 4 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 7. CMOS inverter (voltage transfer characteristic)
// ---------------------------------------------------------------------------

export function cmosInverterExample(): Design {
  const b = new DesignBuilder('CMOS inverter');
  const d = b.design;
  d.description =
    'Cổng đảo CMOS gồm PMOS (trên) và NMOS (dưới) đối xứng, VDD = 5 V. Quét DC V1 từ 0 đến 5 V cho đặc tuyến truyền đạt; ngưỡng chuyển mạch ≈ VDD/2. ' +
    'Symmetric CMOS inverter, VDD = 5 V: the DC sweep of V1 gives the voltage transfer curve, switching threshold ≈ VDD/2.';
  b.part('sources/vdd', 'VDD1', 410, 150, { voltage: '5' });
  const mp = b.part('transistors/pmos', 'M1', 400, 200, {}, { rotation: 180, mirror: true });
  const mn = b.part('transistors/nmos', 'M2', 400, 320);
  const v1 = b.part('sources/dc-voltage', 'V1', 260, 320, { value: '2.5' });
  b.part('sources/ground', 'GND1', 260, 380);
  b.part('sources/ground', 'GND2', 410, 380);
  b.wire(p(410, 150), b.pin(mp, 'S'));
  b.wire(b.pin(mp, 'D'), b.pin(mn, 'D'));
  b.wire(b.pin(mp, 'G'), p(340, 200), p(340, 320), b.pin(mn, 'G'));
  b.wire(p(340, 260), p(260, 260), b.pin(v1, '+'));
  b.wire(b.pin(v1, '-'), p(260, 380));
  b.wire(b.pin(mn, 'S'), p(410, 380));
  b.wire(p(410, 260), p(480, 260));
  b.label('IN', 300, 260);
  b.label('OUT', 480, 260);
  b.probe('voltage', 300, 260, 'Vin');
  b.probe('voltage', 480, 260, 'Vout');
  note(b, 60, 450, 'Simulate > DC sweep (V1: 0 → 5 V): Vout chuyển từ 5 V xuống 0 V quanh Vin ≈ 2.5 V.');
  setAnalyses(d, 'dc', [
    { type: 'op' },
    { type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.01 },
    { type: 'tran', tstep: 1e-5, tstop: 1e-3 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 8. Decade counter with seven-segment display
// ---------------------------------------------------------------------------

const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export function decadeCounterExample(): Design {
  const b = new DesignBuilder('Decade counter with 7-segment display');
  const d = b.design;
  d.description =
    'Bộ đếm thập phân 7490 (QA nối CKB → đếm BCD 0–9) nhận xung 2 Hz, giải mã 7447 điều khiển LED 7 đoạn anode chung qua điện trở 330 Ω. ' +
    '7490 decade counter clocked at 2 Hz, 7447 decoder driving a common-anode 7-segment display through 330 Ω resistors.';
  const clk = b.part('sources/digital-clock', 'V1', 150, 240, { freq: '2', vhigh: '5' });
  const cnt = b.part('ttl/7490', 'U1', 300, 300);
  const dec = b.part('ttl/7447', 'U2', 500, 300);
  const disp = b.part('indicators/seven-seg-ca', 'U3', 820, 300);
  b.part('sources/vcc', 'VCC1', 820, 210, { voltage: '5' });
  b.part('sources/ground', 'GND1', 230, 380);
  // clock and counter
  b.wire(b.pin(clk, 'OUT'), b.pin(cnt, 'CKA'));
  b.label('CLK', 220, 240);
  b.labelPin(cnt, 'QA', 'QA');
  b.labelPin(cnt, 'CKB', 'QA');
  b.labelPin(cnt, 'QB', 'QB');
  b.labelPin(cnt, 'QC', 'QC');
  b.labelPin(cnt, 'QD', 'QD');
  b.wire(b.pin(cnt, 'R01'), p(230, 300), p(230, 380));
  b.wire(b.pin(cnt, 'R02'), p(230, 320));
  b.wire(b.pin(cnt, 'R91'), p(230, 340));
  b.wire(b.pin(cnt, 'R92'), p(230, 360));
  // decoder
  b.labelPin(dec, 'A', 'QA');
  b.labelPin(dec, 'B', 'QB');
  b.labelPin(dec, 'C', 'QC');
  b.labelPin(dec, 'D', 'QD');
  b.labelPin(dec, 'LT', 'VCC');
  b.labelPin(dec, 'RBI', 'VCC');
  b.labelPin(dec, 'BIRBO', 'VCC');
  // segment resistors 7447 SEGx -> 330 Ω -> display segment x
  SEGMENTS.forEach((s, i) => {
    const y = 230 + 20 * i;
    const r = b.part('basic/resistor', `R${i + 1}`, 630, y, { value: '330' });
    b.wire(b.pin(dec, `SEG${s}`), b.pin(r, '1'));
    b.labelPin(r, '2', `S${s}`);
    b.labelPin(disp, s.toLowerCase(), `S${s}`);
  });
  b.wire(p(820, 210), b.pin(disp, 'CA'));
  note(b, 60, 440, '7490: đếm sườn xuống của CKA; QA→CKB tạo mã BCD 0…9. 7447 giải mã BCD → 7 đoạn (mức thấp tích cực).');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 1e-3, tstop: 6 },
  ]);
  return d;
}


// ---------------------------------------------------------------------------
// 9. Character LCD driven by a pattern source (4-bit bus)
// ---------------------------------------------------------------------------

/** Pattern-source words that send bytes to an HD44780-style LCD in 4-bit mode: D3..D0 = data nibble, D4 = RS, D5 = E. */
export function lcdPatternWords(bytes: [number, number][], init = true): number[] {
  const words: number[] = [];
  const pulse = (rs: number, nibble: number) => words.push((nibble & 15) | (rs << 4) | 32, (nibble & 15) | (rs << 4));
  // the controller starts in 8-bit mode: one "function set, 4-bit" transfer on D7..D4
  if (init) pulse(0, 0x2);
  for (const [rs, b] of bytes) {
    pulse(rs, b >> 4);
    pulse(rs, b & 15);
  }
  return words;
}

export function lcdHelloExample(): Design {
  const b = new DesignBuilder('Character LCD: hello text');
  const d = b.design;
  d.description =
    'Nguồn mẫu (pattern source) gửi lệnh khởi động và chữ tới LCD 16x2 qua bus 4 bit: D0..D3 → D4..D7 của LCD, D4 → RS, D5 → E. Chạy mô phỏng để thấy chữ hiện trên màn hình. ' +
    'A pattern source sends the start-up instructions and text to a 16x2 LCD over a 4-bit bus: D0..D3 → LCD D4..D7, D4 → RS, D5 → E. Run the simulation to see the text on the screen.';
  const text = (str: string): [number, number][] => [...str].map((c) => [1, c.charCodeAt(0)]);
  const words = lcdPatternWords([[0, 0x28], [0, 0x0c], [0, 0x01], [0, 0x06], ...text('Xin chao!'), [0, 0xc0], ...text('MachSim LCD')]);
  const pattern = words.map((w) => w.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const src = b.part('misc-digital/pattern-source', 'U1', 160, 300, { pattern, period: '50u', repeat: 'false' });
  const lcd = b.part('indicators/lcd-16x2', 'LCD1', 620, 260);
  b.part('sources/vcc', 'VCC1', 380, 120, { voltage: '5' });
  const gnd = b.part('sources/ground', 'GND1', 380, 500);
  const rbl = b.part('basic/resistor', 'R1', 900, 160, { value: '100' });
  b.labelPin(gnd, '1', 'GND');
  ['D0', 'D1', 'D2', 'D3'].forEach((n, k) => {
    b.labelPin(src, n, `DB${k + 4}`);
    b.labelPin(lcd, `D${k + 4}`, `DB${k + 4}`);
  });
  b.labelPin(src, 'D4', 'RS');
  b.labelPin(lcd, 'RS', 'RS');
  b.labelPin(src, 'D5', 'E');
  b.labelPin(lcd, 'E', 'E');
  for (const pin of ['VSS', 'RW', 'V0', 'K']) b.labelPin(lcd, pin, 'GND');
  b.labelPin(lcd, 'VDD', 'VCC');
  b.labelPin(rbl, '1', 'VCC');
  b.labelPin(rbl, '2', 'BL');
  b.labelPin(lcd, 'A', 'BL');
  note(b, 60, 520, 'Mỗi lần gửi: đặt RS và 4 bit dữ liệu, đưa E lên rồi xuống (LCD chốt ở sườn xuống của E). Byte gửi nửa cao trước. Lệnh: 0x28 = 4 bit, 2 dòng; 0x0C = bật hiển thị; 0x01 = xoá; 0x06 = tự tăng địa chỉ; 0xC0 = đầu dòng 2.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 10e-6, tstop: (words.length + 4) * 50e-6 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// 10. Bench instruments: waveform generator, 6½-digit multimeter, storage and mixed-signal scopes
// ---------------------------------------------------------------------------

export function benchInstrumentsExample(): Design {
  const b = new DesignBuilder('Bench instruments');
  const d = b.design;
  d.description =
    'Máy phát sóng XAG1 (sin 1 kHz, 2 Vpp) cấp cho mạch lọc RC; dao động ký số XDS1 so sánh vào / ra và tự đo tần số, đỉnh-đỉnh, RMS; đồng hồ 6½ chữ số XDM1 đo điện áp AC ngõ ra kèm thống kê; dao động ký hỗn hợp XMS1 xem cùng lúc tín hiệu tương tự và hai đường logic (xung nhịp XAG2 và ngõ SYNC). ' +
    'Generator XAG1 (1 kHz sine, 2 Vpp) drives an RC filter; the storage scope XDS1 compares input and output and measures frequency, peak-to-peak and RMS; the 6½-digit multimeter XDM1 reads the AC output with statistics; the mixed-signal scope XMS1 shows analog signals and two logic lines (clock XAG2 and the SYNC output) together.';
  const g1 = b.part('instruments/bench-generator', 'XAG1', 160, 160, { waveform: 'sine', freq: '1k', amplitude: '2' });
  b.labelPin(g1, 'OUT', 'SIG');
  b.labelPin(g1, 'SYNC', 'SYNC');
  b.part('sources/ground', 'GND1', 160, 190);
  const r1 = b.part('basic/resistor', 'R1', 380, 140, { value: '1k' });
  const c1 = b.part('basic/capacitor', 'C1', 460, 200, { value: '100n' }, { rotation: 90 });
  b.part('sources/ground', 'GND2', 460, 230);
  b.labelPin(r1, '1', 'SIG');
  b.wire(b.pin(r1, '2'), { x: 460, y: 140 }, b.pin(c1, '1'));
  b.label('FILT', 440, 140);
  const g2 = b.part('instruments/bench-generator', 'XAG2', 160, 360, { waveform: 'square', freq: '2k', amplitude: '5', offset: '2.5' });
  b.labelPin(g2, 'OUT', 'CLK');
  b.part('sources/ground', 'GND3', 160, 390);
  const dso = b.part('instruments/bench-scope', 'XDS1', 720, 140, { timebase: '500u', 'A.scale': '500m', 'B.scale': '500m' });
  b.labelPin(dso, 'CH1', 'SIG');
  b.labelPin(dso, 'CH2', 'FILT');
  const dmm = b.part('instruments/bench-multimeter', 'XDM1', 720, 320, { function: 'acv', math: 'stats' });
  b.labelPin(dmm, 'HI', 'FILT');
  b.part('sources/ground', 'GND4', 720, 350);
  const mso = b.part('instruments/mixed-signal-scope', 'XMS1', 1020, 300, { timebase: '500u', 'A.scale': '1', 'B.scale': '2', 'trig.source': 'B', 'trig.level': '2.5' });
  b.labelPin(mso, 'CH1', 'FILT');
  b.labelPin(mso, 'CH2', 'CLK');
  b.labelPin(mso, 'D0', 'CLK');
  b.labelPin(mso, 'D1', 'SYNC');
  note(b, 60, 470, 'RC: fc = 1/(2π·1k·100n) ≈ 1,59 kHz → ở 1 kHz ra ≈ 0,85 × vào. Ngõ ra máy phát có 50 Ω nên đỉnh-đỉnh ở SIG hơi dưới 2 V khi có tải (giống máy thật). Thử: bấm “Tự động cài đặt”, chọn FFT, hoặc đổi “Tải” của XAG1 sang 50 Ω.');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: 5e-6, tstop: 10e-3 },
    { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e6 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

/** Builders of the example files (metadata in examples.ts, so the shell does not load these). */
const BUILDERS: Record<string, () => Design> = {
  '01-voltage-divider.msim': voltageDividerExample,
  '02-rc-lowpass.msim': rcLowPassExample,
  '03-rectifiers.msim': rectifierExample,
  '04-common-emitter.msim': commonEmitterExample,
  '05-inverting-amplifier.msim': invertingAmplifierExample,
  '06-555-led-flasher.msim': astable555Example,
  '07-cmos-inverter.msim': cmosInverterExample,
  '08-decade-counter.msim': decadeCounterExample,
  '09-lcd-hello.msim': lcdHelloExample,
  '10-bench-instruments.msim': benchInstrumentsExample,
};

export const EXAMPLES: readonly ExampleInfo[] = DESIGN_EXAMPLES.map((e) => ({ ...e, build: BUILDERS[e.file] ?? SAMPLE_BUILDERS[e.file] }));
