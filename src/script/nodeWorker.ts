/**
 * Script sandbox on Node's worker_threads (tests and tools that run outside a browser): the same
 * program text as the browser worker (runner.ts `workerSource('node')`), so the tests exercise the
 * code a real script runs in. Not imported by the application.
 */
import { Worker } from 'node:worker_threads';
import type { FromScriptWorker, ScriptWorkerFactory } from './protocol';

export const nodeWorkerFactory: ScriptWorkerFactory = (source) => {
  const worker = new Worker(source, { eval: true });
  return {
    post: (msg) => worker.postMessage(msg),
    onMessage: (listener) => worker.on('message', (m: FromScriptWorker) => listener(m)),
    onFailure: (listener) => {
      worker.on('error', (e: Error) => listener(e.message));
      worker.on('exit', (code) => {
        if (code !== 0) listener(`worker exited with code ${code}`);
      });
    },
    terminate: () => {
      void worker.terminate();
    },
  };
};
