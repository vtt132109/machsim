/**
 * "What is this?" pages of the families added by the generated part catalogue
 * (src/library/catalog), merged into FAMILY_HELP by help.ts. Original text written from general
 * circuit theory for MachSim learners.
 */
import { L } from './core';
import type { HelpEntry } from './help';
import { BASIC_EXTRA_FAMILY_HELP } from './basicExtrasHelp';
import { LADDER_FAMILY_HELP } from './ladderHelp';

export const CATALOG_FAMILY_HELP: Record<string, HelpEntry> = {
  ...BASIC_EXTRA_FAMILY_HELP,
  ...LADDER_FAMILY_HELP,
  Microcontroller: {
    what: L(
      'Vi điều khiển tương thích 8051 (MCS-51): một máy tính nhỏ trong một chip, có bộ xử lý 8 bit, 256 byte RAM, hai bộ định thời, cổng nối tiếp và bốn cổng vào / ra P0…P3. MachSim mô phỏng nó CÙNG với mạch: chương trình bạn viết thật sự điều khiển các chân, và các chân thật sự đọc điện áp trên sơ đồ.',
      'An 8051-compatible (MCS-51) microcontroller: a small computer in one chip with an 8-bit processor, 256 bytes of RAM, two timers, a serial port and four I/O ports P0…P3. MachSim co-simulates it WITH the circuit: the program you write really drives the pins, and the pins really read the voltages on the schematic.',
    ),
    use: L(
      'Nháy LED, đọc nút nhấn, đếm ra LED 7 đoạn, đo thời gian bằng bộ định thời, gửi chữ ra cửa sổ nối tiếp. Mở Trình soạn mã (nhấp đúp vào linh kiện) để viết chương trình, dịch và chạy từng lệnh.',
      'Blink an LED, read a push-button, count on a seven-segment display, time things with the timers, send text to the serial window. Open the code editor (double-click the part) to write the program, build it and step through it.',
    ),
    read: L(
      'Trình soạn mã hiện thanh ghi A, B, R0…R7, cờ của PSW, các thanh ghi đặc biệt, 16 byte RAM và mức của bốn cổng, cập nhật theo mô phỏng. Trên sơ đồ, đầu dò và LED cho thấy chương trình đang làm gì.',
      'The code editor shows A, B, R0…R7, the PSW flags, the special registers, 16 bytes of RAM and the levels of the four ports, following the simulation. On the schematic, probes and LEDs show what the program is doing.',
    ),
    tip: L(
      'Chân 8051 hút dòng tốt nhưng đẩy dòng rất kém: nối LED từ nguồn +5 V qua điện trở xuống chân, rồi cho chân xuống 0 để LED sáng. Nếu muốn thí nghiệm nhanh, đổi tham số “Kiểu ngõ ra của cổng” sang Kéo-đẩy.',
      'An 8051 pin sinks current well but sources very little: wire the LED from +5 V through a resistor to the pin and pull the pin low to light it. For a quick experiment, set the “Port drive” parameter to Push-pull.',
    ),
  },
  'Rated components': {
    what: L('Linh kiện có định mức công suất, điện áp hoặc dòng điện. Khi mô phỏng mà vượt định mức, linh kiện bị “cháy” và hở mạch.', 'Parts with a power, voltage or current rating. When a simulation exceeds the rating the part “burns out” and opens.'),
    use: L('Tập chọn linh kiện đúng cỡ: điện trở đủ công suất, tụ đủ điện áp, LED có điện trở hạn dòng.', 'Practise choosing parts of the right size: resistors with enough power, capacitors with enough voltage, LEDs with a current-limiting resistor.'),
    read: L('Linh kiện cháy được đánh dấu đỏ trên sơ đồ; mục Thông báo cho biết đại lượng nào vượt định mức và vượt bao nhiêu.', 'A burnt part is marked red on the schematic; the messages say which quantity exceeded its rating and by how much.'),
    tip: L('Mọi điện trở, tụ và cuộn cảm theo giá trị chuẩn cũng có ô “Cháy khi quá tải” ở thẻ Nâng cao.', 'Every standard-value resistor, capacitor and inductor also has a “Burn out when overloaded” box on the Advanced tab.'),
  },
  'TVS diode': {
    what: L('Diode triệt xung điện áp: bình thường không dẫn, khi điện áp vượt VBR thì dẫn mạnh và kẹp điện áp quanh VC.', 'Transient-voltage suppressor: it does not conduct normally, and clamps the voltage near VC when it rises above VBR.'),
    use: L('Bảo vệ đường nguồn và cổng tín hiệu khỏi xung sét, tĩnh điện, xung cảm ứng.', 'Protect supply rails and signal ports against surges, ESD and inductive spikes.'),
    tip: L('Chọn VWM (điện áp làm việc) lớn hơn điện áp bình thường của mạch; loại CA dùng cho tín hiệu hai chiều.', 'Choose VWM (stand-off voltage) above the normal circuit voltage; CA types are for bipolar signals.'),
  },
  'PIN diode': {
    what: L('Diode có lớp bán dẫn thuần ở giữa: ở cao tần nó như một điện trở thay đổi theo dòng phân cực.', 'A diode with an intrinsic middle layer: at RF it behaves like a resistor set by the bias current.'),
    use: L('Công tắc cao tần, bộ suy giảm điều khiển bằng dòng, bảo vệ máy thu.', 'RF switches, current-controlled attenuators, receiver protection.'),
  },
  'RF transistor': {
    what: L('Transistor có tần số cắt fT rất cao (hàng GHz) và điện dung nhỏ, dùng cho mạch cao tần.', 'Transistors with a very high transition frequency fT (GHz) and small capacitances, for RF circuits.'),
    use: L('Khuếch đại cao tần, dao động, trộn tần; loại MOSFET hai cổng cho mạch điều khiển hệ số khuếch đại.', 'RF amplifiers, oscillators and mixers; dual-gate MOSFETs for gain-controlled stages.'),
    tip: L('Ở cao tần, cách đi dây và điện dung ký sinh quan trọng như chính transistor.', 'At RF, wiring and stray capacitance matter as much as the transistor itself.'),
  },
  'Transistor array': {
    what: L('Nhiều transistor Darlington trong một IC, mỗi kênh có diode dập xung về chân COM.', 'Several Darlington transistors in one IC, each channel with a clamp diode to COM.'),
    use: L('Lái rơ-le, động cơ bước, đèn từ ngõ ra vi điều khiển 5 V.', 'Drive relays, stepper motors and lamps from 5 V microcontroller outputs.'),
    tip: L('Nối COM vào nguồn của tải cảm (rơ-le) để diode dập điện áp khi tắt.', 'Connect COM to the supply of inductive loads (relays) so the diodes clamp the turn-off spike.'),
  },
  IGBT: {
    what: L('Transistor lưỡng cực cổng cách ly: điều khiển bằng điện áp như MOSFET, dẫn dòng lớn như BJT.', 'Insulated-gate bipolar transistor: voltage-driven like a MOSFET, carries large currents like a BJT.'),
    use: L('Biến tần, bộ nghịch lưu, bếp từ, hàn điện ở điện áp vài trăm vôn trở lên.', 'Motor drives, inverters, induction cookers and welders at hundreds of volts and above.'),
    tip: L('Cần điện áp cổng khoảng 15 V để bão hoà hoàn toàn.', 'It needs about 15 V gate drive to saturate fully.'),
  },
  'UJT / PUT': {
    what: L('Transistor một tiếp giáp (UJT) và loại lập trình được (PUT): đột ngột dẫn khi điện áp cực phát vượt một ngưỡng.', 'Unijunction (UJT) and programmable unijunction (PUT) transistors: they switch on abruptly when the emitter voltage passes a threshold.'),
    use: L('Mạch dao động tích thoát RC, tạo xung kích thyristor.', 'RC relaxation oscillators and thyristor trigger pulses.'),
    read: L('Với UJT, ngưỡng kích ≈ η·VBB + 0.6 V; với PUT, ngưỡng do điện áp cực G đặt bằng cầu phân áp.', 'For a UJT the firing point is ≈ η·VBB + 0.6 V; for a PUT it is set by the gate voltage from a divider.'),
  },
  GaAsFET: {
    what: L('Transistor trường bằng gali asenua (MESFET): rất nhanh, nhiễu thấp ở tần số vi ba.', 'Gallium-arsenide field-effect transistor (MESFET): very fast and low-noise at microwave frequencies.'),
    use: L('Khuếch đại nhiễu thấp (LNA) cho vệ tinh, ra-đa, thông tin vô tuyến.', 'Low-noise amplifiers (LNA) for satellite, radar and wireless links.'),
  },
  TRIAC: {
    what: L('Thyristor hai chiều: một xung dòng vào cực cổng làm nó dẫn ở cả hai nửa chu kỳ điện xoay chiều.', 'Bidirectional thyristor: a gate current pulse turns it on in either half cycle of an AC supply.'),
    use: L('Điều chỉnh độ sáng đèn, tốc độ quạt, đóng cắt tải xoay chiều.', 'Lamp dimmers, fan speed control and AC load switching.'),
    tip: L('TRIAC tự tắt khi dòng qua nó về gần 0 ở cuối mỗi nửa chu kỳ.', 'A TRIAC turns off by itself when its current falls to nearly zero at the end of each half cycle.'),
  },
  DIAC: {
    what: L('Diode kích hai chiều: không dẫn cho đến khi |V| đạt khoảng 30 V, rồi dẫn và điện áp giảm vài vôn.', 'Bidirectional trigger diode: blocks until |V| reaches about 30 V, then conducts and its voltage drops by a few volts.'),
    use: L('Tạo xung kích cho TRIAC trong mạch điều chỉnh độ sáng.', 'Produce the trigger pulse for a TRIAC in dimmer circuits.'),
  },
  'Shockley diode': {
    what: L('Diode bốn lớp: chặn cho đến điện áp đánh thủng, rồi tự giữ dẫn cho tới khi dòng nhỏ hơn dòng duy trì. SIDAC là loại cao áp.', 'Four-layer diode: blocks up to its breakover voltage, then latches on until the current falls below the holding current. SIDACs are high-voltage versions.'),
    use: L('Mạch tạo xung, mồi đèn cao áp, bảo vệ quá áp kiểu “ngắn mạch”.', 'Pulse generators, lamp igniters, crowbar over-voltage protection.'),
  },
  GTO: {
    what: L('Thyristor tắt được bằng cực cổng: xung dương để mở, dòng cổng âm đủ lớn để tắt.', 'Gate turn-off thyristor: a positive pulse turns it on, a large enough negative gate current turns it off.'),
    use: L('Bộ nghịch lưu công suất lớn (kéo tàu điện, truyền tải).', 'High-power inverters (traction, transmission).'),
  },
  'Switching regulator': {
    what: L('IC ổn áp xung giảm áp: đóng cắt nhanh rồi lọc bằng cuộn cảm và tụ, hiệu suất cao hơn ổn áp tuyến tính.', 'Step-down switching regulator IC: switches quickly and filters with an inductor and capacitor, more efficient than a linear regulator.'),
    use: L('Hạ 12–24 V xuống 5 V hoặc 3.3 V cho dòng lớn mà không toả nhiều nhiệt.', 'Convert 12–24 V down to 5 V or 3.3 V at high current without much heat.'),
    read: L('Mô hình trung bình: thấy giá trị trung bình của điện áp và dòng (không thấy gợn sóng đóng cắt), mô phỏng nhanh.', 'Averaged model: you see average voltages and currents (no switching ripple), so it simulates fast.'),
    tip: L('Vẽ đủ mạch như datasheet: cuộn cảm từ SW ra ngõ ra, diode Schottky từ GND lên SW, tụ ngõ ra và nối FB.', 'Draw the datasheet circuit: inductor from SW to the output, Schottky diode from GND to SW, output capacitor and the FB connection.'),
  },
  'Averaged converter': {
    what: L('Bộ biến đổi DC-DC (giảm áp, tăng áp, tăng-giảm áp, Ćuk) dùng mô hình khoá PWM trung bình.', 'DC-DC converters (buck, boost, buck-boost, Ćuk) built on the averaged PWM-switch model.'),
    use: L('Hiểu quan hệ điện áp ra theo hệ số làm việc D và thiết kế vòng điều khiển.', 'Understand how the output voltage depends on the duty cycle D and design control loops.'),
    read: L('Giảm áp: VOUT ≈ D·VIN; tăng áp: VOUT ≈ VIN/(1 − D); tăng-giảm áp và Ćuk: VOUT ≈ −VIN·D/(1 − D).', 'Buck: VOUT ≈ D·VIN; boost: VOUT ≈ VIN/(1 − D); buck-boost and Ćuk: VOUT ≈ −VIN·D/(1 − D).'),
    tip: L('Nối chân D vào một nguồn 0…1 V hoặc bộ điều khiển PI để thay đổi hệ số làm việc khi mô phỏng.', 'Connect the D pin to a 0…1 V source or a PI controller to change the duty cycle during simulation.'),
  },
  Controllers: {
    what: L('Khối điều khiển cho điện tử công suất: bộ tạo PWM và bộ điều khiển góc kích cho thyristor / TRIAC.', 'Control blocks for power electronics: a PWM generator and a firing-angle controller for thyristors / TRIACs.'),
    use: L('Điều khiển tốc độ động cơ, độ sáng đèn, nguồn xung tự thiết kế.', 'Motor speed control, lamp dimming, home-made switching supplies.'),
    read: L('Bộ điều khiển góc pha: VC = 0 V → α = 180° (tắt), VC = 10 V → α ≈ 5° (gần như dẫn hoàn toàn).', 'Phase-angle controller: VC = 0 V → α = 180° (off), VC = 10 V → α ≈ 5° (almost full conduction).'),
  },
  Contactor: {
    what: L('Rơ-le công suất lớn ba cực dùng để đóng cắt động cơ và tải ba pha, có thêm tiếp điểm phụ.', 'A heavy-duty three-pole relay that switches motors and three-phase loads, with an auxiliary contact.'),
    use: L('Mạch khởi động động cơ (nút Start/Stop với tiếp điểm duy trì 13-14).', 'Motor starter circuits (Start/Stop buttons with the 13-14 holding contact).'),
    tip: L('Cuộn hút AC dùng được với nguồn xoay chiều; mô hình lấy trung bình dòng nên không bị rung tiếp điểm.', 'AC coils work from an AC supply; the model averages the coil current so the contacts do not chatter.'),
  },
  'Timed contact': {
    what: L('Rơ-le thời gian: tiếp điểm chuyển trạng thái sau một khoảng trễ kể từ khi cấp hoặc ngắt điện cuộn hút.', 'Timer relays: the contact changes over a set delay after the coil is energised or released.'),
    use: L('Khởi động sao-tam giác, quạt chạy thêm sau khi tắt, báo động trễ.', 'Star-delta starters, fan run-on after switch-off, delayed alarms.'),
    read: L('Trễ đóng: chờ rồi đóng; trễ mở: đóng ngay, mở sau khi mất điện; khoảng: đóng ngay rồi tự mở sau thời gian đặt.', 'On-delay: waits, then operates; off-delay: operates at once, releases after the coil drops out; interval: operates at once and releases after the set time.'),
  },
  'Sensing switch': {
    what: L('Công tắc tác động theo một đại lượng vật lý: áp suất, nhiệt độ, mức chất lỏng, lưu lượng hoặc vị trí.', 'Switches operated by a physical quantity: pressure, temperature, liquid level, flow or position.'),
    use: L('Mạch điều khiển bơm nước, máy nén, lò sưởi, cửa tự động.', 'Control circuits for pumps, compressors, heaters and automatic doors.'),
    tip: L('Khi mô phỏng, dùng phím tắt hiện trên linh kiện để tăng / giảm đại lượng và xem tiếp điểm đổi trạng thái.', 'During simulation use the part’s key to raise / lower the quantity and watch the contact change over.'),
  },
  Protection: {
    what: L('Áp-tô-mát (MCB): tự cắt khi quá tải kéo dài (cắt nhiệt) hoặc ngắn mạch (cắt từ), bật lại được bằng tay.', 'Miniature circuit breakers (MCB): trip on a sustained overload (thermal) or a short circuit (magnetic), and can be switched back on.'),
    use: L('Bảo vệ dây dẫn và thiết bị trong mạch điện dân dụng và công nghiệp.', 'Protect wiring and equipment in domestic and industrial installations.'),
    read: L('Đường cong B cắt từ ở khoảng 3–5 lần dòng định mức, C ở 5–10 lần, D ở 10–20 lần.', 'Curve B trips magnetically at about 3–5 times the rated current, C at 5–10 times, D at 10–20 times.'),
  },
  'Temperature sensor': {
    what: L('Cảm biến biến nhiệt độ thành điện trở (RTD), điện áp nhỏ (cặp nhiệt điện) hoặc điện áp tỉ lệ (IC cảm biến).', 'Sensors that turn temperature into a resistance (RTD), a small voltage (thermocouple) or a proportional voltage (IC sensors).'),
    use: L('Đo và điều khiển nhiệt độ lò, tủ lạnh, máy ấp trứng, động cơ.', 'Measure and control the temperature of ovens, fridges, incubators and motors.'),
    tip: L('Khi mô phỏng, dùng phím T để thay đổi nhiệt độ và xem ngõ ra thay đổi.', 'During simulation press T to change the temperature and watch the output follow.'),
  },
  'Magnetic sensor': {
    what: L('Cảm biến Hall và công tắc lưỡi gà phản ứng với từ trường của nam châm hoặc dòng điện.', 'Hall-effect sensors and reed switches respond to the field of a magnet or a current.'),
    use: L('Đo tốc độ quay, phát hiện cửa đóng/mở, đo dòng không tiếp xúc.', 'Measure rotation speed, detect open / closed doors, contactless current sensing.'),
  },
  'Pressure sensor': {
    what: L('Cảm biến áp suất kiểu cầu điện trở (tín hiệu nhỏ, cần khuếch đại) hoặc loại đã khuếch đại sẵn ra 0.5–4.5 V.', 'Pressure sensors as a resistive bridge (small signal, needs an amplifier) or with a built-in amplifier giving 0.5–4.5 V.'),
    use: L('Đo áp suất khí, chất lỏng, độ cao, cân điện tử.', 'Measure gas or liquid pressure, altitude, weight.'),
    tip: L('Dùng khuếch đại đo lường (ví dụ INA128) cho cảm biến kiểu cầu.', 'Use an instrumentation amplifier (e.g. INA128) with bridge sensors.'),
  },
  'Light sensor': {
    what: L('Phototransistor và cảm biến ánh sáng môi trường cho dòng điện tỉ lệ với độ rọi (lux).', 'Phototransistors and ambient light sensors give a current proportional to the illuminance (lux).'),
    use: L('Đèn tự bật khi trời tối, đo ánh sáng, đếm vật cản tia sáng.', 'Night lights, light meters, beam-break counters.'),
  },
  'Position sensor': {
    what: L('Cảm biến vị trí và tốc độ: thanh trượt chiết áp, biến áp vi sai LVDT và encoder tăng dần.', 'Position and speed sensors: potentiometric slider, LVDT differential transformer and incremental encoder.'),
    use: L('Đo dịch chuyển thẳng, góc quay và tốc độ trong máy móc, robot.', 'Measure linear displacement, angle and speed in machines and robots.'),
    read: L('Encoder: tần số ngõ ra = vòng/giây × số xung mỗi vòng; B trễ A 90° khi quay thuận.', 'Encoder: output frequency = revolutions per second × pulses per revolution; B lags A by 90° in the forward direction.'),
  },
  'Vacuum tube': {
    what: L('Đèn điện tử chân không ba cực và năm cực: dòng anốt được điều khiển bằng điện áp lưới.', 'Triode and pentode vacuum tubes: the plate current is controlled by the grid voltage.'),
    use: L('Ampli âm thanh, ampli đàn guitar, học lịch sử điện tử.', 'Audio and guitar amplifiers, and the history of electronics.'),
    tip: L('Đèn cần điện áp anốt cao (100–400 V); hãy cẩn thận với điện áp thật khi làm mạch ngoài đời.', 'Tubes need high plate voltages (100–400 V); take real high voltage seriously when you build circuits.'),
  },
  'RF inductor': {
    what: L('Cuộn cảm cao tần có tổn hao và tần số tự cộng hưởng, cùng cuộn cảm xoắn phẳng trên mạch in / vi mạch.', 'RF inductors with losses and self-resonance, and planar spiral inductors on a PCB or chip.'),
    use: L('Mạch lọc, mạch cộng hưởng LC, phối hợp trở kháng ở tần số cao.', 'Filters, LC tanks and impedance matching at high frequency.'),
    tip: L('Trên tần số tự cộng hưởng, cuộn cảm hoạt động như tụ điện.', 'Above its self-resonant frequency an inductor behaves like a capacitor.'),
  },
  'RF capacitor': {
    what: L('Tụ cao tần có ESR và ESL, cùng tụ răng lược phẳng trên đế vi ba.', 'RF capacitors with ESR and ESL, and planar interdigital capacitors on microwave substrates.'),
    use: L('Ghép tín hiệu, thoát cao tần, mạch cộng hưởng.', 'Coupling, RF bypassing and resonant circuits.'),
  },
  'Ferrite bead': {
    what: L('Hạt ferrite: gần như dây dẫn ở DC nhưng có trở kháng tổn hao lớn ở tần số cao.', 'Ferrite bead: almost a wire at DC but a lossy high impedance at radio frequencies.'),
    use: L('Chặn nhiễu cao tần trên đường nguồn và dây tín hiệu.', 'Block RF noise on supply rails and signal lines.'),
  },
  'Socket header': {
    what: L('Hàng chân cắm cái bước 2.54 mm để cắm module hoặc dây.', 'Female 2.54 mm socket headers for plugging modules or jumper wires.'),
    use: L('Gắn module, màn hình, cảm biến tháo lắp được lên mạch.', 'Mount removable modules, displays and sensors on a board.'),
  },
  'Wire-to-board': {
    what: L('Đầu nối dây với mạch in có khoá chiều để không cắm ngược.', 'Polarised wire-to-board connectors that cannot be plugged in backwards.'),
    use: L('Nối pin, quạt, cảm biến, loa với mạch.', 'Connect batteries, fans, sensors and speakers to a board.'),
  },
  'USB connector': {
    what: L('Đầu nối USB các loại (A, B, Mini, Micro, Type-C) với chân nguồn VBUS và cặp dữ liệu D+/D−.', 'USB connectors (A, B, Mini, Micro, Type-C) with the VBUS supply pin and the D+/D− data pair.'),
    use: L('Cấp nguồn 5 V và giao tiếp máy tính cho mạch.', 'Supply 5 V and a computer connection to a board.'),
  },
  'Power connector': {
    what: L('Giắc nguồn DC, cọc cắm chuối, điểm đo và jumper.', 'DC barrel jacks, banana jacks, test points and jumpers.'),
    use: L('Đưa nguồn vào mạch, móc que đo, chọn cấu hình bằng jumper.', 'Bring power in, clip on probes, select options with jumpers.'),
  },
  'Audio/video connector': {
    what: L('Giắc âm thanh 3.5 / 6.35 mm và giắc RCA.', 'Audio jacks (3.5 / 6.35 mm) and RCA jacks.'),
    use: L('Nối tai nghe, micro, nhạc cụ, đầu phát vào mạch âm thanh.', 'Connect headphones, microphones, instruments and players to audio circuits.'),
  },
  'RF connector': {
    what: L('Đầu nối đồng trục BNC và SMA trở kháng 50 Ω.', '50 Ω coaxial BNC and SMA connectors.'),
    use: L('Nối máy đo, ăng-ten và cáp đồng trục.', 'Connect instruments, antennas and coaxial cables.'),
  },
  'D-sub connector': {
    what: L('Đầu nối hình chữ D nhiều chân (9, 15, 25 chân).', 'Multi-pin D-shaped connectors (9, 15, 25 pins).'),
    use: L('Cổng nối tiếp RS-232, VGA, máy công nghiệp.', 'RS-232 serial ports, VGA, industrial equipment.'),
  },
  'Modular jack': {
    what: L('Ổ cắm mô-đun RJ45 (mạng Ethernet), RJ11 / RJ12 (điện thoại).', 'Modular jacks: RJ45 (Ethernet), RJ11 / RJ12 (telephone).'),
    use: L('Nối mạng máy tính, điện thoại, bus công nghiệp.', 'Network, telephone and industrial bus connections.'),
  },

  // ---------------------------------------------------------------- 74xx families and 4000 series (digital round)
  '74STD': {
    what: L('Họ TTL chuẩn đầu tiên (7400, 7404 …): mỗi cổng trễ khoảng 10 ns, ngõ ra hút 16 mA, đầu vào để hở đọc là mức cao.', 'The original standard TTL family (7400, 7404 …): about 10 ns per gate, outputs sink 16 mA, an open input reads high.'),
    use: L('Các mạch số cổ điển trong giáo trình; ngày nay thường thay bằng 74LS hoặc 74HCT.', 'Classic textbook digital circuits; today usually replaced by 74LS or 74HCT.'),
    read: L('Mức ra cao khoảng 3,4 V, thấp khoảng 0,2 V; ngưỡng vào khoảng 1,4 V.', 'The high output is about 3.4 V, the low about 0.2 V; the input threshold is about 1.4 V.'),
    tip: L('Chân nguồn VCC / GND được ẩn: đặt ký hiệu VCC lên sơ đồ để IC lấy nguồn thật.', 'The VCC / GND pins are hidden: place a VCC symbol on the schematic so the IC uses a real supply.'),
  },
  '74LS': {
    what: L('TTL Schottky công suất thấp: họ 74 phổ biến nhất trong phòng thí nghiệm, trễ khoảng 10 ns, ngõ ra hút 8 mA.', 'Low-power Schottky TTL: the most common 74 family in teaching labs, about 10 ns delay, outputs sink 8 mA.'),
    use: L('Làm bài thí nghiệm số: cổng logic, flip-flop, bộ đếm, giải mã LED 7 đoạn.', 'Digital lab exercises: gates, flip-flops, counters, 7-segment decoders.'),
    read: L('Đầu vào để hở đọc là mức cao (giống thực tế); mỗi đầu vào mức thấp lấy ra khoảng 0,4 mA.', 'An open input reads high (as on the bench); each low input sources about 0.4 mA.'),
    tip: L('Một ngõ ra LS lái được khoảng 20 đầu vào LS (fan-out).', 'One LS output can drive about 20 LS inputs (fan-out).'),
  },
  '74S': {
    what: L('TTL Schottky: nhanh (khoảng 3 ns mỗi cổng) nhưng tốn điện hơn LS.', 'Schottky TTL: fast (about 3 ns per gate) but more power-hungry than LS.'),
    use: L('Mạch cần tốc độ cao trong thiết kế TTL cũ.', 'High-speed paths in older TTL designs.'),
    read: L('Trễ ngắn nên khi xem dạng sóng cần bước thời gian nhỏ (vài ns).', 'The delays are short: use a small time step (a few ns) to see them in waveforms.'),
  },
  '74F': {
    what: L('TTL FAST: nhanh như 74S (khoảng 3,5 ns) với công suất thấp hơn.', 'FAST TTL: about as fast as 74S (around 3.5 ns) with less power.'),
    use: L('Bus và đường dữ liệu tốc độ cao trong máy tính đời trước.', 'High-speed buses and data paths in older computers.'),
  },
  '74ALS': {
    what: L('TTL Schottky công suất thấp cải tiến: nhanh gấp đôi LS (khoảng 5 ns), dòng vào rất nhỏ.', 'Advanced low-power Schottky TTL: twice as fast as LS (about 5 ns), very small input current.'),
    use: L('Thay thế LS khi cần nhanh hơn mà không tốn điện.', 'A faster drop-in for LS without extra power.'),
  },
  '74AS': {
    what: L('TTL Schottky cải tiến: họ TTL nhanh nhất (khoảng 1,7 ns mỗi cổng).', 'Advanced Schottky TTL: the fastest TTL family (about 1.7 ns per gate).'),
    use: L('Đường tín hiệu đòi hỏi trễ nhỏ nhất trong hệ TTL.', 'The most time-critical paths of TTL systems.'),
  },
  '74HC': {
    what: L('CMOS tốc độ cao: chạy được từ 2 V đến 6 V, ngưỡng vào bằng nửa nguồn, gần như không tốn dòng khi đứng yên.', 'High-speed CMOS: runs from 2 V to 6 V, the input threshold is half the supply, almost no current at rest.'),
    use: L('Họ logic phổ biến nhất hiện nay cho mạch 5 V và 3,3 V, vi điều khiển, LED, thanh ghi dịch 74HC595.', 'The most common logic family today for 5 V and 3.3 V circuits, microcontroller projects, LEDs, the 74HC595 shift register.'),
    read: L('Ngõ ra lên sát nguồn (0 V / 5 V); đầu vào CMOS không được để hở.', 'Outputs swing rail to rail (0 V / 5 V); CMOS inputs must not be left open.'),
    tip: L('Ở chế độ mô phỏng thực tế, nếu nguồn VCC là 3,3 V thì ngõ ra và ngưỡng vào cũng theo 3,3 V.', 'In real mode with a 3.3 V VCC net the outputs and input thresholds follow 3.3 V.'),
  },
  '74HCT': {
    what: L('CMOS tốc độ cao có ngưỡng vào kiểu TTL (1,4 V): thay trực tiếp cho IC 74LS mà vẫn tiết kiệm điện.', 'High-speed CMOS with TTL input thresholds (1.4 V): a low-power drop-in for 74LS ICs.'),
    use: L('Ghép mạch TTL (mức cao 3,4 V) với mạch CMOS 5 V.', 'Interfacing TTL outputs (3.4 V highs) with 5 V CMOS logic.'),
  },
  '74AC': {
    what: L('CMOS cải tiến: nhanh (khoảng 5 ns) và ngõ ra mạnh 24 mA.', 'Advanced CMOS: fast (about 5 ns) with strong 24 mA outputs.'),
    use: L('Lái bus và đường dây dài, mạch tốc độ cao dùng CMOS.', 'Driving buses and long lines, high-speed CMOS circuits.'),
    tip: L('Sườn xung rất dốc: dây dài có thể gây dội (ringing) trong mạch thật.', 'Edges are very fast: long wires can ring in a real circuit.'),
  },
  '74ACT': {
    what: L('CMOS cải tiến có ngưỡng vào kiểu TTL: nhanh, ngõ ra 24 mA, nhận mức TTL.', 'Advanced CMOS with TTL input thresholds: fast, 24 mA outputs, accepts TTL levels.'),
    use: L('Đệm và lái bus nhận tín hiệu từ IC TTL.', 'Bus buffers and drivers fed from TTL ICs.'),
  },
  Memory: {
    what: L('Bộ nhớ bán dẫn: RAM (đọc và ghi được), ROM / EPROM (chỉ đọc), EEPROM (ghi được bằng xung ~WE). Mỗi địa chỉ chứa một từ nhiều bit.', 'Semiconductor memories: RAM (read and write), ROM / EPROM (read only), EEPROM (written with a ~WE pulse). Each address holds a multi-bit word.'),
    use: L('Bảng tra (font LED 7 đoạn, sóng sin), bộ nhớ chương trình / dữ liệu của máy tính, bộ tạo dãy xung.', 'Lookup tables (7-segment font, sine table), program / data memory of computers, sequence generators.'),
    read: L('Chọn chip bằng ~CS (~CE), đặt địa chỉ, rồi ~OE thấp để đọc; ~WE thấp để ghi. Khi không đọc, chân dữ liệu thả nổi (ba trạng thái).', 'Select the chip with ~CS (~CE), set the address, then pull ~OE low to read; ~WE low writes. When not reading, the data pins float (3-state).'),
    tip: L('Bấm “Sửa nội dung…” trong bảng Thuộc tính để nhập dữ liệu dạng hex hoặc nạp file Intel HEX.', 'Click “Edit contents…” in the Properties panel to type hex data or load an Intel HEX file.'),
  },
  PLD: {
    what: L('Khối logic lập trình được: bạn tự viết hàm logic cho các ngõ ra bằng phương trình Boole hoặc bảng sự thật, có thể có thanh ghi theo xung nhịp.', 'Programmable logic block: you write the logic of each output as Boolean equations or a truth table, optionally registered on a clock.'),
    use: L('Thay nhiều cổng rời bằng một khối; thử nhanh hàm logic, máy trạng thái, bộ đếm tuỳ ý.', 'Replace many separate gates with one block; quickly try logic functions, state machines, custom counters.'),
    read: L('Ví dụ: O0 = I0 & I1 | !I2 (tổ hợp), O1 := O1 ^ I0 (đổi ở sườn lên CLK). Phép toán: ! NOT, & AND, ^ XOR, | OR.', 'Example: O0 = I0 & I1 | !I2 (combinational), O1 := O1 ^ I0 (changes on the rising CLK edge). Operators: ! NOT, & AND, ^ XOR, | OR.'),
    tip: L('Viết sai cú pháp thì ERC báo đúng dòng bị lỗi.', 'A syntax mistake is reported by the ERC with the line number.'),
  },
  'Line driver': {
    what: L('IC chuyển mức logic TTL / CMOS sang mức của đường truyền (RS-232 ±9 V, RS-422 vi sai) để đi xa.', 'ICs that convert TTL / CMOS logic levels to line levels (RS-232 ±9 V, RS-422 differential) for long distances.'),
    use: L('Cổng nối tiếp máy tính, truyền dữ liệu công nghiệp.', 'Computer serial ports, industrial data links.'),
    tip: L('RS-232 đảo mức: logic 1 là điện áp âm trên dây.', 'RS-232 inverts: a logic 1 is a negative voltage on the line.'),
  },
  'Line receiver': {
    what: L('IC nhận tín hiệu đường truyền (RS-232, RS-422) và đưa ra lại mức logic, thường có trễ (Schmitt) để chống nhiễu.', 'ICs that receive line signals (RS-232, RS-422) and restore logic levels, usually with hysteresis against noise.'),
    use: L('Đầu thu của cổng nối tiếp, bus vi sai.', 'The receiving end of serial ports and differential buses.'),
  },
  'Line transceiver': {
    what: L('IC vừa lái vừa thu đường truyền: MAX232 (RS-232 từ nguồn 5 V), SN75176 (RS-485 / RS-422 hai chiều).', 'ICs that both drive and receive a line: MAX232 (RS-232 from a 5 V supply), SN75176 (bidirectional RS-485 / RS-422).'),
    use: L('Nối vi điều khiển với máy tính (MAX232) hoặc mạng nhiều thiết bị RS-485 (Modbus).', 'Connecting a microcontroller to a PC (MAX232) or to a multi-drop RS-485 network (Modbus).'),
    read: L('RS-485: điện áp A − B dương là 1, âm là 0; chân DE bật bộ lái, ~RE bật bộ thu.', 'RS-485: a positive A − B voltage is a 1, negative a 0; DE enables the driver, ~RE the receiver.'),
  },
  'Serial converters': {
    what: L('ADC / DAC giao tiếp nối tiếp kiểu SPI: dữ liệu đi từng bit theo xung SCLK, chọn chip bằng ~CS.', 'SPI-style serial ADCs / DACs: data move one bit per SCLK edge, the chip is selected with ~CS.'),
    use: L('Nối cảm biến và đầu ra tương tự với vi điều khiển chỉ bằng vài dây.', 'Connect analog sensors and outputs to a microcontroller with only a few wires.'),
    read: L('ADC: hạ ~CS để lấy mẫu, rồi đọc bit cao trước ở mỗi sườn lên SCLK. DAC: dịch dữ liệu vào ở sườn lên SCLK, nâng ~CS để cập nhật ngõ ra.', 'ADC: pull ~CS low to sample, then read the MSB first on each rising SCLK edge. DAC: shift data in on rising SCLK edges, raise ~CS to update the output.'),
  },
  'Analog switches': {
    what: L('Công tắc điện tử cho tín hiệu tương tự, đóng / mở bằng một mức logic; khi đóng có điện trở nhỏ RON.', 'Electronic switches for analog signals, opened / closed by a logic level; a closed switch has a small resistance RON.'),
    use: L('Chọn kênh tín hiệu, đổi hệ số khuếch đại, mạch lấy mẫu - giữ.', 'Selecting signal channels, switching gains, sample-and-hold circuits.'),
    tip: L('Họ 4051 / 4052 / 4053 / 4067 là bộ dồn kênh tương tự nhiều kênh trong nhóm CMOS.', 'The 4051 / 4052 / 4053 / 4067 in the CMOS group are multi-channel analog multiplexers.'),
  },
  Oscillators: {
    what: L('Bộ dao động điều khiển bằng điện áp (VCO): tần số xung vuông ra thay đổi theo điện áp vào.', 'Voltage-controlled oscillator (VCO): the frequency of its square-wave output follows the input voltage.'),
    use: L('Điều tần (FM), vòng khoá pha (PLL), bộ chuyển áp sang tần số.', 'Frequency modulation (FM), phase-locked loops (PLL), voltage-to-frequency converters.'),
    read: L('f = f0 + kv · VIN; đo bằng máy đếm tần hoặc dao động ký.', 'f = f0 + kv · VIN; measure it with the frequency counter or the oscilloscope.'),
  },
  'Character LCD': {
    what: L('Màn hình tinh thể lỏng hiển thị chữ (16 x 2, 20 x 4 …) có bộ điều khiển kiểu HD44780: gửi lệnh và mã ký tự qua bus 8 hoặc 4 bit.', 'Liquid-crystal text display (16 x 2, 20 x 4 …) with an HD44780-style controller: send instructions and character codes over an 8- or 4-bit bus.'),
    use: L('Hiện số đo, menu, thông báo trong mạch vi điều khiển.', 'Show readings, menus and messages in microcontroller circuits.'),
    read: L('RS = 0 gửi lệnh, RS = 1 gửi ký tự; dữ liệu được chốt ở sườn xuống của chân E. Khởi động: 0x38 (hoặc 0x28 cho 4 bit), 0x0C bật hiển thị, 0x01 xoá màn hình, 0x80 / 0xC0 chọn dòng 1 / 2.', 'RS = 0 sends an instruction, RS = 1 a character; data are latched on the falling edge of E. Start-up: 0x38 (or 0x28 for 4 bits), 0x0C display on, 0x01 clear, 0x80 / 0xC0 select line 1 / 2.'),
    tip: L('Màn hình tắt khi mới bật nguồn: nếu không thấy chữ, kiểm tra đã gửi lệnh bật hiển thị chưa. Mục Mô phỏng cũng ghi nội dung đang hiển thị.', 'The display is off at power-up: if no text appears, check that the display-on command was sent. The Simulation tab also lists what the screen shows.'),
  },
  'Dot matrix': {
    what: L('Nhiều LED xếp thành lưới hàng và cột (5 x 7, 8 x 8); mỗi điểm là giao của một hàng và một cột.', 'Many LEDs arranged in rows and columns (5 x 7, 8 x 8); each dot sits where a row meets a column.'),
    use: L('Hiển thị chữ, biểu tượng, bảng quang báo chạy chữ.', 'Showing letters, icons and scrolling message boards.'),
    read: L('Điểm sáng khi anode của nó ở mức cao và cathode ở mức thấp. Quét lần lượt từng hàng thật nhanh để mắt thấy cả hình.', 'A dot lights when its anode is high and its cathode low. Scan the rows one after another quickly so the eye sees the whole picture.'),
  },
  'Alphanumeric display': {
    what: L('LED 14 hoặc 16 đoạn (có các đoạn chéo) hiện được cả chữ cái lẫn chữ số.', '14- or 16-segment LED displays (with diagonal segments) that show letters as well as digits.'),
    use: L('Hiển thị chữ ngắn trên thiết bị: “HOLD”, “ERR”, tên chế độ.', 'Short words on instruments: “HOLD”, “ERR”, mode names.'),
    tip: L('Giống LED 7 đoạn: mỗi đoạn cần một điện trở hạn dòng.', 'As with 7-segment displays, every segment needs a current-limiting resistor.'),
  },
};
