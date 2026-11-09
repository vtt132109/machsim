/**
 * Samples of the compact device models:
 *
 *   80  B–H loop of an iron core (Jiles–Atherton hysteresis + eddy-current loss): open the Grapher,
 *       Postprocessor, press "B–H loop of L1"
 *   81  CMOS inverter drawn twice, once with EKV 2.6 and once with BSIM4 transistors, same input
 *
 * Built by code like the other samples (src/ui/integration/sampleDesigns.ts); the .msim files in
 * examples/ are their serialised output (MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts
 * rewrites them). Nets are joined by net labels; "GND" is ground.
 */
import { DesignBuilder } from '../../model/designkit';
import type { Design, TextNote } from '../../model/types';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';

function note(b: DesignBuilder, x: number, y: number, text: string): void {
  const n: TextNote = { id: `note${b.sheet.notes.length + 1}_${b.sheet.id}`, x, y, text, size: 11 };
  b.sheet.notes.push(n);
}

function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): void {
  d.analysis = { active, specs: {} };
  for (const s of specs) d.analysis.specs[s.type] = s;
}

function put(b: DesignBuilder, id: string, ref: string, x: number, y: number, pins: Record<string, string>, params: Record<string, string> = {}) {
  const h = b.part(id, ref, x, y, params);
  for (const [pin, net] of Object.entries(pins)) b.labelPin(h, pin, net);
  return h;
}

export function hysteresisLoopSample(): Design {
  const b = new DesignBuilder('B-H loop of an iron core (Jiles-Atherton hysteresis)');
  const d = b.design;
  d.description =
    'Cuộn dây 100 vòng quấn trên lõi thép silic (1 cm², đường sức dài 10 cm) có mô hình từ trễ Jiles–Atherton và tổn hao dòng xoáy. Nguồn sin 50 Hz đặt thẳng lên cuộn, đỉnh 4,71 V, nên từ thông là tích phân của điện áp và cảm ứng từ đỉnh là 1,5 T. Chạy phân tích quá độ rồi mở Grapher › Bộ xử lý sau › “Đường B–H của L1”: vòng trễ có từ trường kháng cỡ 300 A/m; diện tích vòng nhân tần số là tổn hao từ trễ. ' +
    'A 100-turn winding on a silicon-steel core (1 cm², 10 cm path) with the Jiles–Atherton hysteresis model and eddy-current loss. A 50 Hz sine source sits directly across the winding, peak 4.71 V, so the flux is the integral of the voltage and the peak flux density is 1.5 T. Run the transient, then open Grapher › Postprocessor › “B–H loop of L1”: the loop has a coercive field of about 300 A/m; the loop area times the frequency is the hysteresis loss.';
  put(b, 'sources/ac-voltage', 'V1', 120, 220, { '+': 'A', '-': 'GND' }, { amplitude: '4.712', freq: '50', phase: '90' });
  put(b, 'basic/inductor-hysteresis', 'L1', 360, 220, { '1': 'A', '2': 'GND' }, { turns: '100', area: '100', length: '100', rser: '0' });
  put(b, 'sources/ground', 'GND1', 120, 330, {});
  note(b, 60, 400, 'V1 bắt đầu từ đỉnh (pha 90°) nên từ thông đối xứng ±1,5 T/(100 vòng·1 cm²). Đổi “Hệ số ghim k” của L1 (400 A/m) để thấy vòng rộng ra hoặc hẹp lại; k = 0 là không có từ trễ.');
  note(b, 60, 420, 'Đổi “Bề dày lá thép” (350 µm) để thấy tổn hao dòng xoáy: dòng điện tăng thêm đúng bằng V·G với G = l·d²/(12·ρ·N²·A). Thử mẫu lõi ferrite và lõi từ cứng trong nhóm Cơ bản.');
  setAnalyses(d, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-5, tstop: 0.06, tmax: 2e-5 }]);
  return d;
}

export function compactInverterSample(): Design {
  const b = new DesignBuilder('CMOS inverter with EKV and BSIM4 transistors');
  const d = b.design;
  d.description =
    'Hai cổng đảo CMOS cùng điện áp vào: trên là MOSFET EKV 2.6 (LEVEL 44), dưới là MOSFET BSIM4 (LEVEL 54), tham số kiểu 0.18 µm. Chạy quét DC của V2 từ 0 đến 1,8 V và vẽ V(OUTE), V(OUT4): cả hai đặc tuyến truyền đạt đều giảm từ 1,8 V xuống 0 V quanh 0,9 V. Hai mô hình khác nhau ở chi tiết (ngưỡng, dốc, dòng dưới ngưỡng) — đổi VTO / VTH0 để so sánh. ' +
    'Two CMOS inverters with the same input: the top one uses EKV 2.6 MOSFETs (LEVEL 44), the bottom one BSIM4 MOSFETs (LEVEL 54), 0.18 µm-style parameters. Run the DC sweep of V2 from 0 to 1.8 V and plot V(OUTE), V(OUT4): both transfer curves fall from 1.8 V to 0 V around 0.9 V. The two models differ in details (threshold, slope, sub-threshold current) — change VTO / VTH0 to compare.';
  put(b, 'sources/dc-voltage', 'V1', 100, 200, { '+': 'VDD', '-': 'GND' }, { value: '1.8' });
  put(b, 'sources/dc-voltage', 'V2', 100, 380, { '+': 'IN', '-': 'GND' }, { value: '0.9' });
  put(b, 'sources/ground', 'GND1', 100, 470, {});
  // EKV inverter
  put(b, 'transistors/ekv-pmos', 'Q1', 360, 150, { D: 'OUTE', G: 'IN', S: 'VDD', B: 'VDD' }, { w: '2.8u' });
  put(b, 'transistors/ekv-nmos', 'Q2', 360, 320, { D: 'OUTE', G: 'IN', S: 'GND', B: 'GND' }, { w: '1u' });
  // BSIM4 inverter
  put(b, 'transistors/bsim4-pmos', 'Q3', 620, 150, { D: 'OUT4', G: 'IN', S: 'VDD', B: 'VDD' }, { w: '2.5u' });
  put(b, 'transistors/bsim4-nmos', 'Q4', 620, 320, { D: 'OUT4', G: 'IN', S: 'GND', B: 'GND' }, { w: '1u' });
  note(b, 60, 520, 'EKV (Q1, Q2) và BSIM4 (Q3, Q4) cùng W/L: PMOS rộng gấp 2,5–2,8 lần NMOS để hai bên cân bằng. Phân tích: quét DC V2 từ 0 đến 1,8 V.');
  note(b, 60, 540, 'Xem IC(Q2) (hệ số nghịch đảo) trong kết quả OP: dưới 0,1 là nghịch đảo yếu, trên 10 là mạnh.');
  setAnalyses(d, 'dc', [{ type: 'op' }, { type: 'dc', src: 'V2', start: 0, stop: 1.8, step: 0.01 }]);
  return d;
}

export const DEVICE_SAMPLE_BUILDERS: Record<string, () => Design> = {
  '80-hysteresis-bh-loop.msim': hysteresisLoopSample,
  '81-ekv-bsim4-inverter.msim': compactInverterSample,
};
