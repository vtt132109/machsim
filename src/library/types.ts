/**
 * Component library definitions.
 *
 * CONTRACT FILE — parts are implemented in src/library/parts/**, rendered by the editor,
 * and turned into SPICE IR by the netlister. Additive changes only.
 *
 * Symbols are drawn in part-local coordinates (origin = placement point, y down) with
 * pins on multiples of GRID (10). Style: neutral, original line-art (ANSI/IEC generic
 * shapes). Do not copy artwork from any commercial product.
 */

import type { ElementIR, ModelCard, SubcktDef } from '../sim/netlist';
import type { InstrumentKind, Point } from '../model/types';

export type FillStyle = boolean | string; // true = foreground colour, string = CSS colour/var

export type SymbolPrim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width?: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: FillStyle; r?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: FillStyle }
  /** arc from `start` to `end` degrees, measured clockwise on screen from +x */
  | { kind: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
  /** flat list x0,y0,x1,y1,... */
  | { kind: 'polyline'; points: number[]; closed?: boolean; fill?: FillStyle }
  /** SVG path data in local coordinates */
  | { kind: 'path'; d: string; fill?: FillStyle }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size?: number;
      anchor?: 'start' | 'middle' | 'end';
      bold?: boolean;
      /** keep text upright when the part is rotated (default true) */
      upright?: boolean;
    };

/**
 * Electrical kind of a pin, used by the ERC pin-type matrix (src/model/ercMatrix.ts).
 * 'power' is the historical name of a supply pin that takes power in ('power-in'); the matrix
 * normalises it, so older part definitions and `.msim` files keep working.
 */
export type PinType = 'passive' | 'input' | 'output' | 'bidir' | 'power' | 'nc' | 'tristate' | 'open-collector' | 'power-in' | 'power-out';

export interface PinDef {
  /** unique within the part; used by toSpice ctx.node(name) */
  name: string;
  x: number;
  y: number;
  /** direction the pin stub points away from the body (for drawing pin numbers/labels) */
  dir?: 'left' | 'right' | 'up' | 'down';
  /** label drawn inside the body (e.g. "+", "Vcc", "CLK") */
  label?: string;
  type?: PinType;
  /** physical pin number for BOM / PCB export */
  number?: string;
}

export interface SymbolDef {
  /** bounding box in local coordinates (for hit-testing/selection) */
  bbox: { x: number; y: number; w: number; h: number };
  prims: SymbolPrim[];
  pins: PinDef[];
  /** default label positions (local coordinates) */
  refPos?: Point;
  valuePos?: Point;
}

export type ParamKind = 'number' | 'text' | 'select' | 'bool';

/** Preferred-number (IEC 60063) series offered by the value picker of a number parameter. */
export type ESeriesName = 'E3' | 'E6' | 'E12' | 'E24' | 'E48' | 'E96' | 'E192';

export interface ParamDef {
  key: string;
  label: string;
  /** display unit, e.g. 'Ω', 'F', 'H', 'V', 'A', 'Hz', 's', '%' */
  unit?: string;
  /** default value text (user number syntax for 'number') */
  default: string;
  kind: ParamKind;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  help?: string;
  /** show "value" text next to the symbol */
  showOnSchematic?: boolean;
  /** properties-dialog tab */
  group?: 'value' | 'model' | 'waveform' | 'advanced' | 'display';
  /** number params: offer a standard-value picker of this E-series (resistance, capacitance ...) */
  picker?: ESeriesName;
  /** text params: the properties panel offers "Open file…" to load the text (accepted extensions, e.g. ".csv,.txt") */
  fileImport?: string;
  /**
   * text params holding a binary file as base64 text: the properties panel offers "Open WAV file…"
   * (decoded, mixed to mono 16-bit at up to 16 kHz by src/audio/wavParam.ts) instead of the text box
   */
  binaryImport?: 'wav';
  /** text params holding a memory image (src/sim/devices/digital/memimage.ts): the properties panel offers the hex content editor for a memory of this size */
  memory?: { words: number; bits: number };
}

export interface ToSpiceContext {
  refdes: string;
  /** parameter values (defaults merged with instance values) */
  params: Record<string, string>;
  /** SPICE node name connected to a pin ("0" for ground). Unconnected pins get a unique floating node. */
  node(pin: string): string;
  /** parse a numeric param with parseUserNumber; throws Error(`bad value for <key>`) on NaN */
  num(key: string): number;
  /** element name helper: name('R') -> "R1" for refdes R1, name('V','a') -> "V_XFG1_a" */
  name(type: string, suffix?: string): string;
}

export interface SpiceFragment {
  elements: ElementIR[];
  models?: ModelCard[];
  subckts?: SubcktDef[];
}

export type PartGroup =
  | 'sources'
  | 'basic'
  | 'diodes'
  | 'transistors'
  | 'analog'
  | 'ttl'
  | 'cmos'
  | 'misc-digital'
  | 'mixed'
  | 'indicators'
  | 'power'
  | 'misc'
  | 'rf'
  | 'electromechanical'
  | 'connectors'
  | 'instruments';

export interface GroupDef {
  id: PartGroup;
  name: string;
  order: number;
}

export interface InteractiveDef {
  /** toggle: switch / relay state; momentary: push-button; slider: percent 0..100 */
  kind: 'toggle' | 'momentary' | 'slider';
  /** instance param changed by the interaction */
  param: string;
  label: string;
  /** keyboard key (single char or 'Space') */
  key?: string;
  /** slider increment in % (or in the param's own unit when the ParamDef has min / max) */
  step?: number;
  /**
   * Slider only: instance params that override the increment / lower / upper bound of the slider
   * (number params in the slider param's unit; blank or invalid text keeps `step` and the
   * ParamDef min / max). Used by the interactive DC sources ("step 0.5 V between 0 and 12 V").
   */
  stepParam?: string;
  minParam?: string;
  maxParam?: string;
  /**
   * Parts with several controls of the same kind (DIP switch positions, keypad keys): every
   * control operates its own instance param. A click while simulating operates the control nearest
   * to the click point; each control has its own key. `param` / `key` above then describe the
   * first control (old code paths keep working). Absent for single-control parts.
   */
  controls?: InteractiveControl[];
  /** text instance param with space-separated keys that replace the control keys in order (blank = defaults) */
  keysParam?: string;
}

/** One control of a multi-control interactive part (see InteractiveDef.controls). */
export interface InteractiveControl {
  /** instance param operated by this control */
  param: string;
  /** short label of the control ("1", "*", "S3"), shown in menus and next to the key */
  label: string;
  /** default keyboard key (single char or 'Space') */
  key?: string;
  /**
   * Selector controls (rotary switch contacts): operating the control sets `param` to this value
   * (and the control counts as on while the param has it); without it the control toggles /
   * presses its own param.
   */
  value?: string;
  /** symbol-local position of the control (click target, state marker) */
  at: Point;
}

export interface PartDef {
  /** stable unique id: '<group>/<slug>', e.g. 'basic/resistor', 'diodes/1n4148' */
  id: string;
  name: string;
  group: PartGroup;
  family: string;
  description: string;
  /** refdes prefix: R, C, L, V, I, D, Q, M, J, U, S, K, LED, XMM, XFG, XSC ... */
  prefix: string;
  symbol: SymbolDef;
  params: ParamDef[];
  /** Produce simulation IR. Absent for graphic-only parts and globalNet symbols. */
  toSpice?(ctx: ToSpiceContext): SpiceFragment;
  /** Power/ground symbol: every pin joins this net name ("0" = ground). */
  globalNet?: string;
  /** Virtual instrument kind (panel UI) */
  instrument?: InstrumentKind;
  interactive?: InteractiveDef;
  /** footprint name for BOM / PCB export */
  footprint?: string;
  /**
   * Web link of the part (datasheet, product page): http(s) only. Shown as the "Hyperlink" of the
   * Select-a-component dialog; parts without one link to their in-app help page instead.
   */
  hyperlink?: string;
  keywords?: string[];
  /** where the SPICE model parameters come from (manufacturer datasheet model, textbook, generic) */
  provenance?: string;
  /** visual indicator behaviour (LED glow, lamp, 7-seg, bar graph, probe light) driven by sim values */
  indicator?: {
    kind: 'led' | 'lamp' | 'probe' | 'seven-seg' | 'bargraph' | 'buzzer' | 'speaker' | 'motor' | 'voltmeter' | 'ammeter' | 'lcd' | 'matrix' | 'alnum' | 'mecha';
    signal?: string;
    /** lit colour (CSS) of probes, displays and bar graphs; bar graphs may give one colour per segment */
    color?: string;
    /** lcd: columns x rows; matrix: columns x rows of dots; alnum: number of segments (14 or 16) */
    cols?: number;
    rows?: number;
    segments?: number;
    /** bar graph: number of bars; colours per bar (overrides color) */
    bars?: number;
    barColors?: string[];
    /** lcd / matrix / mecha: the display area in symbol coordinates (cells or dots are laid out evenly in it) */
    screen?: { x: number; y: number; w: number; h: number };
    /**
     * 'mecha': which machine the schematic draws inside `screen` ('conveyor', 'junction', 'tank',
     * 'door', 'lift'; src/ui/editor/mechaGlyphs.tsx).
     */
    scene?: string;
    /**
     * 'mecha': how many signals the part publishes (`bindIndicator` signals, read from the live
     * values under `${refdes}#k`): the input pins, then the sensor pins, then the report nodes.
     */
    slots?: number;
  };
}
