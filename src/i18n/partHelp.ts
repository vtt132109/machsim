/**
 * Part-level "What is this?" pages (F1 on a selected part, help browser > part): what the part
 * does, when to use it, how to read it and a tip. Used for parts whose family page alone does
 * not explain them — the round-3 sources and control-function blocks, the behavioural (ABM)
 * sources and the round-3 Basic / Analog / Misc parts (basicExtrasHelp.ts). Original text;
 * loaded with the help dialog (lazy), never at start-up.
 */
import { L } from './core';
import type { HelpEntry } from './help';
import { BASIC_EXTRA_PART_HELP } from './basicExtrasHelp';
import { LADDER_PART_HELP } from './ladderHelp';

const laplace = (out: 'V' | 'I', ctl: 'V' | 'I'): HelpEntry => ({
  what: L(
    `Nguồn ${out === 'V' ? 'áp' : 'dòng'} có hàm truyền Laplace H(s) tuỳ ý, điều khiển bằng ${ctl === 'V' ? 'điện áp V(in+,in−)' : 'dòng điện chạy từ in+ sang in−'}. Ngõ ra = H(s) × tín hiệu điều khiển.`,
    `A ${out === 'V' ? 'voltage' : 'current'} source with any Laplace transfer function H(s), controlled by ${ctl === 'V' ? 'the voltage V(in+,in−)' : 'the current from in+ to in−'}. Output = H(s) × the control signal.`,
  ),
  use: L(
    'Mô hình hoá một khâu của hệ điều khiển, một bộ lọc hay một đối tượng (động cơ, lò nhiệt …) chỉ bằng hàm truyền, không cần vẽ mạch R, L, C.',
    'Model a control-loop stage, a filter or a plant (motor, oven …) by its transfer function alone, without drawing R, L, C.',
  ),
  read: L(
    'Nhập hệ số tử và mẫu, bậc cao nhất của s viết trước: tử "1", mẫu "1m 1" là H(s) = 1/(0.001·s + 1), một mạch lọc thông thấp với fc = 159 Hz. Hoặc chọn "Biểu thức theo s" và gõ 1/(1 + s*1m). Phân tích AC cho đúng |H(jω)| và pha; DC cho H(0); quá độ tích phân hệ phương trình trạng thái.',
    'Enter numerator and denominator coefficients, highest power of s first: numerator "1", denominator "1m 1" is H(s) = 1/(0.001·s + 1), a low-pass with fc = 159 Hz. Or choose "Expression in s" and type 1/(1 + s*1m). AC analysis gives |H(jω)| and the phase exactly; DC gives H(0); the transient integrates the state equations.',
  ),
  tip: L('Bậc của tử không được lớn hơn bậc của mẫu (H(s) phải "hợp thức"). Muốn khâu vi phân thuần, thêm một cực ở xa: s/(1 + s*1u).', 'The numerator degree must not exceed the denominator degree (H(s) must be proper). For a pure differentiator add a far pole: s/(1 + s*1u).'),
});

const abm = (kind: 'V' | 'I'): HelpEntry => ({
  what: L(
    `Nguồn ${kind === 'V' ? 'áp' : 'dòng'} hành vi (ABM): giá trị là một biểu thức tuỳ ý của điện áp nút V(net), dòng nhánh I(Vx) và thời gian time.`,
    `Behavioural (ABM) ${kind === 'V' ? 'voltage' : 'current'} source: its value is any expression of node voltages V(net), branch currents I(Vx) and time.`,
  ),
  use: L('Mô hình hoá nhanh một quan hệ phi tuyến: cảm biến, bộ nhân, nguồn có giới hạn, bảng tra.', 'Quick models of a nonlinear relation: sensors, multipliers, limited sources, look-up tables.'),
  read: L(
    'Dùng được các hàm if(điều kiện, a, b), limit(x, thấp, cao), min, max, abs, sqrt, exp, sin, tanh, u(x) (bậc thang) và table(x, x1,y1, x2,y2, …) (nội suy tuyến tính). Ví dụ: limit(10*V(in), -12, 12) là bộ khuếch đại 10 lần bão hoà ở ±12 V.',
    'Functions: if(condition, a, b), limit(x, low, high), min, max, abs, sqrt, exp, sin, tanh, u(x) (step) and table(x, x1,y1, x2,y2, …) (linear interpolation). Example: limit(10*V(in), -12, 12) is a ×10 amplifier saturating at ±12 V.',
  ),
  tip: L('Tên net trong V( ) là tên nhãn net trên sơ đồ.', 'The net names inside V( ) are the net-label names of the schematic.'),
});

export const PART_HELP: Record<string, HelpEntry> = {
  'sources/behavioral-voltage': abm('V'),
  'sources/behavioral-current': abm('I'),
  'sources/laplace-vcvs': laplace('V', 'V'),
  'sources/laplace-vccs': laplace('I', 'V'),
  'sources/laplace-ccvs': laplace('V', 'I'),
  'sources/laplace-cccs': laplace('I', 'I'),
  'sources/controlled-one-shot': {
    what: L('Bộ đơn ổn: mỗi lần chân TRIG có sườn lên (vượt ngưỡng), ngõ ra tạo đúng một xung có độ rộng định trước.', 'Monostable: every rising edge on TRIG (through the threshold) gives exactly one output pulse of a set width.'),
    use: L('Tạo xung có độ dài cố định từ một tín hiệu bất kỳ: chống dội nút nhấn, tạo trễ, điều chế vị trí xung.', 'Make fixed-length pulses from any signal: button debouncing, delays, pulse-position modulation.'),
    read: L('Độ rộng = pw + kpw·V(CTRL) (chỉ pw khi để hở CTRL), đo giữa hai điểm 50 % của sườn. CLR ở mức cao kết thúc xung ngay. Bật "Cho phép kích lại" để mỗi lần kích trong lúc có xung tính lại độ rộng từ đầu.', 'Width = pw + kpw·V(CTRL) (just pw when CTRL is open), measured between the 50 % points. CLR high ends the pulse at once. With "Retriggerable" every trigger during the pulse starts the width again.'),
    tip: L('Thử: nguồn xung 1 kHz vào TRIG, pw = 0.3m, xem OUT trên dao động ký.', 'Try: a 1 kHz pulse source into TRIG, pw = 0.3m, watch OUT on the oscilloscope.'),
  },
  'sources/current-limiter': {
    what: L('Khối hạn dòng: ngõ ra bám theo gain·V(IN) như một nguồn áp có điện trở trong nhỏ, nhưng dòng ra không vượt quá giới hạn đặt.', 'Current limiter: the output follows gain·V(IN) like a voltage source with a small internal resistance, but its current never exceeds the set limits.'),
    use: L('Mô hình nguồn cấp có bảo vệ quá dòng, ngõ ra op-amp bị giới hạn dòng, bộ sạc dòng không đổi.', 'Model supplies with overcurrent protection, op-amp outputs with current limit, constant-current chargers.'),
    read: L('Khi tải nặng (điện trở tải nhỏ), dòng giữ bằng giới hạn và điện áp ra tụt xuống I·Rtải.', 'With a heavy load (small load resistance) the current stays at the limit and the output voltage drops to I·Rload.'),
  },
  'sources/dc-interactive-voltage': {
    what: L('Nguồn áp DC chỉnh được ngay khi đang chạy mô phỏng tương tác, giống như vặn núm một bộ nguồn thí nghiệm.', 'A DC voltage source you adjust while the interactive simulation runs, like turning the knob of a bench supply.'),
    use: L('Quan sát mạch thay đổi theo điện áp nguồn: đèn LED sáng dần, ổn áp bắt đầu ổn định, bộ so sánh lật trạng thái.', 'Watch a circuit follow the supply voltage: an LED brightening, a regulator coming into regulation, a comparator switching.'),
    read: L('Nhấn phím tắt (mặc định U) để tăng một bước, Shift+phím để giảm, hoặc kéo thanh trượt. Giá trị luôn nằm giữa "Nhỏ nhất" và "Lớn nhất"; "Bước" đặt mỗi lần thay đổi bao nhiêu vôn.', 'Press the key (default U) to raise it by one increment, Shift+key to lower it, or drag the slider. The value stays between "Minimum" and "Maximum"; "Increment" sets the change per step.'),
    tip: L('Đặt một vôn kế (nhóm Chỉ thị) song song để đọc ngay giá trị trên sơ đồ.', 'Put a voltmeter (Indicators) across it to read the value right on the schematic.'),
  },
  'sources/dc-interactive-current': {
    what: L('Nguồn dòng DC chỉnh được khi đang mô phỏng tương tác; dòng đi ra ở cực +.', 'A DC current source adjusted during the interactive simulation; the current leaves through +.'),
    use: L('Quét dòng qua LED, diode Zener hay cuộn dây bằng tay và xem kết quả ngay.', 'Sweep the current through an LED, a Zener or a coil by hand and see the result at once.'),
    read: L('Phím tắt mặc định J (Shift+J giảm), hoặc thanh trượt trong Thuộc tính.', 'Default key J (Shift+J lowers it), or the slider in Properties.'),
  },
  'sources/delay': {
    what: L('Khâu trễ thuần tuý: ngõ ra lặp lại đúng ngõ vào nhưng chậm đi td giây.', 'Pure time delay: the output repeats the input exactly, td seconds later.'),
    use: L('Mô hình thời gian chết của hệ điều khiển (băng tải, ống dẫn nhiệt), đường truyền tín hiệu, bộ lọc lược.', 'Model dead time in control loops (conveyors, heat pipes), signal transport, comb filters.'),
    read: L('Trong AC độ lợi bằng 1 ở mọi tần số và pha giảm tuyến tính: −360°·f·td. Đây là lý do khâu trễ làm hệ kín dễ dao động.', 'In AC the gain is 1 at every frequency and the phase falls linearly: −360°·f·td. That is why a delay makes closed loops oscillate easily.'),
    tip: L('Bước mô phỏng bị giới hạn bởi td, nên đừng đặt td quá nhỏ so với thời gian mô phỏng.', 'The time step is limited to td, so do not make td tiny compared with the simulated time.'),
  },
  'sources/pwm-voltage': {
    what: L('Nguồn xung PWM: tần số cố định, hệ số làm việc đặt được, có thể điều chế bằng sóng sin.', 'PWM source: fixed frequency, adjustable duty cycle, optionally sine-modulated.'),
    use: L('Điều khiển động cơ, đèn LED, mạch nguồn xung; thử bộ lọc khôi phục tín hiệu từ PWM.', 'Drive motors, LEDs, switch-mode stages; test the filter that recovers a signal from PWM.'),
    read: L('Giá trị trung bình của ngõ ra = thấp + (cao − thấp)·hệ số làm việc. Với độ sâu điều chế, hệ số làm việc thay đổi theo sin ở tần số điều chế.', 'Mean output = low + (high − low)·duty. With a modulation depth the duty follows a sine at the modulation frequency.'),
  },
  'sources/bipolar-voltage': {
    what: L('Nguồn xung lưỡng cực: xung dương +A, nghỉ ở 0 V, xung âm −A, rồi nghỉ ở 0 V.', 'Bipolar pulse source: a positive pulse +A, rest at 0 V, a negative pulse −A, rest at 0 V.'),
    use: L('Sóng vuông đối xứng ±A (khoảng nghỉ 0), tín hiệu mã đường dây kiểu AMI, kích cầu H.', 'A symmetric ±A square wave (gap 0), AMI-style line codes, H-bridge drive.'),
  },
  'sources/vc-sawtooth': {
    what: L('Bộ dao động răng cưa điều khiển bằng điện áp: tần số f = f0 + k·V(in+,in−).', 'Voltage-controlled sawtooth oscillator: frequency f = f0 + k·V(in+,in−).'),
    use: L('Tạo sóng quét cho bộ điều chế PWM, quét tần số, tổng hợp âm thanh.', 'Ramp for PWM modulators, frequency sweeps, sound synthesis.'),
  },
  'analog/summer-2': {
    what: L('Bộ cộng hai ngõ vào: V(OUT) = ka·V(A) + kb·V(B) + độ lệch.', 'Two-input summer: V(OUT) = ka·V(A) + kb·V(B) + offset.'),
    use: L('Tạo sai số e = đặt − đo của vòng điều khiển (ka = 1, kb = −1), trộn tín hiệu.', 'Make the loop error e = setpoint − measurement (ka = 1, kb = −1), mix signals.'),
  },
  'analog/integrator-reset': {
    what: L('Bộ tích phân có chân reset và giới hạn ngõ ra: V(OUT) = giá trị đầu + k·∫V(IN)dt.', 'Integrator with a reset input and output limits: V(OUT) = initial value + k·∫V(IN)dt.'),
    use: L('Khâu I của bộ điều khiển PI / PID, tạo sóng tam giác / răng cưa, đo diện tích tín hiệu.', 'The I term of PI / PID controllers, triangle / sawtooth generators, signal area.'),
    read: L('Ngõ vào hằng 1 V với k = 1000 cho dốc 1 V/ms. Khi V(RST) lớn hơn ngưỡng, ngõ ra về giá trị đầu và đứng yên. Khi có giới hạn, ngõ ra dừng ở giới hạn và tích phân không "chạy quá" (chống windup), nên khi ngõ vào đổi dấu ngõ ra rời giới hạn ngay.', 'A constant 1 V input with k = 1000 ramps at 1 V/ms. While V(RST) is above the threshold the output returns to the initial value and stays there. With limits the output stops at the limit and the integral does not run away (anti-windup), so it leaves the limit as soon as the input changes sign.'),
  },
  'analog/hysteresis': {
    what: L('Khối trễ (Schmitt): ngõ ra lên mức cao khi ngõ vào vượt ngưỡng trên, xuống mức thấp khi ngõ vào xuống dưới ngưỡng dưới.', 'Hysteresis (Schmitt) block: the output goes high when the input rises above the upper threshold and low when it falls below the lower one.'),
    use: L('Chống nhiễu khi so sánh, điều khiển đóng / ngắt (bình nước nóng, máy bơm), bộ tạo dao động.', 'Noise-proof comparison, on / off control (water heater, pump), oscillators.'),
    read: L('Quét DC từ thấp lên cao rồi từ cao xuống thấp sẽ thấy hai đường khác nhau: đó là vòng trễ, rộng bằng ngưỡng trên − ngưỡng dưới.', 'A DC sweep up and then down shows two different curves: that is the hysteresis loop, as wide as upper − lower threshold.'),
  },
  'analog/slew-limiter': {
    what: L('Bộ hạn tốc độ biến thiên: ngõ ra bám ngõ vào nhưng không tăng / giảm nhanh hơn tốc độ đặt (V/s).', 'Slew-rate limiter: the output follows the input but never rises / falls faster than the set rate (V/s).'),
    use: L('Mô hình giới hạn tốc độ quay của op-amp, khởi động mềm, giới hạn gia tốc của cơ cấu chấp hành.', 'Model op-amp slew rate, soft start, actuator rate limits.'),
    read: L('Một bậc 0 → 5 V với tốc độ 1k V/s thành một dốc dài 5 ms. Tín hiệu nhỏ, chậm đi qua không đổi.', 'A 0 → 5 V step with a 1k V/s rate becomes a 5 ms ramp. Small, slow signals pass unchanged.'),
  },
  'analog/transfer-function': laplace('V', 'V'),
  'analog/sample-hold': {
    what: L('Bộ lấy mẫu và giữ: ghi lại giá trị ngõ vào tại một thời điểm và giữ nó ở ngõ ra.', 'Sample-and-hold: records the input value at an instant and holds it at the output.'),
    use: L('Phần đầu của bộ ADC, hệ điều khiển số (khâu giữ bậc 0), đo đỉnh tín hiệu.', 'The front of an ADC, digital control (zero-order hold), peak capture.'),
    read: L('Chế độ sườn cho dạng bậc thang: mỗi sườn lên của CLK lấy một mẫu. Chế độ bám: khi CLK ở mức cao ngõ ra bám theo ngõ vào, khi CLK xuống thấp ngõ ra giữ giá trị cuối.', 'Edge mode gives a staircase: every rising CLK edge takes a sample. Track mode: while CLK is high the output follows the input, when CLK goes low it holds the last value.'),
  },
  'analog/pwm-modulator': {
    what: L('Bộ điều chế PWM: biến điện áp vào thành chuỗi xung có hệ số làm việc tỉ lệ với nó.', 'PWM modulator: turns the input voltage into a pulse train whose duty cycle is proportional to it.'),
    use: L('Khâu công suất của bộ điều khiển động cơ, bộ khuếch đại class D, nguồn xung.', 'The power stage of motor controllers, class-D amplifiers, switch-mode supplies.'),
    read: L('Hệ số làm việc D = (V(IN) − Vmin)/(Vmax − Vmin), lấy mẫu ở đầu mỗi chu kỳ. Lọc thông thấp ngõ ra sẽ thu lại tín hiệu vào.', 'Duty D = (V(IN) − Vmin)/(Vmax − Vmin), sampled at the start of each period. Low-pass filtering the output recovers the input.'),
  },
};

const groundRef = (n: number): HelpEntry => ({
  what: L(
    `Đất tham chiếu ${n}: điểm 0 V riêng của một phần mạch cách ly. Nó KHÔNG phải Đất chính: nó là một net riêng (GNDREF${n}) chỉ nối với Đất chính qua 1 GΩ để bộ giải phương trình có điểm tựa.`,
    `Reference ground ${n}: the private 0 V point of an isolated part of the circuit. It is NOT the main ground: it is its own net (GNDREF${n}) joined to the main ground only through 1 GΩ so the solver has a reference.`,
  ),
  use: L(
    'Cuộn thứ cấp của biến áp, phía ra của optocoupler, nguồn cách ly, phép đo "thả nổi" (ví dụ đo điện áp trên điện trở shunt phía cao).',
    'A transformer secondary, the output side of an optocoupler, an isolated supply, a floating measurement (e.g. a high-side shunt).',
  ),
  read: L(
    `Đầu dò điện áp đặt trên phần mạch chỉ có Đất tham chiếu ${n} đo so với nó (cờ đầu dò hiện "–GNDREF${n}"). Nếu phần mạch đó còn nối một chiều với Đất chính, ERC cảnh báo "không cách ly". Một mạch chỉ có Đất tham chiếu (không có Đất chính) vẫn chạy được.`,
    `Voltage probes on a part of the circuit whose only reference is reference ground ${n} read against it (the probe flag shows "–GNDREF${n}"). If that part is still DC-connected to the main ground, ERC warns "not isolated". A circuit with only a reference ground (no main ground) still runs.`,
  ),
  tip: L('Các số 1…5 là năm điểm tham chiếu độc lập: dùng số khác nhau cho các phần cách ly khác nhau.', 'Numbers 1…5 are five independent references: use a different number for each isolated part.'),
});
for (const n of [1, 2, 3, 4, 5]) PART_HELP[`sources/ground-ref${n}`] = groundRef(n);
// round-3 Basic / Analog / Misc parts (src/i18n/basicExtrasHelp.ts)
Object.assign(PART_HELP, BASIC_EXTRA_PART_HELP);
Object.assign(PART_HELP, LADDER_PART_HELP);
