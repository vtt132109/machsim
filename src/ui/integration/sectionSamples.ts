/**
 * Sample of round 4 step 4: one LM358 drawn as two sections (U1A buffer, U1B gain stage) with two
 * assembly variants that give the feedback resistor R2 another value.
 *
 *   73  dual op-amp: section A follows the input, section B amplifies it; the variants "Gain 2" and
 *       "Gain 11" differ only in R2 (10k / 100k) — switch the active variant (Tools › Variant
 *       manager) and run again to see the output move from 1 V to 5.5 V
 *
 * Built by code like the other samples (src/ui/integration/sampleDesigns.ts); the .msim file in
 * examples/ is its serialised output (MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts
 * rewrites it). The supply is wired on section A only: the pins V+ / V- are shared by both sections.
 */
import { DesignBuilder } from '../../model/designkit';
import type { Design, TextNote } from '../../model/types';
import { addVariant, setVariantParam } from '../../model/variants';
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

export function dualOpampVariantsSample(): Design {
  const b = new DesignBuilder('Dual op-amp in sections with two gain variants');
  const d = b.design;
  d.description =
    'Một vi mạch LM358 vẽ thành hai phần: U1A là mạch đệm (bám) của điện áp vào 0,5 V, U1B khuếch đại không đảo với độ lợi 1 + R2/R1. Hai phần dùng chung tên U1 và chân nguồn (chỉ cần nối nguồn ở U1A). Mở Công cụ › Quản lý phương án lắp ráp: phương án “Độ lợi 2” để R2 = 10k, phương án “Độ lợi 11” cho R2 một giá trị riêng 100k. Chọn phương án rồi nhấn Chạy: Vout = 1 V hoặc 5,5 V.';
  // supply and input
  put(b, 'sources/dc-voltage', 'V1', 80, 120, { '+': 'VCC', '-': 'GND' }, { value: '12' });
  put(b, 'sources/dc-voltage', 'V2', 80, 280, { '+': 'IN', '-': 'GND' }, { value: '0.5' });
  // section A: voltage follower
  put(b, 'analog/lm358-dual-a', 'U1', 300, 240, { '1IN+': 'IN', '1IN-': 'BUF', '1OUT': 'BUF', 'V+': 'VCC', 'V-': 'GND' });
  // section B: non-inverting amplifier of the buffered signal (no supply wiring: the pins are shared)
  put(b, 'analog/lm358-dual-b', 'U1', 560, 240, { '2IN+': 'BUF', '2IN-': 'FB', '2OUT': 'OUT' });
  const r1 = put(b, 'basic/resistor', 'R1', 700, 380, { '1': 'FB', '2': 'GND' }, { value: '10k' });
  const r2 = put(b, 'basic/resistor', 'R2', 700, 140, { '1': 'OUT', '2': 'FB' }, { value: '10k' });
  put(b, 'basic/resistor', 'RL', 860, 260, { '1': 'OUT', '2': 'GND' }, { value: '10k' });
  note(b, 60, 470, 'U1A và U1B là hai phần của MỘT vi mạch LM358: cùng tên U1, nguồn V+ / V− nối một lần ở U1A. Báo cáo › Cổng còn trống cho biết không còn phần nào chưa dùng.');
  note(b, 60, 490, 'Công cụ › Quản lý phương án lắp ráp: hai phương án chỉ khác giá trị của R2 (10k hay 100k). Đổi phương án đang dùng rồi chạy lại để so Vout (1 V và 5,5 V).');
  void r1;
  // two builds: the saved value (10k, gain 2) and a variant with its own R2
  const first = addVariant(d, 'Độ lợi 2');
  let design = first.design;
  const second = addVariant(design, 'Độ lợi 11', first.id);
  design = setVariantParam(second.design, r2.inst.id, second.id, 'value', '100k');
  setAnalyses(design, 'op', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 5e-3 }]);
  return design;
}

export const SECTION_SAMPLE_BUILDERS: Record<string, () => Design> = {
  '73-dual-opamp-variants.msim': dualOpampVariantsSample,
};
