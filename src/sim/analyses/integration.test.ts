/**
 * Cross-checks of the advanced analyses on a bipolar amplifier (real Gummel-Poon device with
 * junction and diffusion capacitances): independent methods must agree.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import type { AnalysisSpec, ElementIR, ModelCard, SourceSpec } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { cap, netlist, res, vdc } from '../engine/testing';

const vsrc = (name: string, p: string, n: string, source: SourceSpec): ElementIR => ({ type: 'V', name, nodes: [p, n], params: {}, source });
const QN: ModelCard = { name: 'QN', type: 'NPN', params: { is: 1e-14, bf: 120, vaf: 80, cje: 8e-12, cjc: 3e-12, tf: 4e-10, rb: 50 } };
const bjt: ElementIR = { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e'], params: {}, model: 'QN' };

/** DC-coupled common-emitter stage with emitter degeneration. */
function stage(input: SourceSpec): ElementIR[] {
  return [vdc('VCC', 'vcc', '0', 12), vsrc('VIN', 'in', '0', { dc: 2, ...input }), res('RB', 'in', 'b', 1e3), bjt, res('RC', 'vcc', 'c', 4.7e3), res('RE', 'e', '0', 1e3), cap('CL', 'c', '0', 20e-12)];
}

function analyse(elements: ElementIR[], specs: AnalysisSpec[], options = {}): AnalysisResult[] {
  const rs = runAnalyses(netlist(elements, specs, { models: [QN], options }));
  for (const r of rs) expect(r.error, r.title).toBeUndefined();
  return rs;
}

describe('analysis cross-checks on a BJT amplifier', () => {
  it('pole-zero factorisation reproduces the AC response', () => {
    const freqs = [1e3, 1e6, 1e7, 5e7, 2e8];
    const [pz, ac] = analyse(stage({ acMag: 1 }), [
      { type: 'pz', inPos: 'in', inNeg: '0', outPos: 'c', outNeg: '0', transfer: 'vol', find: 'pz' },
      { type: 'ac', sweep: 'list', points: 0, fstart: 0, fstop: 0, list: freqs },
    ]);
    const p = findVector(pz, 'pole');
    const z = findVector(pz, 'zero');
    const k = pz.scalars?.gain_constant as number;
    expect(p?.re.length).toBeGreaterThanOrEqual(2);
    const v = findVector(ac, 'V(c)');
    freqs.forEach((f, i) => {
      const s = { re: 0, im: 2 * Math.PI * f };
      let hr = k;
      let hi = 0;
      const mul = (ar: number, ai: number) => {
        [hr, hi] = [hr * ar - hi * ai, hr * ai + hi * ar];
      };
      const div = (ar: number, ai: number) => {
        const m = ar * ar + ai * ai;
        [hr, hi] = [(hr * ar + hi * ai) / m, (hi * ar - hr * ai) / m];
      };
      z?.re.forEach((zr, j) => mul(s.re - zr, s.im - (z.im?.[j] ?? 0)));
      p?.re.forEach((pr, j) => div(s.re - pr, s.im - (p.im?.[j] ?? 0)));
      const ar = v?.re[i] as number;
      const ai = v?.im?.[i] as number;
      expect(Math.hypot(hr - ar, hi - ai)).toBeLessThan(1e-6 * Math.hypot(ar, ai));
    });
    // all poles of a passive-loaded stable amplifier are in the left half plane
    p?.re.forEach((pr) => expect(pr).toBeLessThan(0));
  });

  it('noise analysis gain equals the AC gain and contributions add up', () => {
    const [noise, ac] = analyse(stage({ acMag: 1 }), [
      { type: 'noise', output: 'c', src: 'VIN', sweep: 'dec', points: 4, fstart: 1e3, fstop: 1e8 },
      { type: 'ac', sweep: 'dec', points: 4, fstart: 1e3, fstop: 1e8 },
    ]);
    const g = findVector(noise, 'gain')?.re as Float64Array;
    const v = findVector(ac, 'V(c)');
    g.forEach((gk, k) => expect(Math.abs(gk / Math.hypot(v?.re[k] as number, v?.im?.[k] as number) - 1)).toBeLessThan(1e-10));
    const total = findVector(noise, 'onoise_psd')?.re as Float64Array;
    const parts = ['RB', 'RC', 'RE', 'Q1'].map((d) => findVector(noise, `onoise(${d})`)?.re as Float64Array);
    total.forEach((t, k) => expect(Math.abs(parts.reduce((s, p) => s + p[k], 0) / t - 1)).toBeLessThan(1e-12));
    expect(findVector(noise, 'onoise(Q1:shot_ic)')).toBeDefined();
    const inPsd = findVector(noise, 'inoise_psd')?.re as Float64Array;
    inPsd.forEach((s, k) => expect(Math.abs((s * g[k] * g[k]) / total[k] - 1)).toBeLessThan(1e-12));
  });

  it('Volterra distortion agrees with a transient Fourier analysis', () => {
    const A = 20e-3;
    const f = 1e6;
    const opts = { reltol: 1e-7, vntol: 1e-10, abstol: 1e-15, chgtol: 1e-18 };
    const [disto, four] = analyse(
      stage({ distof1: [A, 0], tran: { type: 'SIN', args: [2, A, f] } }),
      [
        { type: 'disto', sweep: 'lin', points: 1, fstart: f, fstop: f },
        { type: 'four', fundamental: f, harmonics: 4, outputs: ['V(c)'], settleCycles: 4, samples: 512 },
      ],
      opts,
    );
    const hd2 = findVector(disto, 'HD2rel(V(c))')?.re[0] as number;
    const hd3 = findVector(disto, 'HD3rel(V(c))')?.re[0] as number;
    const norm = findVector(four, 'norm(V(c))')?.re as Float64Array;
    // degenerated stage (loop gain ≈ 50): HD2 ≈ 2e-4, HD3 ≈ 1e-6 of the fundamental
    expect(hd2).toBeGreaterThan(1e-4);
    expect(hd3).toBeGreaterThan(1e-7);
    expect(Math.abs(norm[2] / hd2 - 1)).toBeLessThan(2e-3);
    expect(Math.abs(norm[3] / hd3 - 1)).toBeLessThan(2e-2);
    // fundamental magnitude also agrees
    const f1 = findVector(disto, 'F1(V(c))');
    const m1 = Math.hypot(f1?.re[0] as number, f1?.im?.[0] as number);
    expect(Math.abs((findVector(four, 'V(c)')?.re[1] as number) / m1 - 1)).toBeLessThan(2e-3);
  });

  it('BJT model-parameter sensitivities match finite differences of the operating point', () => {
    const [sens, sweepBf, sweepIs] = analyse(stage({}), [
      { type: 'sens', output: 'V(c)' },
      { type: 'paramsweep', target: 'QN', param: 'bf', model: true, values: [119, 121], base: { type: 'op' } },
      { type: 'paramsweep', target: 'QN', param: 'is', model: true, values: [0.99e-14, 1.01e-14], base: { type: 'op' } },
    ], { reltol: 1e-9, vntol: 1e-12 });
    const vb = findVector(sweepBf, 'V(c)')?.re as Float64Array;
    const vi = findVector(sweepIs, 'V(c)')?.re as Float64Array;
    const dBf = (vb[1] - vb[0]) / 2;
    const dIs = (vi[1] - vi[0]) / 0.02e-14;
    expect(Math.abs((sens.scalars?.['QN:bf'] as number) / dBf - 1)).toBeLessThan(1e-3);
    expect(Math.abs((sens.scalars?.['QN:is'] as number) / dIs - 1)).toBeLessThan(1e-3);
    expect(Math.abs((sens.scalars?.['RC:value'] as number) * 4.7e3)).toBeGreaterThan(0);
  });
});
