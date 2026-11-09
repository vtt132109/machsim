/**
 * Help pages of the learning and interop tools (help browser, "Guides" section): guided lessons,
 * the description box and student questions, instructor mode, reports, PCB transfer, importing
 * SPICE as a schematic, the desktop command line, and the file features (sample circuits,
 * snippets, autosave / backups / File information, exchange formats and imports from other
 * programs, measurement files in the Grapher), and real-world parts (non-ideal R / L / C, loads,
 * packs, sockets, drawing symbols, multi-control switches, magnetic cores, OTA / CFA / PLL), and the
 * component database at scale (the Select-a-component dialog, Update components from library, design
 * variants, "my library" files).
 * Original text; loaded with the help dialog.
 */
import { L, type LocalizedText } from './core';
import { LADDER_GUIDE_PAGES } from './ladderHelp';
import { DOCS_GUIDE_PAGES } from './docsHelp';
import { ELECTRO_GUIDE_PAGES } from './electroHelp';
import { XCHG_GUIDE_SECTIONS } from './xchgHelp';
import { AUTOMATION_GUIDE_PAGES } from './automationHelp';

export type GuidePageId = 'whatsNew' | 'lessons' | 'description' | 'instructor' | 'reports' | 'pcb' | 'spiceImport' | 'commandLine' | 'samples' | 'snippets' | 'fileSafety' | 'exchange' | 'measurements' | 'spiceMeasure' | 'signalBlocks' | 'realParts' | 'placement' | 'updateComponents' | 'variants' | 'myLibrary' | 'mcu' | 'pld' | 'ladder' | 'mecha' | 'ercTools' | 'netSettings' | 'customizeUi' | 'footprints' | 'documents' | 'printing' | 'editingTools' | 'relays' | 'audio' | 'scripting' | 'compactModels';

export interface GuidePage {
  title: LocalizedText;
  sections: { heading: LocalizedText; body: LocalizedText }[];
  /** example commands (same in both languages) */
  code?: string[];
}

export const GUIDE_ORDER: GuidePageId[] = ['whatsNew', 'lessons', 'samples', 'placement', 'signalBlocks', 'realParts', 'updateComponents', 'variants', 'myLibrary', 'description', 'instructor', 'ercTools', 'netSettings', 'customizeUi', 'footprints', 'reports', 'snippets', 'fileSafety', 'documents', 'printing', 'editingTools', 'exchange', 'spiceImport', 'spiceMeasure', 'measurements', 'mcu', 'pld', 'ladder', 'mecha', 'relays', 'audio', 'scripting', 'compactModels', 'pcb', 'commandLine'];

export const GUIDE_PAGES: Record<GuidePageId, GuidePage> = {
  ...LADDER_GUIDE_PAGES,
  ...DOCS_GUIDE_PAGES,
  ...ELECTRO_GUIDE_PAGES,
  ...AUTOMATION_GUIDE_PAGES,
  whatsNew: {
    title: L('Có gì mới trong MachSim', "What's new in MachSim"),
    sections: [
      {
        heading: L('Vòng 4 – Học: chín bài học, chín mạch mẫu và thẻ tham khảo', 'Round 4 – Learning: nine lessons, nine samples and a reference card'),
        body: L(
          'Chín bài học mới dùng đúng những tính năng mới: in phiếu bài tập, đồng hồ trong khối, quét tham số bằng .step, op-amp kép vẽ thành hai phần, đếm chu kỳ máy của 8051 bằng gỡ lỗi, mạch tự giữ bằng công-tắc-tơ, nghe bộ lọc qua loa, thời gian chạy của pin và dựng mạch bằng tập lệnh. Chín mạch mẫu mới (số 90 – 98) kiểm chứng từng công thức ghi trên trang. Khi giao diện là tiếng Anh, ghi chú trên mọi mạch mẫu cũng được đổi sang tiếng Anh. Hộp In và xem trước có thêm mục “Thẻ tham khảo nhanh”: một tờ có sáu bước cho mạch đầu tiên, bảng phím tắt và các menu chính (ở chế độ người mới, thẻ chỉ liệt kê những gì đang hiện trên màn hình). Các hộp thoại mới có nút ? và phím F1 mở đúng trang hướng dẫn. Mọi chữ mới dùng chung một bảng thuật ngữ nên cùng một khái niệm luôn gọi cùng một tên.',
          'Nine new lessons use the new features: printing a hand-out, a meter inside a block, parameter sweeps with .step, a dual op-amp drawn as two sections, counting 8051 machine cycles in the debugger, a latching circuit with a contactor, hearing a filter through a speaker, battery runtime and building a circuit with a script. Nine new samples (numbers 90 – 98) check every formula written on their sheet. When the interface is in English, the notes on every sample are in English too. The Print and preview box has a new “Quick-reference card” choice: one sheet with six steps for a first circuit, the shortcut table and the main menus (in beginner mode the card lists only what is on the screen). The new dialogs have a ? button and answer F1 with the right guide page. All new texts share one glossary, so one idea always has the same name.',
        ),
      },
      {
        heading: L('Vòng 4 – Nhiều thiết kế, in ấn và chỉnh sơ đồ', 'Round 4 – Several designs, printing and schematic editing'),
        body: L(
          'Mỗi thiết kế mở trong một thẻ riêng; có thể mở tới 16 thiết kế, kéo một phần mạch sang thẻ khác, đóng hoặc lưu tất cả cùng lúc và khôi phục tất cả sau sự cố. Ctrl+P mở bản xem trước khi in chạy cả trong trình duyệt lẫn bản máy tính: khổ giấy, hướng, lề, tỉ lệ, chia tờ, đen trắng, chân trang, dải trang; in được trang sơ đồ, trang bậc thang, danh sách thiết bị đo, trang đồ thị, báo cáo và phiếu bài học; cài đặt lưu trong tệp. Sửa › Lớp hiển thị ẩn hiện lưới, tên linh kiện, giá trị, tên net; Sửa › Thứ tự hình vẽ và chữ đưa hình lên trên hoặc xuống dưới; Dán đặc biệt dán giữ nguyên tên, chỉ giá trị hoặc thành mạch con; Công cụ › Tiền tố tên linh kiện đổi chữ cái đầu của tên.',
          'Every design opens in its own tab; up to 16 can be open, a selection can be dragged to another tab, all can be saved or closed at once and all are restored after a crash. Ctrl+P opens a print preview that works in the browser and the desktop app: paper, orientation, margins, scale, splitting a large sheet, black and white, footer, page range; it prints schematic sheets, ladder sheets, the instrument list, Grapher pages, reports and lesson hand-outs, and the settings are saved in the file. Edit › Layer settings shows or hides the grid, designators, values and net names; Edit › Order brings drawings to the front or sends them back; Paste special pastes keeping names, values only or as a subcircuit; Tools › Reference designator prefixes changes the letters of part names.',
        ),
      },
      {
        heading: L('Vòng 4 – Mô phỏng sâu hơn', 'Round 4 – Deeper simulation'),
        body: L(
          'Thiết bị đo, LED, đầu dò và công tắc nằm trong khối giờ thuộc từng bản của khối (X2.XMM1). Dòng .step trong ô SPICE của mạch và Quét tham số của một tham số toàn cục chạy lại mọi phép phân tích cho từng giá trị; .meas đọc được cả điểm làm việc, hàm truyền và nhiễu; bài học đo được cả đáp ứng quá độ và AC. Phương án lắp ráp có thể cho từng linh kiện giá trị riêng. IC có nhiều phần (flip-flop 7474, công tắc tương tự 4066, op-amp kép và tư LM358, TL072, bộ định thời 556) vẽ thành từng phần cùng một tên và dùng chung chân nguồn. 8051 có chế độ gỡ lỗi: điểm dừng, từng lệnh, từng dòng, từng chu kỳ máy, thẻ Theo dõi, và đồng hồ mạch dừng đúng thời điểm đó. Mô hình MOSFET EKV và BSIM4, lõi từ trễ Jiles–Atherton với đường B–H trong Grapher.',
          'Instruments, LEDs, probes and switches inside a block now belong to each copy of the block (X2.XMM1). A .step line in the circuit’s SPICE box and the Parameter sweep of a global parameter rerun every analysis for each value; .meas reads operating points, transfer functions and noise as well; lessons can measure transient and AC responses. Assembly variants can give single parts their own values. ICs with several sections (the 7474 flip-flop, the 4066 analog switch, dual and quad op-amps such as the LM358 and TL072, the 556 timer) are drawn as sections with one name and share their supply pins. The 8051 has a debugger: breakpoints, step by instruction, line or machine cycle, a Watch tab, and the circuit clock stops at exactly that instant. EKV and BSIM4 MOSFET models, and a Jiles–Atherton hysteresis core with the B–H loop in the Grapher.',
        ),
      },
      {
        heading: L('Vòng 4 – Âm thanh, cơ điện, nguồn và bảo vệ', 'Round 4 – Sound, electromechanics, sources and protection'),
        body: L(
          'Loa và tai nghe phát âm thanh thật từ điện áp mạch (Mô phỏng › Âm thanh), micrô và tệp WAV làm nguồn tín hiệu, đồ thị xuất ra tệp WAV. Cuộn công-tắc-tơ, rơ-le, rơ-le thời gian và rơ-le nhiệt nối với tiếp điểm của chúng bằng tên, kể cả khi ở hai trang khác nhau. Cầu chì theo I²t, áp-tô-mát có đường cong B, C, D, K, Z, biến áp nguồn có độ lệch điện áp, pin có mức điện tích và điện trở trong thay đổi, nguồn từ thông, nguồn đọc từ tệp số đo (CSV, LVM, TDMS).',
          'The speaker and headphones play real sound from the circuit voltage (Simulate › Audio); a microphone and WAV files act as signal sources, and plots can be exported as WAV files. Contactor coils, relays, timer relays and overload relays are tied to their contacts by name, even on different sheets. Fuses defined by I²t, breakers with B, C, D, K and Z curves, mains transformers with regulation, batteries with a state of charge and a rising internal resistance, flux sources, and sources that play measurement files (CSV, LVM, TDMS).',
        ),
      },
      {
        heading: L('Vòng 4 – Trao đổi tệp và tự động hoá', 'Round 4 – File exchange and automation'),
        body: L(
          'Nhập và xuất thư viện ký hiệu KiCad (.kicad_sym, .lib), mở sơ đồ KiCad có bus và trang con, kể cả định dạng KiCad 5; đọc tệp TDMS vào Grapher; sao chép mạch qua bộ nhớ tạm của hệ thống để dán sang chương trình khác và ngược lại. Sơ đồ bậc thang có khối hàm, lệnh số học trên từ nhớ 16 bit, ngõ ra tương tự, sao chép bậc, bảng tham chiếu chéo. Công cụ › Tập lệnh (JavaScript) chạy trong hộp cát để dựng mạch, quét giá trị và vẽ đồ thị, cũng chạy được từ dòng lệnh: MachSim.exe --script tep.js.',
          'Import and export KiCad symbol libraries (.kicad_sym, .lib), open KiCad schematics with buses and sub-sheets, KiCad 5 files included; read TDMS files into the Grapher; copy a circuit through the system clipboard to paste it into another program and back. Ladder diagrams have function blocks, arithmetic on 16-bit memory words, analog outputs, rung copy and an address cross-reference. Tools › Scripts (JavaScript) runs in a sandbox to build circuits, sweep values and plot, and also from the command line: MachSim.exe --script file.js.',
        ),
      },
      {
        heading: L('Dành cho người mới: giao diện gọn', 'For beginners: a simpler screen'),
        body: L(
          'Tuỳ chọn › Chế độ người mới ẩn những menu, nút và phép phân tích mà mạch đầu tiên không cần, chỉ để lại: đặt linh kiện, nối dây, đặt đồng hồ, chạy mô phỏng và Trợ giúp. Thanh trạng thái ghi “Người mới”; nhấp vào đó (hoặc bỏ chọn trong menu Tuỳ chọn) là giao diện đầy đủ trở lại ngay, không mất gì cả. Lần đầu mở MachSim, bảng chào hỏi sẽ mời bạn chọn.',
          'Options › Beginner mode hides the menus, buttons and analyses a first circuit does not need and keeps: place parts, wire them, add a meter, run, and Help. The status bar shows "Beginner"; clicking it (or unticking the menu entry) brings the full interface straight back, with nothing lost. On the first run the welcome panel offers it.',
        ),
      },
      {
        heading: L('Học: bài học và bài của giáo viên', 'Learning: lessons, and lessons your teacher writes'),
        body: L(
          'Danh sách Trợ giúp › Bài học có hướng dẫn nay có 41 bài (mười bài của vòng 3 và chín bài của vòng 4), xếp theo sáu mức — từ định luật Ohm tới sơ đồ bậc thang, vi điều khiển 8051 và nhóm mới “Kỹ năng dùng MachSim” (đoạn mạch dùng lại, phương án lắp ráp, phép đo .meas). Mỗi bài vẫn tự kiểm tra mạch của bạn và giải thích bằng tiếng Việt. Giáo viên tự soạn được bài học trong Trợ giúp › Soạn bài học: viết mục tiêu, lý thuyết, các bước (có linh kiện, có chỗ nối, giá trị đo được, mạch không còn lỗi) và câu hỏi, rồi lưu thành tệp .msimlesson để phát cho học viên. Tiến độ học xuất được thành tệp .msimprog để nộp, hoặc lưu kèm trong dự án.',
          'Help › Guided lessons now holds 41 lessons (ten from round 3 and nine from round 4) in six levels — from Ohm\'s law to ladder diagrams, the 8051 microcontroller and the new "Working with MachSim" level (reusable snippets, assembly variants, .meas measurements). Every lesson still checks your own circuit and explains what is missing. A teacher can write lessons inside the program with Help › Lesson editor: a goal, theory, steps (a part is placed, a connection exists, a measured value, no electrical errors) and a quiz, saved as a .msimlesson file to hand out. Progress exports to a .msimprog file to hand in, or is kept inside a project.',
        ),
      },
      {
        heading: L('Tệp, mạch mẫu và đoạn mạch', 'Files, samples and snippets'),
        body: L(
          'Mở mạch mẫu giờ là một bảng chọn riêng với 11 chủ đề, ô tìm kiếm không cần dấu và hình xem trước: 73 mạch mẫu cùng 5 tệp SPICE, mỗi mạch đã qua kiểm tra điện và chạy đúng công thức ghi trên trang. Chọn một phần mạch rồi lưu thành “đoạn mạch” (.png có mạch nằm trong ảnh) để dùng lại ở bài khác. MachSim còn tự lưu phòng khi mất điện, giữ bản .bak, trao đổi được tệp XML, KiCad và EDIF, và nhập được tệp số đo CSV vào Máy vẽ.',
          'Open samples is now a browser of its own with 11 topics, accent-free search and a preview picture: 73 sample circuits plus 5 SPICE decks, each ERC-clean and checked against the formula written on its sheet. Select part of a circuit and save it as a "snippet" (a .png with the circuit inside it) to reuse elsewhere. MachSim also autosaves against a crash, keeps .bak copies, exchanges XML, KiCad and EDIF files, and imports CSV measurement files into the Grapher.',
        ),
      },
      {
        heading: L('Linh kiện: thư viện lớn hơn và thật hơn', 'Parts: a bigger and more realistic library'),
        body: L(
          'Thư viện đã vượt 5 000 linh kiện. Mới có: điện trở, tụ và cuộn cảm **không lý tưởng** (có ESR, ESL, điện dung ký sinh) để thấy cộng hưởng thật; tải trở kháng Z; dãy điện trở, đế IC, công tắc DIP và công tắc xoay nhiều vị trí, bàn phím 4×3 / 4×4; biến áp nhiều cuộn và lõi bão hoà; OTA, op-amp hồi tiếp dòng, PLL, khuếch đại cách ly, IC lái cổng MOSFET; nguồn Laplace H(s), khối điều khiển (cộng, tích phân có chặn, trễ, Schmitt, PWM, lấy mẫu – giữ), đất tham chiếu 1…5; và 19 “linh kiện 3D cho người học” vẽ giống vật thật kèm vòng màu. Ctrl+K mở bảng Chọn linh kiện mới: tìm theo nhóm / họ, xem chức năng, mô hình, vỏ và số liệu datasheet, in báo cáo chi tiết.',
          'The library has grown past 5,000 parts. New: **non-ideal** resistors, capacitors and inductors (with ESR, ESL and parasitic capacitance) so you can see real resonance; impedance loads; resistor packs, IC sockets, DIP and rotary switches, 4x3 / 4x4 keypads; multi-winding and saturating transformers; OTAs, current-feedback op-amps, a PLL, an isolation amplifier, MOSFET gate drivers; Laplace H(s) sources, control blocks (summer, integrator with limits, delay, Schmitt, PWM, sample-and-hold), reference grounds 1…5; and 19 "3D learner parts" drawn like the real thing with colour bands. Ctrl+K opens the new Select-a-component dialog: search by group and family, read the function, model, package and datasheet figures, print a detail report.',
        ),
      },
      {
        heading: L('Mạch số: vi điều khiển, PLD và sơ đồ bậc thang', 'Digital: a microcontroller, PLDs and ladder diagrams'),
        body: L(
          'MachSim mô phỏng được **vi điều khiển 8051** cùng với mạch: viết hợp ngữ (hoặc nạp tệp Intel HEX) trong Trình soạn mã, 32 chân cổng điều khiển và đọc mạch thật, xem thanh ghi, RAM, cổng và cả màn hình nối tiếp. Trình trợ giúp PLD biến biểu thức logic của bạn thành một khối PLD trên sơ đồ và xuất ra VHDL hoặc Verilog. Mới nữa là **trang sơ đồ bậc thang** (Đặt › Trang sơ đồ bậc thang) chạy trên giá PLC ảo với tiếp điểm, cuộn dây, bộ định thời và bộ đếm, sáng lên theo dòng điện khi mô phỏng — kèm năm mô hình cơ điện tử (băng tải, đèn giao thông, bình nước có bơm, cửa cuốn, thang máy 3 tầng).',
          'MachSim now co-simulates an **8051 microcontroller** with the circuit: write assembly (or load an Intel HEX file) in the code editor, let the 32 port pins drive and read real nodes, and watch the registers, RAM, ports and a serial terminal. The PLD wizard turns your own logic equations into a PLD block on the sheet and exports VHDL or Verilog. New as well is the **ladder sheet** (Place › Ladder sheet) running on a virtual PLC rack with contacts, coils, timers and counters that light up while the simulation runs — plus five mechatronics models (conveyor belt, traffic junction, water tank with a pump, garage door, three-floor lift).',
        ),
      },
      {
        heading: L('Vẽ sơ đồ chuyên nghiệp', 'Professional schematic work'),
        body: L(
          'Kiểm tra điện (ERC) có ma trận loại chân 9×9 bạn tự đặt, dấu “không nối” (NC) cho chân cố ý để hở, xoá dấu theo phạm vi và xuất báo cáo kèm giải thích tiếng Việt. Cài đặt net cho tên, màu dây và thông số mạch in. Có thêm: chụp một vùng trên trang thành ảnh, tự đặt lại phím tắt và ẩn / hiện nhóm nút trên thanh công cụ, danh mục 210 chân vỏ (footprint), cổng rời của 18 vi mạch (7400A…7400D dùng chung một tên linh kiện), phương án lắp ráp (variant) cho linh kiện “không gắn”, và cập nhật linh kiện từ thư viện khi thư viện đổi.',
          'The electrical rules check gained a 9x9 pin-type matrix you set yourself, NC markers for pins meant to stay open, deleting markers by scope and a report with Vietnamese explanations. Net settings carry a net\'s name, wire colour and PCB properties. Also new: capturing an area of the sheet as a picture, rebinding every shortcut and switching toolbar groups on and off, a catalogue of 210 footprints, single-gate sections of 18 logic ICs (7400A…7400D sharing one reference designator), assembly variants for parts that are "not fitted", and updating components when the library changes.',
        ),
      },
      {
        heading: L('Mô phỏng và đo', 'Simulating and measuring'),
        body: L(
          'Netlist SPICE của bạn dùng được `.meas` (đo thời gian lên, giá trị tại một điểm, trung bình, hiệu dụng, tích phân…) và `.step param` để chạy nhiều giá trị rồi vẽ chồng lên nhau; kết quả hiện thành bảng trong Máy vẽ. Nguồn E / G nhận bảng FREQ và bộ lọc CHEBYSHEV. Mỗi thông báo lỗi vẫn nói bằng tiếng Việt rằng sai gì, vì sao và sửa thế nào — dòng chữ kỹ thuật tiếng Anh của bộ giải giờ nằm gọn sau mục “Chi tiết kỹ thuật”, mở ra khi bạn cần.',
          'Your SPICE netlists now accept `.meas` (rise time, a value at an instant, average, RMS, integral …) and `.step param` to run a list of values and overlay the curves; the results appear as a table in the Grapher. E / G sources accept FREQ tables and CHEBYSHEV filters. Every error still says in Vietnamese what is wrong, why and how to fix it — the solver\'s own English line now sits behind a "Technical detail" toggle you open when you want it.',
        ),
      },
    ],
  },
  ercTools: {
    title: L('Kiểm tra điện (ERC): ma trận loại chân, dấu NC và báo cáo', 'The electrical rules check: pin-type matrix, NC markers and the report'),
    sections: [
      {
        heading: L('ERC làm gì', 'What ERC does'),
        body: L(
          'Công cụ › Kiểm tra điện (ERC) đọc sơ đồ và liệt kê những chỗ nối sai: thiếu đất, chân hở, net chỉ có một chân, dây treo, trùng tên linh kiện, giá trị không đọc được. Mỗi dòng trong thẻ ERC nói sai gì, vì sao sai và sửa thế nào; nút “Hiện trên sơ đồ” nhảy tới chỗ đó.',
          'Tools › Electrical rules check reads the schematic and lists the wiring mistakes: no ground, open pins, nets with a single pin, dangling wires, duplicate reference designators, values it cannot read. Every row of the ERC tab says what is wrong, why it matters and how to fix it; "Show on the schematic" jumps to the spot.',
        ),
      },
      {
        heading: L('Ma trận loại chân', 'The pin-type matrix'),
        body: L(
          'Mỗi chân linh kiện có một loại: ngõ vào, ngõ ra, hai chiều, ba trạng thái, cực thu hở, thụ động, nguồn vào, nguồn ra, không nối. Công cụ › Kiểm tra điện (ERC) › Tuỳ chọn ERC có một bảng vuông: hàng là loại chân thứ nhất, cột là loại chân thứ hai, ô cho biết khi hai loại đó gặp nhau trên cùng một net thì ERC im lặng (·), cảnh báo (!) hay báo lỗi (×). Nhấp vào ô để đổi. Mặc định chỉ những cặp thực sự sai mới bị bắt: hai ngõ ra đẩy–kéo nối nhau (lỗi), ngõ ra nối với chân nguồn ra (lỗi), ngõ ra nối vào đường cực thu hở hoặc ba trạng thái (cảnh báo). Net nguồn và đất được bỏ qua vì nhiều chân nguồn trên một đường VCC là bình thường. Tuỳ chọn được lưu trong tệp thiết kế, nên bài tập bạn phát cho người khác giữ nguyên mức kiểm tra.',
          'Every pin has a type: input, output, bidirectional, tri-state, open collector, passive, power in, power out, not connected. Tools › Electrical rules check › ERC options shows a square table: the row is the first pin type, the column the second, and the cell says what happens when the two meet on one net — nothing (·), a warning (!) or an error (×). Click a cell to change it. By default only the genuinely wrong pairs are flagged: two push-pull outputs tied together (error), an output tied to a power-output pin (error), an output on an open-collector or tri-state line (warning). Power and ground nets are skipped, because many supply pins on one VCC rail are normal. The options live in the design file, so an exercise you hand out keeps its settings.',
        ),
      },
      {
        heading: L('Dấu không nối (NC)', 'NC markers'),
        body: L(
          'Nhiều IC có chân cố ý để hở. Chọn linh kiện rồi mở Sửa › Dấu không nối (NC), tích vào những chân đó (có nút “Đánh dấu mọi chân đang hở”). ERC không còn cảnh báo “chân hở” cho chúng; ngược lại, nếu sau này bạn nối dây vào một chân đã đánh dấu, ERC báo lỗi để bạn biết hai điều đang nói khác nhau. Trên sơ đồ, chân đánh dấu NC có một dấu × nhỏ. Dấu được lưu trong tệp (PartInstance.ncPins).',
          'Many ICs have pins that are meant to stay open. Select the part, open Edit › NC marker and tick those pins ("Mark every open pin" does it in one click). ERC stops warning "pin not connected" for them; the other way round, if you later wire a marked pin, ERC reports an error so you notice the disagreement. On the schematic a marked pin carries a small ×. The markers are saved with the design.',
        ),
      },
      {
        heading: L('Chân nguồn ẩn của IC số', 'Hidden supply pins of digital ICs'),
        body: L(
          'IC số (74xx, 4000) có chân nguồn mà ký hiệu không vẽ, để sơ đồ gọn. Mặc định (“tự động”) chúng tự nối vào net mang tên VCC — hoặc VDD với họ 4000 — khi sơ đồ có ký hiệu nguồn đó, nên mức logic và trễ tính theo nguồn thật; nếu không có, IC dùng mức danh định. Trong Tuỳ chọn ERC bạn có thể chọn “lý tưởng” (bỏ qua net nguồn) hoặc “bắt buộc” (thiếu net nguồn là lỗi ERC, để kiểm tra một sơ đồ đã vẽ đủ nguồn). Từng linh kiện vẫn có tham số “Chân nguồn” riêng trong Thuộc tính và tham số đó thắng tuỳ chọn chung.',
          'Digital ICs (74xx, 4000) carry their supply on pins the symbol does not draw, which keeps the schematic readable. By default ("automatic") they join the net named VCC — VDD for the 4000 series — whenever the design has that power symbol, so levels and timing follow the real supply; without it the IC uses its nominal levels. In ERC options you can choose "ideal" (ignore supply nets) or "required" (a missing supply net is an ERC error, to check that a drawing really has its supplies). Each part still has its own "Power pins" parameter in Properties, and that parameter wins over the design-wide option.',
        ),
      },
      {
        heading: L('Xoá dấu theo phạm vi và xuất báo cáo', 'Deleting markers by scope and exporting the report'),
        body: L(
          'Sau khi sửa một phần mạch, bạn không cần xoá cả danh sách: Công cụ › Kiểm tra điện (ERC) › Xoá dấu ERC theo phạm vi cho chọn tất cả, chỉ trang hiện tại, chỉ lỗi, chỉ cảnh báo, hoặc chỉ các linh kiện đang chọn. “Xuất báo cáo ERC” lưu toàn bộ phát hiện kèm giải thích tiếng Việt thành tệp văn bản (hoặc CSV / HTML từ hộp thoại báo cáo) để dán vào bài thực hành.',
          'After fixing one part of the circuit you do not have to clear the whole list: Tools › Electrical rules check › Delete ERC markers offers all, this sheet only, errors only, warnings only, or just the selected parts. "Export ERC report" writes every finding with its Vietnamese explanation to a text file (or CSV / HTML) that you can paste into a lab report.',
        ),
      },
    ],
  },
  netSettings: {
    title: L('Cài đặt net: tên, màu và thông số cho mạch in', 'Net settings: name, colour and the properties the PCB needs'),
    sections: [
      {
        heading: L('Mở hộp thoại', 'Opening the dialog'),
        body: L(
          'Chọn một dây, một nhãn net hoặc một linh kiện rồi mở Công cụ › Cài đặt net (hoặc nhấp phải vào dây › Cài đặt net). Hộp thoại mở đúng net của vật đang chọn và có danh sách để chuyển sang net khác.',
          'Select a wire, a net label or a part and open Tools › Net settings (or right-click a wire › Net settings). The dialog opens on the net of what you selected and has a list to switch to another net.',
        ),
      },
      {
        heading: L('Tên và màu', 'Name and colour'),
        body: L(
          'Đổi tên net sẽ đổi nhãn net trên sơ đồ, nên tên trong netlist, trong báo cáo và trên đầu đo cũng đổi theo. Màu được áp dụng cho mọi dây của net, rất tiện để đường nguồn màu đỏ và đường đất màu đen. Ô ghi chú dành cho lời nhắc của chính bạn, còn “giữ tên khi đánh số lại” đánh dấu những net bạn không muốn bị đổi tên tự động.',
          'Renaming the net renames its label on the schematic, so the name in the netlist, in the reports and on the probes follows. The colour is given to every wire of the net, which is handy for a red supply rail and a black ground. The note field is for your own reminder, and "keep the name when the design is re-annotated" marks the nets you do not want renamed automatically.',
        ),
      },
      {
        heading: L('Thông số mạch in', 'The PCB properties'),
        body: L(
          'Phần “Mạch in (PCB)” đặt bề rộng đường mạch và khoảng cách tối thiểu (đơn vị mm), lớp đi dây mong muốn và lớp net (Tín hiệu, Bus, Nguồn, Điện áp cao — mỗi lớp là một cặp bề rộng / khoảng cách sẵn có). Các giá trị này đi theo netlist khi xuất sang phần mềm mạch in: trong netlist kiểu KiCad, mỗi net mang thêm các trường class, width, clearance và layer. MachSim không tự vẽ mạch in; đây là thông tin bạn gửi sang phần mềm PCB.',
          'The "Printed board (PCB)" box sets the trace width and the clearance (in mm), the preferred routing layer and the net class (Signal, Bus, Power, High voltage — each class is a ready-made width / clearance pair). These values travel with the netlist you export to PCB software: in the KiCad-style netlist each net carries extra class, width, clearance and layer fields. MachSim does not lay out boards; this is information you hand to the PCB tool.',
        ),
      },
    ],
  },
  customizeUi: {
    title: L('Tuỳ biến giao diện: phím tắt và thanh công cụ', 'Customizing the interface: shortcuts and the toolbar'),
    sections: [
      {
        heading: L('Phím tắt riêng', 'Your own shortcuts'),
        body: L(
          'Tuỳ chọn › Tuỳ biến giao diện liệt kê mọi lệnh cùng phím tắt của nó. Nhấp vào ô phím rồi bấm tổ hợp bạn muốn — ví dụ Ctrl+Alt+E cho Kiểm tra điện. Nút Xoá bỏ phím tắt, nút Về mặc định trả lại phím gốc, và “Về mặc định toàn bộ” xoá hết thay đổi. Phím tắt được lưu theo máy (cùng chỗ với các tuỳ chọn giao diện khác), không nằm trong tệp thiết kế.',
          'Options › Customize user interface lists every command with its shortcut. Click a key box and press the combination you want — Ctrl+Alt+E for the rules check, say. Clear removes a shortcut, Reset brings the built-in one back, and "Reset everything" drops all your changes. Shortcuts are stored per computer (with the other interface preferences), not in the design file.',
        ),
      },
      {
        heading: L('Trùng phím và phím không dùng được', 'Clashes and keys you cannot use'),
        body: L(
          'Nếu hai lệnh dùng cùng một tổ hợp, cả hai dòng được tô đỏ và ghi rõ trùng với lệnh nào — hãy đổi một trong hai. Một chữ hoặc số đứng một mình (như Q) bị từ chối vì nó sẽ gõ ra khi bạn nhập liệu; hãy thêm Ctrl hoặc Alt, hoặc dùng phím chức năng F2…F12. Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A và Ctrl+Z giữ nguyên ý nghĩa quen thuộc và không đổi được.',
          'When two commands share one combination both rows turn red and name the other command — change one of them. A bare letter or digit (Q, say) is refused because it would fire while you type; add Ctrl or Alt, or use a function key F2…F12. Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A and Ctrl+Z keep the meaning they have in every program and cannot be changed.',
        ),
      },
      {
        heading: L('Thanh công cụ', 'The toolbar'),
        body: L(
          'Thẻ “Thanh công cụ” bật / tắt từng nhóm nút: Tệp, Hoàn tác, Bộ nhớ tạm, Công cụ vẽ, Xoay và lật, Thu phóng, Lưới và dấu ERC, Mô phỏng. Tắt những nhóm bạn không dùng để thanh công cụ ngắn lại; mọi lệnh vẫn còn trong menu và vẫn có phím tắt.',
          'The "Toolbar" tab switches each button group on and off: File, Undo, Clipboard, Drawing tools, Rotate and flip, Zoom, Grid and ERC markers, Simulation. Hide the groups you do not use to shorten the toolbar; every command is still in the menus and still has its shortcut.',
        ),
      },
    ],
  },
  footprints: {
    title: L('Danh mục chân vỏ (footprint)', 'The footprint manager'),
    sections: [
      {
        heading: L('Chân vỏ là gì', 'What a footprint is'),
        body: L(
          'Chân vỏ (footprint) là hình các chân hàn của linh kiện trên mạch in: DIP-14 là hai hàng 7 chân cách nhau 2.54 mm, TO-92 là ba chân thẳng, R0805 là hai mảng hàn nhỏ. Ký hiệu trên sơ đồ nói linh kiện làm gì; chân vỏ nói nó chiếm chỗ nào trên bo.',
          'A footprint is the land pattern of a part on the printed board: DIP-14 is two rows of seven pads 2.54 mm apart, TO-92 is three leads in a line, R0805 is two small pads. The schematic symbol says what the part does; the footprint says what space it takes on the board.',
        ),
      },
      {
        heading: L('Dùng danh mục', 'Using the manager'),
        body: L(
          'Công cụ › Danh mục chân vỏ liệt kê các chân vỏ theo nhóm (IC hai hàng chân, IC dán, một hàng chân, hướng trục, đứng, linh kiện dán hai đầu, điốt, transistor, đầu nối, màn hình). Chọn một dòng để xem số chân, bước chân, cỡ thân và hình chân vỏ vẽ theo tỉ lệ mm (chân số 1 màu đỏ), cùng danh sách linh kiện trong thư viện đang dùng chân vỏ đó. Ô tìm kiếm nhận cả tên (“dip-14”) và mô tả.',
          'Tools › Footprint manager lists the footprints by family (dual in-line ICs, surface-mount ICs, single row, axial, radial, two-pad chip parts, diodes, transistors, connectors, displays). Pick a row to see the pad count, the pitch, the body size and the land pattern drawn to scale in millimetres (pad 1 in red), together with the library parts that use it. The search box accepts both names ("dip-14") and descriptions.',
        ),
      },
      {
        heading: L('Chân vỏ và linh kiện của bạn', 'Footprints and your own parts'),
        body: L(
          'Trong Trình tạo linh kiện, bước “Chân vỏ” mở đúng danh mục này để bạn chọn thay vì gõ tay, và cảnh báo khi số chân của ký hiệu không khớp số chân hàn. Từng linh kiện đã đặt cũng có thể ghi đè chân vỏ trong Thuộc tính › BOM / PCB. Tên chân vỏ đi theo cột Footprint của BOM và theo netlist xuất sang phần mềm mạch in.',
          'In the component wizard the "Footprint" step opens this very list, so you pick instead of typing, and it warns when the symbol pin count does not match the pad count. A placed part can also override its footprint in Properties › BOM / PCB. The footprint name travels in the Footprint column of the BOM and in the netlist you export to PCB software.',
        ),
      },
    ],
  },
  mcu: {
    title: L('Vi điều khiển 8051: viết chương trình và mô phỏng cùng mạch', 'The 8051 microcontroller: writing a program and simulating it with the circuit'),
    sections: [
      {
        heading: L('Đặt vi điều khiển và mở Trình soạn mã', 'Place the microcontroller and open the code editor'),
        body: L(
          'Trong thư viện, nhóm “Số linh tinh” có họ Vi điều khiển với hai linh kiện: “Vi điều khiển 8051” (đủ 40 chân: P0…P3, RST, ~EA, XTAL1 / XTAL2, ALE, ~PSEN) và “Vi điều khiển 8051 (P1)” — ký hiệu gọn chỉ có cổng 1, RST và các chân nối tiếp / ngắt, dùng cho bài học. Nhấp đúp vào linh kiện (hoặc Mô phỏng › Trình soạn mã vi điều khiển) để mở bảng soạn mã. Chương trình nằm trong tham số Chương trình của chính linh kiện, nên nó được lưu cùng tệp .msim và đi theo khi bạn sao chép linh kiện.',
          'In the library, the Misc digital group has a Microcontroller family with two parts: “MCU 8051” (the whole 40-pin device: P0…P3, RST, ~EA, XTAL1 / XTAL2, ALE, ~PSEN) and “MCU 8051 (P1)” — a small symbol with only port 1, RST and the serial / interrupt pins, for lessons. Double-click the part (or use Simulate › MCU code editor) to open the editor. The program lives in the part’s own Program parameter, so it is saved in the .msim file and travels with a copy of the part.',
        ),
      },
      {
        heading: L('Viết và dịch chương trình', 'Writing and building the program'),
        body: L(
          'Dùng hợp ngữ MCS-51: nhãn kết thúc bằng dấu hai chấm (MAIN:), chú thích bắt đầu bằng dấu chấm phẩy, chỉ thị có ORG (đặt địa chỉ), EQU / DATA / BIT (hằng số, địa chỉ byte, địa chỉ bit), DB / DW (byte, từ), DS (để trống), END. Số viết được 25, 0x19, 19h, 11001b, 31q hoặc ký tự trong dấu nháy. Biểu thức có + − * /, MOD, AND / OR / XOR / NOT, SHL / SHR, HIGH / LOW, dấu $ là địa chỉ hiện tại. Nhấn Dịch (Ctrl+Enter): nếu có lỗi, mỗi lỗi hiện kèm số dòng bằng tiếng Việt và nhấp vào là con trỏ nhảy tới dòng đó. Dịch xong, chương trình được ghi vào linh kiện (một bước hoàn tác). Bạn cũng có thể dán thẳng mã Intel HEX vào ô chương trình — MachSim tự nhận ra và chỉ cần đọc, không dịch. Nút Lưu Intel HEX ghi mã máy ra tệp .hex để nạp vào chip thật; Lưu bảng dịch ghi bảng địa chỉ — mã máy — dòng lệnh.',
          'Write MCS-51 assembly: a label ends with a colon (MAIN:), a comment starts with a semicolon, and the directives are ORG (set the address), EQU / DATA / BIT (constants, byte addresses, bit addresses), DB / DW (bytes, words), DS (reserve) and END. Numbers may be 25, 0x19, 19h, 11001b, 31q or a quoted character. Expressions take + − * /, MOD, AND / OR / XOR / NOT, SHL / SHR, HIGH / LOW, and $ is the current address. Press Build (Ctrl+Enter): every problem appears with its line number, and clicking it puts the caret on that line. A successful build writes the program into the part as one undo step. You may also paste Intel HEX straight into the program box — MachSim recognises it and only has to read it. Save Intel HEX writes the machine code to a .hex file for a real chip; Save listing writes the address / machine code / source table.',
        ),
      },
      {
        heading: L('Hai cách chạy', 'The two run modes'),
        body: L(
          '“Cùng mạch (mô phỏng)”: nhấn Chạy trên thanh công cụ. Vi điều khiển chạy thật trong mô phỏng — chân của nó đọc điện áp trên sơ đồ và điều khiển mạch — còn bảng soạn mã hiện thanh ghi, thanh ghi đặc biệt, RAM và mức các cổng theo từng mẫu của mô phỏng. “Chạy riêng (từng lệnh)”: bảng chạy chương trình bằng lõi riêng của nó, không có mạch (mọi chân đọc mức 1). Đây là chế độ để tập đọc hợp ngữ: nút Một lệnh (F11) chạy đúng một lệnh, Một dòng (F10) chạy tới khi sang dòng khác (qua được cả vòng lặp trễ), Chạy tới điểm dừng (F5) chạy tới điểm dừng gần nhất. Đặt điểm dừng bằng cách nhấp vào dấu tròn ở đầu dòng trong thẻ Bảng dịch. Dòng đang chạy được tô sáng.',
          '“With the circuit (simulation)”: press Run on the toolbar. The microcontroller really runs inside the simulation — its pins read the voltages on the schematic and drive the circuit — while the editor shows the registers, the special registers, the RAM and the port levels at each simulation sample. “On its own (step by step)”: the panel runs the program in its own core with no circuit (every pin reads 1). This is the mode for learning the instruction set: One instruction (F11) executes exactly one, One line (F10) runs until the program reaches another source line (that skips a delay loop), and Run to breakpoint (F5) runs to the next one. Set a breakpoint by clicking the dot in front of a line on the Listing tab. The line being executed is highlighted.',
        ),
      },
      {
        heading: L('Gỡ lỗi cùng mạch: điểm dừng, chạy từng lệnh, theo dõi', 'Debugging with the circuit: breakpoints, stepping, watches'),
        body: L(
          'Nhấn “Bắt đầu gỡ lỗi” (cách chạy “Cùng mạch”): mô phỏng chạy và dừng ngay trước lệnh đầu tiên. Nhấp vào dấu chấm đầu dòng trong thẻ Bảng dịch để đặt điểm dừng. Rồi dùng: Một lệnh (F11), Một dòng = bước qua cả lệnh gọi chương trình con (F10), Một chu kỳ máy (Shift+F11), Chạy tới con trỏ (F4, đặt con trỏ vào một dòng của khung chương trình), Chạy tiếp (F5). Mạch dừng đúng lúc vi điều khiển dừng: đồng hồ của mạch luôn bằng số chu kỳ máy đã chạy nhân thời gian một chu kỳ (1 µs với thạch anh 12 MHz), nên LED, tụ điện và chân cổng hiện đúng trạng thái tại khoảnh khắc đó. Dòng trạng thái cho biết vì sao dừng, đã chạy bao nhiêu chu kỳ và lệnh kế tiếp tốn bao nhiêu chu kỳ máy, bao nhiêu micro giây; cột “Chu kỳ” của Bảng dịch cho số chu kỳ từng lệnh. Tab Theo dõi nhận biểu thức như A, R0 + R1, P1.3, [30h], TMOD, (TH0 << 8) | TL0; tích “Dừng khi đổi” dừng mô phỏng ngay khi một ô nhớ đổi giá trị. Các thanh ghi, RAM và cổng cập nhật theo từng lần dừng.',
          'Press “Start debugging” (run mode “With the circuit”): the simulation runs and stops right before the first instruction. Click the dot at the start of a line in the Listing tab to set a breakpoint. Then use One instruction (F11), One line = step over a subroutine call too (F10), One machine cycle (Shift+F11), Run to cursor (F4, with the caret on a line of the program box) and Continue (F5). The circuit stops exactly when the microcontroller does: the circuit clock always equals the machine cycles executed times the cycle time (1 µs with a 12 MHz crystal), so LEDs, capacitors and port pins show exactly that moment. The status line says why it stopped, how many cycles have run and how many machine cycles and microseconds the next instruction takes; the “Cyc” column of the Listing gives the cycles of every instruction. The Watch tab takes expressions such as A, R0 + R1, P1.3, [30h], TMOD, (TH0 << 8) | TL0; the “Stop on change” box stops the simulation the moment a memory cell changes. Registers, RAM and ports update at every stop.',
        ),
      },
      {
        heading: L('Chân cổng của 8051 không giống cổng logic', 'The ports of an 8051 are not logic outputs'),
        body: L(
          'Chân P1 / P2 / P3 của 8051 hút dòng xuống đất rất tốt nhưng chỉ được treo lên mức 1 qua điện trở trong khoảng 50 kΩ, nên không đẩy nổi một LED. Cách nối đúng: LED và điện trở hạn dòng đi từ nguồn +5 V xuống chân, và chương trình cho chân xuống 0 để LED sáng (CLR P1.0). Cổng P0 không có điện trở treo, phải treo bằng điện trở ngoài. Nếu chỉ muốn thí nghiệm nhanh, đổi tham số “Kiểu ngõ ra của cổng” sang Kéo-đẩy thì chân phát cả hai mức như một cổng logic. Chân RST tích cực CAO: để hở thì vi điều khiển chạy ngay; nối lên nguồn thì nó bị giữ ở trạng thái reset. Chân ~EA để hở hoặc mức cao thì chạy mã trong chip; nối xuống đất thì vi điều khiển đứng im (MachSim không mô phỏng bộ nhớ mã ngoài). XTAL1 / XTAL2 chỉ để vẽ thạch anh — tần số lấy từ tham số Tần số thạch anh; 12 MHz cho chu kỳ máy đúng 1 µs, 11,0592 MHz cho tốc độ truyền nối tiếp chuẩn.',
          'The P1 / P2 / P3 pins of an 8051 sink current to ground very well but are only held at 1 through an internal resistor of about 50 kΩ, so they cannot source enough for an LED. The right wiring: the LED and its current-limiting resistor go from +5 V down to the pin, and the program pulls the pin low to light it (CLR P1.0). Port 0 has no pull-up at all and needs an external one. For a quick experiment, set the “Port drive” parameter to Push-pull and the pins drive both levels like a logic gate. RST is active HIGH: leave it open and the microcontroller runs at once; tie it to the supply and it is held in reset. ~EA open or high runs the internal code; tied to ground the microcontroller stands still (MachSim has no external program memory). XTAL1 / XTAL2 are only there so you can draw the crystal — the frequency comes from the Crystal frequency parameter; 12 MHz gives an exact 1 µs machine cycle, 11.0592 MHz gives standard serial baud rates.',
        ),
      },
      {
        heading: L('Bộ định thời, ngắt và cổng nối tiếp', 'Timers, interrupts and the serial port'),
        body: L(
          'Hai bộ định thời 0 và 1 chạy đủ bốn chế độ (13 bit, 16 bit, 8 bit tự nạp lại, chia đôi) và đếm được xung ngoài ở chân T0 / T1. Ngắt có đủ năm nguồn (INT0, Timer 0, INT1, Timer 1, nối tiếp), hai mức ưu tiên và đúng thứ tự quét; véc-tơ ở 0003h, 000Bh, 0013h, 001Bh, 0023h. Cổng nối tiếp chế độ 1 (8 bit, 1 bit start, 1 bit stop) phát từng bit ra chân TXD = P3.1 và nhận từng bit ở RXD = P3.0, tốc độ lấy từ bộ định thời 1 ở chế độ 2 (ví dụ TH1 = 0FDh với thạch anh 11,0592 MHz cho 9600 baud). Thẻ Cửa sổ nối tiếp hiện các byte chương trình gửi ra và gửi vào vi điều khiển những ký tự bạn gõ.',
          'Timers 0 and 1 run all four modes (13-bit, 16-bit, 8-bit auto-reload, split) and can count external pulses on T0 / T1. All five interrupt sources are there (INT0, timer 0, INT1, timer 1, serial), with two priority levels and the classic polling order; the vectors are at 0003h, 000Bh, 0013h, 001Bh and 0023h. Serial mode 1 (8 bits, one start bit, one stop bit) shifts each bit out of TXD = P3.1 and samples RXD = P3.0, at the rate set by timer 1 in mode 2 (for example TH1 = 0FDh with an 11.0592 MHz crystal gives 9600 baud). The Serial terminal tab shows the bytes the program sends and feeds what you type into the microcontroller.',
        ),
      },
      {
        heading: L('Mạch mẫu để bắt đầu', 'Samples to start from'),
        body: L(
          'Tệp › Mở mạch mẫu, chủ đề “Hỗn hợp”: “Nháy LED bằng 8051” (vòng lặp trễ), “Đếm ra LED 7 đoạn bằng 8051” (bảng mã và bộ định thời), “Đọc nút nhấn bằng 8051” (đọc chân, chống dội) và “8051 gửi Hello ra cổng nối tiếp”. Bài học “Vi điều khiển 8051 nháy LED” (Trợ giúp › Bài học) hướng dẫn từng bước cách tự dựng mạch nháy LED.',
          'File › Open samples, topic “Mixed”: “Blink an LED with an 8051” (a delay loop), “Seven-segment counter with an 8051” (a code table and a timer), “Read a push-button with an 8051” (reading a pin, debouncing) and “8051 sends Hello on the serial port”. The lesson “An 8051 blinking an LED” (Help › Lessons) walks through building the blink circuit yourself.',
        ),
      },
    ],
  },
  pld: {
    title: L('Logic lập trình được: PLD, bảng sự thật và xuất VHDL / Verilog', 'Programmable logic: PLDs, truth tables and VHDL / Verilog export'),
    sections: [
      {
        heading: L('Khối PLD', 'The PLD block'),
        body: L(
          'Nhóm “Số linh tinh”, họ PLD có các khối 2×2, 4×4, 8×8 và 16×8: mỗi khối có các chân I0…, một chân CLK cho ngõ ra có thanh ghi, một chân ~OE cho phép ngõ ra và các chân O0… Logic viết trong tham số Chương trình logic, bằng phương trình Boole hoặc bảng sự thật, và được dịch ngay khi mô phỏng — sai ở đâu thì ERC báo đúng dòng đó.',
          'The Misc digital group has a PLD family with 2×2, 4×4, 8×8 and 16×8 blocks: each has inputs I0…, a CLK pin for registered outputs, an active-low ~OE output enable and outputs O0… The logic goes in the Logic program parameter as Boolean equations or a truth table, and is compiled when the simulation runs — a mistake is reported with its line number by ERC.',
        ),
      },
      {
        heading: L('Trình hướng dẫn PLD', 'The PLD wizard'),
        body: L(
          'Công cụ › Trình hướng dẫn logic lập trình được: khai báo tên ngõ vào và ngõ ra của riêng bạn (A, B, CIN / SUM, COUT), viết logic bằng các tên đó, và trình hướng dẫn chọn khối PLD nhỏ nhất vừa đủ chân, dịch logic, rồi đặt khối lên trang hiện tại kèm nhãn net cho mọi chân đã dùng và đầu dò ở các ngõ ra. Nút “Bảng sự thật mẫu” chèn một bảng trống đủ số dòng để bạn chỉ việc điền 0 / 1.',
          'Tools › Programmable-logic (PLD) wizard: name your own inputs and outputs (A, B, CIN / SUM, COUT), write the logic with those names, and the wizard picks the smallest PLD block that fits, compiles the logic and places the block on the current sheet with a net label on every used pin and a probe on each output. The “Example truth table” button inserts an empty table with one row per combination, ready to fill in with 0 / 1.',
        ),
      },
      {
        heading: L('Cách viết logic', 'How to write the logic'),
        body: L(
          'Phương trình, mỗi dòng một ngõ ra: Q = A & B | !C (tổ hợp), Q := Q ^ A (có thanh ghi: nạp ở sườn lên của CLK), Q.oe = EN (ngõ ra ba trạng thái, chỉ phát khi EN = 1). Toán tử theo thứ tự ưu tiên: NOT (!, ~ hoặc NOT), AND (&, * hoặc AND), XOR (^ hoặc XOR), OR (|, + hoặc OR); ngoặc để nhóm. Tên ngõ ra dùng trong biểu thức là giá trị hiện tại của chính nó (hồi tiếp). Bảng sự thật: dòng đầu là tên các cột “A B | Q”, mỗi dòng sau là 0 / 1 / – (không quan tâm) cho ngõ vào và 0 / 1 cho ngõ ra; dòng nào không viết thì ngõ ra bằng 0.',
          'Equations, one per output: Q = A & B | !C (combinational), Q := Q ^ A (registered: loaded on the rising edge of CLK), Q.oe = EN (tri-state, driven only while EN is 1). Operators by priority: NOT (!, ~ or NOT), AND (&, * or AND), XOR (^ or XOR), OR (|, + or OR); parentheses group. An output name inside an expression is that output’s present value (feedback). Truth table: the first line names the columns “A B | Q”, each later line gives 0 / 1 / – (don’t care) for the inputs and 0 / 1 for the outputs; a row you do not write leaves the output at 0.',
        ),
      },
      {
        heading: L('Xuất VHDL / Verilog', 'Exporting VHDL / Verilog'),
        body: L(
          'Trình hướng dẫn xem trước và lưu được tệp VHDL (.vhd) hoặc Verilog (.v) của đúng logic bạn đã mô phỏng, với tên entity / module và tên chân theo tên tín hiệu của bạn: ngõ ra tổ hợp thành một phép gán, ngõ ra có thanh ghi thành một process / always theo sườn lên CLK, ngõ ra ba trạng thái thành một phép gán có điều kiện ra trạng thái trở kháng cao. Bộ chuyển đổi logic (thiết bị đo) cũng xuất được: đưa bảng sự thật hoặc biểu thức của nó sang trình hướng dẫn này. KHÔNG có tệp JEDEC: bản đồ cầu chì chỉ đúng cho một dòng chip cụ thể (thứ tự cầu chì và các bit cấu hình macrocell nằm trong tệp thiết bị của hãng), không có cách ánh xạ chung nào đáng tin, nên MachSim xuất HDL — mọi bộ công cụ PLD / CPLD đều dịch được.',
          'The wizard previews and saves a VHDL (.vhd) or Verilog (.v) file of exactly the logic you simulated, with the entity / module name and the port names taken from your signal names: a combinational output becomes one assignment, a registered output a process / always block on the rising edge of CLK, and a tri-state output a conditional assignment to the high-impedance state. The logic converter (instrument) can be exported the same way: carry its truth table or expression over to this wizard. There is NO JEDEC file: a fuse map only fits one device family (the fuse order and the macrocell configuration bits come from the manufacturer’s device file), there is no trustworthy generic mapping, so MachSim exports HDL — every PLD / CPLD toolchain compiles that.',
        ),
      },
    ],
  },
  placement: {
    title: L('Chọn và đặt linh kiện', 'Selecting and placing components'),
    sections: [
      {
        heading: L('Hộp chọn linh kiện (Đặt › Linh kiện…, Ctrl+K)', 'The component dialog (Place › Component…, Ctrl+K)'),
        body: L(
          'Chọn Cơ sở dữ liệu (Gốc = thư viện có sẵn của MachSim, chỉ đọc; Công ty = linh kiện dùng chung của lớp; Người dùng = linh kiện bạn tự tạo), rồi Nhóm → Họ → Linh kiện. Ô Tìm tìm trong nhóm đang chọn — chọn “Tất cả các nhóm” để tìm cả thư viện — theo tên, mã linh kiện hoặc giá trị (“4,7k”, “100uF”, “zener 5,1V”), gõ có dấu hay không dấu đều được. Nhấp đúp (hoặc Enter) để đặt: hộp đóng lại, linh kiện đi theo chuột, nhấp vào sơ đồ để thả, R để xoay, Esc để huỷ. Thư viện bên trái màn hình vẫn dùng được như trước; nút “Chi tiết…” dưới hình xem trước mở hộp này ở đúng linh kiện.',
          'Choose the Database (Master = the library that comes with MachSim, read-only; Corporate = parts shared by a class; User = the parts you made), then Group → Family → Component. The Search box searches the chosen group — choose “All groups” to search the whole library — by name, part number or value (“4.7k”, “100uF”, “zener 5.1V”), with or without Vietnamese accents. Double-click (or press Enter) to place: the dialog closes, the part follows the mouse, click on the schematic to drop it, R rotates, Esc cancels. The library panel on the left works as before; its “Details…” button opens this dialog at the same part.',
        ),
      },
      {
        heading: L('Thông tin của linh kiện', 'What the details mean'),
        body: L(
          'Chức năng: linh kiện làm gì. Nhà sản xuất mô hình / Mã mô hình: ai làm mô hình SPICE và tên thẻ .model / .subckt (phần lớn mô hình của MachSim được khớp từ số liệu datasheet công khai, ghi “MachSim”; khi theo mô hình do hãng công bố thì ghi tên hãng). Kiểu vỏ: tên vỏ dùng cho BOM và mạch in. Liên kết: linh kiện tự tạo có thể mang địa chỉ datasheet; linh kiện có sẵn mở trang trợ giúp của nó. “Báo cáo chi tiết” liệt kê chân, tham số, thông số datasheet và văn bản mô hình (sao chép hoặc lưu HTML). “Xem mô hình” hiện văn bản SPICE; linh kiện thư viện gốc chỉ xem, linh kiện tự tạo có mô hình SPICE thì sửa và lưu lại vào cơ sở dữ liệu được.',
          'Function: what the part does. Model manufacturer / Model ID: who made the SPICE model and the name of its .model / .subckt card (most MachSim models are fitted to public datasheet figures and say “MachSim”; a model that follows a vendor’s published model names the vendor). Package type: the package name used by the BOM and the PCB. Hyperlink: your own components can carry a datasheet address; built-in parts open their help page. “Detail report” lists the pins, parameters, datasheet figures and the model text (copy it or save HTML). “View model” shows the SPICE text; master-library parts are view-only, your own components with a SPICE model can be edited and saved back to the database.',
        ),
      },
      {
        heading: L('Vi mạch có nhiều phần: op-amp kép, flip-flop kép, 556, 4066', 'Chips with sections: dual op-amps, dual flip-flops, the 556, the 4066'),
        body: L(
          'Một vi mạch như TL072 (hai op-amp), LM324 (bốn), 7474 / 74LS74 / 4013 (hai flip-flop), NE556 (hai bộ 555) hay 4066 (bốn công tắc) là MỘT linh kiện thật nhưng trên sơ đồ bạn vẽ từng phần ở đúng chỗ dùng: TL072A, TL072B. Các phần dùng chung một tên (U1A, U1B) nên trong netlist, danh sách vật tư và mạch in chỉ là một vi mạch. Đặt phần B ngay sau phần A thì MachSim tự cho nó vào vi mạch U1 còn trống phần B; khi U1 đã đủ thì phần mới tạo vi mạch U2. Muốn luôn tạo vi mạch mới, bật Đặt › Mỗi phần vào một vi mạch mới. Chọn một phần rồi mở Thuộc tính để đổi sang phần còn trống, tách sang vi mạch mới hoặc chuyển vào vi mạch khác. Chân nguồn (V+, V−, VCC, GND) dùng chung: nối ở một phần là đủ, nhưng nối hai phần vào hai net khác nhau là lỗi. Phần chưa dùng được liệt kê trong Báo cáo › Cổng còn trống; với op-amp thừa hãy nối ngõ vào + xuống đất và ngõ vào − với ngõ ra. Đánh số lại, dán và tìm-thay giữ các phần của một vi mạch ở cùng một tên.',
          'A chip such as the TL072 (two op-amps), LM324 (four), 7474 / 74LS74 / 4013 (two flip-flops), NE556 (two 555 timers) or 4066 (four switches) is ONE real part, but on the schematic you draw each section where it is used: TL072A, TL072B. The sections share one name (U1A, U1B), so the netlist, the bill of materials and the PCB see a single chip. Place section B right after section A and MachSim puts it into the chip U1 that still has section B free; when U1 is full the new section starts chip U2. To always start a new chip, turn on Place › New package for each section. Select a section and open Properties to switch to a free section, move it to a new chip or into another chip. The supply pins (V+, V-, VCC, GND) are shared: wiring them on one section is enough, but wiring two sections to two different nets is an error. Unused sections are listed in Reports › Spare gates; for a spare op-amp tie the + input to ground and the - input to its output. Renumbering, paste and find-and-replace keep the sections of a chip under one name.',
        ),
      },
      {
        heading: L('Đặt liên tiếp và thư viện lớn', 'Placing one part after another, and big libraries'),
        body: L(
          'Khi bật “Mở lại hộp này sau khi đặt”, mỗi lần đặt xong một linh kiện hộp chọn mở lại ở cùng họ — tiện khi vẽ cả mạch từ đầu. Tắt nó đi thì mỗi lần nhấp đặt thêm một bản của cùng linh kiện cho tới khi nhấn Esc. Thư viện có hàng nghìn mã linh kiện: các bảng lớn (điốt, bóng bán dẫn, IC logic, dãy giá trị theo vỏ, đầu nối, RF) chỉ được nạp lần đầu bạn mở nhóm của chúng hoặc tìm kiếm, nên MachSim khởi động nhanh và không bao giờ bị treo; danh sách chỉ vẽ những dòng đang nhìn thấy.',
          'With “Reopen this dialog after placing” on, the dialog opens again at the same family each time a part is placed — handy when drawing a whole circuit. Turn it off and every click places another copy of the same part until you press Esc. The library holds thousands of part numbers: the big tables (diodes, transistors, logic ICs, value series by package, connectors, RF) load only the first time you open their group or search, so MachSim starts quickly and never freezes; the lists draw only the rows in view.',
        ),
      },
    ],
  },
  updateComponents: {
    title: L('Cập nhật linh kiện từ thư viện', 'Update components from library'),
    sections: [
      {
        heading: L('Khi nào cần cập nhật', 'When an update is needed'),
        body: L(
          'Mỗi lần lưu, tệp thiết kế ghi lại định nghĩa thư viện của các linh kiện đã đặt (vị trí chân, giá trị mặc định, dấu vân tay của mô hình). Khi bạn mở tệp bằng một phiên bản MachSim có thư viện mới hơn, hoặc khi linh kiện tự tạo trong cơ sở dữ liệu của bạn đã được sửa, Công cụ › Cập nhật linh kiện từ thư viện liệt kê những gì khác: chân dời chỗ, chân thêm / bớt, tham số mới hoặc bỏ, giá trị mặc định đổi, lựa chọn không còn hợp lệ, mô hình hoặc kiểu vỏ đổi. Linh kiện không còn trong thư viện được đánh dấu ⚠.',
          'Every save records the library definition of the placed parts (pin positions, default values, a fingerprint of the model). When you open the file with a MachSim whose library is newer, or after your own component was edited in your database, Tools › Update components from library lists what differs: pins moved, pins added / removed, new or removed parameters, changed defaults, choices that are no longer valid, a changed model or package. Parts that are no longer in the library are marked ⚠.',
        ),
      },
      {
        heading: L('Cập nhật làm gì', 'What the update does'),
        body: L(
          'Đánh dấu các linh kiện cần cập nhật rồi bấm Cập nhật. Dây và nhãn đang nối vào chân đã dời chỗ được kéo theo chân mới (giống Sửa › Thay linh kiện), tham số đã bỏ và lựa chọn không hợp lệ trở về giá trị mặc định, linh kiện tự tạo nhúng trong thiết kế được thay bằng bản trong cơ sở dữ liệu. Tất cả là một bước hoàn tác: nhấn Ctrl+Z nếu muốn quay lại. Linh kiện ⚠ không cập nhật được: chọn nó trên sơ đồ rồi dùng Sửa › Thay linh kiện để đổi sang linh kiện khác mà vẫn giữ dây.',
          'Tick the parts to update and click Update. Wires and labels on pins that moved are dragged to the new pins (like Edit › Replace component), removed parameters and invalid choices go back to their defaults, and embedded own components are replaced by the copy in your database. It is all one undo step: press Ctrl+Z to go back. A ⚠ part cannot be updated: select it on the schematic and use Edit › Replace component to swap it for another part while keeping the wires.',
        ),
      },
    ],
  },
  variants: {
    title: L('Phương án lắp ráp (variant)', 'Design variants'),
    sections: [
      {
        heading: L('Một sơ đồ, nhiều bản lắp', 'One schematic, several builds'),
        body: L(
          'Một mạch thường có vài bản lắp: bản đầy đủ, bản rút gọn bỏ màn hình, bản thí nghiệm có thêm điểm đo. Công cụ › Quản lý phương án lắp ráp tạo các phương án và cho bạn bỏ dấu “Lắp” của từng linh kiện trong từng phương án. Phương án đang dùng (chọn trong hộp hoặc ở Công cụ › Phương án đang dùng) quyết định: linh kiện không lắp bị bỏ khỏi mô phỏng, BOM, báo cáo linh kiện và tệp mạch in, và hiện mờ trên sơ đồ. Thanh trạng thái cho biết phương án đang dùng.',
          'A circuit often has a few builds: the full one, a basic one without the display, a lab one with extra test points. Tools › Variant manager creates the variants and lets you untick “Fitted” for any part in any variant. The active variant (chosen in the dialog or in Tools › Active variant) decides: parts it does not fit are left out of the simulation, the BOM, the part reports and the PCB files, and are drawn dimmed. The status bar shows the active variant.',
        ),
      },
      {
        heading: L('Giá trị riêng cho từng phương án', 'Own values for each variant'),
        body: L(
          'Một phương án không chỉ bỏ linh kiện mà còn có thể đổi giá trị: bản “rẻ” dùng R1 = 10k, bản “chính xác” dùng R1 = 4.7k. Trong lưới của Quản lý phương án, mỗi phương án có một ô giá trị cạnh dấu “Lắp”; để trống nghĩa là giữ giá trị đã lưu. Bấm vào ký hiệu (R1…) để mở mọi tham số và trường BOM (nhà sản xuất, mã linh kiện, nhà cung cấp, kiểu vỏ) của linh kiện đó theo từng phương án. Phần “Tham số toàn cục theo phương án” đổi biểu thức của một biến như RF. Khi phương án đang dùng, mô phỏng, BOM, báo cáo, tệp mạch in và nhãn giá trị trên sơ đồ đều dùng giá trị của nó; sửa trong bảng Thuộc tính vẫn sửa giá trị đã lưu. Lưu vùng chọn thành snippet sẽ hỏi bạn muốn lưu đúng giá trị của phương án đang dùng hay giữ mọi phương án.',
          'A variant can do more than leave parts out: it can change values. The “cheap” build uses R1 = 10k, the “precise” build R1 = 4.7k. In the Variant manager grid every variant has a value box next to “Fitted”; empty means the saved value is kept. Click a reference (R1…) to open all parameters and BOM fields (manufacturer, part number, supplier, footprint) of that part per variant. The “Global parameters per variant” section changes the expression of a variable such as RF. While the variant is active, the simulation, the BOM, the reports, the PCB files and the value labels on the schematic all use its values; editing in the Properties panel still edits the saved value. Saving a selection as a snippet asks whether to save the values of the active variant or to keep every variant.',
        ),
      },
      {
        heading: L('Thử nghiệm với phương án', 'Experimenting with variants'),
        body: L(
          'Ví dụ: tạo phương án “Đầy đủ” và “Không có R3” cho mạch phân áp có R2 song song R3. Chạy Điểm làm việc ở từng phương án và so sánh điện áp ra với công thức. Phương án được lưu trong tệp .msim; linh kiện trong mạch con / khối phân cấp có cùng trạng thái ở mọi bản đặt của khối, còn một khối không lắp thì bỏ cả nội dung của nó. Thuộc tính của linh kiện cũng có mục “Lắp trong phương án …”.',
          'For example: make the variants “Full” and “Without R3” for a divider with R2 in parallel with R3. Run the operating point in each variant and compare the output voltage with the formula. Variants are saved in the .msim file; parts inside a subcircuit / hierarchical block have the same status in every copy of the block, and a block that is not fitted leaves out all of its contents. A part’s Properties also have “Fitted in variant …”.',
        ),
      },
    ],
  },
  myLibrary: {
    title: L('Mang thư viện của tôi sang máy khác', 'Taking my library to another computer'),
    sections: [
      {
        heading: L('Một tệp cho mọi thứ của bạn', 'One file for everything that is yours'),
        body: L(
          'Công cụ › Thư viện của tôi › Xuất… lưu linh kiện yêu thích, linh kiện dùng gần đây và cơ sở dữ liệu Người dùng (tuỳ chọn cả cơ sở dữ liệu Công ty) vào một tệp .msimlib. Ở máy khác (phòng thí nghiệm, máy ở nhà), Công cụ › Thư viện của tôi › Nhập… đọc tệp đó: yêu thích được gộp thêm, danh sách gần đây của tệp đứng trước, linh kiện tự tạo được thêm vào cơ sở dữ liệu; khi một linh kiện đã có, bạn chọn giữ bản mới hơn, lấy bản trong tệp hoặc giữ bản trên máy.',
          'Tools › My library › Export… saves your favourite parts, your recently used parts and your User database (optionally the Corporate database too) in one .msimlib file. On another computer (the lab, at home), Tools › My library › Import… reads it: favourites are added, the file’s recent list comes first, your own components join the database; when a component already exists you choose to keep the newer copy, take the file’s copy or keep the one on that computer.',
        ),
      },
      {
        heading: L('Giữ thư viện trong dự án', 'Keeping the library in a project'),
        body: L(
          'Trong Tệp › Dự án, nút “Lưu thư viện của tôi vào dự án” ghi tệp library/my-library.msimlib vào dự án, nên khi đóng gói dự án (.msimpack) thư viện đi cùng các thiết kế. Mở dự án ở máy khác rồi bấm “Nạp thư viện của tôi từ dự án” để nhập lại.',
          'In File › Project, “Save my library into the project” writes library/my-library.msimlib into the project, so a packed project (.msimpack) carries the library with the designs. Open the project on another computer and click “Load my library from the project” to import it again.',
        ),
      },
    ],
  },
  realParts: {
    title: L('Linh kiện thực, ký hiệu và công tắc nhiều vị trí', 'Real parts, drawing symbols and multi-position switches'),
    sections: [
      {
        heading: L('Linh kiện lý tưởng và linh kiện thực', 'Ideal and real parts'),
        body: L(
          'Điện trở, tụ điện và cuộn cảm thường trong MachSim là lý tưởng. Họ “RLC không lý tưởng” (nhóm Cơ bản) thêm các phần tử ký sinh của linh kiện thật: tụ có ESR, ESL và điện trở rò; cuộn cảm có điện trở dây quấn và điện dung giữa các vòng dây; điện trở có điện cảm chân và điện dung song song. Chạy phân tích AC từ 10 kHz đến 1 GHz rồi vẽ trở kháng: tụ 100 nF với ESL 2 nH chạm đáy bằng ESR ở f0 = 1/(2π√(ESL·C)) ≈ 11 MHz rồi trở thành cuộn cảm; cuộn cảm 100 µH với Cp 5 pF có đỉnh ở ≈ 7.1 MHz rồi trở thành tụ điện. Các họ Điện trở / Tụ điện còn có dãy giá trị chuẩn theo vỏ: điện trở dán 0805 / 1206, điện trở công suất 1 W và 5 W, điện trở sun, tụ hoá theo nhiều điện áp (có ESR từ tan δ), tụ tantalum, tụ màng MKT / MKP, tụ gốm dán 0805.',
          'The ordinary resistor, capacitor and inductor of MachSim are ideal. The “Non-ideal RLC” family (Basic group) adds the parasitic elements of real parts: the capacitor has ESR, ESL and leakage; the inductor has winding resistance and inter-turn capacitance; the resistor has lead inductance and parallel capacitance. Run an AC analysis from 10 kHz to 1 GHz and plot the impedance: a 100 nF capacitor with 2 nH ESL bottoms out at the ESR at f0 = 1/(2π√(ESL·C)) ≈ 11 MHz and then becomes an inductor; a 100 µH inductor with 5 pF Cp peaks near 7.1 MHz and then becomes a capacitor. The Resistor / Capacitor families also hold standard values by package: 0805 / 1206 chip resistors, 1 W and 5 W power resistors, current shunts, electrolytics at several voltages (with an ESR from tan δ), tantalum, MKT / MKP film and 0805 ceramic capacitors.',
        ),
      },
      {
        heading: L('Tải Z, mảng điện trở, đế IC và ký hiệu vẽ', 'Z loads, resistor packs, sockets and drawing symbols'),
        body: L(
          'Tải Z nhận trở kháng phức tại một tần số (R + jX hoặc |Z|∠φ), đúng tuyệt đối tại tần số đó — dùng cho bài tập mạch xoay chiều. Mảng điện trở đặt nhiều điện trở cùng giá trị bằng một linh kiện (SIP chung chân, DIP riêng rẽ, kết cuối kép). Đế IC và họ “Ký hiệu sơ đồ” (điểm đo, mũi tên tín hiệu, ăng-ten, ký hiệu vỏ máy, đất bảo vệ, dấu chân không nối) không tham gia mô phỏng; chúng hiện màu nhạt. Ký hiệu vỏ máy và đất bảo vệ KHÔNG nối vào đất 0 V — muốn nối đất dùng Đất trong nhóm Nguồn. Đặt dấu chân không nối lên chân cố ý để hở thì ERC không cảnh báo nữa.',
          'A Z load takes a complex impedance at one frequency (R + jX or |Z|∠φ), exact at that frequency — for AC circuit exercises. A resistor pack places several equal resistors as one part (bussed SIP, isolated DIP, dual terminator). IC sockets and the “Schematic symbols” family (test point, signal arrows, antenna, chassis and protective-earth markers, no-connect mark) do not take part in the simulation; they are drawn dimmed. The chassis and earth markers do NOT join the 0 V ground — use Ground from the Sources group for that. Put the no-connect mark on a pin left open on purpose and ERC stops warning about it.',
        ),
      },
      {
        heading: L('Công tắc DIP, công tắc xoay, bàn phím ma trận', 'DIP switches, rotary switches, keypads'),
        body: L(
          'Các linh kiện này có nhiều nút điều khiển. Khi đang mô phỏng: bấm vào từng vị trí của công tắc DIP hoặc nhấn phím 1, 2, 3 … để gạt; bấm vào một tiếp điểm của công tắc xoay để chọn, hoặc nhấn R để sang vị trí kế; bấm giữ một phím của bàn phím ma trận, hoặc giữ đúng phím đó (0…9, *, #, A…D) trên bàn phím máy tính. Chấm tô màu cho biết vị trí nào đang bật / được chọn / đang nhấn. Ô “Phím” trong Thuộc tính đổi phím của từng nút. Chuột phải lên linh kiện để thao tác từng nút từ menu.',
          'These parts have several controls. While the simulation runs: click a position of a DIP switch or press 1, 2, 3 … to flip it; click a contact of a rotary switch to select it, or press R for the next position; hold a keypad key with the mouse, or hold the same key (0…9, *, #, A…D) on the computer keyboard. A filled dot shows which position is on / selected / pressed. The “Keys” box in Properties changes the key of each control. Right-click the part to operate any control from the menu.',
        ),
      },
      {
        heading: L('Lõi từ, OTA, op-amp hồi tiếp dòng, PLL, mạch lái cổng', 'Magnetic cores, OTA, current-feedback op-amps, PLL, gate drivers'),
        body: L(
          'Biến áp bão hoà và cuộn cảm bão hoà có lõi phi tuyến: tăng điện áp biến áp lên 1.5 lần thì đỉnh dòng từ hoá tăng khoảng 5 lần; cuộn cảm chỉ còn L/10 ở dòng bão hoà. Còn có biến áp nhiều cuộn (1 + 2, 1 + 3, 2 + 2) và ba cuộn cảm ghép có hệ số ghép riêng từng cặp. Trong nhóm Tương tự: OTA (dòng ra = gm·Vvào, gm = IABC/(2·VT) tỉ lệ với dòng phân cực), op-amp hồi tiếp dòng (băng thông do RF quyết định, gần như không phụ thuộc hệ số khuếch đại), khối PLL (khi khoá, V(VCTRL) = (fin − f0)/kv), khuếch đại cách ly và khuếch đại hiệu. Nhóm Linh tinh có mạch lái cổng MOSFET (sườn lên ≈ 2.2·ROH·C) và mạch lái nửa cầu. Nhấn F1 trên từng linh kiện để xem cách đọc kết quả.',
          'The saturating transformer and saturating inductor have a nonlinear core: raise the transformer voltage 1.5× and the peak magnetising current grows about 5×; the inductor is down to L/10 at its saturation current. There are also multi-winding transformers (1 + 2, 1 + 3, 2 + 2) and three coupled inductors with a coupling factor per pair. In the Analog group: the OTA (output current = gm·Vin, gm = IABC/(2·VT), proportional to the bias current), current-feedback op-amps (bandwidth set by RF, nearly independent of gain), the PLL block (locked, V(VCTRL) = (fin − f0)/kv), isolation and difference amplifiers. The Misc group has MOSFET gate drivers (rise ≈ 2.2·ROH·C) and a half-bridge driver. Press F1 on each part to see how to read its results.',
        ),
      },
    ],
  },
  signalBlocks: {
    title: L('Nguồn đặc biệt và khối chức năng điều khiển', 'Special sources and control-function blocks'),
    sections: [
      {
        heading: L('Vẽ sơ đồ khối và mô phỏng ngay', 'Draw a block diagram and simulate it'),
        body: L(
          'Nhóm Tương tự › Khối chức năng điều khiển có các khối như trong sách điều khiển tự động: bộ cộng, khuếch đại, tích phân (có reset và giới hạn chống windup), vi phân, hàm truyền H(s), hạn biên, khối trễ Schmitt, hạn tốc độ biến thiên, lấy mẫu và giữ, điều chế PWM, VCO, PI / PID. Mỗi khối đọc điện áp so với đất và cho ra điện áp so với đất, nên nối các khối bằng dây như vẽ sơ đồ khối. Ví dụ một vòng kín bậc nhất: bộ cộng 2 ngõ vào (ka = 1, kb = −1) → bộ tích phân k = 1000 → ngõ ra quay về ngõ vào B; với bậc thang 1 V ở A, ngõ ra tiến tới 1 V với hằng số thời gian 1 ms.',
          'Analog › Control functions holds the blocks of a control-engineering textbook: summer, gain, integrator (with reset and anti-windup limits), differentiator, transfer function H(s), limiter, Schmitt hysteresis, slew-rate limiter, sample-and-hold, PWM modulator, VCO, PI / PID. Every block reads voltages against ground and outputs a voltage against ground, so you wire them like a block diagram. Example of a first-order loop: a 2-input summer (ka = 1, kb = −1) → an integrator with k = 1000 → its output back to input B; with a 1 V step at A the output rises to 1 V with a 1 ms time constant.',
        ),
      },
      {
        heading: L('Nguồn trong nhóm Nguồn', 'Sources in the Sources group'),
        body: L(
          'Nguồn hàm Laplace (điều khiển bằng áp hoặc dòng, ngõ ra áp hoặc dòng) nhận H(s) bằng hệ số tử / mẫu hoặc biểu thức theo s; nguồn ABM (hành vi) nhận biểu thức của V(net), I(Vx), time với if, limit, table, min, max; bộ đơn ổn điều khiển được; khối hạn dòng; nguồn DC tương tác (chỉnh bằng phím hoặc thanh trượt khi đang chạy); khâu trễ thời gian; nguồn PWM; nguồn lưỡng cực; dao động răng cưa điều khiển bằng áp. Nhấn F1 trên một nguồn để xem cách dùng.',
          'Laplace sources (voltage- or current-controlled, voltage or current output) take H(s) as numerator / denominator coefficients or an expression in s; ABM (behavioural) sources take an expression of V(net), I(Vx) and time with if, limit, table, min, max; there are a controlled one-shot, a current limiter, interactive DC sources (adjusted with a key or the slider while running), a time delay, a PWM source, a bipolar source and a voltage-controlled sawtooth. Press F1 on a source to see how to use it.',
        ),
      },
      {
        heading: L('Đất tham chiếu 1…5', 'Reference grounds 1…5'),
        body: L(
          'Ngoài Đất chính còn năm Đất tham chiếu riêng. Mỗi số là một net riêng (GNDREF1 … GNDREF5) dùng làm điểm 0 V cho một phần mạch cách ly, ví dụ cuộn thứ cấp biến áp. Nó chỉ nối với Đất chính qua 1 GΩ, nên phần mạch đó vẫn thả nổi như thật. Đầu dò điện áp trên phần mạch chỉ có Đất tham chiếu n đo so với Đất tham chiếu n; ERC cảnh báo nếu phần mạch đó lại nối một chiều với Đất chính (khi đó nó không còn cách ly).',
          'Besides the main ground there are five separate reference grounds. Each number is its own net (GNDREF1 … GNDREF5), the 0 V point of an isolated part of the circuit such as a transformer secondary. It joins the main ground only through 1 GΩ, so that part really floats. Voltage probes on a part whose only reference is reference ground n read against it; ERC warns when that part is DC-connected to the main ground after all (then it is not isolated).',
        ),
      },
    ],
  },
  spiceMeasure: {
    title: L('Đo tự động .meas và quét tham số .step trong SPICE', 'Automatic .meas measurements and .step sweeps in SPICE'),
    sections: [
      {
        heading: L('.meas: để máy đo giúp bạn', '.meas: let the simulator measure for you'),
        body: L(
          'Thêm thẻ .meas vào netlist SPICE (hoặc vào văn bản SPICE riêng của thiết kế, hoặc vào phân tích Tự định nghĩa) để MachSim tự tính một con số từ kết quả. Kết quả hiện trong bảng "Phép đo (.meas)" dưới đồ thị Grapher và trong tệp kết quả của chế độ dòng lệnh. Các dạng: FIND biểu thức AT=x (giá trị tại một điểm), FIND … WHEN a=b (giá trị khi điều kiện xảy ra), WHEN a=b (thời điểm / tần số xảy ra), TRIG … TARG … (khoảng cách giữa hai sự kiện, ví dụ thời gian lên), AVG / RMS / MIN / MAX / PP / INTEG biểu thức FROM=x1 TO=x2, DERIV (độ dốc), PARAM (biểu thức của các phép đo trước). RISE=n / FALL=n / CROSS=n / LAST chọn lần cắt thứ mấy, TD=x bỏ qua phần đầu. .meas OP và .meas TF chỉ đọc MỘT điểm: .meas op vo FIND V(out), .meas tf gain FIND gain (dùng được cả rin, rout). .meas NOISE đo kết quả nhiễu như quét tần số: .meas noise vn FIND onoise_spectrum AT=1k, .meas noise tot INTEG onoise_psd FROM=10 TO=100k.',
          'Add .meas cards to a SPICE netlist (or to the design’s custom SPICE text, or to a User-defined analysis) and MachSim computes a number from the results. The values appear in the "Measurements (.meas)" table under the Grapher plot and in the command-line result files. Forms: FIND expr AT=x (value at a point), FIND … WHEN a=b (value when a condition happens), WHEN a=b (the time / frequency it happens), TRIG … TARG … (the distance between two events, e.g. a rise time), AVG / RMS / MIN / MAX / PP / INTEG expr FROM=x1 TO=x2, DERIV (slope), PARAM (an expression of earlier measurements). RISE=n / FALL=n / CROSS=n / LAST pick the crossing, TD=x skips the start. .meas OP and .meas TF read ONE point: .meas op vo FIND V(out), .meas tf gain FIND gain (rin and rout work too). .meas NOISE measures a noise run like a frequency sweep: .meas noise vn FIND onoise_spectrum AT=1k, .meas noise tot INTEG onoise_psd FROM=10 TO=100k.',
        ),
      },
      {
        heading: L('.step param: một họ đường cong', '.step param: a family of curves'),
        body: L(
          '.step param R list 1k 2k 5k (hoặc .step param R 1k 10k 1k, dec / oct) chạy lại toàn bộ phân tích với mỗi giá trị của tham số .param R; Grapher vẽ chồng các lần chạy và .meas được tính cho từng lần (bảng "Phép đo theo từng lần chạy"). Trên sơ đồ có hai cách giống hệt nhau: viết thẻ .step vào văn bản SPICE riêng của thiết kế (tên có thể là một tham số toàn cục của mạch, một linh kiện như C1, hoặc temp), hoặc chọn phân tích Quét tham số rồi "Tham số toàn cục (biến)". Mạch được dựng lại cho từng giá trị nên quét được mọi loại phân tích (xoay chiều, quá độ, điểm làm việc …).',
          '.step param R list 1k 2k 5k (or .step param R 1k 10k 1k, dec / oct) reruns the whole analysis for every value of the .param R; the Grapher overlays the runs and .meas is evaluated for each run (table "Measurements per run"). On a schematic there are two equivalent ways: write the .step card in the design’s custom SPICE text (the name can be a global parameter of the circuit, a part such as C1, or temp), or pick the Parameter sweep analysis and "Global parameter (variable)". The circuit is rebuilt for every value, so any analysis can be stepped (AC, transient, operating point …).',
        ),
      },
      {
        heading: L('Nguồn FREQ, CHEBYSHEV và ký sinh kiểu LTspice', 'FREQ and CHEBYSHEV sources, LTspice parasitics'),
        body: L(
          'E/G … FREQ {V(in)} = (f, dB, độ) … là đáp ứng tần số cho bằng bảng: phân tích AC dùng đúng bảng (nội suy theo log f), phân tích quá độ tích chập với đáp ứng xung tính từ bảng. E/G … CHEBYSHEV {V(in)} = LP fpass fstop gợn_sóng suy_hao (cũng HP, BP, BR) thiết kế bộ lọc Chebyshev loại I có bậc nhỏ nhất đạt yêu cầu và mô phỏng nó như một chuỗi khâu bậc hai. Tham số Rser=, Lser=, Rpar=, Cpar= của tụ, cuộn cảm và nguồn áp (như LTspice) thành các phần tử thật nối tiếp / song song.',
          'E/G … FREQ {V(in)} = (f, dB, deg) … is a frequency response given as a table: AC analysis uses the table itself (interpolated in log f), the transient convolves with the impulse response computed from it. E/G … CHEBYSHEV {V(in)} = LP fpass fstop ripple attenuation (also HP, BP, BR) designs the lowest-order type I Chebyshev filter that meets it and simulates it as a chain of second-order stages. Rser=, Lser=, Rpar=, Cpar= on capacitors, inductors and voltage sources (as in LTspice) become real series / parallel elements.',
        ),
      },
    ],
    code: ['.meas TRAN trise TRIG V(out) VAL=0.1 RISE=1 TARG V(out) VAL=0.9 RISE=1', '.meas AC dc0 FIND vdb(out) AT=1', '.meas AC f3db WHEN vdb(out)=dc0-3 FALL=1', '.step param rv list 1k 2k 5k'],
  },
  samples: {
    title: L('Mạch mẫu', 'Sample circuits'),
    sections: [
      {
        heading: L('Học từ mạch chạy được ngay', 'Learn from circuits that run at once'),
        body: L(
          'Tệp > Mở mạch mẫu mở trình duyệt mạch mẫu theo chủ đề: Cơ bản, Bán dẫn, Op-amp, Số, Hỗn hợp, Nguồn, RF, Thiết bị đo, Phân tích, Phân cấp. Mỗi mạch có hình xem trước, lời giải thích ngắn và phép phân tích đã cài sẵn: mở ra, nhấn Chạy (F5) là thấy kết quả. Mạch mẫu mở thành thiết kế mới, nên bạn sửa thoải mái mà không làm hỏng bản gốc.',
          'File > Open samples opens the sample browser by topic: Basics, Semiconductors, Op-amps, Digital, Mixed signal, Power, RF, Instruments, Analyses, Hierarchy. Every sample has a preview picture, a short explanation and a ready analysis: open it and press Run (F5) to see the result. A sample opens as a new design, so you can change it freely without spoiling the original.',
        ),
      },
      {
        heading: L('Gợi ý', 'Tips'),
        body: L(
          'Gõ vào ô tìm kiếm (có dấu hoặc không dấu) để lọc theo tên hoặc mô tả. Ghi chú trên trang sơ đồ của mỗi mạch nói nên nhìn vào đâu (đồng hồ, dao động ký, Grapher) và công thức để kiểm tra kết quả. Một số mạch là netlist SPICE: chúng chạy trực tiếp và hiện kết quả trong Grapher.',
          'Type in the search box (with or without Vietnamese accents) to filter by name or description. The note on each sample’s sheet says what to look at (meter, oscilloscope, Grapher) and the formula to check the result with. Some samples are SPICE netlists: they run directly and show their results in the Grapher.',
        ),
      },
    ],
  },
  snippets: {
    title: L('Snippet mạch (ảnh PNG mang theo mạch)', 'Circuit snippets (PNG pictures that carry the circuit)'),
    sections: [
      {
        heading: L('Lưu một đoạn mạch thành ảnh', 'Save part of a circuit as a picture'),
        body: L(
          'Chọn các linh kiện và dây, rồi Sửa > Lưu vùng chọn thành snippet (hoặc Tệp > Snippet mạch). MachSim lưu một ảnh PNG của vùng chọn; bên trong ảnh có kèm toàn bộ mạch (linh kiện, giá trị, dây, nhãn, linh kiện người dùng và tham số toàn cục đang dùng). Ảnh này dán được vào báo cáo hay gửi qua tin nhắn như mọi ảnh khác.',
          'Select parts and wires, then Edit > Save selection as snippet (or File > Snippets). MachSim saves a PNG picture of the selection; inside the picture it keeps the whole circuit (parts, values, wires, labels, the user components and global parameters it uses). The picture can go into a report or a chat like any other image.',
        ),
      },
      {
        heading: L('Đặt lại mạch từ ảnh', 'Place the circuit again from the picture'),
        body: L(
          'Kéo tệp ảnh từ trình quản lý tệp thả lên trang sơ đồ (mạch hiện đúng chỗ thả), hoặc sao chép tệp ảnh rồi nhấn Ctrl+V, hoặc Tệp > Snippet mạch > Dán snippet từ tệp. Linh kiện giữ tên (R1, C2 …) nếu tên đó chưa có trong thiết kế; tên trùng được đánh số tiếp. “Mở snippet thành thiết kế mới” mở ảnh thành một thiết kế riêng. Ảnh PNG bình thường (ảnh chụp màn hình) không có mạch: MachSim báo rõ điều đó. Lưu ý: dán ảnh từ trình duyệt hay ứng dụng chat thường làm mất phần mạch, vì chúng nén lại ảnh — hãy dùng chính tệp .png.',
          'Drag the picture file from the file manager onto the sheet (the circuit appears where you drop it), or copy the file and press Ctrl+V, or use File > Snippets > Paste snippet from file. Parts keep their names (R1, C2 …) when the design does not use them yet; clashing names get the next free number. “Open snippet as new design” opens the picture as a design of its own. An ordinary PNG (a screenshot) has no circuit, and MachSim says so. Note: images pasted from a browser or a chat app usually lose the circuit because those programs re-encode the picture — use the .png file itself.',
        ),
      },
    ],
  },
  fileSafety: {
    title: L('Lưu tự động, sao lưu và thông tin tệp', 'Autosave, backups and file information'),
    sections: [
      {
        heading: L('Không mất bài khi máy tắt đột ngột', 'Do not lose work when the computer stops'),
        body: L(
          'Khi thiết kế có thay đổi chưa lưu, MachSim cất một bản sao vào chỗ khôi phục (trên máy tính: thư mục dữ liệu của MachSim; trong trình duyệt: bộ nhớ của trình duyệt), theo chu kỳ đặt ở Tuỳ chọn > Tuỳ chọn tệp (mặc định 30 giây). Nếu lần trước MachSim bị tắt đột ngột (mất điện, treo máy, đóng từ Task Manager), lần mở sau MachSim hỏi có khôi phục không. Khi bạn chủ động đóng và chọn không lưu, MachSim không hỏi nữa, nhưng bản sao vẫn mở được bằng Tệp > Khôi phục bản lưu tự động cho tới khi bạn lưu hoặc tạo thiết kế mới.',
          'While the design has unsaved changes, MachSim keeps a copy in the recovery slot (desktop: MachSim’s user-data folder; browser: the browser’s storage), at the interval set in Options > File options (30 seconds by default). If MachSim stopped abruptly last time (power cut, crash, closed from Task Manager), it offers to restore the copy at the next start. When you close on purpose and choose not to save, it does not ask, but the copy can still be opened with File > Recover autosaved design until you save or start a new design.',
        ),
      },
      {
        heading: L('Bản sao lưu .bak', '.bak backup copies'),
        body: L(
          'Trên máy tính, mỗi lần Lưu ghi đè một tệp, bản cũ được giữ thành “tên.msim.bak” (số bản giữ lại chọn ở Tuỳ chọn > Tuỳ chọn tệp; bản cũ hơn là .bak2, .bak3 …). Mở bản .bak bằng Tệp > Mở để quay lại phiên bản trước rồi Lưu thành… tên mới.',
          'On the desktop, every Save over a file keeps the previous version as “name.msim.bak” (choose how many in Options > File options; older ones are .bak2, .bak3 …). Open a .bak with File > Open to go back to the earlier version, then Save as… under a new name.',
        ),
      },
      {
        heading: L('Thông tin tệp', 'File information'),
        body: L(
          'Tệp > Thông tin tệp cho biết đường dẫn, kích thước, ngày tạo / sửa, phiên bản MachSim đã lưu tệp, số trang, linh kiện theo họ, dây, net, thiết bị đo, khối phân cấp, tham số toàn cục, các giới hạn của giảng viên và cài đặt mô phỏng. Nút “Sao chép” chép toàn bộ thông tin để dán vào báo cáo.',
          'File > File information shows the path, size, created / modified dates, the MachSim version that saved the file, the number of sheets, parts by family, wires, nets, instruments, hierarchical blocks, global parameters, instructor restrictions and simulation settings. “Copy” copies it all for a report.',
        ),
      },
    ],
  },
  exchange: {
    title: L('Trao đổi tệp với chương trình khác', 'Exchanging files with other programs'),
    sections: [
      {
        heading: L('Định dạng MachSim XML', 'The MachSim XML format'),
        body: L(
          'Tệp > Xuất MachSim XML ghi thiết kế thành XML có tài liệu (docs/xml-format.md trong mã nguồn): mỗi trường của tệp .msim là một phần tử XML, nên công cụ khác đọc / ghi được và mở lại không mất gì. Tệp > Mở đọc được tệp .xml này.',
          'File > Export MachSim XML writes the design as documented XML (docs/xml-format.md in the source): every field of the .msim file is an XML element, so other tools can read and write it and it opens again without loss. File > Open reads these .xml files.',
        ),
      },
      {
        heading: L('KiCad và EDIF', 'KiCad and EDIF'),
        body: L(
          'Tệp > Mở (hoặc Nhập sơ đồ KiCad / EDIF) đọc sơ đồ KiCad (.kicad_sch, KiCad 6 trở lên) và netlist / sơ đồ EDIF 2 0 0 (.edf, .edn) mà nhiều chương trình vẽ sơ đồ xuất được. Điện trở, tụ, cuộn cảm, diode, LED, Zener, transistor BJT / MOSFET / JFET, nguồn áp / dòng, đất và ký hiệu nguồn được ghép với linh kiện thư viện; giá trị như “2N3904” hay “1N4148” chọn đúng linh kiện đó. Phần còn lại thành khối chung có ghi chú (vẽ được nhưng không mô phỏng). Sơ đồ KiCad giữ vị trí linh kiện; dây được vẽ lại tự động. Sau khi nhập, MachSim liệt kê những gì cần kiểm tra.',
          'File > Open (or Import KiCad / EDIF schematic) reads KiCad schematics (.kicad_sch, KiCad 6 and later) and EDIF 2 0 0 netlists / schematics (.edf, .edn), which many schematic editors can export. Resistors, capacitors, inductors, diodes, LEDs, Zeners, BJT / MOSFET / JFET transistors, voltage / current sources, ground and power symbols are matched to library parts; a value such as “2N3904” or “1N4148” picks exactly that part. Everything else becomes a generic block with a note (drawn, not simulated). KiCad schematics keep the part positions; wires are redrawn automatically. After importing, MachSim lists what to check.',
        ),
      },
      {
        heading: L('Định dạng đóng', 'Closed formats'),
        body: L(
          'Một số chương trình lưu sơ đồ bằng định dạng nhị phân không công bố (.ms14 và cũ hơn, .dsn, .utsch, .msmx …). MachSim không đọc trực tiếp được; khi bạn mở những tệp đó, MachSim chỉ cách xuất netlist SPICE hoặc EDIF từ chương trình gốc để đưa sang.',
          'Some programs store schematics in unpublished binary formats (.ms14 and older, .dsn, .utsch, .msmx …). MachSim cannot read them directly; when you open one, MachSim explains how to export a SPICE netlist or EDIF from the original program and bring that in.',
        ),
      },
      {
        heading: L('Mẫu và gói dự án', 'Templates and packed projects'),
        body: L(
          'Tệp > Xuất mẫu ra tệp lưu cài đặt (khổ giấy, khung tên, phân tích …) và nếu muốn cả nội dung thành tệp .msimtpl; Tệp > Thiết kế mới từ tệp mẫu mở lại trên máy khác. Đóng gói dự án (.msimpack) mang theo mọi thiết kế, tệp đính kèm và linh kiện người dùng mà thiết kế dùng; khi giải nén, MachSim hỏi có thêm các linh kiện đó vào cơ sở dữ liệu Người dùng không.',
          'File > Export template to file saves the settings (paper, title block, analyses …) and optionally the content as a .msimtpl file; File > New from template file opens it on another computer. A packed project (.msimpack) carries every design, attached file and the user components the designs use; when unpacking, MachSim asks whether to add those components to the User database.',
        ),
      },
    ],
  },
  measurements: {
    title: L('Dữ liệu đo trong Grapher', 'Measurement data in the Grapher'),
    sections: [
      {
        heading: L('So sánh mô phỏng với phép đo thật', 'Compare simulation with real measurements'),
        body: L(
          'Mô phỏng > Nhập dữ liệu đo vào Grapher (hoặc nút “Nhập dữ liệu đo…” trong Grapher) đọc tệp CSV / TXT của dao động ký, bảng tính hay chương trình khác: cột đầu là thời gian, tần số hoặc giá trị quét, các cột sau là các đường. Dấu phẩy, chấm phẩy, Tab hay khoảng trắng đều được; dấu phẩy thập phân kiểu Việt (1,5) đọc được khi cột ngăn bằng chấm phẩy hoặc Tab. Đơn vị trong tiêu đề cột (“Time (us)”, “CH1 [mV]”) được đổi về đơn vị gốc. Dữ liệu thành một trang Grapher, vẽ chồng được với kết quả mô phỏng (nút Vẽ chồng).',
          'Simulate > Import measurement into Grapher (or the “Import measurement…” button in the Grapher) reads CSV / TXT files from oscilloscopes, spreadsheets or other programs: the first column is time, frequency or a swept value, the next columns are traces. Commas, semicolons, tabs or spaces all work; a decimal comma (1,5) is read when the columns are separated by semicolons or tabs. Units in the column headers (“Time (us)”, “CH1 [mV]”) are converted to base units. The data becomes a Grapher page that you can overlay on simulation results (Overlay button).',
        ),
      },
      {
        heading: L('Giữ trang Grapher trong tệp', 'Keep Grapher pages in the file'),
        body: L(
          'Bật “Lưu vào tệp” trong Grapher để các trang (kết quả mô phỏng và dữ liệu đo đã nhập, kèm thuộc tính trang và đường) được lưu trong tệp .msim; lần sau mở tệp, chúng hiện lại trong Grapher. Mỗi đường giữ tối đa 5 000 điểm (lấy mẫu đều, giữ mọi sườn của tín hiệu số), tối đa 10 lần chạy gần nhất.',
          'Turn on “Keep in file” in the Grapher to save the pages (simulation results and imported measurements, with page and trace properties) in the .msim file; they appear in the Grapher again the next time the file is opened. Each trace keeps at most 5,000 points (evenly sampled, every edge of digital signals kept), at most the 10 latest runs.',
        ),
      },
    ],
  },
  lessons: {
    title: L('Bài học có hướng dẫn', 'Guided lessons'),
    sections: [
      {
        heading: L('Học bằng cách làm', 'Learn by doing'),
        body: L(
          'Trợ giúp > Bài học có hướng dẫn (hoặc nút “Bài học” trên thanh công cụ) mở 20 bài từ định luật Ohm tới ADC / DAC. Mỗi bài có mục tiêu, lý thuyết ngắn có công thức, các bước làm trên sơ đồ và câu hỏi ôn tập. Bấm “Bắt đầu bài” để mở trang sơ đồ của bài (có mạch mẫu nếu bài cần).',
          'Help > Guided lessons (or the “Lessons” toolbar button) opens 20 lessons from Ohm’s law to ADC / DAC. Each has a goal, short theory with formulas, steps you do on the schematic and a quiz. Click “Start the lesson” to open the lesson’s sheet (with a starter circuit when the lesson needs one).',
        ),
      },
      {
        heading: L('Tự kiểm tra', 'Automatic checks'),
        body: L(
          'MachSim kiểm tra từng bước ngay khi bạn sửa sơ đồ: đã đặt đúng linh kiện chưa, đã nối đúng chưa, và — sau một chút — mô phỏng mạch để xem giá trị đo có nằm trong dung sai không. Dưới mỗi bước là lời nhận xét (ví dụ “Đo được 4.21 V; cần 4.00 V ± 3 %”). Bước đã đạt được giữ nguyên khi bạn sửa mạch cho bước sau. “Gợi ý” cho từng bước, “Xem lời giải” mở mạch đáp án. Nút EN / VI đổi ngôn ngữ của bài học.',
          'MachSim checks each step as you edit: the right parts placed, the right connections and — after a short pause — a simulation to see whether the measured value is within tolerance. Each step shows feedback (e.g. “Measured 4.21 V; 4.00 V ± 3 % needed”). A passed step stays passed while you change the circuit for the next one. “Hint” helps with a step, “Show the solution” opens the answer circuit. The EN / VI button switches the lesson language.',
        ),
      },
    ],
  },
  description: {
    title: L('Hộp mô tả và câu hỏi', 'Description box and questions'),
    sections: [
      {
        heading: L('Viết hướng dẫn cho bài tập', 'Write the exercise instructions'),
        body: L(
          'Công cụ > Hộp mô tả mở hộp mô tả của thiết kế. Bấm “Sửa” và viết bằng cú pháp gọn: # tiêu đề, **đậm**, *nghiêng*, - danh sách, > ghi chú, công thức $U = I \\cdot R$ hoặc $$\\frac{R_2}{R_1 + R_2}$$ (x^2, R_1, \\Omega, \\sqrt{x} …). “Chèn hình…” thêm ảnh vào tệp. Đánh dấu “Tự mở hộp mô tả khi mở tệp” để học viên thấy ngay.',
          'Tools > Description box opens the design’s description box. Click “Edit” and write in a short markup: # heading, **bold**, *italic*, - list, > note, formulas $V = I \\cdot R$ or $$\\frac{R_2}{R_1 + R_2}$$ (x^2, R_1, \\Omega, \\sqrt{x} …). “Picture…” embeds an image in the file. Tick “Open the description box when the file opens” so students see it at once.',
        ),
      },
      {
        heading: L('Câu hỏi cho học viên', 'Questions for students'),
        body: L(
          'Thêm câu hỏi trắc nghiệm, câu hỏi số (có dung sai, ví dụ 4.7k ± 5 %; học viên gõ được “4,7k”) hoặc câu trả lời ngắn (nhiều đáp án ngăn bằng |, không phân biệt dấu). Câu trả lời của học viên được lưu trong tệp .msim để nộp; nút “Kiểm tra” chấm ngay và hiện lời giải thích.',
          'Add multiple-choice questions, number questions (with a tolerance, e.g. 4.7k ± 5 %; students may type “4,7k”) or short answers (several accepted answers separated by |, accents ignored). Students’ answers are saved in the .msim file to hand in; “Check” grades them at once and shows the explanation.',
        ),
      },
    ],
  },
  instructor: {
    title: L('Chế độ giảng viên', 'Instructor mode'),
    sections: [
      {
        heading: L('Giới hạn có mật khẩu', 'Password-protected restrictions'),
        body: L(
          'Tuỳ chọn > Chế độ giảng viên: đặt mật khẩu rồi chọn giới hạn — ẩn giá trị linh kiện (học viên phải đo), khoá các linh kiện đang có, tắt một số phép phân tích hoặc thiết bị đo, khoá hộp mô tả, không cho tự kiểm tra đáp án. Lưu tệp và phát cho học viên. Muốn sửa hay gỡ giới hạn, mở lại hộp thoại và nhập mật khẩu.',
          'Options > Instructor mode: choose a password, then the restrictions — hide part values (students must measure), lock the parts placed now, disable some analyses or instruments, lock the description box, stop students from checking their answers. Save the file and hand it out. To change or remove the restrictions, open the dialog again and enter the password.',
        ),
      },
      {
        heading: L('Mật khẩu được lưu thế nào', 'How the password is kept'),
        body: L(
          'Tệp chỉ lưu mã băm PBKDF2-SHA-256 có muối của mật khẩu, không lưu mật khẩu. Đây là công cụ cho lớp học: người sửa tay nội dung JSON của tệp vẫn có thể gỡ giới hạn, và đáp án câu hỏi nằm trong tệp.',
          'The file keeps only a salted PBKDF2-SHA-256 hash of the password, never the password. It is a classroom aid: someone editing the file’s JSON by hand can still remove the restrictions, and the question answers are in the file.',
        ),
      },
    ],
  },
  reports: {
    title: L('Báo cáo', 'Reports'),
    sections: [
      {
        heading: L('Các báo cáo', 'The reports'),
        body: L(
          'Menu Báo cáo: danh sách vật tư (có nhà sản xuất, mã linh kiện, dung sai, vỏ), chi tiết linh kiện (mọi tham số, chân và net), dữ liệu mô hình (.model / .subckt và linh kiện dùng chúng), cổng còn trống của IC nhiều cổng, tham chiếu chéo (trang và ô bản vẽ của mỗi linh kiện, các chân của mỗi net) và thống kê sơ đồ. Nhà sản xuất, mã linh kiện và vỏ của từng linh kiện đặt trong Thuộc tính > BOM / mạch in.',
          'The Reports menu: bill of materials (with manufacturer, part number, tolerance, footprint), component detail (every parameter, pin and net), model data (.model / .subckt cards and the parts using them), spare gates of multi-gate ICs, cross-reference (sheet and drawing zone of each part, the pins of each net) and schematic statistics. Set each part’s manufacturer, part number and footprint in Properties > BOM / PCB.',
        ),
      },
      {
        heading: L('Xuất và in', 'Export and print'),
        body: L('Mỗi báo cáo xuất được thành CSV (mở bằng Excel / LibreOffice), trang HTML, hoặc in (chọn “Lưu thành PDF” trong hộp thoại in để có tệp PDF).', 'Every report exports to CSV (Excel / LibreOffice), to an HTML page, or prints (choose “Save as PDF” in the print dialog for a PDF).'),
      },
    ],
  },
  pcb: {
    title: L('Chuyển sang mạch in', 'Transfer to PCB'),
    sections: [
      {
        heading: L('Netlist cho phần mềm mạch in', 'Netlists for PCB software'),
        body: L(
          'Tệp > Chuyển sang mạch in > Xuất netlist KiCad tạo tệp .net (định dạng netlist của KiCad) với ký hiệu, giá trị, vỏ (footprint) và các net; “Xuất netlist CSV” tạo danh sách chân dùng được cho phần mềm khác. Chỉ linh kiện thật được chuyển (không có nguồn lý tưởng, thiết bị đo, ký hiệu nguồn). Đất được đặt tên GND.',
          'File > Transfer to PCB > Export KiCad netlist writes a .net file (KiCad’s netlist format) with references, values, footprints and nets; “Export CSV netlist” writes a pin list for other tools. Only physical parts are transferred (no ideal sources, instruments or power symbols). Ground is named GND.',
        ),
      },
      {
        heading: L('Chú thích xuôi và ngược', 'Forward and back annotation'),
        body: L(
          'Chú thích xuôi so sánh sơ đồ với netlist đã xuất lần trước và ghi các thay đổi (đổi ký hiệu, giá trị, vỏ, thêm / bớt linh kiện, chân đổi net) thành tệp văn bản. Chú thích ngược đọc tệp từ phần mềm mạch in — dòng “rename R1 R5”, “value R2 4.7k”, “footprint C1 0805” hoặc cặp “R1 R5” — cho xem trước rồi áp dụng vào sơ đồ trong một bước hoàn tác.',
          'Forward annotation compares the schematic with the netlist exported last time and writes the changes (renamed, re-valued or re-packaged parts, added / removed parts, pins on other nets) to a text file. Back annotation reads a file from the PCB tool — lines “rename R1 R5”, “value R2 4.7k”, “footprint C1 0805” or pairs “R1 R5” — previews it and applies it to the schematic as one undo step.',
        ),
      },
    ],
  },
  spiceImport: {
    title: L('Nhập SPICE thành sơ đồ', 'Import SPICE as a schematic'),
    sections: [
      {
        heading: L('Từ netlist tới bản vẽ', 'From netlist to drawing'),
        body: L(
          'Tệp > Nhập SPICE thành sơ đồ đọc một netlist SPICE / PSpice, đặt linh kiện thành cột theo đường đi tín hiệu từ nguồn, tự nối dây (đất bằng ký hiệu đất; net nhiều nhánh hoặc khó đi dây bằng nhãn net) và giữ tên nút của tệp làm nhãn net. Điện trở, tụ, cuộn cảm, nguồn, diode, transistor dùng linh kiện thư viện với mô hình .model của tệp; mạch con .subckt và phần tử đặc biệt thành “khối SPICE” mô phỏng y như tệp gốc.',
          'File > Import SPICE as schematic reads a SPICE / PSpice netlist, places the parts in columns along the signal path from the sources, routes the wires (ground through ground symbols; large or hard-to-route nets through net labels) and keeps the file’s node names as net labels. Resistors, capacitors, inductors, sources, diodes and transistors become library parts using the file’s .model cards; .subckt instances and special elements become “SPICE blocks” that simulate exactly like the original.',
        ),
      },
      {
        heading: L('Tệp đi kèm', 'Included files'),
        body: L(
          'Trên máy tính, các tệp .include / .lib được đọc ngay cạnh tệp netlist. Trong trình duyệt, MachSim hỏi bạn chọn từng tệp. Các thẻ chỉ có trong PSpice (.ALIASES, .STMLIB …) được bỏ qua kèm ghi chú.',
          'On the desktop, .include / .lib files are read next to the netlist. In the browser, MachSim asks you to pick each one. PSpice-only cards (.ALIASES, .STMLIB …) are skipped with a note.',
        ),
      },
    ],
  },
  commandLine: {
    title: L('Dòng lệnh và chạy hàng loạt', 'Command line and batch runs'),
    sections: [
      {
        heading: L('Chạy không cần giao diện', 'Run without the window'),
        body: L(
          'Bản desktop chạy được mô phỏng từ dòng lệnh (cmd, PowerShell, tệp .bat): mở thiết kế .msim hoặc netlist SPICE, chạy một phép phân tích và ghi kết quả ra tệp CSV, văn bản đo lường MachSim hoặc JSON. Không cửa sổ nào hiện ra; mã thoát là 0 khi thành công, 1 khi mô phỏng hoặc ERC lỗi, 2 khi sai tham số, 3 khi không đọc / ghi được tệp.',
          'The desktop app can simulate from the command line (cmd, PowerShell, .bat files): open a .msim design or a SPICE netlist, run an analysis and write the results to CSV, MachSim measurement text or JSON. No window appears; the exit code is 0 on success, 1 for a simulation or ERC error, 2 for bad arguments, 3 when a file cannot be read or written.',
        ),
      },
      {
        heading: L('Các tham số', 'Options'),
        body: L(
          '--batch <tệp> (bắt buộc): thiết kế .msim hoặc netlist .cir / .sp. --analysis <loại>: op, tran, ac, dc, … (mặc định: phép phân tích đang chọn của thiết kế, hoặc các phép phân tích của netlist). --out <tệp>: tệp kết quả; đuôi .csv, .txt (văn bản đo lường) hoặc .json chọn định dạng (hoặc --format csv|text|json). --tstop, --tstep: đổi thời gian của phép quá độ. --set TÊN=GIÁ_TRỊ: đổi một biến toàn cục của thiết kế. --netlist <tệp>: ghi thêm netlist SPICE. --erc: chỉ kiểm tra quy tắc điện. --log <tệp>: ghi nhật ký. --help: in hướng dẫn.',
          '--batch <file> (required): a .msim design or a .cir / .sp netlist. --analysis <type>: op, tran, ac, dc, … (default: the design’s active analysis, or the netlist’s analyses). --out <file>: the result file; the .csv, .txt (measurement text) or .json extension picks the format (or --format csv|text|json). --tstop, --tstep: change the transient times. --set NAME=VALUE: change a global variable of the design. --netlist <file>: also write the SPICE netlist. --erc: run the electrical rules check only. --log <file>: write a log. --help: print the usage.',
        ),
      },
    ],
    code: [
      'MachSim.exe --batch mach.msim --analysis tran --out ketqua.csv',
      'MachSim.exe --batch loc.cir --out bode.csv',
      'MachSim.exe --batch mach.msim --analysis dc --set R=4.7k --out quet.json',
      'MachSim.exe --batch mach.msim --erc --log erc.txt',
      'MachSim.exe --script gain.js ketqua.csv',
    ],
  },
};

// the exchange-formats round adds sections to the pages of the same id (KiCad libraries, the system clipboard, TDMS)
for (const [id, extra] of Object.entries(XCHG_GUIDE_SECTIONS)) GUIDE_PAGES[id as GuidePageId].sections.push(...(extra ?? []));
