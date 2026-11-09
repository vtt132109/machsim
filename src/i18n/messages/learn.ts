/**
 * Start-up texts of the learning, report and interop round: menu / toolbar labels, window titles
 * and the messages the editor and the simulation controller show while instructor restrictions
 * apply. The panels' own texts load with them (src/i18n/learnUi.ts, src/i18n/reportUi.ts).
 */
const learn = {
  // commands
  'cmd.help.lessons': ['Bài học có hướng dẫn…', 'Guided lessons…'],
  'cmd.help.commandLine': ['Dòng lệnh và chạy hàng loạt', 'Command line and batch runs'],
  'cmd.tools.descriptionBox': ['Hộp mô tả…', 'Description box…'],
  'cmd.options.instructor': ['Chế độ giảng viên…', 'Instructor mode…'],
  'cmd.reports.center': ['Mọi báo cáo…', 'All reports…'],
  'cmd.reports.componentDetail': ['Chi tiết linh kiện', 'Component detail'],
  'cmd.reports.modelData': ['Dữ liệu mô hình', 'Model data'],
  'cmd.reports.spareGates': ['Cổng còn trống', 'Spare gates'],
  'cmd.reports.crossReference': ['Tham chiếu chéo', 'Cross-reference'],
  'cmd.reports.statistics': ['Thống kê sơ đồ', 'Schematic statistics'],
  'cmd.reports.bomFull': ['Danh sách vật tư (nhà sản xuất, dung sai)', 'Bill of materials (manufacturer, tolerance)'],
  'menu.transfer': ['Chuyển sang mạch in', 'Transfer to PCB'],
  'cmd.file.transfer.kicad': ['Xuất netlist KiCad…', 'Export KiCad netlist…'],
  'cmd.file.transfer.csv': ['Xuất netlist CSV…', 'Export CSV netlist…'],
  'cmd.file.transfer.forward': ['Chú thích xuôi (sơ đồ → mạch in)…', 'Forward annotation (schematic → PCB)…'],
  'cmd.file.transfer.backward': ['Chú thích ngược (mạch in → sơ đồ)…', 'Back annotation (PCB → schematic)…'],
  'cmd.file.importSpiceSchematic': ['Nhập SPICE thành sơ đồ…', 'Import SPICE as schematic…'],
  'learn.toolbar.lessons': ['Bài học có hướng dẫn: mục tiêu, lý thuyết, các bước được tự kiểm tra và câu hỏi', 'Guided lessons: goal, theory, auto-checked steps and a quiz'],
  'learn.toolbar.lessonsText': ['Bài học', 'Lessons'],
  'learn.toolbar.description': ['Hộp mô tả: hướng dẫn và câu hỏi của bài tập', 'Description box: the exercise’s instructions and questions'],
  // window titles
  'learn.window.lessons': ['Bài học', 'Lessons'],
  'learn.window.description': ['Hộp mô tả', 'Description box'],
  'learn.window.reports': ['Báo cáo', 'Reports'],
  // instructor restrictions (editor / controller messages)
  'learn.restricted.lockedPart': ['Linh kiện này bị giảng viên khoá: không di chuyển, xoá hay sửa được.', 'This part is locked by the instructor: it cannot be moved, deleted or edited.'],
  'learn.restricted.description': ['Giảng viên đã khoá hộp mô tả.', 'The instructor locked the description box.'],
  'learn.restricted.analysis': ['Giảng viên đã tắt phép phân tích “{analysis}” cho mạch này.', 'The instructor disabled the “{analysis}” analysis for this circuit.'],
  'learn.restricted.instrument': ['Giảng viên đã tắt thiết bị đo “{instrument}” cho mạch này.', 'The instructor disabled the “{instrument}” instrument for this circuit.'],
  'learn.restricted.values': ['Giá trị linh kiện bị giảng viên ẩn — hãy đo để tìm.', 'Part values are hidden by the instructor — measure to find them.'],
  'learn.restricted.export': ['Giá trị linh kiện đang bị giảng viên ẩn, nên không xuất được tệp này.', 'Part values are hidden by the instructor, so this file cannot be exported.'],
  'learn.restricted.paste': ['Không dán được: các linh kiện này được sao chép từ mạch có giá trị bị giảng viên ẩn, nên chỉ dán lại được vào chính mạch đó.', 'Cannot paste: these parts were copied from a circuit whose values the instructor hides, so they can only be pasted back into that circuit.'],
  'learn.restricted.find': ['Giá trị linh kiện bị giảng viên ẩn nên không được tìm hay thay thế.', 'Part values are hidden by the instructor, so they are not searched or replaced.'],
  'learn.restricted.editComponent': ['Giá trị linh kiện bị giảng viên ẩn, nên không mở được linh kiện này trong trình tạo linh kiện.', 'Part values are hidden by the instructor, so this part cannot be opened in the component wizard.'],
  'learn.restricted.faults': ['Mạch có lỗi ẩn (bài tập tìm lỗi), nên netlist không hiển thị để khỏi lộ đáp án. Dùng Mô phỏng › Hiện lỗi khi đã tìm xong.', 'The circuit has hidden faults (a troubleshooting exercise), so the netlist is not shown — it would give the answer away. Use Simulate › Reveal faults when you are done.'],
  'learn.restricted.banner': ['Mạch có giới hạn của giảng viên.', 'This circuit has instructor restrictions.'],
  // .include / .lib files of an imported SPICE deck (browser: the user picks them)
  'integration.include.title': ['Thiếu tệp đi kèm', 'Included file needed'],
  'integration.include.message': ['Netlist gọi tệp “{name}” bằng .include / .lib. Trình duyệt không tự đọc được tệp đó: hãy chọn tệp, hoặc bỏ qua (các mô hình trong tệp sẽ thiếu).', 'The netlist includes “{name}” with .include / .lib. The browser cannot read it by itself: pick the file, or skip it (its models will be missing).'],
  'integration.include.pick': ['Chọn {name}…', 'Pick {name}…'],
  'integration.include.skip': ['Bỏ qua', 'Skip'],
  'integration.include.missing': ['Thiếu tệp .include / .lib: {list}', 'Missing .include / .lib files: {list}'],
  // Properties > BOM / PCB
  'learn.fields.tab': ['BOM / mạch in', 'BOM / PCB'],
  'learn.fields.hint': ['Thông tin mua hàng và chân vỏ của linh kiện này, dùng cho danh sách vật tư và netlist mạch in.', 'Purchasing data and footprint of this part, used by the bill of materials and the PCB netlists.'],
  'learn.fields.manufacturer': ['Nhà sản xuất', 'Manufacturer'],
  'learn.fields.manufacturerTip': ['Hãng sản xuất linh kiện (hiện trong danh sách vật tư)', 'Who makes the part (shown in the bill of materials)'],
  'learn.fields.partNumber': ['Mã linh kiện', 'Part number'],
  'learn.fields.partNumberTip': ['Mã đặt hàng của nhà sản xuất', 'The manufacturer’s order code'],
  'learn.fields.supplier': ['Nhà cung cấp', 'Supplier'],
  'learn.fields.supplierTip': ['Nơi mua linh kiện', 'Where the part is bought'],
  'learn.fields.footprint': ['Vỏ (footprint)', 'Footprint'],
  'learn.fields.footprintTip': ['Tên chân vỏ cho mạch in; để trống thì dùng vỏ mặc định của linh kiện', 'Footprint name for the PCB; empty uses the part’s default footprint'],
  // message sources
  'sim.source.instructor': ['Giảng viên', 'Instructor'],
  'sim.source.lessons': ['Bài học', 'Lessons'],
  'sim.source.reports': ['Báo cáo', 'Reports'],
  'sim.source.pcb': ['Mạch in', 'PCB'],
  'sim.source.import': ['Nhập SPICE', 'SPICE import'],
} as const;

export default learn;
