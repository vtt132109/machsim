import { describe, expect, it } from 'vitest';
import type { Wire } from '../../model/types';
import { junctionPoints, normalizeWires, pointKey, splitWireAt } from './wireOps';

let seq = 0;
const mk = () => `n${++seq}`;
const w = (id: string, ...xy: number[]): Wire => {
  const points = [];
  for (let i = 0; i < xy.length; i += 2) points.push({ x: xy[i], y: xy[i + 1] });
  return { id, points };
};

describe('splitWireAt', () => {
  it('splits a segment interior and an interior vertex', () => {
    const wire = w('a', 0, 0, 100, 0, 100, 100);
    const parts = splitWireAt(wire, [{ x: 40, y: 0 }, { x: 100, y: 0 }], mk);
    expect(parts.map((p) => p.points)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      [
        { x: 40, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    ]);
    expect(parts[0].id).toBe('a');
    expect(new Set(parts.map((p) => p.id)).size).toBe(3);
  });
  it('ignores cut points at the ends or off the wire', () => {
    const wire = w('a', 0, 0, 100, 0);
    expect(splitWireAt(wire, [{ x: 0, y: 0 }, { x: 50, y: 10 }], mk)).toEqual([wire]);
  });
});

describe('normalizeWires', () => {
  it('splits a wire where another wire ends on it (T junction)', () => {
    const out = normalizeWires([w('a', 0, 0, 100, 0), w('b', 50, 0, 50, 60)], new Set(), mk);
    expect(out).toHaveLength(3);
    const ends = out.map((x) => [x.points[0], x.points[x.points.length - 1]]);
    expect(ends).toContainEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(ends).toContainEqual([
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
  it('merges two wires meeting end to end with nothing else there', () => {
    const out = normalizeWires([w('a', 0, 0, 50, 0), w('b', 50, 0, 50, 40)], new Set(), mk);
    expect(out).toEqual([
      {
        id: 'a',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 40 },
        ],
      },
    ]);
  });
  it('merges collinear wires into one straight segment', () => {
    const out = normalizeWires([w('a', 0, 0, 50, 0), w('b', 100, 0, 50, 0)], new Set(), mk);
    expect(out).toHaveLength(1);
    expect(out[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
  it('does not merge at a pin or across different colours', () => {
    const wires = [w('a', 0, 0, 50, 0), w('b', 50, 0, 50, 40)];
    expect(normalizeWires(wires, new Set([pointKey({ x: 50, y: 0 })]), mk)).toBe(wires);
    const coloured = [w('a', 0, 0, 50, 0), { ...w('b', 50, 0, 50, 40), color: '#f00' }];
    expect(normalizeWires(coloured, new Set(), mk)).toBe(coloured);
  });
  it('drops degenerate wires and returns the same array when canonical', () => {
    const canonical = [w('a', 0, 0, 50, 0)];
    expect(normalizeWires(canonical, new Set(), mk)).toBe(canonical);
    expect(normalizeWires([w('z', 10, 10, 10, 10), ...canonical], new Set(), mk)).toEqual(canonical);
  });
});

describe('junctionPoints', () => {
  it('marks points where three or more connections meet', () => {
    const wires = [w('a', 0, 0, 50, 0), w('b', 50, 0, 100, 0), w('c', 50, 0, 50, 50)];
    expect(junctionPoints(wires, [])).toEqual([{ x: 50, y: 0 }]);
  });
  it('counts pins and pass-through wires', () => {
    // two wire ends at a pin -> junction
    expect(junctionPoints([w('a', 0, 0, 50, 0), w('b', 50, 0, 50, 50)], [{ x: 50, y: 0 }])).toEqual([{ x: 50, y: 0 }]);
    // one wire end at a pin -> plain connection
    expect(junctionPoints([w('a', 0, 0, 50, 0)], [{ x: 50, y: 0 }])).toEqual([]);
    // un-normalised T: end on interior counts 1 + 2
    expect(junctionPoints([w('a', 0, 0, 100, 0), w('b', 50, 0, 50, 50)], [])).toEqual([{ x: 50, y: 0 }]);
  });
  it('ignores plain crossings', () => {
    expect(junctionPoints([w('a', 0, 0, 100, 0), w('b', 50, -50, 50, 50)], [])).toEqual([]);
  });
});
