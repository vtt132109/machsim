import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../sim/results';
import {
  c,
  cabs,
  cargDeg,
  cdiv,
  cmul,
  csub,
  gammaToZ,
  networkAnalysisSpec,
  powerGains,
  reactanceCircle,
  resistanceCircle,
  rollett,
  sParametersFromAc,
  sToH,
  sToY,
  sToZ,
  twoPortAt,
  zToGamma,
  zToS,
  type Complex,
  type TwoPort,
} from './network';

const close = (a: Complex, b: Complex, digits = 10) => {
  expect(a.re).toBeCloseTo(b.re, digits);
  expect(a.im).toBeCloseTo(b.im, digits);
};

/** T network: series Za (port 1), Zb (port 2), shunt Zc. */
function teeZ(za: Complex, zb: Complex, zc: Complex): TwoPort {
  return { p11: { re: za.re + zc.re, im: za.im + zc.im }, p12: zc, p21: zc, p22: { re: zb.re + zc.re, im: zb.im + zc.im } };
}

describe('two-port conversions', () => {
  const z0 = 50;
  const z = teeZ(c(10, 5), c(20, -15), c(100, 30));
  const s = zToS(z, z0);

  it('round-trips Z -> S -> Z', () => {
    const back = sToZ(s, z0);
    close(back.p11, z.p11);
    close(back.p12, z.p12);
    close(back.p21, z.p21);
    close(back.p22, z.p22);
  });

  it('Y is the inverse of Z', () => {
    const y = sToY(s, z0);
    // Z * Y = identity
    const i11 = { re: cmul(z.p11, y.p11).re + cmul(z.p12, y.p21).re, im: cmul(z.p11, y.p11).im + cmul(z.p12, y.p21).im };
    const i12 = { re: cmul(z.p11, y.p12).re + cmul(z.p12, y.p22).re, im: cmul(z.p11, y.p12).im + cmul(z.p12, y.p22).im };
    close(i11, c(1));
    close(i12, c(0));
  });

  it('H parameters match their definition from Z', () => {
    const h = sToH(s, z0);
    const det = csub(cmul(z.p11, z.p22), cmul(z.p12, z.p21));
    close(h.p11, cdiv(det, z.p22));
    close(h.p12, cdiv(z.p12, z.p22));
    close(h.p21, cdiv({ re: -z.p21.re, im: -z.p21.im }, z.p22));
    close(h.p22, cdiv(c(1), z.p22));
  });

  it('reflection coefficient <-> impedance', () => {
    close(zToGamma(c(50), 50), c(0));
    close(zToGamma(c(150), 50), c(0.5));
    close(gammaToZ(zToGamma(c(33, -12), 50), 50), c(33, -12));
  });

  it('a matched attenuator is unconditionally stable', () => {
    // 6 dB-ish symmetric resistive pad, reciprocal and passive
    const pad = zToS(teeZ(c(16.6), c(16.6), c(66.9)), 50);
    const st = rollett(pad);
    expect(st.k).toBeGreaterThan(1);
    expect(st.delta).toBeLessThan(1);
    expect(st.unconditional).toBe(true);
    const g = powerGains(pad);
    expect(g.transducer).toBeCloseTo(cabs(pad.p21) ** 2, 12);
    // reciprocal network: |S21| = |S12| so MSG = 1 and MAG <= 1
    expect(g.msg).toBeCloseTo(1, 12);
    expect(g.mag).toBeLessThanOrEqual(1);
  });
});

describe('S-parameters from AC port voltages', () => {
  // series 50 ohm resistor between the ports, Z0 = 50: S11 = 1/3, S21 = 2/3 (and symmetric)
  const freq = Float64Array.of(1e6, 1e7);
  const port = (v: number) => ({ re: Float64Array.of(v, v), im: Float64Array.of(0, 0) });
  const run = (v1: number, v2: number): AnalysisResult => ({
    type: 'ac',
    title: 'AC',
    scale: { name: 'frequency', unit: 'Hz', re: freq },
    vectors: [
      { name: 'V(p1)', unit: 'V', ...port(v1) },
      { name: 'V(p2)', unit: 'V', ...port(v2) },
    ],
    warnings: [],
  });
  const p1 = { kind: 'voltage' as const, pos: 'p1', neg: '0' };
  const p2 = { kind: 'voltage' as const, pos: 'p2', neg: '0' };

  it('forward run gives S11 and S21', () => {
    const d = sParametersFromAc(run(2 / 3, 1 / 3), p1, p2)!;
    expect(d.full).toBe(false);
    close(d.s[0].p11, c(1 / 3));
    close(d.s[0].p21, c(2 / 3));
    expect(Number.isNaN(d.s[0].p22.re)).toBe(true);
  });

  it('forward + reverse runs give the full matrix', () => {
    const fam: AnalysisResult = { ...run(0, 0), runs: [{ label: 'forward', result: run(2 / 3, 1 / 3) }, { label: 'reverse', result: run(1 / 3, 2 / 3) }] };
    const d = sParametersFromAc(fam, p1, p2)!;
    expect(d.full).toBe(true);
    close(d.s[1].p12, c(2 / 3));
    close(d.s[1].p22, c(1 / 3));
    // the series resistor's Z matrix does not exist, but Y does: y11 = 1/R, y12 = -1/R
    const y = sToY(d.s[1], 50);
    close(y.p11, c(1 / 50));
    close(y.p12, c(-1 / 50));
  });

  it('selects one parameter set at a frequency', () => {
    const d = sParametersFromAc(run(2 / 3, 1 / 3), p1, p2)!;
    const t = twoPortAt(d, 1e6, 'z', 50);
    expect(t).not.toBeNull();
    // forward-only data: Z conversion needs S22 -> NaN
    expect(Number.isNaN(t!.p11.re)).toBe(true);
    const sAt = twoPortAt(d, 3e6, 's', 50)!;
    close(sAt.p21, c(2 / 3));
    expect(cargDeg(sAt.p21)).toBeCloseTo(0, 12);
  });
});

describe('network analyzer setup and Smith chart', () => {
  it('derives the AC sweep from the panel settings', () => {
    expect(networkAnalysisSpec({ fstart: '1M', fstop: '1G', points: '20' })).toEqual({ type: 'ac', sweep: 'dec', points: 20, fstart: 1e6, fstop: 1e9 });
    expect(networkAnalysisSpec({ fstart: '0', fstop: '-1' })).toEqual({ type: 'ac', sweep: 'dec', points: 50, fstart: 1e6, fstop: 1e10 });
  });

  it('constant resistance / reactance circles pass through the right points', () => {
    const r1 = resistanceCircle(1);
    expect(r1).toEqual({ cx: 0.5, cy: 0, r: 0.5 });
    // z = 1 + j1 lies on both the r = 1 and the x = 1 circles
    const g = zToGamma(c(50, 50), 50);
    expect(Math.hypot(g.re - r1.cx, g.im - r1.cy)).toBeCloseTo(r1.r, 12);
    const x1 = reactanceCircle(1);
    expect(Math.hypot(g.re - x1.cx, g.im - x1.cy)).toBeCloseTo(x1.r, 12);
  });
});
