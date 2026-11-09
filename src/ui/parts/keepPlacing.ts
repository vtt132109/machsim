/**
 * "Reopen after placing" of the Select-a-component dialog (`PlaceComponentDialog`): place one
 * part, then open the dialog again at the same family so the next part is one double-click away.
 *
 *   keepPlacing(host, partId, reopen)   start a one-shot placement of `partId`; `reopen(partId)` is
 *                                       called once the part lands on a sheet. Returns a stop
 *                                       function; the watcher also stops by itself when the part is
 *                                       placed, when the learner presses Esc or picks another tool,
 *                                       when another part goes into the ghost, or when the
 *                                       placement was refused (a block inside itself, say).
 *
 * The order the editor store works in matters: placing a one-shot part first patches the tool back
 * to `select` (which notifies the store's subscribers) and only then tells the placement
 * listeners. A watcher that gave up the moment the tool stopped placing would therefore cancel the
 * reopen it is waiting for, so the decision is deferred (`host.defer`) until the placement
 * listeners have had their turn. `host` keeps this logic testable without a DOM or a real store.
 */
export interface PlaceHost {
  /** enter one-shot placement mode (the real store: `actions.startPlacing`) */
  startPlacing(partId: string, opts: { once: true }): void;
  /** listen for a part placed by a one-shot placement; returns the unsubscribe */
  onPartPlaced(cb: (instId: string, partId: string) => void): () => void;
  /** listen for editor-state changes (the tool among them); returns the unsubscribe */
  subscribe(listener: () => void): () => void;
  /** the part id in the placement ghost right now, or null when no placement is running */
  placingNow(): string | null;
  /** run `fn` after the current notification has finished (the real host: setTimeout 0) */
  defer(fn: () => void): void;
}

export function keepPlacing(host: PlaceHost, partId: string, reopen: (partId: string) => void): () => void {
  let done = false;
  let placed = false;
  const stop = (): void => {
    if (done) return;
    done = true;
    offPlaced();
    offStore();
  };
  const offPlaced = host.onPartPlaced((_instId, id) => {
    if (done || id !== partId) return;
    placed = true;
    stop();
    reopen(id);
  });
  const offStore = host.subscribe(() => {
    if (done || host.placingNow() === partId) return;
    host.defer(() => {
      if (!placed) stop();
    });
  });
  host.startPlacing(partId, { once: true });
  // refused (unknown part, a block that would nest itself, instructor mode): nothing to wait for
  if (host.placingNow() !== partId) stop();
  return stop;
}
