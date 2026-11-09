/**
 * MachSim projects: a project file (.msimproj, JSON) lists several designs (.msim) and extra files
 * (datasheets, notes, SPICE models, pictures) by path relative to the project folder.
 *
 *   newProject(name)                         -> ProjectFile
 *   serializeProject / parseProject           -> JSON text <-> validated ProjectFile
 *   addProjectEntry / removeProjectEntry / renameProjectEntry / setMainDesign (pure updates)
 *   packProject(bundle) -> Uint8Array          one archive (.msimpack, a ZIP: project.msimproj at
 *                                              the root plus every listed file, plus
 *                                              components/user-components.msimdb: every user
 *                                              component the designs embed, as a part database)
 *   unpackProject(bytes) -> ProjectBundle      validates the manifest and every design; returns the
 *                                              packed user components (to merge into the user
 *                                              database) in `components`
 *
 * Paths are '/' separated, relative, without '..' and unique (case-insensitive, as on Windows).
 */
import { bytesText, textBytes, unzipFiles, zipFiles, ZipError } from '../util/zip';
import { DesignFormatError } from './serialize';
import { parseDesignSafely, type SanitizeNote } from './sanitize';
import type { CustomPartData } from '../library/custom/types';
import { newDatabase, parseDatabase, serializeDatabase } from '../library/custom/database';

export const PROJECT_EXTENSION = '.msimproj';
export const PACK_EXTENSION = '.msimpack';
/** Name of the manifest inside a packed archive. */
export const PACK_MANIFEST = 'project.msimproj';
/** The user components of a packed project (a .msimdb part database). */
export const PACK_COMPONENTS = 'components/user-components.msimdb';

/**
 * Every user component the designs of a bundle embed (Design.customParts), once per id: the copy
 * with the newest `modified` time wins.
 */
export function bundleComponents(bundle: ProjectBundle): CustomPartData[] {
  const byId = new Map<string, CustomPartData>();
  for (const d of bundle.project.designs) {
    const c = bundle.contents.get(d.path);
    if (c === undefined) continue;
    let parts: CustomPartData[] = [];
    try {
      parts = parseDesignSafely(typeof c === 'string' ? c : bytesText(c)).design.customParts ?? [];
    } catch {
      continue;
    }
    for (const p of parts) {
      const have = byId.get(p.id);
      if (!have || (p.modified ?? '') > (have.modified ?? '')) byId.set(p.id, p);
    }
  }
  return [...byId.values()];
}

export interface ProjectEntry {
  /** path relative to the project folder, '/' separated */
  path: string;
  /** shown instead of the file name (optional) */
  title?: string;
  note?: string;
}

export interface ProjectFile {
  format: 'machsim-project';
  version: 1;
  name: string;
  description?: string;
  /** ISO 8601 */
  created?: string;
  modified?: string;
  /** design files (.msim) */
  designs: ProjectEntry[];
  /** any other files */
  files: ProjectEntry[];
  /** path of the design opened first */
  main?: string;
}

/** A project with the contents of its files (text for designs, bytes or text for the rest). */
export interface ProjectBundle {
  project: ProjectFile;
  contents: Map<string, Uint8Array | string>;
}

export class ProjectFormatError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid MachSim project: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? ` (and ${issues.length - 5} more)` : ''}`);
    this.name = 'ProjectFormatError';
    this.issues = issues;
  }
}

export function newProject(name: string, now: Date = new Date()): ProjectFile {
  const iso = now.toISOString();
  return { format: 'machsim-project', version: 1, name: name.trim() || 'Project', created: iso, modified: iso, designs: [], files: [] };
}

/** Normalised relative path, or null when it is not a safe relative path. */
export function normalizeProjectPath(path: string): string | null {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((x) => x === '..' || x === '' || x === '.')) return null;
  if (/[<>:"|?*\u0000-\u001f]/.test(p)) return null;
  return p;
}

export function isDesignPath(path: string): boolean {
  return /\.msim$/i.test(path);
}

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2);
}

/** Parse and validate a project file (throws ProjectFormatError listing every problem). */
export function parseProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectFormatError([`not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProjectFormatError(['the file does not contain a JSON object']);
  const o = raw as Record<string, unknown>;
  if (o.format !== 'machsim-project') throw new ProjectFormatError([`Not a MachSim project (format is ${JSON.stringify(o.format)})`]);
  if (o.version !== 1) issues.push(`version: expected 1 (got ${JSON.stringify(o.version)})`);
  const str = (k: string, required = false): string | undefined => {
    const v = o[k];
    if (v === undefined || v === null) {
      if (required) issues.push(`${k}: is required`);
      return undefined;
    }
    if (typeof v !== 'string') {
      issues.push(`${k}: expected text`);
      return undefined;
    }
    return v;
  };
  const seen = new Set<string>();
  const entries = (k: 'designs' | 'files'): ProjectEntry[] => {
    const v = o[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      issues.push(`${k}: expected an array`);
      return [];
    }
    const out: ProjectEntry[] = [];
    v.forEach((e, i) => {
      if (typeof e !== 'object' || e === null) {
        issues.push(`${k}[${i}]: expected an object`);
        return;
      }
      const r = e as Record<string, unknown>;
      const path = typeof r.path === 'string' ? normalizeProjectPath(r.path) : null;
      if (!path) {
        issues.push(`${k}[${i}].path: must be a relative path inside the project folder (got ${JSON.stringify(r.path)})`);
        return;
      }
      if (k === 'designs' && !isDesignPath(path)) issues.push(`${k}[${i}].path: a design must be a .msim file (got "${path}")`);
      if (seen.has(path.toLowerCase())) issues.push(`${k}[${i}].path: "${path}" is listed twice`);
      seen.add(path.toLowerCase());
      const entry: ProjectEntry = { path };
      if (typeof r.title === 'string') entry.title = r.title;
      if (typeof r.note === 'string') entry.note = r.note;
      out.push(entry);
    });
    return out;
  };
  const p: ProjectFile = { format: 'machsim-project', version: 1, name: str('name', true) ?? '', designs: entries('designs'), files: entries('files') };
  for (const k of ['description', 'created', 'modified', 'main'] as const) {
    const v = str(k);
    if (v !== undefined) p[k] = v;
  }
  if (p.main && !p.designs.some((d) => d.path.toLowerCase() === p.main!.toLowerCase())) issues.push(`main: "${p.main}" is not one of the project's designs`);
  if (issues.length) throw new ProjectFormatError(issues);
  return p;
}

/** Add a design (.msim) or another file; returns the project unchanged when the path is taken. */
export function addProjectEntry(p: ProjectFile, entry: ProjectEntry, now: Date = new Date()): ProjectFile {
  const path = normalizeProjectPath(entry.path);
  if (!path) throw new ProjectFormatError([`"${entry.path}" is not a relative path inside the project folder`]);
  if ([...p.designs, ...p.files].some((e) => e.path.toLowerCase() === path.toLowerCase())) return p;
  const e = { ...entry, path };
  const next: ProjectFile = isDesignPath(path) ? { ...p, designs: [...p.designs, e] } : { ...p, files: [...p.files, e] };
  if (isDesignPath(path) && !next.main) next.main = path;
  next.modified = now.toISOString();
  return next;
}

export function removeProjectEntry(p: ProjectFile, path: string, now: Date = new Date()): ProjectFile {
  const k = path.toLowerCase();
  const designs = p.designs.filter((d) => d.path.toLowerCase() !== k);
  const files = p.files.filter((f) => f.path.toLowerCase() !== k);
  if (designs.length === p.designs.length && files.length === p.files.length) return p;
  const next: ProjectFile = { ...p, designs, files, modified: now.toISOString() };
  if (next.main?.toLowerCase() === k) {
    if (designs[0]) next.main = designs[0].path;
    else delete next.main;
  }
  return next;
}

export function renameProjectEntry(p: ProjectFile, from: string, to: string, now: Date = new Date()): ProjectFile {
  const target = normalizeProjectPath(to);
  if (!target) throw new ProjectFormatError([`"${to}" is not a relative path inside the project folder`]);
  const k = from.toLowerCase();
  if ([...p.designs, ...p.files].some((e) => e.path.toLowerCase() === target.toLowerCase() && e.path.toLowerCase() !== k)) throw new ProjectFormatError([`"${target}" is already in the project`]);
  const ren = (e: ProjectEntry) => (e.path.toLowerCase() === k ? { ...e, path: target } : e);
  const next: ProjectFile = { ...p, designs: p.designs.map(ren), files: p.files.map(ren), modified: now.toISOString() };
  if (next.main?.toLowerCase() === k) next.main = target;
  return next;
}

export function setMainDesign(p: ProjectFile, path: string): ProjectFile {
  return p.designs.some((d) => d.path === path) && p.main !== path ? { ...p, main: path } : p;
}

/** Every path of the project (designs first). */
export function projectPaths(p: ProjectFile): string[] {
  return [...p.designs.map((d) => d.path), ...p.files.map((f) => f.path)];
}

/**
 * Pack a project into one archive: the manifest as `project.msimproj` plus every listed file
 * found in `contents` (missing files are reported in the result and left out).
 */
export function packProject(bundle: ProjectBundle, now: Date = new Date()): { bytes: Uint8Array; missing: string[]; components: number } {
  const missing: string[] = [];
  const entries = [{ name: PACK_MANIFEST, data: textBytes(serializeProject(bundle.project)), date: now }];
  for (const path of projectPaths(bundle.project)) {
    const c = bundle.contents.get(path);
    if (c === undefined) {
      missing.push(path);
      continue;
    }
    entries.push({ name: path, data: typeof c === 'string' ? textBytes(c) : c, date: now });
  }
  const parts = bundleComponents(bundle);
  if (parts.length && !projectPaths(bundle.project).some((p) => p.toLowerCase() === PACK_COMPONENTS)) {
    const db = { ...newDatabase('user', bundle.project.name), parts, modified: now.toISOString() };
    entries.push({ name: PACK_COMPONENTS, data: textBytes(serializeDatabase(db)), date: now });
  }
  return { bytes: zipFiles(entries), missing, components: parts.length };
}

/**
 * Unpack an archive made by packProject (or any ZIP holding one .msimproj at its root): validates
 * the manifest, checks that every listed file is present and that every design parses. Files in
 * the archive that the project does not list are kept in `contents` too (`extra`).
 */
export async function unpackProject(bytes: Uint8Array): Promise<ProjectBundle & { extra: string[]; components: CustomPartData[]; notes: SanitizeNote[] }> {
  let entries;
  try {
    entries = await unzipFiles(bytes);
  } catch (e) {
    throw new ProjectFormatError([e instanceof ZipError ? e.message : String(e)]);
  }
  const manifest = entries.find((e) => e.name === PACK_MANIFEST) ?? entries.find((e) => !e.name.includes('/') && e.name.toLowerCase().endsWith(PROJECT_EXTENSION));
  if (!manifest) throw new ProjectFormatError([`the archive has no project file (${PACK_MANIFEST})`]);
  const project = parseProject(bytesText(manifest.data));
  const contents = new Map<string, Uint8Array | string>();
  const issues: string[] = [];
  const notes: SanitizeNote[] = [];
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  for (const d of project.designs) {
    const e = byName.get(d.path.toLowerCase());
    if (!e) {
      issues.push(`design "${d.path}" is missing from the archive`);
      continue;
    }
    const text = bytesText(e.data);
    try {
      // the integrity layer repairs design-scoped references (assembly variants, blocks, net
      // settings) so one hand-edited design cannot stop the whole project from opening
      for (const n of parseDesignSafely(text).notes) notes.push(n);
    } catch (err) {
      issues.push(`design "${d.path}": ${err instanceof DesignFormatError ? err.issues[0] : String(err)}`);
      continue;
    }
    contents.set(d.path, text);
  }
  for (const f of project.files) {
    const e = byName.get(f.path.toLowerCase());
    if (!e) issues.push(`file "${f.path}" is missing from the archive`);
    else contents.set(f.path, e.data);
  }
  if (issues.length) throw new ProjectFormatError(issues);
  const listed = new Set([PACK_MANIFEST, manifest.name, ...projectPaths(project)].map((x) => x.toLowerCase()));
  const extra: string[] = [];
  let components: CustomPartData[] = [];
  for (const e of entries) {
    if (e.name.toLowerCase() === PACK_COMPONENTS) {
      try {
        components = parseDatabase(bytesText(e.data), 'user').parts;
      } catch {
        // a damaged component list does not stop the project from opening (designs embed their parts)
        components = [];
      }
    }
    if (listed.has(e.name.toLowerCase())) continue;
    const path = normalizeProjectPath(e.name);
    if (!path) continue;
    extra.push(path);
    contents.set(path, e.data);
  }
  return { project, contents, extra, components, notes };
}
