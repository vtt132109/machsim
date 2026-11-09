import { describe, expect, it } from 'vitest';
import type { ElementIR } from '../../netlist';
import { SimulationError, findVector, type AnalysisResult } from '../../results';
import { Circuit } from '../../engine/circuit';
import { runAnalyses } from '../../engine/run';
import { cap, cccs, coupling, ind, interpolate, model, netlist, res, tline, vccs, vcvs, vdc, vsrc, vswitch, ccvs } from '../../engine/testing';
import { linearFactories } from './index';

function run(n: ReturnType<typeof netlist>): AnalysisResult {
  const [r] = runAnalyses(n);
  if (r.error) throw new Error(r.error);
  return r;
}

describe('factory table', () => {
  it('covers R C L K V I E F G H S W T and the lossy line O', () => {
    expect(Object.keys(linearFactories).sort()).toEqual(['C', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'O', 'R', 'S', 'T', 'V', 'W']);
  });

  it('validates node counts and values', () => {
    expect(() => linearFactories.R?.({ type: 'R', name: 'R1', nodes: ['a'], params: {}, value: 1 })).toThrow(/expected 2 nodes/);
    expect(() => linearFactories.C?.({ type: 'C', name: 'C1', nodes: ['a', 'b'], params: {} })).toThrow(/missing or invalid capacitance/);
    expect(() => linearFactories.E?.({ type: 'E', name: 'E1', nodes: ['a', 'b', 'c'], params: {}, value: 1 })).toThrow(/expected 4 nodes/);
    expect(() => linearFactories.R?.({ type: 'R', name: 'R1', nodes: ['a', 'b'], params: { m: 0 }, value: 1 })).toThrow(/multiplicity/);
  });
});

describe('resistor, capacitor, inductor parameters', () => {
  it('resistor multiplicity, zero-value replacement and parameter access', () => {
    const c = new Circuit(netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1e3, { m: 4 }), res('R0', 'a', 'b', 0), res('Rb', 'b', '0', 1)]));
    expect(c.warnings.some((w) => /R0: resistance 0 .* replaced/.test(w))).toBe(true);
    const r1 = c.findDevice('R1');
    expect(r1?.getParam?.('value')).toBe(1e3);
    expect(r1?.getParam?.('m')).toBe(4);
    r1?.setParam?.('resistance', 2e3);
    expect(r1?.getParam?.('r')).toBe(2e3);
    const r = run(netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1e3, { m: 4 })], [{ type: 'op' }]));
    expect(r.scalars?.['I(R1)']).toBeCloseTo(4e-3, 15);
    // instance temperature overrides the circuit temperature
    const t = run(netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 100, { tc1: 0.01, temp: 127 })], [{ type: 'op' }]));
    expect(t.scalars?.['I(R1)']).toBeCloseTo(1 / 200, 14);
  });

  it('capacitor current output in transient and parallel copies', () => {
    const r = run(
      netlist([vdc('V1', 'in', '0', 1), res('R1', 'in', 'a', 1e3), cap('C1', 'a', '0', 0.5e-6, { m: 2 })], [{ type: 'tran', tstep: 1e-5, tstop: 2e-3, uic: true }], {
        saves: ['V(a)', 'I(C1)', 'I(R1)'],
      }),
    );
    const t = r.scale?.re as Float64Array;
    const ic = findVector(r, 'I(C1)')?.re as Float64Array;
    const ir = findVector(r, 'I(R1)')?.re as Float64Array;
    for (let k = 1; k < t.length; k++) expect(Math.abs(ic[k] - ir[k])).toBeLessThan(1e-9);
    const v = interpolate(t, findVector(r, 'V(a)')?.re as Float64Array, 1e-3);
    expect(Math.abs(v - (1 - Math.exp(-1))) / (1 - Math.exp(-1))).toBeLessThan(1e-3);
    const c = new Circuit(netlist([cap('C1', 'a', '0', 1e-6, { ic: 2 })]));
    const d = c.findDevice('C1');
    expect(d?.getParam?.('ic')).toBe(2);
    d?.setParam?.('value', 2e-6);
    expect(d?.getParam?.('capacitance')).toBe(2e-6);
  });

  it('capacitor ic= shows in the t = 0 point of a UIC run, also behind a .ic node and in a chain', () => {
    // C1 a-0 ic=2 discharging through R1: V(a)(0) = 2, then 2·exp(-t/RC)
    const r = run(netlist([cap('C1', 'a', '0', 1e-6, { ic: 2 }), res('R1', 'a', '0', 1e3)], [{ type: 'tran', tstep: 1e-5, tstop: 2e-3, uic: true }]));
    const t = r.scale?.re as Float64Array;
    const v = findVector(r, 'V(a)')?.re as Float64Array;
    expect(t[0]).toBe(0);
    expect(v[0]).toBe(2);
    expect(Math.abs(interpolate(t, v, 1e-3) - 2 * Math.exp(-1))).toBeLessThan(2e-3);
    // C2 between b and c with c fixed by .ic, then C3 stacked on b: V(b) = 3 + 1, V(d) = 4 - 0.5
    const n = netlist(
      [cap('C2', 'b', 'c', 1e-6, { ic: 1 }), cap('C3', 'b', 'd', 1e-6, { ic: 0.5 }), res('Rb', 'b', '0', 1e6), res('Rc', 'c', '0', 1e6), res('Rd', 'd', '0', 1e6)],
      [{ type: 'tran', tstep: 1e-6, tstop: 1e-5, uic: true }],
      { ic: { c: 3 } },
    );
    const chain = run(n);
    expect(findVector(chain, 'V(c)')?.re[0]).toBe(3);
    expect(findVector(chain, 'V(b)')?.re[0]).toBe(4);
    expect(findVector(chain, 'V(d)')?.re[0]).toBe(3.5);
  });

  it('setParam rejects names a device cannot change at run time', () => {
    const c = new Circuit(
      netlist([vdc('V1', 'a', '0', 1), vsrc('V2', 'b', '0', { dc: 1 }), res('R1', 'a', 'b', 1e3), cap('C1', 'a', '0', 1e-6), ind('L1', 'b', '0', 1e-3), vcvs('E1', 'c', '0', 'a', '0', 2)]),
    );
    for (const [dev, p] of [
      ['R1', 'resistnce'],
      ['C1', 'no_such_param'],
      ['L1', 'ohms'],
      ['E1', 'offset'],
      ['V1', 'freq'], // a waveform parameter on a source without a waveform
      ['V2', 'ampl'],
    ] as const) {
      const d = c.findDevice(dev)!;
      let err: unknown;
      try {
        d.setParam?.(p, 1);
      } catch (e) {
        err = e;
      }
      expect(err, `${dev}.${p}`).toBeInstanceOf(SimulationError);
      expect((err as SimulationError).code).toBe('unsupported');
      expect((err as Error).message).toBe(`${dev}: parameter '${p}' cannot be changed at run time`);
    }
    // known names still work
    c.findDevice('E1')!.setParam!('gain', 3);
    expect(c.findDevice('E1')!.getParam!('value')).toBe(3);
  });

  it('inductor initial current decays through a resistor (UIC)', () => {
    const L = 10e-3;
    const R = 20;
    const r = run(netlist([ind('L1', 'a', '0', L, { ic: 0.1 }), res('R1', 'a', '0', R)], [{ type: 'tran', tstep: 5e-6, tstop: 2e-3, uic: true }]));
    const t = r.scale?.re as Float64Array;
    const i = findVector(r, 'I(L1)')?.re as Float64Array;
    expect(i[0]).toBe(0.1);
    for (const tt of [0.25e-3, 0.5e-3, 1e-3, 2e-3]) {
      const ref = 0.1 * Math.exp((-tt * R) / L);
      expect(Math.abs(interpolate(t, i, tt) - ref) / ref).toBeLessThan(1e-3);
    }
    // v(a) = -i*R (the inductor current flows a -> 0 through L, so back through R)
    const v = findVector(r, 'V(a)')?.re as Float64Array;
    expect(v[v.length - 1]).toBeCloseTo(-i[i.length - 1] * R, 9);
  });
});

describe('mutual inductance', () => {
  it('couples three windings with a common k', () => {
    const [L1, L2, L3, k] = [1e-3, 4e-3, 9e-3, 0.95];
    const r = run(
      netlist(
        [
          vsrc('V1', 'v', '0', { acMag: 1 }),
          res('Rp', 'v', 'p', 1e-3),
          ind('L1', 'p', '0', L1),
          ind('L2', 's2', '0', L2),
          ind('L3', 's3', '0', L3),
          coupling('K1', ['L1', 'L2', 'L3'], k),
          res('R2', 's2', '0', 1e12),
          res('R3', 's3', '0', 1e12),
        ],
        [{ type: 'acsingle', freq: 1e3 }],
      ),
    );
    const mag = (name: string) => Math.hypot(findVector(r, name)!.re[0], findVector(r, name)!.im![0]);
    expect(mag('V(s2)') / mag('V(p)')).toBeCloseTo(k * Math.sqrt(L2 / L1), 6);
    expect(mag('V(s3)') / mag('V(p)')).toBeCloseTo(k * Math.sqrt(L3 / L1), 6);
  });

  it('transfers energy in transient: secondary voltage follows n·dΦ/dt', () => {
    const [L1, L2, k] = [1e-3, 4e-3, 1];
    const f = 1e3;
    const r = run(
      netlist(
        [
          vsrc('V1', 'v', '0', { tran: { type: 'SIN', args: [0, 1, f] } }),
          res('Rp', 'v', 'p', 1e-3),
          ind('L1', 'p', '0', L1),
          ind('L2', 's', '0', L2),
          coupling('K1', ['L1', 'L2'], k),
          res('RL', 's', '0', 1e9),
        ],
        [{ type: 'tran', tstep: 1e-6, tstop: 3e-3 }],
      ),
    );
    const t = r.scale?.re as Float64Array;
    const vs = findVector(r, 'V(s)')?.re as Float64Array;
    const vp = findVector(r, 'V(p)')?.re as Float64Array;
    for (const tt of [1.25e-3, 2.1e-3, 2.75e-3]) {
      expect(Math.abs(interpolate(t, vs, tt) - 2 * interpolate(t, vp, tt))).toBeLessThan(2e-3);
    }
  });

  it('rejects bad couplings', () => {
    expect(() => new Circuit(netlist([ind('L1', 'a', '0', 1e-3), res('R1', 'a', '0', 1), coupling('K1', ['L1', 'R1'], 0.5)]))).toThrow(/'R1' is not an inductor/);
    expect(() => new Circuit(netlist([ind('L1', 'a', '0', 1e-3), coupling('K1', ['L1'], 0.5)]))).toThrow(/at least two inductors/);
    expect(() => new Circuit(netlist([ind('L1', 'a', '0', 1e-3), ind('L2', 'b', '0', 1e-3), coupling('K1', ['L1', 'L2'], 1.5)]))).toThrow(/within \[-1, 1\]/);
    const c = new Circuit(netlist([ind('L1', 'a', '0', 1e-3), ind('L2', 'b', '0', 4e-3), coupling('K1', ['L1', 'L2'], 0.5)]));
    c.findDevice('K1')?.setParam?.('k', 0.25);
    expect(c.findDevice('K1')?.getParam?.('value')).toBe(0.25);
  });
});

describe('sources and controlled sources', () => {
  it('reads and writes source parameters by name', () => {
    const c = new Circuit(
      netlist([vsrc('V1', 'a', '0', { dc: 1, acMag: 2, acPhase: 10, tran: { type: 'SIN', args: [0, 1, 50, 0, 0, 30] } }), res('R1', 'a', '0', 1)]),
    );
    const v = c.findDevice('V1');
    expect(v?.getParam?.('dc')).toBe(1);
    expect(v?.getParam?.('acmag')).toBe(2);
    expect(v?.getParam?.('acphase')).toBe(10);
    expect(v?.getParam?.('phase')).toBe(30); // waveform phase, not AC phase
    expect(v?.getParam?.('offset')).toBe(0);
    v?.setParam?.('freq', 60);
    v?.setParam?.('offset', 0.5);
    expect(v?.getParam?.('freq')).toBe(60);
    expect(v?.getParam?.('vo')).toBe(0.5);
    v?.setParam?.('acmag', 3);
    expect(v?.getParam?.('ac')).toBe(3);
  });

  it('uses the waveform value at t = 0 for the operating point when no DC value is given', () => {
    const r = run(netlist([vsrc('V1', 'a', '0', { tran: { type: 'PULSE', args: [2, 5, 1e-3] } }), res('R1', 'a', '0', 1)], [{ type: 'op' }]));
    expect(r.scalars?.['V(a)']).toBe(2);
  });

  it('EXP and SFFM sources follow their definitions in transient', () => {
    const r = run(
      netlist(
        [
          vsrc('V1', 'a', '0', { tran: { type: 'EXP', args: [0, 1, 1e-4, 1e-4, 5e-4, 2e-4] } }),
          res('R1', 'a', '0', 1),
          vsrc('V2', 'b', '0', { tran: { type: 'SFFM', args: [0, 1, 5e3, 2, 500] } }),
          res('R2', 'b', '0', 1),
        ],
        [{ type: 'tran', tstep: 1e-6, tstop: 1e-3 }],
      ),
    );
    const t = r.scale?.re as Float64Array;
    const a = findVector(r, 'V(a)')?.re as Float64Array;
    const b = findVector(r, 'V(b)')?.re as Float64Array;
    for (let k = 0; k < t.length; k += 37) {
      const tt = t[k];
      let ea = tt < 1e-4 ? 0 : 1 - Math.exp(-(tt - 1e-4) / 1e-4);
      if (tt >= 5e-4) ea -= 1 - Math.exp(-(tt - 5e-4) / 2e-4);
      expect(a[k]).toBeCloseTo(ea, 9);
      expect(b[k]).toBeCloseTo(Math.sin(2 * Math.PI * 5e3 * tt + 2 * Math.sin(2 * Math.PI * 500 * tt)), 9);
    }
  });

  it('controlled-source gains can be changed', () => {
    const els: ElementIR[] = [
      vdc('V1', 'in', '0', 1),
      res('Ri', 'in', '0', 1),
      vcvs('E1', 'e', '0', 'in', '0', 2),
      res('Re', 'e', '0', 1),
      vccs('G1', 'g', '0', 'in', '0', 1),
      res('Rg', 'g', '0', 1),
      cccs('F1', 'f', '0', 'V1', 1),
      res('Rf', 'f', '0', 1),
      ccvs('H1', 'h', '0', 'V1', 1),
      res('Rh', 'h', '0', 1),
    ];
    const c = new Circuit(netlist(els));
    for (const name of ['E1', 'G1', 'F1', 'H1']) {
      const d = c.findDevice(name);
      d?.setParam?.('value', 7);
      expect(d?.getParam?.('gain')).toBe(7);
    }
    const r = run(netlist(els, [{ type: 'op' }]));
    // I(V1) = -1 A: F pushes -1 A from f to ground -> v(f) = +1; H: v(h) = 1 * (-1)
    expect(r.scalars?.['V(f)']).toBeCloseTo(1, 12);
    expect(r.scalars?.['V(h)']).toBeCloseTo(-1, 12);
    expect(r.scalars?.['V(e)']).toBeCloseTo(2, 12);
    expect(r.scalars?.['V(g)']).toBeCloseTo(-1, 12);
  });
});

describe('switch models', () => {
  it('accepts PSpice-style von/voff and instance overrides', () => {
    const base = (m: ReturnType<typeof model>, params: Record<string, number> = {}) =>
      netlist(
        [vdc('Vc', 'c', '0', 1.2), vdc('V1', 'in', '0', 1), res('R1', 'in', 'o', 1e3), vswitch('S1', 'o', '0', 'c', '0', m.name, params)],
        [{ type: 'op' }],
        { models: [m] },
      );
    // threshold midway between von = 2 and voff = 0 -> 1 V: closed at 1.2 V
    const on = run(base(model('vs', 'VSWITCH', { von: 2, voff: 0, ron: 1, roff: 1e9 })));
    expect(on.scalars?.['V(o)']).toBeCloseTo(1 / 1001, 9);
    // instance vt overrides the model threshold: open at 1.2 V
    const off = run(base(model('vs', 'SW', { vt: 1, ron: 1, roff: 1e9 }), { vt: 1.5 }));
    expect(off.scalars?.['V(o)']).toBeCloseTo(1e9 / (1e9 + 1e3), 9);
    // initial state "on" inside the hysteresis window
    const held = run(base(model('vs', 'SW', { vt: 1, vh: 0.5, ron: 1, roff: 1e9 }), { on: 1 }));
    expect(held.scalars?.['V(o)']).toBeCloseTo(1 / 1001, 9);
    const heldOff = run(base(model('vs', 'SW', { vt: 1, vh: 0.5, ron: 1, roff: 1e9 })));
    expect(heldOff.scalars?.['V(o)']).toBeCloseTo(1e9 / (1e9 + 1e3), 9);
  });

  it('reports a missing switch model', () => {
    const [r] = runAnalyses(netlist([vdc('Vc', 'c', '0', 1), res('R1', 'c', 'o', 1), vswitch('S1', 'o', '0', 'c', '0', 'nomodel')], [{ type: 'op' }]));
    expect(r.error).toMatch(/S1: model 'nomodel' not found/);
  });
});

describe('transmission line parameters', () => {
  it('derives td from f and nl and validates z0', () => {
    const c = new Circuit(netlist([tline('T1', 'a', '0', 'b', '0', { z0: 75, f: 1e6, nl: 0.5 }), res('R1', 'a', '0', 75), res('R2', 'b', '0', 75)]));
    expect(c.findDevice('T1')?.getParam?.('td')).toBeCloseTo(5e-7, 18);
    expect(c.findDevice('T1')?.getParam?.('z0')).toBe(75);
    expect(() => new Circuit(netlist([tline('T1', 'a', '0', 'b', '0', { td: 1e-9 })]))).toThrow(SimulationError);
    expect(() => new Circuit(netlist([tline('T1', 'a', '0', 'b', '0', { z0: 50 })]))).toThrow(/delay td/);
  });

  it('is transparent (v1 = v2, i1 = -i2) at DC', () => {
    const r = run(
      netlist([vdc('V1', 's', '0', 3), res('Rs', 's', 'in', 25), tline('T1', 'in', '0', 'out', '0', { z0: 50, td: 1e-9 }), res('RL', 'out', '0', 75)], [{ type: 'op' }]),
    );
    expect(r.scalars?.['V(out)']).toBeCloseTo(3 * (75 / 100), 12);
    expect(r.scalars?.['V(in)']).toBeCloseTo(r.scalars?.['V(out)'] ?? Number.NaN, 12);
    expect(r.scalars?.['I1(T1)']).toBeCloseTo(-(r.scalars?.['I2(T1)'] ?? Number.NaN), 15);
  });
});
