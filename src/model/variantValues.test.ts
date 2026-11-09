/**
 * Per-variant values (round 4 step 4): a variant can give a part another parameter value or BOM
 * field and a global parameter another expression. The netlist, the simulation, the BOM, the PCB
 * export, the snippets and the saved file all follow the active variant, and a file written before
 * the feature (variants with only `notFitted`) loads unchanged.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { buildBom } from './bom';
import { pcbComponents } from './pcb';
import { parseDesign, serializeDesign, DesignFormatError } from './serialize';
import { parseDesignSafely, sanitizeIncoming } from './sanitize';
import { buildSnippet, readSnippet, snippetText } from './snippet';
import { designToXml, xmlToDesign } from './xmlDesign';
import {
  activeVariant,
  addVariant,
  clearVariantValues,
  effectiveInstance,
  effectiveVariables,
  removeVariant,
  setActiveVariant,
  setFitted,
  setVariantField,
  setVariantParam,
  setVariantVariable,
  variantChanges,
  variantView,
} from './variants';
import { runAnalyses } from '../sim';
import { copyItems } from '../ui/store/designOps';
import { partLookup } from '../ui/store';
import type { Design } from './types';

/** 10 V → R1 (1k) → OUT → R2 (1k) → ground, R3 (1k) in parallel with R2; RL is a global parameter. */
function divider(): { design: Design; r1: string; r2: string; r3: string } {
  const b = new DesignBuilder('Variant values');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '{RL}' });
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
  b.design.variables = { RL: '1k' };
  return { design: b.design, r1: r1.inst.id, r2: r2.inst.id, r3: r3.inst.id };
}

const vout = (d: Design): number => {
  const nb = buildNetlist(d, { includeAnalysis: false });
  expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
  return op.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!.re[0];
};

/** "Cheap" (saved values) and "Precise" (R1 = 3k, R3 not fitted, RL = 3k) with "Precise" active. */
function twoBuilds() {
  const { design: d0, r1, r2, r3 } = divider();
  const cheap = addVariant(d0, 'Cheap');
  const precise = addVariant(cheap.design, 'Precise');
  let d = precise.design;
  d = setVariantParam(d, r1, precise.id, 'value', '3k');
  d = setFitted(d, [r3], precise.id, false);
  d = setVariantVariable(d, precise.id, 'RL', '3k');
  return { design: setActiveVariant(d, precise.id), cheap: cheap.id, precise: precise.id, r1, r2, r3 };
}

describe('per-variant values', () => {
  it('the simulation uses the active variant: part value, global parameter and not-fitted together', () => {
    const { design, cheap, precise } = twoBuilds();
    // Precise: R1 = 3k, R2 = RL = 3k, R3 absent → 10 · 3k / 6k
    expect(vout(design)).toBeCloseTo(5, 9);
    const elements = buildNetlist(design, { includeAnalysis: false }).netlist.elements;
    expect(elements.find((e) => e.name === 'R1')?.value).toBeCloseTo(3000, 9);
    expect(elements.some((e) => e.name === 'R3')).toBe(false);
    // Cheap keeps the saved values: R2 ∥ R3 = 500 → 10 · 500 / 1500
    const cheapDesign = setActiveVariant(design, cheap);
    expect(vout(cheapDesign)).toBeCloseTo(10 / 3, 9);
    expect(activeVariant(design)?.id).toBe(precise);
    // the saved design is untouched: the values live next to it
    expect(design.sheets[0].parts.find((p) => p.refdes === 'R1')?.params.value).toBe('1k');
    expect(design.variables.RL).toBe('1k');
    expect(effectiveVariables(design).RL).toBe('3k');
    expect(effectiveVariables(design, cheap).RL).toBe('1k');
  });

  it('only the variant views of changed parts are new objects', () => {
    const { design, r1 } = twoBuilds();
    const view = variantView(design);
    const before = design.sheets[0].parts;
    const after = view.sheets[0].parts;
    expect(after.find((p) => p.id === r1)).not.toBe(before.find((p) => p.id === r1));
    expect(after.find((p) => p.refdes === 'V1')).toBe(before.find((p) => p.refdes === 'V1'));
    // a part the variant does not change keeps its identity (the canvas relies on it)
    const v1 = before.find((p) => p.refdes === 'V1')!;
    expect(effectiveInstance(v1, activeVariant(design)?.id)).toBe(v1);
  });

  it('the BOM, the PCB export and the part values follow the active variant', () => {
    const { design, cheap, r1 } = twoBuilds();
    const withField = setVariantField(design, r1, activeVariant(design)!.id, 'partNumber', 'RC0603-3K');
    const bom = buildBom(withField);
    const row = bom.find((r) => r.refdes.includes('R1'))!;
    expect(row.value).toMatch(/3\s?k/i);
    expect(row.partNumber).toBe('RC0603-3K');
    expect(bom.flatMap((r) => r.refdes)).not.toContain('R3');
    const pcb = pcbComponents(withField);
    expect(pcb.find((c) => c.ref === 'R1')?.value).toMatch(/3\s?k/i);
    // the cheap build: the saved 1k value, no part number, R3 fitted
    const cheapBom = buildBom(setActiveVariant(withField, cheap));
    const cheapRow = cheapBom.find((r) => r.refdes.includes('R1'))!;
    expect(cheapRow.value).toMatch(/1\s?k/i);
    expect(cheapRow.partNumber ?? '').toBe('');
    expect(cheapBom.flatMap((r) => r.refdes)).toContain('R3');
  });

  it('edits: a value equal to the saved one or an empty value removes the override', () => {
    const { design, precise, r1, r2 } = twoBuilds();
    const same = setVariantParam(design, r1, precise, 'value', '1k');
    expect(same.sheets[0].parts.find((p) => p.id === r1)?.variantValues).toBeUndefined();
    const cleared = setVariantParam(design, r1, precise, 'value', '  ');
    expect(cleared.sheets[0].parts.find((p) => p.id === r1)?.variantValues).toBeUndefined();
    // nothing to change: same object
    expect(setVariantParam(design, r1, precise, 'value', '3k')).toBe(design);
    expect(setVariantParam(design, r2, precise, 'value', '{RL}')).toBe(design);
    expect(setVariantParam(design, r1, 'nope', 'value', '5k')).toBe(design);
    expect(clearVariantValues(design, [r1], precise).sheets[0].parts.find((p) => p.id === r1)?.variantValues).toBeUndefined();
    const noVar = setVariantVariable(design, precise, 'RL', '1k');
    expect(noVar.variants?.list.find((v) => v.id === precise)?.variables).toBeUndefined();
  });

  it('lists what a variant changes against the saved design', () => {
    const { design, precise, cheap } = twoBuilds();
    expect(variantChanges(design, precise)).toEqual([
      { kind: 'param', path: 'R1', key: 'value', from: '1k', to: '3k' },
      { kind: 'notFitted', path: 'R3', key: '', from: '', to: '' },
      { kind: 'variable', path: '', key: 'RL', from: '1k', to: '3k' },
    ]);
    expect(variantChanges(design, cheap)).toEqual([]);
  });

  it('a new variant copied from another one copies its values; removing a variant removes them', () => {
    const { design, precise, r1 } = twoBuilds();
    const copy = addVariant(design, 'Precise 2', precise);
    const part = copy.design.sheets[0].parts.find((p) => p.id === r1)!;
    expect(part.variantValues?.[copy.id]?.params?.value).toBe('3k');
    expect(part.variantValues?.[precise]?.params?.value).toBe('3k');
    expect(copy.design.variants?.list.find((v) => v.id === copy.id)?.variables).toEqual({ RL: '3k' });
    // the copy is independent
    const edited = setVariantParam(copy.design, r1, copy.id, 'value', '9k');
    expect(edited.sheets[0].parts.find((p) => p.id === r1)?.variantValues?.[precise]?.params?.value).toBe('3k');
    const removed = removeVariant(copy.design, precise);
    const left = removed.sheets[0].parts.find((p) => p.id === r1)!;
    expect(Object.keys(left.variantValues ?? {})).toEqual([copy.id]);
    const none = removeVariant(removeVariant(removed, copy.id), removed.variants!.list[0].id);
    expect(none.variants).toBeUndefined();
    expect(none.sheets[0].parts.some((p) => p.variantValues)).toBe(false);
  });
});

describe('per-variant values in files', () => {
  it('are saved byte for byte, in MachSim XML too, and checked when read', () => {
    const { design, precise } = twoBuilds();
    const text = serializeDesign(design);
    const back = parseDesign(text);
    expect(serializeDesign(back)).toBe(text);
    expect(back.variants?.list.find((v) => v.id === precise)?.variables).toEqual({ RL: '3k' });
    expect(back.sheets[0].parts.find((p) => p.refdes === 'R1')?.variantValues).toEqual({ [precise]: { params: { value: '3k' } } });
    expect(xmlToDesign(designToXml(design))).toEqual(back);
    const bad = JSON.parse(text);
    bad.sheets[0].parts.find((p: { refdes: string }) => p.refdes === 'R1').variantValues = { nope: { params: { value: '5k' } } };
    expect(() => parseDesign(JSON.stringify(bad))).toThrow(DesignFormatError);
    expect(() => parseDesign(JSON.stringify(bad))).toThrow(/unknown variant id/);
    const typo = JSON.parse(text);
    typo.sheets[0].parts.find((p: { refdes: string }) => p.refdes === 'R1').variantValues[precise].param = {};
    expect(() => parseDesign(JSON.stringify(typo))).toThrow(/unknown entry/);
  });

  it('a file written before per-variant values (variants with notFitted only) loads unchanged', () => {
    const { design: d0, r3 } = divider();
    const a = addVariant(d0, 'Full');
    const b = addVariant(a.design, 'Light');
    const old = setFitted(b.design, [r3], b.id, false);
    const text = serializeDesign(old);
    // nothing of the new fields is written for a design that does not use them
    expect(text).not.toContain('variantValues');
    expect(JSON.parse(text).variants.list[0]).toEqual({ id: a.id, name: 'Full' });
    const back = parseDesign(text);
    expect(back).toEqual(old);
    expect(serializeDesign(back)).toBe(text);
    const safe = parseDesignSafely(text);
    expect(safe.notes).toEqual([]);
    expect(safe.design).toEqual(back);
    // the behaviour is the old one: the variant leaves R3 out, every other value is the saved one
    expect(vout(setActiveVariant(back, b.id))).toBeCloseTo(5, 9);
    expect(vout(setActiveVariant(back, a.id))).toBeCloseTo(10 / 3, 9);
  });

  it('a file naming a variant nothing declares still opens (the values of that variant are dropped, with a note)', () => {
    const { design, precise } = twoBuilds();
    const raw = JSON.parse(serializeDesign(design));
    raw.sheets[0].parts.find((p: { refdes: string }) => p.refdes === 'R1').variantValues.ghost = { params: { value: '5k' } };
    const r = parseDesignSafely(JSON.stringify(raw));
    expect(r.notes.map((n) => n.code)).toContain('variantDropped');
    const r1 = r.design.sheets[0].parts.find((p) => p.refdes === 'R1')!;
    expect(Object.keys(r1.variantValues ?? {})).toEqual([precise]);
  });
});

describe('per-variant values in snippets and paste', () => {
  it('a snippet keeps every variant, and the values come back through a name match', () => {
    const { design, precise, r1 } = twoBuilds();
    const clip = copyItems(design, design.sheets[0].id, [{ kind: 'part', id: r1 }], partLookup)!;
    const data = readSnippet(JSON.parse(snippetText(buildSnippet(design, clip, new Date(0)))));
    expect(data.variants?.list.map((v) => v.name)).toEqual(['Precise']);
    expect(data.fragment.parts[0].variantValues?.[precise]?.params?.value).toBe('3k');
    // a target design whose variant has the same name under another id: "v2" there is "Other"
    const target = new DesignBuilder('Target').design;
    const first = addVariant(target, 'Precise');
    const withVariant = addVariant(first.design, 'Other');
    expect(precise).toBe(withVariant.id);
    const out = sanitizeIncoming(withVariant.design, data.fragment, { variants: data.variants });
    const placed = out.fragment.parts[0];
    expect(Object.keys(placed.variantValues ?? {})).toEqual([first.id]);
    expect(placed.variantValues?.[first.id]?.params?.value).toBe('3k');
    expect(out.notes.map((n) => n.code)).toContain('variantRemapped');
    // a target without that variant: the values of the variant are dropped, never left dangling
    const bare = sanitizeIncoming(target, data.fragment, { variants: data.variants });
    expect(bare.fragment.parts[0].variantValues).toBeUndefined();
    expect(bare.notes.map((n) => n.code)).toContain('variantDropped');
  });

  it('a snippet saved "as the active variant builds it" carries the variant values as the saved ones', () => {
    const { design, r1, r3 } = twoBuilds();
    const clip = copyItems(design, design.sheets[0].id, [{ kind: 'part', id: r1 }, { kind: 'part', id: r3 }, { kind: 'part', id: design.sheets[0].parts.find((p) => p.refdes === 'R2')!.id }], partLookup)!;
    const baked = buildSnippet(design, clip, new Date(0), { bakeVariant: true });
    expect(baked.variants).toBeUndefined();
    const byRef = (ref: string) => baked.fragment.parts.find((p) => p.refdes === ref)!;
    expect(byRef('R1').params.value).toBe('3k');
    expect(byRef('R1').variantValues).toBeUndefined();
    // R3 is not fitted in the active variant: it stays in the picture but is left out of simulation and BOM
    expect(byRef('R3').excludeFromSim && byRef('R3').excludeFromBom).toBe(true);
    expect(byRef('R3').notFitted).toBeUndefined();
    // R2 refers to RL: the snippet carries RL as the active variant defines it
    expect(baked.variables).toEqual({ RL: '3k' });
    // the design itself is untouched and the plain snippet keeps the saved RL with its variant
    const plain = buildSnippet(design, clip, new Date(0));
    expect(plain.variables).toEqual({ RL: '1k' });
    expect(plain.variants?.list.map((v) => v.name)).toEqual(['Precise']);
    expect(() => readSnippet(JSON.parse(snippetText(baked)))).not.toThrow();
    expect(() => readSnippet(JSON.parse(snippetText(plain)))).not.toThrow();
  });
});
