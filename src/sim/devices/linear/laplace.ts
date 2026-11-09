/**
 * LAPLACE controlled sources: E (voltage output) or G (current output) elements carrying
 * ElementIR.laplace = { num, den }, the transfer function H(s) = num(s)/den(s) (ascending powers,
 * den monic) from the controlling voltage u = gain-free V(nc+, nc-) (the parser folds input gains
 * into num).
 *
 * Realisation: frequency-scaled controllable canonical form. With w0 = |den[0]|^(1/n) (1 when
 * den[0] = 0) and s = w0 p, H(p) = b(p)/(p^n + a_{n-1} p^{n-1} + ... + a_0), so the n states
 * (internal nodes "<name>#x1".."#xn") stay of the order of the input:
 *   dx_i/dt = w0 x_{i+1}  (i < n),     dx_n/dt = w0 (u - sum_k a_k x_{k+1})
 *   y = sum_k (b_k - b_n a_k) x_{k+1} + b_n u
 * Each state row is a charge q = x/w0 integrated by the engine (so truncation-error control and
 * Gear / trapezoidal integration apply as for capacitors). In DC the derivatives vanish: x_1 = u/a_0,
 * the other states are 0 and y = H(0) u. AC uses the same rows with jw.
 * E: branch unknown with V(n+) - V(n-) = y; G: current y from n+ through the source to n-.
 * A transform of degree 0 is a plain gain.
 *
 * Outputs: I (output current from n+ to n- through the source).
 */
import type { AcContext, Device, LoadContext, SetupContext, TruncContext } from '../../device';
import type { ElementIR, ElementType } from '../../netlist';
import { SimulationError } from '../../results';
import { requireNodes } from './common';

export class LaplaceSource implements Device {
  readonly type: ElementType;
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;
  private readonly n: number;
  private readonly w0: number;
  /** normalised denominator a_0..a_{n-1} */
  private readonly a: number[];
  /** state output weights c_k = b_k - b_n a_k and direct feed-through d = b_n */
  private readonly c: number[];
  private readonly d: number;
  private pOut = -1;
  private nOut = -1;
  private pIn = -1;
  private nIn = -1;
  private br = -1;
  private x: number[] = [];
  private st = 0;

  constructor(el: ElementIR) {
    requireNodes(el, 4);
    if (!el.laplace) throw new SimulationError(`${el.name}: missing LAPLACE transfer function`, 'netlist');
    this.type = el.type;
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
    const gain = el.value ?? 1;
    const num = el.laplace.num.map((v) => v * gain);
    const den = el.laplace.den;
    const n = den.length - 1;
    if (n < 0 || !(den[n] !== 0)) throw new SimulationError(`${el.name}: invalid LAPLACE denominator`, 'netlist');
    if (num.length > den.length) throw new SimulationError(`${el.name}: LAPLACE transform is not proper`, 'netlist');
    const lead = den[n];
    const dn = den.map((v) => v / lead);
    const nn = num.map((v) => v / lead);
    this.n = n;
    this.w0 = n > 0 && dn[0] !== 0 ? Math.pow(Math.abs(dn[0]), 1 / n) : 1;
    const w = this.w0;
    // s = w p: coefficient of p^k is coef_k w^k; divide by w^n to make the leading 1
    this.a = Array.from({ length: n }, (_, k) => dn[k] * Math.pow(w, k - n));
    const b = Array.from({ length: n + 1 }, (_, k) => (nn[k] ?? 0) * Math.pow(w, k - n));
    this.d = b[n];
    this.c = Array.from({ length: n }, (_, k) => b[k] - b[n] * this.a[k]);
  }

  setup(ctx: SetupContext): void {
    this.pOut = ctx.node(this.nodeNames[0]);
    this.nOut = ctx.node(this.nodeNames[1]);
    this.pIn = ctx.node(this.nodeNames[2]);
    this.nIn = ctx.node(this.nodeNames[3]);
    this.x = Array.from({ length: this.n }, (_, i) => ctx.node(`${this.name}#x${i + 1}`));
    if (this.type === 'E') this.br = ctx.branch(`${this.name}#i`);
    this.st = ctx.state(2 * Math.max(1, this.n));
  }

  /** Stamp the output y = sum c_k x_k + d u (E: branch row, G: current). */
  private stampOutput(add: (r: number, c: number, v: number) => void): void {
    const { pOut, nOut, pIn, nIn } = this;
    if (this.type === 'E') {
      const br = this.br;
      add(pOut, br, 1);
      add(nOut, br, -1);
      add(br, pOut, 1);
      add(br, nOut, -1);
      this.x.forEach((xi, k) => add(br, xi, -this.c[k]));
      add(br, pIn, -this.d);
      add(br, nIn, this.d);
    } else {
      this.x.forEach((xi, k) => {
        add(pOut, xi, this.c[k]);
        add(nOut, xi, -this.c[k]);
      });
      add(pOut, pIn, this.d);
      add(pOut, nIn, -this.d);
      add(nOut, pIn, -this.d);
      add(nOut, nIn, this.d);
    }
  }

  /** State rows without the derivative terms: -w0 x_{i+1}, and w0 (sum a_k x_k - u) for the last. */
  private stampStates(add: (r: number, c: number, v: number) => void): void {
    const n = this.n;
    const w = this.w0;
    for (let i = 0; i < n; i++) {
      const xi = this.x[i];
      if (i < n - 1) add(xi, this.x[i + 1], -w);
      else {
        this.x.forEach((xk, k) => add(xi, xk, w * this.a[k]));
        add(xi, this.pIn, -w);
        add(xi, this.nIn, w);
      }
    }
  }

  load(ctx: LoadContext): void {
    const add = (r: number, c: number, v: number) => ctx.addMatrix(r, c, v);
    this.stampOutput(add);
    this.stampStates(add);
    const tran = ctx.mode === 'tran';
    for (let i = 0; i < this.n; i++) {
      const xi = this.x[i];
      const slot = this.st + 2 * i;
      // q = x (the w0 scaling is in the other terms of the row)
      ctx.state0[slot] = ctx.x(xi);
      if (!tran || ctx.tranOp) {
        ctx.state0[slot + 1] = 0;
        continue;
      }
      const r = ctx.integrate(slot, 1);
      ctx.addMatrix(xi, xi, r.geq);
      ctx.addRhs(xi, -(r.i - r.geq * ctx.x(xi)));
    }
  }

  acLoad(ctx: AcContext): void {
    const add = (r: number, c: number, v: number) => ctx.addMatrix(r, c, v, 0);
    this.stampOutput(add);
    this.stampStates(add);
    for (const xi of this.x) ctx.addMatrix(xi, xi, 0, ctx.omega);
  }

  truncate(ctx: TruncContext): number {
    let dt = Infinity;
    for (let i = 0; i < this.n; i++) dt = Math.min(dt, ctx.terr(this.st + 2 * i));
    return dt;
  }

  branchIndex(): number {
    return this.br;
  }

  outputs(x: (i: number) => number): Record<string, number> {
    if (this.type === 'E') return { I: x(this.br) };
    let y = this.d * (x(this.pIn) - x(this.nIn));
    this.x.forEach((xi, k) => (y += this.c[k] * x(xi)));
    return { I: y };
  }

  /** Coefficients of the realisation (tests / diagnostics). */
  get realisation(): { w0: number; a: number[]; c: number[]; d: number } {
    return { w0: this.w0, a: [...this.a], c: [...this.c], d: this.d };
  }
}

export const createLaplaceSource = (el: ElementIR): Device => new LaplaceSource(el);
