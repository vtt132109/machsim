/**
 * Same-thread simulation transport: SimHost runs on the calling thread. Requests are handled on
 * a macrotask and replies delivered asynchronously, so callers observe the same ordering as with
 * the worker. Used by tests and (through createLazyInProcessTransport) when module workers are
 * unavailable. Importing this module pulls in the whole engine.
 */
import { SimHost, realClock, type HostClock } from './host';
import type { SimTransport } from './client';
import type { FromWorker } from './protocol';

export function createInProcessTransport(clock: HostClock = realClock): SimTransport {
  let listener: (msg: FromWorker) => void = () => undefined;
  let alive = true;
  const host = new SimHost((msg) => {
    if (alive) queueMicrotask(() => alive && listener(msg));
  }, clock);
  return {
    post: (msg) => {
      // structuredClone mimics postMessage: the host never shares objects with the caller
      const copy = structuredClone(msg);
      clock.setTimeout(() => alive && host.handle(copy), 0);
    },
    onMessage: (l) => {
      listener = l;
    },
    terminate: () => {
      alive = false;
      host.dispose();
    },
  };
}
