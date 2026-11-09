/**
 * MOSFET — element 'M', model types NMOS / PMOS (SPICE levels 1, 2 and 3; BSIM3 levels 8 / 49
 * are handled by bsim3.ts through the dispatcher in mosdevice.ts).
 *
 * Nodes: [drain, gate, source, bulk]. Instance params: w, l (default options DEFW / DEFL,
 * 100 um), ad, as (default options DEFAD / DEFAS, 0), pd, ps (0), nrd, nrs (1), m (parallel
 * count), off, ic_vds / ic_vgs / ic_vbs (aliases icvds / icvgs / icvbs), temp (°C), dtemp (°C).
 *
 * Model parameters (SPICE3 defaults): LEVEL 1, VTO(VT0) 0, KP 2e-5 (or U0*Cox when TOX is
 * given), GAMMA 0, PHI 0.6, LAMBDA 0, RD 0, RS 0, CBD 0, CBS 0, IS 1e-14, PB 0.8, CGSO 0, CGDO 0,
 * CGBO 0, RSH 0, CJ 0, MJ 0.5, CJSW 0, MJSW 0.5 (0.33 for level 3), JS 0, TOX (none), U0(UO) 600,
 * LD 0, WD 0, NSUB 0, NSS 0, TPG 1, FC 0.5, KF 0, AF 1, TNOM.
 * With TOX and NSUB given, absent PHI / GAMMA / VTO are derived from the process parameters.
 * Level 2 adds UCRIT (1e4 V/cm) UEXP (0) UTRA (ignored) VMAX NEFF (1) NFS XJ DELTA (see mos2.ts);
 * level 3 adds NFS THETA ETA KAPPA VMAX XJ DELTA (see mos3.ts). Levels 2 and 3 default TOX to
 * 100 nm. Any other LEVEL falls back to level 1 with a setup warning.
 *
 * Level 1 (Shichman-Hodges), device polarity, mode-local voltages (drain/source exchanged when
 * vds < 0 so that vds >= 0):
 *   von = VBI + GAMMA*sqrt(PHI - vbs)   (vbs > 0: linear continuation of the square root)
 *   vgst = vgs - von;  vgst <= 0: Id = 0
 *   vds <  vgst: Id = BETA(1 + LAMBDA vds) vds (vgst - vds/2)
 *   vds >= vgst: Id = BETA(1 + LAMBDA vds) vgst^2 / 2,   BETA = KP*Weff/Leff*m
 *   Leff = L - 2 LD, Weff = W - 2 WD.
 * Bulk junctions b-d' and b-s': IS (or JS*AD / JS*AS) diodes with gmin in parallel and
 * bottom (CBD/CBS or CJ*AD/AS, MJ) + sidewall (CJSW*PD/PS, MJSW) depletion charges.
 * Gate: Meyer capacitances (Cox*Weff*Leff*m) plus overlap CGSO*W, CGDO*W, CGBO*Leff. As in SPICE
 * the Meyer charges are accumulated incrementally with the capacitance averaged over the step,
 * q = q1 + (C(v) + C1)/2 * (v - v1); the stamped Jacobian includes the derivatives of C(v).
 * Temperature (SPICE3): KP and U0 ~ (T/Tnom)^-1.5, PHI and PB via the band gap, VTO via VBI,
 * junction capacitances, IS/JS.
 * Newton limiting: fetlim on vgs (or vgd), limvds on vds, pnjlim on vbs (or vbd).
 *
 * Internal nodes (only when the resistance is > 0): "<name>#d", "<name>#s".
 * State slots (16): vbs vgs vds | Cgs Cgd Cgb (Meyer, full value) | qgs iqgs | qgd iqgd |
 * qgb iqgb | qbd iqbd | qbs iqbs.
 * Outputs: Id, Ig, Is, Ib (currents INTO the terminals), P (power absorbed).
 */

import type { AcContext, Device, LoadContext, NoiseContext, NoiseGenerator, SetupContext, TruncContext } from '../../device';
import { CHARGE, EPS0, EPS_OX, GROUND } from '../../device';
import type { ElementIR, ModelCard } from '../../netlist';
import { runtimeParamError } from '../linear/common';
import {
  K_OVER_Q,
  canonicalParam,
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
  resolveParams,
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
import { mos3Core, type Mos3Params } from './mos3';
import { mos2Core, type Mos2Params } from './mos2';

export const MOS_DEFAULTS = {
  level: 1,
  vto: 0,
  kp: 2e-5,
  gamma: 0,
  phi: 0.6,
  lambda: 0,
  rd: 0,
  rs: 0,
  cbd: 0,
  cbs: 0,
  is: 1e-14,
  pb: 0.8,
  cgso: 0,
  cgdo: 0,
  cgbo: 0,
  rsh: 0,
  cj: 0,
  mj: 0.5,
  cjsw: 0,
  mjsw: 0.5,
  js: 0,
  tox: 0,
  u0: 600,
  ld: 0,
  wd: 0,
  nsub: 0,
  nss: 0,
  nfs: 0,
  tpg: 1,
  xj: 0,
  vmax: 0,
  theta: 0,
  eta: 0,
  kappa: 0.2,
  delta: 0,
  ucrit: 1e4,
  uexp: 0,
  utra: 0,
  neff: 1,
  fc: 0.5,
  kf: 0,
  af: 1,
  tnom: Number.NaN,
} as const;

export type MosParam = keyof typeof MOS_DEFAULTS;
export type MosModelParams = Record<MosParam, number>;

export const MOS_ALIASES: Readonly<Record<string, MosParam>> = {
  vt0: 'vto',
  uo: 'u0',
  tref: 'tnom',
  t_measured: 'tnom',
};

/** Noise / thermal bookkeeping parameters accepted without a warning. */
const MOS_IGNORED = new Set(['nlev', 'gdsnoi', 't_abs', 't_rel_global', 't_rel_local']);

const INSTANCE_KEYS = new Set([
  'w',
  'l',
  'ad',
  'as',
  'pd',
  'ps',
  'nrd',
  'nrs',
  'm',
  'off',
  'ic_vds',
  'ic_vgs',
  'ic_vbs',
  'icvds',
  'icvgs',
  'icvbs',
  'temp',
  'dtemp',
]);

/** SPICE default MOSFET channel length / width (options DEFL / DEFW), m. */
export const DEFAULT_MOS_L = 1e-4;
export const DEFAULT_MOS_W = 1e-4;

/** Smallest saturation voltage used by the Meyer capacitance model, V. */
const MEYER_MIN_VDSAT = 0.025;

/** Result of a drain-current core in mode-local coordinates (vds >= 0). */
export interface MosCoreResult {
  /** drain current d -> s (mode-local) */
  ids: number;
  /** partial derivatives w.r.t. vgs, vds, vbs */
  gm: number;
  gds: number;
  gmbs: number;
  /** threshold and saturation voltages with their partial derivatives (for Meyer caps) */
  von: number;
  dvonDvds: number;
  dvonDvbs: number;
  vdsat: number;
  dvdsatDvgs: number;
  dvdsatDvds: number;
  dvdsatDvbs: number;
}

export function emptyCore(): MosCoreResult {
  return { ids: 0, gm: 0, gds: 0, gmbs: 0, von: 0, dvonDvds: 0, dvonDvbs: 0, vdsat: 0, dvdsatDvgs: 0, dvdsatDvds: 0, dvdsatDvbs: 0 };
}

/** Temperature-, geometry- and multiplicity-adjusted instance parameters. */
export interface MosTemp {
  T: number;
  vt: number;
  level: 1 | 2 | 3;
  /** device-polarity built-in voltage: von = vbi + gamma*sqrt(phi - vbs) at level 1 */
  vbi: number;
  /** device-polarity zero-bias threshold */
  vto: number;
  phi: number;
  gamma: number;
  lambda: number;
  /** KP*Weff/Leff*m (level 1) */
  beta: number;
  /** temperature-adjusted surface mobility, cm^2/Vs */
  u0: number;
  /** oxide capacitance per area, F/m^2 (0 when TOX is not given) */
  coxArea: number;
  /** total oxide capacitance Cox*Weff*Leff*m, F */
  oxideCap: number;
  leff: number;
  weff: number;
  /** level-3 extra parameters (undefined at levels 1 and 2) */
  l3: Mos3Params | undefined;
  /** level-2 extra parameters (undefined at levels 1 and 3) */
  l2?: Mos2Params;
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
}

/** Level-1 drain current in mode-local coordinates. */
function mos1Core(vgs: number, vds: number, vbs: number, t: MosTemp, out: MosCoreResult): MosCoreResult {
  let sarg: number;
  let dsarg: number;
  if (vbs <= 0) {
    sarg = Math.sqrt(t.phi - vbs);
    dsarg = -0.5 / sarg;
  } else {
    const sphi = Math.sqrt(t.phi);
    sarg = sphi - vbs / (2 * sphi);
    dsarg = -0.5 / sphi;
    if (sarg <= 0) {
      sarg = 0;
      dsarg = 0;
    }
  }
  const von = t.vbi + t.gamma * sarg;
  const dvon = t.gamma * dsarg;
  const vgst = vgs - von;
  out.von = von;
  out.dvonDvds = 0;
  out.dvonDvbs = dvon;
  out.dvdsatDvds = 0;
  if (vgst <= 0) {
    out.ids = 0;
    out.gm = 0;
    out.gds = 0;
    out.gmbs = 0;
    out.vdsat = 0;
    out.dvdsatDvgs = 0;
    out.dvdsatDvbs = 0;
    return out;
  }
  out.vdsat = vgst;
  out.dvdsatDvgs = 1;
  out.dvdsatDvbs = -dvon;
  const betap = t.beta * (1 + t.lambda * vds);
  if (vgst <= vds) {
    out.ids = betap * vgst * vgst * 0.5;
    out.gm = betap * vgst;
    out.gds = t.lambda * t.beta * vgst * vgst * 0.5;
  } else {
    out.ids = betap * vds * (vgst - 0.5 * vds);
    out.gm = betap * vds;
    out.gds = betap * (vgst - vds) + t.lambda * t.beta * vds * (vgst - 0.5 * vds);
  }
  out.gmbs = -out.gm * dvon;
  return out;
}

/** Meyer capacitances (full values) and their partial derivatives w.r.t. (vgs, vds, vbs). */
export interface MeyerCaps {
  cgs: number;
  cgd: number;
  cgb: number;
  dcgs: [number, number, number];
  dcgd: [number, number, number];
  dcgb: [number, number, number];
}

function emptyMeyer(): MeyerCaps {
  return { cgs: 0, cgd: 0, cgb: 0, dcgs: [0, 0, 0], dcgd: [0, 0, 0], dcgb: [0, 0, 0] };
}

/**
 * Meyer gate capacitances in mode-local coordinates (vds >= 0):
 *   vgst <= -phi           Cgb = Cox
 *   -phi < vgst <= -phi/2  Cgb = -vgst*Cox/phi
 *   -phi/2 < vgst <= 0     Cgb = -vgst*Cox/phi, Cgs = 2/3 Cox + 4/3 Cox*vgst/phi (split with Cgd below vdsat)
 *   vgst > 0               Cgs = 2/3 Cox in saturation; in the linear region
 *                          Cgd = K(1 - s^2/(2s - vds)^2), Cgs = K(1 - (s - vds)^2/(2s - vds)^2), s = max(vdsat, 25 mV)
 */
export function meyerCaps(vgs: number, vds: number, c: MosCoreResult, phi: number, cox: number, out: MeyerCaps): MeyerCaps {
  out.cgs = 0;
  out.cgd = 0;
  out.cgb = 0;
  out.dcgs.fill(0);
  out.dcgd.fill(0);
  out.dcgb.fill(0);
  if (!(cox > 0)) return out;
  const u = vgs - c.von;
  const du0 = 1;
  const du1 = -c.dvonDvds;
  const du2 = -c.dvonDvbs;
  if (u <= -phi) {
    out.cgb = cox;
    return out;
  }
  const kb = -cox / phi;
  out.cgb = u <= 0 ? u * kb : 0;
  if (u <= 0) {
    out.dcgb[0] = kb * du0;
    out.dcgb[1] = kb * du1;
    out.dcgb[2] = kb * du2;
  }
  if (u <= -phi / 2) return out;
  let K: number;
  let dK0 = 0;
  let dK1 = 0;
  let dK2 = 0;
  if (u <= 0) {
    const kk = (4 / 3) * (cox / phi);
    K = kk * u + (2 / 3) * cox;
    dK0 = kk * du0;
    dK1 = kk * du1;
    dK2 = kk * du2;
  } else {
    K = (2 / 3) * cox;
  }
  let s = MEYER_MIN_VDSAT;
  let ds0 = 0;
  let ds1 = 0;
  let ds2 = 0;
  if (c.vdsat > MEYER_MIN_VDSAT) {
    s = c.vdsat;
    ds0 = c.dvdsatDvgs;
    ds1 = c.dvdsatDvds;
    ds2 = c.dvdsatDvbs;
  }
  if (vds >= s) {
    out.cgs = K;
    out.dcgs[0] = dK0;
    out.dcgs[1] = dK1;
    out.dcgs[2] = dK2;
    return out;
  }
  const D = 2 * s - vds;
  const D2 = D * D;
  const D3 = D2 * D;
  const sd = s - vds;
  const fd = 1 - (s * s) / D2;
  const fs = 1 - (sd * sd) / D2;
  const fdS = (2 * s * vds) / D3;
  const fdD = (-2 * s * s) / D3;
  const fsS = (-2 * sd * vds) / D3;
  const fsD = (2 * s * sd) / D3;
  out.cgd = K * fd;
  out.cgs = K * fs;
  out.dcgd[0] = dK0 * fd + K * fdS * ds0;
  out.dcgd[1] = dK1 * fd + K * (fdS * ds1 + fdD);
  out.dcgd[2] = dK2 * fd + K * fdS * ds2;
  out.dcgs[0] = dK0 * fs + K * fsS * ds0;
  out.dcgs[1] = dK1 * fs + K * (fsS * ds1 + fsD);
  out.dcgs[2] = dK2 * fs + K * fsS * ds2;
  return out;
}

/** Full device evaluation in global (device-polarity) orientation. */
export interface MosEval {
  /** +1 normal, -1 drain/source exchanged */
  mode: number;
  /** channel current d' -> s' and partials w.r.t. vgs, vds, vbs */
  cd: number;
  gGs: number;
  gDs: number;
  gBs: number;
  /** bulk junction currents b -> s', b -> d' (excluding gmin) and conductances */
  ibs: number;
  gbs: number;
  ibd: number;
  gbd: number;
  /** bulk junction charges and capacitances */
  qbs: number;
  capbs: number;
  qbd: number;
  capbd: number;
  /** Meyer caps (global orientation), gradients w.r.t. (vgs, vds, vbs) */
  meyer: MeyerCaps;
  /** mode-local core result (von, vdsat) */
  core: MosCoreResult;
}

function emptyEval(): MosEval {
  return {
    mode: 1,
    cd: 0,
    gGs: 0,
    gDs: 0,
    gBs: 0,
    ibs: 0,
    gbs: 0,
    ibd: 0,
    gbd: 0,
    qbs: 0,
    capbs: 0,
    qbd: 0,
    capbd: 0,
    meyer: emptyMeyer(),
    core: emptyCore(),
  };
}

function runCore(vgs: number, vds: number, vbs: number, t: MosTemp, out: MosCoreResult): MosCoreResult {
  if (t.l3) return mos3Core(vgs, vds, vbs, t, t.l3, out);
  if (t.l2) return mos2Core(vgs, vds, vbs, t, t.l2, out);
  return mos1Core(vgs, vds, vbs, t, out);
}

const scratchMeyer = emptyMeyer();

function evaluate(vgs: number, vds: number, vbs: number, t: MosTemp, out: MosEval, cc: ChargeCap): MosEval {
  const vbd = vbs - vds;
  // bulk diodes
  let a = vbs / t.vt;
  out.ibs = t.iss * (expLin(a) - 1);
  out.gbs = (t.iss * expLinDeriv(a)) / t.vt;
  a = vbd / t.vt;
  out.ibd = t.isd * (expLin(a) - 1);
  out.gbd = (t.isd * expLinDeriv(a)) / t.vt;

  const c = out.core;
  const m = out.meyer;
  if (vds >= 0) {
    out.mode = 1;
    runCore(vgs, vds, vbs, t, c);
    out.cd = c.ids;
    out.gGs = c.gm;
    out.gDs = c.gds;
    out.gBs = c.gmbs;
    meyerCaps(vgs, vds, c, t.phi, t.oxideCap, m);
  } else {
    // exchanged: local (vgs, vds, vbs) = (vgd, -vds, vbd); Id(global) = -ids(local)
    out.mode = -1;
    runCore(vgs - vds, -vds, vbd, t, c);
    out.cd = -c.ids;
    out.gGs = -c.gm;
    out.gBs = -c.gmbs;
    out.gDs = c.gm + c.gds + c.gmbs;
    const l = meyerCaps(vgs - vds, -vds, c, t.phi, t.oxideCap, scratchMeyer);
    // local Cgs is the global Cgd and vice versa; d/dvds(global) = -(d_g + d_d + d_b)(local)
    const map = (src: readonly number[], dst: [number, number, number]): void => {
      dst[0] = src[0];
      dst[2] = src[2];
      dst[1] = -(src[0] + src[1] + src[2]);
    };
    m.cgs = l.cgd;
    m.cgd = l.cgs;
    m.cgb = l.cgb;
    map(l.dcgd, m.dcgs);
    map(l.dcgs, m.dcgd);
    map(l.dcgb, m.dcgb);
  }

  depletionCharge(vbs, t.depBs, cc);
  out.qbs = cc.q;
  out.capbs = cc.c;
  depletionCharge(vbs, t.depBsSw, cc);
  out.qbs += cc.q;
  out.capbs += cc.c;
  depletionCharge(vbd, t.depBd, cc);
  out.qbd = cc.q;
  out.capbd = cc.c;
  depletionCharge(vbd, t.depBdSw, cc);
  out.qbd += cc.q;
  out.capbd += cc.c;
  return out;
}

const S_VBS = 0;
const S_VGS = 1;
const S_VDS = 2;
const S_CGS = 3;
const S_CGD = 4;
const S_CGB = 5;
const S_QGS = 6;
const S_QGD = 8;
const S_QGB = 10;
const S_QBD = 12;
const S_QBS = 14;
const N_STATES = 16;

export class Mosfet implements Device {
  readonly type = 'M' as const;
  readonly name: string;
  readonly nodeNames: string[];

  private readonly modelName: string | undefined;
  private card: ModelCard | undefined;
  private readonly inst: Record<string, number>;
  private readonly modelOverrides: Record<string, number> = {};
  private mp: MosModelParams = { ...MOS_DEFAULTS };
  private given: ReadonlySet<MosParam> = new Set();
  private pol = 1;
  private level: 1 | 2 | 3 = 1;
  /** option defaults for W, L, AD, AS (SPICE DEFW / DEFL / DEFAD / DEFAS) */
  private defW = DEFAULT_MOS_W;
  private defL = DEFAULT_MOS_L;
  private defAd = 0;
  private defAs = 0;
  private tnomDefaultC = 27;
  private ctxTempK = celsiusToKelvin(27);
  private warn: (message: string) => void = () => undefined;

  private nD = GROUND;
  private nG = GROUND;
  private nS = GROUND;
  private nB = GROUND;
  private nDi = GROUND;
  private nSi = GROUND;
  private hasRd = false;
  private hasRs = false;
  private st = 0;

  private tcache: MosTemp | undefined;
  private readonly ev: MosEval = emptyEval();
  private readonly cc: ChargeCap = { q: 0, c: 0 };

  private loaded = false;
  /** device-polarity threshold of the last load (used by fetlim) */
  private lastVon = Number.NaN;
  private lastVgs = 0;
  private lastVds = 0;
  private lastVbs = 0;
  private lastId = 0;
  private lastIb = 0;
  private lastG = [0, 0, 0];
  private lastGbs = 0;
  private lastGbd = 0;
  private lastGmin = 0;
  /** charge currents (device polarity) of qgs qgd qgb qbd qbs at the last transient load */
  private readonly qCur = new Float64Array(5);

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
    this.readDeviceOptions(ctx.options);
    const warned = new Set<string>();
    this.warn = (m) => {
      if (warned.has(m)) return;
      warned.add(m);
      ctx.warn(m);
    };
    warnUnknownParams(ctx, card, this.resolve());
    const lv = Math.round(this.mp.level);
    if (lv !== 1 && lv !== 2 && lv !== 3) {
      ctx.warn(`${this.name}: MOSFET level ${this.mp.level} is not supported, using level 1`);
    }
    this.nD = ctx.node(this.nodeNames[0]);
    this.nG = ctx.node(this.nodeNames[1]);
    this.nS = ctx.node(this.nodeNames[2]);
    // a 3-node MOSFET ties the bulk to the source
    this.nB = this.nodeNames.length > 3 ? ctx.node(this.nodeNames[3]) : this.nS;
    const t = this.temps(this.ctxTempK);
    this.hasRd = t.gd > 0;
    this.hasRs = t.gs > 0;
    this.nDi = this.hasRd ? ctx.node(`${this.name}#d`) : this.nD;
    this.nSi = this.hasRs ? ctx.node(`${this.name}#s`) : this.nS;
    this.st = ctx.state(N_STATES);
  }

  private resolve(): string[] {
    const r = resolveParams(MOS_DEFAULTS, MOS_ALIASES, this.card, this.modelOverrides, MOS_IGNORED);
    this.mp = r.p;
    this.given = r.given;
    const lv = Math.round(r.p.level);
    this.level = lv === 3 ? 3 : lv === 2 ? 2 : 1;
    if (this.level === 3 && !r.given.has('mjsw')) this.mp.mjsw = 0.33;
    this.tcache = undefined;
    return r.unknown;
  }

  /** Option defaults DEFW / DEFL / DEFAD / DEFAS (missing or invalid values keep SPICE's). */
  private readDeviceOptions(o: { defw?: number; defl?: number; defad?: number; defas?: number }): void {
    if (o.defw !== undefined && o.defw > 0) this.defW = o.defw;
    if (o.defl !== undefined && o.defl > 0) this.defL = o.defl;
    if (o.defad !== undefined && o.defad >= 0) this.defAd = o.defad;
    if (o.defas !== undefined && o.defas >= 0) this.defAs = o.defas;
  }

  private ip(key: string, def: number): number {
    return instanceParam(this.inst, [key]) ?? def;
  }

  private instanceTemp(ctxTemp: number): number {
    const t = instanceParam(this.inst, ['temp']);
    if (t !== undefined) return celsiusToKelvin(t);
    return ctxTemp + (instanceParam(this.inst, ['dtemp']) ?? 0);
  }

  /** Model-level process preprocessing (SPICE3): Cox, KP, and PHI/GAMMA/VTO from NSUB. */
  private process(tnomK: number): { cox: number; kp: number; phi: number; gamma: number; vto: number } {
    const p = this.mp;
    const g = this.given;
    const type = this.pol;
    let phi = p.phi;
    let gamma = p.gamma;
    let vto = p.vto;
    let kp = p.kp;
    let cox = 0;
    // levels 2 and 3 default TOX to 100 nm; level 1 without TOX has no intrinsic gate capacitance
    const tox = p.tox > 0 ? p.tox : this.level !== 1 ? 1e-7 : 0;
    if (tox > 0) {
      cox = EPS_OX / tox;
      if (!g.has('kp')) kp = p.u0 * cox * 1e-4;
      if (p.nsub > 0) {
        const vtnom = K_OVER_Q * tnomK;
        const egfet1 = siliconBandGap(tnomK);
        if (p.nsub * 1e6 > 1.45e16) {
          if (!g.has('phi')) phi = Math.max(0.1, 2 * vtnom * Math.log((p.nsub * 1e6) / 1.45e16));
          const fermis = type * 0.5 * phi;
          let wkfng = 3.2;
          if (p.tpg !== 0) {
            const fermig = type * p.tpg * 0.5 * egfet1;
            wkfng = 3.25 + 0.5 * egfet1 - fermig;
          }
          const wkfngs = wkfng - (3.25 + 0.5 * egfet1 + fermis);
          if (!g.has('gamma')) gamma = Math.sqrt(2 * 11.7 * EPS0 * CHARGE * p.nsub * 1e6) / cox;
          if (!g.has('vto')) {
            const vfb = wkfngs - (p.nss * 1e4 * CHARGE) / cox;
            vto = vfb + type * (gamma * Math.sqrt(phi) + phi);
          }
        } else {
          this.warn(`${this.name}: NSUB too small, ignored`);
        }
      }
    }
    if (!(phi > 0)) {
      this.warn(`${this.name}: PHI must be positive, using 0.6`);
      phi = 0.6;
    }
    return { cox, kp, phi, gamma, vto };
  }

  private temps(ctxTemp: number): MosTemp {
    const T = this.instanceTemp(ctxTemp);
    if (this.tcache && this.tcache.T === T) return this.tcache;
    const p = this.mp;
    const type = this.pol;
    const tnom = celsiusToKelvin(Number.isFinite(p.tnom) ? p.tnom : this.tnomDefaultC);
    const proc = this.process(tnom);
    const m = this.ip('m', 1);
    const w = this.ip('w', this.defW);
    const l = this.ip('l', this.defL);
    let leff = l - 2 * p.ld;
    if (!(leff > 0)) {
      this.warn(`${this.name}: effective channel length L-2*LD <= 0, using L`);
      leff = l;
    }
    let weff = w - 2 * p.wd;
    if (!(weff > 0)) weff = w;
    const vt = K_OVER_Q * T;
    const ratio = T / tnom;
    const ratio4 = ratio * Math.sqrt(ratio);
    const egfet = siliconBandGap(T);
    const egfet1 = siliconBandGap(tnom);
    const tPhi = junctionTemperature(proc.phi, 0, tnom, T).pot;
    const tVbi = proc.vto - type * proc.gamma * Math.sqrt(proc.phi) + 0.5 * (egfet1 - egfet) + type * 0.5 * (tPhi - proc.phi);
    const tVto = tVbi + type * proc.gamma * Math.sqrt(tPhi);
    const satFactor = Math.exp(egfet1 / (K_OVER_Q * tnom) - egfet / vt);
    const ad = this.ip('ad', this.defAd);
    const as = this.ip('as', this.defAs);
    const pd = this.ip('pd', 0);
    const ps = this.ip('ps', 0);
    const isd = p.js > 0 && ad > 0 ? p.js * satFactor * ad * m : p.is * satFactor * m;
    const iss = p.js > 0 && as > 0 ? p.js * satFactor * as * m : p.is * satFactor * m;
    const pb = p.pb > 0 ? p.pb : 0.8;
    const jb = junctionTemperature(pb, p.mj, tnom, T);
    const jsw = junctionTemperature(pb, p.mjsw, tnom, T);
    const czbd = this.given.has('cbd') ? p.cbd * jb.capFactor * m : p.cj * jb.capFactor * ad * m;
    const czbs = this.given.has('cbs') ? p.cbs * jb.capFactor * m : p.cj * jb.capFactor * as * m;
    const czbdsw = p.cjsw * jsw.capFactor * pd * m;
    const czbssw = p.cjsw * jsw.capFactor * ps * m;
    let rd = p.rd;
    let rs = p.rs;
    if (!this.given.has('rd') && p.rsh > 0) rd = p.rsh * this.ip('nrd', 1);
    if (!this.given.has('rs') && p.rsh > 0) rs = p.rsh * this.ip('nrs', 1);
    const kp = proc.kp / ratio4;
    const t: MosTemp = {
      T,
      vt,
      level: this.level,
      vbi: type * tVbi,
      vto: type * tVto,
      phi: tPhi,
      gamma: proc.gamma,
      lambda: p.lambda,
      beta: (kp * weff * m) / leff,
      u0: p.u0 / ratio4,
      coxArea: proc.cox,
      oxideCap: proc.cox * weff * leff * m,
      leff,
      weff,
      l3: undefined,
      gd: rd > 0 ? m / rd : 0,
      gs: rs > 0 ? m / rs : 0,
      isd,
      iss,
      vcritD: junctionVcrit(vt, isd),
      vcritS: junctionVcrit(vt, iss),
      depBd: depletionCoeffs(czbd, jb.pot, p.mj, p.fc),
      depBdSw: depletionCoeffs(czbdsw, jb.pot, p.mjsw, p.fc),
      depBs: depletionCoeffs(czbs, jb.pot, p.mj, p.fc),
      depBsSw: depletionCoeffs(czbssw, jb.pot, p.mjsw, p.fc),
      cgso: p.cgso * w * m,
      cgdo: p.cgdo * w * m,
      cgbo: p.cgbo * leff * m,
    };
    if (this.level === 3) {
      t.l3 = {
        nfs: p.nfs,
        theta: p.theta,
        eta: p.eta,
        kappa: p.kappa,
        vmax: p.vmax,
        xj: p.xj,
        delta: p.delta,
        ld: p.ld,
        nsub: p.nsub,
        kp,
        m,
      };
      // level 3 ignores LAMBDA (channel-length modulation comes from KAPPA)
      t.lambda = 0;
    } else if (this.level === 2) {
      t.l2 = {
        ucrit: p.ucrit,
        uexp: p.uexp,
        vmax: p.vmax,
        neff: p.neff,
        nfs: p.nfs,
        xj: p.xj,
        delta: p.delta,
        nsub: p.nsub,
        lambdaGiven: this.given.has('lambda'),
        kp,
        m,
      };
    }
    this.tcache = t;
    return t;
  }

  private voltages(x: (i: number) => number): { vgs: number; vds: number; vbs: number } {
    const s = this.pol;
    const vsi = x(this.nSi);
    return { vgs: s * (x(this.nG) - vsi), vds: s * (x(this.nDi) - vsi), vbs: s * (x(this.nB) - vsi) };
  }

  /** Stamp a branch current a -> b controlled by vgs (g,s'), vds (d',s'), vbs (b,s'). */
  private stampBranch(
    ctx: LoadContext,
    a: number,
    b: number,
    i: number,
    g0: number,
    g1: number,
    g2: number,
    vgs: number,
    vds: number,
    vbs: number,
  ): void {
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
          vbs = -1;
          vgs = t.vto;
          vds = 0;
        }
      }
    } else {
      const old = ctx.initTimepoint ? ctx.state1 : s0;
      const vgsOld = old[st + S_VGS];
      const vdsOld = old[st + S_VDS];
      const vbsOld = old[st + S_VBS];
      const von = Number.isFinite(this.lastVon) ? this.lastVon : t.vto;
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
      if (vds >= 0) {
        vbs = pnjlim(vbs, vbsOld, t.vt, t.vcritS);
      } else {
        const vbd = pnjlim(vbs - vds, vbsOld - vdsOld, t.vt, t.vcritD);
        vbs = vbd + vds;
      }
      limited = Math.abs(vgs - v.vgs) + Math.abs(vds - v.vds) + Math.abs(vbs - v.vbs) > 1e-12 * (1 + Math.abs(v.vgs) + Math.abs(v.vds));
    }
    const vbd = vbs - vds;
    const vgd = vgs - vds;
    const vgb = vgs - vbs;
    const e = evaluate(vgs, vds, vbs, t, this.ev, this.cc);
    const gmin = ctx.gmin;

    const { nD, nG, nS, nB, nDi, nSi } = this;
    if (this.hasRd) stampConductance(ctx, nD, nDi, t.gd);
    if (this.hasRs) stampConductance(ctx, nS, nSi, t.gs);
    stampConductance(ctx, nB, nSi, e.gbs + gmin);
    stampCurrent(ctx, nB, nSi, type * (e.ibs - e.gbs * vbs));
    stampConductance(ctx, nB, nDi, e.gbd + gmin);
    stampCurrent(ctx, nB, nDi, type * (e.ibd - e.gbd * vbd));
    this.stampBranch(ctx, nDi, nSi, e.cd, e.gGs, e.gDs, e.gBs, vgs, vds, vbs);

    // gate (Meyer + overlap) and bulk charges
    const my = e.meyer;
    const tran = ctx.mode === 'tran' && !ctx.tranOp && ctx.dt > 0;
    s0[st + S_VBS] = vbs;
    s0[st + S_VGS] = vgs;
    s0[st + S_VDS] = vds;
    s0[st + S_CGS] = my.cgs;
    s0[st + S_CGD] = my.cgd;
    s0[st + S_CGB] = my.cgb;
    s0[st + S_QBD] = e.qbd;
    s0[st + S_QBS] = e.qbs;
    this.qCur.fill(0);
    if (!tran) {
      s0[st + S_QGS] = vgs * (my.cgs + t.cgso);
      s0[st + S_QGD] = vgd * (my.cgd + t.cgdo);
      s0[st + S_QGB] = vgb * (my.cgb + t.cgbo);
      for (const k of [S_QGS, S_QGD, S_QGB, S_QBD, S_QBS]) s0[st + k + 1] = 0;
    } else {
      const s1 = ctx.state1;
      const vgs1 = s1[st + S_VGS];
      const vgd1 = vgs1 - s1[st + S_VDS];
      const vgb1 = vgs1 - s1[st + S_VBS];
      // q = q1 + Cavg*(v - v1), Cavg = (C + C1)/2 + Cov; dq/dvk = Cavg*dv/dvk + (v - v1)/2 * dC/dvk
      const gate = (
        slot: number,
        C: number,
        dC: readonly number[],
        C1: number,
        cov: number,
        vNow: number,
        vOld: number,
        dvdk: readonly [number, number, number],
        a: number,
        b: number,
        idx: number,
      ): void => {
        const cavg = 0.5 * (C + C1) + cov;
        const dv = vNow - vOld;
        const q = s1[st + slot] + cavg * dv;
        const d0 = cavg * dvdk[0] + 0.5 * dv * dC[0];
        const d1 = cavg * dvdk[1] + 0.5 * dv * dC[1];
        const d2 = cavg * dvdk[2] + 0.5 * dv * dC[2];
        const r = integrateCharge(ctx, st + slot, q, cavg, true);
        this.stampBranch(ctx, a, b, r.i, d0 * r.ag0, d1 * r.ag0, d2 * r.ag0, vgs, vds, vbs);
        this.qCur[idx] = r.i;
      };
      gate(S_QGS, my.cgs, my.dcgs, s1[st + S_CGS], t.cgso, vgs, vgs1, [1, 0, 0], nG, nSi, 0);
      gate(S_QGD, my.cgd, my.dcgd, s1[st + S_CGD], t.cgdo, vgd, vgd1, [1, -1, 0], nG, nDi, 1);
      gate(S_QGB, my.cgb, my.dcgb, s1[st + S_CGB], t.cgbo, vgb, vgb1, [1, 0, -1], nG, nB, 2);
      const bd = integrateCharge(ctx, st + S_QBD, e.qbd, e.capbd);
      stampConductance(ctx, nB, nDi, bd.geq);
      stampCurrent(ctx, nB, nDi, type * (bd.i - bd.geq * vbd));
      const bs = integrateCharge(ctx, st + S_QBS, e.qbs, e.capbs);
      stampConductance(ctx, nB, nSi, bs.geq);
      stampCurrent(ctx, nB, nSi, type * (bs.i - bs.geq * vbs));
      this.qCur[3] = bd.i;
      this.qCur[4] = bs.i;
    }

    if (limited) ctx.noncon();
    this.loaded = true;
    this.lastVon = e.core.von;
    this.lastVgs = vgs;
    this.lastVds = vds;
    this.lastVbs = vbs;
    this.lastId = e.cd - e.ibd;
    this.lastIb = e.ibs + e.ibd;
    // d(cd - ibd)/d(vgs, vds, vbs) with vbd = vbs - vds
    this.lastG = [e.gGs, e.gDs + e.gbd, e.gBs - e.gbd];
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
    const e = evaluate(v.vgs, v.vds, v.vbs, t, this.ev, this.cc);
    const w = ctx.omega;
    const gmin = ctx.options.gmin;
    const { nD, nG, nS, nB, nDi, nSi } = this;
    if (this.hasRd) stampAcAdmittance(ctx, nD, nDi, t.gd, 0);
    if (this.hasRs) stampAcAdmittance(ctx, nS, nSi, t.gs, 0);
    stampAcAdmittance(ctx, nB, nSi, e.gbs + gmin, w * e.capbs);
    stampAcAdmittance(ctx, nB, nDi, e.gbd + gmin, w * e.capbd);
    stampAcVccs(ctx, nDi, nSi, nG, nSi, e.gGs, 0);
    stampAcVccs(ctx, nDi, nSi, nDi, nSi, e.gDs, 0);
    stampAcVccs(ctx, nDi, nSi, nB, nSi, e.gBs, 0);
    stampAcAdmittance(ctx, nG, nSi, 0, w * (e.meyer.cgs + t.cgso));
    stampAcAdmittance(ctx, nG, nDi, 0, w * (e.meyer.cgd + t.cgdo));
    stampAcAdmittance(ctx, nG, nB, 0, w * (e.meyer.cgb + t.cgbo));
  }

  truncate(ctx: TruncContext): number {
    const t = this.temps(this.ctxTempK);
    const st = this.st;
    let dt = Infinity;
    if (t.oxideCap > 0 || t.cgso > 0) dt = Math.min(dt, ctx.terr(st + S_QGS));
    if (t.oxideCap > 0 || t.cgdo > 0) dt = Math.min(dt, ctx.terr(st + S_QGD));
    if (t.oxideCap > 0 || t.cgbo > 0) dt = Math.min(dt, ctx.terr(st + S_QGB));
    if (t.depBd.cj0 > 0 || t.depBdSw.cj0 > 0) dt = Math.min(dt, ctx.terr(st + S_QBD));
    if (t.depBs.cj0 > 0 || t.depBsSw.cj0 > 0) dt = Math.min(dt, ctx.terr(st + S_QBS));
    return dt;
  }

  noise(ctx: NoiseContext): NoiseGenerator[] {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = evaluate(v.vgs, v.vds, v.vbs, t, emptyEval(), { q: 0, c: 0 });
    const T = t.T;
    const dev = this.name;
    const { kf, af } = this.mp;
    const gm = Math.abs(e.mode > 0 ? e.gGs : e.core.gm);
    const cd = Math.abs(e.cd);
    // SPICE3: KF*|Id|^AF / (f * Leff^2 * Cox'); without TOX the geometry factor is omitted
    const geo = t.coxArea > 0 ? t.leff * t.leff * t.coxArea : 1;
    const gens: NoiseGenerator[] = [];
    if (this.hasRd) gens.push({ name: 'thermal_rd', device: dev, pos: this.nD, neg: this.nDi, density: () => thermalNoise(T, t.gd) });
    if (this.hasRs) gens.push({ name: 'thermal_rs', device: dev, pos: this.nS, neg: this.nSi, density: () => thermalNoise(T, t.gs) });
    gens.push({ name: 'thermal_channel', device: dev, pos: this.nDi, neg: this.nSi, density: () => thermalNoise(T, (2 / 3) * gm) });
    if (kf !== 0) {
      gens.push({
        name: 'flicker',
        device: dev,
        pos: this.nDi,
        neg: this.nSi,
        density: (f) => (f > 0 ? (kf * Math.exp(af * Math.log(Math.max(cd, 1e-38)))) / (f * geo) : 0),
      });
    }
    return gens;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const t = this.temps(this.ctxTempK);
    const v = this.voltages(x);
    const e = evaluate(v.vgs, v.vds, v.vbs, t, emptyEval(), { q: 0, c: 0 });
    const g = this.lastGmin;
    const vbd = v.vbs - v.vds;
    const [iqgs, iqgd, iqgb, iqbd, iqbs] = this.qCur;
    const ibd = e.ibd + g * vbd + iqbd;
    const ibs = e.ibs + g * v.vbs + iqbs;
    const s = this.pol;
    const id = s * (e.cd - ibd - iqgd);
    const ig = s * (iqgs + iqgd + iqgb);
    const ib = s * (ibs + ibd - iqgb);
    const is = -(id + ig + ib);
    const p = x(this.nD) * id + x(this.nG) * ig + x(this.nS) * is + x(this.nB) * ib;
    return { Id: id, Ig: ig, Is: is, Ib: ib, P: p };
  }

  setParam(param: string, value: number): void {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      this.inst[k] = value;
      this.tcache = undefined;
      return;
    }
    const c = canonicalParam(MOS_DEFAULTS, MOS_ALIASES, k);
    if (c === undefined) throw runtimeParamError(this.name, param);
    this.modelOverrides[c] = value;
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
      if (k === 'm' || k === 'nrd' || k === 'nrs') return 1;
      return undefined;
    }
    const c = canonicalParam(MOS_DEFAULTS, MOS_ALIASES, k);
    return c !== undefined ? this.mp[c] : undefined;
  }

  /** Evaluation at device-polarity terminal voltages (diagnostics / tests). */
  evaluateAt(vgs: number, vds: number, vbs: number, tempK: number): MosEval {
    return evaluate(vgs, vds, vbs, this.temps(tempK), emptyEval(), { q: 0, c: 0 });
  }

  /** Temperature/geometry-adjusted parameters (diagnostics / tests). */
  derived(tempK: number): Readonly<MosTemp> {
    return this.temps(tempK);
  }

  get polarity(): number {
    return this.pol;
  }

  get stateBase(): number {
    return this.st;
  }
}

export function createMosfet(el: ElementIR): Device {
  return new Mosfet(el);
}
