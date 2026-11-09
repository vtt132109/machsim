/**
 * Memory images: the text form of RAM / ROM / EEPROM contents used by the memory parts (param
 * 'data') and their code models (model literal `data`).
 *
 * Accepted formats (comments start with '//' or '#'):
 *   - plain hexadecimal words separated by spaces, commas, semicolons or new lines, optional 0x:
 *       "3E 01 D3 FF"
 *   - address markers "@<hex>" (as in Verilog $readmemh) or "<hex>:" at the start of a line
 *     (hex dump style), the following words are stored from that address on:
 *       "@0100 AA 55"     "0100: AA 55"
 *   - Intel HEX records (every non-empty line starts with ':'): data (00), end of file (01),
 *     extended segment (02) and extended linear (04) addresses; checksums are verified. Bytes
 *     are words of memories up to 8 bits wide; wider words take two bytes, low byte first.
 * Missing words are 0. formatMemoryImage() writes the compact canonical form (one "@addr" line
 * per run of non-zero rows of 16 words).
 */

export interface MemoryImageResult {
  data: Uint32Array;
  errors: string[];
}

function stripComment(line: string): string {
  const a = line.indexOf('//');
  const b = line.indexOf('#');
  const cut = [a, b].filter((i) => i >= 0);
  return cut.length ? line.slice(0, Math.min(...cut)) : line;
}

function parseIntelHex(lines: string[], words: number, bits: number, data: Uint32Array, errors: string[]): void {
  let base = 0;
  const bytesPerWord = bits <= 8 ? 1 : bits <= 16 ? 2 : 4;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (!/^:[0-9a-f]+$/i.test(line) || line.length < 11 || (line.length - 1) % 2 !== 0) {
      errors.push(`line ${i + 1}: not an Intel HEX record`);
      return;
    }
    const bytes: number[] = [];
    for (let k = 1; k < line.length; k += 2) bytes.push(parseInt(line.slice(k, k + 2), 16));
    const count = bytes[0];
    if (bytes.length !== count + 5) {
      errors.push(`line ${i + 1}: record length does not match its byte count`);
      return;
    }
    const sum = bytes.reduce((a, b) => a + b, 0) & 0xff;
    if (sum !== 0) {
      errors.push(`line ${i + 1}: checksum error`);
      return;
    }
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const payload = bytes.slice(4, 4 + count);
    if (type === 0) {
      payload.forEach((b, k) => {
        const byteAddr = base + addr + k;
        const w = Math.floor(byteAddr / bytesPerWord);
        const shift = 8 * (byteAddr % bytesPerWord);
        if (w >= words) {
          errors.push(`line ${i + 1}: address ${byteAddr.toString(16).toUpperCase()} is outside the memory`);
          return;
        }
        data[w] = (data[w] | (b << shift)) >>> 0;
      });
    } else if (type === 2) base = (((payload[0] << 8) | payload[1]) * 16) >>> 0;
    else if (type === 4) base = (((payload[0] << 8) | payload[1]) * 65536) >>> 0;
    else if (type !== 1 && type !== 3 && type !== 5) errors.push(`line ${i + 1}: unsupported record type ${type}`);
  });
}

/** Parse a memory image for a memory of `words` words of `bits` bits. */
export function parseMemoryImage(text: string, words: number, bits: number): MemoryImageResult {
  const data = new Uint32Array(Math.max(0, words));
  const errors: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(stripComment);
  const max = bits >= 32 ? 0xffffffff : 2 ** bits - 1;
  if (lines.some((l) => l.trim().startsWith(':')) && lines.every((l) => !l.trim() || l.trim().startsWith(':'))) {
    parseIntelHex(lines, words, bits, data, errors);
  } else {
    let addr = 0;
    lines.forEach((line, i) => {
      let rest = line.trim();
      const dump = rest.match(/^([0-9a-f]+)\s*:/i);
      if (dump) {
        addr = parseInt(dump[1], 16);
        rest = rest.slice(dump[0].length);
      }
      for (const tok of rest.split(/[\s,;]+/)) {
        if (!tok) continue;
        if (tok.startsWith('@')) {
          const a = tok.slice(1);
          if (!/^[0-9a-f]+$/i.test(a)) errors.push(`line ${i + 1}: bad address '${tok}'`);
          else addr = parseInt(a, 16);
          continue;
        }
        const h = tok.replace(/^0x/i, '');
        if (!/^[0-9a-f]+$/i.test(h)) {
          errors.push(`line ${i + 1}: '${tok}' is not a hexadecimal word`);
          continue;
        }
        const v = parseInt(h, 16);
        if (v > max) errors.push(`line ${i + 1}: word ${tok} does not fit in ${bits} bits`);
        else if (addr >= words) errors.push(`line ${i + 1}: address ${addr.toString(16).toUpperCase()} is outside the memory (${words} words)`);
        else data[addr] = v;
        addr++;
      }
    });
  }
  if (errors.length > 20) errors.splice(20, errors.length - 20, `${errors.length - 20} more errors`);
  return { data, errors };
}

/** Hex digits of one word. */
export function wordDigits(bits: number): number {
  return Math.max(1, Math.ceil(bits / 4));
}

/** Compact canonical text of a memory image ("" when every word is 0). */
export function formatMemoryImage(data: ArrayLike<number>, bits: number, perLine = 16): string {
  const digits = wordDigits(bits);
  const addrDigits = Math.max(4, Math.ceil(Math.log2(Math.max(2, data.length)) / 4));
  const hex = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, '0');
  const lines: string[] = [];
  let expected = -1;
  for (let row = 0; row < data.length; row += perLine) {
    let any = false;
    for (let k = row; k < Math.min(data.length, row + perLine); k++) if (data[k] !== 0) any = true;
    if (!any) continue;
    const words: string[] = [];
    for (let k = row; k < Math.min(data.length, row + perLine); k++) words.push(hex(data[k], digits));
    lines.push(row === expected ? words.join(' ') : `@${hex(row, addrDigits)} ${words.join(' ')}`);
    expected = row + perLine;
  }
  return lines.join('\n');
}
