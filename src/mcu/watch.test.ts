/**
 * Watch expressions of the 8051 debugger: parsing, precedence, registers, bits, memory cells and
 * the fixed cells that need a hardware watch slot.
 */
import { describe, expect, it } from 'vitest';
import { compileWatch, formatWatchValue, type WatchContext, type WatchProgram } from './watch';
import { WATCH_SPACE } from './debugger';
import { Cpu8051 } from './cpu8051';
import { CoreDebugger, encodeWatch } from './debugger';
import { buildProgram } from './program';

function ctx(regs: Record<string, number>, mem: Record<string, number> = {}): WatchContext {
  return {
    reg: (n) => regs[n === 'ACC' ? 'A' : n],
    mem: (space, address) => mem[`${space}:${address}`],
  };
}

const ok = (text: string): WatchProgram => {
  const p = compileWatch(text);
  if (!p.ok) throw new Error(`${text}: ${p.error.code} ${p.error.token ?? ''}`);
  return p;
};

describe('numbers and operators', () => {
  it('reads decimal, 0x, h and b numbers', () => {
    const c = ctx({});
    expect(ok('123').evaluate(c)).toBe(123);
    expect(ok('0x1F').evaluate(c)).toBe(31);
    expect(ok('1Fh').evaluate(c)).toBe(31);
    expect(ok('0B3h').evaluate(c)).toBe(0xb3);
    expect(ok('101b').evaluate(c)).toBe(5);
  });

  it('follows the precedence of C', () => {
    const c = ctx({});
    expect(ok('1 + 2 * 3').evaluate(c)).toBe(7);
    expect(ok('(1 + 2) * 3').evaluate(c)).toBe(9);
    expect(ok('1 << 2 + 1').evaluate(c)).toBe(8);
    expect(ok('6 & 3 | 8').evaluate(c)).toBe(10);
    expect(ok('1 | 2 ^ 3').evaluate(c)).toBe(1);
    expect(ok('3 == 3 && 2 < 1').evaluate(c)).toBe(0);
    expect(ok('3 != 4 || 0').evaluate(c)).toBe(1);
    expect(ok('-5 + 8').evaluate(c)).toBe(3);
    expect(ok('~0 & 0xFF').evaluate(c)).toBe(255);
    expect(ok('!5').evaluate(c)).toBe(0);
    expect(ok('17 / 5').evaluate(c)).toBe(3);
    expect(ok('17 % 5').evaluate(c)).toBe(2);
  });

  it('a division by zero has no value instead of crashing', () => {
    expect(ok('5 / 0').evaluate(ctx({}))).toBeUndefined();
    expect(ok('5 % 0').evaluate(ctx({}))).toBeUndefined();
  });
});

describe('registers, SFRs and bits', () => {
  const c = ctx({ A: 0x81, B: 3, R0: 0x30, R1: 0x31, SP: 7, PC: 0x12, PSW: 0x81, DPTR: 0x1234, P1: 0xf0, TH0: 0x12, TL0: 0x34 });

  it('reads registers whatever the case', () => {
    expect(ok('a').evaluate(c)).toBe(0x81);
    expect(ok('acc').evaluate(c)).toBe(0x81);
    expect(ok('R0 + R1').evaluate(c)).toBe(0x61);
    expect(ok('(TH0 << 8) | TL0').evaluate(c)).toBe(0x1234);
  });

  it('reads a bit of a register or SFR', () => {
    expect(ok('A.7').evaluate(c)).toBe(1);
    expect(ok('ACC.0').evaluate(c)).toBe(1);
    expect(ok('P1.3').evaluate(c)).toBe(0);
    expect(ok('P1.7').evaluate(c)).toBe(1);
    expect(ok('PSW.7').evaluate(c)).toBe(1);
  });

  it('knows a value is missing when the context does not have it', () => {
    expect(ok('R5').evaluate(c)).toBeUndefined();
    expect(ok('R5 + 1').evaluate(c)).toBeUndefined();
  });

  it('refuses unknown names, a bad bit number and a syntax error, with the position', () => {
    const unknown = compileWatch('A + FOO');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toEqual({ code: 'unknownName', token: 'FOO', at: 4 });
    const bit = compileWatch('A.9');
    if (!bit.ok) expect(bit.error.code).toBe('badBit');
    expect(bit.ok).toBe(false);
    for (const text of ['A +', '(A', 'A )', '1 2', '5 $', '0xZZ', '']) expect(compileWatch(text).ok, text).toBe(false);
    const empty = compileWatch('  ');
    if (!empty.ok) expect(empty.error.code).toBe('empty');
  });
});

describe('memory cells and hardware slots', () => {
  it('collects the fixed cells an expression reads, once each', () => {
    const p = ok('[30h] + [30h] + XRAM[100h] + CODE[0] + IRAM[80h]');
    expect(p.refs).toEqual([
      { space: WATCH_SPACE.direct, address: 0x30 },
      { space: WATCH_SPACE.xram, address: 0x100 },
      { space: WATCH_SPACE.code, address: 0 },
      { space: WATCH_SPACE.indirect, address: 0x80 },
    ]);
    const c = ctx({}, { [`${WATCH_SPACE.direct}:${0x30}`]: 5, [`${WATCH_SPACE.xram}:${0x100}`]: 7, [`${WATCH_SPACE.code}:0`]: 2, [`${WATCH_SPACE.indirect}:${0x80}`]: 1 });
    expect(p.evaluate(c)).toBe(5 + 5 + 7 + 2 + 1);
  });

  it('an SFR that the registers do not cover becomes a fixed direct cell, a bit name a bit cell', () => {
    const p = ok('TMOD');
    // TMOD has no register read-out in this context: the cell is the direct address 89h
    expect(p.refs).toEqual([{ space: WATCH_SPACE.direct, address: 0x89 }]);
    expect(p.evaluate(ctx({ TMOD: 0x21 }))).toBe(0x21);
    expect(p.evaluate(ctx({}, { [`${WATCH_SPACE.direct}:${0x89}`]: 0x11 }))).toBe(0x11);
    const bit = ok('TR0');
    expect(bit.refs).toEqual([{ space: WATCH_SPACE.bit, address: 0x8c }]);
    expect(bit.evaluate(ctx({}, { [`${WATCH_SPACE.bit}:${0x8c}`]: 1 }))).toBe(1);
  });

  it('a computed address is looked up at evaluation time and needs no slot', () => {
    const p = ok('[R0 + 1] + @R1');
    expect(p.refs).toEqual([]);
    const c = ctx({ R0: 0x30, R1: 0x40 }, { [`${WATCH_SPACE.direct}:${0x31}`]: 9, [`${WATCH_SPACE.indirect}:${0x40}`]: 4 });
    expect(p.evaluate(c)).toBe(13);
    expect(p.evaluate(ctx({ R0: 0x30, R1: 0x40 }))).toBeUndefined();
  });

  it('refuses an expression that needs more cells than there are slots', () => {
    const cells = Array.from({ length: 9 }, (_, k) => `[${0x20 + k}]`).join(' + ');
    const p = compileWatch(cells);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe('tooManyCells');
    expect(compileWatch(cells, 9).ok).toBe(true);
  });

  it('PIN[n] reads an external pin level', () => {
    expect(ok('PIN[9]').refs).toEqual([{ space: WATCH_SPACE.pin, address: 9 }]);
  });
});

describe('the values a real core and the debugger slots give', () => {
  it('a slot reads the same value the expression language asks for', () => {
    const build = buildProgram(['MOV 30h,#55h', 'SETB P1.2', 'MOV DPTR,#1234h', 'HERE: SJMP HERE'].join('\n'));
    const cpu = new Cpu8051();
    cpu.loadCode(build.bytes);
    const dbg = new CoreDebugger(cpu, 1e-6);
    const p = ok('[30h] + P1.2');
    p.refs.forEach((r, k) => dbg.setWatch(k, encodeWatch(r.space, r.address)));
    for (let k = 0; k < 3; k++) cpu.step();
    const slots = new Map(p.refs.map((r, k) => [`${r.space}:${r.address}`, dbg.readWatch(k)]));
    expect(p.evaluate({ reg: (n) => (n === 'P1' ? cpu.portDrive(1) : undefined), mem: (s, a) => slots.get(`${s}:${a}`) })).toBe(0x55 + 1);
  });
});

describe('formatting', () => {
  it('shows decimal, hex and binary', () => {
    expect(formatWatchValue(0x5a, 'dec')).toBe('90');
    expect(formatWatchValue(0x5a, 'hex')).toBe('5Ah');
    expect(formatWatchValue(0x5a, 'bin')).toBe('01011010b');
    expect(formatWatchValue(0x5a)).toBe('90 = 5Ah = 01011010b');
    expect(formatWatchValue(0x1234)).toBe('4660 = 1234h');
    expect(formatWatchValue(5, 'hex')).toBe('05h');
    expect(formatWatchValue(undefined)).toBe('?');
    expect(formatWatchValue(-1, 'hex')).toBe('FFFFFFFFh');
  });
});

describe('planWatches', () => {
  it('gives each distinct cell one slot in order of first use and builds the stop mask', async () => {
    const { planWatches } = await import('./watch');
    const plan = planWatches([
      { text: 'A', stop: true },
      { text: '[30h] + [31h]', stop: false },
      { text: '[31h] * 2', stop: true },
      { text: 'TMOD', stop: false },
      { text: 'FOO', stop: false },
    ]);
    expect(plan.cells.map((c) => c.address)).toEqual([0x30, 0x31, 0x89]);
    // A has no memory cell: nothing to stop on; [31h] is slot 1
    expect(plan.breakMask).toBe(0b10);
    expect(plan.programs.map((p) => p.ok)).toEqual([true, true, true, true, false]);
  });

  it('refuses the expression that does not fit instead of taking half of the slots', async () => {
    const { planWatches } = await import('./watch');
    const six = Array.from({ length: 6 }, (_, k) => `[${0x20 + k}]`).join('+');
    const three = '[40h] + [41h] + [42h]';
    const plan = planWatches([
      { text: six, stop: false },
      { text: three, stop: false },
      { text: '[20h]', stop: false },
    ]);
    expect(plan.programs[1].ok).toBe(false);
    expect(plan.cells).toHaveLength(6);
    expect(plan.programs[2].ok).toBe(true);
  });
});
