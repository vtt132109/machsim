/**
 * Postprocessor: a small vector-expression language evaluated over one AnalysisResult.
 *
 * Expressions combine result vectors element-wise with complex arithmetic, e.g.
 *   V(out)/V(in)          db(V(out)/V(in))        ph(V(out))
 *   V(a,b) * I(R1)        deriv(V(cap)) * 1u      rms(V(out))      max(V(out)) - min(V(out))
 *
 * Syntax
 * - Numbers: 1.5, 2e-3, with SPICE suffixes (case-insensitive): t g meg k m(=milli) u n p f.
 * - Operators: + - * / ^ (right associative, binds tighter than unary minus), parentheses.
 * - Vector references: any `name(args)` whose name is not a function, e.g. V(out), I(V1),
 *   Ic(Q1), V(a,b) (= V(a) - V(b) when not stored directly); bare names (inoise_spectrum,
 *   time, frequency); `{any text}` for names containing operators. A bare node name `out`
 *   also resolves to V(out). V(0)/V(gnd) is zero. Lookups are case-insensitive.
 * - SPICE shorthands: vdb(x) vm(x) vp(x) vr(x) vi(x) = db/mag/ph/real/imag of V(x).
 * - Constants: pi, e, j (imaginary unit).
 * - Functions (element-wise unless noted):
 *     db mag abs ph phase uph real re imag im conj sqrt exp ln log log10 sin cos tan atan sgn
 *     deriv integ avg rms        -- with respect to the result scale (time/frequency/sweep)
 *     mean(x)                    -- scalar scale-weighted mean
 *     max(x) min(x)              -- scalar maximum / minimum (real part, magnitude if complex)
 *     max(a,b) min(a,b)          -- element-wise
 *     vs(y, x)                   -- X-Y plot: y drawn against x instead of the scale (B-H loop: vs(V(L1.b), V(L1.h)))
 *     digital(x, th)             -- logic level 1 where x >= th, else 0 (a digital trace)
 *     digital(x, lo, hi)         -- with hysteresis: 1 above hi, 0 below lo, the previous level between
 *   avg and rms are RUNNING values (average / RMS from the first point up to each point).
 * - Other runs and analyses: `<page>.<vector>` (e.g. tran2.V(out), ac1.V(out)) reads a vector of
 *   another Grapher page through PostprocessorContext.external, which resamples it onto this
 *   result's scale (see results/history.ts).
 *   `log` is the natural logarithm (SPICE convention); use log10 for base 10.
 *
 * The evaluator broadcasts length-1 values (scalars) against vectors; other lengths must
 * match. Results are returned as a contract `Vector` (complex when any part is complex).
 */

import type { AnalysisResult, Vector, VectorUnit } from '../../sim/results';
import { parseSpiceNumber } from '../../util/units';
import { t } from '../../i18n';

export class PostprocessorError extends Error {
  readonly position: number;
  constructor(message: string, position = -1) {
    super(message);
    this.name = 'PostprocessorError';
    this.position = position;
  }
}

export type ExprNode =
  | { k: 'num'; v: number }
  | { k: 'imag' }
  | { k: 'ref'; name: string; pos: number }
  | { k: 'neg'; a: ExprNode }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: ExprNode; b: ExprNode }
  | { k: 'call'; fn: string; args: ExprNode[]; pos: number };

interface FnDef {
  min: number;
  max: number;
}

/** Function table: name -> accepted argument counts. */
export const POSTPROCESSOR_FUNCTIONS: Record<string, FnDef> = {
  db: { min: 1, max: 1 },
  mag: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  ph: { min: 1, max: 1 },
  phase: { min: 1, max: 1 },
  uph: { min: 1, max: 1 },
  real: { min: 1, max: 1 },
  re: { min: 1, max: 1 },
  imag: { min: 1, max: 1 },
  im: { min: 1, max: 1 },
  conj: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  ln: { min: 1, max: 1 },
  log: { min: 1, max: 1 },
  log10: { min: 1, max: 1 },
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  atan: { min: 1, max: 1 },
  sgn: { min: 1, max: 1 },
  deriv: { min: 1, max: 1 },
  integ: { min: 1, max: 1 },
  avg: { min: 1, max: 1 },
  rms: { min: 1, max: 1 },
  mean: { min: 1, max: 1 },
  max: { min: 1, max: 2 },
  min: { min: 1, max: 2 },
  digital: { min: 2, max: 3 },
  vs: { min: 2, max: 2 },
};

const SHORTHAND: Record<string, string> = { vdb: 'db', vm: 'mag', vp: 'ph', vr: 'real', vi: 'imag' };

// ---------------------------------------------------------------------------
// Parser (recursive descent directly over the source text)
// ---------------------------------------------------------------------------

class Parser {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): ExprNode {
    const node = this.parseAdd();
    this.ws();
    if (this.i < this.s.length) throw new PostprocessorError(t('results.postprocessor.unexpectedValue', { value: this.s[this.i] }), this.i);
    return node;
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private peek(): string {
    this.ws();
    return this.s[this.i] ?? '';
  }

  private parseAdd(): ExprNode {
    let a = this.parseMul();
    for (;;) {
      const c = this.peek();
      if (c !== '+' && c !== '-') return a;
      this.i++;
      a = { k: 'bin', op: c, a, b: this.parseMul() };
    }
  }

  private parseMul(): ExprNode {
    let a = this.parseUnary();
    for (;;) {
      const c = this.peek();
      if (c !== '*' && c !== '/') return a;
      this.i++;
      a = { k: 'bin', op: c, a, b: this.parseUnary() };
    }
  }

  private parseUnary(): ExprNode {
    const c = this.peek();
    if (c === '-') {
      this.i++;
      return { k: 'neg', a: this.parseUnary() };
    }
    if (c === '+') {
      this.i++;
      return this.parseUnary();
    }
    return this.parsePow();
  }

  private parsePow(): ExprNode {
    const base = this.parsePrimary();
    if (this.peek() === '^') {
      this.i++;
      return { k: 'bin', op: '^', a: base, b: this.parseUnary() };
    }
    return base;
  }

  private parsePrimary(): ExprNode {
    const c = this.peek();
    const start = this.i;
    if (c === '') throw new PostprocessorError(t('results.postprocessor.unexpectedEndOfExpression'), this.i);
    if (c === '(') {
      this.i++;
      const e = this.parseAdd();
      if (this.peek() !== ')') throw new PostprocessorError(t('results.postprocessor.missing'), this.i);
      this.i++;
      return e;
    }
    if (c === '{') {
      const end = this.s.indexOf('}', this.i + 1);
      if (end < 0) throw new PostprocessorError(t('results.postprocessor.missing2'), this.i);
      const name = this.s.slice(this.i + 1, end).trim();
      this.i = end + 1;
      if (!name) throw new PostprocessorError(t('results.postprocessor.emptyVectorName'), start);
      return { k: 'ref', name, pos: start };
    }
    if (/[0-9.]/.test(c)) return this.parseNumber();
    if (/[A-Za-z_#@$]/.test(c)) {
      let j = this.i;
      while (j < this.s.length && /[A-Za-z0-9_#@$.:]/.test(this.s[j])) j++;
      const ident = this.s.slice(this.i, j);
      this.i = j;
      const lower = ident.toLowerCase();
      if (this.peek() === '(') {
        if (lower in POSTPROCESSOR_FUNCTIONS) {
          this.i++;
          const args: ExprNode[] = [];
          if (this.peek() !== ')') {
            for (;;) {
              args.push(this.parseAdd());
              const d = this.peek();
              if (d === ',') {
                this.i++;
                continue;
              }
              break;
            }
          }
          if (this.peek() !== ')') throw new PostprocessorError(t('results.postprocessor.missing'), this.i);
          this.i++;
          const def = POSTPROCESSOR_FUNCTIONS[lower];
          if (args.length < def.min || args.length > def.max) {
            throw new PostprocessorError(
              `${lower}() takes ${def.min === def.max ? def.min : `${def.min}-${def.max}`} argument(s)`,
              start,
            );
          }
          return { k: 'call', fn: lower, args, pos: start };
        }
        // Vector reference such as V(out), I(V1), V(a,b): take the raw text up to the matching ')'.
        const open = this.i;
        let depth = 0;
        let k = open;
        for (; k < this.s.length; k++) {
          if (this.s[k] === '(') depth++;
          else if (this.s[k] === ')') {
            depth--;
            if (depth === 0) break;
          }
        }
        if (depth !== 0) throw new PostprocessorError(t('results.postprocessor.missing'), open);
        const inner = this.s.slice(open + 1, k).replace(/\s+/g, '');
        this.i = k + 1;
        if (lower in SHORTHAND) {
          return { k: 'call', fn: SHORTHAND[lower], args: [{ k: 'ref', name: `V(${inner})`, pos: start }], pos: start };
        }
        return { k: 'ref', name: `${ident}(${inner})`, pos: start };
      }
      if (lower === 'pi') return { k: 'num', v: Math.PI };
      if (lower === 'e') return { k: 'num', v: Math.E };
      if (lower === 'j') return { k: 'imag' };
      return { k: 'ref', name: ident, pos: start };
    }
    throw new PostprocessorError(t('results.postprocessor.unexpectedC', { c: c }), this.i);
  }

  private parseNumber(): ExprNode {
    const start = this.i;
    const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[A-Za-zµμ]*/.exec(this.s.slice(this.i));
    if (!m) throw new PostprocessorError(t('results.postprocessor.badNumber'), start);
    const v = parseSpiceNumber(m[0]);
    if (!Number.isFinite(v)) throw new PostprocessorError(t('results.postprocessor.badNumberValue', { value: m[0] }), start);
    this.i += m[0].length;
    return { k: 'num', v };
  }
}

export interface CompiledExpression {
  text: string;
  ast: ExprNode;
  /** vector names referenced (as written) */
  references: string[];
}

/** Parse an expression; throws PostprocessorError with the character position on syntax errors. */
export function compileExpression(text: string): CompiledExpression {
  if (!text.trim()) throw new PostprocessorError(t('results.postprocessor.emptyExpression'), 0);
  const ast = new Parser(text).parse();
  const refs: string[] = [];
  const walk = (n: ExprNode) => {
    switch (n.k) {
      case 'ref':
        if (!refs.includes(n.name)) refs.push(n.name);
        break;
      case 'neg':
        walk(n.a);
        break;
      case 'bin':
        walk(n.a);
        walk(n.b);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(ast);
  return { text: text.trim(), ast, references: refs };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Val {
  re: Float64Array;
  im: Float64Array | null;
  unit: VectorUnit;
  /** vs(y, x): the horizontal values and their name / unit */
  xs?: { values: Float64Array; name: string; unit: VectorUnit };
}

/**
 * Physical unit of the internal nodes of a magnetic core (src/library/catalog/magneticCore.ts): they are
 * simulator node voltages, but V(<ref>.b) holds the flux density in tesla, V(<ref>.h) and V(<ref>.m) the
 * field and magnetisation in A/m and V(<ref>.flux) the flux linkage in weber-turns. Undefined for every other vector.
 */
export function magneticUnit(name: string): VectorUnit | undefined {
  const m = /^v\((.+)\.(b|h|m|flux)\)$/i.exec(name.trim());
  if (!m) return undefined;
  const k = m[2].toLowerCase();
  return k === 'b' ? 'T' : k === 'flux' ? 'Wb' : 'A/m';
}

export interface PostprocessorContext {
  result: AnalysisResult;
  /** additional vectors (e.g. previously defined postprocessor traces) */
  extra?: Vector[];
  /**
   * Resolver for references to other pages, `<page>.<vector>` (page = analysis type + run number,
   * e.g. "tran2"): returns the vector already aligned with this result's scale, or undefined.
   * May throw PostprocessorError with an explanation (e.g. incompatible scales).
   */
  external?: (page: string, name: string) => Vector | undefined;
}

export interface PostprocessorOutput {
  /** plottable vector: scalars are broadcast to the scale length */
  vector: Vector;
  /** true when the expression reduced to a single value */
  scalar: boolean;
  /** the scalar value (real part) when `scalar` */
  value?: number;
  /** imaginary part of a complex scalar */
  valueIm?: number;
}

const scalarVal = (re: number, im: number | null = null, unit: VectorUnit = ''): Val => ({
  re: Float64Array.of(re),
  im: im === null ? null : Float64Array.of(im),
  unit,
});

function lenOf(a: Val, b: Val, pos: number): number {
  const la = a.re.length;
  const lb = b.re.length;
  if (la === lb || lb === 1) return la;
  if (la === 1) return lb;
  throw new PostprocessorError(t('results.postprocessor.vectorLengthMismatchLaVs', { la: la, lb: lb }), pos);
}

const at = (arr: Float64Array, i: number) => (arr.length === 1 ? arr[0] : arr[i]);
const imAt = (v: Val, i: number) => (v.im ? at(v.im, i) : 0);

function cdiv(ar: number, ai: number, br: number, bi: number): [number, number] {
  if (bi === 0) return [ar / br, ai / br];
  if (Math.abs(br) >= Math.abs(bi)) {
    const r = bi / br;
    const d = br + bi * r;
    return [(ar + ai * r) / d, (ai - ar * r) / d];
  }
  const r = br / bi;
  const d = br * r + bi;
  return [(ar * r + ai) / d, (ai * r - ar) / d];
}

function clog(r: number, i: number): [number, number] {
  return [Math.log(Math.hypot(r, i)), Math.atan2(i, r)];
}

function cexp(r: number, i: number): [number, number] {
  const m = Math.exp(r);
  return [m * Math.cos(i), m * Math.sin(i)];
}

function cpow(ar: number, ai: number, br: number, bi: number): [number, number] {
  if (ar === 0 && ai === 0) return br === 0 && bi === 0 ? [1, 0] : [0, 0];
  const [lr, li] = clog(ar, ai);
  return cexp(lr * br - li * bi, lr * bi + li * br);
}

function binary(op: '+' | '-' | '*' | '/' | '^', a: Val, b: Val, pos: number): Val {
  const n = lenOf(a, b, pos);
  const re = new Float64Array(n);
  let unit: VectorUnit = '';
  if (op === '+' || op === '-') unit = a.unit === b.unit ? a.unit : a.unit || b.unit;
  else if (op === '*' || op === '/') unit = a.unit === '' ? (op === '*' ? b.unit : '') : b.unit === '' ? a.unit : '';
  const complex = a.im !== null || b.im !== null;
  if (!complex) {
    if (op === '^') {
      // Real power; promote to complex for negative bases with fractional exponents.
      let needsComplex = false;
      for (let i = 0; i < n && !needsComplex; i++) {
        const x = at(a.re, i);
        const y = at(b.re, i);
        if (x < 0 && !Number.isInteger(y)) needsComplex = true;
      }
      if (!needsComplex) {
        for (let i = 0; i < n; i++) re[i] = Math.pow(at(a.re, i), at(b.re, i));
        return { re, im: null, unit };
      }
    } else {
      for (let i = 0; i < n; i++) {
        const x = at(a.re, i);
        const y = at(b.re, i);
        re[i] = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y;
      }
      return { re, im: null, unit };
    }
  }
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ar = at(a.re, i);
    const ai = imAt(a, i);
    const br = at(b.re, i);
    const bi = imAt(b, i);
    let r: [number, number];
    switch (op) {
      case '+':
        r = [ar + br, ai + bi];
        break;
      case '-':
        r = [ar - br, ai - bi];
        break;
      case '*':
        r = [ar * br - ai * bi, ar * bi + ai * br];
        break;
      case '/':
        r = cdiv(ar, ai, br, bi);
        break;
      default:
        r = cpow(ar, ai, br, bi);
    }
    re[i] = r[0];
    im[i] = r[1];
  }
  return { re, im, unit };
}

function mapReal(v: Val, f: (x: number) => number, unit: VectorUnit = v.unit): Val {
  const re = new Float64Array(v.re.length);
  for (let i = 0; i < re.length; i++) re[i] = f(v.re[i]);
  return { re, im: null, unit };
}

function mapComplex(v: Val, f: (r: number, i: number) => [number, number], unit: VectorUnit = ''): Val {
  const n = v.re.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = f(v.re[i], v.im ? v.im[i] : 0);
    re[i] = r[0];
    im[i] = r[1];
  }
  return { re, im, unit };
}

function magnitude(v: Val): Float64Array {
  const out = new Float64Array(v.re.length);
  for (let i = 0; i < out.length; i++) out[i] = v.im ? Math.hypot(v.re[i], v.im[i]) : Math.abs(v.re[i]);
  return out;
}

function requireReal(v: Val, fn: string, pos: number): void {
  if (v.im) throw new PostprocessorError(t('results.postprocessor.fnNeedsARealArgument', { fn: fn }), pos);
}

/** Second-order derivative on a non-uniform grid (one-sided at the ends). */
function derivative(s: Float64Array, y: Float64Array): Float64Array {
  const n = y.length;
  const d = new Float64Array(n);
  if (n < 2) return d;
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      const a = i === 0 ? 0 : n - 2;
      const h = s[a + 1] - s[a];
      d[i] = h !== 0 ? (y[a + 1] - y[a]) / h : 0;
      continue;
    }
    const h1 = s[i] - s[i - 1];
    const h2 = s[i + 1] - s[i];
    if (h1 === 0 || h2 === 0 || h1 + h2 === 0) {
      const h = s[i + 1] - s[i - 1];
      d[i] = h !== 0 ? (y[i + 1] - y[i - 1]) / h : 0;
    } else {
      d[i] = (h1 * h1 * y[i + 1] - h2 * h2 * y[i - 1] + (h2 * h2 - h1 * h1) * y[i]) / (h1 * h2 * (h1 + h2));
    }
  }
  return d;
}

/** Cumulative trapezoidal integral. */
function integral(s: Float64Array, y: Float64Array): Float64Array {
  const out = new Float64Array(y.length);
  for (let i = 1; i < y.length; i++) out[i] = out[i - 1] + 0.5 * (y[i] + y[i - 1]) * (s[i] - s[i - 1]);
  return out;
}

/** Cumulative integral of y^2 using the exact formula for linear segments. */
function integralSquare(s: Float64Array, y: Float64Array): Float64Array {
  const out = new Float64Array(y.length);
  for (let i = 1; i < y.length; i++) {
    const a = y[i - 1];
    const b = y[i];
    out[i] = out[i - 1] + ((a * a + a * b + b * b) / 3) * (s[i] - s[i - 1]);
  }
  return out;
}

class Evaluator {
  private readonly map = new Map<string, Vector>();
  private readonly scale?: Vector;

  constructor(private readonly ctx: PostprocessorContext) {
    this.scale = ctx.result.scale;
    for (const v of ctx.result.vectors) this.map.set(v.name.toLowerCase(), v);
    for (const v of ctx.extra ?? []) this.map.set(v.name.toLowerCase(), v);
  }

  private needScale(fn: string, pos: number, len: number): Float64Array {
    const s = this.scale;
    if (!s) throw new PostprocessorError(t('results.postprocessor.fnNeedsASweptResult', { fn: fn }), pos);
    if (s.re.length !== len) throw new PostprocessorError(t('results.postprocessor.fnArgumentDoesNotMatch', { fn: fn }), pos);
    return s.re;
  }

  private lookup(name: string, pos: number): Val {
    const key = name.toLowerCase().replace(/\s+/g, '');
    const direct = this.map.get(key);
    if (direct) return { re: direct.re, im: direct.im ?? null, unit: magneticUnit(direct.name) ?? direct.unit };
    const s = this.scale;
    if (s && (key === s.name.toLowerCase() || key === 'scale' || key === 'x' || key === 'time' || key === 'frequency')) {
      if (key === 'time' && s.unit !== 's' && s.name.toLowerCase() !== 'time') throw new PostprocessorError(t('results.postprocessor.thisResultHasNoTime'), pos);
      if (key === 'frequency' && s.unit !== 'Hz' && s.name.toLowerCase() !== 'frequency') {
        throw new PostprocessorError(t('results.postprocessor.thisResultHasNoFrequency'), pos);
      }
      return { re: s.re, im: null, unit: s.unit };
    }
    const m = /^([a-z]+)\((.*)\)$/.exec(key);
    if (m && m[1] === 'v') {
      const parts = m[2].split(',');
      if (parts.length === 1 && (parts[0] === '0' || parts[0] === 'gnd')) return scalarVal(0, null, 'V');
      if (parts.length === 2) {
        const a = this.lookup(`v(${parts[0]})`, pos);
        const b = this.lookup(`v(${parts[1]})`, pos);
        return { ...binary('-', a, b, pos), unit: 'V' };
      }
    }
    if (!m) {
      const node = this.map.get(`v(${key})`);
      if (node) return { re: node.re, im: node.im ?? null, unit: node.unit };
    }
    const cross = /^([a-z]+[0-9]+)\.(.+)$/i.exec(name.trim());
    if (cross && this.ctx.external) {
      const v = this.ctx.external(cross[1].toLowerCase(), cross[2]);
      if (v) return { re: v.re, im: v.im ?? null, unit: v.unit };
    }
    throw new PostprocessorError(t('results.postprocessor.unknownVectorName', { name: name }), pos);
  }

  eval(n: ExprNode): Val {
    switch (n.k) {
      case 'num':
        return scalarVal(n.v);
      case 'imag':
        return scalarVal(0, 1);
      case 'ref':
        return this.lookup(n.name, n.pos);
      case 'neg': {
        const a = this.eval(n.a);
        return {
          re: a.re.map((x) => -x),
          im: a.im ? a.im.map((x) => -x) : null,
          unit: a.unit,
        };
      }
      case 'bin':
        return binary(n.op, this.eval(n.a), this.eval(n.b), -1);
      case 'call': {
        const out = this.call(n.fn, n.args.map((a) => this.eval(a)), n.pos);
        // vs(y, x): remember the name of the x vector for the axis label
        if (out.xs && n.args[1]?.k === 'ref') out.xs.name = n.args[1].name;
        return out;
      }
    }
  }

  private call(fn: string, args: Val[], pos: number): Val {
    const x = args[0];
    switch (fn) {
      case 'db': {
        const m = magnitude(x);
        return { re: m.map((v) => 20 * Math.log10(v)), im: null, unit: 'dB' };
      }
      case 'mag':
      case 'abs':
        return { re: magnitude(x), im: null, unit: x.unit };
      case 'ph':
      case 'phase':
      case 'uph': {
        const p = new Float64Array(x.re.length);
        for (let i = 0; i < p.length; i++) p[i] = (Math.atan2(x.im ? x.im[i] : 0, x.re[i]) * 180) / Math.PI;
        if (fn === 'uph') {
          let off = 0;
          for (let i = 1; i < p.length; i++) {
            const raw = p[i] + off;
            const d = raw - p[i - 1];
            if (d > 180) off -= 360 * Math.round(d / 360);
            else if (d < -180) off += 360 * Math.round(-d / 360);
            p[i] = p[i] + off;
          }
        }
        return { re: p, im: null, unit: 'deg' };
      }
      case 'real':
      case 're':
        return { re: x.re, im: null, unit: x.unit };
      case 'imag':
      case 'im':
        return { re: x.im ?? new Float64Array(x.re.length), im: null, unit: x.unit };
      case 'conj':
        return { re: x.re, im: x.im ? x.im.map((v) => -v) : null, unit: x.unit };
      case 'sqrt':
        if (!x.im && x.re.every((v) => v >= 0)) return mapReal(x, Math.sqrt, '');
        return mapComplex(x, (r, i) => {
          const [lr, li] = clog(r, i);
          return r === 0 && i === 0 ? [0, 0] : cexp(lr / 2, li / 2);
        });
      case 'exp':
        if (!x.im) return mapReal(x, Math.exp, '');
        return mapComplex(x, cexp);
      case 'ln':
      case 'log':
      case 'log10': {
        const k = fn === 'log10' ? Math.LN10 : 1;
        if (!x.im && x.re.every((v) => v >= 0)) return mapReal(x, (v) => Math.log(v) / k, '');
        return mapComplex(x, (r, i) => {
          const [lr, li] = clog(r, i);
          return [lr / k, li / k];
        });
      }
      case 'sin':
        if (!x.im) return mapReal(x, Math.sin, '');
        return mapComplex(x, (r, i) => [Math.sin(r) * Math.cosh(i), Math.cos(r) * Math.sinh(i)]);
      case 'cos':
        if (!x.im) return mapReal(x, Math.cos, '');
        return mapComplex(x, (r, i) => [Math.cos(r) * Math.cosh(i), -Math.sin(r) * Math.sinh(i)]);
      case 'tan':
        requireReal(x, fn, pos);
        return mapReal(x, Math.tan, '');
      case 'atan':
        requireReal(x, fn, pos);
        return mapReal(x, Math.atan, '');
      case 'sgn':
        requireReal(x, fn, pos);
        return mapReal(x, Math.sign, '');
      case 'deriv': {
        const s = this.needScale(fn, pos, x.re.length);
        return { re: derivative(s, x.re), im: x.im ? derivative(s, x.im) : null, unit: '' };
      }
      case 'integ': {
        const s = this.needScale(fn, pos, x.re.length);
        return { re: integral(s, x.re), im: x.im ? integral(s, x.im) : null, unit: '' };
      }
      case 'avg':
      case 'mean': {
        const s = this.needScale(fn, pos, x.re.length);
        const ir = integral(s, x.re);
        const ii = x.im ? integral(s, x.im) : null;
        const n = x.re.length;
        const re = new Float64Array(n);
        const im = ii ? new Float64Array(n) : null;
        for (let i = 0; i < n; i++) {
          const span = s[i] - s[0];
          re[i] = span !== 0 ? ir[i] / span : x.re[i];
          if (im && ii && x.im) im[i] = span !== 0 ? ii[i] / span : x.im[i];
        }
        if (fn === 'mean') return scalarVal(re[n - 1], im ? im[n - 1] : null, x.unit);
        return { re, im, unit: x.unit };
      }
      case 'rms': {
        const s = this.needScale(fn, pos, x.re.length);
        const a = integralSquare(s, x.re);
        const b = x.im ? integralSquare(s, x.im) : null;
        const re = new Float64Array(x.re.length);
        for (let i = 0; i < re.length; i++) {
          const span = s[i] - s[0];
          const sq = a[i] + (b ? b[i] : 0);
          re[i] = span !== 0 ? Math.sqrt(sq / span) : Math.hypot(x.re[i], x.im ? x.im[i] : 0);
        }
        return { re, im: null, unit: x.unit };
      }
      case 'max':
      case 'min': {
        const pick = fn === 'max' ? Math.max : Math.min;
        if (args.length === 2) {
          const y = args[1];
          requireReal(x, fn, pos);
          requireReal(y, fn, pos);
          const n = lenOf(x, y, pos);
          const re = new Float64Array(n);
          for (let i = 0; i < n; i++) re[i] = pick(at(x.re, i), at(y.re, i));
          return { re, im: null, unit: x.unit || y.unit };
        }
        const vals = x.im ? magnitude(x) : x.re;
        let best = fn === 'max' ? -Infinity : Infinity;
        for (let i = 0; i < vals.length; i++) if (!Number.isNaN(vals[i])) best = pick(best, vals[i]);
        return scalarVal(best, null, x.unit);
      }
      case 'vs': {
        // X-Y plot: y drawn against x (a B-H loop is vs(V(L1.b), V(L1.h)))
        const xv = args[1];
        requireReal(x, fn, pos);
        requireReal(xv, fn, pos);
        if (x.re.length !== xv.re.length || x.re.length < 2) throw new PostprocessorError(t('results.postprocessor.vsLengths'), pos);
        return { re: x.re, im: null, unit: x.unit, xs: { values: xv.re, name: '', unit: xv.unit } };
      }
      case 'digital': {
        requireReal(x, fn, pos);
        const lo = args[1].re[0];
        const hi = args.length === 3 ? args[2].re[0] : lo;
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) throw new PostprocessorError(t('results.postprocessor.digitalThresholds'), pos);
        const re = new Float64Array(x.re.length);
        let level = x.re.length && x.re[0] >= hi ? 1 : 0;
        for (let i = 0; i < re.length; i++) {
          const v = x.re[i];
          if (v >= hi) level = 1;
          else if (v < lo) level = 0;
          re[i] = level;
        }
        return { re, im: null, unit: '' };
      }
      default:
        throw new PostprocessorError(t('results.postprocessor.unknownFunctionFn', { fn: fn }), pos);
    }
  }
}

/**
 * Evaluate an expression against a result. The output vector is named after the expression
 * text. Scalars are broadcast to the scale length so they can be plotted as horizontal lines.
 */
export function evaluateExpression(expr: string | CompiledExpression, ctx: PostprocessorContext, name?: string): PostprocessorOutput {
  const compiled = typeof expr === 'string' ? compileExpression(expr) : expr;
  const val = new Evaluator(ctx).eval(compiled.ast);
  const scaleLen = ctx.result.scale?.re.length ?? 0;
  const scalar = val.re.length === 1 && scaleLen !== 1;
  let re = val.re;
  let im = val.im;
  if (scalar && scaleLen > 1) {
    re = new Float64Array(scaleLen).fill(val.re[0]);
    im = val.im ? new Float64Array(scaleLen).fill(val.im[0]) : null;
  } else {
    // never alias the caller's arrays
    re = Float64Array.from(re);
    im = im ? Float64Array.from(im) : null;
  }
  const vector: Vector = { name: name ?? compiled.text, unit: val.unit, re };
  if (im) vector.im = im;
  if (compiled.ast.k === 'call' && compiled.ast.fn === 'digital') vector.digital = true;
  if (val.xs) {
    vector.xValues = Float64Array.from(val.xs.values);
    if (val.xs.name) vector.xName = val.xs.name;
    vector.xUnit = val.xs.unit;
  }
  return {
    vector,
    scalar,
    value: scalar ? val.re[0] : undefined,
    valueIm: scalar && val.im ? val.im[0] : undefined,
  };
}

/** Names a user can reference in expressions for a result: scale name + all vector names. */
export function availableVectorNames(result: AnalysisResult): string[] {
  const names = result.vectors.map((v) => v.name);
  if (result.scale) names.unshift(result.scale.name);
  return names;
}
