/**
 * Logic analyzer acquisition (pure): thresholding, internal / external (qualified) clocking,
 * 16-bit word sampling, pattern triggering and capture windowing.
 *
 * Channel keys: d0..d15 (data, d0 = LSB), clk (external clock), qual (clock qualifier),
 * trig (external trigger input).
 * Trigger patterns are 16 characters, MSB (d15) first, each '0', '1' or 'x' (don't care).
 * A pattern trigger fires on the first sample whose word matches while the previous one did not;
 * an external trigger fires on the first sample at or after a rising edge of `trig`.
 */

import { parseUserNumber } from '../../util/units';
import { sampleAt } from './scope';

export const LOGIC_CHANNELS = 16;

export interface LogicAnalyzerSettings {
  /** logic threshold (V) */
  threshold: number;
  clock: 'internal' | 'external';
  /** internal sampling clock (Hz) */
  clockRate: number;
  clockEdge: 'rising' | 'falling';
  /** external clock qualifier: sample only when qual is 'x' (ignored), '0' or '1' */
  qualifier: 'x' | '0' | '1';
  trigMode: 'none' | 'pattern' | 'external';
  /** 16 chars MSB first */
  pattern: string;
  /** samples shown before / after the trigger */
  pre: number;
  post: number;
}

/**
 * Params (text): threshold (V), clock (internal|external), clockrate (Hz), clkedge (rising|falling),
 * qual (x|0|1), trigmode (none|pattern|external), pattern (16 chars 0/1/x, MSB first), pre, post (samples),
 * t1 / t2 (cursor sample offsets).
 */
export const LOGIC_ANALYZER_DEFAULTS: Record<string, string> = {
  threshold: '2.5',
  clock: 'internal',
  clockrate: '10k',
  clkedge: 'rising',
  qual: 'x',
  trigmode: 'none',
  pattern: 'xxxxxxxxxxxxxxxx',
  pre: '100',
  post: '400',
};

export function normalizePattern(p: string): string {
  const chars = p.replace(/\s+/g, '').toLowerCase().split('').filter((ch) => ch === '0' || ch === '1' || ch === 'x');
  while (chars.length < LOGIC_CHANNELS) chars.unshift('x');
  return chars.slice(chars.length - LOGIC_CHANNELS).join('');
}

export function parseLogicAnalyzerSettings(params: Record<string, string>): LogicAnalyzerSettings {
  const num = (k: string) => {
    const v = parseUserNumber(params[k] ?? LOGIC_ANALYZER_DEFAULTS[k]);
    return Number.isFinite(v) ? v : parseUserNumber(LOGIC_ANALYZER_DEFAULTS[k]);
  };
  const low = (k: string) => (params[k] ?? LOGIC_ANALYZER_DEFAULTS[k]).trim().toLowerCase();
  const rate = num('clockrate');
  const q = low('qual');
  return {
    threshold: num('threshold'),
    clock: low('clock') === 'external' ? 'external' : 'internal',
    clockRate: rate > 0 ? rate : 1e4,
    clockEdge: low('clkedge') === 'falling' ? 'falling' : 'rising',
    qualifier: q === '0' || q === '1' ? q : 'x',
    trigMode: low('trigmode') === 'pattern' ? 'pattern' : low('trigmode') === 'external' ? 'external' : 'none',
    pattern: normalizePattern(params.pattern ?? LOGIC_ANALYZER_DEFAULTS.pattern),
    pre: Math.max(0, Math.round(num('pre'))),
    post: Math.max(1, Math.round(num('post'))),
  };
}

/** Logic level of a voltage: 1 above the threshold, 0 at or below, NaN (high-Z / unknown) for NaN. */
export function logicLevel(v: number, threshold: number): number {
  if (Number.isNaN(v)) return Number.NaN;
  return v > threshold ? 1 : 0;
}

/** Uniform internal clock instants k / rate in [t0, t1]. */
export function internalClock(t0: number, t1: number, rate: number, maxSamples = 1 << 16): number[] {
  if (!(rate > 0) || !(t1 >= t0)) return [];
  const k0 = Math.ceil(t0 * rate - 1e-9);
  const k1 = Math.floor(t1 * rate + 1e-9);
  const first = Math.max(k0, k1 - maxSamples + 1);
  const out: number[] = [];
  for (let k = first; k <= k1; k++) out.push(k / rate);
  return out;
}

/**
 * Edges of an external clock (interpolated threshold crossings). When `qual` samples are given
 * and the qualifier is '0' / '1', only edges where the qualifier has that level are kept.
 */
export function externalClock(
  time: ArrayLike<number>,
  clk: ArrayLike<number>,
  threshold: number,
  edge: 'rising' | 'falling',
  qual?: ArrayLike<number>,
  qualifier: 'x' | '0' | '1' = 'x',
): number[] {
  const out: number[] = [];
  for (let i = 1; i < time.length; i++) {
    const a = clk[i - 1];
    const b = clk[i];
    const crossed = edge === 'rising' ? a <= threshold && b > threshold : a > threshold && b <= threshold;
    if (!crossed) continue;
    const t = b === a ? time[i] : time[i - 1] + ((threshold - a) / (b - a)) * (time[i] - time[i - 1]);
    if (qual && qualifier !== 'x') {
      const q = logicLevel(sampleAt(time, qual, t), threshold);
      if (q !== (qualifier === '1' ? 1 : 0)) continue;
    }
    out.push(t);
  }
  return out;
}

export interface LogicSamples {
  times: number[];
  /** per channel 0..15: level at each sample time (0, 1 or NaN) */
  levels: number[][];
  /** packed words (bit k = channel k; unknown channels read 0) */
  words: number[];
  /** bit k set when channel k is unknown / high-Z at that sample */
  unknown: number[];
}

/** Sample the 16 data channels at the given instants. Missing channels are all-unknown. */
export function sampleChannels(time: ArrayLike<number>, channels: (ArrayLike<number> | undefined)[], instants: readonly number[], threshold: number): LogicSamples {
  const levels: number[][] = [];
  for (let c = 0; c < LOGIC_CHANNELS; c++) {
    const data = channels[c];
    levels.push(instants.map((t) => (data ? logicLevel(sampleAt(time, data, t), threshold) : Number.NaN)));
  }
  const words: number[] = [];
  const unknown: number[] = [];
  for (let k = 0; k < instants.length; k++) {
    let w = 0;
    let u = 0;
    for (let c = 0; c < LOGIC_CHANNELS; c++) {
      const v = levels[c][k];
      if (Number.isNaN(v)) u |= 1 << c;
      else if (v) w |= 1 << c;
    }
    words.push(w);
    unknown.push(u);
  }
  return { times: instants.slice(), levels, words, unknown };
}

/** Does a 16-bit word (with unknown-bit mask) match a pattern (MSB first)? Unknown bits only match 'x'. */
export function matchPattern(word: number, pattern: string, unknown = 0): boolean {
  const p = normalizePattern(pattern);
  for (let c = 0; c < LOGIC_CHANNELS; c++) {
    const ch = p[LOGIC_CHANNELS - 1 - c];
    if (ch === 'x') continue;
    if (unknown & (1 << c)) return false;
    if (((word >> c) & 1) !== (ch === '1' ? 1 : 0)) return false;
  }
  return true;
}

/** Index of the first sample >= `from` where the pattern starts matching, or -1. */
export function findPatternTrigger(words: readonly number[], pattern: string, unknown: readonly number[] = [], from = 0): number {
  let prev = from > 0 ? matchPattern(words[from - 1], pattern, unknown[from - 1] ?? 0) : false;
  for (let k = Math.max(0, from); k < words.length; k++) {
    const m = matchPattern(words[k], pattern, unknown[k] ?? 0);
    if (m && !prev) return k;
    prev = m;
  }
  return -1;
}

export interface Capture {
  /** sample index range [first, last] of the capture */
  first: number;
  last: number;
  /** trigger sample index (null for an untriggered capture of the newest samples) */
  trigger: number | null;
}

/**
 * Capture window: `pre` samples before and `post` after the newest pattern trigger whose
 * post-trigger samples are complete; without a trigger (or trigMode 'none') the newest
 * pre + post samples.
 */
export function captureWindow(s: LogicSamples, settings: Pick<LogicAnalyzerSettings, 'trigMode' | 'pattern' | 'pre' | 'post'>): Capture {
  const n = s.words.length;
  const total = settings.pre + settings.post;
  const newest = (): Capture => ({ first: Math.max(0, n - total), last: n - 1, trigger: null });
  if (settings.trigMode !== 'pattern' || n === 0) return newest();
  let k = findPatternTrigger(s.words, settings.pattern, s.unknown);
  let best = -1;
  while (k >= 0) {
    if (k + settings.post - 1 <= n - 1) best = k;
    k = findPatternTrigger(s.words, settings.pattern, s.unknown, k + 1);
  }
  if (best < 0) return newest();
  return { first: Math.max(0, best - settings.pre), last: Math.min(n - 1, best + settings.post - 1), trigger: best };
}

/** 4-digit hex text of a 16-bit word ('?' nibbles where any bit is unknown). */
export function wordHex(word: number, unknown = 0): string {
  let s = '';
  for (let nib = 3; nib >= 0; nib--) {
    const u = (unknown >> (nib * 4)) & 0xf;
    s += u ? '?' : ((word >> (nib * 4)) & 0xf).toString(16).toUpperCase();
  }
  return s;
}

/**
 * Capture around the newest external trigger edge (times ascending) whose post-trigger samples
 * are complete; the trigger sample is the first sample at or after the edge. Falls back to the
 * newest pre + post samples when no edge qualifies.
 */
export function captureAtEdges(s: Pick<LogicSamples, 'times'>, edges: readonly number[], pre: number, post: number): Capture {
  const n = s.times.length;
  const newest: Capture = { first: Math.max(0, n - pre - post), last: n - 1, trigger: null };
  for (let e = edges.length - 1; e >= 0; e--) {
    // first sample at or after the edge (binary search)
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s.times[mid] < edges[e]) lo = mid + 1;
      else hi = mid;
    }
    if (lo < n && lo + post - 1 <= n - 1) return { first: Math.max(0, lo - pre), last: lo + post - 1, trigger: lo };
  }
  return newest;
}
