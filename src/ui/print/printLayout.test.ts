/**
 * Print layout maths on known sheet sizes: paper, margins, fit / fixed scale, tiling of a sheet
 * larger than the page, page ranges, the footer, and the pagination of tables and documents.
 * Numbers are worked out by hand from the paper sizes (an A4 landscape sheet is 297 x 210 mm).
 */
import { describe, expect, it } from 'vitest';
import { sheetFrame, UNITS_PER_MM } from '../../model/paper';
import { parseDesign, serializeDesign } from '../../model/serialize';
import { newDesign } from '../../model/types';
import { buildJob, footerParts, unitsToMm, type ImageContent } from './printModel';
import {
  DEFAULT_PAGE_SETUP,
  FOOTER_MM,
  TILE_OVERLAP_MM,
  itemScale,
  layoutItems,
  pageCountText,
  paginateDocument,
  paginateTable,
  paperSizeMm,
  parsePageRange,
  printableArea,
  setupFromDesign,
  setupToDesign,
  tileCount,
  wrapText,
  type PageSetup,
  type PrintItem,
} from './printLayout';
import { sheetIdsFor } from './printSources';

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({ ...DEFAULT_PAGE_SETUP, ...over });

/** the exported image of a sheet of that paper: its drawing frame plus the 5-unit margin all round */
function sheetItem(paper: 'A4' | 'A3' | 'A2' | 'A1' | 'A0', id: string = paper): PrintItem {
  const f = sheetFrame({ paper, orientation: 'landscape' });
  return { id, widthMm: unitsToMm(f.w + 10), heightMm: unitsToMm(f.h + 10) };
}

describe('paper and printable area', () => {
  it('paper sizes follow the orientation', () => {
    expect(paperSizeMm(setup())).toEqual({ w: 297, h: 210 });
    expect(paperSizeMm(setup({ orientation: 'portrait' }))).toEqual({ w: 210, h: 297 });
    expect(paperSizeMm(setup({ paper: 'Letter' }))).toEqual({ w: 279.4, h: 215.9 });
    expect(paperSizeMm(setup({ paper: 'A3', orientation: 'portrait' }))).toEqual({ w: 297, h: 420 });
  });

  it('a custom paper is landscape or portrait whichever way round it was typed', () => {
    expect(paperSizeMm(setup({ paper: 'Custom', customMm: { w: 200, h: 400 } }))).toEqual({ w: 400, h: 200 });
    expect(paperSizeMm(setup({ paper: 'Custom', customMm: { w: 400, h: 200 }, orientation: 'portrait' }))).toEqual({ w: 200, h: 400 });
  });

  it('the printable area is the paper minus the margins, and the footer line', () => {
    expect(printableArea(setup())).toEqual({ x: 10, y: 10, w: 277, h: 190 });
    expect(printableArea(setup({ marginMm: 0 }))).toEqual({ x: 0, y: 0, w: 297, h: 210 });
    expect(printableArea(setup({ marginMm: 25 }))).toEqual({ x: 25, y: 25, w: 247, h: 160 });
    expect(printableArea(setup({ footer: true }))).toEqual({ x: 10, y: 10, w: 277, h: 190 - FOOTER_MM });
  });

  it('margins are limited to 50 mm and never leave less than 20 mm to draw on', () => {
    expect(printableArea(setup({ marginMm: 200 })).w).toBe(197);
    const tiny = printableArea(setup({ paper: 'Custom', customMm: { w: 60, h: 50 }, marginMm: 50 }));
    expect(tiny.w).toBeGreaterThanOrEqual(20);
    expect(tiny.h).toBeGreaterThanOrEqual(20);
  });
});

describe('natural size of a sheet', () => {
  it('an A4 sheet exports at 300 x 212.5 mm (its frame is 1190 x 840 units, rounded to 10, plus the 5-unit margin all round)', () => {
    expect(UNITS_PER_MM).toBe(4);
    expect(sheetItem('A4')).toMatchObject({ widthMm: 300, heightMm: 212.5 });
    expect(sheetItem('A3')).toMatchObject({ widthMm: 422.5, heightMm: 300 });
    expect(sheetItem('A2')).toMatchObject({ widthMm: 597.5, heightMm: 422.5 });
  });
});

describe('fit', () => {
  it('scales an A4 sheet to the largest size inside the margins, centred, one page', () => {
    const l = layoutItems([sheetItem('A4')], setup());
    expect(l.pages).toHaveLength(1);
    const p = l.pages[0];
    // limited by the height: 190 / 212.5
    expect(p.scale).toBeCloseTo(190 / 212.5, 9);
    expect(p.scaledMm.h).toBeCloseTo(190, 0);
    expect(p.scaledMm.w).toBeCloseTo(300 * (190 / 212.5), 0);
    expect(p.viewMm).toMatchObject({ x: 0, y: 0 });
    // centred horizontally in the 277 mm area
    expect(p.placeMm.x).toBeCloseTo(10 + (277 - p.scaledMm.w) / 2, 1);
    expect(p.placeMm.y).toBe(10);
    expect(l.clippedItems).toEqual([]);
  });

  it('an A0 sheet fits an A4 page just as well (scale about 22 %)', () => {
    const l = layoutItems([sheetItem('A0')], setup());
    expect(l.pages).toHaveLength(1);
    expect(l.pages[0].scale).toBeGreaterThan(0.2);
    expect(l.pages[0].scale).toBeLessThan(0.25);
    expect(l.pages[0].scaledMm.w).toBeLessThanOrEqual(277.1);
    expect(l.pages[0].scaledMm.h).toBeLessThanOrEqual(190.1);
  });

  it('portrait paper changes which side limits the scale', () => {
    const l = layoutItems([sheetItem('A4')], setup({ orientation: 'portrait' }));
    // area 190 x 277: the width (300) limits it
    expect(l.pages[0].scale).toBeCloseTo(190 / 300, 9);
  });

  it('a bigger margin shrinks the fitted picture', () => {
    const a = layoutItems([sheetItem('A4')], setup({ marginMm: 10 })).pages[0].scale;
    const b = layoutItems([sheetItem('A4')], setup({ marginMm: 30 })).pages[0].scale;
    expect(b).toBeLessThan(a);
    expect(b).toBeCloseTo((210 - 60) / 212.5, 9);
  });

  it('text pages are never scaled', () => {
    const area = printableArea(setup());
    const item: PrintItem = { id: 't', widthMm: area.w, heightMm: area.h, fixed: true };
    expect(itemScale(item, setup({ scale: 50 }), area)).toBe(1);
    expect(itemScale(item, setup(), area)).toBe(1);
  });
});

describe('fixed scale', () => {
  it('100 % is the natural size: an A4 sheet is larger than the printable area and is cut off (reported)', () => {
    const l = layoutItems([sheetItem('A4')], setup({ scale: 100 }));
    expect(l.pages).toHaveLength(1);
    expect(l.pages[0].scale).toBe(1);
    expect(l.pages[0].clipped).toBe(true);
    expect(l.clippedItems).toEqual(['A4']);
  });

  it('with no margin an A4 sheet at 100 % fits an A4 page exactly', () => {
    const item: PrintItem = { id: 'frame', widthMm: 297, heightMm: 210 };
    const l = layoutItems([item], setup({ scale: 100, marginMm: 0 }));
    expect(l.pages[0].clipped).toBe(false);
    expect(l.pages[0].placeMm).toEqual({ x: 0, y: 0 });
  });

  it('50 % of an A3 sheet is its A4 size', () => {
    const l = layoutItems([sheetItem('A3')], setup({ scale: 50 }));
    expect(l.pages[0].scaledMm.w).toBeCloseTo(211.3, 1);
    expect(l.pages[0].scaledMm.h).toBeCloseTo(150, 1);
    expect(l.pages[0].clipped).toBe(false);
  });

  it('scales are limited to 5..1000 %', () => {
    const area = printableArea(setup());
    expect(itemScale({ id: 'x', widthMm: 100, heightMm: 100 }, setup({ scale: 1 }), area)).toBeCloseTo(0.05, 9);
    expect(itemScale({ id: 'x', widthMm: 100, heightMm: 100 }, setup({ scale: 5000 }), area)).toBe(10);
  });
});

describe('tiling', () => {
  it('tileCount: one tile when it fits (0.5 mm tolerance), otherwise as many as cover the length with the overlap', () => {
    expect(tileCount(277, 277)).toBe(1);
    expect(tileCount(277.4, 277)).toBe(1);
    expect(tileCount(278, 277)).toBe(2);
    // second tile starts at 277 - 8 = 269 and reaches 546
    expect(tileCount(546, 277)).toBe(2);
    expect(tileCount(547, 277)).toBe(3);
  });

  it('an A2 sheet at 50 % on A4 landscape needs 2 x 2 pages', () => {
    const l = layoutItems([sheetItem('A2')], setup({ scale: 50, tile: true }));
    expect(l.all).toHaveLength(4);
    expect(l.all.map((p) => [p.col, p.row])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(l.all.every((p) => p.cols === 2 && p.rows === 2)).toBe(true);
    expect(l.clippedItems).toEqual([]);
  });

  it('an A2 sheet at 100 % on A4 landscape needs 3 x 3 pages that overlap by 8 mm and cover the whole sheet', () => {
    const l = layoutItems([sheetItem('A2')], setup({ scale: 100, tile: true }));
    expect(l.all).toHaveLength(9);
    const area = l.area;
    const step = area.w - TILE_OVERLAP_MM;
    const xs = [...new Set(l.all.map((p) => p.viewMm.x))];
    expect(xs).toEqual([0, step, 2 * step]);
    // neighbouring tiles share exactly the overlap
    expect(xs[0] + area.w - xs[1]).toBeCloseTo(TILE_OVERLAP_MM, 5);
    // the last column reaches the right edge of the sheet
    const last = l.all.find((p) => p.col === 2 && p.row === 0)!;
    expect(last.viewMm.x + last.viewMm.w).toBeCloseTo(597.5, 1);
    const lastRow = l.all.find((p) => p.col === 0 && p.row === 2)!;
    expect(lastRow.viewMm.y + lastRow.viewMm.h).toBeCloseTo(422.5, 1);
    // tiles sit in the top-left corner of the printable area
    expect(l.all.every((p) => p.placeMm.x === area.x && p.placeMm.y === area.y)).toBe(true);
  });

  it('page numbers run over every tile of every item, in reading order', () => {
    const l = layoutItems([sheetItem('A4', 'one'), sheetItem('A2', 'two')], setup({ scale: 50, tile: true }));
    expect(l.all.map((p) => p.number)).toEqual(l.all.map((_p, i) => i + 1));
    expect(l.all.filter((p) => p.itemId === 'one')).toHaveLength(1);
    expect(l.all.filter((p) => p.itemId === 'two')).toHaveLength(4);
  });

  it('"fit" never tiles, even with tiling on', () => {
    const l = layoutItems([sheetItem('A2')], setup({ scale: 'fit', tile: true }));
    expect(l.all).toHaveLength(1);
  });

  it('tiling off: the same sheet is one cut-off page', () => {
    const l = layoutItems([sheetItem('A2')], setup({ scale: 100, tile: false }));
    expect(l.all).toHaveLength(1);
    expect(l.clippedItems).toEqual(['A2']);
  });
});

describe('page range', () => {
  it('parses lists, open ranges and single pages', () => {
    expect(parsePageRange('', 7)).toEqual({ pages: null, error: null });
    expect(parsePageRange('1-3, 5', 7).pages).toEqual([1, 2, 3, 5]);
    expect(parsePageRange('2-', 7).pages).toEqual([2, 3, 4, 5, 6, 7]);
    expect(parsePageRange('-3', 7).pages).toEqual([1, 2, 3]);
    expect(parsePageRange('7;1', 7).pages).toEqual([1, 7]);
    expect(parsePageRange('2, 2, 1-2', 7).pages).toEqual([1, 2]);
  });

  it('rejects pages outside the job, descending ranges and words', () => {
    expect(parsePageRange('8', 7).error).toBe('8');
    expect(parsePageRange('0', 7).error).toBe('0');
    expect(parsePageRange('4-2', 7).error).toBe('4-2');
    expect(parsePageRange('1-3, x', 7).error).toBe('x');
    expect(parsePageRange('-', 7).error).toBe('-');
  });

  it('the layout prints only the chosen pages, numbered as in the whole job', () => {
    const l = layoutItems([sheetItem('A2')], setup({ scale: 100, tile: true, pageRange: '2-3, 9' }));
    expect(l.all).toHaveLength(9);
    expect(l.pages.map((p) => p.number)).toEqual([2, 3, 9]);
    expect(pageCountText(l)).toEqual({ printed: 3, total: 9 });
    expect(l.rangeError).toBeNull();
  });

  it('a bad range is reported and every page stays (nothing is silently dropped)', () => {
    const l = layoutItems([sheetItem('A4')], setup({ pageRange: '5' }));
    expect(l.rangeError).toBe('5');
    expect(l.pages).toHaveLength(1);
  });
});

describe('footer', () => {
  it('says design, caption, page n / total and the tile', () => {
    const f = footerParts({ title: 'Amp', caption: 'Sheet 1', page: { number: 3, col: 1, row: 0, cols: 2, rows: 2 }, total: 9 });
    expect(f).toEqual({ left: 'Amp — Sheet 1', right: '3 / 9', tile: { col: 2, row: 1, cols: 2, rows: 2 } });
    expect(footerParts({ title: '', caption: 'x', page: { number: 1, col: 0, row: 0, cols: 1, rows: 1 }, total: 1 }).tile).toBeNull();
  });
});

describe('text pages', () => {
  it('wrapText keeps words whole and breaks very long ones', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('one\n\ntwo', 20)).toEqual(['one', '', 'two']);
  });

  it('a long table is split over pages with the header repeated and no row cut', () => {
    const area = printableArea(setup());
    const rows = Array.from({ length: 100 }, (_v, i) => [`R${i + 1}`, '1k']);
    const pages = paginateTable({ title: 'BOM', header: ['Ref', 'Value'], rows }, area);
    // one line = 4.6 + 1.4 = 6 mm; first page: 190 - 11 (title) - 6 (header) = 173 -> 28 rows; later pages 184 -> 30 rows
    expect(pages.map((p) => p.rows.length)).toEqual([28, 30, 30, 12]);
    expect(pages[0].first).toBe(true);
    expect(pages.slice(1).every((p) => !p.first)).toBe(true);
    expect(pages.flatMap((p) => p.rows).length).toBe(100);
    expect(pages[0].columnsMm.reduce((a, b) => a + b, 0)).toBeCloseTo(area.w, 0);
  });

  it('a wrapped cell makes its row taller', () => {
    const pages = paginateTable({ title: 'T', header: ['A', 'B'], rows: [['x', 'word '.repeat(60)]] }, printableArea(setup()));
    expect(pages[0].rows[0].heightMm).toBeGreaterThan(12);
  });

  it('an empty table still gives one page', () => {
    expect(paginateTable({ title: 'T', header: ['A'], rows: [] }, printableArea(setup()))).toHaveLength(1);
  });

  it('a document flows over pages and a heading never ends a page', () => {
    const area = printableArea(setup());
    const blocks = Array.from({ length: 12 }, (_v, i) => [
      { kind: 'heading' as const, text: `Section ${i + 1}` },
      { kind: 'paragraph' as const, text: 'word '.repeat(150) },
    ]).flat();
    const pages = paginateDocument(blocks, area);
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) {
      expect(p.lines.reduce((s, l) => s + l.heightMm, 0)).toBeLessThanOrEqual(area.h + 0.01);
      expect(p.lines[p.lines.length - 1].kind).not.toBe('heading');
      expect(p.lines[0].kind).not.toBe('blank');
    }
  });
});

describe('print job', () => {
  const image = (id: string, w: number, h: number): ImageContent => ({ kind: 'image', id, label: id, url: 'data:image/svg+xml,x', widthMm: w, heightMm: h });

  it('turns text contents into fixed page-sized items and pictures into natural-size items', () => {
    const s = setup();
    const job = buildJob(
      [
        image('sheet:a', 300, 212.5),
        { kind: 'table', id: 'report', label: 'BOM', table: { title: 'BOM', header: ['A'], rows: Array.from({ length: 70 }, (_v, i) => [`r${i}`]) } },
      ],
      s,
    );
    const area = printableArea(s);
    expect(job.items[0]).toEqual({ id: 'sheet:a', widthMm: 300, heightMm: 212.5 });
    const tablePages = job.items.filter((i) => i.id.startsWith('report#'));
    expect(tablePages.length).toBe(3); // 28 + 30 + 12
    expect(tablePages.every((i) => i.fixed && i.widthMm === area.w && i.heightMm === area.h)).toBe(true);
    expect(job.bodies['report#1']).toMatchObject({ kind: 'table', index: 0, count: 3 });
    // 4 pages in all, numbered 1..4
    expect(layoutItems(job.items, s).all.map((p) => p.number)).toEqual([1, 2, 3, 4]);
  });

  it('text pages follow the page setup: a smaller page paginates into more pages', () => {
    const table = { kind: 'table' as const, id: 'r', label: 'x', table: { title: 'T', header: ['A'], rows: Array.from({ length: 60 }, (_v, i) => [`row ${i}`]) } };
    const wide = buildJob([table], setup()).items.length;
    const small = buildJob([table], setup({ paper: 'Custom', customMm: { w: 150, h: 100 } })).items.length;
    expect(wide).toBe(3);
    expect(small).toBeGreaterThan(wide);
  });
});

describe('page setup in the design file', () => {
  it('defaults are left out and the keys come out in file order', () => {
    expect(setupToDesign(setup())).toEqual({ paper: 'A4', orientation: 'landscape', scale: 'fit' });
    const full = setupToDesign(setup({ paper: 'A3', orientation: 'portrait', scale: 50, tile: true, footer: true, monochrome: true, marginMm: 15, pageRange: '1-2' }), { sheets: 'active', includeInstruments: true });
    expect(Object.keys(full)).toEqual(['paper', 'orientation', 'scale', 'sheets', 'includeInstruments', 'monochrome', 'tile', 'footer', 'marginMm', 'pageRange']);
  });

  it('survives a save and reopen of the design, byte for byte', () => {
    const d = newDesign('P');
    d.printSetup = setupToDesign(setup({ paper: 'Custom', customMm: { w: 320, h: 240 }, scale: 75, tile: true, marginMm: 5, pageRange: '2-3' }), { sheets: 'all', includeChildren: true });
    const text = serializeDesign(d);
    const back = parseDesign(text);
    expect(back.printSetup).toEqual(d.printSetup);
    expect(serializeDesign(back)).toBe(text);
    expect(setupFromDesign(back.printSetup)).toEqual(setup({ paper: 'Custom', customMm: { w: 320, h: 240 }, scale: 75, tile: true, marginMm: 5, pageRange: '2-3' }));
  });

  it('an old print setup (no new fields) reads with the defaults', () => {
    expect(setupFromDesign({ paper: 'A3', scale: 'fit' })).toEqual(setup({ paper: 'A3' }));
    expect(setupFromDesign(undefined)).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('a margin outside 0..50 mm is a file error', () => {
    const d = newDesign('P');
    d.printSetup = { marginMm: 80 };
    expect(() => parseDesign(serializeDesign(d))).toThrow(/marginMm/);
  });
});

describe('which sheets a choice prints', () => {
  it('all sheets, or only the current one (the selection prints a rectangle of the current sheet)', () => {
    const d = newDesign('S');
    const second = { ...d.sheets[0], id: 'second', name: 'Second' };
    d.sheets = [d.sheets[0], second];
    expect(sheetIdsFor(d, 'second', { scope: 'all', children: false })).toEqual([d.sheets[0].id, 'second']);
    expect(sheetIdsFor(d, 'second', { scope: 'current', children: false })).toEqual(['second']);
    expect(sheetIdsFor(d, 'second', { scope: 'selection', children: false })).toEqual(['second']);
  });
});
