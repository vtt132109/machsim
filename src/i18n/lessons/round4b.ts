/**
 * Lesson text for the round-4 lessons, part 2 (src/learn/lessons/round4b.ts): a relay latch, a
 * filter you can hear through a speaker, the runtime of a battery and a divider built by a script.
 * Original text written for MachSim from general circuit theory. See src/i18n/lessons/index.ts.
 */
import { L, type LocalizedText } from '../core';
import type { LessonText } from './index';

export const ROUND4B_TEXT: Record<string, LessonText> = {
  'relay-latch': {
    title: L('Mạch tự giữ bằng công-tắc-tơ', 'A latching circuit with a contactor'),
    goal: L(
      'Nối cuộn của công-tắc-tơ KM1 với tiếp điểm phụ KC1 bằng tên, rồi dùng tiếp điểm đó tự giữ cuộn sau khi nhả nút khởi động.',
      'Join the contactor coil KM1 to its auxiliary contact KC1 by name, then use that contact to hold the coil in after the start button is released.',
    ),
    theory: L(
      `## Cuộn và tiếp điểm tách rời
Trên sơ đồ điện công nghiệp, **cuộn** công-tắc-tơ và **tiếp điểm** của nó thường vẽ ở hai nơi — thậm chí hai trang. MachSim nối chúng bằng **tên**: ô “Cuộn hút” của tiếp điểm ghi tên cuộn (KM1). Khi cuộn có điện, mọi tiếp điểm mang tên KM1 đóng (hoặc mở nếu là tiếp điểm thường đóng).

Nếu tên không khớp cuộn nào, ERC cảnh báo “không có cuộn hút” và tiếp điểm ở nguyên trạng thái nghỉ.

## Tự giữ
Một nút nhấn khởi động chỉ đóng khi còn giữ tay. Muốn cuộn vẫn có điện sau khi nhả, ta nối **song song** với nút một tiếp điểm thường mở của chính cuộn đó:

$$\\text{cuộn có điện} = \\text{nút khởi động} \\lor \\text{tiếp điểm KC1}$$

Cuộn có điện → KC1 đóng → cuộn tiếp tục có điện. Mạch vẫn hoạt động cho đến khi nút Dừng cắt nguồn.

## Mạch của bài này
Để kiểm tra tự động, “nút nhấn” được thay bằng nguồn xung V2: 0 V, lên 24 V lúc 1 s và về 0 V lúc 2 s. Diode D1 cho xung đi vào cuộn nhưng không cho nguồn 24 V của KC1 chảy ngược vào V2. Trạng thái cuộn là điện áp nút KM1.st trong khoảng 0 … 1.

> Chân A1 của cuộn nối dây chung (net COIL); chân A2 xuống đất.`,
      `## Coil and contact apart
In an industrial schematic the **coil** of a contactor and its **contacts** are often drawn in different places — even on different sheets. MachSim joins them by **name**: the “Coil” field of the contact holds the coil’s name (KM1). When the coil is energised, every contact named KM1 closes (or opens if it is normally closed).

If the name matches no coil, ERC warns “no such coil” and the contact stays at rest.

## Latching
A start push-button is closed only while it is held. To keep the coil energised after release, put a normally-open contact of the same coil **in parallel** with the button:

$$\\text{coil on} = \\text{start button} \\lor \\text{contact KC1}$$

Coil on → KC1 closes → the coil stays on. The circuit keeps running until the Stop button cuts the supply.

## The circuit of this lesson
For an automatic check, the “button” is replaced by a pulse source V2: 0 V, up to 24 V at 1 s and back to 0 V at 2 s. Diode D1 lets the pulse into the coil but stops the 24 V of KC1 flowing back into V2. The coil state is the voltage of the node KM1.st between 0 and 1.

> Coil pin A1 joins the common net (COIL); pin A2 goes to ground.`,
    ),
    steps: {
      link: {
        task: L('Đặt cuộn công-tắc-tơ 24 V (KM1) và tiếp điểm phụ thường mở (KC1), ghi tên KM1 vào ô “Cuộn hút” của tiếp điểm.', 'Place a 24 V contactor coil (KM1) and a normally-open auxiliary contact (KC1), and type KM1 in the contact’s “Coil” field.'),
        hint: L('Họ “Cuộn công-tắc-tơ”: “Cuộn công-tắc-tơ 24 V DC”; họ “Tiếp điểm công-tắc-tơ”: “Tiếp điểm phụ công-tắc-tơ thường hở”. Ô “Cuộn hút” nằm trong Thuộc tính của tiếp điểm.', 'The Contactor coil family: “Contactor Coil 24 V DC”; the Contactor contact family: “Contactor Auxiliary Contact NO”. The “Coil” field is in the contact’s Properties.'),
      },
      hold: {
        task: L('Nối tiếp điểm KC1 giữa nguồn 24 V và chân A1 của cuộn (đó là nhánh tự giữ).', 'Wire KC1 between the 24 V supply and pin A1 of the coil (that is the holding branch).'),
        hint: L('Một chân của KC1 nối dương nguồn 24 V, chân kia nối nút chung với A1; A2 của cuộn xuống đất.', 'One pin of KC1 goes to the positive of the 24 V supply, the other to the common node with A1; coil pin A2 goes to ground.'),
      },
      start: {
        task: L('Dùng nguồn xung làm nút nhấn: 0 → 24 V lúc 1 s, rộng 1 s, qua diode vào A1. Chạy quá độ 4 s: lúc 1,5 s cuộn phải có điện.', 'Use a pulse source as the push-button: 0 → 24 V at 1 s, 1 s wide, through a diode into A1. Run a 4 s transient: at 1.5 s the coil must be energised.'),
        hint: L('Nguồn xung: v1 = 0, v2 = 24, trễ 1 s, rộng 1 s, chu kỳ 100 s. Diode 1N4007 có anode nối nguồn xung, cực âm nối A1.', 'Pulse source: v1 = 0, v2 = 24, delay 1 s, width 1 s, period 100 s. A 1N4007 diode with its anode on the pulse source and its cathode on A1.'),
      },
      latch: {
        task: L('Sau khi xung kết thúc (lúc 2 s) cuộn vẫn phải có điện: kiểm tra ở 3,5 s.', 'After the pulse has ended (at 2 s) the coil must still be energised: check at 3.5 s.'),
        hint: L('Nếu cuộn nhả, kiểm tra KC1 có nằm giữa nguồn 24 V và cuộn không, và ô “Cuộn hút” có đúng KM1.', 'If the coil drops out, check that KC1 sits between the 24 V supply and the coil and that its “Coil” field says KM1.'),
      },
    },
    quiz: {
      name: {
        q: L('Tiếp điểm KC1 biết nó thuộc cuộn nào bằng cách nào?', 'How does contact KC1 know which coil it belongs to?'),
        options: [L('Nó nằm gần cuộn trên sơ đồ', 'It sits near the coil on the schematic'), L('Tên cuộn ghi trong ô “Cuộn hút”', 'The coil’s name in the “Coil” field'), L('Nó cùng một chân với cuộn', 'It shares a pin with the coil')],
        why: L('Liên kết là bằng tên nên cuộn và tiếp điểm có thể ở hai trang khác nhau.', 'The link is by name, so the coil and contact may be on different sheets.'),
      },
      hold: {
        q: L('Tiếp điểm tự giữ mắc thế nào với nút Khởi động?', 'How is the holding contact wired against the Start button?'),
        options: [L('Nối tiếp', 'In series'), L('Không nối với nút', 'Not connected to the button'), L('Song song', 'In parallel')],
        why: L('Song song thì chỉ cần nút hoặc tiếp điểm đóng là cuộn có điện.', 'In parallel, either the button or the contact being closed energises the coil.'),
      },
      diode: {
        q: L('Diode D1 trong bài này để làm gì?', 'What is diode D1 for in this lesson?'),
        options: [L('Chặn nguồn 24 V của KC1 chảy ngược vào nguồn xung', 'Stops the 24 V of KC1 flowing back into the pulse source'), L('Chỉnh lưu điện áp xoay chiều', 'Rectifies an AC voltage'), L('Giảm điện áp cho cuộn', 'Lowers the voltage for the coil')],
        why: L('Không có diode, nguồn xung 0 V sẽ kéo nút COIL xuống đất và làm hỏng việc tự giữ.', 'Without the diode the 0 V pulse source would pull the COIL node to ground and ruin the latching.'),
      },
    },
  },

  'audio-filter': {
    title: L('Nghe tác dụng của bộ lọc qua loa', 'Hear what a filter does through a speaker'),
    goal: L(
      'Dựng bộ lọc thông thấp RC có mạch đệm op-amp nuôi loa, để âm trầm 440 Hz đi qua còn âm cao 3 kHz bị giảm xuống dưới một nửa — rồi mở cửa sổ Âm thanh để nghe.',
      'Build an RC low-pass with an op-amp buffer driving a speaker, so the low 440 Hz tone passes while the 3 kHz tone is cut to less than half — then open the Audio window and listen.',
    ),
    theory: L(
      `## Bộ lọc thông thấp
Điện trở R nối tiếp, tụ C xuống đất. Độ lợi ở tần số $f$ là:

$$|H(f)| = \\frac{1}{\\sqrt{1 + (f/f_c)^2}}, \\qquad f_c = \\frac{1}{2\\pi R C}$$

Với R = 1 kΩ, C = 100 nF: $f_c$ = 1,59 kHz. Âm 440 Hz: $|H|$ = 0,96 (gần nguyên vẹn). Âm 3 kHz: $|H|$ = 0,47 (giảm hơn một nửa).

## Vì sao cần mạch đệm
Loa 8 Ω nối thẳng vào tụ sẽ kéo điện áp xuống gần 0 — bộ lọc bị tải nặng đến mức chẳng còn lọc gì. Một **mạch đệm** (op-amp nối IN− với đầu ra) có trở kháng vào rất lớn và trở kháng ra rất nhỏ: nó lấy điện áp của bộ lọc mà không làm sụt, rồi đủ sức nuôi loa.

## Nghe bằng MachSim
Linh kiện **Loa** biến điện áp trên hai chân thành âm thanh thật. Mở **Mô phỏng › Âm thanh** rồi nhấn Chạy: mô phỏng chạy theo thời gian thực. Nếu mạch nặng hơn thời gian thực, cửa sổ báo âm bị kéo giãn (tần số hạ xuống). Đổi C để dời tần số cắt và nghe âm trầm / cao thay đổi.`,
      `## The low-pass filter
A series resistor R and a capacitor C to ground. The gain at frequency $f$ is:

$$|H(f)| = \\frac{1}{\\sqrt{1 + (f/f_c)^2}}, \\qquad f_c = \\frac{1}{2\\pi R C}$$

With R = 1 kΩ and C = 100 nF: $f_c$ = 1.59 kHz. The 440 Hz tone: $|H|$ = 0.96 (almost unchanged). The 3 kHz tone: $|H|$ = 0.47 (cut by more than half).

## Why a buffer
An 8 Ω speaker wired straight onto the capacitor would pull the voltage down to almost nothing — the filter is so heavily loaded it no longer filters. A **buffer** (an op-amp with IN− tied to its output) has a very large input impedance and a very small output impedance: it takes the filter’s voltage without sagging it and can drive the speaker.

## Listening in MachSim
The **Speaker** part turns the voltage across its pins into real sound. Open **Simulate › Audio** and press Run: the simulation runs in real time. If the circuit is heavier than real time the window says the sound is being stretched (the pitch drops). Change C to move the cut-off and hear the low and high tones change.`,
    ),
    steps: {
      speaker: {
        task: L('Đặt một Loa và nối cả hai chân của nó.', 'Place a Speaker and wire both of its pins.'),
        hint: L('Thư viện: nhóm Chỉ thị → họ Loa → “Loa”. Chân − nối đất.', 'Library: the Indicators group → Speaker family → “Speaker”. Pin − goes to ground.'),
      },
      filter: {
        task: L('Dựng bộ lọc RC với tần số cắt từ 0,8 đến 3 kHz (ví dụ R = 1 kΩ, C = 100 nF).', 'Build an RC filter with a corner frequency between 0.8 and 3 kHz (for example R = 1 kΩ, C = 100 nF).'),
        hint: L('Nguồn xoay chiều → R nối tiếp → điểm F; tụ nối F xuống đất. fc = 1/(2πRC).', 'AC source → series R → point F; the capacitor from F to ground. fc = 1/(2πRC).'),
      },
      buffer: {
        task: L('Dùng op-amp làm mạch đệm: IN+ nhận điểm F, IN− nối đầu ra, và đầu ra nuôi loa.', 'Use an op-amp as a buffer: IN+ takes point F, IN− goes to the output, and the output feeds the speaker.'),
        hint: L('Op-amp lý tưởng 3 chân là đủ. Chân + của loa nối đầu ra op-amp.', 'The 3-pin ideal op-amp is enough. The speaker + pin goes to the op-amp output.'),
      },
      tones: {
        task: L('Kiểm tra bằng phân tích AC đơn tần: âm 440 Hz phải qua (≥ 0,9), âm 3 kHz phải bị giảm (≤ 0,55) tại chân + của loa.', 'Check with a single-frequency AC analysis: the 440 Hz tone must pass (≥ 0.9) and the 3 kHz tone must be cut (≤ 0.55) at the speaker + pin.'),
        hint: L('Nếu 440 Hz cũng mất, loa đang làm tải nặng: kiểm tra mạch đệm. Muốn nghe thật, mở Mô phỏng › Âm thanh rồi Chạy.', 'If the 440 Hz tone is lost too, the speaker is loading the filter: check the buffer. To hear it, open Simulate › Audio and press Run.'),
      },
    },
    quiz: {
      buffer: {
        q: L('Vì sao cần mạch đệm giữa bộ lọc RC và loa?', 'Why is a buffer needed between the RC filter and the speaker?'),
        options: [L('Loa trở kháng thấp sẽ tải nặng bộ lọc nếu nối thẳng', 'A low-impedance speaker would load the filter heavily if wired straight on'), L('Để tăng tần số cắt', 'To raise the corner frequency'), L('Vì loa cần nguồn một chiều', 'Because the speaker needs DC')],
        why: L('Mạch đệm có trở kháng vào lớn, ra nhỏ nên bộ lọc giữ đúng đáp tuyến khi nuôi loa.', 'A buffer has a large input and a small output impedance, so the filter keeps its response while driving the speaker.'),
      },
      pitch: {
        q: L('Nếu mô phỏng chạy chậm hơn thời gian thực, âm nghe được sẽ…', 'If the simulation runs slower than real time, the sound you hear…'),
        options: [L('to hơn', 'gets louder'), L('bị kéo giãn nên trầm hơn', 'is stretched and lower in pitch'), L('không đổi', 'is unchanged')],
        why: L('MachSim phát chậm lại cho khớp tốc độ tính nên cao độ hạ xuống; cửa sổ Âm thanh có báo.', 'MachSim slows the playback to match the calculation speed, so the pitch drops; the Audio window says so.'),
      },
      cut: {
        q: L('Ở đúng tần số cắt, bộ lọc RC cho độ lợi…', 'Exactly at the corner frequency the RC filter has a gain of…'),
        options: [L('1', '1'), L('0,5', '0.5'), L('0,707 (−3 dB)', '0.707 (−3 dB)')],
        why: L('Tại f = fc, |H| = 1/√2 ≈ 0,707, tức −3 dB.', 'At f = fc, |H| = 1/√2 ≈ 0.707, which is −3 dB.'),
      },
    },
  },

  'battery-runtime': {
    title: L('Pin chạy được bao lâu?', 'How long does a battery last?'),
    goal: L(
      'Dùng pin Li-ion 5 mAh nuôi một tải dòng không đổi, chọn dòng sao cho pin cạn sau đúng 6 phút, rồi đọc mức điện tích của pin trong kết quả mô phỏng để kiểm chứng.',
      'Feed a constant-current load from a 5 mAh Li-ion battery, choose the current so it runs empty after exactly 6 minutes, then read the battery’s state of charge in the simulation to check.',
    ),
    theory: L(
      `## Dung lượng và thời gian chạy
Dung lượng của pin tính bằng ampe-giờ ($Ah$). Một pin $C$ Ah cấp dòng không đổi $I$ sẽ cạn sau:

$$t = \\frac{C \\cdot 3600}{I}\\ \\text{(giây)}$$

Pin 5 mAh cấp 50 mA: $t = \\frac{0{,}005 \\cdot 3600}{0{,}05}$ = 360 s. Con số 3600 là số giây trong một giờ.

## Pin không lý tưởng
Linh kiện pin của MachSim đếm điện tích: **mức điện tích** (state of charge, SoC, từ 1 xuống 0) giảm theo $I/(3600\\,C)$ mỗi giây. Điện áp theo đường cong xả của hoá học pin (alkaline, NiMH, Li-ion, axit–chì) và điện trở trong **tăng** khi pin cạn. Mức điện tích đọc được ở nút V(BT1.soc).

## Tải dòng không đổi và tải điện trở
Tải **dòng không đổi** làm SoC giảm đều theo đường thẳng. Tải **điện trở** lấy dòng $V/R$ nên khi điện áp pin tụt, dòng nhỏ đi và pin trụ lâu hơn một chút so với tính tay. Trong bài này dùng nguồn dòng để công thức đúng chính xác.

> Nguồn dòng phải kéo dòng ra khỏi cực dương của pin (pin đang phóng điện). Nối ngược là đang sạc: alkaline không sạc được.`,
      `## Capacity and runtime
Battery capacity is measured in ampere-hours ($Ah$). A battery of $C$ Ah delivering a constant current $I$ runs empty after:

$$t = \\frac{C \\cdot 3600}{I}\\ \\text{(seconds)}$$

A 5 mAh battery delivering 50 mA: $t = \\frac{0.005 \\cdot 3600}{0.05}$ = 360 s. The 3600 is the number of seconds in an hour.

## A non-ideal battery
The MachSim battery part counts charge: the **state of charge** (SoC, from 1 down to 0) falls by $I/(3600\\,C)$ every second. The voltage follows the discharge curve of the chemistry (alkaline, NiMH, Li-ion, lead-acid) and the internal resistance **rises** as the battery empties. You can read the state of charge at the node V(BT1.soc).

## Constant-current and resistor loads
A **constant-current** load makes the SoC fall in a straight line. A **resistor** load draws $V/R$, so as the battery voltage sags the current shrinks and the battery lasts a little longer than a hand calculation says. This lesson uses a current source so the formula is exact.

> The current source must pull current OUT of the battery’s positive terminal (the battery is discharging). Wired the other way it charges the battery: alkaline cells cannot be charged.`,
    ),
    steps: {
      battery: {
        task: L('Đặt một “Pin không lý tưởng” với dung lượng 5 mAh (0,005 Ah), hoá học Li-ion, đầy điện.', 'Place a “Non-ideal battery” with a capacity of 5 mAh (0.005 Ah), Li-ion chemistry, fully charged.'),
        hint: L('Thư viện: nhóm Nguồn → họ Pin. Sửa “Dung lượng” thành 0.005 và “Hoá học” thành Li-ion.', 'Library: the Sources group → Batteries family. Set “Capacity” to 0.005 and “Chemistry” to Li-ion.'),
      },
      load: {
        task: L('Nối một nguồn dòng DC qua hai cực của pin, theo chiều làm pin phóng điện (kéo dòng ra khỏi cực +).', 'Wire a DC current source across the battery, in the direction that discharges it (pulling current out of the + terminal).'),
        hint: L('Chân + của nguồn dòng nối cực − của pin; chân − của nguồn dòng nối cực + của pin. Nối cực − của pin xuống đất.', 'The + pin of the current source goes to the battery’s − terminal; the − pin of the current source goes to the battery’s + terminal. Connect the battery’s − terminal to ground.'),
      },
      runtime: {
        task: L('Chọn dòng tải để pin cạn sau đúng 360 s, chạy quá độ 420 s: mức điện tích phải xuống 0,5 lúc 180 s.', 'Choose the load current so the battery runs empty after exactly 360 s, run a 420 s transient: the state of charge must reach 0.5 at 180 s.'),
        hint: L('I = C × 3600 / t = 0,005 × 3600 / 360 = 50 mA. Quá độ: bước 2 s, dừng 420 s. Vẽ V(BT1.soc) trong Máy vẽ.', 'I = C × 3600 / t = 0.005 × 3600 / 360 = 50 mA. Transient: step 2 s, stop 420 s. Plot V(BT1.soc) in the Grapher.'),
      },
    },
    quiz: {
      formula: {
        q: L('Pin 2 Ah cấp dòng không đổi 0,5 A thì cạn sau…', 'A 2 Ah battery delivering a constant 0.5 A runs empty after…'),
        options: [L('1 giờ', '1 hour'), L('2 giờ', '2 hours'), L('4 giờ', '4 hours')],
        why: L('t = C/I = 2 Ah / 0,5 A = 4 giờ (= 14 400 s).', 't = C/I = 2 Ah / 0.5 A = 4 hours (= 14,400 s).'),
      },
      sag: {
        q: L('Với tải điện trở, vì sao pin trụ lâu hơn so với tính tay lúc đầy?', 'With a resistor load, why does the battery last longer than the full-charge hand calculation?'),
        options: [L('Điện áp pin tụt nên dòng V/R nhỏ dần', 'The battery voltage sags so the current V/R shrinks'), L('Điện trở tự nguội đi', 'The resistor cools down'), L('Pin tự nạp thêm', 'The battery charges itself')],
        why: L('Dòng nhỏ đi nghĩa là điện tích tiêu hao chậm lại.', 'A smaller current means the charge is used up more slowly.'),
      },
      direction: {
        q: L('Nguồn dòng mắc ngược chiều sẽ làm gì với pin Li-ion?', 'What does a reversed current source do to a Li-ion battery?'),
        options: [L('Không làm gì', 'Nothing'), L('Sạc pin (mức điện tích tăng)', 'Charges it (the state of charge rises)'), L('Làm pin cạn nhanh gấp đôi', 'Empties it twice as fast')],
        why: L('Dòng đi vào cực + là sạc; mô hình dừng sạc ở 100 %.', 'Current into the + terminal is charging; the model stops charging at 100 %.'),
      },
    },
  },

  'script-sweep': {
    title: L('Dựng mạch bằng tập lệnh JavaScript', 'Build a circuit with a JavaScript script'),
    goal: L(
      'Viết một tập lệnh ngắn tự đặt nguồn 12 V và hai điện trở 2k / 1k thành cầu phân áp, đặt tên điểm giữa là mid, chạy phân tích và đọc điện áp 4 V.',
      'Write a short script that places a 12 V source and two resistors 2k / 1k as a divider, names the middle point mid, runs the analysis and reads 4 V.',
    ),
    theory: L(
      `## Tập lệnh để làm gì
Khi cần dựng nhiều mạch giống nhau hay thử hàng chục giá trị, bấm tay rất mệt. **Công cụ › Tập lệnh (JavaScript)** mở một cửa sổ soạn mã: chương trình của bạn đặt linh kiện, nối dây, đổi giá trị, chạy phân tích và đọc kết quả. Nó chạy trong **hộp cát** — không đọc được tệp của bạn; mở hay lưu tệp nào cũng hỏi bạn trước.

## Mọi hàm đều bất đồng bộ
Viết \`await\` trước mỗi hàm \`MachSim.xxx()\`. Chân gọi là "R1.2" (tên linh kiện, dấu chấm, chân).

## Mạch phân áp
Nguồn $V$ qua $R_1$ rồi $R_2$ xuống đất:

$$V_{mid} = V\\,\\frac{R_2}{R_1 + R_2}$$

Với 12 V, 2k, 1k: $V_{mid}$ = 12 × 1/3 = 4 V.

## Một tập lệnh mẫu
- \`await MachSim.newDesign('Phan ap');\`
- \`await MachSim.place('dc-voltage', 100, 200, { value: '12' });\`
- \`await MachSim.place('resistor', 200, 150, { value: '2k' });\`
- \`await MachSim.place('resistor', 300, 200, { value: '1k', rotation: 90 });\`
- \`await MachSim.net('in', 'V1.+', 'R1.1');\`
- \`await MachSim.net('mid', 'R1.2', 'R2.1');\`
- \`await MachSim.ground('V1.-'); await MachSim.ground('R2.2');\`
- \`await MachSim.showDesign();\` rồi \`const op = await MachSim.run('op');\`

Kết quả của hàm \`run\` có \`op.get('mid')[0]\`. Dùng \`showDesign()\` để mở mạch vừa dựng thành một thẻ thiết kế mới, và bài này kiểm tra mạch đó.`,
      `## What a script is for
When you need to build many similar circuits or try dozens of values, clicking by hand is tiring. **Tools › Scripts (JavaScript)** opens a code window: your program places parts, wires them, changes values, runs analyses and reads the results. It runs in a **sandbox** — it cannot read your files; opening or saving any file asks you first.

## Every function is asynchronous
Write \`await\` before each \`MachSim.xxx()\` function. A pin is written "R1.2" (part name, dot, pin).

## The divider
A source $V$ through $R_1$ and then $R_2$ to ground:

$$V_{mid} = V\\,\\frac{R_2}{R_1 + R_2}$$

With 12 V, 2k and 1k: $V_{mid}$ = 12 × 1/3 = 4 V.

## A sample script
- \`await MachSim.newDesign('Divider');\`
- \`await MachSim.place('dc-voltage', 100, 200, { value: '12' });\`
- \`await MachSim.place('resistor', 200, 150, { value: '2k' });\`
- \`await MachSim.place('resistor', 300, 200, { value: '1k', rotation: 90 });\`
- \`await MachSim.net('in', 'V1.+', 'R1.1');\`
- \`await MachSim.net('mid', 'R1.2', 'R2.1');\`
- \`await MachSim.ground('V1.-'); await MachSim.ground('R2.2');\`
- \`await MachSim.showDesign();\` then \`const op = await MachSim.run('op');\`

The result of \`run\` offers \`op.get('mid')[0]\`. Use \`showDesign()\` to open the circuit you built as a new design tab, and this lesson checks that circuit.`,
    ),
    steps: {
      parts: {
        task: L('Trong cửa sổ Tập lệnh, viết đoạn mã đặt nguồn DC và hai điện trở, rồi gọi MachSim.showDesign() để mở mạch ra thành thiết kế mới.', 'In the Scripts window write code that places a DC source and two resistors, then call MachSim.showDesign() to open the circuit as a new design.'),
        hint: L('Công cụ › Tập lệnh (JavaScript), nạp ví dụ “Dựng mạch phân áp” rồi sửa số: nguồn 12, R1 = 2k, R2 = 1k. Nhấn Chạy (Ctrl+Enter).', 'Tools › Scripts (JavaScript), load the example “Build a divider and read the voltage” and change the numbers: source 12, R1 = 2k, R2 = 1k. Press Run (Ctrl+Enter).'),
      },
      name: {
        task: L('Đặt tên điểm giữa hai điện trở là mid bằng MachSim.net(\'mid\', …).', 'Name the point between the two resistors mid with MachSim.net(\'mid\', …).'),
        hint: L('MachSim.net(\'mid\', \'R1.2\', \'R2.1\') nối hai chân và đặt nhãn mid. Nhớ nối đất nguồn và R2.', 'MachSim.net(\'mid\', \'R1.2\', \'R2.1\') joins the two pins and puts a label mid. Remember to ground the source and R2.'),
      },
      value: {
        task: L('Điện áp ở mid phải bằng 4 V (12 V × 1k/(2k + 1k)).', 'The voltage at mid must be 4 V (12 V × 1k/(2k + 1k)).'),
        hint: L('Nếu khác 4 V, kiểm tra giá trị: nguồn 12, R1 = 2k nối nguồn, R2 = 1k xuống đất.', 'If it is not 4 V check the values: source 12, R1 = 2k on the source side, R2 = 1k to ground.'),
      },
    },
    quiz: {
      await: {
        q: L('Vì sao phải viết await trước MachSim.place(…)?', 'Why is await written before MachSim.place(…)?'),
        options: [L('Để chạy nhanh hơn', 'To run faster'), L('Mọi hàm MachSim đều bất đồng bộ nên phải đợi xong', 'Every MachSim function is asynchronous, so you wait for it to finish'), L('Chỉ để cho đẹp', 'Only for looks')],
        why: L('Không đợi thì lệnh sau có thể chạy khi linh kiện chưa đặt xong.', 'Without it the next command could run before the part is placed.'),
      },
      where: {
        q: L('Tập lệnh làm việc trên bản nào của thiết kế?', 'Which copy of a design does a script work on?'),
        options: [L('Bản riêng của nó, chỉ hiện ra khi gọi showDesign()', 'Its own copy, which appears only when showDesign() is called'), L('Thiết kế đang mở, sửa trực tiếp', 'The open design, edited directly'), L('Một tệp trên đĩa', 'A file on disk')],
        why: L('Nhờ vậy một tập lệnh lỗi không làm hỏng bài đang làm của bạn.', 'That way a faulty script cannot damage the work you have open.'),
      },
      safe: {
        q: L('Tập lệnh có tự ý đọc tệp trên máy không?', 'Can a script read files on your computer by itself?'),
        options: [L('Có, mọi tệp', 'Yes, any file'), L('Chỉ tệp trong thư mục MachSim', 'Only files in the MachSim folder'), L('Không: mỗi lần mở hay lưu tệp đều phải được bạn đồng ý', 'No: every open or save needs your approval')],
        why: L('Tập lệnh chạy trong hộp cát và chỉ ra ngoài qua các hàm MachSim.', 'The script runs in a sandbox and reaches the outside only through the MachSim functions.'),
      },
    },
  },
};

const n = (vi: string, en: string): LocalizedText => L(vi, en);

/** Lesson-specific feedback of the round-4 lessons, part 2 (`note:<key>`). */
export const ROUND4B_NOTES: Record<string, LocalizedText> = {
  // relay latch
  needCoilPart: n('Chưa có cuộn công-tắc-tơ hay rơ-le. Thư viện: nhóm Cơ điện → “Cuộn công-tắc-tơ 24 V DC”.', 'There is no contactor or relay coil yet. Library: Electromechanical → “Contactor Coil 24 V DC”.'),
  needContactPart: n('Chưa có tiếp điểm nào gắn với cuộn. Đặt “Tiếp điểm phụ công-tắc-tơ thường hở” và ghi tên cuộn vào ô “Cuộn hút”.', 'No contact is tied to a coil yet. Place a “Contactor Auxiliary Contact NO” and type the coil’s name in its “Coil” field.'),
  linkOk: n('Tiếp điểm {contact} theo cuộn {coil}.', 'Contact {contact} follows coil {coil}.'),
  contactNotLinked: n('Tiếp điểm {contact} đang theo cuộn “{coil}”, nhưng cuộn trên sơ đồ là {coils}. Sửa ô “Cuộn hút”.', 'Contact {contact} follows coil “{coil}”, but the coil on the schematic is {coils}. Fix its “Coil” field.'),
  needHold: n('Tiếp điểm chưa nằm ở nhánh tự giữ: một chân phải nối cùng nút với chân không nối đất của cuộn.', 'The contact is not in the holding branch yet: one pin must join the same node as the coil pin that is not grounded.'),
  needHoldSupply: n('Chân còn lại của tiếp điểm phải nối nguồn (không phải đất) để giữ được cuộn.', 'The other pin of the contact must go to the supply (not to ground) to hold the coil.'),
  relayEarly: n('Cuộn đã có điện ({value}) trước khi nhấn khởi động. Kiểm tra nguồn xung và diode.', 'The coil is already energised ({value}) before the start pulse. Check the pulse source and the diode.'),
  relayStartOk: n('Xung khởi động làm cuộn có điện.', 'The start pulse energises the coil.'),
  relayStartWrong: n('Lúc 1,5 s cuộn chưa có điện (trạng thái {value}). Kiểm tra xung đi qua diode vào chân A1 và A2 xuống đất.', 'At 1.5 s the coil is not energised (state {value}). Check the pulse reaches A1 through the diode and A2 goes to ground.'),
  relayHoldOk: n('Sau khi xung kết thúc cuộn vẫn có điện: mạch đã tự giữ.', 'The coil stays energised after the pulse: the circuit latches.'),
  relayHoldWrong: n('Lúc 3,5 s cuộn đã nhả (trạng thái {value}). Tiếp điểm KC1 phải nối nguồn 24 V với A1 và có tên cuộn trong ô “Cuộn hút”.', 'At 3.5 s the coil has dropped out (state {value}). Contact KC1 must join the 24 V supply to A1 and carry the coil’s name in its “Coil” field.'),
  // audio filter
  needSpeaker: n('Chưa có loa. Thư viện: nhóm Chỉ thị → họ Loa.', 'There is no speaker yet. Library: Indicators → Speaker family.'),
  speakerWires: n('Loa chưa được nối đủ hai chân.', 'Both pins of the speaker are not wired yet.'),
  audioFcOk: n('Tần số cắt fc ≈ {fc}.', 'The corner frequency is fc ≈ {fc}.'),
  audioFcRange: n('fc = {fc}: nằm ngoài khoảng 0,8 … 3 kHz nên không tách được âm 440 Hz khỏi 3 kHz. Đổi R hoặc C.', 'fc = {fc}: outside 0.8 … 3 kHz, so 440 Hz cannot be told from 3 kHz. Change R or C.'),
  needBuffer: n('Chưa có mạch đệm: đầu ra của một op-amp phải nối chân + của loa.', 'There is no buffer yet: the output of an op-amp must be wired to the + pin of the speaker.'),
  audioLowLost: n('Âm 440 Hz chỉ còn {ratio} lần ở loa; bộ lọc đang bị tải nặng hoặc fc quá thấp. Kiểm tra mạch đệm.', 'The 440 Hz tone is only {ratio} of the input at the speaker; the filter is heavily loaded or fc is too low. Check the buffer.'),
  audioHighStays: n('Âm 3 kHz còn {ratio} lần ở loa, chưa giảm đủ (≤ 0,55). Hạ tần số cắt (tăng R hoặc C).', 'The 3 kHz tone is still {ratio} of the input at the speaker, not cut enough (≤ 0.55). Lower the corner frequency (raise R or C).'),
  audioOk: n('Tại loa: 440 Hz còn {low} lần, 3 kHz còn {high} lần. Mở Mô phỏng › Âm thanh để nghe.', 'At the speaker: 440 Hz keeps {low} of the input, 3 kHz keeps {high}. Open Simulate › Audio to listen.'),
  // battery runtime
  needBattery: n('Chưa có pin. Thư viện: nhóm Nguồn → họ Pin → “Pin không lý tưởng”.', 'There is no battery yet. Library: Sources → Batteries family → “Non-ideal battery”.'),
  capacityWrong: n('Dung lượng đang là {ah}; bài này dùng 5 mAh (0,005 Ah).', 'The capacity is {ah}; this lesson uses 5 mAh (0.005 Ah).'),
  needLoadSource: n('Chưa có nguồn dòng làm tải. Thư viện: nhóm Nguồn → “Nguồn dòng DC”.', 'There is no current source as a load yet. Library: Sources → “DC current source”.'),
  chargeDirection: n('Nguồn dòng đang đẩy dòng VÀO cực + của pin (đang sạc). Đổi chiều: chân + của nguồn dòng nối cực − của pin.', 'The current source pushes current INTO the + terminal (charging). Reverse it: the + pin of the source goes to the battery’s − terminal.'),
  loadNotAcross: n('Nguồn dòng chưa nối đúng qua hai cực của pin.', 'The current source is not wired across the two terminals of the battery.'),
  neverHalf: n('Mức điện tích không xuống tới 0,5 trong 420 s: dòng tải quá nhỏ. Với 5 mAh cần khoảng 50 mA để cạn sau 360 s.', 'The state of charge never reaches 0.5 in 420 s: the load current is too small. With 5 mAh you need about 50 mA to be empty after 360 s.'),
  runtimeOk: n('Pin cạn sau khoảng {t}.', 'The battery runs empty after about {t}.'),
  runtimeWrong: n('Pin cạn sau khoảng {t}, cần {target}. Dòng = C × 3600 / t.', 'The battery runs empty after about {t}, {target} is needed. Current = C × 3600 / t.'),
  // script
  needMidLabel: n('Chưa có nút tên mid. Trong tập lệnh dùng MachSim.net(\'mid\', \'R1.2\', \'R2.1\') và gọi showDesign() để mở mạch.', 'There is no node named mid. In the script use MachSim.net(\'mid\', \'R1.2\', \'R2.1\') and call showDesign() to open the circuit.'),
};
