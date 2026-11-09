/**
 * Review: transient accuracy and timestep control.
 *
 * References are exact solutions of the linear ODEs. Tolerances follow from the integration
 * method: trapezoidal integration with SPICE LTE control (reltol 1e-3, trtol 7) keeps the local
 * relative error near 1e-3, so waveform values are checked to 2e-3 of full scale unless the
 * argument below says otherwise.
 */
import { describe, expect, it } from 'vitest';
import { crossTimes, interp, runDeck, scaleOf, vec } from './ref';

/**
 * Least-squares fit y ≈ a·sin(wt) + b·cos(wt) + d on the samples in [t0, t1]. Exact for a pure
 * sinusoid on any (non-uniform) sample set, so the fit adds no error of its own.
 */
function fitSine(t: Float64Array, y: Float64Array, f: number, t0: number, t1: number) {
  const w = 2 * Math.PI * f;
  // normal equations, 3×3
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const v = [0, 0, 0];
  for (let i = 0; i < t.length; i++) {
    if (t[i] < t0 || t[i] > t1) continue;
    const row = [Math.sin(w * t[i]), Math.cos(w * t[i]), 1];
    for (let r = 0; r < 3; r++) {
      v[r] += row[r] * y[i];
      for (let c = 0; c < 3; c++) M[r][c] += row[r] * row[c];
    }
  }
  // Gaussian elimination
  for (let k = 0; k < 3; k++) {
    for (let r = k + 1; r < 3; r++) {
      const m = M[r][k] / M[k][k];
      for (let c = k; c < 3; c++) M[r][c] -= m * M[k][c];
      v[r] -= m * v[k];
    }
  }
  const x = [0, 0, 0];
  for (let k = 2; k >= 0; k--) {
    let s = v[k];
    for (let c = k + 1; c < 3; c++) s -= M[k][c] * x[c];
    x[k] = s / M[k][k];
  }
  const [a, b] = x;
  return { amp: Math.hypot(a, b), phaseDeg: (Math.atan2(b, a) * 180) / Math.PI };
}

describe('stiff RC: 1 µs and 1 s time constants in one circuit', () => {
  const [r] = runDeck(`stiff rc
V1 in 0 PULSE(0 1 1m 1n 1n 100 200)
R1 in f 1k
C1 f 0 1n
R2 in s 1k
C2 s 0 1m
.tran 10m 3
.end`);
  const t = scaleOf(r);
  const vf = vec(r, 'V(f)').re;
  const vs = vec(r, 'V(s)').re;

  it('time axis is strictly increasing and ends exactly at tstop', () => {
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeCloseTo(3, 12);
  });

  it('PULSE corner td is a timepoint (td+tr is within minBreak = 5e-5·maxStep and is merged, as in SPICE3)', () => {
    const has = (x: number) => t.some((v) => Math.abs(v - x) < 1e-15);
    expect(has(1e-3)).toBe(true);
  });

  it('fast node (τ = 1 µs) is settled to within 1 % at every timepoint later than td + 50 µs', () => {
    // Exact: |1 − v| = e^(−50) at td+50 µs. A 1 % band is well above the trtol·reltol LTE budget,
    // so only an integration artefact can break it. The first sample after the edge is a
    // backward-Euler step of ~15τ (6 % low, SPICE3 does the same) and is deliberately excluded;
    // what fails here is the trapezoidal ringing that follows it: ±1 % alternation for > 3 ms
    // (3000 time constants), because the trap amplification (1−h/2τ)/(1+h/2τ) → −1 as h ≫ τ.
    let worst = 0;
    let worstT = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] > 1e-3 + 50e-6 && Math.abs(1 - vf[i]) > worst) {
        worst = Math.abs(1 - vf[i]);
        worstT = t[i];
      }
    }
    expect(worst, `worst |1 − V(f)| = ${worst} at t = ${worstT}`).toBeLessThan(1e-2);
    // still ringing by more than 0.5 % three milliseconds (3000 τ) after the edge
    const late = t.findIndex((x) => x > 4e-3);
    expect(Math.abs(1 - vf[late]), `|1 − V(f)| at t = ${t[late]}`).toBeLessThan(5e-3);
  });

  it('same circuit with method=gear has no ringing on the fast node', () => {
    const [g] = runDeck(`stiff rc gear
V1 in 0 PULSE(0 1 1m 1n 1n 100 200)
R1 in f 1k
C1 f 0 1n
R2 in s 1k
C2 s 0 1m
.options method=gear
.tran 10m 3
.end`);
    const tg = scaleOf(g);
    const vg = vec(g, 'V(f)').re;
    let worst = 0;
    for (let i = 0; i < tg.length; i++) if (tg[i] > 1e-3 + 50e-6) worst = Math.max(worst, Math.abs(1 - vg[i]));
    expect(worst).toBeLessThan(1e-2);
    expect(Math.abs(interp(tg, vec(g, 'V(s)').re, 2) - (1 - Math.exp(-(2 - 1e-3))))).toBeLessThan(2e-3);
  });

  it('slow node follows 1 − exp(−(t−td)/1 s) for seconds after the fast transient', () => {
    for (const tt of [0.5, 1, 2, 3]) {
      const ref = 1 - Math.exp(-(tt - 1e-3) / 1);
      expect(Math.abs(interp(t, vs, tt) - ref)).toBeLessThan(2e-3);
    }
  });

  it('uses few points: the step grows back to tstep after the edge (no 1 µs stepping for 3 s)', () => {
    // 3 s at the 10 ms maximum step = 300 points; allow a few hundred for the edge recovery.
    expect(t.length).toBeLessThan(1500);
  });
});

describe('PULSE train: edges, levels and period', () => {
  const [r] = runDeck(`pulse
V1 in 0 PULSE(-1 2 10u 1u 2u 20u 50u)
R1 in 0 1k
.tran 1u 200u
.end`);
  const t = scaleOf(r);
  const v = vec(r, 'V(in)').re;

  it('every corner is a timepoint with the exact source value', () => {
    for (let k = 0; k < 3; k++) {
      const base = 10e-6 + k * 50e-6;
      const corners: [number, number][] = [
        [base, -1],
        [base + 1e-6, 2],
        [base + 21e-6, 2],
        [base + 23e-6, -1],
      ];
      for (const [tc, vc] of corners) {
        const i = t.findIndex((x) => Math.abs(x - tc) < 1e-14);
        expect(i, `corner t=${tc}`).toBeGreaterThanOrEqual(0);
        expect(v[i]).toBeCloseTo(vc, 12);
      }
    }
  });

  it('mid-edge values are linear ramps', () => {
    expect(interp(t, v, 10.5e-6)).toBeCloseTo(0.5, 9);
    expect(interp(t, v, 32e-6)).toBeCloseTo(0.5, 9); // falling edge midpoint (31..33 µs)
  });
});

describe('sinusoidal steady state of an RC low-pass at its corner', () => {
  const f = 1e3;
  const R = 1e3;
  const C = 1 / (2 * Math.PI * f * R);
  const [r] = runDeck(`rc ss
V1 in 0 SIN(0 1 ${f})
R1 in out ${R}
C1 out 0 ${C}
.tran 10u 6m
.end`);
  const t = scaleOf(r);

  it('input amplitude 1, phase 0 (fit sanity)', () => {
    const fit = fitSine(t, vec(r, 'V(in)').re, f, 3e-3, 6e-3);
    expect(fit.amp).toBeCloseTo(1, 4);
    expect(fit.phaseDeg).toBeCloseTo(0, 2);
  });

  it('output amplitude 1/√2 (±0.3 %) and phase −45° (±0.3°)', () => {
    const fit = fitSine(t, vec(r, 'V(out)').re, f, 3e-3, 6e-3);
    expect(Math.abs(fit.amp - Math.SQRT1_2) / Math.SQRT1_2).toBeLessThan(3e-3);
    expect(Math.abs(fit.phaseDeg + 45)).toBeLessThan(0.3);
  });
});

describe('LC tank energy conservation (trapezoidal is energy-preserving for linear LC)', () => {
  const L = 1e-3;
  const C = 1e-6;
  const T = 2 * Math.PI * Math.sqrt(L * C);
  const [r] = runDeck(`lc
C1 a 0 ${C} ic=1
L1 a 0 ${L}
.tran 1u ${100 * T} uic
.end`);
  const t = scaleOf(r);
  const v = vec(r, 'V(a)').re;
  const iL = vec(r, 'I(L1)').re;

  it('starts at the initial condition', () => {
    expect(v[0]).toBeCloseTo(1, 9);
  });

  it('total energy ½CV² + ½LI² stays within 0.5 % over 100 periods (samples after t = 0)', () => {
    // the t = 0 sample is checked separately above; here only the integration is judged
    const e0 = 0.5 * C;
    let maxDev = 0;
    for (let i = 1; i < t.length; i++) {
      const e = 0.5 * C * v[i] * v[i] + 0.5 * L * iL[i] * iL[i];
      maxDev = Math.max(maxDev, Math.abs(e - e0) / e0);
    }
    expect(maxDev).toBeLessThan(5e-3);
  });

  it('oscillation period equals 2π√(LC) within 0.1 %', () => {
    const up = crossTimes(t, v, 0, 'rise');
    expect(up.length).toBeGreaterThan(90);
    const period = (up[up.length - 1] - up[0]) / (up.length - 1);
    expect(Math.abs(period - T) / T).toBeLessThan(1e-3);
  });

  it('inductor current amplitude is V0·√(C/L)', () => {
    const tail = Array.from(iL.slice(Math.floor(iL.length * 0.9)));
    expect(Math.abs(Math.max(...tail) - Math.sqrt(C / L)) / Math.sqrt(C / L)).toBeLessThan(5e-3);
  });
});

describe('Gear-2 method on the same RC (method=gear)', () => {
  it('RC charge 1 − e^(−t/τ) within 2e-3', () => {
    const [r] = runDeck(`rc gear
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.options method=gear
.tran 10u 5m
.end`);
    const t = scaleOf(r);
    const v = vec(r, 'V(out)').re;
    for (const tt of [0.5e-3, 1e-3, 2e-3, 4e-3]) {
      expect(Math.abs(interp(t, v, tt) - (1 - Math.exp(-(tt - 0.5e-9) / 1e-3)))).toBeLessThan(2e-3);
    }
  });
});
