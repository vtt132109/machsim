/**
 * Lesson text: digital circuits (logic gates, D flip-flop, decade counter with 7-segment display,
 * ADC / DAC). Original text for MachSim. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const DIGITAL_TEXT: Record<string, LessonText> = {
  'logic-gates': {
    title: L('Cổng logic AND', 'The AND gate'),
    goal: L('Dựng cổng AND với hai công tắc logic và một đèn, rồi kiểm tra bảng sự thật.', 'Build an AND gate with two logic switches and a light, then check its truth table.'),
    theory: L(
      `## Mức logic
Mạch số chỉ dùng hai mức: **0** (≈ 0 V) và **1** (≈ 5 V).

Cổng **AND** cho 1 chỉ khi **mọi** đầu vào đều là 1: $Y = A \\cdot B$.

- A = 0, B = 0 → Y = 0
- A = 0, B = 1 → Y = 0
- A = 1, B = 0 → Y = 0
- A = 1, B = 1 → Y = 1

Cổng **OR** cho 1 khi **ít nhất một** đầu vào là 1; cổng **NOT** đảo mức vào.`,
      `## Logic levels
Digital circuits use two levels only: **0** (≈ 0 V) and **1** (≈ 5 V).

An **AND** gate outputs 1 only when **every** input is 1: $Y = A \\cdot B$.

- A = 0, B = 0 → Y = 0
- A = 0, B = 1 → Y = 0
- A = 1, B = 0 → Y = 0
- A = 1, B = 1 → Y = 1

An **OR** gate outputs 1 when **at least one** input is 1; a **NOT** gate inverts its input.`,
    ),
    steps: {
      gate: { task: L('Đặt một cổng AND hai đầu vào.', 'Place a two-input AND gate.'), hint: L('Nhóm Số khác → Cổng ảo → AND2.', 'Misc Digital → Virtual gates → AND2.') },
      inputs: { task: L('Nối hai đầu vào A, B với hai công tắc logic.', 'Connect inputs A and B to two logic switches.'), hint: L('Nguồn → Nguồn số → Công tắc logic. Đặt phím A và B cho hai công tắc để bật / tắt khi chạy.', 'Sources → Digital sources → Interactive logic switch. Give them keys A and B to toggle while running.') },
      probe: { task: L('Nối một đèn đầu dò vào đầu ra Y.', 'Connect a probe light to output Y.'), hint: L('Nhóm Hiển thị → Đèn đầu dò.', 'Indicators → Probe light.') },
      oneOne: { task: L('Bật cả hai công tắc (A = 1, B = 1): đèn phải sáng.', 'Switch both on (A = 1, B = 1): the light must turn on.'), hint: L('Chạy mô phỏng (F5) và nhấn phím của từng công tắc, hoặc đặt trạng thái “on” trong Thuộc tính.', 'Run (F5) and press each switch’s key, or set its state to “on” in Properties.') },
      zero: { task: L('Tắt một công tắc: đèn phải tắt.', 'Switch one input off: the light must go out.'), hint: L('Chỉ cần một đầu vào bằng 0.', 'One 0 input is enough.') },
    },
    quiz: {
      and: { q: L('Cổng AND hai đầu vào cho Y = 1 khi nào?', 'When does a two-input AND give Y = 1?'), options: [L('A = 0, B = 0', 'A = 0, B = 0'), L('A = 1, B = 0', 'A = 1, B = 0'), L('A = 0, B = 1', 'A = 0, B = 1'), L('A = 1, B = 1', 'A = 1, B = 1')], why: L('AND chỉ cho 1 khi mọi đầu vào là 1.', 'AND gives 1 only when all inputs are 1.') },
      or: { q: L('OR: A = 1, B = 0. Y bằng?', 'OR: A = 1, B = 0. Y is…'), options: [L('1', '1'), L('0', '0'), L('không xác định', 'undefined')], why: L('OR cho 1 khi ít nhất một đầu vào là 1.', 'OR gives 1 when at least one input is 1.') },
      not: { q: L('Cổng NOT có đầu vào 1 thì đầu ra?', 'A NOT gate with input 1 outputs…'), options: [L('1', '1'), L('0', '0'), L('0.5', '0.5')], why: L('NOT đảo mức: 1 thành 0.', 'NOT inverts: 1 becomes 0.') },
    },
  },

  flipflop: {
    title: L('Flip-flop D chia đôi tần số', 'D flip-flop divide-by-two'),
    goal: L('Nối QN về D để flip-flop đảo trạng thái ở mỗi xung nhịp và chia đôi tần số.', 'Feed QN back to D so the flip-flop toggles on each clock and halves the frequency.'),
    theory: L(
      `## Flip-flop D
Flip-flop D **nhớ** mức ở chân D tại **sườn lên** của xung nhịp CLK và giữ nó ở Q cho tới sườn lên sau. QN luôn ngược với Q.

Nối **QN → D**: ở mỗi sườn lên, Q nhận giá trị ngược với chính nó, tức là **đảo trạng thái**. Q đổi mức một lần mỗi chu kỳ nhịp, nên:

$$f_Q = \\frac{f_{CLK}}{2}$$

Nối n flip-flop như vậy nối tiếp nhau thì chia tần số cho $2^n$ — đó là bộ đếm nhị phân.`,
      `## The D flip-flop
A D flip-flop **stores** the level at D on the **rising edge** of the clock CLK and holds it at Q until the next rising edge. QN is always the opposite of Q.

Feed **QN → D**: on each rising edge Q takes the opposite of itself, i.e. it **toggles**. Q changes once per clock period, so:

$$f_Q = \\frac{f_{CLK}}{2}$$

A chain of n such flip-flops divides by $2^n$ — a binary counter.`,
    ),
    steps: {
      parts: { task: L('Đặt một flip-flop D và một nguồn xung nhịp 1 kHz.', 'Place a D flip-flop and a 1 kHz clock source.'), hint: L('Số khác → Flip-flop ảo → D FF; Nguồn → Nguồn số → Xung nhịp số.', 'Misc Digital → Virtual flip-flops → D FF; Sources → Digital sources → Digital clock.') },
      toggle: { task: L('Nối xung nhịp vào CLK và nối QN về D.', 'Connect the clock to CLK and QN back to D.'), hint: L('Để chân SET và RESET hở (không tích cực).', 'Leave SET and RESET open (inactive).') },
      divide: { task: L('Kiểm tra: Q dao động ở một nửa tần số nhịp.', 'Check: Q runs at half the clock frequency.'), hint: L('MachSim mô phỏng quá độ 12 chu kỳ nhịp và đo tần số của Q.', 'MachSim runs 12 clock periods and measures Q’s frequency.') },
      watch: { task: L('Nối dao động ký (hoặc máy phân tích logic) vào Q để so sánh với CLK.', 'Connect an oscilloscope (or logic analyzer) to Q to compare it with CLK.'), hint: L('Kênh A vào CLK, kênh B vào Q.', 'Channel A on CLK, channel B on Q.') },
    },
    quiz: {
      edge: { q: L('Flip-flop D sườn lên lấy mức D khi nào?', 'When does a rising-edge D flip-flop take D?'), options: [L('Liên tục', 'All the time'), L('Tại sườn lên của CLK', 'On the rising edge of CLK'), L('Khi CLK ở mức thấp', 'While CLK is low')], why: L('Chỉ tại thời điểm CLK chuyển từ 0 lên 1.', 'Only at the instant CLK goes from 0 to 1.') },
      divide: { q: L('Nhịp 8 kHz qua 3 flip-flop chia đôi nối tiếp cho tần số?', 'An 8 kHz clock through 3 divide-by-two stages gives…'), options: [L('4 kHz', '4 kHz'), L('2.67 kHz', '2.67 kHz'), L('1 kHz', '1 kHz'), L('24 kHz', '24 kHz')], why: L('8 kHz / 2³ = 1 kHz.', '8 kHz / 2³ = 1 kHz.') },
      chain: { q: L('Nhiều flip-flop đảo trạng thái nối tiếp tạo thành mạch gì?', 'Several toggling flip-flops in a chain make a…'), options: [L('Bộ đếm nhị phân', 'binary counter'), L('Bộ khuếch đại', 'amplifier'), L('Bộ lọc', 'filter')], why: L('Các Q đếm lên theo mã nhị phân.', 'Their Q outputs count up in binary.') },
    },
  },

  'counter-7seg': {
    title: L('Bộ đếm thập phân và LED 7 đoạn', 'Decade counter and 7-segment display'),
    goal: L('Đếm 0 … 9 bằng IC 7490, giải mã bằng 7447 và hiện số trên LED 7 đoạn.', 'Count 0 … 9 with a 7490, decode with a 7447 and show the digit on a 7-segment display.'),
    theory: L(
      `## Mã BCD
IC **7490** đếm các sườn xuống của xung nhịp. Nối **QA → CKB** thì 4 đầu ra QD QC QB QA đếm 0000 … 1001 (0 … 9) rồi quay lại 0 — mã **BCD**. Các chân R01, R02 (xoá) và R91, R92 (đặt 9) phải để mức thấp.

IC **7447** biến mã BCD thành 7 tín hiệu điều khiển đoạn **a … g**. Đầu ra 7447 tích cực **mức thấp**, nên dùng LED 7 đoạn **anode chung** (chân CA lên VCC), mỗi đoạn qua một điện trở ≈ 330 Ω.

$$7490 \\to \\text{BCD} \\to 7447 \\to a … g$$`,
      `## BCD code
The **7490** counts the clock’s falling edges. With **QA → CKB** its outputs QD QC QB QA count 0000 … 1001 (0 … 9) and wrap to 0 — **BCD** code. The reset pins R01, R02 and set-to-9 pins R91, R92 must be held low.

The **7447** turns BCD into the seven segment drives **a … g**. Its outputs are **active low**, so use a **common-anode** display (CA to VCC), each segment through a ≈ 330 Ω resistor.

$$7490 \\to \\text{BCD} \\to 7447 \\to a … g$$`,
    ),
    steps: {
      parts: { task: L('Đặt IC 7490, IC 7447, LED 7 đoạn anode chung và một nguồn xung nhịp (ví dụ 5 Hz).', 'Place a 7490, a 7447, a common-anode 7-segment display and a clock (e.g. 5 Hz).'), hint: L('Nhóm TTL → 74xx; nhóm Hiển thị → LED 7 đoạn.', 'TTL → 74xx; Indicators → Seven-segment.') },
      bcd: { task: L('Nối xung nhịp vào CKA, QA vào CKB, và nối R01, R02, R91, R92 xuống đất.', 'Clock to CKA, QA to CKB, and R01, R02, R91, R92 to ground.'), hint: L('Có thể dùng nhãn net: nhãn cùng tên là nối với nhau.', 'Net labels help: labels with the same name are connected.') },
      decoder: { task: L('Nối QA, QB, QC, QD của 7490 vào A, B, C, D của 7447.', 'Connect the 7490’s QA, QB, QC, QD to the 7447’s A, B, C, D.'), hint: L('Nối LT, RBI, BIRBO của 7447 lên VCC.', 'Tie the 7447’s LT, RBI and BIRBO to VCC.') },
      segments: { task: L('Nối 7 đầu ra SEGA … SEGG qua điện trở 330 Ω tới các chân a … g, và CA lên VCC.', 'Connect SEGA … SEGG through 330 Ω resistors to pins a … g, and CA to VCC.'), hint: L('Đặt ký hiệu VCC (nhóm Nguồn) cho chân CA.', 'Use a VCC symbol (Sources) on the CA pin.') },
      count: { task: L('Kiểm tra: bộ đếm chạy 0 → 9 rồi quay lại 0.', 'Check: the counter runs 0 → 9 and back to 0.'), hint: L('Chạy mô phỏng để thấy số nhảy trên LED 7 đoạn.', 'Run the simulation to watch the digit change on the display.') },
    },
    quiz: {
      bcd: { q: L('Số 7 trong mã BCD (DCBA) là?', 'What is 7 in BCD (DCBA)?'), options: [L('1110', '1110'), L('0001', '0001'), L('0111', '0111')], why: L('7 = 4 + 2 + 1 = 0111.', '7 = 4 + 2 + 1 = 0111.') },
      activeLow: { q: L('7447 có đầu ra tích cực mức thấp nên dùng LED loại nào?', 'The 7447’s outputs are active low, so which display?'), options: [L('Anode chung', 'Common anode'), L('Cathode chung', 'Common cathode'), L('Loại nào cũng được', 'Either')], why: L('Đầu ra kéo xuống thấp làm sáng đoạn; anode chung nối lên VCC.', 'A low output lights the segment; the common anode goes to VCC.') },
      after9: { q: L('Sau số 9, bộ đếm thập phân hiện số mấy?', 'After 9 the decade counter shows…'), options: [L('10', '10'), L('0', '0'), L('9 mãi', '9 forever'), L('15', '15')], why: L('Bộ đếm thập phân quay về 0 sau 9 (và có thể báo nhớ cho bộ đếm hàng chục).', 'A decade counter wraps to 0 after 9 (and can carry to a tens counter).') },
    },
  },

  'adc-dac': {
    title: L('Chuyển đổi ADC và DAC', 'ADC and DAC conversion'),
    goal: L('Đổi điện áp 2 V thành mã 8 bit bằng ADC, rồi đổi ngược lại bằng DAC.', 'Turn 2 V into an 8-bit code with an ADC, then back again with a DAC.'),
    theory: L(
      `## Lượng tử hoá
ADC 8 bit chia dải $U_{REF}$ thành $2^8$ = 256 bậc. Mỗi bậc (1 LSB):

$$1\\,\\text{LSB} = \\frac{U_{REF}}{256}$$

Với $U_{REF}$ = 5 V, 1 LSB ≈ 19.5 mV. Mã ra:

$$N = \\left\\lfloor \\frac{U_{vào}}{U_{REF}} \\cdot 256 \\right\\rfloor$$

2 V cho N = 102 = 01100110. DAC làm ngược lại: $U_{ra} = N \\cdot U_{REF} / 256$ ≈ 1.99 V. Sai số lượng tử không quá 1 LSB.`,
      `## Quantisation
An 8-bit ADC splits the $V_{REF}$ range into $2^8$ = 256 steps. One step (1 LSB):

$$1\\,\\text{LSB} = \\frac{V_{REF}}{256}$$

With $V_{REF}$ = 5 V, 1 LSB ≈ 19.5 mV. The output code:

$$N = \\left\\lfloor \\frac{V_{in}}{V_{REF}} \\cdot 256 \\right\\rfloor$$

2 V gives N = 102 = 01100110. A DAC does the reverse: $V_{out} = N \\cdot V_{REF} / 256$ ≈ 1.99 V. The quantisation error stays within 1 LSB.`,
    ),
    steps: {
      adc: { task: L('Đặt ADC 8 bit: VREF+ lên 5 V, VREF− xuống đất, VIN nối nguồn 2 V.', 'Place an 8-bit ADC: VREF+ to 5 V, VREF− to ground, VIN to a 2 V source.'), hint: L('Nhóm Hỗn hợp → Bộ chuyển đổi → ADC 8 bit. Để SOC hở thì ADC chuyển đổi liên tục.', 'Mixed → Converters → ADC 8-bit. With SOC open it converts continuously.') },
      code: { task: L('Kiểm tra mã ra D7 … D0 đúng với điện áp vào.', 'Check that the code on D7 … D0 matches the input.'), hint: L('Đặt đầu dò số hoặc đèn lên D0 … D7 để xem các bit.', 'Put digital probes or lights on D0 … D7 to see the bits.') },
      dac: { task: L('Đặt DAC 8 bit, nối D0 … D7 của ADC vào D0 … D7 của DAC, dùng chung VREF+.', 'Place an 8-bit DAC, connect the ADC’s D0 … D7 to its D0 … D7 and share VREF+.'), hint: L('Nhãn net B0 … B7 giúp nối gọn.', 'Net labels B0 … B7 keep it tidy.') },
      back: { task: L('Kiểm tra: điện áp ra DAC bằng điện áp vào ADC trong phạm vi 1 LSB.', 'Check: the DAC output equals the ADC input within 1 LSB.'), hint: L('Đo VOUT bằng đồng hồ vạn năng hoặc đầu dò.', 'Measure VOUT with a multimeter or a probe.') },
    },
    quiz: {
      lsb: { q: L('ADC 8 bit, VREF = 2.56 V. 1 LSB bằng?', 'An 8-bit ADC with VREF = 2.56 V. 1 LSB is…'), options: [L('1 mV', '1 mV'), L('10 mV', '10 mV'), L('256 mV', '256 mV')], why: L('2.56 V / 256 = 10 mV.', '2.56 V / 256 = 10 mV.') },
      bits: { q: L('ADC 10 bit có bao nhiêu mức?', 'How many levels does a 10-bit ADC have?'), options: [L('10', '10'), L('100', '100'), L('512', '512'), L('1024', '1024')], why: L('2¹⁰ = 1024 mức.', '2¹⁰ = 1024 levels.') },
      error: { q: L('Sai số lượng tử của ADC lý tưởng tối đa là?', 'The quantisation error of an ideal ADC is at most…'), options: [L('1 LSB', '1 LSB'), L('1 V', '1 V'), L('0', '0')], why: L('Mọi điện áp trong một bậc cho cùng một mã: sai lệch tối đa một bậc.', 'Every voltage inside one step gives the same code: at most one step off.') },
    },
  },
};
