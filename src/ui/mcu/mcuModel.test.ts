/**
 * State of the MCU code editor: the view built from a live vector snapshot and from the panel's
 * own core, the PSW flag decoding, line / address mapping with breakpoints, the serial-terminal
 * decoder and the stand-alone debug run (step, run to a breakpoint, step a source line).
 */
import { describe, expect, it } from 'vitest';
import { assemble8051 } from '../../mcu/asm8051';
import { mcuVectorNames } from '../../mcu/probes';
import {
  StandaloneRun,
  TerminalDecoder,
  appendTerminal,
  bits,
  breakpointAddresses,
  emptyView,
  hex,
  lineAddresses,
  lineAtPc,
  mcuTime,
  pswFlags,
  terminalChar,
  viewFromSnapshot,
  VIEW_SFRS,
} from './mcuModel';

describe('MCU view', () => {
  it('reads every field from a vector snapshot', () => {
    const values = new Map<string, number>();
    const set = (key: string, v: number) => values.set(`${key}(a_u1)`.toLowerCase(), v);
    for (const name of mcuVectorNames('A_U1')) values.set(name.toLowerCase(), 0);
    set('Mpc', 0x1234);
    set('Ma', 0x5a);
    set('Mb', 7);
    set('Msp', 0x0b);
    set('Mpsw', 0xc5);
    set('Mdptr', 0x8000);
    set('Mr3', 9);
    set('Mp1', 0xfe);
    set('Mtmod', 0x21);
    set('Mcyc', 123456);
    set('Mbase', 0x40);
    set('Mm2', 0x99);
    set('Mtxn', 3);
    set('Mtx0', 0x43);
    const v = viewFromSnapshot(values, 'A_U1')!;
    expect(v.pc).toBe(0x1234);
    expect(v.a).toBe(0x5a);
    expect(v.b).toBe(7);
    expect(v.sp).toBe(0x0b);
    expect(v.dptr).toBe(0x8000);
    expect(v.regs[3]).toBe(9);
    expect(v.ports[1]).toBe(0xfe);
    expect(v.sfr.TMOD).toBe(0x21);
    expect(v.cycles).toBe(123456);
    expect(v.ramBase).toBe(0x40);
    expect(v.ram[2]).toBe(0x99);
    expect(v.txCount).toBe(3);
    expect(v.txRing[0]).toBe(0x43);
    expect(Object.keys(v.sfr).sort()).toEqual([...VIEW_SFRS].sort());
  });

  it('returns null when the read-outs are not recorded', () => {
    expect(viewFromSnapshot(new Map(), 'A_U1')).toBeNull();
    expect(viewFromSnapshot(new Map([['v(out)', 5]]), 'A_U1')).toBeNull();
  });

  it('decodes the PSW flags and formats bytes', () => {
    expect(pswFlags(0x00)).toEqual({ cy: 0, ac: 0, f0: 0, bank: 0, ov: 0, p: 0 });
    expect(pswFlags(0xff)).toEqual({ cy: 1, ac: 1, f0: 1, bank: 3, ov: 1, p: 1 });
    expect(pswFlags(0x08).bank).toBe(1);
    expect(pswFlags(0x10).bank).toBe(2);
    expect(hex(0x5, 2)).toBe('05');
    expect(hex(0x1234, 4)).toBe('1234');
    expect(bits(0x81)).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('an empty view starts from the reset state', () => {
    const v = emptyView(0x30);
    expect(v.sp).toBe(7);
    expect(v.ports).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(v.ram).toHaveLength(16);
  });

  it('mcuTime converts machine cycles to seconds', () => {
    expect(mcuTime(1000, 12e6)).toBeCloseTo(1e-3, 12);
    expect(mcuTime(1000, 0)).toBeCloseTo(1e-3, 12); // a bad frequency falls back to 12 MHz
  });
});

describe('MCU source lines and breakpoints', () => {
  const asm = assemble8051(['ORG 0', 'START: MOV A,#1', 'LOOP: INC A', 'SJMP LOOP', 'END'].join('\n'));

  it('maps source lines to addresses and back', () => {
    expect(asm.errors).toEqual([]);
    const byLine = lineAddresses(asm);
    expect(byLine.get(2)).toBe(0); // MOV A,#1
    expect(byLine.get(3)).toBe(2); // INC A
    expect(byLine.get(4)).toBe(3); // SJMP
    expect(lineAtPc(asm, 2)).toBe(3);
    expect(lineAtPc(asm, 1)).toBeUndefined(); // the middle of an instruction
  });

  it('breakpoint lines become addresses, unknown lines are dropped', () => {
    expect([...breakpointAddresses(asm, new Set([3, 4, 99]))].sort((a, b) => a - b)).toEqual([2, 3]);
    expect(breakpointAddresses(asm, new Set()).size).toBe(0);
  });
});

describe('MCU serial terminal', () => {
  it('decodes the bytes of successive snapshots', () => {
    const d = new TerminalDecoder();
    const base = emptyView();
    expect(d.feed({ ...base, txCount: 0 })).toEqual({ bytes: [], lost: 0 });
    expect(d.feed({ ...base, txCount: 1, txRing: [0x48, 0, 0, 0] })).toEqual({ bytes: [0x48], lost: 0 });
    expect(d.feed({ ...base, txCount: 3, txRing: [0x21, 0x69, 0x48, 0] })).toEqual({ bytes: [0x69, 0x21], lost: 0 });
    // more than four bytes between two snapshots: the oldest ones are reported as lost
    expect(d.feed({ ...base, txCount: 10, txRing: [4, 3, 2, 1] })).toEqual({ bytes: [1, 2, 3, 4], lost: 3 });
  });

  it('a restart (the counter goes back) resynchronises instead of replaying', () => {
    const d = new TerminalDecoder();
    const base = emptyView();
    d.feed({ ...base, txCount: 5, txRing: [1, 2, 3, 4] });
    expect(d.feed({ ...base, txCount: 0 })).toEqual({ bytes: [], lost: 0 });
    expect(d.feed({ ...base, txCount: 1, txRing: [0x41, 0, 0, 0] })).toEqual({ bytes: [0x41], lost: 0 });
  });

  it('turns bytes into terminal characters', () => {
    expect(terminalChar(0x41)).toBe('A');
    expect(terminalChar(0x0d)).toBe('\n');
    expect(terminalChar(0x0a)).toBe('\n');
    expect(terminalChar(0x09)).toBe('\t');
    expect(terminalChar(0x00)).toBe('.');
    expect(terminalChar(0x7f)).toBe('.');
  });

  it('appends chunks and keeps the text bounded', () => {
    expect(appendTerminal('Hi', { bytes: [0x21], lost: 0 })).toBe('Hi!');
    expect(appendTerminal('Hi', { bytes: [0x21], lost: 2 })).toBe('Hi…!');
    const long = appendTerminal('x'.repeat(50), { bytes: [0x41], lost: 0 }, 10);
    expect(long).toHaveLength(10);
    expect(long.endsWith('A')).toBe(true);
  });
});

describe('MCU stand-alone debug run', () => {
  const src = ['ORG 0', 'MOV R0,#3', 'LOOP: INC A', 'DJNZ R0,LOOP', 'MOV 30h,A', 'STOP: SJMP STOP'].join('\n');
  const asm = assemble8051(src);

  it('single-steps instruction by instruction', () => {
    expect(asm.errors).toEqual([]);
    const run = new StandaloneRun({ fosc: 12e6, xramSize: 0 });
    run.load(asm.bytes.subarray(0, asm.end));
    expect(run.view().pc).toBe(0);
    run.step();
    expect(run.view().regs[0]).toBe(3);
    expect(run.view().pc).toBe(2);
    run.step();
    expect(run.view().a).toBe(1);
  });

  it('runs to a breakpoint', () => {
    const run = new StandaloneRun({ fosc: 12e6, xramSize: 0 });
    run.load(asm.bytes.subarray(0, asm.end));
    const stop = breakpointAddresses(asm, new Set([5])); // MOV 30h,A
    const pc = run.run(stop);
    expect(pc).toBe([...stop][0]);
    expect(run.view().a).toBe(3); // the loop ran three times
    expect(run.view().ram[0]).toBe(0); // 30h is not written yet
    run.step();
    expect(run.view().ram[0]).toBe(3);
  });

  it('stops by itself when the program halts', () => {
    const bad = assemble8051(['ORG 0', 'MOV A,#1', 'DB 0A5h'].join('\n'));
    const run = new StandaloneRun({ fosc: 12e6, xramSize: 0 });
    run.load(bad.bytes.subarray(0, bad.end));
    run.run(new Set(), 100);
    expect(run.view().halted).toBe(1);
  });

  it('stepLine leaves the source line it started on', () => {
    const run = new StandaloneRun({ fosc: 12e6, xramSize: 0 });
    run.load(asm.bytes.subarray(0, asm.end));
    const map = asm.addrLine;
    run.stepLine(map); // past MOV R0,#3
    expect(lineAtPc(asm, run.view().pc)).toBe(3);
    run.stepLine(map); // past INC A
    expect(lineAtPc(asm, run.view().pc)).toBe(4);
  });

  it('reset puts the core back but keeps the program', () => {
    const run = new StandaloneRun({ fosc: 12e6, xramSize: 0 });
    run.load(asm.bytes.subarray(0, asm.end));
    run.run(new Set(), 200);
    expect(run.view().cycles).toBeGreaterThan(0);
    run.reset();
    expect(run.view().cycles).toBe(0);
    expect(run.view().pc).toBe(0);
    run.step();
    expect(run.view().regs[0]).toBe(3); // the program is still loaded
  });

  it('the RAM window follows its base address', () => {
    const run = new StandaloneRun({ fosc: 12e6, xramSize: 0 });
    run.load(assemble8051('MOV 45h,#0AAh\nSJMP $').bytes.subarray(0, 8));
    run.step();
    run.ramBase = 0x40;
    expect(run.view().ram[5]).toBe(0xaa);
    run.ramBase = 0x30;
    expect(run.view().ram.every((b) => b === 0)).toBe(true);
  });

  it('sends a byte into the serial receiver and reads what the program echoes', () => {
    const src2 = [
      'ORG 0',
      'MOV TMOD,#20h',
      'MOV TH1,#0FDh',
      'MOV TL1,#0FDh',
      'SETB TR1',
      'MOV SCON,#50h',
      'WAIT: JNB RI,WAIT',
      'CLR RI',
      'MOV SBUF,SBUF',
      'TXW: JNB TI,TXW',
      'CLR TI',
      'SJMP WAIT',
    ].join('\n');
    const a = assemble8051(src2);
    expect(a.errors).toEqual([]);
    const run = new StandaloneRun({ fosc: 11.0592e6, xramSize: 0 });
    run.load(a.bytes.subarray(0, a.end));
    const d = new TerminalDecoder();
    d.feed(run.view()); // synchronise the decoder before anything is sent
    run.send(0x4d); // 'M'
    run.run(new Set(), 100000);
    const chunk = d.feed(run.view());
    expect(run.view().txCount).toBeGreaterThanOrEqual(1);
    expect(chunk.bytes).toContain(0x4d);
  });
});
