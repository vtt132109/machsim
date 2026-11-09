/**
 * ERC marker scopes and the ERC report file (pure).
 *
 * Scopes (Tools › Delete ERC markers): a learner who fixed the ground of sheet 2 wants the markers
 * of that sheet gone without losing the rest of the list.
 *
 *   'all'        every marker
 *   'sheet'      the markers of one sheet (and the ones with no location)
 *   'errors'     the errors only
 *   'warnings'   the warnings only
 *   'selection'  the markers that sit on one of the selected parts
 *
 *   keepMarkers(markers, scope, opts)   the markers that stay (what "delete" leaves behind)
 *   deleteMarkers(markers, scope, opts) the markers the scope removes
 *   ercSummary(markers)                 counts for the dock bar and the report header
 *   ercReportTable(markers, texts)      the report as one table (CSV / HTML through reportFormat.ts)
 *   ercReportText(markers, texts, meta) a plain-text report ("ERC report — 2 errors, 1 warning")
 *
 * The explanation texts come from the UI (src/i18n/erc.ts explainErc), so this module stays free of
 * i18n: callers pass a `MarkerText` per marker.
 */
import type { ErcMessage } from './types';
import type { ReportTableData } from './reportFormat';

export type ErcScope = 'all' | 'sheet' | 'errors' | 'warnings' | 'selection';

export const ERC_SCOPES: ErcScope[] = ['all', 'sheet', 'errors', 'warnings', 'selection'];

export interface ScopeOptions {
  /** scope 'sheet': the sheet whose markers are meant */
  sheetId?: string;
  /** scope 'selection': reference designators of the selected parts */
  refdes?: readonly string[];
}

/** True when `scope` covers this marker (and it would be deleted). */
export function markerInScope(m: ErcMessage, scope: ErcScope, opts: ScopeOptions = {}): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'errors':
      return m.severity === 'error';
    case 'warnings':
      return m.severity === 'warning';
    case 'sheet':
      // markers without a location belong to the whole design: they go with any sheet
      return m.sheetId === undefined || m.sheetId === opts.sheetId;
    case 'selection': {
      if (!m.refdes) return false;
      const want = (opts.refdes ?? []).map((r) => r.trim().toUpperCase());
      return want.includes(m.refdes.trim().toUpperCase());
    }
  }
}

/** The markers a "delete in this scope" command removes. */
export function deleteMarkers(markers: readonly ErcMessage[], scope: ErcScope, opts: ScopeOptions = {}): ErcMessage[] {
  return markers.filter((m) => markerInScope(m, scope, opts));
}

/** The markers that stay after a "delete in this scope" command. */
export function keepMarkers(markers: readonly ErcMessage[], scope: ErcScope, opts: ScopeOptions = {}): ErcMessage[] {
  return markers.filter((m) => !markerInScope(m, scope, opts));
}

export interface ErcSummary {
  errors: number;
  warnings: number;
  total: number;
  /** findings per rule code, most frequent first */
  byRule: { code: ErcMessage['code']; count: number }[];
}

export function ercSummary(markers: readonly ErcMessage[]): ErcSummary {
  const byRule = new Map<ErcMessage['code'], number>();
  let errors = 0;
  for (const m of markers) {
    if (m.severity === 'error') errors += 1;
    byRule.set(m.code, (byRule.get(m.code) ?? 0) + 1);
  }
  return {
    errors,
    warnings: markers.length - errors,
    total: markers.length,
    byRule: [...byRule.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };
}

/** The localized words a report row needs (the UI supplies them). */
export interface MarkerText {
  severity: string;
  rule: string;
  title: string;
  why: string;
  fix: string;
  /** sheet name, '' when the marker has no sheet */
  sheet: string;
}

export interface ErcReportTexts {
  /** table title */
  title: string;
  columns: {
    severity: string;
    rule: string;
    sheet: string;
    refdes: string;
    pin: string;
    net: string;
    position: string;
    problem: string;
    why: string;
    fix: string;
  };
  /** one marker's localized words */
  of(m: ErcMessage): MarkerText;
  /** "{errors} error(s), {warnings} warning(s)" */
  caption: string;
  /** text shown instead of a table when nothing was found */
  clean: string;
}

const pos = (m: ErcMessage): string => (m.x === undefined || m.y === undefined ? '' : `${Math.round(m.x)}, ${Math.round(m.y)}`);

/** The ERC findings as one report table (columns in reading order). */
export function ercReportTable(markers: readonly ErcMessage[], texts: ErcReportTexts): ReportTableData {
  const c = texts.columns;
  return {
    title: texts.title,
    caption: texts.caption,
    columns: [c.severity, c.rule, c.sheet, c.refdes, c.pin, c.net, c.position, c.problem, c.why, c.fix],
    rows: markers.map((m) => {
      const t = texts.of(m);
      return [t.severity, t.rule, t.sheet, m.refdes ?? '', m.pin ?? '', m.net ?? '', pos(m), t.title, t.why, t.fix];
    }),
  };
}

export interface ErcReportMeta {
  /** design title */
  design: string;
  /** file name, '' when the design was never saved */
  file?: string;
  /** ISO date / time text */
  date?: string;
  /** program name and version */
  tool?: string;
}

/**
 * A plain-text ERC report: a header, the summary line, then one block per finding (what is wrong,
 * why, how to fix it) — the form a learner can paste into a lab report.
 */
export function ercReportText(markers: readonly ErcMessage[], texts: ErcReportTexts, meta: ErcReportMeta): string {
  const lines: string[] = [texts.title, '='.repeat(texts.title.length), meta.design];
  if (meta.file) lines.push(meta.file);
  if (meta.date) lines.push(meta.date);
  if (meta.tool) lines.push(meta.tool);
  lines.push('', texts.caption, '');
  if (!markers.length) {
    lines.push(texts.clean, '');
    return lines.join('\r\n');
  }
  const c = texts.columns;
  markers.forEach((m, i) => {
    const t = texts.of(m);
    lines.push(`${i + 1}. [${t.severity}] ${t.rule}: ${t.title}`);
    const where: string[] = [];
    if (t.sheet) where.push(`${c.sheet}: ${t.sheet}`);
    if (m.refdes) where.push(`${c.refdes}: ${m.refdes}`);
    if (m.pin) where.push(`${c.pin}: ${m.pin}`);
    if (m.net) where.push(`${c.net}: ${m.net}`);
    const p = pos(m);
    if (p) where.push(`${c.position}: ${p}`);
    if (where.length) lines.push(`   ${where.join(' | ')}`);
    lines.push(`   ${c.why}: ${t.why}`);
    lines.push(`   ${c.fix}: ${t.fix}`);
    lines.push(`   (${m.message})`);
    lines.push('');
  });
  return lines.join('\r\n');
}
