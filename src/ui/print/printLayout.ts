/**
 * Print layout maths (pure): where each piece of a print job lands on paper.
 *
 * A print job is a list of **items**: pictures (a schematic sheet, a ladder sheet, a Grapher page)
 * with a natural size in millimetres, and pages of text (a report, an instrument list, a lesson
 * hand-out) that already have the size of the printable area. The page setup says the paper, the
 * orientation, the margins and the scale; {@link layoutItems} turns items + setup into the pages
 * the preview shows and the printer prints:
 *
 *  - **fit**: the picture is scaled to the largest size that fits inside the printable area (never
 *    clipped), centred;
 *  - **a percentage**: 100 % is the natural size (a drawing frame of an A4 sheet is exactly an A4
 *    page). A picture larger than the printable area is cut off at the margin — or, with
 *    **tiling**, spread over as many pages as it needs, neighbouring tiles overlapping by
 *    {@link TILE_OVERLAP_MM} so the pieces can be glued together; the preview shows the grid;
 *  - text pages are never scaled.
 *
 * Page numbers count every page of the job, tiles included ("page 3 of 7"); the page range
 * ("1-3, 5") selects pages by those numbers.
 *
 * Everything here is plain numbers (no DOM), so the maths is tested on known sheet sizes.
 */
import { PAPER_MM } from '../../model/paper';
import type { PaperSize, PrintSetup } from '../../model/types';

/** Default margin on every side. */
export const DEFAULT_MARGIN_MM = 10;
/** Smallest margin / largest margin the dialog accepts. */
export const MARGIN_RANGE_MM = { min: 0, max: 50 } as const;
/** Neighbouring tiles of a tiled picture overlap by this much (glue strip). */
export const TILE_OVERLAP_MM = 8;
/** Height reserved for the page footer line (design, sheet, page n of m). */
export const FOOTER_MM = 6;
/** Scale limits of a fixed zoom, in percent. */
export const SCALE_RANGE = { min: 5, max: 1000 } as const;

export interface PageSetup {
  paper: Exclude<PaperSize, 'Custom'> | 'Custom';
  /** Custom paper size, millimetres (portrait-independent: width x height as the learner typed) */
  customMm?: { w: number; h: number };
  orientation: 'landscape' | 'portrait';
  /** margin on every side, mm */
  marginMm: number;
  /** 'fit' or a percentage of the natural size */
  scale: 'fit' | number;
  /** spread a picture that is larger than the page over several pages */
  tile: boolean;
  /** draw the page footer (design title, sheet name, page n of m) */
  footer: boolean;
  /** black and white instead of colour */
  monochrome: boolean;
  /** page numbers to print ("1-3, 5"); empty = all */
  pageRange: string;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  orientation: 'landscape',
  marginMm: DEFAULT_MARGIN_MM,
  scale: 'fit',
  tile: false,
  footer: false,
  monochrome: false,
  pageRange: '',
};

/** The page setup stored in a design (Design.printSetup), with defaults filled in. */
export function setupFromDesign(p: PrintSetup | undefined): PageSetup {
  const d = DEFAULT_PAGE_SETUP;
  return {
    paper: p?.paper ?? d.paper,
    ...(p?.paper === 'Custom' && p.customMm ? { customMm: p.customMm } : {}),
    orientation: p?.orientation ?? d.orientation,
    marginMm: clampMargin(p?.marginMm ?? d.marginMm),
    scale: p?.scale === undefined ? d.scale : p.scale === 'fit' ? 'fit' : clampScale(p.scale),
    tile: p?.tile ?? d.tile,
    footer: p?.footer ?? d.footer,
    monochrome: p?.monochrome ?? d.monochrome,
    pageRange: p?.pageRange ?? d.pageRange,
  };
}

/** Key order of Design.printSetup in a saved file (the validator writes this order). */
const PRINT_SETUP_KEYS: (keyof PrintSetup)[] = ['paper', 'orientation', 'scale', 'sheets', 'includeChildren', 'includeInstruments', 'monochrome', 'tile', 'footer', 'marginMm', 'pageRange', 'customMm'];

/**
 * The page setup as Design.printSetup stores it: `base` (which sheets, child sheets, instrument
 * page) plus the page options, where options at their default are left out so an untouched design
 * stays as small as before. Keys come out in the order of a saved file.
 */
export function setupToDesign(setup: PageSetup, base: PrintSetup = {}): PrintSetup {
  const merged: PrintSetup = { ...base, paper: setup.paper, orientation: setup.orientation, scale: setup.scale };
  const drop = (key: keyof PrintSetup, isDefault: boolean) => {
    if (isDefault) delete merged[key];
  };
  merged.marginMm = setup.marginMm;
  merged.tile = setup.tile;
  merged.footer = setup.footer;
  merged.monochrome = setup.monochrome;
  merged.pageRange = setup.pageRange.trim();
  merged.customMm = setup.paper === 'Custom' ? setup.customMm : undefined;
  drop('marginMm', setup.marginMm === DEFAULT_MARGIN_MM);
  drop('tile', !setup.tile);
  drop('footer', !setup.footer);
  drop('monochrome', !setup.monochrome);
  drop('pageRange', !setup.pageRange.trim());
  drop('customMm', setup.paper !== 'Custom' || !setup.customMm);
  const out: PrintSetup = {};
  for (const k of PRINT_SETUP_KEYS) if (merged[k] !== undefined) (out as Record<string, unknown>)[k] = merged[k];
  return out;
}

export const clampMargin = (v: number): number => (Number.isFinite(v) ? Math.min(MARGIN_RANGE_MM.max, Math.max(MARGIN_RANGE_MM.min, Math.round(v * 10) / 10)) : DEFAULT_MARGIN_MM);
export const clampScale = (v: number): number => (Number.isFinite(v) ? Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, Math.round(v * 10) / 10)) : 100);

/** Paper size in millimetres after the orientation (width x height as printed). */
export function paperSizeMm(setup: Pick<PageSetup, 'paper' | 'customMm' | 'orientation'>): { w: number; h: number } {
  let long: number;
  let short: number;
  if (setup.paper === 'Custom') {
    const c = setup.customMm ?? { w: 297, h: 210 };
    long = Math.max(c.w, c.h);
    short = Math.min(c.w, c.h);
  } else {
    [long, short] = PAPER_MM[setup.paper];
  }
  return setup.orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short };
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The printable area inside the margins (and above the footer line when there is one), in mm from the page corner. */
export function printableArea(setup: Pick<PageSetup, 'paper' | 'customMm' | 'orientation' | 'marginMm' | 'footer'>): Area {
  const p = paperSizeMm(setup);
  const m = clampMargin(setup.marginMm);
  const footer = setup.footer ? FOOTER_MM : 0;
  // never let the margins eat the page: keep at least 20 mm to draw on
  const w = Math.max(20, p.w - 2 * m);
  const h = Math.max(20, p.h - 2 * m - footer);
  return { x: Math.min(m, (p.w - w) / 2), y: Math.min(m, (p.h - h - footer) / 2), w: round1(w), h: round1(h) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** What a print job contains, as the layout sees it. */
export interface PrintItem {
  id: string;
  /** natural size at 100 %, millimetres (text pages: the printable area) */
  widthMm: number;
  heightMm: number;
  /** text pages and tables: never scaled, never tiled */
  fixed?: boolean;
}

export interface LayoutPage {
  /** number among ALL pages of the job (1-based), before the page range is applied */
  number: number;
  itemId: string;
  /** position among the tiles of the item (0-based) and the tile grid size */
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** scale factor applied to the item (1 = natural size) */
  scale: number;
  /** the item at this scale, mm */
  scaledMm: { w: number; h: number };
  /** the part of the scaled item shown on this page, mm in scaled-item coordinates */
  viewMm: Area;
  /** where that part sits on the page, mm from the page corner */
  placeMm: { x: number; y: number };
  /** the picture is larger than the area and tiling is off: its edges are cut */
  clipped: boolean;
}

export interface PrintLayout {
  paperMm: { w: number; h: number };
  area: Area;
  /** every page of the job, in order */
  all: LayoutPage[];
  /** the pages that will be printed (the page range applied) */
  pages: LayoutPage[];
  /** a problem with the page range text (null = fine) */
  rangeError: string | null;
  /** items that are cut off because tiling is off */
  clippedItems: string[];
}

/** Scale factor of an item for the setup (1 = natural size). */
export function itemScale(item: PrintItem, setup: Pick<PageSetup, 'scale'>, area: Pick<Area, 'w' | 'h'>): number {
  if (item.fixed) return 1;
  if (setup.scale === 'fit') return Math.min(area.w / item.widthMm, area.h / item.heightMm);
  return clampScale(setup.scale) / 100;
}

/** Number of tiles along one axis for a scaled length (1 when it fits). */
export function tileCount(scaled: number, available: number, overlap = TILE_OVERLAP_MM): number {
  if (scaled <= available + 0.5) return 1;
  const step = Math.max(1, available - overlap);
  return 1 + Math.ceil((scaled - available - 0.5) / step);
}

/** Lay the items out on pages. */
export function layoutItems(items: readonly PrintItem[], setup: PageSetup): PrintLayout {
  const area = printableArea(setup);
  const all: LayoutPage[] = [];
  const clippedItems: string[] = [];
  for (const item of items) {
    const k = itemScale(item, setup, area);
    const sw = item.widthMm * k;
    const sh = item.heightMm * k;
    const tiled = setup.tile && !item.fixed && setup.scale !== 'fit';
    const cols = tiled ? tileCount(sw, area.w) : 1;
    const rows = tiled ? tileCount(sh, area.h) : 1;
    const clipped = !tiled && !item.fixed && (sw > area.w + 0.5 || sh > area.h + 0.5);
    if (clipped) clippedItems.push(item.id);
    const stepX = Math.max(1, area.w - TILE_OVERLAP_MM);
    const stepY = Math.max(1, area.h - TILE_OVERLAP_MM);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // tiles start every (area - overlap) mm; the last one of a row / column may be smaller
        const vx = tiled ? col * stepX : 0;
        const vy = tiled ? row * stepY : 0;
        const vw = Math.min(area.w, sw - vx);
        const vh = Math.min(area.h, sh - vy);
        // a whole sheet that fits is centred in the area; tiles sit in its top-left corner
        const centre = !tiled;
        const px = area.x + (centre ? (area.w - Math.min(vw, area.w)) / 2 : 0);
        const py = area.y + (centre ? (area.h - Math.min(vh, area.h)) / 2 : 0);
        all.push({
          number: all.length + 1,
          itemId: item.id,
          col,
          row,
          cols,
          rows,
          scale: k,
          scaledMm: { w: round1(sw), h: round1(sh) },
          viewMm: { x: round1(vx), y: round1(vy), w: round1(Math.min(vw, area.w)), h: round1(Math.min(vh, area.h)) },
          placeMm: { x: round1(px), y: round1(py) },
          clipped,
        });
      }
    }
  }
  const range = parsePageRange(setup.pageRange, all.length);
  const pages = range.pages ? all.filter((p) => range.pages!.includes(p.number)) : all;
  return { paperMm: paperSizeMm(setup), area, all, pages, rangeError: range.error, clippedItems };
}

/**
 * Page numbers from range text: "1-3, 5", "2-" (page 2 to the end), "-3" (up to 3), "7". Empty
 * text means every page (`pages` null). Numbers outside 1..total are an error, as are descending
 * ranges and text that is not numbers.
 */
export function parsePageRange(text: string, total: number): { pages: number[] | null; error: string | null } {
  const src = text.trim();
  if (!src) return { pages: null, error: null };
  const out = new Set<number>();
  for (const raw of src.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    let from: number;
    let to: number;
    if (m && (m[1] || m[2])) {
      from = m[1] ? Number(m[1]) : 1;
      to = m[2] ? Number(m[2]) : total;
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part);
    } else return { pages: null, error: part };
    if (from < 1 || to < 1 || from > total || to > total || from > to) return { pages: null, error: part };
    for (let n = from; n <= to; n++) out.add(n);
  }
  if (!out.size) return { pages: null, error: src };
  return { pages: [...out].sort((a, b) => a - b), error: null };
}

/** Number of pages a printed range selects, for the "n of m pages" line. */
export function pageCountText(layout: Pick<PrintLayout, 'pages' | 'all'>): { printed: number; total: number } {
  return { printed: layout.pages.length, total: layout.all.length };
}

// ---------------------------------------------------------------------------
// text pages
// ---------------------------------------------------------------------------

/** Typography of a text page (millimetres). */
export const TEXT_METRICS = {
  /** body line height */
  lineMm: 4.6,
  /** width of one average character at the body size */
  charMm: 1.9,
  /** height of the page title block */
  titleMm: 11,
  /** padding inside a table cell, top + bottom */
  cellPadMm: 1.4,
} as const;

/** Break text into lines of at most `max` characters (words are kept whole when they fit). */
export function wrapText(text: string, max: number): string[] {
  const limit = Math.max(4, Math.floor(max));
  const lines: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > limit) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, limit));
        w = w.slice(limit);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= limit) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A table to print: a title, a header row and rows of cell texts. */
export interface PrintTable {
  title: string;
  subtitle?: string;
  header: string[];
  rows: string[][];
  /** relative column widths (default: by the length of the texts in the column) */
  weights?: number[];
}

export interface TablePage {
  /** the table slice on this page (header repeated on every page) */
  rows: { cells: string[][]; heightMm: number }[];
  /** the page shows the title block (first page of the table) */
  first: boolean;
  /** column widths, mm */
  columnsMm: number[];
}

/** Column widths for a table over `widthMm`. */
export function tableColumns(table: PrintTable, widthMm: number): number[] {
  const n = Math.max(1, table.header.length);
  // without weights a column is as wide as its longest text (between 3 and 40 characters), so a
  // narrow "#" column does not take as much room as a description
  const byText = Array.from({ length: n }, (_v, i) => Math.min(40, Math.max(3, table.header[i]?.length ?? 0, ...table.rows.map((r) => String(r[i] ?? '').length))));
  const w = table.weights && table.weights.length === n ? table.weights : byText;
  const sum = w.reduce((a, b) => a + b, 0) || n;
  return w.map((x) => round1((x / sum) * widthMm));
}

/**
 * Split a table over pages of the given printable area. A row is never split; a row taller than a
 * page (cannot happen with sane text) gets a page of its own. Every page repeats the header row.
 */
export function paginateTable(table: PrintTable, area: Pick<Area, 'w' | 'h'>): TablePage[] {
  const m = TEXT_METRICS;
  const columnsMm = tableColumns(table, area.w);
  const rowHeight = (cells: string[]): { cells: string[][]; heightMm: number } => {
    const wrapped = cells.map((c, i) => wrapText(c, (columnsMm[i] ?? 20) / m.charMm - 1));
    const lines = Math.max(1, ...wrapped.map((l) => l.length));
    return { cells: wrapped, heightMm: round1(lines * m.lineMm + m.cellPadMm) };
  };
  const header = rowHeight(table.header);
  const body = table.rows.map(rowHeight);
  const pages: TablePage[] = [];
  let current: TablePage = { rows: [], first: true, columnsMm };
  let used = m.titleMm + (table.subtitle ? m.lineMm : 0) + header.heightMm;
  for (const row of body) {
    if (current.rows.length && used + row.heightMm > area.h) {
      pages.push(current);
      current = { rows: [], first: false, columnsMm };
      used = header.heightMm;
    }
    current.rows.push(row);
    used += row.heightMm;
  }
  pages.push(current);
  return pages;
}

/** A block of a text document: a heading, a paragraph or a list of bullet points. */
export type DocBlock = { kind: 'heading'; text: string } | { kind: 'paragraph'; text: string } | { kind: 'bullets'; items: string[] };

export interface DocPage {
  /** lines to draw: text, its kind and the height it takes */
  lines: { text: string; kind: 'heading' | 'paragraph' | 'bullet' | 'blank'; heightMm: number }[];
}

/** Flow the blocks of a document over pages of the printable area. */
export function paginateDocument(blocks: readonly DocBlock[], area: Pick<Area, 'w' | 'h'>): DocPage[] {
  const m = TEXT_METRICS;
  const perLine = area.w / m.charMm - 1;
  const lines: DocPage['lines'] = [];
  const push = (text: string, kind: DocPage['lines'][number]['kind']) => lines.push({ text, kind, heightMm: kind === 'heading' ? m.lineMm * 1.6 : m.lineMm });
  for (const b of blocks) {
    if (b.kind === 'heading') {
      push('', 'blank');
      for (const l of wrapText(b.text, perLine * 0.8)) push(l, 'heading');
    } else if (b.kind === 'paragraph') {
      for (const l of wrapText(b.text, perLine)) push(l, l ? 'paragraph' : 'blank');
    } else {
      for (const item of b.items) wrapText(item, perLine - 3).forEach((l, i) => push(i === 0 ? `• ${l}` : `  ${l}`, 'bullet'));
    }
  }
  const pages: DocPage[] = [];
  let current: DocPage = { lines: [] };
  let used = 0;
  const lastKind = () => current.lines[current.lines.length - 1]?.kind;
  for (const line of lines) {
    // a blank line at the top of a page is dropped
    if (!current.lines.length && line.kind === 'blank') continue;
    if (used + line.heightMm > area.h && current.lines.length) {
      // a heading never ends a page: it moves to the next page together with the text it introduces
      const carry: DocPage['lines'] = [];
      while (lastKind() === 'heading') carry.unshift(current.lines.pop()!);
      while (lastKind() === 'blank') current.lines.pop();
      if (!current.lines.length) {
        // the page held nothing but headings: keep them where they are
        current.lines.push(...carry.splice(0));
      }
      pages.push(current);
      current = { lines: carry };
      used = carry.reduce((sum, l) => sum + l.heightMm, 0);
    }
    current.lines.push(line);
    used += line.heightMm;
  }
  if (current.lines.length || !pages.length) pages.push(current);
  return pages;
}
