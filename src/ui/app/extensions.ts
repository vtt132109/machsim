/**
 * Extension API of the application shell — the integration point for the simulation engine,
 * instruments, results, reports and importers.
 *
 *   import {
 *     setSimulationController, registerBottomTab, registerFloatingWindowKind, openFloatingWindow,
 *     closeFloatingWindow, registerCommand, onInteractiveChange, getState, subscribe, actions,
 *   } from '../app/extensions';
 *
 * Every register* function returns an unregister function. Registries are observable stores, so
 * the menus / dock / window host update immediately when something is registered.
 */
import type { ReactNode } from 'react';
import type { AnalysisType } from '../../sim/netlist';
import { createStore } from '../store/createStore';
import { actions, editor, getState, subscribe } from '../store';
import type { InteractiveListener, SimState, SimStatus } from '../store';
import { t } from '../../i18n';

export { getState, subscribe, actions, editor, useEditor } from '../store';
export type { EditorState, SimStatus, SimState, SimMessage, SimMessageSeverity } from '../store';

// ---------------------------------------------------------------------------
// simulation controller
// ---------------------------------------------------------------------------

/**
 * Simulation back-end driven by the Run / Pause / Stop buttons, the Simulate menu and the
 * analysis selector. Methods may be async; thrown errors / rejections are reported in the status
 * bar and the Simulation messages tab.
 *
 * Status: either call `actions.setSimStatus({ state, message, simTime })` directly, or implement
 * `subscribe` (and optionally `getStatus`) — the shell mirrors every reported status into the
 * editor store (`getState().sim`).
 */
export interface SimulationController {
  /** start (or resume) the active analysis / interactive simulation */
  run(): void | Promise<void>;
  pause(): void | Promise<void>;
  stop(): void | Promise<void>;
  /** run one analysis type (Simulate > Run analysis) */
  runAnalysis(type: AnalysisType): void | Promise<void>;
  getStatus?(): SimStatus;
  subscribe?(listener: (status: SimStatus) => void): () => void;
}

/** Status text while no simulation controller is installed (current language). */
export const engineNotConnected = (): string => t('sim.engineNotConnected');

/** Controller used until the integration layer installs one. */
export const defaultSimulationController: SimulationController = {
  run() {
    actions.setSimStatus({ state: 'error', message: engineNotConnected(), simTime: 0 });
    actions.addSimMessage('error', engineNotConnected(), 'shell');
  },
  pause() {
    actions.setSimStatus({ state: 'idle', message: engineNotConnected() });
  },
  stop() {
    actions.setSimStatus({ state: 'idle', message: engineNotConnected(), simTime: 0 });
  },
  runAnalysis() {
    actions.setSimStatus({ state: 'error', message: engineNotConnected(), simTime: 0 });
    actions.addSimMessage('error', engineNotConnected(), 'shell');
  },
};

let controller: SimulationController = defaultSimulationController;
let controllerUnsub: (() => void) | null = null;
const controllerStore = createStore(0);

/** Install the simulation back-end (null restores the default). Returns a function that uninstalls it. */
export function setSimulationController(ctrl: SimulationController | null): () => void {
  controllerUnsub?.();
  controllerUnsub = null;
  const next = ctrl ?? defaultSimulationController;
  controller = next;
  if (next.getStatus) actions.setSimStatus(next.getStatus());
  else if (next !== defaultSimulationController) actions.setSimStatus({ state: 'idle', message: t('app.extensions.ready'), simTime: 0 });
  if (next.subscribe) controllerUnsub = next.subscribe((status) => actions.setSimStatus(status));
  controllerStore.setState((n) => n + 1);
  return () => {
    if (controller === next) setSimulationController(null);
  };
}

export function getSimulationController(): SimulationController {
  return controller;
}

/** True when a real controller (not the placeholder) is installed. */
export function isSimulationConnected(): boolean {
  return controller !== defaultSimulationController;
}

async function guarded(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    actions.setSimStatus({ state: 'error', message: t('app.extensions.labelFailedMessage', { label: label, message: message }) });
    actions.addSimMessage('error', t('app.extensions.labelFailedMessage', { label: label, message: message }), 'shell');
  }
}

/** Shell-side wrappers used by the toolbar / menus (errors are reported, never thrown). */
export const simulation = {
  run: () => guarded(t('sim.action.run'), () => controller.run()),
  pause: () => guarded(t('sim.action.pause'), () => controller.pause()),
  stop: () => guarded(t('sim.action.stop'), () => controller.stop()),
  runAnalysis: (type: AnalysisType) => guarded(t('sim.action.analysis'), () => controller.runAnalysis(type)),
};

/** Listen to simulation status changes (state, message, simTime). Fires only on change. */
export function onSimulationStatus(cb: (status: SimStatus) => void): () => void {
  let last = getState().sim;
  return subscribe(() => {
    const s = getState().sim;
    if (s !== last) {
      last = s;
      cb(s);
    }
  });
}

/** True while running or paused (interactive parts react to clicks). */
export function isSimulationActive(state: SimState = getState().sim.state): boolean {
  return state === 'running' || state === 'paused';
}

// ---------------------------------------------------------------------------
// bottom dock tabs
// ---------------------------------------------------------------------------

export interface BottomTabDef {
  /** unique id (also the value of getState().ui.dockTab while active) */
  id: string;
  title: string;
  render: () => ReactNode;
  /** sort key (built-in Spreadsheet = 0); default 100 */
  order?: number;
}

export const bottomTabs = createStore<BottomTabDef[]>([]);

/** Add a tab to the bottom dock. Re-registering an id replaces the tab. */
export function registerBottomTab(def: BottomTabDef): () => void {
  bottomTabs.setState((tabs) => [...tabs.filter((t) => t.id !== def.id), def].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)));
  return () => bottomTabs.setState((tabs) => tabs.filter((t) => t !== def));
}

/** Show a dock tab (opens the dock). */
export function showBottomTab(id: string): void {
  actions.setUi({ dockOpen: true, dockTab: id });
}

// ---------------------------------------------------------------------------
// main views (tabs above the drawing area: schematic, breadboard, ...)
// ---------------------------------------------------------------------------

/** Id of the built-in schematic view. */
export const SCHEMATIC_VIEW_ID = 'schematic';

export interface MainViewDef {
  /** unique id (also the value of activeMainView while shown) */
  id: string;
  title: string;
  render: () => ReactNode;
  /** sort key (the schematic view is 0); default 100 */
  order?: number;
}

/** Extension views shown as tabs next to the schematic (the tab strip appears once one exists). */
export const mainViews = createStore<MainViewDef[]>([]);
/** Id of the view shown in the centre area. */
export const activeMainView = createStore<string>(SCHEMATIC_VIEW_ID);

/** Add a main view tab. Re-registering an id replaces it. */
export function registerMainView(def: MainViewDef): () => void {
  mainViews.setState((views) => [...views.filter((v) => v.id !== def.id), def].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)));
  return () => {
    mainViews.setState((views) => views.filter((v) => v !== def));
    if (activeMainView.getState() === def.id) activeMainView.setState(SCHEMATIC_VIEW_ID);
  };
}

/** Show a main view (unknown ids fall back to the schematic). */
export function showMainView(id: string): void {
  activeMainView.setState(id === SCHEMATIC_VIEW_ID || mainViews.getState().some((v) => v.id === id) ? id : SCHEMATIC_VIEW_ID);
}

/** True while the schematic canvas is the visible main view (canvas shortcuts apply). */
export function isSchematicViewActive(): boolean {
  return activeMainView.getState() === SCHEMATIC_VIEW_ID;
}

// ---------------------------------------------------------------------------
// floating windows
// ---------------------------------------------------------------------------

/** Props passed to a floating window's render(): the props given to openFloatingWindow plus these. */
export interface FloatingWindowRenderProps {
  windowId: string;
  close: () => void;
  [key: string]: unknown;
}

export interface FloatingWindowKindDef {
  /** window title (function receives the open props, e.g. to show the refdes) */
  title: string | ((props: Record<string, unknown>) => string);
  render: (props: FloatingWindowRenderProps) => ReactNode;
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
}

export interface FloatingWindowState {
  id: string;
  kind: string;
  props: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface FloatingState {
  kinds: Record<string, FloatingWindowKindDef>;
  windows: FloatingWindowState[];
  /** id of the most recently focused window */
  active: string | null;
}

export const floating = createStore<FloatingState>({ kinds: {}, windows: [], active: null });
let windowSeq = 0;
let zSeq = 10;

/** Register the panel for a window kind (e.g. an InstrumentKind such as 'oscilloscope'). */
export function registerFloatingWindowKind(kind: string, def: FloatingWindowKindDef): () => void {
  floating.setState((s) => ({ ...s, kinds: { ...s.kinds, [kind]: def } }));
  return () =>
    floating.setState((s) => {
      if (s.kinds[kind] !== def) return s;
      const kinds = { ...s.kinds };
      delete kinds[kind];
      return { ...s, kinds };
    });
}

function sameProps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/**
 * Open a floating window of a registered kind. When a window of the same kind with equal props
 * is already open it is raised instead. Returns the window id.
 */
export function openFloatingWindow(kind: string, props: Record<string, unknown> = {}): string {
  const s = floating.getState();
  const existing = s.windows.find((w) => w.kind === kind && sameProps(w.props, props));
  if (existing) {
    focusFloatingWindow(existing.id);
    return existing.id;
  }
  windowSeq += 1;
  zSeq += 1;
  const def = s.kinds[kind];
  const size = def?.defaultSize ?? { w: 520, h: 360 };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cascade = (s.windows.length % 8) * 24;
  const win: FloatingWindowState = {
    id: `win-${windowSeq}`,
    kind,
    props,
    w: size.w,
    h: size.h,
    x: Math.max(8, Math.min(vw - size.w - 8, vw / 2 - size.w / 2 + cascade)),
    y: Math.max(40, Math.min(vh - size.h - 8, 90 + cascade)),
    z: zSeq,
  };
  floating.setState((st) => ({ ...st, windows: [...st.windows, win], active: win.id }));
  return win.id;
}

export function closeFloatingWindow(id: string): void {
  floating.setState((s) => (s.windows.some((w) => w.id === id) ? { ...s, windows: s.windows.filter((w) => w.id !== id), active: s.active === id ? null : s.active } : s));
}

export function focusFloatingWindow(id: string): void {
  floating.setState((s) => {
    const w = s.windows.find((x) => x.id === id);
    if (!w) return s;
    if (s.active === id && w.z === zSeq) return s;
    zSeq += 1;
    return { ...s, active: id, windows: s.windows.map((x) => (x.id === id ? { ...x, z: zSeq } : x)) };
  });
}

/** Move / resize a window (used by the window frame). */
export function setFloatingWindowGeometry(id: string, g: { x: number; y: number; w: number; h: number }): void {
  floating.setState((s) => ({ ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, ...g } : w)) }));
}

/** Replace the props of an open window. */
export function updateFloatingWindowProps(id: string, props: Record<string, unknown>): void {
  floating.setState((s) => ({ ...s, windows: s.windows.map((w) => (w.id === id ? { ...w, props } : w)) }));
}

/** Window title for a window state. */
export function floatingWindowTitle(w: FloatingWindowState, def: FloatingWindowKindDef | undefined): string {
  if (!def) return typeof w.props.refdes === 'string' ? `${w.kind} — ${w.props.refdes}` : w.kind;
  return typeof def.title === 'function' ? def.title(w.props) : def.title;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

export type CommandHandler = () => void | Promise<void>;

/** Command ids the shell's menus expose for extensions (disabled until registered). */
export const EXTENSION_COMMANDS = [
  'file.importSpice',
  'file.exportSpice',
  'file.examples',
  'reports.bom',
  'reports.netlist',
  'tools.erc',
  'simulate.analysisSettings',
  'simulate.grapher',
  'simulate.postprocessor',
  'simulate.importMeasurement',
  'simulate.interactiveSettings',
  'simulate.convergenceAssistant',
] as const;

/** Handlers registered by extensions (override built-in commands with the same id). */
export const commandRegistry = createStore<Record<string, CommandHandler>>({});
const builtins = new Map<string, CommandHandler>();

/** Register a command handler; returns the unregister function. */
export function registerCommand(id: string, handler: CommandHandler): () => void {
  commandRegistry.setState((r) => ({ ...r, [id]: handler }));
  return () =>
    commandRegistry.setState((r) => {
      if (r[id] !== handler) return r;
      const next = { ...r };
      delete next[id];
      return next;
    });
}

/** Shell-internal: built-in command implementation (extensions may override it). */
export function defineBuiltinCommand(id: string, handler: CommandHandler): void {
  builtins.set(id, handler);
}

export function hasCommand(id: string): boolean {
  return id in commandRegistry.getState() || builtins.has(id);
}

/** Run a command by id. Returns false when no handler exists. Errors are reported as messages. */
export function runCommand(id: string): boolean {
  const handler = commandRegistry.getState()[id] ?? builtins.get(id);
  if (!handler) return false;
  try {
    const r = handler();
    if (r && typeof (r as Promise<void>).then === 'function') {
      (r as Promise<void>).catch((err: unknown) => reportCommandError(id, err));
    }
  } catch (err) {
    reportCommandError(id, err);
  }
  return true;
}

function reportCommandError(id: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  actions.addSimMessage('error', t('sim.commandFailed', { id, message }), 'shell');
  console.error(`command ${id} failed`, err);
}

// ---------------------------------------------------------------------------
// interactive parts & live data
// ---------------------------------------------------------------------------

/**
 * Called whenever an interactive part changes a parameter (key press, click while simulating,
 * slider): cb(refdes, param, value). The change is applied to the design without an undo step.
 */
export function onInteractiveChange(cb: InteractiveListener): () => void {
  return editor.actions.onInteractiveChange(cb);
}
