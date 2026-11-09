/**
 * Drawing layout of a ladder rung: the grid the editor paints the rails, contacts and coils on.
 *
 * The logic of a rung is a tree, and a tree lays out on a grid by two rules:
 *   series   width = sum of the children, height = the tallest child (one after another)
 *   parallel width = the widest child, height = sum of the children (stacked)
 * A child narrower than its group is stretched with a horizontal link (`fills`), and the branches
 * of a parallel group are joined at both ends by a vertical link (`verticals`) — exactly the
 * short vertical line a ladder diagram draws there.
 *
 * Element slots are computed the same way as in the compiler (contacts of the logic in reading
 * order, then the coils), so the layout of the editor and the live states of the running program
 * line up without any table being passed between them.
 *
 * Pure module: grid units only (column / row indices). The renderer turns them into pixels.
 */
import { elementSlot, rungSlot, type LadderError } from './program';
import type { LadderNode, LadderOutput, LadderRung } from './types';

/** One drawn contact (or comparison) of a rung. */
export interface LadderCell {
  node: LadderNode;
  /** position in the rung's logic tree (indices of the items on the way down) */
  path: number[];
  slot: number;
  col: number;
  row: number;
}

/** One drawn coil / timer / counter on the right rail. */
export interface LadderCoil {
  output: LadderOutput;
  index: number;
  slot: number;
  row: number;
}

/** Horizontal link of `len` columns starting at (`col`, `row`). */
export interface LadderFill {
  col: number;
  row: number;
  len: number;
}

/** Vertical link at column boundary `col`, joining rows `row1` … `row2`. */
export interface LadderVertical {
  col: number;
  row1: number;
  row2: number;
}

export interface RungLayout {
  /** rung index (0-based) */
  index: number;
  /** columns the logic needs (at least 1) */
  cols: number;
  /** rows the rung needs (logic height or coil count, at least 1) */
  rows: number;
  cells: LadderCell[];
  coils: LadderCoil[];
  fills: LadderFill[];
  verticals: LadderVertical[];
  /** slot that lights up when power reaches the coils */
  slot: number;
}

function sizeOf(node: LadderNode): { w: number; h: number } {
  if (node.kind === 'contact' || node.kind === 'compare') return { w: 1, h: 1 };
  const items = node.items.length ? node.items.map(sizeOf) : [{ w: 1, h: 1 }];
  if (node.kind === 'series') return { w: items.reduce((a, s) => a + s.w, 0), h: Math.max(...items.map((s) => s.h)) };
  return { w: Math.max(...items.map((s) => s.w)), h: items.reduce((a, s) => a + s.h, 0) };
}

/** Columns and rows a rung's logic needs. */
export function logicSize(node: LadderNode | undefined): { w: number; h: number } {
  return node ? sizeOf(node) : { w: 0, h: 1 };
}

interface Ctx {
  cells: LadderCell[];
  fills: LadderFill[];
  verticals: LadderVertical[];
  rung: number;
  k: number;
}

function place(ctx: Ctx, node: LadderNode, path: number[], col: number, row: number, width: number): void {
  if (node.kind === 'contact' || node.kind === 'compare') {
    ctx.cells.push({ node, path, slot: elementSlot(ctx.rung, ctx.k++), col, row });
    if (width > 1) ctx.fills.push({ col: col + 1, row, len: width - 1 });
    return;
  }
  const items = node.items;
  if (items.length === 0) {
    ctx.fills.push({ col, row, len: Math.max(1, width) });
    return;
  }
  if (node.kind === 'series') {
    const sizes = items.map(sizeOf);
    const natural = sizes.reduce((a, s) => a + s.w, 0);
    let c = col;
    items.forEach((item, i) => {
      place(ctx, item, [...path, i], c, row, sizes[i].w);
      c += sizes[i].w;
    });
    if (width > natural) ctx.fills.push({ col: c, row, len: width - natural });
    return;
  }
  const sizes = items.map(sizeOf);
  const rows: number[] = [];
  let r = row;
  items.forEach((item, i) => {
    rows.push(r);
    place(ctx, item, [...path, i], col, r, width);
    r += sizes[i].h;
  });
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (last > first) {
    ctx.verticals.push({ col, row1: first, row2: last });
    ctx.verticals.push({ col: col + width, row1: first, row2: last });
  }
}

/** Grid layout of one rung (`index` is its 0-based position in the program). */
export function layoutRung(rung: LadderRung, index: number): RungLayout {
  const ctx: Ctx = { cells: [], fills: [], verticals: [], rung: index, k: 0 };
  const size = logicSize(rung.logic);
  if (rung.logic) place(ctx, rung.logic, [], 0, 0, size.w);
  const coils: LadderCoil[] = rung.outputs.map((output, i) => ({ output, index: i, slot: 0, row: i }));
  // the compiler numbers the coils after the contacts
  coils.forEach((c) => {
    c.slot = elementSlot(index, ctx.k++);
  });
  return {
    index,
    cols: Math.max(1, size.w),
    rows: Math.max(1, size.h, coils.length),
    cells: ctx.cells,
    coils,
    fills: ctx.fills,
    verticals: ctx.verticals,
    slot: rungSlot(index),
  };
}

/** Layout of a whole program, plus the widest rung (so every rung can share one rail position). */
export function layoutLadder(rungs: readonly LadderRung[]): { rungs: RungLayout[]; cols: number } {
  const out = rungs.map((r, i) => layoutRung(r, i));
  return { rungs: out, cols: out.reduce((a, r) => Math.max(a, r.cols), 1) };
}

/** Problems of one rung, from a compiler error list (1-based rung numbers). */
export function rungErrors(errors: readonly LadderError[], index: number): LadderError[] {
  return errors.filter((e) => e.rung === index + 1);
}
