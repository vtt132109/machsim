import { describe, expect, it } from 'vitest';
import type { Point, Wire } from '../../model/types';
import { createEditor, activeSheet, isDirty } from './editorStore';
import { testLookup } from './testParts';
import { junctionPoints } from './wireOps';
import { sheetPins } from './designOps';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

function setup(now?: () => number) {
  return createEditor({ lookup: testLookup, now });
}

const sheetOf = (ed: ReturnType<typeof setup>) => activeSheet(ed.getState());
const ends = (w: Wire): [Point, Point] => [w.points[0], w.points[w.points.length - 1]];

describe('placing parts', () => {
  it('auto-annotates refdes per prefix and snaps to the grid', () => {
    const ed = setup();
    const a = ed.actions.placePart('test/resistor', { x: 101, y: 98 });
    const b = ed.actions.placePart('test/resistor', { x: 200, y: 100 });
    const c = ed.actions.placePart('test/capacitor', { x: 300, y: 100 });
    const parts = sheetOf(ed).parts;
    expect(parts.map((p) => p.refdes)).toEqual(['R1', 'R2', 'C1']);
    expect(parts[0]).toMatchObject({ id: a, x: 100, y: 100, params: { value: '1k' } });
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: c }]);
    expect(b).not.toBeNull();
    expect(ed.actions.placePart('missing/part', { x: 0, y: 0 })).toBeNull();
  });
  it('re-uses the lowest free number', () => {
    const ed = setup();
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    const r2 = ed.actions.placePart('test/resistor', { x: 100, y: 0 });
    ed.actions.placePart('test/resistor', { x: 200, y: 0 });
    ed.actions.select([{ kind: 'part', id: r2! }]);
    ed.actions.deleteSelection();
    ed.actions.placePart('test/resistor', { x: 300, y: 0 });
    expect(sheetOf(ed).parts.map((p) => p.refdes)).toEqual(['R1', 'R3', 'R2']);
  });
});

describe('wires', () => {
  it('splits an existing wire when a new wire ends on it and shows a junction', () => {
    const ed = setup();
    ed.actions.addWire([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    ed.actions.addWire([
      { x: 50, y: 60 },
      { x: 50, y: 0 },
    ]);
    const wires = sheetOf(ed).wires;
    expect(wires).toHaveLength(3);
    expect(junctionPoints(wires, [])).toEqual([{ x: 50, y: 0 }]);
  });
  it('merges a wire continuing from a free wire end', () => {
    const ed = setup();
    ed.actions.addWire([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    ed.actions.addWire([
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
    const wires = sheetOf(ed).wires;
    expect(wires).toHaveLength(1);
    expect(wires[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
  });
  it('does not merge two wires that meet at a pin', () => {
    const ed = setup();
    ed.actions.placePart('test/resistor', { x: 100, y: 100 }); // pins at (70,100) and (130,100)
    ed.actions.addWire([
      { x: 0, y: 100 },
      { x: 70, y: 100 },
    ]);
    ed.actions.addWire([
      { x: 70, y: 100 },
      { x: 70, y: 200 },
    ]);
    expect(sheetOf(ed).wires).toHaveLength(2);
    const pins = sheetPins(sheetOf(ed), testLookup).map((p) => ({ x: p.x, y: p.y }));
    expect(junctionPoints(sheetOf(ed).wires, pins)).toEqual([{ x: 70, y: 100 }]);
  });
  it('ignores degenerate wires', () => {
    const ed = setup();
    expect(ed.actions.addWire([{ x: 10, y: 10 }, { x: 10, y: 10 }])).toBeNull();
    expect(sheetOf(ed).wires).toHaveLength(0);
    expect(ed.getState().history.past).toHaveLength(0);
  });
});

describe('moving with rubber-banding', () => {
  function circuit() {
    const ed = setup();
    const r = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!; // pins (70,100) (130,100)
    ed.actions.addWire([
      { x: 130, y: 100 },
      { x: 250, y: 100 },
    ]);
    ed.actions.addWire([
      { x: 70, y: 100 },
      { x: 70, y: 200 },
    ]);
    return { ed, r };
  }

  it('drags a part and keeps attached wires connected and orthogonal', () => {
    const { ed, r } = circuit();
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.beginDrag();
    ed.actions.dragTo(10, 0);
    ed.actions.dragTo(20, 30);
    ed.actions.endDrag();
    const s = sheetOf(ed);
    expect(s.parts[0]).toMatchObject({ x: 120, y: 130 });
    const right = s.wires.find((w) => ends(w).some((p) => p.x === 250))!;
    expect(right.points).toEqual([
      { x: 150, y: 130 },
      { x: 200, y: 130 },
      { x: 200, y: 100 },
      { x: 250, y: 100 },
    ]);
    const left = s.wires.find((w) => w !== right)!;
    // vertical wire whose top end moved sideways gets a dog-leg through its snapped middle
    expect(left.points).toEqual([
      { x: 90, y: 130 },
      { x: 90, y: 170 },
      { x: 70, y: 170 },
      { x: 70, y: 200 },
    ]);
  });

  it('collapses a whole drag into one undo step and restores everything on undo', () => {
    const { ed, r } = circuit();
    const before = ed.getState().design;
    const depth = ed.getState().history.past.length;
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.beginDrag();
    for (let i = 1; i <= 8; i++) ed.actions.dragTo(i * 10, 0);
    ed.actions.endDrag();
    expect(ed.getState().history.past).toHaveLength(depth + 1);
    expect(sheetOf(ed).parts[0].x).toBe(180);
    ed.actions.undo();
    expect(ed.getState().design).toBe(before);
    ed.actions.redo();
    expect(sheetOf(ed).parts[0].x).toBe(180);
  });

  it('a drag that returns to its start leaves no undo step', () => {
    const { ed, r } = circuit();
    const before = ed.getState().design;
    const depth = ed.getState().history.past.length;
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.beginDrag();
    ed.actions.dragTo(30, 0);
    ed.actions.dragTo(0, 0);
    ed.actions.endDrag();
    expect(ed.getState().design).toBe(before);
    expect(ed.getState().history.past).toHaveLength(depth);
  });

  it('two separate drags are two undo steps', () => {
    const { ed, r } = circuit();
    const depth = ed.getState().history.past.length;
    ed.actions.select([{ kind: 'part', id: r }]);
    for (const dx of [10, 20]) {
      ed.actions.beginDrag();
      ed.actions.dragTo(dx, 0);
      ed.actions.endDrag();
    }
    expect(ed.getState().history.past).toHaveLength(depth + 2);
    expect(sheetOf(ed).parts[0].x).toBe(130);
    ed.actions.undo();
    expect(sheetOf(ed).parts[0].x).toBe(110);
  });

  it('coalesces keyboard nudges only within the time window', () => {
    let t = 1000;
    const ed = setup(() => t);
    const r = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    ed.actions.select([{ kind: 'part', id: r }]);
    const depth = ed.getState().history.past.length;
    ed.actions.nudge(10, 0);
    t += 200;
    ed.actions.nudge(10, 0);
    t += 200;
    ed.actions.nudge(0, 10);
    expect(ed.getState().history.past).toHaveLength(depth + 1);
    t += 5000;
    ed.actions.nudge(10, 0);
    expect(ed.getState().history.past).toHaveLength(depth + 2);
    expect(sheetOf(ed).parts[0]).toMatchObject({ x: 130, y: 110 });
    ed.actions.undo();
    expect(sheetOf(ed).parts[0]).toMatchObject({ x: 120, y: 110 });
    ed.actions.undo();
    expect(sheetOf(ed).parts[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('shares unchanged objects between snapshots (structural sharing)', () => {
    const ed = setup();
    ed.actions.addSheet('Second');
    const second = ed.getState().design.sheets[1];
    ed.actions.setActiveSheet(ed.getState().design.sheets[0].id);
    const r = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    const keep = ed.actions.placePart('test/resistor', { x: 200, y: 0 })!;
    const keepObj = sheetOf(ed).parts.find((p) => p.id === keep);
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.nudge(10, 0);
    expect(ed.getState().design.sheets[1]).toBe(second);
    expect(sheetOf(ed).parts.find((p) => p.id === keep)).toBe(keepObj);
  });
});

describe('undo / redo', () => {
  it('walks back and forth and clears redo on a new edit', () => {
    const ed = setup();
    const d0 = ed.getState().design;
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    const d1 = ed.getState().design;
    ed.actions.placePart('test/resistor', { x: 100, y: 0 });
    expect(ed.actions.undo()).toBe(true);
    expect(ed.getState().design).toBe(d1);
    expect(ed.actions.undo()).toBe(true);
    expect(ed.getState().design).toBe(d0);
    expect(ed.actions.undo()).toBe(false);
    ed.actions.redo();
    expect(ed.getState().design).toBe(d1);
    ed.actions.placePart('test/capacitor', { x: 0, y: 100 });
    expect(ed.getState().history.future).toHaveLength(0);
    expect(ed.actions.redo()).toBe(false);
  });
  it('tracks dirty state against the saved snapshot', () => {
    const ed = setup();
    expect(isDirty(ed.getState())).toBe(false);
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    expect(isDirty(ed.getState())).toBe(true);
    ed.actions.markSaved('a.msim');
    expect(isDirty(ed.getState())).toBe(false);
    ed.actions.placePart('test/resistor', { x: 100, y: 0 });
    ed.actions.undo();
    expect(isDirty(ed.getState())).toBe(false);
  });
  it('prunes selection of items removed by undo', () => {
    const ed = setup();
    const id = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    expect(ed.getState().selection).toEqual([{ kind: 'part', id }]);
    ed.actions.undo();
    expect(ed.getState().selection).toEqual([]);
  });
});

describe('copy / paste', () => {
  it('re-annotates pasted parts, offsets them and selects the copies', () => {
    const ed = setup();
    const r1 = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    const c1 = ed.actions.placePart('test/capacitor', { x: 300, y: 100 })!;
    ed.actions.addWire([
      { x: 130, y: 100 },
      { x: 200, y: 100 },
    ]);
    const wireId = sheetOf(ed).wires[0].id;
    ed.actions.addNetLabel({ x: 200, y: 100 }, 'OUT');
    const labelId = sheetOf(ed).labels[0].id;
    ed.actions.select([
      { kind: 'part', id: r1 },
      { kind: 'part', id: c1 },
      { kind: 'wire', id: wireId },
      { kind: 'label', id: labelId },
    ]);
    expect(ed.actions.copy()).toBe(true);
    ed.actions.paste({ x: 100, y: 300 });
    const s = sheetOf(ed);
    expect(s.parts.map((p) => p.refdes)).toEqual(['R1', 'C1', 'R2', 'C2']);
    const pasted = s.parts.slice(2);
    // anchor = top-left of the copied items (resistor bbox x 70, C1 bbox top y 80)
    expect(pasted[0]).toMatchObject({ x: 130, y: 320 });
    expect(pasted[1]).toMatchObject({ x: 330, y: 320 });
    expect(s.labels.map((l) => l.name)).toEqual(['OUT', 'OUT']);
    expect(s.wires).toHaveLength(2);
    const sel = ed.getState().selection;
    expect(sel).toHaveLength(4);
    expect(sel.map((x) => x.id)).not.toContain(r1);
    expect(new Set(s.parts.map((p) => p.id)).size).toBe(4);
  });
  it('successive pastes without a position step diagonally and keep numbering', () => {
    const ed = setup();
    const r = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.copy();
    ed.actions.paste();
    ed.actions.paste();
    const parts = sheetOf(ed).parts;
    expect(parts.map((p) => [p.refdes, p.x, p.y])).toEqual([
      ['R1', 100, 100],
      ['R2', 120, 120],
      ['R3', 140, 140],
    ]);
  });
  it('cut removes the originals; duplicate leaves the clipboard alone', () => {
    const ed = setup();
    const r = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.duplicate();
    expect(sheetOf(ed).parts.map((p) => p.refdes)).toEqual(['R1', 'R2']);
    expect(ed.actions.getClipboard()).toBeNull();
    ed.actions.cut();
    expect(sheetOf(ed).parts.map((p) => p.refdes)).toEqual(['R1']);
    ed.actions.paste();
    expect(sheetOf(ed).parts.map((p) => p.refdes)).toEqual(['R1', 'R2']);
  });
  it('renames pasted probes to keep names unique', () => {
    const ed = setup();
    const id = ed.actions.addProbe('voltage', { x: 50, y: 50 });
    ed.actions.select([{ kind: 'probe', id }]);
    ed.actions.copy();
    ed.actions.paste();
    expect(sheetOf(ed).probes.map((p) => p.name)).toEqual(['Probe1', 'Probe2']);
  });
});

describe('rotate / flip', () => {
  it('rotates a single part about its origin and drags attached wire ends to the new pins', () => {
    const ed = setup();
    const r = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    ed.actions.addWire([
      { x: 130, y: 100 },
      { x: 200, y: 100 },
    ]);
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.rotateSelection('cw');
    const s = sheetOf(ed);
    expect(s.parts[0]).toMatchObject({ x: 100, y: 100, rotation: 90, mirror: false });
    const pins = sheetPins(s, testLookup);
    expect(pins.map((p) => [p.name, p.x, p.y])).toEqual([
      ['1', 100, 70],
      ['2', 100, 130],
    ]);
    expect(ends(s.wires[0])).toEqual([
      { x: 100, y: 130 },
      { x: 200, y: 100 },
    ]);
    expect(s.wires[0].points.every((p, i, a) => i === 0 || p.x === a[i - 1].x || p.y === a[i - 1].y)).toBe(true);
  });
  it('flips horizontally by mirroring and negating rotation', () => {
    const ed = setup();
    const r = ed.actions.placePart('test/capacitor', { x: 0, y: 0 }, 90)!;
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.flipSelection('h');
    expect(sheetOf(ed).parts[0]).toMatchObject({ rotation: 270, mirror: true });
    ed.actions.flipSelection('v');
    expect(sheetOf(ed).parts[0]).toMatchObject({ rotation: 270, mirror: false });
  });
  it('rotates a group about its snapped centre', () => {
    const ed = setup();
    ed.actions.addWire([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    ed.actions.selectAll();
    ed.actions.rotateSelection('cw');
    expect(sheetOf(ed).wires[0].points).toEqual([
      { x: 50, y: -50 },
      { x: 50, y: 50 },
    ]);
  });
});

describe('properties & refdes', () => {
  it('validates refdes uniqueness', () => {
    const ed = setup();
    const a = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    ed.actions.placePart('test/resistor', { x: 100, y: 0 });
    expect(ed.actions.setRefdes(a, 'r2')).toMatch(/already used/);
    expect(ed.actions.setRefdes(a, '9x')).toMatch(/start with a letter/);
    expect(ed.actions.setRefdes(a, 'Rload')).toBeNull();
    expect(sheetOf(ed).parts[0].refdes).toBe('Rload');
  });
  it('sets and resets params', () => {
    const ed = setup();
    const a = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    ed.actions.setPartParam(a, 'value', '4.7k');
    expect(sheetOf(ed).parts[0].params.value).toBe('4.7k');
    ed.actions.setPartParam(a, 'value', null);
    expect(sheetOf(ed).parts[0].params.value).toBe('1k');
  });
  it('label offsets dragged with one coalescing key form a single undo step', () => {
    const ed = setup();
    const a = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    const depth = ed.getState().history.past.length;
    const key = ed.actions.newCoalesceKey('label');
    ed.actions.setLabelOffset(a, 'ref', { x: 10, y: -20 }, { coalesce: key });
    ed.actions.setLabelOffset(a, 'ref', { x: 20, y: -30 }, { coalesce: key });
    expect(ed.getState().history.past).toHaveLength(depth + 1);
    expect(sheetOf(ed).parts[0].refOffset).toEqual({ x: 20, y: -30 });
    ed.actions.setLabelOffset(a, 'ref', null);
    expect(sheetOf(ed).parts[0].refOffset).toBeUndefined();
  });
});

describe('interactive parts', () => {
  it('toggles a switch without adding undo history and notifies listeners', () => {
    const ed = setup();
    ed.actions.placePart('test/switch', { x: 0, y: 0 });
    const depth = ed.getState().history.past.length;
    const seen: string[] = [];
    const off = ed.actions.onInteractiveChange((refdes, param, value) => seen.push(`${refdes}.${param}=${value}`));
    expect(ed.actions.interact('S1', 'click')).toBe('true');
    expect(ed.actions.interact('S1', 'click')).toBe('false');
    off();
    ed.actions.interact('S1', 'click');
    expect(seen).toEqual(['S1.closed=true', 'S1.closed=false']);
    expect(ed.getState().history.past).toHaveLength(depth);
    expect(sheetOf(ed).parts[0].params.closed).toBe('true');
  });
  it('undo and redo of unrelated edits keep the interactive value', () => {
    const ed = setup();
    ed.actions.placePart('test/switch', { x: 0, y: 0 });
    const r = ed.actions.placePart('test/pot', { x: 200, y: 0 })!;
    ed.actions.undo(); // pot removed; its placement is now in the redo list
    expect(ed.actions.interact('S1', 'click')).toBe('true');
    ed.actions.redo(); // pot back
    expect(sheetOf(ed).parts.map((p) => p.id)).toContain(r);
    expect(sheetOf(ed).parts[0].params.closed).toBe('true');
    ed.actions.undo();
    ed.actions.undo(); // back to the empty sheet: nothing left to patch, no error
    expect(sheetOf(ed).parts).toHaveLength(0);
    ed.actions.redo();
    expect(sheetOf(ed).parts[0].params.closed).toBe('true');
  });
  it('steps a potentiometer and clamps to its range', () => {
    const ed = setup();
    ed.actions.placePart('test/pot', { x: 0, y: 0 });
    expect(ed.actions.interact('R1', 'increase')).toBe('60');
    for (let i = 0; i < 10; i++) ed.actions.interact('R1', 'increase');
    expect(sheetOf(ed).parts[0].params.setting).toBe('100');
    expect(ed.actions.interact('R1', 'decrease')).toBe('90');
    expect(ed.actions.interact('R1', 'release')).toBeNull();
  });
});

describe('sheets', () => {
  it('adds, renames and deletes sheets, never the last one', () => {
    const ed = setup();
    const first = ed.getState().activeSheetId;
    const id = ed.actions.addSheet();
    expect(ed.getState().activeSheetId).toBe(id);
    expect(ed.getState().design.sheets.map((s) => s.name)).toEqual(['Sheet 1', 'Sheet 2']);
    ed.actions.renameSheet(id, 'Power');
    expect(ed.getState().design.sheets[1].name).toBe('Power');
    expect(ed.actions.deleteSheet(id)).toBe(true);
    expect(ed.getState().activeSheetId).toBe(first);
    expect(ed.actions.deleteSheet(first)).toBe(false);
    ed.actions.undo();
    expect(ed.getState().design.sheets).toHaveLength(2);
  });
  it('finds a part by refdes on another sheet and centres it', () => {
    const ed = setup();
    ed.actions.addSheet();
    ed.actions.placePart('test/capacitor', { x: 400, y: 200 });
    const other = ed.getState().activeSheetId;
    ed.actions.setActiveSheet(ed.getState().design.sheets[0].id);
    ed.actions.setViewportSize({ w: 800, h: 600 });
    expect(ed.actions.findAndShow('c1')).toBe(true);
    const st = ed.getState();
    expect(st.activeSheetId).toBe(other);
    expect(st.selection).toHaveLength(1);
    const v = st.views[other];
    expect(400 * v.zoom + v.panX).toBeCloseTo(400, 6);
    expect(200 * v.zoom + v.panY).toBeCloseTo(300, 6);
    expect(ed.actions.findAndShow('Q9')).toBe(false);
  });
});

describe('annotation (src/model/annotate.ts)', () => {
  it("'missing' fixes duplicate and unnumbered designators as one undo step, keeping other parts' identity", () => {
    const ed = setup();
    const a = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    const b = ed.actions.placePart('test/resistor', { x: 100, y: 0 })!;
    const c = ed.actions.placePart('test/capacitor', { x: 200, y: 0 })!;
    ed.actions.updatePart(b, { refdes: 'R1' });
    ed.actions.updatePart(c, { refdes: 'C?' });
    const before = sheetOf(ed).parts.find((p) => p.id === a);
    const depth = ed.getState().history.past.length;
    expect(ed.actions.annotate('missing')).toBe(2);
    const parts = sheetOf(ed).parts;
    expect(parts.map((p) => p.refdes)).toEqual(['R1', 'R2', 'C1']);
    expect(parts.find((p) => p.id === a)).toBe(before);
    expect(ed.getState().history.past.length).toBe(depth + 1);
    expect(ed.actions.annotate('missing')).toBe(0);
    expect(ed.getState().history.past.length).toBe(depth + 1);
  });
  it("'all' renumbers by position", () => {
    const ed = setup();
    ed.actions.placePart('test/resistor', { x: 300, y: 0 });
    ed.actions.placePart('test/resistor', { x: 0, y: 0 });
    expect(ed.actions.annotate('all')).toBe(2);
    expect(sheetOf(ed).parts.map((p) => [p.x, p.refdes])).toEqual([
      [300, 'R2'],
      [0, 'R1'],
    ]);
  });
});

describe('document hygiene', () => {
  it('stores only x / y for wire points and probe references', () => {
    const ed = setup();
    const rich = [
      { x: 0, y: 0, kind: 'pin', horizontal: true },
      { x: 50, y: 0, kind: 'point' },
    ] as unknown as Point[];
    ed.actions.addWire(rich);
    expect(sheetOf(ed).wires[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    ed.actions.addProbe('differential', { x: 0, y: 0 }, { x: 50, y: 0, kind: 'wire' } as unknown as Point);
    expect(sheetOf(ed).probes[0].ref).toEqual({ x: 50, y: 0 });
  });
});
