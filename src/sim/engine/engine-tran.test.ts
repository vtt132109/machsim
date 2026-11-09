import { describe, expect, it } from 'vitest';
import type { Device, LoadContext, SetupContext } from '../device';
import { registerDeviceFactory } from '../devices/registry';
import type { ElementIR, Netlist, TranAnalysis } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { waveformBreakpoints } from '../waveforms';
import { runAnalyses } from './run';
import { cap, idc, ind, interpolate, iswitch, model, netlist, res, tline, vdc, vsrc, vswitch } from './testing';

function tran(n: Netlist): AnalysisResult {
  const [r] = runAnalyses(n);
  if (r.error) throw new Error(r.error);
  return r;
}

function series(r: AnalysisResult, name: string): { t: Float64Array; v: Float64Array } {
  const v = findVector(r, name);
  if (!v) throw new Error(`missing ${name}`);
  return { t: r.scale?.re as Float64Array, v: v.re };
}

const at = (s: { t: Float64Array; v: Float64Array }, time: number) => interpolate(s.t, s.v, time);

/** Device that refuses to converge after t = 1 ms (to provoke "timestep too small"). */
class Stubborn implements Device {
  readonly type = 'D' as const;
  readonly name: string;
  readonly nodeNames: string[];
  private a = -1;
  constructor(el: ElementIR) {
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
  }
  setup(ctx: SetupContext): void {
    this.a = ctx.node(this.nodeNames[0]);
  }
  load(ctx: LoadContext): void {
    ctx.addMatrix(this.a, this.a, 1e-3);
    if (ctx.mode === 'tran' && !ctx.tranOp && ctx.time > 1e-3) ctx.noncon();
  }
}
registerDeviceFactory('D', (el) => new Stubborn(el));

describe('first-order transients', () => {
  it('RC charging matches 5(1 - exp(-t/τ)) (UIC)', () => {
    const tau = 1e-3;
    const r = tran(
      netlist([vdc('V1', 'in', '0', 5), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)], [
        { type: 'tran', tstep: 10e-6, tstop: 5e-3, uic: true },
      ]),
    );
    const s = series(r, 'V(out)');
    expect(s.t[0]).toBe(0);
    expect(s.t[s.t.length - 1]).toBe(5e-3);
    for (const t of [0.1e-3, 0.5e-3, 1e-3, 2e-3, 3e-3, 5e-3]) {
      const ref = 5 * (1 - Math.exp(-t / tau));
      expect(Math.abs(at(s, t) - ref) / ref).toBeLessThan(1e-3);
    }
  });

  it('RC response to a PULSE edge (ramp input, exact solution)', () => {
    const tau = 1e-3;
    const td = 1e-3;
    const tr = 1e-5;
    const r = tran(
      netlist([vsrc('V1', 'in', '0', { tran: { type: 'PULSE', args: [0, 5, td, tr, tr, 1, 2] } }), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)], [
        { type: 'tran', tstep: 10e-6, tstop: 6e-3 },
      ]),
    );
    const s = series(r, 'V(out)');
    expect(at(s, 0.5e-3)).toBe(0);
    for (const t of [1.5e-3, 2e-3, 3e-3, 5e-3]) {
      const ref = 5 * (1 - (tau / tr) * (Math.exp(-(t - td - tr) / tau) - Math.exp(-(t - td) / tau)));
      expect(Math.abs(at(s, t) - ref) / ref).toBeLessThan(1e-3);
    }
  });

  it('Gear-2 integration is accurate as well', () => {
    const tau = 1e-3;
    const r = tran(
      netlist([vdc('V1', 'in', '0', 5), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)], [{ type: 'tran', tstep: 10e-6, tstop: 4e-3, uic: true }], {
        options: { method: 'gear' },
      }),
    );
    const s = series(r, 'V(out)');
    for (const t of [0.5e-3, 1e-3, 2e-3, 4e-3]) {
      const ref = 5 * (1 - Math.exp(-t / tau));
      expect(Math.abs(at(s, t) - ref) / ref).toBeLessThan(1e-3);
    }
  });

  it('RL current rise matches (V/R)(1 - exp(-tR/L))', () => {
    const R = 10;
    const L = 10e-3;
    const r = tran(netlist([vdc('V1', 'in', '0', 1), res('R1', 'in', 'a', R), ind('L1', 'a', '0', L)], [{ type: 'tran', tstep: 10e-6, tstop: 5e-3, uic: true }]));
    const s = series(r, 'I(L1)');
    for (const t of [0.2e-3, 1e-3, 2e-3, 5e-3]) {
      const ref = 0.1 * (1 - Math.exp((-t * R) / L));
      expect(Math.abs(at(s, t) - ref) / ref).toBeLessThan(1e-3);
    }
  });

  it('.ic values are forced during the transient operating point', () => {
    for (const key of ['out', 'V(out)']) {
      const r = tran(
        netlist([vdc('V1', 'in', '0', 10), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)], [{ type: 'tran', tstep: 10e-6, tstop: 3e-3 }], {
          ic: { [key]: 2 },
        }),
      );
      const s = series(r, 'V(out)');
      expect(s.v[0]).toBeCloseTo(2, 5);
      for (const t of [0.5e-3, 1e-3, 3e-3]) {
        const ref = 10 - 8 * Math.exp(-t / 1e-3);
        expect(Math.abs(at(s, t) - ref) / ref).toBeLessThan(1e-3);
      }
    }
  });
});

describe('second-order transients', () => {
  it('underdamped series RLC rings at ωd and decays with α = R/2L', () => {
    const R = 10;
    const L = 1e-3;
    const C = 1e-6;
    const alpha = R / (2 * L);
    const w0 = 1 / Math.sqrt(L * C);
    const wd = Math.sqrt(w0 * w0 - alpha * alpha);
    const Td = (2 * Math.PI) / wd;
    const r = tran(
      netlist([vdc('V1', 'in', '0', 1), res('R1', 'in', 'a', R), ind('L1', 'a', 'b', L), cap('C1', 'b', '0', C)], [
        { type: 'tran', tstep: Td / 400, tstop: 6 * Td, uic: true },
      ]),
    );
    const s = series(r, 'V(b)');
    const exact = (t: number) => 1 - Math.exp(-alpha * t) * (Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t));
    for (let k = 1; k <= 60; k++) {
      const t = (k * 6 * Td) / 61;
      expect(Math.abs(at(s, t) - exact(t))).toBeLessThan(1e-3);
    }
    // ringing frequency from upward crossings of v - 1
    const crossings: number[] = [];
    for (let i = 1; i < s.t.length; i++) {
      const a = s.v[i - 1] - 1;
      const b = s.v[i] - 1;
      if (a < 0 && b >= 0) crossings.push(s.t[i - 1] + ((s.t[i] - s.t[i - 1]) * -a) / (b - a));
    }
    expect(crossings.length).toBeGreaterThanOrEqual(5);
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    expect(Math.abs(period - Td) / Td).toBeLessThan(1e-3);
    // decay between successive maxima: exp(-α Td)
    const peaks: number[] = [];
    for (let i = 1; i + 1 < s.v.length; i++) if (s.v[i] > s.v[i - 1] && s.v[i] >= s.v[i + 1] && s.v[i] > 1) peaks.push(s.v[i] - 1);
    expect(peaks.length).toBeGreaterThanOrEqual(4);
    const ratio = peaks[2] / peaks[1];
    expect(Math.abs(ratio - Math.exp(-alpha * Td)) / Math.exp(-alpha * Td)).toBeLessThan(2e-3);
  });

  it('LC tank keeps its energy within 1 % over 10 periods (trapezoidal)', () => {
    const L = 1e-3;
    const C = 1e-6;
    const T = 2 * Math.PI * Math.sqrt(L * C);
    const r = tran(
      netlist([cap('C1', 'a', '0', C, { ic: 1 }), ind('L1', 'a', '0', L)], [{ type: 'tran', tstep: T / 50, tstop: 10 * T, uic: true }], { ic: { a: 1 } }),
    );
    const v = series(r, 'V(a)');
    const i = series(r, 'I(L1)');
    const e0 = 0.5 * C;
    let worst = 0;
    for (let k = 0; k < v.t.length; k++) {
      const e = 0.5 * C * v.v[k] ** 2 + 0.5 * L * i.v[k] ** 2;
      worst = Math.max(worst, Math.abs(e - e0) / e0);
    }
    expect(v.t[v.t.length - 1]).toBeCloseTo(10 * T, 15);
    expect(worst).toBeLessThan(0.01);
  });
});

describe('source waveforms in transient', () => {
  it('hits every PULSE corner exactly', () => {
    const w = { type: 'PULSE' as const, args: [0, 1, 1e-6, 0.1e-6, 0.2e-6, 2e-6, 5e-6] };
    const spec: TranAnalysis = { type: 'tran', tstep: 0.1e-6, tstop: 12e-6 };
    const r = tran(netlist([vsrc('V1', 'in', '0', { tran: w }), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-9)], [spec]));
    const s = series(r, 'V(in)');
    const corners = waveformBreakpoints(w, spec.tstop, { tstep: spec.tstep, tstop: spec.tstop });
    // pulses start at 1, 6 and 11 µs; the third one is cut by tstop after its rising edge
    expect(corners.length).toBe(10);
    const times = Array.from(s.t);
    for (const c of corners) {
      const k = times.indexOf(c);
      expect(k).toBeGreaterThanOrEqual(0);
    }
    const value = (t: number) => s.v[times.indexOf(t)];
    // corner times are hit exactly; values carry only floating-point rounding of t - td
    expect(value(corners[0])).toBeCloseTo(0, 12); // td
    expect(value(corners[1])).toBeCloseTo(1, 12); // td + tr
    expect(value(corners[2])).toBeCloseTo(1, 12); // td + tr + pw
    expect(value(corners[3])).toBeCloseTo(0, 12); // td + tr + pw + tf
    expect(value(corners[5])).toBeCloseTo(1, 12); // second pulse at top
  });

  it('repeats a PWL waveform', () => {
    const r = tran(
      netlist([vsrc('V1', 'in', '0', { tran: { type: 'PWL', args: [0, 0, 1e-3, 1, 2e-3, 0], repeatFrom: 0 } }), res('R1', 'in', '0', 1e3)], [
        { type: 'tran', tstep: 50e-6, tstop: 7e-3 },
      ]),
    );
    const s = series(r, 'V(in)');
    const times = Array.from(s.t);
    for (let k = 1; k <= 7; k++) {
      const idx = times.findIndex((t) => Math.abs(t - k * 1e-3) < 1e-15);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(s.v[idx]).toBeCloseTo(k % 2 === 1 ? 1 : 0, 12);
    }
    expect(at(s, 4.25e-3)).toBeCloseTo(0.25, 9);
    expect(at(s, 5.5e-3)).toBeCloseTo(0.5, 9);
  });

  it('SIN through an RC low-pass reaches the analytic steady state', () => {
    const R = 1e3;
    const f = 1e3;
    const C = 1 / (2 * Math.PI * f * R); // corner at f: |H| = 1/√2, phase -45°
    const r = tran(netlist([vsrc('V1', 'in', '0', { tran: { type: 'SIN', args: [0, 1, f] } }), res('R1', 'in', 'out', R), cap('C1', 'out', '0', C)], [{ type: 'tran', tstep: 1e-6, tstop: 6e-3 }]));
    const s = series(r, 'V(out)');
    const w = 2 * Math.PI * f;
    let worst = 0;
    for (let t = 5e-3; t <= 6e-3; t += 1e-5) {
      const ref = Math.SQRT1_2 * Math.sin(w * t - Math.PI / 4);
      worst = Math.max(worst, Math.abs(at(s, t) - ref));
    }
    expect(worst / Math.SQRT1_2).toBeLessThan(1e-3);
  });

  it('starts reporting at tstart and keeps at least one sample per tstep', () => {
    const r = tran(
      netlist([vdc('V1', 'in', '0', 5), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)], [
        { type: 'tran', tstep: 20e-6, tstop: 5e-3, tstart: 1e-3, tmax: 1e-3, uic: true },
      ]),
    );
    const t = r.scale?.re as Float64Array;
    expect(t[0]).toBe(1e-3);
    expect(t[t.length - 1]).toBe(5e-3);
    for (let k = 1; k < t.length; k++) expect(t[k] - t[k - 1]).toBeLessThanOrEqual(20e-6 * (1 + 1e-9));
    const v = findVector(r, 'V(out)')?.re as Float64Array;
    expect(Math.abs(v[0] - 5 * (1 - Math.exp(-1)))).toBeLessThan(5e-3);
  });

  it('current sources drive transients too', () => {
    const r = tran(netlist([idc('I1', '0', 'a', 1e-3), res('R1', 'a', '0', 1e3), cap('C1', 'a', '0', 1e-6)], [{ type: 'tran', tstep: 10e-6, tstop: 3e-3, uic: true }]));
    const s = series(r, 'V(a)');
    expect(Math.abs(at(s, 2e-3) - (1 - Math.exp(-2))) / (1 - Math.exp(-2))).toBeLessThan(1e-3);
  });
});

describe('switches', () => {
  it('voltage-controlled switch toggles with hysteresis', () => {
    const ctrl = { type: 'PWL' as const, args: [0, 0, 1e-3, 5, 2e-3, 0] };
    const r = tran(
      netlist(
        [vsrc('Vc', 'c', '0', { tran: ctrl }), vdc('Vdd', 'vdd', '0', 5), res('Rup', 'vdd', 'o', 1e3), vswitch('S1', 'o', '0', 'c', '0', 'sw')],
        [{ type: 'tran', tstep: 5e-6, tstop: 2e-3 }],
        { models: [model('sw', 'SW', { vt: 2.5, vh: 0.5, ron: 1, roff: 1e9 })] },
      ),
    );
    const o = series(r, 'V(o)');
    const c = series(r, 'V(c)');
    let checked = 0;
    for (let k = 0; k < o.t.length; k++) {
      const t = o.t[k];
      const vc = c.v[k];
      const rising = t <= 1e-3;
      // on when vc > 3 (rising) / vc > 2 (falling); skip points right at the thresholds
      const thr = rising ? 3 : 2;
      if (Math.abs(vc - thr) < 0.05) continue;
      const on = vc > thr;
      if (on) expect(o.v[k]).toBeLessThan(0.01);
      else expect(o.v[k]).toBeGreaterThan(4.99);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
    // the output toggles exactly twice
    let toggles = 0;
    for (let k = 1; k < o.v.length; k++) if (o.v[k] < 2.5 !== o.v[k - 1] < 2.5) toggles++;
    expect(toggles).toBe(2);
  });

  it('current-controlled switch follows the controlling branch current', () => {
    const r = tran(
      netlist(
        [
          vsrc('Vc', 'c', '0', { tran: { type: 'PWL', args: [0, 0, 1e-3, 10, 2e-3, 0] } }),
          vdc('Vsense', 'c', 'cs', 0),
          res('Rc', 'cs', '0', 1e3),
          vdc('Vdd', 'vdd', '0', 1),
          res('Rup', 'vdd', 'o', 1e3),
          iswitch('W1', 'o', '0', 'Vsense', 'csw'),
        ],
        [{ type: 'tran', tstep: 5e-6, tstop: 2e-3 }],
        { models: [model('csw', 'CSW', { it: 5e-3, ih: 2e-3, ron: 1, roff: 1e9 })] },
      ),
    );
    const o = series(r, 'V(o)');
    // on above 7 mA (Vc > 7 V, t > 0.7 ms) while rising; off below 3 mA (Vc < 3 V, t > 1.7 ms) while falling
    expect(at(o, 0.65e-3)).toBeGreaterThan(0.99);
    expect(at(o, 0.75e-3)).toBeLessThan(0.01);
    expect(at(o, 1.6e-3)).toBeLessThan(0.01);
    expect(at(o, 1.75e-3)).toBeGreaterThan(0.99);
  });
});

describe('lossless transmission line', () => {
  const z0 = 50;
  const td = 5e-9;
  const step = { type: 'PULSE' as const, args: [0, 1, 1e-9, 0.1e-9, 0.1e-9, 1, 2] };

  function line(load: number): AnalysisResult {
    return tran(
      netlist([vsrc('V1', 's', '0', { tran: step }), res('Rs', 's', 'in', z0), tline('T1', 'in', '0', 'out', '0', { z0, td }), res('RL', 'out', '0', load)], [
        { type: 'tran', tstep: 0.05e-9, tstop: 25e-9 },
      ]),
    );
  }

  it('matched load: delayed copy, no reflection', () => {
    const r = line(z0);
    const vin = series(r, 'V(in)');
    const vout = series(r, 'V(out)');
    expect(Math.abs(at(vout, 5.9e-9))).toBeLessThan(1e-6);
    for (const t of [6.2e-9, 10e-9, 20e-9, 25e-9]) expect(Math.abs(at(vout, t) - 0.5)).toBeLessThan(5e-4);
    for (const t of [1.2e-9, 11.5e-9, 16e-9, 24e-9]) expect(Math.abs(at(vin, t) - 0.5)).toBeLessThan(5e-4);
    // the edge arrives exactly td later (half-amplitude crossing)
    expect(Math.abs(at(vout, 1.05e-9 + td) - 0.25)).toBeLessThan(5e-3);
  });

  it('open end doubles the wave and reflects it back after 2·td', () => {
    const r = line(1e12);
    const vin = series(r, 'V(in)');
    const vout = series(r, 'V(out)');
    expect(Math.abs(at(vout, 5.9e-9))).toBeLessThan(1e-6);
    for (const t of [6.2e-9, 12e-9, 24e-9]) expect(Math.abs(at(vout, t) - 1)).toBeLessThan(1e-3);
    expect(Math.abs(at(vin, 10.9e-9) - 0.5)).toBeLessThan(1e-3);
    for (const t of [11.2e-9, 15e-9, 24e-9]) expect(Math.abs(at(vin, t) - 1)).toBeLessThan(1e-3);
  });
});

describe('transient failures and performance', () => {
  it('reports "timestep too small" naming the non-converging device', () => {
    const [r] = runAnalyses(
      netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', 'b', 1e3), { type: 'D', name: 'D9', nodes: ['b', '0'], params: {} }], [
        { type: 'tran', tstep: 1e-5, tstop: 2e-3 },
      ]),
    );
    expect(r.error).toMatch(/Timestep too small/);
    expect(r.error).toMatch(/D9/);
  });

  it('simulates a 1000-section RC ladder over 2000+ timepoints in under 3 s', () => {
    const elements: ElementIR[] = [vsrc('V1', 'n0', '0', { tran: { type: 'PULSE', args: [0, 1, 0, 1e-9, 1e-9, 1, 2] } })];
    for (let k = 1; k <= 1000; k++) {
      elements.push(res(`R${k}`, `n${k - 1}`, `n${k}`, 10));
      elements.push(cap(`C${k}`, `n${k}`, '0', 1e-9));
    }
    const n = netlist(elements, [{ type: 'tran', tstep: 1e-8, tstop: 2e-5 }]);
    const t0 = performance.now();
    const [r] = runAnalyses(n);
    const ms = performance.now() - t0;
    expect(r.error).toBeUndefined();
    const t = r.scale?.re as Float64Array;
    expect(t.length).toBeGreaterThanOrEqual(2000);
    expect(r.vectors.length).toBe(1001 + 1); // node voltages + I(V1)
    const v1 = findVector(r, 'V(n1)')?.re as Float64Array;
    const v500 = findVector(r, 'V(n500)')?.re as Float64Array;
    expect(v1[v1.length - 1]).toBeGreaterThan(0.5);
    expect(v1[v1.length - 1]).toBeLessThanOrEqual(1);
    expect(v500[v500.length - 1]).toBeLessThan(v1[v1.length - 1]);
    expect(ms).toBeLessThan(3000);
  });
});

describe('breakpoints closer than the truncation-error step', () => {
  it('a 1 ns time constant switched in at a 1 ns pulse edge does not stall the stepping', () => {
    // the edge's two breakpoints are 1 ns apart, below minBreak (5e-5 · 5 µs = 0.25 ns) times
    // the LTE step; the step must not be stretched onto the breakpoint over and over
    const n = netlist(
      [
        vsrc('V1', 'in', '0', { dc: 0, tran: { type: 'PWL', args: [0, 0, 4e-3, 4] } }),
        vsrc('VK', 'clk', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 500e-6, 1e-9, 1e-9, 250e-6, 1e-3] } }),
        vswitch('S1', 'in', 'h', 'clk', '0', 'swm'),
        cap('C1', 'h', '0', 1e-9),
      ],
      [{ type: 'tran', tstep: 5e-6, tstop: 0.6e-3 }],
      { models: [model('swm', 'SW', { vt: 2.5, vh: 0.01, ron: 1, roff: 1e12 })] },
    );
    const t0 = Date.now();
    const r = tran(n);
    expect(Date.now() - t0).toBeLessThan(5000);
    // the hold capacitor tracks the 1 V/ms ramp once the switch is on
    expect(at(series(r, 'V(h)'), 0.55e-3)).toBeCloseTo(0.55, 4);
  });
});
