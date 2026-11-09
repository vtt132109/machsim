/**
 * Texts of the ladder-diagram editor, Vietnamese first. Loaded with the editor's chunk (lazy), so
 * the start-up catalogue does not grow; the menu and command labels live in messages/ladder.ts.
 * Original text written for MachSim.
 *
 *   lt('rung', { n: 2 })            text in the current language
 *   ladderErrorText(error)          a compiler problem as one sentence
 */
import { interpolate, L, tr, type LocalizedText } from './core';
import type { LadderError } from '../ladder/program';
import type { LadderContactKind, LadderCompareOp, LadderOutputKind } from '../ladder/types';

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
  errRung: L('Bậc {n}: {text}', 'Rung {n}: {text}'),
  err: {
    badAddress: L('địa chỉ “{text}” không đọc được', 'the address “{text}” cannot be read'),
    notBit: L('“{text}” không phải địa chỉ bit', '“{text}” is not a bit address'),
    notNumber: L('“{text}” không phải một số hay một địa chỉ số', '“{text}” is neither a number nor a number address'),
    writeInput: L('không ghi được vào ngõ vào “{text}” — ngõ vào do mạch quyết định', 'an input “{text}” cannot be written — the circuit decides it'),
    writeTimerBit: L('không ghi trực tiếp vào bit “{text}” của bộ định thời / bộ đếm', 'the timer / counter bit “{text}” cannot be written directly'),
    badPreset: L('giá trị đặt trước “{text}” không đọc được', 'the preset “{text}” cannot be read'),
    presetRequired: L('thiếu giá trị đặt trước (thời gian hay số lần)', 'the preset (a time or a count) is missing'),
    emptyGroup: L('có nhóm rỗng trong phần logic', 'there is an empty group in the logic'),
    noOutput: L('bậc chưa có cuộn dây nào', 'the rung has no coil yet'),
    range: L('“{text}” vượt giới hạn cho phép', '“{text}” is outside the allowed range'),
  } as Record<string, LocalizedText>,

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

/** One compiler problem as a sentence ("Rung 3: the address “Z9.9” cannot be read"). */
export function ladderErrorText(e: LadderError): string {
  const body = LADDER_TEXT.err[e.code] ?? LADDER_TEXT.err.badAddress;
  const text = interpolate(tr(body), { text: e.text ?? '', limit: e.limit ?? 0 });
  return interpolate(tr(LADDER_TEXT.errRung), { n: e.rung, text });
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
