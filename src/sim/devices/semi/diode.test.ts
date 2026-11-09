import { describe, expect, it } from 'vitest';
import { BOLTZ, CHARGE } from '../../device';
import type { ModelCard } from '../../netlist';
import { K_OVER_Q, celsiusToKelvin } from './common';
import { Diode, createDiode } from './diode';
import { TestCircuit } from './test-harness';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;

function dmodel(params: Record<string, number>, name = 'DM'): ModelCard {
  return { name, type: 'D', params };
}

/** Diode directly across an ideal source: OP solution and outputs. */
function biasDiode(params: Record<string, number>, v: number, inst: Record<string, number> = {}) {
  const c = new TestCircuit().model(dmodel(params));
  const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM', params: inst });
  c.vsource('V1', 'a', '0', v);
  const r = c.op();
  expect(r.converged).toBe(true);
  return { c, d, x: r.x, out: d.outputs!((i) => (i < 0 ? 0 : r.x[i])) };
}

describe('diode static I-V', () => {
  const IS = 1e-14;
  it.each([0.3, 0.55, 0.65, 0.72])('forward bias %f V follows IS*(exp(V/nVt)-1)', (v) => {
    const { out } = biasDiode({ is: IS, n: 1 }, v);
    const expected = IS * (Math.exp(v / VT) - 1) + 1e-12 * v;
    expect(out.Id).toBeCloseTo(expected, 15);
    expect(Math.abs(out.Id / expected - 1)).toBeLessThan(1e-9);
    expect(out.I).toBe(out.Id);
    expect(out.P).toBeCloseTo(out.Id * v, 15);
  });

  it('emission coefficient N scales the exponential slope', () => {
    const v = 0.6;
    const { out } = biasDiode({ is: 1e-12, n: 1.8 }, v);
    expect(out.Id / (1e-12 * (Math.exp(v / (1.8 * VT)) - 1) + 1e-12 * v)).toBeCloseTo(1, 9);
  });

  it('reverse bias saturates at -IS (plus gmin)', () => {
    const { out } = biasDiode({ is: IS }, -5);
    // smooth SPICE reverse region: -IS*(1 + (3vt/(e*v))^3)
    const a = (3 * VT) / (-5 * Math.E);
    expect(out.Id).toBeCloseTo(-IS * (1 + a * a * a) - 1e-12 * 5, 20);
  });

  it('breakdown: reverse current equals IBV at -BV and grows exponentially beyond', () => {
    const p = { is: 1e-14, bv: 5.6, ibv: 1e-3 };
    const at = biasDiode(p, -5.6).out.Id;
    expect(Math.abs(at + 1e-3)).toBeLessThan(1e-3 * 1e-6);
    const beyond = biasDiode(p, -5.7).out.Id;
    expect(beyond / at).toBeCloseTo(Math.exp(0.1 / VT), 6);
    const before = biasDiode(p, -5.0).out.Id;
    expect(Math.abs(before)).toBeLessThan(1e-3 * Math.exp(-0.6 / VT) * 1.01 + 1e-11);
  });

  it('breakdown converges from 0 V through a series resistor (zener regulator)', () => {
    // tight Newton tolerance: the test checks KCL of the converged point to 1e-10 A
    const c = new TestCircuit({ reltol: 1e-9 }).model(dmodel({ is: 1e-14, bv: 5.1, ibv: 5e-3, rs: 1 }));
    const d = c.element(createDiode, { type: 'D', name: 'DZ', nodes: ['0', 'k'], model: 'DM' });
    c.vsource('V1', 'in', '0', 12);
    c.resistor('R1', 'in', 'k', 470);
    const r = c.op();
    expect(r.converged).toBe(true);
    const vk = c.v('k');
    const iR = (12 - vk) / 470;
    const id = d.outputs!((i) => (i < 0 ? 0 : r.x[i])).Id;
    // diode current anode(0)->cathode(k) is negative in breakdown and equals -iR (KCL)
    expect(id).toBeCloseTo(-iR, 9);
    expect(vk).toBeGreaterThan(5.1);
    expect(vk).toBeLessThan(5.4);
  });

  it('series resistance: forced 10 mA gives V = nVt ln(I/IS+1) + I*RS', () => {
    const c = new TestCircuit().model(dmodel({ is: 2.52e-9, n: 1.752, rs: 0.568 }));
    c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.isource('I1', '0', 'a', 10e-3);
    const r = c.op();
    expect(r.converged).toBe(true);
    expect(c.hasNode('D1#a')).toBe(true);
    const id = 10e-3 - 1e-12 * (c.v('D1#a') - 0); // gmin share is negligible but exact
    const vj = 1.752 * VT * Math.log(id / 2.52e-9 + 1);
    expect(c.v('a')).toBeCloseTo(vj + 10e-3 * 0.568, 9);
  });

  it('area and m scale the saturation current', () => {
    const base = biasDiode({ is: IS }, 0.6).out.Id;
    const scaled = biasDiode({ is: IS }, 0.6, { area: 2, m: 3 }).out.Id;
    expect((scaled - 6e-12 * 0) / base).toBeCloseTo(6, 3);
  });

  it('high injection IKF halves the slope at large currents', () => {
    const ikf = 1e-3;
    const v = 0.85;
    const out = biasDiode({ is: IS, ikf }, v).out.Id;
    const inrm = IS * (Math.exp(v / VT) - 1);
    expect(out - 1e-12 * v).toBeCloseTo(inrm * Math.sqrt(ikf / (ikf + inrm)), 12);
  });

  it('recombination current ISR/NR adds a generation-recombination component', () => {
    const v = 0.3;
    const out = biasDiode({ is: IS, isr: 1e-10, nr: 2, vj: 0.7, m: 0.4 }, v).out.Id;
    const kgen = Math.pow((1 - v / 0.7) ** 2 + 0.005, 0.2);
    const expected = IS * (Math.exp(v / VT) - 1) + 1e-10 * (Math.exp(v / (2 * VT)) - 1) * kgen + 1e-12 * v;
    expect(out / expected).toBeCloseTo(1, 9);
  });
});

describe('diode temperature', () => {
  it('IS scales with EG and XTI', () => {
    const v = 0.6;
    const c = new TestCircuit({ temp: 100 }).model(dmodel({ is: 1e-14, eg: 1.11, xti: 3 }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.vsource('V1', 'a', '0', v);
    const r = c.op();
    const T = celsiusToKelvin(100);
    const vt = K_OVER_Q * T;
    const isT = 1e-14 * Math.exp((T / T27 - 1) * (1.11 / vt)) * Math.pow(T / T27, 3);
    const id = d.outputs!((i) => (i < 0 ? 0 : r.x[i])).Id;
    expect(id / (isT * (Math.exp(v / vt) - 1) + 1e-12 * v)).toBeCloseTo(1, 9);
  });

  it('VJ decreases and CJO increases with temperature; identity at TNOM', () => {
    const d = new Diode({ type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM', params: {} });
    const c = new TestCircuit().model(dmodel({ cjo: 1e-12, vj: 0.8, m: 0.5 }));
    c.add(d);
    c.setup();
    expect(d.evaluateAt(0, T27).c).toBeCloseTo(1e-12, 20);
    const hot = d.evaluateAt(0, celsiusToKelvin(125)).c;
    expect(hot).toBeGreaterThan(1e-12);
    expect(hot).toBeLessThan(1.2e-12);
  });

  it('instance temp overrides the circuit temperature', () => {
    const a = biasDiode({ is: 1e-14 }, 0.6, { temp: 75 }).out.Id;
    const c = new TestCircuit({ temp: 75 }).model(dmodel({ is: 1e-14 }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.vsource('V1', 'a', '0', 0.6);
    const r = c.op();
    expect(a).toBeCloseTo(d.outputs!((i) => (i < 0 ? 0 : r.x[i])).Id, 15);
  });
});

describe('diode Jacobian vs finite differences', () => {
  const params = { is: 1e-14, n: 1.3, rs: 2, cjo: 2e-12, vj: 0.75, m: 0.4, tt: 5e-9, bv: 30, ibv: 1e-4, ikf: 0.05, isr: 1e-11 };
  const biases = [0.75, 0.5, 0.1, -0.02, -0.2, -3, -29.9, -30.2];
  function circuit() {
    const c = new TestCircuit().model(dmodel(params));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', 'k'], model: 'DM' });
    c.setup();
    return { c, d };
  }
  it.each(biases)('DC at vd = %f', (v) => {
    const { c, d } = circuit();
    // cathode is a non-ground node at 0 V so its row isolates the junction stamp; a small
    // 0.1 mV drop across RS exercises the series-resistance stamp without large currents
    const x = new Float64Array(c.size);
    x[c.node('a')] = v + 1e-4;
    x[c.node('D1#a')] = v;
    x[c.node('k')] = 0;
    const r = c.jacobianError(d, x, { mode: 'op' });
    expect(r.maxRel).toBeLessThan(1e-4);
  });
  it.each(biases)('transient (trap and BE) at vd = %f', (v) => {
    for (const method of ['be', 'trap'] as const) {
      const { c, d } = circuit();
      const x = new Float64Array(c.size);
      x[c.node('a')] = v;
      x[c.node('D1#a')] = v - 0.001;
      x[c.node('k')] = 0;
      // history: charge at a different voltage
      c.assemble(x.map((y) => y * 0.9), { mode: 'op', tranOp: true });
      c.state1.set(c.state0);
      c.state2.set(c.state0);
      const r = c.jacobianError(d, x, { mode: 'tran', dt: 1e-9, method, time: 1e-9 });
      expect(r.maxRel).toBeLessThan(1e-4);
    }
  });
});

describe('diode charge storage', () => {
  const cjo = 4e-12;
  const vj = 0.7;
  const m = 0.45;
  const fc = 0.5;
  const tt = 1e-8;
  function dev(extra: Record<string, number> = {}) {
    const d = new Diode({ type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM', params: {} });
    const c = new TestCircuit({ gmin: 0 }).model(dmodel({ is: 1e-14, cjo, vj, m, fc, ...extra }));
    c.add(d);
    c.setup();
    return d;
  }
  it.each([-10, -2, -0.5, 0, 0.2, 0.34])('depletion capacitance at %f V matches CJO/(1-V/VJ)^M', (v) => {
    const e = dev().evaluateAt(v, T27);
    expect(e.c / (cjo / Math.pow(1 - v / vj, m))).toBeCloseTo(1, 12);
    const qExpected = (vj * cjo * (1 - Math.pow(1 - v / vj, 1 - m))) / (1 - m);
    if (v === 0) expect(e.q).toBe(0);
    else expect(e.q / qExpected).toBeCloseTo(1, 10);
  });
  it.each([0.36, 0.5, 0.8])('forward region above FC*VJ uses the linear extrapolation at %f V', (v) => {
    const e = dev().evaluateAt(v, T27);
    const f2 = Math.pow(1 - fc, 1 + m);
    const f3 = 1 - fc * (1 + m);
    const cap = (cjo / f2) * (f3 + (m * v) / vj);
    // diffusion part is zero (TT = 0); compare depletion only
    expect(e.c / cap).toBeCloseTo(1, 10);
  });
  it('diffusion capacitance equals TT * gd', () => {
    const d = dev({ tt, cjo: 0 });
    const v = 0.65;
    const e = d.evaluateAt(v, T27);
    const gd = (1e-14 * Math.exp(v / VT)) / VT;
    expect(e.c / (tt * gd)).toBeCloseTo(1, 9);
    expect(e.q / (tt * 1e-14 * (Math.exp(v / VT) - 1))).toBeCloseTo(1, 9);
  });

  it('integrate() receives the junction charge and its capacitance', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14, cjo, vj, m, tt }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' }) as Diode;
    c.setup();
    const x = new Float64Array(c.size);
    x[c.node('a')] = -1.5;
    c.assemble(x, { mode: 'op', tranOp: true });
    c.state1.set(c.state0);
    c.settle(d, x, { mode: 'tran', dt: 1e-9, time: 1e-9 });
    c.integrateCalls.length = 0;
    c.assemble(x, { mode: 'tran', dt: 1e-9, time: 1e-9 });
    expect(c.integrateCalls).toHaveLength(1);
    const call = c.integrateCalls[0];
    expect(call.q).toBe(d.stateBase + 1);
    const e = d.evaluateAt(-1.5, T27);
    expect(call.cap).toBeCloseTo(e.c, 25);
    expect(call.charge).toBeCloseTo(e.q, 25);
    expect(call.cap / (cjo / Math.pow(1 + 1.5 / vj, m) + tt * 1e-14 * 0)).toBeCloseTo(1, 6);
  });

  it('transient (UIC from 0 V): a constant current charges the junction so that dQ = I*dt per step', () => {
    // tight Newton tolerances: the charge balance is checked to 1e-6 relative
    const c = new TestCircuit({ gmin: 0, reltol: 1e-10, vntol: 1e-12 }).model(dmodel({ is: 1e-16, cjo, vj, m }));
    c.element(createDiode, { type: 'D', name: 'D1', nodes: ['0', 'k'], model: 'DM' });
    c.isource('I1', '0', 'k', 1e-6); // drives 1 uA into k: the junction (anode 0, cathode k) charges in reverse
    c.setup();
    const qdep = (v: number): number => (vj * cjo * (1 - Math.pow(1 - v / vj, 1 - m))) / (1 - m);
    const dt = 1e-7;
    const vk: number[] = [0];
    for (const method of ['trap', 'be'] as const) {
      vk.length = 1;
      c.x.fill(0);
      c.state0.fill(0);
      c.transient(dt, 40, method, (_t, x) => vk.push(x[c.node('k')]), { uic: true });
      // after 40 steps the junction is reverse biased by more than a volt
      expect(vk[vk.length - 1]).toBeGreaterThan(1.2);
      for (let k = 1; k < vk.length; k++) {
        // diode current (anode -> cathode) is -1 uA, so the junction charge q(-vk) drops by I*dt
        const dq = qdep(-vk[k - 1]) - qdep(-vk[k]);
        expect(dq / (1e-6 * dt)).toBeCloseTo(1, 6);
      }
    }
  });
});

describe('diode AC consistency', () => {
  it('AC admittance equals DC Jacobian + j*omega*C from the transient companion', () => {
    const params = { is: 1e-14, n: 1.1, rs: 5, cjo: 3e-12, vj: 0.7, m: 0.5, tt: 2e-9 };
    for (const v of [0.68, 0.2, -4]) {
      const c = new TestCircuit().model(dmodel(params));
      const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
      c.setup();
      const x = new Float64Array(c.size);
      x[c.node('a')] = v + 0.002;
      x[c.node('D1#a')] = v;
      c.settle(d, x, { mode: 'op', tranOp: true });
      const gdc = c.assemble(x, { mode: 'op', tranOp: true }).G;
      c.state1.set(c.state0);
      const dt = 1e-6;
      c.settle(d, x, { mode: 'tran', dt, time: dt });
      const gtr = c.assemble(x, { mode: 'tran', dt, time: dt }).G;
      const omega = 1e-3;
      const ac = c.acAssemble(x, omega);
      for (let i = 0; i < c.size; i++) {
        for (let j = 0; j < c.size; j++) {
          expect(ac.re[i][j]).toBeCloseTo(gdc[i][j], 12);
          const capTr = (gtr[i][j] - gdc[i][j]) * dt;
          const capAc = ac.im[i][j] / omega;
          expect(Math.abs(capAc - capTr)).toBeLessThan(1e-9 * Math.abs(capTr) + 1e-24);
        }
      }
    }
  });
});

describe('diode Newton convergence and conv test', () => {
  it('diode + 1k resistor from 5 V converges from 0 V and satisfies KCL', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14, n: 1, rs: 0.5 }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.vsource('V1', 'in', '0', 5);
    c.resistor('R1', 'in', 'a', 1000);
    const r = c.op();
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(40);
    const id = d.outputs!((i) => (i < 0 ? 0 : r.x[i])).Id;
    const iR = (5 - c.v('a')) / 1000;
    expect(id).toBeCloseTo(iR, 9);
    expect(c.v('a')).toBeGreaterThan(0.6);
    expect(c.v('a')).toBeLessThan(0.75);
  });

  it('also converges without initJunctions starting from 0 thanks to pnjlim', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14 }));
    c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.vsource('V1', 'in', '0', 100);
    c.resistor('R1', 'in', 'a', 10);
    const r = c.newton({ mode: 'op' });
    expect(r.converged).toBe(true);
    const ia = (100 - c.v('a')) / 10;
    expect(c.v('a')).toBeCloseTo(VT * Math.log(ia / 1e-14 + 1), 6);
  });

  it('convTest rejects a large current change and accepts the converged point', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14 }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.setup();
    const x = new Float64Array(c.size);
    x[c.node('a')] = 0.6;
    c.settle(d, x);
    expect(c.convTests(x)).toBe(true);
    const y = Float64Array.from(x);
    y[c.node('a')] = 0.61;
    expect(c.convTests(y)).toBe(false);
  });

  it('initJunctions starts at vcrit, or 0 for an OFF diode; limiting signals noncon', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14 }));
    const on = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    const off = c.element(createDiode, { type: 'D', name: 'D2', nodes: ['b', '0'], model: 'DM', params: { off: 1 } });
    c.setup();
    const x = new Float64Array(c.size);
    const ion = c.deviceCurrents(on, x, { initJunctions: true });
    const vcrit = VT * Math.log(VT / (Math.SQRT2 * 1e-14));
    // linearised at vcrit, evaluated at 0 V: i(vcrit) - g(vcrit)*vcrit
    const ivc = 1e-14 * (Math.exp(vcrit / VT) - 1) + 1e-12 * vcrit;
    const gvc = (1e-14 * Math.exp(vcrit / VT)) / VT + 1e-12;
    expect(ion[c.node('a')]).toBeCloseTo(ivc - gvc * vcrit, 15);
    const ioff = c.deviceCurrents(off, x, { initJunctions: true });
    expect(ioff[c.node('b')]).toBe(0);
    x[c.node('a')] = 3;
    expect(c.assemble(x, {}, [on]).noncon).toBe(true);
  });
});

describe('diode UIC, noise, truncation, params', () => {
  it('uses the instance IC for the charge at a UIC transient start', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14, cjo: 1e-12 }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM', params: { ic: -2 } }) as Diode;
    c.setup();
    c.assemble(new Float64Array(c.size), { mode: 'tran', tranOp: true, uic: true, initJunctions: true });
    expect(c.state0[d.stateBase]).toBe(-2);
    expect(c.state0[d.stateBase + 1]).toBeCloseTo(d.evaluateAt(-2, T27).q, 25);
  });

  it('noise: RS thermal 4kT/RS, shot 2q|Id|, flicker KF*Id^AF/f', () => {
    const { c, x, out } = biasDiode({ is: 1e-14, rs: 10, kf: 1e-16, af: 1.2 }, 0.7);
    const gens = c.noise(x);
    const byName = Object.fromEntries(gens.map((g) => [g.name, g]));
    expect(byName.thermal_rs.density(1e3)).toBeCloseTo((4 * BOLTZ * T27) / 10, 30);
    // junction current excludes gmin
    const id = out.Id - 1e-12 * (x[c.node('D1#a')] - 0);
    expect(byName.shot.density(1e3) / (2 * CHARGE * id)).toBeCloseTo(1, 9);
    expect(byName.flicker.density(100) / ((1e-16 * Math.pow(id, 1.2)) / 100)).toBeCloseTo(1, 9);
  });

  it('truncate() asks terr for the junction charge only when charge storage exists', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14, cjo: 1e-12 })).model(dmodel({ is: 1e-14 }, 'NOCAP'));
    const d1 = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' }) as Diode;
    const d2 = c.element(createDiode, { type: 'D', name: 'D2', nodes: ['a', '0'], model: 'NOCAP' });
    c.setup();
    expect(c.truncate(d1, 1e-9, 3e-9)).toBe(3e-9);
    expect(c.terrCalls).toEqual([d1.stateBase + 1]);
    expect(c.truncate(d2, 1e-9)).toBe(Infinity);
  });

  it('warns about missing models and unsupported parameters; setParam/getParam', () => {
    const c = new TestCircuit().model(dmodel({ is: 1e-14, foo: 3, vceo: 40 }));
    const d = c.element(createDiode, { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DM' });
    c.element(createDiode, { type: 'D', name: 'D2', nodes: ['a', '0'], model: 'DM' });
    c.element(createDiode, { type: 'D', name: 'D3', nodes: ['a', '0'], model: 'NOPE' });
    c.setup();
    expect(c.warnings.filter((w) => w.includes('foo'))).toHaveLength(1);
    expect(c.warnings.some((w) => w.includes('vceo'))).toBe(false);
    expect(c.warnings.some((w) => w.includes("'NOPE' not found"))).toBe(true);
    expect(d.getParam!('IS')).toBe(1e-14);
    d.setParam!('is', 2e-14);
    expect(d.getParam!('is')).toBe(2e-14);
    expect(d.getParam!('area')).toBe(1);
    d.setParam!('area', 3);
    expect(d.getParam!('area')).toBe(3);
  });
});
