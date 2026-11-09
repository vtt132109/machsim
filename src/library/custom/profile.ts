/**
 * "My library" profile (`.msimlib`, JSON): a learner's favourite parts, recently used parts and
 * user database (optionally the corporate one too) in one file, to carry between lab computers or
 * keep in a project (`library/my-library.msimlib`). Pure functions.
 *
 *   buildProfile(input)            the file object (format 'machsim-library-profile', version 1)
 *   serializeProfile / parseProfile   JSON text <-> validated profile (ProfileFormatError with paths;
 *                                  the embedded databases are validated like .msimdb files)
 *   mergeProfile(current, incoming, policy)
 *                                  favourites: union (current order first); recent: the imported
 *                                  list first, then the current one, without duplicates, at most
 *                                  `recentMax`; databases: mergeDatabases with the policy
 *                                  ('newer' keeps the newer copy of an id, 'replace', 'keep')
 */
import { mergeDatabases, parseDatabase, type MergePolicy, type MergeResult } from './database';
import type { PartDatabase } from './types';

export const PROFILE_FORMAT = 'machsim-library-profile';
export const PROFILE_VERSION = 1;
export const PROFILE_EXTENSION = '.msimlib';
/** Where a project keeps the profile (Project › Save my library into the project). */
export const PROJECT_PROFILE_PATH = 'library/my-library.msimlib';

export interface LibraryProfile {
  format: typeof PROFILE_FORMAT;
  version: typeof PROFILE_VERSION;
  /** program that wrote the file */
  savedBy?: string;
  /** ISO 8601 */
  created?: string;
  /** part ids */
  favourites: string[];
  /** part ids, most recent first */
  recent: string[];
  /** the user database (absent when not exported) */
  user?: PartDatabase;
  /** the corporate database (only when chosen) */
  corporate?: PartDatabase;
}

export class ProfileFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.length === 1 ? issues[0] : `${issues.length} problems: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '; …' : ''}`);
    this.name = 'ProfileFormatError';
  }
}

export interface ProfileInput {
  favourites?: readonly string[];
  recent?: readonly string[];
  user?: PartDatabase;
  corporate?: PartDatabase;
  savedBy?: string;
  now?: Date;
}

export function buildProfile(input: ProfileInput): LibraryProfile {
  const p: LibraryProfile = { format: PROFILE_FORMAT, version: PROFILE_VERSION, favourites: [...new Set(input.favourites ?? [])], recent: [...new Set(input.recent ?? [])] };
  if (input.savedBy) p.savedBy = input.savedBy;
  p.created = (input.now ?? new Date()).toISOString();
  if (input.user) p.user = input.user;
  if (input.corporate) p.corporate = input.corporate;
  return p;
}

export function serializeProfile(p: LibraryProfile): string {
  return JSON.stringify(p, null, 2);
}

function idList(o: Record<string, unknown>, key: string, issues: string[]): string[] {
  const v = o[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    issues.push(`${key}: expected an array of part ids`);
    return [];
  }
  const out: string[] = [];
  v.forEach((x, i) => {
    if (typeof x === 'string' && x.trim()) out.push(x);
    else issues.push(`${key}[${i}]: expected a part id`);
  });
  return [...new Set(out)];
}

/** Read a `.msimlib` file. Throws ProfileFormatError (JSON paths of the problems). */
export function parseProfile(text: string): LibraryProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProfileFormatError([`not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProfileFormatError(['the file does not contain a JSON object']);
  const o = raw as Record<string, unknown>;
  if (o.format !== PROFILE_FORMAT) throw new ProfileFormatError([`not a MachSim library profile (format is ${JSON.stringify(o.format)})`]);
  if (typeof o.version !== 'number' || o.version > PROFILE_VERSION) throw new ProfileFormatError([`version: this MachSim reads version ${PROFILE_VERSION} (got ${JSON.stringify(o.version)})`]);
  const issues: string[] = [];
  const p: LibraryProfile = { format: PROFILE_FORMAT, version: PROFILE_VERSION, favourites: idList(o, 'favourites', issues), recent: idList(o, 'recent', issues) };
  if (typeof o.savedBy === 'string') p.savedBy = o.savedBy;
  if (typeof o.created === 'string') p.created = o.created;
  for (const kind of ['user', 'corporate'] as const) {
    if (o[kind] === undefined || o[kind] === null) continue;
    try {
      p[kind] = parseDatabase(JSON.stringify(o[kind]), kind);
    } catch (e) {
      const list = e instanceof Error && 'issues' in e ? (e as { issues: string[] }).issues : [String(e)];
      for (const i of list) issues.push(`${kind}: ${i}`);
    }
  }
  if (issues.length) throw new ProfileFormatError(issues);
  return p;
}

export interface ProfileMerge {
  favourites: string[];
  recent: string[];
  user?: MergeResult;
  corporate?: MergeResult;
  /** favourites the import added */
  addedFavourites: number;
}

/** Merge an imported profile into the current lists and databases (see the module header). */
export function mergeProfile(
  current: { favourites: readonly string[]; recent: readonly string[]; user: PartDatabase; corporate: PartDatabase },
  incoming: LibraryProfile,
  policy: MergePolicy = 'newer',
  recentMax = 20,
): ProfileMerge {
  const favourites = [...current.favourites];
  let addedFavourites = 0;
  for (const id of incoming.favourites) {
    if (favourites.includes(id)) continue;
    favourites.push(id);
    addedFavourites += 1;
  }
  const recent = [...new Set([...incoming.recent, ...current.recent])].slice(0, recentMax);
  const out: ProfileMerge = { favourites, recent, addedFavourites };
  if (incoming.user) out.user = mergeDatabases(current.user, incoming.user, policy);
  if (incoming.corporate) out.corporate = mergeDatabases(current.corporate, incoming.corporate, policy);
  return out;
}

