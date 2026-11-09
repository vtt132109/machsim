/**
 * End-to-end physics checks of the shipped examples:
 *   examples/*.msim -> parseDesign -> buildNetlist -> runAnalyses -> assertions against hand
 *   calculations (divider ratio, RC corner, rectifier peak / ripple, CE gain, op-amp gain, 555
 *   frequency, CMOS threshold, decade counter sequence and 7-segment patterns).
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../src/library';
import { buildNetlist } from '../src/model/netlister';
import type { Design } from '../src/model/types';
import { thermalVoltage } from '../src/sim/device';
import { SEGMENT_FONTS } from '../src/sim/devices/digital';
import { runAnalyses } from '../src/sim';
import type { AnalysisSpec, AnalysisType } from '../src/sim/netlist';
import type { AnalysisResult } from '../src/sim/results';
import { parseUserNumber } from '../src/util/units';
import { crossings, interpAt, loadExample, logCrossing, nearestIndex, ratioAt, scale, vector, window } from './helpers';

/** Run one of the design's saved analyses (no ERC errors allowed). */
function run(design: Design, type: AnalysisType): AnalysisResult {
  const build = buildNetlist(design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const spec = design.analysis.specs[type] as AnalysisSpec | undefined;
  if (!spec) throw new Error(`${design.title} has no ${type} analysis`);
  const [result] = runAnalyses({ ...build.netlist, analyses: [spec] });
  expect(result.error).toBeUndefined();
  return result;
}

/** Numeric parameter of a part instance (library default when not set on the instance). */
function partParam(design: Design, refdes: string, key: string): number {
  for (const s of design.sheets) {
    const p = s.parts.find((x) => x.refdes === refdes);
    if (!p) continue;
    const def = getPart(p.partId);
    const text = p.params[key] ?? def?.params.find((d) => d.key === key)?.default;
    const v = parseUserNumber(text ?? '');
    if (!Number.isFinite(v)) throw new Error(`${refdes}.${key} is not a number`);
    return v;
  }
  throw new Error(`no part ${refdes}`);
}

describe('01 voltage divider + multimeter', () => {
  const design = loadExample('01-voltage-divider.msim');

  it('the operating point equals V1·R2/(R1+R2) including the meter resistance', () => {
    const r = run(design, 'op');
    const v1 = partParam(design, 'V1', 'value');
    const r1 = partParam(design, 'R1', 'value');
    const r2 = partParam(design, 'R2', 'value');
    const rm = partParam(design, 'XMM1', 'ri');
    const r2p = (r2 * rm) / (r2 + rm);
    expect(vector(r, 'V(OUT)').re[0]).toBeCloseTo((v1 * r2p) / (r1 + r2p), 9);
    expect(vector(r, 'V(OUT)').re[0]).toBeCloseTo(3.8367, 4);
    expect(vector(r, 'I(V1)').re[0]).toBeCloseTo(-v1 / (r1 + r2p), 12);
  });

  it('the multimeter binding reads the output net', () => {
    const b = buildNetlist(design);
    const xmm = b.instruments.find((i) => i.refdes === 'XMM1');
    expect(xmm?.channels.v).toEqual({ kind: 'voltage', pos: 'OUT', neg: '0' });
  });

  it('the DC sweep is linear with slope R2/(R1+R2)', () => {
    const r = run(design, 'dc');
    const v = vector(r, 'V(OUT)').re;
    const s = scale(r);
    const slope = (v[v.length - 1] - v[0]) / (s[s.length - 1] - s[0]);
    expect(slope).toBeCloseTo(4.7 / 14.7, 5);
  });
});

describe('02 RC low-pass', () => {
  const design = loadExample('02-rc-lowpass.msim');

  it('the −3 dB corner is 1/(2πRC) within 2 %', () => {
    const r = run(design, 'ac');
    const f = scale(r);
    const out = vector(r, 'V(OUT)');
    const inp = vector(r, 'V(IN)');
    const h = new Float64Array(f.length);
    for (let i = 0; i < f.length; i++) h[i] = ratioAt(out, inp, i).mag;
    const fc = logCrossing(f, h, Math.SQRT1_2);
    const expected = 1 / (2 * Math.PI * partParam(design, 'R1', 'value') * partParam(design, 'C1', 'value'));
    expect(Math.abs(fc - expected) / expected).toBeLessThan(0.02);
    expect(fc).toBeGreaterThan(1500);
    expect(fc).toBeLessThan(1700);
    // phase at the corner is −45°
    const i = nearestIndex(f, expected);
    expect(ratioAt(out, inp, i).phaseDeg).toBeCloseTo(-45, 0);
  });

  it('the 1 kHz transient output has the gain and lag of the first-order filter', () => {
    const r = run(design, 'tran');
    const t = scale(r);
    const vin = vector(r, 'V(IN)').re;
    const vout = vector(r, 'V(OUT)').re;
    const wc = 2 * Math.PI * 1591.549;
    const w = 2 * Math.PI * 1000;
    const peak = Math.max(...window(t, vout, 3e-3, 5e-3));
    expect(peak).toBeCloseTo(1 / Math.sqrt(1 + (w / wc) ** 2), 2);
    expect(Math.max(...window(t, vin, 3e-3, 5e-3))).toBeCloseTo(1, 3);
  });
});

describe('03 rectifiers', () => {
  const design = loadExample('03-rectifiers.msim');
  const r = run(design, 'tran');
  const t = scale(r);
  const half = vector(r, 'V(HALF)').re;
  const bridge = vector(r, 'V(BRIDGE)').re;
  const last = (v: Float64Array) => window(t, v, 0.16, 0.2);

  it('half-wave: peak ≈ Vp − Vd and ripple ≈ Vp/(f·R·C)', () => {
    const w = last(half);
    const peak = Math.max(...w);
    const ripple = peak - Math.min(...w);
    expect(peak).toBeGreaterThan(8.8);
    expect(peak).toBeLessThan(9.6);
    const estimate = peak / (50 * 1e3 * 100e-6);
    expect(ripple).toBeGreaterThan(0.7 * estimate);
    expect(ripple).toBeLessThan(1.1 * estimate);
  });

  it('bridge: peak ≈ Vp − 2Vd, ripple about half of the half-wave ripple at twice the frequency', () => {
    const w = last(bridge);
    const peak = Math.max(...w);
    const ripple = peak - Math.min(...w);
    expect(peak).toBeGreaterThan(7.8);
    expect(peak).toBeLessThan(9.0);
    const estimate = peak / (2 * 50 * 1e3 * 100e-6);
    expect(ripple).toBeGreaterThan(0.7 * estimate);
    expect(ripple).toBeLessThan(1.1 * estimate);
    const hw = last(half);
    expect(ripple).toBeLessThan(0.6 * (Math.max(...hw) - Math.min(...hw)));
    // ripple period: the output peaks every 10 ms (bridge) versus every 20 ms (half-wave)
    const mid = (Math.max(...w) + Math.min(...w)) / 2;
    const ups = crossings(t, bridge, mid, 'rise').filter((x) => x > 0.1);
    const upsHalf = crossings(t, half, (Math.max(...hw) + Math.min(...hw)) / 2, 'rise').filter((x) => x > 0.1);
    const period = (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
    const periodHalf = (upsHalf[upsHalf.length - 1] - upsHalf[0]) / (upsHalf.length - 1);
    expect(period).toBeCloseTo(0.01, 3);
    expect(periodHalf).toBeCloseTo(0.02, 3);
  });
});

describe('04 BJT common-emitter amplifier', () => {
  const design = loadExample('04-common-emitter.msim');

  it('the midband gain is within 10 % of −α(RC‖RL)/(VT/IE + RE1)', () => {
    const op = run(design, 'op');
    const ic = vector(op, 'I(RC)').re[0];
    const ie = vector(op, 'I(RE1)').re[0];
    expect(ic).toBeGreaterThan(1.2e-3);
    expect(ic).toBeLessThan(1.8e-3);
    const vt = thermalVoltage(300.15);
    const rc = partParam(design, 'RC', 'value');
    const rl = partParam(design, 'RL', 'value');
    const re1 = partParam(design, 'RE1', 'value');
    const hand = ((ic / ie) * ((rc * rl) / (rc + rl))) / (vt / ie + re1);
    const ac = run(design, 'ac');
    const f = scale(ac);
    const i = nearestIndex(f, 1000);
    const g = ratioAt(vector(ac, 'V(OUT)'), vector(ac, 'V(IN)'), i);
    expect(Math.abs(g.mag - hand) / hand).toBeLessThan(0.1);
    expect(g.mag).toBeGreaterThan(20);
    // inverting: phase ≈ ±180°
    expect(Math.abs(Math.abs(g.phaseDeg) - 180)).toBeLessThan(10);
  });

  it('the transient output is an amplified, inverted copy of the 50 mV input', () => {
    const r = run(design, 'tran');
    const t = scale(r);
    const vin = window(t, vector(r, 'V(IN)').re, 3e-3, 5e-3);
    const vout = window(t, vector(r, 'V(OUT)').re, 3e-3, 5e-3);
    const ppIn = Math.max(...vin) - Math.min(...vin);
    const ppOut = Math.max(...vout) - Math.min(...vout);
    expect(ppIn).toBeCloseTo(0.1, 3);
    expect(ppOut / ppIn).toBeGreaterThan(22);
    expect(ppOut / ppIn).toBeLessThan(32);
  });
});

describe('05 op-amp inverting amplifier', () => {
  const design = loadExample('05-inverting-amplifier.msim');

  it('the 1 kHz gain is −R2/R1 within 1 %', () => {
    const ac = run(design, 'ac');
    const f = scale(ac);
    const i = nearestIndex(f, 1000);
    expect(f[i]).toBeCloseTo(1000, 6);
    const g = ratioAt(vector(ac, 'V(OUT)'), vector(ac, 'V(IN)'), i);
    const ideal = partParam(design, 'R2', 'value') / partParam(design, 'R1', 'value');
    expect(Math.abs(g.mag - ideal) / ideal).toBeLessThan(0.01);
    expect(Math.abs(Math.abs(g.phaseDeg) - 180)).toBeLessThan(2);
  });

  it('the transient output swings ±5 V in antiphase with the input', () => {
    const r = run(design, 'tran');
    const t = scale(r);
    const vin = vector(r, 'V(IN)').re;
    const vout = vector(r, 'V(OUT)').re;
    const wOut = window(t, vout, 2e-3, 5e-3);
    expect(Math.max(...wOut)).toBeCloseTo(5, 1);
    expect(Math.min(...wOut)).toBeCloseTo(-5, 1);
    // at the input's positive peak (t = 2.25 ms) the output is at its negative peak
    expect(interpAt(t, vin, 2.25e-3)).toBeCloseTo(0.5, 2);
    expect(interpAt(t, vout, 2.25e-3)).toBeLessThan(-4.8);
  });
});

describe('06 555 astable LED flasher', () => {
  const design = loadExample('06-555-led-flasher.msim');
  const r = run(design, 'tran');
  const t = scale(r);

  it('oscillates at 1.44/((R1+2R2)C1) within 10 %', () => {
    const out = vector(r, 'V(OUT)').re;
    const ups = crossings(t, out, 4.5, 'rise');
    expect(ups.length).toBeGreaterThanOrEqual(3);
    const period = (ups[ups.length - 1] - ups[1]) / (ups.length - 2);
    const expected = 1.44 / ((partParam(design, 'R1', 'value') + 2 * partParam(design, 'R2', 'value')) * partParam(design, 'C1', 'value'));
    expect(Math.abs(1 / period - expected) / expected).toBeLessThan(0.1);
  });

  it('the timing capacitor swings between VCC/3 and 2·VCC/3', () => {
    const thr = window(t, vector(r, 'V(THR)').re, 1.5, 4);
    expect(Math.max(...thr)).toBeCloseTo(6, 0);
    expect(Math.min(...thr)).toBeCloseTo(3, 0);
  });

  it('the LED current switches between ≈0 and several mA', () => {
    const iled = window(t, vector(r, 'I(V_LED1_i)').re, 1.5, 4);
    expect(Math.max(...iled)).toBeGreaterThan(8e-3);
    expect(Math.max(...iled)).toBeLessThan(25e-3);
    expect(Math.min(...iled)).toBeLessThan(1e-4);
  });
});

describe('07 CMOS inverter', () => {
  const design = loadExample('07-cmos-inverter.msim');

  it('the VTC goes rail to rail and switches at VDD/2 for the symmetric pair', () => {
    const r = run(design, 'dc');
    const vin = scale(r);
    const vout = vector(r, 'V(OUT)').re;
    expect(vout[0]).toBeGreaterThan(4.99);
    expect(vout[vout.length - 1]).toBeLessThan(0.01);
    const [vm] = crossings(vin, vout, 2.5, 'fall');
    expect(vm).toBeCloseTo(2.5, 2);
    let slope = 0;
    for (let i = 1; i < vin.length; i++) slope = Math.max(slope, Math.abs((vout[i] - vout[i - 1]) / (vin[i] - vin[i - 1])));
    expect(slope).toBeGreaterThan(10);
  });
});

describe('08 decade counter with 7-segment display', () => {
  const design = loadExample('08-decade-counter.msim');
  const r = run(design, 'tran');
  const t = scale(r);

  it('counts 0…9 on the falling clock edges and the display shows each digit', () => {
    const clk = vector(r, 'V(CLK)').re;
    const falls = crossings(t, clk, 2.5, 'fall');
    expect(falls.length).toBeGreaterThanOrEqual(11);
    const bits = ['QA', 'QB', 'QC', 'QD'].map((n) => vector(r, `V(${n})`).re);
    const code = vector(r, 'V(U3.code)').re;
    const seen: number[] = [];
    for (let k = 0; k < falls.length; k++) {
      const ts = falls[k] + 0.2; // 0.2 s after the k-th falling edge: k+1 edges counted
      if (ts > t[t.length - 1]) break;
      const value = bits.reduce((acc, v, b) => acc + (interpAt(t, v, ts) > 1.5 ? 1 << b : 0), 0);
      expect(value).toBe((k + 1) % 10);
      const mask = Math.round(interpAt(t, code, ts));
      expect(mask).toBe(SEGMENT_FONTS.ttl7447[value]);
      seen.push(value);
    }
    expect(new Set(seen).size).toBe(10);
  });
});
