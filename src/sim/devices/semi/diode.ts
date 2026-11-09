/**
 * Junction diode — element 'D', model type D.
 *
 * Nodes: [anode, cathode]. Instance params: area (1), m (1, parallel count), off, ic (junction
 * voltage for UIC), temp (°C, overrides circuit temperature), dtemp (°C offset).
 *
 * Model (SPICE3 diode, own implementation) with optional PSpice/ngspice extensions:
 *   IS N RS CJO(CJ0,CJ) VJ(PB) M(MJ) FC TT BV IBV NBV EG XTI KF AF TNOM
 *   IKF(IK)  high-injection knee:   I = Inrm * sqrt(IKF / (IKF + Inrm))
 *   ISR NR   recombination current: Irec = ISR*(exp(V/(NR*vt))-1) * ((1-V/VJ)^2+0.005)^(M/2)
 *   TBV1 TBV2 (BV temperature coefficients), TRS1 TRS2 (RS temperature coefficients)
 *
 * Static current (device-internal junction voltage vd between the internal anode and cathode):
 *   vd >= -3*N*vt: Inrm = IS*(exp(vd/(N*vt)) - 1)
 *   vd <  -3*N*vt: Inrm = -IS*(1 + (3*N*vt/(e*vd))^3)    (smooth SPICE3 reverse region)
 *   breakdown (BV given): -IBV*exp(-(vd+BV)/(NBV*vt)) added to the junction current,
 *   so the reverse current at vd = -BV is IBV.
 *   gmin (LoadContext.gmin) is stamped in parallel with the junction.
 * Charge: q = TT*Idiff + depletion(vd; CJO, VJ, M, FC); Idiff is the diffusion (Inrm with
 * high injection) component, so breakdown does not create diffusion charge.
 * Temperature: IS (EG, XTI, N), ISR (EG, XTI, NR), VJ and CJO (SPICE3 junction formulas),
 * BV (TBV1/2), RS (TRS1/2). TNOM defaults to options.tnom (°C).
 *
 * Series resistance RS > 0 creates the internal node "<name>#a" between the anode and the
 * junction. Area and m multiply IS, ISR, IKF, IBV, CJO and divide RS.
 *
 * State slots (3): [vd, q, dq/dt].
 * Outputs: I and Id (anode -> cathode current through the device, including the charge current
 * in transient), P (power absorbed, incl. RS).
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
  junctionTemperature,
  junctionVcrit,
  pnjlim,
  resolveParams,
  satCurrentFactor,
  shotNoise,
  stampCharge,
  stampConductance,
  stampCurrent,
  stampAcAdmittance,
  thermalNoise,
  warnUnknownParams,
  type ChargeCap,
  type DepletionCoeffs,
} from './common';

export const DIODE_DEFAULTS = {
  is: 1e-14,
  n: 1,
  rs: 0,
  cjo: 0,
  vj: 1,
  m: 0.5,
  fc: 0.5,
  tt: 0,
  bv: 0,
  ibv: 1e-3,
  nbv: 1,
  eg: 1.11,
  xti: 3,
  kf: 0,
  af: 1,
  ikf: 0,
  isr: 0,
  nr: 2,
  tbv1: 0,
  tbv2: 0,
  trs1: 0,
  trs2: 0,
  tnom: Number.NaN,
} as const;

export type DiodeParam = keyof typeof DIODE_DEFAULTS;
export type DiodeModelParams = Record<DiodeParam, number>;

export const DIODE_ALIASES: Readonly<Record<string, DiodeParam>> = {
  cj0: 'cjo',
  cj: 'cjo',
  pb: 'vj',
  mj: 'm',
  ik: 'ikf',
  trs: 'trs1',
  tref: 'tnom',
  t_measured: 'tnom',
};

const DIODE_IGNORED = new Set(['level', 'tcv', 'ibvl', 'nbvl', 'jsw', 'cjsw', 'mjsw', 'vjsw', 'php', 'fcs', 'tikf', 't_abs', 't_rel_global', 't_rel_local']);

/** Temperature- and area-adjusted diode parameters. */
interface DiodeTemp {
  T: number;
  vt: number;
  vte: number;
  vtb: number;
  vtr: number;
  isat: number;
  isr: number;
  ikf: number;
  ibv: number;
  bv: number;
  hasBv: boolean;
  vcrit: number;
  vcritBv: number;
  vj: number;
  m: number;
  tt: number;
  dep: DepletionCoeffs;
  gs: number;
}

/** Static + charge evaluation of the junction. */
export interface DiodeEval {
  /** junction current (excluding gmin), A */
  id: number;
  /** dId/dvd, S */
  gd: number;
  /** charge (diffusion + depletion), C */
  q: number;
  /** dq/dvd, F */
  c: number;
}

function evaluate(vd: number, t: DiodeTemp, out: DiodeEval, cc: ChargeCap): DiodeEval {
  let i: number;
  let g: number;
  const vte = t.vte;
  if (vd >= -3 * vte) {
    const a = vd / vte;
    i = t.isat * (expLin(a) - 1);
    g = (t.isat * expLinDeriv(a)) / vte;
  } else {
    const a = (3 * vte) / (vd * Math.E);
    const a3 = a * a * a;
    i = -t.isat * (1 + a3);
    g = (3 * t.isat * a3) / vd;
  }
  if (t.ikf > 0) {
    const s = t.ikf + i;
    if (s > 0) {
      g = (g * Math.sqrt(t.ikf) * (t.ikf + i / 2)) / (s * Math.sqrt(s));
      i *= Math.sqrt(t.ikf / s);
    }
  }
  const idiff = i;
  const gdiff = g;
  if (t.isr > 0) {
    const a = vd / t.vtr;
    const e = expLin(a);
    const u = 1 - vd / t.vj;
    const base = u * u + 0.005;
    const kgen = Math.pow(base, t.m / 2);
    const dkgen = -(t.m / t.vj) * u * Math.pow(base, t.m / 2 - 1);
    i += t.isr * (e - 1) * kgen;
    g += ((t.isr * expLinDeriv(a)) / t.vtr) * kgen + t.isr * (e - 1) * dkgen;
  }
  if (t.hasBv) {
    const a = -(vd + t.bv) / t.vtb;
    i -= t.ibv * expLin(a);
    g += (t.ibv * expLinDeriv(a)) / t.vtb;
  }
  depletionCharge(vd, t.dep, cc);
  out.id = i;
  out.gd = g;
  out.q = t.tt * idiff + cc.q;
  out.c = t.tt * gdiff + cc.c;
  return out;
}

const INSTANCE_KEYS = new Set(['area', 'm', 'off', 'ic', 'temp', 'dtemp']);

export class Diode implements Device {
  readonly type = 'D' as const;
  readonly name: string;
  readonly nodeNames: string[];

  private readonly modelName: string | undefined;
  private card: ModelCard | undefined;
  private readonly inst: Record<string, number>;
  private readonly modelOverrides: Record<string, number> = {};
  private mp: DiodeModelParams = { ...DIODE_DEFAULTS };
  private bvGiven = false;
  private tnomDefaultC = 27;
  /** circuit temperature (K) of the last load, used by outputs() */
  private ctxTempK = celsiusToKelvin(27);

  private nA = GROUND;
  private nK = GROUND;
  /** internal anode (junction side of RS); equals nA when RS = 0 */
  private nAi = GROUND;
  private hasInternal = false;
  private st = 0;

  private tcache: DiodeTemp | undefined;
  private readonly ev: DiodeEval = { id: 0, gd: 0, q: 0, c: 0 };
  private readonly cc: ChargeCap = { q: 0, c: 0 };

  // last load (for convTest / outputs)
  private lastVd = 0;
  private lastI = 0;
  private lastG = 0;
  private lastGmin = 0;
  private loaded = false;
  private capValid = false;
  private capI = 0;
  private capG = 0;
  private capV = 0;

  constructor(el: ElementIR) {
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
    this.modelName = el.model;
    this.inst = { ...el.params };
  }

  setup(ctx: SetupContext): void {
    if (this.nodeNames.length < 2) throw new Error(`${this.name}: diode needs 2 nodes`);
    const { card } = findModel(ctx, this.name, this.modelName, ['D'], 'D');
    this.card = card;
    this.tnomDefaultC = ctx.options.tnom;
    this.ctxTempK = celsiusToKelvin(ctx.options.temp);
    const r = this.resolve();
    warnUnknownParams(ctx, card, r);
    this.nA = ctx.node(this.nodeNames[0]);
    this.nK = ctx.node(this.nodeNames[1]);
    this.hasInternal = this.mp.rs > 0 && this.nA !== GROUND;
    this.nAi = this.hasInternal ? ctx.node(`${this.name}#a`) : this.nA;
    this.st = ctx.state(3);
  }

  /** Re-resolve model parameters (card + runtime overrides); returns unknown card keys. */
  private resolve(): string[] {
    const r = resolveParams(DIODE_DEFAULTS, DIODE_ALIASES, this.card, this.modelOverrides, DIODE_IGNORED);
    this.mp = r.p;
    this.bvGiven = r.given.has('bv') && r.p.bv > 0;
    this.tcache = undefined;
    return r.unknown;
  }

  private areaFactor(): number {
    const area = instanceParam(this.inst, ['area']) ?? 1;
    const m = instanceParam(this.inst, ['m']) ?? 1;
    return area * m;
  }

  private instanceTemp(ctxTemp: number): number {
    const t = instanceParam(this.inst, ['temp']);
    if (t !== undefined) return celsiusToKelvin(t);
    return ctxTemp + (instanceParam(this.inst, ['dtemp']) ?? 0);
  }

  private temps(ctxTemp: number): DiodeTemp {
    const T = this.instanceTemp(ctxTemp);
    if (this.tcache && this.tcache.T === T) return this.tcache;
    const p = this.mp;
    const tnom = celsiusToKelvin(Number.isFinite(p.tnom) ? p.tnom : this.tnomDefaultC);
    const a = this.areaFactor();
    const vt = K_OVER_Q * T;
    const n = p.n > 0 ? p.n : 1;
    const nr = p.nr > 0 ? p.nr : 2;
    const nbv = p.nbv > 0 ? p.nbv : 1;
    const isat = p.is * satCurrentFactor(T, tnom, p.eg, p.xti, n) * a;
    const isr = p.isr > 0 ? p.isr * satCurrentFactor(T, tnom, p.eg, p.xti, nr) * a : 0;
    const vjInput = p.vj > 0 ? p.vj : 1;
    const jt = junctionTemperature(vjInput, p.m, tnom, T);
    const dT = T - tnom;
    const vte = n * vt;
    const vtb = nbv * vt;
    const ibv = Math.max(p.ibv, 1e-30) * a;
    let rs = p.rs * (1 + p.trs1 * dT + p.trs2 * dT * dT);
    if (this.hasInternal && !(rs > 0)) rs = 1e-3;
    this.tcache = {
      T,
      vt,
      vte,
      vtb,
      vtr: nr * vt,
      isat,
      isr,
      ikf: p.ikf > 0 ? p.ikf * a : 0,
      ibv,
      bv: p.bv * (1 + p.tbv1 * dT + p.tbv2 * dT * dT),
      hasBv: this.bvGiven,
      vcrit: junctionVcrit(vte, isat),
      vcritBv: junctionVcrit(vtb, ibv),
      vj: jt.pot,
      m: p.m,
      tt: p.tt,
      dep: depletionCoeffs(p.cjo * jt.capFactor * a, jt.pot, p.m, p.fc),
      gs: this.hasInternal ? a / rs : 0,
    };
    return this.tcache;
  }

  load(ctx: LoadContext): void {
    this.ctxTempK = ctx.temp;
    const t = this.temps(ctx.temp);
    const s0 = ctx.state0;
    let vd: number;
    let limited = false;
    if (ctx.uic && (ctx.tranOp || ctx.initJunctions)) {
      vd = instanceParam(this.inst, ['ic']) ?? ctx.x(this.nAi) - ctx.x(this.nK);
    } else if (ctx.initJunctions) {
      vd = (instanceParam(this.inst, ['off']) ?? 0) !== 0 ? 0 : t.vcrit;
    } else {
      const vnew = ctx.x(this.nAi) - ctx.x(this.nK);
      const vold = ctx.initTimepoint ? ctx.state1[this.st] : s0[this.st];
      if (t.hasBv && vnew < Math.min(0, -t.bv + 10 * t.vtb)) {
        const u = pnjlim(-(vnew + t.bv), -(vold + t.bv), t.vtb, t.vcritBv);
        vd = -(u + t.bv);
      } else {
        vd = pnjlim(vnew, vold, t.vte, t.vcrit);
      }
      limited = vd !== vnew;
    }
    s0[this.st] = vd;

    const e = evaluate(vd, t, this.ev, this.cc);
    const gmin = ctx.gmin;
    const id = e.id + gmin * vd;
    const gd = e.gd + gmin;

    if (this.hasInternal) stampConductance(ctx, this.nA, this.nAi, t.gs);
    stampConductance(ctx, this.nAi, this.nK, gd);
    stampCurrent(ctx, this.nAi, this.nK, id - gd * vd);

    this.capValid = false;
    if (ctx.tranOp || ctx.mode === 'tran') {
      s0[this.st + 1] = e.q;
      if (ctx.mode === 'tran' && !ctx.tranOp) {
        const r = stampCharge(ctx, 1, this.st + 1, this.nAi, this.nK, vd, e);
        this.capValid = true;
        this.capI = r.i;
        this.capG = r.geq;
        this.capV = vd;
      } else {
        s0[this.st + 2] = 0;
      }
    }

    if (limited) ctx.noncon();
    this.lastVd = vd;
    this.lastI = id;
    this.lastG = gd;
    this.lastGmin = gmin;
    this.loaded = true;
  }

  convTest(ctx: LoadContext): boolean {
    if (!this.loaded) return true;
    const vd = ctx.x(this.nAi) - ctx.x(this.nK);
    return currentConverged(this.lastI, this.lastG * (vd - this.lastVd), ctx.options.reltol, ctx.options.abstol);
  }

  acLoad(ctx: AcContext): void {
    const t = this.temps(ctx.temp);
    const vd = ctx.op(this.nAi) - ctx.op(this.nK);
    const e = evaluate(vd, t, this.ev, this.cc);
    if (this.hasInternal) stampAcAdmittance(ctx, this.nA, this.nAi, t.gs, 0);
    stampAcAdmittance(ctx, this.nAi, this.nK, e.gd + ctx.options.gmin, ctx.omega * e.c);
  }

  truncate(ctx: TruncContext): number {
    if (this.mp.cjo === 0 && this.mp.tt === 0) return Infinity;
    return ctx.terr(this.st + 1);
  }

  noise(ctx: NoiseContext): NoiseGenerator[] {
    const t = this.temps(ctx.temp);
    const vd = ctx.op(this.nAi) - ctx.op(this.nK);
    const id = evaluate(vd, t, { id: 0, gd: 0, q: 0, c: 0 }, { q: 0, c: 0 }).id;
    const m = instanceParam(this.inst, ['m']) ?? 1;
    const T = t.T;
    const gens: NoiseGenerator[] = [];
    if (this.hasInternal) {
      const gs = t.gs;
      gens.push({ name: 'thermal_rs', device: this.name, pos: this.nA, neg: this.nAi, density: () => thermalNoise(T, gs) });
    }
    const { kf, af } = this.mp;
    gens.push({ name: 'shot', device: this.name, pos: this.nAi, neg: this.nK, density: () => shotNoise(id) });
    if (kf !== 0) {
      gens.push({ name: 'flicker', device: this.name, pos: this.nAi, neg: this.nK, density: (f) => flickerNoise(kf, af, id, f, m) });
    }
    return gens;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const t = this.temps(this.ctxTempK);
    const vd = x(this.nAi) - x(this.nK);
    const e = evaluate(vd, t, { id: 0, gd: 0, q: 0, c: 0 }, { q: 0, c: 0 });
    let i = e.id + this.lastGmin * vd;
    if (this.capValid) i += this.capI + this.capG * (vd - this.capV);
    const v = x(this.nA) - x(this.nK);
    return { I: i, Id: i, P: i * v };
  }

  setParam(param: string, value: number): void {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      this.inst[k] = value;
      this.tcache = undefined;
      return;
    }
    const c = canonicalParam(DIODE_DEFAULTS, DIODE_ALIASES, k);
    if (c === undefined) throw runtimeParamError(this.name, param);
    this.modelOverrides[c] = value;
    this.resolve();
  }

  getParam(param: string): number | undefined {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) return this.inst[k] ?? (k === 'area' || k === 'm' ? 1 : undefined);
    const c = canonicalParam(DIODE_DEFAULTS, DIODE_ALIASES, k);
    return c !== undefined ? this.mp[c] : undefined;
  }

  /** Junction charge/capacitance and static current at junction voltage vd (for diagnostics/tests). */
  evaluateAt(vd: number, tempK: number): DiodeEval {
    return evaluate(vd, this.temps(tempK), { id: 0, gd: 0, q: 0, c: 0 }, { q: 0, c: 0 });
  }

  /** Charge state slot base (slot+1 = charge, slot+2 = its current). */
  get stateBase(): number {
    return this.st;
  }
}

export function createDiode(el: ElementIR): Device {
  return new Diode(el);
}
