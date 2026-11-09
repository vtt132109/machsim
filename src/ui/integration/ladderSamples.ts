/**
 * Automation samples: a ladder diagram controlling a circuit and a machine.
 *
 *   55  motor start / stop with self-holding (two push-buttons, a contactor lamp)
 *   56  traffic-light junction driven by one cycle timer and comparison contacts
 *   57  tank filling control: two float switches, the analog level and an overflow alarm
 *   78  the same tank with the pump rung written once as a function block, a word counter of the
 *       pump starts and the level shown on an analog output
 *
 * Each sample is built by code, like the other samples of src/ui/integration/sampleDesigns.ts
 * (the .msim files in examples/ are the output of these builders; regenerate them with
 * MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts). The rules the sample tests
 * enforce: every ground symbol sits on a wire end, note ids are unique across the sheets, the
 * design passes ERC without a single warning and every saved analysis runs.
 */
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import type { Design, Point, TextNote } from '../../model/types';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';
import type { LadderBlock, LadderCompareOp, LadderNode, LadderOutput, LadderRung } from '../../ladder/types';

const p = (x: number, y: number): Point => ({ x, y });

/** Note with an id that is unique across the whole design. */
function note(b: DesignBuilder, x: number, y: number, text: string): void {
  const n: TextNote = { id: `note${b.sheet.notes.length + 1}_${b.sheet.id}`, x, y, text, size: 11 };
  b.sheet.notes.push(n);
}

function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): void {
  d.analysis = { active, specs: {} };
  for (const s of specs) d.analysis.specs[s.type] = s;
}

function gnd(b: DesignBuilder, x: number, y: number): PartHandle {
  return b.part('sources/ground', `GND${b.sheet.parts.length + 1}`, x, y);
}

// ---------------------------------------------------------------------------------------------
// ladder helpers
// ---------------------------------------------------------------------------------------------

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });
const cmp = (left: string, op: LadderCompareOp, right: string): LadderNode => ({ kind: 'compare', op, left, right });
const coil = (address: string): LadderOutput => ({ kind: 'coil', address });

let rungSeq = 0;
function rung(comment: string, logic: LadderNode | undefined, outputs: LadderOutput[]): LadderRung {
  rungSeq += 1;
  const r: LadderRung = { id: `rung${rungSeq}`, comment, outputs };
  if (logic) r.logic = logic;
  return r;
}

// ---------------------------------------------------------------------------------------------
// 55 — motor start / stop
// ---------------------------------------------------------------------------------------------

export function ladderStartStopSample(): Design {
  rungSeq = 0;
  const b = new DesignBuilder('Motor start / stop with a ladder diagram');
  const d = b.design;
  d.description =
    'Bài toán đầu tiên của điều khiển: nút KHỞI ĐỘNG chỉ đóng trong lúc nhấn, nên bậc thang phải “tự giữ”. ' +
    'Đọc bậc 1 ra lời: (khởi động HOẶC đang chạy) VÀ nút dừng chưa nhấn → chạy. Nút dừng S2 là tiếp điểm THƯỜNG ĐÓNG như trong tủ điện thật, nên trong chương trình nó là tiếp điểm thường MỞ của I0.1. ' +
    'Nhấn Chạy (F5), rồi nhấp vào S1 (hoặc phím S) để khởi động và S2 (hoặc phím T) để dừng. ' +
    'The first exercise in control: the START button is only closed while it is pressed, so the rung has to hold itself. Read rung 1 out loud: (start OR already running) AND the stop button not pressed → run. The stop button S2 is a NORMALLY CLOSED contact, as in a real cabinet, so in the program it is a normally OPEN contact of I0.1. Press Run (F5), then click S1 (key S) to start and S2 (key T) to stop.';

  const v = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '24' });
  gnd(b, 100, 320);
  b.wire(b.pin(v, '-'), p(100, 320));
  b.labelPin(v, '+', 'P24');

  const s1 = b.part('basic/push-button', 'S1', 240, 160, { key: 'S' });
  b.labelPin(s1, '1', 'P24');
  b.labelPin(s1, '2', 'START');
  const s2 = b.part('basic/push-button', 'S2', 240, 240, { key: 'T', contact: 'nc' });
  b.labelPin(s2, '1', 'P24');
  b.labelPin(s2, '2', 'STOP');

  const inp = b.part('misc-digital/plc-input-8', 'PLCI1', 460, 220, { byte: '0' });
  b.labelPin(inp, 'I0', 'START');
  b.labelPin(inp, 'I1', 'STOP');
  b.labelPin(inp, 'COM', '0');

  const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 680, 220, { byte: '0' });
  b.labelPin(out, 'Q0', 'KM1');
  b.labelPin(out, 'COM', '0');
  b.part('misc-digital/plc-controller', 'PLC1', 460, 420, { scan: '10m' });

  const lamp = b.part('indicators/lamp', 'X1', 880, 220, { vrated: '24', prated: '5' }, { rotation: 90 });
  b.labelPin(lamp, '1', 'KM1');
  b.labelPin(lamp, '2', '0');
  b.probe('digital', 820, 160, 'KM1');
  b.label('KM1', 820, 160);

  note(
    b,
    100,
    480,
    'Mô-đun vào đọc hai nút: I0.0 = KHỞI ĐỘNG, I0.1 = DỪNG. Mô-đun ra Q0.0 cấp điện cho cuộn dây khởi động từ (ở đây là đèn X1). ' +
      'Thử bỏ tiếp điểm song song Q0.0 trong bậc 1: động cơ chỉ chạy khi còn giữ nút — đó chính là vì sao cần tự giữ.',
  );

  b.ladderSheet(
    [
      rung(
        'Tự giữ: (khởi động HOẶC đang chạy) VÀ chưa dừng → chạy',
        and(or(no('I0.0'), no('Q0.0')), no('I0.1')),
        [coil('Q0.0')],
      ),
    ],
    'Ladder 1',
  );
  b.useSheet(0);
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-3, tstop: 2 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 56 — traffic lights
// ---------------------------------------------------------------------------------------------

export function ladderTrafficSample(): Design {
  rungSeq = 0;
  const b = new DesignBuilder('Traffic-light junction with ladder timers');
  const d = b.design;
  d.description =
    'Nút giao thông hai chiều do một bộ định thời duy nhất điều khiển. Bậc 1 là “bộ định thời vòng”: tiếp điểm thường đóng của T1 nuôi chính T1, nên khi T1 đếm xong nó tự xoá và bắt đầu lại — chu kỳ 20 s. ' +
    'Sáu bậc sau chỉ so sánh thời gian đã đếm T1.ET với các mốc: 0–8 s Bắc–Nam xanh, 8–10 s vàng, 10–18 s Đông–Tây xanh, 18–20 s vàng. ' +
    'Mô hình nút giao tự kiểm tra: nếu hai chiều cùng xanh (hoặc một chiều tối) lâu hơn 0,3 s thì chân ERR bật đèn X1. Chương trình này đúng nên đèn đó không bao giờ sáng — hãy thử đổi một mốc thời gian để thấy nó báo lỗi. ' +
    'A two-direction junction run by a single timer. Rung 1 is a cycle timer: a normally-closed contact of T1 feeds T1 itself, so the timer clears and restarts as soon as it is done — a 20 s cycle. The six rungs after it only compare the elapsed time T1.ET with the switch-over times. The junction model checks itself: if both directions show green (or one goes dark) for longer than 0.3 s, the ERR pin lights lamp X1. This program is correct, so it never does — change one of the times to see it complain.';

  b.part('misc-digital/plc-controller', 'PLC1', 140, 300, { scan: '10m' });

  const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 340, 220, { byte: '0' });
  const nets = ['NSR', 'NSY', 'NSG', 'EWR', 'EWY', 'EWG'];
  nets.forEach((net, k) => b.labelPin(out, `Q${k}`, net));
  b.labelPin(out, 'COM', '0');

  const mj = b.part('misc/traffic-junction', 'MJ1', 700, 220, { tfault: '300m', rin: '2k' });
  const pins = ['NSR', 'NSY', 'NSG', 'EWR', 'EWY', 'EWG'];
  pins.forEach((pin, k) => b.labelPin(mj, pin, nets[k]));
  b.labelPin(mj, 'COM', '0');
  b.labelPin(mj, 'ERR', 'ERR');

  const lamp = b.part('indicators/lamp', 'X1', 940, 300, { vrated: '24', prated: '5' }, { rotation: 90 });
  b.labelPin(lamp, '1', 'ERR');
  b.labelPin(lamp, '2', '0');
  b.probe('digital', 560, 140, 'NSG');
  b.label('NSG', 560, 140);
  b.probe('digital', 560, 180, 'EWG');
  b.label('EWG', 560, 180);

  note(
    b,
    100,
    500,
    'Chân đèn của mô hình là tải thật (2 kΩ ≈ 12 mA ở 24 V), nên mô-đun ra phải thực sự cấp dòng. ' +
      'Muốn chu kỳ khác, chỉ cần sửa giá trị đặt trước của T1 và các mốc so sánh.',
  );

  b.ladderSheet(
    [
      rung('Bộ định thời vòng: T1 đếm 20 s rồi tự xoá để bắt đầu lại', nc('T1'), [{ kind: 'ton', address: 'T1', preset: '20' }]),
      rung('0–8 s: Bắc–Nam xanh', cmp('T1.ET', 'lt', '8'), [coil('Q0.2')]),
      rung('8–10 s: Bắc–Nam vàng', and(cmp('T1.ET', 'ge', '8'), cmp('T1.ET', 'lt', '10')), [coil('Q0.1')]),
      rung('Từ 10 s: Bắc–Nam đỏ', cmp('T1.ET', 'ge', '10'), [coil('Q0.0')]),
      rung('0–10 s: Đông–Tây đỏ', cmp('T1.ET', 'lt', '10'), [coil('Q0.3')]),
      rung('10–18 s: Đông–Tây xanh', and(cmp('T1.ET', 'ge', '10'), cmp('T1.ET', 'lt', '18')), [coil('Q0.5')]),
      rung('Từ 18 s: Đông–Tây vàng', cmp('T1.ET', 'ge', '18'), [coil('Q0.4')]),
    ],
    'Ladder 1',
  );
  b.useSheet(0);
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 0.05, tstop: 22 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 57 — tank filling
// ---------------------------------------------------------------------------------------------

export function ladderTankSample(): Design {
  rungSeq = 0;
  const b = new DesignBuilder('Tank filling control with a ladder diagram');
  const d = b.design;
  d.description =
    'Điều khiển mức nước hai điểm. Bậc 1 lại là một mạch tự giữ, nhưng “nút khởi động” là công tắc phao mức thấp: bơm chạy khi nước xuống dưới mức thấp và chỉ nghỉ khi nước lên tới mức cao. ' +
    'Bậc 2 dùng tiếp điểm SO SÁNH trên kênh tương tự: cảm biến mức cho 0 V khi cạn và 10 V khi đầy, nên AI0 > 9,5 nghĩa là gần tràn và bật đèn báo. ' +
    'Bồn bắt đầu cạn: bơm 0,5 L/s nên 10 L đầy 80 % sau 16 s rồi bơm nghỉ. Nhấp công tắc S1 (hoặc phím V) để mở van xả và xem bơm tự chạy lại. ' +
    'Two-point level control. Rung 1 is a self-holding circuit again, but the “start button” is the low float switch: the pump runs when the level falls below it and only rests when the level reaches the high switch. Rung 2 uses a COMPARISON contact on the analog channel: the level transmitter gives 0 V when empty and 10 V when full, so AI0 > 9.5 means nearly overflowing and lights the alarm. The tank starts empty: at 0.5 L/s the 10 L tank is 80 % full after 16 s and the pump rests. Click switch S1 (key V) to open the drain valve and watch the pump start again.';

  const v = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '24' });
  gnd(b, 100, 320);
  b.wire(b.pin(v, '-'), p(100, 320));
  b.labelPin(v, '+', 'P24');
  b.part('misc-digital/plc-controller', 'PLC1', 260, 460, { scan: '20m' });

  const inp = b.part('misc-digital/plc-input-8', 'PLCI1', 340, 200, { byte: '0' });
  b.labelPin(inp, 'I0', 'LOW');
  b.labelPin(inp, 'I1', 'HIGH');
  b.labelPin(inp, 'COM', '0');

  const ai = b.part('misc-digital/plc-analog-in-2', 'PLCA1', 340, 400, { chan: '0' });
  b.labelPin(ai, 'AI0', 'LVL');
  b.labelPin(ai, 'COM', '0');

  const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 620, 200, { byte: '0' });
  b.labelPin(out, 'Q0', 'PUMP');
  b.labelPin(out, 'Q2', 'ALARM');
  b.labelPin(out, 'COM', '0');

  const tank = b.part('misc/water-tank', 'TK1', 900, 260, { volume: '10', qin: '500m', qout: '350m', low: '20', high: '80', start: '0' });
  b.labelPin(tank, 'PUMP', 'PUMP');
  b.labelPin(tank, 'VALVE', 'DRAIN');
  b.labelPin(tank, 'LOW', 'LOW');
  b.labelPin(tank, 'HIGH', 'HIGH');
  b.labelPin(tank, 'LEVEL', 'LVL');
  b.labelPin(tank, 'COM', '0');

  const sw = b.part('basic/switch-spst', 'S1', 640, 420, { key: 'V' });
  b.labelPin(sw, '1', 'P24');
  b.labelPin(sw, '2', 'DRAIN');

  const lamp = b.part('indicators/lamp', 'X1', 760, 120, { vrated: '24', prated: '5' }, { rotation: 90 });
  b.labelPin(lamp, '1', 'ALARM');
  b.labelPin(lamp, '2', '0');
  b.probe('digital', 740, 200, 'PUMP');
  b.label('PUMP', 740, 200);
  b.probe('voltage', b.pin(ai, 'AI0').x, b.pin(ai, 'AI0').y, 'LVL');

  note(
    b,
    100,
    540,
    'Mức nước vẽ ngay trong hình bồn và cũng là biến kết quả V(TK1.percent) — vẽ được trong Grapher. ' +
      'Van xả chảy theo √mức, nên bồn đầy cạn hết sau 2 · 10 L / 0,35 L/s ≈ 57 s.',
  );

  b.ladderSheet(
    [
      rung(
        'Bơm: chạy khi nước dưới mức thấp, tự giữ tới khi tới mức cao',
        and(nc('I0.1'), or(nc('I0.0'), no('Q0.0'))),
        [coil('Q0.0')],
      ),
      rung('Báo động gần tràn: cảm biến mức trên 9,5 V', cmp('AI0', 'gt', '9.5'), [coil('Q0.2')]),
    ],
    'Ladder 1',
  );
  b.useSheet(0);
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 0.1, tstop: 25 }]);
  return d;
}

// ---------------------------------------------------------------------------------------------
// 78 — the tank with a function block, a word counter and an analog output
// ---------------------------------------------------------------------------------------------

export function ladderBlockSample(): Design {
  rungSeq = 0;
  const b = new DesignBuilder('Tank control with a function block and word math');
  const d = b.design;
  d.description =
    'Cùng bồn nước của mẫu 57, viết gọn hơn bằng ba thứ mới của sơ đồ bậc thang. (1) KHỐI HÀM “BomHaiMuc”: bài toán bơm tự giữ giữa hai công tắc phao được viết MỘT lần (nhấn “Khối hàm” trên thanh công cụ của trang bậc thang để xem), bậc 1 chỉ gọi nó và nối ba tham số với I0.0, I0.1 và Q0.0. Muốn thêm một bồn thứ hai, chỉ cần gọi khối lần nữa. ' +
    '(2) LỆNH SỐ: bậc 2 là MUL AQ0 = AI0 × 0,5 (đồng hồ mức 0 … 5 V), bậc 3 dùng tiếp điểm SƯỜN LÊN của Q0.0 để ADD MW0 = MW0 + 1 mỗi lần bơm khởi động, bậc 4 so sánh MW0 ≥ 2 để báo bơm khởi động lại. ' +
    '(3) NGÕ RA TƯƠNG TỰ: mô-đun AQ đưa điện áp của AQ0 ra chân GAUGE; bồn đầy 80 % thì mức là 8 V và đồng hồ chỉ 4 V. Nhấn Chạy (F5); sau 16 s bơm nghỉ. Nhấp công tắc S1 (phím V) để xả nước, bơm chạy lại và đèn báo sáng ở lần khởi động thứ hai. Nhấn “Tham chiếu chéo” để thấy MW0 được ghi ở bậc 3 và đọc ở bậc 4. ' +
    'The tank of sample 57, written more compactly with three new things of the ladder editor. (1) A FUNCTION BLOCK “BomHaiMuc”: the self-holding pump between the two float switches is written ONCE (press “Function blocks” on the ladder sheet’s toolbar to see it); rung 1 only calls it and ties three parameters to I0.0, I0.1 and Q0.0. A second tank needs only another call. ' +
    '(2) WORD INSTRUCTIONS: rung 2 is MUL AQ0 = AI0 × 0.5 (a level gauge of 0 … 5 V), rung 3 uses a RISING-EDGE contact of Q0.0 to ADD MW0 = MW0 + 1 each time the pump starts, rung 4 compares MW0 ≥ 2 to flag a pump that restarted. ' +
    '(3) AN ANALOG OUTPUT: the AQ module drives the voltage of AQ0 onto the pin GAUGE; with the tank 80 % full the level is 8 V and the gauge reads 4 V. Press Run (F5); after 16 s the pump rests. Click switch S1 (key V) to drain the tank, the pump starts again and the alarm lamp lights on the second start. Press “Cross-reference” to see MW0 written in rung 3 and read in rung 4.';

  const v = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '24' });
  gnd(b, 100, 320);
  b.wire(b.pin(v, '-'), p(100, 320));
  b.labelPin(v, '+', 'P24');
  b.part('misc-digital/plc-controller', 'PLC1', 260, 460, { scan: '20m' });

  const inp = b.part('misc-digital/plc-input-8', 'PLCI1', 340, 200, { byte: '0' });
  b.labelPin(inp, 'I0', 'LOW');
  b.labelPin(inp, 'I1', 'HIGH');
  b.labelPin(inp, 'COM', '0');

  const ai = b.part('misc-digital/plc-analog-in-2', 'PLCA1', 340, 400, { chan: '0' });
  b.labelPin(ai, 'AI0', 'LVL');
  b.labelPin(ai, 'COM', '0');

  const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 620, 200, { byte: '0' });
  b.labelPin(out, 'Q0', 'PUMP');
  b.labelPin(out, 'Q2', 'ALARM');
  b.labelPin(out, 'COM', '0');

  const aq = b.part('misc-digital/plc-analog-out-2', 'PLCO1', 620, 420, { chan: '0', vmax: '10' });
  b.labelPin(aq, 'AQ0', 'GAUGE');
  b.labelPin(aq, 'COM', '0');
  const load = b.part('basic/resistor', 'R1', 860, 440, { value: '10k' }, { rotation: 90 });
  b.labelPin(load, '1', 'GAUGE');
  b.labelPin(load, '2', '0');
  b.probe('voltage', b.pin(aq, 'AQ0').x, b.pin(aq, 'AQ0').y, 'GAUGE');

  const tank = b.part('misc/water-tank', 'TK1', 900, 260, { volume: '10', qin: '500m', qout: '350m', low: '20', high: '80', start: '0' });
  b.labelPin(tank, 'PUMP', 'PUMP');
  b.labelPin(tank, 'VALVE', 'DRAIN');
  b.labelPin(tank, 'LOW', 'LOW');
  b.labelPin(tank, 'HIGH', 'HIGH');
  b.labelPin(tank, 'LEVEL', 'LVL');
  b.labelPin(tank, 'COM', '0');

  const sw = b.part('basic/switch-spst', 'S1', 640, 560, { key: 'V' });
  b.labelPin(sw, '1', 'P24');
  b.labelPin(sw, '2', 'DRAIN');

  const lamp = b.part('indicators/lamp', 'X1', 760, 120, { vrated: '24', prated: '5' }, { rotation: 90 });
  b.labelPin(lamp, '1', 'ALARM');
  b.labelPin(lamp, '2', '0');
  b.probe('digital', 740, 200, 'PUMP');
  b.label('PUMP', 740, 200);

  note(
    b,
    100,
    620,
    'Thử: đổi khối “BomHaiMuc” (nhấn Khối hàm › BomHaiMuc) rồi chạy lại; mọi lời gọi đổi theo. ' +
      'MW0 là từ nhớ 16 bit có dấu; số lần bơm khởi động hiện trong dải trạng thái của trang bậc thang khi chạy.',
  );

  const pumpBlock: LadderBlock = {
    id: 'blk-pump',
    name: 'BomHaiMuc',
    comment: 'Bơm tự giữ giữa hai công tắc phao: chạy khi nước dưới mức thấp, nghỉ khi tới mức cao',
    inputs: ['MUCTHAP', 'MUCCAO'],
    outputs: ['BOM'],
    rungs: [
      {
        id: 'blk-pump-1',
        comment: 'Tự giữ: (nước dưới mức thấp HOẶC đang bơm) VÀ chưa tới mức cao → bơm',
        logic: and(nc('MUCCAO'), or(nc('MUCTHAP'), no('BOM'))),
        outputs: [coil('BOM')],
      },
    ],
  };
  d.ladderBlocks = [pumpBlock];

  b.ladderSheet(
    [
      rung('Bơm: gọi khối BomHaiMuc, nối mức thấp I0.0, mức cao I0.1 và cuộn dây Q0.0', undefined, [
        { kind: 'call', address: 'P1', block: 'BomHaiMuc', args: { MUCTHAP: 'I0.0', MUCCAO: 'I0.1', BOM: 'Q0.0' } },
      ]),
      rung('Đồng hồ mức: AQ0 = AI0 × 0,5 (bồn đầy 10 V cho 5 V)', undefined, [{ kind: 'mul', address: 'AQ0', a: 'AI0', b: '0.5' }]),
      rung('Đếm số lần bơm khởi động: sườn lên của Q0.0 cộng 1 vào MW0', { kind: 'contact', type: 'rising', address: 'Q0.0' }, [{ kind: 'add', address: 'MW0', a: 'MW0', b: '1' }]),
      rung('Báo bơm đã khởi động từ 2 lần trở lên', cmp('MW0', 'ge', '2'), [coil('Q0.2')]),
    ],
    'Ladder 1',
  );
  b.useSheet(0);
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 0.1, tstop: 25 }]);
  return d;
}

export const LADDER_SAMPLE_BUILDERS: Record<string, () => Design> = {
  '55-ladder-start-stop.msim': ladderStartStopSample,
  '56-ladder-traffic.msim': ladderTrafficSample,
  '57-ladder-tank.msim': ladderTankSample,
  '78-ladder-function-block.msim': ladderBlockSample,
};
