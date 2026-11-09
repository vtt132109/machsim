/**
 * Forward-mode dual numbers for compact-model cores (MOSFET level 2, BSIM3).
 *
 * A `Dual` carries a value and its partial derivatives with respect to the three controlling
 * voltages of a four-terminal device (vgs, vds, vbs, in that order: fields g, d, b). Evaluating a
 * model equation with duals gives the conductances gm, gds, gmbs (or the transcapacitances of a
 * terminal charge) as exact derivatives of the evaluated expression, so the Newton Jacobian always
 * matches the current that is stamped, region by region.
 *
 * The helpers allocate a new object per operation; model cores evaluate a few hundred operations
 * per call, which is cheap compared with the sparse solve.
 */

/** A value with its partial derivatives w.r.t. vgs (g), vds (d) and vbs (b). */
export interface Dual {
  v: number;
  g: number;
  d: number;
  b: number;
}

export const dual = (v: number, g = 0, d = 0, b = 0): Dual => ({ v, g, d, b });
export const dconst = (v: number): Dual => ({ v, g: 0, d: 0, b: 0 });
export const add = (x: Dual, y: Dual): Dual => dual(x.v + y.v, x.g + y.g, x.d + y.d, x.b + y.b);
export const sub = (x: Dual, y: Dual): Dual => dual(x.v - y.v, x.g - y.g, x.d - y.d, x.b - y.b);
export const neg = (x: Dual): Dual => dual(-x.v, -x.g, -x.d, -x.b);
export const scale = (x: Dual, k: number): Dual => dual(x.v * k, x.g * k, x.d * k, x.b * k);
export const addc = (x: Dual, k: number): Dual => dual(x.v + k, x.g, x.d, x.b);
export const mul = (x: Dual, y: Dual): Dual => dual(x.v * y.v, x.g * y.v + x.v * y.g, x.d * y.v + x.v * y.d, x.b * y.v + x.v * y.b);
export const div = (x: Dual, y: Dual): Dual => {
  const iv = 1 / y.v;
  const q = x.v * iv;
  return dual(q, (x.g - q * y.g) * iv, (x.d - q * y.d) * iv, (x.b - q * y.b) * iv);
};
/** 1 / x */
export const inv = (x: Dual): Dual => {
  const iv = 1 / x.v;
  const k = -iv * iv;
  return dual(iv, k * x.g, k * x.d, k * x.b);
};
/** f(x) given f = value and df = derivative at x. */
export const chain = (x: Dual, f: number, df: number): Dual => dual(f, df * x.g, df * x.d, df * x.b);
export const dsqrt = (x: Dual): Dual => {
  const s = Math.sqrt(Math.max(x.v, 0));
  return chain(x, s, s > 0 ? 0.5 / s : 0);
};
/** exp with the argument clamped at 80 (derivative continues the clamp value). */
export const dexp = (x: Dual): Dual => {
  const e = Math.exp(Math.min(x.v, 80));
  return chain(x, e, e);
};
export const dlog = (x: Dual): Dual => chain(x, Math.log(x.v), 1 / x.v);
/** x^p for x > 0 */
export const dpow = (x: Dual, p: number): Dual => {
  const f = Math.pow(x.v, p);
  return chain(x, f, x.v !== 0 ? (p * f) / x.v : 0);
};
export const dmax = (x: Dual, y: Dual): Dual => (x.v >= y.v ? x : y);
export const dmin = (x: Dual, y: Dual): Dual => (x.v <= y.v ? x : y);
/** ln(1 + e^x) without overflow. */
export const dsoftplus = (x: Dual): Dual => {
  if (x.v > 40) return x;
  if (x.v < -40) {
    const e = Math.exp(x.v);
    return chain(x, e, e);
  }
  const e = Math.exp(x.v);
  return chain(x, Math.log1p(e), e / (1 + e));
};
