import { describe, expect, it } from 'vitest';
import { PcmResampler, PlaybackScheduler, SampleQueue, ToneGenerator, dcRemove, hermiteAt, normalizePeak, resampleUniform } from './resample';

/** Frequency from the rising zero crossings (linear interpolation of each crossing). */
function frequencyOf(x: ArrayLike<number>, fs: number): number {
  const ups: number[] = [];
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  }
  if (ups.length < 3) return 0;
  return ((ups.length - 1) * fs) / (ups[ups.length - 1] - ups[0]);
}

/** Irregular samples of a sine: random-looking steps between 5 and 45 µs, like an adaptive transient. */
function irregularSine(f: number, dur: number, seed = 1): { t: Float64Array; v: Float64Array } {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const t: number[] = [0];
  while (t[t.length - 1] < dur) t.push(t[t.length - 1] + 5e-6 + 40e-6 * rnd());
  return { t: Float64Array.from(t), v: Float64Array.from(t, (x) => Math.sin(2 * Math.PI * f * x)) };
}

describe('resampleUniform', () => {
  it('a 1 kHz sine keeps its frequency (and amplitude) after resampling irregular samples to 44.1 kHz', () => {
    const { t, v } = irregularSine(1000, 0.2);
    const out = resampleUniform(t, v, 44100);
    expect(out.length).toBe(Math.floor(t[t.length - 1] * 44100 + 1e-9) + 1);
    expect(frequencyOf(out, 44100)).toBeCloseTo(1000, 0);
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.999);
    expect(peak).toBeLessThan(1.001);
    // the values are those of the sine, not just its pitch
    let worst = 0;
    for (let k = 0; k < out.length; k++) worst = Math.max(worst, Math.abs(out[k] - Math.sin(2 * Math.PI * 1000 * (k / 44100))));
    expect(worst).toBeLessThan(2e-3);
  });

  it('a coarse 1 ms trace of a 100 Hz sine is still interpolated smoothly', () => {
    const t = Float64Array.from({ length: 101 }, (_, i) => i * 1e-3);
    const v = Float64Array.from(t, (x) => Math.sin(2 * Math.PI * 100 * x));
    const out = resampleUniform(t, v, 8000);
    expect(frequencyOf(out, 8000)).toBeCloseTo(100, 0);
  });

  it('reproduces straight lines exactly and never overshoots a step', () => {
    expect(hermiteAt([0, 1, 3], [0, 1, 3], 0.5)).toBeCloseTo(0.5, 12);
    expect(hermiteAt([0, 1, 3], [0, 1, 3], 2)).toBeCloseTo(2, 12);
    const t = [0, 1, 1.001, 2];
    const v = [0, 0, 1, 1];
    for (let x = 0; x <= 2; x += 0.01) {
      const y = hermiteAt(t, v, x);
      expect(y).toBeGreaterThanOrEqual(-1e-12);
      expect(y).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('holds the end values outside the series and handles empty input', () => {
    expect(hermiteAt([1, 2], [5, 7], 0)).toBe(5);
    expect(hermiteAt([1, 2], [5, 7], 9)).toBe(7);
    expect(resampleUniform([], [], 44100)).toHaveLength(0);
    expect(resampleUniform([0, 1], [0, 1], 0)).toHaveLength(0);
  });

  it('normalizePeak and dcRemove', () => {
    const n = normalizePeak(Float32Array.from([0.1, -0.2, 0.05]), 0.9);
    expect(Math.max(...Array.from(n, Math.abs))).toBeCloseTo(0.9, 6);
    expect(normalizePeak(new Float32Array(3))).toEqual(new Float32Array(3));
    const d = dcRemove(Float32Array.from([1.5, 2.5, 3.5]));
    expect(Array.from(d)).toEqual([-1, 0, 1]);
  });
});

/** Run the scheduler against a producer that delivers `rate` simulated seconds per sound second. */
function play(rate: number, seconds: number, f = 1000, opts?: ConstructorParameters<typeof PlaybackScheduler>[0]) {
  const fs = 44100;
  const sched = new PlaybackScheduler(opts);
  const block = 441; // 10 ms of sound
  const out: number[] = [];
  const speeds: number[] = [];
  let simT = 0;
  const dt = 20e-6;
  for (let b = 0; b < seconds * 100; b++) {
    // the simulation delivers 10 ms × rate of circuit time per block
    const until = simT + 0.01 * rate;
    const times: number[] = [];
    const values: number[] = [];
    for (; simT < until; simT += dt) {
      times.push(simT);
      values.push(Math.sin(2 * Math.PI * f * simT));
    }
    sched.push(times, values);
    const blockOut = sched.readBlock(block, fs, 1);
    for (const x of blockOut) out.push(x);
    speeds.push(sched.stats().speed);
  }
  return { out, speeds, sched, fs };
}

describe('PlaybackScheduler', () => {
  it('real-time simulation: the sound keeps its 1 kHz pitch at speed 1', () => {
    const { out, sched, fs } = play(1, 1.5);
    expect(sched.stats().speed).toBeCloseTo(1, 6);
    expect(sched.stats().underruns).toBe(0);
    // look at the last second, after the pre-buffering
    expect(frequencyOf(out.slice(-fs), fs)).toBeCloseTo(1000, 0);
  });

  it('simulation at half real time: playback slows to 0.5 and the pitch falls to 500 Hz without gaps', () => {
    const { out, speeds, sched, fs } = play(0.5, 4);
    const s = sched.stats();
    expect(s.speed).toBeGreaterThan(0.45);
    expect(s.speed).toBeLessThan(0.56);
    expect(speeds[speeds.length - 1]).toBeCloseTo(s.speed, 9);
    expect(frequencyOf(out.slice(-fs), fs)).toBeGreaterThan(450);
    expect(frequencyOf(out.slice(-fs), fs)).toBeLessThan(560);
    // no click: consecutive samples of a ≤ 1 kHz tone at 44.1 kHz never jump by more than 2π·1000/44100
    const tail = out.slice(-fs);
    let jump = 0;
    for (let i = 1; i < tail.length; i++) jump = Math.max(jump, Math.abs(tail[i] - tail[i - 1]));
    expect(jump).toBeLessThan(0.15);
  });

  it('a very slow simulation (0.1×) plays at about one tenth speed', () => {
    const { sched } = play(0.1, 8);
    expect(sched.stats().speed).toBeGreaterThan(0.08);
    expect(sched.stats().speed).toBeLessThan(0.14);
  });

  it('a simulation faster than real time skips the backlog and plays at speed 1', () => {
    const { out, sched, fs } = play(4, 2);
    expect(sched.stats().speed).toBe(1);
    expect(sched.stats().skipped).toBeGreaterThan(1);
    expect(frequencyOf(out.slice(-fs), fs)).toBeCloseTo(1000, 0);
  });

  it('stays silent until it has pre-buffered, then starts', () => {
    const s = new PlaybackScheduler({ lookahead: 0.1 });
    expect(Array.from(s.readBlock(8, 44100))).toEqual(new Array(8).fill(0));
    expect(s.stats().state).toBe('buffering');
    s.push([0, 0.01], [1, 1]);
    expect(s.readBlock(4, 44100).every((x) => x === 0)).toBe(true);
    s.push([0.02, 0.2], [1, 1]);
    expect(s.readBlock(4, 44100)[0]).toBeCloseTo(1, 6);
    expect(s.stats().state).toBe('playing');
  });

  it('gain scales the output and a restart of the simulation starts a new buffering phase', () => {
    const s = new PlaybackScheduler({ lookahead: 0.1 });
    s.push([0, 0.3], [2, 2]);
    expect(s.readBlock(2, 1000, 0.25)[0]).toBeCloseTo(0.5, 9);
    s.push([0, 0.001], [1, 1]);
    expect(s.stats().state).toBe('buffering');
    expect(s.stats().buffered).toBeCloseTo(0.001, 9);
  });

  it('runs dry gracefully: the underrun is counted and the tail fades instead of clicking', () => {
    const s = new PlaybackScheduler({ lookahead: 0.05, minSpeed: 0.5 });
    s.push([0, 0.1], [1, 1]);
    s.readBlock(8000, 44100); // plays 90 ms of the 100 ms that are queued
    const a = s.readBlock(8000, 44100); // the producer has stopped
    expect(s.stats().underruns).toBe(1);
    expect(s.stats().state).toBe('starved');
    expect(a[a.length - 1]).toBeLessThan(1);
    expect(a[a.length - 1]).toBeGreaterThan(0);
    s.push([0.1, 0.4], [1, 1]);
    s.readBlock(100, 44100);
    expect(s.stats().state).toBe('playing');
  });

  it('a block longer than the queue slows down instead of running dry', () => {
    const s = new PlaybackScheduler({ lookahead: 0.05 });
    s.push([0, 0.1], [1, 1]);
    s.readBlock(8000, 44100);
    expect(s.stats().underruns).toBe(0);
    expect(s.stats().speed).toBeLessThan(0.5);
  });
});

describe('SampleQueue', () => {
  it('trims old samples but keeps the interpolation neighbours', () => {
    const q = new SampleQueue();
    q.push(Array.from({ length: 100 }, (_, i) => i), Array.from({ length: 100 }, (_, i) => 2 * i));
    q.trimBefore(50);
    expect(q.length).toBeLessThan(100);
    expect(q.length).toBeGreaterThan(40);
    expect(q.at(50.5)).toBeCloseTo(101, 9);
  });
});

describe('PcmResampler (microphone input)', () => {
  it('a 440 Hz tone at 48 kHz keeps its frequency and level at 8 kHz', () => {
    const r = new PcmResampler(48000, 8000);
    const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
    // fed in uneven blocks like a sound card callback
    const out: number[] = [];
    for (let at = 0; at < input.length; ) {
      const n = Math.min(input.length - at, 128 + ((at / 128) % 7) * 31);
      out.push(...r.push(input.subarray(at, at + n)));
      at += n;
    }
    expect(out).toHaveLength(8000);
    expect(frequencyOf(out, 8000)).toBeCloseTo(440, 0);
    const peak = Math.max(...out.map(Math.abs));
    expect(peak).toBeGreaterThan(0.97);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('keeps DC exactly and handles fractional ratios (44.1 kHz → 22.05 kHz, 48 kHz → 22.05 kHz)', () => {
    const dc = new PcmResampler(48000, 22050).push(new Float32Array(48000).fill(0.25));
    expect(dc.length).toBeGreaterThanOrEqual(22049);
    expect(dc.length).toBeLessThanOrEqual(22050);
    for (const v of dc) expect(v).toBeCloseTo(0.25, 6);
    const same = new PcmResampler(44100, 44100).push(Float32Array.from([1, 2, 3]));
    expect(same).toEqual([1, 2, 3]);
  });

  it('averages the cell: a Nyquist-rate alternation at the input disappears, and the rate may not rise', () => {
    const r = new PcmResampler(16000, 8000);
    const out = r.push(Float32Array.from({ length: 64 }, (_, i) => (i % 2 ? 1 : -1)));
    for (const v of out) expect(v).toBeCloseTo(0, 12);
    expect(() => new PcmResampler(8000, 16000)).toThrow();
  });
});

describe('ToneGenerator', () => {
  it('is continuous across blocks and has the requested frequency and peak', () => {
    const g = new ToneGenerator(8000, 440, 0.5);
    const a = Array.from(g.read(1000));
    const b = Array.from(g.read(1000));
    const all = [...a, ...b];
    expect(frequencyOf(all, 8000)).toBeCloseTo(440, 0);
    expect(Math.max(...all)).toBeCloseTo(0.5, 2);
    // no jump at the block boundary
    expect(Math.abs(b[0] - a[a.length - 1])).toBeLessThan(0.5 * ((2 * Math.PI * 440) / 8000) + 1e-6);
  });
});
