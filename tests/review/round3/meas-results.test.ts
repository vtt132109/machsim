/**
 * Review round 3: `.meas` evaluation (src/sim/analyses/meas.ts).
 *
 * 1. AC measurements of a complex vector. The module contract (and the step-2 report) says "a
 *    complex result is measured by its magnitude (use vdb / vp for dB and phase)". seriesOf() only
 *    takes the magnitude where the imaginary part is non-zero and keeps the SIGNED real part where
 *    it is exactly 0. An inverting stage with a real gain of −10 (an E source, or an ideal inverting
 *    amplifier at low frequency) therefore measures MAX V(out) = −10 and FIND V(out) = −10, while
 *    the same stage with a tiny phase shift measures +10. The value depends on whether the
 *    imaginary part happens to be exactly zero.
 *
 * 2. Range measurements on a DC sweep that runs downwards (".dc V1 5 0 -0.5"). integral() collects
 *    the interior samples in SCALE order (5, 4.5 … 0.5) between the end points FROM = 0 and TO = 5,
 *    so the trapezoid path zig-zags: INTEG V(a)*V(a) gives 71.875 instead of ≈ 41.67 (∫₀⁵ x² dx =
 *    41.667; the trapezoid value on a 0.5 grid is 41.875), and AVG 14.375 instead of ≈ 8.375.
 *    (For a linear integrand the zig-zag happens to telescope, which is why INTEG V(a) is right.)
 *
 * Expected: the analytic numbers. Both fail today.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../../src/sim';
import type { AnalysisResult } from '../../../src/sim/results';
import { parseSpice } from '../../../src/sim/spice';

function deck(text: string): AnalysisResult {
  const p = parseSpice(text);
  expect(p.errors).toEqual([]);
  const [r] = runAnalyses(p.netlist);
  expect(r.error).toBeUndefined();
  return r;
}
const m = (r: AnalysisResult, name: string): number => {
  const x = r.measurements?.find((q) => q.name === name);
  if (!x) throw new Error(`no measurement ${name}`);
  expect(x.error).toBeUndefined();
  return x.value;
};

describe('.meas AC on a purely real negative gain is measured by its magnitude', () => {
  const r = deck(`inverting stage, gain -10
V1 in 0 AC 1
E1 out 0 in 0 -10
R1 out 0 1k
.ac dec 5 10 1k
.meas ac gmax MAX V(out)
.meas ac g100 FIND V(out) AT=100
.meas ac gdb FIND vdb(out) AT=100
.end`);

  it('control: vdb(out) = 20 dB', () => {
    expect(m(r, 'gdb')).toBeCloseTo(20, 9);
  });
  it('MAX V(out) = |−10| = 10', () => {
    expect(m(r, 'gmax')).toBeCloseTo(10, 9);
  });
  it('FIND V(out) AT=100 = 10', () => {
    expect(m(r, 'g100')).toBeCloseTo(10, 9);
  });
});

describe('.meas over a DC sweep that runs downwards', () => {
  const r = deck(`descending sweep
V1 a 0 0
R1 a 0 1k
.dc V1 5 0 -0.5
.meas dc lin INTEG V(a)
.meas dc sq INTEG V(a)*V(a)
.meas dc sqavg AVG V(a)*V(a)
.end`);

  it('control: INTEG V(a) from 0 to 5 = 12.5', () => {
    expect(m(r, 'lin')).toBeCloseTo(12.5, 9);
  });
  it('INTEG V(a)^2 = trapezoid of x² on a 0.5 grid = 41.875 (∫ = 41.667)', () => {
    expect(m(r, 'sq')).toBeCloseTo(41.875, 6);
  });
  it('AVG V(a)^2 = 41.875 / 5 = 8.375', () => {
    expect(m(r, 'sqavg')).toBeCloseTo(8.375, 6);
  });
});
