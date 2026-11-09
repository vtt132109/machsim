/**
 * Shared building blocks for the semiconductor device models (D, Q, J, M, Z).
 *
 * Contents
 * - Physical/numerical constants and an overflow-safe exponential.
 * - Newton step limiting: `pnjlim` (pn junctions), `fetlim` (FET gate voltage), `limvds`
 *   (FET drain-source voltage). These are the classic SPICE3 heuristics, re-implemented here.
 * - Temperature helpers: silicon band gap, junction potential / capacitance scaling.
 * - Depletion charge with the SPICE forward-bias linearisation above FC*VJ.
 * - MNA stamping helpers working on the contract `LoadContext` / `AcContext`.
 * - Model-card parameter resolution with defaults, aliases and "unknown parameter" reporting.
 *
 * Conventions used by every model in this folder
 * - Junction voltages and currents are evaluated in *device polarity*: for P-type devices
 *   (PNP, PJF, PMOS, PMF) every terminal voltage difference is multiplied by `type = -1`
 *   before evaluation and every resulting current is multiplied by `type` before stamping.
 *   Conductances (partial derivatives) are polarity independent.
 * - A nonlinear branch current i (flowing from node a to node b through the device) with
 *   partial derivatives g_k w.r.t. controlling voltages v_k = V(p_k) - V(n_k) is stamped as
 *   conductance terms g_k plus the Newton companion current ieq = i - sum(g_k * v_k).
 */

import { BOLTZ, CHARGE, KELVIN, type AcContext, type LoadContext, type SetupContext } from '../../device';
import type { ModelCard } from '../../netlist';

/** SPICE reference temperature for the band-gap / junction-potential formulas (27 °C), kelvin. */
export const REFTEMP = 300.15;
/** Largest exponent evaluated exactly; above it exp() is continued linearly (C1 smooth). */
export const MAX_EXP_ARG = 80;
const EXP_MAX = Math.exp(MAX_EXP_ARG);

/** Boltzmann constant over electron charge, V/K. */
export const K_OVER_Q = BOLTZ / CHARGE;

export function celsiusToKelvin(c: number): number {
  return c + KELVIN;
}

/** exp(x) for x <= MAX_EXP_ARG, continued linearly above (value and slope continuous). */
export function expLin(x: number): number {
  return x <= MAX_EXP_ARG ? Math.exp(x) : EXP_MAX * (1 + x - MAX_EXP_ARG);
}

/** Derivative of expLin(x). */
export function expLinDeriv(x: number): number {
  return x <= MAX_EXP_ARG ? Math.exp(x) : EXP_MAX;
}

// ---------------------------------------------------------------------------------------------
// Newton step limiting
// ---------------------------------------------------------------------------------------------

/**
 * Critical voltage of a junction: above it the exponential is steep enough that Newton steps
 * must be limited. vcrit = vt * ln(vt / (sqrt(2) * isat)).
 */
export function junctionVcrit(vt: number, isat: number): number {
  if (!(isat > 0)) return 1e30;
  return vt * Math.log(vt / (Math.SQRT2 * isat));
}

/**
 * Limit the change of a pn-junction voltage between Newton iterations (SPICE3 pnjlim).
 * Above vcrit, a step larger than 2*vt is replaced by a logarithmic step so the exponential
 * current cannot overflow. Returns the (possibly) limited voltage; the caller detects limiting
 * by comparing it with `vnew`.
 */
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > vt + vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  return vnew;
}

/**
 * Limit the change of a FET gate-source (or gate-drain) voltage relative to the threshold
 * `vto` (SPICE3 fetlim): large swings across the threshold are broken into bounded steps.
 */
export function fetlim(vnew: number, vold: number, vto: number): number {
  const vtsthi = Math.abs(2 * (vold - vto)) + 2;
  const vtstlo = Math.abs(vold - vto) + 1;
  const vtox = vto + 3.5;
  const delv = vnew - vold;
  if (vold >= vto) {
    if (vold >= vtox) {
      if (delv <= 0) {
        // going off
        if (vnew >= vtox) {
          if (-delv > vtstlo) return vold - vtstlo;
          return vnew;
        }
        return Math.max(vnew, vto + 2);
      }
      // staying on
      return delv >= vtsthi ? vold + vtsthi : vnew;
    }
    // middle region
    return delv <= 0 ? Math.max(vnew, vto - 0.5) : Math.min(vnew, vto + 4);
  }
  // device off
  if (delv <= 0) {
    return -delv > vtsthi ? vold - vtsthi : vnew;
  }
  const vtemp = vto + 0.5;
  if (vnew <= vtemp) {
    return delv > vtstlo ? vold + vtstlo : vnew;
  }
  return vtemp;
}

/** Limit the change of a FET drain-source voltage between iterations (SPICE3 limvds). */
export function limvds(vnew: number, vold: number): number {
  if (vold >= 3.5) {
    if (vnew > vold) return Math.min(vnew, 3 * vold + 2);
    return vnew < 3.5 ? Math.max(vnew, 2) : vnew;
  }
  return vnew > vold ? Math.min(vnew, 4) : Math.max(vnew, -0.5);
}

// ---------------------------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------------------------

/** Silicon band gap in eV at temperature T (kelvin). */
export function siliconBandGap(T: number): number {
  return 1.16 - (7.02e-4 * T * T) / (T + 1108);
}

/** Temperature shift term of a built-in junction potential (SPICE "pbfact"), volts. */
export function potentialShift(T: number): number {
  const vt = K_OVER_Q * T;
  const arg = -siliconBandGap(T) / (2 * BOLTZ * T) + 1.1150877 / (BOLTZ * (2 * REFTEMP));
  return -2 * vt * (1.5 * Math.log(T / REFTEMP) + CHARGE * arg);
}

/**
 * Junction potential and zero-bias capacitance scaling from tnom to T (both kelvin), for a
 * junction of built-in potential `vj` (given at tnom) and grading coefficient `m`.
 * `capFactor` multiplies the zero-bias capacitance specified at tnom.
 */
export function junctionTemperature(
  vj: number,
  m: number,
  tnom: number,
  T: number,
): { pot: number; capFactor: number } {
  const fact1 = tnom / REFTEMP;
  const fact2 = T / REFTEMP;
  const pbo = (vj - potentialShift(tnom)) / fact1;
  const gmaold = (vj - pbo) / pbo;
  const pot = potentialShift(T) + fact2 * pbo;
  const gmanew = (pot - pbo) / pbo;
  const capFactor = (1 + m * (400e-6 * (T - REFTEMP) - gmanew)) / (1 + m * (400e-6 * (tnom - REFTEMP) - gmaold));
  return { pot, capFactor };
}

/**
 * Saturation-current temperature scaling: IS(T) = IS * exp((T/Tnom - 1) * EG / (n*vt))
 * * (T/Tnom)^(XTI/n), with vt = kT/q at T.
 */
export function satCurrentFactor(T: number, tnom: number, eg: number, xti: number, n: number): number {
  const vt = K_OVER_Q * T;
  const ratio = T / tnom;
  return Math.exp(((ratio - 1) * eg) / (n * vt) + (xti / n) * Math.log(ratio));
}

// ---------------------------------------------------------------------------------------------
// Depletion charge
// ---------------------------------------------------------------------------------------------

/** Precomputed coefficients of a depletion charge q(v) (see `depletionCharge`). */
export interface DepletionCoeffs {
  /** zero-bias capacitance (already scaled by area/m/temperature), F */
  readonly cj0: number;
  /** junction potential, V */
  readonly vj: number;
  /** grading coefficient */
  readonly m: number;
  /** forward-bias boundary FC*VJ, V */
  readonly vfc: number;
  /** charge per unit cj0 at v = vfc */
  readonly f1: number;
  /** (1-FC)^(1+M) */
  readonly f2: number;
  /** 1 - FC*(1+M) */
  readonly f3: number;
}

/** Highest forward-bias coefficient FC accepted (SPICE clamps larger values). */
export const FC_MAX = 0.95;

export function depletionCoeffs(cj0: number, vj: number, m: number, fc: number): DepletionCoeffs {
  const fcc = Math.min(Math.max(fc, 0), FC_MAX);
  const xfc = Math.log(1 - fcc);
  const f1 = Math.abs(1 - m) < 1e-9 ? -vj * xfc : (vj * (1 - Math.exp((1 - m) * xfc))) / (1 - m);
  return {
    cj0,
    vj,
    m,
    vfc: fcc * vj,
    f1,
    f2: Math.exp((1 + m) * xfc),
    f3: 1 - fcc * (1 + m),
  };
}

/** Result holder for charge evaluations (reused to avoid allocation in hot loops). */
export interface ChargeCap {
  q: number;
  c: number;
}

/**
 * Depletion charge and its capacitance dq/dv:
 *   v <  FC*VJ: q = VJ*cj0*(1 - (1 - v/VJ)^(1-M)) / (1-M),  C = cj0*(1 - v/VJ)^-M
 *   v >= FC*VJ: linear extrapolation of C (quadratic q), continuous in q and C.
 * Writes into `out` and returns it.
 */
export function depletionCharge(v: number, d: DepletionCoeffs, out: ChargeCap): ChargeCap {
  if (d.cj0 === 0) {
    out.q = 0;
    out.c = 0;
    return out;
  }
  if (v < d.vfc) {
    const arg = 1 - v / d.vj;
    const sarg = Math.exp(-d.m * Math.log(arg));
    out.q = Math.abs(1 - d.m) < 1e-9 ? -d.vj * d.cj0 * Math.log(arg) : (d.vj * d.cj0 * (1 - arg * sarg)) / (1 - d.m);
    out.c = d.cj0 * sarg;
  } else {
    const czf2 = d.cj0 / d.f2;
    out.q = d.cj0 * d.f1 + czf2 * (d.f3 * (v - d.vfc) + (d.m / (2 * d.vj)) * (v * v - d.vfc * d.vfc));
    out.c = czf2 * (d.f3 + (d.m * v) / d.vj);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Stamping helpers
// ---------------------------------------------------------------------------------------------

type MatrixSink = Pick<LoadContext, 'addMatrix'>;

/**
 * Stamp dI/dV for a current flowing from node a to node b (through the device) that depends
 * on the branch voltage V(p) - V(n) with transconductance g.
 */
export function stampVccs(ctx: MatrixSink, a: number, b: number, p: number, n: number, g: number): void {
  if (g === 0) return;
  ctx.addMatrix(a, p, g);
  ctx.addMatrix(a, n, -g);
  ctx.addMatrix(b, p, -g);
  ctx.addMatrix(b, n, g);
}

/** Stamp a conductance g between nodes a and b. */
export function stampConductance(ctx: MatrixSink, a: number, b: number, g: number): void {
  stampVccs(ctx, a, b, a, b, g);
}

/** Stamp a constant current i flowing from node a to node b through the device. */
export function stampCurrent(ctx: Pick<LoadContext, 'addRhs'>, a: number, b: number, i: number): void {
  if (i === 0) return;
  ctx.addRhs(a, -i);
  ctx.addRhs(b, i);
}

/** Complex counterpart of `stampVccs` for small-signal AC (admittance re + j*im). */
export function stampAcVccs(ctx: AcContext, a: number, b: number, p: number, n: number, re: number, im: number): void {
  if (re === 0 && im === 0) return;
  ctx.addMatrix(a, p, re, im);
  ctx.addMatrix(a, n, -re, -im);
  ctx.addMatrix(b, p, -re, -im);
  ctx.addMatrix(b, n, re, im);
}

/** Complex admittance re + j*im between nodes a and b. */
export function stampAcAdmittance(ctx: AcContext, a: number, b: number, re: number, im: number): void {
  stampAcVccs(ctx, a, b, a, b, re, im);
}

/**
 * Transient companion of a charge stored in state slot `q` (and current slot q+1) whose
 * branch current flows from node a to node b (device polarity `type`) and which depends only on
 * the branch voltage v = type*(V(a) - V(b)). Writes the charge, integrates and stamps.
 * Returns the integrated current (device polarity) and its conductance for output bookkeeping.
 */
export function stampCharge(
  ctx: LoadContext,
  type: number,
  slot: number,
  a: number,
  b: number,
  v: number,
  charge: ChargeCap,
): { i: number; geq: number } {
  ctx.state0[slot] = charge.q;
  const r = ctx.integrate(slot, charge.c);
  stampConductance(ctx, a, b, r.geq);
  stampCurrent(ctx, a, b, type * (r.i - r.geq * v));
  return r;
}

/** Result of `integrateCharge`. */
export interface IntegratedCharge {
  /** companion current dq/dt at the current iterate, A */
  i: number;
  /** cap * ag0 (conductance of the self capacitance), S */
  geq: number;
  /**
   * Integration coefficient d(dq/dt)/dq of the active method (e.g. 1/dt for BE, 2/dt for trap).
   * Multiply any partial derivative of the charge (also cross terms dq/dv_other) by it to get
   * the corresponding companion conductance. NaN when cap = 0 and `needAg0` was false.
   */
  ag0: number;
}

/**
 * Store charge `q` in state slot `slot` and integrate it with self capacitance `cap`.
 * The integration coefficient is recovered as geq/cap; when cap is exactly zero and the caller
 * needs it for cross terms, a second (idempotent) integrate call with unit capacitance is made.
 */
export function integrateCharge(ctx: LoadContext, slot: number, q: number, cap: number, needAg0 = false): IntegratedCharge {
  ctx.state0[slot] = q;
  const r = ctx.integrate(slot, cap);
  let ag0 = Number.NaN;
  if (cap !== 0) ag0 = r.geq / cap;
  else if (needAg0) ag0 = ctx.integrate(slot, 1).geq;
  return { i: r.i, geq: r.geq, ag0 };
}

/** Value and derivative of a scalar function at one point. */
export interface ValueSlope {
  i: number;
  g: number;
}

/**
 * Ideal pn-junction current isat*(exp(v/nvt) - 1) and its exact derivative (exponential
 * continued linearly above MAX_EXP_ARG). Writes into `out` and returns it.
 */
export function junctionCurrent(v: number, isat: number, nvt: number, out: ValueSlope): ValueSlope {
  if (isat === 0) {
    out.i = 0;
    out.g = 0;
    return out;
  }
  const a = v / nvt;
  out.i = isat * (expLin(a) - 1);
  out.g = (isat * expLinDeriv(a)) / nvt;
  return out;
}

/**
 * Generation-recombination current with the PSpice-style junction factor:
 *   I = ISR*(exp(v/(NR*vt)) - 1) * ((1 - v/VJ)^2 + 0.005)^(M/2)
 * Adds the current and its derivative to `out`.
 */
export function addRecombination(v: number, isr: number, nrvt: number, vj: number, m: number, out: ValueSlope): void {
  if (isr === 0) return;
  const a = v / nrvt;
  const e = expLin(a);
  const u = 1 - v / vj;
  const base = u * u + 0.005;
  const kgen = Math.pow(base, m / 2);
  const dkgen = -(m / vj) * u * Math.pow(base, m / 2 - 1);
  out.i += isr * (e - 1) * kgen;
  out.g += ((isr * expLinDeriv(a)) / nrvt) * kgen + isr * (e - 1) * dkgen;
}

// ---------------------------------------------------------------------------------------------
// Model parameters
// ---------------------------------------------------------------------------------------------

/**
 * Parameters that appear in vendor model cards purely as documentation (PSpice style) and are
 * silently ignored by every model.
 */
const INFORMATIONAL_PARAMS = new Set([
  'vceo',
  'icrating',
  'mfg',
  'iave',
  'vpk',
  'ipk',
  'vbr',
  'ibr',
  'type',
  'rds',
  'qg',
  'vds',
  'vgs',
  'part',
]);

export interface ResolvedParams<K extends string> {
  /** every parameter with its value (model value, else instance override, else default) */
  readonly p: Record<K, number>;
  /** parameters explicitly present in the card or overrides */
  readonly given: ReadonlySet<K>;
  /** card parameter names that are not recognised (lower-case) */
  readonly unknown: string[];
}

/**
 * Resolve model parameters: start from `defaults`, apply the card's values (accepting `aliases`,
 * alias -> canonical name), then `overrides` (runtime per-instance changes, canonical or alias
 * names). Unrecognised card keys (other than `ignore` and informational ones) are reported.
 */
export function resolveParams<K extends string>(
  defaults: Readonly<Record<K, number>>,
  aliases: Readonly<Record<string, K>>,
  card: ModelCard | undefined,
  overrides: Readonly<Record<string, number>>,
  ignore: ReadonlySet<string> = new Set(),
): ResolvedParams<K> {
  const p = { ...defaults } as Record<K, number>;
  const given = new Set<K>();
  const unknown: string[] = [];
  const canonical = (key: string): K | undefined => {
    const k = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(defaults, k)) return k as K;
    return Object.prototype.hasOwnProperty.call(aliases, k) ? aliases[k] : undefined;
  };
  const apply = (src: Readonly<Record<string, number>>, report: boolean): void => {
    for (const [key, value] of Object.entries(src)) {
      const k = canonical(key);
      if (k !== undefined) {
        if (Number.isFinite(value)) {
          p[k] = value;
          given.add(k);
        }
      } else if (report) {
        const lk = key.toLowerCase();
        if (!ignore.has(lk) && !INFORMATIONAL_PARAMS.has(lk)) unknown.push(lk);
      }
    }
  };
  if (card) apply(card.params, true);
  apply(overrides, false);
  return { p, given, unknown };
}

/** Is `key` (any case, canonical or alias) a parameter of the given table? */
export function isKnownParam(defaults: Readonly<Record<string, number>>, aliases: Readonly<Record<string, string>>, key: string): boolean {
  const k = key.toLowerCase();
  return Object.prototype.hasOwnProperty.call(defaults, k) || Object.prototype.hasOwnProperty.call(aliases, k);
}

/** Canonical name of a model parameter (or undefined). */
export function canonicalParam<K extends string>(
  defaults: Readonly<Record<K, number>>,
  aliases: Readonly<Record<string, K>>,
  key: string,
): K | undefined {
  const k = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(defaults, k)) return k as K;
  return Object.prototype.hasOwnProperty.call(aliases, k) ? aliases[k] : undefined;
}

const warnedCards = new WeakMap<object, Set<string>>();

/**
 * Warn about unknown model parameters once per (setup context, model card) pair, so a model
 * shared by many instances produces a single message.
 */
export function warnUnknownParams(ctx: SetupContext, card: ModelCard | undefined, unknown: readonly string[]): void {
  if (!card || unknown.length === 0) return;
  let seen = warnedCards.get(ctx);
  if (!seen) {
    seen = new Set();
    warnedCards.set(ctx, seen);
  }
  const key = card.name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  const list = unknown.slice(0, 12).join(', ') + (unknown.length > 12 ? ', ...' : '');
  ctx.warn(`model ${card.name}: unsupported parameter(s) ignored: ${list}`);
}

/**
 * Look up a model card and check its type keyword. Returns the card (or undefined when it is
 * missing or of the wrong family, after warning) and the matched type keyword.
 */
export function findModel(
  ctx: SetupContext,
  elementName: string,
  modelName: string | undefined,
  accepted: readonly string[],
  fallbackType: string,
): { card: ModelCard | undefined; type: string } {
  if (!modelName) {
    ctx.warn(`${elementName}: no model given, using default ${fallbackType} parameters`);
    return { card: undefined, type: fallbackType };
  }
  const card = ctx.model(modelName);
  if (!card) {
    ctx.warn(`${elementName}: model '${modelName}' not found, using default ${fallbackType} parameters`);
    return { card: undefined, type: fallbackType };
  }
  const t = card.type.toUpperCase();
  if (!accepted.includes(t)) {
    ctx.warn(
      `${elementName}: model '${modelName}' has type ${card.type}, expected ${accepted.join('/')}; using default ${fallbackType} parameters`,
    );
    return { card: undefined, type: fallbackType };
  }
  return { card, type: t };
}

/** Read the first finite instance parameter among `keys`. */
export function instanceParam(params: Readonly<Record<string, number>>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Relative/absolute convergence test used by the device convTest() implementations:
 * the current change predicted by the linearisation must be within reltol of the current.
 */
export function currentConverged(i: number, delta: number, reltol: number, abstol: number): boolean {
  const ihat = i + delta;
  return Math.abs(delta) <= reltol * Math.max(Math.abs(ihat), Math.abs(i)) + abstol;
}

/** Thermal noise current PSD of a conductance g at temperature T: 4kTg (A^2/Hz). */
export function thermalNoise(T: number, g: number): number {
  return 4 * BOLTZ * T * g;
}

/** Shot noise current PSD of a DC current i: 2q|i| (A^2/Hz). */
export function shotNoise(i: number): number {
  return 2 * CHARGE * Math.abs(i);
}

/** Flicker noise PSD KF*|i|^AF/f for one of `m` parallel devices sharing `i` (A^2/Hz). */
export function flickerNoise(kf: number, af: number, i: number, freq: number, m = 1): number {
  if (kf === 0 || freq <= 0) return 0;
  const per = Math.max(Math.abs(i) / m, 1e-38);
  return (m * kf * Math.exp(af * Math.log(per))) / freq;
}
