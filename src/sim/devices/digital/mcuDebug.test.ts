/**
 * Debugging the co-simulated 8051 (round 4 step 4): breakpoints, single steps, run to cursor and
 * watches through the real interactive stepper, with the one rule that matters for a learner — the
 * circuit stops at exactly the time the core has executed: machine cycles × the cycle period
 * (1 µs at 12 MHz). Also the pure debugger (src/mcu/debugger.ts) on its own.
 */
import { describe, expect, it } from 'vitest';
import { createTransientStepper } from '../../index';
import type { TransientStepper } from '../../api';
import { netlist, res } from '../../engine/testing';
import type { ElementIR, ModelCard } from '../../netlist';
import { buildProgram, encodeImage } from '../../../mcu/program';
import { Cpu8051, machineCycleSeconds } from '../../../mcu/cpu8051';
import { CoreDebugger, DEBUG_REASON, WATCH_SPACE, encodeWatch } from '../../../mcu/debugger';

const CARD = 'MCU';
const MCS = 1e-6; // 12 MHz

function pins(map: Record<string, string>): string[] {
  const out: string[] = [];
  for (let port = 0; port < 4; port++) for (let bit = 0; bit < 8; bit++) out.push(map[`P${port}.${bit}`] ?? 'null');
  out.push(map.RST ?? 'null', map.EA ?? 'null');
  return out;
}

/** A program with known instruction lengths (machine cycles in the comments) and its labels. */
const PROGRAM = [
  'ORG 0',
  'START: MOV A,#5', // 0000h  1 cycle
  'ADD A,#3', // 0002h  1
  'MOV R0,A', // 0004h  1
  'MOV R7,#2', // 0005h  1
  'LOOP: INC R0', // 0007h  1
  'DJNZ R7,LOOP', // 0008h  2
  'MUL AB', // 000Ah  4
  'ACALL SUB', // 000Bh  2
  'SETB P1.0', // 000Dh  1
  'HERE: SJMP HERE', // 000Fh  2
  'SUB: INC R1', // 0011h  1
  'INC R1', // 0012h  1
  'RET', // 0013h  2
].join('\n');

const built = buildProgram(PROGRAM);
const addr = (label: string): number => {
  const sym = built.asm!.symbols.find((s) => s.name.toUpperCase() === label);
  if (!sym) throw new Error(`no label ${label}`);
  return sym.value;
};

function session(extra: Record<string, number> = {}): TransientStepper {
  expect(built.asmErrors).toEqual([]);
  const card: ModelCard = { name: CARD, type: 'D_MCU8051', params: { vol: 0, voh: 5, vnom: 5, rlow: 100, rhigh: 100, vth: 2.5 }, stringParams: { code: encodeImage(built) } };
  const el: ElementIR = { type: 'A', name: 'A1', nodes: [...pins({ 'P1.0': 'led' }), '0'], model: CARD, params: { pwr: 1, fosc: 12e6, pdrive: 1, ...extra } };
  return createTransientStepper(netlist([el, res('RL', 'led', '0', 10e3)], [], { models: [card], saves: ['all'] }), { tstep: 5e-6, saves: ['all'] });
}

/** Advance until the debugger holds the simulation (or fail after 5 ms of simulated time). */
function runUntilHeld(s: TransientStepper, limit = 5e-3): void {
  const stop = s.time + limit;
  // advance() reports the hold of ITS call, so it is always called at least once
  do s.advance(Math.min(stop, s.time + 2e-4));
  while (!s.held && s.time < stop);
  expect(s.held, 'the debugger should hold the simulation').toBe(true);
}

const read = (s: TransientStepper, key: string): number => {
  const hit = Object.entries(s.latest()).find(([k]) => k.toLowerCase() === `${key}(a1)`.toLowerCase());
  if (!hit) throw new Error(`no read-out ${key}`);
  return hit[1];
};

describe('the program used by these tests', () => {
  it('has the addresses and cycle counts the comments claim', () => {
    expect(addr('LOOP')).toBe(7);
    expect(addr('SUB')).toBe(0x11);
    const cpu = new Cpu8051();
    cpu.loadCode(built.bytes);
    const used: number[] = [];
    for (let k = 0; k < 6; k++) used.push(cpu.step());
    expect(used).toEqual([1, 1, 1, 1, 1, 2]);
  });
});

describe('breakpoint: the circuit stops at cycles × the machine-cycle period', () => {
  it('holds at the breakpoint with the circuit clock at exactly the executed cycles', () => {
    const s = session();
    s.setParam('A1', 'bpadd', addr('LOOP') + 3); // MUL AB at 000Ah
    runUntilHeld(s);
    expect(read(s, 'Mpc')).toBe(0x0a);
    expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.breakpoint);
    // 4 setup instructions (4 cycles) + the loop twice: (INC 1 + DJNZ 2) x 2 = 6 → 10 cycles
    expect(read(s, 'Mcyc')).toBe(10);
    expect(s.time).toBeCloseTo(10 * MCS, 12);
    // the registers are those after those instructions: A = 8, R0 = 8 + 2, R7 = 0
    expect(read(s, 'Ma')).toBe(8);
    expect(read(s, 'Mr0')).toBe(10);
    expect(read(s, 'Mr7')).toBe(0);
  });

  it('does not stop before the breakpoint and costs no time without one', () => {
    const s = session();
    s.advance(5e-5);
    expect(s.held).toBe(false);
    expect(s.time).toBeGreaterThanOrEqual(5e-5);
    // the program is parked in HERE: SJMP HERE
    expect(read(s, 'Mpc')).toBe(0x0f);
  });

  it('continues after the breakpoint and skips it once', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0a);
    runUntilHeld(s);
    s.setParam('A1', 'resume', 1);
    s.advance(s.time + 1e-4);
    expect(s.held).toBe(false);
    expect(read(s, 'Mpc')).toBe(0x0f);
  });

  it('stops again when the loop comes back to the breakpoint', () => {
    const s = session();
    s.setParam('A1', 'bpadd', addr('LOOP'));
    runUntilHeld(s);
    const first = read(s, 'Mcyc');
    expect(first).toBe(4);
    s.setParam('A1', 'resume', 1);
    runUntilHeld(s);
    // second visit after INC R0 (1) + DJNZ taken (2)
    expect(read(s, 'Mcyc')).toBe(first + 3);
    expect(s.time).toBeCloseTo((first + 3) * MCS, 12);
    s.setParam('A1', 'resume', 1);
    s.advance(s.time + 1e-4);
    expect(s.held).toBe(false);
  });

  it('removing the breakpoint lets the program run through', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0a);
    s.setParam('A1', 'bpdel', 0x0a);
    s.advance(1e-4);
    expect(s.held).toBe(false);
    expect(read(s, 'Mpc')).toBe(0x0f);
    const t = createTransientStepper(netlist([], [], {}), { tstep: 1e-6 });
    expect(t.held).toBe(false);
  });

  it('a reset releases the hold and the program starts again from address 0', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0a);
    runUntilHeld(s);
    const t0 = s.time;
    s.setParam('A1', 'reset', 1);
    s.advance(t0 + 2e-6);
    expect(s.held).toBe(false);
    expect(read(s, 'Mdbg')).toBe(0);
    expect(read(s, 'Mpc')).toBeLessThan(0x0a);
    // the breakpoint is still there: the restarted program stops at it again, 10 cycles after the reset
    runUntilHeld(s);
    expect(read(s, 'Mpc')).toBe(0x0a);
    expect(s.time - t0).toBeGreaterThanOrEqual(10 * MCS - 1e-12);
    expect(read(s, 'Mcyc')).toBe(10);
  });
});

describe('single step: the circuit advances by exactly the instruction time', () => {
  it('steps MUL AB (4 cycles) and the clock moves by 4 µs', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0a);
    runUntilHeld(s);
    const t0 = s.time;
    const c0 = read(s, 'Mcyc');
    expect(read(s, 'Minsn')).toBe(4);
    s.setParam('A1', 'step', 1);
    runUntilHeld(s);
    expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.step);
    expect(read(s, 'Mpc')).toBe(0x0b);
    expect(read(s, 'Mcyc')).toBe(c0 + 4);
    expect(s.time - t0).toBeCloseTo(4 * MCS, 12);
    // MUL AB: A = 8, B = 0 → 0
    expect(read(s, 'Ma')).toBe(0);
  });

  it('steps one instruction at a time through the whole loop with the right times', () => {
    const s = session();
    s.setParam('A1', 'step', 1);
    const cycles = [1, 1, 1, 1, 1, 2, 1, 2, 4];
    let sum = 0;
    for (const n of cycles) {
      runUntilHeld(s);
      sum += n;
      expect(read(s, 'Mcyc')).toBe(sum);
      expect(s.time).toBeCloseTo(sum * MCS, 12);
      s.setParam('A1', 'step', 1);
    }
    expect(read(s, 'Mpc')).toBe(0x0b);
  });

  it('a step advances the clock even when the output step is much longer than the instruction', () => {
    const s = session();
    s.setParam('A1', 'step', 1);
    runUntilHeld(s);
    // tstep is 5 µs, the instruction 1 µs
    expect(s.time).toBeCloseTo(1 * MCS, 12);
  });

  it('steps cycle by cycle: a 4-cycle MUL AB shows cycles 1 to 3 and completes on the 4th', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0a);
    runUntilHeld(s);
    const t0 = s.time;
    const c0 = read(s, 'Mcyc');
    for (let k = 1; k <= 3; k++) {
      s.setParam('A1', 'stepcycle', 1);
      runUntilHeld(s);
      expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.cycle);
      expect(read(s, 'Mmid')).toBe(k);
      expect(read(s, 'Mpc')).toBe(0x0a);
      expect(read(s, 'Mcyc')).toBe(c0);
      expect(s.time - t0).toBeCloseTo(k * MCS, 12);
    }
    s.setParam('A1', 'stepcycle', 1);
    runUntilHeld(s);
    expect(read(s, 'Mmid')).toBe(0);
    expect(read(s, 'Mpc')).toBe(0x0b);
    expect(read(s, 'Mcyc')).toBe(c0 + 4);
    expect(s.time - t0).toBeCloseTo(4 * MCS, 12);
  });

  it('an instruction step from the middle of an instruction finishes it', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0a);
    runUntilHeld(s);
    const t0 = s.time;
    s.setParam('A1', 'stepcycle', 1);
    runUntilHeld(s);
    s.setParam('A1', 'step', 1);
    runUntilHeld(s);
    expect(read(s, 'Mpc')).toBe(0x0b);
    expect(s.time - t0).toBeCloseTo(4 * MCS, 12);
  });

  it('step over a call runs the subroutine and stops after it returns', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0b); // ACALL SUB
    runUntilHeld(s);
    const c0 = read(s, 'Mcyc');
    s.setParam('A1', 'stepover', 1);
    runUntilHeld(s);
    expect(read(s, 'Mpc')).toBe(0x0d);
    // ACALL 2 + INC 1 + INC 1 + RET 2
    expect(read(s, 'Mcyc')).toBe(c0 + 6);
    expect(s.time).toBeCloseTo((c0 + 6) * MCS, 12);
    expect(read(s, 'Mr1')).toBe(2);
  });

  it('step into a call lands on the first instruction of the subroutine', () => {
    const s = session();
    s.setParam('A1', 'bpadd', 0x0b);
    runUntilHeld(s);
    s.setParam('A1', 'step', 1);
    runUntilHeld(s);
    expect(read(s, 'Mpc')).toBe(0x11);
  });
});

describe('start debugging', () => {
  it('holds the run before the first instruction, at time zero, and steps from there', () => {
    const s = session({ dbgstart: 1 });
    runUntilHeld(s);
    expect(s.time).toBe(0);
    expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.start);
    expect(read(s, 'Mpc')).toBe(0);
    expect(read(s, 'Mcyc')).toBe(0);
    s.setParam('A1', 'step', 1);
    runUntilHeld(s);
    expect(read(s, 'Mpc')).toBe(2);
    expect(s.time).toBeCloseTo(1 * MCS, 12);
    // a manual break holds a running program too
    s.setParam('A1', 'resume', 1);
    s.advance(s.time + 2e-6);
    s.setParam('A1', 'break', 1);
    runUntilHeld(s);
    expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.start);
  });
});

describe('run to cursor and the pins', () => {
  it('runs to an address, stops there, and the pin driven before it has changed', () => {
    const s = session();
    s.setParam('A1', 'runto', 0x0f);
    runUntilHeld(s);
    expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.runTo);
    expect(read(s, 'Mpc')).toBe(0x0f);
    // SETB P1.0 has executed: the port latch is high
    expect(read(s, 'Mp1') & 1).toBe(1);
    const cyc = read(s, 'Mcyc');
    expect(s.time).toBeCloseTo(cyc * MCS, 12);
    // resume: the run-to target is gone, the program parks in SJMP
    s.setParam('A1', 'resume', 1);
    s.advance(s.time + 1e-4);
    expect(s.held).toBe(false);
  });

  it('the LED node follows once the simulation continues after the SETB', () => {
    const s = session();
    s.setParam('A1', 'runto', 0x0f);
    runUntilHeld(s);
    s.setParam('A1', 'resume', 1);
    s.advance(s.time + 5e-5);
    expect(s.latest()['V(led)']).toBeGreaterThan(4);
  });
});

describe('watches', () => {
  it('shows watched memory, SFR and bit values and stops when one changes', () => {
    const s = session();
    s.setParam('A1', 'watch0', encodeWatch(WATCH_SPACE.direct, 0)); // R0 of bank 0 = iram[0]
    s.setParam('A1', 'watch1', encodeWatch(WATCH_SPACE.direct, 0xe0)); // ACC
    s.setParam('A1', 'wbreak', 1); // stop when slot 0 changes
    runUntilHeld(s);
    expect(read(s, 'Mdbg')).toBe(DEBUG_REASON.watch);
    // MOV R0,A (the 3rd instruction) is the first to change iram[0]
    expect(read(s, 'Mw0')).toBe(8);
    expect(read(s, 'Mw1')).toBe(8);
    expect(read(s, 'Mcyc')).toBe(3);
    expect(s.time).toBeCloseTo(3 * MCS, 12);
    s.setParam('A1', 'resume', 1);
    runUntilHeld(s);
    expect(read(s, 'Mw0')).toBe(9);
  });

  it('a slot that is switched off reads -1', () => {
    const s = session();
    s.setParam('A1', 'watch2', encodeWatch(WATCH_SPACE.indirect, 0x30));
    s.setParam('A1', 'watch2', -1);
    s.advance(1e-5);
    expect(read(s, 'Mw2')).toBe(-1);
  });

  it('refuses an unknown run-time parameter', () => {
    const s = session();
    expect(() => s.setParam('A1', 'frobnicate', 1)).toThrow(/cannot be changed at run time/);
  });
});

describe('CoreDebugger on its own', () => {
  function core(): { cpu: Cpu8051; dbg: CoreDebugger } {
    const cpu = new Cpu8051();
    cpu.loadCode(built.bytes);
    return { cpu, dbg: new CoreDebugger(cpu, machineCycleSeconds(12e6)) };
  }
  const hooks = { before: () => undefined, after: () => undefined };

  it('is inactive until something is set', () => {
    const { dbg } = core();
    expect(dbg.active).toBe(false);
    dbg.addBreakpoint(0x0a);
    expect(dbg.active).toBe(true);
    dbg.clearBreakpoints();
    expect(dbg.active).toBe(false);
  });

  it('stops before the breakpoint instruction with the cycles of everything before it', () => {
    const { cpu, dbg } = core();
    dbg.addBreakpoint(0x0a);
    dbg.advance(1000, hooks);
    expect(dbg.held).toBe(true);
    expect(dbg.reason).toBe(DEBUG_REASON.breakpoint);
    expect(cpu.pc).toBe(0x0a);
    expect(cpu.cycles).toBe(10);
  });

  it('does not run the core while the circuit has not reached the step goal', () => {
    const { cpu, dbg } = core();
    dbg.stepInstruction();
    expect(dbg.goalTime()).toBeCloseTo(1e-6, 15);
    dbg.advance(0, hooks);
    expect(cpu.cycles).toBe(0);
    expect(dbg.held).toBe(false);
    dbg.advance(1, hooks);
    expect(cpu.cycles).toBe(1);
    expect(dbg.held).toBe(true);
    expect(dbg.goalTime()).toBeUndefined();
  });

  it('measures the length of the next instruction without executing it', () => {
    const { cpu, dbg } = core();
    cpu.pc = 0x0a;
    expect(dbg.nextInstructionCycles()).toBe(4);
    expect(cpu.pc).toBe(0x0a);
    expect(cpu.cycles).toBe(0);
  });

  it('encodes and decodes watch targets', () => {
    const { dbg } = core();
    dbg.setWatch(0, encodeWatch(WATCH_SPACE.code, 0x0a));
    expect(dbg.readWatch(0)).toBe(0xa4); // the opcode of MUL AB
    dbg.setWatch(1, encodeWatch(WATCH_SPACE.pin, 3));
    expect(dbg.readWatch(1)).toBe(1);
    dbg.setWatch(1, -5);
    expect(dbg.readWatch(1)).toBe(-1);
    expect(dbg.readWatch(7)).toBe(-1);
  });
});
