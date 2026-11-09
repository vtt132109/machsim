/**
 * WAV (RIFF / WAVE) codec written for MachSim, no dependencies. Public format description:
 * Microsoft "Multimedia Programming Interface and Data Specifications 1.0" (RIFF, WAVE_FORMAT_PCM,
 * WAVE_FORMAT_IEEE_FLOAT) and the WAVE_FORMAT_EXTENSIBLE header of the Windows multimedia SDK.
 *
 *   decodeWav(bytes)             -> { sampleRate, channels: Float32Array[] }  (samples -1 … 1)
 *   encodeWav(wav, options?)     -> Uint8Array of a WAV file
 *   bytesToBase64 / base64ToBytes  small codec for parameters that carry a whole file as text
 *   wavToParam(wav) / wavFromParam(text)  mono 16-bit file as base64 text (the WAV source part)
 *
 * Reading accepts PCM 8 / 16 / 24 / 32-bit integers, IEEE float 32 / 64-bit, mono or multichannel,
 * the extensible header, unknown chunks (skipped, odd sizes padded) and a `data` chunk whose size
 * field is wrong because the file was cut or streamed (the rest of the file is taken). Anything
 * else (compressed codecs) throws WavError with a code the UI turns into a sentence.
 * Writing produces canonical files: 'pcm16' (default), 'pcm8', 'pcm24' or 'float32'.
 */

export type WavErrorCode = 'not-wav' | 'truncated' | 'unsupported-format' | 'unsupported-bits' | 'bad-header' | 'empty';

export class WavError extends Error {
  readonly code: WavErrorCode;
  constructor(code: WavErrorCode, message: string) {
    super(message);
    this.name = 'WavError';
    this.code = code;
  }
}

export interface WavData {
  /** samples per second per channel */
  sampleRate: number;
  /** one array per channel, samples in -1 … 1 (float) */
  channels: Float32Array[];
}

export type WavEncoding = 'pcm8' | 'pcm16' | 'pcm24' | 'float32';

export interface WavWriteOptions {
  encoding?: WavEncoding;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

const tag = (b: Uint8Array, at: number): string => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Number of samples per channel. */
export function wavLength(w: WavData): number {
  return w.channels.length ? w.channels[0].length : 0;
}

/** Duration in seconds. */
export function wavDuration(w: WavData): number {
  return w.sampleRate > 0 ? wavLength(w) / w.sampleRate : 0;
}

/** Read a WAV file. */
export function decodeWav(bytes: Uint8Array): WavData {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') throw new WavError('not-wav', 'not a RIFF/WAVE file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataAt = -1;
  let dataLen = 0;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = tag(bytes, pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new WavError('bad-header', 'the fmt chunk is too short');
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID
      if (format === FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= bytes.length) format = view.getUint16(body + 24, true);
      fmt = { format, channels, rate, bits };
    } else if (id === 'data') {
      dataAt = body;
      // a streamed or cut file may claim more (or 0xFFFFFFFF) than it holds: take what is there
      dataLen = Math.min(size, bytes.length - body);
      if (fmt) break;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt) throw new WavError('bad-header', 'the file has no fmt chunk');
  if (dataAt < 0) throw new WavError('truncated', 'the file has no data chunk');
  if (fmt.channels < 1 || fmt.channels > 32 || !(fmt.rate > 0)) throw new WavError('bad-header', 'the channel count or the sample rate is invalid');
  const isFloat = fmt.format === FORMAT_FLOAT;
  if (fmt.format !== FORMAT_PCM && !isFloat) throw new WavError('unsupported-format', `format tag ${fmt.format} is not PCM or float`);
  const bytesPer = fmt.bits >> 3;
  const okBits = isFloat ? fmt.bits === 32 || fmt.bits === 64 : fmt.bits === 8 || fmt.bits === 16 || fmt.bits === 24 || fmt.bits === 32;
  if (!okBits || bytesPer * 8 !== fmt.bits) throw new WavError('unsupported-bits', `${fmt.bits}-bit ${isFloat ? 'float' : 'PCM'} is not supported`);
  const frame = bytesPer * fmt.channels;
  const frames = Math.floor(dataLen / frame);
  if (frames === 0) throw new WavError('empty', 'the file holds no samples');
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const at = dataAt + i * frame + c * bytesPer;
      let v: number;
      if (isFloat) v = fmt.bits === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
      else if (fmt.bits === 8) v = (bytes[at] - 128) / 128;
      else if (fmt.bits === 16) v = view.getInt16(at, true) / 32768;
      else if (fmt.bits === 24) v = (((bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) << 8) >> 8) / 8388608;
      else v = view.getInt32(at, true) / 2147483648;
      channels[c][i] = Number.isFinite(v) ? v : 0;
    }
  }
  return { sampleRate: fmt.rate, channels };
}

const clamp1 = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v);

/** Write a WAV file. All channels must have the same length. */
export function encodeWav(wav: WavData, options: WavWriteOptions = {}): Uint8Array {
  const enc = options.encoding ?? 'pcm16';
  const nch = wav.channels.length;
  if (nch < 1) throw new WavError('empty', 'a WAV file needs at least one channel');
  const n = wavLength(wav);
  if (wav.channels.some((c) => c.length !== n)) throw new WavError('bad-header', 'the channels differ in length');
  const bits = enc === 'pcm8' ? 8 : enc === 'pcm16' ? 16 : enc === 'pcm24' ? 24 : 32;
  const bytesPer = bits >> 3;
  const dataSize = n * nch * bytesPer;
  const pad = dataSize & 1;
  const out = new Uint8Array(44 + dataSize + pad);
  const view = new DataView(out.buffer);
  const put = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  view.setUint32(4, 36 + dataSize + pad, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, enc === 'float32' ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(22, nch, true);
  view.setUint32(24, Math.round(wav.sampleRate), true);
  view.setUint32(28, Math.round(wav.sampleRate) * nch * bytesPer, true);
  view.setUint16(32, nch * bytesPer, true);
  view.setUint16(34, bits, true);
  put(36, 'data');
  view.setUint32(40, dataSize, true);
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = wav.channels[c][i];
      if (enc === 'float32') view.setFloat32(at, v, true);
      else if (enc === 'pcm8') out[at] = Math.round(clamp1(v) * 127) + 128;
      else if (enc === 'pcm16') view.setInt16(at, Math.round(clamp1(v) * 32767), true);
      else {
        const q = Math.round(clamp1(v) * 8388607);
        out[at] = q & 255;
        out[at + 1] = (q >> 8) & 255;
        out[at + 2] = (q >> 16) & 255;
      }
      at += bytesPer;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// base64 (own codec: no btoa / Buffer, so it also runs in the worker and the netlister)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INDEX[B64.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const word = (b0 << 16) | (b1 << 8) | b2;
    parts.push(B64[(word >> 18) & 63] + B64[(word >> 12) & 63] + (i + 1 < bytes.length ? B64[(word >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[word & 63] : '='));
  }
  return parts.join('');
}

/** Bytes of base64 text (whitespace ignored). Throws WavError('bad-header') for other characters. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  const body = clean.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((body.length * 6) / 8));
  let acc = 0;
  let bitsIn = 0;
  let k = 0;
  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i);
    const v = code < 128 ? B64_INDEX[code] : -1;
    if (v < 0) throw new WavError('bad-header', 'the text is not base64');
    acc = (acc << 6) | v;
    bitsIn += 6;
    if (bitsIn >= 8) {
      bitsIn -= 8;
      out[k++] = (acc >> bitsIn) & 255;
    }
  }
  return out;
}

/** Mono 16-bit WAV (channels averaged) as base64 text, the form a part parameter stores. */
export function wavToParam(wav: WavData): string {
  const n = wavLength(wav);
  const mono = new Float32Array(n);
  for (const ch of wav.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / wav.channels.length;
  return bytesToBase64(encodeWav({ sampleRate: wav.sampleRate, channels: [mono] }));
}

/** Read a parameter written by {@link wavToParam}; throws WavError for bad text. */
export function wavFromParam(text: string): WavData {
  return decodeWav(base64ToBytes(text));
}
