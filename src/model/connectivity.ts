/**
 * Schematic connectivity of one design level (the root design or one child design): groups
 * wires, pins, net labels, connectors, bus lines and global (power) nets into nets with a
 * union-find structure.
 *
 * Connection rules (per sheet unless stated otherwise). They are the editor's rules
 * (src/ui/store/wireOps.ts, src/ui/store/connectivity.ts), so what the schematic shows — nets
 * view, junction dots — is what gets simulated:
 * - All segments of one wire are one conductor.
 * - A wire END lying anywhere on another wire (vertex or segment interior) connects the two
 *   wires (T-junction); coincident ends connect.
 * - Wires that merely cross or touch at interior points (including two interior corners at the
 *   same point) do NOT connect.
 * - A pin connects to the wires that END at its position and to every other pin at the same
 *   position. A wire passing over a pin (segment interior or interior corner) does not connect
 *   to it; such pins are reported in `pinsOnWire` (the netlister turns them into ERC warnings).
 * - A net label / connector connects to the wire (anywhere on it) / pin at its position.
 * - Names (case-insensitive; "0" / "gnd" are always ground), see LabelKind in types.ts:
 *   on one sheet every named item with the same name is one net. A plain label is local to its
 *   sheet unless `global`; off-page connectors join the same name on every sheet of this level;
 *   hierarchical connectors are the level's ports (`ConnNet.ports`) and join the same name on
 *   every sheet of this level; global labels / connectors and power symbols (PartDef.globalNet)
 *   join the global name (`ConnNet.globals`), which the netlister shares between levels.
 * - Bus wires (`Wire.bus`) are a separate layer: bus wires connect to bus wires only. Bus lines
 *   are sheet-local names: a bus entry (label kind 'bus-entry') at a point on a bus joins the
 *   wire / pin there to the line it names. Labels / connectors standing on a bus (and not on an
 *   ordinary wire or pin) name the bus; a connector with a bus name joins every line it lists.
 *   Bus pins of blocks (`PlacedPartInfo.busPins`) join the lines of the bus at the pin by
 *   position (pin keys `${part}:${pin}#${line index}`).
 *
 * Current / power probes split the wire under them (`CutRequest`): the wire is cut at the probe
 * point into piece A (towards points[0] of the wire) and piece B (towards the last point). All
 * cuts of one wire are applied in a single pass, so n probes on a wire give n + 1 pieces, each
 * probe sitting between its two neighbouring pieces. Wire ends and labels sitting exactly on an
 * interior cut point stay on side A. The returned `splits` give the nets of both sides; the
 * netlister inserts a 0 V source A -> B, so the probe current is positive in the wire's point
 * order (Probe contract in src/model/types.ts).
 *
 * Points are matched with a 0.5-unit tolerance (geometry.ts). Results are deterministic: nets are
 * numbered by first appearance in (sheet order, part order, pin order, label order, wire order).
 */

import type { PartDef } from '../library/types';
import { isGroundNode } from '../sim/netlist';
import { parseBusName } from './bus';
import { pointOnSegment, samePoint, type PlacedPin } from './geometry';
import type { Design, LabelKind, PartInstance, Point } from './types';

/** A part instance with its placed pins (empty when the part id is unknown). */
export interface PlacedPartInfo {
  /** index in the flattened (all sheets) part list */
  index: number;
  sheetId: string;
  inst: PartInstance;
  def: PartDef | undefined;
  pins: PlacedPin[];
  /**
   * Bus pins (blocks with vector ports): pin name -> the port's line names. Such a pin gets one
   * net per line instead of a single net (pin keys `${index}:${pin}#${line index}`).
   */
  busPins?: Map<string, string[]>;
}

export interface CutRequest {
  probeId: string;
  sheetId: string;
  x: number;
  y: number;
}

export interface ConnPinRef {
  part: number;
  pin: string;
  sheetId: string;
  x: number;
  y: number;
}

export interface ConnLabelRef {
  sheetId: string;
  id: string;
  name: string;
  x: number;
  y: number;
  /** label kind (absent = plain label) */
  kind?: LabelKind;
  /** plain label marked global */
  global?: boolean;
}

export interface ConnNet {
  id: number;
  pins: ConnPinRef[];
  labels: ConnLabelRef[];
  /** global net names (as written in PartDef.globalNet / label text, first spelling kept) */
  globals: string[];
  wires: { sheetId: string; wireId: string }[];
  /** joined to ground ("0") by a ground symbol or a "0"/"gnd" label */
  ground: boolean;
  /** port (hierarchical connector) names of this level on this net, first spelling kept */
  ports: string[];
}

/** Connected bus wires of one sheet. */
export interface BusGroup {
  id: number;
  sheetId: string;
  wireIds: string[];
  /** bus names given by the wires' busName and by labels / connectors standing on the bus */
  names: string[];
  /** bus lines (union of the names' lines, first appearance order) */
  members: string[];
}

/** Bus problems found while connecting (the netlister turns them into ERC messages). */
export interface BusIssue {
  kind:
    | 'badName' // a bus / connector name with invalid bus syntax
    | 'entryOffBus' // bus entry not on a bus wire
    | 'entryUnknownLine' // bus entry names a line the bus does not have
    | 'wireOnBus' // ordinary wire ends on a bus without a bus entry
    | 'busNames' // connected bus wires carry different names
    | 'busPinNoBus' // block bus pin without a bus at the pin
    | 'busPinWidth' // bus at a block bus pin has a different number of lines
    | 'busPinUnnamed'; // bus at a block bus pin has no line names
  sheetId: string;
  x: number;
  y: number;
  name?: string;
  /** names / numbers for the message */
  detail?: string;
}

export interface SenseSplit {
  probeId: string;
  /** net of side A (towards the wire's first point) */
  netA: number;
  /** net of side B */
  netB: number;
}

export interface DanglingEnd {
  sheetId: string;
  wireId: string;
  x: number;
  y: number;
}

/** A pin lying on a wire's interior (or interior corner) that is not connected to that wire. */
export interface PinOnWire {
  sheetId: string;
  /** part index (as in PlacedPartInfo.index) */
  part: number;
  pin: string;
  wireId: string;
  x: number;
  y: number;
}

export interface ConnectivityResult {
  nets: ConnNet[];
  /** `${part index}:${pin name}` -> net id */
  pinNet: Map<string, number>;
  /** probe id -> split nets */
  splits: Map<string, SenseSplit>;
  /** probes whose cut point is not on a wire */
  unplacedCuts: string[];
  dangling: DanglingEnd[];
  /** pins that a wire passes over without connecting (one entry per pin and wire) */
  pinsOnWire: PinOnWire[];
  /** net under a point of a sheet (pin first, then wire, then label), undefined when nothing is there */
  netAt(sheetId: string, p: Point): number | undefined;
  /** bus wires grouped per sheet */
  buses: BusGroup[];
  /** bus under a point of a sheet */
  busAt(sheetId: string, p: Point): BusGroup | undefined;
  busIssues: BusIssue[];
  /** net of a name on a sheet (labels, connectors, bus lines), undefined when nothing uses it */
  netOfName(sheetId: string, name: string): number | undefined;
}

export const pinKey = (part: number, pin: string): string => `${part}:${pin}`;

// ---------------------------------------------------------------------------
// Union-find
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[] = [];
  private rank: number[] = [];

  add(): number {
    this.parent.push(this.parent.length);
    this.rank.push(0);
    return this.parent.length - 1;
  }

  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r];
    let c = i;
    while (this.parent[c] !== r) {
      const n = this.parent[c];
      this.parent[c] = r;
      c = n;
    }
    return r;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

// ---------------------------------------------------------------------------
// Wire pieces and spatial lookup
// ---------------------------------------------------------------------------

interface Piece {
  node: number;
  sheetId: string;
  wireId: string;
  points: Point[];
  /** first / last point is a probe cut: it connects to nothing geometrically */
  cutStart: boolean;
  cutEnd: boolean;
  /** first / last point was created by a probe cut (never reported as a dangling end) */
  splitStart: boolean;
  splitEnd: boolean;
  /** created for a cut at a wire end (single point) */
  synthetic: boolean;
}

const keyOf = (p: Point): string => `${Math.round(p.x)},${Math.round(p.y)}`;

function dedupePoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || !samePoint(out[out.length - 1], p)) out.push({ x: p.x, y: p.y });
  return out;
}

function isCutPoint(piece: Piece, p: Point): boolean {
  return (piece.cutStart && samePoint(piece.points[0], p)) || (piece.cutEnd && samePoint(piece.points[piece.points.length - 1], p));
}

/** Pieces of one sheet with segment buckets (horizontal by y, vertical by x, others in a list). */
class SheetGeometry {
  readonly pieces: Piece[] = [];
  private horiz = new Map<number, [Piece, Point, Point][]>();
  private vert = new Map<number, [Piece, Point, Point][]>();
  private other: [Piece, Point, Point][] = [];
  private singles: Piece[] = [];

  private order = new Map<Piece, number>();

  index(): void {
    this.horiz.clear();
    this.vert.clear();
    this.other = [];
    this.singles = [];
    this.order.clear();
    this.pieces.forEach((pc, i) => this.order.set(pc, i));
    for (const pc of this.pieces) {
      if (pc.points.length === 1) {
        this.singles.push(pc);
        continue;
      }
      for (let i = 0; i + 1 < pc.points.length; i++) {
        const a = pc.points[i];
        const b = pc.points[i + 1];
        const seg: [Piece, Point, Point] = [pc, a, b];
        if (Math.abs(a.y - b.y) <= 0.5) push(this.horiz, Math.round(a.y), seg);
        else if (Math.abs(a.x - b.x) <= 0.5) push(this.vert, Math.round(a.x), seg);
        else this.other.push(seg);
      }
    }
  }

  /** Pieces whose conductor contains p (cut endpoints excluded), in piece order, unique. */
  piecesAt(p: Point): Piece[] {
    const hits = new Set<Piece>();
    const test = (segs: [Piece, Point, Point][] | undefined) => {
      if (!segs) return;
      for (const [pc, a, b] of segs) if (!hits.has(pc) && pointOnSegment(p, a, b) && !isCutPoint(pc, p)) hits.add(pc);
    };
    const ry = Math.round(p.y);
    const rx = Math.round(p.x);
    for (const d of [-1, 0, 1]) {
      test(this.horiz.get(ry + d));
      test(this.vert.get(rx + d));
    }
    test(this.other);
    for (const pc of this.singles) if (!hits.has(pc) && samePoint(pc.points[0], p) && !isCutPoint(pc, p)) hits.add(pc);
    return [...hits].sort((a, b) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0));
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/**
 * Points of a piece through which it connects to pins and to other wires: the ENDS of the
 * original wire. Ends created by a probe cut are internal (a cut end connects to nothing; the
 * A-side end of an interior cut only receives T-junctions and labels). A synthetic single-point
 * piece (cut at a wire end) stands for that original end.
 */
function isConnectingEnd(pc: Piece, p: Point): boolean {
  if (pc.synthetic) return !pc.splitStart && samePoint(pc.points[0], p);
  const last = pc.points.length - 1;
  return (!pc.cutStart && !pc.splitStart && samePoint(pc.points[0], p)) || (!pc.cutEnd && !pc.splitEnd && samePoint(pc.points[last], p));
}

function connectingEnds(pc: Piece): Point[] {
  if (pc.synthetic) return pc.splitStart ? [] : [pc.points[0]];
  const ends: Point[] = [];
  if (!pc.cutStart && !pc.splitStart) ends.push(pc.points[0]);
  if (!pc.cutEnd && !pc.splitEnd && pc.points.length > 1) ends.push(pc.points[pc.points.length - 1]);
  return ends;
}

interface CutResult {
  /** the piece that was split (no longer in the geometry) */
  old: Piece;
  a: Piece;
  b: Piece;
}

/**
 * Split the piece containing the cut point. Returns the new sides A / B (and the piece they
 * replace) or null when the point is not on a wire (or sits on an existing cut end).
 */
function applyCut(geom: SheetGeometry, uf: UnionFind, p: Point): CutResult | null {
  for (let idx = 0; idx < geom.pieces.length; idx++) {
    const pc = geom.pieces[idx];
    const pts = pc.points;
    if (pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (!pointOnSegment(p, pts[i], pts[i + 1]) || isCutPoint(pc, p)) continue;
      const mk = (points: Point[], cut: [boolean, boolean], split: [boolean, boolean], synthetic: boolean): Piece => ({
        node: uf.add(),
        sheetId: pc.sheetId,
        wireId: pc.wireId,
        points,
        cutStart: cut[0],
        cutEnd: cut[1],
        splitStart: split[0],
        splitEnd: split[1],
        synthetic,
      });
      let a: Piece;
      let b: Piece;
      const q = { x: p.x, y: p.y };
      // a synthetic single-point piece keeps the split flag of the end it replaces, so it is a
      // connecting end exactly when that end was an original wire end
      if (samePoint(p, pts[0])) {
        a = mk([q], [false, false], [pc.splitStart, pc.splitStart], true);
        b = mk(pts, [true, pc.cutEnd], [true, pc.splitEnd], pc.synthetic);
      } else if (samePoint(p, pts[pts.length - 1])) {
        a = mk(pts, [pc.cutStart, true], [pc.splitStart, true], pc.synthetic);
        b = mk([q], [false, false], [pc.splitEnd, pc.splitEnd], true);
      } else {
        const head = pts.slice(0, i + 1);
        const tail = pts.slice(i + 1);
        const aPts = samePoint(head[head.length - 1], p) ? head : [...head, q];
        const bPts = samePoint(tail[0], p) ? tail : [q, ...tail];
        a = mk(aPts, [pc.cutStart, false], [pc.splitStart, true], pc.synthetic);
        b = mk(bPts, [true, pc.cutEnd], [true, pc.splitEnd], pc.synthetic);
      }
      // the two sides get fresh union-find nodes so they stay apart; the old node is dropped
      geom.pieces.splice(idx, 1, a, b);
      return { old: pc, a, b };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/** Bus wires of one sheet with their connected groups. */
interface SheetBuses {
  geom: SheetGeometry;
  /** piece -> group index */
  groupOf: Map<Piece, number>;
}

/**
 * Connectivity of the sheets of one design level (pass the Design for the root, or a child
 * design's `{ sheets }`). See the module header for the rules.
 */
export function computeConnectivity(design: Pick<Design, 'sheets'>, parts: PlacedPartInfo[], cuts: CutRequest[]): ConnectivityResult {
  const uf = new UnionFind();
  const globalNode = new Map<string, number>();
  const globalSpelling = new Map<string, string>();
  const groundNode = uf.add();
  const globalOf = (name: string): number => {
    const trimmed = name.trim();
    if (isGroundNode(trimmed)) return groundNode;
    const k = trimmed.toLowerCase();
    let n = globalNode.get(k);
    if (n === undefined) {
      n = uf.add();
      globalNode.set(k, n);
      globalSpelling.set(k, trimmed);
    }
    return n;
  };
  // sheet-local names, off-page names and ports of this level
  const sheetNameNodes = new Map<string, number>();
  const sheetNameOf = (sheetId: string, name: string): number => {
    const trimmed = name.trim();
    if (isGroundNode(trimmed)) return groundNode;
    const k = `${sheetId}\u0000${trimmed.toLowerCase()}`;
    let n = sheetNameNodes.get(k);
    if (n === undefined) {
      n = uf.add();
      sheetNameNodes.set(k, n);
    }
    return n;
  };
  const offpageNodes = new Map<string, number>();
  const offpageOf = (name: string): number => {
    const trimmed = name.trim();
    if (isGroundNode(trimmed)) return groundNode;
    const k = trimmed.toLowerCase();
    let n = offpageNodes.get(k);
    if (n === undefined) {
      n = uf.add();
      offpageNodes.set(k, n);
    }
    return n;
  };
  const portNodes = new Map<string, number>();
  const portSpelling = new Map<string, string>();
  const portOf = (name: string): number => {
    const trimmed = name.trim();
    if (isGroundNode(trimmed)) return groundNode;
    const k = trimmed.toLowerCase();
    let n = portNodes.get(k);
    if (n === undefined) {
      n = uf.add();
      portNodes.set(k, n);
      portSpelling.set(k, trimmed);
    }
    return n;
  };
  /** join a name of an item on a sheet into the namespaces its kind reaches */
  const joinName = (node: number, sheetId: string, name: string, kind: LabelKind, global: boolean) => {
    uf.union(node, sheetNameOf(sheetId, name));
    if (kind === 'offpage') uf.union(node, offpageOf(name));
    else if (kind === 'hier') uf.union(node, portOf(name));
    else if (kind === 'global' || (kind === 'label' && global)) uf.union(node, globalOf(name));
  };

  const pinNodes = new Map<string, number>();
  const partsBySheet = new Map<string, PlacedPartInfo[]>();
  for (const p of parts) {
    push(partsBySheet, p.sheetId, p);
    for (const pin of p.pins) {
      const lines = p.busPins?.get(pin.name);
      if (lines) lines.forEach((_m, i) => pinNodes.set(pinKey(p.index, `${pin.name}#${i}`), uf.add()));
      else pinNodes.set(pinKey(p.index, pin.name), uf.add());
    }
  }

  const geoms = new Map<string, SheetGeometry>();
  const busGeoms = new Map<string, SheetBuses>();
  const buses: BusGroup[] = [];
  const busIssues: BusIssue[] = [];
  const labelNodes = new Map<string, number>();
  const pinAtKey = new Map<string, Map<string, number[]>>();
  const labelAtKey = new Map<string, Map<string, number[]>>();
  const splits = new Map<string, SenseSplit>();
  const splitPieces = new Map<string, [Piece, Piece]>();
  const unplacedCuts: string[] = [];
  const dangling: DanglingEnd[] = [];
  const overPins: { node: number; piece: Piece; part: number; pin: string; x: number; y: number }[] = [];

  for (const sheet of design.sheets) {
    const geom = new SheetGeometry();
    geoms.set(sheet.id, geom);
    const busGeom = new SheetGeometry();
    for (const w of sheet.wires) {
      const pts = dedupePoints(w.points);
      if (pts.length === 0) continue;
      (w.bus ? busGeom : geom).pieces.push({
        node: w.bus ? -1 : uf.add(),
        sheetId: sheet.id,
        wireId: w.id,
        points: pts,
        cutStart: false,
        cutEnd: false,
        splitStart: false,
        splitEnd: false,
        synthetic: false,
      });
    }
    const sheetSplits: [string, CutResult][] = [];
    for (const c of cuts) {
      if (c.sheetId !== sheet.id) continue;
      const res = applyCut(geom, uf, { x: c.x, y: c.y });
      if (!res) {
        unplacedCuts.push(c.probeId);
        continue;
      }
      // A later cut may split a side of an earlier one. The earlier cut point is the END of its
      // side A and the START of its side B, so it now belongs to the new piece B resp. A.
      for (const [, s] of sheetSplits) {
        if (s.a === res.old) s.a = res.b;
        if (s.b === res.old) s.b = res.a;
      }
      sheetSplits.push([c.probeId, res]);
    }
    for (const [probeId, s] of sheetSplits) splitPieces.set(probeId, [s.a, s.b]);
    geom.index();
    busGeom.index();

    // ---- bus groups (bus wire ends on bus wires connect) ----
    const groupOf = new Map<Piece, number>();
    if (busGeom.pieces.length) {
      const local = new UnionFind();
      const ids = new Map<Piece, number>();
      for (const pc of busGeom.pieces) ids.set(pc, local.add());
      for (const pc of busGeom.pieces) {
        for (const e of connectingEnds(pc)) for (const other of busGeom.piecesAt(e)) if (other !== pc) local.union(ids.get(pc)!, ids.get(other)!);
      }
      const rootGroup = new Map<number, BusGroup>();
      for (const pc of busGeom.pieces) {
        const root = local.find(ids.get(pc)!);
        let g = rootGroup.get(root);
        if (!g) {
          g = { id: buses.length, sheetId: sheet.id, wireIds: [], names: [], members: [] };
          rootGroup.set(root, g);
          buses.push(g);
        }
        groupOf.set(pc, g.id);
        if (!g.wireIds.includes(pc.wireId)) g.wireIds.push(pc.wireId);
        const w = sheet.wires.find((x) => x.id === pc.wireId);
        const bn = w?.busName?.trim();
        if (bn && !g.names.some((n) => n.toLowerCase() === bn.toLowerCase())) g.names.push(bn);
      }
    }
    busGeoms.set(sheet.id, { geom: busGeom, groupOf });
    const busAtPoint = (p: Point): BusGroup | undefined => {
      const pc = busGeom.piecesAt(p)[0];
      return pc ? buses[groupOf.get(pc)!] : undefined;
    };

    // wire <-> wire: an original wire end lying anywhere on another wire (T-junction / coincident
    // ends). Interior points that merely touch (crossings, coinciding corners) do not connect.
    for (const pc of geom.pieces) {
      for (const e of connectingEnds(pc)) for (const other of geom.piecesAt(e)) if (other !== pc) uf.union(pc.node, other.node);
    }

    // pins: connect to wires ending at the pin; wires passing over it are remembered for ERC
    const pinMap = new Map<string, number[]>();
    pinAtKey.set(sheet.id, pinMap);
    const busPinsHere: { part: PlacedPartInfo; pin: PlacedPin; lines: string[] }[] = [];
    for (const part of partsBySheet.get(sheet.id) ?? []) {
      for (const pin of part.pins) {
        const lines = part.busPins?.get(pin.name);
        if (lines) {
          busPinsHere.push({ part, pin, lines });
          continue;
        }
        const node = pinNodes.get(pinKey(part.index, pin.name))!;
        const pt = { x: pin.x, y: pin.y };
        push(pinMap, keyOf(pt), node);
        for (const pc of geom.piecesAt(pt)) {
          if (isConnectingEnd(pc, pt)) uf.union(node, pc.node);
          else overPins.push({ node, piece: pc, part: part.index, pin: pin.name, x: pin.x, y: pin.y });
        }
        if (part.def?.globalNet !== undefined) {
          uf.union(node, globalOf(part.def.globalNet));
          uf.union(node, sheetNameOf(sheet.id, part.def.globalNet));
        }
      }
    }
    for (const list of pinMap.values()) for (let i = 1; i < list.length; i++) uf.union(list[0], list[i]);

    // labels, connectors and bus entries
    const labMap = new Map<string, number[]>();
    labelAtKey.set(sheet.id, labMap);
    const entriesAt = new Set<string>();
    sheet.labels.forEach((lab, li) => {
      const node = uf.add();
      // keyed by position in the sheet, so even repeated label ids cannot collide
      labelNodes.set(`${sheet.id}\u0000${li}`, node);
      const pt = { x: lab.x, y: lab.y };
      const kind: LabelKind = lab.kind ?? 'label';
      const name = lab.name.trim();
      const onNet = geom.piecesAt(pt);
      const pinsHere = pinMap.get(keyOf(pt)) ?? [];
      if (kind === 'bus-entry') {
        entriesAt.add(keyOf(pt));
        push(labMap, keyOf(pt), node);
        for (const pc of onNet) uf.union(node, pc.node);
        for (const pn of pinsHere) uf.union(node, pn);
        if (!busAtPoint(pt)) busIssues.push({ kind: 'entryOffBus', sheetId: sheet.id, x: lab.x, y: lab.y, name });
        if (name) uf.union(node, sheetNameOf(sheet.id, name));
        return;
      }
      const onBus = onNet.length === 0 && pinsHere.length === 0 ? busAtPoint(pt) : undefined;
      const parsed = parseBusName(name);
      if (onBus || (parsed.vector && name)) {
        // the item names a bus / connects bus lines: every line separately
        if (parsed.error) {
          if (name) busIssues.push({ kind: 'badName', sheetId: sheet.id, x: lab.x, y: lab.y, name, detail: parsed.error });
          return;
        }
        if (onBus && (kind === 'label' || onBus.names.length === 0) && !onBus.names.some((n) => n.toLowerCase() === name.toLowerCase())) onBus.names.push(name);
        for (const m of parsed.members) joinName(uf.add(), sheet.id, m, kind, lab.global === true);
        return;
      }
      push(labMap, keyOf(pt), node);
      for (const pc of onNet) uf.union(node, pc.node);
      for (const pn of pinsHere) uf.union(node, pn);
      if (name !== '') joinName(node, sheet.id, name, kind, lab.global === true);
    });

    // bus lines: union of the names' lines (names with bad syntax are reported once)
    for (const g of buses) {
      if (g.sheetId !== sheet.id) continue;
      const lines: string[] = [];
      const firstPoint = () => sheet.wires.find((x) => g.wireIds.includes(x.id))?.points[0] ?? { x: 0, y: 0 };
      for (const n of g.names) {
        const p = parseBusName(n);
        if (p.error) {
          const at = firstPoint();
          busIssues.push({ kind: 'badName', sheetId: sheet.id, x: at.x, y: at.y, name: n, detail: p.error });
          continue;
        }
        for (const m of p.members) if (!lines.some((l) => l.toLowerCase() === m.toLowerCase())) lines.push(m);
      }
      g.members = lines;
      const valid = g.names.filter((n) => !parseBusName(n).error);
      if (valid.length > 1) {
        const at = firstPoint();
        busIssues.push({ kind: 'busNames', sheetId: sheet.id, x: at.x, y: at.y, detail: valid.join(', ') });
      }
    }
    // bus entries naming a line the (named) bus does not carry
    for (const lab of sheet.labels) {
      if (lab.kind !== 'bus-entry') continue;
      const bus = busAtPoint(lab);
      const name = lab.name.trim();
      if (bus && bus.members.length && name && !bus.members.some((m) => m.toLowerCase() === name.toLowerCase())) {
        busIssues.push({ kind: 'entryUnknownLine', sheetId: sheet.id, x: lab.x, y: lab.y, name, detail: bus.names.join(', ') });
      }
    }
    // ordinary wire ends on a bus without an entry
    for (const pc of geom.pieces) {
      for (const e of connectingEnds(pc)) {
        if (!entriesAt.has(keyOf(e)) && busAtPoint(e)) busIssues.push({ kind: 'wireOnBus', sheetId: sheet.id, x: e.x, y: e.y });
      }
    }
    // block bus pins: line i of the bus at the pin
    for (const { part, pin, lines } of busPinsHere) {
      const bus = busAtPoint({ x: pin.x, y: pin.y });
      const label = `${part.inst.refdes} ${pin.name}`;
      if (!bus) {
        busIssues.push({ kind: 'busPinNoBus', sheetId: sheet.id, x: pin.x, y: pin.y, name: label });
        continue;
      }
      if (bus.members.length === 0) {
        busIssues.push({ kind: 'busPinUnnamed', sheetId: sheet.id, x: pin.x, y: pin.y, name: label });
        continue;
      }
      if (bus.members.length !== lines.length) {
        busIssues.push({ kind: 'busPinWidth', sheetId: sheet.id, x: pin.x, y: pin.y, name: label, detail: `${lines.length}/${bus.members.length}` });
        continue;
      }
      lines.forEach((_m, i) => uf.union(pinNodes.get(pinKey(part.index, `${pin.name}#${i}`))!, sheetNameOf(sheet.id, bus.members[i])));
    }

    // dangling wire ends (original ends only; cut points and synthetic pieces are internal)
    for (const pc of geom.pieces) {
      if (pc.synthetic) continue;
      const ends: Point[] = [];
      if (!pc.cutStart && !pc.splitStart) ends.push(pc.points[0]);
      if (!pc.cutEnd && !pc.splitEnd && pc.points.length > 1) ends.push(pc.points[pc.points.length - 1]);
      for (const e of ends) {
        const k = keyOf(e);
        const touching = geom.piecesAt(e).some((o) => o !== pc) || (pinMap.get(k) ?? []).length > 0 || (labMap.get(k) ?? []).length > 0;
        if (!touching) dangling.push({ sheetId: sheet.id, wireId: pc.wireId, x: e.x, y: e.y });
      }
    }
  }

  // ---- assign net ids by first appearance ------------------------------------------------
  const netOfRoot = new Map<number, number>();
  const nets: ConnNet[] = [];
  const netFor = (node: number): ConnNet => {
    const root = uf.find(node);
    let id = netOfRoot.get(root);
    if (id === undefined) {
      id = nets.length;
      netOfRoot.set(root, id);
      nets.push({ id, pins: [], labels: [], globals: [], wires: [], ground: false, ports: [] });
    }
    return nets[id];
  };

  const pinNet = new Map<string, number>();
  for (const sheet of design.sheets) {
    for (const part of partsBySheet.get(sheet.id) ?? []) {
      for (const pin of part.pins) {
        const lines = part.busPins?.get(pin.name);
        const keys: [string, string][] = lines ? lines.map((m, i): [string, string] => [pinKey(part.index, `${pin.name}#${i}`), m]) : [[pinKey(part.index, pin.name), pin.name]];
        for (const [k, shown] of keys) {
          const net = netFor(pinNodes.get(k)!);
          net.pins.push({ part: part.index, pin: shown, sheetId: sheet.id, x: pin.x, y: pin.y });
          pinNet.set(k, net.id);
        }
      }
    }
    sheet.labels.forEach((lab, li) => {
      const net = netFor(labelNodes.get(`${sheet.id}\u0000${li}`)!);
      net.labels.push({
        sheetId: sheet.id,
        id: lab.id,
        name: lab.name.trim(),
        x: lab.x,
        y: lab.y,
        ...(lab.kind && lab.kind !== 'label' ? { kind: lab.kind } : {}),
        ...(lab.global ? { global: true } : {}),
      });
    });
    for (const pc of geoms.get(sheet.id)!.pieces) {
      const net = netFor(pc.node);
      if (!net.wires.some((w) => w.sheetId === pc.sheetId && w.wireId === pc.wireId)) net.wires.push({ sheetId: pc.sheetId, wireId: pc.wireId });
    }
  }
  // ground flag, global names and ports (only for nets that contain pins, labels or wires)
  const groundId = netOfRoot.get(uf.find(groundNode));
  if (groundId !== undefined) nets[groundId].ground = true;
  for (const [k, node] of globalNode) {
    const id = netOfRoot.get(uf.find(node));
    if (id !== undefined) nets[id].globals.push(globalSpelling.get(k) ?? k);
  }
  for (const [k, node] of portNodes) {
    const id = netOfRoot.get(uf.find(node));
    if (id !== undefined) nets[id].ports.push(portSpelling.get(k) ?? k);
  }

  for (const [probeId, [a, b]] of splitPieces) {
    splits.set(probeId, { probeId, netA: netFor(a.node).id, netB: netFor(b.node).id });
  }

  // pins a wire passes over without being connected to them (by any route)
  const pinsOnWire: PinOnWire[] = [];
  const seenOver = new Set<string>();
  for (const o of overPins) {
    if (uf.find(o.node) === uf.find(o.piece.node)) continue;
    const k = `${o.part}\u0000${o.pin}\u0000${o.piece.wireId}`;
    if (seenOver.has(k)) continue;
    seenOver.add(k);
    pinsOnWire.push({ sheetId: o.piece.sheetId, part: o.part, pin: o.pin, wireId: o.piece.wireId, x: o.x, y: o.y });
  }

  const netAt = (sheetId: string, p: Point): number | undefined => {
    const k = keyOf(p);
    const pinsHere = pinAtKey.get(sheetId)?.get(k);
    if (pinsHere && pinsHere.length) return netOfRoot.get(uf.find(pinsHere[0]));
    const geom = geoms.get(sheetId);
    const pcs = geom ? geom.piecesAt(p) : [];
    if (pcs.length) return netFor(pcs[0].node).id;
    const labs = labelAtKey.get(sheetId)?.get(k);
    if (labs && labs.length) return netOfRoot.get(uf.find(labs[0]));
    return undefined;
  };
  const busAt = (sheetId: string, p: Point): BusGroup | undefined => {
    const b = busGeoms.get(sheetId);
    const pc = b?.geom.piecesAt(p)[0];
    return pc ? buses[b!.groupOf.get(pc)!] : undefined;
  };
  const netOfName = (sheetId: string, name: string): number | undefined => {
    if (isGroundNode(name.trim())) return groundId;
    const node = sheetNameNodes.get(`${sheetId}\u0000${name.trim().toLowerCase()}`);
    return node === undefined ? undefined : netOfRoot.get(uf.find(node));
  };

  return { nets, pinNet, splits, unplacedCuts, dangling, pinsOnWire, netAt, buses, busAt, busIssues, netOfName };
}
