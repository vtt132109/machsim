import { describe, expect, it } from 'vitest';
import { buildGuide, cssColorName } from './guide';
import { autoPlace } from './autoplace';
import { astable555Circuit, dividerCircuit, seriesLedCircuit, transistorSwitchCircuit } from './examples';
import { DesignBuilder } from '../model/designkit';

describe('assembly guide', () => {
  it('walks through the series LED circuit in bench order', () => {
    const design = seriesLedCircuit();
    const layout = autoPlace(design);
    const steps = buildGuide(design, layout);
    expect(steps.map((s) => s.kind)).toEqual(['intro', 'rails', 'part', 'part', 'wire', 'wire', 'clip', 'clip', 'check']);
    expect(steps[0].text.vi).toContain('breadboard lớn (830 lỗ, 63 cột)');
    expect(steps[0].text.vi).toContain('2 linh kiện, 2 dây nối và 2 dây kẹp');
    expect(steps[1].text.vi).toContain('Thanh nguồn + phía trên (ký hiệu top+) dùng cho VBAT.');
    expect(steps[1].text.vi).toContain('Thanh nguồn − phía trên (ký hiệu top-) dùng cho GND.');

    const r1 = steps.find((s) => s.refdes === 'R1')!;
    const p = layout.placements.find((x) => x.refdes === 'R1')!;
    expect(r1.text.vi).toBe(`Cắm điện trở R1 470 Ω (vạch màu: vàng – tím – nâu – nhũ vàng) vào ${p.pins['1'].row}${p.pins['1'].col} – ${p.pins['2'].row}${p.pins['2'].col}. Điện trở không có cực tính, cắm chiều nào cũng được.`);
    expect(r1.text.en).toContain('bands: yellow – violet – brown – gold');
    expect(r1.holes).toEqual([p.pins['1'], p.pins['2']]);

    const led = steps.find((s) => s.refdes === 'LED1' && s.kind === 'part')!;
    const lp = layout.placements.find((x) => x.refdes === 'LED1')!;
    expect(led.text.vi).toContain(`màu đỏ: chân dài (anode, +) vào ${lp.pins.A.row}${lp.pins.A.col}`);
    // LEDs come after resistors
    expect(steps.indexOf(led)).toBeGreaterThan(steps.indexOf(r1));

    const wire = steps.find((s) => s.kind === 'wire')!;
    expect(wire.text.vi).toMatch(/^Nối dây (đỏ|đen) từ a\d+ đến top[+-]\d+ \(đưa (VBAT|GND) ra thanh nguồn\)\.$/);
    const clip = steps.find((s) => s.kind === 'clip')!;
    // each language names the part in that language (library translation "Pin" / "Battery")
    expect(clip.text.vi).toContain('Kẹp dây đỏ từ BAT1.+ (cực dương) của BAT1 (Pin) vào top+');
    expect(clip.text.en).toContain('of BAT1 (Battery) to top+');
    expect(clip.text.vi).toContain('Luôn nối nguồn sau cùng');
    expect(steps[steps.length - 1].text.vi).toContain('khớp hoàn toàn với sơ đồ');
  });

  it('explains the DIP orientation, capacitor markings and polarity in the 555 circuit', () => {
    const design = astable555Circuit();
    const layout = autoPlace(design);
    const steps = buildGuide(design, layout);
    const parts = steps.filter((s) => s.kind === 'part');
    expect(parts[0].refdes).toBe('U1');
    const u = layout.placements.find((p) => p.refdes === 'U1')!;
    expect(parts[0].text.vi).toContain(`Cắm IC U1 (555, 8 chân) vắt ngang rãnh giữa, khấc`);
    expect(parts[0].text.vi).toContain(`Chân 1 (cạnh chấm tròn) vào f${u.pins.GND.col}, chân 8 vào e${u.pins.VCC.col}`);
    expect(steps.find((s) => s.refdes === 'C2')!.text.vi).toContain('Cắm tụ gốm C2 10 nF (in mã "103K")');
    const c1 = layout.placements.find((p) => p.refdes === 'C1')!;
    expect(steps.find((s) => s.refdes === 'C1' && s.kind === 'part')!.text.vi).toBe(
      `Cắm tụ hoá C1 10µF 25V: chân dài (+) vào ${c1.pins['+'].row}${c1.pins['+'].col}, chân ngắn (−, phía có vạch sọc) vào ${c1.pins['-'].row}${c1.pins['-'].col}.`,
    );
    expect(steps.find((s) => s.refdes === 'R2')!.text.vi).toContain('nâu – đen – vàng – nhũ vàng');
    // rail bridges come before the other jumpers
    const wires = steps.filter((s) => s.kind === 'wire');
    expect(wires[0].text.vi).toContain('nối hai thanh nguồn cùng loại');
  });

  it('gives the transistor lead order', () => {
    const design = transistorSwitchCircuit();
    const layout = autoPlace(design);
    const q = layout.placements.find((p) => p.refdes === 'Q1')!;
    const step = buildGuide(design, layout).find((s) => s.refdes === 'Q1')!;
    expect(step.text.vi).toBe(
      `Cắm Q1 (2N3904) với mặt phẳng có chữ quay về phía bạn. Thứ tự chân từ trái sang phải: E-B-C → e${q.pins.E.col} – e${q.pins.B.col} – e${q.pins.C.col}.`,
    );
  });

  it('reports remaining problems in the final step', () => {
    const design = dividerCircuit();
    const layout = autoPlace(design);
    const broken = { ...layout, wires: [] };
    const last = buildGuide(design, broken).at(-1)!;
    expect(last.kind).toBe('check');
    expect(last.text.vi).toBe('Bố trí còn 2 lỗi và 0 cảnh báo. Mở "Kiểm tra mạch" để xem chi tiết trước khi cấp nguồn.');
    expect(last.holes.length).toBeGreaterThan(0);
  });

  it('mentions split rails and uses no rails when none are needed', () => {
    const design = seriesLedCircuit();
    const layout = autoPlace(design, { splitRails: true });
    expect(buildGuide(design, layout)[0].text.vi).toContain('thanh nguồn tách đôi');
    const b = new DesignBuilder('passive');
    const r1 = b.part('basic/resistor', 'R1', 0, 0);
    const r2 = b.part('basic/resistor', 'R2', 300, 0);
    b.labelPin(r1, '2', 'X');
    b.labelPin(r2, '1', 'X');
    const g = buildGuide(b.design, autoPlace(b.design));
    expect(g[1].text.vi).toBe('Mạch không dùng thanh nguồn.');
  });

  it('names wire colours', () => {
    expect(cssColorName('#d32f2f').vi).toBe('đỏ');
    expect(cssColorName('#212121').vi).toBe('đen');
    expect(cssColorName('#1565c0').vi).toBe('xanh dương');
    expect(cssColorName('#fdd835').vi).toBe('vàng');
    expect(cssColorName('#ef6c00').vi).toBe('cam');
    expect(cssColorName('#7b1fa2').vi).toBe('tím');
    expect(cssColorName('#9e9e9e').vi).toBe('xám');
    expect(cssColorName('#2e7d32').en).toBe('green');
    expect(cssColorName('white').vi).toBe('trắng');
    expect(cssColorName('#fa0').en).toBe('orange');
  });
});
