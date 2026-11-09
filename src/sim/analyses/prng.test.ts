import { describe, expect, it } from 'vitest';
import { Random } from './prng';

describe('seeded PRNG', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = new Random(123);
    const b = new Random(123);
    const c = new Random(124);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    // seed 0 is valid and produces a non-degenerate stream
    const z = new Random(0);
    const sz = new Set(Array.from({ length: 100 }, () => z.nextUint32()));
    expect(sz.size).toBe(100);
  });

  it('produces uniform values in [0, 1) with the right moments', () => {
    const r = new Random(2024);
    const N = 50000;
    let s = 0;
    let s2 = 0;
    const bins = new Array<number>(10).fill(0);
    for (let k = 0; k < N; k++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      s += u;
      s2 += u * u;
      bins[Math.floor(u * 10)]++;
    }
    const mean = s / N;
    const variance = s2 / N - mean * mean;
    // standard error of the mean of U(0,1): sqrt(1/12/N) = 0.0013
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.006);
    expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.003);
    // chi-square with 9 degrees of freedom; 99.9 % quantile is 27.9
    const chi = bins.reduce((acc, n) => acc + (n - N / 10) ** 2 / (N / 10), 0);
    expect(chi).toBeLessThan(27.9);
    const v = r.uniform(-3, 5);
    expect(v).toBeGreaterThanOrEqual(-3);
    expect(v).toBeLessThan(5);
  });

  it('produces standard normal deviates', () => {
    const r = new Random(7);
    const N = 40000;
    let s = 0;
    let s2 = 0;
    let s4 = 0;
    let within1 = 0;
    for (let k = 0; k < N; k++) {
      const g = r.gaussian();
      s += g;
      s2 += g * g;
      s4 += g ** 4;
      if (Math.abs(g) < 1) within1++;
    }
    const mean = s / N;
    const variance = s2 / N - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.025);
    expect(Math.abs(variance - 1)).toBeLessThan(0.04);
    // kurtosis 3 and P(|g| < 1) = 0.6827 for a normal distribution
    expect(Math.abs(s4 / N - 3)).toBeLessThan(0.2);
    expect(Math.abs(within1 / N - 0.6827)).toBeLessThan(0.01);
  });
});
