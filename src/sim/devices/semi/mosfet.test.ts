import { describe, expect, it } from 'vitest';
import { BOLTZ, CHARGE, EPS0, EPS_OX } from '../../device';
import type { ModelCard } from '../../netlist';
import { K_OVER_Q, celsiusToKelvin } from './common';
import { Mosfet, createMosfet, meyerCaps, emptyCore } from './mosfet';
import { TestCircuit } from './test-harness';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;

function mmodel(params: Record<string, number>, type: 'NMOS' | 'PMOS' = 'NMOS', name = 'MM'): ModelCard {
  return { name, type, params };
}

const GEOM = { w: 10e-6, l: 2e-6 };

/** MOSFET with ideal sources on gate, drain and bulk (source grounded); outputs at the exact bias. */
function biasMos(
  params: Record<string, number>,
  vgs: number,
  vds: number,
  vbs = 0,
  type: 'NMOS' | 'PMOS' = 'NMOS',
  inst: Record<string, number> = GEOM,
  opts: { tempC?: number } = {},
) {
  const c = new TestCircuit({ gmin: 0, temp: opts.tempC ?? 27 }).model(mmodel(params, type));
  const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', 'b'], model: 'MM', params: inst }) as Mosfet;
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

describe('MOSFET level 1 static I-V', () => {
  const P = { vto: 0.8, kp: 1e-4, lambda: 0.02, gamma: 0.5, phi: 0.65, is: 0 };
  const beta = (1e-4 * 10e-6) / 2e-6;

  it('cutoff: no channel current below threshold', () => {
    expect(biasMos(P, 0.5, 2).out.Id).toBe(0);
  });

  it('saturation: Id = BETA/2 (1 + LAMBDA Vds) (Vgs - VTO)^2', () => {
    const { out } = biasMos(P, 2, 3);
    expect(out.Id / ((beta / 2) * 1.06 * 1.2 * 1.2)).toBeCloseTo(1, 12);
    expect(out.Is).toBeCloseTo(-out.Id, 18);
    expect(out.Ig).toBe(0);
    expect(out.P).toBeCloseTo(out.Id * 3, 15);
  });

  it('linear region: Id = BETA (1 + LAMBDA Vds) Vds (Vgst - Vds/2)', () => {
    const { out } = biasMos(P, 3, 0.5);
    expect(out.Id / (beta * 1.01 * 0.5 * (2.2 - 0.25))).toBeCloseTo(1, 12);
  });

  it('body effect: VT = VTO + GAMMA (sqrt(PHI - Vbs) - sqrt(PHI))', () => {
    const vbs = -2;
    const vth = 0.8 + 0.5 * (Math.sqrt(0.65 - vbs) - Math.sqrt(0.65));
    const { out } = biasMos(P, 2.5, 4, vbs);
    expect(out.Id / ((beta / 2) * 1.08 * (2.5 - vth) ** 2)).toBeCloseTo(1, 12);
    expect(out.Id).toBeLessThan(biasMos(P, 2.5, 4, 0).out.Id);
  });

  it('NMOS / PMOS symmetry: mirrored voltages give negated currents', () => {
    const pm = { ...P, vto: -0.8 };
    for (const [vgs, vds, vbs] of [
      [2, 3, 0],
      [3, 0.5, -1],
      [1.5, -0.7, 0],
    ]) {
      const n = biasMos(P, vgs, vds, vbs).out;
      const p = biasMos(pm, -vgs, -vds, -vbs, 'PMOS').out;
      expect(p.Id).toBeCloseTo(-n.Id, 16);
      expect(p.Ib).toBeCloseTo(-n.Ib, 20);
    }
  });

  it('drain/source interchange: swapping the d and s nodes swaps Id and Is', () => {
    const run = (nodes: string[]) => {
      const c = new TestCircuit({ gmin: 0 }).model(mmodel({ ...P, is: 1e-14, tox: 2e-8, cj: 1e-4 }));
      const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes, model: 'MM', params: { ...GEOM, ad: 2e-11, as: 2e-11 } });
      c.vsource('VG', 'g', '0', 2.2);
      c.vsource('VA', 'a', '0', 0.2);
      c.vsource('VB', 'b', '0', 1.4);
      const r = c.op();
      expect(r.converged).toBe(true);
      return m.outputs!((i) => (i < 0 ? 0 : r.x[i]));
    };
    const fwd = run(['b', 'g', 'a', '0']);
    const rev = run(['a', 'g', 'b', '0']);
    expect(rev.Is).toBeCloseTo(fwd.Id, 14);
    expect(rev.Id).toBeCloseTo(fwd.Is, 14);
    expect(fwd.Id).toBeGreaterThan(1e-5);
  });

  it('LD shortens the channel; KP = U0*Cox when TOX is given; M multiplies', () => {
    const ld = biasMos({ ...P, ld: 0.25e-6 }, 2, 3).out.Id;
    expect(ld / biasMos(P, 2, 3).out.Id).toBeCloseTo(2 / 1.5, 12);
    const cox = EPS_OX / 2e-8;
    const { m } = biasMos({ vto: 0.8, tox: 2e-8, u0: 450, is: 0 }, 2, 3);
    expect(m.derived(T27).beta / (450e-4 * cox * 5)).toBeCloseTo(1, 12);
    const x3 = biasMos(P, 2, 3, 0, 'NMOS', { ...GEOM, m: 3 }).out.Id;
    expect(x3 / biasMos(P, 2, 3).out.Id).toBeCloseTo(3, 12);
  });

  it('process parameters: PHI, GAMMA and VTO derived from NSUB/TOX/NSS/TPG', () => {
    const { m } = biasMos({ tox: 5e-8, nsub: 1e15, nss: 1e10, tpg: 1, is: 0 }, 0, 0);
    const d = m.derived(T27);
    const cox = EPS_OX / 5e-8;
    const phi = 2 * VT * Math.log(1e21 / 1.45e16);
    const gamma = Math.sqrt(2 * 11.7 * EPS0 * CHARGE * 1e21) / cox;
    const eg = 1.16 - (7.02e-4 * T27 * T27) / (T27 + 1108);
    const wkfngs = 3.25 + 0.5 * eg - 0.5 * eg - (3.25 + 0.5 * eg + 0.5 * phi);
    const vto = wkfngs - (1e10 * 1e4 * CHARGE) / cox + gamma * Math.sqrt(phi) + phi;
    expect(d.phi / phi).toBeCloseTo(1, 10);
    expect(d.gamma / gamma).toBeCloseTo(1, 12);
    expect(d.vto / vto).toBeCloseTo(1, 10);
  });

  it('temperature: KP scales as (T/Tnom)^-1.5 and the threshold moves with the band gap', () => {
    const { m } = biasMos(P, 2, 3);
    const hot = m.derived(celsiusToKelvin(100));
    expect(hot.beta / beta).toBeCloseTo(Math.pow(celsiusToKelvin(100) / T27, -1.5), 12);
    expect(hot.vto).toBeLessThan(0.8);
    expect(m.derived(T27).vto).toBeCloseTo(0.8, 12);
  });
});

describe('MOSFET level 3 static behaviour', () => {
  const inst = { w: 20e-6, l: 2e-6 };
  it('reduces to the level-1 square law when the short-channel terms vanish (GAMMA = 0)', () => {
    const base = { vto: 0.7, kp: 5e-5, is: 0, tox: 1e-7 };
    for (const [vgs, vds] of [
      [2, 3],
      [3, 0.4],
      [1.2, 0.2],
    ]) {
      const l1 = biasMos({ ...base, level: 1 }, vgs, vds, 0, 'NMOS', inst).out.Id;
      const l3 = biasMos({ ...base, level: 3 }, vgs, vds, 0, 'NMOS', inst).out.Id;
      expect(l3 / l1).toBeCloseTo(1, 12);
    }
  });

  it('saturation with body factor: Id = BETA vgst^2 / (2(1 + fb)), fb = GAMMA/(4 sqrt(PHI - Vbs))', () => {
    const p = { level: 3, vto: 0.7, kp: 5e-5, gamma: 0.6, phi: 0.7, is: 0, tox: 1e-7 };
    const vbs = -1;
    const beta = (5e-5 * 20e-6) / 2e-6;
    const vth = 0.7 + 0.6 * (Math.sqrt(0.7 - vbs) - Math.sqrt(0.7));
    const fb = 0.6 / (4 * Math.sqrt(0.7 - vbs));
    const id = biasMos(p, 2.5, 4, vbs, 'NMOS', inst).out.Id;
    expect(id / ((beta * (2.5 - vth) ** 2) / (2 * (1 + fb)))).toBeCloseTo(1, 12);
  });

  it('THETA reduces mobility, ETA lowers the threshold with Vds (DIBL), NFS gives weak inversion', () => {
    const p = { level: 3, vto: 0.7, kp: 5e-5, gamma: 0.4, phi: 0.7, is: 0, tox: 2e-8, nsub: 1e16 };
    const id0 = biasMos(p, 2.5, 3, 0, 'NMOS', inst).out.Id;
    expect(biasMos({ ...p, theta: 0.2 }, 2.5, 3, 0, 'NMOS', inst).out.Id).toBeLessThan(id0);
    const { m } = biasMos({ ...p, eta: 0.5 }, 2.5, 3, 0, 'NMOS', inst);
    const cox = EPS_OX / 2e-8;
    const sigma = (0.5 * 8.15e-22) / (cox * 2e-6 ** 3);
    const v0 = m.evaluateAt(2.5, 0.5, 0, T27).core.von;
    const v1 = m.evaluateAt(2.5, 2.5, 0, T27).core.von;
    expect((v0 - v1) / (2 * sigma)).toBeCloseTo(1, 10);
    // subthreshold: current decays by exp(dVgs/(n vt)) below von
    const w = biasMos({ ...p, nfs: 1e11 }, 0, 0, 0, 'NMOS', inst).m;
    const e1 = w.evaluateAt(0.3, 2, 0, T27);
    const e2 = w.evaluateAt(0.35, 2, 0, T27);
    expect(e1.core.von).toBeGreaterThan(0.4);
    expect(e1.cd).toBeGreaterThan(0);
    const n = (e1.core.von - (0.7 + 0)) / VT; // von = vth + n*vt at vbs = 0, vds-independent here
    expect(Math.log(e2.cd / e1.cd) / (0.05 / (n * VT))).toBeCloseTo(1, 6);
  });

  it('VMAX velocity saturation lowers vdsat and the saturation current', () => {
    const p = { level: 3, vto: 0.7, kp: 5e-5, gamma: 0.4, phi: 0.7, is: 0, tox: 2e-8, nsub: 1e16, kappa: 0.2 };
    const a = biasMos(p, 3, 4, 0, 'NMOS', { w: 20e-6, l: 1e-6 });
    const b = biasMos({ ...p, vmax: 1e5 }, 3, 4, 0, 'NMOS', { w: 20e-6, l: 1e-6 });
    expect(b.out.Id).toBeLessThan(a.out.Id);
    expect(b.m.evaluateAt(3, 4, 0, T27).core.vdsat).toBeLessThan(a.m.evaluateAt(3, 4, 0, T27).core.vdsat);
  });

  // level 2 is implemented since the engine round (mos2.ts); level 5 is still unknown
  it('warns and falls back to level 1 for unsupported levels', () => {
    const { c, out } = biasMos({ level: 5, vto: 0.8, kp: 1e-4, is: 0 }, 2, 3);
    expect(c.warnings.some((w) => w.includes('level 5 is not supported'))).toBe(true);
    expect(out.Id / ((((1e-4 * 10e-6) / 2e-6) / 2) * 1.44)).toBeCloseTo(1, 12);
  });
});

const FULL1 = {
  vto: 0.8,
  kp: 6e-5,
  gamma: 0.5,
  phi: 0.65,
  lambda: 0.03,
  rd: 15,
  rs: 10,
  is: 1e-14,
  pb: 0.8,
  cj: 2e-4,
  mj: 0.5,
  cjsw: 5e-10,
  mjsw: 0.33,
  cgso: 3e-10,
  cgdo: 3e-10,
  cgbo: 2e-10,
  tox: 3e-8,
  fc: 0.5,
};
const FULL3 = {
  ...FULL1,
  level: 3,
  lambda: 0,
  nsub: 1e16,
  theta: 0.1,
  eta: 0.05,
  kappa: 0.3,
  vmax: 1.5e5,
  xj: 0.3e-6,
  ld: 0.05e-6,
  delta: 0.5,
  nfs: 1e11,
};
const INST = { w: 20e-6, l: 2e-6, ad: 4e-11, as: 4e-11, pd: 30e-6, ps: 30e-6 };

/** (vgs, vds, vbs) device-polarity internal biases covering the regions (incl. Meyer regions). */
const BIASES: Array<[string, number, number, number]> = [
  ['saturation', 2, 3, -1],
  ['linear', 3, 0.4, -0.5],
  ['accumulation (Meyer Cgb = Cox)', -1, 2, -1],
  ['depletion (Meyer region 2)', 0.55, 1, -1],
  ['weak inversion edge (Meyer region 3, vds > 25 mV)', 0.9, 1, -1],
  ['Meyer region 3 below 25 mV', 0.9, 0.01, -1],
  ['reverse linear', 2.5, -0.5, -1],
  ['reverse saturation', -0.5, -3, -4],
  ['forward body bias', 2, 1, 0.3],
];

function mosCircuit(params: Record<string, number>, type: 'NMOS' | 'PMOS' = 'NMOS') {
  const c = new TestCircuit().model(mmodel(params, type));
  const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes: ['d', 'g', 's', 'b'], model: 'MM', params: INST }) as Mosfet;
  c.setup();
  return { c, m };
}

function mosVector(c: TestCircuit, vgs: number, vds: number, vbs: number, pol = 1): Float64Array {
  const x = new Float64Array(c.size);
  const vsi = 0.02;
  const set = (n: string, v: number) => {
    if (c.hasNode(n)) x[c.node(n)] = pol * v;
  };
  set('M1#s', vsi);
  set('M1#d', vsi + vds);
  set('g', vsi + vgs);
  set('b', vsi + vbs);
  set('s', vsi - 0.002);
  set('d', vsi + vds + 0.003);
  return x;
}

describe('MOSFET Jacobian vs finite differences', () => {
  const variants: Array<[string, Record<string, number>, 'NMOS' | 'PMOS']> = [
    ['level 1 NMOS', FULL1, 'NMOS'],
    ['level 1 PMOS', { ...FULL1, vto: -0.8 }, 'PMOS'],
    ['level 3 NMOS', FULL3, 'NMOS'],
    ['level 3 NMOS without VMAX/NFS', { ...FULL3, vmax: 0, nfs: 0 }, 'NMOS'],
    ['level 3 PMOS', { ...FULL3, vto: -0.8 }, 'PMOS'],
  ];
  for (const [label, params, type] of variants) {
    it.each(BIASES)(`${label} DC: %s`, (_r, vgs, vds, vbs) => {
      const { c, m } = mosCircuit(params, type);
      const r = c.jacobianError(m, mosVector(c, vgs, vds, vbs, type === 'PMOS' ? -1 : 1), { mode: 'op' });
      expect(r.maxRel).toBeLessThan(1e-4);
    });
  }
  for (const [label, params] of [
    ['level 1', FULL1],
    ['level 3', FULL3],
  ] as const) {
    it.each(BIASES)(`${label} transient companion incl. Meyer dC/dv terms (BE, trap): %s`, (_r, vgs, vds, vbs) => {
      for (const method of ['be', 'trap'] as const) {
        const { c, m } = mosCircuit(params);
        const x = mosVector(c, vgs, vds, vbs);
        // history at a different bias so (v - v1) != 0 and the averaged Meyer caps differ
        c.assemble(
          x.map((y) => y * 0.97),
          { mode: 'op', tranOp: true },
        );
        c.state1.set(c.state0);
        c.state2.set(c.state0);
        const r = c.jacobianError(m, x, { mode: 'tran', dt: 1e-10, method, time: 1e-10 });
        expect(r.maxRel).toBeLessThan(1e-4);
      }
    });
  }
});

describe('MOSFET capacitances', () => {
  const cox = (EPS_OX / 3e-8) * 20e-6 * 2e-6;

  it('Meyer: Cgb = Cox in accumulation, Cgs = 2/3 Cox in saturation, Cgs = Cgd = Cox/2 at Vds = 0', () => {
    const { m } = mosCircuit(FULL1);
    const acc = m.evaluateAt(-2, 1, 0, T27).meyer;
    expect(acc.cgb / cox).toBeCloseTo(1, 12);
    expect(acc.cgs).toBe(0);
    const sat = m.evaluateAt(3, 4, 0, T27).meyer;
    expect(sat.cgs / cox).toBeCloseTo(2 / 3, 12);
    expect(sat.cgd).toBe(0);
    const lin = m.evaluateAt(3, 0, 0, T27).meyer;
    expect(lin.cgs / cox).toBeCloseTo(0.5, 12);
    expect(lin.cgd / cox).toBeCloseTo(0.5, 12);
  });

  it('Meyer capacitances are continuous across the region boundaries', () => {
    const core = emptyCore();
    const out = { cgs: 0, cgd: 0, cgb: 0, dcgs: [0, 0, 0] as [number, number, number], dcgd: [0, 0, 0] as [number, number, number], dcgb: [0, 0, 0] as [number, number, number] };
    const phi = 0.7;
    const at = (u: number, vds: number) => {
      core.von = 1;
      core.vdsat = Math.max(u, 0);
      core.dvdsatDvgs = u > 0 ? 1 : 0;
      const r = meyerCaps(1 + u, vds, core, phi, 1, out);
      return [r.cgs, r.cgd, r.cgb];
    };
    for (const u of [-phi, -phi / 2, 0]) {
      const lo = at(u - 1e-9, 0.3);
      const hi = at(u + 1e-9, 0.3);
      for (let k = 0; k < 3; k++) expect(Math.abs(lo[k] - hi[k])).toBeLessThan(1e-8);
    }
    // linear/saturation boundary vds = vdsat
    const a = at(0.5, 0.5 - 1e-9);
    const b = at(0.5, 0.5 + 1e-9);
    for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-8);
  });

  it('bulk junctions: CJ*AD (MJ) + CJSW*PD (MJSW) depletion capacitance', () => {
    const { m } = mosCircuit(FULL1);
    const vbd = -2;
    const e = m.evaluateAt(2, 2, 0, T27);
    const expected = (2e-4 * 4e-11) / Math.pow(1 - vbd / 0.8, 0.5) + (5e-10 * 30e-6) / Math.pow(1 - vbd / 0.8, 0.33);
    expect(e.capbd / expected).toBeCloseTo(1, 12);
    expect(e.capbs / (2e-4 * 4e-11 + 5e-10 * 30e-6)).toBeCloseTo(1, 12);
  });

  it('integrate() is called for qgs, qgd, qgb, qbd, qbs with the averaged Meyer + overlap capacitance', () => {
    const { c, m } = mosCircuit(FULL1);
    const x = mosVector(c, 3, 4, 0);
    c.settle(m, x, { mode: 'op', tranOp: true });
    c.state1.set(c.state0);
    c.state2.set(c.state0);
    const flags = { mode: 'tran' as const, dt: 1e-9, time: 1e-9 };
    c.settle(m, x, flags);
    c.integrateCalls.length = 0;
    c.assemble(x, flags);
    expect(c.integrateCalls.map((k) => k.q - m.stateBase)).toEqual([6, 8, 10, 12, 14]);
    const e = m.evaluateAt(3, 4, 0, T27);
    const d = m.derived(T27);
    expect(c.integrateCalls[0].cap / (e.meyer.cgs + d.cgso)).toBeCloseTo(1, 12);
    expect(c.integrateCalls[1].cap / (e.meyer.cgd + d.cgdo)).toBeCloseTo(1, 12);
    expect(c.integrateCalls[3].cap / e.capbd).toBeCloseTo(1, 12);
    // tranOp stores q = v*C for the gate charges
    expect(c.integrateCalls[0].charge / (3 * (e.meyer.cgs + d.cgso))).toBeCloseTo(1, 12);
  });
});

describe('MOSFET AC consistency', () => {
  for (const [label, params] of [
    ['level 1', FULL1],
    ['level 3', FULL3],
  ] as const) {
    it(`${label}: AC admittance equals the DC Jacobian plus j*omega*C at the operating point`, () => {
      for (const [, vgs, vds, vbs] of BIASES) {
        const { c, m } = mosCircuit(params);
        const x = mosVector(c, vgs, vds, vbs);
        c.settle(m, x, { mode: 'op', tranOp: true });
        const gdc = c.assemble(x, { mode: 'op', tranOp: true }).G;
        c.state1.set(c.state0);
        c.state2.set(c.state0);
        const dt = 1e-6;
        c.settle(m, x, { mode: 'tran', dt, time: dt });
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
  }
});

describe('MOSFET Newton convergence', () => {
  function inverter(vin: number) {
    const c = new TestCircuit({ reltol: 1e-9 })
      .model(mmodel({ vto: 0.8, kp: 6e-5, lambda: 0.02, gamma: 0.4, phi: 0.65, tox: 3e-8, cj: 1e-4 }, 'NMOS', 'NM'))
      .model(mmodel({ vto: -0.8, kp: 6e-5, lambda: 0.02, gamma: 0.4, phi: 0.65, tox: 3e-8, cj: 1e-4 }, 'PMOS', 'PM'));
    const mn = c.element(createMosfet, { type: 'M', name: 'MN', nodes: ['out', 'in', '0', '0'], model: 'NM', params: { w: 10e-6, l: 2e-6, ad: 1e-11, as: 1e-11 } });
    const mp = c.element(createMosfet, { type: 'M', name: 'MP', nodes: ['out', 'in', 'vdd', 'vdd'], model: 'PM', params: { w: 10e-6, l: 2e-6, ad: 1e-11, as: 1e-11 } });
    c.vsource('VDD', 'vdd', '0', 5);
    c.vsource('VIN', 'in', '0', vin);
    const r = c.op();
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(80);
    const read = (i: number) => (i < 0 ? 0 : r.x[i]);
    return { vout: c.v('out'), idn: mn.outputs!(read).Id, idp: mp.outputs!(read).Id };
  }

  it('CMOS inverter: rails at the logic levels and the symmetric midpoint at Vin = VDD/2', () => {
    expect(inverter(0).vout).toBeGreaterThan(4.999);
    expect(inverter(5).vout).toBeLessThan(1e-3);
    const mid = inverter(2.5);
    expect(mid.vout).toBeCloseTo(2.5, 6);
    // KCL at the output: the NMOS sinks what the PMOS sources
    expect(mid.idn).toBeGreaterThan(1e-5);
    expect((mid.idn + mid.idp) / mid.idn).toBeLessThan(1e-7);
  });

  it('level-3 common-source stage with drain resistor converges from 0 V and satisfies KCL', () => {
    const c = new TestCircuit({ reltol: 1e-9 }).model(mmodel(FULL3));
    const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'MM', params: INST });
    c.vsource('VDD', 'vdd', '0', 10);
    c.vsource('VG', 'g', '0', 2);
    c.resistor('RD', 'vdd', 'd', 5000);
    const r = c.op();
    expect(r.converged).toBe(true);
    const out = m.outputs!((i) => (i < 0 ? 0 : r.x[i]));
    expect(out.Id / ((10 - c.v('d')) / 5000)).toBeCloseTo(1, 7);
    expect(out.Id).toBeGreaterThan(1e-5);
  });
});

describe('MOSFET initial conditions, noise, params', () => {
  it('initJunctions: vbs = -1, vgs = VTO, vds = 0 (OFF: zeros); UIC uses ic_*', () => {
    const c = new TestCircuit().model(mmodel({ vto: 0.9, tox: 3e-8 }));
    const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes: ['d', 'g', 's', 'b'], model: 'MM' }) as Mosfet;
    const off = c.element(createMosfet, { type: 'M', name: 'M2', nodes: ['d', 'g', 's', 'b'], model: 'MM', params: { off: 1 } }) as Mosfet;
    const ic = c.element(createMosfet, {
      type: 'M',
      name: 'M3',
      nodes: ['d', 'g', 's', 'b'],
      model: 'MM',
      params: { ic_vds: 2, ic_vgs: 1.5, ic_vbs: -0.5 },
    }) as Mosfet;
    c.setup();
    c.assemble(new Float64Array(c.size), { initJunctions: true });
    const st = (d: Mosfet) => [c.state0[d.stateBase], c.state0[d.stateBase + 1], c.state0[d.stateBase + 2]];
    expect(st(m)[0]).toBe(-1);
    expect(st(m)[1]).toBeCloseTo(0.9, 12);
    expect(st(m)[2]).toBe(0);
    expect(st(off)).toEqual([0, 0, 0]);
    c.assemble(new Float64Array(c.size), { mode: 'tran', tranOp: true, uic: true, initJunctions: true });
    expect(st(ic)).toEqual([-0.5, 1.5, 2]);
  });

  it('noise: RD/RS thermal, channel 4kT*(2/3)gm, flicker KF*Id^AF/(f Leff^2 Cox)', () => {
    const { c, m } = mosCircuit({ ...FULL1, kf: 1e-26, af: 1.2 });
    const x = mosVector(c, 3, 4, 0);
    const by = Object.fromEntries(c.noise(x).map((g) => [g.name, g]));
    const kT4 = 4 * BOLTZ * T27;
    expect(by.thermal_rd.density(1)).toBeCloseTo(kT4 / 15, 28);
    expect(by.thermal_rs.density(1)).toBeCloseTo(kT4 / 10, 28);
    const e = m.evaluateAt(3, 4, 0, T27);
    expect(by.thermal_channel.density(1) / ((kT4 * 2 * e.gGs) / 3)).toBeCloseTo(1, 12);
    const coxA = EPS_OX / 3e-8;
    expect(by.flicker.density(10) / ((1e-26 * Math.pow(e.cd, 1.2)) / (10 * 2e-6 * 2e-6 * coxA))).toBeCloseTo(1, 10);
  });

  it('convTest, truncate, internal node naming, setParam/getParam', () => {
    const { c, m } = mosCircuit(FULL1);
    expect(c.hasNode('M1#d')).toBe(true);
    expect(c.hasNode('M1#s')).toBe(true);
    const x = mosVector(c, 2, 3, -1);
    c.settle(m, x);
    expect(c.convTests(x)).toBe(true);
    const y = Float64Array.from(x);
    y[c.node('g')] += 0.02;
    expect(c.convTests(y)).toBe(false);
    expect(c.truncate(m, 1e-9, 2e-9)).toBe(2e-9);
    expect(c.terrCalls.map((q) => q - m.stateBase)).toEqual([6, 8, 10, 12, 14]);
    expect(m.getParam('w')).toBe(20e-6);
    expect(m.getParam('kp')).toBe(6e-5);
    m.setParam('w', 40e-6);
    expect(m.derived(T27).beta / ((6e-5 * 40e-6) / 2e-6)).toBeCloseTo(1, 12);
    // defaults: W = L = 100 um (SPICE DEFW/DEFL), no internal nodes without RD/RS/RSH
    const pc = new TestCircuit().model(mmodel({ vto: 1 }, 'NMOS', 'PLAIN'));
    const plain = pc.element(createMosfet, { type: 'M', name: 'M9', nodes: ['d', 'g', 's', 'b'], model: 'PLAIN' });
    pc.setup();
    expect(plain.getParam!('l')).toBe(1e-4);
    expect(plain.getParam!('w')).toBe(1e-4);
    expect(pc.hasNode('M9#d')).toBe(false);
  });

  it('RSH*NRD/NRS gives the series resistances when RD/RS are absent', () => {
    const c = new TestCircuit().model(mmodel({ vto: 1, rsh: 20 }));
    const m = c.element(createMosfet, { type: 'M', name: 'M1', nodes: ['d', 'g', 's', 'b'], model: 'MM', params: { nrd: 2, nrs: 0.5 } }) as Mosfet;
    c.setup();
    expect(m.derived(T27).gd).toBeCloseTo(1 / 40, 15);
    expect(m.derived(T27).gs).toBeCloseTo(1 / 10, 15);
  });
});
