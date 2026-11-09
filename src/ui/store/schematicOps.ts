/**
 * Pure schematic editing operations added with format version 2: connectors and bus entries,
 * buses (draw, rename / merge, bus vector connect), graphic annotations and comments, lock,
 * group, align / distribute and replace component. Like designOps.ts every function returns a
 * new Design sharing untouched data with its input (or the input itself when nothing changes).
 */
import { partLocked } from '../../model/restrictions';
import type { Design, LabelKind, NetLabel, PartInstance, Point, Rotation, Shape, Sheet, TextNote, Wire } from '../../model/types';
import { instancePins, samePoint, snap } from '../../model/geometry';
import { defaultParams } from '../../library';
import type { ItemKind, PartLookup, Rect, SelItem } from './types';
import { getSheet, itemsBounds, moveItems, normalizeSheet, selIds, updateSheet } from './designOps';
import { newId } from './ids';
import { collectRefdes, nextRefdes } from './refdes';
import { rubberBandPoints, simplifyPoints } from './routing';
import { onWire, pointKey, wireEnds } from './wireOps';

// ---------------------------------------------------------------------------
// items common to every kind
// ---------------------------------------------------------------------------

/** Editable item of any kind on a sheet. */
type AnyItem = { id: string; locked?: boolean; group?: string };

const KINDS: ItemKind[] = ['part', 'wire', 'label', 'probe', 'note', 'shape'];

/** Sheet list holding items of a kind. */
function listKey(kind: ItemKind): keyof Sheet {
  switch (kind) {
    case 'part':
      return 'parts';
    case 'wire':
      return 'wires';
    case 'label':
      return 'labels';
    case 'probe':
      return 'probes';
    case 'note':
      return 'notes';
    case 'shape':
      return 'shapes';
  }
}

function itemsOf(sheet: Sheet, kind: ItemKind): AnyItem[] {
  return ((sheet[listKey(kind)] as AnyItem[] | undefined) ?? []) as AnyItem[];
}

/** Every item of a sheet as a selection. */
export function allItems(sheet: Sheet): SelItem[] {
  const out: SelItem[] = [];
  for (const kind of KINDS) for (const it of itemsOf(sheet, kind)) out.push({ kind, id: it.id });
  return out;
}

function findOnSheet(sheet: Sheet, it: SelItem): AnyItem | undefined {
  return itemsOf(sheet, it.kind).find((x) => x.id === it.id);
}

/** The selection grown to whole groups: selecting one member of a group selects all members. */
export function expandGroups(sheet: Sheet, sel: readonly SelItem[]): SelItem[] {
  const groups = new Set<string>();
  for (const it of sel) {
    const g = findOnSheet(sheet, it)?.group;
    if (g) groups.add(g);
  }
  if (!groups.size) return sel as SelItem[];
  const out = sel.slice();
  const has = (k: ItemKind, id: string) => out.some((x) => x.kind === k && x.id === id);
  for (const kind of KINDS) for (const it of itemsOf(sheet, kind)) if (it.group && groups.has(it.group) && !has(kind, it.id)) out.push({ kind, id: it.id });
  return out;
}

/** The selection without locked items (locked items cannot be moved, rotated or deleted). */
export function unlockedSelection(design: Design, sheetId: string, sel: readonly SelItem[]): SelItem[] {
  const sheet = getSheet(design, sheetId);
  if (!sheet) return [];
  const out = sel.filter((it) => !findOnSheet(sheet, it)?.locked && !(it.kind === 'part' && partLocked(design, it.id)));
  return out.length === sel.length ? (sel as SelItem[]) : out;
}

/** True when some selected item is locked (by the editor's lock or by the instructor). */
export function selectionHasLocked(design: Design, sheetId: string, sel: readonly SelItem[]): boolean {
  const sheet = getSheet(design, sheetId);
  return !!sheet && sel.some((it) => !!findOnSheet(sheet, it)?.locked || (it.kind === 'part' && partLocked(design, it.id)));
}

/** Apply `fn` to every selected item of the sheet. */
function mapSelected(design: Design, sheetId: string, sel: readonly SelItem[], fn: (it: AnyItem) => AnyItem): Design {
  return updateSheet(design, sheetId, (s) => {
    let changed = false;
    const next: Sheet = { ...s };
    for (const kind of KINDS) {
      const ids = selIds(sel, kind);
      if (!ids.size) continue;
      const list = itemsOf(s, kind);
      let listChanged = false;
      const mapped = list.map((it) => {
        if (!ids.has(it.id)) return it;
        const n = fn(it);
        if (n !== it) listChanged = true;
        return n;
      });
      if (listChanged) {
        changed = true;
        (next as unknown as Record<string, unknown>)[listKey(kind)] = mapped;
      }
    }
    return changed ? next : s;
  });
}

/** Lock or unlock the selected items. */
export function setLocked(design: Design, sheetId: string, sel: readonly SelItem[], locked: boolean): Design {
  return mapSelected(design, sheetId, sel, (it) => {
    if (!!it.locked === locked) return it;
    const n = { ...it };
    if (locked) n.locked = true;
    else delete n.locked;
    return n;
  });
}

/** Put the selected items into one new group (returns the group id, null for < 2 items). */
export function groupItems(design: Design, sheetId: string, sel: readonly SelItem[]): { design: Design; group: string | null } {
  if (sel.length < 2) return { design, group: null };
  const group = newId('g');
  return { design: mapSelected(design, sheetId, sel, (it) => ({ ...it, group })), group };
}

/** Remove the selected items from their groups. */
export function ungroupItems(design: Design, sheetId: string, sel: readonly SelItem[]): Design {
  return mapSelected(design, sheetId, sel, (it) => {
    if (!it.group) return it;
    const n = { ...it };
    delete n.group;
    return n;
  });
}

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------

/** Place a net label, connector or bus entry (see LabelKind). */
export function addLabelItem(
  design: Design,
  sheetId: string,
  pos: Point,
  name: string,
  rotation: Rotation = 0,
  kind: LabelKind = 'label',
  global = false,
): { design: Design; id: string } {
  const label: NetLabel = { id: newId('l'), x: pos.x, y: pos.y, name: name.trim(), rotation };
  if (kind !== 'label') label.kind = kind;
  if (kind === 'label' && global) label.global = true;
  return { design: updateSheet(design, sheetId, (s) => ({ ...s, labels: [...s.labels, label] })), id: label.id };
}

/** Draw a bus wire (normalised with the other bus wires; never merged with ordinary wires). */
export function addBus(design: Design, sheetId: string, points: Point[], lookup: PartLookup, name?: string): { design: Design; id: string | null } {
  const pts = simplifyPoints(points.map((p) => ({ x: p.x, y: p.y })));
  if (pts.length < 2) return { design, id: null };
  const sheet = getSheet(design, sheetId);
  // a bus drawn from an existing bus takes its name
  const joined = sheet ? busNameAt(sheet, pts[0]) ?? busNameAt(sheet, pts[pts.length - 1]) : undefined;
  const busName = name?.trim() || joined;
  const wire: Wire = { id: newId('w'), points: pts, bus: true, ...(busName ? { busName } : {}) };
  let resultId: string | null = null;
  const next = updateSheet(design, sheetId, (s) => {
    const n = normalizeSheet({ ...s, wires: [...s.wires, wire] }, lookup);
    resultId = n.wires.some((w) => w.id === wire.id) ? wire.id : (n.wires.find((w) => w.bus && w.points.some((p) => samePoint(p, pts[0])))?.id ?? null);
    return n;
  });
  return { design: next, id: resultId };
}

/** Name of the bus passing through `p` (undefined when none / unnamed). */
export function busNameAt(sheet: Sheet, p: Point): string | undefined {
  for (const w of sheet.wires) if (w.bus && onWire(w, p)) return busOfWire(sheet, w.id).name;
  return undefined;
}

/** True when `p` lies on a bus wire of the sheet. */
export function onBus(sheet: Sheet, p: Point): boolean {
  return sheet.wires.some((w) => w.bus && onWire(w, p));
}

/** Connected bus wires of the bus containing `wireId` and its first name. */
export function busOfWire(sheet: Sheet, wireId: string): { wireIds: string[]; name?: string } {
  const buses = sheet.wires.filter((w) => w.bus);
  const start = buses.find((w) => w.id === wireId);
  if (!start) return { wireIds: [] };
  const seen = new Set<string>([start.id]);
  const queue = [start];
  while (queue.length) {
    const w = queue.pop()!;
    for (const o of buses) {
      if (seen.has(o.id)) continue;
      const touches = wireEnds(o).some((e) => onWire(w, e)) || wireEnds(w).some((e) => onWire(o, e));
      if (touches) {
        seen.add(o.id);
        queue.push(o);
      }
    }
  }
  const ids = buses.filter((w) => seen.has(w.id)).map((w) => w.id);
  const name = buses.find((w) => seen.has(w.id) && w.busName?.trim())?.busName?.trim();
  return { wireIds: ids, ...(name ? { name } : {}) };
}

/** Rename (or merge under one name) every segment of the bus containing `wireId`. */
export function renameBus(design: Design, sheetId: string, wireId: string, name: string): Design {
  const sheet = getSheet(design, sheetId);
  if (!sheet) return design;
  const { wireIds } = busOfWire(sheet, wireId);
  if (!wireIds.length) return design;
  const ids = new Set(wireIds);
  const n = name.trim();
  return updateSheet(design, sheetId, (s) => {
    let changed = false;
    const wires = s.wires.map((w) => {
      if (!ids.has(w.id) || (w.busName ?? '') === n) return w;
      changed = true;
      const next = { ...w };
      if (n) next.busName = n;
      else delete next.busName;
      return next;
    });
    return changed ? { ...s, wires } : s;
  });
}

/**
 * Bus vector connect: connect pins of a part to bus lines in order by placing a local net label
 * named after each line on each pin (bus lines are sheet-local names, so the label joins the
 * line). `pins` and `lines` are matched by position; extra entries on either side are ignored.
 */
export function connectPinsToBus(design: Design, sheetId: string, partId: string, pins: string[], lines: string[], lookup: PartLookup): { design: Design; ids: string[] } {
  const sheet = getSheet(design, sheetId);
  const inst = sheet?.parts.find((p) => p.id === partId);
  const def = inst ? lookup(inst.partId) : undefined;
  if (!sheet || !inst || !def) return { design, ids: [] };
  const placed = instancePins(inst, def);
  const labels: NetLabel[] = [];
  const n = Math.min(pins.length, lines.length);
  for (let i = 0; i < n; i++) {
    const p = placed.find((x) => x.name === pins[i]);
    if (!p || !lines[i].trim()) continue;
    const rotation: Rotation = p.pin.dir === 'left' ? 180 : p.pin.dir === 'up' ? 270 : p.pin.dir === 'down' ? 90 : 0;
    labels.push({ id: newId('l'), x: p.x, y: p.y, name: lines[i].trim(), rotation });
  }
  if (!labels.length) return { design, ids: [] };
  return { design: updateSheet(design, sheetId, (s) => ({ ...s, labels: [...s.labels, ...labels] })), ids: labels.map((l) => l.id) };
}

/** Add a graphic annotation. */
export function addShape(design: Design, sheetId: string, shape: Omit<Shape, 'id'>): { design: Design; id: string } {
  const s: Shape = { ...shape, id: newId('sh'), points: shape.points.map((p) => ({ x: p.x, y: p.y })) };
  return { design: updateSheet(design, sheetId, (sh) => ({ ...sh, shapes: [...(sh.shapes ?? []), s] })), id: s.id };
}

/** Add a sticky comment (a note flagged `comment`, with author and creation time). */
export function addComment(design: Design, sheetId: string, pos: Point, text: string, author: string, now: Date = new Date()): { design: Design; id: string } {
  const note: TextNote = { id: newId('t'), x: pos.x, y: pos.y, text, comment: true, created: now.toISOString(), ...(author.trim() ? { author: author.trim() } : {}) };
  return { design: updateSheet(design, sheetId, (s) => ({ ...s, notes: [...s.notes, note] })), id: note.id };
}

// ---------------------------------------------------------------------------
// align / distribute
// ---------------------------------------------------------------------------

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

function boxOf(sheet: Sheet, it: SelItem, lookup: PartLookup): Rect | null {
  return itemsBounds(sheet, [it], lookup);
}

/**
 * Align the selected items (each moved as a whole, wires attached to moved pins follow) to the
 * left / right / top / bottom edge or the centre line of the selection's bounding box. Offsets are
 * snapped to the grid. Wires inside the selection are moved only as part of alignment of the
 * parts they connect (they are not aligned on their own).
 */
export function alignItems(design: Design, sheetId: string, sel: readonly SelItem[], mode: AlignMode, lookup: PartLookup): Design {
  const sheet = getSheet(design, sheetId);
  const items = sel.filter((it) => it.kind !== 'wire');
  if (!sheet || items.length < 2) return design;
  const boxes = items.map((it) => ({ it, box: boxOf(sheet, it, lookup) })).filter((e): e is { it: SelItem; box: Rect } => e.box !== null);
  if (boxes.length < 2) return design;
  const all = itemsBounds(sheet, items, lookup)!;
  let next = design;
  for (const { it, box } of boxes) {
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = all.x - box.x;
        break;
      case 'right':
        dx = all.x + all.w - (box.x + box.w);
        break;
      case 'top':
        dy = all.y - box.y;
        break;
      case 'bottom':
        dy = all.y + all.h - (box.y + box.h);
        break;
      case 'hcenter':
        dx = all.x + all.w / 2 - (box.x + box.w / 2);
        break;
      case 'vcenter':
        dy = all.y + all.h / 2 - (box.y + box.h / 2);
        break;
    }
    dx = snap(dx);
    dy = snap(dy);
    if (dx || dy) next = moveItems(next, sheetId, [it], dx, dy, lookup);
  }
  return next === design ? design : updateSheet(next, sheetId, (s) => normalizeSheet(s, lookup));
}

/**
 * Distribute the selected items (at least 3) evenly between the outermost two, by the centres of
 * their boxes along x ('h') or y ('v'); positions are snapped to the grid.
 */
export function distributeItems(design: Design, sheetId: string, sel: readonly SelItem[], axis: 'h' | 'v', lookup: PartLookup): Design {
  const sheet = getSheet(design, sheetId);
  const items = sel.filter((it) => it.kind !== 'wire');
  if (!sheet || items.length < 3) return design;
  const boxes = items.map((it) => ({ it, box: boxOf(sheet, it, lookup) })).filter((e): e is { it: SelItem; box: Rect } => e.box !== null);
  if (boxes.length < 3) return design;
  const centre = (b: Rect) => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2);
  boxes.sort((a, b) => centre(a.box) - centre(b.box));
  const first = centre(boxes[0].box);
  const last = centre(boxes[boxes.length - 1].box);
  const step = (last - first) / (boxes.length - 1);
  let next = design;
  boxes.forEach(({ it, box }, i) => {
    if (i === 0 || i === boxes.length - 1) return;
    const d = snap(first + i * step - centre(box));
    if (d) next = moveItems(next, sheetId, [it], axis === 'h' ? d : 0, axis === 'v' ? d : 0, lookup);
  });
  return next === design ? design : updateSheet(next, sheetId, (s) => normalizeSheet(s, lookup));
}

// ---------------------------------------------------------------------------
// replace component
// ---------------------------------------------------------------------------

/**
 * Replace a part by another library part at the same place, keeping its wires: pins are matched
 * by name, then by position in the pin list; a wire end on an old pin moves to the matching new
 * pin (rubber-banded). Parameters that the new part also has keep their values; the refdes is
 * kept when the prefix is the same, otherwise the next free designator of the new prefix is used.
 * Returns the unchanged design when either part is unknown.
 */
export function replacePart(design: Design, sheetId: string, instId: string, newPartId: string, lookup: PartLookup): Design {
  const sheet = getSheet(design, sheetId);
  const inst = sheet?.parts.find((p) => p.id === instId);
  const oldDef = inst ? lookup(inst.partId) : undefined;
  const newDef = lookup(newPartId);
  if (!sheet || !inst || !oldDef || !newDef || inst.partId === newPartId) return design;
  const oldPins = instancePins(inst, oldDef);
  const params: Record<string, string> = defaultParams(newDef);
  for (const p of newDef.params) if (inst.params[p.key] !== undefined) params[p.key] = inst.params[p.key];
  const samePrefix = oldDef.prefix.toUpperCase() === newDef.prefix.toUpperCase();
  let refdes = inst.refdes;
  if (!samePrefix) {
    const used = collectRefdes(design, sheetId);
    used.delete(inst.refdes.toUpperCase());
    refdes = nextRefdes(newDef.prefix, used);
  }
  const next: PartInstance = { ...inst, partId: newPartId, params, refdes };
  delete next.refOffset;
  delete next.valueOffset;
  const newPins = instancePins(next, newDef);
  const moves = new Map<string, Point>();
  oldPins.forEach((op, i) => {
    const np = newPins.find((p) => p.name === op.name) ?? newPins[i];
    if (np && !samePoint(np, op)) moves.set(pointKey(op), { x: np.x - op.x, y: np.y - op.y });
  });
  return updateSheet(design, sheetId, (s) => {
    const wires = s.wires.map((w) => {
      if (w.bus || w.points.length < 2) return w;
      const [a, b] = wireEnds(w);
      const d0 = moves.get(pointKey(a)) ?? null;
      const d1 = moves.get(pointKey(b)) ?? null;
      if (!d0 && !d1) return w;
      return { ...w, points: rubberBandPoints(w.points, d0, d1) };
    });
    const labels = s.labels.map((l) => {
      const d = moves.get(pointKey(l));
      return d ? { ...l, x: l.x + d.x, y: l.y + d.y } : l;
    });
    return normalizeSheet({ ...s, parts: s.parts.map((p) => (p.id === instId ? next : p)), wires, labels }, lookup);
  });
}
