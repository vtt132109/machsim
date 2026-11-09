/**
 * Library registry (CONTRACT API — library team may extend, must keep these exports).
 *
 * The built-in (master) parts are the hand-written parts and the core catalogue (static, loaded at
 * start-up), plus **catalogue packs**: big standard-value and part-number tables (diodes,
 * transistors, logic families, resistor / capacitor series by package, connectors, RF) that are
 * code-split and loaded on demand (`registerCataloguePack`, `loadGroup`, `loadAllGroups`,
 * `ensurePartsLoaded`). A pack loads once — the first time one of its groups is opened, the
 * catalogue is searched, or a design that uses one of its parts is opened — and its parts then
 * join the built-in list for good (getPart stays synchronous). Part ids start with their group
 * ('diodes/1n4001'), so the pack a design needs follows from its part ids.
 *
 * User components (component wizard, part databases, the components embedded in the open design)
 * are added at run time with `registerRuntimeParts(source, defs)`: each source (e.g. 'db:user',
 * 'db:corporate', 'design') replaces its own list. Lookups try the built-in parts first, then the
 * runtime sources in registration priority (see SOURCE_ORDER); `listParts()` returns the built-in
 * parts (core, then the loaded packs in registration order) followed by the runtime parts (first
 * source wins for a duplicated id). `subscribeLibrary` / `libraryVersion` let views refresh when
 * the list changes (a pack finished loading, a database changed).
 */
import type { GroupDef, PartDef, PartGroup } from './types';
import { ALL_PARTS } from './parts';
import { CATALOGUE_PACKS } from './catalog';
import { setPartTextResolver } from '../i18n/library';

export const GROUPS: GroupDef[] = [
  { id: 'sources', name: 'Sources', order: 0 },
  { id: 'basic', name: 'Basic', order: 1 },
  { id: 'diodes', name: 'Diodes', order: 2 },
  { id: 'transistors', name: 'Transistors', order: 3 },
  { id: 'analog', name: 'Analog', order: 4 },
  { id: 'ttl', name: 'TTL', order: 5 },
  { id: 'cmos', name: 'CMOS', order: 6 },
  { id: 'misc-digital', name: 'Misc Digital', order: 7 },
  { id: 'mixed', name: 'Mixed', order: 8 },
  { id: 'indicators', name: 'Indicators', order: 9 },
  { id: 'power', name: 'Power', order: 10 },
  { id: 'misc', name: 'Misc', order: 11 },
  { id: 'rf', name: 'RF', order: 12 },
  { id: 'electromechanical', name: 'Electromechanical', order: 13 },
  { id: 'connectors', name: 'Connectors', order: 14 },
  { id: 'instruments', name: 'Instruments', order: 15 },
];

const byId = new Map<string, PartDef>();
for (const p of ALL_PARTS) byId.set(p.id, p);

// ---------------------------------------------------------------------------------------------
// catalogue packs (built-in parts loaded on demand)

/**
 * A code-split part of the built-in catalogue. `load` returns the pack's parts (a dynamic import);
 * parts whose id is already known (hand-written or core catalogue) are dropped, so `count` is the
 * numbers of parts the pack adds (`counts`, per group) — the component browser shows them before
 * the pack is loaded, and a test checks them against the loaded list.
 */
export interface CataloguePack {
  /** unique pack id, e.g. 'diodes' */
  id: string;
  /**
   * Number of parts the pack adds to each of its groups (it loads on the first open of any of
   * them); the component browser counts them in before the pack is loaded.
   */
  counts: Partial<Record<PartGroup, number>>;
  load(): Promise<readonly PartDef[]>;
}

/** Load state of a pack (or of a group: the state of its packs taken together). */
export type PackState = 'pending' | 'loading' | 'ready' | 'error';

interface PackEntry {
  pack: CataloguePack;
  state: PackState;
  parts: PartDef[];
  promise: Promise<void> | null;
  error?: string;
  /** how many times `load` was called (tests: a pack loads once) */
  loads: number;
}

const packs: PackEntry[] = [];

/** The built-in parts: hand-written + core catalogue, then the loaded packs in registration order. */
let builtin: PartDef[] = ALL_PARTS;

// ---------------------------------------------------------------------------------------------
// run-time parts (user components)

/**
 * Lookup priority of the run-time sources: the open design's embedded copies win, then the user and
 * corporate databases, then components met earlier in the session ('seen', e.g. for paste).
 */
const SOURCE_ORDER = ['design', 'db:user', 'db:corporate', 'seen'];

const runtime = new Map<string, PartDef[]>();
let runtimeById = new Map<string, PartDef>();
let listed: PartDef[] = ALL_PARTS;
let version = 0;
const listeners = new Set<() => void>();

function sourceRank(source: string): number {
  const i = SOURCE_ORDER.indexOf(source);
  return i < 0 ? SOURCE_ORDER.length : i;
}

function rebuild(): void {
  const sources = [...runtime.keys()].sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
  const next = new Map<string, PartDef>();
  for (const s of sources) for (const d of runtime.get(s) ?? []) if (!byId.has(d.id) && !next.has(d.id)) next.set(d.id, d);
  runtimeById = next;
  listed = next.size ? [...builtin, ...next.values()] : builtin;
  version += 1;
  for (const l of Array.from(listeners)) l();
}

/**
 * Add a catalogue pack (load on demand). Registering an id twice throws. A pack whose groups are
 * opened later loads then; nothing is loaded here.
 */
export function registerCataloguePack(pack: CataloguePack): void {
  if (packs.some((e) => e.pack.id === pack.id)) throw new Error(`catalogue pack ${pack.id} is already registered`);
  packs.push({ pack, state: 'pending', parts: [], promise: null, loads: 0 });
}

/** Every registered pack with its state (component browser, tests). */
export function cataloguePacks(): readonly { id: string; groups: PartGroup[]; counts: Partial<Record<PartGroup, number>>; state: PackState; loaded: number; loads: number; error?: string }[] {
  return packs.map((e) => ({ id: e.pack.id, groups: packGroups(e.pack), counts: e.pack.counts, state: e.state, loaded: e.parts.length, loads: e.loads, ...(e.error ? { error: e.error } : {}) }));
}

function packGroups(pack: CataloguePack): PartGroup[] {
  return Object.keys(pack.counts) as PartGroup[];
}

const holds = (e: PackEntry, group: string): boolean => (e.pack.counts as Record<string, number | undefined>)[group] !== undefined;

function rebuildBuiltin(): void {
  const extra = packs.filter((e) => e.state === 'ready' && e.parts.length);
  builtin = extra.length ? [...ALL_PARTS, ...extra.flatMap((e) => e.parts)] : ALL_PARTS;
}

function loadEntry(e: PackEntry): Promise<void> {
  if (e.state === 'ready') return Promise.resolve();
  if (e.promise) return e.promise;
  e.state = 'loading';
  e.loads += 1;
  delete e.error;
  version += 1;
  for (const l of Array.from(listeners)) l();
  e.promise = (async () => {
    try {
      const defs = await e.pack.load();
      const added: PartDef[] = [];
      for (const d of defs) {
        if (byId.has(d.id)) continue;
        byId.set(d.id, d);
        added.push(d);
      }
      e.parts = added;
      e.state = 'ready';
    } catch (err) {
      e.state = 'error';
      e.error = err instanceof Error ? err.message : String(err);
    } finally {
      e.promise = null;
      rebuildBuiltin();
      rebuild();
    }
  })();
  return e.promise;
}

/** Load one pack (once; concurrent calls share the load). Resolves when it is ready or failed. */
export function loadPack(id: string): Promise<void> {
  const e = packs.find((x) => x.pack.id === id);
  return e ? loadEntry(e) : Promise.resolve();
}

/** Load every pack holding parts of `group` (the component browser calls it when the group opens). */
export async function loadGroup(group: string): Promise<void> {
  await Promise.all(packs.filter((e) => holds(e, group)).map(loadEntry));
}

/**
 * Load every pack that is not loaded yet, one after the other (the browser stays responsive
 * between packs). Search over the whole catalogue and the database manager use it.
 */
export async function loadAllGroups(): Promise<void> {
  for (const e of packs) if (e.state !== 'ready') await loadEntry(e);
}

/** 'ready' when every pack of the group is loaded (or it has none), else the least advanced state. */
export function groupState(group: string): PackState {
  const own = packs.filter((e) => holds(e, group));
  if (own.some((e) => e.state === 'loading')) return 'loading';
  if (own.some((e) => e.state === 'error')) return 'error';
  if (own.some((e) => e.state === 'pending')) return 'pending';
  return 'ready';
}

/** True when some pack is not loaded yet (search results may grow). */
export function hasPendingPacks(): boolean {
  return packs.some((e) => e.state !== 'ready');
}

/** Parts of packs that are not loaded yet, per group (shown in group counts before loading). */
export function pendingPartCount(group: string): number {
  let n = 0;
  for (const e of packs) if (e.state !== 'ready') n += (e.pack.counts as Record<string, number | undefined>)[group] ?? 0;
  return n;
}

/** Group of a library part id ('diodes/1n4001' → 'diodes'); null for user components and blocks. */
export function groupOfPartId(id: string): string | null {
  if (id.startsWith('custom:') || id.startsWith('hier:')) return null;
  const i = id.indexOf('/');
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * Make sure the parts `ids` can be looked up: loads the packs of the groups of unknown ids.
 * Resolves with the ids that are still unknown (not in any pack either).
 */
export async function ensurePartsLoaded(ids: Iterable<string>): Promise<string[]> {
  const missing = [...new Set(ids)].filter((id) => !getPart(id));
  if (!missing.length) return [];
  const groups = new Set(missing.map(groupOfPartId).filter((g): g is string => !!g));
  await Promise.all([...groups].map(loadGroup));
  return missing.filter((id) => !getPart(id));
}

for (const pack of CATALOGUE_PACKS) registerCataloguePack(pack);

/**
 * Replace the run-time parts of one source ('db:user', 'db:corporate', 'design', ...). Parts whose
 * id is a built-in id are ignored. Notifies subscribers when anything changed.
 */
export function registerRuntimeParts(source: string, defs: readonly PartDef[]): void {
  const prev = runtime.get(source) ?? [];
  if (prev.length === defs.length && prev.every((d, i) => d === defs[i])) return;
  if (defs.length) runtime.set(source, [...defs]);
  else runtime.delete(source);
  rebuild();
}

/** Run-time parts of one source (empty when none are registered). */
export function runtimeParts(source: string): readonly PartDef[] {
  return runtime.get(source) ?? [];
}

/** Changes whenever the run-time part list changes (for React's useSyncExternalStore). */
export function libraryVersion(): number {
  return version;
}

/** Subscribe to run-time part changes; returns the unsubscribe function. */
export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------------------------
// lookups

export function listParts(): PartDef[] {
  return listed;
}

export function getPart(id: string): PartDef | undefined {
  return byId.get(id) ?? runtimeById.get(id);
}

// Vietnamese names and descriptions of a part found by id (see src/i18n/library.ts)
setPartTextResolver(getPart);

/** True for the parts shipped with MachSim (the read-only master database). */
export function isBuiltinPart(id: string): boolean {
  return byId.has(id);
}

export function partsInGroup(group: PartGroup): PartDef[] {
  return listed.filter((p) => p.group === group);
}

/** Ranked search over the loaded parts (the part browser's), installed by src/ui/editor/browserModel.ts. */
type PartSearcher = (parts: readonly PartDef[], query: string) => PartDef[];
let partSearcher: PartSearcher | null = null;

export function setPartSearcher(fn: PartSearcher | null): void {
  partSearcher = fn;
}

/**
 * Parts matching a query, best first. Uses the part browser's search when the UI layer installed it
 * (Vietnamese words with or without accents, values such as "10k", ranking), else {@link substringParts}.
 */
export function searchParts(query: string): PartDef[] {
  const q = query.trim();
  if (!q) return listed;
  return partSearcher ? partSearcher(listed, q) : substringParts(q);
}

/** Parts whose id, name, family, description or keywords contain the text (unranked, English only). */
export function substringParts(query: string): PartDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return listed;
  return listed.filter((p) =>
    [p.id, p.name, p.family, p.description, ...(p.keywords ?? [])].some((s) => s.toLowerCase().includes(q)),
  );
}

/** Default params of a part as text. */
export function defaultParams(part: PartDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of part.params) out[d.key] = d.default;
  return out;
}
