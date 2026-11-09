import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../results';
import { measureName, measureResult } from './measure';

function tran(t: number[], v: number[], im?: number[]): AnalysisResult {
  return {
    type: 'tran',
    title: 'Transient analysis',
    scale: { name: 'time', unit: 's', re: Float64Array.from(t) },
    vectors: [{ name: 'V(out)', unit: 'V', re: Float64Array.from(v), im: im ? Float64Array.from(im) : undefined }],
    warnings: [],
  };
}

describe('measurements', () => {
  // ramp 0 -> 2 over [0, 1], then flat at 2 until t = 3 (non-uniform sampling)
  const r = tran([0, 0.5, 1, 2, 3], [0, 1, 2, 2, 2]);

  it('computes extrema, final value and peak-to-peak', () => {
    expect(measureResult(r, { output: 'V(out)', func: 'max' })).toBe(2);
    expect(measureResult(r, { output: 'V(out)', func: 'min' })).toBe(0);
    expect(measureResult(r, { output: 'V(out)', func: 'pp' })).toBe(2);
    expect(measureResult(r, { output: 'v(OUT)', func: 'final' })).toBe(2);
    expect(measureResult(r, { output: 'out', func: 'final' })).toBe(2);
  });

  it('weights averages and RMS by the scale', () => {
    // integral = 1 (ramp) + 4 (flat) = 5 over 3 s
    expect(measureResult(r, { output: 'V(out)', func: 'avg' })).toBeCloseTo(5 / 3, 14);
    // ∫v² with the trapezoidal rule: ramp segments 0.25 + 1.25, flat 8 -> 9.5 / 3
    expect(measureResult(r, { output: 'V(out)', func: 'rms' })).toBeCloseTo(Math.sqrt(9.5 / 3), 14);
  });

  it('interpolates values and edge crossings', () => {
    expect(measureResult(r, { output: 'V(out)', func: 'at', at: 0.25 })).toBeCloseTo(0.5, 14);
    expect(measureResult(r, { output: 'V(out)', func: 'at', at: 2.5 })).toBe(2);
    expect(Number.isNaN(measureResult(r, { output: 'V(out)', func: 'at', at: 7 }))).toBe(true);
    expect(measureResult(r, { output: 'V(out)', func: 'rise_edge', threshold: 1.5 })).toBeCloseTo(0.75, 14);
    // default threshold: midpoint 1
    expect(measureResult(r, { output: 'V(out)', func: 'rise_edge' })).toBeCloseTo(0.5, 14);
    expect(Number.isNaN(measureResult(r, { output: 'V(out)', func: 'fall_edge', threshold: 1 }))).toBe(true);
    const pulse = tran([0, 1, 2, 3], [0, 4, 4, 0]);
    expect(measureResult(pulse, { output: 'V(out)', func: 'fall_edge', threshold: 1 })).toBeCloseTo(2.75, 14);
    expect(() => measureResult(r, { output: 'V(out)', func: 'at' })).toThrow(/at/);
  });

  it('uses magnitudes of complex vectors and finds the frequency of the maximum', () => {
    const ac: AnalysisResult = {
      type: 'ac',
      title: 'AC analysis',
      scale: { name: 'frequency', unit: 'Hz', re: Float64Array.from([10, 100, 1000]) },
      vectors: [{ name: 'V(out)', unit: 'V', re: Float64Array.from([0.3, 0, 0.1]), im: Float64Array.from([0.4, 2, 0]) }],
      warnings: [],
    };
    expect(measureResult(ac, { output: 'V(out)', func: 'max' })).toBe(2);
    expect(measureResult(ac, { output: 'V(out)', func: 'min' })).toBeCloseTo(0.1, 15);
    expect(measureResult(ac, { output: 'V(out)', func: 'freq_at_max' })).toBe(100);
  });

  it('falls back to scalars and returns NaN for failed results', () => {
    const tf: AnalysisResult = { type: 'tf', title: 'Transfer function', vectors: [], scalars: { gain: 0.75 }, warnings: [] };
    expect(measureResult(tf, { output: 'GAIN', func: 'final' })).toBe(0.75);
    expect(() => measureResult(tf, { output: 'rin', func: 'final' })).toThrow(/rin/);
    expect(Number.isNaN(measureResult({ ...tf, error: 'failed' }, { output: 'gain', func: 'final' }))).toBe(true);
  });

  it('names measurements', () => {
    expect(measureName({ output: 'V(out)', func: 'max' })).toBe('max(V(out))');
    expect(measureName({ output: 'V(out)', func: 'at', at: 0.001 })).toBe('at@0.001(V(out))');
  });
});
