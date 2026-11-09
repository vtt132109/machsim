/**
 * Two-port network analysis (pure): S-parameters from AC port voltages, conversion to Z / Y /
 * H parameters, Rollett stability, gains, and Smith-chart geometry.
 *
 * Measurement model (reference impedance Z0, real, equal at both ports): the driven port is fed
 * by an AC source of open-circuit EMF `Vs` through Z0, the other port is terminated in Z0.
 *   forward run (port 1 driven): S11 = 2 V1 / Vs - 1,  S21 = 2 V2 / Vs
 *   reverse run (port 2 driven): S22 = 2 V2 / Vs - 1,  S12 = 2 V1 / Vs
 * The conversions are the standard textbook relations for equal real reference impedances.
 */

import type { SignalRef } from '../../model/types';
import type { AcAnalysis } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { parseUserNumber } from '../../util/units';
import { resultSignal } from './signals';

export interface Complex {
  re: number;
  im: number;
}

export const c = (re: number, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cscale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);
export const cargDeg = (a: Complex): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
export function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return { re: Number.NaN, im: Number.NaN };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** 2x2 complex matrix [[p11, p12], [p21, p22]]. */
export interface TwoPort {
  p11: Complex;
  p12: Complex;
  p21: Complex;
  p22: Complex;
}

const ONE = c(1);
const NAN_C = c(Number.NaN, Number.NaN);

/** S -> Z (ohms). */
export function sToZ(s: TwoPort, z0: number): TwoPort {
  const s12s21 = cmul(s.p12, s.p21);
  const den = csub(cmul(csub(ONE, s.p11), csub(ONE, s.p22)), s12s21);
  const k = (x: Complex) => cscale(cdiv(x, den), z0);
  return {
    p11: k(cadd(cmul(cadd(ONE, s.p11), csub(ONE, s.p22)), s12s21)),
    p12: k(cscale(s.p12, 2)),
    p21: k(cscale(s.p21, 2)),
    p22: k(cadd(cmul(csub(ONE, s.p11), cadd(ONE, s.p22)), s12s21)),
  };
}

/** S -> Y (siemens). */
export function sToY(s: TwoPort, z0: number): TwoPort {
  const s12s21 = cmul(s.p12, s.p21);
  const den = csub(cmul(cadd(ONE, s.p11), cadd(ONE, s.p22)), s12s21);
  const k = (x: Complex) => cscale(cdiv(x, den), 1 / z0);
  return {
    p11: k(cadd(cmul(csub(ONE, s.p11), cadd(ONE, s.p22)), s12s21)),
    p12: k(cscale(s.p12, -2)),
    p21: k(cscale(s.p21, -2)),
    p22: k(cadd(cmul(cadd(ONE, s.p11), csub(ONE, s.p22)), s12s21)),
  };
}

/** S -> H (h11 ohms, h12 / h21 dimensionless, h22 siemens). */
export function sToH(s: TwoPort, z0: number): TwoPort {
  const s12s21 = cmul(s.p12, s.p21);
  const den = cadd(cmul(csub(ONE, s.p11), cadd(ONE, s.p22)), s12s21);
  return {
    p11: cscale(cdiv(csub(cmul(cadd(ONE, s.p11), cadd(ONE, s.p22)), s12s21), den), z0),
    p12: cdiv(cscale(s.p12, 2), den),
    p21: cdiv(cscale(s.p21, -2), den),
    p22: cscale(cdiv(csub(cmul(csub(ONE, s.p11), csub(ONE, s.p22)), s12s21), den), 1 / z0),
  };
}

/** Z -> S (inverse of sToZ), used for tests and for building reference networks. */
export function zToS(z: TwoPort, z0: number): TwoPort {
  const a = cscale(z.p11, 1 / z0);
  const b = cscale(z.p12, 1 / z0);
  const cc = cscale(z.p21, 1 / z0);
  const d = cscale(z.p22, 1 / z0);
  const bc = cmul(b, cc);
  const den = csub(cmul(cadd(a, ONE), cadd(d, ONE)), bc);
  return {
    p11: cdiv(csub(cmul(csub(a, ONE), cadd(d, ONE)), bc), den),
    p12: cdiv(cscale(b, 2), den),
    p21: cdiv(cscale(cc, 2), den),
    p22: cdiv(csub(cmul(cadd(a, ONE), csub(d, ONE)), bc), den),
  };
}

/** Input impedance seen through a reflection coefficient: Z0 (1 + Γ) / (1 - Γ). */
export function gammaToZ(g: Complex, z0: number): Complex {
  return cscale(cdiv(cadd(ONE, g), csub(ONE, g)), z0);
}

export function zToGamma(z: Complex, z0: number): Complex {
  return cdiv(csub(z, c(z0)), cadd(z, c(z0)));
}

export interface Stability {
  /** Rollett stability factor K */
  k: number;
  /** |Δ| = |S11 S22 - S12 S21| */
  delta: number;
  /** unconditionally stable when K > 1 and |Δ| < 1 */
  unconditional: boolean;
}

export function rollett(s: TwoPort): Stability {
  const delta = cabs(csub(cmul(s.p11, s.p22), cmul(s.p12, s.p21)));
  const a11 = cabs(s.p11);
  const a22 = cabs(s.p22);
  const k = (1 - a11 * a11 - a22 * a22 + delta * delta) / (2 * cabs(cmul(s.p12, s.p21)));
  return { k, delta, unconditional: k > 1 && delta < 1 };
}

export interface Gains {
  /** transducer power gain with Z0 source and load: |S21|^2 */
  transducer: number;
  /** maximum available gain (NaN unless unconditionally stable) */
  mag: number;
  /** maximum stable gain |S21| / |S12| */
  msg: number;
}

export function powerGains(s: TwoPort): Gains {
  const st = rollett(s);
  const s21 = cabs(s.p21);
  const s12 = cabs(s.p12);
  const msg = s12 > 0 ? s21 / s12 : Number.POSITIVE_INFINITY;
  const mag = st.k >= 1 ? msg * (st.k - Math.sqrt(st.k * st.k - 1)) : Number.NaN;
  return { transducer: s21 * s21, mag, msg };
}

// ---------------------------------------------------------------------------
// From AC results
// ---------------------------------------------------------------------------

export interface SParameterData {
  freq: Float64Array;
  /** one TwoPort per frequency; S12 / S22 are NaN without a reverse run */
  s: TwoPort[];
  /** true when a reverse run supplied S12 / S22 */
  full: boolean;
}

function forwardRuns(ac: AnalysisResult): { fwd: AnalysisResult; rev: AnalysisResult | null } {
  const runs = ac.runs ?? [];
  if (runs.length >= 2) {
    const rev = runs.find((r) => /rev|port\s*2|p2/i.test(r.label)) ?? runs[1];
    const fwd = runs.find((r) => r !== rev) ?? runs[0];
    return { fwd: fwd.result, rev: rev.result };
  }
  if (runs.length === 1) return { fwd: runs[0].result, rev: null };
  return { fwd: ac, rev: null };
}

/**
 * S-parameters from AC port voltages. `ac` is either one forward run (port 1 driven) or a
 * result whose `runs` hold a forward and a reverse run (label containing "rev" / "port 2"
 * marks the reverse one; otherwise runs[0] = forward, runs[1] = reverse).
 * `vs` is the source EMF magnitude used for the runs (the AC magnitude, default 1).
 */
export function sParametersFromAc(ac: AnalysisResult, p1: SignalRef, p2: SignalRef, vs = 1): SParameterData | null {
  const { fwd, rev } = forwardRuns(ac);
  const scale = fwd.scale;
  if (!scale) return null;
  const v1 = resultSignal(fwd, p1);
  const v2 = resultSignal(fwd, p2);
  if (!v1 || !v2) return null;
  const r1 = rev ? resultSignal(rev, p1) : null;
  const r2 = rev ? resultSignal(rev, p2) : null;
  const full = !!(r1 && r2 && rev?.scale && rev.scale.re.length === scale.re.length);
  const n = scale.re.length;
  const s: TwoPort[] = [];
  const k = 2 / vs;
  for (let i = 0; i < n; i++) {
    s.push({
      p11: c(k * v1.re[i] - 1, k * v1.im[i]),
      p21: c(k * v2.re[i], k * v2.im[i]),
      p12: full && r1 ? c(k * r1.re[i], k * r1.im[i]) : NAN_C,
      p22: full && r2 ? c(k * r2.re[i] - 1, k * r2.im[i]) : NAN_C,
    });
  }
  return { freq: scale.re, s, full };
}

export type TwoPortKind = 's' | 'z' | 'y' | 'h';

/** Convert S-parameters to the requested parameter set. */
export function convertTwoPort(s: TwoPort, kind: TwoPortKind, z0: number): TwoPort {
  switch (kind) {
    case 's':
      return s;
    case 'z':
      return sToZ(s, z0);
    case 'y':
      return sToY(s, z0);
    case 'h':
      return sToH(s, z0);
  }
}

function lerpC(a: Complex, b: Complex, f: number): Complex {
  return { re: a.re + f * (b.re - a.re), im: a.im + f * (b.im - a.im) };
}

/**
 * Parameter set at frequency `freq` (S interpolated linearly on a log-frequency axis, clamped to
 * the measured range), converted to `kind`. Null without data.
 */
export function twoPortAt(data: SParameterData, freq: number, kind: TwoPortKind, z0: number): TwoPort | null {
  const n = data.freq.length;
  if (!n) return null;
  let s: TwoPort;
  if (n === 1 || freq <= data.freq[0]) s = data.s[0];
  else if (freq >= data.freq[n - 1]) s = data.s[n - 1];
  else {
    let i = 0;
    while (i < n - 2 && data.freq[i + 1] < freq) i++;
    const fa = data.freq[i];
    const fb = data.freq[i + 1];
    const f = fa > 0 && fb > 0 && freq > 0 ? Math.log(freq / fa) / Math.log(fb / fa) : (freq - fa) / (fb - fa || 1);
    const a = data.s[i];
    const b = data.s[i + 1];
    s = { p11: lerpC(a.p11, b.p11, f), p12: lerpC(a.p12, b.p12, f), p21: lerpC(a.p21, b.p21, f), p22: lerpC(a.p22, b.p22, f) };
  }
  return convertTwoPort(s, kind, z0);
}

/**
 * Network analyzer params (text, same keys as the library part): z0 (Ω), fstart / fstop (Hz),
 * points (per decade), display (s|z|y|h|smith), plus panel-only keys: param (11|12|21|22, the
 * parameter plotted), format (magphase|reim|db), marker (Hz).
 */
export const NETWORK_DEFAULTS: Record<string, string> = {
  z0: '50',
  fstart: '1M',
  fstop: '10G',
  points: '50',
  display: 's',
  param: '21',
  format: 'db',
  marker: '',
};

/**
 * The AC sweep the integration layer runs for the analyzer (decade sweep fstart..fstop). For the
 * full S matrix it runs it twice — port 1 driven ("forward") and port 2 driven ("reverse",
 * V_<ref>_1 acmag 0, V_<ref>_2 acmag 1) — and passes both as `ac.runs`.
 */
export function networkAnalysisSpec(params: Record<string, string>): AcAnalysis {
  const get = (k: string) => {
    const v = parseUserNumber(params[k] ?? '');
    return Number.isFinite(v) ? v : parseUserNumber(NETWORK_DEFAULTS[k]);
  };
  let fstart = get('fstart');
  let fstop = get('fstop');
  if (!(fstart > 0)) fstart = 1e6;
  if (!(fstop > fstart)) fstop = Math.max(fstart * 10, 1e10);
  const points = Math.max(1, Math.round(get('points')) || 50);
  return { type: 'ac', sweep: 'dec', points, fstart, fstop };
}

// ---------------------------------------------------------------------------
// Smith chart geometry
// ---------------------------------------------------------------------------

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Constant-resistance circle (normalised r) in the Γ plane. */
export function resistanceCircle(r: number): Circle {
  return { cx: r / (1 + r), cy: 0, r: 1 / (1 + r) };
}

/** Constant-reactance circle (normalised x != 0) in the Γ plane (only the part inside |Γ| <= 1 is drawn). */
export function reactanceCircle(x: number): Circle {
  return { cx: 1, cy: 1 / x, r: 1 / Math.abs(x) };
}
