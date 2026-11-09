/**
 * Multi-control interactive parts (InteractiveDef.controls) on the canvas: a click while
 * simulating operates the control nearest to the click (DIP switch position, keypad key, rotary
 * contact), each control answers to its own key (and the instance's `keys` text overrides them),
 * keypad keys are momentary (pressed while held), and none of it is an undo step.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import { localToSheet } from '../../model/geometry';
import { createEditor, activeSheet } from '../store/editorStore';
import { controlKeys, nearestControl } from '../store/interactive';
import { CanvasInteraction, NULL_HOST, type PointerInput } from './interaction';

function setup() {
  const ed = createEditor({ lookup: getPart });
  const ix = new CanvasInteraction(ed, { ...NULL_HOST, isSimulating: () => true });
  return { ed, ix, part: (i = 0) => activeSheet(ed.getState()).parts[i] };
}
const at = (x: number, y: number): PointerInput => ({ x, y, button: 0, zoom: 1 });

describe('multi-control parts', () => {
  it('DIP switch: click a position or press its key; the keys text overrides the defaults', () => {
    const { ed, ix, part } = setup();
    ed.actions.placePart('basic/dip-switch-4', { x: 200, y: 200 });
    ed.actions.clearSelection();
    const def = getPart('basic/dip-switch-4')!;
    const depth = ed.getState().history.past.length;
    // click on position 3
    const p3 = localToSheet(def.interactive!.controls![2].at, part());
    ix.pointerMove(at(p3.x + 1, p3.y));
    ix.pointerDown(at(p3.x + 1, p3.y));
    ix.pointerUp(at(p3.x + 1, p3.y));
    expect(part().params.s3).toBe('true');
    expect(part().params.s1 ?? 'false').toBe('false');
    expect(ix.interactiveKey({ key: '1' }, 'down')).toBe(true);
    expect(part().params.s1).toBe('true');
    ix.interactiveKey({ key: '1' }, 'down');
    expect(part().params.s1).toBe('false');
    expect(ix.interactiveTargets('2')).toEqual(['S1']);
    expect(ix.interactiveTargets('q')).toEqual([]);
    ed.actions.setInteractiveParam('S1', 'keys', 'q - w');
    expect(controlKeys(def.interactive!, part().params)).toEqual(['q', '2', 'w', '4']);
    expect(ix.interactiveControlTargets('w')).toEqual([{ refdes: 'S1', control: 2 }]);
    ix.interactiveKey({ key: 'W' }, 'down');
    expect(part().params.s3).toBe('false');
    expect(ed.getState().history.past.length).toBe(depth);
  });

  it('keypad: keys are momentary, by click and by keyboard', () => {
    const { ed, ix, part } = setup();
    ed.actions.placePart('basic/keypad-4x3', { x: 300, y: 300 });
    ed.actions.clearSelection();
    const def = getPart('basic/keypad-4x3')!;
    const five = def.interactive!.controls!.findIndex((c) => c.label === '5');
    const p = localToSheet(def.interactive!.controls![five].at, part());
    ix.pointerMove(at(p.x, p.y));
    ix.pointerDown(at(p.x, p.y));
    expect(part().params.k5).toBe('true');
    ix.pointerUp(at(p.x, p.y));
    expect(part().params.k5).toBe('false');
    ix.interactiveKey({ key: '#' }, 'down');
    expect(part().params.khash).toBe('true');
    ix.interactiveKey({ key: '#' }, 'up');
    expect(part().params.khash).toBe('false');
  });

  it('rotary switch: clicking a contact selects it, the R key steps to the next position', () => {
    const { ed, ix, part } = setup();
    ed.actions.placePart('basic/rotary-switch-4', { x: 300, y: 300 });
    ed.actions.clearSelection();
    const def = getPart('basic/rotary-switch-4')!;
    const c4 = localToSheet(def.interactive!.controls![3].at, part());
    ix.pointerMove(at(c4.x, c4.y));
    ix.pointerDown(at(c4.x, c4.y));
    ix.pointerUp(at(c4.x, c4.y));
    expect(part().params.position).toBe('4');
    ix.interactiveKey({ key: 'r' }, 'down');
    expect(part().params.position).toBe('1');
    ix.interactiveKey({ key: 'r' }, 'down');
    expect(part().params.position).toBe('2');
    // selecting the already selected contact changes nothing
    expect(ed.actions.interact('S1', 'click', 1)).toBeNull();
  });

  it('the nearest control is found in symbol coordinates, whatever the rotation', () => {
    const def = getPart('basic/dip-switch-8')!.interactive!;
    expect(nearestControl(def, { x: 2, y: -70 })).toBe(0);
    expect(nearestControl(def, { x: -3, y: 68 })).toBe(7);
    const { ed, part } = setup();
    ed.actions.placePart('basic/dip-switch-8', { x: 400, y: 400 });
    ed.actions.rotateSelection();
    const inst = part();
    expect(inst.rotation).not.toBe(0);
    const s5 = localToSheet(def.controls![4].at, inst);
    const ix = new CanvasInteraction(ed, { ...NULL_HOST, isSimulating: () => true });
    ed.actions.clearSelection();
    ix.pointerMove(at(s5.x, s5.y));
    ix.pointerDown(at(s5.x, s5.y));
    ix.pointerUp(at(s5.x, s5.y));
    expect(part().params.s5).toBe('true');
  });
});
