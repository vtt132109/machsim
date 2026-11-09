/**
 * Public simulation API types.
 *
 * CONTRACT FILE. The implementation is exported from src/sim/index.ts:
 *   export const runAnalyses: RunAnalyses
 *   export const createTransientStepper: CreateTransientStepper
 * The UI calls these inside a Web Worker (src/ui/sim).
 */

import type { Netlist } from './netlist';
import type { AnalysisResult } from './results';

export interface RunOptions {
  /** cooperative cancellation; checked between Newton iterations / timepoints */
  signal?: { readonly aborted: boolean };
  onProgress?: (fraction: number, message?: string) => void;
}

/**
 * Run every analysis in netlist.analyses (in order) and return one result per analysis.
 * Errors in one analysis are reported in that result's `error` field; other analyses still run.
 * An empty analyses list runs a DC operating point.
 */
export type RunAnalyses = (netlist: Netlist, opts?: RunOptions) => AnalysisResult[];

export interface StepperOptions {
  /** nominal output step (s) — samples are produced at most this far apart */
  tstep: number;
  /** maximum internal timestep (default tstep) */
  tmax?: number;
  uic?: boolean;
  /** vectors to record; empty = all node voltages + branch currents */
  saves?: string[];
}

export interface TransientChunk {
  time: Float64Array;
  /** vector name -> samples aligned with `time` */
  vectors: Record<string, Float64Array>;
}

/**
 * Incremental transient simulation for interactive mode (virtual instruments, switches,
 * potentiometers). Topology is fixed; values may change between advance() calls.
 */
export interface TransientStepper {
  /** simulated time reached so far */
  readonly time: number;
  /** Simulate until tUntil (or until maxWallMs elapsed) and return new samples since the last call. */
  advance(tUntil: number, maxWallMs?: number): TransientChunk;
  /** Change an element parameter ("value" = primary value; or e.g. "dc", "acmag", "freq", "ampl"). */
  setParam(element: string, param: string, value: number): void;
  vectorNames(): string[];
  /** latest value of every recorded vector */
  latest(): Record<string, number>;
}

export type CreateTransientStepper = (netlist: Netlist, opts: StepperOptions) => TransientStepper;
