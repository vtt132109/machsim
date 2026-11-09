/**
 * Simulation run records for the Grapher history (light module: the controller appends records
 * without loading the Grapher).
 *
 * Every one-shot analysis, imported-netlist run and captured interactive session becomes one
 * RunRecord in LiveState.runs (newest last, at most MAX_RUN_HISTORY). The Grapher turns each record
 * into pages (results/history.ts) and keeps them across runs, so earlier results can be compared
 * and overlaid.
 */
import type { AnalysisResult } from '../../sim/results';

/** 'import' = a measurement file read by Grapher > Import measurement */
export type RunSource = 'analysis' | 'interactive' | 'netlist' | 'import';

export interface RunRecord {
  /** 1, 2, 3 … in order of the session */
  id: number;
  source: RunSource;
  /** analysis name or netlist name as shown in the Simulation messages */
  name: string;
  /** wall-clock time the run finished (ms since epoch) */
  time: number;
  results: readonly AnalysisResult[];
  /** Output-tab expressions of the design at the time of the run (evaluated by the Grapher) */
  expressions?: readonly string[];
}

/** Runs kept in the Grapher history. */
export const MAX_RUN_HISTORY = 20;

/** A copy of `runs` with `record` appended and the oldest records dropped beyond `max`. */
export function appendRun(runs: readonly RunRecord[], record: RunRecord, max = MAX_RUN_HISTORY): RunRecord[] {
  const out = [...runs, record];
  return out.length > max ? out.slice(out.length - max) : out;
}
