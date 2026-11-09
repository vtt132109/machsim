import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import type { AnalysisSpec, ElementIR, PzAnalysis } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { cap, idc, ind, netlist, res, tline, vcvs, vdc, vsrc } from '../engine/testing';
import { pencilRoots } from './pz';

function pz(elements: ElementIR[], spec: Partial<PzAnalysis> = {}): AnalysisResult {
  const full: AnalysisSpec = { type: 'pz', inPos: 'in', inNeg: '0', outPos: 'out', outNeg: '0', transfer: 'vol', find: 'pz', ...spec };
  const [r] = runAnalyses(netlist(elements, [full]));
  expect(r.error).toBeUndefined();
  return r;
}

function roots(r: AnalysisResult, name: 'pole' | 'zero'): { re: number; im: number }[] {
  const v = findVector(r, name);
  if (!v) return [];
  return Array.from(v.re, (re, k) => ({ re, im: v.im?.[k] ?? 0 }));
}

function expectRoots(actual: { re: number; im: number }[], expected: { re: number; im: number }[], tol = 1e-7): void {
  expect(actual.length).toBe(expected.length);
  const used = new Set<number>();
  for (const e of expected) {
    const k = actual.findIndex((a, i) => !used.has(i) && Math.hypot(a.re - e.re, a.im - e.im) <= tol * Math.max(1, Math.hypot(e.re, e.im)));
    expect(k, `root ${e.re} ${e.im}j in ${JSON.stringify(actual)}`).toBeGreaterThanOrEqual(0);
    used.add(k);
  }
}

describe('pole-zero analysis', () => {
  const src = vsrc('V1', 'in', '0', { dc: 0, acMag: 1 });

  it('finds the pole of an RC low-pass and its gain constant', () => {
    const r = pz([src, res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)]);
    expectRoots(roots(r, 'pole'), [{ re: -1e3, im: 0 }]);
    expect(roots(r, 'zero')).toHaveLength(0);
    expect(r.scalars?.gain_constant).toBeCloseTo(1e3, 6);
    expect(r.table?.rows[0][0]).toBe('pole');
    expect(r.table?.rows[0][3] as number).toBeCloseTo(1e3 / (2 * Math.PI), 6);
  });

  it('finds complex poles of a series RLC', () => {
    const R = 10;
    const L = 1e-3;
    const C = 1e-6;
    const r = pz([src, res('R1', 'in', 'a', R), ind('L1', 'a', 'out', L), cap('C1', 'out', '0', C)]);
    const a = -R / (2 * L);
    const w = Math.sqrt(1 / (L * C) - a * a);
    expectRoots(roots(r, 'pole'), [
      { re: a, im: w },
      { re: a, im: -w },
    ]);
    const p = roots(r, 'pole');
    // conjugate pairs are exactly symmetric
    expect(p[0].re).toBe(p[1].re);
    expect(p[0].im).toBe(-p[1].im);
    expect(r.scalars?.gain_constant).toBeCloseTo(1 / (L * C), -1);
    // damping ratio column
    const zeta = (r.table?.rows[0][4] as number);
    expect(zeta).toBeCloseTo((R / 2) * Math.sqrt(C / L), 9);
  });

  it('finds the zero at s = 0 of an RLC band-pass', () => {
    const r = pz([src, cap('C1', 'in', 'a', 1e-6), ind('L1', 'a', 'out', 1e-3), res('R1', 'out', '0', 10)]);
    expectRoots(roots(r, 'zero'), [{ re: 0, im: 0 }]);
    expect(roots(r, 'pole')).toHaveLength(2);
  });

  it('finds a finite zero of a lead network', () => {
    const R1 = 1e4;
    const C1 = 1e-7;
    const R2 = 1e3;
    const r = pz([src, res('R1', 'in', 'out', R1), cap('C1', 'in', 'out', C1), res('R2', 'out', '0', R2)]);
    expectRoots(roots(r, 'zero'), [{ re: -1 / (R1 * C1), im: 0 }]);
    expectRoots(roots(r, 'pole'), [{ re: -(R1 + R2) / (R1 * R2 * C1), im: 0 }]);
    expect(r.scalars?.gain_constant).toBeCloseTo(1, 9);
  });

  it('resolves a double pole of two buffered RC sections', () => {
    const r = pz([
      src,
      res('R1', 'in', 'a', 1e3),
      cap('C1', 'a', '0', 1e-6),
      vcvs('E1', 'b', '0', 'a', '0', 1),
      res('R2', 'b', 'out', 1e3),
      cap('C2', 'out', '0', 1e-6),
    ]);
    expectRoots(roots(r, 'pole'), [
      { re: -1e3, im: 0 },
      { re: -1e3, im: 0 },
    ], 1e-5);
  });

  it('discards spurious roots of a capacitor across the input source', () => {
    const r = pz([src, cap('C0', 'in', '0', 1e-9), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)]);
    expectRoots(roots(r, 'pole'), [{ re: -1e3, im: 0 }]);
    expect(roots(r, 'zero')).toHaveLength(0);
  });

  it('cancels modes that do not reach the output', () => {
    const r = pz([src, res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6), res('R2', 'in', 'x', 1e3), cap('C2', 'x', '0', 1e-9)]);
    expectRoots(roots(r, 'pole'), [{ re: -1e3, im: 0 }]);
    expect(r.warnings.some((w) => /cancelled/.test(w))).toBe(true);
  });

  it('computes transimpedance poles with a current drive', () => {
    const r = pz([idc('I1', '0', 'out', 0), res('R1', 'out', '0', 1e3), cap('C1', 'out', '0', 1e-6)], {
      inPos: 'out',
      transfer: 'cur',
      find: 'pol',
    });
    expectRoots(roots(r, 'pole'), [{ re: -1e3, im: 0 }]);
    expect(findVector(r, 'zero')).toBeUndefined();
    expect(r.scalars?.gain_constant).toBeCloseTo(1e6, 3);
  });

  it('opens a voltage source across the input for current transfer functions', () => {
    const r = pz([src, res('R1', 'in', '0', 1e3), cap('C1', 'in', '0', 1e-6), res('R2', 'in', 'out', 1e3), cap('C2', 'out', '0', 1e-9)], {
      transfer: 'cur',
    });
    expect(r.warnings.some((w) => /V1/.test(w))).toBe(true);
    expect(roots(r, 'pole')).toHaveLength(2);
  });

  it('drives the port with a current when no source is across it (voltage transfer)', () => {
    // in -- R1 -- out -- C1 -- 0, input port driven by a current; V(out)/V(in) = 1/(1 + sRC)
    const r = pz([res('RB', 'in', '0', 1e6), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)]);
    expectRoots(roots(r, 'pole'), [{ re: -1e3, im: 0 }]);
    expect(roots(r, 'zero')).toHaveLength(0);
    expect(r.scalars?.gain_constant).toBeCloseTo(1e3, 6);
  });

  it('reports identically zero transfer functions', () => {
    const r = pz([src, res('R1', 'in', '0', 1e3), res('R2', 'out', '0', 1e3), cap('C1', 'out', '0', 1e-6)]);
    expect(r.warnings.some((w) => /identically zero/.test(w))).toBe(true);
    expect(r.scalars?.gain_constant).toBe(0);
  });

  it('rejects transmission lines', () => {
    const [r] = runAnalyses(
      netlist(
        [vdc('V1', 'in', '0', 0), tline('T1', 'in', '0', 'out', '0', { z0: 50, td: 1e-9 }), res('R1', 'out', '0', 50)],
        [{ type: 'pz', inPos: 'in', inNeg: '0', outPos: 'out', outNeg: '0', transfer: 'vol', find: 'pz' }],
      ),
    );
    expect(r.error).toMatch(/transmission line/);
  });
});

describe('pencil root finder', () => {
  it('finds the finite roots of a 2x2 pencil with an infinite eigenvalue', () => {
    // det([[1, 2], [3, 4]] + s [[1, 0], [0, 0]]) = (1 + s) 4 - 6 = 4s - 2 -> s = 0.5
    const r = pencilRoots(Float64Array.from([1, 2, 3, 4]), Float64Array.from([1, 0, 0, 0]), 2, 1);
    expect(r).toHaveLength(1);
    expect(r[0].re).toBeCloseTo(0.5, 12);
    expect(r[0].im).toBe(0);
  });
});
