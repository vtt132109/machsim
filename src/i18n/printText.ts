/**
 * Texts of the print preview (File > Print preview…), Vietnamese first. Loaded with the print
 * chunk (src/ui/print), so the start-up catalogue stays small; the command labels are in
 * messages/documents.ts. Original text written for MachSim.
 *
 *   pt('summary', { printed: 2, total: 3 })   text in the current language, {placeholders} filled
 */
import { interpolate, L, tr, type LocalizedText } from './core';

export const PRINT_TEXT = {
  title: L('Xem trước khi in', 'Print preview'),
  close: L('Đóng', 'Close'),
  help: L('Trợ giúp', 'Help'),
  helpTip: L('Mở trang hướng dẫn về in và xem trước.', 'Open the help page about printing and preview.'),
  print: L('In…', 'Print…'),
  pdf: L('Lưu thành PDF…', 'Save as PDF…'),
  pdfTip: L('Ghi các trang này thành một tệp PDF.', 'Write these pages to a PDF file.'),
  printTipDesktop: L('Mở hộp in của Windows với đúng khổ giấy đã chọn.', 'Open the Windows print dialog with the paper chosen here.'),
  printTipBrowser: L('Mở hộp in của trình duyệt. Trong đó có thể chọn "Lưu thành PDF" để ghi ra tệp.', 'Open the browser print dialog. Choose "Save as PDF" there to write a file.'),
  preparing: L('Đang chuẩn bị các trang…', 'Preparing the pages…'),
  summary: L('Sẽ in {printed} / {total} trang', 'Printing {printed} of {total} pages'),
  nothing: L('Chưa có gì để in. Hãy chọn nội dung ở bên trái.', 'Nothing to print yet. Choose the contents on the left.'),
  pages: L('Các trang sẽ in', 'Pages to print'),
  printFailed: L('Không in được: {reason}', 'Printing failed: {reason}'),
  pdfSaved: L('Đã lưu tệp PDF “{name}”.', 'Saved the PDF “{name}”.'),

  // ---- contents
  contents: L('Nội dung', 'Contents'),
  sheets: L('Trang sơ đồ và trang bậc thang', 'Schematic and ladder sheets'),
  scope: L('Phạm vi', 'Scope'),
  scopeAll: L('Tất cả các trang', 'All sheets'),
  scopeCurrent: L('Chỉ trang đang mở', 'Current sheet only'),
  scopeSelection: L('Chỉ vùng đang chọn', 'Selection only'),
  scopeSelectionNone: L('Vùng đang chọn (chưa chọn gì)', 'Selection (nothing selected)'),
  children: L('Cả các trang trong mạch con / khối', 'Include sheets of subcircuits / blocks'),
  frame: L('Khung giấy và khung tên của trang', 'Sheet frame and title block'),
  instruments: L('Bảng cài đặt thiết bị đo', 'Instrument settings list'),
  grapher: L('Đồ thị trong Grapher', 'Grapher pages'),
  grapherNone: L('Chạy một phép phân tích và mở Grapher để có đồ thị cần in.', 'Run an analysis and open the Grapher to have graphs to print.'),
  report: L('Báo cáo', 'Report'),
  lesson: L('Tài liệu bài học', 'Lesson hand-out'),
  none: L('(không)', '(none)'),
  selectionOf: L('Vùng chọn của {sheet}', 'Selection of {sheet}'),
  noInstruments: L('Thiết kế chưa đặt thiết bị đo nào.', 'The design has no instruments.'),
  instrumentsTitle: L('Thiết bị đo của “{title}”', 'Instruments of “{title}”'),
  colInstrument: L('Thiết bị', 'Instrument'),
  colSetting: L('Cài đặt', 'Setting'),
  colValue: L('Giá trị', 'Value'),
  lessonGoal: L('Mục tiêu', 'Goal'),
  lessonTheory: L('Lý thuyết', 'Theory'),
  lessonTasks: L('Việc cần làm', 'Tasks'),
  lessonQuiz: L('Câu hỏi', 'Questions'),

  // ---- page
  page: L('Trang giấy', 'Page'),
  paper: L('Khổ giấy', 'Paper'),
  paperCustom: L('Tuỳ chỉnh…', 'Custom…'),
  customWidth: L('Rộng', 'Width'),
  customHeight: L('Cao', 'Height'),
  customInvalid: L('Nhập số từ 50 đến 2000.', 'Enter a number from 50 to 2000.'),
  orientation: L('Hướng giấy', 'Orientation'),
  landscape: L('Nằm ngang', 'Landscape'),
  portrait: L('Thẳng đứng', 'Portrait'),
  margin: L('Lề', 'Margin'),
  marginInvalid: L('Nhập số từ {min} đến {max}.', 'Enter a number from {min} to {max}.'),
  scale: L('Tỉ lệ', 'Scale'),
  scaleHint: L('“fit” = vừa khít trang giấy; số = phần trăm kích thước thật (100 % là đúng cỡ khổ giấy của trang).', '“fit” = fill the page; a number = percent of the real size (100 % is the sheet\'s own paper size).'),
  scaleInvalid: L('Nhập “fit” hoặc số từ 5 đến 1000.', 'Enter “fit” or a number from 5 to 1000.'),
  scaleFit: L('Vừa trang', 'Fit page'),
  tile: L('Chia trang lớn thành nhiều tờ giấy (ghép lại sau khi in)', 'Split a large sheet over several pages (join them after printing)'),
  tileNeedsScale: L('Chia tờ chỉ dùng được khi tỉ lệ là một số phần trăm, không phải “fit”.', 'Splitting needs a percent scale, not “fit”.'),
  colour: L('Màu', 'Colour'),
  colourColour: L('Có màu', 'Colour'),
  colourMono: L('Đen trắng', 'Black and white'),
  footer: L('Chân trang: tên thiết kế, số trang, ngày', 'Page footer: design, page number, date'),
  range: L('Các trang cần in', 'Pages to print'),
  rangeHint: L('Để trống để in tất cả. Ví dụ: 1-3, 5', 'Leave empty for all pages. Example: 1-3, 5'),
  rangeInvalid: L('“{text}” không hợp lệ: nhập số trang từ 1 đến {total}.', '“{text}” is not valid: enter page numbers from 1 to {total}.'),
  reset: L('Về mặc định', 'Reset to defaults'),
  zoom: L('Phóng to xem trước', 'Preview zoom'),
  zoomFit: L('Vừa chiều rộng', 'Fit width'),
  clipped: L('{n} trang lớn hơn tờ giấy nên bị cắt mép. Hãy chọn tỉ lệ “fit”, giảm tỉ lệ hoặc bật chia tờ.', '{n} sheet(s) are larger than the paper and get cut off. Choose “fit”, a smaller scale, or turn on splitting.'),
  hintDesktop: L('Nút In mở hộp in của Windows; “Lưu thành PDF” ghi tệp ngay không cần máy in.', 'Print opens the Windows print dialog; “Save as PDF” writes a file without a printer.'),
  hintBrowser: L('Trong hộp in của trình duyệt, chọn máy in “Lưu thành PDF” để ghi ra tệp. Nhớ đặt “Lề: không có” và bỏ “Đầu trang và chân trang” nếu trình duyệt hỏi.', 'In the browser print dialog choose the “Save as PDF” printer to write a file. Set “Margins: none” and turn off “Headers and footers” if the browser asks.'),

  // ---- page footer
  tileOf: L('ô {col}/{cols} × {row}/{rows}', 'tile {col}/{cols} × {row}/{rows}'),
  footerPage: L('trang {n}', 'page {n}'),
} satisfies Record<string, LocalizedText>;

export type PrintTextKey = keyof typeof PRINT_TEXT;

/** A print-preview text in the current language with {placeholders} filled. */
export function pt(key: PrintTextKey, params?: Record<string, string | number>): string {
  return interpolate(tr(PRINT_TEXT[key]), params);
}
