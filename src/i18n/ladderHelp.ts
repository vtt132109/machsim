/**
 * Help texts of the ladder diagram and the mechatronics models: the two guide pages, the "What is
 * this?" pages of the PLC rack and Mechatronics families and the F1 page of every part of them.
 * Merged into GUIDE_PAGES (helpGuides.ts), FAMILY_HELP (catalogHelp.ts) and PART_HELP
 * (partHelp.ts); loaded with the help dialog. Original text.
 */
import { L } from './core';
import type { GuidePage } from './helpGuides';
import type { HelpEntry } from './help';

export const LADDER_GUIDE_PAGES: Record<'ladder' | 'mecha', GuidePage> = {
  ladder: {
    title: L('Sơ đồ bậc thang: lập trình điều khiển như vẽ mạch rơ-le', 'Ladder diagrams: programming control like drawing relay circuits'),
    sections: [
      {
        heading: L('Bậc thang là gì', 'What a ladder diagram is'),
        body: L(
          'Sơ đồ bậc thang (ladder diagram) là cách viết chương trình điều khiển bằng hình vẽ giống mạch rơ-le: hai ray dọc là “nguồn”, mỗi bậc ngang đi từ ray trái qua các tiếp điểm tới cuộn dây ở ray phải. Tiếp điểm nối tiếp nhau là phép VÀ (cả hai phải đóng), tiếp điểm xếp trên nhau là phép HOẶC (một cái đóng là đủ). Bộ điều khiển lặp đi lặp lại một vòng quét: đọc ngõ vào → chạy lần lượt từng bậc từ trên xuống → ghi ngõ ra. Vì thế thứ tự các bậc có ý nghĩa: cuộn dây đặt ở bậc 1 đã có giá trị mới khi bậc 2 đọc nó.',
          'A ladder diagram is a way of writing a control program as a picture of a relay circuit: the two vertical rails are the “supply”, and each horizontal rung runs from the left rail through the contacts to a coil on the right rail. Contacts one after another are an AND (both must be closed), contacts stacked over each other are an OR (one of them closed is enough). The controller repeats one scan over and over: read the inputs → run the rungs top to bottom → write the outputs. The order of the rungs therefore matters: a coil set in rung 1 already has its new value when rung 2 reads it.',
        ),
      },
      {
        heading: L('Thêm một trang bậc thang và một giá PLC', 'Adding a ladder sheet and a PLC rack'),
        body: L(
          'Đặt › Trang sơ đồ bậc thang thêm một trang mới cạnh các trang mạch (thanh thẻ ở trên khung vẽ). Trang bậc thang không chứa linh kiện: nó chỉ chứa các bậc. Chỗ nối với mạch là “giá PLC” đặt trên trang mạch, trong thư viện nhóm “Số linh tinh”, họ “Giá PLC”: Bộ điều khiển PLC (giữ chu kỳ quét), Mô-đun vào 4 / 8 kênh, Mô-đun ra 4 / 8 kênh và Mô-đun vào tương tự 2 kênh. Nối công tắc, nút nhấn, cảm biến vào chân kênh của mô-đun vào; nối đèn, cuộn dây rơ-le, động cơ hay một mô hình cơ điện tử vào chân kênh của mô-đun ra. Chân COM của mọi mô-đun phải nối cùng một net 0 V — đó là dây chung của cả giá.',
          'Place › Ladder sheet adds a new sheet next to the schematic sheets (the tab strip above the drawing). A ladder sheet holds no parts: it holds rungs. The connection to the circuit is the “PLC rack” placed on a schematic sheet — in the library, Misc digital group, “PLC rack” family: PLC controller (which holds the scan period), input modules with 4 or 8 channels, output modules with 4 or 8 channels and a 2-channel analog input module. Wire switches, push-buttons and sensors to the channel pins of an input module; wire lamps, relay coils, motors or a mechatronics model to the channel pins of an output module. The COM pin of every module must be on the same 0 V net — that is the common of the rack.',
        ),
      },
      {
        heading: L('Địa chỉ', 'Addresses'),
        body: L(
          'Mỗi kênh có một địa chỉ, và chương trình chỉ nói chuyện với mạch qua các địa chỉ đó: I0.0 … I7.7 là ngõ vào (kênh k của mô-đun vào có “byte địa chỉ” b là I<b>.k), Q0.0 … Q7.7 là ngõ ra, M0.0 … M15.7 là bit nhớ trong (không có chân, dùng để ghi trạng thái trung gian), T1 … T32 là bit “xong” của bộ định thời, C1 … C32 là bit “xong” của bộ đếm, AI0 … AI7 là kênh tương tự (đơn vị vôn). Trong tiếp điểm so sánh còn dùng được T1.ET (thời gian bộ định thời đã đếm, giây) và C1.CV (giá trị hiện tại của bộ đếm).',
          'Every channel has an address, and the program only talks to the circuit through those addresses: I0.0 … I7.7 are inputs (channel k of an input module with address byte b is I<b>.k), Q0.0 … Q7.7 are outputs, M0.0 … M15.7 are internal memory bits (no pins — they hold intermediate states), T1 … T32 are the done bits of the timers, C1 … C32 the done bits of the counters, and AI0 … AI7 are the analog channels (in volts). A comparison contact may also read T1.ET (the elapsed time of a timer, in seconds) and C1.CV (the present value of a counter).',
        ),
      },
      {
        heading: L('Vẽ một bậc', 'Drawing a rung'),
        body: L(
          'Nhấn “Thêm bậc” rồi nhấp vào một tiếp điểm để chọn nó. “Nối tiếp” thêm một tiếp điểm bên phải phần tử đang chọn (phép VÀ), “Song song” thêm một nhánh bên dưới (phép HOẶC), “So sánh” thêm tiếp điểm so sánh hai số. Ô dưới cùng cho sửa loại tiếp điểm và địa chỉ: Thường mở (đóng khi bit = 1), Thường đóng (đóng khi bit = 0), Sườn lên và Sườn xuống (đóng đúng MỘT vòng quét khi bit đổi mức — dùng để đếm và để “nhấn một lần làm một việc”). Cuộn dây có các loại: cuộn dây thường, cuộn dây đảo, Đặt (S) và Xoá (R) giữ trạng thái, TON (trễ đóng) và TOF (trễ mở) cho thời gian, CTU / CTD / RES cho bộ đếm. Ghi chú của bậc nên viết bằng lời: đó là phần làm chương trình dễ đọc lại nhất.',
          'Press “Add rung”, then click a contact to select it. “In series” adds a contact to the right of the selected element (an AND), “In parallel” adds a branch below it (an OR), and “Comparison” adds a contact that compares two numbers. The strip at the bottom edits the kind and the address: normally open (closed while the bit is 1), normally closed (closed while the bit is 0), rising edge and falling edge (closed for exactly ONE scan when the bit changes — for counting, and for “one press does one thing”). The coil kinds are: plain coil, inverted coil, Set (S) and Reset (R) which hold their state, TON (on-delay) and TOF (off-delay) for time, and CTU / CTD / RES for counting. Write the rung comment in words: it is what makes a program readable later.',
        ),
      },
      {
        heading: L('Tự giữ: bài toán khởi động / dừng', 'Self-holding: the start / stop problem'),
        body: L(
          'Một nút nhấn chỉ đóng trong lúc được nhấn, nên bậc “Nút khởi động → cuộn dây động cơ” làm động cơ chỉ chạy khi còn giữ nút. Cách làm đúng là tự giữ: song song với tiếp điểm của nút khởi động, thêm một tiếp điểm thường mở của CHÍNH cuộn dây (Q0.0), rồi nối tiếp cả nhóm đó với tiếp điểm thường đóng của nút dừng. Đọc ra lời: “(khởi động HOẶC đang chạy) VÀ không dừng → chạy”. Nút dừng trong tủ điện thật là tiếp điểm thường đóng, nên trong chương trình nó là tiếp điểm thường MỞ — mẫu “Khởi động / dừng động cơ” nói rõ chỗ dễ nhầm này.',
          'A push-button is only closed while it is pressed, so the rung “start button → motor coil” runs the motor only while the finger is on the button. The right answer is self-holding: in parallel with the start contact, add a normally-open contact of the coil ITSELF (Q0.0), and put that group in series with a normally-closed contact of the stop button. Read it out loud: “(start OR already running) AND not stopped → run”. A real stop button in a cabinet is a normally-closed contact, so in the program it becomes a normally-OPEN contact — the sample “Motor start / stop” explains that trap.',
        ),
      },
      {
        heading: L('Bộ định thời và bộ đếm', 'Timers and counters'),
        body: L(
          'TON (trễ đóng): khi bậc có điện, bộ định thời bắt đầu đếm; đúng “đặt trước” giây sau, bit T<n> lên 1. Bậc mất điện thì nó về 0 ngay. TOF (trễ mở): bit lên 1 cùng với bậc và chỉ về 0 sau “đặt trước” giây kể từ lúc bậc mất điện. Muốn làm đèn nhấp nháy hay chuỗi đèn giao thông, dùng một bộ định thời cho mỗi pha và so sánh T1.ET với các mốc thời gian. CTU đếm lên một đơn vị mỗi lần bậc chuyển từ mất điện sang có điện (nên hãy dùng tiếp điểm sườn lên nếu tín hiệu giữ lâu), xong khi đạt “đặt trước”; CTD đếm xuống từ “đặt trước” và xong khi tới 0; RES đưa bộ đếm về giá trị đầu. Độ phân giải thời gian bằng một vòng quét (mặc định 10 ms) — bộ điều khiển thật cũng vậy.',
          'TON (on-delay): when the rung carries power the timer starts; exactly “preset” seconds later the bit T<n> goes 1. A rung that drops out clears it at once. TOF (off-delay): the bit follows the rung up immediately and only falls “preset” seconds after the rung went false. For a flashing lamp or a traffic-light sequence, use one timer per phase and compare T1.ET with the switch-over times. CTU counts up by one every time the rung goes from false to true (so use a rising-edge contact if the signal stays on), and is done when it reaches the preset; CTD counts down from the preset and is done at 0; RES puts a counter back to its starting value. The time resolution is one scan (10 ms by default) — the same trade-off a real controller makes.',
        ),
      },
      {
        heading: L('Chạy và xem chương trình chạy', 'Running the program and watching it run'),
        body: L(
          'Nhấn Chạy như với mọi mạch khác. Trên trang bậc thang, tiếp điểm nào đang dẫn và cuộn dây nào đang có điện được tô sáng, và dải dưới cùng hiện số vòng quét, các byte ảnh vào / ra / bit nhớ, thời gian của từng bộ định thời và giá trị từng bộ đếm. Trên trang mạch, đèn sáng và các mô hình cơ điện tử chuyển động theo. Muốn xem dạng sóng, đặt đầu dò lên chân kênh như thường; mỗi byte ảnh cũng là một biến kết quả nên vẽ được trong Grapher.',
          'Press Run as for any other circuit. On the ladder sheet the contacts that conduct and the coils that carry power light up, and the strip at the bottom shows the number of scans, the input / output / memory image bytes, the elapsed time of every timer and the value of every counter. On the schematic the lamps light and the mechatronics models move. For waveforms, put a probe on a channel pin as usual; every image byte is also a result vector, so it can be plotted in the Grapher.',
        ),
      },
      {
        heading: L('Lệnh số: chuyển, cộng, trừ, nhân, chia', 'Word instructions: move, add, subtract, multiply, divide'),
        body: L(
          'Ngoài bit, chương trình còn tính với số. MW0 … MW31 là các “từ nhớ”: số nguyên 16 bit có dấu (−32768 … 32767; kết quả vượt quá thì quay vòng như thanh ghi thật, ví dụ 300 × 200 = 60000 thành −5536). AQ0 … AQ3 là ngõ ra tương tự tính bằng vôn. Cuộn dây loại MOV, ADD, SUB, MUL, DIV vẽ thành một ô: đích = A (+ − × ÷) B, với A và B là một số, MWn, AIn, AQn, T1.ET hay C1.CV. Phép chia vào từ nhớ cắt phần thập phân (7 ÷ 2 = 3); chia cho 0 không ghi gì và bộ đếm “chia cho 0” trong dải trạng thái tăng lên. Các lệnh chạy MỖI vòng quét khi bậc có điện — muốn “mỗi lần nhấn cộng 1” hãy đặt tiếp điểm sườn lên trước lệnh ADD MW0 = MW0 + 1. Tiếp điểm so sánh đọc được từ nhớ: “MW0 ≥ 10”.',
          'Besides bits, a program can calculate. MW0 … MW31 are “memory words”: signed 16-bit integers (−32768 … 32767; a result outside that range wraps round like a real register, so 300 × 200 = 60000 becomes −5536). AQ0 … AQ3 are analog outputs in volts. The MOV, ADD, SUB, MUL and DIV coil kinds are drawn as a box: destination = A (+ − × ÷) B, where A and B are a number, MWn, AIn, AQn, T1.ET or C1.CV. A division into a word drops the fraction (7 ÷ 2 = 3); dividing by 0 writes nothing and counts in the “division by 0” counter of the status strip. These instructions run on EVERY scan while the rung carries power — for “add 1 per press” put a rising-edge contact in front of ADD MW0 = MW0 + 1. A comparison contact can read words: “MW0 ≥ 10”.',
        ),
      },
      {
        heading: L('Ngõ ra tương tự (AQ)', 'Analog outputs (AQ)'),
        body: L(
          'Mô-đun “Ra tương tự PLC 2 kênh” (nhóm Số linh tinh, họ Giá PLC) đưa chân AQ0, AQ1 lên đúng điện áp chương trình vừa ghi: “MUL AQ0 = AI0 × 2” là một bộ khuếch đại hệ số 2; “MOV AQ1 = T1.ET” biến thời gian của bộ định thời thành điện áp dốc. Điện áp bị giới hạn trong ± “phạm vi ra” của mô-đun (mặc định 10 V), nên chương trình ghi 25 V thì chân vẫn chỉ ở 10 V. Chân COM nối chung 0 V như mọi mô-đun khác của giá.',
          'The “PLC analog output module, 2 channels” (Misc digital group, PLC rack family) drives its pins AQ0, AQ1 to exactly the voltage the program last wrote: “MUL AQ0 = AI0 × 2” is an amplifier with a gain of 2; “MOV AQ1 = T1.ET” turns the timer’s elapsed time into a ramp voltage. The voltage is limited to ± the module’s “output range” (10 V by default), so a program that writes 25 V still leaves the pin at 10 V. COM is the common 0 V, like every other module of the rack.',
        ),
      },
      {
        heading: L('Khối hàm do bạn viết', 'Function blocks you write'),
        body: L(
          'Một bài toán lặp lại (khởi động / dừng của ba động cơ) không cần chép ba lần. Nhấn “Khối hàm” trên thanh công cụ, “Khối mới”, đặt tên, liệt kê đầu vào (START, STOP) và đầu ra (RUN), rồi vẽ các bậc của khối ngay trong trình soạn. Trong khối: tên đầu vào / đầu ra là tham số hình thức, EN là “cho phép” (bật khi bậc gọi có điện; khi tắt, mọi cuộn dây của khối về 0 và bộ định thời về không), và tên bắt đầu bằng # là bộ nhớ riêng của từng bản thể: #chot là một bit riêng, #T1 một bộ định thời riêng, #C1 một bộ đếm riêng, #W1 một từ nhớ riêng. Hai lời gọi của một khối không bao giờ dùng chung bộ nhớ riêng. Ở bậc chương trình, đổi loại cuộn dây thành “Gọi khối hàm”, chọn khối, đặt tên bản thể (FB1, DONGCO1 …) và nối mỗi tham số với một địa chỉ thật (I0.0, Q0.1, MW3 …). Khối chạy ngay sau bậc gọi, trong cùng vòng quét. Khối được gọi tối đa lồng 4 tầng và không được tự gọi lại; đổi tên khối thì mọi lời gọi tự đổi theo.',
          'A repeated job (start / stop of three motors) does not need copying three times. Press “Function blocks” on the toolbar, “New block”, name it, list the inputs (START, STOP) and outputs (RUN), then draw the block’s rungs in the same editor. Inside a block the input / output names are the formal parameters, EN is “enable” (on while the calling rung carries power; when off, every coil of the block falls to 0 and its timers reset), and a name starting with # is memory private to each instance: #latch is a private bit, #T1 a private timer, #C1 a private counter, #W1 a private word. Two calls of one block never share their private memory. In a program rung change the coil kind to “Call function block”, pick the block, name the instance (FB1, MOTOR1 …) and tie each parameter to a real address (I0.0, Q0.1, MW3 …). The block runs right after the calling rung, in the same scan. Blocks nest up to 4 deep and may not call themselves; renaming a block renames every call.',
        ),
      },
      {
        heading: L('Sao chép, cắt, dán', 'Copy, cut and paste'),
        body: L(
          'Chọn một bậc, một tiếp điểm hay một cuộn dây rồi nhấn Sao chép / Cắt / Dán (hoặc Ctrl+C, Ctrl+X, Ctrl+V). Giữ Shift khi nhấp để chọn cả một dãy bậc liền nhau. Bậc dán vào ngay dưới bậc đang chọn và được cấp mã mới; tiếp điểm dán nối tiếp sau phần tử đang chọn (“Dán song song” đặt nó bên dưới); cuộn dây dán vào cuối bậc. Nội dung nằm cả trên clipboard của hệ thống ở dạng chữ, nên dán được sang thiết kế khác hoặc cửa sổ MachSim khác.',
          'Select a rung, a contact or a coil, then press Copy / Cut / Paste (or Ctrl+C, Ctrl+X, Ctrl+V). Hold Shift while clicking to select a whole run of rungs. A pasted rung goes right below the selected rung and gets new ids; a pasted contact goes in series after the selected element (“Paste in parallel” puts it below); a pasted coil goes at the end of the rung. The content also sits on the system clipboard as text, so it pastes into another design or another MachSim window.',
        ),
      },
      {
        heading: L('Tham chiếu chéo địa chỉ', 'Address cross-reference'),
        body: L(
          'Nhấn “Tham chiếu chéo” để xem mỗi địa chỉ được GHI ở những bậc nào và ĐỌC ở những bậc nào (cả trong khối hàm và trong lời gọi khối). Nhấn một số bậc là nhảy tới đúng bậc đó, kể cả sang trang bậc thang khác. Dấu ⚠ báo địa chỉ được đọc mà không bậc nào ghi (thường là gõ nhầm), hoặc được ghi mà không bậc nào đọc. Ngõ vào I và AI do mạch ghi, ngõ ra Q và AQ do mạch đọc, nên không bị báo. Bảng này cũng in được: Tệp › Xem trước khi in › “Bậc thang: ghi chú từng bậc và bảng tham chiếu chéo”.',
          'Press “Cross-reference” to see in which rungs each address is WRITTEN and in which it is READ (inside function blocks and in the arguments of block calls too). Clicking a rung number jumps to that rung, also on another ladder sheet. A ⚠ marks an address that is read but never written (often a typo), or written but never read. Inputs I and AI are written by the circuit and outputs Q and AQ are read by it, so they are not flagged. The table also prints: File › Print preview › “Ladder: rung comments and cross-reference”.',
        ),
      },
      {
        heading: L('Ghi chú của bậc khi in', 'Rung comments on paper'),
        body: L(
          'Ghi chú của bậc (và của từng tiếp điểm, cuộn dây nếu có) nằm trên đầu bậc, xuống nhiều dòng nếu dài, nên bản in không cắt mất chữ. Trong Xem trước khi in, mục “Bậc thang” thêm một tài liệu liệt kê ghi chú từng bậc theo trang và theo khối hàm, và các bảng tham chiếu chéo.',
          'The rung comment (and the comment of a contact or a coil, if it has one) sits above the rung and wraps onto more lines when long, so the printout never cuts words off. In the print preview the “Ladder” choice adds a document that lists the comments rung by rung, by sheet and by function block, and the cross-reference tables.',
        ),
      },
      {
        heading: L('Giới hạn hiện nay', 'What is not there yet'),
        body: L(
          'Một thiết kế có MỘT chương trình cho mỗi cấp: các bậc của mọi trang bậc thang cùng cấp nối tiếp nhau thành một chương trình, chạy trên một giá PLC. Khối hàm dùng chung cho cả thiết kế (khối đặt ở thiết kế gốc), chưa có số thực 32 bit hay chuỗi, chưa có tiếp điểm nhảy hoặc vòng lặp; trong trình soạn khối hàm chưa tô sáng bậc đang chạy (chỉ tô sáng ở chương trình chính). Chưa xuất ra ngôn ngữ PLC khác.',
          'A design has ONE program per level: the rungs of every ladder sheet of a level follow each other into one program that runs on one PLC rack. Function blocks are shared by the whole design (they live in the root design), there are no 32-bit reals or strings, and no jump or loop instructions; the block editor does not light up the running rung (only the main program does). There is no export to another PLC language.',
        ),
      },
    ],
  },
  mecha: {
    title: L('Mô hình cơ điện tử: băng tải, đèn giao thông, bồn nước, cửa cuốn, thang máy', 'Mechatronics models: belt, junction, tank, door and lift'),
    sections: [
      {
        heading: L('Vì sao cần mô hình máy', 'Why a model of the machine'),
        body: L(
          'Một chương trình điều khiển chỉ đúng khi nó được thử với cái máy nó phải điều khiển. Nhóm “Linh tinh”, họ “Cơ điện tử” có năm mô hình đặt thẳng lên sơ đồ: băng tải có cảm biến vật, nút giao thông hai chiều, bồn nước có bơm và van, cửa cuốn có công tắc hành trình, thang máy ba tầng. Mỗi mô hình có chân vào (do mạch điều khiển) và chân cảm biến (trả về cho mạch), nên bạn thử được cả chương trình bậc thang, cả mạch rơ-le, cả vi điều khiển trên cùng một mô hình.',
          'A control program is only right when it has been tried against the machine it must control. The Misc group, “Mechatronics” family, has five models you place straight on the schematic: a conveyor belt with item sensors, a two-direction traffic junction, a water tank with a pump and a valve, a garage door with limit switches and a three-floor lift. Each model has input pins (driven by the circuit) and sensor pins (read by the circuit), so the same model serves a ladder program, a relay circuit or a microcontroller.',
        ),
      },
      {
        heading: L('Cách nối', 'How to wire them'),
        body: L(
          'Chân vào là chân số: mức cao (trên ngưỡng, mặc định 12 V) là “bật”. Nối thẳng từ chân ra của mô-đun ra PLC, từ tiếp điểm rơ-le hay từ một khoá bán dẫn. Chân cảm biến tự phát ra “điện áp cảm biến” (mặc định 24 V) khi tác động và 0 V khi không, nên nối thẳng vào mô-đun vào PLC, vào cổng logic hay vào bộ so sánh. Chân LEVEL của bồn nước là ngõ ra tương tự: 0 V khi cạn tới “thang đo tương tự” khi đầy — nối vào mô-đun vào tương tự rồi so sánh trong chương trình (AI0 > 7,5). Chân COM là dây chung, để hở thì coi như nối đất.',
          'The input pins are digital: a level above the threshold (12 V by default) is “on”. Wire them straight from a PLC output channel, a relay contact or a transistor switch. A sensor pin drives the “sensor voltage” (24 V by default) when it is active and 0 V when it is not, so it goes straight into a PLC input channel, a logic gate or a comparator. The tank’s LEVEL pin is an analog output: 0 V when empty up to the “analog full scale” when full — wire it to the analog input module and compare it in the program (AI0 > 7.5). COM is the common; left open it counts as ground.',
        ),
      },
      {
        heading: L('Mỗi mô hình kiểm tra một lỗi điển hình', 'Each model catches a typical mistake'),
        body: L(
          'Nút giao thông tự kiểm tra tín hiệu: nếu hai chiều cùng xanh, hoặc một chiều không sáng đèn nào, lâu hơn “thời gian báo lỗi” thì chân ERR lên mức cao. Cửa cuốn và thang máy khoá chéo: cấp điện đồng thời cả hai chiều thì chúng đứng lại và báo thời gian bị kẹt, còn thang máy không chạy khi cửa chưa đóng kín. Cửa cuốn có mắt thần: đặt “vật xuất hiện lúc” khác 0 để thử tình huống có người đi qua khi cửa đang đóng — cửa phải tự mở lại. Băng tải không cho hai vật nằm chồng nhau và đếm số vật rơi khỏi đầu băng.',
          'The junction checks its own signals: if both directions show green, or a direction shows no lamp at all, for longer than the fault time, the ERR pin goes high. The door and the lift are interlocked: energising both directions at once stops them and counts the jammed time, and the lift does not move while its door is not fully closed. The door has a light barrier: set “obstacle appears at” to something other than 0 to try what happens when someone walks through a closing door — it must reverse. The belt never puts two items on top of each other and counts the ones that fall off the end.',
        ),
      },
      {
        heading: L('Xem và vẽ trạng thái', 'Watching and plotting the state'),
        body: L(
          'Trong lúc mô phỏng, hình trên sơ đồ chuyển động: vật chạy trên băng, nước dâng trong bồn, đèn sáng, cánh cửa và cabin di chuyển. Thẻ Mô phỏng ở khung dưới hiện một dòng chữ cho mỗi máy (mức nước, số vật, tầng…). Trạng thái cũng nằm trên các nút nội bộ của linh kiện nên vẽ được trong Grapher: V(TK1.percent) là mức nước theo phần trăm, V(MD1.pos) là độ mở của cửa, V(ML1.floor) là vị trí cabin, V(MB1.travel) là đoạn đường băng tải đã chạy (mét).',
          'While the simulation runs the drawing moves: items travel on the belt, the water rises in the tank, lamps light, the door leaf and the lift car move. The Simulation tab in the bottom dock shows one line per machine (level, items, floor …). The state also lives on internal nodes of the part, so it can be plotted in the Grapher: V(TK1.percent) is the level in percent, V(MD1.pos) the opening of the door, V(ML1.floor) the position of the car and V(MB1.travel) the distance the belt has run, in metres.',
        ),
      },
      {
        heading: L('Giới hạn', 'What they are not'),
        body: L(
          'Đây là mô hình để học điều khiển, không phải mô phỏng cơ khí: băng tải chạy đúng tốc độ đặt (không có quán tính), cửa và cabin đi với tốc độ không đổi (không có gia tốc), bồn nước xả theo định luật Torricelli nhưng không tính nhiệt độ hay áp suất. Động cơ không lấy điện thật từ mạch (chân vào chỉ là tín hiệu có tải nhỏ): muốn tính dòng và công suất, hãy nối thêm động cơ hoặc tải thật song song.',
          'These are models for learning control, not mechanical simulations: the belt runs at exactly its set speed (no inertia), the door and the car travel at constant speed (no acceleration), and the tank drains by Torricelli’s law but knows nothing about temperature or pressure. The motors do not take real power from the circuit (an input pin is a signal with a small load): to study current and power, wire a real motor or load in parallel.',
        ),
      },
    ],
  },
};

export const LADDER_FAMILY_HELP: Record<string, HelpEntry> = {
  'PLC rack': {
    what: L('Giá của bộ điều khiển lập trình: bộ điều khiển và các mô-đun vào / ra nối chương trình bậc thang với mạch trên sơ đồ.', 'The rack of a programmable controller: the controller and the input / output modules that join a ladder program to the circuit on the schematic.'),
    use: L('Học điều khiển tự động: khởi động / dừng động cơ, đèn giao thông, điều khiển mức nước, băng tải đếm sản phẩm.', 'Learning automation: motor start / stop, traffic lights, level control, a belt counting products.'),
    read: L('Mỗi kênh có một địa chỉ (I0.0, Q0.0, AI0) in ngay cạnh chân. Chương trình nằm ở trang sơ đồ bậc thang (Đặt › Trang sơ đồ bậc thang) và chạy khi bạn nhấn Chạy.', 'Every channel has an address (I0.0, Q0.0, AI0) printed next to the pin. The program lives on a ladder sheet (Place › Ladder sheet) and runs when you press Run.'),
    tip: L('Chân COM của mọi mô-đun phải cùng một net 0 V. Đặt một Bộ điều khiển PLC để chu kỳ quét được lưu trong tệp.', 'The COM pin of every module must be on the same 0 V net. Place a PLC controller so the scan period is saved with the file.'),
  },
  Mechatronics: {
    what: L('Mô hình máy đặt trên sơ đồ: băng tải, nút giao thông, bồn nước, cửa cuốn, thang máy. Mạch điều khiển chúng qua chân vào và đọc lại qua chân cảm biến.', 'Models of machines placed on the schematic: a conveyor belt, a traffic junction, a water tank, a garage door and a lift. The circuit drives them through their input pins and reads them back on their sensor pins.'),
    use: L('Thử một chương trình điều khiển (bậc thang, rơ-le hay vi điều khiển) với chính cái máy nó phải điều khiển.', 'Try a control program (ladder, relays or a microcontroller) against the machine it has to control.'),
    read: L('Hình trên sơ đồ chuyển động trong lúc mô phỏng; trạng thái cũng có trên các nút nội bộ để vẽ trong Grapher (V(TK1.percent), V(MD1.pos)…).', 'The drawing moves while the simulation runs; the state is also on internal nodes for the Grapher (V(TK1.percent), V(MD1.pos) …).'),
    tip: L('Các mô hình tự phát hiện lỗi điều khiển kinh điển: hai chiều cùng xanh, cấp điện hai chiều cùng lúc, cabin chạy khi cửa còn mở.', 'The models catch the classic control mistakes by themselves: green in both directions, both contactors energised at once, a car moving with its door open.'),
  },
};

const addressNote = L(
  'Kênh k của mô-đun có “byte địa chỉ” b mang địa chỉ b.k, in ngay cạnh chân.',
  'Channel k of a module with address byte b has the address b.k, printed next to the pin.',
);

export const LADDER_PART_HELP: Record<string, HelpEntry> = {
  'misc-digital/plc-controller': {
    what: L('Bộ điều khiển lập trình: chạy lần lượt các bậc của mọi trang bậc thang, lặp lại mãi, theo chu kỳ quét đặt ở đây.', 'The programmable controller: it runs the rungs of every ladder sheet, one after another, over and over, at the scan period set here.'),
    use: L('Đặt một cái cạnh các mô-đun vào / ra để chu kỳ quét và lựa chọn hiển thị trạng thái được lưu trong tệp.', 'Place one next to the I/O modules so the scan period and the live read-out switch are saved with the file.'),
    read: L('Không có chân nào: nó không nối vào mạch. Chu kỳ quét cũng là độ phân giải của bộ định thời — 10 ms là giá trị tốt để học.', 'It has no pins: it does not connect to the circuit. The scan period is also the resolution of the timers — 10 ms is a good value for learning.'),
    tip: L('Không đặt bộ điều khiển thì chương trình vẫn chạy với chu kỳ mặc định 10 ms.', 'Without a controller the program still runs, at the default 10 ms period.'),
  },
  'misc-digital/plc-input-8': {
    what: L('Mô-đun vào 8 kênh: tám ngõ vào số I<byte>.0 … I<byte>.7.', 'An 8-channel input module: eight digital inputs I<byte>.0 … I<byte>.7.'),
    use: L('Đưa công tắc, nút nhấn, công tắc hành trình và cảm biến số vào chương trình.', 'Bring switches, push-buttons, limit switches and digital sensors into the program.'),
    read: addressNote,
    tip: L('Kênh có điện áp trên “ngưỡng vào” là mức 1; vùng trễ quanh ngưỡng giữ cho tín hiệu chậm không rung. Kênh để hở đọc mức 0.', 'A channel above the input threshold reads 1; the hysteresis band around the threshold keeps a slow signal from chattering. An unwired channel reads 0.'),
  },
  'misc-digital/plc-output-8': {
    what: L('Mô-đun ra 8 kênh: tám ngõ ra Q<byte>.0 … Q<byte>.7, mỗi kênh đưa chân của nó lên điện áp ra khi cuộn dây tương ứng có điện.', 'An 8-channel output module: eight outputs Q<byte>.0 … Q<byte>.7, each driving its pin to the output voltage while its coil carries power.'),
    use: L('Điều khiển đèn báo, cuộn dây khởi động từ, van, động cơ hay một mô hình cơ điện tử.', 'Drive indicator lamps, contactor coils, valves, motors or a mechatronics model.'),
    read: addressNote,
    tip: L('Tải nối từ chân kênh xuống COM. Điện áp ra mặc định 24 V như tủ điện công nghiệp; đổi được trong Thuộc tính.', 'The load goes from the channel pin down to COM. The default output voltage is 24 V, as in an industrial cabinet; change it in Properties.'),
  },
  'misc-digital/plc-analog-out-2': {
    what: L('Mô-đun ra tương tự 2 kênh: AQ0 và AQ1 đưa chân của chúng lên đúng điện áp chương trình vừa ghi, tính bằng vôn.', 'A 2-channel analog output module: AQ0 and AQ1 drive their pins to the voltage the program last wrote, in volts.'),
    use: L('Điều sáng đèn, đặt tốc độ chuẩn cho động cơ hay bám theo một mức: “MUL AQ0 = AI0 × 2”.', 'Dim a lamp, set a motor speed reference or follow a level: “MUL AQ0 = AI0 × 2”.'),
    read: L('Chỉ lệnh MOV / ADD / SUB / MUL / DIV có đích AQ mới đổi điện áp; tiếp điểm so sánh đọc lại được giá trị đã ghi.', 'Only a MOV / ADD / SUB / MUL / DIV with an AQ destination changes the voltage; a comparison contact can read back the value written.'),
    tip: L('Điện áp bị giới hạn trong ± “phạm vi ra” (mặc định 10 V). Chân COM nối chung 0 V với các mô-đun khác.', 'The voltage is limited to ± the “output range” (10 V by default). COM joins the common 0 V of the other modules.'),
  },
  'misc-digital/plc-analog-in-2': {
    what: L('Mô-đun vào tương tự 2 kênh: AI0 và AI1 đọc điện áp trên chân của chúng theo vôn.', 'A 2-channel analog input module: AI0 and AI1 read the voltage on their pins in volts.'),
    use: L('Đọc cảm biến mức, nhiệt độ hay chiết áp rồi so sánh trong chương trình: “AI0 > 7,5”.', 'Read a level or temperature sensor, or a potentiometer, and compare it in the program: “AI0 > 7.5”.'),
    read: L('Chỉ tiếp điểm so sánh dùng được kênh tương tự; so với một số hay với T1.ET / C1.CV.', 'Only a comparison contact can use an analog channel; compare it with a number or with T1.ET / C1.CV.'),
    tip: L('Chân LEVEL của bồn nước cho 0 V khi cạn và “thang đo tương tự” (mặc định 10 V) khi đầy, nên AI0 > 8 là “gần đầy”.', 'The tank’s LEVEL pin gives 0 V when empty and the analog full scale (10 V by default) when full, so AI0 > 8 means “nearly full”.'),
  },
  'misc/conveyor-belt': {
    what: L('Băng tải chở vật đi qua hai cảm biến quang.', 'A conveyor belt carrying items past two photo-electric sensors.'),
    use: L('Đếm sản phẩm, dừng băng khi vật tới cuối, phân loại theo thời gian giữa hai cảm biến.', 'Count products, stop the belt when an item reaches the end, sort by the time between the two sensors.'),
    read: L('RUN cho chạy xuôi, REV chạy ngược. S1 / S2 có điện khi vật che cảm biến. Hình trên sơ đồ cho thấy vật đang ở đâu.', 'RUN runs it forward, REV backwards. S1 / S2 are on while an item covers them. The drawing shows where the items are.'),
    tip: L('Để “Cấp vật” ở chế độ tự động thì cứ sau “chu kỳ cấp vật” giây lại có một vật mới khi băng đang chạy; chọn “Từ chân FEED” nếu muốn tự điều khiển.', 'With automatic feeding a new item appears every “feed interval” seconds while the belt runs; choose “From the FEED pin” to control it yourself.'),
  },
  'misc/traffic-junction': {
    what: L('Nút giao thông hai chiều với sáu chân đèn và một chân báo lỗi tín hiệu.', 'A two-direction traffic junction with six lamp pins and one signal-fault pin.'),
    use: L('Bài tập đèn giao thông bằng bộ định thời: mỗi chân đèn là một ngõ ra của chương trình.', 'The traffic-light exercise with timers: each lamp pin is one output of the program.'),
    read: L('Đèn nào có điện thì sáng trên sơ đồ. ERN lên mức cao khi tín hiệu không an toàn lâu hơn “thời gian báo lỗi”.', 'A lamp with power lights up in the drawing. ERR goes high when the signals stay unsafe for longer than the fault time.'),
    tip: L('Nối ERR vào một đèn hay một mô-đun vào: chương trình đúng thì ERR không bao giờ sáng.', 'Wire ERR to a lamp or to an input channel: with a correct program it never comes on.'),
  },
  'misc/water-tank': {
    what: L('Bồn chất lỏng có bơm cấp, van xả, hai công tắc phao và một cảm biến mức tương tự.', 'A liquid tank with a filling pump, a drain valve, two float switches and an analog level sensor.'),
    use: L('Điều khiển mức nước hai điểm (bơm chạy tới mức cao, nghỉ tới mức thấp) hay theo ngưỡng tương tự.', 'Two-point level control (pump up to the high switch, rest until the low one) or control from the analog level.'),
    read: L('LOW và HIGH đóng khi nước cao hơn vị trí của chúng. LEVEL là 0 V … thang đo tương tự. Mức nước hiện trong hình và ở V(<tên>.percent).', 'LOW and HIGH close while the liquid stands above them. LEVEL goes from 0 V to the analog full scale. The level is in the drawing and on V(<name>.percent).'),
    tip: L('Van xả chảy theo √mức (định luật Torricelli), nên bồn đầy cạn hết sau 2·thể tích / lưu lượng xả giây.', 'The valve drains with √level (Torricelli), so a full tank empties in 2·volume / drain flow seconds.'),
  },
  'misc/garage-door': {
    what: L('Cửa cuốn có hai chân động cơ, hai công tắc hành trình và một mắt thần.', 'A garage door with two motor pins, two limit switches and a light barrier.'),
    use: L('Bài tập đảo chiều có khoá chéo và bảo vệ an toàn khi có vật chắn.', 'The reversing exercise with interlocking and the safety stop when something is in the way.'),
    read: L('OPEN / CLOSED đóng ở hai đầu hành trình, BEAM ở mức cao khi lối đi thông thoáng. Độ mở của cửa ở V(<tên>.pos).', 'OPEN / CLOSED close at the two ends of the travel, BEAM is high while the way is clear. The opening is on V(<name>.pos).'),
    tip: L('Cấp điện cả hai chiều là lỗi: cửa đứng lại và V(<tên>.jam) đếm thời gian bị kẹt.', 'Energising both directions is a mistake: the door stops and V(<name>.jam) counts the jammed time.'),
  },
  'misc/lift-3': {
    what: L('Thang máy ba tầng có cảm biến tầng và cửa.', 'A three-floor lift with floor sensors and a door.'),
    use: L('Bài tập điều khiển tuần tự: gọi tầng, khoá liên động cửa, dừng đúng tầng.', 'The sequencing exercise: calls, door interlock, stopping at the right floor.'),
    read: L('F1 / F2 / F3 đóng khi cabin ngang tầng, DOPEN khi cửa mở hết. Vị trí cabin ở V(<tên>.floor), độ mở cửa ở V(<tên>.doorpos).', 'F1 / F2 / F3 close while the car is level with that floor and DOPEN when the door is fully open. The car is on V(<name>.floor) and the door on V(<name>.doorpos).'),
    tip: L('Cabin không chạy khi cửa chưa đóng kín — hãy cho chương trình đóng cửa trước khi cấp điện động cơ.', 'The car does not move while the door is not fully closed — have the program close the door before it energises the hoist.'),
  },
};
LADDER_PART_HELP['misc-digital/plc-input-4'] = LADDER_PART_HELP['misc-digital/plc-input-8'];
LADDER_PART_HELP['misc-digital/plc-output-4'] = LADDER_PART_HELP['misc-digital/plc-output-8'];
