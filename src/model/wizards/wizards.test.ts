/**
 * Circuit wizards: every generated design netlists without ERC problems, simulates, and meets
 * its design target — the simulator is compared with the wizard's own prediction (computed from
 * the rounded part values) and with the learner's specification.
 */
import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../netlister';
import type { Design } from '../types';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import {
  WizardInputError,
  bandEdges,
  design555Astable,
  design555Monostable,
  designCommonEmitter,
  designFilter,
  designOpampStage,
  filterOrder,
  ladderValues,
  prototypePoles,
  qOf,
  roundValue,
  type FilterSpec,
  type OpampStageSpec,
} from './index';

function simulate(d: Design, type: 'op' | 'tran' | 'ac'): AnalysisResult {
  const b = buildNetlist(d, { includeAnalysis: false });
  expect(b.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const spec = d.analysis.specs[type];
  if (!spec) throw new Error(`${d.title}: no ${type} analysis`);
  const [r] = runAnalyses({ ...b.netlist, analyses: [spec] });
  expect(r.error).toBeUndefined();
  return r;
}

function vec(r: AnalysisResult, name: string) {
  const v = r.vectors.find((x) => x.name.toUpperCase() === name.toUpperCase());
  if (!v) throw new Error(`no ${name} in ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
}

/** ERC warnings other than the expected ones (instrument terminals left open are fine). */
function ercWarnings(d: Design): string[] {
  return buildNetlist(d, { includeAnalysis: false }).erc.map((m) => m.message);
}

/** Interpolated crossings of `level` (rising when dir > 0). */
function crossings(t: ArrayLike<number>, v: ArrayLike<number>, level: number, dir: 1 | -1): number[] {
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const a = v[i - 1] - level;
    const b = v[i] - level;
    if ((dir > 0 && a < 0 && b >= 0) || (dir < 0 && a > 0 && b <= 0)) out.push(t[i - 1] + ((t[i] - t[i - 1]) * a) / (a - b));
  }
  return out;
}

describe('value rounding', () => {
  it('rounds to the E series or 4 significant digits', () => {
    expect(roundValue(4612, 'E24')).toBe(4700);
    expect(roundValue(4612, 'E12')).toBe(4700);
    expect(roundValue(1.234567e-8, 'exact')).toBe(1.235e-8);
    expect(roundValue(10.2e3, 'E96')).toBe(10.2e3);
  });
});

describe('555 timer wizard', () => {
  const cases = [
    { freq: 1000, duty: 0.7, vcc: 9 },
    { freq: 100, duty: 0.3, vcc: 12 },
    { freq: 5000, duty: 0.5, vcc: 5 },
  ];
  for (const spec of cases) {
    it(`astable ${spec.freq} Hz, ${spec.duty * 100} % at ${spec.vcc} V oscillates at the target`, () => {
      const res = design555Astable(spec);
      expect(ercWarnings(res.design)).toEqual([]);
      const r = simulate(res.design, 'tran');
      const t = r.scale!.re;
      const out = vec(r, 'V(OUT)').re;
      const rises = crossings(t, out, spec.vcc / 2, 1);
      const falls = crossings(t, out, spec.vcc / 2, -1);
      expect(rises.length).toBeGreaterThanOrEqual(8);
      // skip the first (longer) cycle that starts from an empty capacitor
      const period = (rises[rises.length - 1] - rises[1]) / (rises.length - 2);
      const high = falls.filter((f) => f > rises[1]).slice(0, rises.length - 2).map((f, k) => f - rises[1 + k]);
      const duty = high.reduce((a, b) => a + b, 0) / high.length / period;
      const fPred = res.predicted[0].value;
      expect(Math.abs(1 / period / fPred - 1)).toBeLessThan(0.03);
      expect(Math.abs(1 / period / spec.freq - 1)).toBeLessThan(0.05);
      expect(Math.abs(duty - spec.duty)).toBeLessThan(0.04);
    });
  }

  it('picks the diode circuit for duty cycles below 60 % and refuses impossible ones', () => {
    const low = design555Astable({ freq: 100, duty: 0.3, vcc: 12 });
    expect(low.parts.some((p) => p.refdes === 'D1')).toBe(true);
    const std = design555Astable({ freq: 100, duty: 0.75, vcc: 12 });
    expect(std.parts.some((p) => p.refdes === 'D1')).toBe(false);
    expect(() => design555Astable({ freq: 100, duty: 0.4, vcc: 12, variant: 'standard' })).toThrow(WizardInputError);
    expect(() => design555Astable({ freq: 0, duty: 0.6, vcc: 9 })).toThrow(WizardInputError);
    // a learner-chosen capacitor is kept
    const fixed = design555Astable({ freq: 1000, duty: 0.7, vcc: 9, cap: 22e-9 });
    expect(fixed.parts.find((p) => p.refdes === 'C1')?.value).toBe('22n');
  });

  it('monostable pulse width matches T = ln3·R·C', () => {
    const res = design555Monostable({ width: 1e-3, vcc: 9 });
    const r = simulate(res.design, 'tran');
    const t = r.scale!.re;
    const out = vec(r, 'V(OUT)').re;
    const rises = crossings(t, out, 4.5, 1);
    const falls = crossings(t, out, 4.5, -1);
    expect(rises.length).toBeGreaterThanOrEqual(3);
    const widths = rises.map((r0) => (falls.find((f) => f > r0) ?? NaN) - r0).filter(Number.isFinite);
    for (const w of widths) {
      expect(Math.abs(w / res.predicted[0].value - 1)).toBeLessThan(0.02);
      expect(Math.abs(w / 1e-3 - 1)).toBeLessThan(0.05);
    }
  });
});

describe('op-amp stage wizard', () => {
  const cases: OpampStageSpec[] = [
    { kind: 'inverting', gain: 10, inputs: [{ amplitude: 0.5, freq: 1000 }] },
    { kind: 'noninverting', gain: 3, inputs: [{ amplitude: 1, freq: 1000 }] },
    { kind: 'noninverting', gain: 1, inputs: [{ amplitude: 1, freq: 1000 }] },
    { kind: 'difference', gain: 2, inputs: [{ amplitude: 1, freq: 1000 }, { amplitude: 0.5, freq: 3000 }] },
    { kind: 'summing', gain: 2, inputs: [{ amplitude: 1, freq: 1000 }, { amplitude: 0.5, freq: 0 }, { amplitude: 0.3, freq: 2000 }] },
    { kind: 'noninvSumming', gain: 1, inputs: [{ amplitude: 1, freq: 1000 }, { amplitude: 2, freq: 0 }] },
    { kind: 'scaling', gain: 1, weights: [1, 2, 0.5], inputs: [{ amplitude: 1, freq: 1000 }, { amplitude: 0.5, freq: 0 }, { amplitude: 1, freq: 3000 }] },
  ];
  for (const c of cases) {
    it(`${c.kind} (gain ${c.weights ? c.weights.join('/') : c.gain}) gives Vout = Σ gi·Vi`, () => {
      const res = designOpampStage(c);
      expect(ercWarnings(res.design)).toEqual([]);
      // the coefficients follow the request within the E24 rounding
      res.predicted.forEach((f) => {
        if (f.target !== undefined) expect(Math.abs(f.value / f.target - 1)).toBeLessThan(0.03);
      });
      const r = simulate(res.design, 'tran');
      const t = r.scale!.re;
      const out = vec(r, 'V(OUT)').re;
      const ins = c.inputs.map((_, i) => vec(r, `V(IN${i + 1})`).re);
      let maxErr = 0;
      let maxOut = 0;
      for (let i = 0; i < t.length; i++) {
        let e = 0;
        res.gains.forEach((g, k) => (e += g * ins[k][i]));
        maxErr = Math.max(maxErr, Math.abs(e - out[i]));
        maxOut = Math.max(maxOut, Math.abs(out[i]));
      }
      expect(maxOut).toBeGreaterThan(0.5);
      expect(maxErr / maxOut).toBeLessThan(1e-3);
    });
  }

  it('a real op-amp (LM741) reaches the closed-loop gain at 1 kHz', () => {
    const res = designOpampStage({ kind: 'inverting', gain: 10, inputs: [{ amplitude: 0.5, freq: 1000 }], model: 'lm741' });
    const r = simulate(res.design, 'ac');
    const f = r.scale!.re;
    const k = f.findIndex((x) => x >= 1000);
    const out = vec(r, 'V(OUT)');
    const inp = vec(r, 'V(IN1)');
    const gain = Math.hypot(out.re[k], out.im![k]) / Math.hypot(inp.re[k], inp.im![k]);
    expect(Math.abs(gain / 10 - 1)).toBeLessThan(0.02);
  });

  it('warns about clipping and rejects impossible gains', () => {
    const clip = designOpampStage({ kind: 'inverting', gain: 50, inputs: [{ amplitude: 1, freq: 1000 }] });
    expect(clip.warnings.map((w) => w.key)).toContain('wizard.opamp.warnClipping');
    expect(() => designOpampStage({ kind: 'noninverting', gain: 0.5, inputs: [{ amplitude: 1, freq: 1000 }] })).toThrow(WizardInputError);
    expect(() => designOpampStage({ kind: 'scaling', gain: 1, weights: [1, -1], inputs: [{ amplitude: 1, freq: 1000 }, { amplitude: 1, freq: 0 }] })).toThrow(WizardInputError);
  });
});

describe('BJT common-emitter wizard', () => {
  const cases = [
    { vcc: 12, ic: 1e-3, gain: 20, rl: 10e3, flow: 100 },
    { vcc: 9, ic: 2e-3, gain: 50, rl: 4.7e3, flow: 50, transistor: 'bc547b' },
    { vcc: 15, ic: 0.5e-3, gain: 10, rl: 22e3, flow: 20, transistor: '2n2222a' },
  ];
  for (const spec of cases) {
    it(`VCC ${spec.vcc} V, IC ${spec.ic * 1e3} mA, |Av| ${spec.gain}: bias and mid-band gain`, () => {
      const res = designCommonEmitter(spec);
      expect(ercWarnings(res.design)).toEqual([]);
      const op = simulate(res.design, 'op');
      const ic = vec(op, 'Ic(Q1)').re[0];
      expect(Math.abs(ic / spec.ic - 1)).toBeLessThan(0.1);
      expect(Math.abs(ic / res.prediction.ic - 1)).toBeLessThan(0.06);
      const ac = simulate(res.design, 'ac');
      const f = ac.scale!.re;
      const k = f.findIndex((x) => x >= 10e3);
      const out = vec(ac, 'V(OUT)');
      const inp = vec(ac, 'V(IN)');
      const mag = Math.hypot(out.re[k], out.im![k]) / Math.hypot(inp.re[k], inp.im![k]);
      expect(Math.abs(mag / spec.gain - 1)).toBeLessThan(0.1);
      expect(Math.abs(mag / Math.abs(res.prediction.gain) - 1)).toBeLessThan(0.06);
      // the lower −3 dB point sits near fL (CE pole dominant, the coupling poles ten times lower)
      const mid = mag;
      let fl = NaN;
      for (let i = k; i > 0; i--) {
        const m = Math.hypot(out.re[i], out.im![i]) / Math.hypot(inp.re[i], inp.im![i]);
        if (m < mid / Math.SQRT2) {
          fl = f[i];
          break;
        }
      }
      expect(fl / spec.flow).toBeGreaterThan(0.6);
      expect(fl / spec.flow).toBeLessThan(1.6);
    });
  }

  it('limits an impossible gain with a warning', () => {
    const res = designCommonEmitter({ vcc: 12, ic: 0.2e-3, gain: 400, rl: 2e3, flow: 100 });
    expect(res.warnings.map((w) => w.key)).toContain('wizard.bjt.warnGainHigh');
    expect(res.values.re1).toBe(0);
  });
});

describe('filter mathematics', () => {
  it('computes the classic orders', () => {
    // Butterworth, 3 dB at fp, 40 dB at 4·fp: n = 4; Chebyshev 1 dB, 40 dB at 2·fp: n = 5
    expect(filterOrder('butterworth', 3, 40, 4)).toBe(4);
    expect(filterOrder('chebyshev', 1, 40, 2)).toBe(5);
    expect(filterOrder('butterworth', 3.0103, 60, 10)).toBe(3);
  });

  it('reproduces the published ladder tables', () => {
    const bw = ladderValues('butterworth', 3, 3);
    expect(bw.g.map((x) => Number(x.toFixed(4)))).toEqual([1, 2, 1]);
    const ch = ladderValues('chebyshev', 3, 0.5);
    expect(ch.g[0]).toBeCloseTo(1.5963, 3);
    expect(ch.g[1]).toBeCloseTo(1.0967, 3);
    expect(ch.g[2]).toBeCloseTo(1.5963, 3);
    const ch2 = ladderValues('chebyshev', 2, 0.5);
    expect(ch2.g[0]).toBeCloseTo(1.4029, 2);
    expect(ch2.gLoad).toBeCloseTo(1.9841, 2);
  });

  it('places the prototype poles (Butterworth on the unit circle, Chebyshev Q values)', () => {
    const p = prototypePoles('butterworth', 4, 3);
    expect(p).toHaveLength(2);
    for (const x of p) expect(Math.hypot(x.re, x.im)).toBeCloseTo(1, 12);
    expect(p.map((x) => Number(qOf(x).toFixed(4)))).toEqual([0.5412, 1.3066]);
    // 0.5 dB Chebyshev n = 2: ω0 = 1.2313, Q = 0.8637 (standard table)
    const c = prototypePoles('chebyshev', 2, 0.5)[0];
    expect(Math.hypot(c.re, c.im)).toBeCloseTo(1.2313, 3);
    expect(qOf(c)).toBeCloseTo(0.8637, 3);
  });
});

describe('filter wizard designs simulate to their specification', () => {
  const specs: [string, FilterSpec, number][] = [
    ['Butterworth low-pass, Sallen-Key', { type: 'lowpass', response: 'butterworth', topology: 'sallen-key', fp: 1000, fs: 4000, ap: 3, as: 40 }, 0.35],
    ['Chebyshev low-pass, MFB with gain 2', { type: 'lowpass', response: 'chebyshev', topology: 'mfb', fp: 1000, fs: 2000, ap: 1, as: 40, gain: 2 }, 0.4],
    ['Butterworth high-pass, MFB', { type: 'highpass', response: 'butterworth', topology: 'mfb', fp: 1000, fs: 300, ap: 3, as: 40 }, 0.35],
    ['Chebyshev high-pass, Sallen-Key', { type: 'highpass', response: 'chebyshev', topology: 'sallen-key', fp: 500, fs: 200, ap: 0.5, as: 30 }, 0.35],
    ['Chebyshev low-pass, passive (even order)', { type: 'lowpass', response: 'chebyshev', topology: 'passive', fp: 1e6, fs: 2e6, ap: 0.5, as: 30, r: 50 }, 0.05],
    ['Butterworth high-pass, passive', { type: 'highpass', response: 'butterworth', topology: 'passive', fp: 1e5, fs: 3e4, ap: 3, as: 30, r: 50 }, 0.05],
    ['Butterworth band-pass, passive', { type: 'bandpass', response: 'butterworth', topology: 'passive', f0: 1e6, bw: 2e5, bws: 8e5, ap: 3, as: 30, r: 50 }, 0.05],
    ['Chebyshev band-stop, passive', { type: 'bandstop', response: 'chebyshev', topology: 'passive', f0: 1e6, bw: 4e5, bws: 1e5, ap: 1, as: 20, r: 50 }, 0.05],
    ['Butterworth band-pass, active MFB', { type: 'bandpass', response: 'butterworth', topology: 'mfb', f0: 1000, bw: 200, bws: 800, ap: 3, as: 30 }, 0.75],
    ['Butterworth band-stop, active state variable', { type: 'bandstop', response: 'butterworth', topology: 'mfb', f0: 1000, bw: 400, bws: 100, ap: 3, as: 20 }, 0.5],
    ['Butterworth low-pass with 0.5 V/V gain', { type: 'lowpass', response: 'butterworth', topology: 'sallen-key', fp: 1000, fs: 3000, ap: 3, as: 40, gain: 0.5 }, 0.35],
  ];
  for (const [name, spec, apTol] of specs) {
    it(name, () => {
      const res = designFilter(spec);
      expect(ercWarnings(res.design)).toEqual([]);
      const r = simulate(res.design, 'ac');
      const f = r.scale!.re;
      const out = vec(r, 'V(OUT)');
      const inp = vec(r, 'V(IN)');
      const sim = (i: number) => Math.hypot(out.re[i], out.im![i]) / Math.hypot(inp.re[i], inp.im![i]);
      // the simulator agrees with the predicted response (ideal op-amps: exact algebra)
      let peak = 0;
      for (let i = 0; i < f.length; i++) {
        const pr = Math.hypot(res.response(f[i]).re, res.response(f[i]).im);
        peak = Math.max(peak, sim(i));
        if (pr > res.peakGain * 1e-3) expect(Math.abs(20 * Math.log10(sim(i) / pr))).toBeLessThan(0.02);
      }
      expect(peak / res.peakGain).toBeGreaterThan(0.99);
      // specification at the band edges (interpolated on the predicted response)
      const atten = (fx: number) => -20 * Math.log10(Math.hypot(res.response(fx).re, res.response(fx).im) / res.peakGain);
      for (const fp of res.edges.pass) expect(Math.abs(atten(fp) - spec.ap)).toBeLessThan(apTol);
      for (const fs of res.edges.stop) expect(atten(fs)).toBeGreaterThan(spec.as - 1);
      if (spec.topology !== 'passive' && spec.gain) expect(Math.abs(res.peakGain / spec.gain - 1)).toBeLessThan(0.04);
    });
  }

  it('a TL081 Sallen-Key low-pass follows the ideal prediction in the pass band', () => {
    const res = designFilter({ type: 'lowpass', response: 'chebyshev', topology: 'sallen-key', fp: 1000, fs: 1500, ap: 1, as: 30, opamp: 'tl081' });
    const r = simulate(res.design, 'ac');
    const f = r.scale!.re;
    const out = vec(r, 'V(OUT)');
    const inp = vec(r, 'V(IN)');
    for (let i = 0; i < f.length; i++) {
      if (f[i] > 1000) break;
      const sim = Math.hypot(out.re[i], out.im![i]) / Math.hypot(inp.re[i], inp.im![i]);
      const pr = Math.hypot(res.response(f[i]).re, res.response(f[i]).im);
      expect(Math.abs(20 * Math.log10(sim / pr))).toBeLessThan(0.35);
    }
  });

  it('rejects inconsistent specifications with a learner message', () => {
    expect(() => designFilter({ type: 'lowpass', response: 'butterworth', topology: 'mfb', fp: 1000, fs: 500, ap: 3, as: 40 })).toThrow(WizardInputError);
    expect(() => designFilter({ type: 'bandpass', response: 'butterworth', topology: 'passive', f0: 1000, bw: 400, bws: 200, ap: 3, as: 30 })).toThrow(WizardInputError);
    try {
      designFilter({ type: 'lowpass', response: 'butterworth', topology: 'sallen-key', fp: 1000, fs: 1050, ap: 3, as: 80 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(WizardInputError);
      expect((e as WizardInputError).text.key).toBe('wizard.filter.errOrderHigh');
    }
  });

  it('band edges multiply to f0²', () => {
    const [f1, f2] = bandEdges(1000, 300);
    expect(f2 - f1).toBeCloseTo(300, 9);
    expect(f1 * f2).toBeCloseTo(1e6, 6);
  });

  it('a wide cascade gets a larger paper size', () => {
    const res = designFilter({ type: 'bandstop', response: 'chebyshev', topology: 'mfb', f0: 1000, bw: 400, bws: 60, ap: 0.5, as: 40 });
    expect(res.order).toBeGreaterThanOrEqual(3);
    expect(res.design.sheets[0].props?.paper).toBeDefined();
  });
});
