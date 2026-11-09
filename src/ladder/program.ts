/**
 * Ladder program: addresses, compiler and the compiled form the scan machine runs.
 *
 * Pure module (no engine, no DOM, no i18n) shared by
 *   - the editor (src/ui/ladder) — it compiles while the learner types to show problems and to
 *     know which element lights up when the program runs,
 *   - the netlister (src/model/ladderBuild.ts) — it compiles the ladder sheets of a design, adds
 *     the channel map of the placed I/O modules and puts the JSON text on the code-model card,
 *   - the scan machine (machine.ts) and the `A_LADDER` code model.
 *
 * Compiling resolves every address text into an index, numbers the elements so the editor and
 * the machine agree on which element is which (`slot`), and allocates one edge memory per
 * edge-sensitive contact. Problems come back as structured {@link LadderError}s (rung number +
 * code), which src/i18n/ladderText.ts turns into a Vietnamese or English sentence.
 */
import { parseUserNumber } from '../util/units';
import { LADDER_LIMITS, type LadderCompareOp, type LadderNode, type LadderOutput, type LadderOutputKind, type LadderRung } from './types';

/** Bit areas the machine keeps: inputs, outputs, memory, timer done bits, counter done bits. */
export type BitArea = 'I' | 'Q' | 'M' | 'TD' | 'CD';

/** A resolved bit address: `index` is byte·8 + bit for I / Q / M, and n − 1 for T / C done bits. */
export interface BitRef {
  area: BitArea;
  index: number;
}

/** A resolved number operand of a comparison. */
export type NumRef =
  | { kind: 'const'; value: number }
  /** elapsed time of timer `n` (0-based), seconds */
  | { kind: 'et'; n: number }
  /** present value of counter `n` (0-based) */
  | { kind: 'cv'; n: number }
  /** analog input channel, volts */
  | { kind: 'ai'; n: number };

/** Compiled rung logic. */
export type ExprIR =
  | { k: 'bit'; ref: BitRef; invert: boolean; edge: 0 | 1 | -1; slot: number; mem: number }
  | { k: 'cmp'; op: LadderCompareOp; a: NumRef; b: NumRef; slot: number }
  | { k: 'and'; items: ExprIR[] }
  | { k: 'or'; items: ExprIR[] };

/** Compiled coil / timer / counter. */
export interface OutputIR {
  kind: LadderOutputKind;
  /** bit written by a coil (null for timer / counter outputs, which write their own done bit) */
  ref: BitRef | null;
  /** timer index (ton / tof) */
  timer?: number;
  /** counter index (ctu / ctd / creset) */
  counter?: number;
  /** seconds (timers) or counts (counters) */
  preset: number;
  slot: number;
}

export interface RungIR {
  /** position in the program (0-based), for messages */
  index: number;
  /** null = always true */
  expr: ExprIR | null;
  outputs: OutputIR[];
  /** slot of the rung itself (power reaching the right rail) */
  slot: number;
}

/** One element port of the `A_LADDER` netlist element (filled by the netlister). */
export type LadderPort =
  /** analog input channel `index` (volts, read as a number) */
  | { kind: 'ai'; index: number }
  /** digital input channel: bit `index` of the input image, thresholded by the machine */
  | { kind: 'di'; index: number; vth: number; vhys: number }
  /** output channel: bit `index` of the output image drives this pin */
  | { kind: 'q'; index: number; von: number };

/** Everything the scan machine needs. */
export interface LadderIR {
  rungs: RungIR[];
  /** edge memories to allocate */
  edges: number;
  /** element slots (contacts, outputs and rungs), for live highlighting */
  slots: number;
  /** timers used (0-based count) */
  timers: number;
  /** counters used (0-based count) */
  counters: number;
  /** start value of each counter (preset for a count-down counter, 0 for a count-up one) */
  counterInit: number[];
  /** scan period in seconds */
  scan: number;
  /** element ports, in node order (netlister) */
  ports: LadderPort[];
}

/** A problem found while compiling. */
export interface LadderError {
  /** rung number, 1-based (0 = the program as a whole) */
  rung: number;
  code: LadderErrorCode;
  /** the text that could not be read */
  text?: string;
  /** limit / value mentioned by the message */
  limit?: number;
}

export type LadderErrorCode =
  | 'badAddress'
  | 'notBit'
  | 'notNumber'
  | 'writeInput'
  | 'writeTimerBit'
  | 'badPreset'
  | 'presetRequired'
  | 'emptyGroup'
  | 'noOutput'
  | 'range';

export const SCAN_MIN = 1e-4;
export const SCAN_MAX = 1;
export const SCAN_DEFAULT = 0.01;

/**
 * Element slots reserved for one rung. A slot is the address of one drawn element in the live
 * highlighting, and it is computed from the rung number alone (`rung · SLOTS_PER_RUNG + k`), so
 * the editor and the compiled program agree without passing a table around: k counts the contacts
 * of the logic in reading order, then the coils, and the last slot of the block is the rung itself.
 */
export const SLOTS_PER_RUNG = 32;

/** Contacts plus coils one rung may hold (the last slot belongs to the rung). */
export const MAX_RUNG_ELEMENTS = SLOTS_PER_RUNG - 1;

/** Slot of element `k` of rung `rung` (0-based), and `rungSlot` for the rung itself. */
export function elementSlot(rung: number, k: number): number {
  return rung * SLOTS_PER_RUNG + k;
}

/** Slot that lights up when power reaches the right rail of rung `rung` (0-based). */
export function rungSlot(rung: number): number {
  return rung * SLOTS_PER_RUNG + SLOTS_PER_RUNG - 1;
}

const BIT_RE = /^([iqm])\s*(\d+)\s*\.\s*([0-7])$/i;
const TIMER_RE = /^t\s*(\d+)$/i;
const COUNTER_RE = /^c\s*(\d+)$/i;
const ET_RE = /^t\s*(\d+)\s*\.\s*et$/i;
const CV_RE = /^c\s*(\d+)\s*\.\s*cv$/i;
const AI_RE = /^ai\s*(\d+)$/i;

/** Upper bound (exclusive) of the bit index of an area. */
export function areaSize(area: BitArea): number {
  if (area === 'M') return LADDER_LIMITS.memBytes * 8;
  if (area === 'TD') return LADDER_LIMITS.timers;
  if (area === 'CD') return LADDER_LIMITS.counters;
  return LADDER_LIMITS.ioBytes * 8;
}

/**
 * Read a bit address: "I0.0", "Q1.3", "M2.7", "T1", "C4" (case and spaces are free).
 * Returns null when the text is not a bit address at all, and 'range' when it is one but too big.
 */
export function parseBitAddress(text: string): BitRef | null | 'range' {
  const s = text.trim();
  const m = BIT_RE.exec(s);
  if (m) {
    const area = m[1].toUpperCase() as 'I' | 'Q' | 'M';
    const index = Number(m[2]) * 8 + Number(m[3]);
    return index < areaSize(area) ? { area, index } : 'range';
  }
  const t = TIMER_RE.exec(s);
  if (t) {
    const n = Number(t[1]);
    return n >= 1 && n <= LADDER_LIMITS.timers ? { area: 'TD', index: n - 1 } : 'range';
  }
  const c = COUNTER_RE.exec(s);
  if (c) {
    const n = Number(c[1]);
    return n >= 1 && n <= LADDER_LIMITS.counters ? { area: 'CD', index: n - 1 } : 'range';
  }
  return null;
}

/** Address text of a bit reference ("I0.0", "T3"). */
export function formatBitAddress(ref: BitRef): string {
  if (ref.area === 'TD') return `T${ref.index + 1}`;
  if (ref.area === 'CD') return `C${ref.index + 1}`;
  return `${ref.area}${Math.floor(ref.index / 8)}.${ref.index % 8}`;
}

/**
 * Read a number operand: an address of the number kind (T1.ET, C2.CV, AI0) or a literal in
 * user-number syntax. Returns null when the text means nothing, 'range' when the index is too big.
 */
export function parseNumOperand(text: string): NumRef | null | 'range' {
  const s = text.trim();
  if (s === '') return null;
  const et = ET_RE.exec(s);
  if (et) {
    const n = Number(et[1]);
    return n >= 1 && n <= LADDER_LIMITS.timers ? { kind: 'et', n: n - 1 } : 'range';
  }
  const cv = CV_RE.exec(s);
  if (cv) {
    const n = Number(cv[1]);
    return n >= 1 && n <= LADDER_LIMITS.counters ? { kind: 'cv', n: n - 1 } : 'range';
  }
  const ai = AI_RE.exec(s);
  if (ai) {
    const n = Number(ai[1]);
    return n >= 0 && n < LADDER_LIMITS.analogInputs ? { kind: 'ai', n } : 'range';
  }
  const v = parseUserNumber(s);
  return Number.isFinite(v) ? { kind: 'const', value: v } : null;
}

/** Comparison symbol of an operator, for the editor and the drawing. */
export const COMPARE_SYMBOL: Record<LadderCompareOp, string> = {
  eq: '=',
  ne: '≠',
  lt: '<',
  le: '≤',
  gt: '>',
  ge: '≥',
};

/** Short code drawn in a coil box ("S", "R", "TON" …). */
export const OUTPUT_CODE: Record<LadderOutputKind, string> = {
  coil: '',
  'coil-not': '/',
  set: 'S',
  reset: 'R',
  ton: 'TON',
  tof: 'TOF',
  ctu: 'CTU',
  ctd: 'CTD',
  creset: 'RES',
};

/** True for an output that drives a timer. */
export function isTimerOutput(kind: LadderOutputKind): boolean {
  return kind === 'ton' || kind === 'tof';
}

/** True for an output that drives a counter. */
export function isCounterOutput(kind: LadderOutputKind): boolean {
  return kind === 'ctu' || kind === 'ctd' || kind === 'creset';
}

interface Builder {
  errors: LadderError[];
  /** rung being compiled (0-based) and the next element index inside it */
  rung: number;
  k: number;
  edges: number;
  timers: number;
  counters: number;
  counterInit: number[];
}

/** Next element slot of the rung being compiled. */
function nextSlot(b: Builder): number {
  const k = b.k++;
  return elementSlot(b.rung, Math.min(k, MAX_RUNG_ELEMENTS - 1));
}

function fail(b: Builder, rung: number, code: LadderErrorCode, text?: string, limit?: number): void {
  const e: LadderError = { rung, code };
  if (text !== undefined) e.text = text;
  if (limit !== undefined) e.limit = limit;
  b.errors.push(e);
}

function compileNode(b: Builder, rung: number, node: LadderNode): ExprIR | null {
  if (node.kind === 'series' || node.kind === 'parallel') {
    const items = node.items.map((n) => compileNode(b, rung, n)).filter((x): x is ExprIR => x !== null);
    if (items.length === 0) {
      fail(b, rung, 'emptyGroup');
      return null;
    }
    if (items.length === 1) return items[0];
    return node.kind === 'series' ? { k: 'and', items } : { k: 'or', items };
  }
  const slot = nextSlot(b);
  if (node.kind === 'compare') {
    const a = parseNumOperand(node.left);
    const c = parseNumOperand(node.right);
    if (a === null || a === 'range') {
      fail(b, rung, a === 'range' ? 'range' : 'notNumber', node.left);
      return null;
    }
    if (c === null || c === 'range') {
      fail(b, rung, c === 'range' ? 'range' : 'notNumber', node.right);
      return null;
    }
    return { k: 'cmp', op: node.op, a, b: c, slot };
  }
  const ref = parseBitAddress(node.address);
  if (ref === null || ref === 'range') {
    fail(b, rung, ref === 'range' ? 'range' : 'badAddress', node.address);
    return null;
  }
  const edge: 0 | 1 | -1 = node.type === 'rising' ? 1 : node.type === 'falling' ? -1 : 0;
  const mem = edge === 0 ? -1 : b.edges++;
  return { k: 'bit', ref, invert: node.type === 'nc', edge, slot, mem };
}

function compileOutput(b: Builder, rung: number, out: LadderOutput): OutputIR | null {
  const slot = nextSlot(b);
  const preset = out.preset === undefined || out.preset.trim() === '' ? NaN : parseUserNumber(out.preset);
  if (isTimerOutput(out.kind) || isCounterOutput(out.kind)) {
    const ref = parseBitAddress(out.address);
    if (ref === null || ref === 'range') {
      fail(b, rung, ref === 'range' ? 'range' : 'badAddress', out.address);
      return null;
    }
    const wantTimer = isTimerOutput(out.kind);
    if (wantTimer ? ref.area !== 'TD' : ref.area !== 'CD') {
      fail(b, rung, 'badAddress', out.address);
      return null;
    }
    if (out.kind !== 'creset') {
      if (!Number.isFinite(preset) || preset < 0) {
        fail(b, rung, out.preset === undefined || out.preset.trim() === '' ? 'presetRequired' : 'badPreset', out.preset);
        return null;
      }
    }
    const value = Number.isFinite(preset) && preset >= 0 ? preset : 0;
    if (wantTimer) {
      b.timers = Math.max(b.timers, ref.index + 1);
      return { kind: out.kind, ref: null, timer: ref.index, preset: value, slot };
    }
    b.counters = Math.max(b.counters, ref.index + 1);
    // a count-down counter starts at its preset; the largest preset seen wins
    if (out.kind === 'ctd') b.counterInit[ref.index] = Math.max(b.counterInit[ref.index] ?? 0, value);
    else if (b.counterInit[ref.index] === undefined) b.counterInit[ref.index] = 0;
    return { kind: out.kind, ref: null, counter: ref.index, preset: value, slot };
  }
  const ref = parseBitAddress(out.address);
  if (ref === null || ref === 'range') {
    fail(b, rung, ref === 'range' ? 'range' : 'badAddress', out.address);
    return null;
  }
  if (ref.area === 'I') {
    fail(b, rung, 'writeInput', out.address);
    return null;
  }
  if (ref.area === 'TD' || ref.area === 'CD') {
    fail(b, rung, 'writeTimerBit', out.address);
    return null;
  }
  return { kind: out.kind, ref, preset: 0, slot };
}

export interface CompileOptions {
  /** scan period in seconds (clamped to SCAN_MIN … SCAN_MAX) */
  scan?: number;
  /** element ports of the netlist element */
  ports?: LadderPort[];
}

export interface CompileResult {
  ir: LadderIR;
  errors: LadderError[];
}

/**
 * Compile the rungs of every ladder sheet of a design (already concatenated, in sheet order).
 * Rungs with a problem are left out of the compiled program, so the rest still runs: the editor
 * shows the problems and the simulation keeps going, which is what a learner needs.
 */
export function compileLadder(rungs: readonly LadderRung[], opts: CompileOptions = {}): CompileResult {
  const b: Builder = { errors: [], rung: 0, k: 0, edges: 0, timers: 0, counters: 0, counterInit: [] };
  const out: RungIR[] = [];
  rungs.forEach((rung, i) => {
    b.rung = i;
    b.k = 0;
    if (rung.disabled) return;
    const n = i + 1;
    const before = b.errors.length;
    const expr = rung.logic ? compileNode(b, n, rung.logic) : null;
    const outputs = rung.outputs.map((o) => compileOutput(b, n, o)).filter((x): x is OutputIR => x !== null);
    if (rung.outputs.length === 0) fail(b, n, 'noOutput');
    if (b.k > MAX_RUNG_ELEMENTS) fail(b, n, 'range', undefined, MAX_RUNG_ELEMENTS);
    if (b.errors.length !== before) return;
    out.push({ index: i, expr, outputs, slot: rungSlot(i) });
  });
  const counterInit: number[] = [];
  for (let k = 0; k < b.counters; k++) counterInit[k] = b.counterInit[k] ?? 0;
  const scan = Number.isFinite(opts.scan) ? Math.min(SCAN_MAX, Math.max(SCAN_MIN, opts.scan!)) : SCAN_DEFAULT;
  return {
    ir: {
      rungs: out,
      edges: b.edges,
      slots: rungs.length * SLOTS_PER_RUNG,
      timers: b.timers,
      counters: b.counters,
      counterInit,
      scan,
      ports: opts.ports ?? [],
    },
    errors: b.errors,
  };
}

/**
 * Marker in front of the compiled program on a model card (like the `code` image of the MCU card,
 * src/mcu/program.ts `encodeImage`).
 */
export const LADDER_TEXT_PREFIX = 'machsim-ladder1:';

/**
 * The program travels as hex, not as plain JSON, for two reasons: the netlist flattener treats a
 * parameter text in `{…}` as an arithmetic expression (src/sim/spice/flatten.ts `isDelimited`), and
 * a model parameter written to a SPICE netlist must be ONE token — no spaces, braces or quotes —
 * so that exporting the deck and reading it back gives the same program.
 */
function toHex(text: string): string {
  let out = '';
  for (const unit of text) {
    const cp = unit.codePointAt(0)!;
    // UTF-8 bytes, so any character survives (the compiled program is ASCII in practice)
    const bytes =
      cp < 0x80
        ? [cp]
        : cp < 0x800
          ? [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
          : cp < 0x10000
            ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
            : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex: string): string {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('ladder program: malformed program text');
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCodePoint(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCodePoint(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCodePoint(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      out += String.fromCodePoint(((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f));
      i += 4;
    }
  }
  return out;
}

/** Compiled program as text for the code-model card (`A_LADDER` reads it back). */
export function encodeLadderIr(ir: LadderIR): string {
  return LADDER_TEXT_PREFIX + toHex(JSON.stringify(ir));
}

/** Read back {@link encodeLadderIr}; throws on malformed text. */
export function decodeLadderIr(text: string): LadderIR {
  const body = text.startsWith(LADDER_TEXT_PREFIX) ? fromHex(text.slice(LADDER_TEXT_PREFIX.length)) : text;
  const raw = JSON.parse(body) as Partial<LadderIR>;
  if (!raw || !Array.isArray(raw.rungs) || !Array.isArray(raw.ports)) throw new Error('ladder program: malformed program text');
  return {
    rungs: raw.rungs,
    edges: raw.edges ?? 0,
    slots: raw.slots ?? 0,
    timers: raw.timers ?? 0,
    counters: raw.counters ?? 0,
    counterInit: raw.counterInit ?? [],
    scan: raw.scan && raw.scan > 0 ? raw.scan : SCAN_DEFAULT,
    ports: raw.ports,
  };
}

/** Every bit address a program reads or writes (for the editor's address list and ERC). */
export function ladderAddresses(ir: LadderIR): { reads: BitRef[]; writes: BitRef[] } {
  const reads: BitRef[] = [];
  const writes: BitRef[] = [];
  const walk = (e: ExprIR | null): void => {
    if (!e) return;
    if (e.k === 'bit') reads.push(e.ref);
    else if (e.k === 'and' || e.k === 'or') e.items.forEach(walk);
  };
  for (const r of ir.rungs) {
    walk(r.expr);
    for (const o of r.outputs) if (o.ref) writes.push(o.ref);
  }
  return { reads, writes };
}
