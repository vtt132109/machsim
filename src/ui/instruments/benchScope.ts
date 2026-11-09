/**
 * Digital storage / mixed-signal oscilloscope logic (pure): settings, automatic measurements,
 * math channel, FFT of the displayed record, auto setup and logic-lane decoding. Acquisition
 * (trigger, sweep window, coupling) reuses scope.ts.
 *
 * Automatic measurements over the displayed window (IEEE Std 181 style):
 *   top / base   histogram modes of the upper / lower half of the samples (max / min when the
 *                signal has no flat levels), amplitude = top − base
 *   freq, period average of the complete periods between 50 % (mid-level) rising crossings
 *   +width, −width, duty   between 50 % crossings; rise / fall 10 % → 90 % of base…top
 *   vpp, vmax, vmin, vavg (time-weighted mean), vrms (true RMS incl. DC), acrms,
 *   overshoot  (max − top)/amplitude in %
 *   delay      first rising 50 % crossing of the second channel after the first one's (s);
 *   phase      360°·delay/period of the first channel
 * FFT: the window is resampled uniformly (2^n points), windowed (Hann, flat top, rectangular) and
 * shown as dBV RMS per bin.
 */
import { amplitudeSpectrum, nextPow2, resampleUniform, type WindowKind } from '../results/dsp';
import { windowMean } from './scope';
import { acRmsOf } from './benchDmm';

/** Smallest 1-2-5 value at or above v (scope V/div and s/div). */
export function nice125(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const e = Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    const c = m * 10 ** e;
    if (c >= v * (1 - 1e-9)) return Number(c.toPrecision(3));
  }
  return 10 ** (e + 1);
}

export type MeasureType = 'freq' | 'period' | 'vpp' | 'vmax' | 'vmin' | 'vamp' | 'vtop' | 'vbase' | 'vavg' | 'vrms' | 'acrms' | 'pwidth' | 'nwidth' | 'duty' | 'rise' | 'fall' | 'overshoot' | 'delay' | 'phase';

export const MEASURE_TYPES: readonly MeasureType[] = ['freq', 'period', 'vpp', 'vmax', 'vmin', 'vamp', 'vtop', 'vbase', 'vavg', 'vrms', 'acrms', 'pwidth', 'nwidth', 'duty', 'rise', 'fall', 'overshoot', 'delay', 'phase'];

export const MEASURE_UNITS: Record<MeasureType, string> = {
  freq: 'Hz',
  period: 's',
  vpp: 'V',
  vmax: 'V',
  vmin: 'V',
  vamp: 'V',
  vtop: 'V',
  vbase: 'V',
  vavg: 'V',
  vrms: 'V',
  acrms: 'V',
  pwidth: 's',
  nwidth: 's',
  duty: '%',
  rise: 's',
  fall: 's',
  overshoot: '%',
  delay: 's',
  phase: '°',
};

export interface MeasureSlot {
  type: MeasureType;
  /** source channel key (A..D) */
  ch: string;
}

/** Parse "freq:A,vpp:B" (unknown entries dropped, at most 6). */
export function parseMeasureSlots(text: string): MeasureSlot[] {
  const out: MeasureSlot[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const [type, ch] = part.split(':');
    if ((MEASURE_TYPES as readonly string[]).includes(type) && /^[A-D]$/.test(ch ?? '')) out.push({ type: type as MeasureType, ch: ch! });
    if (out.length >= 6) break;
  }
  return out;
}

export function formatMeasureSlots(slots: readonly MeasureSlot[]): string {
  return slots.map((s) => `${s.type}:${s.ch}`).join(',');
}

export interface WaveMeasurements {
  vmax: number;
  vmin: number;
  vpp: number;
  vtop: number;
  vbase: number;
  vamp: number;
  vavg: number;
  vrms: number;
  acrms: number;
  freq: number;
  period: number;
  pwidth: number;
  nwidth: number;
  duty: number;
  rise: number;
  fall: number;
  overshoot: number;
  /** rising 50 % crossings found */
  edges: number[];
}

/** Interpolated crossings of `level` with a hysteresis band (rising or falling). */
export function levelCrossings(time: ArrayLike<number>, v: ArrayLike<number>, level: number, rising: boolean, h: number, t0 = -Infinity, t1 = Infinity): number[] {
  const out: number[] = [];
  let armed = false;
  for (let i = 0; i < time.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) {
      armed = false;
      continue;
    }
    if (!armed) {
      if (rising ? x < level - h : x > level + h) armed = true;
      continue;
    }
    if (i > 0 && (rising ? x >= level : x <= level)) {
      const a = v[i - 1];
      const t = x === a ? time[i] : time[i - 1] + ((level - a) / (x - a)) * (time[i] - time[i - 1]);
      if (t >= t0 && t <= t1) out.push(t);
      armed = false;
    }
  }
  return out;
}

/** Histogram mode of the samples in [lo, hi] (null when no bin holds 5 % of them). */
function histogramMode(values: number[], lo: number, hi: number): number | null {
  if (!values.length || !(hi > lo)) return null;
  const bins = 64;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    counts[k]++;
  }
  let best = 0;
  for (let k = 1; k < bins; k++) if (counts[k] > counts[best]) best = k;
  if (counts[best] < 0.05 * values.length) return null;
  // mean of the samples in the winning bin
  let s = 0;
  let c = 0;
  for (const v of values) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)));
    if (k === best) {
      s += v;
      c++;
    }
  }
  return s / c;
}

/** All automatic measurements of one channel over [t0, t1]. */
export function measureWaveform(time: ArrayLike<number>, values: ArrayLike<number>, t0: number, t1: number): WaveMeasurements {
  const inWin: number[] = [];
  for (let i = 0; i < time.length; i++) if (time[i] >= t0 && time[i] <= t1 && Number.isFinite(values[i])) inWin.push(values[i]);
  const nan = Number.NaN;
  if (inWin.length < 2) {
    return { vmax: nan, vmin: nan, vpp: nan, vtop: nan, vbase: nan, vamp: nan, vavg: nan, vrms: nan, acrms: nan, freq: nan, period: nan, pwidth: nan, nwidth: nan, duty: nan, rise: nan, fall: nan, overshoot: nan, edges: [] };
  }
  let vmax = -Infinity;
  let vmin = Infinity;
  for (const v of inWin) {
    vmax = Math.max(vmax, v);
    vmin = Math.min(vmin, v);
  }
  const vpp = vmax - vmin;
  const mid0 = (vmax + vmin) / 2;
  const upper = inWin.filter((v) => v >= mid0);
  const lower = inWin.filter((v) => v < mid0);
  const vtop = histogramMode(upper, mid0, vmax + 1e-12) ?? vmax;
  const vbase = histogramMode(lower, vmin - 1e-12, mid0) ?? vmin;
  const vamp = vtop - vbase;
  const vavg = windowMean(time, values, t0, t1);
  const acrms = acRmsOf(time, values, t0, t1);
  const vrms = Math.sqrt(acrms * acrms + vavg * vavg);
  const mid = (vtop + vbase) / 2;
  const h = Math.max(vamp * 0.05, 1e-12);
  const rises = levelCrossings(time, values, mid, true, h, t0, t1);
  const falls = levelCrossings(time, values, mid, false, h, t0, t1);
  let period = nan;
  if (rises.length >= 2) period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
  else if (falls.length >= 2) period = (falls[falls.length - 1] - falls[0]) / (falls.length - 1);
  let pwidth = nan;
  let nwidth = nan;
  const pos: number[] = [];
  const neg: number[] = [];
  for (const r of rises) {
    const f = falls.find((x) => x > r);
    if (f !== undefined) pos.push(f - r);
  }
  for (const f of falls) {
    const r = rises.find((x) => x > f);
    if (r !== undefined) neg.push(r - f);
  }
  if (pos.length) pwidth = pos.reduce((a, b) => a + b, 0) / pos.length;
  if (neg.length) nwidth = neg.reduce((a, b) => a + b, 0) / neg.length;
  if (!Number.isFinite(period) && Number.isFinite(pwidth) && Number.isFinite(nwidth)) period = pwidth + nwidth;
  const duty = Number.isFinite(pwidth) && Number.isFinite(period) ? (100 * pwidth) / period : nan;
  // 10 % → 90 % edges
  const l10 = vbase + 0.1 * vamp;
  const l90 = vbase + 0.9 * vamp;
  const edgeTime = (rising: boolean): number => {
    const a = levelCrossings(time, values, rising ? l10 : l90, rising, h * 0.2, t0, t1);
    const b = levelCrossings(time, values, rising ? l90 : l10, rising, h * 0.2, t0, t1);
    const d: number[] = [];
    for (const x of a) {
      const y = b.find((z) => z >= x);
      if (y !== undefined && (!Number.isFinite(period) || y - x < period)) d.push(y - x);
    }
    return d.length ? d.reduce((p, q) => p + q, 0) / d.length : nan;
  };
  const freq = Number.isFinite(period) && period > 0 ? 1 / period : nan;
  const overshoot = vamp > 0 ? (100 * (vmax - vtop)) / vamp : nan;
  return { vmax, vmin, vpp, vtop, vbase, vamp, vavg, vrms, acrms, freq, period, pwidth, nwidth, duty, rise: edgeTime(true), fall: edgeTime(false), overshoot, edges: rises };
}

/** Delay of channel b behind channel a (first rising mid-level crossings) and the phase. */
export function measureDelay(time: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>, t0: number, t1: number): { delay: number; phase: number } {
  const ma = measureWaveform(time, a, t0, t1);
  const mb = measureWaveform(time, b, t0, t1);
  if (!ma.edges.length || !mb.edges.length) return { delay: Number.NaN, phase: Number.NaN };
  const ta = ma.edges[0];
  const tb = mb.edges.find((x) => x >= ta) ?? Number.NaN;
  const delay = tb - ta;
  let phase = Number.isFinite(ma.period) ? (360 * delay) / ma.period : Number.NaN;
  if (phase > 180) phase -= 360;
  return { delay, phase };
}

export type MathOp = 'off' | 'add' | 'sub' | 'mul' | 'fft';

/** Element-wise math channel of two sampled channels on the same time axis. */
export function mathChannel(op: Exclude<MathOp, 'off' | 'fft'>, a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = op === 'add' ? a[i] + b[i] : op === 'sub' ? a[i] - b[i] : a[i] * b[i];
  return out;
}

export interface FftResult {
  freq: Float64Array;
  /** dBV RMS per bin */
  db: Float64Array;
  df: number;
  /** strongest non-DC bin */
  peakFreq: number;
  peakDb: number;
}

/** FFT of the window [t0, t1] of a channel (dBV RMS). */
export function windowFft(time: ArrayLike<number>, values: ArrayLike<number>, t0: number, t1: number, window: WindowKind = 'hann', maxPoints = 4096): FftResult | null {
  const span = t1 - t0;
  if (!(span > 0) || time.length < 4) return null;
  // sample rate: at least the record density, capped at maxPoints
  let count = 0;
  for (let i = 0; i < time.length; i++) if (time[i] >= t0 && time[i] <= t1) count++;
  const N = Math.min(maxPoints, nextPow2(Math.max(64, count * 2)));
  const u = resampleUniform(time, values, N, t0, t1);
  const fs = N / span;
  const spec = amplitudeSpectrum(u.values, fs, { window });
  const db = new Float64Array(spec.freq.length);
  let peakFreq = Number.NaN;
  let peakDb = -Infinity;
  for (let k = 0; k < spec.freq.length; k++) {
    const rms = k === 0 ? Math.abs(spec.amplitude[k]) : spec.amplitude[k] / Math.SQRT2;
    db[k] = 20 * Math.log10(Math.max(rms, 1e-12));
    if (k > 0 && db[k] > peakDb) {
      peakDb = db[k];
      peakFreq = spec.freq[k];
    }
  }
  return { freq: Float64Array.from(spec.freq), db, df: spec.df, peakFreq, peakDb };
}

/** Compact user-number text (0.5 → "500m", 5e-4 → "500u") for settings written by auto setup. */
export function settingText(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  const table: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  for (const [mul, suf] of table) if (a >= mul * 0.9999999) return `${Number((v / mul).toPrecision(4))}${suf}`;
  return String(Number(v.toPrecision(4)));
}

/**
 * Auto setup: per wired channel a V/div showing about 5 divisions peak-to-peak, centred; timebase
 * for about 2.5 periods of the first periodic channel; trigger on it at its mid level.
 */
export function autoSetup(time: ArrayLike<number>, channels: Record<string, ArrayLike<number> | undefined>, order: readonly string[]): Record<string, string> {
  const patch: Record<string, string> = {};
  if (time.length < 4) return patch;
  const t0 = time[0];
  const t1 = time[time.length - 1];
  let trig: { ch: string; m: WaveMeasurements } | null = null;
  for (const ch of order) {
    const v = channels[ch];
    if (!v) continue;
    const m = measureWaveform(time, v, t0, t1);
    if (!Number.isFinite(m.vpp)) continue;
    const scale = nice125(Math.max(m.vpp, Math.abs(m.vavg) * 0.2, 1e-3) / 5);
    patch[`${ch}.scale`] = settingText(scale);
    patch[`${ch}.pos`] = String(Math.max(-3.5, Math.min(3.5, Math.round((-(m.vmax + m.vmin) / 2 / scale) * 10) / 10)));
    patch[`${ch}.coupling`] = 'dc';
    patch[`${ch}.on`] = 'on';
    if (!trig && m.vpp > 1e-3 && Number.isFinite(m.period)) trig = { ch, m };
  }
  if (trig) {
    patch['trig.source'] = trig.ch;
    // trigger at mid level, rounded to 1/50 division of the channel
    const step = nice125(Math.max(trig.m.vpp, 1e-3) / 5) / 50;
    patch['trig.level'] = settingText(Math.round((trig.m.vtop + trig.m.vbase) / 2 / step) * step);
    patch['trig.edge'] = 'rising';
    patch['trig.mode'] = 'auto';
    patch.timebase = settingText(nice125((2.5 * trig.m.period) / 10));
  } else patch.timebase = settingText(nice125((t1 - t0) / 10));
  patch.xpos = '0';
  return patch;
}

/** Logic level of a sample: 1 above, 0 below the threshold, -1 unknown (NaN). */
export function logicBit(v: number, threshold: number): 0 | 1 | -1 {
  if (!Number.isFinite(v)) return -1;
  return v >= threshold ? 1 : 0;
}

/** Bus value of logic lanes at sample i (lane 0 = LSB; null when a wired lane is unknown). */
export function busValue(lanes: (ArrayLike<number> | undefined)[], i: number, threshold: number, width: number): number | null {
  let v = 0;
  for (let k = 0; k < width; k++) {
    const lane = lanes[k];
    if (!lane) continue;
    const b = logicBit(lane[i], threshold);
    if (b < 0) return null;
    v |= b << k;
  }
  return v >>> 0;
}
