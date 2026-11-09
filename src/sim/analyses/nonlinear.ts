/**
 * Weakly nonlinear (Volterra) expansion of a circuit around its DC operating point x0, used by
 * the distortion analysis.
 *
 * Every device contributes to the residual F(x) = i(x) + dq(x)/dt: resistive currents i and
 * charges / fluxes q, each a function of the unknowns. Around x0,
 *     i(x0 + v) = i0 + G v + ½ i2[v,v] + ⅙ i3[v,v,v] + …,   likewise q with C, q2, q3,
 * where G + jωC is the AC matrix. The distortion analysis needs the symmetric multilinear forms
 * i2, q2 (bilinear) and i3, q3 (trilinear) applied to complex phasor vectors. The device
 * contract has no higher-derivative stamps, so they are computed here from device loads alone:
 *
 * - Resistive part: a device load in DC mode stamps its Newton linearisation (g, ieq = i − g·v),
 *   so accumulating Σ A·x − rhs over its stamps yields the device's currents i(x) exactly.
 * - Charge part: a load in transient mode with backward Euler, a step Δt and history
 *   q1 = q(x0) yields i(x) + (q(x) − q(x0))/Δt; subtracting the DC-mode load gives q(x) − q(x0).
 *   Δt = 1e-3/Ω_max keeps the charge term dominant at the highest analysed frequency.
 * - Directional derivatives along a real vector v use central finite-difference stencils of
 *   fourth order: 5-point for the second derivative, 7-point for the third. Each nonlinear device
 *   is evaluated separately through an accumulating LoadContext, with a step chosen so that the
 *   device's own node voltages move by at most 2 mV per stencil unit — well inside the Taylor
 *   range of exponential junctions (vt ≈ 26 mV) whatever the amplitude elsewhere in the circuit
 *   (e.g. at the output of a high-gain stage). Linear devices (Device.linear === true) have no
 *   higher-order terms and are skipped.
 * - Complex arguments follow from polarisation identities of symmetric forms:
 *     B(X,X) = B(a,a) − B(b,b) + 2j·B(a,b),  B(a,b) = (D2(a+b) − D2(a) − D2(b))/2   (X = a + jb)
 *     B(X,W) = (B(X+W, X+W) − B(X−W, X−W))/4
 *     T(X,X,X) = A − 3C + j(3B − D),  A = D3(a), D = D3(b), P± = D3(a ± b),
 *                B = (P+ − P− − 2D)/6, C = (P+ + P− − 2A)/6
 *     T(U,U,W) = (T(U+W) − T(U−W) − 2T(W))/6   with T(Z) = T(Z,Z,Z).
 *
 * The device loads leave device state and cached small-signal values at perturbed points; call
 * {@link NonlinearExpansion.restore} before using the devices again (AC assembly).
 *
 * Limitations: charge models that are not functions of the instantaneous voltages (the Meyer
 * MOSFET capacitances integrate a step-averaged capacitance) are expanded as the device
 * integrates them, which is exact to second order only. Delay networks inside a device model
 * (the BJT excess-phase filter, PTF ≠ 0) are not charges and are not represented: the
 * distortion of such devices is that of the device without excess phase on the nonlinear terms
 * (a few percent off at frequencies where the excess phase matters).
 */
import type { IntegrationMethod, LoadContext } from '../device';
import type { SimOptions } from '../netlist';
import type { EngineDevice } from '../engine/hooks';
import type { RealSystem } from '../engine/system';
import { residualAt, setDcMode } from './util';

export interface ComplexVec {
  re: Float64Array;
  im: Float64Array;
}

/** A multilinear form applied to arguments: resistive-current part i and charge part q. */
export interface IQ {
  i: ComplexVec;
  q: ComplexVec;
}

/** Stencil step: maximum change of a device's own node voltages per stencil unit (V). */
const STEP = 2e-3;
const STENCIL2 = { den: 12, points: [[-2, -1], [-1, 16], [0, -30], [1, 16], [2, -1]] as const };
const STENCIL3 = { den: 8, points: [[-3, 1], [-2, -8], [-1, 13], [1, -13], [2, 8], [3, -1]] as const };

/** LoadContext that accumulates weight·(A·x − rhs) of the stamps into `acc`. */
class AccumulatingContext implements LoadContext {
  mode: 'op' | 'dc' | 'tran' = 'op';
  readonly initJunctions = false;
  readonly initTimepoint = false;
  readonly tranOp = false;
  readonly uic = false;
  time = 0;
  dt = 0;
  method: IntegrationMethod = 'be';
  readonly gmin: number;
  readonly srcFact = 1;
  readonly temp: number;
  readonly options: SimOptions;
  xv: Float64Array;
  acc: Float64Array;
  weight = 1;
  /** Columns / rows touched by the stamps (recorded while non-null). */
  cols: Set<number> | null = null;

  constructor(private readonly sys: RealSystem) {
    this.gmin = sys.circuit.options.gmin;
    this.temp = sys.circuit.tempK;
    this.options = sys.circuit.options;
    this.xv = new Float64Array(sys.n);
    this.acc = new Float64Array(sys.n);
  }

  get state0(): Float64Array {
    return this.sys.ctx.state0;
  }

  get state1(): Float64Array {
    return this.sys.ctx.state1;
  }

  get state2(): Float64Array {
    return this.sys.ctx.state2;
  }

  readonly x = (i: number): number => (i < 0 ? 0 : this.xv[i]);

  readonly addMatrix = (row: number, col: number, value: number): void => {
    if (row < 0 || col < 0) return;
    this.acc[row] += this.weight * value * this.xv[col];
    this.cols?.add(col);
  };

  readonly addRhs = (row: number, value: number): void => {
    if (row >= 0) this.acc[row] -= this.weight * value;
  };

  readonly integrate = (q: number, cap: number): { geq: number; i: number } => this.sys.ctx.integrate(q, cap);

  readonly noncon = (): void => undefined;
}

interface DeviceEntry {
  device: EngineDevice;
  /** Every unknown the device's stamps depend on (its inputs). */
  cols: number[];
  /** Node-voltage inputs (step scaling), or all inputs when it has none. */
  scaleCols: number[];
}

function zeros(n: number): ComplexVec {
  return { re: new Float64Array(n), im: new Float64Array(n) };
}

function isZero(v: Float64Array): boolean {
  for (let i = 0; i < v.length; i++) if (v[i] !== 0) return false;
  return true;
}

function lin(a: Float64Array, ca: number, b: Float64Array, cb: number): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = ca * a[i] + cb * b[i];
  return out;
}

function addScaled(target: IQ, src: IQ, c: number): void {
  for (const part of ['i', 'q'] as const) {
    const t = target[part];
    const s = src[part];
    for (let k = 0; k < t.re.length; k++) {
      t.re[k] += c * s.re[k];
      t.im[k] += c * s.im[k];
    }
  }
}

function complexSum(a: ComplexVec, ca: number, b: ComplexVec, cb: number): ComplexVec {
  return { re: lin(a.re, ca, b.re, cb), im: lin(a.im, ca, b.im, cb) };
}

/** Conjugate of a complex vector. */
export function conjugate(v: ComplexVec): ComplexVec {
  return { re: v.re.slice(), im: v.im.map((x) => -x) };
}

/** scale·(i + jω·q): the current phasor of a multilinear term at angular frequency ω. */
export function forcing(t: IQ, omega: number, scale: number): ComplexVec {
  const n = t.i.re.length;
  const out = zeros(n);
  for (let k = 0; k < n; k++) {
    out.re[k] = scale * (t.i.re[k] - omega * t.q.im[k]);
    out.im[k] = scale * (t.i.im[k] + omega * t.q.re[k]);
  }
  return out;
}

export class NonlinearExpansion {
  readonly n: number;
  private readonly sys: RealSystem;
  private readonly x0: Float64Array;
  private readonly dt: number;
  private readonly ctx: AccumulatingContext;
  private readonly entries: DeviceEntry[];
  private readonly accT: Float64Array;

  /**
   * @param sys system whose circuit is at its converged operating point
   * @param x0 operating-point solution
   * @param omegaMax highest angular frequency at which charge terms are needed (rad/s)
   */
  constructor(sys: RealSystem, x0: Float64Array, omegaMax: number) {
    this.sys = sys;
    this.n = sys.n;
    this.x0 = x0.slice();
    this.dt = 1e-3 / Math.max(omegaMax, 1e-12);
    this.ctx = new AccumulatingContext(sys);
    this.accT = new Float64Array(this.n);
    // charges at x0 become the integration history q1
    const tmp = new Float64Array(this.n);
    setDcMode(sys);
    sys.ctx.tranOp = true;
    residualAt(sys, this.x0, tmp);
    sys.ctx.tranOp = false;
    sys.seedHistory();
    const circuit = sys.circuit;
    const numNodes = circuit.numNodes;
    // structure probes: x0 and two nearby points, so that controlling unknowns whose first
    // derivative happens to vanish at x0 (e.g. k·v³ at v = 0) are still discovered
    const probes: Float64Array[] = [this.x0];
    let seed = 0x2545f491;
    for (let p = 0; p < 2; p++) {
      const x = this.x0.slice();
      for (let i = 0; i < x.length; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        x[i] += 1e-3 * (0.5 + seed / 4294967296) * (seed & 1 ? 1 : -1);
      }
      probes.push(x);
    }
    this.entries = [];
    for (const d of circuit.devices) {
      if (d.linear === true) continue;
      // columns the device's currents depend on (its stamps), not merely its terminals: a
      // controlled source's output terminals must not shrink the step on its controlling node
      const cols = new Set<number>();
      this.ctx.cols = cols;
      this.ctx.acc = tmp;
      this.ctx.weight = 0;
      for (const x of probes) {
        this.ctx.xv.set(x);
        this.setMode('op');
        d.load(this.ctx);
        this.setMode('tran');
        d.load(this.ctx);
      }
      this.ctx.cols = null;
      const all = [...cols];
      const nodes = all.filter((c) => c < numNodes);
      this.entries.push({ device: d, cols: all, scaleCols: nodes.length > 0 ? nodes : all });
    }
    this.ctx.xv.set(this.x0);
    this.restore();
  }

  /** True when the circuit has no nonlinear device (all distortion terms vanish). */
  get isLinear(): boolean {
    return this.entries.length === 0;
  }

  private setMode(mode: 'op' | 'tran'): void {
    const ec = this.sys.ctx;
    if (mode === 'op') {
      ec.mode = 'op';
      ec.tranOp = false;
      ec.time = 0;
      ec.dt = 0;
      this.ctx.mode = 'op';
      this.ctx.time = 0;
      this.ctx.dt = 0;
      this.ctx.method = 'be';
    } else {
      ec.mode = 'tran';
      ec.tranOp = false;
      ec.setIntegration({ order: 1, method: 'trap', dt: this.dt, dtPrev: this.dt });
      ec.time = this.dt;
      this.ctx.mode = 'tran';
      this.ctx.time = this.dt;
      this.ctx.dt = this.dt;
      this.ctx.method = 'be';
    }
  }

  /** Directional derivative of order 2 or 3 along real v: resistive and charge parts. */
  private directional(v: Float64Array, order: 2 | 3): { i: Float64Array; q: Float64Array } {
    const n = this.n;
    const accI = new Float64Array(n);
    const accT = this.accT;
    accT.fill(0);
    const st = order === 2 ? STENCIL2 : STENCIL3;
    // ctx.xv holds x0; only the inputs of the device being evaluated are moved (the device does
    // not depend on the other unknowns) and they are put back afterwards
    const x = this.ctx.xv;
    const x0 = this.x0;
    for (const e of this.entries) {
      let s = 0;
      for (const c of e.scaleCols) s = Math.max(s, Math.abs(v[c]));
      if (s === 0) continue;
      const h = STEP / s;
      const scale = 1 / (st.den * Math.pow(h, order));
      for (const [k, w] of st.points) {
        for (const c of e.cols) x[c] = x0[c] + k * h * v[c];
        this.ctx.weight = w * scale;
        this.setMode('op');
        this.ctx.acc = accI;
        e.device.load(this.ctx);
        this.setMode('tran');
        this.ctx.acc = accT;
        e.device.load(this.ctx);
      }
      for (const c of e.cols) x[c] = x0[c];
    }
    const q = new Float64Array(n);
    for (let i = 0; i < n; i++) q[i] = this.dt * (accT[i] - accI[i]);
    return { i: accI, q };
  }

  /** B(X, X) for the second-order forms i2, q2. */
  quadratic(X: ComplexVec): IQ {
    const n = this.n;
    if (this.isLinear) return { i: zeros(n), q: zeros(n) };
    const a = X.re;
    const b = X.im;
    const da = this.directional(a, 2);
    if (isZero(b)) return { i: { re: da.i, im: new Float64Array(n) }, q: { re: da.q, im: new Float64Array(n) } };
    const db = this.directional(b, 2);
    const dab = this.directional(lin(a, 1, b, 1), 2);
    // B(a,b) = (D2(a+b) - D2(a) - D2(b)) / 2 ; result = D2(a) - D2(b) + 2j B(a,b)
    const part = (pa: Float64Array, pb: Float64Array, pab: Float64Array): ComplexVec => {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        re[k] = pa[k] - pb[k];
        im[k] = pab[k] - pa[k] - pb[k];
      }
      return { re, im };
    };
    return { i: part(da.i, db.i, dab.i), q: part(da.q, db.q, dab.q) };
  }

  /** B(X, W) for complex X, W. */
  bilinear(X: ComplexVec, W: ComplexVec): IQ {
    const n = this.n;
    const out: IQ = { i: zeros(n), q: zeros(n) };
    if (this.isLinear) return out;
    addScaled(out, this.quadratic(complexSum(X, 1, W, 1)), 0.25);
    addScaled(out, this.quadratic(complexSum(X, 1, W, -1)), -0.25);
    return out;
  }

  /** T(X, X, X) for the third-order forms i3, q3. */
  cubic(X: ComplexVec): IQ {
    const n = this.n;
    if (this.isLinear) return { i: zeros(n), q: zeros(n) };
    const a = X.re;
    const b = X.im;
    const A = this.directional(a, 3);
    if (isZero(b)) return { i: { re: A.i, im: new Float64Array(n) }, q: { re: A.q, im: new Float64Array(n) } };
    const D = this.directional(b, 3);
    const P = this.directional(lin(a, 1, b, 1), 3);
    const M = this.directional(lin(a, 1, b, -1), 3);
    const part = (pa: Float64Array, pd: Float64Array, pp: Float64Array, pm: Float64Array): ComplexVec => {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const B = (pp[k] - pm[k] - 2 * pd[k]) / 6;
        const C = (pp[k] + pm[k] - 2 * pa[k]) / 6;
        re[k] = pa[k] - 3 * C;
        im[k] = 3 * B - pd[k];
      }
      return { re, im };
    };
    return { i: part(A.i, D.i, P.i, M.i), q: part(A.q, D.q, P.q, M.q) };
  }

  /** T(U, U, W) for complex U, W. */
  mixedCubic(U: ComplexVec, W: ComplexVec): IQ {
    const n = this.n;
    const out: IQ = { i: zeros(n), q: zeros(n) };
    if (this.isLinear) return out;
    addScaled(out, this.cubic(complexSum(U, 1, W, 1)), 1 / 6);
    addScaled(out, this.cubic(complexSum(U, 1, W, -1)), -1 / 6);
    addScaled(out, this.cubic(W), -1 / 3);
    return out;
  }

  /** Reload every device at the operating point (DC mode) so cached small-signal values are valid. */
  restore(): void {
    setDcMode(this.sys);
    residualAt(this.sys, this.x0, new Float64Array(this.n));
  }
}
