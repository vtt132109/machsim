/**
 * MOSFET level 2 (Grove-Frohman) against hand calculations of the published equations.
 */
import { describe, expect, it } from 'vitest';
import { CHARGE, EPS_OX, EPS_SI } from '../../device';
import type { ModelCard } from '../../netlist';
import { celsiusToKelvin } from './common';
import { Mosfet, createMosfet } from './mosfet';
import { TestCircuit } from './test-harness';
import { parseSpice } from '../../spice';
import { runAnalyses } from '../../engine';

const T27 = celsiusToKelvin(27);
const GEOM = { w: 10e-6, l: 2e-6 };
const BETA = (1e-4 * 10e-6) / 2e-6;

function model(params: Record<string, number>, type: 'NMOS' | 'PMOS' = 'NMOS'): ModelCard {
  return { name: 'MM', type, params: { level: 2, is: 0, ...params } };
}

/** Level-2 device biased by ideal sources (source grounded); outputs at the exact bias. */
function bias(params: Record<string, number>, vgs: number, vds: number, vbs = 0, type: 'NMOS' | 'PMOS' = 'NMOS') {
  const c = new TestCircuit({ gmin: 0 }).model(model(params, type));
  const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', 'b'], model: 'MM', params: GEOM }) as Mosfet;
  c.vsource('VG', 'g', '0', vgs);
  c.vsource('VD', 'd', '0', vds);
  c.vsource('VB', 'b', '0', vbs);
  const r = c.op();
  expect(r.converged).toBe(true);
  const xe = Float64Array.from(r.x);
  xe[c.node('g')] = vgs;
  xe[c.node('d')] = vds;
  xe[c.node('b')] = vbs;
  return { c, m, out: m.outputs((i) => (i < 0 ? 0 : xe[i])) };
}

/** Grove-Frohman current with eta = 1, no charge sharing: the hand formula. */
function groveFrohman(vgs: number, vds: number, vbs: number, p: { vto: number; gamma: number; phi: number }): number {
  const vbi = p.vto - p.gamma * Math.sqrt(p.phi);
  const phib = p.phi - vbs;
  const u = (-p.gamma + Math.sqrt(p.gamma * p.gamma + 4 * (vgs - vbi + phib))) / 2;
  const vdsat = u * u - phib;
  const x = Math.min(vds, vdsat);
  return BETA * ((vgs - vbi - x / 2) * x - (2 / 3) * p.gamma * (Math.pow(phib + x, 1.5) - Math.pow(phib, 1.5)));
}

describe('MOSFET level 2: static I-V by hand calculation', () => {
  it('without body effect it reduces to the square law (gamma = 0)', () => {
    const P = { vto: 0.8, kp: 1e-4, gamma: 0, phi: 0.6 };
    // linear: BETA (Vgst - Vds/2) Vds
    expect(bias(P, 3, 0.5).out.Id / (BETA * (2.2 - 0.25) * 0.5)).toBeCloseTo(1, 10);
    // saturation: BETA Vgst^2 / 2
    expect(bias(P, 2, 3).out.Id / ((BETA / 2) * 1.44)).toBeCloseTo(1, 10);
    expect(bias(P, 0.7, 3).out.Id).toBe(0);
  });

  const P = { vto: 0.8, kp: 1e-4, gamma: 0.5, phi: 0.6 };

  it('linear region uses the bulk-charge term 2/3 GAMMA ((PHI - Vbs + Vds)^1.5 - (PHI - Vbs)^1.5)', () => {
    // hand numbers: VBI = 0.8 - 0.5*sqrt(0.6) = 0.412702; Id = BETA [(3 - 0.412702 - 0.25)*0.5 - 1/3 (1.1^1.5 - 0.6^1.5)]
    const hand = BETA * ((3 - (0.8 - 0.5 * Math.sqrt(0.6)) - 0.25) * 0.5 - (1 / 3) * (Math.pow(1.1, 1.5) - Math.pow(0.6, 1.5)));
    expect(hand).toBeCloseTo(4.6950e-4, 7);
    const { out } = bias(P, 3, 0.5);
    expect(out.Id / hand).toBeCloseTo(1, 10);
    // a bulk-charge model carries less current than the square law with the same threshold
    expect(out.Id).toBeLessThan(BETA * (3 - 0.8 - 0.25) * 0.5);
  });

  it('saturation current and VDSAT follow from dId/dVds = 0', () => {
    const vbi = 0.8 - 0.5 * Math.sqrt(0.6);
    const u = (-0.5 + Math.sqrt(0.25 + 4 * (3 - vbi + 0.6))) / 2;
    const vdsat = u * u - 0.6;
    // VDSAT is below the square-law value Vgs - VTO = 2.2 V
    expect(vdsat).toBeGreaterThan(1.7);
    expect(vdsat).toBeLessThan(2.2);
    const sat = bias(P, 3, 4);
    expect(sat.out.Id / groveFrohman(3, 4, 0, P)).toBeCloseTo(1, 10);
    const e = sat.m.evaluateAt(3, 4, 0, T27);
    expect(e.core.vdsat).toBeCloseTo(vdsat, 10);
    // without channel-length modulation the output conductance vanishes in saturation
    expect(Math.abs(e.gDs)).toBeLessThan(1e-12);
    // and the current is continuous at VDSAT
    const below = sat.m.evaluateAt(3, vdsat - 1e-7, 0, T27).cd;
    expect(below / e.cd).toBeCloseTo(1, 5);
  });

  it('reverse body bias raises the threshold through sqrt(PHI - Vbs)', () => {
    const { out } = bias(P, 3, 0.5, -1);
    expect(out.Id / groveFrohman(3, 0.5, -1, P)).toBeCloseTo(1, 10);
    expect(out.Id).toBeLessThan(bias(P, 3, 0.5, 0).out.Id);
  });

  it('narrow-channel DELTA scales the vds terms by eta and raises VBIN', () => {
    const tox = 1e-7;
    const cox = EPS_OX / tox;
    const delta = 2;
    const factor = (delta * Math.PI * EPS_SI) / (4 * cox * 10e-6);
    const eta = 1 + factor;
    const Q = { vto: 0.8, kp: 1e-4, gamma: 0, phi: 0.6, tox, delta };
    const vbin = 0.8 + factor * 0.6;
    const { m, out } = bias(Q, 3, 0.4);
    expect(out.Id / (BETA * (3 - vbin - (eta * 0.4) / 2) * 0.4)).toBeCloseTo(1, 10);
    expect(m.evaluateAt(3, 5, 0, T27).core.vdsat).toBeCloseTo((3 - vbin) / eta, 10);
  });

  it('LAMBDA divides the current by (1 - LAMBDA Vds)', () => {
    const Q = { vto: 0.8, kp: 1e-4, gamma: 0, phi: 0.6, lambda: 0.05 };
    expect(bias(Q, 2, 3).out.Id / ((BETA / 2) * 1.44 / (1 - 0.05 * 3))).toBeCloseTo(1, 10);
    expect(bias(Q, 3, 0.5).out.Id / ((BETA * 1.95 * 0.5) / (1 - 0.05 * 0.5))).toBeCloseTo(1, 10);
  });

  it('UCRIT / UEXP reduce the mobility above the critical field', () => {
    const tox = 5e-8;
    const cox = EPS_OX / tox;
    const crit = (1e4 * 100 * EPS_SI) / cox; // V
    const Q = { vto: 0.8, kp: 1e-4, gamma: 0, phi: 0.6, tox, ucrit: 1e4, uexp: 0.2 };
    const vgst = 2.2;
    expect(vgst).toBeGreaterThan(crit);
    const ufact = Math.pow(crit / vgst, 0.2);
    expect(bias(Q, 3, 0.5).out.Id / (ufact * BETA * (vgst - 0.25) * 0.5)).toBeCloseTo(1, 10);
  });

  it('NSUB-based channel-length modulation is continuous at VDSAT and gives a finite output resistance', () => {
    const Q = { vto: 0.8, kp: 1e-4, gamma: 0, phi: 0.6, nsub: 1e16 };
    const xd = Math.sqrt((2 * EPS_SI) / (CHARGE * 1e16 * 1e6));
    const r = (4 - 2.2) / 4;
    const dl = xd * (Math.sqrt(r + Math.sqrt(1 + r * r)) - 1);
    const { m, out } = bias(Q, 3, 4);
    expect(out.Id / (((BETA / 2) * 2.2 * 2.2) / (1 - dl / 2e-6))).toBeCloseTo(1, 10);
    expect(m.evaluateAt(3, 4, 0, T27).gDs).toBeGreaterThan(0);
    const at = m.evaluateAt(3, 2.2 + 1e-9, 0, T27).cd;
    expect(at / ((BETA / 2) * 2.2 * 2.2)).toBeCloseTo(1, 6);
  });

  it('conductances are the exact derivatives of the evaluated current', () => {
    const Q = { ...P, tox: 4e-8, nsub: 3e16, xj: 3e-7, delta: 0.5, ucrit: 2e4, uexp: 0.15, lambda: 0.02 };
    const { m } = bias(Q, 2.5, 1.2, -0.5);
    const h = 1e-6;
    for (const [vgs, vds, vbs] of [
      [2.5, 1.2, -0.5],
      [2.5, 4, -0.5],
      [1.6, 0.3, -1.5],
    ]) {
      const e = m.evaluateAt(vgs, vds, vbs, T27);
      const num = (f: (d: number) => number) => (f(h) - f(-h)) / (2 * h);
      expect(e.gGs / num((d) => m.evaluateAt(vgs + d, vds, vbs, T27).cd)).toBeCloseTo(1, 5);
      expect(e.gDs / num((d) => m.evaluateAt(vgs, vds + d, vbs, T27).cd)).toBeCloseTo(1, 4);
      expect(e.gBs / num((d) => m.evaluateAt(vgs, vds, vbs + d, T27).cd)).toBeCloseTo(1, 5);
    }
  });

  it('a PMOS mirrors the NMOS currents', () => {
    const n = bias(P, 3, 0.5).out.Id;
    const p = bias({ ...P, vto: -0.8 }, -3, -0.5, 0, 'PMOS').out.Id;
    expect(p / -n).toBeCloseTo(1, 10);
  });
});

describe('MOSFET level 2 in a SPICE deck', () => {
  it('a level-2 common-source stage reaches the hand-calculated operating point and no level warning', () => {
    const deck = `level 2 CS stage
VDD vdd 0 5
VG g 0 2
RD vdd d 10k
M1 d g 0 0 NM W=10u L=2u
.model NM NMOS (LEVEL=2 VTO=0.8 KP=1e-4 GAMMA=0 PHI=0.6 IS=0)
.op
.end`;
    const net = parseSpice(deck).netlist;
    const [op] = runAnalyses(net);
    expect(op.error).toBeUndefined();
    expect(op.warnings.join(' ')).not.toMatch(/level/i);
    const vd = op.vectors.find((v) => v.name.toLowerCase() === 'v(d)')!.re[0];
    // saturation: Id = BETA/2 * 1.2^2 = 3.6e-5 A -> Vd = 5 - 10k * Id = 4.64 V
    expect(vd).toBeCloseTo(5 - 1e4 * (BETA / 2) * 1.44, 6);
  });
});
