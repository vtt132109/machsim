/**
 * Lossy transmission line (LTRA, element O) against analytic references: the lossless line (T
 * element) at R = 0, the telegrapher wavefront and DC limits, lumped RLC / RC ladders, the exact
 * distributed-RC step response and the exact AC transfer.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice } from '../../spice';
import { runAnalyses } from '../../engine';
import type { AnalysisResult } from '../../results';
import { e01, erfc, expSum, expSumGain, i0e, i1e, rcYKernels, rlcExponentials, rlcKernelFunctions } from './ltraKernels';

function run(deck: string): AnalysisResult[] {
  const { netlist, errors } = parseSpice(deck);
  expect(errors).toEqual([]);
  return runAnalyses(netlist);
}

function vec(r: AnalysisResult, name: string): Float64Array {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`missing ${name}`);
  return v.re;
}

/** Linear interpolation of a sampled waveform. */
function at(t: Float64Array, y: Float64Array, x: number): number {
  let i = 1;
  while (i < t.length - 1 && t[i] < x) i++;
  const f = (x - t[i - 1]) / (t[i] - t[i - 1]);
  return y[i - 1] + f * (y[i] - y[i - 1]);
}

/** Mean absolute difference of two waveforms on a fine uniform grid over [t0, t1]. */
function meanAbsDiff(tA: Float64Array, vA: Float64Array, tB: Float64Array, vB: Float64Array, t0: number, t1: number): number {
  let s = 0;
  const n = 4000;
  for (let k = 0; k <= n; k++) {
    const x = t0 + ((t1 - t0) * k) / n;
    s += Math.abs(at(tA, vA, x) - at(tB, vB, x));
  }
  return s / (n + 1);
}

/** A lumped ladder of n sections (series R, L; shunt C) from node a to node b. */
function ladder(n: number, r: number, l: number, c: number, len: number): string {
  const dx = len / n;
  const lines: string[] = [];
  for (let k = 0; k < n; k++) {
    const from = k === 0 ? 'a' : `x${k}`;
    const to = k === n - 1 ? 'b' : `x${k + 1}`;
    if (l > 0) {
      lines.push(`R${k} ${from} m${k} ${r * dx}`);
      lines.push(`L${k} m${k} ${to} ${l * dx}`);
    } else lines.push(`R${k} ${from} ${to} ${r * dx}`);
    lines.push(`C${k} ${to} 0 ${c * dx}`);
  }
  return lines.join('\n');
}

describe('LTRA kernel mathematics', () => {
  it('special functions match reference values', () => {
    expect(erfc(0.5)).toBeCloseTo(0.4795001221869535, 13);
    expect(erfc(3)).toBeCloseTo(2.209049699858544e-5, 17);
    expect(i0e(1) * Math.E).toBeCloseTo(1.2660658777520082, 6);
    expect(i1e(5) * Math.exp(5)).toBeCloseTo(24.335642142450524, 4);
    // the asymptotic branch joins the polynomial one
    expect(e01(40) / (i0e(39.999) - i1e(39.999))).toBeCloseTo(1, 4);
  });

  it('exponential sums reproduce the closed-form Bessel kernels and their DC gains', () => {
    for (const [r, len] of [
      [5, 1],
      [50, 1],
      [200, 3],
    ]) {
      const f = rlcKernelFunctions(r, 250e-9, 100e-12, len);
      const e = rlcExponentials(r, 250e-9, 100e-12, len);
      const T = f.delay;
      const scale = f.yinf * f.alpha;
      for (const t of [0.1e-9, 1e-9, 10e-9, 100e-9, 1e-6]) {
        expect(Math.abs(expSum(e.y0, t) - f.y0reg(t))).toBeLessThan(1e-5 * scale);
        expect(Math.abs(expSum(e.h, t) - f.hreg(T + t))).toBeLessThan(1e-5 * f.alpha);
        expect(Math.abs(expSum(e.hy0, t) - f.hy0reg(T + t))).toBeLessThan(1e-5 * scale);
      }
      // DC gains: Y0(0) - Yinf = -Yinf, H(0) - e^-aT = 1 - e^-aT, (Y0 H)(0) - Yinf e^-aT = -Yinf e^-aT
      expect(expSumGain(e.y0) / -f.yinf).toBeCloseTo(1, 10);
      expect(expSumGain(e.h) / (1 - e.eaT)).toBeCloseTo(1, 4);
      expect(expSumGain(e.hy0) / (-f.yinf * e.eaT)).toBeCloseTo(1, 4);
    }
  });

  it('RC admittance kernels: image and modal series agree, ramp responses integrate the step responses', () => {
    const rc = rcYKernels(1e3, 1e-9, 1);
    // tau = 1 us; the series switch at 0.1 tau
    for (const f of [rc.y11, rc.y12]) {
      expect(f.k2(0.1e-6 * (1 + 1e-9)) / f.k2(0.1e-6)).toBeCloseTo(1, 7);
      for (const v of [0.02e-6, 0.3e-6, 3e-6]) expect((f.k2(v + 1e-13) - f.k2(v - 1e-13)) / 2e-13 / f.k1(v)).toBeCloseTo(1, 4);
    }
    // DC: a resistor R*LEN = 1 kohm
    expect(rc.y11.k1(1)).toBeCloseTo(1e-3, 12);
    expect(rc.y12.k1(1)).toBeCloseTo(-1e-3, 12);
  });
});

const PULSE = 'PULSE(0 1 1n 0.5n 0.5n 6n 30n)';

describe('LTRA lossless (LC) line equals the ideal T line', () => {
  it('pulse on a mismatched 50 ohm, 5 ns line', () => {
    const common = `V1 in 0 ${PULSE}\nRS in a 50\nRL b 0 150\n.tran 0.05n 40n\n.end`;
    const [lt] = run(`ltra\nO1 a 0 b 0 LOSSLESS\n.model LOSSLESS LTRA(L=250n C=100p LEN=1)\n${common}`);
    const [tl] = run(`tline\nT1 a 0 b 0 Z0=50 TD=5n\n${common}`);
    expect(lt.error).toBeUndefined();
    expect(tl.error).toBeUndefined();
    const tA = lt.scale!.re;
    const vA = vec(lt, 'V(b)');
    const tB = tl.scale!.re;
    const vB = vec(tl, 'V(b)');
    let worst = 0;
    for (let i = 0; i < tA.length; i++) worst = Math.max(worst, Math.abs(vA[i] - at(tB, vB, tA[i])));
    expect(worst).toBeLessThan(5e-3);
    // nothing arrives before the 5 ns delay plus the 1 ns source delay
    expect(Math.abs(at(tA, vA, 5.9e-9))).toBeLessThan(1e-6);
    // first wavefront: 1 V * 50/100 * (1 + Gamma_L) = 0.5 * 1.5
    expect(at(tA, vA, 8e-9)).toBeCloseTo(0.75, 3);
  });

  it('an RLC line with vanishing R converges to the lossless line', () => {
    const common = `V1 in 0 ${PULSE}\nRS in a 50\nRL b 0 150\n.tran 0.05n 40n\n.end`;
    const [lc] = run(`lc\nO1 a 0 b 0 L1\n.model L1 LTRA(L=250n C=100p LEN=1)\n${common}`);
    const [rlc] = run(`rlc\nO1 a 0 b 0 L1\n.model L1 LTRA(R=1e-4 L=250n C=100p LEN=1)\n${common}`);
    // mean difference (the waveforms have sharp corners, where pointwise comparisons of two
    // differently sampled runs are dominated by the sampling)
    expect(meanAbsDiff(rlc.scale!.re, vec(rlc, 'V(b)'), lc.scale!.re, vec(lc, 'V(b)'), 0, 40e-9)).toBeLessThan(2e-4);
  });
});

describe('LTRA lossy RLC line', () => {
  // Z0 = 50 ohm, T = 5 ns, R = 5 ohm/m: alpha = R/2L = 1e7 1/s, alpha T = 0.05
  const LINE = '.model LOSSY LTRA(R=5 L=250n C=100p LEN=1)';

  it('the wavefront arrives at T attenuated by exp(-alpha T) and settles to the DC divider', () => {
    const [tr] = run(`front\nV1 in 0 PULSE(0 1 1n 0.1n 0.1n 1 1)\nRS in a 50\nO1 a 0 b 0 LOSSY\nRL b 0 50\n${LINE}\n.tran 0.02n 400n\n.end`);
    expect(tr.error).toBeUndefined();
    const t = tr.scale!.re;
    const v = vec(tr, 'V(b)');
    expect(Math.abs(at(t, v, 5.9e-9))).toBeLessThan(1e-6);
    expect(at(t, v, 6.3e-9) / (0.5 * Math.exp(-0.05))).toBeCloseTo(1, 2);
    expect(at(t, v, 399e-9)).toBeCloseTo(50 / 105, 3);
  });

  it('matches a 200-section lumped RLC ladder away from the wavefront corners', () => {
    const src = `V1 in 0 PULSE(0 1 1n 2n 2n 10n 60n)\nRS in a 50\nRL b 0 100\n.tran 0.05n 60n\n.end`;
    const [lt] = run(`ltra\nO1 a 0 b 0 LOSSY\n${LINE}\n${src}`);
    const [ld] = run(`ladder\n${ladder(200, 5, 250e-9, 100e-12, 1)}\n${src}`);
    expect(lt.error).toBeUndefined();
    expect(ld.error).toBeUndefined();
    const tl = lt.scale!.re;
    const vl = vec(lt, 'V(b)');
    // a lumped ladder rings at the slope corners of the far-end wave (18 and 20 ns) whatever its
    // section count, so the comparison skips 2.5 ns around them
    for (let x = 10e-9; x <= 58e-9; x += 0.5e-9) {
      if (Math.abs(x - 18e-9) < 2.5e-9 || Math.abs(x - 20e-9) < 2.5e-9) continue;
      expect(Math.abs(at(tl, vl, x) - at(ld.scale!.re, vec(ld, 'V(b)'), x))).toBeLessThan(2e-3);
    }
  });

  it('DC operating point sees the series resistance R*LEN', () => {
    const [op] = run(`dc\nV1 a 0 1\nO1 a 0 b 0 L2\nRL b 0 80\n.model L2 LTRA(R=10 L=1u C=1n LEN=2)\n.op\n.end`);
    expect(vec(op, 'V(b)')[0]).toBeCloseTo(0.8, 9);
  });

  it('AC transfer of an open line is 1/cosh(gamma len)', () => {
    const [ac] = run(`ac\nV1 a 0 AC 1\nO1 a 0 b 0 LOSSY\nRL b 0 1e12\n${LINE}\n.ac lin 7 10meg 70meg\n.end`);
    const f = ac.scale!.re;
    const vb = ac.vectors.find((x) => x.name.toLowerCase() === 'v(b)')!;
    for (let i = 0; i < f.length; i++) {
      const w = 2 * Math.PI * f[i];
      // gamma = sqrt((R + jwL) jwC), cosh(gamma) by complex arithmetic
      const zr = 5;
      const zi = w * 250e-9;
      const yi = w * 100e-12;
      const pr = -zi * yi;
      const pi = zr * yi;
      const m = Math.hypot(pr, pi);
      const gr = Math.sqrt((m + pr) / 2);
      const gi = Math.sqrt((m - pr) / 2) * Math.sign(pi);
      const chr = Math.cosh(gr) * Math.cos(gi);
      const chi = Math.sinh(gr) * Math.sin(gi);
      const mag = 1 / Math.hypot(chr, chi);
      expect(Math.hypot(vb.re[i], vb.im![i]) / mag).toBeCloseTo(1, 6);
    }
  });
});

describe('LTRA distributed RC line', () => {
  // R = 1 kohm/m, C = 1 nF/m, LEN = 1: tau = R C LEN^2 = 1 us
  const LINE = '.model RCL LTRA(R=1k C=1n LEN=1)';

  it('open-ended step response equals the exact series solution', () => {
    const [tr] = run(`rc step\nV1 a 0 PULSE(0 1 0 1p 1p 1 1)\nO1 a 0 b 0 RCL\nRL b 0 1e12\n${LINE}\n.tran 5n 4u\n.end`);
    expect(tr.error).toBeUndefined();
    const t = tr.scale!.re;
    const v = vec(tr, 'V(b)');
    const exact = (x: number) => {
      let s = 0;
      for (let k = 0; k < 60; k++) s += (Math.pow(-1, k) / (2 * k + 1)) * Math.exp((-Math.pow((2 * k + 1) * Math.PI, 2) * x) / (4 * 1e-6));
      return 1 - (4 / Math.PI) * s;
    };
    for (const x of [0.1e-6, 0.3e-6, 0.6e-6, 1e-6, 2e-6, 3.5e-6]) expect(Math.abs(at(t, v, x) - exact(x))).toBeLessThan(3e-3);
  });

  it('matches a 200-section lumped RC ladder', () => {
    const src = `V1 in 0 PULSE(0 1 0.1u 0.05u 0.05u 1u 3u)\nRS in a 100\nRL b 0 10k\n.tran 5n 3u\n.end`;
    const [lt] = run(`ltra rc\nO1 a 0 b 0 RCL\n${LINE}\n${src}`);
    const [ld] = run(`ladder rc\n${ladder(200, 1e3, 0, 1e-9, 1)}\n${src}`);
    const t = lt.scale!.re;
    const v = vec(lt, 'V(b)');
    for (let x = 0.15e-6; x <= 2.9e-6; x += 0.05e-6) expect(Math.abs(at(t, v, x) - at(ld.scale!.re, vec(ld, 'V(b)'), x))).toBeLessThan(5e-3);
  });
});

describe('LTRA resistive (RG) line and unsupported lines', () => {
  it('an RG line is the exact static two-port: open-circuit ratio 1/cosh(sqrt(RG) LEN)', () => {
    const [op] = run(`rg\nV1 a 0 1\nO1 a 0 b 0 RG1\nRL b 0 1e12\n.model RG1 LTRA(R=10 G=0.01 LEN=1)\n.op\n.end`);
    expect(vec(op, 'V(b)')[0]).toBeCloseTo(1 / Math.cosh(Math.sqrt(0.1)), 9);
  });

  it('rejects RLCG lines as unsupported', () => {
    const [op] = run(`rlcg\nV1 a 0 1\nO1 a 0 b 0 X\nRL b 0 50\n.model X LTRA(R=1 L=1u G=1m C=1n LEN=1)\n.op\n.end`);
    expect(op.error).toMatch(/not supported/);
  });
});
