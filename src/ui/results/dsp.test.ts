import { describe, expect, it } from 'vitest';
import {
  amplitudeSpectrum,
  analyzeHarmonics,
  coherentGain,
  enbwBins,
  estimateFrequency,
  fft,
  interpolate,
  levelCrossings,
  makeWindow,
  resampleUniform,
  rms,
  sinad,
  spectrumPeak,
  thd,
  timeMean,
  timeRms,
  unwrapDeg,
  wrapDeg,
} from './dsp';

/** Non-uniform time grid (like a variable-step transient) over [0, tEnd]. */
function jitteredTime(n: number, tEnd: number): Float64Array {
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const jitter = i > 0 && i < n - 1 ? 0.3 * Math.sin(i * 1.7) : 0;
    t[i] = ((i + jitter) / (n - 1)) * tEnd;
  }
  return t;
}

function naiveDft(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const oRe: number[] = [];
  const oIm: number[] = [];
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let j = 0; j < n; j++) {
      const a = (-2 * Math.PI * k * j) / n;
      sr += re[j] * Math.cos(a) - im[j] * Math.sin(a);
      si += re[j] * Math.sin(a) + im[j] * Math.cos(a);
    }
    oRe.push(sr);
    oIm.push(si);
  }
  return { re: oRe, im: oIm };
}

describe('fft', () => {
  it('matches a direct DFT for power-of-two and arbitrary lengths', () => {
    for (const n of [8, 12, 17, 64, 100]) {
      const re = Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.2 * Math.cos(i * 1.3));
      const im = Array.from({ length: n }, (_, i) => 0.1 * i - 0.5);
      const ref = naiveDft(re, im);
      const got = fft(re, im);
      for (let k = 0; k < n; k++) {
        expect(got.re[k]).toBeCloseTo(ref.re[k], 8);
        expect(got.im[k]).toBeCloseTo(ref.im[k], 8);
      }
    }
  });

  it('inverse transform restores the input', () => {
    const x = [1, -2, 3.5, 0.25, 7, -1, 0, 2, 9];
    const X = fft(x);
    const back = fft(X.re, X.im, true);
    x.forEach((v, i) => {
      expect(back.re[i]).toBeCloseTo(v, 10);
      expect(back.im[i]).toBeCloseTo(0, 10);
    });
  });

  it('puts a bin-centred cosine in exactly one bin pair', () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => 3 * Math.cos((2 * Math.PI * 5 * i) / n));
    const X = fft(x);
    expect(Math.hypot(X.re[5], X.im[5])).toBeCloseTo(3 * 32, 9);
    expect(Math.hypot(X.re[59], X.im[59])).toBeCloseTo(3 * 32, 9);
    expect(Math.hypot(X.re[6], X.im[6])).toBeLessThan(1e-9);
  });
});

describe('windows', () => {
  it('have the textbook coherent gains and noise bandwidths', () => {
    const n = 4096;
    expect(coherentGain(makeWindow('rect', n))).toBeCloseTo(1, 12);
    expect(coherentGain(makeWindow('hann', n))).toBeCloseTo(0.5, 9);
    expect(enbwBins(makeWindow('hann', n))).toBeCloseTo(1.5, 6);
    expect(coherentGain(makeWindow('blackman-harris', n))).toBeCloseTo(0.35875, 9);
    expect(enbwBins(makeWindow('blackman-harris', n))).toBeCloseTo(2.0045, 3);
    expect(coherentGain(makeWindow('flattop', n))).toBeCloseTo(0.21557895, 8);
    expect(enbwBins(makeWindow('flattop', n))).toBeCloseTo(3.77, 2);
  });
});

describe('amplitudeSpectrum', () => {
  const fs = 10240;
  const n = 1024; // df = 10 Hz

  it('reads the peak amplitude of a bin-centred sine for every window', () => {
    const x = Float64Array.from({ length: n }, (_, i) => 2 * Math.sin((2 * Math.PI * 1000 * i) / fs) + 0.5);
    for (const w of ['rect', 'hann', 'blackman-harris', 'flattop'] as const) {
      const s = amplitudeSpectrum(x, fs, { window: w });
      expect(s.df).toBeCloseTo(10, 12);
      expect(s.amplitude[100]).toBeCloseTo(2, 6);
      expect(s.freq[100]).toBeCloseTo(1000, 9);
    }
    const s = amplitudeSpectrum(x, fs, { window: 'rect' });
    expect(s.amplitude[0]).toBeCloseTo(0.5, 9);
  });

  it('flat-top window reads an off-bin sine within 0.1 %', () => {
    const f = 1234.5; // between bins
    const x = Float64Array.from({ length: n }, (_, i) => 1.5 * Math.sin((2 * Math.PI * f * i) / fs));
    const s = amplitudeSpectrum(x, fs, { window: 'flattop' });
    const peak = spectrumPeak(s);
    expect(Math.abs(peak.amplitude - 1.5) / 1.5).toBeLessThan(1e-3);
    expect(Math.abs(peak.freq - f)).toBeLessThan(2); // well inside one 10 Hz bin
  });

  it('zero padding refines the bin spacing without changing the amplitude', () => {
    const x = Float64Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * 500 * i) / 10000));
    const s = amplitudeSpectrum(x, 10000, { window: 'hann', fftLength: 8192 });
    expect(s.freq.length).toBe(4097);
    expect(s.df).toBeCloseTo(10000 / 8192, 12);
    const p = spectrumPeak(s);
    expect(Math.abs(p.freq - 500)).toBeLessThan(0.2);
    expect(p.amplitude).toBeCloseTo(1, 2);
  });
});

describe('resampling, mean and RMS', () => {
  it('resamples a ramp exactly and excludes the end point', () => {
    const t = [0, 0.1, 0.5, 1];
    const v = [0, 1, 5, 10];
    const r = resampleUniform(t, v, 4);
    expect(r.dt).toBeCloseTo(0.25, 12);
    expect(Array.from(r.values)).toEqual([0, 2.5, 5, 7.5].map((x) => expect.closeTo(x, 12)));
    expect(interpolate(t, v, 0.3)).toBeCloseTo(3, 12);
    expect(interpolate(t, v, -1)).toBe(0);
    expect(interpolate(t, v, 2)).toBe(10);
  });

  it('computes sample RMS and time-weighted mean / RMS on non-uniform grids', () => {
    expect(rms([3, -3, 3, -3])).toBeCloseTo(3, 12);
    const t = jitteredTime(20001, 0.01); // 10 periods of 1 kHz
    const v = Float64Array.from(t, (x) => 1 + 2 * Math.sin(2 * Math.PI * 1000 * x));
    expect(timeMean(t, v)).toBeCloseTo(1, 4);
    // RMS of 1 + 2 sin = sqrt(1 + 2) = 1.7320508
    expect(timeRms(t, v)).toBeCloseTo(Math.sqrt(3), 4);
    // triangle-free exact case: linear ramp 0..1 has RMS 1/sqrt(3)
    expect(timeRms([0, 1], [0, 1])).toBeCloseTo(1 / Math.sqrt(3), 12);
  });
});

describe('frequency estimation', () => {
  it('finds the frequency of a non-uniformly sampled sine', () => {
    const t = jitteredTime(50001, 0.005);
    const v = Float64Array.from(t, (x) => 0.3 + Math.sin(2 * Math.PI * 4321 * x + 0.4));
    expect(estimateFrequency(t, v)).toBeCloseTo(4321, 1);
  });

  it('ignores noise within the hysteresis band', () => {
    const n = 20000;
    const t = Float64Array.from({ length: n }, (_, i) => i * 1e-6);
    // 1 kHz square wave with small high-frequency ripple near the edges
    const v = Float64Array.from(t, (x) => (Math.sin(2 * Math.PI * 1000 * x) >= 0 ? 1 : -1) + 0.02 * Math.sin(2 * Math.PI * 300000 * x));
    const c = levelCrossings(t, v, { level: 0, hysteresis: 0.1 });
    expect(c.length).toBe(19); // rising edges at 1, 2, ..., 19 ms
    expect(estimateFrequency(t, v, { level: 0 })).toBeCloseTo(1000, 0);
  });

  it('returns NaN for a constant signal', () => {
    expect(estimateFrequency([0, 1, 2], [1, 1, 1])).toBeNaN();
  });
});

describe('harmonic analysis', () => {
  const f0 = 1000;
  const t = jitteredTime(40001, 0.02);

  it('measures THD of known distortion: 10 % third + 5 % fifth harmonic', () => {
    const v = Float64Array.from(t, (x) => {
      const w = 2 * Math.PI * f0 * x;
      return 0.2 + Math.sin(w) + 0.1 * Math.sin(3 * w) + 0.05 * Math.sin(5 * w + 1);
    });
    const h = analyzeHarmonics(t, v, { fundamental: f0, harmonics: 9 });
    expect(h.periods).toBe(20);
    expect(h.dc).toBeCloseTo(0.2, 4);
    expect(h.amplitudes[1]).toBeCloseTo(1, 3);
    expect(h.amplitudes[3]).toBeCloseTo(0.1, 3);
    expect(h.amplitudes[5]).toBeCloseTo(0.05, 3);
    expect(h.amplitudes[2]).toBeLessThan(1e-3);
    expect(h.thd).toBeCloseTo(Math.sqrt(0.01 + 0.0025), 3);
    expect(thd(t, v, f0)).toBeCloseTo(0.1118034, 3);
    // SINAD: P_ac = 0.5 + 0.005 + 0.00125, P_nd = 0.00625 -> 10 log10(81) = 19.085 dB
    expect(h.sinad).toBeCloseTo(10 * Math.log10(0.50625 / 0.00625), 1);
    expect(sinad(t, v, f0)).toBeCloseTo(19.085, 1);
  });

  it('estimates the fundamental itself and reports the fundamental phase', () => {
    const v = Float64Array.from(t, (x) => 2 * Math.sin(2 * Math.PI * f0 * x + Math.PI / 6));
    const h = analyzeHarmonics(t, v);
    expect(h.fundamental).toBeCloseTo(1000, 0);
    expect(h.amplitudes[1]).toBeCloseTo(2, 2);
    expect(h.phases[1]).toBeCloseTo(30, 0);
    expect(h.thd).toBeLessThan(2e-3);
    expect(h.acRms).toBeCloseTo(Math.SQRT2, 3);
  });

  it('a symmetric square wave has THD close to the theoretical 48.3 %', () => {
    const n = 200000;
    const tt = Float64Array.from({ length: n }, (_, i) => (i / n) * 0.01);
    const v = Float64Array.from(tt, (x) => (((x * f0) % 1) < 0.5 ? 1 : -1));
    // Theoretical THD with infinitely many harmonics = sqrt(pi^2/8 - 1) = 0.4834
    const h = analyzeHarmonics(tt, v, { fundamental: f0, harmonics: 99, samplesPerPeriod: 2048 });
    expect(h.amplitudes[1]).toBeCloseTo(4 / Math.PI, 2);
    expect(h.thd).toBeGreaterThan(0.47);
    expect(h.thd).toBeLessThan(0.4834);
  });
});

describe('phase helpers', () => {
  it('wraps and unwraps degrees', () => {
    expect(wrapDeg(190)).toBeCloseTo(-170, 12);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(725)).toBeCloseTo(5, 12);
    const u = unwrapDeg([170, 179, -175, -160, 175]);
    expect(Array.from(u)).toEqual([170, 179, 185, 200, 175].map((x) => expect.closeTo(x, 9)));
  });
});
