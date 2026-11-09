/**
 * Texts of the package panel of the Properties tab (multi-section chips: 7400A, 7474B, TL072A …),
 * Vietnamese first. Loaded with the panel (src/ui/editor/PackagePanel.tsx, a lazy chunk), so the
 * start-up catalogue stays small; the command label lives in messages/shell.ts. Original text
 * written for MachSim.
 *
 *   sxt('key', { n: 3 })   text in the current language, {placeholders} filled
 */
import { interpolate, L, tr, type LocalizedText } from './core';

export const SECTION_TEXT = {
  title: L('Vi mạch nhiều phần', 'Multi-section chip'),
  intro: L(
    'Các phần của một vi mạch (ví dụ TL072A và TL072B) dùng chung một tên linh kiện nên chỉ là MỘT vi mạch trong netlist, danh sách vật tư và mạch in. Chân nguồn dùng chung: nối ở một phần là đủ.',
    'The sections of one chip (for example TL072A and TL072B) share one reference designator, so they are ONE chip in the netlist, the bill of materials and the PCB. The supply pins are shared: wiring them on one section is enough.',
  ),
  chip: L('Vi mạch {refdes} ({name})', 'Chip {refdes} ({name})'),
  sections: L('Các phần', 'Sections'),
  used: L('{letter}: đã dùng', '{letter}: used'),
  free: L('{letter}: còn trống', '{letter}: free'),
  thisOne: L('{letter}: phần này', '{letter}: this one'),
  spare: L(
    'Còn trống: {list}. Phần trống nên được nối hết ngõ vào (ví dụ op-amp: ngõ vào + xuống đất, ngõ vào − nối với ngõ ra).',
    'Free: {list}. Tie the inputs of a free section (for an op-amp: the + input to ground and the − input to its output).',
  ),
  noSpare: L('Mọi phần của vi mạch này đã được dùng.', 'Every section of this chip is used.'),
  changeSection: L('Phần của linh kiện này', 'Section of this part'),
  tipChangeSection: L('Đổi sang một phần còn trống của cùng vi mạch (vị trí và dây giữ nguyên)', 'Switch to a free section of the same chip (position and wires stay)'),
  newPackage: L('Tách sang vi mạch mới', 'Move to a new chip'),
  tipNewPackage: L('Đặt tên linh kiện mới (ví dụ U2) cho phần này: nó thành phần của một vi mạch thứ hai', 'Give this section a new designator (for example U2): it becomes a section of a second chip'),
  joinPackage: L('Chuyển vào vi mạch…', 'Move into chip…'),
  tipJoinPackage: L('Chuyển phần này vào một vi mạch khác của cùng loại đang còn trống phần này', 'Move this section into another chip of the same type that has this section free'),
  joinOption: L('{refdes} (trống: {list})', '{refdes} (free: {list})'),
  help: L('Trợ giúp về vi mạch nhiều phần', 'Help on multi-section chips'),
  alwaysNew: L('Đang bật “Mỗi phần vào một vi mạch mới” (menu Đặt): phần mới đặt sẽ tạo vi mạch mới.', '“New package for each section” (Place menu) is on: each section you place starts a new chip.'),
} as const;

export type SectionTextKey = keyof typeof SECTION_TEXT;

/** One text of the package panel in the current language. */
export function sxt(key: SectionTextKey, params?: Record<string, string | number>): string {
  const entry: LocalizedText = SECTION_TEXT[key];
  return params ? interpolate(tr(entry), params) : tr(entry);
}
