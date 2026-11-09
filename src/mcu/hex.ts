/**
 * Intel HEX codec for program images (MachSim's own implementation of the published record
 * format). Used by the MCU part to load a compiled program and by the code editor to save one.
 *
 * Records: `:LLAAAATT<data…>CC` with the length, the 16-bit address, the type, the payload and a
 * two's-complement checksum of every byte before it. Types read: 00 (data), 01 (end of file),
 * 02 (extended segment address, base = value * 16), 04 (extended linear address, base =
 * value * 65536); 03 and 05 (start addresses) are accepted and ignored. Anything else is an error.
 *
 * `parseIntelHex` reports every problem with its line number so the editor can point at it, and
 * still returns whatever it could read. `formatIntelHex` writes 16-byte data records over the
 * non-empty parts of the image plus the end-of-file record.
 */

export interface HexImage {
  /** bytes of the image, index = address (holes are 0) */
  bytes: Uint8Array;
  /** lowest and highest address that a data record wrote (end is exclusive; 0 / 0 when empty) */
  start: number;
  end: number;
  errors: HexError[];
}

export interface HexError {
  /** 1-based line number in the text */
  line: number;
  /** why the record was rejected (i18n key suffix, see src/i18n/mcuText.ts) */
  code: 'notRecord' | 'length' | 'checksum' | 'type' | 'range';
  /** record type or address that made the problem, for the message */
  value?: number;
}

/** True when the text looks like Intel HEX (at least one ':' record and no other content). */
export function isIntelHex(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 && lines.every((l) => l.startsWith(':'));
}

/** Parse Intel HEX text into an image of `size` bytes (default 64 KB). */
export function parseIntelHex(text: string, size = 0x10000): HexImage {
  const bytes = new Uint8Array(size);
  const errors: HexError[] = [];
  let base = 0;
  let start = size;
  let end = 0;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const no = i + 1;
    if (line.length === 0) return;
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length < 11 || (line.length - 1) % 2 !== 0) {
      errors.push({ line: no, code: 'notRecord' });
      return;
    }
    const b: number[] = [];
    for (let k = 1; k < line.length; k += 2) b.push(parseInt(line.slice(k, k + 2), 16));
    const count = b[0];
    if (b.length !== count + 5) {
      errors.push({ line: no, code: 'length' });
      return;
    }
    if (b.reduce((a, v) => a + v, 0) % 256 !== 0) {
      errors.push({ line: no, code: 'checksum' });
      return;
    }
    const addr = (b[1] << 8) | b[2];
    const type = b[3];
    const data = b.slice(4, 4 + count);
    if (type === 0) {
      for (let k = 0; k < data.length; k++) {
        const a = base + addr + k;
        if (a < 0 || a >= size) {
          errors.push({ line: no, code: 'range', value: a });
          return;
        }
        bytes[a] = data[k];
        if (a < start) start = a;
        if (a + 1 > end) end = a + 1;
      }
    } else if (type === 2) base = ((data[0] << 8) | data[1]) * 16;
    else if (type === 4) base = ((data[0] << 8) | data[1]) * 65536;
    else if (type !== 1 && type !== 3 && type !== 5) errors.push({ line: no, code: 'type', value: type });
  });
  if (start > end) start = end = 0;
  return { bytes, start, end, errors };
}

/** Write an image as Intel HEX: 16-byte data records over the non-zero parts plus `:00000001FF`. */
export function formatIntelHex(bytes: ArrayLike<number>, perRecord = 16): string {
  const hex2 = (v: number) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const hex4 = (v: number) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const out: string[] = [];
  const n = Math.max(1, Math.min(255, Math.round(perRecord)));
  for (let row = 0; row < bytes.length; row += n) {
    const stop = Math.min(bytes.length, row + n);
    let any = false;
    for (let k = row; k < stop; k++) if (bytes[k] !== 0) any = true;
    if (!any) continue;
    const data: number[] = [];
    for (let k = row; k < stop; k++) data.push(bytes[k] & 0xff);
    const head = [data.length, (row >> 8) & 0xff, row & 0xff, 0];
    const sum = [...head, ...data].reduce((a, v) => a + v, 0);
    out.push(`:${hex2(head[0])}${hex4(row)}00${data.map(hex2).join('')}${hex2(256 - (sum % 256))}`);
  }
  out.push(':00000001FF');
  return out.join('\n');
}
