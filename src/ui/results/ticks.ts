/**
 * Axis scaling and tick generation for plots (grapher and instrument screens).
 *
 * - `linearTicks` picks "nice" 1/2/5 x 10^n steps (Heckbert's algorithm, adapted).
 * - `logTicks` produces decade majors with 2..9 minors (or sub-decade majors for narrow spans).
 * - `niceRange` expands a data range to tick-aligned bounds with a little head-room.
 * - `axisFormatter` formats tick labels with ONE common engineering prefix per axis so labels
 *   line up ("0.5ms 1.0ms 1.5ms" rather than "500µs 1ms 1.5ms").
 *
 * Everything here is pure and DOM-free.
 */

export interface TickSet {
  /** labelled ticks, ascending */
  major: number[];
  /** unlabelled ticks between majors, ascending */
  minor: number[];
  /** spacing between major ticks (linear) or decades per major tick (log) */
  step: number;
}

const EPS = 1e-9;

/** Smallest 1/2/5 x 10^n value that is >= `raw` (raw > 0). */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  let nice: number;
  if (frac <= 1 + EPS) nice = 1;
  else if (frac <= 2 + EPS) nice = 2;
  else if (frac <= 5 + EPS) nice = 5;
  else nice = 10;
  return nice * base;
}

/** Remove floating point noise such as 0.30000000000000004 relative to the step. */
function snap(v: number, step: number): number {
  const q = Math.round(v / step);
  const snapped = q * step;
  return Math.abs(snapped) < step * 1e-9 ? 0 : Number(snapped.toPrecision(12));
}

/**
 * Ticks for a linear axis covering [min, max]. Only ticks inside the range (with a tiny tolerance)
 * are returned. `target` is the desired number of major intervals.
 */
export function linearTicks(min: number, max: number, target = 6): TickSet {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { major: [], minor: [], step: 1 };
  if (min > max) [min, max] = [max, min];
  const span = max - min;
  if (span <= 0) {
    return { major: [min], minor: [], step: Math.abs(min) || 1 };
  }
  const step = niceStep(span / Math.max(1, target));
  const tol = step * 1e-6;
  const first = Math.ceil((min - tol) / step);
  const last = Math.floor((max + tol) / step);
  const major: number[] = [];
  for (let i = first; i <= last && major.length < 1000; i++) major.push(snap(i * step, step));

  // Minor subdivision: 5 for 1x and 10x steps, 4 for 2x steps (0.5 sub-steps), 5 for 5x.
  const mant = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + EPS)));
  const sub = mant === 2 ? 4 : 5;
  const minorStep = step / sub;
  const minor: number[] = [];
  const mFirst = Math.ceil((min - tol) / minorStep);
  const mLast = Math.floor((max + tol) / minorStep);
  if (mLast - mFirst < 5000) {
    for (let i = mFirst; i <= mLast; i++) {
      if (i % sub === 0) continue;
      minor.push(snap(i * minorStep, minorStep));
    }
  }
  return { major, minor, step };
}

/**
 * Ticks for a logarithmic axis covering [min, max] (both must be > 0).
 * For spans of at least one decade the majors are powers of ten (every `step` decades when the
 * span is wide); minors are 2..9 x 10^n. For narrower spans the majors are 1..9 x 10^n.
 */
export function logTicks(min: number, max: number, target = 6): TickSet {
  if (!(min > 0) || !(max > 0) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return { major: [], minor: [], step: 1 };
  }
  if (min > max) [min, max] = [max, min];
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const decades = hi - lo;
  const tolLog = 1e-9;
  const inRange = (v: number) => {
    const l = Math.log10(v);
    return l >= lo - tolLog && l <= hi + tolLog;
  };
  const major: number[] = [];
  const minor: number[] = [];
  const dFirst = Math.floor(lo + tolLog);
  const dLast = Math.ceil(hi - tolLog);

  if (decades < 1 - 1e-9) {
    // Sub-decade span: label every mantissa 1..9 that falls inside.
    for (let d = dFirst; d <= dLast; d++) {
      const p = Math.pow(10, d);
      for (let m = 1; m <= 9; m++) {
        const v = Number((m * p).toPrecision(12));
        if (inRange(v)) major.push(v);
      }
    }
    if (major.length < 2) {
      // Extremely narrow: fall back to linear ticks inside the range.
      const lin = linearTicks(min, max, target);
      return { major: lin.major.filter((v) => v > 0), minor: lin.minor.filter((v) => v > 0), step: 0 };
    }
    return { major, minor, step: 0 };
  }

  const step = Math.max(1, Math.ceil(decades / Math.max(1, target)));
  for (let d = dFirst; d <= dLast; d++) {
    const p = Number(Math.pow(10, d).toPrecision(12));
    if (d % step === 0 && inRange(p)) major.push(p);
    else if (inRange(p)) minor.push(p);
    if (step === 1 && decades <= 12) {
      for (let m = 2; m <= 9; m++) {
        const v = Number((m * p).toPrecision(12));
        if (inRange(v)) minor.push(v);
      }
    }
  }
  minor.sort((a, b) => a - b);
  return { major, minor, step };
}

/**
 * Expand [min, max] to "nice" axis bounds. Equal bounds get a symmetric margin. With `log`
 * the bounds snap outward to whole decades (or to 1/2/5 mantissas for sub-decade spans).
 * Non-positive values are invalid on a log axis; the caller should filter them first.
 */
export function niceRange(min: number, max: number, log = false, target = 6): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return log ? [1, 10] : [-1, 1];
  if (min > max) [min, max] = [max, min];
  if (log) {
    if (!(min > 0)) return [1, 10];
    if (min === max) return [min / 10, max * 10];
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    if (hi - lo >= 1) return [Math.pow(10, Math.floor(lo + 1e-9)), Math.pow(10, Math.ceil(hi - 1e-9))];
    const snapDown = (v: number) => {
      const p = Math.pow(10, Math.floor(Math.log10(v) + 1e-12));
      const m = v / p;
      const nice = [1, 2, 5, 10].reverse().find((n) => n <= m + 1e-9) ?? 1;
      return nice * p;
    };
    const snapUp = (v: number) => {
      const p = Math.pow(10, Math.floor(Math.log10(v) + 1e-12));
      const m = v / p;
      const nice = [1, 2, 5, 10].find((n) => n >= m - 1e-9) ?? 10;
      return nice * p;
    };
    return [snapDown(min), snapUp(max)];
  }
  if (min === max) {
    const d = min === 0 ? 1 : Math.abs(min) * 0.1;
    return [min - d, max + d];
  }
  const step = niceStep((max - min) / Math.max(1, target));
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  return [snap(lo, step), snap(hi, step)];
}

const PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

/** Engineering prefix (multiplier, symbol) that keeps |v| in [1, 1000). */
export function engPrefix(v: number): [number, string] {
  const a = Math.abs(v);
  if (!(a > 0) || !Number.isFinite(a)) return [1, ''];
  for (const p of PREFIXES) if (a >= p[0] * 0.999999) return p;
  return PREFIXES[PREFIXES.length - 1];
}

/**
 * Build a label formatter shared by every tick of one axis. The prefix is chosen from the
 * largest |tick|, decimals from the step so adjacent labels differ: e.g. ticks
 * [0, 5e-4, 1e-3] with unit 's' -> "0", "0.5ms", "1.0ms".
 */
export function axisFormatter(ticks: number[], step: number, unit = ''): (v: number) => string {
  const maxAbs = ticks.reduce((m, t) => Math.max(m, Math.abs(t)), 0);
  const [mul, sym] = engPrefix(maxAbs || step);
  const scaledStep = step > 0 ? step / mul : 1;
  const decimals = Math.min(9, Math.max(0, -Math.floor(Math.log10(scaledStep) + 1e-9)));
  return (v: number) => {
    if (Math.abs(v) < step * 1e-9 || v === 0) return '0';
    return (v / mul).toFixed(decimals) + sym + unit;
  };
}

/** Label for a single log-axis tick: 1k, 10k, 2.2M ... (mantissa kept to 3 significant digits). */
export function formatLogTick(v: number, unit = ''): string {
  if (v === 0) return '0';
  const [mul, sym] = engPrefix(v);
  const scaled = Number((v / mul).toPrecision(3));
  return `${scaled}${sym}${unit}`;
}

/** Map a data value to a 0..1 fraction of the axis span (log or linear). */
export function axisFraction(v: number, min: number, max: number, log: boolean): number {
  if (log) {
    if (!(v > 0)) return Number.NaN;
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    return (Math.log10(v) - lo) / (hi - lo || 1);
  }
  return (v - min) / (max - min || 1);
}

/** Inverse of `axisFraction`. */
export function axisValue(frac: number, min: number, max: number, log: boolean): number {
  if (log) {
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    return Math.pow(10, lo + frac * (hi - lo));
  }
  return min + frac * (max - min);
}

/**
 * Zoom an axis range around an anchor value by `factor` (< 1 zooms in, > 1 zooms out).
 * Works in log space for log axes so the anchor stays under the mouse.
 */
export function zoomRange(min: number, max: number, anchor: number, factor: number, log: boolean): [number, number] {
  if (log) {
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    const a = Math.log10(anchor > 0 ? anchor : Math.sqrt(min * max));
    return [Math.pow(10, a - (a - lo) * factor), Math.pow(10, a + (hi - a) * factor)];
  }
  return [anchor - (anchor - min) * factor, anchor + (max - anchor) * factor];
}

/** Shift an axis range by a fraction of its span (log-aware). */
export function panRange(min: number, max: number, deltaFrac: number, log: boolean): [number, number] {
  if (log) {
    const lo = Math.log10(min);
    const hi = Math.log10(max);
    const d = (hi - lo) * deltaFrac;
    return [Math.pow(10, lo + d), Math.pow(10, hi + d)];
  }
  const d = (max - min) * deltaFrac;
  return [min + d, max + d];
}
