/**
 * Part databases (database manager): the read-only master database is the built-in library; the
 * corporate and user databases hold user components (`PartDatabase`, types.ts). All functions are
 * pure (they return a new database), so the UI can keep history and tests can check them.
 *
 *   newDatabase(kind)                     empty database
 *   upsertPart / removePart / movePart     edit parts (upsert stamps `modified`)
 *   addFamily / renameFamily / removeFamily, addField / removeField / setPartField
 *   serializeDatabase / parseDatabase     `.msimdb` JSON (parse validates and throws DatabaseFormatError)
 *   mergeDatabases(target, incoming, policy)  import / merge ('newer' keeps the newer copy of an id,
 *                                         'replace' takes the incoming copy, 'keep' keeps the target's)
 *   slugify / uniquePartId                ids from names (Vietnamese letters become ASCII)
 *   partFromLibrary(def, ...)             copy a master part as a user component (same model,
 *                                         symbol and parameters; for "edit and save as new part")
 */
import { defaultParams } from '../index';
import type { PartDef, PartGroup } from '../types';
import { cloneSymbol } from './templates';
import { CUSTOM_PREFIX, type CustomPartData, type DatabaseFamily, type PartDatabase } from './types';
import { readCustomPart } from './validate';
import { isCustomPartDef } from './partDef';

export class DatabaseFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.length === 1 ? issues[0] : `${issues.length} problems: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '; …' : ''}`);
    this.name = 'DatabaseFormatError';
  }
}

export function newDatabase(kind: PartDatabase['kind'], name = kind === 'user' ? 'User' : 'Corporate'): PartDatabase {
  return { format: 'machsim-partdb', version: 1, kind, name, families: [], fields: [], parts: [] };
}

const stamp = (now?: string) => now ?? new Date().toISOString();

/** ASCII slug of a name: "Điốt Zener 5,6V" -> "diot-zener-5-6v". */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'part';
}

/** A `custom:` id for `name` that is not in `taken`. */
export function uniquePartId(name: string, taken: ReadonlySet<string>): string {
  const base = `${CUSTOM_PREFIX}${slugify(name)}`;
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(`${base}-${k}`)) return `${base}-${k}`;
}

/** Insert or replace a part (by id); stamps `modified`. */
export function upsertPart(db: PartDatabase, part: CustomPartData, now?: string): PartDatabase {
  const p = { ...part, modified: stamp(now) };
  const i = db.parts.findIndex((x) => x.id === part.id);
  const parts = i < 0 ? [...db.parts, p] : db.parts.map((x, k) => (k === i ? p : x));
  return { ...db, parts, modified: p.modified };
}

export function removePart(db: PartDatabase, id: string): PartDatabase {
  return db.parts.some((p) => p.id === id) ? { ...db, parts: db.parts.filter((p) => p.id !== id) } : db;
}

/** Move (or copy) a part to another database; returns both databases. */
export function movePart(from: PartDatabase, to: PartDatabase, id: string, copy = false, now?: string): { from: PartDatabase; to: PartDatabase } {
  const part = from.parts.find((p) => p.id === id);
  if (!part) return { from, to };
  return { from: copy ? from : removePart(from, id), to: upsertPart(to, part, now) };
}

const sameFamily = (a: DatabaseFamily, group: PartGroup, name: string) => a.group === group && a.name.toLowerCase() === name.trim().toLowerCase();

export function addFamily(db: PartDatabase, group: PartGroup, name: string): PartDatabase {
  const n = name.trim();
  if (!n || db.families.some((f) => sameFamily(f, group, n))) return db;
  return { ...db, families: [...db.families, { group, name: n }] };
}

/** Rename a family; parts of that family in that group follow. */
export function renameFamily(db: PartDatabase, group: PartGroup, from: string, to: string, now?: string): PartDatabase {
  const n = to.trim();
  if (!n) return db;
  const families = db.families.map((f) => (sameFamily(f, group, from) ? { ...f, name: n } : f));
  if (!families.some((f) => sameFamily(f, group, n))) families.push({ group, name: n });
  const parts = db.parts.map((p) => (p.group === group && p.family.toLowerCase() === from.trim().toLowerCase() ? { ...p, family: n, modified: stamp(now) } : p));
  return { ...db, families, parts };
}

/** Remove an empty family; `blocked` counts the parts still in it (nothing is removed then). */
export function removeFamily(db: PartDatabase, group: PartGroup, name: string): { db: PartDatabase; blocked: number } {
  const used = db.parts.filter((p) => p.group === group && p.family.toLowerCase() === name.trim().toLowerCase()).length;
  if (used) return { db, blocked: used };
  return { db: { ...db, families: db.families.filter((f) => !sameFamily(f, group, name)) }, blocked: 0 };
}

export function addField(db: PartDatabase, name: string): PartDatabase {
  const n = name.trim();
  if (!n || db.fields.some((f) => f.toLowerCase() === n.toLowerCase())) return db;
  return { ...db, fields: [...db.fields, n] };
}

/** Remove a user field and its values from every part. */
export function removeField(db: PartDatabase, name: string): PartDatabase {
  const parts = db.parts.map((p) => {
    if (!p.fields || !(name in p.fields)) return p;
    const fields = { ...p.fields };
    delete fields[name];
    return { ...p, fields };
  });
  return { ...db, fields: db.fields.filter((f) => f !== name), parts };
}

export function setPartField(db: PartDatabase, id: string, field: string, value: string, now?: string): PartDatabase {
  return {
    ...db,
    parts: db.parts.map((p) => (p.id === id ? { ...p, fields: { ...(p.fields ?? {}), [field]: value }, modified: stamp(now) } : p)),
  };
}

/** Families of a database: its declared families plus every family its parts use (sorted). */
export function databaseFamilies(db: PartDatabase): DatabaseFamily[] {
  const out: DatabaseFamily[] = [...db.families];
  for (const p of db.parts) if (!out.some((f) => sameFamily(f, p.group, p.family))) out.push({ group: p.group, name: p.family });
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export function serializeDatabase(db: PartDatabase): string {
  return JSON.stringify(db, null, 2);
}

/** Read a `.msimdb` file (or browser-storage text). Throws DatabaseFormatError with JSON paths. */
export function parseDatabase(text: string, kind?: PartDatabase['kind']): PartDatabase {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new DatabaseFormatError([`not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DatabaseFormatError(['the file does not contain a JSON object']);
  const o = raw as Record<string, unknown>;
  if (o.format !== 'machsim-partdb') throw new DatabaseFormatError([`not a MachSim part database (format is ${JSON.stringify(o.format)})`]);
  if (o.version !== 1) issues.push(`version: expected 1 (got ${JSON.stringify(o.version)})`);
  const k = kind ?? (o.kind === 'corporate' ? 'corporate' : 'user');
  const db = newDatabase(k, typeof o.name === 'string' && o.name.trim() ? o.name : undefined);
  if (Array.isArray(o.families)) {
    o.families.forEach((f, i) => {
      if (typeof f === 'object' && f !== null && typeof (f as DatabaseFamily).name === 'string' && typeof (f as DatabaseFamily).group === 'string') db.families.push({ group: (f as DatabaseFamily).group, name: (f as DatabaseFamily).name });
      else issues.push(`families[${i}]: expected { group, name }`);
    });
  }
  if (Array.isArray(o.fields)) o.fields.forEach((f, i) => (typeof f === 'string' ? db.fields.push(f) : issues.push(`fields[${i}]: expected text`)));
  if (!Array.isArray(o.parts)) issues.push('parts: expected an array');
  else {
    const seen = new Set<string>();
    o.parts.forEach((p, i) => {
      const part = readCustomPart(p, `parts[${i}]`, issues);
      if (!part) return;
      if (seen.has(part.id)) issues.push(`parts[${i}].id: duplicate id ${JSON.stringify(part.id)}`);
      seen.add(part.id);
      db.parts.push(part);
    });
  }
  if (typeof o.modified === 'string') db.modified = o.modified;
  if (issues.length) throw new DatabaseFormatError(issues);
  return db;
}

export type MergePolicy = 'newer' | 'replace' | 'keep';

export interface MergeResult {
  db: PartDatabase;
  added: number;
  updated: number;
  skipped: number;
}

/** Merge `incoming` into `target` (parts by id, families and fields by name). */
export function mergeDatabases(target: PartDatabase, incoming: PartDatabase, policy: MergePolicy = 'newer'): MergeResult {
  let db: PartDatabase = { ...target, parts: [...target.parts] };
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const p of incoming.parts) {
    const i = db.parts.findIndex((x) => x.id === p.id);
    if (i < 0) {
      db.parts.push(p);
      added += 1;
      continue;
    }
    const mine = db.parts[i];
    const take = policy === 'replace' || (policy === 'newer' && (p.modified ?? '') > (mine.modified ?? ''));
    if (take && JSON.stringify(mine) !== JSON.stringify(p)) {
      db.parts[i] = p;
      updated += 1;
    } else skipped += 1;
  }
  for (const f of incoming.families) db = addFamily(db, f.group, f.name);
  for (const f of incoming.fields) db = addField(db, f);
  return { db, added, updated, skipped };
}

/**
 * A user component that reuses a master-library part (same symbol, model and parameters; the
 * instance's parameter values become the new defaults). The wizard then lets the user redraw the
 * symbol or change the model and save it under a new name.
 */
export function partFromLibrary(def: PartDef, opts: { name?: string; params?: Record<string, string>; taken?: ReadonlySet<string> } = {}): CustomPartData {
  if (isCustomPartDef(def)) {
    const c = def.custom;
    const name = opts.name ?? c.name;
    return { ...c, id: uniquePartId(name, opts.taken ?? new Set([c.id])), name, symbol: cloneSymbol(c.symbol), modified: undefined };
  }
  const name = opts.name ?? def.name;
  const defaults = defaultParams(def);
  const changed: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) if (defaults[k] !== undefined && defaults[k] !== v) changed[k] = v;
  const pinMap: Record<string, string> = {};
  for (const p of def.symbol.pins) pinMap[p.name] = p.name;
  const part: CustomPartData = {
    id: uniquePartId(name, opts.taken ?? new Set()),
    name,
    group: def.group,
    family: def.family,
    description: def.description,
    prefix: def.prefix,
    symbol: cloneSymbol(def.symbol),
    model: { kind: 'builtin', partId: def.id, pinMap, ...(Object.keys(changed).length ? { params: changed } : {}) },
  };
  if (def.footprint) part.footprint = def.footprint;
  if (def.keywords?.length) part.keywords = [...def.keywords];
  return part;
}
