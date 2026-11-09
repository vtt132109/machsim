/**
 * Display resolution of instrument readouts.
 *
 * A simulated circuit leaves numerical residue far below anything a real instrument could show
 * (a grounded node reads 2.5e-13 V instead of 0). Readouts are therefore rounded:
 *   - to the instrument's own resolution when it has a scale (oscilloscope: 1/100 division,
 *     time: 1/100 of the timebase), and
 *   - always below the simulator's absolute tolerances (VNTOL 1 µV, ABSTOL 1 pA), so values
 *     that are zero within the accuracy of the solution read "0".
 * Formatting stays SPICE engineering notation (formatEng: '.' decimal point, k/m/µ prefixes).
 */
import { formatEng } from '../../util/units';

/** Smallest meaningful magnitude per unit (default solver tolerances). */
export const NOISE_FLOOR: Readonly<Record<string, number>> = { V: 1e-6, A: 1e-12, W: 1e-15, VA: 1e-15, var: 1e-15 };

/** `value` rounded to a multiple of `step`; values within half a step of zero become 0 (never -0). */
export function toResolution(value: number, step: number | undefined): number {
  if (!Number.isFinite(value) || step === undefined || !(step > 0)) return value;
  const q = Math.round(value / step) * step;
  if (Math.abs(q) < step / 2) return 0;
  // remove binary noise of the multiplication (0.30000000000000004 -> 0.3)
  return Number(q.toPrecision(12));
}

/** Reading cleaned of numerical residue: below the unit's noise floor, then at the display step. */
export function cleanReading(value: number, unit: string, step?: number): number {
  if (!Number.isFinite(value)) return value;
  const floor = NOISE_FLOOR[unit];
  if (floor !== undefined && Math.abs(value) < floor / 2) return 0;
  return toResolution(value, step);
}

/** Most significant digits a readout ever shows (the rounding in toResolution keeps 12). */
const MAX_DIGITS = 12;

/**
 * Significant digits needed to show `value` to the resolution `step`: a cursor at 72.2025 s on a
 * 5 µs grid needs 8 ("72.2025 s"), so that T2 − T1 read off two rows agrees with the T2−T1 row.
 * At least `digits`, at most MAX_DIGITS.
 */
export function digitsForStep(value: number, step: number | undefined, digits: number): number {
  if (step === undefined || !(step > 0) || !Number.isFinite(value) || value === 0) return digits;
  const need = Math.floor(Math.log10(Math.abs(value))) - Math.floor(Math.log10(step)) + 1;
  return Math.max(digits, Math.min(MAX_DIGITS, need));
}

/**
 * Formatted readout ("—" for non-finite values) at the display resolution: `digits` significant
 * digits, or more when the value is large compared with `step` (long interactive runs), so the
 * text always resolves the step.
 */
export function formatReading(value: number, unit: string, digits = 4, step?: number): string {
  if (!Number.isFinite(value)) return '—';
  const v = cleanReading(value, unit, step);
  return formatEng(v, unit, digitsForStep(v, step, digits));
}

/** Resolution of a 4½-digit readout relative to the largest of several related readings. */
export function relativeStep(...values: number[]): number | undefined {
  const m = Math.max(0, ...values.filter(Number.isFinite).map(Math.abs));
  return m > 0 ? m * 1e-4 : undefined;
}
