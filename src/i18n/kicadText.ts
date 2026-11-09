/**
 * Texts of the KiCad exchange: symbol libraries into the User database (Tools › Component tools ›
 * Import KiCad symbols…), the export back to a .kicad_sym, and the notes of the schematic import.
 * Vietnamese first, English second; loaded on demand with the dialogs that show them, so the
 * start-up catalogue does not grow. Original text written for MachSim.
 *
 *   kt('importTitle')                         plain text
 *   kt('noteUnits', { name: 'LM358', units: 3 })   with {placeholders}
 *   symbolNoteText(note)                      one note of the symbol importer as a sentence
 */
import { interpolate, L, tr, type LocalizedText } from './core';
import type { KicadSymbolNote } from '../model/kicadSymbols';

export const KICAD_TEXT = {
  // ---- import dialog
  importTitle: L('Nhập ký hiệu từ thư viện KiCad', 'Import symbols from a KiCad library'),
  importIntro: L(
    'Chọn một hay nhiều tệp thư viện ký hiệu của KiCad (.kicad_sym của KiCad 6 trở lên, hoặc .lib của KiCad 5). Mỗi ký hiệu thành một linh kiện trong Cơ sở dữ liệu của tôi: hình vẽ, chân (số chân, kiểu chân), chân vỏ và các trường ghi chú được giữ lại. Nếu ký hiệu có trường mô phỏng SPICE (Sim.* hay Spice_*) thì mô hình đi kèm; muốn nạp mô hình từ tệp .lib / .cir riêng, chọn luôn tệp đó cùng lúc.',
    'Choose one or more KiCad symbol library files (.kicad_sym from KiCad 6 and later, or .lib from KiCad 5). Each symbol becomes a part of My database: the drawing, the pins (numbers and types), the footprint and the other fields are kept. A symbol with SPICE simulation fields (Sim.* or Spice_*) keeps its model; to load a model from a separate .lib / .cir file, choose that file in the same pick.',
  ),
  pickFiles: L('Chọn tệp…', 'Choose files…'),
  pickTip: L('Chọn thư viện ký hiệu (.kicad_sym, .lib) và, nếu cần, các tệp mô hình SPICE (.lib, .cir, .sp).', 'Choose the symbol libraries (.kicad_sym, .lib) and, if needed, the SPICE model files (.lib, .cir, .sp).'),
  found: L('Tìm thấy {n} linh kiện trong {files} tệp.', 'Found {n} part(s) in {files} file(s).'),
  nothing: L('Không có ký hiệu nào dùng được trong các tệp đã chọn.', 'No usable symbol in the chosen files.'),
  importButton: L('Nhập {n} linh kiện', 'Import {n} part(s)'),
  partsHeading: L('Linh kiện sẽ thêm', 'Parts to add'),
  notesHeading: L('Cần lưu ý', 'Please note'),
  colName: L('Tên', 'Name'),
  colPins: L('Chân', 'Pins'),
  colModel: L('Mô hình', 'Model'),
  modelNone: L('chỉ để vẽ', 'drawing only'),
  modelSpice: L('SPICE', 'SPICE'),
  modelBuiltin: L('dùng linh kiện có sẵn', 'built-in part'),
  imported: L('Đã nhập {n} linh kiện vào Cơ sở dữ liệu của tôi.', 'Imported {n} part(s) into My database.'),
  readFailed: L('Không đọc được “{name}”: {reason}', 'Cannot read “{name}”: {reason}'),
  filterName: L('Thư viện ký hiệu KiCad', 'KiCad symbol library'),

  // ---- export
  exportTitle: L('Xuất ký hiệu thành thư viện KiCad', 'Export symbols as a KiCad library'),
  exportNone: L('Cơ sở dữ liệu của tôi chưa có linh kiện nào để xuất.', 'My database has no parts to export yet.'),
  exportName: L('Tên thư viện', 'Library name'),
  exportAsk: L('Xuất {n} linh kiện của Cơ sở dữ liệu của tôi thành một thư viện ký hiệu .kicad_sym?', 'Export the {n} part(s) of My database as a .kicad_sym symbol library?'),
  exported: L('Đã xuất {n} linh kiện: {name}.', 'Exported {n} part(s): {name}.'),
  exportedModels: L('Các mô hình SPICE được ghi vào {name}; giữ hai tệp cạnh nhau để KiCad tìm thấy.', 'The SPICE models are written to {name}; keep the two files together so KiCad can find them.'),
  exportFilter: L('Thư viện ký hiệu KiCad (.kicad_sym)', 'KiCad symbol library (.kicad_sym)'),
  modelFilter: L('Mô hình SPICE (.lib)', 'SPICE models (.lib)'),

  // ---- notes of the symbol importer
  notePower: L('“{name}” là ký hiệu nguồn: MachSim dùng tên net (ví dụ +5V, GND) thay cho nó, nên bỏ qua.', '“{name}” is a power symbol: MachSim uses net names (+5V, GND) instead, so it was skipped.'),
  notePinOffGrid: L('“{name}”: {count} chân nằm lệch lưới và đã được làm tròn về lưới 10.', '“{name}”: {count} pin(s) were off the grid and were rounded to the 10-unit grid.'),
  noteUnits: L('“{name}” có {units} đơn vị (phần): mỗi đơn vị thành một linh kiện riêng (A, B …) và không có mô hình.', '“{name}” has {units} units: each unit became a part of its own (A, B …) and has no model.'),
  noteDeMorgan: L('“{name}” có kiểu thân thay thế (De Morgan): chỉ nhập kiểu thân thường.', '“{name}” has an alternative (De Morgan) body: only the normal body was imported.'),
  noteExtends: L('“{name}” kế thừa từ “{base}” nhưng không tìm thấy “{base}” trong tệp.', '“{name}” extends “{base}”, which is not in the file.'),
  noteNoModel: L('“{name}” không có trường mô phỏng: linh kiện chỉ để vẽ và lập danh sách. Gắn mô hình bằng Trình tạo linh kiện nếu cần mô phỏng.', '“{name}” has no simulation field: the part is for drawing and the parts list. Attach a model with the Component wizard if you want to simulate it.'),
  noteLibMissing: L('“{name}” cần tệp mô hình “{file}”: hãy chọn tệp đó cùng lúc với thư viện ký hiệu.', '“{name}” needs the model file “{file}”: choose that file in the same pick as the symbol library.'),
  noteUnsupported: L('“{name}”: loại mô hình “{device}” chưa được hỗ trợ, nhập không kèm mô hình.', '“{name}”: the model type “{device}” is not supported, imported without a model.'),
  noteFromValue: L('“{name}” dùng linh kiện có sẵn “{part}” của MachSim làm mô hình (tên trùng với giá trị).', '“{name}” uses MachSim’s own part “{part}” as its model (the name matches the value).'),
  noteNoPins: L('“{name}” không có chân nào nên bị bỏ qua.', '“{name}” has no pins and was skipped.'),
  noteDuplicatePins: L('“{name}” có hai chân trùng số: chân thứ hai được thêm hậu tố _2.', '“{name}” has two pins with the same number: the second one got the suffix _2.'),

  // ---- notes of the schematic import
  importBuses: L('Đã vẽ lại {buses} đường bus và {entries} lối vào bus từ tệp KiCad.', 'Redrew {buses} bus(es) and {entries} bus entr(ies) from the KiCad file.'),
  importBlocks: L('Các trang con thành khối phân cấp: {names}.', 'The sub-sheets became hierarchical blocks: {names}.'),
  sheetsNeed: L('Sơ đồ này có trang con. Hãy chọn các tệp: {files}', 'This schematic has sub-sheets. Please choose the files: {files}'),
  libsNeed: L(
    'Sơ đồ KiCad 5 cần các thư viện linh kiện của nó. Hãy chọn tệp .lib: tệp “<tên dự án>-cache.lib” nằm cạnh sơ đồ có đủ mọi ký hiệu; hoặc chọn các thư viện như power.lib, device.lib.',
    'A KiCad 5 schematic needs its component libraries. Choose the .lib files: the file “<project>-cache.lib” next to the schematic holds every symbol; or choose libraries such as power.lib and device.lib.',
  ),
  missingSheets: L('Không có tệp của trang con: {files}. Trang con đó được vẽ thành một khối rỗng đúng số chân.', 'No file for the sub-sheet(s): {files}. Each is drawn as an empty box with the right pins.'),
  missingSymbols: L('Không có ký hiệu thư viện: {names}. Các linh kiện đó bị bỏ qua.', 'No library symbol for: {names}. Those parts were skipped.'),
  choose: L('Chọn tệp…', 'Choose files…'),
} as const;

type TextKey = {
  [K in keyof typeof KICAD_TEXT]: (typeof KICAD_TEXT)[K] extends LocalizedText ? K : never;
}[keyof typeof KICAD_TEXT];

/** Text of the KiCad exchange in the current language. */
export function kt(key: TextKey, params?: Record<string, string | number>): string {
  const text = tr(KICAD_TEXT[key] as LocalizedText);
  return params ? interpolate(text, params) : text;
}

/** One note of the symbol importer as a sentence. */
export function symbolNoteText(n: KicadSymbolNote): string {
  switch (n.code) {
    case 'powerSkipped':
      return kt('notePower', { name: n.name });
    case 'pinOffGrid':
      return kt('notePinOffGrid', { name: n.name, count: n.count });
    case 'units':
      return kt('noteUnits', { name: n.name, units: n.units });
    case 'deMorgan':
      return kt('noteDeMorgan', { name: n.name });
    case 'extendsMissing':
      return kt('noteExtends', { name: n.name, base: n.base });
    case 'noModel':
      return kt('noteNoModel', { name: n.name });
    case 'modelLibraryMissing':
      return kt('noteLibMissing', { name: n.name, file: n.file });
    case 'modelUnsupported':
      return kt('noteUnsupported', { name: n.name, device: n.device });
    case 'modelFromValue':
      return kt('noteFromValue', { name: n.name, part: n.part });
    case 'noPins':
      return kt('noteNoPins', { name: n.name });
    case 'duplicatePins':
      return kt('noteDuplicatePins', { name: n.name });
  }
}
