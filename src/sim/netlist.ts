/**
 * Netlist intermediate representation (IR).
 *
 * CONTRACT FILE — shared by the SPICE parser (src/sim/spice), the schematic netlister
 * (src/model) and the simulation engine (src/sim/engine). Do not change existing
 * fields' meaning; additive changes only.
 *
 * Conventions
 * - Flat SPICE semantics. Subcircuit instances (type 'X') are expanded by
 *   `flattenNetlist()` (src/sim/spice/flatten.ts) before the engine builds devices.
 * - Names (elements, models, subcircuits, nodes) are compared CASE-INSENSITIVELY.
 *   Producers should preserve the user's case; consumers must lower-case for lookups.
 * - Ground is node "0". The names "gnd" and "GND" are accepted as aliases of ground.
 * - All numeric values are SI base units (ohm, farad, henry, volt, ampere, second, hertz).
 * - Temperatures in netlists/options are degrees Celsius (engine converts to kelvin).
 */

export type ElementType =
  | 'R' // resistor: nodes [n+, n-], value = ohms; params: tc1, tc2, m, temp
  | 'C' // capacitor: [n+, n-], value = farads; params: ic, m
  | 'L' // inductor: [n+, n-], value = henries; params: ic, m
  | 'K' // mutual coupling: no nodes; inductors = [L1, L2, ...], value = k (0..1)
  | 'V' // independent voltage source: [n+, n-], source = SourceSpec
  | 'I' // independent current source: [n+, n-] (current flows n+ -> through source -> n-)
  | 'E' // VCVS: [n+, n-, nc+, nc-], value = gain
  | 'F' // CCCS: [n+, n-], control = V-source name, value = gain
  | 'G' // VCCS: [n+, n-, nc+, nc-], value = transconductance
  | 'H' // CCVS: [n+, n-], control = V-source name, value = transresistance
  | 'B' // behavioral source: [n+, n-], expr = "V=<expr>" or "I=<expr>"
  | 'D' // diode: [anode, cathode], model; params: area, ic, off, m
  | 'Q' // BJT: [c, b, e] or [c, b, e, substrate], model (NPN/PNP); params: area, ic_vbe, ic_vce, off, m
  | 'J' // JFET: [d, g, s], model (NJF/PJF); params: area, off
  | 'M' // MOSFET: [d, g, s, b], model (NMOS/PMOS); params: w, l, ad, as, pd, ps, m, off
  | 'Z' // MESFET: [d, g, s], model (NMF/PMF)
  | 'S' // voltage-controlled switch: [n+, n-, nc+, nc-], model (SW)
  | 'W' // current-controlled switch: [n+, n-], control = V-source name, model (CSW)
  | 'T' // lossless transmission line: [p1+, p1-, p2+, p2-]; params: z0, td | f, nl
  | 'O' // lossy transmission line (LTRA): [p1+, p1-, p2+, p2-], model
  | 'X' // subcircuit instance: nodes = ports, model = subckt name, stringParams = overrides
  | 'A'; // code model / digital primitive (XSPICE-like): model = code-model card, nodes per model

export type WaveformType = 'SIN' | 'PULSE' | 'PWL' | 'EXP' | 'SFFM' | 'AM';

/**
 * Transient waveform with SPICE positional arguments:
 *  SIN   (VO VA FREQ TD THETA PHASE_DEG)
 *  PULSE (V1 V2 TD TR TF PW PER)
 *  PWL   (T1 V1 T2 V2 ...)
 *  EXP   (V1 V2 TD1 TAU1 TD2 TAU2)
 *  SFFM  (VO VA FC MDI FS)
 *  AM    (VA VO MF FC TD)
 * Missing trailing args take SPICE defaults (tstep/tstop dependent ones are resolved by the engine).
 */
export interface Waveform {
  type: WaveformType;
  args: number[];
  /** PWL only: repeat the waveform from time `repeatFrom` (SPICE r=value). */
  repeatFrom?: number;
}

export interface SourceSpec {
  /** DC value (also used for OP/DC analyses when a tran waveform exists; if absent the waveform value at t=0 is used). */
  dc?: number;
  /** AC small-signal magnitude (default 0 = no AC excitation). */
  acMag?: number;
  /** AC phase in degrees. */
  acPhase?: number;
  /** Transient waveform. */
  tran?: Waveform;
  /** Noise-figure / distortion helpers: DISTOF1/DISTOF2 magnitude & phase (optional). */
  distof1?: [number, number];
  distof2?: [number, number];
}

export interface ElementIR {
  type: ElementType;
  /** Full SPICE instance name, e.g. "R1", "Q2", "X1.R3" after flattening. First letter matches `type`. */
  name: string;
  /** Node names in SPICE order for the element type (see ElementType docs). */
  nodes: string[];
  /** Primary value (R, C, L, K, E, F, G, H). */
  value?: number;
  /** Numeric instance parameters (lower-case keys). */
  params: Record<string, number>;
  /** Model or subcircuit name. */
  model?: string;
  /** Independent source specification (V, I). */
  source?: SourceSpec;
  /** Controlling voltage source name (F, H, W). */
  control?: string;
  /** Coupled inductor names (K). */
  inductors?: string[];
  /** Behavioral expression (B): "V=..." or "I=...". */
  expr?: string;
  /** Unevaluated parameter expressions (X instance overrides, or params that could not be resolved). */
  stringParams?: Record<string, string>;
  /** Source line in a parsed netlist, for diagnostics. */
  line?: number;
  /**
   * E / G only: LAPLACE transfer function H(s) = num(s)/den(s) (coefficients in ascending powers
   * of s) from V(nc+, nc-) to the output; `value` (default 1) multiplies it.
   */
  laplace?: { num: number[]; den: number[] };
  /**
   * E / G only: PSpice FREQ table — frequency response from V(nc+, nc-) to the output sampled at
   * `f` (Hz, ascending): linear magnitude `mag` and phase `phase` (degrees, unwrapped); `delay`
   * (s) adds e^{-j2πf·delay}; `value` (default 1) multiplies it. AC interpolates the table, the
   * transient convolves with its impulse response (src/sim/devices/linear/freqTable.ts).
   */
  freqTable?: { f: number[]; mag: number[]; phase: number[]; delay?: number };
}

export interface ModelCard {
  name: string;
  /**
   * SPICE model type keyword (upper-case): D, NPN, PNP, NJF, PJF, NMOS, PMOS, NMF, PMF,
   * SW, CSW, R, C, L, LTRA, or a code-model type for 'A' elements (e.g. 'D_AND', 'D_DFF', 'ADC_BRIDGE').
   */
  type: string;
  /** Numeric model parameters, lower-case keys (e.g. is, n, bf, vto, kp, level). */
  params: Record<string, number>;
  /** Non-numeric parameters (lower-case keys). */
  stringParams?: Record<string, string>;
}

export interface SubcktDef {
  name: string;
  /** Port node names, in order. */
  ports: string[];
  /** Default parameter values (PARAMS: name=expr), unevaluated. */
  params: Record<string, string>;
  elements: ElementIR[];
  models: Record<string, ModelCard>;
  subckts: Record<string, SubcktDef>;
}

export interface SimOptions {
  /** Circuit temperature, °C. */
  temp: number;
  /** Nominal (model extraction) temperature, °C. */
  tnom: number;
  gmin: number;
  reltol: number;
  abstol: number;
  vntol: number;
  chgtol: number;
  trtol: number;
  /** DC operating point iteration limit. */
  itl1: number;
  /** DC transfer curve iteration limit per point. */
  itl2: number;
  /** Transient iteration limit per timepoint. */
  itl4: number;
  /** Integration method. */
  method: 'trap' | 'gear';
  maxord: number;
  /** Number of gmin stepping steps (0 disables). */
  gminSteps: number;
  /** Number of source stepping steps (0 disables). */
  srcSteps: number;
  /** Shunt resistance from every node to ground (0 = disabled). */
  rshunt: number;
  /** Random seed for Monte Carlo and noise-like features. */
  seed: number;
  /** Device defaults (SPICE DEFL / DEFW): MOSFET channel length / width when the instance has none, m. */
  defl: number;
  defw: number;
  /** Device defaults (SPICE DEFAD / DEFAS): MOSFET drain / source diffusion area when not given, m^2. */
  defad: number;
  defas: number;
}

export const DEFAULT_OPTIONS: SimOptions = {
  temp: 27,
  tnom: 27,
  gmin: 1e-12,
  reltol: 1e-3,
  abstol: 1e-12,
  vntol: 1e-6,
  chgtol: 1e-14,
  trtol: 7,
  itl1: 100,
  itl2: 50,
  itl4: 10,
  method: 'trap',
  maxord: 2,
  gminSteps: 10,
  srcSteps: 10,
  rshunt: 0,
  seed: 1,
  defl: 1e-4,
  defw: 1e-4,
  defad: 0,
  defas: 0,
};

export type SweepType = 'dec' | 'oct' | 'lin' | 'list';

export interface OpAnalysis { type: 'op' }

/** DC sweep of an independent source (or 'temp' for temperature). Optional nested second sweep. */
export interface DcAnalysis {
  type: 'dc';
  src: string;
  start: number;
  stop: number;
  step: number;
  src2?: { src: string; start: number; stop: number; step: number };
}

export interface AcAnalysis {
  type: 'ac';
  sweep: SweepType;
  /** points per decade/octave, or total points for 'lin' */
  points: number;
  fstart: number;
  fstop: number;
  /** explicit frequency list when sweep === 'list' */
  list?: number[];
}

/** Single-frequency AC: phasor values of every output at one frequency. */
export interface AcSingleAnalysis { type: 'acsingle'; freq: number }

export interface TranAnalysis {
  type: 'tran';
  tstep: number;
  tstop: number;
  tstart?: number;
  tmax?: number;
  /** Use initial conditions: skip operating point. */
  uic?: boolean;
}

export interface NoiseAnalysis {
  type: 'noise';
  /** output node (voltage) */
  output: string;
  /** optional reference node (default ground) */
  ref?: string;
  /** input source name (V or I) */
  src: string;
  sweep: SweepType;
  points: number;
  fstart: number;
  fstop: number;
}

/** Small-signal DC transfer function. output: "V(a)" | "V(a,b)" | "I(Vx)". */
export interface TfAnalysis { type: 'tf'; output: string; src: string }

/** DC sensitivity of an output to all element values/params (optionally AC). */
export interface SensAnalysis {
  type: 'sens';
  output: string;
  ac?: { sweep: SweepType; points: number; fstart: number; fstop: number };
}

export interface PzAnalysis {
  type: 'pz';
  inPos: string;
  inNeg: string;
  outPos: string;
  outNeg: string;
  transfer: 'vol' | 'cur';
  find: 'pol' | 'zer' | 'pz';
}

/** Fourier analysis of transient outputs (runs a transient internally). */
export interface FourierAnalysis {
  type: 'four';
  fundamental: number;
  harmonics: number;
  outputs: string[];
  /** number of fundamental periods to simulate before the analysed one (settling) */
  settleCycles?: number;
  tstep?: number;
  /** samples per period used for DFT (default 256) */
  samples?: number;
}

/** Harmonic / intermodulation distortion (small-signal). */
export interface DistoAnalysis {
  type: 'disto';
  sweep: SweepType;
  points: number;
  fstart: number;
  fstop: number;
  /** if set: intermodulation with f2 = f2overf1 * f1 */
  f2overf1?: number;
}

/** Noise figure at one or more frequencies (derived from noise analysis). */
export interface NoiseFigureAnalysis {
  type: 'noisefig';
  output: string;
  ref?: string;
  src: string;
  /** source resistance used as reference noise, ohms */
  rsource: number;
  freq: number;
}

/** Tolerance / variation description used by Monte Carlo & worst case. */
export interface ToleranceSpec {
  /** element name, e.g. "R1"; or model name when `model` is true */
  target: string;
  /** "value" for primary value, or a param / model-param name */
  param: string;
  model?: boolean;
  /** relative tolerance, e.g. 0.05 */
  tol: number;
  dist: 'uniform' | 'gaussian';
}

/** A scalar measurement computed on an output for families of runs. */
export interface MeasureSpec {
  output: string;
  func: 'max' | 'min' | 'avg' | 'rms' | 'pp' | 'final' | 'at' | 'rise_edge' | 'fall_edge' | 'freq_at_max';
  at?: number;
  threshold?: number;
}

export interface ParamSweepAnalysis {
  type: 'paramsweep';
  /** element name (or model name when model === true, or global .param name when global === true) */
  target: string;
  /** "value" or param name ("value" for a global parameter) */
  param: string;
  model?: boolean;
  /**
   * The target is a global `.param` (SPICE `.step param`): every run re-evaluates the netlist's
   * expressions with the parameter set to the value (needs the netlist before flattening).
   */
  global?: boolean;
  values: number[];
  /**
   * `global` sweeps of a SCHEMATIC: the netlist per value, built by the caller from the design with
   * the variable set to that value (the schematic netlister writes part values as numbers, so the
   * parameter cannot stay symbolic inside one netlist). `netlists[k]` belongs to `values[k]`; they
   * are un-flattened and run through the same path as a `.step param` of a SPICE deck. Never saved
   * with the design (src/model/steps.ts fills it right before a run).
   */
  netlists?: Netlist[];
  base: AnalysisSpec;
}

export interface TempSweepAnalysis { type: 'tempsweep'; temps: number[]; base: AnalysisSpec }

export interface MonteCarloAnalysis {
  type: 'montecarlo';
  runs: number;
  seed: number;
  tolerances: ToleranceSpec[];
  base: AnalysisSpec;
  measure?: MeasureSpec;
}

export interface WorstCaseAnalysis {
  type: 'worstcase';
  tolerances: ToleranceSpec[];
  base: AnalysisSpec;
  measure: MeasureSpec;
  direction: 'high' | 'low';
}

/** Two-parameter nested sweep. */
export interface NestedSweepAnalysis {
  type: 'nestedsweep';
  outer: { target: string; param: string; model?: boolean; values: number[] };
  inner: { target: string; param: string; model?: boolean; values: number[] };
  base: AnalysisSpec;
}

/** Minimum PCB trace width from transient currents (IPC-2221 style). */
export interface TraceWidthAnalysis {
  type: 'tracewidth';
  base: TranAnalysis;
  /** allowed temperature rise, °C */
  tempRise: number;
  /** copper weight, oz/ft² */
  copperOz: number;
  external: boolean;
}

export interface BatchAnalysis { type: 'batch'; items: AnalysisSpec[] }

/**
 * User-defined analysis: SPICE control cards, one per line (.op .dc .ac .tran .noise .tf .sens .pz
 * .four .disto .step .temp .options .ic .nodeset .save / .probe / .print), run on the circuit as a
 * batch: one result run per analysis card, with the cards' options, initial conditions and output
 * requests applied on top of the netlist's own. Element lines and .param are not allowed.
 */
export interface UserAnalysis { type: 'user'; text: string }

export type AnalysisSpec =
  | OpAnalysis
  | DcAnalysis
  | AcAnalysis
  | AcSingleAnalysis
  | TranAnalysis
  | NoiseAnalysis
  | TfAnalysis
  | SensAnalysis
  | PzAnalysis
  | FourierAnalysis
  | DistoAnalysis
  | NoiseFigureAnalysis
  | ParamSweepAnalysis
  | TempSweepAnalysis
  | MonteCarloAnalysis
  | WorstCaseAnalysis
  | NestedSweepAnalysis
  | TraceWidthAnalysis
  | BatchAnalysis
  | UserAnalysis;

export type AnalysisType = AnalysisSpec['type'];

/** Analysis a `.meas` directive applies to. */
export type MeasAnalysis = 'tran' | 'ac' | 'dc' | 'op' | 'noise' | 'tf';

/**
 * Kind of a `.meas` directive: FIND (value of expr at a point), DERIV (its derivative), WHEN (x
 * of a crossing), TRIG/TARG (x difference of two conditions), AVG / RMS / MIN / MAX / PP / INTEG
 * over a range, PARAM (expression of .param values and earlier measurements).
 */
export type MeasKind = 'find' | 'deriv' | 'when' | 'trigtarg' | 'avg' | 'rms' | 'min' | 'max' | 'pp' | 'integ' | 'param';

/**
 * A point of a measurement: the n-th (or last) rising / falling / any crossing of expr through
 * level (both expression text: lhs = rhs), counted from x = td; or a fixed x position `at`.
 */
export interface MeasCondition {
  expr?: string;
  level?: string;
  at?: number;
  edge: 'rise' | 'fall' | 'cross';
  count: number | 'last';
  td?: number;
}

/** One `.meas` / `.measure` card (src/sim/spice/measure.ts, evaluated by src/sim/analyses/meas.ts). */
export interface MeasDirective {
  analysis: MeasAnalysis;
  /** result name (also usable in later PARAM expressions) */
  name: string;
  kind: MeasKind;
  /** measured expression (find, deriv, range kinds) or the PARAM expression */
  expr?: string;
  /** find / deriv at a fixed x */
  at?: number;
  /** find / deriv / when: condition */
  when?: MeasCondition;
  /** trigtarg; range kinds may use them as the range */
  trig?: MeasCondition;
  targ?: MeasCondition;
  /** range kinds: x range (default: the whole result) */
  from?: number;
  to?: number;
  /** source line in a parsed netlist */
  line?: number;
}

export interface Netlist {
  title: string;
  elements: ElementIR[];
  /** keyed by lower-case model name */
  models: Record<string, ModelCard>;
  /** keyed by lower-case subcircuit name */
  subckts: Record<string, SubcktDef>;
  /** .param definitions: numbers or unevaluated expressions */
  params: Record<string, number | string>;
  options: Partial<SimOptions>;
  analyses: AnalysisSpec[];
  /** .ic node voltages */
  ic: Record<string, number>;
  /** .nodeset initial guesses */
  nodeset: Record<string, number>;
  /** output requests ("V(out)", "I(V1)", "all"); empty = all node voltages + source branch currents */
  saves: string[];
  /** `.meas` directives, applied to the results of the matching analyses (absent = none) */
  measures?: MeasDirective[];
}

export function emptyNetlist(title = ''): Netlist {
  return {
    title,
    elements: [],
    models: {},
    subckts: {},
    params: {},
    options: {},
    analyses: [],
    ic: {},
    nodeset: {},
    saves: [],
  };
}

export function isGroundNode(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === '0' || n === 'gnd';
}
