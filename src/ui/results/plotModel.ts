/**
 * Grapher data model: turns contract `AnalysisResult`s into tabs, plot panes, traces and
 * tables, and provides the cursor / decimation / CSV helpers used by the plot views.
 *
 * Layout rules
 * - One tab per result. A `batch` result is flattened into one tab per item; family results
 *   (param / temperature / nested sweep, Monte Carlo, worst case) overlay every run in one tab.
 * - Complex (AC) vectors are shown as stacked magnitude (dB or linear) and phase (deg) panes.
 * - Real analog vectors are grouped into panes by unit (V, A, W, ...); digital vectors share one
 *   digital pane drawn as stacked logic lanes.
 * - The x axis is logarithmic for frequency sweeps that are not linear sweeps.
 *
 * Pure (DOM-free) and unit-tested.
 */

import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult, Vector, VectorUnit } from '../../sim/results';
import { formatEng } from '../../util/units';
import { unwrapDeg } from './dsp';
import { lazyRecord, t, tDynamic } from '../../i18n';
import { localizeResultTitle } from './titles';

export type MagnitudeMode = 'db' | 'linear';

export interface PlotTrace {
  /** unique key within one PlotData */
  key: string;
  /** legend label */
  label: string;
  /** source vector name */
  vector: string;
  /** run label for families */
  run?: string;
  x: Float64Array;
  y: Float64Array;
  unit: VectorUnit | string;
  /** index into PlotData.panes */
  pane: number;
  /** colour slot (0-based): CSS var --trace-(color % 8 + 1) */
  color: number;
  digital?: boolean;
  /** line width in CSS px (default 1.5) */
  width?: number;
  /** X-Y trace (postprocessor vs(y, x)): x holds its own horizontal quantity */
  ownX?: { name: string; unit: string };
}

export interface PlotPane {
  id: string;
  title: string;
  unit: string;
  kind: 'analog' | 'digital';
}

export interface PlotData {
  xLabel: string;
  xUnit: VectorUnit | string;
  xLog: boolean;
  panes: PlotPane[];
  traces: PlotTrace[];
}

export interface ResultTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface GraphTab {
  id: string;
  title: string;
  result: AnalysisResult;
  /** true when the tab overlays several runs */
  family: boolean;
}

const FAMILY_TYPES = new Set(['paramsweep', 'tempsweep', 'montecarlo', 'worstcase', 'nestedsweep']);

// result titles and the internal-vector rule live in the light titles.ts module (re-exported here for existing callers)
export { analysisTypeTitle, isInternalVector, localizeResultTitle } from './titles';
import { isInternalVector } from './titles';

/** Build the tab list for a set of results (batch results are flattened). */
export function buildTabs(results: AnalysisResult[]): GraphTab[] {
  const tabs: GraphTab[] = [];
  const used = new Map<string, number>();
  const add = (title: string, result: AnalysisResult) => {
    const base = localizeResultTitle(title, result.type);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    tabs.push({
      id: `${tabs.length}:${base}`,
      title: count ? `${base} (${count + 1})` : base,
      result,
      family: !!result.runs?.length && result.type !== 'batch' && result.type !== 'user',
    });
  };
  for (const r of results) {
    if ((r.type === 'batch' || r.type === 'user') && r.runs?.length) {
      for (const run of r.runs) add(run.result.title || run.label, run.result);
      if (r.error || r.warnings.length || r.table || r.scalars) add(r.title, { ...r, runs: undefined });
    } else add(r.title, r);
  }
  return tabs;
}

/** Physical unit implied by a SPICE output name: V(..) -> V, I(..)/Ic(..) -> A, P(..) -> W. */
export function unitForName(name: string): string {
  const n = name.trim().toLowerCase();
  if (/^v[a-z]*\(/.test(n) && !/^vdb|^vp\(/.test(n)) return 'V';
  if (/^i[a-z]*\(/.test(n)) return 'A';
  if (/^p\(/.test(n)) return 'W';
  if (n.includes('noise_spectrum')) return n.startsWith('i') ? 'A/rtHz' : 'V/rtHz';
  return '';
}

const UNIT_KEYS = ['V', 'A', 'W', 'Ohm', 'S', 'dB', 'deg', 'degC', 'V^2/Hz', 'A^2/Hz', 'V/rtHz', 'A/rtHz', 's', 'Hz'];
/** Axis titles per vector unit (current language). */
const UNIT_TITLES: Readonly<Record<string, string>> = lazyRecord(UNIT_KEYS, (u) => tDynamic(`results.unit.${u.replace(/[^A-Za-z]/g, '_')}`));

export function displayUnit(unit: string): string {
  if (unit === 'Ohm') return 'Ω';
  if (unit === 'degC') return '°C';
  if (unit === 'deg') return '°';
  return unit;
}

function scaleLabel(scale: Vector): string {
  const n = scale.name.toLowerCase();
  if (n === 'time') return t('common.time');
  if (n === 'frequency') return t('common.frequency');
  return scale.name;
}

function sweepOf(spec: AnalysisSpec | undefined): string | undefined {
  if (!spec) return undefined;
  if ('sweep' in spec) return spec.sweep;
  if (spec.type === 'sens') return spec.ac?.sweep;
  if ('base' in spec) return sweepOf(spec.base);
  return undefined;
}

function isLogFrequency(result: AnalysisResult, scale: Vector): boolean {
  if (scale.unit !== 'Hz' && scale.name.toLowerCase() !== 'frequency') return false;
  for (let i = 0; i < scale.re.length; i++) if (!(scale.re[i] > 0)) return false;
  return sweepOf(result.spec) !== 'lin';
}

/** Runs to overlay for a result: its own runs when it is a family, otherwise itself. */
function plotRuns(result: AnalysisResult): { label?: string; result: AnalysisResult }[] {
  if (result.runs?.length && result.type !== 'batch') {
    const withScale = result.runs.filter((r) => r.result.scale && r.result.vectors.length);
    if (withScale.length) return withScale;
  }
  return result.scale ? [{ result }] : [];
}

/** Number of internal helper vectors in a result (top level and runs). */
export function internalVectorCount(result: AnalysisResult): number {
  const names = new Set<string>();
  const add = (r: AnalysisResult) => {
    for (const v of r.vectors) if (isInternalVector(v.name)) names.add(v.name.toLowerCase());
    for (const k of Object.keys(r.scalars ?? {})) if (isInternalVector(k)) names.add(k.toLowerCase());
  };
  add(result);
  for (const run of result.runs ?? []) add(run.result);
  return names.size;
}

export interface BuildPlotOptions {
  magnitude?: MagnitudeMode;
  /** include internal helper vectors (isInternalVector); default false */
  showInternal?: boolean;
  /** extra vectors (postprocessor output) added to the top-level result */
  extra?: Vector[];
  /** unwrap phase traces (default true) */
  unwrapPhase?: boolean;
}

/** Build panes and traces for a result, or null when it has nothing to plot. */
export function buildPlotData(result: AnalysisResult, opts: BuildPlotOptions = {}): PlotData | null {
  const runs = plotRuns(result);
  if (!runs.length) return null;
  const firstScale = runs[0].result.scale!;
  const magnitude = opts.magnitude ?? 'db';
  const panes: PlotPane[] = [];
  const paneIndex = new Map<string, number>();
  const pane = (id: string, title: string, unit: string, kind: PlotPane['kind']) => {
    let i = paneIndex.get(id);
    if (i === undefined) {
      i = panes.length;
      panes.push({ id, title, unit, kind });
      paneIndex.set(id, i);
    }
    return i;
  };
  const traces: PlotTrace[] = [];
  const vectorOrder: string[] = [];
  const keep = (v: Vector) => opts.showInternal || !isInternalVector(v.name);
  const allVectors = (r: AnalysisResult, top: boolean) => (top && opts.extra ? [...r.vectors.filter(keep), ...opts.extra] : r.vectors.filter(keep));
  for (const run of runs) {
    for (const v of allVectors(run.result, run.result === result || runs.length === 1)) {
      const k = v.name.toLowerCase();
      if (!vectorOrder.includes(k)) vectorOrder.push(k);
    }
  }
  const multiRun = runs.length > 1;
  runs.forEach((run, runIdx) => {
    const scale = run.result.scale!;
    const x = scale.re;
    for (const v of allVectors(run.result, run.result === result || runs.length === 1)) {
      if (v.re.length !== x.length) continue;
      const vIdx = vectorOrder.indexOf(v.name.toLowerCase());
      const color = multiRun ? (vectorOrder.length === 1 ? runIdx : runIdx * vectorOrder.length + vIdx) : vIdx;
      const label = run.label ? `${v.name} (${run.label})` : v.name;
      const keyBase = `${runIdx}:${v.name}`;
      const unit = v.unit || unitForName(v.name);
      if (v.digital) {
        traces.push({ key: keyBase, label, vector: v.name, run: run.label, x, y: v.re, unit, pane: pane('digital', t('results.plotModel.digital'), '', 'digital'), color, digital: true });
      } else if (v.im) {
        const mag = new Float64Array(x.length);
        const ph = new Float64Array(x.length);
        for (let i = 0; i < x.length; i++) {
          const m = Math.hypot(v.re[i], v.im[i]);
          mag[i] = magnitude === 'db' ? 20 * Math.log10(m) : m;
          ph[i] = (Math.atan2(v.im[i], v.re[i]) * 180) / Math.PI;
        }
        const magPane = magnitude === 'db' ? pane('mag-db', t('results.plotModel.magnitudeDb'), 'dB', 'analog') : pane('mag', t('common.magnitude'), unit, 'analog');
        const phPane = pane('phase', t('results.plotModel.phaseDeg'), 'deg', 'analog');
        traces.push({ key: `${keyBase}:mag`, label, vector: v.name, run: run.label, x, y: mag, unit: magnitude === 'db' ? 'dB' : unit, pane: magPane, color });
        traces.push({
          key: `${keyBase}:ph`,
          label,
          vector: v.name,
          run: run.label,
          x,
          y: opts.unwrapPhase === false ? ph : unwrapDeg(ph),
          unit: 'deg',
          pane: phPane,
          color,
        });
      } else {
        const id = `u:${unit}`;
        // X-Y vectors (postprocessor vs(y, x)) bring their own horizontal values
        const own = v.xValues && v.xValues.length === v.re.length ? v.xValues : undefined;
        const p = paneIndex.has(id) || panes.filter((q) => q.kind === 'analog').length < 3 ? pane(id, UNIT_TITLES[unit] ?? (unit ? `(${unit})` : t('common.value')), unit, 'analog') : panes.findIndex((q) => q.kind === 'analog');
        traces.push({ key: keyBase, label, vector: v.name, run: run.label, x: own ?? x, y: v.re, unit, pane: p, color, ...(own ? { ownX: { name: v.xName ?? '', unit: v.xUnit ?? '' } } : {}) });
      }
    }
  });
  if (!traces.length) return null;
  // X-Y mode: while a postprocessor vs(y, x) trace exists the plot shows only the X-Y traces (a shared horizontal axis cannot
  // hold both time and a field strength); removing the expression brings the time plot back
  if (traces.some((q) => q.ownX) && traces.some((q) => !q.ownX)) {
    for (let i = traces.length - 1; i >= 0; i--) if (!traces[i].ownX) traces.splice(i, 1);
    const used = [...new Set(traces.map((q) => q.pane))];
    const keep = used.map((i) => panes[i]);
    for (const q of traces) q.pane = used.indexOf(q.pane);
    panes.length = 0;
    panes.push(...keep);
  }
  // Order panes: magnitude, phase, unit panes, digital last.
  const rank = (p: PlotPane) => (p.id.startsWith('mag') ? 0 : p.id === 'phase' ? 1 : p.kind === 'digital' ? 3 : 2);
  const order = panes.map((p, i) => i).sort((a, b) => rank(panes[a]) - rank(panes[b]) || a - b);
  const remap = new Map(order.map((old, i) => [old, i] as const));
  for (const t of traces) t.pane = remap.get(t.pane)!;
  // every trace has its own horizontal quantity (an X-Y plot): the axis is named after it
  const xy = traces.every((q) => q.ownX) ? traces[0].ownX : undefined;
  return {
    xLabel: xy ? xy.name || t('results.plotModel.xy') : scaleLabel(firstScale),
    xUnit: xy ? xy.unit : firstScale.unit,
    xLog: xy ? false : isLogFrequency(result, firstScale),
    panes: order.map((i) => panes[i]),
    traces,
  };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const TABLE_KEYS = ['sens', 'pz', 'four', 'worstcase', 'montecarlo', 'tf', 'tracewidth', 'noisefig', 'disto'];
/** Table titles per result type (current language). */
const TABLE_TITLES: Readonly<Record<string, string>> = lazyRecord(TABLE_KEYS, (k) => tDynamic(`results.table.${k}`));

/** Format a scalar for display, with a unit inferred from its name. */
export function formatValue(name: string, value: number): string {
  const unit = unitForName(name);
  if (!Number.isFinite(value)) return String(value);
  return formatEng(value, unit, 5);
}

export interface ResultTableOptions {
  /** include internal helper vectors (isInternalVector); default false */
  showInternal?: boolean;
}

/**
 * Tables to show for a result (contract `table`, `scalars`, OP-like single values, run families,
 * `.meas` values of the result and of its runs).
 * Scalars that repeat a single-value vector are not listed twice (an operating point reports
 * every value both ways), so an OP gives one table.
 */
export function resultTables(result: AnalysisResult, opts: ResultTableOptions = {}): ResultTable[] {
  const tables: ResultTable[] = [];
  const shown = (name: string) => opts.showInternal || !isInternalVector(name);
  if (result.table && result.table.columns.length) {
    tables.push({ title: TABLE_TITLES[result.type] ?? t('results.plotModel.results'), columns: result.table.columns, rows: result.table.rows });
  }
  const singleNames = new Set(!result.scale ? result.vectors.filter((v) => v.re.length === 1).map((v) => v.name.toLowerCase()) : []);
  const scalarRows = Object.entries(result.scalars ?? {}).filter(([k]) => shown(k) && !singleNames.has(k.toLowerCase()));
  if (scalarRows.length) {
    tables.push({
      title: result.type === 'op' ? t('results.plotModel.operatingPoint') : t('common.values'),
      columns: [t('common.name'), t('common.value')],
      rows: scalarRows.map(([k, v]) => [k, v]),
    });
  }
  if (!result.scale && result.vectors.length) {
    const single = result.vectors.filter((v) => v.re.length === 1 && shown(v.name));
    if (single.length) {
      const complex = single.some((v) => v.im);
      tables.push({
        title: result.type === 'op' ? t('results.plotModel.operatingPoint') : t('common.values'),
        columns: complex ? [t('results.plotModel.variable'), t('common.magnitude'), t('results.plotModel.phaseDeg'), t('results.plotModel.real'), t('results.plotModel.imaginary')] : [t('results.plotModel.variable'), t('common.value')],
        rows: single.map((v) => {
          if (!complex) return [v.name, v.re[0]];
          const im = v.im ? v.im[0] : 0;
          return [v.name, Math.hypot(v.re[0], im), (Math.atan2(im, v.re[0]) * 180) / Math.PI, v.re[0], im];
        }),
      });
    }
  }
  if (result.measurements?.length) {
    tables.push({
      title: t('results.plotModel.measurements'),
      columns: [t('common.name'), t('common.value'), t('results.plotModel.measuredAt'), t('results.plotModel.measureNote')],
      rows: result.measurements.map((m) => [m.name, Number.isFinite(m.value) ? m.value : '—', m.at ?? '', m.error ?? '']),
    });
  }
  const measuredRuns = (result.runs ?? []).filter((r) => r.result.measurements?.length);
  if (measuredRuns.length) {
    const names: string[] = [];
    for (const r of measuredRuns) for (const m of r.result.measurements!) if (!names.includes(m.name)) names.push(m.name);
    tables.push({
      title: t('results.plotModel.measurementsPerRun'),
      columns: [t('common.run'), ...names],
      rows: measuredRuns.map((r) => [
        r.label,
        ...names.map((n) => {
          const m = r.result.measurements!.find((x) => x.name === n);
          return m && Number.isFinite(m.value) ? m.value : '—';
        }),
      ]),
    });
  }
  if (result.runs?.length && result.type !== 'batch') {
    const scalarRuns = result.runs.filter((r) => !r.result.scale);
    if (scalarRuns.length) {
      const names: string[] = [];
      for (const r of scalarRuns) {
        for (const v of r.result.vectors) if (v.re.length === 1 && shown(v.name) && !names.includes(v.name)) names.push(v.name);
        for (const k of Object.keys(r.result.scalars ?? {})) if (shown(k) && !names.includes(k)) names.push(k);
      }
      if (names.length) {
        tables.push({
          title: t('results.plotModel.runs'),
          columns: [t('common.run'), ...names],
          rows: scalarRuns.map((r) => [
            r.label,
            ...names.map((n) => {
              const v = r.result.vectors.find((x) => x.name === n);
              if (v) return v.im ? Math.hypot(v.re[0], v.im[0]) : v.re[0];
              return r.result.scalars?.[n] ?? '';
            }),
          ]),
        });
      }
    }
  }
  return tables;
}

/**
 * Numeric sample sets for statistics/histograms: every numeric column of the result table
 * (with >= 2 numeric entries) and every scalar key that appears across runs.
 */
export function sampleSets(result: AnalysisResult): { name: string; values: number[] }[] {
  const sets: { name: string; values: number[] }[] = [];
  if (result.table) {
    result.table.columns.forEach((col, ci) => {
      const vals = result.table!.rows.map((r) => r[ci]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      if (vals.length >= 2 && !/^(run|#|index)$/i.test(col.trim())) sets.push({ name: col, values: vals });
    });
  }
  if (result.runs?.length) {
    const keys = new Map<string, number[]>();
    for (const r of result.runs) {
      for (const [k, v] of Object.entries(r.result.scalars ?? {})) {
        if (!Number.isFinite(v)) continue;
        const arr = keys.get(k) ?? [];
        arr.push(v);
        keys.set(k, arr);
      }
    }
    for (const [k, v] of keys) if (v.length >= 2 && !sets.some((s) => s.name === k)) sets.push({ name: k, values: v });
  }
  return sets;
}

export interface PoleZero {
  kind: 'pole' | 'zero';
  re: number;
  im: number;
}

/**
 * Extract poles/zeros from a pole-zero result table. Recognises a kind column (containing
 * "pole"/"zero" text) and real / imaginary columns by header name.
 */
export function poleZeroPoints(result: AnalysisResult): PoleZero[] {
  const t = result.table;
  if (!t) return [];
  const cols = t.columns.map((c) => c.toLowerCase());
  const reIdx = cols.findIndex((c) => c.includes('real') || c === 're');
  const imIdx = cols.findIndex((c) => c.includes('imag') || c === 'im');
  if (reIdx < 0 || imIdx < 0) return [];
  const pts: PoleZero[] = [];
  for (const row of t.rows) {
    const text = row.filter((c) => typeof c === 'string').join(' ').toLowerCase();
    const kind: PoleZero['kind'] | null = text.includes('pole') ? 'pole' : text.includes('zero') ? 'zero' : null;
    const re = Number(row[reIdx]);
    const im = Number(row[imIdx]);
    if (kind && Number.isFinite(re) && Number.isFinite(im)) pts.push({ kind, re, im });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Cursor math
// ---------------------------------------------------------------------------

/** Is x monotonic non-decreasing (+1), non-increasing (-1) or neither (0)? */
export function monotonicity(x: ArrayLike<number>): 1 | -1 | 0 {
  let inc = true;
  let dec = true;
  for (let i = 1; i < x.length && (inc || dec); i++) {
    if (x[i] < x[i - 1]) inc = false;
    if (x[i] > x[i - 1]) dec = false;
  }
  return inc ? 1 : dec ? -1 : 0;
}

/**
 * y at xq by linear interpolation. Works for ascending or descending x; for non-monotonic x
 * the first segment that brackets xq is used. NaN when xq is outside the data.
 */
export function interpolateAt(x: ArrayLike<number>, y: ArrayLike<number>, xq: number): number {
  const n = x.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return x[0] === xq ? y[0] : Number.NaN;
  const dir = monotonicity(x);
  if (dir !== 0) {
    let lo = 0;
    let hi = n - 1;
    const asc = dir === 1;
    const first = x[0];
    const last = x[n - 1];
    if (asc ? xq < first || xq > last : xq > first || xq < last) return Number.NaN;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (asc ? x[mid] <= xq : x[mid] >= xq) lo = mid;
      else hi = mid;
    }
    const x0 = x[lo];
    const x1 = x[hi];
    if (x1 === x0) return y[hi];
    return y[lo] + ((xq - x0) / (x1 - x0)) * (y[hi] - y[lo]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = x[i];
    const b = x[i + 1];
    if ((xq >= a && xq <= b) || (xq <= a && xq >= b)) {
      return a === b ? y[i + 1] : y[i] + ((xq - a) / (b - a)) * (y[i + 1] - y[i]);
    }
  }
  return Number.NaN;
}

export interface RangeExtrema {
  min: number;
  max: number;
  xAtMin: number;
  xAtMax: number;
}

/** Min / max of y over x in [x1, x2] (either order), including interpolated end points. */
export function rangeExtrema(x: ArrayLike<number>, y: ArrayLike<number>, x1: number, x2: number): RangeExtrema {
  const a = Math.min(x1, x2);
  const b = Math.max(x1, x2);
  let min = Infinity;
  let max = -Infinity;
  let xAtMin = Number.NaN;
  let xAtMax = Number.NaN;
  const consider = (xv: number, yv: number) => {
    if (!Number.isFinite(yv)) return;
    if (yv < min) {
      min = yv;
      xAtMin = xv;
    }
    if (yv > max) {
      max = yv;
      xAtMax = xv;
    }
  };
  for (let i = 0; i < x.length; i++) if (x[i] >= a && x[i] <= b) consider(x[i], y[i]);
  consider(a, interpolateAt(x, y, a));
  consider(b, interpolateAt(x, y, b));
  if (min === Infinity) return { min: Number.NaN, max: Number.NaN, xAtMin, xAtMax };
  return { min, max, xAtMin, xAtMax };
}

export interface CursorRow {
  key: string;
  label: string;
  unit: string;
  y1: number;
  y2: number;
  dy: number;
  min: number;
  max: number;
}

export interface CursorReadout {
  x1: number;
  x2: number;
  dx: number;
  /** 1/dx (frequency for time axes) */
  invDx: number;
  rows: CursorRow[];
}

export function cursorReadout(traces: PlotTrace[], x1: number, x2: number): CursorReadout {
  const dx = x2 - x1;
  return {
    x1,
    x2,
    dx,
    invDx: dx !== 0 ? 1 / dx : Number.NaN,
    rows: traces.map((t) => {
      const y1 = interpolateAt(t.x, t.y, x1);
      const y2 = interpolateAt(t.x, t.y, x2);
      const ext = rangeExtrema(t.x, t.y, x1, x2);
      return { key: t.key, label: t.label, unit: String(t.unit), y1, y2, dy: y2 - y1, min: ext.min, max: ext.max };
    }),
  };
}

// ---------------------------------------------------------------------------
// Rendering helpers: visible range, autoscale, decimation
// ---------------------------------------------------------------------------

/**
 * Index range [i0, i1] (inclusive) of an ascending x array covering [x0, x1], widened by one
 * sample on each side so lines run to the plot edge.
 */
export function visibleIndexRange(x: ArrayLike<number>, x0: number, x1: number): [number, number] {
  const n = x.length;
  if (n === 0) return [0, -1];
  const lowerBound = (v: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const i0 = Math.max(0, lowerBound(x0) - 1);
  const i1 = Math.min(n - 1, lowerBound(x1));
  return [i0, i1];
}

/** y min/max of the samples whose x lies in [x0, x1] (finite values only, `log` ignores y <= 0). */
export function yExtent(traces: { x: ArrayLike<number>; y: ArrayLike<number> }[], x0: number, x1: number, log = false): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const consider = (v: number) => {
    if (!Number.isFinite(v) || (log && v <= 0)) return;
    if (v < min) min = v;
    if (v > max) max = v;
  };
  for (const t of traces) {
    const asc = monotonicity(t.x) === 1;
    const [i0, i1] = asc ? visibleIndexRange(t.x, lo, hi) : [0, t.x.length - 1];
    for (let i = i0; i <= i1; i++) {
      const xv = t.x[i];
      if (xv < lo || xv > hi) continue;
      consider(t.y[i]);
    }
    // values where the trace meets the view edges (matters when zoomed between two samples)
    consider(interpolateAt(t.x, t.y, lo));
    consider(interpolateAt(t.x, t.y, hi));
  }
  return min === Infinity ? null : [min, max];
}

/** x min/max across traces (finite; positive only when `log`). */
export function xExtent(traces: { x: ArrayLike<number> }[], log = false): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const t of traces) {
    for (let i = 0; i < t.x.length; i++) {
      const v = t.x[i];
      if (!Number.isFinite(v) || (log && v <= 0)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min === Infinity ? null : [min, max];
}

/**
 * Min/max decimation of an ascending series into at most ~4 points per pixel column, preserving
 * peaks. `toCol` maps an x value to a (fractional) column. Returns parallel x/y arrays.
 */
export function decimateMinMax(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  toCol: (xv: number) => number,
): { x: Float64Array; y: Float64Array } {
  const count = i1 - i0 + 1;
  const outX: number[] = [];
  const outY: number[] = [];
  if (count <= 0) return { x: new Float64Array(0), y: new Float64Array(0) };
  let col = Math.floor(toCol(x[i0]));
  let firstI = i0;
  let minI = i0;
  let maxI = i0;
  let lastI = i0;
  const flush = () => {
    const idx = [firstI, minI, maxI, lastI].filter((v, k, arr) => arr.indexOf(v) === k).sort((a, b) => a - b);
    for (const i of idx) {
      outX.push(x[i]);
      outY.push(y[i]);
    }
  };
  for (let i = i0 + 1; i <= i1; i++) {
    const c = Math.floor(toCol(x[i]));
    if (c !== col) {
      flush();
      col = c;
      firstI = minI = maxI = lastI = i;
      continue;
    }
    lastI = i;
    const v = y[i];
    if (v < y[minI] || Number.isNaN(y[minI])) minI = i;
    if (v > y[maxI] || Number.isNaN(y[maxI])) maxI = i;
  }
  flush();
  return { x: Float64Array.from(outX), y: Float64Array.from(outY) };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function sameArray(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * CSV text for traces. When every trace shares the same x samples the file has one x column,
 * otherwise an x/y column pair per trace (rows padded with empty cells).
 */
export function tracesToCsv(traces: Pick<PlotTrace, 'label' | 'x' | 'y' | 'unit'>[], xLabel = 'x'): string {
  if (!traces.length) return '';
  const head = (t: Pick<PlotTrace, 'label' | 'unit'>) => (t.unit ? `${t.label} [${t.unit}]` : t.label);
  const lines: string[] = [];
  if (traces.every((t) => sameArray(t.x, traces[0].x))) {
    lines.push([xLabel, ...traces.map(head)].map(csvCell).join(','));
    const x = traces[0].x;
    for (let i = 0; i < x.length; i++) lines.push([x[i], ...traces.map((t) => t.y[i])].map(csvCell).join(','));
  } else {
    lines.push(traces.flatMap((t) => [`${xLabel} (${t.label})`, head(t)]).map(csvCell).join(','));
    const n = Math.max(...traces.map((t) => t.x.length));
    for (let i = 0; i < n; i++) {
      lines.push(traces.flatMap((t): (string | number)[] => (i < t.x.length ? [t.x[i], t.y[i]] : ['', ''])).map(csvCell).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/** CSV text for a table. */
export function tableToCsv(table: ResultTable): string {
  return [table.columns, ...table.rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
