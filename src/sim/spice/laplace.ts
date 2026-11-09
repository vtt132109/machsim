/**
 * LAPLACE controlled sources (PSpice-style E / G cards):
 *
 *   E<name> n+ n- LAPLACE {V(a)}      = {1/(1 + s*1m)}
 *   G<name> n+ n- LAPLACE {V(a,b)}    = {(s*2k)/(s^2 + s*100 + 1e6)}
 *
 * `rationalTransform(text)` reads the transform as a rational function of s: numbers, SPICE
 * suffixes, + - * / ^ (integer powers), parentheses, and any sub-expression that does not contain s
 * (constants and functions of constants are evaluated). Parameters are not available at parse time,
 * so other identifiers are rejected. `laplaceInput(text)` accepts V(a), V(a,b), V(a)-V(b) and a
 * constant multiple of those. Coefficients are stored in ascending powers of s.
 */
import { evaluateExpression, formatExprNumber, parseExpression, walkExpression, type ExprNode } from './expr';

export interface Rational {
  num: number[];
  den: number[];
}

const trim = (p: number[]): number[] => {
  const max = Math.max(...p.map(Math.abs), 0);
  const out = p.slice();
  while (out.length > 1 && Math.abs(out[out.length - 1]) <= 1e-15 * max) out.pop();
  return out;
};
const padd = (a: number[], b: number[]): number[] => trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0)));
const pscale = (a: number[], k: number): number[] => a.map((x) => x * k);
const pmul = (a: number[], b: number[]): number[] => {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] += x * y)));
  return trim(out);
};
const rmul = (a: Rational, b: Rational): Rational => ({ num: pmul(a.num, b.num), den: pmul(a.den, b.den) });
const radd = (a: Rational, b: Rational, sign = 1): Rational => ({ num: padd(pmul(a.num, b.den), pscale(pmul(b.num, a.den), sign)), den: pmul(a.den, b.den) });

function hasS(node: ExprNode): boolean {
  let found = false;
  walkExpression(node, (n) => {
    if (n.kind === 'ident' && n.name.toLowerCase() === 's') found = true;
  });
  return found;
}

function toRational(node: ExprNode): Rational {
  if (!hasS(node)) {
    const v = evaluateExpression(node);
    if (!Number.isFinite(v)) throw new Error('a constant of the transform is not a finite number');
    return { num: [v], den: [1] };
  }
  switch (node.kind) {
    case 'ident':
      return { num: [0, 1], den: [1] };
    case 'unary':
      if (node.op === '-') {
        const r = toRational(node.arg);
        return { num: pscale(r.num, -1), den: r.den };
      }
      if (node.op === '+') return toRational(node.arg);
      break;
    case 'binary': {
      const { op } = node;
      if (op === '+' || op === '-') return radd(toRational(node.left), toRational(node.right), op === '+' ? 1 : -1);
      if (op === '*') return rmul(toRational(node.left), toRational(node.right));
      if (op === '/') {
        const r = toRational(node.right);
        return rmul(toRational(node.left), { num: r.den, den: r.num });
      }
      if (op === '^') {
        if (hasS(node.right)) break;
        const k = evaluateExpression(node.right);
        if (!Number.isInteger(k) || Math.abs(k) > 20) throw new Error('powers of s must be whole numbers');
        const base = toRational(node.left);
        let r: Rational = { num: [1], den: [1] };
        for (let i = 0; i < Math.abs(k); i++) r = rmul(r, base);
        return k < 0 ? { num: r.den, den: r.num } : r;
      }
      break;
    }
    default:
      break;
  }
  throw new Error('only + - * / and whole powers of s are allowed in a LAPLACE transform');
}

/** The transform text as num(s)/den(s), normalised so the highest denominator coefficient is 1. */
export function rationalTransform(text: string): Rational {
  const ast = parseExpression(text);
  walkExpression(ast, (n) => {
    if (n.kind === 'ident' && n.name.toLowerCase() !== 's' && !['pi', 'e'].includes(n.name.toLowerCase())) throw new Error(`unknown name '${n.name}' (LAPLACE transforms take numbers and s only)`);
    if (n.kind === 'v' || n.kind === 'i') throw new Error('a LAPLACE transform cannot read circuit voltages or currents');
  });
  const r = toRational(ast);
  const num = trim(r.num);
  const den = trim(r.den);
  const lead = den[den.length - 1];
  if (!lead) throw new Error('the denominator of the transform is zero');
  if (num.length > den.length) throw new Error('the transform must be proper (numerator degree not above the denominator degree)');
  return { num: num.map((x) => x / lead), den: den.map((x) => x / lead) };
}

/** Controlling voltage of a LAPLACE source: nodes and gain. */
export function laplaceInput(text: string): { pos: string; neg: string; gain: number } {
  const ast = parseExpression(text);
  const read = (n: ExprNode): { pos: string; neg: string; gain: number } | null => {
    if (n.kind === 'v') return { pos: n.pos, neg: n.neg ?? '0', gain: 1 };
    if (n.kind === 'binary' && n.op === '-' && n.left.kind === 'v' && n.right.kind === 'v' && !n.left.neg && !n.right.neg) return { pos: n.left.pos, neg: n.right.pos, gain: 1 };
    if (n.kind === 'unary' && n.op === '-') {
      const r = read(n.arg);
      return r ? { ...r, gain: -r.gain } : null;
    }
    if (n.kind === 'binary' && (n.op === '*' || n.op === '/')) {
      const constRight = !hasSignal(n.right);
      const constLeft = !hasSignal(n.left);
      if (constRight) {
        const r = read(n.left);
        const k = evaluateExpression(n.right);
        return r ? { ...r, gain: n.op === '*' ? r.gain * k : r.gain / k } : null;
      }
      if (constLeft && n.op === '*') {
        const r = read(n.right);
        return r ? { ...r, gain: r.gain * evaluateExpression(n.left) } : null;
      }
    }
    return null;
  };
  const r = read(ast);
  if (!r) throw new Error('the LAPLACE input must be V(a), V(a,b), V(a)-V(b) or a constant times one of them');
  return r;
}

function hasSignal(n: ExprNode): boolean {
  let found = false;
  walkExpression(n, (x) => {
    if (x.kind === 'v' || x.kind === 'i') found = true;
  });
  return found;
}

/** num(s)/den(s) as LAPLACE transform text, e.g. "(1)/(1 + 0.001*s)". */
export function formatTransform(num: readonly number[], den: readonly number[]): string {
  const poly = (p: readonly number[]) =>
    p
      .map((c, k) => (c === 0 ? '' : k === 0 ? formatExprNumber(c) : `${formatExprNumber(c)}*s${k > 1 ? `^${k}` : ''}`))
      .filter((x) => x)
      .join(' + ')
      .replace(/\+ -/g, '- ') || '0';
  return `(${poly(num)})/(${poly(den)})`;
}
