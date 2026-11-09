import { describe, expect, it } from 'vitest';
import { HEX_SEGMENTS, sevenSegLevels } from './parts';

describe('7-segment indicator levels', () => {
  it('uses explicit per-segment levels first', () => {
    const l = sevenSegLevels({ level: 1, segments: { a: 1, g: 0.5, dp: 2 } });
    expect(l).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0.5, dp: 1 });
  });

  it('decodes hexadecimal digits', () => {
    expect(sevenSegLevels({ level: 0, digit: 1 })).toEqual({ a: 0, b: 1, c: 1, d: 0, e: 0, f: 0, g: 0, dp: 0 });
    const eight = sevenSegLevels({ level: 0, digit: 8 });
    expect(Object.values(eight).filter((v) => v === 1)).toHaveLength(7);
    expect(eight.dp).toBe(0);
    const f = sevenSegLevels({ level: 0, digit: 15 });
    expect(['a', 'e', 'f', 'g'].every((s) => f[s] === 1)).toBe(true);
    expect(f.b + f.c + f.d).toBe(0);
    expect(HEX_SEGMENTS).toHaveLength(16);
  });

  it('reads an integer above 1 as a bit mask (bit 0 = a … bit 7 = dp)', () => {
    // 0b1000_0110 = b, c and dp
    expect(sevenSegLevels({ level: 0b10000110 })).toEqual({ a: 0, b: 1, c: 1, d: 0, e: 0, f: 0, g: 0, dp: 1 });
  });

  it('applies a fractional level to every segment', () => {
    const l = sevenSegLevels({ level: 0.4 });
    expect(new Set(Object.values(l))).toEqual(new Set([0.4]));
    expect(Object.keys(l)).toHaveLength(8);
  });
});
