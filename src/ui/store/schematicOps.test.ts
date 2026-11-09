/**
 * Editor operations of the schematic-capture round: hierarchy (create, open, replace selection by
 * subcircuit — checked by simulation), refdes scopes, lock, group, align / distribute, replace
 * component, buses and pasting blocks between designs.
 */
import { describe, expect, it } from 'vitest';
import { createEditor, activeSheet, levelPath } from './editorStore';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import { getPart } from '../../library';
import { instancePins, samePoint } from '../../model/geometry';
import { blockPartDef, getChild } from '../../model/hierarchy';
import { busOfWire } from './schematicOps';
import { childAsDesign } from './hierarchyOps';
import { copyItems, pasteItems } from './designOps';
import { parseDesign, serializeDesign } from '../../model/serialize';
import { buildBom } from '../../model/bom';
import { setLang } from '../../i18n';
import type { Design } from '../../model/types';

setLang('en');

function op(design: Design): Record<string, number> {
  const b = buildNetlist(design);
  expect(b.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars ?? {};
}
const cur = (res: Record<string, number>, el: string) => Object.entries(res).find(([k]) => k.toLowerCase() === `i(${el.toLowerCase()})`)![1];

/** V1 10 V (labels TOP / gnd) -- wire -- R1 1k -- wire -- R2 3k -- wire to a gnd label. */
function divider(): { design: Design; ids: Record<string, string>; wires: string[] } {
  const b = new DesignBuilder('Divider');
  const v1 = b.part('sources/dc-voltage', 'V1', 0, 200, { value: '10' });
  b.labelPin(v1, '+', 'TOP');
  b.labelPin(v1, '-', 'gnd');
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' }); // pins (170,0) (230,0)
  const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '3k' }); // pins (370,0) (430,0)
  const w1 = b.wire({ x: 120, y: 0 }, b.pin(r1, '1'));
  b.label('TOP', 120, 0);
  const w2 = b.connect(r1, '2', r2, '1');
  const w3 = b.wire(b.pin(r2, '2'), { x: 480, y: 0 });
  b.label('gnd', 480, 0);
  return { design: b.design, ids: { v1: v1.inst.id, r1: r1.inst.id, r2: r2.inst.id }, wires: [w1, w2, w3] };
}

describe('hierarchy editing', () => {
  it('replaces a selection by a subcircuit without changing the circuit', () => {
    const { design, ids, wires } = divider();
    const before = op(design);
    const ed = createEditor({ design });
    ed.actions.select([
      { kind: 'part', id: ids.r1 },
      { kind: 'part', id: ids.r2 },
      { kind: 'wire', id: wires[1] },
    ]);
    const r = ed.actions.replaceWithSubcircuit('subcircuit', 'Pair')!;
    // the TOP net needs a port; the ground net does not (a ground label goes inside)
    expect(r.ports).toEqual(['TOP']);
    const d = ed.getState().design;
    const child = getChild(d, r.childId)!;
    expect(child.sheets[0].parts.map((p) => p.refdes)).toEqual(['R1', 'R2']);
    expect(child.sheets[0].labels.filter((l) => l.kind === 'hier').map((l) => l.name)).toEqual(['TOP']);
    expect(child.sheets[0].labels.filter((l) => !l.kind).map((l) => l.name)).toEqual(['GND']);
    const root = activeSheet(ed.getState());
    expect(root.parts.map((p) => p.refdes)).toEqual(['V1', 'SC1']);
    const after = op(d);
    expect(cur(after, 'V1')).toBeCloseTo(cur(before, 'V1'), 12);
    expect(cur(after, 'V1')).toBeCloseTo(-10 / 4000, 12);
    // one undo step restores the flat circuit
    ed.actions.undo();
    expect(ed.getState().design.children ?? []).toEqual([]);
    expect(activeSheet(ed.getState()).parts).toHaveLength(3);
  });

  it('keeps a net that crosses the selection edge several times connected inside', () => {
    // R1 and R2 selected but not the wire between them: that wire stays outside
    const { design, ids } = divider();
    const before = op(design);
    const ed = createEditor({ design });
    ed.actions.select([
      { kind: 'part', id: ids.r1 },
      { kind: 'part', id: ids.r2 },
    ]);
    const r = ed.actions.replaceWithSubcircuit('subcircuit', 'Split')!;
    expect(r.ports).toEqual(['TOP', 'IO1']);
    const child = getChild(ed.getState().design, r.childId)!;
    expect(child.sheets[0].labels.filter((l) => l.name === 'IO1').map((l) => l.kind ?? 'label').sort()).toEqual(['hier', 'label']);
    expect(cur(op(ed.getState().design), 'V1')).toBeCloseTo(cur(before, 'V1'), 12);
  });

  it('creates a child, opens it, numbers its parts on their own and goes back up', () => {
    const { design } = divider();
    const ed = createEditor({ design });
    const childId = ed.actions.createChild({ kind: 'hierarchical', name: 'Amp' });
    const child = getChild(ed.getState().design, childId)!;
    expect(blockPartDef(child).symbol.pins.map((p) => p.name)).toEqual(['IN', 'OUT']);
    const blockId = ed.actions.placePart(`hier:${childId}`, { x: 600, y: 200 })!;
    expect(activeSheet(ed.getState()).parts.find((p) => p.id === blockId)?.refdes).toBe('HB1');
    expect(ed.actions.openBlock(blockId)).toBe(true);
    expect(ed.getState().activeSheetId).toBe(child.sheets[0].id);
    expect(levelPath(ed.getState()).map((n) => n.path)).toEqual(['', 'HB1']);
    // R1 exists on the root, but inside the child the first resistor is R1 again
    ed.actions.placePart('basic/resistor', { x: 300, y: 100 });
    expect(activeSheet(ed.getState()).parts.map((p) => p.refdes)).toEqual(['R1']);
    // a block cannot be placed inside its own child design
    expect(ed.actions.placePart(`hier:${childId}`, { x: 0, y: 0 })).toBeNull();
    // new sheets go to the child level
    const s2 = ed.actions.addSheet();
    expect(getChild(ed.getState().design, childId)!.sheets.map((s) => s.id)).toContain(s2);
    expect(ed.getState().design.sheets).toHaveLength(1);
    expect(ed.actions.goToParent()).toBe(true);
    expect(ed.getState().activeSheetId).toBe(ed.getState().design.sheets[0].id);
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: blockId }]);
    // deleting a used child is refused
    expect(ed.actions.deleteChild(childId)).toBe(false);
    // saved as its own design, the child keeps its sheets
    const own = childAsDesign(ed.getState().design, childId)!;
    expect(own.title).toBe('Amp');
    expect(own.sheets).toHaveLength(2);
  });

  it('pastes a block into another design together with its child design', () => {
    const b = new DesignBuilder('src');
    const c = b.child('Filter');
    b.label('IN', 0, 0, { kind: 'hier' });
    b.root();
    const blk = b.block(c, 'SC1', 100, 100);
    const src = createEditor({ design: b.design });
    src.actions.select([{ kind: 'part', id: blk.inst.id }]);
    expect(src.actions.copy()).toBe(true);
    const clip = src.actions.getClipboard()!;
    expect(clip.children?.map((k) => k.name)).toEqual(['Filter']);
    // the target already has a different child under the same id
    const dst = createEditor();
    dst.actions.createChild({ kind: 'subcircuit', name: 'Other' });
    dst.actions.applyDesign((d) => ({ ...d, children: d.children!.map((x) => ({ ...x, id: 'child1' })) }));
    const res = pasteItems(dst.getState().design, dst.getState().activeSheetId, clip, { x: 0, y: 0 }, dst.lookup);
    const kids = res.design.children!;
    expect(kids.map((k) => k.name)).toEqual(['Other', 'Filter']);
    expect(kids[1].id).not.toBe('child1');
    expect(res.design.sheets[0].parts[0].partId).toBe(`hier:${kids[1].id}`);
    // pasting into the source design reuses its identical child
    const again = pasteItems(src.getState().design, src.getState().activeSheetId, clip, { x: 50, y: 50 }, src.lookup);
    expect(again.design.children).toHaveLength(1);
  });

  it('a placed section joins the first package that still has it free', () => {
    const ed = createEditor();
    ed.actions.placePart('ttl/7400-a', { x: 0, y: 0 });
    ed.actions.placePart('ttl/7400-b', { x: 200, y: 0 });
    ed.actions.placePart('ttl/7400-a', { x: 400, y: 0 });
    ed.actions.placePart('ttl/7400-c', { x: 600, y: 0 });
    ed.actions.placePart('basic/resistor', { x: 800, y: 0 });
    const parts = activeSheet(ed.getState()).parts.map((p) => `${p.partId}=${p.refdes}`);
    // A + B make U1; the second A starts U2; C joins U1 again; the resistor is untouched
    expect(parts).toEqual(['ttl/7400-a=U1', 'ttl/7400-b=U1', 'ttl/7400-a=U2', 'ttl/7400-c=U1', 'basic/resistor=R1']);
    expect(buildBom(ed.getState().design).filter((r) => r.partId.startsWith('ttl/7400')).reduce((n, r) => n + r.quantity, 0)).toBe(2);
  });

  it('pastes the sections of one package as ONE new chip', () => {
    const b = new DesignBuilder('7400');
    b.part('ttl/7400-a', 'U1', 0, 200);
    b.part('ttl/7400-b', 'U1', 200, 0);
    const d = b.design;
    const clip = copyItems(d, d.sheets[0].id, d.sheets[0].parts.map((p) => ({ kind: 'part' as const, id: p.id })), getPart)!;
    for (const keepRefdes of [false, true]) {
      const out = pasteItems(d, d.sheets[0].id, clip, { x: 0, y: 400 }, getPart, { keepRefdes }).design;
      const refs = out.sheets[0].parts.map((p) => p.refdes);
      expect(refs, `keepRefdes ${keepRefdes}`).toEqual(['U1', 'U1', 'U2', 'U2']);
    }
  });

  it('drops notFitted ids the target design does not declare, so the paste can be saved', () => {
    const b = new DesignBuilder('Phương án');
    const r1 = b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
    r1.inst.notFitted = ['v2'];
    const src2 = { ...b.design, variants: { list: [{ id: 'v2', name: 'Rút gọn' }], active: 'v2' } };
    const clip = copyItems(src2, src2.sheets[0].id, [{ kind: 'part', id: r1.inst.id }], getPart)!;
    // into a design without variants: the id goes
    const plain = pasteItems(new DesignBuilder('Khác').design, 'sheet1', clip, { x: 40, y: 40 }, getPart).design;
    expect(plain.sheets[0].parts[0].notFitted).toBeUndefined();
    expect(() => parseDesign(serializeDesign(plain))).not.toThrow();
    // into a design that has that variant: the id stays
    const withVariant = { ...new DesignBuilder('Có').design, variants: { list: [{ id: 'v2', name: 'Rút gọn' }] } };
    const kept = pasteItems(withVariant, withVariant.sheets[0].id, clip, { x: 40, y: 40 }, getPart).design;
    expect(kept.sheets[0].parts[0].notFitted).toEqual(['v2']);
  });
});

describe('lock, group, align, replace, bus', () => {
  it('locked items survive delete and drag; groups select together', () => {
    const { design, ids } = divider();
    const ed = createEditor({ design });
    ed.actions.select([{ kind: 'part', id: ids.r1 }]);
    ed.actions.setLocked(true);
    ed.actions.deleteSelection();
    expect(activeSheet(ed.getState()).parts.some((p) => p.id === ids.r1)).toBe(true);
    ed.actions.nudge(10, 0);
    expect(activeSheet(ed.getState()).parts.find((p) => p.id === ids.r1)!.x).toBe(200);
    ed.actions.setLocked(false);
    ed.actions.nudge(10, 0);
    expect(activeSheet(ed.getState()).parts.find((p) => p.id === ids.r1)!.x).toBe(210);
    ed.actions.select([
      { kind: 'part', id: ids.r1 },
      { kind: 'part', id: ids.r2 },
    ]);
    expect(ed.actions.groupSelection()).toBe(true);
    ed.actions.select([{ kind: 'part', id: ids.r2 }]);
    expect(ed.getState().selection.map((s) => s.id).sort()).toEqual([ids.r1, ids.r2].sort());
    ed.actions.ungroupSelection();
    ed.actions.select([{ kind: 'part', id: ids.r2 }]);
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: ids.r2 }]);
  });

  it('aligns and distributes parts with their wires following', () => {
    const b = new DesignBuilder('align');
    const a = b.part('basic/resistor', 'R1', 100, 100);
    const c = b.part('basic/resistor', 'R2', 300, 160);
    const d = b.part('basic/resistor', 'R3', 700, 130);
    const w = b.connect(a, '2', c, '1');
    const ed = createEditor({ design: b.design });
    const sel = [a, c, d].map((h) => ({ kind: 'part' as const, id: h.inst.id }));
    ed.actions.select(sel);
    ed.actions.alignSelection('top');
    const ys = activeSheet(ed.getState()).parts.map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
    // the wire still ends on both pins
    const sheet = activeSheet(ed.getState());
    const wire = sheet.wires.find((x) => x.id === w) ?? sheet.wires[0];
    const pinA = instancePins(sheet.parts[0], getPart('basic/resistor')!)[1];
    const pinC = instancePins(sheet.parts[1], getPart('basic/resistor')!)[0];
    expect(samePoint(wire.points[0], pinA) || samePoint(wire.points[wire.points.length - 1], pinA)).toBe(true);
    expect(samePoint(wire.points[0], pinC) || samePoint(wire.points[wire.points.length - 1], pinC)).toBe(true);
    ed.actions.distributeSelection('h');
    const xs = activeSheet(ed.getState()).parts.map((p) => p.x).sort((p, q) => p - q);
    expect(xs[1] - xs[0]).toBe(xs[2] - xs[1]);
  });

  it('replaces a component keeping its wires', () => {
    const { design, ids } = divider();
    const before = op(design);
    const ed = createEditor({ design });
    expect(ed.actions.replacePart(ids.r2, 'basic/inductor')).toBe(true);
    const r2 = activeSheet(ed.getState()).parts.find((p) => p.id === ids.r2)!;
    expect(r2.partId).toBe('basic/inductor');
    expect(r2.refdes).toBe('L1');
    // DC: the inductor is a short, so the whole 10 V is across R1
    const after = op(ed.getState().design);
    expect(cur(after, 'V1')).toBeCloseTo(-10 / 1000, 9);
    expect(cur(before, 'V1')).toBeCloseTo(-10 / 4000, 12);
  });

  it('draws, names and renames buses', () => {
    const ed = createEditor();
    const a = ed.actions.addBus([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'D[0..3]')!;
    // a bus drawn from a named bus takes its name; ordinary wires never merge with buses
    const b = ed.actions.addBus([{ x: 200, y: 0 }, { x: 200, y: 100 }])!;
    ed.actions.addWire([{ x: 100, y: 0 }, { x: 100, y: -60 }]);
    const sheet = activeSheet(ed.getState());
    expect(sheet.wires.filter((w) => w.bus).every((w) => w.busName === 'D[0..3]')).toBe(true);
    expect(sheet.wires.filter((w) => !w.bus)).toHaveLength(1);
    expect(busOfWire(sheet, a).wireIds.length).toBeGreaterThanOrEqual(1);
    ed.actions.renameBus(b, 'Q[0..3]');
    expect(activeSheet(ed.getState()).wires.filter((w) => w.bus).every((w) => w.busName === 'Q[0..3]')).toBe(true);
  });
});
