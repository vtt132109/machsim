/**
 * Independent reference helpers for the numerical review tests: run a SPICE deck through the
 * public API, and closed-form / scalar-root utilities used to compute the expected values
 * WITHOUT using any simulator code (only the shared physical constants of src/sim/device.ts).
 */
import { expect } from 'vitest';
import { runAnalyses } from '../../../src/sim';
import { parseSpice } from '../../../src/sim/spice';
import type { AnalysisResult, Vector } from '../../../src/sim/results';
import { BOLTZ, CHARGE } from '../../../src/sim/device';

/** Parse a deck (must parse cleanly) and run every analysis (none may fail). */
export function runDeck(text: string): AnalysisResult[] {
  const parsed = parseSpice(text, { fileName: 'review.cir' });
  expect(parsed.errors).toEqual([]);
  const results = runAnalyses(parsed.netlist);
  for (const r of results) expect(r.error, `${r.type}: ${r.error}`).toBeUndefined();
  return results;
}

/** Parse and run without asserting success (for convergence probes). */
export function tryDeck(text: string): AnalysisResult[] {
  const parsed = parseSpice(text, { fileName: 'review.cir' });
  expect(parsed.errors).toEqual([]);
  return runAnalyses(parsed.netlist);
}

export function vec(r: AnalysisResult, name: string): Vector {
  const key = name.toLowerCase();
  const v = r.vectors.find((x) => x.name.toLowerCase() === key);
  if (!v) throw new Error(`vector ${name} missing; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
}

export function opValue(r: AnalysisResult, name: string): number {
  return vec(r, name).re[0];
}

export function scaleOf(r: AnalysisResult): Float64Array {
  if (!r.scale) throw new Error('no scale');
  return r.scale.re;
}

/** Thermal voltage kT/q at a Celsius temperature, with the SPICE constants of the contract. */
export function vtAt(celsius: number): number {
  return (BOLTZ * (celsius + 273.15)) / CHARGE;
}

/** Principal branch of Lambert W for x > 0. */
export function lambertW(x: number): number {
  if (x < 0) throw new Error('lambertW: x < 0');
  if (x === 0) return 0;
  return lambertWLog(Math.log(x));
}

/**
 * W(e^L): root of w + ln w = L (Halley iteration). Taking ln(x) instead of x lets the diode
 * solution use arguments like exp(190) that overflow a double.
 */
export function lambertWLog(L: number): number {
  let w = L > 1 ? L - Math.log(L) : Math.exp(L) * (1 - Math.exp(L));
  if (!(w > 0)) w = 0.5;
  for (let k = 0; k < 100; k++) {
    const f = w + Math.log(w) - L;
    const fp = 1 + 1 / w;
    const fpp = -1 / (w * w);
    const dw = (2 * f * fp) / (2 * fp * fp - f * fpp);
    w -= dw;
    if (w <= 0) w = 1e-300;
    if (Math.abs(dw) <= 1e-15 * Math.max(1, Math.abs(w))) break;
  }
  return w;
}

/** Robust bisection root of a monotone scalar function on [lo, hi]. */
export function bisect(f: (x: number) => number, lo: number, hi: number, tol = 1e-15): number {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo * fhi > 0) throw new Error(`bisect: no sign change on [${lo}, ${hi}]`);
  for (let k = 0; k < 400; k++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fm * flo < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
    if (hi - lo <= tol * Math.max(1, Math.abs(mid))) break;
  }
  return 0.5 * (lo + hi);
}

/** Linear interpolation y(x0) on an ascending x. */
export function interp(x: ArrayLike<number>, y: ArrayLike<number>, x0: number): number {
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
  const t = (x0 - x[lo]) / (x[hi] - x[lo]);
  return y[lo] + t * (y[hi] - y[lo]);
}

/** Complex value of an AC vector at index i. */
export function cAt(v: Vector, i: number): { re: number; im: number } {
  return { re: v.re[i], im: v.im ? v.im[i] : 0 };
}

export function cAbs(c: { re: number; im: number }): number {
  return Math.hypot(c.re, c.im);
}

export function cArgDeg(c: { re: number; im: number }): number {
  return (Math.atan2(c.im, c.re) * 180) / Math.PI;
}

/** Index of the sample nearest to x0. */
export function nearest(x: ArrayLike<number>, x0: number): number {
  let best = 0;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - x0) < Math.abs(x[best] - x0)) best = i;
  return best;
}

/** Interpolated crossing times of y through `level`. */
export function crossTimes(x: ArrayLike<number>, y: ArrayLike<number>, level: number, dir: 'rise' | 'fall'): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) {
    const a = y[i - 1] - level;
    const b = y[i] - level;
    if ((dir === 'rise' && a < 0 && b >= 0) || (dir === 'fall' && a > 0 && b <= 0)) {
      out.push(x[i - 1] + ((x[i] - x[i - 1]) * a) / (a - b));
    }
  }
  return out;
}

/** Relative difference |a-b|/|b|. */
export function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}
