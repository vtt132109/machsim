/**
 * Editing one ladder rung: add a contact in series or in parallel, replace it, remove it.
 *
 * Every function is pure (it returns a new tree), which is what the editor store needs for undo,
 * and it keeps the tree tidy: nested groups of the same kind are flattened and a group with one
 * item collapses into that item, so "add in parallel, remove the branch again" gives back exactly
 * the tree the learner started from.
 *
 * Paths address a node inside a rung's logic: `[]` is the whole logic, `[0, 1]` is item 1 of
 * item 0. The same paths come out of the layout (src/ladder/layout.ts), so a click on a drawn
 * contact leads straight to the node it belongs to.
 */
import type { LadderNode, LadderOutput, LadderRung } from './types';

/** A fresh empty rung with one normally-open contact and one coil (a rung that runs at once). */
export function newRung(id: string, input = 'I0.0', output = 'Q0.0'): LadderRung {
  return { id, logic: { kind: 'contact', type: 'no', address: input }, outputs: [{ kind: 'coil', address: output }] };
}

/** Flatten nested groups of the same kind and collapse one-item groups. */
export function normalizeNode(node: LadderNode): LadderNode {
  if (node.kind === 'contact' || node.kind === 'compare') return node;
  const items: LadderNode[] = [];
  for (const raw of node.items) {
    const item = normalizeNode(raw);
    if (item.kind === node.kind) items.push(...item.items);
    else items.push(item);
  }
  if (items.length === 1) return items[0];
  return { kind: node.kind, items };
}

/** The node a path points at, or undefined when the path leads nowhere. */
export function nodeAt(logic: LadderNode | undefined, path: readonly number[]): LadderNode | undefined {
  let node = logic;
  for (const i of path) {
    if (!node || (node.kind !== 'series' && node.kind !== 'parallel')) return undefined;
    node = node.items[i];
  }
  return node;
}

type Mapper = (node: LadderNode) => LadderNode | null;

function mapAt(node: LadderNode, path: readonly number[], fn: Mapper): LadderNode | null {
  if (path.length === 0) return fn(node);
  if (node.kind !== 'series' && node.kind !== 'parallel') return node;
  const i = path[0];
  if (i < 0 || i >= node.items.length) return node;
  const next = mapAt(node.items[i], path.slice(1), fn);
  const items = node.items.slice();
  if (next === null) items.splice(i, 1);
  else items[i] = next;
  if (items.length === 0) return null;
  return normalizeNode({ kind: node.kind, items });
}

/** Replace the node at `path` (the logic itself when the path is empty). */
export function replaceNode(logic: LadderNode | undefined, path: readonly number[], next: LadderNode): LadderNode {
  if (!logic) return next;
  return mapAt(logic, path, () => next) ?? next;
}

/** Remove the node at `path`; undefined when the rung is left without logic (always true). */
export function removeNode(logic: LadderNode | undefined, path: readonly number[]): LadderNode | undefined {
  if (!logic) return undefined;
  return mapAt(logic, path, () => null) ?? undefined;
}

/** Insert `node` next to the one at `path`, in series (left or right of it). */
export function insertSeries(logic: LadderNode | undefined, path: readonly number[], node: LadderNode, side: 'before' | 'after' = 'after'): LadderNode {
  if (!logic) return node;
  return (
    mapAt(logic, path, (target) => normalizeNode({ kind: 'series', items: side === 'before' ? [node, target] : [target, node] })) ?? node
  );
}

/** Insert `node` next to the one at `path`, in parallel (above or below it). */
export function insertParallel(logic: LadderNode | undefined, path: readonly number[], node: LadderNode, side: 'above' | 'below' = 'below'): LadderNode {
  if (!logic) return node;
  return (
    mapAt(logic, path, (target) => normalizeNode({ kind: 'parallel', items: side === 'above' ? [node, target] : [target, node] })) ?? node
  );
}

/** A rung with its logic replaced (undefined logic = always true). */
export function withLogic(rung: LadderRung, logic: LadderNode | undefined): LadderRung {
  const next: LadderRung = { ...rung };
  if (logic) next.logic = logic;
  else delete next.logic;
  return next;
}

/** A rung with one coil replaced. */
export function withOutput(rung: LadderRung, index: number, output: LadderOutput): LadderRung {
  const outputs = rung.outputs.slice();
  if (index < 0 || index >= outputs.length) return rung;
  outputs[index] = output;
  return { ...rung, outputs };
}

/** A rung with one more coil (after `index`, or at the end). */
export function addOutput(rung: LadderRung, output: LadderOutput, index = rung.outputs.length - 1): LadderRung {
  const outputs = rung.outputs.slice();
  outputs.splice(Math.max(0, Math.min(outputs.length, index + 1)), 0, output);
  return { ...rung, outputs };
}

/** A rung with one coil removed (the last coil cannot be removed: a rung needs an output). */
export function removeOutput(rung: LadderRung, index: number): LadderRung {
  if (rung.outputs.length <= 1 || index < 0 || index >= rung.outputs.length) return rung;
  const outputs = rung.outputs.slice();
  outputs.splice(index, 1);
  return { ...rung, outputs };
}

/** Move a rung inside the program (clamped). */
export function moveRung(rungs: readonly LadderRung[], from: number, to: number): LadderRung[] {
  if (from < 0 || from >= rungs.length) return rungs.slice();
  const list = rungs.slice();
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
  return list;
}

/**
 * Path of a node inside a logic tree, by identity. The editing functions keep the node objects
 * they were given, so after an insert this finds where the new contact ended up (the tree is
 * normalized, so its place cannot be computed from the insert alone).
 */
export function pathOf(logic: LadderNode | undefined, target: LadderNode): number[] | null {
  const walk = (node: LadderNode, path: number[]): number[] | null => {
    if (node === target) return path;
    if (node.kind !== 'series' && node.kind !== 'parallel') return null;
    for (let i = 0; i < node.items.length; i++) {
      const hit = walk(node.items[i], [...path, i]);
      if (hit) return hit;
    }
    return null;
  };
  return logic ? walk(logic, []) : null;
}

/** Number of contacts and coils of a rung (the compiler's element count). */
export function rungElementCount(rung: LadderRung): number {
  const count = (node: LadderNode): number => (node.kind === 'contact' || node.kind === 'compare' ? 1 : node.items.reduce((a, n) => a + count(n), 0));
  return (rung.logic ? count(rung.logic) : 0) + rung.outputs.length;
}
