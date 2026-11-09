import { describe, expect, it } from 'vitest';
import { BOLTZ, CHARGE } from '../../device';
import type { ModelCard } from '../../netlist';
import { Bjt, createBjt } from './bjt';
import { K_OVER_Q, celsiusToKelvin } from './common';
import { TestCircuit } from './test-harness';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;

function qmodel(params: Record<string, number>, type: 'NPN' | 'PNP' = 'NPN', name = 'QM'): ModelCard {
  return { name, type, params };
}

/** Transistor with ideal sources on base and collector (emitter grounded); gmin = 0. */
function biasBjt(params: Record<string, number>, vbe: number, vce: number, type: 'NPN' | 'PNP' = 'NPN', opts: { tempC?: number } = {}) {
  const c = new TestCircuit({ gmin: 0, temp: opts.tempC ?? 27 }).model(qmodel(params, type));
  const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', '0'], model: 'QM' });
  c.vsource('VB', 'b', '0', vbe);
  c.vsource('VC', 'c', '0', vce);
  const r = c.op();
  expect(r.converged).toBe(true);
  // evaluate at the exactly applied voltages (the solved vector carries elimination roundoff)
  const xe = Float64Array.from(r.x);
  xe[c.node('b')] = vbe;
  xe[c.node('c')] = vce;
  return { c, q, out: q.outputs!((i) => (i < 0 ? 0 : xe[i])) };
}

/** Ideal-diode helpers at 27 °C. */
const diode = (is: number, v: number, n = 1): number => is * (Math.exp(v / (n * VT)) - 1);

describe('BJT static I-V (Gummel-Poon)', () => {
  const IS = 1e-16;
  const BF = 100;

  it('forward active: Ic = IS(exp(Vbe/Vt)-1) - Ibc terms, beta = BF', () => {
    const vbe = 0.68;
    const vce = 5;
    const { out } = biasBjt({ is: IS, bf: BF }, vbe, vce);
    const cbe = diode(IS, vbe);
    const cbc = diode(IS, vbe - vce);
    expect(out.Ic / (cbe - cbc - cbc / 1)).toBeCloseTo(1, 10);
    expect(out.Ib / (cbe / BF + cbc / 1)).toBeCloseTo(1, 10);
    expect(out.Ic / out.Ib).toBeCloseTo(BF, 6);
    expect(out.Ie).toBeCloseTo(-(out.Ic + out.Ib), 18);
    expect(out.P).toBeCloseTo(out.Ic * vce + out.Ib * vbe, 15);
  });

  it('emission coefficient NF and leakage ISE/NE enter the base current', () => {
    const vbe = 0.45;
    const p = { is: IS, bf: BF, nf: 1.05, ise: 1e-14, ne: 1.7 };
    const { out } = biasBjt(p, vbe, 3);
    const cbe = diode(IS, vbe, 1.05);
    const cbc = diode(IS, vbe - 3);
    expect(out.Ib / (cbe / BF + diode(1e-14, vbe, 1.7) + cbc)).toBeCloseTo(1, 10);
    // at low current the leakage dominates and beta collapses
    expect(out.Ic / out.Ib).toBeLessThan(BF / 2);
  });

  it('Early effect: Ic = (cbe - cbc)(1 - Vbc/VAF); output slope ~ Ic/(VAF+Vce)', () => {
    const vaf = 50;
    const vbe = 0.7;
    const at = (vce: number) => biasBjt({ is: IS, bf: BF, vaf }, vbe, vce).out.Ic;
    for (const vce of [2, 10]) {
      const vbc = vbe - vce;
      const expected = (diode(IS, vbe) - diode(IS, vbc)) * (1 - vbc / vaf) - diode(IS, vbc);
      expect(at(vce) / expected).toBeCloseTo(1, 10);
    }
    // Ic = I0*(1 + (Vce - Vbe)/VAF): the output conductance is I0/VAF = Ic/(VAF + Vce - Vbe)
    const slope = (at(10) - at(2)) / 8;
    expect(slope / (at(2) / (vaf + 2 - vbe))).toBeCloseTo(1, 6);
  });

  it('reverse Early voltage VAR and high injection IKF/IKR set qb', () => {
    const p = { is: IS, bf: BF, vaf: 40, var: 8, ikf: 2e-3, ikr: 1e-3 };
    const vbe = 0.85;
    const vce = 4;
    const { out } = biasBjt(p, vbe, vce);
    const vbc = vbe - vce;
    const cbe = diode(IS, vbe);
    const cbc = diode(IS, vbc);
    const q1 = 1 / (1 - vbc / 40 - vbe / 8);
    const q2 = cbe / 2e-3 + cbc / 1e-3;
    const qb = (q1 * (1 + Math.sqrt(1 + 4 * q2))) / 2;
    expect(out.Ic / ((cbe - cbc) / qb - cbc)).toBeCloseTo(1, 10);
    // high injection reduces the collector current far below IS*exp(Vbe/Vt)
    expect(out.Ic).toBeLessThan(0.5 * cbe);
  });

  it('saturation: both junctions forward biased, Ic/Ib far below BF', () => {
    const vbe = 0.75;
    const vce = 0.04;
    const { out } = biasBjt({ is: IS, bf: BF, br: 2 }, vbe, vce);
    const cbe = diode(IS, vbe);
    const cbc = diode(IS, vbe - vce);
    expect(out.Ic / (cbe - cbc - cbc / 2)).toBeCloseTo(1, 10);
    expect(out.Ib / (cbe / BF + cbc / 2)).toBeCloseTo(1, 10);
    expect(out.Ic / out.Ib).toBeLessThan(10);
  });

  it('reverse active: emitter and collector exchange roles with BR', () => {
    const { out } = biasBjt({ is: IS, bf: BF, br: 4 }, 0, -0.7);
    // vbe = 0, vbc = 0.7: current flows out of the collector terminal
    const cbc = diode(IS, 0.7);
    expect(out.Ic / (-cbc - cbc / 4)).toBeCloseTo(1, 10);
    expect(out.Ib / (cbc / 4)).toBeCloseTo(1, 10);
  });

  it('PNP mirrors NPN: all terminal currents change sign', () => {
    const p = { is: IS, bf: BF, vaf: 60, ikf: 5e-3 };
    const n = biasBjt(p, 0.7, 3).out;
    const pnp = biasBjt(p, -0.7, -3, 'PNP').out;
    expect(pnp.Ic).toBeCloseTo(-n.Ic, 18);
    expect(pnp.Ib).toBeCloseTo(-n.Ib, 20);
    expect(pnp.Ie).toBeCloseTo(-n.Ie, 18);
    expect(pnp.P).toBeCloseTo(n.P, 15);
  });

  it('area scales currents; temperature scales IS (EG, XTI) and BF (XTB)', () => {
    const base = biasBjt({ is: IS, bf: BF }, 0.65, 3).out.Ic;
    const c = new TestCircuit({ gmin: 0 }).model(qmodel({ is: IS, bf: BF }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', '0'], model: 'QM', params: { area: 3 } });
    c.vsource('VB', 'b', '0', 0.65);
    c.vsource('VC', 'c', '0', 3);
    expect(c.op().converged).toBe(true);
    const xe = new Float64Array(c.size);
    xe[c.node('b')] = 0.65;
    xe[c.node('c')] = 3;
    expect(q.outputs!((i) => (i < 0 ? 0 : xe[i])).Ic / base).toBeCloseTo(3, 9);

    const T = celsiusToKelvin(80);
    const vt = K_OVER_Q * T;
    const hot = biasBjt({ is: IS, bf: BF, xtb: 1.5, xti: 3, eg: 1.11 }, 0.6, 3, 'NPN', { tempC: 80 }).out;
    const isT = IS * Math.exp((T / T27 - 1) * (1.11 / vt)) * Math.pow(T / T27, 3);
    const cbe = isT * (Math.exp(0.6 / vt) - 1);
    const cbc = isT * (Math.exp(-2.4 / vt) - 1);
    // XTB scales both BF and BR (BR = 1 here)
    const bfT = BF * Math.pow(T / T27, 1.5);
    const brT = Math.pow(T / T27, 1.5);
    expect(hot.Ic / (cbe - cbc - cbc / brT)).toBeCloseTo(1, 12);
    expect(hot.Ib / (cbe / bfT + cbc / brT)).toBeCloseTo(1, 12);
  });
});

const FULL = {
  is: 1e-15,
  bf: 120,
  nf: 1.02,
  vaf: 60,
  ikf: 0.08,
  ise: 2e-14,
  ne: 1.6,
  br: 3,
  nr: 1.01,
  var: 20,
  ikr: 0.02,
  isc: 1e-13,
  nc: 1.8,
  rb: 50,
  irb: 1e-4,
  rbm: 5,
  re: 0.8,
  rc: 4,
  cje: 2e-11,
  vje: 0.75,
  mje: 0.36,
  tf: 4e-10,
  xtf: 3,
  vtf: 4,
  itf: 0.4,
  cjc: 8e-12,
  vjc: 0.7,
  mjc: 0.33,
  xcjc: 0.6,
  tr: 5e-8,
  cjs: 3e-12,
  vjs: 0.6,
  mjs: 0.4,
};

/** Bias points (vbe, vbc) across the operating regions. */
const BIASES: Array<[string, number, number]> = [
  ['forward active', 0.7, -4],
  ['high injection', 0.82, -2],
  ['saturation', 0.75, 0.55],
  ['reverse active', -3, 0.7],
  ['cutoff', -1, -5],
  ['weak forward', 0.3, -0.3],
  ['forward depletion beyond FC*VJ', 0.5, 0.45],
];

function fourTerminal(params: Record<string, number>, type: 'NPN' | 'PNP' = 'NPN') {
  const c = new TestCircuit().model(qmodel(params, type));
  const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e', 's'], model: 'QM' }) as Bjt;
  c.setup();
  return { c, q };
}

/** Solution vector with the internal junction voltages (device polarity) requested. */
function biasVector(c: TestCircuit, vbe: number, vbc: number, pol = 1): Float64Array {
  const x = new Float64Array(c.size);
  const vEi = 0.01;
  const vBi = vEi + vbe;
  const vCi = vBi - vbc;
  const set = (n: string, v: number) => {
    if (c.hasNode(n)) x[c.node(n)] = pol * v;
  };
  set('Q1#e', vEi);
  set('Q1#b', vBi);
  set('Q1#c', vCi);
  set('e', vEi - 0.001);
  set('b', vBi + 0.004);
  set('c', vCi + 0.002);
  set('s', vCi - 3);
  return x;
}

describe('BJT Jacobian vs finite differences', () => {
  const variants: Array<[string, Record<string, number>, 'NPN' | 'PNP']> = [
    ['NPN with IRB crowding', FULL, 'NPN'],
    ['NPN with qb-modulated RB', { ...FULL, irb: 0 }, 'NPN'],
    ['PNP', FULL, 'PNP'],
  ];
  for (const [label, params, type] of variants) {
    it.each(BIASES)(`${label} DC: %s`, (_r, vbe, vbc) => {
      const { c, q } = fourTerminal(params, type);
      const x = biasVector(c, vbe, vbc, type === 'PNP' ? -1 : 1);
      const r = c.jacobianError(q, x, { mode: 'op' });
      expect(r.maxRel).toBeLessThan(1e-4);
    });
  }

  it.each(BIASES)('transient companion (BE, trap; with excess phase PTF): %s', (_r, vbe, vbc) => {
    for (const method of ['be', 'trap'] as const) {
      for (const ptf of [0, 35]) {
        const { c, q } = fourTerminal({ ...FULL, ptf });
        const x = biasVector(c, vbe, vbc);
        c.assemble(
          x.map((y) => y * 0.93),
          { mode: 'op', tranOp: true },
        );
        c.state1.set(c.state0);
        c.state2.set(c.state0);
        const r = c.jacobianError(q, x, { mode: 'tran', dt: 2e-10, method, time: 2e-10 });
        expect(r.maxRel).toBeLessThan(1e-4);
      }
    }
  });
});

describe('BJT charges and capacitances', () => {
  function dev(params: Record<string, number>) {
    const c = new TestCircuit().model(qmodel(params));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e', 's'], model: 'QM' }) as Bjt;
    c.setup();
    return { c, q };
  }

  it.each([-5, -1, 0, 0.3])('CJE depletion capacitance at vbe = %f', (vbe) => {
    const { q } = dev({ cje: 2e-12, vje: 0.8, mje: 0.4 });
    const e = q.evaluateAt(vbe, -2, T27);
    expect(e.capbe / (2e-12 / Math.pow(1 - vbe / 0.8, 0.4))).toBeCloseTo(1, 12);
    const qx = (0.8 * 2e-12 * (1 - Math.pow(1 - vbe / 0.8, 0.6))) / 0.6;
    if (vbe === 0) expect(e.qbe).toBe(0);
    else expect(e.qbe / qx).toBeCloseTo(1, 10);
  });

  it('CJC splits into XCJC (internal base) and 1-XCJC (external base)', () => {
    const { q } = dev({ cjc: 5e-12, vjc: 0.6, mjc: 0.5, xcjc: 0.3 });
    const e = q.evaluateAt(0.6, -3, T27, -2.5);
    expect(e.capbc / ((0.3 * 5e-12) / Math.sqrt(1 + 3 / 0.6))).toBeCloseTo(1, 12);
    expect(e.capbx / ((0.7 * 5e-12) / Math.sqrt(1 + 2.5 / 0.6))).toBeCloseTo(1, 12);
  });

  it('CJS uses the SPICE linear forward extension from 0 V (no FC)', () => {
    const { q } = dev({ cjs: 3e-12, vjs: 0.6, mjs: 0.4 });
    expect(q.evaluateAt(0.6, -1, T27, -1, 0.3).capcs / (3e-12 * (1 + (0.4 * 0.3) / 0.6))).toBeCloseTo(1, 12);
    expect(q.evaluateAt(0.6, -1, T27, -1, -2).capcs / (3e-12 / Math.pow(1 + 2 / 0.6, 0.4))).toBeCloseTo(1, 12);
  });

  it('transit time: qbe = TF*cbe/qb and C = TF*gbe without XTF; XTF raises the charge', () => {
    const { q } = dev({ is: 1e-15, tf: 3e-10 });
    const vbe = 0.7;
    const e = q.evaluateAt(vbe, -3, T27);
    const cbe = 1e-15 * (Math.exp(vbe / VT) - 1);
    expect(e.qbe / (3e-10 * cbe)).toBeCloseTo(1, 10);
    expect(e.capbe / ((3e-10 * 1e-15 * Math.exp(vbe / VT)) / VT)).toBeCloseTo(1, 10);
    expect(e.qbc).toBeCloseTo(0, 30);
    const x = dev({ is: 1e-15, tf: 3e-10, xtf: 2, itf: 0.01 }).q.evaluateAt(vbe, -3, T27);
    const tmp = cbe / (cbe + 0.01);
    expect(x.qbe / (3e-10 * cbe * (1 + 2 * tmp * tmp))).toBeCloseTo(1, 10);
  });

  it('reverse transit time: qbc = TR*cbc', () => {
    const { q } = dev({ is: 1e-15, tr: 1e-8 });
    const e = q.evaluateAt(0.2, 0.6, T27);
    expect(e.qbc / (1e-8 * 1e-15 * (Math.exp(0.6 / VT) - 1))).toBeCloseTo(1, 10);
  });

  it('integrate() is called for every charge with its own capacitance dq/dv', () => {
    const { c, q } = fourTerminal(FULL);
    const x = biasVector(c, 0.7, -3);
    c.assemble(x, { mode: 'op', tranOp: true });
    c.state1.set(c.state0);
    c.state2.set(c.state0);
    const flags = { mode: 'tran' as const, dt: 1e-9, time: 1e-9 };
    c.settle(q, x, flags);
    c.integrateCalls.length = 0;
    c.assemble(x, flags);
    const e = q.evaluateAt(0.7, -3, T27, x[c.node('b')] - x[c.node('Q1#c')], x[c.node('s')] - x[c.node('Q1#c')]);
    const byQ = new Map(c.integrateCalls.map((k) => [k.q - q.stateBase, k]));
    expect(byQ.get(2)!.cap).toBeCloseTo(e.capbe, 25);
    expect(byQ.get(2)!.charge).toBeCloseTo(e.qbe, 25);
    expect(byQ.get(4)!.cap).toBeCloseTo(e.capbc, 25);
    expect(byQ.get(6)!.cap).toBeCloseTo(e.capbx, 25);
    expect(byQ.get(8)!.cap).toBeCloseTo(e.capcs, 25);
    expect(byQ.get(8)!.charge).toBeCloseTo(e.qcs, 25);
  });
});

describe('BJT AC consistency', () => {
  it('AC admittance equals the DC Jacobian plus j*omega times the transient capacitances', () => {
    for (const [, vbe, vbc] of BIASES) {
      const { c, q } = fourTerminal(FULL);
      const x = biasVector(c, vbe, vbc);
      c.settle(q, x, { mode: 'op', tranOp: true });
      const gdc = c.assemble(x, { mode: 'op', tranOp: true }).G;
      c.state1.set(c.state0);
      c.state2.set(c.state0);
      const dt = 1e-6;
      c.settle(q, x, { mode: 'tran', dt, time: dt });
      const gtr = c.assemble(x, { mode: 'tran', dt, time: dt }).G;
      const omega = 1e-3;
      const ac = c.acAssemble(x, omega);
      for (let i = 0; i < c.size; i++) {
        for (let j = 0; j < c.size; j++) {
          expect(Math.abs(ac.re[i][j] - gdc[i][j])).toBeLessThan(1e-12 * (Math.abs(gdc[i][j]) + 1e-12));
          const capTr = (gtr[i][j] - gdc[i][j]) * dt;
          expect(Math.abs(ac.im[i][j] / omega - capTr)).toBeLessThan(1e-7 * Math.abs(capTr) + 1e-24);
        }
      }
    }
  });

  it('excess phase rotates the AC transconductance by exp(-j omega td)', () => {
    const { c, q } = fourTerminal({ is: 1e-15, bf: 100, tf: 1e-9, ptf: 40 });
    // no series resistances: the terminals are the junction nodes
    const x = new Float64Array(c.size);
    x[c.node('b')] = 0.7;
    x[c.node('c')] = 3.7;
    x[c.node('s')] = 0.7;
    const td = ((40 * Math.PI) / 180) * 1e-9;
    const omega = 2 * Math.PI * 50e6;
    const ac = c.acAssemble(x, omega, [q]);
    const e = q.evaluateAt(0.7, -3, T27);
    const ci = c.node('c');
    const bi = c.node('b');
    // row c, column b holds d it/d vbe (+ gitBc contribution from vbc = vb - vc)
    const gmin = c.options.gmin;
    expect(ac.re[ci][bi] / (e.gitBe * Math.cos(omega * td) + e.gitBc - e.gmu - gmin)).toBeCloseTo(1, 12);
    expect(ac.im[ci][bi] / (-e.gitBe * Math.sin(omega * td) - omega * e.capbc - omega * e.capbx)).toBeCloseTo(1, 9);
  });
});

describe('BJT Newton convergence and circuit behaviour', () => {
  it('four-resistor bias network converges from 0 V and satisfies KCL at every terminal', () => {
    const c = new TestCircuit({ reltol: 1e-9 }).model(qmodel({ is: 1e-15, bf: 100, vaf: 80, rb: 10, re: 0.5, rc: 2, cje: 1e-11 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e'], model: 'QM' });
    c.vsource('VCC', 'vcc', '0', 12);
    c.resistor('R1', 'vcc', 'b', 47e3);
    c.resistor('R2', 'b', '0', 10e3);
    c.resistor('RC', 'vcc', 'c', 2200);
    c.resistor('RE', 'e', '0', 1000);
    const r = c.op();
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(60);
    const out = q.outputs!((i) => (i < 0 ? 0 : r.x[i]));
    const vb = c.v('b');
    const vc = c.v('c');
    const ve = c.v('e');
    expect(out.Ic / ((12 - vc) / 2200)).toBeCloseTo(1, 7);
    expect(out.Ie / (-ve / 1000)).toBeCloseTo(1, 7);
    expect(out.Ib / ((12 - vb) / 47e3 - vb / 10e3)).toBeCloseTo(1, 5);
    // textbook sanity: Vbe ~ 0.6-0.75 V, forward active, Ic ~ 1.3 mA
    expect(vb - ve).toBeGreaterThan(0.6);
    expect(vb - ve).toBeLessThan(0.75);
    expect(vc).toBeGreaterThan(ve + 1);
    expect(out.Ic).toBeGreaterThan(1.1e-3);
    expect(out.Ic).toBeLessThan(1.5e-3);
  });

  it('PNP common-emitter stage converges and mirrors the NPN result', () => {
    const solve = (type: 'NPN' | 'PNP') => {
      const s = type === 'NPN' ? 1 : -1;
      const c = new TestCircuit({ reltol: 1e-9 }).model(qmodel({ is: 1e-15, bf: 100, vaf: 80 }, type));
      const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', '0'], model: 'QM' });
      c.vsource('VCC', 'vcc', '0', 10 * s);
      c.resistor('RB', 'vcc', 'b', 1e6);
      c.resistor('RC', 'vcc', 'c', 4.7e3);
      const r = c.op();
      expect(r.converged).toBe(true);
      return { vc: c.v('c'), ic: q.outputs!((i) => (i < 0 ? 0 : r.x[i])).Ic };
    };
    const n = solve('NPN');
    const p = solve('PNP');
    expect(p.vc).toBeCloseTo(-n.vc, 6);
    expect(p.ic).toBeCloseTo(-n.ic, 10);
  });

  it('excess phase delays the collector current after a base step but has unity DC gain', () => {
    const c = new TestCircuit({ reltol: 1e-8 }).model(qmodel({ is: 1e-15, bf: 100, tf: 1e-9, ptf: 60 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', '0'], model: 'QM' });
    const vb = c.vsource('VB', 'b', '0', 0.6);
    c.vsource('VC', 'c', '0', 5);
    const ic = (x: Float64Array) => q.outputs!((i) => (i < 0 ? 0 : x[i])).Ic;
    c.setup();
    const r0 = c.op();
    expect(r0.converged).toBe(true);
    const icOld = ic(r0.x);
    // DC solution at the new bias (no transient: excess phase inactive)
    vb.volts = 0.65;
    const icNew = ic(c.op().x);
    vb.volts = 0.6;
    c.op();
    vb.volts = 0.65;
    const seen: number[] = [];
    // run a transient that starts from the 0.6 V operating point, then steps the source
    c.assemble(r0.x, { mode: 'op', tranOp: true });
    c.state1.set(c.state0);
    c.state2.set(c.state0);
    let x = r0.x;
    const dt = 2e-11;
    for (let k = 1; k <= 600; k++) {
      const res = c.newton({ mode: 'tran', time: k * dt, dt, method: k === 1 ? 'be' : 'trap', initTimepoint: true }, x);
      expect(res.converged).toBe(true);
      x = res.x;
      seen.push(ic(x));
      c.state2.set(c.state1);
      c.state1.set(c.state0);
    }
    expect(icNew / icOld).toBeGreaterThan(5);
    // the first step responds only by a small fraction of the change
    expect((seen[0] - icOld) / (icNew - icOld)).toBeLessThan(0.05);
    // settles to the DC value
    expect(seen[seen.length - 1] / icNew).toBeCloseTo(1, 4);
  });
});

describe('BJT UIC, noise, outputs, params', () => {
  it('UIC start uses ic_vbe / ic_vce for the junction state', () => {
    const c = new TestCircuit().model(qmodel({ cje: 1e-12, cjc: 1e-12 }));
    const q = c.element(createBjt, {
      type: 'Q',
      name: 'Q1',
      nodes: ['c', 'b', 'e'],
      model: 'QM',
      params: { ic_vbe: 0.7, ic_vce: 3 },
    }) as Bjt;
    c.setup();
    c.assemble(new Float64Array(c.size), { mode: 'tran', tranOp: true, uic: true, initJunctions: true });
    expect(c.state0[q.stateBase]).toBe(0.7);
    expect(c.state0[q.stateBase + 1]).toBeCloseTo(-2.3, 15);
  });

  it('initJunctions starts at vcrit (OFF: 0) and limiting raises noncon', () => {
    const c = new TestCircuit().model(qmodel({ is: 1e-16 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', '0'], model: 'QM' }) as Bjt;
    const off = c.element(createBjt, { type: 'Q', name: 'Q2', nodes: ['c2', 'b2', '0'], model: 'QM', params: { off: 1 } }) as Bjt;
    c.setup();
    const x = new Float64Array(c.size);
    c.assemble(x, { initJunctions: true });
    expect(c.state0[q.stateBase]).toBeCloseTo(VT * Math.log(VT / (Math.SQRT2 * 1e-16)), 12);
    expect(c.state0[off.stateBase]).toBe(0);
    x[c.node('b')] = 2;
    expect(c.assemble(x, {}, [q]).noncon).toBe(true);
  });

  it('convTest accepts the settled point and rejects a 10 mV base step', () => {
    const c = new TestCircuit().model(qmodel({ is: 1e-15, bf: 100 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', '0'], model: 'QM' });
    c.setup();
    const x = new Float64Array(c.size);
    x[c.node('b')] = 0.7;
    x[c.node('c')] = 3;
    c.settle(q, x);
    expect(c.convTests(x)).toBe(true);
    const y = Float64Array.from(x);
    y[c.node('b')] = 0.71;
    expect(c.convTests(y)).toBe(false);
  });

  it('noise generators: thermal RB/RC/RE, shot 2q|Ic| and 2q|Ib|, flicker KF*Ib^AF/f', () => {
    const p = { is: 1e-15, bf: 100, rb: 100, rc: 5, re: 2, kf: 1e-15, af: 1.1 };
    const { c, q } = fourTerminal(p);
    const x = biasVector(c, 0.7, -3);
    const gens = c.noise(x);
    const by = Object.fromEntries(gens.map((g) => [g.name, g]));
    const kT4 = 4 * BOLTZ * T27;
    expect(by.thermal_rc.density(1e3)).toBeCloseTo(kT4 / 5, 28);
    expect(by.thermal_re.density(1e3)).toBeCloseTo(kT4 / 2, 28);
    expect(by.thermal_rb.density(1e3)).toBeCloseTo(kT4 / 100, 28);
    const e = q.evaluateAt(0.7, -3, T27);
    const ic = e.it - e.ibc;
    const ib = e.ibe + e.ibc;
    expect(by.shot_ic.density(10) / (2 * CHARGE * ic)).toBeCloseTo(1, 10);
    expect(by.shot_ib.density(10) / (2 * CHARGE * ib)).toBeCloseTo(1, 10);
    expect(by.flicker.density(50) / ((1e-15 * Math.pow(ib, 1.1)) / 50)).toBeCloseTo(1, 10);
    expect(by.shot_ic.pos).toBe(c.node('Q1#c'));
    expect(by.shot_ic.neg).toBe(c.node('Q1#e'));
  });

  it('internal nodes exist only for non-zero RB/RC/RE; Isub only for 4-terminal devices', () => {
    const c = new TestCircuit().model(qmodel({ rb: 10 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e'], model: 'QM' });
    c.setup();
    expect(c.hasNode('Q1#b')).toBe(true);
    expect(c.hasNode('Q1#c')).toBe(false);
    expect(c.hasNode('Q1#e')).toBe(false);
    expect(Object.keys(q.outputs!(() => 0)).sort()).toEqual(['Ib', 'Ic', 'Ie', 'P']);
    const { q: q4 } = fourTerminal({});
    expect(Object.keys(q4.outputs!(() => 0))).toContain('Isub');
  });

  it('truncate() queries terr only for charges that exist', () => {
    const c = new TestCircuit().model(qmodel({ cje: 1e-12, cjs: 1e-12 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e', 's'], model: 'QM' }) as Bjt;
    c.setup();
    expect(c.truncate(q, 1e-9, 4e-9)).toBe(4e-9);
    expect(c.terrCalls).toEqual([q.stateBase + 2, q.stateBase + 8]);
  });

  it('aliases, SPICE2 C2/C4, unknown-parameter warnings, setParam/getParam', () => {
    const c = new TestCircuit().model(qmodel({ is: 2e-16, va: 70, c2: 100, pe: 0.9, qco: 1, level: 1 }));
    const q = c.element(createBjt, { type: 'Q', name: 'Q1', nodes: ['c', 'b', 'e'], model: 'QM' });
    c.element(createBjt, { type: 'Q', name: 'Q2', nodes: ['c', 'b', 'e'], model: 'NONE' });
    c.setup();
    expect(q.getParam!('vaf')).toBe(70);
    expect(q.getParam!('VJE')).toBe(0.9);
    expect(q.getParam!('ise')).toBeCloseTo(2e-14, 25);
    expect(c.warnings.filter((w) => w.includes('qco'))).toHaveLength(1);
    expect(c.warnings.some((w) => w.includes("'NONE' not found"))).toBe(true);
    q.setParam!('bf', 250);
    expect(q.getParam!('bf')).toBe(250);
    q.setParam!('area', 2);
    expect(q.getParam!('area')).toBe(2);
  });
});
