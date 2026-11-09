/**
 * Lesson text: semiconductors (diode, LED, Zener, rectifier, transistor switch, common-emitter
 * amplifier). Original text for MachSim. See src/i18n/lessons/index.ts.
 */
import { L } from '../core';
import type { LessonText } from './index';

export const SEMIS_TEXT: Record<string, LessonText> = {
  diode: {
    title: L('Diode: van một chiều', 'The diode: a one-way valve'),
    goal: L('Thấy diode dẫn khi phân cực thuận (sụt áp ≈ 0.7 V) và chặn khi phân cực ngược.', 'See a diode conduct forward (≈ 0.7 V drop) and block in reverse.'),
    theory: L(
      `## Phân cực thuận và ngược
Diode có hai chân: **anode (A)** và **cathode (K)**, cathode là phía có vạch.

- **Thuận** (A dương hơn K): diode dẫn, điện áp trên diode silic chỉ khoảng **0.6 … 0.7 V**.
- **Ngược** (K dương hơn A): diode gần như không dẫn, dòng chỉ cỡ nA.

Luôn mắc một điện trở nối tiếp để giới hạn dòng: $I = \\frac{U - 0.7}{R}$.`,
      `## Forward and reverse bias
A diode has an **anode (A)** and a **cathode (K)**; the cathode is the side with the band.

- **Forward** (A more positive than K): it conducts, and a silicon diode drops only about **0.6 … 0.7 V**.
- **Reverse** (K more positive): it hardly conducts, only nA flow.

Always put a resistor in series to limit the current: $I = \\frac{V - 0.7}{R}$.`,
    ),
    steps: {
      parts: { task: L('Đặt nguồn DC 5 V, điện trở 1 kΩ và một diode (ví dụ 1N4148).', 'Place a 5 V DC source, a 1 kΩ resistor and a diode (e.g. 1N4148).'), hint: L('Nhóm Diode → Diode chuyển mạch → 1N4148.', 'Diodes → Switching diode → 1N4148.') },
      forward: { task: L('Nối nguồn → điện trở → anode; cathode xuống đất (phân cực thuận).', 'Wire source → resistor → anode, cathode to ground (forward bias).'), hint: L('Rê chuột lên chân diode để xem chân nào là A, chân nào là K.', 'Hover a diode pin to see which is A and which is K.') },
      reverse: { task: L('Xoay ngược diode và thấy dòng gần như bằng 0.', 'Turn the diode round and see the current drop to almost 0.'), hint: L('Chọn diode, nhấn R hai lần (xoay 180°).', 'Select the diode and press R twice (rotate 180°).') },
      measure: { task: L('Xoay lại chiều thuận và đo điện áp trên diode bằng đồng hồ (chế độ V).', 'Turn it forward again and measure the diode voltage with the meter (V mode).'), hint: L('Đồng hồ mắc song song với diode; kết quả khoảng 0.6 … 0.7 V.', 'Put the meter across the diode; expect about 0.6 … 0.7 V.') },
    },
    quiz: {
      drop: { q: L('Diode silic dẫn thuận có điện áp khoảng bao nhiêu?', 'About how much does a conducting silicon diode drop?'), options: [L('0.1 V', '0.1 V'), L('0.7 V', '0.7 V'), L('2 V', '2 V'), L('5 V', '5 V')], why: L('Khoảng 0.6 … 0.7 V, gần như không đổi khi dòng thay đổi.', 'About 0.6 … 0.7 V, nearly constant as the current changes.') },
      band: { q: L('Vạch trên thân diode đánh dấu chân nào?', 'Which pin does the band on a diode mark?'), options: [L('Anode', 'The anode'), L('Cathode', 'The cathode'), L('Không có ý nghĩa', 'Nothing')], why: L('Vạch là cathode, đầu nhọn của mũi tên trong ký hiệu.', 'The band is the cathode, the tip of the arrow in the symbol.') },
      reverseCurrent: { q: L('Khi phân cực ngược (dưới điện áp đánh thủng), dòng qua diode…', 'In reverse (below breakdown), the diode current is…'), options: [L('rất nhỏ, gần 0', 'tiny, close to 0'), L('bằng dòng thuận', 'the same as forward'), L('rất lớn', 'very large')], why: L('Diode chặn chiều ngược; chỉ có dòng rò rất nhỏ.', 'The diode blocks the reverse direction; only a tiny leakage flows.') },
    },
  },

  led: {
    title: L('LED và điện trở hạn dòng', 'LED and current-limiting resistor'),
    goal: L('Chọn điện trở để LED sáng với dòng 10 … 20 mA.', 'Choose a resistor so the LED runs at 10 … 20 mA.'),
    theory: L(
      `## LED cần được giới hạn dòng
LED là diode phát sáng. Điện áp thuận $U_F$ của LED đỏ khoảng **1.8 … 2 V** (xanh lá, xanh dương, trắng cao hơn). Độ sáng tăng theo dòng điện, nhưng quá **20 mA** LED nhỏ có thể hỏng.

$$R = \\frac{U - U_F}{I}$$

Ví dụ nguồn 9 V, LED đỏ, 15 mA: $R = (9 - 1.9) / 0.015 ≈ 470$ Ω.`,
      `## An LED needs a current limit
An LED is a light-emitting diode. A red LED drops $V_F$ ≈ **1.8 … 2 V** (green, blue and white more). Brightness grows with current, but a small LED can fail above **20 mA**.

$$R = \\frac{V - V_F}{I}$$

Example: 9 V, red LED, 15 mA: $R = (9 - 1.9) / 0.015 ≈ 470$ Ω.`,
    ),
    steps: {
      parts: { task: L('Đặt nguồn DC 9 V, một LED và một điện trở.', 'Place a 9 V DC source, an LED and a resistor.'), hint: L('Nhóm Diode → LED → LED đỏ.', 'Diodes → LED → LED Red.') },
      current: { task: L('Nối nguồn → điện trở → LED → đất, sao cho dòng LED là 10 … 20 mA.', 'Wire source → resistor → LED → ground so the LED carries 10 … 20 mA.'), hint: L('Anode LED về phía cực +. Thử R = 470 Ω. Khi chạy mô phỏng LED sẽ sáng trên sơ đồ.', 'LED anode towards +. Try R = 470 Ω. While simulating, the LED lights up on the schematic.') },
      ammeter: { task: L('Đo dòng LED bằng đồng hồ ở chế độ A mắc nối tiếp.', 'Measure the LED current with a meter in A mode, in series.'), hint: L('Đồng hồ đo dòng phải nằm trên đường đi của dòng điện.', 'An ammeter has to sit in the current’s path.') },
      twelve: { task: L('Đổi nguồn thành 12 V và chọn lại điện trở để dòng LED vẫn là 10 … 20 mA.', 'Change the source to 12 V and pick a new resistor so the LED still carries 10 … 20 mA.'), hint: L('R = (12 − 1.9) / 0.015 ≈ 680 Ω.', 'R = (12 − 1.9) / 0.015 ≈ 680 Ω.') },
    },
    quiz: {
      formula: { q: L('Công thức tính điện trở hạn dòng cho LED?', 'How do you compute the LED series resistor?'), options: [L('R = (U − UF) / I', 'R = (V − VF) / I'), L('R = U · I', 'R = V · I'), L('R = UF / I', 'R = VF / I')], why: L('Điện trở chịu phần điện áp còn lại U − UF, với dòng I mong muốn.', 'The resistor takes the remaining V − VF at the wanted current I.') },
      vf: { q: L('Điện áp thuận của LED đỏ khoảng?', 'A red LED’s forward voltage is about…'), options: [L('0.3 V', '0.3 V'), L('1.9 V', '1.9 V'), L('5 V', '5 V'), L('12 V', '12 V')], why: L('LED đỏ khoảng 1.8 … 2 V; LED xanh dương / trắng khoảng 3 V.', 'Red LEDs drop about 1.8 … 2 V; blue / white ones about 3 V.') },
      noResistor: { q: L('Nối LED thẳng vào nguồn 9 V không có điện trở thì sao?', 'What happens with an LED straight across 9 V, no resistor?'), options: [L('LED sáng yếu hơn', 'It is dimmer'), L('Không có gì xảy ra', 'Nothing'), L('Dòng rất lớn, LED hỏng', 'A huge current destroys it')], why: L('Không có gì giới hạn dòng: dòng tăng vọt và LED cháy.', 'Nothing limits the current: it soars and the LED burns out.') },
    },
  },

  zener: {
    title: L('Ổn áp bằng diode Zener', 'Zener voltage regulator'),
    goal: L('Dùng diode Zener giữ điện áp ra gần như không đổi khi nguồn và tải thay đổi.', 'Use a Zener diode to hold the output almost constant as the supply and load change.'),
    theory: L(
      `## Zener làm việc ở vùng đánh thủng
Diode Zener được làm để dẫn **ngược** ở một điện áp xác định $U_Z$ (ví dụ 1N4733A: 5.1 V). Mắc **cathode về phía cực +**, có điện trở nối tiếp $R_S$:

$$I_{R_S} = \\frac{U_{vào} - U_Z}{R_S} = I_Z + I_{tải}$$

Khi điện áp vào tăng, dòng Zener tăng nhưng điện áp ra gần như giữ nguyên $U_Z$. $R_S$ phải đủ nhỏ để Zener vẫn dẫn (ít nhất vài mA) khi tải lấy dòng lớn nhất.`,
      `## A Zener works in breakdown
A Zener diode is made to conduct in **reverse** at a defined voltage $V_Z$ (1N4733A: 5.1 V). Connect its **cathode towards +**, with a series resistor $R_S$:

$$I_{R_S} = \\frac{V_{in} - V_Z}{R_S} = I_Z + I_{load}$$

When the input rises the Zener current grows, but the output stays near $V_Z$. $R_S$ must be small enough that the Zener still conducts (a few mA at least) at the largest load current.`,
    ),
    steps: {
      parts: { task: L('Đặt nguồn DC 12 V, điện trở 470 Ω và diode Zener 1N4733A.', 'Place a 12 V DC source, a 470 Ω resistor and a 1N4733A Zener.'), hint: L('Nhóm Diode → Diode Zener; gõ “4733” vào ô tìm.', 'Diodes → Zener diode; type “4733” in the search box.') },
      regulate: { task: L('Nối nguồn → điện trở → cathode Zener; anode xuống đất. Điện áp ra phải gần UZ.', 'Wire source → resistor → Zener cathode, anode to ground. The output must be near VZ.'), hint: L('Zener mắc ngược: cathode (vạch) ở phía trên, nối với điện trở.', 'The Zener sits reversed: cathode (band) at the top, on the resistor.') },
      load: { task: L('Mắc điện trở tải 1 kΩ song song với Zener; Zener vẫn phải dẫn.', 'Add a 1 kΩ load across the Zener; the Zener must keep conducting.'), hint: L('Tải lấy khoảng 5 mA; dòng qua Zener giảm nhưng không về 0.', 'The load takes about 5 mA; the Zener current falls but stays above 0.') },
      line: { task: L('Kiểm tra ổn áp: tăng nguồn 3 V thì điện áp ra chỉ đổi rất ít.', 'Check regulation: 3 V more at the input barely moves the output.'), hint: L('MachSim tự quét nguồn từ giá trị hiện tại lên thêm 3 V và so sánh điện áp ra.', 'MachSim sweeps the source from its value up by 3 V and compares the outputs.') },
    },
    quiz: {
      bias: { q: L('Diode Zener ổn áp được mắc theo chiều nào?', 'How is a regulating Zener connected?'), options: [L('Phân cực thuận', 'Forward biased'), L('Phân cực ngược', 'Reverse biased'), L('Chiều nào cũng được', 'Either way')], why: L('Zener ổn áp ở vùng đánh thủng ngược: cathode về phía điện áp dương.', 'A Zener regulates in reverse breakdown: cathode towards the positive side.') },
      resistor: { q: L('Điện trở nối tiếp RS dùng để làm gì?', 'What is the series resistor RS for?'), options: [L('Giới hạn dòng và nhận phần điện áp chênh lệch', 'To limit the current and take the extra voltage'), L('Tăng điện áp ra', 'To raise the output'), L('Không cần thiết', 'It is not needed')], why: L('RS chịu điện áp Uvào − UZ và giới hạn dòng qua Zener.', 'RS drops Vin − VZ and limits the Zener current.') },
      moreLoad: { q: L('Tải lấy nhiều dòng hơn thì dòng qua Zener…', 'When the load draws more, the Zener current…'), options: [L('tăng', 'rises'), L('không đổi', 'stays the same'), L('giảm', 'falls')], why: L('Dòng qua RS gần như không đổi; tải lấy thêm thì Zener nhận ít đi.', 'The RS current is nearly fixed; what the load takes, the Zener gives up.') },
    },
  },

  rectifier: {
    title: L('Chỉnh lưu và lọc', 'Rectifier and filter'),
    goal: L('Biến điện xoay chiều thành điện một chiều bằng diode, rồi làm phẳng bằng tụ lọc.', 'Turn AC into DC with a diode, then smooth it with a filter capacitor.'),
    theory: L(
      `## Chỉnh lưu nửa chu kỳ
Diode chỉ cho nửa chu kỳ dương đi qua, nên tải nhận các “bướu” điện áp một chiều. Đỉnh ra nhỏ hơn đỉnh vào một sụt áp diode:

$$U_{đỉnh,ra} ≈ U_{đỉnh} - 0.7\\,\\text{V}$$

## Tụ lọc
Tụ song song với tải nạp đến đỉnh rồi xả chậm qua tải. Gợn sóng (đỉnh − đáy) xấp xỉ:

$$\\Delta U ≈ \\frac{U_{đỉnh}}{f \\cdot R \\cdot C}$$

Tụ càng lớn, gợn càng nhỏ. Với chỉnh lưu nửa chu kỳ, gợn có tần số bằng tần số lưới (50 Hz).`,
      `## Half-wave rectifier
The diode passes only the positive half-cycles, so the load gets DC “humps”. The output peak is one diode drop below the input peak:

$$V_{peak,out} ≈ V_{peak} - 0.7\\,\\text{V}$$

## Filter capacitor
A capacitor across the load charges to the peak and discharges slowly into the load. The ripple (peak − valley) is about:

$$\\Delta V ≈ \\frac{V_{peak}}{f \\cdot R \\cdot C}$$

A bigger capacitor gives less ripple. For a half-wave rectifier the ripple has the mains frequency (50 Hz).`,
    ),
    steps: {
      parts: { task: L('Đặt nguồn xoay chiều 10 V đỉnh 50 Hz, diode 1N4007 và điện trở tải 1 kΩ.', 'Place a 10 V peak 50 Hz AC source, a 1N4007 diode and a 1 kΩ load.'), hint: L('Nguồn áp AC: Biên độ = 10, Tần số = 50.', 'AC Voltage Source: Amplitude = 10, Frequency = 50.') },
      halfwave: { task: L('Nối nguồn → diode → tải → đất. Điện áp ra không âm, đỉnh ≈ 9.3 V.', 'Wire source → diode → load → ground. The output never goes negative and peaks at ≈ 9.3 V.'), hint: L('Anode về phía nguồn, cathode về phía tải.', 'Anode on the source side, cathode on the load side.') },
      filter: { task: L('Mắc tụ lọc song song với tải để gợn sóng nhỏ hơn 25 % đỉnh.', 'Add a filter capacitor across the load so the ripple is below 25 % of the peak.'), hint: L('Thử tụ hoá 470 µF (chân + về phía cathode diode).', 'Try a 470 µF electrolytic (+ towards the diode’s cathode).') },
      scope: { task: L('Nối dao động ký vào điện áp ra để xem dạng sóng.', 'Connect an oscilloscope to the output to see the waveform.'), hint: L('Chạy mô phỏng, mở dao động ký, đặt 10 ms/div và 5 V/div.', 'Run, open the scope, set 10 ms/div and 5 V/div.') },
    },
    quiz: {
      peak: { q: L('Nguồn 10 V đỉnh qua một diode silic. Đỉnh điện áp ra khoảng?', 'A 10 V peak through one silicon diode. The output peak is about…'), options: [L('10.7 V', '10.7 V'), L('7.07 V', '7.07 V'), L('9.3 V', '9.3 V')], why: L('Mất một sụt áp diode: 10 − 0.7 = 9.3 V.', 'One diode drop is lost: 10 − 0.7 = 9.3 V.') },
      biggerC: { q: L('Tăng điện dung tụ lọc thì gợn sóng…', 'A bigger filter capacitor makes the ripple…'), options: [L('nhỏ hơn', 'smaller'), L('lớn hơn', 'larger'), L('không đổi', 'unchanged')], why: L('ΔU ≈ Uđỉnh / (f · R · C): C lớn thì gợn nhỏ.', 'ΔV ≈ Vpeak / (f · R · C): a larger C gives less ripple.') },
      rippleFreq: { q: L('Chỉnh lưu cầu (cả chu kỳ) từ lưới 50 Hz cho gợn sóng tần số?', 'A full-wave bridge on 50 Hz mains ripples at…'), options: [L('25 Hz', '25 Hz'), L('100 Hz', '100 Hz'), L('50 Hz', '50 Hz')], why: L('Cả hai nửa chu kỳ đều nạp tụ, nên gợn có tần số gấp đôi: 100 Hz.', 'Both half-cycles charge the capacitor, so the ripple is at twice the frequency: 100 Hz.') },
    },
  },

  'bjt-switch': {
    title: L('Transistor làm khoá', 'The transistor as a switch'),
    goal: L('Dùng một dòng base nhỏ để bật / tắt LED qua transistor NPN.', 'Use a small base current to switch an LED with an NPN transistor.'),
    theory: L(
      `## Bão hoà và ngắt
Transistor NPN có ba chân: **C** (collector), **B** (base), **E** (emitter). Dòng nhỏ vào base cho phép dòng lớn hơn từ C xuống E:

$$I_C ≈ \\beta \\cdot I_B \\quad (\\beta ≈ 100 … 300)$$

Làm **khoá**: cho dòng base đủ lớn ($I_B > I_C / \\beta$) thì transistor **bão hoà**, $U_{CE}$ chỉ còn khoảng 0.1 … 0.2 V, tải (LED) sáng. Không có dòng base thì transistor **ngắt**, LED tắt.

Luôn có **điện trở base** để giới hạn dòng: $I_B = (U_{vào} - 0.7) / R_B$.`,
      `## Saturation and cut-off
An NPN transistor has three pins: **C** (collector), **B** (base), **E** (emitter). A small base current lets a larger current flow from C to E:

$$I_C ≈ \\beta \\cdot I_B \\quad (\\beta ≈ 100 … 300)$$

As a **switch**: with enough base current ($I_B > I_C / \\beta$) the transistor **saturates**, $V_{CE}$ is only about 0.1 … 0.2 V and the load (LED) is on. With no base current it is **cut off** and the LED is dark.

Always use a **base resistor** to limit the current: $I_B = (V_{in} - 0.7) / R_B$.`,
    ),
    steps: {
      parts: { task: L('Đặt transistor NPN 2N3904, LED và các điện trở (RB 1 kΩ, RC 470 Ω).', 'Place a 2N3904 NPN transistor, an LED and the resistors (RB 1 kΩ, RC 470 Ω).'), hint: L('Nhóm Transistor → NPN BJT → 2N3904.', 'Transistors → NPN BJT → 2N3904.') },
      emitter: { task: L('Nối chân E của transistor xuống đất.', 'Connect the transistor’s E pin to ground.'), hint: L('Rê chuột lên các chân để xem tên C, B, E.', 'Hover the pins to see C, B and E.') },
      on: { task: L('Nguồn 9 V → RC → LED → chân C; nguồn vào 5 V → RB → chân B. LED phải sáng và transistor bão hoà.', '9 V → RC → LED → C; a 5 V input → RB → B. The LED must light and the transistor saturate.'), hint: L('Hai nguồn dùng chung đất. VCE < 0.3 V nghĩa là khoá đã đóng hẳn.', 'Both sources share ground. VCE below 0.3 V means the switch is fully on.') },
      off: { task: L('Đặt nguồn vào bằng 0 V: transistor ngắt, LED tắt.', 'Set the input source to 0 V: the transistor cuts off and the LED goes dark.'), hint: L('Nhấp đúp vào nguồn vào và gõ 0.', 'Double-click the input source and type 0.') },
    },
    quiz: {
      vceSat: { q: L('Khi transistor bão hoà, VCE khoảng?', 'In saturation, VCE is about…'), options: [L('0.1 … 0.2 V', '0.1 … 0.2 V'), L('0.7 V', '0.7 V'), L('bằng điện áp nguồn', 'the supply voltage')], why: L('Bão hoà: transistor như một công tắc đóng, chỉ còn vài trăm mV.', 'Saturated, the transistor acts like a closed switch with a few hundred mV left.') },
      baseCurrent: { q: L('IC = 15 mA, β = 100. Dòng base tối thiểu để bão hoà?', 'IC = 15 mA, β = 100. The minimum base current to saturate?'), options: [L('1.5 A', '1.5 A'), L('0.15 mA', '0.15 mA'), L('15 mA', '15 mA')], why: L('IB = IC / β = 15 mA / 100 = 0.15 mA; thường cho dư vài lần cho chắc.', 'IB = IC / β = 15 mA / 100 = 0.15 mA; designers give a few times more to be sure.') },
      emitter: { q: L('Trong ký hiệu NPN, mũi tên nằm ở chân nào?', 'In the NPN symbol, the arrow is on which pin?'), options: [L('Base', 'Base'), L('Collector', 'Collector'), L('Emitter', 'Emitter')], why: L('Mũi tên ở emitter, chỉ chiều dòng điện ra khỏi transistor NPN.', 'The arrow is on the emitter, pointing the way current leaves an NPN.') },
    },
  },

  'ce-amp': {
    title: L('Khuếch đại E chung', 'Common-emitter amplifier'),
    goal: L('Kiểm tra điểm làm việc, thêm tụ thoát emitter và đo hệ số khuếch đại.', 'Check the bias point, add an emitter bypass capacitor and measure the gain.'),
    theory: L(
      `## Phân cực và khuếch đại
Mạch mẫu dùng cầu chia R1 / R2 để đặt điện áp base, RE để ổn định dòng emitter, RC làm tải. Transistor phải ở **vùng khuếch đại**: $U_{CE}$ khoảng giữa 0 và $U_{CC}$.

Không có tụ thoát, hệ số khuếch đại gần bằng:

$$A_v ≈ -\\frac{R_C \\parallel R_L}{R_E}$$

Có tụ thoát $C_E$ song song với $R_E$, ở tín hiệu xoay chiều emitter như nối đất:

$$A_v ≈ -\\frac{R_C \\parallel R_L}{r_e}, \\quad r_e ≈ \\frac{26\\,\\text{mV}}{I_E}$$

Dấu trừ: tín hiệu ra **ngược pha** với tín hiệu vào.`,
      `## Bias and gain
The starter circuit sets the base voltage with the R1 / R2 divider, stabilises the emitter current with RE and uses RC as the load. The transistor must be in the **active region**: $V_{CE}$ somewhere between 0 and $V_{CC}$.

Without a bypass capacitor the gain is about:

$$A_v ≈ -\\frac{R_C \\parallel R_L}{R_E}$$

With a bypass $C_E$ across $R_E$, the emitter is at AC ground:

$$A_v ≈ -\\frac{R_C \\parallel R_L}{r_e}, \\quad r_e ≈ \\frac{26\\,\\text{mV}}{I_E}$$

The minus sign: the output is **inverted** with respect to the input.`,
    ),
    steps: {
      bias: { task: L('Đo VCE bằng đồng hồ (chế độ V) mắc giữa chân C và E: phải trong khoảng 2 … 10 V.', 'Measure VCE with the meter (V mode) between C and E: it must be 2 … 10 V.'), hint: L('Có thể đặt nhãn net lên chân C và E rồi đặt nhãn cùng tên lên hai cực đồng hồ.', 'You can put net labels on C and E and the same names on the meter terminals.') },
      bypass: { task: L('Mắc tụ thoát (ít nhất 10 µF, ví dụ 100 µF) song song với RE.', 'Add a bypass capacitor (at least 10 µF, e.g. 100 µF) across RE.'), hint: L('Chân + của tụ hoá về phía emitter, chân − xuống đất.', 'Electrolytic + towards the emitter, − to ground.') },
      gain: { task: L('Kiểm tra: hệ số khuếch đại ở 1 kHz lớn hơn 30 lần.', 'Check: the gain at 1 kHz is above 30.'), hint: L('MachSim chạy phân tích AC giữa nhãn IN và OUT. Thử bỏ tụ thoát để thấy độ lợi giảm còn khoảng 3.', 'MachSim runs an AC analysis between the IN and OUT labels. Remove the bypass to see the gain fall to about 3.') },
      scope: { task: L('Nối dao động ký: kênh A vào IN, kênh B vào OUT, và so sánh hai dạng sóng.', 'Connect a scope: channel A to IN, channel B to OUT, and compare the waves.'), hint: L('Đặt kênh A 10 mV/div, kênh B 1 V/div; tín hiệu ra ngược pha.', 'Set A to 10 mV/div and B to 1 V/div; the output is inverted.') },
    },
    quiz: {
      phase: { q: L('Tín hiệu ra của tầng E chung so với tín hiệu vào?', 'The common-emitter output compared with its input is…'), options: [L('cùng pha', 'in phase'), L('ngược pha 180°', 'inverted (180°)'), L('lệch 90°', 'shifted 90°')], why: L('Dòng collector tăng làm điện áp collector giảm: ngược pha.', 'More collector current lowers the collector voltage: inverted.') },
      bypass: { q: L('Tụ thoát song song RE làm hệ số khuếch đại…', 'A bypass capacitor across RE makes the gain…'), options: [L('tăng mạnh', 'much higher'), L('giảm', 'lower'), L('không đổi', 'unchanged')], why: L('Ở tần số tín hiệu RE bị ngắn mạch, chỉ còn re nhỏ: độ lợi tăng nhiều lần.', 'At signal frequencies RE is shorted, leaving only the small re: the gain rises many times.') },
      active: { q: L('VCC = 12 V. Giá trị VCE nào cho thấy transistor ở vùng khuếch đại?', 'VCC = 12 V. Which VCE shows the active region?'), options: [L('0.1 V', '0.1 V'), L('12 V', '12 V'), L('5 V', '5 V'), L('0 V', '0 V')], why: L('VCE ở khoảng giữa (≈ 5 V) để tín hiệu có thể dao động cả lên và xuống.', 'VCE near the middle (≈ 5 V) leaves room for the signal to swing both ways.') },
    },
  },
};
