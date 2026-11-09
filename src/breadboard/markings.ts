/**
 * Component markings: resistor colour bands (4 / 5 band, IEC 60062), E-series preferred values
 * (IEC 60063), inductor colour codes (µH) and ceramic-capacitor three-digit codes ("104" = 10·10⁴ pF
 * = 100 nF) with tolerance letters.
 */

import { colorNameText, joinText, type LocalizedText } from '../i18n/breadboard';

export type BandColor = 'black' | 'brown' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'grey' | 'white' | 'gold' | 'silver' | 'none';

export const DIGIT_COLORS: readonly BandColor[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];

/** Display colours of the bands (sRGB hex), tuned to read well on a beige / blue body. */
export const BAND_HEX: Record<BandColor, string> = {
  black: '#1b1b1b',
  brown: '#6b3a1e',
  red: '#d42a1f',
  orange: '#f07a12',
  yellow: '#f4d21f',
  green: '#2e9e3f',
  blue: '#2457c9',
  violet: '#7a3db8',
  grey: '#8a8a8a',
  white: '#f4f4f0',
  gold: '#c9a23a',
  silver: '#c4c8cc',
  none: '#00000000',
};

const MULTIPLIER: Partial<Record<number, BandColor>> = { [-2]: 'silver', [-1]: 'gold', 0: 'black', 1: 'brown', 2: 'red', 3: 'orange', 4: 'yellow', 5: 'green', 6: 'blue', 7: 'violet', 8: 'grey', 9: 'white' };

/** Tolerance (%) -> band colour. */
export const TOLERANCE_COLOR: Record<string, BandColor> = {
  '0.05': 'grey',
  '0.1': 'violet',
  '0.25': 'blue',
  '0.5': 'green',
  '1': 'brown',
  '2': 'red',
  '5': 'gold',
  '10': 'silver',
  '20': 'none',
};

// ---------------------------------------------------------------------------------------------
// E-series

export const E6 = [1.0, 1.5, 2.2, 3.3, 4.7, 6.8];
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
export const E96 = [
  1.0, 1.02, 1.05, 1.07, 1.1, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.3, 1.33, 1.37, 1.4, 1.43, 1.47, 1.5, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.0, 2.05,
  2.1, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.8, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24, 3.32, 3.4, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12, 4.22,
  4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23, 5.36, 5.49, 5.62, 5.76, 5.9, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98, 7.15, 7.32, 7.5, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66,
  8.87, 9.09, 9.31, 9.53, 9.76,
];
export const E48 = E96.filter((_, i) => i % 2 === 0);

export type ESeries = 'E6' | 'E12' | 'E24' | 'E48' | 'E96';
const SERIES: Record<ESeries, number[]> = { E6, E12, E24, E48, E96 };

/** Nearest preferred value of an E-series (logarithmic distance). */
export function nearestPreferred(value: number, series: ESeries = 'E24'): number {
  if (!(value > 0) || !Number.isFinite(value)) return value;
  const e = Math.floor(Math.log10(value));
  const m = value / 10 ** e;
  let best = 1;
  let bestD = Infinity;
  for (const s of [...SERIES[series], 10]) {
    const d = Math.abs(Math.log(m / s));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return roundSig(best * 10 ** e, 4);
}

/** Smallest E-series that contains the value exactly (to 0.1 %), or null. */
export function seriesOf(value: number): ESeries | null {
  for (const s of ['E6', 'E12', 'E24', 'E48', 'E96'] as ESeries[]) {
    const p = nearestPreferred(value, s);
    if (Math.abs(p - value) <= value * 1e-3) return s;
  }
  return null;
}

function roundSig(v: number, sig: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const e = Math.floor(Math.log10(Math.abs(v)));
  const f = 10 ** (sig - 1 - e);
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------------------------
// resistor colour code

export interface BandCode {
  /** band colours from the end nearest the body edge (digits, multiplier, tolerance) */
  bands: BandColor[];
  digits: number[];
  /** power-of-ten multiplier exponent */
  exponent: number;
  /** value the bands actually encode (Ω) */
  value: number;
  /** tolerance in % (20 → no tolerance band) */
  tolerance: number;
  /** true when the requested value is encoded without rounding */
  exact: boolean;
}

function digitsFor(value: number, sig: number): { digits: number[]; exponent: number } | null {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  let e = Math.floor(Math.log10(value) + 1e-9);
  let n = Math.round(value / 10 ** (e - sig + 1));
  if (n >= 10 ** sig) {
    e += 1;
    n = Math.round(value / 10 ** (e - sig + 1));
  }
  const digits = String(n).padStart(sig, '0').split('').map(Number);
  return { digits, exponent: e - sig + 1 };
}

const nearestTolerance = (t: number): number => {
  const keys = Object.keys(TOLERANCE_COLOR).map(Number);
  return keys.reduce((b, k) => (Math.abs(k - t) < Math.abs(b - t) ? k : b), 5);
};

/**
 * Colour bands of a resistor. `bands` 4 or 5; when omitted: 5 bands for tolerance ≤ 1 % or when
 * the value needs three significant digits, otherwise 4. 4.7 kΩ 5 % → yellow violet red gold.
 */
export function resistorBands(ohms: number, opts: { tolerance?: number; bands?: 4 | 5 } = {}): BandCode | null {
  const tolerance = nearestTolerance(opts.tolerance ?? 5);
  const two = digitsFor(ohms, 2);
  if (!two) return null;
  const twoExact = Math.abs(two.digits[0] * 10 + two.digits[1] - ohms / 10 ** two.exponent) < 1e-6 * (ohms / 10 ** two.exponent);
  const count = opts.bands ?? (tolerance <= 1 || !twoExact ? 5 : 4);
  const sig = count === 5 ? 3 : 2;
  const d = digitsFor(ohms, sig);
  if (!d) return null;
  let exponent = d.exponent;
  let digits = d.digits;
  // multipliers below silver (×0.01) are not defined: fall back to fewer significant digits
  while (exponent < -2 && digits.length > 1) {
    digits = digits.slice(0, -1);
    exponent += 1;
  }
  if (exponent < -2 || exponent > 9) return null;
  const mult = MULTIPLIER[exponent];
  if (!mult) return null;
  const value = roundSig(Number(digits.join('')) * 10 ** exponent, 6);
  const tolColor = TOLERANCE_COLOR[String(tolerance)];
  const bands: BandColor[] = [...digits.map((x) => DIGIT_COLORS[x]), mult];
  if (tolColor !== 'none') bands.push(tolColor);
  return { bands, digits, exponent, value, tolerance, exact: Math.abs(value - ohms) <= Math.abs(ohms) * 1e-6 };
}

/** Decode a band list (3–5 bands, digits first). */
export function decodeBands(bands: BandColor[]): { ohms: number; tolerance: number } | null {
  if (bands.length < 3 || bands.length > 5) return null;
  const nDigits = bands.length === 5 ? 3 : 2;
  const digits = bands.slice(0, nDigits).map((c) => DIGIT_COLORS.indexOf(c));
  if (digits.some((d) => d < 0)) return null;
  const multEntry = Object.entries(MULTIPLIER).find(([, c]) => c === bands[nDigits]);
  if (!multEntry) return null;
  const tolEntry = bands.length > nDigits + 1 ? Object.entries(TOLERANCE_COLOR).find(([, c]) => c === bands[nDigits + 1]) : ['20', 'none'];
  if (!tolEntry) return null;
  return { ohms: roundSig(Number(digits.join('')) * 10 ** Number(multEntry[0]), 6), tolerance: Number(tolEntry[0]) };
}

export function bandsText(code: BandCode): LocalizedText {
  return joinText(code.bands.map((b) => colorNameText(b)), { vi: ' – ', en: ' – ' });
}

/** Inductor colour code: like a 4-band resistor in µH (gold = ×0.1, silver = ×0.01). */
export function inductorBands(henries: number, tolerance = 10): BandCode | null {
  const code = resistorBands(henries * 1e6, { tolerance, bands: 4 });
  return code ? { ...code, value: code.value * 1e-6 } : null;
}

// ---------------------------------------------------------------------------------------------
// value formatting

const PREFIX: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** "4.7 kΩ", "100 nF", "10 µF" (three significant digits, trailing zeros removed). */
export function formatValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return `? ${unit}`;
  if (v === 0) return `0 ${unit}`;
  const a = Math.abs(v);
  for (const [m, p] of PREFIX) {
    if (a >= m * 0.9995) {
      const n = roundSig(v / m, 3);
      return `${String(n)} ${p}${unit}`;
    }
  }
  return `${String(roundSig(v / 1e-12, 3))} p${unit}`;
}

// ---------------------------------------------------------------------------------------------
// capacitor codes

/** Tolerance letters of capacitor codes (percent tolerances). */
export const CAP_TOLERANCE_LETTER: Record<string, string> = { '0.5': 'D', '1': 'F', '2': 'G', '5': 'J', '10': 'K', '20': 'M' };

export interface CapacitorCode {
  /** three-character code: "104", "220", "4R7" */
  code: string;
  /** code plus tolerance letter when known: "104K" */
  full: string;
  /** value encoded by the code (F) */
  value: number;
  /** value text, e.g. "100 nF" */
  text: string;
  exact: boolean;
}

/**
 * Ceramic / film capacitor marking. Values ≥ 10 pF: two significant digits plus the number of
 * zeros in pF (100 nF = 100 000 pF → "104"); below 10 pF the R marks the decimal point ("4R7").
 */
export function capacitorCode(farads: number, tolerance?: number): CapacitorCode | null {
  if (!(farads > 0) || !Number.isFinite(farads)) return null;
  const pF = farads * 1e12;
  let code: string;
  let value: number;
  if (pF < 9.95) {
    const r = Math.round(pF * 10) / 10;
    const whole = Math.floor(r);
    const frac = Math.round((r - whole) * 10);
    code = `${whole}R${frac}`;
    value = r * 1e-12;
  } else {
    const d = digitsFor(pF, 2);
    if (!d || d.exponent > 9) return null;
    code = `${d.digits.join('')}${d.exponent}`;
    value = Number(d.digits.join('')) * 10 ** d.exponent * 1e-12;
  }
  const letter = tolerance !== undefined ? CAP_TOLERANCE_LETTER[String(tolerance)] : undefined;
  return { code, full: letter ? code + letter : code, value, text: formatValue(value, 'F'), exact: Math.abs(value - farads) <= farads * 1e-6 };
}

/** Decode "104", "104K", "4R7", "22" (two digits = pF). Returns farads or NaN. */
export function parseCapacitorCode(text: string): number {
  const t = text.trim().toUpperCase().replace(/[DFGJKMZ]$/, '');
  let m = /^(\d)R(\d)$/.exec(t);
  if (m) return (Number(m[1]) + Number(m[2]) / 10) * 1e-12;
  m = /^(\d{2})(\d)$/.exec(t);
  if (m) {
    const mul = m[2] === '8' ? 0.01 : m[2] === '9' ? 0.1 : 10 ** Number(m[2]);
    return Number(m[1]) * mul * 1e-12;
  }
  m = /^(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 1e-12;
  return NaN;
}

/** Printed text of an electrolytic capacitor: "10µF 25V". */
export function electrolyticMarking(farads: number, volts: number): string {
  const v = formatValue(farads, 'F').replace(' ', '');
  return Number.isFinite(volts) && volts > 0 ? `${v} ${roundSig(volts, 3)}V` : v;
}
