/**
 * Bench instruments: waveform generator (netlist waveforms simulated and compared with the
 * preview function, 50 Ω output and load setting, modulation, sync), 6½-digit multimeter
 * (display resolution, ranging, readings over the aperture, statistics, math, ohms and current
 * measured in a simulated circuit) and the oscilloscope measurement maths (IEEE 181 style top /
 * base, edges, delay / phase, FFT, auto setup, logic lanes).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import type { Design, InstrumentBinding } from '../../model/types';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import { benchGenSettings, benchSample, benchWave, BENCH_GEN_DEFAULTS } from '../../library/parts/benchSignals';
import { addStat, acRmsOf, dmmAutoRange, dmmFormat, dmmMath, dmmOhms, dmmReadings, dmmResolution, emptyStats, parseDmmSettings, statSdev } from './benchDmm';
import { autoSetup, busValue, formatMeasureSlots, logicBit, measureDelay, measureWaveform, nice125, parseMeasureSlots, windowFft } from './benchScope';
import { instrumentPanels } from './registry';
import { InstrumentStream } from './types';
import { setLang } from '../../i18n';

function tran(d: Design, tstep: number, tstop: number): AnalysisResult {
  const b = buildNetlist(d, { includeAnalysis: false });
  expect(b.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'tran', tstep, tstop, tmax: tstep }] });
  expect(r.error).toBeUndefined();
  return r;
}

function op(d: Design): AnalysisResult {
  const b = buildNetlist(d, { includeAnalysis: false });
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r;
}

const vec = (r: AnalysisResult, name: string) => r.vectors.find((x) => x.name.toUpperCase() === name.toUpperCase())!.re;

/** Generator XAG1 driving a load resistor (OUT labelled OUT). */
function generatorCircuit(params: Record<string, string>, load: string): Design {
  const b = new DesignBuilder('gen');
  const g = b.part('instruments/bench-generator', 'XAG1', 100, 100, params);
  const rl = b.part('basic/resistor', 'RL', 300, 200, { value: load }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 300, 230);
  b.part('sources/ground', 'GND2', 100, 160);
  b.wire(b.pin(g, 'OUT'), { x: 80, y: 170 }, { x: 300, y: 170 });
  b.wire(b.pin(g, 'COM'), { x: 100, y: 160 });
  b.label('OUT', 200, 170);
  void rl;
  return b.design;
}

describe('bench waveform generator', () => {
  it('a 50 Ω load setting doubles the internal EMF so the load sees the set amplitude', () => {
    for (const [load, rl] of [
      ['50', '50'],
      ['hiz', '1M'],
    ] as const) {
      const d = generatorCircuit({ waveform: 'sine', freq: '1k', amplitude: '2', load }, rl);
      const r = tran(d, 5e-6, 2e-3);
      const v = vec(r, 'V(OUT)');
      let max = -Infinity;
      let min = Infinity;
      for (let i = r.scale!.re.length / 2; i < v.length; i++) {
        max = Math.max(max, v[Math.floor(i)]);
        min = Math.min(min, v[Math.floor(i)]);
      }
      expect(max - min).toBeCloseTo(2, 2);
    }
  });

  it('the simulated waveforms equal the preview function (square, ramp, pulse, arbitrary)', () => {
    const shapes: Record<string, string>[] = [
      { waveform: 'square', duty: '25', edge: '10n' },
      { waveform: 'ramp', symmetry: '80' },
      { waveform: 'triangle', phase: '90' },
      { waveform: 'pulse', width: '200u' },
      { waveform: 'arb', arb: 'sinc' },
      { waveform: 'arb', arb: 'user', arbdata: '0, 1, 0.5, -1' },
    ];
    for (const extra of shapes) {
      const params = { ...BENCH_GEN_DEFAULTS, freq: '1k', amplitude: '4', offset: '1', ...extra };
      const s = benchGenSettings(params);
      const r = tran(generatorCircuit(params, '1G'), 2e-6, 3e-3);
      const t = r.scale!.re;
      const v = vec(r, 'V(OUT)');
      let err = 0;
      for (let i = 0; i < t.length; i++) {
        // away from the steep edges, where a 2 µs step cannot resolve 10 ns transitions
        const ahead = benchSample(s, t[i] + 4e-6);
        const behind = benchSample(s, t[i] - 4e-6);
        if (Math.abs(ahead - behind) > 0.5) continue;
        err = Math.max(err, Math.abs(v[i] - benchSample(s, t[i])));
      }
      expect(err, JSON.stringify(extra)).toBeLessThan(0.02);
    }
  });

  it('AM, FM, burst and sweep follow their expressions', () => {
    const mods: Record<string, string>[] = [
      { mod: 'am', modfreq: '200', depth: '50' },
      { mod: 'fm', modfreq: '200', deviation: '300' },
      { mod: 'burst', cycles: '2', burstperiod: '5m' },
      { mod: 'sweep', sweepstop: '3k', sweeptime: '4m' },
    ];
    for (const extra of mods) {
      const params = { ...BENCH_GEN_DEFAULTS, freq: '1k', amplitude: '2', ...extra };
      const s = benchGenSettings(params);
      expect(benchWave(s).kind).toBe('expr');
      const r = tran(generatorCircuit(params, '1G'), 5e-6, 6e-3);
      const t = r.scale!.re;
      const v = vec(r, 'V(OUT)');
      let err = 0;
      for (let i = 0; i < t.length; i++) err = Math.max(err, Math.abs(v[i] - benchSample(s, t[i])));
      expect(err, extra.mod).toBeLessThan(0.01);
    }
  });

  it('switching the output off leaves only a 1 GΩ resistor; SYNC is a 0 / 5 V square', () => {
    const off = buildNetlist(generatorCircuit({ output: 'off' }, '1k'), { includeAnalysis: false });
    expect(off.netlist.elements.filter((e) => e.name.includes('XAG1')).map((e) => e.type)).toEqual(['R']);
    const b = new DesignBuilder('sync');
    const g = b.part('instruments/bench-generator', 'XAG1', 100, 100, { freq: '1k' });
    b.part('sources/ground', 'GND1', 100, 160);
    b.wire(b.pin(g, 'COM'), { x: 100, y: 160 });
    b.wire(b.pin(g, 'SYNC'), { x: 120, y: 200 });
    b.label('SY', 120, 200);
    const r = tran(b.design, 10e-6, 3e-3);
    const v = vec(r, 'V(SY)');
    expect(Math.max(...v)).toBeCloseTo(5, 6);
    expect(Math.min(...v)).toBeCloseTo(0, 6);
  });

  it('rejects invalid settings with the parameter name', () => {
    expect(() => benchGenSettings({ ...BENCH_GEN_DEFAULTS, freq: '0' })).toThrow(/freq/);
    expect(() => benchGenSettings({ ...BENCH_GEN_DEFAULTS, waveform: 'pulse', width: '2m', freq: '1k' })).toThrow(/width/);
    expect(() => benchGenSettings({ ...BENCH_GEN_DEFAULTS, mod: 'burst', cycles: '5', burstperiod: '1m', freq: '1k' })).toThrow(/burstperiod/);
  });
});

describe('bench multimeter maths', () => {
  it('shows a fixed number of digits per range with 120 % over-range', () => {
    expect(dmmFormat(5.1234567, 10, 6, 'V')).toMatchObject({ text: '+05.12346', unit: 'V', overload: false, rangeLabel: '10 V' });
    expect(dmmFormat(0.0123456, 0.1, 6, 'V')).toMatchObject({ text: '+012.3456', unit: 'mV' });
    expect(dmmFormat(1.25, 1, 6, 'V').text).toBe('OVLD');
    expect(dmmFormat(-0.5, 1, 4, 'V').text).toBe('−0.5000');
    expect(dmmFormat(4700.4, 10e3, 5, 'Ω')).toMatchObject({ text: '+04.7004', unit: 'kΩ' });
    expect(dmmFormat(Number.NaN, 1, 6, 'V').text).toBe('-------');
    expect(dmmResolution(1, 6)).toBeCloseTo(1e-6, 15);
    expect(dmmResolution(10, 6)).toBeCloseTo(1e-5, 15);
    expect(dmmResolution(750, 6)).toBeCloseTo(1e-4, 12);
    expect(dmmFormat(999.5, 1000, 6, 'V')).toMatchObject({ text: '+0999.500', unit: 'V' });
  });

  it('auto-ranges to the smallest range that holds the reading', () => {
    expect(dmmAutoRange('dcv', 5.1)).toBe(10);
    expect(dmmAutoRange('dcv', 1.19)).toBe(1);
    expect(dmmAutoRange('dcv', 0.05)).toBe(0.1);
    expect(dmmAutoRange('ohm', 4700)).toBe(10e3);
    expect(dmmAutoRange('dci', 2.5e-3)).toBe(10e-3);
  });

  it('the medium rate (one 50 Hz cycle) cancels mains hum; the fast rate does not', () => {
    const time: number[] = [];
    const v: number[] = [];
    for (let k = 0; k <= 20000; k++) {
      const t = k * 1e-5;
      time.push(t);
      v.push(3.3 + 0.2 * Math.sin(2 * Math.PI * 50 * t));
    }
    const medium = dmmReadings(time, v, undefined, parseDmmSettings({ function: 'dcv', rate: 'medium' }));
    expect(medium).toHaveLength(10);
    for (const r of medium) expect(r.value).toBeCloseTo(3.3, 6);
    const fast = dmmReadings(time, v, undefined, parseDmmSettings({ function: 'dcv', rate: 'fast' }));
    const spread = Math.max(...fast.map((r) => r.value)) - Math.min(...fast.map((r) => r.value));
    expect(spread).toBeGreaterThan(0.3);
    const ac = dmmReadings(time, v, undefined, parseDmmSettings({ function: 'acv', rate: 'medium' }));
    for (const r of ac) expect(r.value).toBeCloseTo(0.2 / Math.SQRT2, 5);
    expect(acRmsOf(time, v, 0, 0.2)).toBeCloseTo(0.2 / Math.SQRT2, 6);
    // only readings after the given time are returned (statistics accumulate incrementally)
    expect(dmmReadings(time, v, undefined, parseDmmSettings({ rate: 'medium' }), 0.15).map((r) => Number(r.t.toFixed(3)))).toEqual([0.16, 0.18, 0.2]);
  });

  it('frequency and period readings', () => {
    const time: number[] = [];
    const v: number[] = [];
    for (let k = 0; k <= 50000; k++) {
      time.push(k * 4e-6);
      v.push(Math.sin(2 * Math.PI * 1234 * k * 4e-6));
    }
    const f = dmmReadings(time, v, undefined, parseDmmSettings({ function: 'freq', rate: 'medium' }));
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].value).toBeCloseTo(1234, 0);
    const p = dmmReadings(time, v, undefined, parseDmmSettings({ function: 'period', rate: 'medium' }));
    expect(p[0].value).toBeCloseTo(1 / 1234, 7);
  });

  it('statistics, null, dB, dBm and limit test', () => {
    let st = emptyStats();
    for (const x of [1, 2, 3, 4]) st = addStat(st, x);
    expect(st.count).toBe(4);
    expect(st.mean).toBeCloseTo(2.5, 12);
    expect(statSdev(st)).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(st.min).toBe(1);
    expect(st.max).toBe(4);
    const s = parseDmmSettings({ math: 'null', nullvalue: '0.25' });
    expect(dmmMath(s, 1.25).value).toBeCloseTo(1, 12);
    expect(dmmMath(parseDmmSettings({ math: 'db', dbref: '0.1' }), 1).value).toBeCloseTo(20, 9);
    expect(dmmMath(parseDmmSettings({ math: 'dbm', dbmref: '600' }), 0.774597).value).toBeCloseTo(0, 4);
    const lim = parseDmmSettings({ math: 'limit', limitlow: '4.75', limithigh: '5.25' });
    expect(dmmMath(lim, 5).limit).toBe('pass');
    expect(dmmMath(lim, 5.3).limit).toBe('high');
    expect(dmmMath(lim, 4.7).limit).toBe('low');
  });

  it('measures a resistor (test current out of HI, 10 MΩ input removed) and a current in a circuit', () => {
    const b = new DesignBuilder('dmm');
    const dmm = b.part('instruments/bench-multimeter', 'XDM1', 300, 100, { function: 'ohm' });
    const r = b.part('basic/resistor', 'R1', 500, 250, { value: '4.7k' }, { rotation: 90 });
    b.labelPin(dmm, 'HI', 'HI');
    b.labelPin(r, '1', 'HI');
    b.labelPin(dmm, 'LO', '0');
    b.labelPin(r, '2', '0');
    const res = op(b.design);
    const s = parseDmmSettings({ function: 'ohm' });
    expect(dmmOhms(vec(res, 'V(HI)')[0], s.itest, s.zin)).toBeCloseTo(4700, 3);

    const c = new DesignBuilder('dmm-i');
    const v1 = c.part('sources/dc-voltage', 'V1', 100, 200, { value: '5' });
    const r2 = c.part('basic/resistor', 'R1', 200, 140, { value: '1k' });
    const m = c.part('instruments/bench-multimeter', 'XDM1', 330, 200, { function: 'dci' });
    c.labelPin(v1, '+', 'P');
    c.labelPin(r2, '1', 'P');
    c.labelPin(r2, '2', 'Q');
    c.labelPin(m, 'I', 'Q');
    c.labelPin(m, 'LO', '0');
    c.labelPin(v1, '-', '0');
    const build = buildNetlist(c.design, { includeAnalysis: false });
    const binding = build.instruments.find((x) => x.refdes === 'XDM1')!;
    expect(binding.channels.i).toEqual({ kind: 'current', element: 'V_XDM1_i' });
    const [o] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(vec(o, 'I(V_XDM1_i)')[0]).toBeCloseTo(5 / 1000.1, 9);
  });
});

describe('oscilloscope measurements', () => {
  /** Trapezoidal square wave 0..5 V, period 1 ms, 30 % duty, 10 µs edges. */
  function square(): { t: number[]; v: number[] } {
    const t: number[] = [];
    const v: number[] = [];
    const T = 1e-3;
    const tr = 10e-6;
    for (let k = 0; k <= 50000; k++) {
      const tt = k * 1e-7 * 1;
      const x = (tt % T) / T;
      const hiEnd = 0.3;
      let y: number;
      if (x * T < tr) y = (5 * x * T) / tr;
      else if (x < hiEnd) y = 5;
      else if (x * T < hiEnd * T + tr) y = 5 - (5 * (x * T - hiEnd * T)) / tr;
      else y = 0;
      t.push(tt);
      v.push(y);
    }
    return { t, v };
  }

  it('square wave: top / base, frequency, widths, duty and 10–90 % edges', () => {
    const { t, v } = square();
    const m = measureWaveform(t, v, 0, 5e-3);
    expect(m.vtop).toBeCloseTo(5, 6);
    expect(m.vbase).toBeCloseTo(0, 6);
    expect(m.vpp).toBeCloseTo(5, 6);
    expect(m.freq).toBeCloseTo(1000, 1);
    expect(m.duty).toBeCloseTo(30, 1);
    expect(m.pwidth).toBeCloseTo(0.3e-3, 7);
    expect(m.rise).toBeCloseTo(8e-6, 8);
    expect(m.fall).toBeCloseTo(8e-6, 8);
    expect(m.overshoot).toBeCloseTo(0, 6);
  });

  it('sine with offset: mean, RMS, AC RMS; delay and phase between two channels', () => {
    const t: number[] = [];
    const a: number[] = [];
    const b: number[] = [];
    for (let k = 0; k <= 40000; k++) {
      const tt = k * 1e-7;
      t.push(tt);
      a.push(1 + 2 * Math.sin(2 * Math.PI * 1000 * tt));
      b.push(Math.sin(2 * Math.PI * 1000 * tt - Math.PI / 2));
    }
    const m = measureWaveform(t, a, 0, 4e-3);
    expect(m.vpp).toBeCloseTo(4, 4);
    expect(m.vavg).toBeCloseTo(1, 5);
    expect(m.acrms).toBeCloseTo(Math.SQRT2, 4);
    expect(m.vrms).toBeCloseTo(Math.sqrt(3), 4);
    expect(m.freq).toBeCloseTo(1000, 2);
    const d = measureDelay(t, a, b, 0, 4e-3);
    expect(d.delay).toBeCloseTo(0.25e-3, 7);
    expect(d.phase).toBeCloseTo(90, 2);
  });

  it('FFT finds the tone and its RMS level (flat-top window)', () => {
    const t: number[] = [];
    const v: number[] = [];
    for (let k = 0; k <= 20000; k++) {
      t.push(k * 5e-7);
      v.push(Math.sin(2 * Math.PI * 2000 * k * 5e-7));
    }
    const f = windowFft(t, v, 0, 0.01, 'flattop')!;
    expect(f.peakFreq).toBeCloseTo(2000, -2);
    expect(f.peakDb).toBeCloseTo(20 * Math.log10(Math.SQRT1_2), 1);
  });

  it('auto setup sizes the channels and the timebase', () => {
    const t: number[] = [];
    const a: number[] = [];
    for (let k = 0; k <= 10000; k++) {
      t.push(k * 1e-6);
      a.push(1 * Math.sin(2 * Math.PI * 1000 * k * 1e-6));
    }
    const patch = autoSetup(t, { A: a, B: undefined }, ['A', 'B']);
    expect(patch['A.scale']).toBe('500m');
    expect(patch.timebase).toBe('500u');
    expect(patch['trig.source']).toBe('A');
    expect(patch['trig.level']).toBe('0');
    expect(patch['B.scale']).toBeUndefined();
    expect(nice125(0.37)).toBe(0.5);
    expect(nice125(2)).toBe(2);
  });

  it('logic lanes: bits, bus values and measurement slots', () => {
    expect(logicBit(3, 1.4)).toBe(1);
    expect(logicBit(0.2, 1.4)).toBe(0);
    expect(logicBit(Number.NaN, 1.4)).toBe(-1);
    const lanes = [[5], [0], [5], undefined];
    expect(busValue(lanes, 0, 1.4, 4)).toBe(0b101);
    expect(busValue([[Number.NaN]], 0, 1.4, 1)).toBeNull();
    const slots = parseMeasureSlots('freq:A, vpp:B,bogus:A,rise:Z');
    expect(slots).toEqual([
      { type: 'freq', ch: 'A' },
      { type: 'vpp', ch: 'B' },
    ]);
    expect(formatMeasureSlots(slots)).toBe('freq:A,vpp:B');
  });
});

describe('bench panels render their readings', () => {
  const binding = (kind: InstrumentBinding['kind'], channels: InstrumentBinding['channels']): InstrumentBinding => ({ refdes: 'X1', partId: `instruments/${kind}`, kind, params: {}, channels, drives: [] });
  const html = (kind: InstrumentBinding['kind'], b: InstrumentBinding, stream: InstrumentStream, params: Record<string, string>) => {
    setLang('en');
    const Panel = instrumentPanels[kind]!;
    const out = renderToStaticMarkup(createElement(Panel, { binding: b, stream, simTime: 0, running: true, params, onParamsChange: () => {} })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    setLang('vi');
    return out;
  };

  it('multimeter shows the 6½-digit reading and statistics', () => {
    const s = new InstrumentStream(['v', 'i']);
    for (let k = 0; k <= 10000; k++) s.push(k * 1e-5, [1.23456, Number.NaN]);
    const text = html('bench-multimeter', binding('bench-multimeter', { v: { kind: 'voltage', pos: 'a', neg: '0' } }), s, { function: 'dcv', math: 'stats' });
    expect(text).toContain('+01.23456');
    expect(text).toContain('10 V');
    expect(text).toContain('Count 5');
  });

  it('generator shows its frequency and amplitude', () => {
    const text = html('bench-generator', binding('bench-generator', { out: { kind: 'voltage', pos: 'o', neg: '0' } }), new InstrumentStream(['out']), { freq: '2.5k', amplitude: '3' });
    expect(text).toContain('2.5 kHz');
    expect(text).toContain('3 Vpp');
  });

  it('storage scope shows automatic measurements of the displayed record', () => {
    const s = new InstrumentStream(['A', 'B', 'C', 'D', 'ext']);
    for (let k = 0; k <= 20000; k++) {
      const t = k * 5e-7;
      s.push(t, [2 * Math.sin(2 * Math.PI * 1000 * t), Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
    }
    const text = html('bench-scope', binding('bench-scope', { A: { kind: 'voltage', pos: 'a', neg: '0' } }), s, { timebase: '500u', meas: 'freq:A,vpp:A' });
    expect(text).toMatch(/CH1 Freq: 1(\.000)? kHz/);
    expect(text).toMatch(/CH1 Pk-pk: 4(\.000)? V/);
  });
});
