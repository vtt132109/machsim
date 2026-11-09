/**
 * IEC 60063 preferred-number series: table sizes, the well-known values and the E192 exception,
 * decade expansion and nearest-value rounding.
 */
import { describe, expect, it } from 'vitest';
import { E_SERIES_NAMES, nearestSeriesValue, seriesMantissas, seriesTolerance, seriesValues } from './series';

describe('E-series', () => {
  it('has the standard table sizes and values', () => {
    expect(E_SERIES_NAMES.map((s) => seriesMantissas(s).length)).toEqual([3, 6, 12, 24, 48, 96, 192]);
    expect(seriesMantissas('E12')).toEqual([1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]);
    expect(seriesMantissas('E24')).toContain(4.3);
    expect(seriesMantissas('E96').slice(0, 4)).toEqual([1, 1.02, 1.05, 1.07]);
    expect(seriesMantissas('E96')).toContain(4.99);
    expect(seriesMantissas('E192')).toContain(9.19);
    expect(seriesMantissas('E192')).not.toContain(9.2);
    expect(seriesTolerance('E96')).toBe(1);
  });

  it('expands decades without rounding noise and rounds to the nearest series value', () => {
    const r = seriesValues('E24', 1, 10e6);
    expect(r).toHaveLength(169);
    expect(r[0]).toBe(1);
    expect(r[r.length - 1]).toBe(10e6);
    expect(r).toContain(4700);
    expect(r).toContain(51e3);
    expect(seriesValues('E6', 100e-9, 10e-3)).toHaveLength(31);
    expect(nearestSeriesValue('E12', 4400)).toBe(4700);
    expect(nearestSeriesValue('E24', 4400)).toBe(4300);
    expect(nearestSeriesValue('E12', 9.6e-9)).toBe(10e-9);
  });
});
