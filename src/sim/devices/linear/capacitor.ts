/**
 * Capacitor (C): nodes [n+, n-], value = farads.
 *
 * Instance parameters: ic (initial voltage, used with UIC), m (parallel copies).
 *
 * Charge formulation: q = C*v is stored in state slot `st`, its current dq/dt in `st+1`
 * (LoadContext.integrate). In OP/DC the capacitor is an open circuit; during the operating
 * point that starts a transient it stores its charge (from ic= with UIC, otherwise from the node
 * voltages). Local truncation error is reported through TruncContext.terr. With UIC the node
 * voltage implied by ic= (other terminal grounded or otherwise determined) is also written into
 * the t = 0 point (initialVoltages), so the first reported sample shows the initial condition.
 *
 * Outputs: I (current n+ -> n- through the capacitor).
 * setParam/getParam: value | c | capacitance, ic, m; any other setParam name throws a
 * SimulationError ('unsupported').
 */
import type { AcContext, Device, LoadContext, SetupContext, TruncContext } from '../../device';
import type { ElementIR, ElementType } from '../../netlist';
import type { ComplexReader, EngineDeviceExtensions } from '../../engine/hooks';
import { multiplicity, param, requireNodes, requireValue, runtimeParamError, stampAdmittance, stampConductance, stampCurrent } from './common';

export class Capacitor implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'C';
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;

  private capacitance: number;
  private ic: number | undefined;
  private m: number;
  private a = -1;
  private b = -1;
  private st = -1;
  /** Companion model of the last load: i = geq*v + ieq. */
  private geq = 0;
  private ieq = 0;

  constructor(el: ElementIR) {
    requireNodes(el, 2);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
    this.capacitance = requireValue(el, 'capacitance');
    this.ic = param(el, 'ic');
    this.m = multiplicity(el);
  }

  setup(ctx: SetupContext): void {
    this.a = ctx.node(this.nodeNames[0]);
    this.b = ctx.node(this.nodeNames[1]);
    this.st = ctx.state(2);
  }

  /** Effective capacitance (parallel copies included). */
  get farads(): number {
    return this.capacitance * this.m;
  }

  load(ctx: LoadContext): void {
    const c = this.farads;
    if (ctx.mode === 'tran' && !ctx.tranOp) {
      const v = ctx.x(this.a) - ctx.x(this.b);
      ctx.state0[this.st] = c * v;
      const r = ctx.integrate(this.st, c);
      this.geq = r.geq;
      this.ieq = r.i - r.geq * v;
      stampConductance(ctx, this.a, this.b, this.geq);
      stampCurrent(ctx, this.a, this.b, this.ieq);
      return;
    }
    this.geq = 0;
    this.ieq = 0;
    if (ctx.tranOp) {
      const v = ctx.uic && this.ic !== undefined ? this.ic : ctx.x(this.a) - ctx.x(this.b);
      ctx.state0[this.st] = c * v;
      ctx.state0[this.st + 1] = 0;
    }
  }

  truncate(ctx: TruncContext): number {
    return ctx.terr(this.st);
  }

  /**
   * UIC: with one terminal determined (ground, a .ic node or a node set by another capacitor),
   * the other one starts at that voltage ± ic, so the t = 0 point shows the initial condition.
   */
  initialVoltages(set: (index: number, value: number) => void, get: (index: number) => number | undefined): void {
    if (this.ic === undefined) return;
    const va = get(this.a);
    const vb = get(this.b);
    if (va === undefined && vb !== undefined) set(this.a, vb + this.ic);
    else if (vb === undefined && va !== undefined) set(this.b, va - this.ic);
  }

  acLoad(ctx: AcContext): void {
    stampAdmittance(ctx, this.a, this.b, 0, ctx.omega * this.farads);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I: this.geq * (x(this.a) - x(this.b)) + this.ieq };
  }

  acOutputs(x: ComplexReader, omega: number): Record<string, { re: number; im: number }> {
    const va = x(this.a);
    const vb = x(this.b);
    const wc = omega * this.farads;
    return { I: { re: -wc * (va.im - vb.im), im: wc * (va.re - vb.re) } };
  }

  setParam(p: string, value: number): void {
    switch (p.toLowerCase()) {
      case 'value':
      case 'c':
      case 'capacitance':
        if (Number.isFinite(value)) this.capacitance = value;
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
      case 'c':
      case 'capacitance':
        return this.capacitance;
      case 'ic':
        return this.ic;
      case 'm':
        return this.m;
      default:
        return undefined;
    }
  }
}

export function createCapacitor(el: ElementIR): Device {
  return new Capacitor(el);
}
