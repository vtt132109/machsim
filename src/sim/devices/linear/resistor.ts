/**
 * Resistor (R): nodes [n+, n-], value = ohms.
 *
 * Instance parameters: tc1, tc2 (first/second order temperature coefficients, 1/°C, 1/°C²),
 * temp (instance temperature, °C; default the circuit temperature), m (parallel copies).
 * R(T) = R * (1 + tc1*(T - Tnom) + tc2*(T - Tnom)^2).
 *
 * A zero resistance is replaced by {@link MIN_RESISTANCE} with a warning (an ideal short would
 * need a branch unknown and would change the matrix topology when the value is edited).
 *
 * Outputs: I (current n+ -> n- through the resistor), P (dissipated power).
 * setParam/getParam: value | r | resistance, tc1, tc2, temp, m; any other setParam name throws
 * a SimulationError ('unsupported').
 */
import { KELVIN, type AcContext, type Device, type LoadContext, type SetupContext } from '../../device';
import type { ElementIR, ElementType } from '../../netlist';
import type { ComplexReader, EngineDeviceExtensions } from '../../engine/hooks';
import { multiplicity, param, requireNodes, requireValue, runtimeParamError, stampAdmittance, stampConductance } from './common';

export const MIN_RESISTANCE = 1e-6;

export class Resistor implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'R';
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;

  private resistance: number;
  private tc1: number;
  private tc2: number;
  private instTemp: number | undefined;
  private m: number;
  private a = -1;
  private b = -1;
  private tnom = 27;
  private cachedTemp = Number.NaN;
  private g = 0;

  constructor(el: ElementIR) {
    requireNodes(el, 2);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
    this.resistance = requireValue(el, 'resistance');
    this.tc1 = param(el, 'tc1') ?? 0;
    this.tc2 = param(el, 'tc2') ?? 0;
    this.instTemp = param(el, 'temp');
    this.m = multiplicity(el);
  }

  setup(ctx: SetupContext): void {
    this.a = ctx.node(this.nodeNames[0]);
    this.b = ctx.node(this.nodeNames[1]);
    this.tnom = ctx.options.tnom;
    if (Math.abs(this.resistance) < MIN_RESISTANCE) {
      ctx.warn(`${this.name}: resistance ${this.resistance} Ω replaced by ${MIN_RESISTANCE} Ω`);
    }
  }

  /** Conductance at circuit temperature `tempK` (kelvin). */
  conductance(tempK: number): number {
    if (tempK !== this.cachedTemp) {
      const t = this.instTemp ?? tempK - KELVIN;
      const dt = t - this.tnom;
      let r = this.resistance * (1 + this.tc1 * dt + this.tc2 * dt * dt);
      if (Math.abs(r) < MIN_RESISTANCE) r = r < 0 ? -MIN_RESISTANCE : MIN_RESISTANCE;
      this.g = this.m / r;
      this.cachedTemp = tempK;
    }
    return this.g;
  }

  load(ctx: LoadContext): void {
    stampConductance(ctx, this.a, this.b, this.conductance(ctx.temp));
  }

  acLoad(ctx: AcContext): void {
    stampAdmittance(ctx, this.a, this.b, this.conductance(ctx.temp), 0);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const v = x(this.a) - x(this.b);
    const i = this.g * v;
    return { I: i, P: i * v };
  }

  acOutputs(x: ComplexReader): Record<string, { re: number; im: number }> {
    const va = x(this.a);
    const vb = x(this.b);
    return { I: { re: this.g * (va.re - vb.re), im: this.g * (va.im - vb.im) } };
  }

  setParam(p: string, value: number): void {
    switch (p.toLowerCase()) {
      case 'value':
      case 'r':
      case 'resistance':
        this.resistance = value;
        break;
      case 'tc1':
        this.tc1 = value;
        break;
      case 'tc2':
        this.tc2 = value;
        break;
      case 'temp':
        this.instTemp = Number.isFinite(value) ? value : undefined;
        break;
      case 'm':
        if (value > 0) this.m = value;
        break;
      default:
        throw runtimeParamError(this.name, p);
    }
    this.cachedTemp = Number.NaN;
  }

  getParam(p: string): number | undefined {
    switch (p.toLowerCase()) {
      case 'value':
      case 'r':
      case 'resistance':
        return this.resistance;
      case 'tc1':
        return this.tc1;
      case 'tc2':
        return this.tc2;
      case 'temp':
        return this.instTemp;
      case 'm':
        return this.m;
      default:
        return undefined;
    }
  }
}

export function createResistor(el: ElementIR): Device {
  return new Resistor(el);
}
