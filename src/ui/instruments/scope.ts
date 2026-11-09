/**
 * Oscilloscope acquisition logic (pure): trigger detection, sweep window selection, input
 * coupling and settings parsing. The panel (Oscilloscope.tsx) only draws what this returns.
 *
 * Screen model: 10 horizontal x 8 vertical divisions. The left screen edge is at
 * `ref + xpos * timebase`, where `ref` is the trigger time (triggered sweeps) or the start of
 * the current free-running sweep. Positive X position therefore shows later data.
 *
 * Trigger modes
 * - none   : free run; sweeps tile the time axis [k*span, (k+1)*span] and fill as time advances.
 * - auto   : newest trigger whose full sweep is available; free-run when no trigger is found.
 * - normal : like auto, but without a trigger the previous frame stays on screen.
 * - single : the first trigger after the arm time; the frame then freezes until re-armed.
 */

import { parseUserNumber } from '../../util/units';

export type TriggerEdge = 'rising' | 'falling';
export type TriggerMode = 'auto' | 'normal' | 'single' | 'none';
export type Coupling = 'ac' | 'dc' | 'gnd';
/** Y/T, A+B, B vs A (A horizontal), A vs B (B horizontal) */
export type DisplayMode = 'yt' | 'add' | 'ba' | 'ab';

export const SCOPE_DIVS_X = 10;
export const SCOPE_DIVS_Y = 8;

/**
 * Interpolated trigger instants in [t0, t1]: crossings of `level` in the `edge` direction.
 * After each trigger the signal must leave the band level -/+ hysteresis before re-arming,
 * which keeps noisy edges from triggering repeatedly.
 */
export function findTriggers(
  time: ArrayLike<number>,
  values: ArrayLike<number>,
  level: number,
  edge: TriggerEdge,
  t0 = -Infinity,
  t1 = Infinity,
  hysteresis = 0,
): number[] {
  const n = time.length;
  const out: number[] = [];
  if (n < 2) return out;
  const rising = edge === 'rising';
  const h = Math.abs(hysteresis);
  let armed = false;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isNaN(v)) {
      armed = false;
      continue;
    }
    if (!armed) {
      if (rising ? v < level - h : v > level + h) armed = true;
      continue;
    }
    if (rising ? v >= level : v <= level) {
      const a = values[i - 1];
      const ta = time[i - 1];
      const tb = time[i];
      const t = v === a ? tb : ta + ((level - a) / (v - a)) * (tb - ta);
      if (t >= t0 && t <= t1) out.push(t);
      armed = false;
    }
  }
  return out;
}

export interface SweepSettings {
  /** seconds per division */
  timebase: number;
  /** horizontal position in divisions */
  xpos: number;
  mode: TriggerMode;
  edge: TriggerEdge;
  level: number;
  /** trigger hysteresis (V); default 0.2 % of |level| (the panel uses 0.1 division) */
  hysteresis?: number;
}

export interface SweepSource {
  /** oldest / newest available sample time */
  start: number;
  end: number;
  /** trigger signal samples (time, values) covering at least the search range */
  trigTime: ArrayLike<number>;
  trigValues: ArrayLike<number>;
}

export interface SweepWindow {
  left: number;
  right: number;
  /** trigger instant of a triggered sweep (null for free-running) */
  trigger: number | null;
  status: 'triggered' | 'free-run' | 'waiting' | 'stopped';
}

/**
 * Choose the time window to display.
 * `previous` is the last frame shown (kept by 'normal' / 'single' when no new trigger is found);
 * `armedAt` is the time from which a 'single' acquisition may trigger.
 */
export function selectSweep(src: SweepSource, s: SweepSettings, previous: SweepWindow | null = null, armedAt = -Infinity): SweepWindow {
  const span = SCOPE_DIVS_X * s.timebase;
  const offset = s.xpos * s.timebase;
  const freeRun = (): SweepWindow => {
    const k = Math.max(0, Math.ceil(src.end / span) - 1);
    const left = k * span + offset;
    return { left, right: left + span, trigger: null, status: 'free-run' };
  };
  if (!Number.isFinite(src.end) || !(span > 0)) return { left: offset, right: offset + span, trigger: null, status: 'waiting' };
  if (s.mode === 'none') return freeRun();
  const hysteresis = s.hysteresis ?? 0.002 * Math.abs(s.level) + 1e-9;
  const latestTrig = src.end - offset - span;
  if (s.mode === 'single') {
    // a frame captured since arming stays frozen
    if (previous && previous.trigger !== null && previous.trigger >= armedAt && previous.status !== 'waiting') {
      return { ...previous, status: 'stopped' };
    }
    const trig = findTriggers(src.trigTime, src.trigValues, s.level, s.edge, Math.max(armedAt, src.start), latestTrig, hysteresis);
    if (trig.length) {
      const t = trig[0];
      return { left: t + offset, right: t + offset + span, trigger: t, status: 'stopped' };
    }
    return previous ? { ...previous, status: 'waiting' } : { ...freeRun(), status: 'waiting' };
  }
  const lookBack = s.mode === 'auto' ? 4 * span : 64 * span;
  const trig = findTriggers(src.trigTime, src.trigValues, s.level, s.edge, Math.max(src.start, latestTrig - lookBack), latestTrig, hysteresis);
  if (trig.length) {
    const t = trig[trig.length - 1];
    return { left: t + offset, right: t + offset + span, trigger: t, status: 'triggered' };
  }
  if (s.mode === 'normal') return previous ? { ...previous, status: 'waiting' } : { ...freeRun(), status: 'waiting' };
  return freeRun();
}

/** Time-weighted mean of samples inside [t0, t1] (for AC coupling). */
export function windowMean(time: ArrayLike<number>, values: ArrayLike<number>, t0: number, t1: number): number {
  let area = 0;
  let span = 0;
  for (let i = 0; i + 1 < time.length; i++) {
    const a = Math.max(t0, time[i]);
    const b = Math.min(t1, time[i + 1]);
    if (b <= a || Number.isNaN(values[i]) || Number.isNaN(values[i + 1])) continue;
    const dt = time[i + 1] - time[i];
    const va = dt > 0 ? values[i] + ((a - time[i]) / dt) * (values[i + 1] - values[i]) : values[i];
    const vb = dt > 0 ? values[i] + ((b - time[i]) / dt) * (values[i + 1] - values[i]) : values[i + 1];
    area += 0.5 * (va + vb) * (b - a);
    span += b - a;
  }
  if (span > 0) return area / span;
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) {
      s += values[i];
      n++;
    }
  }
  return n ? s / n : 0;
}

/** Apply input coupling: DC unchanged, AC removes the window mean, GND reads 0. */
export function applyCoupling(time: ArrayLike<number>, values: Float64Array, coupling: Coupling, t0: number, t1: number): Float64Array {
  if (coupling === 'dc') return values;
  if (coupling === 'gnd') return new Float64Array(values.length);
  const m = windowMean(time, values, t0, t1);
  return values.map((v) => v - m);
}

/** Linear interpolation of a sampled channel at time t (NaN outside the data). */
export function sampleAt(time: ArrayLike<number>, values: ArrayLike<number>, t: number): number {
  const n = time.length;
  if (n === 0 || t < time[0] || t > time[n - 1]) return Number.NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid;
    else hi = mid;
  }
  const ta = time[lo];
  const tb = time[hi];
  return tb === ta ? values[hi] : values[lo] + ((t - ta) / (tb - ta)) * (values[hi] - values[lo]);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ChannelSettings {
  /** volts per division */
  scale: number;
  /** vertical position (divisions) */
  pos: number;
  coupling: Coupling;
}

export interface ScopeSettings extends SweepSettings {
  display: DisplayMode;
  /** trigger source: channel name or 'ext' */
  source: string;
  channels: Record<string, ChannelSettings>;
  /** cursor positions in divisions from the left edge (0..10) */
  t1: number;
  t2: number;
  /** white screen instead of the dark phosphor look */
  reverse: boolean;
}

/**
 * Param keys (all text, user number syntax):
 *   timebase (s/div), xpos (div), display (yt|add|ba|ab),
 *   trig.edge (rising|falling), trig.level (V), trig.source (A|B|C|D|ext), trig.mode (auto|normal|single|none),
 *   <ch>.scale (V/div), <ch>.pos (div), <ch>.coupling (ac|dc|gnd)  for ch in A, B, C, D
 *   t1, t2 (cursor divisions), reverse (true|false)
 */
export const SCOPE_DEFAULTS: Record<string, string> = {
  timebase: '1m',
  xpos: '0',
  display: 'yt',
  'trig.edge': 'rising',
  'trig.level': '0',
  'trig.source': 'A',
  'trig.mode': 'auto',
  t1: '2',
  t2: '7',
  reverse: 'false',
};

export const CHANNEL_DEFAULTS: ChannelSettings = { scale: 1, pos: 0, coupling: 'dc' };

function num(params: Record<string, string>, key: string, fallback: number): number {
  const t = params[key];
  if (t === undefined || t.trim() === '') return fallback;
  const v = parseUserNumber(t);
  return Number.isFinite(v) ? v : fallback;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = (value ?? '').trim().toLowerCase();
  return (allowed.find((a) => a.toLowerCase() === v) ?? fallback) as T;
}

/** Parse scope params for the given channel names (invalid text falls back to defaults). */
export function parseScopeSettings(params: Record<string, string>, channelNames: readonly string[]): ScopeSettings {
  const channels: Record<string, ChannelSettings> = {};
  for (const ch of channelNames) {
    const scale = num(params, `${ch}.scale`, CHANNEL_DEFAULTS.scale);
    channels[ch] = {
      scale: scale > 0 ? scale : CHANNEL_DEFAULTS.scale,
      pos: num(params, `${ch}.pos`, 0),
      coupling: pick(params[`${ch}.coupling`], ['ac', 'dc', 'gnd'] as const, 'dc'),
    };
  }
  const tb = num(params, 'timebase', 1e-3);
  const sourceText = (params['trig.source'] ?? 'A').trim();
  const source = sourceText.toLowerCase() === 'ext' ? 'ext' : (channelNames.find((c) => c.toLowerCase() === sourceText.toLowerCase()) ?? channelNames[0] ?? 'A');
  return {
    timebase: tb > 0 ? tb : 1e-3,
    xpos: num(params, 'xpos', 0),
    mode: pick(params['trig.mode'], ['auto', 'normal', 'single', 'none'] as const, 'auto'),
    edge: pick(params['trig.edge'], ['rising', 'falling'] as const, 'rising'),
    level: num(params, 'trig.level', 0),
    display: pick(params.display, ['yt', 'add', 'ba', 'ab'] as const, 'yt'),
    source,
    channels,
    t1: Math.max(0, Math.min(SCOPE_DIVS_X, num(params, 't1', 2))),
    t2: Math.max(0, Math.min(SCOPE_DIVS_X, num(params, 't2', 7))),
    reverse: (params.reverse ?? '').trim().toLowerCase() === 'true',
  };
}

/** Standard 1-2-5 sequence of per-division settings between `min` and `max`. */
export function sequence125(min: number, max: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)) - 1; e <= Math.ceil(Math.log10(max)) + 1; e++) {
    for (const m of [1, 2, 5]) {
      const v = Number((m * Math.pow(10, e)).toPrecision(6));
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  }
  return out;
}

/** Next 1-2-5 step up (dir = 1) or down (dir = -1) from `value`. */
export function step125(value: number, dir: 1 | -1, min = 1e-12, max = 1e6): number {
  const seq = sequence125(min, max);
  if (dir > 0) return seq.find((v) => v > value * (1 + 1e-9)) ?? seq[seq.length - 1];
  for (let i = seq.length - 1; i >= 0; i--) if (seq[i] < value * (1 - 1e-9)) return seq[i];
  return seq[0];
}

/** CSV of a scope capture: time column plus one column per channel. */
export function scopeCsv(time: ArrayLike<number>, columns: { name: string; values: ArrayLike<number> }[]): string {
  const head = ['Time [s]', ...columns.map((c) => `${c.name} [V]`)].join(',');
  const lines = [head];
  for (let i = 0; i < time.length; i++) {
    lines.push([time[i], ...columns.map((c) => c.values[i])].map((v) => (Number.isFinite(v) ? String(v) : '')).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
