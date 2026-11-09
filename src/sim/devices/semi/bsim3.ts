/**
 * BSIM3v3-class MOSFET — element 'M' with an NMOS / PMOS model card of LEVEL 7, 8, 49 or 53
 * (the levels different SPICE dialects use for BSIM3 version 3). Selected by the dispatcher in
 * mosdevice.ts; LEVEL 14 / 54 (BSIM4) cards are evaluated with these equations too, with a warning,
 * because the two models share their core parameters (TOXE -> TOX, NDEP -> NCH).
 *
 * Own implementation of the equations published in the BSIM3v3 user manual (UC Berkeley). What is
 * covered:
 *
 * DC core (mode-local coordinates, vds >= 0, device polarity; dual numbers give exact Jacobians)
 * - Effective geometry Leff = L - 2 dL, Weff = W - 2 dW with LINT/WINT and the LL/LW/LWL,
 *   WL/WW/WWL power laws; bias-dependent Weff' (DWG, DWB).
 * - Binning: every core parameter P accepts LP / WP / PP terms, P + LP/Leff + WP/Weff + PP/(Leff*Weff)
 *   with lengths in micrometres (BINUNIT = 1).
 * - Vbseff smoothing (K2 limit), threshold voltage with body effect (K1, K2), NLX lateral doping,
 *   narrow width (K3, K3B, W0), short-channel roll-off (DVT0, DVT1, DVT2), narrow-width
 *   short-channel term (DVT0W, DVT1W, DVT2W), DIBL (ETA0, ETAB, DSUB), DELVTO instance shift.
 * - Subthreshold swing n (NFACTOR, CDSC, CDSCB, CDSCD, CIT) and the unified Vgsteff (VOFF).
 * - Bulk-charge factor Abulk (A0, AGS, B0, B1, KETA), mobility MOBMOD 1 / 2 / 3 (U0, UA, UB, UC).
 * - Velocity saturation (VSAT, A1, A2) with source/drain resistance RDSW (PRWG, PRWB, WR) in the
 *   Vdsat quadratic and in the current, Vdseff smoothing (DELTA).
 * - Output conductance: CLM (PCLM), DIBL (PDIBLC1, PDIBLC2, PDIBLCB, DROUT), PVAG, and the
 *   substrate-current-induced body effect (PSCBE1, PSCBE2).
 * Not modelled: substrate (impact-ionisation) current ALPHA0/BETA0, gate-induced drain leakage,
 * non-quasi-static mode (NQSMOD), polysilicon depletion (NGATE), the capMod 1/2/3 smoothing.
 *
 * Charge model — a charge-conserving long-channel model in the form of the BSIM3 capMod = 0
 * equations, with the DC threshold and Abulk: accumulation (Qg = Cox'(Vgb - Vfb)), depletion
 * (Qg = Cox' K1^2/2 (sqrt(1 + 4(Vgb - Vfb)/K1^2) - 1)), inversion with linear / saturation forms
 * (Vdsat,cv = Vgst / Abulk) and the drain/source partition XPART (0 -> 40/60, 0.5 -> 50/50,
 * 1 -> 0/100). Vfb = Vth - PHIs - K1 sqrt(PHIs - Vbseff) keeps the charges continuous between
 * regions. Overlap capacitances CGSO, CGDO (default 0.6 XJ Cox) plus CF, and CGBO. Terminal
 * charges Qg, Qd, Qb (Qs = -(Qg + Qd + Qb)) are integrated by the engine; their derivatives give
 * the 3x3 non-reciprocal transcapacitance matrix used in transient and AC.
 *
 * Temperature: KT1, KT1L, KT2 (threshold), UTE (mobility), UA1, UB1, UC1, AT (saturation
 * velocity), PRT (RDSW), junction saturation current with XTI / NJ and junction capacitances.
 * Junctions: JS*AS + JSW*PS (drain: AD, PD) diodes with gmin, bottom (CJ, MJ, PB) and sidewall
 * (CJSW, MJSW, PBSW) depletion charges. Series resistance RSH * NRD / NRS as external resistors.
 * Noise: channel thermal noise 8kT/3 gm (noiMod 1) and KF / AF / EF flicker noise.
 *
 * Units follow the BSIM3 conventions: NCH / NSUB in cm^-3 (values above 1e20 are taken as m^-3),
 * U0 in cm^2/Vs (values below 1 are taken as m^2/Vs), lengths in metres.
 *
 * Internal nodes: "<name>#d", "<name>#s" when RSH*NRD / RSH*NRS > 0.
 * Outputs: Id, Ig, Is, Ib (currents INTO the terminals), P, Vth, Vdsat, Gm, Gds.
 */

import type { AcContext, Device, LoadContext, NoiseContext, NoiseGenerator, SetupContext, TruncContext } from '../../device';
import { CHARGE, EPS_OX, EPS_SI, GROUND } from '../../device';
import type { ElementIR, ModelCard } from '../../netlist';
import { runtimeParamError } from '../linear/common';
import {
  K_OVER_Q,
  celsiusToKelvin,
  currentConverged,
  depletionCharge,
  depletionCoeffs,
  expLin,
  expLinDeriv,
  fetlim,
  findModel,
  instanceParam,
  integrateCharge,
  junctionTemperature,
  junctionVcrit,
  limvds,
  pnjlim,
  siliconBandGap,
  stampAcAdmittance,
  stampAcVccs,
  stampConductance,
  stampCurrent,
  stampVccs,
  thermalNoise,
  warnUnknownParams,
  type ChargeCap,
  type DepletionCoeffs,
} from './common';
import { DEFAULT_MOS_L, DEFAULT_MOS_W } from './mosfet';
import { add, addc, dconst, dexp, div, dmax, dmin, dpow, dsoftplus, dsqrt, dual, mul, neg, scale, sub, type Dual } from './dual';

/** Model levels evaluated by this file. */
export const BSIM3_LEVELS: ReadonlySet<number> = new Set([7, 8, 49, 53]);
/** BSIM4 levels approximated with the BSIM3 equations. */
export const BSIM4_LEVELS: ReadonlySet<number> = new Set([14, 54]);

/** Model parameters with their BSIM3v3 defaults (NaN = computed when not given). */
export const BSIM3_DEFAULTS = {
  level: 49,
  version: 3.3,
  mobmod: 1,
  capmod: 0,
  xpart: 0,
  tox: 1.5e-8,
  xj: 1.5e-7,
  nch: 1.7e17,
  nsub: 6e16,
  xt: 1.55e-7,
  vbm: -3,
  vth0: Number.NaN,
  vfb: Number.NaN,
  k1: Number.NaN,
  k2: Number.NaN,
  k3: 80,
  k3b: 0,
  w0: 2.5e-6,
  nlx: 1.74e-7,
  dvt0: 2.2,
  dvt1: 0.53,
  dvt2: -0.032,
  dvt0w: 0,
  dvt1w: 5.3e6,
  dvt2w: -0.032,
  eta0: 0.08,
  etab: -0.07,
  dsub: Number.NaN,
  u0: Number.NaN,
  ua: 2.25e-9,
  ub: 5.87e-19,
  uc: Number.NaN,
  vsat: 8e4,
  a0: 1,
  ags: 0,
  b0: 0,
  b1: 0,
  keta: -0.047,
  a1: 0,
  a2: 1,
  rdsw: 0,
  prwg: 0,
  prwb: 0,
  wr: 1,
  voff: -0.08,
  nfactor: 1,
  cdsc: 2.4e-4,
  cdscb: 0,
  cdscd: 0,
  cit: 0,
  pclm: 1.3,
  pdiblc1: 0.39,
  pdiblc2: 0.0086,
  pdiblcb: 0,
  drout: 0.56,
  pscbe1: 4.24e8,
  pscbe2: 1e-5,
  pvag: 0,
  delta: 0.01,
  lint: 0,
  wint: 0,
  ll: 0,
  lw: 0,
  lwl: 0,
  lln: 1,
  lwn: 1,
  wl: 0,
  ww: 0,
  wwl: 0,
  wln: 1,
  wwn: 1,
  dwg: 0,
  dwb: 0,
  cgso: Number.NaN,
  cgdo: Number.NaN,
  cgbo: 0,
  cf: 0,
  cj: 5e-4,
  mj: 0.5,
  cjsw: 5e-10,
  mjsw: 0.33,
  pb: 1,
  pbsw: 1,
  js: 1e-4,
  jsw: 0,
  nj: 1,
  xti: 3,
  rsh: 0,
  kt1: -0.11,
  kt1l: 0,
  kt2: 0.022,
  ute: -1.5,
  ua1: 4.31e-9,
  ub1: -7.61e-18,
  uc1: Number.NaN,
  at: 3.3e4,
  prt: 0,
  kf: 0,
  af: 1,
  ef: 1,
  fc: 0.5,
  tnom: Number.NaN,
} as const;

/**
 * BSIM4-class parameter set (LEVEL 14 / 54): the shared core parameters with the BSIM4.8 defaults
 * (electrical oxide thickness TOXE is stored under `tox`, doping NDEP under `nch`) plus the parameters
 * BSIM4 adds to the core: lateral non-uniform doping LPE0 / LPEB, the mobility exponent EU, the
 * oxide thickness TOXM the body-effect parameters were extracted at, and the capacitance geometry
 * DLC / DWC. NaN means "derived from other parameters when not given".
 */
export const BSIM4_DEFAULTS = {
  ...BSIM3_DEFAULTS,
  level: 54,
  version: 4.8,
  mobmod: 0,
  capmod: 2,
  tox: 3e-9,
  toxm: Number.NaN,
  lpe0: 1.74e-7,
  lpeb: 0,
  eu: Number.NaN,
  ua: Number.NaN,
  ub: 1e-19,
  uc: Number.NaN,
  ua1: 1e-9,
  ub1: -1e-18,
  uc1: Number.NaN,
  rdsw: 200,
  prwg: 1,
  prwb: 0,
  pvag: 1,
  dlc: Number.NaN,
  dwc: Number.NaN,
  cgsl: 0,
  cgdl: 0,
  cf: Number.NaN,
} as const;

export type Bsim3Param = keyof typeof BSIM4_DEFAULTS;
type Bsim3Values = Record<Bsim3Param, number>;

const ALIASES3: Readonly<Record<string, Bsim3Param>> = {
  vtho: 'vth0',
  toxe: 'tox',
  toxm: 'tox',
  npeak: 'nch',
  ndep: 'nch',
  uo: 'u0',
  tref: 'tnom',
};
const ALIASES4: Readonly<Record<string, Bsim3Param>> = {
  vtho: 'vth0',
  toxe: 'tox',
  npeak: 'nch',
  ndep: 'nch',
  uo: 'u0',
  tref: 'tnom',
};

/** Parameters that accept L / W / P binning terms. */
const BINNABLE = new Set<string>([
  'vth0', 'k1', 'k2', 'k3', 'k3b', 'w0', 'nlx', 'dvt0', 'dvt1', 'dvt2', 'dvt0w', 'dvt1w', 'dvt2w', 'eta0', 'etab', 'dsub',
  'u0', 'ua', 'ub', 'uc', 'vsat', 'a0', 'ags', 'b0', 'b1', 'keta', 'a1', 'a2', 'rdsw', 'prwg', 'prwb', 'wr', 'voff',
  'nfactor', 'cdsc', 'cdscb', 'cdscd', 'cit', 'pclm', 'pdiblc1', 'pdiblc2', 'pdiblcb', 'drout', 'pscbe1', 'pscbe2', 'pvag',
  'delta', 'nch', 'nsub', 'xj', 'xt', 'vbm', 'vfb', 'kt1', 'kt1l', 'kt2', 'ute', 'ua1', 'ub1', 'uc1', 'at', 'prt', 'dwg', 'dwb',
  'cgso', 'cgdo', 'cf', 'lpe0', 'lpeb', 'eu',
]);

/** Card parameters that are recognised but have no effect here (no warning). */
const ACCEPTED = new Set([
  'binunit', 'paramchk', 'nqsmod', 'noimod', 'lmin', 'lmax', 'wmin', 'wmax', 'dlc', 'dwc', 'llc', 'lwc', 'lwlc', 'wlc', 'wwc',
  'wwlc', 'xl', 'xw', 'acde', 'moin', 'noff', 'voffcv', 'clc', 'cle', 'cgsl', 'cgdl', 'ckappa', 'vfbcv', 'elm', 'ngate',
  'alpha0', 'alpha1', 'beta0', 'ijth', 'noia', 'noib', 'noic', 'em', 'tcj', 'tcjsw', 'tcjswg', 'tpb', 'tpbsw', 'tpbswg',
  'cjswg', 'mjswg', 'pbswg', 'hdif', 'ldif', 'acm', 'gamma1', 'gamma2', 'vbx', 'tlev', 'tlevc', 'xpart', 'capmod',
  'mobmod', 'version', 'level', 'rd', 'rs', 'ld', 'wd', 'dtoxcv', 'lmlt', 'wmlt', 'tox', 'toxm', 'llodku0', 'wlodku0',
  'nlev', 'gdsnoi', 'stimod', 'sa', 'sb', 'sd', 'saref', 'sbref', 'igcmod', 'igbmod', 'rgatemod', 'rbodymod', 'trnqsmod',
  'acnqsmod', 'diomod', 'permod', 'geomod', 'rdsmod', 'tempmod', 'epsrox', 'toxp', 'dtox', 'ndep', 'nsd', 'phin', 'eu',
  'lpe0', 'lpeb', 'dvtp0', 'dvtp1', 'minv', 'fprout', 'pdits', 'pditsl', 'pditsd', 'rdswmin', 'rdw', 'rsw', 'rdwmin',
  'rswmin', 'lambda', 'vtl', 'lc', 'xn', 'k2we', 'ku0we', 'kvth0we', 'web', 'wec', 'scref', 'xjbvs', 'xjbvd', 'bvs', 'bvd',
  'jss', 'jsws', 'jswgs', 'njs', 'cjs', 'mjs', 'pbs', 'cjsws', 'mjsws', 'pbsws', 'cjswgs', 'mjswgs', 'pbswgs', 'xtis',
  'jsd', 'jswd', 'jswgd', 'njd', 'cjd', 'mjd', 'pbd', 'cjswd', 'mjswd', 'pbswd', 'cjswgd', 'mjswgd', 'pbswgd', 'xtid',
  'cgidl', 'egidl', 'agidl', 'bgidl', 'cgisl', 'egisl', 'agisl', 'bgisl', 'aigc', 'bigc', 'cigc', 'aigsd', 'bigsd',
  'cigsd', 'nigc', 'poxedge', 'pigcd', 'ntox', 'toxref', 'aigbacc', 'bigbacc', 'cigbacc', 'aigbinv', 'bigbinv',
  'cigbinv', 'nigbacc', 'nigbinv', 'eigbinv', 'dlcig', 'dlcigd', 'dwj', 'xrcrg1', 'xrcrg2', 'tvoff', 'tvfbsdoff',
]);

const INSTANCE_KEYS = new Set(['w', 'l', 'ad', 'as', 'pd', 'ps', 'nrd', 'nrs', 'm', 'off', 'ic_vds', 'ic_vgs', 'ic_vbs', 'icvds', 'icvgs', 'icvbs', 'temp', 'dtemp', 'delvto', 'nqsmod']);

/** Intrinsic carrier density of silicon at 300.15 K, cm^-3. */
const NI0 = 1.45e10;

/** Bias-independent per-instance values at one temperature. */
interface B3Inst {
  T: number;
  vt: number;
  leff: number;
  weff: number;
  m: number;
  cox: number;
  phi: number;
  sqrtPhi: number;
  xdep0: number;
  litl: number;
  vbi: number;
  cdep0: number;
  /** device-polarity zero-bias threshold (with temperature shift and DELVTO) */
  vth0: number;
  k1: number;
  k2: number;
  vbc: number;
  /** temperature-adjusted mobility, m^2/Vs, and degradation coefficients */
  u0: number;
  ua: number;
  ub: number;
  uc: number;
  vsat: number;
  rdsw: number;
  /** KT1 + KT1L/Leff and KT2 for the bias-dependent threshold temperature shift */
  kt1: number;
  kt2: number;
  tRatio: number;
  p: Bsim3Values;
  gd: number;
  gs: number;
  isd: number;
  iss: number;
  vcritD: number;
  vcritS: number;
  depBd: DepletionCoeffs;
  depBdSw: DepletionCoeffs;
  depBs: DepletionCoeffs;
  depBsSw: DepletionCoeffs;
  cgso: number;
  cgdo: number;
  cgbo: number;
  /** BSIM4 flavour: threshold LPE terms, mobility model, charge geometry (BSIM3: neutral values) */
  b4: boolean;
  k1eff: number;
  k2eff: number;
  lpe0F: number;
  lpebF: number;
  vtfbphi1: number;
  leffQ: number;
  weffQ: number;
}

/** DC core result (mode-local) as duals of the global terminal voltages. */
interface B3Dc {
  ids: Dual;
  vth: Dual;
  vdsat: Dual;
  abulk0: Dual;
  phis: Dual;
  sqrtPhis: Dual;
  vbseff: Dual;
}

/** Terminal charges (global orientation) as duals. */
interface B3Charges {
  qg: Dual;
  qd: Dual;
  qb: Dual;
}

function clampLow(x: Dual, lo: number): Dual {
  return x.v < lo ? dconst(lo) : x;
}

/** DC drain current and threshold in mode-local voltages (duals carrying global partials). */
function bsim3Dc(vgs: Dual, vds: Dual, vbs: Dual, t: B3Inst): B3Dc {
  const p = t.p;
  const vt = t.vt;
  const cox = t.cox;
  const leff = t.leff;
  // Vbseff: smooth upper limit of the body bias (K2 effect) and a hard limit below phi
  const T0 = addc(vbs, -t.vbc - 0.001);
  let vbseff = addc(scale(add(T0, dsqrt(addc(mul(T0, T0), -0.004 * t.vbc))), 0.5), t.vbc);
  if (vbseff.v > 0.95 * t.phi) vbseff = dconst(0.95 * t.phi);
  const phis = addc(neg(vbseff), t.phi);
  const sqrtPhis = dsqrt(phis);
  const xdep = scale(sqrtPhis, t.xdep0 / t.sqrtPhi);
  const factor1 = Math.sqrt(EPS_SI / cox);
  // short-channel characteristic lengths
  const lt1 = mul(scale(dsqrt(xdep), factor1), addc(scale(vbseff, p.dvt2), 1));
  const ltw = mul(scale(dsqrt(xdep), factor1), addc(scale(vbseff, p.dvt2w), 1));
  const lt0 = factor1 * Math.sqrt(t.xdep0);
  const e1 = dexp(div(dconst(-0.5 * p.dvt1 * leff), lt1));
  const theta0 = mul(e1, addc(scale(e1, 2), 1));
  const ew = dexp(div(dconst(-0.5 * p.dvt1w * t.weff * leff), ltw));
  const thetaW = mul(ew, addc(scale(ew, 2), 1));
  const ed = Math.exp((-0.5 * p.dsub * leff) / lt0);
  const thetaDibl = ed * (1 + 2 * ed);
  // body effect: BSIM3 K1 (sqrt(Phis) - sqrt(Phi)) with the NLX term; BSIM4 K1ox sqrt(Phis) - K1 sqrt(Phi), scaled by
  // sqrt(1 + LPEB/Leff), plus K1ox (sqrt(1 + LPE0/Leff) - 1) sqrt(Phi) (lateral non-uniform doping), K2ox for the linear term
  const body = t.b4
    ? addc(scale(sqrtPhis, t.k1eff * t.lpebF), t.vth0 + t.k1eff * (t.lpe0F - 1) * t.sqrtPhi - t.k1 * t.sqrtPhi * t.lpebF)
    : addc(scale(sub(sqrtPhis, dconst(t.sqrtPhi)), t.k1), t.vth0 + t.k1 * (Math.sqrt(1 + p.nlx / leff) - 1) * t.sqrtPhi);
  const vth = add(
    add(
      body,
      scale(vbseff, -t.k2eff),
    ),
    add(
      add(scale(addc(scale(vbseff, p.k3b), p.k3), (p.tox * t.phi) / (t.weff + p.w0)), scale(theta0, -p.dvt0 * (t.vbi - t.phi))),
      add(scale(thetaW, -p.dvt0w * (t.vbi - t.phi)), scale(mul(addc(scale(vbseff, p.etab), p.eta0), vds), -thetaDibl)),
    ),
  );
  // temperature shift with the body-bias dependent KT2 term
  const vthT = add(vth, scale(addc(scale(vbseff, t.kt2), t.kt1), t.tRatio - 1));

  // subthreshold swing
  const tmp2 = div(dconst(p.nfactor * EPS_SI), xdep);
  const tmp3 = add(addc(scale(vbseff, p.cdscb), p.cdsc), scale(vds, p.cdscd));
  const tmp4 = scale(add(add(tmp2, mul(tmp3, theta0)), dconst(p.cit)), 1 / cox);
  const n = tmp4.v >= -0.5 ? addc(tmp4, 1) : div(addc(scale(tmp4, 3), 1), addc(scale(tmp4, 8), 3));
  const n2vt = scale(n, 2 * vt);
  const vgst = sub(vgs, vthT);
  const num = mul(n2vt, dsoftplus(div(vgst, n2vt)));
  const den = addc(scale(mul(n, dexp(div(addc(neg(vgst), 2 * p.voff), n2vt))), (2 * cox) / t.cdep0), 1);
  const vgsteff = div(num, den);

  // bias-dependent width, source/drain resistance
  const dsq = sub(sqrtPhis, dconst(t.sqrtPhi));
  const weffB = clampLow(addc(scale(add(scale(vgsteff, p.dwg), scale(dsq, p.dwb)), -2), t.weff), 0.02 * t.weff);
  // evaluated for one device; the parallel multiplier m scales the final current
  let rds = dconst(0);
  if (t.rdsw > 0) {
    const f = clampLow(addc(add(scale(vgsteff, p.prwg), scale(dsq, p.prwb)), 1), 0.01);
    rds = scale(f, t.rdsw / Math.pow(t.weff * 1e6, p.wr));
  }

  // bulk-charge factor
  const t1 = div(dconst(0.5 * t.k1eff), sqrtPhis);
  const t9 = dsqrt(scale(xdep, p.xj));
  const t5 = div(dconst(leff), addc(scale(t9, 2), leff));
  const bw = div(dconst(p.b0), addc(weffB, p.b1));
  const ketaF = addc(scale(vbseff, p.keta), 1);
  const ketaD = ketaF.v > 0.05 ? ketaF : dconst(0.05);
  const abulk0 = div(addc(mul(t1, add(scale(t5, p.a0), bw)), 1), ketaD);
  let abulk = div(addc(mul(t1, add(mul(scale(t5, p.a0), addc(scale(mul(vgsteff, mul(t5, t5)), -p.ags), 1)), bw)), 1), ketaD);
  abulk = clampLow(abulk, 0.1);

  // mobility
  const tox = p.tox;
  let denomU: Dual;
  const vth2 = scale(vthT, 2);
  if (t.b4) {
    // BSIM4 mobMod 0 / 1 / 2 (BSIM4 manual): 1 + (UA + UC Vbs) E + UB E^2 ; 1 + (UA E + UB E^2)(1 + UC Vbs) ; 1 + (UA + UC Vbs) E2^EU
    const mm = Math.round(p.mobmod);
    if (mm === 1) {
      const e = scale(add(vgsteff, vth2), 1 / tox);
      denomU = addc(mul(add(scale(e, t.ua), scale(mul(e, e), t.ub)), addc(scale(vbseff, t.uc), 1)), 1);
    } else if (mm === 2) {
      const e2 = scale(addc(vgsteff, t.vtfbphi1), 1 / tox);
      denomU = addc(mul(addc(scale(vbseff, t.uc), t.ua), dpow(e2, p.eu)), 1);
    } else {
      const e = scale(add(vgsteff, vth2), 1 / tox);
      denomU = addc(add(mul(addc(scale(vbseff, t.uc), t.ua), e), scale(mul(e, e), t.ub)), 1);
    }
  } else if (p.mobmod === 2) {
    const e = scale(vgsteff, 1 / tox);
    denomU = addc(add(mul(addc(scale(vbseff, t.uc), t.ua), e), scale(mul(e, e), t.ub)), 1);
  } else if (p.mobmod === 3) {
    const e = scale(add(vgsteff, vth2), 1 / tox);
    denomU = addc(mul(add(scale(e, t.ua), scale(mul(e, e), t.ub)), addc(scale(vbseff, t.uc), 1)), 1);
  } else {
    const e = scale(add(vgsteff, vth2), 1 / tox);
    denomU = addc(add(mul(addc(scale(vbseff, t.uc), t.ua), e), scale(mul(e, e), t.ub)), 1);
  }
  denomU = clampLow(denomU, 0.2);
  const ueff = div(dconst(t.u0), denomU);
  const esatL = scale(div(dconst(2 * t.vsat), ueff), leff);

  // saturation voltage
  let lambda = dconst(p.a2);
  if (p.a1 !== 0) lambda = addc(scale(vgsteff, p.a1), p.a2);
  if (lambda.v > 1) lambda = dconst(1);
  if (lambda.v < 0.01) lambda = dconst(0.01);
  const vgst2vt = addc(vgsteff, 2 * vt);
  const wvcox = mul(weffB, dconst(t.vsat * cox));
  const wvcoxRds = mul(wvcox, rds);
  // a Vdsat^2 + b Vdsat + c = 0, smaller root in the cancellation-free form 2c / (-b + sqrt(b^2 - 4ac));
  // with a = 0 (lambda = 1, no Rds) it reduces to EsatL Vgst2Vt / (Abulk EsatL + Vgst2Vt)
  const invLam = div(dconst(1), lambda);
  const a = add(mul(mul(abulk, abulk), wvcoxRds), mul(addc(invLam, -1), abulk));
  const b = neg(add(add(mul(vgst2vt, addc(scale(invLam, 2), -1)), mul(abulk, esatL)), scale(mul(mul(abulk, vgst2vt), wvcoxRds), 3)));
  const c = add(mul(vgst2vt, esatL), scale(mul(mul(vgst2vt, vgst2vt), wvcoxRds), 2));
  const disc = sub(mul(b, b), scale(mul(a, c), 4));
  let vdsat = div(scale(c, 2), add(neg(b), dsqrt(dmax(disc, dconst(0)))));
  vdsat = clampLow(vdsat, 1e-6);
  const dl = p.delta;
  const td = addc(sub(vdsat, vds), -dl);
  let vdseff = sub(vdsat, scale(add(td, dsqrt(add(mul(td, td), scale(vdsat, 4 * dl)))), 0.5));
  vdseff = dmin(dmax(vdseff, dconst(0)), vds.v >= 0 ? vds : dconst(0));

  // current
  const gch = div(
    mul(mul(scale(weffB, cox / leff), ueff), mul(vgsteff, addc(scale(div(mul(abulk, vdseff), vgst2vt), -0.5), 1))),
    addc(div(vdseff, esatL), 1),
  );
  let ids = div(mul(gch, vdseff), addc(mul(rds, gch), 1));

  // Early voltages
  const over = sub(vds, vdseff);
  if (over.v > 0) {
    const rv = mul(rds, wvcox);
    const vasat = div(
      add(add(esatL, vdsat), scale(mul(mul(rv, vgsteff), addc(scale(div(mul(abulk, vdsat), vgst2vt), -0.5), 1)), 2)),
      add(addc(scale(invLam, 2), -1), mul(rv, abulk)),
    );
    let vaclm: Dual | null = null;
    if (p.pclm > 0) vaclm = mul(div(add(mul(abulk, esatL), vgsteff), scale(mul(abulk, esatL), p.pclm * t.litl)), over);
    const er = Math.exp((-0.5 * p.drout * leff) / lt0);
    const thetaRout = p.pdiblc1 * er * (1 + 2 * er) + p.pdiblc2;
    let vadibl: Dual | null = null;
    if (thetaRout > 0) {
      const f = addc(scale(vbseff, p.pdiblcb), 1);
      vadibl = mul(div(vgst2vt, scale(clampLow(f, 0.05), thetaRout)), addc(neg(div(mul(abulk, vdsat), add(mul(abulk, vdsat), vgst2vt))), 1));
    }
    let vap: Dual | null = null;
    if (vaclm && vadibl) vap = div(mul(vaclm, vadibl), add(vaclm, vadibl));
    else vap = vaclm ?? vadibl;
    if (vap) {
      const va = add(vasat, mul(addc(div(scale(vgsteff, p.pvag), esatL), 1), vap));
      ids = mul(ids, addc(div(over, va), 1));
    }
    if (p.pscbe2 > 0) {
      const arg = div(dconst(-p.pscbe1 * t.litl), over);
      // 1/VASCBE = PSCBE2/Leff exp(-PSCBE1 litl/(Vds - Vdseff))
      const inv = scale(dexp(arg), p.pscbe2 / leff);
      ids = mul(ids, addc(mul(over, inv), 1));
    }
  }
  return { ids: scale(ids, t.m), vth: vthT, vdsat, abulk0, phis, sqrtPhis, vbseff };
}

/** Intrinsic charges (BSIM3 capMod 0 form) in mode-local coordinates. */
function bsim3Charges(vgs: Dual, vds: Dual, vbs: Dual, dc: B3Dc, t: B3Inst): B3Charges {
  const cwl = t.cox * t.weffQ * t.leffQ * t.m;
  if (!(cwl > 0)) return { qg: dconst(0), qd: dconst(0), qb: dconst(0) };
  const k1 = t.k1eff;
  const vfb = sub(sub(dc.vth, dc.phis), scale(dc.sqrtPhis, k1));
  const vgb = sub(vgs, dc.vbseff);
  const arg1 = sub(vgb, vfb);
  const vgst = sub(vgs, dc.vth);
  const zero = dconst(0);
  if (arg1.v <= 0) {
    const qg = scale(arg1, cwl);
    return { qg, qd: zero, qb: neg(qg) };
  }
  if (vgst.v <= 0) {
    const k12 = k1 * k1;
    const qg = k12 > 0 ? scale(addc(dsqrt(addc(scale(arg1, 4 / k12), 1)), -1), (cwl * k12) / 2) : scale(arg1, cwl);
    return { qg, qd: zero, qb: neg(qg) };
  }
  const ab = clampLow(dc.abulk0, 0.1);
  const vdsatCv = div(vgst, ab);
  const vdx = dmin(vds, vdsatCv);
  const av = mul(ab, vdx);
  const dd = sub(vgst, scale(av, 0.5));
  const qg = scale(add(sub(sub(sub(vgs, vfb), dc.phis), scale(vdx, 0.5)), div(mul(av, vdx), scale(dd, 12))), cwl);
  const qinv = scale(add(sub(vgst, scale(av, 0.5)), div(mul(av, av), scale(dd, 12))), -cwl);
  const qb = neg(add(qg, qinv));
  let qd: Dual;
  const xpart = t.p.xpart;
  if (xpart >= 1) {
    // 0/100
    qd = scale(add(sub(scale(vgst, 0.5), scale(av, 0.75)), div(mul(av, av), scale(dd, 8))), -cwl);
  } else if (xpart >= 0.5) {
    qd = scale(qinv, 0.5);
  } else {
    // 40/60 (Ward-Dutton)
    const vg2 = mul(vgst, vgst);
    const poly = add(sub(scale(vg2, 1 / 6), scale(mul(av, vgst), 1 / 8)), scale(mul(av, av), 1 / 40));
    qd = scale(add(sub(scale(vgst, 0.5), scale(av, 0.5)), div(mul(av, poly), mul(dd, dd))), -cwl);
  }
  return { qg, qd, qb };
}

/** Full evaluation in global orientation. */
interface B3Eval {
  mode: number;
  /** channel current d' -> s' (device polarity) and its partials (vgs, vds, vbs) */
  cd: Dual;
  vth: number;
  vdsat: number;
  ibs: number;
  gbs: number;
  ibd: number;
  gbd: number;
  qbs: number;
  capbs: number;
  qbd: number;
  capbd: number;
  q: B3Charges;
}

const S_VBS = 0;
const S_VGS = 1;
const S_VDS = 2;
const S_QG = 3;
const S_QD = 5;
const S_QB = 7;
const S_QBD = 9;
const S_QBS = 11;
const N_STATES = 13;

export class Bsim3 implements Device {
  readonly type = 'M' as const;
  readonly name: string;
  readonly nodeNames: string[];

  private readonly modelName: string | undefined;
  private card: ModelCard | undefined;
  private readonly inst: Record<string, number>;
  private readonly overrides: Record<string, number> = {};
  private base: Bsim3Values = { ...BSIM4_DEFAULTS, ...BSIM3_DEFAULTS };
  /** BSIM4 flavour (LEVEL 14 / 54): own defaults, aliases and equations where BSIM4 differs */
  private b4 = false;
  private defaults: Readonly<Record<string, number>> = BSIM3_DEFAULTS;
  private aliases: Readonly<Record<string, Bsim3Param>> = ALIASES3;
  private given = new Set<string>();
  private bins: Record<string, { l: number; w: number; p: number }> = {};
  private pol = 1;
  private tnomDefaultC = 27;
  private ctxTempK = celsiusToKelvin(27);
  private defW = DEFAULT_MOS_W;
  private defL = DEFAULT_MOS_L;
  private defAd = 0;
  private defAs = 0;
  private warn: (m: string) => void = () => undefined;

  private nD = GROUND;
  private nG = GROUND;
  private nS = GROUND;
  private nB = GROUND;
  private nDi = GROUND;
  private nSi = GROUND;
  private hasRd = false;
  private hasRs = false;
  private st = 0;
  private tcache: B3Inst | undefined;

  private loaded = false;
  private lastVth = Number.NaN;
  private lastVgs = 0;
  private lastVds = 0;
  private lastVbs = 0;
  private lastId = 0;
  private lastIb = 0;
  private lastG = [0, 0, 0];
  private lastGbs = 0;
  private lastGbd = 0;
  private lastGmin = 0;
  /** charge currents (device polarity) qg qd qb qbd qbs at the last transient load */
  private readonly qCur = new Float64Array(5);
  private readonly cc: ChargeCap = { q: 0, c: 0 };

  constructor(el: ElementIR) {
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
    this.modelName = el.model;
    this.inst = { ...el.params };
  }

  setup(ctx: SetupContext): void {
    if (this.nodeNames.length < 3) throw new Error(`${this.name}: MOSFET needs 4 nodes (d g s b)`);
    const { card, type } = findModel(ctx, this.name, this.modelName, ['NMOS', 'PMOS'], 'NMOS');
    this.card = card;
    this.pol = type === 'PMOS' ? -1 : 1;
    this.tnomDefaultC = ctx.options.tnom;
    this.ctxTempK = celsiusToKelvin(ctx.options.temp);
    const o = ctx.options;
    if (o.defw > 0) this.defW = o.defw;
    if (o.defl > 0) this.defL = o.defl;
    if (o.defad >= 0) this.defAd = o.defad;
    if (o.defas >= 0) this.defAs = o.defas;
    const warned = new Set<string>();
    this.warn = (m) => {
      if (warned.has(m)) return;
      warned.add(m);
      ctx.warn(m);
    };
    this.useFlavour(card && Number.isFinite(card.params.level) ? Math.round(card.params.level) : 49);
    warnUnknownParams(ctx, card, this.resolve());
    this.nD = ctx.node(this.nodeNames[0]);
    this.nG = ctx.node(this.nodeNames[1]);
    this.nS = ctx.node(this.nodeNames[2]);
    this.nB = this.nodeNames.length > 3 ? ctx.node(this.nodeNames[3]) : this.nS;
    const t = this.temps(this.ctxTempK);
    this.hasRd = t.gd > 0;
    this.hasRs = t.gs > 0;
    this.nDi = this.hasRd ? ctx.node(`${this.name}#d`) : this.nD;
    this.nSi = this.hasRs ? ctx.node(`${this.name}#s`) : this.nS;
    this.st = ctx.state(N_STATES);
  }

  /** Choose the BSIM3 or the BSIM4 parameter set from the model level. */
  private useFlavour(level: number): void {
    this.b4 = BSIM4_LEVELS.has(level);
    this.defaults = this.b4 ? BSIM4_DEFAULTS : BSIM3_DEFAULTS;
    this.aliases = this.b4 ? ALIASES4 : ALIASES3;
  }

  /** True for a BSIM4 (LEVEL 14 / 54) model card. */
  get isBsim4(): boolean {
    return this.b4;
  }

  /** Resolve the card: canonical names, aliases, binning terms; returns unknown keys. */
  private resolve(): string[] {
    const p: Bsim3Values = { ...BSIM4_DEFAULTS, ...this.defaults };
    const given = new Set<string>();
    const bins: Record<string, { l: number; w: number; p: number }> = {};
    const unknown: string[] = [];
    const canon = (k: string): Bsim3Param | undefined => {
      if (Object.prototype.hasOwnProperty.call(this.defaults, k)) return k as Bsim3Param;
      return Object.prototype.hasOwnProperty.call(this.aliases, k) ? this.aliases[k] : undefined;
    };
    const apply = (src: Readonly<Record<string, number>>, report: boolean) => {
      for (const [key, value] of Object.entries(src)) {
        const k = key.toLowerCase();
        if (!Number.isFinite(value)) continue;
        const c = canon(k);
        if (c) {
          p[c] = value;
          given.add(c);
          continue;
        }
        const pre = k.charAt(0);
        const rest = canon(k.slice(1)) ?? k.slice(1);
        if ((pre === 'l' || pre === 'w' || pre === 'p') && BINNABLE.has(rest)) {
          const b = (bins[rest] ??= { l: 0, w: 0, p: 0 });
          b[pre as 'l' | 'w' | 'p'] = value;
          given.add(rest);
          continue;
        }
        if (report && !ACCEPTED.has(k)) unknown.push(k);
      }
    };
    if (this.card) apply(this.card.params, true);
    apply(this.overrides, false);
    this.base = p;
    this.given = given;
    this.bins = bins;
    this.tcache = undefined;
    return unknown;
  }

  private ip(key: string, def: number): number {
    return instanceParam(this.inst, [key]) ?? def;
  }

  /** Effective value of a binnable parameter for this geometry. */
  private binned(key: Bsim3Param, leff: number, weff: number): number {
    const v = this.base[key];
    const b = this.bins[key];
    if (!b) return v;
    const il = 1e-6 / leff;
    const iw = 1e-6 / weff;
    return v + b.l * il + b.w * iw + b.p * il * iw;
  }

  private temps(ctxTemp: number): B3Inst {
    const tInst = instanceParam(this.inst, ['temp']);
    const T = tInst !== undefined ? celsiusToKelvin(tInst) : ctxTemp + (instanceParam(this.inst, ['dtemp']) ?? 0);
    if (this.tcache && this.tcache.T === T) return this.tcache;
    const type = this.pol;
    const b = this.base;
    const m = this.ip('m', 1);
    const w = this.ip('w', this.defW);
    const l = this.ip('l', this.defL);
    // effective geometry
    const dl = b.lint + b.ll / Math.pow(l, b.lln) + b.lw / Math.pow(w, b.lwn) + b.lwl / (Math.pow(l, b.lln) * Math.pow(w, b.lwn));
    const dw = b.wint + b.wl / Math.pow(l, b.wln) + b.ww / Math.pow(w, b.wwn) + b.wwl / (Math.pow(l, b.wln) * Math.pow(w, b.wwn));
    let leff = l - 2 * dl;
    let weff = w - 2 * dw;
    if (!(leff > 0)) {
      this.warn(`${this.name}: effective channel length <= 0, using L`);
      leff = l;
    }
    if (!(weff > 0)) {
      this.warn(`${this.name}: effective channel width <= 0, using W`);
      weff = w;
    }
    const p = {} as Bsim3Values;
    for (const k of Object.keys(this.defaults) as Bsim3Param[]) p[k] = BINNABLE.has(k) ? this.binned(k, leff, weff) : b[k];
    // unit conventions
    if (p.nch > 1e20) p.nch *= 1e-6;
    if (p.nsub > 1e20) p.nsub *= 1e-6;
    if (this.b4) {
      // BSIM4 defaults that depend on the polarity and on the mobility model
      if (!Number.isFinite(p.u0)) p.u0 = type > 0 ? 0.067 : 0.025;
      if (!Number.isFinite(p.eu)) p.eu = type > 0 ? 1.67 : 1;
      const mm = Math.round(p.mobmod);
      if (!Number.isFinite(p.ua)) p.ua = mm === 2 ? 1e-15 : 1e-9;
      if (!Number.isFinite(p.uc)) p.uc = mm === 1 ? -0.0465 : mm === 2 ? -0.0465e-15 : -0.0465e-9;
      if (!Number.isFinite(p.uc1)) p.uc1 = mm === 1 ? -0.056 : -5.6e-11;
      if (!(p.tox > 0)) p.tox = 3e-9;
      if (!(p.toxm > 0)) p.toxm = p.tox;
    } else {
      if (!Number.isFinite(p.u0)) p.u0 = type > 0 ? 670 : 250;
      if (!Number.isFinite(p.uc)) p.uc = p.mobmod === 3 ? -0.0465 : -4.65e-11;
      if (!Number.isFinite(p.uc1)) p.uc1 = p.mobmod === 3 ? -0.056 : -5.6e-11;
      if (!(p.tox > 0)) p.tox = 1.5e-8;
    }
    const u0 = p.u0 > 1 ? p.u0 * 1e-4 : p.u0;
    if (!Number.isFinite(p.dsub)) p.dsub = p.drout;
    const tnom = celsiusToKelvin(Number.isFinite(p.tnom) ? p.tnom : this.tnomDefaultC);
    const cox = EPS_OX / p.tox;
    const vtm0 = K_OVER_Q * tnom;
    const eg0 = siliconBandGap(tnom);
    const ni = NI0 * Math.pow(tnom / 300.15, 1.5) * Math.exp(21.5565981 - eg0 / (2 * vtm0));
    const phi = Math.max(0.1, 2 * vtm0 * Math.log(p.nch / ni));
    const sqrtPhi = Math.sqrt(phi);
    const xdep0 = Math.sqrt((2 * EPS_SI) / (CHARGE * p.nch * 1e6)) * sqrtPhi;
    const litl = Math.sqrt(3 * p.xj * p.tox);
    const vbi = vtm0 * Math.log((1e20 * p.nch) / (ni * ni));
    const cdep0 = Math.sqrt((CHARGE * EPS_SI * p.nch * 1e6) / 2 / phi);
    // body-effect coefficients from the doping profile when not given
    let k1 = p.k1;
    let k2 = p.k2;
    if (!this.given.has('k1') || !this.given.has('k2')) {
      const g1 = Math.sqrt(2 * CHARGE * EPS_SI * p.nch * 1e6) / cox;
      const g2 = Math.sqrt(2 * CHARGE * EPS_SI * p.nsub * 1e6) / cox;
      const vbx = phi - (CHARGE * p.nch * 1e6 * p.xt * p.xt) / (2 * EPS_SI);
      const vbm = Math.min(p.vbm, -0.1);
      const t0 = g1 - g2;
      const t1 = Math.sqrt(phi - vbx) - sqrtPhi;
      const t2 = Math.sqrt(phi * (phi - vbm)) - phi;
      const k2c = (t0 * t1) / (2 * t2 + vbm);
      const k1c = g2 - 2 * k2c * Math.sqrt(phi - vbm);
      if (!this.given.has('k2')) k2 = this.given.has('k1') ? 0 : k2c;
      if (!this.given.has('k1')) k1 = this.given.has('k2') ? 0.53 : k1c;
    }
    let vth0 = p.vth0;
    if (!Number.isFinite(vth0)) vth0 = Number.isFinite(p.vfb) ? p.vfb + type * (phi + k1 * sqrtPhi) : 0.7 * type;
    vth0 += instanceParam(this.inst, ['delvto']) ?? 0;
    let vbc = -30;
    if (k2 < 0) {
      vbc = 0.9 * (phi - (k1 * k1) / (4 * k2 * k2));
      if (vbc > -3) vbc = -3;
      if (vbc < -30) vbc = -30;
    }
    const T_ = T;
    const vt = K_OVER_Q * T_;
    const ratio = T_ / tnom;
    const tm1 = ratio - 1;
    // junctions
    const egT = siliconBandGap(T_);
    const satFactor = Math.exp((eg0 / vtm0 - egT / vt + p.xti * Math.log(ratio)) / p.nj);
    const ad = this.ip('ad', this.defAd);
    const as = this.ip('as', this.defAs);
    const pd = this.ip('pd', 0);
    const ps = this.ip('ps', 0);
    const isd = (p.js * ad + p.jsw * pd) * satFactor * m;
    const iss = (p.js * as + p.jsw * ps) * satFactor * m;
    const jb = junctionTemperature(p.pb, p.mj, tnom, T_);
    const jsw = junctionTemperature(p.pbsw, p.mjsw, tnom, T_);
    // BSIM4: capacitance geometry from DLC / DWC (default LINT / WINT), overlap CGSO = DLC Cox - CGSL when DLC > 0,
    // fringing CF = 2 eps_ox / pi ln(1 + 4e-7 / TOXE)
    const dlcV = this.b4 ? (Number.isFinite(p.dlc) ? p.dlc : p.lint) : 0;
    const dwcV = this.b4 ? (Number.isFinite(p.dwc) ? p.dwc : p.wint) : 0;
    const leffQ = this.b4 && l - 2 * dlcV > 0 ? l - 2 * dlcV : leff;
    const weffQ = this.b4 && w - 2 * dwcV > 0 ? w - 2 * dwcV : weff;
    const overlapDefault = (cgl: number): number => (this.b4 && dlcV > 0 ? Math.max(dlcV * cox - cgl, 0) : 0.6 * p.xj * cox);
    const cgso = Number.isFinite(p.cgso) ? p.cgso : overlapDefault(p.cgsl);
    const cgdo = Number.isFinite(p.cgdo) ? p.cgdo : overlapDefault(p.cgdl);
    const cfV = Number.isFinite(p.cf) ? p.cf : this.b4 ? ((2 * EPS_OX) / Math.PI) * Math.log(1 + 4e-7 / p.tox) : 0;
    const toxRatio = this.b4 ? p.tox / p.toxm : 1;
    let rd = 0;
    let rs = 0;
    if (p.rsh > 0) {
      rd = p.rsh * this.ip('nrd', 0);
      rs = p.rsh * this.ip('nrs', 0);
    }
    const t: B3Inst = {
      T: T_,
      vt,
      leff,
      weff,
      m,
      cox,
      phi,
      sqrtPhi,
      xdep0,
      litl,
      vbi,
      cdep0,
      vth0: type * vth0,
      k1,
      k2,
      vbc,
      u0: u0 * Math.pow(ratio, p.ute),
      ua: p.ua + p.ua1 * tm1,
      ub: p.ub + p.ub1 * tm1,
      uc: p.uc + p.uc1 * tm1,
      vsat: Math.max(1, p.vsat - p.at * tm1),
      rdsw: Math.max(0, p.rdsw + p.prt * tm1),
      kt1: p.kt1 + p.kt1l / leff,
      kt2: p.kt2,
      tRatio: ratio,
      p,
      gd: rd > 0 ? m / rd : 0,
      gs: rs > 0 ? m / rs : 0,
      isd,
      iss,
      vcritD: junctionVcrit(vt, isd),
      vcritS: junctionVcrit(vt, iss),
      depBd: depletionCoeffs(p.cj * ad * m * jb.capFactor, jb.pot, p.mj, p.fc),
      depBdSw: depletionCoeffs(p.cjsw * pd * m * jsw.capFactor, jsw.pot, p.mjsw, p.fc),
      depBs: depletionCoeffs(p.cj * as * m * jb.capFactor, jb.pot, p.mj, p.fc),
      depBsSw: depletionCoeffs(p.cjsw * ps * m * jsw.capFactor, jsw.pot, p.mjsw, p.fc),
      cgso: (cgso + cfV) * weffQ * m,
      cgdo: (cgdo + cfV) * weffQ * m,
      cgbo: p.cgbo * leffQ * m,
      b4: this.b4,
      k1eff: k1 * toxRatio,
      k2eff: k2 * toxRatio,
      lpe0F: this.b4 ? Math.sqrt(1 + p.lpe0 / leff) : 1,
      lpebF: this.b4 ? Math.sqrt(1 + p.lpeb / leff) : 1,
      vtfbphi1: (type > 0 ? 2 : 2.5) * k1 * toxRatio * sqrtPhi,
      leffQ,
      weffQ,
    };
    this.tcache = t;
    return t;
  }

  /** Evaluate at device-polarity terminal voltages (global orientation). */
  private evaluate(vgsN: number, vdsN: number, vbsN: number, t: B3Inst, withCharges: boolean): B3Eval {
    const vgs = dual(vgsN, 1, 0, 0);
    const vds = dual(vdsN, 0, 1, 0);
    const vbs = dual(vbsN, 0, 0, 1);
    const vbdN = vbsN - vdsN;
    const e: B3Eval = {
      mode: 1,
      cd: dconst(0),
      vth: 0,
      vdsat: 0,
      ibs: 0,
      gbs: 0,
      ibd: 0,
      gbd: 0,
      qbs: 0,
      capbs: 0,
      qbd: 0,
      capbd: 0,
      q: { qg: dconst(0), qd: dconst(0), qb: dconst(0) },
    };
    const nvt = t.p.nj * t.vt;
    let a = vbsN / nvt;
    e.ibs = t.iss * (expLin(a) - 1);
    e.gbs = (t.iss * expLinDeriv(a)) / nvt;
    a = vbdN / nvt;
    e.ibd = t.isd * (expLin(a) - 1);
    e.gbd = (t.isd * expLinDeriv(a)) / nvt;
    if (vdsN >= 0) {
      const dc = bsim3Dc(vgs, vds, vbs, t);
      e.cd = dc.ids;
      e.vth = dc.vth.v;
      e.vdsat = dc.vdsat.v;
      if (withCharges) e.q = bsim3Charges(vgs, vds, vbs, dc, t);
    } else {
      e.mode = -1;
      // local frame: source and drain exchanged
      const lg = sub(vgs, vds);
      const ld = neg(vds);
      const lb = sub(vbs, vds);
      const dc = bsim3Dc(lg, ld, lb, t);
      e.cd = neg(dc.ids);
      e.vth = dc.vth.v;
      e.vdsat = dc.vdsat.v;
      if (withCharges) {
        const q = bsim3Charges(lg, ld, lb, dc, t);
        // the local drain is the global source: Qd(global) = Qs(local) = -(Qg + Qd + Qb)
        e.q = { qg: q.qg, qb: q.qb, qd: neg(add(add(q.qg, q.qd), q.qb)) };
      }
    }
    if (withCharges) {
      depletionCharge(vbsN, t.depBs, this.cc);
      e.qbs = this.cc.q;
      e.capbs = this.cc.c;
      depletionCharge(vbsN, t.depBsSw, this.cc);
      e.qbs += this.cc.q;
      e.capbs += this.cc.c;
      depletionCharge(vbdN, t.depBd, this.cc);
      e.qbd = this.cc.q;
      e.capbd = this.cc.c;
      depletionCharge(vbdN, t.depBdSw, this.cc);
      e.qbd += this.cc.q;
      e.capbd += this.cc.c;
    }
    return e;
  }

  private voltages(x: (i: number) => number): { vgs: number; vds: number; vbs: number } {
    const s = this.pol;
    const vsi = x(this.nSi);
    return { vgs: s * (x(this.nG) - vsi), vds: s * (x(this.nDi) - vsi), vbs: s * (x(this.nB) - vsi) };
  }

  private stampBranch(ctx: LoadContext, a: number, b: number, i: number, g0: number, g1: number, g2: number, vgs: number, vds: number, vbs: number): void {
    stampVccs(ctx, a, b, this.nG, this.nSi, g0);
    stampVccs(ctx, a, b, this.nDi, this.nSi, g1);
    stampVccs(ctx, a, b, this.nB, this.nSi, g2);
    stampCurrent(ctx, a, b, this.pol * (i - g0 * vgs - g1 * vds - g2 * vbs));
  }

  load(ctx: LoadContext): void {
    this.ctxTempK = ctx.temp;
    const t = this.temps(ctx.temp);
    const type = this.pol;
    const s0 = ctx.state0;
    const st = this.st;
    const v = this.voltages(ctx.x);
    let vgs = v.vgs;
    let vds = v.vds;
    let vbs = v.vbs;
    let limited = false;
    if (ctx.uic && ctx.tranOp) {
      const icVds = instanceParam(this.inst, ['ic_vds', 'icvds']);
      const icVgs = instanceParam(this.inst, ['ic_vgs', 'icvgs']);
      const icVbs = instanceParam(this.inst, ['ic_vbs', 'icvbs']);
      if (icVds !== undefined) vds = type * icVds;
      if (icVgs !== undefined) vgs = type * icVgs;
      if (icVbs !== undefined) vbs = type * icVbs;
    } else if (ctx.initJunctions) {
      if ((instanceParam(this.inst, ['off']) ?? 0) !== 0) {
        vgs = 0;
        vds = 0;
        vbs = 0;
      } else {
        vds = type * (instanceParam(this.inst, ['ic_vds', 'icvds']) ?? 0);
        vgs = type * (instanceParam(this.inst, ['ic_vgs', 'icvgs']) ?? 0);
        vbs = type * (instanceParam(this.inst, ['ic_vbs', 'icvbs']) ?? 0);
        if (vds === 0 && vgs === 0 && vbs === 0) {
          vbs = 0;
          vgs = t.vth0 + 0.1;
          vds = 0.1;
        }
      }
    } else {
      const old = ctx.initTimepoint ? ctx.state1 : s0;
      const vgsOld = old[st + S_VGS];
      const vdsOld = old[st + S_VDS];
      const vbsOld = old[st + S_VBS];
      const von = Number.isFinite(this.lastVth) ? this.lastVth : t.vth0;
      let vgd = vgs - vds;
      if (vdsOld >= 0) {
        vgs = fetlim(vgs, vgsOld, von);
        vds = vgs - vgd;
        vds = limvds(vds, vdsOld);
        vgd = vgs - vds;
      } else {
        vgd = fetlim(vgd, vgsOld - vdsOld, von);
        vds = vgs - vgd;
        vds = -limvds(-vds, -vdsOld);
        vgs = vgd + vds;
      }
      if (vds >= 0) vbs = pnjlim(vbs, vbsOld, t.vt * t.p.nj, t.vcritS);
      else vbs = pnjlim(vbs - vds, vbsOld - vdsOld, t.vt * t.p.nj, t.vcritD) + vds;
      limited = Math.abs(vgs - v.vgs) + Math.abs(vds - v.vds) + Math.abs(vbs - v.vbs) > 1e-12 * (1 + Math.abs(v.vgs) + Math.abs(v.vds));
    }
    const vbd = vbs - vds;
    const tran = ctx.mode === 'tran' && !ctx.tranOp && ctx.dt > 0;
    const needCharges = ctx.mode === 'tran';
    const e = this.evaluate(vgs, vds, vbs, t, needCharges);
    const gmin = ctx.gmin;
    const { nD, nG, nS, nB, nDi, nSi } = this;
    if (this.hasRd) stampConductance(ctx, nD, nDi, t.gd);
    if (this.hasRs) stampConductance(ctx, nS, nSi, t.gs);
    stampConductance(ctx, nB, nSi, e.gbs + gmin);
    stampCurrent(ctx, nB, nSi, type * (e.ibs - e.gbs * vbs));
    stampConductance(ctx, nB, nDi, e.gbd + gmin);
    stampCurrent(ctx, nB, nDi, type * (e.ibd - e.gbd * vbd));
    this.stampBranch(ctx, nDi, nSi, e.cd.v, e.cd.g, e.cd.d, e.cd.b, vgs, vds, vbs);

    s0[st + S_VBS] = vbs;
    s0[st + S_VGS] = vgs;
    s0[st + S_VDS] = vds;
    this.qCur.fill(0);
    if (needCharges) {
      const vgd = vgs - vds;
      const vgb = vgs - vbs;
      // terminal charges including the overlap capacitances
      const qg = e.q.qg.v + t.cgso * vgs + t.cgdo * vgd + t.cgbo * vgb;
      const qd = e.q.qd.v - t.cgdo * vgd;
      const qb = e.q.qb.v - t.cgbo * vgb;
      if (!tran) {
        s0[st + S_QG] = qg;
        s0[st + S_QD] = qd;
        s0[st + S_QB] = qb;
        s0[st + S_QBD] = e.qbd;
        s0[st + S_QBS] = e.qbs;
        for (const k of [S_QG, S_QD, S_QB, S_QBD, S_QBS]) s0[st + k + 1] = 0;
      } else {
        const terms: [number, number, Dual, [number, number, number], number][] = [
          [S_QG, qg, e.q.qg, [t.cgso + t.cgdo + t.cgbo, -t.cgdo, -t.cgbo], nG],
          [S_QD, qd, e.q.qd, [-t.cgdo, t.cgdo, 0], nDi],
          [S_QB, qb, e.q.qb, [-t.cgbo, 0, t.cgbo], nB],
        ];
        terms.forEach(([slot, q, dq, ov, node], k) => {
          const r = integrateCharge(ctx, st + slot, q, 0, true);
          const ag = r.ag0;
          this.stampBranch(ctx, node, nSi, r.i, (dq.g + ov[0]) * ag, (dq.d + ov[1]) * ag, (dq.b + ov[2]) * ag, vgs, vds, vbs);
          this.qCur[k] = r.i;
        });
        const bd = integrateCharge(ctx, st + S_QBD, e.qbd, e.capbd);
        stampConductance(ctx, nB, nDi, bd.geq);
        stampCurrent(ctx, nB, nDi, type * (bd.i - bd.geq * vbd));
        const bs = integrateCharge(ctx, st + S_QBS, e.qbs, e.capbs);
        stampConductance(ctx, nB, nSi, bs.geq);
        stampCurrent(ctx, nB, nSi, type * (bs.i - bs.geq * vbs));
        this.qCur[3] = bd.i;
        this.qCur[4] = bs.i;
      }
    }
    if (limited) ctx.noncon();
    this.loaded = true;
    this.lastVth = e.vth;
    this.lastVgs = vgs;
    this.lastVds = vds;
    this.lastVbs = vbs;
    this.lastId = e.cd.v - e.ibd;
    this.lastIb = e.ibs + e.ibd;
    this.lastG = [e.cd.g, e.cd.d + e.gbd, e.cd.b - e.gbd];
    this.lastGbs = e.gbs;
    this.lastGbd = e.gbd;
    this.lastGmin = gmin;
  }

  convTest(ctx: LoadContext): boolean {
    if (!this.loaded) return true;
    const v = this.voltages(ctx.x);
    const dvgs = v.vgs - this.lastVgs;
    const dvds = v.vds - this.lastVds;
    const dvbs = v.vbs - this.lastVbs;
    const { reltol, abstol } = ctx.options;
    const [g0, g1, g2] = this.lastG;
    const dId = g0 * dvgs + g1 * dvds + g2 * dvbs;
    const dIb = this.lastGbs * dvbs + this.lastGbd * (dvbs - dvds);
    return currentConverged(this.lastId, dId, reltol, abstol) && currentConverged(this.lastIb, dIb, reltol, abstol);
  }

  acLoad(ctx: AcContext): void {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = this.evaluate(v.vgs, v.vds, v.vbs, t, true);
    const w = ctx.omega;
    const gmin = ctx.options.gmin;
    const { nD, nG, nS, nB, nDi, nSi } = this;
    if (this.hasRd) stampAcAdmittance(ctx, nD, nDi, t.gd, 0);
    if (this.hasRs) stampAcAdmittance(ctx, nS, nSi, t.gs, 0);
    stampAcAdmittance(ctx, nB, nSi, e.gbs + gmin, w * e.capbs);
    stampAcAdmittance(ctx, nB, nDi, e.gbd + gmin, w * e.capbd);
    stampAcVccs(ctx, nDi, nSi, nG, nSi, e.cd.g, 0);
    stampAcVccs(ctx, nDi, nSi, nDi, nSi, e.cd.d, 0);
    stampAcVccs(ctx, nDi, nSi, nB, nSi, e.cd.b, 0);
    // intrinsic transcapacitances: current jw dQk/dvj from terminal k to the source
    const rows: [Dual, number][] = [
      [e.q.qg, nG],
      [e.q.qd, nDi],
      [e.q.qb, nB],
    ];
    for (const [q, node] of rows) {
      stampAcVccs(ctx, node, nSi, nG, nSi, 0, w * q.g);
      stampAcVccs(ctx, node, nSi, nDi, nSi, 0, w * q.d);
      stampAcVccs(ctx, node, nSi, nB, nSi, 0, w * q.b);
    }
    stampAcAdmittance(ctx, nG, nSi, 0, w * t.cgso);
    stampAcAdmittance(ctx, nG, nDi, 0, w * t.cgdo);
    stampAcAdmittance(ctx, nG, nB, 0, w * t.cgbo);
  }

  truncate(ctx: TruncContext): number {
    const t = this.temps(this.ctxTempK);
    const st = this.st;
    let dt = Infinity;
    for (const k of [S_QG, S_QD, S_QB]) dt = Math.min(dt, ctx.terr(st + k));
    if (t.depBd.cj0 > 0 || t.depBdSw.cj0 > 0) dt = Math.min(dt, ctx.terr(st + S_QBD));
    if (t.depBs.cj0 > 0 || t.depBsSw.cj0 > 0) dt = Math.min(dt, ctx.terr(st + S_QBS));
    return dt;
  }

  noise(ctx: NoiseContext): NoiseGenerator[] {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = this.evaluate(v.vgs, v.vds, v.vbs, t, false);
    const T = t.T;
    const dev = this.name;
    const gm = Math.abs(e.cd.g);
    const cd = Math.abs(e.cd.v);
    const { kf, af, ef } = t.p;
    const gens: NoiseGenerator[] = [];
    if (this.hasRd) gens.push({ name: 'thermal_rd', device: dev, pos: this.nD, neg: this.nDi, density: () => thermalNoise(T, t.gd) });
    if (this.hasRs) gens.push({ name: 'thermal_rs', device: dev, pos: this.nS, neg: this.nSi, density: () => thermalNoise(T, t.gs) });
    gens.push({ name: 'thermal_channel', device: dev, pos: this.nDi, neg: this.nSi, density: () => thermalNoise(T, (2 / 3) * gm) });
    if (kf !== 0) {
      const geo = t.cox * t.leff * t.leff;
      gens.push({
        name: 'flicker',
        device: dev,
        pos: this.nDi,
        neg: this.nSi,
        density: (f) => (f > 0 ? (kf * Math.pow(Math.max(cd, 1e-38), af)) / (Math.pow(f, ef) * geo) : 0),
      });
    }
    return gens;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const t = this.temps(this.ctxTempK);
    const v = this.voltages(x);
    const e = this.evaluate(v.vgs, v.vds, v.vbs, t, false);
    const g = this.lastGmin;
    const vbd = v.vbs - v.vds;
    const [iqg, iqd, iqb, iqbd, iqbs] = this.qCur;
    const ibd = e.ibd + g * vbd + iqbd;
    const ibs = e.ibs + g * v.vbs + iqbs;
    const s = this.pol;
    const id = s * (e.cd.v - ibd + iqd);
    const ig = s * iqg;
    const ib = s * (ibs + ibd + iqb);
    const is = -(id + ig + ib);
    const p = x(this.nD) * id + x(this.nG) * ig + x(this.nS) * is + x(this.nB) * ib;
    return { Id: id, Ig: ig, Is: is, Ib: ib, P: p, Vth: s * e.vth, Vdsat: s * e.vdsat, Gm: Math.abs(e.cd.g), Gds: Math.abs(e.cd.d) };
  }

  setParam(param: string, value: number): void {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      this.inst[k] = value;
      this.tcache = undefined;
      return;
    }
    const c = Object.prototype.hasOwnProperty.call(this.defaults, k) ? k : this.aliases[k];
    if (c === undefined) throw runtimeParamError(this.name, param);
    this.overrides[c] = value;
    this.resolve();
  }

  getParam(param: string): number | undefined {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      const v = this.inst[k];
      if (v !== undefined) return v;
      if (k === 'w') return this.defW;
      if (k === 'l') return this.defL;
      if (k === 'ad') return this.defAd;
      if (k === 'as') return this.defAs;
      if (k === 'm') return 1;
      return undefined;
    }
    const c = (Object.prototype.hasOwnProperty.call(this.defaults, k) ? k : this.aliases[k]) as Bsim3Param | undefined;
    return c !== undefined ? this.base[c] : undefined;
  }

  /** Channel current and charges at device-polarity voltages (diagnostics / tests). */
  evaluateAt(vgs: number, vds: number, vbs: number, tempK: number): { id: number; gm: number; gds: number; gmbs: number; vth: number; vdsat: number; qg: number; qd: number; qb: number; cgg: number; cgd: number; cdg: number; cgso: number; cgdo: number; cgbo: number } {
    const e = this.evaluate(vgs, vds, vbs, this.temps(tempK), true);
    return {
      id: e.cd.v,
      gm: e.cd.g,
      gds: e.cd.d,
      gmbs: e.cd.b,
      vth: e.vth,
      vdsat: e.vdsat,
      qg: e.q.qg.v,
      qd: e.q.qd.v,
      qb: e.q.qb.v,
      cgg: e.q.qg.g,
      cgd: e.q.qg.d,
      cdg: e.q.qd.g,
      cgso: this.temps(tempK).cgso,
      cgdo: this.temps(tempK).cgdo,
      cgbo: this.temps(tempK).cgbo,
    };
  }

  get polarity(): number {
    return this.pol;
  }
}

export function createBsim3(el: ElementIR): Device {
  return new Bsim3(el);
}
