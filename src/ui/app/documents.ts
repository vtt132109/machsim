/**
 * Several designs open at once (document tabs).
 *
 * The editor store holds ONE current document: every editing action, the canvas, the simulation
 * controller and the dialogs work on it. The document manager keeps the others aside as
 * {@link DocumentState} snapshots (design, saved copy, undo history, selection, per-sheet views,
 * ERC markers and the simulation state the document produced) and swaps a snapshot into the
 * store when its tab is chosen. Nothing else in the application had to learn about documents.
 *
 * Things that live next to the editor store and belong to a document too (the file the document
 * was opened from, the Grapher run history and pages) register a {@link DocumentExtension}; the
 * manager asks each one to `capture` its part when the document is left and to `restore` it when
 * the document comes back (`undefined` for a brand-new document). A simulation that is running is
 * stopped first (`beforeLeave`), because the running circuit is the document being left.
 *
 * Rules
 *  - A new document normally opens in a new tab. A *pristine* current document (never edited,
 *    never saved, empty) is replaced instead, so the empty design every start begins with does not
 *    pile up behind the first file the learner opens.
 *  - There is always at least one document: closing the last one leaves a new empty design.
 *  - At most {@link MAX_DOCUMENTS} documents are open (each keeps its own undo history).
 *  - Unsaved documents are never dropped without asking: closing one asks about that one, Close
 *    all / quitting asks once with the list ({@link CloseHost.askUnsaved}).
 *
 * This module has no UI and no browser dependency, so every rule is tested with plain editors
 * (documents.test.ts). The application's singleton is in documentSet.ts.
 */
import type { Design } from '../../model/types';
import type { DocumentState } from '../store/types';
import { createStore, type Store } from '../store/createStore';
import type { Editor } from '../store/editorStore';

/** Documents that can be open at once. */
export const MAX_DOCUMENTS = 16;

/** Something outside the editor store that belongs to a document (file location, Grapher runs ...). */
export interface DocumentExtension {
  id: string;
  /** the part of the current document's state this extension owns */
  capture(): unknown;
  /** show a document again; `undefined` = a new document with nothing recorded */
  restore(data: unknown): void;
  /** stop whatever works on the current document before it is left (a running simulation) */
  beforeLeave?(): Promise<void> | void;
}

/** What the tab strip and the Window menu show about a document. */
export interface DocumentInfo {
  id: string;
  fileName: string;
  title: string;
  dirty: boolean;
}

export interface DocumentsView {
  docs: DocumentInfo[];
  activeId: string;
}

/** What the user decided about unsaved documents. */
export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/** The questions the close flows have to ask (dialogs in the application, fakes in tests). */
export interface CloseHost {
  /** ask what to do with the unsaved documents; `why` tells which flow asks */
  askUnsaved(docs: readonly DocumentInfo[], why: 'close' | 'closeAll' | 'quit'): Promise<UnsavedChoice>;
  /** save the CURRENT document (Save, or Save as for a new one); true when it was saved */
  saveActive(): Promise<boolean>;
}

interface Entry {
  id: string;
  /** the snapshot while the document is not the current one */
  state: DocumentState | null;
  ext: Record<string, unknown>;
}

export interface DocumentManagerOptions {
  editor: Pick<Editor, 'getState' | 'subscribe' | 'actions'>;
  /** a new empty design (named in the UI language) */
  blank: () => Design;
  maxDocuments?: number;
}

const sameInfo = (a: DocumentInfo, b: DocumentInfo) => a.id === b.id && a.fileName === b.fileName && a.title === b.title && a.dirty === b.dirty;

/** True when a design has no content at all (nothing placed, drawn, written or programmed). */
export function designIsEmpty(d: Design): boolean {
  if (d.children?.length || d.breadboard) return false;
  return d.sheets.every((s) => !s.parts.length && !s.wires.length && !s.labels.length && !s.probes.length && !s.notes.length && !(s.shapes?.length ?? 0) && !(s.ladder?.length ?? 0));
}

export function createDocumentManager(options: DocumentManagerOptions) {
  const { editor } = options;
  const max = options.maxDocuments ?? MAX_DOCUMENTS;
  const extensions: DocumentExtension[] = [];
  let seq = 0;
  const first: Entry = { id: `doc${++seq}`, state: null, ext: {} };
  /** tab order */
  const entries: Entry[] = [first];
  let activeId = first.id;
  /** most recently used first */
  let recent: string[] = [first.id];
  /** switches run one after another */
  let queue: Promise<unknown> = Promise.resolve();
  /** can the current document be replaced by the next one that opens? (set by the file layer) */
  let replaceable: () => boolean = () => true;

  const current = () => editor.getState();
  const infoOf = (e: Entry): DocumentInfo => {
    const st = e.state ?? current();
    return { id: e.id, fileName: st.fileName, title: st.design.title, dirty: st.design !== st.savedDesign };
  };
  const view = createStore<DocumentsView>({ docs: [infoOf(first)], activeId });

  function refresh(): void {
    const docs = entries.map(infoOf);
    const prev = view.getState();
    if (prev.activeId === activeId && prev.docs.length === docs.length && prev.docs.every((d, i) => sameInfo(d, docs[i]))) return;
    view.setState({ docs, activeId });
  }
  editor.subscribe(refresh);

  const find = (id: string) => entries.find((e) => e.id === id);
  const touch = (id: string) => {
    recent = [id, ...recent.filter((x) => x !== id)];
  };

  async function leaveCurrent(): Promise<void> {
    for (const ext of extensions) await ext.beforeLeave?.();
  }

  /** Put the state of the current document into its entry (it stops being the current one). */
  function stash(e: Entry): void {
    e.state = editor.actions.captureDocument();
    for (const ext of extensions) e.ext[ext.id] = ext.capture();
  }

  /** Make `e` the current document. */
  function show(e: Entry, fresh?: DocumentState): void {
    const st = fresh ?? e.state;
    if (!st) return;
    e.state = null;
    activeId = e.id;
    touch(e.id);
    editor.actions.restoreDocument(st);
    for (const ext of extensions) ext.restore(fresh ? undefined : e.ext[ext.id]);
    refresh();
  }

  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  function isPristine(): boolean {
    const s = current();
    // never edited, never saved under a name, nothing in it
    return s.design === s.savedDesign && s.history.past.length === 0 && /^untitled\.msim$/i.test(s.fileName) && designIsEmpty(s.design) && replaceable();
  }

  const api = {
    /** observable list of the open documents and the current one */
    view: view as Store<DocumentsView>,
    maxDocuments: max,
    list: (): DocumentInfo[] => entries.map(infoOf),
    activeId: (): string => activeId,
    count: (): number => entries.length,
    isActive: (id: string): boolean => id === activeId,
    dirtyDocuments: (): DocumentInfo[] => entries.map(infoOf).filter((d) => d.dirty),
    /** The designs with unsaved changes, with their file names (autosave / crash recovery). */
    dirtyContents(): { id: string; fileName: string; design: Design; ext: Record<string, unknown> }[] {
      return entries
        .map((e) => ({ e, st: e.state ?? current() }))
        .filter(({ st }) => st.design !== st.savedDesign)
        // the current document's extension state is live (the stored one is from when it was left)
        .map(({ e, st }) => ({ id: e.id, fileName: st.fileName, design: st.design, ext: e.state ? e.ext : Object.fromEntries(extensions.map((x) => [x.id, x.capture()])) }));
    },
    /** The file layer says when the current document is "just the empty start-up design". */
    setReplaceable(fn: () => boolean): void {
      replaceable = fn;
    },
    registerExtension(ext: DocumentExtension): () => void {
      extensions.push(ext);
      return () => {
        const i = extensions.indexOf(ext);
        if (i >= 0) extensions.splice(i, 1);
      };
    },
    /** true when one more document can be opened (with `replace`, also when an untouched current one would be replaced) */
    canOpen(replace = false): boolean {
      return entries.length < max || (replace && isPristine());
    },
    /**
     * Make a design the current document: it replaces a pristine current document (when
     * `replace` is not false) and otherwise opens in a new tab. Resolves with the id of the
     * document, or null when the limit of open documents is reached.
     */
    open(design: Design, fileName: string, opts: { saved?: boolean; replace?: boolean } = {}): Promise<string | null> {
      return serial(async () => {
        const replace = opts.replace !== false && isPristine();
        if (!replace && entries.length >= max) return null;
        await leaveCurrent();
        const fresh = editor.actions.makeDocument(design, fileName, opts.saved ?? true);
        if (replace) {
          show(find(activeId)!, fresh);
          return activeId;
        }
        stash(find(activeId)!);
        const e: Entry = { id: `doc${++seq}`, state: null, ext: {} };
        const at = entries.findIndex((x) => x.id === activeId);
        entries.splice(at + 1, 0, e);
        show(e, fresh);
        return e.id;
      });
    },
    /** Show another open document. */
    switchTo(id: string): Promise<boolean> {
      return serial(async () => {
        const target = find(id);
        if (!target) return false;
        if (id === activeId) return true;
        await leaveCurrent();
        stash(find(activeId)!);
        show(target);
        return true;
      });
    },
    next: (): Promise<boolean> => api.step(1),
    previous: (): Promise<boolean> => api.step(-1),
    /** Window > Next / Previous document: the neighbour in tab order, wrapping around. */
    step(delta: number): Promise<boolean> {
      if (entries.length < 2) return Promise.resolve(false);
      const i = entries.findIndex((e) => e.id === activeId);
      return api.switchTo(entries[(i + delta + entries.length) % entries.length].id);
    },
    /** Window > Last used document: the document that was current before this one. */
    switchToRecent(): Promise<boolean> {
      const prev = recent.find((id) => id !== activeId && find(id));
      return prev ? api.switchTo(prev) : Promise.resolve(false);
    },
    /** Move a tab to a new position (drag a tab). */
    move(id: string, toIndex: number): void {
      const from = entries.findIndex((e) => e.id === id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(entries.length - 1, toIndex));
      if (from === to) return;
      const [e] = entries.splice(from, 1);
      entries.splice(to, 0, e);
      view.setState({ docs: entries.map(infoOf), activeId });
    },
    /**
     * Drop a document WITHOUT asking (the caller already did): the neighbour used last becomes
     * current; closing the last document leaves a new empty one.
     */
    remove(id: string): Promise<boolean> {
      return serial(async () => {
        const e = find(id);
        if (!e) return false;
        if (id !== activeId) {
          entries.splice(entries.indexOf(e), 1);
          recent = recent.filter((x) => x !== id);
          refresh();
          return true;
        }
        await leaveCurrent();
        const at = entries.indexOf(e);
        const others = entries.filter((x) => x !== e);
        entries.splice(at, 1);
        recent = recent.filter((x) => x !== id);
        const nextId = recent.find((x) => others.some((o) => o.id === x));
        const target = (nextId ? find(nextId) : undefined) ?? entries[Math.min(at, entries.length - 1)];
        if (target) show(target);
        else {
          const blank: Entry = { id: `doc${++seq}`, state: null, ext: {} };
          entries.push(blank);
          show(blank, editor.actions.makeDocument(options.blank(), 'Untitled.msim', true));
        }
        return true;
      });
    },
    /** Drop every document and start again with one empty design. */
    removeAll(): Promise<void> {
      return serial(async () => {
        await leaveCurrent();
        entries.splice(0, entries.length);
        recent = [];
        const blank: Entry = { id: `doc${++seq}`, state: null, ext: {} };
        entries.push(blank);
        show(blank, editor.actions.makeDocument(options.blank(), 'Untitled.msim', true));
      });
    },

    // ------------------------------------------------------------------ asking flows
    /** File > Close: close one document, asking what to do when it has unsaved changes. */
    async close(id: string, host: CloseHost): Promise<boolean> {
      const e = find(id);
      if (!e) return false;
      const info = infoOf(e);
      if (info.dirty) {
        const choice = await host.askUnsaved([info], 'close');
        if (choice === 'cancel') return false;
        if (choice === 'save') {
          if (!(await api.switchTo(id))) return false;
          if (!(await host.saveActive())) return false;
        }
      }
      return api.remove(id);
    },
    /** File > Save all: every document with changes is saved in turn; false when one was not. */
    async saveAll(host: CloseHost): Promise<boolean> {
      const origin = activeId;
      for (const d of api.dirtyDocuments()) {
        if (!(await api.switchTo(d.id))) return false;
        if (!(await host.saveActive())) return false;
      }
      if (find(origin)) await api.switchTo(origin);
      return true;
    },
    /**
     * File > Close all, and the quit of the desktop window (`why = 'quit'`): ONE question lists
     * every document with unsaved changes. Resolves true when the documents were closed (or may
     * be: for 'quit' they are left open for the shell to end), false when the user cancelled or a
     * save failed.
     */
    async closeAll(host: CloseHost, why: 'closeAll' | 'quit' = 'closeAll'): Promise<boolean> {
      const dirty = api.dirtyDocuments();
      if (dirty.length) {
        const choice = await host.askUnsaved(dirty, why);
        if (choice === 'cancel') return false;
        if (choice === 'save' && !(await api.saveAll(host))) return false;
      }
      if (why === 'closeAll') await api.removeAll();
      return true;
    },
  };
  return api;
}

export type DocumentManager = ReturnType<typeof createDocumentManager>;
