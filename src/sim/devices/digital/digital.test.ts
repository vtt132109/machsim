/**
 * Digital code models through the real engine (runAnalyses / createTransientStepper):
 * truth tables, thresholds, output stages, propagation delay, inertial delay, flip-flop edge
 * triggering, latches, operating points of logic loops, MSI blocks, mixed-signal blocks.
 */
import { describe, expect, it } from 'vitest';
import { createTransientStepper, findVector, runAnalyses, type AnalysisResult } from '../../index';
import { cap, interpolate, isrc, model, netlist, res, vdc, vsrc } from '../../engine/testing';
import type { AnalysisSpec, ElementIR, ModelCard, Waveform } from '../../netlist';
import { SEGMENT_FONTS, digitalModelTypes } from './index';

const A = (name: string, nodes: string[], m: string, params: Record<string, number> = {}): ElementIR => ({ type: 'A', name, nodes, model: m, params });

function run(elements: ElementIR[], models: ModelCard[], spec: AnalysisSpec): AnalysisResult {
  const r = runAnalyses(netlist(elements, [spec], { models }))[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}

const op = (elements: ElementIR[], models: ModelCard[]) => run(elements, models, { type: 'op' }).scalars!;

const vec = (r: AnalysisResult, name: string): Float64Array => {
  const v = findVector(r, name);
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
};

const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name), t);

/** Times where vector `name` crosses `level` (linear interpolation), optionally one direction. */
function crossings(r: AnalysisResult, name: string, level: number, dir: 'up' | 'down' | 'both' = 'both'): number[] {
  const t = r.scale!.re;
  const v = vec(r, name);
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const a = v[i - 1] - level;
    const b = v[i] - level;
    const up = a < 0 && b >= 0;
    const down = a > 0 && b <= 0;
    if ((up && dir !== 'down') || (down && dir !== 'up')) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  }
  return out;
}

const pulse = (v1: number, v2: number, td: number, tr: number, tf: number, pw: number, per: number): Waveform => ({ type: 'PULSE', args: [v1, v2, td, tr, tf, pw, per] });
const pwl = (...pairs: number[]): Waveform => ({ type: 'PWL', args: pairs });

/** Ideal 0 / 5 V logic, 1 ns delays and edges. */
const IDEAL = { vol: 0, voh: 5, rout: 10, rise_delay: 1e-9, fall_delay: 1e-9, rise_time: 1e-9, fall_time: 1e-9 };
const logic = (v: number) => (v > 2.5 ? 1 : 0);

/** Sources hi = 5 V and lo = 0 V for constant logic inputs. */
const RAILS = [vdc('VHI', 'hi', '0', 5), vdc('VLO', 'lo', '0', 0)];
const bitNode = (code: number, k: number): string => ((code >> k) & 1 ? 'hi' : 'lo');

/** Clock source: 0/5 V, period `per`, first rising edge at `td`, 1 ns edges. */
const clock = (name: string, node: string, per: number, td = per / 2) => vsrc(name, node, '0', { dc: 0, tran: pulse(0, 5, td, 1e-9, 1e-9, per / 2 - 1e-9, per) });

describe('code-model registry', () => {
  it('provides every primitive family', () => {
    const types = digitalModelTypes();
    for (const t of [
      'D_AND', 'D_NAND', 'D_OR', 'D_NOR', 'D_XOR', 'D_XNOR', 'D_BUFFER', 'D_INVERTER', 'D_SCHMITT', 'D_SCHMITT_INV', 'D_TRISTATE',
      'D_DFF', 'D_JKFF', 'D_TFF', 'D_SRFF', 'D_DLATCH', 'D_SRLATCH', 'D_OSC', 'D_SOURCE', 'D_PULLUP', 'D_PULLDOWN', 'D_ADC', 'D_DAC',
      'ADC_BRIDGE', 'DAC_BRIDGE', 'D_CNT_SYNC', 'D_CNT_DIV2_DIV5', 'D_CNT_JOHNSON', 'D_DECODER', 'D_MUX', 'D_ADDER', 'D_BCD7SEG',
    ]) {
      expect(types).toContain(t);
    }
  });
});

describe('combinational primitives', () => {
  const tables: [string, (bits: number[]) => number][] = [
    ['D_AND', (b) => (b.every((x) => x === 1) ? 1 : 0)],
    ['D_NAND', (b) => (b.every((x) => x === 1) ? 0 : 1)],
    ['D_OR', (b) => (b.some((x) => x === 1) ? 1 : 0)],
    ['D_NOR', (b) => (b.some((x) => x === 1) ? 0 : 1)],
    ['D_XOR', (b) => b.reduce((p, x) => p ^ x, 0)],
    ['D_XNOR', (b) => 1 - b.reduce((p, x) => p ^ x, 0)],
  ];

  it.each(tables)('%s reproduces its truth table for 1 to 4 inputs', (type, fn) => {
    const els: ElementIR[] = [...RAILS];
    const expected: Record<string, number> = {};
    for (let n = 1; n <= 4; n++) {
      for (let code = 0; code < 2 ** n; code++) {
        const ins = Array.from({ length: n }, (_, k) => bitNode(code, k));
        const out = `y${n}_${code}`;
        els.push(A(`A${n}_${code}`, [...ins, out], 'g'));
        expected[out] = fn(Array.from({ length: n }, (_, k) => (code >> k) & 1));
      }
    }
    const s = op(els, [model('g', type, IDEAL)]);
    for (const [node, v] of Object.entries(expected)) expect(s[`V(${node})`], `${type} ${node}`).toBeCloseTo(5 * v, 9);
  });

  it('buffers, inverters and Schmitt triggers', () => {
    const els: ElementIR[] = [...RAILS];
    for (const t of ['buf', 'inv', 'st', 'sti']) {
      els.push(A(`A_${t}0`, ['lo', `${t}0`], t), A(`A_${t}1`, ['hi', `${t}1`], t));
    }
    const s = op(els, [model('buf', 'D_BUFFER', IDEAL), model('inv', 'D_INVERTER', IDEAL), model('st', 'D_SCHMITT', IDEAL), model('sti', 'D_SCHMITT_INV', IDEAL)]);
    expect([s['V(buf0)'], s['V(buf1)'], s['V(inv0)'], s['V(inv1)']]).toEqual([0, 5, 5, 0]);
    expect([s['V(st0)'], s['V(st1)'], s['V(sti0)'], s['V(sti1)']]).toEqual([0, 5, 5, 0]);
  });

  it('output stage is a Thevenin source between vol and voh', () => {
    const m = model('ttl', 'D_INVERTER', { vol: 0.2, voh: 3.4, rlow: 20, rhigh: 80 });
    const s = op([...RAILS, A('A1', ['lo', 'yh'], 'ttl'), res('RL1', 'yh', '0', 1000), A('A2', ['hi', 'yl'], 'ttl'), res('RL2', 'yl', 'hi', 1000)], [m]);
    expect(s['V(yh)']).toBeCloseTo((3.4 * 1000) / 1080, 9);
    expect(s['V(yl)']).toBeCloseTo(0.2 + ((5 - 0.2) * 20) / 1020, 9);
  });

  it('inputs switch at vth (DC sweep) and load their node with rin to vin_float', () => {
    const m = model('b', 'D_BUFFER', { ...IDEAL, vil: 0.8, vih: 2.0 });
    const r = run([vdc('V1', 'in', '0', 0), A('A1', ['in', 'y'], 'b')], [m], { type: 'dc', src: 'V1', start: 0, stop: 3, step: 0.01 });
    const vin = r.scale!.re;
    const y = vec(r, 'V(y)');
    const first = vin[y.findIndex((v) => v > 2.5)];
    expect(first).toBeGreaterThan(1.4);
    expect(first).toBeLessThan(1.4 + 0.0101);
    // TTL-style input: a floating input (1 MΩ to ground) reads high, 1 kΩ to ground reads low
    const ttl = model('t', 'D_BUFFER', { ...IDEAL, vth: 1.4, rin: 4000, vin_float: 1.8 });
    const s = op([res('R1', 'a', '0', 1e6), A('A1', ['a', 'ya'], 't'), res('R2', 'b', '0', 1000), A('A2', ['b', 'yb'], 't')], [ttl]);
    expect(s['V(a)']).toBeCloseTo((1.8 * 1e6) / (1e6 + 4000), 9);
    expect(s['V(ya)']).toBe(5);
    expect(s['V(b)']).toBeCloseTo((1.8 * 1000) / 5000, 9);
    expect(s['V(yb)']).toBe(0);
  });

  it('Schmitt inputs switch at vtp rising and vtn falling', () => {
    const m = model('s', 'D_SCHMITT', { ...IDEAL, vtp: 1.7, vtn: 0.9, rise_delay: 2e-9, fall_delay: 2e-9 });
    // triangle 0 -> 3 V in 300 ns, back to 0 V at 600 ns: 10 mV/ns
    const r = run([vsrc('V1', 'in', '0', { dc: 0, tran: pwl(0, 0, 300e-9, 3, 600e-9, 0) }), A('A1', ['in', 'y'], 's')], [m], { type: 'tran', tstep: 5e-9, tstop: 600e-9 });
    const up = crossings(r, 'V(y)', 2.5, 'up');
    const down = crossings(r, 'V(y)', 2.5, 'down');
    expect(up).toHaveLength(1);
    expect(down).toHaveLength(1);
    expect(up[0]).toBeCloseTo(170e-9 + 2e-9, 12);
    expect(down[0]).toBeCloseTo(510e-9 + 2e-9, 12);
  });

  it('tri-state buffer releases its output (Z) when disabled', () => {
    const t = model('t', 'D_TRISTATE', { ...IDEAL, roff: 1e9 });
    const tl = model('tl', 'D_TRISTATE', { ...IDEAL, enable_low: 1, invert: 1 });
    const s = op(
      [
        ...RAILS,
        A('A1', ['hi', 'hi', 'y1'], 't'),
        res('R1', 'y1', '0', 10e3),
        A('A2', ['hi', 'lo', 'y2'], 't'),
        res('R2', 'y2', 'hi', 10e3),
        A('A3', ['hi', 'lo', 'y3'], 'tl'),
        res('R3', 'y3', 'hi', 10e3),
        A('A4', ['hi', 'hi', 'y4'], 'tl'),
        res('R4', 'y4', '0', 10e3),
      ],
      [t, tl],
    );
    expect(s['V(y1)']).toBeCloseTo((5 * 10e3) / (10e3 + 10), 9);
    expect(s['V(y2)']).toBeCloseTo((5 * 1e9) / (1e9 + 10e3), 9); // released: pulled up by R2
    expect(s['V(y3)']).toBeCloseTo((5 * 10) / (10e3 + 10), 9); // enabled (low), inverting: drives 0
    expect(s['V(y4)']).toBeCloseTo(0, 6); // disabled, pull-down
  });

  it('bridges re-level each bit and pull-ups lose against strong drivers', () => {
    const s = op(
      [vdc('V1', 'a', '0', 0.3), vdc('V2', 'b', '0', 0.9), A('A1', ['a', 'b', 'qa', 'qb'], 'br'), A('A2', ['w'], 'pu'), A('A3', ['hi', 'w'], 'inv'), ...RAILS],
      [model('br', 'ADC_BRIDGE', { in_low: 0.4, in_high: 0.6, out_low: 0, out_high: 3.3, rout: 1 }), model('pu', 'D_PULLUP', { vol: 0, voh: 5 }), model('inv', 'D_INVERTER', { vol: 0, voh: 5, rout: 100 })],
    );
    expect(s['V(qa)']).toBe(0);
    expect(s['V(qb)']).toBeCloseTo(3.3, 12);
    expect(s['V(w)']).toBeCloseTo((5 * 100) / 1100, 9);
  });

  it('honours XSPICE inverted ports and NULL ports', () => {
    const el: ElementIR = { ...A('A1', ['hi', 'lo', 'y'], 'and2'), stringParams: { ports: '[ # ~# ] ~#' } };
    const s = op([...RAILS, el, A('A2', ['hi', 'null', 'z'], 'and2')], [model('and2', 'D_AND', IDEAL)]);
    expect(s['V(y)']).toBe(0); // ~(1 & ~0)
    expect(s['V(z)']).toBe(0); // NULL input reads 0
  });

  it('reports port-count, model and type errors', () => {
    const bad = runAnalyses(netlist([...RAILS, A('A1', ['hi', 'y'], 'ff')], [{ type: 'op' }], { models: [model('ff', 'D_DFF', {})] }))[0];
    expect(bad.error).toMatch(/A1: expected 6 port nodes \(d clk set reset q qn\)/);
    const missing = runAnalyses(netlist([...RAILS, A('A1', ['hi', 'y'], 'nothere')], [{ type: 'op' }]))[0];
    expect(missing.error).toMatch(/model 'nothere' not found/);
    const unknown = runAnalyses(netlist([...RAILS, A('A1', ['hi', 'y'], 'x')], [{ type: 'op' }], { models: [model('x', 'D_FROBNICATE', {})] }))[0];
    expect(unknown.error).toMatch(/not supported/);
  });
});

describe('timing', () => {
  const inv = model('inv', 'D_INVERTER', { vol: 0, voh: 5, rout: 10, rise_delay: 5e-9, fall_delay: 3e-9, rise_time: 2e-9, fall_time: 2e-9 });

  it('propagation delay is measured between 50 % points and adds up along a chain', () => {
    const r = run(
      [vsrc('V1', 'a', '0', { dc: 0, tran: pulse(0, 5, 10e-9, 1e-9, 1e-9, 50e-9, 100e-9) }), A('A1', ['a', 'b'], 'inv'), A('A2', ['b', 'c'], 'inv'), A('A3', ['c', 'd'], 'inv')],
      [inv],
      { type: 'tran', tstep: 1e-9, tstop: 120e-9 },
    );
    const a = crossings(r, 'V(a)', 2.5);
    expect(a[0]).toBeCloseTo(10.5e-9, 15);
    expect(crossings(r, 'V(b)', 2.5)[0]).toBeCloseTo(10.5e-9 + 3e-9, 13);
    expect(crossings(r, 'V(c)', 2.5)[0]).toBeCloseTo(10.5e-9 + 8e-9, 13);
    expect(crossings(r, 'V(d)', 2.5)[0]).toBeCloseTo(10.5e-9 + 11e-9, 13);
    // falling input edge: rise (5 ns) + fall (3 ns) + rise (5 ns)
    expect(crossings(r, 'V(d)', 2.5)[1] - a[1]).toBeCloseTo(13e-9, 13);
    // unloaded output: 10 % -> 90 % in 0.8 * rise_time
    const rise = crossings(r, 'V(c)', 4.5, 'up')[0] - crossings(r, 'V(c)', 0.5, 'up')[0];
    expect(rise).toBeCloseTo(1.6e-9, 13);
  });

  it('edges are exact even with a coarse output step', () => {
    const r = run(
      [vsrc('V1', 'a', '0', { dc: 0, tran: pulse(0, 5, 2e-6, 1e-9, 1e-9, 3e-6, 10e-6) }), A('A1', ['a', 'b'], 'inv')],
      [inv],
      { type: 'tran', tstep: 1e-6, tstop: 10e-6 },
    );
    expect(crossings(r, 'V(b)', 2.5)[0]).toBeCloseTo(2e-6 + 0.5e-9 + 3e-9, 14);
    expect(r.scale!.re.length).toBeLessThan(200);
  });

  it('pulses shorter than the propagation delay are swallowed (inertial delay)', () => {
    const slow = model('slow', 'D_BUFFER', { ...IDEAL, rise_delay: 10e-9, fall_delay: 10e-9 });
    const r = run(
      [
        vsrc('V1', 'a', '0', { dc: 0, tran: pulse(0, 5, 20e-9, 0.5e-9, 0.5e-9, 4e-9, 1) }),
        vsrc('V2', 'b', '0', { dc: 0, tran: pulse(0, 5, 20e-9, 0.5e-9, 0.5e-9, 15e-9, 1) }),
        A('A1', ['a', 'ya'], 'slow'),
        A('A2', ['b', 'yb'], 'slow'),
      ],
      [slow],
      { type: 'tran', tstep: 1e-9, tstop: 80e-9 },
    );
    expect(Math.max(...vec(r, 'V(ya)'))).toBe(0);
    const yb = crossings(r, 'V(yb)', 2.5);
    expect(yb).toHaveLength(2);
    expect(yb[1] - yb[0]).toBeCloseTo(15.5e-9, 12);
  });

  it('pwr = 2 outputs track the supply, draw their current from it and scale CMOS thresholds', () => {
    const cmos = model('c', 'D_INVERTER', { vol: 0, voh: 5, vnom: 5, rout: 50, thresh_scale: 1 });
    const s = op([vdc('VDD', 'vdd', '0', 3.3), vdc('VIN', 'in', '0', 0), A('A1', ['in', 'y', 'vdd', '0'], 'c', { pwr: 2 }), res('RL', 'y', '0', 950)], [cmos]);
    expect(s['V(y)']).toBeCloseTo((3.3 * 950) / 1000, 9);
    expect(s['I(VDD)']).toBeCloseTo(-3.3 / 1000, 12);
    const r = run([vdc('VDD', 'vdd', '0', 3.3), vdc('VIN', 'in', '0', 0), A('A1', ['in', 'y', 'vdd', '0'], 'c', { pwr: 2 })], [cmos], { type: 'dc', src: 'VIN', start: 0, stop: 3.3, step: 0.01 });
    const vin = r.scale!.re;
    const sw = vin[vec(r, 'V(y)').findIndex((v) => v < 1)];
    expect(sw).toBeGreaterThan(1.65);
    expect(sw).toBeLessThan(1.65 + 0.0101);
  });

  it('digital outputs present rout to small signals (AC)', () => {
    const m = model('d', 'D_INVERTER', { vol: 0, voh: 5, rlow: 20, rhigh: 80 });
    const r = run([...RAILS, A('A1', ['lo', 'y'], 'd'), isrc('I1', '0', 'y', { acMag: 1 })], [m], { type: 'acsingle', freq: 1e3 });
    expect(vec(r, 'V(y)')[0]).toBeCloseTo(80, 9);
  });
});

describe('flip-flops and latches', () => {
  const ff = (type: string, extra: Record<string, number> = {}) => model(type.toLowerCase(), type, { ...IDEAL, ...extra });

  it('D flip-flop samples D on rising clock edges only', () => {
    // clock 100 ns period, rising edges at 50, 150, 250 ... ns; D toggles at 100, 280, 330 ns
    const r = run(
      [clock('VC', 'clk', 100e-9), vsrc('VD', 'd', '0', { dc: 0, tran: pwl(0, 0, 100e-9, 0, 101e-9, 5, 280e-9, 5, 281e-9, 0, 330e-9, 0, 331e-9, 5) }), A('A1', ['d', 'clk', 'null', 'null', 'q', 'qn'], 'd_dff')],
      [ff('D_DFF')],
      { type: 'tran', tstep: 2e-9, tstop: 500e-9 },
    );
    const q = (t: number) => logic(at(r, 'V(q)', t));
    // D = 0 only between 281 and 330 ns, i.e. between two edges: Q never sees it
    expect([q(40e-9), q(140e-9), q(240e-9), q(270e-9), q(340e-9), q(440e-9)]).toEqual([0, 0, 1, 1, 1, 1]);
    expect(logic(at(r, 'V(qn)', 340e-9))).toBe(0);
    // clock-to-output delay from the clock crossing (150.5 ns) + rise_delay
    expect(crossings(r, 'V(q)', 2.5, 'up')[0]).toBeCloseTo(150.5e-9 + 1e-9, 12);
  });

  it('falling-edge clocking, active-low async set / reset and the both-active state', () => {
    const r = run(
      [
        clock('VC', 'clk', 100e-9),
        vdc('VD', 'd', '0', 5),
        vsrc('VS', 'pre', '0', { dc: 5, tran: pwl(0, 5, 350e-9, 5, 351e-9, 0, 380e-9, 0, 381e-9, 5) }),
        vsrc('VR', 'clr', '0', { dc: 5, tran: pwl(0, 5, 120e-9, 5, 121e-9, 0, 160e-9, 0, 161e-9, 5, 360e-9, 5, 361e-9, 0, 370e-9, 0, 371e-9, 5) }),
        A('A1', ['d', 'clk', 'pre', 'clr', 'q', 'qn'], 'd_dff'),
      ],
      [ff('D_DFF', { clk_edge: 0, set_low: 1, reset_low: 1 })],
      { type: 'tran', tstep: 2e-9, tstop: 500e-9 },
    );
    const q = (t: number) => logic(at(r, 'V(q)', t));
    const qn = (t: number) => logic(at(r, 'V(qn)', t));
    expect(q(90e-9)).toBe(0); // first falling edge at 100 ns
    expect(q(110e-9)).toBe(1);
    expect(q(140e-9)).toBe(0); // async clear
    expect(q(190e-9)).toBe(0); // clock low edge only at 200 ns
    expect(q(210e-9)).toBe(1);
    expect([q(365e-9), qn(365e-9)]).toEqual([1, 1]); // preset and clear both active
  });

  it('JK, T and SR flip-flops', () => {
    const r = run(
      [
        clock('VC', 'clk', 100e-9),
        ...RAILS,
        A('A1', ['hi', 'hi', 'clk', 'null', 'null', 'toggle', 'toggle_n'], 'jk'),
        A('A2', ['hi', 'lo', 'clk', 'null', 'null', 'set', 'set_n'], 'jk'),
        A('A3', ['hi', 'clk', 'null', 'null', 'tq', 'tqn'], 't'),
        A('A4', ['lo', 'clk', 'null', 'null', 'hold', 'hold_n'], 't'),
        A('A5', ['lo', 'hi', 'clk', 'null', 'null', 'srq', 'srqn'], 'sr', { ic: 1 }),
      ],
      [model('jk', 'D_JKFF', IDEAL), model('t', 'D_TFF', IDEAL), model('sr', 'D_SRFF', IDEAL)],
      { type: 'tran', tstep: 2e-9, tstop: 520e-9 },
    );
    // rising edges at 50, 150, 250, 350, 450 ns: toggles -> 1 0 1 0 1
    const samples = [100e-9, 200e-9, 300e-9, 400e-9, 500e-9];
    expect(samples.map((t) => logic(at(r, 'V(toggle)', t)))).toEqual([1, 0, 1, 0, 1]);
    expect(samples.map((t) => logic(at(r, 'V(tq)', t)))).toEqual([1, 0, 1, 0, 1]);
    expect(samples.map((t) => logic(at(r, 'V(set)', t)))).toEqual([1, 1, 1, 1, 1]);
    expect(samples.map((t) => logic(at(r, 'V(hold)', t)))).toEqual([0, 0, 0, 0, 0]);
    expect(logic(at(r, 'V(srq)', 0))).toBe(1); // ic = 1
    expect(logic(at(r, 'V(srq)', 100e-9))).toBe(0);
  });

  it('D latch is transparent while enabled and holds otherwise; SR latch', () => {
    const r = run(
      [
        vsrc('VD', 'd', '0', { dc: 0, tran: pulse(0, 5, 30e-9, 1e-9, 1e-9, 20e-9, 40e-9) }),
        vsrc('VE', 'en', '0', { dc: 5, tran: pwl(0, 5, 85e-9, 5, 86e-9, 0) }),
        A('A1', ['d', 'en', 'null', 'null', 'q', 'qn'], 'dl'),
        vsrc('VS', 's', '0', { dc: 0, tran: pwl(0, 0, 50e-9, 0, 51e-9, 5, 60e-9, 5, 61e-9, 0) }),
        vsrc('VR', 'r', '0', { dc: 0, tran: pwl(0, 0, 150e-9, 0, 151e-9, 5, 160e-9, 5, 161e-9, 0) }),
        A('A2', ['s', 'r', 'null', 'null', 'null', 'sq', 'sqn'], 'sl'),
      ],
      [model('dl', 'D_DLATCH', IDEAL), model('sl', 'D_SRLATCH', IDEAL)],
      { type: 'tran', tstep: 2e-9, tstop: 250e-9 },
    );
    const q = (t: number) => logic(at(r, 'V(q)', t));
    // D high 31..51 ns and 71..91 ns; en falls at 85.5 ns while D is high
    expect([q(20e-9), q(40e-9), q(60e-9), q(80e-9)]).toEqual([0, 1, 0, 1]);
    expect([q(95e-9), q(115e-9), q(135e-9), q(200e-9)]).toEqual([1, 1, 1, 1]); // held
    const sq = (t: number) => logic(at(r, 'V(sq)', t));
    expect([sq(40e-9), sq(100e-9), sq(200e-9)]).toEqual([0, 1, 0]);
  });

  it('UIC transient: initial state from ic and from the .ic input voltages', () => {
    const els = [A('A1', ['lo', 'lo', 'null', 'null', 'q', 'qn'], 'ff'), A('A2', ['in', 'y'], 'inv'), res('RIN', 'in', '0', 1e3), ...RAILS];
    const r = runAnalyses(
      netlist(els, [{ type: 'tran', tstep: 10e-9, tstop: 100e-9, uic: true }], { models: [model('ff', 'D_DFF', { ...IDEAL, ic: 1 }), model('inv', 'D_INVERTER', IDEAL)], ic: { in: 5 } }),
    )[0];
    expect(r.error).toBeUndefined();
    expect(at(r, 'V(q)', 50e-9)).toBeCloseTo(5, 6);
    expect(at(r, 'V(qn)', 50e-9)).toBeCloseTo(0, 6);
    // the inverter saw its input at 5 V (.ic) in the initial load, then the input decays to 0 V
    // through RIN (no capacitance): output low first, high after its 1 ns delay
    expect(vec(r, 'V(y)')[1]).toBeCloseTo(0, 6);
    expect(at(r, 'V(y)', 50e-9)).toBeCloseTo(5, 6);
  });

  it('operating point of a cross-coupled NAND latch is consistent', () => {
    const nand = model('nand', 'D_NAND', IDEAL);
    const s = op([...RAILS, A('A1', ['hi', 'qb', 'q'], 'nand'), A('A2', ['hi', 'q', 'qb'], 'nand')], [nand]);
    expect(logic(s['V(q)']) + logic(s['V(qb)'])).toBe(1);
    // the same latch set and reset by active-low pulses in a transient
    const r = run(
      [
        vsrc('VS', 'sn', '0', { dc: 5, tran: pwl(0, 5, 50e-9, 5, 51e-9, 0, 60e-9, 0, 61e-9, 5) }),
        vsrc('VR', 'rn', '0', { dc: 5, tran: pwl(0, 5, 150e-9, 5, 151e-9, 0, 160e-9, 0, 161e-9, 5) }),
        A('A1', ['sn', 'qb', 'q'], 'nand'),
        A('A2', ['rn', 'q', 'qb'], 'nand'),
      ],
      [nand],
      { type: 'tran', tstep: 2e-9, tstop: 250e-9 },
    );
    expect([logic(at(r, 'V(q)', 100e-9)), logic(at(r, 'V(qb)', 100e-9))]).toEqual([1, 0]);
    expect([logic(at(r, 'V(q)', 200e-9)), logic(at(r, 'V(qb)', 200e-9))]).toEqual([0, 1]);
  });

  it('a three-inverter ring oscillates with period 6 * tpd', () => {
    const inv = model('inv', 'D_INVERTER', { ...IDEAL, rise_delay: 5e-9, fall_delay: 5e-9 });
    const r = run([A('A1', ['a', 'b'], 'inv'), A('A2', ['b', 'c'], 'inv'), A('A3', ['c', 'a'], 'inv')], [inv], { type: 'tran', tstep: 1e-9, tstop: 200e-9 });
    const ups = crossings(r, 'V(a)', 2.5, 'up');
    expect(ups.length).toBeGreaterThanOrEqual(5);
    for (let i = 2; i < ups.length; i++) expect(ups[i] - ups[i - 1]).toBeCloseTo(30e-9, 12);
  });
});

describe('MSI blocks', () => {
  it('synchronous counter: count, load, enables, RCO, async and sync clear', () => {
    const nodes = (clr: string, load: string, prefix: string) => ['clk', clr, load, 'hi', 'ent', 'hi', 'lo', 'hi', 'lo', `${prefix}0`, `${prefix}1`, `${prefix}2`, `${prefix}3`, `${prefix}rco`];
    const r = run(
      [
        ...RAILS,
        clock('VC', 'clk', 100e-9),
        vsrc('VT', 'ent', '0', { dc: 5, tran: pwl(0, 5, 1700e-9, 5, 1701e-9, 0) }),
        vsrc('VL', 'ld', '0', { dc: 5, tran: pwl(0, 5, 1720e-9, 5, 1721e-9, 0, 1780e-9, 0, 1781e-9, 5) }),
        vsrc('VCL', 'clr', '0', { dc: 5, tran: pwl(0, 5, 1910e-9, 5, 1911e-9, 0, 1960e-9, 0, 1961e-9, 5) }),
        A('A1', nodes('hi', 'ld', 'q'), 'cnt'),
        A('A2', nodes('clr', 'hi', 's'), 'cnt163'),
        A('A3', nodes('clr', 'hi', 'a'), 'cnt'),
      ],
      [model('cnt', 'D_CNT_SYNC', IDEAL), model('cnt163', 'D_CNT_SYNC', { ...IDEAL, sync_clear: 1 })],
      { type: 'tran', tstep: 5e-9, tstop: 2000e-9 },
    );
    const count = (p: string, t: number) => [0, 1, 2, 3].reduce((acc, k) => acc + logic(at(r, `V(${p}${k})`, t)) * 2 ** k, 0);
    // rising edges at 50 + 100k ns
    for (let k = 0; k < 16; k++) expect(count('q', 100e-9 * k + 90e-9), `count after edge ${k}`).toBe((k + 1) % 16);
    expect(logic(at(r, 'V(qrco)', 1490e-9))).toBe(1); // count 15 with ent high
    expect(logic(at(r, 'V(qrco)', 1590e-9))).toBe(0);
    expect(count('q', 1740e-9)).toBe(count('q', 1690e-9)); // ent low: hold
    expect(count('q', 1790e-9)).toBe(5); // synchronous load of 0101 at the 1750 ns edge
    expect(count('a', 1920e-9)).toBe(0); // asynchronous clear
    // 17 counted edges (50 .. 1650 ns, ent low afterwards); the 74163-style clear waits for the 1950 ns edge
    expect(count('s', 1920e-9)).toBe(17 % 16);
    expect(count('s', 1990e-9)).toBe(0);
  });

  it('÷2 / ÷5 counter wired for BCD (qa -> ckb) counts 0..9 with R0 / R9', () => {
    const r = run(
      [
        ...RAILS,
        vsrc('VC', 'clk', '0', { dc: 5, tran: pulse(5, 0, 50e-9, 1e-9, 1e-9, 50e-9 - 1e-9, 100e-9) }),
        vsrc('V9', 'r9', '0', { dc: 0, tran: pwl(0, 0, 1210e-9, 0, 1211e-9, 5, 1230e-9, 5, 1231e-9, 0) }),
        A('A1', ['clk', 'qa', 'lo', 'lo', 'r9', 'hi', 'qa', 'qb', 'qc', 'qd'], 'c90'),
      ],
      [model('c90', 'D_CNT_DIV2_DIV5', { ...IDEAL, rise_delay: 5e-9, fall_delay: 5e-9 })],
      { type: 'tran', tstep: 5e-9, tstop: 1400e-9 },
    );
    const bcd = (t: number) => logic(at(r, 'V(qa)', t)) + 2 * logic(at(r, 'V(qb)', t)) + 4 * logic(at(r, 'V(qc)', t)) + 8 * logic(at(r, 'V(qd)', t));
    // falling clock edges at 50 + 100k ns
    const seq = Array.from({ length: 12 }, (_, k) => bcd(100e-9 * k + 95e-9));
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
    expect(bcd(1225e-9)).toBe(9);
  });

  it('Johnson decade counter (one-hot outputs, carry, inhibit, reset)', () => {
    const outs = Array.from({ length: 10 }, (_, k) => `q${k}`);
    const r = run(
      [
        clock('VC', 'clk', 100e-9),
        vsrc('VI', 'inh', '0', { dc: 0, tran: pwl(0, 0, 1300e-9, 0, 1301e-9, 5, 1470e-9, 5, 1471e-9, 0) }),
        vsrc('VR', 'rst', '0', { dc: 0, tran: pwl(0, 0, 1720e-9, 0, 1721e-9, 5, 1730e-9, 5, 1731e-9, 0) }),
        A('A1', ['clk', 'inh', 'rst', ...outs, 'co'], 'j'),
      ],
      [model('j', 'D_CNT_JOHNSON', IDEAL)],
      { type: 'tran', tstep: 5e-9, tstop: 1800e-9 },
    );
    const state = (t: number) => {
      const hot = outs.filter((o) => logic(at(r, `V(${o})`, t)) === 1);
      expect(hot).toHaveLength(1);
      return Number(hot[0].slice(1));
    };
    expect(Array.from({ length: 12 }, (_, k) => state(100e-9 * k + 90e-9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
    expect(logic(at(r, 'V(co)', 390e-9))).toBe(1); // count 4
    expect(logic(at(r, 'V(co)', 490e-9))).toBe(0); // count 5
    expect(state(1440e-9)).toBe(state(1290e-9)); // inhibited: no count at the 1350 ns edge
    expect(state(1468e-9)).toBe(state(1290e-9)); // nor at 1450 ns
    expect(state(1490e-9)).toBe((state(1290e-9) + 1) % 10); // ~inh falling with clk high counts
    expect(state(1590e-9)).toBe((state(1290e-9) + 2) % 10);
    expect(state(1740e-9)).toBe(0);
  });

  it('ripple counter with taps, up/down counter, shift registers', () => {
    const r = run(
      [
        ...RAILS,
        vsrc('VC', 'clk', '0', { dc: 5, tran: pulse(5, 0, 50e-9, 1e-9, 1e-9, 50e-9 - 1e-9, 100e-9) }),
        A('A1', ['clk', 'lo', 'r1', 'r2', 'r4'], 'rip', { tapmask: 0b1011 }),
        clock('VU', 'up', 100e-9),
        vsrc('VDN', 'dn', '0', { dc: 5 }),
        A('A2', ['up', 'dn', 'lo', 'hi', 'lo', 'lo', 'lo', 'lo', 'u0', 'u1', 'u2', 'u3', 'co', 'bo'], 'ud'),
        vsrc('VSER', 'ser', '0', { dc: 0, tran: pwl(0, 5, 120e-9, 5, 121e-9, 0) }),
        A('A3', ['ser', 'hi', 'up', 'hi', 's0', 's1', 's2', 's3'], 'sipo'),
      ],
      [model('rip', 'D_CNT_RIPPLE', { ...IDEAL, stages: 4 }), model('ud', 'D_CNT_UPDOWN', IDEAL), model('sipo', 'D_SHIFT_SIPO', IDEAL)],
      { type: 'tran', tstep: 5e-9, tstop: 1700e-9 },
    );
    const w = (names: string[], t: number) => names.reduce((acc, n, k) => acc + logic(at(r, `V(${n})`, t)) * 2 ** k, 0);
    // ripple: taps are stages 1, 2 and 4 (count bits 0, 1, 3)
    for (let k = 0; k < 16; k++) {
      const c = (k + 1) % 16;
      expect(w(['r1', 'r2', 'r4'], 100e-9 * k + 95e-9)).toBe((c & 3) + ((c >> 3) & 1) * 4);
    }
    // up counter: 15 -> ~co low while up is low
    expect(w(['u0', 'u1', 'u2', 'u3'], 1490e-9)).toBe(15);
    expect(logic(at(r, 'V(co)', 1520e-9))).toBe(0);
    expect(logic(at(r, 'V(co)', 1560e-9))).toBe(1);
    // SIPO: ser is high until 120 ns, so the 50 ns edge shifts in a 1 and every later edge a 0
    expect(w(['s0', 's1', 's2', 's3'], 100e-9)).toBe(1);
    expect(w(['s0', 's1', 's2', 's3'], 290e-9)).toBe(4);
    expect(w(['s0', 's1', 's2', 's3'], 490e-9)).toBe(0);
  });

  it('parallel-in shift register loads asynchronously and shifts on clk OR inh', () => {
    const r = run(
      [
        ...RAILS,
        vsrc('VLD', 'ld', '0', { dc: 0, tran: pwl(0, 0, 20e-9, 0, 21e-9, 5) }),
        clock('VC', 'clk', 100e-9),
        A('A1', ['ld', 'clk', 'lo', 'lo', 'hi', 'lo', 'hi', 'hi', 'qh', 'qhn'], 'piso'),
      ],
      [model('piso', 'D_SHIFT_PISO', IDEAL)],
      { type: 'tran', tstep: 5e-9, tstop: 500e-9 },
    );
    // loaded 1101 (d0 = 1, d1 = 0, d2 = 1, d3 = 1): qh = d3, then d2, d1, d0, then serial zeros
    expect([40e-9, 100e-9, 200e-9, 300e-9, 400e-9].map((t) => logic(at(r, 'V(qh)', t)))).toEqual([1, 1, 0, 1, 0]);
    expect(logic(at(r, 'V(qhn)', 200e-9))).toBe(1);
  });

  it('decoder, multiplexer and magnitude comparator', () => {
    const els: ElementIR[] = [...RAILS];
    for (let a = 0; a < 8; a++) {
      els.push(A(`AD${a}`, [bitNode(a, 0), bitNode(a, 1), bitNode(a, 2), 'hi', 'lo', 'lo', ...Array.from({ length: 8 }, (_, k) => `y${a}_${k}`)], 'dec'));
      els.push(A(`AM${a}`, [bitNode(a, 0), bitNode(a, 1), bitNode(a, 2), ...Array.from({ length: 8 }, (_, k) => bitNode(0b10110010, k)), 'lo', `m${a}`, `w${a}`], 'mux'));
    }
    els.push(A('ADX', ['hi', 'hi', 'hi', 'lo', 'lo', 'hi', ...Array.from({ length: 8 }, (_, k) => `x${k}`)], 'dec')); // G2B high: disabled
    els.push(A('AMX', ['hi', 'lo', 'lo', ...Array.from({ length: 8 }, () => 'hi'), 'hi', 'mx', 'wx'], 'mux')); // strobe high
    const cmp = (name: string, a: number, b: number, casc: [number, number, number]) =>
      A(name, [...[0, 1, 2, 3].map((k) => bitNode(a, k)), ...[0, 1, 2, 3].map((k) => bitNode(b, k)), ...casc.map((c) => (c ? 'hi' : 'lo')), `${name}_gt`, `${name}_eq`, `${name}_lt`], 'cmp');
    els.push(cmp('AC1', 9, 4, [0, 1, 0]), cmp('AC2', 3, 12, [0, 1, 0]), cmp('AC3', 7, 7, [0, 1, 0]), cmp('AC4', 7, 7, [1, 0, 0]), cmp('AC5', 7, 7, [1, 0, 1]), cmp('AC6', 7, 7, [0, 0, 0]));
    const s = op(els, [
      model('dec', 'D_DECODER', { ...IDEAL, en_high: 1, en_low: 2 }),
      model('mux', 'D_MUX', { ...IDEAL, strobe: 1, has_w: 1 }),
      model('cmp', 'D_MAGCOMP', IDEAL),
    ]);
    for (let a = 0; a < 8; a++) {
      for (let k = 0; k < 8; k++) expect(logic(s[`V(y${a}_${k})`]), `dec ${a} y${k}`).toBe(k === a ? 0 : 1);
      expect(logic(s[`V(m${a})`]), `mux ${a}`).toBe((0b10110010 >> a) & 1);
      expect(logic(s[`V(w${a})`])).toBe(1 - ((0b10110010 >> a) & 1));
    }
    for (let k = 0; k < 8; k++) expect(logic(s[`V(x${k})`])).toBe(1);
    expect([logic(s['V(mx)']), logic(s['V(wx)'])]).toEqual([0, 1]);
    const c = (n: string) => [logic(s[`V(${n}_gt)`]), logic(s[`V(${n}_eq)`]), logic(s[`V(${n}_lt)`])];
    expect([c('AC1'), c('AC2'), c('AC3'), c('AC4'), c('AC5'), c('AC6')]).toEqual([
      [1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
      [1, 0, 1],
    ]);
  });

  it('4-bit adder: all 512 input combinations from a pattern source', () => {
    const words = Array.from({ length: 512 }, (_, k) => k);
    const params: Record<string, number> = { nwords: words.length, period: 100e-9, pwr: 0 };
    words.forEach((w, k) => (params[`w${k}`] = w));
    const ins = Array.from({ length: 9 }, (_, k) => `i${k}`);
    const r = run(
      [A('ASRC', ins, 'src', params), A('AADD', [...ins, 's0', 's1', 's2', 's3', 'c4'], 'add')],
      [model('src', 'D_SOURCE', { vol: 0, voh: 5, rout: 1, rise_time: 1e-9, fall_time: 1e-9 }), model('add', 'D_ADDER', IDEAL)],
      { type: 'tran', tstep: 50e-9, tstop: 512 * 100e-9 },
    );
    for (const w of words) {
      const t = w * 100e-9 + 60e-9;
      const a = w & 15;
      const b = (w >> 4) & 15;
      const cin = (w >> 8) & 1;
      const sum = ['s0', 's1', 's2', 's3', 'c4'].reduce((acc, n, k) => acc + logic(at(r, `V(${n})`, t)) * 2 ** k, 0);
      expect(sum, `${a} + ${b} + ${cin}`).toBe(a + b + cin);
    }
  });

  it('BCD to 7-segment decoders (7447 open-collector, 4511 latch)', () => {
    const els: ElementIR[] = [...RAILS];
    const segs = (p: string) => Array.from({ length: 7 }, (_, k) => `${p}_${'abcdefg'[k]}`);
    for (let code = 0; code < 16; code++) {
      const s = segs(`t${code}`);
      els.push(A(`AT${code}`, [0, 1, 2, 3].map((k) => bitNode(code, k)).concat(['hi', 'hi', `t${code}_bi`], s), 'bcd'));
      for (const n of s) els.push(res(`R_${n}`, n, 'hi', 1e3));
      els.push(A(`AL${code}`, [0, 1, 2, 3].map((k) => bitNode(code, k)).concat(['hi', 'hi', 'lo'], segs(`c${code}`)), 'cd4511'));
    }
    // lamp test, blanking input, ripple blanking of a zero
    els.push(A('ALT', ['hi', 'lo', 'lo', 'hi', 'lo', 'hi', 'lt_bi', ...segs('lt')], 'bcd'), ...segs('lt').map((n) => res(`R_${n}`, n, 'hi', 1e3)));
    els.push(A('ABI', ['hi', 'lo', 'lo', 'lo', 'hi', 'hi', 'lo', ...segs('bi')], 'bcd'), ...segs('bi').map((n) => res(`R_${n}`, n, 'hi', 1e3)));
    els.push(A('ARB', ['lo', 'lo', 'lo', 'lo', 'hi', 'lo', 'rb_bi', ...segs('rb')], 'bcd'), ...segs('rb').map((n) => res(`R_${n}`, n, 'hi', 1e3)));
    const s = op(els, [model('bcd', 'D_BCD7SEG', { vol: 0.2, voh: 3.4, rout: 15 }), model('cd4511', 'D_BCD7SEG_LATCH', IDEAL)]);
    const maskLow = (p: string) => segs(p).reduce((acc, n, k) => acc + (s[`V(${n})`] < 1 ? 2 ** k : 0), 0);
    const maskHigh = (p: string) => segs(p).reduce((acc, n, k) => acc + (s[`V(${n})`] > 2.5 ? 2 ** k : 0), 0);
    for (let code = 0; code < 16; code++) {
      expect(maskLow(`t${code}`), `7447 code ${code}`).toBe(SEGMENT_FONTS.ttl7447[code]);
      expect(maskHigh(`c${code}`), `4511 code ${code}`).toBe(SEGMENT_FONTS.cmos4511[code]);
    }
    expect(s['V(t0_a)']).toBeCloseTo(0.2 + (4.8 * 15) / 1015, 9); // lit segment sinks through rlow
    expect(maskLow('lt')).toBe(0x7f);
    expect(maskLow('bi')).toBe(0);
    expect(maskLow('rb')).toBe(0);
    expect(s['V(rb_bi)']).toBeLessThan(0.5); // ~RBO pulled low by the blanked zero
    expect(s['V(t1_bi)']).toBeGreaterThan(3); // internal pull-up otherwise
  });

  it('register, monostables and bus transceiver', () => {
    const r = run(
      [
        ...RAILS,
        clock('VC', 'clk', 200e-9),
        vsrc('VD0', 'd0', '0', { dc: 5, tran: pwl(0, 5, 250e-9, 5, 251e-9, 0) }),
        A('AR', ['d0', 'hi', 'clk', 'hi', 'q0', 'q1', 'qn0', 'qn1'], 'reg'),
        vsrc('VB', 'b', '0', { dc: 0, tran: pwl(0, 0, 100e-9, 0, 101e-9, 5, 900e-9, 5, 901e-9, 0, 1000e-9, 0, 1001e-9, 5) }),
        A('A121', ['lo', 'hi', 'b', 'm1', 'm1n'], 'mono121'),
        vsrc('VA', 'a', '0', { dc: 5, tran: pwl(0, 5, 100e-9, 5, 101e-9, 0, 130e-9, 0, 131e-9, 5, 300e-9, 5, 301e-9, 0, 330e-9, 0, 331e-9, 5) }),
        vsrc('VCLR', 'clr', '0', { dc: 5, tran: pwl(0, 5, 1200e-9, 5, 1201e-9, 0) }),
        A('A123', ['a', 'hi', 'clr', 'm3', 'm3n'], 'mono123'),
        vsrc('VDIR', 'dir', '0', { dc: 5, tran: pwl(0, 5, 1500e-9, 5, 1501e-9, 0) }),
        A('AX', ['dir', 'lo', 'hi', 'lo', 'bb0', 'bb1'], 'xcvr'),
        res('RB0', 'bb0', '0', 1e4),
        A('AX2', ['hi', 'hi', 'za', 'zb'], 'xcvr'),
        res('RZ', 'zb', '0', 1e4),
        res('RZA', 'za', '0', 1e4),
      ],
      [
        model('reg', 'D_REGISTER', { ...IDEAL, has_qn: 1 }),
        model('mono121', 'D_ONESHOT', { ...IDEAL, mode: 121, tw: 500e-9 }),
        model('mono123', 'D_ONESHOT', { ...IDEAL, mode: 123, tw: 500e-9 }),
        model('xcvr', 'D_TRANSCEIVER', IDEAL),
      ],
      { type: 'tran', tstep: 10e-9, tstop: 1700e-9 },
    );
    // register: edges at 100, 300 ns
    expect([logic(at(r, 'V(q0)', 200e-9)), logic(at(r, 'V(q1)', 200e-9)), logic(at(r, 'V(qn0)', 200e-9))]).toEqual([1, 1, 0]);
    expect(logic(at(r, 'V(q0)', 400e-9))).toBe(0);
    // 74121-style: one 500 ns pulse from the b edge at 100.5 ns, not retriggered
    const m1 = crossings(r, 'V(m1)', 2.5);
    expect(m1[0]).toBeCloseTo(100.5e-9 + 1e-9, 11);
    expect(m1[1] - m1[0]).toBeCloseTo(500e-9, 11);
    expect(m1[2]).toBeCloseTo(1000.5e-9 + 1e-9, 11);
    // 74123-style: retriggered at 300.5 ns -> ends 500 ns later; second pulse cut by ~clr at 1200.5 ns
    const m3 = crossings(r, 'V(m3)', 2.5);
    expect(m3[0]).toBeCloseTo(100.5e-9 + 1e-9, 11);
    expect(m3[1]).toBeCloseTo(300.5e-9 + 500e-9 + 1e-9, 11);
    expect(m3).toHaveLength(2);
    // transceiver: A -> B while dir = 1, B side released afterwards; disabled one stays Z
    expect(at(r, 'V(bb0)', 1000e-9)).toBeCloseTo((5 * 1e4) / (1e4 + 10), 6);
    expect(at(r, 'V(bb0)', 1650e-9)).toBeCloseTo(0, 6);
    expect(at(r, 'V(zb)', 1000e-9)).toBeCloseTo(0, 6);
  });
});

describe('mixed-signal blocks', () => {
  it('digital clock: frequency, duty cycle and run-time frequency change', () => {
    const m = model('osc', 'D_OSC', { vol: 0, voh: 5, rout: 10, rise_time: 2e-9, fall_time: 2e-9 });
    const r = run([A('A1', ['clk'], 'osc', { freq: 1e6, duty: 0.25 })], [m], { type: 'tran', tstep: 50e-9, tstop: 5e-6 });
    const up = crossings(r, 'V(clk)', 2.5, 'up');
    const down = crossings(r, 'V(clk)', 2.5, 'down');
    expect(up[0]).toBeCloseTo(1e-9, 15);
    for (let i = 1; i < up.length; i++) expect(up[i] - up[i - 1]).toBeCloseTo(1e-6, 13);
    expect(down[0] - up[0]).toBeCloseTo(0.25e-6, 13);

    const st = createTransientStepper(netlist([A('A1', ['clk'], 'osc', { freq: 1e6 }), res('R1', 'clk', '0', 1e6)], [], { models: [m] }), { tstep: 20e-9 });
    const c1 = st.advance(4e-6);
    st.setParam('A1', 'freq', 2e6);
    const c2 = st.advance(8e-6);
    const edges = (c: { time: Float64Array; vectors: Record<string, Float64Array> }) => {
      const v = c.vectors['V(clk)'];
      const out: number[] = [];
      for (let i = 1; i < v.length; i++) if (v[i - 1] < 2.5 && v[i] >= 2.5) out.push(c.time[i]);
      return out;
    };
    const e1 = edges(c1);
    const e2 = edges(c2);
    expect(e1[2] - e1[1]).toBeCloseTo(1e-6, 8);
    expect(e2[e2.length - 1] - e2[e2.length - 2]).toBeCloseTo(0.5e-6, 8);
  });

  it('ADC: continuous conversion (DC sweep) is floor(2^n Vin / Vref)', () => {
    const outs = Array.from({ length: 8 }, (_, k) => `d${k}`);
    const r = run(
      [vdc('VIN', 'vin', '0', 0), vdc('VREF', 'vref', '0', 5), A('A1', ['vin', 'vref', '0', 'null', 'null', 'eoc', ...outs], 'adc')],
      [model('adc', 'D_ADC', IDEAL)],
      { type: 'dc', src: 'VIN', start: 0, stop: 5, step: 0.0173 },
    );
    const vin = r.scale!.re;
    for (let i = 0; i < vin.length; i++) {
      const code = outs.reduce((acc, n, k) => acc + logic(vec(r, `V(${n})`)[i]) * 2 ** k, 0);
      expect(code, `vin ${vin[i]}`).toBe(Math.min(255, Math.floor((256 * vin[i]) / 5 + 1e-9)));
    }
  });

  it('ADC with start-of-conversion, end-of-conversion and output enable', () => {
    const outs = Array.from({ length: 4 }, (_, k) => `d${k}`);
    const r = run(
      [
        vsrc('VIN', 'vin', '0', { dc: 1, tran: pwl(0, 1, 500e-9, 1, 501e-9, 3.3) }),
        vdc('VREF', 'vref', '0', 5),
        vsrc('VSOC', 'soc', '0', { dc: 0, tran: pulse(0, 5, 100e-9, 1e-9, 1e-9, 50e-9, 1e-6) }),
        vsrc('VOE', 'oe', '0', { dc: 5, tran: pwl(0, 5, 1800e-9, 5, 1801e-9, 0) }),
        A('A1', ['vin', 'vref', '0', 'soc', 'oe', 'eoc', ...outs], 'adc'),
        ...outs.map((n) => res(`R_${n}`, n, '0', 1e4)),
      ],
      [model('adc', 'D_ADC', { ...IDEAL, tconv: 300e-9 })],
      { type: 'tran', tstep: 10e-9, tstop: 2000e-9 },
    );
    const code = (t: number) => outs.reduce((acc, n, k) => acc + logic(at(r, `V(${n})`, t)) * 2 ** k, 0);
    expect(code(50e-9)).toBe(3); // operating point: continuous value floor(16 * 1 / 5)
    expect(logic(at(r, 'V(eoc)', 200e-9))).toBe(0); // converting
    expect(code(700e-9)).toBe(3); // first conversion sampled 1 V
    expect(code(1500e-9)).toBe(10); // second conversion (SOC at 1.1 µs) sampled 3.3 V
    expect(logic(at(r, 'V(eoc)', 1500e-9))).toBe(1);
    expect(at(r, 'V(d1)', 1900e-9)).toBeCloseTo(0, 6); // OE low: outputs released
  });

  it('DAC output and ADC -> DAC round trip within one LSB', () => {
    const bits = Array.from({ length: 8 }, (_, k) => `b${k}`);
    const s = op(
      [...RAILS, vdc('VREF', 'vref', '0', 4), A('A1', [...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => bitNode(0xa5, k)), 'vref', '0', 'out'], 'dac'), res('RL', 'out', '0', 999)],
      [model('dac', 'D_DAC', { ...IDEAL, rout: 1 })],
    );
    expect(s['V(out)']).toBeCloseTo(((4 * 0xa5) / 256) * (999 / 1000), 9);
    const lsb = 5 / 256;
    // DC sweep: the operating point evaluates the chain instantly -> exact truncation error
    const dc = run(
      [vdc('VIN', 'vin', '0', 0), vdc('VREF', 'vref', '0', 5), A('A1', ['vin', 'vref', '0', 'null', 'null', 'eoc', ...bits], 'adc'), A('A2', [...bits, 'vref', '0', 'out'], 'dac')],
      [model('adc', 'D_ADC', IDEAL), model('dac', 'D_DAC', IDEAL)],
      { type: 'dc', src: 'VIN', start: 0, stop: 4.99, step: 0.0071 },
    );
    const dvin = dc.scale!.re;
    const dout = vec(dc, 'V(out)');
    for (let i = 0; i < dvin.length; i++) expect(dout[i], `vin ${dvin[i]}`).toBeCloseTo((Math.floor((256 * dvin[i]) / 5 + 1e-9) * 5) / 256, 9);
    // transient: a slow sine is reproduced within one LSB plus the sampling lag (two steps)
    const r = run(
      [
        vsrc('VIN', 'vin', '0', { dc: 2.5, tran: { type: 'SIN', args: [2.5, 2.4, 50, 0, 0, 0] } }),
        vdc('VREF', 'vref', '0', 5),
        A('A1', ['vin', 'vref', '0', 'null', 'null', 'eoc', ...bits], 'adc'),
        A('A2', [...bits, 'vref', '0', 'out'], 'dac'),
      ],
      [model('adc', 'D_ADC', IDEAL), model('dac', 'D_DAC', { ...IDEAL, tsettle: 10e-9 })],
      { type: 'tran', tstep: 20e-6, tstop: 20e-3 },
    );
    const t = r.scale!.re;
    const vin = vec(r, 'V(vin)');
    const out = vec(r, 'V(out)');
    const lag = 2 * 2 * Math.PI * 50 * 2.4 * 20e-6;
    let worst = 0;
    for (let i = 0; i < t.length; i++) worst = Math.max(worst, Math.abs(vin[i] - out[i]));
    expect(worst).toBeLessThanOrEqual(lsb + lag);
    expect(worst).toBeGreaterThan(lsb * 0.5);
  });

  it('comparator with hysteresis drives a logic output', () => {
    const r = run(
      [vsrc('VIN', 'in', '0', { dc: 0, tran: { type: 'SIN', args: [0, 1, 1e3, 0, 0, 0] } }), A('A1', ['in', '0', 'y'], 'cmp')],
      [model('cmp', 'D_COMPARATOR', { ...IDEAL, vhys: 0.2, rise_delay: 0, fall_delay: 0, rise_time: 1e-9, fall_time: 1e-9 })],
      { type: 'tran', tstep: 1e-6, tstop: 1e-3 },
    );
    const up = crossings(r, 'V(y)', 2.5, 'up');
    const down = crossings(r, 'V(y)', 2.5, 'down');
    expect(up[0]).toBeCloseTo(Math.asin(0.1) / (2 * Math.PI * 1e3), 7);
    expect(down[0]).toBeCloseTo((Math.PI + Math.asin(0.1)) / (2 * Math.PI * 1e3), 7);
  });

  it('display sensing and the decoded hex display encode lit segments as a voltage', () => {
    const s = op(
      [
        ...RAILS,
        vdc('VA', 'an', '0', 5),
        vdc('VS0', 's0', '0', 3),
        vdc('VS1', 's1', '0', 5),
        vdc('VS2', 's2', '0', 2),
        A('A1', ['an', 's0', 'an', 's1', 'an', 's2', 'code'], 'disp'),
        ...Array.from({ length: 16 }, (_, c) => A(`AH${c}`, [0, 1, 2, 3].map((k) => bitNode(c, k)).concat([`h${c}`]), 'hex')),
      ],
      [model('disp', 'D_DISPLAY', { von: 1.5 }), model('hex', 'D_HEXDISPLAY', IDEAL)],
    );
    expect(s['V(code)']).toBeCloseTo(0b101, 9);
    for (let c = 0; c < 16; c++) expect(s[`V(h${c})`]).toBeCloseTo(SEGMENT_FONTS.hex[c], 9);
  });

  it('Schmitt RC relaxation oscillator clocks a counter (mixed analog / digital)', () => {
    const st = model('st', 'D_SCHMITT_INV', { vol: 0, voh: 5, rout: 10, vtp: 3, vtn: 2, rise_delay: 0, fall_delay: 0, rise_time: 1e-9, fall_time: 1e-9 });
    const R = 10e3;
    const C = 10e-9;
    const r = run(
      [
        vdc('VHI', 'hi', '0', 5),
        A('A1', ['x', 'osc'], 'st'),
        res('R1', 'osc', 'x', R),
        cap('C1', 'x', '0', C),
        A('A2', ['osc', 'hi', 'hi', 'hi', 'hi', 'hi', 'hi', 'hi', 'hi', 'q0', 'q1', 'q2', 'q3', 'rco'], 'cnt'),
      ],
      [st, model('cnt', 'D_CNT_SYNC', IDEAL)],
      { type: 'tran', tstep: 1e-6, tstop: 2e-3 },
    );
    // charge 2 -> 3 V towards 5 V, discharge 3 -> 2 V towards 0 V (rout in series with R)
    const tau = (R + 10) * C;
    const period = tau * Math.log((5 - 2) / (5 - 3)) + tau * Math.log(3 / 2);
    const ups = crossings(r, 'V(osc)', 2.5, 'up');
    const periods = ups.slice(2).map((t, i) => t - ups[i + 1]);
    for (const p of periods) expect(p / period).toBeCloseTo(1, 3);
    // counter advances once per oscillator period
    const count = (t: number) => [0, 1, 2, 3].reduce((acc, k) => acc + logic(at(r, `V(q${k})`, t)) * 2 ** k, 0);
    for (let i = 2; i < 8; i++) expect((count(ups[i + 1] - 1e-6) - count(ups[i] - 1e-6) + 16) % 16).toBe(1);
  });
});
