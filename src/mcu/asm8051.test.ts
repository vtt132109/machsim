/**
 * MCS-51 assembler: the encoded bytes are compared with hand-assembled listings, the addresses
 * and symbols of the two passes, the number and expression syntax, and every error it reports.
 */
import { describe, expect, it } from 'vitest';
import { assemble8051, listingText, mnemonics, parseNumber, type AsmResult } from './asm8051';
import { Cpu8051, LENGTHS } from './cpu8051';

function asm(src: string): AsmResult {
  return assemble8051(src);
}

/** Bytes of a result between two addresses, as a plain array. */
function range(r: AsmResult, from: number, to: number): number[] {
  return [...r.bytes.subarray(from, to)];
}

/** Assemble one line and return its bytes. */
function one(line: string): number[] {
  const r = asm(line);
  expect(r.errors, `${line}: ${JSON.stringify(r.errors)}`).toEqual([]);
  return r.lines.find((l) => l.bytes.length > 0)?.bytes ?? [];
}

describe('8051 assembler: encodings', () => {
  it('assembles a hand-checked program byte for byte', () => {
    const src = [
      '        ORG 0000h',
      'LED     BIT P1.0        ; the LED is on P1.0',
      'COUNT   EQU 30h',
      '        MOV P1,#0FFh',
      '        MOV A,#55h',
      '        MOV R7,#10',
      'LOOP:   CPL LED',
      '        DJNZ R7,LOOP',
      '        MOV COUNT,A',
      '        LJMP 0100h',
      "        DB 'Hi',0",
      '        DW 1234h',
      '        END',
    ].join('\n');
    const r = asm(src);
    expect(r.errors).toEqual([]);
    expect(range(r, 0, 0x15)).toEqual([
      0x75, 0x90, 0xff, // MOV P1,#0FFh
      0x74, 0x55, // MOV A,#55h
      0x7f, 0x0a, // MOV R7,#10
      0xb2, 0x90, // CPL P1.0
      0xdf, 0xfc, // DJNZ R7,LOOP  (7 - 0x0B = -4)
      0xf5, 0x30, // MOV 30h,A
      0x02, 0x01, 0x00, // LJMP 0100h
      0x48, 0x69, 0x00, // DB 'Hi',0
      0x12, 0x34, // DW 1234h (high byte first)
    ]);
    expect(r.start).toBe(0);
    expect(r.end).toBe(0x15);
    expect(r.symbols.map((s) => `${s.name}=${s.value}`)).toEqual(['COUNT=48', 'LED=144', 'LOOP=7']);
  });

  it('encodes every operand form of the data moves', () => {
    expect(one('MOV A,R3')).toEqual([0xeb]);
    expect(one('MOV A,@R1')).toEqual([0xe7]);
    expect(one('MOV A,#7Fh')).toEqual([0x74, 0x7f]);
    expect(one('MOV A,40h')).toEqual([0xe5, 0x40]);
    expect(one('MOV R5,A')).toEqual([0xfd]);
    expect(one('MOV R5,40h')).toEqual([0xad, 0x40]);
    expect(one('MOV R5,#12')).toEqual([0x7d, 0x0c]);
    expect(one('MOV 40h,A')).toEqual([0xf5, 0x40]);
    expect(one('MOV 40h,R2')).toEqual([0x8a, 0x40]);
    expect(one('MOV 40h,@R0')).toEqual([0x86, 0x40]);
    expect(one('MOV 40h,#9')).toEqual([0x75, 0x40, 0x09]);
    expect(one('MOV 41h,40h')).toEqual([0x85, 0x40, 0x41]); // source first
    expect(one('MOV @R0,A')).toEqual([0xf6]);
    expect(one('MOV @R1,40h')).toEqual([0xa7, 0x40]);
    expect(one('MOV @R1,#5')).toEqual([0x77, 0x05]);
    expect(one('MOV DPTR,#1234h')).toEqual([0x90, 0x12, 0x34]);
    expect(one('MOV C,P1.2')).toEqual([0xa2, 0x92]);
    expect(one('MOV P1.2,C')).toEqual([0x92, 0x92]);
    expect(one('MOVC A,@A+DPTR')).toEqual([0x93]);
    expect(one('MOVC A,@A+PC')).toEqual([0x83]);
    expect(one('MOVX A,@DPTR')).toEqual([0xe0]);
    expect(one('MOVX @DPTR,A')).toEqual([0xf0]);
    expect(one('MOVX A,@R0')).toEqual([0xe2]);
    expect(one('MOVX @R1,A')).toEqual([0xf3]);
  });

  it('encodes the arithmetic, logic and bit groups', () => {
    expect(one('ADD A,R0')).toEqual([0x28]);
    expect(one('ADD A,30h')).toEqual([0x25, 0x30]);
    expect(one('ADD A,@R0')).toEqual([0x26]);
    expect(one('ADD A,#1')).toEqual([0x24, 0x01]);
    expect(one('ADDC A,R7')).toEqual([0x3f]);
    expect(one('SUBB A,#1')).toEqual([0x94, 0x01]);
    expect(one('INC A')).toEqual([0x04]);
    expect(one('INC R4')).toEqual([0x0c]);
    expect(one('INC 30h')).toEqual([0x05, 0x30]);
    expect(one('INC @R1')).toEqual([0x07]);
    expect(one('INC DPTR')).toEqual([0xa3]);
    expect(one('DEC @R0')).toEqual([0x16]);
    expect(one('MUL AB')).toEqual([0xa4]);
    expect(one('DIV AB')).toEqual([0x84]);
    expect(one('DA A')).toEqual([0xd4]);
    expect(one('ANL A,R1')).toEqual([0x59]);
    expect(one('ANL 30h,A')).toEqual([0x52, 0x30]);
    expect(one('ANL 30h,#0F0h')).toEqual([0x53, 0x30, 0xf0]);
    expect(one('ANL C,P1.0')).toEqual([0x82, 0x90]);
    expect(one('ANL C,/P1.0')).toEqual([0xb0, 0x90]);
    expect(one('ORL C,/ACC.7')).toEqual([0xa0, 0xe7]);
    expect(one('XRL A,#0FFh')).toEqual([0x64, 0xff]);
    expect(one('XRL 30h,A')).toEqual([0x62, 0x30]);
    expect(one('CLR A')).toEqual([0xe4]);
    expect(one('CLR C')).toEqual([0xc3]);
    expect(one('CLR P1.7')).toEqual([0xc2, 0x97]);
    expect(one('SETB TR0')).toEqual([0xd2, 0x8c]);
    expect(one('CPL C')).toEqual([0xb3]);
    expect(one('CPL 20h.0')).toEqual([0xb2, 0x00]);
    expect(one('PUSH ACC')).toEqual([0xc0, 0xe0]);
    expect(one('POP PSW')).toEqual([0xd0, 0xd0]);
    expect(one('XCH A,R2')).toEqual([0xca]);
    expect(one('XCHD A,@R0')).toEqual([0xd6]);
    expect(one('SWAP A')).toEqual([0xc4]);
    expect(one('RL A')).toEqual([0x23]);
    expect(one('RRC A')).toEqual([0x13]);
    expect(one('NOP')).toEqual([0x00]);
    expect(one('RET')).toEqual([0x22]);
    expect(one('RETI')).toEqual([0x32]);
  });

  it('encodes the jumps relative to the next instruction', () => {
    expect(one('SJMP $')).toEqual([0x80, 0xfe]);
    expect(one('JC $')).toEqual([0x40, 0xfe]);
    expect(one('JNZ $')).toEqual([0x70, 0xfe]);
    expect(one('JB P1.0,$')).toEqual([0x20, 0x90, 0xfd]);
    expect(one('JNB TI,$')).toEqual([0x30, 0x99, 0xfd]);
    expect(one('JBC TF0,$')).toEqual([0x10, 0x8d, 0xfd]);
    expect(one('CJNE A,#5,$')).toEqual([0xb4, 0x05, 0xfd]);
    expect(one('CJNE A,30h,$')).toEqual([0xb5, 0x30, 0xfd]);
    expect(one('CJNE R3,#5,$')).toEqual([0xbb, 0x05, 0xfd]);
    expect(one('CJNE @R0,#5,$')).toEqual([0xb6, 0x05, 0xfd]);
    expect(one('DJNZ R0,$')).toEqual([0xd8, 0xfe]);
    expect(one('DJNZ 30h,$')).toEqual([0xd5, 0x30, 0xfd]);
    expect(one('JMP @A+DPTR')).toEqual([0x73]);
    expect(one('LCALL 1234h')).toEqual([0x12, 0x12, 0x34]);
    // AJMP / ACALL: the eleven address bits are split 3 + 8
    expect(one('AJMP 0123h')).toEqual([0x21, 0x23]);
    expect(one('ACALL 0456h')).toEqual([0x91, 0x56]);
    expect(one('AJMP 07FFh')).toEqual([0xe1, 0xff]);
  });

  it('every encoding has the length the core expects', () => {
    const samples = [
      'NOP', 'MOV A,#1', 'MOV 30h,#1', 'MOV DPTR,#1', 'INC @R0', 'MOV A,@R0', 'MOV @R0,30h', 'CJNE @R0,#1,$',
      'SJMP $', 'LJMP 0', 'XCH A,@R0', 'XCHD A,@R0', 'ANL 30h,#1', 'ANL C,P1.0', 'PUSH ACC', 'MOV R0,30h',
      'MOV 30h,R0', 'DJNZ R0,$', 'CJNE R0,#1,$', 'MOVX A,@DPTR', 'MOVC A,@A+PC', 'INC DPTR', 'MUL AB',
    ];
    for (const s of samples) {
      const bytes = one(s);
      expect(bytes.length, s).toBe(LENGTHS[bytes[0]]);
    }
  });
});

describe('8051 assembler: numbers, expressions and directives', () => {
  it('reads every radix', () => {
    expect(parseNumber('255')).toBe(255);
    expect(parseNumber('0xFF')).toBe(255);
    expect(parseNumber('0FFh')).toBe(255);
    expect(parseNumber('11111111b')).toBe(255);
    expect(parseNumber('377q')).toBe(255);
    expect(parseNumber('377o')).toBe(255);
    expect(parseNumber('100d')).toBe(100);
    for (const text of ['0FFh', '0xFF', '11111111b', '377q', '255']) expect(one(`MOV A,#${text}`), text).toEqual([0x74, 0xff]);
    expect(one("MOV A,#'A'")).toEqual([0x74, 0x41]);
  });

  it('evaluates expressions with the documented precedence', () => {
    expect(one('MOV A,#(2*3+4)')).toEqual([0x74, 0x0a]);
    expect(one('MOV A,#2+3*4')).toEqual([0x74, 0x0e]);
    expect(one('MOV A,#HIGH(1234h)')).toEqual([0x74, 0x12]);
    expect(one('MOV A,#LOW(1234h)')).toEqual([0x74, 0x34]);
    expect(one('MOV A,#0F0h AND 3Ch')).toEqual([0x74, 0x30]);
    expect(one('MOV A,#0F0h OR 0Fh')).toEqual([0x74, 0xff]);
    expect(one('MOV A,#1 SHL 4')).toEqual([0x74, 0x10]);
    expect(one('MOV A,#1 << 4')).toEqual([0x74, 0x10]);
    expect(one('MOV A,#17 MOD 5')).toEqual([0x74, 0x02]);
    expect(one('MOV A,#NOT 0F0h AND 0FFh')).toEqual([0x74, 0x0f]);
    expect(one('MOV A,#-1')).toEqual([0x74, 0xff]);
  });

  it('ORG, DS, SET and forward references work across the two passes', () => {
    const r = asm(['ORG 10h', 'START: SJMP LATER', 'DS 4', 'LATER: NOP', 'N SET 1', 'N SET 2', 'MOV A,#N'].join('\n'));
    expect(r.errors).toEqual([]);
    // SJMP at 0x10 (2 bytes), 4 reserved bytes, LATER = 0x16
    expect(range(r, 0x10, 0x12)).toEqual([0x80, 0x04]);
    expect(r.symbols.find((s) => s.name === 'LATER')?.value).toBe(0x16);
    expect(range(r, 0x16, 0x19)).toEqual([0x00, 0x74, 0x02]);
    expect(r.start).toBe(0x10);
  });

  it('a BIT symbol names a bit address and a DATA symbol a byte address', () => {
    const r = asm(['MOTOR BIT P2.4', 'SPEED DATA 35h', 'SETB MOTOR', 'MOV SPEED,#80'].join('\n'));
    expect(r.errors).toEqual([]);
    expect(range(r, 0, 5)).toEqual([0xd2, 0xa4, 0x75, 0x35, 0x50]);
    expect(r.symbols.find((s) => s.name === 'MOTOR')?.kind).toBe('bit');
  });

  it('DB strings, single characters and DW lists', () => {
    const r = asm(["DB 'MachSim', 0", "DB 'A'", 'DW 0, 0FFFFh'].join('\n'));
    expect(r.errors).toEqual([]);
    expect(range(r, 0, 8)).toEqual([0x4d, 0x61, 0x63, 0x68, 0x53, 0x69, 0x6d, 0x00]);
    expect(range(r, 8, 13)).toEqual([0x41, 0x00, 0x00, 0xff, 0xff]);
  });

  it('a label on its own line takes the next address', () => {
    const r = asm(['TOP:', '  NOP', '  SJMP TOP'].join('\n'));
    expect(r.errors).toEqual([]);
    expect(range(r, 0, 3)).toEqual([0x00, 0x80, 0xfd]);
  });

  it('the listing shows addresses and bytes', () => {
    const text = listingText(asm('MOV P1,#0FFh\nNOP'));
    expect(text.split('\n')[0]).toContain('0000');
    expect(text.split('\n')[0]).toContain('75 90 FF');
    expect(text.split('\n')[1]).toContain('0003');
  });

  it('knows the documented mnemonics', () => {
    const m = mnemonics();
    for (const name of ['ACALL', 'ADD', 'CJNE', 'DJNZ', 'MOVX', 'RETI', 'XCHD']) expect(m).toContain(name);
    expect(m.length).toBe(44);
  });
});

describe('8051 assembler: errors', () => {
  const codes = (src: string) => asm(src).errors.map((e) => e.code);

  it('reports an unknown mnemonic with its line', () => {
    const r = asm('NOP\nFROB A\nNOP');
    expect(r.errors).toEqual([{ line: 2, code: 'unknownMnemonic', text: 'FROB' }]);
  });

  it('reports wrong operands, undefined symbols and duplicates', () => {
    expect(codes('MOV A')).toEqual(['badOperands', 'badOperands']);
    expect(codes('MOV A,R9')).toContain('undefinedSymbol');
    expect(codes('SJMP NOWHERE')).toEqual(['undefinedSymbol']);
    expect(codes('A1: NOP\nA1: NOP')).toEqual(['duplicateSymbol']);
    expect(codes('P1 EQU 20h')).toEqual(['reservedName']);
    expect(codes('X EQU Y\nY EQU 1')).toEqual(['undefinedSymbol']);
  });

  it('reports ranges that do not fit', () => {
    expect(codes('MOV A,#300')).toEqual(['rangeByte']);
    expect(codes('MOV DPTR,#70000')).toEqual(['rangeWord']);
    expect(codes(['ORG 0', 'SJMP FAR', 'ORG 200h', 'FAR: NOP'].join('\n'))).toEqual(['relTooFar']);
    expect(codes(['ORG 7FEh', 'AJMP 1000h'].join('\n'))).toEqual(['pageMismatch']);
    expect(codes('ORG 20000h')).toEqual(['orgRange']);
    expect(codes('CPL P1.9')).toEqual(['notBit']);
    expect(codes('CPL 31h.0')).toEqual(['notBit']);
  });

  it('reports bad numbers and characters', () => {
    expect(codes('MOV A,#12G')).toEqual(['badExpr']);
    expect(codes('MOV A,#1@2')).toEqual(['badChar']);
    expect(codes("MOV A,#'")).toEqual(['badString']);
    expect(codes('MOV A,#(1+2')).toEqual(['badExpr']);
  });

  it('still produces the bytes it could encode', () => {
    const r = asm('MOV A,#1\nFROB\nMOV A,#2');
    expect(r.errors.length).toBe(1);
    expect(range(r, 0, 4)).toEqual([0x74, 0x01, 0x74, 0x02]);
  });

  it('END stops the assembly', () => {
    const r = asm('MOV A,#1\nEND\nMOV A,#2');
    expect(r.errors).toEqual([]);
    expect(r.end).toBe(2);
  });
});

describe('8051 assembler: round trip through the core', () => {
  it('a counting program assembles and runs to the expected result', () => {
    const src = [
      '        ORG 0',
      '        MOV R0,#5',
      '        CLR A',
      'LOOP:   ADD A,R0',
      '        DJNZ R0,LOOP',
      '        MOV 30h,A',
      'STOP:   SJMP STOP',
    ].join('\n');
    const r = asm(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, r.end));
    while (c.iram[0x30] === 0 && c.cycles < 200) c.step();
    expect(c.iram[0x30]).toBe(5 + 4 + 3 + 2 + 1);
    // the listing maps the stop address back to its source line
    const stop = r.symbols.find((s) => s.name === 'STOP')!.value;
    expect(r.addrLine.get(stop)).toBe(7);
  });
});
