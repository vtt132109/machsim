/**
 * Schematic document model.
 *
 * CONTRACT FILE — shared by the editor UI (src/ui/editor), the netlister (src/model/netlister.ts),
 * results/instrument UI and the integration layer. Additive changes only.
 *
 * Coordinates are schematic units: 1 unit = 1 px at zoom 1. The snap grid is GRID (10).
 * Part pins always land on grid points when the part origin is on the grid.
 * y grows downward (screen coordinates).
 */

import type { AnalysisSpec, AnalysisType, Netlist, SimOptions } from '../sim/netlist';
import type { BreadboardLayout } from '../breadboard/types';
import type { CustomPartData } from '../library/custom/types';
import type { LadderRung } from '../ladder/types';
import type { ErcSettings } from './ercMatrix';

export type { ErcSettings };

export const GRID = 10;

export interface Point {
  x: number;
  y: number;
}

/** Clockwise rotation on screen, degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export interface PartInstance {
  id: string;
  /** library PartDef.id */
  partId: string;
  /** reference designator, unique in the design: R1, C3, Q2, U1, XMM1 ... */
  refdes: string;
  x: number;
  y: number;
  rotation: Rotation;
  /** horizontal mirror applied before rotation */
  mirror: boolean;
  /** user-edited parameter values as text (user number syntax, see util/units parseUserNumber) */
  params: Record<string, string>;
  /** label placement offsets (relative to part origin, unrotated) */
  refOffset?: Point;
  valueOffset?: Point;
  hideRef?: boolean;
  hideValue?: boolean;
  /** excluded from simulation (e.g. variant / "virtual" disable) */
  excludeFromSim?: boolean;
  /** excluded from BOM / PCB export */
  excludeFromBom?: boolean;
  /** v2: locked items cannot be moved, rotated or deleted in the editor */
  locked?: boolean;
  /** v2: group id; selecting one member selects the whole group (see EditableItem) */
  group?: string;
  /** injected pin faults (troubleshooting practice, see src/model/faults.ts) */
  faults?: PinFault[];
  /**
   * Name of a `.model` or `.subckt` (from Design.customSpice or a library card) that replaces the
   * part's own model: the netlister swaps the model of the part's device element of the same kind
   * (a diode model for a diode, NPN for an NPN ...) or the subcircuit of its X element when the port
   * count matches (src/model/modelOverride.ts). Absent = the part's own model.
   */
  modelOverride?: string;
  /**
   * BOM / PCB fields of this placed part (Properties > BOM / PCB): manufacturer, manufacturer part
   * number, supplier and a footprint that replaces the library part's footprint in the BOM and the
   * PCB netlist exports (src/model/pcb.ts). Absent fields come from the library part.
   */
  fields?: PartFields;
  /**
   * Ids of the design variants (Design.variants) in which this part is NOT fitted (Tools › Variant
   * manager). In the active variant a not-fitted part is left out of the simulation, the BOM, the
   * reports and the PCB exports (src/model/variants.ts variantView). Absent = fitted everywhere.
   */
  notFitted?: string[];
  /**
   * Pins the learner marked "not connected" (Edit › NC marker). Such a pin is drawn with a small
   * cross, raises no floating-pin ERC warning, and raises `ncPinConnected` when it is wired after
   * all (src/model/ercMatrix.ts). Absent = no markers.
   */
  ncPins?: string[];
}

/** BOM / PCB fields of a placed part (PartInstance.fields); every field is optional. */
export interface PartFields {
  manufacturer?: string;
  /** manufacturer part number */
  partNumber?: string;
  supplier?: string;
  /** PCB footprint name (overrides PartDef.footprint) */
  footprint?: string;
}

/**
 * A fault injected into one pin of a placed part (Properties > Fault, Simulate > Auto fault).
 * - 'open'  the pin is disconnected from its net (1 GΩ remains, so the circuit stays solvable)
 * - 'short' the pin is shorted to pin `to` of the same part (resistance `r`, default 1 mΩ)
 * - 'leak'  a leakage resistance `r` (default 10 kΩ) from the pin to pin `to`
 * Faults change only the simulation netlist; the drawing stays as it is.
 */
export interface PinFault {
  pin: string;
  kind: 'open' | 'short' | 'leak';
  /** other pin of the same part (short / leak) */
  to?: string;
  /** resistance in Ω (short / leak) */
  r?: number;
  /** placed by Auto fault: not shown in the editor until the design's faults are revealed */
  hidden?: boolean;
}

/** Auto-fault state of a design (Simulate > Auto fault). */
export interface AutoFaultInfo {
  /** random seed the faults were drawn with */
  seed: number;
  /** number of faults placed */
  count: number;
  /** hidden faults are shown again (Simulate > Reveal faults) */
  revealed?: boolean;
}

/**
 * Orthogonal polyline. Consecutive points share x or y.
 *
 * v2: `bus: true` makes the wire a bus. Bus wires form their own layer: they connect only to other
 * bus wires (end on bus), never to pins or ordinary wires. A bus carries named lines ("members");
 * see src/model/bus.ts for the naming syntax (`D[0..7]`, `A,B,C`). Members behave like net
 * names local to the sheet: bus member "D3" is the same net as a local label "D3" on that sheet.
 * Ordinary wires join a bus line through a bus entry (NetLabel kind 'bus-entry').
 */
export interface Wire {
  id: string;
  points: Point[];
  color?: string;
  /** v2: this wire is a bus */
  bus?: boolean;
  /** v2: bus name, e.g. "D[0..7]" (bus wires only) */
  busName?: string;
  locked?: boolean;
  group?: string;
}

/**
 * v2: what a NetLabel item is.
 * - 'label'     net label. Local to its sheet unless `global` is true (version-1 files are migrated
 *               to `global: true`, which keeps their old "same name on every sheet" behaviour).
 * - 'offpage'   off-page connector: same name connects across the sheets of one design level.
 * - 'hier'      hierarchical connector: a port of the design level it is on. In a child design
 *               (subcircuit / hierarchical block) it becomes a pin of the block symbol.
 * - 'global'    global connector: same name connects everywhere, across sheets and hierarchy
 *               levels (like power symbols).
 * - 'bus-entry' bus entry at (x, y) on a bus wire: connects the ordinary wire / pin at that point
 *               to bus line `name`.
 * On one sheet every item with the same name is the same net (a local label "A" joins an off-page
 * connector "A" of that sheet). Connector names that are bus names ("D[0..7]") connect every bus
 * line separately. Names "0" / "gnd" are always ground.
 */
export type LabelKind = 'label' | 'offpage' | 'hier' | 'global' | 'bus-entry';

/** Net label, connector or bus entry (see LabelKind). */
export interface NetLabel {
  id: string;
  x: number;
  y: number;
  name: string;
  rotation: Rotation;
  /** v2: item kind (default 'label') */
  kind?: LabelKind;
  /** v2: plain labels only — true = global net name (all sheets and hierarchy levels) */
  global?: boolean;
  locked?: boolean;
  group?: string;
}

export type ProbeKind = 'voltage' | 'current' | 'power' | 'differential' | 'digital' | 'reference';

/** Readings a probe flag shows (Probe.show): instantaneous value, peak-to-peak, RMS, DC (mean), frequency. */
export type ProbeReading = 'value' | 'pp' | 'rms' | 'dc' | 'freq';

/**
 * Measurement probe placed on a wire or pin at (x, y).
 * - voltage/digital: net voltage vs ground (or vs ref point for 'differential'; or vs the net of
 *   the reference probe `refProbe`)
 * - reference: marks a reference point other voltage probes can measure against (reads its own
 *   voltage vs ground)
 * - current: current through the wire segment at (x, y), positive in the wire direction
 *   from points[i] to points[i+1] of the segment containing the probe (netlister inserts a 0 V source)
 * - power: voltage at the point times current through it
 */
export interface Probe {
  id: string;
  kind: ProbeKind;
  x: number;
  y: number;
  name: string;
  color: string;
  /** reference point for 'differential' */
  ref?: Point;
  /** voltage / digital probes: id of a 'reference' probe on the same design level to measure against */
  refProbe?: string;
  /** readings shown on the flag; absent = the value, plus peak-to-peak and RMS when it varies */
  show?: ProbeReading[];
}

/** v2: text style of a note / comment. */
export interface TextStyle {
  /** CSS font family keyword */
  font?: 'sans' | 'serif' | 'mono';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: 'start' | 'middle' | 'end';
}

export interface TextNote {
  id: string;
  x: number;
  y: number;
  text: string;
  size?: number;
  /** v2: font / colour */
  style?: TextStyle;
  /** v2: sticky comment (drawn as a pinned note, can be collapsed to its pin) */
  comment?: boolean;
  /** v2: comment author and creation time (ISO 8601) */
  author?: string;
  created?: string;
  /** v2: comment shown as its pin only */
  collapsed?: boolean;
  locked?: boolean;
  group?: string;
  /**
   * Drawing order among the annotations of a sheet (Edit > Order): higher is drawn later, so on
   * top. Absent = the default order (graphics under text, each in list order).
   */
  z?: number;
}

/** v2: kinds of graphic annotation shapes. */
export type ShapeKind = 'line' | 'polyline' | 'rect' | 'ellipse' | 'arc' | 'polygon' | 'picture';

/**
 * v2: graphic annotation (no electrical meaning).
 * - line / polyline / polygon: `points` are the vertices.
 * - rect / ellipse / picture: `points` = two opposite corners.
 * - arc: `points` = two corners of the ellipse the arc belongs to; `start` / `end` in degrees,
 *   clockwise on screen from +x.
 */
export interface Shape {
  id: string;
  kind: ShapeKind;
  points: Point[];
  stroke?: string;
  strokeWidth?: number;
  dash?: 'solid' | 'dash' | 'dot';
  /** fill colour ('' / absent = no fill) */
  fill?: string;
  start?: number;
  end?: number;
  /** picture: image as a data: URL (PNG, JPEG, GIF, SVG or WebP) */
  src?: string;
  locked?: boolean;
  group?: string;
  /** drawing order among the annotations of a sheet (see TextNote.z) */
  z?: number;
}

/** v2: paper sizes for sheets and printing. */
export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Legal' | 'Tabloid' | 'Custom';

/** v2: workspace colours of a sheet. */
export interface SheetColors {
  scheme: 'default' | 'white' | 'black' | 'custom';
  background?: string;
  wire?: string;
  component?: string;
  text?: string;
  bus?: string;
}

/** v2: sheet properties (absent fields = defaults: legacy page frame, border, title block, dots). */
export interface SheetProps {
  paper?: PaperSize;
  orientation?: 'landscape' | 'portrait';
  /** Custom paper size in schematic units (1 mm = 4 units) */
  width?: number;
  height?: number;
  border?: boolean;
  titleBlock?: boolean;
  grid?: 'dots' | 'lines';
  colors?: SheetColors;
}

/**
 * What kind of drawing a sheet holds.
 * - 'schematic' (default, and what every file written before ladder diagrams existed holds):
 *   parts, wires, labels, probes and annotations.
 * - 'ladder': a ladder diagram (`Sheet.ladder`). Its electrical lists stay empty; the rungs run
 *   on the programmable controller of the design (the PLC rack parts of a schematic sheet of the
 *   same design level, src/model/ladderBuild.ts).
 */
export type SheetKind = 'schematic' | 'ladder';

/**
 * Layers of a sheet that can be shown or hidden (Edit > Layer settings, src/model/layers.ts). Only
 * what differs from the default is stored; hiding a layer changes the drawing and the exported
 * image, never the circuit.
 */
export interface SheetLayers {
  grid?: boolean;
  refdes?: boolean;
  values?: boolean;
  /** net labels and connectors */
  labels?: boolean;
  /** the name of every net, drawn along its wires (off by default) */
  netNames?: boolean;
  /** physical pin numbers next to the pins (off by default) */
  pinNumbers?: boolean;
  /** sticky comments */
  comments?: boolean;
  /** graphic annotations (lines, rectangles, pictures ...) */
  graphics?: boolean;
}

export interface Sheet {
  id: string;
  name: string;
  parts: PartInstance[];
  wires: Wire[];
  labels: NetLabel[];
  probes: Probe[];
  notes: TextNote[];
  /** v2: graphic annotations */
  shapes?: Shape[];
  /** v2: paper, border, title block, grid and colours */
  props?: SheetProps;
  /** sheet kind (absent = 'schematic') */
  kind?: SheetKind;
  /** ladder sheets: the rungs, top to bottom (src/ladder/types.ts) */
  ladder?: LadderRung[];
  /** visibility of the drawing layers; absent = the defaults (src/model/layers.ts) */
  layers?: SheetLayers;
}

/** v2: title block fields shared by every sheet of a design (empty date = today's date). */
export interface TitleBlockFields {
  /** default: Design.title */
  title?: string;
  description?: string;
  company?: string;
  designedBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  documentNo?: string;
  revision?: string;
  date?: string;
}

/** v2: print setup saved with the design. */
export interface PrintSetup {
  paper?: PaperSize;
  orientation?: 'landscape' | 'portrait';
  /** 'fit' = fit each sheet to the page, number = percent of 1 mm per 4 units */
  scale?: 'fit' | number;
  /** which sheets: every sheet (also child designs when includeChildren), the active one, or ids */
  sheets?: 'all' | 'active' | string[];
  includeChildren?: boolean;
  /** add a page listing every instrument and its settings */
  includeInstruments?: boolean;
  monochrome?: boolean;
  /** margin on every side in mm (absent = 10) */
  marginMm?: number;
  /** a picture larger than the page is spread over several pages (fixed percentage only) */
  tile?: boolean;
  /** page footer: design title, sheet name, page n of m */
  footer?: boolean;
  /** page numbers to print, e.g. "1-3, 5" (absent = all) */
  pageRange?: string;
  /** size of the paper when `paper` is 'Custom', millimetres */
  customMm?: { w: number; h: number };
}

/**
 * v2: a child design — a subcircuit or a hierarchical block — stored inside its parent file.
 * It is placed on a sheet as a PartInstance whose partId is `hier:<id>` (src/model/hierarchy.ts
 * blockPartId); the block symbol has one pin per hierarchical connector (NetLabel kind 'hier')
 * of the child's sheets. The netlister emits one `.subckt` per child (per distinct set of
 * instance parameter values) and an `X<refdes>` instance per placed block.
 * Children may contain blocks of other children (nesting); cycles are ERC errors.
 */
export interface ChildDesign {
  id: string;
  kind: 'subcircuit' | 'hierarchical';
  /** block / subcircuit name (the SPICE subcircuit name is derived from it) */
  name: string;
  description?: string;
  sheets: Sheet[];
  /** instance parameters with default values (expressions); instances override them */
  variables: Record<string, string>;
  /** hierarchical block created from a file: that file's name (shown, used to export it back) */
  sourceFile?: string;
  /** explicit port order (port names); ports not listed follow in order of appearance */
  portOrder?: string[];
}

/** Saved analysis settings: one spec per analysis type, plus the active one. */
export interface AnalysisSettings {
  active: AnalysisType;
  specs: Partial<Record<AnalysisType, AnalysisSpec>>;
  /**
   * Output tab: variables to save ("V(out)", "I(V1)", "P(R1)", "all"). Absent or empty = every node
   * voltage and source current. Probes, instruments and indicators are always recorded as well.
   */
  saves?: string[];
  /**
   * Output tab: postprocessor expressions ("V(out)/V(in)", "db(V(out))") evaluated on every result
   * of a run and added to it as extra traces named by the expression.
   */
  expressions?: string[];
}

/**
 * Interactive simulation settings (Simulate > Interactive simulation settings), separate from the
 * transient analysis. Absent = derived from the transient analysis spec, as before the setting
 * existed. Every field is optional.
 *   initial  'auto' (default): operating point, and from a zero state when it does not converge;
 *            'op': operating point only; 'zero': every node and current starts at 0;
 *            'uic': device initial conditions (capacitor / inductor ic=) and .ic values
 *   tstep    output (sample) step, s
 *   tmax     maximum internal time step, s (absent = automatic)
 *   tstop    stop automatically at this simulated time, s (absent = run until Stop)
 */
export interface InteractiveSettings {
  initial?: 'auto' | 'op' | 'zero' | 'uic';
  tstep?: number;
  tmax?: number;
  tstop?: number;
}

/**
 * Digital simulation settings (Simulate > Digital simulation settings). Every field is optional;
 * an absent block (or field) means the defaults, which reproduce the behaviour of files written
 * before the setting existed.
 *   mode    'auto' (default): an IC whose supply net (VCC / VDD) exists is powered from it, else it
 *           runs at the family's nominal levels;
 *           'ideal': ideal logic (0 V / nominal supply outputs, threshold at half the supply, no
 *           input current), supply nets ignored, no power pins needed;
 *           'real': every IC needs its supply net (ERC error otherwise) and uses the family's
 *           levels, thresholds, input currents and output resistance.
 *   timing  'typical' (default) datasheet typical delays, 'max' worst-case delays, 'zero' no
 *           propagation delay (edges keep their rise / fall time).
 */
export interface DigitalSimSettings {
  mode?: 'auto' | 'ideal' | 'real';
  timing?: 'typical' | 'max' | 'zero';
}

/**
 * Description box of a design (Tools > Description box): rich text for students plus questions.
 * `text` uses MachSim markup (src/model/richText.ts): `#`, `##`, `###` headings, `**bold**`,
 * `*italic*`, `` `code` ``, `- ` / `1. ` lists, `---` rule, `$formula$` and `$$block formula$$`
 * (src/model/formula.ts: x^2, x_1, \frac{a}{b}, \sqrt{x}, Greek letters …) and images
 * `![alt](img:<id>)` that refer to `images`.
 */
export interface DescriptionBox {
  text: string;
  images?: DescriptionImage[];
  questions?: StudentQuestion[];
  /** the student's answers by question id (saved with the file so the instructor can read them) */
  answers?: Record<string, string>;
  /** open the description box when the file is opened */
  showOnOpen?: boolean;
}

/** An image of the description box (embedded data: URL, at most 2 MB like sheet pictures). */
export interface DescriptionImage {
  id: string;
  /** data:image/... URL (PNG, JPEG, GIF, SVG or WebP) */
  src: string;
  alt?: string;
}

/** Kinds of student questions: multiple choice, a number with tolerance, or short text. */
export type QuestionKind = 'choice' | 'number' | 'text';

/**
 * A question of the description box (src/model/questions.ts grades answers).
 *   choice  `options` are the choices; `answer` is the index of the right one ("0", "1" …)
 *   number  `answer` is the value (user number syntax, "4.7k"); `tolerance` in percent (default 5),
 *           `unit` is shown after the input
 *   text    `answer` lists accepted answers separated by "|" (compared without case, spaces and
 *           Vietnamese diacritics)
 */
export interface StudentQuestion {
  id: string;
  kind: QuestionKind;
  /** the question (markup allowed) */
  prompt: string;
  options?: string[];
  answer?: string;
  tolerance?: number;
  unit?: string;
  /** shown after the student checks the answer */
  explanation?: string;
}

/**
 * Instructor restrictions of a design (Options > Instructor mode). Set and removed with a password;
 * only a salted PBKDF2-SHA-256 hash of the password is stored (src/model/restrictions.ts). The
 * editor enforces them: hidden values, locked parts (the parts placed when the restriction was set),
 * disabled analyses and instruments, a read-only description box and hidden answers.
 */
export interface DesignRestrictions {
  /** PBKDF2-SHA-256 hash of the instructor password, hex */
  passwordHash: string;
  /** random salt, hex */
  salt: string;
  /** PBKDF2 iteration count */
  iterations: number;
  /** part values are shown as "?" on the schematic, in Properties, reports and exported files */
  hideValues?: boolean;
  /** the parts listed in `lockedParts` cannot be moved, deleted or edited */
  lockParts?: boolean;
  lockedParts?: string[];
  /** analyses students cannot run */
  disabledAnalyses?: AnalysisType[];
  /** instruments students cannot place or open */
  disabledInstruments?: InstrumentKind[];
  /** students cannot edit the description box or its questions */
  lockDescription?: boolean;
  /** students can answer questions but not check them against the answers */
  hideAnswers?: boolean;
}

export interface Design {
  format: 'machsim-design';
  /** 2 since the schematic-capture round (local net labels, connectors, buses, hierarchy) */
  version: 1 | 2;
  title: string;
  description?: string;
  sheets: Sheet[];
  analysis: AnalysisSettings;
  options: Partial<SimOptions>;
  /** global parameters (.param) as expressions */
  variables: Record<string, string>;
  /** extra SPICE model / subckt text appended to the netlist (user-imported models) */
  customSpice?: string;
  /** physical breadboard view of the same circuit (src/breadboard) */
  breadboard?: BreadboardLayout;
  /** v2: subcircuits and hierarchical blocks used by this design (and by each other) */
  children?: ChildDesign[];
  /** v2: title block fields */
  titleBlock?: TitleBlockFields;
  /** v2: print setup */
  printSetup?: PrintSetup;
  /** hidden faults placed by Auto fault (the faults themselves live on PartInstance.faults) */
  autoFault?: AutoFaultInfo;
  /** digital simulation settings (ideal / real mode, timing); absent = defaults */
  digital?: DigitalSimSettings;
  /** interactive simulation settings; absent = derived from the transient analysis */
  interactive?: InteractiveSettings;
  /**
   * User components (component wizard / part databases) used by this design, embedded so the file
   * opens and simulates without the database (src/library/custom). Parts refer to them by their
   * `custom:` id; the editor keeps exactly the used ones (in-use list).
   */
  customParts?: CustomPartData[];
  /** description box shown to students: rich text, images and questions */
  descriptionBox?: DescriptionBox;
  /** instructor restrictions (password protected) */
  restrictions?: DesignRestrictions;
  /** who saved the file and when (written on save; File > File information) */
  meta?: DesignMeta;
  /** Grapher pages kept with the design (Grapher > "Keep pages in the design file") */
  grapher?: SavedGrapher;
  /** design variants (Tools › Variant manager): which parts are fitted in which build */
  variants?: DesignVariants;
  /**
   * The library definitions the placed built-in parts were last updated to, by part id (written
   * on save; Tools › Update components from library compares them with the current library).
   */
  libraryRefs?: Record<string, PartLibraryRef>;
  /**
   * ERC options (Tools › ERC options): pin-type matrix overrides, hidden-power behaviour.
   * Absent = the defaults of src/model/ercMatrix.ts.
   */
  erc?: ErcSettings;
  /**
   * Per-net settings (right-click a wire › Net settings): colour, simulation and PCB properties,
   * keyed by the net's user-visible name (case-insensitive, see src/model/netSettings.ts).
   */
  nets?: Record<string, NetSettings>;
  /**
   * Reference designator prefix rules (Tools > Reference designator prefixes): a design-wide prefix
   * and per-letter replacements, for example a multi-board design where "U" becomes "U1_" or
   * "A_U" (src/model/refdesRules.ts). Absent = the library prefixes (R, C, U ...).
   */
  refdesRules?: RefdesRules;
}

/**
 * Reference designator prefix rules of a design (Design.refdesRules). A part whose library prefix
 * is "U" is named `<global><map.U ?? 'U'><number>`: with `global: 'A_'` that is "A_U3", with
 * `map: { U: 'U1_' }` it is "U1_3".
 */
export interface RefdesRules {
  /** text put in front of every designator (a board or module tag such as "A_") */
  global?: string;
  /** library prefix (upper-case, "R", "U", "XMM") -> the prefix the design uses instead */
  map?: Record<string, string>;
}

/**
 * Settings of one net (Design.nets, keyed by the net's user-visible name): what it is called, how
 * it is drawn and the hints the PCB tool gets. Every field is optional; see
 * src/model/netSettings.ts for the helpers and the units (mm for width / clearance).
 */
export interface NetSettings {
  /** wire colour of the net (CSS colour); the editor paints the net's wires with it */
  color?: string;
  /** free note shown in the dialog and the net report */
  note?: string;
  /** keep the net's name when the design is renumbered / re-annotated */
  keepName?: boolean;
  /** PCB: trace width in mm */
  traceWidth?: number;
  /** PCB: clearance in mm */
  clearance?: number;
  /** PCB: routing-layer hint ('any' | 'top' | 'bottom' | 'inner' | 'power', or a layer name) */
  layer?: string;
  /** PCB: net class (src/model/netSettings.ts NET_CLASS_PRESETS) */
  netClass?: string;
}

/**
 * A named build of the design (Tools › Variant manager): "Full", "Basic", "Without display" …
 * Every part is fitted in a variant unless the variant id is in its PartInstance.notFitted.
 */
export interface DesignVariant {
  /** stable id ("v1", "v2" …) */
  id: string;
  name: string;
  description?: string;
}

/** The variants of a design and the active one (simulation, BOM and reports follow it). */
export interface DesignVariants {
  /** in display order; at least one */
  list: DesignVariant[];
  /** id of the active variant (absent = the first) */
  active?: string;
}

/**
 * What a library part looked like when the placed copies were last updated (Design.libraryRefs):
 * a fingerprint of the whole definition, the symbol's pin positions (so wires can follow pins
 * that moved) and the parameter defaults.
 */
export interface PartLibraryRef {
  /** fingerprint of pins, parameters, footprint and simulation model (src/library/partFingerprint.ts) */
  sig: string;
  /** pin name -> [x, y] in part-local coordinates */
  pins: Record<string, [number, number]>;
  /** parameter key -> default value text */
  defaults: Record<string, string>;
}

/** Save history of a design file (Design.meta); every field is optional. */
export interface DesignMeta {
  /** ISO 8601 time of the first save */
  created?: string;
  /** ISO 8601 time of the last save */
  modified?: string;
  /** program that wrote the file, e.g. "MachSim 0.1.0" */
  savedBy?: string;
}

/**
 * A simulation vector stored in a design file (Design.grapher). Samples are plain numbers; `null`
 * stands for a missing / high-impedance sample (NaN in memory).
 */
export interface SavedVector {
  name: string;
  /** VectorUnit of src/sim/results.ts ('V', 'A', 's', 'Hz' …) */
  unit: string;
  re: (number | null)[];
  im?: (number | null)[];
  digital?: boolean;
}

/** An analysis result stored with Grapher pages (the plotting part of AnalysisResult). */
export interface SavedResult {
  type: AnalysisType;
  title: string;
  scale?: SavedVector;
  vectors: SavedVector[];
  runs?: { label: string; result: SavedResult }[];
  scalars?: Record<string, number>;
  table?: { columns: string[]; rows: (string | number)[][] };
}

/** A run of the Grapher history stored in a design file. */
export interface SavedRun {
  id: number;
  /** 'analysis' | 'interactive' | 'netlist' | 'import' */
  source: string;
  name: string;
  /** ms since epoch */
  time: number;
  results: SavedResult[];
  expressions?: string[];
}

/** A Grapher page stored in a design file (src/ui/results/history.ts GraphPage). */
export interface SavedPage {
  id: string;
  runId: number;
  tab: number;
  key: string;
  overlays: { runId: number; tab: number; vector: string }[];
  props: Record<string, unknown>;
  traces: Record<string, Record<string, unknown>>;
}

/** Grapher pages saved with a design (Design.grapher), see src/ui/results/savedGrapher.ts. */
export interface SavedGrapher {
  version: 1;
  runs: SavedRun[];
  pages: SavedPage[];
  /** id of the page shown first */
  active?: string;
}

// ---------------------------------------------------------------------------
// Netlister output
// ---------------------------------------------------------------------------

export interface PinRef {
  refdes: string;
  pin: string;
}

export interface NetInfo {
  /** SPICE node name ("0" for ground) */
  name: string;
  pins: PinRef[];
  /** user-visible name (label name or auto name) */
  displayName: string;
  /** true when named by a label / power symbol */
  named: boolean;
}

export interface ErcMessage {
  severity: 'error' | 'warning';
  code:
    | 'no-ground'
    | 'floating-pin'
    | 'single-pin-net'
    | 'duplicate-refdes'
    | 'unknown-part'
    | 'bad-param'
    | 'voltage-loop'
    | 'current-cutset'
    | 'dangling-wire'
    /** pin-type matrix finding or an NC-marked pin that is wired (src/model/ercMatrix.ts) */
    | 'pin-type'
    | 'other';
  message: string;
  sheetId?: string;
  refdes?: string;
  pin?: string;
  net?: string;
  x?: number;
  y?: number;
  /**
   * Structured form of `message` (which stays a short technical English line): an explanation
   * id and its values. The UI turns it into a beginner-friendly text in the current language —
   * what is wrong, why it matters and how to fix it (src/i18n/erc.ts explainErc).
   */
  detail?: ErcDetail;
}

export interface ErcDetail {
  /** explanation id, e.g. 'noGround', 'floatingPin' (catalogue keys erc.<id>.*) */
  id: string;
  params?: Record<string, string | number>;
}

export type InstrumentKind =
  | 'multimeter'
  | 'function-generator'
  | 'oscilloscope'
  | 'oscilloscope-4ch'
  | 'bode-plotter'
  | 'wattmeter'
  | 'frequency-counter'
  | 'iv-analyzer'
  | 'spectrum-analyzer'
  | 'network-analyzer'
  | 'distortion-analyzer'
  | 'logic-analyzer'
  | 'word-generator'
  | 'logic-converter'
  | 'current-clamp'
  /** bench-style instruments (src/library/parts/benchInstruments.ts) */
  | 'bench-generator'
  | 'bench-multimeter'
  | 'bench-scope'
  | 'mixed-signal-scope';

/** A signal an instrument or probe reads from simulation vectors. */
export type SignalRef =
  /** V(pos) - V(neg); either may be "0" */
  | { kind: 'voltage'; pos: string; neg: string }
  /** branch current I(element) of a V source (often a 0 V sense source inserted by the netlister) */
  | { kind: 'current'; element: string };

export interface InstrumentBinding {
  refdes: string;
  partId: string;
  kind: InstrumentKind;
  params: Record<string, string>;
  /** channel name -> signal, e.g. { A: {...}, B: {...}, ext: {...} } for an oscilloscope */
  channels: Record<string, SignalRef>;
  /** element names this instrument drives (e.g. function generator sources) for interactive setParam */
  drives: string[];
}

export interface ProbeBinding {
  probeId: string;
  name: string;
  kind: ProbeKind;
  color: string;
  /** readings to show (Probe.show) */
  show?: ProbeReading[];
  /** name of the reference probe the signal is measured against */
  refName?: string;
  /** primary signal (voltage or current) */
  signal: SignalRef;
  /** power probes: the current signal (signal = voltage) */
  current?: SignalRef;
}

export interface NetlistBuild {
  netlist: Netlist;
  nets: NetInfo[];
  /** refdes -> pin name -> SPICE node name */
  partNets: Record<string, Record<string, string>>;
  instruments: InstrumentBinding[];
  probes: ProbeBinding[];
  erc: ErcMessage[];
}

export function newSheet(id: string, name: string): Sheet {
  return { id, name, parts: [], wires: [], labels: [], probes: [], notes: [] };
}

export function newDesign(title = 'Untitled'): Design {
  return {
    format: 'machsim-design',
    version: 2,
    title,
    sheets: [newSheet('sheet1', 'Sheet 1')],
    analysis: {
      active: 'tran',
      specs: {
        op: { type: 'op' },
        tran: { type: 'tran', tstep: 1e-5, tstop: 1e-2 },
        ac: { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e8 },
      },
    },
    options: {},
    variables: {},
  };
}
