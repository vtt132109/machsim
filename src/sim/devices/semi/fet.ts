/**
 * Shared implementation of the gate-junction FETs: JFET ('J', jfet.ts) and MESFET ('Z',
 * mesfet.ts). Both consist of
 *   - optional series resistances RD / RS with internal nodes "<name>#d" / "<name>#s",
 *   - two gate junctions g-s' and g-d' (IS*(exp(v/(N vt)) - 1) with gmin in parallel) carrying
 *     depletion charges with CGS / CGD,
 *   - a channel current d' -> s' given by a flavor-specific function of (vgs - VTO, vds) in
 *     normal mode (vds >= 0); for vds < 0 drain and source are exchanged:
 *     Id(vgs, vds) = -F(vgd - VTO, -vds).
 * Newton limiting: pnjlim and fetlim on vgs and vgd. Initial junction guess vgs = vgd = -1.
 * Device polarity: voltages and currents are multiplied by type (+1 n-channel, -1 p-channel).
 *
 * State slots (6): vgs vgd | qgs iqgs | qgd iqgd.
 * Outputs: Id, Ig, Is (currents INTO the drain / gate / source terminals), P (power absorbed).
 */

import type { AcContext, Device, LoadContext, NoiseContext, NoiseGenerator, SetupContext, TruncContext } from '../../device';
import { GROUND } from '../../device';
import type { ElementIR, ModelCard } from '../../netlist';
import { runtimeParamError } from '../linear/common';
import {
  canonicalParam,
  celsiusToKelvin,
  currentConverged,
  depletionCharge,
  expLin,
  expLinDeriv,
  fetlim,
  findModel,
  flickerNoise,
  instanceParam,
  integrateCharge,
  pnjlim,
  resolveParams,
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

/** Model parameters every gate-junction FET flavor must define. */
export type FetCommonParam = 'rd' | 'rs' | 'cgs' | 'cgd' | 'kf' | 'af' | 'tnom';

/** Temperature-, area- and multiplicity-adjusted parameters. */
export interface FetTemp {
  T: number;
  vt: number;
  /** N*vt of the gate junctions */
  nvt: number;
  isat: number;
  /** device-polarity threshold */
  vto: number;
  /** series conductances (0 when absent) */
  gd: number;
  gs: number;
  depGs: DepletionCoeffs;
  depGd: DepletionCoeffs;
  vcrit: number;
  /** channel parameters; their meaning is defined by the flavor */
  beta: number;
  lambda: number;
  b: number;
  bfac: number;
  alpha: number;
}

/** Normal-mode channel current and its partial derivatives w.r.t. vgst and vds. */
export interface ChannelOut {
  i: number;
  dg: number;
  dd: number;
}

export interface FetFlavor<P extends string> {
  readonly elementType: 'J' | 'Z';
  /** "JFET" / "MESFET" for messages */
  readonly label: string;
  /** accepted model type keywords [n-channel, p-channel] */
  readonly modelTypes: readonly [string, string];
  readonly defaults: Readonly<Record<P | FetCommonParam, number>>;
  readonly aliases: Readonly<Record<string, P | FetCommonParam>>;
  readonly ignored: ReadonlySet<string>;
  /**
   * Build the adjusted parameters at temperature T (kelvin). `area` already includes the
   * multiplier m; gd/gs must be area/R or 0.
   */
  temps(p: Readonly<Record<P | FetCommonParam, number>>, T: number, tnomK: number, area: number): FetTemp;
  /** Normal-mode channel current F(vgst, vds) for vds >= 0. */
  channel(vgst: number, vds: number, t: FetTemp, out: ChannelOut): void;
}

/** Static + charge evaluation (device polarity). */
export interface FetEval {
  /** gate-source / gate-drain junction currents (excluding gmin) and conductances */
  igs: number;
  ggs: number;
  igd: number;
  ggd: number;
  /** channel current d' -> s' and its derivatives w.r.t. vgs and vds */
  id: number;
  gm: number;
  gds: number;
  qgs: number;
  capgs: number;
  qgd: number;
  capgd: number;
}

function emptyEval(): FetEval {
  return { igs: 0, ggs: 0, igd: 0, ggd: 0, id: 0, gm: 0, gds: 0, qgs: 0, capgs: 0, qgd: 0, capgd: 0 };
}

const INSTANCE_KEYS = new Set(['area', 'm', 'off', 'ic_vds', 'ic_vgs', 'icvds', 'icvgs', 'temp', 'dtemp']);

const S_VGS = 0;
const S_VGD = 1;
const S_QGS = 2;
const S_QGD = 4;
const N_STATES = 6;

export class GateJunctionFet<P extends string> implements Device {
  readonly type: 'J' | 'Z';
  readonly name: string;
  readonly nodeNames: string[];

  private readonly flavor: FetFlavor<P>;
  private readonly modelName: string | undefined;
  private card: ModelCard | undefined;
  private readonly inst: Record<string, number>;
  private readonly modelOverrides: Record<string, number> = {};
  private mp: Record<P | FetCommonParam, number>;
  private pol = 1;
  private tnomDefaultC = 27;
  private ctxTempK = celsiusToKelvin(27);

  private nD = GROUND;
  private nG = GROUND;
  private nS = GROUND;
  private nDi = GROUND;
  private nSi = GROUND;
  private hasRd = false;
  private hasRs = false;
  private st = 0;

  private tcache: FetTemp | undefined;
  private readonly ev: FetEval = emptyEval();
  private readonly ch: ChannelOut = { i: 0, dg: 0, dd: 0 };
  private readonly cc: ChargeCap = { q: 0, c: 0 };

  private loaded = false;
  private lastVgs = 0;
  private lastVgd = 0;
  private lastId = 0;
  private lastIg = 0;
  private lastGdGs = 0;
  private lastGdGd = 0;
  private lastGgGs = 0;
  private lastGgGd = 0;
  private lastGmin = 0;
  private readonly qCur = new Float64Array(2);

  constructor(el: ElementIR, flavor: FetFlavor<P>) {
    this.flavor = flavor;
    this.type = flavor.elementType;
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 3);
    this.modelName = el.model;
    this.inst = { ...el.params };
    this.mp = { ...flavor.defaults };
  }

  setup(ctx: SetupContext): void {
    const f = this.flavor;
    if (this.nodeNames.length < 3) throw new Error(`${this.name}: ${f.label} needs 3 nodes`);
    const { card, type } = findModel(ctx, this.name, this.modelName, f.modelTypes, f.modelTypes[0]);
    this.card = card;
    this.pol = type === f.modelTypes[1] ? -1 : 1;
    this.tnomDefaultC = ctx.options.tnom;
    this.ctxTempK = celsiusToKelvin(ctx.options.temp);
    warnUnknownParams(ctx, card, this.resolve());
    const level = card?.params.level;
    if (level !== undefined && level !== 1) {
      ctx.warn(`${this.name}: ${f.label} model level ${level} is not supported, using level 1`);
    }
    this.nD = ctx.node(this.nodeNames[0]);
    this.nG = ctx.node(this.nodeNames[1]);
    this.nS = ctx.node(this.nodeNames[2]);
    this.hasRd = this.mp.rd > 0;
    this.hasRs = this.mp.rs > 0;
    this.nDi = this.hasRd ? ctx.node(`${this.name}#d`) : this.nD;
    this.nSi = this.hasRs ? ctx.node(`${this.name}#s`) : this.nS;
    this.st = ctx.state(N_STATES);
  }

  private resolve(): string[] {
    const f = this.flavor;
    const r = resolveParams(f.defaults, f.aliases, this.card, this.modelOverrides, f.ignored);
    this.mp = r.p;
    this.tcache = undefined;
    return r.unknown;
  }

  private temps(ctxTemp: number): FetTemp {
    const tInst = instanceParam(this.inst, ['temp']);
    const T = tInst !== undefined ? celsiusToKelvin(tInst) : ctxTemp + (instanceParam(this.inst, ['dtemp']) ?? 0);
    if (this.tcache && this.tcache.T === T) return this.tcache;
    const p = this.mp;
    const tnom = celsiusToKelvin(Number.isFinite(p.tnom) ? p.tnom : this.tnomDefaultC);
    const area = (instanceParam(this.inst, ['area']) ?? 1) * (instanceParam(this.inst, ['m']) ?? 1);
    const t = this.flavor.temps(p, T, tnom, area);
    if (!this.hasRd) t.gd = 0;
    if (!this.hasRs) t.gs = 0;
    this.tcache = t;
    return t;
  }

  private evaluate(vgs: number, vgd: number, t: FetTemp, out: FetEval, cc: ChargeCap): FetEval {
    let a = vgs / t.nvt;
    out.igs = t.isat * (expLin(a) - 1);
    out.ggs = (t.isat * expLinDeriv(a)) / t.nvt;
    a = vgd / t.nvt;
    out.igd = t.isat * (expLin(a) - 1);
    out.ggd = (t.isat * expLinDeriv(a)) / t.nvt;
    const vds = vgs - vgd;
    const ch = this.ch;
    if (vds >= 0) {
      this.flavor.channel(vgs - t.vto, vds, t, ch);
      out.id = ch.i;
      out.gm = ch.dg;
      out.gds = ch.dd;
    } else {
      // inverse mode: Id(vgs, vds) = -F(vgd - VTO, -vds) with vgd = vgs - vds
      this.flavor.channel(vgd - t.vto, -vds, t, ch);
      out.id = -ch.i;
      out.gm = -ch.dg;
      out.gds = ch.dg + ch.dd;
    }
    depletionCharge(vgs, t.depGs, cc);
    out.qgs = cc.q;
    out.capgs = cc.c;
    depletionCharge(vgd, t.depGd, cc);
    out.qgd = cc.q;
    out.capgd = cc.c;
    return out;
  }

  private voltages(x: (i: number) => number): { vgs: number; vgd: number } {
    const s = this.pol;
    return { vgs: s * (x(this.nG) - x(this.nSi)), vgd: s * (x(this.nG) - x(this.nDi)) };
  }

  load(ctx: LoadContext): void {
    this.ctxTempK = ctx.temp;
    const t = this.temps(ctx.temp);
    const type = this.pol;
    const s0 = ctx.state0;
    const st = this.st;
    const v = this.voltages(ctx.x);
    let vgs: number;
    let vgd: number;
    let limited = false;
    if (ctx.uic && ctx.tranOp) {
      const icVgs = instanceParam(this.inst, ['ic_vgs', 'icvgs']);
      const icVds = instanceParam(this.inst, ['ic_vds', 'icvds']);
      vgs = icVgs !== undefined ? type * icVgs : v.vgs;
      vgd = icVds !== undefined ? vgs - type * icVds : v.vgd;
    } else if (ctx.initJunctions) {
      const off = (instanceParam(this.inst, ['off']) ?? 0) !== 0;
      vgs = off ? 0 : -1;
      vgd = off ? 0 : -1;
    } else {
      const old = ctx.initTimepoint ? ctx.state1 : s0;
      const vgsOld = old[st + S_VGS];
      const vgdOld = old[st + S_VGD];
      vgs = pnjlim(v.vgs, vgsOld, t.nvt, t.vcrit);
      vgd = pnjlim(v.vgd, vgdOld, t.nvt, t.vcrit);
      vgs = fetlim(vgs, vgsOld, t.vto);
      vgd = fetlim(vgd, vgdOld, t.vto);
      limited = vgs !== v.vgs || vgd !== v.vgd;
    }
    const vds = vgs - vgd;
    const e = this.evaluate(vgs, vgd, t, this.ev, this.cc);
    const gmin = ctx.gmin;
    s0[st + S_VGS] = vgs;
    s0[st + S_VGD] = vgd;

    const { nD, nG, nS, nDi, nSi } = this;
    if (this.hasRd) stampConductance(ctx, nD, nDi, t.gd);
    if (this.hasRs) stampConductance(ctx, nS, nSi, t.gs);
    stampConductance(ctx, nG, nSi, e.ggs + gmin);
    stampCurrent(ctx, nG, nSi, type * (e.igs - e.ggs * vgs));
    stampConductance(ctx, nG, nDi, e.ggd + gmin);
    stampCurrent(ctx, nG, nDi, type * (e.igd - e.ggd * vgd));
    stampVccs(ctx, nDi, nSi, nG, nSi, e.gm);
    stampVccs(ctx, nDi, nSi, nDi, nSi, e.gds);
    stampCurrent(ctx, nDi, nSi, type * (e.id - e.gm * vgs - e.gds * vds));

    s0[st + S_QGS] = e.qgs;
    s0[st + S_QGD] = e.qgd;
    this.qCur.fill(0);
    if (ctx.mode === 'tran' && !ctx.tranOp && ctx.dt > 0) {
      const gs = integrateCharge(ctx, st + S_QGS, e.qgs, e.capgs);
      stampConductance(ctx, nG, nSi, gs.geq);
      stampCurrent(ctx, nG, nSi, type * (gs.i - gs.geq * vgs));
      const gd = integrateCharge(ctx, st + S_QGD, e.qgd, e.capgd);
      stampConductance(ctx, nG, nDi, gd.geq);
      stampCurrent(ctx, nG, nDi, type * (gd.i - gd.geq * vgd));
      this.qCur[0] = gs.i;
      this.qCur[1] = gd.i;
    } else {
      s0[st + S_QGS + 1] = 0;
      s0[st + S_QGD + 1] = 0;
    }

    if (limited) ctx.noncon();
    this.loaded = true;
    this.lastVgs = vgs;
    this.lastVgd = vgd;
    this.lastId = e.id - e.igd;
    this.lastIg = e.igs + e.igd;
    // d(id - igd)/dvgs and /dvgd with vds = vgs - vgd
    this.lastGdGs = e.gm + e.gds;
    this.lastGdGd = -e.gds - e.ggd;
    this.lastGgGs = e.ggs;
    this.lastGgGd = e.ggd;
    this.lastGmin = gmin;
  }

  convTest(ctx: LoadContext): boolean {
    if (!this.loaded) return true;
    const v = this.voltages(ctx.x);
    const dvgs = v.vgs - this.lastVgs;
    const dvgd = v.vgd - this.lastVgd;
    const { reltol, abstol } = ctx.options;
    return (
      currentConverged(this.lastId, this.lastGdGs * dvgs + this.lastGdGd * dvgd, reltol, abstol) &&
      currentConverged(this.lastIg, this.lastGgGs * dvgs + this.lastGgGd * dvgd, reltol, abstol)
    );
  }

  acLoad(ctx: AcContext): void {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = this.evaluate(v.vgs, v.vgd, t, this.ev, this.cc);
    const w = ctx.omega;
    const gmin = ctx.options.gmin;
    const { nD, nG, nS, nDi, nSi } = this;
    if (this.hasRd) stampAcAdmittance(ctx, nD, nDi, t.gd, 0);
    if (this.hasRs) stampAcAdmittance(ctx, nS, nSi, t.gs, 0);
    stampAcAdmittance(ctx, nG, nSi, e.ggs + gmin, w * e.capgs);
    stampAcAdmittance(ctx, nG, nDi, e.ggd + gmin, w * e.capgd);
    stampAcVccs(ctx, nDi, nSi, nG, nSi, e.gm, 0);
    stampAcVccs(ctx, nDi, nSi, nDi, nSi, e.gds, 0);
  }

  truncate(ctx: TruncContext): number {
    let dt = Infinity;
    if (this.mp.cgs > 0) dt = Math.min(dt, ctx.terr(this.st + S_QGS));
    if (this.mp.cgd > 0) dt = Math.min(dt, ctx.terr(this.st + S_QGD));
    return dt;
  }

  noise(ctx: NoiseContext): NoiseGenerator[] {
    const t = this.temps(ctx.temp);
    const v = this.voltages(ctx.op);
    const e = this.evaluate(v.vgs, v.vgd, t, emptyEval(), { q: 0, c: 0 });
    const T = t.T;
    const dev = this.name;
    const kf = this.mp.kf;
    const af = this.mp.af;
    const m = instanceParam(this.inst, ['m']) ?? 1;
    const gm = Math.abs(e.gm);
    const id = e.id;
    const gens: NoiseGenerator[] = [];
    if (this.hasRd) gens.push({ name: 'thermal_rd', device: dev, pos: this.nD, neg: this.nDi, density: () => thermalNoise(T, t.gd) });
    if (this.hasRs) gens.push({ name: 'thermal_rs', device: dev, pos: this.nS, neg: this.nSi, density: () => thermalNoise(T, t.gs) });
    gens.push({ name: 'thermal_channel', device: dev, pos: this.nDi, neg: this.nSi, density: () => thermalNoise(T, (2 / 3) * gm) });
    if (kf !== 0) {
      gens.push({ name: 'flicker', device: dev, pos: this.nDi, neg: this.nSi, density: (f) => flickerNoise(kf, af, id, f, m) });
    }
    return gens;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const t = this.temps(this.ctxTempK);
    const v = this.voltages(x);
    const e = this.evaluate(v.vgs, v.vgd, t, emptyEval(), { q: 0, c: 0 });
    const g = this.lastGmin;
    const [iqgs, iqgd] = this.qCur;
    const igs = e.igs + g * v.vgs + iqgs;
    const igd = e.igd + g * v.vgd + iqgd;
    const s = this.pol;
    const id = s * (e.id - igd);
    const ig = s * (igs + igd);
    const is = -(id + ig);
    return { Id: id, Ig: ig, Is: is, P: x(this.nD) * id + x(this.nG) * ig + x(this.nS) * is };
  }

  setParam(param: string, value: number): void {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) {
      this.inst[k] = value;
      this.tcache = undefined;
      return;
    }
    const c = canonicalParam(this.flavor.defaults, this.flavor.aliases, k);
    if (c === undefined) throw runtimeParamError(this.name, param);
    this.modelOverrides[c] = value;
    this.resolve();
  }

  getParam(param: string): number | undefined {
    const k = param.toLowerCase();
    if (INSTANCE_KEYS.has(k)) return this.inst[k] ?? (k === 'area' || k === 'm' ? 1 : undefined);
    const c = canonicalParam(this.flavor.defaults, this.flavor.aliases, k);
    return c !== undefined ? this.mp[c] : undefined;
  }

  /** Evaluation at device-polarity gate voltages (diagnostics / tests). */
  evaluateAt(vgs: number, vgd: number, tempK: number): FetEval {
    return this.evaluate(vgs, vgd, this.temps(tempK), emptyEval(), { q: 0, c: 0 });
  }

  /** +1 n-channel, -1 p-channel (after setup). */
  get polarity(): number {
    return this.pol;
  }

  get stateBase(): number {
    return this.st;
  }
}
