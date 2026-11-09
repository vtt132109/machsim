/**
 * runAnalyses(): flatten the netlist once, then run every analysis through the registry.
 *
 * Each analysis gets its own AnalysisContext (fresh circuits, progress scaled to the analysis'
 * share of the run). Exceptions become results with `error` set (the SimulationError message,
 * which names the offending node / element); the remaining analyses still run. An empty
 * analyses list runs an operating point. Top-level contexts also carry the netlist before
 * flattening (`source`), so a global-parameter sweep (.step param) can re-evaluate it. The
 * netlist's `.meas` directives are evaluated on every result (src/sim/analyses/meas.ts).
 */
import type { RunAnalyses, RunOptions } from '../api';
import type { AnalysisSpec, Netlist, SimOptions } from '../netlist';
import { SimulationError, type AnalysisResult } from '../results';
import { flattenNetlist } from '../spice/flatten';
import { applyMeasurements } from '../analyses/meas';
import { getAnalysisRunner, type AnalysisContext } from './analysis-registry';
import { Circuit } from './circuit';
import { checkAbort } from './system';
import { analysisTitle } from './titles';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Result object reporting a failed analysis. */
export function errorResult(spec: AnalysisSpec, e: unknown): AnalysisResult {
  const message = e instanceof Error ? e.message : String(e);
  return { type: spec.type, title: analysisTitle(spec.type), spec, vectors: [], warnings: [], error: message };
}

/**
 * Create the context runners receive. `share` maps this analysis' progress fraction into the
 * overall run: overall = (share.index + fraction) / share.count.
 */
export function createAnalysisContext(
  netlist: Netlist,
  runOptions: RunOptions = {},
  share: { index: number; count: number } = { index: 0, count: 1 },
  source?: Netlist,
): AnalysisContext {
  const ctx: AnalysisContext = {
    netlist,
    ...(source ? { source } : {}),
    runOptions,
    signal: runOptions.signal,
    buildCircuit: (n?: Netlist, overrides?: Partial<SimOptions>) => new Circuit(n ?? netlist, { options: overrides }),
    runSpec: (spec: AnalysisSpec, n?: Netlist) => runSpec(spec, n === undefined ? ctx : createAnalysisContext(n, runOptions, share)),
    checkAbort: () => checkAbort(runOptions.signal),
    progress: (fraction: number, message?: string) => {
      if (!runOptions.onProgress) return;
      const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
      runOptions.onProgress((share.index + f) / Math.max(1, share.count), message);
    },
  };
  return ctx;
}

/** Run one analysis spec in a context; never throws. */
export function runSpec(spec: AnalysisSpec, ctx: AnalysisContext): AnalysisResult {
  const t0 = now();
  let result: AnalysisResult;
  const runner = getAnalysisRunner(spec.type);
  if (!runner) {
    result = errorResult(spec, new SimulationError(`Analysis '${spec.type}' is not supported`, 'unsupported'));
  } else {
    try {
      ctx.checkAbort();
      result = runner(spec, ctx);
    } catch (e) {
      result = errorResult(spec, e);
    }
  }
  if (result.spec === undefined) result.spec = spec;
  result.elapsedMs = now() - t0;
  return result;
}

export const runAnalyses: RunAnalyses = (netlist: Netlist, opts: RunOptions = {}) => {
  let flat: Netlist | undefined;
  let flatError: unknown;
  try {
    flat = flattenNetlist(netlist);
  } catch (e) {
    flatError = e instanceof SimulationError ? e : new SimulationError(e instanceof Error ? e.message : String(e), 'netlist');
  }
  const source = flat ?? netlist;
  const specs: AnalysisSpec[] = source.analyses.length > 0 ? source.analyses : [{ type: 'op' }];
  const results: AnalysisResult[] = [];
  specs.forEach((spec, index) => {
    if (flat === undefined) {
      results.push(errorResult(spec, flatError));
      return;
    }
    const ctx = createAnalysisContext(flat, opts, { index, count: specs.length }, netlist);
    results.push(runSpec(spec, ctx));
  });
  if (flat?.measures?.length) applyMeasurements(results, flat);
  opts.onProgress?.(1);
  return results;
};
