/**
 * Electrical rules check (ERC). Pure functions used by the netlister (src/model/netlister.ts);
 * each one can also be called on its own (tests, editor live checks).
 *
 * Rules and severities
 *   no-ground        error    elements exist but none touches node "0"
 *   floating-pin     warning  a pin connects to nothing (the netlister gives it a private node
 *                             "NC_<refdes>_<pin>" tied to ground through 1 TΩ)
 *   single-pin-net   warning  a wire / label net reaches only one pin
 *   duplicate-refdes error    two parts share a reference designator (power symbols exempt)
 *   unknown-part     error    the part id is not in the library
 *   bad-param        error    a parameter does not parse / is out of range / names a missing model
 *   voltage-loop     error    a loop made only of voltage-defining elements (V, E, H, B V=)
 *                             - parallel ideal sources, a source shorted by an ammeter or wire
 *   current-cutset   error    nodes whose only DC connections are current sources (I, G, F,
 *                             B I=) — e.g. a current source in series with a capacitor
 *                    warning  nodes with no DC path to ground (capacitors / MOSFET gates only)
 *   dangling-wire    warning  a wire end that touches nothing
 *   other                     netlister findings (net with several names, model conflicts,
 *                             probes off the circuit, custom SPICE problems); reference grounds
 *                             that are not isolated (analyzeReferenceGrounds: refGroundNotIsolated,
 *                             refGroundsJoined)
 * Every message carries sheetId / refdes / x / y when a location is known.
 */

import type { PartDef } from '../library/types';
import type { ElementIR } from '../sim/netlist';
import { isGroundNode } from '../sim/netlist';
import { formatEng, parseUserNumber, userNumberLeftover } from '../util/units';
import type { ErcDetail, ErcMessage } from './types';

const detail = (id: string, params?: Record<string, string | number>): { detail: ErcDetail } => ({ detail: params ? { id, params } : { id } });

export interface ErcLocation {
  sheetId?: string;
  refdes?: string;
  x?: number;
  y?: number;
}

function at(loc: ErcLocation | undefined): ErcLocation {
  if (!loc) return {};
  const out: ErcLocation = {};
  if (loc.sheetId !== undefined) out.sheetId = loc.sheetId;
  if (loc.refdes !== undefined) out.refdes = loc.refdes;
  if (loc.x !== undefined) out.x = loc.x;
  if (loc.y !== undefined) out.y = loc.y;
  return out;
}

// ---------------------------------------------------------------------------
// Parts and parameters
// ---------------------------------------------------------------------------

export interface RefdesEntry extends ErcLocation {
  refdes: string;
  /** exempt from the uniqueness rule (power / ground symbols) */
  exempt?: boolean;
}

/** One error for every repeated reference designator (case-insensitive), at the repeat's location. */
export function checkDuplicateRefdes(entries: RefdesEntry[]): ErcMessage[] {
  const seen = new Map<string, RefdesEntry>();
  const out: ErcMessage[] = [];
  for (const e of entries) {
    if (e.exempt) continue;
    const k = e.refdes.trim().toLowerCase();
    if (k === '') {
      out.push({ severity: 'error', code: 'duplicate-refdes', message: 'Part has an empty reference designator (run Annotate)', ...detail('emptyRefdes'), ...at(e) });
      continue;
    }
    const first = seen.get(k);
    if (first) {
      out.push({
        severity: 'error',
        code: 'duplicate-refdes',
        message: `Reference designator ${e.refdes} is used more than once${first.sheetId !== e.sheetId ? ' (on different sheets)' : ''}`,
        ...detail('duplicateRefdes', { refdes: e.refdes }),
        ...at(e),
      });
    } else seen.set(k, e);
  }
  return out;
}

export function unknownPartMessage(partId: string, loc: ErcLocation): ErcMessage {
  return { severity: 'error', code: 'unknown-part', message: `${loc.refdes ?? 'Part'}: unknown library part '${partId}'`, ...detail('unknownPart', { refdes: loc.refdes ?? '?', partId }), ...at(loc) };
}

const BOOL_RE = /^(true|false|1|0|yes|no|on|off|closed|open|pressed|released|y|n)$/i;

/**
 * Validate parameter text against the part's ParamDefs (number syntax and range, select options,
 * booleans). `params` are the merged values (defaults + instance).
 */
export function validateParams(def: PartDef, params: Record<string, string>, loc: ErcLocation = {}): ErcMessage[] {
  const out: ErcMessage[] = [];
  const who = loc.refdes ?? def.name;
  const bad = (msg: string, id: string, params: Record<string, string | number>) =>
    out.push({ severity: 'error', code: 'bad-param', message: `${who}: ${msg}`, ...detail(id, { refdes: who, ...params }), ...at(loc) });
  for (const p of def.params) {
    const text = (params[p.key] ?? p.default).trim();
    switch (p.kind) {
      case 'number': {
        if (text === '') {
          if (p.default.trim() !== '') bad(`${p.label} is empty`, 'paramEmpty', { label: p.label, default: p.default });
          break;
        }
        const v = parseUserNumber(text);
        if (!Number.isFinite(v)) {
          bad(`${p.label} = '${text}' is not a number`, 'paramNotNumber', { label: p.label, text });
          break;
        }
        // "4.7.3k", "1,2,3", "5V1": only the start would be read, so the part would silently
        // simulate another value
        const rest = userNumberLeftover(text);
        if (rest) {
          const read = formatEng(v, p.unit ?? '');
          bad(`${p.label} = '${text}' cannot be read completely ('${rest}' is left over; it would simulate as ${read})`, 'paramUnreadText', { label: p.label, text, rest, value: read });
          break;
        }
        if (p.min !== undefined && v < p.min) bad(`${p.label} = ${text} is below the minimum ${p.min}${p.unit ? ' ' + p.unit : ''}`, 'paramBelowMin', { label: p.label, text, limit: `${p.min}${p.unit ? ' ' + p.unit : ''}` });
        if (p.max !== undefined && v > p.max) bad(`${p.label} = ${text} is above the maximum ${p.max}${p.unit ? ' ' + p.unit : ''}`, 'paramAboveMax', { label: p.label, text, limit: `${p.max}${p.unit ? ' ' + p.unit : ''}` });
        break;
      }
      case 'select': {
        const opts = p.options ?? [];
        if (opts.length && !opts.some((o) => o.value.toLowerCase() === text.toLowerCase())) {
          bad(`${p.label} = '${text}' is not one of ${opts.map((o) => o.value).join(', ')}`, 'paramNotOption', { label: p.label, text, options: opts.map((o) => o.value).join(', ') });
        }
        break;
      }
      case 'bool':
        if (text !== '' && !BOOL_RE.test(text)) bad(`${p.label} = '${text}' is not true / false`, 'paramNotBool', { label: p.label, text });
        break;
      case 'text':
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Topology checks on the element list
// ---------------------------------------------------------------------------

/** Owner lookup: element name -> location of the part that produced it. */
export type OwnerLookup = (elementName: string) => ErcLocation | undefined;

const norm = (n: string): string => (isGroundNode(n) ? '0' : n.trim().toLowerCase());

function elementNodes(el: ElementIR): string[] {
  return el.nodes.map(norm);
}

/** Error when there are elements but none references ground. */
export function checkGround(elements: ElementIR[]): ErcMessage | null {
  if (elements.length === 0) return null;
  if (elements.some((e) => e.nodes.some((n) => isGroundNode(n)))) return null;
  return { severity: 'error', code: 'no-ground', message: 'The circuit has no ground: place a Ground symbol (node 0) so every voltage has a reference', ...detail('noGround') };
}

function isVoltageDefining(el: ElementIR): boolean {
  if (el.type === 'V' || el.type === 'E' || el.type === 'H') return true;
  if (el.type === 'B') return /^\s*v\s*=/i.test(el.expr ?? '');
  return false;
}

function isCurrentForcing(el: ElementIR): boolean {
  if (el.type === 'I' || el.type === 'G' || el.type === 'F') return true;
  if (el.type === 'B') return /^\s*i\s*=/i.test(el.expr ?? '');
  return false;
}

export interface VoltageLoopOptions {
  /**
   * Severity of loops that close through an inductor. An ideal inductor is a short circuit at
   * DC, so such a loop makes every DC operating point singular ('error', the default). A UIC
   * transient skips the operating point and integrates through it, so callers pass 'warning'
   * when that is the analysis to run.
   */
  inductorSeverity?: 'error' | 'warning';
}

const INDUCTOR_HINT = 'an ideal inductor is a short circuit at DC; add series resistance, e.g. the winding resistance';

/**
 * Loops made only of voltage-defining elements (their branch equations are linearly dependent).
 * Inductors take part as the 0 V branches they are at DC: a source directly across an inductor
 * (a transformer primary on a DC supply), parallel inductors and inductor loops are reported.
 */
export function checkVoltageLoops(elements: ElementIR[], owner: OwnerLookup = () => undefined, options: VoltageLoopOptions = {}): ErcMessage[] {
  const inductorSeverity = options.inductorSeverity ?? 'error';
  const inductors = new Set(elements.filter((e) => e.type === 'L').map((e) => e.name));
  const out: ErcMessage[] = [];
  const parent = new Map<string, string>();
  const find = (n: string): string => {
    let r = n;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = n;
    while (parent.has(c) && parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const adj = new Map<string, { to: string; el: string }[]>();
  const link = (a: string, b: string, el: string) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ to: b, el });
    adj.get(b)!.push({ to: a, el });
  };
  const path = (from: string, to: string): string[] => {
    const prev = new Map<string, { node: string; el: string } | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const n = queue.shift()!;
      if (n === to) break;
      for (const e of adj.get(n) ?? []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, { node: n, el: e.el });
        queue.push(e.to);
      }
    }
    const els: string[] = [];
    let c: string | undefined = to;
    while (c !== undefined && prev.get(c)) {
      const p: { node: string; el: string } = prev.get(c)!;
      els.push(p.el);
      c = p.node;
    }
    return els.reverse();
  };
  for (const el of elements) {
    const inductor = el.type === 'L';
    if ((!inductor && !isVoltageDefining(el)) || el.nodes.length < 2) continue;
    const [a, b] = elementNodes(el);
    const loc = owner(el.name);
    if (a === b) {
      out.push({
        severity: inductor ? inductorSeverity : 'error',
        code: 'voltage-loop',
        message: `${el.name} is short-circuited: both terminals are on the same net (${el.nodes[0]})${inductor ? `; its DC current is undetermined (${INDUCTOR_HINT})` : ''}`,
        net: el.nodes[0],
        ...detail(inductor ? 'shortedInductor' : 'shorted', { element: el.name, net: el.nodes[0] }),
        ...at(loc),
      });
      continue;
    }
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      const members = [...path(a, b), el.name];
      const inds = members.filter((m) => inductors.has(m));
      const others = members.filter((m) => !inductors.has(m));
      let message: string;
      let info: { detail: ErcDetail };
      if (inds.length === 0) {
        message = `Voltage sources form a loop: ${members.join(', ')} (parallel ideal sources or a source shorted by an ammeter / wire)`;
        info = detail('sourceLoop', { elements: members.join(', ') });
      } else if (others.length === 1) {
        message = `${inds.join(', ')} ${inds.length > 1 ? 'short' : 'shorts'} ${others[0]} at DC (${INDUCTOR_HINT})`;
        info = detail('inductorShortsSource', { inductors: inds.join(', '), source: others[0] });
      } else {
        message = `${others.length ? 'Inductors and voltage sources' : 'Inductors'} form a loop at DC: ${members.join(', ')} (${INDUCTOR_HINT})`;
        info = detail('inductorLoop', { elements: members.join(', ') });
      }
      out.push({ severity: inds.length ? inductorSeverity : 'error', code: 'voltage-loop', message, net: el.nodes[0], ...info, ...at(loc) });
      continue;
    }
    parent.set(ra, rb);
    link(a, b, el.name);
  }
  return out;
}

/** Node pairs (or groups) through which an element conducts at DC. */
function dcEdges(el: ElementIR): string[][] {
  const n = elementNodes(el);
  switch (el.type) {
    case 'R':
    case 'L':
    case 'V':
    case 'D':
    case 'W':
      return [n.slice(0, 2)];
    case 'E':
    case 'H':
    case 'S':
      return [n.slice(0, 2)];
    case 'B':
      return isCurrentForcing(el) ? [] : [n.slice(0, 2)];
    case 'Q':
    case 'J':
    case 'Z':
      return [n];
    case 'M':
      return [[n[0], n[2], n[3] ?? n[2]]];
    case 'T':
    case 'O':
      return [
        [n[0], n[2]],
        [n[1], n[3]],
      ];
    case 'X':
    case 'A':
      return [n];
    default:
      return [];
  }
}

/**
 * Nodes without a DC path to ground. Error when the isolated group is fed by a current source
 * (I / G / F / B I=), warning otherwise (only capacitors or MOSFET gates).
 */
export function checkCurrentCutsets(elements: ElementIR[], owner: OwnerLookup = () => undefined): ErcMessage[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  find('0');
  const touching = new Map<string, ElementIR[]>();
  const spelling = new Map<string, string>();
  for (const el of elements) {
    const nodes = elementNodes(el);
    nodes.forEach((nd, i) => {
      find(nd);
      if (!touching.has(nd)) touching.set(nd, []);
      touching.get(nd)!.push(el);
      if (!spelling.has(nd)) spelling.set(nd, el.nodes[i]);
    });
    for (const group of dcEdges(el)) for (let i = 1; i < group.length; i++) union(group[0], group[i]);
  }
  const groundRoot = find('0');
  const groups = new Map<string, string[]>();
  for (const nd of touching.keys()) {
    if (nd === '0') continue;
    const r = find(nd);
    if (r === groundRoot) continue;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(nd);
  }
  const out: ErcMessage[] = [];
  for (const nodes of groups.values()) {
    const els = [...new Set(nodes.flatMap((n) => touching.get(n) ?? []))];
    const forcing = els.filter(isCurrentForcing);
    const original = nodes.map((n) => spelling.get(n) ?? n);
    const shown = original.slice(0, 5).join(', ') + (original.length > 5 ? ', …' : '');
    const culprit = forcing[0] ?? els[0];
    const loc = culprit ? owner(culprit.name) : undefined;
    if (forcing.length) {
      out.push({
        severity: 'error',
        code: 'current-cutset',
        message: `Current source ${forcing.map((e) => e.name).join(', ')} has no DC return path: net(s) ${shown} connect to the rest of the circuit only through current sources or capacitors`,
        net: original[0],
        ...detail('currentNoReturn', { sources: forcing.map((e) => e.name).join(', '), nets: shown }),
        ...at(loc),
      });
    } else {
      out.push({
        severity: 'warning',
        code: 'current-cutset',
        message: `Net(s) ${shown} have no DC path to ground (only capacitors or MOSFET gates); the operating point may be singular`,
        net: original[0],
        ...detail('noDcPath', { nets: shown }),
        ...at(loc),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reference grounds ("Đất tham chiếu 1…5", src/library/catalog/signalBlocks.ts)
// ---------------------------------------------------------------------------

/** Net of reference ground n: GNDREF<n>. */
export const REFERENCE_GROUND_RE = /^gndref([1-9])$/i;
/** Tie resistor of a reference ground (1 GΩ to the main ground). */
const REFERENCE_TIE_RE = /^r_gndref[1-9]_tie$/i;
/** Resistances at or above this are leakage, not a connection, for the reference-ground analysis. */
const ISOLATION_OHMS = 1e8;

export interface ReferenceGroundAnalysis {
  /**
   * lower-case node -> the reference-ground node its part of the circuit is measured against
   * (only nodes whose DC-connected part contains exactly one reference ground and no main ground)
   */
  refOf: Map<string, string>;
  /** refGroundNotIsolated / refGroundsJoined warnings */
  messages: ErcMessage[];
}

/**
 * Which parts of the circuit hang on a reference ground. The circuit is cut into DC-connected
 * parts (the same conduction rules as checkCurrentCutsets, without the reference tie resistors
 * and without resistances of 100 MΩ or more, which are leakage such as a transformer's
 * isolation resistance). A part with one reference ground and no main ground is isolated: its nodes are
 * measured against that reference. A part where the reference meets the main ground (or another
 * reference) gets a warning: the reference is not isolated there.
 */
export function analyzeReferenceGrounds(elements: ElementIR[], owner: OwnerLookup = () => undefined): ReferenceGroundAnalysis {
  const refOf = new Map<string, string>();
  const messages: ErcMessage[] = [];
  const spelled = new Map<string, string>();
  for (const el of elements) for (const n of el.nodes) if (REFERENCE_GROUND_RE.test(n.trim())) spelled.set(n.trim().toLowerCase(), n.trim());
  if (!spelled.size) return { refOf, messages };
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const nodes = new Set<string>(['0']);
  for (const el of elements) {
    for (const n of elementNodes(el)) nodes.add(n);
    // the tie resistors and leakage paths (≥ 100 MΩ: transformer isolation resistance, the
    // floating-pin shunts) do not make a reference non-isolated
    if (el.type === 'R' && (REFERENCE_TIE_RE.test(el.name) || (el.value !== undefined && Math.abs(el.value) >= ISOLATION_OHMS))) continue;
    for (const group of dcEdges(el)) for (let i = 1; i < group.length; i++) union(group[0], group[i]);
  }
  const refsOfRoot = new Map<string, string[]>();
  for (const r of spelled.keys()) {
    const root = find(r);
    if (!refsOfRoot.has(root)) refsOfRoot.set(root, []);
    refsOfRoot.get(root)!.push(r);
  }
  const groundRoot = find('0');
  const tieOwner = (ref: string) => owner(`R_${ref}_tie`);
  for (const [root, refs] of refsOfRoot) {
    const names = refs.map((r) => spelled.get(r) ?? r).sort();
    if (root === groundRoot) {
      for (const r of names) {
        const n = REFERENCE_GROUND_RE.exec(r)?.[1] ?? '?';
        messages.push({
          severity: 'warning',
          code: 'other',
          message: `Reference ground ${n} (${r}) is DC-connected to the main ground through the circuit: it is not isolated, and probes there measure against the main ground`,
          net: r,
          detail: { id: 'refGroundNotIsolated', params: { n, net: r } },
          ...at(tieOwner(r.toLowerCase())),
        });
      }
      continue;
    }
    if (refs.length > 1) {
      messages.push({
        severity: 'warning',
        code: 'other',
        message: `Reference grounds ${names.join(', ')} are DC-connected through the circuit: they are not separate references`,
        net: names[0],
        detail: { id: 'refGroundsJoined', params: { nets: names.join(', ') } },
        ...at(tieOwner(refs[0])),
      });
      continue;
    }
    const ref = spelled.get(refs[0]) ?? refs[0];
    for (const n of nodes) if (find(n) === root) refOf.set(n, ref);
  }
  return { refOf, messages };
}

/** Element model / subcircuit references that are not defined. */
export function checkModelRefs(
  elements: ElementIR[],
  models: Record<string, unknown>,
  subckts: Record<string, unknown>,
  owner: OwnerLookup = () => undefined,
): ErcMessage[] {
  const out: ErcMessage[] = [];
  const needsModel = new Set(['D', 'Q', 'J', 'M', 'Z', 'S', 'W', 'O']);
  for (const el of elements) {
    if (!el.model) {
      if (needsModel.has(el.type) || el.type === 'X') out.push({ severity: 'error', code: 'bad-param', message: `${el.name} has no model`, ...detail('noModel', { element: el.name }), ...at(owner(el.name)) });
      continue;
    }
    const k = el.model.toLowerCase();
    if (el.type === 'X' && !(k in subckts)) out.push({ severity: 'error', code: 'bad-param', message: `${el.name}: subcircuit '${el.model}' is not defined`, ...detail('subcktUndefined', { element: el.name, model: el.model }), ...at(owner(el.name)) });
    else if (needsModel.has(el.type) && !(k in models)) out.push({ severity: 'error', code: 'bad-param', message: `${el.name}: model '${el.model}' is not defined (import it as custom SPICE)`, ...detail('modelUndefined', { element: el.name, model: el.model }), ...at(owner(el.name)) });
  }
  return out;
}
