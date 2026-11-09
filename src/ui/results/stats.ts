/**
 * Descriptive statistics and histograms (Monte Carlo / worst-case reporting).
 * Pure functions; NaN and infinite samples are ignored.
 */

export interface SampleStats {
  n: number;
  mean: number;
  /** sample standard deviation (n - 1 denominator; 0 for n = 1) */
  std: number;
  min: number;
  max: number;
  median: number;
  /** first and third quartiles (linear interpolation between order statistics) */
  q1: number;
  q3: number;
}

function finite(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) out.push(values[i]);
  return out;
}

/** Quantile (0..1) of an ascending-sorted array, linear interpolation (type 7). */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function describeSamples(values: ArrayLike<number>): SampleStats {
  const v = finite(values).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) {
    return { n: 0, mean: Number.NaN, std: Number.NaN, min: Number.NaN, max: Number.NaN, median: Number.NaN, q1: Number.NaN, q3: Number.NaN };
  }
  let sum = 0;
  for (const x of v) sum += x;
  const mean = sum / n;
  let ss = 0;
  for (const x of v) ss += (x - mean) * (x - mean);
  return {
    n,
    mean,
    std: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
    min: v[0],
    max: v[n - 1],
    median: quantileSorted(v, 0.5),
    q1: quantileSorted(v, 0.25),
    q3: quantileSorted(v, 0.75),
  };
}

export interface Histogram {
  /** bin edges, length = counts.length + 1 */
  edges: number[];
  counts: number[];
}

/**
 * Equal-width histogram. Default bin count follows Sturges' rule ceil(log2 n) + 1.
 * The last bin is closed on the right so the maximum sample is counted.
 */
export function histogram(values: ArrayLike<number>, bins?: number): Histogram {
  const v = finite(values);
  if (v.length === 0) return { edges: [], counts: [] };
  let min = Infinity;
  let max = -Infinity;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const k = Math.max(1, Math.floor(bins ?? Math.ceil(Math.log2(v.length)) + 1));
  if (min === max) {
    const d = min === 0 ? 0.5 : Math.abs(min) * 0.05;
    min -= d;
    max += d;
  }
  const width = (max - min) / k;
  const edges = Array.from({ length: k + 1 }, (_, i) => (i === k ? max : min + i * width));
  const counts = new Array<number>(k).fill(0);
  for (const x of v) {
    const idx = Math.min(k - 1, Math.floor((x - min) / width));
    counts[idx]++;
  }
  return { edges, counts };
}
