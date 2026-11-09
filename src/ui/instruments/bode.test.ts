import { describe, expect, it } from 'vitest';
import type { AnalysisResult, Vector } from '../../sim/results';
import { bodeAnalysisSpec, bodeFromComplex, bodeTransfer, crossingFrequency, interpolateCurve } from './bode';

function logFreqs(f0: number, f1: number, perDecade: number): Float64Array {
  const n = Math.round(Math.log10(f1 / f0) * perDecade) + 1;
  return new Float64Array(n).map((_, i) => f0 * 10 ** (i / perDecade));
}

function complexVector(name: string, re: Float64Array, im: Float64Array): Vector {
  return { name, unit: 'V', re, im };
}

/**
 * AC result of a circuit with input V(a) - V(b) = 2∠30° (a floating differential source) and
 * output V(out) = H(f) * (V(a) - V(b)) where H is an n-th order low pass with corner fc.
 */
function lowPassResult(order: number, fc: number): AnalysisResult {
  const f = logFreqs(1, 1e6, 50);
  const n = f.length;
  const vin = { re: 2 * Math.cos(Math.PI / 6), im: 2 * Math.sin(Math.PI / 6) };
  const aRe = new Float64Array(n).fill(vin.re + 0.5);
  const aIm = new Float64Array(n).fill(vin.im);
  const bRe = new Float64Array(n).fill(0.5);
  const bIm = new Float64Array(n);
  const oRe = new Float64Array(n);
  const oIm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // H = 1 / (1 + j f/fc)^order
    let hr = 1;
    let hi = 0;
    for (let k = 0; k < order; k++) {
      const d = 1 + (f[i] / fc) ** 2;
      const pr = 1 / d;
      const pi = -(f[i] / fc) / d;
      const r = hr * pr - hi * pi;
      hi = hr * pi + hi * pr;
      hr = r;
    }
    oRe[i] = hr * vin.re - hi * vin.im;
    oIm[i] = hr * vin.im + hi * vin.re;
  }
  return {
    type: 'ac',
    title: 'AC analysis',
    spec: { type: 'ac', sweep: 'dec', points: 50, fstart: 1, fstop: 1e6 },
    scale: { name: 'frequency', unit: 'Hz', re: f },
    vectors: [complexVector('V(a)', aRe, aIm), complexVector('V(B)', bRe, bIm), complexVector('V(out)', oRe, oIm)],
    warnings: [],
  };
}

describe('Bode plotter transfer function', () => {
  it('computes H = V(OUT+,OUT-) / V(IN+,IN-) of a first-order low pass', () => {
    const ac = lowPassResult(1, 1000);
    const b = bodeTransfer(ac, { kind: 'voltage', pos: 'a', neg: 'b' }, { kind: 'voltage', pos: 'out', neg: '0' })!;
    expect(b).not.toBeNull();
    const i1k = Array.from(b.freq).findIndex((x) => Math.abs(x - 1000) < 1e-6);
    expect(b.db[0]).toBeCloseTo(0, 5);
    expect(b.db[i1k]).toBeCloseTo(-10 * Math.log10(2), 9);
    expect(b.phase[i1k]).toBeCloseTo(-45, 9);
    expect(b.mag[i1k]).toBeCloseTo(Math.SQRT1_2, 12);
    // -3.0103 dB corner found by log interpolation
    expect(crossingFrequency(b.freq, b.db, -10 * Math.log10(2))).toBeCloseTo(1000, 3);
    // 20 dB/decade roll-off far above the corner
    const i100k = Array.from(b.freq).findIndex((x) => Math.abs(x - 1e5) < 1e-3);
    expect(b.db[i100k]).toBeCloseTo(-40, 2);
  });

  it('unwraps the phase of a third-order section beyond -180 degrees', () => {
    const ac = lowPassResult(3, 100);
    const b = bodeTransfer(ac, { kind: 'voltage', pos: 'a', neg: 'b' }, { kind: 'voltage', pos: 'out', neg: '0' })!;
    const last = b.phase[b.phase.length - 1];
    expect(last).toBeLessThan(-269);
    expect(last).toBeGreaterThan(-270);
    for (let i = 1; i < b.phase.length; i++) expect(Math.abs(b.phase[i] - b.phase[i - 1])).toBeLessThan(10);
    // phase crossover of -180 deg: 3 atan(f/fc) = 180 -> f = fc * tan(60 deg)
    expect(crossingFrequency(b.freq, b.phase, -180)).toBeCloseTo(100 * Math.tan(Math.PI / 3), 0);
  });

  it('returns null when a node is missing or there is no scale', () => {
    const ac = lowPassResult(1, 1000);
    expect(bodeTransfer(ac, { kind: 'voltage', pos: 'nope', neg: '0' }, { kind: 'voltage', pos: 'out', neg: '0' })).toBeNull();
    expect(bodeTransfer({ ...ac, scale: undefined }, { kind: 'voltage', pos: 'a', neg: '0' }, { kind: 'voltage', pos: 'out', neg: '0' })).toBeNull();
  });

  it('builds data from complex samples and interpolates curves', () => {
    const b = bodeFromComplex(Float64Array.of(10, 100), Float64Array.of(0, -10), Float64Array.of(1, 0));
    expect(Array.from(b.db)).toEqual([0, 20]);
    expect(b.phase[0]).toBeCloseTo(90, 12);
    // 90 -> 180 is continuous (no wrap)
    expect(b.phase[1]).toBeCloseTo(180, 12);
    expect(interpolateCurve([10, 1000], [0, 20], 100, true)).toBeCloseTo(10, 12);
    expect(interpolateCurve([10, 1000], [0, 20], 100, false)).toBeCloseTo((90 / 990) * 20, 12);
    expect(Number.isNaN(interpolateCurve([10, 1000], [0, 20], 5))).toBe(true);
  });

  it('derives the AC sweep from the panel settings', () => {
    expect(bodeAnalysisSpec({ fstart: '10', fstop: '1meg', points: '25' })).toEqual({ type: 'ac', sweep: 'dec', points: 25, fstart: 10, fstop: 1e6 });
    // invalid values fall back to sane defaults
    expect(bodeAnalysisSpec({ fstart: '-5', fstop: '1', points: 'x' })).toEqual({ type: 'ac', sweep: 'dec', points: 100, fstart: 1, fstop: 1e9 });
  });
});
