/**
 * Transient waveforms of independent sources: SIN, PULSE, PWL (with repeat), EXP, SFFM, AM.
 *
 * The functions follow the published SPICE3 definitions of the source functions, including
 * the defaults that depend on the transient analysis (`tstep`, `tstop`):
 *
 *   SIN   (VO VA FREQ TD THETA PHASE)  FREQ=1/tstop, TD=0, THETA=0, PHASE=0 (degrees)
 *   PULSE (V1 V2 TD TR TF PW PER)      TD=0, TR=tstep, TF=tstep, PW=tstop, PER=tstop
 *   PWL   (T1 V1 T2 V2 ...)            optional repeat from `repeatFrom` (SPICE r=value)
 *   EXP   (V1 V2 TD1 TAU1 TD2 TAU2)    TD1=0, TAU1=tstep, TD2=TD1+tstep, TAU2=tstep
 *   SFFM  (VO VA FC MDI FS)            FC=1/tstop, MDI=0, FS=1/tstop
 *   AM    (VA VO MF FC TD)             MF=1/tstop, FC=1/tstop, TD=0
 *
 * As in SPICE, a zero (or missing / non-finite) value of a time constant or frequency argument
 * selects its default. Open-ended runs (interactive stepper) pass `tstop = Infinity`, which
 * makes default periods infinite (single pulse) and default frequencies 0.
 *
 * Devices evaluate waveforms through {@link compileWaveform}: the arguments and defaults are
 * resolved once (PWL tables included), after which `value(t)` is cheap and `breakpoints(from, to)`
 * enumerates corners of any time window (the open-ended stepper asks for successive windows).
 *
 * Positional arguments can be read and changed by name ({@link getWaveformParam},
 * {@link setWaveformParam}), which is what interactive instruments use
 * (e.g. "freq", "ampl", "offset", "per", "duty").
 */
import type { Waveform, WaveformType } from './netlist';

/** Analysis-dependent defaults for waveform arguments. */
export interface WaveformTiming {
  /** Nominal transient step (s). 0 when unknown (e.g. operating point only). */
  tstep: number;
  /** Transient stop time (s). Infinity for open-ended (interactive) simulation. */
  tstop: number;
}

/** Fallback timing used when no transient analysis provides one. */
export const DEFAULT_TIMING: WaveformTiming = { tstep: 0, tstop: Infinity };

/** Hard cap on the number of breakpoints one query may generate. */
const MAX_BREAKPOINTS = 200000;

/** Smallest edge time used when neither the argument nor tstep gives a positive value. */
const MIN_EDGE = 1e-12;

/** Accepted names (lower-case) for each positional argument, per waveform type. */
const PARAM_NAMES: Record<WaveformType, readonly (readonly string[])[]> = {
  SIN: [
    ['vo', 'offset', 'voff', 'io', 'ioff'],
    ['va', 'ampl', 'amplitude', 'vamp', 'ia', 'iamp'],
    ['freq', 'frequency', 'f'],
    ['td', 'delay'],
    ['theta', 'damping', 'df'],
    ['phase', 'ph'],
  ],
  PULSE: [
    ['v1', 'i1', 'initial', 'low'],
    ['v2', 'i2', 'pulsed', 'high'],
    ['td', 'delay'],
    ['tr', 'rise'],
    ['tf', 'fall'],
    ['pw', 'width'],
    ['per', 'period'],
  ],
  EXP: [['v1', 'i1'], ['v2', 'i2'], ['td1'], ['tau1'], ['td2'], ['tau2']],
  SFFM: [['vo', 'offset', 'io'], ['va', 'ampl', 'amplitude', 'ia'], ['fc', 'freq', 'carrier', 'frequency'], ['mdi', 'index'], ['fs', 'fm', 'signal']],
  AM: [['va', 'ampl', 'amplitude', 'sa'], ['vo', 'offset', 'oc'], ['mf', 'fm', 'modfreq'], ['fc', 'freq', 'carrier', 'frequency'], ['td', 'delay']],
  PWL: [],
};

/** Canonical (first) names of the positional arguments of a waveform type. */
export function waveformParamNames(type: WaveformType): string[] {
  return PARAM_NAMES[type].map((names) => names[0]);
}

/** Index of a named positional argument (case-insensitive), or -1. */
export function waveformParamIndex(type: WaveformType, name: string): number {
  const key = name.trim().toLowerCase();
  return PARAM_NAMES[type].findIndex((names) => names.includes(key));
}

function arg(w: Waveform, i: number): number | undefined {
  const v = w.args[i];
  return v === undefined || !Number.isFinite(v) ? undefined : v;
}

/** Argument i, or `def` when missing, non-finite or (when `zeroIsDefault`) zero. */
function argOr(w: Waveform, i: number, def: number, zeroIsDefault = false): number {
  const v = arg(w, i);
  if (v === undefined || (zeroIsDefault && v === 0)) return def;
  return v;
}

function inv(t: number): number {
  return Number.isFinite(t) && t > 0 ? 1 / t : 0;
}

function defaultEdge(timing: WaveformTiming): number {
  return timing.tstep > 0 ? timing.tstep : MIN_EDGE;
}

/** Resolved PULSE parameters (defaults applied). */
export interface PulseParams {
  v1: number;
  v2: number;
  td: number;
  tr: number;
  tf: number;
  pw: number;
  per: number;
}

export function pulseParams(w: Waveform, timing: WaveformTiming): PulseParams {
  const edge = defaultEdge(timing);
  return {
    v1: argOr(w, 0, 0),
    v2: argOr(w, 1, 0),
    td: Math.max(0, argOr(w, 2, 0)),
    tr: argOr(w, 3, edge, true),
    tf: argOr(w, 4, edge, true),
    pw: argOr(w, 5, timing.tstop),
    per: argOr(w, 6, timing.tstop, true),
  };
}

/** A waveform with its arguments and defaults resolved, ready for repeated evaluation. */
export interface CompiledWaveform {
  readonly type: WaveformType;
  /** Instantaneous value at time t (s). */
  value(t: number): number;
  /** Corner times in the half-open window (from, to], ascending and de-duplicated. */
  breakpoints(from: number, to: number): number[];
}

/** Sorted, de-duplicated copy of the times in (from, to]. */
function finishBreakpoints(raw: number[], from: number, to: number): number[] {
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of raw) {
    if (t > from && t <= to && Number.isFinite(t) && (out.length === 0 || t > out[out.length - 1])) out.push(t);
  }
  return out;
}

function compilePulse(w: Waveform, timing: WaveformTiming): CompiledWaveform {
  const p = pulseParams(w, timing);
  const periodic = Number.isFinite(p.per) && p.per > 0;
  const corners = [0, p.tr, p.tr + p.pw, p.tr + p.pw + p.tf].filter((c) => Number.isFinite(c) && (!periodic || c <= p.per));
  return {
    type: 'PULSE',
    value(t: number): number {
      if (t < p.td) return p.v1;
      let tt = t - p.td;
      if (periodic && tt >= p.per) tt -= Math.floor(tt / p.per) * p.per;
      if (tt < p.tr) return p.v1 + ((p.v2 - p.v1) * tt) / p.tr;
      if (tt <= p.tr + p.pw) return p.v2;
      if (tt < p.tr + p.pw + p.tf) return p.v2 + ((p.v1 - p.v2) * (tt - p.tr - p.pw)) / p.tf;
      return p.v1;
    },
    breakpoints(from: number, to: number): number[] {
      const raw: number[] = [];
      const k0 = periodic ? Math.max(0, Math.floor((from - p.td) / p.per) - 1) : 0;
      for (let k = k0; raw.length < MAX_BREAKPOINTS; k++) {
        const base = p.td + (periodic ? k * p.per : 0);
        if (base > to) break;
        for (const c of corners) raw.push(base + c);
        if (!periodic) break;
      }
      return finishBreakpoints(raw, from, to);
    },
  };
}

function compilePwl(w: Waveform): CompiledWaveform {
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i + 1 < w.args.length; i += 2) {
    const ti = w.args[i];
    const vi = w.args[i + 1];
    if (!Number.isFinite(ti) || !Number.isFinite(vi)) continue;
    if (t.length > 0 && ti < t[t.length - 1]) continue; // SPICE requires non-decreasing times
    t.push(ti);
    v.push(vi);
  }
  const n = t.length;
  const last = n > 0 ? t[n - 1] : 0;
  let rep: { from: number; period: number } | undefined;
  if (w.repeatFrom !== undefined && Number.isFinite(w.repeatFrom) && n >= 2) {
    const from = Math.max(w.repeatFrom, t[0]);
    if (last - from > 0) rep = { from, period: last - from };
  }
  const interp = (x: number): number => {
    if (n === 0) return 0;
    if (x <= t[0]) return v[0];
    if (x >= t[n - 1]) return v[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= x) lo = mid;
      else hi = mid;
    }
    const dt = t[hi] - t[lo];
    return dt > 0 ? v[lo] + ((v[hi] - v[lo]) * (x - t[lo])) / dt : v[hi];
  };
  const inWindow = rep ? t.filter((ti) => ti > (rep as { from: number }).from && ti <= last) : [];
  return {
    type: 'PWL',
    value(x: number): number {
      if (rep && x > last) {
        const k = (x - last) / rep.period;
        let y = rep.from + (k - Math.floor(k)) * rep.period;
        // land exactly on the end of a period rather than its start (keeps corners continuous)
        if (y === rep.from) y = last;
        return interp(y);
      }
      return interp(x);
    },
    breakpoints(from: number, to: number): number[] {
      const raw: number[] = [];
      for (const ti of t) raw.push(ti);
      if (rep) {
        const k0 = Math.max(0, Math.floor((from - last) / rep.period) - 1);
        for (let k = k0; raw.length < MAX_BREAKPOINTS; k++) {
          const offset = last + k * rep.period - rep.from;
          if (rep.from + offset > to) break;
          for (const ti of inWindow) raw.push(ti + offset);
        }
      }
      return finishBreakpoints(raw, from, to);
    },
  };
}

/**
 * Resolve a waveform's arguments and defaults. The result does not track later changes of
 * `w` (re-compile after {@link setWaveformParam}).
 */
export function compileWaveform(w: Waveform, timing: WaveformTiming = DEFAULT_TIMING): CompiledWaveform {
  switch (w.type) {
    case 'PULSE':
      return compilePulse(w, timing);
    case 'PWL':
      return compilePwl(w);
    case 'SIN': {
      const vo = argOr(w, 0, 0);
      const va = argOr(w, 1, 0);
      const freq = argOr(w, 2, inv(timing.tstop), true);
      const td = argOr(w, 3, 0);
      const theta = argOr(w, 4, 0);
      const phase = (argOr(w, 5, 0) * Math.PI) / 180;
      const w0 = 2 * Math.PI * freq;
      return {
        type: 'SIN',
        value(t: number): number {
          if (t < td) return vo + va * Math.sin(phase);
          const tt = t - td;
          return vo + va * (theta !== 0 ? Math.exp(-tt * theta) : 1) * Math.sin(w0 * tt + phase);
        },
        breakpoints: (from, to) => finishBreakpoints([td], from, to),
      };
    }
    case 'EXP': {
      const v1 = argOr(w, 0, 0);
      const v2 = argOr(w, 1, 0);
      const step = defaultEdge(timing);
      const td1 = argOr(w, 2, 0);
      const tau1 = argOr(w, 3, step, true);
      const td2 = argOr(w, 4, td1 + step, true);
      const tau2 = argOr(w, 5, step, true);
      return {
        type: 'EXP',
        value(t: number): number {
          if (t < td1) return v1;
          let val = v1 + (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1));
          if (t >= td2) val += (v1 - v2) * (1 - Math.exp(-(t - td2) / tau2));
          return val;
        },
        breakpoints: (from, to) => finishBreakpoints([td1, td2], from, to),
      };
    }
    case 'SFFM': {
      const vo = argOr(w, 0, 0);
      const va = argOr(w, 1, 0);
      const fc = argOr(w, 2, inv(timing.tstop), true);
      const mdi = argOr(w, 3, 0);
      const fs = argOr(w, 4, inv(timing.tstop), true);
      return {
        type: 'SFFM',
        value: (t) => vo + va * Math.sin(2 * Math.PI * fc * t + mdi * Math.sin(2 * Math.PI * fs * t)),
        breakpoints: () => [],
      };
    }
    case 'AM': {
      const va = argOr(w, 0, 0);
      const vo = argOr(w, 1, 0);
      const mf = argOr(w, 2, inv(timing.tstop), true);
      const fc = argOr(w, 3, inv(timing.tstop), true);
      const td = argOr(w, 4, 0);
      return {
        type: 'AM',
        value(t: number): number {
          if (t < td) return 0;
          const tt = t - td;
          return va * (vo + Math.sin(2 * Math.PI * mf * tt)) * Math.sin(2 * Math.PI * fc * tt);
        },
        breakpoints: (from, to) => finishBreakpoints([td], from, to),
      };
    }
    default:
      return { type: w.type, value: () => 0, breakpoints: () => [] };
  }
}

/** Instantaneous value of a waveform at time t (seconds). */
export function waveformValue(w: Waveform, t: number, timing: WaveformTiming = DEFAULT_TIMING): number {
  return compileWaveform(w, timing).value(t);
}

/**
 * Corner times of a waveform in (from, tstop] (ascending, de-duplicated; `from` defaults to 0).
 * The transient analysis hits these exactly and restarts integration with backward Euler after
 * each of them.
 */
export function waveformBreakpoints(w: Waveform, tstop: number, timing: WaveformTiming = DEFAULT_TIMING, from = 0): number[] {
  return compileWaveform(w, timing).breakpoints(from, tstop);
}

/** Read a named waveform parameter (resolved defaults are NOT applied; undefined when unset). */
export function getWaveformParam(w: Waveform, name: string): number | undefined {
  const key = name.trim().toLowerCase();
  if (w.type === 'PULSE' && (key === 'freq' || key === 'frequency')) {
    const per = arg(w, 6);
    return per !== undefined && per > 0 ? 1 / per : undefined;
  }
  if (w.type === 'PULSE' && key === 'duty') {
    const per = arg(w, 6);
    const pw = arg(w, 5);
    return per !== undefined && pw !== undefined && per > 0 ? pw / per : undefined;
  }
  if (w.type === 'PWL' && (key === 'r' || key === 'repeat')) return w.repeatFrom;
  const i = waveformParamIndex(w.type, key);
  return i < 0 ? undefined : arg(w, i);
}

/**
 * Change a named waveform parameter in place. Returns false when the name is not a parameter of
 * this waveform type. Extra names: PULSE "freq" (sets PER = 1/freq, keeping the duty cycle) and
 * "duty" (PW = duty*PER, duty as a fraction 0..1), PWL "r"/"repeat" (repeat start time; NaN
 * disables repetition).
 */
export function setWaveformParam(w: Waveform, name: string, value: number): boolean {
  const key = name.trim().toLowerCase();
  const setArg = (i: number, v: number) => {
    while (w.args.length <= i) w.args.push(Number.NaN);
    w.args[i] = v;
  };
  if (w.type === 'PULSE' && (key === 'freq' || key === 'frequency')) {
    const duty = getWaveformParam(w, 'duty');
    const per = value > 0 ? 1 / value : Infinity;
    setArg(6, per);
    if (duty !== undefined && Number.isFinite(per)) setArg(5, duty * per);
    return true;
  }
  if (w.type === 'PULSE' && key === 'duty') {
    const per = arg(w, 6);
    if (per === undefined || !(per > 0)) return false;
    setArg(5, Math.min(1, Math.max(0, value)) * per);
    return true;
  }
  if (w.type === 'PWL' && (key === 'r' || key === 'repeat')) {
    w.repeatFrom = Number.isFinite(value) ? value : undefined;
    return true;
  }
  const i = waveformParamIndex(w.type, key);
  if (i < 0) return false;
  setArg(i, value);
  return true;
}

/** Deep copy of a waveform (args are mutated by setWaveformParam). */
export function cloneWaveform(w: Waveform): Waveform {
  const c: Waveform = { type: w.type, args: w.args.slice() };
  if (w.repeatFrom !== undefined) c.repeatFrom = w.repeatFrom;
  return c;
}
