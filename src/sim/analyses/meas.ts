/**
 * Evaluation of `.meas` directives (src/sim/spice/measure.ts) on analysis results.
 *
 *   applyMeasurements(results, netlist)   fills AnalysisResult.measurements of every tran / ac / dc
 *                                         result (also inside sweeps, Monte Carlo, batches, user
 *                                         analyses: each run gets its own values)
 *   measureResult(result, directives, params) the values for one result
 *
 * Expressions are evaluated sample by sample over the result:
 *   tran / dc   real arithmetic with the full SPICE expression language (src/sim/spice/expr.ts):
 *               V(n), V(a,b), I(dev), device outputs such as Ic(Q1) (any vector "name(arg)"), time
 *               (tran), the sweep variable (dc, by its scale name), .param values, earlier
 *               measurements of the same result.
 *   ac          complex arithmetic: V(), I(), + − * / ^, db(), mag(), abs(), ph() / phase()
 *               (degrees), real(), imag(), conj(), sqrt(), exp(), ln(), log10(), the shorthands
 *               vdb(n) vm(n) vp(n) vr(n) vi(n) (also with two nodes) and idb(dev) ip(dev);
 *               frequency is a variable. A complex result is measured by its magnitude
 *               (use vdb / vp for dB and phase).
 * Points between samples are interpolated linearly in x (in log10 x for AC sweeps). Crossings:
 * RISE counts lhs − rhs going from < 0 to >= 0, FALL from > 0 to <= 0, CROSS either; TD skips
 * crossings before it. Range kinds integrate with the trapezoidal rule between FROM and TO
 * (interpolated end points, samples taken in increasing x even when the sweep runs downwards);
 * AVG = ∫y dx / (TO − FROM), RMS = √(∫y² dx / (TO − FROM)).
 *
 * In an `.ac` measurement a complex result is measured by its **magnitude** (use vdb / vp for dB
 * and phase) — including a phasor whose imaginary part happens to be exactly zero, such as the
 * −10 of an inverting stage, which measures 10. Quantities that are real by construction (vdb,
 * vp, re, im, comparisons, real functions) keep their sign; `CVec.real` is what tells the two
 * apart.
 * A failed measurement has value NaN and `error` set; the others still run.
 */
import type { MeasCondition, MeasDirective, Netlist } from '../netlist';
import type { AnalysisResult, MeasurementResult, Vector } from '../results';
import { compileExpression, evaluateExpression, isBuiltinFunction, parseExpression, type ExprNode } from '../spice/expr';
import { isGroundNode } from '../netlist';

/** Real samples of a measured quantity over the result's scale. */
interface Series {
  x: Float64Array;
  y: Float64Array;
  /** interpolate in log10(x) */
  logX: boolean;
}

class MeasError extends Error {}

const AC_SHORT_V = new Set(['vdb', 'vm', 'vp', 'vr', 'vi']);
const AC_SHORT_I = new Set(['idb', 'ip']);

function findVec(result: AnalysisResult, name: string): Vector | undefined {
  const key = name.toLowerCase();
  return result.vectors.find((v) => v.name.toLowerCase() === key);
}

function nodeVector(result: AnalysisResult, node: string): Vector | 'zero' {
  if (isGroundNode(node)) return 'zero';
  const v = findVec(result, `V(${node})`) ?? findVec(result, node);
  if (!v) throw new MeasError(`vector V(${node}) not found`);
  return v;
}

function deviceVector(result: AnalysisResult, call: string, device: string): Vector {
  const v = findVec(result, `${call}(${device})`);
  if (!v) throw new MeasError(`vector ${call}(${device}) not found`);
  return v;
}

/** Identifier name of an AST node that is a bare node / device name, else undefined. */
function identName(n: ExprNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.kind === 'ident') return n.name;
  if (n.kind === 'num') return String(n.value);
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// real evaluation (tran / dc)

function realSeries(result: AnalysisResult, text: string, params: Record<string, number>): Float64Array {
  const x = result.scale!.re;
  const n = x.length;
  const vectors: Vector[] = [];
  const varNames: string[] = [];
  // device outputs (Ic(Q1), P(R1) ...) and AC-style shorthands become runtime variables
  const rewrite = (node: ExprNode): ExprNode => {
    switch (node.kind) {
      case 'call': {
        const fn = node.name.toLowerCase();
        const arg = identName(node.args[0]);
        if (!isBuiltinFunction(fn) && !(fn in params) && node.args.length === 1 && arg !== undefined) {
          const v = deviceVector(result, node.name, arg);
          const name = `__mv${vectors.length}`;
          vectors.push(v);
          varNames.push(name);
          return { kind: 'ident', name };
        }
        if ((fn === 'vr' || fn === 'vm') && node.args.length >= 1) {
          const v: ExprNode = { kind: 'v', pos: identName(node.args[0]) ?? '', ...(node.args[1] ? { neg: identName(node.args[1]) ?? '' } : {}) };
          return fn === 'vm' ? { kind: 'call', name: 'abs', args: [v] } : v;
        }
        return { ...node, args: node.args.map(rewrite) };
      }
      case 'unary':
        return { ...node, arg: rewrite(node.arg) };
      case 'binary':
        return { ...node, left: rewrite(node.left), right: rewrite(node.right) };
      case 'cond':
        return { kind: 'cond', test: rewrite(node.test), then: rewrite(node.then), otherwise: rewrite(node.otherwise) };
      default:
        return node;
    }
  };
  const ast = rewrite(parseExpression(text));
  const scaleName = (result.scale?.name ?? '').toLowerCase();
  const extra = [...varNames];
  if (scaleName && scaleName !== 'time' && /^[a-z_][a-z0-9_]*$/.test(scaleName) && !(scaleName in params)) extra.push(scaleName);
  const compiled = compileExpression(ast, { params: (name) => params[name] ?? params[name.toLowerCase()], variables: extra });
  const sigVecs = compiled.signals.map((s) => (s.kind === 'v' ? nodeVector(result, s.node) : deviceVector(result, 'I', s.device)));
  const sig = new Float64Array(sigVecs.length);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < sigVecs.length; j++) {
      const v = sigVecs[j];
      sig[j] = v === 'zero' ? 0 : v.re[k];
    }
    const vars: Record<string, number> = { time: x[k] };
    if (extra.length) {
      for (let j = 0; j < vectors.length; j++) vars[varNames[j]] = vectors[j].re[k];
      if (extra.length > varNames.length) vars[scaleName] = x[k];
    }
    out[k] = compiled.value(sig, vars);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// complex evaluation (ac)

interface CVec {
  re: Float64Array;
  im: Float64Array;
  /**
   * True when the value is a REAL quantity whose sign carries meaning — the result of vdb / vp /
   * real / imag, a comparison, a real function of real arguments — and not a phasor. A phasor is
   * measured by its magnitude (see {@link seriesOf}), a real quantity by its signed value, and the
   * two must not be told apart by "is the imaginary part exactly zero": an inverting stage with a
   * real gain of −10 would then measure −10 while the same stage with a hair of phase measures +10.
   */
  real?: boolean;
}

function constant(n: number, re: number, im = 0): CVec {
  return { re: new Float64Array(n).fill(re), im: new Float64Array(n).fill(im), real: im === 0 };
}

function fromVector(v: Vector | 'zero', n: number): CVec {
  if (v === 'zero') return constant(n, 0);
  // a vector of an AC result is a phasor, even where the engine returns a zero imaginary part
  return { re: Float64Array.from(v.re), im: v.im ? Float64Array.from(v.im) : new Float64Array(n), real: false };
}

function map2(a: CVec, b: CVec, f: (ar: number, ai: number, br: number, bi: number) => [number, number], real = !!a.real && !!b.real): CVec {
  const n = a.re.length;
  const out = constant(n, 0);
  for (let k = 0; k < n; k++) {
    const [r, i] = f(a.re[k], a.im[k], b.re[k], b.im[k]);
    out.re[k] = r;
    out.im[k] = i;
  }
  out.real = real;
  return out;
}

function map1(a: CVec, f: (r: number, i: number) => [number, number], real = !!a.real): CVec {
  return map2(a, a, (r, i) => f(r, i), real);
}

function cpow(ar: number, ai: number, br: number, bi: number): [number, number] {
  if (ar === 0 && ai === 0) return [br === 0 && bi === 0 ? 1 : 0, 0];
  const lr = Math.log(Math.hypot(ar, ai));
  const th = Math.atan2(ai, ar);
  const er = br * lr - bi * th;
  const ei = br * th + bi * lr;
  const m = Math.exp(er);
  return [m * Math.cos(ei), m * Math.sin(ei)];
}

function complexSeries(result: AnalysisResult, text: string, params: Record<string, number>): CVec {
  const f = result.scale!.re;
  const n = f.length;
  const real = (a: CVec, fn: (v: number) => number, name: string): CVec =>
    map1(
      a,
      (r, i) => {
        if (Math.abs(i) > 1e-12 * Math.max(1, Math.abs(r))) throw new MeasError(`${name}() of a complex value is not supported in an AC measurement`);
        return [fn(r), 0];
      },
      true,
    );
  const ev = (node: ExprNode): CVec => {
    switch (node.kind) {
      case 'num':
        return constant(n, node.value);
      case 'ident': {
        const k = node.name.toLowerCase();
        if (k === 'frequency' || k === 'hertz' || k === 'freq') return { re: Float64Array.from(f), im: new Float64Array(n), real: true };
        if (k === 'j') return constant(n, 0, 1);
        if (k in params) return constant(n, params[k]);
        if (k === 'pi') return constant(n, Math.PI);
        if (k === 'e') return constant(n, Math.E);
        throw new MeasError(`unknown name '${node.name}'`);
      }
      case 'v': {
        const a = fromVector(nodeVector(result, node.pos), n);
        if (!node.neg) return a;
        const b = fromVector(nodeVector(result, node.neg), n);
        return map2(a, b, (ar, ai, br, bi) => [ar - br, ai - bi]);
      }
      case 'i':
        return fromVector(deviceVector(result, 'I', node.device), n);
      case 'unary': {
        const a = ev(node.arg);
        if (node.op === '-') return map1(a, (r, i) => [-r, -i]);
        if (node.op === '+') return a;
        return real(a, (v) => (v === 0 ? 1 : 0), '!');
      }
      case 'binary': {
        const a = ev(node.left);
        const b = ev(node.right);
        switch (node.op) {
          case '+':
            return map2(a, b, (ar, ai, br, bi) => [ar + br, ai + bi]);
          case '-':
            return map2(a, b, (ar, ai, br, bi) => [ar - br, ai - bi]);
          case '*':
            return map2(a, b, (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br]);
          case '/':
            return map2(a, b, (ar, ai, br, bi) => {
              const d = br * br + bi * bi;
              return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
            });
          case '^':
            return map2(a, b, cpow);
          default: {
            const cmp: Record<string, (p: number, q: number) => boolean> = {
              '==': (p, q) => p === q,
              '!=': (p, q) => p !== q,
              '<': (p, q) => p < q,
              '>': (p, q) => p > q,
              '<=': (p, q) => p <= q,
              '>=': (p, q) => p >= q,
              '&&': (p, q) => p !== 0 && q !== 0,
              '||': (p, q) => p !== 0 || q !== 0,
            };
            const op = cmp[node.op];
            return map2(a, b, (ar, _ai, br) => [op(ar, br) ? 1 : 0, 0], true);
          }
        }
      }
      case 'cond': {
        const t = ev(node.test);
        const a = ev(node.then);
        const b = ev(node.otherwise);
        const out = constant(n, 0);
        for (let k = 0; k < n; k++) {
          const pick = t.re[k] !== 0 ? a : b;
          out.re[k] = pick.re[k];
          out.im[k] = pick.im[k];
        }
        out.real = !!a.real && !!b.real;
        return out;
      }
      case 'call': {
        const fn = node.name.toLowerCase();
        if (AC_SHORT_V.has(fn)) {
          const pos = identName(node.args[0]);
          if (pos === undefined) throw new MeasError(`${node.name}() takes node names`);
          const neg = identName(node.args[1]);
          const v = ev({ kind: 'v', pos, ...(neg !== undefined ? { neg } : {}) });
          return applyAc(fn.slice(1), v);
        }
        if (AC_SHORT_I.has(fn)) {
          const dev = identName(node.args[0]);
          if (dev === undefined) throw new MeasError(`${node.name}() takes a device name`);
          return applyAc(fn.slice(1), fromVector(deviceVector(result, 'I', dev), n));
        }
        const arg0 = identName(node.args[0]);
        if (!isBuiltinFunction(fn) && !['mag', 'ph', 'phase', 'real', 're', 'imag', 'im', 'conj'].includes(fn) && node.args.length === 1 && arg0 !== undefined) {
          return fromVector(deviceVector(result, node.name, arg0), n);
        }
        const args = node.args.map(ev);
        const a = args[0];
        if (!a) throw new MeasError(`${node.name}() needs an argument`);
        switch (fn) {
          case 'db':
          case 'mag':
          case 'abs':
          case 'ph':
          case 'phase':
          case 'real':
          case 're':
          case 'imag':
          case 'im':
            return applyAc(fn, a);
          case 'conj':
            return map1(a, (r, i) => [r, -i]);
          case 'sqrt':
            return map2(a, constant(n, 0.5), cpow);
          case 'exp':
            return map1(a, (r, i) => [Math.exp(r) * Math.cos(i), Math.exp(r) * Math.sin(i)]);
          case 'ln':
          case 'log':
            return map1(a, (r, i) => [Math.log(Math.hypot(r, i)), Math.atan2(i, r)]);
          case 'log10':
            return map1(a, (r, i) => [Math.log10(Math.hypot(r, i)), Math.atan2(i, r) / Math.LN10]);
          case 'min':
          case 'max': {
            const b = args[1];
            if (!b) throw new MeasError(`${fn}() needs two arguments in an expression`);
            return map2(a, b, (ar, _ai, br) => [fn === 'min' ? Math.min(ar, br) : Math.max(ar, br), 0], true);
          }
          default: {
            // other real functions of real arguments
            const vals = args.map((x) => x.re);
            for (const x of args) if (x.im.some((v, k) => Math.abs(v) > 1e-12 * Math.max(1, Math.abs(x.re[k])))) throw new MeasError(`${node.name}() of a complex value is not supported in an AC measurement`);
            const out = constant(n, 0);
            for (let k = 0; k < n; k++) {
              const call: ExprNode = { kind: 'call', name: node.name, args: vals.map((v) => ({ kind: 'num', value: v[k] })) };
              out.re[k] = evaluateExpression(call);
            }
            return out;
          }
        }
      }
    }
  };
  return ev(parseExpression(text));
}

function applyAc(fn: string, a: CVec): CVec {
  switch (fn) {
    case 'db':
      return map1(a, (r, i) => [20 * Math.log10(Math.max(Math.hypot(r, i), 1e-300)), 0], true);
    case 'm':
    case 'mag':
    case 'abs':
      return map1(a, (r, i) => [Math.hypot(r, i), 0], true);
    case 'p':
    case 'ph':
    case 'phase':
      return map1(a, (r, i) => [(Math.atan2(i, r) * 180) / Math.PI, 0], true);
    case 'r':
    case 'real':
    case 're':
      return map1(a, (r) => [r, 0], true);
    case 'i':
    case 'imag':
    case 'im':
      return map1(a, (_r, i) => [i, 0], true);
    default:
      return a;
  }
}

// ---------------------------------------------------------------------------------------------
// series helpers

function seriesOf(result: AnalysisResult, text: string, params: Record<string, number>): Series {
  const x = result.scale!.re;
  const logX = result.type === 'ac' && x.length > 0 && x[0] > 0;
  if (result.type === 'ac') {
    const c = complexSeries(result, text, params);
    const y = new Float64Array(x.length);
    // a phasor is measured by its magnitude; a real quantity (vdb, vp, re, im, a comparison) keeps
    // its sign — never decided by "is the imaginary part exactly zero" (see CVec.real)
    for (let k = 0; k < x.length; k++) y[k] = c.real ? c.re[k] : Math.hypot(c.re[k], c.im[k]);
    return { x, y, logX };
  }
  return { x, y: realSeries(result, text, params), logX };
}

/** Interpolation weight of xq in [x0, x1]. */
function weight(x0: number, x1: number, xq: number, logX: boolean): number {
  if (x1 === x0) return 0;
  if (logX && x0 > 0 && x1 > 0 && xq > 0) return Math.log(xq / x0) / Math.log(x1 / x0);
  return (xq - x0) / (x1 - x0);
}

function segmentOf(x: Float64Array, xq: number): number {
  const n = x.length;
  if (n < 2) return 0;
  const asc = x[n - 1] >= x[0];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (asc ? x[mid] <= xq : x[mid] >= xq) lo = mid;
    else hi = mid;
  }
  return lo;
}

function inRange(x: Float64Array, xq: number): boolean {
  const lo = Math.min(x[0], x[x.length - 1]);
  const hi = Math.max(x[0], x[x.length - 1]);
  const tol = 1e-9 * Math.max(Math.abs(lo), Math.abs(hi), 1e-30);
  return xq >= lo - tol && xq <= hi + tol;
}

function valueAt(s: Series, xq: number): number {
  if (!inRange(s.x, xq)) throw new MeasError(`x = ${xq} is outside the analysed range`);
  const n = s.x.length;
  if (n === 1) return s.y[0];
  const i = segmentOf(s.x, xq);
  const w = Math.min(1, Math.max(0, weight(s.x[i], s.x[i + 1], xq, s.logX)));
  return s.y[i] + w * (s.y[i + 1] - s.y[i]);
}

function slopeAt(s: Series, xq: number): number {
  if (!inRange(s.x, xq)) throw new MeasError(`x = ${xq} is outside the analysed range`);
  const n = s.x.length;
  if (n < 2) throw new MeasError('a derivative needs at least two points');
  let i = segmentOf(s.x, xq);
  // at a sample point use the central difference of the neighbouring segments
  if (i > 0 && Math.abs(s.x[i] - xq) <= 1e-12 * Math.max(Math.abs(xq), 1e-30) && i + 1 < n) {
    return (s.y[i + 1] - s.y[i - 1]) / (s.x[i + 1] - s.x[i - 1]);
  }
  if (i + 1 >= n) i = n - 2;
  return (s.y[i + 1] - s.y[i]) / (s.x[i + 1] - s.x[i]);
}

// ---------------------------------------------------------------------------------------------
// directives

interface Env {
  result: AnalysisResult;
  params: Record<string, number>;
}

/** x position of a condition. */
function conditionX(env: Env, c: MeasCondition): number {
  if (c.at !== undefined) return c.at;
  if (c.expr === undefined || c.level === undefined) throw new MeasError('incomplete condition');
  const a = seriesOf(env.result, c.expr, env.params);
  const b = seriesOf(env.result, c.level, env.params);
  const x = a.x;
  const d = new Float64Array(x.length);
  for (let k = 0; k < x.length; k++) d[k] = a.y[k] - b.y[k];
  const td = c.td ?? -Infinity;
  let found = 0;
  let last: number | undefined;
  for (let k = 1; k < x.length; k++) {
    const p = d[k - 1];
    const q = d[k];
    const rise = p < 0 && q >= 0;
    const fall = p > 0 && q <= 0;
    if (!((c.edge === 'rise' && rise) || (c.edge === 'fall' && fall) || (c.edge === 'cross' && (rise || fall)))) continue;
    const w = p / (p - q);
    const xc = a.logX && x[k - 1] > 0 && x[k] > 0 ? x[k - 1] * Math.pow(x[k] / x[k - 1], w) : x[k - 1] + w * (x[k] - x[k - 1]);
    if (xc < td) continue;
    found++;
    last = xc;
    if (c.count !== 'last' && found === c.count) return xc;
  }
  if (c.count === 'last' && last !== undefined) return last;
  const what = c.edge === 'rise' ? 'rising' : c.edge === 'fall' ? 'falling' : '';
  throw new MeasError(`${c.expr} = ${c.level}: ${c.count === 'last' ? 'no' : `crossing #${c.count} not found (${found} found)`}${c.count === 'last' ? ` ${what} crossing` : ''}`.replace(/\s+/g, ' ').trim());
}

/**
 * Integral of y over [x0, x1] (trapezoidal, interpolated ends). The samples are taken in INCREASING
 * x, whatever order the analysis produced them in: a DC sweep that runs downwards (".dc V1 5 0
 * -0.5") stores its points from 5 V to 0 V, and walking them in storage order between the end
 * points 0 and 5 made the trapezoid path zig-zag back and forth over the interval.
 */
function integral(s: Series, x0: number, x1: number, square: boolean): number {
  const f = (v: number) => (square ? v * v : v);
  const pts: { x: number; y: number }[] = [{ x: x0, y: valueAt(s, x0) }];
  for (let k = 0; k < s.x.length; k++) if (s.x[k] > x0 && s.x[k] < x1) pts.push({ x: s.x[k], y: s.y[k] });
  pts.push({ x: x1, y: valueAt(s, x1) });
  pts.sort((a, b) => a.x - b.x);
  let acc = 0;
  for (let k = 1; k < pts.length; k++) acc += 0.5 * (pts[k].x - pts[k - 1].x) * (f(pts[k].y) + f(pts[k - 1].y));
  return acc;
}

function evaluate(env: Env, d: MeasDirective): { value: number; at?: number } {
  const r = env.result;
  if (d.kind === 'param') return { value: evaluateExpression(d.expr ?? '0', { params: (name) => env.params[name] ?? env.params[name.toLowerCase()] }) };
  if (!r.scale || r.scale.re.length === 0) throw new MeasError('the result has no data points');
  switch (d.kind) {
    case 'find': {
      const x = d.at ?? conditionX(env, d.when!);
      return { value: valueAt(seriesOf(r, d.expr!, env.params), x), at: x };
    }
    case 'deriv': {
      const x = d.at ?? conditionX(env, d.when!);
      return { value: slopeAt(seriesOf(r, d.expr!, env.params), x), at: x };
    }
    case 'when': {
      const x = conditionX(env, d.when!);
      return { value: x, at: x };
    }
    case 'trigtarg': {
      const a = conditionX(env, d.trig!);
      const b = conditionX(env, d.targ!);
      return { value: b - a, at: b };
    }
    default: {
      const s = seriesOf(r, d.expr!, env.params);
      const xs = s.x;
      const xa = Math.min(xs[0], xs[xs.length - 1]);
      const xb = Math.max(xs[0], xs[xs.length - 1]);
      const x0 = d.trig ? conditionX(env, d.trig) : (d.from ?? xa);
      const x1 = d.targ ? conditionX(env, d.targ) : (d.to ?? xb);
      if (!(x1 > x0)) throw new MeasError('empty measurement range');
      if (d.kind === 'integ') return { value: integral(s, x0, x1, false) };
      if (d.kind === 'avg') return { value: integral(s, x0, x1, false) / (x1 - x0) };
      if (d.kind === 'rms') return { value: Math.sqrt(Math.max(0, integral(s, x0, x1, true) / (x1 - x0))) };
      let lo = { x: x0, y: valueAt(s, x0) };
      let hi = { ...lo };
      const consider = (x: number, y: number) => {
        if (y < lo.y) lo = { x, y };
        if (y > hi.y) hi = { x, y };
      };
      for (let k = 0; k < xs.length; k++) if (xs[k] > x0 && xs[k] < x1) consider(xs[k], s.y[k]);
      consider(x1, valueAt(s, x1));
      if (d.kind === 'min') return { value: lo.y, at: lo.x };
      if (d.kind === 'max') return { value: hi.y, at: hi.x };
      return { value: hi.y - lo.y };
    }
  }
}

/** Values of the directives that apply to `result` (by its type), in card order. */
export function measureResult(result: AnalysisResult, directives: readonly MeasDirective[], params: Record<string, number> = {}): MeasurementResult[] {
  const kind = result.type;
  if (kind !== 'tran' && kind !== 'ac' && kind !== 'dc') return [];
  const own = directives.filter((d) => d.analysis === kind);
  if (!own.length || result.error) return [];
  const scope: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === 'number') scope[k.toLowerCase()] = v;
  const out: MeasurementResult[] = [];
  for (const d of own) {
    try {
      const v = evaluate({ result, params: scope }, d);
      out.push({ name: d.name, analysis: d.analysis, value: v.value, ...(v.at !== undefined ? { at: v.at } : {}) });
      if (Number.isFinite(v.value)) scope[d.name.toLowerCase()] = v.value;
    } catch (e) {
      out.push({ name: d.name, analysis: d.analysis, value: Number.NaN, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/**
 * Fill `measurements` of every result (and of every run inside meta results) with the netlist's
 * directives; `params` are the evaluated global parameters (a flat netlist's params).
 */
export function applyMeasurements(results: readonly AnalysisResult[], netlist: Pick<Netlist, 'measures' | 'params'>): void {
  const directives = netlist.measures ?? [];
  if (!directives.length) return;
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(netlist.params)) if (typeof v === 'number') params[k] = v;
  const visit = (r: AnalysisResult) => {
    const m = measureResult(r, directives, params);
    if (m.length) r.measurements = m;
    for (const run of r.runs ?? []) visit(run.result);
  };
  for (const r of results) visit(r);
}
