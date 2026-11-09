/**
 * Logic programs of the PLD block: Boolean equations or a truth table, compiled to fast
 * evaluators. Pure module (no engine dependencies): the library uses it to check a program and
 * show errors, the D_PLD code model (pld.ts) to evaluate it.
 *
 * Equations (one per line, or separated by ';'; comments start with '//' or '#'):
 *     O0 = I0 & I1 | !I2          combinational output
 *     O1 := O1 ^ I0               registered output (D flip-flop, rising CLK)
 *     O2.oe = I3                  output enable of O2 (default: enabled)
 *   Names: inputs I0..I(n-1), outputs O0..O(m-1) (as operands: the output's present value, i.e.
 *   feedback), constants 0 and 1; case does not matter.
 *   Operators by priority: NOT (prefix ! ~ / NOT, or postfix '), AND (& * · AND),
 *   XOR (^ ⊕ XOR), OR (| + OR); parentheses group.
 *
 * Truth table: a header naming the inputs, '|', then the outputs; one row per line with 0 / 1 /
 * '-' (don't care) for inputs and 0 / 1 for outputs. Each output is the OR of the rows where it
 * is 1 (rows not listed give 0):
 *     I1 I0 | O0 O1
 *     0  0  | 0  1
 *     1  -  | 1  0
 */

export type LogicFn = (inputs: ArrayLike<number>, outputs: ArrayLike<number>) => number;

export interface CompiledOutput {
  /** output index (O<index>) */
  index: number;
  registered: boolean;
  fn: LogicFn;
  /** parsed expression (HDL export: src/model/hdl.ts) */
  node: LogicNode;
  /** parsed output-enable expression */
  oeNode?: LogicNode;
  /** output enable (undefined = always enabled) */
  oe?: LogicFn;
  /** normalised equation text */
  text: string;
  oeText?: string;
}

export interface LogicProgram {
  outputs: CompiledOutput[];
  errors: string[];
  kind: 'equations' | 'table' | 'empty';
}

// ---------------------------------------------------------------------------------------------
// expression parser

/**
 * Parsed Boolean expression. Exported so other modules can walk it instead of re-parsing the
 * normalised text (the VHDL / Verilog export in src/model/hdl.ts does).
 */
export type LogicNode =
  | { k: 'c'; v: number }
  | { k: 'i'; i: number }
  | { k: 'o'; i: number }
  | { k: 'not'; a: LogicNode }
  | { k: 'and' | 'or' | 'xor'; a: LogicNode; b: LogicNode };

type Node = LogicNode;

interface Tok {
  t: 'name' | 'op' | 'lp' | 'rp' | 'num';
  v: string;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') out.push({ t: 'lp', v: c });
    else if (c === ')') out.push({ t: 'rp', v: c });
    else if ('!~/'.includes(c)) out.push({ t: 'op', v: '!' });
    else if (c === "'") out.push({ t: 'op', v: "'" });
    else if ('&*·'.includes(c)) out.push({ t: 'op', v: '&' });
    else if ('|+'.includes(c)) out.push({ t: 'op', v: '|' });
    else if ('^⊕'.includes(c)) out.push({ t: 'op', v: '^' });
    else if (/[A-Za-z_0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      const w = src.slice(i, j);
      const up = w.toUpperCase();
      if (up === 'AND') out.push({ t: 'op', v: '&' });
      else if (up === 'OR') out.push({ t: 'op', v: '|' });
      else if (up === 'XOR') out.push({ t: 'op', v: '^' });
      else if (up === 'NOT') out.push({ t: 'op', v: '!' });
      else if (/^[01]$/.test(w)) out.push({ t: 'num', v: w });
      else out.push({ t: 'name', v: up });
      i = j;
      continue;
    } else throw new Error(`unexpected character '${c}'`);
    i++;
  }
  return out;
}

function parseExpr(src: string, nIn: number, nOut: number): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) return fail('expression ends too early');
    let node: Node;
    if (t.t === 'lp') {
      node = or();
      if (toks[p]?.t !== 'rp') fail("missing ')'");
      p++;
    } else if (t.t === 'num') node = { k: 'c', v: Number(t.v) };
    else if (t.t === 'name') {
      const m = t.v.match(/^([IO])(\d+)$/);
      if (!m) return fail(`unknown name '${t.v}' (use I0..I${nIn - 1} and O0..O${nOut - 1})`);
      const idx = Number(m[2]);
      if (m[1] === 'I' && idx >= nIn) fail(`input ${t.v} does not exist (I0..I${nIn - 1})`);
      if (m[1] === 'O' && idx >= nOut) fail(`output ${t.v} does not exist (O0..O${nOut - 1})`);
      node = m[1] === 'I' ? { k: 'i', i: idx } : { k: 'o', i: idx };
    } else if (t.t === 'op' && t.v === '!') node = { k: 'not', a: primary() };
    else return fail(`unexpected '${t.v}'`);
    while (peek()?.t === 'op' && peek().v === "'") {
      p++;
      node = { k: 'not', a: node };
    }
    return node;
  };
  const and = (): Node => {
    let a = primary();
    while (peek()?.t === 'op' && peek().v === '&') {
      p++;
      a = { k: 'and', a, b: primary() };
    }
    return a;
  };
  const xor = (): Node => {
    let a = and();
    while (peek()?.t === 'op' && peek().v === '^') {
      p++;
      a = { k: 'xor', a, b: and() };
    }
    return a;
  };
  const or = (): Node => {
    let a = xor();
    while (peek()?.t === 'op' && peek().v === '|') {
      p++;
      a = { k: 'or', a, b: xor() };
    }
    return a;
  };
  if (toks.length === 0) fail('empty expression');
  const node = or();
  if (p < toks.length) fail(`unexpected '${toks[p].v}'`);
  return node;
}

function compileNode(n: Node): LogicFn {
  switch (n.k) {
    case 'c': {
      const v = n.v;
      return () => v;
    }
    case 'i': {
      const i = n.i;
      return (inp) => inp[i];
    }
    case 'o': {
      const i = n.i;
      return (_inp, out) => (out[i] === 1 ? 1 : 0);
    }
    case 'not': {
      const a = compileNode(n.a);
      return (inp, out) => 1 - a(inp, out);
    }
    case 'and': {
      const a = compileNode(n.a);
      const b = compileNode(n.b);
      return (inp, out) => a(inp, out) & b(inp, out);
    }
    case 'or': {
      const a = compileNode(n.a);
      const b = compileNode(n.b);
      return (inp, out) => a(inp, out) | b(inp, out);
    }
    case 'xor': {
      const a = compileNode(n.a);
      const b = compileNode(n.b);
      return (inp, out) => a(inp, out) ^ b(inp, out);
    }
  }
}

function nodeText(n: Node, parent = 0): string {
  // priorities: or 1, xor 2, and 3
  const wrap = (s: string, prio: number) => (prio < parent ? `(${s})` : s);
  switch (n.k) {
    case 'c':
      return String(n.v);
    case 'i':
      return `I${n.i}`;
    case 'o':
      return `O${n.i}`;
    case 'not':
      return `!${nodeText(n.a, 4)}`;
    case 'and':
      return wrap(`${nodeText(n.a, 3)} & ${nodeText(n.b, 3)}`, 3);
    case 'xor':
      return wrap(`${nodeText(n.a, 2)} ^ ${nodeText(n.b, 2)}`, 2);
    case 'or':
      return wrap(`${nodeText(n.a, 1)} | ${nodeText(n.b, 1)}`, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// programs

function cleanLines(text: string): { line: string; no: number }[] {
  const out: { line: string; no: number }[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      let s = raw;
      const a = s.indexOf('//');
      if (a >= 0) s = s.slice(0, a);
      const b = s.indexOf('#');
      if (b >= 0) s = s.slice(0, b);
      for (const part of s.split(';')) if (part.trim()) out.push({ line: part.trim(), no: i + 1 });
    });
  return out;
}

/** Truth-table text converted to equations (one "O<k> = ..." line per output). */
export function truthTableToEquations(text: string, nIn: number, nOut: number): { equations: string; errors: string[] } {
  const lines = cleanLines(text);
  const errors: string[] = [];
  if (lines.length === 0) return { equations: '', errors };
  const [head, ...rows] = lines;
  const sides = head.line.split('|');
  if (sides.length !== 2) return { equations: '', errors: [`line ${head.no}: the header needs input names, '|', output names`] };
  const ins = sides[0].trim().split(/\s+/).filter(Boolean).map((s) => s.toUpperCase());
  const outs = sides[1].trim().split(/\s+/).filter(Boolean).map((s) => s.toUpperCase());
  for (const n of ins) {
    const m = n.match(/^([IO])(\d+)$/);
    if (!m || (m[1] === 'I' ? Number(m[2]) >= nIn : Number(m[2]) >= nOut)) errors.push(`line ${head.no}: unknown input column '${n}'`);
  }
  for (const n of outs) {
    const m = n.match(/^O(\d+)$/);
    if (!m || Number(m[1]) >= nOut) errors.push(`line ${head.no}: unknown output column '${n}'`);
  }
  if (errors.length) return { equations: '', errors };
  const terms = new Map<string, string[]>();
  for (const o of outs) terms.set(o, []);
  for (const r of rows) {
    const cells = r.line.replace('|', ' | ').split(/\s+/).filter((c) => c && c !== '|');
    if (cells.length !== ins.length + outs.length) {
      errors.push(`line ${r.no}: expected ${ins.length} input and ${outs.length} output values`);
      continue;
    }
    const lits: string[] = [];
    let ok = true;
    ins.forEach((name, k) => {
      const c = cells[k].toLowerCase();
      if (c === '1') lits.push(name);
      else if (c === '0') lits.push(`!${name}`);
      else if (c !== '-' && c !== 'x') ok = false;
    });
    if (!ok) {
      errors.push(`line ${r.no}: input values must be 0, 1 or -`);
      continue;
    }
    const product = lits.length ? lits.join(' & ') : '1';
    outs.forEach((name, k) => {
      const c = cells[ins.length + k];
      if (c === '1') terms.get(name)!.push(lits.length > 1 ? `(${product})` : product);
      else if (c !== '0' && c !== '-' && c.toLowerCase() !== 'x') errors.push(`line ${r.no}: output values must be 0 or 1`);
    });
  }
  const eq = outs.map((o) => `${o} = ${terms.get(o)!.length ? terms.get(o)!.join(' | ') : '0'}`).join('\n');
  return { equations: eq, errors };
}

/** True when the program text is a truth table (first line has '|' and no '='). */
export function isTruthTable(text: string): boolean {
  const first = cleanLines(text)[0];
  return !!first && first.line.includes('|') && !first.line.includes('=');
}

/** Compile a PLD program for nIn inputs and nOut outputs. */
export function compileLogicProgram(text: string, nIn: number, nOut: number): LogicProgram {
  let src = text;
  let kind: LogicProgram['kind'] = 'equations';
  const errors: string[] = [];
  if (isTruthTable(text)) {
    const r = truthTableToEquations(text, nIn, nOut);
    errors.push(...r.errors);
    src = r.equations;
    kind = 'table';
  }
  const lines = cleanLines(src);
  if (lines.length === 0) return { outputs: [], errors, kind: errors.length ? kind : 'empty' };
  const byIndex = new Map<number, CompiledOutput>();
  const oes = new Map<number, { fn: LogicFn; text: string; node: Node }>();
  for (const { line, no } of lines) {
    const m = line.match(/^\s*O(\d+)\s*(\.\s*OE\s*)?(:=|=)\s*(.*)$/i);
    if (!m) {
      errors.push(`line ${no}: expected "O<k> = expression", "O<k> := expression" or "O<k>.oe = expression"`);
      continue;
    }
    const idx = Number(m[1]);
    if (idx >= nOut) {
      errors.push(`line ${no}: output O${idx} does not exist (O0..O${nOut - 1})`);
      continue;
    }
    let node: Node;
    try {
      node = parseExpr(m[4], nIn, nOut);
    } catch (e) {
      errors.push(`line ${no}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (m[2]) {
      if (m[3] === ':=') errors.push(`line ${no}: an output enable uses '=', not ':='`);
      oes.set(idx, { fn: compileNode(node), text: nodeText(node), node });
      continue;
    }
    if (byIndex.has(idx)) {
      errors.push(`line ${no}: O${idx} is defined twice`);
      continue;
    }
    byIndex.set(idx, { index: idx, registered: m[3] === ':=', fn: compileNode(node), node, text: nodeText(node) });
  }
  for (const [idx, oe] of oes) {
    const o = byIndex.get(idx);
    if (!o) errors.push(`O${idx}.oe is given but O${idx} has no equation`);
    else {
      o.oe = oe.fn;
      o.oeText = oe.text;
      o.oeNode = oe.node;
    }
  }
  const outputs = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return { outputs, errors, kind };
}

/** Parse one Boolean expression into its AST (throws Error with a readable message). */
export function parseLogicExpr(src: string, nIn: number, nOut: number): LogicNode {
  return parseExpr(src, nIn, nOut);
}

/** Normalised equations of a compiled program (one line per output and enable). */
export function programText(p: LogicProgram): string {
  const lines: string[] = [];
  for (const o of p.outputs) {
    lines.push(`O${o.index} ${o.registered ? ':=' : '='} ${o.text}`);
    if (o.oeText) lines.push(`O${o.index}.oe = ${o.oeText}`);
  }
  return lines.join('\n');
}
