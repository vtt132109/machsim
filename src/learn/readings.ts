/**
 * Readings of a lesson `measure` step that is NOT an operating point (round 4 step 3): a transient
 * measured like a `.meas` card (value at a time, peak, minimum, peak-to-peak, RMS, mean, frequency)
 * and an AC phasor at one frequency (magnitude, dB, phase).
 *
 *   const r = transientReading(result, 'OUT', '0', { kind: 'tran', tstop: 5e-3, reading: 'rms', from: 1e-3 })
 *   const v = acReading(phasorBetween(acResult, 'OUT', '0')!, 'phase')
 *
 * The transient readings are evaluated by the same engine as a `.meas` directive
 * (src/sim/analyses/meas.ts), so a lesson step and a `.meas` card in the learner's circuit agree to
 * the last digit. Pure: no DOM, no simulator.
 */
import type { MeasDirective } from '../sim/netlist';
import { measureResult } from '../sim/analyses/meas';
import type { AnalysisResult } from '../sim/results';

/** What a transient step reads from the waveform. */
export const TRAN_READINGS = ['final', 'at', 'peak', 'min', 'pp', 'rms', 'mean', 'frequency'] as const;
export type TranReading = (typeof TRAN_READINGS)[number];

/** What an AC step reads from the phasor. */
export const AC_READINGS = ['mag', 'db', 'phase'] as const;
export type AcReading = (typeof AC_READINGS)[number];

/** The analysis a `measure` step runs. No analysis = the operating point (every older lesson file). */
export type LessonAnalysis =
  | { kind: 'op' }
  /** a transient to `tstop` seconds; `at` (reading 'at') and `from` (the window start of the others) are seconds */
  | { kind: 'tran'; tstop: number; reading: TranReading; at?: number; from?: number }
  /** the phasor at one frequency in hertz */
  | { kind: 'ac'; freq: number; reading: AcReading };

/** Unit the feedback shows for a reading when the step gives none. */
export function readingUnit(a: LessonAnalysis): string {
  if (a.kind === 'ac') return a.reading === 'db' ? 'dB' : a.reading === 'phase' ? '°' : 'V';
  if (a.kind === 'tran') return a.reading === 'frequency' ? 'Hz' : 'V';
  return 'V';
}

/** Expression of a voltage: V(a) against ground, V(a,b) otherwise. */
export function voltageExpr(pos: string, neg: string): string {
  return neg === '0' ? `V(${pos})` : `V(${pos},${neg})`;
}

const DIRECTIVE: Record<Exclude<TranReading, 'frequency'>, MeasDirective['kind']> = {
  final: 'find',
  at: 'find',
  peak: 'max',
  min: 'min',
  pp: 'pp',
  rms: 'rms',
  mean: 'avg',
};

/** Samples of V(pos) − V(neg) of a transient result (ground is zero); null when a node has no vector. */
export function waveBetween(result: AnalysisResult, pos: string, neg: string): Float64Array | null {
  const n = result.scale?.re.length ?? 0;
  const of = (node: string): Float64Array | null => {
    if (node === '0') return new Float64Array(n);
    return result.vectors.find((x) => x.name.toLowerCase() === `v(${node.toLowerCase()})`)?.re ?? null;
  };
  const a = of(pos);
  const b = of(neg);
  if (!a || !b) return null;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = a[k] - b[k];
  return out;
}

/** A reading of V(pos) − V(neg) in a transient result; NaN with `error` when it cannot be taken. */
export function transientReading(result: AnalysisResult, pos: string, neg: string, a: Extract<LessonAnalysis, { kind: 'tran' }>): { value: number; error?: string } {
  const time = result.scale?.re;
  if (!time || time.length < 2) return { value: Number.NaN, error: 'no samples' };
  if (a.reading === 'frequency') {
    const wave = waveBetween(result, pos, neg);
    return wave ? frequencyReading(time, wave, a.from ?? 0, result, voltageExpr(pos, neg)) : { value: Number.NaN, error: 'no such signal' };
  }
  const end = time[time.length - 1];
  const expr = voltageExpr(pos, neg);
  const d: MeasDirective = { analysis: 'tran', name: 'lesson', kind: DIRECTIVE[a.reading], expr };
  if (a.reading === 'final') d.at = end;
  else if (a.reading === 'at') d.at = Math.min(Math.max(a.at ?? 0, time[0]), end);
  else if (a.from !== undefined && a.from > 0) d.from = a.from;
  const [m] = measureResult(result, [d]);
  return m ? { value: m.value, ...(m.error ? { error: m.error } : {}) } : { value: Number.NaN, error: 'not measured' };
}

/**
 * Frequency of a waveform: the rising crossings of its mean level from `from` on, (n − 1) periods
 * over the span between the first and the last crossing. Needs two crossings, so a signal that does
 * not repeat in the window reads as an error instead of 0 Hz.
 */
function frequencyReading(time: Float64Array, wave: Float64Array, from: number, result: AnalysisResult, expr: string): { value: number; error?: string } {
  const mean = measureResult(result, [{ analysis: 'tran', name: 'level', kind: 'avg', expr, ...(from > 0 ? { from } : {}) }])[0];
  if (!mean || !Number.isFinite(mean.value)) return { value: Number.NaN, error: mean?.error ?? 'no mean level' };
  const level = mean.value;
  const times: number[] = [];
  for (let k = 1; k < time.length; k++) {
    if (time[k] < from) continue;
    if (wave[k - 1] < level && wave[k] >= level) {
      const w = (level - wave[k - 1]) / (wave[k] - wave[k - 1] || 1);
      times.push(time[k - 1] + w * (time[k] - time[k - 1]));
    }
  }
  if (times.length < 2) return { value: Number.NaN, error: 'the signal does not repeat in the window' };
  return { value: (times.length - 1) / (times[times.length - 1] - times[0]) };
}

/** One phasor from the real and imaginary parts of a single-frequency AC result. */
export interface Phasor {
  re: number;
  im: number;
}

/** V(pos) − V(neg) of a single-frequency AC result (ground, or a missing vector of ground, is 0). */
export function phasorBetween(result: AnalysisResult, pos: string, neg: string): Phasor | null {
  const at = (node: string): Phasor | null => {
    if (node === '0') return { re: 0, im: 0 };
    const v = result.vectors.find((x) => x.name.toLowerCase() === `v(${node.toLowerCase()})`);
    return v ? { re: v.re[0], im: v.im ? v.im[0] : 0 } : null;
  };
  const a = at(pos);
  const b = at(neg);
  return a && b ? { re: a.re - b.re, im: a.im - b.im } : null;
}

/** Magnitude, dB (re 1 V) or phase in degrees of a phasor. */
export function acReading(p: Phasor, reading: AcReading): number {
  const mag = Math.hypot(p.re, p.im);
  if (reading === 'mag') return mag;
  if (reading === 'db') return 20 * Math.log10(Math.max(mag, 1e-300));
  return (Math.atan2(p.im, p.re) * 180) / Math.PI;
}
