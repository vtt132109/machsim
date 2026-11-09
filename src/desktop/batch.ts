/**
 * Batch runs of the desktop command line (MachSim.exe --batch …): read a design or a SPICE deck,
 * run the requested analysis and write the results. The file system and the simulator come in
 * through `BatchIO`, so the same code runs in the desktop renderer (src/desktop/batchRenderer.ts,
 * IPC to the main process) and in tests (in-memory files, src/sim runAnalyses).
 *
 *   const r = await runBatch(options, io);    // { code, results }  (code: EXIT.*)
 *   resultsToCsv / resultsToJson / resultsToText   the three result formats
 *
 * Designs: --set changes design variables; ERC errors stop the run (exit 1); the analysis is
 * --analysis or the design's active one, with the design's saved settings (or the defaults the
 * analysis dialog would offer). SPICE decks: PSpice-only cards are skipped, .include / .lib files
 * are read next to the deck, every analysis card runs (or only those of --analysis). The deck's
 * (or the design's custom SPICE) `.meas` values are logged and written with the results (a
 * "… — .meas" table in CSV / text, `measurements` in JSON).
 */
import type { AnalysisResult } from '../sim/results';
import type { AnalysisSpec, Netlist } from '../sim/netlist';
import { writeSpice } from '../sim/spice';
import { parseDesignSafely } from '../model/sanitize';
import { buildNetlist } from '../model/netlister';
import { applySteps } from '../model/steps';
import { ensureDesignParts } from '../model/libraryLoad';
import { pspiceCompat } from '../model/spiceSchematic';
import { resolveDeckIncludes } from '../model/spiceIncludes';
import { tablesToCsv, type ReportTableData } from '../model/reportFormat';
import { tracesToText, type TextTrace } from '../util/measurementText';
import { defaultSpec } from '../ui/analysis/specs';
import { specContext } from '../ui/integration/circuitInfo';
import { ct } from '../i18n/cliText';
import { EXIT, formatOf, type CliOptions } from './cli';

export interface BatchIO {
  /** read a file named on the command line (throws when it cannot) */
  readFile(path: string): Promise<string>;
  /** write a file named on the command line (throws when it cannot) */
  writeFile(path: string, text: string): Promise<void>;
  /** read an .include / .lib file next to the input (null when absent) */
  readInclude(path: string): Promise<string | null>;
  run(netlist: Netlist): AnalysisResult[] | Promise<AnalysisResult[]>;
  log(line: string, level: 'info' | 'error'): void;
  now?(): Date;
}

export interface BatchResult {
  code: number;
  results: AnalysisResult[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------------------------
// result formats

function points(r: AnalysisResult): number {
  return r.scale?.re.length ?? (r.vectors.length ? 1 : 0);
}

/** The `.meas` values of a result as a table (name, value, x position, why it failed). */
export function measurementTable(r: AnalysisResult, title: string): ReportTableData | undefined {
  if (!r.measurements?.length) return undefined;
  return {
    title: `${title} — .meas`,
    columns: ['name', 'value', 'at', 'error'],
    rows: r.measurements.map((m) => [m.name, Number.isFinite(m.value) ? m.value : '', m.at ?? '', m.error ?? '']),
  };
}

/** Every `.meas` value of the results (also inside families), labelled with its run. */
export function measurementLines(results: AnalysisResult[]): { label: string; name: string; value: number; error?: string }[] {
  const out: { label: string; name: string; value: number; error?: string }[] = [];
  const visit = (r: AnalysisResult, label: string) => {
    for (const m of r.measurements ?? []) out.push({ label, name: m.name, value: m.value, ...(m.error ? { error: m.error } : {}) });
    for (const run of r.runs ?? []) visit(run.result, label ? `${label} — ${run.label}` : run.label);
  };
  for (const r of results) visit(r, '');
  return out;
}

/** Result tables (one per result, one per run of a family, plus their .meas values). */
export function resultTables(results: AnalysisResult[]): ReportTableData[] {
  const out: ReportTableData[] = [];
  const visit = (r: AnalysisResult, title: string) => {
    const meas = measurementTable(r, title);
    if (meas) out.push(meas);
    if (r.runs?.length) {
      for (const run of r.runs) visit(run.result, `${title} — ${run.label}`);
      return;
    }
    if (r.error) {
      out.push({ title, columns: ['error'], rows: [[r.error]] });
      return;
    }
    if (r.scale && r.scale.re.length) {
      const cols = [r.scale.name];
      const getters: ((i: number) => number)[] = [(i) => r.scale!.re[i]];
      for (const v of r.vectors) {
        if (v === r.scale) continue;
        if (v.im) {
          cols.push(`mag(${v.name})`, `ph(${v.name})`);
          getters.push(
            (i) => Math.hypot(v.re[i], v.im![i]),
            (i) => (Math.atan2(v.im![i], v.re[i]) * 180) / Math.PI,
          );
        } else {
          cols.push(v.name);
          getters.push((i) => v.re[i]);
        }
      }
      const rows: (string | number)[][] = [];
      for (let i = 0; i < r.scale.re.length; i++) rows.push(getters.map((g) => g(i)));
      out.push({ title, columns: cols, rows });
      return;
    }
    if (r.table) {
      out.push({ title, columns: r.table.columns, rows: r.table.rows });
      return;
    }
    const rows: (string | number)[][] = r.vectors.map((v) => [v.name, v.re[v.re.length - 1], v.unit]);
    for (const [k, v] of Object.entries(r.scalars ?? {})) if (!r.vectors.some((x) => x.name === k)) rows.push([k, v, '']);
    out.push({ title, columns: ['name', 'value', 'unit'], rows });
  };
  for (const r of results) visit(r, r.title);
  return out;
}

export function resultsToCsv(results: AnalysisResult[]): string {
  return tablesToCsv(resultTables(results));
}

function vectorJson(v: { name: string; unit: string; re: Float64Array; im?: Float64Array; digital?: boolean }) {
  return { name: v.name, unit: v.unit, values: Array.from(v.re), ...(v.im ? { imag: Array.from(v.im) } : {}), ...(v.digital ? { digital: true } : {}) };
}

function resultJson(r: AnalysisResult): unknown {
  return {
    type: r.type,
    title: r.title,
    ...(r.error ? { error: r.error } : {}),
    ...(r.scale ? { scale: vectorJson(r.scale) } : {}),
    vectors: r.vectors.filter((v) => v !== r.scale).map(vectorJson),
    ...(r.scalars ? { scalars: r.scalars } : {}),
    ...(r.table ? { table: r.table } : {}),
    ...(r.measurements ? { measurements: r.measurements.map((m) => ({ ...m, value: Number.isFinite(m.value) ? m.value : null })) } : {}),
    ...(r.runs ? { runs: r.runs.map((x) => ({ label: x.label, result: resultJson(x.result) })) } : {}),
    warnings: r.warnings,
  };
}

export function resultsToJson(results: AnalysisResult[], meta: { source: string; date: Date }): string {
  return `${JSON.stringify({ format: 'machsim-results', version: 1, source: meta.source, date: meta.date.toISOString(), analyses: results.map(resultJson) }, null, 1)}\n`;
}

/** MachSim measurement text, one document per result with a scale (others as name / value lines). */
export function resultsToText(results: AnalysisResult[], date: Date): string {
  const docs: string[] = [];
  for (const r of results) {
    const flat = r.runs?.length ? r.runs.map((x) => ({ r: x.result, title: `${r.title} — ${x.label}` })) : [{ r, title: r.title }];
    for (const { r: x, title } of flat) {
      if (x.scale && x.scale.re.length) {
        const scale = x.scale.re;
        const traces: TextTrace[] = x.vectors
          .filter((v) => v !== x.scale)
          .map((v): TextTrace => (v.im ? { label: `mag(${v.name})`, unit: v.unit, x: scale, y: Array.from(v.re, (re, i) => Math.hypot(re, v.im![i])) } : { label: v.name, unit: v.unit, x: scale, y: v.re }));
        docs.push(tracesToText(traces, { title, xLabel: x.scale.name, xUnit: x.scale.unit, date }));
        const meas = measurementTable(x, title);
        if (meas) docs.push(tablesToCsv([meas]).replace(/,/g, '\t'));
      } else docs.push(tablesToCsv(resultTables([x])).replace(/,/g, '\t'));
    }
  }
  return docs.join('\r\n');
}

// ---------------------------------------------------------------------------------------------
// the run

const SPICE_RE = /\.(cir|sp|spi|spice|net|ckt|txt|lib)$/i;

function withTimes(spec: AnalysisSpec, o: CliOptions): AnalysisSpec {
  if (spec.type !== 'tran' || (!o.tstop && !o.tstep)) return spec;
  const tstop = o.tstop ?? spec.tstop;
  return { ...spec, tstop, tstep: o.tstep ?? Math.min(spec.tstep, tstop / 10) };
}

export async function runBatch(o: CliOptions, io: BatchIO): Promise<BatchResult> {
  const info = (s: string) => {
    if (!o.quiet) io.log(s, 'info');
  };
  const fail = (s: string) => io.log(s, 'error');
  const now = io.now?.() ?? new Date();
  info(ct('log.reading', { file: o.input }));
  let text: string;
  try {
    text = await io.readFile(o.input);
  } catch (e) {
    fail(ct('log.readFailed', { file: o.input, message: message(e) }));
    return { code: EXIT.file, results: [] };
  }

  let netlist: Netlist;
  const isDesign = !SPICE_RE.test(o.input) && text.trimStart().startsWith('{');
  if (isDesign) {
    let design;
    try {
      design = parseDesignSafely(text).design;
    } catch (e) {
      fail(ct('log.badDesign', { message: message(e) }));
      return { code: EXIT.file, results: [] };
    }
    for (const [name, value] of Object.entries(o.set)) {
      if (!Object.keys(design.variables).some((k) => k.toLowerCase() === name.toLowerCase())) info(ct('log.unknownVariable', { name }));
      const key = Object.keys(design.variables).find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
      design.variables = { ...design.variables, [key]: value };
    }
    // parts of catalogue packs (loaded on demand) must be known before the netlist is built
    await ensureDesignParts(design);
    const build = buildNetlist(design, { includeAnalysis: false });
    const errors = build.erc.filter((m) => m.severity === 'error');
    info(ct('log.erc', { errors: errors.length, warnings: build.erc.length - errors.length }));
    for (const m of build.erc) (m.severity === 'error' ? fail : info)(ct('log.ercLine', { severity: ct(`severity.${m.severity}`), message: m.message }));
    if (o.erc) {
      if (o.out) {
        const csv = tablesToCsv([{ title: '', columns: ['severity', 'code', 'message', 'refdes', 'net'], rows: build.erc.map((m) => [m.severity, m.code, m.message, m.refdes ?? '', m.net ?? '']) }]);
        try {
          await io.writeFile(o.out, csv);
          info(ct('log.wrote', { file: o.out }));
        } catch (e) {
          fail(ct('log.writeFailed', { file: o.out, message: message(e) }));
          return { code: EXIT.file, results: [] };
        }
      }
      return { code: errors.length ? EXIT.failed : EXIT.ok, results: [] };
    }
    if (errors.length) return { code: EXIT.failed, results: [] };
    const type = o.analysis ?? design.analysis.active;
    let spec = design.analysis.specs[type];
    if (!spec) {
      info(ct('log.noAnalysis', { type }));
      spec = defaultSpec(type, specContext(build));
    }
    // .step cards in the circuit's SPICE text and sweeps of a design variable (src/model/steps.ts)
    const stepped = applySteps(design, withTimes(spec, o), (n) => ({ ...n, analyses: [] }));
    for (const m of stepped.notes) info(m.text);
    if (stepped.errors.length) {
      for (const m of stepped.errors) fail(m.text);
      return { code: EXIT.failed, results: [] };
    }
    netlist = { ...build.netlist, analyses: [stepped.spec] };
  } else {
    const compat = pspiceCompat(text);
    const resolved = await resolveDeckIncludes(compat.text, io.readInclude, { fileName: o.input });
    if (resolved.missing.length) fail(ct('log.missingInclude', { list: resolved.missing.join(', ') }));
    for (const w of resolved.result.warnings) info(ct('log.spiceWarning', { file: o.input, message: w }));
    if (resolved.result.errors.length) {
      for (const e of resolved.result.errors) fail(ct('log.spiceError', { file: o.input, line: e.line, message: e.message }));
      return { code: EXIT.failed, results: [] };
    }
    netlist = resolved.result.netlist;
    for (const [name, value] of Object.entries(o.set)) netlist = { ...netlist, params: { ...netlist.params, [name]: value } };
    let analyses = netlist.analyses.length ? netlist.analyses : [{ type: 'op' } as AnalysisSpec];
    if (o.analysis) {
      analyses = analyses.filter((a) => a.type === o.analysis);
      if (!analyses.length) {
        fail(ct('log.noDeckAnalysis', { type: o.analysis }));
        return { code: EXIT.failed, results: [] };
      }
    }
    netlist = { ...netlist, analyses: analyses.map((a) => withTimes(a, o)) };
  }

  if (o.netlist) {
    try {
      await io.writeFile(o.netlist, writeSpice(netlist));
      info(ct('log.wrote', { file: o.netlist }));
    } catch (e) {
      fail(ct('log.writeFailed', { file: o.netlist, message: message(e) }));
      return { code: EXIT.file, results: [] };
    }
  }

  info(ct('log.running', { analyses: netlist.analyses.map((a) => a.type).join(', ') }));
  let results: AnalysisResult[];
  try {
    results = await io.run(netlist);
  } catch (e) {
    fail(ct('log.resultError', { title: netlist.title, message: message(e) }));
    return { code: EXIT.failed, results: [] };
  }
  for (const r of results) {
    if (r.error) fail(ct('log.resultError', { title: r.title, message: r.error }));
    else info(ct('log.result', { title: r.title, points: points(r), vectors: r.vectors.length, ms: Math.round(r.elapsedMs ?? 0) }));
  }
  for (const m of measurementLines(results)) {
    const who = m.label ? `${m.label}: ${m.name}` : m.name;
    if (m.error) info(ct('log.measureFailed', { name: who, message: m.error }));
    else info(ct('log.measure', { name: who, value: m.value }));
  }

  if (o.out) {
    const format = o.format ?? formatOf(o.out) ?? 'csv';
    const out = format === 'json' ? resultsToJson(results, { source: o.input, date: now }) : format === 'text' ? resultsToText(results, now) : resultsToCsv(results);
    try {
      await io.writeFile(o.out, out);
      info(ct('log.wrote', { file: o.out }));
    } catch (e) {
      fail(ct('log.writeFailed', { file: o.out, message: message(e) }));
      return { code: EXIT.file, results };
    }
  }
  return { code: results.some((r) => r.error) ? EXIT.failed : EXIT.ok, results };
}
