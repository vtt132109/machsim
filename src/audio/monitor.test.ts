import { afterEach, describe, expect, it } from 'vitest';
import { newDesign } from '../model/types';
import type { IndicatorBinding } from '../model/netlister';
import type { TransientChunk } from '../sim/api';
import { InputBuffer, ToneSource } from './input';
import { AudioMonitor, AudioRun, PcmFeeder, audioState, micElementName, microphonesOf, resetAudioState, setMaster, speakerSettings, speakersOf, type AudioSink, type MicPart, type PcmSource } from './monitor';

afterEach(() => resetAudioState());

const indicator = (refdes: string, signals: string[]): IndicatorBinding => ({
  refdes,
  partId: 'indicators/speaker',
  kind: 'speaker',
  params: {},
  signal: { kind: 'voltage', pos: signals[0], neg: '0' },
  ...(signals[1] ? { signals: [{ kind: 'voltage' as const, pos: signals[1], neg: '0' }] } : {}),
});

/** A sink that plays instantly: `queued` falls as blocks are consumed by the test. */
function fakeSink(rate = 8000) {
  const left: number[] = [];
  const right: number[] = [];
  let consumed = 0;
  const sink: AudioSink = {
    sampleRate: rate,
    write(l, r) {
      for (const v of l) left.push(v);
      for (const v of r) right.push(v);
    },
    queued: () => (left.length - consumed) / rate,
    close: () => undefined,
  };
  return { sink, left, right, play: (seconds: number) => (consumed = Math.min(left.length, consumed + Math.round(seconds * rate))) };
}

/** A chunk with a sine on node "A" (and a second one on "B"), `dur` seconds from `t0`, at 20 µs steps. */
function chunk(t0: number, dur: number, f = 500, amp = 2, f2 = 1000): TransientChunk {
  const n = Math.round(dur / 20e-6);
  const time = Float64Array.from({ length: n }, (_, i) => t0 + i * 20e-6);
  return { time, vectors: { 'V(A)': time.map((t) => amp * Math.sin(2 * Math.PI * f * t)), 'V(B)': time.map((t) => amp * Math.sin(2 * Math.PI * f2 * t)) } };
}

const freq = (x: ArrayLike<number>, fs: number): number => {
  const ups: number[] = [];
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  return ups.length < 3 ? 0 : ((ups.length - 1) * fs) / (ups[ups.length - 1] - ups[0]);
};

const settings = { volume: 100, mute: false, vfull: 2 };

describe('AudioMonitor', () => {
  it('finds the speakers of a build and plays a sine at its pitch, scaled by volume / full-scale voltage', () => {
    expect(speakersOf([indicator('LS1', ['A']), { ...indicator('X1', ['B']), kind: 'led' }]).map((s) => s.refdes)).toEqual(['LS1']);
    const card = fakeSink();
    setMaster({ volume: 50, mute: false });
    const m = new AudioMonitor([indicator('LS1', ['A'])], { sink: () => card.sink, settings: () => settings });
    for (let k = 0; k < 20; k++) {
      m.pushChunk(chunk(k * 0.05, 0.05));
      m.pump();
      card.play(0.05);
    }
    const tail = card.left.slice(-4000);
    expect(freq(tail, 8000)).toBeGreaterThan(495);
    expect(freq(tail, 8000)).toBeLessThan(505);
    // 2 V peak, full scale 2 V, volume 100 %, master 50 % → 0.5
    expect(Math.max(...tail)).toBeGreaterThan(0.47);
    expect(Math.max(...tail)).toBeLessThan(0.51);
    expect(card.right.slice(-100)).toEqual(card.left.slice(-100));
    expect(audioState.getState().level).toBeGreaterThan(0.3);
    expect(audioState.getState().slower).toBe(false);
  });

  it('headphones play their two channels on the two ears; a second speaker is mixed in and the sum is clipped', () => {
    const card = fakeSink();
    setMaster({ volume: 100, mute: false });
    const m = new AudioMonitor([indicator('LS1', ['A', 'B'])], { sink: () => card.sink, settings: () => settings });
    for (let k = 0; k < 20; k++) {
      m.pushChunk(chunk(k * 0.05, 0.05, 500, 2, 1000));
      m.pump();
      card.play(0.05);
    }
    expect(freq(card.left.slice(-4000), 8000)).toBeGreaterThan(495);
    expect(freq(card.right.slice(-4000), 8000)).toBeGreaterThan(990);
    expect(freq(card.right.slice(-4000), 8000)).toBeLessThan(1010);

    const loud = fakeSink();
    const two = new AudioMonitor([indicator('LS1', ['A']), indicator('LS2', ['A'])], { sink: () => loud.sink, settings: () => settings });
    for (let k = 0; k < 20; k++) {
      two.pushChunk(chunk(k * 0.05, 0.05, 500, 2));
      two.pump();
      loud.play(0.05);
    }
    // two full-scale speakers sum to 2, clipped to 1
    expect(Math.max(...loud.left.slice(-4000))).toBe(1);
    expect(Math.min(...loud.left.slice(-4000))).toBe(-1);
  });

  it('master mute and per-speaker mute give silence; the speaker setting is read afresh for every block', () => {
    const card = fakeSink();
    setMaster({ volume: 100, mute: false });
    let mute = false;
    const m = new AudioMonitor([indicator('LS1', ['A'])], { sink: () => card.sink, settings: () => ({ ...settings, mute }) });
    const run = (n: number, t0: number) => {
      for (let k = 0; k < n; k++) {
        m.pushChunk(chunk(t0 + k * 0.05, 0.05));
        m.pump();
        card.play(0.05);
      }
    };
    run(12, 0);
    expect(Math.max(...card.left.slice(-800))).toBeGreaterThan(0.5);
    mute = true;
    const at = card.left.length;
    run(12, 0.6);
    expect(Math.max(...card.left.slice(at + 2400).map(Math.abs))).toBe(0);
    mute = false;
    setMaster({ mute: true });
    const at2 = card.left.length;
    run(12, 1.2);
    expect(Math.max(...card.left.slice(at2 + 2400).map(Math.abs))).toBe(0);
  });

  it('a paused monitor writes nothing, no sink is reported once, and speakers without a vector stay silent', () => {
    const card = fakeSink();
    const m = new AudioMonitor([indicator('LS1', ['A'])], { sink: () => card.sink, settings: () => settings });
    m.pushChunk(chunk(0, 0.2));
    m.setPaused(true);
    expect(m.pump()).toBe(0);
    expect(card.left).toHaveLength(0);
    m.setPaused(false);
    expect(m.pump()).toBeGreaterThan(0);
    let opened = 0;
    const none = new AudioMonitor([indicator('LS1', ['A'])], { sink: () => (opened++, null), settings: () => settings });
    none.pump();
    none.pump();
    expect(opened).toBe(1);
    expect(audioState.getState().noSink).toBe(true);
    const missing = new AudioMonitor([indicator('LS9', ['ZZ'])], { sink: () => card.sink, settings: () => settings });
    missing.pushChunk(chunk(0, 0.2));
    card.play(10);
    const before = card.left.length;
    expect(missing.pump()).toBeGreaterThan(0);
    expect(Math.max(...card.left.slice(before).map(Math.abs))).toBe(0);
  });

  it('reports the stretch when the simulation delivers less than real time', () => {
    const card = fakeSink();
    const m = new AudioMonitor([indicator('LS1', ['A'])], { sink: () => card.sink, settings: () => settings });
    // half real time: 25 ms of circuit time arrive for every 50 ms of sound
    const speeds: number[] = [];
    for (let k = 0; k < 100; k++) {
      m.pushChunk(chunk(k * 0.025, 0.025));
      m.pump();
      card.play(0.05);
      speeds.push(m.speed());
    }
    // the playback speed hovers around what the simulation delivers: 500 Hz is heard near 250 Hz
    const mean = speeds.slice(-40).reduce((a, b) => a + b, 0) / 40;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.62);
    expect(Math.min(...speeds.slice(-40))).toBeGreaterThan(0.15);
    const heard = freq(card.left.slice(-8000), 8000);
    expect(heard).toBeGreaterThan(200);
    expect(heard).toBeLessThan(300);
    expect(audioState.getState().slower).toBe(true);
    expect(audioState.getState().speed).toBeCloseTo(m.speed(), 6);
  });
});

describe('speaker settings and microphone parts of a design', () => {
  it('reads volume, mute and the full-scale voltage from the instance, falling back to the part defaults', () => {
    const d = newDesign();
    d.sheets[0].parts.push({ id: 'p1', partId: 'indicators/speaker', refdes: 'LS1', x: 0, y: 0, rotation: 0, params: { volume: '25', mute: 'true' } } as never);
    const defaults = { volume: '50', mute: 'false', vfull: '5' };
    expect(speakerSettings(d, 'LS1', defaults)).toEqual({ volume: 25, mute: true, vfull: 5 });
    expect(speakerSettings(d, 'ls1', defaults).volume).toBe(25);
    expect(speakerSettings(d, 'LS9', defaults)).toEqual({ volume: 50, mute: false, vfull: 5 });
    d.sheets[0].parts[0].params = { volume: '250', vfull: '0' };
    expect(speakerSettings(d, 'LS1', defaults)).toMatchObject({ volume: 100 });
    expect(speakerSettings(d, 'LS1', defaults).vfull).toBeGreaterThan(0);
  });

  it('lists the streaming microphones (test-tone mode and excluded parts do not stream)', () => {
    const d = newDesign();
    const mk = (id: string, refdes: string, params: Record<string, string>, excluded = false) => ({ id, partId: 'sources/microphone', refdes, x: 0, y: 0, rotation: 0, params, ...(excluded ? { excludeFromSim: true } : {}) }) as never;
    d.sheets[0].parts.push(mk('a', 'V1', { rate: '16000' }), mk('b', 'V2', { source: 'tone' }), mk('c', 'V3', {}, true), { id: 'd', partId: 'basic/resistor', refdes: 'R1', x: 0, y: 0, rotation: 0, params: {} } as never);
    const mics = microphonesOf(d, (id) => id === 'sources/microphone', { source: 'mic', rate: '8000', tonefreq: '440' });
    expect(mics).toHaveLength(1);
    expect(mics[0]).toMatchObject({ refdes: 'V1', element: micElementName('V1'), rate: 16000 });
    expect(micElementName('V1')).toBe('V1_mic');
  });
});

describe('PcmFeeder', () => {
  const part: MicPart = { refdes: 'V1', element: 'V1_mic', rate: 1000, source: 'mic', toneFreq: 440 };

  it('keeps the stream 0.25 s ahead of the simulation, one edit per sample, in order', () => {
    const src = new ToneSource(1000, 100, 0.5);
    const f = new PcmFeeder(part, src);
    const a = f.feed(0);
    expect(a).toHaveLength(250);
    expect(a.every((e) => e.element === 'V1_mic' && e.param === 'pcm')).toBe(true);
    expect(f.feed(0)).toHaveLength(0);
    const b = f.feed(0.1);
    expect(b).toHaveLength(100);
    // the samples continue the tone without a gap: sample k = 0.5·sin(2π·100·k/1000)
    const all = [...a, ...b].map((e) => e.value);
    for (const k of [0, 3, 99, 250, 340]) expect(all[k]).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * 100 * k) / 1000), 5);
    expect(f.count).toBe(350);
    expect(f.level).toBeCloseTo(0.5, 1);
  });

  it('pads with silence when the input has not delivered enough, and never lets old input pile up', () => {
    const buf = new InputBuffer(1000, 1000);
    const f = new PcmFeeder(part, buf);
    buf.push(Float32Array.from({ length: 50 }, () => 0.3));
    const a = f.feed(0);
    expect(a).toHaveLength(250);
    expect(a.slice(0, 50).every((e) => Math.abs(e.value - 0.3) < 1e-6)).toBe(true);
    expect(a.slice(50).every((e) => e.value === 0)).toBe(true);
    // a simulation slower than real time lets the input pile up: only the newest half second is kept
    buf.push(Float32Array.from({ length: 4000 }, (_, i) => i));
    const b = f.feed(0.3);
    expect(b).toHaveLength(300);
    expect(b[0].value).toBeGreaterThan(2900);
  });
});

describe('AudioRun', () => {
  it('feeds the microphone through the edits callback, pumps the speakers and cleans up', async () => {
    const card = fakeSink();
    const edits: unknown[] = [];
    const timers: (() => void)[] = [];
    const mic: MicPart = { refdes: 'V1', element: 'V1_mic', rate: 1000, source: 'mic', toneFreq: 440 };
    const run = new AudioRun(
      [indicator('LS1', ['A'])],
      [mic],
      {
        sink: () => card.sink,
        settings: () => settings,
        openInput: async (p) => ({ source: new ToneSource(p.rate, 440) as PcmSource, state: 'live' }),
        setInterval: (fn) => {
          timers.push(fn);
          return 0 as unknown as ReturnType<typeof setInterval>;
        },
      },
      (e) => edits.push(...e),
    );
    expect(audioState.getState()).toMatchObject({ active: true, speakers: 1, microphones: 1, mic: 'asking' });
    await Promise.resolve();
    await Promise.resolve();
    expect(audioState.getState().mic).toBe('live');
    run.chunk(chunk(0, 0.05), 0.05);
    expect(edits.length).toBe(300);
    timers[0]();
    expect(card.left.length).toBeGreaterThan(0);
    run.setPaused(true);
    run.chunk(chunk(0.05, 0.05), 0.1);
    expect(edits.length).toBe(300);
    run.close();
    expect(audioState.getState()).toMatchObject({ active: false, mic: 'none', speakers: 0 });
  });
});
