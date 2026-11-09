/**
 * MOSFET level 2 (Grove-Frohman analytical model) drain-current core.
 *
 * Own implementation of the published SPICE2 level-2 equations, in mode-local, device-polarity
 * coordinates (vds >= 0). Values are carried as dual numbers (dual.ts) so gm, gds, gmbs and the
 * sensitivities of von / vdsat used by the Meyer capacitances are exact derivatives.
 *
 *   phib  = PHI - vbs              (vbs > 0: sqrt(phib) = sqrt(PHI) / (1 + vbs/(2 PHI)))
 *   eta   = 1 + DELTA*pi*eps_si / (4 Cox Weff)                 narrow-channel factor
 *   vbin  = VBI + (eta - 1)*phib,   VBI = VTO - GAMMA*sqrt(PHI) (temperature adjusted)
 *   gs    = GAMMA*(1 - XJ/(2 Leff)*(sqrt(1 + 2 ws/XJ) - 1 + sqrt(1 + 2 wd/XJ) - 1))
 *           ws = xd*sqrt(phib), wd = xd*sqrt(phib + vds), xd = sqrt(2 eps_si/(q NSUB))
 *           (charge sharing; only with XJ > 0 and NSUB > 0, otherwise gs = GAMMA)
 *   von   = vbin + gs*sqrt(phib)
 *   NFS > 0 (weak inversion): xn = 1 + q NFS/Cox + eta - 1 + gs/(2 sqrt(phib)), von += xn*vt and
 *           below von the current is Id(von) * exp((vgs - von)/(xn vt)).
 *   mobility: ufact = (UCRIT*eps_si/(Cox (vgs - von)))^UEXP when that ratio is below 1
 *   Id    = BETA*ufact * [ (vgs - vbin - eta*vdsx/2)*vdsx
 *                          - 2/3*gs*((phib + vdsx)^1.5 - phib^1.5) ],      vdsx = min(vds, vdsat)
 *   vdsat solves dId/dvds = 0:  eta*u^2 + gs*u - (vgs - vbin + eta*phib) = 0, vdsat = u^2 - phib
 *   VMAX > 0: vdsat <- vdsat*vc/(vdsat + vc), vc = VMAX*Leff/mu_eff (velocity saturation,
 *           a series approximation of the SPICE2 quartic) and Id is divided by (1 + vdsx/vc).
 *   Channel-length modulation:
 *     LAMBDA given: Id <- Id/(1 - LAMBDA*vds) in both regions (continuous at vdsat);
 *     else with NSUB: in saturation dL = xd/sqrt(NEFF)*(sqrt(r + sqrt(1 + r^2)) - 1),
 *       r = (vds - vdsat)/4 (zero at vdsat, so the current is continuous), Id <- Id/(1 - dL/Leff),
 *       with the level-3 punch-through continuation when dL > Leff/2.
 *
 * UTRA is accepted and ignored (as in SPICE3).
 */

import { CHARGE, EPS_SI } from '../../device';
import type { MosCoreResult, MosTemp } from './mosfet';
import { add, addc, dconst, dexp, div, dmax, dmin, dpow, dsqrt, dual, mul, scale, sub, type Dual } from './dual';

/** Level-2-only parameters (temperature-independent unless noted). */
export interface Mos2Params {
  ucrit: number;
  uexp: number;
  vmax: number;
  neff: number;
  nfs: number;
  xj: number;
  delta: number;
  nsub: number;
  /** true when LAMBDA was given on the model card */
  lambdaGiven: boolean;
  /** temperature-adjusted KP */
  kp: number;
  /** parallel multiplier */
  m: number;
}

function cutoff(out: MosCoreResult): MosCoreResult {
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

/** sqrt(PHI - v) with the SPICE linear continuation for forward bias v > 0. */
function sqrtPhi(v: Dual, phi: number): Dual {
  if (v.v <= 0) return dsqrt(addc(scale(v, -1), phi));
  const sphi = Math.sqrt(phi);
  return div(dconst(sphi), addc(scale(v, 1 / (2 * phi)), 1));
}

/**
 * Level-2 drain current in mode-local coordinates (vds >= 0). `t` supplies the shared
 * temperature / geometry values (phi, gamma, vbi, lambda, u0, leff, weff, coxArea, vt).
 */
export function mos2Core(vgsIn: number, vdsIn: number, vbsIn: number, t: MosTemp, p: Mos2Params, out: MosCoreResult): MosCoreResult {
  const vgs = dual(vgsIn, 1, 0, 0);
  const vds = dual(vdsIn, 0, 1, 0);
  const vbs = dual(vbsIn, 0, 0, 1);
  const cox = t.coxArea;
  const leff = t.leff;
  const phi = t.phi;

  const sarg = sqrtPhi(vbs, phi);
  const phib = mul(sarg, sarg);
  const factor = cox > 0 ? (p.delta * Math.PI * EPS_SI) / (4 * cox * t.weff) : 0;
  const eta = 1 + factor;
  const vbin = addc(scale(phib, factor), t.vbi);

  // charge-sharing (short-channel) reduction of the body factor
  const xd = p.nsub > 0 ? Math.sqrt((2 * EPS_SI) / (CHARGE * p.nsub * 1e6)) : 0;
  let gs: Dual = dconst(t.gamma);
  if (p.xj > 0 && xd > 0 && t.gamma > 0) {
    const ws = scale(sarg, xd);
    const wd = scale(dsqrt(add(phib, vds)), xd);
    const args = addc(dsqrt(addc(scale(ws, 2 / p.xj), 1)), -1);
    const argd = addc(dsqrt(addc(scale(wd, 2 / p.xj), 1)), -1);
    gs = scale(addc(scale(add(args, argd), -p.xj / (2 * leff)), 1), t.gamma);
    if (gs.v < 0) gs = dconst(0);
  }

  const vth = add(vbin, mul(gs, sarg));
  let von = vth;
  let xn = dconst(1);
  const weak = p.nfs > 0 && cox > 0;
  if (weak) {
    xn = add(dconst(1 + (CHARGE * p.nfs * 1e4) / cox + factor), div(scale(gs, 0.5), sarg));
    von = add(vth, scale(xn, t.vt));
  }
  out.von = von.v;
  out.dvonDvds = von.d;
  out.dvonDvbs = von.b;
  if (!weak && vgsIn <= von.v) return cutoff(out);

  const vgsx = dmax(vgs, von);
  // mobility degradation
  let ufact = dconst(1);
  if (p.uexp !== 0 && cox > 0) {
    const udenom = sub(vgsx, vth);
    const crit = (p.ucrit * 100 * EPS_SI) / cox;
    if (udenom.v > crit) ufact = dpow(div(dconst(crit), udenom), p.uexp);
  }
  const beta = scale(ufact, (p.kp * t.weff * p.m) / leff);

  // saturation voltage from dId/dvds = 0
  const drive = add(sub(vgsx, vbin), scale(phib, eta));
  let vdsat: Dual;
  if (gs.v > 0) {
    const disc = add(mul(gs, gs), scale(drive, 4 * eta));
    const u = scale(sub(dsqrt(dmax(disc, dconst(0))), gs), 1 / (2 * eta));
    vdsat = sub(mul(u, u), phib);
  } else {
    vdsat = scale(sub(vgsx, vbin), 1 / eta);
  }
  if (vdsat.v < 0) vdsat = dconst(0);
  let vc: Dual | null = null;
  if (p.vmax > 0) {
    // mu_eff in m^2/Vs
    const mueff = scale(ufact, t.u0 * 1e-4);
    vc = div(dconst(p.vmax * leff), mueff);
    vdsat = div(mul(vdsat, vc), add(vdsat, vc));
  }
  out.vdsat = vdsat.v;
  out.dvdsatDvgs = vdsat.g;
  out.dvdsatDvds = vdsat.d;
  out.dvdsatDvbs = vdsat.b;

  const vdsx = dmin(vds, vdsat);
  const bargx = dsqrt(add(phib, vdsx));
  const body = scale(sub(mul(mul(bargx, bargx), bargx), mul(mul(sarg, sarg), sarg)), 2 / 3);
  const lin = mul(sub(sub(vgsx, vbin), scale(vdsx, eta / 2)), vdsx);
  let cdrain = mul(beta, sub(lin, mul(gs, body)));
  if (vc) cdrain = div(cdrain, addc(div(vdsx, vc), 1));

  // channel-length modulation
  if (p.lambdaGiven) {
    if (t.lambda !== 0) {
      const den = addc(scale(vds, -t.lambda), 1);
      cdrain = div(cdrain, den.v > 0.1 ? den : dconst(0.1));
    }
  } else if (xd > 0 && vdsIn > vdsat.v) {
    const r = scale(sub(vds, vdsat), 0.25);
    const inner = dsqrt(addc(mul(r, r), 1));
    let delxl = scale(addc(dsqrt(add(r, inner)), -1), xd / Math.sqrt(p.neff > 0 ? p.neff : 1));
    if (delxl.v > 0.5 * leff) delxl = addc(scale(div(dconst(1), delxl), -(leff * leff) / 4), leff);
    cdrain = div(cdrain, addc(scale(delxl, -1 / leff), 1));
  }

  if (weak && vgsIn < von.v) cdrain = mul(cdrain, dexp(div(sub(vgs, von), scale(xn, t.vt))));

  out.ids = cdrain.v;
  out.gm = cdrain.g;
  out.gds = cdrain.d;
  out.gmbs = cdrain.b;
  return out;
}
