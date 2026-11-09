import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../sim/results';
import { ivAnalysisSpec, ivCurves, ivSweep } from './iv';
import {
  captureAtEdges,
  captureWindow,
  externalClock,
  findPatternTrigger,
  internalClock,
  logicLevel,
  matchPattern,
  normalizePattern,
  parseLogicAnalyzerSettings,
  sampleChannels,
  wordHex,
} from './logicAnalyzer';

describe('logic analyzer', () => {
  it('parses settings and patterns', () => {
    const s = parseLogicAnalyzerSettings({ threshold: '1.4', clock: 'External', clockrate: '1meg', qual: '1', trigmode: 'pattern', pattern: '10x1', pre: '5', post: '0' });
    expect(s).toEqual({
      threshold: 1.4,
      clock: 'external',
      clockRate: 1e6,
      clockEdge: 'rising',
      qualifier: '1',
      trigMode: 'pattern',
      pattern: 'xxxxxxxxxxxx10x1',
      pre: 5,
      post: 1,
    });
    expect(normalizePattern('1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 1')).toBe('1010101010101011');
  });

  it('thresholds voltages (NaN = unknown)', () => {
    expect(logicLevel(2.6, 2.5)).toBe(1);
    expect(logicLevel(2.5, 2.5)).toBe(0);
    expect(Number.isNaN(logicLevel(Number.NaN, 2.5))).toBe(true);
  });

  it('generates internal clock instants inside a window', () => {
    expect(internalClock(0.00025, 0.001, 4000)).toEqual([0.00025, 0.0005, 0.00075, 0.001]);
    expect(internalClock(0, 1, 1000, 3)).toEqual([0.998, 0.999, 1]);
  });

  it('finds external clock edges, honouring the qualifier', () => {
    const t = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const clk = [0, 5, 0, 5, 0, 5, 0, 5, 0];
    const qual = [0, 0, 5, 5, 5, 5, 0, 0, 0];
    expect(externalClock(t, clk, 2.5, 'rising')).toEqual([0.5, 2.5, 4.5, 6.5]);
    expect(externalClock(t, clk, 2.5, 'falling')).toEqual([1.5, 3.5, 5.5, 7.5]);
    expect(externalClock(t, clk, 2.5, 'rising', qual, '1')).toEqual([2.5, 4.5]);
    expect(externalClock(t, clk, 2.5, 'rising', qual, '0')).toEqual([0.5, 6.5]);
  });

  it('samples words, triggers on a pattern and windows the capture', () => {
    // channel 0 toggles every sample, channel 1 every two samples (a 2-bit counter), channel 2 absent
    const t = Array.from({ length: 16 }, (_, i) => i);
    const d0 = t.map((i) => (i % 2 ? 5 : 0));
    const d1 = t.map((i) => (Math.floor(i / 2) % 2 ? 5 : 0));
    const instants = t.map((i) => i + 0.25);
    const s = sampleChannels(t, [d0, d1], instants, 2.5);
    expect(s.words.slice(0, 6)).toEqual([0, 1, 2, 3, 0, 1]);
    // channels 2..15 are unknown
    expect(s.unknown[0]).toBe(0xfffc);
    // channels 2 and 3 are unknown too, so even the low nibble is unknown
    expect(wordHex(s.words[3], s.unknown[3])).toBe('????');
    expect(wordHex(3, 0xfff0)).toBe('???3');
    expect(wordHex(0xbeef)).toBe('BEEF');
    expect(matchPattern(3, 'xxxxxxxxxxxxxx11', s.unknown[3])).toBe(true);
    // a non-x on an unknown channel never matches
    expect(matchPattern(3, 'xxxxxxxxxxxxx011', s.unknown[3])).toBe(false);
    expect(findPatternTrigger(s.words, '11', s.unknown)).toBe(3);
    expect(findPatternTrigger(s.words, '11', s.unknown, 4)).toBe(7);
    // newest trigger with complete post-trigger samples
    const cap = captureWindow(s, { trigMode: 'pattern', pattern: '11', pre: 2, post: 4 });
    expect(cap).toEqual({ first: 9, last: 14, trigger: 11 });
    expect(captureWindow(s, { trigMode: 'none', pattern: '', pre: 2, post: 4 })).toEqual({ first: 10, last: 15, trigger: null });
  });

  it('captures around the newest complete external trigger edge', () => {
    const times = Array.from({ length: 20 }, (_, i) => i * 0.1);
    // edge at 0.55 -> sample 6; edge at 1.75 -> sample 18 lacks 4 post-trigger samples
    expect(captureAtEdges({ times }, [0.55, 1.75], 3, 4)).toEqual({ first: 3, last: 9, trigger: 6 });
    expect(captureAtEdges({ times }, [1.75], 3, 4)).toEqual({ first: 13, last: 19, trigger: null });
    expect(parseLogicAnalyzerSettings({ trigmode: 'External' }).trigMode).toBe('external');
  });
});

describe('IV analyzer', () => {
  it('uses device presets and user overrides', () => {
    expect(ivSweep({ device: 'nmos' })).toEqual({ device: 'nmos', vstart: 0, vstop: 10, vstep: 0.05, cstart: 2, cstop: 6, csteps: 5 });
    // the step sign follows the sweep direction
    expect(ivSweep({ device: 'bjt-pnp', vstep: '0.1' }).vstep).toBe(-0.1);
    expect(ivSweep({ device: 'gizmo' }).device).toBe('diode');
  });

  it('builds the nested DC sweep for the analyzer sources', () => {
    const binding = { drives: ['V_XIV1_v', 'I_XIV1_b'] };
    const bjt = ivAnalysisSpec({ device: 'bjt-npn', cstart: '10u', cstop: '40u', csteps: '4' }, binding)!;
    expect(bjt).toMatchObject({ type: 'dc', src: 'V_XIV1_v', start: 0, stop: 10, step: 0.05 });
    expect(bjt.src2!.src).toBe('I_XIV1_b');
    expect(bjt.src2!.start).toBeCloseTo(10e-6, 18);
    expect(bjt.src2!.stop).toBeCloseTo(40e-6, 18);
    // 4 steps from 10 uA to 40 uA
    expect(bjt.src2!.step).toBeCloseTo(10e-6, 18);
    expect(ivAnalysisSpec({ device: 'diode' }, binding)).toEqual({ type: 'dc', src: 'V_XIV1_v', start: 0, stop: 1, step: 0.01 });
    expect(ivAnalysisSpec({ device: 'nmos' }, { drives: ['V_XIV1_v'] })).toBeNull();
  });

  it('extracts one curve per run, or splits a flattened nested sweep', () => {
    const run = (k: number): AnalysisResult => ({
      type: 'dc',
      title: 'DC',
      scale: { name: 'V_XIV1_v', unit: 'V', re: Float64Array.of(0, 1, 2) },
      vectors: [{ name: 'I(V_XIV1_i)', unit: 'A', re: Float64Array.of(0, k * 1e-3, k * 2e-3) }],
      warnings: [],
    });
    const fam: AnalysisResult = { ...run(0), runs: [{ label: 'Ib = 10 µA', result: run(1) }, { label: 'Ib = 20 µA', result: run(2) }] };
    const curves = ivCurves(fam, { kind: 'current', element: 'V_XIV1_i' });
    expect(curves.map((c) => c.label)).toEqual(['Ib = 10 µA', 'Ib = 20 µA']);
    expect(Array.from(curves[1].i)).toEqual([0, 2e-3, 4e-3]);
    expect(Array.from(curves[1].v)).toEqual([0, 1, 2]);

    const flat: AnalysisResult = {
      type: 'dc',
      title: 'DC',
      spec: { type: 'dc', src: 'V_XIV1_v', start: 0, stop: 2, step: 1, src2: { src: 'I_XIV1_b', start: 1e-5, stop: 2e-5, step: 1e-5 } },
      scale: { name: 'V_XIV1_v', unit: 'V', re: Float64Array.of(0, 1, 2, 0, 1, 2) },
      vectors: [{ name: 'i(v_xiv1_i)', unit: 'A', re: Float64Array.of(0, 1, 2, 0, 2, 4) }],
      warnings: [],
    };
    const split = ivCurves(flat, { kind: 'current', element: 'V_XIV1_i' }, undefined, true);
    expect(split).toHaveLength(2);
    expect(split[0].label).toBe('I_XIV1_b = 10 µ');
    expect(split[1].label).toBe('I_XIV1_b = 20 µ');
    expect(Array.from(split[1].i)).toEqual([-0, -2, -4]);
  });
});
