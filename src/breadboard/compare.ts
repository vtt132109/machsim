/**
 * Circuit check: compare the breadboard wiring with the schematic netlist.
 *
 * `compareWithSchematic(design, layout)` builds the schematic connectivity with buildNetlist
 * (partNets: refdes → pin → net), the breadboard connectivity from strips / jumpers / clips, and
 * reports, each with a beginner-friendly explanation (Vietnamese + English), the holes and refdes
 * to highlight:
 *
 *   errors    unplaced-part, clip-missing, lead-missing, lead-off-board, hole-conflict,
 *             part-shorted (two leads of one part in one strip), short (schematic nets joined),
 *             missing-connection (one schematic net split over several breadboard nets),
 *             polarity (LED / diode / electrolytic / buzzer reversed), pins-swapped (3-lead
 *             transistor / regulator wired in the wrong lead order)
 *   warnings  unknown-part, unknown-pin, unknown-board (stale layout entries)
 *   hints     polarity-ok, ic-no-supply, dangling-wire (severity 'info', in `hints`)
 *
 * A reversed polarised part or a permuted 3-lead part is detected first (its leads reach the
 * other lead's net); the rest of the analysis then treats it as corrected, so one mistake gives
 * one message instead of a cascade of shorts and missing connections.
 */

import type { PartDef } from '../library/types';
import { getPart } from '../library';
import type { Design, NetlistBuild, PartInstance } from '../model/types';
import { buildNetlist } from '../model/netlister';
import type { BreadboardHole, BreadboardLayout } from './types';
import { emptyBreadboard } from './types';
import { computeBreadboardConnectivity, stripOfHole, type BreadboardConnectivity, type LeadRef } from './connectivity';
import { describeStrip, holeName } from './geometry';
import { leadMap, logicalPin, type LeadMap, type PolarityKind } from './leads';
import { concatText, groundNetText, hintText, issueText, joinText, L, leadText, pinText, type IssueText, type LocalizedText } from '../i18n/breadboard';
import { partNameText } from '../i18n/library';

export type IssueKind =
  | 'unplaced-part'
  | 'clip-missing'
  | 'lead-missing'
  | 'lead-off-board'
  | 'hole-conflict'
  | 'part-shorted'
  | 'short'
  | 'missing-connection'
  | 'polarity'
  | 'pins-swapped'
  | 'unknown-part'
  | 'unknown-pin'
  | 'unknown-board'
  | 'polarity-ok'
  | 'ic-no-supply'
  | 'dangling-wire';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface BreadboardIssue extends IssueText {
  /** stable key (kind + subject) */
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  /** holes to highlight */
  holes: BreadboardHole[];
  /** parts to highlight */
  refdes: string[];
  /** schematic nets involved (SPICE names, "0" = ground) */
  nets: string[];
}

export interface PhysicalPart {
  refdes: string;
  inst: PartInstance;
  def: PartDef;
  map: LeadMap;
}

export interface CheckResult {
  /** errors and warnings (most severe first) */
  issues: BreadboardIssue[];
  /** informational hints */
  hints: BreadboardIssue[];
  /** true when there is no error and no warning */
  ok: boolean;
  connectivity: BreadboardConnectivity;
  /** breadboard net id -> schematic nets of the leads in it */
  schematicNets: Map<number, string[]>;
  /** SPICE net name -> user-visible name */
  netDisplay: Map<string, string>;
  /** physical parts by refdes */
  parts: Map<string, PhysicalPart>;
  counts: { errors: number; warnings: number; placed: number; total: number };
}

export interface CheckOptions {
  /** reuse an existing netlist build */
  build?: Pick<NetlistBuild, 'partNets' | 'nets'>;
}

/** Physical parts of a design (first occurrence of each refdes; power symbols excluded). */
export function physicalParts(design: Design): PhysicalPart[] {
  const out: PhysicalPart[] = [];
  const seen = new Set<string>();
  for (const sheet of design.sheets) {
    for (const inst of sheet.parts) {
      const def = getPart(inst.partId);
      if (!def || seen.has(inst.refdes)) continue;
      const map = leadMap(def, inst.params);
      if (map.mounting === 'none') continue;
      seen.add(inst.refdes);
      out.push({ refdes: inst.refdes, inst, def, map });
    }
  }
  return out;
}

/** Map a schematic net name to its display name ("0" → "GND"). */
export function netDisplayNames(build: Pick<NetlistBuild, 'nets'>): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of build.nets) m.set(n.name, n.name === '0' ? 'GND' : n.displayName || n.name);
  if (!m.has('0')) m.set('0', 'GND');
  return m;
}

/** Resolve a hidden supply net name ("VCC") against the netlist (case-insensitive). */
export function resolveSupplyNet(build: Pick<NetlistBuild, 'nets'>, name: string): string | null {
  const k = name.trim().toLowerCase();
  if (k === '0' || k === 'gnd') return '0';
  for (const n of build.nets) if (n.name.toLowerCase() === k || n.displayName.toLowerCase() === k) return n.name;
  return null;
}

/**
 * Expected schematic net of every physical lead key of a part (null = no connection expected).
 * Hidden supply pins whose net is missing in the schematic get the bare supply name.
 */
export function expectedNets(part: PhysicalPart, build: Pick<NetlistBuild, 'partNets' | 'nets'>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const nets = build.partNets[part.refdes] ?? {};
  const keys = part.map.mounting === 'offboard' ? part.map.offboardPins : part.map.leads.map((l) => l.key);
  for (const key of keys) {
    const pin = logicalPin(key);
    if (pin.startsWith('#')) {
      const h = part.map.hidden[pin];
      if (!h || h.role === 'nc') out[key] = null;
      else if (h.role === 'ground') out[key] = '0';
      else out[key] = resolveSupplyNet(build, h.net ?? 'VCC') ?? (h.net ?? 'VCC');
    } else {
      out[key] = nets[pin] ?? null;
    }
  }
  return out;
}

const severityRank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

interface ALead {
  lead: LeadRef;
  refdes: string;
  key: string;
  net: string | null;
  strip: string;
  bbNet: number;
  /** part lead (true) or clip (false) */
  part: boolean;
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  arr.forEach((x, i) => {
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

export function compareWithSchematic(design: Design, layout?: BreadboardLayout, opts: CheckOptions = {}): CheckResult {
  const lay = layout ?? design.breadboard ?? emptyBreadboard();
  const build = opts.build ?? buildNetlist(design, { includeAnalysis: false });
  const display = netDisplayNames(build);
  const conn = computeBreadboardConnectivity(lay);
  const multiBoard = lay.boards.length > 1;
  const hn = (h: BreadboardHole): string => holeName(h, multiBoard);
  const netName = (n: string): string => display.get(n) ?? n;
  const netText = (n: string): LocalizedText => (n === '0' ? groundNetText() : L(netName(n), netName(n)));

  const parts = new Map<string, PhysicalPart>();
  for (const p of physicalParts(design)) parts.set(p.refdes, p);
  const expected = new Map<string, Record<string, string | null>>();
  for (const p of parts.values()) expected.set(p.refdes, expectedNets(p, build));

  const issues: BreadboardIssue[] = [];
  const hints: BreadboardIssue[] = [];
  const add = (kind: IssueKind, severity: IssueSeverity, idSuffix: string, text: IssueText, holes: BreadboardHole[], refdes: string[], nets: string[] = []) => {
    (severity === 'info' ? hints : issues).push({ id: `${kind}:${idSuffix}`, kind, severity, ...text, holes, refdes, nets });
  };

  // ---- 1. layout entries vs design ------------------------------------------------------------
  const placementOf = new Map(lay.placements.map((p) => [p.refdes, p]));
  const offBoardSet = new Set(conn.offBoard);
  const unknownBoardsReported = new Set<string>();
  const reportOffBoard = (lead: LeadRef, owner: LocalizedText) => {
    if (!conn.boards.has(lead.hole.board)) {
      if (!unknownBoardsReported.has(lead.hole.board)) {
        unknownBoardsReported.add(lead.hole.board);
        add('unknown-board', 'warning', lead.hole.board, issueText.unknownBoard(lead.hole.board), [], []);
      }
    }
    add('lead-off-board', 'error', `${owner.en}@${hn(lead.hole)}`, issueText.leadOffBoard(owner, hn(lead.hole)), [lead.hole], lead.kind === 'wire' ? [] : [lead.refdes]);
  };

  for (const pl of lay.placements) {
    const part = parts.get(pl.refdes);
    if (!part) {
      add('unknown-part', 'warning', pl.refdes, issueText.unknownPart(pl.refdes), Object.values(pl.pins), [pl.refdes]);
      continue;
    }
    const keys = new Set(part.map.leads.map((l) => l.key));
    for (const k of Object.keys(pl.pins)) if (!keys.has(k)) add('unknown-pin', 'warning', `${pl.refdes}.${k}`, issueText.unknownPin(pl.refdes, k), [pl.pins[k]], [pl.refdes]);
    for (const k of keys) {
      if (!pl.pins[k]) add('lead-missing', 'error', `${pl.refdes}.${k}`, issueText.leadMissing(pl.refdes, pinText(pl.refdes, k)), [], [pl.refdes]);
    }
  }
  for (const lead of conn.offBoard) {
    if (lead.kind === 'part') {
      if (parts.has(lead.refdes)) reportOffBoard(lead, pinText(lead.refdes, lead.key));
    } else if (lead.kind === 'wire') {
      reportOffBoard(lead, leadText.wireEnd(lead.id));
    } else {
      reportOffBoard(lead, leadText.clipOf(pinText(lead.refdes, lead.pin)));
    }
  }

  // unplaced on-board parts, missing clips of off-board parts
  const netPinCount = new Map<string, number>();
  for (const [, exp] of expected) for (const n of Object.values(exp)) if (n) netPinCount.set(n, (netPinCount.get(n) ?? 0) + 1);
  const clipsOf = new Map<string, Set<string>>();
  for (const c of lay.clips) {
    const part = parts.get(c.refdes);
    if (!part) {
      add('unknown-part', 'warning', `clip:${c.id}`, issueText.unknownPart(c.refdes), [c.hole], [c.refdes]);
      continue;
    }
    const exp = expected.get(c.refdes)!;
    const known = part.map.mounting === 'offboard' ? c.pin in exp : part.def.symbol.pins.some((p) => p.name === c.pin);
    if (!known) {
      add('unknown-pin', 'warning', `clip:${c.id}`, issueText.unknownPin(c.refdes, c.pin), [c.hole], [c.refdes]);
      continue;
    }
    if (!clipsOf.has(c.refdes)) clipsOf.set(c.refdes, new Set());
    clipsOf.get(c.refdes)!.add(c.pin);
  }
  for (const part of parts.values()) {
    if (part.map.mounting === 'board') {
      if (!placementOf.has(part.refdes)) add('unplaced-part', 'error', part.refdes, issueText.unplacedPart(part.refdes, partNameText(part.def)), [], [part.refdes]);
      continue;
    }
    const exp = expected.get(part.refdes)!;
    const clipped = clipsOf.get(part.refdes) ?? new Set<string>();
    const need = part.map.offboardPins.filter((pin) => {
      const n = exp[pin];
      return n !== null && (netPinCount.get(n) ?? 0) > 1 && !clipped.has(pin);
    });
    if (need.length) add('clip-missing', 'error', part.refdes, issueText.clipMissing(part.refdes, need, partNameText(part.def)), [], [part.refdes]);
  }

  // ---- 2. two leads in one hole ---------------------------------------------------------------
  const leadOwner = (l: LeadRef): LocalizedText =>
    l.kind === 'part' ? pinText(l.refdes, l.key) : l.kind === 'wire' ? leadText.wire(l.id) : leadText.clip(pinText(l.refdes, l.pin));
  for (const [, leads] of conn.holeLeads) {
    const solid = leads.filter((l) => l.kind !== 'clip');
    if (solid.length < 2) continue;
    const h = solid[0].hole;
    add('hole-conflict', 'error', hn(h), issueText.holeConflict(hn(h), solid.map(leadOwner)), [h], [...new Set(solid.flatMap((l) => (l.kind === 'wire' ? [] : [l.refdes])))]);
  }

  // ---- 3. analysis leads ----------------------------------------------------------------------
  const aleads: ALead[] = [];
  for (const net of conn.nets) {
    for (const lead of net.leads) {
      if (lead.kind === 'wire' || offBoardSet.has(lead)) continue;
      const part = parts.get(lead.refdes);
      if (!part) continue;
      const exp = expected.get(lead.refdes)!;
      let n: string | null | undefined;
      if (lead.kind === 'part') {
        if (!(lead.key in exp)) continue;
        n = exp[lead.key];
      } else {
        n = part.map.mounting === 'offboard' ? exp[lead.pin] : (build.partNets[lead.refdes]?.[lead.pin] ?? null);
      }
      aleads.push({ lead, refdes: lead.refdes, key: lead.kind === 'part' ? lead.key : lead.pin, net: n ?? null, strip: stripOfHole(conn.boards, lead.hole)!, bbNet: net.id, part: lead.kind === 'part' });
    }
  }
  const byPart = new Map<string, ALead[]>();
  for (const a of aleads) {
    if (!a.part) continue;
    const arr = byPart.get(a.refdes);
    if (arr) arr.push(a);
    else byPart.set(a.refdes, [a]);
  }
  for (const [refdes, leads] of byPart) {
    const order = parts.get(refdes)!.map.leads.map((l) => l.key);
    leads.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  // ---- 4. reversed / permuted parts -----------------------------------------------------------
  const othersInNet = (bbNet: number, refdes: string): Set<string> => {
    const s = new Set<string>();
    for (const a of aleads) if (a.bbNet === bbNet && !(a.part && a.refdes === refdes) && a.net !== null) s.add(a.net);
    return s;
  };
  for (const [refdes, leads] of byPart) {
    const part = parts.get(refdes)!;
    const pol = part.map.polarity;
    const permutable = pol !== undefined || (part.map.pinout?.length === 3 && (part.map.body === 'to92' || part.map.body === 'to220'));
    if (!permutable || leads.length !== part.map.leads.length) continue;
    const nets = leads.map((a) => a.net);
    if (nets.some((n) => n === null) || new Set(nets).size !== nets.length) continue;
    if (new Set(leads.map((a) => a.strip)).size !== leads.length) continue;
    const obs = leads.map((a) => othersInNet(a.bbNet, refdes));
    const fits = (perm: (string | null)[]) => obs.every((o, i) => [...o].every((n) => n === perm[i]));
    if (fits(nets)) {
      if (pol && obs.every((o) => o.size > 0)) {
        const plus = leads.find((a) => a.key === pol.plus)!;
        const minus = leads.find((a) => a.key === pol.minus)!;
        add('polarity-ok', 'info', refdes, hintText.polarityOk(refdes, pol.kind, hn(plus.lead.hole), hn(minus.lead.hole)), [plus.lead.hole, minus.lead.hole], [refdes]);
      }
      continue;
    }
    if (!obs.every((o) => o.size > 0)) continue;
    const perm = permutations(nets).find((p) => p.some((n, i) => n !== nets[i]) && fits(p));
    if (!perm) continue;
    leads.forEach((a, i) => (a.net = perm[i]));
    const holes = leads.map((a) => a.lead.hole);
    if (pol) add('polarity', 'error', refdes, issueText.polarity(refdes, pol.kind as PolarityKind), holes, [refdes], nets as string[]);
    else add('pins-swapped', 'error', refdes, issueText.pinsSwapped(refdes, (part.map.pinout ?? []).join('-')), holes, [refdes], nets as string[]);
  }

  // ---- 5. part shorted by its own leads -------------------------------------------------------
  const shortedGroups: { bbNet: number; nets: string[] }[] = [];
  for (const [refdes, leads] of byPart) {
    const byStrip = new Map<string, ALead[]>();
    for (const a of leads) {
      if (a.net === null) continue;
      const arr = byStrip.get(a.strip);
      if (arr) arr.push(a);
      else byStrip.set(a.strip, [a]);
    }
    const bad = [...byStrip.entries()].filter(([, ls]) => new Set(ls.map((a) => a.net)).size > 1);
    if (!bad.length) continue;
    const holes: BreadboardHole[] = [];
    const nets = new Set<string>();
    for (const [, ls] of bad) {
      holes.push(...ls.map((a) => a.lead.hole));
      const ns = [...new Set(ls.map((a) => a.net!))];
      ns.forEach((n) => nets.add(n));
      shortedGroups.push({ bbNet: ls[0].bbNet, nets: ns });
    }
    const first = bad[0];
    add('part-shorted', 'error', refdes, issueText.partShorted(refdes, describeStrip(first[0], multiBoard), first[1].map((a) => a.key)), holes, [refdes], [...nets]);
  }

  // ---- 6. shorts between schematic nets -------------------------------------------------------
  const schematicNets = new Map<number, string[]>();
  for (const net of conn.nets) {
    const ls = aleads.filter((a) => a.bbNet === net.id && a.net !== null);
    const ns = [...new Set(ls.map((a) => a.net!))];
    schematicNets.set(net.id, ns);
    if (ns.length < 2) continue;
    // explained by part-shorted groups in this net?
    const groups = shortedGroups.filter((g) => g.bbNet === net.id);
    if (groups.length) {
      const comp = new Set<string>(groups[0].nets);
      let grew = true;
      while (grew) {
        grew = false;
        for (const g of groups) {
          if (g.nets.some((n) => comp.has(n)) && g.nets.some((n) => !comp.has(n))) {
            g.nets.forEach((n) => comp.add(n));
            grew = true;
          }
        }
      }
      if (ns.every((n) => comp.has(n))) continue;
    }
    const shown = ls.slice(0, 10).map((a) => concatText(pinText(a.refdes, a.key), ` @ ${hn(a.lead.hole)}`));
    add(
      'short',
      'error',
      [...ns].sort().join('+'),
      issueText.short(ns.map(netName), shown),
      ls.map((a) => a.lead.hole),
      [...new Set(ls.map((a) => a.refdes))],
      ns,
    );
  }

  // ---- 7. missing connections -----------------------------------------------------------------
  const byNet = new Map<string, ALead[]>();
  for (const a of aleads) {
    if (a.net === null) continue;
    const arr = byNet.get(a.net);
    if (arr) arr.push(a);
    else byNet.set(a.net, [a]);
  }
  for (const [net, ls] of byNet) {
    const groups = new Map<number, ALead[]>();
    for (const a of ls) {
      const arr = groups.get(a.bbNet);
      if (arr) arr.push(a);
      else groups.set(a.bbNet, [a]);
    }
    if (groups.size < 2) continue;
    const texts = [...groups.values()].map((g) => joinText(g.map((a) => concatText(pinText(a.refdes, a.key), ` @ ${hn(a.lead.hole)}`))));
    add('missing-connection', 'error', net, { ...issueText.missing(netName(net), texts), title: leadText.missingTitle(netText(net)) }, ls.map((a) => a.lead.hole), [...new Set(ls.map((a) => a.refdes))], [net]);
  }

  // ---- 8. hints -------------------------------------------------------------------------------
  for (const part of parts.values()) {
    for (const [key, h] of Object.entries(part.map.hidden)) {
      if (h.role !== 'supply' || resolveSupplyNet(build, h.net ?? 'VCC')) continue;
      const ground = Object.entries(part.map.hidden).find(([, x]) => x.role === 'ground')?.[0] ?? '#?';
      add('ic-no-supply', 'info', part.refdes, hintText.icNoSupply(part.refdes, h.net ?? 'VCC', key.slice(1), ground.slice(1)), placementOf.get(part.refdes)?.pins[key] ? [placementOf.get(part.refdes)!.pins[key]] : [], [part.refdes]);
    }
  }
  for (const w of lay.wires) {
    for (const end of [w.from, w.to]) {
      const s = stripOfHole(conn.boards, end);
      if (!s) continue;
      const net = conn.nets[conn.stripNet.get(s)!];
      if (!net.leads.some((l) => l.kind !== 'wire')) {
        add('dangling-wire', 'info', w.id, hintText.danglingWire(hn(end)), [w.from, w.to], []);
        break;
      }
    }
  }

  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const onBoard = [...parts.values()].filter((p) => p.map.mounting === 'board');
  return {
    issues,
    hints,
    ok: issues.length === 0,
    connectivity: conn,
    schematicNets,
    netDisplay: display,
    parts,
    counts: { errors, warnings, placed: onBoard.filter((p) => placementOf.has(p.refdes)).length, total: onBoard.length },
  };
}
