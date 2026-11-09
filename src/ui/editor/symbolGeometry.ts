/**
 * Pure geometry for drawing library symbols ({@link SymbolDef}) on the schematic.
 *
 * Parts are drawn in part-local coordinates inside an SVG group whose transform reproduces
 * `localToSheet` from src/model/geometry.ts (mirror x, then rotate clockwise, then translate).
 * Text primitives marked `upright` (the default) are NOT drawn inside that group: their anchor
 * point is transformed to sheet coordinates and the text is drawn unrotated, with its horizontal
 * anchor swapped when the part's local +x axis points left on screen — so labels stay readable
 * at every orientation.
 *
 * Text convention: (x, y) of a text primitive is the vertical CENTRE of the line
 * (rendered with `dominant-baseline: central`).
 */
import type { FillStyle, SymbolPrim } from '../../library/types';
import type { PartInstance, Point } from '../../model/types';
import { localToSheet, rotatePoint } from '../../model/geometry';

export type Orientation = Pick<PartInstance, 'x' | 'y' | 'rotation' | 'mirror'>;
export type TextAnchor = 'start' | 'middle' | 'end';

/** SVG transform equivalent to localToSheet for an instance. */
export function partTransform(o: Orientation): string {
  let t = `translate(${o.x} ${o.y})`;
  if (o.rotation) t += ` rotate(${o.rotation})`;
  if (o.mirror) t += ' scale(-1 1)';
  return t;
}

/** Fill attribute for a primitive's fill style. */
export function resolveFill(fill: FillStyle | undefined): string {
  if (fill === true) return 'currentColor';
  if (typeof fill === 'string' && fill.length > 0) return fill;
  return 'none';
}

/** Screen direction of the part-local +x axis after mirror and rotation (unit vector). */
export function localXDirection(o: Pick<Orientation, 'rotation' | 'mirror'>): Point {
  return rotatePoint({ x: o.mirror ? -1 : 1, y: 0 }, o.rotation);
}

function flipAnchor(a: TextAnchor): TextAnchor {
  return a === 'start' ? 'end' : a === 'end' ? 'start' : 'middle';
}

/**
 * Sheet position and anchor of an upright text primitive. When the local +x axis points left the
 * anchor is mirrored; when it points up/down (90°/270°) text is centred on its anchor point.
 */
export function uprightTextPlacement(
  prim: { x: number; y: number; anchor?: TextAnchor },
  o: Orientation,
): { x: number; y: number; anchor: TextAnchor } {
  const p = localToSheet({ x: prim.x, y: prim.y }, o);
  const anchor = prim.anchor ?? 'start';
  const d = localXDirection(o);
  if (d.x > 0.5) return { x: p.x, y: p.y, anchor };
  if (d.x < -0.5) return { x: p.x, y: p.y, anchor: flipAnchor(anchor) };
  return { x: p.x, y: p.y, anchor: 'middle' };
}

/** Point on a circle at `deg` degrees measured clockwise on screen from +x (y grows downward). */
export function arcPoint(cx: number, cy: number, r: number, deg: number): Point {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * SVG path data for an arc from `start` to `end` degrees, swept clockwise on screen. A sweep of
 * 360° (or more) yields a full circle drawn as two half arcs.
 */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  let sweep = end - start;
  if (sweep <= 0) sweep += 360 * Math.ceil((-sweep + 1e-9) / 360);
  if (sweep >= 360 - 1e-9) {
    const a = arcPoint(cx, cy, r, start);
    const b = arcPoint(cx, cy, r, start + 180);
    return `M${fmt(a.x)} ${fmt(a.y)}A${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(b.x)} ${fmt(b.y)}A${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(a.x)} ${fmt(a.y)}`;
  }
  const a = arcPoint(cx, cy, r, start);
  const b = arcPoint(cx, cy, r, start + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M${fmt(a.x)} ${fmt(a.y)}A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(b.x)} ${fmt(b.y)}`;
}

/** "x0,y0 x1,y1 ..." for an SVG polyline from a flat coordinate list (odd trailing value ignored). */
export function polylinePoints(flat: number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(`${fmt(flat[i])},${fmt(flat[i + 1])}`);
  return out.join(' ');
}

/** True for text primitives that are drawn upright (outside the rotated group). */
export function isUprightText(p: SymbolPrim): p is Extract<SymbolPrim, { kind: 'text' }> {
  return p.kind === 'text' && p.upright !== false;
}
