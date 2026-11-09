import { describe, expect, it } from 'vitest';
import { wavSamples } from '../library/catalog/audio';
import { WavExportError, traceToWav } from './export';
import { WavError, decodeWav, encodeWav } from './wav';
import { wavImportFromBytes, wavParamInfo } from './wavParam';

function frequencyOf(x: ArrayLike<number>, fs: number): number {
  const ups: number[] = [];
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  return ups.length < 3 ? 0 : ((ups.length - 1) * fs) / (ups[ups.length - 1] - ups[0]);
}

/** Irregular samples of a sine like a transient result */
function trace(f: number, dur: number, amp = 1) {
  const t: number[] = [0];
  let s = 7;
  while (t[t.length - 1] < dur) {
    s = (s * 1664525 + 1013904223) >>> 0;
    t.push(t[t.length - 1] + 4e-6 + (s / 4294967296) * 30e-6);
  }
  return { t, v: t.map((x) => amp * Math.sin(2 * Math.PI * f * x)) };
}

describe('traceToWav', () => {
  it('a 1 kHz trace is a 1 kHz WAV of the right length', () => {
    const { t, v } = trace(1000, 0.1, 0.5);
    const e = traceToWav(t, v, { rate: 44100, normalize: false });
    expect(e.bits).toBe(16);
    expect(e.seconds).toBeCloseTo(0.1, 2);
    const wav = decodeWav(e.bytes);
    expect(wav.sampleRate).toBe(44100);
    expect(frequencyOf(wav.channels[0], 44100)).toBeCloseTo(1000, 0);
    expect(Math.max(...wav.channels[0])).toBeCloseTo(0.5, 2);
    expect(e.clipped).toBe(0);
  });

  it('normalises the peak to 0.98, reports clipping without it, and removes DC', () => {
    const { t, v } = trace(1000, 0.02, 3);
    const clipped = traceToWav(t, v, { normalize: false });
    expect(clipped.clipped).toBeGreaterThan(100);
    const norm = traceToWav(t, v, {});
    expect(norm.clipped).toBe(0);
    expect(Math.max(...decodeWav(norm.bytes).channels[0])).toBeCloseTo(0.98, 2);
    const dc = traceToWav(
      t,
      v.map((x) => x + 5),
      { removeDc: true, normalize: true },
    );
    const ch = decodeWav(dc.bytes).channels[0];
    const mean = ch.reduce((a, b) => a + b, 0) / ch.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });

  it('time stretch lowers the pitch by the same factor', () => {
    const { t, v } = trace(1000, 0.01, 1);
    const e = traceToWav(t, v, { rate: 8000, stretch: 4 });
    expect(e.seconds).toBeCloseTo(0.04, 2);
    expect(frequencyOf(decodeWav(e.bytes).channels[0], 8000)).toBeGreaterThan(240);
    expect(frequencyOf(decodeWav(e.bytes).channels[0], 8000)).toBeLessThan(260);
  });

  it('skips NaN samples and refuses unusable traces', () => {
    expect(() => traceToWav([], [])).toThrowError(WavExportError);
    expect(() => traceToWav([0, 1], [Number.NaN, Number.NaN])).toThrowError(WavExportError);
    expect(() => traceToWav([0, 1e-6], [0, 1])).toThrowError(WavExportError);
    expect(() => traceToWav([0, 1], [0, 1], { rate: 10 })).toThrowError(WavExportError);
    const e = traceToWav([0, 0.001, 0.002, 0.003], [0, Number.NaN, 1, 0], { rate: 8000, normalize: false });
    expect(e.samples).toBeGreaterThan(10);
  });

  it('writes the other bit depths', () => {
    const { t, v } = trace(500, 0.02);
    expect(traceToWav(t, v, { encoding: 'pcm24' }).bits).toBe(24);
    expect(decodeWav(traceToWav(t, v, { encoding: 'float32' }).bytes).channels[0].length).toBeGreaterThan(100);
  });
});

describe('WAV import for a source part', () => {
  const tone = (n: number, fs: number, f: number) => Float32Array.from({ length: n }, (_, i) => 0.8 * Math.sin((2 * Math.PI * f * i) / fs));

  it('a 44.1 kHz stereo clip becomes 16 kHz mono, a long one 8 kHz, with the same pitch', () => {
    const l = tone(44100, 44100, 440);
    const imp = wavImportFromBytes(encodeWav({ sampleRate: 44100, channels: [l, l] }));
    expect(imp.rate).toBe(16000);
    expect(imp.resampledFrom).toBe(44100);
    expect(imp.seconds).toBeCloseTo(1, 2);
    expect(imp.cut).toBe(false);
    const { rate, samples } = wavSamples(imp.text);
    expect(rate).toBe(16000);
    expect(frequencyOf(samples, rate)).toBeGreaterThan(436);
    expect(frequencyOf(samples, rate)).toBeLessThan(444);
    expect(Math.max(...samples)).toBeGreaterThan(0.75);
    const long = wavImportFromBytes(encodeWav({ sampleRate: 44100, channels: [tone(44100 * 20, 44100, 440)] }));
    expect(long.rate).toBe(8000);
    expect(long.seconds).toBeCloseTo(20, 1);
  });

  it('cuts a very long file at the limit and keeps a low rate as it is', () => {
    const imp = wavImportFromBytes(encodeWav({ sampleRate: 8000, channels: [new Float32Array(8000 * 40)] }));
    expect(imp.cut).toBe(true);
    expect(imp.seconds).toBe(30);
    expect(imp.rate).toBe(8000);
    expect(wavImportFromBytes(encodeWav({ sampleRate: 4000, channels: [new Float32Array(400)] })).rate).toBe(4000);
  });

  it('describes a stored parameter from its header and rejects non-WAV bytes', () => {
    const imp = wavImportFromBytes(encodeWav({ sampleRate: 8000, channels: [new Float32Array(16000)] }));
    expect(wavParamInfo(imp.text)).toEqual({ rate: 8000, seconds: 2 });
    expect(wavParamInfo('')).toBeNull();
    expect(wavParamInfo('hello world!!')).toBeNull();
    expect(() => wavImportFromBytes(Uint8Array.from([1, 2, 3]))).toThrowError(WavError);
  });
});
