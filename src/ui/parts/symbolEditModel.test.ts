/**
 * Symbol editor operations of round 3 step 7: the arc tool, multi-selection, copy / paste and the
 * resize handles (the dialog itself is checked in the browser; this pins the pure model).
 */
import { describe, expect, it } from 'vitest';
import type { SymbolDef } from '../../library/types';
import {
  arcAngle,
  arcPrim,
  copyTargets,
  deleteTargets,
  fitBBox,
  hasTarget,
  moveTargets,
  pasteFragment,
  resizeTarget,
  sameTarget,
  targetHandles,
  targetsInRect,
  toggleTarget,
  type SymTarget,
} from './symbolEditModel';

/** A box with a stub line, a circle and two pins (no extra stubs: the pins are written out). */
function sample(): SymbolDef {
  return fitBBox({
    bbox: { x: -20, y: -20, w: 40, h: 40 },
    prims: [
      { kind: 'rect', x: -20, y: -10, w: 40, h: 20 },
      { kind: 'line', x1: -30, y1: 0, x2: -20, y2: 0 },
      { kind: 'circle', cx: 0, cy: 0, r: 5 },
    ],
    pins: [
      { name: '1', x: -30, y: 0, dir: 'left', number: '1', type: 'passive' },
      { name: '2', x: 30, y: 0, dir: 'right', number: '2', type: 'passive' },
    ],
  });
}

describe('the arc tool', () => {
  it('measures angles clockwise on screen from +x', () => {
    expect(arcAngle(10, 0)).toBe(0);
    expect(arcAngle(0, 10)).toBe(90);
    expect(arcAngle(-10, 0)).toBe(180);
    expect(arcAngle(0, -10)).toBe(270);
  });

  it('makes a quarter arc from the drag (centre to a point on it)', () => {
    const arc = arcPrim({ x: 0, y: 0 }, { x: 20, y: 0 });
    expect(arc).toEqual({ kind: 'arc', cx: 0, cy: 0, r: 20, start: 0, end: 90 });
    const up = arcPrim({ x: 10, y: 10 }, { x: 10, y: -5 }, 180);
    expect(up).toEqual({ kind: 'arc', cx: 10, cy: 10, r: 15, start: 270, end: 450 });
  });

  it('refuses a drag of zero length', () => {
    expect(arcPrim({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });
});

describe('multi-selection', () => {
  const sym = sample();

  it('finds every shape and pin whose box meets the rectangle', () => {
    const all = targetsInRect(sym, { x: -40, y: -20, w: 80, h: 40 });
    expect(all.filter((t) => t.kind === 'prim')).toHaveLength(3);
    expect(all.filter((t) => t.kind === 'pin')).toHaveLength(2);
    // only the left pin and the stub line
    const left = targetsInRect(sym, { x: -34, y: -4, w: 8, h: 8 });
    expect(left).toEqual([
      { kind: 'prim', index: 1 },
      { kind: 'pin', index: 0 },
    ]);
    expect(targetsInRect(sym, { x: 100, y: 100, w: 10, h: 10 })).toEqual([]);
  });

  it('reads a rectangle dragged in any direction', () => {
    const forward = targetsInRect(sym, { x: -34, y: -4, w: 8, h: 8 });
    const backward = targetsInRect(sym, { x: -26, y: 4, w: -8, h: -8 });
    expect(backward).toEqual(forward);
  });

  it('adds and removes one target (Shift-click)', () => {
    const a: SymTarget = { kind: 'prim', index: 0 };
    const b: SymTarget = { kind: 'pin', index: 1 };
    expect(toggleTarget([], a)).toEqual([a]);
    expect(toggleTarget([a], b)).toEqual([a, b]);
    expect(toggleTarget([a, b], a)).toEqual([b]);
    expect(hasTarget([a, b], { kind: 'pin', index: 1 })).toBe(true);
    expect(hasTarget([a], b)).toBe(false);
    expect(sameTarget(a, { kind: 'prim', index: 0 })).toBe(true);
    expect(sameTarget(a, { kind: 'pin', index: 0 })).toBe(false);
  });

  it('moves every selected item and leaves the rest alone', () => {
    const moved = moveTargets(sym, [{ kind: 'prim', index: 2 }, { kind: 'pin', index: 0 }], 10, -20);
    expect(moved.prims[2]).toEqual({ kind: 'circle', cx: 10, cy: -20, r: 5 });
    expect(moved.pins[0]).toMatchObject({ x: -20, y: -20 });
    expect(moved.prims[0]).toEqual(sym.prims[0]);
    expect(moved.pins[1]).toEqual(sym.pins[1]);
    expect(moveTargets(sym, [], 10, 10)).toBe(sym);
    expect(moveTargets(sym, [{ kind: 'prim', index: 0 }], 0, 0)).toBe(sym);
  });

  it('deletes shapes and pins together, whatever the index order', () => {
    const left = deleteTargets(sym, [
      { kind: 'prim', index: 2 },
      { kind: 'prim', index: 0 },
      { kind: 'pin', index: 1 },
    ]);
    expect(left.prims).toEqual([sym.prims[1]]);
    expect(left.pins.map((p) => p.name)).toEqual(['1']);
  });
});

describe('copy and paste', () => {
  const sym = sample();

  it('copies the selected shapes and pins', () => {
    const frag = copyTargets(sym, [{ kind: 'prim', index: 2 }, { kind: 'pin', index: 0 }]);
    expect(frag.prims).toEqual([{ kind: 'circle', cx: 0, cy: 0, r: 5 }]);
    expect(frag.pins.map((p) => p.name)).toEqual(['1']);
    // the copy is independent of the symbol
    frag.prims[0] = { ...frag.prims[0], kind: 'circle', cx: 99, cy: 0, r: 5 };
    expect(sym.prims[2]).toEqual({ kind: 'circle', cx: 0, cy: 0, r: 5 });
  });

  it('pastes with an offset and gives the pasted pins free names', () => {
    const frag = copyTargets(sym, [{ kind: 'prim', index: 2 }, { kind: 'pin', index: 0 }]);
    const r = pasteFragment(sym, frag, 10, 10);
    expect(r.symbol.prims).toHaveLength(4);
    expect(r.symbol.prims[3]).toEqual({ kind: 'circle', cx: 10, cy: 10, r: 5 });
    expect(r.symbol.pins).toHaveLength(3);
    expect(r.symbol.pins[2]).toMatchObject({ name: '3', x: -20, y: 10 });
    expect(r.targets).toEqual([
      { kind: 'prim', index: 3 },
      { kind: 'pin', index: 2 },
    ]);
    // pasting twice keeps the names unique
    const again = pasteFragment(r.symbol, frag, 20, 20);
    expect(again.symbol.pins.map((p) => p.name)).toEqual(['1', '2', '3', '4']);
  });
});

describe('resize handles', () => {
  const sym = sample();

  it('puts handles on the corners of a rectangle', () => {
    const h = targetHandles(sym, { kind: 'prim', index: 0 });
    expect(h.map((x) => [x.id, x.x, x.y])).toEqual([
      ['nw', -20, -10],
      ['ne', 20, -10],
      ['sw', -20, 10],
      ['se', 20, 10],
    ]);
  });

  it('puts handles on the ends of a line, the radius of a circle and the vertices of a polyline', () => {
    expect(targetHandles(sym, { kind: 'prim', index: 1 }).map((x) => x.id)).toEqual(['p0', 'p1']);
    expect(targetHandles(sym, { kind: 'prim', index: 2 })).toEqual([{ id: 'r', x: 5, y: 0 }]);
    const poly = { ...sym, prims: [{ kind: 'polyline' as const, points: [0, 0, 10, 0, 10, 10] }] };
    expect(targetHandles(poly, { kind: 'prim', index: 0 })).toEqual([
      { id: 'p0', x: 0, y: 0 },
      { id: 'p1', x: 10, y: 0 },
      { id: 'p2', x: 10, y: 10 },
    ]);
    expect(targetHandles(sym, { kind: 'pin', index: 0 })).toEqual([]);
  });

  it('resizes a rectangle from any corner without turning it inside out', () => {
    const se = resizeTarget(sym, { kind: 'prim', index: 0 }, 'se', 40, 30);
    expect(se.prims[0]).toEqual({ kind: 'rect', x: -20, y: -10, w: 60, h: 40 });
    const nw = resizeTarget(sym, { kind: 'prim', index: 0 }, 'nw', -40, -30);
    expect(nw.prims[0]).toEqual({ kind: 'rect', x: -40, y: -30, w: 60, h: 40 });
    // dragging the south-east corner past the north-west one keeps a positive size
    const flipped = resizeTarget(sym, { kind: 'prim', index: 0 }, 'se', -40, -30);
    expect(flipped.prims[0]).toMatchObject({ kind: 'rect', x: -40, y: -30, w: 20, h: 20 });
  });

  it('resizes a line end, a radius and a polyline vertex', () => {
    expect(resizeTarget(sym, { kind: 'prim', index: 1 }, 'p1', -10, 5).prims[1]).toEqual({ kind: 'line', x1: -30, y1: 0, x2: -10, y2: 5 });
    expect(resizeTarget(sym, { kind: 'prim', index: 2 }, 'r', 0, 12).prims[2]).toEqual({ kind: 'circle', cx: 0, cy: 0, r: 12 });
    const poly = { ...sym, prims: [{ kind: 'polyline' as const, points: [0, 0, 10, 0] }] };
    expect(resizeTarget(poly, { kind: 'prim', index: 0 }, 'p1', 20, 30).prims[0]).toEqual({ kind: 'polyline', points: [0, 0, 20, 30] });
    expect(resizeTarget(poly, { kind: 'prim', index: 0 }, 'p9', 20, 30)).toBe(poly);
  });

  it('never resizes a pin or a missing shape', () => {
    expect(resizeTarget(sym, { kind: 'pin', index: 0 }, 'se', 10, 10)).toBe(sym);
    expect(resizeTarget(sym, { kind: 'prim', index: 99 }, 'se', 10, 10)).toBe(sym);
  });
});
