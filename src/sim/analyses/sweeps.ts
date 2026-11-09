/**
 * Meta analyses that re-run a base analysis on modified netlists:
 *   paramsweep   one element / model parameter over a list of values; with `global: true` a
 *                global .param (SPICE .step param): every value re-flattens ctx.source
 *   nestedsweep  two parameters (outer × inner)
 *   tempsweep    circuit temperature (options.temp, °C)
 *   batch        a list of independent analyses
 *
 * Every nested run gets its own deep-copied netlist (modify.ts) and its own circuit, runs through
 * the analysis registry (so any analysis can be swept, including other meta analyses) and keeps
 * its own `error`: one failing run never stops the others (a warning lists the failed runs).
 * Progress is mapped linearly over the runs.
 *
 * Result layout
 * - paramsweep / tempsweep: `runs` = one result per value, labelled "R1=1000", "QMOD:bf=150",
 *   "temp=27". When the base analysis produces only scalars (op, tf, noisefig, ...), the
 *   top-level result additionally has scale = the swept values (named "R1", "QMOD:bf", "temp")
 *   and one vector per scalar key — e.g. a temperature sweep of an OP gives V(out) vs temp.
 * - nestedsweep: for scalar-only bases, `runs` = one aggregated curve per outer value (scale = the
 *   inner values, label "R1=1000") and a table [outer, inner, scalars...]; otherwise `runs` = one
 *   base result per combination, labelled "R1=1000, C1=1e-09".
 * - batch: `runs` = one result per item, labelled "1: Operating point", "2: AC analysis", ...
 */
import type { BatchAnalysis, NestedSweepAnalysis, Netlist, ParamSweepAnalysis, TempSweepAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type Vector, type VectorUnit } from '../results';
import type { AnalysisContext } from '../engine/analysis-registry';
import { analysisTitle } from '../engine/titles';
import { getParamValue, modifyNetlist, paramLabel, valueLabel, withTemperature } from './modify';
import { formatNumber, runNested } from './util';
import { flattenNetlist } from '../spice/flatten';

export type SweepRun = { label: string; result: AnalysisResult };

/** True when every successful run carries scalars and no scale (op, tf, noisefig, ...). */
function scalarOnly(runs: SweepRun[]): boolean {
  const ok = runs.filter((r) => r.result.error === undefined);
  return ok.length > 0 && ok.every((r) => r.result.scale === undefined && r.result.scalars !== undefined && r.result.runs === undefined);
}

/** Scalar keys in first-appearance order over all runs. */
function scalarKeys(runs: SweepRun[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of runs) {
    for (const k of Object.keys(r.result.scalars ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

/** Unit of a scalar from the one-sample vector of the same name, when the run has one. */
function scalarUnit(runs: SweepRun[], key: string): VectorUnit {
  for (const r of runs) {
    const v = r.result.vectors.find((x) => x.name === key);
    if (v) return v.unit;
  }
  return '';
}

/**
 * Turn scalar-only runs into curves over the swept values: scale (name, unit) and one vector per
 * scalar key (NaN for failed runs).
 */
export function aggregateScalarRuns(runs: SweepRun[], values: number[], scaleName: string, scaleUnit: VectorUnit): { scale: Vector; vectors: Vector[] } | undefined {
  if (!scalarOnly(runs)) return undefined;
  const keys = scalarKeys(runs);
  const vectors = keys.map((key) => {
    const re = new Float64Array(runs.length);
    runs.forEach((r, k) => {
      const v = r.result.scalars?.[key];
      re[k] = typeof v === 'number' ? v : Number.NaN;
    });
    return { name: key, unit: scalarUnit(runs, key), re };
  });
  return { scale: { name: scaleName, unit: scaleUnit, re: Float64Array.from(values) }, vectors };
}

function failedWarning(what: string, runs: SweepRun[]): string[] {
  const failed = runs.filter((r) => r.result.error !== undefined);
  if (failed.length === 0) return [];
  const list = failed
    .slice(0, 5)
    .map((r) => `${r.label}: ${r.result.error}`)
    .join('; ');
  return [`${what}: ${failed.length} of ${runs.length} runs failed (${list}${failed.length > 5 ? '; ...' : ''})`];
}

function requireValues(what: string, values: number[] | undefined): number[] {
  if (!values || values.length === 0) throw new SimulationError(`${what}: no sweep values`, 'netlist');
  for (const v of values) if (!Number.isFinite(v)) throw new SimulationError(`${what}: invalid sweep value ${v}`, 'netlist');
  return values;
}

function requireTarget(what: string, n: Netlist, target: string, param: string, model?: boolean): void {
  if (getParamValue(n, target, param, model) === undefined) {
    const kind = model ? 'model parameter' : 'parameter';
    throw new SimulationError(`${what}: ${kind} '${paramLabel(target, param, model)}' not found`, 'netlist');
  }
}

/** One modified-netlist run per value. */
function sweepRuns(ctx: AnalysisContext, values: number[], make: (v: number, k: number) => Netlist, label: (v: number) => string, base: ParamSweepAnalysis['base']): SweepRun[] {
  const runs: SweepRun[] = [];
  values.forEach((v, k) => {
    ctx.checkAbort();
    let result: AnalysisResult;
    try {
      result = runNested(ctx, base, make(v, k), k / values.length, (k + 1) / values.length);
    } catch (e) {
      // modification errors (bad target) are reported per run
      const message = e instanceof Error ? e.message : String(e);
      result = { type: base.type, title: analysisTitle(base.type), spec: base, vectors: [], warnings: [], error: message };
    }
    runs.push({ label: label(v), result });
  });
  return runs;
}

/**
 * Copy of an unflattened netlist with global parameter `name` set to `value` (the key keeps the
 * spelling of the netlist; throws when the parameter does not exist).
 */
export function withGlobalParam(n: Netlist, name: string, value: number): Netlist {
  const key = Object.keys(n.params).find((k) => k.toLowerCase() === name.trim().toLowerCase() && !k.includes('('));
  if (key === undefined) throw new SimulationError(`global parameter '${name}' is not defined (.param ${name}=...)`, 'netlist');
  return { ...n, params: { ...n.params, [key]: value } };
}

export function runParamSweep(spec: ParamSweepAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('paramsweep');
  const values = requireValues(what, spec.values);
  let make: (v: number, k: number) => Netlist;
  let label: (v: number) => string;
  let scaleName: string;
  if (spec.global && spec.netlists !== undefined) {
    // a schematic's design variable: the caller rebuilt the netlist for every value
    if (spec.netlists.length !== values.length) throw new SimulationError(`${what}: ${spec.netlists.length} netlists for ${values.length} values of '${spec.target}'`, 'netlist');
    const built = spec.netlists;
    make = (_v, k) => flattenNetlist(built[k]);
    label = (v) => `${spec.target}=${formatNumber(v)}`;
    scaleName = spec.target;
  } else if (spec.global) {
    // .step param: every run re-evaluates the netlist's expressions with the new value
    const source = ctx.source;
    if (!source) throw new SimulationError(`${what}: the global parameter '${spec.target}' can only be swept at the top level of a run`, 'netlist');
    withGlobalParam(source, spec.target, 0);
    make = (v) => flattenNetlist(withGlobalParam(source, spec.target, v));
    label = (v) => `${spec.target}=${formatNumber(v)}`;
    scaleName = spec.target;
  } else {
    requireTarget(what, ctx.netlist, spec.target, spec.param, spec.model);
    make = (v) => modifyNetlist(ctx.netlist, [{ target: spec.target, param: spec.param, model: spec.model, value: v }]);
    label = (v) => valueLabel(spec.target, spec.param, spec.model, v);
    scaleName = paramLabel(spec.target, spec.param, spec.model);
  }
  const runs = sweepRuns(ctx, values, make, label, spec.base);
  const result: AnalysisResult = { type: 'paramsweep', title: what, spec, vectors: [], runs, warnings: failedWarning(what, runs) };
  const agg = aggregateScalarRuns(runs, values, scaleName, '');
  if (agg) {
    result.scale = agg.scale;
    result.vectors = agg.vectors;
  }
  return result;
}

export function runTempSweep(spec: TempSweepAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('tempsweep');
  const temps = requireValues(what, spec.temps);
  const runs = sweepRuns(
    ctx,
    temps,
    (t) => withTemperature(ctx.netlist, t),
    (t) => `temp=${formatNumber(t)}`,
    spec.base,
  );
  const result: AnalysisResult = { type: 'tempsweep', title: what, spec, vectors: [], runs, warnings: failedWarning(what, runs) };
  const agg = aggregateScalarRuns(runs, temps, 'temp', 'degC');
  if (agg) {
    result.scale = agg.scale;
    result.vectors = agg.vectors;
  }
  return result;
}

export function runNestedSweep(spec: NestedSweepAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('nestedsweep');
  const { outer, inner } = spec;
  const ov = requireValues(`${what} (outer)`, outer.values);
  const iv = requireValues(`${what} (inner)`, inner.values);
  requireTarget(what, ctx.netlist, outer.target, outer.param, outer.model);
  requireTarget(what, ctx.netlist, inner.target, inner.param, inner.model);
  const total = ov.length * iv.length;
  const flat: SweepRun[] = [];
  const grouped: SweepRun[][] = [];
  ov.forEach((o, a) => {
    const group: SweepRun[] = [];
    iv.forEach((i, b) => {
      ctx.checkAbort();
      const k = a * iv.length + b;
      const net = modifyNetlist(ctx.netlist, [
        { target: outer.target, param: outer.param, model: outer.model, value: o },
        { target: inner.target, param: inner.param, model: inner.model, value: i },
      ]);
      const result = runNested(ctx, spec.base, net, k / total, (k + 1) / total);
      const run = { label: `${valueLabel(outer.target, outer.param, outer.model, o)}, ${valueLabel(inner.target, inner.param, inner.model, i)}`, result };
      group.push(run);
      flat.push(run);
    });
    grouped.push(group);
  });
  const warnings = failedWarning(what, flat);
  const outerName = paramLabel(outer.target, outer.param, outer.model);
  const innerName = paramLabel(inner.target, inner.param, inner.model);
  if (!scalarOnly(flat)) return { type: 'nestedsweep', title: what, spec, vectors: [], runs: flat, warnings };

  const keys = scalarKeys(flat);
  const runs: SweepRun[] = grouped.map((group, a) => {
    const agg = aggregateScalarRuns(group, iv, innerName, '');
    const label = valueLabel(outer.target, outer.param, outer.model, ov[a]);
    const errors = group.filter((g) => g.result.error !== undefined).length;
    return {
      label,
      result: {
        type: 'nestedsweep',
        title: `${what} (${label})`,
        scale: agg?.scale ?? { name: innerName, unit: '', re: Float64Array.from(iv) },
        vectors: agg?.vectors ?? [],
        runs: group,
        warnings: errors > 0 ? [`${errors} run(s) failed`] : [],
      },
    };
  });
  const rows: (string | number)[][] = flat.map((r, k) => {
    const o = ov[Math.floor(k / iv.length)];
    const i = iv[k % iv.length];
    return [o, i, ...keys.map((key) => r.result.scalars?.[key] ?? Number.NaN)];
  });
  return {
    type: 'nestedsweep',
    title: what,
    spec,
    vectors: [],
    runs,
    table: { columns: [outerName, innerName, ...keys], rows },
    warnings,
  };
}

export function runBatch(spec: BatchAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('batch');
  const items = spec.items ?? [];
  if (items.length === 0) throw new SimulationError(`${what}: no analyses in the batch`, 'netlist');
  const runs: SweepRun[] = items.map((item, k) => {
    ctx.checkAbort();
    const result = runNested(ctx, item, ctx.netlist, k / items.length, (k + 1) / items.length);
    return { label: `${k + 1}: ${analysisTitle(item.type)}`, result };
  });
  return { type: 'batch', title: what, spec, vectors: [], runs, warnings: failedWarning(what, runs) };
}
