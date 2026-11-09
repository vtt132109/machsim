/**
 * Shared helpers of the advanced analyses (src/sim/analyses).
 *
 * - {@link parseOutput}: turns an output request ("V(out)", "V(a,b)", "I(V1)", "Ic(Q1)", or a
 *   bare node name) into a linear functional y = Σ coef·x[i] over the MNA unknowns. Voltage and
 *   branch-current outputs are exact selections; derived device outputs (DC only) are linearised
 *   at an operating point by central differences of Device.outputs().
 * - {@link findSource} / {@link addSourceExcitation}: independent V/I sources used as analysis
 *   inputs and their right-hand-side excitation (SPICE sign conventions of src/sim/device.ts).
 * - {@link residualAt}: the KCL / branch-equation residual F(x) = A(x)·x − rhs(x) of a real
 *   assembly. Because every device stamps its Newton linearisation (g, ieq = i − g·v), F(x) is
 *   the sum of the device currents leaving each node, which is what parameter sensitivities and
 *   distortion derivatives are computed from.
 * - {@link childContext}: an AnalysisContext for a nested analysis (sweeps, Monte Carlo, batch)
 *   whose progress maps into a sub-range of the parent's progress.
 * - small numeric helpers (formatting, complex arithmetic, time-weighted statistics).
 */
import { GROUND } from '../device';
import type { AnalysisSpec, ElementIR, Netlist } from '../netlist';
import { SimulationError, type AnalysisResult, type VectorUnit } from '../results';
import type { AnalysisContext } from '../engine/analysis-registry';
import type { Circuit } from '../engine/circuit';
import type { EngineDevice } from '../engine/hooks';
import { deviceOutputKeys, unitForKey } from '../engine/outputs';
import { runSpec } from '../engine/run';
import type { RealSystem } from '../engine/system';

// ---------------------------------------------------------------------------------------------
// Output functionals
// ---------------------------------------------------------------------------------------------

export type OutputKind = 'voltage' | 'branch' | 'device';

/** A scalar circuit output expressed over the MNA unknowns. */
export interface OutputFunctional {
  /** Canonical vector name: "V(out)", "V(a,b)", "I(V1)", "Ic(Q1)". */
  name: string;
  unit: VectorUnit;
  kind: OutputKind;
  /** Non-zero coefficients of y = Σ coef·x[index] (linearisation at x0 for device outputs). */
  terms: { index: number; coef: number }[];
  /** Voltage outputs: positive / negative node index (GROUND = -1). */
  pos: number;
  neg: number;
  /** Branch outputs: the branch-current unknown (-1 otherwise). */
  branch: number;
  /** Device outputs: owning device and output key. */
  device?: EngineDevice;
  key?: string;
  /** Exact value of the output at solution x. */
  value(x: Float64Array): number;
}

const CALL_RE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([^,()]+?)\s*(?:,\s*([^,()]+?)\s*)?\)\s*$/;

export interface ParseOutputOptions {
  /** Accept derived device outputs such as I(R1) or Ic(Q1) (requires x0). */
  allowDevice?: boolean;
  /** Operating point used to linearise device outputs. */
  x0?: Float64Array;
  /** Analysis name used in error messages, e.g. "Transfer function". */
  what?: string;
}

function nodeOrThrow(circuit: Circuit, name: string, what: string): number {
  const idx = circuit.nodeIndex(name);
  if (idx === undefined) throw new SimulationError(`${what}: unknown node '${name}'`, 'netlist');
  return idx;
}

function voltageOutput(circuit: Circuit, a: number, b: number): OutputFunctional {
  const terms: { index: number; coef: number }[] = [];
  if (a >= 0) terms.push({ index: a, coef: 1 });
  if (b >= 0) terms.push({ index: b, coef: -1 });
  const name = b === GROUND ? `V(${circuit.unknownName(a)})` : `V(${circuit.unknownName(a)},${circuit.unknownName(b)})`;
  return {
    name,
    unit: 'V',
    kind: 'voltage',
    terms,
    pos: a,
    neg: b,
    branch: -1,
    value: (x) => (a >= 0 ? x[a] : 0) - (b >= 0 ? x[b] : 0),
  };
}

function branchOf(d: EngineDevice): number {
  const b = d.branchIndex ? d.branchIndex() : -1;
  return typeof b === 'number' && b >= 0 ? b : -1;
}

/**
 * Parse an output request into a functional. Accepted forms: "V(a)", "V(a,b)", a bare node name,
 * "I(dev)" for devices owning a branch unknown (V, L, E, H, B with V=), and — with
 * `allowDevice` — any derived device output "KEY(dev)" (I(R1), Ic(Q1), ...).
 */
export function parseOutput(circuit: Circuit, text: string, opts: ParseOutputOptions = {}): OutputFunctional {
  const what = opts.what ?? 'Output';
  const req = text.trim();
  if (req.length === 0) throw new SimulationError(`${what}: empty output specification`, 'netlist');
  const m = CALL_RE.exec(req);
  if (!m) {
    const a = nodeOrThrow(circuit, req, what);
    if (a === GROUND) throw new SimulationError(`${what}: output node '${req}' is ground`, 'netlist');
    return voltageOutput(circuit, a, GROUND);
  }
  const fn = m[1].toLowerCase();
  if (fn === 'v') {
    const a = nodeOrThrow(circuit, m[2], what);
    const b = m[3] !== undefined ? nodeOrThrow(circuit, m[3], what) : GROUND;
    if (a === b) throw new SimulationError(`${what}: output '${req}' is identically zero`, 'netlist');
    if (a === GROUND) {
      // V(0,b) = -V(b): keep a non-ground positive node for naming
      const o = voltageOutput(circuit, b, GROUND);
      return { ...o, name: `V(0,${circuit.unknownName(b)})`, terms: [{ index: b, coef: -1 }], pos: GROUND, neg: b, value: (x) => -x[b] };
    }
    return voltageOutput(circuit, a, b);
  }
  if (m[3] !== undefined) throw new SimulationError(`${what}: invalid output '${req}'`, 'netlist');
  const d = circuit.findDevice(m[2]);
  if (!d) throw new SimulationError(`${what}: unknown element '${m[2]}' in output '${req}'`, 'netlist');
  if (fn === 'i') {
    const br = branchOf(d);
    if (br >= 0) {
      return {
        name: `I(${d.name})`,
        unit: 'A',
        kind: 'branch',
        terms: [{ index: br, coef: 1 }],
        pos: GROUND,
        neg: GROUND,
        branch: br,
        device: d,
        value: (x) => x[br],
      };
    }
  }
  if (!opts.allowDevice) {
    throw new SimulationError(
      `${what}: output '${req}' must be a node voltage V(a[,b]) or the current of an element with a branch unknown (V, L, E, H)`,
      'netlist',
    );
  }
  const key = deviceOutputKeys(d).find((k) => k.toLowerCase() === fn);
  if (key === undefined || !d.outputs) throw new SimulationError(`${what}: output '${req}' is not available`, 'netlist');
  const x0 = opts.x0;
  if (!x0) throw new SimulationError(`${what}: device output '${req}' needs an operating point`, 'internal');
  const outputs = d.outputs.bind(d);
  const value = (x: Float64Array): number => {
    const v = outputs((i) => (i < 0 ? 0 : x[i]))[key];
    return typeof v === 'number' ? v : Number.NaN;
  };
  return {
    name: `${key}(${d.name})`,
    unit: unitForKey(key),
    kind: 'device',
    terms: linearise(value, x0),
    pos: GROUND,
    neg: GROUND,
    branch: -1,
    device: d,
    key,
    value,
  };
}

/** Gradient of a scalar function of the unknowns at x0 (central differences), as sparse terms. */
function linearise(f: (x: Float64Array) => number, x0: Float64Array): { index: number; coef: number }[] {
  const x = x0.slice();
  const terms: { index: number; coef: number }[] = [];
  for (let i = 0; i < x.length; i++) {
    const h = 1e-6 * Math.max(1, Math.abs(x0[i]));
    x[i] = x0[i] + h;
    const yp = f(x);
    x[i] = x0[i] - h;
    const ym = f(x);
    x[i] = x0[i];
    const g = (yp - ym) / (2 * h);
    if (Number.isFinite(g) && g !== 0) terms.push({ index: i, coef: g });
  }
  return terms;
}

/** Dense coefficient vector of an output functional (length n). */
export function outputVector(o: OutputFunctional, n: number): Float64Array {
  const c = new Float64Array(n);
  for (const t of o.terms) c[t.index] += t.coef;
  return c;
}

/** Σ coef·v[index] of an output functional applied to a vector (complex: call per part). */
export function applyOutput(o: OutputFunctional, v: Float64Array): number {
  let s = 0;
  for (const t of o.terms) s += t.coef * v[t.index];
  return s;
}

// ---------------------------------------------------------------------------------------------
// Independent sources as analysis inputs
// ---------------------------------------------------------------------------------------------

export interface SourceRef {
  name: string;
  type: 'V' | 'I';
  device: EngineDevice;
  element: ElementIR;
  /** n+ / n- node indices (GROUND = -1). */
  p: number;
  n: number;
  /** Branch unknown of a V source (-1 for I sources). */
  branch: number;
}

/** Element IR of every device of a circuit (devices and netlist elements are in the same order). */
export function elementOf(circuit: Circuit, device: EngineDevice): ElementIR | undefined {
  const k = circuit.devices.indexOf(device);
  return k >= 0 ? circuit.netlist.elements[k] : undefined;
}

/** Node indices of a device's IR nodes (GROUND = -1; -2 for nodes unknown to the circuit). */
export function deviceNodes(circuit: Circuit, device: EngineDevice): number[] {
  return device.nodeNames.map((n) => circuit.nodeIndex(n) ?? -2);
}

/** Resolve an independent V or I source by name. */
export function findSource(circuit: Circuit, name: string, what: string): SourceRef {
  const d = circuit.findDevice(name);
  if (!d) throw new SimulationError(`${what}: source '${name}' not found`, 'netlist');
  if (d.type !== 'V' && d.type !== 'I') {
    throw new SimulationError(`${what}: '${d.name}' is not an independent voltage or current source`, 'netlist');
  }
  const element = elementOf(circuit, d);
  if (!element) throw new SimulationError(`${what}: source '${name}' has no netlist element`, 'internal');
  const [p, n] = deviceNodes(circuit, d);
  return { name: d.name, type: d.type, device: d, element, p, n, branch: d.type === 'V' ? branchOf(d) : -1 };
}

/**
 * Add the excitation of a source with complex value (re + j·im) to a right-hand side:
 * a V source sets its branch equation v(p) − v(n) = value; an I source drives its current from
 * n+ through the source to n− (rhs[p] −= value, rhs[n] += value).
 */
export function addSourceExcitation(src: SourceRef, re: number, im: number, bRe: Float64Array, bIm: Float64Array): void {
  if (src.type === 'V') {
    bRe[src.branch] += re;
    bIm[src.branch] += im;
    return;
  }
  if (src.p >= 0) {
    bRe[src.p] -= re;
    bIm[src.p] -= im;
  }
  if (src.n >= 0) {
    bRe[src.n] += re;
    bIm[src.n] += im;
  }
}

/**
 * Transfer from a source to the output given the adjoint solution z = Y⁻ᵀ c: the output produced
 * by a unit source value is zᵀ b, where b is the source's unit excitation.
 */
export function sourceGainFromAdjoint(src: SourceRef, zRe: Float64Array, zIm: Float64Array): { re: number; im: number } {
  if (src.type === 'V') return { re: zRe[src.branch], im: zIm[src.branch] };
  const pr = src.p >= 0 ? zRe[src.p] : 0;
  const pi = src.p >= 0 ? zIm[src.p] : 0;
  const nr = src.n >= 0 ? zRe[src.n] : 0;
  const ni = src.n >= 0 ? zIm[src.n] : 0;
  return { re: nr - pr, im: ni - pi };
}

// ---------------------------------------------------------------------------------------------
// Real residual
// ---------------------------------------------------------------------------------------------

/**
 * Residual F(x) = A(x)·x − rhs(x) of a real assembly at x (copied into sys.x). The load context
 * flags (mode, tranOp, integration) must be set by the caller. Writes and returns `out`.
 */
export function residualAt(sys: RealSystem, x: Float64Array, out: Float64Array): Float64Array {
  sys.x.set(x);
  sys.assemble();
  sys.matrix.multiply(sys.x, out);
  const rhs = sys.rhs;
  for (let i = 0; i < out.length; i++) out[i] -= rhs[i];
  return out;
}

/** Put a system's load context into plain DC operating-point mode. */
export function setDcMode(sys: RealSystem): void {
  const ctx = sys.ctx;
  ctx.mode = 'op';
  ctx.tranOp = false;
  ctx.uic = false;
  ctx.initJunctions = false;
  ctx.initTimepoint = false;
  ctx.time = 0;
  ctx.dt = 0;
  ctx.srcFact = 1;
  ctx.gmin = sys.circuit.options.gmin;
  sys.diagGmin = 0;
  sys.forced = [];
}

// ---------------------------------------------------------------------------------------------
// Nested analyses
// ---------------------------------------------------------------------------------------------

function clamp01(f: number): number {
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
}

/**
 * Context for a nested analysis on `netlist` whose progress [0, 1] maps to [from, to] of the
 * parent's progress. Circuits are built from `netlist` by default.
 */
export function childContext(ctx: AnalysisContext, netlist: Netlist, from = 0, to = 1): AnalysisContext {
  const child: AnalysisContext = {
    netlist,
    ...(ctx.source && netlist === ctx.netlist ? { source: ctx.source } : {}),
    runOptions: ctx.runOptions,
    signal: ctx.signal,
    buildCircuit: (n, overrides) => ctx.buildCircuit(n ?? netlist, overrides),
    runSpec: (spec: AnalysisSpec, n?: Netlist) => runSpec(spec, n === undefined ? child : childContext(child, n, 0, 1)),
    checkAbort: () => ctx.checkAbort(),
    progress: (fraction, message) => ctx.progress(from + (to - from) * clamp01(fraction), message),
  };
  return child;
}

/** Run a nested analysis on `netlist` with progress mapped to [from, to]; never throws. */
export function runNested(ctx: AnalysisContext, spec: AnalysisSpec, netlist: Netlist, from: number, to: number): AnalysisResult {
  return runSpec(spec, childContext(ctx, netlist, from, to));
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export { formatNumber } from './format';

/** Magnitude of each sample of a (possibly complex) vector. */
export function magnitudes(re: Float64Array, im?: Float64Array): Float64Array {
  if (!im) return re;
  const out = new Float64Array(re.length);
  for (let k = 0; k < re.length; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

/**
 * Time-weighted mean and RMS of samples v over scale t (trapezoidal rule); plain arithmetic
 * statistics when there is no usable scale.
 */
export function weightedStats(v: ArrayLike<number>, t?: ArrayLike<number>): { mean: number; rms: number } {
  const n = v.length;
  if (n === 0) return { mean: Number.NaN, rms: Number.NaN };
  if (t && t.length === n && n >= 2 && t[n - 1] > t[0]) {
    let s1 = 0;
    let s2 = 0;
    for (let k = 1; k < n; k++) {
      const h = t[k] - t[k - 1];
      s1 += 0.5 * h * (v[k] + v[k - 1]);
      s2 += 0.5 * h * (v[k] * v[k] + v[k - 1] * v[k - 1]);
    }
    const span = t[n - 1] - t[0];
    return { mean: s1 / span, rms: Math.sqrt(Math.max(0, s2 / span)) };
  }
  let s1 = 0;
  let s2 = 0;
  for (let k = 0; k < n; k++) {
    s1 += v[k];
    s2 += v[k] * v[k];
  }
  return { mean: s1 / n, rms: Math.sqrt(s2 / n) };
}
