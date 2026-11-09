/**
 * File-system and browser-storage primitives of the application shell.
 *
 * Pure helpers (file names, recent-file list, autosave records) take an injectable
 * {@link KeyValueStorage} so they are unit-testable; the I/O helpers pick the best available
 * mechanism at run time:
 *   1. the desktop bridge (Electron, src/desktop/bridge.ts) — real paths, OS dialogs;
 *   2. the File System Access API (Chromium) — file handles, save in place;
 *   3. plain web fallbacks — <input type="file"> for opening, a download for saving.
 */
import { getDesktopBridge } from '../../desktop/bridge';
import { t } from '../../i18n';

export const DESIGN_EXTENSION = '.msim';
export const AUTOSAVE_KEY = 'machsim.autosave.v1';
export const RECENT_KEY = 'machsim.recent.v1';
export const UI_PREFS_KEY = 'machsim.ui.v1';
export const MAX_RECENT = 8;
/** Recent entries keep a content snapshot (browser builds) only up to this many characters. */
export const MAX_RECENT_CONTENT = 200_000;

/** Subset of the Web Storage API (localStorage or a fake in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage when usable (private modes may throw), otherwise null. */
export function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__machsim_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function safeSet(storage: KeyValueStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false; // quota exceeded / storage disabled
  }
}

// ---------------------------------------------------------------------------
// file names
// ---------------------------------------------------------------------------

/** Append `ext` unless the name already ends with it (case-insensitive). */
export function ensureExtension(name: string, ext: string = DESIGN_EXTENSION): string {
  const n = name.trim() || 'Untitled';
  return n.toLowerCase().endsWith(ext.toLowerCase()) ? n : `${n}${ext}`;
}

/** File name of a document that was never saved (the editor's start-up / File > New name). */
export const UNTITLED_FILE_NAME = 'Untitled.msim';

/** The file name as shown in the window title and status bar: "Chưa đặt tên.msim" for a new document. */
export function displayFileName(fileName: string): string {
  return fileName.toLowerCase() === UNTITLED_FILE_NAME.toLowerCase() ? `${t('integration.reports.untitled')}${DESIGN_EXTENSION}` : fileName;
}

/** File name without directory and extension: "C:\\x\\Amp.msim" -> "Amp". */
export function baseName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(0, dot) : leaf;
}

/** File name derived from a design title: characters invalid on Windows replaced by "_". */
export function fileNameForTitle(title: string, ext: string = DESIGN_EXTENSION): string {
  const cleaned = title
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '');
  return ensureExtension(cleaned || 'Untitled', ext);
}

// ---------------------------------------------------------------------------
// recent files
// ---------------------------------------------------------------------------

export interface RecentEntry {
  /** display name (file name) */
  name: string;
  /** absolute path (desktop builds) */
  path?: string;
  openedAt: number;
  /** content snapshot used to reopen in browser builds (absent when too large) */
  content?: string;
}

function recentId(e: RecentEntry): string {
  return (e.path ?? e.name).toLowerCase();
}

/** Put `entry` first, drop older duplicates (same path, or same name without a path), cap the list. */
export function pushRecent(list: readonly RecentEntry[], entry: RecentEntry, max = MAX_RECENT): RecentEntry[] {
  const keepContent = entry.content !== undefined && entry.content.length <= MAX_RECENT_CONTENT;
  const e: RecentEntry = { name: entry.name, openedAt: entry.openedAt, ...(entry.path ? { path: entry.path } : {}), ...(keepContent ? { content: entry.content } : {}) };
  return [e, ...list.filter((x) => recentId(x) !== recentId(e))].slice(0, max);
}

export function readRecent(storage: KeyValueStorage | null): RecentEntry[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is RecentEntry =>
        typeof e === 'object' && e !== null && typeof (e as RecentEntry).name === 'string' && typeof (e as RecentEntry).openedAt === 'number',
    );
  } catch {
    return [];
  }
}

/** Persist the list; when storage is full the content snapshots are dropped and it is retried. */
export function writeRecent(storage: KeyValueStorage | null, list: readonly RecentEntry[]): void {
  if (!storage) return;
  if (safeSet(storage, RECENT_KEY, JSON.stringify(list))) return;
  const slim: RecentEntry[] = list.map((e) => ({ name: e.name, openedAt: e.openedAt, ...(e.path ? { path: e.path } : {}) }));
  safeSet(storage, RECENT_KEY, JSON.stringify(slim));
}

// ---------------------------------------------------------------------------
// recent projects (browser builds; the desktop shell keeps its own list of paths)
// ---------------------------------------------------------------------------

export const RECENT_PROJECT_KEY = 'machsim.recentProjects.v1';
export const MAX_RECENT_PROJECTS = 8;
/** Total characters a recent-project list may hold; above it the file snapshots are dropped. */
export const MAX_RECENT_PROJECT_CONTENT = 400_000;

/**
 * A project the learner had open. In the desktop build only `name` and `path` are kept (the shell
 * reads the folder again); in the browser there is no folder, so the entry carries the project
 * manifest and the text files of the project (the designs), which is what reopening it needs.
 * The snapshots are dropped when the list would grow past {@link MAX_RECENT_PROJECT_CONTENT},
 * so the list itself always survives.
 */
export interface RecentProject {
  /** project name (what the learner sees) */
  name: string;
  openedAt: number;
  /** project file path (desktop builds) */
  path?: string;
  /** serialised ProjectFile manifest (browser builds) */
  project?: string;
  /** text contents by relative path (browser builds; designs and other text files) */
  files?: Record<string, string>;
}

const projectId = (e: RecentProject): string => (e.path ?? e.name).toLowerCase();

/** Size of an entry, counting only what can be dropped. */
function projectContentSize(e: RecentProject): number {
  return (e.project?.length ?? 0) + Object.values(e.files ?? {}).reduce((n, v) => n + v.length, 0);
}

/** Put `entry` first, drop older duplicates, cap the list length. */
export function pushRecentProject(list: readonly RecentProject[], entry: RecentProject, max = MAX_RECENT_PROJECTS): RecentProject[] {
  const e: RecentProject = {
    name: entry.name,
    openedAt: entry.openedAt,
    ...(entry.path ? { path: entry.path } : {}),
    ...(entry.project !== undefined ? { project: entry.project } : {}),
    ...(entry.files && Object.keys(entry.files).length ? { files: entry.files } : {}),
  };
  return [e, ...list.filter((x) => projectId(x) !== projectId(e))].slice(0, max);
}

export function readRecentProjects(storage: KeyValueStorage | null): RecentProject[] {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(RECENT_PROJECT_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is RecentProject => typeof e === 'object' && e !== null && typeof (e as RecentProject).name === 'string' && typeof (e as RecentProject).openedAt === 'number');
  } catch {
    return [];
  }
}

/**
 * Persist the list under the size cap: the newest entries keep their snapshot, older ones lose
 * it once the budget is used up, and when the browser still refuses (quota) every snapshot goes.
 */
export function writeRecentProjects(storage: KeyValueStorage | null, list: readonly RecentProject[]): void {
  if (!storage) return;
  let budget = MAX_RECENT_PROJECT_CONTENT;
  const capped: RecentProject[] = list.map((e) => {
    const size = projectContentSize(e);
    if (size <= budget) {
      budget -= size;
      return e;
    }
    return { name: e.name, openedAt: e.openedAt, ...(e.path ? { path: e.path } : {}) };
  });
  if (safeSet(storage, RECENT_PROJECT_KEY, JSON.stringify(capped))) return;
  const slim = capped.map((e) => ({ name: e.name, openedAt: e.openedAt, ...(e.path ? { path: e.path } : {}) }));
  safeSet(storage, RECENT_PROJECT_KEY, JSON.stringify(slim));
}

// ---------------------------------------------------------------------------
// autosave
// ---------------------------------------------------------------------------

/** One autosaved document. */
export interface AutosaveDoc {
  fileName: string;
  /** ms since epoch */
  savedAt: number;
  /** serialised design */
  text: string;
}

/**
 * The crash-recovery record: the first document with unsaved changes in `fileName` / `text`, and
 * `others` for the remaining unsaved documents when several designs are open (document tabs). A
 * record written before document tabs existed has no `others` and reads as one document.
 */
export interface AutosaveRecord extends AutosaveDoc {
  others?: AutosaveDoc[];
}

/** The documents of a record, first one first. */
export function recordDocuments(rec: AutosaveRecord): AutosaveDoc[] {
  return [{ fileName: rec.fileName, savedAt: rec.savedAt, text: rec.text }, ...(rec.others ?? [])];
}

/** Parse the JSON of a recovery record (null for anything that is not one). */
export function parseAutosave(text: string | null): AutosaveRecord | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as (Partial<AutosaveRecord> & { others?: unknown }) | null;
    if (!raw || typeof raw.text !== 'string' || typeof raw.fileName !== 'string' || typeof raw.savedAt !== 'number') return null;
    const others = Array.isArray(raw.others)
      ? raw.others.filter((o): o is AutosaveDoc => !!o && typeof o.text === 'string' && typeof o.fileName === 'string' && typeof o.savedAt === 'number').map((o) => ({ fileName: o.fileName, savedAt: o.savedAt, text: o.text }))
      : [];
    return { fileName: raw.fileName, savedAt: raw.savedAt, text: raw.text, ...(others.length ? { others } : {}) };
  } catch {
    return null;
  }
}

export function writeAutosave(storage: KeyValueStorage | null, rec: AutosaveRecord): boolean {
  return storage ? safeSet(storage, AUTOSAVE_KEY, JSON.stringify(rec)) : false;
}

export function readAutosave(storage: KeyValueStorage | null): AutosaveRecord | null {
  if (!storage) return null;
  try {
    return parseAutosave(storage.getItem(AUTOSAVE_KEY));
  } catch {
    return null;
  }
}

export function clearAutosave(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(AUTOSAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// file I/O
// ---------------------------------------------------------------------------

/** Minimal typing of the File System Access API (not in lib.dom). */
interface FsWritable {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}
export interface FsFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}
interface FsPickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface FsAccessWindow {
  showOpenFilePicker?(opts: { types?: FsPickerType[]; multiple?: boolean; excludeAcceptAllOption?: boolean }): Promise<FsFileHandle[]>;
  showSaveFilePicker?(opts: { suggestedName?: string; types?: FsPickerType[] }): Promise<FsFileHandle>;
}

const DESIGN_TYPES: FsPickerType[] = [{ description: 'MachSim design', accept: { 'application/json': [DESIGN_EXTENSION, '.json'] } }];

function fsAccess(): FsAccessWindow | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as FsAccessWindow;
  return typeof w.showOpenFilePicker === 'function' ? w : null;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError');
}

/** Where an opened / saved document lives, so Save can write in place. */
export type FileTarget = { kind: 'desktop'; path: string } | { kind: 'handle'; handle: FsFileHandle };

export interface OpenedFile {
  name: string;
  /** UTF-8 text ('' for binary files) */
  text: string;
  target: FileTarget | null;
  /** binary files (snippet pictures, closed formats of other programs): the bytes */
  bytes?: Uint8Array;
  /** browser files: size in bytes and last-modified time (ms) for File > File information */
  size?: number;
  lastModified?: number;
}

/** Files read as bytes instead of text: snippet pictures and closed formats of other programs. */
export const BINARY_OPEN_RE = /\.(tdms|png|dsn|ms\d{1,2}|msm|utsch|msmx|mp14|mpzip|prz|mst1[34]|oecl|mspc|pcb3?)$/i;

/** Everything File > Open understands (browser file picker). */
export const OPEN_ACCEPT = [
  DESIGN_EXTENSION, '.json', '.xml', '.kicad_sch', '.sch', '.kicad_sym', '.edf', '.edif', '.edn', '.png', '.bak', '.msimtpl',
  '.cir', '.sp', '.spi', '.spice', '.net', '.ckt',
  '.dsn', '.ms14', '.ms13', '.ms12', '.ms11', '.ms10', '.ms9', '.ms8', '.ms7', '.utsch', '.msmx', '.mp14', '.mpzip', '.prz', '.mst14',
  // closed PCB-side formats: opening one only explains how to export a netlist (nothing is replaced)
  '.oecl', '.mspc', '.pcb', '.pcb3',
];

/** Read a browser File as an OpenedFile (bytes for binary formats, text otherwise). */
export async function openedFromFile(file: File, target: FileTarget | null = null): Promise<OpenedFile> {
  const base = { name: file.name, target, size: file.size, lastModified: file.lastModified };
  if (BINARY_OPEN_RE.test(file.name)) return { ...base, text: '', bytes: new Uint8Array(await file.arrayBuffer()) };
  return { ...base, text: await file.text() };
}

/** An opened desktop file as an OpenedFile (binary files arrive as base64). */
export function openedFromDesktop(f: { path: string; name: string; content: string; base64?: string }): OpenedFile {
  const target: FileTarget = { kind: 'desktop', path: f.path };
  if (f.base64 !== undefined) {
    const bin = atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { name: f.name, text: '', target, bytes };
  }
  return { name: f.name, text: f.content, target };
}

/** Let the user choose a text file. Resolves null when cancelled. */
export async function pickTextFile(accept: string[] = [DESIGN_EXTENSION, '.json']): Promise<OpenedFile | null> {
  const bridge = getDesktopBridge();
  if (bridge) {
    const f = await bridge.openFile({ title: t('app.files.openDesign'), spice: !accept.includes(DESIGN_EXTENSION) });
    return f ? openedFromDesktop(f) : null;
  }
  const fs = fsAccess();
  if (fs?.showOpenFilePicker && accept.includes(DESIGN_EXTENSION)) {
    try {
      // the picker only takes extensions of letters, digits, '+' and '.' (".kicad_sch" stays reachable
      // through its "All files" choice)
      const others = accept.filter((a) => a !== DESIGN_EXTENSION && a !== '.json' && /^\.[A-Za-z0-9+.]{1,15}$/.test(a));
      const types = others.length ? [...DESIGN_TYPES, { description: t('app.files.otherFormats'), accept: { 'application/octet-stream': others } }] : DESIGN_TYPES;
      const [handle] = await fs.showOpenFilePicker({ types, multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      return openedFromFile(file, { kind: 'handle', handle });
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  return pickWithInput(accept);
}

function pickWithInput(accept: string[]): Promise<OpenedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    let done = false;
    const finish = (v: OpenedFile | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      openedFromFile(file).then((f) => finish(f), (err: unknown) => {
        done = true;
        input.remove();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Let the user choose a binary file (snippet pictures …). Desktop: native dialog with `filter`;
 * browsers: a file input. Resolves null when cancelled.
 */
export async function pickBinaryFile(accept: string[], filter: { name: string; extensions: string[] }): Promise<OpenedFile | null> {
  const bridge = getDesktopBridge();
  if (bridge?.openBinaryFile) {
    const f = await bridge.openBinaryFile({ filters: [filter] });
    return f ? openedFromDesktop({ path: f.path, name: f.name, content: '', base64: f.base64 }) : null;
  }
  return pickWithInput(accept);
}

/** Write to an existing target (Save); `opts.backups` .bak copies are kept on the desktop. */
export async function writeToTarget(target: FileTarget, text: string, opts: { backups?: number } = {}): Promise<{ name: string; target: FileTarget }> {
  if (target.kind === 'desktop') {
    const bridge = getDesktopBridge();
    if (!bridge) throw new Error(t('app.files.theDesktopFileBridgeIs'));
    const r = opts.backups ? await bridge.writeFile(target.path, text, { backups: opts.backups }) : await bridge.writeFile(target.path, text);
    return { name: r.name, target: { kind: 'desktop', path: r.path } };
  }
  const w = await target.handle.createWritable();
  await w.write(text);
  await w.close();
  return { name: target.handle.name, target };
}

/**
 * Ask for a location and write (Save As). With neither the desktop bridge nor the File System
 * Access API the file is downloaded under `suggestedName` (target null). Resolves null when cancelled.
 */
export async function saveTextAs(text: string, suggestedName: string): Promise<{ name: string; target: FileTarget | null } | null> {
  const bridge = getDesktopBridge();
  if (bridge) {
    const r = await bridge.saveFileAs(text, { title: t('app.files.saveDesignAs'), suggestedName, extension: DESIGN_EXTENSION.slice(1), filterName: t('app.files.machsimDesign') });
    return r ? { name: r.name, target: { kind: 'desktop', path: r.path } } : null;
  }
  const fs = fsAccess();
  if (fs?.showSaveFilePicker) {
    try {
      const handle = await fs.showSaveFilePicker({ suggestedName, types: DESIGN_TYPES });
      return writeToTarget({ kind: 'handle', handle }, text);
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }
  downloadText(suggestedName, text, 'application/json');
  return { name: suggestedName, target: null };
}

/** Trigger a browser download of a blob. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  downloadBlob(name, new Blob([text], { type: `${mime};charset=utf-8` }));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Export a file (SVG, PNG, CSV ...): the desktop bridge shows a save dialog, browsers download it.
 * Resolves false when the user cancelled the desktop dialog.
 */
export async function exportFile(name: string, data: string | Blob, filter: { name: string; extensions: string[] }): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (bridge) {
    const r = await bridge.exportFile(
      typeof data === 'string' ? { title: t('app.files.export'), suggestedName: name, filters: [filter], text: data } : { title: t('app.files.export'), suggestedName: name, filters: [filter], base64: await blobToBase64(data) },
    );
    return r !== null;
  }
  if (typeof data === 'string') downloadText(name, data, filter.extensions.includes('svg') ? 'image/svg+xml' : 'text/plain');
  else downloadBlob(name, data);
  return true;
}
