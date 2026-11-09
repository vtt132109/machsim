/**
 * `.meas` / `.measure` cards (ngspice and LTspice syntax) -> MeasDirective (src/sim/netlist.ts).
 *
 *   .meas [TRAN|AC|DC|NOISE] name FIND expr AT=x
 *   .meas OP|TF name FIND expr          (OP and TF results are single points: the value of expr; also PARAM)
 *   .meas ... name FIND expr WHEN lhs=rhs [RISE=n|FALL=n|CROSS=n|LAST] [TD=x]
 *   .meas ... name DERIV expr AT=x | WHEN ...
 *   .meas ... name WHEN lhs=rhs [RISE|FALL|CROSS=n|LAST] [TD=x]          (the x of the crossing)
 *   .meas ... name TRIG cond TARG cond                                    (x(TARG) - x(TRIG))
 *        cond = expr VAL=level [RISE|FALL|CROSS=n|LAST] [TD=x]  |  expr=level [...]  |  AT=x
 *   .meas ... name AVG|RMS|MIN|MAX|PP|INTEG expr [FROM=x1] [TO=x2] [TRIG cond TARG cond]
 *   .meas ... name PARAM expr        (or PARAM=expr; expression of .param values and earlier
 *                                     measurements)
 * Keywords are case-insensitive; `AT x` works without '=' (LTspice); RISE / FALL / CROSS may be
 * LAST; the analysis keyword defaults to TRAN. Expressions are kept as text (evaluated on the
 * results by src/sim/analyses/meas.ts) and may use V(), I(), device outputs such as Ic(Q1), the
 * AC shorthands vdb vm vp vr vi, .param values, earlier measurement names and every function of
 * the SPICE expression language. Numbers after AT= / TD= / FROM= / TO= are evaluated against the
 * global .param values by the reader (ControlContext.num).
 */
import type { MeasAnalysis, MeasCondition, MeasDirective, MeasKind } from '../netlist';
import { CardError } from './lexer';
import { parseExpression } from './expr';

/** Evaluate a number given as text (may use .param values). */
export type MeasNumber = (text: string) => number;

const KINDS: Readonly<Record<string, MeasKind>> = {
  find: 'find',
  deriv: 'deriv',
  derivative: 'deriv',
  when: 'when',
  trig: 'trigtarg',
  avg: 'avg',
  rms: 'rms',
  min: 'min',
  max: 'max',
  pp: 'pp',
  integ: 'integ',
  integral: 'integ',
  param: 'param',
};

const KEYWORDS = new Set(['find', 'when', 'at', 'deriv', 'derivative', 'trig', 'targ', 'val', 'rise', 'fall', 'cross', 'last', 'td', 'from', 'to', 'avg', 'rms', 'min', 'max', 'pp', 'integ', 'integral', 'param']);

/**
 * Split a card into words at parenthesis / brace / quote depth 0; '=' becomes its own word
 * (except inside '==', '<=', '>=' and '!=').
 */
export function measWords(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  const flush = () => {
    if (cur !== '') out.push(cur);
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '(' || c === '{') depth++;
    if (c === ')' || c === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(c)) {
      flush();
      continue;
    }
    if (depth === 0 && c === '=') {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (next === '=' || prev === '=' || prev === '<' || prev === '>' || prev === '!') {
        cur += c;
        continue;
      }
      flush();
      out.push('=');
      continue;
    }
    cur += c;
  }
  if (quote) throw new CardError('unterminated quote');
  flush();
  return out;
}

/** Expression text without one level of '...' / {...} delimiters, syntax checked. */
function exprText(words: readonly string[], what: string): string {
  if (words.length === 0) throw new CardError(`missing ${what}`);
  let s = words.join(' ').trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1).trim();
  else if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).trim();
  try {
    parseExpression(s);
  } catch (e) {
    throw new CardError(`invalid ${what} '${s}': ${(e as Error).message}`);
  }
  return s;
}

class Cursor {
  k = 0;
  constructor(readonly w: readonly string[]) {}
  peek(): string | undefined {
    return this.w[this.k];
  }
  lower(): string {
    return (this.w[this.k] ?? '').toLowerCase();
  }
  isKeyword(): boolean {
    return KEYWORDS.has(this.lower());
  }
  done(): boolean {
    return this.k >= this.w.length;
  }
  next(): string {
    return this.w[this.k++];
  }
  /** Words up to the next keyword (or '=' when stopAtEq). */
  until(stopAtEq: boolean): string[] {
    const out: string[] = [];
    while (!this.done() && !this.isKeyword() && !(stopAtEq && this.peek() === '=')) out.push(this.next());
    return out;
  }
  /** `KEY=value` or `KEY value` after the keyword was consumed. */
  value(key: string): string {
    if (this.peek() === '=') this.k++;
    const v = this.until(false);
    if (v.length === 0) throw new CardError(`missing value after ${key.toUpperCase()}`);
    return v.join(' ');
  }
}

/** RISE / FALL / CROSS / LAST / TD options of a condition. */
function readEdge(c: Cursor, cond: MeasCondition, num: MeasNumber): void {
  for (;;) {
    const w = c.lower();
    if (w === 'rise' || w === 'fall' || w === 'cross') {
      c.next();
      if (c.peek() === '=') c.next();
      // the count, or LAST (a keyword elsewhere)
      const raw = c.done() ? '' : c.next();
      if (raw === '' || raw === '=') throw new CardError(`missing value after ${w.toUpperCase()}`);
      const v = raw.toLowerCase();
      cond.edge = w;
      if (v === 'last') cond.count = 'last';
      else {
        const n = num(v);
        if (!(Number.isInteger(n) && n >= 1)) throw new CardError(`${w.toUpperCase()}= must be a whole number >= 1 or LAST`);
        cond.count = n;
      }
      continue;
    }
    if (w === 'last') {
      c.next();
      cond.count = 'last';
      continue;
    }
    if (w === 'td') {
      c.next();
      cond.td = num(c.value('td'));
      continue;
    }
    return;
  }
}

/** A WHEN / TRIG / TARG condition: `lhs=rhs`, `expr VAL=level` or `AT=x`. */
function readCondition(c: Cursor, num: MeasNumber, what: string): MeasCondition {
  if (c.lower() === 'at') {
    c.next();
    return { at: num(c.value('at')), edge: 'cross', count: 1 };
  }
  const lhs = exprText(c.until(true), `${what} expression`);
  let rhs: string;
  if (c.peek() === '=') {
    c.next();
    rhs = exprText(c.until(false), `${what} level`);
  } else if (c.lower() === 'val') {
    c.next();
    rhs = exprText([c.value('val')], `${what} level`);
  } else throw new CardError(`${what}: expected '=' or VAL= after '${lhs}'`);
  const cond: MeasCondition = { expr: lhs, level: rhs, edge: 'cross', count: 1 };
  readEdge(c, cond, num);
  return cond;
}

/** Parse the text of one .meas card (the whole card, starting with .meas). */
export function parseMeasCard(text: string, num: MeasNumber, line?: number): MeasDirective {
  const words = measWords(text).slice(1);
  const c = new Cursor(words);
  let analysis: MeasAnalysis = 'tran';
  const first = c.lower();
  if (first === 'tran' || first === 'ac' || first === 'dc' || first === 'op' || first === 'noise' || first === 'tf') {
    analysis = first;
    c.next();
  }
  // an OP or TF result is one point: there is no x to measure at, so FIND takes just the expression
  const singlePoint = analysis === 'op' || analysis === 'tf';
  const name = c.next();
  if (!name || name === '=' || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) throw new CardError('.meas: missing or invalid measurement name');
  const kindWord = c.lower();
  const kind = KINDS[kindWord];
  if (!kind) throw new CardError(`.meas ${name}: expected FIND, WHEN, DERIV, TRIG, AVG, RMS, MIN, MAX, PP, INTEG or PARAM, found '${c.peek() ?? ''}'`);
  c.next();
  const d: MeasDirective = { analysis, name, kind, ...(line !== undefined ? { line } : {}) };
  if (singlePoint && kind !== 'find' && kind !== 'param') {
    throw new CardError(`.meas ${analysis.toUpperCase()} ${name}: an ${analysis === 'op' ? 'operating point' : 'transfer function'} is one point, so only FIND <expression> and PARAM can be measured on it`);
  }
  switch (kind) {
    case 'param': {
      if (c.peek() === '=') c.next();
      d.expr = exprText(c.w.slice(c.k), 'PARAM expression');
      c.k = c.w.length;
      break;
    }
    case 'find':
    case 'deriv': {
      d.expr = exprText(c.until(false), `${kind.toUpperCase()} expression`);
      const w = c.lower();
      if (w === 'at') {
        c.next();
        d.at = num(c.value('at'));
      } else if (w === 'when') {
        c.next();
        d.when = readCondition(c, num, 'WHEN');
      } else if (!(singlePoint && kind === 'find')) throw new CardError(`.meas ${name}: ${kind.toUpperCase()} needs AT= or WHEN`);
      break;
    }
    case 'when':
      d.when = readCondition(c, num, 'WHEN');
      break;
    case 'trigtarg':
      d.trig = readCondition(c, num, 'TRIG');
      if (c.lower() !== 'targ') throw new CardError(`.meas ${name}: TRIG needs a TARG`);
      c.next();
      d.targ = readCondition(c, num, 'TARG');
      break;
    default: {
      d.expr = exprText(c.until(false), `${kindWord.toUpperCase()} expression`);
      while (!c.done()) {
        const w = c.lower();
        if (w === 'from') {
          c.next();
          d.from = num(c.value('from'));
        } else if (w === 'to') {
          c.next();
          d.to = num(c.value('to'));
        } else if (w === 'trig') {
          c.next();
          d.trig = readCondition(c, num, 'TRIG');
        } else if (w === 'targ') {
          c.next();
          d.targ = readCondition(c, num, 'TARG');
        } else break;
      }
      if (d.from !== undefined && d.to !== undefined && !(d.to > d.from)) throw new CardError(`.meas ${name}: TO must be above FROM`);
    }
  }
  if (!c.done()) throw new CardError(`.meas ${name}: unexpected '${c.peek()}'`);
  return d;
}

/** Card text of a directive (writer round trip). */
export function formatMeasCard(d: MeasDirective, num: (v: number) => string): string {
  const cond = (x: MeasCondition): string => {
    if (x.at !== undefined) return `AT=${num(x.at)}`;
    const parts = [`${x.expr}=${x.level}`];
    if (x.count === 'last') parts.push(x.edge === 'cross' ? 'CROSS=LAST' : `${x.edge.toUpperCase()}=LAST`);
    else if (x.edge !== 'cross' || x.count !== 1) parts.push(`${x.edge.toUpperCase()}=${x.count}`);
    if (x.td !== undefined) parts.push(`TD=${num(x.td)}`);
    return parts.join(' ');
  };
  const head = `.meas ${d.analysis.toUpperCase()} ${d.name}`;
  switch (d.kind) {
    case 'param':
      return `${head} PARAM {${d.expr}}`;
    case 'find':
    case 'deriv':
      return `${head} ${d.kind.toUpperCase()} ${d.expr}${d.at !== undefined ? ` AT=${num(d.at)}` : d.when ? ` WHEN ${cond(d.when)}` : ''}`;
    case 'when':
      return `${head} WHEN ${cond(d.when!)}`;
    case 'trigtarg':
      return `${head} TRIG ${cond(d.trig!)} TARG ${cond(d.targ!)}`;
    default: {
      const parts = [head, d.kind.toUpperCase(), d.expr ?? ''];
      if (d.from !== undefined) parts.push(`FROM=${num(d.from)}`);
      if (d.to !== undefined) parts.push(`TO=${num(d.to)}`);
      if (d.trig) parts.push(`TRIG ${cond(d.trig)}`);
      if (d.targ) parts.push(`TARG ${cond(d.targ)}`);
      return parts.join(' ');
    }
  }
}
