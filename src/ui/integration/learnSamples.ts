/**
 * Samples of round 4 step 9 (learner polish): one small circuit per round-4 feature, written so
 * a learner can open it, press Run and compare the result with the formula on the sheet.
 *
 *   90  hand-out: two sheets with page setup and layers saved in the design (Ctrl+P)
 *   91  two copies of one block, each with its own meter (instruments inside blocks)
 *   92  Parameter sweep of a schematic through the circuit's own `.step` card
 *   93  8051 delay loop of exactly 1000 machine cycles (step it in the debugger)
 *   94  battery runtime: a constant-current load against a resistor load
 *   95  7474 drawn as two sections of ONE chip: a divide-by-4 counter
 *   96  line transformer: regulation, loaded and unloaded
 *   97  I²t fuse against a miniature breaker on the same short circuit
 *   98  a recorded sensor waveform replayed from a measurement file
 *
 * Built by code like the other samples (src/ui/integration/sampleDesigns.ts); the .msim files in
 * examples/ are their serialised output (MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts
 * rewrites them). The English text of every note is in src/i18n/sampleNotes.ts. Nets are joined by
 * net labels; "GND" is ground. Every sample passes ERC without a warning and runs its saved
 * analyses. The numbers in the notes are checked by tests/review/round4/learner-samples.test.ts.
 */
import { EXACT_DELAY_PROGRAM } from '../../learn/lessons/mcu';
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

// ---------------------------------------------------------------------------------------------
// 90 hand-out

/** Corner frequency (Hz) of the 1 kΩ / 159 nF stages of the hand-out. */
export const HANDOUT_FC = 1 / (2 * Math.PI * 1000 * 159e-9);

export function handoutSample(): Design {
  const b = new DesignBuilder('Hand-out: low-pass and high-pass on two sheets');
  const d = b.design;
  d.description =
    'Một phiếu bài tập hai trang đã đặt sẵn để in: trang 1 là mạch lọc thông thấp, trang 2 là mạch lọc thông cao cùng R và C. Bấm Ctrl+P để xem trang in: khổ A4 nằm ngang, vừa trang, có chân trang và danh sách dụng cụ đo; tên net được bật bằng Sửa › Lớp hiển thị. Cả hai mạch có fc ≈ 1,0 kHz. ' +
    'A two-sheet worksheet that is already set up for printing: sheet 1 is a low-pass filter, sheet 2 a high-pass filter with the same R and C. Press Ctrl+P for the print preview: A4 landscape, fitted to the page, with a footer and the instrument list; net names are switched on in Edit › Layer settings. Both circuits have fc ≈ 1.0 kHz.';
  put(b, 'sources/ac-voltage', 'V1', 80, 250, { '+': 'IN', '-': 'GND' }, { amplitude: '1', freq: '1k' });
  put(b, 'basic/resistor', 'R1', 260, 160, { '1': 'IN', '2': 'OUT' }, { value: '1k' });
  put(b, 'basic/capacitor', 'C1', 400, 250, { '1': 'OUT', '2': 'GND' }, { value: '159n' });
  put(b, 'instruments/scope', 'XSC1', 600, 200, { 'A+': 'IN', 'B+': 'OUT' }, { timebase: '500u', 'A.scale': '500m', 'B.scale': '500m' });
  note(b, 60, 360, 'Trang 1, lọc thông thấp: fc = 1/(2π·R1·C1) ≈ 1,0 kHz. Ở fc biên độ ra còn 0,707 và trễ pha 45°.');
  note(b, 60, 380, 'Bấm Ctrl+P: chọn “Trang sơ đồ và trang bậc thang” và “Bảng cài đặt thiết bị đo”, đặt khổ giấy và xem trước. Cài đặt trang được lưu trong tệp.');
  b.addSheet('Bài tập');
  put(b, 'sources/ac-voltage', 'V2', 80, 250, { '+': 'IN', '-': 'GND' }, { amplitude: '1', freq: '1k' });
  put(b, 'basic/capacitor', 'C2', 260, 160, { '1': 'IN', '2': 'OUT' }, { value: '159n' });
  put(b, 'basic/resistor', 'R2', 400, 250, { '1': 'OUT', '2': 'GND' }, { value: '1k' });
  note(b, 60, 360, 'Trang 2, lọc thông cao: đổi chỗ R và C. Cũng fc ≈ 1,0 kHz nhưng tần số thấp bị chặn thay vì tần số cao.');
  note(b, 60, 380, 'Bài tập: chạy phân tích AC và so sánh biên độ V(OUT) của hai trang ở 100 Hz và 10 kHz.');
  b.useSheet(0);
  d.sheets[0].name = 'Lọc thông thấp';
  d.sheets[1].name = 'Bài tập';
  d.sheets[0].layers = { netNames: true };
  d.sheets[1].layers = { netNames: true };
  d.printSetup = { paper: 'A4', orientation: 'landscape', scale: 'fit', sheets: 'all', includeInstruments: true, footer: true, marginMm: 12 };
  setAnalyses(d, 'ac', [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e5 }, { type: 'tran', tstep: 1e-5, tstop: 5e-3 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 91 meters inside two copies of a block

export function blockMetersSample(): Design {
  const b = new DesignBuilder('Two copies of one block, each with its own meter');
  const d = b.design;
  d.description =
    'Khối DIV là một cầu phân áp R1 – R2 có sẵn đồng hồ XMM1 bên trong. Đặt hai bản X1 (RB = 1k) và X2 (RB = 3k): mỗi bản có đồng hồ riêng tên X1.XMM1 và X2.XMM1 và đọc đúng điện áp của bản mình: 2,5 V và 3,75 V. Nhấp đúp một khối để xem bên trong. ' +
    'The block DIV is an R1 – R2 divider with a meter XMM1 inside it. Two copies are placed, X1 (RB = 1k) and X2 (RB = 3k): each has its own meter, named X1.XMM1 and X2.XMM1, and reads the voltage of its own copy: 2.5 V and 3.75 V. Double-click a block to look inside.';
  const child = b.child('DIV', { kind: 'hierarchical', variables: { RB: '1k' } });
  b.label('IN', -100, 0, { kind: 'hier' });
  const r1 = b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 300, 0, { value: '{RB}' });
  const m = b.part('instruments/multimeter', 'XMM1', 500, 0);
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'MID');
  b.labelPin(r2, '1', 'MID');
  b.labelPin(r2, '2', 'GND');
  b.labelPin(m, '+', 'MID');
  b.labelPin(m, '-', 'GND');
  b.root();
  const v = b.part('sources/dc-voltage', 'V1', 80, 120, { value: '5' });
  const x1 = b.block(child, 'X1', 300, 120, { RB: '1k' });
  const x2 = b.block(child, 'X2', 300, 300, { RB: '3k' });
  b.labelPin(v, '+', 'VIN');
  b.labelPin(x1, 'IN', 'VIN');
  b.labelPin(x2, 'IN', 'VIN');
  b.labelPin(v, '-', 'GND');
  note(b, 60, 420, 'Vout = 5 V · RB / (1k + RB): X1 → 2,5 V, X2 → 3,75 V. Hai bản cùng một khối nhưng RB khác nhau, nên hai đồng hồ đọc khác nhau.');
  note(b, 60, 440, 'Bấm Chạy rồi mở bảng Mô phỏng: thiết bị đo được liệt kê theo đường dẫn (X1.XMM1, X2.XMM1). Mở một khối để xem cả đồng hồ lẫn LED của đúng bản đó.');
  setAnalyses(d, 'op', [{ type: 'op' }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 92 .step on a schematic

export function stepSweepSample(): Design {
  const b = new DesignBuilder('Parameter sweep of a schematic with a .step card');
  const d = b.design;
  d.description =
    'Bộ lọc RC có điện trở R1 = {Rx}, với Rx là tham số toàn cục của mạch (bảng Thuộc tính của mạch, mục Tham số toàn cục). Dòng “.step param Rx list 1k 2.2k 4.7k” trong ô SPICE của mạch làm phân tích AC chạy ba lần, mỗi lần một giá trị Rx, và vẽ ba đường chồng lên nhau: fc ≈ 1,59 kHz, 723 Hz và 339 Hz. ' +
    'An RC filter with R1 = {Rx}, where Rx is a global parameter of the circuit (the circuit Properties panel, under Global parameters). The line ".step param Rx list 1k 2.2k 4.7k" in the circuit\'s SPICE box makes the AC analysis run three times, once per Rx, and draws the three curves on top of each other: fc ≈ 1.59 kHz, 723 Hz and 339 Hz.';
  put(b, 'sources/ac-voltage', 'V1', 80, 250, { '+': 'IN', '-': 'GND' }, { amplitude: '1', freq: '1k' });
  put(b, 'basic/resistor', 'R1', 260, 160, { '1': 'IN', '2': 'OUT' }, { value: '{Rx}' });
  put(b, 'basic/capacitor', 'C1', 400, 250, { '1': 'OUT', '2': 'GND' }, { value: '100n' });
  d.variables = { Rx: '1k' };
  d.customSpice = '.step param Rx list 1k 2.2k 4.7k';
  note(b, 60, 350, 'fc = 1/(2π·Rx·C1): Rx = 1k → 1,59 kHz; 2,2k → 723 Hz; 4,7k → 339 Hz. Đường cong có R lớn hơn nằm bên trái.');
  note(b, 60, 370, 'Chọn phân tích AC rồi Chạy: Máy vẽ hiện ba đường, chú giải ghi Rx=1000, Rx=2200, Rx=4700. Cũng làm được bằng Mô phỏng › Thiết lập phân tích › Quét tham số, chọn “Tham số toàn cục (biến)”.');
  setAnalyses(d, 'ac', [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 40, fstart: 10, fstop: 1e5 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 93 8051 with an exact delay

/**
 * Half period of the LED in machine cycles: CPL (1) + ACALL (2) + SJMP (2) + MOV (1) + 32 x
 * (MOV 1 + 14 x DJNZ 2 + DJNZ 2) + RET (2) = 1000.
 */
export const DEBUG_HALF_PERIOD_CYCLES = 1000;

/** The program of sample 93, shared with the debugging lesson (src/learn/lessons/mcu.ts). */
export const DEBUG_PROGRAM = EXACT_DELAY_PROGRAM;

export function mcuDebugSample(): Design {
  const b = new DesignBuilder('8051 delay loop of exactly 1000 machine cycles');
  const d = b.design;
  d.description =
    'Chương trình 8051 đổi trạng thái P1.0 sau đúng 1000 chu kỳ máy = 1 ms (thạch anh 12 MHz), nên LED nháy 500 Hz. Mở Trình soạn mã (nhấp đúp U1), bấm “Bắt đầu gỡ lỗi”, đặt điểm dừng ở dòng ACALL rồi đi từng dòng (F10): sau CPL đồng hồ mạch chỉ 1 µs, sau ACALL DELAY… RET chỉ 1 ms. ' +
    'An 8051 program toggles P1.0 after exactly 1000 machine cycles = 1 ms (12 MHz crystal), so the LED blinks at 500 Hz. Open the code editor (double-click U1), press "Start debugging", set a breakpoint on the ACALL line and step by line (F10): after CPL the circuit clock reads 1 µs, after ACALL DELAY … RET it reads 1 ms.';
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 260, { value: '5' });
  b.labelPin(v1, '+', 'VCC');
  b.labelPin(v1, '-', 'GND');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 360, 260, { program: DEBUG_PROGRAM, fosc: '12M' });
  put(b, 'basic/resistor', 'R1', 560, 180, { '1': 'VCC', '2': 'A' }, { value: '330' });
  put(b, 'diodes/led-red', 'LED1', 660, 240, { A: 'A', K: 'P1_0' }, {});
  b.labelPin(u1, 'P1.0', 'P1_0');
  b.probe('voltage', b.pin(u1, 'P1.0').x, b.pin(u1, 'P1.0').y, 'P1.0');
  note(b, 60, 400, 'Một nửa chu kỳ: CPL 1 + ACALL 2 + SJMP 2 + MOV 1 + 32 × (MOV 1 + 14 × DJNZ 2 + DJNZ 2) + RET 2 = 1000 chu kỳ máy = 1 ms ở 12 MHz.');
  note(b, 60, 420, 'Trong gỡ lỗi, cột “Chu kỳ” của Bảng dịch và dòng trạng thái cho biết mỗi lệnh mất bao lâu; thử thêm một NOP rồi xem nửa chu kỳ thành 1001 chu kỳ.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 94 battery runtime

export function batteryRuntimeSample(): Design {
  const b = new DesignBuilder('Battery runtime: constant current against a resistor');
  const d = b.design;
  d.description =
    'Hai pin Li-ion giống nhau (5 mAh, đầy điện). BT1 nuôi tải dòng không đổi 50 mA nên cạn đúng sau C·3600/I = 0,005 · 3600 / 0,05 = 360 s. BT2 nuôi một điện trở 84 Ω (cũng khoảng 50 mA lúc đầu) nhưng điện áp pin tụt dần nên dòng giảm và pin trụ lâu hơn. Vẽ V(BT1.soc) và V(BT2.soc) trong Máy vẽ. ' +
    'Two identical Li-ion batteries (5 mAh, full). BT1 feeds a 50 mA constant-current load so it runs empty after exactly C·3600/I = 0.005 · 3600 / 0.05 = 360 s. BT2 feeds an 84 Ω resistor (also about 50 mA at first), but its voltage sags as it empties, the current falls and the battery lasts longer. Plot V(BT1.soc) and V(BT2.soc) in the Grapher.';
  put(b, 'sources/battery-nonideal', 'BT1', 160, 200, { '+': 'P1', '-': 'GND' }, { chem: 'liion', cells: '1', capacity: '0.005', soc: '100', r0: '0.05' });
  put(b, 'sources/dc-current', 'I1', 360, 200, { '+': 'GND', '-': 'P1' }, { value: '50m' });
  put(b, 'sources/battery-nonideal', 'BT2', 160, 380, { '+': 'P2', '-': 'GND' }, { chem: 'liion', cells: '1', capacity: '0.005', soc: '100', r0: '0.05' });
  put(b, 'basic/resistor', 'R1', 360, 380, { '1': 'P2', '2': 'GND' }, { value: '84' });
  note(b, 60, 500, 'Thời gian chạy ở dòng không đổi: t = C · 3600 / I. Mức điện tích V(BT1.soc) giảm đều từ 1 về 0 sau 360 s; điện áp pin tụt nhanh ở những giây cuối.');
  note(b, 60, 520, 'Tải điện trở: I = V/R giảm khi pin cạn, nên đường V(BT2.soc) cong và kéo dài hơn. Đổi “Hoá học” sang kiềm để thấy điện trở trong tăng mạnh hơn.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2, tstop: 420 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 95 one 7474 in two sections

export function dividerSectionsSample(): Design {
  const b = new DesignBuilder('A 7474 drawn as two sections: divide by four');
  const d = b.design;
  d.description =
    'Một vi mạch 7474 vẽ thành hai phần cùng tên U1: U1A (flip-flop 1) và U1B (flip-flop 2). Mỗi flip-flop có D nối với QN nên chia đôi tần số; Q của U1A cấp xung cho U1B. Từ xung nhịp 1 kHz: Q1 = 500 Hz, Q2 = 250 Hz. Xem trên máy phân tích logic; Báo cáo › Cổng còn trống báo không còn phần nào để trống. ' +
    'One 7474 drawn as two sections with the same name U1: U1A (flip-flop 1) and U1B (flip-flop 2). Each flip-flop has D tied to QN, so it halves the frequency; Q of U1A clocks U1B. From a 1 kHz clock: Q1 = 500 Hz, Q2 = 250 Hz. See the logic analyzer; Reports › Spare gates reports that no section is left unused.';
  put(b, 'sources/digital-clock', 'V1', 80, 200, { OUT: 'CLK' }, { freq: '1k', vhigh: '5' });
  put(b, 'sources/logic-high', 'V2', 80, 320, { OUT: 'H' }, { vhigh: '5' });
  put(b, 'ttl/7474-a', 'U1', 320, 200, { '1D': 'N1', '1CLK': 'CLK', '1PRE': 'H', '1CLR': 'H', '1Q': 'Q1', '1QN': 'N1' });
  put(b, 'ttl/7474-b', 'U1', 560, 200, { '2D': 'N2', '2CLK': 'Q1', '2PRE': 'H', '2CLR': 'H', '2Q': 'Q2', '2QN': 'N2' });
  const xla = put(b, 'instruments/logic-analyzer', 'XLA1', 820, 260, { d0: 'CLK', d1: 'Q1', d2: 'Q2' }, { clockrate: '20k', pre: '20', post: '180' });
  void xla;
  note(b, 60, 420, 'D = QN biến mỗi flip-flop thành bộ chia 2: Q1 = f/2 = 500 Hz, Q2 = f/4 = 250 Hz. Hai bộ chia hợp lại là bộ đếm nhị phân 2 bit.');
  note(b, 60, 440, 'U1A và U1B là cùng một vi mạch (cùng tên U1). Dùng Thuộc tính › Vi mạch để chuyển một phần sang chip khác hoặc sang một chip mới.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 96 line transformer regulation

export function transformerRegulationSample(): Design {
  const b = new DesignBuilder('Line transformer regulation: loaded and unloaded');
  const d = b.design;
  d.description =
    'Hai biến áp nguồn giống nhau 230 V → 12 V, 25 VA (độ lệch điện áp 15 %). T1 mang tải định mức 5,76 Ω (12 V / 2,08 A) nên thứ cấp đúng 12 V hiệu dụng; T2 không tải nên thứ cấp lên 12 V · 1,15 = 13,8 V. Hai đồng hồ XMM1 và XMM2 (xoay chiều, hiệu dụng) đọc V(S1) và V(S2). ' +
    'Two identical line transformers, 230 V to 12 V, 25 VA (regulation 15 %). T1 carries the rated load of 5.76 Ω (12 V / 2.08 A) so its secondary reads exactly 12 V RMS; T2 is unloaded so its secondary rises to 12 V · 1.15 = 13.8 V. The two meters XMM1 and XMM2 (AC, RMS) read V(S1) and V(S2).';
  put(b, 'sources/ac-voltage', 'V1', 80, 250, { '+': 'PRI', '-': 'GND' }, { amplitude: '325.27', freq: '50' });
  put(b, 'electromechanical/line-transformer-230v-12v-25va', 'T1', 340, 160, { P1: 'PRI', P2: 'GND', S1: 'S1', S2: 'GND' });
  put(b, 'basic/resistor', 'RL', 560, 160, { '1': 'S1', '2': 'GND' }, { value: '5.76' });
  put(b, 'electromechanical/line-transformer-230v-12v-25va', 'T2', 340, 360, { P1: 'PRI', P2: 'GND', S1: 'S2', S2: 'GND' });
  put(b, 'instruments/multimeter', 'XMM1', 700, 160, { '+': 'S1', '-': 'GND' }, { mode: 'v', coupling: 'ac' });
  put(b, 'instruments/multimeter', 'XMM2', 700, 360, { '+': 'S2', '-': 'GND' }, { mode: 'v', coupling: 'ac' });
  note(b, 60, 480, 'Đầy tải: Vs = 12 V hiệu dụng = 16,97 V đỉnh. Không tải: Vs0 = 12 V · (1 + 15 %) = 13,8 V hiệu dụng = 19,5 V đỉnh.');
  note(b, 60, 500, 'Độ lệch điện áp = (Vs0 − Vs)/Vs. Đổi “Độ lệch điện áp” hoặc “Công suất định mức” của T1, T2 rồi chạy lại; hãy thử RL = 12 Ω (nửa tải).');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-4, tstop: 0.12 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 97 fuse against breaker

/** Fuse of sample 97: rated 2 A, 0.5 A²s, blows above 3 A. */
export const FUSE_SAMPLE = { in: 2, i2t: 0.5, kmin: 1.5 };

export function fuseBreakerSample(): Design {
  const b = new DesignBuilder('I²t fuse against a breaker on the same short circuit');
  const d = b.design;
  d.description =
    'Cùng nguồn 24 V, hai nhánh bị chập với dòng 10 A (tải 2,4 Ω): nhánh 1 qua cầu chì 2 A có I²t = 0,5 A²s, nhánh 2 qua áp-tô-mát 2 A đường cong C. Cầu chì chảy sau I²t/(I² − Imin²) = 0,5/(100 − 9) ≈ 5,5 ms; áp-tô-mát (10 A = 5·In, dưới ngưỡng từ 7,5·In) cắt nhiệt sau τ·ln(m²/(m² − 1,3²)) ≈ 0,70 s. ' +
    'On the same 24 V source, two branches are short-circuited at 10 A (a 2.4 Ω load): branch 1 goes through a 2 A fuse with I²t = 0.5 A²s, branch 2 through a 2 A breaker with a C curve. The fuse melts after I²t/(I² − Imin²) = 0.5/(100 − 9) ≈ 5.5 ms; the breaker (10 A = 5·In, below the 7.5·In magnetic trip) trips thermally after τ·ln(m²/(m² − 1.3²)) ≈ 0.70 s.';
  put(b, 'sources/dc-voltage', 'V1', 80, 250, { '+': 'SUP', '-': 'GND' }, { value: '24' });
  put(b, 'power/fuse-i2t', 'F1', 280, 140, { '1': 'SUP', '2': 'L1' }, { in: '2', i2t: '0.5', kmin: '1.5' });
  put(b, 'basic/resistor', 'RL1', 480, 200, { '1': 'L1', '2': 'GND' }, { value: '2.4' });
  put(b, 'electromechanical/breaker-adjustable', 'Q1', 280, 340, { '1': 'SUP', '2': 'L2' }, { in: '2', curve: 'C' });
  put(b, 'basic/resistor', 'RL2', 480, 400, { '1': 'L2', '2': 'GND' }, { value: '2.4' });
  note(b, 60, 500, 'Cầu chì: t = I²t / (I² − Imin²) với Imin = 1,5 · In = 3 A → 5,5 ms. Áp-tô-mát C ở 5·In: t = 10 s · ln(25 / (25 − 1,69)) ≈ 0,70 s.');
  note(b, 60, 520, 'Chọn một cầu chì hoặc áp-tô-mát rồi nhìn đường cong thời gian – dòng điện trong Thuộc tính. Vẽ V(L1) và V(L2): điện áp tải về 0 khi thiết bị cắt.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-4, tstop: 1 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 98 replay of a recorded waveform

/** The recorded sensor file played by sample 98 (CSV: time in seconds, one channel in volts). */
export const SENSOR_DATA = 'time [s],sensor [V]\n0,0\n0.001,0.2\n0.002,1.8\n0.003,2.1\n0.004,1.9\n0.005,2.0\n0.006,2.1\n0.007,1.9\n0.008,2.0\n0.009,2.0\n0.01,2.0';

export function measurementReplaySample(): Design {
  const b = new DesignBuilder('Replay a recorded sensor waveform');
  const d = b.design;
  d.description =
    'Nguồn “tệp số đo” phát lại một dạng sóng đã ghi (bảng CSV 11 mẫu: cảm biến nhảy từ 0 lên khoảng 2 V rồi dao động nhẹ). Mạch lọc RC (10 kΩ, 100 nF, τ = 1 ms) làm mượt nó. Dùng “Mở tệp…” ở Thuộc tính để nạp tệp của bạn (CSV, LVM dạng văn bản hoặc TDMS). ' +
    'The "measurement file" source replays a recorded waveform (a CSV table of 11 samples: a sensor jumping from 0 to about 2 V and then wobbling a little). An RC filter (10 kΩ, 100 nF, τ = 1 ms) smooths it. Use "Open file…" in Properties to load your own file (CSV, text LVM or TDMS).';
  put(b, 'sources/measurement-voltage', 'V1', 80, 250, { '+': 'SENS', '-': 'GND' }, { data: SENSOR_DATA, channel: '1', tscale: '1', vscale: '1', voffset: '0', delay: '0', repeat: 'false' });
  put(b, 'basic/resistor', 'R1', 280, 160, { '1': 'SENS', '2': 'OUT' }, { value: '10k' });
  put(b, 'basic/capacitor', 'C1', 420, 250, { '1': 'OUT', '2': 'GND' }, { value: '100n' });
  put(b, 'instruments/scope', 'XSC1', 640, 200, { 'A+': 'SENS', 'B+': 'OUT' }, { timebase: '2m', 'A.scale': '1', 'B.scale': '1' });
  note(b, 60, 360, 'V(SENS) đi qua đúng các mẫu của tệp (tại 2 ms là 1,8 V); giữa hai mẫu nó nội suy tuyến tính. “Tỉ lệ thời gian” 2 làm tệp chạy chậm gấp đôi, “Tỉ lệ điện áp” nhân các giá trị.');
  note(b, 60, 380, 'Bộ lọc RC có τ = R·C = 1 ms nên V(OUT) bám theo V(SENS) với độ trễ cỡ 1 ms và bỏ bớt dao động nhỏ. Đổi C1 để làm mượt nhiều hơn.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-5, tstop: 0.01 }]);
  return d;
}

export const LEARN_SAMPLE_BUILDERS: Record<string, () => Design> = {
  '90-handout-two-sheets.msim': handoutSample,
  '91-block-meters.msim': blockMetersSample,
  '92-step-sweep.msim': stepSweepSample,
  '93-mcu-exact-delay.msim': mcuDebugSample,
  '94-battery-runtime.msim': batteryRuntimeSample,
  '95-7474-sections.msim': dividerSectionsSample,
  '96-transformer-regulation.msim': transformerRegulationSample,
  '97-fuse-vs-breaker.msim': fuseBreakerSample,
  '98-measurement-replay.msim': measurementReplaySample,
};
