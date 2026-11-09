import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import { BOLTZ, CHARGE, KELVIN } from '../device';
import type { AnalysisSpec, ElementIR, ModelCard } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { cap, model, netlist, res, vdc, vsrc } from '../engine/testing';

function sens(elements: ElementIR[], spec: AnalysisSpec, models: ModelCard[] = []): AnalysisResult {
  const [r] = runAnalyses(netlist(elements, [spec], { models }));
  expect(r.error).toBeUndefined();
  return r;
}

function rel(a: number | undefined, b: number): number {
  return Math.abs((a as number) / b - 1);
}

const VT = (BOLTZ * (27 + KELVIN)) / CHARGE;

/** Diode-resistor operating point: (V - v)/R = IS (exp(v/vt) - 1) + gmin v. */
function diodeOp(V: number, R: number, IS: number): number {
  let lo = 0;
  let hi = V;
  for (let k = 0; k < 200; k++) {
    const v = (lo + hi) / 2;
    if ((V - v) / R - IS * (Math.exp(v / VT) - 1) - 1e-12 * v > 0) lo = v;
    else hi = v;
  }
  return lo;
}

describe('DC sensitivity analysis', () => {
  const V = 5;
  const R1 = 1e3;
  const R2 = 3e3;
  const divider = [vdc('V1', 'in', '0', V), res('R1', 'in', 'out', R1), res('R2', 'out', '0', R2)];

  it('matches the analytic sensitivities of a divider', () => {
    const r = sens(divider, { type: 'sens', output: 'V(out)' });
    const s = r.scalars ?? {};
    const d2 = (R1 + R2) ** 2;
    expect(rel(s['R1:value'], (-V * R2) / d2)).toBeLessThan(1e-8);
    expect(rel(s['R2:value'], (V * R1) / d2)).toBeLessThan(1e-8);
    expect(rel(s['V1:dc'], R2 / (R1 + R2))).toBeLessThan(1e-10);
    expect(s.output).toBeCloseTo(3.75, 12);
    const row = r.table?.rows.find((x) => x[1] === 'R1') as (string | number)[];
    expect(row[2]).toBe('value');
    expect(row[3]).toBe(R1);
    expect(rel(row[5] as number, ((-V * R2) / d2) * (R1 / 100))).toBeLessThan(1e-8);
  });

  it('includes the explicit dependence of device outputs', () => {
    const r = sens(divider, { type: 'sens', output: 'I(R1)' });
    const d2 = (R1 + R2) ** 2;
    expect(rel(r.scalars?.['R1:value'], -V / d2)).toBeLessThan(1e-7);
    expect(rel(r.scalars?.['R2:value'], -V / d2)).toBeLessThan(1e-7);
    expect(rel(r.scalars?.['V1:dc'], 1 / (R1 + R2))).toBeLessThan(1e-8);
  });

  it('computes model-parameter sensitivities of a diode', () => {
    const IS = 1e-14;
    const R = 1e3;
    const r = sens(
      [vdc('V1', 'in', '0', V), res('R1', 'in', 'a', R), { type: 'D', name: 'D1', nodes: ['a', '0'], params: {}, model: 'DM' }],
      { type: 'sens', output: 'V(a)' },
      [model('DM', 'D', { is: IS, n: 1 })],
    );
    const vd = diodeOp(V, R, IS);
    const ex = Math.exp(vd / VT);
    const gd = (IS / VT) * ex + 1e-12;
    // implicit differentiation of f(v, p) = (V - v)/R - IS (e^{v/(n vt)} - 1) - gmin v = 0
    const dvdIS = -(ex - 1) / (1 / R + gd);
    const dvdN = (IS * ex * (vd / VT)) / (1 / R + gd);
    const dvdR = -((V - vd) / (R * R)) / (1 / R + gd);
    expect(rel(r.scalars?.['DM:is'], dvdIS)).toBeLessThan(1e-5);
    expect(rel(r.scalars?.['DM:n'], dvdN)).toBeLessThan(1e-5);
    expect(rel(r.scalars?.['R1:value'], dvdR)).toBeLessThan(1e-5);
    expect(r.table?.rows.some((row) => row[0] === 'model' && row[1] === 'DM' && row[2] === 'is')).toBe(true);
  });
});

describe('AC sensitivity analysis', () => {
  it('matches dH/dR and dH/dC of an RC low-pass', () => {
    const R = 1e3;
    const C = 1e-6;
    const r = sens([vsrc('V1', 'in', '0', { dc: 0, acMag: 1 }), res('R1', 'in', 'out', R), cap('C1', 'out', '0', C)], {
      type: 'sens',
      output: 'V(out)',
      ac: { sweep: 'dec', points: 3, fstart: 10, fstop: 1e4 },
    });
    const f = r.scale?.re as Float64Array;
    const dR = findVector(r, 'R1:value');
    const dC = findVector(r, 'C1:value');
    const h = findVector(r, 'V(out)');
    expect(dR && dC && h).toBeTruthy();
    f.forEach((fk, k) => {
      const w = 2 * Math.PI * fk;
      // D = (1 + jwRC)^2
      const dr = 1 - (w * R * C) ** 2;
      const di = 2 * w * R * C;
      const den = dr * dr + di * di;
      // -jwC / D
      const eRr = (-w * C * di) / den;
      const eRi = (-w * C * dr) / den;
      const eCr = (-w * R * di) / den;
      const eCi = (-w * R * dr) / den;
      const tolR = 1e-6 * Math.hypot(eRr, eRi);
      const tolC = 1e-6 * Math.hypot(eCr, eCi);
      expect(Math.abs((dR?.re[k] as number) - eRr)).toBeLessThan(tolR);
      expect(Math.abs((dR?.im?.[k] as number) - eRi)).toBeLessThan(tolR);
      expect(Math.abs((dC?.re[k] as number) - eCr)).toBeLessThan(tolC);
      expect(Math.abs((dC?.im?.[k] as number) - eCi)).toBeLessThan(tolC);
      const g = 1 + (w * R * C) ** 2;
      expect(h?.re[k]).toBeCloseTo(1 / g, 12);
    });
  });

  it('includes the operating-point shift for nonlinear devices', () => {
    const V = 5;
    const R = 1e3;
    const IS = 1e-14;
    const r = sens(
      [vsrc('V1', 'in', '0', { dc: V, acMag: 1 }), res('R1', 'in', 'a', R), { type: 'D', name: 'D1', nodes: ['a', '0'], params: {}, model: 'DM' }],
      { type: 'sens', output: 'V(a)', ac: { sweep: 'lin', points: 1, fstart: 1e3, fstop: 1e3 } },
      [model('DM', 'D', { is: IS })],
    );
    const vd = diodeOp(V, R, IS);
    const gdExp = (IS / VT) * Math.exp(vd / VT);
    const gd = gdExp + 1e-12;
    const id = (V - vd) / R;
    const dVd = -id / (1 + R * gd);
    const dgd = (gdExp / VT) * dVd;
    // H = 1/(1 + R gd(R))
    const expected = -(gd + R * dgd) / (1 + R * gd) ** 2;
    const v = findVector(r, 'R1:value');
    expect(Math.abs((v?.re[0] as number) / expected - 1)).toBeLessThan(1e-4);
    expect(Math.abs(v?.im?.[0] as number)).toBeLessThan(1e-9 * Math.abs(expected));
    // the DC part is still present
    expect(r.scalars?.['R1:value']).toBeDefined();
  });

  it('skips AC sensitivities of device outputs with a warning', () => {
    const r = sens([vsrc('V1', 'in', '0', { dc: 1, acMag: 1 }), res('R1', 'in', '0', 1e3)], {
      type: 'sens',
      output: 'I(R1)',
      ac: { sweep: 'lin', points: 2, fstart: 1, fstop: 2 },
    });
    expect(r.warnings.some((w) => /AC sensitivities/.test(w))).toBe(true);
    expect(r.scale).toBeUndefined();
  });
});
