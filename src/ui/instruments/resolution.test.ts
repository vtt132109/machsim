/**
 * Instrument readouts are rounded to the instrument's display resolution, so numerical residue
 * such as 249.1 fV on a grounded node reads 0 V, while real small signals keep their value.
 */
import { describe, expect, it } from 'vitest';
import { cleanReading, digitsForStep, formatReading, relativeStep, toResolution } from './resolution';
import { eng } from './panelKit';
import { probeText } from '../integration/live';
import type { ProbeBinding } from '../../model/types';

describe('display resolution', () => {
  it('reads residue near zero as 0 at the oscilloscope resolution (1/100 div)', () => {
    expect(eng(249.1e-15, 'V', 4, 1 / 100)).toBe('0 V');
    expect(eng(-3e-9, 'V', 4, 0.5 / 100)).toBe('0 V');
    expect(eng(1.23456, 'V', 4, 1 / 100)).toBe('1.23 V');
    expect(eng(4.996e-3, 's', 4, 1e-3 / 100)).toBe('5 ms');
    // a real millivolt signal on a 10 mV/div range keeps its value
    expect(eng(2.345e-3, 'V', 4, 10e-3 / 100)).toBe('2.3 mV');
  });

  it('applies the solver noise floor even without a scale', () => {
    expect(formatReading(2.491e-13, 'V')).toBe('0 V');
    expect(formatReading(4e-13, 'A')).toBe('0 A');
    expect(formatReading(5.2e-6, 'V')).toBe('5.2 µV');
    expect(formatReading(3e-9, 'A')).toBe('3 nA');
    expect(formatReading(Number.NaN, 'V')).toBe('—');
    expect(cleanReading(-1e-18, 'W')).toBe(0);
    expect(Object.is(toResolution(-1e-9, 1e-3), 0)).toBe(true);
    expect(toResolution(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it('uses 4½ digits relative to the largest related reading', () => {
    expect(relativeStep(5, -2)).toBe(5e-4);
    expect(relativeStep(0, Number.NaN)).toBeUndefined();
    expect(eng(1e-15, 'V', 4, relativeStep(1e-15, 3.536))).toBe('0 V');
  });

  it('keeps enough digits to resolve the step on large values (long interactive runs)', () => {
    // scope cursors at 500 µs/div (step 5 µs) after 72 s and 637 s of simulated time
    expect(eng(72.2025, 's', 4, 5e-6)).toBe('72.2025 s');
    expect(eng(72.205, 's', 4, 5e-6)).toBe('72.205 s');
    expect(eng(637.4012, 's', 4, 5e-6)).toBe('637.4012 s');
    expect(digitsForStep(637.4, 5e-6, 4)).toBe(9);
    // small values keep the requested digits; no step, no change
    expect(digitsForStep(1.2e-3, 5e-6, 4)).toBe(4);
    expect(digitsForStep(72.2, undefined, 4)).toBe(4);
    expect(digitsForStep(1e9, 1e-9, 4)).toBe(12);
    expect(eng(1.23456, 'V', 4, 1 / 100)).toBe('1.23 V');
  });

  it('shows 0 V on a schematic probe sitting on a grounded wire', () => {
    const probe: ProbeBinding = { probeId: 'p', name: 'P1', kind: 'voltage', color: '#000', signal: { kind: 'voltage', pos: 'n1', neg: '0' } };
    expect(probeText(probe, new Map([['v(n1)', 2.491e-13]]))).toBe('V: 0 V');
    expect(probeText(probe, new Map([['v(n1)', 3.3]]))).toBe('V: 3.3 V');
  });
});
