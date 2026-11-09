import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import { BOLTZ, CHARGE, KELVIN } from '../device';
import type { AnalysisSpec, ElementIR, ModelCard, SourceSpec } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { model, netlist, res } from '../engine/testing';

const VT = (BOLTZ * (27 + KELVIN)) / CHARGE;

function disto(elements: ElementIR[], spec: Partial<Extract<AnalysisSpec, { type: 'disto' }>>, models: ModelCard[] = [], saves: string[] = []): AnalysisResult {
  const full: AnalysisSpec = { type: 'disto', sweep: 'lin', points: 1, fstart: 1e3, fstop: 1e3, ...spec };
  const [r] = runAnalyses(netlist(elements, [full], { models, saves }));
  expect(r.error).toBeUndefined();
  return r;
}

function phasor(r: AnalysisResult, name: string, k = 0): { re: number; im: number } {
  const v = findVector(r, name);
  expect(v, name).toBeDefined();
  return { re: v?.re[k] as number, im: v?.im?.[k] as number };
}

function expectPhasor(actual: { re: number; im: number }, re: number, im: number, tol: number): void {
  const scale = Math.hypot(re, im);
  expect(Math.hypot(actual.re - re, actual.im - im), `got ${actual.re} ${actual.im}j, expected ${re} ${im}j`).toBeLessThanOrEqual(tol * scale);
}

const bsrc = (name: string, a: string, b: string, expr: string): ElementIR => ({ type: 'B', name, nodes: [a, b], params: {}, expr });
const diode = (name: string, a: string, b: string, m: string): ElementIR => ({ type: 'D', name, nodes: [a, b], params: {}, model: m });
const vsrc = (name: string, p: string, n: string, source: SourceSpec): ElementIR => ({ type: 'V', name, nodes: [p, n], params: {}, source });
const drive = (s: SourceSpec) => vsrc('V1', 'in', '0', s);

describe('distortion analysis (Volterra)', () => {
  const V0 = 0.5;
  const A = 0.01;
  const R = 1e3;

  it('matches a memoryless quadratic + cubic source exactly', () => {
    const k2 = 1e-3;
    const k3 = 2e-3;
    const r = disto([drive({ dc: V0, distof1: [A, 0] }), bsrc('B1', 'out', '0', `I=${k2}*V(in)^2 + ${k3}*V(in)^3`), res('R1', 'out', '0', R)], {}, [], ['V(out)']);
    // v(out) = -R (k2 v^2 + k3 v^3), v = V0 + A cos wt
    expectPhasor(phasor(r, 'F1(V(out))'), -R * (2 * k2 * V0 * A + 3 * k3 * V0 * V0 * A + 0.75 * k3 * A ** 3 * 0), 0, 2e-4);
    expectPhasor(phasor(r, 'HD2(V(out))'), -R * (0.5 * k2 * A * A + 1.5 * k3 * V0 * A * A), 0, 1e-9);
    expectPhasor(phasor(r, 'HD3(V(out))'), -R * 0.25 * k3 * A ** 3, 0, 1e-8);
    const rel = findVector(r, 'HD2rel(V(out))')?.re[0] as number;
    expect(rel).toBeCloseTo((0.5 * k2 * A * A + 1.5 * k3 * V0 * A * A) / (2 * k2 * V0 * A + 3 * k3 * V0 * V0 * A), 12);
  });

  it('follows the source phase: HD2 rotates by twice and HD3 by three times the input phase', () => {
    const k3 = 1e-3;
    const ph = 30;
    const r = disto([drive({ dc: 0, distof1: [A, ph] }), bsrc('B1', 'out', '0', `I=${k3}*V(in)^3`), res('R1', 'out', '0', R)], {}, [], ['V(out)']);
    const m3 = -R * 0.25 * k3 * A ** 3;
    const t = (3 * ph * Math.PI) / 180;
    expectPhasor(phasor(r, 'HD3(V(out))'), m3 * Math.cos(t), m3 * Math.sin(t), 1e-8);
    const hd2 = phasor(r, 'HD2(V(out))');
    expect(Math.hypot(hd2.re, hd2.im)).toBeLessThan(1e-18);
  });

  it('matches the analytic charge nonlinearity of a reverse-biased junction', () => {
    const CJO = 1e-12;
    const VJ = 0.7;
    const M = 0.5;
    const VR = -2;
    const f = 1e6;
    const w = 2 * Math.PI * f;
    const r = disto([vsrc('V1', 'a', '0', { dc: VR, distof1: [A, 0] }), diode('D1', 'a', '0', 'DJ')], { fstart: f, fstop: f }, [
      model('DJ', 'D', { is: 1e-14, cjo: CJO, vj: VJ, m: M }),
    ]);
    const u = 1 - VR / VJ;
    const q2 = ((CJO * M) / VJ) * Math.pow(u, -M - 1);
    const q3 = ((CJO * M * (M + 1)) / (VJ * VJ)) * Math.pow(u, -M - 2);
    // branch current of V1 = -(diode current): HD2 = -(j2w q2 A^2/4), HD3 = -(j3w q3 A^3/24)
    expectPhasor(phasor(r, 'HD2(I(V1))'), 0, -(2 * w * q2 * A * A) / 4, 1e-6);
    expectPhasor(phasor(r, 'HD3(I(V1))'), 0, -(3 * w * q3 * A ** 3) / 24, 1e-5);
    // fundamental: junction capacitance plus the gmin conductance stamped across the junction
    const c0 = CJO * Math.pow(u, -M);
    expectPhasor(phasor(r, 'F1(I(V1))'), -1e-12 * A, -w * c0 * A, 1e-9);
  });

  it('agrees with the exact periodic response of a forward-biased diode', () => {
    const IS = 1e-14;
    const Rs = 100;
    const VDC = 1;
    const amp = 1e-3;
    const r = disto([drive({ dc: VDC, distof1: [amp, 0] }), res('R1', 'in', 'a', Rs), diode('D1', 'a', '0', 'DF')], {}, [model('DF', 'D', { is: IS })], ['V(a)']);
    // reference: solve (v_in(t) - v)/Rs = IS (e^{v/vt} - 1) + gmin v at N points of one period, then DFT
    const N = 64;
    const vs = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const vin = VDC + amp * Math.cos((2 * Math.PI * n) / N);
      let lo = 0;
      let hi = vin;
      for (let it = 0; it < 200; it++) {
        const v = (lo + hi) / 2;
        if ((vin - v) / Rs - IS * (Math.exp(v / VT) - 1) - 1e-12 * v > 0) lo = v;
        else hi = v;
      }
      vs[n] = (lo + hi) / 2;
    }
    const harmonic = (k: number) => {
      let c = 0;
      let s = 0;
      for (let n = 0; n < N; n++) {
        c += vs[n] * Math.cos((2 * Math.PI * k * n) / N);
        s += vs[n] * Math.sin((2 * Math.PI * k * n) / N);
      }
      return { re: (2 / N) * c, im: (-2 / N) * s };
    };
    const h1 = harmonic(1);
    const h2 = harmonic(2);
    const h3 = harmonic(3);
    expectPhasor(phasor(r, 'F1(V(a))'), h1.re, h1.im, 1e-4);
    expectPhasor(phasor(r, 'HD2(V(a))'), h2.re, h2.im, 2e-3);
    expectPhasor(phasor(r, 'HD3(V(a))'), h3.re, h3.im, 1e-2);
  });

  it('computes intermodulation products of two tones', () => {
    const k2 = 1e-3;
    const k3 = 2e-3;
    const A1 = 0.01;
    const A2 = 0.02;
    const r = disto(
      [drive({ dc: V0, distof1: [A1, 0], distof2: [A2, 0] }), bsrc('B1', 'out', '0', `I=${k2}*V(in)^2 + ${k3}*V(in)^3`), res('R1', 'out', '0', R)],
      { f2overf1: 0.9, sweep: 'dec', points: 2, fstart: 1e3, fstop: 1e4 },
      [],
      ['V(out)'],
    );
    const im2 = -R * (k2 + 3 * k3 * V0) * A1 * A2;
    const n = r.scale?.re.length as number;
    expect(n).toBe(3);
    for (let k = 0; k < n; k++) {
      expectPhasor(phasor(r, 'IM2sum(V(out))', k), im2, 0, 1e-8);
      expectPhasor(phasor(r, 'IM2diff(V(out))', k), im2, 0, 1e-8);
      expectPhasor(phasor(r, 'IM3(V(out))', k), -R * 0.75 * k3 * A1 * A1 * A2, 0, 1e-7);
    }
    expect(findVector(r, 'IM3rel(V(out))')).toBeDefined();
  });

  it('reports zero distortion for linear circuits and falls back to AC excitations', () => {
    const r = disto([vsrc('V1', 'in', '0', { dc: 1, acMag: 1 }), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 1e3)], {}, [], ['V(out)']);
    expect(r.warnings.some((w) => /linear/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /DISTOF1/.test(w))).toBe(true);
    expectPhasor(phasor(r, 'F1(V(out))'), 0.5, 0, 1e-12);
    const h2 = phasor(r, 'HD2(V(out))');
    expect(Math.hypot(h2.re, h2.im)).toBe(0);
  });

  it('rejects invalid frequency ratios and missing inputs', () => {
    const [a, b] = runAnalyses(
      netlist(
        [vsrc('V1', 'in', '0', { dc: 1 }), res('R1', 'in', '0', 1e3)],
        [
          { type: 'disto', sweep: 'lin', points: 1, fstart: 1e3, fstop: 1e3, f2overf1: 1.5 },
          { type: 'disto', sweep: 'lin', points: 1, fstart: 1e3, fstop: 1e3 },
        ],
      ),
    );
    expect(a.error).toMatch(/f2overf1/);
    expect(b.error).toMatch(/DISTOF1/);
  });
});
