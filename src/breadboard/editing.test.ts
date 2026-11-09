import { describe, expect, it } from 'vitest';
import {
  addClip,
  addWire,
  binContents,
  inferRotation,
  itemsAtHole,
  movePart,
  nextId,
  placePart,
  previewPlacement,
  pruneLayout,
  removeClip,
  removePart,
  removeWire,
  rotatePart,
  setBoardKind,
  setSplitRails,
} from './editing';
import { canRedo, canUndo, createHistory, pushHistory, redo, resetHistory, undo } from './history';
import { compareWithSchematic } from './compare';
import { astable555Circuit, seriesLedCircuit } from './examples';
import { emptyBreadboard, type BreadboardHole } from './types';

const H = (row: BreadboardHole['row'], col: number): BreadboardHole => ({ board: 'bb1', row, col });

describe('layout editing', () => {
  const design = seriesLedCircuit();

  it('places a part from its first lead and refuses leads off the board', () => {
    const l = placePart(design, emptyBreadboard(), 'R1', H('c', 10))!;
    expect(l.placements).toEqual([{ refdes: 'R1', pins: { '1': H('c', 10), '2': H('c', 14) } }]);
    expect(placePart(design, emptyBreadboard(), 'R1', H('c', 62))).toBeNull();
    expect(placePart(design, emptyBreadboard(), 'BAT1', H('c', 10))).toBeNull();
    expect(placePart(design, emptyBreadboard(), 'NOPE', H('c', 10))).toBeNull();
  });

  it('previews conflicts with other leads', () => {
    const l = placePart(design, emptyBreadboard(), 'R1', H('c', 10))!;
    const p = previewPlacement(design, l, 'LED1', H('c', 13))!;
    expect(p.ok).toBe(true);
    expect(p.conflicts).toEqual([H('c', 14)]);
  });

  it('rotates about the centre of the leads and moves keeping the rotation', () => {
    let l = placePart(design, emptyBreadboard(), 'R1', H('c', 10))!;
    expect(l.placements[0].pins).toEqual({ '1': H('c', 10), '2': H('c', 14) });
    l = rotatePart(design, l, 'R1')!;
    // centre (column 12, row c) stays put: the part now stands in column 12 from a to e
    expect(l.placements[0].pins).toEqual({ '1': H('a', 12), '2': H('e', 12) });
    expect(l.placements[0].rotation).toBe(90);
    // the circuit check now sees both leads in one strip
    expect(compareWithSchematic(design, l).issues.some((i) => i.kind === 'part-shorted')).toBe(true);
    l = movePart(design, l, 'R1', H('e', 20))!;
    // a 4-pitch span from row e crosses the 3-pitch channel and lands in row g
    expect(l.placements[0].pins).toEqual({ '1': H('e', 20), '2': H('g', 20) });
    l = rotatePart(design, l, 'R1')!;
    // the centre sits in the channel, so the part snaps to the nearest row that holds both leads
    expect(l.placements[0].pins).toEqual({ '1': H('f', 22), '2': H('f', 18) });
    expect(l.placements[0].rotation).toBe(180);
    expect(removePart(l, 'R1').placements).toEqual([]);
  });

  it('swaps the leads of a 2-lead part in place with a half turn', () => {
    let l = placePart(design, emptyBreadboard(), 'LED1', H('d', 7))!;
    expect(l.placements[0].pins).toEqual({ A: H('d', 7), K: H('d', 8) });
    l = rotatePart(design, l, 'LED1', 180)!;
    expect(l.placements[0].pins).toEqual({ A: H('d', 8), K: H('d', 7) });
    expect(l.placements[0].rotation).toBe(180);
    // a quarter turn stands the LED across two rows of one column, next to where it was
    const q = rotatePart(design, l, 'LED1')!.placements[0].pins;
    expect(q.A.col).toBe(q.K.col);
    expect([7, 8]).toContain(q.A.col);
  });

  it('infers the rotation of placements made without one', () => {
    const l = { ...emptyBreadboard(), placements: [{ refdes: 'R1', pins: { '1': H('e', 9), '2': H('e', 5) } }] };
    expect(inferRotation(design, l, 'R1')).toBe(180);
    const rotated = rotatePart(design, l, 'R1')!;
    expect(rotated.placements[0].pins).toEqual({ '1': H('f', 7), '2': H('d', 7) });
    expect(rotated.placements[0].rotation).toBe(270);
  });

  it('adds and removes jumpers and clips with unique ids', () => {
    const w1 = addWire(emptyBreadboard(), H('a', 1), H('a', 5), '#f00')!;
    const w2 = addWire(w1.layout, H('b', 1), H('top+', 3), '#f00')!;
    expect([w1.id, w2.id]).toEqual(['w1', 'w2']);
    expect(addWire(w2.layout, H('a', 1), H('a', 1), '#f00')).toBeNull();
    expect(removeWire(w2.layout, 'w1').wires.map((w) => w.id)).toEqual(['w2']);
    const c1 = addClip(w2.layout, 'BAT1', '+', H('top+', 4), '#f00');
    const c2 = addClip(c1.layout, 'BAT1', '+', H('top+', 5), '#f00');
    expect(c2.layout.clips).toHaveLength(1);
    expect(c2.layout.clips[0].hole).toEqual(H('top+', 5));
    expect(removeClip(c2.layout, c2.id).clips).toEqual([]);
    expect(nextId('w', ['w1', 'w3'])).toBe('w2');
  });

  it('lists the parts bin and items in a hole', () => {
    let l = placePart(design, emptyBreadboard(), 'R1', H('c', 10))!;
    l = addClip(l, 'BAT1', '+', H('top+', 4), '#f00').layout;
    const bin = binContents(design, l);
    expect(bin.parts.map((p) => p.refdes)).toEqual(['LED1']);
    expect(bin.offBoard.map((o) => [o.part.refdes, o.pins])).toEqual([['BAT1', ['-']]]);
    l = addWire(l, H('a', 10), H('top+', 10), '#f00')!.layout;
    expect(itemsAtHole(l, H('c', 10))).toEqual({ parts: [{ refdes: 'R1', key: '1' }], wires: [], clips: [] });
    expect(itemsAtHole(l, H('top+', 10)).wires).toEqual([{ id: 'w1', end: 'to' }]);
  });

  it('changes board options and prunes stale entries', () => {
    const l = setSplitRails(setBoardKind(emptyBreadboard(), 'bb1', 'half'), 'bb1', true);
    expect(l.boards[0]).toEqual({ id: 'bb1', kind: 'half', x: 0, y: 0, splitRails: true });
    expect(setSplitRails(l, 'bb1', false).boards[0].splitRails).toBeUndefined();
    const stale = { ...emptyBreadboard(), placements: [{ refdes: 'Q9', pins: {} }], clips: [{ id: 'c1', refdes: 'X9', pin: '+', hole: H('a', 1), color: 'red' }] };
    const pruned = pruneLayout(design, stale);
    expect(pruned.placements).toEqual([]);
    expect(pruned.clips).toEqual([]);
  });

  it('places a DIP from pin 1', () => {
    const d = astable555Circuit();
    const l = placePart(d, emptyBreadboard(), 'U1', H('f', 20))!;
    expect(l.placements[0].pins.VCC).toEqual(H('e', 20));
    expect(l.placements[0].pins.OUT).toEqual(H('f', 22));
  });
});

describe('undo history', () => {
  it('undoes and redoes snapshots', () => {
    let h = createHistory(1, 3);
    expect(canUndo(h)).toBe(false);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = pushHistory(h, 3);
    expect(h.past).toEqual([1, 2]);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(undo(h)).toBe(h);
    h = pushHistory(h, 9);
    expect(canRedo(h)).toBe(false);
  });

  it('keeps at most `limit` past steps and can reset', () => {
    let h = createHistory(0, 2);
    for (let i = 1; i <= 5; i++) h = pushHistory(h, i);
    expect(h.past).toEqual([3, 4]);
    h = resetHistory(h, 42);
    expect(h).toMatchObject({ past: [], present: 42, future: [] });
  });
});
