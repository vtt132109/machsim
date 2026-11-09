import { describe, expect, it } from 'vitest';
import { annotateDesign, nextRefdes, splitRefdes } from './annotate';
import { DesignBuilder } from './designkit';

describe('splitRefdes', () => {
  it('splits prefix and number', () => {
    expect(splitRefdes('R12')).toEqual({ prefix: 'R', num: 12 });
    expect(splitRefdes('XMM3')).toEqual({ prefix: 'XMM', num: 3 });
    expect(splitRefdes('LED10')).toEqual({ prefix: 'LED', num: 10 });
    expect(splitRefdes('R?')).toEqual({ prefix: 'R', num: null });
    expect(splitRefdes('U')).toEqual({ prefix: 'U', num: null });
    expect(splitRefdes('12')).toEqual({ prefix: '12', num: null });
  });
});

describe('nextRefdes', () => {
  it('returns the smallest free number per prefix across sheets', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', 0, 0);
    b.part('basic/resistor', 'R3', 100, 0);
    b.addSheet();
    b.part('basic/resistor', 'r2', 0, 0);
    b.part('basic/capacitor', 'C1', 100, 0);
    expect(nextRefdes(b.design, 'R')).toBe('R4');
    expect(nextRefdes(b.design, 'C')).toBe('C2');
    expect(nextRefdes(b.design, 'Q')).toBe('Q1');
    b.design.sheets[0].parts[1].refdes = 'R7';
    expect(nextRefdes(b.design, 'R')).toBe('R3');
  });
});

describe('annotateDesign', () => {
  function sample() {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R5', 200, 0);
    b.part('basic/resistor', 'R?', 0, 100);
    b.part('basic/resistor', '', 0, 0);
    b.part('basic/capacitor', 'C1', 100, 0);
    b.part('basic/capacitor', 'C1', 300, 0);
    b.part('instruments/multimeter', 'XMM', 400, 0);
    return b.design;
  }

  it("'missing' mode keeps valid unique designators and fills the rest", () => {
    const d = sample();
    const { design, changes } = annotateDesign(d);
    const refs = design.sheets[0].parts.map((p) => p.refdes);
    // position order: (0,0) '' -> R1, (100,0) C1 kept, (200,0) R5 kept, (300,0) duplicate C1 -> C2, (400,0) XMM1, (0,100) 'R?' -> R2
    expect(refs).toEqual(['R5', 'R2', 'R1', 'C1', 'C2', 'XMM1']);
    expect(Object.keys(changes)).toHaveLength(4);
    expect(d.sheets[0].parts.map((p) => p.refdes)).toEqual(['R5', 'R?', '', 'C1', 'C1', 'XMM']);
  });

  it("'all' mode renumbers by position, or by placement order", () => {
    const pos = annotateDesign(sample(), { mode: 'all' }).design.sheets[0].parts.map((p) => p.refdes);
    expect(pos).toEqual(['R2', 'R3', 'R1', 'C1', 'C2', 'XMM1']);
    const placed = annotateDesign(sample(), { mode: 'all', order: 'placement' }).design.sheets[0].parts.map((p) => p.refdes);
    expect(placed).toEqual(['R1', 'R2', 'R3', 'C1', 'C2', 'XMM1']);
  });

  it('keeps the sections of one package on one designator', () => {
    const chip = () => {
      const b = new DesignBuilder();
      b.part('ttl/7400-a', 'U1', 0, 200);
      b.part('ttl/7400-b', 'U1', 200, 0);
      b.part('basic/resistor', 'R?', 400, 0);
      return b.design;
    };
    // 'missing': the second section is not a duplicate designator
    const miss = annotateDesign(chip()).design;
    expect(miss.sheets[0].parts.map((p) => p.refdes)).toEqual(['U1', 'U1', 'R1']);
    // 'all': the chip is numbered once
    const all = annotateDesign(chip(), { mode: 'all' }).design;
    expect(all.sheets[0].parts.map((p) => p.refdes)).toEqual(['U1', 'U1', 'R1']);
    // two chips are still two
    const b = new DesignBuilder();
    b.part('ttl/7400-a', 'U5', 0, 0);
    b.part('ttl/7400-b', 'U5', 100, 0);
    b.part('ttl/7400-a', 'U?', 200, 0);
    const two = annotateDesign(b.design, { mode: 'all' }).design;
    expect(two.sheets[0].parts.map((p) => p.refdes)).toEqual(['U1', 'U1', 'U2']);
  });

  it('numbers continue across sheets', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R?', 0, 0);
    b.addSheet();
    b.part('basic/resistor', 'R?', 0, 0);
    b.part('basic/resistor', 'R1', 50, 0);
    const out = annotateDesign(b.design).design;
    expect(out.sheets[0].parts[0].refdes).toBe('R2');
    expect(out.sheets[1].parts.map((p) => p.refdes)).toEqual(['R3', 'R1']);
  });
});
