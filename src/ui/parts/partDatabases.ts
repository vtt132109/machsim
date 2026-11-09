/**
 * The corporate and user part databases at run time: loading and saving, registration in the
 * library registry (so the component browser lists the parts and getPart() finds them), and the
 * link to the open design (its embedded copies, the in-use list).
 *
 *   installPartDatabases(storage?)   load both databases once (async) and keep the registry in sync
 *   partDbStore / usePartDatabases() state { user, corporate, ready, error }
 *   commitDatabase(kind, next)       replace a database: persists, re-registers, refreshes the open
 *                                    design's copies of changed parts (one undo step)
 *   savePart(kind, part) / deletePart(kind, id) / findUserPart(id)
 *
 * Storage: the desktop app writes `partdb-user.json` / `partdb-corporate.json` in its user-data
 * folder through the bridge (readUserData / writeUserData); the browser keeps them in localStorage
 * under DB_KEYS. A database that cannot be read is kept aside (`error`) and never overwritten until
 * the user saves a change.
 *
 * Registry sources: 'db:user', 'db:corporate', 'design' (the open design's embedded copies) and
 * 'seen' (every component met in this session, so paste between designs keeps working).
 */
import { useSyncExternalStore } from 'react';
import { ensurePartsLoaded, getPart, registerRuntimeParts, runtimeParts } from '../../library';
import { customPartDef, isCustomPartDef } from '../../library/custom/partDef';
import { newDatabase, parseDatabase, removePart, serializeDatabase, upsertPart } from '../../library/custom/database';
import { refreshFromDatabase } from '../../library/custom/design';
import type { CustomPartData, PartDatabase } from '../../library/custom/types';
import type { Design } from '../../model/types';
import { getDesktopBridge } from '../../desktop/bridge';
import { createStore } from '../store/createStore';
import { browserStorage } from '../app/files';

export type DbKind = PartDatabase['kind'];

export const DB_KEYS: Readonly<Record<DbKind, string>> = { user: 'machsim.partdb.user.v1', corporate: 'machsim.partdb.corporate.v1' };

/** Where the databases are kept. */
export interface DbStorage {
  load(kind: DbKind): Promise<string | null>;
  save(kind: DbKind, text: string): Promise<void>;
}

export function memoryDbStorage(initial: Partial<Record<DbKind, string>> = {}): DbStorage & { data: Partial<Record<DbKind, string>> } {
  const data = { ...initial };
  return {
    data,
    load: async (kind) => data[kind] ?? null,
    save: async (kind, text) => {
      data[kind] = text;
    },
  };
}

/** Browser storage (localStorage), or memory when storage is unavailable. */
export function localDbStorage(): DbStorage {
  const ls = browserStorage();
  if (!ls) return memoryDbStorage();
  return {
    load: async (kind) => ls.getItem(DB_KEYS[kind]),
    save: async (kind, text) => ls.setItem(DB_KEYS[kind], text),
  };
}

/** Desktop user-data files, falling back to browser storage on older desktop builds. */
export function defaultDbStorage(): DbStorage {
  const bridge = getDesktopBridge();
  if (bridge?.readUserData && bridge.writeUserData) {
    const read = bridge.readUserData.bind(bridge);
    const write = bridge.writeUserData.bind(bridge);
    return { load: (kind) => read(`partdb-${kind}`), save: (kind, text) => write(`partdb-${kind}`, text) };
  }
  return localDbStorage();
}

export interface DbState {
  user: PartDatabase;
  corporate: PartDatabase;
  ready: boolean;
  /** databases that could not be read (kept untouched until the next save) */
  error?: Partial<Record<DbKind, string>>;
}

export const partDbStore = createStore<DbState>({ user: newDatabase('user'), corporate: newDatabase('corporate'), ready: false });

let storage: DbStorage | null = null;

function register(kind: DbKind, db: PartDatabase): void {
  registerRuntimeParts(`db:${kind}`, db.parts.map(customPartDef));
}

async function load(kind: DbKind, from: DbStorage): Promise<{ db: PartDatabase; error?: string }> {
  try {
    const text = await from.load(kind);
    if (!text) return { db: newDatabase(kind) };
    return { db: parseDatabase(text, kind) };
  } catch (e) {
    return { db: newDatabase(kind), error: e instanceof Error ? e.message : String(e) };
  }
}

let installing: Promise<void> | null = null;

/** Load the databases (once; later calls return the same promise). */
export function installPartDatabases(from: DbStorage = defaultDbStorage()): Promise<void> {
  if (installing) return installing;
  storage = from;
  installing = (async () => {
    const [u, c] = await Promise.all([load('user', from), load('corporate', from)]);
    // components reusing a library part of a catalogue pack need that pack before they are built
    await ensurePartsLoaded([...u.db.parts, ...c.db.parts].flatMap((p) => (p.model.kind === 'builtin' ? [p.model.partId] : [])));
    const error: Partial<Record<DbKind, string>> = {};
    if (u.error) error.user = u.error;
    if (c.error) error.corporate = c.error;
    partDbStore.setState({ user: u.db, corporate: c.db, ready: true, ...(Object.keys(error).length ? { error } : {}) });
    register('user', u.db);
    register('corporate', c.db);
  })();
  return installing;
}

/** Forget the loaded databases (tests). */
export function resetPartDatabases(): void {
  installing = null;
  storage = null;
  partDbStore.setState({ user: newDatabase('user'), corporate: newDatabase('corporate'), ready: false });
  registerRuntimeParts('db:user', []);
  registerRuntimeParts('db:corporate', []);
}

export function getDatabase(kind: DbKind): PartDatabase {
  return partDbStore.getState()[kind];
}

/** Hook: the database state (re-renders on change). */
export function usePartDatabases(): DbState {
  return useSyncExternalStore(partDbStore.subscribe, partDbStore.getState, partDbStore.getState);
}

/** Design-side hooks the database layer needs (installed by installDesignLink). */
interface DesignLink {
  getDesign(): Design;
  applyDesign(fn: (d: Design) => Design): void;
}
let designLink: DesignLink | null = null;

/** Replace a database: persist it, update the registry and the open design's copies of changed parts. */
export async function commitDatabase(kind: DbKind, next: PartDatabase): Promise<{ updatedInDesign: string[] }> {
  // (only waits when a component reuses a part of a catalogue pack that is not loaded yet)
  const reused = next.parts.flatMap((p) => (p.model.kind === 'builtin' && !getPart(p.model.partId) ? [p.model.partId] : []));
  if (reused.length) await ensurePartsLoaded(reused);
  const prev = partDbStore.getState();
  const error = { ...(prev.error ?? {}) };
  delete error[kind];
  partDbStore.setState({ ...prev, [kind]: next, ...(Object.keys(error).length ? { error } : { error: undefined }) });
  register(kind, next);
  if (storage) await storage.save(kind, serializeDatabase(next));
  let updatedInDesign: string[] = [];
  if (designLink) {
    const byId = new Map(next.parts.map((p) => [p.id, p] as const));
    const r = refreshFromDatabase(designLink.getDesign(), (id) => byId.get(id));
    if (r.updated.length) {
      updatedInDesign = r.updated;
      designLink.applyDesign((d) => refreshFromDatabase(d, (id) => byId.get(id)).design);
    }
  }
  return { updatedInDesign };
}

export function savePart(kind: DbKind, part: CustomPartData): Promise<{ updatedInDesign: string[] }> {
  return commitDatabase(kind, upsertPart(getDatabase(kind), part));
}

export function deletePart(kind: DbKind, id: string): Promise<{ updatedInDesign: string[] }> {
  return commitDatabase(kind, removePart(getDatabase(kind), id));
}

/** The database holding a user component (user first). */
export function findUserPart(id: string): { kind: DbKind; part: CustomPartData } | undefined {
  const s = partDbStore.getState();
  for (const kind of ['user', 'corporate'] as const) {
    const part = s[kind].parts.find((p) => p.id === id);
    if (part) return { kind, part };
  }
  return undefined;
}

/** Every user-component id known anywhere (databases, open design, this session). */
export function knownCustomIds(): Set<string> {
  const s = partDbStore.getState();
  const out = new Set<string>([...s.user.parts, ...s.corporate.parts].map((p) => p.id));
  for (const src of ['design', 'seen']) for (const d of runtimeParts(src)) out.add(d.id);
  for (const d of designLink?.getDesign().customParts ?? []) out.add(d.id);
  return out;
}

/**
 * Keep the registry's 'design' source equal to the open design's embedded components and add
 * them to 'seen'; refresh database copies into the design on commit. Returns the unsubscribe.
 */
export function installDesignLink(subscribe: (l: () => void) => () => void, link: DesignLink): () => void {
  designLink = link;
  let last: CustomPartData[] | undefined;
  const seen = new Map<string, CustomPartData>();
  const sync = () => {
    const parts = link.getDesign().customParts;
    if (parts === last) return;
    last = parts;
    const defs = (parts ?? []).map(customPartDef);
    registerRuntimeParts('design', defs);
    let grew = false;
    for (const p of parts ?? []) {
      if (seen.get(p.id) !== p) {
        seen.set(p.id, p);
        grew = true;
      }
    }
    if (grew) registerRuntimeParts('seen', [...seen.values()].map(customPartDef));
  };
  sync();
  const off = subscribe(sync);
  return () => {
    off();
    if (designLink === link) designLink = null;
  };
}

/** Data of a registered user component (any source), for the wizard's "edit" entry points. */
export function customDataOf(def: Parameters<typeof isCustomPartDef>[0]): CustomPartData | undefined {
  return isCustomPartDef(def) ? def.custom : undefined;
}
