import { describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { buildNetlist, type IndicatorBinding } from '../../model/netlister';
import type { ProbeBinding } from '../../model/types';
import { SEGMENT_FONTS } from '../../sim/devices/digital';
import { getPart } from '../../library';
import { astable555Example, decadeCounterExample, rcLowPassExample, voltageDividerExample } from './exampleDesigns';
import { SignalHistory, hasInteractiveParts, indicatorReadings, liveLevels, lowerValues, neededVectors, needsStreaming, probeText, readSignal } from './live';

describe('neededVectors', () => {
  it('lists every instrument channel, probe and indicator vector once', () => {
    const b = buildNetlist(rcLowPassExample(), { includeAnalysis: false });
    expect(neededVectors(b).sort()).toEqual(['V(IN)', 'V(OUT)']);
    const led = buildNetlist(astable555Example(), { includeAnalysis: false });
    expect(neededVectors(led).sort()).toEqual(['I(V_LED1_i)', 'V(OUT)', 'V(THR)']);
    const counter = buildNetlist(decadeCounterExample(), { includeAnalysis: false });
    expect(neededVectors(counter)).toEqual(['V(U3.code)']);
  });

  it('decides between streaming and a one-shot analysis', () => {
    const divider = voltageDividerExample();
    expect(needsStreaming(buildNetlist(divider), divider, getPart)).toBe(true);
    const bare = voltageDividerExample();
    bare.sheets[0].parts = bare.sheets[0].parts.filter((p) => p.refdes !== 'XMM1');
    expect(needsStreaming(buildNetlist(bare), bare, getPart)).toBe(false);
    bare.sheets[0].parts.push({ id: 'sw', partId: 'basic/switch-spst', refdes: 'S1', x: 600, y: 600, rotation: 0, mirror: false, params: {} });
    expect(hasInteractiveParts(bare, getPart)).toBe(true);
  });
});

describe('signals and probes', () => {
  const values = lowerValues({ 'V(a)': 3, 'V(B)': 1, 'I(V_PR_p1)': 0.002 });

  it('reads voltages (ground = 0), differences and currents case-insensitively', () => {
    expect(readSignal({ kind: 'voltage', pos: 'A', neg: '0' }, values)).toBe(3);
    expect(readSignal({ kind: 'voltage', pos: 'a', neg: 'b' }, values)).toBe(2);
    expect(readSignal({ kind: 'voltage', pos: '0', neg: 'b' }, values)).toBe(-1);
    expect(readSignal({ kind: 'current', element: 'v_pr_P1' }, values)).toBe(0.002);
    expect(readSignal({ kind: 'voltage', pos: 'missing', neg: '0' }, values)).toBeUndefined();
  });

  it('formats voltage, current, power and digital probes', () => {
    const v: ProbeBinding = { probeId: 'p', name: 'P', kind: 'voltage', color: '#f00', signal: { kind: 'voltage', pos: 'a', neg: '0' } };
    expect(probeText(v, values)).toBe('V: 3 V');
    expect(probeText({ ...v, kind: 'current', signal: { kind: 'current', element: 'V_PR_p1' } }, values)).toBe('I: 2 mA');
    expect(probeText({ ...v, kind: 'power', current: { kind: 'current', element: 'V_PR_p1' } }, values)).toBe('P: 6 mW');
    expect(probeText({ ...v, kind: 'digital', signal: { kind: 'voltage', pos: 'b', neg: '0' } }, values)).toBe('0 (1 V)');
    expect(probeText({ ...v, signal: { kind: 'voltage', pos: 'zz', neg: '0' } }, values)).toBe('V: —');
  });

  it('adds peak-to-peak and RMS of a varying signal from its history', () => {
    const h = new SignalHistory(10000);
    const f = 1000;
    for (let k = 0; k <= 5000; k++) {
      const t = k * 2e-6;
      h.push(t, 2 * Math.sin(2 * Math.PI * f * t));
    }
    const st = h.stats(0.01)!;
    expect(st.max - st.min).toBeCloseTo(4, 3);
    expect(st.rms).toBeCloseTo(Math.SQRT2, 3);
    expect(st.mean).toBeCloseTo(0, 3);
    const v: ProbeBinding = { probeId: 'p', name: 'P', kind: 'voltage', color: '#f00', signal: { kind: 'voltage', pos: 'a', neg: '0' } };
    expect(probeText(v, values, h)).toBe('V: 3 V\nVpp: 4 V  rms: 1.41 V');
    // a time going backwards restarts the history
    h.push(0, 1);
    expect(h.length).toBe(1);
  });

  it('keeps only the newest samples when full', () => {
    const h = new SignalHistory(4);
    for (let k = 0; k < 10; k++) h.push(k, k);
    expect(h.length).toBe(4);
    expect(h.stats(100)).toEqual({ min: 6, max: 9, mean: 7.5, rms: Math.sqrt((6 * 6 + 2 * 7 * 7 + 2 * 8 * 8 + 9 * 9) / 6), count: 4 });
  });
});

describe('indicator levels', () => {
  const led: IndicatorBinding = { refdes: 'LED1', partId: 'diodes/led-red', kind: 'led', params: { imax: '20m' }, signal: { kind: 'current', element: 'V_LED1_i' } };
  const seg: IndicatorBinding = { refdes: 'U3', partId: 'indicators/seven-seg-ca', kind: 'seven-seg', params: {}, signal: { kind: 'voltage', pos: 'U3.code', neg: '0' } };
  const bar: IndicatorBinding = { refdes: 'U4', partId: 'indicators/bargraph', kind: 'bargraph', params: {}, signal: { kind: 'voltage', pos: 'U4.code', neg: '0' } };

  it('scales LEDs by I/imax and decodes segment / bar masks for both views', () => {
    const three = SEGMENT_FONTS.ttl7447[3];
    const lv = liveLevels([led, seg, bar], { 'I(V_LED1_i)': 0.01, 'V(U3.code)': three, 'V(U4.code)': 0b101 });
    expect(lv.schematic.LED1).toBeCloseTo(0.5, 12);
    expect(lv.breadboard.LED1).toBeCloseTo(0.5, 12);
    expect(lv.schematic.U3).toBe(three);
    expect(lv.breadboard.U3).toBe(1);
    // "3" lights a b c d g
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((s) => lv.breadboard[`U3.${s}`])).toEqual([1, 1, 1, 1, 0, 0, 1, 0]);
    expect([1, 2, 3, 4].map((k) => lv.breadboard[`U4.${k}`])).toEqual([1, 0, 1, 0]);
    const off = liveLevels([seg], { 'V(U3.code)': 0 });
    expect(off.schematic.U3).toBe(0);
    expect(off.breadboard.U3).toBe(0);
  });

  it('describes readings in words', () => {
    const r = indicatorReadings([led, seg], { 'I(V_LED1_i)': 0.0125, 'V(U3.code)': SEGMENT_FONTS.ttl7447[1] });
    expect(r).toEqual([
      { refdes: 'LED1', kind: 'led', text: '12.5 mA' },
      { refdes: 'U3', kind: 'seven-seg', text: 'sáng: b c' },
    ]);
    setLang('en');
    try {
      expect(indicatorReadings([seg], { 'V(U3.code)': SEGMENT_FONTS.ttl7447[1] })[0].text).toBe('lit: b c');
      expect(indicatorReadings([seg], { 'V(U3.code)': 0 })[0].text).toBe('off');
    } finally {
      setLang('vi');
    }
  });
});
