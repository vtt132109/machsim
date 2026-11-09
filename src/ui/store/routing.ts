/**
 * Orthogonal wire routing helpers (pure geometry).
 *
 * - {@link simplifyPoints}: canonical polyline (no duplicate points, no collinear middle points).
 * - {@link routeL}: one- or two-segment "L" route between two points; `horizontalFirst` chooses
 *   which leg comes first (the '/' key flips it in the wire tool).
 * - {@link draftPoints}: committed corners + L route to the cursor (wire tool preview).
 * - {@link rubberBandPoints}: keep a wire orthogonal while one or both of its ends are dragged.
 * - {@link pinStubHorizontal}: preferred first-leg orientation when a wire starts on a pin.
 */
import type { Point, Rotation } from '../../model/types';
import { GRID } from '../../model/types';
import { rotatePoint, samePoint, snap } from '../../model/geometry';

const EPS = 0.5;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

/** Remove consecutive duplicates and collinear middle points (repeated until stable). */
export function simplifyPoints(points: Point[]): Point[] {
  let out = points.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const dedup: Point[] = [];
    for (const p of out) {
      if (dedup.length > 0 && samePoint(dedup[dedup.length - 1], p)) {
        changed = true;
        continue;
      }
      dedup.push(p);
    }
    out = dedup;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      if ((near(a.x, b.x) && near(b.x, c.x)) || (near(a.y, b.y) && near(b.y, c.y))) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** True when two polylines contain the same points in the same order. */
export function samePoints(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!samePoint(a[i], b[i])) return false;
  return true;
}

/** Orthogonal route from a to b with at most one corner. */
export function routeL(a: Point, b: Point, horizontalFirst: boolean): Point[] {
  if (samePoint(a, b)) return [a];
  if (near(a.x, b.x) || near(a.y, b.y)) return [a, b];
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [a, corner, b];
}

/** Wire-tool preview: committed corner points followed by an L route to `cursor`. */
export function draftPoints(committed: Point[], cursor: Point, horizontalFirst: boolean): Point[] {
  if (committed.length === 0) return [];
  const last = committed[committed.length - 1];
  return simplifyPoints([...committed, ...routeL(last, cursor, horizontalFirst).slice(1)]);
}

/** Length of a polyline. */
export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return len;
}

/** Closest point on a polyline to `p`, with the index of the segment it lies on. */
export function nearestOnPolyline(points: Point[], p: Point): { point: Point; segment: number; dist: number } | null {
  let best: { point: Point; segment: number; dist: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dist < best.dist) best = { point: q, segment: i, dist };
  }
  return best;
}

function moveFirstEnd(pts: Point[], d: Point): Point[] {
  const a = pts[0];
  const moved = { x: a.x + d.x, y: a.y + d.y };
  if (pts.length === 2) {
    const b = pts[1];
    const horizontal = near(a.y, b.y) && !near(a.x, b.x);
    if (horizontal) {
      if (near(moved.y, b.y)) return [moved, b];
      const midX = snap((moved.x + b.x) / 2);
      return [moved, { x: midX, y: moved.y }, { x: midX, y: b.y }, b];
    }
    if (near(moved.x, b.x)) return [moved, b];
    const midY = snap((moved.y + b.y) / 2);
    return [moved, { x: moved.x, y: midY }, { x: b.x, y: midY }, b];
  }
  const p1 = pts[1];
  const firstHorizontal = near(a.y, p1.y);
  const p1moved = firstHorizontal ? { x: p1.x, y: p1.y + d.y } : { x: p1.x + d.x, y: p1.y };
  return [moved, p1moved, ...pts.slice(2)];
}

/**
 * Re-route an orthogonal polyline after its first end moved by `d0` and/or its last end moved by
 * `d1` (null = that end stays). Equal deltas translate the whole wire. Otherwise the segment next
 * to a moved end keeps its orientation by sliding the adjacent corner; a straight single segment
 * gets a Z-shaped dog-leg through its (snapped) middle.
 */
export function rubberBandPoints(pts: Point[], d0: Point | null, d1: Point | null): Point[] {
  if (pts.length < 2) return pts;
  const z0 = !d0 || (d0.x === 0 && d0.y === 0);
  const z1 = !d1 || (d1.x === 0 && d1.y === 0);
  if (z0 && z1) return pts;
  if (d0 && d1 && d0.x === d1.x && d0.y === d1.y) {
    return pts.map((p) => ({ x: p.x + d0.x, y: p.y + d0.y }));
  }
  let out = pts;
  if (!z0 && d0) out = moveFirstEnd(out, d0);
  if (!z1 && d1) out = moveFirstEnd(out.slice().reverse(), d1).reverse();
  return simplifyPoints(out);
}

/**
 * Whether a wire leaving a pin should start horizontally: true when the pin stub points left/right
 * on screen after the part's mirror and rotation. Pins without a direction default to horizontal.
 */
export function pinStubHorizontal(
  dir: 'left' | 'right' | 'up' | 'down' | undefined,
  rotation: Rotation,
  mirror: boolean,
): boolean {
  if (!dir) return true;
  const v = dir === 'left' ? { x: -1, y: 0 } : dir === 'right' ? { x: 1, y: 0 } : dir === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  const m = mirror ? { x: -v.x, y: v.y } : v;
  const r = rotatePoint(m, rotation);
  return Math.abs(r.x) > Math.abs(r.y);
}

/** Snap a point to the grid (re-exported convenience used by the canvas). */
export function snapToGrid(p: Point, grid = GRID): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}
