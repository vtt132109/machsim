import { describe, expect, it, vi } from 'vitest';
import type { PartDef } from '../../library/types';
import { createEditor, activeSheet } from '../store/editorStore';
import { TEST_RESISTOR, testLookup } from '../store/testParts';
import type { PartLookup } from '../store/types';
import { CanvasInteraction, NULL_HOST, type InteractionHost, type PointerInput } from './interaction';
import { partLabelLayout } from '../store/shapes';

const SCOPE: PartDef = {
  ...TEST_RESISTOR,
  id: 'test/scope',
  name: 'Scope',
  prefix: 'XSC',
  instrument: 'oscilloscope',
  params: [],
};
const BUTTON: PartDef = {
  ...TEST_RESISTOR,
  id: 'test/button',
  name: 'Push button',
  prefix: 'S',
  params: [{ key: 'pressed', label: 'Pressed', default: 'false', kind: 'bool' }],
  interactive: { kind: 'momentary', param: 'pressed', label: 'Press', key: 'Space' },
};
const lookup: PartLookup = (id) => (id === SCOPE.id ? SCOPE : id === BUTTON.id ? BUTTON : testLookup(id));

function setup(host: Partial<InteractionHost> = {}) {
  const ed = createEditor({ lookup });
  const ix = new CanvasInteraction(ed, { ...NULL_HOST, ...host });
  return { ed, ix, sheet: () => activeSheet(ed.getState()) };
}

const at = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({ x, y, button: 0, zoom: 1, ...extra });

function click(ix: CanvasInteraction, x: number, y: number, extra: Partial<PointerInput> = {}) {
  ix.pointerMove(at(x, y, extra));
  ix.pointerDown(at(x, y, extra));
  ix.pointerUp(at(x, y, extra));
}

describe('place tool', () => {
  it('places snapped copies until Esc and rotates / mirrors the ghost', () => {
    const { ed, ix, sheet } = setup();
    ed.actions.startPlacing('test/resistor');
    ix.pointerMove(at(103, 98));
    expect(ix.overlay.getState().ghost).toEqual({ partId: 'test/resistor', x: 100, y: 100, rotation: 0, mirror: false });
    expect(ix.keyDown({ key: 'r' })).toBe(true);
    expect(ix.overlay.getState().ghost?.rotation).toBe(90);
    expect(ix.keyDown({ key: 'R', shift: true })).toBe(true);
    expect(ix.keyDown({ key: 'x' })).toBe(true);
    expect(ix.overlay.getState().ghost).toMatchObject({ rotation: 0, mirror: true });
    click(ix, 101, 99);
    click(ix, 200, 100);
    expect(sheet().parts.map((p) => [p.refdes, p.x, p.y, p.rotation, p.mirror])).toEqual([
      ['R1', 100, 100, 0, true],
      ['R2', 200, 100, 0, true],
    ]);
    expect(ed.getState().tool.kind).toBe('place');
    ix.keyDown({ key: 'Escape' });
    expect(ed.getState().tool.kind).toBe('select');
    expect(ix.overlay.getState().ghost).toBeNull();
  });
});

describe('wire tool', () => {
  it('routes from pin to pin with an L corner and keeps the tool active', () => {
    const { ed, ix, sheet } = setup();
    ed.actions.placePart('test/resistor', { x: 100, y: 100 }); // pins (70,100) (130,100)
    ed.actions.placePart('test/resistor', { x: 300, y: 200 }); // pins (270,200) (330,200)
    ed.actions.setTool({ kind: 'wire' });
    click(ix, 132, 101); // snaps onto pin 2 of R1
    expect(ix.overlay.getState().wire?.points).toEqual([{ x: 130, y: 100 }]);
    ix.pointerMove(at(268, 199));
    // pin stub points right: horizontal first
    expect(ix.overlay.getState().wire?.preview).toEqual([
      { x: 130, y: 100 },
      { x: 270, y: 100 },
      { x: 270, y: 200 },
    ]);
    ix.keyDown({ key: '/' });
    expect(ix.overlay.getState().wire?.preview).toEqual([
      { x: 130, y: 100 },
      { x: 130, y: 200 },
      { x: 270, y: 200 },
    ]);
    click(ix, 268, 199);
    expect(ix.overlay.getState().wire).toBeNull();
    expect(sheet().wires.map((w) => w.points)).toEqual([
      [
        { x: 130, y: 100 },
        { x: 130, y: 200 },
        { x: 270, y: 200 },
      ],
    ]);
    expect(ed.getState().tool.kind).toBe('wire');
  });

  it('adds corners on empty points, Backspace removes one, double click finishes', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.setTool({ kind: 'wire' });
    click(ix, 0, 0);
    click(ix, 100, 0);
    click(ix, 100, 50);
    expect(ix.overlay.getState().wire?.points).toHaveLength(3);
    ix.keyDown({ key: 'Backspace' });
    expect(ix.overlay.getState().wire?.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    click(ix, 100, 80);
    click(ix, 100, 80); // second click on the same point = finish
    expect(sheet().wires.map((w) => w.points)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
      ],
    ]);
  });

  it('finishing on an existing wire splits it and creates a junction', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.addWire([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    ed.actions.setTool({ kind: 'wire' });
    click(ix, 100, 100);
    click(ix, 101, 2); // lands on the wire (snapped to 100,0)
    expect(sheet().wires).toHaveLength(3);
    expect(sheet().wires.filter((w) => w.points.some((p) => p.x === 100 && p.y === 0))).toHaveLength(3);
  });

  it('starts a wire from a pin in the select tool and returns to select afterwards', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.placePart('test/resistor', { x: 100, y: 100 });
    ed.actions.clearSelection();
    click(ix, 70, 100);
    expect(ix.overlay.getState().wire?.fromSelect).toBe(true);
    click(ix, 20, 100);
    click(ix, 20, 100);
    expect(sheet().wires).toHaveLength(1);
    expect(ed.getState().tool.kind).toBe('select');
  });
});

describe('select tool', () => {
  it('drag-moves the selection with rubber-banding as one undo step', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.placePart('test/resistor', { x: 100, y: 100 });
    ed.actions.addWire([
      { x: 130, y: 100 },
      { x: 200, y: 100 },
    ]);
    const undoDepth = ed.getState().history.past.length;
    ix.pointerDown(at(100, 104)); // on the body of R1
    ix.pointerMove(at(110, 120));
    ix.pointerMove(at(120, 140));
    ix.pointerUp(at(120, 140));
    expect(sheet().parts[0]).toMatchObject({ x: 120, y: 140 });
    // wire end followed the pin and stayed orthogonal
    const w = sheet().wires[0];
    expect(w.points[0]).toEqual({ x: 150, y: 140 });
    expect(w.points[w.points.length - 1]).toEqual({ x: 200, y: 100 });
    for (let i = 1; i < w.points.length; i++) expect(w.points[i].x === w.points[i - 1].x || w.points[i].y === w.points[i - 1].y).toBe(true);
    expect(ed.getState().history.past.length).toBe(undoDepth + 1);
    ed.actions.undo();
    expect(sheet().parts[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('Esc during a drag restores the original positions', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.placePart('test/resistor', { x: 100, y: 100 });
    ix.pointerDown(at(100, 104));
    ix.pointerMove(at(150, 104));
    expect(sheet().parts[0].x).toBe(150);
    ix.keyDown({ key: 'Escape' });
    ix.pointerUp(at(150, 104));
    expect(sheet().parts[0].x).toBe(100);
  });

  it('rubber band: left to right selects enclosed items, right to left crossing items', () => {
    const { ix, ed } = setup();
    const r1 = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!; // bbox 70..130
    const r2 = ed.actions.placePart('test/resistor', { x: 300, y: 100 })!; // bbox 270..330
    ix.pointerDown(at(50, 50));
    ix.pointerMove(at(290, 150));
    expect(ix.overlay.getState().band?.mode).toBe('inside');
    ix.pointerUp(at(290, 150));
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: r1 }]);
    ix.pointerDown(at(290, 150));
    ix.pointerMove(at(50, 50));
    expect(ix.overlay.getState().band?.mode).toBe('crossing');
    ix.pointerUp(at(50, 50));
    expect(ed.getState().selection).toEqual([
      { kind: 'part', id: r1 },
      { kind: 'part', id: r2 },
    ]);
    // a click on empty space clears the selection
    click(ix, 500, 500);
    expect(ed.getState().selection).toEqual([]);
  });

  it('Shift-click toggles items in the selection', () => {
    const { ix, ed } = setup();
    const r1 = ed.actions.placePart('test/resistor', { x: 100, y: 100 })!;
    const r2 = ed.actions.placePart('test/resistor', { x: 300, y: 100 })!;
    click(ix, 100, 104);
    click(ix, 300, 104, { shift: true });
    expect(ed.getState().selection).toEqual([
      { kind: 'part', id: r1 },
      { kind: 'part', id: r2 },
    ]);
    click(ix, 100, 104, { shift: true });
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: r2 }]);
  });

  it('drags a part label to a new offset as one undo step', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.placePart('test/resistor', { x: 100, y: 100 }); // ref label at (100, 86)
    const depth = ed.getState().history.past.length;
    ix.pointerDown(at(100, 86));
    ix.pointerMove(at(120, 76));
    ix.pointerMove(at(141, 66));
    ix.pointerUp(at(141, 66));
    expect(sheet().parts[0].refOffset).toEqual({ x: 40, y: -35 });
    expect(sheet().parts[0]).toMatchObject({ x: 100, y: 100 });
    expect(ed.getState().history.past.length).toBe(depth + 1);
  });

  it('double-click opens the instrument window or the properties', () => {
    const openInstrument = vi.fn();
    const openPartProperties = vi.fn();
    const { ix, ed } = setup({ openInstrument, openPartProperties });
    ed.actions.placePart('test/scope', { x: 100, y: 100 });
    const r = ed.actions.placePart('test/resistor', { x: 300, y: 100 })!;
    ix.doubleClick(at(100, 104));
    expect(openInstrument).toHaveBeenCalledWith('XSC1', 'oscilloscope');
    ix.doubleClick(at(300, 104));
    expect(openPartProperties).toHaveBeenCalledWith(r);
  });

  it('double-click on an instrument name label opens the instrument window too', () => {
    const openInstrument = vi.fn();
    const openPartProperties = vi.fn();
    const { ix, ed, sheet } = setup({ openInstrument, openPartProperties });
    ed.actions.placePart('test/scope', { x: 100, y: 100 });
    const inst = sheet().parts[0];
    const box = partLabelLayout(inst, lookup(inst.partId))[0].box;
    ix.doubleClick(at(box.x + box.w / 2, box.y + box.h / 2));
    expect(openInstrument).toHaveBeenCalledWith('XSC1', 'oscilloscope');
    expect(openPartProperties).not.toHaveBeenCalled();
  });
});

describe('interactive parts', () => {
  it('part keys toggle switches without undo steps and notify listeners', () => {
    const { ix, ed } = setup();
    ed.actions.placePart('test/switch', { x: 100, y: 100 });
    ed.actions.placePart('test/pot', { x: 300, y: 100 });
    const seen: string[] = [];
    ed.actions.onInteractiveChange((ref, param, value) => seen.push(`${ref}.${param}=${value}`));
    const depth = ed.getState().history.past.length;
    expect(ix.interactiveTargets('a')).toEqual(['S1']);
    expect(ix.interactiveKey({ key: 'A' }, 'down')).toBe(true);
    expect(ix.interactiveKey({ key: 'a', repeat: true }, 'down')).toBe(true); // auto-repeat ignored for toggles
    expect(ix.interactiveKey({ key: 'b' }, 'down')).toBe(true);
    expect(ix.interactiveKey({ key: 'B', shift: true }, 'down')).toBe(true);
    expect(ix.interactiveKey({ key: 'B', shift: true, repeat: true }, 'down')).toBe(true);
    expect(seen).toEqual(['S1.closed=true', 'R1.setting=60', 'R1.setting=50', 'R1.setting=40']);
    expect(ix.interactiveKey({ key: 'a', ctrl: true }, 'down')).toBe(false);
    expect(ix.interactiveKey({ key: 'q' }, 'down')).toBe(false);
    expect(ed.getState().history.past.length).toBe(depth);
  });

  it('momentary parts press on key down and release on key up', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.placePart('test/button', { x: 100, y: 100 });
    ix.interactiveKey({ key: ' ' }, 'down');
    expect(sheet().parts[0].params.pressed).toBe('true');
    ix.interactiveKey({ key: ' ', repeat: true }, 'down');
    expect(sheet().parts[0].params.pressed).toBe('true');
    ix.interactiveKey({ key: ' ' }, 'up');
    expect(sheet().parts[0].params.pressed).toBe('false');
  });

  it('clicking an interactive part while simulating operates it instead of selecting', () => {
    let simulating = false;
    const { ix, ed, sheet } = setup({ isSimulating: () => simulating });
    ed.actions.placePart('test/switch', { x: 100, y: 100 });
    ed.actions.clearSelection();
    click(ix, 100, 104);
    expect(sheet().parts[0].params.closed).toBe('false');
    expect(ed.getState().selection).toHaveLength(1);
    ed.actions.clearSelection();
    simulating = true;
    click(ix, 100, 104);
    expect(sheet().parts[0].params.closed).toBe('true');
    expect(ed.getState().selection).toHaveLength(0);
  });
});

describe('label, probe and text tools', () => {
  it('places a net label on the clicked wire with the prompted name', async () => {
    const promptText = vi.fn(async () => 'VOUT');
    const { ix, ed, sheet } = setup({ promptText });
    ed.actions.addWire([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    ed.actions.setTool({ kind: 'label' });
    ix.pointerDown(at(52, 3));
    await vi.waitFor(() => expect(sheet().labels).toHaveLength(1));
    expect(sheet().labels[0]).toMatchObject({ x: 50, y: 0, name: 'VOUT', rotation: 0 });
    expect(promptText).toHaveBeenCalledWith(expect.objectContaining({ initial: 'N1' }));
  });

  it('differential probes take a measured point and a reference point', () => {
    const { ix, ed, sheet } = setup();
    ed.actions.setTool({ kind: 'probe', probeKind: 'differential' });
    click(ix, 40, 40);
    expect(ix.overlay.getState().probeRef).toEqual({ x: 40, y: 40 });
    click(ix, 90, 40);
    expect(sheet().probes).toHaveLength(1);
    expect(sheet().probes[0]).toMatchObject({ kind: 'differential', x: 40, y: 40, ref: { x: 90, y: 40 } });
    expect(ix.overlay.getState().probeRef).toBeNull();
  });

  it('places a text note at the snapped click point', async () => {
    const { ix, ed, sheet } = setup({ promptText: async () => 'Gain stage\nAv = 10' });
    ed.actions.setTool({ kind: 'text' });
    ix.pointerDown(at(203, 98));
    await vi.waitFor(() => expect(sheet().notes).toHaveLength(1));
    expect(sheet().notes[0]).toMatchObject({ x: 200, y: 100, text: 'Gain stage\nAv = 10' });
  });
});
