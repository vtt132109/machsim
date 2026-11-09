import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import type { AnalysisSpec, ElementIR } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { cap, netlist, res, vsrc } from '../engine/testing';
import { harmonicSpectrum, resampleUniform } from './fourier';

function four(elements: ElementIR[], spec: Partial<Extract<AnalysisSpec, { type: 'four' }>>): AnalysisResult {
  const full: AnalysisSpec = { type: 'four', fundamental: 1e3, harmonics: 9, outputs: ['V(in)'], ...spec };
  const [r] = runAnalyses(netlist(elements, [full]));
  expect(r.error).toBeUndefined();
  return r;
}

describe('harmonic spectrum (DFT)', () => {
  it('recovers amplitudes, sine-referenced phases and THD of a synthetic signal', () => {
    const N = 128;
    const x = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const th = (2 * Math.PI * n) / N;
      x[n] = 0.5 + 2 * Math.sin(th + Math.PI / 6) + 0.1 * Math.sin(3 * th - Math.PI / 3);
    }
    const s = harmonicSpectrum(x, 5);
    expect(s.dc).toBeCloseTo(0.5, 13);
    expect(s.magnitude[1]).toBeCloseTo(2, 13);
    expect(s.phase[1]).toBeCloseTo(30, 11);
    expect(s.magnitude[2]).toBeCloseTo(0, 13);
    expect(s.magnitude[3]).toBeCloseTo(0.1, 13);
    expect(s.phase[3]).toBeCloseTo(-60, 10);
    expect(s.normalized[3]).toBeCloseTo(0.05, 13);
    expect(s.normalizedPhase[3]).toBeCloseTo(-90, 10);
    expect(s.thd).toBeCloseTo(5, 11);
  });

  it('rejects too few samples for the requested harmonics', () => {
    expect(() => harmonicSpectrum(new Float64Array(8), 4)).toThrow(/harmonics/);
  });
});

describe('monotone resampling', () => {
  it('interpolates a smooth waveform on a non-uniform grid accurately', () => {
    const t: number[] = [];
    let x = 0;
    let k = 0;
    while (x <= 1.02) {
      t.push(x);
      x += 0.01 * (1 + 0.5 * Math.sin(k++));
    }
    const v = t.map((ti) => Math.sin(2 * Math.PI * ti));
    const out = resampleUniform(t, v, 0, 1 / 64, 64);
    let maxErr = 0;
    for (let q = 0; q < 64; q++) maxErr = Math.max(maxErr, Math.abs(out[q] - Math.sin((2 * Math.PI * q) / 64)));
    expect(maxErr).toBeLessThan(2e-5);
    // at the density the Fourier analysis uses (steps <= T/256) the error is far smaller
    const tf: number[] = [];
    for (let x2 = 0, j = 0; x2 <= 1.01; j++) {
      tf.push(x2);
      x2 += (1 / 256) * (0.6 + 0.4 * Math.abs(Math.sin(j)));
    }
    const fine = resampleUniform(tf, tf.map((ti) => Math.sin(2 * Math.PI * ti)), 0, 1 / 64, 64);
    let fineErr = 0;
    for (let q = 0; q < 64; q++) fineErr = Math.max(fineErr, Math.abs(fine[q] - Math.sin((2 * Math.PI * q) / 64)));
    expect(fineErr).toBeLessThan(5e-7);
  });

  it('does not overshoot at a step', () => {
    const t = [0, 1, 2, 2.001, 3, 4];
    const v = [0, 0, 0, 1, 1, 1];
    const out = resampleUniform(t, v, 0, 0.01, 400);
    for (const y of out) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe('Fourier analysis', () => {
  it('measures a pure sine with negligible distortion', () => {
    const r = four([vsrc('V1', 'in', '0', { tran: { type: 'SIN', args: [0, 1, 1e3] } }), res('R1', 'in', '0', 1e3)], {});
    const mag = findVector(r, 'V(in)')?.re as Float64Array;
    const ph = findVector(r, 'phase(V(in))')?.re as Float64Array;
    expect(r.scalars?.thd as number).toBeLessThan(0.1);
    expect(r.scalars?.thd as number).toBeLessThan(1e-3);
    expect(Math.abs(mag[1] - 1)).toBeLessThan(1e-5);
    expect(Math.abs(ph[1])).toBeLessThan(1e-3);
    expect(Math.abs(r.scalars?.dc as number)).toBeLessThan(1e-6);
    expect(r.scale?.re[3]).toBe(3e3);
    expect(r.runs?.[0].result.vectors[0].re.length).toBe(256);
    expect(r.warnings).toEqual([]);
  });

  it('warns when the analysed period is not yet periodic', () => {
    // time constant 10 ms against a 1 ms period: the start-up transient is still decaying
    const els = [vsrc('V1', 'in', '0', { tran: { type: 'SIN', args: [0, 1, 1e3] } }), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-5)];
    const r = four(els, { outputs: ['V(out)'], settleCycles: 2 });
    expect(r.warnings.some((w) => /periodic steady state/.test(w) && /V\(out\)/.test(w))).toBe(true);
    const settled = four(els, { outputs: ['V(out)'], settleCycles: 200, samples: 64, harmonics: 3 });
    expect(settled.warnings).toEqual([]);
  });

  it('shows the gain and phase of an RC filter at its corner frequency', () => {
    const R = 1e3;
    const C = 1 / (2 * Math.PI * 1e3 * R);
    const r = four([vsrc('V1', 'in', '0', { tran: { type: 'SIN', args: [0, 1, 1e3] } }), res('R1', 'in', 'out', R), cap('C1', 'out', '0', C)], {
      outputs: ['V(out)'],
      settleCycles: 5,
    });
    const mag = findVector(r, 'V(out)')?.re as Float64Array;
    const ph = findVector(r, 'phase(V(out))')?.re as Float64Array;
    expect(Math.abs(mag[1] - Math.SQRT1_2)).toBeLessThan(5e-5);
    expect(Math.abs(ph[1] + 45)).toBeLessThan(0.01);
    expect(r.scalars?.['THD(V(out))'] as number).toBeLessThan(1e-3);
  });

  it('finds the odd harmonics of a square wave in 1/n ratios', () => {
    const T = 1e-3;
    const N = 1000;
    const tr = T / N;
    const r = four([vsrc('V1', 'in', '0', { tran: { type: 'PULSE', args: [-1, 1, 0, tr, tr, T / 2 - tr, T] } }), res('R1', 'in', '0', 1e3)], {
      samples: N,
      harmonics: 9,
      settleCycles: 1,
    });
    const norm = findVector(r, 'norm(V(in))')?.re as Float64Array;
    const mag = findVector(r, 'V(in)')?.re as Float64Array;
    // a ±1 sequence with N/2 samples of each sign: M_k/M_1 = sin(π/N)/sin(πk/N) for odd k
    for (const k of [3, 5, 7, 9]) {
      expect(Math.abs(norm[k] / (Math.sin(Math.PI / N) / Math.sin((Math.PI * k) / N)) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(norm[k] * k - 1)).toBeLessThan(2e-4);
      expect(Math.abs(mag[k] / (4 / (k * Math.PI)) - 1)).toBeLessThan(2e-4);
    }
    for (const k of [2, 4, 6, 8]) expect(norm[k]).toBeLessThan(1e-9);
    expect(Math.abs(mag[1] / (4 / Math.PI) - 1)).toBeLessThan(1e-5);
    // THD of a square wave truncated at the 9th harmonic: sqrt(1/9 + 1/25 + 1/49 + 1/81)
    expect(r.scalars?.thd as number).toBeCloseTo(100 * Math.sqrt(1 / 9 + 1 / 25 + 1 / 49 + 1 / 81), 1);
    expect(r.table?.rows.length).toBe(10);
  });

  it('reports invalid settings as errors', () => {
    const [a, b] = runAnalyses(
      netlist(
        [vsrc('V1', 'in', '0', { dc: 1 }), res('R1', 'in', '0', 1)],
        [
          { type: 'four', fundamental: 0, harmonics: 3, outputs: ['V(in)'] },
          { type: 'four', fundamental: 1e3, harmonics: 3, outputs: ['V(nowhere)'] },
        ],
      ),
    );
    expect(a.error).toMatch(/fundamental/);
    expect(b.error).toMatch(/nowhere/);
  });
});
