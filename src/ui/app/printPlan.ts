/**
 * Print planning (pure): which sheets are printed, the @page rule for the chosen paper and the
 * size each sheet image gets on paper, from the design's print setup (Design.printSetup).
 *
 * Scale: 'fit' fits each sheet into the printable area (paper minus 10 mm margins); a number is
 * a percentage of the sheet's natural size (4 schematic units per millimetre, so 100 % prints an
 * A4 sheet on A4).
 */
import type { Design, PartInstance, PrintSetup } from '../../model/types';
import { allSheets } from '../../model/hierarchy';
import { paperMm, sheetFrame, UNITS_PER_MM } from '../../model/paper';
import type { PartLookup } from '../store/types';
import type { ParamDef, PartDef } from '../../library/types';

export const PRINT_MARGIN_MM = 10;

export interface PrintPage {
  sheetId: string;
  /** image size on paper (mm) */
  widthMm: number;
  heightMm: number;
}

export interface PrintPlan {
  pages: PrintPage[];
  /** CSS @page rule */
  pageCss: string;
  monochrome: boolean;
  includeInstruments: boolean;
}

/** Sheets selected by a print setup ('all' = root sheets, plus children's when includeChildren). */
export function printSheetIds(design: Design, setup: PrintSetup, activeSheetId: string): string[] {
  const sel = setup.sheets ?? 'all';
  if (sel === 'active') return [activeSheetId];
  const every = setup.includeChildren ? allSheets(design) : design.sheets;
  if (Array.isArray(sel)) return every.filter((s) => sel.includes(s.id)).map((s) => s.id);
  return every.map((s) => s.id);
}

export function planPrint(design: Design, activeSheetId: string, setup: PrintSetup = design.printSetup ?? {}): PrintPlan {
  const paper = setup.paper && setup.paper !== 'Custom' ? setup.paper : 'A4';
  const orientation = setup.orientation ?? 'landscape';
  const mm = paperMm(paper, orientation);
  const areaW = mm.w - 2 * PRINT_MARGIN_MM;
  const areaH = mm.h - 2 * PRINT_MARGIN_MM;
  const sheets = allSheets(design);
  const pages = printSheetIds(design, setup, activeSheetId).map((id) => {
    const sheet = sheets.find((s) => s.id === id)!;
    const f = sheetFrame(sheet.props);
    // the exported image includes a 5-unit margin around the frame
    const natW = (f.w + 10) / UNITS_PER_MM;
    const natH = (f.h + 10) / UNITS_PER_MM;
    let k: number;
    if (setup.scale === undefined || setup.scale === 'fit') k = Math.min(areaW / natW, areaH / natH);
    else k = setup.scale / 100;
    return { sheetId: id, widthMm: Math.round(natW * k * 10) / 10, heightMm: Math.round(natH * k * 10) / 10 };
  });
  const sizeName = paper === 'Letter' || paper === 'Legal' ? paper.toLowerCase() : paper === 'Tabloid' ? `${mm.w}mm ${mm.h}mm` : paper;
  const pageCss = paper === 'Tabloid' ? `@page { size: ${sizeName}; margin: ${PRINT_MARGIN_MM}mm; }` : `@page { size: ${sizeName} ${orientation}; margin: ${PRINT_MARGIN_MM}mm; }`;
  return { pages, pageCss, monochrome: !!setup.monochrome, includeInstruments: !!setup.includeInstruments };
}

/** Instruments placed on the root sheets with their settings (for the "instruments" print page). */
export function instrumentSummary(design: Design, lookup: PartLookup): { refdes: string; def: PartDef; values: { def: ParamDef; value: string }[] }[] {
  const out: { refdes: string; def: PartDef; values: { def: ParamDef; value: string }[] }[] = [];
  const visit = (parts: PartInstance[]) => {
    for (const p of parts) {
      const def = lookup(p.partId);
      if (!def?.instrument) continue;
      out.push({ refdes: p.refdes, def, values: def.params.map((d) => ({ def: d, value: p.params[d.key] ?? d.default })) });
    }
  };
  for (const s of design.sheets) visit(s.parts);
  return out;
}
