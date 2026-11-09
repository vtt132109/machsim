/**
 * MachSim expression engine — SPICE-style arithmetic expressions.
 *
 * Used for `.param` / `{expr}` values, behavioral (B) sources, E/G `VALUE=` conversions and
 * any UI feature that evaluates formulas (grapher post-processing, property fields).
 *
 * Pipeline
 *   parseExpression(text)        -> ExprNode (AST; identifier case preserved)
 *   resolveExpression(ast, env)  -> ExprNode with parameters folded to numbers, user `.func`
 *                                   calls inlined, node/device names mapped (flattenNetlist uses
 *                                   this to rewrite B-source expressions inside subcircuits)
 *   compileExpression(src, env)  -> CompiledExpression: closures that compute the value and the
 *                                   gradient with respect to every referenced V(node) / I(device)
 *                                   quantity (forward-mode automatic differentiation)
 *   formatExpression(ast)        -> text that parseExpression reads back to the same AST
 *
 * Syntax
 *   numbers      1, 2.5, .5, 1e-3, SPICE suffixes (1k, 2.2u, 1meg, 3mil; trailing unit words ignored)
 *   operators    ?: (ternary)  || |  && &  == != <>  < > <= >=  + -  * /  unary - + !  ^ ** (power)
 *                Precedence follows C, with power binding tighter than unary minus: -2^2 = -4,
 *                and power is right-associative: 2^3^2 = 2^9. Logical results are 1 / 0.
 *   grouping     ( ) and { }
 *   signals      V(node), V(node1,node2) = V(node1)-V(node2), I(Vsrc) (branch current).
 *                Node names inside V( ) are taken verbatim (they may contain - + . etc.).
 *                Ground ("0", "gnd") is the constant 0.
 *   variables    time [s], temper [°C], hertz [Hz] (runtime), plus parameters supplied by the env
 *   constants    pi, e, boltz, echarge, planck, kelvin (parameters of the same name shadow them)
 *   functions    abs sqrt exp ln log(=ln) log10 db sin cos tan asin acos atan atan2 sinh cosh tanh
 *                asinh acosh atanh pow pwr pwrs min max limit if floor ceil round nint int sgn
 *                u stp uramp table(x, x1,y1, x2,y2, ...), plus user functions (.func)
 *
 * Real-valued conventions (documented choices where SPICE dialects differ)
 *   x^y, x**y, pow(x,y): exact power for x >= 0 or integer y; for x < 0 with a non-integer y the
 *     result is |x|^y (never NaN), matching ngspice's behavioral-source convention.
 *   pwr(x,y) = |x|^y;  pwrs(x,y) = sgn(x)*|x|^y.
 *   u(x) = stp(x) = 1 for x > 0 else 0;  uramp(x) = max(x, 0);  sgn(0) = 0.
 *   round/nint round halves away from zero; int truncates toward zero.
 *   limit(x, a, b) clamps x into [min(a,b), max(a,b)].
 *   table(...) interpolates linearly between the (xi, yi) points (xi ascending) and holds the end
 *     values outside the range.
 *   Derivatives of non-differentiable functions (floor, comparisons, u, ...) are 0; abs/min/max/
 *   limit/table use the derivative of the active piece.
 *
 * Compiled expressions keep internal scratch buffers, so a CompiledExpression must not be
 * evaluated re-entrantly (it is safe to share across sequential calls, which is how devices use it).
 */

import { BOLTZ, CHARGE, KELVIN } from '../device';
import { isGroundNode } from '../netlist';
import { parseSpiceNumberExact } from './numbers';

// ---------------------------------------------------------------------------------------------
// Errors and AST
// ---------------------------------------------------------------------------------------------

/** Syntax or resolution error. `position` is a 0-based character offset (-1 when not applicable). */
export class ExprError extends Error {
  readonly position: number;
  constructor(message: string, position = -1) {
    super(message);
    this.name = 'ExprError';
    this.position = position;
  }
}

export type UnaryOp = '-' | '+' | '!';
export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '&&'
  | '||';

export type ExprNode =
  | { kind: 'num'; value: number }
  /** parameter, constant or runtime variable */
  | { kind: 'ident'; name: string }
  /** node voltage V(pos) or V(pos, neg) */
  | { kind: 'v'; pos: string; neg?: string }
  /** branch current I(device) */
  | { kind: 'i'; device: string }
  | { kind: 'unary'; op: UnaryOp; arg: ExprNode }
  | { kind: 'binary'; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { kind: 'cond'; test: ExprNode; then: ExprNode; otherwise: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] };

/** A circuit quantity an expression depends on. */
export type ExprSignal = { kind: 'v'; node: string } | { kind: 'i'; device: string };

/** Result-vector style name of a signal: "V(out)" / "I(V1)". */
export function signalName(s: ExprSignal): string {
  return s.kind === 'v' ? `V(${s.node})` : `I(${s.device})`;
}

/** Case-insensitive identity key of a signal ("v:out", "i:v1"). */
export function signalKey(s: ExprSignal): string {
  return s.kind === 'v' ? `v:${s.node.toLowerCase()}` : `i:${s.device.toLowerCase()}`;
}

// ---------------------------------------------------------------------------------------------
// Constants, runtime variables and built-in functions
// ---------------------------------------------------------------------------------------------

/** Built-in constants (lower-case names). User parameters with the same name take precedence. */
export const BUILTIN_CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  e: Math.E,
  boltz: BOLTZ,
  echarge: CHARGE,
  planck: 6.62607015e-34,
  kelvin: KELVIN,
};

/** Runtime variables known to every expression, with the value used when a caller omits them. */
export const RUNTIME_VARIABLE_DEFAULTS: Readonly<Record<string, number>> = {
  time: 0,
  temper: 27,
  hertz: 0,
};

interface BuiltinFn {
  minArgs: number;
  maxArgs: number;
  /** false for piecewise-constant functions (derivative 0 everywhere) */
  differentiable: boolean;
  value(a: Float64Array): number;
  /** Partial derivatives ∂f/∂a[j] written to d (same length as a). */
  partials(a: Float64Array, d: Float64Array): void;
}

const LN10 = Math.LN10;

function sgn(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Real power used by ^, ** and pow(): see module header. */
export function powReal(x: number, y: number): number {
  if (x >= 0 || Number.isInteger(y)) return Math.pow(x, y);
  return Math.pow(-x, y);
}

function powPartials(x: number, y: number, d: Float64Array): void {
  if (x === 0) {
    d[0] = y === 1 ? 1 : y > 1 ? 0 : y === 0 ? 0 : Infinity;
    d[1] = 0;
    return;
  }
  const ax = Math.abs(x);
  if (x > 0 || Number.isInteger(y)) {
    // d/dx x^y = y x^(y-1); d/dy x^y = x^y ln|x| (formal for integer y with x < 0)
    d[0] = y * Math.pow(x, y - 1);
    d[1] = Math.pow(x, y) * Math.log(ax);
  } else {
    // f = |x|^y
    d[0] = y * Math.pow(ax, y - 1) * sgn(x);
    d[1] = Math.pow(ax, y) * Math.log(ax);
  }
}

function roundAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

function unaryFn(f: (x: number) => number, df: ((x: number) => number) | null): BuiltinFn {
  return {
    minArgs: 1,
    maxArgs: 1,
    differentiable: df !== null,
    value: (a) => f(a[0]),
    partials: (a, d) => {
      d[0] = df ? df(a[0]) : 0;
    },
  };
}

function tableValue(a: Float64Array, d: Float64Array | null): number {
  const x = a[0];
  const npts = (a.length - 1) >> 1;
  if (d) d.fill(0);
  const xAt = (k: number) => a[1 + 2 * k];
  const yAt = (k: number) => a[2 + 2 * k];
  if (npts === 1 || x <= xAt(0)) {
    if (d) d[2] = 1;
    return yAt(0);
  }
  const last = npts - 1;
  if (x >= xAt(last)) {
    if (d) d[2 + 2 * last] = 1;
    return yAt(last);
  }
  let k = 0;
  while (k < last - 1 && x >= xAt(k + 1)) k++;
  const xa = xAt(k);
  const xb = xAt(k + 1);
  const ya = yAt(k);
  const yb = yAt(k + 1);
  const h = xb - xa;
  if (h <= 0) {
    if (d) d[2 + 2 * (k + 1)] = 1;
    return yb;
  }
  const t = (x - xa) / h;
  if (d) {
    const dy = yb - ya;
    d[0] = dy / h;
    d[1 + 2 * k] = (dy * (x - xb)) / (h * h);
    d[1 + 2 * (k + 1)] = (-dy * (x - xa)) / (h * h);
    d[2 + 2 * k] = 1 - t;
    d[2 + 2 * (k + 1)] = t;
  }
  return ya + (yb - ya) * t;
}

function extremum(isMax: boolean): BuiltinFn {
  const pick = (a: Float64Array) => {
    let best = 0;
    for (let j = 1; j < a.length; j++) {
      if (isMax ? a[j] > a[best] : a[j] < a[best]) best = j;
    }
    return best;
  };
  return {
    minArgs: 1,
    maxArgs: Infinity,
    differentiable: true,
    value: (a) => a[pick(a)],
    partials: (a, d) => {
      d.fill(0);
      d[pick(a)] = 1;
    },
  };
}

const BUILTINS: Record<string, BuiltinFn> = {
  abs: unaryFn(Math.abs, sgn),
  sqrt: unaryFn(Math.sqrt, (x) => 0.5 / Math.sqrt(x)),
  exp: unaryFn(Math.exp, Math.exp),
  ln: unaryFn(Math.log, (x) => 1 / x),
  log: unaryFn(Math.log, (x) => 1 / x),
  log10: unaryFn(Math.log10, (x) => 1 / (x * LN10)),
  db: unaryFn(
    (x) => 20 * Math.log10(Math.abs(x)),
    (x) => 20 / (x * LN10),
  ),
  sin: unaryFn(Math.sin, Math.cos),
  cos: unaryFn(Math.cos, (x) => -Math.sin(x)),
  tan: unaryFn(Math.tan, (x) => {
    const c = Math.cos(x);
    return 1 / (c * c);
  }),
  asin: unaryFn(Math.asin, (x) => 1 / Math.sqrt(1 - x * x)),
  acos: unaryFn(Math.acos, (x) => -1 / Math.sqrt(1 - x * x)),
  atan: unaryFn(Math.atan, (x) => 1 / (1 + x * x)),
  sinh: unaryFn(Math.sinh, Math.cosh),
  cosh: unaryFn(Math.cosh, Math.sinh),
  tanh: unaryFn(Math.tanh, (x) => {
    const t = Math.tanh(x);
    return 1 - t * t;
  }),
  asinh: unaryFn(Math.asinh, (x) => 1 / Math.sqrt(x * x + 1)),
  acosh: unaryFn(Math.acosh, (x) => 1 / Math.sqrt(x * x - 1)),
  atanh: unaryFn(Math.atanh, (x) => 1 / (1 - x * x)),
  floor: unaryFn(Math.floor, null),
  ceil: unaryFn(Math.ceil, null),
  round: unaryFn(roundAway, null),
  nint: unaryFn(roundAway, null),
  int: unaryFn(Math.trunc, null),
  sgn: unaryFn(sgn, null),
  u: unaryFn((x) => (x > 0 ? 1 : 0), null),
  stp: unaryFn((x) => (x > 0 ? 1 : 0), null),
  uramp: unaryFn(
    (x) => (x > 0 ? x : 0),
    (x) => (x > 0 ? 1 : 0),
  ),
  atan2: {
    minArgs: 2,
    maxArgs: 2,
    differentiable: true,
    value: (a) => Math.atan2(a[0], a[1]),
    partials: (a, d) => {
      const y = a[0];
      const x = a[1];
      const r2 = x * x + y * y;
      d[0] = r2 === 0 ? 0 : x / r2;
      d[1] = r2 === 0 ? 0 : -y / r2;
    },
  },
  pow: {
    minArgs: 2,
    maxArgs: 2,
    differentiable: true,
    value: (a) => powReal(a[0], a[1]),
    partials: (a, d) => powPartials(a[0], a[1], d),
  },
  pwr: {
    minArgs: 2,
    maxArgs: 2,
    differentiable: true,
    value: (a) => Math.pow(Math.abs(a[0]), a[1]),
    partials: (a, d) => {
      const x = a[0];
      const y = a[1];
      const ax = Math.abs(x);
      d[0] = ax === 0 ? (y === 1 ? sgn(x) : y > 1 ? 0 : Infinity) : y * Math.pow(ax, y - 1) * sgn(x);
      d[1] = ax === 0 ? 0 : Math.pow(ax, y) * Math.log(ax);
    },
  },
  pwrs: {
    minArgs: 2,
    maxArgs: 2,
    differentiable: true,
    value: (a) => sgn(a[0]) * Math.pow(Math.abs(a[0]), a[1]),
    partials: (a, d) => {
      const x = a[0];
      const y = a[1];
      const ax = Math.abs(x);
      d[0] = ax === 0 ? (y === 1 ? 1 : y > 1 ? 0 : Infinity) : y * Math.pow(ax, y - 1);
      d[1] = ax === 0 ? 0 : sgn(x) * Math.pow(ax, y) * Math.log(ax);
    },
  },
  min: extremum(false),
  max: extremum(true),
  limit: {
    minArgs: 3,
    maxArgs: 3,
    differentiable: true,
    value: (a) => {
      const lo = Math.min(a[1], a[2]);
      const hi = Math.max(a[1], a[2]);
      return a[0] < lo ? lo : a[0] > hi ? hi : a[0];
    },
    partials: (a, d) => {
      d.fill(0);
      const loIdx = a[1] <= a[2] ? 1 : 2;
      const hiIdx = loIdx === 1 ? 2 : 1;
      if (a[0] < a[loIdx]) d[loIdx] = 1;
      else if (a[0] > a[hiIdx]) d[hiIdx] = 1;
      else d[0] = 1;
    },
  },
  table: {
    minArgs: 3,
    maxArgs: Infinity,
    differentiable: true,
    value: (a) => tableValue(a, null),
    partials: (a, d) => {
      tableValue(a, d);
    },
  },
};

/** True when `name` (any case) is a built-in function. `if` is parsed as a conditional. */
export function isBuiltinFunction(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'if' || Object.prototype.hasOwnProperty.call(BUILTINS, n);
}

/** Names of all built-in functions (lower-case), for UI help/autocomplete. */
export function builtinFunctionNames(): string[] {
  return ['if', ...Object.keys(BUILTINS)].sort();
}

function checkArity(name: string, fn: BuiltinFn, count: number, pos = -1): void {
  if (count < fn.minArgs || count > fn.maxArgs) {
    const want =
      fn.minArgs === fn.maxArgs
        ? `${fn.minArgs}`
        : fn.maxArgs === Infinity
          ? `at least ${fn.minArgs}`
          : `${fn.minArgs}..${fn.maxArgs}`;
    throw new ExprError(`function ${name}() expects ${want} argument(s), got ${count}`, pos);
  }
  if (name === 'table' && count % 2 === 0) {
    throw new ExprError('table() expects x followed by (x, y) pairs', pos);
  }
}

function binaryValue(op: BinaryOp, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '^':
      return powReal(a, b);
    case '==':
      return a === b ? 1 : 0;
    case '!=':
      return a !== b ? 1 : 0;
    case '<':
      return a < b ? 1 : 0;
    case '>':
      return a > b ? 1 : 0;
    case '<=':
      return a <= b ? 1 : 0;
    case '>=':
      return a >= b ? 1 : 0;
    case '&&':
      return a !== 0 && b !== 0 ? 1 : 0;
    case '||':
      return a !== 0 || b !== 0 ? 1 : 0;
  }
}

function unaryValue(op: UnaryOp, a: number): number {
  return op === '-' ? -a : op === '+' ? a : a === 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------------------------

type Tok =
  | { t: 'num'; value: number; pos: number }
  | { t: 'id'; name: string; pos: number }
  | { t: 'sig'; fn: 'v' | 'i'; args: string[]; pos: number }
  | { t: 'op'; op: string; pos: number }
  | { t: 'eof'; pos: number };

/** Operators, longest first so that "**" wins over "*". */
const OPERATORS = [
  '**',
  '==',
  '!=',
  '<>',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '^',
  '<',
  '>',
  '!',
  '&',
  '|',
  '?',
  ':',
  '(',
  ')',
  '{',
  '}',
  ',',
];

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isIdentStart = (c: string | undefined) =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');
const isIdentChar = (c: string | undefined) => isIdentStart(c) || isDigit(c);
const isSuffixChar = (c: string | undefined) =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === 'µ' || c === 'μ');
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    const start = i;
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      while (isDigit(src[i])) i++;
      if (src[i] === '.') {
        i++;
        while (isDigit(src[i])) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        let j = i + 1;
        if (src[j] === '+' || src[j] === '-') j++;
        if (isDigit(src[j])) {
          i = j;
          while (isDigit(src[i])) i++;
        }
      }
      while (isSuffixChar(src[i])) i++;
      const text = src.slice(start, i);
      const value = parseSpiceNumberExact(text);
      if (Number.isNaN(value)) throw new ExprError(`invalid number '${text}'`, start);
      out.push({ t: 'num', value, pos: start });
      continue;
    }
    if (isIdentStart(c)) {
      while (isIdentChar(src[i])) i++;
      const name = src.slice(start, i);
      const lower = name.toLowerCase();
      if (lower === 'v' || lower === 'i') {
        let j = i;
        while (isSpace(src[j])) j++;
        if (src[j] === '(') {
          const close = src.indexOf(')', j + 1);
          if (close < 0) throw new ExprError(`missing ')' after ${name}(`, j);
          const args = src
            .slice(j + 1, close)
            .split(',')
            .map((s) => s.trim());
          if (args.some((a) => a === '' || /\s/.test(a))) {
            throw new ExprError(`invalid argument list in ${name}(...)`, j);
          }
          if (lower === 'i' && args.length !== 1) {
            throw new ExprError('I() takes exactly one device name', start);
          }
          if (lower === 'v' && args.length > 2) {
            throw new ExprError('V() takes one or two node names', start);
          }
          out.push({ t: 'sig', fn: lower, args, pos: start });
          i = close + 1;
          continue;
        }
      }
      out.push({ t: 'id', name, pos: start });
      continue;
    }
    let matched = '';
    for (const op of OPERATORS) {
      if (src.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    if (!matched) throw new ExprError(`unexpected character '${c}'`, i);
    out.push({ t: 'op', op: matched, pos: i });
    i += matched.length;
  }
  out.push({ t: 'eof', pos: n });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------------------------

const NORMALIZE_OP: Record<string, string> = { '<>': '!=', '&': '&&', '|': '||', '**': '^' };

class ExprParser {
  private k = 0;
  constructor(private readonly toks: Tok[]) {}

  parseAll(): ExprNode {
    const node = this.cond();
    const t = this.toks[this.k];
    if (t.t !== 'eof') throw new ExprError(`unexpected ${describe(t)}`, t.pos);
    return node;
  }

  private peekOp(...ops: string[]): string | undefined {
    const t = this.toks[this.k];
    if (t.t !== 'op') return undefined;
    const op = NORMALIZE_OP[t.op] ?? t.op;
    return ops.includes(op) ? op : undefined;
  }

  private expectOp(op: string): void {
    const t = this.toks[this.k];
    if (t.t !== 'op' || t.op !== op) throw new ExprError(`expected '${op}' but found ${describe(t)}`, t.pos);
    this.k++;
  }

  private cond(): ExprNode {
    const test = this.binary(0);
    if (this.peekOp('?')) {
      this.k++;
      const then = this.cond();
      this.expectOp(':');
      const otherwise = this.cond();
      return { kind: 'cond', test, then, otherwise };
    }
    return test;
  }

  private static readonly LEVELS: string[][] = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '>', '<=', '>='],
    ['+', '-'],
    ['*', '/'],
  ];

  private binary(level: number): ExprNode {
    if (level >= ExprParser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const op = this.peekOp(...ExprParser.LEVELS[level]);
      if (!op) return left;
      this.k++;
      const right = this.binary(level + 1);
      left = { kind: 'binary', op: op as BinaryOp, left, right };
    }
  }

  private unary(): ExprNode {
    const op = this.peekOp('-', '+', '!');
    if (op) {
      this.k++;
      return { kind: 'unary', op: op as UnaryOp, arg: this.unary() };
    }
    return this.power();
  }

  private power(): ExprNode {
    const base = this.primary();
    if (this.peekOp('^')) {
      this.k++;
      return { kind: 'binary', op: '^', left: base, right: this.unary() };
    }
    return base;
  }

  private primary(): ExprNode {
    const t = this.toks[this.k];
    switch (t.t) {
      case 'num':
        this.k++;
        return { kind: 'num', value: t.value };
      case 'sig':
        this.k++;
        if (t.fn === 'i') return { kind: 'i', device: t.args[0] };
        return t.args.length === 2 ? { kind: 'v', pos: t.args[0], neg: t.args[1] } : { kind: 'v', pos: t.args[0] };
      case 'id': {
        this.k++;
        if (this.peekOp('(')) {
          this.k++;
          const args: ExprNode[] = [];
          if (!this.peekOp(')')) {
            for (;;) {
              args.push(this.cond());
              if (this.peekOp(',')) {
                this.k++;
                continue;
              }
              break;
            }
          }
          this.expectOp(')');
          if (t.name.toLowerCase() === 'if') {
            if (args.length !== 3) throw new ExprError('if() expects 3 arguments', t.pos);
            return { kind: 'cond', test: args[0], then: args[1], otherwise: args[2] };
          }
          return { kind: 'call', name: t.name, args };
        }
        return { kind: 'ident', name: t.name };
      }
      case 'op':
        if (t.op === '(' || t.op === '{') {
          this.k++;
          const inner = this.cond();
          this.expectOp(t.op === '(' ? ')' : '}');
          return inner;
        }
        throw new ExprError(`unexpected ${describe(t)}`, t.pos);
      case 'eof':
        throw new ExprError('unexpected end of expression', t.pos);
    }
  }
}

function describe(t: Tok): string {
  switch (t.t) {
    case 'num':
      return `number ${t.value}`;
    case 'id':
      return `'${t.name}'`;
    case 'sig':
      return `${t.fn.toUpperCase()}(...)`;
    case 'op':
      return `'${t.op}'`;
    case 'eof':
      return 'end of expression';
  }
}

/** Parse expression text into an AST. Throws ExprError (with character position) on bad syntax. */
export function parseExpression(text: string): ExprNode {
  const src = text.trim();
  if (src === '') throw new ExprError('empty expression', 0);
  return new ExprParser(lex(src)).parseAll();
}

/**
 * Remove one level of SPICE expression delimiters: "{expr}" or "'expr'" -> "expr".
 * Text without delimiters is returned trimmed.
 */
export function stripExpressionDelimiters(text: string): string {
  const s = text.trim();
  if (s.length >= 2) {
    if ((s[0] === '{' && s[s.length - 1] === '}') || (s[0] === "'" && s[s.length - 1] === "'")) {
      // only strip when the opening brace matches the closing one
      if (s[0] === "'") return s.slice(1, -1).trim();
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
          depth--;
          if (depth === 0 && i < s.length - 1) return s;
        }
      }
      return s.slice(1, -1).trim();
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------------------------

const BINARY_PREC: Record<BinaryOp, number> = {
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '>': 5,
  '<=': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '^': 9,
};
const PREC_COND = 1;
const PREC_UNARY = 8;
const PREC_PRIMARY = 10;

function precedence(node: ExprNode): number {
  switch (node.kind) {
    case 'num':
      return node.value < 0 || Object.is(node.value, -0) ? PREC_UNARY : PREC_PRIMARY;
    case 'cond':
      return PREC_COND;
    case 'unary':
      return PREC_UNARY;
    case 'binary':
      return BINARY_PREC[node.op];
    default:
      return PREC_PRIMARY;
  }
}

/** Shortest text that reads back to exactly `v` (non-finite values use 1e999 / (0/0)). */
export function formatExprNumber(v: number): string {
  if (Number.isNaN(v)) return '(0/0)';
  if (v === Infinity) return '1e999';
  if (v === -Infinity) return '-1e999';
  return String(v);
}

function fmt(node: ExprNode, minPrec: number): string {
  const s = fmtRaw(node);
  return precedence(node) < minPrec ? `(${s})` : s;
}

function fmtRaw(node: ExprNode): string {
  switch (node.kind) {
    case 'num':
      return formatExprNumber(node.value);
    case 'ident':
      return node.name;
    case 'v':
      return node.neg !== undefined ? `V(${node.pos},${node.neg})` : `V(${node.pos})`;
    case 'i':
      return `I(${node.device})`;
    case 'unary':
      return node.op + fmt(node.arg, PREC_UNARY);
    case 'binary': {
      if (node.op === '^') return `${fmt(node.left, PREC_PRIMARY)}^${fmt(node.right, PREC_UNARY)}`;
      const p = BINARY_PREC[node.op];
      return `${fmt(node.left, p)} ${node.op} ${fmt(node.right, p + 1)}`;
    }
    case 'cond':
      return `${fmt(node.test, 2)} ? ${fmt(node.then, PREC_COND)} : ${fmt(node.otherwise, PREC_COND)}`;
    case 'call':
      return `${node.name}(${node.args.map((a) => fmt(a, PREC_COND)).join(', ')})`;
  }
}

/** Format an AST as expression text (minimal parentheses, full-precision numbers). */
export function formatExpression(node: ExprNode): string {
  return fmt(node, 0);
}

// ---------------------------------------------------------------------------------------------
// Inspection helpers
// ---------------------------------------------------------------------------------------------

/** Visit every node of an AST (pre-order). */
export function walkExpression(node: ExprNode, visit: (n: ExprNode) => void): void {
  visit(node);
  switch (node.kind) {
    case 'unary':
      walkExpression(node.arg, visit);
      break;
    case 'binary':
      walkExpression(node.left, visit);
      walkExpression(node.right, visit);
      break;
    case 'cond':
      walkExpression(node.test, visit);
      walkExpression(node.then, visit);
      walkExpression(node.otherwise, visit);
      break;
    case 'call':
      for (const a of node.args) walkExpression(a, visit);
      break;
    default:
      break;
  }
}

/** Lower-case identifiers referenced by the expression (parameters / variables / constants). */
export function freeIdentifiers(node: ExprNode): Set<string> {
  const out = new Set<string>();
  walkExpression(node, (n) => {
    if (n.kind === 'ident') out.add(n.name.toLowerCase());
  });
  return out;
}

/** Lower-case names of all functions called by the expression (built-in and user). */
export function calledFunctions(node: ExprNode): Set<string> {
  const out = new Set<string>();
  walkExpression(node, (n) => {
    if (n.kind === 'call') out.add(n.name.toLowerCase());
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Resolution: parameters, user functions, name mapping, constant folding
// ---------------------------------------------------------------------------------------------

/** Parameter lookup by LOWER-CASE name. */
export type ParamLookup =
  | ((name: string) => number | undefined)
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

/** A user function (.func). `params`/`funcs` give its definition-site scope (lexical scoping). */
export interface UserFunction {
  name: string;
  /** argument names (any case) */
  args: string[];
  body: ExprNode;
  params?: ParamLookup;
  funcs?: FuncLookup;
}

/** User-function lookup by LOWER-CASE name. */
export type FuncLookup =
  | ((name: string) => UserFunction | undefined)
  | ReadonlyMap<string, UserFunction>
  | Readonly<Record<string, UserFunction>>;

export interface ResolveEnv {
  /** Parameter values folded into the expression as constants. */
  params?: ParamLookup;
  /** User functions inlined at call sites (they shadow built-ins of the same name). */
  funcs?: FuncLookup;
  /** Extra runtime variable names (time, temper, hertz are always runtime variables). */
  variables?: Iterable<string>;
  /** Keep unknown identifiers as runtime variables instead of throwing. */
  allowUnknownIdentifiers?: boolean;
  /** Rename node names inside V() (e.g. subcircuit flattening). */
  mapNode?(node: string): string;
  /** Rename device names inside I(). */
  mapDevice?(device: string): string;
  /** Fold constant sub-expressions (default true). */
  foldConstants?: boolean;
}

function lookupIn<T>(table: ((n: string) => T | undefined) | ReadonlyMap<string, T> | Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  if (!table) return undefined;
  if (typeof table === 'function') return table(name);
  if (table instanceof Map) return table.get(name);
  const rec = table as Readonly<Record<string, T>>;
  return Object.prototype.hasOwnProperty.call(rec, name) ? rec[name] : undefined;
}

interface ResolveCtx {
  params?: ParamLookup;
  funcs?: FuncLookup;
  bindings: Map<string, ExprNode> | null;
  runtime: Set<string>;
  env: ResolveEnv;
  depth: number;
}

const MAX_INLINE_DEPTH = 64;

function runtimeSet(env: ResolveEnv): Set<string> {
  const s = new Set(Object.keys(RUNTIME_VARIABLE_DEFAULTS));
  if (env.variables) for (const v of env.variables) s.add(v.toLowerCase());
  return s;
}

function num(value: number): ExprNode {
  return { kind: 'num', value };
}

function resolveNode(node: ExprNode, ctx: ResolveCtx): ExprNode {
  const fold = ctx.env.foldConstants !== false;
  switch (node.kind) {
    case 'num':
      return node;
    case 'ident': {
      const lower = node.name.toLowerCase();
      const bound = ctx.bindings?.get(lower);
      if (bound) return bound;
      if (ctx.runtime.has(lower)) return { kind: 'ident', name: lower };
      const p = lookupIn(ctx.params, lower);
      if (p !== undefined) return num(p);
      if (Object.prototype.hasOwnProperty.call(BUILTIN_CONSTANTS, lower)) return num(BUILTIN_CONSTANTS[lower]);
      if (ctx.env.allowUnknownIdentifiers) return { kind: 'ident', name: node.name };
      throw new ExprError(`undefined parameter '${node.name}'`);
    }
    case 'v': {
      const mapNode = ctx.env.mapNode;
      const pos = mapNode ? mapNode(node.pos) : node.pos;
      const neg = node.neg === undefined ? undefined : mapNode ? mapNode(node.neg) : node.neg;
      const posGnd = isGroundNode(pos);
      const negGnd = neg === undefined || isGroundNode(neg);
      if (posGnd && negGnd) return num(0);
      if (negGnd) return { kind: 'v', pos };
      if (posGnd) return { kind: 'unary', op: '-', arg: { kind: 'v', pos: neg as string } };
      return { kind: 'v', pos, neg };
    }
    case 'i':
      return { kind: 'i', device: ctx.env.mapDevice ? ctx.env.mapDevice(node.device) : node.device };
    case 'unary': {
      const arg = resolveNode(node.arg, ctx);
      if (fold && arg.kind === 'num') return num(unaryValue(node.op, arg.value));
      if (node.op === '+') return arg;
      return { kind: 'unary', op: node.op, arg };
    }
    case 'binary': {
      const left = resolveNode(node.left, ctx);
      const right = resolveNode(node.right, ctx);
      if (fold && left.kind === 'num' && right.kind === 'num') return num(binaryValue(node.op, left.value, right.value));
      return { kind: 'binary', op: node.op, left, right };
    }
    case 'cond': {
      const test = resolveNode(node.test, ctx);
      const then = resolveNode(node.then, ctx);
      const otherwise = resolveNode(node.otherwise, ctx);
      if (fold && test.kind === 'num') return test.value !== 0 ? then : otherwise;
      return { kind: 'cond', test, then, otherwise };
    }
    case 'call': {
      const lower = node.name.toLowerCase();
      const user = lookupIn(ctx.funcs, lower);
      if (user) {
        if (user.args.length !== node.args.length) {
          throw new ExprError(`function ${user.name}() expects ${user.args.length} argument(s), got ${node.args.length}`);
        }
        if (ctx.depth >= MAX_INLINE_DEPTH) throw new ExprError(`function ${user.name}() is recursive or nested too deeply`);
        const bindings = new Map<string, ExprNode>();
        user.args.forEach((a, j) => bindings.set(a.toLowerCase(), resolveNode(node.args[j], ctx)));
        return resolveNode(user.body, {
          params: user.params ?? ctx.params,
          funcs: user.funcs ?? ctx.funcs,
          bindings,
          runtime: ctx.runtime,
          env: ctx.env,
          depth: ctx.depth + 1,
        });
      }
      const fn = BUILTINS[lower];
      if (!fn) throw new ExprError(`unknown function '${node.name}'`);
      checkArity(lower, fn, node.args.length);
      const args = node.args.map((a) => resolveNode(a, ctx));
      if (fold && args.every((a) => a.kind === 'num')) {
        return num(fn.value(Float64Array.from(args.map((a) => (a as { value: number }).value))));
      }
      return { kind: 'call', name: lower, args };
    }
  }
}

/**
 * Resolve an AST: fold parameters/constants, inline user functions, map V()/I() names and
 * normalise ground references. Unknown identifiers throw ExprError unless allowed.
 * The result contains only numbers, runtime variables, V/I signals, operators and built-ins.
 */
export function resolveExpression(node: ExprNode, env: ResolveEnv = {}): ExprNode {
  return resolveNode(node, {
    params: env.params,
    funcs: env.funcs,
    bindings: null,
    runtime: runtimeSet(env),
    env,
    depth: 0,
  });
}

// ---------------------------------------------------------------------------------------------
// Compilation to closures with forward-mode derivatives
// ---------------------------------------------------------------------------------------------

/** Runtime variable values by lower-case name; omitted ones use RUNTIME_VARIABLE_DEFAULTS (else 0). */
export type ExprVariables = Readonly<Record<string, number>>;

export interface CompiledExpression {
  /** Resolved expression text (parameters folded, functions inlined). */
  readonly source: string;
  /** Distinct circuit quantities referenced, in first-appearance order; gradient index = position. */
  readonly signals: readonly ExprSignal[];
  /** Runtime variables referenced (lower-case). */
  readonly variables: readonly string[];
  /** True when the expression depends on no signal and no runtime variable. */
  readonly isConstant: boolean;
  /** Evaluate. `signals[k]` is the value of `this.signals[k]`. */
  value(signals?: ArrayLike<number>, vars?: ExprVariables): number;
  /**
   * Evaluate and write ∂value/∂signals[k] into gradient[k] (gradient.length >= signals.length).
   * Returns the value.
   */
  valueAndGradient(signals: ArrayLike<number>, gradient: Float64Array, vars?: ExprVariables): number;
}

interface EvalState {
  sig: ArrayLike<number>;
  vars: Float64Array;
}

interface CNode {
  /** depends (differentiably) on at least one signal */
  dep: boolean;
  val(st: EvalState): number;
  /** Value + full gradient into out[0..n-1]. Only called when dep is true. */
  grad(st: EvalState, out: Float64Array): number;
}

const noGrad = (): number => {
  throw new Error('internal: gradient requested for a signal-independent node');
};

class Compiler {
  readonly signals: ExprSignal[] = [];
  private readonly signalIndex = new Map<string, number>();
  readonly variables: string[] = [];
  private readonly varIndex = new Map<string, number>();

  /** Assign signal/variable slots (first pass, so that n is known before building closures). */
  collect(node: ExprNode): void {
    walkExpression(node, (m) => {
      if (m.kind === 'v') {
        this.addSignal({ kind: 'v', node: m.pos });
        if (m.neg !== undefined) this.addSignal({ kind: 'v', node: m.neg });
      } else if (m.kind === 'i') {
        this.addSignal({ kind: 'i', device: m.device });
      } else if (m.kind === 'ident') {
        const key = m.name.toLowerCase();
        if (!this.varIndex.has(key)) {
          this.varIndex.set(key, this.variables.length);
          this.variables.push(key);
        }
      }
    });
  }

  private addSignal(s: ExprSignal): number {
    const key = signalKey(s);
    let k = this.signalIndex.get(key);
    if (k === undefined) {
      k = this.signals.length;
      this.signalIndex.set(key, k);
      this.signals.push(s);
    }
    return k;
  }

  private signalLeaf(s: ExprSignal): CNode {
    const k = this.signalIndex.get(signalKey(s)) as number;
    return {
      dep: true,
      val: (st) => st.sig[k],
      grad: (st, out) => {
        out.fill(0);
        out[k] = 1;
        return st.sig[k];
      },
    };
  }

  build(node: ExprNode): CNode {
    const n = this.signals.length;
    switch (node.kind) {
      case 'num': {
        const v = node.value;
        return { dep: false, val: () => v, grad: noGrad };
      }
      case 'ident': {
        const slot = this.varIndex.get(node.name.toLowerCase()) as number;
        return { dep: false, val: (st) => st.vars[slot], grad: noGrad };
      }
      case 'v': {
        const p = this.signalLeaf({ kind: 'v', node: node.pos });
        if (node.neg === undefined) return p;
        return this.binaryNode('-', p, this.signalLeaf({ kind: 'v', node: node.neg }), n);
      }
      case 'i':
        return this.signalLeaf({ kind: 'i', device: node.device });
      case 'unary': {
        const a = this.build(node.arg);
        const op = node.op;
        if (op === '!') return { dep: false, val: (st) => (a.val(st) === 0 ? 1 : 0), grad: noGrad };
        if (op === '+') return a;
        if (!a.dep) return { dep: false, val: (st) => -a.val(st), grad: noGrad };
        return {
          dep: true,
          val: (st) => -a.val(st),
          grad: (st, out) => {
            const v = a.grad(st, out);
            for (let k = 0; k < n; k++) out[k] = -out[k];
            return -v;
          },
        };
      }
      case 'binary':
        return this.binaryNode(node.op, this.build(node.left), this.build(node.right), n);
      case 'cond': {
        const t = this.build(node.test);
        const a = this.build(node.then);
        const b = this.build(node.otherwise);
        const val = (st: EvalState) => (t.val(st) !== 0 ? a.val(st) : b.val(st));
        if (!a.dep && !b.dep) return { dep: false, val, grad: noGrad };
        const branchGrad = (c: CNode, st: EvalState, out: Float64Array) => {
          if (c.dep) return c.grad(st, out);
          out.fill(0);
          return c.val(st);
        };
        return {
          dep: true,
          val,
          grad: (st, out) => (t.val(st) !== 0 ? branchGrad(a, st, out) : branchGrad(b, st, out)),
        };
      }
      case 'call':
        return this.callNode(node.name, node.args.map((x) => this.build(x)), n);
    }
  }

  private binaryNode(op: BinaryOp, a: CNode, b: CNode, n: number): CNode {
    if (op === '&&') return { dep: false, val: (st) => (a.val(st) !== 0 && b.val(st) !== 0 ? 1 : 0), grad: noGrad };
    if (op === '||') return { dep: false, val: (st) => (a.val(st) !== 0 || b.val(st) !== 0 ? 1 : 0), grad: noGrad };
    const val = (st: EvalState) => binaryValue(op, a.val(st), b.val(st));
    const differentiable = op === '+' || op === '-' || op === '*' || op === '/' || op === '^';
    if (!differentiable || (!a.dep && !b.dep)) return { dep: false, val, grad: noGrad };
    const ga = a.dep ? new Float64Array(n) : null;
    const gb = b.dep ? new Float64Array(n) : null;
    const pd = new Float64Array(2);
    return {
      dep: true,
      val,
      grad: (st, out) => {
        const x = ga ? a.grad(st, ga) : a.val(st);
        const y = gb ? b.grad(st, gb) : b.val(st);
        let r: number;
        let pa: number;
        let pb: number;
        switch (op) {
          case '+':
            r = x + y;
            pa = 1;
            pb = 1;
            break;
          case '-':
            r = x - y;
            pa = 1;
            pb = -1;
            break;
          case '*':
            r = x * y;
            pa = y;
            pb = x;
            break;
          case '/':
            r = x / y;
            pa = 1 / y;
            pb = -x / (y * y);
            break;
          default:
            r = powReal(x, y);
            powPartials(x, y, pd);
            pa = pd[0];
            pb = pd[1];
            break;
        }
        for (let k = 0; k < n; k++) {
          let s = 0;
          if (ga && pa !== 0) s += pa * ga[k];
          if (gb && pb !== 0) s += pb * gb[k];
          out[k] = s;
        }
        return r;
      },
    };
  }

  private callNode(name: string, args: CNode[], n: number): CNode {
    const fn = BUILTINS[name];
    const m = args.length;
    const argv = new Float64Array(m);
    const val = (st: EvalState) => {
      for (let j = 0; j < m; j++) argv[j] = args[j].val(st);
      return fn.value(argv);
    };
    if (!fn.differentiable || !args.some((x) => x.dep)) return { dep: false, val, grad: noGrad };
    const grads = args.map((x) => (x.dep ? new Float64Array(n) : null));
    const partial = new Float64Array(m);
    return {
      dep: true,
      val,
      grad: (st, out) => {
        for (let j = 0; j < m; j++) {
          const g = grads[j];
          argv[j] = g ? args[j].grad(st, g) : args[j].val(st);
        }
        const r = fn.value(argv);
        fn.partials(argv, partial);
        out.fill(0, 0, n);
        for (let j = 0; j < m; j++) {
          const g = grads[j];
          const p = partial[j];
          if (!g || p === 0) continue;
          for (let k = 0; k < n; k++) out[k] += p * g[k];
        }
        return r;
      },
    };
  }
}

/**
 * Compile expression text or an AST. The input is resolved with `env` first (parameters folded,
 * user functions inlined); throws ExprError on syntax errors or unresolvable names.
 */
export function compileExpression(input: string | ExprNode, env: ResolveEnv = {}): CompiledExpression {
  const ast = typeof input === 'string' ? parseExpression(input) : input;
  const resolved = resolveExpression(ast, env);
  const c = new Compiler();
  c.collect(resolved);
  const root = c.build(resolved);
  const n = c.signals.length;
  const varNames = c.variables.slice();
  const varDefaults = varNames.map((v) => RUNTIME_VARIABLE_DEFAULTS[v] ?? 0);
  const st: EvalState = { sig: new Float64Array(0), vars: new Float64Array(varNames.length) };
  const loadVars = (vars: ExprVariables | undefined) => {
    for (let j = 0; j < varNames.length; j++) {
      const v = vars ? vars[varNames[j]] : undefined;
      st.vars[j] = v === undefined ? varDefaults[j] : v;
    }
  };
  const empty = new Float64Array(0);
  const checkSignals = (s: ArrayLike<number>) => {
    if (s.length < n) throw new ExprError(`expression needs ${n} signal value(s), got ${s.length}`);
  };
  return {
    source: formatExpression(resolved),
    signals: c.signals,
    variables: varNames,
    isConstant: n === 0 && varNames.length === 0,
    value(signals = empty, vars) {
      checkSignals(signals);
      st.sig = signals;
      loadVars(vars);
      return root.val(st);
    },
    valueAndGradient(signals, gradient, vars) {
      checkSignals(signals);
      if (gradient.length < n) throw new ExprError(`gradient buffer needs length ${n}`);
      st.sig = signals;
      loadVars(vars);
      if (root.dep) return root.grad(st, gradient);
      gradient.fill(0, 0, n);
      return root.val(st);
    },
  };
}

/**
 * Evaluate an expression that does not reference V()/I(). Runtime variables take their values from
 * `vars` (or defaults). Throws ExprError when the expression references circuit quantities.
 */
export function evaluateExpression(input: string | ExprNode, env: ResolveEnv = {}, vars?: ExprVariables): number {
  const compiled = compileExpression(input, env);
  if (compiled.signals.length > 0) {
    throw new ExprError(`expression depends on ${compiled.signals.map(signalName).join(', ')}`);
  }
  return compiled.value(undefined, vars);
}
