/**
 * Turning the program text of an MCU part into a code image.
 *
 * The part keeps ONE text parameter. `buildProgram` decides what it holds: Intel HEX when every
 * non-empty line starts with ':' (so a program compiled elsewhere can be pasted or loaded from a
 * .hex file), otherwise MCS-51 assembly source, which is assembled here. Both paths return the
 * same shape, so the netlister, the code editor and the tests use one function.
 */
import { assemble8051, type AsmError, type AsmResult } from './asm8051';
import { formatIntelHex, isIntelHex, parseIntelHex, type HexError, type HexImage } from './hex';

export interface ProgramBuild {
  /** 64 KB code image (holes are 0) */
  bytes: Uint8Array;
  /** lowest and highest address used (end exclusive) */
  start: number;
  end: number;
  /** where the image came from */
  kind: 'asm' | 'hex' | 'empty';
  /** assembler problems (kind 'asm') */
  asmErrors: AsmError[];
  /** Intel HEX problems (kind 'hex') */
  hexErrors: HexError[];
  /** full assembler result, for the listing / symbol table / breakpoints */
  asm?: AsmResult;
  hex?: HexImage;
}

/** True when the build has no problems. */
export function programOk(b: ProgramBuild): boolean {
  return b.asmErrors.length === 0 && b.hexErrors.length === 0;
}

/** Assemble or decode the program text of an MCU instance. */
export function buildProgram(text: string): ProgramBuild {
  const src = text ?? '';
  if (src.trim().length === 0) {
    return { bytes: new Uint8Array(0x10000), start: 0, end: 0, kind: 'empty', asmErrors: [], hexErrors: [] };
  }
  if (isIntelHex(src)) {
    const hex = parseIntelHex(src);
    return { bytes: hex.bytes, start: hex.start, end: hex.end, kind: 'hex', asmErrors: [], hexErrors: hex.errors, hex };
  }
  const asm = assemble8051(src);
  return { bytes: asm.bytes, start: asm.start, end: asm.end, kind: 'asm', asmErrors: asm.errors, hexErrors: [], asm };
}

/** Intel HEX text of a build (what File > Save program writes). */
export function programHex(b: ProgramBuild): string {
  return formatIntelHex(b.bytes.subarray(0, Math.max(1, b.end)));
}

/**
 * Compact code image for the simulation: the used range as uppercase hex bytes with a load
 * address, so a model card can carry it as one literal string (and equal programs share a card).
 * Format: "<start hex>:<bytes>" — e.g. "0:7590FF22".
 */
export function encodeImage(b: ProgramBuild): string {
  if (b.end <= b.start) return '';
  const out: string[] = [];
  for (let a = b.start; a < b.end; a++) out.push(b.bytes[a].toString(16).toUpperCase().padStart(2, '0'));
  return `${b.start.toString(16).toUpperCase()}:${out.join('')}`;
}

/** Inverse of {@link encodeImage}: returns the load address and the bytes. */
export function decodeImage(text: string): { at: number; bytes: Uint8Array } {
  const t = (text ?? '').trim();
  if (t.length === 0) return { at: 0, bytes: new Uint8Array(0) };
  const colon = t.indexOf(':');
  if (colon < 0) return { at: 0, bytes: new Uint8Array(0) };
  const at = parseInt(t.slice(0, colon), 16) || 0;
  const body = t.slice(colon + 1);
  const n = body.length >> 1;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16) & 0xff;
  return { at, bytes };
}
