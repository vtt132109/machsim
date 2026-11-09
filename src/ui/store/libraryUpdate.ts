/**
 * Tools › Update components from library (pure): compare the placed parts with the current library
 * definitions and bring the selected ones up to date in one step.
 *
 * Built-in parts are referred to by id, so a placed part always simulates with the current library
 * model; what can go stale is the drawing around it. The design therefore keeps, per part id, the
 * definition its placed copies were last updated to (`Design.libraryRefs`: fingerprint, pin
 * positions, parameter defaults; written on save by `stampLibraryRefs`). User components are
 * embedded (`Design.customParts`) and compared with the copy in the user / corporate database.
 *
 *   compareWithLibrary(design, lookup, dbLookup)   LibraryDiff[]: one entry per part id whose
 *                                                  definition changed (pins moved / added /
 *                                                  removed, defaults, model, footprint, name), whose
 *                                                  placed copies hold a choice that no longer exists,
 *                                                  or that is missing from the library
 *   updateFromLibrary(design, partIds, lookup, dbLookup)
 *                                                  update every placed copy of those parts: wires and
 *                                                  labels follow moved pins (like Replace component),
 *                                                  removed parameters and invalid choices are dropped
 *                                                  (they take the default), embedded user components
 *                                                  are replaced by the database copy, and the
 *                                                  library reference is refreshed
 *   stampLibraryRefs(design, lookup)               add references for newly used parts, drop unused
 *                                                  ones (save transform; existing references are
 *                                                  kept until the user updates)
 */
import type { CustomPartData } from '../../library/custom/types';
import { isCustomPartId } from '../../library/custom/types';
import { customPartDef } from '../../library/custom/partDef';
import { libraryRef, partFingerprint } from '../../library/partFingerprint';
import type { PartDef } from '../../library/types';
import { instancePins, samePoint } from '../../model/geometry';
import type { Design, PartInstance, PartLibraryRef, Point, Sheet } from '../../model/types';
import type { PartLookup } from './types';
import { normalizeSheet, updateSheet } from './designOps';
import { rubberBandPoints } from './routing';
import { pointKey, wireEnds } from './wireOps';

export type CustomLookup = (id: string) => CustomPartData | undefined;

export type LibraryChange =
  | { kind: 'pinMoved'; pin: string }
  | { kind: 'pinAdded'; pin: string }
  | { kind: 'pinRemoved'; pin: string }
  | { kind: 'paramAdded'; key: string }
  | { kind: 'paramRemoved'; key: string }
  | { kind: 'defaultChanged'; key: string; from: string; to: string }
  | { kind: 'optionInvalid'; key: string; value: string; refdes: string[] }
  | { kind: 'modelChanged' }
  | { kind: 'symbolChanged' }
  | { kind: 'footprintChanged'; from: string; to: string }
  | { kind: 'nameChanged'; from: string; to: string };

/** A placed copy of a part. */
export interface PlacedRef {
  sheetId: string;
  instId: string;
  /** "R1", or "<block design>/R1" inside a subcircuit / hierarchical block design */
  path: string;
}

export interface LibraryDiff {
  partId: string;
  /** current library name (the placed name for a missing part) */
  name: string;
  kind: 'builtin' | 'custom';
  /** 'changed': can be updated; 'missing': the library has no part with this id (use Replace component) */
  status: 'changed' | 'missing';
  instances: PlacedRef[];
  changes: LibraryChange[];
}

interface Placed {
  inst: PartInstance;
  sheet: Sheet;
  path: string;
}

function placedByPart(design: Design): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>();
  const add = (sheets: Sheet[], prefix: string) => {
    for (const sheet of sheets) {
      for (const inst of sheet.parts) {
        if (inst.partId.startsWith('hier:')) continue;
        const list = out.get(inst.partId) ?? [];
        list.push({ inst, sheet, path: `${prefix}${inst.refdes}` });
        out.set(inst.partId, list);
      }
    }
  };
  add(design.sheets, '');
  for (const c of design.children ?? []) add(c.sheets, `${c.name}/`);
  return out;
}

const pinMap = (def: Pick<PartDef, 'symbol'>): Record<string, [number, number]> => Object.fromEntries(def.symbol.pins.map((p) => [p.name, [p.x, p.y] as [number, number]]));

function pinChanges(before: Record<string, [number, number]>, after: Record<string, [number, number]>): LibraryChange[] {
  const out: LibraryChange[] = [];
  for (const [pin, xy] of Object.entries(before)) {
    const now = after[pin];
    if (!now) out.push({ kind: 'pinRemoved', pin });
    else if (now[0] !== xy[0] || now[1] !== xy[1]) out.push({ kind: 'pinMoved', pin });
  }
  for (const pin of Object.keys(after)) if (!(pin in before)) out.push({ kind: 'pinAdded', pin });
  return out;
}

function defaultChanges(before: Record<string, string>, after: Record<string, string>): LibraryChange[] {
  const out: LibraryChange[] = [];
  for (const [key, from] of Object.entries(before)) {
    if (!(key in after)) out.push({ kind: 'paramRemoved', key });
    else if (after[key] !== from) out.push({ kind: 'defaultChanged', key, from, to: after[key] });
  }
  for (const key of Object.keys(after)) if (!(key in before)) out.push({ kind: 'paramAdded', key });
  return out;
}

const defaultsOf = (def: PartDef): Record<string, string> => Object.fromEntries(def.params.map((p) => [p.key, p.default]));

/**
 * Differences the PLACED COPIES themselves show, whatever the design records: a parameter stored
 * on an instance that the current library part does not declare any more. A teacher's old file has
 * no `Design.libraryRefs` at all, so this is the only honest comparison there is for it — and it
 * is a real difference: that value is ignored by the simulation now.
 */
function instanceParamChanges(def: PartDef, placed: Placed[]): { kind: 'paramRemoved'; key: string }[] {
  const declared = new Set(def.params.map((p) => p.key));
  const gone = new Map<string, string[]>();
  for (const x of placed) for (const key of Object.keys(x.inst.params)) if (!declared.has(key)) gone.set(key, [...(gone.get(key) ?? []), x.path]);
  return [...gone.keys()].sort().map((key) => ({ kind: 'paramRemoved' as const, key }));
}

/** Placed copies whose value of a select parameter is not one of its choices any more. */
function invalidOptions(def: PartDef, placed: Placed[]): LibraryChange[] {
  const out: LibraryChange[] = [];
  for (const p of def.params) {
    if (p.kind !== 'select' || !p.options?.length) continue;
    const bad = new Map<string, string[]>();
    for (const x of placed) {
      const v = x.inst.params[p.key];
      if (v !== undefined && !p.options.some((o) => o.value === v)) bad.set(v, [...(bad.get(v) ?? []), x.path]);
    }
    for (const [value, refdes] of bad) out.push({ kind: 'optionInvalid', key: p.key, value, refdes });
  }
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The differences between the placed parts and the current library (see the module header). */
export function compareWithLibrary(design: Design, lookup: PartLookup, dbLookup: CustomLookup): LibraryDiff[] {
  const out: LibraryDiff[] = [];
  for (const [partId, placed] of placedByPart(design)) {
    const instances = placed.map((p) => ({ sheetId: p.sheet.id, instId: p.inst.id, path: p.path }));
    if (isCustomPartId(partId)) {
      const embedded = design.customParts?.find((c) => c.id === partId);
      const fresh = dbLookup(partId);
      if (!embedded || !fresh || sameJson(embedded, fresh)) {
        const def = lookup(partId);
        const bad = def ? invalidOptions(def, placed) : [];
        if (bad.length) out.push({ partId, name: def!.name, kind: 'custom', status: 'changed', instances, changes: bad });
        continue;
      }
      const before = customPartDef(embedded);
      const after = customPartDef(fresh);
      const changes: LibraryChange[] = [...pinChanges(pinMap(before), pinMap(after)), ...defaultChanges(defaultsOf(before), defaultsOf(after))];
      if (!sameJson(embedded.model, fresh.model)) changes.push({ kind: 'modelChanged' });
      if (!sameJson(embedded.symbol.prims, fresh.symbol.prims) || !sameJson(embedded.symbol.bbox, fresh.symbol.bbox)) changes.push({ kind: 'symbolChanged' });
      if ((embedded.footprint ?? '') !== (fresh.footprint ?? '')) changes.push({ kind: 'footprintChanged', from: embedded.footprint ?? '', to: fresh.footprint ?? '' });
      if (embedded.name !== fresh.name) changes.push({ kind: 'nameChanged', from: embedded.name, to: fresh.name });
      changes.push(...invalidOptions(after, placed));
      // other fields (description, keywords, user fields) changed: still a newer copy
      if (!changes.length) changes.push({ kind: 'modelChanged' });
      out.push({ partId, name: fresh.name, kind: 'custom', status: 'changed', instances, changes });
      continue;
    }
    const def = lookup(partId);
    if (!def) {
      out.push({ partId, name: placed[0].inst.refdes, kind: 'builtin', status: 'missing', instances, changes: [] });
      continue;
    }
    const changes: LibraryChange[] = [];
    const ref = design.libraryRefs?.[partId];
    if (ref && ref.sig !== partFingerprint(def)) {
      changes.push(...pinChanges(ref.pins, pinMap(def)), ...defaultChanges(ref.defaults, defaultsOf(def)));
      if (!changes.length) changes.push({ kind: 'modelChanged' });
    }
    // what the PLACED COPIES themselves show, whatever the design records. This is the only
    // honest comparison for a file written before `Design.libraryRefs` existed (a teacher's older
    // design), and stamping that baseline at load must not hide it, so it runs either way.
    {
      const known = new Set(changes.map((c) => `${c.kind}:${(c as { key?: string }).key ?? ''}`));
      for (const c of instanceParamChanges(def, placed)) if (!known.has(`${c.kind}:${c.key}`)) changes.push(c);
    }
    changes.push(...invalidOptions(def, placed));
    if (changes.length) out.push({ partId, name: def.name, kind: 'builtin', status: 'changed', instances, changes });
  }
  return out.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'missing' ? 1 : -1));
}

/** Move the ends of wires (and labels) that sat on moved pins, like Replace component. */
function followPins(sheet: Sheet, moves: Map<string, Point>): Sheet {
  if (!moves.size) return sheet;
  const wires = sheet.wires.map((w) => {
    if (w.bus || w.points.length < 2) return w;
    const [a, b] = wireEnds(w);
    const d0 = moves.get(pointKey(a)) ?? null;
    const d1 = moves.get(pointKey(b)) ?? null;
    if (!d0 && !d1) return w;
    return { ...w, points: rubberBandPoints(w.points, d0, d1) };
  });
  const labels = sheet.labels.map((l) => {
    const d = moves.get(pointKey(l));
    return d ? { ...l, x: l.x + d.x, y: l.y + d.y } : l;
  });
  return { ...sheet, wires, labels };
}

/** Pin moves of one placed copy from the pins `before` to the definition `after`. */
function movesFor(inst: PartInstance, before: Record<string, [number, number]>, after: PartDef, into: Map<string, Point>): void {
  const old: PartDef = { ...after, symbol: { ...after.symbol, pins: Object.entries(before).map(([name, [x, y]]) => ({ name, x, y })) } };
  const oldPins = instancePins(inst, old);
  const newPins = instancePins(inst, after);
  for (const op of oldPins) {
    const np = newPins.find((p) => p.name === op.name);
    if (np && !samePoint(np, op)) into.set(pointKey(op), { x: np.x - op.x, y: np.y - op.y });
  }
}

/** Instance parameters after an update: removed parameters and invalid choices go (default applies). */
function cleanParams(inst: PartInstance, def: PartDef, removed: ReadonlySet<string>): Record<string, string> | null {
  let next: Record<string, string> | null = null;
  for (const [k, v] of Object.entries(inst.params)) {
    const pd = def.params.find((p) => p.key === k);
    const invalid = pd?.kind === 'select' && !!pd.options?.length && !pd.options.some((o) => o.value === v);
    if ((removed.has(k) && !pd) || invalid) {
      next ??= { ...inst.params };
      delete next[k];
    }
  }
  return next;
}

/**
 * Update every placed copy of `partIds` (see the module header). Returns the new design (the same
 * object when nothing changed) and how many part kinds / placed copies were updated.
 */
export function updateFromLibrary(design: Design, partIds: Iterable<string>, lookup: PartLookup, dbLookup: CustomLookup): { design: Design; parts: number; instances: number } {
  const wanted = new Set(partIds);
  const placed = placedByPart(design);
  let next = design;
  let parts = 0;
  let instances = 0;
  const moves = new Map<string, Map<string, Point>>();
  const paramEdits = new Map<string, Record<string, string>>();
  const refs: Record<string, PartLibraryRef> = { ...(design.libraryRefs ?? {}) };
  let customParts = design.customParts;
  for (const partId of wanted) {
    const copies = placed.get(partId);
    if (!copies?.length) continue;
    let before: Record<string, [number, number]>;
    let after: PartDef | undefined;
    let removed: Set<string>;
    if (isCustomPartId(partId)) {
      const embedded = design.customParts?.find((c) => c.id === partId);
      const fresh = dbLookup(partId);
      after = lookup(partId);
      if (embedded && fresh && !sameJson(embedded, fresh)) {
        const oldDef = customPartDef(embedded);
        after = customPartDef(fresh);
        before = pinMap(oldDef);
        removed = new Set(oldDef.params.map((p) => p.key));
        customParts = (customParts ?? []).map((c) => (c.id === partId ? fresh : c));
      } else {
        if (!after) continue;
        before = pinMap(after);
        removed = new Set();
      }
    } else {
      after = lookup(partId);
      if (!after) continue;
      const ref = design.libraryRefs?.[partId];
      before = ref?.pins ?? pinMap(after);
      removed = new Set(Object.keys(ref?.defaults ?? {}));
      refs[partId] = libraryRef(after);
    }
    parts += 1;
    for (const c of copies) {
      const sheetMoves = moves.get(c.sheet.id) ?? new Map<string, Point>();
      movesFor(c.inst, before, after, sheetMoves);
      moves.set(c.sheet.id, sheetMoves);
      const p = cleanParams(c.inst, after, removed);
      if (p) paramEdits.set(c.inst.id, p);
      instances += 1;
    }
  }
  if (!parts) return { design, parts: 0, instances: 0 };
  next = { ...next, libraryRefs: refs };
  if (customParts !== design.customParts && customParts) next.customParts = customParts;
  if (!Object.keys(refs).length) delete next.libraryRefs;
  // the changed definitions resolve against the updated design (embedded copies)
  const embedded = new Map((next.customParts ?? []).map((c) => [c.id, c] as const));
  const lookupNow: PartLookup = (id) => {
    const c = embedded.get(id);
    return c ? customPartDef(c) : lookup(id);
  };
  const touched = new Set([...moves.keys(), ...[...placed.values()].flat().filter((x) => paramEdits.has(x.inst.id)).map((x) => x.sheet.id)]);
  for (const sheetId of touched) {
    next = updateSheet(next, sheetId, (s) => {
      const withParams = paramEdits.size ? { ...s, parts: s.parts.map((p) => (paramEdits.has(p.id) ? { ...p, params: paramEdits.get(p.id)! } : p)) } : s;
      return normalizeSheet(followPins(withParams, moves.get(sheetId) ?? new Map()), lookupNow);
    });
  }
  return { design: next, parts, instances };
}

/**
 * Open transform for files written before `Design.libraryRefs` existed: the reference of every
 * placed built-in part is stamped **in memory** from the library definition the program has now,
 * so Update components from library shows "up to date" instead of "nothing recorded" and a later
 * Save records a real baseline. A file that already carries references is returned unchanged, so
 * a design whose parts went stale still reports that.
 *
 * It only ever ADDS what the file lacked, never changes what it had: the differences the
 * placed copies themselves show (`instanceParamChanges`) are still reported, because
 * `compareWithLibrary` reads the instance parameters, not only the reference.
 */
export function stampLibraryRefsAtLoad(design: Design, lookup: PartLookup): Design {
  if (design.libraryRefs !== undefined) return design;
  return stampLibraryRefs(design, lookup);
}

/**
 * Save transform: references for the built-in parts the design uses that have none yet; references
 * of parts no longer used are dropped. Existing references stay (they record the definition the
 * placed copies were last updated to). Returns the same object when nothing changes.
 */
export function stampLibraryRefs(design: Design, lookup: PartLookup): Design {
  const used = new Set<string>();
  for (const s of [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)]) for (const p of s.parts) if (!isCustomPartId(p.partId) && !p.partId.startsWith('hier:')) used.add(p.partId);
  const old = design.libraryRefs ?? {};
  const refs: Record<string, PartLibraryRef> = {};
  let changed = false;
  for (const id of [...used].sort()) {
    if (old[id]) refs[id] = old[id];
    else {
      const def = lookup(id);
      if (!def) continue;
      refs[id] = libraryRef(def);
      changed = true;
    }
  }
  if (Object.keys(old).some((id) => !used.has(id))) changed = true;
  if (!changed) return design;
  const next = { ...design };
  if (Object.keys(refs).length) next.libraryRefs = refs;
  else delete next.libraryRefs;
  return next;
}
