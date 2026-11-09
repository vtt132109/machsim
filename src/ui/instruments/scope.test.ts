import { describe, expect, it } from 'vitest';
import {
  applyCoupling,
  findTriggers,
  parseScopeSettings,
  sampleAt,
  scopeCsv,
  selectSweep,
  sequence125,
  step125,
  windowMean,
} from './scope';
import type { SweepSettings } from './scope';

function sine(f: number, n: number, dt: number, amp = 1, offset = 0) {
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i * dt;
    v[i] = offset + amp * Math.sin(2 * Math.PI * f * t[i]);
  }
  return { t, v };
}

describe('trigger detection', () => {
  it('finds interpolated rising and falling crossings of a sine', () => {
    // 1 kHz sine sampled at 37 kHz (non-integer samples per period)
    const { t, v } = sine(1000, 400, 1 / 37000);
    const rising = findTriggers(t, v, 0, 'rising');
    // the first rising zero crossing at t = 0 is not armed (signal starts at the level)
    expect(rising.length).toBe(10);
    rising.forEach((x, k) => expect(x).toBeCloseTo((k + 1) * 1e-3, 5));
    const falling = findTriggers(t, v, 0.5, 'falling');
    // sin = 0.5 falling at phase 150 deg -> t = (k + 5/12) ms
    falling.forEach((x, k) => expect(x).toBeCloseTo((k + 5 / 12) * 1e-3, 5));
  });

  it('limits results to the requested time range', () => {
    const { t, v } = sine(1000, 400, 1 / 37000);
    const r = findTriggers(t, v, 0, 'rising', 2.5e-3, 6.5e-3);
    expect(r.map((x) => Math.round(x * 1e4) / 10)).toEqual([3, 4, 5, 6]);
  });

  it('ignores noise around the level thanks to hysteresis', () => {
    const t: number[] = [];
    const v: number[] = [];
    // slow ramps (2 mV / sample) up, down and up again through 0 with +/-10 mV chatter, so the
    // signal wiggles back and forth across the level several times on every slope
    for (let i = 0; i <= 3000; i++) {
      t.push(i);
      const phase = i % 2000;
      const base = phase <= 1000 ? -1 + phase * 0.002 : 1 - (phase - 1000) * 0.002;
      v.push(base + (i % 2 ? 0.01 : -0.01));
    }
    const raw = findTriggers(t, v, 0, 'rising', -Infinity, Infinity, 0);
    expect(raw.length).toBeGreaterThan(4);
    const clean = findTriggers(t, v, 0, 'rising', -Infinity, Infinity, 0.05);
    // exactly one trigger per rising slope (samples 0..1000 and 2000..3000)
    expect(clean.length).toBe(2);
    expect(clean[0]).toBeGreaterThan(495);
    expect(clean[0]).toBeLessThan(505);
    expect(clean[1]).toBeGreaterThan(2495);
    expect(clean[1]).toBeLessThan(2505);
  });
});

describe('sweep selection', () => {
  const { t, v } = sine(1000, 3700, 1 / 37000); // 0 .. 0.1 s
  const base: SweepSettings = { timebase: 1e-4, xpos: 0, mode: 'auto', edge: 'rising', level: 0 };
  const src = { start: 0, end: t[t.length - 1], trigTime: t, trigValues: v };

  it('auto mode locks onto the newest trigger with a complete sweep', () => {
    const w = selectSweep(src, base);
    expect(w.status).toBe('triggered');
    expect(w.trigger).not.toBeNull();
    expect(w.right).toBeLessThanOrEqual(src.end + 1e-12);
    expect(w.right - w.left).toBeCloseTo(1e-3, 12);
    // trigger instant is a rising zero crossing: sin(2*pi*f*t) ~ 0 with positive slope
    expect(Math.abs(Math.sin(2 * Math.PI * 1000 * w.trigger!))).toBeLessThan(1e-4);
    expect(Math.cos(2 * Math.PI * 1000 * w.trigger!)).toBeGreaterThan(0.99);
  });

  it('applies the X position as a shift of the screen relative to the trigger', () => {
    const w = selectSweep(src, { ...base, xpos: -5 });
    expect(w.left).toBeCloseTo(w.trigger! - 5e-4, 12);
  });

  it('free-runs in none mode and when auto finds no trigger', () => {
    const none = selectSweep(src, { ...base, mode: 'none' });
    expect(none.status).toBe('free-run');
    // sweeps tile the time axis: the newest sweep ends at (or after) the newest sample
    expect(none.left).toBeCloseTo(Math.ceil(src.end / 1e-3 - 1) * 1e-3, 12);
    const high = selectSweep(src, { ...base, level: 5 });
    expect(high.status).toBe('free-run');
  });

  it('normal mode keeps the previous frame without a trigger', () => {
    const prev = { left: 1, right: 2, trigger: 1, status: 'triggered' as const };
    const w = selectSweep(src, { ...base, mode: 'normal', level: 5 }, prev);
    expect(w).toEqual({ ...prev, status: 'waiting' });
  });

  it('single mode captures the first trigger after arming and then freezes', () => {
    const first = selectSweep(src, { ...base, mode: 'single' }, null, 0.05);
    expect(first.status).toBe('stopped');
    expect(first.trigger!).toBeGreaterThanOrEqual(0.05);
    expect(first.trigger!).toBeCloseTo(0.05, 6);
    // later data does not move a frozen capture
    const bigger = { ...src, end: src.end + 1 };
    expect(selectSweep(bigger, { ...base, mode: 'single' }, first, 0.05)).toEqual(first);
    // re-arming later starts a new acquisition
    const again = selectSweep(src, { ...base, mode: 'single' }, first, 0.07);
    expect(again.trigger!).toBeCloseTo(0.07, 6);
  });
});

describe('coupling and sampling', () => {
  it('AC coupling removes the window mean, GND reads zero', () => {
    const { t, v } = sine(1000, 3701, 1 / 37000, 1, 2.5);
    expect(windowMean(t, v, 0, 0.1)).toBeCloseTo(2.5, 6);
    const ac = applyCoupling(t, v, 'ac', 0, 0.1);
    expect(windowMean(t, ac, 0, 0.1)).toBeCloseTo(0, 6);
    expect(Math.max(...applyCoupling(t, v, 'gnd', 0, 0.1))).toBe(0);
    expect(applyCoupling(t, v, 'dc', 0, 0.1)).toBe(v);
  });

  it('interpolates channel values at cursor times', () => {
    expect(sampleAt([0, 1, 2], [0, 10, 0], 0.25)).toBe(2.5);
    expect(Number.isNaN(sampleAt([0, 1], [0, 1], 2))).toBe(true);
  });
});

describe('settings', () => {
  it('parses params with defaults and channel lists', () => {
    const s = parseScopeSettings(
      { timebase: '2m', 'A.scale': '500m', 'B.coupling': 'AC', 'trig.source': 'b', 'trig.mode': 'single', display: 'ba', reverse: 'true', 'A.pos': 'oops' },
      ['A', 'B'],
    );
    expect(s.timebase).toBe(2e-3);
    expect(s.channels.A).toEqual({ scale: 0.5, pos: 0, coupling: 'dc' });
    expect(s.channels.B.coupling).toBe('ac');
    expect(s.source).toBe('B');
    expect(s.mode).toBe('single');
    expect(s.display).toBe('ba');
    expect(s.reverse).toBe(true);
    expect(parseScopeSettings({ 'trig.source': 'ext' }, ['A', 'B']).source).toBe('ext');
  });

  it('steps through the 1-2-5 sequence', () => {
    expect(sequence125(1e-3, 1)).toEqual([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]);
    expect(step125(1e-3, 1)).toBe(2e-3);
    expect(step125(5e-3, 1)).toBe(1e-2);
    expect(step125(1e-2, -1)).toBe(5e-3);
    expect(step125(3e-3, -1)).toBe(2e-3);
  });

  it('exports captures as CSV', () => {
    const csv = scopeCsv([0, 1e-3], [
      { name: 'A', values: [1, 2] },
      { name: 'B', values: [Number.NaN, 4] },
    ]);
    expect(csv).toBe('Time [s],A [V],B [V]\r\n0,1,\r\n0.001,2,4\r\n');
  });
});
