/**
 * English text of the sheet notes of the shipped samples (examples/*.msim), loaded on demand.
 *
 * The sample files keep their notes in Vietnamese, the language of the learner this program is
 * written for. When the interface is English, opening a sample also swaps each note for its
 * English text (src/ui/integration/sampleLocalize.ts `localizeNotes`). Each entry is
 * [Vietnamese text exactly as stored in the file, English text]; a note the learner has edited no
 * longer matches its Vietnamese text and is left alone. The notes are listed per sample key (the
 * file stem with non-alphanumerics as "_") in the order they appear in the file: the sheets in
 * order, the notes of each sheet in order, then the notes of the child designs.
 * tests/review/round4/sample-notes.test.ts checks that every note of every sample is here.
 * Original text written for MachSim.
 */

export type NotePair = readonly [vi: string, en: string];

export const SAMPLE_NOTES: Record<string, readonly NotePair[]> = {
  '01_voltage_divider': [
    ['Vout = 12 V × 4.7k / (10k + 4.7k) ≈ 3.84 V — đo bằng XMM1 (DC volts).', 'Vout = 12 V × 4.7k / (10k + 4.7k) ≈ 3.84 V — measured with XMM1 (DC volts).'],
  ],
  '02_rc_lowpass': [
    ['fc = 1/(2π·R1·C1) ≈ 1.59 kHz: tại fc biên độ ra giảm còn 0.707 (−3 dB), pha −45°.', 'fc = 1/(2π·R1·C1) ≈ 1.59 kHz: at fc the output amplitude falls to 0.707 (−3 dB) and the phase is −45°.'],
  ],
  '03_rectifiers': [
    ['Nửa chu kỳ: gợn ≈ Vp/(f·R·C) ≈ 1.8 V @ 50 Hz.  Cầu: gợn ≈ Vp/(2f·R·C) ≈ 0.8 V @ 100 Hz.', 'Half-wave: ripple ≈ Vp/(f·R·C) ≈ 1.8 V @ 50 Hz.  Bridge: ripple ≈ Vp/(2f·R·C) ≈ 0.8 V @ 100 Hz.'],
  ],
  '04_common_emitter': [
    ['IC ≈ (VB − 0.65)/(RE1+RE2) ≈ 1.5 mA, re = 26 mV/IE ≈ 17 Ω, Av ≈ −(4.7k‖10k)/(17 + 100) ≈ −27.', 'IC ≈ (VB − 0.65)/(RE1+RE2) ≈ 1.5 mA, re = 26 mV/IE ≈ 17 Ω, Av ≈ −(4.7k‖10k)/(17 + 100) ≈ −27.'],
  ],
  '05_inverting_amplifier': [
    ['Av = −R2/R1 = −10: vào 0.5 V đỉnh → ra 5 V đỉnh, ngược pha 180°.', 'Av = −R2/R1 = −10: 0.5 V peak in → 5 V peak out, 180° out of phase.'],
  ],
  '06_555_led_flasher': [
    ['f = 1.44/((R1 + 2·R2)·C1) ≈ 0.99 Hz;  tH = 0.693(R1+R2)C1 ≈ 0.54 s, tL = 0.693·R2·C1 ≈ 0.47 s.', 'f = 1.44/((R1 + 2·R2)·C1) ≈ 0.99 Hz;  tH = 0.693(R1+R2)C1 ≈ 0.54 s, tL = 0.693·R2·C1 ≈ 0.47 s.'],
  ],
  '07_cmos_inverter': [
    ['Simulate > DC sweep (V1: 0 → 5 V): Vout chuyển từ 5 V xuống 0 V quanh Vin ≈ 2.5 V.', 'Simulate > DC sweep (V1: 0 → 5 V): Vout falls from 5 V to 0 V around Vin ≈ 2.5 V.'],
  ],
  '08_decade_counter': [
    ['7490: đếm sườn xuống của CKA; QA→CKB tạo mã BCD 0…9. 7447 giải mã BCD → 7 đoạn (mức thấp tích cực).', '7490: counts the falling edges of CKA; QA→CKB makes the BCD code 0…9. The 7447 decodes BCD to 7 segments (active low).'],
  ],
  '09_lcd_hello': [
    ['Mỗi lần gửi: đặt RS và 4 bit dữ liệu, đưa E lên rồi xuống (LCD chốt ở sườn xuống của E). Byte gửi nửa cao trước. Lệnh: 0x28 = 4 bit, 2 dòng; 0x0C = bật hiển thị; 0x01 = xoá; 0x06 = tự tăng địa chỉ; 0xC0 = đầu dòng 2.', 'Each transfer: set RS and 4 data bits, raise E and then lower it (the LCD latches on the falling edge of E). The high nibble is sent first. Commands: 0x28 = 4-bit, 2 lines; 0x0C = display on; 0x01 = clear; 0x06 = auto-increment; 0xC0 = start of line 2.'],
  ],
  '10_bench_instruments': [
    ['RC: fc = 1/(2π·1k·100n) ≈ 1,59 kHz → ở 1 kHz ra ≈ 0,85 × vào. Ngõ ra máy phát có 50 Ω nên đỉnh-đỉnh ở SIG hơi dưới 2 V khi có tải (giống máy thật). Thử: bấm “Tự động cài đặt”, chọn FFT, hoặc đổi “Tải” của XAG1 sang 50 Ω.', 'RC: fc = 1/(2π·1k·100n) ≈ 1.59 kHz → at 1 kHz the output is ≈ 0.85 × the input. The generator output has 50 Ω, so the peak-to-peak at SIG is a little under 2 V when loaded (like the real instrument). Try: press “Autoset”, choose FFT, or set the “Load” of XAG1 to 50 Ω.'],
  ],
  '11_ohms_law': [
    ['I = U / R = 9 V / 1 kΩ = 9 mA. Đổi R1 thành 2k rồi chạy lại: dòng giảm một nửa.', 'I = U / R = 9 V / 1 kΩ = 9 mA. Change R1 to 2k and run again: the current halves.'],
  ],
  '12_series_parallel': [
    ['R2 ‖ R3 = (2k · 2k)/(2k + 2k) = 1 kΩ → R = 2 kΩ; I = 12 V / 2 kΩ = 6 mA; V(MID) = 6 mA · 1 kΩ = 6 V.', 'R2 ‖ R3 = (2k · 2k)/(2k + 2k) = 1 kΩ → R = 2 kΩ; I = 12 V / 2 kΩ = 6 mA; V(MID) = 6 mA · 1 kΩ = 6 V.'],
  ],
  '13_rc_charging': [
    ['Sau τ = 0,1 s tụ đạt 63 % (3,16 V); sau 5τ = 0,5 s gần như đầy (99 %).', 'After τ = 0.1 s the capacitor reaches 63 % (3.16 V); after 5τ = 0.5 s it is almost full (99 %).'],
  ],
  '14_rlc_resonance': [
    ['f0 = 1/(2π·√(10 mH · 1 µF)) ≈ 1,59 kHz; băng thông = f0/Q ≈ 159 Hz. Mở máy vẽ Bode XBP1 hoặc chạy phân tích AC.', 'f0 = 1/(2π·√(10 mH · 1 µF)) ≈ 1.59 kHz; bandwidth = f0/Q ≈ 159 Hz. Open the Bode plotter XBP1 or run an AC analysis.'],
  ],
  '15_wheatstone_bridge': [
    ['Thử đổi R4 thành 1k: vôn kế U1 chỉ 0 V (cầu cân bằng). Cầu dùng để đo điện trở chưa biết chính xác.', 'Try changing R4 to 1k: the voltmeter U1 reads 0 V (the bridge is balanced). A bridge is used to measure an unknown resistance accurately.'],
  ],
  '16_diode_iv': [
    ['Quét DC: V(ANODE) gần như đứng yên ở 0,6…0,8 V trong khi dòng Id tăng; I ≈ (V1 − Vd)/100 Ω.', 'DC sweep: V(ANODE) stays almost still at 0.6…0.8 V while the current Id rises; I ≈ (V1 − Vd)/100 Ω.'],
  ],
  '17_zener_regulator': [
    ['Dòng qua R1 = (V1 − 5,1 V)/470 Ω; tải RL lấy 5,1 mA, phần còn lại chảy qua Zener.', 'The current through R1 = (V1 − 5.1 V)/470 Ω; the load RL takes 5.1 mA and the rest flows through the Zener.'],
  ],
  '18_led_resistor': [
    ['Thử R1 = 1k: dòng còn ≈ 3 mA, LED mờ hơn. R1 quá nhỏ (ví dụ 10 Ω) sẽ làm LED quá dòng.', 'Try R1 = 1k: the current drops to ≈ 3 mA and the LED is dimmer. An R1 that is too small (for example 10 Ω) overloads the LED.'],
  ],
  '19_bjt_switch': [
    ['IB ≈ (5 − 0,7)/10k = 0,43 mA; IC ≈ (9 − 1,9 − 0,1)/470 ≈ 15 mA < hFE·IB nên transistor bão hoà, V(OUT) ≈ 0,1 V.', 'IB ≈ (5 − 0.7)/10k = 0.43 mA; IC ≈ (9 − 1.9 − 0.1)/470 ≈ 15 mA < hFE·IB, so the transistor saturates and V(OUT) ≈ 0.1 V.'],
  ],
  '20_non_inverting_amplifier': [
    ['Av = 1 + RF/RG = 10: vào 0,1 V đỉnh → ra 1 V đỉnh, cùng pha. Trở kháng vào rất lớn.', 'Av = 1 + RF/RG = 10: 0.1 V peak in → 1 V peak out, in phase. The input impedance is very high.'],
  ],
  '21_summing_amplifier': [
    ['Nút IN− là “đất ảo” (0 V): dòng V1/R1 + V2/R2 = 0,3 mA chảy hết qua RF → Vout = −0,3 mA · 10k = −3 V.', 'Node IN− is a “virtual ground” (0 V): the current V1/R1 + V2/R2 = 0.3 mA all flows through RF → Vout = −0.3 mA · 10k = −3 V.'],
  ],
  '22_integrator': [
    ['Độ dốc ra = −Vin/(R·C) = ∓1 V/ms; mỗi nửa chu kỳ 0,5 ms → biên độ đỉnh-đỉnh 0,5 V. Quá độ bắt đầu từ tụ chưa nạp (điều kiện đầu = 0).', 'Output slope = −Vin/(R·C) = ∓1 V/ms; each half cycle is 0.5 ms → 0.5 V peak-to-peak. The transient starts from an uncharged capacitor (initial condition = 0).'],
  ],
  '23_schmitt_trigger': [
    ['Đầu ra chỉ đổi trạng thái khi đầu vào vượt +1,7 V (xuống −5 V) hoặc dưới −1,7 V (lên +5 V): đó là vòng trễ.', 'The output changes state only when the input rises above +1.7 V (down to −5 V) or falls below −1.7 V (up to +5 V): that is the hysteresis loop.'],
  ],
  '24_logic_gates': [
    ['AND: 1 khi cả A và B là 1. OR: 1 khi ít nhất một đầu vào là 1. XOR: 1 khi A khác B.', 'AND: 1 when both A and B are 1. OR: 1 when at least one input is 1. XOR: 1 when A differs from B.'],
  ],
  '25_flipflop_divider': [
    ['Flip-flop T với T = 1 đảo trạng thái ở mỗi sườn lên của CLK: Q1 = CLK/2, Q2 = CLK/4; NQ1, NQ2 là đầu ra đảo.', 'A T flip-flop with T = 1 toggles on every rising edge of CLK: Q1 = CLK/2, Q2 = CLK/4; NQ1, NQ2 are the inverted outputs.'],
  ],
  '26_binary_counter': [
    ['QA đổi trạng thái ở mỗi sườn xuống của CKA; QB, QC, QD lần lượt chia đôi tiếp: 4 bit đếm 0…15 rồi quay về 0.', 'QA toggles on every falling edge of CKA; QB, QC, QD each halve again: 4 bits count 0…15 and then wrap to 0.'],
  ],
  '27_555_monostable': [
    ['t = 1,1 · R1 · C1 = 1,1 · 100 kΩ · 1 µF ≈ 110 ms. Xung kích ngắn (1 ms) nhưng xung ra luôn dài 110 ms.', 't = 1.1 · R1 · C1 = 1.1 · 100 kΩ · 1 µF ≈ 110 ms. The trigger pulse is short (1 ms) but the output pulse is always 110 ms long.'],
  ],
  '28_r2r_dac': [
    ['V(OUT) = Vcao · (8·QD + 4·QC + 2·QB + QA)/16: mỗi bậc ≈ Vcao/16, đếm 16 bậc mỗi 16 ms.', 'V(OUT) = Vhigh · (8·QD + 4·QC + 2·QB + QA)/16: each step ≈ Vhigh/16, 16 steps counted every 16 ms.'],
  ],
  '29_pwm_comparator': [
    ['Đầu ra cao khi TRI < LEVEL: độ rộng xung = 2 V / 5 V = 40 %; trung bình ≈ 0,4 · 5 V = 2 V (τ = R1·C1 = 10 ms).', 'The output is high while TRI < LEVEL: pulse width = 2 V / 5 V = 40 %; average ≈ 0.4 · 5 V = 2 V (τ = R1·C1 = 10 ms).'],
  ],
  '30_full_wave_ct': [
    ['Mỗi nửa cuộn thứ cấp ≈ 16 V đỉnh; ra ≈ 16 − 0,8 ≈ 15 V; gợn ≈ 15 mA/(2·50 Hz·470 µF) ≈ 0,3 V ở 100 Hz.', 'Each half of the secondary ≈ 16 V peak; output ≈ 16 − 0.8 ≈ 15 V; ripple ≈ 15 mA/(2·50 Hz·470 µF) ≈ 0.3 V at 100 Hz.'],
  ],
  '31_regulator_7805': [
    ['Công suất tiêu tán trên 7805 = (12 V − 5 V) · 50 mA = 0,35 W. Dưới ≈ 7 V đầu vào, đầu ra tụt theo (mất ổn áp).', 'Power dissipated in the 7805 = (12 V − 5 V) · 50 mA = 0.35 W. Below ≈ 7 V input the output follows the input down (dropout).'],
  ],
  '32_voltage_doubler': [
    ['V(CLAMP) dao động từ ≈ −0,7 V tới ≈ +19 V; C2 giữ đỉnh đó. Tải càng nặng thì ra càng thấp và gợn càng lớn.', 'V(CLAMP) swings from ≈ −0.7 V to ≈ +19 V; C2 holds that peak. The heavier the load, the lower the output and the larger the ripple.'],
  ],
  '33_lc_tank': [
    ['f0 = 1/(2π·√(100 µH · 10 nF)) ≈ 159 kHz; tại f0 cuộn cảm và tụ “triệt tiêu” nhau, khung chỉ còn RP.', 'f0 = 1/(2π·√(100 µH · 10 nF)) ≈ 159 kHz; at f0 the inductor and capacitor “cancel” each other and the tank is left with RP only.'],
  ],
  '34_am_detector': [
    ['Điều kiện: 1/f_sóng mang (20 µs) ≪ R·C (100 µs) ≪ 1/f_âm (1 ms). R·C quá lớn thì đầu ra không theo kịp đường bao.', 'Condition: 1/f_carrier (20 µs) ≪ R·C (100 µs) ≪ 1/f_audio (1 ms). If R·C is too large the output cannot follow the envelope.'],
  ],
  '35_transmission_line': [
    ['Đầu gần: 1 V (chia đôi với RS) rồi lên 1,5 V khi sóng phản xạ quay về (20 ns). Đầu xa: 1,5 V sau 10 ns. Thử RL = 50 Ω: hết phản xạ.', 'Near end: 1 V (divided in half with RS), then 1.5 V when the reflected wave returns (20 ns). Far end: 1.5 V after 10 ns. Try RL = 50 Ω: the reflection disappears.'],
  ],
  '36_wattmeter': [
    ['|Z| = √(100² + (2π·50·0,1)²) ≈ 104,8 Ω; I = 10 V/104,8 Ω ≈ 95 mA; P = I²·R ≈ 0,91 W. Oát kế: cuộn dòng nối tiếp, cuộn áp song song.', '|Z| = √(100² + (2π·50·0.1)²) ≈ 104.8 Ω; I = 10 V/104.8 Ω ≈ 95 mA; P = I²·R ≈ 0.91 W. Wattmeter: the current coil in series, the voltage coil in parallel.'],
  ],
  '37_spectrum_square': [
    ['Biên độ hài bậc n của sóng vuông biên độ A: 4A/(nπ) với n lẻ; hài chẵn bằng 0. Thử đổi máy phát sang sóng tam giác: hài giảm theo 1/n².', 'Amplitude of harmonic n of a square wave of amplitude A: 4A/(nπ) for odd n; the even harmonics are zero. Try a triangle wave on the generator: the harmonics fall as 1/n².'],
  ],
  '38_word_generator': [
    ['Mỗi bit là một đường trên XLA1: b0 đổi mỗi 1 ms, b1 mỗi 2 ms … (mã nhị phân của 0…F). Mở XWG1 để sửa dãy từ.', 'Each bit is a line on XLA1: b0 changes every 1 ms, b1 every 2 ms … (the binary code of 0…F). Open XWG1 to edit the word sequence.'],
  ],
  '39_parameter_sweep': [
    ['fc ≈ 1,59 kHz (1k), 723 Hz (2,2k), 339 Hz (4,7k). Mô phỏng > Phân tích đang chọn: Quét tham số, rồi Chạy phân tích.', 'fc ≈ 1.59 kHz (1k), 723 Hz (2.2k), 339 Hz (4.7k). Simulate > Analysis selected: Parameter sweep, then Run analysis.'],
  ],
  '40_temperature_sweep': [
    ['Ở cùng dòng ≈ 1 mA, V(VD) thấp hơn khoảng 0,2 V khi nóng thêm 100 °C: diode dùng được làm cảm biến nhiệt.', 'At the same current ≈ 1 mA, V(VD) is about 0.2 V lower when 100 °C hotter: a diode can be used as a temperature sensor.'],
  ],
  '41_monte_carlo': [
    ['Với dung sai đều ±5 % ở cả hai điện trở, V(OUT) lệch tối đa ≈ ±0,25 V (±5 %); hầu hết các lần chạy gần 5 V hơn.', 'With a uniform ±5 % tolerance on both resistors, V(OUT) deviates by at most ≈ ±0.25 V (±5 %); most runs are closer to 5 V.'],
  ],
  '42_fourier_clipper': [
    ['Sóng gần vuông chủ yếu có hài bậc 3, 5, 7…; hài chẵn rất nhỏ vì hai diode đối xứng.', 'The nearly square wave has mostly harmonics 3, 5, 7…; the even harmonics are very small because the two diodes are symmetric.'],
  ],
  '43_subcircuit_cascade': [
    ['Mỗi khối là một tầng −20 dB/decade trên fc ≈ 1,59 kHz; hai tầng nối tiếp (có tải lẫn nhau) cho −40 dB/decade.', 'Each block is a −20 dB/decade stage above fc ≈ 1.59 kHz; two stages in series (loading each other) give −40 dB/decade.'],
  ],
  '44_multi_sheet': [
    ['Trang 1: nguồn 9 V và R1. Đầu nối “NODE” nối tiếp sang trang 2.', 'Sheet 1: the 9 V source and R1. The off-page connector “NODE” continues to sheet 2.'],
    ['Trang 2: LED vàng và tải R2. I ≈ (9 − 2)/470 ≈ 15 mA.', 'Sheet 2: the yellow LED and the load R2. I ≈ (9 − 2)/470 ≈ 15 mA.'],
  ],
  '45_hierarchical_block': [
    ['Cùng một khối, hai bộ tham số: MachSim tạo hai mạch con trong netlist (Báo cáo > Netlist). Nhấp đúp khối để mở.', 'One block, two sets of parameters: MachSim creates two subcircuits in the netlist (Reports > Netlist). Double-click the block to open it.'],
  ],
  '46_block_control_loop': [
    ['Bậc thang 1 V lúc 1 ms: OUT và TF tăng theo 1 − e^(−(t − 1 ms)/1 ms) và đạt 63 % lúc 2 ms (t63 = tf63 = 2 ms). Thử đổi k của A2 thành 2k: vòng kín nhanh gấp đôi.', 'A 1 V step at 1 ms: OUT and TF rise as 1 − e^(−(t − 1 ms)/1 ms) and reach 63 % at 2 ms (t63 = tf63 = 2 ms). Try changing k of A2 to 2k: the closed loop becomes twice as fast.'],
  ],
  '47_reference_ground': [
    ['Vsec ≈ 10 V / 2 = 5 V đỉnh, đo so với Đất tham chiếu 1. Thử nối phía thứ cấp với Đất chính bằng một điện trở: ERC cảnh báo đất tham chiếu không còn cách ly.', 'Vsec ≈ 10 V / 2 = 5 V peak, measured against Reference ground 1. Try joining the secondary side to the main ground through a resistor: ERC warns that the reference ground is no longer isolated.'],
  ],
  '48_real_capacitor': [
    ['f0 = 1/(2π·√(2 nH · 100 nF)) ≈ 11,25 MHz: V(CR) nhỏ nhất ≈ 30 mΩ / 50 Ω (−64 dB), pha đổi dấu. Trên f0 tụ C2 hoạt động như cuộn cảm. Đặt ESL của C2 = 0: tụ trở lại lý tưởng.', 'f0 = 1/(2π·√(2 nH · 100 nF)) ≈ 11.25 MHz: V(CR) is smallest ≈ 30 mΩ / 50 Ω (−64 dB) and the phase changes sign. Above f0 the capacitor C2 behaves like an inductor. Set the ESL of C2 = 0: the capacitor becomes ideal again.'],
  ],
  '49_pll_lock': [
    ['Sau vài ms vòng khoá: vcavg ≈ 0,15 V, chu kỳ OUT tper ≈ 1/10,3 kHz ≈ 97,1 µs. Đổi tần số V1 thành 13 kHz (ngoài dải giữ khoá): vòng không khoá được, OUT trôi tần số.', 'After a few ms the loop locks: vcavg ≈ 0.15 V, the period of OUT tper ≈ 1/10.3 kHz ≈ 97.1 µs. Change the frequency of V1 to 13 kHz (outside the lock range): the loop cannot lock and OUT drifts in frequency.'],
  ],
  '50_dip_switch_leds': [
    ['Vị trí đang bật có chấm tô màu. LED đỏ: I = (5 − 1,9) V / 330 Ω ≈ 9,4 mA; LED xanh dương cần VF ≈ 3,1 V nên chỉ ≈ 5,8 mA.', 'A switch that is on has a filled dot. Red LED: I = (5 − 1.9) V / 330 Ω ≈ 9.4 mA; the blue LED needs VF ≈ 3.1 V so it carries only ≈ 5.8 mA.'],
  ],
  '51_mcu_blink': [
    ['Chân P1.0 ở mức 0 thì LED sáng: dòng đi từ +5 V qua 330 Ω và LED vào chân. Mở Trình soạn mã (nhấp đúp vào U1) để sửa chương trình, chạy từng lệnh và xem thanh ghi.', 'When pin P1.0 is at 0 the LED lights: the current goes from +5 V through 330 Ω and the LED into the pin. Open the code editor (double-click U1) to edit the program, run it instruction by instruction and watch the registers.'],
  ],
  '52_mcu_seven_segment': [
    ['Bảng mã nằm trong chương trình (TABLE). Timer 0 ngắt mỗi 50 ms; sau 10 lần thì tăng số đếm. Mở Trình soạn mã để xem thanh ghi TL0 / TH0 chạy.', 'The code table is in the program (TABLE). Timer 0 interrupts every 50 ms; after 10 interrupts the count goes up. Open the code editor to watch TL0 / TH0 run.'],
  ],
  '53_mcu_button': [
    ['Không cần điện trở treo ngoài: chân P1 của 8051 đã được treo lên bằng điện trở trong khoảng 50 kΩ. Nút nhấn chỉ cần kéo chân xuống đất.', 'No external pull-up is needed: the 8051 P1 pins are already pulled up by an internal resistor of about 50 kΩ. The push-button only has to pull the pin to ground.'],
  ],
  '54_mcu_serial': [
    ['Điện trở 4,7 kΩ treo chân TXD lên +5 V (chân 8051 chỉ hút dòng) và là tải để xem dạng sóng trên chân TXD bằng đầu dò. Cửa sổ nối tiếp của Trình soạn mã đọc trực tiếp thanh ghi SBUF, nên không cần nối dây gì thêm.', 'The 4.7 kΩ resistor pulls the TXD pin up to +5 V (an 8051 pin only sinks current) and is the load for seeing the waveform on the TXD pin with a probe. The serial window of the code editor reads the SBUF register directly, so no extra wiring is needed.'],
  ],
  '55_ladder_start_stop': [
    ['Mô-đun vào đọc hai nút: I0.0 = KHỞI ĐỘNG, I0.1 = DỪNG. Mô-đun ra Q0.0 cấp điện cho cuộn dây khởi động từ (ở đây là đèn X1). Thử bỏ tiếp điểm song song Q0.0 trong bậc 1: động cơ chỉ chạy khi còn giữ nút — đó chính là vì sao cần tự giữ.', 'The input module reads two buttons: I0.0 = START, I0.1 = STOP. The output module Q0.0 energises the contactor coil (here the lamp X1). Try removing the parallel Q0.0 contact in rung 1: the motor then runs only while the button is held — which is exactly why a latching contact is needed.'],
  ],
  '56_ladder_traffic': [
    ['Chân đèn của mô hình là tải thật (2 kΩ ≈ 12 mA ở 24 V), nên mô-đun ra phải thực sự cấp dòng. Muốn chu kỳ khác, chỉ cần sửa giá trị đặt trước của T1 và các mốc so sánh.', 'The lamp pin of the model is a real load (2 kΩ ≈ 12 mA at 24 V), so the output module must really supply current. For a different cycle, just edit the preset of T1 and the comparison values.'],
  ],
  '57_ladder_tank': [
    ['Mức nước vẽ ngay trong hình bồn và cũng là biến kết quả V(TK1.percent) — vẽ được trong Grapher. Van xả chảy theo √mức, nên bồn đầy cạn hết sau 2 · 10 L / 0,35 L/s ≈ 57 s.', 'The water level is drawn right in the tank picture and is also the result variable V(TK1.percent) — it can be plotted in the Grapher. The drain flows as √level, so a full tank empties in 2 · 10 L / 0.35 L/s ≈ 57 s.'],
  ],
  '70_contactor_start_stop': [
    ['Điều khiển 24 V: Dừng (S2, thường đóng, phím X) → Mở (S1, phím G) song song tiếp điểm tự giữ KC1 (cuộn KM1) → tiếp điểm rơ-le nhiệt 95-96 → cuộn KM1.', 'Control circuit, 24 V: Stop (S2, normally closed, key X) → Start (S1, key G) in parallel with the holding contact KC1 (coil KM1) → overload relay contact 95-96 → coil KM1.'],
    ['Đèn X1 sáng khi cuộn KM1 có điện. Rơ-le nhiệt FR1 nằm ở trang “Mạch lực”.', 'Lamp X1 lights when coil KM1 is energised. The overload relay FR1 is on the “Power circuit” sheet.'],
    ['Mạch lực: tiếp điểm chính KC3 (theo cuộn KM1 ở trang Điều khiển) → rơ-le nhiệt FR1 (1 A, cấp 10A) → tải RM 2 Ω = động cơ bị kẹt (6 A).', 'Power circuit: main contact KC3 (follows coil KM1 on the Control sheet) → overload relay FR1 (1 A, class 10A) → load RM 2 Ω = a jammed motor (6 A).'],
    ['Cùng một tên “KM1” nối cuộn với tiếp điểm dù chúng ở hai trang khác nhau. Nhấn R (Reset) để đặt lại rơ-le nhiệt.', 'The same name “KM1” links the coil to the contacts even though they are on two different sheets. Press R (Reset) to reset the overload relay.'],
  ],
  '71_timer_relays': [
    ['KT1 (trễ đóng) → tiếp điểm KC1 → đèn X1: sáng 3 s SAU khi cuộn có điện. KT2 (trễ mở) → tiếp điểm KC2 → đèn X2: tắt 3 s SAU khi cuộn mất điện.', 'KT1 (on-delay) → contact KC1 → lamp X1: lights 3 s AFTER the coil is energised. KT2 (off-delay) → contact KC2 → lamp X2: goes out 3 s AFTER the coil loses power.'],
    ['Đổi “Thời gian trễ” của KT1 / KT2 trong Thuộc tính rồi chạy lại; vẽ V(L1) và V(L2) trong Grapher.', 'Change the “Delay time” of KT1 / KT2 in Properties and run again; plot V(L1) and V(L2) in the Grapher.'],
  ],
  '72_speaker_filter': [
    ['Loa LS1 phát điện áp ở ngõ ra mạch đệm. V1 (440 Hz) đi qua gần như nguyên vẹn; V2 (3 kHz) bị giảm còn khoảng 47 %.', 'Speaker LS1 plays the voltage at the buffer output. V1 (440 Hz) passes almost unchanged; V2 (3 kHz) is reduced to about 47 %.'],
    ['Mở Mô phỏng › Âm thanh để chỉnh âm lượng chung, tắt tiếng và xem vạch mức. Nếu mạch chạy chậm hơn thời gian thực, cửa sổ sẽ báo âm thanh bị kéo giãn.', 'Open Simulate › Audio to set the master volume, mute and see the level bar. If the circuit runs slower than real time, the window tells you the sound is being stretched.'],
  ],
  '73_dual_opamp_variants': [
    ['U1A và U1B là hai phần của MỘT vi mạch LM358: cùng tên U1, nguồn V+ / V− nối một lần ở U1A. Báo cáo › Cổng còn trống cho biết không còn phần nào chưa dùng.', 'U1A and U1B are two sections of ONE LM358 chip: the same name U1, with the V+ / V− supply wired once at U1A. Reports › Spare gates shows that no section is left unused.'],
    ['Công cụ › Quản lý phương án lắp ráp: hai phương án chỉ khác giá trị của R2 (10k hay 100k). Đổi phương án đang dùng rồi chạy lại để so Vout (1 V và 5,5 V).', 'Tools › Variant manager: the two variants differ only in the value of R2 (10k or 100k). Change the active variant and run again to compare Vout (1 V and 5.5 V).'],
  ],
  '78_ladder_function_block': [
    ['Thử: đổi khối “BomHaiMuc” (nhấn Khối hàm › BomHaiMuc) rồi chạy lại; mọi lời gọi đổi theo. MW0 là từ nhớ 16 bit có dấu; số lần bơm khởi động hiện trong dải trạng thái của trang bậc thang khi chạy.', 'Try: change the “BomHaiMuc” block (press Function blocks › BomHaiMuc) and run again; every call changes with it. MW0 is a signed 16-bit memory word; the number of pump starts shows in the status strip of the ladder sheet while it runs.'],
  ],
  '80_hysteresis_bh_loop': [
    ['V1 bắt đầu từ đỉnh (pha 90°) nên từ thông đối xứng ±1,5 T/(100 vòng·1 cm²). Đổi “Hệ số ghim k” của L1 (400 A/m) để thấy vòng rộng ra hoặc hẹp lại; k = 0 là không có từ trễ.', 'V1 starts at its peak (phase 90°), so the flux is symmetric ±1.5 T/(100 turns·1 cm²). Change the “Pinning coefficient k” of L1 (400 A/m) to see the loop widen or narrow; k = 0 means no hysteresis.'],
    ['Đổi “Bề dày lá thép” (350 µm) để thấy tổn hao dòng xoáy: dòng điện tăng thêm đúng bằng V·G với G = l·d²/(12·ρ·N²·A). Thử mẫu lõi ferrite và lõi từ cứng trong nhóm Cơ bản.', 'Change the “Lamination thickness” (350 µm) to see the eddy-current loss: the current rises by exactly V·G with G = l·d²/(12·ρ·N²·A). Try the ferrite and hard-magnet core samples in the Basic group.'],
  ],
  '81_ekv_bsim4_inverter': [
    ['EKV (Q1, Q2) và BSIM4 (Q3, Q4) cùng W/L: PMOS rộng gấp 2,5–2,8 lần NMOS để hai bên cân bằng. Phân tích: quét DC V2 từ 0 đến 1,8 V.', 'EKV (Q1, Q2) and BSIM4 (Q3, Q4) with the same W/L: the PMOS is 2.5–2.8 times wider than the NMOS so that both sides are balanced. Analysis: DC sweep of V2 from 0 to 1.8 V.'],
    ['Xem IC(Q2) (hệ số nghịch đảo) trong kết quả OP: dưới 0,1 là nghịch đảo yếu, trên 10 là mạnh.', 'Look at IC(Q2) (the inversion coefficient) in the OP result: below 0.1 is weak inversion, above 10 is strong.'],
  ],
  '90_handout_two_sheets': [
    ['Trang 1, lọc thông thấp: fc = 1/(2π·R1·C1) ≈ 1,0 kHz. Ở fc biên độ ra còn 0,707 và trễ pha 45°.', 'Sheet 1, low-pass: fc = 1/(2π·R1·C1) ≈ 1.0 kHz. At fc the output amplitude is 0.707 and the phase lags by 45°.'],
    ['Bấm Ctrl+P: chọn “Trang sơ đồ và trang bậc thang” và “Bảng cài đặt thiết bị đo”, đặt khổ giấy và xem trước. Cài đặt trang được lưu trong tệp.', 'Press Ctrl+P: choose “Schematic and ladder sheets” and “Instrument settings list”, set the paper size and preview. The page setup is saved in the file.'],
    ['Trang 2, lọc thông cao: đổi chỗ R và C. Cũng fc ≈ 1,0 kHz nhưng tần số thấp bị chặn thay vì tần số cao.', 'Sheet 2, high-pass: R and C swapped. The same fc ≈ 1.0 kHz, but low frequencies are blocked instead of high ones.'],
    ['Bài tập: chạy phân tích AC và so sánh biên độ V(OUT) của hai trang ở 100 Hz và 10 kHz.', 'Exercise: run the AC analysis and compare the amplitude of V(OUT) of the two sheets at 100 Hz and at 10 kHz.'],
  ],
  '91_block_meters': [
    ['Vout = 5 V · RB / (1k + RB): X1 → 2,5 V, X2 → 3,75 V. Hai bản cùng một khối nhưng RB khác nhau, nên hai đồng hồ đọc khác nhau.', 'Vout = 5 V · RB / (1k + RB): X1 → 2.5 V, X2 → 3.75 V. The two copies are the same block with different RB, so the two meters read differently.'],
    ['Bấm Chạy rồi mở bảng Mô phỏng: thiết bị đo được liệt kê theo đường dẫn (X1.XMM1, X2.XMM1). Mở một khối để xem cả đồng hồ lẫn LED của đúng bản đó.', 'Press Run and open the Simulation panel: the instruments are listed by path (X1.XMM1, X2.XMM1). Open a block to see both the meter and the LED of exactly that copy.'],
  ],
  '92_step_sweep': [
    ['fc = 1/(2π·Rx·C1): Rx = 1k → 1,59 kHz; 2,2k → 723 Hz; 4,7k → 339 Hz. Đường cong có R lớn hơn nằm bên trái.', 'fc = 1/(2π·Rx·C1): Rx = 1k → 1.59 kHz; 2.2k → 723 Hz; 4.7k → 339 Hz. The curve with the larger R lies further left.'],
    ['Chọn phân tích AC rồi Chạy: Máy vẽ hiện ba đường, chú giải ghi Rx=1000, Rx=2200, Rx=4700. Cũng làm được bằng Mô phỏng › Thiết lập phân tích › Quét tham số, chọn “Tham số toàn cục (biến)”.', 'Choose the AC analysis and Run: the Grapher shows three curves with the legend Rx=1000, Rx=2200, Rx=4700. You can do the same with Simulate › Analysis settings › Parameter sweep, choosing “Global parameter (variable)”.'],
  ],
  '93_mcu_exact_delay': [
    ['Một nửa chu kỳ: CPL 1 + ACALL 2 + SJMP 2 + MOV 1 + 32 × (MOV 1 + 14 × DJNZ 2 + DJNZ 2) + RET 2 = 1000 chu kỳ máy = 1 ms ở 12 MHz.', 'One half period: CPL 1 + ACALL 2 + SJMP 2 + MOV 1 + 32 × (MOV 1 + 14 × DJNZ 2 + DJNZ 2) + RET 2 = 1000 machine cycles = 1 ms at 12 MHz.'],
    ['Trong gỡ lỗi, cột “Chu kỳ” của Bảng dịch và dòng trạng thái cho biết mỗi lệnh mất bao lâu; thử thêm một NOP rồi xem nửa chu kỳ thành 1001 chu kỳ.', 'While debugging, the “Cyc” column of the Listing tab and the status line tell you how long each instruction takes; add one NOP and see the half period become 1001 cycles.'],
  ],
  '94_battery_runtime': [
    ['Thời gian chạy ở dòng không đổi: t = C · 3600 / I. Mức điện tích V(BT1.soc) giảm đều từ 1 về 0 sau 360 s; điện áp pin tụt nhanh ở những giây cuối.', 'Runtime at a constant current: t = C · 3600 / I. The state of charge V(BT1.soc) falls steadily from 1 to 0 in 360 s; the battery voltage drops quickly in the last seconds.'],
    ['Tải điện trở: I = V/R giảm khi pin cạn, nên đường V(BT2.soc) cong và kéo dài hơn. Đổi “Hoá học” sang kiềm để thấy điện trở trong tăng mạnh hơn.', 'Resistor load: I = V/R falls as the battery empties, so the V(BT2.soc) curve bends and lasts longer. Change “Chemistry” to alkaline to see the internal resistance rise much more.'],
  ],
  '95_7474_sections': [
    ['D = QN biến mỗi flip-flop thành bộ chia 2: Q1 = f/2 = 500 Hz, Q2 = f/4 = 250 Hz. Hai bộ chia hợp lại là bộ đếm nhị phân 2 bit.', 'D = QN turns each flip-flop into a divide-by-2: Q1 = f/2 = 500 Hz, Q2 = f/4 = 250 Hz. Together the two dividers form a 2-bit binary counter.'],
    ['U1A và U1B là cùng một vi mạch (cùng tên U1). Dùng Thuộc tính › Vi mạch để chuyển một phần sang chip khác hoặc sang một chip mới.', 'U1A and U1B are one and the same chip (the same name U1). Use Properties › Package to move a section to another chip or to a new one.'],
  ],
  '96_transformer_regulation': [
    ['Đầy tải: Vs = 12 V hiệu dụng = 16,97 V đỉnh. Không tải: Vs0 = 12 V · (1 + 15 %) = 13,8 V hiệu dụng = 19,5 V đỉnh.', 'At full load: Vs = 12 V RMS = 16.97 V peak. Unloaded: Vs0 = 12 V · (1 + 15 %) = 13.8 V RMS = 19.5 V peak.'],
    ['Độ lệch điện áp = (Vs0 − Vs)/Vs. Đổi “Độ lệch điện áp” hoặc “Công suất định mức” của T1, T2 rồi chạy lại; hãy thử RL = 12 Ω (nửa tải).', 'Regulation = (Vs0 − Vs)/Vs. Change the “Regulation” or the “Rated power” of T1 and T2 and run again; try RL = 12 Ω (half load).'],
  ],
  '97_fuse_vs_breaker': [
    ['Cầu chì: t = I²t / (I² − Imin²) với Imin = 1,5 · In = 3 A → 5,5 ms. Áp-tô-mát C ở 5·In: t = 10 s · ln(25 / (25 − 1,69)) ≈ 0,70 s.', 'Fuse: t = I²t / (I² − Imin²) with Imin = 1.5 · In = 3 A → 5.5 ms. Curve-C breaker at 5·In: t = 10 s · ln(25 / (25 − 1.69)) ≈ 0.70 s.'],
    ['Chọn một cầu chì hoặc áp-tô-mát rồi nhìn đường cong thời gian – dòng điện trong Thuộc tính. Vẽ V(L1) và V(L2): điện áp tải về 0 khi thiết bị cắt.', 'Select a fuse or a breaker and look at the time–current curve in Properties. Plot V(L1) and V(L2): the load voltage drops to 0 when the device trips.'],
  ],
  '98_measurement_replay': [
    ['V(SENS) đi qua đúng các mẫu của tệp (tại 2 ms là 1,8 V); giữa hai mẫu nó nội suy tuyến tính. “Tỉ lệ thời gian” 2 làm tệp chạy chậm gấp đôi, “Tỉ lệ điện áp” nhân các giá trị.', 'V(SENS) passes exactly through the samples of the file (1.8 V at 2 ms); between two samples it interpolates linearly. A “Time scale” of 2 plays the file twice as slowly, the “Voltage scale” multiplies the values.'],
    ['Bộ lọc RC có τ = R·C = 1 ms nên V(OUT) bám theo V(SENS) với độ trễ cỡ 1 ms và bỏ bớt dao động nhỏ. Đổi C1 để làm mượt nhiều hơn.', 'The RC filter has τ = R·C = 1 ms, so V(OUT) follows V(SENS) with a delay of about 1 ms and removes the small wobble. Change C1 to smooth more.'],
  ],
};
