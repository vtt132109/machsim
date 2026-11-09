import { describe, expect, it } from 'vitest';
import {
  counterMeasure,
  crossingsAbs,
  decibels,
  distortionMeasure,
  meterMeasure,
  pairForward,
  periodWindow,
  powerMeasure,
  spectrumLevel,
  spectrumMeasure,
} from './measure';
import { METER_MIN_EXP, autoRange, formatDb, meterValue, ohmsFromVoltage, parseMeterSettings, validateMeterParams } from './meter';

/** Non-uniform time grid (like a simulator's adaptive steps) over [0, tEnd]. */
function jitteredTime(tEnd: number, n: number): Float64Array {
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // smooth, monotonic distortion of the uniform grid (steps vary by about +/-30 %)
    t[i] = tEnd * (u + (0.3 / (2 * Math.PI * 7)) * Math.sin(2 * Math.PI * 7 * u));
  }
  return t;
}

function sampled(t: Float64Array, f: (x: number) => number): Float64Array {
  return t.map(f);
}

describe('multimeter measurement', () => {
  const t = jitteredTime(20.3e-3, 20000);
  const w = 2 * Math.PI * 1000;

  it('reads DC mean, AC true RMS and total RMS of an offset sine over whole periods', () => {
    const v = sampled(t, (x) => 1 + 2 * Math.sin(w * x));
    const m = meterMeasure(t, v);
    expect(m.periods).toBeGreaterThanOrEqual(19);
    expect(m.freq).toBeCloseTo(1000, 0);
    expect(m.dc).toBeCloseTo(1, 3);
    expect(m.acRms).toBeCloseTo(2 / Math.SQRT2, 3);
    expect(m.totalRms).toBeCloseTo(Math.sqrt(3), 3);
    expect(m.max).toBeCloseTo(3, 2);
    expect(m.min).toBeCloseTo(-1, 2);
  });

  it('reads the settled value of an aperiodic (exponential) signal', () => {
    const tt = jitteredTime(10e-3, 4000);
    const v = sampled(tt, (x) => 5 * (1 - Math.exp(-x / 1e-3)));
    const m = meterMeasure(tt, v);
    expect(m.periods).toBe(0);
    // newest 5 % of the record: 9.5 .. 10 ms, where the signal is within 0.04 % of 5 V
    expect(m.dc).toBeCloseTo(5, 2);
    expect(m.latest).toBeCloseTo(5 * (1 - Math.exp(-10)), 9);
  });

  it('true RMS of a square wave equals its amplitude', () => {
    const tt = new Float64Array(40001).map((_, i) => (i * 10e-3) / 40000);
    const v = sampled(tt, (x) => (x * 1000) % 1 < 0.5 ? 3 : -3);
    const m = meterMeasure(tt, v);
    expect(m.acRms).toBeCloseTo(3, 1);
    expect(Math.abs(m.dc)).toBeLessThan(0.05);
  });

  it('locates whole periods with interpolated crossings', () => {
    const v = sampled(t, (x) => Math.sin(w * x));
    const pw = periodWindow(t, v, 5);
    expect(pw.periods).toBe(5);
    expect(pw.t1 - pw.t0).toBeCloseTo(5e-3, 6);
  });

  it('converts RMS to dB against a reference', () => {
    expect(decibels(0.774597, 0.774597)).toBeCloseTo(0, 9);
    expect(decibels(7.74597, 0.774597)).toBeCloseTo(20, 9);
  });
});

describe('multimeter reading logic', () => {
  it('parses settings with defaults and validates fields', () => {
    const s = parseMeterSettings({ mode: 'OHM', coupling: 'ac', itest: '10m', ri: 'oops' });
    expect(s).toEqual({ mode: 'ohm', coupling: 'ac', ri: 1e9, ra: 0, itest: 0.01, dbref: 0.774597 });
    expect(validateMeterParams({ ri: '0', itest: '-1', ra: '5', dbref: 'x' }).map((e) => e.key)).toEqual(['ri', 'itest', 'dbref']);
  });

  it('computes ohms from the test-current voltage, correcting for the shunt', () => {
    // 1 kOhm || 1 GOhm driven with 1 mA
    const rpar = 1 / (1 / 1e3 + 1 / 1e9);
    expect(ohmsFromVoltage(1e-3 * rpar, 1e-3, 1e9)).toBeCloseTo(1000, 6);
    // open leads: only the shunt carries the current
    expect(ohmsFromVoltage(1e-3 * 1e9, 1e-3, 1e9)).toBe(Number.POSITIVE_INFINITY);
    expect(ohmsFromVoltage(-0.2, 1e-3, 1e9)).toBe(Number.POSITIVE_INFINITY);
    expect(ohmsFromVoltage(0, 1e-3, 1e9)).toBe(0);
  });

  it('selects the reading for each function and coupling', () => {
    const v = { dc: 2, acRms: 0.5, totalRms: Math.sqrt(4.25), max: 3, min: 1, latest: 2, freq: 50, periods: 10 };
    const i = { ...v, dc: -0.01, acRms: 0.002 };
    expect(meterValue(parseMeterSettings({ mode: 'v' }), v, null)).toBe(2);
    expect(meterValue(parseMeterSettings({ mode: 'v', coupling: 'ac' }), v, null)).toBe(0.5);
    expect(meterValue(parseMeterSettings({ mode: 'a' }), v, i)).toBe(-0.01);
    expect(meterValue(parseMeterSettings({ mode: 'a', coupling: 'ac' }), v, i)).toBe(0.002);
    expect(meterValue(parseMeterSettings({ mode: 'db', coupling: 'ac', dbref: '0.05' }), v, null)).toBeCloseTo(20, 9);
    expect(meterValue(parseMeterSettings({ mode: 'ohm', itest: '1m', ri: '0' }), { ...v, dc: 4.7 }, null)).toBeCloseTo(4700, 9);
    expect(Number.isNaN(meterValue(parseMeterSettings({ mode: 'a' }), v, null))).toBe(true);
  });

  it('auto-ranges like a 4 1/2 digit meter', () => {
    expect(autoRange(1.2345, 'V')).toMatchObject({ text: '1.2345', prefix: '', rangeLabel: '2 V', overload: false });
    expect(autoRange(12.345, 'V')).toMatchObject({ text: '12.345', prefix: '', rangeLabel: '20 V' });
    expect(autoRange(123.456, 'V')).toMatchObject({ text: '123.46', rangeLabel: '200 V' });
    expect(autoRange(1234.5, 'V')).toMatchObject({ text: '1.2345', prefix: 'k', rangeLabel: '2 kV' });
    expect(autoRange(-0.0123, 'A')).toMatchObject({ text: '-12.300', prefix: 'm', rangeLabel: '20 mA' });
    // 1.99996 rounds to 20000 counts on the 2 V range -> next range up
    expect(autoRange(1.99996, 'V')).toMatchObject({ text: '2.000', rangeLabel: '20 V' });
    expect(autoRange(0, 'V', METER_MIN_EXP.v)).toMatchObject({ text: '0.0000', prefix: 'm', rangeLabel: '2 mV' });
    expect(autoRange(-1e-12, 'V', METER_MIN_EXP.v).text).toBe('0.0000');
    expect(autoRange(Number.POSITIVE_INFINITY, 'Ω')).toMatchObject({ text: 'OL', overload: true });
    expect(autoRange(5e9, 'Ω')).toMatchObject({ text: 'OL', overload: true });
    expect(autoRange(Number.NaN, 'V').text).toBe('----');
    expect(formatDb(-3.0103)).toBe('-3.01');
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe('-∞');
  });
});

describe('wattmeter', () => {
  it('measures average power and power factor of phase-shifted sinusoids', () => {
    const t = jitteredTime(10.25e-3, 20000);
    const w = 2 * Math.PI * 1000;
    const v = sampled(t, (x) => 10 * Math.sin(w * x));
    const i = sampled(t, (x) => 2 * Math.sin(w * x - Math.PI / 3));
    const p = powerMeasure(t, v, i);
    expect(p.power).toBeCloseTo(5, 3);
    expect(p.vRms).toBeCloseTo(10 / Math.SQRT2, 3);
    expect(p.iRms).toBeCloseTo(2 / Math.SQRT2, 3);
    expect(p.apparent).toBeCloseTo(10, 2);
    expect(p.powerFactor).toBeCloseTo(0.5, 3);
    expect(p.reactive).toBeCloseTo(10 * Math.sin(Math.PI / 3), 2);
  });

  it('measures DC power exactly', () => {
    const t = Float64Array.from([0, 0.1, 0.25, 1]);
    const p = powerMeasure(t, Float64Array.from([12, 12, 12, 12]), Float64Array.from([0.5, 0.5, 0.5, 0.5]));
    expect(p.power).toBeCloseTo(6, 12);
    expect(p.powerFactor).toBeCloseTo(1, 12);
  });
});

describe('frequency counter', () => {
  // 2 kHz trapezoid: 0..5 V, 30 % duty, 10 us linear edges
  const f = 2000;
  const T = 1 / f;
  const tr = 10e-6;
  const wave = (x: number) => {
    const ph = ((x % T) + T) % T;
    const high = 0.3 * T;
    if (ph < tr) return (5 * ph) / tr;
    if (ph < high) return 5;
    if (ph < high + tr) return 5 - (5 * (ph - high)) / tr;
    return 0;
  };
  const t = new Float64Array(200001).map((_, i) => (i * 10e-3) / 200000);
  const v = sampled(t, wave);

  it('measures frequency, period, pulse widths, duty and transition times', () => {
    const m = counterMeasure(t, v, { coupling: 'dc', level: 2.5 });
    expect(m.freq).toBeCloseTo(2000, 3);
    expect(m.period).toBeCloseTo(5e-4, 9);
    // crossings of 2.5 V happen mid-edge, so the high time is exactly 0.3 T
    expect(m.pulsePos).toBeCloseTo(0.3 * T, 8);
    expect(m.pulseNeg).toBeCloseTo(0.7 * T, 8);
    expect(m.duty).toBeCloseTo(0.3, 6);
    expect(m.rise).toBeCloseTo(0.8 * tr, 8);
    expect(m.fall).toBeCloseTo(0.8 * tr, 8);
    expect(m.vmax).toBe(5);
    expect(m.vmin).toBe(0);
  });

  it('pairs start/end events in linear time', () => {
    expect(pairForward([1, 3, 5], [2, 4, 6])).toEqual([1, 1, 1]);
    // a start followed by another start before any end is skipped
    expect(pairForward([1, 1.5, 3], [2, 4])).toEqual([0.5, 1]);
  });

  it('applies absolute hysteresis to crossings', () => {
    const tt = [0, 1, 2, 3, 4, 5, 6];
    const vv = [-1, 0.1, -0.05, 0.2, 1, -1, 1];
    expect(crossingsAbs(tt, vv, 0, true, 0).length).toBe(3);
    expect(crossingsAbs(tt, vv, 0, true, 0.5).length).toBe(2);
  });
});

describe('distortion analyzer', () => {
  const t = new Float64Array(50001).map((_, i) => (i * 10e-3) / 50000);
  const w = 2 * Math.PI * 1000;
  const v = sampled(t, (x) => Math.sin(w * x) + 0.1 * Math.sin(3 * w * x) + 0.05 * Math.cos(5 * w * x));

  it('computes THD with the IEEE and IEC definitions', () => {
    const ieee = distortionMeasure(t, v, { fundamental: 1000, harmonics: 10 });
    const h = Math.sqrt(0.1 ** 2 + 0.05 ** 2);
    expect(ieee.thd).toBeCloseTo(h, 5);
    expect(ieee.thdPercent).toBeCloseTo(100 * h, 3);
    expect(ieee.harmonics[1]).toBeCloseTo(1, 5);
    expect(ieee.harmonics[3]).toBeCloseTo(0.1, 5);
    expect(ieee.harmonics[5]).toBeCloseTo(0.05, 5);
    const iec = distortionMeasure(t, v, { fundamental: 1000, definition: 'iec' });
    expect(iec.thd).toBeCloseTo(h / Math.sqrt(1 + h * h), 5);
    // pure harmonic distortion: SINAD = 10 log10((1 + h^2) / h^2)
    expect(ieee.sinad).toBeCloseTo(10 * Math.log10((1 + h * h) / (h * h)), 2);
  });

  it('estimates the fundamental when it is not given', () => {
    const m = distortionMeasure(t, v);
    expect(m.fundamental).toBeCloseTo(1000, 0);
    expect(m.thd).toBeCloseTo(Math.sqrt(0.0125), 3);
  });
});

describe('spectrum analyzer', () => {
  it('finds a 1 kHz tone with its RMS level (flat-top window)', () => {
    const t = jitteredTime(50e-3, 60000);
    const v = sampled(t, (x) => 2 * Math.sin(2 * Math.PI * 1000 * x) + 0.5);
    const s = spectrumMeasure(t, v, { start: 0, stop: 5000, resolution: 20, window: 'flattop' });
    expect(s.peakFreq).toBeGreaterThan(980);
    expect(s.peakFreq).toBeLessThan(1020);
    expect(s.peakRms).toBeCloseTo(Math.SQRT2, 2);
    expect(s.freq[0]).toBe(0);
    expect(s.rms[0]).toBeCloseTo(0.5, 2);
    expect(s.freq[s.freq.length - 1]).toBeLessThanOrEqual(5000 + 1e-6);
    expect(s.fs).toBeGreaterThanOrEqual(2.56 * 5000);
  });

  it('converts RMS volts to display units', () => {
    expect(spectrumLevel(1, 'dBV')).toBe(0);
    expect(spectrumLevel(0.1, 'dBV')).toBeCloseTo(-20, 12);
    // 0.2236 V RMS into 50 ohm = 1 mW = 0 dBm
    expect(spectrumLevel(Math.sqrt(0.05), 'dBm')).toBeCloseTo(0, 9);
    expect(spectrumLevel(0.3, 'lin')).toBe(0.3);
  });
});
