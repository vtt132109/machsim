/**
 * Digital signal processing for the grapher and virtual instruments.
 *
 * - FFT: iterative radix-2 Cooley-Tukey for power-of-two lengths, Bluestein (chirp-z) for
 *   any other length, plus optional zero padding.
 * - Windows: rectangular, Hann, Hamming, 4-term Blackman-Harris, 5-term flat-top (periodic /
 *   DFT-even form), with coherent gain and equivalent noise bandwidth.
 * - Single-sided amplitude spectrum corrected for window coherent gain.
 * - Resampling of non-uniform (simulator) time series to a uniform grid.
 * - Time-weighted mean / RMS (trapezoidal), plain sample RMS.
 * - Frequency estimation (interpolated zero crossings with hysteresis; FFT peak with
 *   parabolic interpolation).
 * - Harmonic analysis over an integer number of periods: harmonic amplitudes, THD, SINAD.
 *
 * Simulator output is non-uniformly sampled; every routine that takes `time` handles that.
 * All functions are pure.
 */

export type WindowKind = 'rect' | 'hann' | 'hamming' | 'blackman-harris' | 'flattop';

export const WINDOW_LABELS: Record<WindowKind, string> = {
  rect: 'Rectangular',
  hann: 'Hann',
  hamming: 'Hamming',
  'blackman-harris': 'Blackman-Harris',
  flattop: 'Flat-top',
};

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place radix-2 FFT. `re.length` must be a power of two. Forward transform uses e^{-j...};
 * `inverse` uses e^{+j...} and scales by 1/N.
 */
export function fftRadix2(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error('fftRadix2: length must be a power of two');
  // Bit reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = re[b] * cRe - im[b] * cIm;
        const tIm = re[b] * cIm + im[b] * cRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Bluestein chirp-z DFT of arbitrary length (returns new arrays). */
function bluestein(xRe: ArrayLike<number>, xIm: ArrayLike<number>, inverse: boolean): { re: Float64Array; im: Float64Array } {
  const n = xRe.length;
  const m = nextPow2(2 * n - 1);
  const sign = inverse ? 1 : -1;
  // chirp w_k = exp(sign * j*pi*k^2/n); k^2 taken mod 2n to keep the angle small.
  const cRe = new Float64Array(n);
  const cIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const k2 = (k * k) % (2 * n);
    const ang = (sign * Math.PI * k2) / n;
    cRe[k] = Math.cos(ang);
    cIm[k] = Math.sin(ang);
  }
  const aRe = new Float64Array(m);
  const aIm = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    aRe[k] = xRe[k] * cRe[k] - xIm[k] * cIm[k];
    aIm[k] = xRe[k] * cIm[k] + xIm[k] * cRe[k];
  }
  const bRe = new Float64Array(m);
  const bIm = new Float64Array(m);
  bRe[0] = cRe[0];
  bIm[0] = -cIm[0];
  for (let k = 1; k < n; k++) {
    bRe[k] = bRe[m - k] = cRe[k];
    bIm[k] = bIm[m - k] = -cIm[k];
  }
  fftRadix2(aRe, aIm);
  fftRadix2(bRe, bIm);
  for (let i = 0; i < m; i++) {
    const r = aRe[i] * bRe[i] - aIm[i] * bIm[i];
    aIm[i] = aRe[i] * bIm[i] + aIm[i] * bRe[i];
    aRe[i] = r;
  }
  fftRadix2(aRe, aIm, true);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    re[k] = aRe[k] * cRe[k] - aIm[k] * cIm[k];
    im[k] = aRe[k] * cIm[k] + aIm[k] * cRe[k];
    if (inverse) {
      re[k] /= n;
      im[k] /= n;
    }
  }
  return { re, im };
}

/**
 * DFT of any length. Power-of-two lengths use radix-2, others Bluestein. Input arrays are not
 * modified. `im` may be omitted for real input.
 */
export function fft(re: ArrayLike<number>, im?: ArrayLike<number>, inverse = false): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  if (n === 0) return { re: new Float64Array(0), im: new Float64Array(0) };
  const imIn = im ?? new Float64Array(n);
  if (isPowerOfTwo(n)) {
    const r = Float64Array.from(re);
    const i = Float64Array.from(imIn);
    fftRadix2(r, i, inverse);
    return { re: r, im: i };
  }
  return bluestein(re, imIn, inverse);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const COSINE_SUMS: Record<Exclude<WindowKind, 'rect'>, number[]> = {
  hann: [0.5, 0.5],
  hamming: [0.54, 0.46],
  'blackman-harris': [0.35875, 0.48829, 0.14128, 0.01168],
  flattop: [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
};

/** Periodic (DFT-even) window of length n: w[k] = sum_i (-1)^i a_i cos(2*pi*i*k/n). */
export function makeWindow(kind: WindowKind, n: number): Float64Array {
  const w = new Float64Array(n);
  if (kind === 'rect') {
    w.fill(1);
    return w;
  }
  const a = COSINE_SUMS[kind];
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (i % 2 === 0 ? 1 : -1) * a[i] * Math.cos((2 * Math.PI * i * k) / n);
    w[k] = s;
  }
  return w;
}

/** Coherent gain (mean of the window). */
export function coherentGain(w: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return w.length ? s / w.length : 1;
}

/** Equivalent noise bandwidth in bins: N * sum(w^2) / (sum w)^2. */
export function enbwBins(w: ArrayLike<number>): number {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i];
    s2 += w[i] * w[i];
  }
  return s ? (w.length * s2) / (s * s) : 1;
}

// ---------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------

export interface SpectrumOptions {
  window?: WindowKind;
  /** minimum FFT length; the transform length is max(n, fftLength) rounded up to a power of two */
  fftLength?: number;
  /** remove the mean before transforming (keeps DC leakage out of low bins) */
  removeDc?: boolean;
}

export interface Spectrum {
  /** bin frequencies 0..fs/2 (Hz) */
  freq: Float64Array;
  /** single-sided PEAK amplitude per bin, corrected for window coherent gain */
  amplitude: Float64Array;
  /** phase in degrees */
  phase: Float64Array;
  /** bin spacing (Hz) */
  df: number;
  fs: number;
  /** equivalent noise bandwidth (Hz) */
  enbw: number;
  /** number of signal samples used (before zero padding) */
  samples: number;
}

/**
 * Single-sided amplitude spectrum of uniformly sampled data. A sine of peak amplitude A that
 * falls exactly on a bin reads A (for any window); off-bin readings are exact with 'flattop'.
 */
export function amplitudeSpectrum(samples: ArrayLike<number>, fs: number, opts: SpectrumOptions = {}): Spectrum {
  const n = samples.length;
  const kind = opts.window ?? 'hann';
  const w = makeWindow(kind, n);
  const cg = coherentGain(w);
  const m = nextPow2(Math.max(n, opts.fftLength ?? 0, 1));
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  let mean = 0;
  if (opts.removeDc) {
    for (let i = 0; i < n; i++) mean += samples[i];
    mean = n ? mean / n : 0;
  }
  for (let i = 0; i < n; i++) re[i] = (samples[i] - mean) * w[i];
  fftRadix2(re, im);
  const bins = Math.floor(m / 2) + 1;
  const freq = new Float64Array(bins);
  const amplitude = new Float64Array(bins);
  const phase = new Float64Array(bins);
  const scale = n > 0 ? 1 / (n * cg) : 0;
  for (let k = 0; k < bins; k++) {
    freq[k] = (k * fs) / m;
    const mag = Math.hypot(re[k], im[k]) * scale;
    amplitude[k] = k === 0 || (k === m / 2 && m > 1) ? mag : 2 * mag;
    phase[k] = (Math.atan2(im[k], re[k]) * 180) / Math.PI;
  }
  if (opts.removeDc) amplitude[0] = Math.abs(mean);
  return { freq, amplitude, phase, df: fs / m, fs, enbw: (enbwBins(w) * fs) / n, samples: n };
}

/**
 * Peak of a spectrum (ignoring DC and bins below `minFreq`) refined by parabolic interpolation
 * of the log magnitude. Returns NaN frequency for an empty or flat spectrum.
 */
export function spectrumPeak(spec: Spectrum, minFreq = 0): { freq: number; amplitude: number; bin: number } {
  let best = -1;
  let bestA = 0;
  for (let k = 1; k < spec.amplitude.length; k++) {
    if (spec.freq[k] < minFreq) continue;
    if (spec.amplitude[k] > bestA) {
      bestA = spec.amplitude[k];
      best = k;
    }
  }
  if (best < 0) return { freq: Number.NaN, amplitude: 0, bin: -1 };
  let delta = 0;
  if (best > 0 && best < spec.amplitude.length - 1) {
    const a = Math.log(spec.amplitude[best - 1] || 1e-300);
    const b = Math.log(spec.amplitude[best] || 1e-300);
    const c = Math.log(spec.amplitude[best + 1] || 1e-300);
    const den = a - 2 * b + c;
    if (den < 0) delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  }
  return { freq: (best + delta) * spec.df, amplitude: bestA, bin: best };
}

// ---------------------------------------------------------------------------
// Resampling and basic statistics
// ---------------------------------------------------------------------------

/** Index of the last sample with time[i] <= t (binary search, -1 if t precedes the data). */
export function lowerIndex(time: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = time.length - 1;
  if (hi < 0 || t < time[0]) return -1;
  if (t >= time[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of (time, values) at t, clamped to the end values. */
export function interpolate(time: ArrayLike<number>, values: ArrayLike<number>, t: number): number {
  const n = time.length;
  if (n === 0) return Number.NaN;
  const i = lowerIndex(time, t);
  if (i < 0) return values[0];
  if (i >= n - 1) return values[n - 1];
  const t0 = time[i];
  const t1 = time[i + 1];
  if (t1 === t0) return values[i + 1];
  const f = (t - t0) / (t1 - t0);
  return values[i] + f * (values[i + 1] - values[i]);
}

export interface UniformSignal {
  t0: number;
  dt: number;
  values: Float64Array;
}

/**
 * Resample (time, values) onto n uniform points t0 + k*dt, k = 0..n-1, dt = (t1 - t0)/n
 * (the end point t1 is excluded, so a window of whole periods stays coherent).
 * Defaults: t0 = first time, t1 = last time.
 */
export function resampleUniform(
  time: ArrayLike<number>,
  values: ArrayLike<number>,
  n: number,
  t0 = time[0],
  t1 = time[time.length - 1],
): UniformSignal {
  const out = new Float64Array(Math.max(0, n));
  const dt = n > 0 ? (t1 - t0) / n : 0;
  if (time.length === 0 || n <= 0) return { t0, dt, values: out };
  let i = Math.max(0, lowerIndex(time, t0));
  const last = time.length - 1;
  for (let k = 0; k < n; k++) {
    const t = t0 + k * dt;
    while (i < last && time[i + 1] <= t) i++;
    if (t <= time[0]) out[k] = values[0];
    else if (i >= last) out[k] = values[last];
    else {
      const ta = time[i];
      const tb = time[i + 1];
      out[k] = tb === ta ? values[i + 1] : values[i] + ((t - ta) / (tb - ta)) * (values[i + 1] - values[i]);
    }
  }
  return { t0, dt, values: out };
}

/** Arithmetic mean of samples. */
export function mean(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return values.length ? s / values.length : Number.NaN;
}

/** Sample RMS sqrt(mean(x^2)). */
export function rms(values: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i] * values[i];
  return values.length ? Math.sqrt(s / values.length) : Number.NaN;
}

/** Time-weighted mean (trapezoidal) of a non-uniformly sampled signal. */
export function timeMean(time: ArrayLike<number>, values: ArrayLike<number>, from = 0, to = time.length - 1): number {
  if (to <= from) return to === from ? values[from] : Number.NaN;
  let s = 0;
  for (let i = from; i < to; i++) s += 0.5 * (values[i] + values[i + 1]) * (time[i + 1] - time[i]);
  const span = time[to] - time[from];
  return span > 0 ? s / span : values[to];
}

/**
 * Time-weighted RMS of a non-uniformly sampled signal. The square is integrated with the exact
 * formula for a linear segment: (a^2 + ab + b^2)/3 * dt.
 */
export function timeRms(time: ArrayLike<number>, values: ArrayLike<number>, from = 0, to = time.length - 1): number {
  if (to <= from) return to === from ? Math.abs(values[from]) : Number.NaN;
  let s = 0;
  for (let i = from; i < to; i++) {
    const a = values[i];
    const b = values[i + 1];
    s += ((a * a + a * b + b * b) / 3) * (time[i + 1] - time[i]);
  }
  const span = time[to] - time[from];
  return span > 0 ? Math.sqrt(s / span) : Math.abs(values[to]);
}

// ---------------------------------------------------------------------------
// Frequency estimation
// ---------------------------------------------------------------------------

export interface CrossingOptions {
  /** crossing level (default: time-weighted mean of the signal) */
  level?: number;
  /** hysteresis as a fraction of the peak-to-peak value (default 0.05) */
  hysteresis?: number;
  edge?: 'rising' | 'falling';
}

/**
 * Interpolated times at which the signal crosses `level` in the given direction, with
 * hysteresis: after a crossing the signal must go back beyond level -/+ h before the next one counts.
 */
export function levelCrossings(time: ArrayLike<number>, values: ArrayLike<number>, opts: CrossingOptions = {}): number[] {
  const n = time.length;
  if (n < 2) return [];
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (values[i] < vmin) vmin = values[i];
    if (values[i] > vmax) vmax = values[i];
  }
  const pp = vmax - vmin;
  if (!(pp > 0)) return [];
  const level = opts.level ?? timeMean(time, values);
  const h = (opts.hysteresis ?? 0.05) * pp;
  const rising = (opts.edge ?? 'rising') === 'rising';
  const out: number[] = [];
  // armed = signal has been on the "before" side beyond the hysteresis band
  let armed = rising ? values[0] < level - h : values[0] > level + h;
  for (let i = 1; i < n; i++) {
    const v = values[i];
    if (!armed) {
      if (rising ? v < level - h : v > level + h) armed = true;
      continue;
    }
    const crossed = rising ? v >= level : v <= level;
    if (crossed) {
      // Find the exact sample pair that straddles `level` (walk back over flat parts).
      let j = i;
      while (j > 0 && (rising ? values[j - 1] >= level : values[j - 1] <= level)) j--;
      const a = values[j - 1];
      const b = values[j];
      const ta = time[j - 1];
      const tb = time[j];
      const t = b === a ? tb : ta + ((level - a) / (b - a)) * (tb - ta);
      out.push(t);
      armed = false;
    }
  }
  return out;
}

/**
 * Fundamental frequency from interpolated rising crossings of the mean level. Needs at least
 * two crossings; returns NaN otherwise.
 */
export function estimateFrequency(time: ArrayLike<number>, values: ArrayLike<number>, opts: CrossingOptions = {}): number {
  const c = levelCrossings(time, values, opts);
  if (c.length < 2) return Number.NaN;
  const span = c[c.length - 1] - c[0];
  return span > 0 ? (c.length - 1) / span : Number.NaN;
}

// ---------------------------------------------------------------------------
// Harmonic analysis: THD, SINAD
// ---------------------------------------------------------------------------

export interface HarmonicOptions {
  /** fundamental frequency (Hz); estimated from zero crossings when omitted */
  fundamental?: number;
  /** highest harmonic number included in THD (default 10) */
  harmonics?: number;
  /** uniform samples per fundamental period (default 256) */
  samplesPerPeriod?: number;
  /** maximum number of whole periods analysed, taken from the END of the record (default 50) */
  maxPeriods?: number;
}

export interface HarmonicAnalysis {
  fundamental: number;
  periods: number;
  /** DC component */
  dc: number;
  /** peak amplitudes; index h = harmonic number (index 0 = |DC|) */
  amplitudes: number[];
  /** phases in degrees (sine reference), index h */
  phases: number[];
  /** THD as a ratio sqrt(sum_{h>=2} A_h^2) / A_1 */
  thd: number;
  /** THD in dB (20 log10 thd) */
  thdDb: number;
  /** SINAD in dB: 10 log10(P_ac / (P_ac - P_fundamental)) */
  sinad: number;
  /** total RMS including DC */
  totalRms: number;
  /** RMS of the AC part */
  acRms: number;
  /** RMS of everything except DC and the fundamental (noise + distortion) */
  noiseDistortionRms: number;
}

/**
 * Harmonic analysis over the last whole number of fundamental periods. The record is
 * resampled uniformly so each harmonic falls exactly on a DFT bin (coherent sampling), which
 * makes amplitudes exact for periodic signals without windowing.
 */
export function analyzeHarmonics(time: ArrayLike<number>, values: ArrayLike<number>, opts: HarmonicOptions = {}): HarmonicAnalysis {
  const n = time.length;
  const f0 = opts.fundamental ?? estimateFrequency(time, values);
  const H = Math.max(1, Math.floor(opts.harmonics ?? 10));
  const empty: HarmonicAnalysis = {
    fundamental: f0,
    periods: 0,
    dc: Number.NaN,
    amplitudes: [],
    phases: [],
    thd: Number.NaN,
    thdDb: Number.NaN,
    sinad: Number.NaN,
    totalRms: Number.NaN,
    acRms: Number.NaN,
    noiseDistortionRms: Number.NaN,
  };
  if (n < 2 || !(f0 > 0) || !Number.isFinite(f0)) return empty;
  const T = 1 / f0;
  const tEnd = time[n - 1];
  const span = tEnd - time[0];
  let periods = Math.floor(span / T + 1e-9);
  if (periods < 1) return empty;
  periods = Math.min(periods, Math.max(1, Math.floor(opts.maxPeriods ?? 50)));
  let spp = Math.max(Math.floor(opts.samplesPerPeriod ?? 256), 2 * H + 2);
  const maxTotal = 1 << 20;
  if (spp * periods > maxTotal) spp = Math.max(2 * H + 2, Math.floor(maxTotal / periods));
  const N = spp * periods;
  const u = resampleUniform(time, values, N, tEnd - periods * T, tEnd).values;

  let dc = 0;
  for (let i = 0; i < N; i++) dc += u[i];
  dc /= N;
  let pTotal = 0;
  let pAc = 0;
  for (let i = 0; i < N; i++) {
    pTotal += u[i] * u[i];
    pAc += (u[i] - dc) * (u[i] - dc);
  }
  pTotal /= N;
  pAc /= N;

  const amplitudes: number[] = [Math.abs(dc)];
  const phases: number[] = [0];
  for (let h = 1; h <= H; h++) {
    const k = h * periods;
    if (k >= N / 2) {
      amplitudes.push(0);
      phases.push(0);
      continue;
    }
    // Direct DFT at bin k with an incrementally rotated phasor.
    const dRe = Math.cos((2 * Math.PI * k) / N);
    const dIm = -Math.sin((2 * Math.PI * k) / N);
    let cRe = 1;
    let cIm = 0;
    let sRe = 0;
    let sIm = 0;
    for (let i = 0; i < N; i++) {
      const x = u[i] - dc;
      sRe += x * cRe;
      sIm += x * cIm;
      const r = cRe * dRe - cIm * dIm;
      cIm = cRe * dIm + cIm * dRe;
      cRe = r;
      if ((i & 1023) === 1023) {
        // renormalise to stop amplitude drift of the recurrence
        const m = Math.hypot(cRe, cIm);
        cRe /= m;
        cIm /= m;
      }
    }
    amplitudes.push((2 * Math.hypot(sRe, sIm)) / N);
    // x = A sin(wt + phi) -> DFT angle = phi - 90 deg
    phases.push(wrapDeg((Math.atan2(sIm, sRe) * 180) / Math.PI + 90));
  }
  let harm2 = 0;
  for (let h = 2; h <= H; h++) harm2 += amplitudes[h] * amplitudes[h];
  const a1 = amplitudes[1];
  const thd = a1 > 0 ? Math.sqrt(harm2) / a1 : Number.NaN;
  const p1 = (a1 * a1) / 2;
  const pNd = Math.max(0, pAc - p1);
  return {
    fundamental: f0,
    periods,
    dc,
    amplitudes,
    phases,
    thd,
    thdDb: 20 * Math.log10(thd),
    sinad: pNd > 0 ? 10 * Math.log10(pAc / pNd) : Number.POSITIVE_INFINITY,
    totalRms: Math.sqrt(pTotal),
    acRms: Math.sqrt(pAc),
    noiseDistortionRms: Math.sqrt(pNd),
  };
}

/** THD ratio (not percent). See `analyzeHarmonics`. */
export function thd(time: ArrayLike<number>, values: ArrayLike<number>, fundamental?: number, harmonics = 10): number {
  return analyzeHarmonics(time, values, { fundamental, harmonics }).thd;
}

/** SINAD in dB. See `analyzeHarmonics`. */
export function sinad(time: ArrayLike<number>, values: ArrayLike<number>, fundamental?: number): number {
  return analyzeHarmonics(time, values, { fundamental }).sinad;
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(d: number): number {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/** Unwrap a phase sequence in degrees (removes 360 degree jumps). */
export function unwrapDeg(phase: ArrayLike<number>): Float64Array {
  const out = new Float64Array(phase.length);
  let offset = 0;
  for (let i = 0; i < phase.length; i++) {
    if (i > 0) {
      const d = phase[i] + offset - out[i - 1];
      if (d > 180) offset -= 360 * Math.round(d / 360);
      else if (d < -180) offset += 360 * Math.round(-d / 360);
    }
    out[i] = phase[i] + offset;
  }
  return out;
}
