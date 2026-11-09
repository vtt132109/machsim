/**
 * Chebyshev type I filter design for PSpice-style CHEBYSHEV controlled sources:
 *
 *   E<name> n+ n- CHEBYSHEV {V(a)} = LP <fpass> <fstop> <ripple dB> <stop attenuation dB>
 *                                 = HP <fpass> <fstop> <ripple> <attenuation>
 *                                 = BP <fstop1> <fpass1> <fpass2> <fstop2> <ripple> <attenuation>
 *                                 = BR <fpass1> <fstop1> <fstop2> <fpass2> <ripple> <attenuation>
 *
 * (frequencies in Hz, ascending for BP / BR). Method (standard textbook design, implemented here
 * from the published formulas):
 *   ε = √(10^(Rp/10) − 1);   order n = ⌈acosh(√((10^(As/10) − 1)/ε²)) / acosh(Ωs)⌉
 * where Ωs is the stop edge mapped into the low-pass prototype (LP fs/fp, HP fp/fs, BP / BR the
 * nearer stop edge through the band transform). Prototype poles (passband edge Ω = 1):
 *   p_k = −sinh(a)·sin θ_k + j·cosh(a)·cos θ_k,   θ_k = (2k − 1)π/(2n),   a = asinh(1/ε)/n.
 * Band transforms: LP s → s/ωp, HP s → ωp/s, BP s → (s² + ω0²)/(B·s), BR s → B·s/(s² + ω0²) with
 * ω0² = ω1·ω2 and B = ω2 − ω1 of the pass edges. The result is a cascade of first / second order
 * sections (real coefficients, ascending powers of s) whose product is H(s); its gain is set so
 * the passband peak is 1 (0 dB): the reference point (LP / BR: s = 0, HP: s → ∞, BP: s = jω0)
 * gets 1 for odd prototype orders and 1/√(1 + ε²) for even ones. The parser turns the cascade
 * into chained LAPLACE elements, which keeps high orders numerically well conditioned.
 */
import type { Rational } from './laplace';

export type ChebyshevKind = 'LP' | 'HP' | 'BP' | 'BR';

export interface ChebyshevSpec {
  kind: ChebyshevKind;
  /** band edges in Hz (LP / HP: pass, stop; BP: s1 p1 p2 s2; BR: p1 s1 s2 p2) */
  edges: number[];
  /** passband ripple, dB (> 0) */
  ripple: number;
  /** stopband attenuation, dB (> ripple) */
  atten: number;
}

export interface ChebyshevDesign {
  /** prototype order (the realised order is 2n for BP / BR) */
  order: number;
  /** ε of the ripple */
  epsilon: number;
  /** cascade sections, H(s) = Π sections */
  sections: Rational[];
}

interface C {
  re: number;
  im: number;
}

const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
function csqrt(a: C): C {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return { re, im: a.im < 0 ? -im : im };
}

/** Value of a real polynomial (ascending coefficients) at a complex point. */
export function polyAt(p: readonly number[], s: C): C {
  let acc: C = { re: 0, im: 0 };
  for (let k = p.length - 1; k >= 0; k--) acc = { re: acc.re * s.re - acc.im * s.im + p[k], im: acc.re * s.im + acc.im * s.re };
  return acc;
}

/** H(s) of a cascade at a complex point. */
export function cascadeAt(sections: readonly Rational[], s: C): C {
  let h: C = { re: 1, im: 0 };
  for (const sec of sections) h = cmul(h, cdiv(polyAt(sec.num, s), polyAt(sec.den, s)));
  return h;
}

/** Real quadratic (s − r)(s − r̄) = s² − 2Re(r)s + |r|², ascending. */
const quadOf = (r: C): number[] => [r.re * r.re + r.im * r.im, -2 * r.re, 1];

/** Low-pass prototype stop edge Ωs for the spec (throws on badly ordered edges). */
function stopEdge(spec: ChebyshevSpec): { omegaS: number; w1: number; w2: number } {
  const e = spec.edges;
  const need = spec.kind === 'LP' || spec.kind === 'HP' ? 2 : 4;
  if (e.length !== need || e.some((f) => !(f > 0) || !Number.isFinite(f))) {
    throw new Error(`CHEBYSHEV ${spec.kind} needs ${need} positive frequencies`);
  }
  const w = e.map((f) => 2 * Math.PI * f);
  switch (spec.kind) {
    case 'LP':
      if (!(e[1] > e[0])) throw new Error('CHEBYSHEV LP: the stop frequency must be above the pass frequency');
      return { omegaS: w[1] / w[0], w1: w[0], w2: w[0] };
    case 'HP':
      if (!(e[1] < e[0])) throw new Error('CHEBYSHEV HP: the stop frequency must be below the pass frequency');
      return { omegaS: w[0] / w[1], w1: w[0], w2: w[0] };
    case 'BP': {
      if (!(e[0] < e[1] && e[1] < e[2] && e[2] < e[3])) throw new Error('CHEBYSHEV BP: give fstop1 < fpass1 < fpass2 < fstop2');
      const [s1, p1, p2, s2] = w;
      const w0s = p1 * p2;
      const b = p2 - p1;
      return { omegaS: Math.min(Math.abs(s1 * s1 - w0s) / (b * s1), Math.abs(s2 * s2 - w0s) / (b * s2)), w1: p1, w2: p2 };
    }
    case 'BR': {
      if (!(e[0] < e[1] && e[1] < e[2] && e[2] < e[3])) throw new Error('CHEBYSHEV BR: give fpass1 < fstop1 < fstop2 < fpass2');
      const [p1, s1, s2, p2] = w;
      const w0s = p1 * p2;
      const b = p2 - p1;
      return { omegaS: Math.min((b * s1) / Math.abs(w0s - s1 * s1), (b * s2) / Math.abs(w0s - s2 * s2)), w1: p1, w2: p2 };
    }
  }
}

/** Minimum prototype order meeting ripple / attenuation at the stop edge. */
export function chebyshevOrder(spec: ChebyshevSpec): number {
  if (!(spec.ripple > 0)) throw new Error('CHEBYSHEV: the passband ripple must be > 0 dB');
  if (!(spec.atten > spec.ripple)) throw new Error('CHEBYSHEV: the stop attenuation must exceed the ripple');
  const { omegaS } = stopEdge(spec);
  if (!(omegaS > 1)) throw new Error('CHEBYSHEV: the stop band must lie outside the pass band');
  const eps2 = Math.pow(10, spec.ripple / 10) - 1;
  const n = Math.acosh(Math.sqrt((Math.pow(10, spec.atten / 10) - 1) / eps2)) / Math.acosh(omegaS);
  const order = Math.max(1, Math.ceil(n - 1e-9));
  if (order > 20) throw new Error(`CHEBYSHEV: order ${order} is too high (at most 20); widen the transition band`);
  return order;
}

/** Design the filter (see the module comment). */
export function designChebyshev(spec: ChebyshevSpec): ChebyshevDesign {
  const n = chebyshevOrder(spec);
  const eps = Math.sqrt(Math.pow(10, spec.ripple / 10) - 1);
  const a = Math.asinh(1 / eps) / n;
  // prototype poles in the upper half plane (k = 1..⌈n/2⌉); the real one for odd n is last
  const upper: C[] = [];
  let real: number | undefined;
  for (let k = 1; k <= n; k++) {
    const th = ((2 * k - 1) * Math.PI) / (2 * n);
    const p: C = { re: -Math.sinh(a) * Math.sin(th), im: Math.cosh(a) * Math.cos(th) };
    if (Math.abs(p.im) < 1e-12 * Math.abs(p.re)) real = p.re;
    else if (p.im > 0) upper.push(p);
  }
  const { w1, w2 } = stopEdge(spec);
  const sections: Rational[] = [];
  const w0s = w1 * w2;
  const bw = w2 - w1;
  switch (spec.kind) {
    case 'LP':
      for (const p of upper) sections.push({ num: [1], den: quadOf({ re: p.re * w1, im: p.im * w1 }) });
      if (real !== undefined) sections.push({ num: [1], den: [-real * w1, 1] });
      break;
    case 'HP':
      // s → ωp/s maps a pole p to ωp/p and adds zeros at the origin
      for (const p of upper) sections.push({ num: [0, 0, 1], den: quadOf(cdiv({ re: w1, im: 0 }, p)) });
      if (real !== undefined) sections.push({ num: [0, 1], den: [-w1 / real, 1] });
      break;
    case 'BP':
    case 'BR': {
      // BP: roots of s² − p·B·s + ω0²;  BR: roots of s² − (B/p)·s + ω0²
      const map = (p: C): [C, C] => {
        const b: C = spec.kind === 'BP' ? { re: p.re * bw, im: p.im * bw } : cdiv({ re: bw, im: 0 }, p);
        const disc = csqrt(csub(cmul(b, b), { re: 4 * w0s, im: 0 }));
        return [
          { re: (b.re + disc.re) / 2, im: (b.im + disc.im) / 2 },
          { re: (b.re - disc.re) / 2, im: (b.im - disc.im) / 2 },
        ];
      };
      const zeros = spec.kind === 'BP' ? [0, 1] : [w0s, 0, 1];
      for (const p of upper) for (const r of map(p)) sections.push({ num: zeros, den: quadOf(r) });
      if (real !== undefined) {
        const b = spec.kind === 'BP' ? real * bw : bw / real;
        // s² − b s + ω0²: real coefficients whatever the roots are
        sections.push({ num: zeros, den: [w0s, -b, 1] });
      }
      break;
    }
  }
  // gain: passband peak 0 dB (reference point gain 1, or 1/√(1+ε²) for even orders)
  const target = n % 2 === 1 ? 1 : 1 / Math.sqrt(1 + eps * eps);
  let ref: number;
  if (spec.kind === 'HP') {
    ref = sections.reduce((g, sec) => g * (sec.num[sec.num.length - 1] / sec.den[sec.den.length - 1]), 1);
  } else {
    const h = cascadeAt(sections, { re: 0, im: spec.kind === 'BP' ? Math.sqrt(w0s) : 0 });
    ref = Math.hypot(h.re, h.im);
  }
  const k = Math.pow(target / ref, 1 / sections.length);
  for (const sec of sections) sec.num = sec.num.map((c) => c * k);
  return { order: n, epsilon: eps, sections };
}
