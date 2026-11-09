import { describe, expect, it } from 'vitest';
import { complexEigenvalues, realEigenvalues, type ComplexArray } from './eigen';

function sorted(e: ComplexArray): [number, number][] {
  const list: [number, number][] = [];
  for (let k = 0; k < e.re.length; k++) list.push([e.re[k], e.im[k]]);
  return list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Determinant of a complex matrix by Gaussian elimination with partial pivoting. */
function det(re: Float64Array, im: Float64Array, n: number): [number, number] {
  const ar = Float64Array.from(re);
  const ai = Float64Array.from(im);
  let dr = 1;
  let di = 0;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.hypot(ar[i * n + k], ai[i * n + k]) > Math.hypot(ar[p * n + k], ai[p * n + k])) p = i;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        [ar[k * n + j], ar[p * n + j]] = [ar[p * n + j], ar[k * n + j]];
        [ai[k * n + j], ai[p * n + j]] = [ai[p * n + j], ai[k * n + j]];
      }
      dr = -dr;
      di = -di;
    }
    const pr = ar[k * n + k];
    const pi = ai[k * n + k];
    [dr, di] = [dr * pr - di * pi, dr * pi + di * pr];
    const m = pr * pr + pi * pi;
    if (m === 0) return [0, 0];
    for (let i = k + 1; i < n; i++) {
      const fr = (ar[i * n + k] * pr + ai[i * n + k] * pi) / m;
      const fi = (ai[i * n + k] * pr - ar[i * n + k] * pi) / m;
      for (let j = k; j < n; j++) {
        ar[i * n + j] -= fr * ar[k * n + j] - fi * ai[k * n + j];
        ai[i * n + j] -= fr * ai[k * n + j] + fi * ar[k * n + j];
      }
    }
  }
  return [dr, di];
}

describe('complex eigenvalue solver', () => {
  it('finds the roots of a companion matrix', () => {
    // x^3 - 6x^2 + 11x - 6 = (x-1)(x-2)(x-3)
    const a = Float64Array.from([6, -11, 6, 1, 0, 0, 0, 1, 0]);
    const e = sorted(realEigenvalues(a, 3));
    [1, 2, 3].forEach((v, k) => {
      expect(e[k][0]).toBeCloseTo(v, 12);
      expect(Math.abs(e[k][1])).toBeLessThan(1e-12);
    });
  });

  it('finds complex conjugate eigenvalues of a real matrix', () => {
    // rotation-like matrix [[1, -2], [2, 1]]: eigenvalues 1 ± 2j
    const e = sorted(realEigenvalues(Float64Array.from([1, -2, 2, 1]), 2));
    expect(e[0][0]).toBeCloseTo(1, 13);
    expect(e[1][0]).toBeCloseTo(1, 13);
    expect(e[0][1]).toBeCloseTo(-2, 13);
    expect(e[1][1]).toBeCloseTo(2, 13);
  });

  it('handles badly scaled similarity transforms (balancing)', () => {
    // D A D^-1 with D = diag(1e-6, 1, 1e6) has the same eigenvalues 1, 2, 3
    const base = [6, -11, 6, 1, 0, 0, 0, 1, 0];
    const d = [1e-6, 1, 1e6];
    const a = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i * 3 + j] = (d[i] * base[i * 3 + j]) / d[j];
    const e = sorted(realEigenvalues(a, 3));
    [1, 2, 3].forEach((v, k) => expect(e[k][0]).toBeCloseTo(v, 9));
  });

  it('returns the diagonal of a complex triangular matrix', () => {
    const re = Float64Array.from([1, 5, -2, 0, -3, 4, 0, 0, 0.5]);
    const im = Float64Array.from([2, 1, 1, 0, 0.25, -1, 0, 0, -7]);
    const e = sorted(complexEigenvalues(re, im, 3));
    expect(e[0][0]).toBeCloseTo(-3, 12);
    expect(e[0][1]).toBeCloseTo(0.25, 12);
    expect(e[1][0]).toBeCloseTo(0.5, 12);
    expect(e[1][1]).toBeCloseTo(-7, 12);
    expect(e[2][0]).toBeCloseTo(1, 12);
    expect(e[2][1]).toBeCloseTo(2, 12);
  });

  it('resolves a defective (Jordan) eigenvalue to sqrt(eps) accuracy', () => {
    const e = sorted(realEigenvalues(Float64Array.from([2, 1, 0, 2]), 2));
    expect(Math.abs(e[0][0] - 2)).toBeLessThan(1e-7);
    expect(Math.abs(e[1][0] - 2)).toBeLessThan(1e-7);
  });

  it('matches trace and determinant of a random complex matrix', () => {
    const n = 12;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const re = new Float64Array(n * n).map(rnd);
    const im = new Float64Array(n * n).map(rnd);
    const e = complexEigenvalues(re, im, n);
    let tr = 0;
    let ti = 0;
    for (let k = 0; k < n; k++) {
      tr += re[k * n + k];
      ti += im[k * n + k];
    }
    let sr = 0;
    let si = 0;
    let pr = 1;
    let pi = 0;
    for (let k = 0; k < n; k++) {
      sr += e.re[k];
      si += e.im[k];
      [pr, pi] = [pr * e.re[k] - pi * e.im[k], pr * e.im[k] + pi * e.re[k]];
    }
    expect(sr).toBeCloseTo(tr, 10);
    expect(si).toBeCloseTo(ti, 10);
    const [dr, di] = det(re, im, n);
    expect(Math.hypot(pr - dr, pi - di)).toBeLessThan(1e-10 * Math.hypot(dr, di));
    // every eigenvalue makes A - λI singular
    for (let k = 0; k < n; k++) {
      const sre = Float64Array.from(re);
      const sim = Float64Array.from(im);
      for (let i = 0; i < n; i++) {
        sre[i * n + i] -= e.re[k];
        sim[i * n + i] -= e.im[k];
      }
      const [qr, qi] = det(sre, sim, n);
      expect(Math.hypot(qr, qi)).toBeLessThan(1e-9 * Math.hypot(dr, di));
    }
  });
});
