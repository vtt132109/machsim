import { describe, expect, it } from 'vitest';
import { indicatorLevels, signalValue } from './indicators';
import { buildNetlist } from '../model/netlister';
import { runAnalyses } from '../sim';
import { seriesLedCircuit } from './examples';
import type { IndicatorBinding } from '../model/netlister';

const led = (current: string): IndicatorBinding => ({ refdes: 'LED1', partId: 'diodes/led-red', kind: 'led', params: { imax: '20m' }, signal: { kind: 'current', element: current } });

describe('indicator levels', () => {
  it('reads voltages and currents case-insensitively', () => {
    const values = { 'V(N1)': 5, 'v(n2)': 2, 'I(V_LED1_I)': 0.01 };
    expect(signalValue({ kind: 'voltage', pos: 'n1', neg: 'N2' }, values)).toBe(3);
    expect(signalValue({ kind: 'voltage', pos: 'N1', neg: '0' }, values)).toBe(5);
    expect(signalValue({ kind: 'current', element: 'V_LED1_i' }, values)).toBe(0.01);
    expect(signalValue({ kind: 'voltage', pos: 'nope', neg: '0' }, values)).toBeUndefined();
  });

  it('scales LED current by imax and clamps', () => {
    expect(indicatorLevels([led('V_LED1_i')], { 'I(V_LED1_i)': 0.01 })).toEqual({ LED1: 0.5 });
    expect(indicatorLevels([led('V_LED1_i')], { 'I(V_LED1_i)': 0.05 })).toEqual({ LED1: 1 });
    expect(indicatorLevels([led('V_LED1_i')], { 'I(V_LED1_i)': -0.001 })).toEqual({ LED1: 0 });
    expect(indicatorLevels([led('V_LED1_i')], {})).toEqual({});
  });

  it('keeps an LED dark below its turn-on current (leakage through an open switch)', () => {
    const b: IndicatorBinding = { ...led('V_LED1_i'), params: { imax: '20m', ion: '1m' } };
    expect(indicatorLevels([b], { 'I(V_LED1_i)': 5e-9 })).toEqual({ LED1: 0 });
    expect(indicatorLevels([b], { 'I(V_LED1_i)': 0.9e-3 })).toEqual({ LED1: 0 });
    expect(indicatorLevels([b], { 'I(V_LED1_i)': 10e-3 })).toEqual({ LED1: 0.5 });
  });

  it('handles lamps, buzzers and probes', () => {
    const b: IndicatorBinding[] = [
      { refdes: 'X1', partId: 'indicators/lamp', kind: 'lamp', params: { vrated: '12' }, signal: { kind: 'voltage', pos: 'a', neg: '0' } },
      { refdes: 'LS1', partId: 'indicators/buzzer', kind: 'buzzer', params: { von: '1.5' }, signal: { kind: 'voltage', pos: 'b', neg: '0' } },
      { refdes: 'X2', partId: 'indicators/probe-red', kind: 'probe', params: { threshold: '2.5' }, signal: { kind: 'voltage', pos: 'c', neg: '0' } },
    ];
    const l = indicatorLevels(b, { 'V(a)': 3, 'V(b)': 1.0, 'V(c)': 4 });
    expect(l.X1).toBeCloseTo(0.125, 9);
    expect(l.LS1).toBe(0);
    expect(l.X2).toBe(1);
  });

  it('lights the LED of the series circuit from a real operating point', () => {
    const build = buildNetlist(seriesLedCircuit(), { includeAnalysis: false });
    expect(build.indicators.map((i) => i.refdes)).toEqual(['LED1']);
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(op.error).toBeUndefined();
    const values: Record<string, number> = {};
    for (const v of op.vectors) values[v.name] = v.re[0];
    const sig = build.indicators[0].signal;
    const i = signalValue(sig, values)!;
    // 9 V − V_F(≈1.8…2.1 V) across 470 Ω (+ 0.5 Ω battery) ≈ 15 mA
    expect(i).toBeGreaterThan(0.0145);
    expect(i).toBeLessThan(0.0155);
    const level = indicatorLevels(build.indicators, values).LED1;
    expect(level).toBeCloseTo(i / 0.02, 9);
  });
});
