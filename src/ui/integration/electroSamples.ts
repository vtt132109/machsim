/**
 * Samples of the round-4 electromechanical and sound parts:
 *
 *   70  start-stop contactor circuit: a coil on one sheet, its contacts on the other, an overload relay
 *   71  on-delay and off-delay timer relays side by side
 *   72  two tones through an RC low-pass and a buffer into a speaker (open Simulate › Audio)
 *
 * Built by code like the other samples (src/ui/integration/sampleDesigns.ts); the .msim files in
 * examples/ are their serialised output (MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts
 * rewrites them). Nets are joined by net labels so the sheets stay readable; "GND" is ground. Every
 * sample passes ERC without a warning and runs its saved analyses.
 */
import { DesignBuilder } from '../../model/designkit';
import type { Design, TextNote } from '../../model/types';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';

/** Note with an id that is unique across the whole design. */
function note(b: DesignBuilder, x: number, y: number, text: string): void {
  const n: TextNote = { id: `note${b.sheet.notes.length + 1}_${b.sheet.id}`, x, y, text, size: 11 };
  b.sheet.notes.push(n);
}

function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): void {
  d.analysis = { active, specs: {} };
  for (const s of specs) d.analysis.specs[s.type] = s;
}

/** Part with its pins named on nets (pin -> net label). */
function put(b: DesignBuilder, id: string, ref: string, x: number, y: number, pins: Record<string, string>, params: Record<string, string> = {}) {
  const h = b.part(id, ref, x, y, params);
  for (const [pin, net] of Object.entries(pins)) b.labelPin(h, pin, net);
  return h;
}

export function contactorStartStopSample(): Design {
  const b = new DesignBuilder('Start-stop contactor with holding contact and overload');
  const d = b.design;
  d.description =
    'Mạch mở – dừng kinh điển: cuộn KM1 ở trang “Điều khiển”, tiếp điểm chính của nó ở trang “Mạch lực” (ghi KM1 vào ô Cuộn hút). Nhấn phím G để mở, phím X để dừng; tiếp điểm phụ KC1 tự giữ cuộn. Tải bị kẹt kéo 6 A qua rơ-le nhiệt đặt 1 A: sau vài giây rơ-le nhiệt tác động, tiếp điểm 95-96 mở và cuộn nhả. ' +
    'The classic start-stop circuit: coil KM1 on the “Control” sheet, its main contact on the “Power” sheet (type KM1 in the Coil field). Press G to start, X to stop; the auxiliary contact KC1 holds the coil in. A jammed load draws 6 A through an overload relay set to 1 A: after a few seconds the relay trips, the 95-96 contact opens and the coil drops out.';
  // sheet 1: control circuit, 24 V
  put(b, 'sources/dc-voltage', 'V1', 80, 250, { '+': 'P24', '-': 'GND' }, { value: '24' });
  put(b, 'basic/push-button', 'S2', 220, 120, { '1': 'P24', '2': 'A' }, { contact: 'nc', key: 'X' });
  put(b, 'basic/push-button', 'S1', 380, 120, { '1': 'A', '2': 'B' }, { contact: 'no', key: 'G' });
  put(b, 'electromechanical/contactor-aux-no', 'KC1', 380, 220, { '13': 'A', '14': 'B' }, { coil: 'KM1' });
  put(b, 'electromechanical/overload-contact-nc', 'KC2', 540, 120, { '95': 'B', '96': 'C' }, { coil: 'FR1' });
  put(b, 'electromechanical/contactor-coil-24vdc', 'KM1', 700, 160, { A1: 'C', A2: 'GND' });
  put(b, 'indicators/lamp', 'X1', 840, 160, { '1': 'C', '2': 'GND' }, { vrated: '24', prated: '2' });
  note(b, 60, 340, 'Điều khiển 24 V: Dừng (S2, thường đóng, phím X) → Mở (S1, phím G) song song tiếp điểm tự giữ KC1 (cuộn KM1) → tiếp điểm rơ-le nhiệt 95-96 → cuộn KM1.');
  note(b, 60, 360, 'Đèn X1 sáng khi cuộn KM1 có điện. Rơ-le nhiệt FR1 nằm ở trang “Mạch lực”.');
  // sheet 2: power circuit, 12 V
  b.addSheet('Mạch lực');
  put(b, 'sources/dc-voltage', 'V2', 80, 250, { '+': 'PWR', '-': 'GND' }, { value: '12' });
  put(b, 'electromechanical/contactor-contact-3p', 'KC3', 260, 160, { L1: 'PWR', T1: 'M1' }, { coil: 'KM1' });
  put(b, 'electromechanical/overload-relay-1p', 'FR1', 440, 160, { L1: 'M1', T1: 'M2' }, { ir: '1', class: '10A' });
  put(b, 'basic/resistor', 'RM', 620, 160, { '1': 'M2', '2': 'GND' }, { value: '1.99' });
  note(b, 60, 340, 'Mạch lực: tiếp điểm chính KC3 (theo cuộn KM1 ở trang Điều khiển) → rơ-le nhiệt FR1 (1 A, cấp 10A) → tải RM 2 Ω = động cơ bị kẹt (6 A).');
  note(b, 60, 360, 'Cùng một tên “KM1” nối cuộn với tiếp điểm dù chúng ở hai trang khác nhau. Nhấn R (Reset) để đặt lại rơ-le nhiệt.');
  b.useSheet(0);
  d.sheets[0].name = 'Điều khiển';
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 0.5 }]);
  return d;
}

export function timerRelaysSample(): Design {
  const b = new DesignBuilder('On-delay and off-delay timer relays');
  const d = b.design;
  d.description =
    'Hai rơ-le thời gian cùng nhận một xung 24 V từ 1 s đến 6 s: KT1 trễ đóng 3 s nên đèn X1 chỉ sáng từ giây thứ 4; KT2 trễ mở 3 s nên đèn X2 sáng ngay từ giây thứ 1 và tắt ở giây thứ 9. Xem cả hai đèn trong Grapher sau khi chạy phân tích quá độ. ' +
    'Two timer relays get the same 24 V pulse from 1 s to 6 s: KT1 is an on-delay of 3 s so lamp X1 lights only from second 4; KT2 is an off-delay of 3 s so lamp X2 lights at once from second 1 and goes out at second 9. Look at both lamps in the Grapher after running the transient analysis.';
  put(b, 'sources/pwl-voltage', 'V1', 80, 250, { '+': 'COIL', '-': 'GND' }, { points: '0 0, 1 0, 1.001 24, 6 24, 6.001 0, 10 0' });
  put(b, 'electromechanical/timer-coil-on-delay', 'KT1', 260, 150, { A1: 'COIL', A2: 'GND' }, { delay: '3' });
  put(b, 'electromechanical/timer-coil-off-delay', 'KT2', 260, 300, { A1: 'COIL', A2: 'GND' }, { delay: '3' });
  put(b, 'sources/dc-voltage', 'V2', 80, 460, { '+': 'SUP', '-': 'GND' }, { value: '24' });
  put(b, 'electromechanical/timer-contact-no', 'KC1', 520, 150, { '17': 'SUP', '18': 'L1' }, { coil: 'KT1' });
  put(b, 'electromechanical/timer-contact-no', 'KC2', 520, 300, { '17': 'SUP', '18': 'L2' }, { coil: 'KT2' });
  put(b, 'indicators/lamp', 'X1', 700, 150, { '1': 'L1', '2': 'GND' }, { vrated: '24', prated: '2' });
  put(b, 'indicators/lamp', 'X2', 700, 300, { '1': 'L2', '2': 'GND' }, { vrated: '24', prated: '2' });
  note(b, 60, 540, 'KT1 (trễ đóng) → tiếp điểm KC1 → đèn X1: sáng 3 s SAU khi cuộn có điện. KT2 (trễ mở) → tiếp điểm KC2 → đèn X2: tắt 3 s SAU khi cuộn mất điện.');
  note(b, 60, 560, 'Đổi “Thời gian trễ” của KT1 / KT2 trong Thuộc tính rồi chạy lại; vẽ V(L1) và V(L2) trong Grapher.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-3, tstop: 10 }]);
  return d;
}

export function speakerFilterSample(): Design {
  const b = new DesignBuilder('Listen to a filter: two tones through an RC low-pass');
  const d = b.design;
  d.description =
    'Hai âm 440 Hz (2 V) và 3 kHz (1 V) cộng lại, đi qua bộ lọc thông thấp R1–C1 (fc ≈ 1,6 kHz) và mạch đệm op-amp rồi tới loa LS1. Mở Mô phỏng › Âm thanh rồi nhấn Chạy: bạn nghe âm trầm rõ, âm cao nhỏ đi. Đổi C1 để dời tần số cắt. ' +
    'Two tones, 440 Hz (2 V) and 3 kHz (1 V), are added, pass the R1–C1 low-pass (fc ≈ 1.6 kHz) and an op-amp buffer and reach speaker LS1. Open Simulate › Audio and press Run: the low tone is clear and the high one is weaker. Change C1 to move the cut-off.';
  put(b, 'sources/ac-voltage', 'V1', 80, 250, { '+': 'IN', '-': 'M' }, { amplitude: '2', freq: '440' });
  put(b, 'sources/ac-voltage', 'V2', 80, 400, { '+': 'M', '-': 'GND' }, { amplitude: '1', freq: '3k' });
  put(b, 'basic/resistor', 'R1', 260, 160, { '1': 'IN', '2': 'F' }, { value: '1k' });
  put(b, 'basic/capacitor', 'C1', 380, 250, { '1': 'F', '2': 'GND' }, { value: '100n' });
  put(b, 'analog/opamp-ideal-3', 'U1', 540, 180, { 'IN+': 'F', 'IN-': 'OUT', OUT: 'OUT' });
  put(b, 'indicators/speaker', 'LS1', 720, 200, { '+': 'OUT', '-': 'GND' });
  note(b, 60, 480, 'Loa LS1 phát điện áp ở ngõ ra mạch đệm. V1 (440 Hz) đi qua gần như nguyên vẹn; V2 (3 kHz) bị giảm còn khoảng 47 %.');
  note(b, 60, 500, 'Mở Mô phỏng › Âm thanh để chỉnh âm lượng chung, tắt tiếng và xem vạch mức. Nếu mạch chạy chậm hơn thời gian thực, cửa sổ sẽ báo âm thanh bị kéo giãn.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 20e-3 }, { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e5 }]);
  return d;
}

export const ELECTRO_SAMPLE_BUILDERS: Record<string, () => Design> = {
  '70-contactor-start-stop.msim': contactorStartStopSample,
  '71-timer-relays.msim': timerRelaysSample,
  '72-speaker-filter.msim': speakerFilterSample,
};
