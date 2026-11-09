import { t } from '../../i18n';
/**
 * Logic converter engine (pure): truth tables of up to 8 inputs, Boolean expression parsing,
 * two-level minimisation with Quine–McCluskey, and NAND-only rewriting.
 *
 * Conventions
 * - Inputs are named A..H; A is the most significant bit of the row index
 *   (row 0 = all inputs 0, row 2^n - 1 = all inputs 1).
 * - A truth table is a string of '0' / '1' / 'X' (don't care), one character per row.
 * - Expression syntax: variables A..H (case-insensitive), constants 0 / 1,
 *   NOT as postfix ' or prefix ! / ~, AND as juxtaposition, '*', '&' or '·',
 *   OR as '+' or '|', XOR as '^' or '⊕', parentheses. Precedence: NOT > AND > XOR > OR.
 * - Minimised output is a sum of products such as "A'B + AC'" (or "0" / "1").
 */

export const LOGIC_VARS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const MAX_LOGIC_INPUTS = 8;

export type TruthValue = '0' | '1' | 'X';

/** Product term: `mask` bits are the variables present, `value` their required values. */
export interface Implicant {
  mask: number;
  value: number;
}

// ---------------------------------------------------------------------------
// Truth tables
// ---------------------------------------------------------------------------

/** Normalise a truth-table string to exactly 2^n characters of 0/1/X (missing rows = '0'). */
export function normalizeTable(table: string, n: number): string {
  const rows = 1 << n;
  let out = '';
  for (let i = 0; i < rows; i++) {
    const ch = (table[i] ?? '0').toUpperCase();
    out += ch === '1' ? '1' : ch === 'X' || ch === '-' || ch === '?' ? 'X' : '0';
  }
  return out;
}

export function tableMinterms(table: string): { ones: number[]; dontCares: number[] } {
  const ones: number[] = [];
  const dontCares: number[] = [];
  for (let i = 0; i < table.length; i++) {
    if (table[i] === '1') ones.push(i);
    else if (table[i] === 'X') dontCares.push(i);
  }
  return { ones, dontCares };
}

/** Value of input `v` (0 = A, the MSB) in row `row` of an n-input table. */
export function inputBit(row: number, v: number, n: number): 0 | 1 {
  return ((row >> (n - 1 - v)) & 1) as 0 | 1;
}

// ---------------------------------------------------------------------------
// Quine–McCluskey
// ---------------------------------------------------------------------------

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Does the implicant cover minterm m? */
export function covers(imp: Implicant, m: number): boolean {
  return (m & imp.mask) === imp.value;
}

/** All prime implicants of the function with the given ones and don't-cares. */
export function primeImplicants(n: number, ones: readonly number[], dontCares: readonly number[] = []): Implicant[] {
  const full = (1 << n) - 1;
  let current = new Map<string, Implicant>();
  for (const m of [...ones, ...dontCares]) current.set(`${full}:${m}`, { mask: full, value: m });
  const primes: Implicant[] = [];
  while (current.size) {
    const list = [...current.values()];
    const used = new Set<string>();
    const next = new Map<string, Implicant>();
    // group by mask so only compatible terms are compared
    const byMask = new Map<number, Implicant[]>();
    for (const t of list) {
      const g = byMask.get(t.mask) ?? [];
      g.push(t);
      byMask.set(t.mask, g);
    }
    for (const group of byMask.values()) {
      // index by value for O(k * n) neighbour lookup
      const byValue = new Map<number, Implicant>();
      for (const t of group) byValue.set(t.value, t);
      for (const t of group) {
        for (let b = 0; b < n; b++) {
          const bit = 1 << b;
          if (!(t.mask & bit) || t.value & bit) continue;
          const other = byValue.get(t.value | bit);
          if (!other) continue;
          const merged: Implicant = { mask: t.mask & ~bit, value: t.value };
          next.set(`${merged.mask}:${merged.value}`, merged);
          used.add(`${t.mask}:${t.value}`);
          used.add(`${other.mask}:${other.value}`);
        }
      }
    }
    for (const t of list) if (!used.has(`${t.mask}:${t.value}`)) primes.push(t);
    current = next;
  }
  return primes;
}

/**
 * Minimum-cost cover of `ones` by prime implicants: essential primes first, then an exact
 * branch-and-bound search on the cyclic core (cost = number of terms, then literals). For very
 * large cores the search is bounded and falls back to the best cover found (greedy seeded).
 */
export function minimizeSop(n: number, ones: readonly number[], dontCares: readonly number[] = []): Implicant[] {
  if (n < 0 || n > MAX_LOGIC_INPUTS) throw new Error(`minimizeSop: 0..${MAX_LOGIC_INPUTS} inputs supported`);
  if (!ones.length) return [];
  const all = (1 << n) - 1;
  if (ones.length + dontCares.length === 1 << n) return [{ mask: 0, value: 0 }];
  const primes = primeImplicants(n, ones, dontCares);
  const lits = (p: Implicant) => popcount(p.mask & all);
  const chosen: Implicant[] = [];
  let remaining = new Set(ones);
  let candidates = primes.slice();

  // Iteratively take essential primes (the only prime covering some remaining minterm).
  for (;;) {
    let changed = false;
    for (const m of remaining) {
      const cov = candidates.filter((p) => covers(p, m));
      if (cov.length === 1) {
        const p = cov[0];
        chosen.push(p);
        remaining = new Set([...remaining].filter((x) => !covers(p, x)));
        candidates = candidates.filter((q) => q !== p);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  candidates = candidates.filter((p) => [...remaining].some((m) => covers(p, m)));
  if (!remaining.size) return sortImplicants(chosen, n);

  // Exact cover of the cyclic core by branch and bound.
  const rem = [...remaining];
  const coverSets = candidates.map((p) => rem.filter((m) => covers(p, m)));
  const cost = (sel: number[]) => sel.length * 100 + sel.reduce((s, k) => s + lits(candidates[k]), 0);
  // greedy seed
  const greedy: number[] = [];
  {
    const left = new Set(rem);
    while (left.size) {
      let best = -1;
      let bestGain = -1;
      for (let k = 0; k < candidates.length; k++) {
        const gain = coverSets[k].filter((m) => left.has(m)).length * 100 - lits(candidates[k]);
        if (gain > bestGain) {
          bestGain = gain;
          best = k;
        }
      }
      if (best < 0) break;
      greedy.push(best);
      for (const m of coverSets[best]) left.delete(m);
    }
  }
  let bestSel = greedy;
  let bestCost = cost(greedy);
  let budget = 200000;
  const search = (left: Set<number>, sel: number[]) => {
    if (budget-- <= 0) return;
    if (!left.size) {
      const c = cost(sel);
      if (c < bestCost) {
        bestCost = c;
        bestSel = sel.slice();
      }
      return;
    }
    // any completion adds at least one more term (cost > 100): prune when it cannot win
    if (cost(sel) + 100 >= bestCost) return;
    // branch on the minterm with the fewest covering candidates
    let pivot = -1;
    let pivotCount = Infinity;
    for (const m of left) {
      let cnt = 0;
      for (let k = 0; k < candidates.length; k++) if (coverSets[k].includes(m)) cnt++;
      if (cnt < pivotCount) {
        pivotCount = cnt;
        pivot = m;
      }
    }
    for (let k = 0; k < candidates.length; k++) {
      if (!coverSets[k].includes(pivot) || sel.includes(k)) continue;
      const next = new Set(left);
      for (const m of coverSets[k]) next.delete(m);
      sel.push(k);
      if (cost(sel) < bestCost) search(next, sel);
      sel.pop();
    }
  };
  search(new Set(rem), []);
  return sortImplicants([...chosen, ...bestSel.map((k) => candidates[k])], n);
}

function sortImplicants(imps: Implicant[], n: number): Implicant[] {
  const key = (p: Implicant) => {
    // order like a written expression: by first variable used, then its polarity
    let s = '';
    for (let v = 0; v < n; v++) {
      const bit = 1 << (n - 1 - v);
      s += p.mask & bit ? (p.value & bit ? '1' : '0') : '2';
    }
    return s;
  };
  return imps.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Text of one product term, e.g. "A'BC". */
export function implicantText(p: Implicant, n: number, names: readonly string[] = LOGIC_VARS): string {
  let s = '';
  for (let v = 0; v < n; v++) {
    const bit = 1 << (n - 1 - v);
    if (p.mask & bit) s += names[v] + (p.value & bit ? '' : "'");
  }
  return s || '1';
}

/** Sum-of-products text ("0" for no terms, "1" for the tautology). */
export function sopText(imps: readonly Implicant[], n: number, names: readonly string[] = LOGIC_VARS): string {
  if (!imps.length) return '0';
  if (imps.some((p) => p.mask === 0)) return '1';
  return imps.map((p) => implicantText(p, n, names)).join(' + ');
}

/** Minimised SOP expression of a truth table string. */
export function tableToExpression(table: string, n: number): string {
  const t = normalizeTable(table, n);
  const { ones, dontCares } = tableMinterms(t);
  return sopText(minimizeSop(n, ones, dontCares), n);
}

/** Unsimplified canonical SOP (one minterm per '1' row). */
export function tableToCanonical(table: string, n: number): string {
  const t = normalizeTable(table, n);
  const full = (1 << n) - 1;
  const terms = tableMinterms(t).ones.map((m) => ({ mask: full, value: m }));
  return sopText(terms, n);
}

/**
 * NAND-only form of a SOP: F = ((P1)'(P2)'...)' with each product P = (x y z)' and each
 * complemented literal x' = (x x)'. Uses the postfix-' notation: (XY)' is NAND(X, Y).
 */
export function sopToNand(imps: readonly Implicant[], n: number, names: readonly string[] = LOGIC_VARS): string {
  if (!imps.length) return '0';
  if (imps.some((p) => p.mask === 0)) return '1';
  const literals = (p: Implicant) => {
    const ls: { v: number; positive: boolean }[] = [];
    for (let v = 0; v < n; v++) {
      const bit = 1 << (n - 1 - v);
      if (p.mask & bit) ls.push({ v, positive: !!(p.value & bit) });
    }
    return ls;
  };
  const inv = (x: string) => `(${x}${x})'`;
  // literal as a NAND input: x stays x, x' becomes (xx)'
  const input = (l: { v: number; positive: boolean }) => (l.positive ? names[l.v] : inv(names[l.v]));
  // complement of a product, (P)', written with NAND gates only
  const nandOfProduct = (p: Implicant) => {
    const ls = literals(p);
    if (ls.length === 1) return ls[0].positive ? inv(names[ls[0].v]) : names[ls[0].v];
    return `(${ls.map(input).join('')})'`;
  };
  if (imps.length === 1) {
    const ls = literals(imps[0]);
    if (ls.length === 1) return input(ls[0]);
    const nand = nandOfProduct(imps[0]);
    return inv(nand);
  }
  return `(${imps.map(nandOfProduct).join('')})'`;
}

// ---------------------------------------------------------------------------
// Expression parsing
// ---------------------------------------------------------------------------

export class LogicExpressionError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'LogicExpressionError';
    this.position = position;
  }
}

type LNode =
  | { k: 'const'; v: 0 | 1 }
  | { k: 'var'; i: number }
  | { k: 'not'; a: LNode }
  | { k: 'and' | 'or' | 'xor'; a: LNode; b: LNode };

class LogicParser {
  private i = 0;
  readonly used = new Set<number>();
  constructor(private readonly s: string) {}

  parse(): LNode {
    const n = this.or();
    this.ws();
    if (this.i < this.s.length) throw new LogicExpressionError(t('instruments.logic.unexpectedValue', { value: this.s[this.i] }), this.i);
    return n;
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private peek(): string {
    this.ws();
    return this.s[this.i] ?? '';
  }

  private or(): LNode {
    let a = this.xor();
    while (this.peek() === '+' || this.peek() === '|') {
      this.i++;
      a = { k: 'or', a, b: this.xor() };
    }
    return a;
  }

  private xor(): LNode {
    let a = this.and();
    while (this.peek() === '^' || this.peek() === '⊕') {
      this.i++;
      a = { k: 'xor', a, b: this.and() };
    }
    return a;
  }

  private startsFactor(c: string): boolean {
    return /[A-Ha-h01(!~]/.test(c) && c !== '';
  }

  private and(): LNode {
    let a = this.unary();
    for (;;) {
      const c = this.peek();
      if (c === '*' || c === '&' || c === '·' || c === '.') {
        this.i++;
        a = { k: 'and', a, b: this.unary() };
      } else if (this.startsFactor(c)) a = { k: 'and', a, b: this.unary() };
      else return a;
    }
  }

  private unary(): LNode {
    const c = this.peek();
    if (c === '!' || c === '~') {
      this.i++;
      return { k: 'not', a: this.unary() };
    }
    let node = this.primary();
    while (this.peek() === "'" || this.peek() === '’') {
      this.i++;
      node = { k: 'not', a: node };
    }
    return node;
  }

  private primary(): LNode {
    const c = this.peek();
    const pos = this.i;
    if (c === '') throw new LogicExpressionError(t('instruments.logic.unexpectedEndOfExpression'), pos);
    if (c === '(') {
      this.i++;
      const e = this.or();
      if (this.peek() !== ')') throw new LogicExpressionError(t('instruments.logic.missing'), this.i);
      this.i++;
      return e;
    }
    if (c === '0' || c === '1') {
      this.i++;
      return { k: 'const', v: c === '1' ? 1 : 0 };
    }
    const idx = LOGIC_VARS.indexOf(c.toUpperCase() as (typeof LOGIC_VARS)[number]);
    if (idx >= 0) {
      this.i++;
      this.used.add(idx);
      return { k: 'var', i: idx };
    }
    throw new LogicExpressionError(t('instruments.logic.unexpectedCVariablesAreA', { c: c }), pos);
  }
}

export interface ParsedLogic {
  /** evaluate with input values indexed A=0 .. H=7 */
  evaluate(inputs: readonly (0 | 1)[]): 0 | 1;
  /** number of inputs needed: highest variable used + 1 */
  inputs: number;
}

function evalNode(n: LNode, x: readonly (0 | 1)[]): 0 | 1 {
  switch (n.k) {
    case 'const':
      return n.v;
    case 'var':
      return x[n.i] ? 1 : 0;
    case 'not':
      return evalNode(n.a, x) ? 0 : 1;
    case 'and':
      return evalNode(n.a, x) && evalNode(n.b, x) ? 1 : 0;
    case 'or':
      return evalNode(n.a, x) || evalNode(n.b, x) ? 1 : 0;
    case 'xor':
      return evalNode(n.a, x) !== evalNode(n.b, x) ? 1 : 0;
  }
}

export function parseLogicExpression(text: string): ParsedLogic {
  if (!text.trim()) throw new LogicExpressionError(t('instruments.logic.emptyExpression'), 0);
  const p = new LogicParser(text);
  const ast = p.parse();
  const inputs = p.used.size ? Math.max(...p.used) + 1 : 0;
  return { evaluate: (x) => evalNode(ast, x), inputs };
}

/** Truth table (0/1 string) of an expression over `n` inputs (n >= the variables it uses). */
export function expressionToTable(text: string, n?: number): { table: string; inputs: number } {
  const e = parseLogicExpression(text);
  const k = Math.max(1, Math.min(MAX_LOGIC_INPUTS, n ?? e.inputs));
  if (e.inputs > k) throw new LogicExpressionError(t('instruments.logic.expressionUsesInputsInputsBut', { inputs: e.inputs, k: k }), 0);
  let table = '';
  const x: (0 | 1)[] = new Array(MAX_LOGIC_INPUTS).fill(0);
  for (let row = 0; row < 1 << k; row++) {
    for (let v = 0; v < k; v++) x[v] = inputBit(row, v, k);
    table += String(e.evaluate(x));
  }
  return { table, inputs: k };
}

/** Do two truth tables agree on every row that is not a don't-care in `spec`? */
export function tablesEquivalent(spec: string, candidate: string): boolean {
  if (spec.length !== candidate.length) return false;
  for (let i = 0; i < spec.length; i++) if (spec[i] !== 'X' && spec[i] !== candidate[i]) return false;
  return true;
}

/**
 * Truth table read back from a batch of operating-point runs (one run per input combination,
 * in row order). `outputs[row]` is the output voltage; values above `threshold` read 1.
 */
export function tableFromVoltages(outputs: readonly number[], threshold: number): string {
  return outputs.map((v) => (Number.isNaN(v) ? 'X' : v > threshold ? '1' : '0')).join('');
}
