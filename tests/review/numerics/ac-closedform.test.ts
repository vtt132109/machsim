/**
 * Review: AC small-signal transfer functions against exact closed forms.
 *
 * Linear circuits are solved exactly by MNA (one complex LU solve per frequency), so the only
 * error source is floating-point round-off: we require 1e-7 relative agreement of the complex
 * phasor (magnitude AND phase) at every swept frequency.
 *
 * - Sallen-Key low-pass with an ideal VCVS of gain K:
 *     H(s) = K / (1 + s[(R1+R2)·C2 + R1·C1·(1−K)] + s²·R1R2C1C2)
 * - Twin-T notch (R, R, R/2 and C, C, 2C), driven by an ideal source and unloaded:
 *     H(s) = (1 + (sRC)²) / (1 + 4·sRC + (sRC)²),   notch at f0 = 1/(2πRC)
 */
import { describe, expect, it } from 'vitest';
import { cAt, runDeck, scaleOf, vec } from './ref';

type C = { re: number; im: number };
const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const cabs = (a: C) => Math.hypot(a.re, a.im);

function sallenKey(f: number, r1: number, r2: number, c1: number, c2: number, k: number): C {
  const w = 2 * Math.PI * f;
  // denominator 1 − w²R1R2C1C2 + j·w·[(R1+R2)C2 + R1C1(1−K)]
  return cdiv({ re: k, im: 0 }, { re: 1 - w * w * r1 * r2 * c1 * c2, im: w * ((r1 + r2) * c2 + r1 * c1 * (1 - k)) });
}

function twinT(f: number, r: number, c: number): C {
  const x = 2 * Math.PI * f * r * c; // s·RC = j·x
  return cdiv({ re: 1 - x * x, im: 0 }, { re: 1 - x * x, im: 4 * x });
}

describe('Sallen-Key low-pass (ideal VCVS amplifier)', () => {
  for (const k of [1, 1.586, 2.5]) {
    it(`K = ${k}: complex response matches the closed form to 1e-7`, () => {
      const r1 = 10e3;
      const r2 = 22e3;
      const c1 = 10e-9;
      const c2 = 4.7e-9;
      const [r] = runDeck(`sallen-key K=${k}
VIN in 0 DC 0 AC 1
R1 in n1 ${r1}
R2 n1 p ${r2}
C2 p 0 ${c2}
C1 n1 out ${c1}
E1 out 0 p 0 ${k}
.ac dec 25 10 1meg
.end`);
      const f = scaleOf(r);
      const vout = vec(r, 'V(out)');
      const vin = vec(r, 'V(in)');
      expect(f.length).toBeGreaterThan(100);
      for (let i = 0; i < f.length; i++) {
        const h = cdiv(cAt(vout, i), cAt(vin, i));
        const ref = sallenKey(f[i], r1, r2, c1, c2, k);
        expect(cabs(csub(h, ref)) / cabs(ref)).toBeLessThan(1e-7);
      }
    });
  }

  it('Butterworth design (K = 1, equal R, C1 = 2·C2) is −3.01 dB at f0 = 1/(2π·R·C·√2)', () => {
    const R = 10e3;
    const C = 10e-9;
    const f0 = 1 / (2 * Math.PI * R * C * Math.SQRT2);
    const [r] = runDeck(`butterworth
VIN in 0 AC 1
R1 in n1 ${R}
R2 n1 p ${R}
C2 p 0 ${C}
C1 n1 out ${2 * C}
E1 out 0 p 0 1
.ac lin 1 ${f0} ${f0}
.end`);
    const h = cAt(vec(r, 'V(out)'), 0);
    expect(20 * Math.log10(cabs(h))).toBeCloseTo(-10 * Math.log10(2), 6);
    // −90° at the natural frequency of a 2nd-order low-pass
    expect((Math.atan2(h.im, h.re) * 180) / Math.PI).toBeCloseTo(-90, 6);
  });
});

describe('twin-T notch', () => {
  const R = 15.9155e3; // f0 ≈ 1 kHz with C = 10 nF
  const Cv = 10e-9;
  const deck = (sweep: string) => `twin-T
VIN in 0 AC 1
RA in m ${R}
RB m out ${R}
CC m 0 ${2 * Cv}
CA in n ${Cv}
CB n out ${Cv}
RC n 0 ${R / 2}
.ac ${sweep}
.end`;

  it('matches the closed form across 3 decades', () => {
    const [r] = runDeck(deck('dec 40 10 100k'));
    const f = scaleOf(r);
    const vout = vec(r, 'V(out)');
    for (let i = 0; i < f.length; i++) {
      const ref = twinT(f[i], R, Cv);
      const h = cAt(vout, i);
      // absolute error relative to |H| far from the notch, absolute 1e-9 near it
      expect(cabs(csub(h, ref))).toBeLessThan(1e-7 * cabs(ref) + 1e-9);
    }
  });

  it('notch at f0 = 1/(2πRC) is deeper than −160 dB; |H(f0/2)| and phase flip match', () => {
    const f0 = 1 / (2 * Math.PI * R * Cv);
    const [r] = runDeck(deck(`lin 3 ${f0 / 2} ${(3 * f0) / 2}`));
    const f = scaleOf(r);
    const vout = vec(r, 'V(out)');
    expect(f[1]).toBeCloseTo(f0, 6);
    expect(cabs(cAt(vout, 1))).toBeLessThan(1e-8);
    // at f0/2: x = 1/2 → H = 0.75 / (0.75 + 2j) ; |H| = 0.75/√(0.5625+4)
    expect(cabs(cAt(vout, 0))).toBeCloseTo(0.75 / Math.sqrt(0.5625 + 4), 8);
    // the phase jumps by 180° through the notch (sign change of the real numerator)
    const ph = (i: number) => (Math.atan2(vout.im![i], vout.re[i]) * 180) / Math.PI;
    expect(ph(0)).toBeLessThan(0);
    expect(ph(2)).toBeGreaterThan(0);
  });
});
