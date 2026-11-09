/**
 * Behavioral source (B element), registered for ElementType 'B'.
 *
 * IR: nodes [n+, n-], expr "V=<expression>" or "I=<expression>" (case-insensitive kind). The
 * expression language is src/sim/spice/expr.ts: node voltages V(a) / V(a,b), branch currents
 * I(Vx) of devices that own a branch unknown (V sources, inductors, E, H, V-type B sources),
 * runtime variables time [s], temper [°C] and hertz [Hz], constants and built-in functions.
 * flattenNetlist() has already folded .param values and inlined .func calls; an expression that
 * still names an unknown parameter is reported as a netlist error.
 *
 * V=expr  behaves like a voltage source: owns a branch unknown (vector "I(B1)", SPICE sign:
 *         positive when current flows into n+ from the circuit, through the source, out of n-),
 *         branch equation v(n+) - v(n-) = f(x).
 * I=expr  is a current f(x) flowing from n+ through the device to n- (like an I source).
 *
 * Newton linearisation at the iterate x0 with gradient g_k = ∂f/∂s_k (forward-mode AD):
 *   f(x) ≈ f0 + Σ g_k (s_k - s_k0) = Σ g_k s_k + c,   c = f0 - Σ g_k s_k0
 *   I:  G[n+, s_k] += g_k, G[n-, s_k] -= g_k;  rhs[n+] -= c, rhs[n-] += c
 *   V:  branch incidence (±1), G[br, s_k] -= g_k;  rhs[br] += c
 * AC: the same Jacobian at the operating point (no AC excitation of its own).
 *
 * An expression without circuit quantities (constant, or a function of time / temper only) acts
 * as an independent source and is scaled by the engine's source-stepping factor. The device
 * reports `linear` (single factorisation fast path) when the expression is affine in its
 * signals. Non-finite values or derivatives are clamped to ±1e30 and force another Newton
 * iteration. convTest() checks the linearisation error like SPICE's ASRC device.
 *
 * Outputs: I (current from n+ to n- through the device; for V= the branch current) and
 * P = v(n+, n-) * I (absorbed power).
 */
import { GROUND, KELVIN, type AcContext, type BindContext, type Device, type DeviceFactoryTable, type LoadContext, type SetupContext } from '../device';
import type { ElementIR, ElementType } from '../netlist';
import { SimulationError } from '../results';
import { compileExpression, parseExpression, signalName, type CompiledExpression, type ExprNode } from '../spice/expr';
import type { ComplexReader, EngineDeviceExtensions } from '../engine/hooks';

export type BehavioralKind = 'V' | 'I';

/** Split "V=<expr>" / "I=<expr>" (any case, spaces allowed). Undefined when malformed. */
export function parseBehavioralExpr(expr: string | undefined): { kind: BehavioralKind; body: string } | undefined {
  const m = /^\s*([VvIi])\s*=([\s\S]*)$/.exec(expr ?? '');
  if (!m || m[2].trim() === '') return undefined;
  return { kind: m[1].toUpperCase() as BehavioralKind, body: m[2].trim() };
}

const LIMIT = 1e30;
const TWO_PI = 2 * Math.PI;

function dependsOnSignals(node: ExprNode): boolean {
  switch (node.kind) {
    case 'v':
    case 'i':
      return true;
    case 'num':
    case 'ident':
      return false;
    case 'unary':
      return dependsOnSignals(node.arg);
    case 'binary':
      return dependsOnSignals(node.left) || dependsOnSignals(node.right);
    case 'cond':
      return dependsOnSignals(node.test) || dependsOnSignals(node.then) || dependsOnSignals(node.otherwise);
    case 'call':
      return node.args.some(dependsOnSignals);
  }
}

/** True when the expression is affine in its V()/I() signals (coefficients may depend on time). */
export function isAffineInSignals(node: ExprNode): boolean {
  switch (node.kind) {
    case 'num':
    case 'ident':
    case 'v':
    case 'i':
      return true;
    case 'unary':
      return node.op === '!' ? !dependsOnSignals(node.arg) : isAffineInSignals(node.arg);
    case 'binary':
      switch (node.op) {
        case '+':
        case '-':
          return isAffineInSignals(node.left) && isAffineInSignals(node.right);
        case '*':
          return (
            (!dependsOnSignals(node.left) && isAffineInSignals(node.right)) ||
            (!dependsOnSignals(node.right) && isAffineInSignals(node.left))
          );
        case '/':
          return isAffineInSignals(node.left) && !dependsOnSignals(node.right);
        default:
          return !dependsOnSignals(node);
      }
    case 'cond':
      return !dependsOnSignals(node.test) && isAffineInSignals(node.then) && isAffineInSignals(node.otherwise);
    case 'call':
      return !dependsOnSignals(node);
  }
}

function clamp(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v > LIMIT ? LIMIT : v < -LIMIT ? -LIMIT : v;
}

export class BehavioralSource implements Device, EngineDeviceExtensions {
  readonly type: ElementType = 'B';
  readonly name: string;
  readonly nodeNames: string[];
  readonly kind: BehavioralKind;
  readonly linear: boolean;
  /** Resolved expression text (diagnostics). */
  readonly source: string;

  private readonly fn: CompiledExpression;
  private readonly line?: number;
  private readonly independent: boolean;
  private p = GROUND;
  private n = GROUND;
  private br = -1;
  /** unknown index of every expression signal (same order as fn.signals) */
  private readonly sigIdx: Int32Array;
  private readonly sig: Float64Array;
  private readonly grad: Float64Array;
  private readonly vars = { time: 0, temper: 27, hertz: 0 };
  /** linearisation used by the last load (for convTest) */
  private lastF = 0;
  private readonly lastSig: Float64Array;
  private readonly lastGrad: Float64Array;
  private loaded = false;
  /** Jacobian at the operating point used by the last acLoad (for acOutputs) */
  private readonly acGrad: Float64Array;

  constructor(el: ElementIR) {
    this.name = el.name;
    this.line = el.line;
    if (el.nodes.length < 2) throw this.error(`expected 2 nodes, got ${el.nodes.length}`);
    this.nodeNames = el.nodes.slice(0, 2);
    const parsed = parseBehavioralExpr(el.expr);
    if (!parsed) throw this.error(`behavioral expression must be 'V=<expr>' or 'I=<expr>' (got '${el.expr ?? ''}')`);
    this.kind = parsed.kind;
    try {
      this.fn = compileExpression(parsed.body);
    } catch (e) {
      throw this.error(`${parsed.kind}=${parsed.body}: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.source = `${this.kind}=${this.fn.source}`;
    const count = this.fn.signals.length;
    this.independent = count === 0;
    this.linear = count === 0 || isAffineInSignals(parseExpression(this.fn.source));
    this.sigIdx = new Int32Array(count).fill(GROUND);
    this.sig = new Float64Array(count);
    this.grad = new Float64Array(count);
    this.lastSig = new Float64Array(count);
    this.lastGrad = new Float64Array(count);
    this.acGrad = new Float64Array(count);
  }

  private error(message: string): SimulationError {
    return new SimulationError(`${this.name}: ${message}`, 'netlist', this.line !== undefined ? `line ${this.line}` : undefined);
  }

  setup(ctx: SetupContext): void {
    this.p = ctx.node(this.nodeNames[0]);
    this.n = ctx.node(this.nodeNames[1]);
    if (this.kind === 'V') this.br = ctx.branch(this.name);
    this.fn.signals.forEach((s, k) => {
      if (s.kind === 'v') this.sigIdx[k] = ctx.node(s.node);
    });
  }

  bind(ctx: BindContext): void {
    this.fn.signals.forEach((s, k) => {
      if (s.kind !== 'i') return;
      const d = ctx.findDevice(s.device);
      if (!d) throw this.error(`${signalName(s)}: element '${s.device}' not found`);
      const br = d.branchIndex ? d.branchIndex() : -1;
      if (!(br >= 0)) throw this.error(`${signalName(s)}: '${d.name}' has no branch current (use a voltage source, inductor, E, H or V= B source)`);
      this.sigIdx[k] = br;
    });
  }

  branchIndex(): number {
    return this.br;
  }

  /** Load signal values through `read`, then evaluate value and gradient. */
  private evaluate(read: (i: number) => number): number {
    for (let k = 0; k < this.sigIdx.length; k++) {
      const idx = this.sigIdx[k];
      this.sig[k] = idx === GROUND ? 0 : read(idx);
    }
    return this.fn.valueAndGradient(this.sig, this.grad, this.vars);
  }

  load(ctx: LoadContext): void {
    this.vars.time = ctx.time;
    this.vars.temper = ctx.temp - KELVIN;
    this.vars.hertz = 0;
    let f = this.evaluate((i) => ctx.x(i));
    if (this.independent) f *= ctx.srcFact;
    let clamped = !Number.isFinite(f);
    f = clamp(f);
    let c = f;
    for (let k = 0; k < this.grad.length; k++) {
      let g = this.grad[k];
      if (!Number.isFinite(g)) {
        clamped = true;
        g = clamp(g);
        this.grad[k] = g;
      }
      c -= g * this.sig[k];
    }
    if (clamped) ctx.noncon();

    if (this.kind === 'I') {
      for (let k = 0; k < this.grad.length; k++) {
        const g = this.grad[k];
        if (g === 0) continue;
        ctx.addMatrix(this.p, this.sigIdx[k], g);
        ctx.addMatrix(this.n, this.sigIdx[k], -g);
      }
      ctx.addRhs(this.p, -c);
      ctx.addRhs(this.n, c);
    } else {
      const br = this.br;
      ctx.addMatrix(this.p, br, 1);
      ctx.addMatrix(this.n, br, -1);
      ctx.addMatrix(br, this.p, 1);
      ctx.addMatrix(br, this.n, -1);
      for (let k = 0; k < this.grad.length; k++) {
        const g = this.grad[k];
        if (g !== 0) ctx.addMatrix(br, this.sigIdx[k], -g);
      }
      ctx.addRhs(br, c);
    }
    this.lastF = f;
    this.lastSig.set(this.sig);
    this.lastGrad.set(this.grad);
    this.loaded = true;
  }

  convTest(ctx: LoadContext): boolean {
    if (!this.loaded || this.independent) return true;
    this.vars.time = ctx.time;
    this.vars.temper = ctx.temp - KELVIN;
    const now = clamp(this.evaluate((i) => ctx.x(i)));
    let predicted = this.lastF;
    for (let k = 0; k < this.sig.length; k++) predicted += this.lastGrad[k] * (this.sig[k] - this.lastSig[k]);
    const tol = ctx.options.reltol * Math.max(Math.abs(now), Math.abs(predicted)) + (this.kind === 'I' ? ctx.options.abstol : ctx.options.vntol);
    return Math.abs(now - predicted) <= tol;
  }

  acLoad(ctx: AcContext): void {
    this.vars.time = 0;
    this.vars.temper = ctx.temp - KELVIN;
    this.vars.hertz = ctx.omega / TWO_PI;
    this.evaluate((i) => ctx.op(i));
    for (let k = 0; k < this.grad.length; k++) this.acGrad[k] = clamp(this.grad[k]);
    if (this.kind === 'I') {
      for (let k = 0; k < this.acGrad.length; k++) {
        const g = this.acGrad[k];
        if (g === 0) continue;
        ctx.addMatrix(this.p, this.sigIdx[k], g, 0);
        ctx.addMatrix(this.n, this.sigIdx[k], -g, 0);
      }
    } else {
      const br = this.br;
      ctx.addMatrix(this.p, br, 1, 0);
      ctx.addMatrix(this.n, br, -1, 0);
      ctx.addMatrix(br, this.p, 1, 0);
      ctx.addMatrix(br, this.n, -1, 0);
      for (let k = 0; k < this.acGrad.length; k++) {
        const g = this.acGrad[k];
        if (g !== 0) ctx.addMatrix(br, this.sigIdx[k], -g, 0);
      }
    }
  }

  outputs(x: (i: number) => number): Record<string, number> {
    const read = (i: number) => (i === GROUND ? 0 : x(i));
    const v = read(this.p) - read(this.n);
    const i = this.kind === 'V' ? read(this.br) : clamp(this.evaluate(read));
    return { I: i, P: v * i };
  }

  acOutputs(x: ComplexReader): Record<string, { re: number; im: number }> {
    if (this.kind === 'V') {
      const c = x(this.br);
      return { I: { re: c.re, im: c.im } };
    }
    let re = 0;
    let im = 0;
    for (let k = 0; k < this.acGrad.length; k++) {
      const idx = this.sigIdx[k];
      if (idx === GROUND || this.acGrad[k] === 0) continue;
      const s = x(idx);
      re += this.acGrad[k] * s.re;
      im += this.acGrad[k] * s.im;
    }
    return { I: { re, im } };
  }
}

export const createBehavioralSource = (el: ElementIR): Device => new BehavioralSource(el);

/** Device factories of this module: B (behavioral sources). */
export const behavioralFactories: DeviceFactoryTable = { B: createBehavioralSource };
