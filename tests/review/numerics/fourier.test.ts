/**
 * Review: Fourier analysis / THD against signals with exactly known harmonic content.
 *
 * - Two series SIN sources (1 V at f0, 0.1 V at 3·f0 with +90° phase): M1 = 1, M3 = 0.1,
 *   φ3 = 90° (sine reference), THD = 10 %. Smooth waveform → 1e-4 accuracy is expected from the
 *   cubic resampling and the trapezoidal transient (step ≤ T/256).
 * - Polynomial behavioural source y = x + 0.2·x² of x = sin(ωt):
 *     y = 0.1 + sin(ωt) − 0.1·cos(2ωt) → DC 0.1, M1 = 1, M2 = 0.1, φ2 = −90°, THD = 10 %.
 * - ±1 V square wave (PULSE, 1 ns edges): odd harmonics 4/(πk), even ≈ 0; with 9 harmonics
 *   THD = √(1/9+1/25+1/49+1/81)·100 = 42.87 %. The sampled-square DFT deviates from 4/(πk) by
 *   (πk/N)²/6 ≤ 2e-3 for k ≤ 9 and N = 256, so 1 % is allowed.
 */
import { describe, expect, it } from 'vitest';
import { rel, runDeck, vec } from './ref';

describe('Fourier of a two-tone sum', () => {
  const [r] = runDeck(`two tone
V1 a 0 SIN(0 1 1k)
V3 b a SIN(0 0.1 3k 0 0 90)
R1 b 0 1k
.four 1k 5 V(b)
.end`);
  const mag = vec(r, 'V(b)').re;
  const ph = vec(r, 'phase(V(b))').re;

  it('harmonic magnitudes', () => {
    expect(mag[1]).toBeCloseTo(1, 4);
    expect(mag[2]).toBeLessThan(1e-4);
    expect(mag[3]).toBeCloseTo(0.1, 4);
    expect(mag[4]).toBeLessThan(1e-4);
    expect(mag[5]).toBeLessThan(1e-4);
  });

  it('phases use the sine reference', () => {
    expect(ph[1]).toBeCloseTo(0, 1);
    expect(ph[3]).toBeCloseTo(90, 1);
  });

  it('THD = 10 %', () => {
    expect(rel(r.scalars!['THD(V(b))'], 10)).toBeLessThan(1e-3);
  });
});

describe('Fourier of a polynomial nonlinearity (B source)', () => {
  const [r] = runDeck(`poly
V1 x 0 SIN(0 1 1k)
B1 y 0 V=V(x)+0.2*V(x)*V(x)
R1 y 0 1k
.four 1k 4 V(y)
.end`);
  const mag = vec(r, 'V(y)').re;
  const ph = vec(r, 'phase(V(y))').re;

  it('DC 0.1, M1 = 1, M2 = 0.1 at −90°', () => {
    expect(r.scalars!['DC(V(y))']).toBeCloseTo(0.1, 4);
    expect(mag[1]).toBeCloseTo(1, 4);
    expect(mag[2]).toBeCloseTo(0.1, 4);
    expect(ph[2]).toBeCloseTo(-90, 1);
    expect(mag[3]).toBeLessThan(1e-4);
    expect(rel(r.scalars!['THD(V(y))'], 10)).toBeLessThan(1e-3);
  });
});

describe('Fourier of a square wave', () => {
  const f0 = 1e3;
  const T = 1 / f0;
  const [r] = runDeck(`square
V1 a 0 PULSE(-1 1 0 1n 1n ${T / 2 - 1e-9} ${T})
R1 a 0 1k
.four 1k 9 V(a)
.end`);
  const mag = vec(r, 'V(a)').re;

  it('odd harmonics 4/(πk), even harmonics ≈ 0', () => {
    for (let k = 1; k <= 9; k++) {
      if (k % 2 === 1) expect(rel(mag[k], 4 / (Math.PI * k)), `k=${k}`).toBeLessThan(1e-2);
      else expect(mag[k], `k=${k}`).toBeLessThan(1e-2);
    }
  });

  it('THD with 9 harmonics = 42.87 %', () => {
    const ref = 100 * Math.sqrt(1 / 9 + 1 / 25 + 1 / 49 + 1 / 81);
    expect(rel(r.scalars!['THD(V(a))'], ref)).toBeLessThan(1e-2);
  });
});
