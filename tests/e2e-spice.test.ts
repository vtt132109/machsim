/**
 * End-to-end checks of classic SPICE decks (examples/spice/*.cir):
 *   text -> parseSpice -> runAnalyses -> analytic expectations.
 */
import { describe, expect, it } from 'vitest';
import { thermalVoltage } from '../src/sim/device';
import { runAnalyses } from '../src/sim';
import { parseSpice } from '../src/sim/spice';
import type { AnalysisResult } from '../src/sim/results';
import { crossings, interpAt, logCrossing, magnitude, phaseDeg, readExampleText, scale, vector, window } from './helpers';

function runDeck(file: string): AnalysisResult[] {
  const parsed = parseSpice(readExampleText(file), { fileName: file });
  expect(parsed.errors).toEqual([]);
  expect(parsed.netlist.analyses.length).toBe(1);
  const results = runAnalyses(parsed.netlist);
  for (const r of results) expect(r.error).toBeUndefined();
  return results;
}

describe('diode clipper', () => {
  const [r] = runDeck('spice/diode-clipper.cir');
  const t = scale(r);
  const vin = vector(r, 'V(in)').re;
  const vout = vector(r, 'V(out)').re;

  it('clips both half-waves at one diode drop', () => {
    const w = window(t, vout, 1e-3, 3e-3);
    const hi = Math.max(...w);
    const lo = Math.min(...w);
    expect(hi).toBeGreaterThan(0.6);
    expect(hi).toBeLessThan(0.9);
    expect(lo).toBeLessThan(-0.6);
    expect(lo).toBeGreaterThan(-0.9);
    expect(hi + lo).toBeCloseTo(0, 2); // symmetric
  });

  it('passes small signals unchanged and limits large ones', () => {
    // near the zero crossing (|vin| < 0.2 V) the diodes conduct negligibly
    for (const ts of [2e-3, 2.5e-3]) {
      const i = t.findIndex((x) => x >= ts);
      expect(Math.abs(vin[i])).toBeLessThan(0.2);
      expect(vout[i]).toBeCloseTo(vin[i], 2);
    }
    // at the input peak (5 V) the diode current is (5 − Vout)/1k ≈ 4.3 mA
    const vp = interpAt(t, vout, 2.25e-3);
    expect(interpAt(t, vin, 2.25e-3)).toBeCloseTo(5, 3);
    // the diode equation with the deck's model: Vd = N·VT·ln(I/IS) + I·RS
    const id = (5 - vp) / 1000;
    const vd = 1.752 * thermalVoltage(300.15) * Math.log(id / 2.52e-9 + 1) + id * 0.568;
    expect(vp).toBeCloseTo(vd, 2);
  });
});

describe('BJT differential pair', () => {
  const [r] = runDeck('spice/bjt-diff-pair.cir');
  const vid = scale(r);
  const vc1 = vector(r, 'V(c1)').re;
  const vc2 = vector(r, 'V(c2)').re;
  const vt = thermalVoltage(300.15);
  const iTail = 1e-3;
  const rc = 5e3;

  it('is balanced at zero differential input', () => {
    const i0 = vid.findIndex((x) => Math.abs(x) < 1e-9);
    expect(vc1[i0]).toBeCloseTo(vc2[i0], 6);
    // each collector carries ≈ α·ITAIL/2
    expect((12 - vc1[i0]) / rc).toBeGreaterThan(0.49e-3);
    expect((12 - vc1[i0]) / rc).toBeLessThan(0.505e-3);
  });

  it('follows α·ITAIL·RC·tanh(Vid/2VT) and saturates at ±ITAIL·RC', () => {
    const i0 = vid.findIndex((x) => Math.abs(x) < 1e-9);
    const alphaI = (2 * (12 - vc1[i0])) / rc; // α·ITAIL measured at balance
    for (const v of [-0.06, -0.03, -0.01, 0.01, 0.03, 0.06]) {
      const dv = interpAt(vid, vc2, v) - interpAt(vid, vc1, v);
      const expected = alphaI * rc * Math.tanh(v / (2 * vt));
      expect(Math.abs(dv - expected)).toBeLessThan(0.03 * Math.abs(expected) + 0.01);
    }
    expect(vc2[vc2.length - 1] - vc1[vc1.length - 1]).toBeCloseTo(iTail * rc, 0);
    expect(vc2[0] - vc1[0]).toBeCloseTo(-iTail * rc, 0);
    // small-signal differential gain gm·(RC‖ro): gm = IC/VT, ro = (VAF + VCE)/IC (Early effect)
    const k = vid.findIndex((x) => x >= 0.001);
    const gain = (vc2[k] - vc1[k] - (vc2[k - 2] - vc1[k - 2])) / (vid[k] - vid[k - 2]);
    const ic = alphaI / 2;
    const vce = vc1[i0] - vector(r, 'V(e)').re[i0];
    const ro = (74.03 + vce) / ic;
    const expectedGain = (ic / vt) * ((rc * ro) / (rc + ro));
    expect(Math.abs(gain - expectedGain) / expectedGain).toBeLessThan(0.01);
  });
});

describe('CMOS inverter VTC', () => {
  const [r] = runDeck('spice/cmos-inverter-vtc.cir');
  const vin = scale(r);
  const vout = vector(r, 'V(out)').re;

  it('switches at (VDD − |VTP| + VTN)/2 for equal betas', () => {
    // switching threshold: Vout = Vin
    const diff = vout.map((v, i) => v - vin[i]);
    const [vm] = crossings(vin, diff, 0, 'fall');
    expect(vm).toBeCloseTo(2.45, 2);
    expect(interpAt(vin, vout, 0.5)).toBeCloseTo(5, 4);
    expect(interpAt(vin, vout, 4.5)).toBeCloseTo(0, 4);
  });

  it('matches the square-law solution with the NMOS saturated and the PMOS linear', () => {
    // Vin = 2.0 V: βn/2·(Vin − VTN)² = βp·[(Vsg − |VTP|)·Vsd − Vsd²/2]
    const id = 0.5e-3 * (2.0 - 0.7) ** 2;
    const vov = 5 - 2.0 - 0.8;
    const vsd = vov - Math.sqrt(vov * vov - 2 * (id / 1e-3));
    expect(interpAt(vin, vout, 2.0)).toBeCloseTo(5 - vsd, 3);
  });
});

describe('RLC band-pass', () => {
  const [r] = runDeck('spice/rlc-bandpass.cir');
  const f = scale(r);
  const h = magnitude(vector(r, 'V(out)'));
  const ph = phaseDeg(vector(r, 'V(out)'));
  const L = 10e-3;
  const C = 100e-9;
  const R = 100;
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const q = Math.sqrt(L / C) / R;

  it('resonates at 1/(2π√LC) with unity gain and zero phase', () => {
    const [fz] = crossings(f, ph, 0, 'fall');
    expect(Math.abs(fz - f0) / f0).toBeLessThan(0.005);
    expect(Math.max(...h)).toBeGreaterThan(0.999);
    expect(Math.max(...h)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('has the −3 dB bandwidth R/(2πL) and Q = √(L/C)/R', () => {
    const peak = h.indexOf(Math.max(...h));
    const lower = logCrossing(f, h, Math.SQRT1_2);
    const upper = logCrossing(f, h, Math.SQRT1_2, peak + 1);
    const f1 = f0 * (Math.sqrt(1 + 1 / (4 * q * q)) - 1 / (2 * q));
    const f2 = f0 * (Math.sqrt(1 + 1 / (4 * q * q)) + 1 / (2 * q));
    expect(Math.abs(lower - f1) / f1).toBeLessThan(0.01);
    expect(Math.abs(upper - f2) / f2).toBeLessThan(0.01);
    const bw = upper - lower;
    expect(Math.abs(bw - R / (2 * Math.PI * L)) / (R / (2 * Math.PI * L))).toBeLessThan(0.02);
  });
});
