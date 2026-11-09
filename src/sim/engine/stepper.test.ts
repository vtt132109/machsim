import { describe, expect, it } from 'vitest';
import type { TransientChunk } from '../api';
import { SimulationError, findVector } from '../results';
import { createTransientStepper } from './stepper';
import { runAnalyses } from './run';
import { cap, ind, model, netlist, res, vdc, vsrc, vswitch } from './testing';

function concat(chunks: TransientChunk[], name: string): { t: number[]; v: number[] } {
  const t: number[] = [];
  const v: number[] = [];
  for (const c of chunks) {
    t.push(...c.time);
    v.push(...c.vectors[name]);
  }
  return { t, v };
}

const sinCircuit = () =>
  netlist([
    vsrc('V1', 'in', '0', { tran: { type: 'SIN', args: [0.5, 2, 1e3] } }),
    res('R1', 'in', 'a', 1e3),
    cap('C1', 'a', '0', 0.2e-6),
    ind('L1', 'a', 'b', 50e-3),
    res('R2', 'b', '0', 470),
  ]);

describe('TransientStepper', () => {
  it('chunked advance reproduces a one-shot run and the .tran analysis', () => {
    const tstep = 5e-6;
    const tend = 4e-3;
    const chunked = createTransientStepper(sinCircuit(), { tstep });
    const chunks: TransientChunk[] = [];
    for (let t = 0.37e-3; t < tend + 0.37e-3; t += 0.37e-3) chunks.push(chunked.advance(Math.min(t, tend)));
    const oneShot = createTransientStepper(sinCircuit(), { tstep });
    const whole = oneShot.advance(tend);
    const a = concat(chunks, 'V(b)');
    const b = concat([whole], 'V(b)');
    expect(a.t.length).toBe(b.t.length);
    expect(a.t[0]).toBe(0);
    for (let k = 0; k < a.t.length; k++) {
      expect(a.t[k]).toBe(b.t[k]);
      expect(Math.abs(a.v[k] - b.v[k])).toBeLessThan(1e-6);
    }
    expect(chunked.time).toBe(oneShot.time);
    expect(chunked.time).toBeGreaterThanOrEqual(tend);

    // same timepoints and values as the batch transient analysis (away from its stop time)
    const n = sinCircuit();
    n.analyses = [{ type: 'tran', tstep, tstop: tend + 0.5e-3 }];
    const [r] = runAnalyses(n);
    expect(r.error).toBeUndefined();
    const times = Array.from(r.scale?.re as Float64Array);
    const vb = findVector(r, 'V(b)')?.re as Float64Array;
    let compared = 0;
    for (let k = 0; k < a.t.length; k++) {
      const j = times.indexOf(a.t[k]);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(Math.abs(vb[j] - a.v[k])).toBeLessThan(1e-6);
      compared++;
    }
    expect(compared).toBeGreaterThan(800);
  });

  it('setParam on a DC source changes the following samples', () => {
    const tau = 1e-3;
    const s = createTransientStepper(netlist([vdc('V1', 'in', '0', 1), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)]), {
      tstep: 10e-6,
      saves: ['V(out)', 'I(V1)'],
    });
    expect(s.vectorNames()).toEqual(['V(out)', 'I(V1)']);
    const first = s.advance(5e-3);
    expect(first.time[0]).toBe(0);
    expect(first.vectors['V(out)'][0]).toBeCloseTo(1, 12); // operating point: capacitor charged
    const t1 = s.time;
    expect(s.latest()['V(out)']).toBeCloseTo(1, 9);
    s.setParam('V1', 'dc', 2);
    const second = s.advance(t1 + 5e-3);
    const tv = second.time;
    const vv = second.vectors['V(out)'];
    expect(tv[0]).toBeGreaterThan(t1);
    for (let k = 0; k < tv.length; k++) {
      const ref = 2 - Math.exp(-(tv[k] - t1) / tau);
      expect(Math.abs(vv[k] - ref)).toBeLessThan(1e-3);
    }
    expect(s.latest()['V(out)']).toBe(vv[vv.length - 1]);
    expect(s.latest()['I(V1)']).toBe(second.vectors['I(V1)'][tv.length - 1]);
  });

  it('setParam changes waveform amplitude and frequency by name', () => {
    const s = createTransientStepper(netlist([vsrc('V1', 'in', '0', { tran: { type: 'SIN', args: [0, 1, 1e3] } }), res('R1', 'in', '0', 1e3)]), {
      tstep: 10e-6,
    });
    const c1 = s.advance(1e-3);
    c1.time.forEach((t, k) => expect(c1.vectors['V(in)'][k]).toBeCloseTo(Math.sin(2 * Math.PI * 1e3 * t), 9));
    s.setParam('V1', 'ampl', 3);
    s.setParam('V1', 'freq', 2e3);
    const c2 = s.advance(2e-3);
    expect(c2.time.length).toBeGreaterThan(50);
    c2.time.forEach((t, k) => expect(c2.vectors['V(in)'][k]).toBeCloseTo(3 * Math.sin(2 * Math.PI * 2e3 * t), 9));
    expect(c2.vectors['I(V1)'][c2.time.length - 1]).toBeCloseTo(-c2.vectors['V(in)'][c2.time.length - 1] / 1e3, 12);
  });

  it('setParam changes resistor values and forces switch states', () => {
    const s = createTransientStepper(
      netlist(
        [vdc('V1', 'in', '0', 10), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 1e3), vdc('Vc', 'c', '0', 0), vswitch('S1', 'out', '0', 'c', '0', 'sw')],
        [],
        { models: [model('sw', 'SW', { vt: 1, ron: 1e-3, roff: 1e12 })] },
      ),
      { tstep: 1e-5 },
    );
    expect(s.advance(1e-4).vectors['V(out)'][0]).toBeCloseTo(5, 6);
    s.setParam('R2', 'value', 3e3);
    expect(s.latest()['V(out)']).toBeCloseTo(5, 6); // not simulated yet
    s.advance(2e-4);
    expect(s.latest()['V(out)']).toBeCloseTo(7.5, 6);
    s.setParam('S1', 'value', 1); // close the switch from the UI
    s.advance(3e-4);
    expect(s.latest()['V(out)']).toBeLessThan(1e-4);
    s.setParam('S1', 'value', Number.NaN); // release: control (0 V) keeps it open
    s.advance(4e-4);
    expect(s.latest()['V(out)']).toBeCloseTo(7.5, 6);
    expect(() => s.setParam('Rnope', 'value', 1)).toThrow(SimulationError);
  });

  it('honours maxWallMs and keeps hitting periodic edges in an open-ended run', () => {
    const per = 1e-4;
    const s = createTransientStepper(
      netlist([vsrc('V1', 'in', '0', { tran: { type: 'PULSE', args: [0, 1, 1e-5, 1e-6, 1e-6, 4e-5, per] } }), res('R1', 'in', 'o', 1e3), cap('C1', 'o', '0', 1e-9)]),
      { tstep: 2e-6 },
    );
    const quick = s.advance(1, 0);
    expect(quick.time.length).toBe(2); // initial point + one step
    expect(s.time).toBeLessThan(1);
    const all: number[] = [...quick.time];
    for (let k = 0; k < 40; k++) all.push(...s.advance((k + 1) * 2.5e-4).time);
    expect(s.time).toBeGreaterThanOrEqual(1e-2);
    for (let k = 0; k < 100; k++) {
      const edge = 1e-5 + k * per;
      expect(all.some((t) => Math.abs(t - edge) <= 1e-15)).toBe(true);
    }
  });
});
