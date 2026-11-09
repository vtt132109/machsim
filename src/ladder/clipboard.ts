/**
 * Copy, cut and paste of rungs and rung elements.
 *
 * A {@link LadderClip} holds rungs, one contact / comparison / group, or one coil. Every function is
 * pure (it returns the new rung list), so the editor gets one undo step per paste and the tests can
 * check the result. Pasted rungs get fresh ids (`newId`), because a rung id must be unique in the
 * design. The text form (`encodeLadderClip` / `decodeLadderClip`) travels through the system
 * clipboard, so rungs can be pasted into another design or another window, and a pasted text that is
 * not a ladder clip is recognised and ignored.
 */
import { addOutput, insertParallel, insertSeries, nodeAt, withLogic } from './edit';
import { LADDER_LIMITS, type LadderContactKind, type LadderNode, type LadderOutput, type LadderOutputKind, type LadderRung } from './types';

export type LadderClip =
  | { kind: 'rungs'; rungs: LadderRung[] }
  | { kind: 'node'; node: LadderNode }
  | { kind: 'coil'; output: LadderOutput };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Copy rungs `from` … `to` (0-based, inclusive, in any order). */
export function copyRungs(rungs: readonly LadderRung[], from: number, to: number = from): LadderClip | null {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(rungs.length - 1, Math.max(from, to));
  if (a > b) return null;
  return { kind: 'rungs', rungs: clone(rungs.slice(a, b + 1)) };
}

/** Copy the contact / comparison / group at `path` of a rung. */
export function copyNode(rung: LadderRung, path: readonly number[]): LadderClip | null {
  const node = nodeAt(rung.logic, path);
  return node ? { kind: 'node', node: clone(node) } : null;
}

/** Copy one coil of a rung. */
export function copyCoil(rung: LadderRung, index: number): LadderClip | null {
  const o = rung.outputs[index];
  return o ? { kind: 'coil', output: clone(o) } : null;
}

/** Remove rungs `from` … `to` and return what is left plus the clip. */
export function cutRungs(rungs: readonly LadderRung[], from: number, to: number = from): { rungs: LadderRung[]; clip: LadderClip | null } {
  const clip = copyRungs(rungs, from, to);
  if (!clip) return { rungs: rungs.slice(), clip: null };
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(rungs.length - 1, Math.max(from, to));
  return { rungs: [...rungs.slice(0, a), ...rungs.slice(b + 1)], clip };
}

/**
 * Paste rungs after position `after` (−1 = at the top). Returns the new list and the index range
 * of the pasted rungs. Rungs that would not fit are cut off: a program holds at most `max` rungs.
 */
export function pasteRungs(rungs: readonly LadderRung[], after: number, clip: LadderClip, newId: () => string, max = 2000): { rungs: LadderRung[]; from: number; to: number } | null {
  if (clip.kind !== 'rungs' || clip.rungs.length === 0) return null;
  const room = Math.max(0, max - rungs.length);
  const fresh = clip.rungs.slice(0, room).map((r) => ({ ...clone(r), id: newId() }));
  if (fresh.length === 0) return null;
  const at = Math.max(-1, Math.min(rungs.length - 1, after)) + 1;
  return { rungs: [...rungs.slice(0, at), ...fresh, ...rungs.slice(at)], from: at, to: at + fresh.length - 1 };
}

/** Paste a contact / group next to the element at `path` (in series after it, or in parallel below it). */
export function pasteNode(rung: LadderRung, path: readonly number[], clip: LadderClip, how: 'series' | 'parallel' = 'series'): { rung: LadderRung; node: LadderNode } | null {
  if (clip.kind !== 'node') return null;
  const node = clone(clip.node);
  const logic = how === 'parallel' ? insertParallel(rung.logic, path, node) : insertSeries(rung.logic, path, node);
  return { rung: withLogic(rung, logic), node };
}

/** Paste a coil after output `index` of a rung. */
export function pasteCoil(rung: LadderRung, index: number, clip: LadderClip): LadderRung | null {
  if (clip.kind !== 'coil') return null;
  return addOutput(rung, clone(clip.output), index);
}

/** First line of the text form: lets a paste tell a ladder clip from any other text. */
export const LADDER_CLIP_MAGIC = 'machsim-ladder-clip';

/** The clip as text for the system clipboard. */
export function encodeLadderClip(clip: LadderClip): string {
  return `${LADDER_CLIP_MAGIC}\n${JSON.stringify({ version: 1, ...clip })}`;
}

const CONTACTS: LadderContactKind[] = ['no', 'nc', 'rising', 'falling'];
const OUTPUTS: LadderOutputKind[] = ['coil', 'coil-not', 'set', 'reset', 'ton', 'tof', 'ctu', 'ctd', 'creset', 'mov', 'add', 'sub', 'mul', 'div', 'call'];
const COMPARES = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function readNode(v: unknown, depth = 0): LadderNode | null {
  if (!isObj(v) || depth > 12) return null;
  if (v.kind === 'contact') {
    const address = str(v.address);
    if (address === undefined || !CONTACTS.includes(v.type as LadderContactKind)) return null;
    return { kind: 'contact', type: v.type as LadderContactKind, address, ...(str(v.comment) !== undefined ? { comment: str(v.comment) } : {}) };
  }
  if (v.kind === 'compare') {
    const left = str(v.left);
    const right = str(v.right);
    if (left === undefined || right === undefined || !COMPARES.includes(v.op as string)) return null;
    return { kind: 'compare', op: v.op as 'eq', left, right, ...(str(v.comment) !== undefined ? { comment: str(v.comment) } : {}) };
  }
  if ((v.kind === 'series' || v.kind === 'parallel') && Array.isArray(v.items) && v.items.length > 0) {
    const items = v.items.map((x) => readNode(x, depth + 1));
    if (items.some((x) => x === null)) return null;
    return { kind: v.kind, items: items as LadderNode[] };
  }
  return null;
}

function readOutput(v: unknown): LadderOutput | null {
  if (!isObj(v) || !OUTPUTS.includes(v.kind as LadderOutputKind)) return null;
  const address = str(v.address);
  if (address === undefined) return null;
  const out: LadderOutput = { kind: v.kind as LadderOutputKind, address };
  for (const k of ['preset', 'a', 'b', 'block', 'comment'] as const) {
    const s = str(v[k]);
    if (s !== undefined) out[k] = s;
  }
  if (isObj(v.args)) {
    const args: Record<string, string> = {};
    for (const [k, x] of Object.entries(v.args)) if (typeof x === 'string') args[k] = x;
    out.args = args;
  }
  return out;
}

function readRung(v: unknown): LadderRung | null {
  if (!isObj(v)) return null;
  const outs = Array.isArray(v.outputs) ? v.outputs.map(readOutput) : [];
  if (outs.length === 0 || outs.some((o) => o === null)) return null;
  const logic = v.logic === undefined || v.logic === null ? undefined : readNode(v.logic);
  if (v.logic !== undefined && v.logic !== null && !logic) return null;
  return {
    id: str(v.id) ?? 'rung',
    ...(str(v.comment) !== undefined ? { comment: str(v.comment) } : {}),
    ...(logic ? { logic } : {}),
    outputs: outs as LadderOutput[],
    ...(v.disabled === true ? { disabled: true } : {}),
  };
}

/** Read a clip back; null when the text is not a ladder clip (or is damaged). */
export function decodeLadderClip(text: string): LadderClip | null {
  if (!text.startsWith(LADDER_CLIP_MAGIC)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(LADDER_CLIP_MAGIC.length).trim());
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  if (raw.kind === 'rungs' && Array.isArray(raw.rungs)) {
    const rungs = raw.rungs.map(readRung);
    if (rungs.length === 0 || rungs.length > LADDER_LIMITS.localBits || rungs.some((r) => r === null)) return null;
    return { kind: 'rungs', rungs: rungs as LadderRung[] };
  }
  if (raw.kind === 'node') {
    const node = readNode(raw.node);
    return node ? { kind: 'node', node } : null;
  }
  if (raw.kind === 'coil') {
    const output = readOutput(raw.output);
    return output ? { kind: 'coil', output } : null;
  }
  return null;
}
