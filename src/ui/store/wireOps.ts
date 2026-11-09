/**
 * Wire topology maintenance: simplify, auto-split, auto-merge and junction detection.
 *
 * Editor connectivity convention (documented for the netlister):
 *  - A wire END that lies on another wire's segment connects to it. {@link normalizeWires} makes
 *    such T-connections explicit by splitting the other wire at that point, so after
 *    normalisation every wire-to-wire connection is an endpoint-to-endpoint connection.
 *  - Two wire ends meeting at a point with nothing else there (no pin, no third wire) are merged
 *    into one wire (when their colours match).
 *  - Pins connect only to wire ends; a wire merely passing over a pin does not connect.
 *  - Junction dots are drawn where three or more connections meet ({@link junctionPoints}).
 *
 * All functions are pure and preserve object identity of untouched wires (structural sharing).
 */
import type { Point, Wire } from '../../model/types';
import { pointOnSegment, samePoint } from '../../model/geometry';
import { simplifyPoints, samePoints } from './routing';
import { newId } from './ids';

/** Hash key of a point at half-unit resolution. */
export function pointKey(p: Point): string {
  return `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`;
}

/** Simplified copy of a wire, the same object when already canonical, or null when degenerate. */
export function simplifyWire(w: Wire): Wire | null {
  const pts = simplifyPoints(w.points);
  if (pts.length < 2) return null;
  if (samePoints(pts, w.points)) return w;
  return { ...w, points: pts };
}

/** First and last point of a wire. */
export function wireEnds(w: Wire): [Point, Point] {
  return [w.points[0], w.points[w.points.length - 1]];
}

/** True when `p` lies on the wire but is not one of its two end points. */
export function onWireInterior(w: Wire, p: Point): boolean {
  const [a, b] = wireEnds(w);
  if (samePoint(p, a) || samePoint(p, b)) return false;
  return onWire(w, p);
}

/** True when `p` lies anywhere on the wire (ends included). */
export function onWire(w: Wire, p: Point): boolean {
  for (let i = 0; i < w.points.length - 1; i++) {
    if (pointOnSegment(p, w.points[i], w.points[i + 1])) return true;
  }
  return false;
}

/**
 * Split a wire at the given interior points. The first piece keeps the wire's id; further pieces
 * receive ids from `makeId`. Cut points not on the wire's interior are ignored.
 */
export function splitWireAt(w: Wire, cuts: Point[], makeId: () => string = () => newId('w')): Wire[] {
  const inner = cuts.filter((c) => onWireInterior(w, c));
  if (inner.length === 0) return [w];
  const pieces: Point[][] = [];
  let current: Point[] = [w.points[0]];
  const isCut = (p: Point) => inner.some((c) => samePoint(c, p));
  for (let i = 0; i < w.points.length - 1; i++) {
    const a = w.points[i];
    const b = w.points[i + 1];
    if (i > 0 && isCut(a)) {
      pieces.push(current);
      current = [a];
    }
    const along = inner
      .filter((c) => !samePoint(c, a) && !samePoint(c, b) && pointOnSegment(c, a, b))
      .sort((p, q) => Math.abs(p.x - a.x) + Math.abs(p.y - a.y) - (Math.abs(q.x - a.x) + Math.abs(q.y - a.y)));
    for (const c of along) {
      if (current.length > 0 && samePoint(current[current.length - 1], c)) continue;
      current.push(c);
      pieces.push(current);
      current = [c];
    }
    current.push(b);
  }
  pieces.push(current);
  const out: Wire[] = [];
  pieces.forEach((pts, idx) => {
    const s = simplifyPoints(pts);
    if (s.length < 2) return;
    // later pieces keep the wire's colour, bus flag / name, lock and group
    out.push(idx === 0 ? { ...w, points: s } : { ...w, id: makeId(), points: s });
  });
  if (out.length > 0 && out[0].id !== w.id) out[0] = { ...out[0], id: w.id };
  return out;
}

/** Join two wires that share an end point `at`; the result keeps `a`'s id and colour. */
export function joinWires(a: Wire, b: Wire, at: Point): Wire {
  const ap = samePoint(a.points[a.points.length - 1], at) ? a.points : a.points.slice().reverse();
  const bp = samePoint(b.points[0], at) ? b.points : b.points.slice().reverse();
  return { ...a, points: simplifyPoints([...ap, ...bp.slice(1)]) };
}

interface EndRef {
  wire: number;
  end: 0 | 1;
}

function endpointIndex(wires: Wire[]): Map<string, EndRef[]> {
  const map = new Map<string, EndRef[]>();
  wires.forEach((w, i) => {
    const ends = wireEnds(w);
    ends.forEach((p, e) => {
      const k = pointKey(p);
      const list = map.get(k);
      const ref: EndRef = { wire: i, end: e as 0 | 1 };
      if (list) list.push(ref);
      else map.set(k, [ref]);
    });
  });
  return map;
}

/**
 * Canonical wire set: simplify every wire, split wires where another wire's end lands on their
 * interior, merge pairs of ends that meet with nothing else at that point, and drop degenerate
 * wires. `pinKeys` (from {@link pointKey}) marks points where a pin sits (never merged across).
 * Returns the input array itself when nothing changed.
 */
export function normalizeWires(wires: Wire[], pinKeys: Set<string>, makeId: () => string = () => newId('w')): Wire[] {
  // bus wires (v2) are their own layer: they never split, merge or junction with ordinary wires
  if (wires.some((w) => w.bus)) {
    const net = wires.filter((w) => !w.bus);
    const bus = wires.filter((w) => w.bus);
    const n2 = normalizeLayer(net, pinKeys, makeId);
    const b2 = normalizeLayer(bus, pinKeys, makeId);
    return n2 === net && b2 === bus ? wires : [...n2, ...b2];
  }
  return normalizeLayer(wires, pinKeys, makeId);
}

function normalizeLayer(wires: Wire[], pinKeys: Set<string>, makeId: () => string): Wire[] {
  let changed = false;
  // 1. simplify
  let list: Wire[] = [];
  for (const w of wires) {
    const s = simplifyWire(w);
    if (s !== w) changed = true;
    if (s) list.push(s);
  }
  // 2. split at foreign wire ends lying on interiors
  const ends: Point[] = [];
  list.forEach((w) => ends.push(...wireEnds(w)));
  const split: Wire[] = [];
  for (const w of list) {
    const cuts = ends.filter((p) => onWireInterior(w, p));
    if (cuts.length === 0) {
      split.push(w);
      continue;
    }
    const pieces = splitWireAt(w, cuts, makeId);
    if (pieces.length !== 1 || pieces[0] !== w) changed = true;
    split.push(...pieces);
  }
  list = split;
  // 3. merge pairs of ends meeting alone
  for (let guard = 0; guard < 10000; guard++) {
    const index = endpointIndex(list);
    let merged = false;
    for (const [key, refs] of index) {
      if (refs.length !== 2 || refs[0].wire === refs[1].wire || pinKeys.has(key)) continue;
      const a = list[refs[0].wire];
      const b = list[refs[1].wire];
      if ((a.color ?? '') !== (b.color ?? '') || (a.busName ?? '') !== (b.busName ?? '') || (a.group ?? '') !== (b.group ?? '')) continue;
      const at = wireEnds(a)[refs[0].end];
      if (list.some((w, i) => i !== refs[0].wire && i !== refs[1].wire && onWire(w, at))) continue;
      const joined = joinWires(a, b, at);
      const keep = refs[0].wire;
      const drop = refs[1].wire;
      list = list.filter((_, i) => i !== drop).map((w, i) => (i === (drop < keep ? keep - 1 : keep) ? joined : w));
      merged = true;
      changed = true;
      break;
    }
    if (!merged) break;
  }
  // 4. final cleanup (merging may create collinear points or zero-length leftovers)
  const final: Wire[] = [];
  for (const w of list) {
    const s = simplifyWire(w);
    if (s !== w) changed = true;
    if (s) final.push(s);
  }
  return changed ? final : wires;
}

/**
 * Junction dots: points where at least three connections meet (pass ordinary and bus wires
 * separately: they are different layers). Wire ends and pins count once,
 * a wire passing straight through such a point counts twice. Only points that hold at least one
 * wire end are considered (a wire crossing a pin or another wire is not a connection).
 */
export function junctionPoints(wires: Wire[], pins: Point[]): Point[] {
  const counts = new Map<string, { p: Point; n: number; wireEnds: number }>();
  const bump = (p: Point, isWireEnd: boolean) => {
    const k = pointKey(p);
    const e = counts.get(k);
    if (e) {
      e.n += 1;
      if (isWireEnd) e.wireEnds += 1;
    } else counts.set(k, { p, n: 1, wireEnds: isWireEnd ? 1 : 0 });
  };
  for (const w of wires) {
    if (w.points.length < 2) continue;
    const [a, b] = wireEnds(w);
    bump(a, true);
    bump(b, true);
  }
  for (const p of pins) bump(p, false);
  const out: Point[] = [];
  for (const e of counts.values()) {
    if (e.wireEnds === 0) continue;
    let n = e.n;
    for (const w of wires) if (onWireInterior(w, e.p)) n += 2;
    if (n >= 3) out.push(e.p);
  }
  return out;
}

/** Ids of wires that have an end exactly at `p`. */
export function wiresEndingAt(wires: Wire[], p: Point): string[] {
  return wires.filter((w) => w.points.length >= 2 && wireEnds(w).some((e) => samePoint(e, p))).map((w) => w.id);
}
