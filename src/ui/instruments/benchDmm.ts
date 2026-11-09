/**
 * 6½-digit bench multimeter logic (pure): settings, ranges, fixed-resolution display text,
 * readings taken over an integration aperture, statistics and math functions.
 *
 * Readings: the record is cut into consecutive windows of the aperture (fast 1 ms, medium 20 ms =
 * one 50 Hz mains cycle, slow 200 ms); each window gives one reading: the time-weighted mean (DC)
 * or the true RMS of the AC part (AC). A record shorter than the aperture gives one reading over
 * what is there. Resistance R = V / I_test (the test current leaves HI, 10 MΩ input in parallel is
 * removed: R = 1/(I/V − 1/Rin)).
 *
 * Display: a range of full scale R shows 120 % over-range ("OVLD" beyond), with D decimal
 * digits for the 1-unit range at 6½ digits (D = 6), 5½ (5) or 4½ (4): e.g. range 10 V at 6½ digits
 * reads "+05.12345 V" — the resolution is R·10^−D·… of the unit (1 µV on the 1 V range).
 *
 * Statistics (Welford's running algorithm): count, mean, standard deviation, minimum, maximum.
 * Math: null (reading − null value), dB = 20·log10(|V|/Vref), dBm = 10·log10(V²/Rref/1 mW),
 * limit test (PASS / HI / LO).
 */
import { parseUserNumber } from '../../util/units';
import { BENCH_DMM_DEFAULTS } from '../../library/parts/benchInstruments';
import { counterMeasure } from './measure';
import { windowMean } from './scope';

export type DmmFunction = 'dcv' | 'acv' | 'dci' | 'aci' | 'ohm' | 'freq' | 'period' | 'cont' | 'diode';
export type DmmMath = 'none' | 'null' | 'db' | 'dbm' | 'stats' | 'limit';
export type DmmRate = 'fast' | 'medium' | 'slow';

export const DMM_FUNCTIONS: readonly DmmFunction[] = ['dcv', 'acv', 'dci', 'aci', 'ohm', 'freq', 'period', 'cont', 'diode'];
export const DMM_MATHS: readonly DmmMath[] = ['none', 'null', 'db', 'dbm', 'stats', 'limit'];
export const DMM_APERTURE: Record<DmmRate, number> = { fast: 1e-3, medium: 20e-3, slow: 200e-3 };
export { BENCH_DMM_DEFAULTS };

export interface DmmSettings {
  fn: DmmFunction;
  /** null = auto range */
  range: number | null;
  rate: DmmRate;
  /** decimal digits of the unit range: 6 (6½), 5 (5½), 4 (4½) */
  digits: 4 | 5 | 6;
  math: DmmMath;
  nullValue: number;
  dbRef: number;
  dbmRef: number;
  limitLow: number;
  limitHigh: number;
  zin: number;
  itest: number;
}

function pick<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  const s = (v ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function parseDmmSettings(params: Record<string, string>): DmmSettings {
  const num = (k: string) => {
    const v = parseUserNumber(params[k] ?? BENCH_DMM_DEFAULTS[k] ?? '');
    return Number.isFinite(v) ? v : parseUserNumber(BENCH_DMM_DEFAULTS[k]);
  };
  const rangeText = (params.range ?? 'auto').trim().toLowerCase();
  const r = parseUserNumber(rangeText);
  const d = (params.digits ?? '6.5').trim();
  return {
    fn: pick(params.function, DMM_FUNCTIONS, 'dcv'),
    range: rangeText === 'auto' || !(r > 0) ? null : r,
    rate: pick(params.rate, ['fast', 'medium', 'slow'] as const, 'medium'),
    digits: d === '4.5' ? 4 : d === '5.5' ? 5 : 6,
    math: pick(params.math, DMM_MATHS, 'none'),
    nullValue: num('nullvalue'),
    dbRef: num('dbref') > 0 ? num('dbref') : 1,
    dbmRef: num('dbmref') > 0 ? num('dbmref') : 600,
    limitLow: num('limitlow'),
    limitHigh: num('limithigh'),
    zin: num('zin') > 0 ? num('zin') : 10e6,
    itest: num('itest') > 0 ? num('itest') : 1e-3,
  };
}

/** Base unit of a function's reading. */
export function dmmUnit(fn: DmmFunction): string {
  switch (fn) {
    case 'dcv':
    case 'acv':
    case 'diode':
      return 'V';
    case 'dci':
    case 'aci':
      return 'A';
    case 'ohm':
    case 'cont':
      return 'Ω';
    case 'freq':
      return 'Hz';
    case 'period':
      return 's';
  }
}

/** Full-scale ranges of a function (ascending). */
export function dmmRanges(fn: DmmFunction): number[] {
  switch (fn) {
    case 'dcv':
      return [0.1, 1, 10, 100, 1000];
    case 'acv':
      return [0.1, 1, 10, 100, 750];
    case 'dci':
    case 'aci':
      return [100e-6, 1e-3, 10e-3, 100e-3, 1, 3];
    case 'ohm':
      return [100, 1e3, 10e3, 100e3, 1e6, 10e6, 100e6];
    case 'cont':
      return [1e3];
    case 'diode':
      return [1];
    case 'freq':
      return [1e9];
    case 'period':
      return [1e3];
  }
}

/** Smallest range holding |v| within its 120 % over-range (the largest when none does). */
export function dmmAutoRange(fn: DmmFunction, v: number): number {
  const ranges = dmmRanges(fn);
  const a = Math.abs(v);
  if (!Number.isFinite(a)) return ranges[ranges.length - 1];
  return ranges.find((r) => a <= 1.2 * r) ?? ranges[ranges.length - 1];
}

const PREFIX: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
];

export interface DmmDisplay {
  /** sign and digits ("+05.12345"), "OVLD" or "-------" */
  text: string;
  /** unit with prefix ("V", "mV", "kΩ") */
  unit: string;
  overload: boolean;
  /** range label ("10 V") */
  rangeLabel: string;
}

/** Prefix scale of a range (100 mV → 1e-3, 10 kΩ → 1e3); volts and amps never use k / M. */
function rangeScale(range: number, unit = 'Ω'): number {
  for (const [mul] of PREFIX) if (range >= mul * 0.999999) return unit === 'V' || unit === 'A' ? Math.min(mul, 1) : mul;
  return 1e-9;
}

/** Fixed-resolution display text of a reading on a range. */
export function dmmFormat(v: number, range: number, digits: 4 | 5 | 6, unit: string): DmmDisplay {
  const mul = rangeScale(range, unit);
  const pre = PREFIX.find(([m]) => m === mul)?.[1] ?? '';
  const m = range / mul;
  const intDigits = Math.max(1, Math.floor(Math.log10(m) + 1e-9) + 1);
  const decimals = Math.max(0, digits - (intDigits - 1));
  const rangeLabel = `${Number(m.toPrecision(3))} ${pre}${unit}`;
  if (Number.isNaN(v)) return { text: '-------', unit: `${pre}${unit}`, overload: false, rangeLabel };
  if (!Number.isFinite(v) || Math.abs(v) > 1.2 * range * (1 + 1e-12)) return { text: 'OVLD', unit: `${pre}${unit}`, overload: true, rangeLabel };
  const scaled = v / mul;
  let body = Math.abs(scaled).toFixed(decimals);
  // pad the integer part to the range's digit count (leading zero like a real display)
  const [ip, fp] = body.split('.');
  body = ip.padStart(intDigits, '0') + (fp !== undefined ? `.${fp}` : '');
  const zero = Number(body) === 0;
  return { text: `${scaled < 0 && !zero ? '−' : '+'}${body}`, unit: `${pre}${unit}`, overload: false, rangeLabel };
}

/** Resolution (one count) of a range in base units. */
export function dmmResolution(range: number, digits: 4 | 5 | 6, unit = 'V'): number {
  const mul = rangeScale(range, unit);
  const m = range / mul;
  const intDigits = Math.max(1, Math.floor(Math.log10(m) + 1e-9) + 1);
  return mul * 10 ** -(digits - (intDigits - 1));
}

/** True RMS of the AC part of a sampled window (time-weighted). */
export function acRmsOf(time: ArrayLike<number>, values: ArrayLike<number>, t0: number, t1: number): number {
  const mean = windowMean(time, values, t0, t1);
  let area = 0;
  let span = 0;
  for (let i = 0; i + 1 < time.length; i++) {
    const a = Math.max(t0, time[i]);
    const b = Math.min(t1, time[i + 1]);
    if (b <= a) continue;
    const dt = time[i + 1] - time[i];
    const va = (dt > 0 ? values[i] + ((a - time[i]) / dt) * (values[i + 1] - values[i]) : values[i]) - mean;
    const vb = (dt > 0 ? values[i] + ((b - time[i]) / dt) * (values[i + 1] - values[i]) : values[i + 1]) - mean;
    // exact integral of a squared linear segment
    area += ((va * va + va * vb + vb * vb) / 3) * (b - a);
    span += b - a;
  }
  return span > 0 ? Math.sqrt(area / span) : Number.NaN;
}

export interface DmmReading {
  /** end time of the reading's window */
  t: number;
  /** raw measured quantity before math (V, A, Ω, Hz, s) */
  value: number;
}

/** Ohms from the HI–LO voltage with the test current and input resistance. */
export function dmmOhms(v: number, itest: number, zin: number): number {
  if (!Number.isFinite(v)) return Number.NaN;
  if (v <= 0) return v === 0 ? 0 : Number.POSITIVE_INFINITY;
  const g = itest / v - 1 / zin;
  return g > 1e-6 / zin ? 1 / g : Number.POSITIVE_INFINITY;
}

/**
 * Readings of a record: consecutive aperture windows ending after `after` (exclusive), at most
 * `max` (the newest). Values are in base units of the function.
 */
export function dmmReadings(time: ArrayLike<number>, v: ArrayLike<number> | undefined, i: ArrayLike<number> | undefined, s: DmmSettings, after = -Infinity, max = 200): DmmReading[] {
  const n = time.length;
  if (n < 2) return [];
  const t0 = time[0];
  const t1 = time[n - 1];
  const ap = DMM_APERTURE[s.rate];
  const src = s.fn === 'dci' || s.fn === 'aci' ? i : v;
  if (!src) return [];
  const out: DmmReading[] = [];
  const one = (a: number, b: number): number => {
    switch (s.fn) {
      case 'dcv':
      case 'dci':
        return windowMean(time, src, a, b);
      case 'acv':
      case 'aci':
        return acRmsOf(time, src, a, b);
      case 'ohm':
      case 'cont':
        return dmmOhms(windowMean(time, src, a, b), s.itest, s.zin);
      case 'diode': {
        const vd = windowMean(time, src, a, b);
        return vd > 1.2 ? Number.POSITIVE_INFINITY : vd;
      }
      case 'freq':
      case 'period': {
        const i0 = lowerIndex(time, a);
        const i1 = Math.min(n - 1, lowerIndex(time, b) + 1);
        const m = counterMeasure(Array.prototype.slice.call(time, i0, i1 + 1), Array.prototype.slice.call(src, i0, i1 + 1), { coupling: 'ac' });
        return s.fn === 'freq' ? m.freq : 1 / m.freq;
      }
    }
  };
  // frequency needs several periods: use a gate of at least 10 apertures
  const gate = s.fn === 'freq' || s.fn === 'period' ? Math.max(ap * 10, 0) : ap;
  if (t1 - t0 < gate) {
    if (t1 > after) out.push({ t: t1, value: one(t0, t1) });
    return out;
  }
  const count = Math.floor((t1 - t0) / gate);
  const first = Math.max(0, count - max);
  for (let k = first; k < count; k++) {
    const b = t0 + (k + 1) * gate;
    if (b <= after) continue;
    out.push({ t: b, value: one(b - gate, b) });
  }
  return out;
}

function lowerIndex(time: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = time.length - 1;
  if (t <= time[0]) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Running statistics (Welford). */
export interface DmmStats {
  count: number;
  mean: number;
  m2: number;
  min: number;
  max: number;
}

export const emptyStats = (): DmmStats => ({ count: 0, mean: 0, m2: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });

export function addStat(s: DmmStats, x: number): DmmStats {
  if (!Number.isFinite(x)) return s;
  const count = s.count + 1;
  const d = x - s.mean;
  const mean = s.mean + d / count;
  return { count, mean, m2: s.m2 + d * (x - mean), min: Math.min(s.min, x), max: Math.max(s.max, x) };
}

/** Sample standard deviation (n − 1); NaN below two readings. */
export function statSdev(s: DmmStats): number {
  return s.count > 1 ? Math.sqrt(s.m2 / (s.count - 1)) : Number.NaN;
}

export type LimitResult = 'pass' | 'high' | 'low';

/** Result of the math function on a reading. */
export function dmmMath(s: DmmSettings, x: number): { value: number; unit: string | null; limit?: LimitResult } {
  switch (s.math) {
    case 'null':
      return { value: x - s.nullValue, unit: null };
    case 'db':
      return { value: 20 * Math.log10(Math.abs(x) / s.dbRef), unit: 'dB' };
    case 'dbm':
      return { value: 10 * Math.log10((x * x) / s.dbmRef / 1e-3), unit: 'dBm' };
    case 'limit':
      return { value: x, unit: null, limit: x > s.limitHigh ? 'high' : x < s.limitLow ? 'low' : 'pass' };
    default:
      return { value: x, unit: null };
  }
}

/** Continuity threshold (Ω): readings below it beep. */
export const CONTINUITY_OHMS = 10;
