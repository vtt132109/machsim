/**
 * Automatic breadboard layout: a clean, check-passing starting point built from the schematic.
 *
 * Strategy
 *   1. Supply nets: ground → '−' rails; the main positive supply (a DC source / battery whose −
 *      terminal is ground, a VCC/VDD power symbol, the hidden supply of logic ICs) → '+' rails; a
 *      negative supply (dual-supply op-amp circuits) → the bottom '−' rail, with ground moved to
 *      the bottom '+' rail. Every rail strip carrying a supply is reached by a short jumper.
 *   2. Parts in order: channel-straddling packages (DIP ICs, 7-segment displays …) first, then
 *      rigid inline packages (TO-92 / TO-220 / pots / switches), then bendable 2-lead parts,
 *      always picking next the part with most leads on nets already on the board.
 *      Each candidate position is scored: reusing a strip of the lead's net is free; a new strip
 *      costs 1, plus a rail jumper (supply nets) or a join jumper (a net already elsewhere).
 *      A strip takes at most 3 part leads, keeping holes for jumpers and clips.
 *   3. Off-board sources and instruments get clip leads: supply nets clip onto the rails, other
 *      nets onto a free hole of their strip.
 *   4. Jumpers: supply strips → rail; strips of one signal net → minimum spanning set of short
 *      jumpers; rails of one supply (top/bottom, split halves, other boards) → bridges.
 *   5. The result is verified with compareWithSchematic; if it is not clean (board too small),
 *      the layout is rebuilt on more boards.
 */

import type { Design, NetlistBuild } from '../model/types';
import { buildNetlist } from '../model/netlister';
import { parseUserNumber } from '../util/units';
import { defaultParams, getPart } from '../library';
import type { BoardInstance, BoardKind, BreadboardHole, BreadboardLayout, ClipLead, JumperWire, PartPlacement } from './types';
import { boardSpec, holeKey, LOWER_ROWS, UPPER_ROWS, type RailRow, type TerminalRow } from './geometry';
import { compareWithSchematic, expectedNets, physicalParts, type PhysicalPart } from './compare';
import { placeLeads } from './leads';

export interface AutoPlaceOptions {
  /** board kind for new boards (default 'full') */
  kind?: BoardKind;
  /** start from these boards (ids, kinds and split-rail settings are kept) */
  boards?: BoardInstance[];
  /** split power rails on new boards */
  splitRails?: boolean;
  /** maximum number of boards (default 4) */
  maxBoards?: number;
  build?: Pick<NetlistBuild, 'partNets' | 'nets'>;
}

export interface SupplyPlan {
  ground: string | null;
  positive: string | null;
  negative: string | null;
}

export interface AutoPlaceResult {
  layout: BreadboardLayout;
  /** refdes that could not be placed */
  unplaced: string[];
  supplies: SupplyPlan;
  /** errors + warnings reported by the circuit check on the result */
  issueCount: number;
}

export const WIRE_COLORS = {
  positive: '#d32f2f',
  ground: '#212121',
  negative: '#1565c0',
  // yellow, green, orange, violet, white, grey — never red / black / blue (reserved for supplies)
  signal: ['#fdd835', '#2e7d32', '#ef6c00', '#7b1fa2', '#eceff1', '#9e9e9e'],
};

// ---------------------------------------------------------------------------------------------
// supply detection

/** Pick the nets that go on the power rails. */
export function detectSupplies(design: Design, build: Pick<NetlistBuild, 'partNets' | 'nets'>, parts: PhysicalPart[]): SupplyPlan {
  const weight = new Map<string, number>();
  for (const p of parts) {
    if (p.map.mounting !== 'board') continue;
    for (const n of Object.values(expectedNets(p, build))) if (n) weight.set(n, (weight.get(n) ?? 0) + 1);
  }
  const pos = new Map<string, number>();
  const neg = new Map<string, number>();
  const vote = (m: Map<string, number>, n: string | undefined, w = 1) => {
    if (n && n !== '0') m.set(n, (m.get(n) ?? 0) + w);
  };
  for (const sheet of design.sheets) {
    for (const inst of sheet.parts) {
      const def = getPart(inst.partId);
      if (!def) continue;
      const params = { ...defaultParams(def), ...inst.params };
      const nets = build.partNets[inst.refdes] ?? {};
      if (def.globalNet !== undefined && def.globalNet !== '0') {
        const v = parseUserNumber(params.voltage ?? '0');
        if (v > 0) vote(pos, nets[def.symbol.pins[0]?.name ?? '1'], 2);
        else if (v < 0) vote(neg, nets[def.symbol.pins[0]?.name ?? '1'], 2);
        continue;
      }
      if (def.id !== 'sources/dc-voltage' && def.id !== 'sources/battery') continue;
      const v = parseUserNumber(params.value ?? '0');
      const plus = nets['+'];
      const minus = nets['-'];
      if (minus === '0' && plus && plus !== '0') vote(v >= 0 ? pos : neg, plus);
      else if (plus === '0' && minus && minus !== '0') vote(v >= 0 ? neg : pos, minus);
    }
  }
  for (const p of parts) {
    for (const [key, h] of Object.entries(p.map.hidden)) {
      if (h.role !== 'supply') continue;
      const n = expectedNets(p, build)[key];
      if (n && build.nets.some((x) => x.name === n)) vote(pos, n);
    }
  }
  const best = (m: Map<string, number>, exclude?: string | null): string | null => {
    let out: string | null = null;
    let score = -1;
    for (const [n, v] of m) {
      if (n === exclude) continue;
      const s = v * 100 + (weight.get(n) ?? 0);
      if (s > score) {
        score = s;
        out = n;
      }
    }
    return out;
  };
  const ground = weight.has('0') || parts.some((p) => Object.values(expectedNets(p, build)).includes('0')) ? '0' : null;
  const positive = best(pos);
  const negative = best(neg, positive);
  return { ground, positive, negative };
}

// ---------------------------------------------------------------------------------------------
// placement engine

interface Half {
  board: BoardInstance;
  boardIndex: number;
  side: 'ae' | 'fj';
  index: number;
  partRows: readonly TerminalRow[];
  jumperRows: readonly TerminalRow[];
}

interface StripState {
  id: string;
  half: Half;
  col: number;
  net: string | null;
  used: Set<TerminalRow>;
}

interface LeadChoice {
  key: string;
  net: string;
  hole: BreadboardHole;
  strip: StripState;
}

class Engine {
  readonly halves: Half[] = [];
  readonly strips = new Map<string, StripState>();
  readonly occupied = new Set<string>();
  /** holes under the body of an axial / radial part (no lead may go there) */
  readonly blocked = new Set<string>();
  readonly netStrips = new Map<string, StripState[]>();
  readonly covered = new Map<number, Set<number>>();
  readonly placements: PartPlacement[] = [];
  readonly wires: JumperWire[] = [];
  readonly clips: ClipLead[] = [];
  readonly usedRails = new Map<string, Set<string>>();
  private readonly bridgeCols = new Map<string, Set<number>>();
  readonly hasRails: boolean;
  private signalColor = 0;
  private readonly netColor = new Map<string, string>();

  constructor(
    readonly boards: BoardInstance[],
    readonly supplies: SupplyPlan,
  ) {
    boards.forEach((board, bi) => {
      this.halves.push({ board, boardIndex: bi, side: 'ae', index: this.halves.length, partRows: ['e', 'd', 'c', 'b', 'a'], jumperRows: ['a', 'b', 'c', 'd', 'e'] });
      this.halves.push({ board, boardIndex: bi, side: 'fj', index: this.halves.length, partRows: ['f', 'g', 'h', 'i', 'j'], jumperRows: ['j', 'i', 'h', 'g', 'f'] });
    });
    this.hasRails = boards.every((b) => boardSpec(b.kind).hasRails);
  }

  // ---- rails ----
  isRailNet(net: string): boolean {
    if (!this.hasRails) return false;
    const s = this.supplies;
    return net === s.ground || net === s.positive || net === s.negative;
  }

  private dual(): boolean {
    return this.supplies.negative !== null;
  }

  /** Rail rows carrying a supply net, nearest first for the given half side. */
  railRows(net: string, side: 'ae' | 'fj'): RailRow[] {
    const s = this.supplies;
    let rows: RailRow[] = [];
    if (net === s.positive) rows = this.dual() ? ['top+'] : ['top+', 'bot+'];
    else if (net === s.ground) rows = this.dual() ? ['top-', 'bot+'] : ['top-', 'bot-'];
    else if (net === s.negative) rows = ['bot-'];
    const adjacent = (r: RailRow) => (side === 'ae' ? r.startsWith('top') : r.startsWith('bot'));
    return [...rows].sort((a, b) => Number(adjacent(b)) - Number(adjacent(a)));
  }

  railAdjacent(net: string, side: 'ae' | 'fj'): boolean {
    const r = this.railRows(net, side)[0];
    return r !== undefined && (side === 'ae' ? r.startsWith('top') : r.startsWith('bot'));
  }

  // ---- strips ----
  strip(half: Half, col: number): StripState {
    const id = `${half.board.id}:${col}:${half.side}`;
    let s = this.strips.get(id);
    if (!s) {
      s = { id, half, col, net: null, used: new Set() };
      this.strips.set(id, s);
    }
    return s;
  }

  fresh(s: StripState): boolean {
    return s.net === null && s.used.size === 0;
  }

  free(s: StripState): number {
    return 5 - s.used.size;
  }

  /** Can a part lead of `net` go into strip s at `row`? */
  leadOk(s: StripState, net: string, row: TerminalRow, minFree = 3): boolean {
    if (s.used.has(row) || this.blocked.has(this.key(s, row))) return false;
    if (this.fresh(s)) return true;
    return s.net === net && this.free(s) >= minFree;
  }

  private key(s: StripState, row: TerminalRow): string {
    return holeKey({ board: s.half.board.id, row, col: s.col });
  }

  /** Holes strictly between two leads in one row must be free (the body lies over them). */
  bodyClear(half: Half, row: TerminalRow, c1: number, c2: number): boolean {
    for (let c = Math.min(c1, c2) + 1; c < Math.max(c1, c2); c++) {
      if (this.occupied.has(holeKey({ board: half.board.id, row, col: c }))) return false;
    }
    return true;
  }

  leadCost(s: StripState, net: string): number {
    if (!this.fresh(s)) return 0;
    let c = 1;
    if (this.isRailNet(net)) c += this.railAdjacent(net, s.half.side) ? 3 : 6;
    else if ((this.netStrips.get(net)?.length ?? 0) > 0) c += 10;
    if (this.covered.get(s.half.index)?.has(s.col)) c += 2;
    return c;
  }

  claim(s: StripState, net: string, row: TerminalRow): BreadboardHole {
    if (this.fresh(s)) {
      s.net = net;
      const arr = this.netStrips.get(net);
      if (arr) arr.push(s);
      else this.netStrips.set(net, [s]);
    }
    s.used.add(row);
    const hole: BreadboardHole = { board: s.half.board.id, row, col: s.col };
    this.occupied.add(holeKey(hole));
    return hole;
  }

  positionCost(half: Half, col: number): number {
    // keep clear of the board end before the first rail hole so rail jumpers run straight
    const first = boardSpec(half.board.kind).railColumns[0] ?? 2;
    return 0.02 * col + 0.4 * half.index + (col < first ? (first - col) * 0.6 : 0);
  }

  // ---- placement ----
  commit(part: PhysicalPart, choices: LeadChoice[], rotation: number): void {
    const pins: Record<string, BreadboardHole> = {};
    for (const c of choices) pins[c.key] = this.claim(c.strip, c.net, c.hole.row as TerminalRow);
    const pl: PartPlacement = { refdes: part.refdes, pins };
    if (rotation) pl.rotation = rotation;
    this.placements.push(pl);
    if (part.map.flexible && choices.length === 2 && choices[0].strip.half === choices[1].strip.half) {
      const half = choices[0].strip.half;
      const a = Math.min(choices[0].strip.col, choices[1].strip.col);
      const b = Math.max(choices[0].strip.col, choices[1].strip.col);
      const set = this.covered.get(half.index) ?? new Set<number>();
      for (let c = a + 1; c < b; c++) {
        set.add(c);
        if (choices[0].hole.row === choices[1].hole.row) this.blocked.add(holeKey({ board: half.board.id, row: choices[0].hole.row, col: c }));
      }
      this.covered.set(half.index, set);
    }
  }

  placeFlexible(part: PhysicalPart, nets: Record<string, string>): boolean {
    const [l1, l2] = part.map.leads;
    const flex = part.map.flexible!;
    const n1 = nets[l1.key];
    const n2 = nets[l2.key];
    let best: { cost: number; choices: LeadChoice[]; rotation: number } | null = null;
    for (const half of this.halves) {
      const cols = boardSpec(half.board.kind).columns;
      for (let c1 = 1; c1 <= cols; c1++) {
        const s1 = this.strip(half, c1);
        if (!this.fresh(s1) && s1.net !== n1) continue;
        const cost1 = this.leadCost(s1, n1);
        for (let span = flex.min; span <= flex.max; span++) {
          for (const dir of [1, -1]) {
            const c2 = c1 + dir * span;
            if (c2 < 1 || c2 > cols) continue;
            const s2 = this.strip(half, c2);
            if (!this.fresh(s2) && s2.net !== n2) continue;
            const row = half.partRows.find((r) => this.leadOk(s1, n1, r) && this.leadOk(s2, n2, r) && this.bodyClear(half, r, c1, c2));
            if (!row) continue;
            // radial parts (LED, small capacitors) look wrong with splayed leads: stronger penalty
            const spanWeight = flex.min <= 1 ? 1.2 : 0.3;
            let cost = cost1 + this.leadCost(s2, n2) + spanWeight * Math.abs(span - flex.preferred) + this.positionCost(half, Math.min(c1, c2));
            if (this.fresh(s1) && this.fresh(s2) && n1 === n2) cost += 10;
            if (!best || cost < best.cost - 1e-9) {
              best = {
                cost,
                rotation: dir === 1 ? 0 : 180,
                choices: [
                  { key: l1.key, net: n1, hole: { board: half.board.id, row, col: c1 }, strip: s1 },
                  { key: l2.key, net: n2, hole: { board: half.board.id, row, col: c2 }, strip: s2 },
                ],
              };
            }
          }
        }
      }
    }
    if (!best) return false;
    this.commit(part, best.choices, best.rotation);
    return true;
  }

  placeRigid(part: PhysicalPart, nets: Record<string, string>): boolean {
    const map = part.map;
    let best: { cost: number; choices: LeadChoice[] } | null = null;
    for (const half of this.halves) {
      if (map.straddle && half.side !== 'fj') continue;
      const rows: readonly TerminalRow[] = map.straddle ? ['f'] : half.partRows;
      const cols = boardSpec(half.board.kind).columns;
      for (const row of rows) {
        for (let col = 1; col <= cols; col++) {
          const placed = placeLeads(map, half.board, { board: half.board.id, row, col }, 0);
          if (!placed.ok) continue;
          let cost = this.positionCost(half, col);
          const choices: LeadChoice[] = [];
          let ok = true;
          const freshNets = new Map<string, number>();
          for (const lead of map.leads) {
            const h = placed.pins[lead.key];
            const isUpper = UPPER_ROWS.includes(h.row as TerminalRow);
            const lh = this.halves.find((x) => x.board === half.board && x.side === (isUpper ? 'ae' : 'fj'))!;
            const s = this.strip(lh, h.col);
            const net = nets[lead.key];
            if (!LOWER_ROWS.includes(h.row as TerminalRow) && !isUpper) {
              ok = false;
              break;
            }
            if (!this.leadOk(s, net, h.row as TerminalRow) || choices.some((c) => c.strip === s && c.net !== net)) {
              ok = false;
              break;
            }
            if (this.fresh(s)) freshNets.set(net, (freshNets.get(net) ?? 0) + 1);
            cost += this.leadCost(s, net);
            choices.push({ key: lead.key, net, hole: h, strip: s });
          }
          if (!ok) continue;
          // two leads of one net landing in two new strips need a join
          for (const [net, k] of freshNets) if (k > 1 && !this.isRailNet(net)) cost += 10 * (k - 1);
          if (!best || cost < best.cost - 1e-9) best = { cost, choices };
        }
      }
    }
    if (!best) return false;
    this.commit(part, best.choices, 0);
    return true;
  }

  // ---- clips ----
  colorFor(net: string | null, pin?: string): string {
    const s = this.supplies;
    if (net !== null && net === s.ground) return WIRE_COLORS.ground;
    if (net !== null && net === s.positive) return WIRE_COLORS.positive;
    if (net !== null && net === s.negative) return WIRE_COLORS.negative;
    if (net === null) return pin === '-' ? WIRE_COLORS.ground : WIRE_COLORS.signal[0];
    let c = this.netColor.get(net);
    if (!c) {
      c = WIRE_COLORS.signal[this.signalColor++ % WIRE_COLORS.signal.length];
      this.netColor.set(net, c);
    }
    return c;
  }

  private markRail(net: string, board: BoardInstance, hole: BreadboardHole): void {
    const id = board.splitRails ? `${board.id}:${hole.row}:${railSideOf(board, hole.col)}` : `${board.id}:${hole.row}`;
    const set = this.usedRails.get(net) ?? new Set<string>();
    set.add(id);
    this.usedRails.set(net, set);
  }

  /** Free rail hole on `row` of a board, ordered by `order` of columns. */
  freeRailHole(board: BoardInstance, row: RailRow, order: number[]): BreadboardHole | null {
    for (const col of order) {
      const h: BreadboardHole = { board: board.id, row, col };
      if (!this.occupied.has(holeKey(h))) return h;
    }
    return null;
  }

  addClip(refdes: string, pin: string, net: string): boolean {
    const id = `c${this.clips.length + 1}`;
    if (this.isRailNet(net)) {
      const board = this.boards[0];
      const spec = boardSpec(board.kind);
      for (const row of this.railRows(net, 'ae')) {
        const h = this.freeRailHole(board, row, spec.railColumns);
        if (!h) continue;
        this.occupied.add(holeKey(h));
        this.markRail(net, board, h);
        this.clips.push({ id, refdes, pin, hole: h, color: this.colorFor(net, pin) });
        return true;
      }
      return false;
    }
    // an existing strip of the net with room
    const existing = (this.netStrips.get(net) ?? []).filter((s) => this.free(s) >= 3).sort((a, b) => a.half.index - b.half.index || a.col - b.col);
    for (const s of existing) {
      const row = s.half.jumperRows.find((r) => !s.used.has(r));
      if (!row) continue;
      const h = this.claim(s, net, row);
      this.clips.push({ id, refdes, pin, hole: h, color: this.colorFor(net, pin) });
      return true;
    }
    // a new strip near the net's strips (or the left end of the board)
    const anchor = this.netStrips.get(net)?.[0];
    let bestStrip: StripState | null = null;
    let bestD = Infinity;
    for (const half of this.halves) {
      const cols = boardSpec(half.board.kind).columns;
      for (let col = 1; col <= cols; col++) {
        const s = this.strip(half, col);
        if (!this.fresh(s)) continue;
        const d = anchor ? Math.abs(col - anchor.col) + (half === anchor.half ? 0 : 4) + Math.abs(half.boardIndex - anchor.half.boardIndex) * 50 : half.index * 100 + col;
        if (d < bestD) {
          bestD = d;
          bestStrip = s;
        }
      }
    }
    if (!bestStrip) return false;
    const h = this.claim(bestStrip, net, bestStrip.half.jumperRows[0]);
    this.clips.push({ id, refdes, pin, hole: h, color: this.colorFor(net, pin) });
    return true;
  }

  // ---- jumpers ----
  private addWire(from: BreadboardHole, to: BreadboardHole, color: string): void {
    this.occupied.add(holeKey(from));
    this.occupied.add(holeKey(to));
    this.wires.push({ id: `w${this.wires.length + 1}`, from, to, color });
  }

  private takeRow(s: StripState, rows: readonly TerminalRow[]): BreadboardHole | null {
    const row = rows.find((r) => !s.used.has(r) && !this.blocked.has(this.key(s, r))) ?? rows.find((r) => !s.used.has(r));
    if (!row) return null;
    s.used.add(row);
    const h: BreadboardHole = { board: s.half.board.id, row, col: s.col };
    this.occupied.add(holeKey(h));
    return h;
  }

  railJumpers(): boolean {
    for (const s of this.strips.values()) {
      if (s.net === null || !this.isRailNet(s.net)) continue;
      const board = s.half.board;
      const spec = boardSpec(board.kind);
      const row = this.railRows(s.net, s.half.side)[0];
      const order = [...spec.railColumns].sort((a, b) => Math.abs(a - s.col) - Math.abs(b - s.col) || a - b);
      const rh = this.freeRailHole(board, row, order);
      const sh = this.takeRow(s, s.half.jumperRows);
      if (!rh || !sh) return false;
      this.markRail(s.net, board, rh);
      this.addWire(sh, rh, this.colorFor(s.net));
    }
    return true;
  }

  signalJoins(): boolean {
    for (const [net, strips] of this.netStrips) {
      if (this.isRailNet(net) || strips.length < 2) continue;
      const inTree = [strips[0]];
      const rest = strips.slice(1);
      while (rest.length) {
        let best: { a: StripState; b: StripState; d: number } | null = null;
        for (const b of rest) {
          if (this.free(b) < 1) continue;
          for (const a of inTree) {
            if (this.free(a) < 1) continue;
            const d = Math.abs(a.col - b.col) + (a.half === b.half ? 0 : 3) + Math.abs(a.half.boardIndex - b.half.boardIndex) * 40;
            if (!best || d < best.d) best = { a, b, d };
          }
        }
        if (!best) return false;
        const same = best.a.half === best.b.half;
        const ha = this.takeRow(best.a, same ? best.a.half.jumperRows : best.a.half.partRows);
        const hb = this.takeRow(best.b, same ? best.b.half.jumperRows : best.b.half.partRows);
        if (!ha || !hb) return false;
        this.addWire(ha, hb, this.colorFor(net));
        inTree.push(best.b);
        rest.splice(rest.indexOf(best.b), 1);
      }
    }
    return true;
  }

  /** Connect every used rail strip of each supply net (top/bottom, split halves, other boards). */
  railBridges(): boolean {
    for (const net of [this.supplies.positive, this.supplies.ground, this.supplies.negative]) {
      if (net === null) continue;
      const used = this.usedRails.get(net);
      if (!used || used.size < 2) continue;
      // nodes: every rail strip of this net on every board
      const nodes: { id: string; board: BoardInstance; bi: number; row: RailRow; half?: 'L' | 'R' }[] = [];
      this.boards.forEach((board, bi) => {
        const rows = [...new Set([...this.railRows(net, 'ae'), ...this.railRows(net, 'fj')])];
        for (const row of rows) {
          if (board.splitRails) for (const half of ['L', 'R'] as const) nodes.push({ id: `${board.id}:${row}:${half}`, board, bi, row, half });
          else nodes.push({ id: `${board.id}:${row}`, board, bi, row });
        }
      });
      type Node = (typeof nodes)[number];
      const edgeCost = (a: Node, b: Node): number | null => {
        if (a.bi === b.bi) {
          if (a.row === b.row) return a.half && b.half && a.half !== b.half ? 1 : null;
          if (a.half !== b.half) return null;
          return 2;
        }
        if (a.row === b.row && a.half === b.half && Math.abs(a.bi - b.bi) === 1) return 6;
        return null;
      };
      const usedIds = [...used];
      const tree = new Set<string>([usedIds[0]]);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      for (const target of usedIds.slice(1)) {
        if (tree.has(target)) continue;
        // Dijkstra from the tree to target over the node graph
        const dist = new Map<string, number>();
        const prev = new Map<string, string>();
        const queue = new Set<string>(nodes.map((n) => n.id));
        for (const t of tree) dist.set(t, 0);
        while (queue.size) {
          let u: string | null = null;
          for (const q of queue) if (dist.has(q) && (u === null || dist.get(q)! < dist.get(u)!)) u = q;
          if (u === null) break;
          queue.delete(u);
          if (u === target) break;
          for (const v of nodes) {
            if (!queue.has(v.id)) continue;
            const c = edgeCost(byId.get(u)!, v);
            if (c === null) continue;
            const nd = dist.get(u)! + c;
            if (nd < (dist.get(v.id) ?? Infinity)) {
              dist.set(v.id, nd);
              prev.set(v.id, u);
            }
          }
        }
        if (!dist.has(target)) return false;
        let cur = target;
        while (!tree.has(cur)) {
          const p = prev.get(cur)!;
          if (!this.bridge(byId.get(p)!, byId.get(cur)!, net)) return false;
          tree.add(cur);
          cur = p;
        }
      }
    }
    return true;
  }

  private bridge(a: { board: BoardInstance; row: RailRow; half?: 'L' | 'R' }, b: { board: BoardInstance; row: RailRow; half?: 'L' | 'R' }, net: string): boolean {
    const color = this.colorFor(net);
    const colsOf = (board: BoardInstance, half?: 'L' | 'R') => boardSpec(board.kind).railColumns.filter((c) => !half || railSideOf(board, c) === half);
    if (a.board === b.board && a.row === b.row) {
      // split halves of one rail: holes next to the gap
      const left = a.half === 'L' ? a : b;
      const right = a.half === 'L' ? b : a;
      const h1 = this.freeRailHole(left.board, left.row, [...colsOf(left.board, 'L')].reverse());
      const h2 = this.freeRailHole(right.board, right.row, colsOf(right.board, 'R'));
      if (!h1 || !h2) return false;
      this.addWire(h1, h2, color);
      return true;
    }
    if (a.board === b.board) {
      // top <-> bottom rail at the right-most free column (distinct per board)
      const used = this.bridgeCols.get(a.board.id) ?? new Set<number>();
      const cols = [...colsOf(a.board, a.half)].reverse();
      for (const col of cols) {
        if (used.has(col)) continue;
        const h1: BreadboardHole = { board: a.board.id, row: a.row, col };
        const h2: BreadboardHole = { board: b.board.id, row: b.row, col };
        if (this.occupied.has(holeKey(h1)) || this.occupied.has(holeKey(h2))) continue;
        used.add(col);
        this.bridgeCols.set(a.board.id, used);
        this.addWire(h1, h2, color);
        return true;
      }
      return false;
    }
    const h1 = this.freeRailHole(a.board, a.row, colsOf(a.board, a.half));
    const h2 = this.freeRailHole(b.board, b.row, colsOf(b.board, b.half));
    if (!h1 || !h2) return false;
    this.addWire(h1, h2, color);
    return true;
  }
}

function railSideOf(board: BoardInstance, col: number): 'L' | 'R' {
  const spec = boardSpec(board.kind);
  const lastLeft = spec.railGroups[spec.splitAfterGroup - 1];
  return lastLeft && col <= lastLeft[lastLeft.length - 1] ? 'L' : 'R';
}

// ---------------------------------------------------------------------------------------------

function boardsFor(opts: AutoPlaceOptions, count: number): BoardInstance[] {
  const base = opts.boards?.length ? opts.boards.map((b) => ({ ...b })) : [];
  const kind = opts.kind ?? base[0]?.kind ?? 'full';
  if (!base.length) base.push({ id: 'bb1', kind, x: 0, y: 0, ...(opts.splitRails ? { splitRails: true } : {}) });
  let n = 1;
  while (base.length < count) {
    const last = base[base.length - 1];
    const gap = 12;
    let id = `bb${base.length + n}`;
    while (base.some((b) => b.id === id)) id = `bb${base.length + ++n}`;
    base.push({ id, kind, x: last.x, y: last.y + boardSpec(last.kind).height + gap, ...(opts.splitRails || last.splitRails ? { splitRails: true } : {}) });
  }
  return base;
}

const categoryOf = (p: PhysicalPart): number => (p.map.straddle ? 0 : !p.map.flexible && p.map.leads.length >= 3 ? 1 : 2);

function attempt(design: Design, build: Pick<NetlistBuild, 'partNets' | 'nets'>, parts: PhysicalPart[], supplies: SupplyPlan, boards: BoardInstance[]): { layout: BreadboardLayout; unplaced: string[] } {
  const engine = new Engine(boards, supplies);
  const onBoard = parts.filter((p) => p.map.mounting === 'board' && p.map.leads.length > 0);
  const netsOf = new Map<string, Record<string, string>>();
  for (const p of onBoard) {
    const exp = expectedNets(p, build);
    const nets: Record<string, string> = {};
    for (const l of p.map.leads) nets[l.key] = exp[l.key] ?? `nc:${p.refdes}:${l.key}`;
    netsOf.set(p.refdes, nets);
  }
  const unplaced: string[] = [];
  const remaining = [...onBoard];
  while (remaining.length) {
    const cat = Math.min(...remaining.map(categoryOf));
    const pool = remaining.filter((p) => categoryOf(p) === cat);
    // most leads on nets already on the board first, then larger parts, then schematic order
    let pick = pool[0];
    let bestScore = -1;
    for (const p of pool) {
      const nets = netsOf.get(p.refdes)!;
      const linked = Object.values(nets).filter((n) => !engine.isRailNet(n) && (engine.netStrips.get(n)?.length ?? 0) > 0).length;
      const score = cat === 0 ? p.map.leads.length : linked * 100 + p.map.leads.length;
      if (score > bestScore) {
        bestScore = score;
        pick = p;
      }
    }
    remaining.splice(remaining.indexOf(pick), 1);
    const nets = netsOf.get(pick.refdes)!;
    const ok = pick.map.flexible && pick.map.leads.length === 2 ? engine.placeFlexible(pick, nets) || engine.placeRigid(pick, nets) : engine.placeRigid(pick, nets);
    if (!ok) unplaced.push(pick.refdes);
  }

  // supply strips -> rails first, so the jumpers run straight; clips take the remaining rail holes
  let ok = engine.railJumpers();

  // clip leads for off-board parts
  const pinCount = new Map<string, number>();
  for (const p of parts) for (const n of Object.values(expectedNets(p, build))) if (n) pinCount.set(n, (pinCount.get(n) ?? 0) + 1);
  for (const p of parts) {
    if (p.map.mounting !== 'offboard') continue;
    const exp = expectedNets(p, build);
    for (const pin of p.map.offboardPins) {
      const net = exp[pin];
      if (net === null || (pinCount.get(net) ?? 0) < 2) continue;
      if (!engine.addClip(p.refdes, pin, net)) unplaced.push(`${p.refdes}.${pin}`);
    }
  }

  ok = ok && engine.signalJoins() && engine.railBridges();
  if (!ok) unplaced.push('(wiring)');
  return { layout: { version: 1, boards, placements: engine.placements, wires: engine.wires, clips: engine.clips }, unplaced };
}

/** Full auto-placement report. */
export function autoPlaceDetailed(design: Design, opts: AutoPlaceOptions = {}): AutoPlaceResult {
  const build = opts.build ?? buildNetlist(design, { includeAnalysis: false });
  const parts = physicalParts(design);
  const supplies0 = detectSupplies(design, build, parts);
  const maxBoards = Math.max(1, opts.maxBoards ?? 4);
  let best: AutoPlaceResult | null = null;
  const start = Math.max(1, opts.boards?.length ?? 1);
  for (let count = start; count <= Math.max(start, maxBoards); count++) {
    const boards = boardsFor(opts, count);
    const hasRails = boards.every((b) => boardSpec(b.kind).hasRails);
    const supplies = hasRails ? supplies0 : { ground: null, positive: null, negative: null };
    const { layout, unplaced } = attempt(design, build, parts, supplies, boards);
    const check = compareWithSchematic(design, layout, { build });
    const result: AutoPlaceResult = { layout, unplaced, supplies, issueCount: check.issues.length };
    if (!best || result.issueCount < best.issueCount) best = result;
    if (result.issueCount === 0 && unplaced.length === 0) return result;
  }
  return best!;
}

/** Auto-placed breadboard layout for a design (see module comment). */
export function autoPlace(design: Design, opts: AutoPlaceOptions = {}): BreadboardLayout {
  return autoPlaceDetailed(design, opts).layout;
}
