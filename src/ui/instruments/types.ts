/**
 * Virtual instrument core types.
 *
 * - `InstrumentStream`: a growable ring buffer of time-stamped multi-channel samples fed by the
 *   interactive transient simulation (one stream per instrument instance). Storage starts small
 *   and doubles up to `capacity` samples per channel (default 2^20 ≈ 1e6); after that the oldest
 *   samples are overwritten. Reads are windowed by time (binary search) and return copies.
 * - `InstrumentPanelProps`: what every instrument panel component receives.
 * - `INSTRUMENT_CHANNELS`: the channel-name convention panels expect in
 *   `InstrumentBinding.channels` (the library part's `bindInstrument` must use these keys).
 *
 * Time must be non-decreasing. Pushing a sample older than the newest one is treated as a
 * simulation restart: the stream is cleared first.
 */

import type { InstrumentBinding, InstrumentKind } from '../../model/types';
import type { AnalysisResult } from '../../sim/results';

/** A window of samples copied out of a stream. `values[ch]` is aligned with `time`. */
export interface StreamWindow {
  time: Float64Array;
  values: Record<string, Float64Array>;
}

export interface StreamReadOptions {
  /** channels to copy (default: all) */
  channels?: readonly string[];
  /**
   * include the sample just before t0 and just after t1 so plotted lines reach the window
   * edges (default true)
   */
  edges?: boolean;
}

const MIN_ALLOC = 4096;

export class InstrumentStream {
  /** channel names in storage order */
  readonly channels: readonly string[];
  /** maximum samples kept per channel */
  readonly capacity: number;
  private timeBuf: Float64Array;
  private data: Float64Array[];
  /** physical index of the oldest sample */
  private head = 0;
  private count = 0;
  private ver = 0;
  private readonly index = new Map<string, number>();

  constructor(channels: readonly string[], capacity = 1 << 20) {
    if (!(capacity >= 2)) throw new Error('InstrumentStream: capacity must be >= 2');
    this.channels = [...channels];
    this.capacity = Math.floor(capacity);
    this.channels.forEach((c, i) => this.index.set(c.toLowerCase(), i));
    const alloc = Math.min(this.capacity, MIN_ALLOC);
    this.timeBuf = new Float64Array(alloc);
    this.data = this.channels.map(() => new Float64Array(alloc));
  }

  /** number of stored samples */
  get length(): number {
    return this.count;
  }

  /** incremented on every change (push / clear); use as a memo key */
  get version(): number {
    return this.ver;
  }

  /** time of the oldest stored sample (NaN when empty) */
  get startTime(): number {
    return this.count ? this.timeBuf[this.head] : Number.NaN;
  }

  /** time of the newest stored sample (NaN when empty) */
  get endTime(): number {
    return this.count ? this.timeBuf[this.phys(this.count - 1)] : Number.NaN;
  }

  /** storage index of a channel (case-insensitive), -1 when unknown */
  channelIndex(name: string): number {
    return this.index.get(name.toLowerCase()) ?? -1;
  }

  hasChannel(name: string): boolean {
    return this.channelIndex(name) >= 0;
  }

  private phys(i: number): number {
    const p = this.head + i;
    const cap = this.timeBuf.length;
    return p >= cap ? p - cap : p;
  }

  private grow(): void {
    const cap = this.timeBuf.length;
    if (cap >= this.capacity) return;
    const next = Math.min(this.capacity, cap * 2);
    const copy = (src: Float64Array) => {
      const dst = new Float64Array(next);
      for (let i = 0; i < this.count; i++) dst[i] = src[this.phys(i)];
      return dst;
    };
    this.timeBuf = copy(this.timeBuf);
    this.data = this.data.map(copy);
    this.head = 0;
  }

  /**
   * Append one sample. `values` is either an array in `channels` order or a record keyed by
   * channel name (missing channels store NaN, unknown keys are ignored).
   */
  push(time: number, values: ArrayLike<number> | Readonly<Record<string, number>>): void {
    if (!Number.isFinite(time)) return;
    if (this.count && time < this.endTime) this.clearSilently();
    if (this.count === this.timeBuf.length) this.grow();
    let slot: number;
    if (this.count < this.timeBuf.length) {
      slot = this.phys(this.count);
      this.count++;
    } else {
      // full at capacity: overwrite the oldest sample
      slot = this.head;
      this.head = this.head + 1 === this.timeBuf.length ? 0 : this.head + 1;
    }
    this.timeBuf[slot] = time;
    if (isArrayLike(values)) {
      for (let c = 0; c < this.data.length; c++) this.data[c][slot] = c < values.length ? values[c] : Number.NaN;
    } else {
      for (let c = 0; c < this.data.length; c++) this.data[c][slot] = Number.NaN;
      for (const k in values) {
        const c = this.channelIndex(k);
        if (c >= 0) this.data[c][slot] = values[k];
      }
    }
    this.ver++;
  }

  /**
   * Append a block of samples. `values` maps channel name -> samples aligned with `time`
   * (missing channels store NaN).
   */
  pushBlock(time: ArrayLike<number>, values: Readonly<Record<string, ArrayLike<number>>>): void {
    const cols = this.channels.map((c) => {
      const direct = values[c];
      if (direct) return direct;
      const key = Object.keys(values).find((k) => k.toLowerCase() === c.toLowerCase());
      return key ? values[key] : undefined;
    });
    const row = new Float64Array(this.channels.length);
    for (let i = 0; i < time.length; i++) {
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        row[c] = col && i < col.length ? col[i] : Number.NaN;
      }
      this.push(time[i], row);
    }
  }

  private clearSilently(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Remove every sample (storage is kept). */
  clear(): void {
    this.clearSilently();
    this.ver++;
  }

  /** time of logical sample i (0 = oldest) */
  timeAt(i: number): number {
    return i >= 0 && i < this.count ? this.timeBuf[this.phys(i)] : Number.NaN;
  }

  /** value of a channel at logical sample i */
  valueAt(channel: string | number, i: number): number {
    const c = typeof channel === 'number' ? channel : this.channelIndex(channel);
    if (c < 0 || c >= this.data.length || i < 0 || i >= this.count) return Number.NaN;
    return this.data[c][this.phys(i)];
  }

  /** logical index of the last sample with time <= t (-1 if t precedes the data) */
  indexAtOrBefore(t: number): number {
    if (!this.count || t < this.timeAt(0)) return -1;
    let lo = 0;
    let hi = this.count - 1;
    if (t >= this.timeAt(hi)) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** logical index of the first sample with time >= t (length if none) */
  indexAtOrAfter(t: number): number {
    const i = this.indexAtOrBefore(t);
    if (i >= 0 && this.timeAt(i) === t) {
      // walk back over duplicates so the first equal sample is returned
      let j = i;
      while (j > 0 && this.timeAt(j - 1) === t) j--;
      return j;
    }
    return i + 1;
  }

  /** Copy logical samples [i0, i1] (inclusive). */
  readIndices(i0: number, i1: number, channels?: readonly string[]): StreamWindow {
    const a = Math.max(0, i0);
    const b = Math.min(this.count - 1, i1);
    const n = Math.max(0, b - a + 1);
    const time = new Float64Array(n);
    for (let k = 0; k < n; k++) time[k] = this.timeBuf[this.phys(a + k)];
    const values: Record<string, Float64Array> = {};
    for (const name of channels ?? this.channels) {
      const c = this.channelIndex(name);
      const out = new Float64Array(n);
      if (c < 0) out.fill(Number.NaN);
      else {
        const src = this.data[c];
        for (let k = 0; k < n; k++) out[k] = src[this.phys(a + k)];
      }
      values[c >= 0 ? this.channels[c] : name] = out;
    }
    return { time, values };
  }

  /** Copy the samples with t0 <= time <= t1 (plus the neighbours outside, see `edges`). */
  read(t0: number, t1: number, opts: StreamReadOptions = {}): StreamWindow {
    if (!this.count || !(t1 >= t0)) return this.readIndices(0, -1, opts.channels);
    const edges = opts.edges ?? true;
    let i0 = this.indexAtOrAfter(t0);
    let i1 = this.indexAtOrBefore(t1);
    if (edges) {
      i0 = Math.max(0, i0 - 1);
      i1 = Math.min(this.count - 1, i1 + 1);
    }
    return this.readIndices(i0, i1, opts.channels);
  }

  /** Copy the newest `n` samples. */
  readLast(n: number, channels?: readonly string[]): StreamWindow {
    return this.readIndices(this.count - Math.max(0, Math.floor(n)), this.count - 1, channels);
  }

  /** Copy every sample in the last `duration` seconds (at most `maxSamples`). */
  readRecent(duration: number, maxSamples = 1 << 18, channels?: readonly string[]): StreamWindow {
    if (!this.count) return this.readIndices(0, -1, channels);
    const end = this.endTime;
    const i0 = Math.max(this.indexAtOrAfter(end - duration), this.count - maxSamples);
    return this.readIndices(i0, this.count - 1, channels);
  }

  /** newest sample, or null when empty */
  latest(): { time: number; values: Record<string, number> } | null {
    if (!this.count) return null;
    const i = this.count - 1;
    const values: Record<string, number> = {};
    this.channels.forEach((c, k) => {
      values[c] = this.data[k][this.phys(i)];
    });
    return { time: this.timeAt(i), values };
  }
}

function isArrayLike(v: unknown): v is ArrayLike<number> {
  return Array.isArray(v) || ArrayBuffer.isView(v);
}

/** A product term of a minimised sum of products (same shape as logic.ts Implicant). */
export interface LogicTerm {
  mask: number;
  value: number;
}

/**
 * Optional services of the application around a panel (tests and server-side renders omit them;
 * a panel must work without). Provided by src/ui/integration/InstrumentWindow.tsx.
 */
export interface InstrumentHost {
  /**
   * Logic converter "expression → circuit": draw the gate circuit of the sum of products next to
   * the converter and label the converter's inputs / output so "circuit → truth table" works.
   * Resolves to an error text, or null when the circuit was placed.
   */
  placeLogicCircuit?(terms: readonly LogicTerm[], inputs: number, nandOnly: boolean): Promise<string | null>;
}

/** Props every instrument panel receives. Panels are controlled: settings live in `params`. */
export interface InstrumentPanelProps {
  /** application services (absent in tests) */
  host?: InstrumentHost;
  binding: InstrumentBinding;
  /** live samples of `binding.channels` from the interactive transient run */
  stream: InstrumentStream;
  /** AC result for frequency-domain instruments (Bode plotter, network analyzer) */
  ac?: AnalysisResult;
  /** DC-sweep (IV analyzer) or batch-of-OP (logic converter "from circuit") result */
  dc?: AnalysisResult;
  /** simulated time reached so far (s) */
  simTime: number;
  running: boolean;
  /** instrument settings as text (user number syntax); persisted with the part instance */
  params: Record<string, string>;
  /** receives the COMPLETE next params record */
  onParamsChange(next: Record<string, string>): void;
}

/**
 * Channel keys each panel reads from `InstrumentBinding.channels`. Voltage channels are
 * `{ kind: 'voltage', pos, neg }`, current channels `{ kind: 'current', element }`.
 */
export const INSTRUMENT_CHANNELS: Record<InstrumentKind, readonly string[]> = {
  /** v: V(+) - V(-) ; i: current into '+' through the meter (sense source) */
  multimeter: ['v', 'i'],
  /** optional monitor of the generator output */
  'function-generator': ['out'],
  oscilloscope: ['A', 'B', 'ext'],
  'oscilloscope-4ch': ['A', 'B', 'C', 'D', 'ext'],
  /** in: V(IN+) - V(IN-) ; out: V(OUT+) - V(OUT-) */
  'bode-plotter': ['in', 'out'],
  /** v: voltage across the load ; i: current through the series current coil */
  wattmeter: ['v', 'i'],
  'frequency-counter': ['in'],
  /** i: device current (into the device's main terminal) ; v: device voltage (optional) */
  'iv-analyzer': ['i', 'v'],
  'spectrum-analyzer': ['in'],
  /** p1 / p2: port voltages (vs ground) */
  'network-analyzer': ['p1', 'p2'],
  'distortion-analyzer': ['in'],
  /** d0..d15 data, clk external clock, qual clock qualifier, trig external trigger */
  'logic-analyzer': [...Array.from({ length: 16 }, (_, i) => `d${i}`), 'clk', 'qual', 'trig'],
  /** optional monitors of the output bits */
  'word-generator': Array.from({ length: 32 }, (_, i) => `b${i}`),
  /** out: the circuit output read back for "circuit -> truth table" */
  'logic-converter': ['out'],
  /** i: current through the clamped conductor */
  'current-clamp': ['i'],
  /** out: V(OUT) - V(COM); sync: the TTL sync output */
  'bench-generator': ['out', 'sync'],
  /** v: V(HI) - V(LO) ; i: current into the I terminal (to LO) */
  'bench-multimeter': ['v', 'i'],
  /** A..D = CH1..CH4 against GND, ext = EXT */
  'bench-scope': ['A', 'B', 'C', 'D', 'ext'],
  /** A, B = CH1, CH2; d0..d15 logic inputs; ext = EXT (all against GND) */
  'mixed-signal-scope': ['A', 'B', ...Array.from({ length: 16 }, (_, i) => `d${i}`), 'ext'],
};

/** Stream channel list for a binding (its channel keys, in binding order). */
export function streamChannelsFor(binding: InstrumentBinding): string[] {
  return Object.keys(binding.channels);
}

/** Create an empty stream for a binding. */
export function createInstrumentStream(binding: InstrumentBinding, capacity?: number): InstrumentStream {
  return new InstrumentStream(streamChannelsFor(binding), capacity);
}
