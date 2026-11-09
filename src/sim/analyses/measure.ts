/**
 * Scalar measurements on analysis results (MeasureSpec of src/sim/netlist.ts), used by Monte
 * Carlo and worst-case analyses and available to the UI.
 *
 * The measured quantity is the vector named `output` (case-insensitive; a bare node name "out"
 * also matches "V(out)"), or — for results without vectors of that name — the scalar of that
 * name (operating point values, TF gain, Fourier THD, ...). Complex (AC) vectors are measured on
 * their magnitude. Functions:
 *   max, min, pp (max − min), final (last sample),
 *   avg, rms      time/scale-weighted (trapezoidal rule) when the result has a scale with at
 *                 least two increasing points, arithmetic otherwise,
 *   at            value at scale = `at` (linear interpolation; required),
 *   rise_edge     first scale value where the output crosses `threshold` upwards
 *   fall_edge     first scale value where it crosses `threshold` downwards
 *                 (threshold default: the midpoint between min and max; NaN when no crossing),
 *   freq_at_max   scale value (e.g. frequency) of the maximum.
 * A result carrying `error` measures as NaN.
 */
import type { MeasureSpec } from '../netlist';
import { SimulationError, findVector, type AnalysisResult } from '../results';
import { magnitudes, weightedStats } from './util';

/** Name of a measurement for tables / vectors, e.g. "max(V(out))". */
export function measureName(m: MeasureSpec): string {
  const arg = m.func === 'at' ? `@${m.at}` : (m.func === 'rise_edge' || m.func === 'fall_edge') && m.threshold !== undefined ? `@${m.threshold}` : '';
  return `${m.func}${arg}(${m.output})`;
}

function series(result: AnalysisResult, output: string): { v: Float64Array; t?: Float64Array } {
  const vec = findVector(result, output) ?? (/[()]/.test(output) ? undefined : findVector(result, `V(${output.trim()})`));
  if (vec) {
    const scale = result.scale && result.scale.re.length === vec.re.length ? result.scale.re : undefined;
    return { v: magnitudes(vec.re, vec.im), t: scale };
  }
  const scalars = result.scalars ?? {};
  const key = Object.keys(scalars).find((k) => k.toLowerCase() === output.trim().toLowerCase());
  if (key !== undefined) return { v: Float64Array.of(scalars[key]) };
  throw new SimulationError(`Measure: output '${output}' not found in the ${result.title.toLowerCase()} result`, 'netlist');
}

function crossing(v: Float64Array, t: Float64Array | undefined, level: number, rising: boolean): number {
  for (let k = 1; k < v.length; k++) {
    const a = v[k - 1] - level;
    const b = v[k] - level;
    const hit = rising ? a < 0 && b >= 0 : a > 0 && b <= 0;
    if (!hit) continue;
    const frac = a / (a - b);
    if (!t) return k - 1 + frac;
    return t[k - 1] + frac * (t[k] - t[k - 1]);
  }
  return Number.NaN;
}

function interpolateAt(v: Float64Array, t: Float64Array, x: number): number {
  const n = v.length;
  if (n === 0) return Number.NaN;
  const increasing = t[n - 1] >= t[0];
  const lo0 = increasing ? t[0] : t[n - 1];
  const hi0 = increasing ? t[n - 1] : t[0];
  if (x < lo0 - 1e-12 * Math.abs(hi0 - lo0) || x > hi0 + 1e-12 * Math.abs(hi0 - lo0)) return Number.NaN;
  for (let k = 1; k < n; k++) {
    const a = t[k - 1];
    const b = t[k];
    if ((x >= a && x <= b) || (x <= a && x >= b)) {
      return b === a ? v[k] : v[k - 1] + ((v[k] - v[k - 1]) * (x - a)) / (b - a);
    }
  }
  return n === 1 ? v[0] : Number.NaN;
}

/** Evaluate a measurement on a result (NaN when the result failed). */
export function measureResult(result: AnalysisResult, m: MeasureSpec): number {
  if (result.error !== undefined) return Number.NaN;
  const { v, t } = series(result, m.output);
  if (v.length === 0) return Number.NaN;
  let max = -Infinity;
  let min = Infinity;
  let kMax = 0;
  for (let k = 0; k < v.length; k++) {
    if (v[k] > max) {
      max = v[k];
      kMax = k;
    }
    if (v[k] < min) min = v[k];
  }
  switch (m.func) {
    case 'max':
      return max;
    case 'min':
      return min;
    case 'pp':
      return max - min;
    case 'final':
      return v[v.length - 1];
    case 'avg':
      return weightedStats(v, t).mean;
    case 'rms':
      return weightedStats(v, t).rms;
    case 'at': {
      if (m.at === undefined || !Number.isFinite(m.at)) throw new SimulationError("Measure 'at' needs a finite 'at' value", 'netlist');
      if (!t) return v.length === 1 ? v[0] : Number.NaN;
      return interpolateAt(v, t, m.at);
    }
    case 'rise_edge':
    case 'fall_edge':
      return crossing(v, t, m.threshold ?? (max + min) / 2, m.func === 'rise_edge');
    case 'freq_at_max':
      return t ? t[kMax] : kMax;
    default:
      throw new SimulationError(`Measure: unknown function '${String((m as { func: unknown }).func)}'`, 'netlist');
  }
}
