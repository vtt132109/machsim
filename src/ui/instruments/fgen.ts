/**
 * Function generator model (pure): parameter parsing / validation, the ideal output sample at
 * time t (panel preview, tests) and the equivalent SPICE transient waveform.
 *
 * Param keys (text, user number syntax): waveform (sine|triangle|square), freq (Hz),
 * duty (%; triangle & square), amplitude (V peak), offset (V), risetime (s; square edges).
 */

import type { Waveform } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { t } from '../../i18n';

export type FgenWaveform = 'sine' | 'triangle' | 'square';

export interface FgenSettings {
  waveform: FgenWaveform;
  freq: number;
  /** 0..1 */
  duty: number;
  amplitude: number;
  offset: number;
  risetime: number;
}

export const FGEN_DEFAULTS: Record<string, string> = {
  waveform: 'sine',
  freq: '1k',
  duty: '50',
  amplitude: '1',
  offset: '0',
  risetime: '1n',
};

export interface FgenFieldError {
  key: string;
  message: string;
}

/** Validate generator params; returns one message per invalid field. */
export function validateFgen(params: Record<string, string>): FgenFieldError[] {
  const errs: FgenFieldError[] = [];
  const get = (k: string) => parseUserNumber(params[k] ?? FGEN_DEFAULTS[k]);
  const w = (params.waveform ?? FGEN_DEFAULTS.waveform).trim().toLowerCase();
  if (!['sine', 'triangle', 'square'].includes(w)) errs.push({ key: 'waveform', message: t('instruments.fgen.unknownWaveform') });
  const f = get('freq');
  if (!(f > 0) || !Number.isFinite(f)) errs.push({ key: 'freq', message: t('instruments.fgen.frequencyMustBe0') });
  const d = get('duty');
  if (!(d >= 1 && d <= 99)) errs.push({ key: 'duty', message: t('instruments.fgen.dutyCycleMustBe1') });
  const a = get('amplitude');
  if (!(a >= 0) || !Number.isFinite(a)) errs.push({ key: 'amplitude', message: t('instruments.fgen.amplitudeMustBe0') });
  if (!Number.isFinite(get('offset'))) errs.push({ key: 'offset', message: t('instruments.fgen.offsetMustBeANumber') });
  const r = get('risetime');
  if (!(r > 0) || !Number.isFinite(r)) errs.push({ key: 'risetime', message: t('instruments.fgen.riseTimeMustBe0') });
  else if (f > 0 && r > 0.5 * Math.min(d, 100 - d) * 0.01 / f) errs.push({ key: 'risetime', message: t('instruments.fgen.riseTimeIsLongerThan') });
  return errs;
}

/** Parse params (invalid fields take their defaults). */
export function fgenSettings(params: Record<string, string>): FgenSettings {
  const num = (k: string) => {
    const v = parseUserNumber(params[k] ?? '');
    return Number.isFinite(v) ? v : parseUserNumber(FGEN_DEFAULTS[k]);
  };
  const w = (params.waveform ?? '').trim().toLowerCase();
  const freq = num('freq');
  const duty = num('duty');
  const amp = num('amplitude');
  const rt = num('risetime');
  return {
    waveform: w === 'triangle' || w === 'square' ? w : 'sine',
    freq: freq > 0 ? freq : 1e3,
    duty: Math.max(0.01, Math.min(0.99, (duty >= 1 && duty <= 99 ? duty : 50) / 100)),
    amplitude: amp >= 0 ? amp : 1,
    offset: num('offset'),
    risetime: rt > 0 ? rt : 1e-9,
  };
}

/**
 * Ideal output at time t (s). Square: high for duty*T with linear edges of `risetime`;
 * triangle: rises for duty*T then falls; sine: offset + amplitude * sin(2πft).
 */
export function fgenSample(s: FgenSettings, t: number): number {
  const T = 1 / s.freq;
  const ph = (((t % T) + T) % T) / T;
  switch (s.waveform) {
    case 'sine':
      return s.offset + s.amplitude * Math.sin(2 * Math.PI * ph);
    case 'triangle': {
      const d = s.duty;
      const y = ph < d ? -1 + (2 * ph) / d : 1 - (2 * (ph - d)) / (1 - d);
      return s.offset + s.amplitude * y;
    }
    case 'square': {
      const tr = Math.min(s.risetime / T, s.duty / 2, (1 - s.duty) / 2);
      let y: number;
      if (ph < tr) y = -1 + (2 * ph) / tr;
      else if (ph < s.duty) y = 1;
      else if (ph < s.duty + tr) y = 1 - (2 * (ph - s.duty)) / tr;
      else y = -1;
      return s.offset + s.amplitude * y;
    }
  }
}

/**
 * Equivalent SPICE waveform of one generator output (relative to its common terminal).
 * Sine -> SIN(offset amplitude freq); square / triangle -> PULSE(low high 0 tr tf pw period).
 */
export function fgenSpiceWaveform(s: FgenSettings): Waveform {
  const T = 1 / s.freq;
  const lo = s.offset - s.amplitude;
  const hi = s.offset + s.amplitude;
  if (s.waveform === 'sine') return { type: 'SIN', args: [s.offset, s.amplitude, s.freq, 0, 0, 0] };
  if (s.waveform === 'triangle') {
    const tr = s.duty * T;
    const tf = T - tr;
    // PULSE with zero pulse width: ramp up for tr, ramp down for tf; starts at the low value
    return { type: 'PULSE', args: [lo, hi, 0, tr, tf, 0, T] };
  }
  const tr = Math.min(s.risetime, s.duty * T * 0.5, (1 - s.duty) * T * 0.5);
  return { type: 'PULSE', args: [lo, hi, 0, tr, tr, Math.max(0, s.duty * T - tr), T] };
}
