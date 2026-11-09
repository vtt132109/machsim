/**
 * Preferred-number series (IEC 60063 E-series) used by the passive-part catalogue and by the
 * value picker of resistance / capacitance / inductance parameters.
 *
 * E3…E24 are the standard two-digit tables; E48, E96 and E192 are 10^(i/n) rounded to three
 * significant digits, with the one documented exception of E192 (9.19 instead of 9.20).
 */
import type { ESeriesName } from './types';

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

function threeDigit(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Number(Math.pow(10, i / n).toPrecision(3)));
  if (n === 192) out[out.indexOf(9.2)] = 9.19;
  return out;
}

const TABLES: Record<ESeriesName, number[]> = {
  E3: [1.0, 2.2, 4.7],
  E6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  E24,
  E48: threeDigit(48),
  E96: threeDigit(96),
  E192: threeDigit(192),
};

export const E_SERIES_NAMES: readonly ESeriesName[] = ['E3', 'E6', 'E12', 'E24', 'E48', 'E96', 'E192'];

/** Mantissas (1 ≤ m < 10) of a series. */
export function seriesMantissas(series: ESeriesName): readonly number[] {
  return TABLES[series];
}

/** Round to 3 significant digits after the decade scaling (removes 4.7e3 → 4699.999… noise). */
const clean = (v: number): number => Number(v.toPrecision(3));

/** Every series value from `min` to `max` inclusive (both > 0). */
export function seriesValues(series: ESeriesName, min: number, max: number): number[] {
  if (!(min > 0 && max >= min)) return [];
  const out: number[] = [];
  const m = TABLES[series];
  for (let d = Math.floor(Math.log10(min)) - 1; d <= Math.ceil(Math.log10(max)); d++) {
    const scale = Math.pow(10, d);
    for (const x of m) {
      const v = clean(x * scale);
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  }
  return out;
}

/** The series value nearest to `v` on a logarithmic scale. */
export function nearestSeriesValue(series: ESeriesName, v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  const d = Math.floor(Math.log10(v));
  let best = v;
  let err = Infinity;
  for (const dd of [d - 1, d, d + 1]) {
    for (const x of TABLES[series]) {
      const c = clean(x * Math.pow(10, dd));
      const e = Math.abs(Math.log(c / v));
      if (e < err) {
        err = e;
        best = c;
      }
    }
  }
  return best;
}

/** Tolerance usually sold with a series (E6 20 %, E12 10 %, E24 5 %, E48 2 %, E96 1 %, E192 0.5 %). */
export function seriesTolerance(series: ESeriesName): number {
  return { E3: 40, E6: 20, E12: 10, E24: 5, E48: 2, E96: 1, E192: 0.5 }[series];
}
