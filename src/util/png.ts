/**
 * Minimal PNG container codec (ISO/IEC 15948, W3C PNG 2nd edition) without dependencies.
 *
 *   readPngChunks(bytes)            signature + every chunk, CRC-32 checked (PngError otherwise)
 *   writePngChunks(chunks)          bytes of a PNG from chunks (CRC computed)
 *   pngSize(bytes)                  IHDR width / height
 *   pngTexts(chunks)                tEXt (Latin-1) and uncompressed iTXt (UTF-8) text chunks
 *   iTXtChunk(keyword, text)        an uncompressed international text chunk
 *   withTextChunk(bytes, kw, text)  the same PNG with one iTXt chunk for `kw` (replacing older
 *                                   text chunks of that keyword), inserted before IEND
 *   encodePng(w, h, rgba)           a truecolour + alpha PNG with "stored" (uncompressed) zlib
 *                                   blocks: used for snippet pictures where no canvas exists, and
 *                                   by the tests
 *
 * Only the container is handled here: image data is never decoded, so a snippet's circuit text
 * can be read from any PNG a browser or an image editor wrote, as long as the text chunk survives.
 */
import { crc32 } from './zip';

export const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export interface PngChunk {
  /** four ASCII letters, e.g. 'IHDR', 'iTXt' */
  type: string;
  data: Uint8Array;
}

export interface PngText {
  keyword: string;
  text: string;
  chunk: 'tEXt' | 'iTXt';
}

export type PngErrorCode = 'not-png' | 'truncated' | 'crc' | 'structure';

export class PngError extends Error {
  readonly code: PngErrorCode;
  constructor(code: PngErrorCode, message: string) {
    super(message);
    this.name = 'PngError';
    this.code = code;
  }
}

const latin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

const latin1Bytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) throw new PngError('structure', `character outside Latin-1 in "${text}"`);
    out[i] = c;
  }
  return out;
};

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** True when the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

function chunkCrc(type: Uint8Array, data: Uint8Array): number {
  const buf = new Uint8Array(4 + data.length);
  buf.set(type, 0);
  buf.set(data, 4);
  return crc32(buf);
}

/**
 * Every chunk of a PNG in file order. Throws PngError for a missing signature, a truncated file,
 * a chunk whose CRC-32 does not match, or a file that does not start with IHDR / end with IEND.
 */
export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new PngError('not-png', 'not a PNG file (signature missing)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: PngChunk[] = [];
  let p = PNG_SIGNATURE.length;
  while (p < bytes.length) {
    if (p + 12 > bytes.length) throw new PngError('truncated', 'the PNG file is truncated');
    const len = view.getUint32(p);
    if (p + 12 + len > bytes.length) throw new PngError('truncated', 'the PNG file is truncated');
    const typeBytes = bytes.subarray(p + 4, p + 8);
    const type = latin1(typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new PngError('structure', `invalid chunk type at byte ${p + 4}`);
    const data = bytes.subarray(p + 8, p + 8 + len);
    const crc = view.getUint32(p + 8 + len);
    if (chunkCrc(typeBytes, data) !== crc) throw new PngError('crc', `chunk ${type} is damaged (CRC mismatch)`);
    out.push({ type, data: data.slice() });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  if (out[0]?.type !== 'IHDR') throw new PngError('structure', 'the PNG file does not start with IHDR');
  if (out[out.length - 1]?.type !== 'IEND') throw new PngError('truncated', 'the PNG file has no IEND chunk');
  return out;
}

/** PNG bytes from chunks (lengths and CRCs computed). */
export function writePngChunks(chunks: readonly PngChunk[]): Uint8Array {
  let size = PNG_SIGNATURE.length;
  for (const c of chunks) size += 12 + c.data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(PNG_SIGNATURE, 0);
  let p = PNG_SIGNATURE.length;
  for (const c of chunks) {
    if (!/^[A-Za-z]{4}$/.test(c.type)) throw new PngError('structure', `invalid chunk type "${c.type}"`);
    const type = latin1Bytes(c.type);
    view.setUint32(p, c.data.length);
    out.set(type, p + 4);
    out.set(c.data, p + 8);
    view.setUint32(p + 8 + c.data.length, chunkCrc(type, c.data));
    p += 12 + c.data.length;
  }
  return out;
}

/** Width and height from the IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const ihdr = readPngChunks(bytes)[0];
  const v = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  return { width: v.getUint32(0), height: v.getUint32(4) };
}

/**
 * Text chunks: tEXt (keyword NUL text, Latin-1) and iTXt with compression flag 0 (keyword NUL
 * flag method language NUL translated-keyword NUL text, UTF-8). Compressed iTXt and zTXt chunks
 * are skipped (MachSim never writes them).
 */
export function pngTexts(chunks: readonly PngChunk[]): PngText[] {
  const out: PngText[] = [];
  for (const c of chunks) {
    if (c.type === 'tEXt') {
      const z = c.data.indexOf(0);
      if (z <= 0) continue;
      out.push({ keyword: latin1(c.data.subarray(0, z)), text: latin1(c.data.subarray(z + 1)), chunk: 'tEXt' });
    } else if (c.type === 'iTXt') {
      const z = c.data.indexOf(0);
      if (z <= 0 || z + 2 >= c.data.length) continue;
      const compressed = c.data[z + 1];
      if (compressed !== 0) continue;
      const langEnd = c.data.indexOf(0, z + 3);
      if (langEnd < 0) continue;
      const transEnd = c.data.indexOf(0, langEnd + 1);
      if (transEnd < 0) continue;
      let text: string;
      try {
        text = utf8Decoder.decode(c.data.subarray(transEnd + 1));
      } catch {
        continue;
      }
      out.push({ keyword: latin1(c.data.subarray(0, z)), text, chunk: 'iTXt' });
    }
  }
  return out;
}

/** An uncompressed iTXt chunk (no language tag, no translated keyword). */
export function iTXtChunk(keyword: string, text: string): PngChunk {
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword) || /^ | $|  /.test(keyword)) throw new PngError('structure', `invalid PNG text keyword "${keyword}"`);
  const kw = latin1Bytes(keyword);
  const body = utf8.encode(text);
  const data = new Uint8Array(kw.length + 5 + body.length);
  data.set(kw, 0);
  // NUL, compression flag 0, method 0, empty language tag NUL, empty translated keyword NUL
  data.set([0, 0, 0, 0, 0], kw.length);
  data.set(body, kw.length + 5);
  return { type: 'iTXt', data };
}

/**
 * The PNG with a single iTXt chunk holding `text` under `keyword`: earlier tEXt / iTXt chunks of the
 * same keyword are removed, the new chunk goes right before IEND. The image data is unchanged.
 */
export function withTextChunk(bytes: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = readPngChunks(bytes);
  const kept = chunks.filter((c) => {
    if (c.type !== 'tEXt' && c.type !== 'iTXt' && c.type !== 'zTXt') return true;
    const z = c.data.indexOf(0);
    return z <= 0 || latin1(c.data.subarray(0, z)) !== keyword;
  });
  const end = kept.findIndex((c) => c.type === 'IEND');
  kept.splice(end, 0, iTXtChunk(keyword, text));
  return writePngChunks(kept);
}

/** Adler-32 checksum (RFC 1950). */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream (RFC 1950) holding `data` in stored (uncompressed) deflate blocks (RFC 1951). */
export function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, data.length - start);
    out[p] = b === blocks - 1 ? 1 : 0;
    out[p + 1] = len & 0xff;
    out[p + 2] = len >>> 8;
    out[p + 3] = ~len & 0xff;
    out[p + 4] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), p + 5);
    p += 5 + len;
  }
  new DataView(out.buffer).setUint32(p, adler32(data));
  return out;
}

/** A truecolour-with-alpha PNG (8 bits per channel, filter 0 on every row). `rgba` = width·height·4 bytes. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!(width > 0 && height > 0) || rgba.length !== width * height * 4) throw new PngError('structure', 'image size does not match the pixel data');
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  return writePngChunks([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: zlibStored(raw) },
    { type: 'IEND', data: new Uint8Array(0) },
  ]);
}
