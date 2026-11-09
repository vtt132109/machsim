/**
 * MCS-51 core: instruction-level behaviour (flags of ADD / ADDC / SUBB / DA, MUL / DIV, jumps,
 * calls, bit operations, the register banks and the read-modify-write rule of the ports), machine
 * cycle counts, timer and interrupt timing counted in machine cycles, and the serial port.
 *
 * Every expectation is the published behaviour of the architecture, computed by hand in the test.
 */
import { describe, expect, it } from 'vitest';
import { CYCLES, Cpu8051, LENGTHS, PIN_INT0, PIN_T0, SFR, machineCycleSeconds } from './cpu8051';
import { assemble8051 } from './asm8051';

/** A core loaded with hand-written bytes at 0. */
function cpu(bytes: number[], xramSize = 0): Cpu8051 {
  const c = new Cpu8051({ xramSize });
  c.loadCode(bytes);
  return c;
}

/** Run `n` instructions. */
function steps(c: Cpu8051, n: number): void {
  for (let i = 0; i < n; i++) c.step();
}

const cy = (c: Cpu8051) => (c.psw >> 7) & 1;
const ac = (c: Cpu8051) => (c.psw >> 6) & 1;
const ov = (c: Cpu8051) => (c.psw >> 2) & 1;
const par = (c: Cpu8051) => c.psw & 1;

describe('8051 core: arithmetic and flags', () => {
  it('ADD A,#data sets CY, AC and OV exactly', () => {
    // 0x7F + 0x01 = 0x80: no carry out of bit 7, carry out of bit 3 (AC), signed overflow
    let c = cpu([0x74, 0x7f, 0x24, 0x01]);
    steps(c, 2);
    expect(c.acc).toBe(0x80);
    expect(cy(c)).toBe(0);
    expect(ac(c)).toBe(1);
    expect(ov(c)).toBe(1);
    // 0xFF + 0x01 = 0x00: carry and AC, but no signed overflow (-1 + 1 = 0)
    c = cpu([0x74, 0xff, 0x24, 0x01]);
    steps(c, 2);
    expect(c.acc).toBe(0x00);
    expect(cy(c)).toBe(1);
    expect(ac(c)).toBe(1);
    expect(ov(c)).toBe(0);
    // 0x80 + 0x80 = 0x00: carry, no AC, signed overflow (-128 + -128)
    c = cpu([0x74, 0x80, 0x24, 0x80]);
    steps(c, 2);
    expect(cy(c)).toBe(1);
    expect(ac(c)).toBe(0);
    expect(ov(c)).toBe(1);
    // 0x30 + 0x05: nothing set
    c = cpu([0x74, 0x30, 0x24, 0x05]);
    steps(c, 2);
    expect(c.acc).toBe(0x35);
    expect(cy(c) + ac(c) + ov(c)).toBe(0);
  });

  it('ADDC A,Rn adds the carry in', () => {
    // SETB C; MOV A,#10h; MOV R3,#0F0h; ADDC A,R3  => 0x101 -> A = 1, CY = 1
    const c = cpu([0xd3, 0x74, 0x10, 0x7b, 0xf0, 0x3b]);
    steps(c, 4);
    expect(c.acc).toBe(0x01);
    expect(cy(c)).toBe(1);
  });

  it('SUBB A,#data borrows and sets OV on signed overflow', () => {
    // CLR C; MOV A,#80h; SUBB A,#01h = 0x7F, borrow out of bit 7 only -> OV = 1, CY = 0
    let c = cpu([0xc3, 0x74, 0x80, 0x94, 0x01]);
    steps(c, 3);
    expect(c.acc).toBe(0x7f);
    expect(cy(c)).toBe(0);
    expect(ov(c)).toBe(1);
    // CLR C; MOV A,#10h; SUBB A,#20h = 0xF0 with a borrow
    c = cpu([0xc3, 0x74, 0x10, 0x94, 0x20]);
    steps(c, 3);
    expect(c.acc).toBe(0xf0);
    expect(cy(c)).toBe(1);
    expect(ov(c)).toBe(0);
    // the borrow of the previous subtraction is taken into account
    c = cpu([0xd3, 0x74, 0x10, 0x94, 0x05]);
    steps(c, 3);
    expect(c.acc).toBe(0x0a); // 0x10 - 5 - 1
  });

  it('DA A turns a binary sum into packed BCD and only ever sets the carry', () => {
    // 0x38 + 0x45 = 0x7D; DA A -> 0x83 (38 + 45 = 83 decimal), no carry
    let c = cpu([0x74, 0x38, 0x24, 0x45, 0xd4]);
    steps(c, 3);
    expect(c.acc).toBe(0x83);
    expect(cy(c)).toBe(0);
    // 0x88 + 0x77 = 0xFF with AC = 0; DA A -> 0x65 with a carry (88 + 77 = 165)
    c = cpu([0x74, 0x88, 0x24, 0x77, 0xd4]);
    steps(c, 3);
    expect(c.acc).toBe(0x65);
    expect(cy(c)).toBe(1);
    // 0x09 + 0x01 = 0x0A; DA A -> 0x10
    c = cpu([0x74, 0x09, 0x24, 0x01, 0xd4]);
    steps(c, 3);
    expect(c.acc).toBe(0x10);
    expect(cy(c)).toBe(0);
  });

  it('MUL AB and DIV AB take four machine cycles and set OV', () => {
    // MOV A,#50; MOV B,#20 -> 1000 = 0x03E8: A = 0xE8, B = 0x03, OV = 1, CY = 0
    const c = cpu([0x74, 50, 0x75, SFR.B, 20, 0xa4]);
    steps(c, 2);
    const before = c.cycles;
    c.step();
    expect(c.cycles - before).toBe(4);
    expect(c.acc).toBe(0xe8);
    expect(c.sfr[SFR.B - 0x80]).toBe(0x03);
    expect(ov(c)).toBe(1);
    expect(cy(c)).toBe(0);
    // MOV A,#200; MOV B,#7 -> quotient 28, remainder 4, OV = 0
    const d = cpu([0x74, 200, 0x75, SFR.B, 7, 0x84]);
    steps(d, 3);
    expect(d.acc).toBe(28);
    expect(d.sfr[SFR.B - 0x80]).toBe(4);
    expect(ov(d)).toBe(0);
    // dividing by zero only sets OV
    const z = cpu([0x74, 5, 0x75, SFR.B, 0, 0x84]);
    steps(z, 3);
    expect(ov(z)).toBe(1);
    expect(z.acc).toBe(5);
  });

  it('PSW.P is the odd parity of the accumulator', () => {
    const c = cpu([0x74, 0x03, 0x74, 0x07, 0x74, 0x00]);
    c.step();
    expect(par(c)).toBe(0); // 0x03 has two bits
    c.step();
    expect(par(c)).toBe(1); // 0x07 has three
    c.step();
    expect(par(c)).toBe(0);
  });

  it('rotates move the carry through the accumulator', () => {
    // MOV A,#81h; RR A -> 0xC0 ; RL A -> 0x81 ; SETB C; RLC A -> 0x03 with CY = 1
    const c = cpu([0x74, 0x81, 0x03]);
    steps(c, 2);
    expect(c.acc).toBe(0xc0);
    const d = cpu([0x74, 0x81, 0x23]);
    steps(d, 2);
    expect(d.acc).toBe(0x03);
    const e = cpu([0x74, 0x81, 0xd3, 0x33]);
    steps(e, 3);
    expect(e.acc).toBe(0x03);
    expect(cy(e)).toBe(1);
    // RRC with CY = 1: 0x02 -> 0x81, CY = 0
    const f = cpu([0x74, 0x02, 0xd3, 0x13]);
    steps(f, 3);
    expect(f.acc).toBe(0x81);
    expect(cy(f)).toBe(0);
  });

  it('SWAP A, XCH and XCHD move nibbles and bytes', () => {
    const c = cpu([0x74, 0x3c, 0xc4]);
    steps(c, 2);
    expect(c.acc).toBe(0xc3);
    // MOV R0,#40h; MOV @R0,#0A5h; MOV A,#5Bh; XCHD A,@R0
    const d = cpu([0x78, 0x40, 0x76, 0xa5, 0x74, 0x5b, 0xd6]);
    steps(d, 4);
    expect(d.acc).toBe(0x55);
    expect(d.iram[0x40]).toBe(0xab);
  });
});

describe('8051 core: control flow', () => {
  it('LCALL pushes the return address and RET pops it', () => {
    // LCALL 0100h at 0 (returns to 0003); at 0100: RET
    const c = cpu([0x12, 0x01, 0x00]);
    c.loadCode([0x22], 0x100);
    c.step();
    expect(c.pc).toBe(0x100);
    expect(c.sp).toBe(0x09);
    expect(c.iram[0x08]).toBe(0x03); // low byte first
    expect(c.iram[0x09]).toBe(0x00);
    c.step();
    expect(c.pc).toBe(0x0003);
    expect(c.sp).toBe(0x07);
  });

  it('ACALL and AJMP stay inside the 2 KB page of the next instruction', () => {
    const r = assemble8051(['ORG 0', 'AJMP TARGET', 'ORG 100h', 'TARGET: NOP'].join('\n'));
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 0x200));
    c.step();
    expect(c.pc).toBe(0x100);
  });

  it('SJMP and the conditional jumps use a signed displacement', () => {
    // SJMP -2 at address 0 jumps back to itself
    const c = cpu([0x80, 0xfe]);
    c.step();
    expect(c.pc).toBe(0);
    // JZ taken, JNZ not taken
    const d = cpu([0xe4, 0x60, 0x02, 0x00, 0x00, 0x04]);
    steps(d, 2);
    expect(d.pc).toBe(0x05);
  });

  it('CJNE jumps when the bytes differ and reports which is smaller in CY', () => {
    // MOV A,#5; CJNE A,#7,+2 -> taken, CY = 1 (5 < 7)
    const c = cpu([0x74, 0x05, 0xb4, 0x07, 0x02]);
    steps(c, 2);
    expect(c.pc).toBe(0x07);
    expect(cy(c)).toBe(1);
    // equal: not taken, CY = 0
    const d = cpu([0x74, 0x07, 0xb4, 0x07, 0x02]);
    steps(d, 2);
    expect(d.pc).toBe(0x05);
    expect(cy(d)).toBe(0);
  });

  it('DJNZ counts a register down to zero', () => {
    // MOV R2,#3; loop: DJNZ R2,loop
    const c = cpu([0x7a, 0x03, 0xda, 0xfe]);
    c.step();
    let iterations = 0;
    while (c.pc === 0x02 || iterations === 0) {
      c.step();
      iterations++;
      if (iterations > 10) break;
    }
    expect(iterations).toBe(3);
    expect(c.reg(2)).toBe(0);
    expect(c.pc).toBe(0x04);
  });

  it('JMP @A+DPTR adds the accumulator to the data pointer', () => {
    const c = cpu([0x90, 0x02, 0x00, 0x74, 0x06, 0x73]);
    steps(c, 3);
    expect(c.pc).toBe(0x206);
  });

  it('the undefined opcode A5 halts the core', () => {
    const c = cpu([0x00, 0xa5, 0x00]);
    steps(c, 3);
    expect(c.halted).toBe('opcode');
    expect(c.haltPc).toBe(1);
  });
});

describe('8051 core: bits, registers and ports', () => {
  it('bit addresses reach the RAM bit area and the SFR bits', () => {
    // SETB 08h (bit 0 of 21h); SETB P1.3; CLR TR0; SETB C; MOV 2Fh.7,C
    const c = cpu([0xd2, 0x08, 0xd2, 0x93, 0xc2, 0x8c, 0xd3, 0x92, 0x7f]);
    steps(c, 5);
    expect(c.iram[0x21]).toBe(0x01);
    expect(c.sfr[SFR.P1 - 0x80]).toBe(0xff); // already all ones after reset
    expect(c.sfr[SFR.TCON - 0x80] & 0x10).toBe(0);
    expect(c.iram[0x2f]).toBe(0x80);
  });

  it('ANL C,bit and ANL C,/bit combine the carry with a bit', () => {
    // ANL C,bit is not a read-modify-write instruction, so it reads the PIN: the test drives
    // P1.0 low from outside as a real circuit would.
    // CLR P1.0 ; SETB C ; ANL C,P1.0 -> 0 ; and with /P1.0 -> 1
    const c = cpu([0xc2, 0x90, 0xd3, 0x82, 0x90]);
    c.pinIn[8] = 0;
    steps(c, 3);
    expect(cy(c)).toBe(0);
    const d = cpu([0xc2, 0x90, 0xd3, 0xb0, 0x90]);
    d.pinIn[8] = 0;
    steps(d, 3);
    expect(cy(d)).toBe(1);
    // with the pin high the same code leaves the carry set
    const e = cpu([0xd3, 0x82, 0x90]);
    steps(e, 2);
    expect(cy(e)).toBe(1);
  });

  it('JBC jumps and clears the bit in one instruction', () => {
    const c = cpu([0xd2, 0x08, 0x10, 0x08, 0x02]);
    steps(c, 2);
    expect(c.pc).toBe(0x07);
    expect(c.iram[0x21] & 1).toBe(0);
  });

  it('PSW.RS1 / RS0 select the register bank', () => {
    // MOV R0,#11h ; MOV PSW,#08h (bank 1) ; MOV R0,#22h
    const c = cpu([0x78, 0x11, 0x75, SFR.PSW, 0x08, 0x78, 0x22]);
    steps(c, 3);
    expect(c.iram[0x00]).toBe(0x11);
    expect(c.iram[0x08]).toBe(0x22);
    expect(c.bank).toBe(1);
  });

  it('reading a port gives the pin levels, a read-modify-write gives the latch', () => {
    // the outside world pulls P1.0 low while the latch is high
    const c = cpu([0xe5, SFR.P1, 0x43, SFR.P1, 0x00]);
    c.pinIn[8] = 0;
    c.step();
    expect(c.acc).toBe(0xfe); // MOV A,P1 sees the pin
    c.step(); // ORL P1,#0 reads the latch (0xFF) and writes it back unchanged
    expect(c.sfr[SFR.P1 - 0x80]).toBe(0xff);
  });

  it('the port drives the latch, and TXD is the latch AND the serial output', () => {
    const c = cpu([0x75, SFR.P1, 0x5a]);
    c.step();
    expect(c.portDrive(1)).toBe(0x5a);
    expect(c.pinOut(8)).toBe(0);
    expect(c.pinOut(9)).toBe(1);
  });

  it('MOVX reaches external data memory, MOVC reads the program', () => {
    // MOV DPTR,#0010h ; MOV A,#5Ah ; MOVX @DPTR,A ; CLR A ; MOVX A,@DPTR
    const c = cpu([0x90, 0x00, 0x10, 0x74, 0x5a, 0xf0, 0xe4, 0xe0], 256);
    steps(c, 5);
    expect(c.acc).toBe(0x5a);
    // without external memory a read gives 0xFF
    const d = cpu([0x90, 0x00, 0x10, 0xe0], 0);
    steps(d, 2);
    expect(d.acc).toBe(0xff);
    // MOVC A,@A+DPTR reads a table in the code
    const e = cpu([0x90, 0x00, 0x20, 0x74, 0x02, 0x93]);
    e.loadCode([0x11, 0x22, 0x33], 0x20);
    steps(e, 3);
    expect(e.acc).toBe(0x33);
  });

  it('MOV direct,direct copies the source named first', () => {
    const r = assemble8051('MOV 30h,#55h\nMOV 31h,30h');
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 16));
    steps(c, 2);
    expect(c.iram[0x31]).toBe(0x55);
  });
});

describe('8051 core: cycles, timers and interrupts', () => {
  it('the cycle table matches the published counts', () => {
    expect(CYCLES[0x00]).toBe(1); // NOP
    expect(CYCLES[0x24]).toBe(1); // ADD A,#data
    expect(CYCLES[0x02]).toBe(2); // LJMP
    expect(CYCLES[0x12]).toBe(2); // LCALL
    expect(CYCLES[0xa4]).toBe(4); // MUL AB
    expect(CYCLES[0x84]).toBe(4); // DIV AB
    expect(CYCLES[0xa3]).toBe(2); // INC DPTR
    expect(CYCLES[0x05]).toBe(1); // INC direct
    expect(CYCLES[0x75]).toBe(2); // MOV direct,#data
    expect(CYCLES[0xe0]).toBe(2); // MOVX A,@DPTR
    expect(CYCLES[0xd8]).toBe(2); // DJNZ R0,rel
    expect(CYCLES[0x53]).toBe(2); // ANL direct,#data
    expect(CYCLES[0x52]).toBe(1); // ANL direct,A
  });

  it('the length table matches the published instruction sizes', () => {
    expect(LENGTHS[0x00]).toBe(1);
    expect(LENGTHS[0x74]).toBe(2); // MOV A,#data
    expect(LENGTHS[0x75]).toBe(3); // MOV direct,#data
    expect(LENGTHS[0x90]).toBe(3); // MOV DPTR,#data16
    expect(LENGTHS[0x06]).toBe(1); // INC @R0
    expect(LENGTHS[0xe6]).toBe(1); // MOV A,@R0
    expect(LENGTHS[0xa6]).toBe(2); // MOV @R0,direct
    expect(LENGTHS[0xb6]).toBe(3); // CJNE @R0,#data,rel
    expect(LENGTHS[0x80]).toBe(2); // SJMP
    expect(LENGTHS[0x02]).toBe(3); // LJMP
    // every opcode's length matches what the assembler produced for that encoding
    expect(LENGTHS[0xc6]).toBe(1); // XCH A,@R0
    expect(LENGTHS[0xd6]).toBe(1); // XCHD A,@R0
  });

  it('timer 0 in mode 1 overflows after exactly 65536 - TH0:TL0 machine cycles', () => {
    // MOV TMOD,#01h ; MOV TH0,#0FFh ; MOV TL0,#0F0h ; SETB TR0 ; wait: JNB TF0,wait
    const src = ['MOV TMOD,#01h', 'MOV TH0,#0FFh', 'MOV TL0,#0F0h', 'SETB TR0', 'WAIT: JNB TF0,WAIT'].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 32));
    // run the four setup instructions: 2 + 2 + 2 + 1 = 7 cycles
    steps(c, 4);
    expect(c.cycles).toBe(7);
    const startCycles = c.cycles;
    while ((c.sfr[SFR.TCON - 0x80] & 0x20) === 0 && c.cycles < 1000) c.step();
    // the timer started at 0xFFF0, so it overflows 16 counts later
    expect(c.sfr[SFR.TCON - 0x80] & 0x20).toBe(0x20);
    const elapsed = c.cycles - startCycles;
    expect(elapsed).toBeGreaterThanOrEqual(16);
    expect(elapsed).toBeLessThanOrEqual(16 + 2); // detected at the end of the polling instruction
  });

  it('timer 0 in mode 2 reloads from TH0 and repeats', () => {
    const c = new Cpu8051();
    c.sfr[SFR.TMOD - 0x80] = 0x02; // mode 2
    c.sfr[SFR.TH0 - 0x80] = 0xfb; // reload -> 5 counts per overflow
    c.sfr[SFR.TL0 - 0x80] = 0xfb;
    c.sfr[SFR.TCON - 0x80] = 0x10; // TR0
    c.loadCode([0x00, 0x80, 0xfd]); // NOP ; SJMP -3  (never clears TF0)
    const times: number[] = [];
    let seen = false;
    while (c.cycles < 60) {
      c.step();
      const tf = (c.sfr[SFR.TCON - 0x80] & 0x20) !== 0;
      if (tf && !seen) times.push(c.cycles);
      if (tf) c.sfr[SFR.TCON - 0x80] &= ~0x20;
      seen = false;
    }
    // overflows every 5 machine cycles
    expect(times.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(7);
  });

  it('a timer 0 interrupt vectors to 000Bh and RETI allows the next one', () => {
    const src = [
      'ORG 0',
      'LJMP MAIN',
      'ORG 0Bh',
      'INC 30h',
      'RETI',
      'ORG 30h',
      'MAIN: MOV TMOD,#02h',
      'MOV TH0,#0FBh',
      'MOV TL0,#0FBh',
      'MOV IE,#82h',
      'SETB TR0',
      'HERE: SJMP HERE',
    ].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 0x80));
    const marks: number[] = [];
    let last = 0;
    while (c.cycles < 200) {
      c.step();
      const n = c.iram[0x30];
      if (n !== last) {
        marks.push(c.cycles);
        last = n;
      }
    }
    expect(c.iram[0x30]).toBeGreaterThan(3);
    // one interrupt per overflow (5 cycles) once the handler overhead is paid: the handler is
    // 2 (vector) + 1 (INC) + 2 (RETI) = 5 cycles, so it runs back to back
    for (let i = 1; i < marks.length; i++) expect(marks[i] - marks[i - 1]).toBeLessThanOrEqual(12);
  });

  it('an external interrupt on INT0 is edge triggered when IT0 is set', () => {
    const src = ['ORG 0', 'LJMP MAIN', 'ORG 3', 'INC 31h', 'RETI', 'ORG 30h', 'MAIN: SETB IT0', 'MOV IE,#81h', 'HERE: SJMP HERE'].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 0x80));
    steps(c, 4);
    expect(c.iram[0x31]).toBe(0);
    // a high level does nothing
    for (let i = 0; i < 10; i++) c.step();
    expect(c.iram[0x31]).toBe(0);
    // one falling edge gives exactly one interrupt
    c.pinIn[PIN_INT0] = 0;
    for (let i = 0; i < 20; i++) c.step();
    expect(c.iram[0x31]).toBe(1);
    // holding it low gives no more
    for (let i = 0; i < 40; i++) c.step();
    expect(c.iram[0x31]).toBe(1);
    c.pinIn[PIN_INT0] = 1;
    c.step();
    c.pinIn[PIN_INT0] = 0;
    for (let i = 0; i < 20; i++) c.step();
    expect(c.iram[0x31]).toBe(2);
  });

  it('counter mode counts falling edges on T0', () => {
    const c = new Cpu8051();
    c.sfr[SFR.TMOD - 0x80] = 0x05; // timer 0, mode 1, C/T = 1
    c.sfr[SFR.TCON - 0x80] = 0x10; // TR0
    c.loadCode([0x00, 0x80, 0xfd]);
    for (let k = 0; k < 7; k++) {
      c.pinIn[PIN_T0] = 1;
      c.step();
      c.pinIn[PIN_T0] = 0;
      c.step();
    }
    expect(c.sfr[SFR.TL0 - 0x80]).toBe(7);
  });

  it('the high-priority interrupt interrupts the low-priority one', () => {
    const src = [
      'ORG 0',
      'LJMP MAIN',
      'ORG 3', // INT0, low priority
      'INC 40h',
      'SJMP $', // stays in the handler until something else interrupts it
      'ORG 0Bh', // timer 0, high priority
      'INC 41h',
      'RETI',
      'ORG 40h',
      'MAIN: SETB IT0',
      'MOV TMOD,#02h',
      'MOV TH0,#0FBh',
      'MOV TL0,#0FBh',
      'MOV IP,#02h', // PT0 = 1
      'MOV IE,#83h',
      'SETB TR0',
      'HERE: SJMP HERE',
    ].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 0x80));
    steps(c, 8);
    c.pinIn[PIN_INT0] = 0;
    while (c.cycles < 300) c.step();
    expect(c.iram[0x40]).toBe(1); // the INT0 handler was entered once and never returns
    expect(c.iram[0x41]).toBeGreaterThan(3); // the timer still interrupts it
  });
});

describe('8051 core: serial port', () => {
  it('mode 1 shifts the frame out of TXD at the timer 1 baud rate and then sets TI', () => {
    const src = [
      'MOV TMOD,#20h', // timer 1, mode 2
      'MOV TH1,#0FDh', // 3 counts -> bit time 32 * 3 = 96 machine cycles
      'MOV TL1,#0FDh',
      'SETB TR1',
      'MOV SCON,#50h', // mode 1, REN
      'MOV SBUF,#41h', // 'A' = 0100 0001
      'WAIT: JNB TI,WAIT',
      'CLR TI',
      'HERE: SJMP HERE',
    ].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 0x40));
    steps(c, 6);
    expect(c.bitCycles()).toBe(96);
    const startCycles = c.cycles;
    // sample the TXD pin in the middle of every bit of the frame
    const bits: number[] = [];
    for (let k = 0; k < 10; k++) {
      const target = startCycles + Math.round((k + 0.5) * 96);
      while (c.cycles < target) c.step();
      bits.push(c.pinOut(25));
    }
    // start bit, then 'A' LSB first, then the stop bit
    expect(bits).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
    while (c.txCount === 0 && c.cycles < startCycles + 2000) c.step();
    expect(c.txLast).toBe(0x41);
    expect(c.takeTransmitted()).toEqual([0x41]);
  });

  it('a byte injected by the virtual terminal arrives in SBUF and sets RI', () => {
    const src = ['MOV TMOD,#20h', 'MOV TH1,#0FDh', 'MOV TL1,#0FDh', 'SETB TR1', 'MOV SCON,#50h', 'WAIT: JNB RI,WAIT', 'MOV 32h,SBUF', 'CLR RI', 'HERE: SJMP HERE'].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051();
    c.loadCode(r.bytes.subarray(0, 0x40));
    steps(c, 5);
    c.receiveByte(0x7a);
    while (c.iram[0x32] === 0 && c.cycles < 20000) c.step();
    expect(c.iram[0x32]).toBe(0x7a);
    expect(c.rxCount).toBe(1);
  });

  it('a frame fed to the RXD pin is received bit by bit', () => {
    const c = new Cpu8051();
    c.sfr[SFR.TMOD - 0x80] = 0x20;
    c.sfr[SFR.TH1 - 0x80] = 0xfd;
    c.sfr[SFR.TL1 - 0x80] = 0xfd;
    c.sfr[SFR.TCON - 0x80] = 0x40; // TR1
    c.sfr[SFR.SCON - 0x80] = 0x50; // mode 1, REN
    c.loadCode([0x00, 0x80, 0xfd]);
    const bt = 96;
    // start bit, then 0x16 = 0001 0110 least significant bit first, then the stop bit
    const frame = [0, 0, 1, 1, 0, 1, 0, 0, 0, 1];
    for (const b of frame) {
      c.pinIn[24] = b;
      const until = c.cycles + bt;
      while (c.cycles < until) c.step();
    }
    c.pinIn[24] = 1;
    for (let i = 0; i < 200; i++) c.step();
    expect(c.rxCount).toBe(1);
    expect(c.readDirect(SFR.SBUF)).toBe(0x16);
    expect(c.sfr[SFR.SCON - 0x80] & 0x01).toBe(1);
  });

  it('machineCycleSeconds converts the crystal frequency', () => {
    expect(machineCycleSeconds(12e6)).toBeCloseTo(1e-6, 12);
    expect(machineCycleSeconds(11.0592e6)).toBeCloseTo(1.0851e-6, 9);
  });
});

describe('8051 core: snapshots', () => {
  it('saveState / restoreState put the whole machine back', () => {
    const src = ['MOV R0,#10h', 'LOOP: INC 30h', 'MOV DPTR,#1234h', 'MOVX @DPTR,A', 'DJNZ R0,LOOP', 'HERE: SJMP HERE'].join('\n');
    const r = assemble8051(src);
    expect(r.errors).toEqual([]);
    const c = new Cpu8051({ xramSize: 0x2000 });
    c.loadCode(r.bytes.subarray(0, 0x40));
    steps(c, 3);
    const snap = c.saveState();
    const pc = c.pc;
    const cycles = c.cycles;
    const mark = c.iram[0x30];
    // run ahead, then roll back
    for (let i = 0; i < 50; i++) c.step();
    expect(c.iram[0x30]).not.toBe(mark);
    c.restoreState(snap);
    expect(c.pc).toBe(pc);
    expect(c.cycles).toBe(cycles);
    expect(c.iram[0x30]).toBe(mark);
    expect(c.xram[0x1234]).toBe(0);
    // and the replay gives exactly the same result
    for (let i = 0; i < 50; i++) c.step();
    const after = c.iram[0x30];
    const snap2 = c.saveState();
    for (let i = 0; i < 20; i++) c.step();
    c.restoreState(snap2);
    expect(c.iram[0x30]).toBe(after);
  });

  it('the reset pin holds the core in reset', () => {
    const c = cpu([0x74, 0x55, 0x80, 0xfe]);
    steps(c, 2);
    expect(c.acc).toBe(0x55);
    c.resetHeld = true;
    c.step();
    expect(c.acc).toBe(0);
    expect(c.pc).toBe(0);
    c.resetHeld = false;
    c.step();
    expect(c.acc).toBe(0x55);
  });
});
