/**
 * Statistical and worst-case tolerance analyses.
 *
 * Tolerances (ToleranceSpec): a target element parameter ("value" or a parameter name) or, with
 * model: true, a model-card parameter, a relative tolerance `tol` and a distribution:
 *   uniform    value · (1 + tol·u),    u uniform in [−1, 1)
 *   gaussian   value · (1 + (tol/3)·g), g standard normal — `tol` is the ±3σ limit
 * A model-parameter tolerance applies to every device using the card (lot variation); element
 * tolerances are independent per element. Each tolerance draws one number per run, in the order
 * listed, from the seeded xoshiro128** generator (prng.ts): equal seeds give identical runs.
 *
 * 'montecarlo': a nominal run, then `runs` randomised runs of the base analysis.
 *   runs:    [{ label: 'nominal' }, { label: 'run 1' }, ...] with the full base results.
 *   table:   one row per run: run, every toleranced value, and the measurement when given.
 *   measure: when spec.measure is set, scale "run" (1..N) with vector "<func>(<output>)" of the
 *            measured values (NaN for failed runs), and scalars nominal, mean, sigma (sample
 *            standard deviation), min, max, min_run, max_run (1-based run numbers) and count
 *            (number of finite measurements); statistics exclude the nominal run.
 *
 * 'worstcase': sensitivity-directed worst case. After the nominal run, each tolerance is set
 *   alone to its +tol and −tol extremes; the side that moves the measurement furthest in the
 *   requested direction ('high' = larger, 'low' = smaller) is selected (a parameter whose both
 *   extremes move it the wrong way stays nominal). A final run applies all selected extremes
 *   together. Table: target, parameter, nominal, tolerance %, sensitivity (Δmeasure/Δparam from
 *   the two one-at-a-time runs), chosen value and side; scalars nominal, worst, deviation,
 *   deviation_pct; runs: nominal and worst case.
 */
import type { AnalysisSpec, MonteCarloAnalysis, Netlist, ToleranceSpec, WorstCaseAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult } from '../results';
import type { AnalysisContext } from '../engine/analysis-registry';
import { analysisTitle } from '../engine/titles';
import { measureName, measureResult } from './measure';
import { getParamValue, modifyNetlist, paramLabel, type Modification } from './modify';
import { Random } from './prng';
import { formatNumber, runNested } from './util';

interface ResolvedTolerance {
  spec: ToleranceSpec;
  nominal: number;
  label: string;
}

function resolveTolerances(what: string, n: Netlist, tolerances: ToleranceSpec[]): ResolvedTolerance[] {
  if (!tolerances || tolerances.length === 0) throw new SimulationError(`${what}: no tolerances specified`, 'netlist');
  return tolerances.map((t) => {
    if (!(t.tol >= 0) || !Number.isFinite(t.tol)) throw new SimulationError(`${what}: invalid tolerance ${t.tol} for ${t.target}`, 'netlist');
    if (t.dist !== 'uniform' && t.dist !== 'gaussian') throw new SimulationError(`${what}: unknown distribution '${String(t.dist)}'`, 'netlist');
    const nominal = getParamValue(n, t.target, t.param, t.model);
    if (nominal === undefined) throw new SimulationError(`${what}: ${t.model ? 'model parameter' : 'parameter'} '${paramLabel(t.target, t.param, t.model)}' not found`, 'netlist');
    return { spec: t, nominal, label: paramLabel(t.target, t.param, t.model) };
  });
}

function mods(tols: ResolvedTolerance[], values: number[]): Modification[] {
  return tols.map((t, k) => ({ target: t.spec.target, param: t.spec.param, model: t.spec.model, value: values[k] }));
}

/** One random value per tolerance. */
export function drawTolerances(rng: Random, tols: { nominal: number; spec: ToleranceSpec }[]): number[] {
  return tols.map((t) => {
    const f = t.spec.dist === 'uniform' ? 1 + t.spec.tol * (2 * rng.next() - 1) : 1 + (t.spec.tol / 3) * rng.gaussian();
    return t.nominal * f;
  });
}

function runWith(ctx: AnalysisContext, base: AnalysisSpec, n: Netlist, m: Modification[], from: number, to: number): AnalysisResult {
  return runNested(ctx, base, m.length > 0 ? modifyNetlist(n, m) : n, from, to);
}

export function runMonteCarlo(spec: MonteCarloAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('montecarlo');
  const count = Math.floor(spec.runs);
  if (!(count >= 1)) throw new SimulationError(`${what}: number of runs must be at least 1`, 'netlist');
  const tols = resolveTolerances(what, ctx.netlist, spec.tolerances);
  const seed = Number.isFinite(spec.seed) ? spec.seed : (ctx.netlist.options.seed ?? 1);
  const rng = new Random(seed);
  const total = count + 1;
  const runs: { label: string; result: AnalysisResult }[] = [];
  const rows: (string | number)[][] = [];
  const measured: number[] = [];

  const nominalResult = runWith(ctx, spec.base, ctx.netlist, [], 0, 1 / total);
  runs.push({ label: 'nominal', result: nominalResult });
  const nominalMeasure = spec.measure ? measureResult(nominalResult, spec.measure) : Number.NaN;
  rows.push(['nominal', ...tols.map((t) => t.nominal), ...(spec.measure ? [nominalMeasure] : [])]);

  for (let r = 1; r <= count; r++) {
    ctx.checkAbort();
    const values = drawTolerances(rng, tols);
    const result = runWith(ctx, spec.base, ctx.netlist, mods(tols, values), r / total, (r + 1) / total);
    runs.push({ label: `run ${r}`, result });
    const m = spec.measure ? measureResult(result, spec.measure) : Number.NaN;
    if (spec.measure) measured.push(m);
    rows.push([r, ...values, ...(spec.measure ? [m] : [])]);
  }

  const failed = runs.filter((x) => x.result.error !== undefined).length;
  const warnings = failed > 0 ? [`${what}: ${failed} of ${runs.length} runs failed`] : [];
  const columns = ['Run', ...tols.map((t) => t.label), ...(spec.measure ? [measureName(spec.measure)] : [])];
  const result: AnalysisResult = { type: 'montecarlo', title: what, spec, vectors: [], runs, table: { columns, rows }, warnings };
  if (spec.measure) {
    const finite = measured.filter((v) => Number.isFinite(v));
    const mean = finite.reduce((a, b) => a + b, 0) / Math.max(1, finite.length);
    const variance = finite.length > 1 ? finite.reduce((a, b) => a + (b - mean) ** 2, 0) / (finite.length - 1) : 0;
    let minRun = -1;
    let maxRun = -1;
    measured.forEach((v, k) => {
      if (!Number.isFinite(v)) return;
      if (minRun < 0 || v < measured[minRun]) minRun = k;
      if (maxRun < 0 || v > measured[maxRun]) maxRun = k;
    });
    result.scalars = {
      nominal: nominalMeasure,
      mean: finite.length > 0 ? mean : Number.NaN,
      sigma: Math.sqrt(variance),
      min: minRun >= 0 ? measured[minRun] : Number.NaN,
      max: maxRun >= 0 ? measured[maxRun] : Number.NaN,
      min_run: minRun + 1,
      max_run: maxRun + 1,
      count: finite.length,
    };
    result.scale = { name: 'run', unit: '', re: Float64Array.from(measured, (_, k) => k + 1) };
    result.vectors = [{ name: measureName(spec.measure), unit: '', re: Float64Array.from(measured) }];
    if (finite.length < measured.length) warnings.push(`${what}: ${measured.length - finite.length} measurement(s) could not be evaluated`);
  }
  return result;
}

export function runWorstCase(spec: WorstCaseAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('worstcase');
  if (!spec.measure) throw new SimulationError(`${what}: a measurement is required`, 'netlist');
  if (spec.direction !== 'high' && spec.direction !== 'low') throw new SimulationError(`${what}: direction must be 'high' or 'low'`, 'netlist');
  const tols = resolveTolerances(what, ctx.netlist, spec.tolerances);
  const totalRuns = 2 + 2 * tols.length;
  let done = 0;
  const next = () => {
    const from = done / totalRuns;
    done++;
    return [from, done / totalRuns] as const;
  };
  const nominalRun = runWith(ctx, spec.base, ctx.netlist, [], ...next());
  if (nominalRun.error !== undefined) throw new SimulationError(`${what}: nominal run failed: ${nominalRun.error}`, 'noconv');
  const m0 = measureResult(nominalRun, spec.measure);
  if (!Number.isFinite(m0)) throw new SimulationError(`${what}: measurement ${measureName(spec.measure)} is not finite in the nominal run`, 'netlist');
  const sign = spec.direction === 'high' ? 1 : -1;
  const warnings: string[] = [];
  const chosen: number[] = [];
  const rows: (string | number)[][] = [];
  tols.forEach((t, k) => {
    ctx.checkAbort();
    const hi = t.nominal * (1 + t.spec.tol);
    const lo = t.nominal * (1 - t.spec.tol);
    const one = (v: number) => {
      const m: Modification[] = [{ target: t.spec.target, param: t.spec.param, model: t.spec.model, value: v }];
      return measureResult(runWith(ctx, spec.base, ctx.netlist, m, ...next()), spec.measure);
    };
    const mHi = t.spec.tol > 0 ? one(hi) : m0;
    const mLo = t.spec.tol > 0 ? one(lo) : m0;
    if (t.spec.tol === 0) done += 2;
    if (!Number.isFinite(mHi) || !Number.isFinite(mLo)) warnings.push(`${what}: sensitivity run of ${t.label} failed; kept nominal`);
    const gainHi = Number.isFinite(mHi) ? sign * (mHi - m0) : -Infinity;
    const gainLo = Number.isFinite(mLo) ? sign * (mLo - m0) : -Infinity;
    let value = t.nominal;
    let side = 'nominal';
    if (gainHi > 0 && gainHi >= gainLo) {
      value = hi;
      side = '+tol';
    } else if (gainLo > 0) {
      value = lo;
      side = '-tol';
    }
    chosen[k] = value;
    const dp = hi - lo;
    const sens = dp !== 0 && Number.isFinite(mHi) && Number.isFinite(mLo) ? (mHi - mLo) / dp : 0;
    rows.push([t.spec.target, t.spec.model ? `model ${t.spec.param}` : t.spec.param, t.nominal, 100 * t.spec.tol, sens, value, side]);
  });
  const worstRun = runWith(ctx, spec.base, ctx.netlist, mods(tols, chosen), ...next());
  if (worstRun.error !== undefined) throw new SimulationError(`${what}: worst-case run failed: ${worstRun.error}`, 'noconv');
  const worst = measureResult(worstRun, spec.measure);
  const name = measureName(spec.measure);
  rows.push(['', name, m0, '', '', worst, spec.direction === 'high' ? 'max' : 'min']);
  return {
    type: 'worstcase',
    title: what,
    spec,
    vectors: [],
    scalars: { nominal: m0, worst, deviation: worst - m0, deviation_pct: m0 !== 0 ? (100 * (worst - m0)) / Math.abs(m0) : Number.NaN },
    runs: [
      { label: 'nominal', result: nominalRun },
      { label: `worst case (${spec.direction}: ${formatNumber(worst)})`, result: worstRun },
    ],
    table: { columns: ['Target', 'Parameter', 'Nominal', 'Tolerance (%)', 'Sensitivity', 'Worst-case value', 'Side'], rows },
    warnings,
  };
}
