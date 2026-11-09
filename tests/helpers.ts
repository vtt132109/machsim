/**
 * Shared helpers for the end-to-end tests: vector lookup, interpolation, level crossings and
 * small-signal magnitude / phase of AC results.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDesign } from '../src/model/serialize';
import type { Design } from '../src/model/types';
import type { AnalysisResult, Vector } from '../src/sim/results';

export const EXAMPLES_DIR = fileURLToPath(new URL('../examples/', import.meta.url));

export function loadExample(file: string): Design {
  return parseDesign(readFileSync(EXAMPLES_DIR + file, 'utf8'));
}

export function readExampleText(file: string): string {
  return readFileSync(EXAMPLES_DIR + file, 'utf8');
}

/** Vector by name (case-insensitive); throws with the available names when missing. */
export function vector(result: AnalysisResult, name: string): Vector {
  const key = name.toLowerCase();
  const v = result.vectors.find((x) => x.name.toLowerCase() === key);
  if (!v) throw new Error(`vector ${name} not found; have ${result.vectors.map((x) => x.name).join(', ')}`);
  return v;
}

export function scale(result: AnalysisResult): Float64Array {
  if (!result.scale) throw new Error(`${result.type} result has no scale`);
  return result.scale.re;
}

/** Linear interpolation of y(x) at x0 (x ascending). */
export function interpAt(x: ArrayLike<number>, y: ArrayLike<number>, x0: number): number {
  const n = x.length;
  if (x0 <= x[0]) return y[0];
  if (x0 >= x[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= x0) lo = mid;
    else hi = mid;
  }
  const f = (x0 - x[lo]) / (x[hi] - x[lo]);
  return y[lo] + f * (y[hi] - y[lo]);
}

/** Interpolated x positions where y crosses `level` in the given direction. */
export function crossings(x: ArrayLike<number>, y: ArrayLike<number>, level: number, dir: 'rise' | 'fall' | 'both' = 'both'): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) {
    const a = y[i - 1] - level;
    const b = y[i] - level;
    const rise = a < 0 && b >= 0;
    const fall = a > 0 && b <= 0;
    if ((rise && dir !== 'fall') || (fall && dir !== 'rise')) {
      out.push(x[i - 1] + ((x[i] - x[i - 1]) * a) / (a - b));
    }
  }
  return out;
}

/** Samples of y with x in [x0, x1]. */
export function window(x: ArrayLike<number>, y: ArrayLike<number>, x0: number, x1: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i] >= x0 && x[i] <= x1) out.push(y[i]);
  return out;
}

/** |a/b| and phase(a/b) in degrees for complex vectors at index i. */
export function ratioAt(a: Vector, b: Vector, i: number): { mag: number; phaseDeg: number } {
  const ar = a.re[i];
  const ai = a.im?.[i] ?? 0;
  const br = b.re[i];
  const bi = b.im?.[i] ?? 0;
  const den = br * br + bi * bi;
  const re = (ar * br + ai * bi) / den;
  const im = (ai * br - ar * bi) / den;
  return { mag: Math.hypot(re, im), phaseDeg: (Math.atan2(im, re) * 180) / Math.PI };
}

/** Magnitude of a complex vector at every point. */
export function magnitude(v: Vector): Float64Array {
  const out = new Float64Array(v.re.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(v.re[i], v.im?.[i] ?? 0);
  return out;
}

/** Phase of a complex vector in degrees at every point. */
export function phaseDeg(v: Vector): Float64Array {
  const out = new Float64Array(v.re.length);
  for (let i = 0; i < out.length; i++) out[i] = (Math.atan2(v.im?.[i] ?? 0, v.re[i]) * 180) / Math.PI;
  return out;
}

/** Index of the sample closest to x0. */
export function nearestIndex(x: ArrayLike<number>, x0: number): number {
  let best = 0;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - x0) < Math.abs(x[best] - x0)) best = i;
  return best;
}

/** Crossing of a decreasing magnitude curve through `level`, interpolated in log-frequency. */
export function logCrossing(f: ArrayLike<number>, mag: ArrayLike<number>, level: number, from = 0): number {
  for (let i = Math.max(1, from); i < f.length; i++) {
    const a = mag[i - 1] - level;
    const b = mag[i] - level;
    if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) {
      const t = a / (a - b);
      return Math.exp(Math.log(f[i - 1]) + t * (Math.log(f[i]) - Math.log(f[i - 1])));
    }
  }
  return Number.NaN;
}
