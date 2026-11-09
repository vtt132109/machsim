import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import { BOLTZ, CHARGE, KELVIN } from '../device';
import type { ElementIR, ModelCard } from '../netlist';
import type { AnalysisResult } from '../results';
import { idc, isrc, model, netlist, res, vcvs, vdc } from '../engine/testing';

function tf(elements: ElementIR[], output: string, src: string, models: ModelCard[] = []): AnalysisResult {
  const [r] = runAnalyses(netlist(elements, [{ type: 'tf', output, src }], { models }));
  expect(r.error).toBeUndefined();
  return r;
}

function rel(a: number | undefined, b: number): number {
  return Math.abs((a as number) / b - 1);
}

describe('transfer function analysis', () => {
  const divider = [vdc('V1', 'in', '0', 1), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 3e3)];

  it('computes gain, input and output resistance of a divider', () => {
    const r = tf(divider, 'V(out)', 'V1');
    expect(rel(r.scalars?.gain, 0.75)).toBeLessThan(1e-12);
    expect(rel(r.scalars?.rin, 4e3)).toBeLessThan(1e-12);
    expect(rel(r.scalars?.rout, 750)).toBeLessThan(1e-12);
    expect(r.table?.rows[0][2]).toBe('V/V');
    expect(r.vectors.find((v) => v.name === 'rout')?.re[0]).toBeCloseTo(750, 9);
  });

  it('handles a VCVS inverting amplifier with finite gain and output resistance', () => {
    const A = 1e5;
    const R1 = 1e3;
    const Rf = 1e4;
    const Ro = 100;
    const amp = [vdc('V1', 'in', '0', 0), res('R1', 'in', 'n', R1), res('RF', 'n', 'out', Rf), vcvs('E1', 'o', '0', '0', 'n', A), res('RO', 'o', 'out', Ro)];
    const r = tf(amp, 'V(out)', 'V1');
    // reference: nodal equations for vin = 1 (unknowns vn, vout), vo = -A vn
    //   n:   (1 - vn)/R1 + (vout - vn)/Rf = 0
    //   out: (-A vn - vout)/Ro + (vn - vout)/Rf = 0
    const a11 = -1 / R1 - 1 / Rf;
    const a12 = 1 / Rf;
    const a21 = -A / Ro + 1 / Rf;
    const a22 = -1 / Ro - 1 / Rf;
    const det = a11 * a22 - a12 * a21;
    const vn = (-(1 / R1) * a22) / det;
    const vout = (a11 * 0 - a21 * -(1 / R1)) / det;
    const beta = R1 / (R1 + Rf);
    expect(rel(r.scalars?.gain, vout)).toBeLessThan(1e-10);
    expect(rel(r.scalars?.gain, -10)).toBeLessThan(2e-3);
    expect(rel(r.scalars?.rin, 1 / ((1 - vn) / R1))).toBeLessThan(1e-10);
    expect(rel(r.scalars?.rout, 1 / ((1 + A * beta) / Ro + 1 / (R1 + Rf)))).toBeLessThan(1e-9);
  });

  it('reports zero output resistance for an ideal VCVS output', () => {
    const r = tf([vdc('V1', 'in', '0', 0), res('R1', 'in', 'n', 1e3), res('RF', 'n', 'out', 1e4), vcvs('E1', 'out', '0', '0', 'n', 1e6)], 'V(out)', 'V1');
    expect(Math.abs(r.scalars?.rout as number)).toBeLessThan(1e-9);
  });

  it('supports current-source inputs (transresistance)', () => {
    const r = tf([isrc('I1', '0', 'a', { dc: 1e-3 }), res('R1', 'a', '0', 2e3)], 'V(a)', 'I1');
    expect(rel(r.scalars?.gain, 2e3)).toBeLessThan(1e-12);
    expect(rel(r.scalars?.rin, 2e3)).toBeLessThan(1e-12);
    expect(r.table?.rows[0][2]).toBe('V/A');
  });

  it('supports branch-current outputs', () => {
    const r = tf([vdc('V1', 'in', '0', 1), res('R1', 'in', 'a', 1e3), vdc('VM', 'a', 'b', 0), res('R2', 'b', '0', 1e3)], 'I(VM)', 'V1');
    expect(rel(r.scalars?.gain, 5e-4)).toBeLessThan(1e-12);
    expect(rel(r.scalars?.rout, 2e3)).toBeLessThan(1e-12);
    expect(rel(r.scalars?.rin, 2e3)).toBeLessThan(1e-12);
  });

  it('linearises device outputs and warns that their output resistance is undefined', () => {
    const r = tf(divider, 'I(R2)', 'V1');
    expect(rel(r.scalars?.gain, 1 / 4e3)).toBeLessThan(1e-8);
    expect(Number.isNaN(r.scalars?.rout)).toBe(true);
    expect(r.warnings.some((w) => /output resistance/.test(w))).toBe(true);
  });

  it('uses the small-signal conductance of a diode at the operating point', () => {
    const IS = 1e-14;
    const R = 1e3;
    const r = tf([vdc('V1', 'in', '0', 5), res('R1', 'in', 'a', R), { type: 'D', name: 'D1', nodes: ['a', '0'], params: {}, model: 'DM' }], 'V(a)', 'V1', [
      model('DM', 'D', { is: IS }),
    ]);
    // operating point by bisection of (5 - v)/R = IS (exp(v/vt) - 1)
    const vt = (BOLTZ * (27 + KELVIN)) / CHARGE;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 200; k++) {
      const v = (lo + hi) / 2;
      if ((5 - v) / R - IS * (Math.exp(v / vt) - 1) - 1e-12 * v > 0) lo = v;
      else hi = v;
    }
    const gd = (IS / vt) * Math.exp(lo / vt) + 1e-12;
    const rd = 1 / gd;
    expect(rel(r.scalars?.gain, rd / (R + rd))).toBeLessThan(1e-5);
    expect(rel(r.scalars?.rout, (R * rd) / (R + rd))).toBeLessThan(1e-5);
    expect(rel(r.scalars?.rin, R + rd)).toBeLessThan(1e-5);
  });

  it('rejects unknown sources and malformed outputs', () => {
    const [a, b] = runAnalyses(
      netlist(
        [idc('I1', '0', 'a', 1e-3), res('R1', 'a', '0', 1e3)],
        [
          { type: 'tf', output: 'V(a)', src: 'R1' },
          { type: 'tf', output: 'V(zz)', src: 'I1' },
        ],
      ),
    );
    expect(a.error).toMatch(/not an independent/);
    expect(b.error).toMatch(/zz/);
  });
});
