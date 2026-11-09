/**
 * Microcontroller co-simulation: the `D_MCU8051` code model puts the 8051-compatible core of
 * src/mcu around the electrical shell of core.ts, so a program running on the MCU drives and reads
 * ordinary circuit nodes during a transient or an interactive run.
 *
 * Element layout
 *   A<name> p0.0 … p0.7 p1.0 … p1.7 p2.0 … p2.7 p3.0 … p3.7 rst ea [vsup] ref MS_MCU8051_<hash>
 *   - the 32 port pins are inputs AND outputs: each is driven low through `rlow` when its latch is
 *     0 and released when the latch is 1, so with the model's internal pull-up (`pullup`, default
 *     50 kΩ on P1..P3; P0 has none and needs an external one) the pins behave like the
 *     quasi-bidirectional ports of the real part. `pdrive` = 1 makes them push-pull instead, which
 *     is easier for a first experiment.
 *   - `rst` is active HIGH: while it is high the core is held in reset. An unconnected pin (XSPICE
 *     NULL) reads 0, so a schematic without a reset circuit simply runs.
 *   - `ea` is active LOW (external code memory). Unconnected means "internal code"; pulling it low
 *     stops the core, because MachSim has no external program memory.
 *   - model literal `code` is the program image (`src/mcu/program.ts` `encodeImage`).
 *   - numeric params: `fosc` (Hz, crystal), `xram` (bytes of external data memory for MOVX),
 *     `pdrive`, `pullup`, `ahead` (machine cycles the core may run ahead, see below), `debug`.
 *
 * How the two time bases meet
 *   The core counts MACHINE CYCLES; the shell gives it accepted timepoints. At every evaluation the
 *   behaviour runs the core forward to the current timepoint, feeding each pin the value it has at
 *   the machine cycle being executed (input crossings inside the step are placed at their
 *   interpolated crossing time), and schedules the resulting pin changes at the exact machine cycle
 *   they happened (`io.setTime`).
 *
 *   The shell can schedule only ONE change per pin per timepoint, so the behaviour must make sure a
 *   timepoint falls on every pin change: after committing, it SNAPSHOTS the core
 *   ({@link Cpu8051.saveState}), runs ahead with the inputs held until a pin changes or the `ahead`
 *   budget runs out, rolls back, and asks for a wake-up at that time (`io.wake`). The engine turns
 *   that into a breakpoint, so the next accepted timepoint is exactly where the program changes a
 *   pin. The look-ahead is only redone when an input changed or the predicted time has been
 *   reached, so a quiet program costs one extra run per predicted event.
 *
 * Operating point
 *   The core does not execute in DC: the operating point (and the one in front of a transient) sees
 *   the reset state of the ports (all latches high). `init` resets the core, so every analysis
 *   starts the program from address 0.
 *
 * Read-outs
 *   With `debug` = 1 the behaviour publishes the registers, the SFRs, a 16-byte window of internal
 *   RAM and the serial read-outs as derived device outputs named `Mpc(A1)`, `Ma(A1)`, `Mp1(A1)` …
 *   (the keys are `MCU_PROBE_KEYS` in src/mcu/probes.ts); `src/ui/mcu` reads them from the live
 *   vector snapshot. The
 *   run-time parameters `rx` (inject a byte into the serial receiver), `ramview` (base of the RAM
 *   window) and `reset` are settable while an interactive simulation runs.
 *
 * Debugging while the circuit runs (src/mcu/debugger.ts)
 *   More run-time parameters drive a debugger: `bpadd` / `bpdel` (code address), `bpclear`,
 *   `resume`, `step`, `stepcycle`, `stepover`, `runto` (address), `watch0` … `watch7` (see
 *   `encodeWatch`) and `wbreak` (bit mask of watch slots that stop the run when they change). When
 *   the program reaches a breakpoint or a step command completes, the device asks the stepper to
 *   hold the simulation (`holdRequested`) and the session pauses at EXACTLY the time the core has
 *   executed — cycles × the machine-cycle period — because the look-ahead (below) and the step
 *   goal both place a timepoint there. The read-outs `Mdbg` (why it stopped), `Mmid` (cycles into
 *   the instruction in progress), `Minsn` (cycles of the next instruction) and `Mw0` … `Mw7` (the
 *   watched values) are published next to the registers.
 */
import { Cpu8051, SFR, machineCycleSeconds, type CpuState } from '../../../mcu/cpu8051';
import { CoreDebugger, WATCH_SLOTS } from '../../../mcu/debugger';
import { decodeImage } from '../../../mcu/program';
import { MCU_PROBE_KEYS, RAM_WINDOW } from '../../../mcu/probes';
import { netlistError, range, type BehaviourFactory, type EvalIO } from './behaviour';

/** Port pins, then RST and EA. */
const N_PINS = 32;
const RST = 32;
const EA = 33;
const N_PORTS = 34;

/** One pending input change inside the current step. */
interface PinChange {
  pin: number;
  time: number;
  value: number;
}

const mcu8051: BehaviourFactory = (ctx) => {
  if (ctx.ports !== N_PORTS) throw netlistError(ctx.name, `expected ${N_PORTS} port nodes (P0.0..P3.7, RST, EA), got ${ctx.ports}`);
  const p = ctx.p;
  const fosc = p.positive('fosc', 12e6);
  const mcs = machineCycleSeconds(fosc);
  const xramSize = Math.max(0, Math.min(0x10000, p.int('xram', 0)));
  const pushPull = p.flag('pdrive');
  const pullup = p.positive('pullup', 50e3);
  const ahead = Math.max(1, p.int('ahead', 20000));
  const debug = p.flag('debug', true);
  /** "Start debugging": the run is held before the first instruction (set by the code editor, never saved) */
  const dbgStart = p.flag('dbgstart', false);
  const image = decodeImage(p.text('code') ?? '');

  const cpu = new Cpu8051({ xramSize });
  cpu.loadCode(image.bytes, image.at);
  const dbg = new CoreDebugger(cpu, mcs);
  /** pin drive word of the last committed state (four bytes packed high port first) */
  let lastWord = -1;
  /** time of the newest pin change the core made */
  let lastChange = 0;
  /** time the look-ahead asked to be woken at (-1 = none) */
  let wakeAt = -1;
  /**
   * Circuit time at which the core's cycle counter was zero. 0 for a normal run; a program restart
   * in the middle of a run (the `reset` parameter) moves it to the restart time, so the cycle
   * counter and the circuit clock keep agreeing: time = timeBase + cycles × machine-cycle period.
   */
  let timeBase = 0;
  /** time of the newest evaluation (where a parameter change finds the circuit) */
  let lastNow = 0;
  /** the engine must place a timepoint at this time (a debugger event the look-ahead predicted after a command); -1 = none */
  let predicted = -1;
  /** a manual break was requested: hold at the next timepoint */
  let breakPending = false;
  const timeOf = (cycles: number): number => timeBase + cycles * mcs;
  /** base address of the RAM window the panel shows */
  let ramBase = 0x30;
  /** the four newest transmitted bytes, newest first */
  const txRing = [0, 0, 0, 0];
  const pending: PinChange[] = [];
  const probe: Record<string, number> = {};
  for (const k of MCU_PROBE_KEYS) probe[k] = 0;

  const portWord = (): number => ((cpu.portDrive(0) * 256 + cpu.portDrive(1)) * 256 + cpu.portDrive(2)) * 256 + cpu.portDrive(3);

  const writeOutputs = (io: EvalIO): void => {
    for (let k = 0; k < N_PINS; k++) io.out[k] = cpu.pinOut(k);
  };

  const drainTx = (): void => {
    for (const b of cpu.takeTransmitted()) {
      txRing.pop();
      txRing.unshift(b & 0xff);
    }
  };

  const applyPending = (): void => {
    const t = timeOf(cpu.cycles);
    while (pending.length > 0 && pending[0].time <= t) {
      const c = pending.shift()!;
      cpu.pinIn[c.pin] = c.value;
    }
  };
  const trackPins = (): void => {
    const w = portWord();
    if (w !== lastWord) {
      lastWord = w;
      lastChange = timeOf(cpu.cycles);
    }
  };
  const hooks = { before: applyPending, after: trackPins };

  /** Run the core to `target` machine cycles, applying the pending input changes on the way. */
  const runTo = (target: number): void => {
    if (dbg.active) {
      dbg.advance(target, hooks);
      for (const c of pending.splice(0)) cpu.pinIn[c.pin] = c.value;
      return;
    }
    let guard = 0;
    while (cpu.cycles < target && cpu.halted === 'none') {
      applyPending();
      cpu.step();
      trackPins();
      if (++guard > 4_000_000) break; // never spend more than this in one step
    }
    for (const c of pending.splice(0)) cpu.pinIn[c.pin] = c.value;
  };

  /**
   * Snapshot, run ahead with the inputs held until a pin changes (or the budget runs out), roll
   * back, and return the time to be woken at.
   */
  const lookAhead = (): number => {
    const snap: CpuState = cpu.saveState();
    const limit = cpu.cycles + ahead;
    const word = lastWord;
    let found = -1;
    let first = true;
    while (cpu.cycles < limit && cpu.halted === 'none') {
      // the debugger stops the program BEFORE a breakpoint: that is also an event the engine needs a timepoint for
      if (dbg.active && dbg.stopsAt(cpu.pc, cpu.sp, first)) {
        found = timeOf(cpu.cycles);
        break;
      }
      first = false;
      cpu.step();
      if (portWord() !== word || dbg.watchChangeAhead()) {
        found = timeOf(cpu.cycles);
        break;
      }
    }
    const reached = timeOf(cpu.cycles);
    cpu.restoreState(snap);
    return found >= 0 ? found : reached;
  };

  const fillProbe = (): void => {
    probe.Mpc = cpu.pc;
    probe.Ma = cpu.acc;
    probe.Mb = cpu.sfr[SFR.B - 0x80];
    probe.Msp = cpu.sp;
    probe.Mpsw = cpu.psw;
    probe.Mdptr = cpu.dptr;
    for (let k = 0; k < 8; k++) probe[`Mr${k}`] = cpu.reg(k);
    for (let k = 0; k < 4; k++) probe[`Mp${k}`] = cpu.portDrive(k);
    probe.Mtmod = cpu.sfr[SFR.TMOD - 0x80];
    probe.Mtcon = cpu.sfr[SFR.TCON - 0x80];
    probe.Mtl0 = cpu.sfr[SFR.TL0 - 0x80];
    probe.Mth0 = cpu.sfr[SFR.TH0 - 0x80];
    probe.Mtl1 = cpu.sfr[SFR.TL1 - 0x80];
    probe.Mth1 = cpu.sfr[SFR.TH1 - 0x80];
    probe.Mie = cpu.sfr[SFR.IE - 0x80];
    probe.Mip = cpu.sfr[SFR.IP - 0x80];
    probe.Mscon = cpu.sfr[SFR.SCON - 0x80];
    probe.Msbuf = cpu.readDirect(SFR.SBUF);
    probe.Mpcon = cpu.sfr[SFR.PCON - 0x80];
    probe.Mcyc = cpu.cycles;
    probe.Mtxn = cpu.txCount;
    for (let k = 0; k < 4; k++) probe[`Mtx${k}`] = txRing[k];
    probe.Mrxn = cpu.rxCount;
    probe.Mrxq = cpu.rxPending;
    probe.Mhalt = cpu.halted === 'none' ? 0 : cpu.halted === 'opcode' ? 1 : 2;
    probe.Mbase = ramBase;
    for (let k = 0; k < RAM_WINDOW; k++) probe[`Mm${k}`] = cpu.iram[(ramBase + k) & 0xff];
    probe.Mdbg = dbg.held ? dbg.reason : 0;
    probe.Mmid = dbg.cyclesIntoInstruction;
    probe.Minsn = dbg.held && cpu.halted === 'none' ? dbg.instructionCycles : 0;
    probe.Mbpn = dbg.breakpoints.size;
    for (let k = 0; k < WATCH_SLOTS; k++) probe[`Mw${k}`] = dbg.readWatch(k);
  };

  /**
   * After a debugger command: predict again (on a snapshot) where the program next changes a pin,
   * reaches a breakpoint or changes a watched value, and have the engine place a timepoint there.
   * The next evaluation would be too late, because the step after the command is already planned.
   */
  const repredict = (): void => {
    predicted = -1;
    wakeAt = -1;
    if (!dbg.active || dbg.held || dbg.goalTime() !== undefined || cpu.halted !== 'none') return;
    const t = lookAhead();
    if (t > lastNow) {
      predicted = t;
      wakeAt = t;
    }
  };

  return {
    inputs: range(0, N_PORTS),
    outputs: range(0, N_PINS).map((port) => ({ port, openDrain: !pushPull, ...(pushPull || port < 8 ? {} : { pullup }) })),
    state: 0,
    // the core must keep up with simulated time at every accepted timepoint, so that the register
    // read-outs are live and a program that never touches a pin still runs
    alwaysEval: true,
    defaults: { roff: 1e9 },

    init() {
      cpu.reset();
      cpu.loadCode(image.bytes, image.at);
      dbg.reset();
      if (dbgStart) dbg.breakNow();
      lastWord = portWord();
      lastChange = 0;
      wakeAt = -1;
      predicted = -1;
      timeBase = 0;
      dbg.timeBase = 0;
      txRing.fill(0);
      pending.length = 0;
    },

    holdRequested: () => dbg.held,

    wakeTimes() {
      const out: number[] = [];
      const g = dbg.goalTime();
      if (g !== undefined) out.push(g);
      if (predicted > 0) out.push(predicted);
      return out;
    },

    eval(io) {
      lastNow = io.now;
      if (predicted > 0 && io.now >= predicted - 1e-15) predicted = -1;
      if (breakPending && !io.dc) {
        breakPending = false;
        dbg.breakNow();
      }
      // RST is active high; EA low means "fetch from external memory", which does not exist here
      const held = io.present[RST] === 1 && io.in[RST] === 1;
      const ea = io.present[EA] === 1 ? io.in[EA] : 1;
      cpu.resetHeld = held;
      if (io.dc) {
        if (held) cpu.reset();
        lastWord = portWord();
        writeOutputs(io);
        return;
      }
      // pins: everything keeps its previous value, the ones that crossed change at their crossing
      pending.length = 0;
      for (let k = 0; k < N_PINS; k++) {
        // an unconnected pin reads high, like a port pin with only its own pull-up on it
        cpu.pinIn[k] = io.present[k] === 1 ? io.prev[k] : 1;
        if (io.present[k] === 1 && io.in[k] !== io.prev[k]) {
          const tc = io.cross[k];
          pending.push({ pin: k, time: Number.isFinite(tc) ? tc : io.now, value: io.in[k] });
        }
      }
      pending.sort((a, b) => a.time - b.time);
      const inputsChanged = pending.length > 0;
      const target = Math.floor((io.now - timeBase) / mcs + 1e-6);
      if (ea === 1 && !held) runTo(target);
      else {
        if (held) dbg.reset();
        for (const c of pending.splice(0)) cpu.pinIn[c.pin] = c.value;
        if (held) {
          cpu.reset();
          lastWord = portWord();
          lastChange = io.now;
        }
      }
      drainTx();
      if (lastChange > io.prevTime && lastChange <= io.now) io.setTime(lastChange);
      writeOutputs(io);
      // a debugger step in progress completes at an exact time: the engine needs a timepoint there
      const goal = dbg.goalTime();
      if (goal !== undefined && goal > io.now) io.wake(goal);
      // ask to be woken when the program next changes a pin (or reaches a breakpoint)
      if (ea === 1 && !held && !dbg.held && goal === undefined && cpu.halted === 'none' && (inputsChanged || wakeAt < 0 || io.now >= wakeAt)) {
        const t = lookAhead();
        if (t > io.now) {
          wakeAt = t;
          io.wake(t);
        } else wakeAt = -1;
      }
    },

    // filled on demand: the engine reads it once per recorded sample, not per timepoint
    probes: debug
      ? () => {
          fillProbe();
          return probe;
        }
      : undefined,

    setParam(key, value) {
      if (key === 'rx') {
        cpu.receiveByte(Math.round(value));
        return true;
      }
      if (key === 'ramview') {
        ramBase = Math.max(0, Math.min(0xff, Math.round(value))) & 0xf0;
        return true;
      }
      if (key === 'reset') {
        if (value !== 0) {
          cpu.reset();
          cpu.loadCode(image.bytes, image.at);
          dbg.reset();
          lastWord = portWord();
          timeBase = lastNow;
          dbg.timeBase = timeBase;
          repredict();
        }
        return true;
      }
      // ---- debugger commands (src/mcu/debugger.ts)
      const rounded = Math.round(value);
      switch (key) {
        case 'bpadd':
          dbg.addBreakpoint(rounded);
          break;
        case 'bpdel':
          dbg.removeBreakpoint(rounded);
          break;
        case 'bpclear':
          dbg.clearBreakpoints();
          break;
        case 'resume':
          dbg.resume();
          break;
        case 'break':
          // taken at the next timepoint, so the hold and its reason are recorded with a sample
          breakPending = true;
          return true;
        case 'step':
          dbg.stepInstruction();
          break;
        case 'stepcycle':
          dbg.stepCycle();
          break;
        case 'stepover':
          dbg.stepOver();
          break;
        case 'runto':
          dbg.runTo(rounded);
          break;
        case 'wbreak':
          dbg.watchBreak = rounded & 0xff;
          break;
        default: {
          const slot = /^watch([0-7])$/.exec(key);
          if (!slot) return false;
          dbg.setWatch(Number(slot[1]), value);
        }
      }
      repredict();
      return true;
    },

    getParam(key) {
      if (key === 'ramview') return ramBase;
      if (key === 'pc') return cpu.pc;
      if (key === 'cycles') return cpu.cycles;
      if (key === 'held') return dbg.held ? 1 : 0;
      if (key === 'reason') return dbg.held ? dbg.reason : 0;
      return undefined;
    },
  };
};

export const MCU_BEHAVIOURS: Record<string, BehaviourFactory> = { D_MCU8051: mcu8051 };
