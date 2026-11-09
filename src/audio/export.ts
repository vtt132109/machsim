/**
 * WAV export of a simulated trace (Grapher › Export WAV…): any vector of a time-domain result,
 * resampled evenly and written as a WAV file.
 *
 *   traceToWav(time, values, options)  -> { bytes, seconds, samples, clipped, rate, bits }
 *
 * The signal's own time is what it is — a 1 kHz tone simulated for 5 ms is a 5 ms sound. `stretch`
 * multiplies the time so such a short trace becomes audible (stretch 1000 turns 5 ms into 5 s and
 * the 1 kHz tone into 1 Hz; use a smaller factor to keep the pitch audible). Without normalisation
 * 1 V is full scale and larger values clip (reported in `clipped`).
 */
import { dcRemove, normalizePeak, resampleUniform } from './resample';
import { encodeWav, type WavEncoding } from './wav';

export interface WavExportOptions {
  /** samples per second of the file (default 44100) */
  rate?: number;
  /** multiplies the time axis (default 1) */
  stretch?: number;
  /** scale the peak to 0.98 of full scale (default true) */
  normalize?: boolean;
  /** subtract the mean first (default false) */
  removeDc?: boolean;
  encoding?: WavEncoding;
}

export interface WavExport {
  bytes: Uint8Array;
  /** length of the sound in seconds */
  seconds: number;
  samples: number;
  /** samples beyond ±1 (only without normalisation) */
  clipped: number;
  rate: number;
  bits: number;
}

export class WavExportError extends Error {
  constructor(readonly code: 'empty' | 'short' | 'rate') {
    super(code);
    this.name = 'WavExportError';
  }
}

const BITS: Record<WavEncoding, number> = { pcm8: 8, pcm16: 16, pcm24: 24, float32: 32 };

/** Resample a trace evenly and write it as a WAV file. Throws WavExportError for an unusable trace. */
export function traceToWav(time: ArrayLike<number>, values: ArrayLike<number>, options: WavExportOptions = {}): WavExport {
  const rate = options.rate ?? 44100;
  const stretch = options.stretch ?? 1;
  if (!(rate >= 1000 && rate <= 384000) || !(stretch > 0)) throw new WavExportError('rate');
  const n = Math.min(time.length, values.length);
  if (n === 0) throw new WavExportError('empty');
  // a stretched time axis is the same samples at later times; samples that are not numbers are skipped
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(values[i])) continue;
    t[k] = time[i] * stretch;
    v[k] = values[i];
    k++;
  }
  if (k < 2) throw new WavExportError('empty');
  let samples = resampleUniform(t.subarray(0, k), v.subarray(0, k), rate);
  if (samples.length < 2) throw new WavExportError('short');
  if (options.removeDc) samples = dcRemove(samples);
  if (options.normalize ?? true) samples = normalizePeak(samples, 0.98);
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > 1) clipped++;
  const encoding = options.encoding ?? 'pcm16';
  return { bytes: encodeWav({ sampleRate: rate, channels: [samples] }, { encoding }), seconds: samples.length / rate, samples: samples.length, clipped, rate, bits: BITS[encoding] };
}
