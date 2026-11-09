/**
 * Rated parts: burn-out when a power, voltage or current rating is exceeded.
 *
 * Netlist side (`ratingInsert`, used by the netlister for every instance whose part has
 * `LibraryPartDef.ratings` and whose `enable` parameter is true):
 *   - the pins the monitor needs are re-routed through 0 V sense sources
 *     ("V_<ref>_rs_<pin>"), so the current into each pin is known;
 *   - the open pin (default: the first one) is re-routed through an ideal switch
 *     ("S_<ref>_blow") controlled by a hidden 0 V source "V_<ref>_blow": dc 0 = intact, dc 1 =
 *     burnt out (open);
 *   - every rating becomes a stress node that holds quantity / limit:
 *       power    P = Σ V(pin, ref)·I(pin) over the sensed pins (the true dissipation of any
 *                multi-terminal part), low-pass filtered by the thermal time constant τ:
 *                node "<ref>.rpw" = R 1 Ω ∥ C τ fed with P / Pmax
 *       voltage  "<ref>.rv<k>" = |V(a,b)| / Vmax (or one polarity only, e.g. reverse voltage)
 *       current  "<ref>.ri"    = |I(pin)| / Imax
 *   Nothing changes for parts without ratings, or with burn-out switched off.
 *
 * Simulation side (pure helpers for the integration layer):
 *   - `ratingStress(binding, values)`: the worst stress of a part in a vector snapshot;
 *   - `findBlowEvents(bindings, results)`: first time (transient) or operating point at which a
 *     part's stress reaches 1;
 *   - `applyBlows(netlist, events)`: the netlist with those parts opened — at the OP (dc = 1) or
 *     from the burn-out instant (a PWL step of the blow source), so a re-run shows the circuit
 *     after the part failed;
 *   - interactive sessions open a part live with setParam(blowSource, 'dc', 1).
 */
import { elB, elC, elR, elS, elSense, elV, elementName, ex, internalNodeName, swModel, type LibraryPartDef, type RatingSpec } from '../library/partkit';
import type { ElementIR, ModelCard, Netlist } from '../sim/netlist';
import type { AnalysisResult } from '../sim/results';
import type { SignalRef } from './types';

export type RatingKind = 'power' | 'voltage' | 'current';

/** One monitored rating: the node holding quantity / limit. */
export interface RatingTerm {
  kind: RatingKind;
  /** voltage of the stress node: 1.0 = exactly at the rating */
  signal: SignalRef;
  /** the limit (W, V or A) */
  limit: number;
  /** voltage terms: the pins measured; current terms: the pin */
  pins?: [string, string];
  pin?: string;
  /** voltage terms counting one polarity only */
  sign?: 1 | -1;
}

/** Rating monitor of one placed part (NetlistBuildEx.ratings). */
export interface RatingBinding {
  refdes: string;
  partId: string;
  sheetId?: string;
  /** hidden V source: dc 0 = intact, 1 = burnt out */
  blowSource: string;
  terms: RatingTerm[];
}

/** Model of the burn-out switch: on while V(blow) < 0.5. */
export const RATING_SWITCH_MODEL = 'MS_RATED_OPEN';
const SWITCH_CARD: ModelCard = swModel(RATING_SWITCH_MODEL, -0.5, 0, 1e-4, 1e9);

/** Default thermal time constant of the power term, seconds. */
export const DEFAULT_THERMAL_TAU = 10e-3;

const pinTag = (pin: string): string => pin.replace(/\+/g, 'p').replace(/-/g, 'n').replace(/[^A-Za-z0-9_]/g, '_');

export interface RatingInsert {
  /** pin -> node the part must use instead of its net */
  nodes: Map<string, string>;
  elements: ElementIR[];
  models: ModelCard[];
  binding: RatingBinding;
}

function limitOf(spec: { param?: string; value?: number }, num: (key: string) => number, what: string): number {
  const v = spec.param !== undefined ? num(spec.param) : spec.value;
  if (v === undefined || !(v > 0) || !Number.isFinite(v)) throw new Error(`bad value for ${spec.param ?? what}: rating must be > 0`);
  return v;
}

const vexpr = (a: string, b: string): string => {
  const ga = a === '0';
  const gb = b === '0';
  if (ga && gb) return '0';
  if (gb) return `V(${a})`;
  if (ga) return `(-V(${b}))`;
  return `V(${a},${b})`;
};

/** True when burn-out is switched on for an instance (the `enable` bool param). */
export function ratingEnabled(def: LibraryPartDef, params: Record<string, string>): boolean {
  const r = def.ratings;
  if (!r) return false;
  return /^(true|1|yes|on)$/i.test((params[r.enable] ?? '').trim());
}

/**
 * Monitor elements of one rated instance. `netOf(pin)` is the node the pin is connected to;
 * `num(key)` parses a numeric parameter (throws "bad value for <key>" like ToSpiceContext.num).
 */
export function ratingInsert(def: LibraryPartDef, spec: RatingSpec, refdes: string, netOf: (pin: string) => string, num: (key: string) => number): RatingInsert {
  const pins = def.symbol.pins.map((p) => p.name);
  if (pins.length === 0) throw new Error('rated part has no pins');
  const openPin = spec.openPin ?? pins[0];
  const others = pins.filter((p) => p !== openPin);
  const refPin = others.length ? others[others.length - 1] : openPin;
  const name = (type: string, suffix: string) => elementName(type, refdes, suffix);
  const node = (suffix: string) => internalNodeName(refdes, suffix);

  // pins that get a sense source: all but the reference pin for power, else the current pin and the open pin
  const sensed = new Set<string>();
  if (spec.power) for (const p of pins) if (p !== refPin || pins.length === 1) sensed.add(p);
  if (spec.current) sensed.add(spec.current.pin);
  sensed.add(openPin);

  const elements: ElementIR[] = [];
  const nodes = new Map<string, string>();
  const senseOf = new Map<string, string>();
  for (const p of pins) {
    if (!sensed.has(p)) continue;
    const tag = pinTag(p);
    const inner = node(`rp_${tag}`);
    let from = netOf(p);
    if (p === openPin) {
      const mid = node(`rs_${tag}`);
      elements.push({ ...elS(name('S', 'blow'), from, mid, '0', node('blow'), RATING_SWITCH_MODEL), params: { on: 1 } });
      from = mid;
    }
    const sense = name('V', `rs_${tag}`);
    elements.push(elSense(sense, from, inner));
    senseOf.set(p, sense);
    nodes.set(p, inner);
  }
  const blowSource = name('V', 'blow');
  elements.push(elV(blowSource, node('blow'), '0', { dc: 0 }));
  const partNode = (p: string): string => nodes.get(p) ?? netOf(p);

  const terms: RatingTerm[] = [];
  if (spec.power) {
    const pmax = num(spec.power);
    if (!(pmax > 0)) throw new Error(`bad value for ${spec.power}: rating must be > 0`);
    const tau = typeof spec.tau === 'string' ? num(spec.tau) : (spec.tau ?? DEFAULT_THERMAL_TAU);
    if (!(tau > 0)) throw new Error('bad value for thermal time constant: must be > 0');
    const ref = partNode(refPin);
    const sum = [...sensed].filter((p) => p !== refPin).map((p) => `${vexpr(partNode(p), ref)}*I(${senseOf.get(p)})`);
    const heat = node('rpw');
    elements.push(
      elB(name('B', 'rpw'), '0', heat, 'I', `(${sum.length ? sum.join('+') : '0'})/${ex(pmax)}`),
      elR(name('R', 'rpw'), heat, '0', 1),
      elC(name('C', 'rpw'), heat, '0', tau),
    );
    terms.push({ kind: 'power', signal: { kind: 'voltage', pos: heat, neg: '0' }, limit: pmax });
  }
  (spec.voltages ?? []).forEach((v, k) => {
    const limit = limitOf(v, num, 'voltage rating');
    const d = vexpr(partNode(v.pins[0]), partNode(v.pins[1]));
    const mag = v.sign === 1 ? `max(${d},0)` : v.sign === -1 ? `max(-(${d}),0)` : `abs(${d})`;
    const n = node(`rv${k}`);
    elements.push(elB(name('B', `rv${k}`), n, '0', 'V', `${mag}/${ex(limit)}`));
    const term: RatingTerm = { kind: 'voltage', signal: { kind: 'voltage', pos: n, neg: '0' }, limit, pins: v.pins };
    if (v.sign) term.sign = v.sign;
    terms.push(term);
  });
  if (spec.current) {
    const limit = limitOf(spec.current, num, 'current rating');
    const n = node('ri');
    elements.push(elB(name('B', 'ri'), n, '0', 'V', `abs(I(${senseOf.get(spec.current.pin)}))/${ex(limit)}`));
    terms.push({ kind: 'current', signal: { kind: 'voltage', pos: n, neg: '0' }, limit, pin: spec.current.pin });
  }
  return { nodes, elements, models: [SWITCH_CARD], binding: { refdes, partId: def.id, blowSource, terms } };
}

// ---------------------------------------------------------------------------------------------
// simulation side

const readNode = (values: Map<string, number>, ref: SignalRef): number | undefined => {
  if (ref.kind === 'current') return values.get(`i(${ref.element.toLowerCase()})`);
  const p = ref.pos === '0' ? 0 : values.get(`v(${ref.pos.toLowerCase()})`);
  const n = ref.neg === '0' ? 0 : values.get(`v(${ref.neg.toLowerCase()})`);
  return p === undefined || n === undefined ? undefined : p - n;
};

/** Worst stress of a part in a lower-cased vector snapshot ("v(node)" keys); null when unknown. */
export function ratingStress(b: RatingBinding, values: Map<string, number>): { ratio: number; term: RatingTerm } | null {
  let best: { ratio: number; term: RatingTerm } | null = null;
  for (const term of b.terms) {
    const r = readNode(values, term.signal);
    if (r === undefined || !Number.isFinite(r)) continue;
    if (!best || r > best.ratio) best = { ratio: r, term };
  }
  return best;
}

/** A part reaching its rating during a simulation. */
export interface BlowEvent {
  refdes: string;
  partId: string;
  blowSource: string;
  kind: RatingKind;
  /** stress at the burn-out sample (≥ 1) */
  ratio: number;
  /** the quantity that was exceeded (ratio × limit) and its limit */
  value: number;
  limit: number;
  /** transient time of the burn-out; undefined for the operating point */
  time?: number;
}

function vectorOf(r: AnalysisResult, ref: SignalRef): Float64Array | number[] | null {
  if (ref.kind !== 'voltage') return null;
  const want = `v(${ref.pos.toLowerCase()})`;
  const v = r.vectors.find((x) => x.name.toLowerCase() === want);
  return v ? v.re : null;
}

/**
 * First burn-out of every rated part in a list of results (operating point or transient; other
 * analyses are not checked). Parts in `already` are skipped.
 */
export function findBlowEvents(bindings: readonly RatingBinding[], results: readonly AnalysisResult[], already: ReadonlySet<string> = new Set()): BlowEvent[] {
  const out: BlowEvent[] = [];
  for (const b of bindings) {
    if (already.has(b.refdes)) continue;
    let best: BlowEvent | null = null;
    for (const r of results) {
      if (r.error || (r.type !== 'op' && r.type !== 'tran')) continue;
      const time = r.type === 'tran' ? r.scale?.re : undefined;
      for (const term of b.terms) {
        const v = vectorOf(r, term.signal);
        if (!v) continue;
        for (let i = 0; i < v.length; i++) {
          if (!(v[i] >= 1)) continue;
          const t = time ? time[i] : undefined;
          if (!best || (t !== undefined && (best.time === undefined || t < best.time))) {
            best = { refdes: b.refdes, partId: b.partId, blowSource: b.blowSource, kind: term.kind, ratio: v[i], value: v[i] * term.limit, limit: term.limit, time: t };
          }
          break;
        }
      }
      if (best && best.time === undefined) break;
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Copy of `netlist` with the blow sources of `events` switched: dc 1 for operating-point events,
 * a step from 0 to 1 at the burn-out time for transient events (the part works until then).
 */
export function applyBlows(netlist: Netlist, events: readonly BlowEvent[]): Netlist {
  const byName = new Map(events.map((e) => [e.blowSource.toLowerCase(), e]));
  if (!byName.size) return netlist;
  return {
    ...netlist,
    elements: netlist.elements.map((el) => {
      const e = byName.get(el.name.toLowerCase());
      if (!e || el.type !== 'V') return el;
      if (e.time === undefined || e.time <= 0) return { ...el, source: { dc: 1 } };
      const t = e.time;
      return { ...el, source: { dc: 0, tran: { type: 'PWL', args: [0, 0, t, 0, t + Math.max(1e-9, t * 1e-6), 1] } } };
    }),
  };
}
