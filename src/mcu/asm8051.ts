/**
 * Two-pass MCS-51 assembler (original implementation; the mnemonic set and the operand forms are
 * the published MCS-51 assembly language, the encodings follow the public opcode map).
 *
 * Syntax (common Intel style, case insensitive)
 *   `label:`                   a label; it takes the current address
 *   `; comment`                to the end of the line
 *   `ORG expr`                 continue assembling at this address
 *   `name EQU expr`            a constant (`SET` may be redefined; `DATA`, `BIT`, `CODE`, `XDATA`
 *                              and `IDATA` are accepted as synonyms that say what the value means)
 *   `DB e, 'text', …`          bytes (a string gives one byte per character)
 *   `DW e, …`                  16-bit words, high byte first (MCS-51 order)
 *   `DS n`                     reserve n bytes (they stay 0)
 *   `END`                      stop assembling
 *   expressions                `+ - * /`, `MOD`, `AND OR XOR NOT` (`& | ^ ~`), `SHL SHR`
 *                              (`<< >>`), `HIGH LOW`, parentheses, `$` = the current address,
 *                              labels and constants; numbers as 1234, 0x1F, 1Fh, 1010b, 17q, 'A'
 *   bit operands               `P1.0`, `ACC.7`, `20h.3`, a name defined with BIT, and `/bit` for
 *                              the complement in `ANL C,/bit` / `ORL C,/bit`
 *
 * Every problem comes back as a structured {@link AsmError} with its source line, so the code
 * editor can show it in Vietnamese or English (`src/i18n/mcuText.ts` `asmErrorText`) and jump to
 * the line. Assembling always returns what it could encode, so a listing exists even with errors.
 */
import { BIT_NAMES, SFR_NAMES } from './cpu8051';

export type AsmErrorCode =
  | 'badChar'
  | 'badDirective'
  | 'badExpr'
  | 'badNumber'
  | 'badOperands'
  | 'badString'
  | 'duplicateSymbol'
  | 'notBit'
  | 'orgRange'
  | 'pageMismatch'
  | 'rangeByte'
  | 'rangeWord'
  | 'relTooFar'
  | 'reservedName'
  | 'tooLong'
  | 'undefinedSymbol'
  | 'unknownMnemonic';

export interface AsmError {
  /** 1-based source line */
  line: number;
  code: AsmErrorCode;
  /** the offending text, for the message */
  text?: string;
  value?: number;
}

export type SymbolKind = 'label' | 'number' | 'bit';

export interface AsmSymbol {
  name: string;
  value: number;
  kind: SymbolKind;
  /** source line that defined it (0 for the predefined register names) */
  line: number;
}

/** One assembled source line. */
export interface AsmLine {
  /** 1-based source line */
  line: number;
  /** address of the first byte (or of the label) */
  addr?: number;
  bytes: number[];
  /** the source text without trailing blanks */
  text: string;
}

export interface AsmResult {
  /** 64 KB program image (holes are 0) */
  bytes: Uint8Array;
  /** lowest and highest address written (end exclusive; 0 / 0 when nothing was) */
  start: number;
  end: number;
  errors: AsmError[];
  lines: AsmLine[];
  symbols: AsmSymbol[];
  /** address of an instruction's first byte -> 1-based source line */
  addrLine: Map<number, number>;
}

const CODE_SIZE = 0x10000;
const NAME_RE = /^[A-Za-z_?][A-Za-z0-9_?]*$/;
const DIRECTIVES = new Set(['ORG', 'EQU', 'SET', 'DATA', 'BIT', 'CODE', 'XDATA', 'IDATA', 'DB', 'DW', 'DS', 'END']);

/** Predefined symbols: the SFR names and the bit names of the core. */
export function predefinedSymbols(): Map<string, AsmSymbol> {
  const m = new Map<string, AsmSymbol>();
  for (const s of SFR_NAMES) m.set(s.name, { name: s.name, value: s.addr, kind: 'number', line: 0 });
  for (const b of BIT_NAMES) if (!m.has(b.name)) m.set(b.name, { name: b.name, value: b.addr, kind: 'bit', line: 0 });
  return m;
}

// ---------------------------------------------------------------------------------------------
// line parsing

interface Parsed {
  line: number;
  text: string;
  label?: string;
  op?: string;
  args: string[];
  /** raw operand text, for error messages */
  rest: string;
}

/** Split operands on top-level commas (quotes and parentheses protect their contents). */
function splitArgs(rest: string): string[] {
  if (rest.trim().length === 0) return [];
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = '';
  for (const c of rest) {
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
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function stripComment(raw: string): string {
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === ';') return raw.slice(0, i);
  }
  return raw;
}

function parseLine(raw: string, no: number): Parsed {
  const p: Parsed = { line: no, text: raw.replace(/\s+$/, ''), args: [], rest: '' };
  let s = stripComment(raw).trim();
  const lab = s.match(/^([A-Za-z_?][A-Za-z0-9_?]*)\s*:/);
  if (lab) {
    p.label = lab[1].toUpperCase();
    s = s.slice(lab[0].length).trim();
  }
  if (s.length === 0) return p;
  const m = s.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return p;
  let op = m[1].toUpperCase();
  let rest = m[2].trim();
  // "name EQU expr" / "name BIT expr": the first word names the symbol
  if (p.label === undefined && !DIRECTIVES.has(op) && NAME_RE.test(op) && !MNEMONICS[op]) {
    const second = rest.match(/^(\S+)\s*([\s\S]*)$/);
    if (second && DIRECTIVES.has(second[1].toUpperCase())) {
      p.label = op;
      op = second[1].toUpperCase();
      rest = second[2].trim();
    }
  }
  p.op = op;
  p.rest = rest;
  p.args = splitArgs(rest);
  return p;
}

// ---------------------------------------------------------------------------------------------
// expressions

class ExprError extends Error {
  constructor(
    readonly code: AsmErrorCode,
    readonly text?: string,
  ) {
    super(code);
    this.name = 'ExprError';
  }
}

interface EvalCtx {
  symbols: Map<string, AsmSymbol>;
  /** value of '$' */
  here: number;
  /** pass 1: an unknown symbol gives 0 and sets `unresolved` instead of throwing */
  lenient: boolean;
  unresolved?: boolean;
}

const WORD_OPS = new Set(['MOD', 'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR', 'HIGH', 'LOW']);

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string } | { k: 'here' };

function tokenizeExpr(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '$') {
      out.push({ k: 'here' });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let v = 0;
      let n = 0;
      while (j < src.length && src[j] !== c) {
        v = (v << 8) | (src.charCodeAt(j) & 0xff);
        n++;
        j++;
      }
      if (j >= src.length || n === 0 || n > 2) throw new ExprError('badString', src.slice(i));
      out.push({ k: 'num', v });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9A-Fa-f]/.test(src[j])) j++;
      if (j < src.length && /[HhBbQqOoDdXx]/.test(src[j])) j++;
      // 0x.. needs the digits after the x as well
      if (/^0[xX]$/.test(src.slice(i, j))) while (j < src.length && /[0-9A-Fa-f]/.test(src[j])) j++;
      // "20h.3": a bit of a numeric byte address
      if (src[j] === '.' && /[0-7]/.test(src[j + 1] ?? '')) {
        out.push({ k: 'name', v: src.slice(i, j + 2).toUpperCase() });
        i = j + 2;
        continue;
      }
      out.push({ k: 'num', v: parseNumber(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_?]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_?.]/.test(src[j])) j++;
      const w = src.slice(i, j).toUpperCase();
      out.push(WORD_OPS.has(w) ? { k: 'op', v: w } : { k: 'name', v: w });
      i = j;
      continue;
    }
    if ('+-*/()'.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if (c === '<' && src[i + 1] === '<') {
      out.push({ k: 'op', v: 'SHL' });
      i += 2;
      continue;
    }
    if (c === '>' && src[i + 1] === '>') {
      out.push({ k: 'op', v: 'SHR' });
      i += 2;
      continue;
    }
    if (c === '&') out.push({ k: 'op', v: 'AND' });
    else if (c === '|') out.push({ k: 'op', v: 'OR' });
    else if (c === '^') out.push({ k: 'op', v: 'XOR' });
    else if (c === '~') out.push({ k: 'op', v: 'NOT' });
    else throw new ExprError('badChar', c);
    i++;
  }
  return out;
}

/** A number in any of the accepted radices (decimal, 0x.., ..h, ..b, ..q / ..o). */
export function parseNumber(text: string): number {
  const t = text.trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^[0-9][0-9a-fA-F]*[hH]$/.test(t)) return parseInt(t.slice(0, -1), 16);
  if (/^[01]+[bB]$/.test(t)) return parseInt(t.slice(0, -1), 2);
  if (/^[0-7]+[qQoO]$/.test(t)) return parseInt(t.slice(0, -1), 8);
  if (/^[0-9]+[dD]?$/.test(t)) return parseInt(t.replace(/[dD]$/, ''), 10);
  throw new ExprError('badNumber', t);
}

/** Value of a `name.bit` reference, or undefined when the text has no dot. */
function dottedBit(name: string, ctx: EvalCtx): number | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const base = name.slice(0, dot);
  const bitText = name.slice(dot + 1);
  if (!/^[0-7]$/.test(bitText)) throw new ExprError('notBit', name);
  const bit = Number(bitText);
  let addr: number;
  if (NAME_RE.test(base)) {
    const sym = ctx.symbols.get(base);
    if (!sym) {
      if (ctx.lenient) {
        ctx.unresolved = true;
        return 0;
      }
      throw new ExprError('undefinedSymbol', base);
    }
    addr = sym.value;
  } else addr = parseNumber(base);
  if (addr >= 0x80 && addr <= 0xff && addr % 8 === 0) return addr + bit;
  if (addr >= 0x20 && addr <= 0x2f) return (addr - 0x20) * 8 + bit;
  throw new ExprError('notBit', name);
}

function evalExpr(src: string, ctx: EvalCtx): number {
  const toks = tokenizeExpr(src);
  if (toks.length === 0) throw new ExprError('badExpr', src);
  let p = 0;
  const isOp = (v: string): boolean => {
    const t = toks[p];
    return t !== undefined && t.k === 'op' && t.v === v;
  };
  const primary = (): number => {
    const t = toks[p++];
    if (!t) throw new ExprError('badExpr', src);
    if (t.k === 'num') return t.v;
    if (t.k === 'here') return ctx.here;
    if (t.k === 'name') {
      const dotted = dottedBit(t.v, ctx);
      if (dotted !== undefined) return dotted;
      const sym = ctx.symbols.get(t.v);
      if (sym) return sym.value;
      if (ctx.lenient) {
        ctx.unresolved = true;
        return 0;
      }
      throw new ExprError('undefinedSymbol', t.v);
    }
    if (t.v === '(') {
      const v = orLevel();
      if (!isOp(')')) throw new ExprError('badExpr', src);
      p++;
      return v;
    }
    if (t.v === '-') return -primary();
    if (t.v === '+') return primary();
    if (t.v === 'NOT') return ~primary() & 0xffff;
    if (t.v === 'HIGH') return (primary() >> 8) & 0xff;
    if (t.v === 'LOW') return primary() & 0xff;
    throw new ExprError('badExpr', src);
  };
  const mulLevel = (): number => {
    let a = primary();
    for (;;) {
      if (isOp('*')) {
        p++;
        a = a * primary();
      } else if (isOp('/')) {
        p++;
        const b = primary();
        a = b === 0 ? 0 : Math.trunc(a / b);
      } else if (isOp('MOD')) {
        p++;
        const b = primary();
        a = b === 0 ? 0 : a % b;
      } else if (isOp('SHL')) {
        p++;
        a = (a << primary()) & 0xffff;
      } else if (isOp('SHR')) {
        p++;
        a = a >> primary();
      } else return a;
    }
  };
  const addLevel = (): number => {
    let a = mulLevel();
    for (;;) {
      if (isOp('+')) {
        p++;
        a = a + mulLevel();
      } else if (isOp('-')) {
        p++;
        a = a - mulLevel();
      } else return a;
    }
  };
  const andLevel = (): number => {
    let a = addLevel();
    while (isOp('AND')) {
      p++;
      a = a & addLevel();
    }
    return a;
  };
  const orLevel = (): number => {
    let a = andLevel();
    for (;;) {
      if (isOp('OR')) {
        p++;
        a = a | andLevel();
      } else if (isOp('XOR')) {
        p++;
        a = a ^ andLevel();
      } else return a;
    }
  };
  const v = orLevel();
  if (p < toks.length) throw new ExprError('badExpr', src);
  return v;
}

// ---------------------------------------------------------------------------------------------
// operands and encoders

type OperandKind = 'A' | 'AB' | 'C' | 'DPTR' | '@DPTR' | '@A+DPTR' | '@A+PC' | '@Ri' | 'Rn' | '#' | '/' | 'expr';

interface Operand {
  kind: OperandKind;
  /** register index of Rn / @Ri */
  index: number;
  /** expression text of '#', '/' and 'expr' */
  expr: string;
}

function classify(text: string): Operand {
  const t = text.trim();
  const up = t.toUpperCase();
  const tight = up.replace(/\s+/g, '');
  if (up === 'A') return { kind: 'A', index: 0, expr: '' };
  if (up === 'AB') return { kind: 'AB', index: 0, expr: '' };
  if (up === 'C') return { kind: 'C', index: 0, expr: '' };
  if (up === 'DPTR') return { kind: 'DPTR', index: 0, expr: '' };
  if (tight === '@DPTR') return { kind: '@DPTR', index: 0, expr: '' };
  if (tight === '@A+DPTR') return { kind: '@A+DPTR', index: 0, expr: '' };
  if (tight === '@A+PC') return { kind: '@A+PC', index: 0, expr: '' };
  const ri = tight.match(/^@R([01])$/);
  if (ri) return { kind: '@Ri', index: Number(ri[1]), expr: '' };
  const rn = up.match(/^R([0-7])$/);
  if (rn) return { kind: 'Rn', index: Number(rn[1]), expr: '' };
  if (t.startsWith('#')) return { kind: '#', index: 0, expr: t.slice(1).trim() };
  if (t.startsWith('/')) return { kind: '/', index: 0, expr: t.slice(1).trim() };
  return { kind: 'expr', index: 0, expr: t };
}

/**
 * Context an encoder uses. In `probe` mode (pass 1) every expression gives 0 and no range is
 * checked, so only the LENGTH of the encoding matters; pass 2 evaluates and checks for real.
 */
interface EncodeCtx {
  /** address of the instruction */
  addr: number;
  probe: boolean;
  /** raw value of an expression */
  value(expr: string): number;
  /** value as a byte (range checked) */
  byte(expr: string): number;
  /** value as a 16-bit word (range checked) */
  word(expr: string): number;
  /** relative displacement to the expression's target from addr + len */
  rel(expr: string, len: number): number;
  /** 11-bit page address for AJMP / ACALL, checked against addr + len */
  page(expr: string, len: number): number;
}

function makeCtx(addr: number, probe: boolean, evaluate: (expr: string) => number): EncodeCtx {
  const val = (expr: string): number => (probe ? 0 : evaluate(expr));
  return {
    addr,
    probe,
    value: val,
    byte: (expr) => {
      const v = val(expr);
      if (!probe && (v < -256 || v > 255)) throw new ExprError('rangeByte', String(v));
      return v & 0xff;
    },
    word: (expr) => {
      const v = val(expr);
      if (!probe && (v < -0x10000 || v > 0xffff)) throw new ExprError('rangeWord', String(v));
      return v & 0xffff;
    },
    rel: (expr, len) => {
      if (probe) return 0;
      const d = val(expr) - (addr + len);
      if (d < -128 || d > 127) throw new ExprError('relTooFar', String(d));
      return d & 0xff;
    },
    page: (expr, len) => {
      if (probe) return 0;
      const target = val(expr) & 0xffff;
      if ((target & 0xf800) !== ((addr + len) & 0xf800)) throw new ExprError('pageMismatch', String(target));
      return target & 0x7ff;
    },
  };
}

type Encoder = (ops: Operand[], ctx: EncodeCtx) => number[];

const no = (): number[] => {
  throw new ExprError('badOperands');
};

/** The regular "A,<operand>" arithmetic / logic group. */
function accGroup(rnBase: number, direct: number, riBase: number, imm: number): Encoder {
  return (ops, ctx) => {
    if (ops.length !== 2 || ops[0].kind !== 'A') return no();
    const o = ops[1];
    if (o.kind === 'Rn') return [rnBase + o.index];
    if (o.kind === '@Ri') return [riBase + o.index];
    if (o.kind === '#') return [imm, ctx.byte(o.expr)];
    if (o.kind === 'expr') return [direct, ctx.byte(o.expr)];
    return no();
  };
}

/** ANL / ORL / XRL: the accumulator forms plus "direct,A", "direct,#data" and the carry forms. */
function bitwise(rnBase: number, direct: number, riBase: number, imm: number, dirA: number, dirImm: number, cBit?: number, cNotBit?: number): Encoder {
  const acc = accGroup(rnBase, direct, riBase, imm);
  return (ops, ctx) => {
    if (ops.length !== 2) return no();
    const [d, s] = ops;
    if (d.kind === 'A') return acc(ops, ctx);
    if (d.kind === 'C') {
      if (cBit === undefined || cNotBit === undefined) return no();
      if (s.kind === 'expr') return [cBit, ctx.byte(s.expr)];
      if (s.kind === '/') return [cNotBit, ctx.byte(s.expr)];
      return no();
    }
    if (d.kind === 'expr') {
      if (s.kind === 'A') return [dirA, ctx.byte(d.expr)];
      if (s.kind === '#') return [dirImm, ctx.byte(d.expr), ctx.byte(s.expr)];
      return no();
    }
    return no();
  };
}

function shortJump(op: number): Encoder {
  return (ops, ctx) => (ops.length === 1 && ops[0].kind === 'expr' ? [op, ctx.rel(ops[0].expr, 2)] : no());
}

function bitJump(op: number): Encoder {
  return (ops, ctx) =>
    ops.length === 2 && ops[0].kind === 'expr' && ops[1].kind === 'expr' ? [op, ctx.byte(ops[0].expr), ctx.rel(ops[1].expr, 3)] : no();
}

const MNEMONICS: Record<string, Encoder> = {
  NOP: (ops) => (ops.length === 0 ? [0x00] : no()),
  RET: (ops) => (ops.length === 0 ? [0x22] : no()),
  RETI: (ops) => (ops.length === 0 ? [0x32] : no()),
  RL: (ops) => (ops.length === 1 && ops[0].kind === 'A' ? [0x23] : no()),
  RLC: (ops) => (ops.length === 1 && ops[0].kind === 'A' ? [0x33] : no()),
  RR: (ops) => (ops.length === 1 && ops[0].kind === 'A' ? [0x03] : no()),
  RRC: (ops) => (ops.length === 1 && ops[0].kind === 'A' ? [0x13] : no()),
  SWAP: (ops) => (ops.length === 1 && ops[0].kind === 'A' ? [0xc4] : no()),
  DA: (ops) => (ops.length === 1 && ops[0].kind === 'A' ? [0xd4] : no()),
  MUL: (ops) => (ops.length === 1 && ops[0].kind === 'AB' ? [0xa4] : no()),
  DIV: (ops) => (ops.length === 1 && ops[0].kind === 'AB' ? [0x84] : no()),

  ADD: accGroup(0x28, 0x25, 0x26, 0x24),
  ADDC: accGroup(0x38, 0x35, 0x36, 0x34),
  SUBB: accGroup(0x98, 0x95, 0x96, 0x94),
  ANL: bitwise(0x58, 0x55, 0x56, 0x54, 0x52, 0x53, 0x82, 0xb0),
  ORL: bitwise(0x48, 0x45, 0x46, 0x44, 0x42, 0x43, 0x72, 0xa0),
  XRL: bitwise(0x68, 0x65, 0x66, 0x64, 0x62, 0x63),

  INC: (ops, ctx) => {
    if (ops.length !== 1) return no();
    const o = ops[0];
    if (o.kind === 'A') return [0x04];
    if (o.kind === 'Rn') return [0x08 + o.index];
    if (o.kind === '@Ri') return [0x06 + o.index];
    if (o.kind === 'DPTR') return [0xa3];
    if (o.kind === 'expr') return [0x05, ctx.byte(o.expr)];
    return no();
  },
  DEC: (ops, ctx) => {
    if (ops.length !== 1) return no();
    const o = ops[0];
    if (o.kind === 'A') return [0x14];
    if (o.kind === 'Rn') return [0x18 + o.index];
    if (o.kind === '@Ri') return [0x16 + o.index];
    if (o.kind === 'expr') return [0x15, ctx.byte(o.expr)];
    return no();
  },
  CLR: (ops, ctx) => {
    if (ops.length !== 1) return no();
    const o = ops[0];
    if (o.kind === 'A') return [0xe4];
    if (o.kind === 'C') return [0xc3];
    if (o.kind === 'expr') return [0xc2, ctx.byte(o.expr)];
    return no();
  },
  SETB: (ops, ctx) => {
    if (ops.length !== 1) return no();
    const o = ops[0];
    if (o.kind === 'C') return [0xd3];
    if (o.kind === 'expr') return [0xd2, ctx.byte(o.expr)];
    return no();
  },
  CPL: (ops, ctx) => {
    if (ops.length !== 1) return no();
    const o = ops[0];
    if (o.kind === 'A') return [0xf4];
    if (o.kind === 'C') return [0xb3];
    if (o.kind === 'expr') return [0xb2, ctx.byte(o.expr)];
    return no();
  },
  PUSH: (ops, ctx) => (ops.length === 1 && ops[0].kind === 'expr' ? [0xc0, ctx.byte(ops[0].expr)] : no()),
  POP: (ops, ctx) => (ops.length === 1 && ops[0].kind === 'expr' ? [0xd0, ctx.byte(ops[0].expr)] : no()),

  MOV: (ops, ctx) => {
    if (ops.length !== 2) return no();
    const [d, s] = ops;
    if (d.kind === 'A') {
      if (s.kind === 'Rn') return [0xe8 + s.index];
      if (s.kind === '@Ri') return [0xe6 + s.index];
      if (s.kind === '#') return [0x74, ctx.byte(s.expr)];
      if (s.kind === 'expr') return [0xe5, ctx.byte(s.expr)];
      return no();
    }
    if (d.kind === 'Rn') {
      if (s.kind === 'A') return [0xf8 + d.index];
      if (s.kind === '#') return [0x78 + d.index, ctx.byte(s.expr)];
      if (s.kind === 'expr') return [0xa8 + d.index, ctx.byte(s.expr)];
      return no();
    }
    if (d.kind === '@Ri') {
      if (s.kind === 'A') return [0xf6 + d.index];
      if (s.kind === '#') return [0x76 + d.index, ctx.byte(s.expr)];
      if (s.kind === 'expr') return [0xa6 + d.index, ctx.byte(s.expr)];
      return no();
    }
    if (d.kind === 'DPTR') {
      if (s.kind !== '#') return no();
      const v = ctx.word(s.expr);
      return [0x90, (v >> 8) & 0xff, v & 0xff];
    }
    if (d.kind === 'C') return s.kind === 'expr' ? [0xa2, ctx.byte(s.expr)] : no();
    if (d.kind === 'expr') {
      if (s.kind === 'A') return [0xf5, ctx.byte(d.expr)];
      if (s.kind === 'C') return [0x92, ctx.byte(d.expr)];
      if (s.kind === 'Rn') return [0x88 + s.index, ctx.byte(d.expr)];
      if (s.kind === '@Ri') return [0x86 + s.index, ctx.byte(d.expr)];
      if (s.kind === '#') return [0x75, ctx.byte(d.expr), ctx.byte(s.expr)];
      // MOV direct,direct carries the SOURCE byte first
      if (s.kind === 'expr') return [0x85, ctx.byte(s.expr), ctx.byte(d.expr)];
      return no();
    }
    return no();
  },
  MOVC: (ops) => {
    if (ops.length !== 2 || ops[0].kind !== 'A') return no();
    if (ops[1].kind === '@A+DPTR') return [0x93];
    if (ops[1].kind === '@A+PC') return [0x83];
    return no();
  },
  MOVX: (ops) => {
    if (ops.length !== 2) return no();
    const [d, s] = ops;
    if (d.kind === 'A') {
      if (s.kind === '@DPTR') return [0xe0];
      if (s.kind === '@Ri') return [0xe2 + s.index];
      return no();
    }
    if (s.kind !== 'A') return no();
    if (d.kind === '@DPTR') return [0xf0];
    if (d.kind === '@Ri') return [0xf2 + d.index];
    return no();
  },
  XCH: (ops, ctx) => {
    if (ops.length !== 2 || ops[0].kind !== 'A') return no();
    const o = ops[1];
    if (o.kind === 'Rn') return [0xc8 + o.index];
    if (o.kind === '@Ri') return [0xc6 + o.index];
    if (o.kind === 'expr') return [0xc5, ctx.byte(o.expr)];
    return no();
  },
  XCHD: (ops) => (ops.length === 2 && ops[0].kind === 'A' && ops[1].kind === '@Ri' ? [0xd6 + ops[1].index] : no()),

  LJMP: (ops, ctx) => {
    if (ops.length !== 1 || ops[0].kind !== 'expr') return no();
    const v = ctx.word(ops[0].expr);
    return [0x02, (v >> 8) & 0xff, v & 0xff];
  },
  LCALL: (ops, ctx) => {
    if (ops.length !== 1 || ops[0].kind !== 'expr') return no();
    const v = ctx.word(ops[0].expr);
    return [0x12, (v >> 8) & 0xff, v & 0xff];
  },
  AJMP: (ops, ctx) => {
    if (ops.length !== 1 || ops[0].kind !== 'expr') return no();
    const a = ctx.page(ops[0].expr, 2);
    return [0x01 | ((a >> 3) & 0xe0), a & 0xff];
  },
  ACALL: (ops, ctx) => {
    if (ops.length !== 1 || ops[0].kind !== 'expr') return no();
    const a = ctx.page(ops[0].expr, 2);
    return [0x11 | ((a >> 3) & 0xe0), a & 0xff];
  },
  SJMP: (ops, ctx) => (ops.length === 1 && ops[0].kind === 'expr' ? [0x80, ctx.rel(ops[0].expr, 2)] : no()),
  JMP: (ops) => (ops.length === 1 && ops[0].kind === '@A+DPTR' ? [0x73] : no()),
  JC: shortJump(0x40),
  JNC: shortJump(0x50),
  JZ: shortJump(0x60),
  JNZ: shortJump(0x70),
  JB: bitJump(0x20),
  JNB: bitJump(0x30),
  JBC: bitJump(0x10),
  CJNE: (ops, ctx) => {
    if (ops.length !== 3 || ops[2].kind !== 'expr') return no();
    const [a, b] = ops;
    if (a.kind === 'A' && b.kind === '#') return [0xb4, ctx.byte(b.expr), ctx.rel(ops[2].expr, 3)];
    if (a.kind === 'A' && b.kind === 'expr') return [0xb5, ctx.byte(b.expr), ctx.rel(ops[2].expr, 3)];
    if (a.kind === 'Rn' && b.kind === '#') return [0xb8 + a.index, ctx.byte(b.expr), ctx.rel(ops[2].expr, 3)];
    if (a.kind === '@Ri' && b.kind === '#') return [0xb6 + a.index, ctx.byte(b.expr), ctx.rel(ops[2].expr, 3)];
    return no();
  },
  DJNZ: (ops, ctx) => {
    if (ops.length !== 2 || ops[1].kind !== 'expr') return no();
    if (ops[0].kind === 'Rn') return [0xd8 + ops[0].index, ctx.rel(ops[1].expr, 2)];
    if (ops[0].kind === 'expr') return [0xd5, ctx.byte(ops[0].expr), ctx.rel(ops[1].expr, 3)];
    return no();
  },
};

/** Mnemonics the assembler knows, sorted (for the editor's help). */
export function mnemonics(): string[] {
  return Object.keys(MNEMONICS).sort();
}

// ---------------------------------------------------------------------------------------------
// the two passes

/** Assemble MCS-51 source text. */
export function assemble8051(source: string): AsmResult {
  const parsed = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l, i) => parseLine(l, i + 1));
  const errors: AsmError[] = [];
  const symbols = predefinedSymbols();
  const bytes = new Uint8Array(CODE_SIZE);
  const lines: AsmLine[] = [];
  const addrLine = new Map<number, number>();
  /** bytes each source line produces (pass 1) */
  const sizes = new Map<number, number>();
  /** resolved ORG target of a source line (pass 1) */
  const orgs = new Map<number, number>();

  const define = (name: string, value: number, kind: SymbolKind, line: number, redefine: boolean): void => {
    const existing = symbols.get(name);
    if (existing && existing.line === 0) {
      errors.push({ line, code: 'reservedName', text: name });
      return;
    }
    if (existing && !redefine) {
      errors.push({ line, code: 'duplicateSymbol', text: name });
      return;
    }
    symbols.set(name, { name, value, kind, line });
  };

  // ---- pass 1: addresses and symbols
  let here = 0;
  const lenient: EvalCtx = { symbols, here: 0, lenient: true };
  const evalNow = (expr: string, line: number): number | undefined => {
    lenient.here = here;
    lenient.unresolved = false;
    try {
      const v = evalExpr(expr, lenient);
      if (lenient.unresolved) {
        errors.push({ line, code: 'undefinedSymbol', text: expr.trim() });
        return undefined;
      }
      return v;
    } catch (e) {
      if (e instanceof ExprError) errors.push({ line, code: e.code, text: e.text ?? expr.trim() });
      return undefined;
    }
  };
  let ended = false;
  for (const p of parsed) {
    if (ended) break;
    const op = p.op;
    if (op === 'END') {
      if (p.label) define(p.label, here, 'label', p.line, false);
      ended = true;
      continue;
    }
    if (op === 'ORG') {
      const v = evalNow(p.args[0] ?? '', p.line);
      if (v !== undefined) {
        if (v < 0 || v >= CODE_SIZE) errors.push({ line: p.line, code: 'orgRange', value: v });
        else {
          here = v;
          orgs.set(p.line, v);
        }
      }
      continue;
    }
    if (op === 'EQU' || op === 'SET' || op === 'DATA' || op === 'BIT' || op === 'CODE' || op === 'XDATA' || op === 'IDATA') {
      if (!p.label) {
        errors.push({ line: p.line, code: 'badDirective', text: op });
        continue;
      }
      const v = evalNow(p.args[0] ?? '', p.line);
      if (v !== undefined) define(p.label, v, op === 'BIT' ? 'bit' : 'number', p.line, op === 'SET');
      continue;
    }
    if (p.label) define(p.label, here, 'label', p.line, false);
    if (!op) continue;
    let n = 0;
    if (op === 'DS') {
      const v = evalNow(p.args[0] ?? '', p.line);
      n = Math.max(0, v ?? 0);
    } else if (op === 'DB' || op === 'DW') {
      for (const a of p.args) {
        if (a === '') continue;
        const str = a.match(/^(['"])([\s\S]*)\1$/);
        if (op === 'DB' && str && str[2].length !== 1) n += str[2].length;
        else n += op === 'DW' ? 2 : 1;
      }
    } else if (!MNEMONICS[op]) {
      errors.push({ line: p.line, code: 'unknownMnemonic', text: op });
      continue;
    } else {
      const ops = p.args.map(classify);
      try {
        n = MNEMONICS[op](ops, makeCtx(here, true, () => 0)).length;
      } catch (e) {
        if (e instanceof ExprError) errors.push({ line: p.line, code: e.code, text: e.text ?? p.rest ?? op });
        n = 0;
      }
    }
    sizes.set(p.line, n);
    here += n;
    if (here > CODE_SIZE) {
      errors.push({ line: p.line, code: 'tooLong', value: here });
      here = CODE_SIZE;
    }
  }

  // ---- pass 2: encode
  here = 0;
  ended = false;
  let start = CODE_SIZE;
  let end = 0;
  const strict: EvalCtx = { symbols, here: 0, lenient: false };
  const emit = (line: number, data: number[]): void => {
    for (let i = 0; i < data.length; i++) {
      const a = here + i;
      if (a >= CODE_SIZE) {
        errors.push({ line, code: 'tooLong', value: a });
        break;
      }
      bytes[a] = data[i] & 0xff;
      if (a < start) start = a;
      if (a + 1 > end) end = a + 1;
    }
  };
  for (const p of parsed) {
    const op = p.op;
    if (ended || !op) {
      lines.push({ line: p.line, addr: here, bytes: [], text: p.text });
      continue;
    }
    if (op === 'END') {
      ended = true;
      lines.push({ line: p.line, addr: here, bytes: [], text: p.text });
      continue;
    }
    if (op === 'ORG') {
      const v = orgs.get(p.line);
      if (v !== undefined) here = v;
      lines.push({ line: p.line, addr: here, bytes: [], text: p.text });
      continue;
    }
    strict.here = here;
    const evaluate = (expr: string): number => {
      strict.here = here;
      return evalExpr(expr, strict);
    };
    if (op === 'DS') {
      lines.push({ line: p.line, addr: here, bytes: [], text: p.text });
      here = Math.min(CODE_SIZE, here + (sizes.get(p.line) ?? 0));
      continue;
    }
    if (op === 'DB' || op === 'DW') {
      const ctx = makeCtx(here, false, evaluate);
      const data: number[] = [];
      for (const a of p.args) {
        if (a === '') continue;
        const str = a.match(/^(['"])([\s\S]*)\1$/);
        if (op === 'DB' && str && str[2].length !== 1) {
          for (const ch of str[2]) data.push(ch.charCodeAt(0) & 0xff);
          continue;
        }
        try {
          if (op === 'DW') {
            const w = ctx.word(a);
            data.push((w >> 8) & 0xff, w & 0xff);
          } else data.push(ctx.byte(a));
        } catch (e) {
          if (e instanceof ExprError) errors.push({ line: p.line, code: e.code, text: e.text ?? a });
          if (op === 'DW') data.push(0, 0);
          else data.push(0);
        }
      }
      emit(p.line, data);
      lines.push({ line: p.line, addr: here, bytes: data, text: p.text });
      here += data.length;
      continue;
    }
    if (DIRECTIVES.has(op)) {
      lines.push({ line: p.line, bytes: [], text: p.text });
      continue;
    }
    const enc = MNEMONICS[op];
    if (!enc) {
      lines.push({ line: p.line, addr: here, bytes: [], text: p.text });
      continue;
    }
    const ops = p.args.map(classify);
    let data: number[] = [];
    try {
      data = enc(ops, makeCtx(here, false, evaluate));
    } catch (e) {
      if (e instanceof ExprError) errors.push({ line: p.line, code: e.code, text: e.text ?? p.rest });
      data = new Array<number>(sizes.get(p.line) ?? 1).fill(0);
    }
    emit(p.line, data);
    addrLine.set(here, p.line);
    lines.push({ line: p.line, addr: here, bytes: data, text: p.text });
    here += data.length;
  }
  if (start > end) start = end = 0;
  const list = [...symbols.values()].filter((s) => s.line > 0).sort((a, b) => a.name.localeCompare(b.name));
  return { bytes, start, end, errors, lines, symbols: list, addrLine };
}

/** Listing text of an assembly result ("0000  75 90 FF   MOV P1,#0FFh"). */
export function listingText(r: AsmResult): string {
  const hex = (v: number, n: number) => v.toString(16).toUpperCase().padStart(n, '0');
  return r.lines
    .map((l) => {
      const addr = l.bytes.length > 0 && l.addr !== undefined ? hex(l.addr, 4) : '    ';
      const data = l.bytes
        .slice(0, 3)
        .map((b) => hex(b, 2))
        .join(' ')
        .padEnd(8, ' ');
      return `${addr}  ${data}  ${l.text}`.replace(/\s+$/, '');
    })
    .join('\n');
}
