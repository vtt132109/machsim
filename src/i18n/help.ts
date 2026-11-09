/**
 * Learner help content of MachSim (original text, Vietnamese first, English second).
 *
 * - GETTING_STARTED: the step-by-step tutorial (place a part, wire, set values, add a meter,
 *   run, read the instrument).
 * - GROUP_HELP / FAMILY_HELP: "What is this?" for every component group and family
 *   (FAMILY_HELP is keyed by the library family name, e.g. 'Resistor').
 * - INSTRUMENT_HELP: every virtual instrument; ANALYSIS_HELP: every analysis type.
 *
 * Each entry says what the thing is, when to use it and how to read the result. The text is
 * written from general circuit theory for this project; nothing is copied from other products.
 * The help dialog (src/ui/help/HelpDialog.tsx) is the only consumer and is lazy-loaded.
 */
import type { PartGroup } from '../library/types';
import type { InstrumentKind } from '../model/types';
import type { AnalysisType } from '../sim/netlist';
import { L, type LocalizedText } from './core';
import { CATALOG_FAMILY_HELP } from './catalogHelp';

export interface HelpEntry {
  /** what it is */
  what: LocalizedText;
  /** typical use */
  use: LocalizedText;
  /** how to read the result / how it behaves in the simulator */
  read?: LocalizedText;
  /** a practical tip */
  tip?: LocalizedText;
}

export interface GuideStep {
  title: LocalizedText;
  body: LocalizedText;
  /** keys or clicks to try, shown as a highlighted line */
  action?: LocalizedText;
}

export const GETTING_STARTED: GuideStep[] = [
  {
    title: L('0. Quá nhiều thứ? Bật chế độ người mới', '0. Too much on screen? Turn beginner mode on'),
    body: L(
      'MachSim có rất nhiều chức năng, và lần đầu mở ra thì dễ hoa mắt. Tuỳ chọn > Chế độ người mới chỉ để lại những gì cần cho mạch đầu tiên: đặt linh kiện, nối dây, đo và chạy mô phỏng — menu, thanh công cụ và danh sách phép phân tích gọn lại, Trợ giúp vẫn đầy đủ. Thanh trạng thái ghi “Người mới”; nhấp vào đó là giao diện đầy đủ trở lại ngay, không mất gì cả. Khi đã quen, hãy tắt chế độ này để dùng hết công cụ.',
      'MachSim has a lot of features, and the first time you open it that can be overwhelming. Options > Beginner mode keeps only what a first circuit needs: place parts, wire them, measure and run — the menus, the toolbar and the analysis list get shorter, while Help stays complete. The status bar shows "Beginner"; click it and the full interface is back at once, with nothing lost. Once you are comfortable, switch the mode off to use every tool.',
    ),
    action: L('Trợ giúp > Có gì mới kể những điều MachSim mới làm được.', 'Help > What’s new lists what MachSim has learned to do lately.'),
  },
  {
    title: L('1. Làm quen màn hình', '1. Find your way around'),
    body: L(
      'Bên trái là Thư viện linh kiện (các nhóm: Nguồn, Linh kiện cơ bản, Diode …). Ở giữa là trang sơ đồ. Bên phải là bảng Thuộc tính của đối tượng đang chọn. Phía trên là menu và thanh công cụ; rê chuột lên một nút để xem nút đó làm gì.',
      'The component browser is on the left (groups: Sources, Basic, Diodes …). The schematic sheet is in the middle. The Properties panel on the right shows the selected item. Menus and the toolbar are on top; hover a button to see what it does.',
    ),
  },
  {
    title: L('2. Đặt linh kiện', '2. Place parts'),
    body: L(
      'Mở nhóm “Nguồn” → “Nguồn áp” và nhấp “Nguồn áp DC”, rồi nhấp lên trang sơ đồ để đặt. Làm tương tự với hai “Điện trở” (nhóm “Linh kiện cơ bản”) và một “Đất (Ground)”. Mạch nào cũng cần ít nhất một điểm đất. Nhấn R để xoay linh kiện, Esc để thôi đặt.',
      'Open “Sources” → “Voltage sources” and click “DC Voltage Source”, then click on the sheet to place it. Do the same for two “Resistor” parts (group “Basic”) and one “Ground”. Every circuit needs at least one ground. Press R to rotate, Esc to stop placing.',
    ),
    action: L('Ctrl+K: gõ tên để tìm nhanh, ví dụ “dien tro” hoặc “resistor”.', 'Ctrl+K: type to search, e.g. “resistor”.'),
  },
  {
    title: L('3. Nối dây', '3. Wire them'),
    body: L(
      'Rê chuột tới đầu mút (chân) của linh kiện cho đến khi thấy vòng tròn, nhấp một lần, rồi nhấp vào chân của linh kiện khác. Dây được vẽ tự động thành đường gấp khúc. Hai dây giao nhau chỉ nối với nhau khi có chấm nối.',
      'Move the mouse to the end of a pin until a circle appears, click once, then click a pin of another part. The wire is routed automatically. Crossing wires only connect where a junction dot is drawn.',
    ),
    action: L('Phím W bật công cụ nối dây; Backspace bỏ góc vừa vẽ.', 'W selects the wire tool; Backspace removes the last corner.'),
  },
  {
    title: L('4. Đặt giá trị', '4. Set values'),
    body: L(
      'Nhấp chọn một linh kiện, rồi sửa giá trị trong bảng Thuộc tính bên phải (hoặc nhấp đúp vào linh kiện). Có thể dùng hậu tố kỹ thuật: 4.7k = 4 700, 10u = 0.000 01, 2.2M hoặc 2.2meg = 2 200 000, 3m = 0.003 (m nhỏ là mili, M lớn là mega). Dấu thập phân luôn là dấu chấm.',
      'Click a part and edit its value in the Properties panel (or double-click the part). Engineering suffixes work: 4.7k, 10u, 2.2M or 2.2meg (mega), 3m (milli). Always use a decimal point.',
    ),
  },
  {
    title: L('5. Gắn thiết bị đo', '5. Add an instrument'),
    body: L(
      'Mở nhóm “Thiết bị đo” và đặt một “Đồng hồ vạn năng”. Nối cực + và cực − của đồng hồ song song với điện trở cần đo điện áp. Muốn đo dòng điện thì chọn chế độ A trên mặt đồng hồ và mắc đồng hồ nối tiếp vào mạch.',
      'Open “Instruments” and place a “Multimeter”. Connect its + and − terminals across the resistor whose voltage you want. To measure current, choose A on the meter and put the meter in series with the circuit.',
    ),
  },
  {
    title: L('6. Chạy mô phỏng', '6. Run the simulation'),
    body: L(
      'Nhấn nút Chạy ▶ trên thanh công cụ (hoặc F5). Nếu sơ đồ có lỗi (ví dụ thiếu đất), MachSim sẽ giải thích lỗi bằng tiếng Việt và chỉ vị trí trên sơ đồ. Nhấn Dừng ■ (Shift+F5) khi xong.',
      'Press Run ▶ on the toolbar (or F5). If something is wrong (for example no ground), MachSim explains the problem and shows where it is. Press Stop ■ (Shift+F5) when done.',
    ),
  },
  {
    title: L('7. Đọc số đo', '7. Read the instrument'),
    body: L(
      'Nhấp đúp vào đồng hồ để mở mặt máy. Số đo hiện bằng hậu tố kỹ thuật, ví dụ “2.500 V” hoặc “1.25 mA”. Với hai điện trở bằng nhau mắc nối tiếp vào nguồn 5 V, mỗi điện trở chịu 2.5 V. Thử đổi giá trị một điện trở rồi xem số đo thay đổi.',
      'Double-click the meter to open its panel. Readings use engineering notation, e.g. “2.500 V” or “1.25 mA”. With two equal resistors in series across 5 V, each one drops 2.5 V. Change one resistor and watch the reading change.',
    ),
  },
  {
    title: L('8. Học tiếp', '8. Keep learning'),
    body: L(
      'Mở Tệp › Mở mạch mẫu… để xem các mạch đã làm sẵn (lọc RC, chỉnh lưu, khuếch đại transistor, 555 …). Chọn một linh kiện hoặc thiết bị rồi nhấn F1 để đọc giải thích “Đây là gì?”. Menu Mô phỏng > Thiết lập phân tích cho phép chạy các phép phân tích như quét AC hay quá độ và xem đồ thị trong Grapher.',
      'Open File › Open samples… for ready-made circuits (RC filter, rectifiers, transistor amplifier, 555 …). Select a part or instrument and press F1 for its “What is this?” page. Simulate > Analysis settings runs analyses such as AC sweep or transient and plots them in the Grapher.',
    ),
  },
  {
    title: L('9. Mạch lớn: nhiều trang, mạch con và bus', '9. Large circuits: sheets, subcircuits and buses'),
    body: L(
      'Nhãn net thường chỉ nối các chỗ cùng tên trong một trang. Muốn nối sang trang khác, dùng Đặt > Đầu nối và bus > Đầu nối sang trang (cùng tên ở hai trang là nối nhau); đầu nối toàn cục hoặc nhãn đánh dấu “Toàn cục” nối ở mọi nơi. Chọn một phần mạch rồi Đặt > Phân cấp > Thay vùng chọn bằng mạch con để gói nó thành một khối; nhấp đúp vào khối để vào sửa bên trong, nút “Lên” để quay ra. Bus (Đặt > Bus) gom nhiều dây, ví dụ D[0..7]; dây chạm bus sẽ hỏi tên đường (D0 …). Xem mọi cấp trong thẻ “Cây thiết kế” bên trái.',
      'A plain net label joins the same name on one sheet only. To reach another sheet use Place > Connectors and buses > Off-page connector (the same name on two sheets connects); a global connector, or a label marked “Global”, connects everywhere. Select part of a circuit and use Place > Hierarchy > Replace selection by subcircuit to pack it into a block; double-click the block to edit its inside and press “Up” to come back. A bus (Place > Bus) groups many wires, e.g. D[0..7]; a wire that touches a bus asks for its line (D0 …). The “Design” tab on the left shows every level.',
    ),
    action: L('Thử: vẽ bộ chia áp hai điện trở, chọn hai điện trở và dây giữa, rồi “Thay vùng chọn bằng mạch con”.', 'Try it: draw a two-resistor divider, select both resistors and the wire between them, then “Replace selection by subcircuit”.'),
  },
  {
    title: L('10. Linh kiện thật, định mức và tìm lỗi', '10. Real parts, ratings and troubleshooting'),
    body: L(
      'Thư viện có hàng nghìn linh kiện thật (điện trở theo dãy E24, diode Zener, transistor, op-amp, ổn áp …). Gõ mã linh kiện vào ô tìm (ví dụ “BC547”, “7805”, “4.7k”), hoặc chọn một họ rồi dùng “Bộ lọc thông số” để lọc theo điện áp, dòng điện, vỏ. Bấm ☆ để đưa linh kiện vào Yêu thích; linh kiện vừa đặt nằm ở thẻ Gần đây. Nhóm “Linh kiện có định mức” sẽ cháy khi quá tải: chạy mô phỏng và đọc lời giải thích trong mục Thông báo. Mô phỏng > Lỗi ngẫu nhiên giấu một lỗi (hở, chập, rò) vào mạch để bạn đo và tìm ra; Mô phỏng > Hiện lỗi để xem đáp án.',
      'The library has thousands of real parts (E24 resistors, Zener diodes, transistors, op-amps, regulators …). Type a part number in the search box (e.g. “BC547”, “7805”, “4.7k”), or select a family and use “Specification filters” to filter by voltage, current or package. Click ☆ to add a part to the Favourites; parts you placed are on the Recent tab. Parts of the “Rated components” family burn out when overloaded: run the simulation and read the explanation in the messages. Simulate > Auto fault hides a fault (open, short, leakage) in the circuit for you to measure and find; Simulate > Reveal faults shows the answer.',
    ),
    action: L('Thử: nối Điện trở có định mức 100 Ω thẳng vào nguồn 12 V rồi nhấn F5 — điện trở 0.25 W sẽ cháy (1.44 W).', 'Try it: connect a 100 Ω Rated Resistor straight across a 12 V source and press F5 — the 0.25 W resistor burns out (1.44 W).'),
  },  {
    title: L('11. Mạch số: họ IC, bộ nhớ và màn hình', '11. Digital circuits: IC families, memories and displays'),
    body: L(
      'Nhóm TTL và CMOS có từng họ riêng: 74LS (họ hay dùng trong phòng thí nghiệm), 74HC, 74HCT, 74F, 4000 … Mỗi IC có chân nguồn ẩn: đặt ký hiệu VCC (hoặc VDD cho họ 4000) để IC lấy nguồn thật. Mô phỏng > Cài đặt mô phỏng số chọn chế độ Lý tưởng (không cần chân nguồn, dễ học) hoặc Thực tế (bắt buộc có nguồn, thấy được tải và sụt áp), và trễ lan truyền điển hình / lớn nhất / bằng 0. Nhóm Số khác có RAM, ROM (bấm “Sửa nội dung…” để nhập dữ liệu hex) và khối PLD viết bằng phương trình Boole; nhóm Hiển thị có LCD ký tự, LED ma trận, LED 14 / 16 đoạn.',
      'The TTL and CMOS groups have one family per technology: 74LS (the usual lab family), 74HC, 74HCT, 74F, 4000 … Every IC has hidden power pins: place a VCC symbol (VDD for the 4000 series) so it uses a real supply. Simulate > Digital simulation settings chooses Ideal mode (no power pins needed, easy to learn) or Real mode (supply required, loading and droop show up), and typical / maximum / zero propagation delays. The Misc Digital group has RAMs, ROMs (click “Edit contents…” to enter hex data) and a PLD block programmed with Boolean equations; the Indicators group has character LCDs, LED dot matrices and 14 / 16-segment displays.',
    ),
    action: L('Thử: Tệp › Mở mạch mẫu… > “LCD ký tự: hiện dòng chữ”, nhấn F5 và xem chữ hiện trên màn hình LCD.', 'Try it: File › Open samples… > “Character LCD: hello text”, press F5 and watch the text appear on the LCD.'),
  },
  {
    title: L('12. Tự tạo linh kiện và mô hình', '12. Make your own components and models'),
    body: L(
      'Công cụ > Linh kiện tự tạo > Trình tạo linh kiện dẫn bạn qua 8 bước: tên, ký hiệu (mẫu có sẵn hoặc tự vẽ), chân, chân vỏ, mô hình mô phỏng, ghép chân, thử mô phỏng và lưu. Mô hình có thể là một linh kiện có sẵn, thẻ .model / .subckt của nhà sản xuất (Công cụ > Nhập mô hình SPICE, đọc được tệp .lib), hoặc để MachSim tự tính từ datasheet: nhập VF của diode, hFE và fT của transistor, RDS(on) của MOSFET, GBW và tốc độ thay đổi của op-amp … rồi bấm “Tính mô hình” — bảng cho thấy số datasheet và giá trị mô phỏng cạnh nhau. Linh kiện lưu trong cơ sở dữ liệu Người dùng hoặc Công ty (Quản lý cơ sở dữ liệu: họ, trường thông tin, xuất / nhập tệp .msimdb để chia sẻ cho cả lớp); mỗi thiết kế mang theo bản sao của linh kiện nó dùng. Chọn một linh kiện trên sơ đồ rồi Sửa > Sửa ký hiệu / mô hình để vẽ lại ký hiệu và lưu thành linh kiện mới.',
      'Tools > Component tools > Component wizard walks you through 8 steps: name, symbol (a template or your own drawing), pins, footprint, simulation model, pin mapping, test and save. The model can be an existing part, the manufacturer’s .model / .subckt card (Tools > Import SPICE model, reads .lib files), or computed by MachSim from a datasheet: enter a diode’s VF, a transistor’s hFE and fT, a MOSFET’s RDS(on), an op-amp’s GBW and slew rate … and click “Fit the model” — a table shows the datasheet values next to the simulated ones. Components are saved in the User or Corporate database (Database manager: families, information fields, .msimdb export / import to share with a class); every design carries a copy of the components it uses. Select a part on the schematic and use Edit > Edit component symbol / model to redraw its symbol and save it as a new component.',
    ),
    action: L('Thử: Công cụ > Linh kiện tự tạo > Tạo mô hình từ datasheet, đặt tên “Diode của tôi”, bấm Tiếp tới bước Mô hình, bấm “Tính mô hình” và xem bảng so sánh ở bước Thử.', 'Try it: Tools > Component tools > Model maker, name it “My diode”, click Next up to the Model step, click “Fit the model” and look at the comparison on the Test step.'),
  },
  {
    title: L('13. So sánh các lần chạy, chọn biến đầu ra, khi mô phỏng không chạy', '13. Compare runs, choose outputs, when a simulation fails'),
    body: L(
      'Grapher giữ lại kết quả của 20 lần chạy gần nhất: mỗi lần chạy là một hoặc vài trang (danh sách “Trang”). Sửa một giá trị trên sơ đồ, chạy lại, rồi bấm “Thêm từ lần chạy mới nhất” hoặc “Thêm đường cong…” để vẽ chồng hai lần chạy và thấy ngay khác biệt. Mỗi trang có tên dùng được trong biểu thức của Bộ hậu xử lý, ví dụ V(out) - tran1.V(out) là độ chênh giữa lần này và lần 1; digital(V(q), 2.5) biến tín hiệu thành mức logic. “Thuộc tính…” đổi tên trục, khoảng trục, thang log, màu và độ dày đường; TXT / CSV / PNG / In để xuất. Trong Thiết lập phân tích, thẻ Đầu ra chọn biến cần lưu và thêm biểu thức tự tính sau mỗi lần chạy; thẻ Tuỳ chọn có nhóm Linh kiện (DEFL, DEFW …); “Hồ sơ mô phỏng” lưu cả bộ thiết lập để dùng lại; “Phân tích tự định nghĩa” nhận lệnh SPICE gõ tay. Khi bộ giải báo không hội tụ, ma trận suy biến hay bước thời gian quá nhỏ, bấm “Trợ lý hội tụ…”: nó thử lần lượt các cách sửa quen thuộc của SPICE và cho bạn giữ cách chạy được.',
      'The Grapher keeps the results of the last 20 runs: each run becomes one or a few pages (the “Page” list). Change a value on the schematic, run again, then click “Add from latest run” or “Add traces…” to overlay the two runs and see the difference at once. Every page has a name you can use in Postprocessor expressions, e.g. V(out) - tran1.V(out) is the difference between this run and run 1; digital(V(q), 2.5) turns a signal into logic levels. “Properties…” changes axis titles, ranges, log scales, trace colours and widths; TXT / CSV / PNG / Print export. In Analysis settings the Output tab chooses the variables to save and adds expressions computed after every run; the Options tab has a Device group (DEFL, DEFW …); “Simulation profile” saves the whole set of settings for reuse; the “User-defined analysis” takes typed SPICE cards. When the solver reports no convergence, a singular matrix or a timestep too small, click “Convergence assistant…”: it tries the usual SPICE fixes one by one and lets you keep the one that works.',
    ),
    action: L('Thử: mở mạch mẫu “Lọc thông thấp RC”, Mô phỏng > Chạy phân tích Quá độ, đổi R1 thành 2k, chạy lại, rồi trong Grapher bấm “Thêm từ lần chạy mới nhất”.', 'Try it: open the “RC low-pass filter” example, Simulate > Run Transient analysis, change R1 to 2k, run again, then click “Add from latest run” in the Grapher.'),
  },
  {
    title: L('14. Trình hướng dẫn mạch và thiết bị đo để bàn', '14. Circuit wizards and bench instruments'),
    body: L(
      'Công cụ > Trình hướng dẫn mạch tự tính và vẽ sẵn mạch chạy được ngay: IC 555 (dao động, đơn ổn), bộ lọc (thông thấp / cao / dải / chặn dải, Butterworth hoặc Chebyshev, thụ động LC hoặc tích cực dùng op-amp), các tầng op-amp (đảo, không đảo, hiệu, cộng, cộng có trọng số) và tầng khuếch đại E chung có tính phân cực. Bạn nhập yêu cầu (tần số, độ lợi …), hộp thoại cho xem trước sơ đồ, giá trị linh kiện, kết quả dự kiến và từng bước tính. Bộ tính trở kháng đường mạch in cho Z0 và trở kháng vi sai. Nhóm Thiết bị đo có thêm máy phát sóng tùy ý, đồng hồ 6½ chữ số có thống kê, dao động ký số 4 kênh có đo tự động, phép toán và FFT, và dao động ký tín hiệu hỗn hợp (2 kênh tương tự + 16 kênh logic). Bộ chuyển đổi logic vẽ được mạch cổng (hoặc chỉ NAND) từ biểu thức; máy phân tích mạng có chế độ “Thiết kế phối hợp” (vòng ổn định, phối hợp trở kháng L, vòng độ lợi).',
      'Tools > Circuit wizards compute and draw circuits that run straight away: 555 timer (astable, monostable), filters (low / high / band-pass / band-stop, Butterworth or Chebyshev, passive LC or active with op-amps), op-amp stages (inverting, non-inverting, difference, summing, weighted adder) and a common-emitter stage with its bias design. You enter what you want (frequency, gain …); the dialog previews the schematic, the part values, the predicted result and every design step. The PCB impedance calculator gives Z0 and differential impedance. The Instruments group adds an arbitrary waveform generator, a 6½-digit multimeter with statistics, a 4-channel storage oscilloscope with automatic measurements, math and FFT, and a mixed-signal oscilloscope (2 analog + 16 logic channels). The logic converter draws a gate (or NAND-only) circuit from an expression; the network analyzer has a “Match design” mode (stability circles, L-section matching, gain circles).',
    ),
    action: L('Thử: Công cụ > Trình hướng dẫn mạch > IC 555, đặt 1 kHz, bấm “Tạo thiết kế mới”, rồi Chạy (F5) và mở dao động ký XSC1.', 'Try it: Tools > Circuit wizards > 555 timer, set 1 kHz, click “Create a new design”, then Run (F5) and open the oscilloscope XSC1.'),
  },
  {
    title: L('15. Bài học, bài tập cho lớp, báo cáo và tệp', '15. Lessons, class exercises, reports and files'),
    body: L(
      'Trợ giúp > Bài học có hướng dẫn có 41 bài trong sáu mức, từ định luật Ohm tới sơ đồ bậc thang, vi điều khiển 8051 và nhóm “Kỹ năng dùng MachSim”: mỗi bài có lý thuyết, các bước MachSim tự kiểm tra trên sơ đồ của bạn (linh kiện, cách nối, giá trị đo) và câu hỏi ôn tập. Giảng viên tự soạn bài học trong Trợ giúp > Soạn bài học rồi lưu thành tệp .msimlesson để phát cho học viên; học viên xuất tiến độ thành tệp .msimprog để nộp. Giảng viên cũng viết hướng dẫn, công thức, hình và câu hỏi trong Công cụ > Hộp mô tả, rồi đặt giới hạn có mật khẩu ở Tuỳ chọn > Chế độ giảng viên (ẩn giá trị, khoá linh kiện, tắt phép phân tích hay thiết bị đo). Menu Báo cáo có BOM kèm nhà sản xuất, chi tiết linh kiện, dữ liệu mô hình, cổng còn trống, tham chiếu chéo và thống kê, xuất CSV / HTML hoặc in. Tệp > Nhập SPICE thành sơ đồ vẽ sơ đồ từ netlist; Tệp > Chuyển sang mạch in xuất netlist KiCad / CSV và tệp chú thích. Bản desktop chạy được mô phỏng hàng loạt từ dòng lệnh (Trợ giúp > Dòng lệnh).',
      'Help > Guided lessons has 41 lessons in six levels, from Ohm’s law to ladder diagrams, the 8051 microcontroller and the "Working with MachSim" level: each has theory, steps MachSim checks on your own schematic (parts, connections, measured values) and a quiz. A teacher can write lessons in Help > Lesson editor and save them as .msimlesson files to hand out; a student exports their progress as a .msimprog file to hand in. Instructors also write instructions, formulas, pictures and questions in Tools > Description box, then set password-protected restrictions in Options > Instructor mode (hidden values, locked parts, disabled analyses or instruments). The Reports menu has a BOM with manufacturers, component detail, model data, spare gates, cross-reference and statistics, exported to CSV / HTML or printed. File > Import SPICE as schematic draws a schematic from a netlist; File > Transfer to PCB writes KiCad / CSV netlists and annotation files. The desktop app runs batch simulations from the command line (Help > Command line).',
    ),
    action: L('Thử: bấm nút “Bài học” trên thanh công cụ, chọn “Định luật Ohm” và bấm “Bắt đầu bài”.', 'Try it: click the “Lessons” toolbar button, choose “Ohm’s law” and click “Start the lesson”.'),
  },
  {
    title: L('16. Nhiều thiết kế, in ấn và thẻ tham khảo', '16. Several designs, printing and the reference card'),
    body: L(
      'Mỗi thiết kế mở trong một thẻ riêng dưới thanh công cụ: Tệp > Thiết kế mới luôn thêm một thẻ, Ctrl+Tab chuyển thẻ, Tệp > Đóng thiết kế đóng thẻ đang xem. Ctrl+P mở bản xem trước khi in: chọn khổ giấy, hướng giấy, tỉ lệ và chân trang rồi In hoặc Lưu thành PDF; các lựa chọn được lưu trong tệp để lần sau mở ra vẫn như cũ. Trong hộp đó, mục “Thẻ tham khảo nhanh” in một tờ gồm sáu bước cho mạch đầu tiên, bảng phím tắt và các menu chính để dán cạnh màn hình.',
      'Every design opens in its own tab under the toolbar: File > New design always adds a tab, Ctrl+Tab switches tabs and File > Close design closes the one you are looking at. Ctrl+P opens the print preview: choose the paper, orientation, scale and footer, then Print or Save as PDF; the choices are saved in the file so it opens the same way next time. In that box, the “Quick-reference card” choice prints one sheet with six steps for a first circuit, the shortcut table and the main menus, to pin beside the screen.',
    ),
    action: L('Thử: Ctrl+P, tích “Thẻ tham khảo nhanh”, bỏ tích “Trang sơ đồ và trang bậc thang” và xem các trang in.', 'Try it: Ctrl+P, tick “Quick-reference card”, untick “Schematic and ladder sheets” and look at the pages.'),
  },
  {
    title: L('17. Gỡ lỗi, nghe thử và tập lệnh', '17. Debugging, listening and scripts'),
    body: L(
      'Mạch có vi điều khiển 8051 có thể gỡ lỗi từng bước: nhấp đúp vào vi điều khiển, bấm “Bắt đầu gỡ lỗi”, đặt điểm dừng rồi đi từng lệnh (F11), từng dòng (F10) hoặc từng chu kỳ máy (Shift+F11); đồng hồ của mạch dừng đúng thời điểm đó. Mạch có loa nghe được qua Mô phỏng > Âm thanh. Khi cần dựng hay quét hàng loạt mạch, Công cụ > Tập lệnh (JavaScript) cho bạn viết một chương trình ngắn (chế độ người mới ẩn mục này; bài học “Dựng mạch bằng tập lệnh JavaScript” hướng dẫn từng bước và có nút bật giao diện đầy đủ).',
      'A circuit with an 8051 microcontroller can be debugged step by step: double-click the microcontroller, press “Start debugging”, set a breakpoint and step by instruction (F11), by line (F10) or by machine cycle (Shift+F11); the circuit clock stops at exactly that instant. A circuit with a speaker can be heard through Simulate > Audio. When you need to build or sweep many circuits, Tools > Scripts (JavaScript) lets you write a short program (beginner mode hides this entry; the lesson “Build a circuit with a JavaScript script” walks you through it and has a button for the full interface).',
    ),
    action: L('Thử: Tệp › Mở mạch mẫu… > “8051 trễ đúng 1000 chu kỳ máy”, mở Trình soạn mã và bấm “Bắt đầu gỡ lỗi”.', 'Try it: File › Open samples… > “8051 delay loop of exactly 1000 machine cycles”, open the code editor and press “Start debugging”.'),
  },
];

// ---------------------------------------------------------------------------------------------
// component groups

export const GROUP_HELP: Record<PartGroup, HelpEntry> = {
  sources: {
    what: L('Nguồn năng lượng và tín hiệu của mạch: nguồn áp, nguồn dòng, nguồn xoay chiều, nguồn xung, nguồn phụ thuộc, đất và các đường nguồn VCC/VDD.', 'Energy and signal sources: voltage and current sources, AC, pulse and controlled sources, ground and supply rails.'),
    use: L('Mạch nào cũng cần ít nhất một nguồn và một điểm đất. Dùng nguồn DC để cấp nguồn, nguồn AC hoặc xung để tạo tín hiệu thử.', 'Every circuit needs a source and a ground. Use DC sources for supplies and AC or pulse sources as test signals.'),
  },
  basic: {
    what: L('Các linh kiện thụ động cơ bản: điện trở, tụ điện, cuộn cảm, biến áp và công tắc.', 'The basic passive parts: resistors, capacitors, inductors, transformers and switches.'),
    use: L('Đây là những linh kiện bạn dùng nhiều nhất: chia áp, hạn dòng, lọc, định thời và đóng ngắt.', 'The parts you use most: dividers, current limiting, filters, timing and switching.'),
  },
  diodes: {
    what: L('Linh kiện bán dẫn một chiều: dòng điện chỉ chạy dễ dàng từ anode sang cathode.', 'One-way semiconductor parts: current flows easily only from anode to cathode.'),
    use: L('Chỉnh lưu, bảo vệ ngược cực, ổn áp (Zener), báo hiệu (LED) và xén tín hiệu.', 'Rectifiers, reverse-polarity protection, regulation (Zener), indication (LED) and clipping.'),
  },
  transistors: {
    what: L('Linh kiện ba chân dùng tín hiệu nhỏ để điều khiển dòng lớn: BJT, JFET và MOSFET.', 'Three-terminal parts that let a small signal control a larger current: BJTs, JFETs and MOSFETs.'),
    use: L('Khuếch đại tín hiệu và làm khoá đóng ngắt (bật LED, rơ-le, động cơ).', 'Amplifiers and electronic switches (driving LEDs, relays, motors).'),
  },
  analog: {
    what: L('Mạch tích hợp tương tự: op-amp, bộ so sánh, IC định thời 555, nguồn chuẩn và các khối toán học.', 'Analog ICs: op-amps, comparators, the 555 timer, references and math blocks.'),
    use: L('Khuếch đại chính xác, lọc tích cực, so sánh ngưỡng, tạo dao động và xử lý tín hiệu.', 'Precision amplifiers, active filters, threshold detection, oscillators and signal processing.'),
  },
  ttl: {
    what: L('IC logic họ 74xx (TTL và các họ tương thích như 74LS, 74HC): cổng, flip-flop, bộ đếm, giải mã.', '74xx logic ICs (TTL and compatible families such as 74LS, 74HC): gates, flip-flops, counters, decoders.'),
    use: L('Mạch số thật với số chân như datasheet; chân nguồn ẩn nối vào net VCC.', 'Real digital circuits with datasheet pin numbers; hidden supply pins join the VCC net.'),
  },
  cmos: {
    what: L('IC logic CMOS họ 4000: cổng, flip-flop, bộ đếm, khoá tương tự, chạy với nguồn 3–18 V.', '4000-series CMOS logic: gates, flip-flops, counters, analog switches, 3–18 V supply.'),
    use: L('Mạch số tiêu thụ ít điện, ví dụ bộ đếm 4017 chạy LED hay bộ dao động 4060.', 'Low-power digital circuits, e.g. a 4017 LED chaser or a 4060 oscillator.'),
  },
  'misc-digital': {
    what: L('Phần tử số lý tưởng không có chân nguồn: cổng logic, flip-flop, chốt, nguồn mẫu bit.', 'Ideal digital elements without supply pins: gates, flip-flops, latches, pattern sources.'),
    use: L('Học logic nhanh mà không cần đi dây nguồn cho IC.', 'Learn logic quickly without wiring IC supplies.'),
  },
  mixed: {
    what: L('Linh kiện nối giữa thế giới tương tự và số: ADC, DAC, bộ so sánh có ngõ ra logic.', 'Parts between the analog and digital worlds: ADC, DAC, comparators with logic outputs.'),
    use: L('Đọc cảm biến bằng mạch số, tạo điện áp từ mã số.', 'Read sensors with logic, make voltages from digital codes.'),
  },
  indicators: {
    what: L('Linh kiện hiển thị kết quả ngay trên sơ đồ: vôn kế, ampe kế, bóng đèn, LED 7 đoạn, đèn báo, còi.', 'Parts that show results right on the schematic: voltmeters, ammeters, lamps, 7-segment displays, probes, buzzers.'),
    use: L('Xem mạch “sống” khi mô phỏng tương tác mà không cần mở thiết bị đo.', 'Watch the circuit come alive during interactive simulation without opening an instrument.'),
  },
  power: {
    what: L('Linh kiện quản lý nguồn: ổn áp tuyến tính cố định / điều chỉnh được và cầu chì.', 'Power parts: fixed and adjustable linear regulators and fuses.'),
    use: L('Tạo điện áp ổn định (5 V, 12 V …) từ nguồn chưa ổn định, bảo vệ quá dòng.', 'Make a steady voltage (5 V, 12 V …) from an unregulated supply, protect against over-current.'),
  },
  misc: {
    what: L('Linh kiện khác: thạch anh và opto cách ly quang.', 'Other parts: crystals and optocouplers.'),
    use: L('Tạo tần số chính xác, truyền tín hiệu qua cách ly điện.', 'Precise frequencies, signals across an isolation barrier.'),
  },
  rf: {
    what: L('Phần tử cao tần: đường truyền và cáp đồng trục lý tưởng.', 'RF elements: ideal transmission lines and coaxial cable.'),
    use: L('Quan sát trễ truyền, phản xạ và phối hợp trở kháng.', 'Study propagation delay, reflections and impedance matching.'),
  },
  electromechanical: {
    what: L('Linh kiện cơ điện: động cơ DC và rơ-le.', 'Electromechanical parts: DC motors and relays.'),
    use: L('Điều khiển tải cơ khí, cách ly mạch điều khiển với mạch công suất.', 'Drive mechanical loads, isolate control from power circuits.'),
  },
  connectors: {
    what: L('Đầu nối (hàng chân, cầu đấu dây): chỉ để vẽ và lập danh sách vật tư, không ảnh hưởng mô phỏng.', 'Connectors (headers, terminal blocks): drawing and BOM only, no effect on simulation.'),
    use: L('Ghi rõ chỗ cắm dây ra ngoài bo mạch.', 'Mark where wires leave the board.'),
  },
  instruments: {
    what: L('Thiết bị đo ảo: đồng hồ vạn năng, dao động ký, máy phát hàm, máy vẽ Bode và nhiều máy khác.', 'Virtual instruments: multimeter, oscilloscope, function generator, Bode plotter and more.'),
    use: L('Đặt lên sơ đồ, nối dây như máy thật, chạy mô phỏng rồi nhấp đúp để mở mặt máy.', 'Place them, wire them like real instruments, run, then double-click to open the panel.'),
  },
};

// ---------------------------------------------------------------------------------------------
// families (keyed by the library family name)

export const FAMILY_HELP: Record<string, HelpEntry> = {
  // families of the generated part catalogue (src/library/catalog)
  ...CATALOG_FAMILY_HELP,
  Power: {
    what: L('Điểm đất (0 V) và các đường nguồn toàn cục VCC, VDD, VEE, VSS.', 'Ground (0 V) and the global supply rails VCC, VDD, VEE, VSS.'),
    use: L('Mọi điểm đất và mọi ký hiệu cùng tên được nối với nhau mà không cần vẽ dây.', 'All grounds, and all rail symbols with the same name, are connected without drawing wires.'),
    tip: L('Thiếu đất là lỗi thường gặp nhất: mạch nào cũng cần ít nhất một ký hiệu Đất.', 'A missing ground is the most common error: every circuit needs at least one Ground.'),
  },
  'Voltage sources': {
    what: L('Nguồn tạo ra một điện áp xác định giữa hai cực, dù dòng điện qua nó là bao nhiêu.', 'A source that keeps a given voltage across its terminals whatever the current.'),
    use: L('DC để cấp nguồn; AC (sin) để thử khuếch đại hay lọc; xung để thử mạch số và mạch RC.', 'DC as a supply; AC (sine) to test amplifiers and filters; pulse to test logic and RC circuits.'),
    read: L('Cực + là cực có điện áp cao hơn. “Biên độ AC” chỉ dùng cho phân tích AC.', 'The + terminal is the higher one. “AC analysis magnitude” is used only by the AC analysis.'),
  },
  'Current sources': {
    what: L('Nguồn đẩy một dòng điện xác định qua mạch, điện áp tự điều chỉnh theo tải.', 'A source that pushes a given current; its voltage adapts to the load.'),
    use: L('Phân cực transistor, thử đặc tuyến, mô hình cảm biến dòng.', 'Biasing transistors, characteristic tests, current-output sensors.'),
    tip: L('Nguồn dòng phải có đường cho dòng chạy về; để hở mạch sẽ gây lỗi.', 'A current source needs a path for its current; leaving it open causes an error.'),
  },
  'Controlled sources': {
    what: L('Nguồn phụ thuộc: điện áp hoặc dòng ra tỉ lệ với một điện áp hay dòng ở chỗ khác trong mạch, hoặc theo một biểu thức.', 'Dependent sources: the output follows a voltage or current elsewhere, or an expression.'),
    use: L('Mô hình hoá khuếch đại lý tưởng, mạch tương đương tín hiệu nhỏ, hàm toán học.', 'Ideal amplifier models, small-signal equivalents, math functions.'),
  },
  'Digital sources': {
    what: L('Nguồn mức logic: xung nhịp, mức 1, mức 0 và công tắc logic bật bằng phím.', 'Logic sources: clock, logic 1, logic 0 and a key-operated logic switch.'),
    use: L('Cấp tín hiệu vào cho cổng logic, flip-flop và bộ đếm.', 'Drive gates, flip-flops and counters.'),
  },
  Resistor: {
    what: L('Điện trở cản dòng điện theo định luật Ôm: U = I·R. Đơn vị là ôm (Ω).', 'A resistor opposes current following Ohm’s law: V = I·R, in ohms (Ω).'),
    use: L('Hạn dòng cho LED, chia áp, phân cực transistor, tạo hằng số thời gian với tụ.', 'Limit LED current, divide voltages, bias transistors, set RC time constants.'),
    tip: L('Công suất tiêu tán P = U·I; điện trở 1/4 W không chịu được hơn 0.25 W.', 'Power P = V·I; a 1/4 W resistor must stay below 0.25 W.'),
  },
  'Variable resistor': {
    what: L('Điện trở thay đổi được: chiết áp (3 chân) hoặc biến trở (2 chân).', 'Adjustable resistance: potentiometer (3 pins) or rheostat (2 pins).'),
    use: L('Chỉnh âm lượng, chỉnh ngưỡng, chia áp điều chỉnh được.', 'Volume and threshold controls, adjustable dividers.'),
    tip: L('Khi mô phỏng, nhấn phím ghi trên linh kiện (mặc định A) để tăng, Shift+phím để giảm.', 'While simulating, press the key shown on the part (A by default) to increase, Shift+key to decrease.'),
  },
  Thermistor: {
    what: L('Điện trở thay đổi theo nhiệt độ: NTC giảm khi nóng, PTC tăng khi nóng.', 'Temperature-dependent resistor: NTC falls when hot, PTC rises.'),
    use: L('Cảm biến nhiệt, bảo vệ quá nhiệt, hạn dòng khởi động.', 'Temperature sensing, over-temperature protection, inrush limiting.'),
  },
  Photoresistor: {
    what: L('Quang điện trở (LDR): điện trở giảm mạnh khi được chiếu sáng.', 'Light-dependent resistor: resistance drops in light.'),
    use: L('Đèn tự bật khi trời tối, đo ánh sáng.', 'Automatic night lights, light meters.'),
  },
  Capacitor: {
    what: L('Tụ điện tích điện tích: Q = C·U. Chặn dòng DC, cho tín hiệu AC đi qua. Đơn vị fara (F).', 'A capacitor stores charge (Q = C·V), blocks DC and passes AC, in farads (F).'),
    use: L('Lọc nguồn, ghép tầng, lọc RC, định thời với điện trở (τ = R·C).', 'Supply filtering, coupling, RC filters, timing with a resistor (τ = R·C).'),
    tip: L('Tụ hoá có cực tính: cực + phải ở điện áp cao hơn.', 'Electrolytic capacitors are polarised: + must be the higher voltage.'),
  },
  Inductor: {
    what: L('Cuộn cảm chống lại sự thay đổi dòng điện: U = L·dI/dt. Đơn vị henry (H).', 'An inductor opposes changes of current: V = L·dI/dt, in henries (H).'),
    use: L('Lọc LC, mạch cộng hưởng, bộ nguồn xung, cuộn chặn nhiễu.', 'LC filters, resonant circuits, switching supplies, chokes.'),
  },
  Transformer: {
    what: L('Biến áp truyền năng lượng giữa hai cuộn dây ghép từ; tỉ số điện áp bằng tỉ số vòng.', 'Two magnetically coupled windings; the voltage ratio equals the turns ratio.'),
    use: L('Hạ áp lưới 220 V xuống điện áp thấp, cách ly, phối hợp trở kháng.', 'Step mains down, isolate, match impedances.'),
    tip: L('Chỉ hoạt động với điện xoay chiều; nối một chân thứ cấp xuống đất để có mức tham chiếu.', 'Works only with AC; ground one secondary pin to give it a reference.'),
  },
  Switch: {
    what: L('Công tắc và khoá: đóng thì dẫn (điện trở nhỏ), mở thì ngắt (điện trở rất lớn).', 'Switches: closed conducts (low resistance), open blocks (very high resistance).'),
    use: L('Bật/tắt mạch, chọn đường tín hiệu; khoá điều khiển bằng áp/dòng/thời gian để tự động hoá.', 'Turn circuits on and off, select paths; voltage/current/time-controlled switches automate it.'),
    tip: L('Khi mô phỏng, nhấn phím ghi bên cạnh công tắc (mặc định Space) hoặc nhấp vào công tắc.', 'While simulating, press the key shown next to the switch (Space by default) or click it.'),
  },
  'Generic diode': {
    what: L('Diode tiếp giáp có tham số SPICE chỉnh được.', 'A junction diode with editable SPICE parameters.'),
    use: L('Học đặc tuyến diode, chỉnh tham số theo datasheet.', 'Study the diode curve, fit datasheet values.'),
    read: L('Diode silic dẫn khi điện áp thuận khoảng 0.6–0.7 V.', 'A silicon diode conducts at about 0.6–0.7 V forward.'),
  },
  'Switching diode': {
    what: L('Diode tín hiệu nhỏ chuyển mạch nhanh (như 1N4148).', 'Fast small-signal diodes (such as the 1N4148).'),
    use: L('Mạch logic diode, xén tín hiệu, bảo vệ đầu vào.', 'Diode logic, clipping, input protection.'),
  },
  'Rectifier diode': {
    what: L('Diode chỉnh lưu chịu dòng lớn (1N400x: 1 A).', 'Power rectifier diodes (1N400x: 1 A).'),
    use: L('Biến điện xoay chiều thành một chiều trong bộ nguồn.', 'Turn AC into DC in power supplies.'),
    tip: L('Chọn VRRM lớn hơn điện áp ngược lớn nhất trong mạch.', 'Choose VRRM above the largest reverse voltage.'),
  },
  'Schottky diode': {
    what: L('Diode Schottky: sụt áp thuận thấp (≈0.3 V) và chuyển mạch rất nhanh.', 'Schottky diodes: low forward drop (≈0.3 V), very fast switching.'),
    use: L('Nguồn xung, bảo vệ ngược cực ít tổn hao.', 'Switching supplies, low-loss reverse protection.'),
  },
  'Zener diode': {
    what: L('Diode Zener dẫn ngược ở một điện áp xác định VZ.', 'A Zener diode conducts in reverse at a defined voltage VZ.'),
    use: L('Ổn áp đơn giản, tạo điện áp chuẩn, bảo vệ quá áp.', 'Simple regulators, references, over-voltage protection.'),
    tip: L('Luôn mắc nối tiếp một điện trở để hạn dòng qua Zener.', 'Always use a series resistor to limit the Zener current.'),
  },
  LED: {
    what: L('Diode phát quang: sáng khi có dòng thuận chạy qua (thường 5–20 mA).', 'Light-emitting diode: glows with forward current (typically 5–20 mA).'),
    use: L('Đèn báo, hiển thị.', 'Indicators and displays.'),
    tip: L('Điện trở hạn dòng R = (Unguồn − ULED) / I. Trên sơ đồ, LED sáng lên khi mô phỏng.', 'Series resistor R = (Vsupply − VLED) / I. The LED lights up on the schematic while simulating.'),
  },
  'Bridge rectifier': {
    what: L('Bốn diode xếp thành cầu, chỉnh lưu cả hai nửa chu kỳ.', 'Four diodes in a bridge that rectify both half-cycles.'),
    use: L('Bộ nguồn từ biến áp; thêm tụ lọc để giảm gợn sóng.', 'Transformer power supplies; add a filter capacitor to reduce ripple.'),
  },
  Varactor: {
    what: L('Diode biến dung: điện dung thay đổi theo điện áp ngược.', 'A diode whose capacitance changes with reverse voltage.'),
    use: L('Điều chỉnh tần số mạch cộng hưởng bằng điện áp.', 'Voltage tuning of resonant circuits.'),
  },
  Photodiode: {
    what: L('Quang diode: tạo dòng tỉ lệ với ánh sáng chiếu vào.', 'Produces a current proportional to the light falling on it.'),
    use: L('Cảm biến ánh sáng, thu hồng ngoại.', 'Light sensors, infrared receivers.'),
  },
  Thyristor: {
    what: L('Thyristor (SCR): khi được kích ở cực cổng sẽ dẫn và tự giữ cho đến khi dòng giảm gần 0.', 'An SCR turns on with a gate pulse and stays on until its current falls near zero.'),
    use: L('Điều khiển công suất, mạch chốt.', 'Power control, latching circuits.'),
  },
  'NPN BJT': {
    what: L('Transistor lưỡng cực NPN: dòng cực gốc nhỏ điều khiển dòng cực góp lớn (IC ≈ β·IB).', 'NPN bipolar transistor: a small base current controls a large collector current (IC ≈ β·IB).'),
    use: L('Khuếch đại E chung, khoá đóng ngắt tải nối lên nguồn dương.', 'Common-emitter amplifiers, low-side switches.'),
    read: L('Khi dẫn, UBE ≈ 0.65 V; khi bão hoà, UCE chỉ còn khoảng 0.1–0.2 V.', 'When on, VBE ≈ 0.65 V; saturated, VCE drops to about 0.1–0.2 V.'),
  },
  'PNP BJT': {
    what: L('Transistor lưỡng cực PNP: hoạt động như NPN nhưng mọi chiều điện áp và dòng đều ngược lại.', 'PNP bipolar transistor: like an NPN with every polarity reversed.'),
    use: L('Khoá phía nguồn dương, tầng đẩy kéo cùng với NPN.', 'High-side switches, push-pull stages with an NPN.'),
  },
  'NPN Darlington': {
    what: L('Hai transistor NPN ghép Darlington: hệ số khuếch đại rất lớn (≥ 1000).', 'Two NPN transistors in Darlington: very high gain (≥ 1000).'),
    use: L('Điều khiển tải lớn (động cơ, rơ-le) từ tín hiệu yếu.', 'Drive heavy loads (motors, relays) from weak signals.'),
  },
  'PNP Darlington': {
    what: L('Darlington PNP: khuếch đại rất lớn, cực tính ngược với NPN.', 'PNP Darlington: very high gain, reversed polarity.'),
    use: L('Khoá công suất phía nguồn dương.', 'High-side power switching.'),
  },
  'N-channel JFET': {
    what: L('JFET kênh N: điện áp cổng âm làm hẹp kênh dẫn và giảm dòng máng.', 'N-channel JFET: a negative gate voltage narrows the channel and reduces drain current.'),
    use: L('Tầng vào trở kháng cao, nguồn dòng, khuếch đại nhiễu thấp.', 'High-impedance inputs, current sources, low-noise amplifiers.'),
  },
  'P-channel JFET': {
    what: L('JFET kênh P: cực tính ngược với JFET kênh N.', 'P-channel JFET: reversed polarity of the N-channel type.'),
    use: L('Khoá tương tự, nguồn dòng.', 'Analog switches, current sources.'),
  },
  'N-channel MOSFET': {
    what: L('MOSFET kênh N: điện áp cổng dương lớn hơn ngưỡng VTO thì dẫn; cổng gần như không lấy dòng.', 'N-channel MOSFET: conducts when the gate rises above the threshold VTO; the gate draws almost no current.'),
    use: L('Khoá công suất, cổng logic CMOS, khuếch đại.', 'Power switches, CMOS logic, amplifiers.'),
    tip: L('Cổng MOSFET không có đường DC xuống đất sẽ bị ERC cảnh báo: hãy thêm điện trở kéo xuống.', 'A MOSFET gate without a DC path to ground triggers an ERC warning: add a pull-down resistor.'),
  },
  'P-channel MOSFET': {
    what: L('MOSFET kênh P: dẫn khi cổng thấp hơn cực nguồn quá ngưỡng.', 'P-channel MOSFET: conducts when the gate is below the source by more than the threshold.'),
    use: L('Khoá phía nguồn dương, nửa trên của cổng CMOS.', 'High-side switches, the upper half of CMOS gates.'),
  },
  'Op-amp': {
    what: L('Khuếch đại thuật toán: khuếch đại hiệu điện áp giữa IN+ và IN− với hệ số rất lớn.', 'Operational amplifier: amplifies the difference between IN+ and IN− with a very large gain.'),
    use: L('Có hồi tiếp âm: khuếch đại đảo/không đảo, cộng, tích phân, lọc tích cực.', 'With negative feedback: inverting/non-inverting amplifiers, summers, integrators, active filters.'),
    tip: L('Với hồi tiếp âm, hai đầu vào có điện áp gần bằng nhau. Ngõ ra không vượt quá điện áp nguồn.', 'With negative feedback both inputs sit at almost the same voltage. The output cannot exceed the supplies.'),
  },
  Comparator: {
    what: L('Bộ so sánh: ngõ ra lên mức cao khi IN+ lớn hơn IN−, ngược lại xuống mức thấp.', 'Output goes high when IN+ is above IN−, low otherwise.'),
    use: L('Phát hiện ngưỡng, chuyển tín hiệu tương tự thành logic.', 'Threshold detection, analog-to-logic conversion.'),
    tip: L('Loại cực góp hở cần điện trở kéo lên.', 'Open-collector types need a pull-up resistor.'),
  },
  'Instrumentation amplifier': {
    what: L('Khuếch đại vi sai chính xác với trở kháng vào cao.', 'Precision differential amplifier with high input impedance.'),
    use: L('Đọc cảm biến cầu, tín hiệu nhỏ có nhiễu chung.', 'Bridge sensors, small signals with common-mode noise.'),
  },
  Timer: {
    what: L('IC định thời 555: tạo xung vuông (đa hài) hoặc một xung có độ rộng xác định (đơn ổn).', 'The 555 timer: square waves (astable) or one timed pulse (monostable).'),
    use: L('Nháy LED, tạo âm thanh, trễ thời gian.', 'LED flashers, tone generators, time delays.'),
    read: L('Ở chế độ đa hài f ≈ 1.44 / ((RA + 2·RB)·C).', 'Astable: f ≈ 1.44 / ((RA + 2·RB)·C).'),
  },
  'Voltage reference': {
    what: L('Nguồn áp chuẩn chính xác (như TL431).', 'Precision voltage reference (such as the TL431).'),
    use: L('Tạo mức so sánh chính xác, ổn áp song song.', 'Accurate comparison levels, shunt regulators.'),
  },
  'Control functions': {
    what: L(
      'Khối toán học lý tưởng: nhân, chia, cộng 2 / 3 ngõ vào, khuếch đại, tích phân (có reset và giới hạn), vi phân, hạn biên, trễ (Schmitt), hạn tốc độ biến thiên, hàm truyền H(s), lấy mẫu và giữ, điều chế PWM, VCO sin / vuông / tam giác / răng cưa, PI / PID.',
      'Ideal math blocks: multiply, divide, 2- / 3-input sum, gain, integrate (with reset and limits), differentiate, limit, hysteresis (Schmitt), slew-rate limit, transfer function H(s), sample-and-hold, PWM modulation, sine / square / triangle / sawtooth VCO, PI / PID.',
    ),
    use: L('Mô hình hệ thống điều khiển và xử lý tín hiệu ở mức khối: vẽ sơ đồ khối như trong sách rồi mô phỏng ngay.', 'Block-level models of control and signal-processing systems: draw the block diagram from the textbook and simulate it at once.'),
    read: L('Mọi khối lấy điện áp so với đất ở ngõ vào và cho điện áp so với đất ở ngõ ra; ngõ vào gần như không lấy dòng, ngõ ra là nguồn áp lý tưởng.', 'Every block reads voltages against ground and outputs a voltage against ground; inputs draw almost no current, outputs are ideal voltage sources.'),
    tip: L('Nhấn F1 trên từng khối để xem cách đặt tham số và một ví dụ.', 'Press F1 on a block to see how to set it up, with an example.'),
  },
  Meter: {
    what: L('Vôn kế và ampe kế dạng bảng: số đo hiện ngay trên sơ đồ khi mô phỏng.', 'Panel voltmeter and ammeter: the reading appears on the schematic while simulating.'),
    use: L('Theo dõi nhanh điện áp/dòng điện mà không cần mở thiết bị đo.', 'Watch a voltage or current without opening an instrument.'),
    tip: L('Vôn kế mắc song song, ampe kế mắc nối tiếp.', 'Voltmeters go in parallel, ammeters in series.'),
  },
  Lamp: {
    what: L('Bóng đèn sợi đốt: sáng theo công suất tiêu thụ.', 'Incandescent lamp: glows with the power it dissipates.'),
    use: L('Tải minh hoạ, đèn báo.', 'Demo loads and indicators.'),
  },
  'Probe light': {
    what: L('Đèn báo một chân: sáng khi điện áp tại chân vượt ngưỡng.', 'Single-pin indicator: lights when the pin voltage exceeds a threshold.'),
    use: L('Xem nhanh mức logic tại một điểm.', 'See a logic level at a glance.'),
  },
  Buzzer: {
    what: L('Còi chip: kêu khi điện áp đủ lớn.', 'Buzzer: sounds when the voltage is high enough.'),
    use: L('Báo động, báo hiệu bằng âm thanh.', 'Alarms and audible signals.'),
  },
  'Fixed regulator': {
    what: L('Ổn áp tuyến tính cố định (78xx dương, 79xx âm).', 'Fixed linear regulators (78xx positive, 79xx negative).'),
    use: L('Tạo nguồn 5 V, 12 V … ổn định cho mạch.', 'Steady 5 V, 12 V … supplies.'),
    tip: L('Điện áp vào phải lớn hơn điện áp ra ít nhất khoảng 2 V.', 'The input must be at least about 2 V above the output.'),
  },
  'Adjustable regulator': {
    what: L('Ổn áp điều chỉnh được (LM317/LM337) và ổn áp sụt áp thấp.', 'Adjustable (LM317/LM337) and low-dropout regulators.'),
    use: L('Nguồn điện áp tuỳ chọn bằng hai điện trở.', 'Any output voltage set with two resistors.'),
  },
  Fuse: {
    what: L('Cầu chì: đứt khi dòng vượt định mức và giữ hở mạch.', 'Opens when the current exceeds its rating and stays open.'),
    use: L('Bảo vệ mạch khỏi ngắn mạch và quá dòng.', 'Protect against shorts and over-current.'),
  },
  Crystal: {
    what: L('Thạch anh: cộng hưởng ở tần số rất chính xác.', 'Quartz crystal: resonates at a very precise frequency.'),
    use: L('Mạch dao động cho đồng hồ và vi điều khiển.', 'Oscillators for clocks and microcontrollers.'),
  },
  Optocoupler: {
    what: L('Opto: LED và phototransistor trong một vỏ, truyền tín hiệu bằng ánh sáng.', 'An LED and a phototransistor in one package, coupled by light.'),
    use: L('Cách ly mạch điều khiển với mạch công suất.', 'Isolate control circuits from power circuits.'),
  },
  'Transmission line': {
    what: L('Đường truyền lý tưởng với trở kháng đặc tính Z0 và độ trễ TD.', 'Ideal line with characteristic impedance Z0 and delay TD.'),
    use: L('Quan sát phản xạ khi tải không phối hợp với Z0.', 'Observe reflections when the load does not match Z0.'),
  },
  Motor: {
    what: L('Động cơ DC: quay khi có điện áp, tốc độ tăng theo điện áp.', 'DC motor: spins with voltage, faster with more voltage.'),
    use: L('Mô phỏng tải cơ khí, mạch điều khiển tốc độ.', 'Mechanical loads, speed controllers.'),
  },
  Relay: {
    what: L('Rơ-le: cuộn hút có dòng thì đóng tiếp điểm.', 'A coil current closes the contacts.'),
    use: L('Đóng ngắt tải lớn hoặc điện lưới bằng tín hiệu nhỏ.', 'Switch heavy or mains loads from a small signal.'),
    tip: L('Mắc diode song song ngược với cuộn hút để chống xung điện áp khi ngắt.', 'Put a reverse diode across the coil against turn-off spikes.'),
  },
  Header: {
    what: L('Hàng chân cắm 2.54 mm.', '2.54 mm pin header.'),
    use: L('Đánh dấu đầu nối trên sơ đồ và danh sách vật tư.', 'Mark connectors on the schematic and BOM.'),
  },
  'Terminal block': {
    what: L('Cầu đấu dây bắt vít.', 'Screw terminal block.'),
    use: L('Đánh dấu chỗ nối dây nguồn hoặc tải.', 'Mark supply or load wiring points.'),
  },
  Instrument: {
    what: L('Thiết bị đo ảo: mỗi máy có mặt máy riêng mở bằng nhấp đúp.', 'Virtual instruments: each has its own panel, opened by double-click.'),
    use: L('Đo và quan sát mạch như ở phòng thí nghiệm.', 'Measure and observe the circuit like in a lab.'),
  },
  '74xx': {
    what: L('IC logic 74xx với số chân giống datasheet.', '74xx logic ICs with datasheet pin numbers.'),
    use: L('Lắp mạch số thật: cổng, flip-flop, bộ đếm, giải mã LED 7 đoạn.', 'Build real logic: gates, flip-flops, counters, 7-segment decoders.'),
    tip: L('Thêm ký hiệu VCC (5 V) vào sơ đồ: chân nguồn ẩn của IC tự nối vào đó.', 'Add a VCC (5 V) symbol: the IC’s hidden supply pins connect to it.'),
  },
  '4000': {
    what: L('IC CMOS họ 4000.', '4000-series CMOS ICs.'),
    use: L('Mạch số nguồn 3–18 V, tiêu thụ ít điện.', 'Low-power logic from 3 to 18 V.'),
    tip: L('Thêm ký hiệu VDD vào sơ đồ để cấp nguồn cho chân ẩn.', 'Add a VDD symbol to power the hidden pins.'),
  },
  'Virtual gates': {
    what: L('Cổng logic lý tưởng AND, OR, NAND, NOR, XOR, NOT …', 'Ideal AND, OR, NAND, NOR, XOR, NOT … gates.'),
    use: L('Học bảng chân lý và thiết kế mạch tổ hợp.', 'Learn truth tables and design combinational logic.'),
  },
  'Virtual flip-flops': {
    what: L('Flip-flop D, JK, T lý tưởng: nhớ 1 bit và đổi trạng thái theo sườn xung nhịp.', 'Ideal D, JK and T flip-flops: store one bit and change on a clock edge.'),
    use: L('Bộ đếm, thanh ghi, máy trạng thái.', 'Counters, registers, state machines.'),
  },
  'Virtual latches': {
    what: L('Chốt SR và chốt D lý tưởng.', 'Ideal SR and D latches.'),
    use: L('Lưu trạng thái, chống dội phím.', 'Hold a state, debounce buttons.'),
  },
  'Virtual sources': {
    what: L('Nguồn mẫu bit và điện trở kéo lên / kéo xuống lý tưởng.', 'Pattern source and ideal pull-up / pull-down.'),
    use: L('Tạo chuỗi bit thử, đặt mức mặc định cho đầu vào.', 'Test bit sequences, default input levels.'),
  },
  Converters: {
    what: L('ADC và DAC 8 bit lý tưởng.', 'Ideal 8-bit ADC and DAC.'),
    use: L('Học cách số hoá tín hiệu và tạo lại tín hiệu tương tự.', 'Learn how signals are digitised and rebuilt.'),
  },
  Comparators: {
    what: L('Bộ so sánh có ngõ ra logic.', 'Comparators with a logic output.'),
    use: L('Nối tín hiệu tương tự vào mạch số.', 'Feed analog signals into logic.'),
  },
  'Seven-segment': {
    what: L('LED 7 đoạn (anode chung, cathode chung, có giải mã hex).', '7-segment LED displays (common anode, common cathode, hex-decoded).'),
    use: L('Hiển thị chữ số từ bộ đếm hay bộ giải mã.', 'Show digits from counters or decoders.'),
  },
  'Bar graph': {
    what: L('Mười LED độc lập trong một vỏ.', 'Ten independent LEDs in one package.'),
    use: L('Hiển thị mức (âm lượng, pin …).', 'Level displays (volume, battery …).'),
  },
  Probe: {
    what: L('Đầu dò logic: báo H, L hoặc không xác định.', 'Logic probe: shows H, L or undefined.'),
    use: L('Kiểm tra mức logic khi mô phỏng.', 'Check logic levels while simulating.'),
  },
  General: {
    what: L('Linh kiện chưa xếp họ.', 'Parts without a family.'),
    use: L('Xem mô tả của từng linh kiện.', 'See each part’s description.'),
  },
};

// ---------------------------------------------------------------------------------------------
// instruments

export const INSTRUMENT_HELP: Record<InstrumentKind, HelpEntry> = {
  multimeter: {
    what: L('Đồng hồ vạn năng đo điện áp (V), dòng điện (A), điện trở (Ω) và dB, ở chế độ DC hoặc AC.', 'Measures voltage (V), current (A), resistance (Ω) and dB, in DC or AC mode.'),
    use: L('Đo áp: mắc song song với phần tử. Đo dòng: chọn A rồi mắc nối tiếp. Đo ôm: tách linh kiện khỏi nguồn.', 'Voltage: connect across the part. Current: choose A and connect in series. Ohms: disconnect the part from sources.'),
    read: L('Số hiện theo hậu tố kỹ thuật (mV, mA, kΩ). AC hiển thị giá trị hiệu dụng (RMS). Giá trị rất gần 0 được làm tròn thành 0.', 'Readings use engineering suffixes (mV, mA, kΩ). AC shows the RMS value. Values within the display resolution of zero read 0.'),
  },
  'function-generator': {
    what: L('Máy phát tín hiệu sin, tam giác hoặc vuông với tần số, biên độ và độ lệch DC chỉnh được.', 'Generates sine, triangle or square waves with adjustable frequency, amplitude and offset.'),
    use: L('Cấp tín hiệu vào cho khuếch đại, bộ lọc, mạch số. Nối COM xuống đất và lấy tín hiệu ở cực +.', 'Drive amplifiers, filters and logic. Ground COM and take the signal from +.'),
    read: L('Biên độ là giá trị đỉnh so với COM; tín hiệu giữa + và − có biên độ gấp đôi.', 'Amplitude is the peak value against COM; between + and − it is twice as large.'),
  },
  oscilloscope: {
    what: L('Dao động ký hai kênh: vẽ điện áp theo thời gian.', 'Two-channel oscilloscope: plots voltage against time.'),
    use: L('Nối A+ (và B+) vào điểm cần xem, cực − để hở hoặc nối đất. Chạy mô phỏng rồi mở mặt máy.', 'Connect A+ (and B+) to the points to watch; leave − open or grounded. Run, then open the panel.'),
    read: L('Mỗi ô ngang = giá trị Timebase (s/ô); mỗi ô dọc = Scale của kênh (V/ô). Kéo con trỏ T1, T2 để đọc thời gian và điện áp chính xác.', 'One horizontal division = Timebase (s/div); one vertical division = the channel scale (V/div). Drag cursors T1, T2 to read exact times and voltages.'),
  },
  'oscilloscope-4ch': {
    what: L('Dao động ký bốn kênh A, B, C, D.', 'Four-channel oscilloscope A, B, C, D.'),
    use: L('So sánh nhiều tín hiệu cùng lúc, ví dụ các ngõ ra của bộ đếm.', 'Compare several signals at once, e.g. counter outputs.'),
    read: L('Đọc giống dao động ký hai kênh; mỗi kênh có màu và thang riêng.', 'Read like the two-channel scope; every channel has its own colour and scale.'),
  },
  'bode-plotter': {
    what: L('Máy vẽ Bode: vẽ biên độ (dB) và pha của tỉ số ra/vào theo tần số.', 'Plots the magnitude (dB) and phase of output/input against frequency.'),
    use: L('Nối IN vào ngõ vào bộ lọc/khuếch đại và OUT vào ngõ ra. Mạch cần có một nguồn AC.', 'Connect IN to the filter or amplifier input and OUT to its output. The circuit needs an AC source.'),
    read: L('0 dB nghĩa là ra bằng vào; −3 dB đánh dấu tần số cắt; −20 dB = ra chỉ còn 1/10.', '0 dB means output equals input; −3 dB marks the cut-off frequency; −20 dB = one tenth.'),
  },
  wattmeter: {
    what: L('Oát kế đo công suất trung bình và hệ số công suất.', 'Measures average power and power factor.'),
    use: L('Cực V+ / V− mắc song song với tải, cực I+ / I− mắc nối tiếp với tải.', 'V+ / V− across the load, I+ / I− in series with it.'),
    read: L('P (W) là công suất thực; hệ số công suất = 1 với tải thuần trở.', 'P (W) is real power; the power factor is 1 for a resistive load.'),
  },
  'frequency-counter': {
    what: L('Máy đếm tần đo tần số, chu kỳ, độ rộng xung và thời gian lên/xuống.', 'Measures frequency, period, pulse width and rise/fall times.'),
    use: L('Nối ngõ vào vào tín hiệu cần đo khi mô phỏng tương tác.', 'Connect the input to the signal while simulating.'),
    read: L('Tín hiệu nhỏ hơn độ nhạy sẽ không được đếm.', 'Signals below the sensitivity are not counted.'),
  },
  'iv-analyzer': {
    what: L('Máy vẽ đặc tuyến dòng - áp (I-V) của diode, BJT và MOSFET.', 'Traces current-voltage curves of diodes, BJTs and MOSFETs.'),
    use: L('Chỉ nối linh kiện cần đo vào máy (P, N và G với transistor), chọn loại linh kiện rồi mô phỏng.', 'Connect only the device under test (P, N and G for transistors), pick the device type, then simulate.'),
    read: L('Mỗi đường cong ứng với một dòng cực gốc / điện áp cổng; kéo con trỏ để đọc điểm.', 'Each curve is one base current or gate voltage; drag the cursor to read a point.'),
  },
  'spectrum-analyzer': {
    what: L('Máy phân tích phổ: cho biết tín hiệu gồm những tần số nào và mạnh bao nhiêu.', 'Shows which frequencies a signal contains and how strong they are.'),
    use: L('Xem hài của tín hiệu méo, phổ điều chế.', 'See harmonics of distorted signals, modulation spectra.'),
    read: L('Trục ngang là tần số, trục dọc là biên độ (V hoặc dB). Đỉnh cao nhất thường là tần số cơ bản.', 'Horizontal is frequency, vertical amplitude (V or dB). The highest peak is usually the fundamental.'),
  },
  'network-analyzer': {
    what: L('Máy phân tích mạng đo tham số S của mạng hai cửa theo tần số.', 'Measures the S-parameters of a two-port against frequency.'),
    use: L('Đặc trưng bộ lọc và khuếch đại cao tần; nối P1 vào ngõ vào, P2 vào ngõ ra.', 'Characterise RF filters and amplifiers; P1 to the input, P2 to the output.'),
    read: L('S21 là hệ số truyền (khuếch đại), S11 là phản xạ ở ngõ vào; đồ thị Smith cho thấy trở kháng.', 'S21 is the transmission (gain), S11 the input reflection; the Smith chart shows impedance.'),
  },
  'distortion-analyzer': {
    what: L('Máy đo méo hài toàn phần (THD) và SINAD.', 'Measures total harmonic distortion (THD) and SINAD.'),
    use: L('Đánh giá độ trung thực của khuếch đại âm thanh.', 'Judge the fidelity of audio amplifiers.'),
    read: L('THD càng nhỏ càng tốt; 1 % là méo thấy rõ trên dao động ký.', 'Lower THD is better; 1 % is visible on a scope.'),
  },
  'logic-analyzer': {
    what: L('Máy phân tích logic 16 kênh: vẽ giản đồ thời gian của các tín hiệu số.', '16-channel logic analyzer: timing diagrams of digital signals.'),
    use: L('Nối các ngõ 0…F vào các tín hiệu cần xem, ví dụ các ngõ ra bộ đếm.', 'Connect inputs 0…F to the signals, e.g. counter outputs.'),
    read: L('Mỗi hàng là một kênh: mức cao ở trên, mức thấp ở dưới. Con trỏ cho biết thời điểm và từ mã hex.', 'Each row is a channel: high on top, low below. The cursor shows the time and the hex word.'),
  },
  'word-generator': {
    what: L('Máy phát từ mã 16 bit: phát lần lượt các từ hex ra 16 ngõ b0…b15.', '16-bit word generator: plays hex words on outputs b0…b15.'),
    use: L('Cấp chuỗi tín hiệu thử cho mạch số, ví dụ đếm lên hoặc dịch bit.', 'Feed test sequences to logic, e.g. counting or shifting patterns.'),
    read: L('Chế độ Lặp vòng phát liên tục; Từng bước phát một từ mỗi lần nhấn.', 'Cycle plays continuously; Step outputs one word per press.'),
  },
  'logic-converter': {
    what: L('Bộ chuyển đổi logic giữa mạch, bảng chân lý và biểu thức Boole.', 'Converts between a circuit, a truth table and a Boolean expression.'),
    use: L('Nối A…H vào đầu vào mạch tổ hợp và OUT vào ngõ ra để đọc bảng chân lý; hoặc nhập biểu thức để rút gọn.', 'Connect A…H to the inputs and OUT to the output to read the truth table, or type an expression to simplify it.'),
    read: L('Trong biểu thức, A′ là NOT A, AB là A AND B, A + B là A OR B.', 'In expressions A′ is NOT A, AB is A AND B, A + B is A OR B.'),
  },
  'current-clamp': {
    what: L('Kìm đo dòng: đổi dòng chạy qua kìm thành điện áp tỉ lệ.', 'Turns the current through the jaws into a proportional voltage.'),
    use: L('Luồn dây (I+ → I−) qua kìm và nối ngõ ra vào dao động ký để xem dạng dòng điện.', 'Route the conductor (I+ → I−) through the clamp and connect the output to a scope to see the current waveform.'),
    read: L('Điện áp ra = tỉ số × dòng điện (ví dụ 1 V/A).', 'Output voltage = ratio × current (e.g. 1 V/A).'),
  },
  'bench-generator': {
    what: L('Máy phát sóng để bàn: sin, vuông, tam giác, răng cưa, xung, nhiễu, DC và dạng sóng tùy ý (sinc, hàm mũ, nhịp tim …), có điều chế AM / FM, burst và quét tần số; ngõ ra qua điện trở 50 Ω như máy thật, có ngõ SYNC.', 'Bench generator: sine, square, triangle, ramp, pulse, noise, DC and arbitrary shapes (sinc, exponential, heartbeat …), with AM / FM, burst and sweep; the output has a 50 Ω resistance like a real one, plus a SYNC output.'),
    use: L('Nối OUT vào mạch và COM xuống đất. Chọn dạng sóng bằng các phím, gõ tần số, biên độ đỉnh-đỉnh (Vpp) và độ lệch DC. Nút “Đầu ra” bật / tắt tín hiệu.', 'Connect OUT to the circuit and COM to ground. Pick the waveform with the keys and type the frequency, peak-to-peak amplitude (Vpp) and DC offset. The “Output” key switches the signal on and off.'),
    read: L('Biên độ hiển thị là điện áp trên tải đã chọn: “Tải cao” (High-Z) là khi mạch không lấy dòng; “50 Ω” nghĩa là máy tự nhân đôi điện áp trong để tải 50 Ω nhận đúng giá trị đặt. Đặt sai tải thì đo thấy gấp đôi hoặc một nửa — lỗi rất hay gặp ở phòng thí nghiệm.', 'The amplitude shown is the voltage on the chosen load: “High-Z” when the circuit draws no current; “50 Ω” makes the generator double its internal voltage so a 50 Ω load gets the set value. A wrong load setting reads twice or half the value — a very common lab mistake.'),
  },
  'bench-multimeter': {
    what: L('Đồng hồ vạn năng để bàn 6½ chữ số: áp DC / AC, dòng DC / AC (cực I riêng), điện trở, tần số, chu kỳ, thông mạch và đo diode; có phép toán Null, dB, dBm, kiểm tra giới hạn và thống kê.', '6½-digit bench multimeter: DC / AC volts, DC / AC current (separate I terminal), resistance, frequency, period, continuity and diode test; with Null, dB, dBm, limit test and statistics.'),
    use: L('Đo áp, điện trở, diode: nối HI và LO. Đo dòng: cho dòng đi vào cực I và ra ở LO (mắc nối tiếp). Tốc độ đo “Vừa” lấy trung bình 20 ms (đúng một chu kỳ điện lưới 50 Hz) nên khử được nhiễu nguồn.', 'Volts, ohms, diode: use HI and LO. Current: let it flow into I and out of LO (in series). The “Medium” rate averages over 20 ms (one 50 Hz mains cycle), so mains hum cancels.'),
    read: L('Số chữ số cố định theo thang đo (“+05.12345 V” trên thang 10 V); OVLD là quá thang. Thống kê cho số lần đo, trung bình, độ lệch chuẩn, nhỏ nhất và lớn nhất — dùng để thấy nhiễu và độ ổn định.', 'The digits are fixed by the range (“+05.12345 V” on the 10 V range); OVLD means over range. Statistics give the count, mean, standard deviation, minimum and maximum — use them to see noise and stability.'),
  },
  'bench-scope': {
    what: L('Dao động ký số 4 kênh: lưu dạng sóng, đo tự động (tần số, đỉnh-đỉnh, RMS, độ rộng xung, thời gian lên …), con trỏ, phép toán giữa các kênh và FFT.', '4-channel digital storage oscilloscope: stored waveforms, automatic measurements (frequency, peak-to-peak, RMS, pulse width, rise time …), cursors, channel math and FFT.'),
    use: L('Nối CH1…CH4 vào các điểm cần xem; cực GND là đất chung (để hở thì tự nối đất). Bấm “Tự động cài đặt” để máy tự chọn V/ô, s/ô và mức kích. “Chạy / Dừng” giữ hình, “Đơn” chụp một lần.', 'Connect CH1…CH4 to the points to watch; GND is the common ground (grounded when left open). Press “Auto setup” to pick V/div, s/div and the trigger level. “Run / Stop” freezes the picture, “Single” captures once.'),
    read: L('Các ô đo dưới màn hình tính trên đoạn đang hiển thị. FFT cho biết tín hiệu gồm những tần số nào (dBV hiệu dụng). Kéo con trỏ 1 và 2 để đo ΔT và ΔV.', 'The measurement boxes below the screen use the displayed record. The FFT shows which frequencies the signal contains (dBV RMS). Drag cursors 1 and 2 to measure ΔT and ΔV.'),
  },
  'mixed-signal-scope': {
    what: L('Dao động ký tín hiệu hỗn hợp: 2 kênh tương tự và 16 kênh logic D0…D15 trên cùng một trục thời gian, có hiển thị giá trị bus.', 'Mixed-signal oscilloscope: 2 analog channels and 16 logic channels D0…D15 on one time base, with a bus value display.'),
    use: L('Nối CH1, CH2 vào tín hiệu tương tự và D0… vào các đường số (ví dụ ngõ ra bộ đếm, xung nhịp). Có thể kích theo sườn của một kênh logic.', 'Connect CH1, CH2 to analog signals and D0… to logic lines (e.g. counter outputs, the clock). It can trigger on an edge of a logic channel.'),
    read: L('Kênh logic là 1 khi điện áp vượt ngưỡng (mặc định 1,4 V như TTL). Hàng bus cho giá trị hex của D0…Dn tại mỗi lần đổi.', 'A logic channel is 1 above the threshold (default 1.4 V, like TTL). The bus row shows the hex value of D0…Dn at every change.'),
  },
};

// ---------------------------------------------------------------------------------------------
// analyses

export const ANALYSIS_HELP: Record<AnalysisType, HelpEntry> = {
  op: {
    what: L('Tính điện áp mọi nút và dòng mọi nhánh khi mạch đã ổn định ở chế độ một chiều (tụ hở, cuộn cảm ngắn mạch).', 'Computes every node voltage and branch current at DC steady state (capacitors open, inductors shorted).'),
    use: L('Kiểm tra phân cực transistor, chia áp, dòng qua LED trước khi làm việc khác.', 'Check transistor bias, dividers and LED currents before anything else.'),
    read: L('Kết quả là một bảng giá trị trong Grapher; điện áp tính so với đất.', 'The result is a table in the Grapher; voltages are against ground.'),
  },
  tran: {
    what: L('Mô phỏng theo thời gian: xem tín hiệu thay đổi thế nào từ lúc bật nguồn.', 'Time-domain simulation: how signals evolve from power-on.'),
    use: L('Xem dạng sóng, quá trình nạp xả tụ, dao động 555, mạch số.', 'Waveforms, capacitor charging, 555 oscillators, logic.'),
    read: L('Trục ngang là thời gian. Chọn thời điểm kết thúc đủ dài (vài chu kỳ) và bước thời gian nhỏ hơn chu kỳ khoảng 50 lần.', 'Horizontal is time. Choose an end time of a few periods and a step about 50 times smaller than one period.'),
  },
  ac: {
    what: L('Quét tần số tín hiệu nhỏ quanh điểm làm việc.', 'Small-signal frequency sweep around the operating point.'),
    use: L('Đáp ứng tần số của bộ lọc, băng thông của khuếch đại. Mạch cần một nguồn có “biên độ AC”.', 'Filter responses, amplifier bandwidth. A source needs an “AC analysis magnitude”.'),
    read: L('Đồ thị biên độ (thường theo dB) và pha theo tần số log; tần số cắt ở −3 dB.', 'Magnitude (often in dB) and phase against log frequency; cut-off at −3 dB.'),
  },
  dc: {
    what: L('Quét giá trị một (hoặc hai) nguồn DC và tính điểm làm việc ở mỗi giá trị.', 'Sweeps one (or two) DC sources and solves the operating point at each value.'),
    use: L('Vẽ đặc tuyến truyền đạt, đặc tuyến transistor, ngưỡng chuyển mạch cổng logic.', 'Transfer curves, transistor characteristics, logic switching thresholds.'),
    read: L('Trục ngang là giá trị nguồn được quét.', 'Horizontal is the swept source value.'),
  },
  acsingle: {
    what: L('Phân tích AC tại đúng một tần số.', 'AC analysis at a single frequency.'),
    use: L('Lấy nhanh biên độ và pha của mọi điểm tại tần số làm việc.', 'Quick magnitude and phase of every node at the working frequency.'),
    read: L('Bảng biên độ / pha của mọi vector.', 'A magnitude / phase table of every vector.'),
  },
  noise: {
    what: L('Tính nhiễu do điện trở và bán dẫn tạo ra, theo tần số.', 'Computes resistor and semiconductor noise against frequency.'),
    use: L('Thiết kế khuếch đại nhiễu thấp.', 'Low-noise amplifier design.'),
    read: L('Mật độ phổ nhiễu V/√Hz ở ngõ ra và quy về ngõ vào.', 'Noise density in V/√Hz at the output and referred to the input.'),
  },
  noisefig: {
    what: L('Tính hệ số nhiễu (dB) của mạch tại một tần số.', 'Computes the noise figure (dB) at one frequency.'),
    use: L('So sánh khuếch đại cao tần.', 'Compare RF amplifiers.'),
    read: L('Hệ số nhiễu càng gần 0 dB càng tốt.', 'The closer to 0 dB the better.'),
  },
  four: {
    what: L('Phân tích Fourier: tách tín hiệu quá độ thành tần số cơ bản và các hài.', 'Splits a transient signal into its fundamental and harmonics.'),
    use: L('Đo méo hài của khuếch đại hay bộ nguồn.', 'Measure harmonic distortion of amplifiers and supplies.'),
    read: L('Bảng biên độ từng hài và THD (%).', 'A table of harmonic amplitudes and THD (%).'),
  },
  disto: {
    what: L('Tính méo hài hoặc méo xuyên điều chế của mạch phi tuyến yếu.', 'Harmonic or intermodulation distortion of weakly nonlinear circuits.'),
    use: L('Đánh giá khuếch đại tín hiệu nhỏ.', 'Evaluate small-signal amplifiers.'),
    read: L('Biên độ hài bậc 2 và 3 theo tần số.', 'Second and third harmonic magnitudes against frequency.'),
  },
  tf: {
    what: L('Tính hệ số khuếch đại DC tín hiệu nhỏ, điện trở vào và điện trở ra.', 'Small-signal DC gain, input and output resistance.'),
    use: L('Kiểm tra nhanh một tầng khuếch đại.', 'Quick check of an amplifier stage.'),
    read: L('Ba con số: khuếch đại, Rvào, Rra.', 'Three numbers: gain, Rin, Rout.'),
  },
  sens: {
    what: L('Cho biết ngõ ra thay đổi bao nhiêu khi mỗi giá trị linh kiện thay đổi.', 'How much the output changes when each component value changes.'),
    use: L('Tìm linh kiện quan trọng cần dung sai nhỏ.', 'Find the parts that need tight tolerances.'),
    read: L('Bảng độ nhạy; giá trị lớn nghĩa là linh kiện ảnh hưởng nhiều.', 'A sensitivity table; large values mean big influence.'),
  },
  pz: {
    what: L('Tìm cực và điểm không của hàm truyền.', 'Finds the poles and zeros of a transfer function.'),
    use: L('Phân tích ổn định và đáp ứng của bộ lọc / hệ điều khiển.', 'Stability and response of filters and control loops.'),
    read: L('Cực có phần thực dương nghĩa là mạch không ổn định.', 'A pole with a positive real part means the circuit is unstable.'),
  },
  paramsweep: {
    what: L('Chạy lại một phép phân tích với nhiều giá trị của một tham số linh kiện.', 'Repeats an analysis for several values of one component parameter.'),
    use: L('Xem ảnh hưởng của R hay C lên đáp ứng, chọn giá trị tốt nhất.', 'See how R or C changes the response, pick the best value.'),
    read: L('Mỗi giá trị cho một đường cong trong Grapher, chú giải ghi giá trị (ví dụ Rx=2000). Quét được cả tham số toàn cục (biến) của mạch.', 'One curve per value in the Grapher, the legend names the value (for example Rx=2000). A global parameter (variable) of the circuit can be swept too.'),
  },
  tempsweep: {
    what: L('Chạy lại một phép phân tích ở nhiều nhiệt độ.', 'Repeats an analysis at several temperatures.'),
    use: L('Kiểm tra mạch chạy ổn từ lạnh đến nóng.', 'Check the circuit from cold to hot.'),
    read: L('Mỗi nhiệt độ một đường cong.', 'One curve per temperature.'),
  },
  nestedsweep: {
    what: L('Quét hai tham số lồng nhau.', 'Sweeps two parameters, one inside the other.'),
    use: L('Khảo sát mọi tổ hợp của hai giá trị.', 'Explore every combination of two values.'),
    read: L('Một họ đường cong cho mỗi tổ hợp.', 'A family of curves, one per combination.'),
  },
  montecarlo: {
    what: L('Chạy nhiều lần với giá trị linh kiện ngẫu nhiên trong phạm vi dung sai.', 'Many runs with random component values within their tolerances.'),
    use: L('Dự đoán sản phẩm thực tế sẽ chênh lệch bao nhiêu.', 'Predict how real production units will vary.'),
    read: L('Các đường cong chồng lên nhau và thống kê (trung bình, độ lệch chuẩn, biểu đồ tần suất).', 'Overlaid curves plus statistics (mean, standard deviation, histogram).'),
  },
  worstcase: {
    what: L('Tìm tổ hợp dung sai cho kết quả tệ nhất.', 'Finds the tolerance combination with the worst result.'),
    use: L('Bảo đảm mạch vẫn đạt yêu cầu trong trường hợp xấu nhất.', 'Make sure the circuit still meets its specification in the worst case.'),
    read: L('Báo cáo giá trị danh định và giá trị xấu nhất.', 'A report of nominal and worst-case values.'),
  },
  tracewidth: {
    what: L('Tính bề rộng đường mạch PCB tối thiểu từ dòng hiệu dụng.', 'Minimum PCB trace widths from RMS currents.'),
    use: L('Chuẩn bị vẽ mạch in cho dòng lớn.', 'Plan PCB traces for high currents.'),
    read: L('Bảng bề rộng (mil / mm) cho từng dây.', 'A width table (mil / mm) per wire.'),
  },
  batch: {
    what: L('Chạy lần lượt nhiều phép phân tích.', 'Runs several analyses one after another.'),
    use: L('Lặp lại cùng một bộ kiểm tra sau mỗi lần sửa mạch.', 'Repeat the same checks after every change.'),
    read: L('Mỗi phép phân tích có một thẻ kết quả riêng trong Grapher.', 'Each analysis gets its own tab in the Grapher.'),
  },
  user: {
    what: L('Bạn tự gõ lệnh SPICE (.op, .tran, .ac, .dc, .step, .temp, .options, .ic, .save), mỗi dòng một lệnh; MachSim chạy chúng lần lượt trên mạch đang vẽ.', 'You type SPICE control cards (.op, .tran, .ac, .dc, .step, .temp, .options, .ic, .save), one per line; MachSim runs them in order on the drawn circuit.'),
    use: L('Khi đã quen cú pháp SPICE trong sách, hoặc muốn chạy nhiều phép phân tích với tuỳ chọn riêng mà không mở từng biểu mẫu. Ví dụ: .step temp list 0 27 100 rồi .tran 10u 1m.', 'When you know SPICE syntax from a textbook, or want several analyses with their own options without opening each form. Example: .step temp list 0 27 100 then .tran 10u 1m.'),
    read: L('Mỗi lệnh phân tích có một thẻ riêng trong Grapher, mang tên chính dòng lệnh đó. Lỗi cú pháp được báo kèm số dòng.', 'Each analysis card gets its own Grapher tab, named after the card. Syntax errors are reported with their line number.'),
  },
};
