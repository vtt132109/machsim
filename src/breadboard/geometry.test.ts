import { describe, expect, it } from 'vitest';
import {
  allHoles,
  boardSpec,
  describeHole,
  describeStrip,
  gridToHole,
  holeName,
  holePosition,
  isValidHole,
  listStrips,
  nearestHole,
  parseHoleName,
  PITCH,
  stepHole,
  stripHoles,
  stripIdOf,
} from './geometry';
import type { BoardInstance } from './types';

const full: BoardInstance = { id: 'bb1', kind: 'full', x: 0, y: 0 };
const half: BoardInstance = { id: 'bb1', kind: 'half', x: 0, y: 0 };
const mini: BoardInstance = { id: 'm', kind: 'mini', x: 0, y: 0 };

describe('board specs', () => {
  it('has the standard sizes and hole counts', () => {
    expect(boardSpec('full').columns).toBe(63);
    expect(boardSpec('half').columns).toBe(30);
    expect(boardSpec('mini').columns).toBe(17);
    expect(boardSpec('full').holeCount).toBe(830);
    expect(boardSpec('half').holeCount).toBe(400);
    expect(boardSpec('mini').holeCount).toBe(170);
    expect(allHoles(full)).toHaveLength(830);
    expect(allHoles(half)).toHaveLength(400);
    expect(allHoles(mini)).toHaveLength(170);
    expect(boardSpec('full').width).toBeCloseTo(165.1, 6);
  });

  it('uses 2.54 mm pitch and a 7.62 mm channel between rows e and f', () => {
    const e = holePosition(full, { row: 'e', col: 10 })!;
    const f = holePosition(full, { row: 'f', col: 10 })!;
    const d = holePosition(full, { row: 'd', col: 10 })!;
    const e11 = holePosition(full, { row: 'e', col: 11 })!;
    expect(f.y - e.y).toBeCloseTo(7.62, 9);
    expect(e.y - d.y).toBeCloseTo(PITCH, 9);
    expect(e11.x - e.x).toBeCloseTo(PITCH, 9);
    const spec = boardSpec('full');
    expect(spec.channelY).toBeCloseTo((e.y + f.y) / 2, 9);
  });

  it('groups rail holes in fives with one-column gaps', () => {
    expect(boardSpec('full').railGroups[0]).toEqual([3, 4, 5, 6, 7]);
    expect(boardSpec('full').railGroups[1]).toEqual([9, 10, 11, 12, 13]);
    expect(boardSpec('full').railGroups[9]).toEqual([57, 58, 59, 60, 61]);
    expect(boardSpec('half').railColumns).toHaveLength(25);
    expect(boardSpec('half').railGroups[0]).toEqual([1, 2, 3, 4, 5]);
    expect(boardSpec('mini').hasRails).toBe(false);
  });

  it('offsets hole positions by the board origin', () => {
    const b: BoardInstance = { id: 'bb2', kind: 'full', x: 100, y: 40 };
    const p = holePosition(b, { row: 'a', col: 1 })!;
    const q = holePosition(full, { row: 'a', col: 1 })!;
    expect(p.x - q.x).toBe(100);
    expect(p.y - q.y).toBe(40);
  });
});

describe('hole validity and strips', () => {
  it('validates columns, rows and rail gaps', () => {
    expect(isValidHole(full, 'a', 1)).toBe(true);
    expect(isValidHole(full, 'j', 63)).toBe(true);
    expect(isValidHole(full, 'j', 64)).toBe(false);
    expect(isValidHole(full, 'top+', 3)).toBe(true);
    expect(isValidHole(full, 'top+', 8)).toBe(false);
    expect(isValidHole(full, 'top+', 1)).toBe(false);
    expect(isValidHole(mini, 'top+', 3)).toBe(false);
    expect(isValidHole(mini, 'e', 17)).toBe(true);
  });

  it('joins a–e and f–j of one column and keeps the halves apart', () => {
    expect(stripIdOf(full, 'a', 12)).toBe('bb1:12:ae');
    expect(stripIdOf(full, 'e', 12)).toBe(stripIdOf(full, 'a', 12));
    expect(stripIdOf(full, 'f', 12)).toBe('bb1:12:fj');
    expect(stripIdOf(full, 'f', 12)).not.toBe(stripIdOf(full, 'e', 12));
    expect(stripIdOf(full, 'e', 13)).not.toBe(stripIdOf(full, 'e', 12));
    expect(stripIdOf(full, 'top+', 8)).toBeNull();
  });

  it('makes each rail one strip, or two halves when split', () => {
    expect(stripIdOf(full, 'top+', 3)).toBe(stripIdOf(full, 'top+', 61));
    expect(stripIdOf(full, 'top+', 3)).not.toBe(stripIdOf(full, 'top-', 3));
    const split: BoardInstance = { ...full, splitRails: true };
    expect(stripIdOf(split, 'top+', 31)).toBe('bb1:top+:L');
    expect(stripIdOf(split, 'top+', 33)).toBe('bb1:top+:R');
    expect(listStrips(full)).toHaveLength(63 * 2 + 4);
    expect(listStrips(split)).toHaveLength(63 * 2 + 8);
    expect(stripHoles(split, 'bb1:top+:L')).toHaveLength(25);
    expect(stripHoles(full, 'bb1:12:ae').map((h) => h.row)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('names and lookup', () => {
  it('formats and parses learner-friendly hole names', () => {
    expect(holeName({ board: 'bb1', row: 'e', col: 15 })).toBe('e15');
    expect(holeName({ board: 'bb1', row: 'top+', col: 12 })).toBe('top+12');
    expect(holeName({ board: 'bb2', row: 'e', col: 15 }, true)).toBe('bb2/e15');
    expect(parseHoleName('E15')).toEqual({ board: 'bb1', row: 'e', col: 15 });
    expect(parseHoleName('bb2/top-7')).toEqual({ board: 'bb2', row: 'top-', col: 7 });
    expect(parseHoleName('k3')).toBeNull();
    expect(describeHole({ board: 'bb1', row: 'e', col: 15 }).vi).toBe('lỗ e15 (hàng e, cột 15)');
    expect(describeHole({ board: 'bb1', row: 'top+', col: 12 }).vi).toBe('thanh nguồn + phía trên, cột 12');
    expect(describeHole({ board: 'bb1', row: 'bot-', col: 9 }).en).toBe('bottom − rail, column 9');
    expect(describeStrip('bb1:12:ae').vi).toBe('cột 12, hàng a–e');
    expect(describeStrip('bb1:top+:L').en).toBe('top + rail (left half)');
  });

  it('finds the nearest hole to a bench position', () => {
    const p = holePosition(full, { row: 'e', col: 15 })!;
    expect(nearestHole([full], p.x + 0.8, p.y - 0.7)).toEqual({ board: 'bb1', row: 'e', col: 15 });
    const ch = boardSpec('full').channelY;
    expect(nearestHole([full], p.x, ch)).toBeNull();
    const r = holePosition(full, { row: 'top-', col: 9 })!;
    expect(nearestHole([full], r.x, r.y + 0.5)).toEqual({ board: 'bb1', row: 'top-', col: 9 });
  });

  it('snaps grid positions to holes and rejects the channel', () => {
    // row e is at 8.5 pitches, f at 11.5
    expect(gridToHole(full, 10, 8.5)).toEqual({ board: 'bb1', row: 'e', col: 10 });
    expect(gridToHole(full, 10, 10)).toBeNull();
    expect(gridToHole(full, 10, 10.6, 1.01)).toEqual({ board: 'bb1', row: 'f', col: 10 });
    expect(gridToHole(full, 10.5, 8.5)).toBeNull();
  });

  it('steps a keyboard cursor across rows, the channel and rail gaps', () => {
    expect(stepHole(full, { board: 'bb1', row: 'e', col: 15 }, 0, 1)).toEqual({ board: 'bb1', row: 'f', col: 15 });
    expect(stepHole(full, { board: 'bb1', row: 'a', col: 3 }, 0, -1)).toEqual({ board: 'bb1', row: 'top-', col: 3 });
    expect(stepHole(full, { board: 'bb1', row: 'a', col: 8 }, 0, -1)).toEqual({ board: 'bb1', row: 'top-', col: 7 });
    expect(stepHole(full, { board: 'bb1', row: 'top+', col: 7 }, 1, 0)).toEqual({ board: 'bb1', row: 'top+', col: 9 });
    expect(stepHole(full, { board: 'bb1', row: 'a', col: 63 }, 1, 0)).toEqual({ board: 'bb1', row: 'a', col: 63 });
  });
});
