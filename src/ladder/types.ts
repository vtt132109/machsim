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
 */
export type LadderOutputKind = 'coil' | 'coil-not' | 'set' | 'reset' | 'ton' | 'tof' | 'ctu' | 'ctd' | 'creset';

/** One coil / timer / counter on the right rail of a rung. */
export interface LadderOutput {
  kind: LadderOutputKind;
  /** bit address (coils) or timer / counter name (T1, C2) */
  address: string;
  /** timers: seconds; counters: counts — user-number text ("3", "500m", "1,5") */
  preset?: string;
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

/** Highest address of each area, so a module / editor can check an address is in range. */
export const LADDER_LIMITS = {
  /** input / output bytes (I0 … I7, Q0 … Q7) */
  ioBytes: 8,
  /** memory bytes (M0 … M15) */
  memBytes: 16,
  timers: 32,
  counters: 32,
  analogInputs: 8,
} as const;
