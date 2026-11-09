/**
 * Fault injection for troubleshooting practice.
 *
 * A placed part can carry pin faults (PartInstance.faults, see src/model/types.ts PinFault):
 *   open   the pin is cut from its net; a 1 GΩ resistor remains so the matrix stays regular
 *          (element "R_<ref>_fo_<pin>", the part sees the private node "<ref>.fo_<pin>")
 *   short  pin -> pin `to` of the same part through `r` (default 1 mΩ), "R_<ref>_fs_<pin>"
 *   leak   pin -> pin `to` through `r` (default 10 kΩ), "R_<ref>_fl_<pin>"
 * Only the simulation netlist changes; the drawing stays the same, which is the point of the
 * exercise: the learner measures, reasons and finds the faulty part.
 *
 * Hidden faults (auto faults before "Reveal") must not name the part they sit on anywhere a
 * student can look (Netlist tab, Grapher / analysis output lists, sweep element lists). The
 * netlister therefore passes `anonymous` to faultInsert: such a fault becomes "R_HF_<n>" with the
 * private node "HF.<n>" (n counts the hidden faults of one build), names the result views treat as
 * internal helpers (isHiddenFaultElement). The bottom-dock Netlist tab and SPICE export are
 * withheld while hidden faults exist (src/ui/integration/reports.ts).
 *
 * Auto fault (`placeAutoFaults`) draws hidden faults on random parts with a seeded generator, so
 * the same seed reproduces the same exercise; `revealFaults` shows them, `clearFaults` removes
 * them.
 */
import { elR, elementName, internalNodeName } from '../library/partkit';
import type { PartDef } from '../library/types';
import type { ElementIR } from '../sim/netlist';
import type { Design, PartInstance, PinFault } from './types';

export const FAULT_OPEN_R = 1e9;
export const FAULT_SHORT_R = 1e-3;
export const FAULT_LEAK_R = 10e3;

export type FaultKind = PinFault['kind'];
export const FAULT_KINDS: readonly FaultKind[] = ['open', 'short', 'leak'];

const pinTag = (pin: string): string => pin.replace(/\+/g, 'p').replace(/-/g, 'n').replace(/[^A-Za-z0-9_]/g, '_');

/** Resistance a fault uses (its own `r`, else the kind's default). */
export function faultResistance(f: PinFault): number {
  if (f.kind === 'open') return FAULT_OPEN_R;
  if (f.r !== undefined && f.r > 0) return f.r;
  return f.kind === 'short' ? FAULT_SHORT_R : FAULT_LEAK_R;
}

/** Parts that can carry faults: simulated parts with at least two pins (not power symbols, instruments). */
export function isFaultable(def: PartDef | undefined): boolean {
  return !!def && !!def.toSpice && def.globalNet === undefined && !def.instrument && def.symbol.pins.length >= 2;
}

/** Element / node tag of hidden faults: element "R_HF_<n>", private node "HF.<n>". */
export const HIDDEN_FAULT_TAG = 'HF';

/** True for the netlist element of a hidden fault ("R_HF_3"). */
export function isHiddenFaultElement(name: string): boolean {
  return /^R_HF_\d+$/i.test(name);
}

export interface FaultInsert {
  /** pin -> node the part uses instead of its net (open pins) */
  nodes: Map<string, string>;
  elements: ElementIR[];
}

/**
 * Netlist elements of an instance's faults. `netOf(pin)` is the pin's net node. Throws an Error
 * naming the problem for a fault on an unknown pin or with a missing / unknown `to` pin.
 * `anonymous` (hidden faults only) returns the next hidden-fault number; the fault is then named
 * "R_HF_<n>" / "HF.<n>" instead of after the part and pin.
 */
export function faultInsert(faults: readonly PinFault[], def: PartDef, refdes: string, netOf: (pin: string) => string, anonymous?: (f: PinFault) => number | undefined): FaultInsert {
  const pins = new Set(def.symbol.pins.map((p) => p.name));
  const nodes = new Map<string, string>();
  const elements: ElementIR[] = [];
  const used = new Set<string>();
  for (const f of faults) {
    if (!pins.has(f.pin)) throw new Error(`fault on unknown pin '${f.pin}'`);
    const key = `${f.kind}:${f.pin}`;
    if (used.has(key)) continue;
    used.add(key);
    const tag = pinTag(f.pin);
    if (f.kind !== 'open' && (!f.to || !pins.has(f.to) || f.to === f.pin)) throw new Error(`${f.kind} fault on pin '${f.pin}' needs another pin of the part`);
    if (f.kind !== 'open' && netOf(f.pin) === netOf(f.to!)) continue;
    const n = anonymous?.(f);
    const name = n !== undefined ? elementName('R', HIDDEN_FAULT_TAG, String(n)) : elementName('R', refdes, `${f.kind === 'open' ? 'fo' : f.kind === 'short' ? 'fs' : 'fl'}_${tag}`);
    if (f.kind === 'open') {
      const inner = n !== undefined ? internalNodeName(HIDDEN_FAULT_TAG, String(n)) : internalNodeName(refdes, `fo_${tag}`);
      nodes.set(f.pin, inner);
      elements.push(elR(name, netOf(f.pin), inner, FAULT_OPEN_R));
      continue;
    }
    elements.push(elR(name, netOf(f.pin), netOf(f.to!), faultResistance(f)));
  }
  return { nodes, elements };
}

/** Faults the editor shows for an instance (hidden auto faults only after Reveal). */
export function visibleFaults(inst: PartInstance, design: Pick<Design, 'autoFault'>): PinFault[] {
  const all = inst.faults ?? [];
  if (design.autoFault?.revealed) return all;
  return all.filter((f) => !f.hidden);
}

/** Number of hidden (auto) faults in a design. */
export function hiddenFaultCount(design: Design): number {
  let n = 0;
  for (const s of design.sheets) for (const p of s.parts) n += (p.faults ?? []).filter((f) => f.hidden).length;
  return n;
}

/** Deterministic pseudo-random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AutoFaultOptions {
  /** number of faults to place (at most one per part) */
  count: number;
  /** allowed fault kinds (default all) */
  kinds?: readonly FaultKind[];
  /** random seed (same seed + same design = same faults) */
  seed: number;
}

export interface PlacedFault {
  refdes: string;
  partId: string;
  fault: PinFault;
}

/**
 * Replace the design's hidden faults with `count` new ones on randomly chosen parts of the top
 * level (at most one per part). User-set (visible) faults stay.
 */
export function placeAutoFaults(design: Design, lookup: (id: string) => PartDef | undefined, opts: AutoFaultOptions): { design: Design; placed: PlacedFault[] } {
  const rnd = seededRandom(opts.seed);
  const kinds = opts.kinds && opts.kinds.length ? opts.kinds : FAULT_KINDS;
  const base = clearFaults(design, true);
  const candidates: { sheet: number; part: number }[] = [];
  base.sheets.forEach((s, si) =>
    s.parts.forEach((p, pi) => {
      if (!p.excludeFromSim && isFaultable(lookup(p.partId))) candidates.push({ sheet: si, part: pi });
    }),
  );
  // Fisher-Yates on the candidate list
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen = candidates.slice(0, Math.max(0, Math.min(opts.count, candidates.length)));
  const sheets = base.sheets.map((s) => ({ ...s, parts: s.parts.slice() }));
  const placed: PlacedFault[] = [];
  for (const c of chosen) {
    const inst = sheets[c.sheet].parts[c.part];
    const def = lookup(inst.partId)!;
    const pins = def.symbol.pins.map((p) => p.name);
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const pin = pins[Math.floor(rnd() * pins.length)];
    const fault: PinFault = { pin, kind, hidden: true };
    if (kind !== 'open') {
      const others = pins.filter((p) => p !== pin);
      fault.to = others[Math.floor(rnd() * others.length)];
      // leakage between 1 kΩ and 100 kΩ (log-uniform), shorts at the default 1 mΩ
      if (kind === 'leak') fault.r = Number((1e3 * Math.pow(100, rnd())).toPrecision(2));
    }
    sheets[c.sheet].parts[c.part] = { ...inst, faults: [...(inst.faults ?? []), fault] };
    placed.push({ refdes: inst.refdes, partId: inst.partId, fault });
  }
  return { design: { ...base, sheets, autoFault: { seed: opts.seed, count: placed.length, revealed: false } }, placed };
}

/** Remove faults: every fault, or only the hidden (auto) ones. */
export function clearFaults(design: Design, onlyHidden = false): Design {
  let changed = false;
  const sheets = design.sheets.map((s) => {
    let sheetChanged = false;
    const parts = s.parts.map((p) => {
      if (!p.faults?.length) return p;
      const keep = onlyHidden ? p.faults.filter((f) => !f.hidden) : [];
      if (keep.length === p.faults.length) return p;
      sheetChanged = true;
      const next: PartInstance = { ...p };
      if (keep.length) next.faults = keep;
      else delete next.faults;
      return next;
    });
    if (!sheetChanged) return s;
    changed = true;
    return { ...s, parts };
  });
  const out: Design = changed ? { ...design, sheets } : { ...design };
  if (out.autoFault) delete out.autoFault;
  return changed || design.autoFault ? out : design;
}

/** Show the hidden faults (they stay in the circuit). */
export function revealFaults(design: Design): Design {
  if (!design.autoFault) return design;
  return { ...design, autoFault: { ...design.autoFault, revealed: true } };
}

/** Every fault of the top level with its part (for the reveal list). */
export function listFaults(design: Design): PlacedFault[] {
  const out: PlacedFault[] = [];
  for (const s of design.sheets) for (const p of s.parts) for (const f of p.faults ?? []) out.push({ refdes: p.refdes, partId: p.partId, fault: f });
  return out;
}
