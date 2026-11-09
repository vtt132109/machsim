/**
 * Sample circuits 11–50 of File > Open samples (the first ten are in exampleDesigns.ts).
 *
 * Built in code with DesignBuilder like the first examples, so pin positions always match the
 * library symbols; the .msim files in examples/ are their serialised output (tests/examples.test.ts
 * keeps both identical, MACHSIM_UPDATE_EXAMPLES=1 rewrites them). Every sample is an original
 * circuit from textbook theory, passes ERC and runs its saved analyses; its note gives the
 * formula to check the result with. Titles are the canonical English names; the sample browser
 * shows the Vietnamese / English titles and descriptions of src/i18n/samples.ts.
 *
 * Conventions: 10-unit grid, sources on the left, ground rail at the bottom, net labels join
 * distant points (labels with the same name on a sheet are one net; "GND" is ground).
 */
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import { LADDER_SAMPLE_BUILDERS } from './ladderSamples';
import { ELECTRO_SAMPLE_BUILDERS } from './electroSamples';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';
import type { Design, Point } from '../../model/types';

const p = (x: number, y: number): Point => ({ x, y });

/** Note ids are unique in the whole design (every sheet). */
const noteCount = new WeakMap<DesignBuilder, number>();
function note(b: DesignBuilder, x: number, y: number, text: string, size = 11): void {
  const n = (noteCount.get(b) ?? 0) + 1;
  noteCount.set(b, n);
  b.sheet.notes.push({ id: `n${n}`, x, y, text, size });
}

function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): void {
  d.analysis = { active, specs: Object.fromEntries(specs.map((s) => [s.type, s])) };
}

/** Ground symbol counter per builder. */
const grounds = new WeakMap<DesignBuilder, number>();
function gnd(b: DesignBuilder, x: number, y: number): PartHandle {
  const n = (grounds.get(b) ?? 0) + 1;
  grounds.set(b, n);
  return b.part('sources/ground', `GND${n}`, x, y);
}

/** Two-channel oscilloscope with channel A / B on the named nets. */
function scope(b: DesignBuilder, x: number, y: number, a: string, bNet: string | null, settings: Record<string, string>): PartHandle {
  const xsc = b.part('instruments/scope', 'XSC1', x, y, { 'trig.source': 'A', 'trig.level': '0', ...settings });
  b.labelPin(xsc, 'A+', a);
  if (bNet) b.labelPin(xsc, 'B+', bNet);
  return xsc;
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export function ohmsLawSample(): Design {
  const b = new DesignBuilder("Ohm's law");
  const d = b.design;
  d.description = 'Định luật Ohm: I = U/R = 9 V / 1 kΩ = 9 mA. Ampe kế mắc nối tiếp, vôn kế mắc song song. ' + "Ohm's law: I = V/R = 9 V / 1 kΩ = 9 mA. The ammeter is in series, the voltmeter in parallel.";
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '9' });
  const am = b.part('indicators/ammeter', 'U1', 200, 120);
  const r1 = b.part('basic/resistor', 'R1', 300, 200, { value: '1k' }, { rotation: 90 });
  const vm = b.part('indicators/voltmeter', 'U2', 400, 200, {}, { rotation: 90 });
  gnd(b, 100, 280);
  b.wire(b.pin(v1, '+'), p(100, 120), b.pin(am, '+'));
  b.wire(b.pin(am, '-'), p(300, 120), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 280), p(100, 280));
  b.wire(b.pin(v1, '-'), p(100, 280));
  b.wire(b.pin(vm, '+'), p(400, 120), p(300, 120));
  b.wire(b.pin(vm, '-'), p(400, 280), p(300, 280));
  note(b, 60, 340, 'I = U / R = 9 V / 1 kΩ = 9 mA. Đổi R1 thành 2k rồi chạy lại: dòng giảm một nửa.');
  setAnalyses(d, 'op', [{ type: 'op' }, { type: 'dc', src: 'V1', start: 0, stop: 12, step: 0.5 }]);
  return d;
}

export function seriesParallelSample(): Design {
  const b = new DesignBuilder('Series and parallel resistors');
  const d = b.design;
  d.description = 'R1 nối tiếp với (R2 ‖ R3): R = 1k + 2k‖2k = 2 kΩ, I = 6 mA, V(MID) = 6 V. ' + 'R1 in series with (R2 ‖ R3): R = 1k + 2k‖2k = 2 kΩ, I = 6 mA, V(MID) = 6 V.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 200, 150, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 300, 220, { value: '2k' }, { rotation: 90 });
  const r3 = b.part('basic/resistor', 'R3', 380, 220, { value: '2k' }, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 150), b.pin(r2, '1'));
  b.wire(p(300, 150), p(380, 150), b.pin(r3, '1'));
  b.wire(b.pin(r2, '2'), p(300, 300), p(100, 300));
  b.wire(b.pin(r3, '2'), p(380, 300), p(300, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.label('MID', 260, 150);
  const xmm = b.part('instruments/multimeter', 'XMM1', 500, 200, { mode: 'v' });
  b.labelPin(xmm, '+', 'MID');
  b.labelPin(xmm, '-', 'GND');
  note(b, 60, 360, 'R2 ‖ R3 = (2k · 2k)/(2k + 2k) = 1 kΩ → R = 2 kΩ; I = 12 V / 2 kΩ = 6 mA; V(MID) = 6 mA · 1 kΩ = 6 V.');
  setAnalyses(d, 'op', [{ type: 'op' }]);
  return d;
}

export function rcChargingSample(): Design {
  const b = new DesignBuilder('RC charging and discharging');
  const d = b.design;
  d.description = 'Tụ C1 nạp qua R1 khi nguồn xung lên 5 V và xả khi về 0 V; hằng số thời gian τ = R·C = 10k · 10 µF = 0,1 s. ' + 'C1 charges through R1 when the pulse goes to 5 V and discharges when it returns to 0 V; τ = R·C = 0.1 s.';
  const v1 = b.part('sources/pulse-voltage', 'V1', 100, 220, { v1: '0', v2: '5', delay: '0', rise: '1u', fall: '1u', width: '0.5', period: '1' });
  const r1 = b.part('basic/resistor', 'R1', 200, 150, { value: '10k' });
  const c1 = b.part('basic/capacitor', 'C1', 300, 220, { value: '10u' }, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 150), b.pin(c1, '1'));
  b.wire(b.pin(c1, '2'), p(300, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.label('IN', 140, 150);
  b.label('VC', 270, 150);
  b.probe('voltage', 270, 150, 'Vc');
  scope(b, 480, 150, 'IN', 'VC', { timebase: '100m', 'A.scale': '2', 'B.scale': '2', 'trig.level': '2.5' });
  note(b, 60, 360, 'Sau τ = 0,1 s tụ đạt 63 % (3,16 V); sau 5τ = 0,5 s gần như đầy (99 %).');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 2 }]);
  return d;
}

export function rlcResonanceSample(): Design {
  const b = new DesignBuilder('Series RLC resonance');
  const d = b.design;
  d.description = 'Mạch RLC nối tiếp cộng hưởng tại f0 = 1/(2π√(LC)) ≈ 1,59 kHz; điện áp trên R lớn nhất tại f0, Q = (1/R)·√(L/C) = 10. ' + 'Series RLC resonating at f0 = 1/(2π√(LC)) ≈ 1.59 kHz; the voltage across R peaks at f0, Q = 10.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1.59k', acmag: '1' });
  const l1 = b.part('basic/inductor', 'L1', 200, 150, { value: '10m' });
  const c1 = b.part('basic/capacitor', 'C1', 300, 150, { value: '1u' });
  const r1 = b.part('basic/resistor', 'R1', 400, 220, { value: '10' }, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(l1, '1'));
  b.wire(b.pin(l1, '2'), b.pin(c1, '1'));
  b.wire(b.pin(c1, '2'), p(400, 150), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(400, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.label('IN', 100, 170);
  b.label('OUT', 370, 150);
  const xbp = b.part('instruments/bode-plotter', 'XBP1', 560, 200, { fstart: '100', fstop: '100k', points: '100', mmin: '-40', mmax: '5' });
  b.labelPin(xbp, 'IN+', 'IN');
  b.labelPin(xbp, 'OUT+', 'OUT');
  note(b, 60, 360, 'f0 = 1/(2π·√(10 mH · 1 µF)) ≈ 1,59 kHz; băng thông = f0/Q ≈ 159 Hz. Mở máy vẽ Bode XBP1 hoặc chạy phân tích AC.');
  setAnalyses(d, 'ac', [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 100, fstart: 100, fstop: 1e5 }, { type: 'tran', tstep: 5e-6, tstop: 1e-2 }]);
  return d;
}

export function wheatstoneSample(): Design {
  const b = new DesignBuilder('Wheatstone bridge');
  const d = b.design;
  d.description = 'Cầu Wheatstone: khi R1/R2 = R3/R4 cầu cân bằng (0 V). Với R4 = 1,2k: V(A,B) = 10·(1,2/2,2 − 0,5) ≈ −0,455 V. ' + 'Wheatstone bridge: balanced (0 V) when R1/R2 = R3/R4; with R4 = 1.2k, V(A,B) ≈ −0.455 V.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 250, { value: '10' });
  const r1 = b.part('basic/resistor', 'R1', 250, 200, { value: '1k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 300, { value: '1k' }, { rotation: 90 });
  const r3 = b.part('basic/resistor', 'R3', 400, 200, { value: '1k' }, { rotation: 90 });
  const r4 = b.part('basic/resistor', 'R4', 400, 300, { value: '1.2k' }, { rotation: 90 });
  const vm = b.part('indicators/voltmeter', 'U1', 325, 250);
  gnd(b, 100, 350);
  b.wire(b.pin(v1, '+'), p(100, 150), p(250, 150), b.pin(r1, '1'));
  b.wire(p(250, 150), p(400, 150), b.pin(r3, '1'));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(r3, '2'), b.pin(r4, '1'));
  b.wire(b.pin(r2, '2'), p(250, 350), p(100, 350));
  b.wire(b.pin(r4, '2'), p(400, 350), p(250, 350));
  b.wire(b.pin(v1, '-'), p(100, 350));
  b.wire(p(250, 250), b.pin(vm, '+'));
  b.wire(b.pin(vm, '-'), p(400, 250));
  b.label('A', 250, 250);
  b.label('B', 400, 250);
  note(b, 60, 410, 'Thử đổi R4 thành 1k: vôn kế U1 chỉ 0 V (cầu cân bằng). Cầu dùng để đo điện trở chưa biết chính xác.');
  setAnalyses(d, 'op', [{ type: 'op' }, { type: 'paramsweep', target: 'R4', param: 'value', values: [800, 1000, 1200], base: { type: 'op' } }]);
  return d;
}

// ---------------------------------------------------------------------------
// Semiconductors
// ---------------------------------------------------------------------------

export function diodeIvSample(): Design {
  const b = new DesignBuilder('Diode I-V characteristic');
  const d = b.design;
  d.description = 'Đặc tuyến V–A của diode 1N4148: quét DC nguồn V1 từ 0 đến 5 V qua điện trở 100 Ω; dòng tăng rất nhanh khi điện áp thuận vượt ≈ 0,6 V. ' + 'I-V curve of a 1N4148: a DC sweep of V1 from 0 to 5 V through 100 Ω; the current rises steeply above ≈ 0.6 V forward voltage.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '5' });
  const r1 = b.part('basic/resistor', 'R1', 200, 150, { value: '100' });
  const d1 = b.part('diodes/1n4148', 'D1', 300, 220, {}, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 150), b.pin(d1, 'A'));
  b.wire(b.pin(d1, 'K'), p(300, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.label('ANODE', 260, 150);
  b.probe('voltage', 260, 150, 'Vd');
  b.probe('current', 300, 170, 'Id');
  note(b, 60, 360, 'Quét DC: V(ANODE) gần như đứng yên ở 0,6…0,8 V trong khi dòng Id tăng; I ≈ (V1 − Vd)/100 Ω.');
  setAnalyses(d, 'dc', [{ type: 'op' }, { type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.02 }]);
  return d;
}

export function zenerRegulatorSample(): Design {
  const b = new DesignBuilder('Zener voltage regulator');
  const d = b.design;
  d.description = 'Ổn áp Zener 5,1 V: khi V1 lớn hơn khoảng 7,5 V, điện áp ra giữ gần 5,1 V; R1 hạn dòng. Quét DC V1 từ 0 đến 15 V. ' + '5.1 V Zener regulator: above about 7.5 V input the output stays near 5.1 V; R1 limits the current. DC sweep of V1 from 0 to 15 V.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 200, 150, { value: '470' });
  const dz = b.part('diodes/zener', 'D1', 300, 220, { vz: '5.1' }, { rotation: 270 });
  const rl = b.part('basic/resistor', 'RL', 400, 220, { value: '1k' }, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 150), b.pin(dz, 'K'));
  b.wire(p(300, 150), p(400, 150), b.pin(rl, '1'));
  b.wire(b.pin(dz, 'A'), p(300, 300), p(100, 300));
  b.wire(b.pin(rl, '2'), p(400, 300), p(300, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.label('IN', 100, 170);
  b.label('OUT', 350, 150);
  note(b, 60, 360, 'Dòng qua R1 = (V1 − 5,1 V)/470 Ω; tải RL lấy 5,1 mA, phần còn lại chảy qua Zener.');
  setAnalyses(d, 'dc', [{ type: 'op' }, { type: 'dc', src: 'V1', start: 0, stop: 15, step: 0.05 }]);
  return d;
}

export function ledResistorSample(): Design {
  const b = new DesignBuilder('LED with series resistor');
  const d = b.design;
  d.description = 'LED đỏ cần điện trở hạn dòng: I = (5 V − ≈1,9 V)/220 Ω ≈ 14 mA. Nhấn Chạy (F5): LED sáng, ampe kế chỉ dòng. ' + 'A red LED needs a series resistor: I = (5 V − ≈1.9 V)/220 Ω ≈ 14 mA. Press Run (F5): the LED lights and the ammeter reads the current.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '5' });
  const am = b.part('indicators/ammeter', 'U1', 200, 150);
  const r1 = b.part('basic/resistor', 'R1', 320, 150, { value: '220' });
  const led = b.part('diodes/led-red', 'LED1', 400, 220, {}, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(am, '+'));
  b.wire(b.pin(am, '-'), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(400, 150), b.pin(led, 'A'));
  b.wire(b.pin(led, 'K'), p(400, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  note(b, 60, 360, 'Thử R1 = 1k: dòng còn ≈ 3 mA, LED mờ hơn. R1 quá nhỏ (ví dụ 10 Ω) sẽ làm LED quá dòng.');
  setAnalyses(d, 'op', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 1e-2 }]);
  return d;
}

export function bjtSwitchSample(): Design {
  const b = new DesignBuilder('BJT switch driving an LED');
  const d = b.design;
  d.description = 'Transistor 2N3904 làm khoá: xung 0/5 V qua RB = 10k vào cực gốc; khi có dòng gốc, transistor bão hoà và LED ở cực góp sáng. ' + 'A 2N3904 as a switch: a 0/5 V pulse through RB = 10k drives the base; with base current the transistor saturates and the collector LED lights.';
  const v1 = b.part('sources/pulse-voltage', 'V1', 100, 350, { v1: '0', v2: '5', delay: '0', rise: '1u', fall: '1u', width: '0.5', period: '1' });
  const rb = b.part('basic/resistor', 'RB', 200, 300, { value: '10k' });
  const q1 = b.part('transistors/2n3904', 'Q1', 300, 300);
  const led = b.part('diodes/led-red', 'LED1', 310, 220, {}, { rotation: 90 });
  const rc = b.part('basic/resistor', 'RC', 310, 130, { value: '470' }, { rotation: 90 });
  b.part('sources/vcc', 'VCC1', 310, 60, { voltage: '9' });
  gnd(b, 100, 400);
  b.wire(b.pin(v1, '+'), p(100, 300), b.pin(rb, '1'));
  b.wire(b.pin(rb, '2'), b.pin(q1, 'B'));
  b.wire(b.pin(led, 'K'), b.pin(q1, 'C'));
  b.wire(b.pin(rc, '2'), b.pin(led, 'A'));
  b.wire(p(310, 60), b.pin(rc, '1'));
  b.wire(b.pin(q1, 'E'), p(310, 400), p(100, 400));
  b.wire(b.pin(v1, '-'), p(100, 400));
  b.label('IN', 140, 300);
  b.label('OUT', 310, 260);
  scope(b, 520, 250, 'IN', 'OUT', { timebase: '500m', 'A.scale': '5', 'B.scale': '5', 'trig.level': '2.5' });
  note(b, 60, 460, 'IB ≈ (5 − 0,7)/10k = 0,43 mA; IC ≈ (9 − 1,9 − 0,1)/470 ≈ 15 mA < hFE·IB nên transistor bão hoà, V(OUT) ≈ 0,1 V.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 3 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Op-amps
// ---------------------------------------------------------------------------

/** LM741 at (400, 300) on ±15 V with a feedback part across IN− / OUT at y = 200. */
function opampStage(b: DesignBuilder, feedback: PartHandle, extra?: PartHandle): PartHandle {
  const u1 = b.part('analog/lm741', 'U1', 400, 300);
  b.part('sources/vcc', 'VCC1', 400, 250, { voltage: '15' });
  b.part('sources/vee', 'VEE1', 400, 350, { voltage: '-15' });
  b.wire(p(400, 250), b.pin(u1, 'V+'));
  b.wire(b.pin(u1, 'V-'), p(400, 350));
  const top = b.pin(feedback, '1').y;
  b.wire(b.pin(u1, 'IN-'), p(340, 290), p(340, top), b.pin(feedback, '1'));
  b.wire(b.pin(feedback, '2'), p(470, top), p(470, 300));
  if (extra) {
    const y = b.pin(extra, '1').y;
    b.wire(p(340, y), b.pin(extra, '1'));
    b.wire(b.pin(extra, '2'), p(470, y));
  }
  b.wire(b.pin(u1, 'OUT'), p(520, 300));
  b.label('OUT', 520, 300);
  return u1;
}

export function nonInvertingSample(): Design {
  const b = new DesignBuilder('Op-amp non-inverting amplifier');
  const d = b.design;
  d.description = 'Khuếch đại không đảo: Av = 1 + Rf/Rg = 1 + 90k/10k = 10, cùng pha với đầu vào. ' + 'Non-inverting amplifier: Av = 1 + Rf/Rg = 10, in phase with the input.';
  const rf = b.part('basic/resistor', 'RF', 400, 200, { value: '90k' });
  const u1 = opampStage(b, rf);
  const rg = b.part('basic/resistor', 'RG', 320, 340, { value: '10k' }, { rotation: 90 });
  b.wire(b.pin(rg, '1'), p(320, 290), p(340, 290));
  b.wire(b.pin(rg, '2'), p(320, 400));
  gnd(b, 320, 400);
  b.labelPin(u1, 'IN+', 'IN');
  const xfg = b.part('instruments/function-generator', 'XFG1', 150, 300, { waveform: 'sine', freq: '1k', amplitude: '100m' });
  b.labelPin(xfg, '+', 'IN');
  b.wire(b.pin(xfg, 'COM'), p(150, 360));
  gnd(b, 150, 360);
  scope(b, 660, 250, 'IN', 'OUT', { timebase: '500u', 'A.scale': '100m', 'B.scale': '1' });
  note(b, 60, 460, 'Av = 1 + RF/RG = 10: vào 0,1 V đỉnh → ra 1 V đỉnh, cùng pha. Trở kháng vào rất lớn.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-6, tstop: 5e-3 }, { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e7 }]);
  return d;
}

export function summingAmpSample(): Design {
  const b = new DesignBuilder('Op-amp summing amplifier');
  const d = b.design;
  d.description = 'Mạch cộng đảo: Vout = −RF·(V1/R1 + V2/R2) = −(1 V + 2 V) = −3 V với mọi điện trở 10 kΩ. ' + 'Inverting summer: Vout = −RF·(V1/R1 + V2/R2) = −3 V with all resistors 10 kΩ.';
  const rf = b.part('basic/resistor', 'RF', 400, 200, { value: '10k' });
  const u1 = opampStage(b, rf);
  b.wire(b.pin(u1, 'IN+'), p(330, 310), p(330, 370));
  gnd(b, 330, 370);
  const r1 = b.part('basic/resistor', 'R1', 270, 290, { value: '10k' });
  const r2 = b.part('basic/resistor', 'R2', 270, 240, { value: '10k' });
  b.wire(b.pin(r1, '2'), p(340, 290));
  b.wire(b.pin(r2, '2'), p(340, 240));
  const v1 = b.part('sources/dc-voltage', 'V1', 150, 330, { value: '1' });
  const v2 = b.part('sources/dc-voltage', 'V2', 100, 280, { value: '2' });
  b.wire(b.pin(v1, '+'), p(150, 290), b.pin(r1, '1'));
  b.wire(b.pin(v2, '+'), p(100, 240), b.pin(r2, '1'));
  b.wire(b.pin(v1, '-'), p(150, 400));
  b.wire(b.pin(v2, '-'), p(100, 400), p(150, 400));
  gnd(b, 150, 400);
  const xmm = b.part('instruments/multimeter', 'XMM1', 600, 330, { mode: 'v' });
  b.labelPin(xmm, '+', 'OUT');
  b.labelPin(xmm, '-', 'GND');
  note(b, 60, 460, 'Nút IN− là “đất ảo” (0 V): dòng V1/R1 + V2/R2 = 0,3 mA chảy hết qua RF → Vout = −0,3 mA · 10k = −3 V.');
  setAnalyses(d, 'op', [{ type: 'op' }, { type: 'dc', src: 'V1', start: -5, stop: 5, step: 0.1 }]);
  return d;
}

export function integratorSample(): Design {
  const b = new DesignBuilder('Op-amp integrator');
  const d = b.design;
  d.description = 'Mạch tích phân: sóng vuông ±1 V, 1 kHz vào R = 10k, tụ C = 100 nF ở nhánh hồi tiếp → ra sóng tam giác 0,5 V đỉnh-đỉnh. RP = 1 MΩ giữ điểm làm việc DC. ' + 'Integrator: a ±1 V, 1 kHz square wave into R = 10k with C = 100 nF feedback gives a 0.5 Vpp triangle; RP = 1 MΩ keeps the DC operating point.';
  const rp = b.part('basic/resistor', 'RP', 400, 150, { value: '1Meg' });
  const c1 = b.part('basic/capacitor', 'C1', 400, 200, { value: '100n' });
  const u1 = opampStage(b, rp, c1);
  const r1 = b.part('basic/resistor', 'R1', 290, 290, { value: '10k' });
  b.wire(b.pin(r1, '2'), p(340, 290));
  b.wire(b.pin(u1, 'IN+'), p(360, 340));
  b.part('sources/ground', 'GND1', 360, 340);
  const v1 = b.part('sources/pulse-voltage', 'V1', 200, 330, { v1: '-1', v2: '1', delay: '0', rise: '1u', fall: '1u', width: '0.5m', period: '1m' });
  b.wire(b.pin(v1, '+'), p(200, 290), b.pin(r1, '1'));
  b.wire(b.pin(v1, '-'), p(200, 390));
  b.part('sources/ground', 'GND2', 200, 390);
  b.label('IN', 230, 290);
  scope(b, 660, 250, 'IN', 'OUT', { timebase: '500u', 'A.scale': '1', 'B.scale': '200m' });
  note(b, 60, 460, 'Độ dốc ra = −Vin/(R·C) = ∓1 V/ms; mỗi nửa chu kỳ 0,5 ms → biên độ đỉnh-đỉnh 0,5 V. Quá độ bắt đầu từ tụ chưa nạp (điều kiện đầu = 0).');
  // start from an empty capacitor: the DC operating point of an integrator with a −1 V input saturates
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-6, tstop: 1e-2, uic: true }]);
  d.interactive = { initial: 'zero' };
  return d;
}

export function schmittTriggerSample(): Design {
  const b = new DesignBuilder('Comparator with hysteresis (Schmitt trigger)');
  const d = b.design;
  d.description = 'Bộ so sánh có trễ: hồi tiếp dương R1/R2 tạo hai ngưỡng ±Vsat·R2/(R1+R2) ≈ ±1,7 V, nên nhiễu nhỏ quanh 0 V không làm đầu ra rung. ' + 'Comparator with hysteresis: positive feedback R1/R2 sets two thresholds ±Vsat·R2/(R1+R2) ≈ ±1.7 V, so small noise near 0 V does not make the output chatter.';
  const u1 = b.part('analog/comparator', 'U1', 400, 300);
  b.part('sources/vcc', 'VCC1', 400, 250, { voltage: '5' });
  b.part('sources/vee', 'VEE1', 400, 350, { voltage: '-5' });
  b.wire(p(400, 250), b.pin(u1, 'V+'));
  b.wire(b.pin(u1, 'V-'), p(400, 350));
  const r1 = b.part('basic/resistor', 'R1', 400, 200, { value: '20k' });
  b.wire(b.pin(u1, 'IN+'), p(330, 290), p(330, 200), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(470, 200), p(470, 300));
  b.wire(b.pin(u1, 'OUT'), p(520, 300));
  b.label('OUT', 520, 300);
  const r2 = b.part('basic/resistor', 'R2', 300, 320, { value: '10k' }, { rotation: 90 });
  b.wire(b.pin(r2, '1'), p(330, 290));
  b.wire(b.pin(r2, '2'), p(300, 380));
  gnd(b, 300, 380);
  b.labelPin(u1, 'IN-', 'IN');
  const v1 = b.part('sources/ac-voltage', 'V1', 150, 330, { amplitude: '3', freq: '100', acmag: '0' });
  b.labelPin(v1, '+', 'IN');
  b.wire(b.pin(v1, '-'), p(150, 390));
  gnd(b, 150, 390);
  scope(b, 660, 250, 'IN', 'OUT', { timebase: '5m', 'A.scale': '2', 'B.scale': '5' });
  note(b, 60, 460, 'Đầu ra chỉ đổi trạng thái khi đầu vào vượt +1,7 V (xuống −5 V) hoặc dưới −1,7 V (lên +5 V): đó là vòng trễ.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 3e-2 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Digital
// ---------------------------------------------------------------------------

export function logicGatesSample(): Design {
  const b = new DesignBuilder('Basic logic gates');
  const d = b.design;
  d.description = 'Hai công tắc logic A, B (phím A, B) điều khiển cổng AND, OR, XOR; đèn cho biết đầu ra 1 hay 0. Nhấn Chạy rồi bấm phím A / B. ' + 'Two logic switches A and B (keys A, B) drive AND, OR and XOR gates; the lights show whether each output is 1 or 0. Press Run, then the A / B keys.';
  const s1 = b.part('sources/logic-switch', 'S1', 100, 150, { state: 'true', key: 'A' });
  const s2 = b.part('sources/logic-switch', 'S2', 100, 300, { state: 'false', key: 'B' });
  b.labelPin(s1, 'OUT', 'A');
  b.labelPin(s2, 'OUT', 'B');
  const gates: [string, string, number][] = [
    ['misc-digital/and2', 'U1', 150],
    ['misc-digital/or2', 'U2', 250],
    ['misc-digital/xor2', 'U3', 350],
  ];
  gates.forEach(([id, ref, y], i) => {
    const g = b.part(id, ref, 300, y);
    b.labelPin(g, 'A', 'A');
    b.labelPin(g, 'B', 'B');
    const x = b.part('indicators/probe-red', `X${i + 1}`, 400, y);
    b.wire(b.pin(g, 'Y'), b.pin(x, '1'));
  });
  note(b, 60, 430, 'AND: 1 khi cả A và B là 1. OR: 1 khi ít nhất một đầu vào là 1. XOR: 1 khi A khác B.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-6, tstop: 1e-3 }]);
  return d;
}

export function flipflopDividerSample(): Design {
  const b = new DesignBuilder('Flip-flop frequency divider');
  const d = b.design;
  d.description = 'Hai flip-flop T nối tiếp chia tần số xung nhịp 1 kHz thành 500 Hz và 250 Hz (bộ đếm nhị phân 2 bit); xem trên máy phân tích logic XLA1. ' + 'Two T flip-flops in a row divide a 1 kHz clock into 500 Hz and 250 Hz (a 2-bit binary counter); see the logic analyzer XLA1.';
  const clk = b.part('sources/digital-clock', 'V1', 100, 200, { freq: '1k', vhigh: '5' });
  const hi = b.part('sources/logic-high', 'V2', 100, 100, { vhigh: '5' });
  b.labelPin(clk, 'OUT', 'CLK');
  b.labelPin(hi, 'OUT', 'H');
  const ff1 = b.part('misc-digital/tff', 'U1', 300, 200);
  const ff2 = b.part('misc-digital/tff', 'U2', 500, 200);
  for (const [ff, clock, q] of [[ff1, 'CLK', 'Q1'], [ff2, 'Q1', 'Q2']] as const) {
    b.labelPin(ff, 'T', 'H');
    b.labelPin(ff, 'CLK', clock);
    b.labelPin(ff, 'Q', q);
    b.labelPin(ff, 'QN', `N${q}`);
    // SET / RESET are active low: held high, the flip-flops only follow the clock
    b.labelPin(ff, 'SET', 'H');
    b.labelPin(ff, 'RESET', 'H');
  }
  const xla = b.part('instruments/logic-analyzer', 'XLA1', 760, 260, { clockrate: '20k', pre: '20', post: '180' });
  b.labelPin(xla, 'd0', 'CLK');
  b.labelPin(xla, 'd1', 'Q1');
  b.labelPin(xla, 'd2', 'Q2');
  b.labelPin(xla, 'd3', 'NQ1');
  b.labelPin(xla, 'd4', 'NQ2');
  note(b, 60, 420, 'Flip-flop T với T = 1 đảo trạng thái ở mỗi sườn lên của CLK: Q1 = CLK/2, Q2 = CLK/4; NQ1, NQ2 là đầu ra đảo.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
  return d;
}

export function binaryCounterSample(): Design {
  const b = new DesignBuilder('4-bit binary counter with hex display');
  const d = b.design;
  d.description = 'IC 7493 đếm nhị phân 4 bit (QA nối CKB) theo xung nhịp 5 Hz; màn hình hex hiện 0…F. ' + 'A 7493 counts in 4-bit binary (QA wired to CKB) from a 5 Hz clock; the hex display shows 0…F.';
  const clk = b.part('sources/digital-clock', 'V1', 100, 210, { freq: '5', vhigh: '5' });
  const u1 = b.part('ttl/7493', 'U1', 300, 250);
  b.wire(b.pin(clk, 'OUT'), b.pin(u1, 'CKA'));
  b.labelPin(u1, 'QA', 'QA');
  b.labelPin(u1, 'CKB', 'QA');
  for (const q of ['QB', 'QC', 'QD']) b.labelPin(u1, q, q);
  b.labelPin(u1, 'R01', 'GND');
  b.labelPin(u1, 'R02', 'GND');
  const hex = b.part('indicators/hex-display', 'U2', 550, 250);
  ['QA', 'QB', 'QC', 'QD'].forEach((q, i) => b.labelPin(hex, `D${i}`, q));
  note(b, 60, 360, 'QA đổi trạng thái ở mỗi sườn xuống của CKA; QB, QC, QD lần lượt chia đôi tiếp: 4 bit đếm 0…15 rồi quay về 0.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 3.5 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Mixed signal
// ---------------------------------------------------------------------------

export function monostable555Sample(): Design {
  const b = new DesignBuilder('555 monostable (one-shot)');
  const d = b.design;
  d.description = 'IC 555 đơn ổn: mỗi xung kích xuống thấp ở TRIG tạo một xung ra dài t = 1,1·R1·C1 = 1,1·100k·1 µF ≈ 0,11 s. ' + '555 monostable: every low trigger pulse on TRIG gives one output pulse t = 1.1·R1·C1 ≈ 0.11 s long.';
  const u1 = b.part('analog/555', 'U1', 400, 300);
  b.part('sources/vcc', 'VCC1', 480, 170, { voltage: '9' });
  b.labelPin(u1, 'VCC', 'VCC');
  b.labelPin(u1, 'RST', 'VCC');
  const r1 = b.part('basic/resistor', 'R1', 480, 220, { value: '100k' }, { rotation: 90 });
  b.wire(p(480, 170), b.pin(r1, '1'));
  b.labelPin(r1, '2', 'TH');
  b.labelPin(u1, 'DIS', 'TH');
  b.labelPin(u1, 'THR', 'TH');
  const c1 = b.part('basic/capacitor', 'C1', 300, 400, { value: '1u' }, { rotation: 90 });
  b.labelPin(c1, '1', 'TH');
  b.wire(b.pin(c1, '2'), p(300, 460));
  gnd(b, 300, 460);
  const c2 = b.part('basic/capacitor', 'C2', 220, 400, { value: '10n' }, { rotation: 90 });
  b.labelPin(c2, '1', 'CV');
  b.labelPin(u1, 'CTRL', 'CV');
  b.wire(b.pin(c2, '2'), p(220, 460));
  gnd(b, 220, 460);
  b.wire(b.pin(u1, 'GND'), p(400, 380));
  gnd(b, 400, 380);
  const v1 = b.part('sources/pulse-voltage', 'V1', 120, 300, { v1: '9', v2: '0', delay: '20m', rise: '1u', fall: '1u', width: '1m', period: '0.4' });
  b.labelPin(v1, '+', 'TRIG');
  b.labelPin(u1, 'TRIG', 'TRIG');
  b.wire(b.pin(v1, '-'), p(120, 360));
  gnd(b, 120, 360);
  b.labelPin(u1, 'OUT', 'OUT');
  const r3 = b.part('basic/resistor', 'R3', 580, 290, { value: '1k' });
  const led = b.part('diodes/led-green', 'LED1', 640, 340, {}, { rotation: 90 });
  b.labelPin(r3, '1', 'OUT');
  b.wire(b.pin(r3, '2'), p(640, 290), b.pin(led, 'A'));
  b.wire(b.pin(led, 'K'), p(640, 400));
  gnd(b, 640, 400);
  scope(b, 800, 250, 'TRIG', 'OUT', { timebase: '100m', 'A.scale': '5', 'B.scale': '5', 'trig.source': 'B', 'trig.level': '4' });
  note(b, 60, 520, 't = 1,1 · R1 · C1 = 1,1 · 100 kΩ · 1 µF ≈ 110 ms. Xung kích ngắn (1 ms) nhưng xung ra luôn dài 110 ms.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-4, tstop: 1 }]);
  return d;
}

export function r2rDacSample(): Design {
  const b = new DesignBuilder('R-2R digital-to-analog converter');
  const d = b.design;
  d.description = 'Bộ đếm 7493 cấp 4 bit cho thang điện trở R-2R (R = 10k, 2R = 20k): điện áp ra là bậc thang 16 mức, mỗi bậc = Vcao/16. ' + 'A 7493 counter feeds 4 bits to an R-2R ladder (R = 10k, 2R = 20k): the output is a 16-step staircase, each step = Vhigh/16.';
  const clk = b.part('sources/digital-clock', 'V1', 100, 150, { freq: '1k', vhigh: '5' });
  const u1 = b.part('ttl/7493', 'U1', 260, 190);
  b.wire(b.pin(clk, 'OUT'), b.pin(u1, 'CKA'));
  b.labelPin(u1, 'QA', 'QA');
  b.labelPin(u1, 'CKB', 'QA');
  for (const q of ['QB', 'QC', 'QD']) b.labelPin(u1, q, q);
  b.labelPin(u1, 'R01', 'GND');
  b.labelPin(u1, 'R02', 'GND');
  // ladder: 2R from each bit to its node, R between nodes, 2R termination at the LSB node
  const bits = ['QA', 'QB', 'QC', 'QD'];
  const node = (i: number) => (i === 3 ? 'OUT' : `N${i}`);
  bits.forEach((q, i) => {
    const r = b.part('basic/resistor', `R${i + 1}`, 480 + i * 100, 140, { value: '20k' }, { rotation: 90 });
    b.labelPin(r, '1', q);
    b.labelPin(r, '2', node(i));
  });
  for (let i = 0; i < 3; i++) {
    const r = b.part('basic/resistor', `R${i + 5}`, 530 + i * 100, 230, { value: '10k' });
    b.labelPin(r, '1', node(i));
    b.labelPin(r, '2', node(i + 1));
  }
  const rt = b.part('basic/resistor', 'R8', 430, 290, { value: '20k' }, { rotation: 90 });
  b.labelPin(rt, '1', 'N0');
  b.wire(b.pin(rt, '2'), p(430, 340));
  gnd(b, 430, 340);
  scope(b, 960, 330, 'OUT', 'QA', { timebase: '5m', 'A.scale': '1', 'B.scale': '5' });
  note(b, 60, 400, 'V(OUT) = Vcao · (8·QD + 4·QC + 2·QB + QA)/16: mỗi bậc ≈ Vcao/16, đếm 16 bậc mỗi 16 ms.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 3.2e-2 }]);
  return d;
}

export function pwmComparatorSample(): Design {
  const b = new DesignBuilder('PWM from a triangle and a comparator');
  const d = b.design;
  d.description = 'So sánh sóng tam giác 0…5 V với mức DC 2 V tạo xung PWM có độ rộng 40 %; mạch RC lọc lấy giá trị trung bình ≈ 2 V. ' + 'Comparing a 0…5 V triangle with a 2 V DC level gives 40 % PWM; the RC filter recovers the average ≈ 2 V.';
  const v1 = b.part('sources/triangle-voltage', 'V1', 100, 260, { low: '0', high: '5', freq: '1k' });
  const v2 = b.part('sources/dc-voltage', 'V2', 200, 260, { value: '2' });
  b.labelPin(v1, '+', 'TRI');
  b.labelPin(v2, '+', 'LEVEL');
  b.wire(b.pin(v1, '-'), p(100, 330));
  b.wire(p(100, 330), p(200, 330));
  b.wire(b.pin(v2, '-'), p(200, 330));
  gnd(b, 100, 330);
  const u1 = b.part('mixed/comparator-logic', 'U1', 380, 250, { vhigh: '5' });
  b.labelPin(u1, 'IN+', 'LEVEL');
  b.labelPin(u1, 'IN-', 'TRI');
  b.labelPin(u1, 'OUT', 'PWM');
  const r1 = b.part('basic/resistor', 'R1', 520, 250, { value: '10k' });
  const c1 = b.part('basic/capacitor', 'C1', 600, 300, { value: '1u' }, { rotation: 90 });
  b.labelPin(r1, '1', 'PWM');
  b.wire(b.pin(r1, '2'), p(600, 250), b.pin(c1, '1'));
  b.wire(b.pin(c1, '2'), p(600, 350));
  gnd(b, 600, 350);
  b.label('AVG', 580, 250);
  scope(b, 760, 250, 'TRI', 'PWM', { timebase: '500u', 'A.scale': '2', 'B.scale': '5', 'trig.level': '2.5' });
  note(b, 60, 420, 'Đầu ra cao khi TRI < LEVEL: độ rộng xung = 2 V / 5 V = 40 %; trung bình ≈ 0,4 · 5 V = 2 V (τ = R1·C1 = 10 ms).');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-6, tstop: 4e-2 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

export function fullWaveCtSample(): Design {
  const b = new DesignBuilder('Full-wave rectifier with center-tapped transformer');
  const d = b.design;
  d.description = 'Biến áp có điểm giữa và hai diode chỉnh lưu cả hai nửa chu kỳ; tụ 470 µF lọc còn gợn 100 Hz ≈ I/(2·f·C). ' + 'A center-tapped transformer and two diodes rectify both half-cycles; the 470 µF capacitor leaves a 100 Hz ripple ≈ I/(2·f·C).';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '325', freq: '50', acmag: '0' });
  const t1 = b.part('basic/transformer-ct', 'T1', 250, 250, { turns: '10' });
  b.wire(b.pin(v1, '+'), p(100, 200), p(210, 200), b.pin(t1, 'P1'));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.wire(p(100, 300), p(210, 300), b.pin(t1, 'P2'));
  gnd(b, 100, 300);
  const d1 = b.part('diodes/1n4007', 'D1', 380, 230);
  const d2 = b.part('diodes/1n4007', 'D2', 380, 330);
  b.wire(b.pin(t1, 'S1'), b.pin(d1, 'A'));
  b.wire(b.pin(t1, 'S2'), p(320, 270), p(320, 330), b.pin(d2, 'A'));
  b.labelPin(t1, 'CT', 'GND');
  const c1 = b.part('basic/electrolytic', 'C1', 500, 280, { value: '470u' }, { rotation: 90 });
  const rl = b.part('basic/resistor', 'RL', 580, 280, { value: '1k' }, { rotation: 90 });
  b.wire(b.pin(d1, 'K'), p(500, 230), b.pin(c1, '+'));
  b.wire(b.pin(d2, 'K'), p(460, 330), p(460, 230));
  b.wire(p(500, 230), p(580, 230), b.pin(rl, '1'));
  b.wire(b.pin(c1, '-'), p(500, 380));
  b.wire(b.pin(rl, '2'), p(580, 380), p(500, 380));
  gnd(b, 500, 380);
  b.label('OUT', 540, 230);
  scope(b, 720, 250, 'OUT', null, { timebase: '10m', 'A.scale': '5', 'trig.level': '10' });
  note(b, 60, 440, 'Mỗi nửa cuộn thứ cấp ≈ 16 V đỉnh; ra ≈ 16 − 0,8 ≈ 15 V; gợn ≈ 15 mA/(2·50 Hz·470 µF) ≈ 0,3 V ở 100 Hz.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 0.2 }]);
  return d;
}

export function regulator7805Sample(): Design {
  const b = new DesignBuilder('7805 linear voltage regulator');
  const d = b.design;
  d.description = 'IC ổn áp 7805 giữ 5 V ra khi điện áp vào lớn hơn khoảng 7 V (điện áp rơi tối thiểu ≈ 2 V); tải 100 Ω lấy 50 mA. Quét DC V1 từ 0 đến 15 V. ' + 'The 7805 holds 5 V out once the input exceeds about 7 V (≈ 2 V dropout); the 100 Ω load draws 50 mA. DC sweep of V1 from 0 to 15 V.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 250, { value: '12' });
  const u1 = b.part('power/7805', 'U1', 300, 200);
  const c1 = b.part('basic/capacitor', 'C1', 200, 250, { value: '330n' }, { rotation: 90 });
  const c2 = b.part('basic/capacitor', 'C2', 400, 250, { value: '100n' }, { rotation: 90 });
  const rl = b.part('basic/resistor', 'RL', 480, 250, { value: '100' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(u1, 'IN'));
  b.wire(p(200, 200), b.pin(c1, '1'));
  b.wire(b.pin(u1, 'OUT'), p(480, 200), b.pin(rl, '1'));
  b.wire(p(400, 200), b.pin(c2, '1'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(480, 320), b.pin(rl, '2'));
  b.wire(b.pin(c1, '2'), p(200, 320));
  b.wire(b.pin(c2, '2'), p(400, 320));
  b.wire(b.pin(u1, 'GND'), p(300, 320));
  gnd(b, 100, 320);
  b.label('VIN', 150, 200);
  b.label('VOUT', 440, 200);
  note(b, 60, 380, 'Công suất tiêu tán trên 7805 = (12 V − 5 V) · 50 mA = 0,35 W. Dưới ≈ 7 V đầu vào, đầu ra tụt theo (mất ổn áp).');
  setAnalyses(d, 'dc', [{ type: 'op' }, { type: 'dc', src: 'V1', start: 0, stop: 15, step: 0.1 }]);
  return d;
}

export function voltageDoublerSample(): Design {
  const b = new DesignBuilder('Voltage doubler');
  const d = b.design;
  d.description = 'Mạch nhân đôi điện áp: C1 và D1 dịch mức tín hiệu xoay chiều lên, D2 và C2 nạp tới gần hai lần biên độ: ra ≈ 2·10 V − 2·0,7 V ≈ 18,6 V. ' + 'Voltage doubler: C1 and D1 clamp the AC up, D2 and C2 charge to nearly twice the peak: about 2·10 V − 2·0.7 V ≈ 18.6 V.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '10', freq: '1k', acmag: '0' });
  const c1 = b.part('basic/capacitor', 'C1', 200, 200, { value: '10u' });
  const d1 = b.part('diodes/1n4148', 'D1', 300, 250, {}, { rotation: 270 });
  const d2 = b.part('diodes/1n4148', 'D2', 380, 200);
  const c2 = b.part('basic/capacitor', 'C2', 460, 250, { value: '10u' }, { rotation: 90 });
  const rl = b.part('basic/resistor', 'RL', 540, 250, { value: '100k' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(c1, '1'));
  b.wire(b.pin(c1, '2'), b.pin(d2, 'A'));
  b.wire(p(300, 200), b.pin(d1, 'K'));
  b.wire(b.pin(d2, 'K'), p(540, 200), b.pin(rl, '1'));
  b.wire(p(460, 200), b.pin(c2, '1'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(540, 320), b.pin(rl, '2'));
  b.wire(b.pin(d1, 'A'), p(300, 320));
  b.wire(b.pin(c2, '2'), p(460, 320));
  gnd(b, 100, 320);
  b.label('CLAMP', 260, 200);
  b.label('OUT', 500, 200);
  scope(b, 680, 250, 'CLAMP', 'OUT', { timebase: '5m', 'A.scale': '10', 'B.scale': '10' });
  note(b, 60, 380, 'V(CLAMP) dao động từ ≈ −0,7 V tới ≈ +19 V; C2 giữ đỉnh đó. Tải càng nặng thì ra càng thấp và gợn càng lớn.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 5e-2 }]);
  return d;
}

// ---------------------------------------------------------------------------
// RF
// ---------------------------------------------------------------------------

export function lcTankSample(): Design {
  const b = new DesignBuilder('Parallel LC tank');
  const d = b.design;
  d.description = 'Khung cộng hưởng LC song song (100 µH, 10 nF) nối qua điện trở nguồn 1 kΩ: biên độ lớn nhất tại f0 = 1/(2π√(LC)) ≈ 159 kHz, dùng để chọn tần số trong máy thu. ' + 'Parallel LC tank (100 µH, 10 nF) fed through 1 kΩ: the response peaks at f0 = 1/(2π√(LC)) ≈ 159 kHz, which is how receivers select a frequency.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '1', freq: '159k', acmag: '1' });
  const rs = b.part('basic/resistor', 'RS', 200, 200, { value: '1k' });
  const l1 = b.part('basic/inductor', 'L1', 300, 250, { value: '100u' }, { rotation: 90 });
  const c1 = b.part('basic/capacitor', 'C1', 380, 250, { value: '10n' }, { rotation: 90 });
  const r1 = b.part('basic/resistor', 'RP', 460, 250, { value: '10k' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(rs, '1'));
  b.wire(b.pin(rs, '2'), p(460, 200), b.pin(r1, '1'));
  b.wire(p(300, 200), b.pin(l1, '1'));
  b.wire(p(380, 200), b.pin(c1, '1'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(460, 320), b.pin(r1, '2'));
  b.wire(b.pin(l1, '2'), p(300, 320));
  b.wire(b.pin(c1, '2'), p(380, 320));
  gnd(b, 100, 320);
  b.label('IN', 100, 220);
  b.label('OUT', 420, 200);
  const xbp = b.part('instruments/bode-plotter', 'XBP1', 620, 250, { fstart: '10k', fstop: '10M', points: '200', mmin: '-60', mmax: '5' });
  b.labelPin(xbp, 'IN+', 'IN');
  b.labelPin(xbp, 'OUT+', 'OUT');
  note(b, 60, 380, 'f0 = 1/(2π·√(100 µH · 10 nF)) ≈ 159 kHz; tại f0 cuộn cảm và tụ “triệt tiêu” nhau, khung chỉ còn RP.');
  setAnalyses(d, 'ac', [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 100, fstart: 1e4, fstop: 1e7 }]);
  return d;
}

export function amDetectorSample(): Design {
  const b = new DesignBuilder('AM envelope detector');
  const d = b.design;
  d.description = 'Tách sóng AM bằng diode: sóng mang 50 kHz điều biên bởi âm 1 kHz; diode chỉnh lưu, R·C = 100 µs giữ đỉnh nên đầu ra theo đường bao 1 kHz. ' + 'Diode AM detector: a 50 kHz carrier amplitude-modulated by 1 kHz; the diode rectifies and R·C = 100 µs holds the peaks, so the output follows the 1 kHz envelope.';
  const v1 = b.part('sources/am-voltage', 'V1', 100, 250, { amplitude: '2', carrier: '50k', index: '0.5', modfreq: '1k' });
  const d1 = b.part('diodes/1n4148', 'D1', 200, 200);
  const c1 = b.part('basic/capacitor', 'C1', 300, 250, { value: '10n' }, { rotation: 90 });
  const r1 = b.part('basic/resistor', 'R1', 380, 250, { value: '10k' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(d1, 'A'));
  b.wire(b.pin(d1, 'K'), p(380, 200), b.pin(r1, '1'));
  b.wire(p(300, 200), b.pin(c1, '1'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(380, 320), b.pin(r1, '2'));
  b.wire(b.pin(c1, '2'), p(300, 320));
  gnd(b, 100, 320);
  b.label('AM', 140, 200);
  b.label('ENV', 340, 200);
  scope(b, 540, 250, 'AM', 'ENV', { timebase: '500u', 'A.scale': '1', 'B.scale': '1' });
  note(b, 60, 380, 'Điều kiện: 1/f_sóng mang (20 µs) ≪ R·C (100 µs) ≪ 1/f_âm (1 ms). R·C quá lớn thì đầu ra không theo kịp đường bao.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-7, tstop: 4e-3 }]);
  return d;
}

export function transmissionLineSample(): Design {
  const b = new DesignBuilder('Transmission line reflections');
  const d = b.design;
  d.description = 'Đường truyền 50 Ω trễ 10 ns kết thúc bằng tải 150 Ω: hệ số phản xạ Γ = (150 − 50)/(150 + 50) = 0,5, nên sau 20 ns phía đầu vào có thêm một bậc phản xạ. ' + 'A 50 Ω, 10 ns line ending in 150 Ω: reflection coefficient Γ = 0.5, so after 20 ns the input shows a reflected step.';
  const v1 = b.part('sources/pulse-voltage', 'V1', 100, 250, { v1: '0', v2: '2', delay: '5n', rise: '1n', fall: '1n', width: '60n', period: '200n' });
  const rs = b.part('basic/resistor', 'RS', 200, 200, { value: '50' });
  const t1 = b.part('rf/transmission-line', 'T1', 320, 210, { z0: '50', td: '10n' });
  const rl = b.part('basic/resistor', 'RL', 440, 250, { value: '150' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(rs, '1'));
  b.wire(b.pin(rs, '2'), b.pin(t1, 'A+'));
  b.wire(b.pin(t1, 'B+'), p(440, 200), b.pin(rl, '1'));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.wire(p(100, 300), p(440, 300), b.pin(rl, '2'));
  b.wire(b.pin(t1, 'A-'), p(280, 300));
  b.wire(b.pin(t1, 'B-'), p(360, 300));
  gnd(b, 100, 300);
  b.label('NEAR', 255, 200);
  b.label('FAR', 400, 200);
  scope(b, 600, 250, 'NEAR', 'FAR', { timebase: '10n', 'A.scale': '500m', 'B.scale': '500m', 'trig.level': '0.5' });
  note(b, 60, 360, 'Đầu gần: 1 V (chia đôi với RS) rồi lên 1,5 V khi sóng phản xạ quay về (20 ns). Đầu xa: 1,5 V sau 10 ns. Thử RL = 50 Ω: hết phản xạ.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-10, tstop: 1e-7 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export function wattmeterSample(): Design {
  const b = new DesignBuilder('Wattmeter on an RL load');
  const d = b.design;
  d.description = 'Oát kế XWM1 đo công suất thực trên tải R-L ở 50 Hz: P = I²·R ≈ 0,91 W, hệ số công suất cos φ = R/|Z| ≈ 0,95. ' + 'Wattmeter XWM1 measures the real power of an R-L load at 50 Hz: P = I²·R ≈ 0.91 W, power factor cos φ = R/|Z| ≈ 0.95.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 300, { amplitude: '14.142', freq: '50', acmag: '0' });
  b.labelPin(v1, '+', 'SRC');
  b.wire(b.pin(v1, '-'), p(100, 380));
  gnd(b, 100, 380);
  const xwm = b.part('instruments/wattmeter', 'XWM1', 300, 150);
  b.labelPin(xwm, 'I+', 'SRC');
  b.labelPin(xwm, 'I-', 'LOAD');
  b.labelPin(xwm, 'V+', 'LOAD');
  b.labelPin(xwm, 'V-', 'GND');
  const r1 = b.part('basic/resistor', 'R1', 300, 300, { value: '100' }, { rotation: 90 });
  const l1 = b.part('basic/inductor', 'L1', 300, 380, { value: '100m' }, { rotation: 90 });
  b.labelPin(r1, '1', 'LOAD');
  b.wire(b.pin(r1, '2'), b.pin(l1, '1'));
  b.wire(b.pin(l1, '2'), p(300, 440));
  gnd(b, 300, 440);
  note(b, 60, 500, '|Z| = √(100² + (2π·50·0,1)²) ≈ 104,8 Ω; I = 10 V/104,8 Ω ≈ 95 mA; P = I²·R ≈ 0,91 W. Oát kế: cuộn dòng nối tiếp, cuộn áp song song.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 0.2 }]);
  return d;
}

export function spectrumSquareSample(): Design {
  const b = new DesignBuilder('Spectrum of a square wave');
  const d = b.design;
  d.description = 'Máy phân tích phổ XSA1 cho thấy sóng vuông 1 kHz gồm các hài lẻ 1, 3, 5, 7 kHz … với biên độ giảm theo 1/n (4/π, 4/(3π) …). ' + 'The spectrum analyzer XSA1 shows that a 1 kHz square wave is made of odd harmonics 1, 3, 5, 7 kHz … falling as 1/n.';
  const xfg = b.part('instruments/function-generator', 'XFG1', 150, 200, { waveform: 'square', freq: '1k', amplitude: '1' });
  b.labelPin(xfg, '+', 'SQ');
  b.wire(b.pin(xfg, 'COM'), p(150, 280));
  gnd(b, 150, 280);
  const r1 = b.part('basic/resistor', 'R1', 300, 250, { value: '1k' }, { rotation: 90 });
  b.labelPin(r1, '1', 'SQ');
  b.wire(b.pin(r1, '2'), p(300, 320));
  gnd(b, 300, 320);
  const xsa = b.part('instruments/spectrum-analyzer', 'XSA1', 450, 200, { fstart: '0', fstop: '10k' });
  b.labelPin(xsa, 'IN+', 'SQ');
  b.labelPin(xsa, 'IN-', 'GND');
  note(b, 60, 380, 'Biên độ hài bậc n của sóng vuông biên độ A: 4A/(nπ) với n lẻ; hài chẵn bằng 0. Thử đổi máy phát sang sóng tam giác: hài giảm theo 1/n².');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-6, tstop: 2e-2 }, { type: 'four', fundamental: 1e3, harmonics: 9, outputs: ['V(SQ)'], settleCycles: 2, samples: 256 }]);
  return d;
}

export function wordGeneratorSample(): Design {
  const b = new DesignBuilder('Word generator and logic analyzer');
  const d = b.design;
  d.description = 'Máy phát từ XWG1 phát dãy 0…F (4 bit) ở 1 kHz; máy phân tích logic XLA1 vẽ giản đồ thời gian, màn hình hex hiện từng từ. ' + 'Word generator XWG1 outputs 0…F (4 bits) at 1 kHz; logic analyzer XLA1 draws the timing diagram and the hex display shows each word.';
  const xwg = b.part('instruments/word-generator', 'XWG1', 150, 250, { freq: '1k', bits: '4' });
  const xla = b.part('instruments/logic-analyzer', 'XLA1', 520, 250, { clockrate: '10k', pre: '20', post: '180' });
  const hex = b.part('indicators/hex-display', 'U1', 340, 420);
  for (let i = 0; i < 4; i++) {
    b.labelPin(xwg, `b${i}`, `B${i}`);
    b.labelPin(xla, `d${i}`, `B${i}`);
    b.labelPin(hex, `D${i}`, `B${i}`);
  }
  note(b, 60, 520, 'Mỗi bit là một đường trên XLA1: b0 đổi mỗi 1 ms, b1 mỗi 2 ms … (mã nhị phân của 0…F). Mở XWG1 để sửa dãy từ.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 2e-2 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

/** RC low-pass V1 → R1 → C1 with an OUT label (AC 1 V). */
function rcLowPass(b: DesignBuilder, r = '1k', c = '100n'): void {
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '1', freq: '1k', acmag: '1' });
  const r1 = b.part('basic/resistor', 'R1', 200, 200, { value: r });
  const c1 = b.part('basic/capacitor', 'C1', 300, 250, { value: c }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 200), b.pin(c1, '1'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(300, 320), b.pin(c1, '2'));
  gnd(b, 100, 320);
  b.label('IN', 140, 200);
  b.label('OUT', 270, 200);
}

export function paramSweepSample(): Design {
  const b = new DesignBuilder('Parameter sweep of an RC filter');
  const d = b.design;
  d.description = 'Quét tham số: phân tích AC chạy lại với R1 = 1k, 2,2k, 4,7k; Grapher vẽ chồng ba đường, tần số cắt fc = 1/(2π·R1·C1) giảm khi R1 tăng. ' + 'Parameter sweep: the AC analysis runs again with R1 = 1k, 2.2k, 4.7k; the Grapher overlays the curves and fc = 1/(2π·R1·C1) falls as R1 grows.';
  rcLowPass(b);
  note(b, 60, 380, 'fc ≈ 1,59 kHz (1k), 723 Hz (2,2k), 339 Hz (4,7k). Mô phỏng > Phân tích đang chọn: Quét tham số, rồi Chạy phân tích.');
  setAnalyses(d, 'paramsweep', [
    { type: 'op' },
    { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e6 },
    { type: 'paramsweep', target: 'R1', param: 'value', values: [1e3, 2.2e3, 4.7e3], base: { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e6 } },
  ]);
  return d;
}

export function temperatureSweepSample(): Design {
  const b = new DesignBuilder('Temperature sweep of a diode');
  const d = b.design;
  d.description = 'Quét nhiệt độ: điện áp thuận của diode 1N4148 giảm khoảng 2 mV mỗi °C; đặc tuyến DC được vẽ ở −25, 25, 75 và 125 °C. ' + 'Temperature sweep: the forward voltage of a 1N4148 drops about 2 mV per °C; the DC curve is drawn at −25, 25, 75 and 125 °C.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 250, { value: '5' });
  const r1 = b.part('basic/resistor', 'R1', 200, 200, { value: '4.7k' });
  const d1 = b.part('diodes/1n4148', 'D1', 300, 250, {}, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 200), b.pin(d1, 'A'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(300, 320), b.pin(d1, 'K'));
  gnd(b, 100, 320);
  b.label('VD', 260, 200);
  note(b, 60, 380, 'Ở cùng dòng ≈ 1 mA, V(VD) thấp hơn khoảng 0,2 V khi nóng thêm 100 °C: diode dùng được làm cảm biến nhiệt.');
  setAnalyses(d, 'tempsweep', [
    { type: 'op' },
    { type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.05 },
    { type: 'tempsweep', temps: [-25, 25, 75, 125], base: { type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.05 } },
  ]);
  return d;
}

export function monteCarloSample(): Design {
  const b = new DesignBuilder('Monte Carlo of a voltage divider');
  const d = b.design;
  d.description = 'Monte Carlo: R1 và R2 có dung sai 5 %; 50 lần chạy với giá trị ngẫu nhiên cho thấy V(OUT) dao động quanh 5 V trong khoảng ±0,25 V. ' + 'Monte Carlo: R1 and R2 have 5 % tolerance; 50 runs with random values show V(OUT) spreading around 5 V by about ±0.25 V.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 250, { value: '10' });
  const r1 = b.part('basic/resistor', 'R1', 250, 180, { value: '10k', tolerance: '5' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 320, { value: '10k', tolerance: '5' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 120), p(250, 120), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(v1, '-'), p(100, 380));
  b.wire(p(100, 380), p(250, 380), b.pin(r2, '2'));
  gnd(b, 100, 380);
  b.label('OUT', 250, 250);
  note(b, 60, 440, 'Với dung sai đều ±5 % ở cả hai điện trở, V(OUT) lệch tối đa ≈ ±0,25 V (±5 %); hầu hết các lần chạy gần 5 V hơn.');
  setAnalyses(d, 'montecarlo', [
    { type: 'op' },
    {
      type: 'montecarlo',
      runs: 50,
      seed: 1,
      tolerances: [
        { target: 'R1', param: 'value', tol: 0.05, dist: 'uniform' },
        { target: 'R2', param: 'value', tol: 0.05, dist: 'uniform' },
      ],
      base: { type: 'op' },
    },
  ]);
  return d;
}

export function fourierClipperSample(): Design {
  const b = new DesignBuilder('Fourier analysis of a clipped sine');
  const d = b.design;
  d.description = 'Phân tích Fourier: sóng sin 3 V bị hai diode xén ở ±0,7 V nên có thêm hài bậc lẻ; bảng kết quả cho biên độ từng hài và độ méo THD. ' + 'Fourier analysis: a 3 V sine clipped at ±0.7 V by two diodes gains odd harmonics; the table gives each harmonic and the THD.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '3', freq: '1k', acmag: '0' });
  const r1 = b.part('basic/resistor', 'R1', 200, 200, { value: '1k' });
  const d1 = b.part('diodes/1n4148', 'D1', 300, 250, {}, { rotation: 90 });
  const d2 = b.part('diodes/1n4148', 'D2', 380, 250, {}, { rotation: 270 });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(380, 200), b.pin(d2, 'K'));
  b.wire(p(300, 200), b.pin(d1, 'A'));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.wire(p(100, 320), p(380, 320), b.pin(d2, 'A'));
  b.wire(b.pin(d1, 'K'), p(300, 320));
  gnd(b, 100, 320);
  b.label('IN', 140, 200);
  b.label('OUT', 340, 200);
  scope(b, 540, 250, 'IN', 'OUT', { timebase: '500u', 'A.scale': '2', 'B.scale': '1' });
  note(b, 60, 380, 'Sóng gần vuông chủ yếu có hài bậc 3, 5, 7…; hài chẵn rất nhỏ vì hai diode đối xứng.');
  setAnalyses(d, 'four', [
    { type: 'op' },
    { type: 'tran', tstep: 5e-6, tstop: 5e-3 },
    { type: 'four', fundamental: 1e3, harmonics: 9, outputs: ['V(OUT)'], settleCycles: 3, samples: 256 },
  ]);
  return d;
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

export function subcircuitCascadeSample(): Design {
  const b = new DesignBuilder('RC subcircuit used twice');
  const d = b.design;
  d.description = 'Mạch con “RC” (R = 1k, C = 100 nF) được đặt hai lần nối tiếp tạo bộ lọc bậc 2: độ dốc −40 dB/decade. Nhấp đúp khối SC1 để xem bên trong. ' + 'The subcircuit “RC” (R = 1k, C = 100 nF) placed twice in a row makes a 2nd-order filter falling at −40 dB/decade. Double-click SC1 to look inside.';
  const child = b.child('RC', { kind: 'subcircuit' });
  const r = b.part('basic/resistor', 'R1', 200, 200, { value: '1k' });
  const c = b.part('basic/capacitor', 'C1', 300, 250, { value: '100n' }, { rotation: 90 });
  b.wire(b.pin(r, '2'), p(300, 200), b.pin(c, '1'));
  b.wire(b.pin(c, '2'), p(300, 320));
  b.part('sources/ground', 'GND1', 300, 320);
  b.labelPin(r, '1', 'IN', { kind: 'hier' });
  b.label('OUT', 300, 200, { kind: 'hier' });
  b.root();
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '1', freq: '1k', acmag: '1' });
  const sc1 = b.block(child, 'SC1', 260, 200);
  const sc2 = b.block(child, 'SC2', 440, 200);
  b.labelPin(v1, '+', 'IN');
  b.wire(b.pin(v1, '-'), p(100, 320));
  gnd(b, 100, 320);
  b.labelPin(sc1, 'IN', 'IN');
  b.labelPin(sc1, 'OUT', 'MID');
  b.labelPin(sc2, 'IN', 'MID');
  b.labelPin(sc2, 'OUT', 'OUT');
  const r9 = b.part('basic/resistor', 'RL', 600, 250, { value: '1Meg' }, { rotation: 90 });
  b.labelPin(r9, '1', 'OUT');
  b.wire(b.pin(r9, '2'), p(600, 320));
  gnd(b, 600, 320);
  note(b, 60, 380, 'Mỗi khối là một tầng −20 dB/decade trên fc ≈ 1,59 kHz; hai tầng nối tiếp (có tải lẫn nhau) cho −40 dB/decade.');
  setAnalyses(d, 'ac', [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e6 }]);
  return d;
}

export function multiSheetSample(): Design {
  const b = new DesignBuilder('Two sheets joined by off-page connectors');
  const d = b.design;
  d.description = 'Thiết kế hai trang: nguồn và điện trở ở trang 1, LED và tải ở trang 2, nối bằng đầu nối sang trang “NODE”. Mở thẻ trang phía dưới để chuyển trang. ' + 'Two sheets: source and resistor on sheet 1, LED and load on sheet 2, joined by the off-page connector “NODE”. Use the sheet tabs to switch.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 250, { value: '9' });
  const r1 = b.part('basic/resistor', 'R1', 220, 200, { value: '470' });
  b.wire(b.pin(v1, '+'), p(100, 200), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(320, 200));
  b.label('NODE', 320, 200, { kind: 'offpage' });
  b.wire(b.pin(v1, '-'), p(100, 320));
  gnd(b, 100, 320);
  note(b, 60, 380, 'Trang 1: nguồn 9 V và R1. Đầu nối “NODE” nối tiếp sang trang 2.');
  b.addSheet('Sheet 2');
  b.label('NODE', 100, 200, { kind: 'offpage' });
  const led = b.part('diodes/led-yellow', 'LED1', 200, 250, {}, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 300, 250, { value: '10k' }, { rotation: 90 });
  b.wire(p(100, 200), p(300, 200), b.pin(r2, '1'));
  b.wire(p(200, 200), b.pin(led, 'A'));
  b.wire(b.pin(led, 'K'), p(200, 320));
  b.wire(p(200, 320), p(300, 320), b.pin(r2, '2'));
  gnd(b, 200, 320);
  note(b, 60, 380, 'Trang 2: LED vàng và tải R2. I ≈ (9 − 2)/470 ≈ 15 mA.');
  b.useSheet(0);
  setAnalyses(d, 'op', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 1e-2 }]);
  return d;
}

export function hierBlockSample(): Design {
  const b = new DesignBuilder('Hierarchical amplifier block with a parameter');
  const d = b.design;
  d.description = 'Khối phân cấp “AMP” (khuếch đại đảo dùng op-amp lý tưởng) có tham số RF; HB1 dùng RF = 100k (Av = −10), HB2 dùng RF = 47k (Av = −4,7) cho cùng tín hiệu vào. ' + 'The hierarchical block “AMP” (inverting amplifier with an ideal op-amp) has a parameter RF; HB1 uses RF = 100k (Av = −10), HB2 RF = 47k (Av = −4.7) on the same input.';
  const child = b.child('AMP', { kind: 'hierarchical', variables: { RF: '100k' } });
  const u1 = b.part('analog/opamp-ideal-3', 'U1', 300, 250);
  const r1 = b.part('basic/resistor', 'R1', 200, 240, { value: '10k' });
  const rf = b.part('basic/resistor', 'R2', 300, 160, { value: '{RF}' });
  b.wire(b.pin(r1, '2'), b.pin(u1, 'IN-'));
  b.wire(p(240, 240), p(240, 160), b.pin(rf, '1'));
  b.wire(b.pin(rf, '2'), p(360, 160), p(360, 250));
  b.wire(b.pin(u1, 'IN+'), p(250, 260), p(250, 320));
  b.part('sources/ground', 'GND1', 250, 320);
  b.labelPin(r1, '1', 'IN', { kind: 'hier' });
  b.wire(b.pin(u1, 'OUT'), p(400, 250));
  b.label('OUT', 400, 250, { kind: 'hier' });
  b.root();
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 250, { amplitude: '100m', freq: '1k', acmag: '1' });
  b.labelPin(v1, '+', 'IN');
  b.wire(b.pin(v1, '-'), p(100, 320));
  gnd(b, 100, 320);
  const hb1 = b.block(child, 'HB1', 300, 180, { RF: '100k' });
  const hb2 = b.block(child, 'HB2', 300, 320, { RF: '47k' });
  b.labelPin(hb1, 'IN', 'IN');
  b.labelPin(hb2, 'IN', 'IN');
  b.labelPin(hb1, 'OUT', 'OUT1');
  b.labelPin(hb2, 'OUT', 'OUT2');
  for (const [net, x] of [['OUT1', 480], ['OUT2', 560]] as const) {
    const rl = b.part('basic/resistor', `RL${x === 480 ? 1 : 2}`, x, 250, { value: '10k' }, { rotation: 90 });
    b.labelPin(rl, '1', net);
    b.wire(b.pin(rl, '2'), p(x, 320));
    gnd(b, x, 320);
  }
  scope(b, 720, 250, 'OUT1', 'OUT2', { timebase: '500u', 'A.scale': '1', 'B.scale': '1' });
  note(b, 60, 400, 'Cùng một khối, hai bộ tham số: MachSim tạo hai mạch con trong netlist (Báo cáo > Netlist). Nhấp đúp khối để mở.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-6, tstop: 5e-3 }, { type: 'ac', sweep: 'dec', points: 10, fstart: 10, fstop: 1e5 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Control blocks and reference grounds (round 3)
// ---------------------------------------------------------------------------

export function blockLoopSample(): Design {
  const b = new DesignBuilder('Block-diagram control loop with .meas');
  const d = b.design;
  d.description =
    'Vòng điều khiển vẽ bằng khối: bộ cộng tạo sai số e = IN − OUT, bộ tích phân k = 1000 /s; hàm truyền vòng kín OUT/IN = k/(s + k) = 1/(1 + s·1 ms), trùng với khối H(s) = 1/(1 + s·1m) ở dưới. Phép đo .meas (văn bản SPICE riêng của thiết kế) đo thời điểm đạt 63 %. ' +
    'A control loop drawn with blocks: the summer forms e = IN − OUT, the integrator has k = 1000 /s; the closed loop OUT/IN = k/(s + k) = 1/(1 + s·1 ms) equals the H(s) = 1/(1 + s·1m) block below. The .meas cards (the design’s custom SPICE text) measure when 63 % is reached.';
  const v1 = b.part('sources/pulse-voltage', 'V1', 100, 220, { v1: '0', v2: '1', delay: '1m', rise: '1u', fall: '1u', width: '10m', period: '20m' });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '-'), p(100, 300));
  const sum = b.part('analog/summer-2', 'A1', 260, 200, { ka: '1', kb: '-1' });
  const integ = b.part('analog/integrator-reset', 'A2', 400, 210, { k: '1k', ic: '0' });
  const tf = b.part('analog/transfer-function', 'A3', 400, 340, { num: '1', den: '1m 1' });
  b.wire(b.pin(v1, '+'), b.pin(sum, 'A'));
  b.wire(b.pin(sum, 'OUT'), b.pin(integ, 'IN'));
  b.wire(b.pin(integ, 'OUT'), p(460, 210), p(460, 260), p(200, 260), p(200, 210), b.pin(sum, 'B'));
  b.wire(p(160, 190), p(160, 340), b.pin(tf, 'IN'));
  b.label('IN', 130, 190);
  b.label('OUT', 450, 210);
  b.labelPin(tf, 'OUT', 'TF');
  scope(b, 640, 260, 'OUT', 'TF', { timebase: '1m', 'A.scale': '500m', 'B.scale': '500m', 'trig.level': '0.5' });
  d.customSpice = '* Phép đo tự động: kết quả ở bảng "Phép đo (.meas)" dưới đồ thị Grapher\n.meas TRAN t63 WHEN V(OUT)=0.632120559\n.meas TRAN tf63 WHEN V(TF)=0.632120559\n.meas TRAN e2ms FIND V(IN)-V(OUT) AT=2m\n';
  note(b, 60, 420, 'Bậc thang 1 V lúc 1 ms: OUT và TF tăng theo 1 − e^(−(t − 1 ms)/1 ms) và đạt 63 % lúc 2 ms (t63 = tf63 = 2 ms). Thử đổi k của A2 thành 2k: vòng kín nhanh gấp đôi.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 6e-3 }]);
  return d;
}

export function referenceGroundSample(): Design {
  const b = new DesignBuilder('Isolated secondary on a reference ground');
  const d = b.design;
  d.description =
    'Biến áp 2:1 tách mạch thứ cấp khỏi đất chính: phía thứ cấp chỉ nối với "Đất tham chiếu 1", nên nó thả nổi như thật và đầu dò Vsec đo so với Đất tham chiếu 1 (biên độ ≈ 5 V). ' +
    'A 2:1 transformer isolates the secondary from the main ground: the secondary connects only to "Reference ground 1", so it floats as in reality and probe Vsec reads against reference ground 1 (about 5 V peak).';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '10', freq: '50', acmag: '0' });
  const t1 = b.part('basic/transformer', 'T1', 240, 210, { turns: '2' });
  const rl = b.part('basic/resistor', 'RL', 360, 220, { value: '1k' }, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 190), b.pin(t1, 'P1'));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.wire(b.pin(t1, 'P2'), p(200, 300), p(100, 300));
  b.wire(b.pin(t1, 'S1'), b.pin(rl, '1'));
  b.wire(b.pin(t1, 'S2'), p(280, 280));
  b.wire(b.pin(rl, '2'), p(360, 280), p(280, 280));
  b.part('sources/ground-ref1', 'GND2', 280, 280);
  b.label('PRI', 150, 190);
  b.label('SEC', 320, 190);
  b.probe('voltage', 150, 190, 'Vpri');
  b.probe('voltage', 340, 190, 'Vsec');
  note(b, 60, 360, 'Vsec ≈ 10 V / 2 = 5 V đỉnh, đo so với Đất tham chiếu 1. Thử nối phía thứ cấp với Đất chính bằng một điện trở: ERC cảnh báo đất tham chiếu không còn cách ly.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 0.06 }]);
  return d;
}

// ---------------------------------------------------------------------------
// Real parts, PLL and multi-position switches (round 3, step 3)
// ---------------------------------------------------------------------------

export function realCapacitorSample(): Design {
  const b = new DesignBuilder('Real capacitor: self-resonance');
  const d = b.design;
  d.description =
    'Hai tụ 100 nF qua điện trở 50 Ω: C1 lý tưởng, C2 là tụ thực (ESR 30 mΩ, ESL 2 nH). Ở tần số cao trở kháng của C1 giảm mãi, còn C2 chạm đáy bằng ESR tại tần số cộng hưởng riêng f0 = 1/(2π√(ESL·C)) ≈ 11,25 MHz rồi tăng lại như một cuộn cảm. ' +
    'Two 100 nF capacitors behind 50 Ω: C1 is ideal, C2 a real one (ESR 30 mΩ, ESL 2 nH). At high frequency the impedance of C1 keeps falling, while C2 bottoms out at its ESR at the self-resonance f0 = 1/(2π√(ESL·C)) ≈ 11.25 MHz and then rises like an inductor.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1Meg', acmag: '1' });
  const r1 = b.part('basic/resistor', 'R1', 200, 150, { value: '50' });
  const c1 = b.part('basic/capacitor', 'C1', 300, 220, { value: '100n' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 420, 150, { value: '50' });
  const c2 = b.part('basic/nonideal-capacitor', 'C2', 520, 220, { value: '100n' }, { rotation: 90 });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '+'), p(100, 150), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(300, 150), b.pin(c1, '1'));
  b.wire(b.pin(c1, '2'), p(300, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.wire(b.pin(r2, '2'), p(520, 150), b.pin(c2, '1'));
  b.wire(b.pin(c2, '2'), p(520, 300), p(300, 300));
  b.label('IN', 140, 150);
  b.labelPin(r2, '1', 'IN');
  b.label('CI', 270, 150);
  b.label('CR', 490, 150);
  const xbp = b.part('instruments/bode-plotter', 'XBP1', 700, 220, { fstart: '10k', fstop: '1G', points: '100', mmin: '-80', mmax: '0' });
  b.labelPin(xbp, 'IN+', 'IN');
  b.labelPin(xbp, 'OUT+', 'CR');
  d.customSpice = '* Tần số cộng hưởng riêng (pha = 0) và đáy của V(CR): bảng "Phép đo (.meas)" dưới đồ thị\n.meas AC fres WHEN VP(CR)=0\n.meas AC vmin MIN VDB(CR)\n';
  note(b, 60, 360, 'f0 = 1/(2π·√(2 nH · 100 nF)) ≈ 11,25 MHz: V(CR) nhỏ nhất ≈ 30 mΩ / 50 Ω (−64 dB), pha đổi dấu. Trên f0 tụ C2 hoạt động như cuộn cảm. Đặt ESL của C2 = 0: tụ trở lại lý tưởng.');
  setAnalyses(d, 'ac', [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 50, fstart: 1e4, fstop: 1e9 }]);
  return d;
}

export function pllLockSample(): Design {
  const b = new DesignBuilder('Phase-locked loop locking to 10.3 kHz');
  const d = b.design;
  d.description =
    'Khối PLL (f0 = 10 kHz, kv = 2 kHz/V) bám theo tín hiệu vào 10,3 kHz: khi đã khoá, OUT có đúng tần số ngõ vào và V(VC) = (10,3 − 10) kHz / 2 kHz/V = 0,15 V. Dải giữ khoá là ±(2/π)·kd·kv ≈ ±1,27 kHz quanh f0. ' +
    'A PLL block (f0 = 10 kHz, kv = 2 kHz/V) tracking a 10.3 kHz input: once locked, OUT has exactly the input frequency and V(VC) = (10.3 − 10) kHz / 2 kHz/V = 0.15 V. The hold-in range is ±(2/π)·kd·kv ≈ ±1.27 kHz around f0.';
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 230, { amplitude: '1', freq: '10.3k', acmag: '0' });
  const pll = b.part('analog/pll', 'U1', 300, 200);
  const rl = b.part('basic/resistor', 'RL', 420, 260, { value: '10k' }, { rotation: 90 });
  gnd(b, 100, 320);
  b.wire(b.pin(v1, '+'), b.pin(pll, 'IN'));
  b.wire(b.pin(pll, 'OUT'), p(420, 190), b.pin(rl, '1'));
  b.wire(b.pin(rl, '2'), p(420, 320), p(100, 320));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.label('IN', 180, 200);
  b.label('OUT', 390, 190);
  b.labelPin(pll, 'VC', 'VC');
  b.probe('voltage', 300, 240, 'Vctrl');
  // the voltmeter reads VCTRL live; its 10 MΩ hardly loads the 10 kΩ loop filter
  const vm = b.part('indicators/voltmeter', 'U2', 240, 290);
  b.labelPin(vm, '+', 'VC');
  b.labelPin(vm, '-', 'GND');
  scope(b, 620, 230, 'IN', 'OUT', { timebase: '100u', 'A.scale': '1', 'B.scale': '5' });
  d.customSpice = '* Điện áp điều khiển trung bình và chu kỳ ngõ ra khi đã khoá: bảng "Phép đo (.meas)"\n.meas TRAN vcavg AVG V(VC) FROM=15m TO=25m\n.meas TRAN tper TRIG V(OUT) VAL=2.5 RISE=200 TARG V(OUT) VAL=2.5 RISE=201\n';
  note(b, 60, 400, 'Sau vài ms vòng khoá: vcavg ≈ 0,15 V, chu kỳ OUT tper ≈ 1/10,3 kHz ≈ 97,1 µs. Đổi tần số V1 thành 13 kHz (ngoài dải giữ khoá): vòng không khoá được, OUT trôi tần số.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-6, tstop: 25e-3, tmax: 1e-6 }]);
  return d;
}

export function dipSwitchLedsSample(): Design {
  const b = new DesignBuilder('DIP switch, resistor network and LEDs');
  const d = b.design;
  d.description =
    'Công tắc DIP 4 vị trí bật LED qua mảng điện trở 330 Ω (DIP-8, 4 điện trở riêng rẽ). Bấm Chạy (F5) rồi bấm vào từng vị trí của S1 (hoặc nhấn phím 1–4): LED tương ứng sáng, I ≈ (5 V − VF)/330 Ω ≈ 9 mA với LED đỏ. ' +
    'A 4-position DIP switch lights LEDs through a 330 Ω resistor network (DIP-8, 4 isolated resistors). Press Run (F5), then click the positions of S1 (or press keys 1–4): the matching LED lights, I ≈ (5 V − VF)/330 Ω ≈ 9 mA for the red LED.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '5' });
  gnd(b, 100, 300);
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.labelPin(v1, '+', 'VCC');
  const sw = b.part('basic/dip-switch-4', 'S1', 260, 220, { s1: 'true', s3: 'true' });
  const rn = b.part('basic/rpack-dip8-isolated', 'RN1', 420, 220, { value: '330' });
  const leds = ['basic/3d-led-red', 'basic/3d-led-green', 'basic/3d-led-yellow', 'basic/3d-led-blue'];
  for (let k = 1; k <= 4; k++) {
    b.labelPin(sw, `A${k}`, 'VCC');
    b.labelPin(sw, `B${k}`, `S${k}`);
    b.labelPin(rn, String(k), `S${k}`);
    b.labelPin(rn, String(9 - k), `L${k}`);
    const led = b.part(leds[k - 1], `LED${k}`, 500 + 80 * k, 240, {}, { rotation: 90 });
    b.labelPin(led, 'A', `L${k}`);
    b.labelPin(led, 'K', 'GND');
  }
  note(b, 60, 360, 'Vị trí đang bật có chấm tô màu. LED đỏ: I = (5 − 1,9) V / 330 Ω ≈ 9,4 mA; LED xanh dương cần VF ≈ 3,1 V nên chỉ ≈ 5,8 mA.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 1 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// microcontroller (round 3 step 5)

/** Program text of a sample, as the Program parameter of the MCU part holds it. */
function asmLines(...lines: string[]): string {
  return lines.join('\n');
}

/** 51 — an 8051 blinking an LED on P1.0 with a delay loop. */
export function mcuBlinkSample(): Design {
  const b = new DesignBuilder('Blink an LED with an 8051');
  const d = b.design;
  d.description =
    'Vi điều khiển 8051 nháy LED ở chân P1.0 bằng vòng lặp trễ. Chu kỳ máy 1 µs (thạch anh 12 MHz); vòng trễ mất 200 × 503 = 100 600 chu kỳ ≈ 100,6 ms, nên LED đổi trạng thái mỗi ≈ 100,6 ms (chu kỳ ≈ 201 ms, ≈ 4,97 Hz). LED nối từ +5 V qua 330 Ω xuống chân, vì chân 8051 hút dòng tốt nhưng đẩy dòng rất kém. Bấm Chạy (F5); nhấp đúp vào U1 để mở Trình soạn mã. ' +
    'An 8051 blinks an LED on P1.0 with a delay loop. The machine cycle is 1 µs (12 MHz crystal); the delay takes 200 x 503 = 100,600 cycles ~ 100.6 ms, so the LED changes every ~100.6 ms (period ~201 ms, ~4.97 Hz). The LED hangs from +5 V through 330 Ω to the pin, because an 8051 pin sinks current well but sources very little. Press Run (F5); double-click U1 to open the code editor.';
  const program = asmLines(
    '; Nhay LED o chan P1.0',
    '        ORG  0',
    'MAIN:   CPL  P1.0          ; dao trang thai chan',
    '        ACALL DELAY',
    '        SJMP MAIN',
    '',
    'DELAY:  MOV  R7,#200       ; 200 x 503 chu ky may = 100600 us',
    'D1:     MOV  R6,#250',
    'D2:     DJNZ R6,D2',
    '        DJNZ R7,D1',
    '        RET',
    '        END',
  );
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 260, { value: '5' });
  gnd(b, 100, 340);
  b.wire(b.pin(v1, '-'), p(100, 340));
  b.labelPin(v1, '+', 'VCC');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 360, 260, { program, fosc: '12M' });
  const r1 = b.part('basic/resistor', 'R1', 560, 180, { value: '330' });
  const led = b.part('diodes/led-red', 'LED1', 660, 240, {}, { rotation: 90 });
  b.labelPin(r1, '1', 'VCC');
  b.labelPin(r1, '2', 'A');
  b.labelPin(led, 'A', 'A');
  b.labelPin(led, 'K', 'P1_0');
  b.labelPin(u1, 'P1.0', 'P1_0');
  b.probe('voltage', b.pin(u1, 'P1.0').x, b.pin(u1, 'P1.0').y, 'P1.0');
  note(b, 60, 400, 'Chân P1.0 ở mức 0 thì LED sáng: dòng đi từ +5 V qua 330 Ω và LED vào chân. Mở Trình soạn mã (nhấp đúp vào U1) để sửa chương trình, chạy từng lệnh và xem thanh ghi.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 1 }]);
  return d;
}

/** 52 — a seven-segment counter driven by an 8051 through a code table. */
export function mcuSevenSegmentSample(): Design {
  const b = new DesignBuilder('Seven-segment counter with an 8051');
  const d = b.design;
  d.description =
    'Vi điều khiển 8051 đếm 0…9 ra LED 7 đoạn kiểu anode chung ở cổng P1, dùng bảng mã tra bằng lệnh MOVC A,@A+DPTR. Bộ định thời 0 chế độ 1 đếm 50 000 chu kỳ máy (50 ms) và ngắt; sau 10 lần ngắt (0,5 s) số đếm tăng 1. Mã trong bảng là mã tích cực thấp vì anode chung nối lên +5 V. ' +
    'An 8051 counts 0…9 on a common-anode seven-segment display on port 1, using a code table read with MOVC A,@A+DPTR. Timer 0 in mode 1 counts 50,000 machine cycles (50 ms) and interrupts; after ten interrupts (0.5 s) the count goes up by one. The table holds active-low codes because the common anode is tied to +5 V.';
  const program = asmLines(
    '; Dem 0..9 ra LED 7 doan anode chung tren P1',
    'TICKS   EQU  30h            ; so lan ngat con lai',
    'DIGIT   EQU  31h            ; chu so dang hien',
    '        ORG  0',
    '        LJMP MAIN',
    '        ORG  0Bh            ; vec-to Timer 0',
    '        LJMP T0ISR',
    '',
    '        ORG  30h',
    'MAIN:   MOV  SP,#60h',
    '        MOV  TMOD,#01h      ; Timer 0, che do 1 (16 bit)',
    '        MOV  TH0,#3Ch       ; 65536 - 50000 = 15536 = 3CB0h',
    '        MOV  TL0,#0B0h',
    '        MOV  IE,#82h        ; EA + ET0',
    '        SETB TR0',
    '        MOV  TICKS,#10',
    '        MOV  DIGIT,#0',
    '        ACALL SHOW',
    'LOOP:   SJMP LOOP',
    '',
    'T0ISR:  MOV  TH0,#3Ch       ; nap lai 50 ms',
    '        MOV  TL0,#0B0h',
    '        DJNZ TICKS,DONE',
    '        MOV  TICKS,#10      ; 10 x 50 ms = 0,5 s',
    '        MOV  A,DIGIT',
    '        INC  A',
    '        CJNE A,#10,KEEP',
    '        MOV  A,#0',
    'KEEP:   MOV  DIGIT,A',
    '        ACALL SHOW',
    'DONE:   RETI',
    '',
    'SHOW:   MOV  A,DIGIT        ; tra bang ma 7 doan',
    '        MOV  DPTR,#TABLE',
    '        MOVC A,@A+DPTR',
    '        MOV  P1,A',
    '        RET',
    '',
    '; bit 0 = a ... bit 6 = g, muc 0 la sang (anode chung)',
    'TABLE:  DB   0C0h,0F9h,0A4h,0B0h,99h',
    '        DB   92h,82h,0F8h,80h,90h',
    '        END',
  );
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 300, { value: '5' });
  gnd(b, 100, 380);
  b.wire(b.pin(v1, '-'), p(100, 380));
  b.labelPin(v1, '+', 'VCC');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 340, 280, { program, fosc: '12M' });
  const disp = b.part('indicators/seven-seg-ca', 'DS1', 760, 260);
  const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  segs.forEach((seg, k) => {
    const r = b.part('basic/resistor', `R${k + 1}`, 580, 160 + k * 40, { value: '330' });
    b.labelPin(u1, `P1.${k}`, `S${k}`);
    b.labelPin(r, '1', `S${k}`);
    b.labelPin(r, '2', `SEG${k}`);
    b.labelPin(disp, seg, `SEG${k}`);
  });
  b.labelPin(disp, 'CA', 'VCC');
  note(b, 60, 440, 'Bảng mã nằm trong chương trình (TABLE). Timer 0 ngắt mỗi 50 ms; sau 10 lần thì tăng số đếm. Mở Trình soạn mã để xem thanh ghi TL0 / TH0 chạy.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-3, tstop: 3 }]);
  return d;
}

/** 53 — reading a push-button on P1.2 and mirroring it to an LED on P1.0. */
export function mcuButtonSample(): Design {
  const b = new DesignBuilder('Read a push-button with an 8051');
  const d = b.design;
  d.description =
    'Vi điều khiển 8051 đọc nút nhấn ở chân P1.2 và bật LED ở P1.0 mỗi lần nhấn (đảo trạng thái). Nút nối chân xuống đất; chân được treo lên +5 V bằng điện trở trong của 8051, nên không nhấn thì đọc được mức 1. Chương trình chờ 20 ms để chống dội và chờ nhả nút. Bấm Chạy (F5) rồi nhấp vào nút S1 (hoặc nhấn phím Space). ' +
    'An 8051 reads a push-button on P1.2 and toggles an LED on P1.0 at every press. The button pulls the pin to ground; the pin is held up by the internal pull-up of the 8051, so an unpressed button reads 1. The program waits 20 ms to debounce and then waits for the release. Press Run (F5), then click S1 (or press Space).';
  const program = asmLines(
    '; Doc nut nhan o P1.2, dao LED o P1.0',
    '        ORG  0',
    '        SETB P1.0           ; LED tat (muc 1)',
    'WAIT:   JB   P1.2,WAIT      ; cho tai khi nut keo chan xuong 0',
    '        ACALL DELAY20       ; chong doi',
    '        JB   P1.2,WAIT      ; con nhieu thi bo qua',
    '        CPL  P1.0           ; dao LED',
    'REL:    JNB  P1.2,REL       ; cho nha nut',
    '        ACALL DELAY20',
    '        SJMP WAIT',
    '',
    'DELAY20: MOV R7,#40         ; 40 x 503 chu ky = 20120 us',
    'D1:     MOV  R6,#250',
    'D2:     DJNZ R6,D2',
    '        DJNZ R7,D1',
    '        RET',
    '        END',
  );
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 260, { value: '5' });
  gnd(b, 100, 340);
  b.wire(b.pin(v1, '-'), p(100, 340));
  b.labelPin(v1, '+', 'VCC');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 380, 260, { program, fosc: '12M' });
  const sw = b.part('basic/push-button', 'S1', 220, 360, { key: 'Space' }, { rotation: 90 });
  b.labelPin(u1, 'P1.2', 'BTN');
  b.labelPin(sw, '1', 'BTN');
  b.labelPin(sw, '2', 'GND');
  const r1 = b.part('basic/resistor', 'R1', 600, 180, { value: '330' });
  const led = b.part('diodes/led-green', 'LED1', 700, 240, {}, { rotation: 90 });
  b.labelPin(r1, '1', 'VCC');
  b.labelPin(r1, '2', 'A');
  b.labelPin(led, 'A', 'A');
  b.labelPin(led, 'K', 'P1_0');
  b.labelPin(u1, 'P1.0', 'P1_0');
  b.probe('digital', b.pin(u1, 'P1.2').x, b.pin(u1, 'P1.2').y, 'BTN');
  note(b, 60, 420, 'Không cần điện trở treo ngoài: chân P1 của 8051 đã được treo lên bằng điện trở trong khoảng 50 kΩ. Nút nhấn chỉ cần kéo chân xuống đất.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 1 }]);
  return d;
}

/** 54 — the serial port: the 8051 sends "Hello" to the virtual terminal. */
export function mcuSerialSample(): Design {
  const b = new DesignBuilder('8051 sends Hello on the serial port');
  const d = b.design;
  d.description =
    'Vi điều khiển 8051 gửi chữ "Hello MachSim" ra cổng nối tiếp ở 9600 baud, rồi lặp lại sau mỗi lần nhấn. Thạch anh 11,0592 MHz với TH1 = 0FDh (Timer 1 chế độ 2) cho đúng 9600 baud: thời gian một bit = 32 × 3 = 96 chu kỳ máy = 104,2 µs. Mở Trình soạn mã (nhấp đúp vào U1), chọn thẻ Cửa sổ nối tiếp rồi bấm Chạy: chữ hiện dần ra. Gõ vào ô dưới và bấm Gửi để gửi ký tự về vi điều khiển — chương trình phát lại (echo) những gì nhận được. ' +
    'An 8051 sends "Hello MachSim" on the serial port at 9600 baud and then echoes whatever it receives. An 11.0592 MHz crystal with TH1 = 0FDh (timer 1 in mode 2) gives exactly 9600 baud: one bit lasts 32 x 3 = 96 machine cycles = 104.2 us. Open the code editor (double-click U1), choose the Serial terminal tab and press Run: the text appears. Type in the box and press Send to send characters back — the program echoes them.';
  const program = asmLines(
    '; Gui "Hello MachSim" roi phat lai nhung gi nhan duoc, 9600 baud',
    '        ORG  0',
    '        MOV  TMOD,#20h      ; Timer 1 che do 2 (tu nap lai)',
    '        MOV  TH1,#0FDh      ; 9600 baud voi thach anh 11,0592 MHz',
    '        MOV  TL1,#0FDh',
    '        SETB TR1',
    '        MOV  SCON,#50h      ; UART 8 bit, cho phep nhan',
    '        MOV  DPTR,#MSG',
    'SEND:   CLR  A',
    '        MOVC A,@A+DPTR',
    '        JZ   ECHO           ; ket thuc chuoi',
    '        ACALL PUTC',
    '        INC  DPTR',
    '        SJMP SEND',
    '',
    'ECHO:   JNB  RI,ECHO        ; cho mot byte tu cua so noi tiep',
    '        CLR  RI',
    '        MOV  A,SBUF',
    '        ACALL PUTC',
    '        SJMP ECHO',
    '',
    'PUTC:   MOV  SBUF,A',
    'TXW:    JNB  TI,TXW',
    '        CLR  TI',
    '        RET',
    '',
    "MSG:    DB   'Hello MachSim',0Dh,0Ah,0",
    '        END',
  );
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 260, { value: '5' });
  gnd(b, 100, 340);
  b.wire(b.pin(v1, '-'), p(100, 340));
  b.labelPin(v1, '+', 'VCC');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 380, 260, { program, fosc: '11.0592M' });
  const r1 = b.part('basic/resistor', 'R1', 620, 220, { value: '4.7k' });
  b.labelPin(u1, 'P3.1', 'TXD');
  b.labelPin(r1, '1', 'TXD');
  b.labelPin(r1, '2', 'VCC');
  b.probe('voltage', b.pin(u1, 'P3.1').x, b.pin(u1, 'P3.1').y, 'TXD');
  note(b, 60, 400, 'Điện trở 4,7 kΩ treo chân TXD lên +5 V (chân 8051 chỉ hút dòng) và là tải để xem dạng sóng trên chân TXD bằng đầu dò. Cửa sổ nối tiếp của Trình soạn mã đọc trực tiếp thanh ghi SBUF, nên không cần nối dây gì thêm.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-5, tstop: 0.02 }]);
  return d;
}

/** Builders of the sample files 11–54 by file name (metadata in examples.ts). */
export const SAMPLE_BUILDERS: Record<string, () => Design> = {
  ...LADDER_SAMPLE_BUILDERS,
  ...ELECTRO_SAMPLE_BUILDERS,
  '11-ohms-law.msim': ohmsLawSample,
  '12-series-parallel.msim': seriesParallelSample,
  '13-rc-charging.msim': rcChargingSample,
  '14-rlc-resonance.msim': rlcResonanceSample,
  '15-wheatstone-bridge.msim': wheatstoneSample,
  '16-diode-iv.msim': diodeIvSample,
  '17-zener-regulator.msim': zenerRegulatorSample,
  '18-led-resistor.msim': ledResistorSample,
  '19-bjt-switch.msim': bjtSwitchSample,
  '20-non-inverting-amplifier.msim': nonInvertingSample,
  '21-summing-amplifier.msim': summingAmpSample,
  '22-integrator.msim': integratorSample,
  '23-schmitt-trigger.msim': schmittTriggerSample,
  '24-logic-gates.msim': logicGatesSample,
  '25-flipflop-divider.msim': flipflopDividerSample,
  '26-binary-counter.msim': binaryCounterSample,
  '27-555-monostable.msim': monostable555Sample,
  '28-r2r-dac.msim': r2rDacSample,
  '29-pwm-comparator.msim': pwmComparatorSample,
  '30-full-wave-ct.msim': fullWaveCtSample,
  '31-regulator-7805.msim': regulator7805Sample,
  '32-voltage-doubler.msim': voltageDoublerSample,
  '33-lc-tank.msim': lcTankSample,
  '34-am-detector.msim': amDetectorSample,
  '35-transmission-line.msim': transmissionLineSample,
  '36-wattmeter.msim': wattmeterSample,
  '37-spectrum-square.msim': spectrumSquareSample,
  '38-word-generator.msim': wordGeneratorSample,
  '39-parameter-sweep.msim': paramSweepSample,
  '40-temperature-sweep.msim': temperatureSweepSample,
  '41-monte-carlo.msim': monteCarloSample,
  '42-fourier-clipper.msim': fourierClipperSample,
  '43-subcircuit-cascade.msim': subcircuitCascadeSample,
  '44-multi-sheet.msim': multiSheetSample,
  '45-hierarchical-block.msim': hierBlockSample,
  '46-block-control-loop.msim': blockLoopSample,
  '47-reference-ground.msim': referenceGroundSample,
  '48-real-capacitor.msim': realCapacitorSample,
  '49-pll-lock.msim': pllLockSample,
  '50-dip-switch-leds.msim': dipSwitchLedsSample,
  '51-mcu-blink.msim': mcuBlinkSample,
  '52-mcu-seven-segment.msim': mcuSevenSegmentSample,
  '53-mcu-button.msim': mcuButtonSample,
  '54-mcu-serial.msim': mcuSerialSample,
};
