/**
 * Help pages of several open designs, printing and the editing commands that came with them:
 * "documents" (document tabs, Window menu, closing and saving, moving content between designs,
 * recovery), "printing" (print preview, page setup, tiling, PDF) and "editingTools" (layer
 * settings, drawing order, paste special, reference designator prefixes). Merged into GUIDE_PAGES
 * (helpGuides.ts); loaded with the help dialog. Original text.
 */
import { L } from './core';
import type { GuidePage } from './helpGuides';

export const DOCS_GUIDE_PAGES: Record<'documents' | 'printing' | 'editingTools', GuidePage> = {
  documents: {
    title: L('Mở nhiều thiết kế cùng lúc', 'Several designs open at once'),
    sections: [
      {
        heading: L('Mỗi thiết kế một thẻ', 'One tab per design'),
        body: L(
          'Mở một tệp, một mạch mẫu, một bài học hay chọn Tệp › Thiết kế mới: thiết kế đó nằm trong thẻ riêng ngay dưới thanh công cụ, các thiết kế đang mở vẫn còn nguyên. Mỗi thẻ có lịch sử hoàn tác, vùng chọn, kết quả mô phỏng và các trang đồ thị Grapher riêng; chấm tròn ● báo thiết kế chưa lưu. Chỉ có một thiết kế thì thanh thẻ không hiện. Thiết kế mới tinh chưa ai sửa (mạch trống lúc vừa mở MachSim) được thay thế chứ không chồng thêm một thẻ trống.',
          'Open a file, a sample circuit, a lesson, or choose File › New design: the design opens in a tab of its own just under the toolbar and the designs already open stay as they are. Every tab has its own undo history, selection, simulation results and Grapher pages; a dot ● marks a design with unsaved changes. With one design the tab bar is not shown. An untouched new design (the empty circuit MachSim starts with) is replaced rather than left as an empty tab.',
        ),
      },
      {
        heading: L('Chuyển qua lại', 'Switching between designs'),
        body: L(
          'Nhấp vào thẻ, hoặc Ctrl+Tab / Ctrl+Shift+Tab (thiết kế kế tiếp / trước đó), hoặc menu Cửa sổ (liệt kê mọi thiết kế, có “thiết kế vừa dùng trước đó”). Kéo thẻ để đổi thứ tự. Khi đang mô phỏng mà chuyển sang thiết kế khác, MachSim dừng mô phỏng của thiết kế cũ trước; kết quả vẫn còn khi bạn quay lại. Menu Cửa sổ ẩn trong chế độ người mới, còn thẻ và Ctrl+Tab vẫn dùng được.',
          'Click a tab, or press Ctrl+Tab / Ctrl+Shift+Tab (next / previous design), or use the Window menu (it lists every design, with “last used design”). Drag a tab to reorder. If a simulation is running when you switch, MachSim stops the old design\'s simulation first; its results are still there when you come back. The Window menu is hidden in beginner mode, but the tabs and Ctrl+Tab still work.',
        ),
      },
      {
        heading: L('Chép giữa các thiết kế', 'Copying between designs'),
        body: L(
          'Sao chép (Ctrl+C) trong thiết kế này rồi dán (Ctrl+V) vào thiết kế khác — bộ nhớ tạm dùng chung. Nhanh hơn: kéo vùng chọn trên sơ đồ thả lên thẻ của thiết kế kia, hoặc kéo một linh kiện từ bảng thư viện thả lên thẻ. Tham số toàn cục, phương án lắp ráp và linh kiện người dùng mà đoạn mạch cần đi theo nó; cái nào thiết kế đích không có thì MachSim báo trong bảng Thông báo. Dán đặc biệt (menu Sửa) cho thêm ba cách dán.',
          'Copy (Ctrl+C) in one design and paste (Ctrl+V) into another — the clipboard is shared. Quicker: drag the selection on the schematic and drop it on the other design\'s tab, or drag a part from the library onto the tab. The global parameters, assembly variants and user components the fragment needs travel with it; whatever the target design lacks is reported in the Messages tab. Paste special (Edit menu) adds three more ways to paste.',
        ),
      },
      {
        heading: L('Đóng và lưu', 'Closing and saving'),
        body: L(
          'Tệp › Đóng thiết kế (Ctrl+F4) đóng thẻ đang mở, hỏi lưu nếu có thay đổi. Tệp › Đóng tất cả và Tệp › Lưu tất cả làm cho mọi thiết kế; khi thoát MachSim (bản desktop) chỉ có MỘT câu hỏi liệt kê tất cả thiết kế chưa lưu: Lưu tất cả / Không lưu / Huỷ. Đóng thiết kế cuối cùng thì MachSim mở một thiết kế trống.',
          'File › Close design (Ctrl+F4) closes the current tab and asks to save if there are changes. File › Close all and File › Save all work on every design; when you quit MachSim (desktop) there is ONE question that lists every unsaved design: Save all / Don\'t save / Cancel. Closing the last design leaves an empty one.',
        ),
      },
      {
        heading: L('Tự lưu và khôi phục', 'Autosave and recovery'),
        body: L(
          'Bản lưu tự động giữ MỌI thiết kế chưa lưu. Nếu MachSim bị tắt đột ngột, lần mở sau sẽ hỏi khôi phục tất cả; mỗi thiết kế quay lại trong một thẻ, vẫn ở trạng thái chưa lưu. Mở thêm tệp từ Explorer (hoặc mở lần hai bản desktop) cũng đưa tệp vào một thẻ mới của cửa sổ đang chạy. Giới hạn 16 thiết kế mở cùng lúc.',
          'Autosave keeps EVERY unsaved design. If MachSim is shut down abruptly the next start asks whether to recover them all; each design comes back in a tab, still unsaved. Opening another file from Explorer (or starting the desktop app a second time) puts the file in a new tab of the running window. At most 16 designs can be open at once.',
        ),
      },
    ],
  },
  printing: {
    title: L('In, xem trước và lưu PDF', 'Printing, preview and PDF'),
    sections: [
      {
        heading: L('Xem trước rồi mới in', 'Look first, then print'),
        body: L(
          'Tệp › In và xem trước… (Ctrl+P) mở hộp Xem trước khi in: bên phải là từng trang đúng như sẽ in, bên trái là các lựa chọn. Chọn nội dung: các trang sơ đồ và trang bậc thang (tất cả, trang đang mở hoặc chỉ vùng đang chọn), bảng cài đặt thiết bị đo, đồ thị trong Grapher, một báo cáo (BOM, thống kê…) hay tài liệu của một bài học. Chọn trang giấy: khổ, hướng, lề, tỉ lệ, màu hay đen trắng, khung tên, chân trang, các trang cần in.',
          'File › Print and preview… (Ctrl+P) opens the Print preview: on the right every page exactly as it will print, on the left the options. Choose the contents: schematic and ladder sheets (all, the current one, or just the selection), the instrument settings list, Grapher graphs, a report (BOM, statistics…) or the hand-out of a lesson. Choose the page: paper, orientation, margins, scale, colour or black and white, title block, footer, which pages.',
        ),
      },
      {
        heading: L('Tỉ lệ và chia tờ', 'Scale and splitting a sheet'),
        body: L(
          '“fit” co trang vừa khít tờ giấy. Một con số là phần trăm kích thước thật: 100 % là đúng kích thước thật của trang (trang A4 rộng 297 × 210 mm, nên cần đặt lề về 0 để vừa một tờ A4). Trang lớn hơn tờ giấy bị cắt mép — trừ khi bật “Chia trang lớn thành nhiều tờ”: khi đó MachSim chia thành nhiều ô (cột × hàng), mỗi ô một tờ, chồng nhau 8 mm để dán ghép; chân trang ghi “ô 2/3 × 1/2”. Ví dụ trang A2 in ở 50 % trên giấy A4 cho 4 tờ (2 × 2), ở 100 % cho 9 tờ (3 × 3).',
          '“fit” shrinks the sheet to fill the paper. A number is a percentage of the real size: 100 % is the sheet\'s own paper size (an A4 sheet is 297 × 210 mm, so it needs margins of 0 to fit one A4 page). A sheet larger than the paper gets cut off at the edge — unless you turn on “Split a large sheet over several pages”: MachSim then cuts it into tiles (columns × rows), one page each, overlapping by 8 mm so they can be glued together; the footer says “tile 2/3 × 1/2”. For example an A2 sheet printed at 50 % on A4 paper gives 4 pages (2 × 2), at 100 % it gives 9 (3 × 3).',
        ),
      },
      {
        heading: L('Các trang cần in', 'Which pages'),
        body: L(
          'Ô “Các trang cần in” nhận số trang tính cả các ô của trang chia tờ: “1-3, 5”, “2-” (từ trang 2 đến hết), “-4” (đến trang 4). Dòng tóm tắt cuối hộp cho biết “Sẽ in 3 / 7 trang”.',
          'The “Pages to print” box takes page numbers counting the tiles of a split sheet: “1-3, 5”, “2-” (page 2 to the end), “-4” (up to page 4). The summary at the bottom says “Printing 3 of 7 pages”.',
        ),
      },
      {
        heading: L('In ra giấy và lưu PDF', 'To paper and to PDF'),
        body: L(
          'Bản desktop: nút In mở hộp in của Windows với đúng khổ giấy đã chọn; “Lưu thành PDF” ghi tệp ngay, không cần máy in. Trên trình duyệt: nút In mở hộp in của trình duyệt — chọn máy in “Lưu thành PDF” ở đó; nếu trình duyệt hỏi, đặt Lề là “Không có” và tắt “Đầu trang và chân trang”. Cài đặt trang in được lưu cùng thiết kế.',
          'Desktop: Print opens the Windows print dialog with the paper you chose; “Save as PDF” writes a file at once, no printer needed. In a browser: Print opens the browser print dialog — pick the “Save as PDF” printer there; if the browser asks, set Margins to “None” and turn off “Headers and footers”. The page setup is saved with the design.',
        ),
      },
    ],
  },
  editingTools: {
    title: L('Lớp hiển thị, thứ tự, dán đặc biệt và tiền tố tên', 'Layers, order, paste special and name prefixes'),
    sections: [
      {
        heading: L('Lớp hiển thị (Sửa › Lớp hiển thị)', 'Layer settings (Edit › Layer settings)'),
        body: L(
          'Bật / tắt từng lớp của trang: lưới, tên linh kiện, giá trị, nhãn net, tên của mọi net, số chân, ghi chú dán và hình vẽ minh hoạ. Ẩn giá trị rồi in ra là bạn có một đề bài để bạn học tính; bật “Tên của mọi net” và “Số chân” khi đọc netlist hay nối vi mạch. Ẩn lớp chỉ đổi cách vẽ — mạch, ERC và BOM không đổi — và ảnh xuất, bản in làm theo. Áp dụng cho trang đang mở, mọi trang cùng mạch, hoặc cả thiết kế.',
          'Show or hide each layer of the sheet: grid, reference designators, values, net labels, the names of all nets, pin numbers, sticky comments and graphics. Hide the values and print, and you have a worksheet for a classmate to work out; turn on “Names of all nets” and “Pin numbers” when reading a netlist or wiring a chip. Hiding a layer changes the drawing only — the circuit, ERC and BOM are unchanged — and exported images and printouts follow. Apply it to the current sheet, every sheet of the design level, or the whole design.',
        ),
      },
      {
        heading: L('Thứ tự (Sửa › Thứ tự…)', 'Order (Edit › Order)'),
        body: L(
          'Hình vẽ và ô chữ chồng lên nhau theo thứ tự vẽ. Chọn chúng rồi “Đưa lên trên cùng” / “Đưa xuống dưới cùng” (hoặc một lớp). Ví dụ: vẽ hình chữ nhật tô màu rồi “Đưa xuống dưới cùng” để nó làm nền cho dòng chữ. Chuột phải lên hình hoặc chữ cũng có mục Thứ tự.',
          'Graphics and texts overlap in drawing order. Select them and choose “Bring to front” / “Send to back” (or one step). For example draw a filled rectangle and “Send to back” to make it a background for a caption. Right-clicking a graphic or text also offers Order.',
        ),
      },
      {
        heading: L('Dán đặc biệt (Sửa › Dán đặc biệt)', 'Paste special (Edit › Paste special)'),
        body: L(
          '“Dán giữ nguyên tên linh kiện”: các linh kiện giữ tên cũ (R5 vẫn là R5) nếu tên còn trống; tên đã có thì lấy số kế tiếp. “Dán chỉ giá trị”: chọn trước các linh kiện cần nhận, rồi giá trị của linh kiện đã sao chép được chép sang những linh kiện cùng loại, không đổi vị trí, dây hay tên. “Dán thành mạch con”: đoạn mạch dán xong được gói luôn thành một mạch con (khối) có các cổng tự tạo — cách nhanh để chia một mạch lớn.',
          '“Paste without renaming”: the parts keep their old names (R5 stays R5) when the name is free; a name already used gets the next number. “Paste values only”: select the parts that should receive the values first, and the copied parts\' values are written onto parts of the same kind, with no change of position, wiring or name. “Paste as subcircuit”: the pasted fragment is wrapped at once into a subcircuit (block) with ports made for you — a quick way to split up a big circuit.',
        ),
      },
      {
        heading: L('Tiền tố tên linh kiện (Công cụ)', 'Reference designator prefixes (Tools)'),
        body: L(
          'Dự án nhiều bo mạch cần các họ tên riêng. Quy tắc của thiết kế gồm một tiền tố chung (“A_” biến R1 thành A_R1) và tiền tố riêng cho từng loại (“U” thành “U1_” cho U1_1, U1_2…). Linh kiện đặt, dán, Đánh số tự động và Đánh số lại từ giờ theo quy tắc; netlist và BOM nhận tên mới bình thường. Bật “Đổi tên cả các linh kiện đã đặt” để áp dụng ngay cho mạch hiện có (giữ nguyên số thứ tự; tên nào sẽ trùng thì giữ lại và được báo). Tiền tố không được kết thúc bằng chữ số (thêm “_”).',
          'A multi-board project needs families of names of its own. The rules of a design are a common prefix (“A_” turns R1 into A_R1) and a prefix per kind of part (“U” becomes “U1_” for U1_1, U1_2…). Placing, pasting, Annotate and Renumber all follow the rules from then on; the netlist and the BOM take the new names as they are. Turn on “Also rename the parts already placed” to apply them to the existing circuit at once (the numbers stay; a name that would clash is kept and reported). A prefix must not end in a digit (add a “_”).',
        ),
      },
    ],
  },
};
