/**
 * Part-authoring toolkit shared by every catalogue module under src/library/parts.
 *
 * Contents
 * - Library extensions of the PartDef contract (`LibraryPartDef`): optional metadata the
 *   netlister understands (instrument channel binding, pins grounded when open, virtual parts).
 *   Every field is optional, so plain `PartDef`s (e.g. from other catalogue owners) still work.
 * - Naming rules for SPICE elements / internal nodes (`elementName`, `internalNode`).
 * - ParamDef builders and typed accessors for parameter text.
 * - ElementIR / ModelCard / Waveform builders and B-source expression helpers.
 *
 * Conventions used by every part in this catalogue
 * - Independent and controlled CURRENT sources: current leaves the part through its '+'
 *   pin into the external circuit (the IR element is written [n('-'), n('+')], because the
 *   SPICE convention is "current flows from n+ through the source to n-").
 * - Internal nodes are named "<refdes>.<suffix>" (dot separator, like flattened subcircuit
 *   nodes) so they can never clash with sanitized net labels ([A-Za-z0-9_] only).
 * - B-source expressions only use: numbers without suffixes, + - * /, parentheses,
 *   V(n), V(n1,n2), I(Vname), `time`, and the functions tanh, exp, abs, min, max, sqrt, sin.
 */

import type { ElementIR, ModelCard, SourceSpec, SubcktDef, Waveform } from '../sim/netlist';
import { isGroundNode } from '../sim/netlist';
import type { DigitalSimSettings, SignalRef } from '../model/types';
import { parseUserNumber } from '../util/units';
import type { ParamDef, PartDef, ToSpiceContext } from './types';

// ---------------------------------------------------------------------------
// Contract extensions
// ---------------------------------------------------------------------------

/** Context handed to `LibraryPartDef.bindInstrument` by the netlister. */
export interface InstrumentBindContext {
  refdes: string;
  /** merged parameter text (defaults + instance values) */
  params: Record<string, string>;
  /** SPICE node of a pin; null when the pin is unconnected (and not in `groundWhenOpen`). */
  net(pin: string): string | null;
  /** element-name helper with the same rule as ToSpiceContext.name */
  name(type: string, suffix?: string): string;
  /** elements emitted by this instance's toSpice */
  elements: readonly ElementIR[];
}

export interface InstrumentChannels {
  channels: Record<string, SignalRef>;
  drives: string[];
}

/** Signals an indicator part (LED, lamp, meter, motor ...) is driven by. */
export interface IndicatorChannels {
  /** primary signal: LED / ammeter current, lamp / voltmeter / probe voltage, motor speed (V = rad/s) */
  signal: SignalRef;
  /** optional second signal (e.g. lamp current for power) */
  current?: SignalRef;
  /**
   * further code signals of multi-cell displays, in order: character LCD cells, status and CGRAM
   * rows (src/sim/devices/digital/displays.ts), dot-matrix row masks
   */
  signals?: SignalRef[];
}

/** Parametric data of a catalogue part for the browser filters (keys: src/library/specs.ts SPEC_DEFS). */
export type PartSpecs = Record<string, number | string>;

/** A voltage limit of a rated part: |V(pins[0], pins[1])| (or one polarity only) must stay below the limit. */
export interface RatingVoltage {
  /** param key holding the limit in volts (or `value`) */
  param?: string;
  value?: number;
  pins: [string, string];
  /** 1: only V(a,b) > 0 counts, -1: only V(a,b) < 0 counts (reverse voltage); absent: both */
  sign?: 1 | -1;
}

/**
 * Ratings of a part that can burn out ("rated" parts, src/model/ratings.ts). When the `enable`
 * parameter is true the netlister adds stress monitors (power, voltage, current, each divided by
 * its limit) and an open-circuit switch; the simulation layer opens the part when a stress
 * reaches 1 and tells the learner why.
 */
export interface RatingSpec {
  /** bool param that switches burn-out on; nothing is added to the netlist when it is false */
  enable: string;
  /** param key with the maximum power dissipation in W */
  power?: string;
  /** maximum |current| into `pin` (param key or fixed value, A) */
  current?: { param?: string; value?: number; pin: string };
  voltages?: RatingVoltage[];
  /** thermal time constant of the power term: param key or seconds (default 10 ms) */
  tau?: string | number;
  /** pin that is disconnected when the part burns out (default: the first pin) */
  openPin?: string;
}

/**
 * One part of a programmable-controller rack (see {@link LibraryPartDef.ladderIo}).
 *   cpu           the controller itself: it has no channels, only the scan period (`scan`) and
 *                 the read-out switch (`debug`) the whole rack uses
 *   input         digital input channels, thresholded with `vth` / `vhys`
 *   output        digital output channels, driven to `von`
 *   analog-input  analog input channels, read in volts
 * Channel k of a module gets address byte `startParam` (inputs / outputs) or channel number
 * `startParam` + k (analog inputs).
 */
export interface LadderIoSpec {
  kind: 'cpu' | 'input' | 'output' | 'analog-input';
  /** number of channels (0 for the CPU) */
  channels: number;
  /** pin name of each channel, in channel order */
  pins: string[];
  /** common pin; every module of one rack must be on the same common net */
  com?: string;
  /** instance parameter holding the first address byte / channel number */
  startParam?: string;
}

/**
 * PartDef with optional catalogue metadata. All extra fields are optional; the netlister
 * treats a plain PartDef as having none of them.
 */
export interface LibraryPartDef extends PartDef {
  /** parametric data (browser filters, comparison); numbers in SI units */
  specs?: PartSpecs;
  /** Vietnamese name / description of a generated catalogue part (src/i18n/library.ts reads it) */
  textVi?: { name?: string; description?: string };
  /** order inside the family (e.g. the nominal value); parts without one come first */
  sortKey?: number;
  /** catalogue series the part was generated from (e.g. 'E24 resistor', '1N47xx') */
  series?: string;
  /** burn-out ratings (rated parts) */
  ratings?: RatingSpec;
  /** pins tied to ground ("0") when left unconnected (instrument reference terminals) */
  groundWhenOpen?: string[];
  /** pins that may stay unconnected without a floating-pin ERC warning */
  optionalPins?: string[];
  /** not a physical component (instruments, power symbols, ideal sources, meters): excluded from BOM by default */
  virtual?: boolean;
  /**
   * Drawn on the schematic but never simulated (no toSpice): annotation symbols (test point,
   * signal arrows, antenna, chassis / earth markers, no-connect mark) and placeholders (IC
   * sockets). Their pins still join nets (a socket passes every net through unchanged); the
   * canvas draws them dimmed, the breadboard ignores them and open pins raise no ERC warning.
   */
  annotation?: 'symbol' | 'placeholder';
  /**
   * The part is a microcontroller (src/mcu): the netlister records every placed instance in
   * `NetlistBuildEx.mcus`, so the code editor panel finds the program text, the element name of
   * the core and whether its read-out vectors must be recorded.
   */
  mcu?: { kind: '8051'; programParam: string };
  /**
   * The part belongs to a programmable-controller rack: the CPU or one input / output module of
   * a ladder-diagram design (src/ladder). Such a part has NO `toSpice`: the netlister collects
   * every module of the top level, gives each channel its ladder address and builds ONE
   * `A_LADDER` element for the whole rack (src/model/ladderBuild.ts), because the rungs, the
   * timers and the counters are one shared program.
   */
  ladderIo?: LadderIoSpec;
  /**
   * The part is a mechatronics model (src/mecha): a machine driven by the circuit. `kind` picks
   * the model, and the netlister adds the report nodes (internal nodes carrying the animated
   * state) to `NetlistBuildEx.mechas` so the drawing and the Grapher can follow it.
   */
  mecha?: { kind: string };
  /**
   * One section of a multi-section package (quad gate, dual / quad op-amp): the part id of the
   * whole package, this section's letter and every section letter. Sections of one package share a
   * reference designator; the netlister emits the package once (src/model/sections.ts). The section
   * symbol's pin NAMES are the package's pin names ('2A', '2B', '2Y'), with `label` carrying the
   * short name the learner sees ('A', 'B', 'Y').
   */
  pkg?: { id: string; section: string; sections: string[] };
  /**
   * Linked electromechanical parts (src/library/catalog/relays.ts). A **driver** (relay coil, timer
   * coil, thermal overload relay) publishes its switching state as the internal node `<refdes>.st`
   * (0 … 1, switching at 0.75 / 0.1); a **contact** names its driver in the instance parameter
   * `param` (the driver's reference designator, on any sheet of the same level) and follows that
   * node, through `ToSpiceContextExt.linkTarget`. The netlister reports a contact whose driver
   * does not exist as an ERC warning (`contactNoCoil` / `contactNotCoil`).
   */
  contactLink?: { role: 'driver' } | { role: 'contact'; param: string };
  /**
   * The part has a time–current characteristic the Properties panel draws (src/ui/editor/TripCurve.tsx):
   * a breaker (curve letter in `curveParam`, rated current in `ratedParam`), an I²t fuse
   * (`i2tParam`, `kminParam`) or a thermal overload relay (trip class in `curveParam`, setting in
   * `ratedParam`).
   */
  tripCurve?: { kind: 'breaker' | 'fuse' | 'overload'; ratedParam: string; curveParam?: string; i2tParam?: string; kminParam?: string };
  /** build the InstrumentBinding channels / driven elements for an instrument part */
  bindInstrument?(ctx: InstrumentBindContext): InstrumentChannels;
  /** build the signals of an indicator part (see PartDef.indicator); null when not observable */
  bindIndicator?(ctx: InstrumentBindContext): IndicatorChannels | null;
}

/** Optional extensions the MachSim netlister adds to every ToSpiceContext it creates. */
export interface ToSpiceContextExt extends ToSpiceContext {
  /** unique internal node name for this instance */
  internal?(suffix: string): string;
  /** true when the pin touches anything (wire, other pin, label); false for floating pins */
  connected?(pin: string): boolean;
  /** SPICE node of a net label / global net name (case-insensitive), undefined when no such net */
  resolveNet?(name: string): string | undefined;
  /** the design's digital simulation settings (Design.digital), when the netlister knows them */
  digital?: DigitalSimSettings;
  /**
   * How the hidden supply pins of a digital IC are wired, resolved from the ERC options and the
   * digital simulation settings (src/model/ercMatrix.ts `hiddenPowerMode`): 'auto' joins the named
   * supply net when the design has one, 'ideal' ignores supply nets, 'required' makes a missing
   * supply net an ERC error. Absent = decide from `digital` alone (older callers).
   */
  hiddenPower?: 'auto' | 'ideal' | 'required';
  /**
   * Multi-section packages: the node of any pin of the whole package, merged over the sections that
   * are placed under this reference designator (undefined = that section is not placed). The
   * netlister sets it on the leading section only; see src/library/sectionKit.ts.
   */
  packagePins?(pin: string): string | undefined;
  /**
   * The part placed on this level (any sheet) with this reference designator (case-insensitive),
   * or undefined: `driver` says whether it is a linked-part driver (`LibraryPartDef.contactLink`),
   * `node` is its state node `<refdes>.st`.
   */
  linkTarget?(name: string): { refdes: string; partId: string; driver: boolean; node: string } | undefined;
  /** Report an ERC warning for this instance (explained by the i18n keys erc.<id>.title / why / fix). */
  warn?(id: string, params?: Record<string, string | number>): void;
}

/**
 * An error a part's toSpice throws to report a specific ERC problem: the netlister turns it into
 * an ERC message with this detail id (explained by the i18n keys erc.<id>.title / why / fix)
 * instead of the generic "part error".
 */
export class PartErcError extends Error {
  constructor(
    message: string,
    readonly detailId: string,
    readonly detailParams: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = 'PartErcError';
  }
}

export function asLibraryPart(part: PartDef): LibraryPartDef {
  return part as LibraryPartDef;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Replace every character outside [A-Za-z0-9_] with '_' (empty text becomes '_'). */
export function sanitizeName(text: string): string {
  const s = text.trim().replace(/[^A-Za-z0-9_]/g, '_');
  return s.length > 0 ? s : '_';
}

/**
 * SPICE element name for an instance: "R1" when the refdes already starts with the type
 * letter, otherwise "<T>_<refdes>"; a suffix is appended as "_<suffix>".
 *   elementName('R', 'R1') -> "R1"; elementName('V', 'XFG1', 'p') -> "V_XFG1_p"
 */
export function elementName(type: string, refdes: string, suffix?: string): string {
  const ref = sanitizeName(refdes);
  const t = type.trim().toUpperCase();
  const base = ref.toUpperCase().startsWith(t) ? ref : `${t}_${ref}`;
  return suffix ? `${base}_${sanitizeName(suffix)}` : base;
}

/** Internal node name "<refdes>.<suffix>". */
export function internalNodeName(refdes: string, suffix: string): string {
  return `${sanitizeName(refdes)}.${sanitizeName(suffix)}`;
}

/** Internal node for a part instance (uses the netlister's ctx.internal when available). */
export function internalNode(ctx: ToSpiceContext, suffix: string): string {
  const ext = ctx as ToSpiceContextExt;
  return typeof ext.internal === 'function' ? ext.internal(suffix) : internalNodeName(ctx.refdes, suffix);
}

/**
 * State node of the driver a contact follows (see LibraryPartDef.contactLink), or null when the
 * driver is missing: an ERC warning is raised and the contact stays in its rest position. `coil` is
 * the reference designator the contact names.
 */
export function followDriver(ctx: ToSpiceContext, coil: string): string | null {
  const ext = ctx as ToSpiceContextExt;
  const name = coil.trim();
  // a context that cannot look parts up (a stub): the contact gets its own, undriven control node
  if (typeof ext.linkTarget !== 'function') return name === '' ? null : internalNodeName(ctx.refdes, 'link');
  if (name === '') {
    ext.warn?.('contactNoName');
    return null;
  }
  const hit = ext.linkTarget(name);
  if (!hit) {
    ext.warn?.('contactNoCoil', { coil: name });
    return null;
  }
  if (!hit.driver) {
    ext.warn?.('contactNotCoil', { coil: hit.refdes });
    return null;
  }
  return hit.node;
}

/** Whether a pin is connected to anything (true when the context cannot tell). */
export function pinConnected(ctx: ToSpiceContext, pin: string): boolean {
  const ext = ctx as ToSpiceContextExt;
  return typeof ext.connected === 'function' ? ext.connected(pin) : true;
}

/** SPICE node of a named net (label / power net), or the sanitized name when the context cannot tell. */
export function resolveNetName(ctx: ToSpiceContext, name: string): string {
  if (isGroundNode(name)) return '0';
  const ext = ctx as ToSpiceContextExt;
  const hit = typeof ext.resolveNet === 'function' ? ext.resolveNet(name) : undefined;
  return hit ?? sanitizeName(name);
}

/**
 * Rewrite the node names inside V(a) / V(a,b) of a behavioral expression to SPICE nodes, so
 * users can write net-label names (any case, any characters except "," and ")").
 */
export function mapExpressionNets(ctx: ToSpiceContext, expr: string): string {
  return expr.replace(/\b([Vv])\(\s*([^,()]+?)\s*(?:,\s*([^,()]+?)\s*)?\)/g, (_m, v: string, a: string, b?: string) =>
    b === undefined ? `${v}(${resolveNetName(ctx, a)})` : `${v}(${resolveNetName(ctx, a)},${resolveNetName(ctx, b)})`,
  );
}

/** Model name of a semiconductor instance: the 'model' param when set (user-imported model), else the built-in one. */
export function modelOverride(ctx: ToSpiceContext, builtin: string): string {
  const m = (ctx.params.model ?? '').trim();
  return m.length > 0 ? m : builtin;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export type ParamExtra = Partial<Omit<ParamDef, 'key' | 'label' | 'default' | 'kind'>>;

export function numParam(key: string, label: string, def: string, unit?: string, extra: ParamExtra = {}): ParamDef {
  const p: ParamDef = { key, label, default: def, kind: 'number', group: 'value', ...extra };
  if (unit !== undefined) p.unit = unit;
  return p;
}

export function modelParam(key: string, label: string, def: string, unit?: string, extra: ParamExtra = {}): ParamDef {
  return numParam(key, label, def, unit, { group: 'model', ...extra });
}

export function selectParam(
  key: string,
  label: string,
  def: string,
  options: (string | [string, string])[],
  extra: ParamExtra = {},
): ParamDef {
  return {
    key,
    label,
    default: def,
    kind: 'select',
    options: options.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o[0], label: o[1] })),
    group: 'value',
    ...extra,
  };
}

export function boolParam(key: string, label: string, def: boolean, extra: ParamExtra = {}): ParamDef {
  return { key, label, default: def ? 'true' : 'false', kind: 'bool', group: 'value', ...extra };
}

export function textParam(key: string, label: string, def: string, extra: ParamExtra = {}): ParamDef {
  return { key, label, default: def, kind: 'text', group: 'value', ...extra };
}

/** Lenient boolean text: true/1/yes/on/closed/pressed (case-insensitive). */
export function parseBool(text: string | undefined): boolean {
  if (text === undefined) return false;
  return /^(true|1|yes|on|closed|pressed|y)$/i.test(text.trim());
}

export function boolOf(ctx: ToSpiceContext, key: string): boolean {
  return parseBool(ctx.params[key]);
}

export function textOf(ctx: ToSpiceContext, key: string, fallback = ''): string {
  const v = ctx.params[key];
  return v === undefined ? fallback : v;
}

/** Numeric param that may be left empty: returns undefined for blank text. */
export function optNum(ctx: ToSpiceContext, key: string): number | undefined {
  const v = ctx.params[key];
  if (v === undefined || v.trim() === '') return undefined;
  return ctx.num(key);
}

/** Parse "t v, t v, ..." pairs (user number syntax). Throws on malformed input. */
export function parsePairs(text: string): number[] {
  const tokens = text
    .split(/[\s,;()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length % 2 !== 0) throw new Error('expected an even number of values (time value pairs)');
  const out = tokens.map((t) => parseUserNumber(t));
  if (out.some((v) => !Number.isFinite(v))) throw new Error('non-numeric value in pair list');
  for (let i = 2; i < out.length; i += 2) {
    if (out[i] < out[i - 2]) throw new Error('times must be non-decreasing');
  }
  return out;
}

/** Interactive-key parameter (instance override of InteractiveDef.key). */
export function keyParam(def: string): ParamDef {
  return textParam('key', 'Key', def, { group: 'value', help: "Keyboard key that operates the part during simulation ('Space' or a single character)" });
}

/** Slider increment parameter (percent). */
export function stepParam(def: string): ParamDef {
  return numParam('increment', 'Increment', def, '%', { min: 0.1, max: 100, help: 'Slider step in percent' });
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

type NumMap = Record<string, number>;

export function elR(name: string, a: string, b: string, value: number, params: NumMap = {}): ElementIR {
  return { type: 'R', name, nodes: [a, b], value, params };
}
export function elC(name: string, a: string, b: string, value: number, params: NumMap = {}): ElementIR {
  return { type: 'C', name, nodes: [a, b], value, params };
}
export function elL(name: string, a: string, b: string, value: number, params: NumMap = {}): ElementIR {
  return { type: 'L', name, nodes: [a, b], value, params };
}
export function elK(name: string, inductors: string[], k: number): ElementIR {
  return { type: 'K', name, nodes: [], inductors, value: k, params: {} };
}
export function elV(name: string, pos: string, neg: string, source: SourceSpec): ElementIR {
  return { type: 'V', name, nodes: [pos, neg], source, params: {} };
}
export function elI(name: string, pos: string, neg: string, source: SourceSpec): ElementIR {
  return { type: 'I', name, nodes: [pos, neg], source, params: {} };
}
/** 0 V sense source (ammeter); I(name) > 0 when current flows from `pos` to `neg` through it. */
export function elSense(name: string, pos: string, neg: string): ElementIR {
  return elV(name, pos, neg, { dc: 0 });
}
export function elE(name: string, p: string, n: string, cp: string, cn: string, gain: number): ElementIR {
  return { type: 'E', name, nodes: [p, n, cp, cn], value: gain, params: {} };
}
export function elG(name: string, p: string, n: string, cp: string, cn: string, gm: number): ElementIR {
  return { type: 'G', name, nodes: [p, n, cp, cn], value: gm, params: {} };
}
export function elF(name: string, p: string, n: string, control: string, gain: number): ElementIR {
  return { type: 'F', name, nodes: [p, n], control, value: gain, params: {} };
}
export function elH(name: string, p: string, n: string, control: string, rm: number): ElementIR {
  return { type: 'H', name, nodes: [p, n], control, value: rm, params: {} };
}
/** Behavioral source; `kind` 'V' (voltage) or 'I' (current from p through the source to n). */
export function elB(name: string, p: string, n: string, kind: 'V' | 'I', expr: string): ElementIR {
  return { type: 'B', name, nodes: [p, n], expr: `${kind}=${expr}`, params: {} };
}
export function elD(name: string, a: string, k: string, model: string, params: NumMap = {}): ElementIR {
  return { type: 'D', name, nodes: [a, k], model, params };
}
export function elQ(name: string, c: string, b: string, e: string, model: string, params: NumMap = {}): ElementIR {
  return { type: 'Q', name, nodes: [c, b, e], model, params };
}
export function elJ(name: string, d: string, g: string, s: string, model: string, params: NumMap = {}): ElementIR {
  return { type: 'J', name, nodes: [d, g, s], model, params };
}
export function elM(name: string, d: string, g: string, s: string, b: string, model: string, params: NumMap = {}): ElementIR {
  return { type: 'M', name, nodes: [d, g, s, b], model, params };
}
export function elS(name: string, a: string, b: string, cp: string, cn: string, model: string): ElementIR {
  return { type: 'S', name, nodes: [a, b, cp, cn], model, params: {} };
}
export function elW(name: string, a: string, b: string, control: string, model: string): ElementIR {
  return { type: 'W', name, nodes: [a, b], control, model, params: {} };
}
export function elT(name: string, a: string, b: string, c: string, d: string, z0: number, td: number): ElementIR {
  return { type: 'T', name, nodes: [a, b, c, d], params: { z0, td } };
}
export function elX(name: string, nodes: string[], subckt: string): ElementIR {
  return { type: 'X', name, nodes, model: subckt, params: {} };
}

/** Model card with lower-cased parameter keys. */
export function card(name: string, type: string, params: NumMap): ModelCard {
  const p: NumMap = {};
  for (const [k, v] of Object.entries(params)) p[k.toLowerCase()] = v;
  return { name, type: type.toUpperCase(), params: p };
}

/** Switch model (S): on when V(ctrl) > vt + vh, off when < vt - vh. */
export function swModel(name: string, vt: number, vh: number, ron: number, roff: number): ModelCard {
  return card(name, 'SW', { vt, vh, ron, roff });
}

/** Current-controlled switch model (W): on when I(ctrl) > it + ih. */
export function cswModel(name: string, it: number, ih: number, ron: number, roff: number): ModelCard {
  return card(name, 'CSW', { it, ih, ron, roff });
}

export function subckt(name: string, ports: string[], elements: ElementIR[], models: ModelCard[] = []): SubcktDef {
  const m: Record<string, ModelCard> = {};
  for (const c of models) m[c.name.toLowerCase()] = c;
  return { name, ports, params: {}, elements, models: m, subckts: {} };
}

// ---------------------------------------------------------------------------
// Waveforms
// ---------------------------------------------------------------------------

export function wSin(vo: number, va: number, freq: number, td = 0, theta = 0, phaseDeg = 0): Waveform {
  return { type: 'SIN', args: [vo, va, freq, td, theta, phaseDeg] };
}
export function wPulse(v1: number, v2: number, td: number, tr: number, tf: number, pw: number, per: number): Waveform {
  return { type: 'PULSE', args: [v1, v2, td, tr, tf, pw, per] };
}
export function wPwl(pairs: number[], repeat = false): Waveform {
  return repeat ? { type: 'PWL', args: pairs, repeatFrom: pairs[0] ?? 0 } : { type: 'PWL', args: pairs };
}
export function wExp(v1: number, v2: number, td1: number, tau1: number, td2: number, tau2: number): Waveform {
  return { type: 'EXP', args: [v1, v2, td1, tau1, td2, tau2] };
}
export function wSffm(vo: number, va: number, fc: number, mdi: number, fs: number): Waveform {
  return { type: 'SFFM', args: [vo, va, fc, mdi, fs] };
}
export function wAm(va: number, vo: number, mf: number, fc: number, td = 0): Waveform {
  return { type: 'AM', args: [va, vo, mf, fc, td] };
}

/**
 * Square wave as PULSE with 50 %-point duty cycle `duty` (0..1) and equal rise/fall `tr`.
 * pw is clamped at 0 when the edges are slower than the requested high time.
 */
export function wSquare(low: number, high: number, freq: number, duty: number, tr: number, td = 0): Waveform {
  const per = 1 / freq;
  const edge = Math.min(tr, per / 4);
  const pw = Math.max(0, duty * per - edge);
  return wPulse(low, high, td, edge, edge, pw, per);
}

/** Repeating triangle as PWL: rises from low to high in duty*period, falls in the rest. */
export function wTriangle(low: number, high: number, freq: number, duty: number): Waveform {
  const per = 1 / freq;
  const d = Math.min(0.999, Math.max(0.001, duty));
  return { type: 'PWL', args: [0, low, d * per, high, per, low], repeatFrom: 0 };
}

// ---------------------------------------------------------------------------
// Expressions & misc
// ---------------------------------------------------------------------------

/** Number literal for B-source expressions (negative values parenthesised, no suffixes). */
export function ex(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`non-finite number in expression: ${n}`);
  const s = String(n);
  return n < 0 ? `(${s})` : s;
}

/** Voltage reference for expressions: V(a), V(a,b); ground terms are simplified away. */
export function vx(a: string, b?: string): string {
  const ag = isGroundNode(a);
  const bg = b === undefined || isGroundNode(b);
  if (ag && bg) return '0';
  if (bg) return `V(${a})`;
  if (ag) return `(-V(${b}))`;
  return `V(${a},${b})`;
}

/** 32-bit FNV-1a hash as 8 hex digits (stable model/subckt name suffixes). */
export function hash8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Stable name for a parameterised model: base name, or base + hash when params differ from defaults. */
export function paramModelName(base: string, params: NumMap, defaults: NumMap): string {
  const keys = Object.keys(params).sort();
  const same = keys.length === Object.keys(defaults).length && keys.every((k) => params[k] === defaults[k]);
  if (same) return base;
  return `${base}_${hash8(keys.map((k) => `${k}=${params[k]}`).join(';'))}`;
}

/** Read a list of numeric params into a map (throws via ctx.num on bad values). */
export function readNums(ctx: ToSpiceContext, keys: string[]): NumMap {
  const out: NumMap = {};
  for (const k of keys) out[k] = ctx.num(k);
  return out;
}

/** Parse the default text of a list of ParamDefs into numbers (for model-name hashing). */
export function defaultNums(defs: ParamDef[], keys: string[]): NumMap {
  const out: NumMap = {};
  for (const k of keys) {
    const d = defs.find((p) => p.key === k);
    out[k] = d ? parseUserNumber(d.default) : NaN;
  }
  return out;
}

/**
 * Continuous sawtooth of a phase in cycles: ramps from −1 to +1 over 99 % of the cycle and
 * returns over the last 1 % (continuous, so the solver never sees a jump).
 */
export function sawtoothOf(phase: string): string {
  const u = `(${phase}-floor(${phase}))`;
  return `if(${u}<0.99,-1+2*${u}/0.99,1-2*(${u}-0.99)/0.01)`;
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
