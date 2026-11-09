/**
 * "What is this?" pages of the round-3 Basic / Analog / Misc families and the F1 pages of their
 * parts (non-ideal R / L / C, Z loads, resistor packs, sockets, annotation symbols, DIP switches,
 * keypads, rotary switches, multi-winding and saturating magnetics, 3D learner parts, OTA, CFA,
 * PLL, isolation / difference amplifiers, gate drivers). Merged into FAMILY_HELP
 * (catalogHelp.ts) and PART_HELP (partHelp.ts); loaded with the help dialog. Original text.
 */
import { L } from './core';
import type { HelpEntry } from './help';

export const BASIC_EXTRA_FAMILY_HELP: Record<string, HelpEntry> = {
  'Non-ideal RLC': {
    what: L('Điện trở, tụ điện và cuộn cảm “thật”: mỗi linh kiện có thêm các phần tử ký sinh (điện cảm chân, ESR, ESL, điện trở rò, điện dung giữa các vòng dây).', '“Real” resistors, capacitors and inductors: each part carries its parasitic elements (lead inductance, ESR, ESL, leakage resistance, winding capacitance).'),
    use: L('Hiểu vì sao tụ lọc nguồn không lọc được nhiễu tần số cao, vì sao cuộn cảm “biến thành tụ” ở tần số cao, chọn tụ thoát cho IC.', 'See why a supply capacitor stops filtering at high frequency, why an inductor “turns into a capacitor” at high frequency, and how to choose decoupling capacitors.'),
    read: L('Chạy phân tích AC và vẽ trở kháng: tụ có điểm thấp nhất bằng ESR ở tần số cộng hưởng riêng f = 1/(2π√(ESL·C)); cuộn cảm có đỉnh ở f = 1/(2π√(L·Cp)). Dưới tần số đó linh kiện làm đúng việc của nó, trên tần số đó thì ngược lại.', 'Run an AC analysis and plot the impedance: the capacitor has its minimum, equal to the ESR, at the self-resonance f = 1/(2π√(ESL·C)); the inductor has its peak at f = 1/(2π√(L·Cp)). Below that frequency the part does its job, above it the opposite.'),
    tip: L('Đặt ESR / ESL / Cp = 0 thì linh kiện trở về lý tưởng. Mẫu “Tụ điện thực: cộng hưởng riêng” cho thấy ngay hiện tượng này.', 'Set ESR / ESL / Cp to 0 and the part becomes ideal again. The sample “Real capacitors: self-resonance” shows the effect at once.'),
  },
  'Z load': {
    what: L('Tải có trở kháng phức Z cho trước tại một tần số: nhập R + jX, hoặc độ lớn |Z| và góc pha φ.', 'A load with a given complex impedance Z at one frequency: enter R + jX, or the magnitude |Z| and the phase φ.'),
    use: L('Thay một động cơ, loa, ăng-ten hay đường dây bằng trở kháng đo được của nó; luyện bài tập mạch xoay chiều có số phức.', 'Stand in for a motor, loudspeaker, antenna or line by its measured impedance; practise AC circuit problems with complex numbers.'),
    read: L('X > 0 là tải cảm (MachSim dùng cuộn cảm L = X/(2πf)), X < 0 là tải dung (tụ C = −1/(2πf·X)). Đúng tuyệt đối tại f; ở tần số khác tải đổi theo cặp R-L hoặc R-C đó.', 'X > 0 is an inductive load (MachSim uses an inductor L = X/(2πf)), X < 0 a capacitive one (C = −1/(2πf·X)). Exact at f; at other frequencies the load follows that R-L or R-C pair.'),
    tip: L('Dạng nối tiếp với X < 0 chặn dòng một chiều; dạng song song với X > 0 làm ngắn mạch một chiều — chọn dạng phù hợp với điểm làm việc DC của mạch.', 'The series form with X < 0 blocks DC; the parallel form with X > 0 is a DC short — pick the one that suits the circuit’s DC operating point.'),
  },
  'Resistor pack': {
    what: L('Nhiều điện trở trong một vỏ: SIP chung chân (mọi điện trở về chân 1), DIP / SIP riêng rẽ, mảng kết cuối kép (mỗi đường có R1 lên nguồn và R2 xuống đất).', 'Several resistors in one package: bussed SIP (every resistor to pin 1), isolated DIP / SIP, dual terminators (each line with R1 to the supply and R2 to ground).'),
    use: L('Điện trở kéo lên cho bus dữ liệu, điện trở hạn dòng cho thanh LED, kết cuối đường truyền.', 'Pull-ups for a data bus, current-limiting resistors for an LED bar, line terminations.'),
    read: L('Mọi điện trở trong mảng có cùng giá trị (trừ mảng kết cuối có R1 / R2). Các chân không dùng có thể để hở mà không bị cảnh báo.', 'All resistors of a pack have the same value (the terminator has R1 / R2). Unused pins may stay open without a warning.'),
  },
  Socket: {
    what: L('Đế cắm cho IC DIP. Chỉ là chỗ giữ chỗ: có trong BOM nhưng không mô phỏng.', 'A socket for DIP ICs. Only a placeholder: listed in the BOM but not simulated.'),
    use: L('Ghi vào danh sách linh kiện rằng IC được cắm trên đế (dễ thay khi thực hành).', 'Record in the parts list that an IC sits in a socket (easy to swap in the lab).'),
    read: L('Mỗi chân của đế chỉ cho net đi qua: mọi dây nối vào cùng một chân là cùng một net. IC vẫn phải đặt riêng bằng linh kiện của nó.', 'Each socket pin only passes its net through: every wire on the same pin is one net. Place the IC itself as its own part.'),
  },
  'Schematic symbols': {
    what: L('Ký hiệu chỉ để vẽ: điểm đo, mũi tên tín hiệu vào / ra, ăng-ten, ký hiệu vỏ máy, ký hiệu đất bảo vệ, dấu chân không nối. Chúng hiện màu nhạt để phân biệt với linh kiện điện.', 'Drawing-only symbols: test point, signal in / out arrows, antenna, chassis marker, protective-earth marker, no-connect mark. They are drawn dimmed so you can tell them from electrical parts.'),
    use: L('Làm sơ đồ dễ đọc như bản vẽ thật: đánh dấu chỗ đo, chỗ tín hiệu vào ra, chân cố ý để hở.', 'Make the schematic read like a real drawing: mark measurement points, where signals enter and leave, pins left open on purpose.'),
    read: L('Không ký hiệu nào tham gia mô phỏng. Ký hiệu vỏ máy / đất bảo vệ KHÔNG nối vào đất 0 V của mô phỏng — muốn nối đất, dùng Đất trong nhóm Nguồn.', 'None of them takes part in the simulation. The chassis / protective-earth markers do NOT join the simulation’s 0 V ground — for that use Ground from the Sources group.'),
    tip: L('Đặt dấu chân không nối lên một chân để ERC không còn cảnh báo “chân chưa nối”.', 'Put the no-connect mark on a pin so ERC stops warning that it is not connected.'),
  },
  'Controlled RLC': {
    what: L('Điện trở, tụ điện và cuộn cảm có giá trị thay đổi theo một điện áp điều khiển V(C+, C−): giá trị = giá trị gốc + hệ số·V(C+, C−).', 'A resistor, capacitor and inductor whose value follows a control voltage V(C+, C−): value = base value + gain·V(C+, C−).'),
    use: L('Mô hình JFET / quang trở làm biến trở, diode biến dung, cuộn kháng bão hoà; bộ lọc và mạch dao động điều chỉnh bằng điện áp; vòng tự động điều chỉnh độ lợi.', 'Model a JFET / LDR used as a variable resistor, a varactor, a saturable reactor; voltage-tuned filters and oscillators; automatic gain control loops.'),
    read: L('Ví dụ R0 = 1 kΩ, kr = 500 Ω/V: với 2 V điều khiển, R = 2 kΩ. Giá trị không bao giờ nhỏ hơn mức tối thiểu (thẻ Nâng cao), kể cả khi điện áp điều khiển âm.', 'Example R0 = 1 kΩ, kr = 500 Ω/V: with 2 V of control, R = 2 kΩ. The value never goes below its minimum (Advanced tab), even for a negative control voltage.'),
    tip: L('Chân điều khiển gần như không lấy dòng (1 TΩ); nối nó vào nguồn DC tương tác để chỉnh bằng thanh trượt khi đang chạy.', 'The control pins draw almost no current (1 TΩ); connect them to an interactive DC source to adjust with the slider while running.'),
  },
  '3D learner parts': {
    what: L('Linh kiện vẽ giống hình thật (vạch màu điện trở, đầu LED, vỏ tụ hoá, transistor TO-92, IC 555, nút nhấn, công tắc gạt, chiết áp), có giá trị cố định.', 'Parts drawn as they look in real life (resistor colour bands, LED dome, electrolytic can, TO-92 transistor, 555 IC, push button, slide switch, potentiometer) with fixed values.'),
    use: L('Cho người mới bắt đầu nhận ra linh kiện trên bàn thí nghiệm và trên breadboard.', 'Help beginners recognise the parts on the lab bench and on the breadboard.'),
    read: L('Về điện, mỗi linh kiện 3D giống hệt linh kiện chung tương ứng (cùng mô hình, cùng hình trên breadboard). Đọc vạch màu: hai số đầu, rồi số mũ của 10, vạch vàng kim = ±5 %.', 'Electrically every 3D part is exactly its generic part (same model, same breadboard body). Reading the bands: two digits, then the power of ten, gold = ±5 %.'),
    tip: L('Muốn giá trị khác, dùng linh kiện chung trong họ Điện trở / Tụ điện.', 'For another value use the generic part of the Resistor / Capacitor family.'),
  },
  'Transconductance amplifier': {
    what: L('Khuếch đại hỗ dẫn (OTA): ngõ ra là dòng điện tỉ lệ với hiệu điện áp vào, I = gm·(V+ − V−), và gm tỉ lệ với dòng phân cực đưa vào chân IABC.', 'Operational transconductance amplifier: the output is a current proportional to the input difference, I = gm·(V+ − V−), and gm is proportional to the bias current into IABC.'),
    use: L('Khuếch đại điều khiển bằng áp (VCA), bộ lọc điều chỉnh được, bộ nhân tương tự, nhạc cụ điện tử.', 'Voltage-controlled amplifiers (VCA), tunable filters, analog multipliers, synthesizers.'),
    read: L('gm = IABC/(2·VT) ≈ 19.3 mS cho mỗi mA ở 27 °C. Nối điện trở tải RL từ OUT xuống đất: hệ số khuếch đại áp = gm·RL. Dòng ra không vượt ±IABC, nên tín hiệu vào chỉ nên vài chục mV.', 'gm = IABC/(2·VT) ≈ 19.3 mS per mA at 27 °C. Put a load RL from OUT to ground: the voltage gain is gm·RL. The output current never exceeds ±IABC, so keep the input to a few tens of mV.'),
    tip: L('Đưa dòng vào IABC bằng một điện trở từ V+ (IABC ≈ (V+ − V− − 1.2 V)/R) hoặc bằng nguồn dòng.', 'Feed IABC through a resistor from V+ (IABC ≈ (V+ − V− − 1.2 V)/R) or with a current source.'),
  },
  'Current-feedback amplifier': {
    what: L('Op-amp hồi tiếp dòng: ngõ vào đảo có trở kháng thấp, dòng sai lệch chảy qua nó được biến thành điện áp ra.', 'Current-feedback op-amp: the inverting input has a low impedance, and the error current through it is turned into the output voltage.'),
    use: L('Khuếch đại băng rộng: video, cáp, ADC tốc độ cao, tầng lái tải nặng.', 'Wideband amplification: video, cable drivers, fast ADC drivers, heavy loads.'),
    read: L('Băng thông vòng kín ≈ 1/(2π·CT·RF) do điện trở hồi tiếp RF quyết định, gần như không đổi khi tăng hệ số khuếch đại (khác hẳn op-amp thường mất băng thông theo hệ số khuếch đại).', 'The closed-loop bandwidth ≈ 1/(2π·CT·RF) is set by the feedback resistor RF and hardly changes with gain (unlike a voltage-feedback op-amp, which trades bandwidth for gain).'),
    tip: L('Không dùng tụ điện làm hồi tiếp thuần (mạch tích phân): CFA sẽ dao động. Dùng RF gần giá trị khuyến nghị trong mô tả.', 'Never use a pure capacitor as feedback (integrator): a CFA oscillates. Use RF close to the recommended value.'),
  },
  PLL: {
    what: L('Vòng khoá pha: bộ so pha, bộ lọc vòng và bộ dao động điều khiển bằng áp (VCO) nối thành vòng kín, giữ cho VCO cùng tần số và pha với tín hiệu vào.', 'Phase-locked loop: a phase detector, a loop filter and a voltage-controlled oscillator (VCO) in a closed loop that keeps the VCO at the input’s frequency and phase.'),
    use: L('Giải điều chế FM, khôi phục xung nhịp, tổng hợp tần số, bám tần số lưới điện.', 'FM demodulation, clock recovery, frequency synthesis, tracking the mains frequency.'),
    read: L('Khi đã khoá, OUT có đúng tần số ngõ vào và V(VCTRL) = (fin − f0)/kv — đọc VCTRL là đo được tần số vào. Vòng chỉ giữ khoá trong khoảng f0 ± (2/π)·kd·kv.', 'Once locked, OUT has exactly the input frequency and V(VCTRL) = (fin − f0)/kv — reading VCTRL measures the input frequency. The loop only holds lock within f0 ± (2/π)·kd·kv.'),
    tip: L('Chọn bước thời gian quá độ ≤ 1/(20·f0) để thấy rõ dạng sóng. Thêm tụ từ VCTRL xuống đất để lọc kỹ hơn (khoá chậm hơn).', 'Use a transient step ≤ 1/(20·f0) to see the waveforms clearly. Add a capacitor from VCTRL to ground for more filtering (slower locking).'),
  },
  'Isolation amplifier': {
    what: L('Bộ khuếch đại truyền tín hiệu qua một rào cách ly: phía vào và phía ra có đất riêng, không nối điện với nhau.', 'An amplifier that carries a signal across an isolation barrier: the input and output sides have separate grounds with no galvanic connection.'),
    use: L('Đo điện áp / dòng trên phần mạch ở điện thế cao (điện lưới, động cơ, pin), bảo vệ người và thiết bị đo.', 'Measure voltages / currents on circuitry at high potential (mains, motor drives, batteries) and protect people and instruments.'),
    read: L('V(OUT, GND2) = G·V(IN+, IN−), dù GND1 cách GND2 hàng trăm vôn. Giữa hai đất chỉ có điện trở và điện dung rất nhỏ của rào cách ly.', 'V(OUT, GND2) = G·V(IN+, IN−), even with GND1 hundreds of volts away from GND2. Only the barrier’s tiny resistance and capacitance join the two grounds.'),
  },
  'Difference amplifier': {
    what: L('Op-amp cùng bốn điện trở chính xác trong một IC: V(OUT) = G·(V(IN+) − V(IN−)) + V(REF).', 'An op-amp with four precision resistors in one IC: V(OUT) = G·(V(IN+) − V(IN−)) + V(REF).'),
    use: L('Đo dòng qua điện trở sun, lấy tín hiệu vi sai, dịch mức.', 'Current sensing across a shunt, differential signals, level shifting.'),
    read: L('INA105: G = 1, INA106: G = 10. Điện áp chung của hai ngõ vào bị khử nhờ bốn điện trở khớp nhau; điện áp ở REF cộng thẳng vào ngõ ra.', 'INA105: G = 1, INA106: G = 10. The common-mode voltage of the inputs cancels thanks to the four matched resistors; the voltage on REF adds straight to the output.'),
    tip: L('Để hở chân SENSE thì MachSim nối nó vào OUT như cách dùng thông thường.', 'Leave SENSE open and MachSim ties it to OUT, the usual connection.'),
  },
  'Gate driver': {
    what: L('Mạch lái cổng MOSFET / IGBT: biến tín hiệu logic yếu thành xung dòng lớn để nạp và xả nhanh điện dung cổng.', 'MOSFET / IGBT gate driver: turns a weak logic signal into large current pulses that charge and discharge the gate capacitance quickly.'),
    use: L('Bộ nguồn xung, điều khiển động cơ, nghịch lưu nửa cầu / cầu H.', 'Switch-mode supplies, motor control, half-bridge / H-bridge inverters.'),
    read: L('Sườn lên 10–90 % trên tải C ≈ 2.2·ROH·C, sườn xuống ≈ 2.2·ROL·C, sau thời gian trễ truyền. Dòng nạp đỉnh ≈ VDD/ROH (giới hạn ở dòng đỉnh của IC).', 'The 10–90 % rise on a load C ≈ 2.2·ROH·C, the fall ≈ 2.2·ROL·C, after the propagation delay. The peak charging current ≈ VDD/ROH (limited to the IC’s peak current).'),
    tip: L('Mạch lái nửa cầu cần tụ bootstrap từ VB xuống VS để cấp nguồn cho phía cao.', 'The half-bridge driver needs a bootstrap capacitor from VB to VS to supply the high side.'),
  },
};

const dipSwitch: HelpEntry = {
  what: L('Nhiều công tắc bật / tắt nhỏ trong một vỏ DIP; vị trí k nối chân Ak với Bk.', 'Several small on / off switches in one DIP package; position k joins pin Ak to Bk.'),
  use: L('Đặt địa chỉ, cấu hình, chọn chế độ bằng tay (vd. đưa mã nhị phân vào IC số).', 'Setting addresses, configuration and modes by hand (e.g. a binary code into a logic IC).'),
  read: L('Khi đang mô phỏng: bấm vào từng vị trí, hoặc nhấn phím 1, 2, 3 … để gạt; chấm tô màu là vị trí đang bật. Ô “Phím” đổi phím cho từng vị trí.', 'While the simulation runs: click a position, or press 1, 2, 3 … to flip it; a filled dot marks a position that is on. The “Keys” box changes the key of each position.'),
  tip: L('Dùng cùng điện trở kéo lên / kéo xuống (mảng điện trở) để mỗi vị trí cho mức logic rõ ràng.', 'Use pull-up / pull-down resistors (a resistor pack) so every position gives a clean logic level.'),
};

const rotary: HelpEntry = {
  what: L('Công tắc xoay 1 cực: chân chung COM nối với đúng một trong các vị trí P1, P2 …', 'Single-pole rotary switch: the common pin COM connects to exactly one of the positions P1, P2 …'),
  use: L('Chọn thang đo, chọn kênh, chọn tần số trong máy đo và máy phát.', 'Range, channel and frequency selectors in meters and generators.'),
  read: L('Khi đang mô phỏng: bấm vào một tiếp điểm để chọn, hoặc nhấn phím R để sang vị trí kế tiếp; chấm tô màu là vị trí đang chọn.', 'While the simulation runs: click a contact to select it, or press R to step to the next position; the filled dot marks the selected position.'),
};

const keypad: HelpEntry = {
  what: L('Bàn phím ma trận: mỗi phím nằm ở giao của một hàng (R1…) và một cột (C1…); nhấn phím là nối hàng đó với cột đó.', 'Matrix keypad: every key sits where a row (R1…) meets a column (C1…); pressing it joins that row to that column.'),
  use: L('Nhập số cho vi điều khiển, khoá số, máy tính bỏ túi — chỉ cần 7 hoặc 8 dây cho 12 hoặc 16 phím.', 'Number entry for microcontrollers, code locks, calculators — only 7 or 8 wires for 12 or 16 keys.'),
  read: L('Khi đang mô phỏng: bấm giữ chuột trên một phím, hoặc giữ đúng phím đó trên bàn phím máy tính (1…9, 0, *, #, A…D). Thả ra là phím nhả.', 'While the simulation runs: hold the mouse button on a key, or hold the same key on the computer keyboard (1…9, 0, *, #, A…D). Releasing lets the key go.'),
  tip: L('Quét bàn phím: đưa mức thấp lần lượt vào từng hàng, đọc các cột qua điện trở kéo lên.', 'Scanning: drive one row low at a time and read the columns through pull-up resistors.'),
};

export const BASIC_EXTRA_PART_HELP: Record<string, HelpEntry> = {
  'basic/nonideal-capacitor': {
    what: L('Tụ điện có ESR, ESL nối tiếp và điện trở rò song song — giống tụ thật.', 'A capacitor with ESR and ESL in series and a leakage resistance across it — like a real one.'),
    use: L('Chọn tụ thoát nguồn, hiểu vì sao cần đặt nhiều tụ nhỏ song song với tụ lớn.', 'Choosing decoupling capacitors; seeing why small capacitors go in parallel with big ones.'),
    read: L('Phân tích AC: trở kháng giảm như 1/(2πfC), chạm đáy bằng ESR tại f0 = 1/(2π√(ESL·C)) rồi tăng như 2πf·ESL. Với 100 nF và 2 nH, f0 ≈ 11 MHz.', 'AC analysis: the impedance falls like 1/(2πfC), bottoms out at the ESR at f0 = 1/(2π√(ESL·C)), then rises like 2πf·ESL. With 100 nF and 2 nH, f0 ≈ 11 MHz.'),
    tip: L('Muốn thấy rõ, quét AC từ 10 kHz đến 1 GHz, trục tần số log.', 'To see it clearly sweep AC from 10 kHz to 1 GHz on a log frequency axis.'),
  },
  'basic/nonideal-electrolytic': {
    what: L('Tụ hoá có ESR lớn, ESL và dòng rò điển hình.', 'An electrolytic capacitor with its typical large ESR, ESL and leakage current.'),
    use: L('Tính gợn sóng và nhiệt trên tụ lọc nguồn chỉnh lưu.', 'Ripple and heating in a rectifier filter capacitor.'),
    read: L('Ở tần số cao, tụ hoá không xuống dưới ESR (vài trăm mΩ): đặt thêm tụ gốm nhỏ song song để lọc nhiễu cao tần.', 'At high frequency an electrolytic never goes below its ESR (a few hundred mΩ): add a small ceramic in parallel for high-frequency noise.'),
  },
  'basic/nonideal-inductor': {
    what: L('Cuộn cảm có điện trở dây quấn và điện dung giữa các vòng dây (có thể thêm tổn hao lõi).', 'An inductor with its winding resistance and inter-turn capacitance (optionally core loss).'),
    use: L('Chọn cuộn chặn, cuộn lọc nguồn xung, hiểu giới hạn tần số của cuộn cảm.', 'Choosing chokes and switch-mode filter inductors; the frequency limit of an inductor.'),
    read: L('Trở kháng tăng như 2πfL tới đỉnh tại f0 = 1/(2π√(L·Cp)) (100 µH, 5 pF: ≈ 7.1 MHz), trên đó cuộn cảm hoạt động như tụ điện.', 'The impedance rises like 2πfL up to a peak at f0 = 1/(2π√(L·Cp)) (100 µH, 5 pF: ≈ 7.1 MHz); above it the inductor behaves like a capacitor.'),
  },
  'basic/nonideal-resistor': {
    what: L('Điện trở có điện cảm chân Ls nối tiếp và điện dung Cp song song.', 'A resistor with lead inductance Ls in series and capacitance Cp across it.'),
    use: L('Mạch cao tần, đầu dò, mạch xung nhanh: điện trở lớn bị Cp nối tắt, điện trở nhỏ bị Ls làm tăng trở kháng.', 'RF circuits, probes, fast pulses: Cp bypasses large resistances, Ls raises the impedance of small ones.'),
    read: L('Một điện trở 10 kΩ với Cp = 0.3 pF chỉ còn khoảng 530 Ω ở 1 GHz.', 'A 10 kΩ resistor with Cp = 0.3 pF reads only about 530 Ω at 1 GHz.'),
  },
  'basic/z-load-rx': {
    what: L('Tải phức Z = R + jX tại tần số f.', 'A complex load Z = R + jX at the frequency f.'),
    use: L('Bài tập mạch xoay chiều: tính dòng, công suất P, Q, hệ số công suất với tải cho bằng số phức.', 'AC circuit exercises: current, P, Q and power factor with a load given as a complex number.'),
    read: L('Nguồn xoay chiều đúng tần số f: dòng I = V/Z, công suất tác dụng P = I²·R, phản kháng Q = I²·X. Ví dụ 50 + j25 Ω ở 1 kHz là 50 Ω nối tiếp 3.98 mH.', 'With an AC source at f: current I = V/Z, real power P = I²·R, reactive power Q = I²·X. Example: 50 + j25 Ω at 1 kHz is 50 Ω in series with 3.98 mH.'),
  },
  'basic/z-load-polar': {
    what: L('Tải phức cho bằng độ lớn |Z| và góc pha φ tại tần số f.', 'A complex load given by its magnitude |Z| and phase φ at the frequency f.'),
    use: L('Nhập thẳng số liệu đo được của máy phân tích trở kháng hay của nhãn động cơ (|Z|, cos φ).', 'Enter impedance-analyser readings or motor nameplate data (|Z|, cos φ) directly.'),
    read: L('R = |Z|·cos φ, X = |Z|·sin φ. φ > 0: dòng chậm pha so với áp (tải cảm); φ < 0: dòng sớm pha (tải dung).', 'R = |Z|·cos φ, X = |Z|·sin φ. φ > 0: current lags the voltage (inductive); φ < 0: current leads (capacitive).'),
  },
  'basic/transformer-saturating': {
    what: L('Biến áp có lõi sắt bão hoà: khi từ thông vượt mức bão hoà, dòng từ hoá tăng vọt.', 'A transformer with a saturating iron core: when the flux exceeds saturation, the magnetising current shoots up.'),
    use: L('Thấy dòng xung kích khi đóng điện, biến áp bị quá áp hoặc chạy ở tần số thấp hơn định mức.', 'See the switch-on inrush current, an over-voltaged transformer or one run below its rated frequency.'),
    read: L('Ở điện áp định mức, dòng không tải bằng “dòng từ hoá định mức”; tăng áp 1.5 lần, đỉnh dòng tăng khoảng 5 lần (lõi thẳng chỉ tăng 1.5 lần). Đóng nguồn đúng lúc điện áp qua 0 (pha 0°) gây dòng xung kích; bắt đầu ở đỉnh (pha 90°) thì không.', 'At the rated voltage the no-load current equals the “rated magnetising current”; at 1.5× the voltage the peak current rises about 5× (a linear core: 1.5×). Switching on at a voltage zero (phase 0°) causes inrush; starting at the peak (phase 90°) does not.'),
    tip: L('Quan sát dòng sơ cấp bằng một điện trở nhỏ (0.1 Ω) nối tiếp và dao động ký.', 'Watch the primary current with a small (0.1 Ω) series resistor and the oscilloscope.'),
  },
  'basic/inductor-saturating': {
    what: L('Cuộn cảm có lõi bão hoà: điện cảm giảm mạnh khi dòng vượt dòng bão hoà Isat.', 'An inductor with a saturating core: its inductance collapses when the current exceeds Isat.'),
    use: L('Chọn cuộn cảm cho bộ nguồn xung: dòng đỉnh phải nhỏ hơn Isat, nếu không dòng tăng vọt.', 'Choosing switch-mode inductors: the peak current must stay below Isat, or the current runs away.'),
    read: L('Với dòng nhỏ, V = L·di/dt; tại Isat điện cảm vi phân chỉ còn L/10.', 'At small currents V = L·di/dt; at Isat the incremental inductance is only L/10.'),
  },
  'basic/coupled-inductors-3': {
    what: L('Ba cuộn cảm ghép từ, mỗi cặp có hệ số ghép riêng k12, k13, k23.', 'Three magnetically coupled inductors with a coupling factor per pair, k12, k13, k23.'),
    use: L('Biến áp ba cuộn có từ rò khác nhau, cuộn hồi tiếp của mạch dao động, bộ biến đổi flyback nhiều ngõ ra.', 'Three-winding transformers with different leakage, oscillator feedback windings, multi-output flyback converters.'),
    read: L('Hỗ cảm M12 = k12·√(L1·L2). Không phải bộ ba k nào cũng có thật: nếu k12 = k13 = 0.99 thì k23 cũng phải gần 1 — MachSim báo lỗi khi bộ số không thể có.', 'Mutual inductance M12 = k12·√(L1·L2). Not every set of k is physical: with k12 = k13 = 0.99, k23 must be close to 1 too — MachSim reports impossible sets.'),
  },
  'basic/no-connect': {
    what: L('Dấu “chân không nối” (chữ X) đặt lên một chân cố ý để hở.', 'The “no connect” mark (an X) put on a pin that is open on purpose.'),
    use: L('Cho người đọc sơ đồ (và ERC) biết chân hở là cố ý, không phải quên nối dây.', 'Tell the reader (and ERC) that the open pin is intentional, not a forgotten wire.'),
    read: L('Đặt dấu sao cho chân của nó trùng với chân cần đánh dấu. Cảnh báo “chân chưa nối” của chân đó biến mất.', 'Place the mark so its pin lands on the pin to mark. The “pin not connected” warning of that pin disappears.'),
  },
  'basic/earth-marker': {
    what: L('Ký hiệu nối đất bảo vệ (PE) của thiết bị dùng điện lưới.', 'The protective-earth (PE) symbol of mains equipment.'),
    use: L('Vẽ đúng sơ đồ an toàn điện: vỏ kim loại nối đất bảo vệ.', 'Draw safety wiring correctly: metal enclosures bonded to protective earth.'),
    read: L('Chỉ là ký hiệu: nó KHÔNG nối net vào đất 0 V của mô phỏng. Muốn điểm 0 V, dùng Đất (GND) trong nhóm Nguồn.', 'Only a symbol: it does NOT tie the net to the simulation’s 0 V ground. For 0 V use Ground (GND) from the Sources group.'),
  },
  'basic/chassis-marker': {
    what: L('Ký hiệu nối vào khung / vỏ kim loại của thiết bị.', 'The symbol for a connection to the metal chassis / frame.'),
    use: L('Đánh dấu chỗ bắt vít vỏ, dây bọc chống nhiễu nối vỏ.', 'Mark chassis screws and shields bonded to the frame.'),
    read: L('Chỉ là ký hiệu: không nối vào đất 0 V của mô phỏng.', 'Only a symbol: it does not join the simulation’s 0 V ground.'),
  },
  'basic/test-point': {
    what: L('Điểm đo: chỗ trên mạch để đặt que đo hoặc đầu dò.', 'Test point: a place on the board for a meter lead or probe.'),
    use: L('Đánh dấu các điểm cần đo khi kiểm tra / sửa chữa; có trong BOM như một chân đo thật.', 'Mark the points to measure during testing / repair; listed in the BOM as a real test pin.'),
    read: L('Không ảnh hưởng mạch. Để đo trong mô phỏng, đặt đầu dò hoặc đồng hồ vạn năng vào cùng net.', 'It does not change the circuit. To measure in the simulation put a probe or multimeter on the same net.'),
  },
  'analog/ota': BASIC_EXTRA_FAMILY_HELP['Transconductance amplifier'],
  'analog/cfoa': BASIC_EXTRA_FAMILY_HELP['Current-feedback amplifier'],
  'analog/pll': BASIC_EXTRA_FAMILY_HELP.PLL,
  'analog/isolation-amplifier': BASIC_EXTRA_FAMILY_HELP['Isolation amplifier'],
  'misc/gate-driver': BASIC_EXTRA_FAMILY_HELP['Gate driver'],
  'misc/half-bridge-driver': {
    what: L('Mạch lái cổng cho nửa cầu: một kênh phía thấp (LO, so với COM) và một kênh phía cao thả nổi (HO, so với VS).', 'Half-bridge gate driver: a low-side channel (LO, against COM) and a floating high-side channel (HO, against VS).'),
    use: L('Lái hai MOSFET của một nhánh nghịch lưu, bộ biến đổi buck đồng bộ, cầu H điều khiển động cơ.', 'Drive the two MOSFETs of an inverter leg, a synchronous buck converter, a motor H-bridge.'),
    read: L('HO cao = V(VB), thấp = V(VS). Tụ bootstrap từ VB tới VS (cùng một diode từ VCC tới VB) được nạp khi MOSFET phía thấp dẫn.', 'HO high = V(VB), low = V(VS). The bootstrap capacitor from VB to VS (with a diode from VCC to VB) charges while the low-side MOSFET is on.'),
    tip: L('Không bao giờ cho HIN và LIN cùng mức cao: hai MOSFET dẫn cùng lúc sẽ ngắn mạch nguồn.', 'Never drive HIN and LIN high together: both MOSFETs on at once short the supply.'),
  },
  'basic/transformer-1p2s': {
    what: L('Biến áp một sơ cấp, hai thứ cấp, mỗi thứ cấp có tỉ số vòng riêng.', 'A transformer with one primary and two secondaries, each with its own turns ratio.'),
    use: L('Nguồn cần hai điện áp (vd. ±12 V và 5 V), biến áp có cuộn phụ.', 'Supplies that need two voltages (e.g. ±12 V and 5 V), transformers with an auxiliary winding.'),
    read: L('Thứ cấp 1: V(S1,S2) = V(P1,P2) chia cho tỉ số Np:Ns1; thứ cấp 2: V(S3,S4) = V(P1,P2) chia cho Np:Ns2; các đầu có chấm cùng pha.', 'Secondary 1: V(S1,S2) = V(P1,P2) divided by Np:Ns1; secondary 2: V(S3,S4) = V(P1,P2) divided by Np:Ns2; the dotted ends are in phase.'),
  },
};
for (const n of [2, 3, 4, 5, 6, 8, 10]) BASIC_EXTRA_PART_HELP[`basic/dip-switch-${n}`] = dipSwitch;
for (const n of [3, 4, 6, 8, 12]) BASIC_EXTRA_PART_HELP[`basic/rotary-switch-${n}`] = rotary;
for (const k of ['4x3', '4x4']) BASIC_EXTRA_PART_HELP[`basic/keypad-${k}`] = keypad;
BASIC_EXTRA_PART_HELP['basic/transformer-1p3s'] = BASIC_EXTRA_PART_HELP['basic/transformer-1p2s'];
BASIC_EXTRA_PART_HELP['basic/transformer-2p2s'] = {
  what: L('Biến áp hai sơ cấp giống nhau và hai thứ cấp.', 'A transformer with two equal primaries and two secondaries.'),
  use: L('Nguồn dùng được cả lưới 115 V và 230 V: hai sơ cấp song song cho 115 V, nối tiếp cho 230 V.', 'Supplies for both 115 V and 230 V mains: primaries in parallel for 115 V, in series for 230 V.'),
  read: L('Nối P2 với P3 để hai sơ cấp nối tiếp (đúng chiều chấm); mỗi sơ cấp khi đó nhận một nửa điện áp lưới.', 'Join P2 to P3 for the series connection (dots in the same direction); each primary then gets half the mains voltage.'),
};
