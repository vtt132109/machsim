/**
 * End-to-end checks of the semiconductor models through the production engine
 * (src/sim/engine) and the default device registry, complementing the isolated harness tests.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../engine/run';
import { cap, model, netlist, res, vdc, vsrc } from '../../engine/testing';
import type { ElementIR } from '../../netlist';
import { findVector, type AnalysisResult } from '../../results';
import { K_OVER_Q, celsiusToKelvin } from './common';

const VT = K_OVER_Q * celsiusToKelvin(27);

const el = (type: ElementIR['type'], name: string, nodes: string[], modelName: string, params: Record<string, number> = {}): ElementIR => ({
  type,
  name,
  nodes,
  model: modelName,
  params,
});

function vec(r: AnalysisResult, name: string): Float64Array {
  const v = findVector(r, name);
  if (!v) throw new Error(`missing vector ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v.re;
}

/** Value of a transient vector at time t (linear interpolation). */
function at(r: AnalysisResult, name: string, t: number): number {
  const time = r.scale?.re;
  if (!time) throw new Error('transient result without a time scale');
  const v = vec(r, name);
  for (let k = 1; k < time.length; k++) {
    if (time[k] >= t) {
      const f = (t - time[k - 1]) / (time[k] - time[k - 1]);
      return v[k - 1] + f * (v[k] - v[k - 1]);
    }
  }
  return v[v.length - 1];
}

describe('semiconductor devices in the production engine', () => {
  it('OP: diode + resistor matches the exact diode equation and reports Id(D1)', () => {
    const [r] = runAnalyses(
      netlist([vdc('V1', 'in', '0', 5), res('R1', 'in', 'a', 1e3), el('D', 'D1', ['a', '0'], 'DM')], [{ type: 'op' }], {
        models: [model('DM', 'D', { is: 1e-14 })],
        options: { reltol: 1e-6 },
      }),
    );
    expect(r.error).toBeUndefined();
    const va = vec(r, 'V(a)')[0];
    const id = vec(r, 'Id(D1)')[0];
    expect(id / ((5 - va) / 1e3)).toBeCloseTo(1, 6);
    expect(va / (VT * Math.log(id / 1e-14 + 1))).toBeCloseTo(1, 5);
  });

  it('AC: common-emitter voltage gain equals -gm*RC with gm = Ic/Vt', () => {
    const n = netlist(
      [
        vsrc('VB', 'b', '0', { dc: 0.65, acMag: 1 }),
        vdc('VCC', 'vcc', '0', 12),
        res('RC', 'vcc', 'c', 4.7e3),
        el('Q', 'Q1', ['c', 'b', '0'], 'QN'),
      ],
      [{ type: 'op' }, { type: 'ac', sweep: 'lin', points: 2, fstart: 1e3, fstop: 2e3 }],
      { models: [model('QN', 'NPN', { is: 1e-15, bf: 100 })], options: { reltol: 1e-7 } },
    );
    const [op, ac] = runAnalyses(n);
    expect(op.error).toBeUndefined();
    expect(ac.error).toBeUndefined();
    const ic = vec(op, 'Ic(Q1)')[0];
    expect(ic).toBeGreaterThan(5e-5);
    const vc = findVector(ac, 'V(c)')!;
    expect(vc.re[0] / (-(ic / VT) * 4.7e3)).toBeCloseTo(1, 4);
    expect(Math.abs(vc.im?.[0] ?? 0)).toBeLessThan(1e-6 * Math.abs(vc.re[0]));
  });

  it('transient: half-wave rectifier with reservoir capacitor peaks one diode drop below the input', () => {
    const n = netlist(
      [
        vsrc('V1', 'in', '0', { dc: 0, tran: { type: 'SIN', args: [0, 5, 1e3] } }),
        el('D', 'D1', ['in', 'out'], 'DR'),
        res('RL', 'out', '0', 10e3),
        cap('CL', 'out', '0', 10e-6),
      ],
      [{ type: 'tran', tstep: 1e-5, tstop: 3e-3 }],
      { models: [model('DR', 'D', { is: 2.5e-9, n: 1.75, rs: 0.5, cjo: 5e-12, tt: 5e-9, bv: 100 })] },
    );
    const [r] = runAnalyses(n);
    expect(r.error).toBeUndefined();
    const out = vec(r, 'V(out)');
    const peak = Math.max(...out);
    expect(peak).toBeGreaterThan(4.3);
    expect(peak).toBeLessThan(4.75);
    // ripple: the capacitor holds the output between peaks (RC = 100 ms >> 1 ms period)
    expect(at(r, 'V(out)', 2.9e-3)).toBeGreaterThan(peak - 0.1);
  });

  it('transient: CMOS inverter switches a pulse and keeps KCL at the output node', () => {
    const mos = { kp: 6e-5, lambda: 0.02, gamma: 0.4, phi: 0.65, tox: 3e-8, cgso: 2e-10, cgdo: 2e-10, cj: 1e-4, is: 1e-14 };
    const geom = { w: 10e-6, l: 2e-6, ad: 1e-11, as: 1e-11 };
    const n = netlist(
      [
        vdc('VDD', 'vdd', '0', 5),
        vsrc('VIN', 'in', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 1e-6, 1e-8, 1e-8, 2e-6, 5e-6] } }),
        el('M', 'MN', ['out', 'in', '0', '0'], 'NM', geom),
        el('M', 'MP', ['out', 'in', 'vdd', 'vdd'], 'PM', geom),
        cap('CL', 'out', '0', 0.1e-12),
      ],
      [{ type: 'tran', tstep: 1e-8, tstop: 6e-6 }],
      {
        models: [model('NM', 'NMOS', { ...mos, vto: 0.8 }), model('PM', 'PMOS', { ...mos, vto: -0.8 })],
        saves: ['V(out)', 'Id(MN)'],
      },
    );
    const [r] = runAnalyses(n);
    expect(r.error).toBeUndefined();
    expect(at(r, 'V(out)', 0.5e-6)).toBeGreaterThan(4.99);
    expect(at(r, 'V(out)', 2.5e-6)).toBeLessThan(0.01);
    expect(at(r, 'V(out)', 4.5e-6)).toBeGreaterThan(4.99);
    // static: no current through the off transistor pair
    expect(Math.abs(at(r, 'Id(MN)', 4.5e-6))).toBeLessThan(1e-9);
  });

  it('OP: JFET self-bias and MESFET stage converge in the engine', () => {
    const n = netlist(
      [
        vdc('VDD', 'vdd', '0', 15),
        res('RD', 'vdd', 'd', 2200),
        res('RS', 's', '0', 470),
        res('RG', 'g', '0', 1e6),
        el('J', 'J1', ['d', 'g', 's'], 'JN'),
        res('RL', 'vdd', 'dz', 1000),
        vdc('VGZ', 'gz', '0', -0.5),
        el('Z', 'Z1', ['dz', 'gz', '0'], 'ZN'),
      ],
      [{ type: 'op' }],
      { models: [model('JN', 'NJF', { vto: -2, beta: 1e-3 }), model('ZN', 'NMF', { vto: -1.2, beta: 4e-3, alpha: 3 })], options: { reltol: 1e-7 } },
    );
    const [r] = runAnalyses(n);
    expect(r.error).toBeUndefined();
    const vs = vec(r, 'V(s)')[0];
    const id = vec(r, 'Id(J1)')[0];
    expect(id / (vs / 470)).toBeCloseTo(1, 5);
    expect(id / (1e-3 * (2 - vs) ** 2)).toBeCloseTo(1, 4);
    const idz = vec(r, 'Id(Z1)')[0];
    expect(idz / ((15 - vec(r, 'V(dz)')[0]) / 1000)).toBeCloseTo(1, 5);
  });
});
