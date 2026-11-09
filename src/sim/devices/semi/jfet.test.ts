import { describe, expect, it } from 'vitest';
import { BOLTZ } from '../../device';
import type { ModelCard } from '../../netlist';
import { K_OVER_Q, celsiusToKelvin } from './common';
import { Jfet, createJfet } from './jfet';
import { TestCircuit } from './test-harness';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;

function jmodel(params: Record<string, number>, type: 'NJF' | 'PJF' = 'NJF', name = 'JM'): ModelCard {
  return { name, type, params };
}

/** JFET with ideal gate and drain sources (source grounded), gmin = 0; outputs at the exact bias. */
function biasJfet(params: Record<string, number>, vgs: number, vds: number, type: 'NJF' | 'PJF' = 'NJF', tempC = 27) {
  const c = new TestCircuit({ gmin: 0, temp: tempC }).model(jmodel(params, type));
  const j = c.element(createJfet, { type: 'J', name: 'J1', nodes: ['d', 'g', '0'], model: 'JM' });
  c.vsource('VG', 'g', '0', vgs);
  c.vsource('VD', 'd', '0', vds);
  const r = c.op();
  expect(r.converged).toBe(true);
  const xe = Float64Array.from(r.x);
  xe[c.node('g')] = vgs;
  xe[c.node('d')] = vds;
  return { c, j, out: j.outputs!((i) => (i < 0 ? 0 : xe[i])) };
}

const gateDiode = (is: number, v: number): number => is * (Math.exp(v / VT) - 1);

describe('JFET static I-V (SPICE level 1)', () => {
  const P = { vto: -2, beta: 1e-3, lambda: 0.02, is: 1e-14 };

  it('saturation: Id = BETA(1+LAMBDA Vds)(Vgs-VTO)^2', () => {
    const { out } = biasJfet(P, -1, 5);
    const ich = 1e-3 * 1.1 * 1;
    expect(out.Id / (ich - gateDiode(1e-14, -6))).toBeCloseTo(1, 12);
    expect(out.Ig / (gateDiode(1e-14, -1) + gateDiode(1e-14, -6))).toBeCloseTo(1, 12);
    expect(out.Is).toBeCloseTo(-(out.Id + out.Ig), 20);
    expect(out.P).toBeCloseTo(out.Id * 5 + out.Ig * -1, 15);
  });

  it('linear region: Id = BETA(1+LAMBDA Vds) Vds (2 Vgst - Vds)', () => {
    const { out } = biasJfet(P, 0, 0.5);
    const ich = 1e-3 * 1.01 * 0.5 * (2 * 2 - 0.5);
    expect(out.Id / (ich - gateDiode(1e-14, -0.5))).toBeCloseTo(1, 12);
  });

  it('cutoff: only the gate-drain leakage flows', () => {
    const { out } = biasJfet(P, -2.5, 5);
    expect(out.Id).toBeCloseTo(-gateDiode(1e-14, -7.5), 25);
    expect(out.Id).toBeLessThan(2e-14);
  });

  it('B parameter (doping tail): Id = BETA*vgst^2*(B + (1-B)/(PB-VTO)*vgst) in saturation', () => {
    const p = { vto: -2, beta: 1e-3, b: 0.6, pb: 1, is: 0 };
    const bf = 0.4 / 3;
    const sat = biasJfet(p, -0.5, 6).out.Id;
    expect(sat / (1e-3 * 2.25 * (0.6 + bf * 1.5))).toBeCloseTo(1, 12);
    // linear region and continuity at vds = vgst
    const vgst = 1.5;
    const vds = 0.7;
    const lin = biasJfet(p, -0.5, vds).out.Id;
    const apart = 2 * 0.6 + 3 * bf * (vgst - vds);
    expect(lin / (1e-3 * vds * (vds * (bf * vds - 0.6) + vgst * apart))).toBeCloseTo(1, 12);
    const edgeLo = biasJfet(p, -0.5, vgst - 1e-9).out.Id;
    const edgeHi = biasJfet(p, -0.5, vgst + 1e-9).out.Id;
    expect(Math.abs(edgeHi - edgeLo)).toBeLessThan(1e-12);
  });

  it('drain and source are interchangeable (vds < 0 uses the swapped law)', () => {
    const run = (nodes: string[]) => {
      const c = new TestCircuit({ gmin: 0 }).model(jmodel({ ...P, cgs: 1e-12 }));
      const j = c.element(createJfet, { type: 'J', name: 'J1', nodes, model: 'JM' });
      c.vsource('VG', 'g', '0', -0.8);
      c.vsource('VA', 'a', '0', 0.3);
      c.vsource('VB', 'b', '0', 3);
      const r = c.op();
      expect(r.converged).toBe(true);
      return j.outputs!((i) => (i < 0 ? 0 : r.x[i]));
    };
    const fwd = run(['b', 'g', 'a']);
    const rev = run(['a', 'g', 'b']);
    expect(rev.Is).toBeCloseTo(fwd.Id, 14);
    expect(rev.Id).toBeCloseTo(fwd.Is, 14);
    expect(fwd.Id).toBeGreaterThan(1e-4);
  });

  it('PJF mirrors NJF with all voltages and currents negated', () => {
    const n = biasJfet(P, -0.7, 4).out;
    const p = biasJfet(P, 0.7, -4, 'PJF').out;
    expect(p.Id).toBeCloseTo(-n.Id, 18);
    expect(p.Ig).toBeCloseTo(-n.Ig, 25);
  });

  it('area multiplies BETA and IS; VTOTC and BETATCE shift VTO and BETA with temperature', () => {
    const base = biasJfet({ ...P, is: 0 }, -1, 5).out.Id;
    const c = new TestCircuit({ gmin: 0 }).model(jmodel({ ...P, is: 0 }));
    const j = c.element(createJfet, { type: 'J', name: 'J1', nodes: ['d', 'g', '0'], model: 'JM', params: { area: 2.5 } });
    c.vsource('VG', 'g', '0', -1);
    c.vsource('VD', 'd', '0', 5);
    const r = c.op();
    expect(j.outputs!((i) => (i < 0 ? 0 : r.x[i])).Id / base).toBeCloseTo(2.5, 10);
    const hot = biasJfet({ vto: -2, beta: 1e-3, is: 0, vtotc: -2e-3, betatce: -0.5 }, -1, 5, 'NJF', 77).out.Id;
    const vto = -2 - 2e-3 * 50;
    const beta = 1e-3 * Math.pow(1.01, -0.5 * 50);
    expect(hot / (beta * (-1 - vto) ** 2)).toBeCloseTo(1, 12);
  });
});

const FULL = { vto: -2.2, beta: 1.3e-3, lambda: 0.015, rd: 12, rs: 7, cgs: 4e-12, cgd: 1.5e-12, pb: 0.9, is: 2e-14, b: 0.8, fc: 0.5 };

/** (vgs, vgd) at the internal nodes across the regions, normal and inverse mode. */
const BIASES: Array<[string, number, number]> = [
  ['saturation', -1, -6],
  ['linear', -0.5, -0.9],
  ['cutoff', -3, -8],
  ['gate forward', 0.55, 0.2],
  ['inverse linear', -0.9, -0.4],
  ['inverse saturation', -5, -1.2],
  ['forward depletion beyond FC*PB', 0.5, -4],
];

function fetCircuit(params: Record<string, number>, type: 'NJF' | 'PJF' = 'NJF') {
  const c = new TestCircuit().model(jmodel(params, type));
  const j = c.element(createJfet, { type: 'J', name: 'J1', nodes: ['d', 'g', 's'], model: 'JM' }) as Jfet;
  c.setup();
  return { c, j };
}

function fetVector(c: TestCircuit, vgs: number, vgd: number, pol = 1): Float64Array {
  const x = new Float64Array(c.size);
  const vsi = 0.02;
  const set = (n: string, v: number) => {
    if (c.hasNode(n)) x[c.node(n)] = pol * v;
  };
  set('g', vsi + vgs);
  set('J1#s', vsi);
  set('J1#d', vsi + vgs - vgd);
  set('s', vsi - 0.003);
  set('d', vsi + vgs - vgd + 0.004);
  return x;
}

describe('JFET Jacobian vs finite differences', () => {
  for (const type of ['NJF', 'PJF'] as const) {
    it.each(BIASES)(`${type} DC: %s`, (_r, vgs, vgd) => {
      const { c, j } = fetCircuit(FULL, type);
      const r = c.jacobianError(j, fetVector(c, vgs, vgd, type === 'PJF' ? -1 : 1), { mode: 'op' });
      expect(r.maxRel).toBeLessThan(1e-4);
    });
  }
  it.each(BIASES)('transient companion (BE and trap): %s', (_r, vgs, vgd) => {
    for (const method of ['be', 'trap'] as const) {
      const { c, j } = fetCircuit(FULL);
      const x = fetVector(c, vgs, vgd);
      c.assemble(
        x.map((y) => y * 0.9),
        { mode: 'op', tranOp: true },
      );
      c.state1.set(c.state0);
      c.state2.set(c.state0);
      const r = c.jacobianError(j, x, { mode: 'tran', dt: 1e-9, method, time: 1e-9 });
      expect(r.maxRel).toBeLessThan(1e-4);
    }
  });
});

describe('JFET charges, AC, noise', () => {
  it.each([-6, -1, 0, 0.3])('gate capacitances follow CGS/(1 - V/PB)^0.5 at %f V', (v) => {
    const { j } = fetCircuit({ cgs: 3e-12, cgd: 1e-12, pb: 0.8 });
    const e = j.evaluateAt(v, v - 2, T27);
    expect(e.capgs / (3e-12 / Math.sqrt(1 - v / 0.8))).toBeCloseTo(1, 12);
    expect(e.capgd / (1e-12 / Math.sqrt(1 - (v - 2) / 0.8))).toBeCloseTo(1, 12);
    if (v !== 0) expect(e.qgs / (2 * 0.8 * 3e-12 * (1 - Math.sqrt(1 - v / 0.8)))).toBeCloseTo(1, 10);
  });

  it('integrate() receives qgs/qgd with dq/dv', () => {
    const { c, j } = fetCircuit(FULL);
    const x = fetVector(c, -1, -5);
    c.assemble(x, { mode: 'op', tranOp: true });
    c.state1.set(c.state0);
    const flags = { mode: 'tran' as const, dt: 1e-9, time: 1e-9 };
    c.settle(j, x, flags);
    c.integrateCalls.length = 0;
    c.assemble(x, flags);
    const e = j.evaluateAt(-1, -5, T27);
    expect(c.integrateCalls.map((k) => k.q - j.stateBase)).toEqual([2, 4]);
    expect(c.integrateCalls[0].cap).toBeCloseTo(e.capgs, 25);
    expect(c.integrateCalls[1].cap).toBeCloseTo(e.capgd, 25);
    expect(c.integrateCalls[0].charge).toBeCloseTo(e.qgs, 25);
  });

  it('AC admittance equals the DC Jacobian plus j*omega*C of the transient companion', () => {
    for (const [, vgs, vgd] of BIASES) {
      const { c, j } = fetCircuit(FULL);
      const x = fetVector(c, vgs, vgd);
      c.settle(j, x, { mode: 'op', tranOp: true });
      const gdc = c.assemble(x, { mode: 'op', tranOp: true }).G;
      c.state1.set(c.state0);
      const dt = 1e-6;
      c.settle(j, x, { mode: 'tran', dt, time: dt });
      const gtr = c.assemble(x, { mode: 'tran', dt, time: dt }).G;
      const omega = 1e-3;
      const ac = c.acAssemble(x, omega);
      for (let i = 0; i < c.size; i++) {
        for (let k = 0; k < c.size; k++) {
          expect(Math.abs(ac.re[i][k] - gdc[i][k])).toBeLessThan(1e-12 * (Math.abs(gdc[i][k]) + 1e-12));
          const capTr = (gtr[i][k] - gdc[i][k]) * dt;
          expect(Math.abs(ac.im[i][k] / omega - capTr)).toBeLessThan(1e-7 * Math.abs(capTr) + 1e-24);
        }
      }
    }
  });

  it('noise: RD/RS thermal, channel 4kT*(2/3)gm, flicker KF*Id^AF/f', () => {
    const { c, j } = fetCircuit({ ...FULL, kf: 1e-16, af: 1.3 });
    const x = fetVector(c, -1, -6);
    const by = Object.fromEntries(c.noise(x).map((g) => [g.name, g]));
    const kT4 = 4 * BOLTZ * T27;
    expect(by.thermal_rd.density(1)).toBeCloseTo(kT4 / 12, 28);
    expect(by.thermal_rs.density(1)).toBeCloseTo(kT4 / 7, 28);
    const e = j.evaluateAt(-1, -6, T27);
    expect(by.thermal_channel.density(1) / ((kT4 * 2 * e.gm) / 3)).toBeCloseTo(1, 12);
    expect(by.flicker.density(20) / ((1e-16 * Math.pow(e.id, 1.3)) / 20)).toBeCloseTo(1, 12);
  });
});

describe('JFET Newton convergence', () => {
  it('self-biased common-source stage converges from 0 V; KCL and the square law hold', () => {
    const c = new TestCircuit({ reltol: 1e-9 }).model(jmodel({ vto: -2, beta: 1e-3, is: 1e-14 }));
    const j = c.element(createJfet, { type: 'J', name: 'J1', nodes: ['d', 'g', 's'], model: 'JM' });
    c.vsource('VDD', 'vdd', '0', 15);
    c.resistor('RD', 'vdd', 'd', 2200);
    c.resistor('RS', 's', '0', 470);
    c.resistor('RG', 'g', '0', 1e6);
    const r = c.op();
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(40);
    const out = j.outputs!((i) => (i < 0 ? 0 : r.x[i]));
    const vs = c.v('s');
    const vd = c.v('d');
    expect(out.Id / ((15 - vd) / 2200)).toBeCloseTo(1, 7);
    expect(out.Is / (-vs / 470)).toBeCloseTo(1, 7);
    const vgs = c.v('g') - vs;
    expect(out.Id / (1e-3 * (vgs + 2) ** 2)).toBeCloseTo(1, 6);
    expect(vgs).toBeGreaterThan(-2);
    expect(vgs).toBeLessThan(-0.5);
  });

  it('initJunctions starts from vgs = vgd = -1 (OFF: 0); limiting raises noncon', () => {
    const { c, j } = fetCircuit({ is: 1e-14 });
    const off = c.element(createJfet, { type: 'J', name: 'J2', nodes: ['d2', 'g2', 's2'], model: 'JM', params: { off: 1 } }) as Jfet;
    c.setup();
    const x = new Float64Array(c.size);
    c.assemble(x, { initJunctions: true });
    expect([c.state0[j.stateBase], c.state0[j.stateBase + 1]]).toEqual([-1, -1]);
    expect([c.state0[off.stateBase], c.state0[off.stateBase + 1]]).toEqual([0, 0]);
    x[c.node('g')] = 2;
    expect(c.assemble(x, {}, [j]).noncon).toBe(true);
  });

  it('convTest, UIC initial conditions and parameter access', () => {
    const c = new TestCircuit().model(jmodel({ vto: -2, beta: 1e-3, cgs: 1e-12, vt0: -1.5, bogus: 1 }));
    const j = c.element(createJfet, {
      type: 'J',
      name: 'J1',
      nodes: ['d', 'g', '0'],
      model: 'JM',
      params: { ic_vgs: -0.4, ic_vds: 2 },
    }) as Jfet;
    c.setup();
    expect(c.warnings.some((w) => w.includes('bogus'))).toBe(true);
    // alias VT0 is applied after VTO in card order
    expect(j.getParam('vto')).toBe(-1.5);
    c.assemble(new Float64Array(c.size), { mode: 'tran', tranOp: true, uic: true, initJunctions: true });
    expect(c.state0[j.stateBase]).toBe(-0.4);
    expect(c.state0[j.stateBase + 1]).toBeCloseTo(-2.4, 15);
    const x = new Float64Array(c.size);
    x[c.node('g')] = -0.5;
    x[c.node('d')] = 3;
    c.settle(j, x);
    expect(c.convTests(x)).toBe(true);
    const y = Float64Array.from(x);
    y[c.node('g')] = -0.45;
    expect(c.convTests(y)).toBe(false);
    j.setParam('beta', 2e-3);
    expect(j.getParam('beta')).toBe(2e-3);
  });
});
