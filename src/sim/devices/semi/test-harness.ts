/**
 * Minimal MNA harness for unit-testing semiconductor devices in isolation.
 *
 * It implements the contract contexts (SetupContext, LoadContext, AcContext, NoiseContext,
 * TruncContext) over small dense matrices, plus a tiny Newton loop, a fixed-step transient
 * stepper and a complex AC solve. It is deliberately simple (Gaussian elimination, no sparse
 * structures, no timestep control) and is NOT the production engine (src/sim/engine).
 *
 * Unknown layout: unknowns are numbered in allocation order (nodes and branches interleaved);
 * devices never depend on the layout. Ground is GROUND (-1) and every access to it is ignored.
 *
 * Built-in helper elements (independent of the linear-device team's code):
 *   vsource(name, p, n, volts), isource(name, p, n, amps), resistor(name, a, b, ohms),
 *   capacitor(name, a, b, farads) (transient only).
 */

import {
  GROUND,
  type AcContext,
  type Device,
  type IntegrationMethod,
  type LoadContext,
  type NoiseContext,
  type NoiseGenerator,
  type SetupContext,
  type TruncContext,
} from '../../device';
import { DEFAULT_OPTIONS, isGroundNode, type ElementIR, type ElementType, type ModelCard, type SimOptions } from '../../netlist';
import { celsiusToKelvin } from './common';

export interface LoadFlags {
  mode?: 'op' | 'dc' | 'tran';
  initJunctions?: boolean;
  initTimepoint?: boolean;
  tranOp?: boolean;
  uic?: boolean;
  time?: number;
  dt?: number;
  method?: IntegrationMethod;
  gmin?: number;
  srcFact?: number;
  /** circuit temperature, °C (default options.temp) */
  tempC?: number;
}

export interface Assembly {
  G: number[][];
  rhs: number[];
  noncon: boolean;
}

export interface NewtonResult {
  x: Float64Array;
  iterations: number;
  converged: boolean;
}

export interface IntegrateCall {
  device: string;
  q: number;
  cap: number;
  charge: number;
}

/** Dense real Gaussian elimination with partial pivoting. Throws on a singular matrix. */
export function solveReal(Ain: number[][], bin: number[]): Float64Array {
  const n = bin.length;
  const A = Ain.map((r) => r.slice());
  const b = bin.slice();
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[piv][k])) piv = i;
    if (A[piv][k] === 0 || !Number.isFinite(A[piv][k])) throw new Error(`singular matrix at column ${k}`);
    if (piv !== k) {
      [A[k], A[piv]] = [A[piv], A[k]];
      [b[k], b[piv]] = [b[piv], b[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / A[k][k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/** Dense complex Gaussian elimination with partial pivoting (separate re/im arrays). */
export function solveComplex(
  Are: number[][],
  Aim: number[][],
  bre: number[],
  bim: number[],
): { re: Float64Array; im: Float64Array } {
  const n = bre.length;
  const R = Are.map((r) => r.slice());
  const I = Aim.map((r) => r.slice());
  const br = bre.slice();
  const bi = bim.slice();
  const abs2 = (i: number, k: number): number => R[i][k] * R[i][k] + I[i][k] * I[i][k];
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let i = k + 1; i < n; i++) if (abs2(i, k) > abs2(piv, k)) piv = i;
    if (abs2(piv, k) === 0) throw new Error(`singular complex matrix at column ${k}`);
    if (piv !== k) {
      [R[k], R[piv]] = [R[piv], R[k]];
      [I[k], I[piv]] = [I[piv], I[k]];
      [br[k], br[piv]] = [br[piv], br[k]];
      [bi[k], bi[piv]] = [bi[piv], bi[k]];
    }
    const d = abs2(k, k);
    for (let i = k + 1; i < n; i++) {
      // f = A[i][k] / A[k][k]
      const fr = (R[i][k] * R[k][k] + I[i][k] * I[k][k]) / d;
      const fi = (I[i][k] * R[k][k] - R[i][k] * I[k][k]) / d;
      if (fr === 0 && fi === 0) continue;
      for (let j = k; j < n; j++) {
        R[i][j] -= fr * R[k][j] - fi * I[k][j];
        I[i][j] -= fr * I[k][j] + fi * R[k][j];
      }
      br[i] -= fr * br[k] - fi * bi[k];
      bi[i] -= fr * bi[k] + fi * br[k];
    }
  }
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sr = br[i];
    let si = bi[i];
    for (let j = i + 1; j < n; j++) {
      sr -= R[i][j] * xr[j] - I[i][j] * xi[j];
      si -= R[i][j] * xi[j] + I[i][j] * xr[j];
    }
    const d = R[i][i] * R[i][i] + I[i][i] * I[i][i];
    xr[i] = (sr * R[i][i] + si * I[i][i]) / d;
    xi[i] = (si * R[i][i] - sr * I[i][i]) / d;
  }
  return { re: xr, im: xi };
}

function zeros(n: number): number[][] {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

// ---------------------------------------------------------------------------------------------
// Simple linear helper elements
// ---------------------------------------------------------------------------------------------

abstract class HelperDevice implements Device {
  abstract readonly type: ElementType;
  constructor(
    readonly name: string,
    readonly nodeNames: string[],
  ) {}
  protected idx: number[] = [];
  setup(ctx: SetupContext): void {
    this.idx = this.nodeNames.map((n) => ctx.node(n));
  }
  abstract load(ctx: LoadContext): void;
  acLoad?(ctx: AcContext): void;
}

class Resistor extends HelperDevice {
  readonly type = 'R' as const;
  constructor(
    name: string,
    a: string,
    b: string,
    public ohms: number,
  ) {
    super(name, [a, b]);
  }
  private stamp(add: (r: number, c: number, v: number) => void): void {
    const g = 1 / this.ohms;
    const [a, b] = this.idx;
    add(a, a, g);
    add(b, b, g);
    add(a, b, -g);
    add(b, a, -g);
  }
  load(ctx: LoadContext): void {
    this.stamp((r, c, v) => ctx.addMatrix(r, c, v));
  }
  acLoad(ctx: AcContext): void {
    this.stamp((r, c, v) => ctx.addMatrix(r, c, v, 0));
  }
}

class Capacitor extends HelperDevice {
  readonly type = 'C' as const;
  private slot = 0;
  constructor(
    name: string,
    a: string,
    b: string,
    public farads: number,
  ) {
    super(name, [a, b]);
  }
  setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.slot = ctx.state(2);
  }
  load(ctx: LoadContext): void {
    const [a, b] = this.idx;
    const v = ctx.x(a) - ctx.x(b);
    if (ctx.tranOp || ctx.mode === 'tran') ctx.state0[this.slot] = this.farads * v;
    if (ctx.mode !== 'tran' || ctx.tranOp) return;
    const r = ctx.integrate(this.slot, this.farads);
    ctx.addMatrix(a, a, r.geq);
    ctx.addMatrix(b, b, r.geq);
    ctx.addMatrix(a, b, -r.geq);
    ctx.addMatrix(b, a, -r.geq);
    const ieq = r.i - r.geq * v;
    ctx.addRhs(a, -ieq);
    ctx.addRhs(b, ieq);
  }
  acLoad(ctx: AcContext): void {
    const [a, b] = this.idx;
    const y = ctx.omega * this.farads;
    ctx.addMatrix(a, a, 0, y);
    ctx.addMatrix(b, b, 0, y);
    ctx.addMatrix(a, b, 0, -y);
    ctx.addMatrix(b, a, 0, -y);
  }
}

class VSource extends HelperDevice {
  readonly type = 'V' as const;
  private br = 0;
  constructor(
    name: string,
    p: string,
    n: string,
    public volts: number,
    public acMag = 0,
  ) {
    super(name, [p, n]);
  }
  setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.br = ctx.branch(this.name);
  }
  branchIndex(): number {
    return this.br;
  }
  load(ctx: LoadContext): void {
    const [p, n] = this.idx;
    ctx.addMatrix(p, this.br, 1);
    ctx.addMatrix(n, this.br, -1);
    ctx.addMatrix(this.br, p, 1);
    ctx.addMatrix(this.br, n, -1);
    ctx.addRhs(this.br, this.volts * ctx.srcFact);
  }
  acLoad(ctx: AcContext): void {
    const [p, n] = this.idx;
    ctx.addMatrix(p, this.br, 1, 0);
    ctx.addMatrix(n, this.br, -1, 0);
    ctx.addMatrix(this.br, p, 1, 0);
    ctx.addMatrix(this.br, n, -1, 0);
    ctx.addRhs(this.br, this.acMag, 0);
  }
}

class ISource extends HelperDevice {
  readonly type = 'I' as const;
  constructor(
    name: string,
    p: string,
    n: string,
    public amps: number,
  ) {
    super(name, [p, n]);
  }
  load(ctx: LoadContext): void {
    const [p, n] = this.idx;
    ctx.addRhs(p, -this.amps * ctx.srcFact);
    ctx.addRhs(n, this.amps * ctx.srcFact);
  }
}

// ---------------------------------------------------------------------------------------------
// Circuit
// ---------------------------------------------------------------------------------------------

export class TestCircuit {
  readonly options: SimOptions;
  readonly devices: Device[] = [];
  readonly models: Record<string, ModelCard> = {};
  readonly warnings: string[] = [];
  readonly integrateCalls: IntegrateCall[] = [];
  readonly terrCalls: number[] = [];
  private readonly nodeMap = new Map<string, number>();
  private readonly labels: string[] = [];
  private stateCount = 0;
  size = 0;
  state0: Float64Array = new Float64Array(0);
  state1: Float64Array = new Float64Array(0);
  state2: Float64Array = new Float64Array(0);
  /** solution of the last solve (also the default linearisation point for assemble()) */
  x: Float64Array = new Float64Array(0);
  private isSetup = false;

  constructor(options: Partial<SimOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  model(card: ModelCard): this {
    this.models[card.name.toLowerCase()] = card;
    return this;
  }

  add(device: Device): Device {
    this.devices.push(device);
    return device;
  }

  /** Create a device from an IR element with a factory and add it. */
  element(factory: (el: ElementIR) => Device, el: Omit<ElementIR, 'params'> & { params?: Record<string, number> }): Device {
    return this.add(factory({ ...el, params: el.params ?? {} }));
  }

  vsource(name: string, p: string, n: string, volts: number, acMag = 0): VSource {
    return this.add(new VSource(name, p, n, volts, acMag)) as VSource;
  }

  isource(name: string, p: string, n: string, amps: number): ISource {
    return this.add(new ISource(name, p, n, amps)) as ISource;
  }

  resistor(name: string, a: string, b: string, ohms: number): Resistor {
    return this.add(new Resistor(name, a, b, ohms)) as Resistor;
  }

  capacitor(name: string, a: string, b: string, farads: number): Capacitor {
    return this.add(new Capacitor(name, a, b, farads)) as Capacitor;
  }

  /** Run setup() on every device and allocate vectors. */
  setup(): this {
    const self = this;
    const ctx: SetupContext = {
      node(name: string): number {
        if (isGroundNode(name)) return GROUND;
        const key = name.toLowerCase();
        let i = self.nodeMap.get(key);
        if (i === undefined) {
          i = self.size++;
          self.nodeMap.set(key, i);
          self.labels.push(name);
        }
        return i;
      },
      branch(label: string): number {
        self.labels.push(`branch:${label}`);
        return self.size++;
      },
      state(count: number): number {
        const base = self.stateCount;
        self.stateCount += count;
        return base;
      },
      model(name: string): ModelCard | undefined {
        return self.models[name.toLowerCase()];
      },
      options: this.options,
      warn(message: string): void {
        self.warnings.push(message);
      },
    };
    for (const d of this.devices) d.setup(ctx);
    this.state0 = new Float64Array(this.stateCount);
    this.state1 = new Float64Array(this.stateCount);
    this.state2 = new Float64Array(this.stateCount);
    this.x = new Float64Array(this.size);
    this.isSetup = true;
    return this;
  }

  /** Index of a node (throws if unknown); GROUND for ground names. */
  node(name: string): number {
    if (isGroundNode(name)) return GROUND;
    const i = this.nodeMap.get(name.toLowerCase());
    if (i === undefined) throw new Error(`unknown node ${name}`);
    return i;
  }

  hasNode(name: string): boolean {
    return this.nodeMap.has(name.toLowerCase());
  }

  /** Voltage of a node in a solution vector. */
  v(name: string, x: ArrayLike<number> = this.x): number {
    const i = this.node(name);
    return i === GROUND ? 0 : x[i];
  }

  private loadContext(x: ArrayLike<number>, flags: LoadFlags, G: number[][], rhs: number[], noncon: { flag: boolean }): LoadContext {
    const self = this;
    const mode = flags.mode ?? 'op';
    const method = flags.method ?? 'be';
    let device = '';
    const ctx: LoadContext & { setDevice(n: string): void } = {
      mode,
      initJunctions: flags.initJunctions ?? false,
      initTimepoint: flags.initTimepoint ?? false,
      tranOp: flags.tranOp ?? false,
      uic: flags.uic ?? false,
      time: flags.time ?? 0,
      dt: flags.dt ?? 0,
      method,
      gmin: flags.gmin ?? this.options.gmin,
      srcFact: flags.srcFact ?? 1,
      temp: celsiusToKelvin(flags.tempC ?? this.options.temp),
      options: this.options,
      x: (i: number) => (i === GROUND ? 0 : x[i]),
      addMatrix(r: number, c: number, v: number): void {
        if (r === GROUND || c === GROUND) return;
        if (!Number.isFinite(v)) throw new Error(`${device}: non-finite matrix entry (${r},${c}) = ${v}`);
        G[r][c] += v;
      },
      addRhs(r: number, v: number): void {
        if (r === GROUND) return;
        if (!Number.isFinite(v)) throw new Error(`${device}: non-finite rhs entry ${r} = ${v}`);
        rhs[r] += v;
      },
      state0: this.state0,
      state1: this.state1,
      state2: this.state2,
      integrate(q: number, cap: number): { geq: number; i: number } {
        if (mode !== 'tran' || flags.tranOp) throw new Error('integrate() called outside transient');
        const dt = flags.dt ?? 0;
        if (!(dt > 0)) throw new Error('integrate() with dt <= 0');
        self.integrateCalls.push({ device, q, cap, charge: self.state0[q] });
        let ag0: number;
        let i: number;
        if (method === 'trap') {
          ag0 = 2 / dt;
          i = ag0 * (self.state0[q] - self.state1[q]) - self.state1[q + 1];
        } else {
          ag0 = 1 / dt;
          i = ag0 * (self.state0[q] - self.state1[q]);
        }
        self.state0[q + 1] = i;
        return { geq: cap * ag0, i };
      },
      noncon(): void {
        noncon.flag = true;
      },
      setDevice(n: string): void {
        device = n;
      },
    };
    return ctx;
  }

  /** Assemble G and rhs of all devices (or only `only`) at the linearisation point x. */
  assemble(x: ArrayLike<number>, flags: LoadFlags = {}, only?: Device[]): Assembly {
    if (!this.isSetup) this.setup();
    const G = zeros(this.size);
    const rhs = new Array<number>(this.size).fill(0);
    const noncon = { flag: false };
    const ctx = this.loadContext(x, flags, G, rhs, noncon) as LoadContext & { setDevice(n: string): void };
    for (const d of only ?? this.devices) {
      ctx.setDevice(d.name);
      d.load(ctx);
    }
    return { G, rhs, noncon: noncon.flag };
  }

  /** Device convTest() results at x after a load. */
  convTests(x: ArrayLike<number>, flags: LoadFlags = {}): boolean {
    const G = zeros(this.size);
    const rhs = new Array<number>(this.size).fill(0);
    const ctx = this.loadContext(x, flags, G, rhs, { flag: false });
    return this.devices.every((d) => (d.convTest ? d.convTest(ctx) : true));
  }

  /**
   * Newton-Raphson solve. The first iteration uses initJunctions when `flags.initJunctions`.
   * Convergence: no limiting, |dx| <= reltol*|x| + vntol for every unknown, device convTests.
   */
  newton(flags: LoadFlags = {}, x0?: ArrayLike<number>, maxIter = 200): NewtonResult {
    if (!this.isSetup) this.setup();
    let x: Float64Array = Float64Array.from(x0 ?? this.x);
    for (let it = 1; it <= maxIter; it++) {
      const f: LoadFlags = { ...flags, initJunctions: it === 1 && (flags.initJunctions ?? false) };
      const { G, rhs, noncon } = this.assemble(x, f);
      const xn = solveReal(G, rhs);
      let small = true;
      for (let i = 0; i < xn.length; i++) {
        const tol = this.options.reltol * Math.max(Math.abs(xn[i]), Math.abs(x[i])) + this.options.vntol;
        if (Math.abs(xn[i] - x[i]) > tol) small = false;
      }
      x = xn;
      if (it > 1 && !noncon && small && !f.initJunctions && this.convTests(x, f)) {
        this.x = x;
        return { x, iterations: it, converged: true };
      }
    }
    this.x = x;
    return { x, iterations: maxIter, converged: false };
  }

  /** DC operating point from scratch (initJunctions on the first iteration). */
  op(flags: LoadFlags = {}): NewtonResult {
    return this.newton({ mode: 'op', initJunctions: true, ...flags });
  }

  /**
   * Operating point followed by fixed-step transient. Returns per-step solutions.
   * `onStep(t, x)` is called after each accepted step. Like SPICE, the first step is always
   * taken with backward Euler (the charge currents at t=0 are not known yet).
   */
  transient(
    dt: number,
    steps: number,
    method: IntegrationMethod = 'be',
    onStep?: (t: number, x: Float64Array) => void,
    opts: { uic?: boolean } = {},
  ): Float64Array[] {
    if (!this.isSetup) this.setup();
    let x: Float64Array;
    if (opts.uic) {
      x = Float64Array.from(this.x);
      this.assemble(x, { mode: 'tran', tranOp: true, uic: true, initJunctions: true });
    } else {
      const r = this.newton({ mode: 'op', tranOp: true, initJunctions: true });
      if (!r.converged) throw new Error('transient: operating point did not converge');
      x = r.x;
      // final tranOp load at the converged point so state0 holds the OP charges
      this.assemble(x, { mode: 'op', tranOp: true });
    }
    this.state1.set(this.state0);
    this.state2.set(this.state0);
    const out: Float64Array[] = [];
    let t = 0;
    for (let s = 0; s < steps; s++) {
      t += dt;
      const m: IntegrationMethod = s === 0 ? 'be' : method;
      const r = this.newton({ mode: 'tran', time: t, dt, method: m, initTimepoint: true }, x);
      if (!r.converged) throw new Error(`transient: no convergence at t=${t}`);
      x = r.x;
      out.push(x);
      onStep?.(t, x);
      this.state2.set(this.state1);
      this.state1.set(this.state0);
    }
    return out;
  }

  /** Complex AC matrix of all devices at the operating point `xop`. */
  acAssemble(xop: ArrayLike<number>, omega: number, only?: Device[], tempC?: number): { re: number[][]; im: number[][]; bre: number[]; bim: number[] } {
    const re = zeros(this.size);
    const im = zeros(this.size);
    const bre = new Array<number>(this.size).fill(0);
    const bim = new Array<number>(this.size).fill(0);
    const ctx: AcContext = {
      omega,
      temp: celsiusToKelvin(tempC ?? this.options.temp),
      options: this.options,
      op: (i: number) => (i === GROUND ? 0 : xop[i]),
      addMatrix(r: number, c: number, vr: number, vi: number): void {
        if (r === GROUND || c === GROUND) return;
        re[r][c] += vr;
        im[r][c] += vi;
      },
      addRhs(r: number, vr: number, vi: number): void {
        if (r === GROUND) return;
        bre[r] += vr;
        bim[r] += vi;
      },
      state0: this.state0,
    };
    for (const d of only ?? this.devices) d.acLoad?.(ctx);
    return { re, im, bre, bim };
  }

  /** Solve the AC system at angular frequency omega around the operating point xop. */
  acSolve(xop: ArrayLike<number>, omega: number): { re: Float64Array; im: Float64Array } {
    const a = this.acAssemble(xop, omega);
    return solveComplex(a.re, a.im, a.bre, a.bim);
  }

  noise(xop: ArrayLike<number>, tempC?: number): NoiseGenerator[] {
    const ctx: NoiseContext = {
      temp: celsiusToKelvin(tempC ?? this.options.temp),
      options: this.options,
      op: (i: number) => (i === GROUND ? 0 : xop[i]),
    };
    return this.devices.flatMap((d) => (d.noise ? d.noise(ctx) : []));
  }

  truncate(device: Device, dt: number, terrValue = 1e-9): number {
    const calls = this.terrCalls;
    const ctx: TruncContext = {
      terr(q: number): number {
        calls.push(q);
        return terrValue;
      },
      dt,
      order: 1,
    };
    return device.truncate ? device.truncate(ctx) : Infinity;
  }

  /**
   * Device terminal currents at x from its own stamps: I = G*x - rhs (row i = current leaving
   * unknown i into the device). Valid when the load does not limit (see settle()).
   */
  deviceCurrents(device: Device, x: ArrayLike<number>, flags: LoadFlags = {}): Float64Array {
    const { G, rhs } = this.assemble(x, flags, [device]);
    const I = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      let s = -rhs[i];
      for (let j = 0; j < this.size; j++) s += G[i][j] * x[j];
      I[i] = s;
    }
    return I;
  }

  /**
   * Load `device` repeatedly at x until it no longer limits its junction voltages, so the next
   * load at (or very near) x linearises exactly at x. Returns the number of loads needed.
   */
  settle(device: Device, x: ArrayLike<number>, flags: LoadFlags = {}, maxLoads = 200): number {
    for (let k = 1; k <= maxLoads; k++) {
      const { noncon } = this.assemble(x, flags, [device]);
      if (!noncon) return k;
    }
    throw new Error(`${device.name}: limiting did not settle at the requested bias`);
  }

  /**
   * Terminal currents of `device` at x (as deviceCurrents) together with, per row, the sum of
   * the magnitudes of the terms that were added up (sum_j |G_ij x_j| + |rhs_i|). The latter
   * bounds the floating-point cancellation error of the current.
   */
  private currentsWithScale(device: Device, x: ArrayLike<number>, flags: LoadFlags): { I: Float64Array; scale: Float64Array } {
    const { G, rhs } = this.assemble(x, flags, [device]);
    const I = new Float64Array(this.size);
    const scale = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      let s = -rhs[i];
      let m = Math.abs(rhs[i]);
      for (let j = 0; j < this.size; j++) {
        const t = G[i][j] * x[j];
        s += t;
        m += Math.abs(t);
      }
      I[i] = s;
      scale[i] = m;
    }
    return { I, scale };
  }

  /**
   * Compare the stamped Jacobian of `device` at x with central finite differences of its
   * terminal currents. Returns the worst relative error, measured as
   * max(0, |G - Gfd| - roundoff) / (max(|G|,|Gfd|) + floor) where floor = 1e-9 * max|G| and
   * `roundoff` = 16 * eps * (term magnitude of the row) / (2h) is the floating-point resolution
   * of the difference quotient (differences below it cannot be measured).
   * State is snapshotted and restored around every load so transient history is unchanged.
   */
  jacobianError(
    device: Device,
    x: ArrayLike<number>,
    flags: LoadFlags = {},
    h = 1e-6,
  ): { maxRel: number; worst: { row: number; col: number; stamped: number; fd: number } } {
    const s0 = Float64Array.from(this.state0);
    const restore = (): void => this.state0.set(s0);
    this.settle(device, x, flags);
    restore();
    this.settle(device, x, flags);
    const { G } = this.assemble(x, flags, [device]);
    restore();
    let gmax = 0;
    for (const row of G) for (const v of row) gmax = Math.max(gmax, Math.abs(v));
    const floor = 1e-9 * gmax;
    let maxRel = 0;
    let worst = { row: -1, col: -1, stamped: 0, fd: 0 };
    for (let j = 0; j < this.size; j++) {
      const xp = Float64Array.from(x);
      const xm = Float64Array.from(x);
      xp[j] += h;
      xm[j] -= h;
      this.settle(device, xp, flags);
      const P = this.currentsWithScale(device, xp, flags);
      restore();
      this.settle(device, xm, flags);
      const M = this.currentsWithScale(device, xm, flags);
      restore();
      for (let i = 0; i < this.size; i++) {
        const fd = (P.I[i] - M.I[i]) / (2 * h);
        const roundoff = (16 * Number.EPSILON * Math.max(P.scale[i], M.scale[i])) / (2 * h);
        const diff = Math.max(0, Math.abs(G[i][j] - fd) - roundoff);
        const err = diff / (Math.max(Math.abs(G[i][j]), Math.abs(fd)) + floor);
        if (err > maxRel) {
          maxRel = err;
          worst = { row: i, col: j, stamped: G[i][j], fd };
        }
      }
    }
    return { maxRel, worst };
  }

  /** Human-readable label of an unknown (node name or branch:label). */
  label(i: number): string {
    return this.labels[i] ?? `#${i}`;
  }
}
