import { describe, expect, it } from 'vitest';
import type { ModelCard } from '../../netlist';
import { celsiusToKelvin } from './common';
import { Mesfet, createMesfet } from './mesfet';
import { TestCircuit } from './test-harness';

const T27 = celsiusToKelvin(27);

function zmodel(params: Record<string, number>, type: 'NMF' | 'PMF' = 'NMF'): ModelCard {
  return { name: 'ZM', type, params };
}

/** Statz channel current in normal mode (reference formula). */
function statz(vgst: number, vds: number, p: { beta: number; b: number; alpha: number; lambda: number }): number {
  if (vgst <= 0) return 0;
  const core = (p.beta * (1 + p.lambda * vds) * vgst * vgst) / (1 + p.b * vgst);
  if (vds >= 3 / p.alpha) return core;
  return core * (1 - (1 - (p.alpha * vds) / 3) ** 3);
}

describe('MESFET (Statz) static I-V', () => {
  const P = { vto: -1.5, beta: 4e-3, b: 0.5, alpha: 2.5, lambda: 0.05, is: 0 };

  function channelCurrent(vgs: number, vds: number, type: 'NMF' | 'PMF' = 'NMF'): number {
    const c = new TestCircuit({ gmin: 0 }).model(zmodel(P, type));
    const z = c.element(createMesfet, { type: 'Z', name: 'Z1', nodes: ['d', 'g', '0'], model: 'ZM' });
    c.vsource('VG', 'g', '0', vgs);
    c.vsource('VD', 'd', '0', vds);
    const r = c.op();
    expect(r.converged).toBe(true);
    const xe = Float64Array.from(r.x);
    xe[c.node('g')] = vgs;
    xe[c.node('d')] = vds;
    return z.outputs!((i) => (i < 0 ? 0 : xe[i])).Id;
  }

  it.each([
    [-0.5, 3],
    [0, 2],
    [-1, 0.4],
    [0.2, 0.9],
    [-1.6, 3],
  ])('Id(vgs=%f, vds=%f) matches the Statz equations', (vgs, vds) => {
    const id = channelCurrent(vgs, vds);
    const ref = statz(vgs + 1.5, vds, P);
    if (ref === 0) expect(id).toBe(0);
    else expect(id / ref).toBeCloseTo(1, 12);
  });

  it('is continuous at vds = 3/ALPHA and symmetric under drain/source exchange', () => {
    const edge = 3 / 2.5;
    expect(Math.abs(channelCurrent(-0.5, edge + 1e-9) - channelCurrent(-0.5, edge - 1e-9))).toBeLessThan(1e-11);
    // vds < 0: Id(vgs, vds) = -F(vgd - VTO, -vds)
    expect(channelCurrent(-0.5, -0.6) / -statz(-0.5 + 0.6 + 1.5, 0.6, P)).toBeCloseTo(1, 12);
  });

  it('PMF mirrors NMF', () => {
    expect(channelCurrent(0.5, -2, 'PMF')).toBeCloseTo(-channelCurrent(-0.5, 2), 16);
  });
});

describe('MESFET Jacobian, AC and convergence', () => {
  const FULL = { vto: -1.2, beta: 6e-3, b: 0.8, alpha: 3, lambda: 0.04, rd: 3, rs: 2, cgs: 0.5e-12, cgd: 0.1e-12, pb: 0.8, is: 1e-14 };
  const biases: Array<[number, number]> = [
    [-0.4, -2.5],
    [-0.4, -0.9],
    [-2, -4],
    [-0.8, -0.2],
    [0.4, 0.1],
  ];
  function setup() {
    const c = new TestCircuit().model(zmodel(FULL));
    const z = c.element(createMesfet, { type: 'Z', name: 'Z1', nodes: ['d', 'g', 's'], model: 'ZM' }) as Mesfet;
    c.setup();
    return { c, z };
  }
  function vector(c: TestCircuit, vgs: number, vgd: number): Float64Array {
    const x = new Float64Array(c.size);
    x[c.node('Z1#s')] = 0.01;
    x[c.node('g')] = 0.01 + vgs;
    x[c.node('Z1#d')] = 0.01 + vgs - vgd;
    x[c.node('s')] = 0.008;
    x[c.node('d')] = 0.01 + vgs - vgd + 0.003;
    return x;
  }

  it.each(biases)('DC and transient Jacobians at (vgs, vgd) = (%f, %f)', (vgs, vgd) => {
    const { c, z } = setup();
    const x = vector(c, vgs, vgd);
    expect(c.jacobianError(z, x, { mode: 'op' }).maxRel).toBeLessThan(1e-4);
    c.assemble(
      x.map((y) => y * 0.95),
      { mode: 'op', tranOp: true },
    );
    c.state1.set(c.state0);
    c.state2.set(c.state0);
    expect(c.jacobianError(z, x, { mode: 'tran', dt: 1e-11, method: 'trap', time: 1e-11 }).maxRel).toBeLessThan(1e-4);
  });

  it('AC matrix equals the DC Jacobian with j*omega*Cgs/Cgd', () => {
    const { c, z } = setup();
    const x = vector(c, -0.4, -2.5);
    c.settle(z, x);
    const g = c.assemble(x).G;
    const omega = 2 * Math.PI * 1e9;
    const ac = c.acAssemble(x, omega);
    const e = z.evaluateAt(-0.4, -2.5, T27);
    for (let i = 0; i < c.size; i++) for (let k = 0; k < c.size; k++) expect(ac.re[i][k]).toBeCloseTo(g[i][k], 12);
    const gi = c.node('g');
    expect(ac.im[gi][gi] / (omega * (e.capgs + e.capgd))).toBeCloseTo(1, 12);
  });

  it('common-source amplifier converges from 0 V and satisfies KCL', () => {
    const c = new TestCircuit({ reltol: 1e-9 }).model(zmodel(FULL));
    const z = c.element(createMesfet, { type: 'Z', name: 'Z1', nodes: ['d', 'g', '0'], model: 'ZM' });
    c.vsource('VDD', 'vdd', '0', 5);
    c.vsource('VG', 'g', '0', -0.5);
    c.resistor('RL', 'vdd', 'd', 200);
    const r = c.op();
    expect(r.converged).toBe(true);
    const out = z.outputs!((i) => (i < 0 ? 0 : r.x[i]));
    expect(out.Id / ((5 - c.v('d')) / 200)).toBeCloseTo(1, 7);
    expect(out.Id).toBeGreaterThan(1e-3);
  });
});
