import { describe, expect, it } from 'vitest';
import {
  bandsText,
  capacitorCode,
  decodeBands,
  electrolyticMarking,
  formatValue,
  inductorBands,
  nearestPreferred,
  parseCapacitorCode,
  resistorBands,
  seriesOf,
} from './markings';

describe('resistor colour code', () => {
  it('encodes 4.7 kΩ 5 % as yellow-violet-red-gold', () => {
    const c = resistorBands(4700, { tolerance: 5 })!;
    expect(c.bands).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(c.exact).toBe(true);
    expect(bandsText(c).vi).toBe('vàng – tím – đỏ – nhũ vàng');
    expect(bandsText(c).en).toBe('yellow – violet – red – gold');
  });

  it('encodes common values', () => {
    expect(resistorBands(470)!.bands).toEqual(['yellow', 'violet', 'brown', 'gold']);
    expect(resistorBands(10_000)!.bands).toEqual(['brown', 'black', 'orange', 'gold']);
    expect(resistorBands(1)!.bands).toEqual(['brown', 'black', 'gold', 'gold']);
    expect(resistorBands(0.47)!.bands).toEqual(['yellow', 'violet', 'silver', 'gold']);
    expect(resistorBands(1e6, { tolerance: 10 })!.bands).toEqual(['brown', 'black', 'green', 'silver']);
    expect(resistorBands(220, { tolerance: 20 })!.bands).toEqual(['red', 'red', 'brown']);
  });

  it('uses five bands for 1 % parts and three-digit values', () => {
    expect(resistorBands(4700, { tolerance: 1 })!.bands).toEqual(['yellow', 'violet', 'black', 'brown', 'brown']);
    const e96 = resistorBands(4990, { tolerance: 1 })!;
    expect(e96.bands).toEqual(['yellow', 'white', 'white', 'brown', 'brown']);
    expect(e96.value).toBe(4990);
    // 3 significant digits at 5 % switch to the 5-band code automatically
    expect(resistorBands(1240)!.bands).toHaveLength(5);
    expect(resistorBands(1240, { bands: 4 })!.value).toBe(1200);
    expect(resistorBands(1240, { bands: 4 })!.exact).toBe(false);
  });

  it('decodes bands back to a value', () => {
    expect(decodeBands(['yellow', 'violet', 'red', 'gold'])).toEqual({ ohms: 4700, tolerance: 5 });
    expect(decodeBands(['brown', 'black', 'black', 'red', 'brown'])).toEqual({ ohms: 10_000, tolerance: 1 });
    expect(decodeBands(['red', 'red', 'brown'])).toEqual({ ohms: 220, tolerance: 20 });
    expect(decodeBands(['gold', 'red', 'brown'])).toBeNull();
  });

  it('rejects impossible values', () => {
    expect(resistorBands(0)).toBeNull();
    expect(resistorBands(-5)).toBeNull();
    expect(resistorBands(1e12)).toBeNull();
  });

  it('codes inductors in µH', () => {
    // 100 µH = 10 × 10¹ µH: brown black brown, ±10 % silver
    expect(inductorBands(100e-6)!.bands).toEqual(['brown', 'black', 'brown', 'silver']);
    expect(inductorBands(4.7e-6)!.bands).toEqual(['yellow', 'violet', 'gold', 'silver']);
  });
});

describe('E-series', () => {
  it('rounds to the nearest preferred value', () => {
    expect(nearestPreferred(4600, 'E12')).toBe(4700);
    expect(nearestPreferred(5000, 'E24')).toBe(5100);
    expect(nearestPreferred(9700, 'E12')).toBe(10_000);
    expect(nearestPreferred(4980, 'E96')).toBe(4990);
    expect(nearestPreferred(1.5e-6, 'E6')).toBe(1.5e-6);
  });

  it('finds the smallest series containing a value', () => {
    expect(seriesOf(4700)).toBe('E6');
    expect(seriesOf(1200)).toBe('E12');
    expect(seriesOf(5100)).toBe('E24');
    expect(seriesOf(4990)).toBe('E96');
    expect(seriesOf(1234)).toBeNull();
  });
});

describe('capacitor codes', () => {
  it('marks 100 nF as 104', () => {
    const c = capacitorCode(100e-9, 10)!;
    expect(c.code).toBe('104');
    expect(c.full).toBe('104K');
    expect(c.text).toBe('100 nF');
    expect(c.exact).toBe(true);
  });

  it('marks other common values', () => {
    expect(capacitorCode(10e-9)!.code).toBe('103');
    expect(capacitorCode(47e-9)!.code).toBe('473');
    expect(capacitorCode(22e-12)!.code).toBe('220');
    expect(capacitorCode(1e-6)!.code).toBe('105');
    expect(capacitorCode(4.7e-12)!.code).toBe('4R7');
    expect(capacitorCode(150e-12, 5)!.full).toBe('151J');
  });

  it('parses codes', () => {
    expect(parseCapacitorCode('104')).toBeCloseTo(100e-9, 18);
    expect(parseCapacitorCode('104K')).toBeCloseTo(100e-9, 18);
    expect(parseCapacitorCode('4R7')).toBeCloseTo(4.7e-12, 20);
    expect(parseCapacitorCode('22')).toBeCloseTo(22e-12, 20);
    expect(parseCapacitorCode('229')).toBeCloseTo(2.2e-12, 20);
    expect(Number.isNaN(parseCapacitorCode('abc'))).toBe(true);
  });

  it('formats values and electrolytic markings', () => {
    expect(formatValue(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatValue(470, 'Ω')).toBe('470 Ω');
    expect(formatValue(1e6, 'Ω')).toBe('1 MΩ');
    expect(formatValue(10e-6, 'F')).toBe('10 µF');
    expect(electrolyticMarking(10e-6, 25)).toBe('10µF 25V');
    expect(electrolyticMarking(220e-6, 0)).toBe('220µF');
  });
});
