/**
 * Lossless transmission line (T): nodes [p1+, p1-, p2+, p2-].
 *
 * Parameters: z0 (characteristic impedance, alias zo), td (one-way delay) or f + nl
 * (td = nl / f, nl default 0.25 = quarter wavelength at f); rel / abs (corner detection
 * tolerances, default 1 and 1 V/s as in SPICE3).
 *
 * Method of characteristics. With port voltages v1 = v(p1+) - v(p1-), v2 = v(p2+) - v(p2-) and
 * port currents i1, i2 flowing into the line at the + terminals (two branch unknowns):
 *     v1(t) - z0*i1(t) = v2(t - td) + z0*i2(t - td)
 *     v2(t) - z0*i2(t) = v1(t - td) + z0*i1(t - td)
 * The right-hand sides come from the history of accepted timepoints (linear interpolation; before
 * t = 0 the line is in its DC steady state). In OP/DC the delay vanishes and the same equations
 * couple both ports directly (v1 = v2, i1 = -i2). AC: the delayed terms get the factor e^{-jωtd}.
 *
 * Timestep: limited to td (maxTimestep) so that delayed values are always in the history.
 * Breakpoints: when the slope of an outgoing wave (v + z0*i at a port) changes sharply at an
 * accepted point t, a breakpoint is scheduled at t + td, where the corner arrives at the far end.
 *
 * Outputs: I1, I2 (port currents into the line).
 */
import type { AcContext, Device, LoadContext, SetupContext } from '../../device';
import type { ElementIR, ElementType } from '../../netlist';
import { SimulationError } from '../../results';
import type { AcceptContext, EngineDeviceExtensions } from '../../engine/hooks';
import { param, requireNodes, runtimeParamError } from './common';

export class TransmissionLine implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'T';
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;

  private z0: number;
  private td: number;
  private readonly rel: number;
  private readonly abs: number;
  private p1 = -1;
  private n1 = -1;
  private p2 = -1;
  private n2 = -1;
  private br1 = -1;
  private br2 = -1;
  // history of accepted points: time, outgoing waves w1 = v1 + z0*i1 and w2 = v2 + z0*i2
  private ht: Float64Array = new Float64Array(256);
  private hw1: Float64Array = new Float64Array(256);
  private hw2: Float64Array = new Float64Array(256);
  private hStart = 0;
  private hLen = 0;

  constructor(el: ElementIR) {
    requireNodes(el, 4);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
    const z0 = param(el, 'z0', 'zo') ?? el.value;
    if (z0 === undefined || !(z0 > 0)) throw new SimulationError(`${el.name}: characteristic impedance z0 must be > 0`, 'netlist');
    this.z0 = z0;
    let td = param(el, 'td');
    if (td === undefined) {
      const f = param(el, 'f', 'freq');
      const nl = param(el, 'nl') ?? 0.25;
      if (f !== undefined && f > 0) td = nl / f;
    }
    if (td === undefined || !(td > 0)) throw new SimulationError(`${el.name}: delay td (or f and nl) must be given and > 0`, 'netlist');
    this.td = td;
    this.rel = param(el, 'rel') ?? 1;
    this.abs = param(el, 'abs') ?? 1;
  }

  setup(ctx: SetupContext): void {
    this.p1 = ctx.node(this.nodeNames[0]);
    this.n1 = ctx.node(this.nodeNames[1]);
    this.p2 = ctx.node(this.nodeNames[2]);
    this.n2 = ctx.node(this.nodeNames[3]);
    this.br1 = ctx.branch(`${this.name}#i1`);
    this.br2 = ctx.branch(`${this.name}#i2`);
  }

  get delay(): number {
    return this.td;
  }

  private stampPorts(ctx: LoadContext): void {
    // KCL: port currents enter the line at the + terminals
    ctx.addMatrix(this.p1, this.br1, 1);
    ctx.addMatrix(this.n1, this.br1, -1);
    ctx.addMatrix(this.p2, this.br2, 1);
    ctx.addMatrix(this.n2, this.br2, -1);
    // branch rows: v_k - z0*i_k ...
    ctx.addMatrix(this.br1, this.p1, 1);
    ctx.addMatrix(this.br1, this.n1, -1);
    ctx.addMatrix(this.br1, this.br1, -this.z0);
    ctx.addMatrix(this.br2, this.p2, 1);
    ctx.addMatrix(this.br2, this.n2, -1);
    ctx.addMatrix(this.br2, this.br2, -this.z0);
  }

  load(ctx: LoadContext): void {
    this.stampPorts(ctx);
    if (ctx.mode === 'tran' && !ctx.tranOp) {
      const tau = ctx.time - this.td;
      ctx.addRhs(this.br1, this.wave(2, tau));
      ctx.addRhs(this.br2, this.wave(1, tau));
      return;
    }
    // DC: ... = v_other + z0*i_other (no delay)
    ctx.addMatrix(this.br1, this.p2, -1);
    ctx.addMatrix(this.br1, this.n2, 1);
    ctx.addMatrix(this.br1, this.br2, -this.z0);
    ctx.addMatrix(this.br2, this.p1, -1);
    ctx.addMatrix(this.br2, this.n1, 1);
    ctx.addMatrix(this.br2, this.br1, -this.z0);
  }

  acLoad(ctx: AcContext): void {
    const z0 = this.z0;
    const cr = Math.cos(ctx.omega * this.td);
    const ci = -Math.sin(ctx.omega * this.td);
    ctx.addMatrix(this.p1, this.br1, 1, 0);
    ctx.addMatrix(this.n1, this.br1, -1, 0);
    ctx.addMatrix(this.p2, this.br2, 1, 0);
    ctx.addMatrix(this.n2, this.br2, -1, 0);
    ctx.addMatrix(this.br1, this.p1, 1, 0);
    ctx.addMatrix(this.br1, this.n1, -1, 0);
    ctx.addMatrix(this.br1, this.br1, -z0, 0);
    ctx.addMatrix(this.br2, this.p2, 1, 0);
    ctx.addMatrix(this.br2, this.n2, -1, 0);
    ctx.addMatrix(this.br2, this.br2, -z0, 0);
    ctx.addMatrix(this.br1, this.p2, -cr, -ci);
    ctx.addMatrix(this.br1, this.n2, cr, ci);
    ctx.addMatrix(this.br1, this.br2, -z0 * cr, -z0 * ci);
    ctx.addMatrix(this.br2, this.p1, -cr, -ci);
    ctx.addMatrix(this.br2, this.n1, cr, ci);
    ctx.addMatrix(this.br2, this.br1, -z0 * cr, -z0 * ci);
  }

  /** Outgoing wave of port `port` (1 or 2) at time t, interpolated from the history. */
  private wave(port: 1 | 2, t: number): number {
    const w = port === 1 ? this.hw1 : this.hw2;
    const n = this.hLen;
    if (n === 0) return 0;
    const t0 = this.hStart;
    const ht = this.ht;
    const last = t0 + n - 1;
    if (t <= ht[t0]) return w[t0];
    if (t >= ht[last]) return w[last];
    let lo = t0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ht[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = ht[hi] - ht[lo];
    return span > 0 ? w[lo] + ((w[hi] - w[lo]) * (t - ht[lo])) / span : w[hi];
  }

  beginTransient(): void {
    this.hStart = 0;
    this.hLen = 0;
  }

  maxTimestep(): number {
    return this.td;
  }

  accept(ctx: AcceptContext): void {
    const x = ctx.x;
    const w1 = x(this.p1) - x(this.n1) + this.z0 * x(this.br1);
    const w2 = x(this.p2) - x(this.n2) + this.z0 * x(this.br2);
    const t = ctx.time;
    // drop history older than needed (keep one point before t - td for interpolation)
    const keepFrom = t - this.td;
    while (this.hLen > 2 && this.ht[this.hStart + 1] < keepFrom) {
      this.hStart++;
      this.hLen--;
    }
    if (this.hStart + this.hLen >= this.ht.length) this.compactHistory();
    const k = this.hStart + this.hLen;
    if (this.hLen > 0 && t <= this.ht[k - 1]) {
      // same time again (should not happen): overwrite
      this.hw1[k - 1] = w1;
      this.hw2[k - 1] = w2;
      return;
    }
    this.ht[k] = t;
    this.hw1[k] = w1;
    this.hw2[k] = w2;
    this.hLen++;
    if (this.hLen >= 3) {
      const a = k - 2;
      const b = k - 1;
      if (this.corner(this.hw1, a, b, k) || this.corner(this.hw2, a, b, k)) ctx.addBreakpoint(this.ht[b] + this.td);
    }
  }

  /** Sharp slope change of wave w at history index b (between a-b and b-c). */
  private corner(w: Float64Array, a: number, b: number, c: number): boolean {
    const ht = this.ht;
    const d1 = (w[b] - w[a]) / (ht[b] - ht[a]);
    const d2 = (w[c] - w[b]) / (ht[c] - ht[b]);
    return Math.abs(d2 - d1) >= this.rel * Math.max(Math.abs(d1), Math.abs(d2)) + this.abs;
  }

  private compactHistory(): void {
    const n = this.hLen;
    const s = this.hStart;
    let cap = this.ht.length;
    if (n * 2 > cap) cap *= 2;
    const move = (src: Float64Array): Float64Array => {
      if (cap === src.length) {
        src.copyWithin(0, s, s + n);
        return src;
      }
      const dst = new Float64Array(cap);
      dst.set(src.subarray(s, s + n));
      return dst;
    };
    this.ht = move(this.ht);
    this.hw1 = move(this.hw1);
    this.hw2 = move(this.hw2);
    this.hStart = 0;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I1: x(this.br1), I2: x(this.br2) };
  }

  setParam(p: string, value: number): void {
    const key = p.trim().toLowerCase();
    if (key === 'z0' || key === 'zo' || key === 'value') {
      if (value > 0) this.z0 = value;
    } else if (key === 'td') {
      if (value > 0) this.td = value;
    } else throw runtimeParamError(this.name, p);
  }

  getParam(p: string): number | undefined {
    const key = p.trim().toLowerCase();
    if (key === 'z0' || key === 'zo' || key === 'value') return this.z0;
    if (key === 'td') return this.td;
    return undefined;
  }
}

export const createTransmissionLine = (el: ElementIR): Device => new TransmissionLine(el);
