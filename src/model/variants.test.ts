/**
 * Design variants: the active variant decides which parts are fitted, and the netlist, the
 * simulation, the BOM, the reports and the saved file follow it.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { buildBom } from './bom';
import { placedParts } from './reports';
import { pcbComponents } from './pcb';
import { parseDesign, serializeDesign, DesignFormatError } from './serialize';
import { designToXml, xmlToDesign } from './xmlDesign';
import { activeVariant, addVariant, isFitted, notFittedCount, removeVariant, renameVariant, setActiveVariant, setFitted, variantView } from './variants';
import { runAnalyses } from '../sim';
import type { Design } from './types';

/** 10 V across R1 (1 kΩ) to OUT, then R2 (1 kΩ) and R3 (1 kΩ) in parallel from OUT to ground. */
function divider(): { design: Design; r3: string; r2: string } {
  const b = new DesignBuilder('Variant divider');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '1k' });
  const r3 = b.part('basic/resistor', 'R3', 600, 0, { value: '1k' });
  b.part('sources/ground', 'GND1', 0, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(v, '-', '0');
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r2, '1', 'OUT');
  b.labelPin(r2, '2', '0');
  b.labelPin(r3, '1', 'OUT');
  b.labelPin(r3, '2', '0');
  return { design: b.design, r3: r3.inst.id, r2: r2.inst.id };
}

const vout = (d: Design) => {
  const nb = buildNetlist(d, { includeAnalysis: false });
  expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
  const v = op.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!;
  return v.re[0];
};

/** "Full" (every part) and "Light" (R3 not fitted), "Light" active. */
function twoVariants(): { design: Design; full: string; light: string } {
  const { design: d0, r3 } = divider();
  const a = addVariant(d0, 'Full');
  const b = addVariant(a.design, 'Light');
  const d = setActiveVariant(setFitted(b.design, [r3], b.id, false), b.id);
  return { design: d, full: a.id, light: b.id };
}

describe('variants', () => {
  it('a design without variants is unchanged by the variant view', () => {
    const { design } = divider();
    expect(activeVariant(design)).toBeUndefined();
    expect(variantView(design)).toBe(design);
  });

  it('the netlist and the simulation follow the active variant', () => {
    const { design, full, light } = twoVariants();
    expect(activeVariant(design)?.name).toBe('Light');
    const nb = buildNetlist(design, { includeAnalysis: false });
    expect(nb.netlist.elements.map((e) => e.name)).not.toContain('R3');
    expect(nb.netlist.elements.map((e) => e.name)).toContain('R2');
    // R1 over R2: 10 V · 1k / 2k
    expect(vout(design)).toBeCloseTo(5, 9);
    // the full build: R2 ∥ R3 = 500 Ω → 10 · 500 / 1500
    const fullDesign = setActiveVariant(design, full);
    expect(buildNetlist(fullDesign, { includeAnalysis: false }).netlist.elements.map((e) => e.name)).toContain('R3');
    expect(vout(fullDesign)).toBeCloseTo(10 / 3, 9);
    expect(notFittedCount(design, light)).toBe(1);
    expect(notFittedCount(design, full)).toBe(0);
    // the view is computed once per design object
    expect(variantView(design)).toBe(variantView(design));
  });

  it('the BOM, the reports and the PCB export leave out the parts the variant does not fit', () => {
    const { design, full } = twoVariants();
    const refs = (d: Design) => buildBom(d).flatMap((r) => r.refdes);
    expect(refs(design)).toEqual(['R1', 'R2']);
    expect(refs(setActiveVariant(design, full))).toEqual(['R1', 'R2', 'R3']);
    const r3 = placedParts(design).find((p) => p.path === 'R3')!;
    expect(r3.inst.excludeFromSim && r3.inst.excludeFromBom).toBe(true);
    expect(pcbComponents(design).map((c) => c.ref)).not.toContain('R3');
    expect(pcbComponents(setActiveVariant(design, full)).map((c) => c.ref)).toContain('R3');
  });

  it('is saved in the .msim file and in MachSim XML, and checked when read', () => {
    const { design, light } = twoVariants();
    const back = parseDesign(serializeDesign(design));
    expect(back.variants).toEqual(design.variants);
    expect(back.sheets[0].parts.find((p) => p.refdes === 'R3')?.notFitted).toEqual([light]);
    expect(xmlToDesign(designToXml(design))).toEqual(back);
    const bad = JSON.parse(serializeDesign(design));
    bad.sheets[0].parts[3].notFitted = ['nope'];
    expect(() => parseDesign(JSON.stringify(bad))).toThrow(DesignFormatError);
    const badActive = JSON.parse(serializeDesign(design));
    badActive.variants.active = 'v9';
    expect(() => parseDesign(JSON.stringify(badActive))).toThrow(/variants\.active/);
    const empty = JSON.parse(serializeDesign(design));
    empty.variants.list = [];
    expect(() => parseDesign(JSON.stringify(empty))).toThrow(/at least one/);
  });

  it('adds (copying another variant), renames and removes variants', () => {
    const { design, light } = twoVariants();
    const copy = addVariant(design, 'Light copy', light);
    expect(copy.design.variants?.list.map((v) => v.name)).toEqual(['Full', 'Light', 'Light copy']);
    const r3 = copy.design.sheets[0].parts.find((p) => p.refdes === 'R3')!;
    expect(isFitted(r3, copy.id)).toBe(false);
    expect(renameVariant(copy.design, copy.id, '  Lite  ').variants?.list[2].name).toBe('Lite');
    expect(renameVariant(copy.design, copy.id, '   ')).toBe(copy.design);
    // removing a variant strips its id from the parts; the active one moves to the first
    const removed = removeVariant(copy.design, light);
    expect(removed.variants?.list.map((v) => v.id)).not.toContain(light);
    expect(removed.variants?.active).toBe(removed.variants?.list[0].id);
    expect(removed.sheets[0].parts.find((p) => p.refdes === 'R3')?.notFitted).toEqual([copy.id]);
    // removing every variant removes the block and every notFitted list
    const none = removeVariant(removeVariant(removed, copy.id), removed.variants!.list[0].id);
    expect(none.variants).toBeUndefined();
    expect(none.sheets[0].parts.some((p) => p.notFitted)).toBe(false);
    // fitting a part back clears its list
    const refit = setFitted(design, [design.sheets[0].parts[3].id], light, true);
    expect(refit.sheets[0].parts[3].notFitted).toBeUndefined();
    expect(setFitted(design, ['no-such-part'], light, true)).toBe(design);
  });

  it('a block that is not fitted leaves out its whole contents', () => {
    const b = new DesignBuilder('Blocks');
    const child = b.child('Load');
    b.useChild(child);
    const rl = b.part('basic/resistor', 'RL', 0, 0, { value: '1k' });
    b.label('A', 0, 0, { kind: 'hier' });
    b.labelPin(rl, '1', 'A', { kind: 'hier' });
    b.labelPin(rl, '2', '0');
    b.part('sources/ground', 'GND1', 0, 200);
    b.root();
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const blk = b.block(child, 'HB1', 300, 0);
    b.part('sources/ground', 'GND2', 0, 200);
    b.labelPin(v, '+', 'N');
    b.labelPin(v, '-', '0');
    b.labelPin(blk, 'A', 'N');
    const a = addVariant(b.design, 'Without load');
    const d = setFitted(a.design, [blk.inst.id], a.id, false);
    const names = buildNetlist(d, { includeAnalysis: false }).netlist.elements.map((e) => e.name);
    expect(names.some((n) => n.startsWith('X'))).toBe(false);
    expect(buildBom(d).flatMap((r) => r.refdes)).not.toContain('HB1/RL');
    expect(buildBom(a.design).flatMap((r) => r.refdes)).toContain('HB1/RL');
  });
});
