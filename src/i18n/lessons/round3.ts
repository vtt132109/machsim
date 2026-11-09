/**
 * Lesson text for the round-3 lessons (src/learn/lessons/round3.ts): a real capacitor's
 * resonance, the hysteresis and transfer-function control blocks, one logic IC with four gates, a
 * real 74x74 flip-flop, an 8051 reading a push-button, a ladder traffic light, two identical RC
 * stages (snippets), assembly variants and automatic `.meas` measurements.
 * Original text written for MachSim from general circuit theory. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const ROUND3_TEXT: Record<string, LessonText> = {
  'real-capacitor': {
    title: L('Tụ điện thật cũng cộng hưởng', 'A real capacitor resonates too'),
    goal: L(
      'Dùng “tụ điện không lý tưởng” để thấy tụ chỉ là tụ ở tần số thấp: lên cao nó thành cuộn cảm, và ở giữa có một điểm cộng hưởng nối tắt.',
      'Use the non-ideal capacitor to see that a capacitor is only a capacitor at low frequencies: higher up it turns into an inductor, and in between it has one resonance where it nearly shorts.',
    ),
    theory: L(
      `## Tụ lý tưởng và tụ thật
Tụ lý tưởng có trở kháng giảm mãi khi tần số tăng:

$$Z_C = \\frac{1}{2\\pi f C}$$

Tụ thật thì khác. Hai chân và các lớp bản cực tạo thành một **điện cảm nối tiếp** $L_{ESL}$, còn tổn hao của chất điện môi và điện trở tiếp xúc tạo thành một **điện trở nối tiếp** $R_{ESR}$. Mạch tương đương là $R_{ESR}$ nối tiếp $L_{ESL}$ nối tiếp $C$.

## Điểm tự cộng hưởng
Ở tần số mà $|Z_L| = |Z_C|$ hai phần ảo triệt tiêu nhau, chỉ còn lại ESR:

$$f_0 = \\frac{1}{2\\pi\\sqrt{L_{ESL}\\,C}}$$

Với $C$ = 100 nF và $L_{ESL}$ = 2 nH thì $f_0$ khoảng 11,3 MHz. Dưới $f_0$ tụ còn là tụ; đúng tại $f_0$ trở kháng xuống bằng $R_{ESR}$ (vài chục mΩ) — gần như nối tắt; **trên** $f_0$ trở kháng lại tăng, lúc này linh kiện làm việc như một cuộn cảm nhỏ.

## Vì sao cần biết
Đây là lý do mạch số dùng nhiều tụ lọc nhỏ đặt sát chân IC thay vì một tụ lớn: tụ lớn có $f_0$ thấp nên ở tần số cao nó đã hết tác dụng.

## Cách đo trong MachSim
Không thể cấp dòng lý tưởng vào một tụ (lúc một chiều tụ hở mạch, ERC sẽ báo lỗi). Vì vậy mạch mẫu dùng **điện trở cảm biến 1 Ω**: nguồn xoay chiều → điện trở 1 Ω → tụ → đất. Tỉ số $U_{tu}/U_{vao}$ chính là $Z/(Z+1\\,\\Omega)$, nên tỉ số gần 1 nghĩa là trở kháng còn lớn, tỉ số gần 0 nghĩa là tụ đang nối tắt.`,
      `## The ideal capacitor and the real one
An ideal capacitor's impedance falls for ever as the frequency rises:

$$Z_C = \\frac{1}{2\\pi f C}$$

A real capacitor is different. Its leads and plates add a **series inductance** $L_{ESL}$, and the dielectric losses and contact resistance add a **series resistance** $R_{ESR}$. The equivalent circuit is $R_{ESR}$ in series with $L_{ESL}$ in series with $C$.

## Self-resonance
At the frequency where $|Z_L| = |Z_C|$ the two reactances cancel and only the ESR is left:

$$f_0 = \\frac{1}{2\\pi\\sqrt{L_{ESL}\\,C}}$$

With $C$ = 100 nF and $L_{ESL}$ = 2 nH that is about 11.3 MHz. Below $f_0$ the part is a capacitor; exactly at $f_0$ its impedance falls to $R_{ESR}$ (a few tens of mΩ) — nearly a short; **above** $f_0$ the impedance rises again and the part behaves like a small inductor.

## Why it matters
This is why digital boards use many small decoupling capacitors right at the IC pins instead of one large one: a large capacitor has a low $f_0$, so at high frequencies it has already stopped working.

## How to measure it in MachSim
An ideal current source cannot drive a capacitor (at DC the capacitor is an open circuit and ERC reports it). The sample circuit therefore uses a **1 Ω sense resistor**: AC source → 1 Ω → capacitor → ground. The ratio $V_{cap}/V_{in}$ is $Z/(Z+1\\,\\Omega)$, so a ratio near 1 means the impedance is still large and a ratio near 0 means the capacitor is shorting.`,
    ),
    steps: {
      part: {
        task: L('Đặt một “Tụ điện không lý tưởng” với C = 100 nF, ESR = 30 mΩ, ESL = 2 nH; nối qua điện trở 1 Ω tới nguồn xoay chiều và đặt nhãn IN, CAP.', 'Place a non-ideal capacitor with C = 100 nF, ESR = 30 mΩ, ESL = 2 nH; connect it through a 1 Ω resistor to an AC source and label the nets IN and CAP.'),
        hint: L('Thư viện: nhóm Linh kiện cơ bản → họ “Tụ điện (không lý tưởng)”. Nhãn net đặt bằng công cụ Nhãn (phím L).', 'Library: the Basic group → the "Capacitor (non-ideal)" family. Net labels come from the label tool (key L).'),
      },
      lowFreq: {
        task: L('Chạy phân tích AC ở khoảng f₀/100: gần hết điện áp phải rơi trên tụ.', 'Run an AC analysis near f₀/100: almost all of the voltage has to be across the capacitor.'),
        hint: L('f₀ tính theo công thức ở phần lý thuyết; MachSim tự tính giúp bạn từ giá trị bạn đặt và báo trong bước 1.', 'f₀ comes from the formula in the theory; MachSim works it out from your own values and reports it in step 1.'),
      },
      resonance: {
        task: L('Ở đúng f₀ điện áp trên tụ phải sụt gần hết: tụ đang nối tắt, chỉ còn ESR.', 'At f₀ itself the voltage across the capacitor nearly vanishes: it is shorting and only the ESR is left.'),
        hint: L('Nếu tỉ số chưa xuống thấp, kiểm tra lại ESL (phải khác 0) và điện trở cảm biến (1 Ω).', 'If the ratio does not fall, check the ESL (it must not be zero) and the sense resistor (1 Ω).'),
      },
    },
    quiz: {
      why: {
        q: L('Vì sao tụ thật có điểm cộng hưởng?', 'Why does a real capacitor have a resonance?'),
        options: [
          L('Vì chất điện môi bị phân cực', 'Because the dielectric polarises'),
          L('Vì hai chân và bản cực có điện cảm nối tiếp', 'Because its leads and plates add a series inductance'),
          L('Vì điện dung giảm theo tần số', 'Because the capacitance falls with frequency'),
        ],
        why: L('Điện cảm nối tiếp ESL cộng hưởng với chính điện dung C của tụ.', 'The series inductance ESL resonates with the capacitor’s own capacitance C.'),
      },
      above: {
        q: L('Trên tần số tự cộng hưởng, linh kiện làm việc như gì?', 'Above its self-resonance, what does the part behave like?'),
        options: [L('Vẫn là tụ', 'Still a capacitor'), L('Một điện trở thuần', 'A pure resistor'), L('Một cuộn cảm', 'An inductor')],
        why: L('Trên f₀ phần điện cảm thắng, nên trở kháng tăng theo tần số như một cuộn cảm.', 'Above f₀ the inductive part wins, so the impedance rises with frequency like an inductor.'),
      },
      floor: {
        q: L('Trở kháng nhỏ nhất của tụ bằng bao nhiêu?', 'What is the capacitor’s lowest impedance?'),
        options: [L('Bằng ESR', 'Its ESR'), L('Bằng không', 'Zero'), L('Bằng 1/(2πf₀C)', '1/(2πf₀C)')],
        why: L('Tại f₀ hai phần ảo triệt tiêu, chỉ còn điện trở nối tiếp ESR.', 'At f₀ the two reactances cancel and only the series resistance ESR is left.'),
      },
    },
  },

  'hysteresis-block': {
    title: L('Khối trễ (Schmitt): hai ngưỡng khác nhau', 'The hysteresis block: two different thresholds'),
    goal: L(
      'Dùng khối trễ của nhóm Hàm điều khiển để biến sóng tam giác thành sóng vuông, và đo đúng hai ngưỡng lật.',
      'Use the hysteresis block of the Control functions family to turn a triangle into a square wave, and measure its two switching thresholds.',
    ),
    theory: L(
      `## Một ngưỡng là không đủ
Bộ so sánh thường có **một** mức chuẩn: vào lớn hơn chuẩn thì ra mức cao, nhỏ hơn thì ra mức thấp. Khi tín hiệu vào đi qua mức chuẩn rất chậm, hoặc có nhiễu nhỏ, đầu ra lật qua lật lại nhiều lần — điều không ai muốn ở một mạch đếm hay một chân vào vi điều khiển.

## Trễ (hysteresis)
Khối trễ dùng **hai** ngưỡng: ngưỡng lật lên $U_H$ và ngưỡng lật xuống $U_L$, với $U_H > U_L$. Quy tắc:

- đầu ra đang thấp: chỉ lật **lên** khi $u_{vao} > U_H$;
- đầu ra đang cao: chỉ lật **xuống** khi $u_{vao} < U_L$.

Khoảng giữa hai ngưỡng gọi là **bề rộng trễ**:

$$\\Delta U = U_H - U_L$$

Nhiễu nhỏ hơn $\\Delta U$ không làm đầu ra lật được nữa. Đó chính là lý do có cổng Schmitt (7414, 4093) và vì sao nút nhấn nối vào mạch số nên đi qua một cổng Schmitt.

## Khối trễ trong MachSim
Khối có hai chân IN và OUT, lấy đất làm chuẩn, và bốn tham số: hai ngưỡng $U_L$, $U_H$ và hai mức ra. Nó là **mô hình sự kiện**, nên cạnh ra sắc nét đúng thời điểm tín hiệu vào vượt ngưỡng, không phụ thuộc bước thời gian.

## Cách đo hai ngưỡng
Cấp một sóng **tam giác** (nguồn xung với thời gian lên và xuống bằng nửa chu kỳ) rồi xem trên dao động ký: mỗi lần đầu ra lật, đọc giá trị của tín hiệu vào tại đúng lúc đó. Giá trị khi lật lên phải bằng $U_H$, khi lật xuống phải bằng $U_L$.`,
      `## One threshold is not enough
An ordinary comparator has **one** reference: above it the output is high, below it the output is low. When the input crosses that reference slowly, or carries a little noise, the output flips back and forth several times — the last thing you want in a counter or on a microcontroller input.

## Hysteresis
The hysteresis block uses **two** thresholds: an upper one $V_H$ and a lower one $V_L$, with $V_H > V_L$. The rule is:

- while the output is low it only flips **up** when $v_{in} > V_H$;
- while the output is high it only flips **down** when $v_{in} < V_L$.

The gap between the two is the **hysteresis width**:

$$\\Delta V = V_H - V_L$$

Noise smaller than $\\Delta V$ can no longer flip the output. That is exactly why Schmitt-trigger gates exist (7414, 4093) and why a push-button feeding a digital circuit should go through one.

## The block in MachSim
It has an IN and an OUT pin, is referred to ground, and takes four parameters: the two thresholds $V_L$, $V_H$ and the two output levels. It is an **event-driven model**, so its output edge lands exactly when the input crosses a threshold, whatever the time step.

## Measuring the two thresholds
Feed it a **triangle** (a pulse source whose rise and fall times are each half the period) and watch the oscilloscope: every time the output flips, read the input at that instant. The value when it flips up has to be $V_H$, and when it flips down, $V_L$.`,
    ),
    steps: {
      block: {
        task: L('Đặt một “Khối trễ (Schmitt)” và đặt hai ngưỡng khác nhau, ví dụ 1,5 V và 3,5 V.', 'Place a hysteresis (Schmitt) block and set two different thresholds, for example 1.5 V and 3.5 V.'),
        hint: L('Thư viện: nhóm Tương tự → họ “Hàm điều khiển”. Hai tham số là Ngưỡng dưới và Ngưỡng trên.', 'Library: the Analog group → the "Control functions" family. The parameters are the lower and the upper threshold.'),
      },
      drive: {
        task: L('Cấp sóng tam giác 0 … 5 V vào chân IN và nối chân OUT vào dao động ký.', 'Feed a 0 … 5 V triangle into IN and connect OUT to an oscilloscope.'),
        hint: L('Nguồn xung với thời gian lên = thời gian xuống = nửa chu kỳ cho ra sóng tam giác (ví dụ 0,5 ms / 0,5 ms, chu kỳ 1 ms).', 'A pulse source whose rise time equals its fall time and both are half the period gives a triangle (0.5 ms / 0.5 ms with a 1 ms period, say).'),
      },
      levels: {
        task: L('Chạy mô phỏng quá độ: đầu ra phải lật lên ở ngưỡng trên và lật xuống ở ngưỡng dưới.', 'Run a transient: the output has to flip up at the upper threshold and down at the lower one.'),
        hint: L('Nếu đầu ra không lật lần nào, biên độ sóng tam giác chưa vượt cả hai ngưỡng.', 'If the output never flips, the triangle does not swing past both thresholds.'),
      },
    },
    quiz: {
      why: {
        q: L('Trễ (hysteresis) chống được chuyện gì?', 'What does hysteresis prevent?'),
        options: [
          L('Đầu ra bị méo', 'A distorted output'),
          L('Mạch tiêu thụ nhiều điện', 'A circuit drawing too much current'),
          L('Đầu ra lật nhiều lần do nhiễu quanh ngưỡng', 'The output flipping many times from noise around the threshold'),
        ],
        why: L('Nhiễu nhỏ hơn bề rộng trễ không đủ để đưa tín hiệu qua ngưỡng còn lại.', 'Noise smaller than the hysteresis width cannot take the signal past the other threshold.'),
      },
      width: {
        q: L('Bề rộng trễ của khối có hai ngưỡng 1,5 V và 3,5 V là bao nhiêu?', 'What is the hysteresis width of a block with thresholds 1.5 V and 3.5 V?'),
        options: [L('2 V', '2 V'), L('5 V', '5 V'), L('1,5 V', '1.5 V')],
        why: L('ΔU = 3,5 − 1,5 = 2 V.', 'ΔV = 3.5 − 1.5 = 2 V.'),
      },
      use: {
        q: L('Linh kiện thật nào làm đúng việc này?', 'Which real part does the same job?'),
        options: [L('Cổng AND 7408', 'The 7408 AND gate'), L('Cổng đảo Schmitt 7414', 'The 7414 Schmitt inverter'), L('Flip-flop 7474', 'The 7474 flip-flop')],
        why: L('7414 là cổng đảo có trễ ở đầu vào, đúng nguyên lý của khối này.', 'The 7414 is an inverter with hysteresis on its input, which is exactly this block’s principle.'),
      },
    },
  },

  'transfer-block': {
    title: L('Hàm truyền H(s): bộ lọc viết bằng công thức', 'Transfer function H(s): a filter written as a formula'),
    goal: L(
      'Dùng khối hàm truyền H(s) làm bộ lọc thông thấp bậc một, rồi kiểm tra hai điều quen thuộc: −3 dB tại fc và −20 dB mỗi decade.',
      'Use the H(s) transfer-function block as a first-order low-pass, then check the two familiar facts: −3 dB at fc and −20 dB per decade.',
    ),
    theory: L(
      `## Mạch hay công thức?
Một bộ lọc RC thông thấp có hàm truyền

$$H(s) = \\frac{1}{1 + s\\tau},\\qquad \\tau = RC$$

trong đó $s = j2\\pi f$. MachSim cho bạn nhập **trực tiếp** hàm truyền đó: khối “Hàm truyền H(s)” (và các nguồn Laplace) nhận tử số và mẫu số dưới dạng danh sách hệ số, bậc cao của $s$ viết trước. Với $H(s) = 1/(1+s\\tau)$ thì tử số là \\\`1\\\` và mẫu số là \\\`τ 1\\\`.

Nhờ vậy bạn mô phỏng được một khâu mà chưa cần biết nó gồm linh kiện gì — rất tiện khi học lý thuyết điều khiển, hoặc khi muốn thay cả một tầng mạch bằng đặc tính của nó.

## Hai con số phải nhớ
Tần số cắt là nơi phần thực và phần ảo của mẫu số bằng nhau:

$$f_c = \\frac{1}{2\\pi\\tau}$$

Tại $f_c$ biên độ còn

$$|H| = \\frac{1}{\\sqrt{2}} \\approx 0{,}707 \\;\\Rightarrow\\; -3\\ \\text{dB}$$

Ở tần số gấp mười $f_c$:

$$|H| = \\frac{1}{\\sqrt{1 + 10^2}} \\approx 0{,}0995 \\;\\Rightarrow\\; -20\\ \\text{dB}$$

Đó là độ dốc **20 dB mỗi decade** của một khâu bậc một. Bậc hai dốc 40 dB, bậc ba 60 dB.

## Lưu ý khi dùng
Khối lấy đất làm chuẩn và lý tưởng (không có giới hạn dòng). Trong AC nó dùng đúng công thức, một chiều nó dùng $H(0)$, còn khi mô phỏng quá độ MachSim tích phân phương trình tương ứng. Đầu ra nên có một tải hoặc một thiết bị đo để net không chỉ có một chân.`,
      `## A circuit, or a formula?
An RC low-pass has the transfer function

$$H(s) = \\frac{1}{1 + s\\tau},\\qquad \\tau = RC$$

with $s = j2\\pi f$. MachSim lets you type that function **directly**: the "Transfer function H(s)" block (and the Laplace sources) take a numerator and a denominator as coefficient lists, highest power of $s$ first. For $H(s) = 1/(1+s\\tau)$ the numerator is \\\`1\\\` and the denominator is \\\`τ 1\\\`.

So you can simulate a stage without yet knowing which parts it is made of — handy while learning control theory, or when you want to replace a whole stage by its response.

## The two numbers to remember
The corner frequency is where the real and imaginary parts of the denominator are equal:

$$f_c = \\frac{1}{2\\pi\\tau}$$

At $f_c$ the magnitude is

$$|H| = \\frac{1}{\\sqrt{2}} \\approx 0.707 \\;\\Rightarrow\\; -3\\ \\text{dB}$$

Ten times past $f_c$:

$$|H| = \\frac{1}{\\sqrt{1 + 10^2}} \\approx 0.0995 \\;\\Rightarrow\\; -20\\ \\text{dB}$$

That is the **20 dB per decade** slope of a first-order stage. Second order falls 40 dB, third order 60 dB.

## Things to watch
The block is referred to ground and ideal (no current limit). In AC it uses the formula exactly, at DC it uses $H(0)$, and in a transient MachSim integrates the matching equation. Its output wants a load or an instrument, so the net is not left with a single pin.`,
    ),
    steps: {
      block: {
        task: L('Đặt khối “Hàm truyền H(s)”, nhập tử số 1 và mẫu số “159.155u 1”, nối chân IN với nguồn và chân OUT với một tải.', 'Place the "Transfer function H(s)" block, type the numerator 1 and the denominator "159.155u 1", wire IN to a source and OUT to a load.'),
        hint: L('159,155 µs = 1/(2π·1000) nên fc đúng 1 kHz. Tải có thể là một điện trở 1 MΩ hay một dao động ký.', '159.155 µs = 1/(2π·1000), so fc is exactly 1 kHz. The load can be a 1 MΩ resistor or an oscilloscope.'),
      },
      cutoff: {
        task: L('Chạy phân tích AC một tần số tại fc: biên độ ra phải bằng 0,707 lần biên độ vào.', 'Run a single-frequency AC analysis at fc: the output has to be 0.707 of the input.'),
        hint: L('fc = 1/(2πτ) với τ là hệ số đầu của mẫu số. MachSim báo fc mà nó tính được ở bước 1.', 'fc = 1/(2πτ) where τ is the first denominator coefficient. MachSim reports the fc it worked out in step 1.'),
      },
      decade: {
        task: L('Đo tiếp ở tần số gấp mười fc: biên độ phải giảm khoảng 20 dB.', 'Measure again at ten times fc: the output has to fall about 20 dB.'),
        hint: L('20 dB tương ứng tỉ số 1/10. Nếu giảm 40 dB thì mẫu số của bạn là bậc hai.', '20 dB is a ratio of 1/10. If it falls 40 dB, your denominator is second order.'),
      },
    },
    quiz: {
      order: {
        q: L('Mẫu số “159.155u 1” là bậc mấy?', 'What order is the denominator "159.155u 1"?'),
        options: [L('Bậc không', 'Zero order'), L('Bậc một', 'First order'), L('Bậc hai', 'Second order')],
        why: L('Hai hệ số nghĩa là một bậc của s: 159,155µ·s + 1.', 'Two coefficients mean one power of s: 159.155µ·s + 1.'),
      },
      db: {
        q: L('Một khâu bậc một dốc bao nhiêu dB mỗi decade?', 'How many dB per decade does a first-order stage fall?'),
        options: [L('3 dB', '3 dB'), L('6 dB', '6 dB'), L('20 dB', '20 dB')],
        why: L('Trên fc biên độ tỉ lệ 1/f, nên mỗi lần tần số gấp mười thì giảm 20 dB.', 'Above fc the magnitude goes as 1/f, so each factor of ten costs 20 dB.'),
      },
      dc: {
        q: L('Khối dùng giá trị nào khi tính điểm làm việc một chiều?', 'Which value does the block use at the DC operating point?'),
        options: [L('H(0)', 'H(0)'), L('H tại fc', 'H at fc'), L('Không dẫn gì cả', 'Nothing at all')],
        why: L('Một chiều ứng với s = 0, nên MachSim dùng H(0) — ở đây bằng 1.', 'DC means s = 0, so MachSim uses H(0) — here it is 1.'),
      },
    },
  },

  'ic-package': {
    title: L('Một vi mạch, bốn cổng', 'One IC, four gates'),
    goal: L(
      'Dùng một vi mạch 7408 thật để làm hàm Y = A·B·C bằng hai cổng trong cùng một vỏ, và hiểu vì sao các cổng dùng chung một tên linh kiện.',
      'Use one real 7408 IC to build Y = A·B·C from two gates in the same package, and see why the gates share one reference designator.',
    ),
    theory: L(
      `## Ký hiệu một cổng và vi mạch thật
Khi học, ta vẽ một cổng AND là một hình. Nhưng mua về thì không có “một cổng AND”: có **vi mạch 7408**, vỏ 14 chân, bên trong **bốn** cổng AND hai ngõ vào, dùng chung chân nguồn VCC (chân 14) và GND (chân 7).

Vì vậy trong MachSim bạn vẽ được theo hai cách:

- đặt cả vỏ (\\\`7408\\\`): một hình chữ nhật với các chân 1A, 1B, 1Y, 2A, 2B, 2Y, …;
- đặt từng cổng rời (\\\`7408A\\\`, \\\`7408B\\\`, …): MachSim tự cho chúng **cùng một tên linh kiện** U1 khi vỏ đó còn trống cổng ấy, nên netlist, danh sách vật tư và netlist mạch in chỉ thấy một vi mạch, nhãn trên sơ đồ hiện U1A, U1B. Đặt cổng A lần thứ hai thì mới sang vỏ mới U2.

Những cổng bạn không dùng được báo trong Báo cáo › Cổng còn trống.

## Nhiều ngõ vào hơn số cổng có
Cổng 7408 chỉ có hai ngõ vào. Muốn ba ngõ vào thì **ghép tầng** hai cổng:

$$Y = (A \\cdot B) \\cdot C$$

Phép AND có tính kết hợp nên kết quả đúng bằng AND ba ngõ vào. Giá phải trả là thời gian: tín hiệu đi qua hai cổng nên trễ gấp đôi (7408 họ LS trễ khoảng 10 ns mỗi cổng, vậy khoảng 20 ns).

## Chân vào để hở là một lỗi
Trên TTL, chân vào để hở đọc ra mức **1** nhưng rất dễ nhiễu. Cổng không dùng nên nối ngõ vào xuống đất hoặc lên VCC — mạch mẫu nối ngõ vào của hai cổng còn lại xuống đất.

## Mức ra của TTL
Mức cao của TTL không phải 5 V mà khoảng 3,4 V; mức thấp khoảng 0,2 … 0,3 V. Đèn đầu dò trong MachSim có ngưỡng 2,5 V nên vẫn sáng đúng.`,
      `## The teaching symbol and the real IC
While learning we draw an AND gate as one shape. But you cannot buy "one AND gate": you buy a **7408**, a 14-pin package holding **four** two-input AND gates that share one VCC pin (14) and one GND pin (7).

So MachSim lets you draw it two ways:

- place the whole package (\\\`7408\\\`): one rectangle with the pins 1A, 1B, 1Y, 2A, 2B, 2Y, …;
- place single gates (\\\`7408A\\\`, \\\`7408B\\\`, …): MachSim gives them **the same reference designator** U1 as long as that package still has the section free, so the netlist, the bill of materials and the PCB netlist see one chip and the schematic labels read U1A, U1B. Placing gate A a second time starts a new package, U2.

The gates you did not use are listed in Reports › Spare gates.

## More inputs than a gate has
A 7408 gate has two inputs. For three inputs you **cascade** two gates:

$$Y = (A \\cdot B) \\cdot C$$

AND is associative, so the result is exactly a three-input AND. The price is time: the signal passes two gates, so the delay doubles (an LS 7408 gate takes about 10 ns, so about 20 ns).

## An open input is a mistake
On TTL an open input reads as a **1** but picks up noise easily. The inputs of a gate you do not use should be tied to ground or to VCC — the sample circuit ties the inputs of the two spare gates to ground.

## TTL output levels
A TTL high is not 5 V but about 3.4 V; a low is about 0.2 … 0.3 V. MachSim's probe light switches at 2.5 V, so it still reads correctly.`,
    ),
    steps: {
      realIc: {
        task: L('Đặt một vi mạch AND thật (7408 hoặc họ khác) chứ không phải ký hiệu một cổng.', 'Place a real AND IC (a 7408 or another family), not the single-gate symbol.'),
        hint: L('Tìm “7408” trong Chọn linh kiện (Ctrl+K). Có thể đặt cả vỏ, hoặc từng cổng rời — các cổng rời tự dùng chung tên U1.', 'Search "7408" in Select a component (Ctrl+K). Place the whole package, or single gates — those share the name U1 by themselves.'),
      },
      cascade: {
        task: L('Nối hai cổng của cùng vi mạch nối tiếp nhau: ngõ ra cổng 1 vào một ngõ vào cổng 2; ba công tắc logic cấp A, B, C.', 'Cascade two gates of the same IC: gate 1’s output into an input of gate 2; three logic switches drive A, B and C.'),
        hint: L('Nối 1Y với 2A, rồi A → 1A, B → 1B, C → 2B. Đừng để ngõ vào nào hở.', 'Wire 1Y to 2A, then A → 1A, B → 1B, C → 2B. Leave no input open.'),
      },
      allOn: {
        task: L('Bật cả ba công tắc: đầu ra phải lên mức cao.', 'Switch all three on: the output has to go high.'),
        hint: L('Mức cao của TTL khoảng 3,4 V, không phải đúng 5 V.', 'A TTL high is about 3.4 V, not exactly 5 V.'),
      },
      zero: {
        task: L('Tắt một công tắc bất kỳ: đầu ra phải xuống mức thấp.', 'Switch any one off: the output has to go low.'),
        hint: L('Chỉ cần một ngõ vào bằng 0 là AND bằng 0 — kể cả ngõ vào của cổng thứ nhất.', 'One 0 input makes an AND 0 — including an input of the first gate.'),
      },
    },
    quiz: {
      sections: {
        q: L('Vi mạch 7408 chứa mấy cổng AND?', 'How many AND gates does a 7408 hold?'),
        options: [L('Bốn', 'Four'), L('Hai', 'Two'), L('Sáu', 'Six')],
        why: L('7408 là “quad 2-input AND”: bốn cổng, mỗi cổng hai ngõ vào, vỏ 14 chân.', 'The 7408 is a quad 2-input AND: four gates of two inputs each in a 14-pin package.'),
      },
      refdes: {
        q: L('Hai cổng rời cùng một vỏ thì đặt tên linh kiện thế nào?', 'How do you name two single gates of one package?'),
        options: [L('U1 và U2', 'U1 and U2'), L('Cùng U1 (MachSim hiện U1A, U1B)', 'Both U1 (MachSim shows U1A, U1B)'), L('Không cần tên', 'They need no name')],
        why: L('Cùng tên nghĩa là cùng một vi mạch: netlist và danh sách vật tư chỉ tính một con.', 'The same name means the same chip: the netlist and the bill of materials count one part.'),
      },
      spare: {
        q: L('Những cổng trong vỏ mà bạn không dùng thì sao?', 'What happens to the gates of the package you did not use?'),
        options: [
          L('Không tồn tại trong netlist', 'They do not exist in the netlist'),
          L('Bị MachSim xoá đi', 'MachSim removes them'),
          L('Vẫn có trong vỏ và được báo là cổng còn trống', 'They are still in the package and are reported as spare gates'),
        ],
        why: L('Báo cáo › Cổng còn trống liệt kê chúng, và trên mạch in các chân đó vẫn có mặt.', 'Reports › Spare gates lists them, and their pads are still there on the board.'),
      },
    },
  },

  'real-flipflop': {
    title: L('Flip-flop thật 7474 chia tần số', 'A real 7474 flip-flop dividing by two'),
    goal: L(
      'Dùng một nửa vi mạch 7474 làm mạch chia hai, và học cách xử lý hai chân đặt / xoá không đồng bộ tác động mức thấp.',
      'Use one half of a 7474 as a divide-by-two, and learn what to do with its two active-low asynchronous pins.',
    ),
    theory: L(
      `## Từ ký hiệu tới vi mạch
Ký hiệu flip-flop D khi học chỉ có D, CLK, Q, QN. Vi mạch **7474** thật có hai flip-flop trong một vỏ 14 chân, mỗi cái thêm hai chân nữa: $\\overline{PRE}$ (đặt) và $\\overline{CLR}$ (xoá). Vạch trên tên nghĩa là **tác động mức thấp**.

- $\\overline{PRE}$ ở mức 0: ép Q = 1 ngay, không chờ xung nhịp;
- $\\overline{CLR}$ ở mức 0: ép Q = 0 ngay;
- cả hai ở mức 1: flip-flop làm việc bình thường.

Vì vậy muốn flip-flop chạy thì phải **treo cả hai chân lên VCC**. Nối một trong hai xuống đất là flip-flop đứng im — lỗi rất hay gặp.

## Chia hai
Nối QN về D thì mỗi cạnh lên của xung nhịp lại đảo trạng thái, nên

$$f_Q = \\frac{f_{CLK}}{2}$$

Nối n tầng như vậy thì chia được $2^n$ lần. Đó chính là nguyên lý bộ đếm nhị phân.

## Chân hở và nửa còn lại
Trong MachSim chân vào để hở đọc ra mức 1, nên mạch “vẫn chạy” dù bạn quên nối $\\overline{PRE}$. Trên mạch thật thì không nên: chân hở dễ nhiễu. Nửa flip-flop không dùng cũng nên nối D và CLK xuống đất, $\\overline{PRE}$ và $\\overline{CLR}$ lên VCC.`,
      `## From the symbol to the IC
The D flip-flop symbol you learn with has only D, CLK, Q and QN. A real **7474** holds two flip-flops in a 14-pin package, each with two more pins: $\\overline{PRE}$ (preset) and $\\overline{CLR}$ (clear). The bar over the name means **active low**.

- $\\overline{PRE}$ at 0: forces Q = 1 at once, without a clock;
- $\\overline{CLR}$ at 0: forces Q = 0 at once;
- both at 1: the flip-flop works normally.

So to make the flip-flop run you have to **tie both pins to VCC**. Grounding either one freezes it — a very common mistake.

## Dividing by two
Wire QN back to D and every rising clock edge inverts the state, so

$$f_Q = \\frac{f_{CLK}}{2}$$

Chain n of them and you divide by $2^n$. That is exactly how a binary counter works.

## Open pins and the other half
In MachSim an open input reads as a 1, so the circuit "still works" if you forget $\\overline{PRE}$. On a real board it is a bad idea: an open pin picks up noise. The unused half should also have D and CLK at ground and $\\overline{PRE}$, $\\overline{CLR}$ at VCC.`,
    ),
    steps: {
      ic: {
        task: L('Đặt một flip-flop D thật (7474, 74LS74 hoặc 4013) và một nguồn xung nhịp.', 'Place a real D flip-flop (7474, 74LS74 or 4013) and a clock source.'),
        hint: L('Tìm “7474” trong Chọn linh kiện (Ctrl+K). Thêm ký hiệu nguồn VCC 5 V cho vi mạch.', 'Search "7474" in Select a component (Ctrl+K). Add a 5 V VCC symbol for the chip.'),
      },
      async: {
        task: L('Nối hai chân PRE và CLR lên VCC.', 'Tie the PRE and CLR pins to VCC.'),
        hint: L('Hai chân có vạch trên tên nên tác động mức thấp: xuống 0 là ép Q, treo lên 1 là để yên.', 'The bar over their names means active low: at 0 they force Q, at 1 they leave it alone.'),
      },
      toggle: {
        task: L('Nối xung nhịp vào CLK và nối QN về D.', 'Wire the clock to CLK and QN back to D.'),
        hint: L('QN là đầu ra đảo. Nối nó về D là mỗi xung nhịp lại đảo trạng thái.', 'QN is the inverted output. Feeding it back to D inverts the state on every clock.'),
      },
      divide: {
        task: L('Chạy mô phỏng quá độ: tần số ở Q phải bằng một nửa tần số xung nhịp.', 'Run a transient: the frequency at Q has to be half the clock frequency.'),
        hint: L('Nối dao động ký vào cả CLK và Q để thấy rõ. Nếu Q đứng im, kiểm tra lại PRE và CLR.', 'Put an oscilloscope on both CLK and Q to see it. If Q never moves, check PRE and CLR again.'),
      },
    },
    quiz: {
      bar: {
        q: L('Vạch trên tên chân (ví dụ $\\overline{CLR}$) nghĩa là gì?', 'What does a bar over a pin name (for example $\\overline{CLR}$) mean?'),
        options: [L('Chân đó là chân ra', 'The pin is an output'), L('Chân tác động ở mức thấp', 'The pin is active low'), L('Chân không được nối', 'The pin must stay open')],
        why: L('Chân tác động mức thấp: nó làm việc khi được kéo xuống 0.', 'Active low: it does its job when it is pulled down to 0.'),
      },
      half: {
        q: L('Nối QN về D, xung nhịp 1 kHz thì Q dao động ở tần số nào?', 'With QN wired to D and a 1 kHz clock, what frequency appears at Q?'),
        options: [L('500 Hz', '500 Hz'), L('1 kHz', '1 kHz'), L('2 kHz', '2 kHz')],
        why: L('Mỗi cạnh lên đảo trạng thái, nên cần hai xung cho một chu kỳ của Q.', 'Each rising edge inverts the state, so Q needs two clocks for one of its own cycles.'),
      },
      unused: {
        q: L('Nửa flip-flop còn lại trong vỏ nên xử lý thế nào?', 'What should you do with the other flip-flop in the package?'),
        options: [
          L('Để hở hết cho gọn', 'Leave everything open, it is tidier'),
          L('Nối hết xuống đất, kể cả PRE và CLR', 'Ground everything, PRE and CLR included'),
          L('D và CLK xuống đất, PRE và CLR lên VCC', 'D and CLK to ground, PRE and CLR to VCC'),
        ],
        why: L('Chân vào không nên để hở; còn PRE / CLR tác động mức thấp nên phải treo lên VCC.', 'Inputs should not float; and since PRE / CLR are active low they belong at VCC.'),
      },
    },
  },

  'mcu-button': {
    title: L('Vi điều khiển 8051 đọc nút nhấn', 'An 8051 reading a push-button'),
    goal: L(
      'Nối một nút nhấn và một LED vào hai chân cổng của 8051, viết chương trình chép mức chân nút sang chân LED, và chạy thử cùng mạch.',
      'Wire a push-button and an LED to two port pins of an 8051, write a program that copies the button pin to the LED pin, and run it with the circuit.',
    ),
    theory: L(
      `## Cổng của 8051 là cổng hai chiều
Mỗi chân của cổng P1 … P3 vừa đọc được vừa ghi được. Bên trong có một **điện trở treo** khoảng 50 kΩ lên nguồn, còn transistor kéo xuống thì khoẻ (hút được hàng chục mA). Hệ quả:

- muốn **đọc** một nút nhấn: nối nút từ chân xuống **đất**, không cần điện trở treo bên ngoài. Không nhấn thì chân đọc 1, nhấn thì đọc 0;
- muốn **bật** một LED: treo LED từ nguồn +5 V qua điện trở xuống chân, rồi cho chân xuống 0 để LED sáng.

Dòng qua LED:

$$I = \\frac{5 - U_F}{R}$$

Với LED đỏ ($U_F \\approx 1{,}9$ V) và $R$ = 330 Ω thì $I \\approx 9$ mA.

## Đọc và ghi một bit
Hợp ngữ 8051 có cờ nhớ C dùng làm “bit tạm”:

- \\\`MOV C,P1.0\\\` — đọc mức chân P1.0 vào cờ C;
- \\\`MOV P1.1,C\\\` — ghi cờ C ra chân P1.1.

Hai lệnh đó cộng với \\\`SJMP MAIN\\\` là cả chương trình: vòng lặp vô tận chép mức nút sang LED. Nhấn nút (chân nút = 0) thì chân LED = 0 nên LED sáng.

Cách khác là rẽ nhánh theo bit:

\\\`JNB P1.0,PRESSED\\\` nhảy khi P1.0 = 0, \\\`JB\\\` nhảy khi bằng 1.

## Đừng quên
\\\`ORG 0\\\` ở đầu (chương trình bắt đầu ở địa chỉ 0 sau khi reset) và \\\`END\\\` ở cuối. Chân RST của MachSim tác động **mức cao**, để hở là không reset.`,
      `## An 8051 port pin works both ways
Every pin of ports P1 … P3 can be read and written. Inside there is a **pull-up** of about 50 kΩ to the supply, while the pull-down transistor is strong (it sinks tens of mA). So:

- to **read** a push-button: wire the button from the pin down to **ground**, with no external pull-up. Released, the pin reads 1; pressed, it reads 0;
- to **light** an LED: hang the LED from the +5 V supply through a resistor down to the pin, and pull the pin to 0 to light it.

The LED current:

$$I = \\frac{5 - V_F}{R}$$

With a red LED ($V_F \\approx 1.9$ V) and $R$ = 330 Ω that is $I \\approx 9$ mA.

## Reading and writing one bit
8051 assembly uses the carry flag C as a "scratch bit":

- \\\`MOV C,P1.0\\\` — read pin P1.0 into C;
- \\\`MOV P1.1,C\\\` — write C out to pin P1.1.

Those two plus \\\`SJMP MAIN\\\` are the whole program: an endless loop copying the button to the LED. Press the button (button pin = 0) and the LED pin goes to 0, so the LED lights.

The other way is to branch on the bit:

\\\`JNB P1.0,PRESSED\\\` jumps while P1.0 = 0, and \\\`JB\\\` jumps while it is 1.

## Do not forget
\\\`ORG 0\\\` at the top (after a reset the program starts at address 0) and \\\`END\\\` at the bottom. MachSim's RST pin is active **high**, so leaving it open means "not reset".`,
    ),
    steps: {
      button: {
        task: L('Đặt vi điều khiển 8051 và nối một nút nhấn từ một chân cổng (ví dụ P1.0) xuống đất.', 'Place an 8051 and wire a push-button from a port pin (P1.0 for example) down to ground.'),
        hint: L('Không cần điện trở treo: cổng 8051 đã có sẵn điện trở treo bên trong khoảng 50 kΩ.', 'No pull-up resistor is needed: an 8051 port already has one of about 50 kΩ inside.'),
      },
      led: {
        task: L('Nối LED và điện trở 330 Ω từ nguồn +5 V xuống một chân cổng khác (ví dụ P1.1).', 'Wire an LED and a 330 Ω resistor from the +5 V supply down to another port pin (P1.1 for example).'),
        hint: L('Anốt LED về phía nguồn, catốt qua điện trở xuống chân. Thêm ký hiệu nguồn VCC 5 V.', 'The LED anode faces the supply and its cathode goes through the resistor to the pin. Add a 5 V VCC symbol.'),
      },
      program: {
        task: L('Viết chương trình đọc chân nút và ghi ra chân LED, rồi dịch không lỗi.', 'Write a program that reads the button pin and writes the LED pin, and build it without an error.'),
        hint: L('Nhấp đúp vào vi điều khiển để mở Trình soạn mã. Hai lệnh MOV C,P1.0 và MOV P1.1,C trong một vòng SJMP là đủ.', 'Double-click the microcontroller to open the code editor. MOV C,P1.0 and MOV P1.1,C inside an SJMP loop are enough.'),
      },
      lit: {
        task: L('Nhấn nút rồi chạy mô phỏng: LED phải sáng (dòng qua LED vài mA).', 'Press the button and run the simulation: the LED has to light (a few mA through it).'),
        hint: L('Đặt tham số “Đang nhấn” của nút là có, hoặc nhấn phím của nút khi đang mô phỏng.', 'Set the button’s "pressed" parameter, or press the button’s key while the simulation runs.'),
      },
    },
    quiz: {
      pullup: {
        q: L('Vì sao nút nhấn nối từ chân xuống đất mà không cần điện trở treo?', 'Why is a button wired from the pin to ground, with no pull-up resistor?'),
        options: [
          L('Vì chân cổng luôn ở mức 0', 'Because a port pin is always at 0'),
          L('Vì cổng 8051 đã có điện trở treo bên trong', 'Because an 8051 port has its pull-up inside'),
          L('Vì nút nhấn tự tạo mức 1', 'Because the button makes a 1 by itself'),
        ],
        why: L('Điện trở treo trong khoảng 50 kΩ giữ chân ở mức 1 khi nút nhả.', 'The internal pull-up of about 50 kΩ holds the pin at 1 while the button is released.'),
      },
      bit: {
        q: L('Lệnh nào chép mức một chân vào cờ nhớ C?', 'Which instruction copies a pin level into the carry flag C?'),
        options: [L('MOV C,P1.0', 'MOV C,P1.0'), L('MOV P1.0,C', 'MOV P1.0,C'), L('CPL P1.0', 'CPL P1.0')],
        why: L('MOV C,bit đọc bit vào cờ C; MOV bit,C làm điều ngược lại.', 'MOV C,bit reads the bit into C; MOV bit,C does the opposite.'),
      },
      loop: {
        q: L('Nếu bỏ lệnh SJMP MAIN ở cuối thì sao?', 'What happens if the SJMP MAIN at the end is removed?'),
        options: [
          L('Chương trình chạy nhanh hơn', 'The program runs faster'),
          L('LED sáng mãi', 'The LED stays lit for ever'),
          L('Chương trình chỉ đọc nút một lần rồi chạy tiếp vào vùng trống', 'The program reads the button once and then runs on into empty memory'),
        ],
        why: L('Không có vòng lặp thì bộ đếm chương trình chạy tiếp qua các byte 0 và không đọc nút nữa.', 'Without the loop the program counter runs on through zero bytes and never reads the button again.'),
      },
    },
  },

  'ladder-traffic': {
    title: L('Đèn giao thông bằng sơ đồ bậc thang', 'A traffic light in a ladder diagram'),
    goal: L(
      'Dùng một bộ định thời làm nhịp cho cả vòng và các tiếp điểm so sánh để chia vòng thành ba khoảng xanh – vàng – đỏ, bảo đảm không bao giờ có hai đèn sáng cùng lúc.',
      'Use one timer as the clock of the whole cycle and comparison contacts to split it into green, amber and red, with a guarantee that two lamps are never on at once.',
    ),
    theory: L(
      `## Một bộ định thời cho cả vòng
Cách dễ sai là dùng ba bộ định thời nối tiếp nhau: mỗi lần chuyển trạng thái lại cộng thêm một sai số, và lúc sửa thời gian thì phải sửa cả ba. Cách gọn hơn: **một** bộ định thời chạy đúng chiều dài một vòng, rồi so **thời gian đã chạy** của nó với các mốc.

Bậc đầu tiên cho bộ định thời tự khởi động lại:

- tiếp điểm thường **đóng** của chính T1 nối với bộ định thời TON T1, đặt trước 12 s.

Khi T1 chạy đủ 12 s, bit “xong” của nó lên 1, tiếp điểm thường đóng mở ra, bộ định thời bị thả nên trở về 0 — và vòng mới bắt đầu.

## Tiếp điểm so sánh
MachSim cho so sánh số với thời gian đã chạy của bộ định thời (\\\`T1.ET\\\`) hay giá trị bộ đếm (\\\`C1.CV\\\`). Chia vòng 12 s thành ba khoảng:

- 0 … 6 s: T1.ET < 6 → cuộn dây Q0.2 (xanh);
- 6 … 8 s: T1.ET ≥ 6 **và** T1.ET < 8 → cuộn dây Q0.1 (vàng);
- 8 … 12 s: T1.ET ≥ 8 → cuộn dây Q0.0 (đỏ).

Chiều dài vòng phải bằng tổng ba khoảng:

$$T_{vong} = t_{xanh} + t_{vang} + t_{do} = 6 + 2 + 4\\ \\text{s}$$

Hai điều kiện trong một bậc nối **nối tiếp** nghĩa là VÀ. Vì ba khoảng rời nhau nên đúng một đèn sáng tại mọi thời điểm — và điều đó kiểm tra được.

## Thời gian là bội số của chu kỳ quét
Bộ định thời của PLC cộng thêm **một chu kỳ quét** mỗi lần quét, nên thời gian luôn là bội số của chu kỳ quét (mặc định 10 ms). Muốn chính xác hơn thì giảm chu kỳ quét ở linh kiện Bộ điều khiển PLC.

## An toàn
Trong thực tế, đèn giao thông còn phải kiểm tra **không có hai hướng cùng xanh** và **không có hướng nào tối**. Mô hình “Ngã tư đèn giao thông” của MachSim tự kiểm tra hai điều đó và báo lỗi khi chương trình sai.`,
      `## One timer for the whole cycle
The easy way to get it wrong is three timers chained together: every hand-over adds an error, and changing the timing means editing all three. The tidier way is **one** timer running the length of the whole cycle, with its **elapsed time** compared against the switching points.

The first rung makes the timer restart itself:

- a normally **closed** contact of T1 feeds the TON timer T1 with a preset of 12 s.

When T1 has run its 12 s its "done" bit goes to 1, the normally-closed contact opens, the timer is released and falls back to 0 — and the next cycle starts.

## Comparison contacts
MachSim can compare a number with a timer's elapsed time (\\\`T1.ET\\\`) or a counter's value (\\\`C1.CV\\\`). Split the 12 s cycle into three stretches:

- 0 … 6 s: T1.ET < 6 → coil Q0.2 (green);
- 6 … 8 s: T1.ET ≥ 6 **and** T1.ET < 8 → coil Q0.1 (amber);
- 8 … 12 s: T1.ET ≥ 8 → coil Q0.0 (red).

The length of the cycle has to be the sum of the three stretches:

$$T_{cycle} = t_{green} + t_{amber} + t_{red} = 6 + 2 + 4\\ \\text{s}$$

Two conditions **in series** in one rung mean AND. Because the three stretches do not overlap, exactly one lamp is on at any moment — and that can be checked.

## Timing is a multiple of the scan
A PLC timer adds **one scan period** per scan, so its time is always a multiple of the scan period (10 ms by default). For finer timing, lower the scan period on the PLC controller part.

## Safety
A real traffic light also has to prove that **two directions are never green** and that **no direction goes dark**. MachSim's traffic-junction model checks both for you and reports a fault when the program is wrong.`,
    ),
    steps: {
      rack: {
        task: L('Đặt giá PLC (bộ điều khiển + mô-đun ra) và ba đèn trên ba kênh ra, rồi thêm một trang sơ đồ bậc thang.', 'Place a PLC rack (controller + output module) and three lamps on three output channels, then add a ladder sheet.'),
        hint: L('Thư viện: nhóm Số linh tinh → họ “Giá PLC”. Trang bậc thang: menu Đặt → Trang sơ đồ bậc thang.', 'Library: Misc digital → the "PLC rack" family. The sheet: Place → Ladder sheet.'),
      },
      timer: {
        task: L('Viết bậc đầu tiên: một bộ định thời TON chạy đúng một vòng và tự khởi động lại; dùng tiếp điểm so sánh cho các mốc.', 'Write the first rung: a TON timer that runs one whole cycle and restarts itself; use comparison contacts for the switching points.'),
        hint: L('Tiếp điểm thường đóng của chính T1 đặt trước bộ định thời T1 là đủ để nó tự thả và chạy lại.', 'A normally-closed contact of T1 in front of the timer T1 is enough to release it and start it again.'),
      },
      lamps: {
        task: L('Thêm ba bậc, mỗi bậc một cuộn dây ở một địa chỉ ra khác nhau (Q0.0, Q0.1, Q0.2).', 'Add three rungs, each with a coil at a different output address (Q0.0, Q0.1, Q0.2).'),
        hint: L('Bậc vàng cần hai tiếp điểm so sánh nối tiếp: “≥ 6” VÀ “< 8”.', 'The amber rung needs two comparison contacts in series: "≥ 6" AND "< 8".'),
      },
      cycle: {
        task: L('MachSim chạy thử chương trình của bạn một vòng: mỗi đèn phải sáng một lúc, và không bao giờ hai đèn cùng sáng.', 'MachSim runs your own program for one cycle: each lamp has to be on for a while, and never two at once.'),
        hint: L('Nếu báo hai đèn cùng sáng thì các mốc còn chồng lấn — khoảng sau phải bắt đầu đúng ở chỗ khoảng trước kết thúc.', 'If it reports two lamps on, the points still overlap — each stretch has to start exactly where the one before it ends.'),
      },
    },
    quiz: {
      cycle: {
        q: L('Vì sao dùng một bộ định thời cho cả vòng thay vì ba bộ nối tiếp?', 'Why use one timer for the whole cycle instead of three in a chain?'),
        options: [
          L('Vì sai số không cộng dồn và sửa thời gian ở một chỗ', 'Because errors do not add up and the timing is changed in one place'),
          L('Vì PLC chỉ có một bộ định thời', 'Because a PLC only has one timer'),
          L('Vì bộ định thời không đếm xuống được', 'Because a timer cannot count down'),
        ],
        why: L('Mỗi lần chuyển giao giữa các bộ định thời lại thêm một chu kỳ quét sai số.', 'Every hand-over between timers adds another scan period of error.'),
      },
      compare: {
        q: L('Hai tiếp điểm so sánh nối tiếp trong một bậc nghĩa là gì?', 'What do two comparison contacts in series in one rung mean?'),
        options: [L('HOẶC', 'OR'), L('Phủ định', 'NOT'), L('VÀ', 'AND')],
        why: L('Nối tiếp là VÀ, nối song song là HOẶC — đúng như dòng điện chạy qua bậc.', 'Series is AND and parallel is OR — exactly as the current flows along the rung.'),
      },
      safety: {
        q: L('Thời gian của bộ định thời PLC là bội số của cái gì?', 'A PLC timer’s time is a multiple of what?'),
        options: [L('Tần số nguồn điện', 'The mains frequency'), L('Chu kỳ quét', 'The scan period'), L('Số bậc trong chương trình', 'The number of rungs in the program')],
        why: L('Mỗi lần quét bộ định thời cộng đúng một chu kỳ quét, nên thời gian nhỏ nhất đo được bằng chu kỳ quét.', 'Each scan adds exactly one scan period, so the finest time it can resolve is one scan.'),
      },
    },
  },

  'rc-stages': {
    title: L('Dùng lại một tầng mạch: hai tầng RC', 'Reusing a stage: two RC stages'),
    goal: L(
      'Vẽ một tầng lọc RC, lưu nó thành đoạn mạch rồi dán lại để có tầng thứ hai giống hệt, và đo xem hai tầng dốc hơn một tầng bao nhiêu.',
      'Draw one RC filter stage, save it as a snippet and paste it back for an identical second stage, then measure how much steeper two stages are than one.',
    ),
    theory: L(
      `## Vẽ một lần, dùng nhiều lần
Rất nhiều mạch là **cùng một tầng lặp lại**: hai tầng lọc, bốn tầng chia áp, tám kênh giống nhau. Vẽ lại từng tầng bằng tay thì chậm và dễ sai một giá trị.

MachSim có hai cách dùng lại:

- **sao chép – dán** (Ctrl+C, Ctrl+V) trong cùng một thiết kế;
- **đoạn mạch (snippet)**: chọn phần mạch rồi Sửa › Lưu vùng chọn thành snippet… MachSim lưu một **ảnh PNG** mà mạch nằm ngay bên trong tệp ảnh. Ảnh đó xem được bằng mọi trình xem ảnh, gửi được cho bạn bè, và khi kéo vào trang sơ đồ thì mạch hiện ra đúng chỗ bạn thả. Tên linh kiện được giữ nguyên nếu chưa bị dùng, nếu trùng thì MachSim đặt lại tên.

## Hai tầng lọc RC
Một tầng lọc thông thấp có tần số cắt

$$f_c = \\frac{1}{2\\pi RC}$$

và tại $f_c$ biên độ ra còn $1/\\sqrt{2} \\approx 0{,}707$. Ở tần số cao, mỗi tầng dốc 20 dB mỗi decade; **hai** tầng nối tiếp dốc 40 dB mỗi decade — đó là lý do người ta ghép tầng.

## Nhưng không phải nhân đơn giản
Nếu hai tầng cách nhau bằng một bộ đệm (op-amp), biên độ tại $f_c$ đúng bằng $0{,}707^2 = 0{,}5$. Nối trực tiếp thì **tầng sau là tải của tầng trước**: điện trở và tụ của tầng hai mắc thêm vào tụ của tầng một, nên biên độ xuống thấp hơn 0,5 (khoảng 0,33 với hai tầng bằng nhau). Trị số chính xác không quan trọng ở đây; điều phải thấy là **thấp hơn 0,707 rõ rệt** và thấp hơn cả 0,5.

## Kiểm tra bằng một tần số
Không cần quét cả dải: phân tích “AC một tần số” tại đúng $f_c$ cho ngay biên độ và pha, nhanh hơn và đọc dễ hơn.`,
      `## Draw once, use many times
A great many circuits are **the same stage repeated**: two filter stages, four dividers, eight identical channels. Redrawing each one by hand is slow and it is easy to mistype a value.

MachSim gives you two ways to reuse:

- **copy and paste** (Ctrl+C, Ctrl+V) inside one design;
- a **snippet**: select part of the circuit, then Edit › Save selection as snippet… MachSim writes a **PNG picture** with the circuit stored inside the file itself. The picture opens in any image viewer, can be sent to a friend, and dropping it onto a sheet brings the circuit back exactly where you let go. Reference designators are kept when they are free, and renumbered when they are already taken.

## Two RC filter stages
One low-pass stage has the corner frequency

$$f_c = \\frac{1}{2\\pi RC}$$

and at $f_c$ its output is $1/\\sqrt{2} \\approx 0.707$ of the input. At high frequencies each stage falls 20 dB per decade; **two** in a row fall 40 dB per decade — which is why stages get cascaded.

## But it is not a simple product
If a buffer (an op-amp) separates the stages, the magnitude at $f_c$ is exactly $0.707^2 = 0.5$. Wired directly, **the second stage loads the first**: its resistor and capacitor hang across the first stage's capacitor, so the magnitude falls below 0.5 (about 0.33 for two equal stages). The exact number does not matter here; what matters is that it is **clearly below 0.707**, and below 0.5 as well.

## Checking at one frequency
There is no need to sweep the whole band: a "single-frequency AC" analysis at $f_c$ gives the magnitude and the phase at once, faster and easier to read.`,
    ),
    steps: {
      stages: {
        task: L('Vẽ hai tầng RC giống hệt nhau (cùng R, cùng C).', 'Draw two identical RC stages (the same R and the same C).'),
        hint: L('Vẽ một tầng, chọn cả tầng, rồi Sửa › Lưu vùng chọn thành snippet…; dán lại bằng Sửa › Dán, hoặc chỉ cần Ctrl+C và Ctrl+V.', 'Draw one stage, select it, then Edit › Save selection as snippet…; paste it back with Edit › Paste, or simply use Ctrl+C and Ctrl+V.'),
      },
      cascade: {
        task: L('Nối tầng hai vào điểm ra của tầng một.', 'Connect the second stage to the output of the first.'),
        hint: L('Điểm giữa phải có hai điện trở và một tụ gặp nhau.', 'The middle node has two resistors and one capacitor meeting on it.'),
      },
      labels: {
        task: L('Đặt nhãn IN cho điểm vào và OUT cho điểm ra cuối cùng.', 'Label the input net IN and the final output net OUT.'),
        hint: L('Công cụ Nhãn (phím L), nhấp lên dây rồi gõ tên.', 'The label tool (key L): click the wire and type the name.'),
      },
      twice: {
        task: L('Chạy phân tích AC tại tần số cắt của một tầng: biên độ ra phải thấp hơn 0,707 khá nhiều.', 'Run an AC analysis at one stage’s corner frequency: the output has to be well below 0.707.'),
        hint: L('Một tầng cho 0,707 ở fc. Hai tầng cho khoảng 0,3 … 0,5 — nhỏ hơn 0,5 vì tầng hai còn “ăn” vào tầng một.', 'One stage gives 0.707 at fc. Two give about 0.3 … 0.5 — less than 0.5 because the second stage loads the first.'),
      },
    },
    quiz: {
      slope: {
        q: L('Hai tầng RC giống nhau dốc bao nhiêu dB mỗi decade ở tần số cao?', 'How many dB per decade do two identical RC stages fall at high frequency?'),
        options: [L('20 dB', '20 dB'), L('30 dB', '30 dB'), L('40 dB', '40 dB')],
        why: L('Mỗi tầng bậc một dốc 20 dB mỗi decade, hai tầng cộng lại là 40 dB.', 'Each first-order stage falls 20 dB per decade, so two of them fall 40 dB.'),
      },
      snippet: {
        q: L('Đoạn mạch (snippet) của MachSim được lưu thành tệp gì?', 'What kind of file is a MachSim snippet?'),
        options: [
          L('Một tệp .msim rút gọn', 'A shortened .msim file'),
          L('Một tệp .png có mạch nằm bên trong ảnh', 'A .png picture with the circuit stored inside it'),
          L('Một tệp văn bản SPICE', 'A SPICE text file'),
        ],
        why: L('Ảnh PNG vừa xem được bằng mọi trình xem ảnh, vừa mang theo mạch để MachSim dán lại.', 'The PNG can be viewed in any picture viewer and still carries the circuit for MachSim to paste back.'),
      },
      loading: {
        q: L('Vì sao hai tầng RC không cho đúng 0,707 × 0,707 = 0,5 tại fc?', 'Why do two RC stages not give exactly 0.707 × 0.707 = 0.5 at fc?'),
        options: [
          L('Vì tầng sau là tải của tầng trước', 'Because the second stage loads the first'),
          L('Vì tụ điện có ESR', 'Because the capacitors have ESR'),
          L('Vì phép nhân đó sai', 'Because that multiplication is wrong'),
        ],
        why: L('Điện trở và tụ của tầng hai mắc song song với tụ tầng một, nên tầng một suy giảm thêm. Muốn nhân đúng thì chèn một bộ đệm giữa hai tầng.', 'The second stage’s R and C sit across the first stage’s capacitor, so the first stage loses more. Put a buffer between them and the multiplication holds.'),
      },
    },
  },

  'variant-boards': {
    title: L('Hai phương án lắp ráp cho một bảng mạch', 'Two assembly variants of one board'),
    goal: L(
      'Một sơ đồ, hai phương án lắp ráp: phương án đầy đủ và phương án rút gọn bỏ bớt một LED. Xem phương án đang dùng ảnh hưởng tới mô phỏng và danh sách vật tư.',
      'One schematic, two assembly variants: a full one and a cut-down one that leaves an LED off. See how the active variant changes the simulation and the bill of materials.',
    ),
    theory: L(
      `## Một sơ đồ, nhiều bảng mạch
Nhà sản xuất thường làm **một** bảng mạch rồi lắp ra nhiều mẫu: bản đủ có đèn báo và cổng mở rộng, bản rẻ bỏ bớt. Vẽ lại sơ đồ cho từng bản là cách chắc chắn sinh ra lỗi: sửa một chỗ thì phải nhớ sửa ở mọi bản.

Vì vậy MachSim có **phương án lắp ráp** (variant): danh sách các phương án nằm trong tệp thiết kế, và mỗi linh kiện có thể được đánh dấu “không gắn” ở từng phương án.

## Khi nào linh kiện “không gắn”
Linh kiện không gắn ở phương án **đang dùng** thì:

- được vẽ mờ trên sơ đồ;
- **không có** trong netlist, nên mô phỏng coi như nó không tồn tại — chân của nó hở;
- **không có** trong danh sách vật tư, nên số lượng mua đúng cho phương án đó;
- vẫn còn trong netlist mạch in như một chỗ trống (chân hàn vẫn phải có trên bảng).

Đó là điểm quan trọng: bảng mạch **vẫn** có chỗ cho linh kiện, chỉ là không hàn vào. Số linh kiện phải mua cho một phương án vì thế là

$$N_{lap} = N_{so\\ do} - N_{khong\\ gan}$$

## Trong MachSim
- Công cụ › Quản lý phương án: thêm, đổi tên, chọn phương án, và bảng tích “Gắn / Không gắn” cho từng linh kiện.
- Công cụ › Phương án đang dùng: đổi nhanh; thanh trạng thái ghi tên phương án.
- Báo cáo › Danh sách vật tư: đọc theo phương án đang dùng.

## Thử bằng mô phỏng
Nếu bỏ một LED và điện trở hạn dòng của nó, thì khi phương án đó đang dùng, LED kia vẫn sáng mà LED bị bỏ **không có dòng nào cả** — đó là cách chắc chắn nhất để thấy phương án đang thật sự có hiệu lực.`,
      `## One schematic, several boards
A manufacturer usually builds **one** board and assembles several models from it: the full one has indicator lamps and an expansion header, the cheap one leaves them off. Redrawing the schematic per model is a reliable way to create bugs: fix one place and you must remember every copy.

That is why MachSim has **assembly variants**: the list of variants lives in the design file, and any part can be marked "not fitted" in any variant.

## What "not fitted" means
A part that is not fitted in the **active** variant is:

- drawn dimmed on the schematic;
- **absent** from the netlist, so the simulation behaves as if it were not there — its pins are open;
- **absent** from the bill of materials, so the quantities are right for that model;
- still present in the PCB netlist as an empty place (the pads have to be on the board anyway).

That last point matters: the board **does** have room for the part, it is simply not soldered in. The number of parts to order for a variant is therefore

$$N_{variant} = N_{schematic} - N_{not\\ fitted}$$

## In MachSim
- Tools › Variant manager: add, rename and choose a variant, with a grid of "Fitted / Not fitted" ticks per part.
- Tools › Active variant: switch quickly; the status bar shows the variant's name.
- Reports › Bill of materials: follows the active variant.

## Prove it by simulating
If you leave one LED and its series resistor off, then with that variant active the other LED still lights while the one left off carries **no current at all** — the surest way to see that the variant really took effect.`,
    ),
    steps: {
      two: {
        task: L('Vẽ mạch hai LED (mỗi LED một điện trở hạn dòng) rồi tạo hai phương án lắp ráp.', 'Draw a two-LED circuit (each with its own series resistor), then create two assembly variants.'),
        hint: L('Công cụ › Quản lý phương án → “Thêm phương án”. Phương án đầu tiên là bản đầy đủ.', 'Tools › Variant manager → "Add variant". The first one is the full build.'),
      },
      fitted: {
        task: L('Trong một phương án, bỏ dấu “Gắn” của một LED và điện trở của nó.', 'In one variant, untick "Fitted" for one LED and its resistor.'),
        hint: L('Bảng trong Quản lý phương án có một cột cho mỗi phương án; nhấp để đổi Gắn / Không gắn.', 'The variant manager’s grid has one column per variant; click a cell to switch Fitted / Not fitted.'),
      },
      active: {
        task: L('Chọn phương án rút gọn làm phương án đang dùng.', 'Make the cut-down variant the active one.'),
        hint: L('Công cụ › Phương án đang dùng, hoặc nhấp vào ô “Phương án” trên thanh trạng thái.', 'Tools › Active variant, or click the "Variant" cell in the status bar.'),
      },
      dark: {
        task: L('Chạy mô phỏng: LED bị bỏ không có dòng, LED còn lại vẫn sáng.', 'Run the simulation: the LED left off carries no current and the other one still lights.'),
        hint: L('Linh kiện không gắn bị loại khỏi netlist, nên nó không thể có dòng — nếu vẫn có, bạn đang ở phương án khác.', 'A not-fitted part is left out of the netlist, so it cannot carry current — if it does, another variant is active.'),
      },
    },
    quiz: {
      what: {
        q: L('Linh kiện “không gắn” ở phương án đang dùng thì mô phỏng thế nào?', 'How does the simulation treat a part that is not fitted in the active variant?'),
        options: [
          L('Vẫn mô phỏng bình thường', 'It is simulated as usual'),
          L('Bị loại khỏi netlist, chân hở', 'It is left out of the netlist and its pins are open'),
          L('Bị thay bằng một điện trở lớn', 'It is replaced by a large resistor'),
        ],
        why: L('MachSim dựng netlist theo phương án đang dùng nên linh kiện đó không tồn tại với bộ giải.', 'MachSim builds the netlist for the active variant, so the solver never sees the part.'),
      },
      bom: {
        q: L('Danh sách vật tư của phương án rút gọn khác gì?', 'How does the cut-down variant’s bill of materials differ?'),
        options: [
          L('Giống hệt bản đầy đủ', 'It is identical to the full build'),
          L('Chỉ khác phần ghi chú', 'Only its notes differ'),
          L('Thiếu những linh kiện không gắn', 'The not-fitted parts are missing from it'),
        ],
        why: L('Đó chính là mục đích: mua đúng số lượng cho từng phương án.', 'That is the whole point: order the right quantities for each model.'),
      },
      sim: {
        q: L('Trên mạch in, chỗ của linh kiện không gắn thì sao?', 'What about the not-fitted part’s place on the PCB?'),
        options: [
          L('Vẫn có chân hàn, chỉ là để trống', 'Its pads are still there, simply left empty'),
          L('Bị xoá khỏi bảng mạch', 'It is removed from the board'),
          L('Phải làm bảng mạch khác', 'A different board has to be made'),
        ],
        why: L('Một bảng mạch dùng cho mọi phương án, nên chân hàn luôn có mặt.', 'One board serves every variant, so the pads are always there.'),
      },
    },
  },

  'meas-rise': {
    title: L('Để MachSim tự đo: thẻ .meas', 'Let MachSim measure for you: the .meas card'),
    goal: L(
      'Thay vì rê con trỏ trên dao động ký, viết một thẻ .meas để MachSim tự tìm thời điểm tụ nạp tới 63 % và in ra con số.',
      'Instead of dragging a cursor across an oscilloscope, write a .meas card and let MachSim find the instant the capacitor reaches 63 % and print the number.',
    ),
    theory: L(
      `## Đo bằng mắt thì chậm
Muốn biết tụ nạp tới 63 % lúc nào, bạn có thể rê con trỏ trên dao động ký. Nhưng nếu phải làm lại với mười giá trị điện trở, hoặc phải nộp con số chính xác, thì nên để máy đo.

Netlist SPICE có các thẻ \\\`.meas\\\` (viết đủ là \\\`.measure\\\`) làm đúng việc đó. MachSim hiểu chúng cho phân tích quá độ, AC và quét DC, và hiện kết quả thành một bảng trong Máy vẽ.

## Dạng hay dùng
\\\`\\\`\\\`
.meas tran t63 WHEN V(OUT)=3.16
.meas tran tr   TRIG V(OUT) VAL=0.5 RISE=1 TARG V(OUT) VAL=4.5 RISE=1
.meas tran vmax MAX V(OUT)
.meas tran vtb  AVG V(OUT) FROM=1m TO=2m
\\\`\\\`\\\`

- **WHEN** — thời điểm một biểu thức đạt một giá trị;
- **TRIG / TARG** — khoảng thời gian giữa hai lần đạt giá trị (thời gian lên, độ rộng xung);
- **MAX / MIN / PP / AVG / RMS / INTEG** — các con số thống kê trên một khoảng.

## Vì sao 63 %
Điện áp trên tụ khi nạp qua điện trở:

$$u_C(t) = U\\left(1 - e^{-t/\\tau}\\right),\\qquad \\tau = RC$$

Tại $t = \\tau$:

$$u_C = U\\left(1 - e^{-1}\\right) = 0{,}632\\,U$$

Với $U$ = 5 V thì ngưỡng là 3,16 V. Vậy thẻ \\\`.meas tran t63 WHEN V(OUT)=3.16\\\` cho ra đúng $\\tau$. Với $R$ = 10 kΩ và $C$ = 10 nF, $\\tau$ = 100 µs.

## Viết ở đâu
Với một sơ đồ, mở Mô phỏng › Thiết lập phân tích › **SPICE riêng** và viết các thẻ ở đó; chúng được thêm vào netlist mỗi lần chạy. Tên net trong thẻ là **nhãn** bạn đặt trên dây, nên hãy đặt nhãn OUT cho điểm cần đo.`,
      `## Measuring by eye is slow
To find when the capacitor reaches 63 % you can drag a cursor across the oscilloscope. But if you have to repeat it for ten resistor values, or hand in an exact number, let the program measure instead.

SPICE netlists have \\\`.meas\\\` cards (spelled out: \\\`.measure\\\`) for exactly that. MachSim understands them for transient, AC and DC-sweep analyses and shows the results as a table in the Grapher.

## The forms you will use
\\\`\\\`\\\`
.meas tran t63 WHEN V(OUT)=3.16
.meas tran tr   TRIG V(OUT) VAL=0.5 RISE=1 TARG V(OUT) VAL=4.5 RISE=1
.meas tran vmax MAX V(OUT)
.meas tran vavg AVG V(OUT) FROM=1m TO=2m
\\\`\\\`\\\`

- **WHEN** — the instant an expression reaches a value;
- **TRIG / TARG** — the time between two such instants (a rise time, a pulse width);
- **MAX / MIN / PP / AVG / RMS / INTEG** — statistics over a stretch.

## Why 63 %
The voltage on a capacitor charging through a resistor:

$$v_C(t) = V\\left(1 - e^{-t/\\tau}\\right),\\qquad \\tau = RC$$

At $t = \\tau$:

$$v_C = V\\left(1 - e^{-1}\\right) = 0.632\\,V$$

With $V$ = 5 V the threshold is 3.16 V, so \\\`.meas tran t63 WHEN V(OUT)=3.16\\\` returns exactly $\\tau$. With $R$ = 10 kΩ and $C$ = 10 nF, $\\tau$ = 100 µs.

## Where to write it
For a schematic, open Simulate › Analysis settings › **Custom SPICE** and write the cards there; they are added to the netlist on every run. A net name in a card is the **label** you put on the wire, so label the point you want to measure OUT.`,
    ),
    steps: {
      rc: {
        task: L('Vẽ mạch nạp RC từ nguồn xung (ví dụ R = 10 kΩ, C = 10 nF) và đặt nhãn OUT cho điểm trên tụ.', 'Draw an RC charging circuit from a pulse source (R = 10 kΩ, C = 10 nF for example) and label the capacitor node OUT.'),
        hint: L('τ = R·C nên 10 kΩ × 10 nF = 100 µs. Độ rộng xung nên ít nhất 5τ.', 'τ = R·C, so 10 kΩ × 10 nF = 100 µs. Make the pulse at least 5τ wide.'),
      },
      card: {
        task: L('Viết thẻ “.meas tran t63 WHEN V(OUT)=3.16” vào phần SPICE riêng của thiết kế.', 'Write the card ".meas tran t63 WHEN V(OUT)=3.16" into the design’s custom SPICE.'),
        hint: L('Mô phỏng › Thiết lập phân tích → thẻ SPICE riêng. Nếu biên độ xung không phải 5 V thì đổi 3.16 thành 0,632 lần biên độ.', 'Simulate › Analysis settings → the custom SPICE box. If the pulse is not 5 V, change 3.16 to 0.632 of its amplitude.'),
      },
      value: {
        task: L('Chạy mô phỏng quá độ: giá trị .meas phải bằng τ = R·C.', 'Run the transient: the .meas value has to equal τ = R·C.'),
        hint: L('Mở Máy vẽ để xem bảng “Phép đo (.meas)”. Nếu báo không đo được, ngưỡng của bạn nằm ngoài tầm tín hiệu.', 'Open the Grapher to see the "Measurements (.meas)" table. If it reports a failure, your threshold is outside the signal’s range.'),
      },
    },
    quiz: {
      what: {
        q: L('Thẻ “.meas tran t63 WHEN V(OUT)=3.16” cho ra cái gì?', 'What does ".meas tran t63 WHEN V(OUT)=3.16" return?'),
        options: [
          L('Thời điểm V(OUT) đạt 3,16 V', 'The instant V(OUT) reaches 3.16 V'),
          L('Giá trị V(OUT) tại t = 3,16 s', 'The value of V(OUT) at t = 3.16 s'),
          L('Điện áp lớn nhất của V(OUT)', 'The largest value of V(OUT)'),
        ],
        why: L('WHEN đo **thời điểm** biểu thức đạt giá trị đã cho.', 'WHEN measures the **time** at which the expression reaches the given value.'),
      },
      when: {
        q: L('Muốn đo thời gian lên từ 10 % tới 90 % thì dùng dạng nào?', 'Which form measures a rise time from 10 % to 90 %?'),
        options: [L('WHEN', 'WHEN'), L('AVG', 'AVG'), L('TRIG / TARG', 'TRIG / TARG')],
        why: L('TRIG / TARG đo khoảng giữa hai lần vượt ngưỡng, đúng định nghĩa thời gian lên.', 'TRIG / TARG measures the stretch between two crossings, which is what a rise time is.'),
      },
      where: {
        q: L('Với một sơ đồ, thẻ .meas được viết ở đâu?', 'For a schematic, where do you write a .meas card?'),
        options: [
          L('Trong hộp mô tả', 'In the description box'),
          L('Trong phần SPICE riêng của Thiết lập phân tích', 'In the custom SPICE box of Analysis settings'),
          L('Trong tham số của linh kiện', 'In a part’s parameters'),
        ],
        why: L('Phần SPICE riêng được thêm vào netlist mỗi lần chạy, nên thẻ .meas ở đó luôn có hiệu lực.', 'The custom SPICE is added to the netlist on every run, so a .meas card there always applies.'),
      },
    },
  },
};
