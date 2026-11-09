/**
 * Texts of the document tabs flows and of the editing commands that came with them (layer
 * settings, drawing order, paste special, reference designator prefixes), Vietnamese first. Loaded
 * with those flows (src/ui/app/documentFlows.ts, editingDialogs.tsx; lazy chunks); the command
 * labels and the tab strip texts are in messages/documents.ts. Original text written for MachSim.
 *
 *   dt('closeOne', { name: 'Amp.msim' })   text in the current language, {placeholders} filled
 */
import { interpolate, L, tr, type LocalizedText } from './core';

export const DOCS_TEXT = {
  // ---- closing and saving several documents
  closeTitle: L('Đóng thiết kế', 'Close design'),
  closeOne: L('“{name}” có thay đổi chưa lưu. Lưu trước khi đóng?', '“{name}” has unsaved changes. Save before closing?'),
  closeAllTitle: L('Đóng tất cả thiết kế', 'Close all designs'),
  closeMany: L('Có {n} thiết kế chưa lưu:', '{n} designs have unsaved changes:'),
  quitTitle: L('Thoát MachSim', 'Quit MachSim'),
  quitMany: L('MachSim sắp thoát. Có {n} thiết kế chưa lưu:', 'MachSim is about to quit. {n} designs have unsaved changes:'),
  quitOne: L('MachSim sắp thoát. “{name}” có thay đổi chưa lưu.', 'MachSim is about to quit. “{name}” has unsaved changes.'),
  saveAll: L('Lưu tất cả', 'Save all'),
  save: L('Lưu', 'Save'),
  dontSave: L('Không lưu', "Don't save"),
  cancel: L('Huỷ', 'Cancel'),
  savedAll: L('Đã lưu {n} thiết kế.', 'Saved {n} designs.'),
  nothingToSave: L('Không có thiết kế nào cần lưu.', 'No design needs saving.'),

  // ---- moving things between documents
  copiedTo: L('Đã sao chép {n} đối tượng sang “{name}”.', 'Copied {n} objects to “{name}”.'),
  placedIn: L('Đã đặt linh kiện vào “{name}”.', 'Placed the part in “{name}”.'),
  dropFailed: L('Không thể đưa nội dung sang thiết kế kia.', 'The content could not be moved to the other design.'),

  help: L('Trợ giúp', 'Help'),
  helpTip: L('Mở trang hướng dẫn về lớp hiển thị, thứ tự, dán đặc biệt và tiền tố tên.', 'Open the help page about layers, order, paste special and name prefixes.'),

  // ---- layer settings
  layersTitle: L('Lớp hiển thị của trang', 'Layer settings'),
  layersIntro: L('Chọn những gì hiện trên trang. Ẩn một lớp chỉ đổi cách vẽ, không đổi mạch; ảnh xuất và bản in cũng làm theo.', 'Choose what is shown on the sheet. Hiding a layer changes the drawing only, never the circuit; exported images and printouts follow.'),
  layersScope: L('Áp dụng cho', 'Apply to'),
  scopeSheet: L('Trang đang mở', 'This sheet'),
  scopeLevel: L('Mọi trang của mạch đang mở', 'All sheets of this design level'),
  scopeAll: L('Mọi trang của thiết kế (cả mạch con)', 'All sheets of the design (subcircuits too)'),
  layerGrid: L('Lưới', 'Grid'),
  layerGridTip: L('Các chấm / ô lưới trên màn hình (không in).', 'The grid dots / lines on screen (never printed).'),
  layerRefdes: L('Tên linh kiện (R1, C2…)', 'Reference designators (R1, C2…)'),
  layerRefdesTip: L('Chữ tên đặt cạnh mỗi linh kiện.', 'The name next to every part.'),
  layerValues: L('Giá trị (1 kΩ, 100 nF…)', 'Values (1 kΩ, 100 nF…)'),
  layerValuesTip: L('Chữ giá trị đặt cạnh mỗi linh kiện. Ẩn đi để làm đề bài cho bạn học.', 'The value text next to every part. Hide it to make a worksheet.'),
  layerLabels: L('Nhãn net và đầu nối', 'Net labels and connectors'),
  layerLabelsTip: L('Các nhãn đặt tên net; nối điện vẫn giữ nguyên khi ẩn.', 'The labels that name nets; the connections stay when they are hidden.'),
  layerNetNames: L('Tên của mọi net', 'Names of all nets'),
  layerNetNamesTip: L("Ghi tên từng net (kể cả tên tự đặt N$1…) dọc theo dây: tiện khi đọc netlist.", "Writes every net's name (including automatic ones such as N$1) along its wires: handy when reading the netlist."),
  layerPinNumbers: L('Số chân', 'Pin numbers'),
  layerPinNumbersTip: L('Số chân vật lý của vi mạch và đầu nối cạnh mỗi chân.', 'The physical pin numbers of chips and connectors next to each pin.'),
  layerComments: L('Ghi chú dán (comment)', 'Sticky comments'),
  layerCommentsTip: L('Các ghi chú đặt bằng công cụ Comment.', 'The notes placed with the Comment tool.'),
  layerGraphics: L('Hình vẽ minh hoạ', 'Graphics'),
  layerGraphicsTip: L('Đường, hình chữ nhật, hình tròn, ảnh…', 'Lines, rectangles, ellipses, pictures…'),
  layersReset: L('Hiện như mặc định', 'Back to defaults'),
  layersClose: L('Đóng', 'Close'),

  // ---- drawing order
  orderNothing: L('Hãy chọn một hình vẽ hoặc ô chữ trước. Thứ tự chỉ áp dụng cho hình vẽ và ghi chú.', 'Select a graphic or a text first. Order only applies to graphics and text.'),
  orderSame: L('Mục đã chọn đã nằm ở vị trí đó rồi.', 'The selection is already there.'),

  // ---- paste special
  pasteNoClipboard: L('Chưa có gì để dán. Hãy sao chép (Ctrl+C) các linh kiện trước.', 'Nothing to paste. Copy (Ctrl+C) some parts first.'),
  pasteKeepDone: L('Đã dán {n} linh kiện giữ nguyên tên; {renamed} linh kiện đổi tên vì tên cũ đã có trong thiết kế.', 'Pasted {n} parts keeping their names; {renamed} were renamed because the name was already used.'),
  pasteKeepAll: L('Đã dán {n} linh kiện giữ nguyên tên.', 'Pasted {n} parts keeping their names.'),
  pasteValuesDone: L('Đã chép giá trị sang {n} linh kiện.', 'Copied the values to {n} parts.'),
  pasteValuesNoTarget: L('Hãy chọn trước các linh kiện cần nhận giá trị, rồi dán giá trị.', 'Select the parts that should receive the values first, then paste values.'),
  pasteValuesNoMatch: L('Không có linh kiện đã chọn nào cùng loại với linh kiện đã sao chép, hoặc giá trị đã giống nhau.', 'None of the selected parts is of the same kind as a copied part, or the values already match.'),
  pasteBlockTitle: L('Dán thành mạch con', 'Paste as subcircuit'),
  pasteBlockName: L('Tên mạch con / khối', 'Subcircuit / block name'),
  pasteBlockDefault: L('Khối mới', 'New block'),
  pasteBlockNoParts: L('Phần đã sao chép không có linh kiện nào để gộp thành mạch con.', 'The copied fragment has no parts to turn into a subcircuit.'),
  pasteBlockDone: L('Đã dán thành mạch con “{name}”. Nhấp đúp vào khối để mở bên trong.', 'Pasted as the subcircuit “{name}”. Double-click the block to open it.'),
  pasteRestricted: L('Không dán được ở đây.', 'Cannot paste here.'),

  // ---- reference designator prefixes
  prefixTitle: L('Tiền tố tên linh kiện', 'Reference designator prefixes'),
  prefixIntro: L('Đặt quy tắc đặt tên cho cả thiết kế, ví dụ khi một dự án có nhiều bo mạch: tiền tố chung “A_” biến R1 thành A_R1; đổi riêng “U” thành “U1_” để chip của bo 1 là U1_1, U1_2…', 'Set a naming rule for the whole design, for example in a multi-board project: a common prefix “A_” turns R1 into A_R1; mapping “U” to “U1_” names the chips of board 1 U1_1, U1_2…'),
  prefixGlobal: L('Tiền tố chung', 'Common prefix'),
  prefixGlobalHint: L('Đặt trước mọi tên linh kiện (chữ, số và “_”; ví dụ A_). Để trống nếu không cần.', 'Put in front of every name (letters, digits and “_”; for example A_). Leave empty if not needed.'),
  prefixTable: L('Tiền tố theo loại linh kiện', 'Prefix per kind of part'),
  prefixKind: L('Loại', 'Kind'),
  prefixReplace: L('Thay bằng', 'Replace with'),
  prefixExample: L('Ví dụ', 'Example'),
  prefixAddLabel: L('Thêm loại (chữ cái, ví dụ U)', 'Add a kind (letters, for example U)'),
  prefixAdd: L('Thêm', 'Add'),
  prefixRename: L('Đổi tên cả các linh kiện đã đặt (giữ nguyên số thứ tự)', 'Also rename the parts already placed (the numbers stay)'),
  prefixApply: L('Áp dụng', 'Apply'),
  prefixCancel: L('Huỷ', 'Cancel'),
  prefixReset: L('Bỏ quy tắc', 'Remove the rules'),
  prefixBadText: L('“{text}” không hợp lệ: chỉ dùng chữ cái không dấu (A–Z), chữ số và “_”, bắt đầu bằng chữ cái hoặc “_”.', '“{text}” is not valid: use unaccented letters (A–Z), digits and “_” only, starting with a letter or “_”.'),
  prefixTooLong: L('“{text}” quá dài (tối đa {max} ký tự).', '“{text}” is too long (at most {max} characters).'),
  prefixEndsInDigit: L('Tiền tố “{text}” kết thúc bằng chữ số nên “{text}3” lẫn với “{text}” + 3. Hãy thêm “_” ở cuối.', 'The prefix “{text}” ends in a digit, so “{text}3” cannot be told from “{text}” + 3. Add a “_” at the end.'),
  prefixClash: L('Hai loại “{at}” và “{text}” sẽ có cùng tiền tố.', 'The kinds “{at}” and “{text}” would get the same prefix.'),
  prefixDone: L('Đã áp dụng quy tắc tên. Đã đổi tên {n} linh kiện.', 'Naming rules applied. Renamed {n} parts.'),
  prefixDoneNoRename: L('Đã lưu quy tắc tên: linh kiện đặt từ giờ sẽ theo quy tắc này.', 'Naming rules saved: parts placed from now on follow them.'),
  prefixSkipped: L('{n} tên giữ nguyên vì sẽ trùng tên khác: {list}.', '{n} names were kept because they would clash: {list}.'),
  prefixRemoved: L('Đã bỏ quy tắc tên.', 'Naming rules removed.'),
} satisfies Record<string, LocalizedText>;

export type DocsTextKey = keyof typeof DOCS_TEXT;

/** A text of the document / editing flows in the current language with {placeholders} filled. */
export function dt(key: DocsTextKey, params?: Record<string, string | number>): string {
  return interpolate(tr(DOCS_TEXT[key]), params);
}
