/**
 * Simulation Web Worker (Vite module worker).
 *
 *   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
 *
 * The worker owns the simulation engine; the UI talks to it with the messages of protocol.ts
 * (through SimClient in client.ts). All logic lives in SimHost so it can also run in-process.
 */
import { SimHost } from './host';
import type { FromWorker, ToWorker } from './protocol';

interface WorkerScope {
  postMessage(message: FromWorker, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
}

const scope = self as unknown as WorkerScope;
const host = new SimHost((msg, transfer) => scope.postMessage(msg, transfer ?? []));

scope.addEventListener('message', (event) => {
  try {
    host.handle(event.data);
  } catch (e) {
    const id = typeof (event.data as { id?: unknown })?.id === 'number' ? (event.data as { id: number }).id : -1;
    scope.postMessage({ type: 'error', id, message: e instanceof Error ? e.message : String(e), code: 'internal', fatal: true }, []);
  }
});
