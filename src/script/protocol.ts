/**
 * Scripting: messages between the sandboxed worker that runs a user's JavaScript and the host that
 * owns the design, the simulator and the files (pure types and the method catalogue).
 *
 *   worker -> host   { t: 'call', id, method, args }      one API call (the host answers with 'reply')
 *                    { t: 'log', level, text }           print / console output
 *                    { t: 'done', ok, value?, error? }    the script finished (value = what it returned)
 *   host -> worker   { t: 'run', code, args, methods }    start a script
 *                    { t: 'reply', id, ok, value?, error? }
 *
 * Everything crossing the boundary is plain JSON-compatible data (structured clone), never a
 * function or a typed array, so the same protocol works for a browser Worker, a Node worker_threads
 * Worker (tests) and a future out-of-process host.
 */

/** Every API method the host answers; the worker builds `MachSim.<name>()` for each one. */
export const SCRIPT_METHODS = [
  // designs
  'newDesign',
  'currentDesign',
  'openDesign',
  'saveDesign',
  'showDesign',
  'designInfo',
  // library
  'searchParts',
  'partInfo',
  // editing
  'place',
  'remove',
  'move',
  'rotate',
  'setValue',
  'setParam',
  'getParam',
  'setVariable',
  'pin',
  'nodeOf',
  'wire',
  'wirePath',
  'net',
  'ground',
  'label',
  // analysis
  'erc',
  'netlist',
  'run',
  'runSpice',
  'setAnalysis',
  // output
  'saveText',
  'plot',
] as const;

export type ScriptMethod = (typeof SCRIPT_METHODS)[number];

export type ScriptLogLevel = 'log' | 'info' | 'warn' | 'error';

export type ToScriptWorker =
  | { t: 'run'; code: string; args: string[]; methods: readonly string[] }
  | { t: 'reply'; id: number; ok: true; value: unknown }
  | { t: 'reply'; id: number; ok: false; error: string };

export type FromScriptWorker =
  | { t: 'call'; id: number; method: string; args: unknown[] }
  | { t: 'log'; level: ScriptLogLevel; text: string }
  | { t: 'done'; ok: true; value: unknown }
  | { t: 'done'; ok: false; error: string; line?: number };

/** Transport of one worker (browser Worker, Node worker_threads Worker, test double). */
export interface ScriptWorkerHandle {
  post(msg: ToScriptWorker): void;
  onMessage(listener: (msg: FromScriptWorker) => void): void;
  /** called when the worker dies without a 'done' message */
  onFailure(listener: (message: string) => void): void;
  terminate(): void;
}

/** Creates the worker running `source` (see workerSource.ts). */
export type ScriptWorkerFactory = (source: string) => ScriptWorkerHandle;

// ---------------------------------------------------------------------------------------------
// data crossing the boundary

/** A vector of an analysis result as plain numbers. */
export interface ScriptVector {
  name: string;
  unit: string;
  values: number[];
  /** imaginary parts (AC, noise ...) */
  imag?: number[];
}

/** An analysis result as the script sees it (see session.ts `toScriptResult`). */
export interface ScriptResult {
  type: string;
  title: string;
  error?: string;
  warnings: string[];
  /** the sweep variable (time, frequency, source value ...); absent for a single operating point */
  scale?: ScriptVector;
  vectors: ScriptVector[];
  scalars: Record<string, number>;
  measurements: { name: string; value: number | null; at?: number; error?: string }[];
  table?: { columns: string[]; rows: (string | number)[][] };
  /** one entry per run of a family (parameter sweep, Monte Carlo ...) */
  runs?: { label: string; result: ScriptResult }[];
}

/** A point on the sheet or a pin reference such as "R1.2" or "V1.+". */
export type ScriptPointRef = string | { x: number; y: number };

export interface PlotSeries {
  name: string;
  y: number[];
  /** own x values (defaults to the plot's x) */
  x?: number[];
}

/** What `MachSim.plot()` sends to the host. */
export interface ScriptPlot {
  title: string;
  xLabel: string;
  yLabel: string;
  x: number[];
  series: PlotSeries[];
  logX: boolean;
  logY: boolean;
}

export const SCRIPT_LIMITS = {
  /** longest a script may run before it is stopped (ms) */
  timeoutMs: 10 * 60 * 1000,
  /** largest text a script may save */
  maxTextBytes: 32 * 1024 * 1024,
  /** most lines kept in the log pane */
  maxLogLines: 2000,
  /** most parts a script may place in one design */
  maxParts: 5000,
} as const;
