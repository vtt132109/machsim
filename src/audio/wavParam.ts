/**
 * WAV files as part parameters (the WAV file sources): import a file for the properties panel and
 * describe what a parameter holds without decoding all of it.
 *
 *   wavImportFromBytes(bytes)   decode, mix to mono, reduce the rate and the length to what a
 *                               simulation source can play, and return the parameter text
 *   wavParamInfo(text)          { rate, seconds } from the header of a stored parameter
 *
 * A source plays every sample as a time point of a piece-wise linear source, so the import keeps
 * the file light: files above 16 kHz are reduced to 8 kHz (box-filter average), shorter ones may keep
 * 16 kHz, and the length is cut to WAV_PARAM_MAX_SAMPLES samples (30 s at 8 kHz, 15 s at 16 kHz).
 */
import { PcmResampler } from './resample';
import { WavError, base64ToBytes, decodeWav, wavLength, wavToParam, type WavData } from './wav';

/** Most samples a WAV source part accepts (src/library/catalog/audio.ts uses the same number). */
export const WAV_PARAM_MAX_SAMPLES = 240_000;

export interface WavImport {
  /** the parameter text (base64 of a mono 16-bit WAV) */
  text: string;
  rate: number;
  seconds: number;
  /** the file was longer than the limit and was cut */
  cut: boolean;
  /** the original rate when it was reduced */
  resampledFrom?: number;
  /** length of the original in seconds */
  originalSeconds: number;
}

/** Decode a WAV file for a source part. Throws WavError. */
export function wavImportFromBytes(bytes: Uint8Array): WavImport {
  const wav = decodeWav(bytes);
  const n = wavLength(wav);
  const originalSeconds = n / wav.sampleRate;
  const mono = new Float32Array(n);
  for (const ch of wav.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / wav.channels.length;
  // 16 kHz is kept for clips that fit in the limit, everything else goes to 8 kHz
  const rate = wav.sampleRate <= 8000 ? wav.sampleRate : originalSeconds * Math.min(wav.sampleRate, 16000) <= WAV_PARAM_MAX_SAMPLES ? Math.min(wav.sampleRate, 16000) : Math.min(wav.sampleRate, 8000);
  let samples: Float32Array = mono;
  if (rate < wav.sampleRate) samples = Float32Array.from(new PcmResampler(wav.sampleRate, rate).push(mono));
  let cut = false;
  if (samples.length > WAV_PARAM_MAX_SAMPLES) {
    samples = samples.subarray(0, WAV_PARAM_MAX_SAMPLES);
    cut = true;
  }
  const out: WavData = { sampleRate: rate, channels: [samples] };
  return { text: wavToParam(out), rate, seconds: samples.length / rate, cut, originalSeconds, ...(rate < wav.sampleRate ? { resampledFrom: wav.sampleRate } : {}) };
}

/** Rate and length of a stored parameter from its header (null for empty or unreadable text). */
export function wavParamInfo(text: string): { rate: number; seconds: number } | null {
  const t = text.trim();
  if (!t) return null;
  try {
    // the canonical 44-byte header is the first 60 base64 characters
    const head = base64ToBytes(t.slice(0, 60));
    if (head.length >= 44 && String.fromCharCode(...head.slice(36, 40)) === 'data') {
      const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      const rate = view.getUint32(24, true);
      const bytesPerFrame = view.getUint16(32, true) || 2;
      return { rate, seconds: view.getUint32(40, true) / bytesPerFrame / rate };
    }
    const wav = decodeWav(base64ToBytes(t));
    return { rate: wav.sampleRate, seconds: wavLength(wav) / wav.sampleRate };
  } catch (e) {
    return e instanceof WavError ? null : null;
  }
}
