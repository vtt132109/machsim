/**
 * Intel HEX codec and the program builder: hand-written records, the checksum and record-type
 * rules, a lossless round trip and the automatic choice between assembly source and HEX text.
 */
import { describe, expect, it } from 'vitest';
import { formatIntelHex, isIntelHex, parseIntelHex } from './hex';
import { buildProgram, decodeImage, encodeImage, programHex, programOk } from './program';
import { assemble8051 } from './asm8051';

describe('Intel HEX', () => {
  it('reads a hand-written record', () => {
    // :03 0000 00 759 0FF ... checksum = -(3+0+0+0+0x75+0x90+0xFF) mod 256
    const sum = (3 + 0 + 0 + 0 + 0x75 + 0x90 + 0xff) % 256;
    const line = `:030000007590FF${((256 - sum) % 256).toString(16).toUpperCase().padStart(2, '0')}`;
    const r = parseIntelHex(line);
    expect(r.errors).toEqual([]);
    expect([...r.bytes.subarray(0, 3)]).toEqual([0x75, 0x90, 0xff]);
    expect(r.start).toBe(0);
    expect(r.end).toBe(3);
  });

  it('honours the record address and the end-of-file record', () => {
    const text = [':0200100012' + '34A8', ':00000001FF'].join('\n');
    const r = parseIntelHex(text);
    expect(r.errors).toEqual([]);
    expect(r.start).toBe(0x10);
    expect(r.end).toBe(0x12);
    expect([...r.bytes.subarray(0x10, 0x12)]).toEqual([0x12, 0x34]);
  });

  it('rejects a wrong checksum, a wrong length and an unknown type', () => {
    expect(parseIntelHex(':030000007590FF00').errors[0].code).toBe('checksum');
    expect(parseIntelHex(':0400000075 90FFFF'.replace(' ', '')).errors[0].code).toBe('length');
    expect(parseIntelHex(':00000009F7').errors[0].code).toBe('type');
    expect(parseIntelHex('hello').errors[0].code).toBe('notRecord');
    expect(parseIntelHex(':0200FF001234').errors[0].code).toBe('length');
  });

  it('refuses a record outside the image', () => {
    const r = parseIntelHex(':0200100012' + '34A8', 0x10);
    expect(r.errors[0].code).toBe('range');
  });

  it('extended linear and segment addresses move the base', () => {
    // :02000004 0001 F9  -> base 0x10000, but the default image is only 64 KB, so the data is out
    const r = parseIntelHex([':020000040001F9', ':0100000041BE'].join('\n'), 0x20000);
    expect(r.errors).toEqual([]);
    expect(r.bytes[0x10000]).toBe(0x41);
    // segment: :02000002 1000 EC -> base 0x10000 as well
    const s = parseIntelHex([':020000021000EC', ':0100000041BE'].join('\n'), 0x20000);
    expect(s.errors).toEqual([]);
    expect(s.bytes[0x10000]).toBe(0x41);
  });

  it('isIntelHex tells HEX text from assembly source', () => {
    expect(isIntelHex(':00000001FF')).toBe(true);
    expect(isIntelHex('\n:0200100012345C\n\n')).toBe(true);
    expect(isIntelHex('MOV A,#1')).toBe(false);
    expect(isIntelHex('')).toBe(false);
    expect(isIntelHex('; comment\n:00000001FF')).toBe(false);
  });

  it('writes records that read back identically', () => {
    const bytes = new Uint8Array(0x60);
    for (let i = 0; i < 0x20; i++) bytes[i] = (i * 7) & 0xff;
    for (let i = 0x50; i < 0x60; i++) bytes[i] = 0xa5;
    const text = formatIntelHex(bytes);
    expect(text.split('\n').at(-1)).toBe(':00000001FF');
    const back = parseIntelHex(text);
    expect(back.errors).toEqual([]);
    expect([...back.bytes.subarray(0, 0x60)]).toEqual([...bytes]);
    // the all-zero gap produces no record
    expect(text.split('\n').length).toBe(2 + 1 + 1);
  });

  it('a record whose checksum would be 0x100 is written as 00', () => {
    const bytes = new Uint8Array([0xff]);
    const text = formatIntelHex(bytes);
    expect(parseIntelHex(text).errors).toEqual([]);
  });
});

describe('program builder', () => {
  it('assembles source text', () => {
    const b = buildProgram('MOV P1,#0FFh\nSJMP $');
    expect(programOk(b)).toBe(true);
    expect(b.kind).toBe('asm');
    expect([...b.bytes.subarray(0, 5)]).toEqual([0x75, 0x90, 0xff, 0x80, 0xfe]);
    expect(b.asm?.symbols).toEqual([]);
  });

  it('decodes HEX text', () => {
    const hex = formatIntelHex(new Uint8Array([0x74, 0x55, 0x22]));
    const b = buildProgram(hex);
    expect(b.kind).toBe('hex');
    expect(programOk(b)).toBe(true);
    expect([...b.bytes.subarray(0, 3)]).toEqual([0x74, 0x55, 0x22]);
  });

  it('empty text gives an empty program and no errors', () => {
    const b = buildProgram('   \n\n');
    expect(b.kind).toBe('empty');
    expect(b.end).toBe(0);
    expect(programOk(b)).toBe(true);
  });

  it('keeps the assembler errors', () => {
    const b = buildProgram('FROB');
    expect(programOk(b)).toBe(false);
    expect(b.asmErrors[0].code).toBe('unknownMnemonic');
  });

  it('source -> HEX -> source gives the same bytes', () => {
    const src = ['ORG 0', 'MOV R0,#5', 'LOOP: DJNZ R0,LOOP', 'ORG 40h', 'DB 1,2,3', 'END'].join('\n');
    const first = buildProgram(src);
    const again = buildProgram(programHex(first));
    expect(again.kind).toBe('hex');
    expect([...again.bytes.subarray(0, 0x44)]).toEqual([...first.bytes.subarray(0, 0x44)]);
    expect(again.start).toBe(first.start);
    expect(again.end).toBe(first.end);
  });

  it('encodeImage / decodeImage carry the used range of the image', () => {
    const b = buildProgram(['ORG 10h', 'MOV A,#1', 'NOP'].join('\n'));
    const text = encodeImage(b);
    expect(text).toBe('10:740100');
    const back = decodeImage(text);
    expect(back.at).toBe(0x10);
    expect([...back.bytes]).toEqual([0x74, 0x01, 0x00]);
    expect(decodeImage('')).toEqual({ at: 0, bytes: new Uint8Array(0) });
    expect(encodeImage(buildProgram(''))).toBe('');
  });

  it('a long program survives the image encoding', () => {
    const lines = ['ORG 0'];
    for (let i = 0; i < 300; i++) lines.push(`MOV A,#${i & 0xff}`);
    const b = buildProgram(lines.join('\n'));
    expect(b.asmErrors).toEqual([]);
    const back = decodeImage(encodeImage(b));
    expect(back.bytes.length).toBe(600);
    const asmBytes = assemble8051(lines.join('\n')).bytes;
    expect([...back.bytes]).toEqual([...asmBytes.subarray(0, 600)]);
  });
});
