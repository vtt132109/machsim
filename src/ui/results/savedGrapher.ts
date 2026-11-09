/**
 * Grapher pages kept in the design file (Design.grapher, Grapher > "Keep pages in the design").
 * Pure and light (no Grapher code), so the integration can restore runs at file-open time without
 * loading the Grapher chunk.
 *
 *   snapshotGrapher(runs, pages, active, opts)  -> SavedGrapher: the runs the pages show (page runs
 *                                                  and overlays), newest MAX_SAVED_RUNS of them,
 *                                                  each vector decimated to at most maxPoints samples
 *   runFromSaved(saved) / runToSaved(run)       RunRecord <-> SavedRun (NaN <-> null)
 *   remapPages(pages, idMap)                    pages of restored runs under their new run ids
 *
 * Decimation keeps the first and last sample and every k-th one between, for the scale and every
 * vector alike (digital vectors keep their edges: a sample is also kept where the value changes).
 */
import type { SavedGrapher, SavedPage, SavedResult, SavedRun, SavedVector } from '../../model/types';
import type { AnalysisResult, Vector, VectorUnit } from '../../sim/results';
import type { RunRecord, RunSource } from './runs';

export const MAX_SAVED_RUNS = 10;
export const MAX_SAVED_POINTS = 5000;

/** Page fields the snapshot needs (structurally the GraphPage of history.ts). */
export interface PageLike {
  id: string;
  runId: number;
  tab: number;
  key: string;
  overlays: { runId: number; tab: number; vector: string }[];
  props: object;
  traces: Record<string, object>;
}

const toNums = (a: ArrayLike<number>, keep: number[] | null): (number | null)[] => {
  const out: (number | null)[] = [];
  const push = (v: number) => out.push(Number.isFinite(v) ? v : null);
  if (!keep) for (let i = 0; i < a.length; i++) push(a[i]);
  else for (const i of keep) push(a[i]);
  return out;
};

const fromNums = (a: readonly (number | null)[]): Float64Array => Float64Array.from(a, (v) => (v === null ? Number.NaN : v));

/** Indices kept when decimating `n` samples to about `max` (null = keep all). */
function keepIndices(n: number, max: number, digital: Vector[]): number[] | null {
  if (n <= max) return null;
  const step = Math.ceil(n / max);
  const keep = new Set<number>([0, n - 1]);
  for (let i = 0; i < n; i += step) keep.add(i);
  for (const d of digital) for (let i = 1; i < n; i++) if (d.re[i] !== d.re[i - 1] && !(Number.isNaN(d.re[i]) && Number.isNaN(d.re[i - 1]))) keep.add(i - 1).add(i);
  return [...keep].sort((a, b) => a - b);
}

function vectorToSaved(v: Vector, keep: number[] | null): SavedVector {
  const out: SavedVector = { name: v.name, unit: v.unit, re: toNums(v.re, keep) };
  if (v.im) out.im = toNums(v.im, keep);
  if (v.digital) out.digital = true;
  if (v.xValues && v.xValues.length === v.re.length) {
    out.xValues = toNums(v.xValues, keep);
    if (v.xName !== undefined) out.xName = v.xName;
    if (v.xUnit !== undefined) out.xUnit = v.xUnit;
  }
  return out;
}

function resultToSaved(r: AnalysisResult, maxPoints: number): SavedResult {
  const n = r.scale?.re.length ?? 0;
  const keep = r.scale ? keepIndices(n, maxPoints, r.vectors.filter((v) => v.digital && v.re.length === n)) : null;
  const out: SavedResult = { type: r.type, title: r.title, vectors: r.vectors.map((v) => vectorToSaved(v, v.re.length === n ? keep : null)) };
  if (r.scale) out.scale = vectorToSaved(r.scale, keep);
  if (r.runs?.length) out.runs = r.runs.map((x) => ({ label: x.label, result: resultToSaved(x.result, maxPoints) }));
  if (r.scalars) out.scalars = Object.fromEntries(Object.entries(r.scalars).filter(([, v]) => Number.isFinite(v)));
  if (r.table) out.table = { columns: [...r.table.columns], rows: r.table.rows.map((row) => row.map((c) => (typeof c === 'number' && !Number.isFinite(c) ? String(c) : c))) };
  return out;
}

function vectorFromSaved(v: SavedVector): Vector {
  const out: Vector = { name: v.name, unit: v.unit as VectorUnit, re: fromNums(v.re) };
  if (v.im) out.im = fromNums(v.im);
  if (v.digital) out.digital = true;
  if (v.xValues) {
    out.xValues = fromNums(v.xValues);
    if (v.xName !== undefined) out.xName = v.xName;
    if (v.xUnit !== undefined) out.xUnit = v.xUnit as VectorUnit;
  }
  return out;
}

function resultFromSaved(r: SavedResult): AnalysisResult {
  const out: AnalysisResult = { type: r.type, title: r.title, vectors: r.vectors.map(vectorFromSaved), warnings: [] };
  if (r.scale) out.scale = vectorFromSaved(r.scale);
  if (r.runs?.length) out.runs = r.runs.map((x) => ({ label: x.label, result: resultFromSaved(x.result) }));
  if (r.scalars) out.scalars = { ...r.scalars };
  if (r.table) out.table = { columns: [...r.table.columns], rows: r.table.rows.map((row) => [...row]) };
  return out;
}

const SOURCES: RunSource[] = ['analysis', 'interactive', 'netlist', 'import'];

export function runToSaved(run: RunRecord, maxPoints = MAX_SAVED_POINTS): SavedRun {
  const out: SavedRun = { id: run.id, source: run.source, name: run.name, time: run.time, results: run.results.map((r) => resultToSaved(r, maxPoints)) };
  if (run.expressions?.length) out.expressions = [...run.expressions];
  return out;
}

export function runFromSaved(saved: SavedRun, id: number = saved.id): RunRecord {
  const source = (SOURCES as string[]).includes(saved.source) ? (saved.source as RunSource) : 'analysis';
  const out: RunRecord = { id, source, name: saved.name, time: saved.time, results: saved.results.map(resultFromSaved) };
  if (saved.expressions?.length) out.expressions = [...saved.expressions];
  return out;
}

/** The runs the pages show (and their overlays), newest `maxRuns` of them, with the pages that refer only to those. */
export function snapshotGrapher(runs: readonly RunRecord[], pages: readonly PageLike[], active: string | null, opts: { maxRuns?: number; maxPoints?: number } = {}): SavedGrapher {
  const maxRuns = opts.maxRuns ?? MAX_SAVED_RUNS;
  const used = new Set<number>();
  for (const p of pages) {
    used.add(p.runId);
    for (const o of p.overlays) used.add(o.runId);
  }
  const kept = runs.filter((r) => used.has(r.id)).slice(-maxRuns);
  const keptIds = new Set(kept.map((r) => r.id));
  const savedPages: SavedPage[] = pages
    .filter((p) => keptIds.has(p.runId))
    .map((p) => ({
      id: p.id,
      runId: p.runId,
      tab: p.tab,
      key: p.key,
      overlays: p.overlays.filter((o) => keptIds.has(o.runId)).map((o) => ({ ...o })),
      props: JSON.parse(JSON.stringify(p.props)) as Record<string, unknown>,
      traces: JSON.parse(JSON.stringify(p.traces)) as Record<string, Record<string, unknown>>,
    }));
  const out: SavedGrapher = { version: 1, runs: kept.map((r) => runToSaved(r, opts.maxPoints)), pages: savedPages };
  if (active && savedPages.some((p) => p.id === active)) out.active = active;
  return out;
}

/** Pages of restored runs with their run ids replaced (pages of runs not in the map are dropped). */
export function remapPages(pages: readonly SavedPage[], idMap: ReadonlyMap<number, number>): SavedPage[] {
  return pages
    .filter((p) => idMap.has(p.runId))
    .map((p) => ({ ...p, runId: idMap.get(p.runId)!, overlays: p.overlays.filter((o) => idMap.has(o.runId)).map((o) => ({ ...o, runId: idMap.get(o.runId)! })) }));
}
