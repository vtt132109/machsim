/**
 * SimClient: promise / callback API over the worker protocol (protocol.ts).
 *
 *   const client = new SimClient(createWorkerTransport);        // browser / desktop
 *   const client = new SimClient(createLazyInProcessTransport); // no-worker fallback
 *   const client = new SimClient(createInProcessTransport);     // tests (from ./inprocess)
 *
 *   const run = client.run([netlist], { onProgress });          // batch of runAnalyses calls
 *   const [results] = await run.promise;  run.cancel();
 *
 *   const s = client.startInteractive(netlist, { tstep, speed }, { onChunk, onState, onError });
 *   s.pause(); s.resume(); s.setSpeed(10); s.setParams([{ element, param, value }]); s.stop();
 *   await s.done;   // { state: 'stopped' | 'finished' | 'error', message? }
 *
 * The transport is created lazily and re-created after cancel() had to terminate it (a worker
 * cannot be interrupted inside a synchronous analysis). Cancelled runs reject with
 * {@link SimulationCancelled}; sessions living on a terminated transport end with 'error'.
 */
import type { TransientChunk } from '../../sim/api';
import type { Netlist } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import type { FromWorker, InteractiveOptions, ParamEdit, SessionState, ToWorker } from './protocol';
import { t } from '../../i18n';

export interface SimTransport {
  post(msg: ToWorker, transfer?: ArrayBuffer[]): void;
  /** replace the message listener */
  onMessage(listener: (msg: FromWorker) => void): void;
  terminate(): void;
}

/** Module worker transport (Vite bundles worker.ts as a separate chunk). */
export function createWorkerTransport(): SimTransport {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'machsim-sim' });
  let listener: (msg: FromWorker) => void = () => undefined;
  worker.addEventListener('message', (e: MessageEvent<FromWorker>) => listener(e.data));
  worker.addEventListener('error', (e: ErrorEvent) => {
    listener({ type: 'error', id: -1, message: `Simulation worker failed: ${e.message || 'unknown error'}`, code: 'internal', fatal: true });
  });
  return {
    post: (msg, transfer) => worker.postMessage(msg, transfer ?? []),
    onMessage: (l) => {
      listener = l;
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * Same-thread transport that loads the engine on first use (keeps it out of the main bundle).
 * Messages posted before the engine has loaded are queued.
 */
export function createLazyInProcessTransport(): SimTransport {
  let real: SimTransport | null = null;
  let dead = false;
  let listener: (msg: FromWorker) => void = () => undefined;
  const queue: [ToWorker, ArrayBuffer[] | undefined][] = [];
  void import('./inprocess').then(
    (m) => {
      if (dead) return;
      real = m.createInProcessTransport();
      real.onMessage(listener);
      for (const [msg, transfer] of queue.splice(0)) real.post(msg, transfer);
    },
    (e: unknown) => listener({ type: 'error', id: -1, message: t('sim.client.simulationEngineFailedToLoad', { value: e instanceof Error ? e.message : String(e) }), code: 'internal', fatal: true }),
  );
  return {
    post: (msg, transfer) => {
      if (real) real.post(msg, transfer);
      else queue.push([msg, transfer]);
    },
    onMessage: (l) => {
      listener = l;
      real?.onMessage(l);
    },
    terminate: () => {
      dead = true;
      queue.length = 0;
      real?.terminate();
    },
  };
}

/** Rejection reason of a cancelled run. */
export class SimulationCancelled extends Error {
  constructor() {
    super(t('sim.client.simulationCancelled'));
    this.name = 'SimulationCancelled';
  }
}

/** Rejection reason of a run whose worker reported a fatal error. */
export class SimulationRunError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SimulationRunError';
  }
}

export interface RunHandle {
  readonly id: number;
  /** one AnalysisResult[] per netlist */
  readonly promise: Promise<AnalysisResult[][]>;
  cancel(): void;
}

export interface SessionHandlers {
  onStarted?(info: { vectors: string[]; warnings: string[] }): void;
  onChunk?(chunk: TransientChunk, info: { latest: Record<string, number>; simTime: number; rate: number }): void;
  onState?(state: SessionState, simTime: number, held?: boolean): void;
  /** fatal errors end the session (followed by done); non-fatal ones are informational */
  onError?(message: string, fatal: boolean, code: string): void;
}

export interface SessionEnd {
  state: 'stopped' | 'finished' | 'error';
  message?: string;
  simTime: number;
}

export interface InteractiveSession {
  readonly id: number;
  pause(): void;
  resume(): void;
  stop(): void;
  setSpeed(speed: number): void;
  setParams(edits: ParamEdit[]): void;
  readonly done: Promise<SessionEnd>;
}

interface PendingRun {
  resolve(r: AnalysisResult[][]): void;
  reject(e: Error): void;
  onProgress?: (fraction: number, message?: string) => void;
  abort?: Int32Array;
}

interface LiveSession {
  handlers: SessionHandlers;
  finish(end: SessionEnd): void;
  simTime: number;
  fatal?: string;
}

function canShareAbortFlag(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export class SimClient {
  private transport: SimTransport | null = null;
  private seq = 0;
  private readonly runs = new Map<number, PendingRun>();
  private readonly sessions = new Map<number, LiveSession>();

  constructor(private readonly factory: () => SimTransport) {}

  private ensure(): SimTransport {
    if (!this.transport) {
      this.transport = this.factory();
      this.transport.onMessage((msg) => this.receive(msg));
    }
    return this.transport;
  }

  /** Run every netlist (runAnalyses each) in one request. */
  run(netlists: Netlist[], opts: { onProgress?: (fraction: number, message?: string) => void } = {}): RunHandle {
    const id = ++this.seq;
    const shared = canShareAbortFlag() ? new SharedArrayBuffer(4) : undefined;
    const promise = new Promise<AnalysisResult[][]>((resolve, reject) => {
      this.runs.set(id, { resolve, reject, onProgress: opts.onProgress, abort: shared ? new Int32Array(shared) : undefined });
    });
    this.ensure().post({ type: 'run', id, netlists, ...(shared ? { abort: shared } : {}) });
    return { id, promise, cancel: () => this.cancelRun(id) };
  }

  /** Convenience: run one netlist, resolve with its results. */
  async runOne(netlist: Netlist, opts: { onProgress?: (fraction: number, message?: string) => void } = {}): Promise<AnalysisResult[]> {
    const [results] = await this.run([netlist], opts).promise;
    return results;
  }

  private cancelRun(id: number): void {
    const run = this.runs.get(id);
    if (!run) return;
    this.runs.delete(id);
    if (run.abort) Atomics.store(run.abort, 0, 1);
    else this.restart(t('sim.client.simulationCancelled'));
    run.reject(new SimulationCancelled());
  }

  /** Terminate the transport: pending runs reject, sessions end with an error. */
  private restart(reason: string): void {
    const t = this.transport;
    this.transport = null;
    t?.terminate();
    for (const [id, run] of this.runs) {
      this.runs.delete(id);
      run.reject(new SimulationCancelled());
    }
    for (const [id, s] of this.sessions) {
      this.sessions.delete(id);
      s.finish({ state: 'error', message: reason, simTime: s.simTime });
    }
  }

  startInteractive(netlist: Netlist, options: InteractiveOptions, handlers: SessionHandlers = {}): InteractiveSession {
    const id = ++this.seq;
    let finish!: (end: SessionEnd) => void;
    const done = new Promise<SessionEnd>((resolve) => {
      let settled = false;
      finish = (end) => {
        if (settled) return;
        settled = true;
        resolve(end);
      };
    });
    const live: LiveSession = { handlers, finish, simTime: 0 };
    this.sessions.set(id, live);
    const post = (msg: ToWorker) => {
      if (this.sessions.has(id)) this.ensure().post(msg);
    };
    this.ensure().post({ type: 'interactive', id, netlist, options });
    return {
      id,
      done,
      pause: () => post({ type: 'control', id, action: 'pause' }),
      resume: () => post({ type: 'control', id, action: 'resume' }),
      stop: () => post({ type: 'control', id, action: 'stop' }),
      setSpeed: (speed) => post({ type: 'speed', id, speed }),
      setParams: (edits) => {
        if (edits.length) post({ type: 'params', id, edits });
      },
    };
  }

  /** True while a run or session is pending. */
  get busy(): boolean {
    return this.runs.size > 0 || this.sessions.size > 0;
  }

  /** Terminate the transport and fail everything pending. */
  dispose(): void {
    this.restart('Simulation client disposed');
  }

  private receive(msg: FromWorker): void {
    if (msg.id === -1 && msg.type === 'error') {
      // the transport itself failed
      this.restart(msg.message);
      return;
    }
    const run = this.runs.get(msg.id);
    if (run) {
      if (msg.type === 'progress') run.onProgress?.(msg.fraction, msg.message);
      else if (msg.type === 'results') {
        this.runs.delete(msg.id);
        run.resolve(msg.results);
      } else if (msg.type === 'error') {
        this.runs.delete(msg.id);
        run.reject(msg.code === 'cancelled' ? new SimulationCancelled() : new SimulationRunError(msg.message, msg.code));
      }
      return;
    }
    const s = this.sessions.get(msg.id);
    if (!s) return;
    switch (msg.type) {
      case 'started':
        s.handlers.onStarted?.({ vectors: msg.vectors, warnings: msg.warnings });
        return;
      case 'chunk':
        s.simTime = msg.simTime;
        s.handlers.onChunk?.(msg.chunk, { latest: msg.latest, simTime: msg.simTime, rate: msg.rate });
        return;
      case 'state':
        s.simTime = msg.simTime;
        s.handlers.onState?.(msg.state, msg.simTime, msg.held);
        if (msg.state === 'stopped' || msg.state === 'finished') {
          this.sessions.delete(msg.id);
          s.finish(s.fatal ? { state: 'error', message: s.fatal, simTime: msg.simTime } : { state: msg.state, simTime: msg.simTime });
        }
        return;
      case 'error':
        s.handlers.onError?.(msg.message, msg.fatal, msg.code);
        if (msg.fatal) {
          s.fatal = msg.message;
          // a session that failed to start never sends a state message
          if (s.simTime === 0) {
            this.sessions.delete(msg.id);
            s.finish({ state: 'error', message: msg.message, simTime: 0 });
          }
        }
        return;
      default:
        return;
    }
  }
}
