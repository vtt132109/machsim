/**
 * Measurement algorithms behind the virtual instruments (pure, DOM-free, unit-tested).
 *
 * All inputs are non-uniformly sampled simulator records (time, values). Periodic signals are
 * measured over a whole number of periods (located with interpolated level crossings) so DC,
 * true-RMS and average power readings do not wobble with the display window.
 *
 * - `meterMeasure`        multimeter / current clamp: DC mean, AC true RMS, total RMS, peak
 * - `powerMeasure`        wattmeter: average power, apparent power, power factor
 * - `counterMeasure`      frequency counter: frequency, period, pulse widths, rise / fall times
 * - `distortionMeasure`   distortion analyzer: THD (IEEE / IEC definitions), SINAD
 * - `spectrumMeasure`     spectrum analyzer: windowed FFT over a start..stop span
 */

import {
  amplitudeSpectrum,
  analyzeHarmonics,
  levelCrossings,
  nextPow2,
  resampleUniform,
  timeMean,
  timeRms,
} from '../results/dsp';
import type { WindowKind } from '../results/dsp';

// ---------------------------------------------------------------------------
// Whole-period window
// ---------------------------------------------------------------------------

export interface PeriodWindow {
  /** first / last sample indices covering the analysed span */
  from: number;
  to: number;
  /** analysed time span */
  t0: number;
  t1: number;
  /** whole periods inside [t0, t1] (0 = signal not periodic, whole record used) */
  periods: number;
  /** estimated frequency (NaN when not periodic) */
  freq: number;
}

function lowerIdx(time: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = time.length - 1;
  if (hi < 0 || t <= time[0]) return 0;
  if (t >= time[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Locate the last `maxPeriods` whole periods of a signal (rising crossings of its mean with 5 %
 * hysteresis). Falls back to the whole record for aperiodic signals.
 */
export function periodWindow(time: ArrayLike<number>, values: ArrayLike<number>, maxPeriods = 20): PeriodWindow {
  const n = time.length;
  const whole: PeriodWindow = { from: 0, to: Math.max(0, n - 1), t0: time[0], t1: time[n - 1], periods: 0, freq: Number.NaN };
  if (n < 3) return whole;
  const c = levelCrossings(time, values, { hysteresis: 0.05 });
  if (c.length < 2) return whole;
  const k = Math.min(maxPeriods, c.length - 1);
  const t0 = c[c.length - 1 - k];
  const t1 = c[c.length - 1];
  if (!(t1 > t0)) return whole;
  const freq = (c.length - 1) / (c[c.length - 1] - c[0]);
  return { from: lowerIdx(time, t0), to: Math.min(n - 1, lowerIdx(time, t1) + 1), t0, t1, periods: k, freq };
}

/** Values of (time, values) restricted to [t0, t1] with interpolated end points. */
function clip(time: ArrayLike<number>, values: ArrayLike<number>, t0: number, t1: number): { t: Float64Array; v: Float64Array } {
  const n = time.length;
  const t: number[] = [];
  const v: number[] = [];
  const interp = (tq: number) => {
    const i = lowerIdx(time, tq);
    if (i >= n - 1) return values[n - 1];
    const ta = time[i];
    const tb = time[i + 1];
    return tb === ta ? values[i + 1] : values[i] + ((tq - ta) / (tb - ta)) * (values[i + 1] - values[i]);
  };
  t.push(t0);
  v.push(interp(t0));
  for (let i = 0; i < n; i++) {
    if (time[i] > t0 && time[i] < t1) {
      t.push(time[i]);
      v.push(values[i]);
    }
  }
  t.push(t1);
  v.push(interp(t1));
  return { t: Float64Array.from(t), v: Float64Array.from(v) };
}

// ---------------------------------------------------------------------------
// Multimeter
// ---------------------------------------------------------------------------

export interface MeterMeasurement {
  /** time-weighted mean (DC reading) */
  dc: number;
  /** true RMS of the AC component (AC reading) */
  acRms: number;
  /** true RMS including DC */
  totalRms: number;
  /** most positive / negative sample in the analysed span */
  max: number;
  min: number;
  /** newest sample */
  latest: number;
  /** detected signal frequency (NaN for DC / aperiodic signals) */
  freq: number;
  /** whole periods analysed (0 = aperiodic, see `meterMeasure`) */
  periods: number;
}

/**
 * Multimeter reading. Periodic signals: mean and RMS over whole periods (up to 20). Aperiodic
 * signals: RMS over the whole record and DC = mean of the newest 5 % of the record (so a
 * settling circuit reads its present value).
 */
export function meterMeasure(time: ArrayLike<number>, values: ArrayLike<number>): MeterMeasurement {
  const n = time.length;
  const nan = Number.NaN;
  if (n === 0) return { dc: nan, acRms: nan, totalRms: nan, max: nan, min: nan, latest: nan, freq: nan, periods: 0 };
  if (n === 1) {
    const v = values[0];
    return { dc: v, acRms: 0, totalRms: Math.abs(v), max: v, min: v, latest: v, freq: nan, periods: 0 };
  }
  const w = periodWindow(time, values);
  let dc: number;
  let totalRms: number;
  let max = -Infinity;
  let min = Infinity;
  if (w.periods > 0) {
    const { t, v } = clip(time, values, w.t0, w.t1);
    dc = timeMean(t, v);
    totalRms = timeRms(t, v);
    for (let i = 0; i < v.length; i++) {
      if (v[i] > max) max = v[i];
      if (v[i] < min) min = v[i];
    }
  } else {
    totalRms = timeRms(time, values);
    const span = time[n - 1] - time[0];
    let from = lowerIdx(time, time[n - 1] - 0.05 * span);
    if (from >= n - 1) from = n - 2;
    dc = timeMean(time, values, from, n - 1);
    for (let i = 0; i < n; i++) {
      if (values[i] > max) max = values[i];
      if (values[i] < min) min = values[i];
    }
  }
  const meanAll = w.periods > 0 ? dc : timeMean(time, values);
  const acRms = Math.sqrt(Math.max(0, totalRms * totalRms - meanAll * meanAll));
  return { dc, acRms, totalRms, max, min, latest: values[n - 1], freq: w.freq, periods: w.periods };
}

/** Reading in dB relative to `reference` (V or A RMS): 20 log10(rms / reference). */
export function decibels(rms: number, reference: number): number {
  return 20 * Math.log10(Math.abs(rms) / reference);
}

// ---------------------------------------------------------------------------
// Wattmeter
// ---------------------------------------------------------------------------

export interface PowerMeasurement {
  /** average (real) power, W */
  power: number;
  vRms: number;
  iRms: number;
  /** apparent power Vrms * Irms, VA */
  apparent: number;
  /** reactive power magnitude sqrt(S^2 - P^2), var */
  reactive: number;
  /** P / S in [-1, 1] (NaN when S = 0) */
  powerFactor: number;
  freq: number;
}

/** Average power and power factor of p(t) = v(t) i(t) over whole periods of v. */
export function powerMeasure(time: ArrayLike<number>, v: ArrayLike<number>, i: ArrayLike<number>): PowerMeasurement {
  const n = time.length;
  const nan = Number.NaN;
  if (n < 2) return { power: nan, vRms: nan, iRms: nan, apparent: nan, reactive: nan, powerFactor: nan, freq: nan };
  let w = periodWindow(time, v);
  if (w.periods === 0) w = periodWindow(time, i);
  let t0 = time[0];
  let t1 = time[n - 1];
  if (w.periods > 0) {
    t0 = w.t0;
    t1 = w.t1;
  }
  const vc = clip(time, v, t0, t1);
  const ic = clip(time, i, t0, t1);
  // On each segment p = v*i is a product of two linear functions (a quadratic), which
  // Simpson's rule integrates exactly.
  let energy = 0;
  for (let k = 0; k + 1 < vc.t.length; k++) {
    const dt = vc.t[k + 1] - vc.t[k];
    const vm = 0.5 * (vc.v[k] + vc.v[k + 1]);
    const im = 0.5 * (ic.v[k] + ic.v[k + 1]);
    energy += (dt / 6) * (vc.v[k] * ic.v[k] + 4 * vm * im + vc.v[k + 1] * ic.v[k + 1]);
  }
  const span = t1 - t0;
  const power = span > 0 ? energy / span : v[n - 1] * i[n - 1];
  const vRms = timeRms(vc.t, vc.v);
  const iRms = timeRms(ic.t, ic.v);
  const apparent = vRms * iRms;
  const pf = apparent > 0 ? Math.max(-1, Math.min(1, power / apparent)) : nan;
  return {
    power,
    vRms,
    iRms,
    apparent,
    reactive: Math.sqrt(Math.max(0, apparent * apparent - power * power)),
    powerFactor: pf,
    freq: w.freq,
  };
}

// ---------------------------------------------------------------------------
// Frequency counter
// ---------------------------------------------------------------------------

export interface CounterOptions {
  /** trigger level (V); default 0 for AC coupling, the signal mean for DC coupling */
  level?: number;
  coupling?: 'ac' | 'dc';
  /** hysteresis band half-width in volts (default 2 % of peak-to-peak) */
  sensitivity?: number;
}

export interface CounterMeasurement {
  freq: number;
  period: number;
  /** mean high time between a rising and the next falling crossing (s) */
  pulsePos: number;
  /** mean low time between a falling and the next rising crossing (s) */
  pulseNeg: number;
  /** mean 10 % -> 90 % rise time (s) */
  rise: number;
  /** mean 90 % -> 10 % fall time (s) */
  fall: number;
  duty: number;
  /** rising crossings counted */
  edges: number;
  vmin: number;
  vmax: number;
}

/** Crossings of `level` in one direction with an absolute hysteresis band `h`. */
export function crossingsAbs(time: ArrayLike<number>, values: ArrayLike<number>, level: number, rising: boolean, h: number): number[] {
  const out: number[] = [];
  const n = time.length;
  if (n < 2) return out;
  let armed = rising ? values[0] < level - h : values[0] > level + h;
  for (let i = 1; i < n; i++) {
    const v = values[i];
    if (!armed) {
      if (rising ? v < level - h : v > level + h) armed = true;
      continue;
    }
    if (rising ? v >= level : v <= level) {
      let j = i;
      while (j > 0 && (rising ? values[j - 1] >= level : values[j - 1] <= level)) j--;
      if (j === 0) {
        armed = false;
        continue;
      }
      const a = values[j - 1];
      const b = values[j];
      out.push(b === a ? time[j] : time[j - 1] + ((level - a) / (b - a)) * (time[j] - time[j - 1]));
      armed = false;
    }
  }
  return out;
}

function meanOf(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
}

/**
 * Durations from each start event to the first end event after it, skipping starts that are
 * followed by another start before any end (both lists ascending). Linear time.
 */
export function pairForward(starts: readonly number[], ends: readonly number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    while (j < ends.length && ends[j] <= s) j++;
    if (j >= ends.length) break;
    const nextStart = k + 1 < starts.length ? starts[k + 1] : Infinity;
    if (ends[j] < nextStart) out.push(ends[j] - s);
  }
  return out;
}

/** Frequency counter measurements with a hysteresis comparator. */
export function counterMeasure(time: ArrayLike<number>, values: ArrayLike<number>, opts: CounterOptions = {}): CounterMeasurement {
  const n = time.length;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (values[i] < vmin) vmin = values[i];
    if (values[i] > vmax) vmax = values[i];
  }
  const nan = Number.NaN;
  const empty: CounterMeasurement = { freq: nan, period: nan, pulsePos: nan, pulseNeg: nan, rise: nan, fall: nan, duty: nan, edges: 0, vmin, vmax };
  if (n < 3 || !(vmax > vmin)) return empty;
  const mean = timeMean(time, values);
  const coupling = opts.coupling ?? 'ac';
  const level = coupling === 'ac' ? mean + (opts.level ?? 0) : (opts.level ?? mean);
  const h = opts.sensitivity ?? 0.02 * (vmax - vmin);
  const rises = crossingsAbs(time, values, level, true, h);
  const falls = crossingsAbs(time, values, level, false, h);
  const freq = rises.length >= 2 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : nan;
  // 10 % / 90 % transition times
  const pp = vmax - vmin;
  const l10 = vmin + 0.1 * pp;
  const l90 = vmin + 0.9 * pp;
  const hh = Math.min(h, 0.04 * pp);
  const r10 = crossingsAbs(time, values, l10, true, hh);
  const r90 = crossingsAbs(time, values, l90, true, hh);
  const f90 = crossingsAbs(time, values, l90, false, hh);
  const f10 = crossingsAbs(time, values, l10, false, hh);
  const rise = meanOf(pairForward(r10, r90));
  const fall = meanOf(pairForward(f90, f10));
  const pulsePos = meanOf(pairForward(rises, falls));
  const pulseNeg = meanOf(pairForward(falls, rises));
  return {
    freq,
    period: freq > 0 ? 1 / freq : nan,
    pulsePos,
    pulseNeg,
    rise,
    fall,
    duty: pulsePos > 0 && pulseNeg > 0 ? pulsePos / (pulsePos + pulseNeg) : nan,
    edges: rises.length,
    vmin,
    vmax,
  };
}

// ---------------------------------------------------------------------------
// Distortion analyzer
// ---------------------------------------------------------------------------

export interface DistortionOptions {
  /** expected fundamental (Hz); estimated from zero crossings when omitted */
  fundamental?: number;
  /** highest harmonic included (default 10) */
  harmonics?: number;
  /**
   * 'ieee': harmonics relative to the fundamental (THD-F);
   * 'iec': harmonics relative to the RMS of fundamental + harmonics (THD-R)
   */
  definition?: 'ieee' | 'iec';
}

export interface DistortionMeasurement {
  fundamental: number;
  /** THD ratio according to `definition` */
  thd: number;
  thdPercent: number;
  thdDb: number;
  /** SINAD in dB */
  sinad: number;
  /** peak amplitudes per harmonic (index 1 = fundamental) */
  harmonics: number[];
  periods: number;
}

export function distortionMeasure(time: ArrayLike<number>, values: ArrayLike<number>, opts: DistortionOptions = {}): DistortionMeasurement {
  const h = analyzeHarmonics(time, values, { fundamental: opts.fundamental, harmonics: opts.harmonics ?? 10 });
  const a1 = h.amplitudes[1] ?? Number.NaN;
  let sum2 = 0;
  for (let k = 2; k < h.amplitudes.length; k++) sum2 += h.amplitudes[k] * h.amplitudes[k];
  const thd = (opts.definition ?? 'ieee') === 'iec' ? Math.sqrt(sum2) / Math.sqrt(a1 * a1 + sum2) : Math.sqrt(sum2) / a1;
  return {
    fundamental: h.fundamental,
    thd,
    thdPercent: 100 * thd,
    thdDb: 20 * Math.log10(thd),
    sinad: h.sinad,
    harmonics: h.amplitudes,
    periods: h.periods,
  };
}

// ---------------------------------------------------------------------------
// Spectrum analyzer
// ---------------------------------------------------------------------------

export interface SpectrumRequest {
  /** displayed span (Hz) */
  start: number;
  stop: number;
  /** requested resolution (bin spacing, Hz) */
  resolution: number;
  window?: WindowKind;
  /** maximum FFT length (default 2^17) */
  maxPoints?: number;
}

export interface SpectrumMeasurement {
  freq: Float64Array;
  /** RMS amplitude per bin (DC bin: the DC value) */
  rms: Float64Array;
  /** achieved bin spacing (Hz) */
  df: number;
  fs: number;
  /** record length used (s) */
  duration: number;
  points: number;
  /** strongest bin in the span (excluding DC) */
  peakFreq: number;
  peakRms: number;
}

/**
 * Spectrum of the newest `1 / resolution` seconds of a record (less when the record is
 * shorter). The record is resampled uniformly at fs >= 2.56 * stop and windowed.
 */
export function spectrumMeasure(time: ArrayLike<number>, values: ArrayLike<number>, req: SpectrumRequest): SpectrumMeasurement {
  const n = time.length;
  const empty: SpectrumMeasurement = {
    freq: new Float64Array(0),
    rms: new Float64Array(0),
    df: Number.NaN,
    fs: Number.NaN,
    duration: 0,
    points: 0,
    peakFreq: Number.NaN,
    peakRms: Number.NaN,
  };
  if (n < 4 || !(req.stop > 0)) return empty;
  const span = time[n - 1] - time[0];
  if (!(span > 0)) return empty;
  const maxN = req.maxPoints ?? 1 << 17;
  const fsMin = 2.56 * req.stop;
  let duration = Math.min(span, req.resolution > 0 ? 1 / req.resolution : span);
  if (fsMin * duration > maxN) duration = maxN / fsMin;
  const N = Math.min(maxN, nextPow2(Math.max(16, Math.ceil(fsMin * duration))));
  const tEnd = time[n - 1];
  const u = resampleUniform(time, values, N, tEnd - duration, tEnd);
  const fs = N / duration;
  const spec = amplitudeSpectrum(u.values, fs, { window: req.window ?? 'hann' });
  const lo = Math.max(0, req.start);
  const idx: number[] = [];
  for (let k = 0; k < spec.freq.length; k++) if (spec.freq[k] >= lo - spec.df * 1e-9 && spec.freq[k] <= req.stop + spec.df * 1e-9) idx.push(k);
  const freq = new Float64Array(idx.length);
  const rms = new Float64Array(idx.length);
  let peakFreq = Number.NaN;
  let peakRms = -Infinity;
  idx.forEach((k, j) => {
    freq[j] = spec.freq[k];
    rms[j] = k === 0 ? spec.amplitude[k] : spec.amplitude[k] / Math.SQRT2;
    if (k > 0 && rms[j] > peakRms) {
      peakRms = rms[j];
      peakFreq = freq[j];
    }
  });
  return { freq, rms, df: spec.df, fs, duration, points: N, peakFreq, peakRms: Number.isFinite(peakRms) ? peakRms : Number.NaN };
}

/** RMS volts -> display unit: 'dBV' (re 1 Vrms), 'dBm' (into `impedance` ohms) or 'lin' (Vrms). */
export function spectrumLevel(vrms: number, unit: 'dBV' | 'dBm' | 'lin', impedance = 50): number {
  if (unit === 'lin') return vrms;
  if (unit === 'dBV') return 20 * Math.log10(vrms);
  return 10 * Math.log10((vrms * vrms) / impedance / 1e-3);
}
