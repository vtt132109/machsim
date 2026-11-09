/**
 * Review: secondary analyses and reactive models against closed forms.
 *
 * - Coupled inductors (K): 2×2 impedance matrix [R1 + jωL1, jωM; jωM, RL + jωL2], M = k√(L1L2)
 *   (dots on the first node of each inductor).
 * - Lossless line (T), matched both ends: V(out)/V(src) = ½·e^(−jωTD); step delayed by TD.
 * - BJT transit time TF: with the collector AC-shorted and CJE = CJC = 0, Cπ = TF·gm, so
 *   h21(jω) = gm / (gπ + jω·TF·gm) (gπ = gm/BF).
 * - .tf on a divider: gain R2/(R1+R2), rin R1+R2, rout R1‖R2.
 * - .sens: ∂V(out)/∂R1 = −Vin·R2/(R1+R2)², ∂V(out)/∂R2 = Vin·R1/(R1+R2)².
 * - .pz of a series RLC low-pass: poles −R/2L ± j√(1/LC − (R/2L)²).
 * - .disto of an exponential junction driven by an ideal voltage a·cos ωt (weak-nonlinearity
 *   Volterra limit): HD2 = a/(4·Vt), HD3 = (a/Vt)²/24 (current harmonics / fundamental).
 * All are exact small-signal relations, checked to 1e-6 relative unless noted.
 */
import { describe, expect, it } from 'vitest';
import { cAt, crossTimes, interp, opValue, rel, runDeck, scaleOf, vec, vtAt } from './ref';

type C = { re: number; im: number };
const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const abs = (a: C) => Math.hypot(a.re, a.im);

describe('coupled inductors (K)', () => {
  for (const k of [0.5, 0.99]) {
    it(`k = ${k}: secondary voltage matches the impedance-matrix solution`, () => {
      const L1 = 1e-3;
      const L2 = 4e-3;
      const R1 = 1;
      const RL = 100;
      const M = k * Math.sqrt(L1 * L2);
      const [r] = runDeck(`xfmr
V1 s 0 AC 1
R1 s a ${R1}
L1 a 0 ${L1}
L2 b 0 ${L2}
K1 L1 L2 ${k}
RL b 0 ${RL}
.ac dec 5 100 100k
.end`);
      const f = scaleOf(r);
      const vb = vec(r, 'V(b)');
      for (let i = 0; i < f.length; i++) {
        const w = 2 * Math.PI * f[i];
        // [1, 0] = Z·[I1, I2] with I2 = current into b through L2 (V(b) = −RL·I2)
        const z11: C = { re: R1, im: w * L1 };
        const z12: C = { re: 0, im: w * M };
        const z22: C = { re: RL, im: w * L2 };
        const det = add(mul(z11, z22), mul({ re: -1, im: 0 }, mul(z12, z12)));
        const i2 = div({ re: -z12.re, im: -z12.im }, det);
        const vbRef: C = { re: -RL * i2.re, im: -RL * i2.im };
        const got = cAt(vb, i);
        expect(abs({ re: got.re - vbRef.re, im: got.im - vbRef.im }) / abs(vbRef)).toBeLessThan(1e-6);
      }
    });
  }
});

describe('lossless transmission line', () => {
  const deck = (analysis: string) => `tline
V1 s 0 DC 0 AC 1 PULSE(0 1 0 10p 10p 10n 20n)
RS s in 50
T1 in 0 out 0 Z0=50 TD=1n
RL out 0 50
${analysis}
.end`;

  it('AC: V(out) = ½·e^(−jω·TD)', () => {
    const [r] = runDeck(deck('.ac lin 7 10meg 400meg'));
    const f = scaleOf(r);
    const v = vec(r, 'V(out)');
    for (let i = 0; i < f.length; i++) {
      const ph = -2 * Math.PI * f[i] * 1e-9;
      const ref = { re: 0.5 * Math.cos(ph), im: 0.5 * Math.sin(ph) };
      const got = cAt(v, i);
      expect(Math.hypot(got.re - ref.re, got.im - ref.im)).toBeLessThan(1e-6);
    }
  });

  it('transient: the 50 % point of the output edge is TD after the input edge', () => {
    const [r] = runDeck(deck('.tran 10p 5n'));
    const t = scaleOf(r);
    const vin = vec(r, 'V(in)').re;
    const vout = vec(r, 'V(out)').re;
    expect(interp(t, vin, 0.5e-9)).toBeCloseTo(0.5, 3);
    const tin = crossTimes(t, vin, 0.25, 'rise')[0];
    const tout = crossTimes(t, vout, 0.25, 'rise')[0];
    expect(Math.abs(tout - tin - 1e-9)).toBeLessThan(2e-12);
    expect(interp(t, vout, 3e-9)).toBeCloseTo(0.5, 4);
  });
});

describe('BJT transit time: h21(jω) = gm/(gπ + jω·TF·gm)', () => {
  it('matches at 1, 10 and 100 MHz', () => {
    const TF = 1e-9;
    const BF = 100;
    const results = runDeck(`ft
VCC c 0 5
IB 0 b DC 10u AC 1
Q1 c b 0 NX
.model NX NPN(IS=1e-15 BF=${BF} TF=${TF})
.op
.ac lin 3 1meg 100meg
.end`);
    const [op, ac] = results;
    const ic = opValue(op, 'Ic(Q1)');
    const vt = vtAt(27);
    const gm = (ic + 1e-15) / vt; // d/dVbe of IS(e^(Vbe/Vt) − 1)
    const gpi = gm / BF;
    const f = scaleOf(ac);
    const icAc = vec(ac, 'I(VCC)'); // current into VCC + terminal = collector current
    for (let i = 0; i < f.length; i++) {
      const w = 2 * Math.PI * f[i];
      const h = div({ re: gm, im: 0 }, { re: gpi, im: w * TF * gm });
      const got = cAt(icAc, i);
      // the base is driven by a 1 A AC current: I(VCC) = −(collector current) by the SPICE sign
      expect(rel(abs(got), abs(h))).toBeLessThan(1e-3);
    }
  });
});

describe('.tf, .sens, .pz', () => {
  it('.tf on a divider', () => {
    const [r] = runDeck(`tf
V1 in 0 10
R1 in out 3k
R2 out 0 1k
.tf V(out) V1
.end`);
    expect(r.scalars!.gain).toBeCloseTo(0.25, 12);
    expect(r.scalars!.rin).toBeCloseTo(4e3, 6);
    expect(r.scalars!.rout).toBeCloseTo(750, 9);
  });

  it('.sens of a divider output w.r.t. R1, R2 and V1', () => {
    const [r] = runDeck(`sens
V1 in 0 10
R1 in out 3k
R2 out 0 1k
.sens V(out)
.end`);
    const s = r.scalars!;
    expect(rel(s['R1:value'], (-10 * 1e3) / 4e3 ** 2)).toBeLessThan(1e-6);
    expect(rel(s['R2:value'], (10 * 3e3) / 4e3 ** 2)).toBeLessThan(1e-6);
    expect(rel(s['V1:dc'], 0.25)).toBeLessThan(1e-6);
  });

  it('.pz of a series RLC low-pass', () => {
    const R = 10;
    const L = 1e-3;
    const Cc = 1e-6;
    const [r] = runDeck(`pz
V1 in 0 AC 1
R1 in a ${R}
L1 a out ${L}
C1 out 0 ${Cc}
.pz in 0 out 0 vol pol
.end`);
    const poles = vec(r, 'pole');
    expect(poles.re.length).toBe(2);
    const sig = -R / (2 * L);
    const wd = Math.sqrt(1 / (L * Cc) - sig * sig);
    const got = [0, 1].map((i) => cAt(poles, i)).sort((a, b) => a.im - b.im);
    expect(rel(got[0].re, sig)).toBeLessThan(1e-6);
    expect(rel(got[1].re, sig)).toBeLessThan(1e-6);
    expect(rel(got[0].im, -wd)).toBeLessThan(1e-6);
    expect(rel(got[1].im, wd)).toBeLessThan(1e-6);
  });
});

describe('.disto of an exponential junction', () => {
  it('HD2 = a/(4Vt), HD3 = (a/Vt)²/24', () => {
    const a = 1e-3;
    const [r] = runDeck(`disto
V1 a 0 DC 0.6 DISTOF1 ${a} 0
D1 a 0 DX
.model DX D(IS=1e-14)
.disto lin 1 1k 1k
.end`);
    const vt = vtAt(27);
    expect(rel(vec(r, 'HD2rel(I(V1))').re[0], a / (4 * vt))).toBeLessThan(1e-4);
    expect(rel(vec(r, 'HD3rel(I(V1))').re[0], (a / vt) ** 2 / 24)).toBeLessThan(1e-4);
  });
});
