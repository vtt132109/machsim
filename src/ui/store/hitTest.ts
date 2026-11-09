/**
 * Hit-testing and rubber-band selection on a sheet (pure, sheet coordinates).
 *
 * Priority of {@link hitTest} (top-most first): probes, net labels, text notes, pins, part
 * ref/value labels, wires, part bodies. Tolerances are in sheet units; callers usually pass a
 * screen-pixel tolerance divided by the zoom factor.
 */
import type { Point, Sheet } from '../../model/types';
import { pointOnSegment } from '../../model/geometry';
import type { PartLookup, Rect, SelItem } from './types';
import { sheetPins, type SheetPin } from './designOps';
import { nearestOnPolyline } from './routing';
import type { Shape, TextNote } from '../../model/types';
import { hasDrawingOrder, stackIndex } from '../../model/annotationOrder';
import {
  netLabelLayout,
  shapeBox,
  noteBox,
  partBox,
  partLabelLayout,
  pointInRect,
  probeLayout,
  rectContains,
  rectsIntersect,
  wireBox,
} from './shapes';

export type HitResult =
  | { kind: 'pin'; partId: string; pin: string; x: number; y: number; dir?: SheetPin['dir'] }
  | { kind: 'part'; id: string }
  | { kind: 'partLabel'; id: string; which: 'ref' | 'value' }
  | { kind: 'wire'; id: string; segment: number; x: number; y: number }
  | { kind: 'label'; id: string }
  | { kind: 'probe'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'shape'; id: string };

export interface HitOptions {
  lookup: PartLookup;
  /** general pick tolerance (sheet units) */
  tolerance?: number;
  /** pin capture radius (sheet units) */
  pinRadius?: number;
  /** skip these hit kinds */
  exclude?: HitResult['kind'][];
}

/** The notes / shapes of a sheet, top-most first (Edit > Order decides; otherwise the later one is on top). */
function topFirst(sheet: Sheet, kind: 'note'): TextNote[];
function topFirst(sheet: Sheet, kind: 'shape'): Shape[];
function topFirst(sheet: Sheet, kind: 'note' | 'shape'): (TextNote | Shape)[] {
  const list: (TextNote | Shape)[] = kind === 'note' ? sheet.notes : (sheet.shapes ?? []);
  if (!hasDrawingOrder(sheet)) return [...list].reverse();
  const at = stackIndex(sheet);
  return [...list].sort((a, b) => (at.get(`${kind}:${b.id}`) ?? 0) - (at.get(`${kind}:${a.id}`) ?? 0));
}

/** Top-most object under `p`, or null. */
export function hitTest(sheet: Sheet, p: Point, opts: HitOptions): HitResult | null {
  const tol = opts.tolerance ?? 4;
  const pinR = opts.pinRadius ?? 5;
  const skip = new Set(opts.exclude ?? []);
  const { lookup } = opts;

  if (!skip.has('probe')) {
    for (let i = sheet.probes.length - 1; i >= 0; i--) {
      const pr = sheet.probes[i];
      const lay = probeLayout(pr);
      if (pointInRect(p, lay.flag, tol / 2) || Math.hypot(p.x - pr.x, p.y - pr.y) <= tol) return { kind: 'probe', id: pr.id };
    }
  }
  if (!skip.has('label')) {
    for (let i = sheet.labels.length - 1; i >= 0; i--) {
      const l = sheet.labels[i];
      if (pointInRect(p, netLabelLayout(l).box, tol / 2)) return { kind: 'label', id: l.id };
    }
  }
  if (!skip.has('note')) {
    for (const n of topFirst(sheet, 'note')) {
      if (pointInRect(p, noteBox(n), tol / 2)) return { kind: 'note', id: n.id };
    }
  }
  if (!skip.has('pin')) {
    const pin = nearestPin(sheet, p, pinR, lookup);
    if (pin) return { kind: 'pin', partId: pin.partId, pin: pin.name, x: pin.x, y: pin.y, dir: pin.dir };
  }
  if (!skip.has('partLabel')) {
    for (let i = sheet.parts.length - 1; i >= 0; i--) {
      const inst = sheet.parts[i];
      for (const lab of partLabelLayout(inst, lookup(inst.partId))) {
        if (lab.visible && pointInRect(p, lab.box, 1)) return { kind: 'partLabel', id: inst.id, which: lab.which };
      }
    }
  }
  if (!skip.has('wire')) {
    const w = nearestWire(sheet, p, tol);
    if (w) return w;
  }
  if (!skip.has('part')) {
    for (let i = sheet.parts.length - 1; i >= 0; i--) {
      const inst = sheet.parts[i];
      if (pointInRect(p, partBox(inst, lookup(inst.partId)), tol / 2)) return { kind: 'part', id: inst.id };
    }
  }
  if (!skip.has('shape') && sheet.shapes) {
    for (const x of topFirst(sheet, 'shape')) if (shapeHit(x, p, tol)) return { kind: 'shape', id: x.id };
  }
  return null;
}

/**
 * True when `p` is on a graphic annotation: near its outline (lines, polylines, outlines of
 * unfilled rectangles / polygons / ellipses / arcs) or inside it (filled shapes and pictures).
 */
export function shapeHit(s: Shape, p: Point, tol: number): boolean {
  const box = shapeBox(s);
  if (!pointInRect(p, box, tol)) return false;
  const near = (pts: Point[], closed: boolean) => {
    const list = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < list.length; i++) if (distToSegment(p, list[i], list[i + 1]) <= tol) return true;
    return false;
  };
  const [a, b] = [s.points[0], s.points[1] ?? s.points[0]];
  const filled = !!s.fill || s.kind === 'picture';
  switch (s.kind) {
    case 'line':
    case 'polyline':
      return near(s.points, false);
    case 'polygon':
      return near(s.points, true) || (filled && pointInRect(p, box));
    case 'rect':
    case 'picture': {
      const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      return near(corners, true) || (filled && pointInRect(p, box));
    }
    case 'ellipse':
    case 'arc': {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.max(1, Math.abs(b.x - a.x) / 2);
      const ry = Math.max(1, Math.abs(b.y - a.y) / 2);
      const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      return Math.abs(r - 1) * Math.min(rx, ry) <= tol || (filled && s.kind === 'ellipse' && r <= 1);
    }
  }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Closest pin within `radius`, or null. */
export function nearestPin(sheet: Sheet, p: Point, radius: number, lookup: PartLookup): SheetPin | null {
  let best: SheetPin | null = null;
  let bestD = radius;
  for (const pin of sheetPins(sheet, lookup)) {
    const d = Math.hypot(pin.x - p.x, pin.y - p.y);
    if (d <= bestD) {
      best = pin;
      bestD = d;
    }
  }
  return best;
}

/** Closest wire within `tol`; the returned point is the projection of `p` onto the wire. */
export function nearestWire(sheet: Sheet, p: Point, tol: number): Extract<HitResult, { kind: 'wire' }> | null {
  let best: Extract<HitResult, { kind: 'wire' }> | null = null;
  let bestD = tol;
  for (let i = sheet.wires.length - 1; i >= 0; i--) {
    const w = sheet.wires[i];
    const n = nearestOnPolyline(w.points, p);
    if (n && n.dist <= bestD) {
      best = { kind: 'wire', id: w.id, segment: n.segment, x: n.point.x, y: n.point.y };
      bestD = n.dist;
    }
  }
  return best;
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  // orthogonal segments: compare bounding boxes; general segments: sample via Liang–Barsky clip
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX < r.x || minX > r.x + r.w || maxY < r.y || minY > r.y + r.h) return false;
  if (a.x === b.x || a.y === b.y) return true;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (pp: number, q: number): boolean => {
    if (pp === 0) return q >= 0;
    const t = q / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y) && t0 <= t1;
}

/**
 * Items selected by a rubber band. `inside` (dragging left -> right) selects items entirely
 * within the rectangle; `crossing` (right -> left) also selects items that merely touch it.
 */
export function itemsInRect(sheet: Sheet, r: Rect, mode: 'inside' | 'crossing', lookup: PartLookup): SelItem[] {
  const take = (box: Rect) => (mode === 'inside' ? rectContains(r, box) : rectsIntersect(r, box));
  const out: SelItem[] = [];
  for (const inst of sheet.parts) if (take(partBox(inst, lookup(inst.partId)))) out.push({ kind: 'part', id: inst.id });
  for (const w of sheet.wires) {
    const hit =
      mode === 'inside'
        ? rectContains(r, wireBox(w))
        : w.points.some((pt, i) => i > 0 && segmentIntersectsRect(w.points[i - 1], pt, r));
    if (hit) out.push({ kind: 'wire', id: w.id });
  }
  for (const l of sheet.labels) if (take(netLabelLayout(l).box)) out.push({ kind: 'label', id: l.id });
  for (const p of sheet.probes) if (take(probeLayout(p).box)) out.push({ kind: 'probe', id: p.id });
  for (const n of sheet.notes) if (take(noteBox(n))) out.push({ kind: 'note', id: n.id });
  for (const x of sheet.shapes ?? []) if (take(shapeBox(x))) out.push({ kind: 'shape', id: x.id });
  return out;
}

/** Wire id whose segments contain `p` exactly (used for snapping new wires / labels). */
export function wireAtPoint(sheet: Sheet, p: Point): string | null {
  for (const w of sheet.wires) {
    for (let i = 0; i < w.points.length - 1; i++) if (pointOnSegment(p, w.points[i], w.points[i + 1])) return w.id;
  }
  return null;
}
