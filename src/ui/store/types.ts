/**
 * Editor state types.
 *
 * The editor keeps one immutable {@link Design} snapshot as the document. Every edit produces a new
 * snapshot that shares unchanged sheets / arrays / items with the previous one (structural sharing),
 * which makes undo/redo cheap and lets React skip unchanged children by reference.
 *
 * Everything that is not part of the saved document (selection, tool, viewport, simulation status,
 * live probe values, ...) lives next to the design in {@link EditorState}.
 */
import type { PartDef } from '../../library/types';
import type { LadderLive } from '../../ladder/probes';
import type {
  Design,
  ErcMessage,
  NetLabel,
  PartInstance,
  Point,
  Probe,
  ProbeKind,
  Rotation,
  Shape,
  ShapeKind,
  TextNote,
  Wire,
  LabelKind,
} from '../../model/types';

/** Kinds of selectable schematic objects ('shape' = graphic annotation, v2). */
export type ItemKind = 'part' | 'wire' | 'label' | 'probe' | 'note' | 'shape';

/** One selected object on the active sheet. */
export interface SelItem {
  kind: ItemKind;
  id: string;
}

/** Library lookup used by all pure design operations (injectable for tests). */
export type PartLookup = (partId: string) => PartDef | undefined;

/** Active editing tool. */
export type ToolState =
  | { kind: 'select' }
  /** `once`: place one part, then return to the select tool (the component dialog reopens) */
  | { kind: 'place'; partId: string; rotation: Rotation; mirror: boolean; once?: boolean }
  | { kind: 'wire' }
  /** net label (labelKind absent / 'label'), connector or bus entry */
  | { kind: 'label'; labelKind?: LabelKind }
  | { kind: 'probe'; probeKind: ProbeKind }
  | { kind: 'text' }
  /** bus wire drawing (same gestures as the wire tool) */
  | { kind: 'bus' }
  /** graphic annotation: click points (line / polyline / polygon) or drag a box (rect / ellipse / arc) */
  | { kind: 'shape'; shapeKind: ShapeKind }
  /** sticky comment */
  | { kind: 'comment' }
  /** capture screen area: drag a rectangle, which is copied / saved as a picture */
  | { kind: 'capture' };

/** Viewport of one sheet: screen = sheet * zoom + pan (CSS pixels relative to the canvas). */
export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export type SimMessageSeverity = 'info' | 'warning' | 'error';

/** Live state of a rated part (see EditorState.ratingStates). */
export interface RatingState {
  state: 'hot' | 'blown';
  pct: number;
}

export interface SimMessage {
  id: number;
  /** wall-clock timestamp (ms since epoch) */
  time: number;
  severity: SimMessageSeverity;
  text: string;
  /** optional origin, e.g. "engine", "erc", "netlister" */
  source?: string;
}

export type SimState = 'idle' | 'running' | 'paused' | 'error';

export interface SimStatus {
  state: SimState;
  message: string;
  /** simulated time in seconds (transient / interactive), 0 when not applicable */
  simTime: number;
}

export type ThemeMode = 'system' | 'light' | 'dark';

/** Layout toggles (not saved in the design). */
export interface UiState {
  browserOpen: boolean;
  propertiesOpen: boolean;
  dockOpen: boolean;
  /** id of the active bottom dock tab */
  dockTab: string;
  theme: ThemeMode;
  /** panel sizes in CSS pixels (splitters) */
  browserWidth: number;
  propertiesWidth: number;
  dockHeight: number;
  /** autosave the document to the recovery slot (crash recovery) */
  autosave: boolean;
  /** seconds between autosaves of a changed document (Options > File options) */
  autosaveSeconds: number;
  /** desktop: .bak copies kept when a file is overwritten by Save (0 = none) */
  backupCount: number;
  /**
   * The learner's own keyboard shortcuts (Options › Customize user interface): command id -> chord
   * text, '' = the built-in shortcut is switched off (src/ui/app/customize.ts). Absent = defaults.
   */
  shortcuts?: Record<string, string>;
  /** toolbar groups that are hidden (src/ui/app/customize.ts TOOLBAR_GROUPS); absent = all shown */
  toolbar?: Partial<Record<string, boolean>>;
  /**
   * Beginner mode: the simplified interface (src/ui/app/beginner.ts) with the advanced menus,
   * toolbar groups and analyses hidden. Absent / false = the full interface.
   */
  beginner?: boolean;
}

export interface HistoryState {
  past: Design[];
  future: Design[];
  /** key of the last commit, used to merge consecutive commits into one undo step */
  coalesceKey: string | null;
  /** time of the last commit (ms), for time-windowed coalescing (keyboard nudges) */
  lastCommitAt: number;
}

export interface EditorState {
  /** the current document */
  design: Design;
  /** design snapshot at the last save/open (dirty = design !== savedDesign) */
  savedDesign: Design;
  /** file name shown in the title bar, e.g. "Amplifier.msim" */
  fileName: string;
  activeSheetId: string;
  /**
   * Which placed copy of the open block the learner looks at: the refdes of each block on the way
   * down from the top level. A block placed twice is the same child design; the path says whose
   * live values (LED glow, probe read-outs, switch states) the canvas shows. Empty at the top level;
   * a stale path (it no longer leads to the open design) falls back to the first copy
   * (`activeViewPath` in editorStore.ts).
   */
  viewPath: string[];
  /** selected items on the active sheet */
  selection: SelItem[];
  tool: ToolState;
  /** per-sheet viewport */
  views: Record<string, ViewState>;
  /** size of the canvas element in CSS pixels (kept up to date by the canvas) */
  viewportSize: { w: number; h: number };
  showGrid: boolean;
  showErc: boolean;
  history: HistoryState;
  /** ERC markers drawn on the canvas (set by the ERC tool / netlister) */
  ercMarkers: ErcMessage[];
  /** messages shown in the "Simulation" spreadsheet tab */
  simMessages: SimMessage[];
  /** live probe read-outs: probe id -> text (may contain "\n" for several lines) */
  probeValues: Record<string, string>;
  /**
   * Probes and parts inside a placed block copy are keyed by their path in both maps
   * (`X2/<probe id>`, `X2/LED1`, see `liveKey` in src/model/hierarchy.ts); the canvas picks the
   * keys of the copy it shows.
   */
  /** indicator brightness by refdes: LEDs / lamps glow when > 0 (1 = full) */
  indicatorLevels: Record<string, number>;
  /**
   * Live state of the running ladder program (src/ladder/probes.ts), pushed by the simulation
   * controller: the ladder editor lights up the rungs that carry power. Null when nothing runs.
   */
  ladderLive: LadderLive | null;
  /**
   * Rated parts by refdes: 'hot' (≥ 80 % of a rating) or 'blown' (burnt out, open); `pct` is the
   * worst stress in percent. Kept after the simulation stops so the learner sees what failed;
   * cleared when the next simulation starts.
   */
  ratingStates: Record<string, RatingState>;
  sim: SimStatus;
  clipboardAvailable: boolean;
  ui: UiState;
}

/**
 * Everything of {@link EditorState} that belongs to ONE open document (src/ui/app/documents.ts keeps
 * one of these per document tab): the design and its saved copy, undo history, selection, the
 * view of every sheet, the ERC markers and the simulation state it produced. Layout toggles, the
 * clipboard and the tool are shared by all documents.
 */
export type DocumentState = Pick<
  EditorState,
  'design' | 'savedDesign' | 'fileName' | 'activeSheetId' | 'selection' | 'views' | 'history' | 'ercMarkers' | 'simMessages' | 'probeValues' | 'indicatorLevels' | 'ladderLive' | 'ratingStates' | 'sim'
>;

/** Copied schematic fragment (coordinates as on the source sheet). */
export interface Clipboard {
  parts: PartInstance[];
  wires: Wire[];
  labels: NetLabel[];
  probes: Probe[];
  notes: TextNote[];
  /** graphic annotations (v2; absent in older clipboards) */
  shapes?: Shape[];
  /** child designs used by copied blocks, so a paste into another design keeps them */
  children?: import('../../model/types').ChildDesign[];
  /** top-left corner of the copied items, snapped to the grid */
  anchor: Point;
  /**
   * What the source design carried that the copied items refer to: user components, the global
   * parameters their values use, the assembly variants their `notFitted` names, the SPICE model
   * text of a model override and the settings of the nets they are on
   * (src/model/sanitize.ts `IncomingExtras`). A paste into another design uses it to remap or
   * strip those references instead of producing a design that cannot be saved and reopened.
   * Absent in clipboards written before the integrity layer existed.
   */
  extras?: import('../../model/sanitize').IncomingExtras;
}

/** Axis-aligned rectangle in sheet coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
