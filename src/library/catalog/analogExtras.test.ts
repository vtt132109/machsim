/**
 * Round-3 analog ICs and blocks in small benches against their defining relations: OTA gain
 * gm·RL with gm = IABC/(2·VT) (proportional to the bias current, output current limited to
 * ±IABC), current-feedback bandwidth set by RF (nearly independent of the gain), PLL lock inside
 * its hold-in range (VCTRL = (fin − f0)/kv, output at the input frequency) and no lock outside,
 * isolation-amplifier gain across a 100 V common-mode offset, difference amplifiers, the new
 * instrumentation amplifiers' gain equations and the gate drivers' delay and 2.2·ROH·C edges.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { pllHoldRange } from './analogExtras';

class Bench {
  readonly b = new DesignBuilder('bench');
  private x = 0;
  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string>): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }
  supplies(v = 15) {
    this.part('sources/dc-voltage', 'VP', { value: String(v) }, { '+': 'vcc', '-': '0' });
    this.part('sources/dc-voltage', 'VN', { value: String(v) }, { '+': '0', '-': 'vee' });
  }
  run(...analyses: AnalysisSpec[]): AnalysisResult[] {
    const build = buildNetlist(this.b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
    const res = runAnalyses({ ...build.netlist, analyses });
    for (const r of res) expect(r.error, r.error).toBeUndefined();
    return res;
  }
}

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
};
const mag = (r: AnalysisResult, name: string, i: number) => Math.hypot(vec(r, name).re[i], vec(r, name).im?.[i] ?? 0);
const op = (r: AnalysisResult, name: string) => r.scalars![name];

/** Linear-interpolated times where a vector crosses `level` going up. */
function rising(r: AnalysisResult, name: string, level: number, from = 0): number[] {
  const t = r.scale!.re;
  const v = vec(r, name).re;
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) if (t[i] >= from && v[i - 1] < level && v[i] >= level) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  return out;
}
function falling(r: AnalysisResult, name: string, level: number, from = 0): number[] {
  const t = r.scale!.re;
  const v = vec(r, name).re;
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) if (t[i] >= from && v[i - 1] > level && v[i] <= level) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  return out;
}

const VT = 8.617333e-5 * (27 + 273.15);

describe('OTA', () => {
  function otaGain(id: string, iabc: string): number {
    const k = new Bench();
    k.supplies(12);
    k.part('sources/ac-voltage', 'VIN', { amplitude: '0', acmag: '1' }, { '+': 'in', '-': '0' });
    k.part('sources/dc-current', 'IB', { value: iabc }, { '+': 'iabc', '-': '0' });
    k.part(id, 'U1', {}, { 'IN+': 'in', 'IN-': '0', IABC: 'iabc', OUT: 'out', 'V+': 'vcc', 'V-': 'vee' });
    k.part('basic/resistor', 'RL', { value: '10k' }, { '1': 'out', '2': '0' });
    const [ac] = k.run({ type: 'ac', sweep: 'list', points: 1, fstart: 1e3, fstop: 1e3, list: [1e3] });
    return mag(ac, 'V(out)', 0);
  }

  it('gain = gm·(RL ∥ Rout) with gm = IABC/(2·VT): proportional to the bias current', () => {
    const rl = (10e3 * 15e6) / (10e3 + 15e6);
    const g100 = otaGain('analog/ota', '100u');
    const g200 = otaGain('analog/ota', '200u');
    expect(g100).toBeCloseTo((100e-6 / (2 * VT)) * rl, 3);
    expect(g200 / g100).toBeCloseTo(2, 4);
    expect(otaGain('analog/ota', '10u') / g100).toBeCloseTo(0.1, 4);
    expect(otaGain('analog/lm13700', '500u') / otaGain('analog/lm13700', '50u')).toBeCloseTo(10, 2);
  });

  it('a large input saturates the output current at ±IABC; the bias pin sits two diode drops above V−', () => {
    const k = new Bench();
    k.supplies(12);
    k.part('sources/dc-voltage', 'VIN', { value: '0.5' }, { '+': 'in', '-': '0' });
    k.part('sources/dc-current', 'IB', { value: '100u' }, { '+': 'iabc', '-': '0' });
    k.part('analog/ca3080', 'U1', {}, { 'IN+': 'in', 'IN-': '0', IABC: 'iabc', OUT: 'out', 'V+': 'vcc', 'V-': 'vee' });
    k.part('basic/resistor', 'RL', { value: '10k' }, { '1': 'out', '2': '0' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(out)')).toBeCloseTo(100e-6 * ((10e3 * 15e6) / (10e3 + 15e6)), 3);
    expect(op(r, 'V(iabc)') + 12).toBeGreaterThan(1.0);
    expect(op(r, 'V(iabc)') + 12).toBeLessThan(1.4);
  });
});

describe('current-feedback amplifier', () => {
  function bandwidth(rg: string): { g0: number; f3: number } {
    const k = new Bench();
    k.supplies(15);
    k.part('sources/ac-voltage', 'VIN', { amplitude: '0', acmag: '1' }, { '+': 'in', '-': '0' });
    k.part('analog/cfoa', 'U1', {}, { 'IN+': 'in', 'IN-': 'n', OUT: 'out', 'V+': 'vcc', 'V-': 'vee' });
    k.part('basic/resistor', 'RF', { value: '1k' }, { '1': 'out', '2': 'n' });
    k.part('basic/resistor', 'RG', { value: rg }, { '1': 'n', '2': '0' });
    k.part('basic/resistor', 'RL', { value: '1k' }, { '1': 'out', '2': '0' });
    const fs = Array.from({ length: 401 }, (_, i) => 1e5 * Math.pow(10, (4 * i) / 400));
    const [ac] = k.run({ type: 'ac', sweep: 'list', points: fs.length, fstart: fs[0], fstop: fs[fs.length - 1], list: fs });
    const g = fs.map((_, i) => mag(ac, 'V(out)', i));
    const target = g[0] / Math.SQRT2;
    const i = g.findIndex((x) => x < target);
    const f3 = fs[i - 1] * Math.pow(fs[i] / fs[i - 1], (g[i - 1] - target) / (g[i - 1] - g[i]));
    return { g0: g[0], f3 };
  }

  it('closed-loop bandwidth ≈ 1/(2π·CT·(RF + G·RINV)), almost independent of the gain', () => {
    const g2 = bandwidth('1k');
    const g10 = bandwidth('111.11');
    expect(g2.g0).toBeCloseTo(2, 2);
    expect(g10.g0).toBeCloseTo(10, 1);
    const pred = (g: number) => 1 / (2 * Math.PI * 4.5e-12 * (1e3 + g * 50));
    expect(g2.f3 / pred(2)).toBeGreaterThan(0.9);
    expect(g2.f3 / pred(2)).toBeLessThan(1.1);
    expect(g10.f3 / pred(10)).toBeGreaterThan(0.9);
    expect(g10.f3 / pred(10)).toBeLessThan(1.1);
    // a voltage-feedback amplifier would lose 5× bandwidth from G = 2 to G = 10; the CFA loses ~27 %
    expect(g10.f3 / g2.f3).toBeGreaterThan(0.65);
    expect(g10.f3 / g2.f3).toBeLessThan(0.8);
  });
});

describe('PLL', () => {
  function runPll(fin: number) {
    const k = new Bench();
    k.part('sources/ac-voltage', 'VIN', { amplitude: '1', freq: String(fin) }, { '+': 'in', '-': '0' });
    k.part('analog/pll', 'U1', {}, { IN: 'in', OUT: 'out', VC: 'vc' });
    k.part('basic/resistor', 'RL', { value: '10k' }, { '1': 'out', '2': '0' });
    const [tr] = k.run({ type: 'tran', tstep: 1e-6, tstop: 25e-3, tmax: 1e-6 });
    const t = tr.scale!.re;
    const vc = vec(tr, 'V(vc)').re;
    let sum = 0;
    let n = 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i] < 15e-3) continue;
      sum += 0.5 * (vc[i] + vc[i - 1]) * (t[i] - t[i - 1]);
      n += t[i] - t[i - 1];
    }
    const edges = rising(tr, 'V(out)', 2.5, 15e-3);
    const fout = (edges.length - 1) / (edges[edges.length - 1] - edges[0]);
    return { vc: sum / n, fout };
  }

  it('locks inside the hold-in range: output at the input frequency, VCTRL = (fin − f0)/kv', () => {
    expect(pllHoldRange(1, 2e3)).toBeCloseTo(1273.24, 1);
    for (const fin of [10.3e3, 9.6e3]) {
      const r = runPll(fin);
      expect(r.fout / fin, `fin=${fin}`).toBeCloseTo(1, 3);
      expect(r.vc, `fin=${fin}`).toBeCloseTo((fin - 10e3) / 2e3, 2);
    }
  });

  it('does not lock outside it', () => {
    const r = runPll(13e3);
    expect(Math.abs(r.fout - 13e3) / 13e3).toBeGreaterThan(0.05);
  });
});

describe('isolation and difference amplifiers', () => {
  it('isolation amplifier: gain across a 100 V offset between the grounds, barrier leakage only', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'VCM', { value: '100' }, { '+': 'g1', '-': '0' });
    k.part('sources/dc-voltage', 'VD', { value: '1.5' }, { '+': 'ip', '-': 'g1' });
    k.part('analog/isolation-amplifier', 'U1', { gain: '2' }, { 'IN+': 'ip', 'IN-': 'g1', GND1: 'g1', OUT: 'out', GND2: '0' });
    k.part('basic/resistor', 'RL', { value: '10k' }, { '1': 'out', '2': '0' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(out)')).toBeCloseTo(3 * (10e3 / (10e3 + 0.1)), 6);
    // the 100 V common-mode source only feeds the barrier (1 TΩ): 0.1 nA
    expect(Math.abs(op(r, 'I(VCM)'))).toBeLessThan(2e-10);
    const ac = new Bench();
    ac.part('sources/ac-voltage', 'VD', { amplitude: '0', acmag: '1' }, { '+': 'ip', '-': '0' });
    ac.part('analog/isolation-amplifier', 'U1', { bw: '50k' }, { 'IN+': 'ip', 'IN-': '0', GND1: '0', OUT: 'out', GND2: '0' });
    const [a] = ac.run({ type: 'ac', sweep: 'list', points: 2, fstart: 1e3, fstop: 50e3, list: [1e3, 50e3] });
    expect(mag(a, 'V(out)', 0)).toBeCloseTo(1 / Math.hypot(1, 1e3 / 50e3), 4);
    expect(mag(a, 'V(out)', 1)).toBeCloseTo(1 / Math.SQRT2, 4);
  });

  it('difference amplifiers: G·(V+ − V−) + V(REF), SENSE tied to OUT when open', () => {
    const k = new Bench();
    k.supplies(15);
    k.part('sources/dc-voltage', 'VA', { value: '3' }, { '+': 'a', '-': '0' });
    k.part('sources/dc-voltage', 'VB', { value: '1' }, { '+': 'b', '-': '0' });
    k.part('sources/dc-voltage', 'VR', { value: '0.5' }, { '+': 'ref', '-': '0' });
    k.part('analog/ina105', 'U1', {}, { 'IN+': 'a', 'IN-': 'b', REF: 'ref', OUT: 'o1', 'V+': 'vcc', 'V-': 'vee' });
    k.part('sources/dc-voltage', 'VC', { value: '1.2' }, { '+': 'c', '-': '0' });
    k.part('analog/ina106', 'U2', {}, { 'IN+': 'c', 'IN-': 'b', REF: '0', OUT: 'o2', SENSE: 'o2', 'V+': 'vcc', 'V-': 'vee' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(o1)')).toBeCloseTo(2.5, 3);
    // (VOS 50 µV × noise gain 11 = 0.55 mV)
    expect(op(r, 'V(o2)')).toBeCloseTo(2, 2);
  });

  it('the new instrumentation amplifiers follow their gain equations', () => {
    const k = new Bench();
    k.supplies(15);
    k.part('sources/dc-voltage', 'VD', { value: '10m' }, { '+': 'p', '-': 'n' });
    k.part('basic/resistor', 'RN', { value: '1k' }, { '1': 'n', '2': '0' });
    const rows: [string, number, number][] = [
      ['analog/ad8421', 9.9e3, 99],
      ['analog/ad623', 100e3, 1e3],
      ['analog/ina819', 50e3, 500],
    ];
    rows.forEach(([id, num, rg], i) => {
      k.part(id, `U${i + 1}`, {}, { 'IN+': 'p', 'IN-': 'n', RG1: `g${i}a`, RG2: `g${i}b`, REF: '0', OUT: `o${i}`, 'V+': 'vcc', 'V-': 'vee' });
      k.part('basic/resistor', `RG${i}`, { value: String(rg) }, { '1': `g${i}a`, '2': `g${i}b` });
      expect(1 + num / rg).toBeCloseTo(101, 6);
    });
    const [r] = k.run({ type: 'op' });
    for (let i = 0; i < rows.length; i++) expect(op(r, `V(o${i})`) / 10e-3, rows[i][0]).toBeCloseTo(101, 0);
  });
});

describe('gate drivers', () => {
  function drive(id: string) {
    const k = new Bench();
    k.part('sources/dc-voltage', 'VDD', { value: '12' }, { '+': 'vdd', '-': '0' });
    k.part('sources/pulse-voltage', 'VIN', { v1: '0', v2: '5', delay: '100n', rise: '1n', fall: '1n', width: '100n', period: '1' }, { '+': 'in', '-': '0' });
    k.part(id, 'U1', {}, { IN: 'in', OUT: 'g', VDD: 'vdd', GND: '0' });
    k.part('basic/capacitor', 'CG', { value: '1n' }, { '1': 'g', '2': '0' });
    const [tr] = k.run({ type: 'tran', tstep: 0.05e-9, tstop: 300e-9, tmax: 0.05e-9 });
    return tr;
  }

  it('TC4420 into 1 nF: delay ≈ tpd + 0.69·ROH·C, rise 10–90 % ≈ 2.2·ROH·C', () => {
    const tr = drive('misc/tc4420');
    const t10 = rising(tr, 'V(g)', 1.2)[0];
    const t50 = rising(tr, 'V(g)', 6)[0];
    const t90 = rising(tr, 'V(g)', 10.8)[0];
    const tin = 100e-9 + 0.5e-9;
    expect((t50 - tin) / (25e-9 + Math.LN2 * 2.8 * 1e-9)).toBeGreaterThan(0.93);
    expect((t50 - tin) / (25e-9 + Math.LN2 * 2.8 * 1e-9)).toBeLessThan(1.07);
    expect((t90 - t10) / (2.2 * 2.8e-9)).toBeGreaterThan(0.9);
    expect((t90 - t10) / (2.2 * 2.8e-9)).toBeLessThan(1.12);
    // pull-down through ROL after the falling input edge
    const f90 = falling(tr, 'V(g)', 10.8, 200e-9)[0];
    const f10 = falling(tr, 'V(g)', 1.2, 200e-9)[0];
    expect((f10 - f90) / (2.2 * 2.5e-9)).toBeGreaterThan(0.9);
    expect((f10 - f90) / (2.2 * 2.5e-9)).toBeLessThan(1.12);
  });

  it('TC4429 inverts; the half-bridge driver refers HO to VS', () => {
    const tr = drive('misc/tc4429');
    const g = vec(tr, 'V(g)').re;
    expect(g[0]).toBeCloseTo(12, 2);
    expect(falling(tr, 'V(g)', 6).length).toBeGreaterThan(0);
    const k = new Bench();
    k.part('sources/dc-voltage', 'VCC', { value: '12' }, { '+': 'vcc', '-': '0' });
    k.part('sources/dc-voltage', 'VS', { value: '50' }, { '+': 'vs', '-': '0' });
    k.part('sources/dc-voltage', 'VBS', { value: '12' }, { '+': 'vb', '-': 'vs' });
    k.part('sources/dc-voltage', 'VH', { value: '5' }, { '+': 'hin', '-': '0' });
    k.part('misc/half-bridge-driver', 'U1', {}, { HIN: 'hin', LIN: '0', VCC: 'vcc', COM: '0', VB: 'vb', HO: 'ho', VS: 'vs', LO: 'lo' });
    k.part('basic/resistor', 'RH', { value: '10k' }, { '1': 'ho', '2': 'vs' });
    k.part('basic/resistor', 'RLO', { value: '10k' }, { '1': 'lo', '2': '0' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(ho)')).toBeCloseTo(62 - (12 * 5) / (10e3 + 5), 2);
    expect(op(r, 'V(lo)')).toBeCloseTo(0, 3);
  });
});

describe('wideband voltage-feedback op-amps', () => {
  it('OPA656 at G = 10 has about GBW/10 of bandwidth', () => {
    const k = new Bench();
    k.supplies(5);
    k.part('sources/ac-voltage', 'VIN', { amplitude: '0', acmag: '1' }, { '+': 'in', '-': '0' });
    k.part('analog/opa656', 'U1', {}, { 'IN+': 'in', 'IN-': 'n', OUT: 'out', 'V+': 'vcc', 'V-': 'vee' });
    k.part('basic/resistor', 'RF', { value: '900' }, { '1': 'out', '2': 'n' });
    k.part('basic/resistor', 'RG', { value: '100' }, { '1': 'n', '2': '0' });
    const [ac] = k.run({ type: 'ac', sweep: 'list', points: 2, fstart: 1e3, fstop: 23e6, list: [1e3, 23e6] });
    expect(mag(ac, 'V(out)', 0)).toBeCloseTo(10 / (1 + 10 / 1.8e3), 1);
    expect(mag(ac, 'V(out)', 1) / mag(ac, 'V(out)', 0)).toBeGreaterThan(0.6);
    expect(mag(ac, 'V(out)', 1) / mag(ac, 'V(out)', 0)).toBeLessThan(0.8);
  });
});
