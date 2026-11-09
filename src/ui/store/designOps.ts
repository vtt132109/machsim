/**
 * Pure, immutable design operations used by the editor store.
 *
 * Every function returns a new {@link Design} that shares all untouched sheets, arrays and items
 * with its input (or the input itself when nothing changed). Operations that may change wire
 * topology finish with {@link normalizeSheet} (auto split / merge, see wireOps.ts); the drag
 * preview ({@link moveItems}) deliberately does not, the store normalises once when the drag ends.
 */
import type { PartDef } from '../../library/types';
import { defaultParams } from '../../library';
import type {
  Design,
  NetLabel,
  PartInstance,
  Point,
  Probe,
  ProbeKind,
  Rotation,
  ChildDesign,
  Shape,
  Sheet,
  TextNote,
  Wire,
} from '../../model/types';
import { GRID, newSheet } from '../../model/types';
import { BLOCK_PREFIX, findSheet, updateChild } from '../../model/hierarchy';
import { instancePins, samePoint, snap } from '../../model/geometry';
import { packageKey, packageOf } from '../../model/sections';
import { fragmentNetNames, neededVariables, sanitizeIncoming, type IncomingExtras, type SanitizeNote } from '../../model/sanitize';
import { relinkPastedContacts } from '../../model/relink';
import { netSettings } from '../../model/netSettings';
import { effectivePrefix } from '../../model/refdesRules';
import { isCustomPartId } from '../../library/custom/types';
import type { Clipboard, ItemKind, PartLookup, Rect, SelItem } from './types';
import { newId } from './ids';
import { collectRefdes, levelSheets, nextRefdes, refdesPrefix } from './refdes';
import { rubberBandPoints, simplifyPoints } from './routing';
import { normalizeWires, pointKey, wireEnds } from './wireOps';
import { netLabelLayout, noteBox, partBox, partLabelLayout, probeLayout, rectUnion, shapeBox, wireBox } from './shapes';
import { pinOutVector, untangleWires, type ObstaclePart } from './untangle';
import { t } from '../../i18n';
import { placementDefaults } from './partDefaults';

/** Pin of a placed part in sheet coordinates. */
export interface SheetPin {
  partId: string;
  refdes: string;
  name: string;
  x: number;
  y: number;
  dir?: 'left' | 'right' | 'up' | 'down';
  label?: string;
}

export const PROBE_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#c2255c', '#6741d9', '#0c8599', '#e67700', '#5c940d'];

// ---------------------------------------------------------------------------
// basic access
// ---------------------------------------------------------------------------

/** A sheet by id: a root sheet or a sheet of a child design (subcircuit / hierarchical block). */
export function getSheet(design: Design, sheetId: string): Sheet | undefined {
  return design.sheets.find((s) => s.id === sheetId) ?? findSheet(design, sheetId)?.sheet;
}

/**
 * Replace one sheet (root or child) through `fn`; returns `design` itself when `fn` returns the
 * same sheet.
 */
export function updateSheet(design: Design, sheetId: string, fn: (s: Sheet) => Sheet): Design {
  const idx = design.sheets.findIndex((s) => s.id === sheetId);
  if (idx < 0) {
    const loc = findSheet(design, sheetId);
    if (!loc?.child) return design;
    return updateChild(design, loc.child.id, (c) => {
      const next = fn(c.sheets[loc.index]);
      if (next === c.sheets[loc.index]) return c;
      const sheets = c.sheets.slice();
      sheets[loc.index] = next;
      return { ...c, sheets };
    });
  }
  const next = fn(design.sheets[idx]);
  if (next === design.sheets[idx]) return design;
  const sheets = design.sheets.slice();
  sheets[idx] = next;
  return { ...design, sheets };
}

/** Child id of the design level holding a sheet (undefined for root sheets). */
export function levelOf(design: Design, sheetId: string): string | undefined {
  return findSheet(design, sheetId)?.child?.id;
}

/** Replace the sheet list of the level holding `sheetId`. */
function setLevelSheets(design: Design, sheetId: string, fn: (sheets: Sheet[]) => Sheet[]): Design {
  const childId = levelOf(design, sheetId);
  if (childId === undefined) {
    const sheets = fn(design.sheets);
    return sheets === design.sheets ? design : { ...design, sheets };
  }
  return updateChild(design, childId, (c) => {
    const sheets = fn(c.sheets);
    return sheets === c.sheets ? c : { ...c, sheets };
  });
}

/** Ids of a given kind in a selection. */
export function selIds(sel: readonly SelItem[], kind: ItemKind): Set<string> {
  const s = new Set<string>();
  for (const it of sel) if (it.kind === kind) s.add(it.id);
  return s;
}

/** Every pin on a sheet. */
export function sheetPins(sheet: Sheet, lookup: PartLookup): SheetPin[] {
  const out: SheetPin[] = [];
  for (const inst of sheet.parts) {
    const def = lookup(inst.partId);
    if (!def) continue;
    for (const p of instancePins(inst, def)) {
      out.push({ partId: inst.id, refdes: inst.refdes, name: p.name, x: p.x, y: p.y, dir: p.pin.dir, label: p.pin.label });
    }
  }
  return out;
}

export function pinKeySet(sheet: Sheet, lookup: PartLookup): Set<string> {
  return new Set(sheetPins(sheet, lookup).map((p) => pointKey(p)));
}

/** Canonical wire topology for a sheet (same object when already canonical). */
export function normalizeSheet(sheet: Sheet, lookup: PartLookup): Sheet {
  const wires = normalizeWires(sheet.wires, pinKeySet(sheet, lookup));
  return wires === sheet.wires ? sheet : { ...sheet, wires };
}

export function normalizeDesignSheet(design: Design, sheetId: string, lookup: PartLookup): Design {
  return updateSheet(design, sheetId, (s) => normalizeSheet(s, lookup));
}

function mapIfChanged<T>(list: T[], fn: (item: T) => T): T[] {
  let changed = false;
  const out = list.map((it) => {
    const n = fn(it);
    if (n !== it) changed = true;
    return n;
  });
  return changed ? out : list;
}

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------

/**
 * New part instance with default parameters and the next free refdes (or `refdes` when the caller
 * already knows which one — a section joining a package it belongs to, see {@link placePart}).
 */
export function createPartInstance(
  design: Design,
  part: PartDef,
  pos: Point,
  rotation: Rotation = 0,
  mirror = false,
  used: Set<string> = collectRefdes(design),
  refdes?: string,
): PartInstance {
  return {
    id: newId('p'),
    partId: part.id,
    refdes: refdes ?? nextRefdes(effectivePrefix(part.prefix, design.refdesRules), used),
    x: snap(pos.x),
    y: snap(pos.y),
    rotation,
    mirror,
    params: { ...defaultParams(part), ...placementDefaults(part) },
  };
}

/**
 * Designator a newly placed **section** joins: the lowest-numbered package of the same chip on this
 * design level whose section letter is still free. Placing 7400A then 7400B therefore gives both
 * U1 — one chip in the netlist and the bill of materials — which is what the help page describes
 * and what the learner had to type by hand before. Returns undefined for an ordinary part, or when
 * every placed package already uses that section (then the next free designator starts a new chip).
 */
function joinPackage(design: Design, sheetId: string, part: PartDef, lookup: PartLookup): string | undefined {
  const pkg = packageOf(part);
  if (!pkg) return undefined;
  const taken = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const sheet of levelSheets(design, sheetId)) {
    for (const p of sheet.parts) {
      const other = packageOf(lookup(p.partId));
      if (!other || other.id !== pkg.id) continue;
      const key = p.refdes.trim().toUpperCase();
      if (!taken.has(key)) {
        taken.set(key, new Set());
        order.push(p.refdes);
      }
      taken.get(key)!.add(other.section.toUpperCase());
    }
  }
  const byNumber = [...order].sort((a, b) => (Number(/\d+$/.exec(a)?.[0] ?? 0) || 0) - (Number(/\d+$/.exec(b)?.[0] ?? 0) || 0));
  return byNumber.find((ref) => !taken.get(ref.trim().toUpperCase())!.has(pkg.section.toUpperCase()));
}

export function placePart(
  design: Design,
  sheetId: string,
  partId: string,
  pos: Point,
  rotation: Rotation,
  mirror: boolean,
  lookup: PartLookup,
): { design: Design; id: string | null } {
  const part = lookup(partId);
  if (!part || !getSheet(design, sheetId)) return { design, id: null };
  const inst = createPartInstance(design, part, pos, rotation, mirror, collectRefdes(design, sheetId), joinPackage(design, sheetId, part, lookup));
  const next = updateSheet(design, sheetId, (s) => normalizeSheet({ ...s, parts: [...s.parts, inst] }, lookup));
  return { design: next, id: inst.id };
}

export function addWire(
  design: Design,
  sheetId: string,
  points: Point[],
  lookup: PartLookup,
  color?: string,
): { design: Design; id: string | null } {
  // copy plain coordinates only (callers may pass richer point-like objects)
  const pts = simplifyPoints(points.map((p) => ({ x: p.x, y: p.y })));
  if (pts.length < 2) return { design, id: null };
  const wire: Wire = { id: newId('w'), points: pts, ...(color ? { color } : {}) };
  let resultId: string | null = null;
  const next = updateSheet(design, sheetId, (s) => {
    const n = normalizeSheet({ ...s, wires: [...s.wires, wire] }, lookup);
    resultId = n.wires.some((w) => w.id === wire.id) ? wire.id : null;
    return n;
  });
  return { design: next, id: resultId };
}

export function addNetLabel(design: Design, sheetId: string, pos: Point, name: string, rotation: Rotation = 0): { design: Design; id: string } {
  const label: NetLabel = { id: newId('l'), x: pos.x, y: pos.y, name: name.trim(), rotation };
  return { design: updateSheet(design, sheetId, (s) => ({ ...s, labels: [...s.labels, label] })), id: label.id };
}

export function nextProbeName(design: Design): string {
  const used = new Set<string>();
  for (const s of design.sheets) for (const p of s.probes) used.add(p.name.toLowerCase());
  for (let n = 1; ; n++) if (!used.has(`probe${n}`)) return `Probe${n}`;
}

export function nextProbeColor(design: Design): string {
  let count = 0;
  for (const s of design.sheets) count += s.probes.length;
  return PROBE_COLORS[count % PROBE_COLORS.length];
}

export function addProbe(
  design: Design,
  sheetId: string,
  kind: ProbeKind,
  pos: Point,
  ref?: Point,
  name?: string,
  color?: string,
): { design: Design; id: string } {
  const probe: Probe = {
    id: newId('pr'),
    kind,
    x: pos.x,
    y: pos.y,
    name: name ?? nextProbeName(design),
    color: color ?? nextProbeColor(design),
    ...(ref ? { ref: { x: ref.x, y: ref.y } } : {}),
  };
  return { design: updateSheet(design, sheetId, (s) => ({ ...s, probes: [...s.probes, probe] })), id: probe.id };
}

export function addNote(design: Design, sheetId: string, pos: Point, text: string, size?: number): { design: Design; id: string } {
  const note: TextNote = { id: newId('t'), x: pos.x, y: pos.y, text, ...(size ? { size } : {}) };
  return { design: updateSheet(design, sheetId, (s) => ({ ...s, notes: [...s.notes, note] })), id: note.id };
}

/** Lowest unused automatic net label name ("N1", "N2", ...) across the design. */
export function nextNetLabelName(design: Design): string {
  const used = new Set<string>();
  for (const s of design.sheets) for (const l of s.labels) used.add(l.name.toLowerCase());
  for (let n = 1; ; n++) if (!used.has(`n${n}`)) return `N${n}`;
}

// ---------------------------------------------------------------------------
// editing
// ---------------------------------------------------------------------------

export function deleteItems(design: Design, sheetId: string, sel: readonly SelItem[], lookup: PartLookup): Design {
  if (sel.length === 0) return design;
  const parts = selIds(sel, 'part');
  const wires = selIds(sel, 'wire');
  const labels = selIds(sel, 'label');
  const probes = selIds(sel, 'probe');
  const notes = selIds(sel, 'note');
  const shapes = selIds(sel, 'shape');
  return updateSheet(design, sheetId, (s) => {
    const next: Sheet = {
      ...s,
      parts: parts.size ? s.parts.filter((p) => !parts.has(p.id)) : s.parts,
      wires: wires.size ? s.wires.filter((w) => !wires.has(w.id)) : s.wires,
      labels: labels.size ? s.labels.filter((l) => !labels.has(l.id)) : s.labels,
      probes: probes.size ? s.probes.filter((p) => !probes.has(p.id)) : s.probes,
      notes: notes.size ? s.notes.filter((n) => !notes.has(n.id)) : s.notes,
      ...(s.shapes && shapes.size ? { shapes: s.shapes.filter((x) => !shapes.has(x.id)) } : {}),
    };
    return normalizeSheet(next, lookup);
  });
}

/**
 * Translate the selection by (dx, dy). Unselected wires whose ends touch a moving pin or a moving
 * wire end follow orthogonally (rubber-banding); unselected labels and probes sitting exactly on a
 * moving pin move with it. A rubber-banded wire that would then run across a moved part (over its
 * body or another of its pins) is re-routed around it (untangle.ts). Wire topology is NOT
 * normalised here (see store.endDrag).
 */
export function moveItems(design: Design, sheetId: string, sel: readonly SelItem[], dx: number, dy: number, lookup: PartLookup): Design {
  if ((dx === 0 && dy === 0) || sel.length === 0) return design;
  const parts = selIds(sel, 'part');
  const wires = selIds(sel, 'wire');
  const labels = selIds(sel, 'label');
  const probes = selIds(sel, 'probe');
  const notes = selIds(sel, 'note');
  const shapes = selIds(sel, 'shape');
  const d = { x: dx, y: dy };
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return updateSheet(design, sheetId, (s) => {
    const movingPins = new Set<string>();
    for (const inst of s.parts) {
      if (!parts.has(inst.id)) continue;
      const def = lookup(inst.partId);
      if (def) for (const p of instancePins(inst, def)) movingPins.add(pointKey(p));
    }
    const movingPoints = new Set(movingPins);
    for (const w of s.wires) if (wires.has(w.id)) for (const e of wireEnds(w)) movingPoints.add(pointKey(e));
    const rubberBanded = new Set<string>();
    const next: Sheet = {
      ...s,
      parts: mapIfChanged(s.parts, (p) => (parts.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
      wires: mapIfChanged(s.wires, (w) => {
        if (wires.has(w.id)) return { ...w, points: w.points.map(t) };
        if (w.points.length < 2) return w;
        const [a, b] = wireEnds(w);
        const m0 = movingPoints.has(pointKey(a));
        const m1 = movingPoints.has(pointKey(b));
        if (!m0 && !m1) return w;
        rubberBanded.add(w.id);
        return { ...w, points: rubberBandPoints(w.points, m0 ? d : null, m1 ? d : null) };
      }),
      labels: mapIfChanged(s.labels, (l) => (labels.has(l.id) || movingPins.has(pointKey(l)) ? { ...l, ...t(l) } : l)),
      probes: mapIfChanged(s.probes, (p) => {
        if (!probes.has(p.id) && !movingPins.has(pointKey(p))) return p;
        return { ...p, ...t(p), ...(p.ref && probes.has(p.id) ? { ref: t(p.ref) } : {}) };
      }),
      notes: mapIfChanged(s.notes, (n) => (notes.has(n.id) ? { ...n, ...t(n) } : n)),
      ...(s.shapes ? { shapes: mapIfChanged(s.shapes, (x) => (shapes.has(x.id) ? { ...x, points: x.points.map(t) } : x)) } : {}),
    };
    return untangleSheet(next, parts, rubberBanded, lookup);
  });
}

/** Moved / transformed parts of a sheet as obstacles for {@link untangleWires}. */
function obstacleParts(sheet: Sheet, ids: ReadonlySet<string>, lookup: PartLookup): ObstaclePart[] {
  const out: ObstaclePart[] = [];
  for (const inst of sheet.parts) {
    if (!ids.has(inst.id)) continue;
    const def = lookup(inst.partId);
    if (!def) continue;
    const box = partBox(inst, def);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const pins = instancePins(inst, def).map((p) => ({
      x: p.x,
      y: p.y,
      out: pinOutVector(p.pin.dir, inst.rotation, inst.mirror, { x: p.x - cx, y: p.y - cy }),
    }));
    out.push({ box, pins });
  }
  return out;
}

/**
 * Re-route rubber-banded wires that now run across a moved part (over its body or its other
 * pins); see untangle.ts. Returns `sheet` itself when nothing changed.
 */
function untangleSheet(sheet: Sheet, movedParts: ReadonlySet<string>, rubberBanded: ReadonlySet<string>, lookup: PartLookup): Sheet {
  if (movedParts.size === 0 || rubberBanded.size === 0) return sheet;
  const wires = untangleWires({
    wires: sheet.wires,
    rubberBanded,
    parts: obstacleParts(sheet, movedParts, lookup),
    pins: sheetPins(sheet, lookup),
  });
  return wires === sheet.wires ? sheet : { ...sheet, wires };
}

export type TransformOp = 'cw' | 'ccw' | 'flipH' | 'flipV';

function transformPoint(p: Point, c: Point, op: TransformOp): Point {
  switch (op) {
    case 'cw':
      return { x: c.x - (p.y - c.y), y: c.y + (p.x - c.x) };
    case 'ccw':
      return { x: c.x + (p.y - c.y), y: c.y - (p.x - c.x) };
    case 'flipH':
      return { x: 2 * c.x - p.x, y: p.y };
    case 'flipV':
      return { x: p.x, y: 2 * c.y - p.y };
  }
}

/** New rotation/mirror after applying a screen-space transform to a part (mirror-then-rotate model). */
export function transformOrientation(rotation: Rotation, mirror: boolean, op: TransformOp): { rotation: Rotation; mirror: boolean } {
  switch (op) {
    case 'cw':
      return { rotation: ((rotation + 90) % 360) as Rotation, mirror };
    case 'ccw':
      return { rotation: ((rotation + 270) % 360) as Rotation, mirror };
    case 'flipH':
      return { rotation: ((360 - rotation) % 360) as Rotation, mirror: !mirror };
    case 'flipV':
      return { rotation: ((540 - rotation) % 360) as Rotation, mirror: !mirror };
  }
}

function transformLabelRotation(r: Rotation, op: TransformOp): Rotation {
  switch (op) {
    case 'cw':
      return ((r + 90) % 360) as Rotation;
    case 'ccw':
      return ((r + 270) % 360) as Rotation;
    case 'flipH':
      return r === 0 ? 180 : r === 180 ? 0 : r;
    case 'flipV':
      return r === 90 ? 270 : r === 270 ? 90 : r;
  }
}

/**
 * Rotate or flip the selection. A single part turns about its own origin, anything else about the
 * grid-snapped centre of the selection. Wires attached to transformed pins are rubber-banded, and
 * re-routed out of the pin's stub direction when that would leave them across a transformed part
 * (a 180° turn swaps the pins in place; see untangle.ts).
 */
export function transformItems(design: Design, sheetId: string, sel: readonly SelItem[], op: TransformOp, lookup: PartLookup): Design {
  const sheet = getSheet(design, sheetId);
  if (!sheet || sel.length === 0) return design;
  const parts = selIds(sel, 'part');
  const wires = selIds(sel, 'wire');
  const labels = selIds(sel, 'label');
  const probes = selIds(sel, 'probe');
  const notes = selIds(sel, 'note');
  const shapes = selIds(sel, 'shape');
  let center: Point;
  if (sel.length === 1 && parts.size === 1) {
    const inst = sheet.parts.find((p) => parts.has(p.id));
    if (!inst) return design;
    center = { x: inst.x, y: inst.y };
  } else {
    const b = itemsBounds(sheet, sel, lookup);
    if (!b) return design;
    center = { x: snap(b.x + b.w / 2), y: snap(b.y + b.h / 2) };
  }
  const f = (p: Point) => transformPoint(p, center, op);
  // old point key -> displacement of that point (pins of transformed parts, ends of selected wires)
  const moves = new Map<string, Point>();
  const pinMoves = new Map<string, Point>();
  const nextParts = mapIfChanged(sheet.parts, (inst) => {
    if (!parts.has(inst.id)) return inst;
    const o = transformOrientation(inst.rotation, inst.mirror, op);
    const pos = f(inst);
    const next: PartInstance = { ...inst, x: pos.x, y: pos.y, rotation: o.rotation, mirror: o.mirror };
    if (op === 'cw' || op === 'ccw') {
      delete next.refOffset;
      delete next.valueOffset;
    }
    const def = lookup(inst.partId);
    if (def) {
      const before = instancePins(inst, def);
      const after = instancePins(next, def);
      before.forEach((p, i) => {
        const d = { x: after[i].x - p.x, y: after[i].y - p.y };
        moves.set(pointKey(p), d);
        pinMoves.set(pointKey(p), d);
      });
    }
    return next;
  });
  for (const w of sheet.wires) {
    if (!wires.has(w.id)) continue;
    for (const e of wireEnds(w)) {
      const n = f(e);
      moves.set(pointKey(e), { x: n.x - e.x, y: n.y - e.y });
    }
  }
  const rubberBanded = new Set<string>();
  const next: Sheet = {
    ...sheet,
    parts: nextParts,
    wires: mapIfChanged(sheet.wires, (w) => {
      if (wires.has(w.id)) return { ...w, points: w.points.map(f) };
      if (w.points.length < 2) return w;
      const [a, b] = wireEnds(w);
      const d0 = moves.get(pointKey(a)) ?? null;
      const d1 = moves.get(pointKey(b)) ?? null;
      if (!d0 && !d1) return w;
      rubberBanded.add(w.id);
      return { ...w, points: rubberBandPoints(w.points, d0, d1) };
    }),
    labels: mapIfChanged(sheet.labels, (l) => {
      if (labels.has(l.id)) return { ...l, ...f(l), rotation: transformLabelRotation(l.rotation, op) };
      const d = pinMoves.get(pointKey(l));
      return d ? { ...l, x: l.x + d.x, y: l.y + d.y } : l;
    }),
    probes: mapIfChanged(sheet.probes, (p) => {
      if (probes.has(p.id)) return { ...p, ...f(p), ...(p.ref ? { ref: f(p.ref) } : {}) };
      const d = pinMoves.get(pointKey(p));
      return d ? { ...p, x: p.x + d.x, y: p.y + d.y } : p;
    }),
    notes: mapIfChanged(sheet.notes, (n) => (notes.has(n.id) ? { ...n, ...f(n) } : n)),
    ...(sheet.shapes ? { shapes: mapIfChanged(sheet.shapes, (x) => (shapes.has(x.id) ? transformShape(x, f, op) : x)) } : {}),
  };
  return updateSheet(design, sheetId, () => normalizeSheet(untangleSheet(next, parts, rubberBanded, lookup), lookup));
}

/** A shape after a rotate / flip of its points (arc angles follow the transform). */
function transformShape(s: Shape, f: (p: Point) => Point, op: TransformOp): Shape {
  const next: Shape = { ...s, points: s.points.map(f) };
  if (s.kind === 'arc' && s.start !== undefined && s.end !== undefined) {
    const norm = (a: number) => ((a % 360) + 360) % 360;
    if (op === 'cw') [next.start, next.end] = [norm(s.start + 90), norm(s.end + 90)];
    else if (op === 'ccw') [next.start, next.end] = [norm(s.start - 90), norm(s.end - 90)];
    else if (op === 'flipH') [next.start, next.end] = [norm(180 - s.end), norm(180 - s.start)];
    else [next.start, next.end] = [norm(-s.end), norm(-s.start)];
  }
  return next;
}

/** Shallow-merge a patch into a part instance (no-op when nothing changes). */
export function updatePart(design: Design, sheetId: string, partId: string, patch: Partial<Omit<PartInstance, 'id'>>): Design {
  return updateSheet(design, sheetId, (s) => {
    const parts = mapIfChanged(s.parts, (p) => {
      if (p.id !== partId) return p;
      const keys = Object.keys(patch) as (keyof typeof patch)[];
      if (keys.every((k) => p[k] === patch[k])) return p;
      const next = { ...p, ...patch } as PartInstance;
      for (const k of keys) if (patch[k] === undefined) delete (next as unknown as Record<string, unknown>)[k];
      return next;
    });
    return parts === s.parts ? s : { ...s, parts };
  });
}

/** Set (or reset to default when `value` is null) one parameter of a part. */
export function setPartParam(design: Design, sheetId: string, partId: string, key: string, value: string | null, lookup: PartLookup): Design {
  return updateSheet(design, sheetId, (s) => {
    const parts = mapIfChanged(s.parts, (p) => {
      if (p.id !== partId) return p;
      const def = lookup(p.partId)?.params.find((d) => d.key === key);
      const text = value ?? def?.default ?? '';
      if (p.params[key] === text) return p;
      return { ...p, params: { ...p.params, [key]: text } };
    });
    return parts === s.parts ? s : { ...s, parts };
  });
}

type ItemOf<K extends 'wires' | 'labels' | 'probes' | 'notes' | 'shapes'> = NonNullable<Sheet[K]>[number];

/** Shallow-merge a patch into a wire / label / probe / note / shape. */
export function updateItem<K extends 'wires' | 'labels' | 'probes' | 'notes' | 'shapes'>(
  design: Design,
  sheetId: string,
  list: K,
  id: string,
  patch: Partial<ItemOf<K>>,
): Design {
  return updateSheet(design, sheetId, (s) => {
    const items = (s[list] ?? []) as ItemOf<K>[];
    const next = mapIfChanged(items, (it) => {
      if (it.id !== id) return it;
      const keys = Object.keys(patch) as (keyof ItemOf<K>)[];
      if (keys.every((k) => it[k] === patch[k])) return it;
      const merged = { ...it, ...patch };
      for (const k of keys) if (patch[k] === undefined) delete (merged as Record<string, unknown>)[k as string];
      return merged;
    });
    return next === items ? s : ({ ...s, [list]: next } as Sheet);
  });
}

// ---------------------------------------------------------------------------
// clipboard
// ---------------------------------------------------------------------------

export function copyItems(design: Design, sheetId: string, sel: readonly SelItem[], lookup: PartLookup): Clipboard | null {
  const sheet = getSheet(design, sheetId);
  if (!sheet || sel.length === 0) return null;
  const parts = selIds(sel, 'part');
  const wires = selIds(sel, 'wire');
  const labels = selIds(sel, 'label');
  const probes = selIds(sel, 'probe');
  const notes = selIds(sel, 'note');
  const shapes = selIds(sel, 'shape');
  const b = itemsBounds(sheet, sel, lookup);
  if (!b) return null;
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const copiedParts = clone(sheet.parts.filter((p) => parts.has(p.id)));
  // blocks keep their child designs (and the children those use) so a paste elsewhere works
  const childIds = new Set<string>();
  const addChild = (id: string) => {
    if (childIds.has(id)) return;
    const c = design.children?.find((x) => x.id === id);
    if (!c) return;
    childIds.add(id);
    for (const s of c.sheets) for (const p of s.parts) if (p.partId.startsWith(BLOCK_PREFIX)) addChild(p.partId.slice(BLOCK_PREFIX.length));
  };
  for (const p of copiedParts) if (p.partId.startsWith(BLOCK_PREFIX)) addChild(p.partId.slice(BLOCK_PREFIX.length));
  const copiedChildren = childIds.size ? clone((design.children ?? []).filter((c) => childIds.has(c.id))) : undefined;
  const clip: Clipboard = {
    parts: copiedParts,
    wires: clone(sheet.wires.filter((w) => wires.has(w.id))),
    labels: clone(sheet.labels.filter((l) => labels.has(l.id))),
    probes: clone(sheet.probes.filter((p) => probes.has(p.id))),
    notes: clone(sheet.notes.filter((n) => notes.has(n.id))),
    ...(shapes.size ? { shapes: clone((sheet.shapes ?? []).filter((x) => shapes.has(x.id))) } : {}),
    ...(copiedChildren ? { children: copiedChildren } : {}),
    anchor: { x: snap(b.x), y: snap(b.y) },
  };
  clip.extras = clipboardExtras(design, clip);
  return clip;
}

/**
 * The design-scoped content the copied items refer to (src/model/sanitize.ts): user components,
 * the closure of global parameters their values use, the assembly variants their `notFitted`
 * names, the SPICE model text when a part overrides its model, and the settings of the nets the
 * copied labels name. Carried on the clipboard so a paste into **another** design keeps the
 * meaning of those references instead of silently losing it.
 */
export function clipboardExtras(design: Design, clip: Clipboard): IncomingExtras {
  const all: PartInstance[] = [...clip.parts, ...(clip.children ?? []).flatMap((c) => c.sheets.flatMap((s) => s.parts))];
  const out: IncomingExtras = {};
  const customIds = new Set(all.filter((p) => isCustomPartId(p.partId)).map((p) => p.partId));
  const customParts = (design.customParts ?? []).filter((c) => customIds.has(c.id));
  if (customParts.length) out.customParts = JSON.parse(JSON.stringify(customParts)) as IncomingExtras['customParts'];
  const names = neededVariables(all, design.variables);
  if (names.length) out.variables = Object.fromEntries(names.map((n) => [n, design.variables[n]]));
  const notFitted = new Set<string>();
  for (const p of all) for (const id of p.notFitted ?? []) notFitted.add(id);
  const list = (design.variants?.list ?? []).filter((v) => notFitted.has(v.id));
  if (list.length) out.variants = { list: list.map((v) => ({ ...v })), ...(design.variants?.active !== undefined ? { active: design.variants.active } : {}) };
  if (design.customSpice?.trim() && all.some((p) => p.modelOverride)) out.customSpice = design.customSpice;
  const nets: Record<string, import('../../model/types').NetSettings> = {};
  for (const name of fragmentNetNames(clip)) {
    const s = netSettings(design, name);
    if (s && Object.keys(s).length) nets[name] = { ...s };
  }
  if (Object.keys(nets).length) out.nets = nets;
  return out;
}

/**
 * Insert a clipboard fragment shifted by `offset` (grid-snapped). Parts get fresh ids and are
 * re-annotated with the next free refdes for their prefix (with `opts.keepRefdes` a part keeps
 * its refdes unless that one is already used on the design level: snippets placed into another
 * design); probes get fresh names; net label names are kept (so pasted labels join the same nets).
 * Returns the selection of the pasted items.
 *
 * Two things the copied parts carry need the target design's agreement:
 *  - **sections of one package** (src/model/sections.ts) are one chip only because they share a
 *    designator, so every copied section of one chip receives the SAME new designator (U1A + U1B
 *    paste as U2A + U2B, one 7400 in the bill of materials, not two);
 *  - every other **design-scoped reference** the copied parts carry (assembly variants, global
 *    parameters, user components, model overrides, net settings, reference probes) goes through
 *    the shared integrity layer `sanitizeIncoming` (src/model/sanitize.ts): references are
 *    remapped where the target design has an equivalent and stripped otherwise, and the
 *    definitions the fragment needs are added to the design in this same step. Without that the
 *    paste would be accepted, saved, and the file could never be opened again.
 * `result.notes` says what was remapped or stripped (src/i18n/sanitize.ts turns it into text).
 */
export function pasteItems(
  design: Design,
  sheetId: string,
  clip: Clipboard,
  offset: Point,
  lookup: PartLookup,
  opts: { keepRefdes?: boolean; extras?: IncomingExtras } = {},
): { design: Design; selection: SelItem[]; notes: SanitizeNote[] } {
  if (!getSheet(design, sheetId)) return { design, selection: [], notes: [] };
  // the integrity layer first: it decides what the fragment may still refer to in this design
  const safe = sanitizeIncoming(design, clip, opts.extras ?? clip.extras ?? {});
  clip = { ...clip, ...safe.fragment };
  if (Object.keys(safe.variables).length) design = { ...design, variables: { ...design.variables, ...safe.variables } };
  if (safe.customParts.length) design = { ...design, customParts: [...(design.customParts ?? []), ...safe.customParts] };
  if (safe.customSpice) design = { ...design, customSpice: design.customSpice ? `${design.customSpice.replace(/\s+$/, '')}\n${safe.customSpice}\n` : `${safe.customSpice}\n` };
  if (Object.keys(safe.nets).length) design = { ...design, nets: { ...(design.nets ?? {}), ...safe.nets } };
  // blocks copied from another design bring their child designs along
  let childMap = new Map<string, string>();
  if (clip.children?.length) {
    const merged = mergeChildren(design, clip.children);
    design = merged.design;
    childMap = merged.map;
  }
  const remapPart = (partId: string) => (partId.startsWith(BLOCK_PREFIX) ? BLOCK_PREFIX + (childMap.get(partId.slice(BLOCK_PREFIX.length)) ?? partId.slice(BLOCK_PREFIX.length)) : partId);
  const dx = snap(offset.x);
  const dy = snap(offset.y);
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const used = collectRefdes(design, sheetId);
  // keepRefdes: every designator that is free here is reserved for the part that brought it BEFORE
  // any other part looks for a new one, so a taken name cannot push a later part off its own name
  const keep = new Set<string>();
  if (opts.keepRefdes) for (const p of clip.parts) if (p.refdes && !used.has(p.refdes.toUpperCase())) keep.add(p.refdes.toUpperCase());
  for (const k of keep) used.add(k);
  const kept = new Set<string>();
  // the sections of one package share their designator, so they share the new one too
  const packaged = new Map<string, string>();
  const refdesOf = (p: PartInstance): string => {
    const pkgKey = packageKey(p, lookup(remapPart(p.partId)));
    if (pkgKey !== undefined) {
      const done = packaged.get(pkgKey);
      if (done !== undefined) return done;
    }
    let ref: string;
    if (opts.keepRefdes && p.refdes && keep.has(p.refdes.toUpperCase()) && !kept.has(p.refdes.toUpperCase())) {
      kept.add(p.refdes.toUpperCase());
      ref = p.refdes;
    } else ref = nextRefdes(effectivePrefix(lookup(remapPart(p.partId))?.prefix || refdesPrefix(p.refdes) || 'U', design.refdesRules), used);
    if (pkgKey !== undefined) packaged.set(pkgKey, ref);
    return ref;
  };
  // notFitted was already remapped / stripped by sanitizeIncoming above
  const parts: PartInstance[] = clip.parts.map((p) => {
    const next: PartInstance = {
      ...p,
      partId: remapPart(p.partId),
      id: newId('p'),
      refdes: refdesOf(p),
      params: { ...p.params },
      x: p.x + dx,
      y: p.y + dy,
    };
    return next;
  });
  // contacts pasted together with their coil follow the pasted coil, not the original
  const linked = relinkPastedContacts(parts, clip.parts, lookup);
  parts.splice(0, parts.length, ...linked);
  const wires: Wire[] = clip.wires.map((w) => ({ ...w, id: newId('w'), points: w.points.map(t) }));
  const labels: NetLabel[] = clip.labels.map((l) => ({ ...l, id: newId('l'), ...t(l) }));
  let probeDesign = design;
  const probes: Probe[] = [];
  for (const p of clip.probes) {
    const name = nextProbeName(probeDesign);
    const probe: Probe = { ...p, id: newId('pr'), name, ...t(p), ...(p.ref ? { ref: t(p.ref) } : {}) };
    probes.push(probe);
    probeDesign = updateSheet(probeDesign, sheetId, (s) => ({ ...s, probes: [...s.probes, probe] }));
  }
  const notes: TextNote[] = clip.notes.map((n) => ({ ...n, id: newId('t'), ...t(n) }));
  const shapes: Shape[] = (clip.shapes ?? []).map((x) => ({ ...x, id: newId('sh'), points: x.points.map(t) }));
  let resultSheet: Sheet | null = null;
  const next = updateSheet(design, sheetId, (s) => {
    resultSheet = normalizeSheet(
      {
        ...s,
        parts: [...s.parts, ...parts],
        wires: [...s.wires, ...wires],
        labels: [...s.labels, ...labels],
        probes: [...s.probes, ...probes],
        notes: [...s.notes, ...notes],
        ...(shapes.length || s.shapes ? { shapes: [...(s.shapes ?? []), ...shapes] } : {}),
      },
      lookup,
    );
    return resultSheet;
  });
  const wireIds = new Set((resultSheet as Sheet | null)?.wires.map((w) => w.id) ?? []);
  const selection: SelItem[] = [
    ...parts.map((p) => ({ kind: 'part' as const, id: p.id })),
    ...wires.filter((w) => wireIds.has(w.id)).map((w) => ({ kind: 'wire' as const, id: w.id })),
    ...labels.map((l) => ({ kind: 'label' as const, id: l.id })),
    ...probes.map((p) => ({ kind: 'probe' as const, id: p.id })),
    ...notes.map((n) => ({ kind: 'note' as const, id: n.id })),
    ...shapes.map((x) => ({ kind: 'shape' as const, id: x.id })),
  ];
  return { design: next, selection, notes: safe.notes };
}

/**
 * Paste special > values only: copy the parameter values of the copied parts onto the selected
 * parts of the same kind, leaving everything else (position, wiring, designator) alone. A copied
 * part goes to the selected part with the same designator when there is one, otherwise the
 * selected parts of one kind take the copied parts of that kind in order (one copied resistor
 * value goes to every selected resistor). Only parameters the target part declares are written;
 * values that name global parameters are checked by the integrity layer like any paste.
 */
export function pasteValuesOnly(design: Design, sheetId: string, clip: Clipboard, selection: readonly SelItem[], lookup: PartLookup): { design: Design; changed: number; notes: SanitizeNote[] } {
  const sheet = getSheet(design, sheetId);
  if (!sheet) return { design, changed: 0, notes: [] };
  const chosen = selIds(selection, 'part');
  const targets = sheet.parts.filter((p) => chosen.has(p.id));
  const sources = new Map<string, PartInstance[]>();
  for (const p of clip.parts) sources.set(p.partId, [...(sources.get(p.partId) ?? []), p]);
  const used = new Map<string, number>();
  const pairs: { target: PartInstance; source: PartInstance }[] = [];
  for (const target of targets) {
    const pool = sources.get(target.partId);
    if (!pool?.length) continue;
    const sameName = pool.find((s) => s.refdes && s.refdes.toUpperCase() === target.refdes.toUpperCase());
    const n = used.get(target.partId) ?? 0;
    used.set(target.partId, n + 1);
    pairs.push({ target, source: sameName ?? pool[Math.min(n, pool.length - 1)] });
  }
  if (!pairs.length) return { design, changed: 0, notes: [] };
  // global parameters / references in the copied values follow the usual integrity rules
  const safe = sanitizeIncoming(design, { ...clip, parts: pairs.map((p) => p.source), wires: [], labels: [], probes: [], notes: [], shapes: [], children: [] }, clip.extras ?? {});
  let next = design;
  if (Object.keys(safe.variables).length) next = { ...next, variables: { ...next.variables, ...safe.variables } };
  const cleaned = new Map(safe.fragment.parts.map((p) => [p.id, p]));
  let changed = 0;
  for (const { target, source } of pairs) {
    const def = lookup(target.partId);
    if (!def) continue;
    const from = cleaned.get(source.id) ?? source;
    const params = { ...target.params };
    let touched = false;
    for (const d of def.params) {
      const v = from.params[d.key];
      if (v === undefined || params[d.key] === v) continue;
      params[d.key] = v;
      touched = true;
    }
    if (!touched) continue;
    changed += 1;
    next = updatePart(next, sheetId, target.id, { params });
  }
  return { design: changed ? next : design, changed, notes: safe.notes };
}

const childContent = (c: ChildDesign) => JSON.stringify({ k: c.kind, n: c.name, v: c.variables, s: c.sheets.map((s) => ({ ...s, id: '' })) });

/**
 * Add child designs from a clipboard to `design`: a child whose id is already used by an
 * identical child is reused, otherwise it is added (under a new id when the id is taken by a
 * different child) with fresh sheet and item ids. `notFitted` ids naming variants this design does
 * not have are dropped (see {@link pasteItems}). Returns the old -> new child id map.
 */
export function mergeChildren(design: Design, incoming: ChildDesign[]): { design: Design; map: Map<string, string> } {
  const existing = design.children ?? [];
  const map = new Map<string, string>();
  const added: ChildDesign[] = [];
  const used = new Set(existing.map((c) => c.id));
  for (const c of incoming) {
    const same = existing.find((e) => e.id === c.id);
    if (same && childContent(same) === childContent(c)) {
      map.set(c.id, c.id);
      continue;
    }
    let id = c.id;
    for (let n = 2; used.has(id); n++) id = `${c.id}_${n}`;
    used.add(id);
    map.set(c.id, id);
    added.push({ ...c, id });
  }
  if (!added.length) return { design, map };
  const fix = (partId: string) => (partId.startsWith(BLOCK_PREFIX) ? BLOCK_PREFIX + (map.get(partId.slice(BLOCK_PREFIX.length)) ?? partId.slice(BLOCK_PREFIX.length)) : partId);
  const variantIds = new Set((design.variants?.list ?? []).map((v) => v.id));
  const refit = (p: PartInstance): PartInstance => {
    const q: PartInstance = { ...p, id: newId('p'), partId: fix(p.partId) };
    const keep = (p.notFitted ?? []).filter((id) => variantIds.has(id));
    if (keep.length) q.notFitted = keep;
    else delete q.notFitted;
    return q;
  };
  const fresh = added.map((c) => ({
    ...c,
    sheets: c.sheets.map((s) => ({
      ...s,
      id: newId('sheet'),
      parts: s.parts.map(refit),
      wires: s.wires.map((w) => ({ ...w, id: newId('w') })),
      labels: s.labels.map((l) => ({ ...l, id: newId('l') })),
      probes: s.probes.map((p) => ({ ...p, id: newId('pr') })),
      notes: s.notes.map((n) => ({ ...n, id: newId('t') })),
      ...(s.shapes ? { shapes: s.shapes.map((x) => ({ ...x, id: newId('sh') })) } : {}),
    })),
  }));
  return { design: { ...design, children: [...existing, ...fresh] }, map };
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

/** Bounding box of the given items (or of everything on the sheet when `sel` is null). */
export function itemsBounds(sheet: Sheet, sel: readonly SelItem[] | null, lookup: PartLookup): Rect | null {
  const has = (kind: ItemKind) => {
    if (!sel) return () => true;
    const ids = selIds(sel, kind);
    return (id: string) => ids.has(id);
  };
  const hp = has('part');
  const hw = has('wire');
  const hl = has('label');
  const hpr = has('probe');
  const hn = has('note');
  const hs = has('shape');
  let r: Rect | null = null;
  for (const p of sheet.parts) {
    if (!hp(p.id)) continue;
    const def = lookup(p.partId);
    r = rectUnion(r, partBox(p, def));
    if (!sel) for (const l of partLabelLayout(p, def)) if (l.visible) r = rectUnion(r, l.box);
  }
  for (const w of sheet.wires) if (hw(w.id)) r = rectUnion(r, wireBox(w));
  for (const l of sheet.labels) if (hl(l.id)) r = rectUnion(r, netLabelLayout(l).box);
  for (const p of sheet.probes) if (hpr(p.id)) r = rectUnion(r, probeLayout(p).box);
  for (const n of sheet.notes) if (hn(n.id)) r = rectUnion(r, noteBox(n));
  for (const x of sheet.shapes ?? []) if (hs(x.id)) r = rectUnion(r, shapeBox(x));
  return r;
}

/** Locate a part by refdes (case-insensitive) anywhere in the design. */
export function findPartByRefdes(design: Design, refdes: string): { sheetId: string; part: PartInstance } | null {
  const key = refdes.trim().toUpperCase();
  for (const s of design.sheets) {
    const part = s.parts.find((p) => p.refdes.toUpperCase() === key);
    if (part) return { sheetId: s.id, part };
  }
  return null;
}

/** Parts whose refdes contains `query` (case-insensitive), exact matches first. */
export function searchPartsByRefdes(design: Design, query: string): { sheetId: string; part: PartInstance }[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const out: { sheetId: string; part: PartInstance }[] = [];
  for (const s of design.sheets) for (const p of s.parts) if (p.refdes.toUpperCase().includes(q)) out.push({ sheetId: s.id, part: p });
  return out.sort((a, b) => Number(b.part.refdes.toUpperCase() === q) - Number(a.part.refdes.toUpperCase() === q) || a.part.refdes.localeCompare(b.part.refdes, undefined, { numeric: true }));
}

/** Find the sheet (root or child) and object for an id of a given kind. */
export function findItem(design: Design, kind: ItemKind, id: string): { sheetId: string; item: PartInstance | Wire | NetLabel | Probe | TextNote | Shape } | null {
  const listKey = ({ part: 'parts', wire: 'wires', label: 'labels', probe: 'probes', note: 'notes', shape: 'shapes' } as const)[kind];
  const search = (sheets: Sheet[]) => {
    for (const s of sheets) {
      const item = ((s[listKey] ?? []) as { id: string }[]).find((it) => it.id === id);
      if (item) return { sheetId: s.id, item: item as PartInstance | Wire | NetLabel | Probe | TextNote | Shape };
    }
    return null;
  };
  const r = search(design.sheets);
  if (r) return r;
  for (const c of design.children ?? []) {
    const cr = search(c.sheets);
    if (cr) return cr;
  }
  return null;
}

// ---------------------------------------------------------------------------
// sheets & annotation
// ---------------------------------------------------------------------------

/**
 * Append a sheet to the root design, or — with `nextTo` naming a child's sheet — to that child
 * design (multi-page subcircuits / hierarchical blocks).
 */
export function addSheet(design: Design, name?: string, nextTo?: string): { design: Design; id: string } {
  const level = levelSheets(design, nextTo);
  const used = new Set(level.map((s) => s.name.toLowerCase()));
  let n = level.length + 1;
  while (used.has(`sheet ${n}`) || used.has(t('sheet.default', { n }).toLowerCase())) n++;
  const sheet = newSheet(newId('sheet'), name?.trim() || t('sheet.default', { n }));
  if (nextTo === undefined || levelOf(design, nextTo) === undefined) return { design: { ...design, sheets: [...design.sheets, sheet] }, id: sheet.id };
  return { design: setLevelSheets(design, nextTo, (sheets) => [...sheets, sheet]), id: sheet.id };
}

export function renameSheet(design: Design, sheetId: string, name: string): Design {
  const t = name.trim();
  if (!t) return design;
  return updateSheet(design, sheetId, (s) => (s.name === t ? s : { ...s, name: t }));
}

/** Remove a sheet (the last remaining sheet of a design level cannot be removed). */
export function deleteSheet(design: Design, sheetId: string): Design {
  if (!getSheet(design, sheetId) || levelSheets(design, sheetId).length <= 1) return design;
  return setLevelSheets(design, sheetId, (sheets) => sheets.filter((s) => s.id !== sheetId));
}

/** Move a sheet tab to a new index within its design level. */
export function moveSheet(design: Design, sheetId: string, toIndex: number): Design {
  const level = levelSheets(design, sheetId);
  const from = level.findIndex((s) => s.id === sheetId);
  if (from < 0) return design;
  const to = Math.max(0, Math.min(level.length - 1, toIndex));
  if (from === to) return design;
  return setLevelSheets(design, sheetId, (list) => {
    const sheets = list.slice();
    const [s] = sheets.splice(from, 1);
    sheets.splice(to, 0, s);
    return sheets;
  });
}

/**
 * Renumber every part per prefix in reading order (sheet order, then top-to-bottom, left-to-right
 * in rows of 4 grid units). The sections of one multi-section package count as one part and keep
 * sharing one designator (see {@link pasteItems}).
 */
export function renumberParts(design: Design, lookup: PartLookup): Design {
  const all: { sheet: number; inst: PartInstance; prefix: string }[] = [];
  design.sheets.forEach((s, si) => {
    for (const inst of s.parts) all.push({ sheet: si, inst, prefix: effectivePrefix(lookup(inst.partId)?.prefix || refdesPrefix(inst.refdes) || 'U', design.refdesRules) });
  });
  const row = GRID * 4;
  all.sort((a, b) => a.sheet - b.sheet || Math.floor(a.inst.y / row) - Math.floor(b.inst.y / row) || a.inst.x - b.inst.x);
  const counters = new Map<string, number>();
  const newRef = new Map<string, string>();
  const packaged = new Map<string, string>();
  for (const e of all) {
    const pkgKey = packageKey(e.inst, lookup(e.inst.partId));
    const done = pkgKey !== undefined ? packaged.get(pkgKey) : undefined;
    if (done !== undefined) {
      newRef.set(e.inst.id, done);
      continue;
    }
    const n = (counters.get(e.prefix.toUpperCase()) ?? 0) + 1;
    counters.set(e.prefix.toUpperCase(), n);
    const ref = `${e.prefix}${n}`;
    if (pkgKey !== undefined) packaged.set(pkgKey, ref);
    newRef.set(e.inst.id, ref);
  }
  let changed = false;
  const sheets = design.sheets.map((s) => {
    const parts = mapIfChanged(s.parts, (p) => {
      const r = newRef.get(p.id);
      return r && r !== p.refdes ? { ...p, refdes: r } : p;
    });
    if (parts === s.parts) return s;
    changed = true;
    return { ...s, parts };
  });
  return changed ? { ...design, sheets } : design;
}

/** True when a point sits on a pin of the sheet. */
export function pinAt(sheet: Sheet, p: Point, lookup: PartLookup): SheetPin | null {
  return sheetPins(sheet, lookup).find((pin) => samePoint(pin, p)) ?? null;
}
