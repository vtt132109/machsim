/**
 * Paper sizes, sheet frames, title-block values and sheet colours (pure; used by the editor,
 * export and printing).
 *
 * Sheet coordinates use 4 schematic units per millimetre, so an A4 landscape sheet is
 * 1188 x 840 units. A sheet without `props.paper` keeps the version-1 page frame (1200 x 850).
 */
import type { Design, PaperSize, Sheet, SheetColors, SheetProps, TitleBlockFields } from './types';

export const UNITS_PER_MM = 4;

/** Landscape paper sizes in millimetres (width, height). */
export const PAPER_MM: Readonly<Record<Exclude<PaperSize, 'Custom'>, readonly [number, number]>> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  Letter: [279.4, 215.9],
  Legal: [355.6, 215.9],
  Tabloid: [431.8, 279.4],
};

export const PAPER_SIZES: PaperSize[] = ['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Legal', 'Tabloid', 'Custom'];

/** The version-1 page frame (no paper chosen). */
export const LEGACY_PAGE = { w: 1200, h: 850 } as const;

export interface SheetFrame {
  /** drawing area in schematic units (origin 0, 0) */
  w: number;
  h: number;
  border: boolean;
  titleBlock: boolean;
  grid: 'dots' | 'lines';
  /** paper the frame was derived from ('legacy' = no paper chosen) */
  paper: PaperSize | 'legacy';
  orientation: 'landscape' | 'portrait';
}

const round10 = (v: number) => Math.round(v / 10) * 10;

/** Drawing frame of a sheet from its properties. */
export function sheetFrame(props: SheetProps | undefined): SheetFrame {
  const orientation = props?.orientation ?? 'landscape';
  const base = { border: props?.border !== false, titleBlock: props?.titleBlock !== false, grid: props?.grid ?? 'dots', orientation } as const;
  const paper = props?.paper;
  if (!paper) return { ...base, w: LEGACY_PAGE.w, h: LEGACY_PAGE.h, paper: 'legacy', orientation: 'landscape' };
  let w: number;
  let h: number;
  if (paper === 'Custom') {
    w = props?.width ?? LEGACY_PAGE.w;
    h = props?.height ?? LEGACY_PAGE.h;
    return { ...base, w, h, paper };
  }
  const [mw, mh] = PAPER_MM[paper];
  w = round10(mw * UNITS_PER_MM);
  h = round10(mh * UNITS_PER_MM);
  if (orientation === 'portrait') [w, h] = [h, w];
  return { ...base, w, h, paper };
}

/** Paper size in millimetres for printing (portrait swaps width and height). */
export function paperMm(paper: Exclude<PaperSize, 'Custom'>, orientation: 'landscape' | 'portrait'): { w: number; h: number } {
  const [w, h] = PAPER_MM[paper];
  return orientation === 'portrait' ? { w: h, h: w } : { w, h };
}

/** Title-block field order (label keys are `schematic.tb.<field>`). */
export const TITLE_BLOCK_FIELDS: (keyof TitleBlockFields)[] = ['title', 'description', 'company', 'designedBy', 'checkedBy', 'approvedBy', 'documentNo', 'revision', 'date'];

export interface TitleBlockValues extends Required<TitleBlockFields> {
  sheetName: string;
  /** 1-based sheet number within its design level and the number of sheets there */
  sheetNumber: number;
  sheetCount: number;
}

/**
 * Values shown in the title block of a sheet: the design's fields, the design title when no
 * title is set, today's date (`now`, formatted for `locale`) when the date field is empty, and the
 * sheet's number among `levelSheets` ("sheet n of m").
 */
export function titleBlockValues(design: Pick<Design, 'title' | 'titleBlock' | 'description'>, sheet: Sheet, levelSheets: Sheet[], now: Date, locale: string): TitleBlockValues {
  const f = design.titleBlock ?? {};
  const index = levelSheets.findIndex((s) => s.id === sheet.id);
  let date = f.date?.trim() ?? '';
  if (!date) {
    try {
      date = now.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      date = now.toISOString().slice(0, 10);
    }
  }
  return {
    title: f.title?.trim() || design.title,
    description: f.description ?? '',
    company: f.company ?? '',
    designedBy: f.designedBy ?? '',
    checkedBy: f.checkedBy ?? '',
    approvedBy: f.approvedBy ?? '',
    documentNo: f.documentNo ?? '',
    revision: f.revision ?? '',
    date,
    sheetName: sheet.name,
    sheetNumber: index >= 0 ? index + 1 : 1,
    sheetCount: Math.max(1, levelSheets.length),
  };
}

/** Colours of the predefined schemes ('default' follows the UI theme: no overrides). */
const SCHEMES: Record<'white' | 'black', Required<Omit<SheetColors, 'scheme'>>> = {
  white: { background: '#ffffff', wire: '#1a3fb0', component: '#1d2330', text: '#1d2330', bus: '#0b2e8a' },
  black: { background: '#05080c', wire: '#3fdc6b', component: '#f2f4f8', text: '#f2f4f8', bus: '#7cf29c' },
};

/**
 * CSS custom properties for a sheet's colour scheme (applied on the scene / canvas element;
 * see sceneStyle.ts for the variables the scene uses). Empty for the default scheme.
 */
export function sheetColorVars(colors: SheetColors | undefined): Record<string, string> {
  if (!colors || colors.scheme === 'default') return {};
  const c = colors.scheme === 'custom' ? colors : { ...SCHEMES[colors.scheme], ...colors };
  const out: Record<string, string> = {};
  if (c.background) out['--canvas'] = c.background;
  if (c.wire) {
    out['--wire'] = c.wire;
    out['--junction'] = c.wire;
  }
  if (c.component) out['--part'] = c.component;
  if (c.text) {
    out['--label'] = c.text;
    out['--note-text'] = c.text;
    out['--text'] = c.text;
  }
  if (c.bus) out['--bus'] = c.bus;
  return out;
}
