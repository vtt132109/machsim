/**
 * Extra signal sources produce the waveforms their descriptions promise (values at given times,
 * frequencies from zero crossings, noise RMS from the Johnson formula).
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import { BOLTZ } from '../../sim/device';
import type { AnalysisResult } from '../../sim/results';
import { parseDataFile } from './sources';

function tran(partId: string, params: Record<string, string>, tstop: number, tstep: number, extra?: (b: DesignBuilder, h: ReturnType<DesignBuilder['part']>) => void): AnalysisResult {
  const b = new DesignBuilder('src');
  const h = b.part(partId, 'V1', 0, 0, params);
  if (extra) extra(b, h);
  else {
    b.labelPin(h, '+', 'OUT');
    b.labelPin(h, '-', '0');
  }
  const r = b.part('basic/resistor', 'RL', 300, 0, { value: '1meg' });
  b.labelPin(r, '1', 'OUT');
  b.labelPin(r, '2', '0');
  const build = buildNetlist(b.design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep, tstop, tmax: tstep }] });
  expect(res.error).toBeUndefined();
  return res;
}

const series = (r: AnalysisResult, name = 'V(OUT)') => ({ t: r.scale!.re, v: r.vectors.find((x) => x.name === name)!.re });
const at = (s: { t: Float64Array; v: Float64Array }, x: number) => {
  const i = s.t.findIndex((y) => y >= x);
  if (i <= 0) return s.v[Math.max(0, i)];
  const f = (x - s.t[i - 1]) / (s.t[i] - s.t[i - 1]);
  return s.v[i - 1] + f * (s.v[i] - s.v[i - 1]);
};
/** Rising zero crossings (linear interpolation). */
function crossings(s: { t: Float64Array; v: Float64Array }, level = 0, from = 0): number[] {
  const out: number[] = [];
  for (let i = 1; i < s.v.length; i++) {
    if (s.t[i] < from) continue;
    if (s.v[i - 1] < level && s.v[i] >= level) out.push(s.t[i - 1] + ((level - s.v[i - 1]) / (s.v[i] - s.v[i - 1])) * (s.t[i] - s.t[i - 1]));
  }
  return out;
}

describe('periodic and step sources', () => {
  it('triangle: −1 → 1 V at 1 kHz, symmetric by default and skewed by the rise time', () => {
    const s = series(tran('sources/triangle-voltage', {}, 3e-3, 5e-6));
    expect(at(s, 0)).toBeCloseTo(-1, 6);
    expect(at(s, 0.5e-3)).toBeCloseTo(1, 3);
    expect(at(s, 1.25e-3)).toBeCloseTo(0, 2);
    const k = series(tran('sources/triangle-voltage', { rise: '80' }, 2e-3, 5e-6));
    expect(at(k, 0.8e-3)).toBeCloseTo(1, 3);
    expect(at(k, 0.4e-3)).toBeCloseTo(0, 2);
  });

  it('sawtooth ramps linearly and returns in the return time', () => {
    const s = series(tran('sources/sawtooth-voltage', { low: '0', high: '2', freq: '1k', ret: '1' }, 2.5e-3, 5e-6));
    expect(at(s, 0.495e-3)).toBeCloseTo(1, 2);
    expect(at(s, 0.98e-3)).toBeCloseTo(1.98, 2);
    expect(at(s, 1.001e-3)).toBeLessThan(0.05);
  });

  it('step source jumps at the step time', () => {
    const s = series(tran('sources/step-voltage', { v0: '1', v1: '3', tstep: '1m', trise: '10u' }, 2e-3, 5e-6));
    expect(at(s, 0.9e-3)).toBeCloseTo(1, 6);
    expect(at(s, 1.2e-3)).toBeCloseTo(3, 6);
  });

  it('data-file source reads CSV lines, skips comments and headers, scales time and value', () => {
    expect(parseDataFile('# time,volts\ntime;value\n0;0\n1m, 2\n2m\t0\n')).toEqual([0, 0, 1e-3, 2, 2e-3, 0]);
    expect(parseDataFile('0 0, 1 1')).toEqual([0, 0, 1, 1]);
    expect(() => parseDataFile('hello')).toThrow(/no "time value" pairs/);
    expect(() => parseDataFile('0 0\n2 1\n1 0')).toThrow(/must not decrease/);
    const s = series(tran('sources/file-voltage', { data: '0 0\n1 1\n2 0', tscale: '1m', vscale: '5', repeat: 'true' }, 3e-3, 10e-6));
    expect(at(s, 1e-3)).toBeCloseTo(5, 3);
    expect(at(s, 2.5e-3)).toBeCloseTo(2.5, 2);
  });
});

describe('modulated sources', () => {
  it('chirp sweeps from f0 to f1 in the sweep time', () => {
    const s = series(tran('sources/chirp-voltage', { f0: '1k', f1: '5k', tsweep: '4m' }, 6e-3, 2e-6));
    const c = crossings(s);
    // cycles during the sweep: f0·T + (f1 − f0)·T / 2 = 4 + 8 = 12
    expect(c.filter((x) => x > 0 && x < 4e-3).length).toBeGreaterThanOrEqual(11);
    expect(c.filter((x) => x > 0 && x < 4e-3).length).toBeLessThanOrEqual(12);
    const late = c.filter((x) => x > 4.2e-3);
    const f = (xs: number[]) => (xs.length - 1) / (xs[xs.length - 1] - xs[0]);
    expect(f(late)).toBeCloseTo(5000, -2);
  });

  it('FSK switches between space and mark frequencies with the bit pattern, phase-continuous', () => {
    const s = series(tran('sources/fsk-voltage', { f0: '1k', f1: '3k', bits: '01', rate: '250' }, 8e-3, 2e-6));
    const c = crossings(s);
    const f = (a: number, b: number) => {
      const xs = c.filter((x) => x > a && x < b);
      return (xs.length - 1) / (xs[xs.length - 1] - xs[0]);
    };
    expect(f(0.2e-3, 3.8e-3)).toBeCloseTo(1000, -2);
    expect(f(4.2e-3, 7.8e-3)).toBeCloseTo(3000, -2);
    // no phase jump at the bit edge: the output stays continuous
    const i = s.t.findIndex((x) => x >= 4e-3);
    expect(Math.abs(s.v[i] - s.v[i - 1])).toBeLessThan(0.1);
  });

  it('thermal noise source: RMS ≈ √(4kTRB), reproducible with the seed', () => {
    const params = { r: '100k', bw: '20k', temp: '27', duration: '20m', seed: '5' };
    const r = tran('sources/thermal-noise', params, 20e-3, 25e-6, (b, h) => {
      b.labelPin(h, '+', 'OUT');
      b.labelPin(h, '-', '0');
    });
    const s = series(r);
    // the load (1 MΩ) divides the open-circuit noise by 1M / 1.1M
    let sum = 0;
    for (let i = 0; i < s.v.length; i++) sum += s.v[i] * s.v[i];
    const rms = Math.sqrt(sum / s.v.length);
    const expected = Math.sqrt(4 * BOLTZ * 300.15 * 100e3 * 20e3) * (1e6 / 1.1e6);
    expect(rms).toBeGreaterThan(expected * 0.85);
    expect(rms).toBeLessThan(expected * 1.15);
    const again = series(tran('sources/thermal-noise', params, 20e-3, 25e-6));
    expect(Array.from(again.v.slice(0, 50))).toEqual(Array.from(s.v.slice(0, 50)));
  });
});

describe('three-phase, two-phase and controlled sources', () => {
  it('Vietnamese mains preset: 380 V line voltage at 50 Hz', () => {
    const r = tran('sources/three-phase-380v-50hz', {}, 50e-3, 20e-6, (b, h) => {
      b.labelPin(h, 'L1', 'OUT');
      b.labelPin(h, 'L2', 'B');
      b.labelPin(h, 'L3', 'C');
      b.labelPin(h, 'N', '0');
    });
    const a = series(r, 'V(OUT)');
    const bb = series(r, 'V(B)');
    let peak = 0;
    for (let i = 0; i < a.v.length; i++) peak = Math.max(peak, Math.abs(a.v[i] - bb.v[i]));
    expect(peak / Math.SQRT2).toBeCloseTo(220 * Math.sqrt(3), -1);
    const c = crossings(a, 0, 1e-3);
    expect(1 / (c[1] - c[0])).toBeCloseTo(50, 0);
  });

  it('two-phase source: B lags A by 90°', () => {
    const r = tran('sources/two-phase', { vrms: '1', freq: '1k' }, 3e-3, 2e-6, (b, h) => {
      b.labelPin(h, 'A', 'OUT');
      b.labelPin(h, 'B', 'B');
      b.labelPin(h, 'N', '0');
    });
    const ca = crossings(series(r, 'V(OUT)'), 0, 0.1e-3);
    const cb = crossings(series(r, 'V(B)'), 0, 0.1e-3);
    // B crosses zero a quarter period after A (modulo the 1 ms period)
    expect((((cb[0] - ca[0]) % 1e-3) + 1e-3) % 1e-3).toBeCloseTo(0.25e-3, 5);
  });

  it('voltage-controlled sine: f = f0 + k·V(in)', () => {
    const r = tran('sources/vc-sine', { f0: '1k', kf: '1k' }, 4e-3, 2e-6, (b, h) => {
      b.labelPin(h, 'out+', 'OUT');
      b.labelPin(h, 'out-', '0');
      b.labelPin(h, 'in-', '0');
      const v = b.part('sources/dc-voltage', 'VC', -300, 0, { value: '2' });
      b.labelPin(v, '+', 'C');
      b.labelPin(v, '-', '0');
      b.labelPin(h, 'in+', 'C');
    });
    const c = crossings(series(r), 0, 0.1e-3);
    expect((c.length - 1) / (c[c.length - 1] - c[0])).toBeCloseTo(3000, -1);
  });

  it('voltage-controlled PWL follows its table', () => {
    const b = new DesignBuilder('pwl');
    const h = b.part('sources/vc-pwl', 'E1', 0, 0, { points: '0 0, 1 2, 2 2' });
    const v = b.part('sources/dc-voltage', 'VC', -300, 0, { value: '0.5' });
    b.labelPin(v, '+', 'C');
    b.labelPin(v, '-', '0');
    b.labelPin(h, 'in+', 'C');
    b.labelPin(h, 'in-', '0');
    b.labelPin(h, 'out+', 'OUT');
    b.labelPin(h, 'out-', '0');
    const build = buildNetlist(b.design, { includeAnalysis: false });
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(op.vectors.find((x) => x.name === 'V(OUT)')!.re[0]).toBeCloseTo(1, 6);
  });
});
