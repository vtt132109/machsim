/**
 * Convolution kernels of the lossy transmission line (LTRA, ltra.ts).
 *
 * A uniform line of length len with series R, L and shunt C per metre (G = 0) is a two-port with
 *   I1 = Y0 V1 - H (Y0 V2 + I2),   I2 = Y0 V2 - H (Y0 V1 + I1)
 * (port currents into the line), characteristic admittance Y0(s) and propagation H(s) = e^-gamma len.
 * In the time domain each product is a convolution with an impulse response. For a piecewise-linear
 * input x (knots t_j, values x_j, constant before t_0) a convolution is exact when written with the
 * kernel's ramp response K2(u) = L^-1{F(s)/s^2}:
 *   (f * x)(t_n) = F(0) x_0 + sum_j s_j [K2(t_n - t_j) - K2(t_n - t_j+1)],  s_j = slope on [t_j, t_j+1].
 * The RC kernels are used in that form (K2 and the step response K1 = K2'):
 *
 * RLC line, alpha = R/(2L), T = len sqrt(LC), Yinf = sqrt(C/L) (published telegrapher results):
 *   y0(t)  = Yinf [ delta(t) - alpha e^-at (I0(at) - I1(at)) ]
 *   h(t)   = e^-aT delta(t - T) + alpha T e^-at I1(a w)/w,                          w = sqrt(t^2 - T^2), t > T
 *   hy0(t) = Yinf [ e^-aT delta(t - T) + alpha e^-at (t I1(a w)/w - I0(a w)) ],     t > T
 *   For the simulation the regular parts are written as exponential sums (rlcExponentials, from
 *   their branch-cut representation), so ltra.ts convolves recursively at O(1) cost per step. The
 *   closed forms (rlcKernelFunctions) use the Abramowitz & Stegun 9.8 polynomial approximations of
 *   the Bessel functions (relative error < 3e-7) in exponentially scaled form, and the asymptotic
 *   series for e^-x (I0 - I1) at large x, so nothing overflows; they serve as the reference.
 * RC line, a = len sqrt(RC), Yc = sqrt(C/R): the admittance form I1 = y11 V1 + y12 V2 (only
 *   voltages are convolved), with exact image / modal series for the ramp responses (rcYKernels).
 * LC line: pure delays (the RLC forms with alpha = 0).
 */

/** Complementary error function (series below 2.5, continued fraction above; ~1e-14). */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) {
    // erf series: 2/sqrt(pi) sum (-1)^n x^(2n+1) / (n! (2n+1))
    let term = x;
    let sum = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // Lentz continued fraction: erfc(x) = e^-x^2/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))
  const tiny = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let k = 1; k < 300; k++) {
    const an = k / 2;
    d = x + an * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = x + an / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

const I0S = [1, 3.5156229, 3.0899424, 1.2067492, 0.2659732, 0.0360768, 0.0045813];
const I0L = [0.39894228, 0.01328592, 0.00225319, -0.00157565, 0.00916281, -0.02057706, 0.02635537, -0.01647633, 0.00392377];
const I1S = [0.5, 0.87890594, 0.51498869, 0.15084934, 0.02658733, 0.00301532, 0.00032411];
const I1L = [0.39894228, -0.03988024, -0.00362018, 0.00163801, -0.01031555, 0.02282967, -0.02895312, 0.01787654, -0.00420059];

function poly(c: readonly number[], t: number): number {
  let s = 0;
  for (let k = c.length - 1; k >= 0; k--) s = s * t + c[k];
  return s;
}

/** e^-x I0(x), x >= 0. */
export function i0e(x: number): number {
  if (x <= 3.75) {
    const t = (x / 3.75) ** 2;
    return Math.exp(-x) * poly(I0S, t);
  }
  return poly(I0L, 3.75 / x) / Math.sqrt(x);
}

/** e^-x I1(x), x >= 0. */
export function i1e(x: number): number {
  if (x <= 3.75) {
    const t = (x / 3.75) ** 2;
    return Math.exp(-x) * x * poly(I1S, t);
  }
  return poly(I1L, 3.75 / x) / Math.sqrt(x);
}

/** I1(x)/x (finite at 0), for x <= 3.75. */
function i1OverX(x: number): number {
  return poly(I1S, (x / 3.75) ** 2);
}

/** e^-x (I0(x) - I1(x)), computed without cancellation at large x. */
export function e01(x: number): number {
  if (x < 40) return i0e(x) - i1e(x);
  // asymptotic: (1/(2x) + 3/(16x^2) + 45/(256x^3) + 1575/(8192 x^4)) / sqrt(2 pi x)
  const ix = 1 / x;
  return ((((1575 / 8192) * ix + 45 / 256) * ix + 3 / 16) * ix + 0.5) * ix / Math.sqrt(2 * Math.PI * x);
}

/** A kernel's ramp response K2(u) and step response K1(u). */
export interface RampResponse {
  /** DC gain F(0) = K1(infinity) */
  readonly f0: number;
  k2(u: number): number;
  k1(u: number): number;
}

/** One exponential term a * exp(-p t') of a kernel's regular part (t' = time since the kernel starts). */
export interface ExpTerm {
  p: number;
  a: number;
}

/** Closed-form regular parts of the RLC kernels (t in seconds; zero before their start). */
export interface RlcKernelFunctions {
  yinf: number;
  alpha: number;
  delay: number;
  y0reg(t: number): number;
  hreg(t: number): number;
  hy0reg(t: number): number;
}

/** The RLC (G = 0) kernels in closed form (Bessel functions), see the module comment. */
export function rlcKernelFunctions(r: number, l: number, c: number, len: number): RlcKernelFunctions {
  const alpha = r / (2 * l);
  const T = len * Math.sqrt(l * c);
  const yinf = Math.sqrt(c / l);
  return {
    yinf,
    alpha,
    delay: T,
    y0reg: (t) => (t < 0 ? 0 : -yinf * alpha * e01(alpha * t)),
    hreg: (t) => {
      if (t <= T) return 0;
      const w = Math.sqrt(t * t - T * T);
      const x = alpha * w;
      if (x <= 3.75) return alpha * T * alpha * i1OverX(x) * Math.exp(-alpha * t);
      return (alpha * T * i1e(x) * Math.exp(alpha * (w - t))) / w;
    },
    hy0reg: (t) => {
      if (t <= T) return 0;
      const w = Math.sqrt(t * t - T * T);
      const x = alpha * w;
      if (x <= 3.75) return yinf * alpha * Math.exp(-alpha * t) * (t * alpha * i1OverX(x) - i0e(x) * Math.exp(x));
      // t I1/w - I0 = (t/w - 1) I1 - (I0 - I1), t/w - 1 = T^2 / (w (t + w))
      const k = (T * T) / (w * (t + w));
      return yinf * alpha * Math.exp(alpha * (w - t)) * (k * i1e(x) - e01(x));
    },
  };
}

/** Exponential-sum form of the RLC kernels used by the recursive convolution in ltra.ts. */
export interface RlcExpKernels {
  yinf: number;
  alpha: number;
  delay: number;
  /** e^-alpha T: weight of the delayed impulse in h (and, times yinf, in hy0) */
  eaT: number;
  y0: ExpTerm[];
  h: ExpTerm[];
  hy0: ExpTerm[];
}

const GL6_X = [-0.9324695142031521, -0.6612093864662645, -0.2386191860831969, 0.2386191860831969, 0.6612093864662645, 0.9324695142031521];
const GL6_W = [0.1713244923791704, 0.3607615730481386, 0.467913934572691, 0.467913934572691, 0.3607615730481386, 0.1713244923791704];

/**
 * Exponential sums of the RLC regular kernels from their branch-cut representation. Every regular
 * part has a Laplace transform analytic except for a cut on [-2 alpha, 0], so
 *   f(t') = integral_0^pi W(theta) exp(-sigma t') dtheta,   sigma = alpha (1 - cos theta), q = alpha sin theta
 *   y0reg:  W = -(Yinf/pi) sigma                                   (t' = t)
 *   hreg:   W =  (1/pi) e^(-T sigma) sin(T q) q                    (t' = t - T)
 *   hy0reg: W = -(Yinf/pi) e^(-T sigma) cos(T q) sigma             (t' = t - T)
 * The theta integral is evaluated with 6-point Gauss-Legendre panels: doubling panels from
 * 2e-5 (decay rates down to 2e-10 alpha, i.e. the slow t^-3/2 tails up to ~1e9/alpha) to 0.5,
 * then panels of width <= 0.25 (narrower when the sine / cosine of T q oscillates), stopping where
 * e^(-T sigma) < 1e-14. Each node is one term a e^(-p t'); the DC gains are reproduced to the
 * quadrature accuracy (exactly for y0: sum a/p = -Yinf).
 */
export function rlcExponentials(r: number, l: number, c: number, len: number): RlcExpKernels {
  const alpha = r / (2 * l);
  const T = len * Math.sqrt(l * c);
  const yinf = Math.sqrt(c / l);
  const eaT = Math.exp(-alpha * T);
  if (!(alpha > 0)) return { yinf, alpha: 0, delay: T, eaT: 1, y0: [], h: [], hy0: [] };
  const edges = (oscillating: boolean): number[] => {
    const e = [0];
    for (let th = 2e-5; th < 0.5; th *= 2) e.push(th);
    let stop = Math.PI;
    if (oscillating && T > 0) {
      const sig = 32 / T;
      if (sig < 2 * alpha) stop = Math.acos(1 - sig / alpha);
    }
    while (e.length > 1 && e[e.length - 1] >= stop) e.pop();
    const a = e[e.length - 1];
    const width = oscillating ? Math.min(0.25, 1.5 / (alpha * T + 1)) : 0.25;
    const n = Math.max(1, Math.min(400, Math.ceil((stop - a) / width)));
    for (let k = 1; k <= n; k++) e.push(a + ((stop - a) * k) / n);
    return e;
  };
  const build = (w: (theta: number, sigma: number) => number, oscillating: boolean): ExpTerm[] => {
    const out: ExpTerm[] = [];
    const e = edges(oscillating);
    for (let i = 0; i + 1 < e.length; i++) {
      const half = (e[i + 1] - e[i]) / 2;
      const mid = (e[i + 1] + e[i]) / 2;
      for (let k = 0; k < 6; k++) {
        const th = mid + half * GL6_X[k];
        const sigma = alpha * (1 - Math.cos(th));
        const a = GL6_W[k] * half * w(th, sigma);
        if (a !== 0 && sigma > 0) out.push({ p: sigma, a });
      }
    }
    return out;
  };
  return {
    yinf,
    alpha,
    delay: T,
    eaT,
    y0: build((_th, sigma) => (-yinf / Math.PI) * sigma, false),
    h: build((th, sigma) => (1 / Math.PI) * Math.exp(-T * sigma) * Math.sin(T * alpha * Math.sin(th)) * alpha * Math.sin(th), true),
    hy0: build((th, sigma) => (-yinf / Math.PI) * Math.exp(-T * sigma) * Math.cos(T * alpha * Math.sin(th)) * sigma, true),
  };
}

/** Value of an exponential sum at t' >= 0. */
export function expSum(terms: readonly ExpTerm[], t: number): number {
  let s = 0;
  for (const e of terms) s += e.a * Math.exp(-e.p * t);
  return s;
}

/** DC gain of an exponential sum, sum a/p. */
export function expSumGain(terms: readonly ExpTerm[]): number {
  let s = 0;
  for (const e of terms) s += e.a / e.p;
  return s;
}

/**
 * Integrals of e^-p tau over one interval of length dt for a linear input: E0 = int e^-p tau,
 * E1 = int tau e^-p tau (tau from 0 to dt), with series for small p dt.
 */
export function expIntervalWeights(p: number, dt: number): { decay: number; e0: number; e1: number } {
  const x = p * dt;
  const decay = Math.exp(-x);
  if (x < 1e-4) {
    return { decay, e0: dt * (1 - x / 2 + (x * x) / 6), e1: dt * dt * (0.5 - x / 3 + (x * x) / 8) };
  }
  const em = -Math.expm1(-x);
  return { decay, e0: em / p, e1: (em - x * decay) / (p * p) };
}

/** Ramp response of the image term b: L^-1{sqrt(s) e^(-b sqrt s) / s^2} = 2 sqrt(u/pi) e^(-b^2/4u) - b erfc(b / 2 sqrt u). */
function imageRamp(b: number, u: number): number {
  const z = b / (2 * Math.sqrt(u));
  return 2 * Math.sqrt(u / Math.PI) * Math.exp(-z * z) - b * erfc(z);
}

/**
 * Admittance kernels of a distributed RC line (L = 0, G = 0): I1 = y11 V1 + y12 V2,
 * I2 = y12 V1 + y11 V2 with y11 = Yc sqrt(s) coth(a sqrt s), y12 = -Yc sqrt(s) / sinh(a sqrt s),
 * a = LEN sqrt(RC), Yc = sqrt(C/R). Written with voltages only, so the singular input current of a
 * driven RC line never has to be interpolated. Ramp responses in two exact series:
 *   u <= 0.1 a^2 (images):  K2_11 = Yc [2 sqrt(u/pi) + 2 sum_k>=1 P(2k a, u)],  K2_12 = -2 Yc sum_k>=0 P((2k+1) a, u)
 *   u >  0.1 a^2 (modes):   K2_11 = Yc [u/a + a/3 - sum_n 2a/(n pi)^2 e^(-lambda_n u)],
 *                           K2_12 = -Yc [u/a - a/6 - sum_n (-1)^n 2a/(n pi)^2 e^(-lambda_n u)],  lambda_n = (n pi / a)^2
 * with P(b, u) = 2 sqrt(u/pi) e^(-b^2/4u) - b erfc(b/(2 sqrt u)). DC gains: y11(0) = -y12(0) = 1/(R LEN).
 */
export function rcYKernels(r: number, c: number, len: number): { y11: RampResponse; y12: RampResponse } {
  const a = len * Math.sqrt(r * c);
  const yc = Math.sqrt(c / r);
  const tau = a * a;
  const switchAt = 0.1 * tau;
  const TERMS = 12;
  const y11: RampResponse = {
    f0: yc / a,
    k2: (u) => {
      if (!(u > 0)) return 0;
      if (u <= switchAt) {
        let s = 2 * Math.sqrt(u / Math.PI);
        for (let k = 1; k <= TERMS; k++) s += 2 * imageRamp(2 * k * a, u);
        return yc * s;
      }
      let s = u / a + a / 3;
      for (let n = 1; n <= TERMS; n++) s -= ((2 * a) / (n * n * Math.PI * Math.PI)) * Math.exp(-((n * Math.PI) ** 2) * (u / tau));
      return yc * s;
    },
    k1: (u) => {
      if (!(u > 0)) return 0;
      if (u <= switchAt) {
        let s = 1;
        for (let k = 1; k <= TERMS; k++) s += 2 * Math.exp((-k * k * tau) / u);
        return (yc * s) / Math.sqrt(Math.PI * u);
      }
      let s = 1 / a;
      for (let n = 1; n <= TERMS; n++) s += (2 / a) * Math.exp(-((n * Math.PI) ** 2) * (u / tau));
      return yc * s;
    },
  };
  const y12: RampResponse = {
    f0: -yc / a,
    k2: (u) => {
      if (!(u > 0)) return 0;
      if (u <= switchAt) {
        let s = 0;
        for (let k = 0; k <= TERMS; k++) s += imageRamp((2 * k + 1) * a, u);
        return -2 * yc * s;
      }
      let s = u / a - a / 6;
      for (let n = 1; n <= TERMS; n++) s -= ((n % 2 ? -1 : 1) * (2 * a)) / (n * n * Math.PI * Math.PI) * Math.exp(-((n * Math.PI) ** 2) * (u / tau));
      return -yc * s;
    },
    k1: (u) => {
      if (!(u > 0)) return 0;
      if (u <= switchAt) {
        let s = 0;
        for (let k = 0; k <= TERMS; k++) s += Math.exp((-((2 * k + 1) ** 2) * tau) / (4 * u));
        return (-2 * yc * s) / Math.sqrt(Math.PI * u);
      }
      let s = 1 / a;
      for (let n = 1; n <= TERMS; n++) s += ((n % 2 ? -1 : 1) * 2) / a * Math.exp(-((n * Math.PI) ** 2) * (u / tau));
      return -yc * s;
    },
  };
  return { y11, y12 };
}
