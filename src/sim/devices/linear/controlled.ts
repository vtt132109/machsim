/**
 * Linear controlled sources.
 *
 *   E  VCVS  [n+, n-, nc+, nc-], value = gain        v(n+) - v(n-) = gain * v(nc+, nc-)   (branch "I(E1)")
 *   G  VCCS  [n+, n-, nc+, nc-], value = gm          i(n+ -> n- through G) = gm * v(nc+, nc-)
 *   F  CCCS  [n+, n-], control = V name, value = gain  i(n+ -> n- through F) = gain * i(control)
 *   H  CCVS  [n+, n-], control = V name, value = r     v(n+) - v(n-) = r * i(control)       (branch "I(H1)")
 *
 * F and H resolve the controlling element in bind(): any element owning a branch unknown
 * (voltage source, inductor, E, H) can be the controller; its branch current uses the SPICE sign.
 *
 * Outputs: G and F: I (output current n+ -> n-). setParam/getParam: value | gain (also gm / r).
 */
import type { AcContext, BindContext, Device, LoadContext, SetupContext } from '../../device';
import type { ElementIR, ElementType } from '../../netlist';
import { SimulationError } from '../../results';
import type { ComplexReader, EngineDeviceExtensions } from '../../engine/hooks';
import { requireNodes, requireValue, runtimeParamError, stampBranchIncidence, stampBranchIncidenceAc } from './common';

const GAIN_KEYS = new Set(['value', 'gain', 'gm', 'r', 'transresistance', 'transconductance']);

abstract class ControlledSource implements Device, EngineDeviceExtensions {
  abstract readonly type: ElementType;
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;
  protected gain: number;
  protected p = -1;
  protected n = -1;

  constructor(el: ElementIR, nodeCount: number, what: string) {
    requireNodes(el, nodeCount);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, nodeCount);
    this.gain = requireValue(el, what);
  }

  setup(ctx: SetupContext): void {
    this.p = ctx.node(this.nodeNames[0]);
    this.n = ctx.node(this.nodeNames[1]);
  }

  abstract load(ctx: LoadContext): void;
  abstract acLoad(ctx: AcContext): void;

  setParam(param: string, value: number): void {
    if (!GAIN_KEYS.has(param.trim().toLowerCase())) throw runtimeParamError(this.name, param);
    if (Number.isFinite(value)) this.gain = value;
  }

  getParam(param: string): number | undefined {
    return GAIN_KEYS.has(param.trim().toLowerCase()) ? this.gain : undefined;
  }
}

/** Resolve the controlling branch of F / H / W elements. */
export function resolveControlBranch(owner: string, control: string | undefined, ctx: BindContext): number {
  if (!control) throw new SimulationError(`${owner}: missing controlling source name`, 'netlist');
  const d = ctx.findDevice(control);
  if (!d) throw new SimulationError(`${owner}: controlling element '${control}' not found`, 'netlist');
  const br = d.branchIndex ? d.branchIndex() : -1;
  if (!(br >= 0)) {
    throw new SimulationError(`${owner}: controlling element '${d.name}' has no branch current (use a voltage source)`, 'netlist');
  }
  return br;
}

export class Vcvs extends ControlledSource {
  readonly type: ElementType = 'E';
  private cp = -1;
  private cn = -1;
  private br = -1;

  constructor(el: ElementIR) {
    super(el, 4, 'gain');
  }

  override setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.cp = ctx.node(this.nodeNames[2]);
    this.cn = ctx.node(this.nodeNames[3]);
    this.br = ctx.branch(this.name);
  }

  branchIndex(): number {
    return this.br;
  }

  load(ctx: LoadContext): void {
    stampBranchIncidence(ctx, this.p, this.n, this.br);
    ctx.addMatrix(this.br, this.cp, -this.gain);
    ctx.addMatrix(this.br, this.cn, this.gain);
  }

  acLoad(ctx: AcContext): void {
    stampBranchIncidenceAc(ctx, this.p, this.n, this.br);
    ctx.addMatrix(this.br, this.cp, -this.gain, 0);
    ctx.addMatrix(this.br, this.cn, this.gain, 0);
  }
}

export class Vccs extends ControlledSource {
  readonly type: ElementType = 'G';
  private cp = -1;
  private cn = -1;

  constructor(el: ElementIR) {
    super(el, 4, 'transconductance');
  }

  override setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.cp = ctx.node(this.nodeNames[2]);
    this.cn = ctx.node(this.nodeNames[3]);
  }

  load(ctx: LoadContext): void {
    const g = this.gain;
    ctx.addMatrix(this.p, this.cp, g);
    ctx.addMatrix(this.p, this.cn, -g);
    ctx.addMatrix(this.n, this.cp, -g);
    ctx.addMatrix(this.n, this.cn, g);
  }

  acLoad(ctx: AcContext): void {
    const g = this.gain;
    ctx.addMatrix(this.p, this.cp, g, 0);
    ctx.addMatrix(this.p, this.cn, -g, 0);
    ctx.addMatrix(this.n, this.cp, -g, 0);
    ctx.addMatrix(this.n, this.cn, g, 0);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I: this.gain * (x(this.cp) - x(this.cn)) };
  }

  acOutputs(x: ComplexReader): Record<string, { re: number; im: number }> {
    const a = x(this.cp);
    const b = x(this.cn);
    return { I: { re: this.gain * (a.re - b.re), im: this.gain * (a.im - b.im) } };
  }
}

export class Cccs extends ControlledSource {
  readonly type: ElementType = 'F';
  private readonly control: string | undefined;
  private ctrl = -1;

  constructor(el: ElementIR) {
    super(el, 2, 'gain');
    this.control = el.control;
  }

  bind(ctx: BindContext): void {
    this.ctrl = resolveControlBranch(this.name, this.control, ctx);
  }

  load(ctx: LoadContext): void {
    ctx.addMatrix(this.p, this.ctrl, this.gain);
    ctx.addMatrix(this.n, this.ctrl, -this.gain);
  }

  acLoad(ctx: AcContext): void {
    ctx.addMatrix(this.p, this.ctrl, this.gain, 0);
    ctx.addMatrix(this.n, this.ctrl, -this.gain, 0);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I: this.gain * x(this.ctrl) };
  }

  acOutputs(x: ComplexReader): Record<string, { re: number; im: number }> {
    const c = x(this.ctrl);
    return { I: { re: this.gain * c.re, im: this.gain * c.im } };
  }
}

export class Ccvs extends ControlledSource {
  readonly type: ElementType = 'H';
  private readonly control: string | undefined;
  private ctrl = -1;
  private br = -1;

  constructor(el: ElementIR) {
    super(el, 2, 'transresistance');
    this.control = el.control;
  }

  override setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.br = ctx.branch(this.name);
  }

  bind(ctx: BindContext): void {
    this.ctrl = resolveControlBranch(this.name, this.control, ctx);
  }

  branchIndex(): number {
    return this.br;
  }

  load(ctx: LoadContext): void {
    stampBranchIncidence(ctx, this.p, this.n, this.br);
    ctx.addMatrix(this.br, this.ctrl, -this.gain);
  }

  acLoad(ctx: AcContext): void {
    stampBranchIncidenceAc(ctx, this.p, this.n, this.br);
    ctx.addMatrix(this.br, this.ctrl, -this.gain, 0);
  }
}

export const createVcvs = (el: ElementIR): Device => new Vcvs(el);
export const createVccs = (el: ElementIR): Device => new Vccs(el);
export const createCccs = (el: ElementIR): Device => new Cccs(el);
export const createCcvs = (el: ElementIR): Device => new Ccvs(el);
