/**
 * Runs one script in the sandbox and answers its API calls (host side, no UI).
 *
 *   const run = startScript({ code, host, createWorker: browserWorkerFactory });
 *   const outcome = await run.done;      // { ok, value?, error?, line?, stopped?, timedOut? }
 *   run.stop();                          // terminate the worker at once (a stuck loop cannot ignore it)
 *
 * `host.call(method, args)` is the API implementation (session.ts `ScriptSession`). Calls are
 * answered one at a time in the order the script made them, so a script is deterministic. Log lines
 * go to `onLog`. The worker program is in workerProgram.ts; `workerSource(kind)` turns it into the
 * text a Worker runs, and `browserWorkerFactory` creates a Web Worker from a Blob (the page's
 * origin is not shared with it: it has no DOM, storage, network or file access).
 */
import { SCRIPT_LIMITS, SCRIPT_METHODS, type FromScriptWorker, type ScriptLogLevel, type ScriptWorkerFactory, type ScriptWorkerHandle, type ToScriptWorker } from './protocol';
import { SCRUBBED_GLOBALS, workerProgram } from './workerProgram';

export interface ScriptHost {
  call(method: string, args: unknown[]): Promise<unknown>;
}

export interface ScriptOutcome {
  ok: boolean;
  /** what the script returned (JSON data) */
  value?: unknown;
  error?: string;
  /** line of the script where the error happened, when known */
  line?: number;
  /** the user pressed Stop */
  stopped?: boolean;
  /** the time limit ran out */
  timedOut?: boolean;
}

export interface StartScriptOptions {
  code: string;
  host: ScriptHost;
  createWorker: ScriptWorkerFactory;
  /** which messaging the worker has: 'web' (default) or 'node' (worker_threads, tests) */
  kind?: 'web' | 'node';
  args?: string[];
  timeoutMs?: number;
  onLog?: (level: ScriptLogLevel, text: string) => void;
  /** override the method catalogue (tests) */
  methods?: readonly string[];
}

export interface ScriptRun {
  done: Promise<ScriptOutcome>;
  stop(): void;
}

/** Text the worker evaluates: a small adapter to the worker's messaging, then the program. */
export function workerSource(kind: 'web' | 'node'): string {
  const adapter =
    kind === 'web'
      ? 'var __post=self.postMessage.bind(self);var __add=self.addEventListener.bind(self);var __port={post:function(m){__post(m)},listen:function(cb){__add("message",function(e){cb(e.data)})}};'
      : 'var __wt=require("node:worker_threads");var __pp=__wt.parentPort;var __port={post:function(m){__pp.postMessage(m)},listen:function(cb){__pp.on("message",cb)}};';
  return `${adapter}var __name=function(f){return f};(${workerProgram.toString()})(__port,${JSON.stringify(SCRUBBED_GLOBALS)});`;
}

/** A Web Worker created from the program text (browser and Electron renderer). */
export const browserWorkerFactory: ScriptWorkerFactory = (source) => {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: 'machsim-script' });
  let failure: (m: string) => void = () => undefined;
  return {
    post: (msg: ToScriptWorker) => worker.postMessage(msg),
    onMessage: (listener) => worker.addEventListener('message', (e: MessageEvent<FromScriptWorker>) => listener(e.data)),
    onFailure: (listener) => {
      failure = listener;
      worker.addEventListener('error', (e: ErrorEvent) => failure(e.message || 'script worker failed'));
    },
    terminate: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  } satisfies ScriptWorkerHandle;
};

export function startScript(opts: StartScriptOptions): ScriptRun {
  const worker = opts.createWorker(workerSource(opts.kind ?? 'web'));
  let finish: (o: ScriptOutcome) => void = () => undefined;
  let finished = false;
  const done = new Promise<ScriptOutcome>((resolve) => {
    finish = (o) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(o);
    };
  });
  const timer = setTimeout(() => finish({ ok: false, timedOut: true, error: 'timeout' }), opts.timeoutMs ?? SCRIPT_LIMITS.timeoutMs);
  let queue: Promise<void> = Promise.resolve();
  let logged = 0;
  worker.onMessage((msg) => {
    if (finished) return;
    switch (msg.t) {
      case 'log':
        if (logged++ < SCRIPT_LIMITS.maxLogLines) opts.onLog?.(msg.level, msg.text);
        else if (logged === SCRIPT_LIMITS.maxLogLines + 1) opts.onLog?.('warn', '…');
        break;
      case 'call':
        // answered in order, one at a time
        queue = queue.then(async () => {
          if (finished) return;
          let reply: ToScriptWorker;
          try {
            const value = await opts.host.call(msg.method, msg.args);
            reply = { t: 'reply', id: msg.id, ok: true, value: value === undefined ? null : value };
          } catch (e) {
            reply = { t: 'reply', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          if (!finished) worker.post(reply);
        });
        break;
      case 'done':
        finish(msg.ok ? { ok: true, value: msg.value } : { ok: false, error: msg.error, ...(msg.line !== undefined ? { line: msg.line } : {}) });
        break;
    }
  });
  worker.onFailure((message) => finish({ ok: false, error: message }));
  worker.post({ t: 'run', code: opts.code, args: opts.args ?? [], methods: opts.methods ?? SCRIPT_METHODS });
  return {
    done,
    stop: () => finish({ ok: false, stopped: true, error: 'stopped' }),
  };
}
