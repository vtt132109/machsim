/**
 * Lesson text for the round-4 lessons, part 1 (src/learn/lessons/round4.ts): a printed hand-out,
 * a meter inside two copies of one block, a `.step` sweep of a schematic, one dual op-amp drawn
 * as two sections and an 8051 delay of exactly 1000 machine cycles.
 * Original text written for MachSim from general circuit theory. See src/i18n/lessons/index.ts.
 */
import { L, type LocalizedText } from '../core';
import type { LessonText } from './index';

export const ROUND4_TEXT: Record<string, LessonText> = {
  'print-handout': {
    title: L('In phiếu bài tập cho cả lớp', 'Print a hand-out for the class'),
    goal: L(
      'Chuẩn bị một phiếu bài tập hai trang: mạch lọc RC, tên net hiện rõ, khổ giấy A4 dọc có chân trang — và để cài đặt đó được lưu ngay trong tệp.',
      'Prepare a two-page hand-out: an RC filter with its net names shown, A4 portrait paper with a footer — and have those settings saved inside the file.',
    ),
    theory: L(
      `## Một tệp, nhiều trang, một cách in
Một thiết kế có thể có nhiều **trang sơ đồ**. Khi in, mỗi trang là một tờ (hoặc nhiều tờ nếu bạn in đúng cỡ). Cách in được chọn trong hộp **In và xem trước** (Ctrl+P) và được **lưu cùng thiết kế**: khổ giấy, hướng giấy, lề, tỉ lệ, chân trang. Mở lại tệp là ra đúng trang in cũ — rất tiện khi cả lớp dùng chung một phiếu.

## Tỉ lệ
Một đơn vị lưới bằng 0,25 mm, nên trang sơ đồ ở **100 %** có cỡ thật, với $n$ là số đơn vị lưới:

$$L_{mm} = \\frac{n}{4}$$

Trang sơ đồ A4 lớn hơn vùng in của tờ A4 (đã trừ lề), vì thế mặc định MachSim chọn **vừa trang**: thu nhỏ đủ để cả trang nằm gọn trên tờ giấy.

## Lớp hiển thị
Mạch lọc RC có $f_c = \\frac{1}{2\\pi R C}$. Phiếu cho học sinh nên **ẩn giá trị** để các em tự tính, còn người dạy giải thích netlist lại muốn **hiện tên net**. Sửa › Lớp hiển thị bật tắt từng lớp (lưới, tên linh kiện, giá trị, nhãn, tên net, số chân) cho từng trang; bản in và ảnh xuất ra làm đúng như vậy.

> Mẹo: dùng Sửa › Lớp hiển thị để ẩn giá trị khi làm phiếu bài tập; hiện lại khi chấm bài.`,
      `## One file, several sheets, one way to print
A design can have several **schematic sheets**. When you print, each sheet is a page (or several pages if you print at true size). How it prints is chosen in the **Print and preview** box (Ctrl+P) and is **saved with the design**: paper size, orientation, margins, scale, footer. Open the file again and the same printout comes back — handy when a whole class shares one hand-out.

## Scale
One grid unit is 0.25 mm, so a sheet at **100 %** is drawn at its real size, where $n$ is the number of grid units:

$$L_{mm} = \\frac{n}{4}$$

An A4 sheet is larger than the printable area of an A4 page (after the margins), which is why MachSim defaults to **fit to page**: it shrinks the drawing just enough to lie on the paper.

## Layers
The RC filter has $f_c = \\frac{1}{2\\pi R C}$. A worksheet for students should **hide the values** so they can work them out, while a teacher explaining a netlist wants the **net names shown**. Edit › Layer settings switches each layer (grid, designators, values, labels, net names, pin numbers) per sheet; the printout and exported pictures do the same.

> Tip: use Edit › Layer settings to hide the values when you make a worksheet; show them again when you mark the answers.`,
    ),
    steps: {
      circuit: {
        task: L('Vẽ mạch lọc thông thấp RC trên trang 1: nguồn xoay chiều, điện trở nối tiếp, tụ nối xuống đất (ví dụ R = 1 kΩ, C = 159 nF, fc ≈ 1 kHz).', 'Draw an RC low-pass filter on sheet 1: an AC source, a series resistor and a capacitor to ground (for example R = 1 kΩ, C = 159 nF, fc ≈ 1 kHz).'),
        hint: L('Nối nguồn → điện trở → tụ → đất. Đặt tên điểm giữa là OUT bằng công cụ Nhãn (phím L).', 'Wire source → resistor → capacitor → ground. Name the middle point OUT with the label tool (key L).'),
      },
      names: {
        task: L('Bật lớp “Tên net” cho trang đó để bản in ghi tên các nút (IN, OUT).', 'Switch on the “Net names” layer for that sheet so the printout shows the node names (IN, OUT).'),
        hint: L('Sửa › Lớp hiển thị, tích “Tên net”. Lớp này mặc định tắt.', 'Edit › Layer settings, tick “Net names”. This layer is off by default.'),
      },
      setup: {
        task: L('Mở hộp In và xem trước (Ctrl+P): chọn giấy A4 dọc và bật “Chân trang”. Đóng hộp để cài đặt được lưu.', 'Open Print and preview (Ctrl+P): choose A4 portrait paper and switch on the footer. Close the box so the settings are saved.'),
        hint: L('Tệp › In và xem trước. Hướng giấy mặc định là nằm ngang; chân trang mặc định tắt. Thay đổi trong hộp được ghi vào thiết kế.', 'File › Print and preview. The default orientation is landscape and the footer is off. Changes made in the box are written into the design.'),
      },
      sheets: {
        task: L('Thêm trang 2 với mạch lọc thông cao (đổi chỗ R và C) làm bài tập cho học sinh.', 'Add sheet 2 with the high-pass filter (swap R and C) as the students’ exercise.'),
        hint: L('Đặt › Trang sơ đồ mới (hoặc nút + cạnh tên trang), rồi vẽ tụ nối tiếp và điện trở xuống đất.', 'Place › New sheet (or the + beside the sheet tabs), then draw the series capacitor and the resistor to ground.'),
      },
    },
    quiz: {
      where: {
        q: L('Cài đặt trang in (khổ giấy, hướng giấy, chân trang) được lưu ở đâu?', 'Where are the print settings (paper, orientation, footer) saved?'),
        options: [L('Trong bộ nhớ của máy in', 'In the printer’s memory'), L('Trong chính tệp thiết kế', 'In the design file itself'), L('Chỉ trong lần chạy MachSim hiện tại', 'Only for the current MachSim run')],
        why: L('Chúng nằm trong tệp .msim nên mở lại là có sẵn, và người nhận tệp in ra giống hệt.', 'They are stored in the .msim file, so they are there when you reopen it and anyone who gets the file prints the same pages.'),
      },
      fit: {
        q: L('Vì sao MachSim mặc định in “vừa trang”?', 'Why does MachSim print “fit to page” by default?'),
        options: [L('Trang sơ đồ ở 100 % lớn hơn vùng in của tờ A4', 'A sheet at 100 % is larger than the printable area of A4'), L('Máy in không in được 100 %', 'Printers cannot print at 100 %'), L('Để tiết kiệm mực', 'To save ink')],
        why: L('Một trang sơ đồ cỡ A4 rộng hơn phần giấy còn lại sau lề, nên cần thu nhỏ hoặc chia thành nhiều tờ.', 'An A4-sized sheet is wider than the paper left after the margins, so it has to be shrunk or split over several pages.'),
      },
      layer: {
        q: L('Muốn học sinh tự tính nên làm gì với phiếu?', 'What should you do with a worksheet so students work the values out?'),
        options: [L('Xoá linh kiện', 'Delete the parts'), L('Đổi sang giấy dọc', 'Switch to portrait paper'), L('Ẩn lớp “Giá trị”', 'Hide the “Values” layer')],
        why: L('Ẩn lớp không xoá gì khỏi mạch; netlist và mô phỏng vẫn đúng, chỉ có bản in không ghi giá trị.', 'Hiding a layer deletes nothing: the netlist and simulation stay correct, only the printout leaves the values out.'),
      },
    },
  },

  'block-meters': {
    title: L('Hai bản của một khối, mỗi bản một đồng hồ', 'Two copies of one block, each with its own meter'),
    goal: L(
      'Dựng một khối cầu phân áp có đồng hồ bên trong, đặt hai bản với tham số khác nhau và thấy mỗi bản có đồng hồ riêng đọc đúng điện áp của mình.',
      'Build a divider block with a meter inside, place two copies with different parameters and see each copy has its own meter reading its own voltage.',
    ),
    theory: L(
      `## Khối dùng lại được
Một **khối phân cấp** là một mạch con vẽ một lần rồi đặt nhiều lần, mỗi bản có thể mang **tham số riêng** (ví dụ $R_B$). Điều mới của vòng này: **thiết bị đo, đèn LED, đầu dò và công tắc nằm trong khối** cũng thuộc từng bản chứ không dùng chung.

## Đặt tên theo đường dẫn
Đồng hồ XMM1 trong khối đặt hai lần được gọi là **X1.XMM1** và **X2.XMM1** (tên bản, dấu chấm, tên linh kiện bên trong). Khối lồng nhau thì tên dài ra: HB1.X9.XMM1. Vì vậy hai đồng hồ không bao giờ nhầm với nhau.

## Cầu phân áp trong khối
Với nguồn 5 V, $R_1 = 1\\,k\\Omega$ và $R_2 = R_B$:

$$V_{mid} = V_{in}\\,\\frac{R_B}{R_1 + R_B}$$

$R_B = 1\\,k\\Omega$ cho 2,5 V; $R_B = 3\\,k\\Omega$ cho 3,75 V. Hai bản cùng một khối nhưng cho hai số đọc khác nhau, vì mỗi bản được MachSim biên dịch thành một mạch con riêng.

> Nhấn đúp một khối để mở bên trong. Trạng thái bấm công tắc, vị trí biến trở của từng bản được lưu riêng, nên hai bản không bao giờ giẫm lên nhau.`,
      `## A block you can reuse
A **hierarchical block** is a subcircuit drawn once and placed many times, and each copy can carry **its own parameters** (for example $R_B$). New in this round: the **instruments, LEDs, probes and switches inside the block** also belong to each copy instead of being shared.

## Names by path
A meter XMM1 in a block placed twice is called **X1.XMM1** and **X2.XMM1** (copy name, dot, name of the part inside). Nested blocks give longer names: HB1.X9.XMM1. So two meters can never be mixed up.

## A divider in a block
With a 5 V source, $R_1 = 1\\,k\\Omega$ and $R_2 = R_B$:

$$V_{mid} = V_{in}\\,\\frac{R_B}{R_1 + R_B}$$

$R_B = 1\\,k\\Omega$ gives 2.5 V; $R_B = 3\\,k\\Omega$ gives 3.75 V. Two copies of the same block give two different readings, because MachSim builds each copy into its own subcircuit.

> Double-click a block to open it. The state of a switch click or a potentiometer position is stored per copy, so two copies never step on each other.`,
    ),
    steps: {
      copies: {
        task: L('Tạo một khối phân cấp tên DIV (menu Đặt) và đặt nó hai lần trên trang chính: X1 và X2.', 'Create a hierarchical block named DIV (Place menu) and place it twice on the main sheet: X1 and X2.'),
        hint: L('Đặt › Khối phân cấp mới. Trong khối, đặt một nhãn kết nối IN (loại “kết nối phân cấp”). Sau đó đặt khối hai lần từ danh sách linh kiện.', 'Place › New hierarchical block. Inside the block, place a connector label IN (kind “hierarchical connector”). Then place the block twice from the part list.'),
      },
      inside: {
        task: L('Mở khối (nhấn đúp) và đặt một đồng hồ vạn năng bên trong, đo điện áp ở điểm giữa R1 – R2.', 'Open the block (double-click) and put a multimeter inside, measuring the voltage at the middle of R1 – R2.'),
        hint: L('Trong khối: R1 = 1k nối IN với MID, R2 = {RB} nối MID xuống đất, đồng hồ giữa MID và đất.', 'Inside the block: R1 = 1k from IN to MID, R2 = {RB} from MID to ground, the meter between MID and ground.'),
      },
      differ: {
        task: L('Cho hai bản tham số khác nhau: RB = 1k ở X1 và RB = 3k ở X2 (Thuộc tính của từng khối).', 'Give the two copies different parameters: RB = 1k on X1 and RB = 3k on X2 (the Properties of each block).'),
        hint: L('Chọn khối X2 rồi sửa giá trị RB trong bảng Thuộc tính. Tham số của khối khai báo trong mục “Biến” của mạch con.', 'Select block X2 and edit RB in the Properties panel. The block’s parameter is declared under the subcircuit’s “Variables”.'),
      },
      read: {
        task: L('Cấp 5 V vào cả hai khối rồi chạy điểm làm việc: hai đồng hồ X1.XMM1 và X2.XMM1 phải đọc hai giá trị khác nhau.', 'Feed both blocks 5 V and run the operating point: the two meters X1.XMM1 and X2.XMM1 must read two different values.'),
        hint: L('Nguồn 5 V, cực dương nối chân IN của cả hai khối, cực âm xuống đất. Kết quả mong đợi 2,5 V và 3,75 V.', 'A 5 V source, its plus to the IN pin of both blocks, its minus to ground. Expect 2.5 V and 3.75 V.'),
      },
    },
    quiz: {
      name: {
        q: L('Đồng hồ XMM1 trong bản X2 của khối được gọi là gì?', 'What is the meter XMM1 inside copy X2 of the block called?'),
        options: [L('XMM1', 'XMM1'), L('XMM1_2', 'XMM1_2'), L('X2.XMM1', 'X2.XMM1')],
        why: L('Tên theo đường dẫn: tên bản, dấu chấm, tên linh kiện bên trong.', 'Names follow the path: copy name, a dot, the part inside.'),
      },
      why: {
        q: L('Vì sao hai bản của một khối đọc hai điện áp khác nhau?', 'Why do two copies of one block read different voltages?'),
        options: [L('Mỗi bản có tham số RB riêng nên là một mạch con riêng', 'Each copy has its own RB, so it is a separate subcircuit'), L('Một trong hai đồng hồ bị hỏng', 'One of the meters is faulty'), L('Nguồn cấp cho hai bản khác nhau', 'The two copies get different sources')],
        why: L('Cùng một bản vẽ nhưng khác tham số thì MachSim sinh hai mạch con khác nhau.', 'The same drawing with other parameters makes MachSim write two different subcircuits.'),
      },
      store: {
        q: L('Trạng thái công tắc của từng bản được lưu ở đâu?', 'Where is the switch state of each copy kept?'),
        options: [L('Trong bản vẽ của khối (dùng chung)', 'In the block’s drawing (shared)'), L('Trên khối đặt ở trang chính, riêng cho từng bản', 'On the block placed on the main sheet, separately for each copy'), L('Không lưu', 'Not saved')],
        why: L('Nhờ vậy bấm công tắc ở X1 không làm thay đổi X2 và bản vẽ khối giữ nguyên.', 'That way clicking a switch in X1 does not change X2, and the block’s drawing stays untouched.'),
      },
    },
  },

  'step-sweep': {
    title: L('Quét tham số của mạch vẽ bằng dòng .step', 'Sweep a schematic with a .step card'),
    goal: L(
      'Cho điện trở của bộ lọc RC lấy giá trị từ tham số toàn cục Rx, rồi quét Rx qua ba giá trị bằng một dòng .step để được ba đường cong chồng nhau.',
      'Let the resistor of an RC filter take its value from a global parameter Rx, then sweep Rx through three values with a .step line to get three curves on top of each other.',
    ),
    theory: L(
      `## Tham số toàn cục
Thay vì gõ 1k vào điện trở, bạn viết **{Rx}** và khai báo **Rx = 1k** ở mục Tham số toàn cục của mạch. Mọi chỗ dùng {Rx} cùng đổi theo.

## Dòng .step
Trong ô SPICE riêng của mạch (Mô phỏng › Thiết lập phân tích) viết:

\`.step param Rx list 1k 2.2k 4.7k\`

Phân tích bạn chọn (ở đây AC) sẽ chạy **ba lần**, mỗi lần một giá trị Rx, và Máy vẽ hiện ba đường chồng lên nhau với chú giải Rx=1000, Rx=2200, Rx=4700. Cũng làm được bằng Quét tham số, chọn “Tham số toàn cục (biến)”.

## Cái cần kiểm chứng
Tần số cắt của bộ lọc RC:

$$f_c = \\frac{1}{2\\pi R_x C}$$

Với C = 100 nF: Rx = 1k cho 1,59 kHz, 2,2k cho 723 Hz, 4,7k cho 339 Hz. R lớn hơn thì đường cong dịch sang trái. MachSim dựng lại netlist cho từng giá trị nên **mọi loại phân tích** (AC, quá độ, điểm làm việc…) đều quét được.`,
      `## Global parameters
Instead of typing 1k into the resistor you write **{Rx}** and declare **Rx = 1k** in the circuit’s Global parameters. Every place that uses {Rx} changes together.

## The .step line
In the circuit’s own SPICE box (Simulate › Analysis settings) write:

\`.step param Rx list 1k 2.2k 4.7k\`

The analysis you choose (AC here) then runs **three times**, once per Rx, and the Grapher shows three curves on top of each other with the legend Rx=1000, Rx=2200, Rx=4700. Parameter sweep with “Global parameter (variable)” does the same.

## What to check
The corner frequency of the RC filter:

$$f_c = \\frac{1}{2\\pi R_x C}$$

With C = 100 nF: Rx = 1k gives 1.59 kHz, 2.2k gives 723 Hz, 4.7k gives 339 Hz. A larger R moves the curve left. MachSim rebuilds the netlist for every value, so **every kind of analysis** (AC, transient, operating point…) can be swept.`,
    ),
    steps: {
      variable: {
        task: L('Vẽ bộ lọc RC (nguồn AC, R nối tiếp, C = 100 nF xuống đất) và cho R có giá trị {Rx}, với Rx = 1k là tham số toàn cục.', 'Draw the RC filter (AC source, series R, C = 100 nF to ground) and give R the value {Rx}, with Rx = 1k as a global parameter.'),
        hint: L('Chọn vùng trống rồi thêm Rx trong Thuộc tính › Tham số toàn cục. Ở điện trở gõ {Rx} (có ngoặc nhọn).', 'Click an empty spot and add Rx under Properties › Global parameters. In the resistor type {Rx} (with the braces).'),
      },
      values: {
        task: L('Viết dòng .step cho Rx với ít nhất ba giá trị, vào ô SPICE riêng của mạch.', 'Write a .step line for Rx with at least three values in the circuit’s own SPICE box.'),
        hint: L('Ví dụ: .step param Rx list 1k 2.2k 4.7k — hoặc chọn phân tích Quét tham số với tham số toàn cục Rx.', 'For example: .step param Rx list 1k 2.2k 4.7k — or choose the Parameter sweep analysis with the global parameter Rx.'),
      },
      curves: {
        task: L('Chạy phân tích AC: mỗi giá trị Rx phải cho tần số cắt đúng bằng 1/(2πRxC).', 'Run the AC analysis: every Rx must give a corner frequency equal to 1/(2πRxC).'),
        hint: L('Chọn phân tích AC trong Thiết lập phân tích rồi nhấn Chạy. Mở Máy vẽ để thấy ba đường.', 'Choose AC in Analysis settings and press Run. Open the Grapher to see the three curves.'),
      },
    },
    quiz: {
      card: {
        q: L('Dòng “.step param Rx list 1k 2.2k 4.7k” làm gì?', 'What does the line “.step param Rx list 1k 2.2k 4.7k” do?'),
        options: [L('Đặt Rx = 4.7k', 'Sets Rx = 4.7k'), L('Chạy phân tích ba lần, mỗi lần một giá trị Rx', 'Runs the analysis three times, once per value of Rx'), L('Vẽ ba điện trở nối tiếp', 'Draws three resistors in series')],
        why: L('.step lặp cả phân tích theo danh sách giá trị và gộp kết quả thành một họ đường cong.', '.step repeats the whole analysis over the list of values and collects the results into a family of curves.'),
      },
      legend: {
        q: L('Chú giải của các đường cong trong Máy vẽ ghi gì?', 'What does the legend of the curves in the Grapher say?'),
        options: [L('Rx=1000, Rx=2200, Rx=4700', 'Rx=1000, Rx=2200, Rx=4700'), L('Đường 1, 2, 3', 'Line 1, 2, 3'), L('Không có chú giải', 'No legend')],
        why: L('Mỗi đường mang tên tham số và giá trị của nó nên dễ đối chiếu với công thức.', 'Each curve carries the parameter name and its value, so it is easy to compare with the formula.'),
      },
      fc: {
        q: L('Tăng Rx lên gấp đôi thì tần số cắt của bộ lọc RC…', 'Doubling Rx makes the corner frequency of the RC filter…'),
        options: [L('tăng gấp đôi', 'double'), L('không đổi', 'stay the same'), L('giảm một nửa', 'halve')],
        why: L('fc tỉ lệ nghịch với R: R gấp đôi thì fc còn một nửa.', 'fc is inversely proportional to R: twice the R, half the fc.'),
      },
    },
  },

  'dual-opamp': {
    title: L('Một IC op-amp đôi vẽ thành hai phần', 'One dual op-amp drawn as two sections'),
    goal: L(
      'Vẽ LM358 (hai op-amp trong một vỏ) thành hai phần cùng tên U1: phần A làm mạch đệm, phần B khuếch đại gấp đôi; nguồn nối một lần dùng chung.',
      'Draw an LM358 (two op-amps in one package) as two sections with the same name U1: section A as a buffer, section B amplifying by two; the supply is wired once and shared.',
    ),
    theory: L(
      `## Một vỏ, hai phần
IC thật như LM358, TL072, NE5532 có **hai op-amp trong một vỏ** và chỉ một cặp chân nguồn. MachSim vẽ mỗi op-amp thành một linh kiện riêng (**U1A** và **U1B**) nhưng cùng tên **U1**: trong danh sách vật tư chúng là MỘT con IC.

## Chân nguồn dùng chung
Hai phần cùng dùng chân V+ và V−. Chỉ cần nối nguồn ở **một** phần; nối ở hai phần vào hai net khác nhau là lỗi. Nhờ vậy sơ đồ không bị chật vì dây nguồn lặp lại.

## Mạch trong lesson
Phần A là mạch đệm (đầu ra nối thẳng IN−) nên $V_{BUF} = V_{IN}$. Phần B là khuếch đại không đảo:

$$A_v = 1 + \\frac{R_2}{R_1}$$

Với $R_1 = R_2 = 10\\,k\\Omega$ thì $A_v = 2$: vào 0,5 V ra 1 V.

> Báo cáo › Cổng còn trống cho biết còn phần nào của IC chưa dùng. Một op-amp thừa nên nối thành mạch đệm để khỏi nhiễu.`,
      `## One package, two sections
Real ICs like the LM358, TL072 and NE5532 have **two op-amps in one package** and only one pair of supply pins. MachSim draws each op-amp as its own part (**U1A** and **U1B**) with the same name **U1**: in the bill of materials they are ONE chip.

## Shared supply pins
Both sections use the same V+ and V− pins. You only need to wire the supply on **one** section; wiring it to different nets on two sections is an error. The drawing stays uncluttered because the supply wires are not repeated.

## The circuit of this lesson
Section A is a buffer (output wired straight to IN−) so $V_{BUF} = V_{IN}$. Section B is a non-inverting amplifier:

$$A_v = 1 + \\frac{R_2}{R_1}$$

With $R_1 = R_2 = 10\\,k\\Omega$, $A_v = 2$: 0.5 V in gives 1 V out.

> Reports › Spare gates tells you which sections of an IC are still unused. A spare op-amp is best wired as a buffer so it does not pick up noise.`,
    ),
    steps: {
      sections: {
        task: L('Đặt “LM358 (kép) phần A” và “phần B” — hai linh kiện phải cùng tên U1.', 'Place “LM358 (dual) section A” and “section B” — the two parts must share the name U1.'),
        hint: L('Tìm LM358 trong họ Op-amp: chọn các mục có đuôi A và B. MachSim tự ghép phần thứ hai vào cùng vi mạch nếu còn chỗ.', 'Find the LM358 in the Op-amp family: pick the entries ending in A and B. MachSim joins the second section to the same chip when it is free.'),
      },
      supply: {
        task: L('Nối nguồn 12 V vào V+ và V− xuống đất — chỉ cần ở một phần.', 'Wire a 12 V supply to V+ and V− to ground — on one section only.'),
        hint: L('Nếu nối cả hai phần, hai net phải là một. Nếu hai nguồn khác nhau, ERC báo lỗi xung đột chân nguồn.', 'If you wire both sections the two nets must be the same. With two different supplies ERC reports a supply pin conflict.'),
      },
      gain: {
        task: L('Đặt nhãn IN (0,5 V) và OUT; phần A là mạch đệm, phần B khuếch đại gấp 2 với R1 = R2 = 10k. Điện áp ra OUT phải gấp đôi IN.', 'Label the nets IN (0.5 V) and OUT; section A is a buffer, section B amplifies by 2 with R1 = R2 = 10k. The OUT voltage must be twice IN.'),
        hint: L('Phần B: IN+ nối đầu ra phần A, R2 từ OUT về IN−, R1 từ IN− xuống đất.', 'Section B: IN+ to the output of section A, R2 from OUT to IN−, R1 from IN− to ground.'),
      },
    },
    quiz: {
      name: {
        q: L('Hai phần của cùng một vi mạch có tên linh kiện thế nào?', 'What are the two sections of one chip called?'),
        options: [L('U1 và U2', 'U1 and U2'), L('Cùng một tên, ví dụ U1', 'The same name, for example U1'), L('U1A và U1B là hai tên khác nhau của hai IC', 'U1A and U1B are two names of two ICs')],
        why: L('Cùng tên nghĩa là cùng một vỏ IC; hậu tố A, B chỉ là tên phần.', 'The same name means the same package; the suffixes A and B only name the section.'),
      },
      supply: {
        q: L('Phải nối nguồn V+ / V− ở mấy phần?', 'On how many sections must V+ / V− be wired?'),
        options: [L('Cả hai, mỗi phần một nguồn riêng', 'Both, each with its own supply'), L('Không cần: IC tự có nguồn', 'None: the IC has its own supply'), L('Một phần là đủ, vì chân nguồn dùng chung', 'One is enough, because the pins are shared')],
        why: L('V+ và V− là cùng một chân vật lý của vỏ nên nối một lần.', 'V+ and V− are the same physical pins of the package so they are wired once.'),
      },
      spare: {
        q: L('Một phần op-amp không dùng nên được…', 'An unused op-amp section should be…'),
        options: [L('nối thành mạch đệm hoặc đánh dấu rõ', 'wired as a buffer or clearly marked'), L('để hở mọi chân', 'left with every pin open'), L('nối đầu ra với nguồn', 'wired with its output to the supply')],
        why: L('Đầu vào để hở có thể nhận nhiễu và làm đầu ra dao động, ảnh hưởng cả phần còn lại.', 'Floating inputs can pick up noise and make the output oscillate, which disturbs the rest of the chip.'),
      },
    },
  },

  'mcu-debug': {
    title: L('8051: đếm chu kỳ máy bằng gỡ lỗi từng bước', '8051: count machine cycles by stepping'),
    goal: L(
      'Viết chương trình 8051 đổi P1.0 sau đúng 1000 chu kỳ máy (1 ms ở 12 MHz) và dùng chế độ gỡ lỗi để thấy đồng hồ của mạch chạy bằng đúng số chu kỳ đó.',
      'Write an 8051 program that toggles P1.0 after exactly 1000 machine cycles (1 ms at 12 MHz) and use the debugger to watch the circuit clock run exactly that many cycles.',
    ),
    theory: L(
      `## Chu kỳ máy
8051 làm mỗi lệnh trong 1, 2 hoặc 4 **chu kỳ máy**. Với thạch anh $f_{osc}$ thì một chu kỳ máy kéo dài 12 xung thạch anh:

$$T_{cm} = \\frac{12}{f_{osc}}$$

Ở 12 MHz, $T_{cm}$ = 1 µs. Bảng dịch (listing) trong Trình soạn mã có cột **Chu kỳ** ghi số chu kỳ từng lệnh: CPL 1, ACALL 2, DJNZ 2, RET 2…

## Vòng trễ chính xác
Một vòng lặp DJNZ chạy $N$ lần tốn $2N$ chu kỳ. Hai vòng lồng nhau, ngoài $A$ lần, trong $B$ lần:

$$t = 1 + A\\,(1 + 2B + 2) + 2$$

(MOV, vòng ngoài gồm MOV + B lần DJNZ + DJNZ, rồi RET). Với A = 32, B = 14: 1 + 32 × 31 + 2 = 995; cộng CPL 1, ACALL 2, SJMP 2 thành **đúng 1000**.

## Gỡ lỗi
Nhấn “Bắt đầu gỡ lỗi”: mô phỏng chạy rồi dừng ngay trước lệnh đầu tiên. Đi từng lệnh (F11), từng dòng (F10, bước qua cả lời gọi chương trình con) hay từng chu kỳ (Shift+F11). **Đồng hồ của mạch dừng đúng ở số chu kỳ × 1 µs**, nên LED và chân cổng hiện đúng trạng thái tại khoảnh khắc đó.`,
      `## Machine cycles
The 8051 runs each instruction in 1, 2 or 4 **machine cycles**. With a crystal $f_{osc}$ one machine cycle lasts 12 crystal periods:

$$T_{mc} = \\frac{12}{f_{osc}}$$

At 12 MHz, $T_{mc}$ = 1 µs. The listing in the code editor has a **Cyc** column giving the cycles of each instruction: CPL 1, ACALL 2, DJNZ 2, RET 2…

## An exact delay loop
A DJNZ loop run $N$ times costs $2N$ cycles. Two nested loops, $A$ times outside and $B$ times inside:

$$t = 1 + A\\,(1 + 2B + 2) + 2$$

(the MOV, then per outer pass a MOV plus B DJNZ plus a DJNZ, then RET). With A = 32, B = 14: 1 + 32 × 31 + 2 = 995; add CPL 1, ACALL 2 and SJMP 2 and you get **exactly 1000**.

## Debugging
Press “Start debugging”: the simulation runs and stops right before the first instruction. Step by instruction (F11), by line (F10, which steps over a subroutine call) or by machine cycle (Shift+F11). **The circuit clock stops at exactly cycles × 1 µs**, so the LED and port pins show exactly their state at that instant.`,
    ),
    steps: {
      program: {
        task: L('Đặt vi điều khiển 8051 (loại P1) và gõ chương trình hợp ngữ đổi P1.0 trong vòng lặp vô hạn, có chương trình con DELAY.', 'Place an 8051 microcontroller (the P1 kind) and type an assembly program that toggles P1.0 in an endless loop, with a DELAY subroutine.'),
        hint: L('Nhấp đúp vào 8051 để mở Trình soạn mã. Dùng CPL P1.0 để đảo chân; xem mẫu 93 (Tệp › Mạch mẫu) nếu cần gợi ý.', 'Double-click the 8051 to open the code editor. Use CPL P1.0 to toggle the pin; sample 93 (File › Samples) is there if you need a hint.'),
      },
      cycles: {
        task: L('Chỉnh vòng trễ để P1.0 đổi trạng thái cách nhau đúng 1000 chu kỳ máy.', 'Adjust the delay loop so P1.0 changes state exactly 1000 machine cycles apart.'),
        hint: L('Bật gỡ lỗi, đi từng dòng (F10) và đọc “chu kỳ đã chạy” ở dòng trạng thái. Nếu lệch 1–2 chu kỳ, thêm hoặc bớt NOP.', 'Start debugging, step by line (F10) and read the cycles run on the status line. If you are 1–2 cycles off, add or remove a NOP.'),
      },
      led: {
        task: L('Nối LED qua điện trở 330 Ω từ +5 V xuống chân P1.0 (chân 8051 hút dòng tốt hơn đẩy dòng).', 'Wire an LED through a 330 Ω resistor from +5 V down to pin P1.0 (an 8051 pin sinks current better than it sources it).'),
        hint: L('+5 V → 330 Ω → anode LED, cực âm LED nối P1.0. Đừng quên đất cho nguồn.', '+5 V → 330 Ω → LED anode, LED cathode to P1.0. Do not forget the ground of the supply.'),
      },
      blink: {
        task: L('Chạy phân tích quá độ 10 ms: chân P1.0 phải dao động ở 500 Hz (nửa chu kỳ 1 ms).', 'Run a 10 ms transient: pin P1.0 must oscillate at 500 Hz (half period 1 ms).'),
        hint: L('Thiết lập phân tích: quá độ, bước 10 µs, dừng 10 ms. Tần số = f_osc/12/(2 × 1000).', 'Analysis settings: transient, step 10 µs, stop 10 ms. Frequency = f_osc/12/(2 × 1000).'),
      },
    },
    quiz: {
      cycle: {
        q: L('Ở thạch anh 12 MHz, một chu kỳ máy của 8051 dài…', 'With a 12 MHz crystal, one machine cycle of the 8051 lasts…'),
        options: [L('1 µs', '1 µs'), L('83 ns', '83 ns'), L('12 µs', '12 µs')],
        why: L('12 xung thạch anh ÷ 12 MHz = 1 µs.', '12 crystal periods ÷ 12 MHz = 1 µs.'),
      },
      over: {
        q: L('“Một dòng (F10)” khác “Một lệnh (F11)” ở chỗ nào?', 'How does “One line (F10)” differ from “One instruction (F11)”?'),
        options: [L('Không khác', 'It does not'), L('F10 chạy nhanh hơn', 'F10 runs faster'), L('F10 chạy hết cả chương trình con khi gặp ACALL', 'F10 runs a whole subroutine when it meets ACALL')],
        why: L('F10 bước qua lời gọi, rất tiện để bỏ qua vòng trễ khi chỉ muốn xem chương trình chính.', 'F10 steps over the call, which is handy to skip a delay loop when you only want to follow the main program.'),
      },
      clock: {
        q: L('Dừng tại một điểm dừng sau 7 chu kỳ máy, đồng hồ của mạch ở 12 MHz chỉ…', 'Stopped at a breakpoint after 7 machine cycles, the circuit clock at 12 MHz reads…'),
        options: [L('7 ms', '7 ms'), L('7 µs', '7 µs'), L('84 µs', '84 µs')],
        why: L('Đồng hồ mạch = số chu kỳ × thời gian một chu kỳ = 7 × 1 µs.', 'Circuit clock = cycles × the time of one cycle = 7 × 1 µs.'),
      },
    },
  },
};

const n = (vi: string, en: string): LocalizedText => L(vi, en);

/** Lesson-specific feedback of the round-4 lessons, part 1 (`note:<key>`). */
export const ROUND4_NOTES: Record<string, LocalizedText> = {
  // hand-out
  needRcPair: n('Chưa thấy một điện trở nối với một tụ điện ở cùng một điểm (một tầng RC).', 'No resistor joined to a capacitor at one point yet (an RC stage).'),
  handoutCircuit: n('Mạch lọc RC có fc ≈ {fc}.', 'The RC filter has fc ≈ {fc}.'),
  needNetNames: n('Chưa trang nào bật lớp “Tên net”: Sửa › Lớp hiển thị.', 'No sheet has the “Net names” layer on yet: Edit › Layer settings.'),
  needFooter: n('Cài đặt trang in chưa có chân trang: mở Tệp › In và xem trước, bật “Chân trang”.', 'The print setup has no footer yet: open File › Print and preview and switch on the footer.'),
  needPortrait: n('Hướng giấy chưa là dọc: trong hộp In và xem trước chọn giấy dọc.', 'The paper is not portrait yet: choose portrait in the Print and preview box.'),
  setupOk: n('Đã lưu cài đặt in: giấy {paper} dọc, có chân trang.', 'Print setup saved: {paper} portrait with a footer.'),
  sheetsOk: n('Có {n} trang đã vẽ mạch.', '{n} sheets with a circuit.'),
  needTwoSheets: n('Mới có {n} trang có mạch; phiếu cần hai trang (mỗi trang ít nhất hai linh kiện).', 'Only {n} sheet(s) hold a circuit; the hand-out needs two (at least two parts each).'),
  // block meters
  copiesOk: n('Khối được đặt {n} lần.', 'The block is placed {n} times.'),
  needBlockCopies: n('Chưa có khối nào được đặt hai lần. Tạo khối (Đặt › Khối phân cấp mới) rồi đặt nó hai lần trên trang chính.', 'No block is placed twice yet. Create a block (Place › New hierarchical block) and place it twice on the main sheet.'),
  needMeterInBlock: n('Khối chưa có thiết bị đo bên trong: nhấn đúp khối và đặt một đồng hồ vạn năng.', 'The block has no instrument inside: double-click it and place a multimeter.'),
  copiesSame: n('Hai bản có tham số giống hệt nhau nên sẽ đọc như nhau. Đổi RB của một bản.', 'The two copies have identical parameters so they will read the same. Change RB on one copy.'),
  needBlockMeters: n('Chưa thấy hai đồng hồ trong hai bản (hiện có {n}). Cần thiết bị đo trong khối và hai bản được nối điện.', 'Two meters in two copies were not found ({n} so far). The block needs an instrument and both copies must be wired.'),
  blockReadOk: n('Mỗi bản đọc riêng: {list}.', 'Each copy reads on its own: {list}.'),
  blockReadSame: n('Hai đồng hồ đọc như nhau ({list}). Cho hai bản tham số khác nhau.', 'The two meters read the same ({list}). Give the two copies different parameters.'),
  // .step
  needVariableRes: n('Điện trở của tầng RC chưa lấy giá trị từ tham số: gõ {Rx} (có ngoặc nhọn) vào giá trị của nó.', 'The resistor of the RC stage does not take its value from a parameter yet: type {Rx} (with braces) as its value.'),
  needVariableDef: n('Điện trở dùng {name} nhưng mạch chưa khai báo tham số toàn cục tên đó (Thuộc tính › Tham số toàn cục).', 'The resistor uses {name} but the circuit declares no global parameter of that name (Properties › Global parameters).'),
  variableOk: n('Điện trở lấy giá trị từ tham số toàn cục {name}.', 'The resistor takes its value from the global parameter {name}.'),
  needStepCard: n('Chưa có dòng .step cho một tham số toàn cục (hoặc phân tích Quét tham số). Viết .step param Rx list 1k 2.2k 4.7k vào ô SPICE riêng.', 'No .step line for a global parameter (or Parameter sweep analysis) yet. Write .step param Rx list 1k 2.2k 4.7k in the custom SPICE box.'),
  needStepValues: n('Cần ít nhất ba giá trị để thấy một họ đường cong (hiện có {n}).', 'At least three values are needed to see a family of curves ({n} so far).'),
  stepValuesOk: n('Quét {n} giá trị.', 'Sweeping {n} values.'),
  stepFailed: n('Không chạy được phép quét: {message}', 'The sweep could not run: {message}'),
  stepCornerOk: n('Tần số cắt từng giá trị đều đúng: {list}.', 'Every value has the right corner frequency: {list}.'),
  stepCornerWrong: n('Với R = {rx} đo được fc = {value}, nhưng 1/(2πRC) = {want}. Kiểm tra điện trở có dùng {Rx} và tụ nối xuống đất.', 'With R = {rx} the corner is {value}, but 1/(2πRC) = {want}. Check the resistor uses {Rx} and the capacitor goes to ground.'),
  // dual op-amp
  needSections: n('Chưa có hai phần của cùng một op-amp kép. Đặt “LM358 (kép) phần A” và “phần B” và cho cùng tên U1.', 'There are no two sections of one dual op-amp yet. Place “LM358 (dual) section A” and “section B” and give them the same name U1.'),
  sectionsOk: n('{n} phần của {ref} nằm trong một vi mạch.', '{n} sections of {ref} sit in one chip.'),
  needSupply: n('Chưa nối nguồn cho vi mạch: nối V+ vào dương nguồn, V− xuống đất (ở một phần là đủ).', 'The chip has no supply yet: wire V+ to the positive rail and V− to ground (one section is enough).'),
  needInput: n('Điện áp ở IN gần bằng 0 nên không đo được độ lợi: cấp khoảng 0,5 V vào IN.', 'The voltage at IN is about 0, so the gain cannot be measured: feed about 0.5 V into IN.'),
  dualGainOk: n('Độ lợi Vout/Vin = {gain}.', 'Gain Vout/Vin = {gain}.'),
  dualGainWrong: n('Độ lợi Vout/Vin = {gain}, cần 2. Với phần B không đảo, Av = 1 + R2/R1: dùng R1 = R2.', 'The gain Vout/Vin = {gain}, 2 is needed. For the non-inverting section Av = 1 + R2/R1: use R1 = R2.'),
  // 8051 exact delay
  fixProgramFirst: n('Chương trình còn lỗi hợp ngữ nên chưa đếm được chu kỳ. Sửa lỗi ở bước trước.', 'The program still has an assembly error, so the cycles cannot be counted. Fix the previous step first.'),
  noToggle: n('P1.0 không đổi trạng thái trong 60 000 lệnh đầu. Dùng CPL P1.0 trong một vòng lặp vô hạn.', 'P1.0 does not change in the first 60,000 instructions. Use CPL P1.0 in an endless loop.'),
  cyclesOk: n('P1.0 đổi trạng thái sau đúng {cycles} chu kỳ máy.', 'P1.0 changes state after exactly {cycles} machine cycles.'),
  cyclesWrong: n('P1.0 đổi sau {cycles} chu kỳ máy, cần đúng {target}. Đi từng dòng (F10) trong gỡ lỗi để đếm; thêm hoặc bớt NOP.', 'P1.0 changes after {cycles} machine cycles, exactly {target} is needed. Step by line (F10) in the debugger to count; add or remove NOPs.'),
};
