/**
 * Lesson text: circuit basics (Ohm's law, divider, series / parallel, Kirchhoff, RC charging,
 * RC low-pass). Original text for MachSim. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const BASICS_TEXT: Record<string, LessonText> = {
  ohm: {
    title: L('Định luật Ohm', 'Ohm’s law'),
    goal: L('Dựng mạch một nguồn và một điện trở, rồi đo dòng điện để thấy I = U / R.', 'Build a one-source, one-resistor circuit and measure the current to see I = V / R.'),
    theory: L(
      `## Điện áp, dòng điện, điện trở
Điện áp **U** (vôn, V) là “áp lực” đẩy các điện tích đi. Dòng điện **I** (ampe, A) là lượng điện tích chảy qua mỗi giây. Điện trở **R** (ôm, Ω) cản dòng điện.

$$I = \\frac{U}{R}$$

Ví dụ: nguồn 9 V nối vào điện trở 1 kΩ thì $I = 9 / 1000 = 0.009$ A = 9 mA.

> Đồng hồ đo **dòng** (chế độ A) phải mắc **nối tiếp**: dòng điện phải chạy xuyên qua đồng hồ.`,
      `## Voltage, current, resistance
Voltage **V** (volt) is the “pressure” that pushes charges. Current **I** (ampere, A) is the charge flowing each second. Resistance **R** (ohm, Ω) opposes the current.

$$I = \\frac{V}{R}$$

Example: a 9 V source across 1 kΩ gives $I = 9 / 1000 = 0.009$ A = 9 mA.

> A **current** meter (A mode) goes **in series**: the current has to flow through the meter.`,
    ),
    steps: {
      source: { task: L('Đặt một nguồn áp DC và đặt giá trị 9 V.', 'Place a DC voltage source and set it to 9 V.'), hint: L('Thư viện: Nguồn → Nguồn áp → Nguồn áp DC. Nhấp đúp vào nguồn để sửa giá trị.', 'Library: Sources → Voltage sources → DC Voltage Source. Double-click it to edit the value.') },
      resistor: { task: L('Đặt một điện trở 1 kΩ.', 'Place a 1 kΩ resistor.'), hint: L('Linh kiện cơ bản → Điện trở. Gõ 1k vào ô Giá trị.', 'Basic → Resistor. Type 1k as its value.') },
      loop: { task: L('Nối điện trở vào hai cực của nguồn và nối cực − xuống đất.', 'Connect the resistor across the source and ground the − terminal.'), hint: L('Đặt ký hiệu Đất (nhóm Nguồn → Nguồn điện) và nối vào cực −. Nhấp vào đầu chân để bắt đầu một dây.', 'Place a Ground symbol (Sources → Power) on the − terminal. Click a pin end to start a wire.') },
      ammeter: { task: L('Mắc đồng hồ vạn năng ở chế độ A nối tiếp trong mạch để đo dòng điện.', 'Put a multimeter in A mode in series to measure the current.'), hint: L('Xoá một dây, rồi nối hai cực của đồng hồ vào hai đầu chỗ vừa hở. Nhấp đúp vào đồng hồ, chọn A, rồi chạy mô phỏng (F5).', 'Delete one wire and connect the meter’s two terminals across the gap. Double-click the meter, choose A, then run (F5).') },
    },
    quiz: {
      double: { q: L('Giữ nguồn 9 V, đổi điện trở thành 2 kΩ. Dòng điện bằng bao nhiêu?', 'Keep 9 V and change the resistor to 2 kΩ. What is the current?'), options: [L('9 mA', '9 mA'), L('4.5 mA', '4.5 mA'), L('18 mA', '18 mA'), L('2 mA', '2 mA')], why: L('I = 9 V / 2000 Ω = 4.5 mA: điện trở gấp đôi thì dòng giảm một nửa.', 'I = 9 V / 2000 Ω = 4.5 mA: twice the resistance halves the current.') },
      unit: { q: L('Đơn vị của điện trở là gì?', 'What is the unit of resistance?'), options: [L('Ôm (Ω)', 'Ohm (Ω)'), L('Vôn (V)', 'Volt (V)'), L('Ampe (A)', 'Ampere (A)')], why: L('Điện trở đo bằng ôm; 1 Ω cho dòng 1 A khi đặt điện áp 1 V.', 'Resistance is measured in ohms; 1 Ω passes 1 A at 1 V.') },
      series: { q: L('Muốn đo dòng điện qua điện trở, mắc đồng hồ thế nào?', 'How do you connect a meter to measure the current through a resistor?'), options: [L('Song song với điện trở', 'Across the resistor'), L('Nối tiếp với điện trở', 'In series with the resistor'), L('Giữa cực + và đất', 'Between + and ground')], why: L('Dòng điện phải chạy qua đồng hồ, nên đồng hồ đo dòng mắc nối tiếp. Mắc song song là đo điện áp.', 'The current must flow through the meter, so an ammeter goes in series. Across is how you measure voltage.') },
    },
  },

  divider: {
    title: L('Cầu phân áp', 'Voltage divider'),
    goal: L('Dùng hai điện trở để lấy ra 4 V từ nguồn 12 V.', 'Use two resistors to get 4 V out of a 12 V source.'),
    theory: L(
      `## Hai điện trở nối tiếp chia điện áp
Cùng một dòng chạy qua R1 và R2, nên điện áp chia theo tỉ lệ điện trở:

$$U_{ra} = U_{vào} \\cdot \\frac{R_2}{R_1 + R_2}$$

Muốn 4 V từ 12 V thì $R_2 / (R_1 + R_2) = 1/3$, ví dụ R1 = 20 kΩ, R2 = 10 kΩ.

> Đồng hồ đo **điện áp** (chế độ V) mắc **song song** với phần mạch cần đo.`,
      `## Two series resistors divide the voltage
The same current flows through R1 and R2, so the voltage divides in the ratio of the resistances:

$$V_{out} = V_{in} \\cdot \\frac{R_2}{R_1 + R_2}$$

For 4 V from 12 V, $R_2 / (R_1 + R_2) = 1/3$, for example R1 = 20 kΩ and R2 = 10 kΩ.

> A **voltage** meter (V mode) goes **across** the part you measure.`,
    ),
    steps: {
      parts: { task: L('Đặt nguồn áp DC 12 V và hai điện trở.', 'Place a 12 V DC source and two resistors.'), hint: L('Ctrl+K rồi gõ “dien tro” hoặc “resistor” để tìm nhanh.', 'Press Ctrl+K and type “resistor” to find it quickly.') },
      series: { task: L('Nối hai điện trở nối tiếp từ cực + của nguồn xuống đất.', 'Connect the resistors in series from the source’s + terminal to ground.'), hint: L('+ → R1 → điểm giữa → R2 → đất; cực − của nguồn cũng nối đất.', '+ → R1 → midpoint → R2 → ground; the source’s − terminal goes to ground too.') },
      meter: { task: L('Mắc đồng hồ vạn năng (chế độ V) song song với điện trở phía dưới.', 'Connect a multimeter (V mode) across the lower resistor.'), hint: L('Cực + của đồng hồ vào điểm giữa, cực − xuống đất.', 'Meter + to the midpoint, meter − to ground.') },
      target: { task: L('Chọn R1 và R2 để đồng hồ đọc 4 V (± 3 %).', 'Choose R1 and R2 so the meter reads 4 V (± 3 %).'), hint: L('R2 phải bằng một nửa R1. Chạy mô phỏng và mở đồng hồ để đọc.', 'R2 must be half of R1. Run and open the meter to read it.') },
    },
    quiz: {
      equal: { q: L('R1 = R2 và nguồn 10 V. Điện áp ra bằng?', 'R1 = R2 with a 10 V source. What is the output?'), options: [L('10 V', '10 V'), L('0 V', '0 V'), L('5 V', '5 V'), L('2.5 V', '2.5 V')], why: L('Hai điện trở bằng nhau chia đôi điện áp: 10 · 1/2 = 5 V.', 'Equal resistors halve the voltage: 10 · 1/2 = 5 V.') },
      load: { q: L('Mắc thêm một điện trở tải song song với R2. Điện áp ra sẽ…', 'A load resistor is added across R2. The output…'), options: [L('tăng', 'rises'), L('giảm', 'falls'), L('không đổi', 'stays the same')], why: L('R2 song song với tải nhỏ hơn R2, nên phần điện áp trên nó giảm. Cầu phân áp chỉ chính xác khi tải lớn hơn nhiều so với R2.', 'R2 in parallel with the load is smaller than R2, so its share of the voltage falls. A divider is only accurate with a load much larger than R2.') },
      formula: { q: L('Công thức nào đúng cho điện áp ra?', 'Which formula gives the output?'), options: [L('Uvào · R2 / (R1 + R2)', 'Vin · R2 / (R1 + R2)'), L('Uvào · R1 / R2', 'Vin · R1 / R2'), L('Uvào · (R1 + R2) / R2', 'Vin · (R1 + R2) / R2')], why: L('Điện áp trên R2 bằng dòng chung Uvào/(R1+R2) nhân với R2.', 'The voltage on R2 is the common current Vin/(R1+R2) times R2.') },
    },
  },

  'series-parallel': {
    title: L('Nối tiếp và song song', 'Series and parallel'),
    goal: L('Ghép ba điện trở để mạch 10 V lấy đúng 5 mA.', 'Combine three resistors so a 10 V circuit draws exactly 5 mA.'),
    theory: L(
      `## Ghép điện trở
**Nối tiếp**: cùng một dòng điện chạy qua, điện trở cộng lại: $R = R_1 + R_2$.

**Song song**: cùng một điện áp, dòng chia ra các nhánh:

$$\\frac{1}{R} = \\frac{1}{R_2} + \\frac{1}{R_3}$$

Hai điện trở 2 kΩ song song cho 1 kΩ. Nối tiếp thêm 1 kΩ thì tổng là 2 kΩ, và 10 V / 2 kΩ = 5 mA.`,
      `## Combining resistors
**Series**: one current flows through them, the resistances add: $R = R_1 + R_2$.

**Parallel**: one voltage, the current splits between the branches:

$$\\frac{1}{R} = \\frac{1}{R_2} + \\frac{1}{R_3}$$

Two 2 kΩ resistors in parallel make 1 kΩ. Add 1 kΩ in series for 2 kΩ in total, and 10 V / 2 kΩ = 5 mA.`,
    ),
    steps: {
      parts: { task: L('Đặt nguồn DC 10 V và ba điện trở.', 'Place a 10 V DC source and three resistors.'), hint: L('Chọn một điện trở rồi Ctrl+D để nhân bản nhanh.', 'Select a resistor and press Ctrl+D to duplicate it.') },
      parallel: { task: L('Nối hai điện trở song song với nhau.', 'Connect two of the resistors in parallel.'), hint: L('Hai đầu trên nối chung, hai đầu dưới nối chung.', 'Join their top ends together and their bottom ends together.') },
      current: { task: L('Nối điện trở thứ ba nối tiếp với cặp song song, sao cho nguồn cấp 5 mA.', 'Put the third resistor in series with the pair so the source supplies 5 mA.'), hint: L('Tổng điện trở phải là 10 V / 5 mA = 2 kΩ, ví dụ 1 kΩ + (2 kΩ ∥ 2 kΩ).', 'The total must be 10 V / 5 mA = 2 kΩ, e.g. 1 kΩ + (2 kΩ ∥ 2 kΩ).') },
      voltage: { task: L('Đo điện áp trên cặp song song bằng đồng hồ (chế độ V): phải là 5 V.', 'Measure the voltage across the parallel pair with the meter (V mode): it must be 5 V.'), hint: L('Đồng hồ mắc song song với một trong hai điện trở song song.', 'Connect the meter across one of the two parallel resistors.') },
    },
    quiz: {
      parallelEqual: { q: L('Hai điện trở 10 kΩ mắc song song có điện trở tương đương bao nhiêu?', 'What is the equivalent of two 10 kΩ resistors in parallel?'), options: [L('5 kΩ', '5 kΩ'), L('20 kΩ', '20 kΩ'), L('10 kΩ', '10 kΩ'), L('100 kΩ', '100 kΩ')], why: L('Hai điện trở bằng nhau song song cho một nửa: 10 kΩ / 2 = 5 kΩ.', 'Two equal resistors in parallel give half: 10 kΩ / 2 = 5 kΩ.') },
      seriesSum: { q: L('1 kΩ, 2.2 kΩ và 4.7 kΩ mắc nối tiếp có tổng bao nhiêu?', '1 kΩ, 2.2 kΩ and 4.7 kΩ in series give…'), options: [L('4.7 kΩ', '4.7 kΩ'), L('0.6 kΩ', '0.6 kΩ'), L('7.9 kΩ', '7.9 kΩ')], why: L('Nối tiếp thì cộng: 1 + 2.2 + 4.7 = 7.9 kΩ.', 'Series resistances add: 1 + 2.2 + 4.7 = 7.9 kΩ.') },
      sameVoltage: { q: L('Các nhánh song song có chung đại lượng nào?', 'What do parallel branches share?'), options: [L('Cùng dòng điện', 'The same current'), L('Cùng điện áp', 'The same voltage'), L('Cùng công suất', 'The same power')], why: L('Các nhánh song song nối vào cùng hai nút, nên có cùng điện áp; dòng điện chia theo điện trở từng nhánh.', 'Parallel branches sit between the same two nodes, so they share the voltage; the current splits by resistance.') },
    },
  },

  kirchhoff: {
    title: L('Định luật Kirchhoff về dòng điện', 'Kirchhoff’s current law'),
    goal: L('Đo dòng điện ở mạch chính và ở một nhánh để thấy dòng vào nút bằng tổng dòng ra.', 'Measure the main current and a branch current to see that the current into a node equals the currents out.'),
    theory: L(
      `## Định luật nút (KCL)
Điện tích không mất đi ở một nút: **tổng dòng điện đi vào bằng tổng dòng điện đi ra**.

$$I_1 = I_2 + I_3$$

## Định luật vòng (KVL)
Đi hết một vòng kín, tổng các điện áp bằng 0: điện áp nguồn bằng tổng điện áp rơi trên các điện trở trong vòng.

Thử với nguồn 12 V, R1 = 1 kΩ, rồi R2 = 2 kΩ và R3 = 3 kΩ song song.`,
      `## The current law (KCL)
Charge is not lost at a node: **the currents flowing in add up to the currents flowing out**.

$$I_1 = I_2 + I_3$$

## The voltage law (KVL)
Around any closed loop the voltages add up to 0: the source voltage equals the drops across the resistors of the loop.

Try a 12 V source, R1 = 1 kΩ, then R2 = 2 kΩ and R3 = 3 kΩ in parallel.`,
    ),
    steps: {
      junction: { task: L('Dựng mạch: nguồn → R1 → một nút chia ra hai nhánh R2 và R3 xuống đất.', 'Build it: source → R1 → a node that splits into R2 and R3 to ground.'), hint: L('R2 và R3 mắc song song; R1 nối tiếp ở phía trước.', 'R2 and R3 in parallel; R1 in series ahead of them.') },
      mainCurrent: { task: L('Đo dòng mạch chính (qua R1) bằng đồng hồ ở chế độ A.', 'Measure the main current (through R1) with a meter in A mode.'), hint: L('Mắc đồng hồ nối tiếp giữa nguồn và R1.', 'Put the meter in series between the source and R1.') },
      branchCurrent: { task: L('Chuyển đồng hồ sang đo dòng một nhánh (R2 hoặc R3).', 'Move the meter to measure one branch current (R2 or R3).'), hint: L('Mắc đồng hồ nối tiếp với R2 hoặc R3; so sánh với dòng mạch chính.', 'Put the meter in series with R2 or R3 and compare with the main current.') },
    },
    quiz: {
      kcl: { q: L('Vào một nút có 5 mA; một nhánh ra 2 mA. Nhánh còn lại?', '5 mA enters a node; one branch takes 2 mA. The other branch?'), options: [L('3 mA', '3 mA'), L('7 mA', '7 mA'), L('2 mA', '2 mA')], why: L('Dòng vào = tổng dòng ra: 5 = 2 + 3 mA.', 'In = sum of out: 5 = 2 + 3 mA.') },
      larger: { q: L('Nhánh nào có dòng lớn hơn: 2 kΩ hay 3 kΩ (cùng điện áp)?', 'Which branch carries more: 2 kΩ or 3 kΩ (same voltage)?'), options: [L('Nhánh 3 kΩ', 'The 3 kΩ branch'), L('Bằng nhau', 'They are equal'), L('Nhánh 2 kΩ', 'The 2 kΩ branch')], why: L('Cùng điện áp thì điện trở nhỏ hơn cho dòng lớn hơn (I = U / R).', 'With the same voltage, the smaller resistance carries more current (I = V / R).') },
      kvl: { q: L('Nguồn 12 V, điện áp trên R1 là 5.5 V. Điện áp trên cặp song song?', 'A 12 V source, 5.5 V across R1. The voltage across the parallel pair?'), options: [L('5.5 V', '5.5 V'), L('6.5 V', '6.5 V'), L('12 V', '12 V'), L('17.5 V', '17.5 V')], why: L('Định luật vòng: 12 V = 5.5 V + 6.5 V.', 'Voltage law: 12 V = 5.5 V + 6.5 V.') },
    },
  },

  'rc-charge': {
    title: L('Nạp điện cho tụ', 'Charging a capacitor'),
    goal: L('Xem tụ nạp qua điện trở và kiểm tra hằng số thời gian τ = R · C.', 'Watch a capacitor charge through a resistor and check the time constant τ = R · C.'),
    theory: L(
      `## Hằng số thời gian
Tụ điện tích điện tích; điện áp của tụ không thể nhảy tức thời. Nạp qua điện trở R:

$$u_C(t) = U \\cdot (1 - e^{-t/\\tau}), \\quad \\tau = R \\cdot C$$

- Sau **1 τ** tụ đạt 63 % điện áp nguồn.
- Sau **5 τ** tụ gần như đầy (99 %).

Với R = 10 kΩ, C = 10 µF: τ = 0.1 s. Mạch mẫu đã có sẵn nguồn xung 0 → 5 V.`,
      `## The time constant
A capacitor stores charge; its voltage cannot jump. Charging through a resistor R:

$$v_C(t) = V \\cdot (1 - e^{-t/\\tau}), \\quad \\tau = R \\cdot C$$

- After **1 τ** the capacitor reaches 63 % of the source.
- After **5 τ** it is practically full (99 %).

With R = 10 kΩ and C = 10 µF, τ = 0.1 s. The starter circuit already has a 0 → 5 V pulse source.`,
    ),
    steps: {
      parts: { task: L('Thêm một điện trở và một tụ điện (đã có nguồn xung).', 'Add a resistor and a capacitor (the pulse source is there).'), hint: L('Ví dụ R = 10 kΩ, C = 10 µF (gõ 10u).', 'For example R = 10 kΩ, C = 10 µF (type 10u).') },
      wired: { task: L('Nối: nguồn + → điện trở → tụ → đất.', 'Wire it: source + → resistor → capacitor → ground.'), hint: L('Một chân tụ nối đất, chân kia nối với điện trở.', 'One capacitor pin to ground, the other to the resistor.') },
      scope: { task: L('Nối kênh A của dao động ký vào chân trên của tụ.', 'Connect oscilloscope channel A to the top of the capacitor.'), hint: L('Thiết bị đo → Dao động ký. Chạy mô phỏng và mở dao động ký để thấy đường cong nạp.', 'Instruments → Oscilloscope. Run and open it to see the charging curve.') },
      tau: { task: L('Kiểm tra: sau thời gian τ, tụ đạt 63 % điện áp nguồn.', 'Check: after τ the capacitor is at 63 % of the source.'), hint: L('MachSim tự mô phỏng quá độ để đo. Độ rộng xung phải dài hơn 3τ.', 'MachSim runs a transient to measure it. The pulse must last longer than 3τ.') },
    },
    quiz: {
      tau: { q: L('R = 1 kΩ, C = 100 µF. τ bằng?', 'R = 1 kΩ, C = 100 µF. What is τ?'), options: [L('1 ms', '1 ms'), L('100 ms', '100 ms'), L('10 s', '10 s')], why: L('τ = R · C = 1000 · 0.0001 = 0.1 s = 100 ms.', 'τ = R · C = 1000 · 0.0001 = 0.1 s = 100 ms.') },
      fiveTau: { q: L('Sau bao lâu tụ coi như nạp đầy?', 'When is the capacitor practically full?'), options: [L('Sau 0.5 τ', 'After 0.5 τ'), L('Sau 1 τ', 'After 1 τ'), L('Sau 2 τ', 'After 2 τ'), L('Sau 5 τ', 'After 5 τ')], why: L('Sau 5 τ, e^-5 ≈ 0.007: tụ đạt khoảng 99 %.', 'After 5 τ, e^-5 ≈ 0.007: the capacitor is at about 99 %.') },
      doubleC: { q: L('Tăng gấp đôi điện dung thì thời gian nạp…', 'Doubling the capacitance makes the charging time…'), options: [L('gấp đôi', 'twice as long'), L('một nửa', 'half as long'), L('không đổi', 'unchanged')], why: L('τ = R · C tỉ lệ với C.', 'τ = R · C is proportional to C.') },
    },
  },

  'rc-filter': {
    title: L('Mạch lọc thông thấp RC', 'RC low-pass filter'),
    goal: L('Thiết kế bộ lọc có tần số cắt 1 kHz và kiểm tra −3 dB tại tần số đó.', 'Design a filter with a 1 kHz cut-off and check the −3 dB point there.'),
    theory: L(
      `## Tụ điện “ngắn mạch” tín hiệu cao tần
Trở kháng của tụ giảm khi tần số tăng: $X_C = \\frac{1}{2 \\pi f C}$. Trong mạch R nối tiếp, C xuống đất, tín hiệu cao tần bị tụ dẫn xuống đất.

Tần số cắt:

$$f_c = \\frac{1}{2 \\pi R C}$$

Tại $f_c$ biên độ ra bằng 0.707 lần biên độ vào (−3 dB), pha trễ 45°. Ví dụ R = 1.6 kΩ, C = 100 nF cho $f_c$ ≈ 995 Hz.`,
      `## A capacitor “shorts” high frequencies
A capacitor’s impedance falls as frequency rises: $X_C = \\frac{1}{2 \\pi f C}$. With R in series and C to ground, high frequencies are shunted to ground.

The cut-off frequency:

$$f_c = \\frac{1}{2 \\pi R C}$$

At $f_c$ the output is 0.707 × the input (−3 dB), lagging by 45°. For example R = 1.6 kΩ and C = 100 nF give $f_c$ ≈ 995 Hz.`,
    ),
    steps: {
      parts: { task: L('Đặt một nguồn xoay chiều, một điện trở và một tụ điện.', 'Place an AC source, a resistor and a capacitor.'), hint: L('Nguồn → Nguồn áp → Nguồn áp AC, hoặc máy phát hàm trong nhóm Thiết bị đo.', 'Sources → Voltage sources → AC Voltage Source, or the function generator in Instruments.') },
      lowpass: { task: L('Nối thành mạch lọc thông thấp: nguồn → R → điểm ra, tụ từ điểm ra xuống đất.', 'Wire a low-pass: source → R → output, capacitor from the output to ground.'), hint: L('Cực − của nguồn (hoặc COM của máy phát) cũng nối đất.', 'The source’s − (or the generator’s COM) goes to ground as well.') },
      fc: { task: L('Chọn R và C để tần số cắt là 1 kHz (± 10 %).', 'Choose R and C for a 1 kHz cut-off (± 10 %).'), hint: L('R · C = 1 / (2π · 1000) ≈ 159 µs, ví dụ 1.6 kΩ và 100 nF.', 'R · C = 1 / (2π · 1000) ≈ 159 µs, e.g. 1.6 kΩ and 100 nF.') },
      gain: { task: L('Kiểm tra: tại tần số cắt, biên độ ra bằng 0.707 lần biên độ vào.', 'Check: at the cut-off the output is 0.707 × the input.'), hint: L('MachSim chạy phân tích AC một tần số. Bạn cũng có thể dùng máy vẽ Bode để xem cả đường cong.', 'MachSim runs a single-frequency AC analysis. You can also use the Bode plotter to see the whole curve.') },
    },
    quiz: {
      atFc: { q: L('Tại tần số cắt, biên độ ra bằng bao nhiêu lần biên độ vào?', 'At the cut-off, the output is how many times the input?'), options: [L('1', '1'), L('0.707', '0.707'), L('0.5', '0.5'), L('0.1', '0.1')], why: L('Tại fc, |H| = 1/√2 ≈ 0.707, tức −3 dB.', 'At fc, |H| = 1/√2 ≈ 0.707, i.e. −3 dB.') },
      slope: { q: L('Khi f ≫ fc, biên độ ra giảm bao nhiêu mỗi decade (×10 tần số)?', 'Well above fc, how much does the output fall per decade (×10 in frequency)?'), options: [L('Không giảm', 'It does not fall'), L('3 dB', '3 dB'), L('20 dB', '20 dB')], why: L('Bộ lọc bậc một giảm 20 dB mỗi decade (biên độ giảm 10 lần).', 'A first-order filter falls 20 dB per decade (10 × in amplitude).') },
      biggerR: { q: L('Tăng R thì tần số cắt…', 'Increasing R makes the cut-off…'), options: [L('giảm', 'lower'), L('tăng', 'higher'), L('không đổi', 'unchanged')], why: L('fc = 1/(2πRC) tỉ lệ nghịch với R.', 'fc = 1/(2πRC) is inversely proportional to R.') },
    },
  },
};
