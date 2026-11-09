/**
 * Debugger of the 8051 core while it drives a circuit (pure, no engine, no DOM).
 *
 * The co-simulated core (src/sim/devices/digital/mcu.ts) runs inside the transient engine: every
 * accepted timepoint it executes the instructions that fit in the simulated time. `CoreDebugger`
 * adds the controls of a debugger on top, with ONE rule that makes it useful for learning:
 *
 *     the circuit stops at exactly the time the core has executed — cycles × machine-cycle period.
 *
 * so when the program is stopped at a breakpoint after 7 machine cycles at 12 MHz, the circuit
 * clock reads exactly 7 µs and every LED, capacitor and port pin shows what the real circuit would
 * show at that moment.
 *
 * Commands (all set by `Behaviour.setParam` while the simulation is paused or running):
 *   addBreakpoint / removeBreakpoint / clearBreakpoints    code addresses to stop BEFORE executing
 *   resume()               continue; the breakpoint at the current address is skipped once
 *   stepInstruction()      execute exactly one instruction; the circuit advances by its cycles
 *   stepCycle()            advance the circuit by ONE machine cycle (an instruction of n cycles is
 *                          shown as cycle 1/n … n/n and takes effect on its last cycle)
 *   stepOver()             like stepInstruction, but a call (ACALL/LCALL) runs until it returns
 *   runTo(address)         continue until the core is about to execute that address
 *   watch slots            up to 8 watched memory cells / bits / port pins (`Mw0` … `Mw7` read-outs)
 *                          and an optional "stop when it changes" mask
 *
 * Engine side (what the device needs):
 *   held                   true while the debugger wants the simulation paused (the stepper stops
 *                          after the timepoint that set it and the session pauses)
 *   advance(target, hook)  run the core to `target` machine cycles under the debugger's rules
 *   goalTime()             the time at which the current step command completes, so the engine can
 *                          place a timepoint exactly there; undefined when nothing is pending
 *   stopsAt(pc)            would the core stop before executing `pc` (used by the look-ahead)
 *
 * Nothing here costs anything while no breakpoint is set and no command is pending: `active` is
 * false and the device keeps its fast loop.
 */
import { Cpu8051, LENGTHS } from './cpu8051';

/** Why the debugger holds the simulation (read-out `Mdbg`). */
export const DEBUG_REASON = {
  none: 0,
  breakpoint: 1,
  step: 2,
  cycle: 3,
  runTo: 4,
  watch: 5,
  /** held by a "start debugging" request: the program has not run yet (or a manual break) */
  start: 6,
} as const;

export type DebugReason = (typeof DEBUG_REASON)[keyof typeof DEBUG_REASON];

/** Number of watch slots. */
export const WATCH_SLOTS = 8;

/** Address spaces a watch slot can look at. Code = space * 0x10000 + address. */
export const WATCH_SPACE = {
  /** direct address 0x00..0xFF (internal RAM below 0x80, SFRs above) */
  direct: 0,
  /** indirect internal RAM 0x00..0xFF */
  indirect: 1,
  /** external data memory (MOVX) */
  xram: 2,
  /** program memory */
  code: 3,
  /** bit address 0x00..0xFF (bit-addressable RAM and SFR bits) */
  bit: 4,
  /** external pin level P0.0 (0) … P3.7 (31) */
  pin: 5,
} as const;

export type WatchSpace = (typeof WATCH_SPACE)[keyof typeof WATCH_SPACE];

/** Encode a watch target for the `watch0` … `watch7` run-time parameters (-1 switches the slot off). */
export function encodeWatch(space: WatchSpace, address: number): number {
  return space * 0x10000 + (address & 0xffff);
}

/** The pieces of an encoded watch target, or null for -1 / garbage. */
export function decodeWatch(code: number): { space: WatchSpace; address: number } | null {
  if (!Number.isFinite(code) || code < 0) return null;
  const space = Math.floor(code / 0x10000);
  if (space < 0 || space > 5) return null;
  return { space: space as WatchSpace, address: Math.round(code) & 0xffff };
}

type Mode = 'run' | 'step' | 'cycle';

/** What the device does around every instruction the debugger lets the core execute. */
export interface StepHooks {
  /** just before the instruction: apply the input changes that happened by now */
  before(): void;
  /** just after it: note pin changes */
  after(): void;
}

/** Is the instruction at `pc` an ACALL / LCALL, and how many bytes does it take. */
function callLength(cpu: Cpu8051, pc: number): number {
  const op = cpu.code[pc & 0xffff];
  if (op === 0x12 || (op & 0x1f) === 0x11) return LENGTHS[op];
  return 0;
}

export class CoreDebugger {
  readonly breakpoints = new Set<number>();
  /** the simulation is held (the device reports it to the stepper) */
  held = false;
  reason: DebugReason = DEBUG_REASON.none;
  /** watch targets, -1 = off */
  readonly watch: number[] = new Array<number>(WATCH_SLOTS).fill(-1);
  /** bit k = stop when watch slot k changes */
  watchBreak = 0;
  /** circuit time (s) at which the core's cycle counter was zero: a restart in the middle of a run moves it */
  timeBase = 0;

  private mode: Mode = 'run';
  /** a step command is waiting for the circuit to reach `goal` */
  private pendingGoal = false;
  /** absolute machine cycle at which the current step command completes */
  private goal = 0;
  /** cycles at the start of the instruction in progress / its length (valid while `mid`) */
  private c0 = 0;
  private insnCycles = 0;
  /** machine cycles of the instruction in progress that the circuit has already run (0 = at an instruction boundary) */
  private elapsed = 0;
  private runToPc = -1;
  /** stop at runToPc only when the stack pointer is back at this value (step over a call), -1 = ignore */
  private runToSp = -1;
  /** do not stop at a breakpoint at this address once (we are resuming from it) */
  private skipPc = -1;
  private lastWatch: number[] = new Array<number>(WATCH_SLOTS).fill(0);

  constructor(
    private readonly cpu: Cpu8051,
    /** seconds per machine cycle */
    readonly mcs: number,
  ) {}

  /** True while the debugger has anything to do (a breakpoint, a command, a hold, a watch stop). */
  get active(): boolean {
    return this.breakpoints.size > 0 || this.held || this.pendingGoal || this.runToPc >= 0 || this.watchBreak !== 0;
  }

  // ---- state read-outs -------------------------------------------------------------------

  /** Machine cycles the circuit has run of the instruction in progress (0 at a boundary). */
  get cyclesIntoInstruction(): number {
    return this.elapsed;
  }

  /** Machine cycles the next instruction (or interrupt entry) takes, measured on a snapshot of the core. */
  nextInstructionCycles(): number {
    const snap = this.cpu.saveState();
    const n = this.cpu.step();
    this.cpu.restoreState(snap);
    return n;
  }

  /** Length in cycles of the instruction in progress (the next one at a boundary). */
  get instructionCycles(): number {
    return this.elapsed > 0 ? this.insnCycles : this.nextInstructionCycles();
  }

  // ---- commands --------------------------------------------------------------------------

  addBreakpoint(address: number): void {
    this.breakpoints.add(address & 0xffff);
  }

  removeBreakpoint(address: number): void {
    this.breakpoints.delete(address & 0xffff);
  }

  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  /** Continue running (the breakpoint at the present address does not stop the core again at once). */
  resume(): void {
    this.mode = 'run';
    this.release();
    this.elapsed = 0;
    this.runToPc = -1;
  }

  /** Continue until the core is about to execute `address`. */
  runTo(address: number): void {
    this.mode = 'run';
    this.release();
    this.elapsed = 0;
    this.runToPc = address & 0xffff;
    this.runToSp = -1;
  }

  /** Execute one instruction: the circuit advances by exactly the cycles it takes. */
  stepInstruction(): void {
    this.beginStep('step', this.elapsed > 0 ? this.c0 + this.insnCycles : this.cpu.cycles + this.nextInstructionCycles());
  }

  /** Advance the circuit by one machine cycle; the instruction takes effect on its last cycle. */
  stepCycle(): void {
    if (this.elapsed === 0) {
      this.c0 = this.cpu.cycles;
      this.insnCycles = this.nextInstructionCycles();
    }
    this.beginStep('cycle', this.c0 + this.elapsed + 1);
  }

  /** Like {@link stepInstruction}, but a subroutine call runs until it returns. */
  stepOver(): void {
    const len = this.elapsed === 0 ? callLength(this.cpu, this.cpu.pc) : 0;
    if (len === 0) {
      this.stepInstruction();
      return;
    }
    this.mode = 'run';
    this.release();
    this.elapsed = 0;
    this.runToPc = (this.cpu.pc + len) & 0xffff;
    this.runToSp = this.cpu.sp;
  }

  /** Watch slot `slot` looks at `code` (see {@link encodeWatch}; -1 = off). */
  setWatch(slot: number, code: number): void {
    if (slot < 0 || slot >= WATCH_SLOTS) return;
    this.watch[slot] = decodeWatch(code) ? Math.round(code) : -1;
    this.lastWatch[slot] = this.readWatch(slot);
  }

  /** Current value of a watch slot (-1 when off). */
  readWatch(slot: number): number {
    const target = decodeWatch(this.watch[slot] ?? -1);
    if (!target) return -1;
    const { space, address } = target;
    const cpu = this.cpu;
    switch (space) {
      case WATCH_SPACE.direct:
        return cpu.readDirect(address & 0xff);
      case WATCH_SPACE.indirect:
        return cpu.iram[address & 0xff];
      case WATCH_SPACE.xram:
        return address < cpu.xram.length ? cpu.xram[address] : 0;
      case WATCH_SPACE.code:
        return cpu.code[address & 0xffff];
      case WATCH_SPACE.bit:
        return cpu.readBit(address & 0xff);
      default:
        return cpu.pinIn[address & 31] & 1;
    }
  }

  /** Hold the simulation right now (start of a debugging session, a manual break). */
  breakNow(): void {
    this.hold(DEBUG_REASON.start);
  }

  /** Forget a hold and every pending command (the core was reset). */
  reset(): void {
    this.held = false;
    this.reason = DEBUG_REASON.none;
    this.pendingGoal = false;
    this.elapsed = 0;
    this.runToPc = -1;
    this.skipPc = -1;
    this.mode = 'run';
    for (let k = 0; k < WATCH_SLOTS; k++) this.lastWatch[k] = this.readWatch(k);
  }

  private release(): void {
    this.held = false;
    this.reason = DEBUG_REASON.none;
    this.pendingGoal = false;
    // the instruction about to run is the one we are standing at: a breakpoint on it does not stop us again
    this.skipPc = this.cpu.pc;
  }

  private beginStep(mode: 'step' | 'cycle', goal: number): void {
    this.mode = mode;
    this.release();
    this.runToPc = -1;
    this.goal = goal;
    this.pendingGoal = true;
    for (let k = 0; k < WATCH_SLOTS; k++) this.lastWatch[k] = this.readWatch(k);
  }

  // ---- engine side -----------------------------------------------------------------------

  /** Time (s) at which the pending step command completes; undefined when none is pending. */
  goalTime(): number | undefined {
    return this.pendingGoal && !this.held ? this.timeBase + this.goal * this.mcs : undefined;
  }

  /** Would the core stop before executing the instruction at `pc` (a breakpoint or the run-to address)? */
  stopsAt(pc: number, sp = this.cpu.sp, honourSkip = true): boolean {
    if (honourSkip && pc === this.skipPc) return false;
    if (this.breakpoints.has(pc)) return true;
    return pc === this.runToPc && (this.runToSp < 0 || sp === this.runToSp);
  }

  private hold(reason: DebugReason): void {
    this.held = true;
    this.reason = reason;
    this.pendingGoal = false;
    this.runToPc = -1;
    this.skipPc = -1;
  }

  /**
   * Would a watched cell that stops the run differ from the last committed value? Used by the
   * device's look-ahead on a snapshot of the core, so the circuit gets a timepoint at the moment
   * the watched value changes.
   */
  watchChangeAhead(): boolean {
    if (this.watchBreak === 0) return false;
    for (let k = 0; k < WATCH_SLOTS; k++) {
      if (this.watch[k] >= 0 && (this.watchBreak >> k) & 1 && this.readWatch(k) !== this.lastWatch[k]) return true;
    }
    return false;
  }

  /** Stop when a watched cell changed (call after every executed instruction). */
  private watchChanged(): boolean {
    let hit = false;
    for (let k = 0; k < WATCH_SLOTS; k++) {
      if (this.watch[k] < 0) continue;
      const v = this.readWatch(k);
      if (v !== this.lastWatch[k]) {
        this.lastWatch[k] = v;
        if ((this.watchBreak >> k) & 1) hit = true;
      }
    }
    return hit;
  }

  /**
   * Run the core up to `target` machine cycles under the debugger's rules. `hooks` run around
   * every executed instruction (the device applies input changes and tracks pin changes there).
   * Returns when the target is reached or the debugger holds the simulation.
   */
  advance(target: number, hooks: StepHooks): void {
    const cpu = this.cpu;
    if (this.held) return;
    if (this.pendingGoal) {
      this.advanceStep(target, hooks);
      return;
    }
    let guard = 0;
    while (cpu.halted === 'none') {
      // arrive: the core is about to execute a stop address and the circuit has reached that time
      if (cpu.cycles <= target && this.stopsAt(cpu.pc)) {
        this.hold(this.breakpoints.has(cpu.pc) ? DEBUG_REASON.breakpoint : DEBUG_REASON.runTo);
        return;
      }
      if (cpu.cycles >= target) return;
      // with a "stop when it changes" watch the instruction runs only once the circuit has reached
      // its END, so the run stops at exactly the time the watched value changed
      if (this.watchBreak !== 0 && cpu.cycles + this.nextInstructionCycles() > target) return;
      hooks.before();
      cpu.step();
      this.skipPc = -1;
      hooks.after();
      if (this.watchBreak !== 0 && this.watchChanged()) {
        this.hold(DEBUG_REASON.watch);
        return;
      }
      if (++guard > 4_000_000) return; // never spend more than this in one evaluation
    }
  }

  private advanceStep(target: number, hooks: StepHooks): void {
    const cpu = this.cpu;
    // wait until the circuit has run the cycles asked for
    if (target < this.goal) return;
    const end = this.c0 + this.insnCycles;
    if (this.mode === 'cycle' && this.goal < end) {
      // the instruction is not finished: the circuit ran one more of its cycles
      this.elapsed = this.goal - this.c0;
      this.hold(DEBUG_REASON.cycle);
      return;
    }
    if (cpu.halted === 'none') {
      hooks.before();
      cpu.step();
      hooks.after();
    }
    this.elapsed = 0;
    if (this.watchBreak !== 0) this.watchChanged();
    this.hold(this.mode === 'cycle' ? DEBUG_REASON.cycle : DEBUG_REASON.step);
  }
}
