/**
 * EKV MOSFET — element 'M' with an NMOS / PMOS model card of LEVEL 44 (the number HSPICE and Eldo
 * give the EKV model). Selected by the dispatcher in mosdevice.ts.
 *
 * Own implementation of the charge-based EKV model (Enz–Krummenacher–Vittoz, version 2.6) from its
 * published equations. Everything is referred to the BULK, so the model is source/drain symmetric
 * and one smooth expression covers weak, moderate and strong inversion — no region switches:
 *
 *   pinch-off voltage      Vg' = VGB - VTO + PHI + GAMMA sqrt(PHI)
 *                          VP  = Vg' - PHI - GAMMA ( sqrt(Vg' + GAMMA^2/4) - GAMMA/2 )   (Vg' > 0; VP = -PHI otherwise)
 *   slope factor           n   = 1 + GAMMA / (2 sqrt(VP + PHI + 4 Vt))
 *   normalised currents    i_f = F((VP - VSB)/Vt),  i_r = F((VP - VSB - VDS')/Vt),   F(v) = ln^2(1 + exp(v/2))
 *   specific current       IS  = 2 n beta Vt^2
 *   drain current          ID  = IS (i_f - i_r)
 *
 * with the same expression at every bias this gives the textbook limits exactly: weak inversion
 * ID = IS e^{(VP-VS)/Vt} (1 - e^{-VDS/Vt}) (slope factor n) and strong-inversion saturation
 * ID = beta (VGS - VTO)^2 / (2 n). Second-order effects (the forms used here):
 *   - mobility reduction by the vertical field: beta = KP W/L / (1 + THETA' max(VP, 0)),
 *     THETA' = THETA + Cox / (E0 EPS_OX)   [a simplification of the EKV 2.6 E0 expression]
 *   - velocity saturation (simplified; the EKV 2.6 VDSS clamp is not used): ID / (1 + VDE / Vc), Vc = UCRIT L,
 *     VDE = smooth-min(VDS, VP - VS) (4-norm) — the voltage across the strongly inverted channel, so the factor is 1
 *     in weak inversion and for UCRIT -> infinity at every bias
 *   - channel-length modulation: dL = LAMBDA Lc ln(1 + (VDS - VDSAT)/(Lc UCRIT)), VDSAT = VP - VS + 4 Vt,
 *     Lc = sqrt(EPS_SI XJ / Cox), ID multiplied by L / (L - dL) (dL limited below L/2)
 *   - temperature: VTO - TCV (T - TNOM), KP (T/TNOM)^BEX, UCRIT (T/TNOM)^UCEX, PHI(T)
 * Charges: the inversion charge Qi = -2 n Vt Cox W L integral_0^1 q(x) dx with the exact EKV charge
 * profile, q_s = (sqrt(1 + 4 i_f) - 1)/2 and q_d likewise at the two ends: integral q dx =
 * ((2/3)(q_s^2 + q_s q_d + q_d^2) + (q_s + q_d)/2) / (q_s + q_d + 1), and the drain share
 * integral x q dx = R(q_s, q_d) / (q_s + q_d + 1)^2 with a cubic polynomial R (both derived by integrating
 * the EKV relation i = q^2 + q along the channel; x runs from the source to the drain); the bulk charge Qb = -Cox W L (n - 1) VP, Qg = -(Qi + Qb) and Qs = -(Qg + Qd + Qb).
 * Overlap capacitances CGSO, CGDO, CGBO and the junctions (JS, JSW, CJ ... as in the other MOS models).
 * Noise: thermal 4kT beta 2 n Vt integral q dx (= 4kT mu |Qi| / L^2), flicker KF Id^AF / (f Cox W L).
 *
 * Not modelled (accepted on the card without effect): the short- and narrow-channel threshold
 * terms WETA / LETA / Q0 / LK, impact ionisation IBA / IBB / IBN, mismatch AVTO / AKP / AGAMMA,
 * non-quasi-static NQS. Internal nodes: none. Outputs: Id, Ig, Is, Ib, P, Vp (pinch-off), IC (the
 * inversion coefficient i_f: < 0.1 weak, 0.1 … 10 moderate, > 10 strong inversion), Gm, Gds.
 */

import type { AcContext, Device, LoadContext, NoiseContext, NoiseGenerator, SetupContext, TruncContext } from '../../device';
import { EPS_OX, EPS_SI, GROUND } from '../../device';
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
import { add, addc, chain, dconst, div, dsoftplus, dsqrt, dual, mul, neg, scale, sub, type Dual } from './dual';

/** Model levels evaluated by this file. */
export const EKV_LEVELS: ReadonlySet<number> = new Set([44]);

/** Model parameters with their EKV 2.6 defaults (NaN = derived when not given). */
export const EKV_DEFAULTS = {
  level: 44,
  vto: 0.5,
  gamma: 1,
  phi: 0.7,
  kp: 50e-6,
  theta: 0,
  e0: 1e12,
  ucrit: 2e6,
  dl: 0,
  dw: 0,
  lambda: 0.5,
  xj: 0.1e-6,
  tcv: 1e-3,
  bex: -1.5,
  ucex: 0.8,
  cox: Number.NaN,
  tox: Number.NaN,
  cgso: 0,
  cgdo: 0,
  cgbo: 0,
  kf: 0,
  af: 1,
  js: 1e-6,
  jsw: 0,
  n: 1,
  xti: 3,
  cj: 0,
  mj: 0.5,
  pb: 0.8,
  cjsw: 0,
  mjsw: 0.33,
  pbsw: 0.8,
  fc: 0.5,
  tnom: Number.NaN,
} as const;

export type EkvParam = keyof typeof EKV_DEFAULTS;
type EkvValues = Record<EkvParam, number>;

const ALIASES: Readonly<Record<string, EkvParam>> = { vt0: 'vto', uo: 'kp', tref: 'tnom', nj: 'n', rhoj: 'js' };

/** Recognised on the card but without effect here (no warning). */
const ACCEPTED = new Set([
  'weta', 'leta', 'q0', 'lk', 'iba', 'ibb', 'ibn', 'avto', 'akp', 'agamma', 'nqs', 'satlim', 'xqc', 'update', 'hdif', 'rsh', 'ld', 'wd',
  'version', 'type', 'eg', 'lmin', 'lmax', 'wmin', 'wmax', 'rd', 'rs', 'nsub', 'tlev', 'tlevc',
]);

const INSTANCE_KEYS = new Set(['w', 'l', 'ad', 'as', 'pd', 'ps', 'm', 'off', 'ic_vds', 'ic_vgs', 'ic_vbs', 'icvds', 'icvgs', 'icvbs', 'temp', 'dtemp', 'nrd', 'nrs']);

/** Bias-independent per-instance values at one temperature. */
interface EkvInst {
  T: number;
  vt: number;
  weff: number;
  leff: number;
  m: number;
  cox: number;
  /** device-polarity quantities */
  vto: number;
  gamma: number;
  phi: number;
  beta0: number;
  theta: number;
  ucrit: number;
  vc: number;
  lc: number;
  lambda: number;
  p: EkvValues;
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
}

/** Forward-mode core result (VDB >= VSB) as duals of the global voltages. */
interface EkvCore {
  id: Dual;
  vp: Dual;
  n: Dual;
  ifwd: Dual;
  irev: Dual;
  beta: Dual;
  /** integral of the charge profile (dimensionless) */
  qint: Dual;
  qg: Dual;
  qd: Dual;
  qb: Dual;
}

/** F(v) = ln^2(1 + exp(v/2)): the EKV interpolation function. */
function interpF(v: Dual): Dual {
  const s = dsoftplus(scale(v, 0.5));
  return mul(s, s);
}

/** Smooth max(x, 0) with transition width `w`. */
function smoothPos(x: Dual, w: number): Dual {
  return scale(add(x, dsqrt(addc(mul(x, x), w * w))), 0.5);
}

/** Core in bulk-referred forward-mode voltages (all duals of vgs, vds, vbs). */
function ekvCore(vgb: Dual, vsb: Dual, vdb: Dual, t: EkvInst): EkvCore {
  const vt = t.vt;
  const g = t.gamma;
  // pinch-off voltage
  const vgp = addc(vgb, -t.vto + t.phi + g * Math.sqrt(t.phi));
  let vp: Dual;
  if (vgp.v > 0) vp = sub(addc(vgp, -t.phi), scale(sub(dsqrt(addc(vgp, (g * g) / 4)), dconst(g / 2)), g));
  else vp = dconst(-t.phi);
  const n = addc(div(dconst(g / 2), dsqrt(addc(vp, t.phi + 4 * vt))), 1);

  // long-channel EKV currents (symmetric in source and drain)
  const vps = sub(vp, vsb);
  const vpsPos = smoothPos(vps, 2 * vt);
  const vds = sub(vdb, vsb);
  const ifwd = interpF(scale(vps, 1 / vt));
  const irev = interpF(scale(sub(vps, vds), 1 / vt));

  // vertical-field mobility reduction
  const mobility = addc(scale(smoothPos(vp, 2 * vt), t.theta), 1);
  let beta = div(dconst(t.beta0), mobility);
  // velocity saturation: the lateral field acts on the voltage that drops across the strongly inverted channel,
  // vde = smooth-min(VDS, VP - VS) as a/b-norm a b / (a^4 + b^4)^(1/4) (about zero in weak inversion, VP - VS in saturation)
  const a4 = mul(mul(vds, vds), mul(vds, vds));
  const b4 = mul(mul(vpsPos, vpsPos), mul(vpsPos, vpsPos));
  const vde = div(mul(vds, vpsPos), dsqrt(dsqrt(addc(add(a4, b4), 1e-24))));
  beta = div(beta, addc(scale(vde, 1 / t.vc), 1));
  // channel-length modulation beyond saturation: dL = LAMBDA Lc ln(1 + (VDS - VDSAT)/(Lc UCRIT)), VDSAT = VP - VS + 4Vt
  const over = smoothPos(addc(sub(vds, vpsPos), -4 * vt), vt);
  const lcUc = t.lc * t.ucrit;
  const lnDual = chain(over, Math.log1p(over.v / lcUc), 1 / (lcUc + over.v));
  const s0 = scale(lnDual, (t.lambda * t.lc) / t.leff);
  const s = div(s0, addc(scale(s0, 2), 1));
  beta = div(beta, addc(neg(s), 1));

  const is = scale(mul(beta, n), 2 * vt * vt);
  const id = mul(is, sub(ifwd, irev));

  // charges from the closed-form moments of the charge profile (see the header)
  const qs = scale(addc(dsqrt(addc(scale(ifwd, 4), 1)), -1), 0.5);
  const qdn = scale(addc(dsqrt(addc(scale(irev, 4), 1)), -1), 0.5);
  const sum = add(qs, qdn);
  const den = addc(sum, 1);
  const uu = mul(qs, qs);
  const vv = mul(qdn, qdn);
  const uv = mul(qs, qdn);
  // integral of q dx
  const qint = div(add(scale(add(add(uu, uv), vv), 2 / 3), scale(sum, 0.5)), den);
  // integral of q x dx (x = 0 at the source, 1 at the drain)
  const v2 = vv;
  const u2 = uu;
  const rPoly = add(
    add(add(scale(qdn, 1 / 3), scale(v2, 3 / 4)), add(scale(mul(v2, qdn), 2 / 5), scale(qs, 1 / 6))),
    add(add(scale(uv, 5 / 6), scale(mul(qs, v2), 4 / 5)), add(add(scale(u2, 5 / 12), scale(mul(u2, qdn), 8 / 15)), scale(mul(u2, qs), 4 / 15))),
  );
  const moment = div(rPoly, mul(den, den));
  const area = t.cox * t.weff * t.leff * t.m;
  const qi = scale(mul(n, qint), -2 * vt * area);
  const qd = scale(mul(n, moment), -2 * vt * area);
  const qb = scale(mul(addc(n, -1), vp), -area);
  const qg = neg(add(qi, qb));
  return { id, vp, n, ifwd, irev, beta, qint, qg, qd, qb };
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

/** Result of one evaluation in global orientation. */
interface EkvEval {
  mode: number;
  cd: Dual;
  vp: number;
  ic: number;
  n: number;
  beta: number;
  qint: number;
  ibs: number;
  gbs: number;
  ibd: number;
  gbd: number;
  qbs: number;
  capbs: number;
  qbd: number;
  capbd: number;
  q: { qg: Dual; qd: Dual; qb: Dual };
}

export class Ekv implements Device {
  readonly type = 'M' as const;
  readonly name: string;
  readonly nodeNames: string[];

  private readonly modelName: string | undefined;
  private card: ModelCard | undefined;
  private readonly inst: Record<string, number>;
  private readonly overrides: Record<string, number> = {};
  private base: EkvValues = { ...EKV_DEFAULTS };
  private given = new Set<string>();
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
  private st = 0;
  private tcache: EkvInst | undefined;

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
    warnUnknownParams(ctx, card, this.resolve());
    this.nD = ctx.node(this.nodeNames[0]);
    this.nG = ctx.node(this.nodeNames[1]);
    this.nS = ctx.node(this.nodeNames[2]);
    this.nB = this.nodeNames.length > 3 ? ctx.node(this.nodeNames[3]) : this.nS;
    this.st = ctx.state(N_STATES);
  }

  private resolve(): string[] {
    const p: EkvValues = { ...EKV_DEFAULTS };
    const given = new Set<string>();
    const unknown: string[] = [];
    const canon = (k: string): EkvParam | undefined => {
      if (Object.prototype.hasOwnProperty.call(EKV_DEFAULTS, k)) return k as EkvParam;
      return Object.prototype.hasOwnProperty.call(ALIASES, k) ? ALIASES[k] : undefined;
    };
    const apply = (src: Readonly<Record<string, number>>, report: boolean) => {
      for (const [key, value] of Object.entries(src)) {
        const k = key.toLowerCase();
        if (!Number.isFinite(value)) continue;
        const c = canon(k);
        if (c) {
          p[c] = value;
          given.add(c);
        } else if (report && !ACCEPTED.has(k)) unknown.push(k);
      }
    };
    if (this.card) apply(this.card.params, true);
    apply(this.overrides, false);
    this.base = p;
    this.given = given;
    this.tcache = undefined;
    return unknown;
  }

  private ip(key: string, def: number): number {
    return instanceParam(this.inst, [key]) ?? def;
  }

  private temps(ctxTemp: number): EkvInst {
    const tInst = instanceParam(this.inst, ['temp']);
    const T = tInst !== undefined ? celsiusToKelvin(tInst) : ctxTemp + (instanceParam(this.inst, ['dtemp']) ?? 0);
    if (this.tcache && this.tcache.T === T) return this.tcache;
    const p = this.base;
    const m = this.ip('m', 1);
    const w = this.ip('w', this.defW);
    const l = this.ip('l', this.defL);
    let weff = w + p.dw;
    let leff = l + p.dl;
    if (!(leff > 0)) {
      this.warn(`${this.name}: effective channel length <= 0, using L`);
      leff = l;
    }
    if (!(weff > 0)) {
      this.warn(`${this.name}: effective channel width <= 0, using W`);
      weff = w;
    }
    const tnom = celsiusToKelvin(Number.isFinite(p.tnom) ? p.tnom : this.tnomDefaultC);
    const vt = K_OVER_Q * T;
    const ratio = T / tnom;
    const cox = Number.isFinite(p.cox) && p.cox > 0 ? p.cox : Number.isFinite(p.tox) && p.tox > 0 ? EPS_OX / p.tox : 0.7e-3;
    const eg0 = siliconBandGap(tnom);
    const egT = siliconBandGap(T);
    const phi = Math.max(0.2, p.phi * ratio - 3 * vt * Math.log(ratio) - eg0 * ratio + egT);
    const kp = p.kp * Math.pow(ratio, p.bex);
    const ucrit = p.ucrit * Math.pow(ratio, p.ucex);
    const ad = this.ip('ad', this.defAd);
    const as = this.ip('as', this.defAs);
    const pd = this.ip('pd', 0);
    const ps = this.ip('ps', 0);
    const satFactor = Math.exp((eg0 / (K_OVER_Q * tnom) - egT / vt + p.xti * Math.log(ratio)) / p.n);
    const isd = (p.js * ad + p.jsw * pd) * satFactor * m;
    const iss = (p.js * as + p.jsw * ps) * satFactor * m;
    const jb = junctionTemperature(p.pb, p.mj, tnom, T);
    const jsw = junctionTemperature(p.pbsw, p.mjsw, tnom, T);
    const t: EkvInst = {
      T,
      vt,
      weff,
      leff,
      m,
      cox,
      vto: Math.abs(p.vto) - p.tcv * (T - tnom),
      gamma: p.gamma,
      phi,
      beta0: (kp * weff * m) / leff,
      theta: p.theta + cox / (p.e0 * EPS_OX),
      ucrit,
      vc: ucrit * leff,
      lc: Math.sqrt((EPS_SI * p.xj) / cox),
      lambda: p.lambda,
      p,
      isd,
      iss,
      vcritD: junctionVcrit(vt, isd),
      vcritS: junctionVcrit(vt, iss),
      depBd: depletionCoeffs(p.cj * ad * m * jb.capFactor, jb.pot, p.mj, p.fc),
      depBdSw: depletionCoeffs(p.cjsw * pd * m * jsw.capFactor, jsw.pot, p.mjsw, p.fc),
      depBs: depletionCoeffs(p.cj * as * m * jb.capFactor, jb.pot, p.mj, p.fc),
      depBsSw: depletionCoeffs(p.cjsw * ps * m * jsw.capFactor, jsw.pot, p.mjsw, p.fc),
      cgso: p.cgso * weff * m,
      cgdo: p.cgdo * weff * m,
      cgbo: p.cgbo * leff * m,
    };
    this.tcache = t;
    return t;
  }

  private evaluate(vgsN: number, vdsN: number, vbsN: number, t: EkvInst, withCharges: boolean): EkvEval {
    const vgs = dual(vgsN, 1, 0, 0);
    const vds = dual(vdsN, 0, 1, 0);
    const vbs = dual(vbsN, 0, 0, 1);
    const vbdN = vbsN - vdsN;
    const e: EkvEval = {
      mode: 1,
      cd: dconst(0),
      vp: 0,
      ic: 0,
      n: 1,
      beta: 0,
      qint: 0,
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
    const nvt = t.p.n * t.vt;
    let a = vbsN / nvt;
    e.ibs = t.iss * (expLin(a) - 1);
    e.gbs = (t.iss * expLinDeriv(a)) / nvt;
    a = vbdN / nvt;
    e.ibd = t.isd * (expLin(a) - 1);
    e.gbd = (t.isd * expLinDeriv(a)) / nvt;
    if (vdsN >= 0) {
      const c = ekvCore(sub(vgs, vbs), neg(vbs), sub(vds, vbs), t);
      e.cd = c.id;
      e.vp = c.vp.v;
      e.ic = c.ifwd.v;
      e.n = c.n.v;
      e.beta = c.beta.v;
      e.qint = c.qint.v;
      if (withCharges) e.q = { qg: c.qg, qd: c.qd, qb: c.qb };
    } else {
      e.mode = -1;
      // local frame: source and drain exchanged
      const lg = sub(vgs, vds);
      const ld = neg(vds);
      const lb = sub(vbs, vds);
      const c = ekvCore(sub(lg, lb), neg(lb), sub(ld, lb), t);
      e.cd = neg(c.id);
      e.vp = c.vp.v;
      e.ic = c.ifwd.v;
      e.n = c.n.v;
      e.beta = c.beta.v;
      e.qint = c.qint.v;
      if (withCharges) e.q = { qg: c.qg, qb: c.qb, qd: neg(add(add(c.qg, c.qd), c.qb)) };
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
    const vs = x(this.nS);
    return { vgs: s * (x(this.nG) - vs), vds: s * (x(this.nD) - vs), vbs: s * (x(this.nB) - vs) };
  }

  private stampBranch(ctx: LoadContext, a: number, b: number, i: number, g0: number, g1: number, g2: number, vgs: number, vds: number, vbs: number): void {
    stampVccs(ctx, a, b, this.nG, this.nS, g0);
    stampVccs(ctx, a, b, this.nD, this.nS, g1);
    stampVccs(ctx, a, b, this.nB, this.nS, g2);
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
          vgs = t.vto + 0.1;
          vds = 0.1;
        }
      }
    } else {
      const old = ctx.initTimepoint ? ctx.state1 : s0;
      const vgsOld = old[st + S_VGS];
      const vdsOld = old[st + S_VDS];
      const vbsOld = old[st + S_VBS];
      const von = Number.isFinite(this.lastVth) ? this.lastVth : t.vto;
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
      if (vds >= 0) vbs = pnjlim(vbs, vbsOld, t.vt * t.p.n, t.vcritS);
      else vbs = pnjlim(vbs - vds, vbsOld - vdsOld, t.vt * t.p.n, t.vcritD) + vds;
      limited = Math.abs(vgs - v.vgs) + Math.abs(vds - v.vds) + Math.abs(vbs - v.vbs) > 1e-12 * (1 + Math.abs(v.vgs) + Math.abs(v.vds));
    }
    const vbd = vbs - vds;
    const tran = ctx.mode === 'tran' && !ctx.tranOp && ctx.dt > 0;
    const needCharges = ctx.mode === 'tran';
    const e = this.evaluate(vgs, vds, vbs, t, needCharges);
    const gmin = ctx.gmin;
    const { nD, nG, nS, nB } = this;
    stampConductance(ctx, nB, nS, e.gbs + gmin);
    stampCurrent(ctx, nB, nS, type * (e.ibs - e.gbs * vbs));
    stampConductance(ctx, nB, nD, e.gbd + gmin);
    stampCurrent(ctx, nB, nD, type * (e.ibd - e.gbd * vbd));
    this.stampBranch(ctx, nD, nS, e.cd.v, e.cd.g, e.cd.d, e.cd.b, vgs, vds, vbs);

    s0[st + S_VBS] = vbs;
    s0[st + S_VGS] = vgs;
    s0[st + S_VDS] = vds;
    this.qCur.fill(0);
    if (needCharges) {
      const vgd = vgs - vds;
      const vgb = vgs - vbs;
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
          [S_QD, qd, e.q.qd, [-t.cgdo, t.cgdo, 0], nD],
          [S_QB, qb, e.q.qb, [-t.cgbo, 0, t.cgbo], nB],
        ];
        terms.forEach(([slot, q, dq, ov, node], k) => {
          const r = integrateCharge(ctx, st + slot, q, 0, true);
          const ag = r.ag0;
          this.stampBranch(ctx, node, nS, r.i, (dq.g + ov[0]) * ag, (dq.d + ov[1]) * ag, (dq.b + ov[2]) * ag, vgs, vds, vbs);
          this.qCur[k] = r.i;
        });
        const bd = integrateCharge(ctx, st + S_QBD, e.qbd, e.capbd);
        stampConductance(ctx, nB, nD, bd.geq);
        stampCurrent(ctx, nB, nD, type * (bd.i - bd.geq * vbd));
        const bs = integrateCharge(ctx, st + S_QBS, e.qbs, e.capbs);
        stampConductance(ctx, nB, nS, bs.geq);
        stampCurrent(ctx, nB, nS, type * (bs.i - bs.geq * vbs));
        this.qCur[3] = bd.i;
        this.qCur[4] = bs.i;
      }
    }
    if (limited) ctx.noncon();
    this.loaded = true;
    // gate voltage at which the channel forms: the fetlim reference (device-polarity VTO + body effect)
    this.lastVth = t.vto + (t.gamma * (Math.sqrt(Math.max(t.phi - vbs, 0.01)) - Math.sqrt(t.phi)));
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
    const { nD, nG, nS, nB } = this;
    stampAcAdmittance(ctx, nB, nS, e.gbs + gmin, w * e.capbs);
    stampAcAdmittance(ctx, nB, nD, e.gbd + gmin, w * e.capbd);
    stampAcVccs(ctx, nD, nS, nG, nS, e.cd.g, 0);
    stampAcVccs(ctx, nD, nS, nD, nS, e.cd.d, 0);
    stampAcVccs(ctx, nD, nS, nB, nS, e.cd.b, 0);
    const rows: [Dual, number][] = [
      [e.q.qg, nG],
      [e.q.qd, nD],
      [e.q.qb, nB],
    ];
    for (const [q, node] of rows) {
      stampAcVccs(ctx, node, nS, nG, nS, 0, w * q.g);
      stampAcVccs(ctx, node, nS, nD, nS, 0, w * q.d);
      stampAcVccs(ctx, node, nS, nB, nS, 0, w * q.b);
    }
    stampAcAdmittance(ctx, nG, nS, 0, w * t.cgso);
    stampAcAdmittance(ctx, nG, nD, 0, w * t.cgdo);
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
    const cd = Math.abs(e.cd.v);
    const { kf, af } = t.p;
    const gens: NoiseGenerator[] = [];
    // thermal noise of the channel: 4kT mu |Qi| / L^2 = 4kT beta 2 n Vt integral(q)
    const gth = e.beta * 2 * e.n * t.vt * e.qint;
    gens.push({ name: 'thermal_channel', device: dev, pos: this.nD, neg: this.nS, density: () => thermalNoise(T, gth) });
    if (kf !== 0) {
      const geo = t.cox * t.weff * t.leff;
      gens.push({ name: 'flicker', device: dev, pos: this.nD, neg: this.nS, density: (f) => (f > 0 ? (kf * Math.pow(Math.max(cd, 1e-38), af)) / (f * geo) : 0) });
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
    return { Id: id, Ig: ig, Is: is, Ib: ib, P: p, Vp: s * e.vp, IC: e.ic, Gm: Math.abs(e.cd.g), Gds: Math.abs(e.cd.d) };
  }

  setParam(param: string, value: number): void {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      this.inst[k] = value;
      this.tcache = undefined;
      return;
    }
    const c = Object.prototype.hasOwnProperty.call(EKV_DEFAULTS, k) ? k : ALIASES[k];
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
    const c = (Object.prototype.hasOwnProperty.call(EKV_DEFAULTS, k) ? k : ALIASES[k]) as EkvParam | undefined;
    return c !== undefined ? this.base[c] : undefined;
  }

  /** Channel current, charges and EKV quantities at device-polarity voltages (diagnostics / tests). */
  evaluateAt(vgs: number, vds: number, vbs: number, tempK: number): { id: number; gm: number; gds: number; gmbs: number; vp: number; n: number; ic: number; beta: number; qg: number; qd: number; qb: number; qs: number; cgg: number; cgd: number } {
    const e = this.evaluate(vgs, vds, vbs, this.temps(tempK), true);
    return {
      id: e.cd.v,
      gm: e.cd.g,
      gds: e.cd.d,
      gmbs: e.cd.b,
      vp: e.vp,
      n: e.n,
      ic: e.ic,
      beta: e.beta,
      qg: e.q.qg.v,
      qd: e.q.qd.v,
      qb: e.q.qb.v,
      qs: -(e.q.qg.v + e.q.qd.v + e.q.qb.v),
      cgg: e.q.qg.g,
      cgd: e.q.qg.d,
    };
  }

  get polarity(): number {
    return this.pol;
  }

  /** Parameters the card gave (diagnostics). */
  get givenParams(): ReadonlySet<string> {
    return this.given;
  }
}

export function createEkv(el: ElementIR): Device {
  return new Ekv(el);
}

/** Small helper for tests: the EKV charge-profile integral in closed form. */
export function ekvInversionCharge(ifwd: number, irev: number): number {
  const qs = (Math.sqrt(1 + 4 * ifwd) - 1) / 2;
  const qd = (Math.sqrt(1 + 4 * irev) - 1) / 2;
  return ((2 / 3) * (qs * qs + qs * qd + qd * qd) + (qs + qd) / 2) / (qs + qd + 1);
}

