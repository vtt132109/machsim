/**
 * Message protocol between the UI thread and the simulation worker (src/ui/sim/worker.ts).
 *
 * Every request carries a numeric `id` chosen by the client; every reply echoes it.
 *
 *   UI -> worker                                  worker -> UI
 *   run          batch of netlists (runAnalyses)  progress, results | error
 *   interactive  start a streaming transient      started, chunk*, state, error
 *   control      pause | resume | stop             state
 *   speed        simulated seconds per wall second
 *   params       setParam calls (live edits)       error (fatal: false) when one fails
 *   cancel       abandon a run / session            state 'stopped' (sessions) | error 'aborted' (runs)
 *
 * Streaming: the worker advances the TransientStepper in slices of at most `sliceMs` of
 * compute, paced so that simulated time follows wall time × `speed` (Infinity = as fast as
 * possible). When the circuit is too slow for the requested speed the debt is dropped instead
 * of accumulated, so the simulation never "catches up" in bursts. Chunk arrays are transferred,
 * not copied.
 *
 * Cancelling a batch run: the worker cannot read messages while a synchronous analysis runs, so
 * the client terminates the worker (and starts a fresh one) unless the run was given an abort
 * flag in a SharedArrayBuffer (cross-origin isolated pages), in which case `cancel` sets it.
 */
import type { TransientChunk } from '../../sim/api';
import type { Netlist } from '../../sim/netlist';
import type { AnalysisResult, SimulationErrorCode } from '../../sim/results';

/** One live parameter edit (TransientStepper.setParam). */
export interface ParamEdit {
  element: string;
  param: string;
  value: number;
}

export interface InteractiveOptions {
  /** nominal output step (s) */
  tstep: number;
  /** maximum internal step (s) */
  tmax?: number;
  uic?: boolean;
  /** vectors to record; empty = every node voltage and branch current */
  saves?: string[];
  /** simulated seconds per wall-clock second; Infinity = as fast as possible (default 1) */
  speed?: number;
  /** stop automatically once simulated time reaches this value (default: run until stopped) */
  tstop?: number;
  /** compute budget per slice in ms (default 30) */
  sliceMs?: number;
}

export type ToWorker =
  | { type: 'run'; id: number; netlists: Netlist[]; abort?: SharedArrayBuffer }
  | { type: 'interactive'; id: number; netlist: Netlist; options: InteractiveOptions }
  | { type: 'control'; id: number; action: 'pause' | 'resume' | 'stop' }
  | { type: 'speed'; id: number; speed: number }
  | { type: 'params'; id: number; edits: ParamEdit[] }
  | { type: 'cancel'; id: number };

export type SessionState = 'running' | 'paused' | 'stopped' | 'finished';

export type FromWorker =
  | { type: 'progress'; id: number; fraction: number; message?: string }
  /** one AnalysisResult[] per netlist of the run request */
  | { type: 'results'; id: number; results: AnalysisResult[][] }
  | { type: 'started'; id: number; vectors: string[]; warnings: string[] }
  | {
      type: 'chunk';
      id: number;
      chunk: TransientChunk;
      /** newest value of every recorded vector */
      latest: Record<string, number>;
      simTime: number;
      /** achieved rate over the last second: simulated seconds per wall-clock second */
      rate: number;
    }
  | { type: 'state'; id: number; state: SessionState; simTime: number }
  /** fatal errors end the run / session; non-fatal ones (a failed setParam) do not */
  | { type: 'error'; id: number; message: string; code: SimulationErrorCode | 'cancelled'; fatal: boolean };

/** Transferable buffers of a chunk (for postMessage). */
export function chunkTransferables(chunk: TransientChunk): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: Float64Array) => {
    if (a.buffer instanceof ArrayBuffer && a.byteLength > 0) out.add(a.buffer);
  };
  add(chunk.time);
  for (const v of Object.values(chunk.vectors)) add(v);
  return [...out];
}
