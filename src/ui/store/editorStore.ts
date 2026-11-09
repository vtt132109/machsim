/**
 * The editor store: document + UI state, undo/redo history and every editing action.
 *
 * - The document is an immutable {@link Design}; actions build the next snapshot with the pure
 *   operations of designOps.ts (structural sharing) and {@link commit} it.
 * - Undo history stores whole Design snapshots (cheap thanks to sharing). Commits that pass the same
 *   `coalesce` key as the previous commit replace the present snapshot instead of pushing a new
 *   undo step — a mouse drag therefore becomes one undo step, keyboard nudges within one second
 *   merge too.
 * - Non-document state (selection, tool, views, live simulation data) changes through setState
 *   without touching history. Interactive part changes (switch toggles while simulating) also
 *   bypass history on purpose.
 *
 * `createEditor()` builds an independent instance (used by tests); the application uses the
 * singleton exported from ./index.ts.
 */
import { getPart } from '../../library';
import type { InteractiveDef } from '../../library/types';
import type { AnalysisType, SimOptions } from '../../sim/netlist';
import type {
  AnalysisSettings,
  ChildDesign,
  Design,
  ErcMessage,
  LabelKind,
  NetLabel,
  PartInstance,
  Point,
  PrintSetup,
  Probe,
  RefdesRules,
  SheetLayers,
  ProbeKind,
  Rotation,
  Shape,
  Sheet,
  SheetProps,
  TextNote,
  TitleBlockFields,
  Wire,
} from '../../model/types';
import { childIdOfPart, copyPaths, findSheet, getChild, hierarchyTree, isBlockPartId, liveParams, pathLeadsTo, resolveLiveName, resolveLivePart, resolvePart, withLiveParam, type HierarchyNode } from '../../model/hierarchy';
import { isCustomPartId } from '../../library/custom/types';
import { isCustomPartDef } from '../../library/custom/partDef';
import { syncCustomParts } from '../../library/custom/design';
import type { IncomingExtras, SanitizeNote } from '../../model/sanitize';
import { sanitizeReport } from '../../i18n/sanitize';
import * as sops from './schematicOps';
import * as hops from './hierarchyOps';
import { newDesign } from '../../model/types';
import { t } from '../../i18n';
import { partName } from '../../i18n/library';
import { clipboardRestrictionKey, instrumentAllowed, pasteAllowed, restrictionViolation } from '../../model/restrictions';
import { snap } from '../../model/geometry';
import { annotateDesign } from '../../model/annotate';
import { createStore } from './createStore';
import type {
  Clipboard,
  EditorState,
  HistoryState,
  DocumentState,
  ItemKind,
  PartLookup,
  RatingState,
  SelItem,
  SimMessageSeverity,
  SimStatus,
  ToolState,
  UiState,
  ViewState,
} from './types';
import * as ops from './designOps';
import { levelSheets, validateRefdes } from './refdes';
import { followNetColors, renameNetAcrossSettings } from './netColors';
import { setSheetLayers } from '../../model/layers';
import { annotationRefs, reorderAnnotations, type OrderOp } from '../../model/annotationOrder';
import { applyRulesToDesign, normalizeRules, type ApplyRulesResult } from '../../model/refdesRules';
import { relinkRenamedCoils } from '../../model/relink';
import { centerOn, DEFAULT_VIEW, fitRect, zoomAt } from './viewport';
import { nextInteractiveValue, type InteractionPhase } from './interactive';
import { newId } from './ids';
import { newRung } from '../../ladder/edit';
import { renameLadderBlock as renameLadderBlockInDesign } from '../../ladder/editBlocks';
import type { LadderBlock, LadderRung } from '../../ladder/types';
import type { LadderLive } from '../../ladder/probes';
import { parseUserNumber } from '../../util/units';

export const HISTORY_LIMIT = 200;
/** Keyboard nudges within this window merge into one undo step. */
export const NUDGE_COALESCE_MS = 1000;
const MAX_SIM_MESSAGES = 2000;

export interface CommitOptions {
  /** merge with the previous commit when it used the same key */
  coalesce?: string;
  /** only merge when the previous commit happened at most this many ms ago */
  windowMs?: number;
  /** selection after the commit (pruned to existing items) */
  selection?: SelItem[];
}

export interface EditorOptions {
  lookup?: PartLookup;
  design?: Design;
  fileName?: string;
  /** clock for time-windowed coalescing (tests) */
  now?: () => number;
}

export type InteractiveListener = (refdes: string, param: string, value: string) => void;

/** Outcome of {@link Editor} `pasteSpecial`. */
export type PasteSpecialResult =
  | { ok: true; count: number; renamed?: number; childId?: string }
  | { ok: false; reason: 'noClipboard' | 'restricted' | 'noTarget' | 'nothingMatched' | 'noParts' };

/** A new empty design whose first sheet is named in the UI language ("Trang 1" / "Sheet 1"). */
/** A new design named and with sheet names in the UI language ("Chưa đặt tên", "Trang 1"). */
export function newLocalizedDesign(title?: string): Design {
  const d = newDesign(title ?? t('integration.reports.untitled'));
  return { ...d, sheets: d.sheets.map((s, i) => ({ ...s, name: t('sheet.default', { n: i + 1 }) })) };
}

export function initialEditorState(design: Design = newDesign(), fileName = 'Untitled.msim'): EditorState {
  return {
    design,
    savedDesign: design,
    fileName,
    activeSheetId: design.sheets[0]?.id ?? 'sheet1',
    viewPath: [],
    selection: [],
    tool: { kind: 'select' },
    views: {},
    viewportSize: { w: 1000, h: 700 },
    showGrid: true,
    showErc: true,
    history: { past: [], future: [], coalesceKey: null, lastCommitAt: 0 },
    ercMarkers: [],
    simMessages: [],
    probeValues: {},
    indicatorLevels: {},
    ladderLive: null,
    ratingStates: {},
    sim: { state: 'idle', message: '', simTime: 0 },
    clipboardAvailable: false,
    ui: {
      browserOpen: true,
      propertiesOpen: true,
      dockOpen: true,
      dockTab: 'spreadsheet',
      theme: 'system',
      browserWidth: 250,
      propertiesWidth: 290,
      dockHeight: 190,
      autosave: true,
      autosaveSeconds: 30,
      backupCount: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// selectors
// ---------------------------------------------------------------------------

export function isDirty(s: EditorState): boolean {
  return s.design !== s.savedDesign;
}

export function activeSheet(s: EditorState): Sheet {
  return ops.getSheet(s.design, s.activeSheetId) ?? s.design.sheets[0];
}

export function viewOf(s: EditorState, sheetId: string = s.activeSheetId): ViewState {
  return s.views[sheetId] ?? DEFAULT_VIEW;
}

export function isSelected(s: EditorState, kind: ItemKind, id: string): boolean {
  return s.selection.some((it) => it.kind === kind && it.id === id);
}

function listOf(sheet: Sheet, kind: ItemKind): { id: string }[] {
  switch (kind) {
    case 'part':
      return sheet.parts;
    case 'wire':
      return sheet.wires;
    case 'label':
      return sheet.labels;
    case 'probe':
      return sheet.probes;
    case 'note':
      return sheet.notes;
    case 'shape':
      return sheet.shapes ?? [];
  }
}

/** Child id of the design level the active sheet belongs to (undefined = root design). */
export function activeLevel(s: EditorState): string | undefined {
  return findSheet(s.design, s.activeSheetId)?.child?.id;
}

/**
 * Refdes path of the placed block copy the learner is looking at ([] at the top level). The path
 * the learner opened (EditorState.viewPath) when it still leads to the open design, else the first
 * copy of the open child design.
 */
export function activeViewPath(s: EditorState): string[] {
  const level = activeLevel(s);
  if (level === undefined) return [];
  if (pathLeadsTo(s.design, s.viewPath, level)) return s.viewPath;
  return copyPaths(s.design, level)[0] ?? [];
}

/** Sheets of the design level the active sheet belongs to. */
export function levelSheetsOf(s: EditorState): Sheet[] {
  const child = findSheet(s.design, s.activeSheetId)?.child;
  return child ? child.sheets : s.design.sheets;
}

/**
 * Path from the root to the active sheet's design level through the design tree (the first
 * instance of each child), e.g. [root, HB1, HB1/SC1]. Root sheets give [root].
 */
export function levelPath(s: EditorState): HierarchyNode[] {
  const tree = hierarchyTree(s.design);
  const target = activeLevel(s);
  if (target === undefined) return [tree];
  const find = (n: HierarchyNode, trail: HierarchyNode[]): HierarchyNode[] | null => {
    for (const c of n.children) {
      if (c.child?.id === target) return [...trail, c];
      if (!c.cyclic) {
        const r = find(c, [...trail, c]);
        if (r) return r;
      }
    }
    return null;
  };
  return find(tree, [tree]) ?? [tree];
}

/** True when placing a block of `childId` on a sheet of level `level` would nest a design in itself. */
export function wouldNestItself(design: Design, level: string | undefined, childId: string): boolean {
  if (level === undefined) return false;
  if (level === childId) return true;
  // does childId (transitively) contain `level`?
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === level) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const s of getChild(design, id)?.sheets ?? []) for (const p of s.parts) {
      const c = childIdOfPart(p.partId);
      if (c !== undefined) stack.push(c);
    }
  }
  return false;
}

/** Drop selected ids that no longer exist on the sheet (returns `sel` itself when unchanged). */
export function pruneSelection(sel: SelItem[], design: Design, sheetId: string): SelItem[] {
  const sheet = ops.getSheet(design, sheetId);
  if (!sheet) return sel.length ? [] : sel;
  const out = sel.filter((it) => listOf(sheet, it.kind).some((x) => x.id === it.id));
  return out.length === sel.length ? sel : out;
}

function pushLimited(list: Design[], d: Design): Design[] {
  const out = list.length >= HISTORY_LIMIT ? list.slice(list.length - HISTORY_LIMIT + 1) : list.slice();
  out.push(d);
  return out;
}

/**
 * A history snapshot with an interactive parameter value applied to one part (matched by
 * instance id and part type). The snapshot itself is returned when it lacks the part or already
 * has the value.
 */
function withInteractiveParam(d: Design, instanceId: string, partId: string, param: string, value: string): Design {
  for (const sheet of d.sheets) {
    const part = sheet.parts.find((p) => p.id === instanceId);
    if (!part) continue;
    if (part.partId !== partId || part.params[param] === value) return d;
    return ops.updatePart(d, sheet.id, instanceId, { params: { ...part.params, [param]: value } });
  }
  return d;
}

// ---------------------------------------------------------------------------
// editor factory
// ---------------------------------------------------------------------------

/** Why an edit was refused by the instructor restrictions (current language). */
function restrictionMessage(v: 'lockedPart' | 'description'): string {
  return v === 'lockedPart' ? t('learn.restricted.lockedPart') : t('learn.restricted.description');
}

/** The per-document part of an editor state (see {@link DocumentState}). */
export function pickDocument(s: EditorState): DocumentState {
  return {
    design: s.design,
    savedDesign: s.savedDesign,
    fileName: s.fileName,
    activeSheetId: s.activeSheetId,
    selection: s.selection,
    views: s.views,
    history: s.history,
    ercMarkers: s.ercMarkers,
    simMessages: s.simMessages,
    probeValues: s.probeValues,
    indicatorLevels: s.indicatorLevels,
    ladderLive: s.ladderLive,
    ratingStates: s.ratingStates,
    sim: s.sim,
  };
}

export function createEditor(options: EditorOptions = {}) {
  const baseLookup: PartLookup = options.lookup ?? getPart;
  const now = options.now ?? (() => Date.now());
  const store = createStore<EditorState>(initialEditorState(options.design, options.fileName));
  const { getState, setState, subscribe } = store;
  /**
   * library lookup; block part ids (`hier:<child>`) and user components (`custom:<slug>`) resolve
   * against the current document (its children / its embedded component copies)
   */
  const lookup: PartLookup = (partId) => (isBlockPartId(partId) || isCustomPartId(partId) ? resolvePart(getState().design, partId, baseLookup) : baseLookup(partId));
  /** data of a user component known to the library (part databases, components seen this session) */
  const customData = (id: string) => {
    const def = baseLookup(id);
    return isCustomPartDef(def) ? def.custom : undefined;
  };

  let clipboard: Clipboard | null = null;
  /** restrictions key of the design the clipboard was copied from when it hides part values */
  let clipboardHiddenBy: string | null = null;
  let pasteCount = 0;
  let keySeq = 0;
  let msgSeq = 0;
  let drag: {
    base: Design;
    baseHistory: HistoryState;
    key: string;
    sheetId: string;
    sel: SelItem[];
    dx: number;
    dy: number;
  } | null = null;
  const interactiveListeners = new Set<InteractiveListener>();
  /** called after a placement with `startPlacing(…, { once: true })` placed its part */
  const placedListeners = new Set<(instId: string, partId: string) => void>();

  const patch = (p: Partial<EditorState>) => setState((s) => ({ ...s, ...p }));

  /**
   * Tell the learner what the integrity layer repaired when content entered the design
   * (src/model/sanitize.ts): a paste or a snippet whose assembly variants, global parameters or
   * user components did not exist here is accepted and the differences are reported, never
   * silently lost.
   */
  function reportSanitize(notes: readonly SanitizeNote[]): void {
    if (!notes.length) return;
    actions.addSimMessage('warning', sanitizeReport(notes), t('sim.source.integrity'));
  }

  /** Make `next` the current document, recording (or coalescing) an undo step. */
  function commit(proposed: Design, o: CommitOptions = {}): boolean {
    const s = getState();
    // instructor restrictions: locked parts / a locked description box refuse the change
    const violation = proposed === s.design ? null : restrictionViolation(s.design, proposed);
    if (violation) {
      actions.addSimMessage('warning', restrictionMessage(violation), 'instructor');
      return false;
    }
    // keep the embedded user components equal to the used ones (in-use list), and give every wire
    // of a coloured net that net's colour (a net's settings follow the NET, not the wires)
    // (a renamed coil takes its contacts along: they name it by designator, src/model/relink.ts)
    const next = proposed === s.design ? proposed : followNetColors(syncCustomParts(relinkRenamedCoils(s.design, proposed, lookup), customData), lookup);
    if (next === s.design) {
      if (o.selection) patch({ selection: pruneSelection(o.selection, next, s.activeSheetId) });
      return false;
    }
    const t = now();
    const merge =
      !!o.coalesce &&
      s.history.coalesceKey === o.coalesce &&
      (o.windowMs === undefined || t - s.history.lastCommitAt <= o.windowMs);
    const past = merge ? s.history.past : pushLimited(s.history.past, s.design);
    const activeSheetId = ops.getSheet(next, s.activeSheetId) ? s.activeSheetId : next.sheets[0].id;
    setState({
      ...s,
      design: next,
      activeSheetId,
      history: { past, future: [], coalesceKey: o.coalesce ?? null, lastCommitAt: t },
      selection: pruneSelection(o.selection ?? s.selection, next, activeSheetId),
    });
    return true;
  }

  const sheetId = () => getState().activeSheetId;

  /** Instruments the instructor disabled cannot be placed (a message says why). */
  function placementAllowed(partId: string): boolean {
    const def = lookup(partId);
    if (!def?.instrument || instrumentAllowed(getState().design, def.instrument)) return true;
    actions.addSimMessage('warning', t('learn.restricted.instrument', { instrument: partName(def) }), 'instructor');
    return false;
  }

  function setView(id: string, view: ViewState) {
    setState((s) => ({ ...s, views: { ...s.views, [id]: view } }));
  }

  function showRect(rect: { x: number; y: number; w: number; h: number } | null) {
    const s = getState();
    setView(s.activeSheetId, rect ? fitRect(rect, s.viewportSize) : DEFAULT_VIEW);
  }

  /** An interactive change of a part inside a placed block: stored on that copy, not on the block design. */
  function setCopyParam(refdes: string, param: string, value: string, path: readonly string[]): boolean {
    const s = getState();
    const ref = resolveLivePart(s.design, path, refdes);
    if (!ref || liveParams(ref)[param] === value) return false;
    const apply = (d: Design): Design => {
      const r = resolveLivePart(d, path, refdes);
      return r && liveParams(r)[param] !== value ? withLiveParam(d, r, param, value) : d;
    };
    const history = { ...s.history, past: s.history.past.map(apply), future: s.history.future.map(apply) };
    if (drag) drag = { ...drag, base: apply(drag.base), baseHistory: { ...drag.baseHistory, past: drag.baseHistory.past.map(apply), future: drag.baseHistory.future.map(apply) } };
    setState({ ...s, design: apply(s.design), history });
    emitInteractive([...path, ref.local].join('.'), param, value);
    return true;
  }

  function emitInteractive(refdes: string, param: string, value: string) {
    for (const l of Array.from(interactiveListeners)) {
      try {
        l(refdes, param, value);
      } catch (err) {
        console.error('interactive listener failed', err);
      }
    }
  }

  const actions = {
    // ----------------------------------------------------------------- document
    /** Replace the document (open / recover). Clears history and live data. */
    loadDesign(design: Design, fileName = 'Untitled.msim', saved = true) {
      drag = null;
      const prev = getState();
      // a net's colour belongs to the net: a file (or an import) whose wires were never painted
      // shows the colour at once, and the document still counts as saved
      const painted = followNetColors(design, lookup);
      setState({
        ...initialEditorState(painted, fileName),
        savedDesign: saved ? painted : prev.savedDesign === prev.design ? newDesign() : prev.savedDesign,
        ui: prev.ui,
        showGrid: prev.showGrid,
        showErc: prev.showErc,
        viewportSize: prev.viewportSize,
        sim: prev.sim,
        clipboardAvailable: prev.clipboardAvailable,
      });
    },
    /** File > New: an empty design named in the UI language (file name 'Untitled.msim' until saved). */
    newDocument(title?: string) {
      actions.loadDesign(newLocalizedDesign(title), title ? `${title}.msim` : 'Untitled.msim');
    },
    /**
     * Document tabs (src/ui/app/documents.ts): the part of the state that belongs to the current
     * document, to be kept while another document is shown. Pure data, no history is changed.
     */
    captureDocument(): DocumentState {
      return pickDocument(getState());
    },
    /** Show a captured document again: its undo history, selection, views and simulation state. */
    restoreDocument(doc: DocumentState) {
      drag = null;
      setState((s) => ({ ...s, ...doc, tool: { kind: 'select' } }));
    },
    /** A fresh document (state of a newly opened design) that can be restored later; the store is not touched. */
    makeDocument(design: Design, fileName = 'Untitled.msim', saved = true): DocumentState {
      const painted = followNetColors(design, lookup);
      const fresh = initialEditorState(painted, fileName);
      const doc = pickDocument(fresh);
      return saved ? doc : { ...doc, savedDesign: newDesign() };
    },
    /** Mark the current document as saved (optionally under a new file name). */
    markSaved(fileName?: string) {
      setState((s) => ({ ...s, savedDesign: s.design, fileName: fileName ?? s.fileName }));
    },
    /**
     * After a save that wrote `written` (the design `from` with save-time fields such as
     * Design.meta added): when the document is still `from`, it becomes `written` and is clean;
     * when it changed while the file was written, `written` is only remembered as the saved state.
     * No undo step is recorded.
     */
    markSavedAs(from: Design, written: Design, fileName?: string) {
      setState((s) => (s.design === from ? { ...s, design: written, savedDesign: written, fileName: fileName ?? s.fileName } : { ...s, savedDesign: written, fileName: fileName ?? s.fileName }));
    },
    setDesignInfo(info: { title?: string; description?: string; variables?: Record<string, string>; customSpice?: string }) {
      const d = getState().design;
      const next: Design = { ...d };
      let changed = false;
      for (const k of Object.keys(info) as (keyof typeof info)[]) {
        const v = info[k];
        if (v === undefined || d[k] === v) continue;
        (next as unknown as Record<string, unknown>)[k] = v;
        changed = true;
      }
      if (changed) commit(next);
    },
    setAnalysisSettings(settings: AnalysisSettings) {
      const d = getState().design;
      if (d.analysis !== settings) commit({ ...d, analysis: settings });
    },
    setActiveAnalysis(type: AnalysisType) {
      const d = getState().design;
      if (d.analysis.active !== type) commit({ ...d, analysis: { ...d.analysis, active: type } });
    },
    setSimOptions(options: Partial<SimOptions>) {
      const d = getState().design;
      commit({ ...d, options: { ...d.options, ...options } });
    },
    /** Apply an arbitrary design transformation as one undoable step. */
    applyDesign(fn: (d: Design) => Design, o: CommitOptions = {}) {
      return commit(fn(getState().design), o);
    },

    // ------------------------------------------------------------------ history
    undo() {
      drag = null;
      const s = getState();
      const prev = s.history.past[s.history.past.length - 1];
      if (!prev) return false;
      const activeSheetId = ops.getSheet(prev, s.activeSheetId) ? s.activeSheetId : prev.sheets[0].id;
      setState({
        ...s,
        design: prev,
        activeSheetId,
        selection: pruneSelection(s.selection, prev, activeSheetId),
        history: { past: s.history.past.slice(0, -1), future: [s.design, ...s.history.future], coalesceKey: null, lastCommitAt: 0 },
      });
      return true;
    },
    redo() {
      drag = null;
      const s = getState();
      const next = s.history.future[0];
      if (!next) return false;
      const activeSheetId = ops.getSheet(next, s.activeSheetId) ? s.activeSheetId : next.sheets[0].id;
      setState({
        ...s,
        design: next,
        activeSheetId,
        selection: pruneSelection(s.selection, next, activeSheetId),
        history: { past: pushLimited(s.history.past, s.design), future: s.history.future.slice(1), coalesceKey: null, lastCommitAt: 0 },
      });
      return true;
    },
    /** Fresh coalescing key, e.g. for a label drag or a slider gesture. */
    newCoalesceKey(prefix = 'op') {
      keySeq += 1;
      return `${prefix}:${keySeq}`;
    },

    // ------------------------------------------------------------------- sheets
    setActiveSheet(id: string) {
      const s = getState();
      if (s.activeSheetId === id || !ops.getSheet(s.design, id)) return;
      drag = null;
      patch({ activeSheetId: id, selection: [] });
    },
    /** Add a sheet to the design level of the active sheet (root or the open child design). */
    addSheet(name?: string) {
      const s = getState();
      const r = ops.addSheet(s.design, name, s.activeSheetId);
      commit(r.design);
      actions.setActiveSheet(r.id);
      return r.id;
    },
    renameSheet(id: string, name: string) {
      commit(ops.renameSheet(getState().design, id, name));
    },
    deleteSheet(id: string) {
      const s = getState();
      const loc = findSheet(s.design, id);
      const next = ops.deleteSheet(s.design, id);
      if (next === s.design || !loc) return false;
      if (s.activeSheetId === id) {
        const level = loc.child ? getChild(next, loc.child.id)!.sheets : next.sheets;
        const neighbour = level[Math.max(0, loc.index - 1)];
        patch({ activeSheetId: neighbour.id, selection: [] });
      }
      commit(next);
      return true;
    },
    moveSheet(id: string, toIndex: number) {
      commit(ops.moveSheet(getState().design, id, toIndex));
    },

    // ---------------------------------------------------------------- selection
    /** Select items (members of a group bring the whole group). */
    select(items: SelItem[]) {
      const s = getState();
      patch({ selection: pruneSelection(sops.expandGroups(activeSheet(s), items), s.design, s.activeSheetId) });
    },
    toggleSelect(item: SelItem) {
      const s = getState();
      const group = sops.expandGroups(activeSheet(s), [item]);
      const on = s.selection.some((x) => x.kind === item.kind && x.id === item.id);
      const inGroup = (x: SelItem) => group.some((g) => g.kind === x.kind && g.id === x.id);
      patch({ selection: on ? s.selection.filter((x) => !inGroup(x)) : [...s.selection, ...group.filter((g) => !s.selection.some((x) => x.kind === g.kind && x.id === g.id))] });
    },
    addToSelection(items: SelItem[]) {
      const s = getState();
      const all = sops.expandGroups(activeSheet(s), items);
      const extra = all.filter((it) => !s.selection.some((x) => x.kind === it.kind && x.id === it.id));
      if (extra.length) patch({ selection: [...s.selection, ...extra] });
    },
    clearSelection() {
      if (getState().selection.length) patch({ selection: [] });
    },
    selectAll() {
      const sheet = activeSheet(getState());
      patch({
        selection: [
          ...sheet.parts.map((p) => ({ kind: 'part' as const, id: p.id })),
          ...sheet.wires.map((w) => ({ kind: 'wire' as const, id: w.id })),
          ...sheet.labels.map((l) => ({ kind: 'label' as const, id: l.id })),
          ...sheet.probes.map((p) => ({ kind: 'probe' as const, id: p.id })),
          ...sheet.notes.map((n) => ({ kind: 'note' as const, id: n.id })),
          ...(sheet.shapes ?? []).map((x) => ({ kind: 'shape' as const, id: x.id })),
        ],
      });
    },

    // -------------------------------------------------------------------- tools
    setTool(tool: ToolState) {
      drag = null;
      patch({ tool });
    },
    /**
     * Enter placement mode for a library part (ghost follows the cursor until Esc). With
     * `once`, the tool returns to select after one part and onPartPlaced listeners are told (the
     * Select-a-component dialog reopens for the next part).
     */
    startPlacing(partId: string, opts: { once?: boolean } = {}) {
      if (!lookup(partId) || !placementAllowed(partId)) return;
      const child = childIdOfPart(partId);
      if (child !== undefined && wouldNestItself(getState().design, activeLevel(getState()), child)) return;
      patch({ tool: { kind: 'place', partId, rotation: 0, mirror: false, ...(opts.once ? { once: true } : {}) } });
    },
    /** Listen for parts placed by a one-shot placement (see startPlacing); returns the unsubscribe. */
    onPartPlaced(cb: (instId: string, partId: string) => void): () => void {
      placedListeners.add(cb);
      return () => {
        placedListeners.delete(cb);
      };
    },
    /** Rotate / mirror the placement ghost. */
    transformGhost(op: ops.TransformOp) {
      const t = getState().tool;
      if (t.kind !== 'place') return;
      const o = ops.transformOrientation(t.rotation, t.mirror, op);
      patch({ tool: { ...t, rotation: o.rotation, mirror: o.mirror } });
    },
    cancelTool() {
      drag = null;
      patch({ tool: { kind: 'select' } });
    },

    // ----------------------------------------------------------------- creation
    placePart(partId: string, pos: Point, rotation: Rotation = 0, mirror = false): string | null {
      if (!placementAllowed(partId)) return null;
      const child = childIdOfPart(partId);
      if (child !== undefined) {
        // a block: never inside its own child design (that would nest forever)
        if (wouldNestItself(getState().design, activeLevel(getState()), child)) return null;
        const b = hops.placeBlock(getState().design, sheetId(), child, pos, baseLookup, rotation, mirror);
        if (!b.id) return null;
        commit(b.design, { selection: [{ kind: 'part', id: b.id }] });
        return b.id;
      }
      const r = ops.placePart(getState().design, sheetId(), partId, pos, rotation, mirror, lookup, { newPackage: !!getState().ui.newPackage });
      if (!r.id) return null;
      commit(r.design, { selection: [{ kind: 'part', id: r.id }] });
      const tool = getState().tool;
      if (tool.kind === 'place' && tool.once && tool.partId === partId) {
        patch({ tool: { kind: 'select' } });
        for (const l of Array.from(placedListeners)) l(r.id, partId);
      }
      return r.id;
    },
    addWire(points: Point[], color?: string): string | null {
      const r = ops.addWire(getState().design, sheetId(), points, lookup, color);
      commit(r.design, { selection: r.id ? [{ kind: 'wire', id: r.id }] : [] });
      return r.id;
    },
    addNetLabel(pos: Point, name: string, rotation: Rotation = 0): string | null {
      if (!name.trim()) return null;
      const r = ops.addNetLabel(getState().design, sheetId(), pos, name, rotation);
      commit(r.design, { selection: [{ kind: 'label', id: r.id }] });
      return r.id;
    },
    addProbe(kind: ProbeKind, pos: Point, ref?: Point): string {
      const r = ops.addProbe(getState().design, sheetId(), kind, pos, ref);
      commit(r.design, { selection: [{ kind: 'probe', id: r.id }] });
      return r.id;
    },
    addNote(pos: Point, text: string, size?: number): string | null {
      if (!text.trim()) return null;
      const r = ops.addNote(getState().design, sheetId(), pos, text, size);
      commit(r.design, { selection: [{ kind: 'note', id: r.id }] });
      return r.id;
    },

    // ------------------------------------------------------------------ editing
    /** Delete the selection (locked items stay). */
    deleteSelection() {
      const s = getState();
      const sel = sops.unlockedSelection(s.design, s.activeSheetId, s.selection);
      if (!sel.length) return;
      commit(ops.deleteItems(s.design, s.activeSheetId, sel, lookup), { selection: s.selection.filter((x) => !sel.includes(x)) });
    },
    /** Start dragging the current selection (locked items stay put); follow with dragTo() and endDrag(). */
    beginDrag() {
      const s = getState();
      const sel = sops.unlockedSelection(s.design, s.activeSheetId, s.selection);
      if (!sel.length) return;
      keySeq += 1;
      drag = { base: s.design, baseHistory: s.history, key: `drag:${keySeq}`, sheetId: s.activeSheetId, sel, dx: 0, dy: 0 };
    },
    /** Move the dragged selection to a total offset (dx, dy) from where the drag began. */
    dragTo(dx: number, dy: number) {
      if (!drag || (drag.dx === dx && drag.dy === dy)) return;
      drag.dx = dx;
      drag.dy = dy;
      if (dx === 0 && dy === 0) {
        const s = getState();
        setState({ ...s, design: drag.base, history: drag.baseHistory, selection: drag.sel });
        return;
      }
      commit(ops.moveItems(drag.base, drag.sheetId, drag.sel, dx, dy, lookup), { coalesce: drag.key, selection: getState().selection });
    },
    /** Finish a drag: normalise wires (auto split / merge) within the same undo step. */
    endDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.dx === 0 && d.dy === 0) return;
      commit(ops.normalizeDesignSheet(getState().design, d.sheetId, lookup), { coalesce: d.key, selection: getState().selection });
    },
    cancelDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      const s = getState();
      setState({ ...s, design: d.base, history: d.baseHistory, selection: s.selection });
    },
    isDragging() {
      return drag !== null;
    },
    /** Arrow-key move; consecutive nudges within one second form one undo step. */
    nudge(dx: number, dy: number) {
      const s = getState();
      const sel = sops.unlockedSelection(s.design, s.activeSheetId, s.selection);
      if (!sel.length) return;
      const moved = ops.moveItems(s.design, s.activeSheetId, sel, dx, dy, lookup);
      commit(ops.normalizeDesignSheet(moved, s.activeSheetId, lookup), { coalesce: 'nudge', windowMs: NUDGE_COALESCE_MS });
    },
    rotateSelection(dir: 'cw' | 'ccw' = 'cw') {
      const s = getState();
      commit(ops.transformItems(s.design, s.activeSheetId, sops.unlockedSelection(s.design, s.activeSheetId, s.selection), dir, lookup));
    },
    flipSelection(axis: 'h' | 'v') {
      const s = getState();
      commit(ops.transformItems(s.design, s.activeSheetId, sops.unlockedSelection(s.design, s.activeSheetId, s.selection), axis === 'h' ? 'flipH' : 'flipV', lookup));
    },
    copy() {
      const s = getState();
      const c = ops.copyItems(s.design, s.activeSheetId, s.selection, lookup);
      if (!c) return false;
      clipboard = c;
      clipboardHiddenBy = clipboardRestrictionKey(s.design);
      pasteCount = 0;
      patch({ clipboardAvailable: true });
      return true;
    },
    cut() {
      if (actions.copy()) actions.deleteSelection();
    },
    /** Paste with the fragment's top-left at `at` (sheet coordinates) or offset from the source. */
    paste(at?: Point) {
      if (!clipboard) return false;
      const s = getState();
      // parts copied from a design whose values the instructor hides only paste back into it
      if (!pasteAllowed(clipboardHiddenBy, s.design)) {
        actions.addSimMessage('warning', t('learn.restricted.paste'), 'instructor');
        return false;
      }
      let offset: Point;
      if (at) offset = { x: snap(at.x) - clipboard.anchor.x, y: snap(at.y) - clipboard.anchor.y };
      else {
        pasteCount += 1;
        offset = { x: 20 * pasteCount, y: 20 * pasteCount };
      }
      const r = ops.pasteItems(s.design, s.activeSheetId, clipboard, offset, lookup);
      if (commit(r.design, { selection: r.selection })) reportSanitize(r.notes);
      return true;
    },
    /**
     * Insert a generated fragment (circuit wizards, logic converter) on a sheet (default: the
     * active one), shifted by `offset`, as one undo step. Refdes are re-annotated like a paste;
     * net label names are kept. Returns the selection of the inserted items.
     */
    insertFragment(fragment: Clipboard, offset: Point, sheetId?: string): SelItem[] {
      const s = getState();
      const target = sheetId ?? s.activeSheetId;
      const r = ops.pasteItems(s.design, target, fragment, offset, lookup);
      if (commit(r.design, { selection: target === s.activeSheetId ? r.selection : [] })) reportSanitize(r.notes);
      return r.selection;
    },
    /**
     * Place a snippet (src/model/snippet.ts) on the active sheet with its top-left corner at `at`
     * (default: 20 units right / below the fragment's own position), as one undo step: the
     * snippet's user components are embedded, its global parameters and custom SPICE text added
     * where the design lacks them, and parts keep their refdes unless it is taken (then the next
     * free one). Returns the selection of the placed items (empty when restrictions refuse it).
     */
    insertSnippet(fragment: Clipboard, extras: IncomingExtras, at?: Point): SelItem[] {
      const s = getState();
      const offset = at ? { x: snap(at.x) - fragment.anchor.x, y: snap(at.y) - fragment.anchor.y } : { x: 20, y: 20 };
      const r = ops.pasteItems(s.design, s.activeSheetId, fragment, offset, lookup, { keepRefdes: true, extras });
      const ok = commit(r.design, { selection: r.selection });
      if (ok) reportSanitize(r.notes);
      return ok ? r.selection : [];
    },
    /** Copy + paste the selection with a small offset without touching the clipboard. */
    duplicate() {
      const s = getState();
      const c = ops.copyItems(s.design, s.activeSheetId, s.selection, lookup);
      if (!c) return false;
      const r = ops.pasteItems(s.design, s.activeSheetId, c, { x: 20, y: 20 }, lookup);
      commit(r.design, { selection: r.selection });
      return true;
    },
    getClipboard(): Clipboard | null {
      return clipboard;
    },
    /**
     * Paste special (Edit > Paste special), one undo step. Modes:
     *  - 'keepNames': the copied parts keep their designators where those are free (a designator
     *    that is taken gets the next free number); use it to bring a circuit over from another
     *    document without renaming it;
     *  - 'values': only the parameter values of the copied parts are written onto the SELECTED
     *    parts of the same kind (position, wiring and designators stay);
     *  - 'block': the copied circuit is pasted and at once replaced by a subcircuit / hierarchical
     *    block named `o.name` (default "Block"), with ports where nets leave the fragment.
     * Returns what happened so the caller can tell the learner.
     */
    pasteSpecial(mode: 'keepNames' | 'values' | 'block', o: { at?: Point; name?: string; kind?: ChildDesign['kind'] } = {}): PasteSpecialResult {
      if (!clipboard) return { ok: false, reason: 'noClipboard' };
      const s = getState();
      if (!pasteAllowed(clipboardHiddenBy, s.design)) {
        actions.addSimMessage('warning', t('learn.restricted.paste'), 'instructor');
        return { ok: false, reason: 'restricted' };
      }
      if (mode === 'values') {
        const r = ops.pasteValuesOnly(s.design, s.activeSheetId, clipboard, s.selection, lookup);
        if (!r.changed) return { ok: false, reason: s.selection.some((x) => x.kind === 'part') ? 'nothingMatched' : 'noTarget' };
        if (commit(r.design)) reportSanitize(r.notes);
        return { ok: true, count: r.changed };
      }
      let offset: Point;
      if (o.at) offset = { x: snap(o.at.x) - clipboard.anchor.x, y: snap(o.at.y) - clipboard.anchor.y };
      else {
        pasteCount += 1;
        offset = { x: 20 * pasteCount, y: 20 * pasteCount };
      }
      const r = ops.pasteItems(s.design, s.activeSheetId, clipboard, offset, lookup, { keepRefdes: mode === 'keepNames' });
      if (mode === 'keepNames') {
        // the pasted parts come back in the order of the copied ones
        const placed = new Map((ops.getSheet(r.design, s.activeSheetId)?.parts ?? []).map((q) => [q.id, q]));
        const ids = r.selection.filter((x) => x.kind === 'part').map((x) => x.id);
        const renamed = clipboard.parts.filter((p, i) => placed.get(ids[i])?.refdes !== p.refdes).length;
        const kept = ids.length;
        if (commit(r.design, { selection: r.selection })) reportSanitize(r.notes);
        return { ok: true, count: kept, renamed };
      }
      if (!r.selection.some((x) => x.kind === 'part')) return { ok: false, reason: 'noParts' };
      const block = hops.replaceWithSubcircuit(r.design, s.activeSheetId, r.selection, { kind: o.kind ?? 'subcircuit', name: o.name?.trim() || 'Block', sheetName: t('sheet.default', { n: 1 }) }, baseLookup);
      if (!block) return { ok: false, reason: 'noParts' };
      if (commit(block.design, { selection: [{ kind: 'part', id: block.blockId }] })) reportSanitize(r.notes);
      return { ok: true, count: 1, childId: block.childId };
    },
    /** Edit > Order: move the selected shapes / texts in the drawing order (one undo step). */
    orderSelection(op: OrderOp): boolean {
      const s = getState();
      const refs = annotationRefs(s.selection);
      if (!refs.length) return false;
      const sheet = ops.getSheet(s.design, s.activeSheetId);
      if (!sheet) return false;
      const next = reorderAnnotations(sheet, refs, op);
      if (next === sheet) return false;
      return commit(ops.updateSheet(s.design, s.activeSheetId, () => next));
    },
    /**
     * Edit > Layer settings: show or hide drawing layers on the given sheets (default: the active
     * sheet), one undo step. Hiding a layer changes the drawing only, never the circuit.
     */
    setSheetLayers(layers: SheetLayers, sheetIds?: readonly string[]): boolean {
      const s = getState();
      let d = s.design;
      for (const id of sheetIds ?? [s.activeSheetId]) d = ops.updateSheet(d, id, (sh) => setSheetLayers(sh, layers));
      return commit(d);
    },
    /**
     * Tools > Reference designator prefixes: store the rules and, when `rename` is set, rename the
     * parts already placed to follow them (numbers are kept). One undo step; returns the number of
     * designators renamed and those that could not be (a clash).
     */
    setRefdesRules(rules: RefdesRules | undefined, rename = false): ApplyRulesResult {
      const d = getState().design;
      if (rename) {
        const r = applyRulesToDesign(d, rules);
        commit(r.design);
        return r;
      }
      const normalized = normalizeRules(rules);
      if (JSON.stringify(normalized ?? null) === JSON.stringify(d.refdesRules ?? null)) return { design: d, changed: 0, skipped: [] };
      const next: Design = { ...d };
      if (normalized) next.refdesRules = normalized;
      else delete next.refdesRules;
      commit(next);
      return { design: next, changed: 0, skipped: [] };
    },
    updatePart(partId: string, p: Partial<Omit<PartInstance, 'id'>>, o: CommitOptions = {}) {
      const s = getState();
      const found = ops.findItem(s.design, 'part', partId);
      if (!found) return;
      commit(ops.updatePart(s.design, found.sheetId, partId, p), o);
    },
    /** Set a parameter value text (null resets to the library default). */
    setPartParam(partId: string, key: string, value: string | null) {
      const s = getState();
      const found = ops.findItem(s.design, 'part', partId);
      if (!found) return;
      commit(ops.setPartParam(s.design, found.sheetId, partId, key, value, lookup));
    },
    /** Change a refdes; returns an error message (and changes nothing) when invalid. */
    setRefdes(partId: string, refdes: string): string | null {
      const s = getState();
      const err = validateRefdes(s.design, refdes, partId);
      if (err) return err;
      actions.updatePart(partId, { refdes: refdes.trim() });
      return null;
    },
    /** Move a part's ref/value label to a sheet-aligned offset from the part origin (null = default). */
    setLabelOffset(partId: string, which: 'ref' | 'value', offset: Point | null, o: CommitOptions = {}) {
      actions.updatePart(partId, which === 'ref' ? { refOffset: offset ?? undefined } : { valueOffset: offset ?? undefined }, o);
    },
    updateWire(id: string, p: Partial<Wire>, o: CommitOptions = {}) {
      const s = getState();
      const f = ops.findItem(s.design, 'wire', id);
      if (f) commit(ops.updateItem(s.design, f.sheetId, 'wires', id, p), o);
    },
    updateLabel(id: string, p: Partial<NetLabel>, o: CommitOptions = {}) {
      const s = getState();
      const f = ops.findItem(s.design, 'label', id);
      if (!f) return;
      let next = ops.updateItem(s.design, f.sheetId, 'labels', id, p);
      // renaming the last label of a net renames the net: its settings (colour, PCB properties)
      // follow the name instead of staying behind on a name nothing uses any more
      const before = (f.item as NetLabel).name;
      if (p.name !== undefined && p.name.trim() && p.name.trim().toLowerCase() !== before.trim().toLowerCase()) {
        const stillUsed = levelSheets(next, f.sheetId).some((sh) => sh.labels.some((l) => l.id !== id && l.name.trim().toLowerCase() === before.trim().toLowerCase()));
        if (!stillUsed) next = renameNetAcrossSettings(next, before, p.name);
      }
      commit(next, o);
    },
    updateProbe(id: string, p: Partial<Probe>, o: CommitOptions = {}) {
      const s = getState();
      const f = ops.findItem(s.design, 'probe', id);
      if (f) commit(ops.updateItem(s.design, f.sheetId, 'probes', id, p), o);
    },
    updateNote(id: string, p: Partial<TextNote>, o: CommitOptions = {}) {
      const s = getState();
      const f = ops.findItem(s.design, 'note', id);
      if (f) commit(ops.updateItem(s.design, f.sheetId, 'notes', id, p), o);
    },
    updateShape(id: string, p: Partial<Shape>, o: CommitOptions = {}) {
      const s = getState();
      const f = ops.findItem(s.design, 'shape', id);
      if (f) commit(ops.updateItem(s.design, f.sheetId, 'shapes', id, p), o);
    },

    // ------------------------------------------------- connectors, buses, annotations
    /** Place a net label, connector or bus entry on the active sheet. */
    addLabelItem(pos: Point, name: string, rotation: Rotation = 0, kind: LabelKind = 'label', global = false): string | null {
      if (!name.trim()) return null;
      const r = sops.addLabelItem(getState().design, sheetId(), pos, name, rotation, kind, global);
      commit(r.design, { selection: [{ kind: 'label', id: r.id }] });
      return r.id;
    },
    addBus(points: Point[], name?: string): string | null {
      const r = sops.addBus(getState().design, sheetId(), points, lookup, name);
      commit(r.design, { selection: r.id ? [{ kind: 'wire', id: r.id }] : [] });
      return r.id;
    },
    /** Give every segment of the bus containing `wireId` one name (rename / merge buses). */
    renameBus(wireId: string, name: string) {
      const s = getState();
      const f = ops.findItem(s.design, 'wire', wireId);
      if (f) commit(sops.renameBus(s.design, f.sheetId, wireId, name));
    },
    connectPinsToBus(partId: string, pins: string[], lines: string[]): number {
      const s = getState();
      const f = ops.findItem(s.design, 'part', partId);
      if (!f) return 0;
      const r = sops.connectPinsToBus(s.design, f.sheetId, partId, pins, lines, lookup);
      commit(r.design);
      return r.ids.length;
    },
    addShape(shape: Omit<Shape, 'id'>): string {
      const r = sops.addShape(getState().design, sheetId(), shape);
      commit(r.design, { selection: [{ kind: 'shape', id: r.id }] });
      return r.id;
    },
    addComment(pos: Point, text: string, author = ''): string | null {
      if (!text.trim()) return null;
      const r = sops.addComment(getState().design, sheetId(), pos, text, author, new Date(now()));
      commit(r.design, { selection: [{ kind: 'note', id: r.id }] });
      return r.id;
    },
    setLocked(locked: boolean) {
      const s = getState();
      commit(sops.setLocked(s.design, s.activeSheetId, s.selection, locked));
    },
    groupSelection(): boolean {
      const s = getState();
      const r = sops.groupItems(s.design, s.activeSheetId, s.selection);
      if (!r.group) return false;
      commit(r.design);
      return true;
    },
    ungroupSelection() {
      const s = getState();
      commit(sops.ungroupItems(s.design, s.activeSheetId, s.selection));
    },
    alignSelection(mode: sops.AlignMode) {
      const s = getState();
      commit(sops.alignItems(s.design, s.activeSheetId, sops.unlockedSelection(s.design, s.activeSheetId, s.selection), mode, lookup));
    },
    distributeSelection(axis: 'h' | 'v') {
      const s = getState();
      commit(sops.distributeItems(s.design, s.activeSheetId, sops.unlockedSelection(s.design, s.activeSheetId, s.selection), axis, lookup));
    },
    /** Replace a placed part by another library part, keeping its wires (see schematicOps.replacePart). */
    replacePart(partId: string, newPartId: string): boolean {
      const s = getState();
      const f = ops.findItem(s.design, 'part', partId);
      if (!f) return false;
      return commit(sops.replacePart(s.design, f.sheetId, partId, newPartId, lookup), { selection: [{ kind: 'part', id: partId }] });
    },

    // -------------------------------------------------------------- ladder sheets
    /**
     * Add a ladder sheet (rails and rungs) to the design level of the active sheet and open it.
     * It starts with one rung so the learner sees what a rung looks like.
     */
    addLadderSheet(name?: string) {
      const s = getState();
      const n = levelSheetsOf(s).filter((sh) => sh.kind === 'ladder').length + 1;
      const r = ops.addSheet(s.design, name ?? t('ladder.sheet.default', { n }), s.activeSheetId);
      const id = r.id;
      const design = ops.updateSheet(r.design, id, (sh) => ({ ...sh, kind: 'ladder', ladder: [newRung(newId('rung'))] }));
      commit(design);
      actions.setActiveSheet(id);
      return id;
    },
    /** Replace the rungs of a ladder sheet (one undo step). */
    setLadderRungs(sheetId: string, rungs: LadderRung[]) {
      commit(ops.updateSheet(getState().design, sheetId, (sh) => (sh.kind === 'ladder' ? { ...sh, ladder: rungs } : sh)));
    },
    /** Replace the function blocks of the ladder program (one undo step; an empty list removes the field). */
    setLadderBlocks(blocks: LadderBlock[]) {
      const design = { ...getState().design };
      if (blocks.length) design.ladderBlocks = blocks;
      else delete design.ladderBlocks;
      commit(design);
    },
    /** Rename a function block and every call of it (one undo step). */
    renameLadderBlock(id: string, name: string) {
      const next = renameLadderBlockInDesign(getState().design, id, name);
      if (next !== getState().design) commit(next);
    },
    /** Live state of the running ladder program (set by the simulation controller). */
    setLadderLive(live: LadderLive | null) {
      patch({ ladderLive: live });
    },

    // -------------------------------------------------------------- sheet / document
    setSheetProps(id: string, props: SheetProps | undefined) {
      commit(ops.updateSheet(getState().design, id, (sh) => {
        if (JSON.stringify(sh.props ?? null) === JSON.stringify(props ?? null)) return sh;
        const next = { ...sh };
        if (props && Object.keys(props).length) next.props = props;
        else delete next.props;
        return next;
      }));
    },
    setTitleBlock(fields: TitleBlockFields | undefined) {
      const d = getState().design;
      if (JSON.stringify(d.titleBlock ?? null) === JSON.stringify(fields ?? null)) return;
      const next: Design = { ...d };
      if (fields && Object.keys(fields).length) next.titleBlock = fields;
      else delete next.titleBlock;
      commit(next);
    },
    setPrintSetup(setup: PrintSetup | undefined) {
      const d = getState().design;
      if (JSON.stringify(d.printSetup ?? null) === JSON.stringify(setup ?? null)) return;
      const next: Design = { ...d };
      if (setup && Object.keys(setup).length) next.printSetup = setup;
      else delete next.printSetup;
      commit(next);
    },

    // -------------------------------------------------------------------- hierarchy
    /** New empty subcircuit / hierarchical block; opens its first sheet. Returns the child id. */
    createChild(opts: hops.NewChildOptions): string {
      const r = hops.createChild(getState().design, { sheetName: t('sheet.default', { n: 1 }), ...opts });
      commit(r.design);
      return r.childId;
    },
    /** Move the selection into a new child design and put its block in its place. */
    replaceWithSubcircuit(kind: ChildDesign['kind'], name: string): hops.ReplaceResult | null {
      const s = getState();
      const r = hops.replaceWithSubcircuit(s.design, s.activeSheetId, s.selection, { kind, name, sheetName: t('sheet.default', { n: 1 }) }, baseLookup);
      if (!r) return null;
      commit(r.design, { selection: [{ kind: 'part', id: r.blockId }] });
      return r;
    },
    /** Add a hierarchical block made from another design (e.g. a .msim file). Returns the child id. */
    addChildFromDesign(source: Design, name: string, sourceFile?: string): string {
      const r = hops.childFromDesign(getState().design, source, name, sourceFile);
      if (commit(r.design)) reportSanitize(r.notes);
      return r.childId;
    },
    updateChildInfo(childId: string, patch: Parameters<typeof hops.updateChildInfo>[2]) {
      commit(hops.updateChildInfo(getState().design, childId, patch));
    },
    /** Delete an unused child design; false when blocks still use it. */
    deleteChild(childId: string): boolean {
      const d = getState().design;
      const next = hops.deleteChild(d, childId);
      if (next === d) return false;
      if (activeLevel(getState()) === childId) patch({ activeSheetId: d.sheets[0].id, selection: [] });
      commit(next);
      return true;
    },
    /** Show the first sheet of a child design (open / edit the child). */
    openChild(childId: string): boolean {
      const c = getChild(getState().design, childId);
      if (!c?.sheets[0]) return false;
      actions.setActiveSheet(c.sheets[0].id);
      return true;
    },
    /** Open the child design of a placed block. */
    openBlock(partId: string): boolean {
      const s = getState();
      const f = ops.findItem(s.design, 'part', partId);
      const inst = f ? (f.item as PartInstance) : undefined;
      const child = inst ? childIdOfPart(inst.partId) : undefined;
      if (child === undefined || !inst) return false;
      // the copy that is opened: the block's own refdes below the copy the learner is looking at
      const viewPath = [...activeViewPath(s), inst.refdes];
      if (!actions.openChild(child)) return false;
      patch({ viewPath });
      return true;
    },
    /** Choose which placed copy of the open block is shown (see EditorState.viewPath). */
    setViewPath(path: string[]) {
      if (getState().viewPath.join('/') !== path.join('/')) patch({ viewPath: path });
    },
    /** From a child sheet back to the sheet holding (the first instance of) its block. */
    goToParent(): boolean {
      const s = getState();
      const view = activeViewPath(s);
      if (view.length > 0) {
        // back to the sheet that holds the block copy the learner came from
        const parent = resolveLivePart(s.design, view.slice(0, -1), view[view.length - 1]);
        if (parent) {
          actions.setActiveSheet(parent.sheetId);
          patch({ selection: [{ kind: 'part', id: parent.part.id }], viewPath: view.slice(0, -1) });
          return true;
        }
      }
      const path = levelPath(s);
      if (path.length < 2) return false;
      const node = path[path.length - 1];
      const b = node.block;
      if (!b) return false;
      actions.setActiveSheet(b.sheetId);
      patch({ selection: [{ kind: 'part', id: b.inst.id }] });
      return true;
    },
    /** Renumber all refdes per prefix in reading order. */
    renumber() {
      commit(ops.renumberParts(getState().design, lookup));
    },
    /**
     * Annotate with src/model/annotate.ts: 'missing' numbers parts whose refdes is empty, has no
     * number ("R?") or repeats an earlier one; 'all' renumbers everything per prefix. One undo
     * step; returns the number of parts whose designator changed.
     */
    annotate(mode: 'missing' | 'all' = 'missing'): number {
      const d = getState().design;
      // every design level (root, each child design) is numbered on its own
      const changes: Record<string, string> = { ...annotateDesign(d, { mode }).changes };
      for (const c of d.children ?? []) Object.assign(changes, annotateDesign({ ...d, sheets: c.sheets }, { mode }).changes);
      // apply only the changed designators so untouched parts keep their identity
      let next = d;
      for (const [id, refdes] of Object.entries(changes)) {
        const f = ops.findItem(next, 'part', id);
        if (f) next = ops.updatePart(next, f.sheetId, id, { refdes });
      }
      commit(next);
      return Object.keys(changes).length;
    },
    /** Select a part by refdes, switch to its sheet and centre it. Returns false when not found. */
    findAndShow(refdes: string): boolean {
      const s = getState();
      // a top-level refdes, or the path of a part inside a block ("X2.LED1"): open that copy
      const top = ops.findPartByRefdes(s.design, refdes);
      const copy = top ? null : resolveLiveName(s.design, refdes);
      const f = top ?? copy;
      if (!f) return false;
      actions.setActiveSheet(f.sheetId);
      patch({ selection: [{ kind: 'part', id: f.part.id }], viewPath: copy ? copy.path : [] });
      const st = getState();
      setView(f.sheetId, centerOn(viewOf(st, f.sheetId), f.part, st.viewportSize));
      return true;
    },

    // --------------------------------------------------------------------- view
    setView(id: string, view: ViewState) {
      setView(id, view);
    },
    setViewportSize(size: { w: number; h: number }) {
      const s = getState();
      if (s.viewportSize.w !== size.w || s.viewportSize.h !== size.h) patch({ viewportSize: size });
    },
    /** Zoom by a factor around a canvas pixel position (default: viewport centre). */
    zoomBy(factor: number, at?: Point) {
      const s = getState();
      const c = at ?? { x: s.viewportSize.w / 2, y: s.viewportSize.h / 2 };
      setView(s.activeSheetId, zoomAt(viewOf(s), c, factor));
    },
    zoomTo(zoom: number) {
      const s = getState();
      const v = viewOf(s);
      actions.zoomBy(zoom / v.zoom);
    },
    fitAll() {
      const s = getState();
      showRect(ops.itemsBounds(activeSheet(s), null, lookup));
    },
    fitSelection() {
      const s = getState();
      const b = s.selection.length ? ops.itemsBounds(activeSheet(s), s.selection, lookup) : null;
      if (b) showRect({ x: b.x - 20, y: b.y - 20, w: b.w + 40, h: b.h + 40 });
      else actions.fitAll();
    },
    setShowGrid(on: boolean) {
      patch({ showGrid: on });
    },
    setShowErc(on: boolean) {
      patch({ showErc: on });
    },
    setUi(p: Partial<UiState>) {
      setState((s) => ({ ...s, ui: { ...s.ui, ...p } }));
    },

    // ---------------------------------------------------------- integration data
    setErcMarkers(markers: ErcMessage[]) {
      patch({ ercMarkers: markers, showErc: true });
    },
    clearErcMarkers() {
      patch({ ercMarkers: [] });
    },
    addSimMessage(severity: SimMessageSeverity, text: string, source?: string) {
      msgSeq += 1;
      const msg = { id: msgSeq, time: now(), severity, text, ...(source ? { source } : {}) };
      setState((s) => ({ ...s, simMessages: [...s.simMessages.slice(-(MAX_SIM_MESSAGES - 1)), msg] }));
    },
    clearSimMessages() {
      patch({ simMessages: [] });
    },
    /** Replace all live probe read-outs (probe id -> text). */
    setProbeValues(values: Record<string, string>) {
      patch({ probeValues: values });
    },
    setProbeValue(probeId: string, text: string | null) {
      setState((s) => {
        const next = { ...s.probeValues };
        if (text === null) delete next[probeId];
        else next[probeId] = text;
        return { ...s, probeValues: next };
      });
    },
    /** Replace all indicator levels (refdes -> brightness, > 0 glows). */
    setIndicatorLevels(levels: Record<string, number>) {
      patch({ indicatorLevels: levels });
    },
    setIndicatorLevel(refdes: string, level: number) {
      setState((s) => ({ ...s, indicatorLevels: { ...s.indicatorLevels, [refdes]: level } }));
    },
    /** Replace the hot / burnt-out marks of rated parts (refdes -> state). */
    setRatingStates(states: Record<string, RatingState>) {
      patch({ ratingStates: states });
    },
    setSimStatus(p: Partial<SimStatus>) {
      setState((s) => ({ ...s, sim: { ...s.sim, ...p } }));
    },
    /** Clear probe values and indicator levels (call when a simulation stops). */
    clearLiveData() {
      patch({ probeValues: {}, indicatorLevels: {}, ladderLive: null });
    },

    // -------------------------------------------------------- interactive parts
    /**
     * Change an instance parameter from an interaction (switch, key press, slider) without
     * recording an undo step, then notify onInteractive listeners.
     */
    setInteractiveParam(refdes: string, param: string, value: string, path: readonly string[] = []): boolean {
      const s = getState();
      if (path.length > 0) return setCopyParam(refdes, param, value, path);
      const f = ops.findPartByRefdes(s.design, refdes);
      if (!f) return false;
      if (f.part.params[param] === value) return false;
      const next = ops.updatePart(s.design, f.sheetId, f.part.id, { params: { ...f.part.params, [param]: value } });
      // The interaction is not an undo step, so undo / redo must not bring the old value back
      // either: every snapshot in history that holds this part gets the same parameter value.
      const sync = (d: Design): Design => withInteractiveParam(d, f.part.id, f.part.partId, param, value);
      const history = { ...s.history, past: s.history.past.map(sync), future: s.history.future.map(sync) };
      if (drag) drag = { ...drag, base: sync(drag.base), baseHistory: { ...drag.baseHistory, past: drag.baseHistory.past.map(sync), future: drag.baseHistory.future.map(sync) } };
      setState({ ...s, design: next, history });
      emitInteractive(f.part.refdes, param, value);
      return true;
    },
    /**
     * Apply an interaction to a part with PartDef.interactive. `control` picks one control of a
     * multi-control part (InteractiveDef.controls: DIP switch position, keypad key; default the
     * first). Returns the new value or null.
     */
    interact(refdes: string, phase: InteractionPhase, control?: number, path: readonly string[] = []): string | null {
      const s = getState();
      // a part inside a placed block: its state lives in that copy (PartInstance.inner)
      const copy = path.length > 0 ? resolveLivePart(s.design, path, refdes) : null;
      if (path.length > 0 && !copy) return null;
      const f = copy ? { sheetId: copy.sheetId, part: { ...copy.part, params: liveParams(copy) } } : ops.findPartByRefdes(s.design, refdes);
      if (!f) return null;
      const def = lookup(f.part.partId);
      const idef: InteractiveDef | undefined = def?.interactive;
      if (!def || !idef) return null;
      const ctl = control !== undefined ? idef.controls?.[control] : undefined;
      const param = ctl?.param ?? idef.param;
      const pdef = def.params.find((p) => p.key === param);
      const current = f.part.params[param] ?? pdef?.default ?? '';
      if (ctl?.value !== undefined) {
        // selector control (rotary switch contact): choose its value; release does nothing
        if (phase === 'release' || ctl.value === current) return null;
        actions.setInteractiveParam(f.part.refdes, param, ctl.value, path);
        return ctl.value;
      }
      const instNum = (key: string | undefined): number | undefined => {
        if (!key) return undefined;
        const text = f.part.params[key] ?? def.params.find((p) => p.key === key)?.default ?? '';
        const v = parseUserNumber(text);
        return text.trim() !== '' && Number.isFinite(v) ? v : undefined;
      };
      const next = nextInteractiveValue(idef, pdef, current, phase, { step: instNum(idef.stepParam), min: instNum(idef.minParam), max: instNum(idef.maxParam) });
      if (next === null || next === current) return null;
      actions.setInteractiveParam(f.part.refdes, param, next, path);
      return next;
    },
    onInteractiveChange(cb: InteractiveListener): () => void {
      interactiveListeners.add(cb);
      return () => {
        interactiveListeners.delete(cb);
      };
    },
  };

  return { getState, setState, subscribe, actions, lookup };
}

export type Editor = ReturnType<typeof createEditor>;
export type EditorActions = Editor['actions'];
