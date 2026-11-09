/**
 * Jiles–Atherton hysteresis core and eddy-current loss through the whole path (library part ->
 * netlister -> engine). The flux-driven netlist is checked against an independent H-driven RK4
 * integration of the published equations fed with the same H(t) the circuit produced, against the
 * analytic initial susceptibility (AC analysis), the anhysteretic limit k -> 0, the classical eddy-loss
 * formula, the rate independence of the static loop and the ideal turns ratio of the transformer.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '..';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { MU0, eddyConductance, eddyLossDensity, langevin, langevinSlope, type JilesAthertonCore } from './magneticCore';

const N = 100;
const AE = 100e-6;
const LE = 0.1;
const SOFT = { ms: 1.6e6, a: 1100, k: 400, c: 0.2, alpha: 1.6e-3 };

function bench(parts: (b: DesignBuilder) => void) {
  const b = new DesignBuilder('bench');
  parts(b);
  const build = buildNetlist(b.design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
  return build;
}

function run(build: ReturnType<typeof bench>, spec: AnalysisSpec): AnalysisResult {
  const [r] = runAnalyses({ ...build.netlist, analyses: [spec] });
  expect(r.error, r.error).toBeUndefined();
  return r;
}

const vec = (r: AnalysisResult, name: string): Float64Array => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v.re;
};

/** Core inductor driven by a cosine voltage source (so the flux is the symmetric sine lambda = Vpk sin(wt)/w). */
function inductorBench(params: Record<string, string>, vpk: number, freq: number, id = 'basic/inductor-hysteresis') {
  return bench((b) => {
    const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: String(vpk), freq: String(freq), phase: '90' });
    const l = b.part(id, 'L1', 200, 0, { rser: '0', ...params });
    b.labelPin(v, '+', 'a');
    b.labelPin(l, '1', 'a');
    b.labelPin(v, '-', '0');
    b.labelPin(l, '2', '0');
  });
}

// ---- independent Jiles–Atherton integrator (H-driven RK4), written from the published equations ----

interface JaSet {
  ms: number;
  a: number;
  k: number;
  c: number;
  alpha: number;
}

function totalM(h: number, mirr: number, p: JaSet): { m: number; man: number } {
  let m = (1 - p.c) * mirr + p.c * p.ms * langevin(h / p.a);
  for (let i = 0; i < 80; i++) {
    const he = h + p.alpha * m;
    const man = p.ms * langevin(he / p.a);
    const next = (1 - p.c) * mirr + p.c * man;
    if (Math.abs(next - m) < 1e-9) {
      m = next;
      break;
    }
    m = next;
  }
  return { m, man: p.ms * langevin((h + p.alpha * m) / p.a) };
}

function dMirrDH(h: number, mirr: number, delta: number, p: JaSet): number {
  const { man } = totalM(h, mirr, p);
  const d = man - mirr;
  if (delta * d <= 0) return 0;
  return d / (p.k * delta - p.alpha * d);
}

/** B(t) for a given H(t) (samples), by RK4 in H with `sub` sub-steps per sample interval. */
function referenceB(h: ArrayLike<number>, p: JaSet, sub = 40): Float64Array {
  const out = new Float64Array(h.length);
  let mirr = 0;
  out[0] = MU0 * (h[0] + totalM(h[0], mirr, p).m);
  for (let i = 1; i < h.length; i++) {
    const dh = h[i] - h[i - 1];
    const delta = dh >= 0 ? 1 : -1;
    const step = dh / sub;
    let hh = h[i - 1];
    for (let s = 0; s < sub; s++) {
      const k1 = dMirrDH(hh, mirr, delta, p);
      const k2 = dMirrDH(hh + step / 2, mirr + (k1 * step) / 2, delta, p);
      const k3 = dMirrDH(hh + step / 2, mirr + (k2 * step) / 2, delta, p);
      const k4 = dMirrDH(hh + step, mirr + k3 * step, delta, p);
      mirr += (step * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
      hh += step;
    }
    out[i] = MU0 * (h[i] + totalM(h[i], mirr, p).m);
  }
  return out;
}

/** Coercive field and remanence of the last full cycle: zero crossings of B on the falling and of H on the falling branch. */
function loopFigures(t: Float64Array, h: ArrayLike<number>, b: ArrayLike<number>, period: number): { hc: number; br: number; bpk: number; hpk: number; area: number } {
  const t1 = t[t.length - 1];
  const t0 = t1 - period;
  let hc = NaN;
  let br = NaN;
  let bpk = 0;
  let hpk = 0;
  let area = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i] < t0) continue;
    bpk = Math.max(bpk, Math.abs(b[i]));
    hpk = Math.max(hpk, Math.abs(h[i]));
    area += ((h[i] + h[i - 1]) / 2) * (b[i] - b[i - 1]);
    // descending branch (dH/dt < 0): B crosses zero at -Hc, H crosses zero at Br
    if (h[i] < h[i - 1] && b[i - 1] > 0 && b[i] <= 0) hc = Math.abs(h[i - 1] + ((h[i] - h[i - 1]) * b[i - 1]) / (b[i - 1] - b[i]));
    if (h[i] < h[i - 1] && h[i - 1] > 0 && h[i] <= 0) br = b[i - 1] + ((b[i] - b[i - 1]) * h[i - 1]) / (h[i - 1] - h[i]);
  }
  return { hc, br, bpk, hpk, area };
}

describe('Jiles–Atherton netlist: helper functions', () => {
  it('the Langevin function and its slope', () => {
    expect(langevin(0)).toBe(0);
    expect(langevin(1)).toBeCloseTo(1 / Math.tanh(1) - 1, 12);
    expect(langevin(30)).toBeCloseTo(1 - 1 / 30, 9);
    expect(langevinSlope(0)).toBeCloseTo(1 / 3, 12);
    const h = 1e-6;
    for (const x of [0.005, 0.5, 2, 8]) expect(langevinSlope(x)).toBeCloseTo((langevin(x + h) - langevin(x - h)) / (2 * h), 5);
  });

  it('the eddy-current conductance is l d^2 / (12 rho N^2 A) and reproduces the classical loss formula', () => {
    const core: Pick<JilesAthertonCore, 'n' | 'ae' | 'le' | 'lamination' | 'rho'> = { n: N, ae: AE, le: LE, lamination: 0.35e-3, rho: 0.47e-6 };
    const g = eddyConductance(core);
    expect(g).toBeCloseTo((LE * 0.35e-3 * 0.35e-3) / (12 * 0.47e-6 * N * N * AE), 12);
    // sine of peak flux density 1.2 T at 50 Hz across the winding: Vpk = 2 pi f N A Bpk, P = G Vpk^2 / 2
    const f = 50;
    const bpk = 1.2;
    const vpk = 2 * Math.PI * f * N * AE * bpk;
    expect((g * vpk * vpk) / 2 / (AE * LE) / eddyLossDensity(core, bpk, f)).toBeCloseTo(1, 12);
    expect(eddyConductance({ ...core, lamination: 0 })).toBe(0);
  });
});

describe('Jiles–Atherton core in the circuit', () => {
  it('registers the inductors and the transformer in the library', () => {
    for (const id of ['basic/inductor-hysteresis', 'basic/inductor-hysteresis-ferrite', 'basic/inductor-hysteresis-hard', 'basic/transformer-hysteresis']) {
      const p = getPart(id);
      expect(p, id).toBeDefined();
      expect(p!.toSpice).toBeTypeOf('function');
    }
  });

  // 50 Hz, flux density amplitude 1.5 T: Vpk = 2 pi f N A B
  const f = 50;
  const bTarget = 1.5;
  const vpk = 2 * Math.PI * f * N * AE * bTarget;
  const period = 1 / f;
  const sim = (() => {
    const build = inductorBench({ lam: '0' }, vpk, f);
    return run(build, { type: 'tran', tstep: 2e-5, tstop: 4 * period, tmax: 2e-5 });
  })();
  const t = sim.scale!.re;
  const bSim = vec(sim, 'V(L1.b)');
  const hSim = vec(sim, 'V(L1.h)');

  it('the flux density follows the voltage: B(t) = Vpk sin(wt) / (w N A) (flux-driven)', () => {
    const w = 2 * Math.PI * f;
    let worst = 0;
    for (let i = 0; i < t.length; i++) worst = Math.max(worst, Math.abs(bSim[i] - (vpk * Math.sin(w * t[i])) / (w * N * AE)));
    expect(worst).toBeLessThan(2e-3 * bTarget);
  });

  it('B(t) agrees with an independent RK4 integration of the Jiles–Atherton equations driven by the same H(t) (within 1.5 % of the peak)', () => {
    const ref = referenceB(hSim, SOFT);
    let worst = 0;
    for (let i = 0; i < t.length; i++) worst = Math.max(worst, Math.abs(bSim[i] - ref[i]));
    expect(worst).toBeLessThan(0.015 * bTarget);
  });

  it('coercive field, remanence and loop area match the independent reference loop (3 %)', () => {
    const fig = loopFigures(t, hSim, bSim, period);
    // reference: sweep H sinusoidally to the same peak with the independent integrator and read the same figures
    const hpk = fig.hpk;
    const n = 4000;
    const hRef = new Float64Array(4 * n + 1);
    const tRef = new Float64Array(4 * n + 1);
    for (let i = 0; i <= 4 * n; i++) {
      tRef[i] = (i / n) * period;
      hRef[i] = hpk * Math.sin((2 * Math.PI * i) / n);
    }
    const bRef = referenceB(hRef, SOFT, 4);
    const rf = loopFigures(tRef, hRef, bRef, period);
    expect(fig.hc).toBeGreaterThan(100);
    expect(Math.abs(fig.hc / rf.hc - 1)).toBeLessThan(0.03);
    expect(Math.abs(fig.br / rf.br - 1)).toBeLessThan(0.03);
    expect(Math.abs(fig.area / rf.area - 1)).toBeLessThan(0.03);
    expect(Math.abs(fig.bpk / rf.bpk - 1)).toBeLessThan(0.03);
    // the loop is traversed counter-clockwise: positive area = loss per cycle and volume (J/m^3)
    expect(fig.area).toBeGreaterThan(0);
    expect(fig.br).toBeGreaterThan(0.3);
    expect(fig.br).toBeLessThan(1.6);
  });

  it('the static loop does not depend on the frequency (10 Hz and 50 Hz give the same coercive field)', () => {
    const f2 = 10;
    const v2 = 2 * Math.PI * f2 * N * AE * bTarget;
    const slow = run(inductorBench({ lam: '0' }, v2, f2), { type: 'tran', tstep: 1e-4, tstop: 4 / f2, tmax: 1e-4 });
    const a = loopFigures(slow.scale!.re, vec(slow, 'V(L1.h)'), vec(slow, 'V(L1.b)'), 1 / f2);
    const b = loopFigures(t, hSim, bSim, period);
    expect(Math.abs(a.hc / b.hc - 1)).toBeLessThan(0.04);
    expect(Math.abs(a.area / b.area - 1)).toBeLessThan(0.05);
  });

  it('k -> 0 removes the hysteresis: B(H) follows the anhysteretic curve and the loop area vanishes', () => {
    const noLoop = run(inductorBench({ lam: '0', k: '0.001' }, vpk, f), { type: 'tran', tstep: 2e-5, tstop: 4 * period, tmax: 2e-5 });
    const h = vec(noLoop, 'V(L1.h)');
    const b = vec(noLoop, 'V(L1.b)');
    const fig = loopFigures(noLoop.scale!.re, h, b, period);
    const loop = loopFigures(t, hSim, bSim, period);
    expect(Math.abs(fig.area)).toBeLessThan(0.02 * loop.area);
    // anhysteretic B: M solves M = Ms L((H + alpha M)/a) (c does not matter when Mirr follows Man)
    let worst = 0;
    for (let i = 0; i < h.length; i++) {
      let m = SOFT.ms * langevin(h[i] / SOFT.a);
      for (let it = 0; it < 100; it++) m = SOFT.ms * langevin((h[i] + SOFT.alpha * m) / SOFT.a);
      worst = Math.max(worst, Math.abs(b[i] - MU0 * (h[i] + m)));
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('a harder material (larger k) gives a wider loop', () => {
    const hard = run(inductorBench({ lam: '0', k: '1500' }, vpk, f), { type: 'tran', tstep: 2e-5, tstop: 4 * period, tmax: 2e-5 });
    const a = loopFigures(hard.scale!.re, vec(hard, 'V(L1.h)'), vec(hard, 'V(L1.b)'), period);
    const b = loopFigures(t, hSim, bSim, period);
    expect(a.hc).toBeGreaterThan(2 * b.hc);
    expect(a.area).toBeGreaterThan(2 * b.area);
  });

  it('the small-signal inductance is mu0 (1 + chi_i) N^2 A / l with the analytic initial susceptibility', () => {
    const build = bench((b) => {
      const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '0', acmag: '1' });
      const l = b.part('basic/inductor-hysteresis', 'L1', 200, 0, { lam: '0', rser: '0' });
      b.labelPin(v, '+', 'a');
      b.labelPin(l, '1', 'a');
      b.labelPin(v, '-', '0');
      b.labelPin(l, '2', '0');
    });
    const ac = run(build, { type: 'ac', sweep: 'lin', points: 1, fstart: 10, fstop: 10 });
    const iv = ac.vectors.find((x) => x.name.toLowerCase() === 'i(v1)')!;
    const imag = Math.hypot(iv.re[0], iv.im![0]);
    const g = (SOFT.c * SOFT.ms) / (3 * SOFT.a);
    const chi = g / (1 - SOFT.alpha * g);
    const lAc = (MU0 * (1 + chi) * N * N * AE) / LE;
    // |I| = V / (w L) with the 1 Gohm core-path resistor in parallel (negligible)
    expect(imag * 2 * Math.PI * 10 * lAc).toBeCloseTo(1, 3);
  });
});

describe('eddy-current loss in the circuit', () => {
  it('the netlist carries the resistor 1 / G and the dissipated power equals the classical formula', () => {
    const f = 50;
    const bpk = 1.0;
    const vpk = 2 * Math.PI * f * N * AE * bpk;
    const build = inductorBench({ lam: '350', rho: '0.47', k: '0.001', ms: '1', a: '1e6' }, vpk, f);
    const eddy = build.netlist.elements.find((e) => e.type === 'R' && /eddy/i.test(e.name));
    expect(eddy).toBeDefined();
    const core = { n: N, ae: AE, le: LE, lamination: 0.35e-3, rho: 0.47e-6 };
    expect(eddy!.value!).toBeCloseTo(1 / eddyConductance(core), 6);
    // average power of that resistor under the sinusoidal winding voltage vs P/V from the classical formula
    const p = (vpk * vpk) / 2 / eddy!.value!;
    expect(p / (eddyLossDensity(core, bpk, f) * AE * LE)).toBeCloseTo(1, 9);
    // doubling the frequency at the same flux density quadruples the loss; doubling the thickness quadruples it too
    expect(eddyLossDensity(core, bpk, 2 * f) / eddyLossDensity(core, bpk, f)).toBeCloseTo(4, 12);
    expect(eddyLossDensity({ ...core, lamination: 0.7e-3 }, bpk, f) / eddyLossDensity(core, bpk, f)).toBeCloseTo(4, 12);
  });

  it('the winding current includes the eddy-current share: i = H l / N + v G', () => {
    const f = 50;
    const vpk = 2 * Math.PI * f * N * AE * 1.0;
    const build = bench((b) => {
      const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: String(vpk), freq: String(f), phase: '90' });
      const l = b.part('basic/inductor-hysteresis', 'L1', 200, 0, { rser: '0', lam: '350' });
      b.labelPin(v, '+', 'a');
      b.labelPin(l, '1', 'a');
      b.labelPin(v, '-', '0');
      b.labelPin(l, '2', '0');
    });
    const r = run(build, { type: 'tran', tstep: 2e-5, tstop: 3 / f, tmax: 2e-5 });
    const t = r.scale!.re;
    const h = vec(r, 'V(L1.h)');
    const iv = vec(r, 'I(V1)');
    const ge = eddyConductance({ n: N, ae: AE, le: LE, lamination: 0.35e-3, rho: 0.47e-6 });
    let worst = 0;
    let peak = 0;
    for (let i = 0; i < t.length; i++) {
      const winding = (h[i] * LE) / N + vpk * Math.cos(2 * Math.PI * f * t[i]) * ge + vpk * Math.cos(2 * Math.PI * f * t[i]) * 1e-9;
      worst = Math.max(worst, Math.abs(-iv[i] - winding));
      peak = Math.max(peak, Math.abs(winding));
    }
    expect(worst).toBeLessThan(0.01 * peak);
  });
});

describe('transformer with a hysteresis core', () => {
  it('keeps the exact turns ratio at no load and draws a distorted magnetising current', () => {
    const f = 50;
    const bpk = 1.4;
    const vpk = 2 * Math.PI * f * N * AE * bpk;
    const build = bench((b) => {
      const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: String(vpk), freq: String(f), phase: '90' });
      const x = b.part('basic/transformer-hysteresis', 'T1', 300, 0, { ratio: '5', rser: '0', rs: '0', lam: '0' });
      const rl = b.part('basic/resistor', 'R1', 600, 0, { value: '1Meg' });
      b.labelPin(v, '+', 'p');
      b.labelPin(x, 'P1', 'p');
      b.labelPin(v, '-', '0');
      b.labelPin(x, 'P2', '0');
      b.labelPin(x, 'S1', 's');
      b.labelPin(x, 'S2', '0');
      b.labelPin(rl, '1', 's');
      b.labelPin(rl, '2', '0');
    });
    const r = run(build, { type: 'tran', tstep: 2e-5, tstop: 3 / f, tmax: 2e-5 });
    const t = r.scale!.re;
    const vp = vec(r, 'V(p)');
    const vs = vec(r, 'V(s)');
    for (let i = Math.floor(t.length / 3); i < t.length; i += 7) expect(vs[i]).toBeCloseTo(vp[i] / 5, 3);
    // the magnetising current is far from sinusoidal: third-harmonic content above 10 % of the fundamental
    const iv = vec(r, 'I(V1)');
    const t0 = t[t.length - 1] - 1 / f;
    let c1 = 0;
    let s1 = 0;
    let c3 = 0;
    let s3 = 0;
    let n = 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i] < t0) continue;
      const dt = t[i] - t[i - 1];
      const w = 2 * Math.PI * f;
      c1 += iv[i] * Math.cos(w * t[i]) * dt;
      s1 += iv[i] * Math.sin(w * t[i]) * dt;
      c3 += iv[i] * Math.cos(3 * w * t[i]) * dt;
      s3 += iv[i] * Math.sin(3 * w * t[i]) * dt;
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(Math.hypot(c3, s3) / Math.hypot(c1, s1)).toBeGreaterThan(0.1);
  });
});
