/**
 * Edit > Order: bring to front / send to back for graphics and text — the model, the editor
 * action, the hit test, the picture and the file format.
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../ui/store/editorStore';
import { testLookup } from '../ui/store/testParts';
import { hitTest } from '../ui/store/hitTest';
import { sheetToSvg } from '../ui/editor/exportImage';
import { annotationRefs, annotationStack, hasDrawingOrder, movedStack, reorderAnnotations, stackIndex, type AnnotationRef } from './annotationOrder';
import { parseDesign, serializeDesign } from './serialize';
import type { Sheet } from './types';
import { newSheet } from './types';
import { setLang } from '../i18n';

setLang('en');

const ref = (kind: 'shape' | 'note', id: string): AnnotationRef => ({ kind, id });
const ids = (list: AnnotationRef[]) => list.map((r) => r.id).join(',');

function sheet(): Sheet {
  return {
    ...newSheet('s', 'S'),
    shapes: [
      { id: 'a', kind: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], fill: '#ccc' },
      { id: 'b', kind: 'rect', points: [{ x: 50, y: 50 }, { x: 150, y: 150 }], fill: '#999' },
    ],
    notes: [
      { id: 'n1', x: 10, y: 10, text: 'first' },
      { id: 'n2', x: 60, y: 60, text: 'second' },
    ],
  };
}

describe('the default order is the one files always had', () => {
  it('shapes first, then notes, each in list order; no z anywhere', () => {
    const s = sheet();
    expect(hasDrawingOrder(s)).toBe(false);
    expect(ids(annotationStack(s))).toBe('a,b,n1,n2');
  });
});

describe('moving in the order', () => {
  it('bring to front puts the item on top and keeps the others as they were', () => {
    const s = reorderAnnotations(sheet(), [ref('shape', 'a')], 'front');
    expect(ids(annotationStack(s))).toBe('b,n1,n2,a');
    expect(hasDrawingOrder(s)).toBe(true);
  });

  it('send to back puts a note under the shapes', () => {
    const s = reorderAnnotations(sheet(), [ref('note', 'n2')], 'back');
    expect(ids(annotationStack(s))).toBe('n2,a,b,n1');
  });

  it('one step forward / backward swaps with the neighbour', () => {
    const s = sheet();
    expect(ids(annotationStack(reorderAnnotations(s, [ref('shape', 'a')], 'forward')))).toBe('b,a,n1,n2');
    expect(ids(annotationStack(reorderAnnotations(s, [ref('note', 'n1')], 'backward')))).toBe('a,n1,b,n2');
  });

  it('several selected items move together and keep their relative order', () => {
    const picked = [ref('shape', 'a'), ref('note', 'n1')];
    expect(ids(movedStack(annotationStack(sheet()), picked, 'front'))).toBe('b,n2,a,n1');
    expect(ids(movedStack(annotationStack(sheet()), picked, 'back'))).toBe('a,n1,b,n2');
    expect(ids(movedStack(annotationStack(sheet()), picked, 'forward'))).toBe('b,a,n2,n1');
  });

  it('moving past the end is a no-op and returns the same sheet', () => {
    const s = sheet();
    expect(reorderAnnotations(s, [ref('note', 'n2')], 'front')).toBe(s);
    expect(reorderAnnotations(s, [ref('note', 'n2')], 'forward')).toBe(s);
    expect(reorderAnnotations(s, [ref('shape', 'a')], 'back')).toBe(s);
    expect(reorderAnnotations(s, [], 'front')).toBe(s);
    expect(reorderAnnotations(s, [ref('shape', 'missing')], 'front')).toBe(s);
  });

  it('after a reorder every annotation has a position, and a new one is on top', () => {
    const s = reorderAnnotations(sheet(), [ref('shape', 'a')], 'front');
    expect(s.shapes!.map((x) => x.z)).toEqual([3, 0]);
    expect(s.notes.map((x) => x.z)).toEqual([1, 2]);
    const withNew: Sheet = { ...s, shapes: [...s.shapes!, { id: 'c', kind: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }] };
    expect(ids(annotationStack(withNew)).endsWith(',c')).toBe(true);
    expect(stackIndex(withNew).get('shape:c')).toBe(4);
  });

  it('annotationRefs ignores parts and wires', () => {
    expect(annotationRefs([{ kind: 'part', id: 'p' }, { kind: 'shape', id: 's' }, { kind: 'wire', id: 'w' }, { kind: 'note', id: 'n' }])).toEqual([ref('shape', 's'), ref('note', 'n')]);
  });
});

describe('order in the editor', () => {
  function setup() {
    const ed = createEditor({ lookup: testLookup });
    const a = ed.actions.addShape({ kind: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], fill: '#ddd' });
    const b = ed.actions.addShape({ kind: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], fill: '#888' });
    const n = ed.actions.addNote({ x: 20, y: 20 }, 'caption')!;
    return { ed, a, b, n };
  }
  const sheetOf = (ed: ReturnType<typeof setup>['ed']) => ed.getState().design.sheets[0];

  it('orders the selection as one undo step', () => {
    const { ed, a, b, n } = setup();
    ed.actions.select([{ kind: 'shape', id: a }]);
    const before = ed.getState().design;
    expect(ed.actions.orderSelection('front')).toBe(true);
    expect(ids(annotationStack(sheetOf(ed)))).toBe(`${b},${n},${a}`);
    ed.actions.undo();
    expect(ed.getState().design).toBe(before);
  });

  it('does nothing without a graphic or text selected, or when already there', () => {
    const { ed, a, n } = setup();
    expect(ed.actions.orderSelection('front')).toBe(false);
    ed.actions.select([{ kind: 'note', id: n }]);
    expect(ed.actions.orderSelection('front')).toBe(false);
    ed.actions.select([{ kind: 'shape', id: a }]);
    expect(ed.actions.orderSelection('back')).toBe(false);
  });

  it('a click lands on the top-most of two overlapping filled shapes, and follows the order', () => {
    const { ed, a, b } = setup();
    const at = { x: 50, y: 50 };
    const top = () => hitTest(sheetOf(ed), at, { lookup: testLookup, exclude: ['note'] });
    expect(top()).toEqual({ kind: 'shape', id: b });
    ed.actions.select([{ kind: 'shape', id: b }]);
    ed.actions.orderSelection('back');
    expect(top()).toEqual({ kind: 'shape', id: a });
  });

  it('the picture draws them in the new order (the one sent to back comes first)', () => {
    const { ed, a, b } = setup();
    ed.actions.select([{ kind: 'shape', id: b }]);
    ed.actions.orderSelection('back');
    const { design } = ed.getState();
    const svg = sheetToSvg(design, design.sheets[0].id, testLookup).svg;
    const group = svg.slice(svg.indexOf('class="ms-layer-annotations"'));
    expect(group.indexOf('#888')).toBeGreaterThanOrEqual(0);
    expect(group.indexOf('#888')).toBeLessThan(group.indexOf('#ddd'));
    expect(group.indexOf('caption')).toBeGreaterThan(group.indexOf('#ddd'));
    expect(a).toBeTruthy();
  });

  it('a sheet nobody reordered is drawn exactly as before (separate shape and note layers)', () => {
    const { ed } = setup();
    const { design } = ed.getState();
    const svg = sheetToSvg(design, design.sheets[0].id, testLookup).svg;
    expect(svg).toContain('class="ms-layer-shapes"');
    expect(svg).toContain('class="ms-layer-notes"');
    expect(svg).not.toContain('class="ms-layer-annotations"');
  });
});

describe('order in the design file', () => {
  it('is stable over a save and reopen, including locked items', () => {
    const ed = createEditor({ lookup: testLookup });
    const a = ed.actions.addShape({ kind: 'rect', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], locked: true });
    ed.actions.addShape({ kind: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
    ed.actions.addNote({ x: 5, y: 5 }, 'x');
    ed.actions.select([{ kind: 'shape', id: a }]);
    ed.actions.orderSelection('front');
    const text = serializeDesign(ed.getState().design);
    expect(text).toContain('"z"');
    const back = parseDesign(text);
    // the file is written in the reader's key order from the first save on
    const again = serializeDesign(back);
    expect(serializeDesign(parseDesign(again))).toBe(again);
    expect(ids(annotationStack(back.sheets[0]))).toBe(ids(annotationStack(ed.getState().design.sheets[0])));
  });

  it('rejects a z that is not a whole number', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.addNote({ x: 0, y: 0 }, 'x');
    const raw = JSON.parse(serializeDesign(ed.getState().design));
    raw.sheets[0].notes[0].z = 1.5;
    expect(() => parseDesign(JSON.stringify(raw))).toThrow(/whole number/);
  });
});
