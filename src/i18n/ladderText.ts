/**
 * Texts of the ladder-diagram editor, Vietnamese first. Loaded with the editor's chunk (lazy), so
 * the start-up catalogue does not grow; the menu and command labels live in messages/ladder.ts.
 * Original text written for MachSim.
 *
 *   lt('rung', { n: 2 })            text in the current language
 *   ladderErrorText(error)          a compiler problem as one sentence
 */
import { interpolate, L, tr, type LocalizedText } from './core';
import { ladderErrorText } from './ladderErrors';
import type { LadderContactKind, LadderCompareOp, LadderOutputKind } from '../ladder/types';

export { ladderErrorText };

export const LADDER_TEXT = {
  // ---- the view
  title: L('Sơ đồ bậc thang', 'Ladder diagram'),
  intro: L(
    'Dòng điện tưởng tượng chạy từ ray trái sang ray phải qua các tiếp điểm tới cuộn dây. Bộ điều khiển đọc ngõ vào, chạy lần lượt từng bậc rồi ghi ngõ ra — lặp lại mãi.',
    'An imaginary current flows from the left rail through the contacts to the coil on the right rail. The controller reads the inputs, runs the rungs one after another and writes the outputs — over and over.',
  ),
  rung: L('Bậc {n}', 'Rung {n}'),
  rungComment: L('Ghi chú của bậc', 'Rung comment'),
  rungCommentHint: L('Viết bằng lời bậc này làm gì — đó là phần quan trọng nhất của một chương trình dễ hiểu.', 'Say in words what this rung does — the most valuable part of a program anyone can read.'),
  empty: L('Chưa có bậc nào. Nhấn “Thêm bậc” để bắt đầu.', 'No rungs yet. Press “Add rung” to start.'),
  disabled: L('(đang tắt)', '(switched off)'),

  // ---- toolbar
  addRung: L('Thêm bậc', 'Add rung'),
  tipAddRung: L('Thêm một bậc mới vào cuối chương trình.', 'Add a new rung at the end of the program.'),
  deleteRung: L('Xoá bậc', 'Delete rung'),
  moveUp: L('Lên', 'Move up'),
  moveDown: L('Xuống', 'Move down'),
  toggleRung: L('Tắt / bật bậc', 'Switch the rung off / on'),
  addSeries: L('Nối tiếp', 'In series'),
  tipAddSeries: L('Thêm một tiếp điểm nối tiếp (phải) với phần tử đang chọn: cả hai phải đóng thì dòng mới qua (VÀ).', 'Add a contact in series (to the right) with the selected element: both must be closed for current to pass (AND).'),
  addParallel: L('Song song', 'In parallel'),
  tipAddParallel: L('Thêm một tiếp điểm song song (dưới) với phần tử đang chọn: chỉ cần một cái đóng (HOẶC).', 'Add a contact in parallel (below) with the selected element: one of them closed is enough (OR).'),
  addCompare: L('So sánh', 'Comparison'),
  tipAddCompare: L('Thêm tiếp điểm so sánh hai số, ví dụ AI0 > 7,5 hay T1.ET ≥ 2.', 'Add a contact that compares two numbers, e.g. AI0 > 7.5 or T1.ET ≥ 2.'),
  addCoil: L('Thêm cuộn dây', 'Add coil'),
  removeElement: L('Xoá phần tử', 'Delete element'),
  help: L('Trợ giúp', 'Help'),
  selectHint: L('Nhấn vào một tiếp điểm hay cuộn dây để chọn, rồi sửa ở dưới.', 'Click a contact or a coil to select it, then edit it below.'),

  // ---- inspector
  element: L('Phần tử', 'Element'),
  contactType: L('Loại tiếp điểm', 'Contact type'),
  address: L('Địa chỉ', 'Address'),
  addressHint: L(
    'I0.0…I7.7 ngõ vào, Q0.0…Q7.7 ngõ ra, M0.0…M15.7 bit nhớ, T1…T32 bộ định thời, C1…C32 bộ đếm.',
    'I0.0…I7.7 inputs, Q0.0…Q7.7 outputs, M0.0…M15.7 memory bits, T1…T32 timers, C1…C32 counters.',
  ),
  numberHint: L(
    'Một số (2,5 hay 1k), hoặc AI0…AI7 (kênh tương tự, V), T1.ET (thời gian đã đếm, s), C1.CV (giá trị bộ đếm).',
    'A number (2.5 or 1k), or AI0…AI7 (an analog channel in volts), T1.ET (elapsed time in s), C1.CV (a counter value).',
  ),
  operator: L('Phép so sánh', 'Comparison'),
  left: L('Bên trái', 'Left'),
  right: L('Bên phải', 'Right'),
  coilKind: L('Loại cuộn dây', 'Coil type'),
  preset: L('Đặt trước', 'Preset'),
  presetTime: L('Thời gian (s)', 'Time (s)'),
  presetCount: L('Số lần', 'Counts'),
  comment: L('Ghi chú', 'Comment'),
  nothingSelected: L('Chưa chọn phần tử nào.', 'No element selected.'),

  // ---- element names
  contact: {
    no: L('Thường mở — đóng khi bit bằng 1', 'Normally open — closed while the bit is 1'),
    nc: L('Thường đóng — đóng khi bit bằng 0', 'Normally closed — closed while the bit is 0'),
    rising: L('Sườn lên — đóng một vòng quét khi bit từ 0 lên 1', 'Rising edge — closed for one scan when the bit goes 0 → 1'),
    falling: L('Sườn xuống — đóng một vòng quét khi bit từ 1 về 0', 'Falling edge — closed for one scan when the bit goes 1 → 0'),
  } as Record<LadderContactKind, LocalizedText>,
  compare: {
    eq: L('bằng', 'equal to'),
    ne: L('khác', 'not equal to'),
    lt: L('nhỏ hơn', 'less than'),
    le: L('nhỏ hơn hoặc bằng', 'at most'),
    gt: L('lớn hơn', 'greater than'),
    ge: L('lớn hơn hoặc bằng', 'at least'),
  } as Record<LadderCompareOp, LocalizedText>,
  output: {
    coil: L('Cuộn dây — bit bằng 1 khi bậc có điện', 'Coil — the bit is 1 while the rung carries power'),
    'coil-not': L('Cuộn dây đảo — bit bằng 1 khi bậc KHÔNG có điện', 'Inverted coil — the bit is 1 while the rung does NOT carry power'),
    set: L('Đặt (S) — bit lên 1 và giữ nguyên', 'Set (S) — the bit latches to 1 and stays'),
    reset: L('Xoá (R) — bit về 0 và giữ nguyên', 'Reset (R) — the bit clears to 0 and stays'),
    ton: L('Định thời trễ đóng (TON) — xong sau “đặt trước” giây', 'On-delay timer (TON) — done “preset” seconds later'),
    tof: L('Định thời trễ mở (TOF) — giữ thêm “đặt trước” giây sau khi mất điện', 'Off-delay timer (TOF) — holds “preset” seconds after the rung drops out'),
    ctu: L('Đếm lên (CTU) — +1 mỗi sườn lên của bậc', 'Count up (CTU) — +1 on every rising edge of the rung'),
    ctd: L('Đếm xuống (CTD) — −1 mỗi sườn lên, bắt đầu từ “đặt trước”', 'Count down (CTD) — −1 on every rising edge, starting at “preset”'),
    creset: L('Xoá bộ đếm (RES) — đưa bộ đếm về giá trị đầu', 'Reset counter (RES) — back to its starting value'),
    mov: L('Chuyển (MOV) — đích = A, mỗi vòng quét khi bậc có điện', 'Move (MOV) — destination = A on every scan while the rung carries power'),
    add: L('Cộng (ADD) — đích = A + B', 'Add (ADD) — destination = A + B'),
    sub: L('Trừ (SUB) — đích = A − B', 'Subtract (SUB) — destination = A − B'),
    mul: L('Nhân (MUL) — đích = A × B', 'Multiply (MUL) — destination = A × B'),
    div: L('Chia (DIV) — đích = A ÷ B (chia cho 0 thì không ghi)', 'Divide (DIV) — destination = A ÷ B (a division by 0 writes nothing)'),
    call: L('Gọi khối hàm (FB) — chạy một khối do bạn viết', 'Call function block (FB) — runs a block you wrote'),
  } as Record<LadderOutputKind, LocalizedText>,

  // ---- live
  live: L('Đang chạy', 'Running'),
  liveOff: L('Chưa chạy — nhấn Chạy để xem bậc nào có điện.', 'Not running — press Run to watch which rungs carry power.'),
  scans: L('Vòng quét: {n}', 'Scans: {n}'),
  timers: L('Bộ định thời', 'Timers'),
  counters: L('Bộ đếm', 'Counters'),
  images: L('Ảnh vào / ra', 'Input / output image'),
  inputs: L('Vào', 'Inputs'),
  outputs: L('Ra', 'Outputs'),
  memory: L('Bit nhớ', 'Memory'),

  // ---- problems
  problems: L('{n} chỗ cần sửa', '{n} problem(s) to fix'),

  // ---- word instructions and function blocks
  operandA: L('Toán hạng A', 'Operand A'),
  operandB: L('Toán hạng B', 'Operand B'),
  destination: L('Đích (MW0…MW31 hoặc AQ0…AQ3)', 'Destination (MW0…MW31 or AQ0…AQ3)'),
  wordHint: L(
    'MW0…MW31 là từ nhớ 16 bit có dấu (−32768…32767, vượt quá thì quay vòng); AQ0…AQ3 là ngõ ra tương tự, đơn vị vôn. Lệnh chạy MỖI vòng quét khi bậc có điện — đặt tiếp điểm sườn lên phía trước nếu chỉ muốn chạy một lần.',
    'MW0…MW31 are signed 16-bit memory words (−32768…32767, a larger result wraps round); AQ0…AQ3 are analog outputs in volts. The instruction runs on EVERY scan while the rung carries power — put a rising-edge contact in front for “once”.',
  ),
  operandHint: L('Một số, hoặc MW0…, AI0…, AQ0…, T1.ET, C1.CV.', 'A number, or MW0…, AI0…, AQ0…, T1.ET, C1.CV.'),
  blockLabel: L('Khối hàm', 'Function block'),
  instanceName: L('Tên bản thể', 'Instance name'),
  instanceHint: L('Mỗi lời gọi có một tên riêng (FB1, DONGCO1…); bộ nhớ riêng của khối (#tên, #T1, #W1) thuộc về bản thể đó.', 'Every call has a name of its own (FB1, MOTOR1…); the block’s private memory (#name, #T1, #W1) belongs to that instance.'),
  argsTitle: L('Nối tham số với địa chỉ', 'Tie the parameters to addresses'),
  argInput: L('vào', 'in'),
  argOutput: L('ra', 'out'),
  noBlocks: L('Chưa có khối hàm nào. Tạo một khối ở “Khối hàm” rồi gọi nó bằng cuộn dây “Gọi khối hàm”.', 'There are no function blocks yet. Create one under “Function blocks”, then call it with a “Call function block” coil.'),
  editing: L('Đang sửa', 'Editing'),
  mainProgram: L('Chương trình của trang này', 'This sheet’s program'),
  blocksTitle: L('Khối hàm', 'Function blocks'),
  blocksIntro: L(
    'Khối hàm là một đoạn bậc thang có tên, có đầu vào, đầu ra và các bậc riêng; viết một lần, gọi nhiều lần. Trong khối: tên đầu vào / ra là tham số hình thức, EN là “cho phép” (bật khi bậc gọi có điện), tên bắt đầu bằng # là bộ nhớ riêng của từng bản thể.',
    'A function block is a named piece of ladder with its own inputs, outputs and rungs; write it once, call it many times. Inside it the input / output names are the formal parameters, EN is “enable” (on while the calling rung carries power), and a name starting with # is memory private to each instance.',
  ),
  newBlock: L('Khối mới', 'New block'),
  deleteBlock: L('Xoá khối', 'Delete block'),
  deleteBlockAsk: L('Xoá khối “{name}”? Những lời gọi nó sẽ báo lỗi.', 'Delete block “{name}”? The calls to it will report an error.'),
  blockName: L('Tên khối', 'Block name'),
  blockComment: L('Mô tả khối', 'Block description'),
  blockInputs: L('Đầu vào (cách nhau dấu phẩy)', 'Inputs (comma separated)'),
  blockOutputs: L('Đầu ra (cách nhau dấu phẩy)', 'Outputs (comma separated)'),
  backToProgram: L('Quay lại chương trình', 'Back to the program'),
  blockUsedBy: L('{n} lời gọi', '{n} call(s)'),
  blockNameTaken: L('Tên khối “{name}” đã có hoặc không hợp lệ.', 'The block name “{name}” is taken or not valid.'),

  // ---- copy / cut / paste
  copy: L('Sao chép', 'Copy'),
  cut: L('Cắt', 'Cut'),
  paste: L('Dán', 'Paste'),
  pasteParallel: L('Dán song song', 'Paste in parallel'),
  tipCopy: L('Sao chép phần tử đang chọn (một bậc, một tiếp điểm hay một cuộn dây) — Ctrl+C.', 'Copy the selected thing (a rung, a contact or a coil) — Ctrl+C.'),
  tipCut: L('Cắt bậc đang chọn — Ctrl+X.', 'Cut the selected rung — Ctrl+X.'),
  tipPaste: L('Dán: bậc vào dưới bậc đang chọn, tiếp điểm nối tiếp sau phần tử đang chọn, cuộn dây vào cuối bậc — Ctrl+V.', 'Paste: a rung goes below the selected rung, a contact in series after the selected element, a coil at the end of the rung — Ctrl+V.'),
  tipPasteParallel: L('Dán tiếp điểm song song (bên dưới) phần tử đang chọn.', 'Paste the contact in parallel (below) the selected element.'),
  extendHint: L('Giữ Shift khi nhấp để chọn nhiều bậc liền nhau.', 'Hold Shift while clicking to select several rungs in a row.'),
  rungsSelected: L('{n} bậc được chọn', '{n} rungs selected'),
  pasted: L('Đã dán.', 'Pasted.'),
  nothingToPaste: L('Chưa có gì để dán — hãy sao chép một bậc, tiếp điểm hay cuộn dây trước.', 'Nothing to paste yet — copy a rung, a contact or a coil first.'),
  cannotPasteHere: L('Không dán được vào chỗ đang chọn.', 'This cannot be pasted at the selection.'),

  // ---- cross-reference
  xref: L('Tham chiếu chéo', 'Cross-reference'),
  xrefIntro: L(
    'Mỗi địa chỉ được ĐỌC ở đâu và GHI ở đâu. Nhấn một số bậc để nhảy tới bậc đó.',
    'Where each address is READ and where it is WRITTEN. Click a rung number to jump to that rung.',
  ),
  xrefFilter: L('Lọc địa chỉ…', 'Filter addresses…'),
  xrefEmpty: L('Chưa có địa chỉ nào trong chương trình.', 'There are no addresses in the program yet.'),
  colAddress: L('Địa chỉ', 'Address'),
  colKind: L('Loại', 'Kind'),
  colWrites: L('Ghi ở bậc', 'Written in rungs'),
  colReads: L('Đọc ở bậc', 'Read in rungs'),
  warnNeverWritten: L('được đọc nhưng không bậc nào ghi nó', 'is read but no rung writes it'),
  warnNeverRead: L('được ghi nhưng không bậc nào đọc nó', 'is written but no rung reads it'),
  xrefCopy: L('Sao chép bảng', 'Copy the table'),
  kind: {
    input: L('ngõ vào', 'input'),
    output: L('ngõ ra', 'output'),
    memory: L('bit nhớ', 'memory bit'),
    word: L('từ nhớ', 'memory word'),
    timer: L('bộ định thời', 'timer'),
    counter: L('bộ đếm', 'counter'),
    'analog-in': L('vào tương tự', 'analog input'),
    'analog-out': L('ra tương tự', 'analog output'),
    instance: L('bản thể khối', 'block instance'),
    formal: L('tham số khối', 'block parameter'),
    local: L('nhớ riêng của khối', 'block private memory'),
    other: L('khác', 'other'),
  } as Record<string, LocalizedText>,
  words: L('Từ nhớ', 'Words'),
  analogOutputs: L('Ra tương tự (V)', 'Analog outputs (V)'),
  mathErrors: L('{n} lần chia cho 0', '{n} division(s) by 0'),

  // ---- menus of the sheet tab
  newSheet: L('Trang bậc thang mới', 'New ladder sheet'),
} as const;

type TextKey = {
  [K in keyof typeof LADDER_TEXT]: (typeof LADDER_TEXT)[K] extends LocalizedText ? K : never;
}[keyof typeof LADDER_TEXT];

/** Text of the ladder editor in the current language. */
export function lt(key: TextKey, params?: Record<string, string | number>): string {
  const text = tr(LADDER_TEXT[key] as LocalizedText);
  return params ? interpolate(text, params) : text;
}

/** Name of an address kind in the cross-reference. */
export function addressKindText(kind: string): string {
  const t = LADDER_TEXT.kind[kind];
  return t ? tr(t) : kind;
}

/** Name of a contact kind, a comparison or a coil kind. */
export function contactText(kind: LadderContactKind): string {
  return tr(LADDER_TEXT.contact[kind]);
}
export function compareText(op: LadderCompareOp): string {
  return tr(LADDER_TEXT.compare[op]);
}
export function outputText(kind: LadderOutputKind): string {
  return tr(LADDER_TEXT.output[kind]);
}
