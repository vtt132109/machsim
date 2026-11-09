/**
 * FREQ-table controlled sources (PSpice-style E / G cards):
 *
 *   E<name> n+ n- FREQ {V(a,b)} = (f1, mag1, ph1) (f2, mag2, ph2) ... [DELAY=d]
 *
 * ElementIR.freqTable = { f, mag, phase, delay? }: the frequency response from u = V(nc+, nc-) to
 * the output (E: voltage V(n+, n-); G: current from n+ through the source to n-), magnitude
 * linear, phase in degrees (unwrapped by the parser), frequencies ascending. `value` (default 1)
 * multiplies it.
 *
 * Interpolation (AC, exact on the table): magnitude in dB and phase linearly versus log10(f)
 * between table points (linearly versus f when a point is at 0 Hz); below the first point the
 * first value is held, above the last point the last value. The DC gain H(0) is the real part of
 * the response at 0 Hz (the first point when the table starts above 0 Hz), so DC, the operating
 * point and the steady state of the transient agree. DELAY multiplies by e^{-j2πf·delay}.
 *
 * Transient method: convolution with the impulse response. H is sampled on the grid
 * f_k = k·Δf, k = 0..N/2 (N a power of two, 256 ≤ N ≤ 16384, Δf ≤ f_min/4 when possible, and
 * f_max of the grid = the last table frequency), the real inverse DFT gives h at the sample
 * interval Δt = 1/(2·f_max); only the causal half (t ≥ 0) is kept — a table without enough
 * delay for its phase loses its non-causal part, as in other simulators — and its last 10 % are
 * tapered (raised cosine) against truncation ripple. Then
 *     y(t) = Δt · Σ_m h_m · u(t − delay − m·Δt),
 * with u(τ) interpolated linearly between accepted timepoints (inside the current step between
 * the last accepted point and the present iterate, which makes y linear in the present input),
 * and u(τ) = u(0) for τ < 0 (the circuit rests at its operating point before t = 0). The time
 * step is limited to Δt. The kernel's DC sum equals H(0), so the transient settles to the
 * operating point.
 */
import type { AcContext, Device, LoadContext, SetupContext } from '../../device';
import type { EngineDeviceExtensions, AcceptContext } from '../../engine/hooks';
import type { ElementIR, ElementType } from '../../netlist';
import { SimulationError } from '../../results';
import { requireNodes } from './common';

export interface FreqTable {
  f: number[];
  mag: number[];
  phase: number[];
  delay?: number;
}

/** Complex response of a table at frequency f (Hz), without the delay term. */
export function freqTableResponse(t: FreqTable, f: number): { re: number; im: number } {
  const n = t.f.length;
  let db: number;
  let ph: number;
  const dbOf = (m: number) => 20 * Math.log10(Math.max(m, 1e-300));
  if (f <= t.f[0]) {
    db = dbOf(t.mag[0]);
    ph = t.phase[0];
  } else if (f >= t.f[n - 1]) {
    db = dbOf(t.mag[n - 1]);
    ph = t.phase[n - 1];
  } else {
    let i = 0;
    while (i < n - 2 && t.f[i + 1] < f) i++;
    const f0 = t.f[i];
    const f1 = t.f[i + 1];
    const w = f0 > 0 ? Math.log10(f / f0) / Math.log10(f1 / f0) : (f - f0) / (f1 - f0);
    db = dbOf(t.mag[i]) + w * (dbOf(t.mag[i + 1]) - dbOf(t.mag[i]));
    ph = t.phase[i] + w * (t.phase[i + 1] - t.phase[i]);
  }
  const m = Math.pow(10, db / 20);
  const r = (ph * Math.PI) / 180;
  return { re: m * Math.cos(r), im: m * Math.sin(r) };
}

/** DC gain of a table: real part of the response at 0 Hz. */
export function freqTableDc(t: FreqTable): number {
  return freqTableResponse(t, 0).re;
}

/** In-place iterative radix-2 FFT (length a power of two); `inverse` uses e^{+j…} (no 1/N). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Causal impulse-response kernel (samples h_m·Δt) and its sample interval. */
export function freqTableKernel(t: FreqTable): { dt: number; taps: Float64Array } {
  const fmax = t.f[t.f.length - 1];
  if (!(fmax > 0)) throw new Error('FREQ table needs a frequency above 0 Hz');
  const fmin = t.f.find((f) => f > 0) ?? fmax;
  let n = 256;
  while (n < 16384 && (2 * fmax) / n > fmin / 4) n *= 2;
  const df = (2 * fmax) / n;
  const half = n / 2;
  const re = new Float64Array(half + 1);
  const im = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const h = k === 0 ? { re: freqTableDc(t), im: 0 } : freqTableResponse(t, k * df);
    re[k] = h.re;
    im[k] = k === half ? 0 : h.im;
  }
  // inverse DFT x[m] = (1/N) Σ_k H_k e^{j2πkm/N} of the Hermitian extension (radix-2 FFT)
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  for (let k = 0; k <= half; k++) {
    xr[k] = re[k];
    xi[k] = im[k];
    if (k > 0 && k < half) {
      xr[n - k] = re[k];
      xi[n - k] = -im[k];
    }
  }
  fft(xr, xi, true);
  const taps = new Float64Array(half);
  for (let m = 0; m < half; m++) taps[m] = xr[m] / n;
  // taper the last 10 % (raised cosine) and restore the DC sum
  const tail = Math.max(1, Math.floor(half / 10));
  for (let m = half - tail; m < half; m++) taps[m] *= 0.5 * (1 + Math.cos((Math.PI * (m - (half - tail) + 1)) / tail));
  const dc = freqTableDc(t);
  const sum = taps.reduce((a, b) => a + b, 0);
  if (Math.abs(sum) > 1e-12 && Math.abs(dc) > 1e-12) for (let m = 0; m < half; m++) taps[m] *= dc / sum;
  return { dt: 1 / (2 * fmax), taps };
}

export class FreqTableSource implements Device, EngineDeviceExtensions {
  readonly type: ElementType;
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;
  private readonly table: FreqTable;
  private readonly gain: number;
  private readonly delay: number;
  private readonly h0: number;
  private kernel: { dt: number; taps: Float64Array } | null = null;
  private pOut = -1;
  private nOut = -1;
  private pIn = -1;
  private nIn = -1;
  private br = -1;
  // accepted input history (ascending times)
  private ht: number[] = [];
  private hu: number[] = [];
  // per-timepoint linearisation y = cA + cB·u_now
  private cTime = NaN;
  private cDt = NaN;
  private cA = 0;
  private cB = 0;

  constructor(el: ElementIR) {
    requireNodes(el, 4);
    const t = el.freqTable;
    if (!t || t.f.length === 0 || t.f.length !== t.mag.length || t.f.length !== t.phase.length) {
      throw new SimulationError(`${el.name}: invalid FREQ table`, 'netlist');
    }
    for (let i = 1; i < t.f.length; i++) if (!(t.f[i] > t.f[i - 1])) throw new SimulationError(`${el.name}: FREQ table frequencies must increase`, 'netlist');
    this.type = el.type;
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
    this.table = t;
    this.gain = el.value ?? 1;
    this.delay = Math.max(0, t.delay ?? 0);
    this.h0 = freqTableDc(t);
  }

  setup(ctx: SetupContext): void {
    this.pOut = ctx.node(this.nodeNames[0]);
    this.nOut = ctx.node(this.nodeNames[1]);
    this.pIn = ctx.node(this.nodeNames[2]);
    this.nIn = ctx.node(this.nodeNames[3]);
    if (this.type === 'E') this.br = ctx.branch(`${this.name}#i`);
  }

  private getKernel(): { dt: number; taps: Float64Array } {
    if (!this.kernel) {
      try {
        this.kernel = freqTableKernel(this.table);
      } catch (e) {
        throw new SimulationError(`${this.name}: ${(e as Error).message}`, 'netlist');
      }
    }
    return this.kernel;
  }

  /** y = cA + cB·u(time) at the timepoint `time` (step from the last accepted point). */
  private linearise(time: number): void {
    const { dt, taps } = this.getKernel();
    const tLast = this.ht.length ? this.ht[this.ht.length - 1] : 0;
    const uLast = this.hu.length ? this.hu[this.hu.length - 1] : 0;
    const span = time - tLast;
    const ht = this.ht;
    const hu = this.hu;
    let a = 0;
    let b = 0;
    // τ decreases with m: walk the history backwards once (O(taps + history))
    let j = ht.length - 1;
    for (let m = 0; m < taps.length; m++) {
      const tau = time - this.delay - m * dt;
      if (tau > tLast && span > 0) {
        const w = (tau - tLast) / span;
        b += taps[m] * w;
        a += taps[m] * (1 - w) * uLast;
        continue;
      }
      while (j > 0 && ht[j - 1] > tau) j--;
      let u: number;
      if (j <= 0 || tau <= ht[0]) u = hu.length ? hu[0] : 0;
      else {
        const d = ht[j] - ht[j - 1];
        u = d > 0 ? hu[j - 1] + ((hu[j] - hu[j - 1]) * (tau - ht[j - 1])) / d : hu[j];
      }
      a += taps[m] * u;
    }
    this.cA = a * this.gain;
    this.cB = b * this.gain;
    this.cTime = time;
  }

  /** Stamp y = k·u + c (u = V(nc+, nc-)). */
  private stamp(ctx: Pick<LoadContext, 'addMatrix' | 'addRhs'>, k: number, c: number): void {
    const { pOut, nOut, pIn, nIn } = this;
    if (this.type === 'E') {
      const br = this.br;
      ctx.addMatrix(pOut, br, 1);
      ctx.addMatrix(nOut, br, -1);
      ctx.addMatrix(br, pOut, 1);
      ctx.addMatrix(br, nOut, -1);
      ctx.addMatrix(br, pIn, -k);
      ctx.addMatrix(br, nIn, k);
      ctx.addRhs(br, c);
    } else {
      ctx.addMatrix(pOut, pIn, k);
      ctx.addMatrix(pOut, nIn, -k);
      ctx.addMatrix(nOut, pIn, -k);
      ctx.addMatrix(nOut, nIn, k);
      ctx.addRhs(pOut, -c);
      ctx.addRhs(nOut, c);
    }
  }

  load(ctx: LoadContext): void {
    if (ctx.mode !== 'tran' || ctx.tranOp) {
      this.stamp(ctx, this.h0 * this.gain, 0);
      return;
    }
    if (ctx.time !== this.cTime || ctx.dt !== this.cDt) {
      this.linearise(ctx.time);
      this.cDt = ctx.dt;
    }
    this.stamp(ctx, this.cB, this.cA);
  }

  acLoad(ctx: AcContext): void {
    const f = ctx.omega / (2 * Math.PI);
    const h = freqTableResponse(this.table, f);
    const ph = -ctx.omega * this.delay;
    const re = this.gain * (h.re * Math.cos(ph) - h.im * Math.sin(ph));
    const im = this.gain * (h.re * Math.sin(ph) + h.im * Math.cos(ph));
    const { pOut, nOut, pIn, nIn } = this;
    if (this.type === 'E') {
      const br = this.br;
      ctx.addMatrix(pOut, br, 1, 0);
      ctx.addMatrix(nOut, br, -1, 0);
      ctx.addMatrix(br, pOut, 1, 0);
      ctx.addMatrix(br, nOut, -1, 0);
      ctx.addMatrix(br, pIn, -re, -im);
      ctx.addMatrix(br, nIn, re, im);
    } else {
      ctx.addMatrix(pOut, pIn, re, im);
      ctx.addMatrix(pOut, nIn, -re, -im);
      ctx.addMatrix(nOut, pIn, -re, -im);
      ctx.addMatrix(nOut, nIn, re, im);
    }
  }

  beginTransient(): void {
    this.ht = [];
    this.hu = [];
    this.cTime = NaN;
    this.cDt = NaN;
  }

  accept(ctx: AcceptContext): void {
    const u = ctx.x(this.pIn) - ctx.x(this.nIn);
    this.ht.push(ctx.time);
    this.hu.push(u);
    this.cTime = NaN;
    // keep what the kernel can still reach (plus one older point for interpolation)
    const { dt, taps } = this.getKernel();
    const oldest = ctx.time - this.delay - taps.length * dt;
    let drop = 0;
    while (drop + 1 < this.ht.length && this.ht[drop + 1] <= oldest) drop++;
    if (drop > 64) {
      this.ht.splice(0, drop);
      this.hu.splice(0, drop);
    }
  }

  maxTimestep(): number {
    return this.getKernel().dt;
  }

  branchIndex(): number {
    return this.br;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    if (this.type === 'E') return { I: x(this.br) };
    return { I: this.h0 * this.gain * (x(this.pIn) - x(this.nIn)) };
  }
}

export const createFreqTableSource = (el: ElementIR): Device => new FreqTableSource(el);
