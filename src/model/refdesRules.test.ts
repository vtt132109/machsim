/**
 * Reference designator prefix rules (Tools > Reference designator prefixes): the pure rules, and
 * how placing, pasting, Annotate, Renumber, the netlist and the bill of materials follow them.
 */
import { describe, expect, it } from 'vitest';
import { annotateDesign } from './annotate';
import { buildBom } from './bom';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { applyRulesToDesign, effectivePrefix, libraryPrefixOf, normalizeRules, rulesActive, usedLibraryPrefixes, validateRules } from './refdesRules';
import { parseDesign, serializeDesign } from './serialize';
import { getPart } from '../library';
import { createEditor } from '../ui/store/editorStore';
import { testLookup } from '../ui/store/testParts';
import { voltageDividerExample } from '../ui/integration/exampleDesigns';
import { runAnalyses } from '../sim';
import { setLang } from '../i18n';

setLang('en');

describe('rules', () => {
  it('build a designator prefix from the library prefix: common text first, then the replacement', () => {
    expect(effectivePrefix('R', undefined)).toBe('R');
    expect(effectivePrefix('R', { global: 'A_' })).toBe('A_R');
    expect(effectivePrefix('U', { map: { U: 'U1_' } })).toBe('U1_');
    expect(effectivePrefix('U', { global: 'A_', map: { U: 'U1_' } })).toBe('A_U1_');
    expect(effectivePrefix('r', { map: { R: 'RES_' } })).toBe('RES_');
    expect(effectivePrefix('', { global: 'B_' })).toBe('B_U');
  });

  it('read a designator back into the library prefix and the number', () => {
    const rules = { global: 'A_', map: { U: 'U1_' } };
    expect(libraryPrefixOf('A_R12', rules)).toEqual({ prefix: 'R', num: 12, ruled: true });
    expect(libraryPrefixOf('A_U1_3', rules)).toEqual({ prefix: 'U', num: 3, ruled: true });
    // a name that does not follow the rules is read as itself
    expect(libraryPrefixOf('R3', rules)).toEqual({ prefix: 'R', num: 3, ruled: false });
    expect(libraryPrefixOf('XMM2', undefined)).toEqual({ prefix: 'XMM', num: 2, ruled: false });
    expect(libraryPrefixOf('A_R?', rules).num).toBeNull();
  });

  it('normalize drops empty and identical entries; no rules at all is undefined', () => {
    expect(normalizeRules({ global: ' ', map: { u: ' ', R: 'R', c: 'CAP_' } })).toEqual({ map: { C: 'CAP_' } });
    expect(normalizeRules({})).toBeUndefined();
    expect(normalizeRules(undefined)).toBeUndefined();
    expect(rulesActive({ global: 'A_' })).toBe(true);
    expect(rulesActive({ map: {} })).toBe(false);
  });

  it('validate: characters, length, a trailing digit, two kinds with the same prefix', () => {
    expect(validateRules({ global: 'A_' }, ['R', 'U'])).toEqual([]);
    expect(validateRules({ global: 'A B' }).map((p) => p.code)).toEqual(['badText']);
    expect(validateRules({ map: { U: '9U' } }).map((p) => p.code)).toEqual(['badText']);
    expect(validateRules({ map: { U: 'U'.repeat(13) } }).map((p) => p.code)).toEqual(['tooLong']);
    expect(validateRules({ map: { U: 'U1' } }).map((p) => p.code)).toEqual(['endsInDigit']);
    const clash = validateRules({ map: { U: 'X_', R: 'X_' } });
    expect(clash.map((p) => p.code)).toEqual(['clash']);
    // a mapped prefix that collides with a prefix the design already uses unchanged
    expect(validateRules({ map: { U: 'R' } }, ['R', 'U']).map((p) => p.code)).toEqual(['clash']);
  });

  it('lists the library prefixes a design uses', () => {
    const d = voltageDividerExample();
    expect(usedLibraryPrefixes(d, getPart)).toEqual(['GND', 'R', 'V', 'XMM']);
  });
});

describe('applying the rules to a design', () => {
  it('renames every part and keeps the numbers; removing the rules restores the names', () => {
    const d = voltageDividerExample();
    const r = applyRulesToDesign(d, { global: 'B1_' });
    const names = r.design.sheets[0].parts.map((p) => p.refdes).sort();
    expect(names).toEqual(['B1_GND1', 'B1_R1', 'B1_R2', 'B1_V1', 'B1_XMM1']);
    expect(r.changed).toBe(5);
    expect(r.skipped).toEqual([]);
    expect(r.design.refdesRules).toEqual({ global: 'B1_' });
    const back = applyRulesToDesign(r.design, undefined);
    expect(back.design.sheets[0].parts.map((p) => p.refdes).sort()).toEqual(['GND1', 'R1', 'R2', 'V1', 'XMM1']);
    expect(back.design.refdesRules).toBeUndefined();
  });

  it('a change of rules renames from the old rules to the new ones (A_R1 -> B_R1)', () => {
    const a = applyRulesToDesign(voltageDividerExample(), { global: 'A_' }).design;
    const b = applyRulesToDesign(a, { global: 'B_', map: { R: 'RES_' } });
    expect(b.design.sheets[0].parts.map((p) => p.refdes).sort()).toEqual(['B_GND1', 'B_RES_1', 'B_RES_2', 'B_V1', 'B_XMM1']);
  });

  it('per-kind rules only touch that kind', () => {
    const r = applyRulesToDesign(voltageDividerExample(), { map: { R: 'RES_' } });
    expect(r.design.sheets[0].parts.map((p) => p.refdes).sort()).toEqual(['GND1', 'RES_1', 'RES_2', 'V1', 'XMM1']);
    expect(r.changed).toBe(2);
  });

  it('a name the learner typed by hand keeps its letters', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'Rload1', 0, 0);
    const r = applyRulesToDesign(b.design, { global: 'A_' });
    expect(r.design.sheets[0].parts[0].refdes).toBe('A_Rload1');
  });

  it('a designator without a number is left alone', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R?', 0, 0);
    expect(applyRulesToDesign(b.design, { global: 'A_' }).design.sheets[0].parts[0].refdes).toBe('R?');
  });

  it('a name that would clash is kept and reported', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', 0, 0);
    b.part('basic/capacitor', 'C1', 100, 0);
    // R and C both become X_: R1 -> X_1, C1 -> X_1 clash
    const r = applyRulesToDesign(b.design, { map: { R: 'X_', C: 'X_' } });
    expect(r.skipped).toEqual(['C1']);
    expect(r.design.sheets[0].parts.map((p) => p.refdes)).toEqual(['X_1', 'C1']);
  });

  it('sections of one package keep sharing one designator', () => {
    const b = new DesignBuilder();
    b.part('ttl/7400-a', 'U1', 0, 0);
    b.part('ttl/7400-b', 'U1', 100, 0);
    expect(getPart('ttl/7400-a')).toBeDefined();
    const r = applyRulesToDesign(b.design, { map: { U: 'U1_' } });
    expect(new Set(r.design.sheets[0].parts.map((p) => p.refdes))).toEqual(new Set(['U1_1']));
  });

  it('returns the same design when nothing changes', () => {
    const d = voltageDividerExample();
    const same = applyRulesToDesign(d, undefined);
    expect(same.design).toBe(d);
    expect(same.changed).toBe(0);
  });

  it('children of the design are renamed too', () => {
    const b = new DesignBuilder('Top');
    const child = b.child('Amp', { kind: 'subcircuit' });
    b.part('basic/resistor', 'R1', 0, 0);
    expect(child).toBeTruthy();
    const r = applyRulesToDesign(b.design, { global: 'Z_' });
    expect(r.design.children![0].sheets[0].parts[0].refdes).toBe('Z_R1');
  });
});

describe('annotation, placing and pasting follow the rules', () => {
  it('Annotate (missing and all) numbers with the designed prefix', () => {
    const b = new DesignBuilder();
    b.design.refdesRules = { global: 'A_' };
    b.part('basic/resistor', 'R?', 0, 0);
    b.part('basic/resistor', '', 100, 0);
    b.part('basic/capacitor', 'C?', 200, 0);
    const missing = annotateDesign(b.design, { mode: 'missing' });
    expect(missing.design.sheets[0].parts.map((p) => p.refdes)).toEqual(['A_R1', 'A_R2', 'A_C1']);
    const all = annotateDesign(missing.design, { mode: 'all' });
    expect(all.design.sheets[0].parts.map((p) => p.refdes)).toEqual(['A_R1', 'A_R2', 'A_C1']);
  });

  it('a part placed after the rule is set gets the designed name, numbers continue', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    ed.actions.setRefdesRules({ global: 'A_', map: { R: 'RES_' } }, true);
    ed.actions.placePart('test/resistor', { x: 100, y: 0 });
    ed.actions.placePart('test/capacitor', { x: 200, y: 0 });
    expect(ed.getState().design.sheets[0].parts.map((p) => p.refdes)).toEqual(['A_RES_1', 'A_RES_2', 'A_C1']);
  });

  it('setting the rules without renaming leaves the placed parts; Renumber applies the rules to all', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    const r = ed.actions.setRefdesRules({ global: 'M_' }, false);
    expect(r.changed).toBe(0);
    expect(ed.getState().design.sheets[0].parts[0].refdes).toBe('R1');
    ed.actions.renumber();
    expect(ed.getState().design.sheets[0].parts[0].refdes).toBe('M_R1');
  });

  it('a paste gets the designed prefix and the next free number', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    ed.actions.setRefdesRules({ global: 'A_' }, true);
    ed.actions.selectAll();
    ed.actions.copy();
    ed.actions.paste({ x: 200, y: 200 });
    expect(ed.getState().design.sheets[0].parts.map((p) => p.refdes)).toEqual(['A_R1', 'A_R2']);
  });

  it('is one undo step and removing the rules restores the names', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    const before = ed.getState().design;
    ed.actions.setRefdesRules({ global: 'A_' }, true);
    expect(ed.getState().design.sheets[0].parts[0].refdes).toBe('A_R1');
    ed.actions.undo();
    expect(ed.getState().design).toBe(before);
    ed.actions.redo();
    ed.actions.setRefdesRules(undefined, true);
    expect(ed.getState().design.sheets[0].parts[0].refdes).toBe('R1');
    expect(ed.getState().design.refdesRules).toBeUndefined();
  });
});

describe('the netlist and the bill of materials take designed names', () => {
  it('the circuit still simulates to the same voltage and every element carries the new name', async () => {
    const plain = voltageDividerExample();
    const ruled = applyRulesToDesign(plain, { global: 'B1_' }).design;
    const run = async (d: typeof plain) => {
      const build = buildNetlist(d, { includeAnalysis: false });
      expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
      const [res] = await Promise.resolve(runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] }));
      const out = res.vectors.find((v) => v.name.toUpperCase() === 'V(OUT)')!;
      return { build, v: out.re[0] };
    };
    const a = await run(plain);
    const b = await run(ruled);
    expect(b.v).toBeCloseTo(a.v, 9);
    expect(a.v).toBeGreaterThan(3);
    const names = b.build.netlist.elements.map((e) => e.name);
    expect(names.some((n) => n.includes('B1_R1'))).toBe(true);
    expect(names.some((n) => n.includes('B1_V1'))).toBe(true);
    expect(a.build.netlist.elements.map((e) => e.name).some((n) => n.includes('B1_'))).toBe(false);
  });

  it('the BOM groups the designed names and sorts them by prefix and number', () => {
    const b = new DesignBuilder();
    b.design.refdesRules = { global: 'A_' };
    b.part('basic/resistor', 'A_R10', 0, 0, { value: '1k' });
    b.part('basic/resistor', 'A_R2', 100, 0, { value: '1k' });
    b.part('basic/resistor', 'A_R1', 200, 0, { value: '4.7k' });
    b.part('basic/capacitor', 'A_C1', 300, 0, { value: '100n' });
    const rows = buildBom(b.design);
    expect(rows.map((r) => r.refdes.join(' '))).toEqual(['A_C1', 'A_R1', 'A_R2 A_R10']);
  });
});

describe('rules in the design file', () => {
  it('round-trip byte for byte; a design without rules writes nothing', () => {
    const d = voltageDividerExample();
    expect(serializeDesign(d)).not.toContain('refdesRules');
    const ruled = applyRulesToDesign(d, { global: 'A_', map: { U: 'U1_' } }).design;
    const text = serializeDesign(ruled);
    expect(text).toContain('"refdesRules"');
    const back = parseDesign(text);
    expect(back.refdesRules).toEqual({ global: 'A_', map: { U: 'U1_' } });
    expect(serializeDesign(back)).toBe(text);
  });
});
