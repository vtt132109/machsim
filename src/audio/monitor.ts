/**
 * Audio monitor: plays the speakers of a design through the sound card while an interactive
 * simulation runs, and feeds the microphone parts of the design with the input device.
 *
 *   AudioMonitor      per run: one PlaybackScheduler per speaker channel (src/audio/resample.ts),
 *                     fed with the streamed chunks, pumped into an AudioSink in short blocks.
 *                     Several speakers are mixed (summed, then clipped). The playback speed follows
 *                     the simulation (time stretching) and is reported as `speed`; below 1 the
 *                     Audio window says the simulation is slower than real time.
 *   PcmFeeder         keeps the stream of a microphone part ahead of the simulation: it reads the
 *                     input source (microphone or test tone) and returns the setParam edits that
 *                     push the samples into the V<refdes>_mic element (sources.ts, pcmfs).
 *   audioState        store the Audio window reads (master volume and mute, level, stretch, the
 *                     microphone's state and level); persisted per viewer.
 *
 * The sound card itself (webAudioSink.ts) and the microphone (micInput.ts) are loaded on demand and
 * injected, so everything here runs in tests with fakes. Speakers and microphones are found in the
 * netlist build (indicator kind 'speaker') and in the design (parts of `sources/microphone`),
 * on the top level.
 */
import type { IndicatorBinding } from '../model/netlister';
import type { Design, SignalRef } from '../model/types';
import type { TransientChunk } from '../sim/api';
import { chunkSignal } from '../ui/instruments/signals';
import { createStore } from '../ui/store/createStore';
import { elementName } from '../library/partkit';
import { parseUserNumber } from '../util/units';
import { PlaybackScheduler } from './resample';

// ---------------------------------------------------------------------------------------------
// sink and sources (injected)

/** Where the sound goes: the sound card (webAudioSink.ts) or a test double. */
export interface AudioSink {
  /** samples per second the sink plays */
  readonly sampleRate: number;
  /** append one block (equal lengths) after what is already queued */
  write(left: Float32Array, right: Float32Array): void;
  /** seconds of sound written but not yet played */
  queued(): number;
  close(): void;
}

/** Input samples for a microphone part (the real microphone or the test tone). */
export interface PcmSource {
  readonly kind: 'mic' | 'tone';
  /** samples per second of what `read` returns */
  readonly rate: number;
  /** up to n samples that arrived since the last call (may be fewer, even none) */
  read(n: number): Float32Array;
  /** recent peak level 0 … 1 */
  level(): number;
  close(): void;
}

// ---------------------------------------------------------------------------------------------
// state shown in the Audio window

export type MicState = 'none' | 'asking' | 'live' | 'tone' | 'denied' | 'unavailable';

export interface AudioState {
  /** a run with at least one speaker or microphone is in progress */
  active: boolean;
  /** number of speakers (parts) and microphones of the running design */
  speakers: number;
  microphones: number;
  /** master volume 0 … 100 and mute, applied on top of each speaker's own */
  volume: number;
  mute: boolean;
  /** peak of the sound just played, 0 … 1 (1 = clipping) */
  level: number;
  /** simulated seconds played per second of sound: 1 = real time, below 1 = stretched */
  speed: number;
  /** the simulation is clearly slower than real time (speed < 0.95 while playing) */
  slower: boolean;
  underruns: number;
  mic: MicState;
  micLevel: number;
  /** the sound card could not be opened */
  noSink: boolean;
}

const STORAGE_KEY = 'machsim.audio.v1';

function loadMaster(): { volume: number; mute: boolean } {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { volume?: unknown; mute?: unknown };
      return { volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 100 ? v.volume : 80, mute: v.mute === true };
    }
  } catch {
    /* private window or blocked storage: the defaults */
  }
  return { volume: 80, mute: false };
}

const initialState = (): AudioState => ({ active: false, speakers: 0, microphones: 0, ...loadMaster(), level: 0, speed: 1, slower: false, underruns: 0, mic: 'none', micLevel: 0, noSink: false });

export const audioState = createStore<AudioState>(initialState());

/** Change the master volume (0 … 100) and / or mute; remembered for the next session. */
export function setMaster(change: { volume?: number; mute?: boolean }): void {
  audioState.setState((s) => ({ ...s, volume: change.volume === undefined ? s.volume : Math.min(100, Math.max(0, change.volume)), mute: change.mute ?? s.mute }));
  const s = audioState.getState();
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: s.volume, mute: s.mute }));
  } catch {
    /* ignored: the setting just does not persist */
  }
}

/** Back to the state of a fresh start (tests). */
export function resetAudioState(): void {
  audioState.setState(initialState());
}

// ---------------------------------------------------------------------------------------------
// speakers

export interface SpeakerSettings {
  /** 0 … 100 */
  volume: number;
  mute: boolean;
  /** volts that play at full scale */
  vfull: number;
}

/** Instance settings of a speaker part (defaults of the part for blank or unreadable values). */
export function speakerSettings(design: Design, refdes: string, defaults: Record<string, string>): SpeakerSettings {
  const key = refdes.trim().toUpperCase();
  let params: Record<string, string> = {};
  for (const s of design.sheets) {
    const p = s.parts.find((x) => x.refdes.toUpperCase() === key);
    if (p) {
      params = p.params;
      break;
    }
  }
  const num = (k: string, fallback: number): number => {
    const v = parseUserNumber((params[k] ?? defaults[k] ?? '').toString());
    return Number.isFinite(v) ? v : fallback;
  };
  const m = (params.mute ?? defaults.mute ?? 'false').toString().trim().toLowerCase();
  return { volume: Math.min(100, Math.max(0, num('volume', 50))), mute: m === 'true' || m === '1' || m === 'yes' || m === 'on', vfull: Math.max(1e-6, num('vfull', 5)) };
}

interface SpeakerChannel {
  signal: SignalRef;
  scheduler: PlaybackScheduler;
}

interface Speaker {
  refdes: string;
  left: SpeakerChannel;
  /** absent for a mono speaker (played on both ears) */
  right?: SpeakerChannel;
}

/** Speakers of a netlist build's indicators. */
export function speakersOf(indicators: readonly IndicatorBinding[]): { refdes: string; signals: SignalRef[] }[] {
  return indicators.filter((b) => b.kind === 'speaker').map((b) => ({ refdes: b.refdes, signals: [b.signal, ...(b.signals ?? [])] }));
}

export interface MonitorOptions {
  /** opens the sound card on the first block (null: not available) */
  sink: () => AudioSink | null;
  /** settings of a speaker, read afresh for every block (volume changes apply at once) */
  settings: (refdes: string) => SpeakerSettings;
  /** seconds of sound kept queued in the sink (default 0.12) */
  target?: number;
  /** seconds per block handed to the sink (default 0.02) */
  block?: number;
}

export class AudioMonitor {
  private readonly speakers: Speaker[];
  private sink: AudioSink | null = null;
  private sinkTried = false;
  private paused = false;
  private lastLevel = 0;
  private readonly target: number;
  private readonly block: number;

  constructor(
    indicators: readonly IndicatorBinding[],
    private readonly opts: MonitorOptions,
  ) {
    this.target = opts.target ?? 0.12;
    this.block = opts.block ?? 0.02;
    this.speakers = speakersOf(indicators).map((s) => ({
      refdes: s.refdes,
      left: { signal: s.signals[0], scheduler: new PlaybackScheduler() },
      ...(s.signals[1] ? { right: { signal: s.signals[1], scheduler: new PlaybackScheduler() } } : {}),
    }));
  }

  get count(): number {
    return this.speakers.length;
  }

  /** Feed a streamed chunk (before the next pump). */
  pushChunk(chunk: TransientChunk): void {
    if (!chunk.time.length) return;
    for (const sp of this.speakers) {
      for (const ch of [sp.left, sp.right]) {
        if (!ch) continue;
        const values = chunkSignal(chunk, ch.signal);
        // a missing vector arrives as NaN: nothing to play
        if (Number.isNaN(values[0])) continue;
        ch.scheduler.push(chunk.time, values);
      }
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /**
   * Fill the sink up to the target. Returns the number of blocks written. A paused monitor writes
   * nothing, so the sound stops at once.
   */
  pump(): number {
    if (this.speakers.length === 0) return 0;
    if (!this.sink && !this.sinkTried) {
      this.sinkTried = true;
      this.sink = this.opts.sink();
      if (!this.sink) audioState.setState((s) => ({ ...s, noSink: true }));
    }
    const sink = this.sink;
    if (!sink || this.paused) {
      this.report(0);
      return 0;
    }
    const n = Math.max(32, Math.round(sink.sampleRate * this.block));
    const master = audioState.getState();
    const masterGain = master.mute ? 0 : master.volume / 100;
    let blocks = 0;
    let peak = 0;
    while (sink.queued() < this.target && blocks < 12) {
      const left = new Float32Array(n);
      const right = new Float32Array(n);
      for (const sp of this.speakers) {
        const set = this.opts.settings(sp.refdes);
        const gain = set.mute ? 0 : (set.volume / 100 / set.vfull) * masterGain;
        const a = sp.left.scheduler.readBlock(n, sink.sampleRate, gain);
        const b = sp.right ? sp.right.scheduler.readBlock(n, sink.sampleRate, gain) : a;
        for (let i = 0; i < n; i++) {
          left[i] += a[i];
          right[i] += b[i];
        }
      }
      for (let i = 0; i < n; i++) {
        left[i] = Math.max(-1, Math.min(1, left[i]));
        right[i] = Math.max(-1, Math.min(1, right[i]));
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      sink.write(left, right);
      blocks++;
    }
    this.report(blocks > 0 ? peak : this.lastLevel * 0.9);
    return blocks;
  }

  /** The slowest playback speed of any speaker channel (1 = real time). */
  speed(): number {
    let speed = 1;
    for (const sp of this.speakers) for (const ch of [sp.left, sp.right]) if (ch && ch.scheduler.stats().state === 'playing') speed = Math.min(speed, ch.scheduler.stats().speed);
    return speed;
  }

  private report(level: number): void {
    this.lastLevel = level;
    let underruns = 0;
    for (const sp of this.speakers) for (const ch of [sp.left, sp.right]) if (ch) underruns += ch.scheduler.stats().underruns;
    const speed = this.speed();
    audioState.setState((s) => {
      const slower = speed < 0.95;
      if (Math.abs(s.level - level) < 0.01 && s.speed === speed && s.slower === slower && s.underruns === underruns && s.speakers === this.speakers.length) return s;
      return { ...s, level, speed, slower, underruns, speakers: this.speakers.length };
    });
  }

  close(): void {
    this.sink?.close();
    this.sink = null;
    audioState.setState((s) => ({ ...s, level: 0, speed: 1, slower: false, underruns: 0, speakers: 0 }));
  }
}

// ---------------------------------------------------------------------------------------------
// microphone parts

export interface MicPart {
  refdes: string;
  /** netlist element of the streamed source */
  element: string;
  rate: number;
  /** 'tone' when the part asks for the test tone itself */
  source: 'mic' | 'tone';
  toneFreq: number;
}

/** Name of the streamed-source element of a microphone part (see src/library/catalog/audio.ts). */
export function micElementName(refdes: string): string {
  return elementName('V', refdes, 'mic');
}

/** The microphone parts of the top level of a design that stream (source = live microphone). */
export function microphonesOf(design: Design, isMic: (partId: string) => boolean, defaults: Record<string, string>): MicPart[] {
  const out: MicPart[] = [];
  for (const sheet of design.sheets) {
    for (const p of sheet.parts) {
      if (p.excludeFromSim || !isMic(p.partId)) continue;
      const get = (k: string): string => p.params[k] ?? defaults[k] ?? '';
      const source = get('source').trim() === 'tone' ? 'tone' : 'mic';
      const rate = Number(get('rate'));
      const freq = parseUserNumber(get('tonefreq'));
      out.push({ refdes: p.refdes, element: micElementName(p.refdes), rate: rate > 0 ? rate : 8000, source, toneFreq: Number.isFinite(freq) && freq > 0 ? freq : 440 });
    }
  }
  return out.filter((m) => m.source === 'mic');
}

export interface ParamEditLike {
  element: string;
  param: string;
  value: number;
}

/**
 * Keeps a microphone part's stream `lead` seconds ahead of the simulated time. The input source
 * delivers at its own pace; when it has not delivered enough (the simulation is faster than real
 * time) the stream is padded with silence so the sample index always matches the time.
 */
export class PcmFeeder {
  private pushed = 0;
  private leftover: Float32Array = new Float32Array(0);
  private peak = 0;

  constructor(
    readonly part: MicPart,
    private readonly source: PcmSource,
    /** converts the source's rate to the part's (the source may already deliver at the part's rate) */
    private readonly lead = 0.25,
  ) {}

  /** Edits that bring the stream up to `simTime + lead`. */
  feed(simTime: number): ParamEditLike[] {
    const want = Math.ceil((simTime + this.lead) * this.part.rate) - this.pushed;
    if (want <= 0) return [];
    let samples = this.leftover;
    if (samples.length < want) {
      const more = this.source.read(want - samples.length);
      const joined = new Float32Array(samples.length + more.length);
      joined.set(samples);
      joined.set(more, samples.length);
      samples = joined;
    }
    const edits: ParamEditLike[] = [];
    const take = Math.min(want, samples.length);
    for (let i = 0; i < want; i++) {
      const v = i < take ? samples[i] : 0;
      this.peak = Math.max(this.peak * 0.9995, Math.abs(v));
      edits.push({ element: this.part.element, param: 'pcm', value: v });
    }
    this.leftover = samples.subarray(take);
    // never let unplayed input pile up when the simulation is slower than real time: keep half a second
    const keep = Math.round(0.5 * this.part.rate);
    if (this.leftover.length > keep) this.leftover = this.leftover.subarray(this.leftover.length - keep);
    this.pushed += want;
    return edits;
  }

  get level(): number {
    return Math.min(1, this.peak);
  }

  get count(): number {
    return this.pushed;
  }
}

/**
 * What the controller drives during a run (installed lazily, see src/ui/integration/controller.ts):
 * speakers through an AudioMonitor, microphones through PcmFeeders. `edits` are applied by the caller
 * (InteractiveSession.setParams).
 */
export class AudioRun {
  private readonly monitor: AudioMonitor | null;
  private feeders: PcmFeeder[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;

  constructor(
    indicators: readonly IndicatorBinding[],
    readonly mics: readonly MicPart[],
    options: MonitorOptions & {
      /** opens the input for a microphone part; resolves to the source actually used */
      openInput?: (part: MicPart) => Promise<{ source: PcmSource; state: MicState } | { state: MicState }>;
      setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
    },
    private readonly applyEdits: (edits: ParamEditLike[]) => void,
  ) {
    this.monitor = speakersOf(indicators).length ? new AudioMonitor(indicators, options) : null;
    audioState.setState((s) => ({ ...s, active: true, speakers: this.monitor?.count ?? 0, microphones: mics.length, mic: mics.length ? s.mic : 'none', noSink: false }));
    if (mics.length && options.openInput) {
      audioState.setState((s) => ({ ...s, mic: 'asking' }));
      for (const part of mics) {
        void options.openInput(part).then((r) => {
          if (this.closed) {
            if ('source' in r) r.source.close();
            return;
          }
          audioState.setState((s) => ({ ...s, mic: r.state }));
          if ('source' in r) this.feeders.push(new PcmFeeder(part, r.source));
        });
      }
    }
    const tick = options.setInterval ?? setInterval;
    this.timer = tick(() => this.monitor?.pump(), 25);
  }

  private closed = false;

  /** A streamed chunk arrived: feed the speakers and keep the microphone ahead. */
  chunk(chunk: TransientChunk, simTime: number): void {
    this.monitor?.pushChunk(chunk);
    if (this.paused || !this.feeders.length) return;
    const edits: ParamEditLike[] = [];
    for (const f of this.feeders) edits.push(...f.feed(simTime));
    if (edits.length) this.applyEdits(edits);
    const level = Math.max(0, ...this.feeders.map((f) => f.level));
    audioState.setState((s) => (Math.abs(s.micLevel - level) < 0.01 ? s : { ...s, micLevel: level }));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.monitor?.setPaused(paused);
  }

  /** Speakers play one chunk at a time; true when anything is playing (for tests). */
  get speakerCount(): number {
    return this.monitor?.count ?? 0;
  }

  pump(): number {
    return this.monitor?.pump() ?? 0;
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.monitor?.close();
    audioState.setState((s) => ({ ...s, active: false, micLevel: 0, mic: 'none', microphones: 0 }));
  }
}
