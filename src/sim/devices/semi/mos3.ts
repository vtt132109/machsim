/**
 * MOSFET level 3 (semi-empirical short-channel model) drain-current core.
 *
 * Implements the published SPICE level-3 equations (own code) in mode-local, device-polarity
 * coordinates (vds >= 0). All quantities are carried as forward-mode dual numbers holding the
 * value and the partial derivatives w.r.t. (vgs, vds, vbs), so the conductances gm, gds, gmbs
 * and the sensitivities of von / vdsat used by the Meyer capacitances are exact derivatives of
 * the evaluated current within each region.
 *
 *   phibs = PHI - vbs (vbs > 0: sqrt(phibs) = sqrt(PHI)/(1 + vbs/(2 PHI)))
 *   fshort = 1 - XJ/Leff * ((c0 + c1 wp/XJ + c2 (wp/XJ)^2 + LD/XJ) * sqrt(1 - (wp/(XJ+wp))^2) - LD/XJ),
 *            wp = sqrt(2 eps_si/(q NSUB)) * sqrt(phibs)
 *   vth = VBI - sigma*vds + GAMMA*fshort*sqrt(phibs) + fn*phibs,  sigma = ETA*8.15e-22/(Cox Leff^3),
 *         fn = DELTA*pi*eps_si/(2 Cox Weff)
 *   von = vth + n*vt with n = 1 + q NFS/Cox + GAMMA fshort/(2 sqrt(phibs)) when NFS > 0
 *   mobility us = U0/(1 + THETA (vgs - vth)); vdsat with velocity saturation (VMAX)
 *   Id = BETA/(1+THETA(vgs-vth)) * (vgs - vth - (1+fb)/2 vdsx) vdsx * fdrain * xlfact * wfact
 *   with channel-length modulation via KAPPA (and VMAX), punch-through limit, and
 *   exp((vgs - von)/(n vt)) weak inversion below von.
 */

import { CHARGE, EPS_SI } from '../../device';
import type { MosCoreResult, MosTemp } from './mosfet';

/** Level-3-only parameters (already temperature/geometry independent). */
export interface Mos3Params {
  nfs: number;
  theta: number;
  eta: number;
  kappa: number;
  vmax: number;
  xj: number;
  delta: number;
  ld: number;
  nsub: number;
  /** temperature-adjusted KP */
  kp: number;
  /** parallel multiplier */
  m: number;
}

/** A value with its partial derivatives w.r.t. vgs, vds and vbs. */
interface Dual {
  v: number;
  g: number;
  d: number;
  b: number;
}

const dual = (v: number, g = 0, d = 0, b = 0): Dual => ({ v, g, d, b });
const add = (x: Dual, y: Dual): Dual => dual(x.v + y.v, x.g + y.g, x.d + y.d, x.b + y.b);
const sub = (x: Dual, y: Dual): Dual => dual(x.v - y.v, x.g - y.g, x.d - y.d, x.b - y.b);
const scale = (x: Dual, k: number): Dual => dual(x.v * k, x.g * k, x.d * k, x.b * k);
const addc = (x: Dual, k: number): Dual => dual(x.v + k, x.g, x.d, x.b);
const mul = (x: Dual, y: Dual): Dual =>
  dual(x.v * y.v, x.g * y.v + x.v * y.g, x.d * y.v + x.v * y.d, x.b * y.v + x.v * y.b);
const div = (x: Dual, y: Dual): Dual => {
  const iv = 1 / y.v;
  const q = x.v * iv;
  return dual(q, (x.g - q * y.g) * iv, (x.d - q * y.d) * iv, (x.b - q * y.b) * iv);
};
const chain = (x: Dual, f: number, df: number): Dual => dual(f, df * x.g, df * x.d, df * x.b);
const dsqrt = (x: Dual): Dual => {
  const s = Math.sqrt(x.v);
  return chain(x, s, 0.5 / s);
};
const dexp = (x: Dual): Dual => {
  const e = Math.exp(Math.min(x.v, 80));
  return chain(x, e, e);
};
const dmax = (x: Dual, y: Dual): Dual => (x.v >= y.v ? x : y);
const dmin = (x: Dual, y: Dual): Dual => (x.v <= y.v ? x : y);

/** Short-channel width coefficients of the level-3 model. */
const COEFF0 = 0.0631353;
const COEFF1 = 0.8013292;
const COEFF2 = -0.01110777;

/**
 * Level-3 drain current in mode-local coordinates (vds >= 0). `t` supplies the shared
 * temperature/geometry-adjusted values (phi, gamma, vbi, u0, leff, weff, coxArea, oxideCap, vt).
 */
export function mos3Core(vgsIn: number, vdsIn: number, vbsIn: number, t: MosTemp, p: Mos3Params, out: MosCoreResult): MosCoreResult {
  const vgs = dual(vgsIn, 1, 0, 0);
  const vds = dual(vdsIn, 0, 1, 0);
  const vbs = dual(vbsIn, 0, 0, 1);
  const leff = t.leff;
  const weff = t.weff;
  const cox = t.coxArea;
  const alpha = p.nsub > 0 ? (2 * EPS_SI) / (CHARGE * p.nsub * 1e6) : 0;
  const xd = Math.sqrt(alpha);
  const narrow = cox > 0 ? (p.delta * 0.5 * Math.PI * EPS_SI) / cox : 0;
  const sigma = cox > 0 ? (p.eta * 8.15e-22) / (cox * leff * leff * leff) : 0;
  const beta0 = (p.kp * weff * p.m) / leff;

  // square-root term
  let phibs: Dual;
  let sqphbs: Dual;
  if (vbsIn <= 0) {
    phibs = addc(scale(vbs, -1), t.phi);
    sqphbs = dsqrt(phibs);
  } else {
    const sqphis = Math.sqrt(t.phi);
    sqphbs = div(dual(sqphis), addc(scale(vbs, 1 / (2 * t.phi)), 1));
    phibs = mul(sqphbs, sqphbs);
  }

  // short-channel factor
  let fshort = dual(1);
  if (p.xj > 0 && xd > 0) {
    const wps = scale(sqphbs, xd);
    const wponxj = scale(wps, 1 / p.xj);
    const xjonxl = p.xj / leff;
    const djonxj = p.ld / p.xj;
    const wconxj = add(addc(scale(wponxj, COEFF1), COEFF0), scale(mul(wponxj, wponxj), COEFF2));
    const arga = addc(wconxj, djonxj);
    const argc = div(wponxj, addc(wponxj, 1));
    const argb = dsqrt(addc(scale(mul(argc, argc), -1), 1));
    fshort = addc(scale(addc(mul(arga, argb), -djonxj), -xjonxl), 1);
  }

  // body effect and threshold
  const gammas = scale(fshort, t.gamma);
  const fbodys = div(scale(gammas, 0.5), scale(sqphbs, 2));
  const fbody = addc(fbodys, narrow / weff);
  const qbonco = add(mul(gammas, sqphbs), scale(phibs, narrow / weff));
  const vth = add(addc(scale(vds, -sigma), t.vbi), qbonco);
  let von = vth;
  let xn = dual(1);
  const weak = p.nfs !== 0 && t.oxideCap > 0;
  if (weak) {
    const csonco = (CHARGE * p.nfs * 1e4) / cox;
    const cdonco = div(qbonco, scale(phibs, 2));
    xn = addc(cdonco, 1 + csonco);
    von = add(vth, scale(xn, t.vt));
  }
  out.von = von.v;
  out.dvonDvds = von.d;
  out.dvonDvbs = von.b;

  if (!weak && vgsIn <= von.v) {
    out.ids = 0;
    out.gm = 0;
    out.gds = 0;
    out.gmbs = 0;
    out.vdsat = 0;
    out.dvdsatDvgs = 0;
    out.dvdsatDvds = 0;
    out.dvdsatDvbs = 0;
    return out;
  }

  const vgsx = dmax(vgs, von);
  const vgt = sub(vgsx, vth);
  const onfg = addc(scale(vgt, p.theta), 1);
  const fgate = div(dual(1), onfg);
  const us = scale(fgate, t.u0 * 1e-4);
  const onfbdy = div(dual(1), addc(fbody, 1));
  let vdsat = mul(vgt, onfbdy);
  let vdsc = dual(0);
  if (p.vmax > 0) {
    vdsc = div(dual(leff * p.vmax), us);
    const arga = vdsat;
    const argb = dsqrt(add(mul(arga, arga), mul(vdsc, vdsc)));
    vdsat = sub(add(arga, vdsc), argb);
  }
  out.vdsat = vdsat.v;
  out.dvdsatDvgs = vdsat.g;
  out.dvdsatDvds = vdsat.d;
  out.dvdsatDvbs = vdsat.b;

  const vdsx = dmin(vds, vdsat);
  const cdo = sub(vgt, scale(mul(addc(fbody, 1), vdsx), 0.5));
  let cdrain = mul(scale(fgate, beta0), mul(cdo, vdsx));
  let fdrain = dual(1);
  if (p.vmax > 0) {
    fdrain = div(dual(1), addc(div(vdsx, vdsc), 1));
    cdrain = mul(cdrain, fdrain);
  }

  // channel-length modulation in saturation
  if (vdsIn > vdsat.v) {
    let delxl: Dual | undefined;
    const over = sub(vds, vdsat);
    if (p.vmax <= 0) {
      delxl = alpha > 0 ? dsqrt(scale(over, p.kappa * alpha)) : dual(0);
    } else if (alpha > 0) {
      const cdsat = cdrain;
      let gdsat = div(mul(cdsat, addc(scale(fdrain, -1), 1)), vdsc);
      gdsat = dmax(gdsat, dual(1e-12));
      const emax = div(scale(cdsat, p.kappa / leff), gdsat);
      const arga = scale(emax, 0.5 * alpha);
      const argc = p.kappa * alpha;
      const argb = dsqrt(add(mul(arga, arga), scale(over, argc)));
      delxl = sub(argb, arga);
    }
    if (delxl) {
      if (delxl.v > 0.5 * leff) {
        // punch-through approximation
        delxl = addc(scale(div(dual(1), delxl), -(leff * leff) / 4), leff);
      }
      const xlfact = div(dual(1), addc(scale(delxl, -1 / leff), 1));
      cdrain = mul(cdrain, xlfact);
    }
  }

  // weak inversion below von
  if (weak && vgsIn < von.v) {
    const wfact = dexp(div(sub(vgs, von), scale(xn, t.vt)));
    cdrain = mul(cdrain, wfact);
  }

  out.ids = cdrain.v;
  out.gm = cdrain.g;
  out.gds = cdrain.d;
  out.gmbs = cdrain.b;
  return out;
}
