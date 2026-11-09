/**
 * Sources of a print job: they turn what the learner chose in the print preview into
 * {@link PrintContent}s.
 *
 *  - **sheets**: every schematic and ladder sheet in scope (all, the current one, or the selection
 *    on the current sheet), drawn with the same exporter as File > Export image, so the layers the
 *    learner hid stay hidden on paper;
 *  - **instruments**: the settings of every instrument placed in the design;
 *  - **grapher**: pages registered by the Grapher window through {@link registerPrintContribution};
 *  - **report**: a report table of Reports (bill of materials, statistics ...);
 *  - **lesson**: the hand-out of a guided lesson (goal, theory, tasks, quiz).
 *
 * The exporter and react-dom/server are loaded on first use, so this module stays small.
 */
import type { Design } from '../../model/types';
import { allSheets } from '../../model/hierarchy';
import { instrumentSummary, printSheetIds } from '../app/printPlan';
import { paramLabel, partName } from '../../i18n/library';
import { partLookup } from '../store';
import { itemsBounds } from '../store/designOps';
import type { SelItem } from '../store/types';
import { createStore } from '../store/createStore';
import { pt } from '../../i18n/printText';
import { unitsToMm, type DocContent, type ImageContent, type PrintContent, type TableContent } from './printModel';
import type { DocBlock } from './printLayout';

/** Which sheets to print. */
export type SheetScope = 'all' | 'current' | 'selection';

export interface PrintChoices {
  sheets: boolean;
  scope: SheetScope;
  /** also the sheets of subcircuits and hierarchical blocks (scope 'all') */
  children: boolean;
  /** draw the sheet's frame and title block (off = the drawing only) */
  frame: boolean;
  instruments: boolean;
  grapher: boolean;
  /** report id, '' = none */
  report: string;
  /** lesson id, '' = none */
  lesson: string;
}

export const DEFAULT_CHOICES: PrintChoices = { sheets: true, scope: 'all', children: false, frame: true, instruments: false, grapher: false, report: '', lesson: '' };

/** What a source needs to know about the document. */
export interface PrintContext {
  design: Design;
  activeSheetId: string;
  selection: readonly SelItem[];
  probeValues?: Record<string, string>;
  monochrome: boolean;
}

// ---------------------------------------------------------------------------
// contributions from other windows (the Grapher)
// ---------------------------------------------------------------------------

/** A window that can hand pages to the print preview. */
export interface PrintContribution {
  id: string;
  /** whether there is anything to print right now */
  available: () => boolean;
  /** the pages, as pictures of the given colour mode */
  pages: (opts: { monochrome: boolean }) => Promise<ImageContent[]>;
}

const contributions = createStore<readonly PrintContribution[]>([]);

/** The Grapher (and any later window) registers what it can print; returns the unregister function. */
export function registerPrintContribution(c: PrintContribution): () => void {
  contributions.setState((list) => [...list.filter((x) => x.id !== c.id), c]);
  return () => contributions.setState((list) => list.filter((x) => x !== c));
}

export const printContributions = contributions;

// ---------------------------------------------------------------------------
// sheets
// ---------------------------------------------------------------------------

/** Ids of the sheets a choice prints, in order (the selection scope prints a rectangle of the current sheet instead). */
export function sheetIdsFor(design: Design, activeSheetId: string, choices: Pick<PrintChoices, 'scope' | 'children'>): string[] {
  if (choices.scope === 'current' || choices.scope === 'selection') return [activeSheetId];
  return printSheetIds(design, { sheets: 'all', includeChildren: choices.children }, activeSheetId);
}

async function sheetImages(ctx: PrintContext, choices: PrintChoices): Promise<ImageContent[]> {
  const { sheetToSvg } = await import('../editor/exportImage');
  const out: ImageContent[] = [];
  const sheets = allSheets(ctx.design);
  const bySelection = choices.scope === 'selection' && ctx.selection.length > 0;
  for (const id of sheetIdsFor(ctx.design, ctx.activeSheetId, choices)) {
    const sheet = sheets.find((s) => s.id === id);
    if (!sheet) continue;
    let svg: ReturnType<typeof sheetToSvg>;
    let label = sheet.name;
    if (bySelection && id === ctx.activeSheetId) {
      const b = itemsBounds(sheet, ctx.selection, partLookup);
      if (!b) continue;
      const pad = 20;
      svg = sheetToSvg(ctx.design, id, partLookup, { rect: { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, probeValues: ctx.probeValues, monochrome: ctx.monochrome });
      label = pt('selectionOf', { sheet: sheet.name });
    } else {
      svg = sheetToSvg(ctx.design, id, partLookup, { area: choices.frame ? 'page' : 'content', probeValues: ctx.probeValues, monochrome: ctx.monochrome });
    }
    out.push({
      kind: 'image',
      id: `sheet:${id}${bySelection ? ':sel' : ''}`,
      label,
      caption: label,
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.svg)}`,
      widthMm: unitsToMm(svg.width),
      heightMm: unitsToMm(svg.height),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// instruments, reports, lessons
// ---------------------------------------------------------------------------

function instrumentTable(ctx: PrintContext): TableContent {
  const rows: string[][] = [];
  for (const it of instrumentSummary(ctx.design, partLookup)) {
    it.values.forEach((v, i) => rows.push([i === 0 ? `${it.refdes} — ${partName(it.def)}` : '', paramLabel(v.def), `${v.value}${v.def.unit ? ` ${v.def.unit}` : ''}`]));
  }
  if (!rows.length) rows.push([pt('noInstruments'), '', '']);
  return {
    kind: 'table',
    id: 'instruments',
    label: pt('instruments'),
    table: { title: pt('instrumentsTitle', { title: ctx.design.title }), header: [pt('colInstrument'), pt('colSetting'), pt('colValue')], rows, weights: [3, 3, 2] },
  };
}

async function reportTable(ctx: PrintContext, id: string): Promise<TableContent[]> {
  const m = await import('../reports/reportTables');
  if (!(m.REPORT_IDS as readonly string[]).includes(id)) return [];
  const rid = id as import('../reports/reportTables').ReportId;
  return m.reportTables(rid, ctx.design).map((t, i) => ({
    kind: 'table',
    id: `report:${id}:${i}`,
    label: m.reportTitle(rid),
    table: { title: t.title || m.reportTitle(rid), ...(t.caption ? { subtitle: t.caption } : {}), header: t.columns, rows: t.rows.map((r) => r.map(String)) },
  }));
}

async function lessonDoc(id: string): Promise<DocContent | null> {
  const l = await import('../../learn/lessons');
  const text = l.lessonTextOf(id);
  if (!text) return null;
  const { parseRichText, richTextPlain } = await import('../../model/richText');
  const { tr } = await import('../../i18n');
  const blocks: DocBlock[] = [{ kind: 'heading', text: pt('lessonGoal') }, { kind: 'paragraph', text: tr(text.goal) }];
  const theory = richTextPlain(parseRichText(tr(text.theory)));
  if (theory.trim()) blocks.push({ kind: 'heading', text: pt('lessonTheory') }, { kind: 'paragraph', text: theory });
  const lesson = l.getLesson(id);
  const steps = (lesson?.steps ?? []).map((s) => text.steps[s.id]).filter(Boolean);
  if (steps.length) blocks.push({ kind: 'heading', text: pt('lessonTasks') }, { kind: 'bullets', items: steps.map((s, i) => `${i + 1}. ${tr(s.task)}`) });
  const quiz = Object.values(text.quiz);
  if (quiz.length) {
    blocks.push({ kind: 'heading', text: pt('lessonQuiz') });
    quiz.forEach((q, i) => {
      blocks.push({ kind: 'paragraph', text: `${i + 1}. ${tr(q.q)}` }, { kind: 'bullets', items: q.options.map((o, k) => `${String.fromCharCode(65 + k)}. ${tr(o)}`) });
    });
  }
  return { kind: 'doc', id: `lesson:${id}`, label: tr(text.title), title: tr(text.title), blocks };
}

/** Lessons offered by the preview: id and title. */
export async function lessonChoices(): Promise<{ id: string; title: string }[]> {
  const l = await import('../../learn/lessons');
  const { tr } = await import('../../i18n');
  return l.allLessons().map((x) => ({ id: x.id, title: tr(l.lessonTextOf(x.id)?.title ?? { vi: x.id, en: x.id }) }));
}

/** Reports offered by the preview: id and title. */
export async function reportChoices(): Promise<{ id: string; title: string }[]> {
  const m = await import('../reports/reportTables');
  return m.REPORT_IDS.map((id) => ({ id, title: m.reportTitle(id) }));
}

/** Everything the choices ask for, in print order. */
export async function buildContents(ctx: PrintContext, choices: PrintChoices): Promise<PrintContent[]> {
  const out: PrintContent[] = [];
  if (choices.sheets) out.push(...(await sheetImages(ctx, choices)));
  if (choices.instruments) out.push(instrumentTable(ctx));
  if (choices.grapher) {
    for (const c of contributions.getState()) if (c.available()) out.push(...(await c.pages({ monochrome: ctx.monochrome })));
  }
  if (choices.report) out.push(...(await reportTable(ctx, choices.report)));
  if (choices.lesson) {
    const doc = await lessonDoc(choices.lesson);
    if (doc) out.push(doc);
  }
  return out;
}
