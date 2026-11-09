/**
 * Breadboard geometry: board sizes, hole positions, strips and learner-friendly hole names.
 *
 * All boards use the standard 2.54 mm (0.1") pitch. Board-local coordinates are millimetres
 * from the board's top-left corner, x along the columns (left → right) and y across the board
 * (top → bottom). The bench position of a board is `BoardInstance.x / y` (mm), so the bench
 * position of a hole is `board.x + localX, board.y + localY`.
 *
 * Row order from the top edge (boards with rails):
 *   top+  top-  |  a b c d e  |  centre channel  |  f g h i j  |  bot+  bot-
 * Rows e and f are 3 pitches (7.62 mm = 0.3") apart, so a DIP IC straddles the channel with
 * its pin rows in e and f. Mini boards (17 columns) have no power rails.
 *
 * Power-rail holes line up with terminal columns and come in groups of five with a one-column
 * gap (full board: 10 groups at columns 3–7, 9–13, … 57–61; half board: 5 groups at 1–5 … 25–29).
 * A split-rail board breaks every rail between the two middle groups.
 *
 * Strip ids (stable, used as connectivity keys):
 *   terminal  `${board}:${col}:ae` / `${board}:${col}:fj`
 *   rail      `${board}:${row}` or, with split rails, `${board}:${row}:L` / `${board}:${row}:R`
 */

import type { BoardInstance, BoardKind, BreadboardHole, BreadboardLayout, BreadboardRow } from './types';
import { boardPrefixText, holeText, railName, terminalStripText, type LocalizedText } from '../i18n/breadboard';

export const PITCH = 2.54;

export type TerminalRow = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j';
export type RailRow = 'top+' | 'top-' | 'bot+' | 'bot-';

export const TERMINAL_ROWS: readonly TerminalRow[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
export const UPPER_ROWS: readonly TerminalRow[] = ['a', 'b', 'c', 'd', 'e'];
export const LOWER_ROWS: readonly TerminalRow[] = ['f', 'g', 'h', 'i', 'j'];
export const RAIL_ROWS: readonly RailRow[] = ['top+', 'top-', 'bot+', 'bot-'];
export const ALL_ROWS: readonly BreadboardRow[] = [...RAIL_ROWS.slice(0, 2), ...TERMINAL_ROWS, ...RAIL_ROWS.slice(2)];

export const isRailRow = (row: BreadboardRow): row is RailRow => row.length > 1;
export const isTerminalRow = (row: string): row is TerminalRow => row.length === 1 && row >= 'a' && row <= 'j';

export interface BoardSpec {
  kind: BoardKind;
  columns: number;
  hasRails: boolean;
  /** rail hole columns, grouped in fives */
  railGroups: number[][];
  /** all rail hole columns (flattened railGroups) */
  railColumns: number[];
  /** number of groups on the left side of a split rail */
  splitAfterGroup: number;
  /** board size in mm */
  width: number;
  height: number;
  /** y (mm from the top edge) of every row present on this board */
  rowY: Partial<Record<BreadboardRow, number>>;
  /** y of the centre-channel axis (mm) */
  channelY: number;
  /** x (mm) of column 1 */
  x0: number;
  /** total number of holes */
  holeCount: number;
}

const COLUMNS: Record<BoardKind, number> = { full: 63, half: 30, mini: 17 };
const MARGIN_X = 1.5; // pitches from the left edge to column 1

const specCache = new Map<BoardKind, BoardSpec>();

/** Static geometry of one board kind. */
export function boardSpec(kind: BoardKind): BoardSpec {
  const cached = specCache.get(kind);
  if (cached) return cached;
  const columns = COLUMNS[kind];
  const hasRails = kind !== 'mini';
  const rowY: Partial<Record<BreadboardRow, number>> = {};
  // pitch units from the top edge
  const top = hasRails ? 4.5 : 1.5;
  UPPER_ROWS.forEach((r, i) => (rowY[r] = (top + i) * PITCH));
  LOWER_ROWS.forEach((r, i) => (rowY[r] = (top + 7 + i) * PITCH));
  let heightP = top + 7 + 4 + 1.5;
  const railGroups: number[][] = [];
  if (hasRails) {
    rowY['top+'] = 1.5 * PITCH;
    rowY['top-'] = 2.5 * PITCH;
    rowY['bot+'] = (top + 13) * PITCH;
    rowY['bot-'] = (top + 14) * PITCH;
    heightP = top + 14 + 1.5;
    const groups = Math.floor((columns + 1) / 6);
    const span = groups * 6 - 1;
    const first = Math.floor((columns - span) / 2) + 1;
    for (let g = 0; g < groups; g++) {
      const cols: number[] = [];
      for (let k = 0; k < 5; k++) cols.push(first + g * 6 + k);
      railGroups.push(cols);
    }
  }
  const spec: BoardSpec = {
    kind,
    columns,
    hasRails,
    railGroups,
    railColumns: railGroups.flat(),
    splitAfterGroup: Math.ceil(railGroups.length / 2),
    width: (columns - 1 + 2 * MARGIN_X) * PITCH,
    height: heightP * PITCH,
    rowY,
    channelY: (top + 5.5) * PITCH,
    x0: MARGIN_X * PITCH,
    holeCount: columns * 10 + railGroups.length * 5 * 4,
  };
  specCache.set(kind, spec);
  return spec;
}

/** x (mm, board-local) of a column. */
export function columnX(spec: BoardSpec, col: number): number {
  return spec.x0 + (col - 1) * PITCH;
}

export function isValidHole(board: BoardInstance, row: BreadboardRow, col: number): boolean {
  const spec = boardSpec(board.kind);
  if (!Number.isInteger(col)) return false;
  if (isRailRow(row)) return spec.hasRails && spec.railColumns.includes(col);
  return isTerminalRow(row) && col >= 1 && col <= spec.columns;
}

export const holeKey = (h: BreadboardHole): string => `${h.board}:${h.row}:${h.col}`;

export const sameHole = (a: BreadboardHole, b: BreadboardHole): boolean => a.board === b.board && a.row === b.row && a.col === b.col;

/** Board-local position (mm) of a hole (valid or not, as long as the row exists on the board kind). */
export function holeLocal(board: BoardInstance, hole: Pick<BreadboardHole, 'row' | 'col'>): { x: number; y: number } | null {
  const spec = boardSpec(board.kind);
  const y = spec.rowY[hole.row];
  if (y === undefined) return null;
  return { x: columnX(spec, hole.col), y };
}

/** Bench position (mm) of a hole. */
export function holePosition(board: BoardInstance, hole: Pick<BreadboardHole, 'row' | 'col'>): { x: number; y: number } | null {
  const p = holeLocal(board, hole);
  return p ? { x: board.x + p.x, y: board.y + p.y } : null;
}

function railSide(spec: BoardSpec, col: number): 'L' | 'R' {
  const lastLeft = spec.railGroups[spec.splitAfterGroup - 1];
  return lastLeft && col <= lastLeft[lastLeft.length - 1] ? 'L' : 'R';
}

/** Strip id of a hole, or null when the hole does not exist on the board. */
export function stripIdOf(board: BoardInstance, row: BreadboardRow, col: number): string | null {
  if (!isValidHole(board, row, col)) return null;
  if (isRailRow(row)) {
    if (!board.splitRails) return `${board.id}:${row}`;
    return `${board.id}:${row}:${railSide(boardSpec(board.kind), col)}`;
  }
  return `${board.id}:${col}:${UPPER_ROWS.includes(row as TerminalRow) ? 'ae' : 'fj'}`;
}

export interface StripInfo {
  id: string;
  board: string;
  kind: 'terminal' | 'rail';
  /** terminal strips: the column; rails: undefined */
  col?: number;
  /** terminal strips: 'ae' | 'fj'; rails: the rail row */
  side?: 'ae' | 'fj';
  rail?: RailRow;
  /** split rail half */
  half?: 'L' | 'R';
  holes: BreadboardHole[];
}

/** Parse a strip id back into its parts (does not validate against a board). */
export function parseStripId(id: string): Omit<StripInfo, 'holes'> | null {
  const parts = id.split(':');
  if (parts.length < 2) return null;
  const [board, a, b] = parts;
  if ((RAIL_ROWS as readonly string[]).includes(a)) {
    return { id, board, kind: 'rail', rail: a as RailRow, ...(b === 'L' || b === 'R' ? { half: b } : {}) };
  }
  const col = Number(a);
  if (!Number.isInteger(col) || (b !== 'ae' && b !== 'fj')) return null;
  return { id, board, kind: 'terminal', col, side: b };
}

/** Every strip of a board with its holes. */
export function listStrips(board: BoardInstance): StripInfo[] {
  const spec = boardSpec(board.kind);
  const out: StripInfo[] = [];
  for (let col = 1; col <= spec.columns; col++) {
    out.push({ id: `${board.id}:${col}:ae`, board: board.id, kind: 'terminal', col, side: 'ae', holes: UPPER_ROWS.map((row) => ({ board: board.id, row, col })) });
    out.push({ id: `${board.id}:${col}:fj`, board: board.id, kind: 'terminal', col, side: 'fj', holes: LOWER_ROWS.map((row) => ({ board: board.id, row, col })) });
  }
  if (spec.hasRails) {
    for (const rail of RAIL_ROWS) {
      if (!board.splitRails) {
        out.push({ id: `${board.id}:${rail}`, board: board.id, kind: 'rail', rail, holes: spec.railColumns.map((col) => ({ board: board.id, row: rail, col })) });
      } else {
        for (const half of ['L', 'R'] as const) {
          const cols = spec.railColumns.filter((c) => railSide(spec, c) === half);
          out.push({ id: `${board.id}:${rail}:${half}`, board: board.id, kind: 'rail', rail, half, holes: cols.map((col) => ({ board: board.id, row: rail, col })) });
        }
      }
    }
  }
  return out;
}

/** Holes of one strip (empty when the id does not belong to the board). */
export function stripHoles(board: BoardInstance, stripId: string): BreadboardHole[] {
  const info = parseStripId(stripId);
  if (!info || info.board !== board.id) return [];
  const spec = boardSpec(board.kind);
  if (info.kind === 'terminal') {
    if (info.col === undefined || info.col < 1 || info.col > spec.columns) return [];
    return (info.side === 'ae' ? UPPER_ROWS : LOWER_ROWS).map((row) => ({ board: board.id, row, col: info.col! }));
  }
  if (!spec.hasRails || !info.rail) return [];
  if (!board.splitRails && info.half) return [];
  if (board.splitRails && !info.half) return [];
  const cols = spec.railColumns.filter((c) => !info.half || railSide(spec, c) === info.half);
  return cols.map((col) => ({ board: board.id, row: info.rail!, col }));
}

/** Every hole of a board. */
export function allHoles(board: BoardInstance): BreadboardHole[] {
  return listStrips(board).flatMap((s) => s.holes);
}

// ---------------------------------------------------------------------------------------------
// Grid coordinates (pitch units, board-local) used for lead templates and rotation

/** Board-local grid position (pitches) of a hole: gx = column, gy = row y / pitch. */
export function holeGrid(board: BoardInstance, hole: Pick<BreadboardHole, 'row' | 'col'>): { gx: number; gy: number } | null {
  const spec = boardSpec(board.kind);
  const y = spec.rowY[hole.row];
  if (y === undefined) return null;
  return { gx: hole.col, gy: y / PITCH };
}

/**
 * Nearest valid hole to a grid position within `tolerance` pitches (Chebyshev distance on each
 * axis), or null. Used to drop lead templates onto the board.
 */
export function gridToHole(board: BoardInstance, gx: number, gy: number, tolerance = 0.3): BreadboardHole | null {
  const spec = boardSpec(board.kind);
  const col = Math.round(gx);
  if (Math.abs(col - gx) > tolerance + 1e-9) return null;
  let best: BreadboardHole | null = null;
  let bestD = Infinity;
  for (const row of ALL_ROWS) {
    const y = spec.rowY[row];
    if (y === undefined) continue;
    const d = Math.abs(y / PITCH - gy);
    if (d <= tolerance + 1e-9 && d < bestD && isValidHole(board, row, col)) {
      best = { board: board.id, row, col };
      bestD = d;
    }
  }
  return best;
}

/** Nearest valid hole to a bench position (mm) over all boards, within maxDist mm. */
export function nearestHole(boards: readonly BoardInstance[], x: number, y: number, maxDist = PITCH * 0.6): BreadboardHole | null {
  let best: BreadboardHole | null = null;
  let bestD = maxDist;
  for (const b of boards) {
    const spec = boardSpec(b.kind);
    const lx = x - b.x;
    const ly = y - b.y;
    if (lx < -maxDist || ly < -maxDist || lx > spec.width + maxDist || ly > spec.height + maxDist) continue;
    const col = Math.round((lx - spec.x0) / PITCH) + 1;
    for (const row of ALL_ROWS) {
      const ry = spec.rowY[row];
      if (ry === undefined || Math.abs(ry - ly) > bestD) continue;
      for (const c of [col - 1, col, col + 1]) {
        if (!isValidHole(b, row, c)) continue;
        const d = Math.hypot(columnX(spec, c) - lx, ry - ly);
        if (d < bestD) {
          bestD = d;
          best = { board: b.id, row, col: c };
        }
      }
    }
  }
  return best;
}

/** Step a hole cursor by whole rows / columns (keyboard navigation). Skips gaps in the rails. */
export function stepHole(board: BoardInstance, hole: BreadboardHole, dCol: number, dRow: number): BreadboardHole {
  const spec = boardSpec(board.kind);
  const rows = ALL_ROWS.filter((r) => spec.rowY[r] !== undefined);
  let ri = rows.indexOf(hole.row);
  if (ri < 0) ri = rows.indexOf('a');
  let col = hole.col;
  if (dRow !== 0) {
    ri = Math.max(0, Math.min(rows.length - 1, ri + dRow));
    const row = rows[ri];
    if (isRailRow(row) && !spec.railColumns.includes(col)) {
      col = spec.railColumns.reduce((b, c) => (Math.abs(c - col) < Math.abs(b - col) ? c : b), spec.railColumns[0]);
    }
    return { board: board.id, row, col };
  }
  const row = rows[ri];
  if (isRailRow(row)) {
    const cols = spec.railColumns;
    const i = cols.indexOf(col);
    const ni = Math.max(0, Math.min(cols.length - 1, (i < 0 ? 0 : i) + dCol));
    return { board: board.id, row, col: cols[ni] };
  }
  col = Math.max(1, Math.min(spec.columns, col + dCol));
  return { board: board.id, row, col };
}

// ---------------------------------------------------------------------------------------------
// Names

/** Compact name of a hole: "e15", "top+12"; prefixed "bb2/" when `withBoard`. */
export function holeName(h: BreadboardHole, withBoard = false): string {
  const base = `${h.row}${h.col}`;
  return withBoard ? `${h.board}/${base}` : base;
}

/** Parse "e15", "top+12", "bb2/e15" (board defaults to `defaultBoard`). */
export function parseHoleName(text: string, defaultBoard = 'bb1'): BreadboardHole | null {
  const m = /^\s*(?:([^/\s]+)\/)?(top\+|top-|bot\+|bot-|[a-jA-J])\s*(\d+)\s*$/.exec(text);
  if (!m) return null;
  const row = (m[2].length === 1 ? m[2].toLowerCase() : m[2]) as BreadboardRow;
  return { board: m[1] ?? defaultBoard, row, col: Number(m[3]) };
}

/** Learner-friendly description of a hole, e.g. "lỗ e15 (hàng e, cột 15)". */
export function describeHole(h: BreadboardHole, withBoard = false): LocalizedText {
  return holeText(holeName(h), h.row, h.col, withBoard ? boardPrefixText(h.board) : '');
}

/** Learner-friendly description of a strip. */
export function describeStrip(stripId: string, withBoard = false): LocalizedText {
  const info = parseStripId(stripId);
  const prefix = withBoard && info ? boardPrefixText(info.board) : '';
  if (!info) return { vi: stripId, en: stripId };
  if (info.kind === 'terminal') return terminalStripText(info.col ?? 0, info.side === 'ae', prefix);
  const r = railName(info.rail ?? 'top+', info.half);
  return { vi: prefix + r.vi, en: prefix + r.en };
}

export function boardMap(layout: Pick<BreadboardLayout, 'boards'>): Map<string, BoardInstance> {
  return new Map(layout.boards.map((b) => [b.id, b]));
}

/** Bench bounding box (mm) of all boards. */
export function benchBounds(boards: readonly BoardInstance[]): { x: number; y: number; w: number; h: number } {
  if (!boards.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boards) {
    const s = boardSpec(b.kind);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + s.width);
    y1 = Math.max(y1, b.y + s.height);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
