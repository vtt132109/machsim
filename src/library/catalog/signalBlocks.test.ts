/**
 * Round-3 sources and control-function blocks through the whole path (library part →
 * netlister → engine), each in a small test bench, against analytic references: the Laplace
 * source 1/(1 + sRC) equals an RC low-pass in AC and transient, one-shot widths, limiter and
 * hysteresis transfer curves, integrator ramps / reset / limits, slew rates, delay, PWM, the
 * interactive DC source's stepping and the reference grounds (isolation, probes, ERC).
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '..';
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { nextInteractiveValue } from '../../ui/store/interactive';
import { interpolate } from '../../sim/engine/testing';
import { parseCoefficients } from './signalBlocks';

/** Bench builder: parts far apart, nets by labels ("0" = ground). */
class Bench {
  readonly b = new DesignBuilder('bench');
  private x = 0;
  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string>): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }
  run(...analyses: AnalysisSpec[]): AnalysisResult[] {
    const build = buildNetlist(this.b.design, { includeAnalysis: false });
    const errors = build.erc.filter((m) => m.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
    const res = runAnalyses({ ...build.netlist, analyses });
    for (const r of res) expect(r.error, r.error).toBeUndefined();
    return res;
  }
  build() {
    return buildNetlist(this.b.design, { includeAnalysis: false });
  }
}

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
};
const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name).re, t);
const cmag = (r: AnalysisResult, name: string, i: number) => Math.hypot(vec(r, name).re[i], vec(r, name).im?.[i] ?? 0);
const cph = (r: AnalysisResult, name: string, i: number) => (Math.atan2(vec(r, name).im?.[i] ?? 0, vec(r, name).re[i]) * 180) / Math.PI;
function crossings(r: AnalysisResult, name: string, level: number, dir: 'rise' | 'fall'): number[] {
  const t = r.scale!.re;
  const v = vec(r, name).re;
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const up = v[i - 1] < level && v[i] >= level;
    const dn = v[i - 1] > level && v[i] <= level;
    if ((dir === 'rise' && up) || (dir === 'fall' && dn)) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  }
  return out;
}

const STEP = { v1: '0', v2: '1', delay: '0', rise: '1n', fall: '1n', width: '1', period: '2' };

describe('Laplace sources and the transfer-function block', () => {
  it('H(s) = 1/(1 + sRC) equals an RC low-pass in AC (magnitude and phase) and in a step response', () => {
    const k = new Bench();
    k.part('sources/ac-voltage', 'V1', { amplitude: '1', freq: '1k' }, { '+': 'in', '-': '0' });
    k.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'in', '2': 'rc' });
    k.part('basic/capacitor', 'C1', { value: '1u' }, { '1': 'rc', '2': '0' });
    k.part('sources/laplace-vcvs', 'E1', { num: '1', den: '1m 1' }, { 'in+': 'in', 'in-': '0', 'out+': 'lap', 'out-': '0' });
    k.part('analog/transfer-function', 'A1', { form: 'expr', expr: '1/(1 + s*1m)' }, { IN: 'in', OUT: 'tf' });
    k.part('basic/resistor', 'RL1', { value: '10k' }, { '1': 'lap', '2': '0' });
    k.part('basic/resistor', 'RL2', { value: '10k' }, { '1': 'tf', '2': '0' });
    const [ac] = k.run({ type: 'ac', sweep: 'list', points: 4, fstart: 10, fstop: 10e3, list: [10, 159.155, 1e3, 10e3] });
    for (let i = 0; i < 4; i++) {
      expect(cmag(ac, 'V(lap)', i), `f#${i}`).toBeCloseTo(cmag(ac, 'V(rc)', i), 9);
      expect(cph(ac, 'V(lap)', i)).toBeCloseTo(cph(ac, 'V(rc)', i), 6);
      expect(cmag(ac, 'V(tf)', i)).toBeCloseTo(cmag(ac, 'V(rc)', i), 9);
    }
    expect(cph(ac, 'V(lap)', 1)).toBeCloseTo(-45, 2);
    const s = new Bench();
    s.part('sources/pulse-voltage', 'V1', STEP, { '+': 'in', '-': '0' });
    s.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'in', '2': 'rc' });
    s.part('basic/capacitor', 'C1', { value: '1u' }, { '1': 'rc', '2': '0' });
    s.part('sources/laplace-vcvs', 'E1', { num: '1', den: '1m 1' }, { 'in+': 'in', 'in-': '0', 'out+': 'lap', 'out-': '0' });
    const [tr] = s.run({ type: 'tran', tstep: 10e-6, tstop: 5e-3 });
    for (const t of [0.5e-3, 1e-3, 2e-3, 4e-3]) {
      expect(at(tr, 'V(lap)', t), `t=${t}`).toBeCloseTo(1 - Math.exp(-t / 1e-3), 3);
      expect(at(tr, 'V(lap)', t)).toBeCloseTo(at(tr, 'V(rc)', t), 3);
    }
  });

  it('current-controlled and current-output variants, the gain and a second-order H(s)', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '2' }, { '+': 'a', '-': '0' });
    k.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'a', '2': 'b' });
    // 2 mA flows in+ → in- of the CCVS / CCCS chain
    k.part('sources/laplace-ccvs', 'H1', { num: '500', den: '1' }, { 'in+': 'b', 'in-': 'c', 'out+': 'v1', 'out-': '0' });
    k.part('sources/laplace-cccs', 'F1', { num: '3', den: '1u 1', gain: '2' }, { 'in+': 'c', 'in-': '0', 'out+': 'i1', 'out-': '0' });
    k.part('basic/resistor', 'R2', { value: '100' }, { '1': 'i1', '2': '0' });
    k.part('sources/laplace-vccs', 'G1', { num: '1e6', den: '1 1e3 1e6' }, { 'in+': 'a', 'in-': '0', 'out+': 'g', 'out-': '0' });
    k.part('basic/resistor', 'R3', { value: '1' }, { '1': 'g', '2': '0' });
    k.part('basic/resistor', 'R4', { value: '1k' }, { '1': 'v1', '2': '0' });
    const [op] = k.run({ type: 'op' });
    expect(op.scalars!['V(v1)']).toBeCloseTo(500 * 2e-3, 9);
    // CCCS: H(0) = 3, gain 2: 6 · 2 mA leaves out+ into 100 Ω
    expect(op.scalars!['V(i1)']).toBeCloseTo(6 * 2e-3 * 100, 9);
    // VCCS: H(0) = 1 S, 2 V into 1 Ω
    expect(op.scalars!['V(g)']).toBeCloseTo(2, 9);
    expect(parseCoefficients('1m 1', 'den')).toEqual([1e-3, 1]);
    expect(parseCoefficients('1, 0, 4,7k', 'den')).toEqual([1, 0, 4700]);
    expect(() => buildNetlist(new DesignBuilder().design)).not.toThrow();
  });

  it('rejects an improper H(s) with a clear message', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '1' }, { '+': 'a', '-': '0' });
    k.part('analog/transfer-function', 'A1', { num: '1 0', den: '1' }, { IN: 'a', OUT: 'o' });
    const erc = k.build().erc.filter((m) => m.severity === 'error');
    expect(erc[0].message).toMatch(/must be proper|numerator degree/);
  });
});

describe('controlled one-shot, current limiter, delay, PWM, bipolar', () => {
  it('one-shot: W = pw with CTRL open, W = pw + kpw·V(CTRL) with it connected', () => {
    for (const [ctrl, width] of [[undefined, 1e-3], ['1.5', 1e-3 + 1.5e-3]] as const) {
      const k = new Bench();
      k.part('sources/pulse-voltage', 'V1', { v1: '0', v2: '5', delay: '1m', rise: '1u', fall: '1u', width: '0.1m', period: '10' }, { '+': 'trig', '-': '0' });
      const pins: Record<string, string> = { TRIG: 'trig', OUT: 'out' };
      if (ctrl) {
        k.part('sources/dc-voltage', 'VC', { value: ctrl }, { '+': 'c', '-': '0' });
        pins.CTRL = 'c';
      }
      k.part('sources/controlled-one-shot', 'U1', { pw: '1m', kpw: '1m', edge: '1u' }, pins);
      k.part('basic/resistor', 'RL', { value: '10k' }, { '1': 'out', '2': '0' });
      const [tr] = k.run({ type: 'tran', tstep: 10e-6, tstop: 6e-3 });
      const rise = crossings(tr, 'V(out)', 2.5, 'rise');
      const fall = crossings(tr, 'V(out)', 2.5, 'fall');
      expect(rise).toHaveLength(1);
      expect(fall[0] - rise[0], `ctrl=${ctrl}`).toBeCloseTo(width, 7);
    }
  });

  it('current limiter: follows gain·V(IN) under the limit, clamps the current above it', () => {
    for (const [rl, expected] of [
      ['1k', (5 * 1000) / 1001],
      ['100', 10e-3 * 100],
    ] as const) {
      const k = new Bench();
      k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'in', '-': '0' });
      k.part('sources/current-limiter', 'U1', { gain: '1', rout: '1', isource: '10m', isink: '10m' }, { IN: 'in', OUT: 'out' });
      k.part('basic/resistor', 'RL', { value: rl }, { '1': 'out', '2': '0' });
      const [op] = k.run({ type: 'op' });
      expect(op.scalars!['V(out)'], rl).toBeCloseTo(expected, 6);
    }
  });

  it('time delay: the output is the input td later, phase −360°·f·td in AC, gain 1 in DC', () => {
    const k = new Bench();
    k.part('sources/ac-voltage', 'V1', { amplitude: '1', freq: '1k', offset: '0.5' }, { '+': 'in', '-': '0' });
    k.part('sources/delay', 'U1', { td: '0.2m' }, { 'in+': 'in', 'in-': '0', 'out+': 'out', 'out-': '0' });
    k.part('basic/resistor', 'RL', { value: '1k' }, { '1': 'out', '2': '0' });
    const [tr, ac, op] = k.run({ type: 'tran', tstep: 5e-6, tstop: 3e-3 }, { type: 'ac', sweep: 'list', points: 1, fstart: 1e3, fstop: 1e3, list: [1e3] }, { type: 'op' });
    for (const t of [0.7e-3, 1.33e-3, 2.5e-3]) expect(at(tr, 'V(out)', t), `t=${t}`).toBeCloseTo(at(tr, 'V(in)', t - 0.2e-3), 3);
    expect(cmag(ac, 'V(out)', 0)).toBeCloseTo(1, 9);
    expect(cph(ac, 'V(out)', 0)).toBeCloseTo(-72, 6);
    expect(op.scalars!['V(out)']).toBeCloseTo(0.5, 9);
  });

  it('PWM source: pulses of duty·T; bipolar source: +A, gap, −A', () => {
    const k = new Bench();
    k.part('sources/pwm-voltage', 'V1', { freq: '1k', duty: '30', high: '5', low: '0', edge: '10n' }, { '+': 'p', '-': '0' });
    k.part('sources/bipolar-voltage', 'V2', { amplitude: '3', freq: '1k', gap: '0.1m', edge: '1n' }, { '+': 'b', '-': '0' });
    k.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'p', '2': '0' });
    k.part('basic/resistor', 'R2', { value: '1k' }, { '1': 'b', '2': '0' });
    const [tr] = k.run({ type: 'tran', tstep: 5e-6, tstop: 2.9e-3 });
    const fall = crossings(tr, 'V(p)', 2.5, 'fall');
    const rise = crossings(tr, 'V(p)', 2.5, 'rise');
    expect(fall[0]).toBeCloseTo(0.3e-3, 6);
    expect(fall[1] - rise[0]).toBeCloseTo(0.3e-3, 6);
    expect(rise[0]).toBeCloseTo(1e-3, 6);
    expect(at(tr, 'V(b)', 0.2e-3)).toBeCloseTo(3, 6);
    expect(at(tr, 'V(b)', 0.45e-3)).toBeCloseTo(0, 6);
    expect(at(tr, 'V(b)', 0.7e-3)).toBeCloseTo(-3, 6);
    expect(at(tr, 'V(b)', 0.95e-3)).toBeCloseTo(0, 6);
  });
});

describe('control-function blocks', () => {
  it('summer-2 and the VCO / VC sawtooth frequency', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '2' }, { '+': 'a', '-': '0' });
    k.part('sources/dc-voltage', 'V2', { value: '0.5' }, { '+': 'b', '-': '0' });
    k.part('analog/summer-2', 'A1', { ka: '3', kb: '-2', offset: '0.25' }, { A: 'a', B: 'b', OUT: 's' });
    k.part('sources/vc-sawtooth', 'V3', { f0: '1k', kf: '2k', va: '1' }, { 'in+': 'b', 'in-': '0', 'out+': 'saw', 'out-': '0' });
    k.part('analog/vco', 'A2', { f0: '500', kf: '1k', waveform: 'sawtooth' }, { IN: 'b', OUT: 'saw2' });
    const [op, tr] = k.run({ type: 'op' }, { type: 'tran', tstep: 2e-6, tstop: 4.1e-3 });
    expect(op.scalars!['V(s)']).toBeCloseTo(3 * 2 - 2 * 0.5 + 0.25, 9);
    // f = 1k + 2k·0.5 = 2 kHz: the fast return crosses 0 V falling once per period
    const f1 = crossings(tr, 'V(saw)', 0, 'fall');
    expect(f1.length).toBe(8);
    expect(f1[5] - f1[1]).toBeCloseTo(4 / 2e3, 6);
    // the ramp itself: from −1 to +1 over 99 % of the period
    expect(at(tr, 'V(saw)', 0.25e-3 * 0.99)).toBeCloseTo(0, 2);
    const f2 = crossings(tr, 'V(saw2)', 0, 'fall');
    expect(f2[3] - f2[1]).toBeCloseTo(2 / 1e3, 6);
  });

  it('integrator with reset and limits: k·∫V(IN) ramp from ic, held during reset, clamped at the limit', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '1' }, { '+': 'in', '-': '0' });
    // reset pulse 2.0 … 2.5 ms
    k.part('sources/pulse-voltage', 'VR', { v1: '0', v2: '5', delay: '2m', rise: '1u', fall: '1u', width: '0.5m', period: '10' }, { '+': 'rst', '-': '0' });
    k.part('analog/integrator-reset', 'A1', { k: '1k', ic: '0.2', high: '1.5' }, { IN: 'in', RST: 'rst', OUT: 'out' });
    k.part('analog/integrator-reset', 'A2', { k: '-500', ic: '0' }, { IN: 'in', OUT: 'neg' });
    const [tr] = k.run({ type: 'tran', tstep: 5e-6, tstop: 5e-3 });
    // 0.2 V + 1 V/ms
    expect(at(tr, 'V(out)', 0)).toBeCloseTo(0.2, 6);
    expect(at(tr, 'V(out)', 0.5e-3)).toBeCloseTo(0.7, 4);
    expect(at(tr, 'V(out)', 1e-3)).toBeCloseTo(1.2, 4);
    // the 1.5 V limit is reached at 1.3 ms and holds
    expect(at(tr, 'V(out)', 1.8e-3)).toBeCloseTo(1.5, 4);
    // reset: back to ic within microseconds, held until 2.5 ms, then ramps again
    expect(at(tr, 'V(out)', 2.2e-3)).toBeCloseTo(0.2, 3);
    expect(at(tr, 'V(out)', 3e-3)).toBeCloseTo(0.2 + 0.5, 2);
    // no limits: −0.5 V/ms for 5 ms
    expect(at(tr, 'V(neg)', 5e-3)).toBeCloseTo(-2.5, 4);
  });

  it('hysteresis block: DC sweeps up and down draw the loop; the voltage limiter clamps', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '0' }, { '+': 'in', '-': '0' });
    k.part('analog/hysteresis', 'A1', { vlow: '1', vhigh: '2', ylow: '0', yhigh: '5' }, { IN: 'in', OUT: 'h' });
    k.part('analog/limiter', 'A2', { high: '2.5', low: '-1' }, { IN: 'in', OUT: 'lim' });
    const build = k.build();
    const src = build.netlist.elements.find((e) => e.type === 'V')!.name;
    const [up, dn] = runAnalyses({ ...build.netlist, analyses: [{ type: 'dc', src, start: -2, stop: 4, step: 0.25 }, { type: 'dc', src, start: 4, stop: -2, step: -0.25 }] });
    up.scale!.re.forEach((x, i) => {
      expect(vec(up, 'V(h)').re[i], `up ${x}`).toBeCloseTo(x > 2 ? 5 : 0, 6);
      expect(vec(up, 'V(lim)').re[i]).toBeCloseTo(Math.min(2.5, Math.max(-1, x)), 9);
    });
    dn.scale!.re.forEach((x, i) => expect(vec(dn, 'V(h)').re[i], `down ${x}`).toBeCloseTo(x < 1 ? 0 : 5, 6));
  });

  it('slew-rate limiter: a 0 → 5 V step ramps at the rising rate, the fall at the falling rate; a slow sine passes', () => {
    const k = new Bench();
    k.part('sources/pulse-voltage', 'V1', { v1: '0', v2: '5', delay: '1m', rise: '1n', fall: '1n', width: '10m', period: '40m' }, { '+': 'in', '-': '0' });
    k.part('analog/slew-limiter', 'A1', { rise: '1k', fall: '2k' }, { IN: 'in', OUT: 'out' });
    k.part('sources/ac-voltage', 'V2', { amplitude: '0.1', freq: '100' }, { '+': 's', '-': '0' });
    k.part('analog/slew-limiter', 'A2', { rise: '1k', fall: '1k' }, { IN: 's', OUT: 's2' });
    const [tr] = k.run({ type: 'tran', tstep: 20e-6, tstop: 16e-3 });
    // 1 V/ms upwards: 2.5 V at 3.5 ms, 5 V from 6 ms on
    expect(at(tr, 'V(out)', 3.5e-3)).toBeCloseTo(2.5, 3);
    expect(at(tr, 'V(out)', 8e-3)).toBeCloseTo(5, 4);
    // falls from 11 ms at 2 V/ms: 3 V at 12 ms
    expect(at(tr, 'V(out)', 12e-3)).toBeCloseTo(3, 3);
    // 0.1 V at 100 Hz changes at most 63 V/s: unchanged
    expect(at(tr, 'V(s2)', 2.5e-3)).toBeCloseTo(at(tr, 'V(s)', 2.5e-3), 4);
  });

  it('sample-and-hold: edge mode holds the sampled ramp value, track mode follows while the clock is high', () => {
    const k = new Bench();
    k.part('sources/pwl-voltage', 'V1', { points: '0 0, 4m 4' }, { '+': 'in', '-': '0' });
    k.part('sources/pulse-voltage', 'VK', { v1: '0', v2: '5', delay: '0.5m', rise: '1n', fall: '1n', width: '0.25m', period: '1m' }, { '+': 'clk', '-': '0' });
    k.part('analog/sample-hold', 'A1', { mode: 'edge' }, { IN: 'in', CLK: 'clk', OUT: 'e' });
    k.part('analog/sample-hold', 'A2', { mode: 'track' }, { IN: 'in', CLK: 'clk', OUT: 'tk' });
    const [tr] = k.run({ type: 'tran', tstep: 5e-6, tstop: 3e-3 });
    expect(at(tr, 'V(e)', 1.2e-3)).toBeCloseTo(0.5, 4);
    expect(at(tr, 'V(e)', 2.4e-3)).toBeCloseTo(1.5, 4);
    // track: follows during 1.5 … 1.75 ms, holds 1.75 V after the clock falls
    expect(at(tr, 'V(tk)', 1.6e-3)).toBeCloseTo(1.6, 3);
    expect(at(tr, 'V(tk)', 2.2e-3)).toBeCloseTo(1.75, 3);
  });

  it('PWM modulator: duty = (V(IN) − Vmin)/(Vmax − Vmin)', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '2' }, { '+': 'in', '-': '0' });
    k.part('analog/pwm-modulator', 'A1', { freq: '10k', vmin: '0', vmax: '5', edge: '1n' }, { IN: 'in', OUT: 'out' });
    const [tr] = k.run({ type: 'tran', tstep: 1e-6, tstop: 0.35e-3 });
    const fall = crossings(tr, 'V(out)', 2.5, 'fall');
    expect(fall[0]).toBeCloseTo(0.4 * 1e-4, 8);
    expect(fall[2]).toBeCloseTo(2e-4 + 0.4 * 1e-4, 8);
  });
});

describe('interactive DC sources', () => {
  it('step, minimum and maximum come from the instance; the source simulates its value', () => {
    const part = getPart('sources/dc-interactive-voltage')!;
    const idef = part.interactive!;
    const pdef = part.params.find((p) => p.key === 'value');
    expect(nextInteractiveValue(idef, pdef, '5', 'increase', { step: 0.5, min: 0, max: 12 })).toBe('5.5');
    expect(nextInteractiveValue(idef, pdef, '11.8', 'increase', { step: 0.5, min: 0, max: 12 })).toBe('12');
    expect(nextInteractiveValue(idef, pdef, '0.2', 'decrease', { step: 0.5, min: 0, max: 12 })).toBe('0');
    expect(nextInteractiveValue(idef, pdef, '3', 'decrease', { step: 2, min: -10, max: 10 })).toBe('1');
    const k = new Bench();
    k.part('sources/dc-interactive-voltage', 'V1', { value: '7.5' }, { '+': 'a', '-': '0' });
    k.part('sources/dc-interactive-current', 'I1', { value: '2m' }, { '+': 'b', '-': '0' });
    k.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'a', '2': '0' });
    k.part('basic/resistor', 'R2', { value: '1k' }, { '1': 'b', '2': '0' });
    const [op] = k.run({ type: 'op' });
    expect(op.scalars!['V(a)']).toBeCloseTo(7.5, 9);
    // the current leaves through +
    expect(op.scalars!['V(b)']).toBeCloseTo(2, 9);
  });
});

describe('reference grounds', () => {
  /** 10:1 transformer; the secondary load is referenced to `secRef` (a label net). */
  function isolated(secRef: string, extra?: (k: Bench) => void): Bench {
    const k = new Bench();
    k.part('sources/ac-voltage', 'V1', { amplitude: '10', freq: '1k' }, { '+': 'p', '-': '0' });
    k.part('basic/transformer', 'T1', { turns: '10', riso: '0' }, { P1: 'p', P2: '0', S1: 's', S2: secRef });
    k.part('basic/resistor', 'RL', { value: '1k' }, { '1': 's', '2': secRef });
    k.b.part('sources/ground-ref1', 'GND1', 4000, 0);
    k.b.labelPin({ sheet: k.b.design.sheets[0], inst: k.b.design.sheets[0].parts[k.b.design.sheets[0].parts.length - 1] }, '1', secRef);
    extra?.(k);
    return k;
  }

  it('an isolated secondary on Đất tham chiếu 1 solves without a main-ground connection, and probes read against it', () => {
    const k = isolated('sref');
    const pin = k.b.pin({ sheet: k.b.design.sheets[0], inst: k.b.design.sheets[0].parts.find((p) => p.refdes === 'RL')! }, '1');
    k.b.probe('voltage', pin.x, pin.y, 'Vs');
    const build = k.build();
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(build.erc.filter((m) => m.detail?.id === 'refGroundNotIsolated')).toEqual([]);
    expect(build.netlist.elements.some((e) => e.name === 'R_GNDREF1_tie' && e.value === 1e9)).toBe(true);
    const probe = build.probes.find((p) => p.name === 'Vs')!;
    expect(probe.signal).toEqual({ kind: 'voltage', pos: 's', neg: 'GNDREF1' });
    expect(probe.refName).toBe('GNDREF1');
    const [tr] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 5e-6, tstop: 3e-3 }] });
    expect(tr.error).toBeUndefined();
    // 10:1, k = 0.999: about 1 V peak across the 1 kΩ load
    const t = tr.scale!.re;
    const vs = vec(tr, 'V(s)').re;
    const vr = vec(tr, 'V(GNDREF1)').re;
    let peak = 0;
    for (let i = 0; i < t.length; i++) if (t[i] > 1e-3) peak = Math.max(peak, Math.abs(vs[i] - vr[i]));
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThan(1.01);
  });

  it('ERC warns when the reference is joined to the main ground through the circuit', () => {
    const k = isolated('sref', (b) => b.part('basic/resistor', 'RX', { value: '10k' }, { '1': 'sref', '2': '0' }));
    const warn = k.build().erc.filter((m) => m.detail?.id === 'refGroundNotIsolated');
    expect(warn).toHaveLength(1);
    expect(warn[0].severity).toBe('warning');
    expect(warn[0].detail?.params).toEqual({ n: '1', net: 'GNDREF1' });
  });

  it('two different references in one isolated part are reported; a circuit with only a reference ground needs no main ground', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '3' }, { '+': 'a', '-': 'r1' });
    k.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'a', '2': 'r1' });
    k.b.part('sources/ground-ref1', 'GND1', 4000, 0);
    k.b.labelPin({ sheet: k.b.design.sheets[0], inst: k.b.design.sheets[0].parts.at(-1)! }, '1', 'r1');
    const only = k.build();
    expect(only.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const [op] = runAnalyses({ ...only.netlist, analyses: [{ type: 'op' }] });
    expect(op.scalars!['V(a)'] - op.scalars!['V(GNDREF1)']).toBeCloseTo(3, 9);
    k.part('basic/resistor', 'R2', { value: '1k' }, { '1': 'r1', '2': 'r2' });
    k.b.part('sources/ground-ref2', 'GND2', 5000, 0);
    k.b.labelPin({ sheet: k.b.design.sheets[0], inst: k.b.design.sheets[0].parts.at(-1)! }, '1', 'r2');
    const joined = k.build().erc.filter((m) => m.detail?.id === 'refGroundsJoined');
    expect(joined).toHaveLength(1);
    expect(joined[0].detail?.params).toEqual({ nets: 'GNDREF1, GNDREF2' });
  });
});
