/**
 * Help sections added by the exchange-formats round (round 4, step 7): KiCad symbol libraries, KiCad
 * buses / sub-sheets / KiCad 5, the system clipboard and TDMS measurement files. Each list is
 * appended to the guide page of the same id by helpGuides.ts, so the older sections stay where they
 * are. Loaded with the help dialog (lazy). Original text.
 */
import { L } from './core';
import type { GuidePageId } from './helpGuides';
import type { LocalizedText } from './core';

export const XCHG_GUIDE_SECTIONS: Partial<Record<GuidePageId, { heading: LocalizedText; body: LocalizedText }[]>> = {
  exchange: [
    {
      heading: L('Thư viện ký hiệu KiCad (.kicad_sym, .lib)', 'KiCad symbol libraries (.kicad_sym, .lib)'),
      body: L(
        'Công cụ › Công cụ linh kiện › Nhập ký hiệu từ thư viện KiCad… (hoặc Tệp › Mở một tệp .kicad_sym) đọc thư viện ký hiệu của KiCad 6 trở lên (.kicad_sym) hay KiCad 5 (.lib). Mỗi ký hiệu thành một linh kiện trong Cơ sở dữ liệu của tôi: hình vẽ, chân (số chân, kiểu chân, hướng), tên vỏ, đường dẫn tài liệu, từ khoá và các trường khác được giữ. Ký hiệu nhiều phần (op-amp kép, cổng NAND bốn) thành một linh kiện cho mỗi phần. Nếu ký hiệu có trường mô phỏng (Sim.Device / Sim.Params / Sim.Pins của KiCad 8, hoặc Spice_Primitive / Spice_Model của KiCad 6–7) thì mô hình đi kèm: điện trở, tụ, cuộn cảm, nguồn DC dùng linh kiện có sẵn với giá trị đó; diode và transistor có tham số thành thẻ .model; mô hình trong tệp .lib / .cir riêng thì chọn luôn tệp đó cùng lúc với thư viện ký hiệu. Ký hiệu không có trường mô phỏng vẫn vẽ và lập danh sách linh kiện được; gắn mô hình sau bằng Trình tạo linh kiện. Công cụ › Xuất linh kiện thành thư viện KiCad… làm ngược lại: ghi mọi linh kiện của Cơ sở dữ liệu của tôi thành tệp .kicad_sym (kèm một tệp .lib chứa các mô hình SPICE, giữ hai tệp cạnh nhau).',
        'Tools › Component tools › Import symbols from a KiCad library… (or File › Open of a .kicad_sym file) reads symbol libraries of KiCad 6 and later (.kicad_sym) or KiCad 5 (.lib). Each symbol becomes a part of My database: the drawing, the pins (number, type, direction), the footprint name, the datasheet link, the keywords and the other fields are kept. A multi-unit symbol (a dual op-amp, a quad NAND) becomes one part per unit. If the symbol has simulation fields (Sim.Device / Sim.Params / Sim.Pins of KiCad 8, or Spice_Primitive / Spice_Model of KiCad 6–7) it keeps its model: resistors, capacitors, inductors and DC sources reuse the built-in part with that value; diodes and transistors with parameters become a .model card; a model that lives in a separate .lib / .cir file is loaded by choosing that file in the same pick as the symbol library. A symbol without simulation fields is still drawn and listed in the BOM; attach a model later with the Component wizard. Tools › Export parts as a KiCad library… does the reverse: it writes every part of My database to a .kicad_sym file (with a .lib file holding the SPICE models; keep the two together).',
      ),
    },
    {
      heading: L('Sơ đồ KiCad: bus, trang con và KiCad 5', 'KiCad schematics: buses, sub-sheets and KiCad 5'),
      body: L(
        'Ngoài điện trở, tụ, transistor…, MachSim giờ đọc cả bus của KiCad (đường bus mang tên như D[0..7] hay {A B C}, và các lối vào bus): bus được vẽ lại thành dây bus có tên, mỗi lối vào thành một đoạn dây ngắn với nhãn lối vào bus; dây của lối vào cần có nhãn mạng (D3…) để biết nó thuộc đường nào. Trang con phân cấp (sheet) thành khối phân cấp: MachSim hỏi các tệp trang con (chọn nhiều tệp một lúc), dựng mỗi tệp thành một khối với các đầu nối là nhãn phân cấp của trang đó; hai sheet cùng trỏ một tệp dùng chung một khối. Sơ đồ KiCad 5 (.sch) cũng mở được nếu bạn đưa các thư viện .lib của nó: tệp “<tên dự án>-cache.lib” nằm cạnh sơ đồ có đủ mọi ký hiệu. Linh kiện thiếu ký hiệu hay tệp trang con bị liệt kê để bạn bổ sung; trang con thiếu tệp được vẽ thành một khối rỗng đúng số chân.',
        'Besides resistors, capacitors, transistors …, MachSim now reads KiCad buses too (a bus named like D[0..7] or {A B C}, and its bus entries): a bus is redrawn as a named bus wire and each entry as a short wire with a bus-entry label; the wire of an entry needs a net label (D3 …) so MachSim knows which line it is. Hierarchical sheets become hierarchical blocks: MachSim asks for the sub-sheet files (choose several at once) and builds each file into a block whose connectors are that sheet’s hierarchical labels; two sheet symbols that point to one file share one block. KiCad 5 schematics (.sch) open too if you supply their .lib libraries: the file “<project>-cache.lib” next to the schematic holds every symbol. Parts with no library symbol and sub-sheets with no file are listed so you can add them; a sub-sheet with no file is drawn as an empty box with the right pins.',
      ),
    },
  ],
  snippets: [
    {
      heading: L('Bộ nhớ tạm của hệ thống: dán mạch giữa các cửa sổ và chương trình', 'The system clipboard: pasting a circuit between windows and programs'),
      body: L(
        'Sửa › “Sao chép ra bộ nhớ tạm hệ thống (ảnh + mạch)” đưa vùng chọn lên bộ nhớ tạm của máy dưới nhiều dạng cùng lúc: một bức ảnh (dán được vào tài liệu, thư điện tử, chương trình vẽ), một dòng chữ mô tả, và chính mạch ở định dạng riêng của MachSim. Dán sang cửa sổ MachSim khác (hay máy khác chạy MachSim) bằng Sửa › “Dán từ bộ nhớ tạm hệ thống”, hoặc nhấn Ctrl+V khi bộ nhớ tạm riêng của MachSim đang trống: bạn nhận lại mạch chứ không phải bức ảnh. Nếu bộ nhớ tạm chỉ có một bức ảnh mà dữ liệu mạch đã mất (ảnh đến từ chương trình khác, hoặc đi qua nơi bỏ dữ liệu như chương trình trò chuyện hay trình duyệt), MachSim nói điều đó TRƯỚC khi dán, kèm cách lấy mạch: dùng lệnh sao chép này trong MachSim thay vì chụp màn hình, hoặc gửi tệp snippet PNG gốc. Bản desktop giữ được cả ảnh lẫn định dạng riêng; trình duyệt tuỳ loại: nhiều trình duyệt chỉ cho ghi ảnh, không cho ghi định dạng riêng, và MachSim cho biết điều đó ngay lúc sao chép.',
        'Edit › “Copy to the system clipboard (picture + circuit)” puts the selection on the computer’s clipboard in several forms at once: a picture (it pastes into documents, e-mail, drawing programs), a line of descriptive text, and the circuit itself in MachSim’s own format. Paste into another MachSim window (or another computer running MachSim) with Edit › “Paste from the system clipboard”, or press Ctrl+V when MachSim’s own clipboard is empty: you get the circuit back, not the picture. If the clipboard only holds a picture whose circuit data is gone (the picture came from another program, or passed through somewhere that drops data, such as a chat program or a browser), MachSim says so BEFORE pasting and tells you how to get the circuit: use this copy command inside MachSim instead of a screenshot, or send the original snippet PNG file. The desktop app keeps both the picture and the private format; browsers vary: many can write a picture but not a private format, and MachSim tells you so as soon as you copy.',
      ),
    },
  ],
  measurements: [
    {
      heading: L('Tệp đo TDMS nhị phân', 'Binary TDMS measurement files'),
      body: L(
        'Mô phỏng › Nhập dữ liệu đo vào Grapher nhận thêm tệp .tdms (định dạng nhị phân mà phần mềm thu thập dữ liệu ghi): mỗi kênh số thành một đường, với trục thời gian lấy từ thuộc tính của kênh (wf_increment, wf_start_offset) hoặc từ kênh thời gian trong cùng nhóm; nếu tệp không có thông tin thời gian, trục là số thứ tự mẫu và MachSim nói rõ. Tệp dài được lấy thưa để đồ thị còn nhẹ. Nguồn áp / dòng đọc tệp đo cũng nhận .tdms qua nút “Mở tệp…”: tệp được đổi thành văn bản (cột thời gian rồi mỗi kênh một cột) để mạch phát lại. Chưa đọc: cặp .tdm + .tdx, dữ liệu thô DAQmx, số phức; thang đo trong tệp (NI_Scale…) chưa được áp dụng và MachSim cảnh báo.',
        'Simulate › Import measurement data into the Grapher now accepts .tdms files (the binary format that data-acquisition software writes): each numeric channel becomes a trace, with the time axis taken from the channel’s properties (wf_increment, wf_start_offset) or from a time channel in the same group; if the file has no time information the axis is the sample number and MachSim says so. Long files are thinned so the graph stays light. The voltage / current sources that play a measurement file accept .tdms through “Open file…” too: the file is converted to text (a time column, then one column per channel) for the circuit to replay. Not read: .tdm + .tdx pairs, DAQmx raw data, complex numbers; scaling stored in the file (NI_Scale…) is not applied and MachSim warns.',
      ),
    },
  ],
};
