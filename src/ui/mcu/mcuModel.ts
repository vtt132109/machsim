/**
 * State the MCU code editor shows, without any UI: one record of everything the panel displays,
 * built either from the live vector snapshot of the co-simulated core or from the panel's own
 * stand-alone core, plus the breakpoint bookkeeping and the serial-terminal decoder.
 *
 * Keeping this pure means the register views, the RAM window, the line ↔ address mapping and the
 * terminal are covered by ordinary tests (mcuModel.test.ts) instead of only by clicking.
 */
import { CYCLES, Cpu8051, SFR, machineCycleSeconds } from '../../mcu/cpu8051';
import { MCU_PROBE_KEYS, RAM_WINDOW, mcuProbeValue } from '../../mcu/probes';
import type { AsmResult } from '../../mcu/asm8051';
import { WATCH_SLOTS, WATCH_SPACE, type WatchSpace } from '../../mcu/debugger';
import type { WatchContext } from '../../mcu/watch';

/** Everything the panel shows about one microcontroller. */
export interface McuView {
  pc: number;
  a: number;
  b: number;
  sp: number;
  psw: number;
  dptr: number;
  /** R0..R7 of the active bank */
  regs: number[];
  /** the levels P0..P3 drive */
  ports: number[];
  /** SFR values by name (TMOD, TCON, TL0, TH0, TL1, TH1, IE, IP, SCON, SBUF, PCON) */
  sfr: Record<string, number>;
  /** machine cycles since reset */
  cycles: number;
  /** 0 = running, 1 = stopped on an undefined opcode, 2 = stack overflow */
  halted: number;
  /** base address of the RAM window */
  ramBase: number;
  /** RAM_WINDOW bytes from ramBase */
  ram: number[];
  txCount: number;
  /** the four newest transmitted bytes, newest first */
  txRing: number[];
  rxCount: number;
  rxPending: number;
  /** debugger read-outs of the core (all quiet for the stand-alone run) */
  dbg: DebugView;
}

/** What the debugger of the co-simulated core reports. */
export interface DebugView {
  /** why the run is held: 0 not held, 1 breakpoint, 2 step, 3 cycle step, 4 run to cursor, 5 watch (src/mcu/debugger.ts DEBUG_REASON) */
  reason: number;
  /** machine cycles of the instruction in progress that the circuit has already run (0 at a boundary) */
  mid: number;
  /** machine cycles of the instruction about to run (only published while held) */
  insn: number;
  /** breakpoints set in the core */
  breakpoints: number;
  /** values of the eight watch slots, -1 = slot off */
  watch: number[];
}

/** A quiet debugger read-out. */
export function emptyDebug(): DebugView {
  return { reason: 0, mid: 0, insn: 0, breakpoints: 0, watch: new Array<number>(WATCH_SLOTS).fill(-1) };
}

/** SFR names the panel lists, in display order. */
export const VIEW_SFRS: readonly string[] = ['TMOD', 'TCON', 'TL0', 'TH0', 'TL1', 'TH1', 'IE', 'IP', 'SCON', 'SBUF', 'PCON'];

const SFR_PROBE: Record<string, string> = {
  TMOD: 'Mtmod',
  TCON: 'Mtcon',
  TL0: 'Mtl0',
  TH0: 'Mth0',
  TL1: 'Mtl1',
  TH1: 'Mth1',
  IE: 'Mie',
  IP: 'Mip',
  SCON: 'Mscon',
  SBUF: 'Msbuf',
  PCON: 'Mpcon',
};

/** An empty view (nothing has run yet). */
export function emptyView(ramBase = 0x30): McuView {
  return {
    pc: 0,
    a: 0,
    b: 0,
    sp: 7,
    psw: 0,
    dptr: 0,
    regs: new Array<number>(8).fill(0),
    ports: [0xff, 0xff, 0xff, 0xff],
    sfr: Object.fromEntries(VIEW_SFRS.map((n) => [n, 0])),
    cycles: 0,
    halted: 0,
    ramBase,
    ram: new Array<number>(RAM_WINDOW).fill(0),
    txCount: 0,
    txRing: [0, 0, 0, 0],
    rxCount: 0,
    rxPending: 0,
    dbg: emptyDebug(),
  };
}

/**
 * View of the co-simulated core from a lower-cased vector snapshot (LiveState.latest). Returns
 * null when the read-out vectors are missing (the part's "Register read-outs" switch is off, or
 * nothing has been simulated yet).
 */
export function viewFromSnapshot(values: Map<string, number>, element: string): McuView | null
{
  const get = (key: string): number | undefined => mcuProbeValue(values, element, key);
  if (get('Mpc') === undefined) return null;
  const n = (key: string): number => Math.round(get(key) ?? 0);
  return {
    pc: n('Mpc'),
    a: n('Ma'),
    b: n('Mb'),
    sp: n('Msp'),
    psw: n('Mpsw'),
    dptr: n('Mdptr'),
    regs: Array.from({ length: 8 }, (_, k) => n(`Mr${k}`)),
    ports: Array.from({ length: 4 }, (_, k) => n(`Mp${k}`)),
    sfr: Object.fromEntries(VIEW_SFRS.map((name) => [name, n(SFR_PROBE[name])])),
    cycles: get('Mcyc') ?? 0,
    halted: n('Mhalt'),
    ramBase: n('Mbase'),
    ram: Array.from({ length: RAM_WINDOW }, (_, k) => n(`Mm${k}`)),
    txCount: n('Mtxn'),
    txRing: Array.from({ length: 4 }, (_, k) => n(`Mtx${k}`)),
    rxCount: n('Mrxn'),
    rxPending: n('Mrxq'),
    dbg: {
      reason: n('Mdbg'),
      mid: n('Mmid'),
      insn: n('Minsn'),
      breakpoints: n('Mbpn'),
      watch: Array.from({ length: WATCH_SLOTS }, (_, k) => (get(`Mw${k}`) === undefined ? -1 : Math.round(get(`Mw${k}`) ?? -1))),
    },
  };
}

/** View of the panel's own stand-alone core. */
export function viewFromCpu(cpu: Cpu8051, ramBase: number, txRing: readonly number[]): McuView {
  return {
    pc: cpu.pc,
    a: cpu.acc,
    b: cpu.sfr[SFR.B - 0x80],
    sp: cpu.sp,
    psw: cpu.psw,
    dptr: cpu.dptr,
    regs: Array.from({ length: 8 }, (_, k) => cpu.reg(k)),
    ports: Array.from({ length: 4 }, (_, k) => cpu.portDrive(k)),
    sfr: Object.fromEntries(
      VIEW_SFRS.map((name) => [name, name === 'SBUF' ? cpu.readDirect(SFR.SBUF) : cpu.sfr[(SFR as Record<string, number>)[name] - 0x80]]),
    ),
    cycles: cpu.cycles,
    halted: cpu.halted === 'none' ? 0 : cpu.halted === 'opcode' ? 1 : 2,
    ramBase,
    ram: Array.from({ length: RAM_WINDOW }, (_, k) => cpu.iram[(ramBase + k) & 0xff]),
    txCount: cpu.txCount,
    txRing: [txRing[0] ?? 0, txRing[1] ?? 0, txRing[2] ?? 0, txRing[3] ?? 0],
    rxCount: cpu.rxCount,
    rxPending: cpu.rxPending,
    dbg: emptyDebug(),
  };
}

/** Machine cycles of the instruction at `pc` in a program image (0 when the address is outside it). */
export function cyclesAt(bytes: ArrayLike<number>, pc: number): number {
  const op = bytes[pc & 0xffff];
  return op === undefined ? 0 : CYCLES[op];
}

/**
 * Where the Watch tab finds values (src/mcu/watch.ts): registers and SFR read-outs from the view,
 * memory cells from the hardware watch slots (live) or straight from the stand-alone core, and
 * the 16-byte RAM window as a fall-back for computed addresses.
 */
export function watchContext(view: McuView, cells: { space: WatchSpace; address: number }[], cpu?: Cpu8051): WatchContext {
  const reg = (name: string): number | undefined => {
    switch (name) {
      case 'A':
      case 'ACC':
        return view.a;
      case 'B':
        return view.b;
      case 'SP':
        return view.sp;
      case 'PC':
        return view.pc;
      case 'DPTR':
        return view.dptr;
      case 'DPH':
        return (view.dptr >> 8) & 0xff;
      case 'DPL':
        return view.dptr & 0xff;
      case 'PSW':
        return view.psw;
      default:
    }
    const r = /^R([0-7])$/.exec(name);
    if (r) return view.regs[Number(r[1])];
    const p = /^P([0-3])$/.exec(name);
    if (p) return view.ports[Number(p[1])];
    return view.sfr[name];
  };
  const mem = (space: WatchSpace, address: number): number | undefined => {
    if (cpu) {
      // the stand-alone core can answer any address
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
    const slot = cells.findIndex((c) => c.space === space && c.address === address);
    if (slot >= 0) {
      const v = view.dbg.watch[slot];
      return v < 0 ? undefined : v;
    }
    // a computed address inside the RAM window
    if ((space === WATCH_SPACE.direct || space === WATCH_SPACE.indirect) && address >= view.ramBase && address < view.ramBase + view.ram.length && (space === WATCH_SPACE.indirect || address < 0x80)) {
      return view.ram[address - view.ramBase];
    }
    return undefined;
  };
  return { reg, mem };
}

/** The PSW flags of a view. */
export function pswFlags(psw: number): { cy: number; ac: number; f0: number; bank: number; ov: number; p: number } {
  return {
    cy: (psw >> 7) & 1,
    ac: (psw >> 6) & 1,
    f0: (psw >> 5) & 1,
    bank: (psw >> 3) & 3,
    ov: (psw >> 2) & 1,
    p: psw & 1,
  };
}

/** Uppercase hex with a fixed number of digits. */
export function hex(value: number, digits = 2): string {
  return Math.max(0, Math.round(value)).toString(16).toUpperCase().padStart(digits, '0');
}

/** Eight bits of a byte, most significant first. */
export function bits(value: number): number[] {
  return Array.from({ length: 8 }, (_, k) => (value >> (7 - k)) & 1);
}

/** Simulated seconds the core has run (machine cycles x the machine-cycle time). */
export function mcuTime(cycles: number, fosc: number): number {
  return cycles * machineCycleSeconds(fosc > 0 ? fosc : 12e6);
}

// ---------------------------------------------------------------------------------------------
// source lines, addresses and breakpoints

/** 1-based source line -> address of the first instruction on it. */
export function lineAddresses(asm: AsmResult): Map<number, number> {
  const out = new Map<number, number>();
  for (const [addr, line] of asm.addrLine) {
    const prev = out.get(line);
    if (prev === undefined || addr < prev) out.set(line, addr);
  }
  return out;
}

/** The source line the program counter is on (undefined when the address has no line). */
export function lineAtPc(asm: AsmResult, pc: number): number | undefined {
  return asm.addrLine.get(pc);
}

/** Addresses of the breakpoint lines that exist in the assembled program. */
export function breakpointAddresses(asm: AsmResult, lines: ReadonlySet<number>): Set<number> {
  const byLine = lineAddresses(asm);
  const out = new Set<number>();
  for (const line of lines) {
    const addr = byLine.get(line);
    if (addr !== undefined) out.add(addr);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// serial terminal

/** Bytes a view reports since the previous one, and how many were missed. */
export interface TerminalChunk {
  bytes: number[];
  /** bytes that were sent between two snapshots but no longer fit in the four-byte window */
  lost: number;
}

/**
 * Decodes the serial output from successive views. The core keeps the four newest transmitted
 * bytes plus a counter, so a snapshot that skipped more than four bytes reports them as lost
 * instead of silently dropping them.
 */
export class TerminalDecoder {
  private count = -1;

  reset(): void {
    this.count = -1;
  }

  feed(view: McuView): TerminalChunk {
    if (this.count < 0 || view.txCount < this.count) {
      this.count = view.txCount;
      return { bytes: [], lost: 0 };
    }
    const n = view.txCount - this.count;
    this.count = view.txCount;
    if (n <= 0) return { bytes: [], lost: 0 };
    const take = Math.min(4, n);
    const bytes = view.txRing.slice(0, take).reverse();
    return { bytes, lost: n - take };
  }
}

/** One printable character of a transmitted byte (control codes become their own markers). */
export function terminalChar(byte: number): string {
  const b = byte & 0xff;
  if (b === 0x0a || b === 0x0d) return '\n';
  if (b === 0x09) return '\t';
  if (b < 0x20 || b === 0x7f) return '.';
  return String.fromCharCode(b);
}

/** Append a chunk to terminal text, keeping at most `max` characters. */
export function appendTerminal(text: string, chunk: TerminalChunk, max = 4000): string {
  let out = text;
  if (chunk.lost > 0) out += '…';
  for (const b of chunk.bytes) out += terminalChar(b);
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Keys the read-outs use, for a quick check that a snapshot belongs to an MCU. */
export const MCU_VIEW_KEYS = MCU_PROBE_KEYS;

// ---------------------------------------------------------------------------------------------
// stand-alone debug run

export interface StandaloneOptions {
  fosc: number;
  xramSize: number;
}

/**
 * The panel's own core: it runs the program with no circuit attached (every pin reads high), so a
 * learner can single-step, set breakpoints and watch the registers without starting a simulation.
 */
export class StandaloneRun {
  readonly cpu: Cpu8051;
  readonly txRing = [0, 0, 0, 0];
  ramBase = 0x30;

  constructor(opts: StandaloneOptions) {
    this.cpu = new Cpu8051({ xramSize: opts.xramSize });
  }

  load(bytes: Uint8Array, at = 0): void {
    this.cpu.reset();
    this.cpu.code.fill(0);
    this.cpu.loadCode(bytes, at);
    this.txRing.fill(0);
  }

  reset(): void {
    const code = this.cpu.code.slice();
    this.cpu.reset();
    this.cpu.loadCode(code, 0);
    this.txRing.fill(0);
  }

  /** One instruction. */
  step(): void {
    this.cpu.step();
    this.drain();
  }

  /**
   * Run until a breakpoint address is reached, the core halts or `maxCycles` machine cycles have
   * passed; returns the address it stopped at.
   */
  run(breakpoints: ReadonlySet<number>, maxCycles = 2_000_000): number {
    const until = this.cpu.cycles + maxCycles;
    while (this.cpu.cycles < until && this.cpu.halted === 'none') {
      this.cpu.step();
      if (breakpoints.size > 0 && breakpoints.has(this.cpu.pc)) break;
    }
    this.drain();
    return this.cpu.pc;
  }

  /** Step until the program counter leaves the current source line (step over a loop body). */
  stepLine(addrLine: Map<number, number>, maxSteps = 100000): void {
    const start = addrLine.get(this.cpu.pc);
    for (let i = 0; i < maxSteps; i++) {
      this.cpu.step();
      if (this.cpu.halted !== 'none') break;
      const line = addrLine.get(this.cpu.pc);
      if (line !== undefined && line !== start) break;
    }
    this.drain();
  }

  send(byte: number): void {
    this.cpu.receiveByte(byte);
  }

  private drain(): void {
    for (const b of this.cpu.takeTransmitted()) {
      this.txRing.pop();
      this.txRing.unshift(b & 0xff);
    }
  }

  view(): McuView {
    return viewFromCpu(this.cpu, this.ramBase, this.txRing);
  }
}
