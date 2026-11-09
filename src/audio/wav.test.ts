import { describe, expect, it } from 'vitest';
import { WavError, base64ToBytes, bytesToBase64, decodeWav, encodeWav, wavDuration, wavFromParam, wavToParam, type WavData } from './wav';

const sine = (n: number, fs: number, f: number, a = 0.5): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs));

describe('WAV codec', () => {
  it('round-trips 16-bit PCM within one quantisation step', () => {
    const wav: WavData = { sampleRate: 44100, channels: [sine(1000, 44100, 1000)] };
    const back = decodeWav(encodeWav(wav));
    expect(back.sampleRate).toBe(44100);
    expect(back.channels).toHaveLength(1);
    expect(back.channels[0]).toHaveLength(1000);
    let worst = 0;
    for (let i = 0; i < 1000; i++) worst = Math.max(worst, Math.abs(back.channels[0][i] - wav.channels[0][i]));
    expect(worst).toBeLessThanOrEqual(1 / 32767);
  });

  it('writes the canonical 44-byte header', () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float32Array(100)] });
    const text = (a: number) => String.fromCharCode(...bytes.slice(a, a + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(text(36)).toBe('data');
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(28, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(200);
    expect(bytes.length).toBe(244);
  });

  it('keeps the channels of a stereo file apart', () => {
    const l = sine(200, 48000, 440);
    const r = sine(200, 48000, 880, 0.25);
    const back = decodeWav(encodeWav({ sampleRate: 48000, channels: [l, r] }, { encoding: 'pcm24' }));
    expect(back.channels).toHaveLength(2);
    for (let i = 0; i < 200; i++) {
      expect(back.channels[0][i]).toBeCloseTo(l[i], 6);
      expect(back.channels[1][i]).toBeCloseTo(r[i], 6);
    }
  });

  it('float32 is exact and 8-bit is within 1/127', () => {
    const x = Float32Array.from([0, 0.25, -0.5, 0.999, -1]);
    const f = decodeWav(encodeWav({ sampleRate: 1000, channels: [x] }, { encoding: 'float32' }));
    expect(Array.from(f.channels[0])).toEqual(Array.from(x));
    const b = decodeWav(encodeWav({ sampleRate: 1000, channels: [x] }, { encoding: 'pcm8' }));
    for (let i = 0; i < x.length; i++) expect(Math.abs(b.channels[0][i] - x[i])).toBeLessThanOrEqual(1 / 127 + 1e-9);
  });

  it('clips values outside -1 … 1 instead of wrapping', () => {
    const back = decodeWav(encodeWav({ sampleRate: 1000, channels: [Float32Array.from([2, -3, 0.5])] }));
    expect(back.channels[0][0]).toBeCloseTo(1, 4);
    expect(back.channels[0][1]).toBeCloseTo(-1, 4);
    expect(back.channels[0][2]).toBeCloseTo(0.5, 3);
  });

  it('skips unknown chunks (with odd-size padding) before and after the data', () => {
    const base = encodeWav({ sampleRate: 22050, channels: [Float32Array.from([0.1, 0.2, 0.3, 0.4])] });
    const list = Uint8Array.from([...'LIST'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 65, 66, 67, 0]));
    const tail = Uint8Array.from([...'id3 '].map((c) => c.charCodeAt(0)).concat([2, 0, 0, 0, 1, 2]));
    const file = new Uint8Array(base.length + list.length + tail.length);
    file.set(base.slice(0, 36), 0);
    file.set(list, 36);
    file.set(base.slice(36), 36 + list.length);
    file.set(tail, 36 + list.length + base.length - 36);
    new DataView(file.buffer).setUint32(4, file.length - 8, true);
    const back = decodeWav(file);
    expect(back.sampleRate).toBe(22050);
    expect(Array.from(back.channels[0]).map((x) => Number(x.toFixed(3)))).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('takes the rest of a cut file when the data size is too large', () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float32Array(100).fill(0.5)] });
    new DataView(bytes.buffer).setUint32(40, 0xffffffff, true);
    expect(decodeWav(bytes).channels[0]).toHaveLength(100);
  });

  it('reads the extensible header', () => {
    const plain = encodeWav({ sampleRate: 16000, channels: [Float32Array.from([0.5, -0.5])] });
    const ext = new Uint8Array(plain.length + 24);
    ext.set(plain.slice(0, 20), 0);
    const v = new DataView(ext.buffer);
    ext.set(plain.slice(20, 36), 20); // channels, rate, byte rate, align, bits
    v.setUint16(20, 0xfffe, true);
    v.setUint32(16, 40, true);
    v.setUint16(36, 22, true);
    v.setUint16(38, 16, true);
    v.setUint16(44, 1, true); // sub-format GUID starts with the PCM tag
    ext.set(plain.slice(36), 60);
    v.setUint32(4, ext.length - 8, true);
    const back = decodeWav(ext);
    expect(back.sampleRate).toBe(16000);
    expect(back.channels[0][0]).toBeCloseTo(0.5, 3);
    expect(back.channels[0][1]).toBeCloseTo(-0.5, 3);
  });

  it('reports what is wrong with a file instead of returning garbage', () => {
    const code = (b: Uint8Array): string => {
      try {
        decodeWav(b);
        return 'ok';
      } catch (e) {
        return e instanceof WavError ? e.code : 'other';
      }
    };
    expect(code(Uint8Array.from([1, 2, 3]))).toBe('not-wav');
    const good = encodeWav({ sampleRate: 8000, channels: [new Float32Array(4)] });
    expect(code(good.slice(0, 36))).toBe('truncated');
    const adpcm = good.slice();
    new DataView(adpcm.buffer).setUint16(20, 2, true);
    expect(code(adpcm)).toBe('unsupported-format');
    const odd = good.slice();
    new DataView(odd.buffer).setUint16(34, 12, true);
    expect(code(odd)).toBe('unsupported-bits');
    const noFmt = good.slice();
    noFmt[12] = 0x78;
    expect(code(noFmt)).toBe('bad-header');
    expect(code(good.slice(0, 44))).toBe('empty');
  });

  it('rejects channels of different length when writing', () => {
    expect(() => encodeWav({ sampleRate: 8000, channels: [new Float32Array(3), new Float32Array(4)] })).toThrow(WavError);
  });

  it('duration is samples over rate', () => {
    expect(wavDuration({ sampleRate: 8000, channels: [new Float32Array(4000)] })).toBe(0.5);
  });
});

describe('base64', () => {
  it('matches the RFC 4648 test vectors', () => {
    const enc = (s: string) => bytesToBase64(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('fooba')).toBe('Zm9vYmE=');
    expect(enc('foobar')).toBe('Zm9vYmFy');
    expect(String.fromCharCode(...base64ToBytes('Zm9vYmE='))).toBe('fooba');
    expect(String.fromCharCode(...base64ToBytes('Zm9v\nYmFy'))).toBe('foobar');
  });

  it('round-trips every byte value and rejects other characters', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
    expect(() => base64ToBytes('ab$d')).toThrow(WavError);
  });

  it('a WAV travels as text through a part parameter (stereo is mixed to mono)', () => {
    const l = sine(400, 8000, 500);
    const r = sine(400, 8000, 500);
    const text = wavToParam({ sampleRate: 8000, channels: [l, r] });
    expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const back = wavFromParam(text);
    expect(back.channels).toHaveLength(1);
    expect(back.sampleRate).toBe(8000);
    expect(back.channels[0][10]).toBeCloseTo(l[10], 3);
  });
});
