/**
 * PCB impedance calculator: published reference values, internal consistency between the
 * formulas (thickness → 0, exact conformal mapping), and the width solver.
 */
import { describe, expect, it } from 'vitest';
import { microstrip } from '../../library/catalog/rf';
import { cpwLine, ellipticK, gcpwLine, kRatio, lineImpedance, microstripLine, striplineExact, striplineLine, widthForImpedance } from './pcbImpedance';

describe('elliptic integrals', () => {
  it('K(k) matches tabulated values', () => {
    expect(ellipticK(0)).toBeCloseTo(Math.PI / 2, 12);
    expect(ellipticK(Math.SQRT1_2)).toBeCloseTo(1.854074677, 8);
    expect(ellipticK(0.9)).toBeCloseTo(2.280549138, 8);
    expect(kRatio(Math.SQRT1_2)).toBeCloseTo(1, 12);
  });
});

describe('microstrip', () => {
  it('a 50 Ω line on 0.5 mm alumina (εr 9.9) is about 0.475 mm wide (textbook example)', () => {
    const r = microstripLine(0.475, 0.5, 0, 9.9);
    expect(r.z0).toBeGreaterThan(49);
    expect(r.z0).toBeLessThan(51.5);
    // the simpler textbook εeff formula gives 6.65; Hammerstad–Jensen is within 1 %
    expect(Math.abs(r.eeff / 6.65 - 1)).toBeLessThan(0.01);
  });

  it('agrees with the library microstrip model at zero thickness', () => {
    for (const [w, h, er] of [
      [3, 1.6, 4.4],
      [0.3, 0.2, 3.55],
      [1, 0.8, 2.2],
    ]) {
      const a = microstripLine(w, h, 0, er);
      const b = microstrip(w, h, er);
      expect(Math.abs(a.z0 / b.z0 - 1)).toBeLessThan(0.02);
      expect(Math.abs(a.eeff / b.eeff - 1)).toBeLessThan(0.02);
    }
  });

  it('copper thickness lowers the impedance a little; air lines have εeff = 1', () => {
    const thin = microstripLine(1, 1, 0, 4.4);
    const thick = microstripLine(1, 1, 0.07, 4.4);
    expect(thick.z0).toBeLessThan(thin.z0);
    expect(thin.z0 - thick.z0).toBeLessThan(3);
    expect(microstripLine(1, 1, 0, 1).eeff).toBeCloseTo(1, 9);
    // w = h in air: about 126 Ω
    expect(microstripLine(1, 1, 0, 1).z0).toBeCloseTo(126.2, 0);
  });

  it('FR-4 1.6 mm: a 50 Ω trace is about 3 mm wide', () => {
    const w = widthForImpedance('microstrip', { h: 1.6, t: 0.035, er: 4.4 }, 50);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThan(2.8);
    expect(w!).toBeLessThan(3.2);
    expect(lineImpedance('microstrip', { w: w!, h: 1.6, t: 0.035, er: 4.4 }).z0).toBeCloseTo(50, 6);
  });
});

describe('stripline', () => {
  it('the thick-strip formula tends to the exact zero-thickness result', () => {
    for (const [w, b] of [
      [0.5, 1],
      [1, 1],
      [0.2, 1],
    ]) {
      const exact = striplineExact(w, b, 1);
      expect(Math.abs(striplineLine(w, b, 0, 1) / exact - 1)).toBeLessThan(0.01);
    }
  });

  it('b = 3.2 mm, εr = 2.2: a 50 Ω strip is about 2.66 mm wide (textbook example)', () => {
    const z = striplineExact(2.66, 3.2, 2.2);
    expect(z).toBeGreaterThan(48.5);
    expect(z).toBeLessThan(51.5);
    const w = widthForImpedance('stripline', { h: 3.2, t: 0, er: 2.2 }, 50)!;
    expect(w).toBeGreaterThan(2.5);
    expect(w).toBeLessThan(2.8);
  });

  it('per-length values follow from Z0 and εeff', () => {
    const r = lineImpedance('stripline', { w: 0.15, h: 0.5, t: 0.018, er: 4 });
    // delay √εr / c = 6.67 ps/mm; L′/C′ = Z0²
    expect(r.delay).toBeCloseTo(6.671, 2);
    expect((r.lPerMm * 1e-9) / (r.cPerMm * 1e-12)).toBeCloseTo(r.z0 * r.z0, 6);
  });
});

describe('coplanar and differential lines', () => {
  it('a CPW on a thick substrate has εeff = (εr + 1)/2; a bottom ground lowers Z0', () => {
    const thick = cpwLine(0.5, 0.2, 100, 9.8);
    expect(thick.eeff).toBeCloseTo((9.8 + 1) / 2, 2);
    const cpw = cpwLine(0.5, 0.2, 0.5, 4.4);
    const g = gcpwLine(0.5, 0.2, 0.5, 4.4);
    expect(g.z0).toBeLessThan(cpw.z0);
    expect(g.z0).toBeGreaterThan(20);
  });

  it('coupling lowers the differential impedance below 2·Z0 and vanishes for wide spacing', () => {
    const close = lineImpedance('diff-microstrip', { w: 0.2, h: 0.2, t: 0.035, er: 4.2, s: 0.15 });
    const far = lineImpedance('diff-microstrip', { w: 0.2, h: 0.2, t: 0.035, er: 4.2, s: 5 });
    expect(close.zdiff!).toBeLessThan(2 * close.z0);
    expect(far.zdiff! / (2 * far.z0)).toBeGreaterThan(0.999);
    expect(close.zdiff!).toBeCloseTo(2 * close.z0 * (1 - 0.48 * Math.exp((-0.96 * 0.15) / 0.2)), 9);
    const ds = lineImpedance('diff-stripline', { w: 0.15, h: 0.6, t: 0.018, er: 4, s: 0.2 });
    expect(ds.zdiff!).toBeCloseTo(2 * ds.z0 * (1 - 0.347 * Math.exp((-2.9 * 0.2) / 0.6)), 9);
  });

  it('solves a 100 Ω differential pair', () => {
    const g = { h: 0.2, t: 0.035, er: 4.2, s: 0.2 };
    const w = widthForImpedance('diff-microstrip', g, 100)!;
    expect(lineImpedance('diff-microstrip', { ...g, w }).zdiff).toBeCloseTo(100, 6);
    expect(widthForImpedance('microstrip', { h: 1.6, t: 0, er: 4.4 }, 500)).toBeNull();
  });
});
