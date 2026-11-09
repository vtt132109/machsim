/**
 * Matching-network designer of the network analyzer (pure; amplifier design with S-parameters as
 * in the standard microwave-engineering textbooks):
 *
 * - Stability: Rollett K and |Δ| (network.ts), the Edwards–Sinsky μ test
 *   μ = (1 − |S11|²)/(|S22 − Δ·S11*| + |S12·S21|) > 1 ⇔ unconditionally stable, and the input
 *   (source) / output (load) stability circles in the Γ plane:
 *     C_L = (S22 − Δ·S11*)* / (|S22|² − |Δ|²),  r_L = |S12·S21| / ||S22|² − |Δ|²|
 *     C_S = (S11 − Δ·S22*)* / (|S11|² − |Δ|²),  r_S = |S12·S21| / ||S11|² − |Δ|²|
 *   On the circle |Γin| = 1 (load circle) or |Γout| = 1 (source circle); `stableInside` tells which
 *   side is stable (the side containing Γ = 0 when |S11| < 1, respectively |S22| < 1).
 * - Simultaneous conjugate match (K > 1): Γ_S = (B1 − √(B1² − 4|C1|²))/(2C1) with
 *   B1 = 1 + |S11|² − |S22|² − |Δ|², C1 = S11 − Δ·S22* (and the same with 1 ↔ 2 for Γ_L).
 * - Unilateral design (S12 ≈ 0): constant-gain circles of the source and load sections,
 *   g = G/Gmax, Gmax = 1/(1 − |S11|²):  centre g·conj(S11)/(1 − (1 − g)|S11|²),
 *   radius √(1 − g)·(1 − |S11|²)/(1 − (1 − g)|S11|²); unilateral figure of merit U and its
 *   error bounds 1/(1 + U)² < GT/GTU < 1/(1 − U)².
 * - Lumped L-section matching of a load ZL to a real resistance R0 (two solutions, element
 *   values at frequency f): shunt-first when RL > R0, series-first otherwise.
 */
import { c, cabs, cadd, cdiv, cmul, cscale, csub, gammaToZ, rollett, type Complex, type TwoPort } from './network';

export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

export interface GammaCircle {
  center: Complex;
  radius: number;
}

export interface StabilityCircles {
  load: GammaCircle & { stableInside: boolean };
  source: GammaCircle & { stableInside: boolean };
  k: number;
  delta: number;
  mu: number;
  unconditional: boolean;
}

function det(s: TwoPort): Complex {
  return csub(cmul(s.p11, s.p22), cmul(s.p12, s.p21));
}

/** Input reflection coefficient with load Γ_L: S11 + S12·S21·Γ_L/(1 − S22·Γ_L). */
export function gammaIn(s: TwoPort, gl: Complex): Complex {
  return cadd(s.p11, cdiv(cmul(cmul(s.p12, s.p21), gl), csub(c(1), cmul(s.p22, gl))));
}

/** Output reflection coefficient with source Γ_S. */
export function gammaOut(s: TwoPort, gs: Complex): Complex {
  return cadd(s.p22, cdiv(cmul(cmul(s.p12, s.p21), gs), csub(c(1), cmul(s.p11, gs))));
}

/** Stability circles, K, |Δ| and μ of a two-port. */
export function stabilityCircles(s: TwoPort): StabilityCircles {
  const d = det(s);
  const ad2 = cabs(d) ** 2;
  const s11 = cabs(s.p11);
  const s22 = cabs(s.p22);
  const k12 = cabs(cmul(s.p12, s.p21));
  const loadCenter = cscale(conj(csub(s.p22, cmul(d, conj(s.p11)))), 1 / (s22 * s22 - ad2));
  const loadRadius = k12 / Math.abs(s22 * s22 - ad2);
  const sourceCenter = cscale(conj(csub(s.p11, cmul(d, conj(s.p22)))), 1 / (s11 * s11 - ad2));
  const sourceRadius = k12 / Math.abs(s11 * s11 - ad2);
  // Γ = 0 is stable when |S11| < 1 (load plane) / |S22| < 1 (source plane)
  const originInsideLoad = cabs(loadCenter) < loadRadius;
  const originInsideSource = cabs(sourceCenter) < sourceRadius;
  const loadStableInside = s11 < 1 ? originInsideLoad : !originInsideLoad;
  const sourceStableInside = s22 < 1 ? originInsideSource : !originInsideSource;
  const mu = (1 - s11 * s11) / (cabs(csub(s.p22, cmul(d, conj(s.p11)))) + k12);
  const st = rollett(s);
  return {
    load: { center: loadCenter, radius: loadRadius, stableInside: loadStableInside },
    source: { center: sourceCenter, radius: sourceRadius, stableInside: sourceStableInside },
    k: st.k,
    delta: st.delta,
    mu,
    unconditional: mu > 1,
  };
}

export interface ConjugateMatch {
  gs: Complex;
  gl: Complex;
  /** transducer gain with both matches (= MAG), linear */
  gain: number;
}

/** Simultaneous conjugate match (needs K > 1 and |Δ| < 1), else null. */
export function conjugateMatch(s: TwoPort): ConjugateMatch | null {
  const st = rollett(s);
  if (!(st.k > 1 && st.delta < 1)) return null;
  const d = det(s);
  const ad2 = cabs(d) ** 2;
  const s11 = cabs(s.p11) ** 2;
  const s22 = cabs(s.p22) ** 2;
  const solve = (b: number, cc: Complex): Complex => {
    const r = Math.sqrt(Math.max(0, b * b - 4 * cabs(cc) ** 2));
    // the root inside the unit circle
    const g1 = cscale(cdiv(c(b - r), cc), 0.5);
    const g2 = cscale(cdiv(c(b + r), cc), 0.5);
    return cabs(g1) < 1 ? g1 : g2;
  };
  const gs = solve(1 + s11 - s22 - ad2, csub(s.p11, cmul(d, conj(s.p22))));
  const gl = solve(1 + s22 - s11 - ad2, csub(s.p22, cmul(d, conj(s.p11))));
  return { gs, gl, gain: transducerGain(s, gs, gl) };
}

/** Transducer power gain GT with source Γ_S and load Γ_L. */
export function transducerGain(s: TwoPort, gs: Complex, gl: Complex): number {
  const gin = gammaIn(s, gl);
  const num = (1 - cabs(gs) ** 2) * cabs(s.p21) ** 2 * (1 - cabs(gl) ** 2);
  const den = cabs(csub(c(1), cmul(gs, gin))) ** 2 * cabs(csub(c(1), cmul(s.p22, gl))) ** 2;
  return num / den;
}

/** Gain of the unilateral source section GS(Γ_S) = (1 − |Γ_S|²)/|1 − S11·Γ_S|². */
export function unilateralSectionGain(sii: Complex, g: Complex): number {
  return (1 - cabs(g) ** 2) / cabs(csub(c(1), cmul(sii, g))) ** 2;
}

/** Maximum gain of a unilateral section 1/(1 − |Sii|²) (linear). */
export function unilateralMax(sii: Complex): number {
  return 1 / (1 - cabs(sii) ** 2);
}

/** Constant-gain circle of a unilateral section for gain `gainLinear` (≤ the maximum). */
export function unilateralGainCircle(sii: Complex, gainLinear: number): GammaCircle | null {
  const a = cabs(sii) ** 2;
  if (!(a < 1)) return null;
  const g = gainLinear * (1 - a);
  if (!(g > 0 && g <= 1 + 1e-12)) return null;
  const den = 1 - (1 - g) * a;
  return { center: cscale(conj(sii), g / den), radius: (Math.sqrt(Math.max(0, 1 - g)) * (1 - a)) / den };
}

/** Unilateral figure of merit U and the GT/GTU error bounds (dB). */
export function unilateralFigure(s: TwoPort): { u: number; lowDb: number; highDb: number } {
  const u = (cabs(s.p12) * cabs(s.p21) * cabs(s.p11) * cabs(s.p22)) / ((1 - cabs(s.p11) ** 2) * (1 - cabs(s.p22) ** 2));
  return { u, lowDb: 10 * Math.log10(1 / (1 + u) ** 2), highDb: u < 1 ? 10 * Math.log10(1 / (1 - u) ** 2) : Number.POSITIVE_INFINITY };
}

export interface LumpedElement {
  /** position seen from the load: the element next to the load first */
  position: 'series' | 'shunt';
  kind: 'L' | 'C';
  /** H or F */
  value: number;
  /** reactance (series) or susceptance (shunt) at the design frequency */
  x: number;
}

export interface LNetwork {
  /** elements from the load towards the R0 side */
  elements: LumpedElement[];
  /** 'shunt-first': shunt element across the load, then series; 'series-first' the other way */
  topology: 'shunt-first' | 'series-first';
}

function elementFor(position: 'series' | 'shunt', v: number, w: number): LumpedElement | null {
  if (Math.abs(v) < 1e-15) return null;
  if (position === 'series') return v > 0 ? { position, kind: 'L', value: v / w, x: v } : { position, kind: 'C', value: -1 / (w * v), x: v };
  return v > 0 ? { position, kind: 'C', value: v / w, x: v } : { position, kind: 'L', value: -1 / (w * v), x: v };
}

/**
 * L-section networks matching `zl` to the real resistance `r0` at frequency `f` (0, 1 or 2
 * solutions; a purely resistive match returns a single empty network).
 */
export function lMatch(zl: Complex, r0: number, f: number): LNetwork[] {
  const w = 2 * Math.PI * f;
  const rl = zl.re;
  const xl = zl.im;
  if (!(rl > 0 && r0 > 0 && f > 0)) return [];
  if (Math.abs(rl - r0) < 1e-12 * r0 && Math.abs(xl) < 1e-12 * r0) return [{ elements: [], topology: 'series-first' }];
  const out: LNetwork[] = [];
  if (rl > r0) {
    // shunt susceptance B across the load, then series reactance X
    const mag = rl * rl + xl * xl;
    const root = Math.sqrt(rl / r0) * Math.sqrt(Math.max(0, mag - r0 * rl));
    for (const sgn of [1, -1]) {
      const b = (xl + sgn * root) / mag;
      const x = 1 / b + (xl * r0) / rl - r0 / (b * rl);
      const els = [elementFor('shunt', b, w), elementFor('series', x, w)].filter((e): e is LumpedElement => e !== null);
      out.push({ elements: els, topology: 'shunt-first' });
    }
  } else {
    // series reactance X next to the load, then shunt susceptance B
    const root = Math.sqrt(rl * (r0 - rl));
    for (const sgn of [1, -1]) {
      const x = sgn * root - xl;
      const b = (sgn * Math.sqrt((r0 - rl) / rl)) / r0;
      const els = [elementFor('series', x, w), elementFor('shunt', b, w)].filter((e): e is LumpedElement => e !== null);
      out.push({ elements: els, topology: 'series-first' });
    }
  }
  return out;
}

/** Impedance looking into an L-network (from the R0 side) terminated by `zl`, at frequency f. */
export function networkInputImpedance(net: LNetwork, zl: Complex, f: number): Complex {
  const w = 2 * Math.PI * f;
  let z = zl;
  for (const e of net.elements) {
    const ze = e.kind === 'L' ? c(0, w * e.value) : c(0, -1 / (w * e.value));
    z = e.position === 'series' ? cadd(z, ze) : cdiv(cmul(z, ze), cadd(z, ze));
  }
  return z;
}

/**
 * Networks presenting the reflection coefficient `g` (reference r0) to the device: they match
 * the load Z = conj(Z(g)) to r0, so that looking back from the device one sees Z(g).
 */
export function matchToGamma(g: Complex, r0: number, f: number): LNetwork[] {
  return lMatch(conj(gammaToZ(g, r0)), r0, f);
}

/** Points of a circle in the Γ plane (for drawing). */
export function circlePoints(circle: GammaCircle, n = 180): Complex[] {
  const out: Complex[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push({ re: circle.center.re + circle.radius * Math.cos(a), im: circle.center.im + circle.radius * Math.sin(a) });
  }
  return out;
}
