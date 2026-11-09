/**
 * MCS-51 ("8051") CPU core — original implementation written from the public instruction-set
 * description (opcode map, operand forms, flag rules and machine-cycle counts of the classic
 * MCS-51 architecture as published in textbooks and manufacturers' programmer's guides). No code,
 * table or data file of any other product was read or copied.
 *
 * What is modelled
 *   - all 256 opcode positions (0xA5 is the one unused position: the core halts with an error);
 *   - the classic register file: ACC, B, PSW, SP, DPTR, P0..P3, TMOD / TCON / TL0 / TH0 / TL1 /
 *     TH1, SCON / SBUF, IE / IP, PCON, reachable at their direct addresses 0x80..0xFF;
 *   - 256 bytes of internal RAM (0x80..0xFF only through @Ri and the stack), the four register
 *     banks selected by PSW.RS1 / RS0 and the bit-addressable area 0x20..0x2F;
 *   - external data memory for MOVX (size chosen by the caller; 0 = none, reads give 0xFF);
 *   - timers / counters 0 and 1 in modes 0..3 with GATE and C/T, the TF flags and auto-reload;
 *   - external interrupts 0 / 1 (level or falling edge), the two timer interrupts and the serial
 *     interrupt, two priority levels and the classic polling order;
 *   - the serial port: mode 0 at byte level (shift clock fosc/12), modes 1 and 3 bit by bit on the
 *     RXD / TXD pins with the baud rate taken from the timer 1 overflow rate and PCON.SMOD, and
 *     mode 2 (fosc/32 or fosc/64).
 *
 * Time base
 *   Everything is counted in MACHINE CYCLES (12 oscillator periods on a classic 8051), so the core
 *   never needs the crystal frequency; the caller converts with {@link machineCycleSeconds}.
 *   {@link Cpu8051.step} executes one instruction (or takes one pending interrupt, or spends one
 *   cycle held in reset) and returns the machine cycles it used. The timers, the serial shift clock
 *   and the external-interrupt edge detectors are advanced one cycle at a time inside, so their
 *   timing is exact to the machine cycle.
 *
 * Pins
 *   `pinIn[0..31]` are the levels the outside world puts on P0.0 … P3.7 (index = port * 8 + bit);
 *   {@link Cpu8051.pinOut} is what the port drives: the port latch ANDed with the alternate output
 *   function (TXD of the serial port), like the quasi-bidirectional port of the real part. Reading
 *   a port address returns the PIN levels, except in the read-modify-write instructions (ANL, ORL,
 *   XRL, INC, DEC, DJNZ, CPL bit, CLR bit, SETB bit, JBC, MOV bit,C), which read the LATCH — the
 *   documented behaviour of the real device.
 *
 * Speculation
 *   {@link Cpu8051.saveState} / {@link Cpu8051.restoreState} snapshot the whole machine cheaply
 *   (internal RAM and the SFRs are copied, external RAM is journalled), so a co-simulation can run
 *   the core ahead to find when its next output change falls, roll back, and replay it against the
 *   real pin waveforms (src/sim/devices/digital/mcu.ts).
 */

/** Direct addresses of the special function registers. */
export const SFR = {
  P0: 0x80,
  SP: 0x81,
  DPL: 0x82,
  DPH: 0x83,
  PCON: 0x87,
  TCON: 0x88,
  TMOD: 0x89,
  TL0: 0x8a,
  TL1: 0x8b,
  TH0: 0x8c,
  TH1: 0x8d,
  P1: 0x90,
  SCON: 0x98,
  SBUF: 0x99,
  P2: 0xa0,
  IE: 0xa8,
  P3: 0xb0,
  IP: 0xb8,
  PSW: 0xd0,
  ACC: 0xe0,
  B: 0xf0,
} as const;

/** SFR names the assembler and the register views know. */
export const SFR_NAMES: readonly { name: string; addr: number }[] = [
  { name: 'P0', addr: 0x80 },
  { name: 'SP', addr: 0x81 },
  { name: 'DPL', addr: 0x82 },
  { name: 'DPH', addr: 0x83 },
  { name: 'PCON', addr: 0x87 },
  { name: 'TCON', addr: 0x88 },
  { name: 'TMOD', addr: 0x89 },
  { name: 'TL0', addr: 0x8a },
  { name: 'TL1', addr: 0x8b },
  { name: 'TH0', addr: 0x8c },
  { name: 'TH1', addr: 0x8d },
  { name: 'P1', addr: 0x90 },
  { name: 'SCON', addr: 0x98 },
  { name: 'SBUF', addr: 0x99 },
  { name: 'P2', addr: 0xa0 },
  { name: 'IE', addr: 0xa8 },
  { name: 'P3', addr: 0xb0 },
  { name: 'IP', addr: 0xb8 },
  { name: 'PSW', addr: 0xd0 },
  { name: 'ACC', addr: 0xe0 },
  { name: 'A', addr: 0xe0 },
  { name: 'B', addr: 0xf0 },
];

/** Bit symbols of the SFR area (bit address = SFR base + bit number). */
export const BIT_NAMES: readonly { name: string; addr: number }[] = [
  { name: 'IT0', addr: 0x88 },
  { name: 'IE0', addr: 0x89 },
  { name: 'IT1', addr: 0x8a },
  { name: 'IE1', addr: 0x8b },
  { name: 'TR0', addr: 0x8c },
  { name: 'TF0', addr: 0x8d },
  { name: 'TR1', addr: 0x8e },
  { name: 'TF1', addr: 0x8f },
  { name: 'RI', addr: 0x98 },
  { name: 'TI', addr: 0x99 },
  { name: 'RB8', addr: 0x9a },
  { name: 'TB8', addr: 0x9b },
  { name: 'REN', addr: 0x9c },
  { name: 'SM2', addr: 0x9d },
  { name: 'SM1', addr: 0x9e },
  { name: 'SM0', addr: 0x9f },
  { name: 'EX0', addr: 0xa8 },
  { name: 'ET0', addr: 0xa9 },
  { name: 'EX1', addr: 0xaa },
  { name: 'ET1', addr: 0xab },
  { name: 'ES', addr: 0xac },
  { name: 'EA', addr: 0xaf },
  { name: 'RXD', addr: 0xb0 },
  { name: 'TXD', addr: 0xb1 },
  { name: 'INT0', addr: 0xb2 },
  { name: 'INT1', addr: 0xb3 },
  { name: 'T0', addr: 0xb4 },
  { name: 'T1', addr: 0xb5 },
  { name: 'WR', addr: 0xb6 },
  { name: 'RD', addr: 0xb7 },
  { name: 'PX0', addr: 0xb8 },
  { name: 'PT0', addr: 0xb9 },
  { name: 'PX1', addr: 0xba },
  { name: 'PT1', addr: 0xbb },
  { name: 'PS', addr: 0xbc },
  { name: 'P', addr: 0xd0 },
  { name: 'OV', addr: 0xd2 },
  { name: 'RS0', addr: 0xd3 },
  { name: 'RS1', addr: 0xd4 },
  { name: 'F0', addr: 0xd5 },
  { name: 'AC', addr: 0xd6 },
  { name: 'CY', addr: 0xd7 },
];

/** Pin index of a port bit (P0.0 = 0 … P3.7 = 31). */
export function pinIndex(port: number, bit: number): number {
  return port * 8 + bit;
}

/** Pin indices of the alternate functions on port 3. */
export const PIN_RXD = 24;
export const PIN_TXD = 25;
export const PIN_INT0 = 26;
export const PIN_INT1 = 27;
export const PIN_T0 = 28;
export const PIN_T1 = 29;

/** Seconds of one machine cycle at an oscillator frequency (12 clocks per cycle). */
export function machineCycleSeconds(fosc: number): number {
  return 12 / fosc;
}

/** Interrupt sources in the classic polling order. */
export const INTERRUPTS = ['ex0', 'et0', 'ex1', 'et1', 'es'] as const;
export type InterruptSource = (typeof INTERRUPTS)[number];

const VECTORS: Record<InterruptSource, number> = { ex0: 0x0003, et0: 0x000b, ex1: 0x0013, et1: 0x001b, es: 0x0023 };
/** IE / IP bit number of each source. */
const IE_BIT: Record<InterruptSource, number> = { ex0: 0, et0: 1, ex1: 2, et1: 3, es: 4 };

/** Why the core stopped executing. */
export type HaltReason = 'none' | 'opcode' | 'stack';

/** Machine cycles per opcode (index = opcode). */
export const CYCLES: Uint8Array = buildCycleTable();
/** Instruction length in bytes per opcode (index = opcode). */
export const LENGTHS: Uint8Array = buildLengthTable();

function buildCycleTable(): Uint8Array {
  const c = new Uint8Array(256).fill(1);
  const two = [
    0x02, 0x12, 0x22, 0x32, 0x73, 0x80, 0x83, 0x90, 0x93, 0xa3, // LJMP LCALL RET RETI JMP@ SJMP MOVC@PC MOV DPTR MOVC@DPTR INC DPTR
    0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, // JBC JB JNB JC JNC JZ JNZ
    0x43, 0x53, 0x63, // ORL / ANL / XRL direct,#data
    0x72, 0x82, 0xa0, 0xb0, 0x92, // ORL C,bit  ANL C,bit  ORL C,/bit  ANL C,/bit  MOV bit,C
    0xc0, 0xd0, 0xd5, 0x75, 0x85, 0x86, 0x87, 0xa6, 0xa7, // PUSH POP DJNZ-direct MOV-direct,#d MOV-direct,direct MOV-direct,@Ri MOV-@Ri,direct
    0xb4, 0xb5, 0xb6, 0xb7, // CJNE
    0xe0, 0xe2, 0xe3, 0xf0, 0xf2, 0xf3, // MOVX
  ];
  for (const op of two) c[op] = 2;
  for (let k = 0; k < 8; k++) {
    c[0x01 + 0x20 * k] = 2; // AJMP
    c[0x11 + 0x20 * k] = 2; // ACALL
    c[0x88 + k] = 2; // MOV direct,Rn
    c[0xa8 + k] = 2; // MOV Rn,direct
    c[0xb8 + k] = 2; // CJNE Rn,#data,rel
    c[0xd8 + k] = 2; // DJNZ Rn,rel
  }
  c[0xa4] = 4; // MUL AB
  c[0x84] = 4; // DIV AB
  return c;
}

function buildLengthTable(): Uint8Array {
  const l = new Uint8Array(256).fill(1);
  const two = [
    0x05, 0x15, // INC / DEC direct
    0x24, 0x25, 0x34, 0x35, 0x94, 0x95, // ADD / ADDC / SUBB with #data and direct
    0x44, 0x45, 0x42, 0x54, 0x55, 0x52, 0x64, 0x65, 0x62, // ORL / ANL / XRL (A,#d A,direct direct,A)
    0x74, 0xe5, 0xf5, // MOV A,#d  MOV A,direct  MOV direct,A
    0x76, 0x77, 0x86, 0x87, 0xa6, 0xa7, // MOV @Ri,#d   MOV direct,@Ri   MOV @Ri,direct
    0x80, 0x40, 0x50, 0x60, 0x70, // SJMP JC JNC JZ JNZ
    0x72, 0x82, 0xa0, 0xb0, 0x92, 0xa2, 0xb2, 0xc2, 0xd2, // bit operations
    0xc0, 0xd0, 0xc5, // PUSH POP XCH A,direct
  ];
  for (const op of two) l[op] = 2;
  const three = [
    0x02, 0x12, // LJMP LCALL
    0x75, 0x85, 0x90, // MOV direct,#d   MOV direct,direct   MOV DPTR,#d16
    0x43, 0x53, 0x63, // ORL / ANL / XRL direct,#data
    0x10, 0x20, 0x30, // JBC JB JNB
    0xb4, 0xb5, 0xb6, 0xb7, 0xd5, // CJNE, DJNZ direct,rel
  ];
  for (const op of three) l[op] = 3;
  for (let k = 0; k < 8; k++) {
    l[0x01 + 0x20 * k] = 2; // AJMP
    l[0x11 + 0x20 * k] = 2; // ACALL
    l[0x78 + k] = 2; // MOV Rn,#data
    l[0x88 + k] = 2; // MOV direct,Rn
    l[0xa8 + k] = 2; // MOV Rn,direct
    l[0xd8 + k] = 2; // DJNZ Rn,rel
    l[0xb8 + k] = 3; // CJNE Rn,#data,rel
  }
  return l;
}

/** Snapshot of the whole machine (see the module header: speculation). */
export interface CpuState {
  iram: Uint8Array;
  sfr: Uint8Array;
  /** external-RAM writes since the snapshot, as [address, previous value] pairs */
  xlog: number[];
  pc: number;
  cycles: number;
  scalars: Float64Array;
}

export interface Cpu8051Options {
  /** bytes of external data memory reachable with MOVX (0 = none) */
  xramSize?: number;
}

const SCALAR_COUNT = 25;

export class Cpu8051 {
  /** program memory (64 KB, byte addressed) */
  readonly code = new Uint8Array(0x10000);
  /** internal RAM 0x00..0xFF (0x80..0xFF only through @Ri and the stack) */
  readonly iram = new Uint8Array(0x100);
  /** direct SFR space 0x80..0xFF, indexed addr - 0x80 */
  readonly sfr = new Uint8Array(0x80);
  /** external data memory for MOVX (may be empty) */
  readonly xram: Uint8Array;
  /** external pin levels on P0.0 … P3.7 (index = port * 8 + bit) */
  readonly pinIn = new Uint8Array(32).fill(1);
  /** bytes the program transmitted, oldest first (drained with takeTransmitted) */
  readonly txOut: number[] = [];

  pc = 0;
  /** machine cycles executed since reset */
  cycles = 0;
  halted: HaltReason = 'none';
  /** address of the instruction that halted the core */
  haltPc = 0;
  /** true while RST is active: the core is held in reset */
  resetHeld = false;
  /** last transmitted byte, and how many bytes have been sent / received */
  txLast = 0;
  txCount = 0;
  rxCount = 0;

  private inService0 = false;
  private inService1 = false;
  /** no interrupt is taken right after RETI or after a write to IE / IP */
  private blockOnce = false;
  private prevInt0 = 1;
  private prevInt1 = 1;
  private prevT0 = 1;
  private prevT1 = 1;
  private stackBad = false;

  private txBits = 0;
  private txShift = 0;
  private txClock = 0;
  /** byte written to SBUF while a frame was still on the line (-1 = none) */
  private txHold = -1;
  /** level the serial port puts on TXD (1 when idle) */
  private txLine = 1;
  private rxBits = 0;
  private rxShift = 0;
  private rxClock = 0;
  private rxNinth = 0;
  private rxFromPin = false;
  private prevRxd = 1;
  /** value a read of SBUF returns (the receive register) */
  private sbufRx = 0;
  private rxQueue: number[] = [];

  private xlog: number[] | null = null;

  constructor(opts: Cpu8051Options = {}) {
    this.xram = new Uint8Array(Math.max(0, Math.min(0x10000, Math.round(opts.xramSize ?? 0))));
    this.reset();
  }

  /** Load program bytes at an address (does not reset). */
  loadCode(bytes: ArrayLike<number>, at = 0): void {
    for (let i = 0; i < bytes.length; i++) {
      const a = at + i;
      if (a >= 0 && a < this.code.length) this.code[a] = bytes[i] & 0xff;
    }
  }

  reset(): void {
    this.pc = 0;
    this.cycles = 0;
    this.halted = 'none';
    this.haltPc = 0;
    this.iram.fill(0);
    this.sfr.fill(0);
    this.sfr[SFR.SP - 0x80] = 0x07;
    for (const p of [SFR.P0, SFR.P1, SFR.P2, SFR.P3]) this.sfr[p - 0x80] = 0xff;
    this.inService0 = false;
    this.inService1 = false;
    this.blockOnce = false;
    this.prevInt0 = 1;
    this.prevInt1 = 1;
    this.prevT0 = 1;
    this.prevT1 = 1;
    this.stackBad = false;
    this.txBits = 0;
    this.txClock = 0;
    this.txHold = -1;
    this.txLine = 1;
    this.rxBits = 0;
    this.rxClock = 0;
    this.rxFromPin = false;
    this.prevRxd = 1;
    this.sbufRx = 0;
    this.txOut.length = 0;
    this.rxQueue.length = 0;
  }

  // -------------------------------------------------------------------------------------------
  // memory access

  /** Byte at a direct address; `latch` reads a port's output latch instead of its pins. */
  readDirect(addr: number, latch = false): number {
    const a = addr & 0xff;
    if (a < 0x80) return this.iram[a];
    if (!latch && (a === SFR.P0 || a === SFR.P1 || a === SFR.P2 || a === SFR.P3)) return this.portPins((a - 0x80) >> 4);
    if (a === SFR.SBUF) return this.sbufRx;
    if (a === SFR.PSW) this.updateParity();
    return this.sfr[a - 0x80];
  }

  writeDirect(addr: number, value: number): void {
    const a = addr & 0xff;
    const v = value & 0xff;
    if (a < 0x80) {
      this.iram[a] = v;
      return;
    }
    this.sfr[a - 0x80] = v;
    if (a === SFR.SBUF) this.startTransmit(v);
    else if (a === SFR.IE || a === SFR.IP) this.blockOnce = true;
    else if (a === SFR.ACC) this.updateParity();
  }

  /** Byte at an indirect address (@Ri, stack): always internal RAM. */
  readIndirect(addr: number): number {
    return this.iram[addr & 0xff];
  }

  writeIndirect(addr: number, value: number): void {
    this.iram[addr & 0xff] = value & 0xff;
  }

  readXram(addr: number): number {
    const a = addr & 0xffff;
    return a < this.xram.length ? this.xram[a] : 0xff;
  }

  writeXram(addr: number, value: number): void {
    const a = addr & 0xffff;
    if (a >= this.xram.length) return;
    if (this.xlog) this.xlog.push(a, this.xram[a]);
    this.xram[a] = value & 0xff;
  }

  /** Bit at a bit address (0x00..0x7F = RAM 0x20..0x2F, 0x80..0xFF = SFR bits). */
  readBit(bitAddr: number, latch = false): number {
    const b = bitAddr & 0xff;
    if (b < 0x80) return (this.iram[0x20 + (b >> 3)] >> (b & 7)) & 1;
    return (this.readDirect(b & 0xf8, latch) >> (b & 7)) & 1;
  }

  writeBit(bitAddr: number, value: number): void {
    const b = bitAddr & 0xff;
    const mask = 1 << (b & 7);
    if (b < 0x80) {
      const a = 0x20 + (b >> 3);
      this.iram[a] = value ? this.iram[a] | mask : this.iram[a] & ~mask;
      return;
    }
    const addr = b & 0xf8;
    const cur = this.readDirect(addr, true);
    this.writeDirect(addr, value ? cur | mask : cur & ~mask);
  }

  // -------------------------------------------------------------------------------------------
  // registers and flags

  get acc(): number {
    return this.sfr[SFR.ACC - 0x80];
  }

  set acc(v: number) {
    this.sfr[SFR.ACC - 0x80] = v & 0xff;
    this.updateParity();
  }

  get psw(): number {
    this.updateParity();
    return this.sfr[SFR.PSW - 0x80];
  }

  get sp(): number {
    return this.sfr[SFR.SP - 0x80];
  }

  get dptr(): number {
    return (this.sfr[SFR.DPH - 0x80] << 8) | this.sfr[SFR.DPL - 0x80];
  }

  set dptr(v: number) {
    this.sfr[SFR.DPH - 0x80] = (v >> 8) & 0xff;
    this.sfr[SFR.DPL - 0x80] = v & 0xff;
  }

  /** Active register bank (PSW.RS1 / RS0). */
  get bank(): number {
    return (this.sfr[SFR.PSW - 0x80] >> 3) & 3;
  }

  reg(n: number): number {
    return this.iram[this.bank * 8 + (n & 7)];
  }

  setReg(n: number, v: number): void {
    this.iram[this.bank * 8 + (n & 7)] = v & 0xff;
  }

  get carry(): number {
    return (this.sfr[SFR.PSW - 0x80] >> 7) & 1;
  }

  private setFlags(cy: boolean | undefined, ac?: boolean, ov?: boolean): void {
    let p = this.sfr[SFR.PSW - 0x80];
    if (cy !== undefined) p = cy ? p | 0x80 : p & ~0x80;
    if (ac !== undefined) p = ac ? p | 0x40 : p & ~0x40;
    if (ov !== undefined) p = ov ? p | 0x04 : p & ~0x04;
    this.sfr[SFR.PSW - 0x80] = p & 0xff;
  }

  /** PSW.P = odd parity of the accumulator (the hardware keeps it current). */
  private updateParity(): void {
    let a = this.sfr[SFR.ACC - 0x80];
    a ^= a >> 4;
    a ^= a >> 2;
    a ^= a >> 1;
    const p = this.sfr[SFR.PSW - 0x80];
    this.sfr[SFR.PSW - 0x80] = (a & 1) === 1 ? p | 1 : p & ~1;
  }

  // -------------------------------------------------------------------------------------------
  // pins

  /** Level the port drives on a pin: the latch ANDed with the alternate output function. */
  pinOut(index: number): number {
    const i = index & 31;
    const latch = (this.sfr[(i >> 3) * 16] >> (i & 7)) & 1;
    if (i === PIN_TXD && this.serialMode() !== 0) return latch & this.txLine;
    return latch;
  }

  /** Byte of the levels one port drives (bit k = pin k). */
  portDrive(port: number): number {
    const latch = this.sfr[(port & 3) * 16];
    // the only alternate output is TXD = P3.1, and it can only pull the pin down
    if (port === 3 && this.txLine === 0 && this.serialMode() !== 0) return latch & ~0x02;
    return latch;
  }

  /** Byte of the external levels on one port (what a read of Pn returns). */
  portPins(port: number): number {
    let v = 0;
    const base = (port & 3) * 8;
    for (let k = 7; k >= 0; k--) v = (v << 1) | (this.pinIn[base + k] & 1);
    return v;
  }

  // -------------------------------------------------------------------------------------------
  // snapshot / restore

  saveState(): CpuState {
    this.xlog = [];
    const scalars = new Float64Array(SCALAR_COUNT);
    this.readScalars(scalars);
    return { iram: this.iram.slice(), sfr: this.sfr.slice(), xlog: this.xlog, pc: this.pc, cycles: this.cycles, scalars };
  }

  restoreState(st: CpuState): void {
    for (let i = st.xlog.length - 2; i >= 0; i -= 2) this.xram[st.xlog[i]] = st.xlog[i + 1];
    st.xlog.length = 0;
    this.iram.set(st.iram);
    this.sfr.set(st.sfr);
    this.pc = st.pc;
    this.cycles = st.cycles;
    this.writeScalars(st.scalars);
    this.xlog = null;
  }

  /** Drop a snapshot without restoring it (stops journalling external RAM). */
  commitState(): void {
    this.xlog = null;
  }

  private readScalars(s: Float64Array): void {
    s[0] = this.inService0 ? 1 : 0;
    s[1] = this.inService1 ? 1 : 0;
    s[2] = this.blockOnce ? 1 : 0;
    s[3] = this.prevInt0;
    s[4] = this.prevInt1;
    s[5] = this.prevT0;
    s[6] = this.prevT1;
    s[7] = this.txBits;
    s[8] = this.txShift;
    s[9] = this.txClock;
    s[10] = this.txLine;
    s[11] = this.rxBits;
    s[12] = this.rxShift;
    s[13] = this.rxClock;
    s[14] = this.rxNinth;
    s[15] = this.txLast;
    s[16] = this.txCount;
    s[17] = this.rxCount;
    s[18] = this.rxQueue.length;
    s[19] = this.txOut.length;
    s[20] = this.prevRxd;
    s[21] = this.rxFromPin ? 1 : 0;
    s[22] = this.sbufRx;
    s[23] = this.halted === 'none' ? 0 : this.halted === 'opcode' ? 1 : 2;
    s[24] = this.txHold;
  }

  private writeScalars(s: Float64Array): void {
    this.inService0 = s[0] === 1;
    this.inService1 = s[1] === 1;
    this.blockOnce = s[2] === 1;
    this.prevInt0 = s[3];
    this.prevInt1 = s[4];
    this.prevT0 = s[5];
    this.prevT1 = s[6];
    this.txBits = s[7];
    this.txShift = s[8];
    this.txClock = s[9];
    this.txLine = s[10];
    this.rxBits = s[11];
    this.rxShift = s[12];
    this.rxClock = s[13];
    this.rxNinth = s[14];
    this.txLast = s[15];
    this.txCount = s[16];
    this.rxCount = s[17];
    // the queues only grow while running ahead: cut them back to their saved length
    if (this.rxQueue.length > s[18]) this.rxQueue.length = s[18];
    if (this.txOut.length > s[19]) this.txOut.length = s[19];
    this.prevRxd = s[20];
    this.rxFromPin = s[21] === 1;
    this.sbufRx = s[22];
    this.halted = s[23] === 0 ? 'none' : s[23] === 1 ? 'opcode' : 'stack';
    this.txHold = s[24];
    this.stackBad = false;
  }

  // -------------------------------------------------------------------------------------------
  // serial port

  /** 0..3 from SCON.SM0 / SM1. */
  serialMode(): number {
    const scon = this.sfr[SFR.SCON - 0x80];
    return ((scon >> 7) & 1) * 2 + ((scon >> 6) & 1);
  }

  /** Machine cycles of one serial bit in the active mode. */
  bitCycles(): number {
    const mode = this.serialMode();
    const smod = (this.sfr[SFR.PCON - 0x80] >> 7) & 1;
    if (mode === 0) return 1;
    // mode 2: fosc/64, or fosc/32 with SMOD — one machine cycle is 12 oscillator periods
    if (mode === 2) return smod ? 32 / 12 : 64 / 12;
    // modes 1 and 3: the timer 1 overflow rate divided by 16 (by 8 when SMOD = 1)
    return (32 >> smod) * this.timer1Period();
  }

  /** Machine cycles between two timer 1 overflows at its present setting. */
  private timer1Period(): number {
    const mode = (this.sfr[SFR.TMOD - 0x80] >> 4) & 3;
    const th1 = this.sfr[SFR.TH1 - 0x80];
    const tl1 = this.sfr[SFR.TL1 - 0x80];
    if (mode === 2) return Math.max(1, 256 - th1);
    if (mode === 0) return Math.max(1, 8192 - ((th1 << 5) | (tl1 & 0x1f)));
    return Math.max(1, 65536 - ((th1 << 8) | tl1));
  }

  /** Bits in one serial frame (mode 0: data only; mode 1: start + 8 + stop; modes 2 / 3: + TB8). */
  private frameBits(): number {
    const mode = this.serialMode();
    return mode === 0 ? 8 : mode === 1 ? 10 : 11;
  }

  /**
   * A write to SBUF. While a frame is still on the line the byte is held and the next frame starts
   * on the shift clock that ends the current one, so the stop bit keeps its full length and
   * characters go out back to back (what a program that writes SBUF right after TI expects).
   */
  private startTransmit(value: number): void {
    if (this.txBits > 0) {
      this.txHold = value & 0xff;
      return;
    }
    this.beginFrame(value);
    this.txClock = 0;
  }

  private beginFrame(value: number): void {
    this.txShift = value & 0xff;
    this.txBits = this.frameBits();
    this.txLine = this.serialMode() === 0 ? 1 : 0; // start bit
  }

  /** True while the transmitter is busy. */
  get transmitting(): boolean {
    return this.txBits > 0;
  }

  /** Push a byte into the receiver as if it had arrived on RXD (virtual terminal). */
  receiveByte(value: number): void {
    this.rxQueue.push(value & 0xff);
  }

  /** How many injected bytes are still waiting. */
  get rxPending(): number {
    return this.rxQueue.length;
  }

  /** Bytes the program transmitted since the last call. */
  takeTransmitted(): number[] {
    return this.txOut.splice(0, this.txOut.length);
  }

  /** TI is set and the byte becomes visible when the stop bit starts. */
  private finishTransmit(): void {
    this.txLast = this.txShift;
    this.txCount += 1;
    this.txOut.push(this.txShift);
    this.sfr[SFR.SCON - 0x80] |= 0x02; // TI
  }

  private tickSerial(): void {
    const rxd = this.pinIn[PIN_RXD] & 1;
    const scon = this.sfr[SFR.SCON - 0x80];
    const ren = (scon >> 4) & 1;
    if (this.txBits === 0 && this.rxBits === 0 && (ren === 0 || (rxd === 1 && this.rxQueue.length === 0))) {
      this.prevRxd = rxd;
      if (ren === 0) this.rxBits = 0;
      return;
    }
    const mode = this.serialMode();
    const bt = this.bitCycles();
    if (this.txBits > 0) {
      this.txClock += 1;
      if (this.txClock >= bt) {
        this.txClock -= bt;
        const frame = this.frameBits();
        this.txBits -= 1;
        if (this.txBits === 0) {
          if (mode === 0) this.finishTransmit();
          if (this.txHold >= 0) {
            const held = this.txHold;
            this.txHold = -1;
            this.beginFrame(held);
          } else this.txLine = 1;
        } else {
          const next = frame - this.txBits; // 1-based index of the bit that starts now
          if (mode === 0) this.txLine = 1;
          else if (next <= 8) this.txLine = (this.txShift >> (next - 1)) & 1;
          else if (next === 9 && mode !== 1) this.txLine = (this.sfr[SFR.SCON - 0x80] >> 3) & 1; // TB8
          else {
            this.txLine = 1; // the stop bit begins
            this.finishTransmit();
          }
        }
      }
    }
    if (ren === 0) {
      this.rxBits = 0;
      this.prevRxd = rxd;
      return;
    }
    if (this.rxBits === 0) {
      if (mode !== 0 && rxd === 0 && this.prevRxd === 1) {
        this.rxBits = this.frameBits();
        this.rxClock = bt / 2; // sample in the middle of each bit
        this.rxShift = 0;
        this.rxNinth = 0;
        this.rxFromPin = true;
      } else if (this.rxQueue.length > 0) {
        this.rxBits = this.frameBits();
        this.rxClock = 0;
        this.rxShift = this.rxQueue.shift()!;
        this.rxNinth = 1;
        this.rxFromPin = false;
      }
    } else {
      this.rxClock += 1;
      if (this.rxClock >= bt) {
        this.rxClock -= bt;
        const frame = this.frameBits();
        const index = frame - this.rxBits - (mode === 0 ? 0 : 1);
        this.rxBits -= 1;
        if (this.rxFromPin) {
          if (index >= 0 && index < 8) this.rxShift = (this.rxShift & ~(1 << index)) | (rxd << index);
          else if (index === 8 && mode !== 1) this.rxNinth = rxd;
        }
        if (this.rxBits === 0) this.finishReceive();
      }
    }
    this.prevRxd = rxd;
  }

  private finishReceive(): void {
    const scon = this.sfr[SFR.SCON - 0x80];
    const mode = this.serialMode();
    const sm2 = (scon >> 5) & 1;
    if ((scon & 0x01) === 1) return; // RI still set: the byte is lost
    if (mode >= 2 && sm2 === 1 && this.rxNinth === 0) return;
    this.sbufRx = this.rxShift & 0xff;
    this.sfr[SFR.SCON - 0x80] = (scon & ~0x04) | (this.rxNinth ? 0x04 : 0) | 0x01; // RB8, RI
    this.rxCount += 1;
  }

  // -------------------------------------------------------------------------------------------
  // timers, counters and external-interrupt sampling (one machine cycle)

  private tickTimers(): void {
    const tmod = this.sfr[SFR.TMOD - 0x80];
    let tcon = this.sfr[SFR.TCON - 0x80];
    // fast path: both timers stopped and both external interrupts level triggered and inactive,
    // so nothing in TCON can change this cycle
    if (tmod === 0 && tcon === 0 && this.pinIn[PIN_INT0] === 1 && this.pinIn[PIN_INT1] === 1) {
      this.prevInt0 = 1;
      this.prevInt1 = 1;
      this.prevT0 = this.pinIn[PIN_T0] & 1;
      this.prevT1 = this.pinIn[PIN_T1] & 1;
      return;
    }
    const mode0 = tmod & 3;
    const mode1 = (tmod >> 4) & 3;
    const int0 = this.pinIn[PIN_INT0] & 1;
    const int1 = this.pinIn[PIN_INT1] & 1;
    const t0 = this.pinIn[PIN_T0] & 1;
    const t1 = this.pinIn[PIN_T1] & 1;
    const run0 = (tcon & 0x10) !== 0 && ((tmod & 0x08) === 0 || int0 === 1);
    const run1 = (tcon & 0x40) !== 0 && ((tmod & 0x80) === 0 || int1 === 1);
    const tick0 = (tmod & 0x04) === 0 ? true : this.prevT0 === 1 && t0 === 0;
    const tick1 = (tmod & 0x40) === 0 ? true : this.prevT1 === 1 && t1 === 0;

    if (mode0 === 3) {
      // split timer 0: TL0 is an 8-bit timer with TF0; TH0 is an 8-bit timer run by TR1 with TF1
      if (run0 && tick0 && this.bump8(SFR.TL0)) tcon |= 0x20;
      if ((tcon & 0x40) !== 0 && this.bump8(SFR.TH0)) tcon |= 0x80;
    } else if (run0 && tick0) {
      if (this.bumpTimer(mode0, SFR.TL0, SFR.TH0)) tcon |= 0x20; // TF0
    }
    if (mode1 !== 3 && run1 && tick1) {
      const ov = this.bumpTimer(mode1, SFR.TL1, SFR.TH1);
      if (ov && mode0 !== 3) tcon |= 0x80; // in mode 3 TF1 belongs to TH0
    }
    // external interrupt flags: falling edge when ITx = 1, the inverted pin level when ITx = 0
    if ((tcon & 0x01) !== 0) {
      if (this.prevInt0 === 1 && int0 === 0) tcon |= 0x02;
    } else tcon = int0 === 0 ? tcon | 0x02 : tcon & ~0x02;
    if ((tcon & 0x04) !== 0) {
      if (this.prevInt1 === 1 && int1 === 0) tcon |= 0x08;
    } else tcon = int1 === 0 ? tcon | 0x08 : tcon & ~0x08;
    this.sfr[SFR.TCON - 0x80] = tcon & 0xff;
    this.prevInt0 = int0;
    this.prevInt1 = int1;
    this.prevT0 = t0;
    this.prevT1 = t1;
  }

  /** Increment an 8-bit SFR; true on overflow. */
  private bump8(addr: number): boolean {
    const v = (this.sfr[addr - 0x80] + 1) & 0xff;
    this.sfr[addr - 0x80] = v;
    return v === 0;
  }

  /** Increment a timer in mode 0 / 1 / 2; true on overflow (mode 2 reloads TL from TH). */
  private bumpTimer(mode: number, tl: number, th: number): boolean {
    if (mode === 2) {
      if (this.bump8(tl)) {
        this.sfr[tl - 0x80] = this.sfr[th - 0x80];
        return true;
      }
      return false;
    }
    if (mode === 0) {
      const low = (this.sfr[tl - 0x80] + 1) & 0x1f; // 13-bit: five bits of TL plus TH
      this.sfr[tl - 0x80] = low;
      return low === 0 ? this.bump8(th) : false;
    }
    return this.bump8(tl) ? this.bump8(th) : false;
  }

  /** Advance the peripherals by n machine cycles. */
  private advance(n: number): void {
    for (let i = 0; i < n; i++) {
      this.cycles += 1;
      this.tickTimers();
      this.tickSerial();
    }
  }

  // -------------------------------------------------------------------------------------------
  // interrupts

  /** The pending source that may be taken now (highest priority first), or null. */
  pendingInterrupt(): InterruptSource | null {
    const ie = this.sfr[SFR.IE - 0x80];
    if ((ie & 0x80) === 0) return null;
    const ip = this.sfr[SFR.IP - 0x80];
    const tcon = this.sfr[SFR.TCON - 0x80];
    const scon = this.sfr[SFR.SCON - 0x80];
    const flags: Record<InterruptSource, boolean> = {
      ex0: (tcon & 0x02) !== 0,
      et0: (tcon & 0x20) !== 0,
      ex1: (tcon & 0x08) !== 0,
      et1: (tcon & 0x80) !== 0,
      es: (scon & 0x03) !== 0,
    };
    for (const level of [1, 0]) {
      if (level === 1 && this.inService1) continue;
      if (level === 0 && (this.inService0 || this.inService1)) continue;
      for (const src of INTERRUPTS) {
        if (!flags[src] || (ie & (1 << IE_BIT[src])) === 0) continue;
        if (((ip >> IE_BIT[src]) & 1) === level) return src;
      }
    }
    return null;
  }

  private takeInterrupt(src: InterruptSource): void {
    const level = (this.sfr[SFR.IP - 0x80] >> IE_BIT[src]) & 1;
    if (level === 1) this.inService1 = true;
    else this.inService0 = true;
    // the hardware clears the timer flags and the edge-triggered external flags
    const tcon = this.sfr[SFR.TCON - 0x80];
    if (src === 'et0') this.sfr[SFR.TCON - 0x80] = tcon & ~0x20;
    else if (src === 'et1') this.sfr[SFR.TCON - 0x80] = tcon & ~0x80;
    else if (src === 'ex0' && (tcon & 0x01) !== 0) this.sfr[SFR.TCON - 0x80] = tcon & ~0x02;
    else if (src === 'ex1' && (tcon & 0x04) !== 0) this.sfr[SFR.TCON - 0x80] = tcon & ~0x08;
    this.pushWord(this.pc);
    this.pc = VECTORS[src];
    this.advance(2);
  }

  private pushWord(v: number): void {
    this.push(v & 0xff);
    this.push((v >> 8) & 0xff);
  }

  private push(v: number): void {
    const sp = (this.sp + 1) & 0xff;
    if (sp === 0) this.stackBad = true;
    this.sfr[SFR.SP - 0x80] = sp;
    this.iram[sp] = v & 0xff;
  }

  private pop(): number {
    const sp = this.sp;
    const v = this.iram[sp];
    this.sfr[SFR.SP - 0x80] = (sp - 1) & 0xff;
    return v;
  }

  // -------------------------------------------------------------------------------------------
  // execution

  private fetch(): number {
    const b = this.code[this.pc & 0xffff];
    this.pc = (this.pc + 1) & 0xffff;
    return b;
  }

  /**
   * Execute one instruction (or take a pending interrupt, or spend one cycle in reset / halted)
   * and return the machine cycles it used.
   */
  step(): number {
    if (this.resetHeld) {
      const c = this.cycles;
      this.reset();
      this.cycles = c + 1;
      return 1;
    }
    if (this.halted !== 'none') {
      this.advance(1);
      return 1;
    }
    if (!this.blockOnce) {
      const src = this.pendingInterrupt();
      if (src) {
        this.takeInterrupt(src);
        if (this.stackBad) this.stop('stack');
        return 2;
      }
    }
    this.blockOnce = false;
    const start = this.pc;
    const op = this.fetch();
    if (!this.execute(op)) {
      this.halted = 'opcode';
      this.haltPc = start;
      this.pc = start;
      this.advance(1);
      return 1;
    }
    const cyc = CYCLES[op];
    this.advance(cyc);
    if (this.stackBad) this.stop('stack');
    return cyc;
  }

  private stop(reason: HaltReason): void {
    this.halted = reason;
    this.haltPc = this.pc;
    this.stackBad = false;
  }

  /** Run until the cycle counter reaches `until`, a breakpoint is reached or the core halts. */
  run(until: number, breakpoints?: ReadonlySet<number>): number {
    const start = this.cycles;
    const hasBp = !!breakpoints && breakpoints.size > 0;
    while (this.cycles < until && this.halted === 'none') {
      this.step();
      if (hasBp && breakpoints!.has(this.pc)) break;
    }
    return this.cycles - start;
  }

  // ---- operand helpers

  private rel(): number {
    const d = this.fetch();
    return d > 127 ? d - 256 : d;
  }

  private jump(target: number): void {
    this.pc = target & 0xffff;
  }

  private riAddr(op: number): number {
    return this.reg(op & 1);
  }

  /** Execute the opcode; false for the one undefined position. */
  private execute(op: number): boolean {
    const hi = op >> 4;
    const lo = op & 0x0f;
    // the regular eight-wide Rn blocks
    if (lo >= 8) {
      const n = lo - 8;
      switch (hi) {
        case 0x0:
          this.setReg(n, this.reg(n) + 1);
          return true;
        case 0x1:
          this.setReg(n, this.reg(n) - 1);
          return true;
        case 0x2:
          this.add(this.reg(n), 0);
          return true;
        case 0x3:
          this.add(this.reg(n), this.carry);
          return true;
        case 0x4:
          this.acc = this.acc | this.reg(n);
          return true;
        case 0x5:
          this.acc = this.acc & this.reg(n);
          return true;
        case 0x6:
          this.acc = this.acc ^ this.reg(n);
          return true;
        case 0x7:
          this.setReg(n, this.fetch());
          return true;
        case 0x8:
          this.writeDirect(this.fetch(), this.reg(n));
          return true;
        case 0x9:
          this.sub(this.reg(n));
          return true;
        case 0xa:
          this.setReg(n, this.readDirect(this.fetch()));
          return true;
        case 0xb: {
          const d = this.fetch();
          const r = this.rel();
          this.compare(this.reg(n), d, r);
          return true;
        }
        case 0xc: {
          const a = this.acc;
          this.acc = this.reg(n);
          this.setReg(n, a);
          return true;
        }
        case 0xd: {
          const v = (this.reg(n) - 1) & 0xff;
          this.setReg(n, v);
          const r = this.rel();
          if (v !== 0) this.jump(this.pc + r);
          return true;
        }
        case 0xe:
          this.acc = this.reg(n);
          return true;
        default:
          this.setReg(n, this.acc);
          return true;
      }
    }
    switch (op) {
      case 0x00:
        return true;
      case 0xa5:
        return false;

      // ---- AJMP / ACALL (the page comes from the three high opcode bits)
      case 0x01:
      case 0x21:
      case 0x41:
      case 0x61:
      case 0x81:
      case 0xa1:
      case 0xc1:
      case 0xe1: {
        const addr = this.fetch();
        this.jump((this.pc & 0xf800) | ((op & 0xe0) << 3) | addr);
        return true;
      }
      case 0x11:
      case 0x31:
      case 0x51:
      case 0x71:
      case 0x91:
      case 0xb1:
      case 0xd1:
      case 0xf1: {
        const addr = this.fetch();
        this.pushWord(this.pc);
        this.jump((this.pc & 0xf800) | ((op & 0xe0) << 3) | addr);
        return true;
      }

      // ---- long jumps, calls and returns
      case 0x02: {
        const h = this.fetch();
        this.jump((h << 8) | this.fetch());
        return true;
      }
      case 0x12: {
        const h = this.fetch();
        const l = this.fetch();
        this.pushWord(this.pc);
        this.jump((h << 8) | l);
        return true;
      }
      case 0x22:
      case 0x32: {
        const h = this.pop();
        const l = this.pop();
        this.jump((h << 8) | l);
        if (op === 0x32) {
          if (this.inService1) this.inService1 = false;
          else this.inService0 = false;
          this.blockOnce = true;
        }
        return true;
      }
      case 0x73:
        this.jump(this.acc + this.dptr);
        return true;
      case 0x80: {
        const r = this.rel();
        this.jump(this.pc + r);
        return true;
      }

      // ---- accumulator operations
      case 0x03: {
        const a = this.acc;
        this.acc = (a >> 1) | ((a & 1) << 7);
        return true;
      }
      case 0x13: {
        const a = this.acc;
        const c = this.carry;
        this.setFlags((a & 1) === 1);
        this.acc = (a >> 1) | (c << 7);
        return true;
      }
      case 0x23: {
        const a = this.acc;
        this.acc = ((a << 1) | (a >> 7)) & 0xff;
        return true;
      }
      case 0x33: {
        const a = this.acc;
        const c = this.carry;
        this.setFlags((a & 0x80) !== 0);
        this.acc = ((a << 1) | c) & 0xff;
        return true;
      }
      case 0x04:
        this.acc = this.acc + 1;
        return true;
      case 0x14:
        this.acc = this.acc - 1;
        return true;
      case 0xe4:
        this.acc = 0;
        return true;
      case 0xf4:
        this.acc = ~this.acc;
        return true;
      case 0xc4: {
        const a = this.acc;
        this.acc = ((a << 4) | (a >> 4)) & 0xff;
        return true;
      }
      case 0xd4:
        this.decimalAdjust();
        return true;
      case 0xa4: {
        const r = this.acc * this.sfr[SFR.B - 0x80];
        this.setFlags(false, undefined, r > 0xff);
        this.sfr[SFR.B - 0x80] = (r >> 8) & 0xff;
        this.acc = r & 0xff;
        return true;
      }
      case 0x84: {
        const b = this.sfr[SFR.B - 0x80];
        if (b === 0) {
          this.setFlags(false, undefined, true);
          return true;
        }
        const a = this.acc;
        this.setFlags(false, undefined, false);
        this.sfr[SFR.B - 0x80] = a % b;
        this.acc = Math.floor(a / b);
        return true;
      }

      // ---- INC / DEC with direct and @Ri
      case 0x05: {
        const d = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) + 1);
        return true;
      }
      case 0x15: {
        const d = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) - 1);
        return true;
      }
      case 0x06:
      case 0x07: {
        const a = this.riAddr(op);
        this.writeIndirect(a, this.readIndirect(a) + 1);
        return true;
      }
      case 0x16:
      case 0x17: {
        const a = this.riAddr(op);
        this.writeIndirect(a, this.readIndirect(a) - 1);
        return true;
      }
      case 0xa3:
        this.dptr = this.dptr + 1;
        return true;

      // ---- ADD / ADDC / SUBB with #data, direct and @Ri
      case 0x24:
        this.add(this.fetch(), 0);
        return true;
      case 0x25:
        this.add(this.readDirect(this.fetch()), 0);
        return true;
      case 0x26:
      case 0x27:
        this.add(this.readIndirect(this.riAddr(op)), 0);
        return true;
      case 0x34:
        this.add(this.fetch(), this.carry);
        return true;
      case 0x35:
        this.add(this.readDirect(this.fetch()), this.carry);
        return true;
      case 0x36:
      case 0x37:
        this.add(this.readIndirect(this.riAddr(op)), this.carry);
        return true;
      case 0x94:
        this.sub(this.fetch());
        return true;
      case 0x95:
        this.sub(this.readDirect(this.fetch()));
        return true;
      case 0x96:
      case 0x97:
        this.sub(this.readIndirect(this.riAddr(op)));
        return true;

      // ---- ORL / ANL / XRL
      case 0x44:
        this.acc = this.acc | this.fetch();
        return true;
      case 0x45:
        this.acc = this.acc | this.readDirect(this.fetch());
        return true;
      case 0x46:
      case 0x47:
        this.acc = this.acc | this.readIndirect(this.riAddr(op));
        return true;
      case 0x42: {
        const d = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) | this.acc);
        return true;
      }
      case 0x43: {
        const d = this.fetch();
        const v = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) | v);
        return true;
      }
      case 0x54:
        this.acc = this.acc & this.fetch();
        return true;
      case 0x55:
        this.acc = this.acc & this.readDirect(this.fetch());
        return true;
      case 0x56:
      case 0x57:
        this.acc = this.acc & this.readIndirect(this.riAddr(op));
        return true;
      case 0x52: {
        const d = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) & this.acc);
        return true;
      }
      case 0x53: {
        const d = this.fetch();
        const v = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) & v);
        return true;
      }
      case 0x64:
        this.acc = this.acc ^ this.fetch();
        return true;
      case 0x65:
        this.acc = this.acc ^ this.readDirect(this.fetch());
        return true;
      case 0x66:
      case 0x67:
        this.acc = this.acc ^ this.readIndirect(this.riAddr(op));
        return true;
      case 0x62: {
        const d = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) ^ this.acc);
        return true;
      }
      case 0x63: {
        const d = this.fetch();
        const v = this.fetch();
        this.writeDirect(d, this.readDirect(d, true) ^ v);
        return true;
      }

      // ---- data moves
      case 0x74:
        this.acc = this.fetch();
        return true;
      case 0xe5:
        this.acc = this.readDirect(this.fetch());
        return true;
      case 0xe6:
      case 0xe7:
        this.acc = this.readIndirect(this.riAddr(op));
        return true;
      case 0xf5:
        this.writeDirect(this.fetch(), this.acc);
        return true;
      case 0xf6:
      case 0xf7:
        this.writeIndirect(this.riAddr(op), this.acc);
        return true;
      case 0x75: {
        const d = this.fetch();
        this.writeDirect(d, this.fetch());
        return true;
      }
      case 0x85: {
        const src = this.fetch();
        const dst = this.fetch();
        this.writeDirect(dst, this.readDirect(src));
        return true;
      }
      case 0x86:
      case 0x87: {
        const d = this.fetch();
        this.writeDirect(d, this.readIndirect(this.riAddr(op)));
        return true;
      }
      case 0xa6:
      case 0xa7: {
        const d = this.fetch();
        this.writeIndirect(this.riAddr(op), this.readDirect(d));
        return true;
      }
      case 0x76:
      case 0x77:
        this.writeIndirect(this.riAddr(op), this.fetch());
        return true;
      case 0x90: {
        const h = this.fetch();
        this.dptr = (h << 8) | this.fetch();
        return true;
      }
      case 0x93:
        this.acc = this.code[(this.dptr + this.acc) & 0xffff];
        return true;
      case 0x83:
        this.acc = this.code[(this.pc + this.acc) & 0xffff];
        return true;
      case 0xe0:
        this.acc = this.readXram(this.dptr);
        return true;
      case 0xf0:
        this.writeXram(this.dptr, this.acc);
        return true;
      case 0xe2:
      case 0xe3:
        this.acc = this.readXram((this.sfr[SFR.P2 - 0x80] << 8) | this.riAddr(op));
        return true;
      case 0xf2:
      case 0xf3:
        this.writeXram((this.sfr[SFR.P2 - 0x80] << 8) | this.riAddr(op), this.acc);
        return true;
      case 0xc0:
        this.push(this.readDirect(this.fetch()));
        return true;
      case 0xd0: {
        const d = this.fetch();
        this.writeDirect(d, this.pop());
        return true;
      }
      case 0xc5: {
        const d = this.fetch();
        const v = this.readDirect(d);
        this.writeDirect(d, this.acc);
        this.acc = v;
        return true;
      }
      case 0xc6:
      case 0xc7: {
        const a = this.riAddr(op);
        const v = this.readIndirect(a);
        this.writeIndirect(a, this.acc);
        this.acc = v;
        return true;
      }
      case 0xd6:
      case 0xd7: {
        const a = this.riAddr(op);
        const v = this.readIndirect(a);
        const acc = this.acc;
        this.writeIndirect(a, (v & 0xf0) | (acc & 0x0f));
        this.acc = (acc & 0xf0) | (v & 0x0f);
        return true;
      }

      // ---- bit operations
      case 0xc3:
        this.setFlags(false);
        return true;
      case 0xd3:
        this.setFlags(true);
        return true;
      case 0xb3:
        this.setFlags(this.carry === 0);
        return true;
      case 0xc2:
        this.writeBit(this.fetch(), 0);
        return true;
      case 0xd2:
        this.writeBit(this.fetch(), 1);
        return true;
      case 0xb2: {
        const b = this.fetch();
        this.writeBit(b, this.readBit(b, true) ^ 1);
        return true;
      }
      case 0x82:
        this.setFlags(this.carry === 1 && this.readBit(this.fetch()) === 1);
        return true;
      case 0xb0:
        this.setFlags(this.carry === 1 && this.readBit(this.fetch()) === 0);
        return true;
      case 0x72:
        this.setFlags(this.carry === 1 || this.readBit(this.fetch()) === 1);
        return true;
      case 0xa0:
        this.setFlags(this.carry === 1 || this.readBit(this.fetch()) === 0);
        return true;
      case 0xa2:
        this.setFlags(this.readBit(this.fetch()) === 1);
        return true;
      case 0x92:
        this.writeBit(this.fetch(), this.carry);
        return true;

      // ---- conditional jumps
      case 0x20:
      case 0x30: {
        const b = this.fetch();
        const r = this.rel();
        const v = this.readBit(b);
        if ((op === 0x20 && v === 1) || (op === 0x30 && v === 0)) this.jump(this.pc + r);
        return true;
      }
      case 0x10: {
        const b = this.fetch();
        const r = this.rel();
        if (this.readBit(b, true) === 1) {
          this.writeBit(b, 0);
          this.jump(this.pc + r);
        }
        return true;
      }
      case 0x40:
      case 0x50: {
        const r = this.rel();
        if ((op === 0x40) === (this.carry === 1)) this.jump(this.pc + r);
        return true;
      }
      case 0x60:
      case 0x70: {
        const r = this.rel();
        if ((op === 0x60) === (this.acc === 0)) this.jump(this.pc + r);
        return true;
      }
      case 0xb4: {
        const d = this.fetch();
        const r = this.rel();
        this.compare(this.acc, d, r);
        return true;
      }
      case 0xb5: {
        const d = this.fetch();
        const r = this.rel();
        this.compare(this.acc, this.readDirect(d), r);
        return true;
      }
      case 0xb6:
      case 0xb7: {
        const d = this.fetch();
        const r = this.rel();
        this.compare(this.readIndirect(this.riAddr(op)), d, r);
        return true;
      }
      case 0xd5: {
        const d = this.fetch();
        const r = this.rel();
        const v = (this.readDirect(d, true) - 1) & 0xff;
        this.writeDirect(d, v);
        if (v !== 0) this.jump(this.pc + r);
        return true;
      }
      default:
        return false;
    }
  }

  private add(v: number, c: number): void {
    const a = this.acc;
    const r = a + v + c;
    const res = r & 0xff;
    this.setFlags(r > 0xff, (a & 0x0f) + (v & 0x0f) + c > 0x0f, ((~(a ^ v) & (a ^ res)) & 0x80) !== 0);
    this.acc = res;
  }

  private sub(v: number): void {
    const a = this.acc;
    const c = this.carry;
    const r = a - v - c;
    const res = r & 0xff;
    this.setFlags(r < 0, (a & 0x0f) - (v & 0x0f) - c < 0, (((a ^ v) & (a ^ res)) & 0x80) !== 0);
    this.acc = res;
  }

  /** CJNE: jump when the bytes differ; CY = 1 when the first is below the second. */
  private compare(a: number, b: number, rel: number): void {
    this.setFlags(a < b);
    if (a !== b) this.jump(this.pc + rel);
  }

  /** DA A: BCD adjust after an addition (the carry is only ever set, never cleared). */
  private decimalAdjust(): void {
    let a = this.acc;
    let cy = this.carry === 1;
    const ac = (this.sfr[SFR.PSW - 0x80] & 0x40) !== 0;
    if ((a & 0x0f) > 9 || ac) {
      const r = a + 6;
      if (r > 0xff) cy = true;
      a = r & 0xff;
    }
    if ((a >> 4) > 9 || cy) {
      const r = a + 0x60;
      if (r > 0xff) cy = true;
      a = r & 0xff;
    }
    this.setFlags(cy);
    this.acc = a;
  }
}
