/**
 * Finding a logic gate or a flip-flop in a learner's circuit, whatever part they used.
 *
 * A lesson may not insist on the single-gate teaching symbol: a learner who reaches for a real
 * 7408 (or a 74LS08, a 4081, or one section 7408A of the package) has built the same circuit and
 * must pass the same steps. The pins differ though — the teaching symbol calls them A, B, Y while
 * a real package calls the first gate 1A, 1B, 1Y and carries three more gates in the same box.
 *
 *   gateUnits(c, ref)          // every gate of a placed part, with its input and output pin names
 *   pickGate(c, match)         // the gate a lesson should look at (the wired one)
 *   flipflopUnits(c, ref)      // the same for a D flip-flop (D, CLK, Q, QN, ~PRE, ~CLR)
 *   pickFlipflop(c, match)
 *   logicIds('08', [...])      // ids of a logic type in every 74 family, with its sections
 *
 * A package pin is named "<section><suffix>" ("2A"); a single-gate symbol has no section number.
 * Both are handled by grouping the pins by their leading digits, so a package of any width works.
 */
import type { LessonCircuit, PartMatch, PartRef } from './circuit';

/** The 74-family id prefixes the catalogue generates ('ttl/74ls' + '08' = 'ttl/74ls08'). */
export const LOGIC_FAMILY_PREFIXES: readonly string[] = ['ttl/74std', 'ttl/74ls', 'ttl/74s', 'ttl/74f', 'ttl/74als', 'ttl/74as', 'cmos/74hc', 'cmos/74hct', 'cmos/74ac', 'cmos/74act'];

/** Section letters a gate package can be split into (7400A … 7400D, six for a hex inverter). */
const SECTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/**
 * Every library id of a logic type: one per 74 family, the hand-written core part ('ttl/7408'),
 * any extra ids given (the 4000-series equivalent), and the section parts of each ('ttl/7408-a').
 */
export function logicIds(pn: string, extra: readonly string[] = []): string[] {
  const packages = [...LOGIC_FAMILY_PREFIXES.map((p) => `${p}${pn}`), `ttl/${pn.length <= 3 ? `74${pn}` : pn}`, ...extra];
  const out: string[] = [];
  for (const id of packages) {
    out.push(id);
    for (const s of SECTION_LETTERS) out.push(`${id}-${s}`);
  }
  return out;
}

/** The part of a pin name after its section number ("2A" -> "A", "CLK" -> "CLK"). */
export function pinSuffix(name: string): string {
  return (/^\d+([A-Za-z].*)$/.exec(name)?.[1] ?? name).toUpperCase();
}

/** Pins of a part grouped by section ("1A" -> 1); a symbol without section numbers gives one group. */
function sections(ref: PartRef): string[][] {
  const groups = new Map<number, string[]>();
  for (const p of ref.def.symbol.pins) {
    const m = /^(\d+)[A-Za-z]/.exec(p.name);
    const k = m ? Number(m[1]) : 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p.name);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, pins]) => pins);
}

/** One gate: the part it belongs to, its input pins and its output pin. */
export interface GateUnit {
  ref: PartRef;
  inputs: string[];
  out: string;
}

/** Every gate of a placed part (one for a single-gate symbol, four for a quad package). */
export function gateUnits(c: LessonCircuit, ref: PartRef): GateUnit[] {
  const out: GateUnit[] = [];
  for (const pins of sections(ref)) {
    const y = pins.find((p) => pinSuffix(p) === 'Y');
    if (!y) continue;
    const inputs = pins.filter((p) => p !== y && !isSupply(pinSuffix(p)));
    if (inputs.length) out.push({ ref, inputs, out: y });
  }
  return out;
}

const isSupply = (suffix: string): boolean => suffix === 'VCC' || suffix === 'VDD' || suffix === 'GND' || suffix === 'VSS';

/** True when every input of the gate is wired to something. */
function allWired(c: LessonCircuit, g: GateUnit): boolean {
  return g.inputs.every((p) => c.pinConnected(g.ref, p));
}

/**
 * The gate a lesson should check: the first one whose inputs and output are all wired, else the
 * first one whose output is wired, else the first gate of the first matching part. Undefined when
 * no matching part is placed. A learner who puts a quad package on the sheet and wires gate 3 is
 * checked on gate 3.
 */
export function pickGate(c: LessonCircuit, match: PartMatch): GateUnit | undefined {
  const units = c.parts(match).flatMap((ref) => gateUnits(c, ref));
  return units.find((g) => allWired(c, g) && c.pinConnected(g.ref, g.out)) ?? units.find((g) => c.pinConnected(g.ref, g.out)) ?? units[0];
}

/** One D flip-flop: its data, clock and output pins (preset / clear when the part has them). */
export interface FlipflopUnit {
  ref: PartRef;
  d: string;
  clk: string;
  q: string;
  qn?: string;
  /**
   * Active-low preset / clear pins (~PRE, ~CLR of a 74x74): they must stay high for the flip-flop
   * to toggle. The teaching symbol's SET / RESET and the 4013's are active HIGH, so they are not
   * listed here — tying those to ground is the normal, inactive wiring.
   */
  asyncLow: string[];
}

/** Every D flip-flop of a placed part (one for the teaching symbol, two for a 7474). */
export function flipflopUnits(c: LessonCircuit, ref: PartRef): FlipflopUnit[] {
  const out: FlipflopUnit[] = [];
  for (const pins of sections(ref)) {
    const find = (suffix: string) => pins.find((p) => pinSuffix(p) === suffix);
    const d = find('D');
    const clk = find('CLK') ?? find('CK') ?? find('C');
    const q = find('Q');
    if (!d || !clk || !q) continue;
    const qn = find('QN') ?? find('~Q');
    const asyncLow: string[] = [];
    for (const s of ['PRE', 'CLR']) {
      const p = find(s);
      if (p) asyncLow.push(p);
    }
    out.push({ ref, d, clk, q, asyncLow, ...(qn ? { qn } : {}) });
  }
  return out;
}

/** The flip-flop a lesson should check (the wired one), as {@link pickGate} does for gates. */
export function pickFlipflop(c: LessonCircuit, match: PartMatch): FlipflopUnit | undefined {
  const units = c.parts(match).flatMap((ref) => flipflopUnits(c, ref));
  return units.find((f) => c.pinConnected(f.ref, f.clk) && c.pinConnected(f.ref, f.q)) ?? units.find((f) => c.pinConnected(f.ref, f.clk)) ?? units[0];
}

/**
 * The asynchronous inputs that are not held inactive. A real 74x74 holds Q at 1 while ~PRE is low,
 * and both its ~PRE and ~CLR pins float high only because the model's open input reads 1 — a
 * learner who ties one of them low gets a flip-flop that never toggles, so a lesson says so.
 */
export function heldAsync(c: LessonCircuit, f: FlipflopUnit): string[] {
  return f.asyncLow.filter((p) => c.net(f.ref, p) === '0');
}
