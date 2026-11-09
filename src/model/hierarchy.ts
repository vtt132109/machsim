/**
 * Design hierarchy: subcircuits and hierarchical blocks (ChildDesign in src/model/types.ts).
 *
 * - A child design is stored in `Design.children` and placed as a PartInstance whose partId is
 *   `hier:<child id>` ({@link blockPartId}). {@link blockPartDef} builds the block's PartDef on
 *   the fly from the child's hierarchical connectors (one pin per port; a vector name such as
 *   "D[0..7]" gives one bus pin), so every editor operation that works on parts (select, move,
 *   rotate, copy, delete, properties, undo) works on blocks too. Use {@link designPartLookup}
 *   (or {@link resolvePart}) wherever a part definition is needed for an instance of a design.
 * - Instance parameters: the child's `variables` become the block's parameters (text values,
 *   expressions allowed); an instance's `params` override them.
 * - Sheets of children live next to the root sheets; sheet ids and item ids are unique in the
 *   whole design, so {@link findSheet} can locate any sheet by id and the editor can open a
 *   child sheet like any other ("open / edit child").
 * - Scopes: the root design and every child are separate name scopes for nets (labels, off-page
 *   connectors) and reference designators. Global names (power symbols, global labels and
 *   connectors) are shared by all scopes.
 */
import { getPart } from '../library';
import { customPartDef } from '../library/custom/partDef';
import { isCustomPartId } from '../library/custom/types';
import type { ParamDef, PartDef, PinDef, PinType, SymbolPrim } from '../library/types';
import { parseBusName } from './bus';
import type { ChildDesign, Design, PartInstance, Sheet } from './types';

/** Prefix of block part ids. */
export const BLOCK_PREFIX = 'hier:';

/** Part id of the block that instantiates child `childId`. */
export function blockPartId(childId: string): string {
  return `${BLOCK_PREFIX}${childId}`;
}

export function isBlockPartId(partId: string): boolean {
  return partId.startsWith(BLOCK_PREFIX);
}

/** Child id referenced by a block part id (undefined for library parts). */
export function childIdOfPart(partId: string): string | undefined {
  return isBlockPartId(partId) ? partId.slice(BLOCK_PREFIX.length) : undefined;
}

export function getChild(design: Pick<Design, 'children'>, childId: string): ChildDesign | undefined {
  return design.children?.find((c) => c.id === childId);
}

// ---------------------------------------------------------------------------
// ports and block symbols
// ---------------------------------------------------------------------------

/** A port of a child design (one hierarchical connector name). */
export interface BlockPort {
  /** connector name as written (first spelling), e.g. "IN" or "D[0..7]" */
  name: string;
  /** SPICE port lines: [name] for a scalar port, the bus lines for a vector port */
  members: string[];
  bus: boolean;
  side: 'left' | 'right';
}

const OUTPUT_NAME = /^(out|vout|output|q|y|o)(\b|[_\d])|out$/i;

/**
 * Ports of a child: its hierarchical connectors, unique by name (case-insensitive), ordered by
 * `portOrder` then by first appearance (sheet order, label order). A port goes on the right side
 * of the block when its connector is turned 180° or its name looks like an output (OUT, VOUT, Q…).
 * Connectors with an invalid bus name are skipped (the netlister reports them).
 */
export function childPorts(child: Pick<ChildDesign, 'sheets' | 'portOrder'>): BlockPort[] {
  const found = new Map<string, BlockPort>();
  for (const sheet of child.sheets) {
    for (const l of sheet.labels) {
      if (l.kind !== 'hier') continue;
      const name = l.name.trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (found.has(k)) continue;
      const parsed = parseBusName(name);
      if (parsed.error) continue;
      found.set(k, { name, members: parsed.members, bus: parsed.vector, side: l.rotation === 180 || OUTPUT_NAME.test(name) ? 'right' : 'left' });
    }
  }
  const ordered: BlockPort[] = [];
  for (const n of child.portOrder ?? []) {
    const p = found.get(n.trim().toLowerCase());
    if (p && !ordered.includes(p)) ordered.push(p);
  }
  for (const p of found.values()) if (!ordered.includes(p)) ordered.push(p);
  return ordered;
}

/** PartDef of a block, with the child it stands for. */
export interface BlockPartDef extends PartDef {
  block: { childId: string; kind: ChildDesign['kind']; ports: BlockPort[] };
}

export function isBlockPartDef(def: PartDef | undefined): def is BlockPartDef {
  return !!def && 'block' in def && typeof (def as BlockPartDef).block === 'object';
}

const PIN_PITCH = 20;
/** pin stub length (pins sit on grid points left / right of the body) */
const STUB = 10;
const blockCache = new WeakMap<ChildDesign, BlockPartDef>();

/**
 * Block symbol of a child design (cached per child object; children are immutable snapshots):
 * a rectangle with the ports as pins on the left and right, the name under the body, refdes
 * prefix HB (hierarchical block) or SC (subcircuit). Origin = top-left corner of the body.
 */
export function blockPartDef(child: ChildDesign): BlockPartDef {
  const cached = blockCache.get(child);
  if (cached) return cached;
  const ports = childPorts(child);
  const left = ports.filter((p) => p.side === 'left');
  const right = ports.filter((p) => p.side === 'right');
  const rows = Math.max(1, left.length, right.length);
  const longest = Math.max(0, ...ports.map((p) => p.name.length));
  const w = Math.max(80, Math.ceil((longest * 2 * 8 * 0.6 + 30) / PIN_PITCH) * PIN_PITCH);
  const h = (rows + 1) * PIN_PITCH;
  const prims: SymbolPrim[] = [{ kind: 'rect', x: 0, y: 0, w, h, r: 3 }];
  if (child.kind === 'hierarchical') prims.push({ kind: 'line', x1: 0, y1: 6, x2: w, y2: 6 });
  const pins: PinDef[] = [];
  const pinType = (p: BlockPort): PinType => (p.side === 'right' ? 'output' : 'input');
  left.forEach((p, i) => {
    const y = (i + 1) * PIN_PITCH;
    prims.push({ kind: 'line', x1: -STUB, y1: y, x2: 0, y2: y, ...(p.bus ? { width: 3 } : {}) });
    pins.push({ name: p.name, x: -STUB, y, dir: 'left', label: p.name, type: pinType(p) });
  });
  right.forEach((p, i) => {
    const y = (i + 1) * PIN_PITCH;
    prims.push({ kind: 'line', x1: w, y1: y, x2: w + STUB, y2: y, ...(p.bus ? { width: 3 } : {}) });
    pins.push({ name: p.name, x: w + STUB, y, dir: 'right', label: p.name, type: pinType(p) });
  });
  prims.push({ kind: 'text', x: w / 2, y: h + 12, text: child.name, size: 11, anchor: 'middle', bold: true });
  const params: ParamDef[] = Object.entries(child.variables).map(([key, def]) => ({
    key,
    label: key,
    default: def,
    kind: 'text',
    group: 'value',
    help: 'Instance parameter of the block (number or {expression}); the default comes from the child design.',
  }));
  const def: BlockPartDef = {
    id: blockPartId(child.id),
    name: child.name,
    group: 'misc',
    family: 'Hierarchy',
    description: `${child.kind === 'hierarchical' ? 'Hierarchical block' : 'Subcircuit'} '${child.name}' with ${ports.length} port(s)`,
    prefix: child.kind === 'hierarchical' ? 'HB' : 'SC',
    symbol: {
      bbox: { x: -STUB, y: 0, w: w + 2 * STUB, h: h + 18 },
      prims,
      pins,
      refPos: { x: 0, y: -8 },
      valuePos: { x: w, y: -8 },
    },
    params,
    block: { childId: child.id, kind: child.kind, ports },
  };
  blockCache.set(child, def);
  return def;
}

/** Library lookup type (partId -> definition). */
export type PartResolver = (partId: string) => PartDef | undefined;

/** Design fields part resolution reads (children for blocks, embedded user components). */
export type PartScope = Pick<Design, 'children' | 'customParts'>;

/**
 * Part definition for an instance's partId in a design: block symbols for `hier:` ids, the
 * design's embedded copy for user components (`custom:` ids, falling back to `base` when the design
 * has no copy), the library otherwise.
 */
export function resolvePart(design: PartScope, partId: string, base: PartResolver = getPart): PartDef | undefined {
  if (isCustomPartId(partId)) {
    const data = design.customParts?.find((c) => c.id === partId);
    return data ? customPartDef(data) : base(partId);
  }
  const childId = childIdOfPart(partId);
  if (childId === undefined) return base(partId);
  const child = getChild(design, childId);
  return child ? blockPartDef(child) : undefined;
}

/** Lookup bound to one design (blocks resolve against its children, user components against its copies). */
export function designPartLookup(design: PartScope, base: PartResolver = getPart): PartResolver {
  if (!design.children?.length && !design.customParts?.length) return base;
  return (partId) => resolvePart(design, partId, base);
}

// ---------------------------------------------------------------------------
// sheets and scopes
// ---------------------------------------------------------------------------

/** Every sheet of the design: root sheets first, then each child's sheets. */
export function allSheets(design: Pick<Design, 'sheets' | 'children'>): Sheet[] {
  const out = design.sheets.slice();
  for (const c of design.children ?? []) out.push(...c.sheets);
  return out;
}

export interface SheetLocation {
  sheet: Sheet;
  /** owning child (undefined for a root sheet) */
  child?: ChildDesign;
  /** index of the sheet inside its owner */
  index: number;
}

/** Locate a sheet by id among the root sheets and the children's sheets. */
export function findSheet(design: Pick<Design, 'sheets' | 'children'>, sheetId: string): SheetLocation | undefined {
  const i = design.sheets.findIndex((s) => s.id === sheetId);
  if (i >= 0) return { sheet: design.sheets[i], index: i };
  for (const child of design.children ?? []) {
    const j = child.sheets.findIndex((s) => s.id === sheetId);
    if (j >= 0) return { sheet: child.sheets[j], child, index: j };
  }
  return undefined;
}

/** Sheets of a scope: the root design (`undefined`) or a child. */
export function scopeSheets(design: Pick<Design, 'sheets' | 'children'>, childId?: string): Sheet[] {
  if (childId === undefined) return design.sheets;
  return getChild(design, childId)?.sheets ?? [];
}

/** Child id owning a sheet (undefined for root sheets and unknown ids). */
export function sheetScope(design: Pick<Design, 'sheets' | 'children'>, sheetId: string): string | undefined {
  return findSheet(design, sheetId)?.child?.id;
}

/** Replace a child through `fn` (returns `design` itself when unchanged or missing). */
export function updateChild(design: Design, childId: string, fn: (c: ChildDesign) => ChildDesign): Design {
  const list = design.children ?? [];
  const idx = list.findIndex((c) => c.id === childId);
  if (idx < 0) return design;
  const next = fn(list[idx]);
  if (next === list[idx]) return design;
  const children = list.slice();
  children[idx] = next;
  return { ...design, children };
}

/** A placed block. */
export interface BlockRef {
  /** sheet the block is on */
  sheetId: string;
  /** scope of that sheet (undefined = root) */
  scope?: string;
  inst: PartInstance;
  childId: string;
}

/** Every block instance on every sheet (root and children). */
export function blockInstances(design: Pick<Design, 'sheets' | 'children'>): BlockRef[] {
  const out: BlockRef[] = [];
  const visit = (sheets: Sheet[], scope?: string) => {
    for (const s of sheets) for (const inst of s.parts) {
      const childId = childIdOfPart(inst.partId);
      if (childId !== undefined) out.push({ sheetId: s.id, ...(scope !== undefined ? { scope } : {}), inst, childId });
    }
  };
  visit(design.sheets);
  for (const c of design.children ?? []) visit(c.sheets, c.id);
  return out;
}

/** Child ids whose definitions contain themselves (directly or through other blocks). */
export function cyclicChildren(design: Pick<Design, 'sheets' | 'children'>): Set<string> {
  const uses = new Map<string, Set<string>>();
  for (const b of blockInstances(design)) {
    if (b.scope === undefined) continue;
    let set = uses.get(b.scope);
    if (!set) uses.set(b.scope, (set = new Set()));
    set.add(b.childId);
  }
  const cyclic = new Set<string>();
  for (const c of design.children ?? []) {
    const seen = new Set<string>();
    const stack = [...(uses.get(c.id) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === c.id) {
        cyclic.add(c.id);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(uses.get(id) ?? []));
    }
  }
  return cyclic;
}

/** Node of the design tree (root, child designs reached through blocks, their sheets). */
export interface HierarchyNode {
  /** instance path, e.g. "" (root), "HB1", "HB1/SC2" */
  path: string;
  /** child design (undefined for the root) */
  child?: ChildDesign;
  /** the block instance that leads here (undefined for the root) */
  block?: BlockRef;
  sheets: Sheet[];
  children: HierarchyNode[];
  /** true when this node repeats a design already open above it (cycle; not expanded) */
  cyclic?: boolean;
}

/** Instance tree from the root through every placed block (cycles are cut and flagged). */
export function hierarchyTree(design: Pick<Design, 'sheets' | 'children'>): HierarchyNode {
  const blocks = blockInstances(design);
  const build = (path: string, sheets: Sheet[], scope: string | undefined, chain: string[], child?: ChildDesign, block?: BlockRef): HierarchyNode => {
    const node: HierarchyNode = { path, sheets, children: [], ...(child ? { child } : {}), ...(block ? { block } : {}) };
    for (const b of blocks) {
      if (b.scope !== scope) continue;
      const c = getChild(design, b.childId);
      const p = path ? `${path}/${b.inst.refdes}` : b.inst.refdes;
      if (!c) continue;
      if (chain.includes(c.id)) {
        node.children.push({ path: p, child: c, block: b, sheets: c.sheets, children: [], cyclic: true });
        continue;
      }
      node.children.push(build(p, c.sheets, c.id, [...chain, c.id], c, b));
    }
    return node;
  };
  return build('', design.sheets, undefined, []);
}

/** Number of times each child is instantiated in the expanded hierarchy (cycles not followed). */
export function childInstanceCounts(design: Pick<Design, 'sheets' | 'children'>): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (n: HierarchyNode) => {
    for (const c of n.children) {
      if (c.child) counts.set(c.child.id, (counts.get(c.child.id) ?? 0) + 1);
      if (!c.cyclic) walk(c);
    }
  };
  walk(hierarchyTree(design));
  return counts;
}

/** A unique child id for a new child design. */
export function newChildId(design: Pick<Design, 'children'>, base = 'child'): string {
  const used = new Set((design.children ?? []).map((c) => c.id));
  for (let n = 1; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

/** A child name not used by another child (case-insensitive), based on `base`. */
export function uniqueChildName(design: Pick<Design, 'children'>, base: string): string {
  const used = new Set((design.children ?? []).map((c) => c.name.toLowerCase()));
  const clean = base.trim() || 'Block';
  if (!used.has(clean.toLowerCase())) return clean;
  for (let n = 2; ; n++) if (!used.has(`${clean}${n}`.toLowerCase())) return `${clean}${n}`;
}

// ---------------------------------------------------------------------------
// placed copies of a block: live parts by path, per-copy state (PartInstance.inner)
// ---------------------------------------------------------------------------

/** Separator of the refdes path inside an `inner` key ("X2/S1") and in live-map keys. */
export const INNER_SEP = '/';

/**
 * Key of PartInstance.inner for part `local` of the copy `path` (refdes of each block from the
 * top level down): relative to the first block of the path, so ["X1"] + "S1" -> "S1" and
 * ["X1","X2"] + "S1" -> "X2/S1".
 */
export function innerKey(path: readonly string[], local: string): string {
  return [...path.slice(1), local].join(INNER_SEP);
}

/**
 * Parameter overrides one placed block hands down to its child design: its own `inner` entries
 * plus the entries a block above it addressed to parts below this one (`levelOverrides` keys that
 * start with this block's refdes, stripped of it). Keys are relative to the child.
 */
export function childOverrides(blockRefdes: string, blockInner: PartInstance['inner'], levelOverrides?: Record<string, Record<string, string>>): Record<string, Record<string, string>> | undefined {
  const out: Record<string, Record<string, string>> = {};
  const prefix = `${blockRefdes}${INNER_SEP}`;
  for (const [k, v] of Object.entries(levelOverrides ?? {})) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = { ...v };
  for (const [k, v] of Object.entries(blockInner ?? {})) out[k] = { ...(out[k] ?? {}), ...v };
  return Object.keys(out).length ? out : undefined;
}

/** Stable text of an override table, for the specialisation key of an emitted subcircuit. */
export function overridesKey(o: Record<string, Record<string, string>> | undefined): string {
  if (!o) return '';
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, Object.keys(o[k]).sort().map((p) => [p, o[k][p]])]));
}

/** A part reached through a path of block copies. */
export interface LiveRef {
  part: PartInstance;
  sheetId: string;
  /** refdes of the block copies from the top level down ([] = a top-level part) */
  path: string[];
  /** refdes of the part inside its design */
  local: string;
  /** child design that holds the part (undefined = top level) */
  childId?: string;
  /** the top-level block that carries the copy's state (undefined for a top-level part) */
  rootBlock?: PartInstance;
}

const sameRef = (a: string, b: string): boolean => a.trim().toUpperCase() === b.trim().toUpperCase();

/** The part `local` reached through the block copies `path` (null when any step does not exist). */
export function resolveLivePart(design: Pick<Design, 'sheets' | 'children'>, path: readonly string[], local: string): LiveRef | null {
  let sheets: Sheet[] = design.sheets;
  let childId: string | undefined;
  let rootBlock: PartInstance | undefined;
  for (const name of path) {
    let next: string | undefined;
    for (const s of sheets) {
      const inst = s.parts.find((p) => sameRef(p.refdes, name) && childIdOfPart(p.partId) !== undefined);
      if (inst) {
        next = childIdOfPart(inst.partId);
        if (!rootBlock) rootBlock = inst;
        break;
      }
    }
    const child = next !== undefined ? getChild(design, next) : undefined;
    if (!child) return null;
    sheets = child.sheets;
    childId = child.id;
  }
  for (const s of sheets) {
    const part = s.parts.find((p) => sameRef(p.refdes, local));
    if (part) return { part, sheetId: s.id, path: [...path], local: part.refdes, ...(childId !== undefined ? { childId } : {}), ...(rootBlock ? { rootBlock } : {}) };
  }
  return null;
}

/**
 * Part named like a live binding: a top-level refdes ("XMM1") or a dotted path through blocks
 * ("X2.XMM1", "X1.X2.XMM1"). A top-level refdes wins over a path.
 */
export function resolveLiveName(design: Pick<Design, 'sheets' | 'children'>, name: string): LiveRef | null {
  const direct = resolveLivePart(design, [], name);
  if (direct) return direct;
  const segs = name.split('.');
  if (segs.length < 2) return null;
  return resolveLivePart(design, segs.slice(0, -1), segs[segs.length - 1]);
}

/**
 * The state the top-level block `path[0]` holds for part `local` of the design level reached by
 * `path` (PartInstance.inner), or undefined: what makes one placed copy differ from the block design.
 */
export function copyStateOf(design: Pick<Design, 'sheets'>, path: readonly string[], local: string): Record<string, string> | undefined {
  if (!path.length) return undefined;
  for (const s of design.sheets) {
    const root = s.parts.find((p) => sameRef(p.refdes, path[0]) && childIdOfPart(p.partId) !== undefined);
    if (root) return root.inner?.[innerKey(path, local)];
  }
  return undefined;
}

/** The sheet of the block design as the placed copy `path` sees it: the copy's own part settings on top. */
export function sheetAsCopy(design: Pick<Design, 'sheets'>, path: readonly string[], sheet: Sheet): Sheet {
  if (!path.length) return sheet;
  let touched = false;
  const parts = sheet.parts.map((p) => {
    const own = copyStateOf(design, path, p.refdes);
    if (!own) return p;
    touched = true;
    return { ...p, params: { ...p.params, ...own } };
  });
  return touched ? { ...sheet, parts } : sheet;
}

/** Saved parameters of a live part with the copy's overrides on top (PartInstance.inner). */
export function liveParams(ref: LiveRef): Record<string, string> {
  const own = ref.rootBlock?.inner?.[innerKey(ref.path, ref.local)];
  return own ? { ...ref.part.params, ...own } : ref.part.params;
}

function mapPartById(sheets: Sheet[], partId: string, fn: (p: PartInstance) => PartInstance): Sheet[] | null {
  for (let i = 0; i < sheets.length; i++) {
    const k = sheets[i].parts.findIndex((p) => p.id === partId);
    if (k < 0) continue;
    const parts = sheets[i].parts.slice();
    parts[k] = fn(parts[k]);
    const out = sheets.slice();
    out[i] = { ...sheets[i], parts };
    return out;
  }
  return null;
}

/**
 * Design with one parameter of a live part changed: a top-level part gets the value in its own
 * `params`, a part inside a block copy gets it in the top-level block's `inner` table, so the other
 * copies and the block design stay as they are.
 */
export function withLiveParam(design: Design, ref: LiveRef, param: string, value: string): Design {
  if (!ref.rootBlock) {
    const sheets = mapPartById(design.sheets, ref.part.id, (p) => ({ ...p, params: { ...p.params, [param]: value } }));
    return sheets ? { ...design, sheets } : design;
  }
  const key = innerKey(ref.path, ref.local);
  const bump = (p: PartInstance): PartInstance => ({ ...p, inner: { ...(p.inner ?? {}), [key]: { ...(p.inner?.[key] ?? {}), [param]: value } } });
  const sheets = mapPartById(design.sheets, ref.rootBlock.id, bump);
  return sheets ? { ...design, sheets } : design;
}

/** Refdes paths of every placed copy of child `childId` (a block placed twice gives two paths). */
export function copyPaths(design: Pick<Design, 'sheets' | 'children'>, childId: string): string[][] {
  const out: string[][] = [];
  const walk = (n: HierarchyNode, path: string[]) => {
    for (const c of n.children) {
      const here = [...path, c.block?.inst.refdes ?? ''];
      if (c.child?.id === childId) out.push(here);
      if (!c.cyclic) walk(c, here);
    }
  };
  walk(hierarchyTree(design), []);
  return out;
}

/** True when `path` leads (through placed blocks) to a copy of child `childId`. */
export function pathLeadsTo(design: Pick<Design, 'sheets' | 'children'>, path: readonly string[], childId: string | undefined): boolean {
  if (childId === undefined) return path.length === 0;
  if (path.length === 0) return false;
  let sheets: Sheet[] = design.sheets;
  let last: string | undefined;
  for (const name of path) {
    let next: string | undefined;
    for (const s of sheets) {
      const inst = s.parts.find((p) => sameRef(p.refdes, name) && childIdOfPart(p.partId) !== undefined);
      if (inst) {
        next = childIdOfPart(inst.partId);
        break;
      }
    }
    const child = next !== undefined ? getChild(design, next) : undefined;
    if (!child) return false;
    sheets = child.sheets;
    last = child.id;
  }
  return last === childId;
}

/** Key of a live value (indicator level, probe read-out) of a part / probe in the copy `path`. */
export function liveKey(path: readonly string[] | undefined, local: string): string {
  return path && path.length ? `${path.join(INNER_SEP)}${INNER_SEP}${local}` : local;
}

/**
 * The part of a live map (indicator levels, probe read-outs) that belongs to the copy `path`:
 * keys written with {@link liveKey} for exactly that copy, stripped of the path; for the top level
 * (`path` empty) the keys that carry no path. Returns `map` itself when nothing has to change.
 */
export function scopedLive<T>(map: Record<string, T>, path: readonly string[]): Record<string, T> {
  const prefix = path.length ? `${path.join(INNER_SEP)}${INNER_SEP}` : '';
  let any = false;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) {
    if (prefix) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      // a deeper copy ("X2/X3/LED1" seen from "X2") is not this level's
      const head = rest.split('#')[0];
      if (head.includes(INNER_SEP)) continue;
      out[rest] = v;
      any = true;
    } else {
      if (k.includes(INNER_SEP)) {
        any = true;
        continue;
      }
      out[k] = v;
    }
  }
  return prefix || any ? out : map;
}
