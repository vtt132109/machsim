/**
 * Review: editor store logic (src/ui/store) checked against the authoritative netlister
 * (src/model/netlister.ts) — drag rubber-banding, copy/paste, undo/redo, interactive params,
 * file-load validation, and agreement of the editor's connectivity view with the netlist.
 */
import { describe, expect, it } from 'vitest';
import { activeSheet, computeConnectivity, createEditor } from '../../../src/ui/store';
import { buildNetlist } from '../../../src/model/netlister';
import { parseDesign, serializeDesign } from '../../../src/model/serialize';
import { getPart } from '../../../src/library';
import { runAnalyses } from '../../../src/sim';
import type { Design } from '../../../src/model/types';

function ed() {
  return createEditor({ lookup: getPart });
}

/** 10 V source, R1 from V+ to R2, R2 to ground; returns ids. */
function divider(e: ReturnType<typeof ed>) {
  const a = e.actions;
  const v1 = a.placePart('sources/dc-voltage', { x: 0, y: 0 })!;
  a.setPartParam(v1, 'value', '10');
  const g = a.placePart('sources/ground', { x: 0, y: 80 })!;
  const r1 = a.placePart('basic/resistor', { x: 100, y: -60 })!; // pins (70,-60) (130,-60)
  const r2 = a.placePart('basic/resistor', { x: 160, y: 0 }, 90)!; // pins (160,-30) (160,30)
  const g2 = a.placePart('sources/ground', { x: 160, y: 80 })!;
  a.addWire([{ x: 0, y: -30 }, { x: 0, y: -60 }, { x: 70, y: -60 }]);
  a.addWire([{ x: 130, y: -60 }, { x: 160, y: -60 }, { x: 160, y: -30 }]);
  a.addWire([{ x: 0, y: 30 }, { x: 0, y: 80 }]);
  a.addWire([{ x: 160, y: 30 }, { x: 160, y: 80 }]);
  return { v1, g, r1, r2, g2 };
}

function vmid(d: Design): number {
  const b = buildNetlist(d);
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  const node = b.partNets.R1['2']; // the divider midpoint (R1.2 — R2's top pin, whichever it is)
  return r.scalars![`V(${node})`];
}

describe('editor operations keep the circuit electrically intact', () => {
  it('baseline divider simulates to 5 V', () => {
    const e = ed();
    divider(e);
    expect(vmid(e.getState().design)).toBeCloseTo(5, 9);
  });

  it('dragging R1 rubber-bands its wires; one undo step restores everything', () => {
    const e = ed();
    const { r1 } = divider(e);
    const before = e.getState().design;
    e.actions.select([{ kind: 'part', id: r1 }]);
    e.actions.beginDrag();
    e.actions.dragTo(0, -10);
    e.actions.dragTo(0, -40);
    e.actions.endDrag();
    const after = e.getState().design;
    expect(after).not.toBe(before);
    expect(vmid(after)).toBeCloseTo(5, 9); // still connected
    expect(buildNetlist(after).erc.filter((m) => m.code === 'floating-pin')).toEqual([]);
    e.actions.undo();
    expect(e.getState().design).toBe(before);
    e.actions.redo();
    expect(e.getState().design).toBe(after);
  });

  it('rotating R2 in place keeps it connected through rubber-banded wires', () => {
    const e = ed();
    const { r2 } = divider(e);
    e.actions.select([{ kind: 'part', id: r2 }]);
    e.actions.rotateSelection('cw');
    e.actions.rotateSelection('cw');
    // A 180° turn swaps the pins in place: same nets, same answer. Observed instead: the second
    // rubber-band routes both wire ends along the resistor body ("160,-30 160,30" twice), which
    // shorts R2 and grounds the divider midpoint (partNets R1.2 = R2.1 = R2.2 = "0").
    const b = buildNetlist(e.getState().design);
    expect(b.partNets.R2['1'], 'R2 must not be shorted by the rotation').not.toBe(b.partNets.R2['2']);
    expect(vmid(e.getState().design)).toBeCloseTo(5, 9);
  });

  it('copy/paste of R1 + R2 + the wire between them makes an independent copy with fresh refdes', () => {
    const e = ed();
    const { r1, r2 } = divider(e);
    const sheet = activeSheet(e.getState());
    const mid = sheet.wires.find((w) => w.points.some((p) => p.x === 130 && p.y === -60))!;
    e.actions.select([
      { kind: 'part', id: r1 },
      { kind: 'part', id: r2 },
      { kind: 'wire', id: mid.id },
    ]);
    expect(e.actions.copy()).toBe(true);
    e.actions.paste({ x: 400, y: 200 });
    const d = e.getState().design;
    const refs = activeSheet(e.getState()).parts.map((p) => p.refdes);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toEqual(expect.arrayContaining(['R3', 'R4']));
    const b = buildNetlist(d);
    // the pasted pair is wired to itself, not to the original divider
    expect(b.partNets.R3['2']).toBe(b.partNets.R4['1']);
    expect(b.partNets.R3['2']).not.toBe(b.partNets.R1['2']);
    expect(vmid(d)).toBeCloseTo(5, 9);
  });
});

describe('interactive parameters vs history', () => {
  it('undoing an unrelated edit does not revert a switch toggled during simulation', () => {
    const e = ed();
    const s1 = e.actions.placePart('basic/switch-spst', { x: 0, y: 0 })!;
    const refdes = activeSheet(e.getState()).parts.find((p) => p.id === s1)!.refdes;
    e.actions.placePart('basic/resistor', { x: 200, y: 0 }); // the edit the user will undo
    expect(e.actions.interact(refdes, 'press')).toBe('true');
    const closed = () => activeSheet(e.getState()).parts.find((p) => p.id === s1)!.params.closed;
    expect(closed()).toBe('true');
    e.actions.undo(); // removes the resistor
    expect(activeSheet(e.getState()).parts.length).toBe(1);
    // The toggle was deliberately kept out of history ("bypass history on purpose"), so undo
    // should not touch it. It does: the snapshot restored predates the toggle.
    expect(closed()).toBe('true');
  });
});

describe('editor connectivity view agrees with the netlister', () => {
  it('a wire that passes over a pin without ending there', () => {
    const e = ed();
    const a = e.actions;
    const v1 = a.placePart('sources/dc-voltage', { x: 0, y: 0 })!;
    a.setPartParam(v1, 'value', '10');
    a.placePart('sources/ground', { x: 0, y: 80 });
    a.addWire([{ x: 0, y: 30 }, { x: 0, y: 80 }]);
    // R1 horizontal with pins (70,-60) and (130,-60); R2 vertical to ground at x = 200
    a.placePart('basic/resistor', { x: 100, y: -60 });
    a.placePart('basic/resistor', { x: 200, y: 0 }, 90); // pins (200,-30) (200,30)
    a.placePart('sources/ground', { x: 200, y: 80 });
    a.addWire([{ x: 200, y: 30 }, { x: 200, y: 80 }]);
    // one straight wire from V1+ over BOTH R1 pins to R2.1 (drawn past the resistor)
    a.addWire([{ x: 0, y: -30 }, { x: 0, y: -60 }, { x: 200, y: -60 }, { x: 200, y: -30 }]);
    const d = e.getState().design;
    const view = computeConnectivity(d, getPart);
    const b = buildNetlist(d);
    // Editor rule (wireOps.ts): "a wire merely passing over a pin does not connect".
    const editorR1Joined = view.pinNet.get('R1.1') === view.pinNet.get('V1.+');
    // Netlister rule (model/connectivity.ts): "A pin connects to every wire passing through".
    const netlistR1Joined = b.partNets.R1['1'] === b.partNets.V1['+'];
    expect({ editorR1Joined, netlistR1Joined }).toEqual({ editorR1Joined: netlistR1Joined, netlistR1Joined });
  });

  it('a part dropped onto an existing wire is silently shorted in the simulation', () => {
    // Draw the wire first (V1+ straight to R2), then place R1 on it: the editor shows R1 sitting
    // on a wire it is not connected to (no junctions, R1 pins in their own nets), yet the
    // netlister ties both R1 pins to the wire, so R2 sees the full 10 V instead of a divider.
    const e = ed();
    const a = e.actions;
    const v1 = a.placePart('sources/dc-voltage', { x: 0, y: 0 })!;
    a.setPartParam(v1, 'value', '10');
    a.placePart('sources/ground', { x: 0, y: 80 });
    a.addWire([{ x: 0, y: 30 }, { x: 0, y: 80 }]);
    a.placePart('basic/resistor', { x: 200, y: 0 }, 90);
    a.placePart('sources/ground', { x: 200, y: 80 });
    a.addWire([{ x: 200, y: 30 }, { x: 200, y: 80 }]);
    a.addWire([{ x: 0, y: -30 }, { x: 0, y: -60 }, { x: 200, y: -60 }, { x: 200, y: -30 }]);
    a.placePart('basic/resistor', { x: 100, y: -60 }); // R2 is the vertical one; this is R3? use refdes below
    const d = e.getState().design;
    const placed = activeSheet(e.getState()).parts.filter((p) => p.partId === 'basic/resistor');
    const dropped = placed[placed.length - 1].refdes;
    const view = computeConnectivity(d, getPart);
    expect(view.pinNet.get(`${dropped}.1`)).not.toBe(view.pinNet.get(`${dropped}.2`)); // editor: not shorted
    const b = buildNetlist(d);
    expect(b.partNets[dropped]['1'], 'netlister shorts the dropped resistor').not.toBe(b.partNets[dropped]['2']);
  });
});

describe('file load validation', () => {
  it('rejects a design whose part ids repeat across sheets (findItem / setPartParam are design-global)', () => {
    const e = ed();
    e.actions.placePart('basic/resistor', { x: 0, y: 0 });
    e.actions.addSheet();
    e.actions.placePart('basic/resistor', { x: 0, y: 0 });
    const d = JSON.parse(serializeDesign(e.getState().design)) as Design;
    d.sheets[1].parts[0].id = d.sheets[0].parts[0].id; // same id on two sheets
    const text = JSON.stringify(d);
    let loaded: Design | null = null;
    try {
      loaded = parseDesign(text);
    } catch {
      loaded = null;
    }
    if (loaded) {
      // accepted: show the consequence — editing the part on sheet 2 changes the one on sheet 1
      const e2 = createEditor({ lookup: getPart, design: loaded });
      e2.actions.setActiveSheet(loaded.sheets[1].id);
      e2.actions.setPartParam(loaded.sheets[1].parts[0].id, 'value', '47k');
      const after = e2.getState().design;
      expect(after.sheets[1].parts[0].params.value, 'the part the user edited (sheet 2)').toBe('47k');
      expect(after.sheets[0].parts[0].params.value ?? '1k', 'the untouched part on sheet 1').toBe('1k');
    }
  });
});
