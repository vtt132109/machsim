/**
 * Grapher workspace model (pure): pages built from the history of simulation runs, page / axis /
 * trace properties, overlays of traces from earlier runs, "add traces from the latest simulation",
 * postprocessor references across runs and analyses, and the documented text export.
 *
 * A run (results/runs.ts RunRecord) becomes one page per Grapher tab (buildTabs: batch and
 * user-defined results give one page per analysis). Pages keep their properties while new runs
 * arrive; the oldest runs (beyond MAX_RUN_HISTORY) are dropped together with their pages and with
 * overlays that referred to them.
 *
 * Page key: the analysis type plus the run number, e.g. "tran3" — used in postprocessor
 * expressions as `tran3.V(out)`; a run with several pages of one type numbers them "tran3", "tran3b"…
 *
 * Overlays: a page shows its own result plus traces of other runs. The page result handed to the
 * Grapher is a family whose first run is the page's own result and whose further runs carry the
 * overlaid vectors with their own x samples, labelled by the run they come from.
 */
import type { AnalysisResult, Vector } from '../../sim/results';
import { buildTabs, interpolateAt, type GraphTab } from './plotModel';
import { evaluateExpression, PostprocessorError } from './postprocessor';
import type { RunRecord } from './runs';
import type { SavedPage } from '../../model/types';
import { MAX_RUN_HISTORY } from './runs';
import { isInternalVector } from './titles';
import { t } from '../../i18n';

export interface AxisProps {
  /** axis title override */
  label?: string;
  /** manual range (both ends needed); absent = autoscale */
  min?: number;
  max?: number;
  log?: boolean;
}

export interface PageProps {
  title?: string;
  grid?: boolean;
  background?: 'dark' | 'light';
  x?: AxisProps;
  /** first analog pane's y axis */
  y?: AxisProps;
  /** postprocessor expressions added to the page (`vs(V(L1.b), V(L1.h))`, `V(out)*2` …): saved with the page and evaluated again on opening */
  exprs?: string[];
}

export interface TraceStyle {
  label?: string;
  /** colour slot 0..7 */
  color?: number;
  /** line width, CSS px */
  width?: number;
  hidden?: boolean;
}

export interface TraceRef {
  runId: number;
  /** tab index within the run (buildTabs order) */
  tab: number;
  vector: string;
}

export interface GraphPage {
  id: string;
  runId: number;
  tab: number;
  /** postprocessor key, e.g. "tran3" */
  key: string;
  overlays: TraceRef[];
  props: PageProps;
  /** legend key -> style */
  traces: Record<string, TraceStyle>;
}

export interface GrapherDoc {
  runs: RunRecord[];
  pages: GraphPage[];
  active: string | null;
  nextPage: number;
}

export function emptyDoc(): GrapherDoc {
  return { runs: [], pages: [], active: null, nextPage: 1 };
}

const runTabsCache = new WeakMap<RunRecord, GraphTab[]>();

/** Tabs of a run, with the run's Output-tab expressions evaluated into every result (cached). */
export function runTabs(run: RunRecord): GraphTab[] {
  let tabs = runTabsCache.get(run);
  if (!tabs) {
    tabs = buildTabs([...run.results]).map((tab) => ({ ...tab, result: withExpressions(tab.result, run.expressions ?? []) }));
    runTabsCache.set(run, tabs);
  }
  return tabs;
}

/** A result with the expressions added as vectors (expressions that fail on it are skipped). */
export function withExpressions(result: AnalysisResult, exprs: readonly string[]): AnalysisResult {
  if (!exprs.length) return result;
  const apply = (r: AnalysisResult): AnalysisResult => {
    if (!r.scale && !r.vectors.length) return r;
    const extra: Vector[] = [];
    for (const e of exprs) {
      try {
        extra.push(evaluateExpression(e, { result: r, extra }).vector);
      } catch {
        // an expression may not apply to every analysis of a run (e.g. time functions on AC)
      }
    }
    return extra.length ? { ...r, vectors: [...r.vectors, ...extra] } : r;
  };
  if (result.runs?.length) return { ...result, runs: result.runs.map((x) => ({ label: x.label, result: apply(x.result) })) };
  return apply(result);
}

function pageKeyFor(type: string, runId: number, used: Set<string>): string {
  const base = `${type}${runId}`;
  let key = base;
  for (let k = 0; used.has(key); k++) key = `${base}${String.fromCharCode(98 + k)}`;
  used.add(key);
  return key;
}

/** Add a run: one page per tab; the first new page becomes active. Drops the oldest runs. */
export function addRun(doc: GrapherDoc, run: RunRecord, max = MAX_RUN_HISTORY): GrapherDoc {
  if (doc.runs.some((r) => r.id === run.id)) return doc;
  let runs = [...doc.runs, run];
  let pages = [...doc.pages];
  if (runs.length > max) {
    const dropped = new Set(runs.slice(0, runs.length - max).map((r) => r.id));
    runs = runs.slice(runs.length - max);
    pages = pages.filter((p) => !dropped.has(p.runId)).map((p) => ({ ...p, overlays: p.overlays.filter((o) => !dropped.has(o.runId)) }));
  }
  const used = new Set(pages.map((p) => p.key));
  let next = doc.nextPage;
  const fresh: GraphPage[] = runTabs(run).map((tab, i) => ({
    id: `p${next++}`,
    runId: run.id,
    tab: i,
    key: pageKeyFor(tab.result.type, run.id, used),
    overlays: [],
    props: {},
    traces: {},
  }));
  pages.push(...fresh);
  const active = fresh[0]?.id ?? (pages.some((p) => p.id === doc.active) ? doc.active : (pages[0]?.id ?? null));
  return { runs, pages, active, nextPage: next };
}

/**
 * Replace the automatic pages of restored runs by the pages saved with the design
 * (Design.grapher, run ids already remapped to this session): tab, key, overlays, page and trace
 * properties come back under new page ids. Pages of runs the doc does not have are skipped.
 */
export function applySavedPages(doc: GrapherDoc, saved: readonly SavedPage[], active?: string): GrapherDoc {
  const valid = saved.filter((p) => doc.runs.some((r) => r.id === p.runId && p.tab < runTabs(r).length));
  if (!valid.length) return doc;
  const runIds = new Set(valid.map((p) => p.runId));
  const kept = doc.pages.filter((p) => !runIds.has(p.runId));
  const used = new Set(kept.map((p) => p.key));
  let next = doc.nextPage;
  const idMap = new Map<string, string>();
  const restored: GraphPage[] = valid.map((p) => {
    const id = `p${next++}`;
    idMap.set(p.id, id);
    const key = !p.key || used.has(p.key) ? pageKeyFor(runTabs(runOf(doc, p.runId)!)[p.tab].result.type, p.runId, used) : p.key;
    used.add(key);
    return { id, runId: p.runId, tab: p.tab, key, overlays: p.overlays.map((o) => ({ ...o })), props: { ...(p.props as PageProps) }, traces: { ...(p.traces as Record<string, TraceStyle>) } };
  });
  const first = (active && idMap.get(active)) ?? restored[0].id;
  return { ...doc, pages: [...kept, ...restored], active: first, nextPage: next };
}

/** Bring the doc up to date with the controller's run list (adds runs it has not seen). */
export function syncRuns(doc: GrapherDoc, runs: readonly RunRecord[]): GrapherDoc {
  let d = doc;
  for (const r of runs) if (!d.runs.some((x) => x.id === r.id)) d = addRun(d, r);
  return d;
}

export function findPage(doc: GrapherDoc, id: string | null): GraphPage | undefined {
  return id ? doc.pages.find((p) => p.id === id) : undefined;
}

export function runOf(doc: GrapherDoc, runId: number): RunRecord | undefined {
  return doc.runs.find((r) => r.id === runId);
}

/** The tab a page shows (undefined when its run is gone). */
export function pageTab(doc: GrapherDoc, page: GraphPage): GraphTab | undefined {
  const run = runOf(doc, page.runId);
  return run ? runTabs(run)[page.tab] : undefined;
}

/** Display title of a page: its own title, else "<tab title> · <run label>". */
export function pageTitle(doc: GrapherDoc, page: GraphPage): string {
  if (page.props.title) return page.props.title;
  const tab = pageTab(doc, page);
  return `${tab?.title ?? page.key} · ${runLabel(doc, page.runId)}`;
}

/** "Lần 3 · 14:05" (run number and finishing time). */
export function runLabel(doc: GrapherDoc, runId: number): string {
  const run = runOf(doc, runId);
  if (!run) return t('grapher.runN', { n: runId });
  const d = new Date(run.time);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (run.source === 'import') return `${t('grapher.runImported', { n: runId })} · ${run.name}`;
  return `${run.source === 'interactive' ? t('grapher.runInteractive', { n: runId }) : t('grapher.runN', { n: runId })} · ${hh}:${mm}`;
}

function update(doc: GrapherDoc, id: string, f: (p: GraphPage) => GraphPage): GrapherDoc {
  return { ...doc, pages: doc.pages.map((p) => (p.id === id ? f(p) : p)) };
}

export function setActive(doc: GrapherDoc, id: string): GrapherDoc {
  return doc.pages.some((p) => p.id === id) ? { ...doc, active: id } : doc;
}

export function removePage(doc: GrapherDoc, id: string): GrapherDoc {
  const idx = doc.pages.findIndex((p) => p.id === id);
  if (idx < 0) return doc;
  const pages = doc.pages.filter((p) => p.id !== id);
  const active = doc.active === id ? (pages[Math.min(idx, pages.length - 1)]?.id ?? null) : doc.active;
  return { ...doc, pages, active };
}

/** Copy of a page (same run, overlays and properties) placed after it and made active. */
export function duplicatePage(doc: GrapherDoc, id: string): GrapherDoc {
  const idx = doc.pages.findIndex((p) => p.id === id);
  if (idx < 0) return doc;
  const src = doc.pages[idx];
  const used = new Set(doc.pages.map((p) => p.key));
  let key = src.key;
  for (let k = 0; used.has(key); k++) key = `${src.key}${String.fromCharCode(98 + k)}`;
  const copy: GraphPage = { ...src, id: `p${doc.nextPage}`, key, overlays: [...src.overlays], props: { ...src.props, title: src.props.title ? `${src.props.title} (2)` : undefined }, traces: { ...src.traces } };
  const pages = [...doc.pages.slice(0, idx + 1), copy, ...doc.pages.slice(idx + 1)];
  return { ...doc, pages, active: copy.id, nextPage: doc.nextPage + 1 };
}

export function setPageProps(doc: GrapherDoc, id: string, patch: Partial<PageProps>): GrapherDoc {
  return update(doc, id, (p) => ({ ...p, props: { ...p.props, ...patch } }));
}

export function setTraceStyle(doc: GrapherDoc, id: string, key: string, patch: Partial<TraceStyle>): GrapherDoc {
  return update(doc, id, (p) => ({ ...p, traces: { ...p.traces, [key]: { ...p.traces[key], ...patch } } }));
}

/** Kind of x axis of a tab: 'time', 'frequency', a sweep name, or '' for tables. */
export function scaleKind(tab: GraphTab | undefined): string {
  const r = tab?.result;
  const s = r?.scale ?? r?.runs?.find((x) => x.result.scale)?.result.scale;
  if (!s) return '';
  if (s.unit === 's' || s.name.toLowerCase() === 'time') return 'time';
  if (s.unit === 'Hz' || s.name.toLowerCase() === 'frequency') return 'frequency';
  return s.name.toLowerCase();
}

/** Plottable vectors of a tab (single results only; families are compared by their own runs). */
function tabVectors(tab: GraphTab): Vector[] {
  const r = tab.result;
  if (!r.scale) return [];
  // helper vectors are hidden in the Grapher, so they are not offered as overlays either
  return r.vectors.filter((v) => v.re.length === r.scale!.re.length && !isInternalVector(v.name));
}

export interface OverlayCandidate {
  ref: TraceRef;
  /** "V(out) — Lần 2 · 14:01" */
  label: string;
}

/** Traces of other runs with the same kind of x axis as the page, newest run first. */
export function overlayCandidates(doc: GrapherDoc, pageId: string): OverlayCandidate[] {
  const page = findPage(doc, pageId);
  const own = page && pageTab(doc, page);
  const kind = scaleKind(own);
  if (!page || !kind) return [];
  const out: OverlayCandidate[] = [];
  for (const run of [...doc.runs].reverse()) {
    runTabs(run).forEach((tab, i) => {
      if (run.id === page.runId && i === page.tab) return;
      if (scaleKind(tab) !== kind || tab.family) return;
      for (const v of tabVectors(tab)) {
        const ref = { runId: run.id, tab: i, vector: v.name };
        if (page.overlays.some((o) => sameRef(o, ref))) continue;
        out.push({ ref, label: `${v.name} — ${tab.title} · ${runLabel(doc, run.id)}` });
      }
    });
  }
  return out;
}

const sameRef = (a: TraceRef, b: TraceRef) => a.runId === b.runId && a.tab === b.tab && a.vector.toLowerCase() === b.vector.toLowerCase();

export function addOverlay(doc: GrapherDoc, pageId: string, ref: TraceRef): GrapherDoc {
  return update(doc, pageId, (p) => (p.overlays.some((o) => sameRef(o, ref)) ? p : { ...p, overlays: [...p.overlays, ref] }));
}

export function removeOverlay(doc: GrapherDoc, pageId: string, ref: TraceRef): GrapherDoc {
  return update(doc, pageId, (p) => ({ ...p, overlays: p.overlays.filter((o) => !sameRef(o, ref)) }));
}

/**
 * "Add traces from latest simulation": the newest run other than the page's own that has a page
 * with the same kind of x axis contributes every vector the page shows (or, when none of the
 * names match, all its vectors). Returns the new doc and the number of traces added.
 */
export function addTracesFromLatest(doc: GrapherDoc, pageId: string): { doc: GrapherDoc; added: number } {
  const page = findPage(doc, pageId);
  const own = page && pageTab(doc, page);
  const kind = scaleKind(own);
  if (!page || !own || !kind) return { doc, added: 0 };
  const ownNames = new Set(tabVectors(own).map((v) => v.name.toLowerCase()));
  for (const run of [...doc.runs].reverse()) {
    if (run.id === page.runId) continue;
    const tabs = runTabs(run);
    const i = tabs.findIndex((tb) => scaleKind(tb) === kind && !tb.family && tb.result.type === own.result.type);
    const j = i >= 0 ? i : tabs.findIndex((tb) => scaleKind(tb) === kind && !tb.family);
    if (j < 0) continue;
    const vectors = tabVectors(tabs[j]);
    const matching = vectors.filter((v) => ownNames.has(v.name.toLowerCase()));
    let d = doc;
    let added = 0;
    for (const v of matching.length ? matching : vectors) {
      const ref = { runId: run.id, tab: j, vector: v.name };
      if (findPage(d, pageId)!.overlays.some((o) => sameRef(o, ref))) continue;
      d = addOverlay(d, pageId, ref);
      added++;
    }
    return { doc: d, added };
  }
  return { doc, added: 0 };
}

/** Vector of a reference (undefined when the run or vector is gone). */
export function refVector(doc: GrapherDoc, ref: TraceRef): { vector: Vector; scale: Vector } | undefined {
  const run = runOf(doc, ref.runId);
  const tab = run && runTabs(run)[ref.tab];
  const r = tab?.result;
  if (!r?.scale) return undefined;
  const v = r.vectors.find((x) => x.name.toLowerCase() === ref.vector.toLowerCase());
  return v ? { vector: v, scale: r.scale } : undefined;
}

/**
 * The result a page shows: its own result, or with overlays a family whose first run is the
 * page's result and whose other runs hold the overlaid vectors (labelled by their run).
 */
export function pageResult(doc: GrapherDoc, page: GraphPage): AnalysisResult | undefined {
  const tab = pageTab(doc, page);
  if (!tab) return undefined;
  if (!page.overlays.length) return tab.result;
  const groups = new Map<string, { label: string; scale: Vector; vectors: Vector[] }>();
  for (const ref of page.overlays) {
    const hit = refVector(doc, ref);
    if (!hit) continue;
    const k = `${ref.runId}:${ref.tab}`;
    const g = groups.get(k) ?? { label: runLabel(doc, ref.runId), scale: hit.scale, vectors: [] };
    g.vectors.push(hit.vector);
    groups.set(k, g);
  }
  if (!groups.size) return tab.result;
  const own = tab.result;
  const ownRuns = own.runs?.length && tab.family ? own.runs : [{ label: runLabel(doc, page.runId), result: own }];
  const extra = [...groups.values()].map((g) => ({ label: g.label, result: { type: own.type, title: own.title, scale: g.scale, vectors: g.vectors, warnings: [] } as AnalysisResult }));
  return { ...own, runs: [...ownRuns, ...extra] };
}

// ---------------------------------------------------------------------------
// Postprocessor references across pages
// ---------------------------------------------------------------------------

/** Linear resampling of (x, y) onto the abscissae xs (NaN outside the data). */
export function resampleOnto(x: ArrayLike<number>, y: ArrayLike<number>, xs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) out[i] = interpolateAt(x, y, xs[i]);
  return out;
}

/**
 * Resolver for `<page>.<vector>` references made from `page`: finds the page by key, reads the
 * vector (any name the postprocessor accepts) and aligns it with `scale` — directly when the
 * samples are identical, else by linear interpolation when both pages share the kind of x axis.
 */
export function crossPageResolver(doc: GrapherDoc, scale: Vector | undefined): (key: string, name: string) => Vector | undefined {
  return (key, name) => {
    const target = doc.pages.find((p) => p.key.toLowerCase() === key.toLowerCase());
    if (!target) throw new PostprocessorError(t('grapher.unknownPage', { key }));
    const tab = pageTab(doc, target);
    if (!tab) throw new PostprocessorError(t('grapher.unknownPage', { key }));
    const r = tab.result;
    const v = evaluateExpression(name, { result: r }).vector;
    if (!r.scale || !scale) {
      if (v.re.length === 1) return v;
      throw new PostprocessorError(t('grapher.crossNoScale', { key }));
    }
    const kindOf = (s: Vector) => (s.unit === 's' || s.name.toLowerCase() === 'time' ? 'time' : s.unit === 'Hz' || s.name.toLowerCase() === 'frequency' ? 'frequency' : s.name.toLowerCase());
    if (kindOf(r.scale) !== kindOf(scale)) throw new PostprocessorError(t('grapher.crossScaleMismatch', { key, a: r.scale.name, b: scale.name }));
    const same = r.scale.re.length === scale.re.length && r.scale.re.every((x, i) => x === scale.re[i]);
    if (same) return v;
    const out: Vector = { name: v.name, unit: v.unit, re: resampleOnto(r.scale.re, v.re, scale.re) };
    if (v.im) out.im = resampleOnto(r.scale.re, v.im, scale.re);
    return out;
  };
}

// ---------------------------------------------------------------------------
// Text export (format in src/util/measurementText.ts)
// ---------------------------------------------------------------------------

export { parseTracesText, tracesToText, type TextTrace } from '../../util/measurementText';
