/**
 * Lossy transmission line (LTRA): element O, nodes [p1+, p1-, p2+, p2-], model card type LTRA.
 *
 * Model parameters (per metre): R (ohm/m), L (H/m), G (S/m), C (F/m), LEN (m). COMPACTREL /
 * COMPACTABS set the history compaction of RC lines; REL, ABS, NOSTEPLIMIT, NOCONTROL, LININTERP,
 * QUADINTERP, MIXEDINTERP, TRUNCNR, TRUNCDONTCUT are accepted without effect.
 * Supported line types (as in SPICE3 LTRA):
 *   LC   R = 0, G = 0            lossless (pure delays)
 *   RLC  R > 0, L > 0, C > 0, G = 0
 *   RC   L = 0, G = 0           distributed RC (no wavefront delay)
 *   RG   L = 0, C = 0           resistive line (static two-port)
 * Lines with both L and G (RLCG) are rejected as unsupported.
 *
 * Transient. With port currents i1, i2 flowing into the line at the + terminals (two branch
 * unknowns) the exact port relations are convolutions with the kernels of ltraKernels.ts:
 *   i1 = Yinf v1 + (y0 * v1) - (hy0 * v2) - (h * i2)
 *   i2 = Yinf v2 + (y0 * v2) - (hy0 * v1) - (h * i1)
 * - LC / RLC lines (wave model): h and hy0 start at the delay T = LEN sqrt(LC), so with the step
 *   limited to T their terms only need the delayed, already accepted history (interpolated
 *   linearly, like the T element). The regular kernel parts are exponential sums, convolved
 *   recursively (one state per term and signal, exact for piecewise-linear signals): the cost per
 *   timepoint does not grow with the length of the run. y0 couples v at t_n through
 *   sum a (E0 - E1/dt). Wavefront corners schedule breakpoints T later.
 * - RC lines: the admittance form i1 = (y11 * v1) + (y12 * v2), i2 = (y12 * v1) + (y11 * v2)
 *   (voltages only: the singular input current of a driven RC line is never interpolated),
 *   evaluated on the piecewise-linear voltage history with the exact series ramp responses
 *   (O(knots) per timepoint). Knots that their neighbours interpolate within
 *   COMPACTREL (default 1e-4) relative / COMPACTABS (1e-12) absolute are dropped, and an
 *   open-ended interactive run keeps at most MAX_HISTORY knots (older ones are folded into the DC
 *   reference, an approximation of the line's long memory).
 * Before t = 0 the line is in its DC steady state.
 * OP / DC: series resistance R*LEN between the ports (RLC, RC, LC: v1 - v2 = R LEN i1, i1 = -i2);
 * RG lines use their exact DC Y parameters in every analysis.
 * AC: exact port relations at jw, I1 = Y0 V1 - H (Y0 V2 + I2), Y0 = sqrt((G + jwC)/(R + jwL)),
 * H = exp(-LEN sqrt((R + jwL)(G + jwC))); finite also at the resonances of lossless lines.
 *
 * Outputs: I1, I2 (port currents into the line).
 */
import type { AcContext, Device, LoadContext, SetupContext } from '../../device';
import type { ElementIR, ElementType, ModelCard } from '../../netlist';
import { SimulationError } from '../../results';
import type { AcceptContext, EngineDeviceExtensions, TransientSetup } from '../../engine/hooks';
import { requireNodes, runtimeParamError } from './common';
import { expIntervalWeights, rcYKernels, rlcExponentials, type ExpTerm, type RampResponse, type RlcExpKernels } from './ltraKernels';

export type LtraKind = 'lc' | 'rlc' | 'rc' | 'rg';

/** Largest number of history knots an open-ended run keeps for an RC line. */
export const MAX_HISTORY = 20000;

interface Complex {
  re: number;
  im: number;
}
const cx = (re: number, im = 0): Complex => ({ re, im });
const cmul = (a: Complex, b: Complex): Complex => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const csqrt = (a: Complex): Complex => {
  const m = Math.hypot(a.re, a.im);
  const re = Math.sqrt(Math.max(0, (m + a.re) / 2));
  const im = Math.sqrt(Math.max(0, (m - a.re) / 2)) * (a.im < 0 ? -1 : 1);
  return cx(re, im);
};
const cexp = (a: Complex): Complex => {
  const e = Math.exp(a.re);
  return cx(e * Math.cos(a.im), e * Math.sin(a.im));
};

/** Exact Y parameters (y11 = y22, y12 = y21) of a uniform RLGC line at angular frequency w. */
export function lineYParams(r: number, l: number, g: number, c: number, len: number, w: number): { y11: Complex; y12: Complex } {
  const z = cx(r, w * l);
  const y = cx(g, w * c);
  if (z.re === 0 && z.im === 0) throw new SimulationError('LTRA: zero series impedance', 'netlist');
  if (y.re === 0 && y.im === 0) {
    const yz = cdiv(cx(1), cx(z.re * len, z.im * len));
    return { y11: yz, y12: cx(-yz.re, -yz.im) };
  }
  let gl = csqrt(cmul(z, y));
  if (gl.re < 0) gl = cx(-gl.re, -gl.im);
  gl = cx(gl.re * len, gl.im * len);
  const z0 = csqrt(cdiv(z, y));
  const e2 = cexp(cx(-2 * gl.re, -2 * gl.im));
  const e1 = cexp(cx(-gl.re, -gl.im));
  const den = cx(1 - e2.re, -e2.im);
  const coth = cdiv(cx(1 + e2.re, e2.im), den);
  const csch = cdiv(cx(2 * e1.re, 2 * e1.im), den);
  return { y11: cdiv(coth, z0), y12: cdiv(cx(-csch.re, -csch.im), z0) };
}

function modelParam(card: ModelCard, key: string): number {
  const v = card.params[key];
  return v !== undefined && Number.isFinite(v) ? v : 0;
}

/** Recursive convolution state of one exponential sum applied to one signal. */
class ExpConv {
  readonly s: Float64Array;
  constructor(readonly terms: readonly ExpTerm[]) {
    this.s = new Float64Array(terms.length);
  }
  /** DC steady state for a signal constant at x since t = -infinity. */
  reset(x: number): void {
    for (let k = 0; k < this.terms.length; k++) this.s[k] = x / this.terms[k].p;
  }
  /** Part of the convolution at t_n known before solving: sum a (decay s + x_prev E1/dt). */
  known(w: StepWeights, xPrev: number): number {
    let acc = 0;
    for (let k = 0; k < this.terms.length; k++) acc += this.terms[k].a * (w.decay[k] * this.s[k] + xPrev * w.e1dt[k]);
    return acc;
  }
  /** Commit the accepted interval. */
  advance(w: StepWeights, xPrev: number, x: number): void {
    for (let k = 0; k < this.terms.length; k++) this.s[k] = w.decay[k] * this.s[k] + xPrev * w.e1dt[k] + x * (w.e0[k] - w.e1dt[k]);
  }
}

/** Per-term interval weights for one step length. */
interface StepWeights {
  dt: number;
  decay: Float64Array;
  e0: Float64Array;
  e1dt: Float64Array;
  /** sum a (E0 - E1/dt): coefficient of the signal at t_n */
  coef: number;
}

function stepWeights(terms: readonly ExpTerm[], dt: number): StepWeights {
  const n = terms.length;
  const w: StepWeights = { dt, decay: new Float64Array(n), e0: new Float64Array(n), e1dt: new Float64Array(n), coef: 0 };
  for (let k = 0; k < n; k++) {
    const r = expIntervalWeights(terms[k].p, dt);
    w.decay[k] = r.decay;
    w.e0[k] = r.e0;
    w.e1dt[k] = r.e1 / dt;
    w.coef += terms[k].a * (r.e0 - r.e1 / dt);
  }
  return w;
}

export class LossyLine implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'O';
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;

  private readonly modelName: string | undefined;
  private r = 0;
  private l = 0;
  private g = 0;
  private c = 0;
  private len = 1;
  private kind: LtraKind = 'lc';
  private wave: RlcExpKernels | null = null;
  private rc: { y11: RampResponse; y12: RampResponse } | null = null;
  private compactRel = 1e-4;
  private compactAbs = 1e-12;
  private openEnded = false;
  private p1 = -1;
  private n1 = -1;
  private p2 = -1;
  private n2 = -1;
  private br1 = -1;
  private br2 = -1;
  // accepted history knots: t, v1, v2, i1, i2
  private ht: number[] = [];
  private hv1: number[] = [];
  private hv2: number[] = [];
  private hi1: number[] = [];
  private hi2: number[] = [];
  // wave model: recursive states (y0 on v1 / v2; hy0 on delayed v1 / v2; h on delayed i1 / i2)
  private conv: ExpConv[] = [];
  /** delayed signal values used at the last accepted point: v1(t-T), v2(t-T), i1(t-T), i2(t-T) */
  private lastDelayed = [0, 0, 0, 0];
  private weightsY0: StepWeights | null = null;
  private weightsH: StepWeights | null = null;
  private weightsHy0: StepWeights | null = null;
  /** solve-time terms for the timepoint being solved */
  private cacheTime = Number.NaN;
  private cacheLen = -1;
  private gy = 0;
  private coefHy0 = 0;
  private coefH = 0;
  private rhs1 = 0;
  private rhs2 = 0;

  constructor(el: ElementIR) {
    requireNodes(el, 4);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
    this.modelName = el.model;
  }

  setup(ctx: SetupContext): void {
    const card = this.modelName ? ctx.model(this.modelName) : undefined;
    if (!card) throw new SimulationError(`${this.name}: LTRA model '${this.modelName ?? ''}' not found`, 'netlist');
    if (card.type.toUpperCase() !== 'LTRA') throw new SimulationError(`${this.name}: model '${card.name}' has type ${card.type}, expected LTRA`, 'netlist');
    this.r = modelParam(card, 'r');
    this.l = modelParam(card, 'l');
    this.g = modelParam(card, 'g');
    this.c = modelParam(card, 'c');
    this.len = modelParam(card, 'len');
    if (card.params.compactrel !== undefined && card.params.compactrel > 0) this.compactRel = card.params.compactrel;
    if (card.params.compactabs !== undefined && card.params.compactabs > 0) this.compactAbs = card.params.compactabs;
    this.classify();
    this.p1 = ctx.node(this.nodeNames[0]);
    this.n1 = ctx.node(this.nodeNames[1]);
    this.p2 = ctx.node(this.nodeNames[2]);
    this.n2 = ctx.node(this.nodeNames[3]);
    this.br1 = ctx.branch(`${this.name}#i1`);
    this.br2 = ctx.branch(`${this.name}#i2`);
  }

  private classify(): void {
    const { r, l, g, c, len } = this;
    if (!(len > 0)) throw new SimulationError(`${this.name}: LTRA length LEN must be > 0`, 'netlist');
    if (r < 0 || l < 0 || g < 0 || c < 0) throw new SimulationError(`${this.name}: LTRA R, L, G, C must not be negative`, 'netlist');
    if (l > 0 && c > 0 && g === 0) this.kind = r > 0 ? 'rlc' : 'lc';
    else if (l === 0 && r > 0 && c > 0 && g === 0) this.kind = 'rc';
    else if (l === 0 && c === 0 && r > 0) this.kind = 'rg';
    else throw new SimulationError(`${this.name}: LTRA line with R=${r} L=${l} G=${g} C=${c} is not supported (use LC, RLC, RC or RG lines)`, 'unsupported');
    this.wave = this.kind === 'lc' || this.kind === 'rlc' ? rlcExponentials(r, l, c, len) : null;
    this.rc = this.kind === 'rc' ? rcYKernels(r, c, len) : null;
    if (this.wave) this.conv = [this.wave.y0, this.wave.y0, this.wave.hy0, this.wave.hy0, this.wave.h, this.wave.h].map((t) => new ExpConv(t));
  }

  /** Line type (diagnostics / tests). */
  get lineKind(): LtraKind {
    return this.kind;
  }

  /** One-way delay of LC / RLC lines (0 otherwise). */
  get delay(): number {
    return this.wave?.delay ?? 0;
  }

  private stampKcl(ctx: LoadContext): void {
    ctx.addMatrix(this.p1, this.br1, 1);
    ctx.addMatrix(this.n1, this.br1, -1);
    ctx.addMatrix(this.p2, this.br2, 1);
    ctx.addMatrix(this.n2, this.br2, -1);
  }

  load(ctx: LoadContext): void {
    this.stampKcl(ctx);
    if (this.kind === 'rg') {
      const { y11, y12 } = lineYParams(this.r, 0, this.g, 0, this.len, 0);
      for (const [br, pa, na, pb, nb] of [
        [this.br1, this.p1, this.n1, this.p2, this.n2],
        [this.br2, this.p2, this.n2, this.p1, this.n1],
      ]) {
        ctx.addMatrix(br, br, 1);
        ctx.addMatrix(br, pa, -y11.re);
        ctx.addMatrix(br, na, y11.re);
        ctx.addMatrix(br, pb, -y12.re);
        ctx.addMatrix(br, nb, y12.re);
      }
      return;
    }
    if (ctx.mode !== 'tran' || ctx.tranOp || this.ht.length === 0) {
      // DC: v1 - v2 = R len i1 and i1 + i2 = 0
      ctx.addMatrix(this.br1, this.p1, 1);
      ctx.addMatrix(this.br1, this.n1, -1);
      ctx.addMatrix(this.br1, this.p2, -1);
      ctx.addMatrix(this.br1, this.n2, 1);
      ctx.addMatrix(this.br1, this.br1, -this.r * this.len);
      ctx.addMatrix(this.br2, this.br1, 1);
      ctx.addMatrix(this.br2, this.br2, 1);
      return;
    }
    if (this.wave) this.prepareWave(ctx.time);
    else this.prepareRc(ctx.time);
    const rows: [number, number, number, number, number, number, number][] = [
      [this.br1, this.p1, this.n1, this.p2, this.n2, this.br2, this.rhs1],
      [this.br2, this.p2, this.n2, this.p1, this.n1, this.br1, this.rhs2],
    ];
    for (const [br, pa, na, pb, nb, other, rhs] of rows) {
      ctx.addMatrix(br, br, 1);
      ctx.addMatrix(br, pa, -this.gy);
      ctx.addMatrix(br, na, this.gy);
      if (this.coefHy0 !== 0) {
        ctx.addMatrix(br, pb, this.coefHy0);
        ctx.addMatrix(br, nb, -this.coefHy0);
      }
      if (this.coefH !== 0) ctx.addMatrix(br, other, this.coefH);
      ctx.addRhs(br, rhs);
    }
  }

  // ------------------------------------------------------------------ wave model (LC, RLC)

  /** Signal of history array `w` at time t (linear interpolation; DC value before the first knot). */
  private delayedValue(w: number[], t: number): number {
    const ht = this.ht;
    const n = ht.length;
    if (t <= ht[0]) return w[0];
    if (t >= ht[n - 1]) {
      // only reached when a step exceeds the delay: extrapolate from the last interval
      if (n < 2 || t === ht[n - 1]) return w[n - 1];
      const s = (w[n - 1] - w[n - 2]) / (ht[n - 1] - ht[n - 2]);
      return w[n - 1] + s * (t - ht[n - 1]);
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ht[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = ht[hi] - ht[lo];
    return span > 0 ? w[lo] + ((w[hi] - w[lo]) * (t - ht[lo])) / span : w[hi];
  }

  private weights(dt: number): void {
    const k = this.wave!;
    if (this.weightsY0?.dt === dt) return;
    this.weightsY0 = stepWeights(k.y0, dt);
    this.weightsH = stepWeights(k.h, dt);
    this.weightsHy0 = stepWeights(k.hy0, dt);
  }

  private prepareWave(time: number): void {
    const n = this.ht.length;
    if (time === this.cacheTime && n === this.cacheLen) return;
    this.cacheTime = time;
    this.cacheLen = n;
    const k = this.wave!;
    const dt = time - this.ht[n - 1];
    this.weights(dt);
    const wy = this.weightsY0!;
    const wh = this.weightsH!;
    const whz = this.weightsHy0!;
    const T = k.delay;
    const d = [this.hv1, this.hv2, this.hi1, this.hi2].map((w) => this.delayedValue(w, time - T));
    const [cy1, cy2, chy1, chy2, ch1, ch2] = this.conv;
    const last = n - 1;
    const [dv1, dv2, di1, di2] = this.lastDelayed;
    // delayed terms are fully known: the newest interval of z(t) = x(t - T) is already history
    const hy0v1 = chy1.known(whz, dv1) + whz.coef * d[0] + k.yinf * k.eaT * d[0];
    const hy0v2 = chy2.known(whz, dv2) + whz.coef * d[1] + k.yinf * k.eaT * d[1];
    const hi1 = ch1.known(wh, di1) + wh.coef * d[2] + k.eaT * d[2];
    const hi2 = ch2.known(wh, di2) + wh.coef * d[3] + k.eaT * d[3];
    this.gy = k.yinf + wy.coef;
    this.coefHy0 = 0;
    this.coefH = 0;
    this.rhs1 = cy1.known(wy, this.hv1[last]) - hy0v2 - hi2;
    this.rhs2 = cy2.known(wy, this.hv2[last]) - hy0v1 - hi1;
  }

  // ------------------------------------------------------------------ RC lines (history convolution)

  private prepareRc(time: number): void {
    const n = this.ht.length;
    if (time === this.cacheTime && n === this.cacheLen) return;
    this.cacheTime = time;
    this.cacheLen = n;
    const k = this.rc!;
    const t = this.ht;
    const last = n - 1;
    const dt = time - t[last];
    const kk = (f: RampResponse) => (dt > 0 ? f.k2(dt) / dt : 0);
    const c11 = kk(k.y11);
    const c12 = kk(k.y12);
    // conv(F, x) = F0 x_0 + sum_{j<last} s_j [K2(t_n - t_j) - K2(t_n - t_j+1)] - x_last K2(dt)/dt + (K2(dt)/dt) x_n
    const deltas = (f: RampResponse): Float64Array => {
      const out = new Float64Array(Math.max(0, last));
      let prev = f.k2(time - t[0]);
      for (let j = 0; j < last; j++) {
        const next = f.k2(time - t[j + 1]);
        out[j] = prev - next;
        prev = next;
      }
      return out;
    };
    const hist = (f: RampResponse, dk: Float64Array, x: number[], kn: number): number => {
      let s = f.f0 * x[0];
      for (let j = 0; j < last; j++) {
        const span = t[j + 1] - t[j];
        if (span > 0) s += ((x[j + 1] - x[j]) / span) * dk[j];
      }
      return s - kn * x[last];
    };
    const d11 = deltas(k.y11);
    const d12 = deltas(k.y12);
    // rows i1 - c11 v1 - c12 v2 = history (the generic stamp adds +coefHy0 on the far port)
    this.gy = c11;
    this.coefHy0 = -c12;
    this.coefH = 0;
    this.rhs1 = hist(k.y11, d11, this.hv1, c11) + hist(k.y12, d12, this.hv2, c12);
    this.rhs2 = hist(k.y11, d11, this.hv2, c11) + hist(k.y12, d12, this.hv1, c12);
  }

  /** Drop knot b when a and c interpolate it within the compaction tolerances in every signal. */
  private compact(a: number, b: number, c: number): void {
    const t = this.ht;
    const f = (t[b] - t[a]) / (t[c] - t[a]);
    for (const w of [this.hv1, this.hv2]) {
      const interp = w[a] + f * (w[c] - w[a]);
      if (Math.abs(interp - w[b]) > this.compactRel * Math.max(Math.abs(w[a]), Math.abs(w[b]), Math.abs(w[c])) + this.compactAbs) return;
    }
    for (const w of [t, this.hv1, this.hv2, this.hi1, this.hi2]) w.splice(b, 1);
  }

  // ------------------------------------------------------------------ AC

  /**
   * AC: the wave form of the exact port relations, I1 = Y0 V1 - H (Y0 V2 + I2) (and the mirror
   * row), which stays finite at the resonances of lossless lines where the Y parameters do not;
   * a line without shunt admittance is a series impedance z*len.
   */
  acLoad(ctx: AcContext): void {
    const w = ctx.omega;
    ctx.addMatrix(this.p1, this.br1, 1, 0);
    ctx.addMatrix(this.n1, this.br1, -1, 0);
    ctx.addMatrix(this.p2, this.br2, 1, 0);
    ctx.addMatrix(this.n2, this.br2, -1, 0);
    const z = cx(this.r, w * this.l);
    const y = cx(this.g, w * this.c);
    if (y.re === 0 && y.im === 0) {
      ctx.addMatrix(this.br1, this.p1, 1, 0);
      ctx.addMatrix(this.br1, this.n1, -1, 0);
      ctx.addMatrix(this.br1, this.p2, -1, 0);
      ctx.addMatrix(this.br1, this.n2, 1, 0);
      ctx.addMatrix(this.br1, this.br1, -z.re * this.len, -z.im * this.len);
      ctx.addMatrix(this.br2, this.br1, 1, 0);
      ctx.addMatrix(this.br2, this.br2, 1, 0);
      return;
    }
    let gl = csqrt(cmul(z, y));
    if (gl.re < 0) gl = cx(-gl.re, -gl.im);
    const h = cexp(cx(-gl.re * this.len, -gl.im * this.len));
    const y0 = csqrt(cdiv(y, z));
    const hy0 = cmul(h, y0);
    const rows: [number, number, number, number, number, number][] = [
      [this.br1, this.p1, this.n1, this.p2, this.n2, this.br2],
      [this.br2, this.p2, this.n2, this.p1, this.n1, this.br1],
    ];
    for (const [br, pa, na, pb, nb, other] of rows) {
      ctx.addMatrix(br, br, 1, 0);
      ctx.addMatrix(br, pa, -y0.re, -y0.im);
      ctx.addMatrix(br, na, y0.re, y0.im);
      ctx.addMatrix(br, pb, hy0.re, hy0.im);
      ctx.addMatrix(br, nb, -hy0.re, -hy0.im);
      ctx.addMatrix(br, other, h.re, h.im);
    }
  }

  // ------------------------------------------------------------------ transient bookkeeping

  beginTransient(setup?: TransientSetup): void {
    this.openEnded = !Number.isFinite(setup?.tstop ?? 0);
    this.ht = [];
    this.hv1 = [];
    this.hv2 = [];
    this.hi1 = [];
    this.hi2 = [];
    this.cacheTime = Number.NaN;
    this.cacheLen = -1;
    this.weightsY0 = null;
  }

  maxTimestep(): number {
    const d = this.delay;
    return d > 0 ? d : Infinity;
  }

  accept(ctx: AcceptContext): void {
    if (this.kind === 'rg') return;
    const x = ctx.x;
    const v1 = x(this.p1) - x(this.n1);
    const v2 = x(this.p2) - x(this.n2);
    const i1 = x(this.br1);
    const i2 = x(this.br2);
    const n = this.ht.length;
    if (n && ctx.time <= this.ht[n - 1]) {
      this.hv1[n - 1] = v1;
      this.hv2[n - 1] = v2;
      this.hi1[n - 1] = i1;
      this.hi2[n - 1] = i2;
      if (n === 1 && this.wave) this.resetWave();
      return;
    }
    if (this.wave && n > 0) this.advanceWave(ctx.time, v1, v2);
    this.ht.push(ctx.time);
    this.hv1.push(v1);
    this.hv2.push(v2);
    this.hi1.push(i1);
    this.hi2.push(i2);
    if (this.wave) {
      if (n === 0) this.resetWave();
      this.pruneWave(ctx.time);
      const m = this.ht.length;
      if (m >= 3 && this.corner(m - 3, m - 2, m - 1)) ctx.addBreakpoint(this.ht[m - 2] + this.wave.delay);
      return;
    }
    const m = this.ht.length;
    if (m >= 3) this.compact(m - 3, m - 2, m - 1);
    if (this.openEnded && this.ht.length > MAX_HISTORY) for (const w of [this.ht, this.hv1, this.hv2, this.hi1, this.hi2]) w.shift();
  }

  /** DC steady state of every recursive state (first accepted point, t = 0). */
  private resetWave(): void {
    const [cy1, cy2, chy1, chy2, ch1, ch2] = this.conv;
    cy1.reset(this.hv1[0]);
    cy2.reset(this.hv2[0]);
    chy1.reset(this.hv1[0]);
    chy2.reset(this.hv2[0]);
    ch1.reset(this.hi1[0]);
    ch2.reset(this.hi2[0]);
    this.lastDelayed = [this.hv1[0], this.hv2[0], this.hi1[0], this.hi2[0]];
  }

  /** Commit the accepted interval to the recursive states (before the new knot is stored). */
  private advanceWave(time: number, v1: number, v2: number): void {
    const n = this.ht.length;
    const dt = time - this.ht[n - 1];
    this.weights(dt);
    const T = this.wave!.delay;
    const d = [this.hv1, this.hv2, this.hi1, this.hi2].map((w) => this.delayedValue(w, time - T));
    const [cy1, cy2, chy1, chy2, ch1, ch2] = this.conv;
    const wy = this.weightsY0!;
    const wh = this.weightsH!;
    const whz = this.weightsHy0!;
    cy1.advance(wy, this.hv1[n - 1], v1);
    cy2.advance(wy, this.hv2[n - 1], v2);
    chy1.advance(whz, this.lastDelayed[0], d[0]);
    chy2.advance(whz, this.lastDelayed[1], d[1]);
    ch1.advance(wh, this.lastDelayed[2], d[2]);
    ch2.advance(wh, this.lastDelayed[3], d[3]);
    this.lastDelayed = d;
  }

  /** Keep only the knots the delayed lookups still need (one before t - T). */
  private pruneWave(time: number): void {
    const keepFrom = time - this.wave!.delay;
    let drop = 0;
    while (drop + 2 < this.ht.length && this.ht[drop + 1] < keepFrom) drop++;
    if (drop > 0) for (const w of [this.ht, this.hv1, this.hv2, this.hi1, this.hi2]) w.splice(0, drop);
  }

  /** Sharp slope change at the middle knot of a, b, c in any port signal (wave model). */
  private corner(a: number, b: number, c: number): boolean {
    const t = this.ht;
    const z = this.wave && this.wave.yinf > 0 ? 1 / this.wave.yinf : 1;
    for (const [w, k] of [
      [this.hv1, 1],
      [this.hv2, 1],
      [this.hi1, z],
      [this.hi2, z],
    ] as [number[], number][]) {
      const d1 = (k * (w[b] - w[a])) / (t[b] - t[a]);
      const d2 = (k * (w[c] - w[b])) / (t[c] - t[b]);
      if (Math.abs(d2 - d1) >= Math.max(Math.abs(d1), Math.abs(d2)) + 1) return true;
    }
    return false;
  }

  /** Number of history knots kept (diagnostics / tests). */
  get historyLength(): number {
    return this.ht.length;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I1: x(this.br1), I2: x(this.br2) };
  }

  setParam(p: string, value: number): void {
    const key = p.trim().toLowerCase();
    if (key === 'len' && value > 0) this.len = value;
    else if (key === 'r' && value >= 0) this.r = value;
    else if (key === 'l' && value >= 0) this.l = value;
    else if (key === 'g' && value >= 0) this.g = value;
    else if (key === 'c' && value >= 0) this.c = value;
    else throw runtimeParamError(this.name, p);
    this.classify();
  }

  getParam(p: string): number | undefined {
    switch (p.trim().toLowerCase()) {
      case 'len':
        return this.len;
      case 'r':
        return this.r;
      case 'l':
        return this.l;
      case 'g':
        return this.g;
      case 'c':
        return this.c;
      default:
        return undefined;
    }
  }
}

export const createLossyLine = (el: ElementIR): Device => new LossyLine(el);
