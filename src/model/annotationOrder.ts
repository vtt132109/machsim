/**
 * Drawing order of the annotations of a sheet (Edit > Order), pure.
 *
 * Graphic shapes (lines, rectangles, pictures ...) and text notes / comments are drawn below the
 * parts. Until the learner reorders anything the order is the one the file always had: shapes
 * first, then the notes, each in list order, so text sits on top of graphics. "Bring to front" and
 * "Send to back" let a filled rectangle sit under a caption (back) or hide a part of a picture
 * (front), "Bring forward" / "Send backward" move one step.
 *
 * The order is stored as `z` on the items (higher = drawn later = on top). Once a sheet has been
 * reordered every annotation has a `z`; an item without one (added afterwards) counts as the
 * top-most so a new annotation never disappears under old ones. A sheet nobody reordered has no
 * `z` anywhere and is drawn exactly as before.
 *
 *   annotationStack(sheet)                  bottom -> top
 *   reorderAnnotations(sheet, refs, 'front')  a sheet with the items moved (same sheet if no change)
 */
import type { Sheet } from './types';

export type AnnotationKind = 'shape' | 'note';

export interface AnnotationRef {
  kind: AnnotationKind;
  id: string;
}

export type OrderOp = 'front' | 'back' | 'forward' | 'backward';

interface Entry extends AnnotationRef {
  z: number | undefined;
  /** position in the default stack: shapes in list order, then notes */
  base: number;
}

function entries(sheet: Pick<Sheet, 'shapes' | 'notes'>): Entry[] {
  const out: Entry[] = [];
  for (const s of sheet.shapes ?? []) out.push({ kind: 'shape', id: s.id, z: s.z, base: out.length });
  for (const n of sheet.notes) out.push({ kind: 'note', id: n.id, z: n.z, base: out.length });
  return out;
}

/** The annotations of a sheet from the bottom to the top of the drawing. */
export function annotationStack(sheet: Pick<Sheet, 'shapes' | 'notes'>): AnnotationRef[] {
  const list = entries(sheet);
  const anyZ = list.some((e) => e.z !== undefined);
  if (!anyZ) return list.map(({ kind, id }) => ({ kind, id }));
  const top = Math.max(...list.map((e) => e.z ?? -Infinity));
  // items that were never ordered (added later) go on top, in their default order
  const key = (e: Entry) => (e.z !== undefined ? e.z : top + 1 + e.base);
  return [...list].sort((a, b) => key(a) - key(b) || a.base - b.base).map(({ kind, id }) => ({ kind, id }));
}

/** True when some annotation of the sheet carries a drawing order. */
export function hasDrawingOrder(sheet: Pick<Sheet, 'shapes' | 'notes'>): boolean {
  return entries(sheet).some((e) => e.z !== undefined);
}

/** Position of every annotation in the stack: "kind:id" -> index (0 = bottom). */
export function stackIndex(sheet: Pick<Sheet, 'shapes' | 'notes'>): Map<string, number> {
  return new Map(annotationStack(sheet).map((r, i) => [`${r.kind}:${r.id}`, i]));
}

const same = (a: readonly AnnotationRef[], b: readonly AnnotationRef[]) => a.length === b.length && a.every((x, i) => x.kind === b[i].kind && x.id === b[i].id);

/** The stack after moving `moved` according to `op`. */
export function movedStack(stack: readonly AnnotationRef[], moved: readonly AnnotationRef[], op: OrderOp): AnnotationRef[] {
  const key = (r: AnnotationRef) => `${r.kind}:${r.id}`;
  const picked = new Set(moved.map(key));
  const selected = stack.filter((r) => picked.has(key(r)));
  const rest = stack.filter((r) => !picked.has(key(r)));
  if (!selected.length) return [...stack];
  if (op === 'front') return [...rest, ...selected];
  if (op === 'back') return [...selected, ...rest];
  const out = [...stack];
  if (op === 'forward') {
    // from the top down, each selected item swaps with the unselected item above it
    for (let i = out.length - 2; i >= 0; i--) {
      if (picked.has(key(out[i])) && !picked.has(key(out[i + 1]))) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (picked.has(key(out[i])) && !picked.has(key(out[i - 1]))) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out;
}

/**
 * The sheet with the chosen annotations moved. Every annotation gets a `z` equal to its position,
 * so the result no longer depends on list order. The SAME sheet comes back when the order does
 * not change (already on top, nothing chosen ...).
 */
export function reorderAnnotations(sheet: Sheet, moved: readonly AnnotationRef[], op: OrderOp): Sheet {
  const before = annotationStack(sheet);
  const after = movedStack(before, moved, op);
  if (same(before, after)) return sheet;
  const pos = new Map(after.map((r, i) => [`${r.kind}:${r.id}`, i]));
  return {
    ...sheet,
    notes: sheet.notes.map((n) => ({ ...n, z: pos.get(`note:${n.id}`) ?? n.z })),
    ...(sheet.shapes ? { shapes: sheet.shapes.map((s) => ({ ...s, z: pos.get(`shape:${s.id}`) ?? s.z })) } : {}),
  };
}

/** Annotations of a selection (parts, wires ... are ignored). */
export function annotationRefs(sel: readonly { kind: string; id: string }[]): AnnotationRef[] {
  return sel.filter((s): s is AnnotationRef => s.kind === 'shape' || s.kind === 'note').map((s) => ({ kind: s.kind, id: s.id }));
}
