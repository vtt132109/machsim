/**
 * Document lifecycle of the shell: new / open / save / save as / recent files / export (printing is in
 * src/ui/print), periodic autosave to the recovery slot with a prompt after an unclean exit (recovery.ts), and the
 * desktop-bridge integration (window title, dirty flag, files opened from the OS).
 *
 * Open: openOpenedFile() hands non-.msim files (MachSim XML, KiCad, EDIF, snippet pictures,
 * backups, closed formats of other programs) to {@link otherFormatHandler} (installed by
 * src/ui/files, which loads the importers lazily) and SPICE decks to {@link spiceFileHandler}.
 * Save: every save stamps Design.meta (created / modified / savedBy), applies the registered
 * {@link registerSaveTransform} hooks (Grapher pages kept with the design) and, on the desktop,
 * keeps the number of .bak copies chosen in Options > File options.
 *
 * Every function reports problems with a dialog instead of throwing.
 *
 * Several designs can be open at once (documents.ts): opening, importing or generating a design
 * puts it in a new document tab (an untouched start-up design is replaced instead), so opening
 * never discards anything. This module keeps what belongs to the *current* document next to the
 * editor store (where the document was opened from) and registers it as a document extension, so
 * every tab remembers its own file. Closing documents, Save all and the quit question are in
 * documentFlows.ts. Autosave writes ONE recovery record holding every document with unsaved
 * changes.
 */
import { DesignFormatError, serializeDesign } from '../../model/serialize';
import { parseDesignSafely } from '../../model/sanitize';
import { sanitizeReport } from '../../i18n/sanitize';
import type { Design } from '../../model/types';
import { designPartsReady } from '../../model/libraryLoad';
import { SAVED_BY } from '../../model/appInfo';
import { browserRecoveryStore, desktopRecoveryStore, HEARTBEAT_MS, recoveryDecision, type PreviousSession, type RecoveryStore } from './recovery';
import { getDesktopBridge } from '../../desktop/bridge';
import { actions, getState, isDirty, partLookup, subscribe } from '../store';
import { newLocalizedDesign } from '../store/editorStore';
import { documents } from './documentSet';
import { createStore } from '../store/createStore';
import { activeSheet } from '../store/editorStore';
import { alertDialog, choiceDialog, promptText } from '../common/dialogs';
import {
  baseName,
  browserStorage,
  displayFileName,
  ensureExtension,
  exportFile,
  fileNameForTitle,
  OPEN_ACCEPT,
  openedFromDesktop,
  pickTextFile,
  pushRecent,
  readRecent,
  readRecentProjects,
  saveTextAs,
  writeRecent,
  writeToTarget,
  recordDocuments,
  type AutosaveDoc,
  type AutosaveRecord,
  type FileTarget,
  type OpenedFile,
  type RecentEntry,
} from './files';
import { localeTag, t } from '../../i18n';

/** Where the current document was opened from / saved to (null = never saved, or download only). */
let target: FileTarget | null = null;

/** Browser files: size and last-modified time of the opened file (File > File information). */
let openedStat: { size?: number; lastModified?: number } | null = null;

// Document tabs: each document remembers the file it came from. A document that was never saved
// and holds nothing counts as "just the start-up design" and is replaced by the next one opened.
documents.registerExtension({
  id: 'file',
  capture: () => ({ target, openedStat }),
  restore: (d) => {
    const v = d as { target: FileTarget | null; openedStat: { size?: number; lastModified?: number } | null } | undefined;
    target = v?.target ?? null;
    openedStat = v?.openedStat ?? null;
  },
});
documents.setReplaceable(() => target === null);

/** Desktop files that are open, by document id: opening the same file again shows its tab instead of opening a copy. */
const openPaths = new Map<string, string>();

/** The open document that holds this desktop file, if any. */
function documentOfPath(path: string): string | undefined {
  const live = new Set(documents.list().map((d) => d.id));
  for (const [id, p] of openPaths) if (live.has(id) && p.toLowerCase() === path.toLowerCase()) return id;
  return undefined;
}

/** Where the current document lives, for File > File information. */
export function currentFileTarget(): FileTarget | null {
  return target;
}

/** Size / modification time of the file the browser opened (null after a save or for new documents). */
export function currentOpenedStat(): { size?: number; lastModified?: number } | null {
  return openedStat;
}

/** Called with every design that becomes the document by opening (file, sample, import, recovery). */
const loadListeners = new Set<(d: Design) => void>();

/** Listen to documents being opened (e.g. to restore the Grapher pages kept in the file). */
export function onDocumentLoaded(fn: (d: Design) => void): () => void {
  loadListeners.add(fn);
  return () => loadListeners.delete(fn);
}

function documentLoaded(d: Design): void {
  for (const fn of [...loadListeners]) {
    try {
      fn(d);
    } catch (err) {
      console.error('document listener failed', err);
    }
  }
}

/** Save-time transforms (e.g. the Grapher pages kept with the design); applied in order. */
const saveTransforms: ((d: Design) => Design)[] = [];

/** Register a transform applied to the design written by Save / Save As; returns the unregister function. */
export function registerSaveTransform(fn: (d: Design) => Design): () => void {
  saveTransforms.push(fn);
  return () => {
    const i = saveTransforms.indexOf(fn);
    if (i >= 0) saveTransforms.splice(i, 1);
  };
}

/** Transforms applied to a design as it is opened, in order (see {@link registerOpenTransform}). */
const openTransforms: ((d: Design, fileName: string) => Design | Promise<Design>)[] = [];

/**
 * Register a transform applied to every design that is opened from a file. The integration layer
 * uses it to show a shipped sample with its title and sheet names in the UI language ("Trang 1")
 * whatever route it was opened by — File > Open, the Explorer, a drop or a recent entry.
 * Returns the unregister function.
 */
export function registerOpenTransform(fn: (d: Design, fileName: string) => Design | Promise<Design>): () => void {
  openTransforms.push(fn);
  return () => {
    const i = openTransforms.indexOf(fn);
    if (i >= 0) openTransforms.splice(i, 1);
  };
}

/** The design as the document shows it after opening `fileName`. */
async function designForOpen(design: Design, fileName: string): Promise<Design> {
  let d = design;
  for (const fn of openTransforms) {
    try {
      d = await fn(d, fileName);
    } catch (err) {
      console.error('open transform failed', err);
    }
  }
  return d;
}

/** The design as Save writes it: transforms applied and Design.meta stamped. */
export function designForSave(design: Design, now: Date = new Date()): Design {
  let d = design;
  for (const fn of saveTransforms) d = fn(d);
  const iso = now.toISOString();
  return { ...d, meta: { created: d.meta?.created ?? iso, modified: iso, savedBy: SAVED_BY } };
}

/** Observable recent-file list (menus subscribe). */
export const recentFiles = createStore<RecentEntry[]>(readRecent(browserStorage()));

function remember(entry: RecentEntry): void {
  const list = pushRecent(recentFiles.getState(), entry);
  recentFiles.setState(list);
  writeRecent(browserStorage(), list);
}

/**
 * Projects opened recently (File > Recent projects): file paths in the desktop build, project
 * names in the browser build, where the list lives in browser storage under a size cap
 * (src/ui/app/files.ts `writeRecentProjects`). `openRecentProject` takes either.
 */
export const recentProjectFiles = createStore<string[]>(readRecentProjects(browserStorage()).map((e) => e.path ?? e.name));

/** Refresh the recent-project list (from the desktop shell, or from browser storage). */
export function refreshRecentProjects(): void {
  const bridge = getDesktopBridge();
  if (!bridge?.recentProjects) {
    recentProjectFiles.setState(readRecentProjects(browserStorage()).map((e) => e.path ?? e.name));
    return;
  }
  bridge
    .recentProjects()
    .then((paths) => recentProjectFiles.setState(paths))
    .catch(() => undefined);
}

/** File > Recent projects > a project (the project dialog loads on demand). */
export async function openRecentProject(path: string): Promise<void> {
  const m = await import('./projectDialogs');
  await m.openRecentProjectFlow(path);
  refreshRecentProjects();
}

export function clearRecentFiles(): void {
  recentFiles.setState([]);
  writeRecent(browserStorage(), []);
}

function errorText(err: unknown): string {
  if (err instanceof DesignFormatError) {
    // a plain-language summary first; the technical list (English, from the validator) follows
    const details = err.issues.slice(0, 12).join('\n') + (err.issues.length > 12 ? `\n${t('app.document.andMoreIssues', { n: err.issues.length - 12 })}` : '');
    return `${designErrorSummary(err.issues)}\n\n${t('app.document.technicalDetails')}\n${details}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** What went wrong with a design file, in the UI language (the first issue decides). */
export function designErrorSummary(issues: readonly string[]): string {
  const first = issues[0] ?? '';
  if (/^not valid JSON/i.test(first) || /does not contain a JSON object/i.test(first)) return t('app.document.notJson');
  if (/^Not a MachSim design file/i.test(first)) return t('app.document.notDesign');
  const newer = /newer MachSim \(format version (\d+)\)/.exec(first);
  if (newer) return t('app.document.newerVersion', { version: newer[1] });
  return t('app.document.damaged', { n: issues.length });
}

/**
 * Text of the "unsaved changes" prompt. The file name is the one the learner reads in the window
 * title and the status bar ("Chưa đặt tên.msim"), never the internal "Untitled.msim".
 */
export function unsavedChangesMessage(fileName: string, action: string = t('app.document.continueAction')): string {
  return t('app.document.filenameHasUnsavedChangesSave', { fileName: displayFileName(fileName), action });
}

/**
 * Called before a design is opened, imported or generated: resolves true when there is room for it.
 * With document tabs the new design opens in a tab of its own (or replaces an untouched start-up
 * design), so unsaved changes of the current document are never at risk and nothing is asked; the
 * only reason to say no is the limit of open documents, which the learner is told about. The
 * name and the `action` text are kept so existing callers stay as they are.
 */
export async function confirmDiscardChanges(_action?: string, opts: { replace?: boolean } = {}): Promise<boolean> {
  void _action;
  if (documents.canOpen(opts.replace !== false)) return true;
  await alertDialog({ title: t('docs.tooMany.title'), message: t('docs.tooMany.message', { n: documents.maxDocuments }) });
  return false;
}

/** File > New: an empty design in a new tab. */
export async function newDocument(): Promise<void> {
  // New always adds a tab (never replaces an untouched one), so the limit check must say the same
  if (!(await confirmDiscardChanges(undefined, { replace: false }))) return;
  const id = await documents.open(newLocalizedDesign(), 'Untitled.msim', { replace: false });
  if (!id) return;
  target = null;
  openedStat = null;
}

/**
 * Make `design` the current document (a new tab, or the untouched start-up design replaced), then
 * record where it came from. Resolves false when the limit of open documents is reached.
 */
async function presentDesign(design: Design, fileName: string, from: FileTarget | null, saved: boolean): Promise<boolean> {
  if (!(await confirmDiscardChanges())) return false;
  const id = await documents.open(design, fileName, { saved });
  if (!id) return false;
  if (from?.kind === 'desktop') openPaths.set(id, from.path);
  else openPaths.delete(id);
  target = from;
  openedStat = null;
  actions.fitAll();
  documentLoaded(design);
  return true;
}

/**
 * Open a generated design (circuit wizards, lessons, samples) as a new, unsaved document in its
 * own tab. Resolves false when no more documents can be opened.
 */
export async function openGeneratedDesign(design: Design, name: string, confirm = true): Promise<boolean> {
  void confirm;
  // the catalogue packs the design uses load first, so its parts are drawn and netlisted at once
  const parts = designPartsReady(design);
  if (parts) await parts;
  return presentDesign(design, ensureExtension(name), null, false);
}

/** File names treated as SPICE decks rather than designs (File > Open, Explorer, recent files). */
export const SPICE_FILE_RE = /\.(cir|sp|spi|spice|net|ckt)$/i;

/**
 * Handler for SPICE decks reaching the document functions (installed by the integration layer,
 * which simulates the deck); null = SPICE files are rejected like any invalid design.
 */
export const spiceFileHandler: { current: ((text: string, name: string) => Promise<void>) | null } = { current: null };

/**
 * Handler for files that are not .msim designs or SPICE decks (installed by src/ui/files): MachSim
 * XML, KiCad, EDIF, snippet pictures, .bak copies and closed formats of other programs. Returns
 * true / false when it handled the file (opened / failed with a message), null when the file is
 * none of these (it is then read as a .msim design).
 */
export const otherFormatHandler: { current: ((file: OpenedFile) => Promise<boolean | null>) | null } = { current: null };

/** Open any file File > Open, recent files, Explorer or drag-and-drop delivered. */
export async function openOpenedFile(f: OpenedFile): Promise<boolean> {
  if (otherFormatHandler.current) {
    const handled = await otherFormatHandler.current(f);
    if (handled !== null) return handled;
  }
  const ok = await loadDesignText(f.text, f.name, f.target);
  if (ok && f.target?.kind !== 'desktop') openedStat = f.size !== undefined || f.lastModified !== undefined ? { size: f.size, lastModified: f.lastModified } : null;
  return ok;
}

/**
 * Replace the document with a parsed design text. Shows an error dialog and returns false when
 * the text is not a valid design. SPICE decks (by file name) go to {@link spiceFileHandler}.
 */
export async function loadDesignText(text: string, name: string, from: FileTarget | null, saved = true): Promise<boolean> {
  if (SPICE_FILE_RE.test(name) && spiceFileHandler.current) {
    await spiceFileHandler.current(text, name);
    return true;
  }
  // the same desktop file is already open: show that tab (a second copy would let two editors
  // overwrite each other's changes)
  const already = from?.kind === 'desktop' ? documentOfPath(from.path) : undefined;
  if (already) return documents.switchTo(already);
  try {
    // the shared integrity layer: a file whose design-scoped references (assembly variants, ERC
    // options, net settings, blocks) do not resolve is repaired and reported, never refused
    const { design: parsed, notes } = parseDesignSafely(text);
    const design = await designForOpen(parsed, name);
    const parts = designPartsReady(design);
    if (parts) await parts;
    if (!(await presentDesign(design, ensureExtension(name), from, saved))) return false;
    remember({ name: ensureExtension(name), openedAt: Date.now(), content: from?.kind === 'desktop' ? undefined : text, ...(from?.kind === 'desktop' ? { path: from.path } : {}) });
    if (notes.length) actions.addSimMessage('warning', sanitizeReport(notes), t('sim.source.integrity'));
    return true;
  } catch (err) {
    await alertDialog({ title: t('app.document.cannotOpenDesign'), message: `${name}\n\n${errorText(err)}` });
    return false;
  }
}

export async function openDocument(): Promise<void> {
  if (!(await confirmDiscardChanges(t('app.document.openAnotherDesign')))) return;
  try {
    const f = await pickTextFile(OPEN_ACCEPT);
    if (f) await openOpenedFile(f);
  } catch (err) {
    await alertDialog({ title: t('app.document.openFailed'), message: errorText(err) });
  }
}

export async function openRecentFile(entry: RecentEntry): Promise<void> {
  if (!(await confirmDiscardChanges(t('app.document.openAnotherDesign')))) return;
  const bridge = getDesktopBridge();
  try {
    if (entry.path && bridge) {
      const f = await bridge.openRecent(entry.path);
      await openOpenedFile(openedFromDesktop(f));
    } else if (entry.content !== undefined) {
      await loadDesignText(entry.content, entry.name, null);
    } else {
      await alertDialog({ title: t('app.document.cannotReopen'), message: t('app.document.nameWasTooLargeTo', { name: entry.name }) });
    }
  } catch (err) {
    await alertDialog({ title: t('app.document.openFailed'), message: `${entry.name}\n\n${errorText(err)}` });
  }
}

function afterSave(name: string, to: FileTarget | null, text: string, from: Design, written: Design): void {
  if (to?.kind === 'desktop') openPaths.set(documents.activeId(), to.path);
  else openPaths.delete(documents.activeId());
  target = to;
  openedStat = null;
  actions.markSavedAs(from, written, ensureExtension(name));
  // the saved document no longer needs its recovery copy; the other open documents keep theirs
  syncRecovery();
  remember({ name: ensureExtension(name), openedAt: Date.now(), ...(to?.kind === 'desktop' ? { path: to.path } : { content: text }) });
}

/** Save in place when the document has a writable location, otherwise Save As. */
export async function saveDocument(): Promise<boolean> {
  if (!target) return saveDocumentAs();
  const from = getState().design;
  const written = designForSave(from);
  const text = serializeDesign(written);
  try {
    const r = await writeToTarget(target, text, { backups: getState().ui.backupCount });
    afterSave(r.name, r.target, text, from, written);
    return true;
  } catch (err) {
    await alertDialog({ title: t('app.document.saveFailed'), message: errorText(err) });
    return false;
  }
}

export async function saveDocumentAs(): Promise<boolean> {
  const s = getState();
  const from = s.design;
  const written = designForSave(from);
  const text = serializeDesign(written);
  let suggested = s.fileName && !/^untitled\.msim$/i.test(s.fileName) ? s.fileName : fileNameForTitle(s.design.title);
  try {
    // plain browsers cannot show a save dialog: ask for the download name first
    if (!getDesktopBridge() && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker !== 'function') {
      const name = await promptText({ title: t('app.document.saveDesignAs'), label: t('app.document.fileNameTheFileIs'), initial: suggested, validate: (v) => (v.trim() ? null : t('app.document.enterAFileName')) });
      if (name === null) return false;
      suggested = ensureExtension(name);
    }
    const r = await saveTextAs(text, suggested);
    if (!r) return false;
    afterSave(r.name, r.target, text, from, written);
    return true;
  } catch (err) {
    await alertDialog({ title: t('app.document.saveFailed'), message: errorText(err) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/** The exporter (and react-dom/server) is loaded on first use to keep start-up small. */
const loadExporter = () => import('../editor/exportImage');

function exportBaseName(): string {
  const s = getState();
  const sheet = activeSheet(s);
  const base = baseName(s.fileName) || 'design';
  return s.design.sheets.length > 1 || s.design.children?.length ? `${base} - ${sheet.name}` : base;
}

export async function exportSheetSvg(): Promise<void> {
  const s = getState();
  try {
    const { sheetToSvg } = await loadExporter();
    const r = sheetToSvg(s.design, s.activeSheetId, partLookup, { probeValues: s.probeValues, indicatorLevels: s.indicatorLevels });
    await exportFile(fileNameForTitle(exportBaseName(), '.svg'), r.svg, { name: 'SVG image', extensions: ['svg'] });
  } catch (err) {
    await alertDialog({ title: t('app.document.exportFailed'), message: errorText(err) });
  }
}

export async function exportSheetPng(): Promise<void> {
  const s = getState();
  try {
    const { sheetToSvg, svgToPngBlob } = await loadExporter();
    const r = sheetToSvg(s.design, s.activeSheetId, partLookup, { probeValues: s.probeValues, indicatorLevels: s.indicatorLevels });
    const blob = await svgToPngBlob(r.svg, r.width, r.height, 2);
    await exportFile(fileNameForTitle(exportBaseName(), '.png'), blob, { name: 'PNG image', extensions: ['png'] });
  } catch (err) {
    await alertDialog({ title: t('app.document.exportFailed'), message: errorText(err) });
  }
}

// ---------------------------------------------------------------------------
// autosave & recovery
// ---------------------------------------------------------------------------

/** Delay after the first change before the first autosave of a session (later ones follow the interval). */
export const AUTOSAVE_DELAY_MS = 1500;

let recovery: RecoveryStore | null = null;
/** How the previous session ended: read once, before this session marks itself as running. */
let previousSession: Promise<PreviousSession> | null = null;

/** The recovery slot of this platform (desktop user-data folder, or browser storage). */
export function recoveryStore(): RecoveryStore {
  if (!recovery) {
    const bridge = getDesktopBridge();
    recovery = bridge ? desktopRecoveryStore(bridge, browserStorage()) : browserRecoveryStore(browserStorage());
  }
  return recovery;
}

/**
 * Periodic autosave of a changed document to the recovery slot: the first change is written after
 * AUTOSAVE_DELAY_MS, later ones at most every Options > File options interval (ui.autosaveSeconds),
 * and a pending change is flushed when the page is hidden or closed. Also keeps the session
 * marker that tells the next start whether this session ended normally.
 */
export function installAutosave(): () => void {
  const store = recoveryStore();
  previousSession ??= store.previousSession();
  void previousSession.then(() => store.startSession());
  let pending = false;
  let lastWriteAt = 0;
  let firstChangeAt = 0;
  let lastDesign = getState().design;
  const write = () => {
    pending = false;
    if (!getState().ui.autosave) return;
    lastWriteAt = Date.now();
    const rec = buildRecoveryRecord(lastWriteAt);
    if (rec) void store.writeRecord(rec);
  };
  const unsub = subscribe(() => {
    const d = getState().design;
    if (d === lastDesign) return;
    lastDesign = d;
    // switching between documents swaps the design too, which only matters when something is unsaved
    if (!isDirty(getState()) && !documents.dirtyDocuments().length) return;
    if (!pending) firstChangeAt = Date.now();
    pending = true;
  });
  const tick = setInterval(() => {
    if (!pending) return;
    const now = Date.now();
    const interval = Math.max(5, getState().ui.autosaveSeconds) * 1000;
    if (lastWriteAt === 0 ? now - firstChangeAt >= AUTOSAVE_DELAY_MS : now - lastWriteAt >= interval) write();
  }, 500);
  const beat = setInterval(() => store.beat(), HEARTBEAT_MS);
  const onHide = () => {
    if (pending) write();
  };
  const onUnload = () => {
    onHide();
    store.endSession();
  };
  window.addEventListener('pagehide', onUnload);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    unsub();
    clearInterval(tick);
    clearInterval(beat);
    window.removeEventListener('pagehide', onUnload);
    document.removeEventListener('visibilitychange', onHide);
  };
}

/**
 * The recovery record of the documents open now: every document with unsaved changes (the first
 * in the record, the others in `others`), or null when nothing is unsaved.
 */
export function buildRecoveryRecord(now: number = Date.now()): AutosaveRecord | null {
  const docs: AutosaveDoc[] = documents.dirtyContents().map((d) => {
    const where = (d.ext.file as { target?: FileTarget | null } | undefined)?.target;
    return { fileName: d.fileName, savedAt: now, text: serializeDesign(d.design), ...(where?.kind === 'desktop' ? { path: where.path } : {}) };
  });
  if (!docs.length) return null;
  const [first, ...others] = docs;
  return { ...first, ...(others.length ? { others } : {}) };
}

/**
 * Bring the recovery slot in line with the documents open now: rewritten when some document has
 * unsaved changes, cleared when none has (after a save, a close).
 */
export function syncRecovery(): void {
  const rec = buildRecoveryRecord();
  if (rec) void recoveryStore().writeRecord(rec);
  else void recoveryStore().clearRecord();
}

/** Restore an autosave record as unsaved documents, one tab each; true when the first loaded. */
async function restoreRecord(rec: AutosaveRecord): Promise<boolean> {
  let any = false;
  for (const doc of recordDocuments(rec)) {
    // a document that came from a desktop file goes back to it: Save writes there, not into a new dialog
    if (await loadDesignText(doc.text, doc.fileName, doc.path ? { kind: 'desktop', path: doc.path } : null, false)) any = true;
  }
  if (any) await recoveryStore().clearRecord();
  return any;
}

/** The recovery question: one document by name, several by number and names. */
function recoveryMessage(rec: AutosaveRecord, when: string, manual = false): string {
  const docs = recordDocuments(rec);
  if (docs.length === 1) return manual ? t('files.recover.found', { fileName: displayFileName(rec.fileName), when }) : t('app.document.machsimFoundUnsavedChangesTo', { fileName: displayFileName(rec.fileName), when });
  return t('docs.recover.many', { n: docs.length, names: docs.map((d) => displayFileName(d.fileName)).join(', '), when });
}

/** At start-up: after an unclean exit (crash, killed, power loss) offer the autosaved document. */
export async function offerRecovery(): Promise<void> {
  const store = recoveryStore();
  previousSession ??= store.previousSession();
  const rec = await store.readRecord();
  if (recoveryDecision(await previousSession, rec) !== 'offer' || !rec) return;
  const when = new Date(rec.savedAt).toLocaleString(localeTag());
  const choice = await choiceDialog({
    title: t('app.document.recoverUnsavedWork'),
    message: recoveryMessage(rec, when),
    choices: [
      { id: 'discard', label: t('app.document.discard'), danger: true },
      { id: 'later', label: t('app.document.notNow') },
      { id: 'recover', label: t('app.document.recover'), primary: true },
    ],
  });
  if (choice === 'recover') await restoreRecord(rec);
  else if (choice === 'discard') await store.clearRecord();
}

/** File > Recover autosaved design: open the record in the recovery slot, if there is one. */
export async function recoverAutosaved(): Promise<void> {
  const rec = await recoveryStore().readRecord();
  if (!rec) {
    await alertDialog({ title: t('files.recover.title'), message: t('files.recover.none') });
    return;
  }
  const when = new Date(rec.savedAt).toLocaleString(localeTag());
  const choice = await choiceDialog({
    title: t('files.recover.title'),
    message: recoveryMessage(rec, when, true),
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'discard', label: t('app.document.discard'), danger: true },
      { id: 'recover', label: t('app.document.recover'), primary: true },
    ],
  });
  if (choice === 'discard') await recoveryStore().clearRecord();
  else if (choice === 'recover' && (await confirmDiscardChanges())) await restoreRecord(rec);
}

// ---------------------------------------------------------------------------
// desktop integration
// ---------------------------------------------------------------------------

/**
 * Keep the window title / dirty flag in sync and accept files opened from the OS. The title names
 * the current document; the dirty flag and the list of unsaved documents tell the desktop shell
 * (and the browser's "leave this page?" question) whether ANY open document has unsaved changes.
 * A file opened from Explorer, a second instance or "Open with" arrives as a new tab, and the
 * desktop asks the renderer to run the Close all flow when its window is closed.
 */
export function installDocumentChrome(): () => void {
  const bridge = getDesktopBridge();
  let lastTitle = '';
  let lastDirty: boolean | null = null;
  let lastList = '';
  const sync = () => {
    const s = getState();
    const here = isDirty(s);
    const dirtyDocs = documents.dirtyDocuments();
    const title = `${here ? '● ' : ''}${displayFileName(s.fileName)} — MachSim`;
    if (title !== lastTitle) {
      lastTitle = title;
      document.title = title;
      bridge?.setTitle(title);
    }
    const anyDirty = here || dirtyDocs.length > 0;
    if (anyDirty !== lastDirty) {
      lastDirty = anyDirty;
      bridge?.setDirty(anyDirty);
    }
    const names = dirtyDocs.map((d) => displayFileName(d.fileName));
    const key = JSON.stringify(names);
    if (key !== lastList) {
      lastList = key;
      bridge?.setDirtyDocuments?.(names);
    }
  };
  sync();
  const unsub = subscribe(sync);
  const unsubDocs = documents.view.subscribe(sync);
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!bridge && (isDirty(getState()) || documents.dirtyDocuments().length > 0)) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  const offOpen = bridge?.onOpenFile((f) => {
    void openOpenedFile(openedFromDesktop(f));
  });
  // the window is being closed: one question for all the unsaved documents, then quit
  const offClose = bridge?.onCloseRequest?.(() => {
    void import('./documentFlows').then((m) => m.quitFlow());
  });
  refreshRecentProjects();
  if (bridge) {
    bridge
      .recentFiles()
      .then((paths) => {
        const entries = paths.map((p, i) => ({ name: (p.split(/[\\/]/).pop() ?? p), path: p, openedAt: paths.length - i }));
        if (entries.length) recentFiles.setState(entries);
      })
      .catch(() => undefined);
  }
  return () => {
    unsub();
    unsubDocs();
    offOpen?.();
    offClose?.();
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
