/**
 * Project manager (File > Project): a project groups several designs and extra files.
 *
 * - Desktop: a project is a .msimproj file; its designs and files live in its folder and are read
 *   / written through the desktop bridge by relative path. Recent projects are kept by the shell.
 * - Browser: a project lives in memory; it is opened from and saved to one packed archive
 *   (.msimpack, a ZIP file holding project.msimproj and every listed file). Recent projects are
 *   kept in browser storage under a size cap ({@link rememberProject}, src/ui/app/files.ts):
 *   the manifest and the text files of the newest entries, the names alone for the older ones.
 * Pack writes the open project into one archive file; Unpack reads an archive, and on the
 * desktop writes it into a new folder and opens it there.
 */
import { useState, useSyncExternalStore } from 'react';
import { getDesktopBridge } from '../../desktop/bridge';
import {
  addProjectEntry,
  isDesignPath,
  newProject,
  normalizeProjectPath,
  packProject,
  parseProject,
  PACK_EXTENSION,
  PROJECT_EXTENSION,
  ProjectFormatError,
  projectPaths,
  removeProjectEntry,
  serializeProject,
  setMainDesign,
  unpackProject,
  type ProjectFile,
} from '../../model/project';
import { serializeDesign } from '../../model/serialize';
import { base64ToBytes, bytesText, bytesToBase64, textBytes } from '../../util/zip';
import { actions, getState } from '../store';
import type { CustomPartData } from '../../library/custom/types';
import { createStore } from '../store/createStore';
import { Dialog } from '../common/Dialog';
import { alertDialog, confirmDialog, openCustomDialog, promptText } from '../common/dialogs';
import { confirmDiscardChanges, loadDesignText, refreshRecentProjects } from './document';
import { browserStorage, downloadBlob, ensureExtension, pushRecentProject, readRecentProjects, writeRecentProjects, type RecentProject } from './files';
import { t } from '../../i18n';
import { pt } from '../../i18n/placeText';
import { sanitizeReport } from '../../i18n/sanitize';

export interface OpenProject {
  project: ProjectFile;
  /** desktop: absolute path of the .msimproj file; null = in memory (browser / not saved yet) */
  path: string | null;
  /** contents kept in memory (browser projects; desktop projects read files on demand) */
  contents: Map<string, Uint8Array | string>;
}

/** The project currently open (null = none). */
export const projectStore = createStore<OpenProject | null>(null);

function errorText(err: unknown): string {
  if (err instanceof ProjectFormatError) return err.issues.slice(0, 8).join('\n');
  return err instanceof Error ? err.message : String(err);
}

async function saveManifest(p: OpenProject): Promise<void> {
  const bridge = getDesktopBridge();
  if (p.path && bridge) await bridge.writeFile(p.path, serializeProject(p.project));
}

async function update(fn: (p: ProjectFile) => ProjectFile): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const next = { ...cur, project: fn(cur.project) };
  projectStore.setState(next);
  try {
    await saveManifest(next);
  } catch (err) {
    await alertDialog({ title: t('schematic.project.saveFailed'), message: errorText(err) });
  }
}

/** Read one project file (text for designs). */
async function readEntry(p: OpenProject, rel: string): Promise<{ text?: string; bytes?: Uint8Array; abs?: string } | null> {
  const mem = p.contents.get(rel);
  if (mem !== undefined) return typeof mem === 'string' ? { text: mem } : { bytes: mem, text: isDesignPath(rel) ? bytesText(mem) : undefined };
  const bridge = getDesktopBridge();
  if (!p.path || !bridge?.readProjectFile) return null;
  const r = await bridge.readProjectFile(p.path, rel);
  const bytes = base64ToBytes(r.base64);
  return { bytes, text: isDesignPath(rel) ? bytesText(bytes) : undefined, abs: r.path };
}

async function newProjectFlow(): Promise<void> {
  const name = await promptText({ title: t('schematic.project.new'), label: t('schematic.project.name'), initial: t('schematic.project.defaultName'), validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')) });
  if (!name) return;
  const project = newProject(name);
  const bridge = getDesktopBridge();
  if (bridge?.saveProjectAs) {
    const r = await bridge.saveProjectAs(serializeProject(project), ensureExtension(name, PROJECT_EXTENSION));
    if (!r) return;
    projectStore.setState({ project, path: r.path, contents: new Map() });
    return;
  }
  const open: OpenProject = { project, path: null, contents: new Map() };
  projectStore.setState(open);
  rememberProject(open);
}

/**
 * Remember the open project in the recent list. On the desktop the shell keeps the path; in the
 * browser the entry carries the manifest and the project's text files, so Recent projects can
 * open it again without the archive (src/ui/app/files.ts holds the size cap).
 */
export function rememberProject(p: OpenProject): void {
  const storage = browserStorage();
  if (!storage) return;
  const entry: RecentProject = { name: p.project.name, openedAt: Date.now(), ...(p.path ? { path: p.path } : {}) };
  if (!p.path) {
    entry.project = serializeProject(p.project);
    const files: Record<string, string> = {};
    for (const [rel, c] of p.contents) if (typeof c === 'string') files[rel] = c;
    if (Object.keys(files).length) entry.files = files;
  }
  writeRecentProjects(storage, pushRecentProject(readRecentProjects(storage), entry));
  refreshRecentProjects();
}

/** Recent projects of the browser build (names; the desktop list comes from the shell). */
export function browserRecentProjects(): RecentProject[] {
  return readRecentProjects(browserStorage());
}

/**
 * File > Recent projects: open a project again. `key` is the project file path on the desktop and
 * the project name in the browser, where the entry's own snapshot is restored.
 */
export async function openRecentProjectFlow(key: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (!bridge?.openProject) {
    const entry = browserRecentProjects().find((e) => e.name === key || e.path === key);
    if (!entry?.project) {
      await alertDialog({ title: t('schematic.project.openFailed'), message: t('schematic.project.recentGone', { name: key }) });
      return;
    }
    try {
      const contents = new Map<string, Uint8Array | string>(Object.entries(entry.files ?? {}));
      const open: OpenProject = { project: parseProject(entry.project), path: null, contents };
      projectStore.setState(open);
      rememberProject(open);
    } catch (err) {
      await alertDialog({ title: t('schematic.project.openFailed'), message: errorText(err) });
      return;
    }
    openProjectDialog();
    return;
  }
  await openProjectFlow(key);
  if (projectStore.getState()) openProjectDialog();
}

async function openProjectFlow(path?: string): Promise<void> {
  const bridge = getDesktopBridge();
  try {
    if (bridge?.openProject) {
      const f = path && bridge.openRecentProject ? await bridge.openRecentProject(path) : await bridge.openProject();
      if (!f) return;
      const open: OpenProject = { project: parseProject(f.content), path: f.path, contents: new Map() };
      projectStore.setState(open);
      rememberProject(open);
      return;
    }
    await unpackProjectFlow();
  } catch (err) {
    await alertDialog({ title: t('schematic.project.openFailed'), message: errorText(err) });
  }
}

/** Put the current design into the project (desktop: written into the project folder). */
async function addCurrentDesign(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const s = getState();
  const rel = await promptText({
    title: t('schematic.project.addDesign'),
    label: t('schematic.project.relPath'),
    initial: s.fileName || 'design.msim',
    validate: (v) => {
      const p = normalizeProjectPath(v);
      return p && isDesignPath(p) ? null : t('schematic.project.badDesignPath');
    },
  });
  if (!rel) return;
  const path = normalizeProjectPath(rel)!;
  const text = serializeDesign(s.design);
  const bridge = getDesktopBridge();
  try {
    if (cur.path && bridge?.writeProjectFile) await bridge.writeProjectFile(cur.path, path, bytesToBase64(textBytes(text)));
    else cur.contents.set(path, text);
    await update((p) => addProjectEntry(p, { path, title: s.design.title }));
  } catch (err) {
    await alertDialog({ title: t('schematic.project.saveFailed'), message: errorText(err) });
  }
}

/** Add another file (datasheet, notes, models, pictures). */
async function addFile(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const bridge = getDesktopBridge();
  if (cur.path && bridge?.addFileToProject) {
    const r = await bridge.addFileToProject(cur.path);
    if (r) await update((p) => addProjectEntry(p, { path: r.rel }));
    return;
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
  if (!file) return;
  const path = normalizeProjectPath(file.name) ?? 'file';
  cur.contents.set(path, new Uint8Array(await file.arrayBuffer()));
  await update((p) => addProjectEntry(p, { path }));
}

async function openEntry(rel: string): Promise<void> {
  const cur = projectStore.getState();
  if (!cur || !isDesignPath(rel)) return;
  if (!(await confirmDiscardChanges(t('app.document.openAnotherDesign')))) return;
  try {
    const r = await readEntry(cur, rel);
    if (!r?.text) throw new Error(t('schematic.project.missing', { path: rel }));
    await loadDesignText(r.text, rel.split('/').pop() ?? rel, r.abs ? { kind: 'desktop', path: r.abs } : null);
  } catch (err) {
    await alertDialog({ title: t('schematic.project.openFailed'), message: errorText(err) });
  }
}

/** The library tools chunk (my library profile). */
const libraryTools = () => import('../parts/libraryTools');

/** Write "my library" (favourites, recent parts, user database) into the project as library/my-library.msimlib. */
async function saveLibraryIntoProject(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const { currentProfileText } = await libraryTools();
  const { PROJECT_PROFILE_PATH } = await import('../../library/custom/profile');
  const text = currentProfileText();
  const bridge = getDesktopBridge();
  try {
    if (cur.path && bridge?.writeProjectFile) await bridge.writeProjectFile(cur.path, PROJECT_PROFILE_PATH, bytesToBase64(textBytes(text)));
    else cur.contents.set(PROJECT_PROFILE_PATH, text);
    if (!projectPaths(cur.project).some((p) => p.toLowerCase() === PROJECT_PROFILE_PATH)) await update((p) => addProjectEntry(p, { path: PROJECT_PROFILE_PATH }));
    actions.addSimMessage('info', pt('projLibrarySaved', { path: PROJECT_PROFILE_PATH }), 'project');
  } catch (err) {
    await alertDialog({ title: t('schematic.project.saveFailed'), message: errorText(err) });
  }
}

/** Import the project's library/my-library.msimlib (same dialog as Tools › My library › Import). */
async function loadLibraryFromProject(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const { PROJECT_PROFILE_PATH } = await import('../../library/custom/profile');
  const rel = projectPaths(cur.project).find((p) => p.toLowerCase() === PROJECT_PROFILE_PATH) ?? PROJECT_PROFILE_PATH;
  try {
    const r = await readEntry(cur, rel);
    const text = r?.text ?? (r?.bytes ? bytesText(r.bytes) : undefined);
    if (!text) {
      await alertDialog({ title: t('cmd.file.project'), message: pt('projLibraryMissing', { path: PROJECT_PROFILE_PATH }) });
      return;
    }
    await (await libraryTools()).importProfileText(text, rel);
  } catch (err) {
    await alertDialog({ title: t('schematic.project.openFailed'), message: errorText(err) });
  }
}

/** Write the learner's lesson progress into the project as lessons/progress.msimprog. */
async function saveProgressIntoProject(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const { PROJECT_PROGRESS_PATH, serializeProgressFile } = await import('../../learn/lessonFile');
  const { lessonProgress } = await import('../learn/LessonsPanel');
  const text = serializeProgressFile(lessonProgress.getState());
  const bridge = getDesktopBridge();
  try {
    if (cur.path && bridge?.writeProjectFile) await bridge.writeProjectFile(cur.path, PROJECT_PROGRESS_PATH, bytesToBase64(textBytes(text)));
    else cur.contents.set(PROJECT_PROGRESS_PATH, text);
    if (!projectPaths(cur.project).some((p) => p.toLowerCase() === PROJECT_PROGRESS_PATH)) await update((p) => addProjectEntry(p, { path: PROJECT_PROGRESS_PATH }));
    actions.addSimMessage('info', pt('projProgressSaved', { path: PROJECT_PROGRESS_PATH }), 'project');
  } catch (err) {
    await alertDialog({ title: t('schematic.project.saveFailed'), message: errorText(err) });
  }
}

/** Read the project's lessons/progress.msimprog and merge it into the progress on this computer. */
async function loadProgressFromProject(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) return;
  const { PROJECT_PROGRESS_PATH, mergeProgress, parseProgressFile } = await import('../../learn/lessonFile');
  const { lessonProgress } = await import('../learn/LessonsPanel');
  const rel = projectPaths(cur.project).find((p) => p.toLowerCase() === PROJECT_PROGRESS_PATH) ?? PROJECT_PROGRESS_PATH;
  try {
    const r = await readEntry(cur, rel);
    const text = r?.text ?? (r?.bytes ? bytesText(r.bytes) : undefined);
    const file = text ? parseProgressFile(text) : null;
    if (!file) {
      await alertDialog({ title: t('cmd.file.project'), message: pt('projProgressMissing', { path: PROJECT_PROGRESS_PATH }) });
      return;
    }
    const merged = mergeProgress(lessonProgress.getState(), file.progress);
    lessonProgress.setState(merged);
    actions.addSimMessage('info', pt('projProgressLoaded', { n: Object.keys(merged.steps).length }), 'project');
  } catch (err) {
    await alertDialog({ title: t('schematic.project.openFailed'), message: errorText(err) });
  }
}

/** Pack the open project into one archive file (.msimpack). */
export async function packCurrentProject(): Promise<void> {
  const cur = projectStore.getState();
  if (!cur) {
    await alertDialog({ title: t('cmd.file.packProject'), message: t('schematic.project.noneOpen') });
    return;
  }
  try {
    const contents = new Map(cur.contents);
    for (const rel of projectPaths(cur.project)) {
      if (contents.has(rel)) continue;
      const r = await readEntry(cur, rel);
      if (r?.bytes) contents.set(rel, r.bytes);
      else if (r?.text) contents.set(rel, r.text);
    }
    const { bytes, missing, components } = packProject({ project: cur.project, contents });
    if (components) actions.addSimMessage('info', t('files.pack.components', { n: components }), 'project');
    const name = ensureExtension(cur.project.name, PACK_EXTENSION);
    const bridge = getDesktopBridge();
    if (bridge) await bridge.exportFile({ title: t('cmd.file.packProject'), suggestedName: name, filters: [{ name: t('schematic.project.packFilter'), extensions: ['msimpack', 'zip'] }], base64: bytesToBase64(bytes) });
    else downloadBlob(name, new Blob([bytes as BlobPart], { type: 'application/zip' }));
    if (missing.length) await alertDialog({ title: t('cmd.file.packProject'), message: t('schematic.project.packMissing', { files: missing.join(', ') }) });
  } catch (err) {
    await alertDialog({ title: t('schematic.project.packFailed'), message: errorText(err) });
  }
}

async function pickArchive(): Promise<Uint8Array | null> {
  const bridge = getDesktopBridge();
  if (bridge?.openBinaryFile) {
    const f = await bridge.openBinaryFile({ title: t('cmd.file.unpackProject'), filters: [{ name: t('schematic.project.packFilter'), extensions: ['msimpack', 'zip'] }] });
    return f ? base64ToBytes(f.base64) : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PACK_EXTENSION},.zip`;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      file.arrayBuffer().then((b) => resolve(new Uint8Array(b)), () => resolve(null));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * After unpacking: offer to add the packed user components to the User database (newer copies
 * replace older ones; the designs work either way, because they embed their components).
 */
async function offerComponentImport(parts: CustomPartData[]): Promise<void> {
  const { getDatabase, commitDatabase } = await import('../parts/partDatabases');
  const { mergeDatabases, newDatabase } = await import('../../library/custom/database');
  const user = getDatabase('user');
  const fresh = parts.filter((p) => {
    const mine = user.parts.find((x) => x.id === p.id);
    return !mine || (p.modified ?? '') > (mine.modified ?? '');
  });
  if (!fresh.length) return;
  const ok = await confirmDialog({ title: t('cmd.file.unpackProject'), message: t('files.unpack.componentsQuestion', { n: fresh.length, names: fresh.slice(0, 6).map((p) => p.name).join(', ') }), okLabel: t('files.unpack.componentsAdd') });
  if (!ok) return;
  const merged = mergeDatabases(user, { ...newDatabase('user'), parts: fresh }, 'newer');
  await commitDatabase('user', merged.db);
  actions.addSimMessage('info', t('files.unpack.componentsAdded', { n: merged.added + merged.updated }), 'project');
}

/** Unpack an archive: desktop writes it into a new folder and opens it; browsers keep it in memory. */
export async function unpackProjectFlow(): Promise<void> {
  const bytes = await pickArchive();
  if (!bytes) return;
  try {
    const bundle = await unpackProject(bytes);
    const bridge = getDesktopBridge();
    if (bridge?.unpackProject) {
      const files = [{ path: `${bundle.project.name.replace(/[<>:"/\\|?*]/g, '_') || 'project'}${PROJECT_EXTENSION}`, base64: bytesToBase64(textBytes(serializeProject(bundle.project))) }];
      for (const [p, c] of bundle.contents) files.push({ path: p, base64: bytesToBase64(typeof c === 'string' ? textBytes(c) : c) });
      const r = await bridge.unpackProject(files, bundle.project.name);
      if (!r) return;
      projectStore.setState({ project: bundle.project, path: r.path, contents: new Map() });
    } else projectStore.setState({ project: bundle.project, path: null, contents: bundle.contents });
    const open = projectStore.getState();
    if (open) rememberProject(open);
    if (bundle.notes.length) actions.addSimMessage('warning', sanitizeReport(bundle.notes), t('sim.source.integrity'));
    if (bundle.components.length) await offerComponentImport(bundle.components);
    openProjectDialog();
  } catch (err) {
    await alertDialog({ title: t('schematic.project.unpackFailed'), message: errorText(err) });
  }
}

function ProjectDialog({ close }: { close: () => void }) {
  const cur = useSyncExternalStore(projectStore.subscribe, projectStore.getState, projectStore.getState);
  const [recent, setRecent] = useState<string[] | null>(null);
  const bridge = getDesktopBridge();
  if (recent === null && bridge?.recentProjects) void bridge.recentProjects().then(setRecent, () => setRecent([]));
  // the browser build keeps its own list (name + snapshot in browser storage)
  const recentNames = bridge?.recentProjects ? (recent ?? []) : browserRecentProjects().map((e) => e.name);
  const btn = (label: string, tip: string, fn: () => void, disabled = false) => (
    <button type="button" className="ms-btn ms-btn-small" title={tip} disabled={disabled} onClick={fn}>
      {label}
    </button>
  );
  return (
    <Dialog title={t('cmd.file.project')} onClose={close} width={560} footer={<button type="button" className="ms-btn ms-btn-primary" onClick={close}>{t('common.close')}</button>}>
      <div className="ms-form">
        <p className="ms-hint">{bridge ? t('schematic.project.hintDesktop') : t('schematic.project.hintWeb')}</p>
        <div className="ms-btn-row">
          {btn(t('schematic.project.new'), t('schematic.project.newTip'), () => void newProjectFlow())}
          {btn(t('schematic.project.open'), t('schematic.project.openTip'), () => void openProjectFlow())}
          {btn(t('cmd.file.packProject'), t('schematic.project.packTip'), () => void packCurrentProject(), !cur)}
          {btn(t('cmd.file.unpackProject'), t('schematic.project.unpackTip'), () => void unpackProjectFlow())}
        </div>
        {cur ? (
          <>
            <div className="ms-prop-head">
              <strong>{cur.project.name}</strong>
              <span className="ms-hint">{cur.path ?? t('schematic.project.inMemory')}</span>
            </div>
            <div className="ms-btn-row">
              {btn(t('schematic.project.addDesign'), t('schematic.project.addDesignTip'), () => void addCurrentDesign())}
              {btn(t('schematic.project.addFile'), t('schematic.project.addFileTip'), () => void addFile())}
              {btn(pt('projSaveLibrary'), pt('projSaveLibraryTip'), () => void saveLibraryIntoProject())}
              {btn(pt('projLoadLibrary'), pt('projLoadLibraryTip'), () => void loadLibraryFromProject())}
              {btn(pt('projSaveProgress'), pt('projSaveProgressTip'), () => void saveProgressIntoProject())}
              {btn(pt('projLoadProgress'), pt('projLoadProgressTip'), () => void loadProgressFromProject())}
              {btn(t('schematic.project.close'), t('schematic.project.closeTip'), () => projectStore.setState(null))}
            </div>
            <div role="listbox" aria-label={t('schematic.project.files')} className="ms-find-results">
              {!cur.project.designs.length && !cur.project.files.length ? <div className="ms-empty">{t('schematic.project.empty')}</div> : null}
              {[...cur.project.designs, ...cur.project.files].map((e) => (
                <div key={e.path} role="option" aria-selected={false} className="ms-find-row">
                  <strong>{isDesignPath(e.path) ? '▤' : '▫'} {e.title ?? e.path}</strong>
                  <span className="ms-hint ms-mono">{e.path}{cur.project.main === e.path ? ` · ${t('schematic.project.main')}` : ''}</span>
                  {isDesignPath(e.path) ? btn(t('schematic.project.openDesign'), t('schematic.project.openDesignTip'), () => { close(); void openEntry(e.path); }) : null}
                  {isDesignPath(e.path) && cur.project.main !== e.path ? btn(t('schematic.project.setMain'), t('schematic.project.setMainTip'), () => void update((p) => setMainDesign(p, e.path))) : null}
                  {btn(t('schematic.project.remove'), t('schematic.project.removeTip'), () => void update((p) => removeProjectEntry(p, e.path)))}
                </div>
              ))}
            </div>
          </>
        ) : null}
        {recentNames.length ? (
          <>
            <div className="ms-prop-head">
              <strong>{t('schematic.project.recent')}</strong>
            </div>
            <div role="listbox" aria-label={t('schematic.project.recent')} className="ms-find-results">
              {recentNames.map((p) => (
                <div key={p} role="option" aria-selected={false} className="ms-find-row" title={p} onClick={() => void openRecentProjectFlow(p)}>
                  <strong>{p.split(/[\\/]/).pop()}</strong>
                  <span className="ms-hint ms-mono">{p}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

export function openProjectDialog(): void {
  openCustomDialog((close) => <ProjectDialog close={close} />);
}

/**
 * Recently opened projects for the File menu: the shell's list of paths on the desktop, the names
 * of the projects kept in browser storage otherwise (`openRecentProjectFlow` takes either).
 */
export async function recentProjects(): Promise<string[]> {
  const bridge = getDesktopBridge();
  if (bridge?.recentProjects) return (await bridge.recentProjects()) ?? [];
  return browserRecentProjects().map((e) => e.name);
}
