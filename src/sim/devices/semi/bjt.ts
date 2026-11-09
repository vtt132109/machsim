/**
 * Bipolar junction transistor — element 'Q', model types NPN / PNP (Gummel-Poon).
 *
 * Nodes: [collector, base, emitter] or [collector, base, emitter, substrate] (substrate defaults
 * to ground). Instance params: area (1), m (parallel count, multiplies area), off,
 * ic_vbe / ic_vce (UIC initial conditions, aliases icvbe / icvce), temp (°C), dtemp (°C).
 *
 * Model parameters (SPICE3 Gummel-Poon, own implementation; SPICE3 defaults):
 *   IS BF NF VAF(VA) IKF(IK) ISE NE BR NR VAR(VB) IKR ISC NC RB IRB RBM RE RC
 *   CJE(PE=VJE, ME=MJE) VJE MJE TF XTF VTF ITF PTF CJC VJC(PC) MJC(MC) XCJC TR
 *   CJS(CCS, CSUB) VJS(PS) MJS(MS) XTB EG XTI KF AF FC TNOM
 *   extensions: NK (high-injection exponent, 0.5), TRB1/TRB2, TRM1/TRM2, TRE1/TRE2, TRC1/TRC2
 *   (resistor temperature coefficients), C2/C4 (SPICE2: ISE = C2*IS, ISC = C4*IS when ISE/ISC
 *   are not given).
 *
 * Equations (device polarity: every voltage is multiplied by type = +1 NPN / -1 PNP):
 *   ideal diodes  cbe = IS*(exp(vbe/(NF vt)) - 1),  cbc = IS*(exp(vbc/(NR vt)) - 1)
 *   leakage       cben = ISE*(exp(vbe/(NE vt)) - 1), cbcn = ISC*(exp(vbc/(NC vt)) - 1)
 *   base charge   q1 = 1/(1 - vbc/VAF - vbe/VAR),  q2 = cbe/IKF + cbc/IKR,
 *                 qb = q1*(1 + (1 + 4 q2)^NK)/2
 *   transport     it = (cbe - cbc)/qb                (c' -> e')
 *   base          ibe = cbe/BF + cben (b' -> e'),  ibc = cbc/BR + cbcn (b' -> c')
 *   base resist.  IRB = 0: rb = RBM + (RB - RBM)/qb;  IRB > 0: SPICE crowding formula with z
 *   charges       qbe = TF*(1 + XTF*(cbe/(cbe+ITF))^2 * exp(vbc/(1.44 VTF)))*cbe/qb + depl(CJE)
 *                 qbc = TR*cbc + depl(XCJC*CJC),  qbx = depl((1-XCJC)*CJC) on (b, c'),
 *                 qcs = depl(CJS, FC = 0) on (s, c')
 *   excess phase  PTF (degrees at 1/(2 pi TF)): Weil's second-order delay of the forward
 *                 transport current in transient, exp(-j w td) rotation in AC.
 *   gmin (LoadContext.gmin) is stamped across b'-e' and b'-c'.
 * Every stamped conductance is the exact partial derivative of the stamped current, including
 * the cross terms of the bias-dependent base resistance and of the transit-time charge.
 *
 * Temperature (SPICE3): IS (EG, XTI), BF/BR (XTB), ISE/ISC (EG, XTI, NE/NC, XTB), junction
 * potentials and zero-bias capacitances, series resistances (TRx1/TRx2).
 *
 * Internal nodes (only when the resistance is > 0): "<name>#c", "<name>#b", "<name>#e".
 * State slots (12): vbe vbc | qbe iqbe | qbc iqbc | qbx iqbx | qcs iqcs | cexbc | time.
 * Outputs: Ic, Ib, Ie (currents INTO the collector / base / emitter terminals, Ie = -(Ic+Ib+Isub)),
 * Isub (into the substrate terminal; 4-terminal devices only), P (power absorbed).
 */

import type { AcContext, Device, LoadContext, NoiseContext, NoiseGenerator, SetupContext, TruncContext } from '../../device';
import { GROUND } from '../../device';
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
  findModel,
  flickerNoise,
  instanceParam,
  integrateCharge,
  junctionTemperature,
  junctionVcrit,
  pnjlim,
  resolveParams,
  satCurrentFactor,
  shotNoise,
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

export const BJT_DEFAULTS = {
  is: 1e-16,
  bf: 100,
  nf: 1,
  vaf: 0,
  ikf: 0,
  ise: 0,
  ne: 1.5,
  br: 1,
  nr: 1,
  var: 0,
  ikr: 0,
  isc: 0,
  nc: 2,
  rb: 0,
  irb: 0,
  rbm: Number.NaN,
  re: 0,
  rc: 0,
  cje: 0,
  vje: 0.75,
  mje: 0.33,
  tf: 0,
  xtf: 0,
  vtf: 0,
  itf: 0,
  ptf: 0,
  cjc: 0,
  vjc: 0.75,
  mjc: 0.33,
  xcjc: 1,
  tr: 0,
  cjs: 0,
  vjs: 0.75,
  mjs: 0,
  xtb: 0,
  eg: 1.11,
  xti: 3,
  kf: 0,
  af: 1,
  fc: 0.5,
  nk: 0.5,
  tnom: Number.NaN,
  trb1: 0,
  trb2: 0,
  trm1: 0,
  trm2: 0,
  tre1: 0,
  tre2: 0,
  trc1: 0,
  trc2: 0,
  c2: 0,
  c4: 0,
} as const;

export type BjtParam = keyof typeof BJT_DEFAULTS;
export type BjtModelParams = Record<BjtParam, number>;

export const BJT_ALIASES: Readonly<Record<string, BjtParam>> = {
  va: 'vaf',
  vb: 'var',
  ik: 'ikf',
  pe: 'vje',
  me: 'mje',
  pc: 'vjc',
  mc: 'mjc',
  ps: 'vjs',
  ms: 'mjs',
  ccs: 'cjs',
  csub: 'cjs',
  tref: 'tnom',
  t_measured: 'tnom',
  trb: 'trb1',
  trm: 'trm1',
  tre: 'tre1',
  trc: 'trc1',
};

/** Card keys accepted without effect (handled elsewhere or purely descriptive). */
const BJT_IGNORED = new Set(['level', 'subs', 't_abs', 't_rel_global', 't_rel_local']);

const INSTANCE_KEYS = new Set(['area', 'm', 'off', 'ic_vbe', 'ic_vce', 'icvbe', 'icvce', 'temp', 'dtemp']);

/** Temperature-, area- and multiplicity-adjusted parameters. */
interface BjtTemp {
  T: number;
  vt: number;
  isat: number;
  ise: number;
  isc: number;
  bf: number;
  br: number;
  nfvt: number;
  nrvt: number;
  nevt: number;
  ncvt: number;
  invVaf: number;
  invVar: number;
  invIkf: number;
  invIkr: number;
  nk: number;
  /** minimum base resistance RBM/area */
  rbpr: number;
  /** RB/area - rbpr */
  rbpi: number;
  /** IRB*area (0: no current crowding) */
  irb: number;
  gc: number;
  ge: number;
  tf: number;
  tr: number;
  xtf: number;
  /** 1/(1.44*VTF) or 0 */
  ovtf: number;
  /** ITF*area */
  itf: number;
  /** excess-phase delay PTF[rad]*TF, s */
  td: number;
  depBe: DepletionCoeffs;
  depBc: DepletionCoeffs;
  depBx: DepletionCoeffs;
  depCs: DepletionCoeffs;
  vcrit: number;
}

/** Complete static + charge evaluation at one bias point (device polarity). */
export interface BjtEval {
  /** ideal forward / reverse diode currents and conductances */
  cbe: number;
  gbe: number;
  cbc: number;
  gbc: number;
  /** normalised base charge and its partial derivatives */
  qb: number;
  dqbdve: number;
  dqbdvc: number;
  /** transport current c' -> e' and its partial derivatives w.r.t. vbe, vbc */
  it: number;
  gitBe: number;
  gitBc: number;
  /** base-emitter current b' -> e' (cbe/BF + cben) and d/dvbe */
  ibe: number;
  gpi: number;
  /** base-collector current b' -> c' (cbc/BR + cbcn) and d/dvbc */
  ibc: number;
  gmu: number;
  /** base-resistance conductance and its partial derivatives w.r.t. vbe, vbc (0 without RB) */
  gx: number;
  gxBe: number;
  gxBc: number;
  /** charges and capacitances */
  qbe: number;
  capbe: number;
  /** d qbe / d vbc (transit-time modulation) */
  capbeBc: number;
  qbc: number;
  capbc: number;
  qbx: number;
  capbx: number;
  qcs: number;
  capcs: number;
}

function emptyEval(): BjtEval {
  return {
    cbe: 0,
    gbe: 0,
    cbc: 0,
    gbc: 0,
    qb: 1,
    dqbdve: 0,
    dqbdvc: 0,
    it: 0,
    gitBe: 0,
    gitBc: 0,
    ibe: 0,
    gpi: 0,
    ibc: 0,
    gmu: 0,
    gx: 0,
    gxBe: 0,
    gxBc: 0,
    qbe: 0,
    capbe: 0,
    capbeBc: 0,
    qbc: 0,
    capbc: 0,
    qbx: 0,
    capbx: 0,
    qcs: 0,
    capcs: 0,
  };
}

/** Smallest denominator 1 - vbc/VAF - vbe/VAR accepted (beyond: q1 is frozen). */
const Q1_DENOM_MIN = 1e-3;

/**
 * Current-crowding base-resistance shape f(z) = 3 (tan z - z) / (z tan^2 z) and df/dz.
 * A Taylor series is used for small z, where the closed form cancels catastrophically.
 */
function crowdingShape(z: number): { f: number; df: number } {
  if (z < 0.1) {
    const z2 = z * z;
    return {
      f: 1 - (4 / 15) * z2 - (4 / 105) * z2 * z2 - (8 / 1575) * z2 * z2 * z2,
      df: z * (-(8 / 15) - (16 / 105) * z2 - (48 / 1575) * z2 * z2),
    };
  }
  const t = Math.tan(z);
  const f = (3 * (t - z)) / (z * t * t);
  const df = f * ((t * t) / (t - z) - 1 / z - (2 * (1 + t * t)) / t);
  return { f, df };
}

/** Effective base resistance with current crowding (IRB > 0) and its derivative w.r.t. ib. */
function crowdedBaseResistance(ib: number, t: BjtTemp): { rb: number; drb: number } {
  const u = ib / t.irb;
  if (!(u > 1e-9)) {
    // below the SPICE clamp the formula is frozen at u = 1e-9 (rb ~ RB)
    const u0 = 1e-9;
    const s0 = Math.sqrt(1 + 14.59025 * u0);
    const z0 = (s0 - 1) / (2.4317 * Math.sqrt(u0));
    return { rb: t.rbpr + t.rbpi * crowdingShape(z0).f, drb: 0 };
  }
  const su = Math.sqrt(u);
  const s = Math.sqrt(1 + 14.59025 * u);
  const z = (s - 1) / (2.4317 * su);
  const dzdu = ((14.59025 / (2 * s)) * su - (s - 1) / (2 * su)) / (2.4317 * u);
  const sh = crowdingShape(z);
  return { rb: t.rbpr + t.rbpi * sh.f, drb: (t.rbpi * sh.df * dzdu) / t.irb };
}

/**
 * Evaluate the Gummel-Poon equations at (vbe, vbc, vbx, vcs).
 * `arg3`/`hist` implement the excess-phase filter of the forward transport current
 * (arg3 = 1, hist = 0 outside transient): it = hist + (arg3*cbe - cbc)/qb.
 */
function evaluate(
  vbe: number,
  vbc: number,
  vbx: number,
  vcs: number,
  t: BjtTemp,
  hasRb: boolean,
  arg3: number,
  hist: number,
  out: BjtEval,
  cc: ChargeCap,
): BjtEval {
  // ideal and leakage diodes
  let a = vbe / t.nfvt;
  const cbe = t.isat * (expLin(a) - 1);
  const gbe = (t.isat * expLinDeriv(a)) / t.nfvt;
  a = vbc / t.nrvt;
  const cbc = t.isat * (expLin(a) - 1);
  const gbc = (t.isat * expLinDeriv(a)) / t.nrvt;
  let cben = 0;
  let gben = 0;
  if (t.ise > 0) {
    a = vbe / t.nevt;
    cben = t.ise * (expLin(a) - 1);
    gben = (t.ise * expLinDeriv(a)) / t.nevt;
  }
  let cbcn = 0;
  let gbcn = 0;
  if (t.isc > 0) {
    a = vbc / t.ncvt;
    cbcn = t.isc * (expLin(a) - 1);
    gbcn = (t.isc * expLinDeriv(a)) / t.ncvt;
  }

  // normalised base charge
  let den = 1 - vbc * t.invVaf - vbe * t.invVar;
  let frozen = false;
  if (den < Q1_DENOM_MIN) {
    den = Q1_DENOM_MIN;
    frozen = true;
  }
  const q1 = 1 / den;
  const dq1dve = frozen ? 0 : q1 * q1 * t.invVar;
  const dq1dvc = frozen ? 0 : q1 * q1 * t.invVaf;
  let qb: number;
  let dqbdve: number;
  let dqbdvc: number;
  if (t.invIkf === 0 && t.invIkr === 0) {
    qb = q1;
    dqbdve = dq1dve;
    dqbdvc = dq1dvc;
  } else {
    const q2 = t.invIkf * cbe + t.invIkr * cbc;
    const arg = 1 + 4 * q2;
    let sq = 0;
    let dsq = 0;
    if (arg > 0) {
      sq = Math.pow(arg, t.nk);
      dsq = (4 * t.nk * sq) / arg;
    }
    const h = (1 + sq) / 2;
    qb = q1 * h;
    dqbdve = dq1dve * h + (q1 / 2) * dsq * t.invIkf * gbe;
    dqbdvc = dq1dvc * h + (q1 / 2) * dsq * t.invIkr * gbc;
  }

  // transport current (forward part possibly delayed by the excess-phase filter)
  const cex = cbe * arg3;
  const gex = gbe * arg3;
  const diff = cex - cbc;
  out.it = hist + diff / qb;
  out.gitBe = (gex - (diff * dqbdve) / qb) / qb;
  out.gitBc = (-gbc - (diff * dqbdvc) / qb) / qb;

  out.ibe = cbe / t.bf + cben;
  out.gpi = gbe / t.bf + gben;
  out.ibc = cbc / t.br + cbcn;
  out.gmu = gbc / t.br + gbcn;

  // base resistance
  out.gx = 0;
  out.gxBe = 0;
  out.gxBc = 0;
  if (hasRb) {
    if (t.irb > 0) {
      const r = crowdedBaseResistance(out.ibe + out.ibc, t);
      const gx = 1 / r.rb;
      const dgx = -gx * gx * r.drb;
      out.gx = gx;
      out.gxBe = dgx * out.gpi;
      out.gxBc = dgx * out.gmu;
    } else {
      const rb = t.rbpr + t.rbpi / qb;
      const gx = 1 / rb;
      const k = (gx * gx * t.rbpi) / (qb * qb);
      out.gx = gx;
      out.gxBe = k * dqbdve;
      out.gxBc = k * dqbdvc;
    }
  }

  // base-emitter charge: transit time (with XTF/ITF/VTF modulation) + depletion
  let qdiff = 0;
  let cdiffBe = 0;
  let cdiffBc = 0;
  if (t.tf > 0) {
    let argtf = 0;
    let arg2 = 0;
    let arg3tf = 0;
    if (t.xtf > 0) {
      argtf = t.xtf;
      if (t.ovtf !== 0) argtf *= Math.exp(Math.min(vbc * t.ovtf, 80));
      arg2 = argtf;
      if (t.itf > 0 && cbe + t.itf > 0) {
        const tmp = cbe / (cbe + t.itf);
        argtf *= tmp * tmp;
        arg2 = argtf * (3 - tmp - tmp);
      }
      arg3tf = cbe * argtf * t.ovtf;
    }
    const cbeMod = (cbe * (1 + argtf)) / qb;
    qdiff = t.tf * cbeMod;
    cdiffBe = (t.tf * (gbe * (1 + arg2) - cbeMod * dqbdve)) / qb;
    cdiffBc = (t.tf * (arg3tf - cbeMod * dqbdvc)) / qb;
  }
  depletionCharge(vbe, t.depBe, cc);
  out.qbe = qdiff + cc.q;
  out.capbe = cdiffBe + cc.c;
  out.capbeBc = cdiffBc;

  depletionCharge(vbc, t.depBc, cc);
  out.qbc = t.tr * cbc + cc.q;
  out.capbc = t.tr * gbc + cc.c;

  depletionCharge(vbx, t.depBx, cc);
  out.qbx = cc.q;
  out.capbx = cc.c;

  depletionCharge(vcs, t.depCs, cc);
  out.qcs = cc.q;
  out.capcs = cc.c;

  out.cbe = cbe;
  out.gbe = gbe;
  out.cbc = cbc;
  out.gbc = gbc;
  out.qb = qb;
  out.dqbdve = dqbdve;
  out.dqbdvc = dqbdvc;
  return out;
}

// state slot offsets
const S_VBE = 0;
const S_VBC = 1;
const S_QBE = 2;
const S_QBC = 4;
const S_QBX = 6;
const S_QCS = 8;
const S_CEX = 10;
const S_TIME = 11;
const N_STATES = 12;

export class Bjt implements Device {
  readonly type = 'Q' as const;
  readonly name: string;
  readonly nodeNames: string[];

  private readonly modelName: string | undefined;
  private card: ModelCard | undefined;
  private readonly inst: Record<string, number>;
  private readonly modelOverrides: Record<string, number> = {};
  private mp: BjtModelParams = { ...BJT_DEFAULTS };
  private given: ReadonlySet<BjtParam> = new Set();
  /** +1 NPN, -1 PNP */
  private pol = 1;
  private tnomDefaultC = 27;
  private ctxTempK = celsiusToKelvin(27);

  private nC = GROUND;
  private nB = GROUND;
  private nE = GROUND;
  private nS = GROUND;
  private nCi = GROUND;
  private nBi = GROUND;
  private nEi = GROUND;
  private hasRb = false;
  private hasRc = false;
  private hasRe = false;
  private st = 0;

  private tcache: BjtTemp | undefined;
  private readonly ev: BjtEval = emptyEval();
  private readonly cc: ChargeCap = { q: 0, c: 0 };

  // last load (convTest / outputs)
  private loaded = false;
  private lastVbe = 0;
  private lastVbc = 0;
  private lastIc = 0;
  private lastIb = 0;
  private lastGcBe = 0;
  private lastGcBc = 0;
  private lastGbBe = 0;
  private lastGbBc = 0;
  private lastGmin = 0;
  private lastArg3 = 1;
  private lastHist = 0;
  /** charge currents (device polarity) of qbe, qbc, qbx, qcs at the last transient load */
  private readonly qCur = new Float64Array(4);

  constructor(el: ElementIR) {
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
    this.modelName = el.model;
    this.inst = { ...el.params };
  }

  setup(ctx: SetupContext): void {
    if (this.nodeNames.length < 3) throw new Error(`${this.name}: BJT needs 3 or 4 nodes`);
    const { card, type } = findModel(ctx, this.name, this.modelName, ['NPN', 'PNP'], 'NPN');
    this.card = card;
    this.pol = type === 'PNP' ? -1 : 1;
    this.tnomDefaultC = ctx.options.tnom;
    this.ctxTempK = celsiusToKelvin(ctx.options.temp);
    warnUnknownParams(ctx, card, this.resolve());
    const level = card?.params.level;
    if (level !== undefined && level !== 1) {
      ctx.warn(`${this.name}: BJT model level ${level} is not supported, using Gummel-Poon (level 1)`);
    }
    this.nC = ctx.node(this.nodeNames[0]);
    this.nB = ctx.node(this.nodeNames[1]);
    this.nE = ctx.node(this.nodeNames[2]);
    this.nS = this.nodeNames.length > 3 ? ctx.node(this.nodeNames[3]) : GROUND;
    const p = this.mp;
    this.hasRc = p.rc > 0;
    this.hasRb = p.rb > 0;
    this.hasRe = p.re > 0;
    this.nCi = this.hasRc ? ctx.node(`${this.name}#c`) : this.nC;
    this.nBi = this.hasRb ? ctx.node(`${this.name}#b`) : this.nB;
    this.nEi = this.hasRe ? ctx.node(`${this.name}#e`) : this.nE;
    this.st = ctx.state(N_STATES);
  }

  private resolve(): string[] {
    const r = resolveParams(BJT_DEFAULTS, BJT_ALIASES, this.card, this.modelOverrides, BJT_IGNORED);
    const p = r.p;
    if (!r.given.has('ise') && p.c2 > 0) p.ise = p.c2 * p.is;
    if (!r.given.has('isc') && p.c4 > 0) p.isc = p.c4 * p.is;
    this.mp = p;
    this.given = r.given;
    this.tcache = undefined;
    return r.unknown;
  }

  private areaFactor(): number {
    return (instanceParam(this.inst, ['area']) ?? 1) * (instanceParam(this.inst, ['m']) ?? 1);
  }

  private instanceTemp(ctxTemp: number): number {
    const t = instanceParam(this.inst, ['temp']);
    if (t !== undefined) return celsiusToKelvin(t);
    return ctxTemp + (instanceParam(this.inst, ['dtemp']) ?? 0);
  }

  private temps(ctxTemp: number): BjtTemp {
    const T = this.instanceTemp(ctxTemp);
    if (this.tcache && this.tcache.T === T) return this.tcache;
    const p = this.mp;
    const tnom = celsiusToKelvin(Number.isFinite(p.tnom) ? p.tnom : this.tnomDefaultC);
    const area = this.areaFactor();
    const vt = K_OVER_Q * T;
    const ratio = T / tnom;
    const dT = T - tnom;
    const nf = p.nf > 0 ? p.nf : 1;
    const nr = p.nr > 0 ? p.nr : 1;
    const ne = p.ne > 0 ? p.ne : 1.5;
    const nc = p.nc > 0 ? p.nc : 2;
    // SPICE3: IS scales with exp((T/Tnom-1)*EG/vt) * ratio^XTI (no NF), betas with ratio^XTB
    const factor = satCurrentFactor(T, tnom, p.eg, p.xti, 1);
    const bfactor = Math.exp(p.xtb * Math.log(ratio));
    const factlog = Math.log(factor);
    const isat = p.is * factor * area;
    const ise = p.ise > 0 ? ((p.ise * Math.exp(factlog / ne)) / bfactor) * area : 0;
    const isc = p.isc > 0 ? ((p.isc * Math.exp(factlog / nc)) / bfactor) * area : 0;
    const rbm = Number.isFinite(p.rbm) && this.given.has('rbm') ? Math.min(p.rbm, p.rb) : p.rb;
    const rbT = p.rb * (1 + p.trb1 * dT + p.trb2 * dT * dT);
    const rbmT = rbm * (1 + p.trm1 * dT + p.trm2 * dT * dT);
    const rcT = p.rc * (1 + p.trc1 * dT + p.trc2 * dT * dT);
    const reT = p.re * (1 + p.tre1 * dT + p.tre2 * dT * dT);
    const rbpr = Math.max(rbmT, 0) / area;
    const rbpi = Math.max(rbT / area - rbpr, 0);
    const be = junctionTemperature(p.vje > 0 ? p.vje : 0.75, p.mje, tnom, T);
    const bc = junctionTemperature(p.vjc > 0 ? p.vjc : 0.75, p.mjc, tnom, T);
    const cs = junctionTemperature(p.vjs > 0 ? p.vjs : 0.75, p.mjs, tnom, T);
    const cjc = p.cjc * bc.capFactor * area;
    const xcjc = Math.min(Math.max(p.xcjc, 0), 1);
    const posOrMilli = (r: number): number => (r > 0 ? r : 1e-3);
    this.tcache = {
      T,
      vt,
      isat,
      ise,
      isc,
      bf: (p.bf > 0 ? p.bf : 100) * bfactor,
      br: (p.br > 0 ? p.br : 1) * bfactor,
      nfvt: nf * vt,
      nrvt: nr * vt,
      nevt: ne * vt,
      ncvt: nc * vt,
      invVaf: p.vaf > 0 ? 1 / p.vaf : 0,
      invVar: p.var > 0 ? 1 / p.var : 0,
      invIkf: p.ikf > 0 ? 1 / (p.ikf * area) : 0,
      invIkr: p.ikr > 0 ? 1 / (p.ikr * area) : 0,
      nk: p.nk > 0 ? p.nk : 0.5,
      rbpr: this.hasRb ? Math.max(rbpr, 1e-12) : 0,
      rbpi: this.hasRb ? rbpi : 0,
      irb: p.irb > 0 ? p.irb * area : 0,
      gc: this.hasRc ? area / posOrMilli(rcT) : 0,
      ge: this.hasRe ? area / posOrMilli(reT) : 0,
      tf: Math.max(p.tf, 0),
      tr: Math.max(p.tr, 0),
      xtf: Math.max(p.xtf, 0),
      ovtf: p.vtf > 0 ? 1 / (1.44 * p.vtf) : 0,
      itf: Math.max(p.itf, 0) * area,
      td: p.ptf > 0 && p.tf > 0 ? ((p.ptf * Math.PI) / 180) * p.tf : 0,
      depBe: depletionCoeffs(p.cje * be.capFactor * area, be.pot, p.mje, p.fc),
      depBc: depletionCoeffs(cjc * xcjc, bc.pot, p.mjc, p.fc),
      depBx: depletionCoeffs(cjc * (1 - xcjc), bc.pot, p.mjc, p.fc),
      depCs: depletionCoeffs(p.cjs * cs.capFactor * area, cs.pot, p.mjs, 0),
      vcrit: junctionVcrit(vt, isat),
    };
    return this.tcache;
  }

  /** Device-polarity branch voltages at a solution. */
  private voltages(x: (i: number) => number): { vbe: number; vbc: number; vbx: number; vcs: number; vrb: number } {
    const s = this.pol;
    return {
      vbe: s * (x(this.nBi) - x(this.nEi)),
      vbc: s * (x(this.nBi) - x(this.nCi)),
      vbx: s * (x(this.nB) - x(this.nCi)),
      vcs: s * (x(this.nS) - x(this.nCi)),
      vrb: s * (x(this.nB) - x(this.nBi)),
    };
  }

  load(ctx: LoadContext): void {
    this.ctxTempK = ctx.temp;
    const t = this.temps(ctx.temp);
    const type = this.pol;
    const s0 = ctx.state0;
    const st = this.st;
    const v = this.voltages(ctx.x);
    let vbe: number;
    let vbc: number;
    let vbx = v.vbx;
    let vcs = v.vcs;
    let limited = false;
    if (ctx.uic && ctx.tranOp) {
      const icVbe = instanceParam(this.inst, ['ic_vbe', 'icvbe']);
      const icVce = instanceParam(this.inst, ['ic_vce', 'icvce']);
      vbe = icVbe !== undefined ? type * icVbe : v.vbe;
      vbc = icVce !== undefined ? vbe - type * icVce : v.vbc;
      if (icVbe !== undefined || icVce !== undefined) vbx = vbc;
    } else if (ctx.initJunctions) {
      const off = (instanceParam(this.inst, ['off']) ?? 0) !== 0;
      vbe = off ? 0 : t.vcrit;
      vbc = 0;
      vbx = 0;
      vcs = 0;
    } else {
      const old = ctx.initTimepoint ? ctx.state1 : s0;
      vbe = pnjlim(v.vbe, old[st + S_VBE], t.vt, t.vcrit);
      vbc = pnjlim(v.vbc, old[st + S_VBC], t.vt, t.vcrit);
      limited = vbe !== v.vbe || vbc !== v.vbc;
    }

    // excess phase (transient only)
    const tran = ctx.mode === 'tran' && !ctx.tranOp && ctx.dt > 0;
    let arg3 = 1;
    let hist = 0;
    if (t.td > 0 && tran) {
      const a1 = ctx.dt / t.td;
      const a2 = 3 * a1;
      const a1b = a2 * a1;
      const denom = 1 + a1b + a2;
      arg3 = a1b / denom;
      const s1 = ctx.state1;
      const s2 = ctx.state2;
      const dtOld = s1[st + S_TIME] - s2[st + S_TIME];
      const r = dtOld > 0 ? ctx.dt / dtOld : 1;
      hist = (s1[st + S_CEX] * (1 + r + a2) - s2[st + S_CEX] * r) / denom;
    }

    const e = evaluate(vbe, vbc, vbx, vcs, t, this.hasRb, arg3, hist, this.ev, this.cc);
    const gmin = ctx.gmin;
    s0[st + S_VBE] = vbe;
    s0[st + S_VBC] = vbc;
    s0[st + S_CEX] = hist + (e.cbe * arg3) / e.qb;
    s0[st + S_TIME] = tran ? ctx.time : 0;

    const { nC, nB, nE, nCi, nBi, nEi, nS } = this;
    if (this.hasRc) stampConductance(ctx, nC, nCi, t.gc);
    if (this.hasRe) stampConductance(ctx, nE, nEi, t.ge);
    if (this.hasRb) {
      const gBe = e.gxBe * v.vrb;
      const gBc = e.gxBc * v.vrb;
      stampConductance(ctx, nB, nBi, e.gx);
      stampVccs(ctx, nB, nBi, nBi, nEi, gBe);
      stampVccs(ctx, nB, nBi, nBi, nCi, gBc);
      stampCurrent(ctx, nB, nBi, -type * (gBe * vbe + gBc * vbc));
    }
    // transport current c' -> e'
    stampVccs(ctx, nCi, nEi, nBi, nEi, e.gitBe);
    stampVccs(ctx, nCi, nEi, nBi, nCi, e.gitBc);
    stampCurrent(ctx, nCi, nEi, type * (e.it - e.gitBe * vbe - e.gitBc * vbc));
    // base currents (gmin in parallel with both junctions)
    stampConductance(ctx, nBi, nEi, e.gpi + gmin);
    stampCurrent(ctx, nBi, nEi, type * (e.ibe - e.gpi * vbe));
    stampConductance(ctx, nBi, nCi, e.gmu + gmin);
    stampCurrent(ctx, nBi, nCi, type * (e.ibc - e.gmu * vbc));

    // charges
    s0[st + S_QBE] = e.qbe;
    s0[st + S_QBC] = e.qbc;
    s0[st + S_QBX] = e.qbx;
    s0[st + S_QCS] = e.qcs;
    this.qCur.fill(0);
    if (tran) {
      const be = integrateCharge(ctx, st + S_QBE, e.qbe, e.capbe, e.capbeBc !== 0);
      const gCross = e.capbeBc !== 0 ? e.capbeBc * be.ag0 : 0;
      stampConductance(ctx, nBi, nEi, be.geq);
      stampVccs(ctx, nBi, nEi, nBi, nCi, gCross);
      stampCurrent(ctx, nBi, nEi, type * (be.i - be.geq * vbe - gCross * vbc));
      const bc = integrateCharge(ctx, st + S_QBC, e.qbc, e.capbc);
      stampConductance(ctx, nBi, nCi, bc.geq);
      stampCurrent(ctx, nBi, nCi, type * (bc.i - bc.geq * vbc));
      const bx = integrateCharge(ctx, st + S_QBX, e.qbx, e.capbx);
      stampConductance(ctx, nB, nCi, bx.geq);
      stampCurrent(ctx, nB, nCi, type * (bx.i - bx.geq * vbx));
      const cs = integrateCharge(ctx, st + S_QCS, e.qcs, e.capcs);
      stampConductance(ctx, nS, nCi, cs.geq);
      stampCurrent(ctx, nS, nCi, type * (cs.i - cs.geq * vcs));
      this.qCur[0] = be.i;
      this.qCur[1] = bc.i;
      this.qCur[2] = bx.i;
      this.qCur[3] = cs.i;
    } else {
      s0[st + S_QBE + 1] = 0;
      s0[st + S_QBC + 1] = 0;
      s0[st + S_QBX + 1] = 0;
      s0[st + S_QCS + 1] = 0;
    }

    if (limited) ctx.noncon();
    this.loaded = true;
    this.lastVbe = vbe;
    this.lastVbc = vbc;
    this.lastIc = e.it - e.ibc;
    this.lastIb = e.ibe + e.ibc;
    this.lastGcBe = e.gitBe;
    this.lastGcBc = e.gitBc - e.gmu;
    this.lastGbBe = e.gpi;
    this.lastGbBc = e.gmu;
    this.lastGmin = gmin;
    this.lastArg3 = arg3;
    this.lastHist = hist;
  }

  convTest(ctx: LoadContext): boolean {
    if (!this.loaded) return true;
    const s = this.pol;
    const dvbe = s * (ctx.x(this.nBi) - ctx.x(this.nEi)) - this.lastVbe;
    const dvbc = s * (ctx.x(this.nBi) - ctx.x(this.nCi)) - this.lastVbc;
    const { reltol, abstol } = ctx.options;
    return (
      currentConverged(this.lastIc, this.lastGcBe * dvbe + this.lastGcBc * dvbc, reltol, abstol) &&
      currentConverged(this.lastIb, this.lastGbBe * dvbe + this.lastGbBc * dvbc, reltol, abstol)
    );
  }

  acLoad(ctx: AcContext): void {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = evaluate(v.vbe, v.vbc, v.vbx, v.vcs, t, this.hasRb, 1, 0, this.ev, this.cc);
    const w = ctx.omega;
    const gmin = ctx.options.gmin;
    const { nC, nB, nE, nCi, nBi, nEi, nS } = this;
    if (this.hasRc) stampAcAdmittance(ctx, nC, nCi, t.gc, 0);
    if (this.hasRe) stampAcAdmittance(ctx, nE, nEi, t.ge, 0);
    if (this.hasRb) {
      stampAcAdmittance(ctx, nB, nBi, e.gx, 0);
      stampAcVccs(ctx, nB, nBi, nBi, nEi, e.gxBe * v.vrb, 0);
      stampAcVccs(ctx, nB, nBi, nBi, nCi, e.gxBc * v.vrb, 0);
    }
    let gmRe = e.gitBe;
    let gmIm = 0;
    if (t.td > 0) {
      const ph = w * t.td;
      gmRe = e.gitBe * Math.cos(ph);
      gmIm = -e.gitBe * Math.sin(ph);
    }
    stampAcVccs(ctx, nCi, nEi, nBi, nEi, gmRe, gmIm);
    stampAcVccs(ctx, nCi, nEi, nBi, nCi, e.gitBc, 0);
    stampAcAdmittance(ctx, nBi, nEi, e.gpi + gmin, w * e.capbe);
    stampAcVccs(ctx, nBi, nEi, nBi, nCi, 0, w * e.capbeBc);
    stampAcAdmittance(ctx, nBi, nCi, e.gmu + gmin, w * e.capbc);
    stampAcAdmittance(ctx, nB, nCi, 0, w * e.capbx);
    stampAcAdmittance(ctx, nS, nCi, 0, w * e.capcs);
  }

  truncate(ctx: TruncContext): number {
    const p = this.mp;
    const st = this.st;
    let dt = Infinity;
    if (p.cje > 0 || p.tf > 0) dt = Math.min(dt, ctx.terr(st + S_QBE));
    if ((p.cjc > 0 && p.xcjc > 0) || p.tr > 0) dt = Math.min(dt, ctx.terr(st + S_QBC));
    if (p.cjc > 0 && p.xcjc < 1) dt = Math.min(dt, ctx.terr(st + S_QBX));
    if (p.cjs > 0) dt = Math.min(dt, ctx.terr(st + S_QCS));
    return dt;
  }

  noise(ctx: NoiseContext): NoiseGenerator[] {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = evaluate(v.vbe, v.vbc, v.vbx, v.vcs, t, this.hasRb, 1, 0, emptyEval(), { q: 0, c: 0 });
    const T = t.T;
    const ic = e.it - e.ibc;
    const ib = e.ibe + e.ibc;
    const { kf, af } = this.mp;
    const m = instanceParam(this.inst, ['m']) ?? 1;
    const gens: NoiseGenerator[] = [];
    const dev = this.name;
    if (this.hasRc) gens.push({ name: 'thermal_rc', device: dev, pos: this.nC, neg: this.nCi, density: () => thermalNoise(T, t.gc) });
    if (this.hasRb) {
      const gx = e.gx;
      gens.push({ name: 'thermal_rb', device: dev, pos: this.nB, neg: this.nBi, density: () => thermalNoise(T, gx) });
    }
    if (this.hasRe) gens.push({ name: 'thermal_re', device: dev, pos: this.nE, neg: this.nEi, density: () => thermalNoise(T, t.ge) });
    gens.push({ name: 'shot_ic', device: dev, pos: this.nCi, neg: this.nEi, density: () => shotNoise(ic) });
    gens.push({ name: 'shot_ib', device: dev, pos: this.nBi, neg: this.nEi, density: () => shotNoise(ib) });
    if (kf !== 0) {
      gens.push({ name: 'flicker', device: dev, pos: this.nBi, neg: this.nEi, density: (f) => flickerNoise(kf, af, ib, f, m) });
    }
    return gens;
  }

  /** Terminal currents (actual polarity, into each terminal) at a solution. */
  private terminalCurrents(x: (i: number) => number): { ic: number; ib: number; ie: number; isub: number } {
    const t = this.temps(this.ctxTempK);
    const v = this.voltages(x);
    const e = evaluate(v.vbe, v.vbc, v.vbx, v.vcs, t, this.hasRb, this.lastArg3, this.lastHist, emptyEval(), { q: 0, c: 0 });
    const g = this.lastGmin;
    const [iqbe, iqbc, iqbx, iqcs] = this.qCur;
    const icDev = e.it - e.ibc - g * v.vbc - iqbc - iqbx - iqcs;
    const ibDev = e.ibe + e.ibc + g * (v.vbe + v.vbc) + iqbe + iqbc + iqbx;
    const isDev = iqcs;
    const s = this.pol;
    const ic = s * icDev;
    const ib = s * ibDev;
    const isub = s * isDev;
    return { ic, ib, isub, ie: -(ic + ib + isub) };
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const c = this.terminalCurrents(x);
    const p = x(this.nC) * c.ic + x(this.nB) * c.ib + x(this.nE) * c.ie + x(this.nS) * c.isub;
    const out: Record<string, number> = { Ic: c.ic, Ib: c.ib, Ie: c.ie, P: p };
    if (this.nodeNames.length > 3) out.Isub = c.isub;
    return out;
  }

  setParam(param: string, value: number): void {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      this.inst[k] = value;
      this.tcache = undefined;
      return;
    }
    const c = canonicalParam(BJT_DEFAULTS, BJT_ALIASES, k);
    if (c === undefined) throw runtimeParamError(this.name, param);
    this.modelOverrides[c] = value;
    this.resolve();
  }

  getParam(param: string): number | undefined {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) return this.inst[k] ?? (k === 'area' || k === 'm' ? 1 : undefined);
    const c = canonicalParam(BJT_DEFAULTS, BJT_ALIASES, k);
    return c !== undefined ? this.mp[c] : undefined;
  }

  /** Full evaluation at device-polarity junction voltages (diagnostics / tests). */
  evaluateAt(vbe: number, vbc: number, tempK: number, vbx = vbc, vcs = 0): BjtEval {
    return evaluate(vbe, vbc, vbx, vcs, this.temps(tempK), this.hasRb, 1, 0, emptyEval(), { q: 0, c: 0 });
  }

  /** +1 for NPN, -1 for PNP (after setup). */
  get polarity(): number {
    return this.pol;
  }

  /** Base index of this device's 12 state slots. */
  get stateBase(): number {
    return this.st;
  }
}

export function createBjt(el: ElementIR): Device {
  return new Bjt(el);
}
