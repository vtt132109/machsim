/**
 * Bode plotter computations (pure).
 *
 * H(f) = (V(OUT+) - V(OUT-)) / (V(IN+) - V(IN-)) from an AC analysis result. Magnitude is
 * reported as a ratio and in dB, phase in degrees (unwrapped so it does not jump by 360°).
 */

import type { SignalRef } from '../../model/types';
import type { AcAnalysis } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { parseUserNumber } from '../../util/units';
import { unwrapDeg } from '../results/dsp';
import { resultSignal } from './signals';

export interface BodeData {
  freq: Float64Array;
  re: Float64Array;
  im: Float64Array;
  /** |H| */
  mag: Float64Array;
  /** 20 log10 |H| */
  db: Float64Array;
  /** unwrapped phase, degrees */
  phase: Float64Array;
}

/** Complex division a / b for arrays (NaN where b = 0). */
function divide(aRe: ArrayLike<number>, aIm: ArrayLike<number>, bRe: ArrayLike<number>, bIm: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = aRe.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = bRe[i] * bRe[i] + bIm[i] * bIm[i];
    if (d === 0) {
      re[i] = Number.NaN;
      im[i] = Number.NaN;
      continue;
    }
    re[i] = (aRe[i] * bRe[i] + aIm[i] * bIm[i]) / d;
    im[i] = (aIm[i] * bRe[i] - aRe[i] * bIm[i]) / d;
  }
  return { re, im };
}

/** Build Bode data from complex H samples. */
export function bodeFromComplex(freq: Float64Array, re: Float64Array, im: Float64Array): BodeData {
  const n = freq.length;
  const mag = new Float64Array(n);
  const db = new Float64Array(n);
  const ph = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
    db[i] = 20 * Math.log10(mag[i]);
    ph[i] = (Math.atan2(im[i], re[i]) * 180) / Math.PI;
  }
  return { freq, re, im, mag, db, phase: unwrapDeg(ph) };
}

/**
 * Transfer function between two voltage signals of an AC result. Returns null when the result
 * has no frequency scale or a referenced node vector is missing.
 */
export function bodeTransfer(ac: AnalysisResult, input: SignalRef, output: SignalRef): BodeData | null {
  const scale = ac.scale;
  if (!scale) return null;
  const vin = resultSignal(ac, input);
  const vout = resultSignal(ac, output);
  if (!vin || !vout || vin.re.length !== scale.re.length || vout.re.length !== scale.re.length) return null;
  const h = divide(vout.re, vout.im, vin.re, vin.im);
  return bodeFromComplex(scale.re, h.re, h.im);
}

/** Linear interpolation of y over x at xq (log-x interpolation when `logX`). NaN outside. */
export function interpolateCurve(x: ArrayLike<number>, y: ArrayLike<number>, xq: number, logX = false): number {
  const n = x.length;
  if (n === 0) return Number.NaN;
  const asc = x[n - 1] >= x[0];
  const lo0 = asc ? x[0] : x[n - 1];
  const hi0 = asc ? x[n - 1] : x[0];
  if (xq < lo0 || xq > hi0) return Number.NaN;
  for (let i = 0; i + 1 < n; i++) {
    const a = x[i];
    const b = x[i + 1];
    if ((xq >= a && xq <= b) || (xq <= a && xq >= b)) {
      if (a === b) return y[i + 1];
      const f = logX && a > 0 && b > 0 && xq > 0 ? Math.log(xq / a) / Math.log(b / a) : (xq - a) / (b - a);
      return y[i] + f * (y[i + 1] - y[i]);
    }
  }
  return y[n - 1];
}

/**
 * First frequency at which `y` crosses `target` (e.g. the -3 dB point or 0 dB unity gain),
 * interpolated on a log-frequency axis. NaN when it never crosses.
 */
export function crossingFrequency(freq: ArrayLike<number>, y: ArrayLike<number>, target: number): number {
  for (let i = 0; i + 1 < freq.length; i++) {
    const a = y[i] - target;
    const b = y[i + 1] - target;
    if (a === 0) return freq[i];
    if (a * b < 0) {
      const f = a / (a - b);
      const fa = freq[i];
      const fb = freq[i + 1];
      return fa > 0 && fb > 0 ? fa * Math.pow(fb / fa, f) : fa + f * (fb - fa);
    }
  }
  return Number.NaN;
}

/**
 * Bode plotter params (text): mode (mag|phase), hscale (log|lin), vscale (log|lin; magnitude
 * only, log = dB), fstart / fstop (Hz, also the AC sweep range), mmin / mmax (dB or ratio),
 * pmin / pmax (deg), points (per decade), cursor (Hz).
 */
export const BODE_DEFAULTS: Record<string, string> = {
  mode: 'mag',
  hscale: 'log',
  vscale: 'log',
  fstart: '1',
  fstop: '10G',
  mmin: '-200',
  mmax: '20',
  pmin: '-720',
  pmax: '720',
  points: '100',
  cursor: '',
};

function paramNum(params: Record<string, string>, key: string): number {
  const v = parseUserNumber(params[key] ?? BODE_DEFAULTS[key] ?? '');
  return Number.isFinite(v) ? v : parseUserNumber(BODE_DEFAULTS[key] ?? 'NaN');
}

/**
 * The AC analysis the integration layer should run for a Bode plotter: decade sweep over
 * fstart..fstop with `points` points per decade (requires an AC source in the circuit).
 */
export function bodeAnalysisSpec(params: Record<string, string>): AcAnalysis {
  let fstart = paramNum(params, 'fstart');
  let fstop = paramNum(params, 'fstop');
  if (!(fstart > 0)) fstart = 1;
  if (!(fstop > fstart)) fstop = fstart * 1e9;
  const points = Math.max(1, Math.round(paramNum(params, 'points')) || 100);
  return { type: 'ac', sweep: 'dec', points, fstart, fstop };
}
