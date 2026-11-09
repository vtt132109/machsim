/**
 * Geometry helpers for part placement (CONTRACT — shared by editor & netlister).
 * Transform order for a part-local point p: mirror (x -> -x) -> rotate clockwise -> translate.
 */
import type { PartDef, PinDef } from '../library/types';
import type { PartInstance, Point, Rotation } from './types';
import { GRID } from './types';

export function rotatePoint(p: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
  }
}

/** Part-local point -> sheet coordinates. */
export function localToSheet(p: Point, inst: Pick<PartInstance, 'x' | 'y' | 'rotation' | 'mirror'>): Point {
  const m = inst.mirror ? { x: -p.x, y: p.y } : p;
  const r = rotatePoint(m, inst.rotation);
  return { x: r.x + inst.x, y: r.y + inst.y };
}

/** Sheet point -> part-local coordinates (inverse of localToSheet). */
export function sheetToLocal(p: Point, inst: Pick<PartInstance, 'x' | 'y' | 'rotation' | 'mirror'>): Point {
  const t = { x: p.x - inst.x, y: p.y - inst.y };
  const inv: Rotation = ((360 - inst.rotation) % 360) as Rotation;
  const r = rotatePoint(t, inv);
  return inst.mirror ? { x: -r.x, y: r.y } : r;
}

export interface PlacedPin {
  name: string;
  pin: PinDef;
  x: number;
  y: number;
}

export function instancePins(inst: PartInstance, part: PartDef): PlacedPin[] {
  return part.symbol.pins.map((pin) => {
    const p = localToSheet({ x: pin.x, y: pin.y }, inst);
    return { name: pin.name, pin, x: p.x, y: p.y };
  });
}

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid;
}

export function snapPoint(p: Point, grid = GRID): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

export function samePoint(a: Point, b: Point, eps = 0.5): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** True when p lies on the axis-aligned segment a-b (inclusive). */
export function pointOnSegment(p: Point, a: Point, b: Point, eps = 0.5): boolean {
  if (Math.abs(a.x - b.x) <= eps) {
    return Math.abs(p.x - a.x) <= eps && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
  }
  if (Math.abs(a.y - b.y) <= eps) {
    return Math.abs(p.y - a.y) <= eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps;
  }
  // non-orthogonal fallback
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > eps * Math.hypot(b.x - a.x, b.y - a.y)) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= -eps && dot <= (b.x - a.x) ** 2 + (b.y - a.y) ** 2 + eps;
}

/** Axis-aligned bounding box of a placed part in sheet coordinates. */
export function instanceBBox(inst: PartInstance, part: PartDef): { x: number; y: number; w: number; h: number } {
  const b = part.symbol.bbox;
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((c) => localToSheet(c, inst));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
