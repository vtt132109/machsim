/**
 * Waveform engine of the bench function / arbitrary waveform generator (pure, shared by the
 * library part `instruments/bench-generator` and its panel, which draws a preview of the same
 * waveform).
 *
 * Settings (text params, user number syntax):
 *   waveform   sine | square | triangle | ramp | pulse | noise | dc | arb
 *   freq       Hz (noise: bandwidth)          amplitude  peak-to-peak V      offset  V
 *   duty       % (square)                     symmetry   % rising time (ramp; 50 = triangle)
 *   width      s (pulse)                      edge       s (square / pulse edges)
 *   phase      ° (sine, square, triangle, ramp, pulse; the PULSE-based shapes start after the
 *              equivalent delay, holding their low level before it)
 *   arb        sinc | exprise | expfall | gauss | haversine | staircase | cardiac | user
 *   arbdata    user points (−1 … 1, one period, comma / space separated)
 *   mod        none | am | fm | burst | sweep (sine carrier)
 *   modfreq    Hz   depth  % (AM)   deviation  Hz (FM)   cycles  (burst)   burstperiod  s
 *   sweepstop  Hz   sweeptime  s
 *   load       hiz | 50  — the amplitude shown is the voltage into this load: with "50" the
 *              internal EMF is twice the setting (the 50 Ω output resistance halves it)
 *   zout       output resistance (Ω, default 50)      output  on | off
 *
 * `benchWave(params)` returns either a plain independent-source spec (SIN / PULSE / PWL with an
 * AC magnitude, so the generator also drives AC analyses and the Bode plotter) or, for the
 * modulated modes, a behavioural expression of `time`. `benchSample(settings, t)` evaluates the
 * same waveform for previews and tests.
 */
import type { SourceSpec, Waveform } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';

export type BenchWaveform = 'sine' | 'square' | 'triangle' | 'ramp' | 'pulse' | 'noise' | 'dc' | 'arb';
export type BenchModulation = 'none' | 'am' | 'fm' | 'burst' | 'sweep';
export type ArbPreset = 'sinc' | 'exprise' | 'expfall' | 'gauss' | 'haversine' | 'staircase' | 'cardiac' | 'user';

export const BENCH_WAVEFORMS: readonly BenchWaveform[] = ['sine', 'square', 'triangle', 'ramp', 'pulse', 'noise', 'dc', 'arb'];
export const BENCH_MODULATIONS: readonly BenchModulation[] = ['none', 'am', 'fm', 'burst', 'sweep'];
export const ARB_PRESETS: readonly ArbPreset[] = ['sinc', 'exprise', 'expfall', 'gauss', 'haversine', 'staircase', 'cardiac', 'user'];

export const BENCH_GEN_DEFAULTS: Record<string, string> = {
  waveform: 'sine',
  freq: '1k',
  amplitude: '2',
  offset: '0',
  duty: '50',
  symmetry: '100',
  width: '100u',
  edge: '10n',
  phase: '0',
  arb: 'sinc',
  arbdata: '0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5',
  mod: 'none',
  modfreq: '100',
  depth: '50',
  deviation: '200',
  cycles: '3',
  burstperiod: '10m',
  sweepstop: '10k',
  sweeptime: '10m',
  load: 'hiz',
  zout: '50',
  output: 'on',
};

export interface BenchGenSettings {
  waveform: BenchWaveform;
  freq: number;
  /** peak-to-peak into the selected load */
  vpp: number;
  offset: number;
  duty: number;
  symmetry: number;
  width: number;
  edge: number;
  phase: number;
  arb: ArbPreset;
  arbData: number[];
  mod: BenchModulation;
  modFreq: number;
  depth: number;
  deviation: number;
  cycles: number;
  burstPeriod: number;
  sweepStop: number;
  sweepTime: number;
  load: 'hiz' | '50';
  zout: number;
  output: boolean;
}

function pick<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  const s = (v ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Parse the generator params; throws `Error('bad value for <key> …')` on invalid numbers. */
export function benchGenSettings(params: Record<string, string>): BenchGenSettings {
  const get = (k: string): number => {
    const text = params[k] ?? BENCH_GEN_DEFAULTS[k];
    const v = parseUserNumber(text ?? '');
    if (!Number.isFinite(v)) throw new Error(`bad value for ${k}: '${text}'`);
    return v;
  };
  const s: BenchGenSettings = {
    waveform: pick(params.waveform, BENCH_WAVEFORMS, 'sine'),
    freq: get('freq'),
    vpp: get('amplitude'),
    offset: get('offset'),
    duty: get('duty') / 100,
    symmetry: get('symmetry') / 100,
    width: get('width'),
    edge: get('edge'),
    phase: get('phase'),
    arb: pick(params.arb, ARB_PRESETS, 'sinc'),
    arbData: parseArbData(params.arbdata ?? BENCH_GEN_DEFAULTS.arbdata),
    mod: pick(params.mod, BENCH_MODULATIONS, 'none'),
    modFreq: get('modfreq'),
    depth: get('depth') / 100,
    deviation: get('deviation'),
    cycles: Math.round(get('cycles')),
    burstPeriod: get('burstperiod'),
    sweepStop: get('sweepstop'),
    sweepTime: get('sweeptime'),
    load: (params.load ?? 'hiz').trim() === '50' ? '50' : 'hiz',
    zout: get('zout'),
    output: (params.output ?? 'on').trim().toLowerCase() !== 'off',
  };
  if (!(s.freq > 0 && s.freq <= 1e9)) throw new Error('bad value for freq: must be 0 < f ≤ 1 GHz');
  if (!(s.vpp >= 0)) throw new Error('bad value for amplitude: must be ≥ 0');
  if (!(s.duty >= 0.01 && s.duty <= 0.99)) throw new Error('bad value for duty: must be 1..99 %');
  if (!(s.symmetry >= 0 && s.symmetry <= 1)) throw new Error('bad value for symmetry: must be 0..100 %');
  if (!(s.edge > 0)) throw new Error('bad value for edge: must be > 0');
  if (!(s.zout >= 0)) throw new Error('bad value for zout: must be ≥ 0');
  if (s.waveform === 'pulse' && !(s.width > 0 && s.width < 1 / s.freq)) throw new Error('bad value for width: must be between 0 and one period');
  if (s.mod !== 'none') {
    if (!(s.modFreq > 0)) throw new Error('bad value for modfreq: must be > 0');
    if (s.mod === 'am' && !(s.depth >= 0 && s.depth <= 1.2)) throw new Error('bad value for depth: 0..120 %');
    if (s.mod === 'burst' && !(s.cycles >= 1 && s.burstPeriod > s.cycles / s.freq)) throw new Error('bad value for burstperiod: must be longer than the burst');
    if (s.mod === 'sweep' && !(s.sweepStop > 0 && s.sweepTime > 0)) throw new Error('bad value for sweeptime: must be > 0');
  }
  return s;
}

/** Numbers of an arbitrary-waveform text (clamped to −1 … 1). */
export function parseArbData(text: string): number[] {
  const out = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .map((x) => Math.max(-1, Math.min(1, x)));
  return out.length >= 2 ? out : [0, 0];
}

const ARB_POINTS = 64;

/** One period of a preset arbitrary waveform, normalised to −1 … 1. */
export function arbPoints(preset: ArbPreset, user: number[] = []): number[] {
  if (preset === 'user') return user.length >= 2 ? user : [0, 0];
  const out: number[] = [];
  for (let k = 0; k < ARB_POINTS; k++) {
    const x = k / ARB_POINTS;
    let v: number;
    switch (preset) {
      case 'sinc': {
        const u = (x - 0.5) * 8 * Math.PI;
        v = u === 0 ? 1 : Math.sin(u) / u;
        break;
      }
      case 'exprise':
        v = 2 * (1 - Math.exp(-5 * x)) / (1 - Math.exp(-5)) - 1;
        break;
      case 'expfall':
        v = 2 * Math.exp(-5 * x) - 1;
        break;
      case 'gauss':
        v = 2 * Math.exp(-(((x - 0.5) / 0.12) ** 2) / 2) - 1;
        break;
      case 'haversine':
        v = -Math.cos(2 * Math.PI * x);
        break;
      case 'staircase':
        v = -1 + (2 * Math.floor(x * 5)) / 4;
        break;
      case 'cardiac': {
        // stylised heartbeat: P wave, QRS spike, T wave (shape only, original drawing)
        const g = (c: number, w: number, a: number) => a * Math.exp(-(((x - c) / w) ** 2));
        v = -0.6 + g(0.18, 0.04, 0.25) - g(0.36, 0.012, 0.25) + g(0.4, 0.015, 1.5) - g(0.44, 0.012, 0.4) + g(0.65, 0.06, 0.45);
        v = Math.max(-1, Math.min(1, v));
        break;
      }
    }
    out.push(v);
  }
  return out;
}

/** Deterministic pseudo-random normal samples (mulberry32 + Box–Muller), clipped to ±3σ. */
export function noiseSamples(n: number, seed = 12345): number[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  while (out.length < n) {
    const u = Math.max(1e-12, rnd());
    const v = rnd();
    out.push(Math.max(-3, Math.min(3, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))) / 3);
  }
  return out;
}

const NOISE_POINTS = 512;

/** Peak amplitude of the internal EMF (half the peak-to-peak, doubled for a 50 Ω load setting). */
export function emfPeak(s: BenchGenSettings): number {
  return (s.vpp / 2) * (s.load === '50' && s.zout > 0 ? (50 + s.zout) / 50 : 1);
}

/** Offset of the internal EMF (scaled like the amplitude). */
export function emfOffset(s: BenchGenSettings): number {
  return s.offset * (s.load === '50' && s.zout > 0 ? (50 + s.zout) / 50 : 1);
}

export type BenchWaveSpec = { kind: 'source'; spec: SourceSpec } | { kind: 'expr'; expr: string };

const n = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(12))) : '0');

/** Delay (s) that shifts a periodic waveform by `phase` degrees. */
function phaseDelay(s: BenchGenSettings): number {
  const T = 1 / s.freq;
  const d = (((-s.phase / 360) % 1) + 1) % 1;
  return d * T;
}

/** Source spec / expression of the internal EMF (relative to COM). */
export function benchWave(s: BenchGenSettings): BenchWaveSpec {
  const a = emfPeak(s);
  const off = emfOffset(s);
  const T = 1 / s.freq;
  const lo = off - a;
  const hi = off + a;
  if (s.mod !== 'none') {
    const w = 2 * Math.PI * s.freq;
    const wm = 2 * Math.PI * s.modFreq;
    switch (s.mod) {
      case 'am':
        return { kind: 'expr', expr: `${n(off)}+${n(a)}*(1+${n(s.depth)}*sin(${n(wm)}*time))*sin(${n(w)}*time)` };
      case 'fm':
        return { kind: 'expr', expr: `${n(off)}+${n(a)}*sin(${n(w)}*time-${n(s.deviation / s.modFreq)}*cos(${n(wm)}*time)+${n(s.deviation / s.modFreq)})` };
      case 'burst': {
        const tb = s.burstPeriod;
        const m = `(time-${n(tb)}*floor(time/${n(tb)}))`;
        return { kind: 'expr', expr: `${n(off)}+${n(a)}*sin(${n(w)}*${m})*u(${n(s.cycles / s.freq)}-${m})` };
      }
      case 'sweep': {
        const ts = s.sweepTime;
        const m = `(time-${n(ts)}*floor(time/${n(ts)}))`;
        const k = (Math.PI * (s.sweepStop - s.freq)) / ts;
        return { kind: 'expr', expr: `${n(off)}+${n(a)}*sin(${n(w)}*${m}+${n(k)}*${m}*${m})` };
      }
    }
  }
  const acMag = a;
  const td = phaseDelay(s);
  let tran: Waveform;
  switch (s.waveform) {
    case 'dc':
      return { kind: 'source', spec: { dc: off } };
    case 'sine':
      tran = { type: 'SIN', args: [off, a, s.freq, 0, 0, s.phase] };
      break;
    case 'square': {
      const tr = Math.min(s.edge, s.duty * T * 0.5, (1 - s.duty) * T * 0.5);
      tran = { type: 'PULSE', args: [lo, hi, td, tr, tr, Math.max(0, s.duty * T - tr), T] };
      break;
    }
    case 'triangle':
      tran = { type: 'PULSE', args: [lo, hi, td, T / 2, T / 2, 0, T] };
      break;
    case 'ramp': {
      const tr = Math.max(Math.min(s.edge, T / 2), s.symmetry * T);
      const tf = Math.max(Math.min(s.edge, T / 2), T - tr);
      tran = { type: 'PULSE', args: [lo, hi, td, tr, tf, 0, tr + tf] };
      break;
    }
    case 'pulse': {
      const tr = Math.min(s.edge, s.width / 2, (T - s.width) / 2);
      tran = { type: 'PULSE', args: [lo, hi, td, tr, tr, Math.max(0, s.width - tr), T] };
      break;
    }
    case 'noise': {
      const pts = noiseSamples(NOISE_POINTS);
      const dt = 1 / (2 * s.freq);
      const args: number[] = [];
      pts.forEach((v, k) => args.push(k * dt, off + a * v));
      args.push(NOISE_POINTS * dt, off + a * pts[0]);
      tran = { type: 'PWL', args, repeatFrom: 0 };
      return { kind: 'source', spec: { dc: off + a * pts[0], tran } };
    }
    case 'arb': {
      const pts = arbPoints(s.arb, s.arbData);
      const args: number[] = [];
      pts.forEach((v, k) => args.push((k * T) / pts.length, off + a * v));
      args.push(T, off + a * pts[0]);
      tran = { type: 'PWL', args, repeatFrom: 0 };
      return { kind: 'source', spec: { dc: off + a * pts[0], tran, acMag } };
    }
  }
  return { kind: 'source', spec: { tran, acMag } };
}

/** Value of the internal EMF at time t (for previews and tests; matches benchWave). */
export function benchSample(s: BenchGenSettings, t: number): number {
  const a = emfPeak(s);
  const off = emfOffset(s);
  const T = 1 / s.freq;
  if (s.mod !== 'none') {
    const w = 2 * Math.PI * s.freq;
    const wm = 2 * Math.PI * s.modFreq;
    switch (s.mod) {
      case 'am':
        return off + a * (1 + s.depth * Math.sin(wm * t)) * Math.sin(w * t);
      case 'fm': {
        const beta = s.deviation / s.modFreq;
        return off + a * Math.sin(w * t - beta * Math.cos(wm * t) + beta);
      }
      case 'burst': {
        const m = t - s.burstPeriod * Math.floor(t / s.burstPeriod);
        return off + (m < s.cycles / s.freq ? a * Math.sin(w * m) : 0);
      }
      case 'sweep': {
        const m = t - s.sweepTime * Math.floor(t / s.sweepTime);
        return off + a * Math.sin(w * m + ((Math.PI * (s.sweepStop - s.freq)) / s.sweepTime) * m * m);
      }
    }
  }
  const tp = t - phaseDelay(s);
  // PULSE-based shapes start at their low level until the phase delay has passed (SPICE PULSE)
  if (tp < 0 && (s.waveform === 'square' || s.waveform === 'triangle' || s.waveform === 'ramp' || s.waveform === 'pulse')) return off - a;
  const x = (((tp / T) % 1) + 1) % 1;
  switch (s.waveform) {
    case 'dc':
      return off;
    case 'sine':
      return off + a * Math.sin(2 * Math.PI * s.freq * t + (s.phase * Math.PI) / 180);
    case 'square':
      return x < s.duty ? off + a : off - a;
    case 'triangle':
      return x < 0.5 ? off - a + 4 * a * x : off + a - 4 * a * (x - 0.5);
    case 'ramp': {
      const r = Math.max(1e-9, Math.min(1 - 1e-9, s.symmetry));
      return x < r ? off - a + (2 * a * x) / r : off + a - (2 * a * (x - r)) / (1 - r);
    }
    case 'pulse':
      return x * T < s.width ? off + a : off - a;
    case 'noise': {
      const pts = noiseSamples(NOISE_POINTS);
      const dt = 1 / (2 * s.freq);
      const k = Math.floor(t / dt) % NOISE_POINTS;
      return off + a * pts[k];
    }
    case 'arb': {
      const pts = arbPoints(s.arb, s.arbData);
      const pos = x * pts.length;
      const k = Math.floor(pos);
      const f = pos - k;
      return off + a * (pts[k % pts.length] * (1 - f) + pts[(k + 1) % pts.length] * f);
    }
  }
}
