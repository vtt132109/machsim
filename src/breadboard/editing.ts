/**
 * Pure editing operations on a BreadboardLayout (the UI composes these; every function returns a
 * new layout and never mutates its input).
 *
 *   placePart / movePart / rotatePart / removePart   parts from the parts bin, anchored by their
 *                                                    first lead (see leads.ts templates)
 *   addWire / removeWire                             jumper wires
 *   addClip / removeClip                             clip leads of off-board parts (one per pin)
 *   setBoardKind / setSplitRails                     board options
 *   binContents                                      what is still in the parts bin
 *   itemsAtHole                                      hit-testing helper
 */

import type { Design } from '../model/types';
import type { BoardInstance, BoardKind, BreadboardHole, BreadboardLayout, ClipLead, JumperWire, PartPlacement } from './types';
import { emptyBreadboard } from './types';
import { boardMap, gridToHole, holeGrid, holeKey, sameHole } from './geometry';
import { placeLeads, rotateOffset, type PlacedLeads } from './leads';
import { physicalParts, type PhysicalPart } from './compare';

export function ensureLayout(design: Design): BreadboardLayout {
  const l = design.breadboard;
  if (!l || !l.boards?.length) return emptyBreadboard();
  return l;
}

export function findPart(design: Design, refdes: string): PhysicalPart | undefined {
  return physicalParts(design).find((p) => p.refdes === refdes);
}

/** Unique id with a prefix: "w1", "w2" … */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  for (let k = 1; ; k++) if (!set.has(`${prefix}${k}`)) return `${prefix}${k}`;
}

export interface PlacementPreview extends PlacedLeads {
  /** template holes already used by another part lead or jumper */
  conflicts: BreadboardHole[];
}

/** Holes taken by part leads and jumper ends (optionally ignoring one part). */
export function occupiedHoles(layout: BreadboardLayout, exceptRefdes?: string): Set<string> {
  const s = new Set<string>();
  for (const p of layout.placements) if (p.refdes !== exceptRefdes) for (const h of Object.values(p.pins)) s.add(holeKey(h));
  for (const w of layout.wires) {
    s.add(holeKey(w.from));
    s.add(holeKey(w.to));
  }
  return s;
}

/** Where the leads of a part would go when its first lead is dropped into `anchor`. */
export function previewPlacement(design: Design, layout: BreadboardLayout, refdes: string, anchor: BreadboardHole, rotation = 0): PlacementPreview | null {
  const part = findPart(design, refdes);
  const board = boardMap(layout).get(anchor.board);
  if (!part || part.map.mounting !== 'board' || !board) return null;
  const res = placeLeads(part.map, board, anchor, rotation);
  const taken = occupiedHoles(layout, refdes);
  const conflicts = Object.values(res.pins).filter((h) => taken.has(holeKey(h)));
  return { ...res, conflicts };
}

/** Place (or re-place) a part; returns null when a lead would be off the board. */
export function placePart(design: Design, layout: BreadboardLayout, refdes: string, anchor: BreadboardHole, rotation = 0): BreadboardLayout | null {
  const prev = previewPlacement(design, layout, refdes, anchor, rotation);
  if (!prev || !prev.ok) return null;
  const old = layout.placements.find((p) => p.refdes === refdes);
  const pl: PartPlacement = { refdes, pins: prev.pins };
  const rot = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  if (rot) pl.rotation = rot;
  if (old?.lift) pl.lift = old.lift;
  const placements = old ? layout.placements.map((p) => (p.refdes === refdes ? pl : p)) : [...layout.placements, pl];
  return { ...layout, placements };
}

/** The anchor (first template lead) hole of a placed part. */
export function anchorOf(design: Design, layout: BreadboardLayout, refdes: string): BreadboardHole | null {
  const part = findPart(design, refdes);
  const pl = layout.placements.find((p) => p.refdes === refdes);
  if (!part || !pl || !part.map.leads.length) return null;
  return pl.pins[part.map.leads[0].key] ?? Object.values(pl.pins)[0] ?? null;
}

/** Move a placed part so its first lead lands in `anchor` (rotation kept). */
export function movePart(design: Design, layout: BreadboardLayout, refdes: string, anchor: BreadboardHole): BreadboardLayout | null {
  const pl = layout.placements.find((p) => p.refdes === refdes);
  return placePart(design, layout, refdes, anchor, pl?.rotation ?? inferRotation(design, layout, refdes));
}

/** Rotation implied by the placed leads (for layouts made without `rotation`). */
export function inferRotation(design: Design, layout: BreadboardLayout, refdes: string): number {
  const part = findPart(design, refdes);
  const pl = layout.placements.find((p) => p.refdes === refdes);
  const board = pl ? boardMap(layout).get(Object.values(pl.pins)[0]?.board ?? '') : undefined;
  if (!part || !pl || !board || part.map.leads.length < 2) return pl?.rotation ?? 0;
  const [l0] = part.map.leads;
  const l1 = part.map.leads.find((l) => l.dx !== 0 || l.dy !== 0);
  const h0 = pl.pins[l0.key];
  const h1 = l1 ? pl.pins[l1.key] : undefined;
  if (!l1 || !h0 || !h1) return pl.rotation ?? 0;
  const g0 = holeGrid(board, h0);
  const g1 = holeGrid(board, h1);
  if (!g0 || !g1) return pl.rotation ?? 0;
  const actual = Math.atan2(g1.gy - g0.gy, g1.gx - g0.gx);
  const templ = Math.atan2(l1.dy, l1.dx);
  const deg = ((((actual - templ) * 180) / Math.PI) % 360 + 360) % 360;
  return (Math.round(deg / 90) * 90) % 360;
}

/**
 * Rotate a placed part by `step` degrees (clockwise seen from above) about the centre of its
 * leads, so two quarter turns swap the leads of a 2-lead part in place (the fix for a reversed
 * LED). The rotated template is dropped on the nearest anchor hole where every lead fits.
 */
export function rotatePart(design: Design, layout: BreadboardLayout, refdes: string, step = 90): BreadboardLayout | null {
  const part = findPart(design, refdes);
  const pl = layout.placements.find((p) => p.refdes === refdes);
  const anchor = anchorOf(design, layout, refdes);
  const board = anchor ? boardMap(layout).get(anchor.board) : undefined;
  if (!part || !pl || !anchor || !board || part.map.mounting !== 'board') return null;
  const grids = Object.values(pl.pins)
    .filter((h) => h.board === board.id)
    .map((h) => holeGrid(board, h))
    .filter((g): g is { gx: number; gy: number } => g !== null);
  if (!grids.length) return null;
  const cx = grids.reduce((s, g) => s + g.gx, 0) / grids.length;
  const cy = grids.reduce((s, g) => s + g.gy, 0) / grids.length;
  const rot = inferRotation(design, layout, refdes) + step;
  const offs = part.map.leads.map((l) => rotateOffset(l.dx, l.dy, rot));
  const mx = offs.reduce((s, o) => s + o.dx, 0) / offs.length;
  const my = offs.reduce((s, o) => s + o.dy, 0) / offs.length;
  const want = { gx: cx - mx, gy: cy - my };
  // candidate anchors around the wanted position, nearest first
  const candidates: { hole: BreadboardHole; d: number }[] = [];
  for (const col of [Math.floor(want.gx) - 1, Math.floor(want.gx), Math.ceil(want.gx), Math.ceil(want.gx) + 1]) {
    for (const h of [gridToHole(board, col, want.gy, 0.6), gridToHole(board, col, want.gy - 1, 0.6), gridToHole(board, col, want.gy + 1, 0.6)]) {
      if (!h || candidates.some((c) => sameHole(c.hole, h))) continue;
      const g = holeGrid(board, h)!;
      candidates.push({ hole: h, d: Math.hypot(g.gx - want.gx, g.gy - want.gy) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    const next = placePart(design, layout, refdes, c.hole, rot);
    if (next) return next;
  }
  return null;
}

export function removePart(layout: BreadboardLayout, refdes: string): BreadboardLayout {
  return { ...layout, placements: layout.placements.filter((p) => p.refdes !== refdes) };
}

export function addWire(layout: BreadboardLayout, from: BreadboardHole, to: BreadboardHole, color: string): { layout: BreadboardLayout; id: string } | null {
  if (sameHole(from, to)) return null;
  const id = nextId('w', layout.wires.map((w) => w.id));
  const wire: JumperWire = { id, from: { ...from }, to: { ...to }, color };
  return { layout: { ...layout, wires: [...layout.wires, wire] }, id };
}

export function removeWire(layout: BreadboardLayout, id: string): BreadboardLayout {
  return { ...layout, wires: layout.wires.filter((w) => w.id !== id) };
}

/** Clip a pin of an off-board part onto a hole (replaces that pin's previous clip). */
export function addClip(layout: BreadboardLayout, refdes: string, pin: string, hole: BreadboardHole, color: string): { layout: BreadboardLayout; id: string } {
  const rest = layout.clips.filter((c) => !(c.refdes === refdes && c.pin === pin));
  const id = nextId('c', layout.clips.map((c) => c.id));
  const clip: ClipLead = { id, refdes, pin, hole: { ...hole }, color };
  return { layout: { ...layout, clips: [...rest, clip] }, id };
}

export function removeClip(layout: BreadboardLayout, id: string): BreadboardLayout {
  return { ...layout, clips: layout.clips.filter((c) => c.id !== id) };
}

export function setBoardKind(layout: BreadboardLayout, boardId: string, kind: BoardKind): BreadboardLayout {
  return { ...layout, boards: layout.boards.map((b) => (b.id === boardId ? { ...b, kind } : b)) };
}

export function setSplitRails(layout: BreadboardLayout, boardId: string, split: boolean): BreadboardLayout {
  return {
    ...layout,
    boards: layout.boards.map((b): BoardInstance => {
      if (b.id !== boardId) return b;
      const { splitRails: _old, ...rest } = b;
      return split ? { ...rest, splitRails: true } : rest;
    }),
  };
}

export interface BinContents {
  /** on-board parts without a placement */
  parts: PhysicalPart[];
  /** off-board parts with pins that still need a clip lead */
  offBoard: { part: PhysicalPart; pins: string[] }[];
}

/** Parts still in the parts bin. Off-board parts list every pin not yet clipped. */
export function binContents(design: Design, layout: BreadboardLayout): BinContents {
  const placed = new Set(layout.placements.map((p) => p.refdes));
  const clipped = new Set(layout.clips.map((c) => `${c.refdes}.${c.pin}`));
  const parts: PhysicalPart[] = [];
  const offBoard: { part: PhysicalPart; pins: string[] }[] = [];
  for (const p of physicalParts(design)) {
    if (p.map.mounting === 'board') {
      if (!placed.has(p.refdes)) parts.push(p);
    } else {
      const pins = p.map.offboardPins.filter((pin) => !clipped.has(`${p.refdes}.${pin}`));
      offBoard.push({ part: p, pins });
    }
  }
  return { parts, offBoard };
}

export interface HoleItems {
  parts: { refdes: string; key: string }[];
  wires: { id: string; end: 'from' | 'to' }[];
  clips: string[];
}

export function itemsAtHole(layout: BreadboardLayout, hole: BreadboardHole): HoleItems {
  const out: HoleItems = { parts: [], wires: [], clips: [] };
  for (const p of layout.placements) for (const [key, h] of Object.entries(p.pins)) if (sameHole(h, hole)) out.parts.push({ refdes: p.refdes, key });
  for (const w of layout.wires) {
    if (sameHole(w.from, hole)) out.wires.push({ id: w.id, end: 'from' });
    if (sameHole(w.to, hole)) out.wires.push({ id: w.id, end: 'to' });
  }
  for (const c of layout.clips) if (sameHole(c.hole, hole)) out.clips.push(c.id);
  return out;
}

/** Drop placements, clips of parts no longer in the design. */
export function pruneLayout(design: Design, layout: BreadboardLayout): BreadboardLayout {
  const refs = new Set(physicalParts(design).map((p) => p.refdes));
  return { ...layout, placements: layout.placements.filter((p) => refs.has(p.refdes)), clips: layout.clips.filter((c) => refs.has(c.refdes)) };
}
