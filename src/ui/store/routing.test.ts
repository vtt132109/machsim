import { describe, expect, it } from 'vitest';
import { draftPoints, nearestOnPolyline, pinStubHorizontal, routeL, rubberBandPoints, simplifyPoints } from './routing';

describe('simplifyPoints', () => {
  it('removes duplicates and collinear middle points', () => {
    expect(
      simplifyPoints([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 20 },
        { x: 30, y: 40 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ]);
  });
  it('keeps real corners', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    expect(simplifyPoints(pts)).toEqual(pts);
  });
});

describe('routeL', () => {
  it('routes horizontal-first and vertical-first through the right corner', () => {
    expect(routeL({ x: 0, y: 0 }, { x: 50, y: 30 }, true)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 30 },
    ]);
    expect(routeL({ x: 0, y: 0 }, { x: 50, y: 30 }, false)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 50, y: 30 },
    ]);
  });
  it('uses a straight segment when aligned', () => {
    expect(routeL({ x: 0, y: 10 }, { x: 40, y: 10 }, false)).toEqual([
      { x: 0, y: 10 },
      { x: 40, y: 10 },
    ]);
  });
});

describe('draftPoints', () => {
  it('appends an L route to the committed corners and merges collinear legs', () => {
    const committed = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ];
    expect(draftPoints(committed, { x: 80, y: 30 }, true)).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 30 },
    ]);
    expect(draftPoints(committed, { x: 80, y: 30 }, false)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 80, y: 30 },
    ]);
  });
});

describe('rubberBandPoints', () => {
  it('inserts a dog-leg through the snapped middle when a straight wire end moves sideways', () => {
    const out = rubberBandPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { x: 0, y: 40 },
      null,
    );
    expect(out).toEqual([
      { x: 0, y: 40 },
      { x: 50, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
  it('slides the adjacent corner to keep an L wire orthogonal', () => {
    const out = rubberBandPoints(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 60 },
      ],
      { x: 10, y: 20 },
      null,
    );
    expect(out).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 60 },
    ]);
  });
  it('moves the far end independently', () => {
    const out = rubberBandPoints(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 60 },
      ],
      null,
      { x: 30, y: 10 },
    );
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 70 },
    ]);
  });
  it('translates the wire when both ends move together', () => {
    const out = rubberBandPoints(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
      ],
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    );
    expect(out).toEqual([
      { x: 10, y: 10 },
      { x: 60, y: 10 },
    ]);
  });
  it('shortens a straight wire when the end moves along it', () => {
    expect(
      rubberBandPoints(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        { x: 30, y: 0 },
        null,
      ),
    ).toEqual([
      { x: 30, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

describe('pinStubHorizontal', () => {
  it('accounts for rotation and mirror', () => {
    expect(pinStubHorizontal('left', 0, false)).toBe(true);
    expect(pinStubHorizontal('left', 90, false)).toBe(false);
    expect(pinStubHorizontal('up', 90, false)).toBe(true);
    expect(pinStubHorizontal('up', 0, true)).toBe(false);
    expect(pinStubHorizontal(undefined, 270, false)).toBe(true);
  });
});

describe('nearestOnPolyline', () => {
  it('projects onto the closest segment', () => {
    const r = nearestOnPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      { x: 97, y: 52 },
    );
    expect(r?.segment).toBe(1);
    expect(r?.point).toEqual({ x: 100, y: 52 });
    expect(r?.dist).toBeCloseTo(3, 10);
  });
});
