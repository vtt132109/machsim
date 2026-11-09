import { describe, expect, it } from 'vitest';
import { BehavioralSource, behavioralFactories, isAffineInSignals, parseBehavioralExpr } from './behavioral';
import { GROUND, KELVIN, type AcContext, type BindContext, type Device, type LoadContext, type SetupContext } from '../device';
import { DEFAULT_OPTIONS, type ElementIR } from '../netlist';
import { parseExpression } from '../spice/expr';
import { parseSpice } from '../spice/parser';
import { runAnalyses } from '../engine/run';
import { findVector, type AnalysisResult } from '../results';

// ---------------------------------------------------------------------------------------------
// Mock engine contexts
// ---------------------------------------------------------------------------------------------

class MockSetup implements SetupContext {
  readonly nodes = new Map<string, number>();
  readonly branches: string[] = [];
  readonly options = DEFAULT_OPTIONS;
  readonly warnings: string[] = [];
  constructor(names: string[]) {
    names.forEach((n, i) => this.nodes.set(n, i));
  }
  node(name: string): number {
    if (name === '0' || name.toLowerCase() === 'gnd') return GROUND;
    const idx = this.nodes.get(name);
    if (idx === undefined) throw new Error(`unexpected node ${name}`);
    return idx;
  }
  branch(label: string): number {
    this.branches.push(label);
    return this.nodes.size + this.branches.length - 1;
  }
  state(): number {
    return 0;
  }
  model() {
    return undefined;
  }
  warn(message: string): void {
    this.warnings.push(message);
  }
}

class MockLoad implements LoadContext {
  mode: 'op' | 'dc' | 'tran' = 'op';
  initJunctions = false;
  initTimepoint = false;
  tranOp = false;
  uic = false;
  time = 0;
  dt = 0;
  method = 'trap' as const;
  gmin = 1e-12;
  srcFact = 1;
  temp = 27 + KELVIN;
  options = DEFAULT_OPTIONS;
  state0 = new Float64Array(0);
  state1 = new Float64Array(0);
  state2 = new Float64Array(0);
  readonly G = new Map<string, number>();
  readonly rhs = new Map<number, number>();
  nonconCount = 0;
  constructor(public xv: number[]) {}
  x(i: number): number {
    return i === GROUND ? 0 : this.xv[i];
  }
  addMatrix(r: number, c: number, v: number): void {
    if (r === GROUND || c === GROUND) return;
    const k = `${r},${c}`;
    this.G.set(k, (this.G.get(k) ?? 0) + v);
  }
  addRhs(r: number, v: number): void {
    if (r === GROUND) return;
    this.rhs.set(r, (this.rhs.get(r) ?? 0) + v);
  }
  integrate(): { geq: number; i: number } {
    throw new Error('not used');
  }
  noncon(): void {
    this.nonconCount++;
  }
  g(r: number, c: number): number {
    return this.G.get(`${r},${c}`) ?? 0;
  }
  b(r: number): number {
    return this.rhs.get(r) ?? 0;
  }
  /** Σ_j G[r][j] x_j - rhs[r]: the device's contribution to equation r at x. */
  residual(r: number, size: number): number {
    let s = -this.b(r);
    for (let j = 0; j < size; j++) s += this.g(r, j) * this.xv[j];
    return s;
  }
}

class MockAc implements AcContext {
  readonly G = new Map<string, [number, number]>();
  readonly options = DEFAULT_OPTIONS;
  readonly state0 = new Float64Array(0);
  temp = 27 + KELVIN;
  constructor(
    public omega: number,
    private readonly opv: number[],
  ) {}
  op(i: number): number {
    return i === GROUND ? 0 : this.opv[i];
  }
  addMatrix(r: number, c: number, re: number, im: number): void {
    if (r === GROUND || c === GROUND) return;
    const k = `${r},${c}`;
    const v = this.G.get(k) ?? [0, 0];
    this.G.set(k, [v[0] + re, v[1] + im]);
  }
  addRhs(): void {
    throw new Error('a behavioral source has no AC excitation');
  }
}

/** A device exposing a branch unknown, as the controlling source of I(...) references. */
function branchDevice(name: string, br: number): Device {
  return { name, type: 'V', nodeNames: [], setup() {}, load() {}, branchIndex: () => br };
}

function bindCtx(devices: Device[]): BindContext {
  return {
    findDevice: (n) => devices.find((d) => d.name.toLowerCase() === n.toLowerCase()),
    warn: () => {},
  };
}

function bsrc(name: string, nodes: string[], expr: string): ElementIR {
  return { type: 'B', name, nodes, params: {}, expr };
}

// Unknowns for the stamp tests: a=0, b=1, out=2, then Vx branch = 3, own branch (V type) = 4.
const NODES = ['a', 'b', 'out'];
const VX_BRANCH = 3;

function build(expr: string, nodes = ['out', '0']): { dev: BehavioralSource; setup: MockSetup } {
  const dev = new BehavioralSource(bsrc('B1', nodes, expr));
  const setup = new MockSetup(NODES);
  setup.branches.push('Vx'); // the controlling source's branch occupies index 3
  dev.setup(setup);
  const self = dev as Device;
  dev.bind(bindCtx([branchDevice('Vx', VX_BRANCH), self]));
  return { dev, setup };
}

describe('expression handling', () => {
  it('splits the kind from the expression', () => {
    expect(parseBehavioralExpr('V=V(a)*2')).toEqual({ kind: 'V', body: 'V(a)*2' });
    expect(parseBehavioralExpr(' i = 1m ')).toEqual({ kind: 'I', body: '1m' });
    expect(parseBehavioralExpr('X=1')).toBeUndefined();
    expect(parseBehavioralExpr('V=')).toBeUndefined();
    expect(parseBehavioralExpr(undefined)).toBeUndefined();
  });

  it('detects expressions that are affine in their signals', () => {
    const affine = ['V(a)*2 + 1', '-V(a) + V(b)/4', '3*(V(a) - I(V1)) * sin(time)', 'time > 1 ? V(a) : 2*V(a)', '5', 'temper*V(a)'];
    const nonlinear = ['V(a)^2', 'V(a)*V(b)', '1/V(a)', 'abs(V(a))', 'V(a) > 1 ? 1 : 0', 'V(a) > 0 ? V(a) : 0'];
    for (const t of affine) expect(isAffineInSignals(parseExpression(t))).toBe(true);
    for (const t of nonlinear) expect(isAffineInSignals(parseExpression(t))).toBe(false);
    expect(new BehavioralSource(bsrc('B1', ['a', '0'], 'V=V(b)*2')).linear).toBe(true);
    expect(new BehavioralSource(bsrc('B1', ['a', '0'], 'I=V(b)^2')).linear).toBe(false);
    expect(new BehavioralSource(bsrc('B1', ['a', '0'], 'V=sin(time)')).linear).toBe(true);
  });

  it('rejects malformed elements with netlist errors', () => {
    expect(() => new BehavioralSource(bsrc('B1', ['a', '0'], 'Q=1'))).toThrow(/must be 'V=<expr>'/);
    expect(() => new BehavioralSource(bsrc('B1', ['a'], 'V=1'))).toThrow(/expected 2 nodes/);
    expect(() => new BehavioralSource(bsrc('B1', ['a', '0'], 'V=k*2'))).toThrow(/undefined parameter 'k'/);
    expect(() => new BehavioralSource(bsrc('B1', ['a', '0'], 'V=V(a'))).toThrow(/B1/);
    expect(behavioralFactories.B?.(bsrc('B9', ['a', '0'], 'I=1'))).toBeInstanceOf(BehavioralSource);
  });

  it('resolves I() references at bind time', () => {
    const dev = new BehavioralSource(bsrc('B1', ['out', '0'], 'V=I(Vx)*1k'));
    dev.setup(new MockSetup(NODES));
    expect(() => dev.bind(bindCtx([]))).toThrow(/element 'Vx' not found/);
    const noBranch: Device = { name: 'Vx', type: 'R', nodeNames: [], setup() {}, load() {} };
    expect(() => dev.bind(bindCtx([noBranch]))).toThrow(/has no branch current/);
    const ib = new BehavioralSource(bsrc('B2', ['out', '0'], 'I=I(B2)'));
    ib.setup(new MockSetup(NODES));
    expect(() => ib.bind(bindCtx([ib]))).toThrow(/has no branch current/);
  });
});

describe('real stamps', () => {
  const x0 = [0.7, -0.4, 1.3, 2e-3, 0.05];
  const SIZE = 5;

  it('stamps an I= source so that the residual equals the current and the Jacobian its derivatives', () => {
    const expr = 'I=1m*V(a)^2 + V(b)*I(Vx) + 0.1*V(out)*V(a)';
    const f = (x: number[]) => 1e-3 * x[0] ** 2 + x[1] * x[3] + 0.1 * x[2] * x[0];
    const { dev, setup } = build(expr, ['out', 'b']);
    expect(setup.branches).toEqual(['Vx']);
    expect(dev.branchIndex()).toBe(-1);
    const ctx = new MockLoad(x0);
    dev.load(ctx);
    const p = 2;
    const n = 1;
    expect(ctx.residual(p, SIZE)).toBeCloseTo(f(x0), 14);
    expect(ctx.residual(n, SIZE)).toBeCloseTo(-f(x0), 14);
    for (let j = 0; j < SIZE; j++) {
      const h = 1e-6;
      const xp = [...x0];
      const xm = [...x0];
      xp[j] += h;
      xm[j] -= h;
      const fd = (f(xp) - f(xm)) / (2 * h);
      expect(ctx.g(p, j)).toBeCloseTo(fd, 8);
      expect(ctx.g(n, j)).toBeCloseTo(-fd, 8);
    }
    expect(ctx.g(4, 0)).toBe(0);
    expect(dev.outputs((i) => x0[i])).toEqual({ I: f(x0), P: (x0[2] - x0[1]) * f(x0) });
  });

  it('stamps a V= source as a branch equation v(n+) - v(n-) = f(x)', () => {
    const expr = 'V=2*V(a) - V(b)^3 + 1k*I(Vx)';
    const f = (x: number[]) => 2 * x[0] - x[1] ** 3 + 1e3 * x[3];
    const { dev, setup } = build(expr, ['out', 'a']);
    expect(setup.branches).toEqual(['Vx', 'B1']);
    const br = dev.branchIndex();
    expect(br).toBe(4);
    const ctx = new MockLoad(x0);
    dev.load(ctx);
    // KCL incidence of the branch current
    expect(ctx.g(2, br)).toBe(1); // n+ = out
    expect(ctx.g(0, br)).toBe(-1); // n- = a
    // branch row residual: v(out) - v(a) - f(x0)
    expect(ctx.residual(br, SIZE)).toBeCloseTo(x0[2] - x0[0] - f(x0), 13);
    // Jacobian of the branch row = d/dx [v(out) - v(a) - f(x)]
    const row = (x: number[]) => x[2] - x[0] - f(x);
    for (let j = 0; j < SIZE; j++) {
      const h = 1e-6;
      const xp = [...x0];
      const xm = [...x0];
      xp[j] += h;
      xm[j] -= h;
      expect(ctx.g(br, j)).toBeCloseTo((row(xp) - row(xm)) / (2 * h), 7);
    }
    expect(ctx.b(2)).toBe(0);
    expect(dev.outputs((i) => x0[i])).toEqual({ I: x0[4], P: (x0[2] - x0[0]) * x0[4] });
  });

  it('scales signal-free sources by srcFact and uses time and temper', () => {
    const { dev } = build('V=2 + temper/27*time');
    const ctx = new MockLoad(x0);
    ctx.time = 3;
    ctx.temp = 54 + KELVIN;
    ctx.srcFact = 0.5;
    dev.load(ctx);
    expect(ctx.b(dev.branchIndex())).toBeCloseTo(0.5 * (2 + 2 * 3), 13);
    const i = build('I=4m').dev;
    const c2 = new MockLoad(x0);
    c2.srcFact = 0.25;
    i.load(c2);
    expect(c2.b(2)).toBeCloseTo(-1e-3, 18);
    // dependent sources are not scaled
    const d = build('I=V(a)').dev;
    const c3 = new MockLoad(x0);
    c3.srcFact = 0.5;
    d.load(c3);
    expect(c3.g(2, 0)).toBe(1);
    expect(c3.b(2)).toBe(0);
  });

  it('clamps overflowing values and requests another iteration', () => {
    const { dev } = build('I=exp(V(a))');
    const ctx = new MockLoad([1000, 0, 0, 0, 0]);
    dev.load(ctx);
    expect(ctx.nonconCount).toBe(1);
    expect(Number.isFinite(ctx.g(2, 0))).toBe(true);
    expect(ctx.g(2, 0)).toBe(1e30);
    for (const v of ctx.rhs.values()) expect(Number.isFinite(v)).toBe(true);
  });

  it('checks convergence of the linearisation', () => {
    const { dev } = build('I=V(a)^2');
    const ctx = new MockLoad([1, 0, 0, 0, 0]);
    dev.load(ctx);
    expect(dev.convTest(ctx)).toBe(true);
    ctx.xv = [1.1, 0, 0, 0, 0];
    expect(dev.convTest(ctx)).toBe(false); // f = 1.21, linear prediction 1.2
    ctx.xv = [1 + 1e-6, 0, 0, 0, 0];
    expect(dev.convTest(ctx)).toBe(true);
    const lin = build('I=3*V(a)').dev;
    const c2 = new MockLoad([1, 0, 0, 0, 0]);
    lin.load(c2);
    c2.xv = [5, 0, 0, 0, 0];
    expect(lin.convTest(c2)).toBe(true);
  });
});

describe('small-signal stamps', () => {
  it('stamps the operating-point Jacobian', () => {
    const op = [0.5, 2, 0, 1e-3, 0];
    const i = build('I=V(a)^2*V(b) + hertz*0').dev;
    const ac = new MockAc(2 * Math.PI * 1e3, op);
    i.acLoad(ac);
    expect(ac.G.get('2,0')).toEqual([2 * 0.5 * 2, 0]);
    expect(ac.G.get('2,1')).toEqual([0.25, 0]);
    const out = i.acOutputs?.((k) => ({ re: [1, 2, 0, 0, 0][k], im: [0, 1, 0, 0, 0][k] }));
    expect(out).toEqual({ I: { re: 2 * 1 + 0.25 * 2, im: 0.25 } });

    const v = build('V=10*V(a) + I(Vx)').dev;
    const ac2 = new MockAc(1, op);
    v.acLoad(ac2);
    const br = v.branchIndex();
    expect(ac2.G.get(`2,${br}`)).toEqual([1, 0]);
    expect(ac2.G.get(`${br},2`)).toEqual([1, 0]);
    expect(ac2.G.get(`${br},0`)).toEqual([-10, 0]);
    expect(ac2.G.get(`${br},${VX_BRANCH}`)).toEqual([-1, 0]);
  });
});

describe('in the simulator', () => {
  function opScalars(text: string): Record<string, number> {
    const parsed = parseSpice(text);
    expect(parsed.errors).toEqual([]);
    const [r] = runAnalyses(parsed.netlist);
    if (r.error) throw new Error(r.error);
    return r.scalars ?? {};
  }

  function run(text: string): AnalysisResult[] {
    const parsed = parseSpice(text);
    expect(parsed.errors).toEqual([]);
    const results = runAnalyses(parsed.netlist);
    for (const r of results) if (r.error) throw new Error(r.error);
    return results;
  }

  it('solves a nonlinear voltage-controlled current source', () => {
    // (5 - v)/1k = 1m * v^2  ->  v^2 + v - 5 = 0
    const s = opScalars('t\nVs 1 0 5\nR1 1 2 1k\nB1 2 0 I=1m*V(2)^2\n.op\n');
    expect(s['V(2)']).toBeCloseTo((-1 + Math.sqrt(21)) / 2, 6);
    expect(s['I(B1)']).toBeCloseTo(1e-3 * ((-1 + Math.sqrt(21)) / 2) ** 2, 9);
  });

  it('solves V= sources, I() references and converted E/G VALUE sources', () => {
    const s = opScalars(
      [
        't',
        'Vin in 0 2',
        'Bsq out 0 V=V(in)^2',
        'R1 out 0 1k',
        'Vs in m 0',
        'Rm m 0 2k',
        'Bi x 0 V=I(Vs)*1k',
        'Rx x 0 1meg',
        'G1 0 g VALUE={V(in)*1m}',
        'Rg g 0 1k',
        'E1 e 0 VALUE={limit(V(in)*10, -5, 5)}',
        'Re e 0 1k',
        '.op',
      ].join('\n'),
    );
    expect(s['V(out)']).toBeCloseTo(4, 9);
    expect(s['I(Bsq)']).toBeCloseTo(-4e-3, 9);
    expect(s['V(x)']).toBeCloseTo(1, 9);
    expect(s['V(g)']).toBeCloseTo(2, 9);
    expect(s['V(e)']).toBeCloseTo(5, 9);
  });

  it('works inside flattened subcircuits with parameters', () => {
    const s = opScalars(
      [
        't',
        '.param k=3',
        '.subckt gainblk in out params: g=2',
        'B1 out 0 V={g*k*V(in)}',
        '.ends',
        'V1 1 0 0.5',
        'X1 1 2 gainblk g=4',
        'R2 2 0 1k',
        '.op',
      ].join('\n'),
    );
    expect(s['V(2)']).toBeCloseTo(0.5 * 4 * 3, 9);
  });

  it('follows time in a transient analysis and linearises in AC', () => {
    const [tran, ac] = run('t\nB1 out 0 V=sin(2*pi*1k*time)\nR1 out 0 1k\nVin in 0 DC 0 AC 1\nB2 o2 0 V=3*V(in)+0.5*V(o2)^2\nR2 o2 0 1k\n.tran 10u 1m\n.ac lin 2 1k 2k\n');
    const t = tran.scale?.re;
    const v = findVector(tran, 'V(out)')?.re;
    expect(t && v).toBeTruthy();
    if (!t || !v) return;
    for (let k = 0; k < t.length; k += 7) expect(v[k]).toBeCloseTo(Math.sin(2 * Math.PI * 1e3 * t[k]), 6);
    // at the operating point V(o2) = 0, so the small-signal gain is 3
    const o2 = findVector(ac, 'V(o2)');
    expect(o2?.re[0]).toBeCloseTo(3, 9);
    expect(o2?.im?.[0] ?? 0).toBeCloseTo(0, 12);
  });
});
