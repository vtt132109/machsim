/**
 * Exact SPICE number reading and lossless writing.
 *
 * parseSpiceNumberExact() follows the semantics of parseSpiceNumber (src/util/units.ts: case-
 * insensitive suffixes, M = milli, MEG = mega, MIL = 25.4e-6, trailing unit words ignored) but
 * applies power-of-ten suffixes by shifting the decimal exponent instead of multiplying, so
 * "3n" reads as exactly 3e-9 (the double nearest to the decimal value) rather than
 * 3 * 1e-9 = 3.0000000000000004e-9. That makes writeSpice -> parseSpice round trips bit-exact.
 *
 * formatSpiceNumber() writes the short engineering form from toSpiceNumber() when it reads back
 * exactly, and the shortest exact JavaScript representation otherwise.
 */

import { toSpiceNumber } from '../../util/units';

const NUM_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+))?\s*(.*)$/;

/** Suffix -> power of ten (checked in this order, case-insensitive). "mil" is handled separately. */
const SUFFIX_EXP: readonly [string, number][] = [
  ['meg', 6],
  ['t', 12],
  ['g', 9],
  ['k', 3],
  ['m', -3],
  ['u', -6],
  ['µ', -6],
  ['μ', -6],
  ['n', -9],
  ['p', -12],
  ['f', -15],
  ['a', -18],
];

/** SPICE number with optional suffix/unit (NaN when the text does not start with a number). */
export function parseSpiceNumberExact(text: string): number {
  const m = NUM_RE.exec(text);
  if (!m) return NaN;
  const mantissa = m[1];
  const exp = m[2] === undefined ? 0 : Number(m[2]);
  const rest = m[3].toLowerCase();
  if (rest.startsWith('mil')) return Number(`${mantissa}e${exp}`) * 25.4e-6;
  for (const [suf, e] of SUFFIX_EXP) {
    if (rest.startsWith(suf)) return Number(`${mantissa}e${exp + e}`);
  }
  return Number(`${mantissa}e${exp}`);
}

/** Compact SPICE text for `value` that parseSpiceNumberExact reads back to exactly `value`. */
export function formatSpiceNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '1e999';
  if (value === -Infinity) return '-1e999';
  const short = toSpiceNumber(value);
  if (parseSpiceNumberExact(short) === value) return short;
  return String(value);
}
