/**
 * Character LCD code model compatible with the common HD44780 instruction set (a subset that
 * covers what learners use).
 *
 *   D_LCD   rs rw e d0..d7 c0..c(N-1) st g0..g63
 *     params cols, rows (N = cols x rows visible cells), texec (37 µs), tclear (1.52 ms).
 *     Bus: a transfer happens on the falling edge of e, with rs / rw / data taken at that moment.
 *     rw = 0 writes (rs = 0 instruction, rs = 1 data); rw = 1 reads, the part then drives d0..d7
 *     while e is high (rs = 0: busy flag in d7 and the address counter, rs = 1: the data at the
 *     address counter, which advances when e falls). Otherwise d0..d7 are inputs (Z).
 *     4-bit mode (function set with DL = 0): every byte is two transfers on d7..d4, high nibble
 *     first. Power-on state: 8-bit, 1 line, display off, increment, DDRAM cleared to spaces.
 *     Instructions: clear (01), home (02), entry mode (04 + I/D·2 + S), display on/off (08 +
 *     D·4 + C·2 + B), cursor / display shift (10 + S/C·8 + R/L·4), function set (20 + DL·16 +
 *     N·8 + F·4), CGRAM address (40 + a), DDRAM address (80 + a). The busy flag is set for
 *     texec (tclear for clear / home) after an instruction or data transfer; transfers while
 *     busy are still accepted (lenient), so a slow-stepping learner circuit never loses data.
 *     DDRAM: 2-line mode uses addresses 00-27 (line 1) and 40-67 (line 2); 1-line mode 00-4F.
 *     Rows of a 4-line module show lines 1, 2, then the continuation of lines 1 and 2 (at
 *     column offset `cols`). The display shift moves the visible window over the 40-character
 *     lines.
 *   Outputs for the schematic (analog code nodes, volts = integer codes):
 *     c<k>  character code of visible cell k (row-major);
 *     st    1 (display on) + 2 (cursor) + 4 (blink) + 8 · (visible cursor cell + 1, 0 = none);
 *     g<8j + r>  row r (5 bits, bit 4 = leftmost dot) of custom character j (CGRAM).
 *   Writes happen only at accepted transient timepoints; an operating point shows the
 *   power-on screen.
 */
import { REF, Z, netlistError, range, type AnalogOutputSpec, type BehaviourFactory, type EvalIO } from './behaviour';

/** Analog output stage of the code nodes (instantaneous, 1 Ω). */
function codeOut(port: number): AnalogOutputSpec {
  return { port, lo: REF, hi: REF, span: 1, fullScale: 1 << 20, slew: 1e-12, delay: 0, rout: 1 };
}

/** Mutable controller state. */
export interface LcdState {
  ddram: Uint8Array;
  cgram: Uint8Array;
  ac: number;
  cgMode: boolean;
  inc: boolean;
  shiftOnWrite: boolean;
  displayOn: boolean;
  cursor: boolean;
  blink: boolean;
  shift: number;
  eightBit: boolean;
  twoLine: boolean;
  half: number;
  hi: number;
  busyUntil: number;
}

export function lcdPowerOn(): LcdState {
  return {
    ddram: new Uint8Array(128).fill(0x20),
    cgram: new Uint8Array(64),
    ac: 0,
    cgMode: false,
    inc: true,
    shiftOnWrite: false,
    displayOn: false,
    cursor: false,
    blink: false,
    shift: 0,
    eightBit: true,
    twoLine: false,
    half: 0,
    hi: 0,
    busyUntil: 0,
  };
}

function advance(s: LcdState, up: boolean): void {
  if (s.cgMode) {
    s.ac = (s.ac + (up ? 1 : 63)) & 63;
    return;
  }
  if (s.twoLine) {
    if (up) s.ac = s.ac === 0x27 ? 0x40 : s.ac === 0x67 ? 0x00 : s.ac + 1;
    else s.ac = s.ac === 0x00 ? 0x67 : s.ac === 0x40 ? 0x27 : s.ac - 1;
  } else s.ac = up ? (s.ac + 1) % 80 : (s.ac + 79) % 80;
}

/** Execute one instruction byte at time t. */
export function lcdInstruction(s: LcdState, b: number, t: number, texec: number, tclear: number): void {
  s.busyUntil = t + texec;
  if (b & 0x80) {
    s.cgMode = false;
    const a = b & 0x7f;
    s.ac = s.twoLine ? (a >= 0x40 ? 0x40 + Math.min(0x27, a - 0x40) : Math.min(0x27, a)) : Math.min(0x4f, a);
  } else if (b & 0x40) {
    s.cgMode = true;
    s.ac = b & 0x3f;
  } else if (b & 0x20) {
    s.eightBit = (b & 0x10) !== 0;
    s.twoLine = (b & 0x08) !== 0;
    s.half = 0;
  } else if (b & 0x10) {
    const display = (b & 0x08) !== 0;
    const right = (b & 0x04) !== 0;
    if (display) s.shift = (s.shift + (right ? 79 : 1)) % 80;
    else advance(s, right);
  } else if (b & 0x08) {
    s.displayOn = (b & 0x04) !== 0;
    s.cursor = (b & 0x02) !== 0;
    s.blink = (b & 0x01) !== 0;
  } else if (b & 0x04) {
    s.inc = (b & 0x02) !== 0;
    s.shiftOnWrite = (b & 0x01) !== 0;
  } else if (b & 0x02) {
    s.cgMode = false;
    s.ac = 0;
    s.shift = 0;
    s.busyUntil = t + tclear;
  } else if (b & 0x01) {
    s.ddram.fill(0x20);
    s.cgMode = false;
    s.ac = 0;
    s.shift = 0;
    s.inc = true;
    s.busyUntil = t + tclear;
  }
}

/** Write one data byte (DDRAM or CGRAM at the address counter). */
export function lcdWrite(s: LcdState, b: number, t: number, texec: number): void {
  s.busyUntil = t + texec;
  if (s.cgMode) s.cgram[s.ac] = b & 0x1f;
  else {
    s.ddram[s.ac] = b;
    if (s.shiftOnWrite) s.shift = (s.shift + (s.inc ? 1 : 79)) % 80;
  }
  advance(s, s.inc);
}

/** DDRAM address shown at visible cell (row, col). */
export function lcdCellAddress(s: Pick<LcdState, 'twoLine' | 'shift'>, row: number, col: number, cols: number, rows: number): number {
  if (!s.twoLine || rows === 1) return (col + (rows > 2 ? Math.floor(row / 2) * cols : 0) + s.shift) % 80;
  const line = row % 2;
  const offset = rows > 2 ? Math.floor(row / 2) * cols : 0;
  return line * 0x40 + ((col + offset + s.shift) % 40);
}

const lcd: BehaviourFactory = (ctx) => {
  const cols = ctx.p.int('cols', 16);
  const rows = ctx.p.int('rows', 2);
  if (!(cols >= 1 && cols <= 40) || !(rows >= 1 && rows <= 4) || (rows > 2 && cols > 20)) throw netlistError(ctx.name, `unsupported LCD size ${cols} x ${rows}`);
  const cells = cols * rows;
  const expected = 11 + cells + 1 + 64;
  if (ctx.ports !== expected) throw netlistError(ctx.name, `expected ${expected} port nodes (rs rw e d0..d7 c.. st g..), got ${ctx.ports}`);
  const texec = ctx.p.nonNeg('texec', 37e-6);
  const tclear = ctx.p.nonNeg('tclear', 1.52e-3);
  let s = lcdPowerOn();
  const readValue = (io: EvalIO, rs: number): number => {
    if (rs === 0) return ((io.now < s.busyUntil ? 1 : 0) << 7) | (s.ac & 0x7f);
    return s.cgMode ? s.cgram[s.ac] : s.ddram[s.ac];
  };
  const visible = (row: number, col: number) => s.ddram[lcdCellAddress(s, row, col, cols, rows)];
  const cursorCell = (): number => {
    if (s.cgMode) return -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (lcdCellAddress(s, r, c, cols, rows) === s.ac) return r * cols + c;
    return -1;
  };
  const transfer = (io: EvalIO, t: number) => {
    const rs = io.at(0, t);
    const rw = io.at(1, t);
    const bus = (k: number) => io.at(3 + k, t);
    let byte = 0;
    for (let k = 7; k >= 0; k--) byte = byte * 2 + bus(k);
    if (!s.eightBit) {
      const nibble = byte >> 4;
      if (s.half === 0) {
        s.hi = nibble;
        s.half = 1;
        return;
      }
      s.half = 0;
      byte = rw === 1 ? 0 : (s.hi << 4) | nibble;
    }
    if (rw === 1) {
      if (rs === 1) advance(s, s.inc);
      return;
    }
    if (rs === 0) lcdInstruction(s, byte, t, texec, tclear);
    else lcdWrite(s, byte, t, texec);
  };
  return {
    inputs: range(0, 11),
    outputs: range(3, 8).map((port) => ({ port })),
    aoutputs: range(11, cells + 1 + 64).map(codeOut),
    state: 0,
    init() {
      s = lcdPowerOn();
    },
    eval(io) {
      if (!io.dc && io.falling(2)) {
        const t = io.cross[2];
        io.setTime(t);
        transfer(io, t);
      }
      // read: the part drives the bus while e is high and rw is high
      if (io.in[2] === 1 && io.in[1] === 1) {
        let v = readValue(io, io.in[0]);
        if (!s.eightBit) v = s.half === 0 ? v >> 4 : v & 15;
        for (let k = 0; k < 8; k++) io.out[k] = s.eightBit ? (v >> k) & 1 : k >= 4 ? (v >> (k - 4)) & 1 : Z;
      } else for (let k = 0; k < 8; k++) io.out[k] = Z;
      let i = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) io.aout[i++] = visible(r, c);
      const cur = cursorCell();
      io.aout[i++] = (s.displayOn ? 1 : 0) + (s.cursor ? 2 : 0) + (s.blink ? 4 : 0) + 8 * (cur + 1);
      for (let k = 0; k < 64; k++) io.aout[i++] = s.cgram[k];
    },
  };
};

export const DISPLAY_BEHAVIOURS: Record<string, BehaviourFactory> = { D_LCD: lcd };
