/**
 * Analog control code models with memory (analogBlocks.ts) through the real engine: the
 * hysteresis loop in DC sweeps and in a transient, one-shot pulse widths (fixed, voltage
 * controlled, retriggered, cleared), the edge-sampled sample-and-hold and the PWM modulator.
 */
import { describe, expect, it } from 'vitest';
import { findVector, runAnalyses, type AnalysisResult } from '../../index';
import { interpolate, netlist, res, vdc, vsrc } from '../../engine/testing';
import type { AnalysisSpec, ElementIR, ModelCard } from '../../netlist';
import { digitalModelTypes } from './index';

const A = (name: string, nodes: string[], m: string, params: Record<string, number> = {}): ElementIR => ({ type: 'A', name, nodes, model: m, params });
const card = (name: string, type: string, params: Record<string, number> = {}): ModelCard => ({ name, type, params });

function run(elements: ElementIR[], models: ModelCard[], spec: AnalysisSpec): AnalysisResult {
  const r = runAnalyses(netlist(elements, [spec], { models }))[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}
const vec = (r: AnalysisResult, name: string) => {
  const v = findVector(r, name);
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
};
const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name), t);
function crossings(r: AnalysisResult, name: string, level: number, dir: 'rise' | 'fall'): number[] {
  const t = r.scale!.re;
  const v = vec(r, name);
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const up = v[i - 1] < level && v[i] >= level;
    const dn = v[i - 1] > level && v[i] <= level;
    if ((dir === 'rise' && up) || (dir === 'fall' && dn)) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  }
  return out;
}

describe('analog block code models', () => {
  it('registers the four model types', () => {
    for (const t of ['A_HYST', 'A_ONESHOT', 'A_SAH', 'A_PWM']) expect(digitalModelTypes()).toContain(t);
  });

  it('hysteresis: sweeping up switches at vhigh, sweeping down at vlow (the loop)', () => {
    const els = [vdc('VIN', 'in', '0', 0), A('A1', ['in', 'out'], 'hy'), res('RL', 'out', '0', 1e4)];
    const models = [card('hy', 'A_HYST', { vlow: -1, vhigh: 1, ylow: -5, yhigh: 5 })];
    const up = run(els, models, { type: 'dc', src: 'VIN', start: -3, stop: 3, step: 0.25 });
    const dn = run(els, models, { type: 'dc', src: 'VIN', start: 3, stop: -3, step: -0.25 });
    const x = up.scale!.re;
    const yUp = vec(up, 'V(out)');
    const yDn = vec(dn, 'V(out)');
    const xDn = dn.scale!.re;
    for (let i = 0; i < x.length; i++) expect(yUp[i], `up x=${x[i]}`).toBeCloseTo(x[i] > 1 ? 5 : -5, 3);
    for (let i = 0; i < xDn.length; i++) expect(yDn[i], `down x=${xDn[i]}`).toBeCloseTo(xDn[i] < -1 ? -5 : 5, 3);
    // inside the band the two directions disagree: that is the hysteresis
    const mid = x.findIndex((v) => Math.abs(v) < 1e-12);
    expect(yUp[mid]).toBeCloseTo(-5, 3);
    expect(yDn[xDn.findIndex((v) => Math.abs(v) < 1e-12)]).toBeCloseTo(5, 3);
  });

  it('hysteresis in a transient: a 1 kHz, 2 V sine switches at the threshold crossings', () => {
    const f = 1e3;
    const els = [vsrc('VIN', 'in', '0', { dc: 0, tran: { type: 'SIN', args: [0, 2, f] } }), A('A1', ['in', 'out'], 'hy'), res('RL', 'out', '0', 1e4)];
    const r = run(els, [card('hy', 'A_HYST', { vlow: -1, vhigh: 1, ylow: 0, yhigh: 5, edge: 1e-7 })], { type: 'tran', tstep: 1e-6, tstop: 2e-3 });
    // 2 sin(2π f t) = 1 at t = asin(0.5)/(2π f) = T/12; = -1 at T/2 + T/12
    const T = 1 / f;
    const rise = crossings(r, 'V(out)', 2.5, 'rise');
    const fall = crossings(r, 'V(out)', 2.5, 'fall');
    expect(rise[0]).toBeCloseTo(T / 12 + 0.5e-7, 6);
    expect(fall[0]).toBeCloseTo(T / 2 + T / 12 + 0.5e-7, 6);
    expect(rise[1]).toBeCloseTo(T + T / 12 + 0.5e-7, 6);
  });

  it('one-shot: a trigger edge gives one pulse of the set width (50 % to 50 %)', () => {
    const trig = vsrc('VT', 'trig', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 1e-3, 1e-6, 1e-6, 0.2e-3, 10] } });
    const els = [trig, A('A1', ['trig', 'null', 'null', 'out'], 'os'), res('RL', 'out', '0', 1e4)];
    const r = run(els, [card('os', 'A_ONESHOT', { pw: 2e-3, edge: 1e-6 })], { type: 'tran', tstep: 1e-5, tstop: 6e-3 });
    const rise = crossings(r, 'V(out)', 2.5, 'rise');
    const fall = crossings(r, 'V(out)', 2.5, 'fall');
    expect(rise).toHaveLength(1);
    expect(fall).toHaveLength(1);
    // the trigger crosses 2.5 V half way up its 1 µs edge
    expect(rise[0]).toBeGreaterThan(1e-3);
    expect(rise[0]).toBeLessThan(1.003e-3);
    expect(fall[0] - rise[0]).toBeCloseTo(2e-3, 7);
    expect(at(r, 'V(out)', 0.5e-3)).toBeCloseTo(0, 4);
    expect(at(r, 'V(out)', 2e-3)).toBeCloseTo(5, 3);
  });

  it('one-shot: the width follows the control voltage (W = pw + kpw·V(cntl))', () => {
    for (const vc of [0.5, 1.5, 3]) {
      const trig = vsrc('VT', 'trig', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 1e-3, 1e-6, 1e-6, 0.1e-3, 10] } });
      const els = [trig, vdc('VC', 'c', '0', vc), A('A1', ['trig', 'c', 'null', 'out'], 'os'), res('RL', 'out', '0', 1e4)];
      const r = run(els, [card('os', 'A_ONESHOT', { pw: 0, kpw: 1e-3, edge: 1e-6 })], { type: 'tran', tstep: 1e-5, tstop: 6e-3 });
      const rise = crossings(r, 'V(out)', 2.5, 'rise');
      const fall = crossings(r, 'V(out)', 2.5, 'fall');
      expect(fall[0] - rise[0], `vc=${vc}`).toBeCloseTo(vc * 1e-3, 7);
    }
  });

  it('one-shot: retriggering extends the pulse, clear ends it', () => {
    // triggers at 1 ms and 2 ms, width 1.5 ms
    const trig = vsrc('VT', 'trig', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 1e-3, 1e-6, 1e-6, 0.1e-3, 1e-3] } });
    const els = [trig, A('A1', ['trig', 'null', 'null', 'out'], 'os'), res('RL', 'out', '0', 1e4)];
    const plain = run(els, [card('os', 'A_ONESHOT', { pw: 1.5e-3, edge: 1e-6 })], { type: 'tran', tstep: 1e-5, tstop: 2.4e-3 });
    const retr = run(els, [card('os', 'A_ONESHOT', { pw: 1.5e-3, edge: 1e-6, retrig: 1 })], { type: 'tran', tstep: 1e-5, tstop: 4e-3 });
    // not retriggerable: the trigger at 2 ms (during the pulse) is ignored, the pulse ends at 2.5 ms
    expect(at(plain, 'V(out)', 2.3e-3)).toBeCloseTo(5, 3);
    // retriggerable: 1.5 ms after the last trigger (the 3 ms trigger keeps extending it)
    expect(at(retr, 'V(out)', 2.8e-3)).toBeCloseTo(5, 3);
    const clr = vsrc('VR', 'clr', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 1.5e-3, 1e-6, 1e-6, 0.1e-3, 10] } });
    const cleared = run([trig, clr, A('A1', ['trig', 'null', 'clr', 'out'], 'os'), res('RL', 'out', '0', 1e4)], [card('os', 'A_ONESHOT', { pw: 3e-3, edge: 1e-6 })], {
      type: 'tran',
      tstep: 1e-5,
      tstop: 1.9e-3,
    });
    const fall = crossings(cleared, 'V(out)', 2.5, 'fall');
    expect(fall[0]).toBeCloseTo(1.5e-3, 5);
  });

  it('sample-and-hold: holds the input value of every rising clock edge', () => {
    // input ramp 1 V/ms, clock rising (2.5 V) at 0.5 ms, 1.5 ms, 2.5 ms
    const vin = vsrc('VIN', 'in', '0', { dc: 0, tran: { type: 'PWL', args: [0, 0, 4e-3, 4] } });
    const clk = vsrc('VK', 'clk', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 0.5e-3 - 0.5e-7, 1e-7, 1e-7, 0.5e-3, 1e-3] } });
    const els = [vin, clk, A('A1', ['in', 'clk', 'out'], 'sh'), res('RL', 'out', '0', 1e4)];
    const r = run(els, [card('sh', 'A_SAH', { edge: 1e-7 })], { type: 'tran', tstep: 1e-5, tstop: 3e-3 });
    expect(at(r, 'V(out)', 0.2e-3)).toBeCloseTo(0, 4);
    expect(at(r, 'V(out)', 1.2e-3)).toBeCloseTo(0.5, 4);
    expect(at(r, 'V(out)', 1.9e-3)).toBeCloseTo(1.5, 4);
    expect(at(r, 'V(out)', 2.9e-3)).toBeCloseTo(2.5, 4);
  });

  it('PWM: the pulse width is D·T with D from the input voltage', () => {
    for (const vin of [0.25, 0.6]) {
      const els = [vdc('VIN', 'in', '0', vin), A('A1', ['in', 'out'], 'pw'), res('RL', 'out', '0', 1e4)];
      const r = run(els, [card('pw', 'A_PWM', { freq: 1e3, vmin: 0, vmax: 1, edge: 1e-7 })], { type: 'tran', tstep: 1e-5, tstop: 3.9e-3 });
      const rise = crossings(r, 'V(out)', 2.5, 'rise');
      const fall = crossings(r, 'V(out)', 2.5, 'fall');
      // periods start at 0, 1, 2, 3 ms (the first rise is the operating point itself)
      expect(fall.length).toBe(4);
      for (let k = 0; k < fall.length; k++) expect(fall[k], `vin=${vin} k=${k}`).toBeCloseTo(k * 1e-3 + vin * 1e-3 + 0.5e-7, 7);
      expect(rise[0]).toBeCloseTo(1e-3 + 0.5e-7, 7);
    }
  });

  it('PWM without input: sine-modulated duty around the set duty cycle', () => {
    const els = [A('A1', ['null', 'out'], 'pw'), res('RL', 'out', '0', 1e4)];
    const r = run(els, [card('pw', 'A_PWM', { freq: 10e3, duty: 0.5, mod: 0.5, fmod: 250, edge: 1e-8 })], { type: 'tran', tstep: 1e-6, tstop: 4e-3 });
    const rise = [0, ...crossings(r, 'V(out)', 2.5, 'rise')];
    const fall = crossings(r, 'V(out)', 2.5, 'fall');
    // period k starts at k·0.1 ms; D = 0.5 + 0.25 sin(2π·250·t_k)
    for (let k = 0; k < 20; k++) {
      const tk = k * 1e-4;
      const d = 0.5 + 0.25 * Math.sin(2 * Math.PI * 250 * tk);
      expect(fall[k] - (k === 0 ? 0 : rise[k]), `k=${k}`).toBeCloseTo(d * 1e-4 + (k === 0 ? 0.5e-8 : 0), 8);
    }
  });
});
