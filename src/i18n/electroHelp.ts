/**
 * Help texts of the round-4 sound and electromechanical parts: the two guide pages (relay control
 * circuits, listening to a circuit), the "What is this?" pages of the new families and the F1 page
 * of the parts that need more than their family page. Merged into GUIDE_PAGES (helpGuides.ts),
 * FAMILY_HELP (catalogHelp.ts) and PART_HELP (partHelp.ts); loaded with the help dialog. Original text.
 */
import { L } from './core';
import type { HelpEntry } from './help';
import type { GuidePage } from './helpGuides';

export const ELECTRO_GUIDE_PAGES: Record<'relays' | 'audio', GuidePage> = {
  relays: {
    title: L('Mạch điều khiển bằng rơ-le và công-tắc-tơ', 'Relay and contactor control circuits'),
    sections: [
      {
        heading: L('Cuộn hút và tiếp điểm là hai linh kiện riêng', 'The coil and its contacts are separate parts'),
        body: L(
          'Trong sơ đồ điều khiển, cuộn hút vẽ ở một chỗ còn tiếp điểm của nó nằm khắp nơi mạch cần, thường ở trang khác. MachSim làm đúng như vậy: đặt MỘT cuộn (nhóm Cơ điện › Cuộn rơ-le, Cuộn công-tắc-tơ, Cuộn rơ-le thời gian) rồi đặt bao nhiêu tiếp điểm cũng được (Tiếp điểm rơ-le thường hở / thường đóng / chuyển mạch, tiếp điểm chính 3 cực, khối tiếp điểm phụ, tiếp điểm thời gian, tiếp điểm rơ-le nhiệt). Mỗi tiếp điểm có ô **Cuộn hút** trong Thuộc tính: gõ ký hiệu của cuộn (K1, KM1, KT1, FR1). Cuộn có điện thì mọi tiếp điểm mang tên nó đổi trạng thái — kể cả tiếp điểm ở trang khác của cùng thiết kế. Nếu tên không khớp cuộn nào, ERC cảnh báo “không có cuộn hút” và tiếp điểm giữ vị trí nghỉ.',
          'In a control diagram the coil is drawn in one place and its contacts wherever the circuit needs them, often on another sheet. MachSim does the same: place ONE coil (group Electromechanical › Relay coil, Contactor coil, Timer coil) and as many contacts as you like (Relay contact NO / NC / changeover, 3-pole main contacts, supplementary contact block, timer contacts, overload contacts). Every contact has a **Coil** field in Properties: type the designator of the coil (K1, KM1, KT1, FR1). When the coil is energised, every contact carrying its name changes state — also contacts on another sheet of the same design. If the name matches no coil, ERC warns “there is no coil” and the contact stays in its rest position.',
        ),
      },
      {
        heading: L('Mạch mở – dừng có tự giữ', 'A start-stop circuit with a holding contact'),
        body: L(
          'Mạch kinh điển: nguồn 24 V → nút Dừng (thường đóng) → nút Mở (thường hở) song song với tiếp điểm phụ thường hở của chính công-tắc-tơ → tiếp điểm thường đóng 95-96 của rơ-le nhiệt → cuộn KM1 → đất. Nhấn Mở: cuộn có điện, tiếp điểm phụ KM1 đóng lại và “giữ” cuộn dù thả nút. Nhấn Dừng hoặc rơ-le nhiệt tác động thì cuộn mất điện và mọi thứ nhả. Mở ví dụ “Khởi động từ có tự giữ và rơ-le nhiệt” để thử.',
          'The classic circuit: 24 V supply → Stop button (normally closed) → Start button (normally open) in parallel with the normally open auxiliary contact of the contactor itself → the normally closed 95-96 contact of the overload relay → coil KM1 → ground. Press Start: the coil is energised, the auxiliary contact KM1 closes and “holds” the coil although you release the button. Pressing Stop, or the overload relay tripping, drops the coil and everything releases. Open the example “Start-stop contactor with holding contact and overload” to try it.',
        ),
      },
      {
        heading: L('Rơ-le thời gian', 'Time-delay relays'),
        body: L(
          'Cuộn rơ-le thời gian có tham số **Thời gian trễ**. Loại trễ đóng: tiếp điểm chỉ đổi trạng thái sau thời gian trễ kể từ lúc cấp điện, và trở lại ngay khi mất điện (cấp điện ngắn hơn thời gian trễ thì không có gì xảy ra). Loại trễ mở: tiếp điểm đổi ngay khi cấp điện và chỉ trở lại sau thời gian trễ kể từ lúc mất điện. Dùng tiếp điểm thời gian (ghi KT1 vào ô Cuộn hút) để làm mạch khởi động sao – tam giác, đèn cầu thang, quạt chạy thêm sau khi tắt.',
          'A timer coil has the parameter **Delay time**. On-delay: the contact changes only the delay time after the coil is energised and returns at once when it is released (a shorter pulse does nothing). Off-delay: the contact changes at once when the coil is energised and returns only the delay time after it is released. Use the timer contacts (type KT1 in the Coil field) for star-delta starting, stair lights and fans that run on after switch-off.',
        ),
      },
      {
        heading: L('Rơ-le nhiệt, cầu chì và áp-tô-mát', 'Overload relay, fuse and circuit breaker'),
        body: L(
          'Rơ-le nhiệt (FR) đặt nối tiếp với động cơ: lưỡng kim nóng lên theo I²/Ir², không tác động ở 1.05 × dòng đặt, tác động ở 1.2 × dòng đặt, và nhanh hơn nhiều khi dòng lớn (cấp 10: 7 giây ở 7.2 × Ir). Tác động được giữ cho tới khi Reset (phím R). Cầu chì theo I²t chảy khi năng lượng I²·t vượt giá trị đặt (thời gian chảy ≈ I²t / I²); áp-tô-mát chọn được đường cong B, C, D, K, Z: cắt nhiệt khi quá tải kéo dài, cắt từ trong vài mili-giây khi ngắn mạch. Bảng Thuộc tính vẽ đường cong thời gian – dòng điện của chúng.',
          'The thermal overload relay (FR) goes in series with the motor: the bimetal heats with I²/Ir², does not trip at 1.05 × the setting, trips at 1.2 × the setting, and much faster at larger currents (class 10: 7 s at 7.2 × Ir). The trip latches until Reset (key R). The I²t fuse blows when the energy I²·t passes its rating (melting time ≈ I²t / I²); the circuit breaker has a selectable B, C, D, K or Z curve: thermal trip on a sustained overload, magnetic trip in a few milliseconds on a short circuit. The Properties panel draws their time–current curves.',
        ),
      },
      {
        heading: L('Biến áp nguồn và pin thật', 'Mains transformers and real batteries'),
        body: L(
          'Biến áp nguồn (Cơ điện › Biến áp nguồn) đọc như bảng thông số: điện áp sơ cấp, điện áp thứ cấp KHI ĐẦY TẢI, công suất VA, độ lệch điện áp và dòng không tải. Không tải, điện áp thứ cấp cao hơn danh định đúng bằng độ lệch (12 V ra 13.4 V với 12 %). Pin không lý tưởng (Nguồn › Pin) tụt áp khi tải kéo dòng và cạn dần: mức điện tích là nút V(<ký hiệu>.soc) từ 1 xuống 0, nên bạn vẽ được đường cong xả bằng Grapher.',
          'The mains transformer (Electromechanical › Line transformer) reads like a data sheet: primary voltage, secondary voltage AT RATED LOAD, VA rating, regulation and no-load current. Unloaded, the secondary voltage rises above the nominal by exactly the regulation (12 V reads 13.4 V at 12 %). The non-ideal battery (Sources › Battery) sags when the load draws current and runs down: the state of charge is the node V(<refdes>.soc) going from 1 to 0, so you can plot the discharge curve in the Grapher.',
        ),
      },
    ],
  },
  audio: {
    title: L('Nghe mạch của bạn: loa, micrô và tệp WAV', 'Listening to your circuit: speaker, microphone and WAV files'),
    sections: [
      {
        heading: L('Loa và tai nghe', 'Speaker and headphones'),
        body: L(
          'Đặt Loa (Chỉ thị › Loa) hoặc Tai nghe lên nút cần nghe rồi chạy mô phỏng (Mô phỏng › Chạy). Điện áp trên loa được lấy mẫu lại theo thời gian thực và phát ra card âm thanh. Cửa sổ **Mô phỏng › Âm thanh** có âm lượng chung, nút tắt tiếng và vạch mức; mỗi loa có thêm âm lượng, “Điện áp đầy thang” (điện áp phát to nhất, lớn hơn thì bị xén) và phím M để tắt tiếng. Mặc định 5 V cho loa và 1 V cho tai nghe.',
          'Put the Speaker (Indicators › Speaker) or Headphones on the node you want to hear and run the simulation (Simulate › Run). The voltage across the speaker is resampled in real time and played through the sound card. The **Simulate › Audio** window has a master volume, a mute button and a level bar; each speaker also has a volume, a “Full-scale voltage” (the voltage that plays at full scale; larger signals clip) and key M to mute it. The defaults are 5 V for the speaker and 1 V for the headphones.',
        ),
      },
      {
        heading: L('Khi mạch chạy chậm hơn thời gian thực', 'When the circuit runs slower than real time'),
        body: L(
          'Mạch phức tạp hoặc bước thời gian nhỏ có thể mô phỏng chậm hơn thời gian thực. Khi đó âm thanh được KÉO GIÃN: phát chậm lại cho khớp với tốc độ mô phỏng (tiếng trầm đi) thay vì ngắt quãng, và cửa sổ Âm thanh hiện “Mô phỏng chậm hơn thời gian thực: âm thanh phát ×0.4”. Muốn nghe đúng cao độ: tăng bước thời gian, bớt linh kiện, hoặc dùng loa với tín hiệu đơn giản. Tốc độ mô phỏng khác 1× (Mô phỏng › Thiết lập tương tác) không đổi cao độ: phần dư nhanh hơn thời gian thực bị bỏ.',
          'A complex circuit or a small time step can simulate slower than real time. The sound is then STRETCHED: it plays slower to match the simulation (lower in pitch) instead of breaking up, and the Audio window shows “Simulation slower than real time: sound plays at ×0.4”. For the true pitch: raise the time step, remove parts, or use the speaker with a simple signal. A simulation speed other than 1× (Simulate › Interactive settings) does not change the pitch: what runs faster than real time is skipped.',
        ),
      },
      {
        heading: L('Micrô', 'Microphone'),
        body: L(
          'Nguồn **Micrô** đưa tiếng nói của bạn vào mạch khi chạy mô phỏng tương tác. Lần đầu trình duyệt hỏi quyền dùng micrô — chọn Cho phép. Cửa sổ Âm thanh hiện vạch mức vào. Nếu bạn từ chối hoặc máy không có micrô, MachSim phát một sóng thử (440 Hz) thay thế và nói rõ điều đó. Chọn “Âm thử” ở tham số Nguồn tín hiệu nếu muốn luôn dùng sóng thử, kể cả khi chạy phân tích một lần. Thử: Micrô → bộ khuếch đại → Loa (cẩn thận tiếng hú nếu loa gần micrô thật).',
          'The **Microphone** source feeds your voice into the circuit while an interactive simulation runs. The first time the browser asks for permission to use the microphone — choose Allow. The Audio window shows an input level bar. If you refuse, or the machine has no microphone, MachSim plays a test tone (440 Hz) instead and says so. Choose “Test tone” in the Signal source parameter to always use the tone, also in one-shot analyses. Try: Microphone → amplifier → Speaker (beware of howling if the speaker is near a real microphone).',
        ),
      },
      {
        heading: L('Tệp WAV: phát vào mạch và xuất ra', 'WAV files: into the circuit and out of it'),
        body: L(
          'Nguồn áp / dòng **tệp WAV** phát một tệp .wav thành điện áp: nhấn “Mở tệp WAV…” trong Thuộc tính (tệp được đổi thành 16-bit đơn kênh, tối đa 30 giây), đặt biên độ cho mức đầy thang. Để trống thì phát xung 1 kHz dài 20 ms có sẵn. Ngược lại, trong Grapher nhấn **Xuất WAV…** để lưu bất kỳ đường nào thành tệp .wav (lấy mẫu lại đều theo tần số bạn chọn, có thể chuẩn hoá mức) rồi nghe bằng chương trình khác. Nguồn **tệp đo lường** phát một kênh của tệp LVM dạng văn bản / CSV, có tỉ lệ thời gian.',
          'The **WAV file** voltage / current source plays a .wav file as a voltage: press “Open WAV file…” in Properties (the file becomes 16-bit mono, at most 30 seconds) and set the amplitude of full scale. Empty plays the built-in 20 ms burst of 1 kHz. The other way round, in the Grapher press **Export WAV…** to save any trace as a .wav file (resampled evenly at the rate you choose, with optional level normalisation) and listen to it in another program. The **Measurement file** source plays one channel of an LVM text / CSV file, with time scaling.',
        ),
      },
    ],
  },
};

const speakerHelp = (stereo: boolean): HelpEntry => ({
  what: L(
    stereo ? 'Tai nghe âm thanh nổi: hai kênh L và R cùng một chân chung COM, mỗi kênh là một cuộn loa.' : 'Loa: cuộn dây loa (điện trở nối tiếp với một chút điện cảm) mà điện áp trên nó được phát ra card âm thanh khi mô phỏng.',
    stereo ? 'Stereo headphones: two channels L and R with one common pin COM, each a speaker coil.' : 'Speaker: the voice coil (a resistance in series with a little inductance) whose voltage is played through the sound card during the simulation.',
  ),
  use: L('Nghe một nút của mạch: dao động 555, bộ khuếch đại âm tần, bộ lọc, tiếng đàn tổng hợp từ nguồn sin.', 'Listen to a node of a circuit: a 555 oscillator, an audio amplifier, a filter, a tone built from sine sources.'),
  read: L(
    'Điện áp bằng “Điện áp đầy thang” (ở âm lượng 100 %) là to nhất; lớn hơn thì bị xén. Trở kháng 8 Ω nghĩa là mạch thấy khoảng 6.4 Ω một chiều cộng cảm kháng — loa là tải nặng với mạch khuếch đại nhỏ. Phím M tắt tiếng.',
    'A voltage equal to the “Full-scale voltage” (at 100 % volume) is the loudest; larger signals clip. An 8 Ω impedance means the circuit sees about 6.4 Ω of DC resistance plus the reactance — a speaker is a heavy load for a small amplifier. Key M mutes.',
  ),
  tip: L('Không nghe thấy gì? Mở Mô phỏng › Âm thanh: kiểm tra âm lượng chung, nút tắt tiếng và vạch mức. Tín hiệu một chiều thì không nghe được — loa chỉ phát phần biến thiên.', 'Hearing nothing? Open Simulate › Audio: check the master volume, the mute button and the level bar. A DC signal is silent — the speaker only plays what changes.'),
});

export const ELECTRO_FAMILY_HELP: Record<string, HelpEntry> = {
  Speaker: speakerHelp(false),
  'Audio sources': {
    what: L('Nguồn âm thanh: Micrô (tiếng từ thiết bị thu âm của máy) và nguồn tệp WAV (phát một tệp .wav thành điện áp hoặc dòng điện).', 'Audio sources: the Microphone (sound from the machine’s input device) and the WAV file source (plays a .wav file as a voltage or a current).'),
    use: L('Đưa tiếng nói hoặc nhạc thật vào bộ lọc, bộ khuếch đại, bộ méo để nghe và đo tác dụng của mạch.', 'Feed real speech or music into a filter, amplifier or distortion stage to hear and measure what the circuit does.'),
    read: L('Micrô chỉ hoạt động khi chạy mô phỏng tương tác (trình duyệt hỏi quyền micrô). Nguồn WAV là nguồn PWL nên phân tích nào cũng thấy.', 'The microphone only works while an interactive simulation runs (the browser asks for microphone permission). The WAV source is a PWL source, so every analysis sees it.'),
    tip: L('Tệp WAV dài làm mô phỏng nặng (mỗi mẫu là một điểm thời gian). Giữ vài giây ở 8 kHz là đủ để học.', 'A long WAV file makes the simulation heavy (every sample is a time point). A few seconds at 8 kHz are plenty for learning.'),
  },
  'Relay coil': {
    what: L('Cuộn hút của rơ-le tách riêng khỏi tiếp điểm. Đây là phần “nam châm điện”: có dòng đủ lớn thì hút, mọi tiếp điểm mang tên cuộn đổi trạng thái.', 'The coil of a relay, separate from its contacts. It is the “electromagnet”: with enough current it pulls in, and every contact carrying the coil’s name changes state.'),
    use: L('Vẽ mạch điều khiển như trong bản vẽ điện thật: cuộn ở mạch điều khiển, tiếp điểm ở mạch lực hoặc ở trang khác.', 'Draw control circuits like a real electrical drawing: the coil in the control circuit, the contacts in the power circuit or on another sheet.'),
    read: L('Hút ở 75 % và nhả ở 10 % dòng danh định, nên có độ trễ (vùng nhớ) như rơ-le thật. Cuộn AC dùng giá trị VA; dòng được chỉnh lưu và lấy trung bình nên không rung.', 'It pulls in at 75 % and drops out at 10 % of the nominal current, so it has the hysteresis of a real relay. AC coils use a VA rating; the current is rectified and averaged so it does not chatter.'),
    tip: L('Cuộn rơ-le là tải cảm: khi ngắt dòng nó sinh xung điện áp ngược. Mắc diode dập xung song song với cuộn DC.', 'A relay coil is an inductive load: breaking its current makes a voltage spike. Put a flyback diode across a DC coil.'),
  },
  'Contactor coil': {
    what: L('Cuộn hút của công-tắc-tơ (ký hiệu KM): cùng mô hình với cuộn rơ-le nhưng công suất lớn hơn.', 'The coil of a contactor (designator KM): the same model as a relay coil but with a larger rating.'),
    use: L('Điều khiển tiếp điểm chính 3 cực và tiếp điểm phụ của một động cơ.', 'Operate the 3-pole main contacts and the auxiliary contacts of a motor.'),
  },
  'Timer coil': {
    what: L('Cuộn của rơ-le thời gian (ký hiệu KT): trễ đóng hoặc trễ mở sau một khoảng thời gian đặt được.', 'The coil of a time-delay relay (designator KT): on-delay or off-delay by a settable time.'),
    use: L('Trễ khởi động sao – tam giác, đèn cầu thang, quạt chạy thêm sau khi tắt.', 'Star-delta starting delay, stair lights, fans that run on after switch-off.'),
    read: L('Tiếp điểm thời gian (ô Cuộn hút = KT1) đổi trạng thái đúng sau thời gian trễ. Với trễ đóng, cấp điện ngắn hơn thời gian trễ thì không có tác dụng.', 'The timer contact (Coil field = KT1) changes state exactly after the delay. With an on-delay a pulse shorter than the delay does nothing.'),
  },
  'Relay contact': {
    what: L('Tiếp điểm của rơ-le: thường hở, thường đóng hoặc chuyển mạch. Nó không có cuộn riêng mà theo cuộn có ký hiệu ghi ở ô Cuộn hút.', 'A relay contact: normally open, normally closed or changeover. It has no coil of its own but follows the coil whose designator is in the Coil field.'),
    use: L('Đóng cắt tải, tự giữ, khoá chéo thuận – nghịch, đưa tín hiệu sang trang khác của sơ đồ.', 'Switch a load, hold a coil in, interlock forward and reverse, hand a signal to another sheet of the schematic.'),
    read: L('Điện trở khi đóng 50 mΩ, khi mở 1 GΩ (đổi được ở thẻ Nâng cao). Nếu tên cuộn sai, ERC báo và tiếp điểm giữ vị trí nghỉ.', 'On resistance 50 mΩ, off resistance 1 GΩ (changeable on the Advanced tab). If the coil name is wrong ERC says so and the contact stays at rest.'),
    tip: L('Tên cuộn không phân biệt chữ hoa thường; bạn có thể gõ k1.', 'The coil name is case-insensitive; you may type k1.'),
  },
  'Timer contact': {
    what: L('Tiếp điểm của rơ-le thời gian: theo cuộn thời gian (KT) mà nó gọi tên, đổi trạng thái sau hoặc khi hết thời gian trễ.', 'A time-delay relay contact: it follows the timer coil (KT) it names and changes state after, or when, the delay has run.'),
    use: L('Xem hướng dẫn “Mạch điều khiển bằng rơ-le”.', 'See the guide “Relay and contactor control circuits”.'),
  },
  'Contactor contact': {
    what: L('Tiếp điểm của công-tắc-tơ: ba cực chính cho động cơ (L1-T1, L2-T2, L3-T3) và tiếp điểm phụ thường hở 13-14 / thường đóng 21-22.', 'Contactor contacts: three main poles for a motor (L1-T1, L2-T2, L3-T3) and auxiliary contacts, normally open 13-14 / normally closed 21-22.'),
    use: L('Cấp điện cho động cơ ba pha; tiếp điểm phụ 13-14 làm tiếp điểm tự giữ trong mạch mở – dừng.', 'Power a three-phase motor; the auxiliary contact 13-14 is the holding contact of a start-stop circuit.'),
  },
  'Supplementary contact': {
    what: L('Khối tiếp điểm phụ gắn thêm vào công-tắc-tơ: hai thường hở và hai thường đóng cùng theo một cuộn.', 'A supplementary contact block added to a contactor: two normally open and two normally closed contacts following one coil.'),
    use: L('Cần thêm tiếp điểm cho đèn báo, khoá chéo hoặc PLC mà không đụng tới mạch chính.', 'When you need more contacts for pilot lamps, interlocks or a PLC without touching the main circuit.'),
  },
  'Overload contact': {
    what: L('Tiếp điểm báo của rơ-le nhiệt: 95-96 thường đóng (mở khi rơ-le tác động), 97-98 thường hở (đóng khi rơ-le tác động).', 'The signal contacts of a thermal overload relay: 95-96 normally closed (opens when the relay trips), 97-98 normally open (closes when it trips).'),
    use: L('Mắc 95-96 nối tiếp với cuộn công-tắc-tơ để động cơ tự dừng khi quá tải; dùng 97-98 bật đèn báo sự cố.', 'Put 95-96 in series with the contactor coil so the motor stops by itself on overload; use 97-98 for a fault lamp.'),
  },
  'Overload relay': {
    what: L('Rơ-le nhiệt bảo vệ động cơ: mắc nối tiếp trên dây động cơ, nóng lên theo bình phương dòng điện và tác động khi nóng quá.', 'A thermal overload relay protecting a motor: in series with the motor leads, it heats with the square of the current and trips when it is too hot.'),
    use: L('Chống quá tải kéo dài của động cơ mà không cắt khi dòng khởi động ngắn.', 'Protect against a long overload of a motor without tripping on the short starting current.'),
    read: L('Không tác động ở 1.05 × dòng đặt, tác động ở 1.2 ×. Cấp 10: 7 giây ở 7.2 × dòng đặt; cấp 20: 13 giây; cấp 30: 20 giây. Bảng Thuộc tính vẽ đường cong thời gian – dòng điện.', 'No trip at 1.05 × the setting, trip at 1.2 ×. Class 10: 7 s at 7.2 × the setting; class 20: 13 s; class 30: 20 s. The Properties panel draws the time–current curve.'),
    tip: L('Muốn thử lại sau khi tác động, nhấn phím R (Reset) khi đang mô phỏng.', 'To try again after a trip, press R (Reset) while the simulation runs.'),
  },
  'Motor starter': {
    what: L('Khởi động từ trực tiếp (DOL) trong một linh kiện: công-tắc-tơ + rơ-le nhiệt ba cực.', 'A direct-on-line (DOL) starter in one part: a contactor plus a three-pole thermal overload relay.'),
    use: L('Khởi động động cơ ba pha bằng nút Mở / Dừng; khi quá tải, tiếp điểm 95-96 mở và (nếu mắc nối tiếp với cuộn) nhả công-tắc-tơ.', 'Start a three-phase motor with Start / Stop buttons; on overload the 95-96 contact opens and (if it is in series with the coil) drops the contactor.'),
  },
  'Line transformer': {
    what: L('Biến áp nguồn (biến áp lưới) hạ áp từ điện lưới, mô tả như bảng thông số của nhà sản xuất: điện áp, công suất VA, độ lệch điện áp và dòng không tải.', 'A mains (line) step-down transformer described like a manufacturer’s data sheet: voltages, VA rating, regulation and no-load current.'),
    use: L('Cấp nguồn thấp áp cho mạch chỉnh lưu – lọc – ổn áp, xem điện áp sụt khi tải nặng.', 'Power a rectifier – filter – regulator from the mains and see the voltage sag under heavy load.'),
    read: L('Thứ cấp ghi “điện áp khi đầy tải”: không tải nó cao hơn đúng bằng độ lệch (12 V, 12 % → 13.4 V). Máy nhỏ có độ lệch lớn (5 VA ≈ 25 %), máy lớn nhỏ hơn (1 kVA ≈ 5 %). Dòng không tải là phần dòng sơ cấp khi thứ cấp để hở.', 'The secondary voltage is the voltage AT RATED LOAD: unloaded it is higher by the regulation (12 V, 12 % → 13.4 V). Small units have a large regulation (5 VA ≈ 25 %), large ones less (1 kVA ≈ 5 %). The no-load current is the primary current with the secondary open.'),
    tip: L('Dùng phân tích AC một tần số 50 Hz để đọc điện áp hiệu dụng; nhớ đặt biên độ nguồn AC = 230·√2 cho đỉnh.', 'Use a single-frequency AC analysis at 50 Hz to read RMS voltages; set the AC source to 230·√2 for the peak.'),
  },
  'Magnetic sources': {
    what: L('Nguồn từ thông: từ thông Φ (Wb) xuyên qua cuộn N vòng sinh sức điện động cảm ứng e = N·dΦ/dt (định luật Faraday).', 'Magnetic flux sources: a flux Φ (Wb) through a coil of N turns induces the EMF e = N·dΦ/dt (Faraday’s law).'),
    use: L('Mô hình hoá nam châm quay trong máy phát, cuộn đo từ thông, hay kích thích một cuộn dây bằng từ thông cho trước.', 'Model a magnet turning in a generator, a flux-sensing search coil, or excite a winding with a given flux.'),
    read: L('Từ thông không đổi thì không cảm ứng gì; chỉ khi nó thay đổi mới có điện áp. Từ thông là nút V(<ký hiệu>.phi) nên vẽ được trong Grapher.', 'A constant flux induces nothing; the voltage appears only while it changes. The flux is the node V(<refdes>.phi) so you can plot it in the Grapher.'),
    tip: L('Sóng sin đỉnh Φm tần số f cho điện áp đỉnh N·2πf·Φm: 100 vòng, 1 mWb, 50 Hz → 31.4 V.', 'A sine of peak Φm at frequency f gives a peak voltage N·2πf·Φm: 100 turns, 1 mWb, 50 Hz → 31.4 V.'),
  },
  Batteries: {
    what: L('Pin không lý tưởng: có mức điện tích, điện trở trong tăng khi pin cạn, và đường cong xả riêng cho từng loại (kiềm, NiMH, Li-ion, axit–chì).', 'Non-ideal batteries: they have a state of charge, an internal resistance that rises as they empty, and a discharge curve per chemistry (alkaline, NiMH, Li-ion, lead-acid).'),
    use: L('Tính thời gian chạy của mạch dùng pin, xem điện áp tụt khi pin yếu, chọn loại pin hợp với tải.', 'Work out how long a battery-powered circuit runs, see the voltage fall as the battery weakens, choose the right chemistry for a load.'),
    read: L('Pin C Ah cấp dòng I không đổi thì hết sau C·3600 / I giây. Mức điện tích là nút V(<ký hiệu>.soc) (1 = đầy, 0 = hết). Điện áp ra = điện áp hở mạch theo mức điện tích − điện trở trong × dòng.', 'A battery of C Ah delivering a constant I is empty after C·3600 / I seconds. The state of charge is the node V(<refdes>.soc) (1 = full, 0 = empty). Output voltage = open-circuit voltage at that charge − internal resistance × current.'),
    tip: L('Muốn mô phỏng nhanh cả giờ pin chạy, đặt dung lượng nhỏ (ví dụ 5 mAh) rồi nhân thời gian lên.', 'To simulate a whole hour of discharge quickly, use a small capacity (for example 5 mAh) and scale the time up.'),
  },
  'Measurement file sources': {
    what: L('Nguồn phát lại một kênh của tệp đo lường (văn bản LVM, CSV, TSV) thành điện áp hoặc dòng điện.', 'Sources that play back one channel of a measurement file (LVM text, CSV, TSV) as a voltage or a current.'),
    use: L('Đưa tín hiệu đã đo thật từ dao động ký hoặc bộ thu thập dữ liệu vào mạch mô phỏng để thử bộ lọc, mạch bảo vệ …', 'Feed a signal really measured with an oscilloscope or a data logger into a simulated circuit to try a filter, a protection circuit …'),
    read: L('Cột đầu là thời gian, các cột sau là kênh. Hệ số thời gian 2 phát chậm gấp đôi; có thể lặp lại, dịch trễ và đổi tỉ lệ giá trị.', 'The first column is time, the next ones are channels. A time scale of 2 plays twice as slowly; the recording can repeat, be delayed and rescaled in value.'),
  },
};

const coilPartHelp: HelpEntry = ELECTRO_FAMILY_HELP['Relay coil'];

export const ELECTRO_PART_HELP: Record<string, HelpEntry> = {
  'indicators/speaker': speakerHelp(false),
  'indicators/headphones': speakerHelp(true),
  'sources/microphone': {
    what: L('Micrô: nguồn áp đưa tín hiệu của thiết bị thu âm mặc định vào mạch khi chạy mô phỏng tương tác.', 'Microphone: a voltage source that feeds the default input device into the circuit while an interactive simulation runs.'),
    use: L('Thử bộ khuếch đại âm tần, bộ lọc, bộ méo bằng giọng nói thật; nối ngõ ra vào Loa để nghe lại.', 'Try an audio amplifier, a filter or a distortion stage with your real voice; wire the output to a Speaker to hear it.'),
    read: L('Lần đầu trình duyệt hỏi quyền dùng micrô. Cửa sổ Mô phỏng › Âm thanh có vạch mức vào. Không có micrô hoặc bị từ chối thì một sóng thử 440 Hz thay thế (cửa sổ nói rõ). Mức đầy thang của micrô bằng tham số Hệ số (V).', 'The first time the browser asks for microphone permission. The Simulate › Audio window shows an input level bar. With no microphone, or if permission is refused, a 440 Hz test tone replaces it (the window says so). A full-scale input equals the Gain parameter (V).'),
    tip: L('Micrô cho độ trễ khoảng 0.1 – 0.2 giây. Tránh đặt Loa gần micrô thật: tiếng hú.', 'The microphone adds a delay of about 0.1 – 0.2 s. Avoid putting the Speaker near a real microphone: it howls.'),
  },
  'sources/wav-voltage': {
    what: L('Nguồn áp phát một tệp WAV: các mẫu âm thanh thành điện áp (đầy thang ±1 = biên độ).', 'A voltage source that plays a WAV file: the audio samples become the voltage (full scale ±1 = the amplitude).'),
    use: L('Cho mạch “nghe” một đoạn nhạc hoặc giọng nói thật; phép phân tích nào cũng chạy được vì đây là nguồn PWL.', 'Make the circuit “hear” real music or speech; any analysis runs it because it is a PWL source.'),
    read: L('“Mở tệp WAV…” nạp tệp (đổi thành 16-bit đơn kênh ≤ 30 giây). Hệ số thời gian 2 phát chậm gấp đôi và hạ một quãng tám. Để trống thì phát xung 1 kHz dài 20 ms.', '“Open WAV file…” loads the file (converted to 16-bit mono, ≤ 30 s). A time scale of 2 plays twice as slowly and an octave lower. Empty plays a 20 ms burst of 1 kHz.'),
  },
  'electromechanical/breaker-adjustable': {
    what: L('Áp-tô-mát tép chọn được dòng định mức In và đường cong cắt B, C, D, K hoặc Z.', 'A miniature circuit breaker with a selectable rated current In and B, C, D, K or Z trip curve.'),
    use: L('Học cách chọn áp-tô-mát: đường cong nào chịu được dòng khởi động của tải mà vẫn cắt khi ngắn mạch.', 'Learn to choose a breaker: which curve withstands the inrush of the load yet still trips on a short circuit.'),
    read: L('Cắt nhiệt sau t = 10 s · ln(m² / (m² − 1.3²)) với m = I / In (không cắt khi m ≤ 1.3); cắt từ trong khoảng 1 ms từ bội số của đường cong (B 4, C 7.5, D 15, K 11, Z 2.5). Bảng Thuộc tính vẽ đường cong.', 'Thermal trip after t = 10 s · ln(m² / (m² − 1.3²)) with m = I / In (no trip for m ≤ 1.3); magnetic trip within about 1 ms from the curve’s multiple (B 4, C 7.5, D 15, K 11, Z 2.5). The Properties panel draws the curve.'),
    tip: L('Phím B bật / tắt bằng tay. Áp-tô-mát đã cắt giữ hở cho đến khi chạy lại mô phỏng.', 'Key B switches it by hand. A tripped breaker stays open until the simulation restarts.'),
  },
  'power/fuse-i2t': {
    what: L('Cầu chì xác định bằng năng lượng nóng chảy I²t (A²s) và dòng định mức.', 'A fuse defined by its melting energy I²t (A²s) and rated current.'),
    use: L('Chọn cầu chì đủ nhanh để bảo vệ diode, transistor hay thyristor: I²t của cầu chì phải nhỏ hơn I²t chịu được của linh kiện.', 'Pick a fuse fast enough to protect a diode, transistor or thyristor: the fuse I²t must be below the I²t the device can withstand.'),
    read: L('Chảy khi ∫(I² − Imin²)dt đạt I²t. Ở dòng không đổi I thời gian chảy là I²t / (I² − Imin²) ≈ I²t / I² khi quá tải lớn; dưới Imin = 1.5 · In không bao giờ chảy. Chảy rồi thì giữ hở mạch.', 'It blows when ∫(I² − Imin²)dt reaches I²t. At a constant current I the melting time is I²t / (I² − Imin²) ≈ I²t / I² for a large overload; below Imin = 1.5 · In it never blows. Once blown it stays open.'),
  },
  'electromechanical/overload-relay-1p': ELECTRO_FAMILY_HELP['Overload relay'],
  'electromechanical/overload-relay-3p': ELECTRO_FAMILY_HELP['Overload relay'],
  'electromechanical/motor-starter-dol': ELECTRO_FAMILY_HELP['Motor starter'],
  'electromechanical/line-transformer': ELECTRO_FAMILY_HELP['Line transformer'],
  'sources/flux-source': ELECTRO_FAMILY_HELP['Magnetic sources'],
  'sources/flux-generator': ELECTRO_FAMILY_HELP['Magnetic sources'],
  'sources/battery-nonideal': ELECTRO_FAMILY_HELP.Batteries,
  'sources/measurement-voltage': ELECTRO_FAMILY_HELP['Measurement file sources'],
  'sources/measurement-current': ELECTRO_FAMILY_HELP['Measurement file sources'],
  'sources/wav-current': {
    what: L('Nguồn dòng phát một tệp WAV: các mẫu âm thanh thành dòng điện (đầy thang ±1 = biên độ).', 'A current source that plays a WAV file: the audio samples become the current (full scale ±1 = the amplitude).'),
    use: L('Như nguồn áp WAV nhưng để kích thích mạch bằng dòng (cảm biến, cuộn dây, bộ khuếch đại hỗ dẫn).', 'Like the WAV voltage source but to drive a circuit with a current (sensors, coils, transconductance amplifiers).'),
  },
};

for (const v of [5, 12, 24, 48]) ELECTRO_PART_HELP[`electromechanical/coil-dc-${v}v`] = coilPartHelp;
