/**
 * Fourier analysis ('four') of transient outputs.
 *
 * Procedure:
 * 1. A transient analysis runs from the operating point over settleCycles + 1 periods of the
 *    fundamental f0 (settleCycles default 2), with the internal step limited to T/N
 *    (T = 1/f0, N = samples per period, default 256; tstep defaults to T/N).
 * 2. The last period [tstop − T, tstop) of every requested output is resampled at N uniform
 *    points by piecewise-cubic Hermite interpolation of the accepted timepoints. Node slopes are
 *    the three-point (parabolic) estimates, limited to 3·min(|left|, |right|) secant slope and set
 *    to zero next to flat segments: third-order accurate on smooth waveforms, no overshoot at
 *    the sharp edges of pulse waveforms. With settleCycles > 0 the previous period is resampled
 *    too; if the two differ by more than 0.1 % of the peak-to-peak value a warning reports that
 *    the circuit has not reached a periodic steady state (start-up transients leak into every
 *    harmonic).
 * 3. A direct DFT gives, for harmonics k = 1..H, the amplitude M_k and phase φ_k of
 *        x(t) = DC + Σ M_k · sin(2π k f0 (t − t_w) + φ_k),   t_w = tstop − T,
 *    i.e. phases use a sine reference (a SIN source with zero phase reads 0°). Because t_w is an
 *    integer number of periods, the phases are also relative to t = 0.
 *    Normalised magnitude M_k/M_1 and normalised phase φ_k − φ_1 (SPICE convention).
 *    THD = √(Σ_{k≥2} M_k²) / M_1 · 100 %.
 *
 * Result: scale "frequency" = k·f0 for k = 0..H (k = 0 is the DC term, magnitude |DC|), and per
 * output o: vector "o" (magnitudes, unit of o), "phase(o)" (deg), "norm(o)" (M_k/M_1),
 * "normphase(o)" (deg). Scalars "THD(o)" (%) and "DC(o)"; "thd" and "dc" repeat them for the first
 * output. Table: one row per output and harmonic. runs[0] holds the resampled analysed period
 * (scale "time").
 */
import type { FourierAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type Vector } from '../results';
import type { AnalysisContext } from '../engine/analysis-registry';
import { ProbeEvaluator, selectProbes } from '../engine/outputs';
import { analysisTitle } from '../engine/titles';
import { TransientEngine } from '../engine/transient';

/** Harmonic content of one period of uniformly sampled data. */
export interface HarmonicSpectrum {
  /** Mean value. */
  dc: number;
  /** M_k for k = 0..H (index 0: |dc|). */
  magnitude: Float64Array;
  /** φ_k in degrees, sine reference (index 0: 0). */
  phase: Float64Array;
  /** M_k / M_1. */
  normalized: Float64Array;
  /** φ_k − φ_1 in degrees, wrapped to (−180, 180]. */
  normalizedPhase: Float64Array;
  /** Total harmonic distortion of harmonics 2..H, percent of M_1. */
  thd: number;
}

function wrapDeg(d: number): number {
  let x = d % 360;
  if (x <= -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

/**
 * DFT of one period sampled at N uniform points (x[0] at the period start) for harmonics 0..H.
 * Requires H < N/2.
 */
export function harmonicSpectrum(x: ArrayLike<number>, harmonics: number): HarmonicSpectrum {
  const N = x.length;
  const H = Math.floor(harmonics);
  if (N < 2 || H < 1 || 2 * H >= N) throw new SimulationError(`Fourier: ${N} samples cannot resolve ${H} harmonics`, 'netlist');
  const cosT = new Float64Array(N);
  const sinT = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    cosT[n] = Math.cos((2 * Math.PI * n) / N);
    sinT[n] = Math.sin((2 * Math.PI * n) / N);
  }
  let dc = 0;
  for (let n = 0; n < N; n++) dc += x[n];
  dc /= N;
  const magnitude = new Float64Array(H + 1);
  const phase = new Float64Array(H + 1);
  magnitude[0] = Math.abs(dc);
  for (let k = 1; k <= H; k++) {
    let c = 0;
    let s = 0;
    for (let n = 0; n < N; n++) {
      const idx = (k * n) % N;
      c += x[n] * cosT[idx];
      s += x[n] * sinT[idx];
    }
    magnitude[k] = (2 / N) * Math.hypot(c, s);
    phase[k] = wrapDeg((Math.atan2(-s, c) * 180) / Math.PI + 90);
  }
  const m1 = magnitude[1];
  const normalized = new Float64Array(H + 1);
  const normalizedPhase = new Float64Array(H + 1);
  let h2 = 0;
  for (let k = 0; k <= H; k++) {
    normalized[k] = m1 > 0 ? magnitude[k] / m1 : Number.NaN;
    normalizedPhase[k] = k === 0 ? 0 : wrapDeg(phase[k] - phase[1]);
    if (k >= 2) h2 += magnitude[k] * magnitude[k];
  }
  return { dc, magnitude, phase, normalized, normalizedPhase, thd: m1 > 0 ? (100 * Math.sqrt(h2)) / m1 : Number.NaN };
}

/**
 * Resample (t, v) at `count` uniform points start + k·step (shape-preserving cubic Hermite
 * interpolation, see the module doc; t ascending). Points outside the data range take the
 * nearest end value.
 */
export function resampleUniform(t: ArrayLike<number>, v: ArrayLike<number>, start: number, step: number, count: number): Float64Array {
  // drop repeated time points
  const ts: number[] = [];
  const vs: number[] = [];
  for (let k = 0; k < t.length; k++) {
    if (ts.length > 0 && !(t[k] > ts[ts.length - 1])) {
      vs[vs.length - 1] = v[k];
      continue;
    }
    ts.push(t[k]);
    vs.push(v[k]);
  }
  const n = ts.length;
  const out = new Float64Array(count);
  if (n === 0) return out.fill(Number.NaN);
  if (n === 1) return out.fill(vs[0]);
  const d = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) d[k] = (vs[k + 1] - vs[k]) / (ts[k + 1] - ts[k]);
  const m = new Float64Array(n);
  const limit = (mk: number, a: number, b: number): number => {
    const lim = 3 * Math.min(Math.abs(a), Math.abs(b));
    return Math.abs(mk) > lim ? Math.sign(mk) * lim : mk;
  };
  /** One-sided three-point end slope, kept within the shape of the end interval. */
  const endSlope = (h0: number, h1: number, d0: number, d1: number): number => {
    const e = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(e) !== Math.sign(d0)) return 0;
    return Math.abs(e) > 3 * Math.abs(d0) ? 3 * d0 : e;
  };
  if (n === 2) {
    m[0] = d[0];
    m[1] = d[0];
  } else {
    m[0] = endSlope(ts[1] - ts[0], ts[2] - ts[1], d[0], d[1]);
    m[n - 1] = endSlope(ts[n - 1] - ts[n - 2], ts[n - 2] - ts[n - 3], d[n - 2], d[n - 3]);
  }
  for (let k = 1; k < n - 1; k++) {
    const a = d[k - 1];
    const b = d[k];
    if (a === 0 || b === 0) {
      // next to a flat segment (pulse plateaus): keep it flat
      m[k] = 0;
      continue;
    }
    const h0 = ts[k] - ts[k - 1];
    const h1 = ts[k + 1] - ts[k];
    // second-order (parabolic) slope, limited to 3·min(|a|, |b|) to avoid overshoot at sharp
    // corners while keeping smooth extrema accurate
    m[k] = limit((h1 * a + h0 * b) / (h0 + h1), a, b);
  }
  let i = 0;
  for (let q = 0; q < count; q++) {
    const x = start + q * step;
    if (x <= ts[0]) {
      out[q] = vs[0];
      continue;
    }
    if (x >= ts[n - 1]) {
      out[q] = vs[n - 1];
      continue;
    }
    while (i < n - 2 && ts[i + 1] < x) i++;
    const h = ts[i + 1] - ts[i];
    const s = (x - ts[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    out[q] = (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * vs[i + 1] + (s3 - s2) * h * m[i + 1];
  }
  return out;
}

export function runFourier(spec: FourierAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('four');
  const f0 = spec.fundamental;
  if (!(f0 > 0) || !Number.isFinite(f0)) throw new SimulationError(`${what}: invalid fundamental frequency ${f0}`, 'netlist');
  const H = Math.floor(spec.harmonics);
  if (!(H >= 1)) throw new SimulationError(`${what}: number of harmonics must be at least 1`, 'netlist');
  const settle = Math.max(0, Math.floor(spec.settleCycles ?? 2));
  const N = Math.max(Math.floor(spec.samples ?? 256), 2 * H + 2);
  if (!spec.outputs || spec.outputs.length === 0) throw new SimulationError(`${what}: no output selected`, 'netlist');
  const T = 1 / f0;
  const dtSample = T / N;
  const tstep = spec.tstep !== undefined && spec.tstep > 0 ? spec.tstep : dtSample;
  const tstop = (settle + 1) * T;

  const circuit = ctx.buildCircuit();
  const sel = selectProbes(circuit, spec.outputs, { deviceOutputs: false });
  if (sel.probes.length === 0) throw new SimulationError(`${what}: none of the outputs ${spec.outputs.join(', ')} exists`, 'netlist');
  const engine = new TransientEngine(circuit, { tstep, tstop, tmax: Math.min(tstep, dtSample), signal: ctx.signal });
  const ev = new ProbeEvaluator(sel.probes);
  const np = sel.probes.length;
  const vals = new Float64Array(np);
  const tWin = tstop - T;
  // with settling cycles the previous period is kept too, for the periodicity check
  const tKeep = (settle > 0 ? tWin - T : tWin) - 4 * engine.maxStep;
  const times: number[] = [];
  const cols: number[][] = sel.probes.map(() => []);
  let prevT = Number.NaN;
  let prevVals: Float64Array | undefined;
  const record = () => {
    ev.evaluate(engine.solution, vals);
    if (engine.time >= tKeep) {
      if (times.length === 0 && prevVals) {
        times.push(prevT);
        for (let j = 0; j < np; j++) cols[j].push(prevVals[j]);
      }
      times.push(engine.time);
      for (let j = 0; j < np; j++) cols[j].push(vals[j]);
    } else {
      prevT = engine.time;
      prevVals = vals.slice();
    }
  };
  engine.initialize();
  record();
  let steps = 0;
  while (engine.step()) {
    record();
    if ((++steps & 63) === 0) ctx.progress(engine.time / tstop);
  }

  const freqs = new Float64Array(H + 1);
  for (let k = 0; k <= H; k++) freqs[k] = k * f0;
  const vectors: Vector[] = [];
  const scalars: Record<string, number> = {};
  const rows: (string | number)[][] = [];
  const periodTime = new Float64Array(N);
  for (let q = 0; q < N; q++) periodTime[q] = tWin + q * dtSample;
  const periodVectors: Vector[] = [];
  const warnings = [...circuit.warnings, ...sel.warnings];
  const unsettled: string[] = [];
  sel.probes.forEach((p, j) => {
    const samples = resampleUniform(times, cols[j], tWin, dtSample, N);
    const sp = harmonicSpectrum(samples, H);
    if (settle > 0) {
      const prev = resampleUniform(times, cols[j], tWin - T, dtSample, N);
      const mismatch = periodMismatch(samples, prev);
      if (mismatch > 1e-3) unsettled.push(`${p.name} (${(100 * mismatch).toPrecision(2)} %)`);
    }
    vectors.push({ name: p.name, unit: p.unit, re: sp.magnitude });
    vectors.push({ name: `phase(${p.name})`, unit: 'deg', re: sp.phase });
    vectors.push({ name: `norm(${p.name})`, unit: '', re: sp.normalized });
    vectors.push({ name: `normphase(${p.name})`, unit: 'deg', re: sp.normalizedPhase });
    scalars[`THD(${p.name})`] = sp.thd;
    scalars[`DC(${p.name})`] = sp.dc;
    if (j === 0) {
      scalars.thd = sp.thd;
      scalars.dc = sp.dc;
    }
    for (let k = 0; k <= H; k++) rows.push([p.name, k, freqs[k], k === 0 ? sp.dc : sp.magnitude[k], sp.phase[k], sp.normalized[k], sp.normalizedPhase[k]]);
    periodVectors.push({ name: p.name, unit: p.unit, re: samples });
  });

  return {
    type: 'four',
    title: what,
    spec,
    scale: { name: 'frequency', unit: 'Hz', re: freqs },
    vectors,
    scalars,
    table: { columns: ['Output', 'Harmonic', 'Frequency (Hz)', 'Magnitude', 'Phase (deg)', 'Normalized magnitude', 'Normalized phase (deg)'], rows },
    runs: [
      {
        label: 'analysed period',
        result: {
          type: 'tran',
          title: `${what}: analysed period`,
          scale: { name: 'time', unit: 's', re: periodTime },
          vectors: periodVectors,
          warnings: [],
        },
      },
    ],
    warnings: unsettled.length > 0
      ? [
          ...warnings,
          `${what}: the waveform has not reached a periodic steady state (last two periods differ by ${unsettled.join(', ')} of their peak-to-peak value); increase settleCycles`,
        ]
      : warnings,
  };
}

/** Largest difference between two sampled periods relative to the peak-to-peak value of the last. */
function periodMismatch(last: Float64Array, prev: Float64Array): number {
  let max = -Infinity;
  let min = Infinity;
  let diff = 0;
  for (let q = 0; q < last.length; q++) {
    max = Math.max(max, last[q]);
    min = Math.min(min, last[q]);
    diff = Math.max(diff, Math.abs(last[q] - prev[q]));
  }
  const pp = max - min;
  if (!(pp > 0)) return diff > 0 ? Infinity : 0;
  return diff / pp;
}
