/**
 * Analysis specification logic for the setup dialog (pure, DOM-free).
 *
 * - `ANALYSIS_CATALOG`: every AnalysisType of src/sim/netlist.ts with title, group and whether
 *   it is a meta analysis (wraps a nested `base` analysis or a list of items).
 * - `defaultSpec(type, ctx)`: a valid starting spec, using the circuit's sources / outputs.
 * - `validateSpec(spec, ctx)`: field-level issues (`path` = dotted field path, e.g. "fstop",
 *   "base.tstep", "tolerances.1.tol", "items.0.points").
 * - `analysisSummary(spec)`: one-line human summary; `analysisSummaryLines` a detailed list.
 * - `OPTION_FIELDS` / `validateOptions` / `optionsSummary`: SimOptions metadata for the
 *   "Analysis options" tab.
 * - `sweepValues`: value lists for parameter / temperature sweeps (linear, decade, octave).
 *
 * Numbers are SI base units; temperatures °C; tolerances are relative (0.05 = 5 %).
 */

import type {
  AnalysisSpec,
  AnalysisType,
  MeasureSpec,
  SimOptions,
  SweepType,
  ToleranceSpec,
} from '../../sim/netlist';
import { DEFAULT_OPTIONS } from '../../sim/netlist';
import { formatEng } from '../../util/units';
import { lazyRecord, t } from '../../i18n';
import { parseUserControls } from '../../sim/analyses/user';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type AnalysisGroup = 'basic' | 'small-signal' | 'sweep' | 'statistical' | 'other';

export interface AnalysisInfo {
  type: AnalysisType;
  title: string;
  group: AnalysisGroup;
  /** wraps a nested base analysis (or a list of items for batch) */
  meta: boolean;
  description: string;
}

function info(type: AnalysisType, group: AnalysisGroup, meta: boolean): AnalysisInfo {
  return {
    type,
    group,
    meta,
    get title() {
      return t(`analysis.title.${type}`);
    },
    get description() {
      return t(`analysis.desc.${type}`);
    },
  };
}

/** Every analysis with its group; title and description are read in the current language. */
export const ANALYSIS_CATALOG: readonly AnalysisInfo[] = [
  info('op', 'basic', false),
  info('ac', 'basic', false),
  info('tran', 'basic', false),
  info('dc', 'basic', false),
  info('acsingle', 'small-signal', false),
  info('noise', 'small-signal', false),
  info('noisefig', 'small-signal', false),
  info('disto', 'small-signal', false),
  info('tf', 'small-signal', false),
  info('sens', 'small-signal', false),
  info('pz', 'small-signal', false),
  info('four', 'other', false),
  info('paramsweep', 'sweep', true),
  info('tempsweep', 'sweep', true),
  info('nestedsweep', 'sweep', true),
  info('montecarlo', 'statistical', true),
  info('worstcase', 'statistical', true),
  info('tracewidth', 'other', true),
  info('batch', 'other', true),
  info('user', 'other', false),
];

export const GROUP_TITLES: Readonly<Record<AnalysisGroup, string>> = lazyRecord(['basic', 'small-signal', 'sweep', 'statistical', 'other'], (g) => t(`analysis.group.${g}`));

export function analysisInfo(type: AnalysisType): AnalysisInfo {
  return ANALYSIS_CATALOG.find((a) => a.type === type) ?? { type, title: type, group: 'other', meta: false, description: '' };
}

export const META_TYPES: ReadonlySet<AnalysisType> = new Set(ANALYSIS_CATALOG.filter((a) => a.meta).map((a) => a.type));

/** Analyses that can be nested as the `base` of a meta analysis (or a batch item). */
export const BASE_TYPES: readonly AnalysisType[] = ['op', 'dc', 'ac', 'acsingle', 'tran', 'noise', 'tf', 'sens', 'pz', 'four', 'disto', 'noisefig'];

export const SWEEP_TYPES: readonly SweepType[] = ['dec', 'oct', 'lin', 'list'];

export const MEASURE_FUNCS: readonly MeasureSpec['func'][] = ['max', 'min', 'avg', 'rms', 'pp', 'final', 'at', 'rise_edge', 'fall_edge', 'freq_at_max'];

export const MEASURE_LABELS: Readonly<Record<MeasureSpec['func'], string>> = lazyRecord(MEASURE_FUNCS, (f) => t(`analysis.measure.${f}`));

// ---------------------------------------------------------------------------
// Context and defaults
// ---------------------------------------------------------------------------

export interface AnalysisElementInfo {
  name: string;
  /** sweepable parameters besides "value" */
  params?: readonly string[];
  /** true when `name` is a model (model parameters are swept with `model: true`) */
  model?: boolean;
  /** SPICE element type letter ('R', 'C', 'V', ...) when known */
  type?: string;
  /**
   * false when "value" is not a parameter of the element (an independent source defined only by
   * its transient waveform): only `params` can be swept / toleranced. Default true.
   */
  hasValue?: boolean;
  /** nominal value of "value" when known */
  value?: number;
  /** element nodes (sources: [n+, n-]) */
  nodes?: readonly string[];
  /** independent source that carries a signal (AC magnitude or transient waveform), not a supply */
  signal?: boolean;
  /** relative tolerance of "value" set on the part (0.05 = 5 %) */
  tol?: number;
}

/** Parameter names the forms offer for an element (or model): "value" first when it has one. */
export function elementParamChoices(info: AnalysisElementInfo | undefined, model = false): string[] {
  const params = [...(info?.params ?? [])];
  if (model) return params;
  return info?.hasValue === false ? params : ['value', ...params.filter((p) => p.toLowerCase() !== 'value')];
}

/**
 * Parameter to keep when a sweep / tolerance row is pointed at the element (or model) `info`:
 * `param` itself when the new target offers it, or when nothing is known about the target's
 * parameters; otherwise the first parameter the target offers (e.g. "value" -> "vo" for a
 * source defined only by its waveform).
 */
export function paramForTarget(info: AnalysisElementInfo | undefined, param: string, model = false): string {
  if (!info || (info.params === undefined && info.hasValue === undefined)) return param;
  const choices = elementParamChoices(info, model);
  const key = param.trim().toLowerCase();
  if (choices.length === 0 || choices.some((c) => c.toLowerCase() === key)) return param;
  return choices[0];
}

export interface SpecContext {
  /** output expressions, e.g. "V(out)", "I(V1)" */
  outputs?: readonly string[];
  /** independent source names (V..., I...) */
  sources?: readonly string[];
  /** components and models that can be swept or toleranced */
  elements?: readonly (string | AnalysisElementInfo)[];
  /** global parameters (design variables, `.param`s) a Parameter sweep may step */
  variables?: readonly string[];
}

export function normalizeElements(list: SpecContext['elements']): AnalysisElementInfo[] {
  return (list ?? []).map((e) => (typeof e === 'string' ? { name: e } : e));
}

/** Node names referenced by V(...) outputs ("V(out)" -> "out"; "V(a,b)" -> "a", "b"). */
export function nodesFromOutputs(outputs: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const o of outputs ?? []) {
    const m = /^\s*v\s*\(([^)]*)\)\s*$/i.exec(o);
    if (!m) continue;
    for (const n of m[1].split(',')) {
      const t = n.trim();
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out;
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const isGroundName = (n: string): boolean => /^(0|gnd)$/i.test(n.trim());
/** Supply rails emitted by power symbols (VCC, VDD, ... -> V_PWR_VCC). */
const RAIL_SOURCE = /^V_PWR_/i;
/** Element types whose "value" is a plain component value (good sweep / tolerance targets). */
const VALUE_TYPES = new Set(['R', 'C', 'L']);

function elementInfo(ctx: SpecContext, name: string): AnalysisElementInfo | undefined {
  return normalizeElements(ctx.elements).find((e) => !e.model && sameName(e.name, name));
}

/**
 * Source that default analyses drive: the first source carrying a signal (AC magnitude or
 * transient waveform) that is not a supply rail, else the first non-rail source, else the first.
 */
export function defaultSignalSource(ctx: SpecContext): string {
  const sources = ctx.sources ?? [];
  const signal = (s: string) => elementInfo(ctx, s)?.signal === true;
  return sources.find((s) => !RAIL_SOURCE.test(s) && signal(s)) ?? sources.find((s) => !RAIL_SOURCE.test(s)) ?? sources[0] ?? 'V1';
}

/** The non-ground node a source drives (its + node, or its − node when + is ground). */
function drivenNode(ctx: SpecContext, source: string): string | undefined {
  const nodes = elementInfo(ctx, source)?.nodes ?? [];
  return nodes.slice(0, 2).find((n) => !isGroundName(n));
}

/**
 * Default output expression: V(OUT) when the circuit has such a net, else a node voltage whose
 * name contains "out", else the first node voltage that is neither the input node nor a supply
 * rail, else the first output.
 */
export function defaultOutput(ctx: SpecContext, input?: string): string {
  const volts = (ctx.outputs ?? []).filter((o) => /^\s*v\s*\(/i.test(o));
  const nodeOf = (o: string) => nodesFromOutputs([o]);
  const rails = (ctx.sources ?? []).filter((s) => RAIL_SOURCE.test(s)).map((s) => drivenNode(ctx, s)).filter((n): n is string => !!n);
  const plain = volts.filter((o) => nodeOf(o).length === 1);
  return (
    plain.find((o) => sameName(nodeOf(o)[0], 'out')) ??
    plain.find((o) => /out/i.test(nodeOf(o)[0]) && !(input && sameName(nodeOf(o)[0], input))) ??
    plain.find((o) => !(input && sameName(nodeOf(o)[0], input)) && !rails.some((r) => sameName(r, nodeOf(o)[0]))) ??
    volts[0] ??
    ctx.outputs?.[0] ??
    'V(out)'
  );
}

/** Components to sweep / tolerance by default: R, C, L with a positive value first. */
function valueTargets(ctx: SpecContext): AnalysisElementInfo[] {
  const all = normalizeElements(ctx.elements).filter((e) => !e.model && e.hasValue !== false);
  const typeOf = (e: AnalysisElementInfo) => (e.type ?? e.name.charAt(0)).toUpperCase();
  const good = all.filter((e) => VALUE_TYPES.has(typeOf(e)) && (e.value === undefined || (Number.isFinite(e.value) && e.value > 0)));
  return [...good, ...all.filter((e) => !good.includes(e))];
}

/** Values around a nominal: k·nominal for each factor, or `fallback` when the nominal is unknown. */
function around(nominal: number | undefined, factors: number[], fallback: number[]): number[] {
  if (nominal === undefined || !Number.isFinite(nominal) || nominal === 0) return fallback;
  return factors.map((k) => Number((k * nominal).toPrecision(12)));
}

/**
 * A valid starting spec for `type`, chosen from the circuit when the context describes it: the
 * signal source (not a supply rail), V(OUT) or another node that is not the input, and R / C / L
 * components (with their part tolerances) for sweeps, Monte Carlo and worst case.
 */
export function defaultSpec(type: AnalysisType, ctx: SpecContext = {}): AnalysisSpec {
  const src = defaultSignalSource(ctx);
  const input = drivenNode(ctx, src) ?? nodesFromOutputs(ctx.outputs)[0];
  const out = defaultOutput(ctx, input);
  const node = nodesFromOutputs([out])[0] ?? 'out';
  const targets = valueTargets(ctx);
  const first = targets[0];
  const second = targets[1] ?? first;
  const el = first?.name ?? 'R1';
  const toleranced = targets.filter((e) => e.tol !== undefined && e.tol > 0 && e.tol < 1);
  const tolerances: ToleranceSpec[] = toleranced.length
    ? toleranced.map((e) => ({ target: e.name, param: 'value', tol: e.tol as number, dist: 'uniform' }))
    : [{ target: el, param: 'value', tol: 0.05, dist: 'uniform' }];
  let pzOut = node;
  if (input && sameName(pzOut, input)) {
    const other = nodesFromOutputs(ctx.outputs).find((n) => !sameName(n, input) && !isGroundName(n));
    if (other) pzOut = other;
  }
  switch (type) {
    case 'op':
      return { type: 'op' };
    case 'dc':
      // a DC sweep may as well sweep a supply: the first source of the circuit
      return { type: 'dc', src: ctx.sources?.[0] ?? src, start: 0, stop: 1, step: 0.1 };
    case 'ac':
      return { type: 'ac', sweep: 'dec', points: 10, fstart: 1, fstop: 10e9 };
    case 'acsingle':
      return { type: 'acsingle', freq: 1e3 };
    case 'tran':
      return { type: 'tran', tstep: 1e-5, tstop: 1e-3, tstart: 0 };
    case 'noise':
      return { type: 'noise', output: node, ref: '0', src, sweep: 'dec', points: 10, fstart: 1, fstop: 10e9 };
    case 'tf':
      return { type: 'tf', output: out, src };
    case 'sens':
      return { type: 'sens', output: out };
    case 'pz':
      return { type: 'pz', inPos: input ?? 'in', inNeg: '0', outPos: pzOut, outNeg: '0', transfer: 'vol', find: 'pz' };
    case 'four':
      return { type: 'four', fundamental: 1e3, harmonics: 9, outputs: [out], settleCycles: 5, samples: 256 };
    case 'disto':
      return { type: 'disto', sweep: 'dec', points: 10, fstart: 1, fstop: 10e9 };
    case 'noisefig':
      return { type: 'noisefig', output: node, ref: '0', src, rsource: 50, freq: 1e3 };
    case 'paramsweep':
      return { type: 'paramsweep', target: el, param: 'value', values: around(first?.value, [0.5, 1, 2], [1e3, 2e3, 5e3]), base: { type: 'op' } };
    case 'tempsweep':
      return { type: 'tempsweep', temps: [0, 27, 100], base: { type: 'op' } };
    case 'montecarlo':
      return { type: 'montecarlo', runs: 10, seed: 1, tolerances, base: { type: 'op' } };
    case 'worstcase':
      return {
        type: 'worstcase',
        tolerances,
        base: { type: 'op' },
        measure: { output: out, func: 'max' },
        direction: 'high',
      };
    case 'nestedsweep':
      return {
        type: 'nestedsweep',
        outer: { target: el, param: 'value', values: around(first?.value, [1, 2], [1e3, 2e3]) },
        inner: { target: second?.name ?? el, param: 'value', values: around(second?.value, [0.5, 1, 2], [1e3, 2e3, 5e3]) },
        base: { type: 'op' },
      };
    case 'tracewidth':
      return { type: 'tracewidth', base: { type: 'tran', tstep: 1e-5, tstop: 1e-3, tstart: 0 }, tempRise: 10, copperOz: 1, external: true };
    case 'batch':
      return { type: 'batch', items: [{ type: 'op' }] };
    case 'user':
      return { type: 'user', text: t('analysis.user.defaultText') };
  }
}

// ---------------------------------------------------------------------------
// Number text
// ---------------------------------------------------------------------------

const USER_PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'u'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

/**
 * Text for a number in the user syntax of parseUserNumber (M = mega, m = milli, u = micro):
 * 1500 -> "1.5k", 2e-6 -> "2u", 1e7 -> "10M". Up to 9 significant digits are kept, so the text
 * parses back to the same value for typical inputs.
 */
export function toUserText(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e15 || a < 1e-15) return String(Number(v.toPrecision(9)));
  for (const [mul, suf] of USER_PREFIXES) {
    if (a >= mul * 0.9999999995) return `${Number((v / mul).toPrecision(9))}${suf}`;
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

/**
 * Value list for a sweep from `start` to `stop`:
 *   lin: `points` values including both ends
 *   dec / oct: `points` per decade / octave starting at `start`, ending at the last value <= stop
 *   (start, stop > 0); values are rounded to 12 significant digits.
 */
export function sweepValues(start: number, stop: number, points: number, kind: 'lin' | 'dec' | 'oct'): number[] {
  const round = (v: number) => Number(v.toPrecision(12));
  const n = Math.max(1, Math.floor(points));
  if (kind === 'lin') {
    if (n === 1) return [round(start)];
    return Array.from({ length: n }, (_, i) => round(start + ((stop - start) * i) / (n - 1)));
  }
  if (!(start > 0) || !(stop > 0)) return [];
  const ratio = kind === 'dec' ? 10 : 2;
  const count = Math.floor((Math.log(stop / start) / Math.log(ratio)) * n + 1e-9);
  const out: number[] = [];
  for (let i = 0; i <= Math.min(count, 100000); i++) out.push(round(start * ratio ** (i / n)));
  return out;
}

/** Number of points of a DC sweep (start..stop by step, inclusive), NaN for an invalid step. */
export function dcPointCount(start: number, stop: number, step: number): number {
  if (!(step !== 0) || !Number.isFinite(step)) return Number.NaN;
  const n = (stop - start) / step;
  if (n < -1e-9) return Number.NaN;
  return Math.floor(n + 1e-9) + 1;
}

/** Number of frequency points of an AC-style sweep. */
export function frequencyPointCount(sweep: SweepType, points: number, fstart: number, fstop: number, list?: readonly number[]): number {
  switch (sweep) {
    case 'list':
      return list?.length ?? 0;
    case 'lin':
      return Math.max(0, Math.floor(points));
    case 'dec':
    case 'oct':
      if (!(fstart > 0) || !(fstop >= fstart)) return Number.NaN;
      return Math.floor((Math.log(fstop / fstart) / Math.log(sweep === 'dec' ? 10 : 2)) * points + 1e-9) + 1;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SpecIssue {
  /** dotted field path relative to the validated spec ("" for the spec as a whole) */
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

const OUTPUT_RE = /^\s*(v[a-z]*\s*\(\s*[^()]+?\s*(,\s*[^()]+?\s*)?\)|i[a-z]*\s*\(\s*[^(),]+?\s*\))\s*$/i;

/** Is `text` an output reference such as V(out), V(a,b), I(V1), Ic(Q1)? */
export function isOutputExpression(text: string): boolean {
  return OUTPUT_RE.test(text);
}

class Issues {
  readonly list: SpecIssue[] = [];
  constructor(private readonly prefix: string) {}
  private p(path: string): string {
    return this.prefix ? (path ? `${this.prefix}.${path}` : this.prefix) : path;
  }
  error(path: string, message: string): void {
    this.list.push({ path: this.p(path), message, severity: 'error' });
  }
  warn(path: string, message: string): void {
    this.list.push({ path: this.p(path), message, severity: 'warning' });
  }
  finite(path: string, v: number, label: string): boolean {
    if (!Number.isFinite(v)) {
      this.error(path, t('analysis.specs.labelMustBeANumber', { label: label }));
      return false;
    }
    return true;
  }
  positive(path: string, v: number, label: string): boolean {
    if (!this.finite(path, v, label)) return false;
    if (!(v > 0)) {
      this.error(path, t('analysis.specs.labelMustBeGreaterThan', { label: label }));
      return false;
    }
    return true;
  }
  integer(path: string, v: number, label: string, min: number, max: number): boolean {
    if (!Number.isInteger(v) || v < min || v > max) {
      this.error(path, t('analysis.specs.labelMustBeAWhole', { label: label, min: min, max: max }));
      return false;
    }
    return true;
  }
  required(path: string, text: string | undefined, label: string): boolean {
    if (!text || !text.trim()) {
      this.error(path, t('analysis.specs.labelIsRequired', { label: label }));
      return false;
    }
    return true;
  }
  merge(other: SpecIssue[]): void {
    for (const i of other) this.list.push({ ...i, path: this.p(i.path) });
  }
}

function lowerSet(list: readonly string[] | undefined): Set<string> | null {
  return list && list.length ? new Set(list.map((s) => s.trim().toLowerCase())) : null;
}

function checkSource(is: Issues, path: string, src: string, ctx: SpecContext, allowTemp = false): void {
  if (!is.required(path, src, t('common.source'))) return;
  if (allowTemp && src.trim().toLowerCase() === 'temp') return;
  const known = lowerSet(ctx.sources);
  if (known && !known.has(src.trim().toLowerCase())) is.error(path, t('analysis.specs.unknownSourceSrc', { src: src }));
}

function checkOutput(is: Issues, path: string, out: string, ctx: SpecContext, label = t('common.output')): void {
  if (!is.required(path, out, label)) return;
  if (!isOutputExpression(out)) {
    is.error(path, t('analysis.specs.labelMustLookLikeV', { label: label }));
    return;
  }
  const known = lowerSet(ctx.outputs);
  const norm = out.replace(/\s+/g, '').toLowerCase();
  if (known && !known.has(norm) && !known.has(out.trim().toLowerCase()) && !/^v\([^,]+,[^)]+\)$/.test(norm)) {
    is.warn(path, t('analysis.specs.outIsNotAmongThe', { out: out }));
  }
}

function checkNode(is: Issues, path: string, node: string, ctx: SpecContext, label: string): void {
  if (!is.required(path, node, label)) return;
  const nodes = nodesFromOutputs(ctx.outputs).map((n) => n.toLowerCase());
  const n = node.trim().toLowerCase();
  if (nodes.length && n !== '0' && n !== 'gnd' && !nodes.includes(n)) is.warn(path, t('analysis.specs.nodeNodeWasNotFound', { node: node }));
}

function checkFrequencySweep(is: Issues, s: { sweep: SweepType; points: number; fstart: number; fstop: number; list?: number[] }): void {
  if (!SWEEP_TYPES.includes(s.sweep)) is.error('sweep', t('analysis.specs.unknownSweepType'));
  if (s.sweep === 'list') {
    if (!s.list || !s.list.length) is.error('list', t('analysis.specs.enterAtLeastOneFrequency'));
    else if (s.list.some((f) => !(f > 0) || !Number.isFinite(f))) is.error('list', t('analysis.specs.frequenciesMustBeGreaterThan'));
    return;
  }
  is.integer('points', s.points, s.sweep === 'lin' ? t('analysis.specs.numberOfPoints') : s.sweep === 'dec' ? t('analysis.specs.pointsPerDecade') : t('analysis.specs.pointsPerOctave'), 1, 1000000);
  let startOk: boolean;
  if (s.sweep === 'lin') {
    startOk = is.finite('fstart', s.fstart, t('analysis.specs.startFrequency'));
    if (startOk && s.fstart < 0) {
      is.error('fstart', t('analysis.specs.startFrequencyMustNotBe'));
      startOk = false;
    }
  } else startOk = is.positive('fstart', s.fstart, t('analysis.specs.startFrequency'));
  const stopOk = is.positive('fstop', s.fstop, t('analysis.specs.stopFrequency'));
  if (startOk && stopOk && !(s.fstop >= s.fstart)) is.error('fstop', t('analysis.specs.stopFrequencyMustNotBe'));
  const n = frequencyPointCount(s.sweep, s.points, s.fstart, s.fstop);
  if (n > 100000) is.warn('points', t('analysis.specs.roundFrequencyPointsWillBe', { round: Math.round(n) }));
}

function checkValues(is: Issues, path: string, values: readonly number[], label: string): void {
  if (!values.length) is.error(path, t('analysis.specs.enterAtLeastOneLabel', { label: label }));
  else if (values.some((v) => !Number.isFinite(v))) is.error(path, t('analysis.specs.everyLabelMustBeA', { label: label }));
  else if (values.length > 10000) is.warn(path, t('analysis.specs.lengthRunsWillBeSlow', { length: values.length }));
}

/**
 * The parameter of a known element / model is one the analysis can change: "value" for elements
 * that have one, or one of the listed parameters. Elements without parameter information (plain
 * names in the context) are not checked.
 */
function checkTargetParam(is: Issues, path: string, tg: { target: string; param: string; model?: boolean }, ctx: SpecContext): void {
  const param = tg.param.trim();
  if (!param) return;
  const info = normalizeElements(ctx.elements).find((e) => !!e.model === !!tg.model && sameName(e.name, tg.target));
  if (!info || (info.params === undefined && info.hasValue === undefined)) return;
  const choices = elementParamChoices(info, !!tg.model);
  if (choices.some((c) => sameName(c, param))) return;
  const offer = choices.length ? t('analysis.specs.chooseOneOf', { list: `${choices.slice(0, 8).join(', ')}${choices.length > 8 ? ', …' : ''}` }) : '';
  is.error(path, t('analysis.specs.paramIsNotAParameter', { param: param, target: tg.target, offer: offer }));
}

function checkTolerances(is: Issues, tols: readonly ToleranceSpec[], ctx: SpecContext, required: boolean): void {
  if (required && !tols.length) is.error('tolerances', t('analysis.specs.addAtLeastOneTolerance'));
  const els = normalizeElements(ctx.elements);
  tols.forEach((tg, i) => {
    const p = `tolerances.${i}`;
    if (is.required(`${p}.target`, tg.target, t('analysis.specs.component'))) {
      const known = els.filter((e) => !!e.model === !!tg.model).map((e) => e.name.toLowerCase());
      if (known.length && !known.includes(tg.target.trim().toLowerCase())) is.error(`${p}.target`, tg.model ? t('analysis.specs.unknownModel', { target: tg.target }) : t('analysis.specs.unknownComponent', { target: tg.target }));
    }
    if (is.required(`${p}.param`, tg.param, t('common.parameter'))) checkTargetParam(is, `${p}.param`, tg, ctx);
    if (is.finite(`${p}.tol`, tg.tol, t('analysis.specs.tolerance'))) {
      if (!(tg.tol > 0) || !(tg.tol < 1)) is.error(`${p}.tol`, t('analysis.specs.toleranceMustBeBetween0'));
      else if (tg.tol >= 0.5) is.warn(`${p}.tol`, t('analysis.specs.tolerancesOf50OrMore'));
    }
    if (tg.dist !== 'uniform' && tg.dist !== 'gaussian') is.error(`${p}.dist`, t('analysis.specs.distributionMustBeUniformOr'));
  });
}

function checkMeasure(is: Issues, path: string, m: MeasureSpec, ctx: SpecContext): void {
  checkOutput(is, `${path}.output`, m.output, ctx);
  if (!MEASURE_FUNCS.includes(m.func)) is.error(`${path}.func`, t('analysis.specs.unknownMeasurementFunction'));
  if (m.func === 'at' && !Number.isFinite(m.at ?? Number.NaN)) is.error(`${path}.at`, t('analysis.specs.enterTheXValueTo'));
  if ((m.func === 'rise_edge' || m.func === 'fall_edge') && !Number.isFinite(m.threshold ?? Number.NaN)) is.error(`${path}.threshold`, t('analysis.specs.enterTheCrossingThreshold'));
}

function checkSweepTarget(is: Issues, path: string, tg: { target: string; param: string; model?: boolean; global?: boolean; values: number[] }, ctx: SpecContext): void {
  if (tg.global) {
    // a global parameter (design variable): stepped by rebuilding the circuit for every value
    if (is.required(`${path}target`, tg.target, t('analysis.specs.globalParameter')) && ctx.variables?.length && !ctx.variables.some((v) => v.toLowerCase() === tg.target.trim().toLowerCase())) {
      is.error(`${path}target`, t('analysis.specs.unknownGlobalParameter', { target: tg.target }));
    }
    checkValues(is, `${path}values`, tg.values, 'value');
    return;
  }
  if (is.required(`${path}target`, tg.target, tg.model ? t('analysis.specs.model') : t('analysis.specs.component'))) {
    const els = normalizeElements(ctx.elements).filter((e) => !!e.model === !!tg.model);
    if (els.length && !els.some((e) => e.name.toLowerCase() === tg.target.trim().toLowerCase())) is.error(`${path}target`, tg.model ? t('analysis.specs.unknownModel', { target: tg.target }) : t('analysis.specs.unknownComponent', { target: tg.target }));
  }
  if (is.required(`${path}param`, tg.param, t('common.parameter'))) checkTargetParam(is, `${path}param`, tg, ctx);
  checkValues(is, `${path}values`, tg.values, 'value');
}

function checkBase(is: Issues, base: AnalysisSpec | undefined, ctx: SpecContext): void {
  if (!base) {
    is.error('base', t('analysis.specs.chooseTheAnalysisToRepeat'));
    return;
  }
  if (META_TYPES.has(base.type)) {
    is.error('base', t('analysis.specs.titleCannotBeNestedHere', { title: analysisInfo(base.type).title }));
    return;
  }
  is.merge(validateSpec(base, ctx).map((i) => ({ ...i, path: i.path ? `base.${i.path}` : 'base' })));
}

/** Validate a spec. Paths are relative to `spec`; errors block running, warnings do not. */
export function validateSpec(spec: AnalysisSpec, ctx: SpecContext = {}): SpecIssue[] {
  const is = new Issues('');
  switch (spec.type) {
    case 'op':
      break;
    case 'user': {
      const c = parseUserControls(spec.text ?? '');
      for (const e of c.errors) is.error('text', e);
      if (!c.errors.length && !c.analyses.length) is.error('text', t('analysis.user.errNoCard'));
      for (const w of c.warnings) is.warn('text', w);
      break;
    }
    case 'dc': {
      checkSource(is, 'src', spec.src, ctx, true);
      const ok = is.finite('start', spec.start, t('analysis.specs.startValue')) && is.finite('stop', spec.stop, t('analysis.specs.stopValue')) && is.finite('step', spec.step, t('common.increment'));
      if (ok) {
        const n = dcPointCount(spec.start, spec.stop, spec.step);
        if (spec.step === 0) is.error('step', t('analysis.specs.incrementMustNotBe0'));
        else if (Number.isNaN(n)) is.error('step', t('analysis.specs.incrementHasTheWrongSign'));
        else if (n > 1000000) is.error('step', t('analysis.specs.nPointsIsTooMany', { n: n }));
        else if (n > 100000) is.warn('step', t('analysis.specs.nPointsWillBeSlow', { n: n }));
      }
      if (spec.src2) {
        checkSource(is, 'src2.src', spec.src2.src, ctx, true);
        if (spec.src2.src.trim().toLowerCase() === spec.src.trim().toLowerCase()) is.error('src2.src', t('analysis.specs.theSecondSourceMustDiffer'));
        const ok2 = is.finite('src2.start', spec.src2.start, t('analysis.specs.startValue')) && is.finite('src2.stop', spec.src2.stop, t('analysis.specs.stopValue')) && is.finite('src2.step', spec.src2.step, t('common.increment'));
        if (ok2) {
          const n2 = dcPointCount(spec.src2.start, spec.src2.stop, spec.src2.step);
          if (spec.src2.step === 0) is.error('src2.step', t('analysis.specs.incrementMustNotBe0'));
          else if (Number.isNaN(n2)) is.error('src2.step', t('analysis.specs.incrementHasTheWrongSign'));
          else if (n2 > 1000) is.warn('src2.step', t('analysis.specs.n2CurvesWillBeSlow', { n2: n2 }));
        }
      }
      break;
    }
    case 'ac':
      checkFrequencySweep(is, spec);
      break;
    case 'acsingle':
      is.positive('freq', spec.freq, t('common.frequency'));
      break;
    case 'tran': {
      const stepOk = is.positive('tstep', spec.tstep, t('analysis.specs.timeStep'));
      const stopOk = is.positive('tstop', spec.tstop, t('analysis.specs.endTime'));
      const tstart = spec.tstart ?? 0;
      if (is.finite('tstart', tstart, t('analysis.specs.startTime'))) {
        if (tstart < 0) is.error('tstart', t('analysis.specs.startTimeMustNotBe'));
        else if (stopOk && !(tstart < spec.tstop)) is.error('tstart', t('analysis.specs.startTimeMustBeBefore'));
      }
      if (spec.tmax !== undefined) is.positive('tmax', spec.tmax, t('analysis.specs.maximumTimeStep'));
      if (stepOk && stopOk) {
        if (spec.tstep > spec.tstop) is.error('tstep', t('analysis.specs.timeStepMustNotExceed'));
        else if ((spec.tstop - tstart) / spec.tstep > 1e7) is.warn('tstep', t('analysis.specs.moreThan10MillionTime'));
      }
      break;
    }
    case 'noise':
      checkNode(is, 'output', spec.output, ctx, t('analysis.specs.outputNode'));
      if (spec.ref !== undefined && spec.ref.trim() && spec.ref.trim().toLowerCase() === spec.output.trim().toLowerCase()) is.error('ref', t('analysis.specs.referenceNodeMustDifferFrom'));
      checkSource(is, 'src', spec.src, ctx);
      checkFrequencySweep(is, spec);
      break;
    case 'tf':
      checkOutput(is, 'output', spec.output, ctx);
      checkSource(is, 'src', spec.src, ctx);
      break;
    case 'sens':
      checkOutput(is, 'output', spec.output, ctx);
      if (spec.ac) {
        const sub = new Issues('ac');
        checkFrequencySweep(sub, spec.ac);
        is.merge(sub.list);
      }
      break;
    case 'pz':
      checkNode(is, 'inPos', spec.inPos, ctx, t('analysis.specs.inputNode'));
      checkNode(is, 'inNeg', spec.inNeg, ctx, t('analysis.specs.inputNode2'));
      checkNode(is, 'outPos', spec.outPos, ctx, t('analysis.specs.outputNode2'));
      checkNode(is, 'outNeg', spec.outNeg, ctx, t('analysis.specs.outputNode3'));
      if (spec.inPos.trim() && spec.inPos.trim().toLowerCase() === spec.inNeg.trim().toLowerCase()) is.error('inNeg', t('analysis.specs.inputNodesMustDiffer'));
      if (spec.outPos.trim() && spec.outPos.trim().toLowerCase() === spec.outNeg.trim().toLowerCase()) is.error('outNeg', t('analysis.specs.outputNodesMustDiffer'));
      if (spec.transfer === 'vol' && spec.inPos.trim() && sameName(spec.inPos, spec.outPos) && sameName(spec.inNeg, spec.outNeg)) {
        is.warn('outPos', t('analysis.specs.outputAndInputAreThe'));
      }
      if (spec.transfer !== 'vol' && spec.transfer !== 'cur') is.error('transfer', t('analysis.specs.unknownTransferType'));
      if (!['pol', 'zer', 'pz'].includes(spec.find)) is.error('find', t('analysis.specs.unknownSelection'));
      break;
    case 'four': {
      is.positive('fundamental', spec.fundamental, t('analysis.specs.fundamentalFrequency'));
      const hOk = is.integer('harmonics', spec.harmonics, t('analysis.specs.numberOfHarmonics'), 1, 100);
      if (!spec.outputs.length) is.error('outputs', t('analysis.specs.selectAtLeastOneOutput'));
      spec.outputs.forEach((o, i) => checkOutput(is, `outputs.${i}`, o, ctx));
      if (spec.settleCycles !== undefined && is.finite('settleCycles', spec.settleCycles, t('analysis.specs.settlingCycles')) && (spec.settleCycles < 0 || spec.settleCycles > 10000)) {
        is.error('settleCycles', t('analysis.specs.settlingCyclesMustBe0'));
      }
      if (spec.tstep !== undefined) is.positive('tstep', spec.tstep, t('analysis.specs.timeStep'));
      if (spec.samples !== undefined && is.integer('samples', spec.samples, t('analysis.specs.samplesPerPeriod'), 4, 1 << 20) && hOk && spec.samples < 2 * spec.harmonics + 2) {
        is.error('samples', t('analysis.specs.needAtLeastValueSamples', { value: 2 * spec.harmonics + 2, harmonics: spec.harmonics }));
      }
      break;
    }
    case 'disto':
      checkFrequencySweep(is, spec);
      if (spec.f2overf1 !== undefined && is.finite('f2overf1', spec.f2overf1, 'F2/F1 ratio') && !(spec.f2overf1 > 0 && spec.f2overf1 < 1)) {
        is.error('f2overf1', t('analysis.specs.f2F1MustBeBetween'));
      }
      break;
    case 'noisefig':
      checkNode(is, 'output', spec.output, ctx, t('analysis.specs.outputNode'));
      checkSource(is, 'src', spec.src, ctx);
      is.positive('rsource', spec.rsource, t('analysis.specs.sourceResistance'));
      is.positive('freq', spec.freq, t('common.frequency'));
      break;
    case 'paramsweep':
      checkSweepTarget(is, '', spec, ctx);
      checkBase(is, spec.base, ctx);
      break;
    case 'tempsweep':
      checkValues(is, 'temps', spec.temps, 'temperature');
      if (spec.temps.some((t) => t < -273.15)) is.error('temps', t('analysis.specs.temperaturesMustBeAbove273'));
      checkBase(is, spec.base, ctx);
      break;
    case 'montecarlo':
      is.integer('runs', spec.runs, t('analysis.specs.numberOfRuns'), 1, 100000);
      is.integer('seed', spec.seed, t('analysis.specs.seed'), 0, 2147483647);
      checkTolerances(is, spec.tolerances, ctx, true);
      if (spec.measure) checkMeasure(is, 'measure', spec.measure, ctx);
      checkBase(is, spec.base, ctx);
      break;
    case 'worstcase':
      checkTolerances(is, spec.tolerances, ctx, true);
      checkMeasure(is, 'measure', spec.measure, ctx);
      if (spec.direction !== 'high' && spec.direction !== 'low') is.error('direction', t('analysis.specs.directionMustBeHighOr'));
      checkBase(is, spec.base, ctx);
      break;
    case 'nestedsweep':
      checkSweepTarget(is, 'outer.', spec.outer, ctx);
      checkSweepTarget(is, 'inner.', spec.inner, ctx);
      if (spec.outer.values.length * spec.inner.values.length > 10000) is.warn('inner.values', t('analysis.specs.valueRunsWillBeSlow', { value: spec.outer.values.length * spec.inner.values.length }));
      checkBase(is, spec.base, ctx);
      break;
    case 'tracewidth':
      if (!spec.base || spec.base.type !== 'tran') is.error('base', t('analysis.specs.traceWidthNeedsATransient'));
      else is.merge(validateSpec(spec.base, ctx).map((i) => ({ ...i, path: i.path ? `base.${i.path}` : 'base' })));
      is.positive('tempRise', spec.tempRise, t('analysis.specs.temperatureRise'));
      is.positive('copperOz', spec.copperOz, t('analysis.specs.copperWeight'));
      break;
    case 'batch':
      if (!spec.items.length) is.error('items', t('analysis.specs.addAtLeastOneAnalysis'));
      spec.items.forEach((item, i) => {
        if (item.type === 'batch') is.error(`items.${i}`, t('analysis.specs.aBatchCannotContainAnother'));
        else is.merge(validateSpec(item, ctx).map((x) => ({ ...x, path: x.path ? `items.${i}.${x.path}` : `items.${i}` })));
      });
      break;
  }
  return is.list;
}

export function hasErrors(issues: readonly SpecIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Issues at exactly `path` (for field-level messages). */
export function issuesAt(issues: readonly SpecIssue[], path: string): SpecIssue[] {
  return issues.filter((i) => i.path === path);
}

/** Issues under `prefix` with the prefix removed (for nested editors). */
export function issuesUnder(issues: readonly SpecIssue[], prefix: string): SpecIssue[] {
  const p = `${prefix}.`;
  return issues.filter((i) => i.path.startsWith(p)).map((i) => ({ ...i, path: i.path.slice(p.length) }));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Unit of a swept quantity: element value units by SPICE letter, V / A for sources. */
export function sweepUnit(target: string, param: string, model = false): string {
  if (model) return '';
  const p = param.trim().toLowerCase();
  const letter = target.trim().charAt(0).toUpperCase();
  if (p === 'value' || p === 'dc') {
    const units: Record<string, string> = { R: 'Ω', C: 'F', L: 'H', V: 'V', I: 'A', E: '', F: '', G: 'S', H: 'Ω', K: '' };
    return units[letter] ?? '';
  }
  if (p === 'temp') return '°C';
  if (p === 'w' || p === 'l') return 'm';
  return '';
}

function eng(v: number, unit = ''): string {
  return formatEng(v, unit, 4);
}

function listText(values: readonly number[], unit: string): string {
  if (!values.length) return t('analysis.specs.noValues');
  if (values.length <= 5) return values.map((v) => eng(v, unit)).join(', ');
  return t('analysis.specs.valuesRange', { n: values.length, first: eng(values[0], unit), last: eng(values[values.length - 1], unit) });
}

/** Unit of a DC-sweep source: A for current sources (I...), °C for 'temp', else V. */
export function sourceUnit(src: string): string {
  const s = src.trim().toLowerCase();
  if (s === 'temp') return '°C';
  return s.startsWith('i') ? 'A' : 'V';
}

function frequencyText(s: { sweep: SweepType; points: number; fstart: number; fstop: number; list?: number[] }): string {
  if (s.sweep === 'list') return t('analysis.specs.frequencyList', { n: s.list?.length ?? 0, list: listText(s.list ?? [], 'Hz') });
  const kind = s.sweep === 'dec' ? t('analysis.specs.sweepDecade', { n: s.points }) : s.sweep === 'oct' ? t('analysis.specs.sweepOctave', { n: s.points }) : t('analysis.specs.sweepLinear', { n: s.points });
  return `${eng(s.fstart, 'Hz')} → ${eng(s.fstop, 'Hz')}, ${kind}`;
}

/** Text of a measurement, e.g. "maximum of V(out)", "V(out) at x = 1 m". */
export function measureText(m: MeasureSpec): string {
  if (m.func === 'at') return t('analysis.specs.measureAt', { output: m.output, x: eng(m.at ?? Number.NaN) });
  if (m.func === 'rise_edge' || m.func === 'fall_edge') return t('analysis.specs.measureCrossing', { what: MEASURE_LABELS[m.func].toLowerCase(), output: m.output, threshold: eng(m.threshold ?? Number.NaN) });
  return t('analysis.specs.measureOf', { what: MEASURE_LABELS[m.func]?.toLowerCase() ?? m.func, output: m.output });
}

/** The nested analysis a meta analysis repeats (undefined for others). */
function baseOf(spec: AnalysisSpec): AnalysisSpec | undefined {
  return 'base' in spec ? spec.base : undefined;
}

/** One-line human summary of an analysis spec (meta analyses end with "× [base summary]"). */
export function analysisSummary(spec: AnalysisSpec): string {
  const base = baseOf(spec);
  return base ? `${analysisHeadline(spec)} × [${analysisSummary(base)}]` : analysisHeadline(spec);
}

/** Summary without the nested base analysis. */
export function analysisHeadline(spec: AnalysisSpec): string {
  switch (spec.type) {
    case 'user': {
      const cards = parseUserControls(spec.text ?? '').cards.filter((c) => c);
      return cards.length ? t('analysis.specs.userHeadline', { n: cards.length, first: cards[0] }) : t('analysis.user.errNoCard');
    }
    case 'op':
      return t('analysis.specs.dcOperatingPoint');
    case 'dc': {
      const u = sourceUnit(spec.src);
      const n = dcPointCount(spec.start, spec.stop, spec.step);
      let s = t('analysis.specs.dcSweepOf', { src: spec.src, start: eng(spec.start, u), stop: eng(spec.stop, u), step: eng(spec.step, u) }) + (Number.isFinite(n) ? t('analysis.specs.pointsSuffix', { n }) : '');
      if (spec.src2) {
        const u2 = sourceUnit(spec.src2.src);
        const n2 = dcPointCount(spec.src2.start, spec.src2.stop, spec.src2.step);
        s += t('analysis.specs.dcNested', { src: spec.src2.src, start: eng(spec.src2.start, u2), stop: eng(spec.src2.stop, u2), step: eng(spec.src2.step, u2) }) + (Number.isFinite(n2) ? t('analysis.specs.curvesSuffix', { n: n2 }) : '');
      }
      return s;
    }
    case 'ac':
      return t('analysis.specs.acSweepFrequencytext', { frequencyText: frequencyText(spec) });
    case 'acsingle':
      return t('analysis.specs.singleFrequencyAcAtEng', { eng: eng(spec.freq, 'Hz') });
    case 'tran': {
      const parts = [t('analysis.specs.transientEngEng2StepEng3', { eng: eng(spec.tstart ?? 0, 's'), eng2: eng(spec.tstop, 's'), eng3: eng(spec.tstep, 's') })];
      if (spec.tmax !== undefined) parts.push(t('analysis.specs.maxStepEng', { eng: eng(spec.tmax, 's') }));
      if (spec.uic) parts.push(t('analysis.specs.usingInitialConditions'));
      return parts.join(', ');
    }
    case 'noise': {
      const ref = spec.ref && spec.ref.trim() && spec.ref.trim() !== '0' ? `,${spec.ref}` : '';
      return t('analysis.specs.noiseAtVOutputRef', { output: spec.output, ref: ref, src: spec.src, frequencyText: frequencyText(spec) });
    }
    case 'tf':
      return t('analysis.specs.dcTransferFunctionOutputSrc', { output: spec.output, src: spec.src });
    case 'sens':
      return spec.ac ? t('analysis.specs.acSensitivityOfOutputFrequencytext', { output: spec.output, frequencyText: frequencyText(spec.ac) }) : t('analysis.specs.dcSensitivityOfOutput', { output: spec.output });
    case 'pz': {
      const what = spec.find === 'pol' ? t('analysis.specs.poles') : spec.find === 'zer' ? t('analysis.specs.zeros') : t('analysis.specs.polesAndZeros');
      const kind = spec.transfer === 'vol' ? t('analysis.specs.voltageGain') : t('analysis.specs.transimpedance');
      return t('analysis.specs.pzOf', { what, kind, out: `V(${spec.outPos},${spec.outNeg})`, in: `${spec.transfer === 'vol' ? 'V' : 'I'}(${spec.inPos},${spec.inNeg})` });
    }
    case 'four': {
      const outs = spec.outputs.length <= 3 ? spec.outputs.join(', ') : t('analysis.specs.nOutputs', { n: spec.outputs.length });
      return t('analysis.specs.fourierOf', { outs: outs || t('analysis.specs.noOutputs'), f: eng(spec.fundamental, 'Hz'), n: spec.harmonics }) + (spec.settleCycles ? t('analysis.specs.afterSettling', { n: spec.settleCycles }) : '');
    }
    case 'disto':
      return t('analysis.specs.distortion', { f: frequencyText(spec) }) + (spec.f2overf1 !== undefined ? t('analysis.specs.intermod', { ratio: spec.f2overf1 }) : t('analysis.specs.harmonicSuffix'));
    case 'noisefig':
      return t('analysis.specs.noiseFigureAtEngOutput', { eng: eng(spec.freq, 'Hz'), output: spec.output, src: spec.src, eng2: eng(spec.rsource, 'Ω') });
    case 'paramsweep':
      return t('analysis.specs.paramSweepOf', { target: spec.target + (spec.model ? t('analysis.specs.modelSuffix') : ''), param: spec.param, list: listText(spec.values, sweepUnit(spec.target, spec.param, spec.model)) });
    case 'tempsweep':
      return t('analysis.specs.temperatureSweepListtext', { listText: listText(spec.temps, '°C') });
    case 'montecarlo':
      return t('analysis.specs.monteCarlo', { runs: spec.runs, seed: spec.seed, n: spec.tolerances.length }) + (spec.measure ? `, ${measureText(spec.measure)}` : '');
    case 'worstcase':
      return t('analysis.specs.worstCase', { direction: spec.direction === 'low' ? t('analysis.specs.dirLow') : t('analysis.specs.dirHigh'), measure: measureText(spec.measure), n: spec.tolerances.length });
    case 'nestedsweep':
      return t('analysis.specs.nestedSweepTargetParamLength', { target: spec.outer.target, param: spec.outer.param, length: spec.outer.values.length, target2: spec.inner.target, param2: spec.inner.param, length2: spec.inner.values.length });
    case 'tracewidth':
      return t(spec.external ? 'analysis.specs.traceWidthExternal' : 'analysis.specs.traceWidthInternal', { rise: eng(spec.tempRise, '°C'), oz: spec.copperOz });
    case 'batch':
      return t('analysis.specs.batchOf', { n: spec.items.length, list: spec.items.map((i) => analysisInfo(i.type).title).join('; ') });
  }
}

/** Detailed summary: one line per setting (nested analyses indented by two spaces). */
export function analysisSummaryLines(spec: AnalysisSpec, indent = ''): string[] {
  const lines = [`${indent}${analysisHeadline(spec)}`];
  const sub = indent + '  ';
  switch (spec.type) {
    case 'paramsweep':
    case 'tempsweep':
    case 'nestedsweep':
    case 'tracewidth':
      lines.push(...analysisSummaryLines(spec.base, sub));
      break;
    case 'montecarlo':
    case 'worstcase':
      for (const tol of spec.tolerances) {
        lines.push(sub + t('analysis.specs.toleranceLine', { target: tol.target + (tol.model ? t('analysis.specs.modelSuffix') : ''), param: tol.param, tol: Number((tol.tol * 100).toPrecision(6)), dist: tol.dist === 'gaussian' ? t('analysis.specs.distGaussian') : t('analysis.specs.distUniform') }));
      }
      lines.push(...analysisSummaryLines(spec.base, sub));
      break;
    case 'batch':
      spec.items.forEach((item) => lines.push(...analysisSummaryLines(item, sub)));
      break;
    default:
      break;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Simulation options
// ---------------------------------------------------------------------------

export type OptionKey = keyof SimOptions;

export interface OptionField {
  key: OptionKey;
  label: string;
  unit: string;
  group: 'Global' | 'DC' | 'Transient' | 'Device' | 'Advanced';
  kind: 'number' | 'integer' | 'method';
  min?: number;
  max?: number;
  /** strict lower bound */
  exclusiveMin?: boolean;
  help: string;
}

/** Simulation option fields; label and help are read in the current language. */
export const OPTION_FIELDS: readonly OptionField[] = (
  [
  { key: 'temp', unit: '°C', group: 'Global', kind: 'number', min: -273.15 },
  { key: 'tnom', unit: '°C', group: 'Global', kind: 'number', min: -273.15 },
  { key: 'reltol', unit: '', group: 'Global', kind: 'number', min: 0, max: 1, exclusiveMin: true },
  { key: 'abstol', unit: 'A', group: 'Global', kind: 'number', min: 0, exclusiveMin: true },
  { key: 'vntol', unit: 'V', group: 'Global', kind: 'number', min: 0, exclusiveMin: true },
  { key: 'gmin', unit: 'S', group: 'Global', kind: 'number', min: 0, exclusiveMin: true },
  { key: 'rshunt', unit: 'Ω', group: 'Global', kind: 'number', min: 0 },
  { key: 'seed', unit: '', group: 'Global', kind: 'integer', min: 0, max: 2147483647 },
  { key: 'itl1', unit: '', group: 'DC', kind: 'integer', min: 1, max: 100000 },
  { key: 'itl2', unit: '', group: 'DC', kind: 'integer', min: 1, max: 100000 },
  { key: 'gminSteps', unit: '', group: 'DC', kind: 'integer', min: 0, max: 1000 },
  { key: 'srcSteps', unit: '', group: 'DC', kind: 'integer', min: 0, max: 1000 },
  { key: 'method', unit: '', group: 'Transient', kind: 'method' },
  { key: 'maxord', unit: '', group: 'Transient', kind: 'integer', min: 1, max: 6 },
  { key: 'itl4', unit: '', group: 'Transient', kind: 'integer', min: 1, max: 100000 },
  { key: 'trtol', unit: '', group: 'Transient', kind: 'number', min: 0, exclusiveMin: true },
  { key: 'defl', unit: 'm', group: 'Device', kind: 'number', min: 0, exclusiveMin: true },
  { key: 'defw', unit: 'm', group: 'Device', kind: 'number', min: 0, exclusiveMin: true },
  { key: 'defad', unit: 'm²', group: 'Device', kind: 'number', min: 0 },
  { key: 'defas', unit: 'm²', group: 'Device', kind: 'number', min: 0 },
  { key: 'chgtol', unit: 'C', group: 'Advanced', kind: 'number', min: 0, exclusiveMin: true },
  ] as Omit<OptionField, 'label' | 'help'>[]
).map((f) => ({
  ...f,
  get label() {
    return t(`analysis.opt.${f.key}`);
  },
  get help() {
    return t(`analysis.optHelp.${f.key}`);
  },
}));

/** Validate (partial) options; paths are option keys. */
export function validateOptions(options: Partial<SimOptions>): SpecIssue[] {
  const out: SpecIssue[] = [];
  for (const f of OPTION_FIELDS) {
    const v = options[f.key];
    if (v === undefined) continue;
    if (f.kind === 'method') {
      if (v !== 'trap' && v !== 'gear') out.push({ path: f.key, message: t('analysis.specs.methodMustBeTrapezoidalOr'), severity: 'error' });
      continue;
    }
    const n = v as number;
    if (!Number.isFinite(n)) {
      out.push({ path: f.key, message: t('analysis.specs.labelMustBeANumber', { label: f.label }), severity: 'error' });
      continue;
    }
    if (f.kind === 'integer' && !Number.isInteger(n)) out.push({ path: f.key, message: t('analysis.specs.labelMustBeAWhole', { label: f.label }), severity: 'error' });
    else if (f.min !== undefined && (f.exclusiveMin ? !(n > f.min) : n < f.min)) out.push({ path: f.key, message: t(f.exclusiveMin ? 'analysis.specs.mustBeGreater' : 'analysis.specs.mustBeAtLeast', { label: f.label, min: f.min }), severity: 'error' });
    else if (f.max !== undefined && n > f.max) out.push({ path: f.key, message: t('analysis.specs.labelMustBeAtMost', { label: f.label, max: f.max }), severity: 'error' });
  }
  const merged = { ...DEFAULT_OPTIONS, ...options };
  if (options.reltol !== undefined && options.reltol > 0.01 && options.reltol < 1) out.push({ path: 'reltol', message: t('analysis.specs.relativeTolerancesAbove1Give'), severity: 'warning' });
  if (merged.method === 'trap' && options.maxord !== undefined && options.maxord > 2) out.push({ path: 'maxord', message: t('analysis.specs.maximumOrderAppliesToThe'), severity: 'warning' });
  return out;
}

/** "name = value" lines for every option that differs from DEFAULT_OPTIONS. */
export function optionsSummary(options: Partial<SimOptions>): string[] {
  const lines: string[] = [];
  for (const f of OPTION_FIELDS) {
    const v = options[f.key];
    if (v === undefined || v === DEFAULT_OPTIONS[f.key]) continue;
    const text = typeof v === 'number' ? (f.unit && f.unit !== '°C' ? formatEng(v, f.unit, 5) : `${Number(v.toPrecision(6))}${f.unit ? ` ${f.unit}` : ''}`) : v === 'gear' ? t('analysis.specs.gear') : t('analysis.specs.trapezoidal');
    lines.push(`${f.label} = ${text}`);
  }
  return lines;
}
