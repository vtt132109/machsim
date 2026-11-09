import { describe, expect, it } from 'vitest';
import { axisFormatter, axisFraction, axisValue, formatLogTick, linearTicks, logTicks, niceRange, niceStep, panRange, zoomRange } from './ticks';

describe('niceStep', () => {
  it('rounds up to 1/2/5 x 10^n', () => {
    expect(niceStep(0.7)).toBeCloseTo(1, 12);
    expect(niceStep(1.3)).toBeCloseTo(2, 12);
    expect(niceStep(2)).toBeCloseTo(2, 12);
    expect(niceStep(3.1)).toBeCloseTo(5, 12);
    expect(niceStep(7)).toBeCloseTo(10, 12);
    expect(niceStep(0.00042)).toBeCloseTo(0.0005, 15);
    expect(niceStep(1.6e6)).toBeCloseTo(2e6, 3);
  });
});

describe('linearTicks', () => {
  it('produces evenly spaced nice ticks within range', () => {
    const t = linearTicks(0, 10, 5);
    expect(t.step).toBe(2);
    expect(t.major).toEqual([0, 2, 4, 6, 8, 10]);
    expect(t.minor).toEqual([0.5, 1, 1.5, 2.5, 3, 3.5, 4.5, 5, 5.5, 6.5, 7, 7.5, 8.5, 9, 9.5]);
  });

  it('handles negative and fractional ranges without float noise', () => {
    const t = linearTicks(-1.3, 7.2, 6);
    expect(t.step).toBe(2);
    expect(t.major).toEqual([0, 2, 4, 6]);
    const f = linearTicks(0.1, 0.4, 3);
    expect(f.step).toBeCloseTo(0.1, 15);
    expect(f.major).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('handles engineering-scale ranges (microseconds)', () => {
    const t = linearTicks(0, 1e-5, 5);
    expect(t.step).toBeCloseTo(2e-6, 18);
    expect(t.major).toHaveLength(6);
    expect(t.major[5]).toBeCloseTo(1e-5, 18);
  });

  it('degenerate range returns the single value', () => {
    expect(linearTicks(3, 3).major).toEqual([3]);
  });
});

describe('logTicks', () => {
  it('uses decades as majors and 2..9 as minors', () => {
    const t = logTicks(1, 1e4);
    expect(t.major).toEqual([1, 10, 100, 1000, 10000]);
    expect(t.minor).toContain(20);
    expect(t.minor).toContain(9000);
    expect(t.minor).toHaveLength(32);
  });

  it('thins majors on wide spans', () => {
    const t = logTicks(1e-3, 1e9, 6);
    expect(t.step).toBe(2);
    expect(t.major).toEqual([1e-2, 1, 100, 1e4, 1e6, 1e8].map((v) => expect.closeTo(v, 12)));
  });

  it('labels mantissas for sub-decade spans', () => {
    const t = logTicks(2, 8);
    expect(t.major).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('niceRange', () => {
  it('snaps linear bounds outward to the tick step', () => {
    expect(niceRange(0.13, 9.7)).toEqual([0, 10]);
    expect(niceRange(-0.93, 0.87)).toEqual([-1, 1]);
    expect(niceRange(5, 5)).toEqual([4.5, 5.5]);
    expect(niceRange(0, 0)).toEqual([-1, 1]);
  });

  it('snaps log bounds to decades or 1/2/5 mantissas', () => {
    expect(niceRange(3, 4.2e5, true)).toEqual([1, 1e6]);
    const [lo, hi] = niceRange(1.2, 4.5, true);
    expect(lo).toBeCloseTo(1, 12);
    expect(hi).toBeCloseTo(5, 12);
  });
});

describe('formatting', () => {
  it('uses one engineering prefix per axis', () => {
    const t = linearTicks(0, 1.5e-3, 3);
    const f = axisFormatter(t.major, t.step, 's');
    expect(t.major.map(f)).toEqual(['0', '0.5ms', '1.0ms', '1.5ms']);
    const g = axisFormatter([-2000, 0, 2000, 4000], 2000, 'V');
    expect([-2000, 0, 4000].map(g)).toEqual(['-2k V'.replace(' ', ''), '0', '4kV']);
  });

  it('formats log ticks', () => {
    expect(formatLogTick(1000, 'Hz')).toBe('1kHz');
    expect(formatLogTick(2.2e6, 'Hz')).toBe('2.2MHz');
    expect(formatLogTick(0.01)).toBe('10m');
  });
});

describe('axis mapping, zoom and pan', () => {
  it('maps values to fractions and back (linear and log)', () => {
    expect(axisFraction(5, 0, 10, false)).toBeCloseTo(0.5, 12);
    expect(axisFraction(100, 1, 1e4, true)).toBeCloseTo(0.5, 12);
    expect(axisValue(0.25, 1, 1e4, true)).toBeCloseTo(10, 9);
    expect(axisFraction(-1, 1, 10, true)).toBeNaN();
  });

  it('zooms around the anchor and pans by a fraction of the span', () => {
    expect(zoomRange(0, 10, 2, 0.5, false)).toEqual([1, 6]);
    const [lo, hi] = zoomRange(1, 1e4, 100, 0.5, true);
    expect(lo).toBeCloseTo(10, 9);
    expect(hi).toBeCloseTo(1000, 6);
    expect(panRange(0, 10, 0.1, false)).toEqual([1, 11]);
    const [plo, phi] = panRange(1, 100, 0.5, true);
    expect(plo).toBeCloseTo(10, 9);
    expect(phi).toBeCloseTo(1000, 6);
  });
});
