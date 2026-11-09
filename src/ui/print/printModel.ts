/**
 * The print job (pure): what is printed, as the preview and the printer both see it.
 *
 * The sources of a print job produce **contents**: a picture with a natural size in millimetres
 * (a schematic or ladder sheet drawn as SVG, a Grapher page), a table (a report, the instrument
 * list) or a flowing document (a lesson hand-out). {@link buildJob} paginates the text contents for
 * the printable area of the chosen paper and turns everything into layout items; the layout
 * (printLayout.ts) then places them on pages, and {@link bodyOf} says what to draw on a layout page.
 *
 *   const job = buildJob(contents, setup);          // items + the body of each item
 *   const layout = layoutItems(job.items, setup);   // pages, tiles, scale, page range
 *   bodyOf(job, layout.pages[0])                    // what goes on that page
 */
import { UNITS_PER_MM } from '../../model/paper';
import { paginateDocument, paginateTable, printableArea, type DocBlock, type DocPage, type LayoutPage, type PageSetup, type PrintItem, type PrintTable, type TablePage } from './printLayout';

/** A picture to print. The natural size is the size at 100 % in millimetres. */
export interface ImageContent {
  kind: 'image';
  id: string;
  /** what the user sees in the preview list ("Trang 1", "Đồ thị: transient") */
  label: string;
  /** image address (an object or data URL) */
  url: string;
  widthMm: number;
  heightMm: number;
  /** shown in the page footer (the sheet's name) */
  caption?: string;
}

export interface TableContent {
  kind: 'table';
  id: string;
  label: string;
  table: PrintTable;
}

export interface DocContent {
  kind: 'doc';
  id: string;
  label: string;
  title: string;
  blocks: DocBlock[];
}

export type PrintContent = ImageContent | TableContent | DocContent;

/** What an item draws. */
export type ItemBody =
  | { kind: 'image'; content: ImageContent }
  | { kind: 'table'; content: TableContent; page: TablePage; index: number; count: number }
  | { kind: 'doc'; content: DocContent; page: DocPage; index: number; count: number };

export interface PrintJob {
  items: PrintItem[];
  bodies: Record<string, ItemBody>;
  /** footer caption of each item (sheet name, report title ...) */
  captions: Record<string, string>;
}

/** Natural size in millimetres of a sheet drawing exported with `px` CSS pixels (1 unit = 1 px = 0.25 mm). */
export function unitsToMm(units: number): number {
  return Math.round((units / UNITS_PER_MM) * 10) / 10;
}

/** Turn contents into layout items; text contents are paginated for the printable area of `setup`. */
export function buildJob(contents: readonly PrintContent[], setup: PageSetup): PrintJob {
  const area = printableArea(setup);
  const items: PrintItem[] = [];
  const bodies: Record<string, ItemBody> = {};
  const captions: Record<string, string> = {};
  for (const c of contents) {
    if (c.kind === 'image') {
      items.push({ id: c.id, widthMm: c.widthMm, heightMm: c.heightMm });
      bodies[c.id] = { kind: 'image', content: c };
      captions[c.id] = c.caption ?? c.label;
      continue;
    }
    const pages = c.kind === 'table' ? paginateTable(c.table, area) : paginateDocument(c.blocks, area);
    pages.forEach((page, index) => {
      const id = `${c.id}#${index + 1}`;
      items.push({ id, widthMm: area.w, heightMm: area.h, fixed: true });
      bodies[id] = c.kind === 'table' ? { kind: 'table', content: c, page: page as TablePage, index, count: pages.length } : { kind: 'doc', content: c, page: page as DocPage, index, count: pages.length };
      captions[id] = c.label;
    });
  }
  return { items, bodies, captions };
}

export function bodyOf(job: PrintJob, page: Pick<LayoutPage, 'itemId'>): ItemBody | undefined {
  return job.bodies[page.itemId];
}

/** The footer line of a page: "<design> — <caption> — page n of m [— tile c/r]". `text` supplies the words. */
export function footerParts(opts: { title: string; caption: string; page: Pick<LayoutPage, 'number' | 'col' | 'row' | 'cols' | 'rows'>; total: number }): { left: string; right: string; tile: { col: number; row: number; cols: number; rows: number } | null } {
  const tiled = opts.page.cols * opts.page.rows > 1;
  return {
    left: [opts.title, opts.caption].filter((s) => s && s.trim()).join(' — '),
    right: `${opts.page.number} / ${opts.total}`,
    tile: tiled ? { col: opts.page.col + 1, row: opts.page.row + 1, cols: opts.page.cols, rows: opts.page.rows } : null,
  };
}
