/**
 * Ladder scan machine: the part of a programmable controller that is not electrical.
 *
 * One scan, exactly like a real PLC:
 *   1. **read the inputs** — every digital input channel is thresholded (with hysteresis) from the
 *      pin voltage sampled at the scan boundary and written into the input image;
 *   2. **run the rungs** top to bottom — a rung reads the images as they are *now*, so a coil set
 *      by rung 1 is already seen by rung 2 (scan order matters, and a test pins it down);
 *   3. **write the outputs** — the output image drives the output pins.
 *
 * Scans happen at a fixed period (`LadderIR.scan`, default 10 ms), so timers accumulate exact
 * multiples of that period and a program behaves the same in every run. The time resolution of a
 * timer is therefore one scan — the same trade-off a real controller makes.
 *
 * Timers
 *   TON  the timer starts on the scan the rung becomes true and its done bit goes 1 exactly
 *        `preset` seconds later; a false rung clears it at once.
 *   TOF  the done bit follows the rung up immediately and falls `preset` seconds after the rung
 *        went false.
 * "Exactly" means exactly: a timer counts **scans** (integers), not a running floating-point sum.
 * Ten additions of 0.01 give 0.09999999999999999, which is less than 0.1, so a 100 ms timer on a
 * 10 ms scan used to need an eleventh scan — and the elapsed time never equalled the preset the
 * learner typed, so a `T1.ET = 0.1` comparison contact could not fire. The done bit now falls
 * after `round(preset / scan)` scans and the elapsed time is the preset itself once it is reached.
 * Word instructions (MOV / ADD / SUB / MUL / DIV)
 *   While their rung carries power they run on every scan: `dest = a <op> b`. A memory word (MWn) is a
 *   signed 16-bit integer: the result is rounded to the nearest integer (a division truncates toward
 *   zero, like an integer division in a controller) and a result outside -32768 ... 32767 wraps
 *   round. An analog output (AQn) keeps the exact value in volts. Division by zero writes nothing
 *   and counts in `mathErrors`.
 * Counters
 *   CTU  +1 on every 0→1 change of its rung, done when the count reaches the preset;
 *   CTD  −1 on every 0→1 change, starts at the preset, done when the count reaches 0;
 *   RES  while its rung is true the counter goes back to its start value and the done bit clears.
 *
 * Pure module: no engine, no DOM, no i18n. The `A_LADDER` code model
 * (src/sim/devices/digital/ladder.ts) owns one machine per element; the ladder editor runs a
 * second one on its own ("test the program without the circuit").
 */
import type { LadderOutputKind } from './types';
import type { BitArea, BitRef, ExprIR, LadderIR, NumRef, OutputIR, RungIR } from './program';
import { LADDER_LIMITS } from './types';

/** Wrap a number into a signed 16-bit word (the value of an integer register of a controller). */
export function toWord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // nearest integer, a tie goes away from zero (2.5 -> 3, -2.5 -> -3)
  const r = Math.sign(value) * Math.round(Math.abs(value));
  const w = (((r % 65536) + 65536) % 65536) | 0;
  return w >= 32768 ? w - 65536 : w;
}

/** Bits packed into one probe word (well inside the exact-integer range of a double). */
export const SLOT_BITS = 24;

/** Live state of one timer. */
export interface TimerState {
  elapsed: number;
  done: boolean;
  running: boolean;
}

export class LadderMachine {
  readonly ir: LadderIR;
  /** input image, one byte per bit (index = byte·8 + bit) */
  readonly inputs: Uint8Array;
  readonly outputs: Uint8Array;
  readonly mem: Uint8Array;
  /** hidden bits of function-block instances (enable bits, private memory) */
  readonly local: Uint8Array;
  /** analog input channels, volts */
  readonly analog: Float64Array;
  /** memory words MW0 ... (signed 16-bit integers) */
  readonly words: Float64Array;
  /** analog output channels AQ0 ..., volts */
  readonly analogOut: Float64Array;
  readonly timerDone: Uint8Array;
  readonly counterDone: Uint8Array;
  readonly timerElapsed: Float64Array;
  readonly counterValue: Float64Array;
  /** scans run since reset */
  scans = 0;
  /** divisions by zero met since reset */
  mathErrors = 0;
  /** simulated time of the last scan, seconds */
  time = 0;

  private readonly timerRunning: Uint8Array;
  /** scans a running timer has counted (integers: no floating-point drift) */
  private readonly timerScans: Float64Array;
  private readonly edgeMem: Uint8Array;
  /** rung value of the previous scan, by element slot (counter edges, diagnostics) */
  private readonly slotPrev: Uint8Array;
  /** conducting state of every element slot of the last scan (live highlighting) */
  private readonly slotState: Uint8Array;
  /** pin voltage of every element port, as sampled at the scan boundary */
  private readonly portVolts: Float64Array;
  /** logic value of every digital input port (hysteresis memory) */
  private readonly portLogic: Uint8Array;

  constructor(ir: LadderIR) {
    this.ir = ir;
    this.inputs = new Uint8Array(64);
    this.outputs = new Uint8Array(64);
    this.mem = new Uint8Array(128);
    this.local = new Uint8Array(LADDER_LIMITS.localBits);
    this.analog = new Float64Array(16);
    this.words = new Float64Array(LADDER_LIMITS.wordsTotal);
    this.analogOut = new Float64Array(8);
    this.timerDone = new Uint8Array(Math.max(1, ir.timers));
    this.counterDone = new Uint8Array(Math.max(1, ir.counters));
    this.timerElapsed = new Float64Array(Math.max(1, ir.timers));
    this.counterValue = new Float64Array(Math.max(1, ir.counters));
    this.timerRunning = new Uint8Array(Math.max(1, ir.timers));
    this.timerScans = new Float64Array(Math.max(1, ir.timers));
    this.edgeMem = new Uint8Array(Math.max(1, ir.edges));
    this.slotPrev = new Uint8Array(Math.max(1, ir.slots));
    this.slotState = new Uint8Array(Math.max(1, ir.slots));
    this.portVolts = new Float64Array(Math.max(1, ir.ports.length));
    this.portLogic = new Uint8Array(Math.max(1, ir.ports.length));
    this.reset();
  }

  /** Power-up state: images clear, timers idle, counters at their start value, outputs off. */
  reset(): void {
    this.inputs.fill(0);
    this.outputs.fill(0);
    this.mem.fill(0);
    this.local.fill(0);
    this.analog.fill(0);
    this.words.fill(0);
    this.analogOut.fill(0);
    this.mathErrors = 0;
    this.timerDone.fill(0);
    this.timerElapsed.fill(0);
    this.timerRunning.fill(0);
    this.timerScans.fill(0);
    this.counterDone.fill(0);
    this.edgeMem.fill(0);
    this.slotPrev.fill(0);
    this.slotState.fill(0);
    this.portVolts.fill(0);
    this.portLogic.fill(0);
    for (let k = 0; k < this.ir.counters; k++) this.counterValue[k] = this.ir.counterInit[k] ?? 0;
    this.scans = 0;
    this.time = 0;
  }

  // -----------------------------------------------------------------------------------------
  // channels

  /** Pin voltage of an element port (called just before a scan). */
  setPortVoltage(port: number, volts: number): void {
    if (port >= 0 && port < this.portVolts.length) this.portVolts[port] = volts;
  }

  /** Voltage an output port drives (0 when the port is not an output channel). */
  portOutput(port: number): number {
    const p = this.ir.ports[port];
    if (!p) return 0;
    if (p.kind === 'aq') {
      const v = p.index < this.analogOut.length ? this.analogOut[p.index] : 0;
      return Math.max(-Math.abs(p.vmax), Math.min(Math.abs(p.vmax), v));
    }
    if (p.kind !== 'q') return 0;
    return this.outputs[p.index] ? p.von : 0;
  }

  /** Force an input channel (the editor's "test without the circuit" mode). */
  setInputBit(index: number, value: 0 | 1): void {
    if (index >= 0 && index < this.inputs.length) this.inputs[index] = value;
  }

  /** Force an analog channel (test mode). */
  setAnalog(channel: number, volts: number): void {
    if (channel >= 0 && channel < this.analog.length) this.analog[channel] = volts;
  }

  private sampleInputs(): void {
    const ports = this.ir.ports;
    for (let k = 0; k < ports.length; k++) {
      const p = ports[k];
      const v = this.portVolts[k];
      if (p.kind === 'ai') {
        this.analog[p.index] = v;
      } else if (p.kind === 'di') {
        const hi = p.vth + p.vhys / 2;
        const lo = p.vth - p.vhys / 2;
        const prev = this.portLogic[k];
        const next = v > hi ? 1 : v < lo ? 0 : prev;
        this.portLogic[k] = next;
        this.inputs[p.index] = next;
      }
    }
  }

  // -----------------------------------------------------------------------------------------
  // reading values

  private area(area: BitArea): Uint8Array {
    switch (area) {
      case 'I':
        return this.inputs;
      case 'Q':
        return this.outputs;
      case 'M':
        return this.mem;
      case 'L':
        return this.local;
      case 'TD':
        return this.timerDone;
      default:
        return this.counterDone;
    }
  }

  /** Present value of a bit address. */
  bit(ref: BitRef): 0 | 1 {
    const a = this.area(ref.area);
    return ref.index < a.length && a[ref.index] ? 1 : 0;
  }

  private setBit(ref: BitRef, value: 0 | 1): void {
    const a = this.area(ref.area);
    if (ref.index < a.length) a[ref.index] = value;
  }

  private numberOf(ref: NumRef): number {
    switch (ref.kind) {
      case 'const':
        return ref.value;
      case 'et':
        return ref.n < this.timerElapsed.length ? this.timerElapsed[ref.n] : 0;
      case 'cv':
        return ref.n < this.counterValue.length ? this.counterValue[ref.n] : 0;
      case 'mw':
        return ref.n < this.words.length ? this.words[ref.n] : 0;
      case 'aq':
        return ref.n < this.analogOut.length ? this.analogOut[ref.n] : 0;
      default:
        return ref.n < this.analog.length ? this.analog[ref.n] : 0;
    }
  }

  private evalExpr(e: ExprIR): 0 | 1 {
    switch (e.k) {
      case 'bit': {
        const now = this.bit(e.ref);
        let on: 0 | 1;
        if (e.edge === 0) on = e.invert ? ((1 - now) as 0 | 1) : now;
        else {
          const prev = this.edgeMem[e.mem];
          on = e.edge === 1 ? (now === 1 && prev === 0 ? 1 : 0) : now === 0 && prev === 1 ? 1 : 0;
          this.edgeMem[e.mem] = now;
        }
        this.slotState[e.slot] = on;
        return on;
      }
      case 'cmp': {
        const a = this.numberOf(e.a);
        const b = this.numberOf(e.b);
        let on: boolean;
        switch (e.op) {
          case 'eq':
            on = a === b;
            break;
          case 'ne':
            on = a !== b;
            break;
          case 'lt':
            on = a < b;
            break;
          case 'le':
            on = a <= b;
            break;
          case 'gt':
            on = a > b;
            break;
          default:
            on = a >= b;
        }
        const v: 0 | 1 = on ? 1 : 0;
        this.slotState[e.slot] = v;
        return v;
      }
      case 'and': {
        // every branch is evaluated (edge contacts must see every scan), then AND-ed
        let all: 0 | 1 = 1;
        for (const item of e.items) if (!this.evalExpr(item)) all = 0;
        return all;
      }
      default: {
        let any: 0 | 1 = 0;
        for (const item of e.items) if (this.evalExpr(item)) any = 1;
        return any;
      }
    }
  }

  // -----------------------------------------------------------------------------------------
  // outputs

  /** Scans a preset of `preset` seconds takes at a scan period of `dt` (at least 0). */
  private static scansFor(preset: number, dt: number): number {
    if (!(dt > 0) || !(preset > 0)) return 0;
    return Math.max(0, Math.round(preset / dt));
  }

  /** Advance a running timer by one scan and write its elapsed time (exactly `preset` once done). */
  private tick(n: number, preset: number, need: number, dt: number): boolean {
    if (this.timerScans[n] < need) this.timerScans[n] += 1;
    const done = this.timerScans[n] >= need;
    this.timerElapsed[n] = done ? preset : this.timerScans[n] * dt;
    return done;
  }

  private runTimer(o: OutputIR, power: 0 | 1, dt: number): void {
    const n = o.timer!;
    if (n >= this.timerDone.length) return;
    const need = LadderMachine.scansFor(o.preset, dt);
    if (o.kind === 'ton') {
      if (power) {
        if (!this.timerRunning[n]) {
          this.timerRunning[n] = 1;
          this.timerScans[n] = 0;
          this.timerElapsed[n] = need > 0 ? 0 : o.preset;
          this.timerDone[n] = need > 0 ? 0 : 1;
        } else this.timerDone[n] = this.tick(n, o.preset, need, dt) ? 1 : 0;
      } else {
        this.timerRunning[n] = 0;
        this.timerScans[n] = 0;
        this.timerElapsed[n] = 0;
        this.timerDone[n] = 0;
      }
      return;
    }
    // off-delay
    if (power) {
      this.timerRunning[n] = 0;
      this.timerScans[n] = 0;
      this.timerElapsed[n] = 0;
      this.timerDone[n] = 1;
    } else if (this.timerDone[n]) {
      if (!this.timerRunning[n]) {
        this.timerRunning[n] = 1;
        this.timerScans[n] = 0;
        this.timerElapsed[n] = need > 0 ? 0 : o.preset;
        if (need === 0) {
          this.timerDone[n] = 0;
          this.timerRunning[n] = 0;
        }
      } else if (this.tick(n, o.preset, need, dt)) {
        this.timerDone[n] = 0;
        this.timerRunning[n] = 0;
      }
    }
  }

  private runCounter(o: OutputIR, power: 0 | 1): void {
    const n = o.counter!;
    if (n >= this.counterDone.length) return;
    if (o.kind === 'creset') {
      if (power) {
        this.counterValue[n] = this.ir.counterInit[n] ?? 0;
        this.counterDone[n] = 0;
      }
      return;
    }
    const rose = power === 1 && this.slotPrev[o.slot] === 0;
    this.slotPrev[o.slot] = power;
    if (o.kind === 'ctu') {
      if (rose) this.counterValue[n] = Math.min(1e9, this.counterValue[n] + 1);
      this.counterDone[n] = this.counterValue[n] >= o.preset ? 1 : 0;
    } else {
      if (rose) this.counterValue[n] = Math.max(0, this.counterValue[n] - 1);
      this.counterDone[n] = this.counterValue[n] <= 0 ? 1 : 0;
    }
  }

  /** Run a mov / add / sub / mul / div while its rung carries power. */
  private runWordOutput(o: OutputIR): void {
    const dest = o.dest!;
    const a = this.numberOf(o.a!);
    let result: number;
    if (o.kind === 'mov') result = a;
    else {
      const b = this.numberOf(o.b!);
      switch (o.kind) {
        case 'add':
          result = a + b;
          break;
        case 'sub':
          result = a - b;
          break;
        case 'mul':
          result = a * b;
          break;
        default:
          if (b === 0) {
            this.mathErrors++;
            return;
          }
          // a division into a word truncates toward zero, an analog output keeps the exact quotient
          result = dest.area === 'mw' ? Math.trunc(a / b) : a / b;
      }
    }
    if (dest.area === 'mw') {
      if (dest.n < this.words.length) this.words[dest.n] = toWord(result);
    } else if (dest.n < this.analogOut.length) this.analogOut[dest.n] = Number.isFinite(result) ? result : 0;
  }

  private runOutput(o: OutputIR, power: 0 | 1, dt: number): void {
    this.slotState[o.slot] = power;
    const kind: LadderOutputKind = o.kind;
    if (kind === 'mov' || kind === 'add' || kind === 'sub' || kind === 'mul' || kind === 'div') {
      if (power) this.runWordOutput(o);
      return;
    }
    if (kind === 'ton' || kind === 'tof') {
      this.runTimer(o, power, dt);
      return;
    }
    if (kind === 'ctu' || kind === 'ctd' || kind === 'creset') {
      this.runCounter(o, power);
      return;
    }
    const ref = o.ref!;
    if (kind === 'coil') this.setBit(ref, power);
    else if (kind === 'coil-not') this.setBit(ref, power ? 0 : 1);
    else if (kind === 'set') {
      if (power) this.setBit(ref, 1);
    } else if (power) this.setBit(ref, 0);
  }

  private runRung(r: RungIR, dt: number): void {
    const power: 0 | 1 = r.expr ? this.evalExpr(r.expr) : 1;
    this.slotState[r.slot] = power;
    for (const o of r.outputs) this.runOutput(o, power, dt);
  }

  /**
   * One scan: sample the inputs, run every rung in order, leave the outputs in the output image.
   * `now` is the simulated time of this scan (only recorded, the timers use the scan period).
   */
  scan(now = this.time + this.ir.scan): void {
    this.sampleInputs();
    const dt = this.ir.scan;
    for (const r of this.ir.rungs) this.runRung(r, dt);
    this.scans++;
    this.time = now;
  }

  /** Conducting state of an element slot in the last scan (live highlighting). */
  slot(index: number): 0 | 1 {
    return index >= 0 && index < this.slotState.length && this.slotState[index] ? 1 : 0;
  }

  /** Element states packed `SLOT_BITS` to a word, as the probe vectors carry them. */
  slotWord(word: number): number {
    let v = 0;
    const base = word * SLOT_BITS;
    for (let k = SLOT_BITS - 1; k >= 0; k--) {
      const i = base + k;
      v = v * 2 + (i < this.ir.slots ? this.slot(i) : 0);
    }
    return v;
  }

  /** One image byte (bits 0…7 of byte `n` of the area). */
  imageByte(area: BitArea, n: number): number {
    const a = this.area(area);
    let v = 0;
    for (let k = 7; k >= 0; k--) {
      const i = n * 8 + k;
      v = v * 2 + (i < a.length ? a[i] : 0);
    }
    return v;
  }
}
