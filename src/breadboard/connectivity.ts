/**
 * Breadboard connectivity: which leads are electrically joined by the board.
 *
 * Every hole belongs to a strip (5 holes of a terminal column half, or one power rail). Part
 * leads, jumper-wire ends and clip leads in a strip are connected; jumpers join two strips and
 * extra physical leads of one logical pin (`<pin>~<k>` keys, e.g. the two common pins of a
 * 7-segment display) join their strips too. The result groups strips into breadboard nets.
 *
 * Leads in holes that do not exist (unknown board, column out of range, a rail gap) are returned
 * in `offBoard` and join nothing.
 */

import type { BoardInstance, BreadboardHole, BreadboardLayout } from './types';
import { boardMap, holeKey, stripIdOf } from './geometry';
import { logicalPin } from './leads';

export type LeadRef =
  | { kind: 'part'; refdes: string; key: string; pin: string; hole: BreadboardHole }
  | { kind: 'wire'; id: string; end: 'from' | 'to'; hole: BreadboardHole }
  | { kind: 'clip'; id: string; refdes: string; pin: string; hole: BreadboardHole };

export interface BbNet {
  id: number;
  strips: string[];
  leads: LeadRef[];
}

export interface BreadboardConnectivity {
  nets: BbNet[];
  /** strip id -> net id (only strips touched by a lead) */
  stripNet: Map<string, number>;
  /** hole key -> leads sitting in that hole */
  holeLeads: Map<string, LeadRef[]>;
  /** leads in holes that do not exist */
  offBoard: LeadRef[];
  boards: Map<string, BoardInstance>;
}

export const pinId = (refdes: string, pin: string): string => `${refdes}.${pin}`;

class UnionFind {
  private parent = new Map<string, string>();
  add(a: string): void {
    if (!this.parent.has(a)) this.parent.set(a, a);
  }
  find(a: string): string {
    this.add(a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let x = a;
    while (this.parent.get(x) !== r) {
      const n = this.parent.get(x)!;
      this.parent.set(x, r);
      x = n;
    }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  keys(): string[] {
    return [...this.parent.keys()];
  }
}

/** Strip of a hole on the layout's boards, or null. */
export function stripOfHole(boards: Map<string, BoardInstance>, h: BreadboardHole): string | null {
  const b = boards.get(h.board);
  return b ? stripIdOf(b, h.row, h.col) : null;
}

export function layoutLeads(layout: BreadboardLayout): LeadRef[] {
  const out: LeadRef[] = [];
  for (const p of layout.placements) {
    for (const [key, hole] of Object.entries(p.pins)) out.push({ kind: 'part', refdes: p.refdes, key, pin: logicalPin(key), hole });
  }
  for (const w of layout.wires) {
    out.push({ kind: 'wire', id: w.id, end: 'from', hole: w.from });
    out.push({ kind: 'wire', id: w.id, end: 'to', hole: w.to });
  }
  for (const c of layout.clips) out.push({ kind: 'clip', id: c.id, refdes: c.refdes, pin: c.pin, hole: c.hole });
  return out;
}

export function computeBreadboardConnectivity(layout: BreadboardLayout): BreadboardConnectivity {
  const boards = boardMap(layout);
  const uf = new UnionFind();
  const holeLeads = new Map<string, LeadRef[]>();
  const offBoard: LeadRef[] = [];
  const leadStrip = new Map<LeadRef, string>();
  const leads = layoutLeads(layout);

  for (const lead of leads) {
    const strip = stripOfHole(boards, lead.hole);
    if (!strip) {
      offBoard.push(lead);
      continue;
    }
    uf.add(strip);
    leadStrip.set(lead, strip);
    const k = holeKey(lead.hole);
    const arr = holeLeads.get(k);
    if (arr) arr.push(lead);
    else holeLeads.set(k, [lead]);
  }
  // jumpers
  for (const w of layout.wires) {
    const a = stripOfHole(boards, w.from);
    const b = stripOfHole(boards, w.to);
    if (a && b) uf.union(a, b);
  }
  // internal ties between physical leads of one logical pin
  const firstStripOfPin = new Map<string, string>();
  for (const lead of leads) {
    if (lead.kind !== 'part') continue;
    const s = leadStrip.get(lead);
    if (!s) continue;
    const id = pinId(lead.refdes, lead.pin);
    const prev = firstStripOfPin.get(id);
    if (prev) uf.union(prev, s);
    else firstStripOfPin.set(id, s);
  }

  const rootId = new Map<string, number>();
  const nets: BbNet[] = [];
  const stripNet = new Map<string, number>();
  for (const s of uf.keys()) {
    const r = uf.find(s);
    let id = rootId.get(r);
    if (id === undefined) {
      id = nets.length;
      rootId.set(r, id);
      nets.push({ id, strips: [], leads: [] });
    }
    nets[id].strips.push(s);
    stripNet.set(s, id);
  }
  for (const lead of leads) {
    const s = leadStrip.get(lead);
    if (s !== undefined) nets[stripNet.get(s)!].leads.push(lead);
  }
  return { nets, stripNet, holeLeads, offBoard, boards };
}

/** Breadboard net id of a hole (via its strip), or undefined when nothing is connected there. */
export function netOfHole(conn: BreadboardConnectivity, h: BreadboardHole): number | undefined {
  const s = stripOfHole(conn.boards, h);
  return s ? conn.stripNet.get(s) : undefined;
}

/** Breadboard net id of a part pin (logical pin name) or clip, or undefined. */
export function netOfPin(conn: BreadboardConnectivity, refdes: string, pin: string): number | undefined {
  for (const n of conn.nets) {
    if (n.leads.some((l) => (l.kind === 'part' || l.kind === 'clip') && l.refdes === refdes && l.pin === pin)) return n.id;
  }
  return undefined;
}
