/**
 * Re-routing of rubber-banded wires that a move, rotation or flip left lying across the part
 * they are attached to.
 *
 * Rubber-banding ({@link rubberBandPoints}) slides a wire's corners orthogonally and knows nothing
 * about parts. When a part turns by 180°, or is dragged across its own wires, the result can run
 * along the part body and over its other pins; after normalisation (wireOps.ts) such a wire is
 * split at the pins it touches and the part is shorted. This module detects those wires and
 * replaces them by a clean orthogonal route:
 *
 *   attached pin -> stub point outside the body (in the pin's outward direction) -> 0, 1 or 2
 *   corners (an "L" or a detour through a lane beside a moved part) -> the far end
 *
 * A wire is *tangled* when, apart from its own ends, it touches a pin of a moved part or passes
 * through the interior of a moved part's body box. A candidate route is accepted only when it
 * avoids every moved body, touches no pin and no end of another wire (that would create a new
 * T-connection) and none of its corners lies on another wire. The shortest accepted candidate
 * wins (ties: candidate order); when none is accepted the rubber-banded wire is kept.
 *
 * Pure functions; untouched wires keep their identity.
 */
import type { Point, Rotation, Wire } from '../../model/types';
import { GRID } from '../../model/types';
import { pointOnSegment, rotatePoint, samePoint } from '../../model/geometry';
import { polylineLength, simplifyPoints } from './routing';
import type { Rect } from './types';

/** A pin of a moved part with the unit vector pointing out of the part body (screen space). */
export interface ObstaclePin {
  x: number;
  y: number;
  out: Point;
}

/** A part that was moved / transformed: its body box and pins (after the operation). */
export interface ObstaclePart {
  box: Rect;
  pins: ObstaclePin[];
}

export interface UntangleInput {
  /** all wires of the sheet after rubber-banding */
  wires: Wire[];
  /** ids of the wires that were rubber-banded (only these are examined) */
  rubberBanded: ReadonlySet<string>;
  /** moved / transformed parts */
  parts: ObstaclePart[];
  /** every pin position on the sheet after the operation */
  pins: Point[];
}

const EPS = 0.5;

/**
 * Unit vector pointing out of the body at a pin, after mirror and rotation (mirror-then-rotate
 * model, as localToSheet). Pins without a direction use the dominant axis of `fallback` (the
 * vector from the body centre to the pin).
 */
export function pinOutVector(dir: 'left' | 'right' | 'up' | 'down' | undefined, rotation: Rotation, mirror: boolean, fallback: Point): Point {
  if (!dir) {
    return Math.abs(fallback.x) >= Math.abs(fallback.y) ? { x: fallback.x < 0 ? -1 : 1, y: 0 } : { x: 0, y: fallback.y < 0 ? -1 : 1 };
  }
  const v = dir === 'left' ? { x: -1, y: 0 } : dir === 'right' ? { x: 1, y: 0 } : dir === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  return rotatePoint(mirror ? { x: -v.x, y: v.y } : v, rotation);
}

/** Open interior of a box shrunk by EPS (null when degenerate). */
function interior(box: Rect): Rect | null {
  const r = { x: box.x + EPS, y: box.y + EPS, w: box.w - 2 * EPS, h: box.h - 2 * EPS };
  return r.w > 0 && r.h > 0 ? r : null;
}

function strictlyInside(p: Point, r: Rect): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/** True when segment a-b passes through the open rectangle (Liang–Barsky clipping). */
function segmentEntersRect(a: Point, b: Point, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - r.x)) return false;
  if (!clip(dx, r.x + r.w - a.x)) return false;
  if (!clip(-dy, a.y - r.y)) return false;
  if (!clip(dy, r.y + r.h - a.y)) return false;
  if (t1 <= t0) return false;
  // the clipped piece must lie strictly inside (not just along an edge)
  const mid = { x: a.x + ((t0 + t1) / 2) * dx, y: a.y + ((t0 + t1) / 2) * dy };
  return strictlyInside(mid, r);
}

function onPolyline(points: Point[], p: Point): boolean {
  for (let i = 0; i + 1 < points.length; i++) if (pointOnSegment(p, points[i], points[i + 1])) return true;
  return false;
}

interface Attachment {
  part: number;
  pin: ObstaclePin;
}

function attachmentAt(parts: ObstaclePart[], p: Point): Attachment | null {
  for (let i = 0; i < parts.length; i++) {
    const pin = parts[i].pins.find((q) => samePoint(q, p));
    if (pin) return { part: i, pin };
  }
  return null;
}

/** Bodies a route must avoid: interiors of moved parts that do not contain an end of the wire. */
function bodies(parts: ObstaclePart[], a: Point, b: Point): Rect[] {
  const out: Rect[] = [];
  for (const p of parts) {
    const r = interior(p.box);
    if (r && !strictlyInside(a, r) && !strictlyInside(b, r)) out.push(r);
  }
  return out;
}

function isTangled(points: Point[], parts: ObstaclePart[]): boolean {
  const a = points[0];
  const b = points[points.length - 1];
  for (const part of parts) {
    for (const pin of part.pins) {
      if (samePoint(pin, a) || samePoint(pin, b)) continue;
      if (onPolyline(points, pin)) return true;
    }
  }
  for (const r of bodies(parts, a, b)) {
    for (let i = 0; i + 1 < points.length; i++) if (segmentEntersRect(points[i], points[i + 1], r)) return true;
  }
  return false;
}

/** First grid point outside the attached part's body, going out of the pin. */
function stubPoint(pin: ObstaclePin, box: Rect): Point {
  const { out } = pin;
  if (out.x > 0) return { x: Math.ceil((Math.max(pin.x, box.x + box.w) + EPS) / GRID) * GRID, y: pin.y };
  if (out.x < 0) return { x: Math.floor((Math.min(pin.x, box.x) - EPS) / GRID) * GRID, y: pin.y };
  if (out.y > 0) return { x: pin.x, y: Math.ceil((Math.max(pin.y, box.y + box.h) + EPS) / GRID) * GRID };
  return { x: pin.x, y: Math.floor((Math.min(pin.y, box.y) - EPS) / GRID) * GRID };
}

interface Others {
  wires: Wire[];
  pins: Point[];
}

function routeIsClean(pts: Point[], bodiesToAvoid: Rect[], others: Others): boolean {
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 0; i + 1 < pts.length; i++) {
    for (const r of bodiesToAvoid) if (segmentEntersRect(pts[i], pts[i + 1], r)) return false;
  }
  const isEnd = (p: Point) => samePoint(p, a) || samePoint(p, b);
  for (const p of others.pins) if (!isEnd(p) && onPolyline(pts, p)) return false;
  for (const w of others.wires) {
    if (w.points.length < 2) continue;
    for (const e of [w.points[0], w.points[w.points.length - 1]]) if (!isEnd(e) && onPolyline(pts, e)) return false;
    for (let i = 1; i + 1 < pts.length; i++) if (onPolyline(w.points, pts[i])) return false;
  }
  return true;
}

function reroute(points: Point[], parts: ObstaclePart[], others: Others): Point[] | null {
  const a = points[0];
  const b = points[points.length - 1];
  const pa = attachmentAt(parts, a);
  const pb = attachmentAt(parts, b);
  const s = pa ? stubPoint(pa.pin, parts[pa.part].box) : a;
  const t = pb ? stubPoint(pb.pin, parts[pb.part].box) : b;
  const head = pa ? [a, s] : [a];
  const tail = pb ? [t, b] : [b];
  const middles: Point[][] = [[{ x: t.x, y: s.y }], [{ x: s.x, y: t.y }]];
  for (const part of parts) {
    const left = Math.floor((part.box.x - EPS) / GRID) * GRID;
    const right = Math.ceil((part.box.x + part.box.w + EPS) / GRID) * GRID;
    const top = Math.floor((part.box.y - EPS) / GRID) * GRID;
    const bottom = Math.ceil((part.box.y + part.box.h + EPS) / GRID) * GRID;
    for (const x of [left, right]) middles.push([{ x, y: s.y }, { x, y: t.y }]);
    for (const y of [top, bottom]) middles.push([{ x: s.x, y }, { x: t.x, y }]);
  }
  const avoid = bodies(parts, a, b);
  let best: Point[] | null = null;
  let bestLen = Infinity;
  for (const mid of middles) {
    const pts = simplifyPoints([...head, ...mid, ...tail]);
    if (pts.length < 2 || !samePoint(pts[0], a) || !samePoint(pts[pts.length - 1], b)) continue;
    if (!routeIsClean(pts, avoid, others)) continue;
    const len = polylineLength(pts);
    if (len < bestLen - EPS) {
      best = pts;
      bestLen = len;
    }
  }
  return best;
}

/**
 * Replace tangled rubber-banded wires by clean routes (see module comment). Returns `wires`
 * itself when nothing was re-routed.
 */
export function untangleWires(input: UntangleInput): Wire[] {
  const { wires, rubberBanded, parts, pins } = input;
  if (parts.length === 0 || rubberBanded.size === 0) return wires;
  const tangled = new Set<number>();
  wires.forEach((w, i) => {
    if (!rubberBanded.has(w.id) || w.points.length < 2) return;
    const a = attachmentAt(parts, w.points[0]);
    const b = attachmentAt(parts, w.points[w.points.length - 1]);
    if (!a && !b) return;
    // a wire between two pins of the same part is deliberately across that part
    if (a && b && a.part === b.part) return;
    if (isTangled(w.points, parts)) tangled.add(i);
  });
  if (tangled.size === 0) return wires;
  const out = wires.slice();
  // tangled wires are routed one after the other; each sees the others' final routes only
  const done = new Set<number>();
  for (const i of tangled) {
    const others: Others = { wires: out.filter((_, j) => j !== i && (!tangled.has(j) || done.has(j))), pins };
    const route = reroute(out[i].points, parts, others);
    if (route) out[i] = { ...out[i], points: route };
    done.add(i);
  }
  return out;
}
