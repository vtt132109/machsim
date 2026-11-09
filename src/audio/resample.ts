/**
 * Resampling of simulated waveforms for audio, no DOM and no dependencies.
 *
 * A transient simulation produces samples at irregular times (the step shrinks around edges and
 * grows on flat parts); a sound card wants uniform samples at 44.1 / 48 kHz, played in real time.
 *
 *   hermiteAt(t, v, x)              value at time x of an irregular series (cubic Hermite with
 *                                   three-point tangents: exact for straight lines and
 *                                   parabolas, an ideal step has no overshoot)
 *   resampleUniform(t, v, fs, ...)  uniform series at fs from an irregular one
 *   SampleQueue                     growing irregular series with a read cursor
 *   PlaybackScheduler               turns the queue into audio blocks in real time. When the
 *                                   simulation is slower than real time the playback speed drops
 *                                   to what the simulation delivers ("time stretching": slower
 *                                   and lower in pitch, never glitching); when it is faster the
 *                                   backlog beyond a short look-ahead is skipped.
 *   normalizePeak / dcRemove        helpers for export
 */

/** Index i of the last sample with t[i] <= x (binary search), or -1 when x precedes the series. */
export function lowerIndex(t: ArrayLike<number>, x: number, n = t.length): number {
  if (n === 0 || x < t[0]) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Slope at sample i: the three-point (parabola) slope of the neighbouring samples, which is exact
 * for quadratics on an irregular grid, and 0 next to a flat piece (so a settled level does not
 * ripple and an ideal step is a smooth edge without overshoot). Smooth waveforms keep their peaks
 * between the samples, which a monotonicity limiter would flatten.
 */
function tangent(t: ArrayLike<number>, v: ArrayLike<number>, i: number, n: number): number {
  const right = i + 1 < n ? (v[i + 1] - v[i]) / Math.max(t[i + 1] - t[i], 1e-300) : Number.NaN;
  const left = i > 0 ? (v[i] - v[i - 1]) / Math.max(t[i] - t[i - 1], 1e-300) : Number.NaN;
  if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : right;
  if (Number.isNaN(right)) return left;
  if (left === 0 || right === 0) return 0;
  const h0 = t[i] - t[i - 1];
  const h1 = t[i + 1] - t[i];
  return (h1 * left + h0 * right) / (h0 + h1);
}

/** Value at time x of the series (t ascending, first n samples); held constant outside its range. */
export function hermiteAt(t: ArrayLike<number>, v: ArrayLike<number>, x: number, n = t.length): number {
  if (n === 0) return 0;
  if (x <= t[0]) return v[0];
  if (x >= t[n - 1]) return v[n - 1];
  const i = lowerIndex(t, x, n);
  const h = t[i + 1] - t[i];
  if (!(h > 0)) return v[i + 1];
  const s = (x - t[i]) / h;
  const m0 = tangent(t, v, i, n) * h;
  const m1 = tangent(t, v, i + 1, n) * h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * m1;
}

/** Uniform samples at `fs` from `t0` (default: the first time) to `t1` (default: the last time). */
export function resampleUniform(t: ArrayLike<number>, v: ArrayLike<number>, fs: number, t0 = t.length ? t[0] : 0, t1 = t.length ? t[t.length - 1] : 0): Float32Array {
  if (!(fs > 0) || t.length === 0 || !(t1 > t0)) return new Float32Array(0);
  const count = Math.floor((t1 - t0) * fs + 1e-9) + 1;
  const out = new Float32Array(count);
  // walk with a moving index instead of a binary search per sample
  for (let k = 0; k < count; k++) out[k] = hermiteAt(t, v, t0 + k / fs, t.length);
  return out;
}

/** Scale so the largest magnitude becomes `peak` (silence stays silence). */
export function normalizePeak(samples: Float32Array, peak = 0.98): Float32Array {
  let m = 0;
  for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
  if (!(m > 0)) return samples;
  const g = peak / m;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/** Subtract the mean (a DC offset only costs headroom in an audio file). */
export function dcRemove(samples: Float32Array): Float32Array {
  if (!samples.length) return samples;
  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - mean;
  return out;
}

// ---------------------------------------------------------------------------------------------
// real-time playback

/** Growing irregular series; old samples are dropped as the read cursor moves on. */
export class SampleQueue {
  private t: number[] = [];
  private v: number[] = [];

  get length(): number {
    return this.t.length;
  }
  get first(): number {
    return this.t.length ? this.t[0] : Number.NaN;
  }
  get last(): number {
    return this.t.length ? this.t[this.t.length - 1] : Number.NaN;
  }

  clear(): void {
    this.t = [];
    this.v = [];
  }

  /** Append samples (a time earlier than the newest restarts the queue: the simulation was reset; returns true then). */
  push(times: ArrayLike<number>, values: ArrayLike<number>): boolean {
    let restarted = false;
    for (let i = 0; i < times.length; i++) {
      const x = times[i];
      const y = values[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (this.t.length && x < this.t[this.t.length - 1]) {
        this.clear();
        restarted = true;
      }
      this.t.push(x);
      this.v.push(y);
    }
    return restarted;
  }

  at(x: number): number {
    return hermiteAt(this.t, this.v, x, this.t.length);
  }

  /** Forget samples older than `x`, keeping two behind it for the interpolation. */
  trimBefore(x: number): void {
    const i = lowerIndex(this.t, x) - 2;
    if (i > 0) {
      this.t.splice(0, i);
      this.v.splice(0, i);
    }
  }
}

export type PlaybackState = 'buffering' | 'playing' | 'starved';

export interface PlaybackStats {
  state: PlaybackState;
  /** simulated seconds played per second of sound: 1 = real time, below 1 = stretched */
  speed: number;
  /** simulated seconds waiting in the queue */
  buffered: number;
  /** blocks (partly) filled with silence because the queue ran dry */
  underruns: number;
  /** simulated seconds skipped because the simulation ran faster than real time */
  skipped: number;
}

export interface PlaybackOptions {
  /** simulated seconds the queue aims to hold ahead of the cursor (default 0.12) */
  lookahead?: number;
  /** playback does not start before this much is queued (default half the look-ahead) */
  prebuffer?: number;
  /** slowest playback speed (default 0.02) */
  minSpeed?: number;
}

export class PlaybackScheduler {
  private readonly queue = new SampleQueue();
  private readonly lookahead: number;
  private readonly prebuffer: number;
  private readonly minSpeed: number;
  private cursor = Number.NaN;
  private state: PlaybackState = 'buffering';
  private speedNow = 1;
  private underruns = 0;
  private skipped = 0;
  private lastOut = 0;

  constructor(options: PlaybackOptions = {}) {
    this.lookahead = options.lookahead ?? 0.12;
    this.prebuffer = options.prebuffer ?? this.lookahead / 2;
    this.minSpeed = options.minSpeed ?? 0.02;
  }

  /** Feed simulated samples (times in simulated seconds, ascending). */
  push(times: ArrayLike<number>, values: ArrayLike<number>): void {
    if (this.queue.push(times, values)) {
      // the simulation restarted
      this.cursor = Number.NaN;
      this.state = 'buffering';
    }
    if (Number.isNaN(this.cursor) && this.queue.length > 0) this.cursor = this.queue.first;
  }

  /** Back to the start (a new run). */
  reset(): void {
    this.queue.clear();
    this.cursor = Number.NaN;
    this.state = 'buffering';
    this.speedNow = 1;
    this.underruns = 0;
    this.skipped = 0;
    this.lastOut = 0;
  }

  stats(): PlaybackStats {
    const buffered = Number.isNaN(this.cursor) || !this.queue.length ? 0 : Math.max(0, this.queue.last - this.cursor);
    return { state: this.state, speed: this.speedNow, buffered, underruns: this.underruns, skipped: this.skipped };
  }

  /**
   * The next `n` samples of sound at output rate `fs`, multiplied by `gain` (volts → full scale).
   * The playback speed follows the queue: full speed while at least 60 % of the look-ahead is
   * queued, proportionally slower below it (blocks of 10 – 30 ms are best).
   */
  readBlock(n: number, fs: number, gain = 1): Float32Array {
    const out = new Float32Array(n);
    const avail = Number.isNaN(this.cursor) ? 0 : this.queue.last - this.cursor;
    if (this.state === 'buffering') {
      if (avail >= this.prebuffer) this.state = 'playing';
      else return out;
    }
    if (avail > 4 * this.lookahead) {
      // faster than real time: skip the backlog but keep the look-ahead
      const keep = this.queue.last - this.lookahead;
      this.skipped += keep - this.cursor;
      this.cursor = keep;
    }
    const availNow = this.queue.last - this.cursor;
    // full speed once 60 % of the look-ahead is queued; below that, proportionally slower. Never
    // plan to play more than 80 % of what is queued within one block, so a long block cannot run dry.
    const speed = Math.min(1, Math.max(this.minSpeed, Math.min(availNow / (0.6 * this.lookahead), (0.8 * availNow * fs) / n)));
    this.speedNow = speed;
    const step = speed / fs;
    let starved = false;
    for (let k = 0; k < n; k++) {
      if (this.cursor + step > this.queue.last) {
        starved = true;
        // fade the last value out instead of a click
        this.lastOut *= 0.995;
        out[k] = this.lastOut;
        continue;
      }
      const y = this.queue.at(this.cursor) * gain;
      this.lastOut = y;
      out[k] = y;
      this.cursor += step;
    }
    this.queue.trimBefore(this.cursor);
    if (starved) {
      this.underruns++;
      this.state = 'starved';
    } else if (this.state === 'starved') this.state = 'playing';
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// input: sound card → circuit

/**
 * Streaming down-sampler for the microphone: input blocks at `inRate` come out at `outRate` (≤ inRate),
 * each output sample being the average of the input over its cell (a box filter: it keeps DC and the
 * level of tones well below the output Nyquist and removes most of what would alias). Fractional
 * ratios (48 000 → 22 050) are handled by weighting the sample that straddles two cells.
 */
export class PcmResampler {
  private readonly ratio: number;
  private acc = 0;
  private filled = 0;

  constructor(
    readonly inRate: number,
    readonly outRate: number,
  ) {
    if (!(inRate >= outRate && outRate > 0)) throw new Error('PcmResampler only reduces the sample rate');
    this.ratio = inRate / outRate;
  }

  /** Feed input samples; returns the output samples that are complete. */
  push(input: ArrayLike<number>): number[] {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      let s = input[i];
      let w = 1;
      while (w > 1e-12) {
        const take = Math.min(w, this.ratio - this.filled);
        this.acc += s * take;
        this.filled += take;
        w -= take;
        if (this.filled >= this.ratio - 1e-9) {
          out.push(this.acc / this.ratio);
          this.acc = 0;
          this.filled = 0;
        }
        if (w <= 1e-12) break;
        s = input[i];
      }
    }
    return out;
  }

  reset(): void {
    this.acc = 0;
    this.filled = 0;
  }
}

/** A continuous sine at `freq` Hz with peak `amp`, produced block by block (the microphone's fall-back test tone). */
export class ToneGenerator {
  private phase = 0;

  constructor(
    readonly rate: number,
    readonly freq: number,
    readonly amp = 0.5,
  ) {}

  read(n: number): Float32Array {
    const out = new Float32Array(n);
    const step = (2 * Math.PI * this.freq) / this.rate;
    for (let i = 0; i < n; i++) {
      out[i] = this.amp * Math.sin(this.phase);
      this.phase += step;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    }
    return out;
  }
}
