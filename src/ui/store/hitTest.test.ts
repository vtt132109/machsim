import { describe, expect, it } from 'vitest';
import type { Sheet } from '../../model/types';
import { newSheet } from '../../model/types';
import { hitTest, itemsInRect, nearestPin } from './hitTest';
import { testLookup } from './testParts';

function sheet(): Sheet {
  return {
    ...newSheet('s1', 'Sheet 1'),
    parts: [
      { id: 'r1', partId: 'test/resistor', refdes: 'R1', x: 100, y: 100, rotation: 0, mirror: false, params: { value: '1k' } },
      { id: 'c1', partId: 'test/capacitor', refdes: 'C1', x: 300, y: 100, rotation: 0, mirror: false, params: { value: '1u' } },
    ],
    wires: [
      {
        id: 'w1',
        points: [
          { x: 130, y: 100 },
          { x: 300, y: 100 },
          { x: 300, y: 80 },
        ],
      },
    ],
    labels: [{ id: 'l1', x: 200, y: 100, name: 'OUT', rotation: 0 }],
    probes: [],
    notes: [{ id: 'n1', x: 400, y: 300, text: 'Hello\nWorld', size: 12 }],
  };
}

const opts = { lookup: testLookup, tolerance: 4, pinRadius: 5 };

describe('hitTest', () => {
  it('prefers pins over the part body', () => {
    expect(hitTest(sheet(), { x: 72, y: 101 }, opts)).toEqual({ kind: 'pin', partId: 'r1', pin: '1', x: 70, y: 100, dir: 'left' });
  });
  it('hits the part body inside its bounding box', () => {
    expect(hitTest(sheet(), { x: 100, y: 105 }, opts)).toEqual({ kind: 'part', id: 'r1' });
  });
  it('hits wires near a segment and reports the projected point', () => {
    expect(hitTest(sheet(), { x: 160, y: 102 }, opts)).toEqual({ kind: 'wire', id: 'w1', segment: 0, x: 160, y: 100 });
  });
  it('hits net labels above wires', () => {
    expect(hitTest(sheet(), { x: 210, y: 93 }, opts)).toEqual({ kind: 'label', id: 'l1' });
  });
  it('hits the refdes text of a part', () => {
    // R1 label centred at (100, 86)
    expect(hitTest(sheet(), { x: 100, y: 86 }, opts)).toEqual({ kind: 'partLabel', id: 'r1', which: 'ref' });
  });
  it('hits multi-line notes and returns null on empty space', () => {
    expect(hitTest(sheet(), { x: 410, y: 320 }, opts)).toEqual({ kind: 'note', id: 'n1' });
    expect(hitTest(sheet(), { x: 600, y: 600 }, opts)).toBeNull();
  });
  it('can exclude kinds', () => {
    expect(hitTest(sheet(), { x: 72, y: 100 }, { ...opts, exclude: ['pin'] })).toEqual({ kind: 'part', id: 'r1' });
  });
});

describe('nearestPin', () => {
  it('finds the closest pin within the radius only', () => {
    expect(nearestPin(sheet(), { x: 297, y: 83 }, 5, testLookup)?.refdes).toBe('C1');
    expect(nearestPin(sheet(), { x: 290, y: 60 }, 5, testLookup)).toBeNull();
  });
});

describe('itemsInRect', () => {
  it('inside mode selects only fully enclosed items', () => {
    const sel = itemsInRect(sheet(), { x: 60, y: 80, w: 100, h: 40 }, 'inside', testLookup);
    expect(sel).toEqual([{ kind: 'part', id: 'r1' }]);
  });
  it('crossing mode also selects touched items', () => {
    const sel = itemsInRect(sheet(), { x: 60, y: 80, w: 100, h: 40 }, 'crossing', testLookup);
    expect(sel).toEqual([
      { kind: 'part', id: 'r1' },
      { kind: 'wire', id: 'w1' },
    ]);
  });
  it('crossing a wire corner region without touching a segment does not select it', () => {
    const sel = itemsInRect(sheet(), { x: 310, y: 60, w: 20, h: 10 }, 'crossing', testLookup);
    expect(sel).toEqual([]);
  });
});
