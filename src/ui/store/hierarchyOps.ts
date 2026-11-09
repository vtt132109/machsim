/**
 * Pure hierarchy editing operations: create subcircuits / hierarchical blocks, place blocks,
 * replace a selection by a subcircuit, turn a design file into a hierarchical block and back,
 * rename / delete child designs. See src/model/hierarchy.ts for the data model.
 */
import type { ChildDesign, Design, NetLabel, PartInstance, Point, Rotation, Sheet } from '../../model/types';
import { newDesign, newSheet } from '../../model/types';
import { instancePins, samePoint, snap } from '../../model/geometry';
import { computeConnectivity, type PlacedPartInfo } from '../../model/connectivity';
import { BLOCK_PREFIX, blockInstances, blockPartDef, blockPartId, childIdOfPart, designPartLookup, getChild, newChildId, uniqueChildName, updateChild } from '../../model/hierarchy';
import type { PartLookup, SelItem } from './types';
import { getSheet, itemsBounds, mergeChildren, normalizeSheet, selIds, updateSheet } from './designOps';
import { sanitizeIncomingSheets, type SanitizeNote } from '../../model/sanitize';
import { newId } from './ids';
import { mergeLadderBlocks } from '../../ladder/editBlocks';
import { collectRefdes, nextRefdes } from './refdes';
import { effectivePrefix } from '../../model/refdesRules';
import { onWire, onWireInterior, wireEnds } from './wireOps';

/** A port to create in a new child design. */
export interface NewPort {
  name: string;
  side: 'left' | 'right';
}

export interface NewChildOptions {
  kind: ChildDesign['kind'];
  name: string;
  /** hierarchical connectors placed on the new child's first sheet (default IN / OUT) */
  ports?: NewPort[];
  variables?: Record<string, string>;
  description?: string;
  /** name of the child's first sheet */
  sheetName?: string;
}

/**
 * Add an empty child design with one sheet and its ports as hierarchical connectors (left ports
 * at x = 100, right ports at x = 900, 60 units apart), so the block has pins right away.
 */
export function createChild(design: Design, opts: NewChildOptions): { design: Design; childId: string; sheetId: string } {
  const childId = newChildId(design, opts.kind === 'hierarchical' ? 'hb' : 'sc');
  const sheet = newSheet(newId('sheet'), opts.sheetName ?? 'Sheet 1');
  const ports = opts.ports ?? [
    { name: 'IN', side: 'left' },
    { name: 'OUT', side: 'right' },
  ];
  let li = 0;
  let ri = 0;
  for (const p of ports) {
    const name = p.name.trim();
    if (!name) continue;
    const y = 100 + 60 * (p.side === 'left' ? li++ : ri++);
    sheet.labels.push({ id: newId('l'), x: p.side === 'left' ? 100 : 900, y, name, rotation: p.side === 'left' ? 0 : 180, kind: 'hier' });
  }
  const child: ChildDesign = {
    id: childId,
    kind: opts.kind,
    name: uniqueChildName(design, opts.name),
    sheets: [sheet],
    variables: { ...(opts.variables ?? {}) },
    ...(opts.description ? { description: opts.description } : {}),
  };
  return { design: { ...design, children: [...(design.children ?? []), child] }, childId, sheetId: sheet.id };
}

/** Place a block of child `childId` on a sheet (next free HB / SC designator of that level). */
export function placeBlock(design: Design, sheetId: string, childId: string, pos: Point, base: PartLookup, rotation: Rotation = 0, mirror = false): { design: Design; id: string | null } {
  const child = getChild(design, childId);
  if (!child || !getSheet(design, sheetId)) return { design, id: null };
  const def = blockPartDef(child);
  const params: Record<string, string> = {};
  const inst: PartInstance = {
    id: newId('p'),
    partId: def.id,
    refdes: nextRefdes(effectivePrefix(def.prefix, design.refdesRules), collectRefdes(design, sheetId)),
    x: snap(pos.x),
    y: snap(pos.y),
    rotation,
    mirror,
    params,
  };
  const lookup = designPartLookup(design, base);
  return { design: updateSheet(design, sheetId, (s) => normalizeSheet({ ...s, parts: [...s.parts, inst] }, lookup)), id: inst.id };
}

export interface ReplaceResult {
  design: Design;
  childId: string;
  blockId: string;
  /** port names created, in order */
  ports: string[];
}

/**
 * Replace the selected items by a subcircuit (or hierarchical block): the items move unchanged
 * into a new child design; every net that ran between the selection and the rest of the sheet
 * becomes a port. Inside, a hierarchical connector marks the port where the net crossed the
 * selection's edge; outside, local net labels with the port name sit on the block pin and on
 * every place where the remaining wiring touched the moved items, so all connections are kept.
 * A port takes the name of a label already on its net, otherwise IO1, IO2, ...; ground and
 * global nets (power rails) need no port. Labels and probes standing on moved pins / wires move
 * too. Returns null when nothing (no part) is selected.
 */
export function replaceWithSubcircuit(design: Design, sheetId: string, selection: readonly SelItem[], opts: { kind: ChildDesign['kind']; name: string; sheetName?: string }, base: PartLookup): ReplaceResult | null {
  const sheet = getSheet(design, sheetId);
  if (!sheet) return null;
  const lookup = designPartLookup(design, base);
  const partIds = selIds(selection, 'part');
  if (!sheet.parts.some((p) => partIds.has(p.id))) return null;
  const wireIds = selIds(selection, 'wire');
  const selParts = sheet.parts.filter((p) => partIds.has(p.id));
  const selWires = sheet.wires.filter((w) => wireIds.has(w.id) && !w.bus);
  const selPins: Point[] = [];
  for (const p of selParts) {
    const def = lookup(p.partId);
    if (def) for (const pin of instancePins(p, def)) selPins.push({ x: pin.x, y: pin.y });
  }
  const onSelected = (pt: Point) => selPins.some((q) => samePoint(q, pt)) || selWires.some((w) => onWire(w, pt));
  // labels / probes / notes / shapes that go along
  const labelIds = selIds(selection, 'label');
  for (const l of sheet.labels) if (onSelected(l)) labelIds.add(l.id);
  const probeIds = selIds(selection, 'probe');
  for (const p of sheet.probes) if (onSelected(p)) probeIds.add(p.id);
  const noteIds = selIds(selection, 'note');
  const shapeIds = selIds(selection, 'shape');

  // ---- boundary points: where unselected wiring touches the moved items ----
  const restWires = sheet.wires.filter((w) => !wireIds.has(w.id) && !w.bus);
  const restParts = sheet.parts.filter((p) => !partIds.has(p.id));
  const restPins: Point[] = [];
  for (const p of restParts) {
    const def = lookup(p.partId);
    if (def) for (const pin of instancePins(p, def)) restPins.push({ x: pin.x, y: pin.y });
  }
  const boundary: Point[] = [];
  const addB = (pt: Point) => {
    if (!boundary.some((b) => samePoint(b, pt))) boundary.push({ x: pt.x, y: pt.y });
  };
  for (const pin of selPins) {
    if (restWires.some((w) => wireEnds(w).some((e) => samePoint(e, pin))) || restPins.some((q) => samePoint(q, pin))) addB(pin);
  }
  for (const w of selWires) {
    for (const rw of restWires) for (const e of wireEnds(rw)) if (onWire(w, e)) addB(e);
    for (const e of wireEnds(w)) {
      if (restPins.some((q) => samePoint(q, e))) addB(e);
      if (restWires.some((rw) => onWireInterior(rw, e))) addB(e);
    }
  }

  // ---- nets of the boundary points (connectivity of the original sheet) ----
  const placed: PlacedPartInfo[] = sheet.parts.map((inst, index) => {
    const def = lookup(inst.partId);
    return { index, sheetId, inst, def, pins: def ? instancePins(inst, def) : [] };
  });
  const conn = computeConnectivity({ sheets: [sheet] }, placed, []);
  const usedNames = new Set(sheet.labels.map((l) => l.name.trim().toLowerCase()));
  const ports: { name: string; points: Point[] }[] = [];
  const portOfNet = new Map<number, { name: string; points: Point[] }>();
  // ground / global nets need no port: inside, a label with the same name keeps the connection
  const insideGlobals: NetLabel[] = [];
  const outsideGlobals: NetLabel[] = [];
  let auto = 0;
  for (const b of boundary) {
    const id = conn.netAt(sheetId, b);
    if (id === undefined) continue;
    const net = conn.nets[id];
    if (net.ground || net.globals.length) {
      const name = net.ground ? 'GND' : net.globals[0];
      insideGlobals.push({ id: newId('l'), x: b.x, y: b.y, name, rotation: 0, ...(net.ground ? {} : { global: true }) });
      // the wiring left outside keeps ending on a named point (no dangling wire end)
      outsideGlobals.push({ id: newId('l'), x: b.x, y: b.y, name, rotation: 0, ...(net.ground ? {} : { global: true }) });
      continue;
    }
    let port = portOfNet.get(id);
    if (!port) {
      const named = net.labels.find((l) => l.name && (l.kind === undefined || l.kind === 'label' || l.kind === 'offpage') && !l.global);
      let name = named?.name;
      if (!name) {
        do name = `IO${++auto}`;
        while (usedNames.has(name.toLowerCase()) || ports.some((p) => p.name.toLowerCase() === name!.toLowerCase()));
      }
      port = { name, points: [] };
      portOfNet.set(id, port);
      ports.push(port);
    }
    port.points.push(b);
  }

  // ---- child design with the moved items and one connector per port ----
  const box = itemsBounds(sheet, selection, lookup) ?? { x: 0, y: 0, w: 0, h: 0 };
  const cx = box.x + box.w / 2;
  const childSheet: Sheet = {
    ...newSheet(newId('sheet'), opts.sheetName ?? 'Sheet 1'),
    parts: selParts,
    wires: sheet.wires.filter((w) => wireIds.has(w.id)),
    labels: sheet.labels.filter((l) => labelIds.has(l.id)),
    probes: sheet.probes.filter((p) => probeIds.has(p.id)),
    notes: sheet.notes.filter((n) => noteIds.has(n.id)),
    ...((sheet.shapes ?? []).some((x) => shapeIds.has(x.id)) ? { shapes: (sheet.shapes ?? []).filter((x) => shapeIds.has(x.id)) } : {}),
  };
  for (const p of ports) {
    const at = p.points[0];
    childSheet.labels.push({ id: newId('l'), x: at.x, y: at.y, name: p.name, rotation: at.x <= cx ? 0 : 180, kind: 'hier' });
    // the net may cross the selection's edge several times: inside, the pieces join by name
    for (const more of p.points.slice(1)) childSheet.labels.push({ id: newId('l'), x: more.x, y: more.y, name: p.name, rotation: 0 });
  }
  childSheet.labels.push(...insideGlobals);
  const childId = newChildId(design, opts.kind === 'hierarchical' ? 'hb' : 'sc');
  const child: ChildDesign = { id: childId, kind: opts.kind, name: uniqueChildName(design, opts.name), sheets: [childSheet], variables: {} };
  let next: Design = { ...design, children: [...(design.children ?? []), child] };

  // ---- parent: remove the items, place the block, labels on its pins and at the boundary ----
  const def = blockPartDef(child);
  const block: PartInstance = {
    id: newId('p'),
    partId: blockPartId(childId),
    refdes: nextRefdes(effectivePrefix(def.prefix, design.refdesRules), collectRefdes(design, sheetId)),
    x: snap(box.x),
    y: snap(box.y),
    rotation: 0,
    mirror: false,
    params: {},
  };
  const outside: NetLabel[] = [...outsideGlobals];
  const pinPos = instancePins(block, def);
  for (const p of ports) {
    const pin = pinPos.find((x) => x.name === p.name);
    if (pin) outside.push({ id: newId('l'), x: pin.x, y: pin.y, name: p.name, rotation: pin.pin.dir === 'left' ? 180 : 0 });
    for (const at of p.points) outside.push({ id: newId('l'), x: at.x, y: at.y, name: p.name, rotation: 0 });
  }
  const nextLookup = designPartLookup(next, base);
  next = updateSheet(next, sheetId, (s) =>
    normalizeSheet(
      {
        ...s,
        parts: [...s.parts.filter((p) => !partIds.has(p.id)), block],
        wires: s.wires.filter((w) => !wireIds.has(w.id)),
        labels: [...s.labels.filter((l) => !labelIds.has(l.id)), ...outside],
        probes: s.probes.filter((p) => !probeIds.has(p.id)),
        notes: s.notes.filter((n) => !noteIds.has(n.id)),
        ...(s.shapes ? { shapes: s.shapes.filter((x) => !shapeIds.has(x.id)) } : {}),
      },
      nextLookup,
    ),
  );
  return { design: next, childId, blockId: block.id, ports: ports.map((p) => p.name) };
}

/** Fresh sheet / item ids for sheets copied into this design. */
function reidSheets(sheets: Sheet[], fixPart: (partId: string) => string = (p) => p): Sheet[] {
  return sheets.map((s) => ({
    ...s,
    id: newId('sheet'),
    parts: s.parts.map((p) => ({ ...p, id: newId('p'), partId: fixPart(p.partId) })),
    wires: s.wires.map((w) => ({ ...w, id: newId('w') })),
    labels: s.labels.map((l) => ({ ...l, id: newId('l') })),
    probes: s.probes.map((p) => ({ ...p, id: newId('pr') })),
    notes: s.notes.map((n) => ({ ...n, id: newId('t') })),
    ...(s.shapes ? { shapes: s.shapes.map((x) => ({ ...x, id: newId('sh') })) } : {}),
  }));
}

/**
 * Hierarchical block from another design (e.g. a .msim file): its root sheets become the
 * child's sheets, its variables the block's instance parameters, its own children are merged in.
 */
export function childFromDesign(design: Design, source: Design, name: string, sourceFile?: string): { design: Design; childId: string; notes: SanitizeNote[] } {
  let next = design;
  let map = new Map<string, string>();
  if (source.children?.length) {
    const merged = mergeChildren(next, source.children);
    next = merged.design;
    map = merged.map;
  }
  // the shared integrity layer: the source's user components come along, its assembly-variant ids
  // are remapped by name or dropped, so the design we build still saves and reopens
  const safe = sanitizeIncomingSheets(next, source.sheets, {
    customParts: source.customParts,
    variables: source.variables,
    variants: source.variants,
    customSpice: source.customSpice,
    nets: source.nets,
  });
  if (safe.customParts.length) next = { ...next, customParts: [...(next.customParts ?? []), ...safe.customParts] };
  // the function blocks its ladder sheets call come along (blocks are defined in the root design)
  if (source.ladderBlocks?.length) next = { ...next, ladderBlocks: mergeLadderBlocks(next.ladderBlocks, source.ladderBlocks) };
  if (safe.customSpice) next = { ...next, customSpice: next.customSpice ? `${next.customSpice.replace(/\s+$/, '')}
${safe.customSpice}
` : `${safe.customSpice}
` };
  const fix = (partId: string) => {
    const id = childIdOfPart(partId);
    return id === undefined ? partId : BLOCK_PREFIX + (map.get(id) ?? id);
  };
  const childId = newChildId(next, 'hb');
  const child: ChildDesign = {
    id: childId,
    kind: 'hierarchical',
    name: uniqueChildName(next, name),
    sheets: reidSheets(safe.sheets, fix),
    // the block's instance parameters: the source's own globals plus the ones its values need
    variables: { ...source.variables, ...safe.variables },
    ...(sourceFile ? { sourceFile } : {}),
    ...(source.description ? { description: source.description } : {}),
  };
  return { design: { ...next, children: [...(next.children ?? []), child] }, childId, notes: safe.notes };
}

/** A child design as a stand-alone design (to save a block as its own file); restrictions are kept. */
export function childAsDesign(design: Design, childId: string): Design | null {
  const child = getChild(design, childId);
  if (!child) return null;
  const needed = new Set<string>();
  const visit = (sheets: Sheet[]) => {
    for (const s of sheets) for (const p of s.parts) {
      const id = childIdOfPart(p.partId);
      if (id === undefined || needed.has(id)) continue;
      const c = getChild(design, id);
      if (!c) continue;
      needed.add(id);
      visit(c.sheets);
    }
  };
  visit(child.sheets);
  const out = newDesign(child.name);
  out.sheets = JSON.parse(JSON.stringify(child.sheets)) as Sheet[];
  out.variables = { ...child.variables };
  out.analysis = JSON.parse(JSON.stringify(design.analysis)) as Design['analysis'];
  if (child.description) out.description = child.description;
  const kids = (design.children ?? []).filter((c) => needed.has(c.id));
  if (kids.length) out.children = JSON.parse(JSON.stringify(kids)) as ChildDesign[];
  // the instructor's restrictions (hidden values, locked parts …) travel with the saved block
  if (design.restrictions) out.restrictions = JSON.parse(JSON.stringify(design.restrictions)) as NonNullable<Design['restrictions']>;
  return out;
}

/** Number of blocks placed for a child (on any sheet). */
export function childUseCount(design: Design, childId: string): number {
  return blockInstances(design).filter((b) => b.childId === childId).length;
}

/** Remove a child design that no block uses (returns `design` unchanged otherwise). */
export function deleteChild(design: Design, childId: string): Design {
  if (!getChild(design, childId) || childUseCount(design, childId) > 0) return design;
  const children = (design.children ?? []).filter((c) => c.id !== childId);
  const next: Design = { ...design };
  if (children.length) next.children = children;
  else delete next.children;
  return next;
}

/** Change a child's name, kind, description, parameters or port order. */
export function updateChildInfo(design: Design, childId: string, patch: Partial<Pick<ChildDesign, 'name' | 'kind' | 'description' | 'variables' | 'portOrder'>>): Design {
  return updateChild(design, childId, (c) => {
    const next = { ...c };
    let changed = false;
    if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== c.name) {
      const others = { children: (design.children ?? []).filter((x) => x.id !== childId) };
      next.name = uniqueChildName(others, patch.name.trim());
      changed = true;
    }
    if (patch.kind !== undefined && patch.kind !== c.kind) {
      next.kind = patch.kind;
      changed = true;
    }
    if (patch.description !== undefined && patch.description !== (c.description ?? '')) {
      if (patch.description) next.description = patch.description;
      else delete next.description;
      changed = true;
    }
    if (patch.variables !== undefined && JSON.stringify(patch.variables) !== JSON.stringify(c.variables)) {
      next.variables = { ...patch.variables };
      changed = true;
    }
    if (patch.portOrder !== undefined && JSON.stringify(patch.portOrder) !== JSON.stringify(c.portOrder ?? [])) {
      if (patch.portOrder.length) next.portOrder = [...patch.portOrder];
      else delete next.portOrder;
      changed = true;
    }
    return changed ? next : c;
  });
}
