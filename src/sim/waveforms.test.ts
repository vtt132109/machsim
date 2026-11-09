import { describe, expect, it } from 'vitest';
import type { Waveform } from './netlist';
import {
  cloneWaveform,
  compileWaveform,
  getWaveformParam,
  pulseParams,
  setWaveformParam,
  waveformBreakpoints,
  waveformParamIndex,
  waveformParamNames,
  waveformValue,
} from './waveforms';

const timing = { tstep: 1e-6, tstop: 1e-3 };

describe('PULSE', () => {
  const w: Waveform = { type: 'PULSE', args: [0, 5, 1e-6, 1e-7, 2e-7, 3e-6, 10e-6] };

  it('evaluates the four segments and repeats with the period', () => {
    expect(waveformValue(w, 0, timing)).toBe(0);
    expect(waveformValue(w, 1e-6, timing)).toBe(0);
    expect(waveformValue(w, 1.05e-6, timing)).toBeCloseTo(2.5, 12);
    expect(waveformValue(w, 2e-6, timing)).toBe(5);
    expect(waveformValue(w, 1e-6 + 1e-7 + 3e-6 + 1e-7, timing)).toBeCloseTo(2.5, 9);
    expect(waveformValue(w, 6e-6, timing)).toBe(0);
    // second period
    expect(waveformValue(w, 11.05e-6, timing)).toBeCloseTo(2.5, 6);
    expect(waveformValue(w, 13e-6, timing)).toBe(5);
  });

  it('lists every corner of every period inside the window', () => {
    const bp = waveformBreakpoints(w, 25e-6, timing);
    const expected = [1e-6, 1.1e-6, 4.1e-6, 4.3e-6, 11e-6, 11.1e-6, 14.1e-6, 14.3e-6, 21e-6, 21.1e-6, 24.1e-6, 24.3e-6];
    expect(bp.length).toBe(expected.length);
    bp.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 15));
  });

  it('returns only the corners of a later window', () => {
    const bp = compileWaveform(w, timing).breakpoints(14.2e-6, 21.05e-6);
    expect(bp.length).toBe(2);
    expect(bp[0]).toBeCloseTo(14.3e-6, 15);
    expect(bp[1]).toBeCloseTo(21e-6, 15);
  });

  it('applies tstep / tstop defaults like SPICE', () => {
    const p = pulseParams({ type: 'PULSE', args: [1, 2] }, timing);
    expect(p).toEqual({ v1: 1, v2: 2, td: 0, tr: 1e-6, tf: 1e-6, pw: 1e-3, per: 1e-3 });
    // zero rise/fall times select the default as well
    expect(pulseParams({ type: 'PULSE', args: [0, 1, 0, 0, 0, 1e-4, 2e-4] }, timing).tr).toBe(1e-6);
  });

  it('is a single pulse in an open-ended run without a period', () => {
    const single: Waveform = { type: 'PULSE', args: [0, 1, 1e-3, 1e-6, 1e-6] };
    const open = { tstep: 1e-6, tstop: Infinity };
    expect(waveformValue(single, 10, open)).toBe(1);
    expect(waveformBreakpoints(single, 100, open)).toEqual([1e-3, 1e-3 + 1e-6]);
  });
});

describe('PWL', () => {
  const w: Waveform = { type: 'PWL', args: [0, 0, 1e-3, 1, 2e-3, 1, 3e-3, 0] };

  it('interpolates linearly and holds the last value', () => {
    expect(waveformValue(w, 0.5e-3)).toBeCloseTo(0.5, 12);
    expect(waveformValue(w, 1.5e-3)).toBe(1);
    expect(waveformValue(w, 2.75e-3)).toBeCloseTo(0.25, 12);
    expect(waveformValue(w, 10e-3)).toBe(0);
  });

  it('repeats from the repeat time', () => {
    const r: Waveform = { ...w, repeatFrom: 0 };
    // period 3 ms
    expect(waveformValue(r, 3.5e-3)).toBeCloseTo(0.5, 9);
    expect(waveformValue(r, 7.5e-3)).toBeCloseTo(1, 9); // 1.5 ms into the third period
    expect(waveformValue(r, 8.75e-3)).toBeCloseTo(0.25, 9); // 2.75 ms into the third period
    expect(waveformValue(r, 6e-3)).toBeCloseTo(0, 12);
    const r1: Waveform = { ...w, repeatFrom: 1e-3 };
    // repeats the 1..3 ms section (period 2 ms) after 3 ms
    expect(waveformValue(r1, 3.5e-3)).toBeCloseTo(1, 9);
    expect(waveformValue(r1, 4.5e-3)).toBeCloseTo(0.5, 9);
  });

  it('produces breakpoints for every repetition', () => {
    const r: Waveform = { ...w, repeatFrom: 0 };
    const bp = waveformBreakpoints(r, 7e-3);
    const expected = [1e-3, 2e-3, 3e-3, 4e-3, 5e-3, 6e-3, 7e-3];
    expect(bp.length).toBe(expected.length);
    bp.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 15));
    const later = compileWaveform(r).breakpoints(30e-3, 32.5e-3);
    expect(later.length).toBe(2);
    expect(later[0]).toBeCloseTo(31e-3, 12);
    expect(later[1]).toBeCloseTo(32e-3, 12);
  });

  it('ignores points that go back in time', () => {
    const bad: Waveform = { type: 'PWL', args: [0, 0, 2, 2, 1, 5, 3, 3] };
    expect(waveformValue(bad, 2.5)).toBeCloseTo(2.5, 12);
  });
});

describe('SIN, EXP, SFFM, AM', () => {
  it('SIN with delay, damping and phase', () => {
    const w: Waveform = { type: 'SIN', args: [1, 2, 1e3, 1e-3, 100, 90] };
    expect(waveformValue(w, 0)).toBeCloseTo(3, 12); // before td: vo + va*sin(phase)
    const t = 1.25e-3;
    const expected = 1 + 2 * Math.exp(-0.25e-3 * 100) * Math.sin(2 * Math.PI * 1e3 * 0.25e-3 + Math.PI / 2);
    expect(waveformValue(w, t)).toBeCloseTo(expected, 12);
    expect(waveformBreakpoints(w, 1)).toEqual([1e-3]);
  });

  it('SIN default frequency is 1/tstop', () => {
    const w: Waveform = { type: 'SIN', args: [0, 1] };
    expect(waveformValue(w, 0.25e-3, timing)).toBeCloseTo(1, 12);
  });

  it('EXP rise and fall', () => {
    const w: Waveform = { type: 'EXP', args: [0, 1, 1e-3, 1e-4, 2e-3, 2e-4] };
    expect(waveformValue(w, 0.5e-3)).toBe(0);
    expect(waveformValue(w, 1.1e-3)).toBeCloseTo(1 - Math.exp(-1), 12);
    const t = 2.3e-3;
    const v = 1 - Math.exp(-(t - 1e-3) / 1e-4) - (1 - Math.exp(-(t - 2e-3) / 2e-4));
    expect(waveformValue(w, t)).toBeCloseTo(v, 12);
    expect(waveformBreakpoints(w, 1)).toEqual([1e-3, 2e-3]);
  });

  it('SFFM and AM follow their definitions', () => {
    const s: Waveform = { type: 'SFFM', args: [0.5, 1, 1e4, 3, 1e3] };
    const t = 37e-6;
    expect(waveformValue(s, t)).toBeCloseTo(0.5 + Math.sin(2 * Math.PI * 1e4 * t + 3 * Math.sin(2 * Math.PI * 1e3 * t)), 12);
    const a: Waveform = { type: 'AM', args: [2, 1, 1e3, 1e5, 1e-4] };
    expect(waveformValue(a, 0.5e-4)).toBe(0);
    const ta = 3.3e-4;
    const tt = ta - 1e-4;
    expect(waveformValue(a, ta)).toBeCloseTo(2 * (1 + Math.sin(2 * Math.PI * 1e3 * tt)) * Math.sin(2 * Math.PI * 1e5 * tt), 12);
  });
});

describe('named parameters', () => {
  it('maps names to positional arguments', () => {
    expect(waveformParamNames('SIN')).toEqual(['vo', 'va', 'freq', 'td', 'theta', 'phase']);
    expect(waveformParamIndex('SIN', 'AMPL')).toBe(1);
    expect(waveformParamIndex('PULSE', 'per')).toBe(6);
    expect(waveformParamIndex('PULSE', 'nonsense')).toBe(-1);
  });

  it('sets SIN amplitude and frequency in place without touching the original clone', () => {
    const orig: Waveform = { type: 'SIN', args: [0, 1, 50] };
    const w = cloneWaveform(orig);
    expect(setWaveformParam(w, 'ampl', 3)).toBe(true);
    expect(setWaveformParam(w, 'phase', 30)).toBe(true);
    expect(w.args).toEqual([0, 3, 50, Number.NaN, Number.NaN, 30]);
    expect(orig.args).toEqual([0, 1, 50]);
    expect(getWaveformParam(w, 'va')).toBe(3);
    expect(getWaveformParam(w, 'td')).toBeUndefined();
    expect(setWaveformParam(w, 'bogus', 1)).toBe(false);
  });

  it('PULSE freq keeps the duty cycle', () => {
    const w: Waveform = { type: 'PULSE', args: [0, 1, 0, 1e-9, 1e-9, 2.5e-4, 1e-3] };
    expect(getWaveformParam(w, 'duty')).toBeCloseTo(0.25, 12);
    setWaveformParam(w, 'freq', 2e3);
    expect(w.args[6]).toBeCloseTo(5e-4, 15);
    expect(w.args[5]).toBeCloseTo(1.25e-4, 15);
    setWaveformParam(w, 'duty', 0.5);
    expect(w.args[5]).toBeCloseTo(2.5e-4, 15);
  });

  it('PWL repeat can be switched on and off', () => {
    const w: Waveform = { type: 'PWL', args: [0, 0, 1, 1] };
    setWaveformParam(w, 'r', 0);
    expect(w.repeatFrom).toBe(0);
    expect(waveformValue(w, 1.5)).toBeCloseTo(0.5, 12);
    setWaveformParam(w, 'repeat', Number.NaN);
    expect(w.repeatFrom).toBeUndefined();
    expect(waveformValue(w, 1.5)).toBe(1);
  });
});
