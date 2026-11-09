/**
 * Extensible analysis registry.
 *
 * An analysis runner turns one AnalysisSpec into one AnalysisResult:
 *
 *   type AnalysisRunner<T> = (spec: T, ctx: AnalysisContext) => AnalysisResult
 *
 * Runners throw SimulationError on failure; the caller (runAnalyses / ctx.runSpec) converts the
 * exception into a result with `error` set, so one failing analysis never stops the others.
 * `elapsedMs` and `spec` are filled in by the caller.
 *
 * Built-in runners (op, dc, ac, acsingle, tran) are registered when this module loads. Other
 * modules add analyses with:
 *
 *   registerAnalysis('noise', (spec, ctx) => { const circuit = ctx.buildCircuit(); ... });
 *
 * Registration is a side effect of importing the module that calls registerAnalysis(), so that
 * module must be imported once by the application (e.g. from src/sim/index.ts).
 */
import type { RunOptions } from '../api';
import type { AnalysisSpec, AnalysisType, Netlist, SimOptions } from '../netlist';
import type { AnalysisResult } from '../results';
import type { Circuit } from './circuit';
import type { AbortFlag } from './system';
import { runAc, runAcSingle, runDc, runOp, runTran } from './analyses';

/** Services available to analysis runners. */
export interface AnalysisContext {
  /** Flat netlist (subcircuits expanded) the analysis runs on. */
  readonly netlist: Netlist;
  /**
   * The same netlist before flattening (expressions still unevaluated), when it is known: set for
   * the analyses of runAnalyses() and kept by nested contexts that run on an unchanged netlist.
   * A global-parameter sweep (ParamSweepAnalysis.global) re-flattens it for every value.
   */
  readonly source?: Netlist;
  /** Options of the enclosing runAnalyses() call. */
  readonly runOptions: RunOptions;
  /** Cancellation flag (checked by the engine between Newton iterations / timepoints). */
  readonly signal: AbortFlag | undefined;
  /**
   * Build a fresh Circuit (devices, unknown numbering) from `netlist` (default: ctx.netlist).
   * Runners should build their own circuit: device parameters may be modified during the run.
   */
  buildCircuit(netlist?: Netlist, overrides?: Partial<SimOptions>): Circuit;
  /**
   * Run another analysis through the registry (sweeps, batch, Monte Carlo...). Never throws:
   * failures are reported in the returned result's `error`.
   */
  runSpec(spec: AnalysisSpec, netlist?: Netlist): AnalysisResult;
  /** Throw SimulationError('aborted') when the run was cancelled. */
  checkAbort(): void;
  /** Report progress of this analysis in [0, 1]. */
  progress(fraction: number, message?: string): void;
}

export type AnalysisRunner<T extends AnalysisSpec = AnalysisSpec> = (spec: T, ctx: AnalysisContext) => AnalysisResult;

type SpecOf<K extends AnalysisType> = Extract<AnalysisSpec, { type: K }>;

const runners = new Map<string, AnalysisRunner>();

/** Register (or replace) the runner of an analysis type. */
export function registerAnalysis<K extends AnalysisType>(type: K, runner: AnalysisRunner<SpecOf<K>>): void {
  runners.set(type, runner as AnalysisRunner);
}

/** Runner of an analysis type, or undefined when none is registered. */
export function getAnalysisRunner(type: string): AnalysisRunner | undefined {
  return runners.get(type);
}

/** Analysis types that currently have a runner. */
export function registeredAnalyses(): string[] {
  return [...runners.keys()];
}

export { analysisTitle } from './titles';

registerAnalysis('op', runOp);
registerAnalysis('dc', runDc);
registerAnalysis('ac', runAc);
registerAnalysis('acsingle', runAcSingle);
registerAnalysis('tran', runTran);
