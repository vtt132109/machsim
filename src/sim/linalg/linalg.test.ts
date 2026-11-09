import { describe, expect, it } from 'vitest';
import {
  ComplexSparseLU,
  ComplexSparseMatrix,
  DenseComplexLU,
  DenseLU,
  SingularMatrixError,
  SparseLU,
  SparseMatrix,
  minimumDegreeOrdering,
  buildCsc,
} from './index';

/** Deterministic pseudo-random generator (LCG) for reproducible test matrices. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Build an MNA-like random matrix: node conductances plus voltage-source branches (zero diagonals). */
function randomMna(n: number, branches: number, seed: number): { sm: SparseMatrix; dense: number[][] } {
  const r = rng(seed);
  const size = n + branches;
  const dense: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const sm = new SparseMatrix(size);
  const add = (i: number, j: number, v: number) => {
    if (i < 0 || j < 0) return;
    sm.add(i, j, v);
    dense[i][j] += v;
  };
  for (let k = 0; k < 3 * n; k++) {
    const a = Math.floor(r() * (n + 1)) - 1;
    const b = Math.floor(r() * (n + 1)) - 1;
    if (a === b) continue;
    const g = 1e-3 + r() * 10;
    add(a, a, g);
    add(b, b, g);
    add(a, b, -g);
    add(b, a, -g);
  }
  for (let i = 0; i < n; i++) add(i, i, 1e-3); // keep every node grounded
  for (let k = 0; k < branches; k++) {
    const br = n + k;
    const p = (k * 7) % n;
    add(p, br, 1);
    add(br, p, 1);
  }
  return { sm, dense };
}

describe('SparseLU (real)', () => {
  it('matches a dense solve on an MNA-like matrix with zero-diagonal branch rows', () => {
    const { sm, dense } = randomMna(40, 5, 7);
    const n = sm.size;
    const b = new Float64Array(n);
    const r = rng(3);
    for (let i = 0; i < n; i++) b[i] = r() * 2 - 1;
    const lu = new SparseLU(n);
    lu.factor(sm);
    const x = lu.solve(b);
    const ref = new DenseLU(dense).solve(b);
    expect(maxAbsDiff(x, ref)).toBeLessThan(1e-9 * Math.max(1, ...Array.from(ref, Math.abs)));
    // residual check
    const res = sm.multiply(x);
    expect(maxAbsDiff(res, b)).toBeLessThan(1e-10);
  });

  it('solves the transpose system', () => {
    const { sm, dense } = randomMna(30, 4, 11);
    const n = sm.size;
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.sin(i + 1);
    const lu = new SparseLU(n);
    lu.factor(sm);
    const x = lu.solveTranspose(b);
    const denseT = dense[0].map((_, j) => dense.map((row) => row[j]));
    const ref = new DenseLU(denseT).solve(b);
    expect(maxAbsDiff(x, ref)).toBeLessThan(1e-9);
    expect(maxAbsDiff(sm.multiplyTranspose(x), b)).toBeLessThan(1e-10);
  });

  it('reuses the symbolic structure on refactorisation and still gives exact results', () => {
    const { sm } = randomMna(50, 3, 5);
    const n = sm.size;
    const lu = new SparseLU(n);
    lu.factor(sm);
    expect(lu.fullFactorizations).toBe(1);
    // scale the conductance values (same pattern) and refactor
    const p = sm.pattern;
    for (let s = 0; s < p.count; s++) if (p.rowOf[s] < 50 && p.colOf[s] < 50) sm.values[s] *= 1.7;
    lu.factor(sm);
    expect(lu.fullFactorizations).toBe(1);
    expect(lu.refactorizations).toBe(1);
    const b = new Float64Array(n).fill(1);
    const x = lu.solve(b);
    expect(maxAbsDiff(sm.multiply(x), b)).toBeLessThan(1e-10);
  });

  it('falls back to a full factorisation when a reused pivot becomes too small', () => {
    const m = new SparseMatrix(2);
    m.add(0, 0, 4);
    m.add(0, 1, 1);
    m.add(1, 0, 1);
    m.add(1, 1, 3);
    const lu = new SparseLU(2);
    lu.factor(m);
    m.clear();
    m.add(0, 0, 1e-12);
    m.add(0, 1, 1);
    m.add(1, 0, 1);
    m.add(1, 1, 3);
    lu.factor(m);
    expect(lu.fullFactorizations).toBe(2);
    const x = lu.solve(Float64Array.from([1, 2]));
    // exact solution of [[1e-12,1],[1,3]] x = [1,2]
    const det = 1e-12 * 3 - 1;
    expect(x[0]).toBeCloseTo((1 * 3 - 1 * 2) / det, 12);
    expect(x[1]).toBeCloseTo((1e-12 * 2 - 1 * 1) / det, 12);
  });

  it('reports a structurally empty column as singular and names the unknown', () => {
    const m = new SparseMatrix(3);
    m.add(0, 0, 1);
    m.add(1, 1, 1);
    m.add(2, 2, 0); // structural but zero
    const lu = new SparseLU(3);
    let err: unknown;
    try {
      lu.factor(m, (i) => `node 'n${i}'`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SingularMatrixError);
    expect((err as SingularMatrixError).code).toBe('singular');
    expect((err as SingularMatrixError).unknown).toBe(2);
    expect((err as Error).message).toContain("node 'n2'");
  });

  it('detects numerically dependent columns (voltage-source loop)', () => {
    // node 0 with two parallel voltage sources (branches 1 and 2) and a resistor
    const m = new SparseMatrix(3);
    m.add(0, 0, 1e-3);
    m.add(0, 1, 1);
    m.add(1, 0, 1);
    m.add(0, 2, 1);
    m.add(2, 0, 1);
    const lu = new SparseLU(3);
    expect(() => lu.factor(m, (i) => (i === 0 ? 'node' : `branch ${i}`))).toThrow(/branch/);
  });

  it('keeps fill small on a ladder thanks to the minimum-degree ordering', () => {
    const n = 500;
    const m = new SparseMatrix(n);
    for (let i = 0; i < n; i++) {
      m.add(i, i, 2.001);
      if (i > 0) {
        m.add(i, i - 1, -1);
        m.add(i - 1, i, -1);
      }
    }
    const lu = new SparseLU(n);
    lu.factor(m);
    // tridiagonal: L and U have at most n-1 off-diagonals each
    expect(lu.factorNonzeros).toBeLessThanOrEqual(3 * n);
    const order = minimumDegreeOrdering(n, buildCsc(m.pattern).colPtr, buildCsc(m.pattern).rowIdx);
    expect(new Set(Array.from(order)).size).toBe(n);
  });

  it('factors a 2000-unknown RC-ladder MNA matrix in well under 20 ms', () => {
    const sections = 1999;
    const size = sections + 2; // nodes 0..sections plus the source branch
    const m = new SparseMatrix(size);
    const g = 1e-3;
    const gc = 1e-6 / 1e-7; // C/h companion conductance
    const stamp = () => {
      m.clear();
      for (let k = 0; k < sections; k++) {
        const a = k;
        const b = k + 1;
        m.add(a, a, g);
        m.add(b, b, g);
        m.add(a, b, -g);
        m.add(b, a, -g);
        m.add(b, b, gc);
      }
      const br = sections + 1;
      m.add(0, br, 1);
      m.add(br, 0, 1);
    };
    stamp();
    const lu = new SparseLU(size);
    const t0 = performance.now();
    lu.factor(m);
    const tFull = performance.now() - t0;
    // warm-up refactorisations, then time the steady state
    for (let i = 0; i < 5; i++) {
      stamp();
      lu.factor(m);
    }
    const t1 = performance.now();
    const reps = 20;
    for (let i = 0; i < reps; i++) {
      stamp();
      lu.factor(m);
    }
    const tRe = (performance.now() - t1) / reps;
    expect(tFull).toBeLessThan(20);
    expect(tRe).toBeLessThan(5);
    const b = new Float64Array(size);
    b[sections + 1] = 1; // 1 V source
    const x = lu.solve(b);
    expect(maxAbsDiff(m.multiply(x), b)).toBeLessThan(1e-12);
    expect(x[0]).toBeCloseTo(1, 12);
  });
});

describe('ComplexSparseLU', () => {
  function randomComplex(n: number, seed: number) {
    const r = rng(seed);
    const cm = new ComplexSparseMatrix(n);
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    const add = (i: number, j: number, a: number, b: number) => {
      cm.add(i, j, a, b);
      re[i * n + j] += a;
      im[i * n + j] += b;
    };
    for (let i = 0; i < n; i++) {
      add(i, i, 0.1 + r(), r() - 0.5);
      for (let k = 0; k < 3; k++) {
        const j = Math.floor(r() * n);
        if (j !== i) add(i, j, r() - 0.5, r() - 0.5);
      }
    }
    // a zero-diagonal coupling pair
    add(0, n - 1, 1, 0);
    add(n - 1, 0, 1, 0);
    return { cm, re, im };
  }

  it('matches a dense complex solve and its transpose', () => {
    const n = 35;
    const { cm, re, im } = randomComplex(n, 21);
    const br = new Float64Array(n);
    const bi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      br[i] = Math.cos(i);
      bi[i] = Math.sin(2 * i);
    }
    const lu = new ComplexSparseLU(n);
    lu.factor(cm);
    const x = lu.solve(br, bi);
    const ref = new DenseComplexLU(re, im, n).solve(br, bi);
    expect(maxAbsDiff(x.re, ref.re)).toBeLessThan(1e-9);
    expect(maxAbsDiff(x.im, ref.im)).toBeLessThan(1e-9);

    const reT = new Float64Array(n * n);
    const imT = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        reT[j * n + i] = re[i * n + j];
        imT[j * n + i] = im[i * n + j];
      }
    const xt = lu.solveTranspose(br, bi);
    const refT = new DenseComplexLU(reT, imT, n).solve(br, bi);
    expect(maxAbsDiff(xt.re, refT.re)).toBeLessThan(1e-9);
    expect(maxAbsDiff(xt.im, refT.im)).toBeLessThan(1e-9);
  });

  it('refactors at a new frequency with the same pattern', () => {
    const n = 20;
    const { cm } = randomComplex(n, 4);
    const lu = new ComplexSparseLU(n);
    lu.factor(cm);
    for (let s = 0; s < cm.pattern.count; s++) cm.im[s] *= 2.5;
    lu.factor(cm);
    expect(lu.refactorizations + lu.fullFactorizations).toBe(2);
    const br = new Float64Array(n).fill(1);
    const bi = new Float64Array(n);
    const x = lu.solve(br, bi);
    const y = cm.multiply(x.re, x.im);
    expect(maxAbsDiff(y.re, br)).toBeLessThan(1e-10);
    expect(maxAbsDiff(y.im, bi)).toBeLessThan(1e-10);
  });

  it('reports singular complex matrices', () => {
    const cm = new ComplexSparseMatrix(2);
    cm.add(0, 0, 1, 1);
    cm.add(0, 1, 2, 2);
    cm.add(1, 0, 1, 1);
    cm.add(1, 1, 2, 2);
    const lu = new ComplexSparseLU(2);
    expect(() => lu.factor(cm)).toThrow(SingularMatrixError);
  });
});

describe('SparseMatrix stamp tape', () => {
  it('accumulates correctly when the stamp order changes between assemblies', () => {
    const m = new SparseMatrix(3);
    m.clear();
    m.add(0, 0, 1);
    m.add(1, 1, 2);
    m.add(-1, 2, 5); // ground row ignored
    m.clear();
    m.add(1, 1, 3);
    m.add(0, 0, 4);
    m.add(2, 2, 6);
    m.add(0, 0, 1);
    expect(m.get(0, 0)).toBe(5);
    expect(m.get(1, 1)).toBe(3);
    expect(m.get(2, 2)).toBe(6);
    expect(m.pattern.count).toBe(3);
  });

  it('rejects out-of-range indices', () => {
    const m = new SparseMatrix(2);
    expect(() => m.add(0, 2, 1)).toThrow(RangeError);
    expect(() => m.add(Number.NaN, 0, 1)).toThrow(RangeError);
  });
});
