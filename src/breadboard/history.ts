/**
 * Bounded undo / redo history of immutable snapshots (breadboard layouts).
 *
 *   let h = createHistory(layout);
 *   h = pushHistory(h, edited);     // no-op when `edited` equals the present snapshot
 *   h = undo(h);  h.present  …      // redo(h) walks forward again
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  limit: number;
}

export function createHistory<T>(present: T, limit = 100): History<T> {
  return { past: [], present, future: [], limit: Math.max(1, limit) };
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (same(h.present, next)) return h;
  const past = [...h.past, h.present];
  if (past.length > h.limit) past.splice(0, past.length - h.limit);
  return { ...h, past, present: next, future: [] };
}

/** Replace the present snapshot without recording a step (e.g. an external change). */
export function resetHistory<T>(h: History<T>, present: T): History<T> {
  if (same(h.present, present)) return h;
  return { ...h, past: [], present, future: [] };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const past = h.past.slice(0, -1);
  return { ...h, past, present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...future] = h.future;
  return { ...h, past: [...h.past, h.present], present: next, future };
}
