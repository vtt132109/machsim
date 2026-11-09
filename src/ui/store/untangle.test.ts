import { describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import { buildNetlist } from '../../model/netlister';
import { instancePins } from '../../model/geometry';
import { runAnalyses } from '../../sim';
import type { Design } from '../../model/types';
import { createEditor } from './editorStore';
import { pinOutVector, untangleWires } from './untangle';
import { onWireInterior } from './wireOps';

/** V1 = 10 V, R1 horizontal (pins (70,-60) (130,-60)), R2 vertical at (160,0) to ground. */
function divider() {
  const e = createEditor({ lookup: getPart });
  const a = e.actions;
  const v1 = a.placePart('sources/dc-voltage', { x: 0, y: 0 })!;
  a.setPartParam(v1, 'value', '10');
  a.placePart('sources/ground', { x: 0, y: 80 });
  const r1 = a.placePart('basic/resistor', { x: 100, y: -60 })!;
  const r2 = a.placePart('basic/resistor', { x: 160, y: 0 }, 90)!;
  a.placePart('sources/ground', { x: 160, y: 80 });
  a.addWire([{ x: 0, y: -30 }, { x: 0, y: -60 }, { x: 70, y: -60 }]);
  a.addWire([{ x: 130, y: -60 }, { x: 160, y: -60 }, { x: 160, y: -30 }]);
  a.addWire([{ x: 0, y: 30 }, { x: 0, y: 80 }]);
  a.addWire([{ x: 160, y: 30 }, { x: 160, y: 80 }]);
  return { e, r1, r2 };
}

function midpoint(d: Design): number {
  const b = buildNetlist(d);
  expect(b.erc.filter((m) => m.severity === 'error')).toEqual([]);
  expect(b.partNets.R1['1']).not.toBe(b.partNets.R1['2']);
  expect(b.partNets.R2['1']).not.toBe(b.partNets.R2['2']);
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars![`V(${b.partNets.R1['2']})`];
}

/** No wire passes over a pin of the given part (only wire ends may touch it). */
function pinsClear(d: Design, partId: string): void {
  const sheet = d.sheets[0];
  const inst = sheet.parts.find((p) => p.id === partId)!;
  for (const pin of instancePins(inst, getPart(inst.partId)!)) {
    for (const w of sheet.wires) {
      expect(onWireInterior(w, pin), `wire ${w.points.map((p) => `${p.x},${p.y}`).join(' ')} over ${inst.refdes}.${pin.name}`).toBe(false);
    }
  }
}

describe('rubber-banded wires never end up across the part they are attached to', () => {
  it('rotating R2 by 180° (two quarter turns) re-routes both wires out of the pin stubs', () => {
    const { e, r2 } = divider();
    e.actions.select([{ kind: 'part', id: r2 }]);
    e.actions.rotateSelection('cw');
    e.actions.rotateSelection('cw');
    const d = e.getState().design;
    pinsClear(d, r2);
    expect(midpoint(d)).toBeCloseTo(5, 9);
    // the wire to pin 1 (now at the bottom, stub pointing down) leaves downwards
    const pin1Wire = d.sheets[0].wires.find((w) => w.points.some((p) => p.x === 130 && p.y === -60))!;
    const end = pin1Wire.points[pin1Wire.points.length - 1];
    const before = pin1Wire.points[pin1Wire.points.length - 2];
    expect(end).toEqual({ x: 160, y: 30 });
    expect(before.x).toBe(160);
    expect(before.y).toBeGreaterThan(30);
  });

  it('four quarter turns and a vertical flip keep the divider intact', () => {
    const { e, r2 } = divider();
    e.actions.select([{ kind: 'part', id: r2 }]);
    for (let k = 0; k < 4; k++) {
      e.actions.rotateSelection('cw');
      pinsClear(e.getState().design, r2);
      expect(midpoint(e.getState().design)).toBeCloseTo(5, 9);
    }
    e.actions.flipSelection('v');
    pinsClear(e.getState().design, r2);
    expect(midpoint(e.getState().design)).toBeCloseTo(5, 9);
  });

  it('dragging R1 across its own right-hand wire re-routes that wire instead of shorting R1', () => {
    const { e, r1 } = divider();
    e.actions.select([{ kind: 'part', id: r1 }]);
    e.actions.beginDrag();
    e.actions.dragTo(100, 0); // pins now (170,-60) (230,-60): the old pin-2 wire would run over pin 1
    e.actions.endDrag();
    const d = e.getState().design;
    pinsClear(d, r1);
    expect(midpoint(d)).toBeCloseTo(5, 9);
  });
});

describe('untangleWires', () => {
  it('leaves wires alone when nothing is tangled (same array)', () => {
    const wires = [{ id: 'w1', points: [{ x: 30, y: 0 }, { x: 60, y: 0 }] }];
    const out = untangleWires({
      wires,
      rubberBanded: new Set(['w1']),
      parts: [{ box: { x: -30, y: -5, w: 60, h: 10 }, pins: [{ x: -30, y: 0, out: { x: -1, y: 0 } }, { x: 30, y: 0, out: { x: 1, y: 0 } }] }],
      pins: [{ x: -30, y: 0 }, { x: 30, y: 0 }],
    });
    expect(out).toBe(wires);
  });

  it('routes a wire that runs back across the body out through the stub and around', () => {
    // part from x = -30 to 30; the wire attached at the right pin runs left over the body to (-60,0)
    const part = { box: { x: -30, y: -5, w: 60, h: 10 }, pins: [{ x: -30, y: 0, out: { x: -1, y: 0 } }, { x: 30, y: 0, out: { x: 1, y: 0 } }] };
    const out = untangleWires({
      wires: [{ id: 'w1', points: [{ x: 30, y: 0 }, { x: -60, y: 0 }] }],
      rubberBanded: new Set(['w1']),
      parts: [part],
      pins: part.pins,
    });
    const pts = out[0].points;
    expect(pts[0]).toEqual({ x: 30, y: 0 });
    expect(pts[1]).toEqual({ x: 40, y: 0 }); // leaves along the stub
    expect(pts[pts.length - 1]).toEqual({ x: -60, y: 0 });
    // detours through a lane just above or below the body, never through it
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.y === b.y) expect(Math.abs(a.y) === 0 && Math.min(a.x, b.x) < 30 && Math.max(a.x, b.x) > -30).toBe(false);
    }
    expect(pts.some((p) => p.y === -10 || p.y === 10)).toBe(true);
  });

  it('pinOutVector follows mirror then rotation, and falls back to the centre direction', () => {
    expect(pinOutVector('left', 90, false, { x: 0, y: 0 })).toEqual({ x: -0, y: -1 });
    expect(pinOutVector('left', 0, true, { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(pinOutVector('up', 180, false, { x: 0, y: 0 })).toEqual({ x: -0, y: 1 });
    expect(pinOutVector(undefined, 0, false, { x: 3, y: -10 })).toEqual({ x: 0, y: -1 });
  });
});
