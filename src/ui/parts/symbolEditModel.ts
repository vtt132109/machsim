/**
 * Symbol editor operations (pure): add / move / delete shapes and pins, hit testing, bounding box,
 * grid snapping, import / export of symbol files (`.msimsym` JSON). The editor component is
 * SymbolEditor.tsx; symbols use the library's SymbolDef (part-local coordinates, y down, pins on the
 * 10-unit grid so they land on the schematic grid).
 *
 * Round 3 step 7 added the editing a learner expects from a drawing program:
 *   - several shapes and pins selected at once (`targetsInRect`, `moveTargets`, `deleteTargets`),
 *   - copy and paste inside the editor and between symbols (`copyTargets`, `pasteFragment`),
 *   - resize handles on the selected shape (`targetHandles`, `resizeTarget`),
 *   - the arc tool (`arcPrim`, `arcAngle`).
 */
import type { PinDef, PinType, SymbolDef, SymbolPrim } from '../../library/types';
import type { SymbolFile } from '../../library/custom/types';
import { readSymbol } from '../../library/custom/validate';

export type SymTarget = { kind: 'prim'; index: number } | { kind: 'pin'; index: number };
export type PinDir = NonNullable<PinDef['dir']>;

/** Length of the stub line drawn with a new pin. */
export const PIN_STUB = 10;

export function snap(v: number, grid: number): number {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounds of one shape (text: an estimate from its size and length). */
export function primBounds(p: SymbolPrim): Box {
  switch (p.kind) {
    case 'line':
      return { x0: Math.min(p.x1, p.x2), y0: Math.min(p.y1, p.y2), x1: Math.max(p.x1, p.x2), y1: Math.max(p.y1, p.y2) };
    case 'rect':
      return { x0: Math.min(p.x, p.x + p.w), y0: Math.min(p.y, p.y + p.h), x1: Math.max(p.x, p.x + p.w), y1: Math.max(p.y, p.y + p.h) };
    case 'circle':
    case 'arc':
      return { x0: p.cx - p.r, y0: p.cy - p.r, x1: p.cx + p.r, y1: p.cy + p.r };
    case 'polyline': {
      const xs = p.points.filter((_, i) => i % 2 === 0);
      const ys = p.points.filter((_, i) => i % 2 === 1);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case 'path': {
      const nums = (p.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return xs.length && ys.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
    }
    case 'text': {
      const size = p.size ?? 9;
      const w = p.text.length * size * 0.6;
      const x0 = p.anchor === 'end' ? p.x - w : p.anchor === 'start' ? p.x : p.x - w / 2;
      return { x0, y0: p.y - size, x1: x0 + w, y1: p.y + size * 0.25 };
    }
  }
}

/** Recompute the bounding box from the shapes and pins; keep label positions or place them above / below. */
export function fitBBox(sym: SymbolDef): SymbolDef {
  const boxes = [...sym.prims.map(primBounds), ...sym.pins.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }))];
  if (boxes.length === 0) return { ...sym, bbox: { x: -10, y: -10, w: 20, h: 20 } };
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const y1 = Math.max(...boxes.map((b) => b.y1));
  return {
    ...sym,
    bbox: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) },
    refPos: sym.refPos ?? { x: (x0 + x1) / 2, y: y0 - 6 },
    valuePos: sym.valuePos ?? { x: (x0 + x1) / 2, y: y1 + 14 },
  };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Distance from a point to a shape's outline (filled shapes: 0 inside). */
export function primDistance(p: SymbolPrim, x: number, y: number): number {
  switch (p.kind) {
    case 'line':
      return distToSegment(x, y, p.x1, p.y1, p.x2, p.y2);
    case 'rect': {
      const b = primBounds(p);
      const inside = x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
      if (inside && p.fill) return 0;
      const edges = [distToSegment(x, y, b.x0, b.y0, b.x1, b.y0), distToSegment(x, y, b.x1, b.y0, b.x1, b.y1), distToSegment(x, y, b.x1, b.y1, b.x0, b.y1), distToSegment(x, y, b.x0, b.y1, b.x0, b.y0)];
      return Math.min(...edges);
    }
    case 'circle': {
      const d = Math.hypot(x - p.cx, y - p.cy);
      return p.fill && d <= p.r ? 0 : Math.abs(d - p.r);
    }
    case 'arc':
      return Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r);
    case 'polyline': {
      let best = Infinity;
      const n = p.points.length / 2;
      for (let i = 0; i + 1 < n; i++) best = Math.min(best, distToSegment(x, y, p.points[2 * i], p.points[2 * i + 1], p.points[2 * i + 2], p.points[2 * i + 3]));
      if (p.closed && n > 2) best = Math.min(best, distToSegment(x, y, p.points[2 * n - 2], p.points[2 * n - 1], p.points[0], p.points[1]));
      return best;
    }
    case 'path':
    case 'text': {
      const b = primBounds(p);
      return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 ? 0 : Infinity;
    }
  }
}

/** The pin or shape under (x, y) within `tol` (pins win; the topmost shape wins among shapes). */
export function hitTest(sym: SymbolDef, x: number, y: number, tol = 4): SymTarget | null {
  let bestPin = -1;
  let bestPinD = tol;
  sym.pins.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestPinD) {
      bestPinD = d;
      bestPin = i;
    }
  });
  if (bestPin >= 0) return { kind: 'pin', index: bestPin };
  for (let i = sym.prims.length - 1; i >= 0; i--) if (primDistance(sym.prims[i], x, y) <= tol) return { kind: 'prim', index: i };
  return null;
}

export function movePrim(p: SymbolPrim, dx: number, dy: number): SymbolPrim {
  switch (p.kind) {
    case 'line':
      return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
    case 'rect':
    case 'text':
      return { ...p, x: p.x + dx, y: p.y + dy };
    case 'circle':
    case 'arc':
      return { ...p, cx: p.cx + dx, cy: p.cy + dy };
    case 'polyline':
      return { ...p, points: p.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    case 'path': {
      let k = 0;
      return { ...p, d: p.d.replace(/-?\d+(\.\d+)?/g, (m) => String(Number(m) + (k++ % 2 === 0 ? dx : dy))) };
    }
  }
}

export function moveTarget(sym: SymbolDef, t: SymTarget, dx: number, dy: number): SymbolDef {
  if (t.kind === 'pin') return { ...sym, pins: sym.pins.map((p, i) => (i === t.index ? { ...p, x: p.x + dx, y: p.y + dy } : p)) };
  return { ...sym, prims: sym.prims.map((p, i) => (i === t.index ? movePrim(p, dx, dy) : p)) };
}

export function deleteTarget(sym: SymbolDef, t: SymTarget): SymbolDef {
  if (t.kind === 'pin') return { ...sym, pins: sym.pins.filter((_, i) => i !== t.index) };
  return { ...sym, prims: sym.prims.filter((_, i) => i !== t.index) };
}

export function addPrim(sym: SymbolDef, prim: SymbolPrim): SymbolDef {
  return { ...sym, prims: [...sym.prims, prim] };
}

// ---------------------------------------------------------------------------------------------
// several items at once
// ---------------------------------------------------------------------------------------------

/** Angle of (dx, dy) in degrees, clockwise on screen from +x (the SymbolPrim arc convention). */
export function arcAngle(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

/**
 * Arc from a drag: the pointer goes down at the centre and out to a point on the arc. The radius
 * and the start angle come from that drag; the arc spans `span` degrees clockwise (90° by default,
 * the quarter circle most symbols need), and the side panel edits the angles afterwards.
 */
export function arcPrim(centre: { x: number; y: number }, edge: { x: number; y: number }, span = 90): SymbolPrim | null {
  const r = Math.round(Math.hypot(edge.x - centre.x, edge.y - centre.y));
  if (r <= 0) return null;
  const start = arcAngle(edge.x - centre.x, edge.y - centre.y);
  return { kind: 'arc', cx: centre.x, cy: centre.y, r, start, end: start + span };
}

/** Targets whose bounding box meets the rectangle (box selection). */
export function targetsInRect(sym: SymbolDef, rect: { x: number; y: number; w: number; h: number }): SymTarget[] {
  const x0 = Math.min(rect.x, rect.x + rect.w);
  const x1 = Math.max(rect.x, rect.x + rect.w);
  const y0 = Math.min(rect.y, rect.y + rect.h);
  const y1 = Math.max(rect.y, rect.y + rect.h);
  const out: SymTarget[] = [];
  sym.prims.forEach((prim, index) => {
    const b = primBounds(prim);
    if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1) out.push({ kind: 'prim', index });
  });
  sym.pins.forEach((pin, index) => {
    if (pin.x >= x0 && pin.x <= x1 && pin.y >= y0 && pin.y <= y1) out.push({ kind: 'pin', index });
  });
  return out;
}

export function sameTarget(a: SymTarget, b: SymTarget): boolean {
  return a.kind === b.kind && a.index === b.index;
}

export function hasTarget(list: readonly SymTarget[], t: SymTarget): boolean {
  return list.some((x) => sameTarget(x, t));
}

/** Add / remove a target from a selection (Shift-click). */
export function toggleTarget(list: readonly SymTarget[], t: SymTarget): SymTarget[] {
  return hasTarget(list, t) ? list.filter((x) => !sameTarget(x, t)) : [...list, t];
}

/** Move every selected shape and pin. */
export function moveTargets(sym: SymbolDef, targets: readonly SymTarget[], dx: number, dy: number): SymbolDef {
  if (!targets.length || (dx === 0 && dy === 0)) return sym;
  const prims = new Set(targets.filter((t) => t.kind === 'prim').map((t) => t.index));
  const pins = new Set(targets.filter((t) => t.kind === 'pin').map((t) => t.index));
  return {
    ...sym,
    prims: sym.prims.map((p, i) => (prims.has(i) ? movePrim(p, dx, dy) : p)),
    pins: sym.pins.map((p, i) => (pins.has(i) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
  };
}

/** Delete every selected shape and pin (indices shift, so they are removed together). */
export function deleteTargets(sym: SymbolDef, targets: readonly SymTarget[]): SymbolDef {
  const prims = new Set(targets.filter((t) => t.kind === 'prim').map((t) => t.index));
  const pins = new Set(targets.filter((t) => t.kind === 'pin').map((t) => t.index));
  return { ...sym, prims: sym.prims.filter((_p, i) => !prims.has(i)), pins: sym.pins.filter((_p, i) => !pins.has(i)) };
}

/** Shapes and pins on the symbol editor's clipboard. */
export interface SymbolFragment {
  prims: SymbolPrim[];
  pins: PinDef[];
}

/** Copy the selected shapes and pins (in drawing order). */
export function copyTargets(sym: SymbolDef, targets: readonly SymTarget[]): SymbolFragment {
  const prims = targets.filter((t) => t.kind === 'prim').map((t) => sym.prims[t.index]).filter((p): p is SymbolPrim => !!p);
  const pins = targets.filter((t) => t.kind === 'pin').map((t) => sym.pins[t.index]).filter((p): p is PinDef => !!p);
  return { prims: prims.map((p) => ({ ...p })), pins: pins.map((p) => ({ ...p })) };
}

/**
 * Paste a fragment with an offset; pasted pins get free names and numbers, so a pasted pin never
 * takes the name of an existing one. Returns the symbol and the new items' targets (so the editor
 * can select what it just pasted).
 */
export function pasteFragment(sym: SymbolDef, frag: SymbolFragment, dx: number, dy: number): { symbol: SymbolDef; targets: SymTarget[] } {
  let out: SymbolDef = { ...sym, prims: [...sym.prims], pins: [...sym.pins] };
  const targets: SymTarget[] = [];
  for (const prim of frag.prims) {
    targets.push({ kind: 'prim', index: out.prims.length });
    out = { ...out, prims: [...out.prims, movePrim(prim, dx, dy)] };
  }
  for (const pin of frag.pins) {
    const name = nextPinName(out);
    targets.push({ kind: 'pin', index: out.pins.length });
    out = { ...out, pins: [...out.pins, { ...pin, name, number: /^\d+$/.test(name) ? name : String(out.pins.length + 1), x: pin.x + dx, y: pin.y + dy }] };
  }
  return { symbol: out, targets };
}

// ---------------------------------------------------------------------------------------------
// resize handles
// ---------------------------------------------------------------------------------------------

/** One drag handle of the selected shape. */
export interface SymHandle {
  /** which corner / point the handle is: 'nw' | 'ne' | 'sw' | 'se' for a box, 'p<n>' for a vertex, 'r' for a radius */
  id: string;
  x: number;
  y: number;
}

/** The handles of a shape: box corners, polyline vertices, line ends, the radius of a circle / arc. */
export function targetHandles(sym: SymbolDef, target: SymTarget): SymHandle[] {
  if (target.kind === 'pin') return [];
  const p = sym.prims[target.index];
  if (!p) return [];
  switch (p.kind) {
    case 'line':
      return [
        { id: 'p0', x: p.x1, y: p.y1 },
        { id: 'p1', x: p.x2, y: p.y2 },
      ];
    case 'rect':
      return [
        { id: 'nw', x: p.x, y: p.y },
        { id: 'ne', x: p.x + p.w, y: p.y },
        { id: 'sw', x: p.x, y: p.y + p.h },
        { id: 'se', x: p.x + p.w, y: p.y + p.h },
      ];
    case 'circle':
    case 'arc':
      return [{ id: 'r', x: p.cx + p.r, y: p.cy }];
    case 'polyline':
      return Array.from({ length: p.points.length / 2 }, (_v, i) => ({ id: `p${i}`, x: p.points[2 * i], y: p.points[2 * i + 1] }));
    default:
      return [];
  }
}

/** Drag a handle to (x, y): the shape is resized, never flipped inside out (1 unit minimum). */
export function resizeTarget(sym: SymbolDef, target: SymTarget, handle: string, x: number, y: number): SymbolDef {
  if (target.kind === 'pin') return sym;
  const p = sym.prims[target.index];
  if (!p) return sym;
  const put = (prim: SymbolPrim) => replacePrim(sym, target.index, prim);
  switch (p.kind) {
    case 'line':
      return put(handle === 'p0' ? { ...p, x1: x, y1: y } : { ...p, x2: x, y2: y });
    case 'rect': {
      const left = handle === 'nw' || handle === 'sw';
      const top = handle === 'nw' || handle === 'ne';
      const x0 = left ? x : p.x;
      const y0 = top ? y : p.y;
      const x1 = left ? p.x + p.w : x;
      const y1 = top ? p.y + p.h : y;
      return put({ ...p, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(1, Math.abs(x1 - x0)), h: Math.max(1, Math.abs(y1 - y0)) });
    }
    case 'circle':
    case 'arc':
      return put({ ...p, r: Math.max(1, Math.round(Math.hypot(x - p.cx, y - p.cy))) });
    case 'polyline': {
      const i = Number(handle.replace('p', ''));
      if (!Number.isInteger(i) || i < 0 || 2 * i + 1 >= p.points.length) return sym;
      const points = [...p.points];
      points[2 * i] = x;
      points[2 * i + 1] = y;
      return put({ ...p, points });
    }
    default:
      return sym;
  }
}

export function replacePrim(sym: SymbolDef, index: number, prim: SymbolPrim): SymbolDef {
  return { ...sym, prims: sym.prims.map((p, i) => (i === index ? prim : p)) };
}

/** Next free pin name / number: the smallest positive integer not used yet. */
export function nextPinName(sym: SymbolDef): string {
  const used = new Set(sym.pins.flatMap((p) => [p.name, p.number ?? '']));
  for (let k = 1; ; k++) if (!used.has(String(k))) return String(k);
}

const STUB: Record<PinDir, [number, number]> = { left: [PIN_STUB, 0], right: [-PIN_STUB, 0], up: [0, PIN_STUB], down: [0, -PIN_STUB] };

/** Add a pin at (x, y) pointing `dir` away from the body, with its stub line towards the body. */
export function addPin(sym: SymbolDef, x: number, y: number, dir: PinDir, opts: { name?: string; type?: PinType; label?: string } = {}): { symbol: SymbolDef; index: number } {
  const name = opts.name ?? nextPinName(sym);
  const pin: PinDef = { name, x, y, dir, number: /^\d+$/.test(name) ? name : String(sym.pins.length + 1), type: opts.type ?? 'passive' };
  if (opts.label) pin.label = opts.label;
  const [sx, sy] = STUB[dir];
  const stub: SymbolPrim = { kind: 'line', x1: x, y1: y, x2: x + sx, y2: y + sy };
  return { symbol: { ...sym, pins: [...sym.pins, pin], prims: [...sym.prims, stub] }, index: sym.pins.length };
}

export function updatePin(sym: SymbolDef, index: number, patch: Partial<PinDef>): SymbolDef {
  return { ...sym, pins: sym.pins.map((p, i) => (i === index ? { ...p, ...patch } : p)) };
}

/** Problems of the pin list: empty or duplicate names, pins off the 10-unit grid. */
export function pinIssues(sym: SymbolDef): { index: number; code: 'empty' | 'duplicate' | 'offGrid' }[] {
  const out: { index: number; code: 'empty' | 'duplicate' | 'offGrid' }[] = [];
  const seen = new Map<string, number>();
  sym.pins.forEach((p, i) => {
    if (!p.name.trim()) out.push({ index: i, code: 'empty' });
    else if (seen.has(p.name)) out.push({ index: i, code: 'duplicate' });
    seen.set(p.name, i);
    if (p.x % 10 !== 0 || p.y % 10 !== 0) out.push({ index: i, code: 'offGrid' });
  });
  return out;
}

/** Shift the whole symbol (shapes, pins, label positions). */
export function translateSymbol(sym: SymbolDef, dx: number, dy: number): SymbolDef {
  return fitBBox({
    ...sym,
    prims: sym.prims.map((p) => movePrim(p, dx, dy)),
    pins: sym.pins.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    ...(sym.refPos ? { refPos: { x: sym.refPos.x + dx, y: sym.refPos.y + dy } } : {}),
    ...(sym.valuePos ? { valuePos: { x: sym.valuePos.x + dx, y: sym.valuePos.y + dy } } : {}),
  });
}

export function symbolToFile(sym: SymbolDef, name?: string): string {
  const f: SymbolFile = { format: 'machsim-symbol', version: 1, ...(name ? { name } : {}), symbol: sym };
  return JSON.stringify(f, null, 2);
}

export class SymbolFileError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.slice(0, 3).join('; '));
    this.name = 'SymbolFileError';
  }
}

/** Read a symbol file (or a bare SymbolDef JSON). Throws SymbolFileError with JSON paths. */
export function parseSymbolFile(text: string): { symbol: SymbolDef; name?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SymbolFileError([`not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  const issues: string[] = [];
  const o = raw as Record<string, unknown> | null;
  const body = o && typeof o === 'object' && o.format === 'machsim-symbol' ? o.symbol : raw;
  const sym = readSymbol(body, 'symbol', issues);
  if (!sym || issues.length) throw new SymbolFileError(issues.length ? issues : ['symbol: expected an object']);
  if (sym.pins.length === 0) throw new SymbolFileError(['symbol.pins: a symbol needs at least one pin']);
  const name = o && typeof o.name === 'string' ? o.name : undefined;
  return { symbol: fitBBox(sym), ...(name ? { name } : {}) };
}
