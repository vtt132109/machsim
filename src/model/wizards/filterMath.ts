/**
 * Filter design mathematics (pure, published textbook theory):
 *
 * - Order from the specification (pass-band edge attenuation Ap, stop-band attenuation As and
 *   the normalised stop-band frequency Ωs):
 *     Butterworth  n = ⌈ log10((10^(As/10) − 1)/(10^(Ap/10) − 1)) / (2·log10 Ωs) ⌉
 *     Chebyshev    n = ⌈ acosh(√((10^(As/10) − 1)/(10^(Ap/10) − 1))) / acosh Ωs ⌉
 *   with Ωs = fs/fp (low-pass), fp/fs (high-pass), BWs/BWp (band-pass), BWp/BWs (band-stop).
 * - Low-pass prototype poles: Butterworth on the unit circle (3 dB at Ω = 1, then scaled by
 *   ε^(−1/n) so the edge attenuation is Ap); Chebyshev type I with ripple Ap
 *   (s_k = −sinh a·sin θk + j·cosh a·cos θk, a = asinh(1/ε)/n, θk = (2k − 1)π/(2n)).
 * - Doubly terminated LC-ladder element values g_k (Butterworth 2·sin((2k − 1)π/(2n));
 *   Chebyshev by the classic recursion with β = ln coth(Ap/17.37), γ = sinh(β/(2n))).
 * - Frequency transformations of the prototype poles to low-pass / high-pass / band-pass /
 *   band-stop second-order sections (ω0, Q), and evaluation helpers for complex responses.
 */

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop';
export type FilterResponse = 'butterworth' | 'chebyshev';

export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cscale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im);
export function cdiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export function csqrt(a: Cx): Cx {
  const r = cabs(a);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
  return { re, im };
}
export const cinv = (a: Cx): Cx => cdiv(cx(1), a);

/** ε of a pass-band attenuation Ap (dB): Ap = 10·log10(1 + ε²). */
export function rippleEps(ap: number): number {
  return Math.sqrt(10 ** (ap / 10) - 1);
}

/** Minimum order meeting the specification (Ωs > 1, As > Ap > 0). */
export function filterOrder(response: FilterResponse, ap: number, as: number, omegaS: number): number {
  if (!(omegaS > 1) || !(as > ap) || !(ap > 0)) return Number.NaN;
  const ratio = (10 ** (as / 10) - 1) / (10 ** (ap / 10) - 1);
  const n = response === 'butterworth' ? Math.log10(ratio) / (2 * Math.log10(omegaS)) : Math.acosh(Math.sqrt(ratio)) / Math.acosh(omegaS);
  return Math.max(1, Math.ceil(n - 1e-9));
}

/** Normalised stop-band frequency Ωs of a specification. */
export function stopbandRatio(type: FilterType, a: { fp?: number; fs?: number; bw?: number; bws?: number }): number {
  switch (type) {
    case 'lowpass':
      return (a.fs ?? NaN) / (a.fp ?? NaN);
    case 'highpass':
      return (a.fp ?? NaN) / (a.fs ?? NaN);
    case 'bandpass':
      return (a.bws ?? NaN) / (a.bw ?? NaN);
    case 'bandstop':
      return (a.bw ?? NaN) / (a.bws ?? NaN);
  }
}

/**
 * Frequency scale of the prototype: Butterworth poles / ladders are tabulated for 3 dB at Ω = 1,
 * so the edge where the attenuation equals Ap sits at Ω = ε^(1/n); this returns ε^(−1/n)
 * (multiply a low-pass cut-off by it). Chebyshev tables are already ripple-edge normalised: 1.
 */
export function protoScale(response: FilterResponse, n: number, ap: number): number {
  return response === 'butterworth' ? rippleEps(ap) ** (-1 / n) : 1;
}

/** Left-half-plane prototype poles (upper half and real ones; conjugates implied), Ω = 1 normalised. */
export function prototypePoles(response: FilterResponse, n: number, ap: number): Cx[] {
  const out: Cx[] = [];
  if (response === 'butterworth') {
    for (let k = 1; k <= n; k++) {
      const th = Math.PI / 2 + ((2 * k - 1) * Math.PI) / (2 * n);
      const p = cx(Math.cos(th), Math.sin(th));
      if (p.im >= -1e-12) out.push({ re: p.re, im: Math.abs(p.im) < 1e-12 ? 0 : p.im });
    }
  } else {
    const a = Math.asinh(1 / rippleEps(ap)) / n;
    for (let k = 1; k <= n; k++) {
      const th = ((2 * k - 1) * Math.PI) / (2 * n);
      const p = cx(-Math.sinh(a) * Math.sin(th), Math.cosh(a) * Math.cos(th));
      if (p.im >= -1e-12) out.push({ re: p.re, im: Math.abs(p.im) < 1e-12 ? 0 : p.im });
    }
  }
  // lowest Q (real pole, then widest pairs) first
  return out.sort((x, y) => qOf(x) - qOf(y));
}

/** Pole quality factor |p| / (−2·Re p) (real pole: 0.5). */
export function qOf(p: Cx): number {
  return cabs(p) / (-2 * p.re);
}

/**
 * Gain at the reference point of the pass band relative to its maximum: 1/√(1 + ε²) for an
 * even-order Chebyshev (DC / ω0 / infinity are ripple troughs), 1 otherwise.
 */
export function referenceGain(response: FilterResponse, n: number, ap: number): number {
  return response === 'chebyshev' && n % 2 === 0 ? 1 / Math.sqrt(1 + rippleEps(ap) ** 2) : 1;
}

/** Doubly terminated ladder values g1..gn and g(n+1) (Matthaei / Zverev tables). */
export function ladderValues(response: FilterResponse, n: number, ap: number): { g: number[]; gLoad: number } {
  const g: number[] = [];
  if (response === 'butterworth') {
    for (let k = 1; k <= n; k++) g.push(2 * Math.sin(((2 * k - 1) * Math.PI) / (2 * n)));
    return { g, gLoad: 1 };
  }
  const beta = Math.log(1 / Math.tanh(ap / 17.37));
  const gamma = Math.sinh(beta / (2 * n));
  const a = (k: number) => Math.sin(((2 * k - 1) * Math.PI) / (2 * n));
  const b = (k: number) => gamma * gamma + Math.sin((k * Math.PI) / n) ** 2;
  g.push((2 * a(1)) / gamma);
  for (let k = 2; k <= n; k++) g.push((4 * a(k - 1) * a(k)) / (b(k - 1) * g[k - 2]));
  const gLoad = n % 2 === 1 ? 1 : 1 / Math.tanh(beta / 4) ** 2;
  return { g, gLoad };
}

/** A second-order section (or first-order when `order` = 1) after frequency transformation. */
export interface Section {
  order: 1 | 2;
  /** pole frequency, rad/s */
  w0: number;
  /** pole quality factor (second order) */
  q: number;
  /** numerator kind */
  kind: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  /** notch: zero frequency (rad/s) */
  wz?: number;
}

/**
 * Sections of the denormalised filter. `wc` is the prototype scaling: the low-pass / high-pass
 * cut-off (rad/s, already including protoScale) or, for band filters, the bandwidth B (rad/s)
 * together with the centre `w0`.
 */
export function filterSections(type: FilterType, poles: Cx[], wc: number, w0 = 0): Section[] {
  const out: Section[] = [];
  const pushPair = (s: Cx, kind: Section['kind'], wz?: number) => {
    const w = cabs(s);
    out.push({ order: 2, w0: w, q: w / (-2 * s.re), kind, ...(wz !== undefined ? { wz } : {}) });
  };
  for (const p of poles) {
    const real = Math.abs(p.im) < 1e-12;
    if (type === 'lowpass' || type === 'highpass') {
      const s = type === 'lowpass' ? cscale(p, wc) : cscale(cinv(p), wc);
      if (real) out.push({ order: 1, w0: Math.abs(s.re), q: 0.5, kind: type });
      else pushPair(s, type);
      continue;
    }
    // band filters: each prototype pole p gives the roots of s² − (pB)s + ω0² = 0 (band-pass) or
    // s² − (B/p)s + ω0² = 0 (band-stop); a real pole gives one conjugate pair, a complex pole (with
    // its implied conjugate) two pairs
    const k = type === 'bandpass' ? cscale(p, wc) : cscale(cinv(p), wc);
    const disc = csqrt(csub(cmul(k, k), cx(4 * w0 * w0)));
    const r1 = cscale(cadd(k, disc), 0.5);
    const r2 = cscale(csub(k, disc), 0.5);
    const kind: Section['kind'] = type === 'bandpass' ? 'bandpass' : 'notch';
    const wz = type === 'bandstop' ? w0 : undefined;
    if (real) {
      // r1, r2 are a conjugate pair (or two real roots when the band is very wide)
      pushPair(r1.im >= 0 ? r1 : r2, kind, wz);
    } else {
      pushPair({ re: r1.re, im: Math.abs(r1.im) }, kind, wz);
      pushPair({ re: r2.re, im: Math.abs(r2.im) }, kind, wz);
    }
  }
  return out;
}

/** Normalised section response (unity reference gain) at angular frequency w. */
export function sectionResponse(s: Section, w: number): Cx {
  const jw = cx(0, w);
  if (s.order === 1) {
    const den = cadd(jw, cx(s.w0));
    return s.kind === 'highpass' ? cdiv(jw, den) : cdiv(cx(s.w0), den);
  }
  const den = cx(s.w0 * s.w0 - w * w, (s.w0 / s.q) * w);
  switch (s.kind) {
    case 'lowpass':
      return cdiv(cx(s.w0 * s.w0), den);
    case 'highpass':
      return cdiv(cx(-w * w), den);
    case 'bandpass':
      return cdiv(cx(0, (s.w0 / s.q) * w), den);
    case 'notch': {
      const wz = s.wz ?? s.w0;
      // unity high-frequency gain
      return cdiv(cx(wz * wz - w * w), den);
    }
  }
}

/** Band edges f1, f2 of a geometric centre f0 and a width bw (f2 − f1 = bw, f1·f2 = f0²). */
export function bandEdges(f0: number, bw: number): [number, number] {
  const f1 = -bw / 2 + Math.sqrt((bw * bw) / 4 + f0 * f0);
  return [f1, f1 + bw];
}
