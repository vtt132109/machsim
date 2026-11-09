/**
 * Edit > Paste special: paste keeping the names, paste values only, paste as a subcircuit, and how
 * each of them behaves across two open documents (the integrity layer decides what a pasted
 * fragment may keep).
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from './editorStore';
import { testLookup } from './testParts';
import { createDocumentManager } from '../app/documents';
import { newDesign } from '../../model/types';
import { parseDesign, serializeDesign } from '../../model/serialize';
import { setLang } from '../../i18n';

setLang('en');

function setup() {
  const ed = createEditor({ lookup: testLookup });
  const manager = createDocumentManager({ editor: ed, blank: () => newDesign('Blank') });
  return { ed, manager };
}

type Ed = ReturnType<typeof setup>['ed'];
const parts = (ed: Ed) => ed.getState().design.sheets[0].parts;
const names = (ed: Ed) => parts(ed).map((p) => p.refdes);

/** two resistors R1 (2.2k) and R2 (4.7k) joined by a wire, with a capacitor C1, all selected and copied */
function copyThree(ed: Ed) {
  const r1 = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
  const r2 = ed.actions.placePart('test/resistor', { x: 300, y: 100 })!;
  ed.actions.placePart('test/capacitor', { x: 500, y: 100 });
  ed.actions.setPartParam(r1, 'value', '2.2k');
  ed.actions.setPartParam(r2, 'value', '4.7k');
  ed.actions.addWire([
    { x: 130, y: 100 },
    { x: 270, y: 100 },
  ]);
  ed.actions.selectAll();
  ed.actions.copy();
  return { r1, r2 };
}

describe('paste without renaming', () => {
  it('after a cut the pasted parts keep their designators', () => {
    const { ed } = setup();
    copyThree(ed);
    ed.actions.deleteSelection();
    expect(parts(ed)).toHaveLength(0);
    const r = ed.actions.pasteSpecial('keepNames', { at: { x: 100, y: 100 } });
    expect(r).toEqual({ ok: true, count: 3, renamed: 0 });
    expect(names(ed)).toEqual(['R1', 'R2', 'C1']);
  });

  it('a designator that is taken gets the next free number, and the count says how many', () => {
    const { ed } = setup();
    copyThree(ed);
    const r = ed.actions.pasteSpecial('keepNames', { at: { x: 100, y: 400 } });
    expect(r).toEqual({ ok: true, count: 3, renamed: 3 });
    expect(names(ed)).toEqual(['R1', 'R2', 'C1', 'R3', 'R4', 'C2']);
  });

  it('into another document the names stay where they are free', async () => {
    const { ed, manager } = setup();
    copyThree(ed);
    await manager.open(newDesign('B'), 'b.msim');
    ed.actions.placePart('test/resistor', { x: 0, y: 0 }); // R1 is taken here
    const r = ed.actions.pasteSpecial('keepNames', { at: { x: 100, y: 300 } });
    expect(r).toMatchObject({ ok: true, count: 3, renamed: 1 });
    // R2 and C1 kept; the pasted R1 became R3 (the first free number after R1, R2)
    expect(new Set(names(ed))).toEqual(new Set(['R1', 'R2', 'R3', 'C1']));
  });

  it('is one undo step', () => {
    const { ed } = setup();
    copyThree(ed);
    const before = ed.getState().design;
    ed.actions.pasteSpecial('keepNames');
    ed.actions.undo();
    expect(ed.getState().design).toBe(before);
  });
});

describe('paste values only', () => {
  it('copies the values onto the selected parts of the same kind and nothing else', () => {
    const { ed } = setup();
    const r1 = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    ed.actions.setPartParam(r1, 'value', '10k');
    ed.actions.select([{ kind: 'part', id: r1 }]);
    ed.actions.copy();
    const a = ed.actions.placePart('test/resistor', { x: 300, y: 200 })!;
    const b = ed.actions.placePart('test/resistor', { x: 500, y: 200 })!;
    const c = ed.actions.placePart('test/capacitor', { x: 700, y: 200 })!;
    const before = Object.fromEntries(parts(ed).map((p) => [p.id, { x: p.x, y: p.y, refdes: p.refdes }]));
    ed.actions.select([a, b, c].map((id) => ({ kind: 'part' as const, id })));
    const r = ed.actions.pasteSpecial('values');
    // two resistors received the value; the capacitor has no copied partner
    expect(r).toEqual({ ok: true, count: 2 });
    const byId = Object.fromEntries(parts(ed).map((p) => [p.id, p]));
    expect(byId[a].params.value).toBe('10k');
    expect(byId[b].params.value).toBe('10k');
    expect(byId[c].params.value).not.toBe('10k');
    // position, designator, wiring untouched
    for (const p of parts(ed)) expect({ x: p.x, y: p.y, refdes: p.refdes }).toEqual(before[p.id]);
    expect(parts(ed)).toHaveLength(4);
  });

  it('matches the copied part with the same designator first, otherwise in order', () => {
    const { ed } = setup();
    const { r1, r2 } = copyThree(ed);
    // select R2 then R1 and paste values: R1 must receive 2.2k and R2 4.7k (they already have them)
    ed.actions.select([{ kind: 'part', id: r2 }, { kind: 'part', id: r1 }]);
    expect(ed.actions.pasteSpecial('values')).toEqual({ ok: false, reason: 'nothingMatched' });
    ed.actions.setPartParam(r1, 'value', '999');
    ed.actions.setPartParam(r2, 'value', '888');
    ed.actions.select([{ kind: 'part', id: r2 }, { kind: 'part', id: r1 }]);
    expect(ed.actions.pasteSpecial('values')).toEqual({ ok: true, count: 2 });
    const byId = Object.fromEntries(parts(ed).map((p) => [p.id, p]));
    expect(byId[r1].params.value).toBe('2.2k');
    expect(byId[r2].params.value).toBe('4.7k');
  });

  it('says why nothing happened: no target, or no part of the same kind', () => {
    const { ed } = setup();
    const r1 = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    const c1 = ed.actions.placePart('test/capacitor', { x: 100, y: 0 })!;
    ed.actions.select([{ kind: 'part', id: r1 }]);
    ed.actions.copy();
    ed.actions.clearSelection();
    expect(ed.actions.pasteSpecial('values')).toEqual({ ok: false, reason: 'noTarget' });
    ed.actions.select([{ kind: 'part', id: c1 }]);
    expect(ed.actions.pasteSpecial('values')).toEqual({ ok: false, reason: 'nothingMatched' });
  });

  it('a value that names a global parameter of another document brings the parameter along', async () => {
    const { ed, manager } = setup();
    const r1 = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    ed.actions.setDesignInfo({ variables: { rload: '3.3k' } });
    ed.actions.setPartParam(r1, 'value', '{rload}');
    ed.actions.select([{ kind: 'part', id: r1 }]);
    ed.actions.copy();
    await manager.open(newDesign('B'), 'b.msim');
    const r = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    ed.actions.select([{ kind: 'part', id: r }]);
    expect(ed.actions.pasteSpecial('values')).toEqual({ ok: true, count: 1 });
    expect(parts(ed)[0].params.value).toBe('{rload}');
    expect(ed.getState().design.variables.rload).toBe('3.3k');
    // and the document still saves and reopens
    expect(() => parseDesign(serializeDesign(ed.getState().design))).not.toThrow();
  });
});

describe('paste as subcircuit', () => {
  it('wraps the pasted fragment in a new subcircuit with a block in its place', () => {
    const { ed } = setup();
    copyThree(ed);
    const r = ed.actions.pasteSpecial('block', { name: 'Divider', at: { x: 100, y: 400 } });
    expect(r.ok).toBe(true);
    const d = ed.getState().design;
    expect(d.children).toHaveLength(1);
    expect(d.children![0].name).toBe('Divider');
    const child = d.children![0];
    expect(child.sheets[0].parts.map((p) => p.partId).sort()).toEqual(['test/capacitor', 'test/resistor', 'test/resistor']);
    // the original three parts and the block on the sheet; the pasted parts moved into the block
    const onSheet = parts(ed);
    expect(onSheet.filter((p) => p.partId.startsWith('hier:'))).toHaveLength(1);
    expect(onSheet.filter((p) => !p.partId.startsWith('hier:'))).toHaveLength(3);
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: onSheet.find((p) => p.partId.startsWith('hier:'))!.id }]);
  });

  it('is one undo step and the design saves and reopens', () => {
    const { ed } = setup();
    copyThree(ed);
    const before = ed.getState().design;
    ed.actions.pasteSpecial('block', { name: 'Blk' });
    expect(() => parseDesign(serializeDesign(ed.getState().design))).not.toThrow();
    ed.actions.undo();
    expect(ed.getState().design).toBe(before);
  });

  it('a fragment without parts (only a wire) is refused', () => {
    const { ed } = setup();
    const w = ed.actions.addWire([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])!;
    ed.actions.select([{ kind: 'wire', id: w as string }]);
    ed.actions.copy();
    const before = ed.getState().design;
    expect(ed.actions.pasteSpecial('block', { name: 'x' })).toEqual({ ok: false, reason: 'noParts' });
    expect(ed.getState().design).toBe(before);
  });

  it('works into another document', async () => {
    const { ed, manager } = setup();
    copyThree(ed);
    await manager.open(newDesign('B'), 'b.msim');
    expect(ed.actions.pasteSpecial('block', { name: 'FromA', kind: 'hierarchical' }).ok).toBe(true);
    expect(ed.getState().design.children![0]).toMatchObject({ name: 'FromA', kind: 'hierarchical' });
    expect(parts(ed)).toHaveLength(1);
  });
});

describe('paste special without a clipboard', () => {
  it('refuses every mode', () => {
    const { ed } = setup();
    for (const m of ['keepNames', 'values', 'block'] as const) expect(ed.actions.pasteSpecial(m)).toEqual({ ok: false, reason: 'noClipboard' });
  });
});
