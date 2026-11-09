import { describe, expect, it } from 'vitest';
import { adler32, encodePng, iTXtChunk, isPng, PngError, pngSize, pngTexts, readPngChunks, withTextChunk, writePngChunks, zlibStored, PNG_SIGNATURE } from './png';
import { crc32 } from './zip';
import { inflateSync } from 'node:zlib';

const pixels = (w: number, h: number) => {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([i % 256, (i * 7) % 256, 200, 255], i * 4);
  return px;
};

describe('PNG container codec', () => {
  it('CRC-32 matches the published check value and the IEND constant', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    // every PNG ends with the same IEND chunk: length 0, "IEND", CRC AE 42 60 82
    const png = encodePng(1, 1, new Uint8Array(4));
    expect(Array.from(png.subarray(png.length - 12))).toEqual([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  });

  it('Adler-32 matches RFC 1950 ("Wikipedia" = 0x11E60398) and stored zlib inflates back', () => {
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
    const data = new Uint8Array(150_000).map((_, i) => (i * 31) % 251);
    const z = zlibStored(data);
    // three stored blocks of at most 65535 bytes: 2 header + 3·5 block headers + data + 4 adler
    expect(z.length).toBe(2 + 3 * 5 + data.length + 4);
    expect(new Uint8Array(inflateSync(z))).toEqual(data);
  });

  it('encodes an RGBA image that a real inflater reads back pixel for pixel', () => {
    const w = 5;
    const h = 3;
    const px = pixels(w, h);
    const png = encodePng(w, h, px);
    expect(isPng(png)).toBe(true);
    expect(Array.from(png.subarray(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
    expect(pngSize(png)).toEqual({ width: 5, height: 3 });
    const chunks = readPngChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(Array.from(chunks[0].data.subarray(8))).toEqual([8, 6, 0, 0, 0]);
    const raw = new Uint8Array(inflateSync(chunks[1].data));
    expect(raw.length).toBe(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
      expect(raw[y * (1 + w * 4)]).toBe(0);
      expect(raw.subarray(y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4))).toEqual(px.subarray(y * w * 4, (y + 1) * w * 4));
    }
  });

  it('writes chunk lengths and CRCs byte for byte', () => {
    const bytes = writePngChunks([{ type: 'IHDR', data: Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0) }, { type: 'IEND', data: new Uint8Array(0) }]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(8)).toBe(13);
    expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(8 + 8 + 13)).toBe(crc32(bytes.subarray(12, 12 + 4 + 13)));
    expect(bytes.length).toBe(8 + 25 + 12);
  });

  it('reads tEXt and uncompressed iTXt chunks, with UTF-8 text', () => {
    const tExt = { type: 'tEXt', data: Uint8Array.of(...new TextEncoder().encode('Comment'), 0, ...new TextEncoder().encode('plain')) };
    const base = readPngChunks(encodePng(1, 1, new Uint8Array(4)));
    const png = writePngChunks([base[0], tExt, iTXtChunk('MachSim-snippet', 'Điện trở 4,7 kΩ'), ...base.slice(1)]);
    expect(pngTexts(readPngChunks(png))).toEqual([
      { keyword: 'Comment', text: 'plain', chunk: 'tEXt' },
      { keyword: 'MachSim-snippet', text: 'Điện trở 4,7 kΩ', chunk: 'iTXt' },
    ]);
  });

  it('withTextChunk replaces an older chunk of the keyword, puts the new one before IEND and keeps the image', () => {
    const png = encodePng(2, 2, pixels(2, 2));
    const once = withTextChunk(png, 'MachSim-snippet', 'first');
    const twice = withTextChunk(once, 'MachSim-snippet', 'second');
    const chunks = readPngChunks(twice);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'iTXt', 'IEND']);
    expect(pngTexts(chunks)).toEqual([{ keyword: 'MachSim-snippet', text: 'second', chunk: 'iTXt' }]);
    expect(chunks[1].data).toEqual(readPngChunks(png)[1].data);
    // the iTXt layout: keyword NUL flag(0) method(0) lang NUL transl NUL text
    const it = chunks[2].data;
    expect(Array.from(it.subarray(15, 20))).toEqual([0, 0, 0, 0, 0]);
    expect(new TextDecoder().decode(it.subarray(20))).toBe('second');
  });

  it('rejects files that are not PNG, truncated files and damaged chunks', () => {
    const png = withTextChunk(encodePng(2, 2, pixels(2, 2)), 'k', 'v');
    const code = (b: Uint8Array) => {
      try {
        readPngChunks(b);
        return 'ok';
      } catch (e) {
        return e instanceof PngError ? e.code : 'other';
      }
    };
    expect(code(new TextEncoder().encode('GIF89a......'))).toBe('not-png');
    expect(code(png.subarray(0, png.length - 5))).toBe('truncated');
    const bad = png.slice();
    bad[png.length - 20] ^= 0xff; // a byte of the iTXt data
    expect(code(bad)).toBe('crc');
    expect(code(png)).toBe('ok');
    expect(() => iTXtChunk('', 'x')).toThrow(PngError);
    expect(() => iTXtChunk('x'.repeat(80), 'x')).toThrow(PngError);
  });
});
