/**
 * Ideal switches with hysteresis (SPICE3 SW / CSW models).
 *
 *   S  voltage-controlled  [n+, n-, nc+, nc-], model type SW:  vt (0), vh (0), ron (1), roff (1/gmin)
 *   W  current-controlled  [n+, n-], control = V name, model CSW: it (0), ih (0), ron (1), roff (1/gmin)
 *
 * The switch is a resistor ron (on) or roff (off). It turns on when the control exceeds
 * threshold + hysteresis, off when it falls below threshold - hysteresis, and keeps its previous
 * state in between. PSpice-style models with von/voff (ion/ioff) are accepted: threshold at the
 * midpoint, no hysteresis. Instance parameters with the same names override the model.
 *
 * State (two slots): [st] = switch state (1 on / 0 off), [st+1] = control value. In transient
 * the previous state is the one of the last accepted timepoint (state1), so the hysteresis memory
 * advances only on accepted timepoints; within a Newton solve a state change reports noncon()
 * so the iteration continues with the new resistance. In OP/DC the previous state is the one of
 * the previous iteration / sweep point; the initial state is "off" unless the instance has
 * on=1 (or off=0).
 *
 * Interactive control: setParam('value' | 'state', 1 | 0) forces the switch on / off regardless of
 * the control (keys, relays driven by the UI); NaN or a negative value releases it.
 *
 * Outputs: I (current n+ -> n-). getParam('value') returns the present state.
 */
import type { AcContext, BindContext, Device, LoadContext, SetupContext } from '../../device';
import type { ElementIR, ElementType, ModelCard } from '../../netlist';
import { SimulationError } from '../../results';
import type { ComplexReader, EngineDeviceExtensions } from '../../engine/hooks';
import { resolveControlBranch } from './controlled';
import { param, requireNodes, runtimeParamError, stampAdmittance, stampConductance } from './common';

interface SwitchParams {
  /** threshold (V or A) */
  thr: number;
  /** hysteresis half-width (V or A) */
  hys: number;
  ron: number;
  roff: number;
}

abstract class SwitchBase implements Device, EngineDeviceExtensions {
  abstract readonly type: ElementType;
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = false;

  protected a = -1;
  protected b = -1;
  protected st = -1;
  protected sp: SwitchParams = { thr: 0, hys: 0, ron: 1, roff: 1e12 };
  private readonly el: ElementIR;
  private initialOn: boolean;
  private forced: number | undefined;
  private g = 0;
  private lastState = 0;

  constructor(el: ElementIR, nodeCount: number) {
    requireNodes(el, nodeCount);
    this.el = el;
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, nodeCount);
    const on = param(el, 'on', 'state');
    const off = param(el, 'off');
    this.initialOn = on !== undefined ? on !== 0 : off !== undefined ? off === 0 : false;
  }

  /** Model type expected for this switch ('SW' or 'CSW'). */
  protected abstract readonly modelType: string;
  /** [threshold, hysteresis, on-level, off-level] parameter names. */
  protected abstract readonly paramNames: [string, string, string, string];
  /** Present value of the control quantity. */
  protected abstract control(read: (i: number) => number): number;

  setup(ctx: SetupContext): void {
    this.a = ctx.node(this.nodeNames[0]);
    this.b = ctx.node(this.nodeNames[1]);
    this.st = ctx.state(2);
    const [kThr, kHys, kOn, kOff] = this.paramNames;
    let model: ModelCard | undefined;
    if (this.el.model) {
      model = ctx.model(this.el.model);
      if (!model) throw new SimulationError(`${this.name}: model '${this.el.model}' not found`, 'netlist');
      const t = model.type.toUpperCase();
      if (t !== this.modelType && t !== (this.modelType === 'SW' ? 'VSWITCH' : 'ISWITCH')) {
        ctx.warn(`${this.name}: model '${model.name}' has type ${model.type}, expected ${this.modelType}`);
      }
    }
    const mp = model?.params ?? {};
    const pick = (k: string): number | undefined => {
      const v = this.el.params[k] ?? mp[k];
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    };
    let thr = pick(kThr) ?? 0;
    let hys = Math.abs(pick(kHys) ?? 0);
    const lvOn = pick(kOn);
    const lvOff = pick(kOff);
    if (pick(kThr) === undefined && lvOn !== undefined && lvOff !== undefined) {
      thr = (lvOn + lvOff) / 2;
      hys = 0;
    }
    const gmin = ctx.options.gmin > 0 ? ctx.options.gmin : 1e-12;
    const ron = pick('ron') ?? 1;
    const roff = pick('roff') ?? 1 / gmin;
    if (!(ron > 0) || !(roff > 0)) throw new SimulationError(`${this.name}: ron and roff must be positive`, 'netlist');
    this.sp = { thr, hys, ron, roff };
  }

  /** Switch state after applying the hysteresis rule to control value c with previous state prev. */
  private decide(c: number, prev: number): number {
    const { thr, hys } = this.sp;
    if (c > thr + hys) return 1;
    if (c < thr - hys) return 0;
    return prev;
  }

  load(ctx: LoadContext): void {
    const s0 = ctx.state0;
    const c = this.control(ctx.x);
    let state: number;
    if (this.forced !== undefined) {
      state = this.forced;
    } else if (ctx.initJunctions) {
      state = this.initialOn ? 1 : 0;
    } else {
      const prev = ctx.mode === 'tran' && !ctx.tranOp ? ctx.state1[this.st] : s0[this.st];
      state = this.decide(c, prev);
      if (state !== s0[this.st]) ctx.noncon();
    }
    s0[this.st] = state;
    s0[this.st + 1] = c;
    this.lastState = state;
    this.g = 1 / (state ? this.sp.ron : this.sp.roff);
    stampConductance(ctx, this.a, this.b, this.g);
  }

  acLoad(ctx: AcContext): void {
    const state = this.forced ?? ctx.state0[this.st];
    stampAdmittance(ctx, this.a, this.b, 1 / (state ? this.sp.ron : this.sp.roff), 0);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I: this.g * (x(this.a) - x(this.b)) };
  }

  acOutputs(x: ComplexReader): Record<string, { re: number; im: number }> {
    const va = x(this.a);
    const vb = x(this.b);
    return { I: { re: this.g * (va.re - vb.re), im: this.g * (va.im - vb.im) } };
  }

  /** Present state (1 on, 0 off). */
  get isOn(): boolean {
    return (this.forced ?? this.lastState) === 1;
  }

  setParam(p: string, value: number): void {
    const key = p.trim().toLowerCase();
    const [kThr, kHys] = this.paramNames;
    if (key === 'value' || key === 'state') {
      this.forced = Number.isFinite(value) && value >= 0 ? (value >= 0.5 ? 1 : 0) : undefined;
    } else if (key === kThr) {
      if (Number.isFinite(value)) this.sp.thr = value;
    } else if (key === kHys) {
      if (Number.isFinite(value)) this.sp.hys = Math.abs(value);
    } else if (key === 'ron') {
      if (value > 0) this.sp.ron = value;
    } else if (key === 'roff') {
      if (value > 0) this.sp.roff = value;
    } else throw runtimeParamError(this.name, p);
  }

  getParam(p: string): number | undefined {
    const key = p.trim().toLowerCase();
    const [kThr, kHys] = this.paramNames;
    if (key === 'value' || key === 'state') return this.isOn ? 1 : 0;
    if (key === kThr) return this.sp.thr;
    if (key === kHys) return this.sp.hys;
    if (key === 'ron') return this.sp.ron;
    if (key === 'roff') return this.sp.roff;
    return undefined;
  }
}

export class VoltageSwitch extends SwitchBase {
  readonly type: ElementType = 'S';
  protected readonly modelType = 'SW';
  protected readonly paramNames: [string, string, string, string] = ['vt', 'vh', 'von', 'voff'];
  private cp = -1;
  private cn = -1;

  constructor(el: ElementIR) {
    super(el, 4);
  }

  override setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.cp = ctx.node(this.nodeNames[2]);
    this.cn = ctx.node(this.nodeNames[3]);
  }

  protected control(read: (i: number) => number): number {
    return read(this.cp) - read(this.cn);
  }
}

export class CurrentSwitch extends SwitchBase {
  readonly type: ElementType = 'W';
  protected readonly modelType = 'CSW';
  protected readonly paramNames: [string, string, string, string] = ['it', 'ih', 'ion', 'ioff'];
  private readonly controlName: string | undefined;
  private ctrl = -1;

  constructor(el: ElementIR) {
    super(el, 2);
    this.controlName = el.control;
  }

  bind(ctx: BindContext): void {
    this.ctrl = resolveControlBranch(this.name, this.controlName, ctx);
  }

  protected control(read: (i: number) => number): number {
    return read(this.ctrl);
  }
}

export const createVoltageSwitch = (el: ElementIR): Device => new VoltageSwitch(el);
export const createCurrentSwitch = (el: ElementIR): Device => new CurrentSwitch(el);
