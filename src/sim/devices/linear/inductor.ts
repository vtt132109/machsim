/**
 * Inductor (L) and mutual inductance (K).
 *
 * Inductor: nodes [n+, n-], value = henries; instance parameters ic (initial current, UIC),
 * m (parallel copies: L/m). The inductor owns a branch unknown i (current n+ -> n- through the
 * inductor, vector "I(L1)"), with the branch equation
 *     v(n+) - v(n-) - dΦ/dt = 0,   Φ = L*i + Σ_k M_k*i_k
 * In OP/DC it is a short circuit (v(n+) - v(n-) = 0). The flux is stored in state slot `st`
 * and integrated with LoadContext.integrate (its derivative, the inductor voltage, in `st+1`).
 *
 * Mutual inductance K (no nodes; `inductors` = [L1, L2, ...], value = coupling k): bind()
 * finds the inductors and registers a coupling on each pair. The coupling is stamped by the
 * inductors themselves (they include M*i_other in their flux and -ag0*M in the branch rows), so
 * the flux is complete before it is integrated. M = k*sqrt(L1*L2) is recomputed on every load,
 * so value changes of either inductor or of k take effect immediately.
 *
 * setParam/getParam: inductor value | l | inductance, ic, m; K value | k.
 */
import type { AcContext, BindContext, Device, LoadContext, SetupContext, TruncContext } from '../../device';
import type { ElementIR, ElementType } from '../../netlist';
import { SimulationError } from '../../results';
import type { EngineDeviceExtensions } from '../../engine/hooks';
import { multiplicity, param, requireNodes, requireValue, runtimeParamError, stampBranchIncidence, stampBranchIncidenceAc } from './common';

interface Coupling {
  other: Inductor;
  /** Current mutual inductance M with `other` (henries). */
  mutual: () => number;
}

export class Inductor implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'L';
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;

  private inductance: number;
  private ic: number | undefined;
  private m: number;
  private a = -1;
  private b = -1;
  private br = -1;
  private st = -1;
  private readonly couplings: Coupling[] = [];

  constructor(el: ElementIR) {
    requireNodes(el, 2);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
    this.inductance = requireValue(el, 'inductance');
    this.ic = param(el, 'ic');
    this.m = multiplicity(el);
  }

  setup(ctx: SetupContext): void {
    this.a = ctx.node(this.nodeNames[0]);
    this.b = ctx.node(this.nodeNames[1]);
    this.br = ctx.branch(this.name);
    this.st = ctx.state(2);
  }

  /** Effective inductance (parallel copies included). */
  get henries(): number {
    return this.inductance / this.m;
  }

  /** Branch-current unknown. */
  get branch(): number {
    return this.br;
  }

  /** Initial current used with UIC (undefined when not given). */
  get initialCurrent(): number | undefined {
    return this.ic;
  }

  branchIndex(): number {
    return this.br;
  }

  /** Register a mutual coupling with another inductor (called by K.bind). */
  addCoupling(other: Inductor, mutual: () => number): void {
    if (other === this) return;
    this.couplings.push({ other, mutual });
  }

  private currentAt(ctx: LoadContext, ind: Inductor): number {
    return ctx.uic && ind.ic !== undefined ? ind.ic : ctx.x(ind.br);
  }

  load(ctx: LoadContext): void {
    stampBranchIncidence(ctx, this.a, this.b, this.br);
    const l = this.henries;
    if (ctx.mode === 'tran' && !ctx.tranOp) {
      let flux = l * ctx.x(this.br);
      for (const c of this.couplings) flux += c.mutual() * ctx.x(c.other.br);
      ctx.state0[this.st] = flux;
      const r = ctx.integrate(this.st, 1);
      const ag0 = r.geq;
      ctx.addMatrix(this.br, this.br, -l * ag0);
      for (const c of this.couplings) ctx.addMatrix(this.br, c.other.br, -c.mutual() * ag0);
      ctx.addRhs(this.br, r.i - ag0 * flux);
      return;
    }
    if (ctx.tranOp) {
      let flux = l * this.currentAt(ctx, this);
      for (const c of this.couplings) flux += c.mutual() * this.currentAt(ctx, c.other);
      ctx.state0[this.st] = flux;
      ctx.state0[this.st + 1] = 0;
    }
  }

  truncate(ctx: TruncContext): number {
    return ctx.terr(this.st);
  }

  acLoad(ctx: AcContext): void {
    stampBranchIncidenceAc(ctx, this.a, this.b, this.br);
    ctx.addMatrix(this.br, this.br, 0, -ctx.omega * this.henries);
    for (const c of this.couplings) ctx.addMatrix(this.br, c.other.br, 0, -ctx.omega * c.mutual());
  }

  initialConditions(set: (index: number, value: number) => void): void {
    if (this.ic !== undefined) set(this.br, this.ic);
  }

  setParam(p: string, value: number): void {
    switch (p.toLowerCase()) {
      case 'value':
      case 'l':
      case 'inductance':
        if (Number.isFinite(value)) this.inductance = value;
        break;
      case 'ic':
        this.ic = Number.isFinite(value) ? value : undefined;
        break;
      case 'm':
        if (value > 0) this.m = value;
        break;
      default:
        throw runtimeParamError(this.name, p);
    }
  }

  getParam(p: string): number | undefined {
    switch (p.toLowerCase()) {
      case 'value':
      case 'l':
      case 'inductance':
        return this.inductance;
      case 'ic':
        return this.ic;
      case 'm':
        return this.m;
      default:
        return undefined;
    }
  }
}

export class MutualInductance implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'K';
  readonly name: string;
  readonly nodeNames: string[] = [];
  readonly linear = true;

  private k: number;
  private readonly inductorNames: string[];
  private inductors: Inductor[] = [];

  constructor(el: ElementIR) {
    this.name = el.name;
    this.k = requireValue(el, 'coupling coefficient');
    this.inductorNames = (el.inductors ?? []).slice();
    if (this.inductorNames.length < 2) {
      throw new SimulationError(`${el.name}: mutual inductance needs at least two inductors`, 'netlist');
    }
    if (!(Math.abs(this.k) <= 1)) throw new SimulationError(`${el.name}: coupling coefficient must be within [-1, 1]`, 'netlist');
  }

  setup(_ctx: SetupContext): void {
    // no nodes, no unknowns: the coupled inductors stamp the coupling terms
  }

  bind(ctx: BindContext): void {
    this.inductors = this.inductorNames.map((n) => {
      const d = ctx.findDevice(n);
      if (!(d instanceof Inductor)) {
        throw new SimulationError(`${this.name}: '${n}' is not an inductor in this circuit`, 'netlist');
      }
      return d;
    });
    // every ordered pair shares this element's k: M_ij = k*sqrt(L_i*L_j)
    for (const li of this.inductors) {
      for (const lj of this.inductors) {
        if (li !== lj) li.addCoupling(lj, () => this.k * Math.sqrt(Math.abs(li.henries * lj.henries)));
      }
    }
  }

  /** Mutual inductance M = k*sqrt(L1*L2) between the first two coupled inductors. */
  mutual(): number {
    const [l1, l2] = this.inductors;
    if (!l1 || !l2) return 0;
    return this.k * Math.sqrt(Math.abs(l1.henries * l2.henries));
  }

  load(_ctx: LoadContext): void {
    // stamped by the inductors
  }

  acLoad(_ctx: AcContext): void {
    // stamped by the inductors
  }

  setParam(p: string, value: number): void {
    const key = p.toLowerCase();
    if (key !== 'value' && key !== 'k') throw runtimeParamError(this.name, p);
    if (Number.isFinite(value) && Math.abs(value) <= 1) this.k = value;
  }

  getParam(p: string): number | undefined {
    const key = p.toLowerCase();
    return key === 'value' || key === 'k' ? this.k : undefined;
  }
}

export function createInductor(el: ElementIR): Device {
  return new Inductor(el);
}

export function createMutualInductance(el: ElementIR): Device {
  return new MutualInductance(el);
}
