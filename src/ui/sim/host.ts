/**
 * SimHost: the simulation side of the worker protocol (protocol.ts), independent of the
 * worker global so it also runs in-process (tests, environments without module workers).
 *
 *   const host = new SimHost((msg, transfer) => postMessage(msg, transfer));
 *   onmessage = (e) => host.handle(e.data);
 *
 * Batch runs call runAnalyses() once per netlist and report throttled progress. Interactive
 * sessions own a TransientStepper and advance it in compute slices on a timer, pacing simulated
 * time against wall time (see protocol.ts). All timing goes through an injectable clock.
 */
import { createTransientStepper, runAnalyses } from '../../sim';
import type { TransientStepper } from '../../sim/api';
import type { Netlist } from '../../sim/netlist';
import type { AnalysisResult, SimulationErrorCode } from '../../sim/results';
import { SimulationError } from '../../sim/results';
import { chunkTransferables, type FromWorker, type InteractiveOptions, type ParamEdit, type SessionState, type ToWorker } from './protocol';

export type PostFn = (msg: FromWorker, transfer?: ArrayBuffer[]) => void;

export interface HostClock {
  /** milliseconds, monotonic */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: HostClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Progress messages are sent at most this often (ms). */
export const PROGRESS_INTERVAL_MS = 100;
/** Lag beyond this many wall-clock ms is dropped instead of caught up. */
export const MAX_LAG_MS = 250;
/** Longest wait between slices while ahead of the pace (keeps the UI fed at >= 20 Hz). */
export const MAX_IDLE_MS = 50;
/** Shortest wait between slices once on pace (no busy loop). */
export const MIN_IDLE_MS = 4;
const DEFAULT_SLICE_MS = 30;

function errorCode(e: unknown): SimulationErrorCode {
  return e instanceof SimulationError ? e.code : 'internal';
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class Session {
  state: SessionState = 'running';
  private timer: unknown = null;
  private anchorWall: number;
  private anchorSim: number;
  /** recent (wall, sim) samples for the achieved-rate estimate */
  private history: { wall: number; sim: number }[] = [];
  private readonly sliceMs: number;
  private readonly tstop: number;
  speed: number;

  constructor(
    readonly id: number,
    readonly stepper: TransientStepper,
    options: InteractiveOptions,
    private readonly post: PostFn,
    private readonly clock: HostClock,
    private readonly onEnd: (id: number) => void,
  ) {
    this.speed = normalizeSpeed(options.speed);
    this.sliceMs = options.sliceMs && options.sliceMs > 0 ? options.sliceMs : DEFAULT_SLICE_MS;
    this.tstop = options.tstop !== undefined && options.tstop > 0 ? options.tstop : Infinity;
    this.anchorWall = clock.now();
    this.anchorSim = stepper.time;
  }

  start(): void {
    this.postState();
    this.schedule(0);
  }

  private postState(): void {
    this.post({ type: 'state', id: this.id, state: this.state, simTime: this.stepper.time });
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.tick();
    }, ms);
  }

  private reanchor(): void {
    this.anchorWall = this.clock.now();
    this.anchorSim = this.stepper.time;
  }

  /** Simulated time the pace asks for at wall time `wall`. */
  private ideal(wall: number): number {
    return this.speed === Infinity ? Infinity : this.anchorSim + ((wall - this.anchorWall) / 1000) * this.speed;
  }

  private rate(wall: number): number {
    const h = this.history;
    h.push({ wall, sim: this.stepper.time });
    while (h.length > 2 && wall - h[1].wall >= 1000) h.shift();
    const first = h[0];
    const dt = (wall - first.wall) / 1000;
    return dt > 0 ? (this.stepper.time - first.sim) / dt : 0;
  }

  tick(): void {
    if (this.state !== 'running') return;
    const target = Math.min(this.ideal(this.clock.now()), this.tstop);
    if (this.stepper.time < target || this.stepper.time === 0) {
      let chunk;
      try {
        chunk = this.stepper.advance(target, this.sliceMs);
      } catch (e) {
        this.fail(e);
        return;
      }
      if (chunk.time.length) {
        const wall = this.clock.now();
        this.post(
          { type: 'chunk', id: this.id, chunk, latest: this.stepper.latest(), simTime: this.stepper.time, rate: this.rate(wall) },
          chunkTransferables(chunk),
        );
      }
    }
    if (this.stepper.time >= this.tstop) {
      this.finish('finished');
      return;
    }
    const wall = this.clock.now();
    if (this.speed === Infinity) {
      this.schedule(0);
      return;
    }
    const lead = this.stepper.time - this.ideal(wall);
    if (-lead > (MAX_LAG_MS / 1000) * this.speed) {
      // too slow for the requested speed: forget the debt, keep going as fast as possible
      this.reanchor();
      this.schedule(0);
      return;
    }
    // behind: continue at once; on pace or ahead: wait (at least MIN_IDLE_MS, so an idle session
    // never spins) until the pace has advanced past the simulated time
    if (lead < 0) this.schedule(0);
    else this.schedule(Math.max(MIN_IDLE_MS, Math.min(MAX_IDLE_MS, (lead / this.speed) * 1000)));
  }

  pause(): void {
    if (this.state !== 'running') return;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.state = 'paused';
    this.postState();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.reanchor();
    this.history = [];
    this.postState();
    this.schedule(0);
  }

  setSpeed(speed: number): void {
    this.speed = normalizeSpeed(speed);
    this.reanchor();
    this.history = [];
  }

  setParams(edits: ParamEdit[]): void {
    for (const e of edits) {
      try {
        this.stepper.setParam(e.element, e.param, e.value);
      } catch (err) {
        this.post({ type: 'error', id: this.id, message: `${e.element}.${e.param}: ${errorText(err)}`, code: errorCode(err), fatal: false });
      }
    }
    if (this.state === 'running') this.schedule(0);
  }

  finish(state: 'stopped' | 'finished'): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.state === 'stopped' || this.state === 'finished') return;
    this.state = state;
    this.postState();
    this.onEnd(this.id);
  }

  private fail(e: unknown): void {
    this.post({ type: 'error', id: this.id, message: errorText(e), code: errorCode(e), fatal: true });
    this.finish('stopped');
  }
}

function normalizeSpeed(speed: number | undefined): number {
  if (speed === undefined) return 1;
  return speed > 0 ? speed : 1;
}

export class SimHost {
  private readonly sessions = new Map<number, Session>();

  constructor(
    private readonly post: PostFn,
    private readonly clock: HostClock = realClock,
  ) {}

  /** Number of live interactive sessions (tests / diagnostics). */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Stop every session (their timers are cleared). */
  dispose(): void {
    for (const s of [...this.sessions.values()]) s.finish('stopped');
  }

  handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'run':
        this.run(msg.id, msg.netlists, msg.abort);
        return;
      case 'interactive':
        this.startSession(msg.id, msg);
        return;
      case 'control': {
        const s = this.sessions.get(msg.id);
        if (!s) return;
        if (msg.action === 'pause') s.pause();
        else if (msg.action === 'resume') s.resume();
        else s.finish('stopped');
        return;
      }
      case 'speed':
        this.sessions.get(msg.id)?.setSpeed(msg.speed);
        return;
      case 'params':
        this.sessions.get(msg.id)?.setParams(msg.edits);
        return;
      case 'cancel':
        // a batch run has already finished when this message is read; sessions stop
        this.sessions.get(msg.id)?.finish('stopped');
        return;
    }
  }

  private run(id: number, netlists: Netlist[], abort?: SharedArrayBuffer): void {
    const flag = abort ? new Int32Array(abort) : null;
    const signal = flag ? { get aborted() { return Atomics.load(flag, 0) !== 0; } } : undefined;
    let lastProgress = -Infinity;
    const results: AnalysisResult[][] = [];
    try {
      netlists.forEach((netlist, k) => {
        results.push(
          runAnalyses(netlist, {
            signal,
            onProgress: (fraction, message) => {
              const now = this.clock.now();
              if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
              lastProgress = now;
              this.post({ type: 'progress', id, fraction: (k + fraction) / netlists.length, ...(message ? { message } : {}) });
            },
          }),
        );
      });
    } catch (e) {
      this.post({ type: 'error', id, message: errorText(e), code: errorCode(e), fatal: true });
      return;
    }
    if (flag && Atomics.load(flag, 0) !== 0) {
      this.post({ type: 'error', id, message: 'Simulation cancelled', code: 'cancelled', fatal: true });
      return;
    }
    this.post({ type: 'results', id, results });
  }

  private startSession(id: number, msg: Extract<ToWorker, { type: 'interactive' }>): void {
    this.sessions.get(id)?.finish('stopped');
    let stepper: TransientStepper;
    try {
      stepper = createTransientStepper(msg.netlist, {
        tstep: msg.options.tstep,
        tmax: msg.options.tmax,
        uic: msg.options.uic,
        saves: msg.options.saves,
      });
    } catch (e) {
      this.post({ type: 'error', id, message: errorText(e), code: errorCode(e), fatal: true });
      return;
    }
    const warnings = (stepper as { warnings?: string[] }).warnings ?? [];
    this.post({ type: 'started', id, vectors: stepper.vectorNames(), warnings: [...warnings] });
    const session = new Session(id, stepper, msg.options, this.post, this.clock, (sid) => this.sessions.delete(sid));
    this.sessions.set(id, session);
    session.start();
  }
}
