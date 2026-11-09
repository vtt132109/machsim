/**
 * Drawing a ladder sheet as plain SVG markup, for paper and for picture files.
 *
 * The ladder editor (src/ui/ladder/LadderSheetView.tsx) paints the rungs with React components and
 * the stylesheet of the editor. Print (src/ui/app/document.ts) and File › Export image build their
 * pages with {@link sheetToSvg}, which renders the *schematic* lists of a sheet — and a ladder
 * sheet keeps those empty, because its program lives in `Sheet.ladder`. So a learner who printed a
 * ladder exercise got an empty frame.
 *
 * This module closes that gap with one pure function, {@link ladderSheetSvg}: it lays the rungs out
 * with the very same pure layout the editor uses (`layoutLadder`, src/ladder/layout.ts) and the
 * geometry constants exported here (the editor imports them from this module, so the printed
 * diagram and the one on screen cannot drift apart), then writes SVG elements whose colours are the
 * export palette's CSS variables (`var(--wire)`, `var(--text)`, `var(--part)`), so the same markup
 * prints in colour or in black and white without a second code path.
 *
 * No DOM, no React, no store: the function takes rungs and returns markup, which is why it can be
 * tested in the node environment next to the layout it uses.
 */
import { COMPARE_SYMBOL, OUTPUT_CODE } from '../../ladder/program';
import { layoutLadder, type LadderCell, type LadderCoil, type RungLayout } from '../../ladder/layout';
import type { LadderRung } from '../../ladder/types';
import { lt } from '../../i18n/ladderText';

/** Width of one logic column (one contact), in schematic units. */
export const LADDER_COL = 110;
/** Height of one row of a rung. */
export const LADDER_ROW = 34;
/** Distance from the left edge to the left rail. */
export const LADDER_RAIL_LEFT = 26;
/** Width of the coil column in front of the right rail. */
export const LADDER_COIL_COL = 150;
/** Height of the caption line above a rung. */
export const LADDER_HEAD = 22;
/** Empty space below a rung. */
export const LADDER_PAD = 12;

/** Height of one rung block (caption, rows and the gap below). */
export function ladderRungHeight(r: RungLayout): number {
  return LADDER_HEAD + r.rows * LADDER_ROW + LADDER_PAD;
}

/** Total width of a ladder diagram with `cols` logic columns. */
export function ladderDiagramWidth(cols: number): number {
  return LADDER_RAIL_LEFT + cols * LADDER_COL + LADDER_COIL_COL + 40;
}

const WIRE = 'fill:none;stroke:var(--wire);stroke-width:1.6;stroke-linecap:round';
const RAIL = 'fill:none;stroke:var(--wire);stroke-width:3;stroke-linecap:round';
const BAR = 'fill:none;stroke:var(--part);stroke-width:2.2;stroke-linecap:round';
const ARC = 'fill:none;stroke:var(--part);stroke-width:2.2';
const ADDR = 'fill:var(--text);font-size:11px;text-anchor:middle';
const MARK = 'fill:var(--text);font-size:11px;font-weight:600;text-anchor:middle';
const CAPTION = 'fill:var(--text-dim);font-size:11px';

/** XML-escape a text node / attribute value. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const line = (x1: number, y1: number, x2: number, y2: number, style: string): string =>
  `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" style="${style}"/>`;

const textEl = (x: number, y: number, style: string, body: string): string => `<text x="${r(x)}" y="${r(y)}" style="${style}">${esc(body)}</text>`;

/** Round to 0.01 so the markup stays short and stable. */
function r(v: number): number {
  return Math.round(v * 100) / 100;
}

/** One contact or comparison of a rung. */
function cellMarkup(cell: LadderCell, x0: number, y0: number): string {
  const cx = x0 + cell.col * LADDER_COL + LADDER_COL / 2;
  const cy = y0 + cell.row * LADDER_ROW + LADDER_ROW / 2;
  const node = cell.node;
  const label = node.kind === 'contact' ? node.address : node.kind === 'compare' ? `${node.left} ${COMPARE_SYMBOL[node.op]} ${node.right}` : '';
  const mark = node.kind === 'contact' ? (node.type === 'rising' ? 'P' : node.type === 'falling' ? 'N' : '') : '';
  const out = [
    line(cx - LADDER_COL / 2, cy, cx + LADDER_COL / 2, cy, WIRE),
    line(cx - 8, cy - 11, cx - 8, cy + 11, BAR),
    line(cx + 8, cy - 11, cx + 8, cy + 11, BAR),
  ];
  if (node.kind === 'contact' && node.type === 'nc') out.push(line(cx - 10, cy + 11, cx + 10, cy - 11, BAR));
  if (mark) out.push(textEl(cx, cy + 4, MARK, mark));
  if (label) out.push(textEl(cx, cy - 15, ADDR, label));
  return out.join('');
}

/** One coil / timer / counter against the right rail. */
function coilMarkup(coil: LadderCoil, x: number, y0: number): string {
  const cy = y0 + coil.row * LADDER_ROW + LADDER_ROW / 2;
  const o = coil.output;
  const code = OUTPUT_CODE[o.kind];
  const cx = x + 40;
  const out = [
    line(x - LADDER_COIL_COL + 40, cy, cx - 14, cy, WIRE),
    `<path d="M ${r(cx - 10)} ${r(cy - 11)} A 13 13 0 0 0 ${r(cx - 10)} ${r(cy + 11)}" style="${ARC}"/>`,
    `<path d="M ${r(cx + 10)} ${r(cy - 11)} A 13 13 0 0 1 ${r(cx + 10)} ${r(cy + 11)}" style="${ARC}"/>`,
    line(cx + 14, cy, cx + 30, cy, WIRE),
  ];
  if (code) out.push(textEl(cx, cy + 4, MARK, code));
  out.push(textEl(cx, cy - 15, ADDR, o.address));
  if (o.preset !== undefined && o.preset !== '') out.push(textEl(cx, cy + 20, ADDR, o.preset));
  return out.join('');
}

export interface LadderSvgOptions {
  /** least number of logic columns to reserve (the editor keeps the rails aligned this way) */
  minCols?: number;
}

export interface LadderSvg {
  /** SVG elements of the diagram, in its own coordinates (no <svg> wrapper) */
  markup: string;
  width: number;
  height: number;
}

/**
 * The rungs of a ladder sheet as SVG elements: the rails, the contacts with their addresses, the
 * coils with their codes and presets, and a caption line per rung ("Rung 2 — hold in"). The
 * coordinates start at (0, 0); the caller scales and places the group.
 */
export function ladderSheetSvg(rungs: readonly LadderRung[], opts: LadderSvgOptions = {}): LadderSvg {
  const layout = layoutLadder(rungs);
  const cols = Math.max(opts.minCols ?? 1, layout.cols);
  const width = ladderDiagramWidth(cols);
  const parts: string[] = [];
  let y = 0;
  layout.rungs.forEach((rl, i) => {
    const rung = rungs[i];
    const top = y;
    const y0 = top + LADDER_HEAD;
    const x0 = LADDER_RAIL_LEFT;
    const railR = LADDER_RAIL_LEFT + cols * LADDER_COL + LADDER_COIL_COL;
    parts.push(textEl(x0 + 4, top + 15, CAPTION, `${lt('rung', { n: i + 1 })}${rung.comment ? ` — ${rung.comment}` : ''}${rung.disabled ? ` ${lt('disabled')}` : ''}`));
    parts.push(line(x0, y0, x0, y0 + rl.rows * LADDER_ROW, RAIL));
    parts.push(line(railR, y0, railR, y0 + rl.rows * LADDER_ROW, RAIL));
    if (!rung.logic) parts.push(line(x0, y0 + LADDER_ROW / 2, x0 + LADDER_COL / 2, y0 + LADDER_ROW / 2, WIRE));
    for (const f of rl.fills) parts.push(line(x0 + f.col * LADDER_COL, y0 + f.row * LADDER_ROW + LADDER_ROW / 2, x0 + (f.col + f.len) * LADDER_COL, y0 + f.row * LADDER_ROW + LADDER_ROW / 2, WIRE));
    for (const v of rl.verticals) parts.push(line(x0 + v.col * LADDER_COL, y0 + v.row1 * LADDER_ROW + LADDER_ROW / 2, x0 + v.col * LADDER_COL, y0 + v.row2 * LADDER_ROW + LADDER_ROW / 2, WIRE));
    parts.push(line(x0 + rl.cols * LADDER_COL, y0 + LADDER_ROW / 2, railR - LADDER_COIL_COL + 40, y0 + LADDER_ROW / 2, WIRE));
    if (rl.coils.length > 1) parts.push(line(railR - LADDER_COIL_COL + 40, y0 + LADDER_ROW / 2, railR - LADDER_COIL_COL + 40, y0 + (rl.coils.length - 1) * LADDER_ROW + LADDER_ROW / 2, WIRE));
    for (const c of rl.cells) parts.push(cellMarkup(c, x0, y0));
    for (const c of rl.coils) parts.push(coilMarkup(c, railR - 40, y0));
    y += ladderRungHeight(rl);
  });
  return { markup: parts.join(''), width, height: Math.max(y + 10, 80) };
}
