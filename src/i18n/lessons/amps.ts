/**
 * Lesson text: op-amps and timers (inverting / non-inverting amplifier, comparator, 555 astable).
 * Original text for MachSim. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const AMPS_TEXT: Record<string, LessonText> = {
  'opamp-inverting': {
    title: L('Op-amp: khuếch đại đảo', 'Op-amp: inverting amplifier'),
    goal: L('Dựng tầng khuếch đại đảo có hệ số −10.', 'Build an inverting amplifier with a gain of −10.'),
    theory: L(
      `## Hồi tiếp âm
Op-amp có độ lợi rất lớn. Khi có hồi tiếp âm (điện trở từ OUT về chân −), op-amp tự chỉnh đầu ra để **hai chân vào bằng nhau**. Chân + nối đất nên chân − là **đất ảo** (0 V).

Dòng qua $R_{in}$ bằng dòng qua $R_f$:

$$A_v = \\frac{U_{ra}}{U_{vào}} = -\\frac{R_f}{R_{in}}$$

$R_f$ = 10 kΩ, $R_{in}$ = 1 kΩ cho $A_v = -10$: vào 0.5 V, ra −5 V.

> Op-amp lý tưởng 3 chân không cần nguồn nuôi; op-amp thật (LM741 …) cần nối V+ và V−.`,
      `## Negative feedback
An op-amp has a huge gain. With negative feedback (a resistor from OUT back to the − input) it drives its output until **both inputs are equal**. The + input is grounded, so the − input is a **virtual ground** (0 V).

The current through $R_{in}$ equals the current through $R_f$:

$$A_v = \\frac{V_{out}}{V_{in}} = -\\frac{R_f}{R_{in}}$$

$R_f$ = 10 kΩ and $R_{in}$ = 1 kΩ give $A_v = -10$: 0.5 V in, −5 V out.

> The 3-terminal ideal op-amp needs no supply; real op-amps (LM741 …) need V+ and V− connected.`,
    ),
    steps: {
      opamp: { task: L('Đặt một op-amp (op-amp lý tưởng 3 chân là dễ nhất).', 'Place an op-amp (the 3-terminal ideal op-amp is easiest).'), hint: L('Nhóm Tương tự → Op-amp → Op-amp lý tưởng (3 chân).', 'Analog → Op-amp → Ideal Op-Amp (3-terminal).') },
      plusGround: { task: L('Nối chân + (không đảo) xuống đất.', 'Connect the + (non-inverting) input to ground.'), hint: L('Đặt một ký hiệu Đất gần chân +.', 'Place a Ground symbol next to the + input.') },
      feedback: { task: L('Nối Rf từ OUT về chân −, và Rin từ nguồn vào tới chân −.', 'Connect Rf from OUT to the − input, and Rin from the input source to the − input.'), hint: L('Rf = 10 kΩ, Rin = 1 kΩ. Nguồn vào là nguồn DC 0.5 V.', 'Rf = 10 kΩ, Rin = 1 kΩ. The input is a 0.5 V DC source.') },
      gain: { task: L('Kiểm tra: Vout / Vin = −10 (± 3 %).', 'Check: Vout / Vin = −10 (± 3 %).'), hint: L('Đặt đầu dò điện áp lên OUT để đọc ngay trên sơ đồ khi chạy.', 'Put a voltage probe on OUT to read it on the schematic while running.') },
    },
    quiz: {
      gain: { q: L('Rf = 22 kΩ, Rin = 2.2 kΩ. Hệ số khuếch đại?', 'Rf = 22 kΩ, Rin = 2.2 kΩ. The gain?'), options: [L('+10', '+10'), L('−1', '−1'), L('−10', '−10')], why: L('Av = −Rf / Rin = −22k / 2.2k = −10.', 'Av = −Rf / Rin = −22k / 2.2k = −10.') },
      virtualGround: { q: L('Trong mạch đảo, điện áp chân − bằng?', 'In the inverting stage, the − input sits at…'), options: [L('≈ 0 V (đất ảo)', '≈ 0 V (virtual ground)'), L('bằng điện áp vào', 'the input voltage'), L('bằng điện áp ra', 'the output voltage')], why: L('Hồi tiếp âm giữ hai chân vào bằng nhau; chân + nối đất nên chân − ≈ 0 V.', 'Feedback keeps the inputs equal; + is grounded so − ≈ 0 V.') },
      inputR: { q: L('Trở kháng vào của tầng khuếch đại đảo bằng?', 'The input impedance of the inverting stage is…'), options: [L('vô cùng lớn', 'infinite'), L('Rin', 'Rin'), L('Rf', 'Rf')], why: L('Nguồn vào thấy Rin nối tới đất ảo, nên trở kháng vào bằng Rin.', 'The source sees Rin to the virtual ground, so the input impedance is Rin.') },
    },
  },

  'opamp-noninverting': {
    title: L('Op-amp: khuếch đại không đảo', 'Op-amp: non-inverting amplifier'),
    goal: L('Dựng tầng khuếch đại không đảo có hệ số 11, rồi biến nó thành bộ đệm.', 'Build a non-inverting amplifier with a gain of 11, then turn it into a follower.'),
    theory: L(
      `## Tín hiệu vào chân +
Tín hiệu vào chân **+**; cầu chia $R_f$ / $R_g$ đưa một phần điện áp ra về chân −. Op-amp chỉnh đầu ra sao cho chân − bằng chân +:

$$A_v = 1 + \\frac{R_f}{R_g}$$

$R_f$ = 10 kΩ, $R_g$ = 1 kΩ cho $A_v$ = 11, tín hiệu ra **cùng pha**.

## Bộ đệm (theo điện áp)
Nối thẳng OUT về chân − (bỏ $R_g$): $A_v$ = 1. Bộ đệm có trở kháng vào rất lớn và trở kháng ra rất nhỏ, dùng để “tách” nguồn yếu khỏi tải.`,
      `## The signal goes to +
The signal drives the **+** input; the $R_f$ / $R_g$ divider feeds part of the output back to −. The op-amp makes − equal to +:

$$A_v = 1 + \\frac{R_f}{R_g}$$

$R_f$ = 10 kΩ and $R_g$ = 1 kΩ give $A_v$ = 11, and the output is **in phase**.

## Voltage follower
Wire OUT straight to − (no $R_g$): $A_v$ = 1. A follower has a huge input impedance and a tiny output impedance; it isolates a weak source from its load.`,
    ),
    steps: {
      input: { task: L('Đặt op-amp và nối nguồn DC 0.3 V vào chân +.', 'Place an op-amp and connect a 0.3 V DC source to its + input.'), hint: L('Cực − của nguồn nối đất.', 'The source’s − terminal goes to ground.') },
      network: { task: L('Nối Rf (10 kΩ) từ OUT về chân −, và Rg (1 kΩ) từ chân − xuống đất.', 'Connect Rf (10 kΩ) from OUT to −, and Rg (1 kΩ) from − to ground.'), hint: L('Chân − nằm giữa cầu chia Rf / Rg.', 'The − input sits at the middle of the Rf / Rg divider.') },
      gain: { task: L('Kiểm tra: Vout / Vin = 11 (± 3 %).', 'Check: Vout / Vin = 11 (± 3 %).'), hint: L('Vào 0.3 V thì ra 3.3 V.', '0.3 V in gives 3.3 V out.') },
      follower: { task: L('Biến mạch thành bộ đệm: bỏ hai điện trở, nối thẳng OUT về chân −.', 'Make it a follower: remove both resistors and wire OUT straight to −.'), hint: L('Khi đó Vout = Vin.', 'Then Vout = Vin.') },
    },
    quiz: {
      gain: { q: L('Rf = 9 kΩ, Rg = 1 kΩ. Hệ số khuếch đại không đảo?', 'Rf = 9 kΩ, Rg = 1 kΩ. The non-inverting gain?'), options: [L('10', '10'), L('9', '9'), L('−9', '−9')], why: L('Av = 1 + Rf / Rg = 1 + 9 = 10.', 'Av = 1 + Rf / Rg = 1 + 9 = 10.') },
      phase: { q: L('Tín hiệu ra của tầng không đảo…', 'The non-inverting output is…'), options: [L('ngược pha', 'inverted'), L('cùng pha với tín hiệu vào', 'in phase with the input'), L('lệch 90°', 'shifted 90°')], why: L('Tín hiệu vào chân +, nên ra cùng pha.', 'The signal enters at +, so the output is in phase.') },
      follower: { q: L('Bộ đệm (OUT nối chân −) có hệ số khuếch đại?', 'A follower (OUT tied to −) has a gain of…'), options: [L('0', '0'), L('vô cùng lớn', 'infinity'), L('1', '1')], why: L('Vout = Vin: hệ số 1, nhưng có thể cấp dòng lớn cho tải.', 'Vout = Vin: a gain of 1, but it can drive a heavy load.') },
    },
  },

  comparator: {
    title: L('Mạch so sánh điện áp', 'Voltage comparator'),
    goal: L('So sánh điện áp vào với mức chuẩn 2.5 V và báo kết quả bằng đèn.', 'Compare an input with a 2.5 V reference and show the result with a light.'),
    theory: L(
      `## Không có hồi tiếp
Bộ so sánh (hoặc op-amp không có hồi tiếp) đưa đầu ra lên **mức cao** khi $U_+ > U_-$ và xuống **mức thấp** khi $U_+ < U_-$.

Mức chuẩn thường lấy từ cầu chia: hai điện trở 10 kΩ từ 5 V cho **2.5 V**.

> Khi tín hiệu vào có nhiễu và đi chậm qua ngưỡng, đầu ra có thể “rung” lên xuống. **Trễ (hysteresis)** — hai ngưỡng hơi khác nhau, tạo bằng hồi tiếp dương — chống được hiện tượng này.`,
      `## No feedback
A comparator (or an op-amp without feedback) drives its output **high** when $V_+ > V_-$ and **low** when $V_+ < V_-$.

The reference usually comes from a divider: two 10 kΩ resistors from 5 V give **2.5 V**.

> A noisy input that crosses the threshold slowly can make the output chatter. **Hysteresis** — two slightly different thresholds made with positive feedback — prevents it.`,
    ),
    steps: {
      parts: { task: L('Đặt một bộ so sánh và nối chân nguồn: V+ lên 5 V, V− xuống đất.', 'Place a comparator and connect its supply: V+ to 5 V, V− to ground.'), hint: L('Nhóm Tương tự → Bộ so sánh → Comparator.', 'Analog → Comparator → Comparator.') },
      reference: { task: L('Tạo mức chuẩn 2.5 V ở chân − bằng cầu chia hai điện trở 10 kΩ.', 'Make a 2.5 V reference at the − input with two 10 kΩ resistors.'), hint: L('Cầu chia nối từ 5 V xuống đất, điểm giữa vào chân −.', 'The divider goes from 5 V to ground; its midpoint to −.') },
      high: { task: L('Đặt điện áp vào chân + là 3 V: đầu ra phải lên mức cao (đèn sáng).', 'Set the + input to 3 V: the output must go high (light on).'), hint: L('Dùng nguồn DC (hoặc chiết áp) cho chân +, nối đèn đầu dò vào OUT.', 'Use a DC source (or a potentiometer) on +, a probe light on OUT.') },
      low: { task: L('Giảm điện áp vào xuống 2 V: đầu ra phải xuống mức thấp.', 'Lower the input to 2 V: the output must go low.'), hint: L('Nhấp đúp vào nguồn vào và gõ 2.', 'Double-click the input source and type 2.') },
    },
    quiz: {
      rule: { q: L('Đầu ra bộ so sánh lên mức cao khi nào?', 'When does a comparator output go high?'), options: [L('Khi U+ > U−', 'When V+ > V−'), L('Khi U+ < U−', 'When V+ < V−'), L('Khi U+ = 0', 'When V+ = 0')], why: L('Đầu ra theo dấu của U+ − U−.', 'The output follows the sign of V+ − V−.') },
      reference: { q: L('Hai điện trở 10 kΩ chia từ 9 V cho mức chuẩn?', 'Two 10 kΩ resistors from 9 V give a reference of…'), options: [L('9 V', '9 V'), L('3 V', '3 V'), L('4.5 V', '4.5 V')], why: L('Hai điện trở bằng nhau chia đôi: 4.5 V.', 'Equal resistors halve it: 4.5 V.') },
      hysteresis: { q: L('Trễ (hysteresis) giúp gì cho bộ so sánh?', 'What does hysteresis do for a comparator?'), options: [L('Tăng tốc độ', 'Makes it faster'), L('Chống rung đầu ra khi tín hiệu nhiễu', 'Stops output chatter on noisy signals'), L('Tăng điện áp ra', 'Raises the output voltage')], why: L('Hai ngưỡng khác nhau nên nhiễu nhỏ không làm đầu ra lật qua lại.', 'With two thresholds, small noise cannot flip the output back and forth.') },
    },
  },

  timer555: {
    title: L('IC 555 dao động', 'The 555 astable'),
    goal: L('Dựng mạch dao động 555 phát xung 1 kHz.', 'Build a 555 oscillator running at 1 kHz.'),
    theory: L(
      `## Dao động đa hài
Tụ C nạp qua $R_1 + R_2$ tới $\\frac{2}{3} U_{CC}$, rồi xả qua $R_2$ (chân DIS) xuống $\\frac{1}{3} U_{CC}$. Đầu ra OUT cao khi tụ nạp, thấp khi tụ xả.

$$f ≈ \\frac{1.44}{(R_1 + 2 R_2) \\cdot C}$$

Thời gian mức cao luôn dài hơn mức thấp (chu kỳ nhiệm vụ > 50 %). $R_1$ = 1 kΩ, $R_2$ = 6.8 kΩ, C = 100 nF cho f ≈ 986 Hz.

> Chân **RST** phải nối lên VCC, nếu không 555 bị giữ ở trạng thái xoá.`,
      `## Astable oscillator
C charges through $R_1 + R_2$ up to $\\frac{2}{3} V_{CC}$, then discharges through $R_2$ (DIS pin) down to $\\frac{1}{3} V_{CC}$. OUT is high while C charges and low while it discharges.

$$f ≈ \\frac{1.44}{(R_1 + 2 R_2) \\cdot C}$$

The high time is always longer than the low time (duty cycle > 50 %). $R_1$ = 1 kΩ, $R_2$ = 6.8 kΩ and C = 100 nF give f ≈ 986 Hz.

> Tie **RST** to VCC, otherwise the 555 is held in reset.`,
    ),
    steps: {
      power: { task: L('Đặt IC 555 và một nguồn 5 V: nối VCC và RST lên 5 V, GND xuống đất.', 'Place a 555 and a 5 V source: VCC and RST to 5 V, GND to ground.'), hint: L('Nhóm Tương tự → Bộ định thời → 555 Timer.', 'Analog → Timer → 555 Timer.') },
      timingCap: { task: L('Nối THR với TRIG, và mắc tụ định thời 100 nF từ đó xuống đất.', 'Join THR and TRIG, and add a 100 nF timing capacitor from there to ground.'), hint: L('Cả hai chân THR, TRIG cùng nối vào chân trên của tụ.', 'THR and TRIG both go to the top of the capacitor.') },
      resistors: { task: L('Mắc R1 từ VCC tới DIS và R2 từ DIS tới THR/TRIG.', 'Connect R1 from VCC to DIS and R2 from DIS to THR/TRIG.'), hint: L('Thử R1 = 1 kΩ, R2 = 6.8 kΩ.', 'Try R1 = 1 kΩ and R2 = 6.8 kΩ.') },
      frequency: { task: L('Kiểm tra: tần số ở chân OUT là 1 kHz (± 10 %).', 'Check: OUT runs at 1 kHz (± 10 %).'), hint: L('Nối dao động ký vào OUT để xem xung. Công cụ › Trình hướng dẫn mạch › IC định thời 555 tính sẵn giá trị cho bạn.', 'Connect a scope to OUT to see the pulses. Tools › Circuit wizards › 555 timer computes the values for you.') },
    },
    quiz: {
      formula: { q: L('Công thức tần số của 555 dao động?', 'The 555 astable frequency is…'), options: [L('f = 1 / (R1 · C)', 'f = 1 / (R1 · C)'), L('f = 1.44 / ((R1 + 2R2) · C)', 'f = 1.44 / ((R1 + 2R2) · C)'), L('f = R1 · R2 · C', 'f = R1 · R2 · C')], why: L('Thời gian nạp 0.693(R1+R2)C cộng thời gian xả 0.693·R2·C cho chu kỳ 0.693(R1+2R2)C.', 'Charging 0.693(R1+R2)C plus discharging 0.693·R2·C gives a period of 0.693(R1+2R2)C.') },
      biggerC: { q: L('Tăng tụ C lên 10 lần thì tần số…', 'Ten times the capacitance makes the frequency…'), options: [L('giảm 10 lần', '10 times lower'), L('tăng 10 lần', '10 times higher'), L('không đổi', 'unchanged')], why: L('f tỉ lệ nghịch với C.', 'f is inversely proportional to C.') },
      duty: { q: L('Trong mạch 555 cơ bản, mức cao so với mức thấp…', 'In the basic 555 astable, the high time compared with the low time is…'), options: [L('ngắn hơn', 'shorter'), L('luôn bằng nhau', 'always equal'), L('dài hơn', 'longer')], why: L('Tụ nạp qua R1 + R2 nhưng chỉ xả qua R2, nên mức cao dài hơn.', 'C charges through R1 + R2 but discharges through R2 only, so the high time is longer.') },
    },
  },
};
