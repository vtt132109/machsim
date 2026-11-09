/**
 * Layout of schematic annotations shared by rendering, hit-testing and export.
 *
 * Text metrics are estimated (average glyph width 0.6 em) so layout is deterministic and works
 * without a DOM. Text positions use a *central* vertical baseline: (x, y) is the vertical centre
 * of the text line; the canvas renders with `dominant-baseline: central` to match.
 */
import type { PartDef } from '../../library/types';
import type { NetLabel, PartInstance, Point, Probe, Shape, TextNote, Wire } from '../../model/types';
import { instanceBBox } from '../../model/geometry';
import type { Rect } from './types';
import { optionLabel, paramLabel, partName } from '../../i18n/library';
import { HIDDEN_VALUE } from '../../model/restrictions';
import { packageOf, sectionLabel } from '../../model/sections';

export const PART_LABEL_SIZE = 11;
export const NET_LABEL_SIZE = 11;
export const PROBE_LABEL_SIZE = 10;
export const NOTE_DEFAULT_SIZE = 12;
/** Bounding box used for parts whose PartDef is missing from the library. */
export const UNKNOWN_PART_BOX: Rect = { x: -20, y: -20, w: 40, h: 40 };

export type TextAnchor = 'start' | 'middle' | 'end';

export function textWidth(text: string, size: number): number {
  return text.length * size * 0.6;
}

/** Box of a single text line placed at (x, y) with central baseline. */
export function textBox(x: number, y: number, text: string, size: number, anchor: TextAnchor): Rect {
  const w = textWidth(text, size);
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: left, y: y - size / 2, w, h: size };
}

export function rectUnion(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** Normalised rectangle from two corner points. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Sheet-space bounding box of a part body. */
export function partBox(inst: PartInstance, part: PartDef | undefined): Rect {
  if (part) return instanceBBox(inst, part);
  return { x: inst.x + UNKNOWN_PART_BOX.x, y: inst.y + UNKNOWN_PART_BOX.y, w: UNKNOWN_PART_BOX.w, h: UNKNOWN_PART_BOX.h };
}

/**
 * Text shown as the "value" label of a part (parameters flagged showOnSchematic). `hidden`: the
 * instructor hides part values (Design.restrictions.hideValues) — components show "?", power
 * symbols and instruments keep their label.
 */
export function partValueText(inst: PartInstance, part: PartDef | undefined, hidden = false): string {
  if (!part) return inst.partId;
  if (part.globalNet !== undefined) return part.globalNet === '0' ? '' : part.globalNet;
  if (hidden && !part.instrument) return HIDDEN_VALUE;
  const shown = part.params.filter((p) => p.showOnSchematic);
  if (shown.length === 0) return part.toSpice ? partName(part) : '';
  const pieces: string[] = [];
  for (const def of shown) {
    const raw = (inst.params[def.key] ?? def.default).trim();
    if (!raw) continue;
    if (def.kind === 'select') {
      const option = def.options?.find((o) => o.value === raw);
      pieces.push(option ? optionLabel(option.label) : raw);
    } else if (def.kind === 'bool') {
      if (raw === 'true' || raw === '1') pieces.push(paramLabel(def));
    } else if (def.kind === 'number' && def.unit && !raw.endsWith(def.unit) && /[0-9a-zA-Zµμ]$/.test(raw)) {
      const sep = /[0-9]$/.test(raw) ? ' ' : '';
      pieces.push(`${raw}${sep}${def.unit}`);
    } else pieces.push(raw);
  }
  return pieces.join(' ');
}

export interface PartLabelLayout {
  which: 'ref' | 'value';
  x: number;
  y: number;
  anchor: TextAnchor;
  text: string;
  visible: boolean;
  /** offset from the part origin (what `refOffset` / `valueOffset` would store) */
  offset: Point;
  box: Rect;
}

/**
 * Default label positions: as given by the symbol for rotation 0, above/below the rotated body for
 * 180°, and to the right of the body for 90°/270°. Instance offsets (`refOffset`/`valueOffset`,
 * sheet-aligned, relative to the part origin) override the default position.
 */
export function partLabelLayout(inst: PartInstance, part: PartDef | undefined, hideValues = false): [PartLabelLayout, PartLabelLayout] {
  const box = partBox(inst, part);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let refDefault: Point;
  let valueDefault: Point;
  let anchor: TextAnchor = 'middle';
  if (inst.rotation === 90 || inst.rotation === 270) {
    anchor = 'start';
    refDefault = { x: box.x + box.w + 5, y: cy - 7 };
    valueDefault = { x: box.x + box.w + 5, y: cy + 7 };
  } else if (inst.rotation === 0 && part?.symbol.refPos && part.symbol.valuePos) {
    refDefault = { x: inst.x + part.symbol.refPos.x, y: inst.y + part.symbol.refPos.y };
    valueDefault = { x: inst.x + part.symbol.valuePos.x, y: inst.y + part.symbol.valuePos.y };
  } else {
    refDefault = inst.rotation === 0 && part?.symbol.refPos ? { x: inst.x + part.symbol.refPos.x, y: inst.y + part.symbol.refPos.y } : { x: cx, y: box.y - 7 };
    valueDefault = inst.rotation === 0 && part?.symbol.valuePos ? { x: inst.x + part.symbol.valuePos.x, y: inst.y + part.symbol.valuePos.y } : { x: cx, y: box.y + box.h + 9 };
  }
  // one section of a multi-section package is labelled U1A … U1D (src/model/sections.ts)
  const refText = sectionLabel(inst.refdes, packageOf(part)?.section);
  const valueText = partValueText(inst, part, hideValues);
  const isGlobal = part?.globalNet !== undefined;
  const make = (which: 'ref' | 'value', def: Point, off: Point | undefined, text: string, visible: boolean): PartLabelLayout => {
    const pos = off ? { x: inst.x + off.x, y: inst.y + off.y } : def;
    return {
      which,
      x: pos.x,
      y: pos.y,
      anchor,
      text,
      visible: visible && text.length > 0,
      offset: { x: pos.x - inst.x, y: pos.y - inst.y },
      box: textBox(pos.x, pos.y, text, PART_LABEL_SIZE, anchor),
    };
  };
  return [
    make('ref', refDefault, inst.refOffset, refText, !inst.hideRef && !isGlobal),
    make('value', valueDefault, inst.valueOffset, valueText, !inst.hideValue),
  ];
}

export interface NetLabelLayout {
  tx: number;
  ty: number;
  anchor: TextAnchor;
  box: Rect;
  /** connectors: outline polygon of the flag (sheet coordinates) */
  flag?: Point[];
  /** connectors turned 90° / 270°: stem from the connection point to the flag */
  stem?: [Point, Point];
  /** bus entries: the 45° stub from the bus point */
  entry?: [Point, Point];
}

/** Height of a connector flag. */
export const CONNECTOR_H = 14;

/**
 * Net label text extends right (0°), down (90°), left (180°) or up (270°) from its connection
 * point. Connectors (off-page, hierarchical, global) draw a flag around the name: an arrow tag
 * (off-page), a hexagon (hierarchical port) or a rounded tag (global) — horizontal for 0° / 180°,
 * on a short stem below / above the point for 90° / 270°. A bus entry draws a 45° stub with the
 * line name.
 */
export function netLabelLayout(l: NetLabel): NetLabelLayout {
  const kind = l.kind ?? 'label';
  if (kind === 'offpage' || kind === 'hier' || kind === 'global') return connectorLayout(l, kind);
  if (kind === 'bus-entry') {
    const a = { x: l.x, y: l.y };
    const b = { x: l.x + 8, y: l.y - 8 };
    const tb = textBox(l.x + 11, l.y - 12, l.name, NET_LABEL_SIZE - 1, 'start');
    return { tx: l.x + 11, ty: l.y - 12, anchor: 'start', entry: [a, b], box: rectUnion(rectUnion(null, { x: l.x - 3, y: l.y - 11, w: 14, h: 14 }), { x: tb.x - 2, y: tb.y - 2, w: tb.w + 4, h: tb.h + 4 }) };
  }
  let tx: number;
  let ty: number;
  let anchor: TextAnchor = 'start';
  switch (l.rotation) {
    case 90:
      tx = l.x + 5;
      ty = l.y + 9;
      break;
    case 180:
      tx = l.x - 4;
      ty = l.y - 7;
      anchor = 'end';
      break;
    case 270:
      tx = l.x + 5;
      ty = l.y - 9;
      break;
    default:
      tx = l.x + 4;
      ty = l.y - 7;
  }
  const tb = textBox(tx, ty, l.name, NET_LABEL_SIZE, anchor);
  return { tx, ty, anchor, box: rectUnion(rectUnion(null, { x: l.x - 3, y: l.y - 3, w: 6, h: 6 }), { x: tb.x - 2, y: tb.y - 2, w: tb.w + 4, h: tb.h + 4 }) };
}

function connectorLayout(l: NetLabel, kind: 'offpage' | 'hier' | 'global'): NetLabelLayout {
  const w = textWidth(l.name, NET_LABEL_SIZE) + 20;
  const h2 = CONNECTOR_H / 2;
  const vertical = l.rotation === 90 || l.rotation === 270;
  // flag start point (where it touches the connection point or the stem) and direction
  let ox = l.x;
  let oy = l.y;
  let dir = l.rotation === 180 ? -1 : 1;
  let stem: [Point, Point] | undefined;
  if (vertical) {
    const sy = l.rotation === 90 ? l.y + 8 + h2 : l.y - 8 - h2;
    stem = [{ x: l.x, y: l.y }, { x: l.x, y: l.rotation === 90 ? l.y + 8 : l.y - 8 }];
    ox = l.x - w / 2;
    oy = sy;
    dir = 1;
  }
  const X = (dx: number) => ox + dir * dx;
  let flag: Point[];
  if (kind === 'offpage') flag = [{ x: X(0), y: oy - h2 }, { x: X(w - 7), y: oy - h2 }, { x: X(w), y: oy }, { x: X(w - 7), y: oy + h2 }, { x: X(0), y: oy + h2 }];
  else if (kind === 'hier') flag = [{ x: X(0), y: oy }, { x: X(6), y: oy - h2 }, { x: X(w - 6), y: oy - h2 }, { x: X(w), y: oy }, { x: X(w - 6), y: oy + h2 }, { x: X(6), y: oy + h2 }];
  else flag = [{ x: X(3), y: oy - h2 }, { x: X(w), y: oy - h2 }, { x: X(w), y: oy + h2 }, { x: X(3), y: oy + h2 }];
  const tx = ox + dir * (w / 2);
  let box: Rect | null = null;
  for (const p of flag) box = rectUnion(box, { x: p.x, y: p.y, w: 0, h: 0 });
  box = rectUnion(box!, { x: l.x - 3, y: l.y - 3, w: 6, h: 6 });
  return { tx, ty: oy, anchor: 'middle', box, flag, ...(stem ? { stem } : {}) };
}

export interface ProbeLayout {
  /** flag box (name) */
  flag: Rect;
  /** value read-out anchor (top-left) */
  valueAt: Point;
  box: Rect;
}

export const PROBE_KIND_TAG: Record<Probe['kind'], string> = {
  voltage: 'V',
  current: 'I',
  power: 'P',
  differential: 'ΔV',
  digital: 'D',
  reference: 'REF',
};

/** Probe flag sits up-right of the probe point. */
export function probeLayout(p: Probe): ProbeLayout {
  const text = `${PROBE_KIND_TAG[p.kind]} ${p.name}`;
  const w = textWidth(text, PROBE_LABEL_SIZE) + 10;
  const flag = { x: p.x + 8, y: p.y - 24, w, h: 15 };
  const box = rectUnion(rectUnion(null, flag), { x: p.x - 4, y: p.y - 4, w: 8, h: 8 });
  return { flag, valueAt: { x: flag.x, y: flag.y + flag.h + 2 }, box };
}

export function noteBox(n: TextNote): Rect {
  const size = n.size ?? NOTE_DEFAULT_SIZE;
  const lines = n.text.split('\n');
  const w = Math.max(size, ...lines.map((l) => textWidth(l, size)));
  return { x: n.x, y: n.y, w, h: Math.max(1, lines.length) * size * 1.3 };
}

export function wireBox(w: Wire): Rect {
  let r: Rect | null = null;
  for (const p of w.points) r = rectUnion(r, { x: p.x, y: p.y, w: 0, h: 0 });
  return r ?? { x: 0, y: 0, w: 0, h: 0 };
}

export function labelPointBox(l: NetLabel): Rect {
  return netLabelLayout(l).box;
}

/** Bounding box of a graphic annotation (the full ellipse box for arcs). */
export function shapeBox(s: Shape): Rect {
  let r: Rect | null = null;
  for (const p of s.points) r = rectUnion(r, { x: p.x, y: p.y, w: 0, h: 0 });
  const pad = (s.strokeWidth ?? 1) / 2;
  return r ? { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad } : { x: 0, y: 0, w: 0, h: 0 };
}
