/**
 * Help texts of the automation and device-model round: the guide pages "Scripts" (Tools > Scripts,
 * MachSim.exe --script) and "Compact device models" (EKV, BSIM4-class, Jiles–Atherton), and the
 * "What is this?" pages of the new parts. Merged into GUIDE_PAGES (helpGuides.ts) and PART_HELP
 * (partHelp.ts); loaded with the help dialog. Original text.
 */
import { L } from './core';
import type { HelpEntry } from './help';
import type { GuidePage } from './helpGuides';

export const AUTOMATION_GUIDE_PAGES: Record<'scripting' | 'compactModels', GuidePage> = {
  scripting: {
    title: L('Tập lệnh: để MachSim làm việc lặp lại giúp bạn', 'Scripts: let MachSim do the repetitive work'),
    sections: [
      {
        heading: L('Tập lệnh là gì', 'What a script is'),
        body: L(
          'Công cụ › Tập lệnh (JavaScript) mở một khung soạn nhỏ. Bạn viết vài dòng để dựng mạch (đặt linh kiện, nối bằng tên nút), đổi giá trị trong một vòng lặp, chạy phân tích và đọc kết quả bằng số — rồi vẽ đồ thị hoặc ghi CSV. Việc gì bạn lặp lại bằng tay (quét một điện trở, thử 20 giá trị tụ) đều nên thành tập lệnh. Nhấn một hàm trong cột bên phải để chèn vào mã; chọn “Ví dụ…” để nạp mẫu.',
          'Tools › Scripts (JavaScript) opens a small editor. You write a few lines that build a circuit (place parts, join them by net name), change values in a loop, run analyses and read the results as numbers — then plot or write CSV. Anything you repeat by hand (sweeping a resistor, trying 20 capacitor values) should become a script. Click a function in the right-hand column to insert it into the code; pick “Examples…” to load a sample.',
        ),
      },
      {
        heading: L('Ví dụ đầu tiên: quét R1 và vẽ độ lợi', 'First example: sweep R1 and plot the gain'),
        body: L(
          'Ví dụ “Quét R1 và vẽ độ lợi” dựng mạch lọc RC, lần lượt đặt R1 = 500, 1k, 2k, 5k, chạy phân tích AC, đo tần số cắt (res.bandwidth) và so với 1/(2πRC), rồi vẽ bốn đường độ lợi. Mọi hàm MachSim đều bất đồng bộ nên phải viết await. Chân gọi là “R1.2” (tên linh kiện, dấu chấm, chân). MachSim.net("out", "R1.2", "C1.1") đặt cùng tên nút lên hai chân — nối chúng mà không cần vẽ dây.',
          'The example “Sweep R1 and plot the gain” builds an RC filter, sets R1 = 500, 1k, 2k, 5k in turn, runs an AC analysis, measures the corner frequency (res.bandwidth) against 1/(2πRC) and plots the four gain curves. Every MachSim function is asynchronous, so write await. Pins are called “R1.2” (part, dot, pin). MachSim.net("out", "R1.2", "C1.1") puts one net name on two pins — joining them with no wire to draw.',
        ),
        },
      {
        heading: L('Xem mạch do tập lệnh dựng', 'Looking at the circuit a script built'),
        body: L(
          'Tập lệnh làm việc trên một BẢN SAO riêng của thiết kế. Gọi await MachSim.showDesign() để mở bản sao thành thẻ mới và xem, sửa tiếp bằng tay; await MachSim.currentDesign() lấy bản sao của thiết kế đang mở để tập lệnh làm việc trên đó. Thiết kế gốc của bạn không bao giờ bị tập lệnh sửa trực tiếp.',
          'A script works on its own COPY of a design. Call await MachSim.showDesign() to open the copy as a new tab, look at it and continue by hand; await MachSim.currentDesign() takes a copy of the design that is open so the script can work on it. Your original design is never changed by a script directly.',
        ),
      },
      {
        heading: L('An toàn: hộp cát và xin phép', 'Safety: the sandbox and asking permission'),
        body: L(
          'Tập lệnh chạy trong một “hộp cát” riêng: không thấy trang MachSim, không có mạng, không đọc được ổ đĩa. Nó chỉ làm được những gì các hàm MachSim.xxx() cho phép. Mỗi lần mở hoặc lưu tệp, MachSim hiện thẻ xin phép và chỉ đụng tới đúng tệp bạn chọn. Nhấn Dừng là chấm dứt ngay, kể cả khi tập lệnh kẹt trong vòng lặp vô hạn; quá 10 phút tự dừng.',
          'A script runs in its own “sandbox”: it cannot see the MachSim page, has no network and cannot read the disk. It can only do what the MachSim.xxx() functions allow. Each time it opens or saves a file, MachSim shows a permission card and touches only the file you choose. Stop ends it at once, even in an endless loop; after 10 minutes it stops by itself.',
        ),
      },
      {
        heading: L('Chạy từ dòng lệnh', 'Running from the command line'),
        body: L(
          'MachSim.exe --script tep.js chạy tập lệnh không mở cửa sổ (dùng để chạy hàng loạt hoặc trong tập lệnh hệ điều hành). Tham số sau tên tập lệnh nằm trong MachSim.args; tập lệnh chỉ mở và lưu được CÁC TỆP NÊU TRÊN DÒNG LỆNH. Mã thoát: 0 xong, 1 tập lệnh lỗi hoặc quá giờ, 2 sai cách dùng, 3 lỗi tệp. Lỗi được in ra kèm số dòng. Tuỳ chọn: --timeout giây, --lang vi|en, --log tep.txt, --quiet.',
          'MachSim.exe --script file.js runs the script with no window (for batches or operating-system scripts). Arguments after the script name are in MachSim.args; the script may open and save ONLY THE FILES NAMED ON THE COMMAND LINE. Exit codes: 0 done, 1 the script failed or timed out, 2 wrong usage, 3 a file problem. Errors are printed with the line number. Options: --timeout seconds, --lang vi|en, --log file.txt, --quiet.',
        ),
      },
    ],
    code: ['MachSim.exe --script gain.js ketqua.csv', 'MachSim.exe --script gain.js --lang en --timeout 120 in.msim out.csv'],
  },
  compactModels: {
    title: L('Mô hình linh kiện compact: EKV, BSIM4 và lõi từ trễ', 'Compact device models: EKV, BSIM4 and hysteresis cores'),
    sections: [
      {
        heading: L('EKV 2.6 (LEVEL 44): một công thức cho mọi vùng nghịch đảo', 'EKV 2.6 (LEVEL 44): one equation for every inversion region'),
        body: L(
          'MOSFET EKV (Transistor › MOS EKV) tính dòng bằng MỘT công thức liền mạch từ nghịch đảo yếu (dòng mũ, độ dốc n·Vt) qua trung bình đến mạnh (dòng bình phương) — không có “vùng” nào để chuyển. Mô hình đối xứng nguồn–máng và chỉ cần vài tham số vật lý (VTO, KP, GAMMA, PHI). Đại lượng IC(M1) là hệ số nghịch đảo: dưới 0.1 là yếu, 0.1 … 10 là trung bình, trên 10 là mạnh — rất hợp cho mạch tiêu thụ ít. Cũng dùng được từ thẻ .model với LEVEL=44.',
          'The EKV MOSFET (Transistors › MOS EKV) computes the current with ONE smooth equation from weak inversion (exponential, slope n·Vt) through moderate to strong inversion (square law) — there is no “region” to switch between. The model is source/drain symmetric and needs only a few physical parameters (VTO, KP, GAMMA, PHI). IC(M1) is the inversion coefficient: below 0.1 is weak, 0.1 … 10 moderate, above 10 strong — handy for low-power design. It also works from a .model card with LEVEL=44.',
        ),
      },
      {
        heading: L('BSIM4 (LEVEL 14 / 54): hiệu ứng kênh ngắn', 'BSIM4 (LEVEL 14 / 54): short-channel effects'),
        body: L(
          'MOSFET BSIM4 có giảm ngưỡng khi kênh ngắn, DIBL, bão hoà vận tốc, ba công thức suy giảm độ linh động (mobMod 0, 1, 2), pha tạp ngang LPE0/LPEB, điện trở nguồn/máng RDSW và tụ điện theo điện tích với hình học riêng DLC/DWC. Đây là lõi BSIM3 dùng bộ tham số BSIM4: CHƯA có dòng rò cổng (GIDL), dòng cổng xuyên hầm, ion hoá va chạm, điện trở cổng/thân (RGATEMOD/RBODYMOD) và mô hình tụ capMod 2 đầy đủ. Dùng cho mạch học tập và so sánh xu hướng; muốn khớp một công nghệ cụ thể hãy nạp thẻ .model do nhà sản xuất công bố.',
          'The BSIM4 MOSFET has threshold roll-off at short channel length, DIBL, velocity saturation, three mobility-degradation formulas (mobMod 0, 1, 2), lateral doping LPE0/LPEB, source/drain resistance RDSW and charge-based capacitances with their own geometry DLC/DWC. It is the BSIM3 core with the BSIM4 parameter set: it does NOT have gate-induced drain leakage (GIDL), gate tunnelling current, impact ionisation, gate/body resistance (RGATEMOD/RBODYMOD) or the full capMod 2 capacitance model. Use it for teaching and for comparing trends; to match a specific technology load the .model card the manufacturer published.',
        ),
      },
      {
        heading: L('Lõi từ trễ Jiles–Atherton và dòng xoáy', 'Jiles–Atherton hysteresis core and eddy currents'),
        body: L(
          'Cuộn cảm và biến áp “lõi từ trễ” tính từ hoá M của lõi theo mô hình Jiles–Atherton: điện cảm phụ thuộc lịch sử, có từ dư và từ trường kháng, và diện tích vòng B–H là tổn hao mỗi chu kỳ. Tổn hao dòng xoáy cổ điển là một điện trở song song với cuộn dây, tính từ bề dày lá thép d và điện trở suất ρ (tăng theo d² và f²). Để xem vòng B–H: chạy phân tích quá độ, mở Grapher › Bộ xử lý sau, nhấn nút “Đường B–H của L1” (biểu thức vs(V(L1.b), V(L1.h)) vẽ B theo H).',
          'The “hysteresis core” inductor and transformer compute the core magnetisation M with the Jiles–Atherton model: the inductance depends on history, there is remanence and a coercive field, and the area of the B–H loop is the loss per cycle. Classical eddy-current loss is a resistor in parallel with the winding, worked out from the lamination thickness d and the resistivity ρ (it grows with d² and f²). To see the B–H loop: run a transient analysis, open Grapher › Postprocessor and press “B–H loop of L1” (the expression vs(V(L1.b), V(L1.h)) plots B against H).',
        ),
      },
      {
        heading: L('Độ chính xác — nói thẳng', 'Accuracy — plainly'),
        body: L(
          'EKV và BSIM4 được kiểm bằng giá trị tính từ chính công thức đã công bố (cực trị yếu/mạnh, đối xứng, điện tích, đạo hàm), không so với đo đạc của một quy trình thật; tham số mặc định là số tròn kiểu 0.18 µm, không phải mô hình nhà máy. Mô hình Jiles–Atherton được so với một bộ tích phân RK4 độc lập của cùng phương trình (B lệch dưới 1.5 % đỉnh). Bộ tham số thép silic là ví dụ điển hình trong tài liệu; bộ ferrite và nam châm cứng chỉ minh hoạ đúng bậc độ lớn.',
          'EKV and BSIM4 are checked against values computed from the published equations themselves (weak/strong limits, symmetry, charges, derivatives), not against measurements of a real process; the default parameters are round 0.18 µm-style numbers, not a foundry model. The Jiles–Atherton model is compared with an independent RK4 integration of the same equations (B within 1.5 % of its peak). The silicon-steel set is the typical example of the literature; the ferrite and hard-magnet sets only show the right order of magnitude.',
        ),
      },
    ],
  },
};

const core = (what: [string, string], use: [string, string]): HelpEntry => ({
  what: L(what[0], what[1]),
  use: L(use[0], use[1]),
  read: L(
    'Chạy phân tích quá độ với nguồn sin đặt NGAY TRÊN cuộn dây (đỉnh = 2π·f·N·Ae·Bm). Từ thông bằng tích phân điện áp nên B(t) hiện ngay; H và dòng sinh ra từ vòng trễ. Cuộn được khởi động ở trạng thái chưa từ hoá. Mở Grapher › Bộ xử lý sau › “Đường B–H” để vẽ B theo H; diện tích vòng nhân tần số là công suất tổn hao từ trễ.',
    'Run a transient analysis with a sine source placed DIRECTLY across the winding (peak = 2π·f·N·Ae·Bm). The flux is the integral of the voltage, so B(t) appears at once; H and the current come from the loop. The core starts demagnetised. Open Grapher › Postprocessor › “B–H loop” to plot B against H; the loop area times the frequency is the hysteresis loss power.',
  ),
  tip: L(
    'Để vòng trọn vẹn đối xứng hãy dùng nguồn sin pha 90° (bắt đầu từ đỉnh): MachSim bỏ qua điện áp một chiều ở điểm làm việc nên lõi vẫn bắt đầu từ 0. Đóng điện ở pha 0° cho dòng xung kích lệch một phía như biến áp thật.',
    'For a symmetric closed loop use a sine with phase 90° (starting at its peak): MachSim ignores the DC voltage in the operating point, so the core still starts at zero. Switching on at phase 0° gives the one-sided inrush of a real transformer.',
  ),
});

const mosHelp = (ekv: boolean): HelpEntry => ({
  what: L(
    ekv ? 'MOSFET dùng mô hình EKV 2.6 (LEVEL 44): một công thức liền mạch cho nghịch đảo yếu, trung bình và mạnh, đối xứng nguồn – máng.' : 'MOSFET dùng mô hình BSIM4 (LEVEL 54): hiệu ứng kênh ngắn, DIBL, bão hoà vận tốc, suy giảm độ linh động và tụ điện theo điện tích.',
    ekv ? 'A MOSFET with the EKV 2.6 model (LEVEL 44): one smooth equation for weak, moderate and strong inversion, source/drain symmetric.' : 'A MOSFET with the BSIM4 model (LEVEL 54): short-channel effects, DIBL, velocity saturation, mobility degradation and charge-based capacitances.',
  ),
  use: L(
    ekv ? 'Mạch CMOS tiêu thụ ít, khuếch đại ở nghịch đảo yếu, so sánh với mô hình mức 1 để thấy sai khác khi điện áp cổng gần ngưỡng.' : 'Cổng CMOS và bộ khuếch đại công nghệ dưới micrômét; xem ngưỡng giảm khi kênh ngắn và dòng bão hoà không còn theo bình phương.',
    ekv ? 'Low-power CMOS circuits, amplifiers in weak inversion, and comparing with the level-1 model to see where it fails near threshold.' : 'CMOS gates and sub-micron amplifiers; see the threshold fall at short channel length and the saturation current stop following a square law.',
  ),
  read: L(
    ekv ? 'Xem IC(M1) (hệ số nghịch đảo) trong kết quả: < 0.1 yếu, > 10 mạnh. Dòng ở nghịch đảo yếu tăng theo hàm mũ với độ dốc n·Vt (khoảng 70 mV/decade).' : 'Mặc định là bộ số tròn kiểu 0.18 µm, không phải mô hình nhà máy. Chọn mobMod 0 / 1 / 2 ở thẻ Nâng cao để đổi công thức độ linh động.',
    ekv ? 'Look at IC(M1) (the inversion coefficient) in the results: < 0.1 is weak, > 10 strong. In weak inversion the current rises exponentially with a slope of n·Vt (about 70 mV per decade).' : 'The defaults are round 0.18 µm-style numbers, not a foundry model. Pick mobMod 0 / 1 / 2 on the Advanced tab to change the mobility formula.',
  ),
  tip: L('Để so với thẻ .model thật, thêm thẻ vào Văn bản SPICE của thiết kế và đặt tên nó vào ô “Tên mô hình” của linh kiện.', 'To compare with a real .model card, add the card to the design’s SPICE text and put its name in the part’s “Model name” field.'),
});

export const AUTOMATION_PART_HELP: Record<string, HelpEntry> = {
  'basic/inductor-hysteresis': core(
    ['Cuộn cảm quấn trên lõi thép silic có đường trễ Jiles–Atherton và tổn hao dòng xoáy.', 'An inductor wound on a silicon-steel core with a Jiles–Atherton hysteresis loop and eddy-current loss.'],
    ['Xem cuộn cảm / biến áp lõi sắt thật khác cuộn lý tưởng thế nào: điện cảm thay đổi, tổn hao lõi, từ dư.', 'See how a real iron-core inductor or transformer differs from the ideal one: changing inductance, core loss, remanence.'],
  ),
  'basic/inductor-hysteresis-ferrite': core(
    ['Cuộn cảm lõi ferrite mềm: vòng B–H hẹp, bão hoà ở cảm ứng thấp, gần như không có dòng xoáy (giá trị minh hoạ).', 'An inductor on a soft-ferrite core: a narrow B–H loop, saturation at low flux density, almost no eddy current (illustrative values).'],
    ['Cuộn lọc nguồn xung và biến áp tần số cao.', 'Switching-supply chokes and high-frequency transformers.'],
  ),
  'basic/inductor-hysteresis-hard': core(
    ['Cuộn cảm lõi vật liệu từ cứng: vòng B–H rộng, gần hình chữ nhật, từ dư lớn (giá trị minh hoạ).', 'An inductor on a hard magnetic material: a wide, almost rectangular B–H loop and large remanence (illustrative values).'],
    ['Hiểu vì sao nam châm vĩnh cửu giữ từ và vì sao lõi của biến áp không được làm bằng vật liệu cứng.', 'Understand why a permanent magnet keeps its magnetism and why a transformer core must not be a hard material.'],
  ),
  'basic/transformer-hysteresis': core(
    ['Biến áp có lõi sắt từ trễ Jiles–Atherton và tổn hao dòng xoáy, tỉ số vòng Np:Ns chính xác.', 'A transformer whose iron core has a Jiles–Atherton hysteresis loop and eddy-current loss, with an exact turns ratio Np:Ns.'],
    ['Xem dòng từ hoá méo (phẳng đỉnh, có hài bậc ba) và tổn hao không tải của biến áp lõi sắt.', 'See the distorted magnetising current (flat-topped, with a third harmonic) and the no-load loss of an iron-core transformer.'],
  ),
  'transistors/ekv-nmos': mosHelp(true),
  'transistors/ekv-pmos': mosHelp(true),
  'transistors/bsim4-nmos': mosHelp(false),
  'transistors/bsim4-pmos': mosHelp(false),
};
