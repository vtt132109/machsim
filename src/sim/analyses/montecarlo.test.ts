import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import type { AnalysisSpec, MeasureSpec, ToleranceSpec } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { netlist, res, vdc } from '../engine/testing';

const V = 5;
const R1 = 1e3;
const R2 = 3e3;
const divider = [vdc('V1', 'in', '0', V), res('R1', 'in', 'out', R1), res('R2', 'out', '0', R2)];
const measure: MeasureSpec = { output: 'V(out)', func: 'final' };
const vout = (r1: number, r2: number) => (V * r2) / (r1 + r2);

function run(spec: AnalysisSpec): AnalysisResult {
  const [r] = runAnalyses(netlist(divider, [spec]));
  expect(r.error).toBeUndefined();
  return r;
}

function mc(tolerances: ToleranceSpec[], runs: number, seed: number): AnalysisResult {
  return run({ type: 'montecarlo', runs, seed, tolerances, base: { type: 'op' }, measure });
}

const uniform5: ToleranceSpec[] = [
  { target: 'R1', param: 'value', tol: 0.05, dist: 'uniform' },
  { target: 'R2', param: 'value', tol: 0.05, dist: 'uniform' },
];

describe('Monte Carlo analysis', () => {
  it('is reproducible for a given seed and differs between seeds', () => {
    const a = mc(uniform5, 20, 42);
    const b = mc(uniform5, 20, 42);
    const c = mc(uniform5, 20, 43);
    const va = findVector(a, 'final(V(out))')?.re as Float64Array;
    const vb = findVector(b, 'final(V(out))')?.re as Float64Array;
    const vc = findVector(c, 'final(V(out))')?.re as Float64Array;
    expect(Array.from(va)).toEqual(Array.from(vb));
    expect(Array.from(va)).not.toEqual(Array.from(vc));
    expect(a.runs).toHaveLength(21);
    expect(a.runs?.[0].label).toBe('nominal');
    expect(a.runs?.[20].label).toBe('run 20');
  });

  it('keeps uniform draws within tolerance and the output within its analytic bounds', () => {
    const N = 300;
    const r = mc(uniform5, N, 7);
    const rows = r.table?.rows ?? [];
    expect(r.table?.columns).toEqual(['Run', 'R1', 'R2', 'final(V(out))']);
    expect(rows[0]).toEqual(['nominal', R1, R2, vout(R1, R2)]);
    const lo = vout(1.05 * R1, 0.95 * R2);
    const hi = vout(0.95 * R1, 1.05 * R2);
    let r1min = Infinity;
    let r1max = -Infinity;
    for (const row of rows.slice(1)) {
      const r1 = row[1] as number;
      const r2 = row[2] as number;
      expect(Math.abs(r1 / R1 - 1)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(r2 / R2 - 1)).toBeLessThanOrEqual(0.05);
      // the measured value is the circuit response to the drawn values
      expect(row[3] as number).toBeCloseTo(vout(r1, r2), 10);
      r1min = Math.min(r1min, r1);
      r1max = Math.max(r1max, r1);
    }
    // a uniform sample of 300 covers most of the range
    expect(r1min).toBeLessThan(0.96 * R1);
    expect(r1max).toBeGreaterThan(1.04 * R1);
    const s = r.scalars ?? {};
    expect(s.count).toBe(N);
    expect(s.min).toBeGreaterThanOrEqual(lo);
    expect(s.max).toBeLessThanOrEqual(hi);
    expect(s.nominal).toBeCloseTo(3.75, 12);
    // mean within 4 standard errors of the nominal (response is nearly linear in the draws)
    expect(Math.abs(s.mean - 3.75)).toBeLessThan((4 * s.sigma) / Math.sqrt(N));
    // sigma of a sum of two independent uniform contributions, linearised
    const d1 = (-V * R2) / (R1 + R2) ** 2;
    const d2 = (V * R1) / (R1 + R2) ** 2;
    const sigmaLin = Math.sqrt((d1 * 0.05 * R1) ** 2 / 3 + (d2 * 0.05 * R2) ** 2 / 3);
    expect(s.sigma / sigmaLin).toBeGreaterThan(0.85);
    expect(s.sigma / sigmaLin).toBeLessThan(1.15);
    expect(findVector(r, 'final(V(out))')?.re[s.max_run - 1]).toBe(s.max);
  });

  it('draws gaussian values with sigma = tol/3', () => {
    const N = 400;
    const r = mc([{ target: 'R1', param: 'value', tol: 0.06, dist: 'gaussian' }], N, 11);
    const vals = (r.table?.rows ?? []).slice(1).map((row) => row[1] as number);
    const mean = vals.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1));
    expect(Math.abs(mean / R1 - 1)).toBeLessThan((4 * 0.02) / Math.sqrt(N));
    expect(sd / (0.02 * R1)).toBeGreaterThan(0.88);
    expect(sd / (0.02 * R1)).toBeLessThan(1.12);
  });

  it('varies model parameters for every device using the card', () => {
    const [r] = runAnalyses(
      netlist(
        [vdc('V1', 'in', '0', 1), { type: 'R', name: 'RA', nodes: ['in', 'out'], value: 1e3, params: {}, model: 'RM' }],
        [{ type: 'montecarlo', runs: 3, seed: 1, tolerances: [{ target: 'RM', param: 'tc1', model: true, tol: 0.1, dist: 'uniform' }], base: { type: 'op' } }],
        { models: [{ name: 'RM', type: 'R', params: { tc1: 1e-3 } }] },
      ),
    );
    expect(r.error).toBeUndefined();
    const rows = r.table?.rows ?? [];
    expect(r.table?.columns).toEqual(['Run', 'RM:tc1']);
    for (const row of rows.slice(1)) expect(Math.abs((row[1] as number) / 1e-3 - 1)).toBeLessThanOrEqual(0.1);
    expect(r.scalars).toBeUndefined();
  });

  it('rejects unknown tolerance targets', () => {
    const [r] = runAnalyses(
      netlist(divider, [{ type: 'montecarlo', runs: 2, seed: 1, tolerances: [{ target: 'R7', param: 'value', tol: 0.1, dist: 'uniform' }], base: { type: 'op' } }]),
    );
    expect(r.error).toMatch(/R7/);
  });
});

describe('worst case analysis', () => {
  it('moves every parameter to the extreme that pushes the measurement the requested way', () => {
    const hi = run({ type: 'worstcase', tolerances: uniform5, base: { type: 'op' }, measure, direction: 'high' });
    expect(hi.scalars?.nominal).toBeCloseTo(3.75, 12);
    expect(hi.scalars?.worst).toBeCloseTo(vout(0.95 * R1, 1.05 * R2), 12);
    expect(hi.table?.rows[0][6]).toBe('-tol');
    expect(hi.table?.rows[1][6]).toBe('+tol');
    expect(hi.table?.rows[0][5]).toBeCloseTo(0.95 * R1, 9);
    // sensitivity column: central difference over ±tol
    const sR1 = (vout(1.05 * R1, R2) - vout(0.95 * R1, R2)) / (0.1 * R1);
    expect(hi.table?.rows[0][4] as number).toBeCloseTo(sR1, 12);
    const lo = run({ type: 'worstcase', tolerances: uniform5, base: { type: 'op' }, measure, direction: 'low' });
    expect(lo.scalars?.worst).toBeCloseTo(vout(1.05 * R1, 0.95 * R2), 12);
    expect(lo.scalars?.deviation as number).toBeLessThan(0);
    expect(lo.runs?.map((x) => x.label.split(' (')[0])).toEqual(['nominal', 'worst case']);
  });

  it('keeps parameters that do not affect the measurement at nominal', () => {
    const r = run({
      type: 'worstcase',
      tolerances: [...uniform5, { target: 'V1', param: 'acmag', tol: 0.5, dist: 'uniform' }],
      base: { type: 'op' },
      measure,
      direction: 'high',
    });
    expect(r.table?.rows[2][6]).toBe('nominal');
    expect(r.scalars?.worst).toBeCloseTo(vout(0.95 * R1, 1.05 * R2), 12);
  });

  it('measures swept base analyses (minimum of a DC sweep)', () => {
    // min of V(out) over V1 = -1..1 is reached at V1 = -1 and equals -R2/(R1+R2)
    const r = run({
      type: 'worstcase',
      tolerances: [{ target: 'R2', param: 'value', tol: 0.1, dist: 'uniform' }],
      base: { type: 'dc', src: 'V1', start: -1, stop: 1, step: 0.5 },
      measure: { output: 'V(out)', func: 'min' },
      direction: 'low',
    });
    // min V(out) = -R2/(R1+R2): more negative for larger R2
    expect(r.scalars?.worst).toBeCloseTo(-(1.1 * R2) / (R1 + 1.1 * R2), 12);
  });
});
