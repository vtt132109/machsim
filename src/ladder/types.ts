/**
 * Ladder-diagram document model (IEC 61131-3 style relay logic, written for MachSim).
 *
 * CONTRACT FILE — a ladder sheet of a design (`Sheet.kind = 'ladder'`, `Sheet.ladder`) is a list
 * of {@link LadderRung}s. Additive changes only; every new field must be optional so older
 * .msim files keep loading.
 *
 * A rung is read like a real ladder diagram: power flows from the left rail through the rung's
 * `logic` to the outputs on the right rail. The logic is a tree instead of a cell grid, which is
 * exactly how a learner reads it out loud:
 *
 *   series   = "AND": contacts one after another   ──┤ ├──┤/├──
 *   parallel = "OR":  contacts above each other    ──┤ ├──┬──
 *                                                  ──┤ ├──┘
 *
 * Addresses are plain text so they can be typed and read:
 *   I0.0 … I7.7   input channels  (an input module of the schematic, "I" = input)
 *   Q0.0 … Q7.7   output channels (an output module drives these pins)
 *   M0.0 … M15.7  internal bits (memory, no pins)
 *   T1 … T32      timer done bit;    T1.ET = elapsed seconds (a number)
 *   C1 … C32      counter done bit;  C1.CV = present count (a number)
 *   AI0 … AI7     analog input channel in volts (a number, analog input module)
 *   AQ0 … AQ3     analog output channel in volts (a number, analog output module); written by
 *                 MOV / ADD / SUB / MUL / DIV, can also be read back in a comparison
 *   MW0 … MW31    memory words: signed 16-bit integers (−32768 … 32767); written by MOV / ADD / SUB /
 *                 MUL / DIV (a result outside the range wraps round, like a real controller), read in
 *                 a comparison or as an operand
 *
 * Numbers in a comparison may be an address of the number kind (T1.ET, C1.CV, AI0) or a literal
 * in user-number syntax ("2.5", "1k", "4,7" — src/util/units.ts parseUserNumber).
 */

/** What a contact tests: closed when on / closed when off / one scan on a 0→1 or 1→0 change. */
export type LadderContactKind = 'no' | 'nc' | 'rising' | 'falling';

/** Comparison of a contact that compares two numbers. */
export type LadderCompareOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

/** One element of a rung's logic (left of the coils). */
export type LadderNode =
  /** contact on a bit address: `type` says how it is drawn and what it tests */
  | { kind: 'contact'; type: LadderContactKind; address: string; comment?: string }
  /** comparison contact: conducts while `left <op> right` holds */
  | { kind: 'compare'; op: LadderCompareOp; left: string; right: string; comment?: string }
  /** every item in a row (AND) */
  | { kind: 'series'; items: LadderNode[] }
  /** items stacked over each other (OR) */
  | { kind: 'parallel'; items: LadderNode[] };

/**
 * What a rung does when power reaches its right end.
 *   coil      the bit follows the rung (1 while the rung conducts)
 *   coil-not  the bit is the inverse of the rung
 *   set       the bit is latched to 1 and stays (S)
 *   reset     the bit is cleared to 0 and stays (R)
 *   ton       on-delay timer: `preset` seconds after the rung became true the timer's done bit
 *             goes 1; a false rung clears the timer at once
 *   tof       off-delay timer: the done bit goes 1 with the rung and stays `preset` seconds after
 *             the rung became false
 *   ctu       count-up counter: +1 on every 0→1 change of the rung, done when count >= preset
 *   ctd       count-down counter: −1 on every 0→1 change, done when the count reaches 0
 *   creset    reset a counter: while the rung is true the counter goes back to its start value
 *             (0 for count-up, `preset` for count-down) and its done bit clears
 *   mov       while the rung is true: `address` (a word MWn or an analog output AQn) = `a`
 *   add sub mul div
 *             while the rung is true: `address` = `a` + / − / × / ÷ `b` (div by zero writes nothing).
 *             These run on EVERY scan the rung carries power: put a rising-edge contact in front for
 *             "once per press"
 *   call      while the rung is true the function block `block` runs as the instance named
 *             `address` (FB1, MOTOR1 …) with the formal parameters of the block tied to the actual
 *             addresses of `args`; see {@link LadderBlock}
 */
export type LadderOutputKind =
  | 'coil'
  | 'coil-not'
  | 'set'
  | 'reset'
  | 'ton'
  | 'tof'
  | 'ctu'
  | 'ctd'
  | 'creset'
  | 'mov'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'call';

/** One coil / timer / counter on the right rail of a rung. */
export interface LadderOutput {
  kind: LadderOutputKind;
  /** bit address (coils) or timer / counter name (T1, C2) */
  address: string;
  /** timers: seconds; counters: counts — user-number text ("3", "500m", "1,5") */
  preset?: string;
  /** mov / add / sub / mul / div: first operand (a number, MWn, AIn, AQn, T1.ET, C1.CV) */
  a?: string;
  /** add / sub / mul / div: second operand */
  b?: string;
  /** call: name of the function block */
  block?: string;
  /** call: formal parameter name → actual address or operand */
  args?: Record<string, string>;
  comment?: string;
}

/** One rung: the logic left of the rail and the coils on it. */
export interface LadderRung {
  id: string;
  /** what this rung is for, shown above it (learner's own words) */
  comment?: string;
  /** the logic; absent = the rung is always true (an unconditional coil) */
  logic?: LadderNode;
  outputs: LadderOutput[];
  /** kept in the file but skipped by the scan (a learner trying something out) */
  disabled?: boolean;
}

/**
 * A user function block: a named piece of ladder program with its own inputs, outputs and rungs,
 * reusable by any number of `call` coils. Stored in `Design.ladderBlocks`.
 *
 * Inside the rungs of a block:
 *   - the names listed in `inputs` / `outputs` are the formal parameters; the call ties each one to
 *     an actual address (`I0.0`, `M1.0`, `MW3`, `AI0`, a number …)
 *   - `EN` is an implicit input that is on while the calling rung carries power; every rung of the
 *     block only has power while `EN` is on, so a block that is not called does nothing
 *   - names starting with `#` are the instance's own memory: `#latch` is a private bit, `#T1` /
 *     `#C1` a private timer / counter, `#W1` a private word. Two instances of one block never
 *     share them, which is the point of a block with a memory
 *   - any other address (I0.0, Q1.2 …) is the real, global one
 * Blocks may call other blocks, up to {@link LADDER_LIMITS.blockDepth} deep and never in a circle.
 */
export interface LadderBlock {
  id: string;
  /** identifier the call refers to (letters, digits, _; unique, case-insensitive) */
  name: string;
  /** what the block is for, in the learner's words */
  comment?: string;
  /** formal input names */
  inputs: string[];
  /** formal output names */
  outputs: string[];
  rungs: LadderRung[];
}

/** Highest address of each area, so a module / editor can check an address is in range. */
export const LADDER_LIMITS = {
  /** input / output bytes (I0 … I7, Q0 … Q7) */
  ioBytes: 8,
  /** memory bytes (M0 … M15) */
  memBytes: 16,
  timers: 32,
  counters: 32,
  analogInputs: 8,
  analogOutputs: 4,
  /** memory words MW0 … MW31 */
  words: 32,
  /** nesting depth of block calls */
  blockDepth: 4,
  /** hidden bits, timers, counters and words the instances of function blocks may add */
  localBits: 512,
  timersTotal: 160,
  countersTotal: 160,
  wordsTotal: 256,
} as const;
