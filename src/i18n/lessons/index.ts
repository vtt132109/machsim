/**
 * Text of the guided lessons (Vietnamese first, English second), loaded with the Lessons panel.
 *
 * - LESSON_TEXT[lessonId]: title, goal, theory (MachSim markup, src/model/richText.ts, with
 *   $formulas$), each step's task and hint, each quiz question with options and explanation.
 * - FEEDBACK: generic check feedback ({value}, {target} … params; {part} is a noun).
 * - NOTES: lesson-specific feedback (`note:<key>` ids returned by the checks).
 * - NOUNS, LEVELS: names used in feedback and in the lesson list.
 * Written for MachSim from general circuit theory; lessons.test.ts checks that every lesson,
 * step, quiz question and note used by src/learn has its text in both languages.
 */
import { L, type LocalizedText } from '../core';
import type { LessonLevel, NounId } from '../../learn/types';
import { BASICS_TEXT } from './basics';
import { SEMIS_TEXT } from './semis';
import { AMPS_TEXT } from './amps';
import { DIGITAL_TEXT } from './digital';
import { MCU_TEXT } from './mcu';
import { LADDER_LESSON_TEXT } from './ladder';
import { ROUND3_TEXT } from './round3';
import { ROUND4_NOTES, ROUND4_TEXT } from './round4';
import { ROUND4B_NOTES, ROUND4B_TEXT } from './round4b';

export interface LessonStepText {
  task: LocalizedText;
  hint: LocalizedText;
}

export interface QuizText {
  q: LocalizedText;
  options: LocalizedText[];
  why: LocalizedText;
}

export interface LessonText {
  title: LocalizedText;
  goal: LocalizedText;
  /** MachSim markup */
  theory: LocalizedText;
  steps: Record<string, LessonStepText>;
  quiz: Record<string, QuizText>;
}

export const LESSON_TEXT: Record<string, LessonText> = { ...BASICS_TEXT, ...SEMIS_TEXT, ...AMPS_TEXT, ...DIGITAL_TEXT, ...MCU_TEXT, ...LADDER_LESSON_TEXT, ...ROUND3_TEXT, ...ROUND4_TEXT, ...ROUND4B_TEXT };

export const LEVELS: Record<LessonLevel, LocalizedText> = {
  basics: L('Mạch điện cơ bản', 'Circuit basics'),
  semiconductors: L('Linh kiện bán dẫn', 'Semiconductors'),
  amplifiers: L('Op-amp và bộ định thời', 'Op-amps and timers'),
  digital: L('Mạch số', 'Digital circuits'),
  automation: L('Điều khiển tự động', 'Automation'),
  workflow: L('Kỹ năng dùng MachSim', 'Working with MachSim'),
};

export const NOUNS: Record<NounId, LocalizedText> = {
  mcu: L('vi điều khiển 8051', '8051 microcontroller'),
  source: L('nguồn áp DC', 'DC voltage source'),
  acSource: L('nguồn xoay chiều (nguồn AC hoặc máy phát hàm)', 'AC source (AC voltage source or function generator)'),
  pulseSource: L('nguồn xung', 'pulse voltage source'),
  resistor: L('điện trở', 'resistor'),
  capacitor: L('tụ điện', 'capacitor'),
  diode: L('diode', 'diode'),
  led: L('LED', 'LED'),
  zener: L('diode Zener', 'Zener diode'),
  npn: L('transistor NPN', 'NPN transistor'),
  opamp: L('op-amp', 'op-amp'),
  comparator: L('bộ so sánh (hoặc op-amp)', 'comparator (or op-amp)'),
  timer: L('IC 555', '555 timer'),
  andGate: L('cổng AND', 'AND gate'),
  probeLight: L('đèn đầu dò', 'probe light'),
  dff: L('flip-flop D', 'D flip-flop'),
  clock: L('nguồn xung nhịp', 'clock source'),
  counter: L('IC đếm 7490', '7490 counter'),
  decoder: L('IC giải mã 7447', '7447 decoder'),
  display: L('LED 7 đoạn', '7-segment display'),
  adc: L('ADC 8 bit', '8-bit ADC'),
  dac: L('DAC 8 bit', '8-bit DAC'),
  meter: L('đồng hồ vạn năng', 'multimeter'),
  scope: L('dao động ký', 'oscilloscope'),
  ground: L('đất', 'ground'),
};

/** Generic feedback of the checks (FEEDBACK ids without the "note:" prefix). */
export const FEEDBACK: Record<string, LocalizedText> = {
  okValue: L('Đúng: {value}.', 'Correct: {value}.'),
  needPart: L('Chưa thấy {part} trên sơ đồ.', 'There is no {part} on the schematic yet.'),
  needCount: L('Cần {n} {part}, hiện có {have}.', '{n} × {part} needed, {have} placed.'),
  needValue: L('Đặt giá trị của {part} là {value}.', 'Set the {part} to {value}.'),
  meterMode: L('Chuyển đồng hồ vạn năng sang chế độ {mode} (nhấp đúp vào đồng hồ để mở mặt máy).', 'Switch the multimeter to {mode} (double-click the meter to open its panel).'),
  measured: L('Đo được {value}; cần {target} ± {tol} %.', 'Measured {value}; {target} ± {tol} % needed.'),
  measuredAbs: L('Đo được {value}; cần {target} ± {band}.', 'Measured {value}; {target} ± {band} needed.'),
  range: L('Đo được {value}; cần trong khoảng {min} … {max}.', 'Measured {value}; {min} … {max} needed.'),
  simFailed: L('Chưa mô phỏng được mạch: {message}', 'The circuit could not be simulated: {message}'),
  ercError: L('Mạch còn lỗi: {message}', 'The circuit has a problem: {message}'),
  internal: L('Không kiểm tra được bước này: {message}', 'This step could not be checked: {message}'),
};

/** Lesson-specific feedback ("note:<key>"). */
export const NOTES: Record<string, LocalizedText> = {
  needInputModule: L('Chưa có mô-đun vào của giá PLC. Thư viện: nhóm “Số linh tinh” → họ “Giá PLC” → “Mô-đun vào PLC 8 kênh”.', 'There is no PLC input module yet. Library: Misc digital → “PLC rack” → “PLC input module, 8 channels”.'),
  needOutputModule: L('Chưa có mô-đun ra. Chương trình cần nó để điều khiển đèn hay cuộn dây khởi động từ.', 'There is no output module yet. The program needs one to drive a lamp or a contactor coil.'),
  needLadderSheet: L('Chưa có trang sơ đồ bậc thang có bậc nào: menu Đặt → Trang sơ đồ bậc thang, rồi nhấn “Thêm bậc”.', 'There is no ladder sheet with rungs yet: Place → Ladder sheet, then press “Add rung”.'),
  needTwoButtons: L('Cần hai nút nhấn: một khởi động, một dừng.', 'Two push-buttons are needed: one start, one stop.'),
  wireTwoChannels: L('Hãy nối hai kênh của mô-đun vào (ví dụ I0 và I1) tới hai nút nhấn.', 'Wire two channels of the input module (for example I0 and I1) to the two push-buttons.'),
  wireOneOutput: L('Chưa nối kênh ra nào: nối chân Q0 tới tải.', 'No output channel is wired yet: connect pin Q0 to the load.'),
  needLoad: L('Kênh ra chưa có tải: nối một đèn, LED, động cơ hay mô hình cơ điện tử từ chân Q0 xuống COM.', 'The output channel has no load: wire a lamp, an LED, a motor or a mechatronics model from pin Q0 down to COM.'),
  needRung: L('Trang bậc thang chưa có bậc nào.', 'The ladder sheet has no rungs yet.'),
  ladderError: L('Bậc {line} còn lỗi — xem dòng chữ đỏ dưới bậc đó trên trang bậc thang.', 'Rung {line} still has a problem — see the red line under that rung on the ladder sheet.'),
  needCoil: L('Chưa có bậc nào có cuộn dây ở một địa chỉ ngõ ra (Q0.0 …).', 'No rung drives a coil at an output address (Q0.0 …) yet.'),
  needSelfHold: L('Bậc chưa tự giữ: hãy thêm một tiếp điểm thường mở của chính cuộn dây (Q0.0) SONG SONG với tiếp điểm nút khởi động.', 'The rung does not hold itself yet: add a normally-open contact of the coil itself (Q0.0) IN PARALLEL with the start contact.'),
  needStopContact: L('Bậc chỉ đọc một ngõ vào: còn thiếu tiếp điểm của nút dừng nối tiếp với nhóm kia.', 'The rung reads only one input: the stop contact in series with the other group is still missing.'),
  doesNotHold: L('Chạy thử chương trình của bạn: nhả nút khởi động là cuộn dây mất điện (hoặc nút dừng không tắt được). Xem lại chỗ nối song song và nối tiếp.', 'Running your program shows it: releasing the start button drops the coil out (or the stop button cannot switch it off). Look again at what is in parallel and what is in series.'),
  holdsOk: L('Đúng rồi: nhấn một lần là chạy mãi, nhấn dừng là tắt — mạch tự giữ đã hoạt động.', 'That is it: one press runs for ever and the stop button switches it off — the self-holding rung works.'),

  asmError: L('Chương trình có lỗi ở dòng {line}. Mở Trình soạn mã (nhấp đúp vào vi điều khiển) để xem và sửa.', 'The program has an error on line {line}. Open the code editor (double-click the microcontroller) to see and fix it.'),
  noProgram: L('Vi điều khiển chưa có chương trình nào.', 'The microcontroller has no program yet.'),
  needAsm: L('Bài này cần mã nguồn hợp ngữ (không phải Intel HEX) để kiểm tra từng lệnh.', 'This lesson needs assembly source (not Intel HEX) so the instructions can be checked.'),
  touchPin: L('Chương trình chưa đổi mức chân P1.0 — dùng CPL P1.0 (hoặc SETB / CLR P1.0, hoặc ghi cả cổng bằng MOV P1,…).', 'The program never changes pin P1.0 — use CPL P1.0 (or SETB / CLR P1.0, or write the whole port with MOV P1,…).'),
  needLoop: L('Chương trình chưa có vòng lặp: thêm SJMP MAIN ở cuối để chạy mãi.', 'The program has no loop: add SJMP MAIN at the end so it runs for ever.'),
  noPinNet: L('Chân P1.0 chưa nối vào đâu cả.', 'Pin P1.0 is not connected to anything.'),
  needResistor: L('Cần một điện trở hạn dòng nối tiếp với LED.', 'A series current-limiting resistor is needed with the LED.'),
  ledToPin: L('LED và điện trở phải nối từ nguồn +5 V xuống chính chân P1.0 (anốt về phía nguồn, catốt về phía chân).', 'The LED and its resistor must run from the +5 V supply down to pin P1.0 itself (anode towards the supply, cathode towards the pin).'),
  noBlink: L('Chân P1.0 không đổi mức trong 0,3 giây mô phỏng. Kiểm tra vòng trễ (đừng để quá dài) và chân RST có bị giữ ở mức cao không.', 'Pin P1.0 never changed level in 0.3 s of simulation. Check the delay loop (do not make it too long) and whether RST is held high.'),
  blinkOk: L('Chân P1.0 đổi mức {edges} lần: chu kỳ nháy khoảng {period}.', 'Pin P1.0 changed {edges} times: the blink period is about {period}.'),

  // lessons written in the app (src/learn/lessonFile.ts): the described checks
  filePart: L('Cần {n} linh kiện loại “{part}”, hiện có {have}.', '{n} part(s) of kind “{part}” needed, {have} placed.'),
  fileConnect: L('Chưa nối {from} với {to}.', '{from} is not connected to {to} yet.'),
  fileConnectMissing: L('Chưa đủ linh kiện để kiểm tra chỗ nối {from} – {to}.', 'Not enough parts yet to check the connection {from} – {to}.'),
  fileNet: L('Chưa có net nào tên “{net}”: hãy đặt nhãn đó lên dây cần đo.', 'No net is named “{net}” yet: put that label on the wire to measure.'),
  fileReading: L('Không đọc được “{reading}” từ mạch: {message}.', 'Cannot take the “{reading}” reading from the circuit: {message}.'),
  fileReadingProbe: L('Phép đo này cần điện áp của một net có nhãn hoặc trên một linh kiện.', 'This measurement needs the voltage of a named net or across a part.'),
  fileErcOk: L('Mạch không còn lỗi điện.', 'The circuit has no electrical errors.'),
  fileErcEmpty: L('Trang sơ đồ còn trống: hãy vẽ mạch trước đã.', 'The sheet is still empty: draw the circuit first.'),

  // round 3: two RC stages (snippets)
  twoStages: L('Chưa thấy hai tầng RC: mỗi tầng là một điện trở nối tiếp với một tụ.', 'No two RC stages yet: a stage is one resistor in series with one capacitor.'),
  stagesSame: L('Hai tầng giống nhau, hằng số thời gian τ = {tau}.', 'The two stages are the same, with a time constant τ = {tau}.'),
  stagesDiffer: L('Hai tầng có R·C khác nhau: bài này cần hai tầng giống hệt (dùng lại cùng một đoạn mạch).', 'The two stages have different R·C products: this lesson needs two identical stages (reuse the same snippet).'),
  cascade: L('Hai tầng chưa nối tiếp nhau: điểm ra của tầng một phải là điểm vào của tầng hai.', 'The stages are not cascaded yet: the output of the first stage must be the input of the second.'),
  cascadeOk: L('Hai tầng đã nối tiếp nhau.', 'The two stages are cascaded.'),
  needLabels2: L('Hãy đặt nhãn net: {names}.', 'Add the net label(s): {names}.'),
  twiceOk: L('Tại fc = {fc}, biên độ ra chỉ còn {value} lần biên độ vào — dốc gấp đôi một tầng.', 'At fc = {fc} the output is {value} of the input — twice as steep as one stage.'),
  twiceWrong: L('Tại fc = {fc} tỉ số ra/vào là {value}; hai tầng RC giống nhau phải cho khoảng 0,3 … 0,6.', 'At fc = {fc} the output / input ratio is {value}; two identical RC stages give about 0.3 … 0.6.'),

  // round 3: assembly variants
  needVariants: L('Chưa có hai phương án lắp ráp: mở Công cụ › Quản lý phương án và thêm phương án thứ hai.', 'There are not two assembly variants yet: open Tools › Variant manager and add a second one.'),
  variantsOk: L('Thiết kế có {n} phương án lắp ráp.', 'The design has {n} assembly variants.'),
  needNotFitted: L('Chưa phương án nào bỏ bớt linh kiện: trong Quản lý phương án, bỏ dấu “Gắn” của một linh kiện.', 'No variant leaves a part off yet: untick "Fitted" for a part in the variant manager.'),
  notFittedOk: L('Phương án “{name}” bỏ {n} linh kiện.', 'Variant “{name}” leaves {n} part(s) off.'),
  needActive: L('Hãy chọn phương án có linh kiện bị bỏ làm phương án đang dùng (Công cụ › Phương án đang dùng).', 'Make the variant that leaves a part off the active one (Tools › Active variant).'),
  activeOk: L('Phương án đang dùng là “{name}”.', 'The active variant is “{name}”.'),
  darkOk: L('Với phương án “{name}”, linh kiện không gắn không có dòng, linh kiện còn lại vẫn sáng.', 'With variant “{name}” the not-fitted part carries no current and the other one still lights.'),
  stillLit: L('Linh kiện không gắn vẫn có dòng: kiểm tra lại dấu “Gắn” và phương án đang dùng.', 'The not-fitted part still carries current: check the "Fitted" ticks and the active variant.'),
  noneLit: L('Không linh kiện nào sáng: phương án này bỏ hết mất rồi.', 'Nothing lights at all: this variant leaves everything off.'),

  // round 3: .meas
  tauIs: L('Hằng số thời gian của mạch: τ = R·C = {tau}.', 'The time constant of the circuit: τ = R·C = {tau}.'),
  tauOutOfRange: L('τ = {tau} quá lớn hoặc quá nhỏ cho bài này; chọn R và C để τ khoảng 1 µs … 10 ms.', 'τ = {tau} is too large or too small for this lesson; choose R and C for τ ≈ 1 µs … 10 ms.'),
  needMeasCard: L('Chưa có thẻ .meas nào: mở Mô phỏng › Thiết lập phân tích › SPICE riêng và thêm một dòng “.meas tran …”.', 'There is no .meas card yet: open Simulate › Analysis settings › Custom SPICE and add a ".meas tran …" line.'),
  measCardOk: L('Thẻ .meas “{name}” đã có.', 'The .meas card “{name}” is there.'),
  measCardWhat: L('Thẻ .meas cần nói đo cái gì: dùng WHEN, AT, FIND hoặc TRIG / TARG.', 'A .meas card has to say what it measures: use WHEN, AT, FIND or TRIG / TARG.'),
  measFailed: L('Phép đo “{name}” không thực hiện được (điều kiện không bao giờ xảy ra). Kiểm tra mức điện áp và thời gian mô phỏng.', 'The measurement “{name}” did not happen (its condition never occurred). Check the voltage level and the simulation time.'),
  measOk: L('{name} = {value}, đúng bằng τ = {tau}.', '{name} = {value}, exactly τ = {tau}.'),

  // round 3: a real capacitor
  needRealCap: L('Bài này cần “Tụ điện không lý tưởng” (nhóm Linh kiện cơ bản), không phải tụ lý tưởng.', 'This lesson needs the "non-ideal capacitor" (the Basic group), not the ideal one.'),
  needEsl: L('Hãy đặt điện dung và điện cảm nối tiếp ESL khác 0 cho tụ.', 'Give the capacitor a capacitance and a non-zero series inductance ESL.'),
  f0Is: L('Tần số tự cộng hưởng tính theo giá trị bạn đặt: f₀ = {f0}.', 'The self-resonance from your own values: f₀ = {f0}.'),
  lowFreqOk: L('Ở {f} tụ vẫn là tụ: gần hết điện áp rơi trên tụ ({value}).', 'At {f} the capacitor is still a capacitor: almost all the voltage is across it ({value}).'),
  lowFreqBad: L('Ở tần số thấp điện áp trên tụ chỉ còn {value}: điện trở nối tiếp của mạch quá lớn, hãy dùng điện trở cảm biến nhỏ (1 Ω).', 'At a low frequency only {value} is left across the capacitor: the series resistor is too large, use a small sense resistor (1 Ω).'),
  resonanceOk: L('Ở f₀ = {f0} tụ gần như nối tắt: chỉ còn {value}, đúng bằng phần của ESR = {esr}.', 'At f₀ = {f0} the capacitor is almost a short: only {value} is left, which is the share of its ESR = {esr}.'),
  resonanceBad: L('Ở f₀ = {f0} điện áp trên tụ còn {value}; nếu ESL và C đúng thì phải xuống dưới 0,2.', 'At f₀ = {f0} the voltage across the capacitor is still {value}; with the right ESL and C it has to fall below 0.2.'),

  // round 3: the hysteresis block
  needHyst: L('Chưa có khối trễ (Schmitt): nhóm Tương tự → họ Hàm điều khiển → “Khối trễ (Schmitt)”.', 'There is no hysteresis (Schmitt) block yet: Analog → Control functions → "Hysteresis (Schmitt) block".'),
  hystOrder: L('Ngưỡng trên phải lớn hơn ngưỡng dưới.', 'The upper threshold has to be above the lower one.'),
  hystIs: L('Hai ngưỡng của khối: {vlow} và {vhigh}.', 'The block’s two thresholds: {vlow} and {vhigh}.'),
  hystIn: L('Nối một nguồn vào chân IN của khối (sóng tam giác là dễ thấy nhất).', 'Connect a source to the block’s IN pin (a triangle wave shows it best).'),
  hystOut: L('Chân OUT của khối chưa nối vào đâu: nối vào dao động ký hay một tải.', 'The block’s OUT pin goes nowhere: connect an oscilloscope or a load.'),
  hystNoEdge: L('Đầu ra không đổi mức lần nào: biên độ tín hiệu vào phải vượt cả hai ngưỡng.', 'The output never changed level: the input has to swing past both thresholds.'),
  hystOk: L('Đầu ra lật lên ở {up} và lật xuống ở {down} — đúng hai ngưỡng đã đặt.', 'The output flips up at {up} and down at {down} — exactly the two thresholds you set.'),
  hystWrong: L('Đầu ra lật lên ở {up} (cần {vhigh}) và lật xuống ở {down} (cần {vlow}).', 'The output flips up at {up} ({vhigh} needed) and down at {down} ({vlow} needed).'),

  // round 3: the transfer-function block
  needTf: L('Chưa có khối truyền đạt H(s): nhóm Tương tự → họ Hàm điều khiển → “Hàm truyền H(s)”.', 'There is no transfer-function block yet: Analog → Control functions → "Transfer function H(s)".'),
  tfCoeff: L('Hãy đặt dạng nhập là “hệ số” để nhập tử số và mẫu số.', 'Set the entry form to "coefficients" so you can type the numerator and the denominator.'),
  tfFirstOrder: L('Bài này cần bộ lọc bậc một: tử số một hệ số, mẫu số hai hệ số (ví dụ “159.155u 1”).', 'This lesson needs a first-order filter: one numerator coefficient and two denominator ones (for example “159.155u 1”).'),
  tfWire: L('Nối chân IN và chân OUT của khối (OUT cần một tải hoặc một thiết bị đo).', 'Wire the block’s IN and OUT pins (OUT needs a load or an instrument).'),
  tfIs: L('Tần số cắt tính từ hệ số của bạn: fc = {fc}.', 'The corner frequency from your own coefficients: fc = {fc}.'),
  tfCutoffOk: L('Tại fc = {fc} biên độ ra bằng {value} lần biên độ vào — đúng −3 dB.', 'At fc = {fc} the output is {value} of the input — exactly −3 dB.'),
  tfDecadeOk: L('Ở {f} (gấp mười fc) biên độ ra giảm {db} dB — đúng 20 dB mỗi decade của bậc một.', 'At {f} (ten times fc) the output is {db} dB — the 20 dB per decade of a first-order filter.'),
  tfDecadeBad: L('Ở gấp mười fc biên độ ra giảm {db} dB; bậc một phải giảm khoảng 20 dB.', 'Ten times past fc the output is {db} dB; a first-order filter has to fall about 20 dB.'),

  // round 3: one IC, four gates
  needRealAnd: L('Bài này cần một vi mạch AND thật (7408, 74LS08, 4081 …), không phải ký hiệu một cổng.', 'This lesson needs a real AND IC (7408, 74LS08, 4081 …), not the single-gate teaching symbol.'),
  packageIs: L('Đã đặt vi mạch {name}: một vỏ có {n} cổng.', '{name} placed: one package with {n} gates.'),
  sectionIs: L('Đã đặt một cổng rời của vi mạch {name}.', 'One single gate of the {name} package placed.'),
  needCascade: L('Chưa dùng hai cổng của cùng một vi mạch: nối đầu ra cổng thứ nhất vào một đầu vào của cổng thứ hai.', 'Two gates of the same IC are not in use yet: wire the first gate’s output into an input of the second.'),
  cascadeGatesOk: L('Hai cổng của cùng một vi mạch đã nối tiếp nhau.', 'Two gates of one IC are cascaded.'),

  // round 3: a real flip-flop
  needRealFf: L('Bài này cần flip-flop D thật (7474, 74LS74, 4013 …).', 'This lesson needs a real D flip-flop (7474, 74LS74, 4013 …).'),
  ffIs: L('Đã đặt {name}: một vỏ có hai flip-flop.', '{name} placed: one package with two flip-flops.'),
  asyncOk: L('Chân {pin} đã được treo lên mức cao nên không xoá hay đặt flip-flop nữa.', 'Pin {pin} is held high, so it no longer presets or clears the flip-flop.'),
  asyncOpen: L('Chân {pin} còn để hở: hãy nối lên VCC cho chắc chắn (chân hở dễ nhiễu trên mạch thật).', 'Pin {pin} is left open: tie it to VCC to be safe (an open pin picks up noise on a real board).'),

  // round 3: an 8051 reading a button
  needButton: L('Chưa có nút nhấn nào trên sơ đồ.', 'There is no push-button on the schematic yet.'),
  buttonToPin: L('Nối nút nhấn vào một chân cổng của vi điều khiển (ví dụ P1.0).', 'Wire the push-button to a port pin of the microcontroller (P1.0 for example).'),
  buttonGround: L('Nút nhấn phải nối chân cổng xuống đất: cổng 8051 đã có điện trở treo lên bên trong.', 'The button has to pull the port pin down to ground: an 8051 port already has its pull-up inside.'),
  buttonOk: L('Nút nhấn kéo chân cổng xuống đất — đúng cách với cổng 8051.', 'The button pulls the port pin to ground — the right way with an 8051 port.'),
  ledToMcu: L('Nối LED và điện trở hạn dòng từ nguồn +5 V xuống một chân cổng khác.', 'Wire the LED and its series resistor from the +5 V supply down to another port pin.'),
  ledOk: L('LED nối qua điện trở xuống chân {pin}.', 'The LED runs through its resistor down to pin {pin}.'),
  programRead: L('Chương trình chưa đọc chân nút: dùng MOV C,P1.0 (hoặc JB / JNB P1.0,…).', 'The program never reads the button pin: use MOV C,P1.0 (or JB / JNB P1.0,…).'),
  programWrite: L('Chương trình chưa ghi ra chân LED: dùng MOV P1.1,C (hoặc SETB / CLR P1.1).', 'The program never writes the LED pin: use MOV P1.1,C (or SETB / CLR P1.1).'),
  programOk: L('Chương trình dịch xong: {n} byte mã máy, có đọc chân vào và ghi chân ra.', 'The program builds: {n} bytes of machine code that read an input pin and write an output pin.'),
  pressButton: L('Nhấn nút (đặt tham số “Đang nhấn” là có, hoặc nhấn phím của nút khi đang mô phỏng).', 'Press the button (set its "pressed" parameter, or press the button’s key while the simulation runs).'),
  litOk: L('LED sáng với dòng {value} khi nút được nhấn.', 'The LED lights with {value} while the button is pressed.'),
  notLit: L('LED chưa sáng (dòng {value}): kiểm tra chiều LED, điện trở và chương trình.', 'The LED does not light (current {value}): check the LED direction, the resistor and the program.'),

  // round 3: a ladder traffic light
  needThreeLamps: L('Cần ba đèn (đỏ, vàng, xanh) nối vào ba kênh ra; hiện có {have}.', 'Three lamps (red, amber, green) on three output channels are needed; {have} placed.'),
  rackOk: L('Giá PLC có mô-đun ra và {n} đèn.', 'The PLC rack has its output module and {n} lamps.'),
  needTimer: L('Chương trình chưa có bộ định thời: bài này cần một bộ định thời TON làm nhịp cho cả vòng.', 'The program has no timer: this lesson needs one TON timer as the clock of the whole cycle.'),
  needCompare: L('Chưa có tiếp điểm so sánh: so thời gian đã chạy của bộ định thời (T1.ET) với các mốc.', 'No comparison contact yet: compare the timer’s elapsed time (T1.ET) with the switching points.'),
  timerOk: L('Chương trình có bộ định thời và tiếp điểm so sánh.', 'The program has a timer and comparison contacts.'),
  needThreeCoils: L('Cần ba cuộn dây ở ba địa chỉ ra khác nhau (Q0.0, Q0.1, Q0.2); hiện có {have}.', 'Three coils at three different output addresses (Q0.0, Q0.1, Q0.2) are needed; {have} found.'),
  lampsOk: L('Chương trình điều khiển {n} ngõ ra.', 'The program drives {n} outputs.'),
  twoLamps: L('Có lúc hai đèn sáng cùng nhau: các mốc so sánh còn chồng lấn, hãy chia vòng thành ba khoảng rời nhau.', 'Two lamps are on at the same time: the comparison points still overlap, split the cycle into three separate stretches.'),
  lampNeverOn: L('{n} đèn không bao giờ sáng trong cả vòng: xem lại các mốc so sánh.', '{n} lamp(s) never light during the whole cycle: look at the comparison points again.'),
  cycleOk: L('Chạy thử một vòng: mỗi đèn sáng {list} — không bao giờ có hai đèn cùng sáng.', 'Running one cycle: the lamps are on for {list} — never two at once.'),

  // Ohm
  noCurrent: L('Chưa có dòng điện qua điện trở: hai chân điện trở phải nối với hai cực của nguồn, và cực − nối đất.', 'No current flows through the resistor: connect its two pins to the two source terminals and ground the − terminal.'),
  ammeterSeries: L('Đồng hồ đo dòng đọc 0: muốn đo dòng phải cắt mạch và mắc đồng hồ nối tiếp, để dòng đi qua đồng hồ.', 'The ammeter reads 0: to measure current, break the loop and put the meter in series so the current flows through it.'),
  // divider
  needTwo: L('Cần một nguồn áp và hai điện trở.', 'A voltage source and two resistors are needed.'),
  notSeries: L('Chưa thấy điểm giữa của cầu phân áp: nối hai điện trở nối tiếp từ cực + của nguồn xuống đất.', 'No divider midpoint found: connect the two resistors in series from the source’s + terminal to ground.'),
  meterLower: L('Mắc đồng hồ song song với điện trở phía dưới (điện trở nối đất).', 'Connect the meter across the lower resistor (the one tied to ground).'),
  // series / parallel
  noParallel: L('Chưa có hai điện trở song song: hai điện trở song song có cả hai chân nối chung với nhau.', 'No parallel pair yet: two resistors are in parallel when both of their pins are joined.'),
  meterParallel: L('Mắc đồng hồ song song với cặp điện trở song song.', 'Connect the meter across the parallel pair.'),
  // Kirchhoff
  noJunction: L('Chưa thấy nút rẽ nhánh: dòng qua một điện trở phải chia ra hai điện trở khác.', 'No branching node yet: the current of one resistor must split into two others.'),
  kcl: L('Định luật nút đúng: {main} = {a} + {b}.', 'The current law holds: {main} = {a} + {b}.'),
  notMain: L('Đồng hồ đọc {value} — đó chưa phải dòng mạch chính. Mắc đồng hồ nối tiếp với điện trở đầu tiên.', 'The meter reads {value} — not the main current. Put it in series with the first resistor.'),
  notBranch: L('Đồng hồ đọc {value} — chưa phải dòng của một nhánh. Mắc đồng hồ nối tiếp với một trong hai điện trở song song.', 'The meter reads {value} — not a branch current. Put it in series with one of the two branch resistors.'),
  // RC charging
  rcWiring: L('Nối: cực + của nguồn xung → điện trở → tụ điện → đất.', 'Wire it: pulse source + → resistor → capacitor → ground.'),
  scopeOnCap: L('Nối kênh A (cực +) của dao động ký vào chân trên của tụ điện.', 'Connect oscilloscope channel A (+) to the top pin of the capacitor.'),
  tauRange: L('Hằng số thời gian τ = {tau} quá lớn hoặc quá nhỏ cho bài này; chọn R và C để τ khoảng 1 ms … 1 s.', 'The time constant τ = {tau} is too large or too small for this lesson; choose R and C for τ ≈ 1 ms … 1 s.'),
  pulseShort: L('Xung quá ngắn so với τ = {tau}: đặt độ rộng xung của nguồn ít nhất 3τ.', 'The pulse is too short for τ = {tau}: set the source’s pulse width to at least 3τ.'),
  tauOk: L('Sau τ = {tau}, tụ đã nạp tới {value} — đúng 63 % điện áp nguồn.', 'After τ = {tau} the capacitor reaches {value} — 63 % of the step.'),
  // RC filter
  lowpassWiring: L('Nối kiểu lọc thông thấp: nguồn + → điện trở → điểm ra; tụ từ điểm ra xuống đất.', 'Wire a low-pass: source + → resistor → output; capacitor from the output to ground.'),
  filterGainOk: L('Tại fc = {fc} biên độ ra chỉ còn {gain} lần biên độ vào (−3 dB).', 'At fc = {fc} the output is {gain} × the input (−3 dB).'),
  // diode
  reversed: L('Diode đang phân cực ngược (cathode phía nguồn +). Xoay diode lại (phím R hai lần).', 'The diode is reverse-biased (cathode towards +). Turn it round (press R twice).'),
  tooLittle: L('Dòng qua diode mới {value}; kiểm tra điện trở và nguồn.', 'The diode carries only {value}; check the resistor and the source.'),
  notReversed: L('Hãy xoay diode để cathode (vạch) hướng về cực + của nguồn.', 'Turn the diode so its cathode (band) faces the source’s + terminal.'),
  blocking: L('Diode chặn: dòng ngược chỉ {value}.', 'The diode blocks: the reverse current is only {value}.'),
  leaking: L('Dòng ngược {value} còn lớn; kiểm tra lại cách nối.', 'A reverse current of {value} is too large; check the wiring.'),
  meterAcrossDiode: L('Mắc đồng hồ (chế độ V) song song với diode.', 'Connect the meter (V mode) across the diode.'),
  // LED
  ledOff: L('LED không sáng: kiểm tra chiều LED (anode về phía cực +) và các dây nối.', 'The LED is dark: check its direction (anode towards +) and the wiring.'),
  set12: L('Đổi giá trị nguồn thành 12 V trước.', 'Change the source to 12 V first.'),
  // Zener
  zenerForward: L('Diode Zener đang phân cực thuận. Zener làm việc khi phân cực ngược: cathode về phía cực +.', 'The Zener is forward-biased. A Zener regulates in reverse: cathode towards +.'),
  zenerOff: L('Zener gần như không dẫn ({value}). Giảm điện trở nối tiếp hoặc tăng điện áp nguồn.', 'The Zener hardly conducts ({value}). Use a smaller series resistor or a higher supply.'),
  noLoad: L('Mắc thêm một điện trở tải song song với diode Zener.', 'Add a load resistor across the Zener.'),
  loadOk: L('Có tải: điện áp ra {value}, Zener vẫn dẫn {iz}.', 'With the load: output {value}, the Zener still carries {iz}.'),
  noSource: L('Cần một nguồn áp DC có giá trị dương.', 'A DC voltage source with a positive value is needed.'),
  lineOk: L('Nguồn tăng 3 V mà điện áp ra chỉ đổi {dv}: ổn áp tốt.', 'The supply rose by 3 V and the output changed by only {dv}: good regulation.'),
  lineBad: L('Nguồn tăng 3 V thì điện áp ra đổi {dv}: Zener chưa ổn áp. Kiểm tra điện trở nối tiếp.', 'A 3 V supply change moves the output by {dv}: the Zener does not regulate. Check the series resistor.'),
  // rectifier
  rectWiring: L('Nối: nguồn xoay chiều → anode diode; cathode → điện trở tải → đất.', 'Wire it: AC source → diode anode; cathode → load resistor → ground.'),
  acSettings: L('Đặt biên độ nguồn xoay chiều lớn hơn 1 V và tần số dưới 100 kHz.', 'Set the AC amplitude above 1 V and the frequency below 100 kHz.'),
  negative: L('Điện áp ra xuống tới {value}: diode chưa chặn nửa chu kỳ âm.', 'The output goes down to {value}: the diode does not block the negative half.'),
  noFilter: L('Mắc tụ lọc song song với điện trở tải.', 'Connect a filter capacitor across the load resistor.'),
  rippleOk: L('Gợn sóng chỉ còn {value}.', 'The ripple is down to {value}.'),
  rippleBig: L('Gợn sóng {value} còn lớn: dùng tụ lớn hơn (ví dụ 470 µF).', 'A ripple of {value} is still large: use a bigger capacitor (e.g. 470 µF).'),
  scopeOnOut: L('Nối kênh A của dao động ký vào điện áp ra (chân trên của tải).', 'Connect oscilloscope channel A to the output (top of the load).'),
  // transistor switch
  emitterGround: L('Nối chân E (emitter) của transistor xuống đất.', 'Connect the transistor’s emitter (E) to ground.'),
  baseResistor: L('Cấp vào chân B qua một điện trở (ví dụ 1 kΩ), không nối thẳng vào nguồn.', 'Drive the base (B) through a resistor (e.g. 1 kΩ), never straight from the source.'),
  noBase: L('VBE mới {value}: transistor chưa được mở. Cấp điện áp vào cho điện trở base.', 'VBE is only {value}: the transistor is off. Apply a voltage to the base resistor.'),
  ledDim: L('Dòng LED mới {value}: kiểm tra LED và điện trở ở cực C.', 'The LED carries only {value}: check the LED and the collector resistor.'),
  saturated: L('Transistor bão hòa: VCE = {vce}, LED sáng với {i}.', 'The transistor saturates: VCE = {vce}, the LED is lit with {i}.'),
  notSaturated: L('VCE = {vce}: transistor chưa bão hòa. Giảm điện trở base để tăng dòng IB.', 'VCE = {vce}: not saturated. Use a smaller base resistor for more base current.'),
  stillOn: L('VBE = {value}: transistor vẫn mở. Đặt điện áp vào bằng 0 V.', 'VBE = {value}: the transistor is still on. Set the input to 0 V.'),
  offOk: L('Transistor tắt: dòng LED chỉ {value}.', 'The transistor is off: the LED current is only {value}.'),
  // common emitter
  meterCE: L('Mắc đồng hồ giữa chân C và chân E của transistor.', 'Connect the meter between the transistor’s C and E pins.'),
  noRE: L('Không thấy điện trở emitter (từ chân E xuống đất).', 'No emitter resistor (from E to ground) found.'),
  noBypass: L('Mắc một tụ song song với điện trở emitter RE.', 'Connect a capacitor across the emitter resistor RE.'),
  smallBypass: L('Tụ thoát {value} quá nhỏ ở 1 kHz; dùng ít nhất 10 µF (ví dụ 100 µF).', 'A {value} bypass is too small at 1 kHz; use at least 10 µF (e.g. 100 µF).'),
  needLabels: L('Mạch mẫu dùng nhãn IN và OUT; đừng xoá hai nhãn đó.', 'The starter circuit names its nets IN and OUT; keep those labels.'),
  ceGainOk: L('Hệ số khuếch đại ≈ {gain} lần ở 1 kHz.', 'The gain is ≈ {gain} at 1 kHz.'),
  ceGainLow: L('Hệ số khuếch đại mới {gain}: tụ thoát chưa làm việc. Kiểm tra tụ song song với RE.', 'The gain is only {gain}: the bypass is not working. Check the capacitor across RE.'),
  scopeInOut: L('Nối kênh A vào IN và kênh B vào OUT của cùng một dao động ký.', 'Connect channel A to IN and channel B to OUT on one oscilloscope.'),
  // op-amps
  supplyPins: L('Op-amp này có chân nguồn V+ và V−: nối chúng vào nguồn (hoặc dùng op-amp lý tưởng 3 chân).', 'This op-amp has supply pins V+ and V−: connect them (or use the 3-terminal ideal op-amp).'),
  plusToGround: L('Nối chân + (không đảo) của op-amp xuống đất.', 'Connect the op-amp’s + (non-inverting) input to ground.'),
  feedbackNet: L('Cần điện trở hồi tiếp từ OUT về chân − và điện trở vào từ nguồn tới chân −.', 'A feedback resistor from OUT to the − input and an input resistor from the source to the − input are needed.'),
  needInput: L('Đặt điện áp vào khác 0 (ví dụ nguồn DC 0.5 V).', 'Apply a non-zero input (e.g. a 0.5 V DC source).'),
  gainOk: L('Hệ số khuếch đại {gain} (Vout = {vout}).', 'Gain {gain} (Vout = {vout}).'),
  gainWrong: L('Hệ số khuếch đại đo được {gain}; chọn lại hai điện trở.', 'The measured gain is {gain}; choose the two resistors again.'),
  sourceToPlus: L('Nối cực + của nguồn tín hiệu vào chân + của op-amp.', 'Connect the signal source’s + terminal to the op-amp’s + input.'),
  dividerFeedback: L('Cần RF từ OUT về chân − và RG từ chân − xuống đất.', 'RF from OUT to the − input and RG from the − input to ground are needed.'),
  outToMinus: L('Bộ đệm: nối thẳng OUT vào chân − (bỏ hai điện trở).', 'Follower: wire OUT straight to the − input (remove both resistors).'),
  followerOk: L('Bộ đệm: hệ số khuếch đại {gain}.', 'Follower: gain {gain}.'),
  // comparator
  refDivider: L('Tạo điện áp chuẩn ở chân − bằng cầu chia hai điện trở.', 'Make the reference at the − input with a two-resistor divider.'),
  raiseInput: L('Chân + đang ở {value}: tăng điện áp vào lên trên mức chuẩn.', 'The + input is at {value}: raise the input above the reference.'),
  outHigh: L('V+ > V− nên đầu ra lên mức cao ({value}).', 'V+ > V− so the output is high ({value}).'),
  outNotHigh: L('Đầu ra mới {value}; kiểm tra nguồn cấp của bộ so sánh.', 'The output is only {value}; check the comparator’s supply.'),
  lowerInput: L('Chân + đang ở {value}: giảm điện áp vào xuống dưới mức chuẩn.', 'The + input is at {value}: lower the input below the reference.'),
  outLow: L('V+ < V− nên đầu ra xuống mức thấp ({value}).', 'V+ < V− so the output is low ({value}).'),
  outNotLow: L('Đầu ra vẫn {value}; kiểm tra chân V− của bộ so sánh (nối đất).', 'The output is still {value}; check the comparator’s V− pin (to ground).'),
  // 555
  gndPin: L('Nối chân GND của 555 xuống đất.', 'Connect the 555’s GND pin to ground.'),
  vccPin: L('Cấp nguồn 5 V … 15 V cho chân VCC.', 'Supply 5 V … 15 V to the VCC pin.'),
  resetHigh: L('Nối chân RST (reset) lên VCC, nếu không 555 không chạy.', 'Tie RST (reset) to VCC, otherwise the 555 stays off.'),
  joinThrTrig: L('Nối chân THR và TRIG với nhau.', 'Join the THR and TRIG pins.'),
  timingCap: L('Mắc tụ định thời từ THR/TRIG xuống đất.', 'Connect the timing capacitor from THR/TRIG to ground.'),
  timingResistors: L('Cần R1 từ VCC tới DIS và R2 từ DIS tới THR/TRIG.', 'R1 from VCC to DIS and R2 from DIS to THR/TRIG are needed.'),
  freqRange: L('Tần số tính được {value} quá xa 1 kHz; chọn lại R1, R2 và C.', 'The predicted {value} is far from 1 kHz; choose R1, R2 and C again.'),
  freqOk: L('Đo được {value} (tính theo công thức: {predicted}).', 'Measured {value} (formula: {predicted}).'),
  freqWrong: L('Đo được {value} (công thức: {predicted}); cần 1 kHz ± 10 %.', 'Measured {value} (formula: {predicted}); 1 kHz ± 10 % needed.'),
  // gates
  inputOpen: L('Chân vào {pin} còn để hở; nối vào một công tắc logic hoặc nguồn.', 'Input {pin} is open; connect it to a logic switch or a source.'),
  probeOnY: L('Nối đèn đầu dò vào chân ra Y của cổng.', 'Connect the probe light to the gate output Y.'),
  setInputsHigh: L('Bật cả hai đầu vào lên mức 1 (trạng thái “on”).', 'Set both inputs to 1 (“on”).'),
  outOne: L('1 AND 1 = 1: đầu ra {value}, đèn sáng.', '1 AND 1 = 1: the output is {value}, the light is on.'),
  outNotOne: L('Đầu ra {value}; kiểm tra lại cổng.', 'The output is {value}; check the gate.'),
  setInputLow: L('Tắt một đầu vào (mức 0).', 'Switch one input off (0).'),
  outZero: L('Chỉ cần một đầu vào bằng 0 là đầu ra AND bằng 0 ({value}).', 'One 0 input makes the AND output 0 ({value}).'),
  outNotZero: L('Đầu ra vẫn {value}; đây có đúng là cổng AND không?', 'The output is still {value}; is this really an AND gate?'),
  // flip-flop
  clockToClk: L('Nối nguồn xung nhịp vào chân CLK.', 'Connect the clock source to CLK.'),
  asyncLow: L(
    'Chân {pin} (đặt / xoá không đồng bộ, tác động mức thấp) đang nối đất nên flip-flop bị giữ cứng. Nối chân đó lên VCC, hoặc để hở.',
    'Pin {pin} (an active-low preset / clear) is tied to ground, so the flip-flop is held fast. Tie it to VCC, or leave it open.',
  ),
  qnToD: L('Nối QN về D để flip-flop đảo trạng thái ở mỗi xung nhịp.', 'Connect QN back to D so the flip-flop toggles on every clock.'),
  clockRange: L('Đặt tần số xung nhịp trong khoảng 1 Hz … 1 MHz.', 'Set the clock between 1 Hz and 1 MHz.'),
  divided: L('Q dao động {value} = {clock} / 2.', 'Q runs at {value} = {clock} / 2.'),
  watchQ: L('Nối dao động ký (hoặc máy phân tích logic) vào Q để xem.', 'Connect an oscilloscope (or logic analyzer) to Q to watch it.'),
  // counter
  clockToCka: L('Nối nguồn xung nhịp vào chân CKA của 7490.', 'Connect the clock to the 7490’s CKA.'),
  qaToCkb: L('Nối QA vào CKB để 7490 đếm 0 … 9.', 'Connect QA to CKB so the 7490 counts 0 … 9.'),
  resetLow: L('Nối R01 (hoặc R02) xuống đất, nếu không bộ đếm bị xoá liên tục.', 'Tie R01 (or R02) to ground, otherwise the counter is held at 0.'),
  setNineLow: L('Nối R91 (hoặc R92) xuống đất, nếu không bộ đếm bị đặt 9 liên tục.', 'Tie R91 (or R92) to ground, otherwise the counter is held at 9.'),
  decoderInputs: L('Nối QA, QB, QC, QD của 7490 vào A, B, C, D của 7447 (chưa đúng: {pin}).', 'Connect the 7490’s QA … QD to the 7447’s A … D (wrong: {pin}).'),
  segment: L('Đoạn {seg}: nối SEG của 7447 tới chân {seg} của LED (qua một điện trở).', 'Segment {seg}: connect the 7447 SEG output to display pin {seg} (through a resistor).'),
  commonPin: L('Nối chân chung (CA) của LED 7 đoạn lên VCC.', 'Connect the display’s common pin (CA) to VCC.'),
  counted: L('Bộ đếm chạy: {seq}.', 'The counter runs: {seq}.'),
  countWrong: L('Dãy đếm chưa đúng: {seq}.', 'The count sequence is wrong: {seq}.'),
  // ADC / DAC
  vinOpen: L('Nối điện áp cần đo vào chân VIN của ADC.', 'Connect the voltage to measure to the ADC’s VIN.'),
  vrefnGround: L('Nối VREF− của ADC xuống đất.', 'Connect the ADC’s VREF− to ground.'),
  code: L('Mã số {code} = {bin} cho Vin = {vin}.', 'Code {code} = {bin} for Vin = {vin}.'),
  codeWrong: L('ADC cho mã {code}, cần {expected}. Kiểm tra VREF+ và VIN.', 'The ADC gives {code}, {expected} expected. Check VREF+ and VIN.'),
  bitsToDac: L('Nối D0 … D7 của ADC vào D0 … D7 của DAC (chưa đúng: {pin}).', 'Connect the ADC’s D0 … D7 to the DAC’s D0 … D7 (wrong: {pin}).'),
  dacRef: L('DAC phải dùng cùng điện áp chuẩn VREF+ với ADC.', 'The DAC must use the same VREF+ as the ADC.'),
  backOk: L('DAC cho lại {value}, sai khác không quá 1 LSB ({lsb}).', 'The DAC gives back {value}, within 1 LSB ({lsb}).'),
  backWrong: L('DAC cho {value}, trong khi Vin = {vin}.', 'The DAC gives {value} while Vin = {vin}.'),
  // round-4 lessons (src/i18n/lessons/round4.ts, round4b.ts)
  ...ROUND4_NOTES,
  ...ROUND4B_NOTES,
};

/** Text of a feedback id ("okValue" or "note:<key>"); undefined for an unknown id. */
export function feedbackText(id: string): LocalizedText | undefined {
  return id.startsWith('note:') ? NOTES[id.slice(5)] : FEEDBACK[id];
}
