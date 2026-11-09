/**
 * Texts of the professional schematic tools (ERC options and report, net settings, capture area,
 * Customize user interface, footprint manager), Vietnamese first. Loaded with those dialogs
 * (src/ui/schematicTools/*, a lazy chunk), so the start-up catalogue stays small; menu and command
 * labels live in messages/schematicTools.ts. Original text written for MachSim.
 *
 *   stt('key', { n: 3 })   text in the current language, {placeholders} filled
 */
import { interpolate, L, tr, type LocalizedText } from './core';

export const SCHEMATIC_TOOLS_TEXT = {
  // ---- ERC options
  ercTitle: L('Tuỳ chọn ERC', 'ERC options'),
  ercIntro: L(
    'ERC (kiểm tra quy tắc điện) đọc sơ đồ và chỉ ra những chỗ nối sai trước khi chạy mô phỏng. Ở đây bạn chọn mức độ của từng loại kiểm tra.',
    'ERC (electrical rules check) reads the schematic and points out wiring mistakes before you simulate. Here you choose how strict each check is.',
  ),
  ercMatrixTab: L('Ma trận loại chân', 'Pin-type matrix'),
  ercOtherTab: L('Kiểm tra khác', 'Other checks'),
  ercMatrixHelp: L(
    'Mỗi ô là một cặp loại chân gặp nhau trên cùng một net. Nhấp vào ô để đổi: cho phép → cảnh báo → lỗi. Hàng và cột đối xứng nên chỉ cần đổi một nửa.',
    'Each cell is a pair of pin types meeting on one net. Click a cell to change it: allowed → warning → error. The matrix is symmetric, so one half is enough.',
  ),
  ercMatrixRails: L(
    'Các net nguồn và đất (từ ký hiệu nguồn / đất) được bỏ qua: nhiều chân nguồn trên cùng một đường VCC là bình thường.',
    'Power and ground nets (from a power or ground symbol) are skipped: many supply pins on one VCC rail are normal.',
  ),
  ercLevelOk: L('Cho phép', 'Allowed'),
  ercLevelWarning: L('Cảnh báo', 'Warning'),
  ercLevelError: L('Lỗi', 'Error'),
  ercPinTypesOn: L('Kiểm tra loại chân', 'Check pin types'),
  ercNcOn: L('Báo lỗi khi chân đánh dấu NC lại có dây', 'Report a pin marked NC that is wired'),
  ercHiddenPower: L('Chân nguồn ẩn của IC số', 'Hidden supply pins of digital ICs'),
  ercHiddenAuto: L('Tự động: nối vào net VCC / VDD nếu sơ đồ có', 'Automatic: join the VCC / VDD net when the design has one'),
  ercHiddenIdeal: L('Lý tưởng: bỏ qua net nguồn, dùng mức danh định', 'Ideal: ignore supply nets and use the nominal levels'),
  ercHiddenRequired: L('Bắt buộc: thiếu net nguồn là lỗi ERC', 'Required: a missing supply net is an ERC error'),
  ercHiddenHelp: L(
    'IC số (74xx, 4000) có chân nguồn không vẽ trên ký hiệu. Ở chế độ tự động, chúng tự nối vào net mang tên VCC (hoặc VDD) khi sơ đồ có ký hiệu nguồn đó, nên mức logic đúng theo nguồn thật.',
    'Digital ICs (74xx, 4000) carry their supply on pins the symbol does not draw. In automatic mode they join the net named VCC (or VDD) whenever the design has that power symbol, so the logic levels follow the real supply.',
  ),
  ercReset: L('Về mặc định', 'Back to the defaults'),
  ercChanged: L('{n} ô khác mặc định', '{n} cells differ from the defaults'),
  ercSaved: L('Đã lưu tuỳ chọn ERC vào thiết kế.', 'The ERC options are saved in the design.'),

  // ---- delete markers / report
  clearTitle: L('Xoá dấu ERC', 'Delete ERC markers'),
  clearIntro: L('Chọn những dấu cần xoá khỏi danh sách và khỏi sơ đồ.', 'Choose which markers leave the list and the schematic.'),
  scopeAll: L('Tất cả ({n})', 'All ({n})'),
  scopeSheet: L('Trang hiện tại: {sheet} ({n})', 'This sheet: {sheet} ({n})'),
  scopeErrors: L('Chỉ các lỗi ({n})', 'Errors only ({n})'),
  scopeWarnings: L('Chỉ các cảnh báo ({n})', 'Warnings only ({n})'),
  scopeSelection: L('Các linh kiện đang chọn ({n})', 'The selected parts ({n})'),
  clearButton: L('Xoá', 'Delete'),
  reportTitle: L('Báo cáo ERC', 'ERC report'),
  reportSummary: L('{errors} lỗi, {warnings} cảnh báo', '{errors} error(s), {warnings} warning(s)'),
  reportClean: L('Không tìm thấy vấn đề nào.', 'No problems were found.'),
  reportFormatAsk: L('Lưu báo cáo ERC theo định dạng nào?', 'Which format should the ERC report be saved in?'),
  reportTxt: L('Văn bản (.txt)', 'Text (.txt)'),
  reportCsv: L('Bảng tính (.csv)', 'Spreadsheet (.csv)'),
  reportHtml: L('Trang web (.html)', 'Web page (.html)'),
  reportNone: L('Chưa có kết quả ERC. Hãy chạy Công cụ › Kiểm tra điện (ERC) trước.', 'There are no ERC results yet. Run Tools › Electrical rules check first.'),
  colSeverity: L('Mức', 'Severity'),
  colRule: L('Luật', 'Rule'),
  colSheet: L('Trang', 'Sheet'),
  colRefdes: L('Linh kiện', 'Part'),
  colPin: L('Chân', 'Pin'),
  colNet: L('Net', 'Net'),
  colPosition: L('Vị trí', 'Position'),
  colProblem: L('Vấn đề', 'Problem'),
  colWhy: L('Vì sao', 'Why'),
  colFix: L('Cách sửa', 'How to fix'),

  // ---- NC markers
  ncTitle: L('Dấu không nối (NC) của {refdes}', 'NC markers of {refdes}'),
  ncIntro: L(
    'Đánh dấu những chân bạn cố ý để hở. ERC sẽ không báo “chân hở” cho chúng nữa, và sẽ báo lỗi nếu sau này bạn nối dây vào.',
    'Mark the pins you deliberately leave open. ERC stops warning “pin not connected” for them, and reports an error if you wire one up later.',
  ),
  ncPin: L('Chân {pin}', 'Pin {pin}'),
  ncConnected: L('đang có dây', 'wired'),
  ncOpen: L('đang hở', 'open'),
  ncAllOpen: L('Đánh dấu mọi chân đang hở', 'Mark every open pin'),
  ncNone: L('Bỏ hết dấu', 'Clear every marker'),

  // ---- net settings
  netTitle: L('Cài đặt net {net}', 'Settings of net {net}'),
  netIntro: L(
    'Một net là tập hợp các chân nối với nhau. Ở đây bạn đặt tên, màu dây và các thông số cho phần mềm mạch in.',
    'A net is a set of pins wired together. Here you give it a name, a wire colour and the properties the PCB software needs.',
  ),
  netName: L('Tên net', 'Net name'),
  netNameHelp: L(
    'Đổi tên net sẽ đổi nhãn net trên sơ đồ (nếu net chưa có nhãn, MachSim thêm một nhãn vào dây đang chọn).',
    'Renaming the net renames its net label on the schematic (when the net has none, MachSim adds a label to the selected wire).',
  ),
  netColor: L('Màu dây', 'Wire colour'),
  netColorHelp: L('Màu được áp dụng cho mọi dây của net này.', 'The colour is given to every wire of this net.'),
  netNote: L('Ghi chú', 'Note'),
  netKeepName: L('Giữ tên khi đánh số lại', 'Keep the name when the design is re-annotated'),
  netPcb: L('Mạch in (PCB)', 'Printed board (PCB)'),
  netClass: L('Lớp net', 'Net class'),
  netClassNone: L('(không dùng lớp)', '(no class)'),
  netClassSignal: L('Tín hiệu (0.25 mm / 0.2 mm)', 'Signal (0.25 mm / 0.2 mm)'),
  netClassBus: L('Bus (0.3 mm / 0.2 mm)', 'Bus (0.3 mm / 0.2 mm)'),
  netClassPower: L('Nguồn (0.8 mm / 0.3 mm)', 'Power (0.8 mm / 0.3 mm)'),
  netClassHighVoltage: L('Điện áp cao (1 mm / 1.5 mm)', 'High voltage (1 mm / 1.5 mm)'),
  netWidth: L('Bề rộng đường mạch (mm)', 'Trace width (mm)'),
  netClearance: L('Khoảng cách tối thiểu (mm)', 'Clearance (mm)'),
  netLayer: L('Lớp đi dây mong muốn', 'Preferred routing layer'),
  netLayerAny: L('Lớp nào cũng được', 'Any layer'),
  netLayerTop: L('Mặt trên', 'Top'),
  netLayerBottom: L('Mặt dưới', 'Bottom'),
  netLayerInner: L('Lớp trong', 'Inner'),
  netLayerPower: L('Lớp nguồn', 'Power plane'),
  netPcbHelp: L(
    'Các giá trị này đi theo netlist khi xuất sang phần mềm mạch in (Báo cáo › Chuyển sang PCB). MachSim không tự vẽ mạch in.',
    'These values travel with the netlist when you export to PCB software (Reports › Transfer to PCB). MachSim does not lay out boards itself.',
  ),
  netPins: L('{n} chân trên net này: {pins}', '{n} pins on this net: {pins}'),
  netOfWire: L('Net của dây đang chọn', 'Net of the selected wire'),
  netPick: L('Net', 'Net'),
  netNameTaken: L('Đã có net khác tên “{name}”.', 'Another net is already called “{name}”.'),
  netNameBad: L('Tên net chỉ dùng chữ, số và dấu gạch dưới.', 'A net name may only use letters, digits and underscores.'),

  // ---- capture area
  captureTitle: L('Chụp vùng trên trang', 'Capture screen area'),
  captureHint: L('Kéo một hình chữ nhật quanh phần sơ đồ cần chụp.', 'Drag a rectangle around the part of the schematic you want.'),

  // ---- customize UI
  customTitle: L('Tuỳ biến giao diện', 'Customize user interface'),
  customKeysTab: L('Phím tắt', 'Keyboard shortcuts'),
  customToolbarTab: L('Thanh công cụ', 'Toolbar'),
  customKeysIntro: L(
    'Nhấp vào ô phím rồi bấm tổ hợp phím bạn muốn. Để bỏ phím tắt, bấm Xoá. Phím tắt trùng nhau được tô đỏ.',
    'Click a key box and press the combination you want. Press Clear to remove a shortcut. Clashing shortcuts are marked in red.',
  ),
  customCommand: L('Lệnh', 'Command'),
  customKey: L('Phím', 'Key'),
  customDefault: L('Mặc định', 'Default'),
  customPress: L('Bấm tổ hợp phím…', 'Press a key combination…'),
  customClear: L('Xoá', 'Clear'),
  customResetRow: L('Về mặc định', 'Reset'),
  customResetAll: L('Về mặc định toàn bộ', 'Reset everything'),
  customFilter: L('Tìm lệnh', 'Find a command'),
  customConflict: L('Trùng với: {ids}', 'Clashes with: {ids}'),
  customProblemUnreadable: L('Không đọc được tổ hợp phím này.', 'This key combination cannot be read.'),
  customProblemBareLetter: L('Một chữ hoặc số đứng một mình sẽ gõ ra khi bạn nhập liệu; hãy thêm Ctrl hoặc Alt.', 'A letter or digit on its own would fire while you type; add Ctrl or Alt.'),
  customProblemReserved: L('Phím này dành cho sao chép / dán / hoàn tác, không đổi được.', 'This key belongs to copy / paste / undo and cannot be changed.'),
  customNoShortcut: L('(không có)', '(none)'),
  customToolbarIntro: L('Bỏ chọn những nhóm nút bạn không dùng để thanh công cụ gọn hơn.', 'Switch off the button groups you do not use to keep the toolbar short.'),
  customGroupFile: L('Tệp (Mới, Mở, Lưu)', 'File (New, Open, Save)'),
  customGroupHistory: L('Hoàn tác / làm lại', 'Undo / redo'),
  customGroupClipboard: L('Cắt, chép, dán, xoá', 'Cut, copy, paste, delete'),
  customGroupTools: L('Công cụ vẽ (chọn, dây, nhãn, đầu đo)', 'Drawing tools (select, wire, label, probe)'),
  customGroupTransform: L('Xoay và lật', 'Rotate and flip'),
  customGroupZoom: L('Thu phóng', 'Zoom'),
  customGroupView: L('Lưới và dấu ERC', 'Grid and ERC markers'),
  customGroupSimulate: L('Mô phỏng và phân tích', 'Simulation and analysis'),

  // ---- footprint manager
  fpTitle: L('Danh mục chân vỏ (footprint)', 'Footprint manager'),
  fpIntro: L(
    'Chân vỏ (footprint) là hình chân hàn của linh kiện trên mạch in. MachSim không vẽ mạch in, nhưng tên chân vỏ đi theo BOM và netlist xuất sang phần mềm PCB, nên số chân phải khớp.',
    'A footprint is the land pattern of a part on the printed board. MachSim does not lay out boards, but the footprint name travels with the BOM and the netlist you export to PCB software, so the pad count must match.',
  ),
  fpSearch: L('Tìm chân vỏ', 'Find a footprint'),
  fpFamily: L('Nhóm', 'Family'),
  fpAll: L('Tất cả', 'All'),
  fpPins: L('{n} chân', '{n} pads'),
  fpNoPins: L('không có chân hàn', 'no pads'),
  fpPitch: L('bước {v} mm', '{v} mm pitch'),
  fpBody: L('thân {w} × {h} mm', '{w} × {h} mm body'),
  fpSmd: L('dán (SMD)', 'surface mount'),
  fpThrough: L('xuyên lỗ', 'through hole'),
  fpUsedBy: L('Linh kiện dùng chân vỏ này: {n}', 'Parts using this footprint: {n}'),
  fpUsedNone: L('Chưa có linh kiện nào trong thư viện dùng chân vỏ này.', 'No library part uses this footprint yet.'),
  fpPreview: L('Hình chân vỏ (tỉ lệ mm)', 'Land pattern (in mm)'),
  fpPick: L('Dùng chân vỏ này', 'Use this footprint'),
  fpFamilyDip: L('IC hai hàng chân (DIP)', 'Dual in-line ICs (DIP)'),
  fpFamilySoic: L('IC dán (SOIC, MSOP)', 'Surface-mount ICs (SOIC, MSOP)'),
  fpFamilySip: L('Một hàng chân (SIP, hàng chân cắm)', 'Single row (SIP, headers)'),
  fpFamilyAxial: L('Hướng trục (điện trở, cuộn cảm)', 'Axial (resistors, inductors)'),
  fpFamilyRadial: L('Đứng (tụ, LED, cuộn cảm)', 'Radial (capacitors, LEDs, inductors)'),
  fpFamilyChip: L('Linh kiện dán hai đầu (0603 … 2512)', 'Two-pad chip parts (0603 … 2512)'),
  fpFamilyDo: L('Điốt (DO, SOD, SMA)', 'Diodes (DO, SOD, SMA)'),
  fpFamilyTo: L('Transistor và công suất (TO)', 'Transistors and power (TO)'),
  fpFamilySot: L('Transistor dán (SOT)', 'Surface-mount transistors (SOT)'),
  fpFamilyConnector: L('Đầu nối và đế cắm', 'Connectors and sockets'),
  fpFamilyDisplay: L('Màn hình và LED nhiều đoạn', 'Displays and multi-segment LEDs'),
  fpFamilyOther: L('Khác', 'Other'),
  fpMismatch: L('Linh kiện có {pins} chân nhưng chân vỏ {name} có {fpPins} chân.', 'The part has {pins} pins but footprint {name} has {fpPins} pads.'),
} as const;

export type SchematicToolsKey = keyof typeof SCHEMATIC_TOOLS_TEXT;

/** One text of the schematic tools in the current language. */
export function stt(key: SchematicToolsKey, params?: Record<string, string | number>): string {
  const entry: LocalizedText = SCHEMATIC_TOOLS_TEXT[key];
  return params ? interpolate(tr(entry), params) : tr(entry);
}
