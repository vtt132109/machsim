/**
 * Watch expressions of the 8051 debugger (pure): a small expression language over the registers,
 * the SFRs, internal / external memory, code bytes, bits and port pins, so a learner can type
 * `A`, `R0 + R1`, `P1.3`, `[30h]`, `ACC.7`, `(TH0 << 8) | TL0` or `XRAM[100h] > 5` in the Watch tab
 * and see the value update while the program runs or single-steps.
 *
 * Language
 *   numbers       123   0x1F   1Fh   0B3h   101b   (a trailing h = hex, b = binary)
 *   registers     A ACC B SP PC DPTR DPH DPL R0 … R7 PSW P0 … P3 (the port latch)
 *   SFRs / bits   every SFR name and bit name of the core (TMOD, TCON, IE, TR0, CY, F0 …),
 *                 `NAME.n` = bit n of a register or SFR (ACC.7, P1.3, PSW.0)
 *   memory        [addr] or RAM[addr] direct (IRAM below 80h, SFR above), IRAM[addr] indirect,
 *                 XRAM[addr], CODE[addr], BIT[addr], PIN[n] (external pin level, 0 = P0.0)
 *                 @R0 / @R1 = internal RAM at the address held in R0 / R1
 *   operators     ( ) - ~ !   * / %   + -   << >>   < <= > >=   == !=   &   ^   |   &&   ||
 *
 * `compileWatch(text)` returns the expression's value function and the fixed memory cells it reads
 * (`refs`): the live debugger gives each distinct cell one of the eight hardware watch slots of the
 * co-simulated core (src/mcu/debugger.ts) and feeds the slot values back through the context.
 * Registers come from the register read-outs, so they need no slot. Addresses that are computed
 * (`[R0 + 1]`, `@R0`) are looked up in the context at evaluation time and show `?` when the
 * context cannot answer.
 */
import { BIT_NAMES, SFR_NAMES } from './cpu8051';
import { WATCH_SPACE, type WatchSpace } from './debugger';

/** Problems `compileWatch` reports (the panel turns each into a localized sentence). */
export type WatchErrorCode = 'empty' | 'syntax' | 'unknownName' | 'badBit' | 'tooManyCells';

export interface WatchError {
  code: WatchErrorCode;
  /** the identifier or token concerned */
  token?: string;
  /** 0-based character position */
  at: number;
}

/** A fixed memory cell an expression reads. */
export interface WatchCell {
  space: WatchSpace;
  address: number;
}

/** Where the values of registers and memory cells come from. */
export interface WatchContext {
  /** value of a core register / SFR read-out by upper-case name, undefined when the context has no such value */
  reg(name: string): number | undefined;
  /** value of a memory cell, undefined when unknown */
  mem(space: WatchSpace, address: number): number | undefined;
}

export interface WatchProgram {
  ok: true;
  text: string;
  /** fixed memory cells the expression reads (distinct) */
  refs: WatchCell[];
  /** the value, or undefined when a needed value is unknown (or a division by zero happened) */
  evaluate(ctx: WatchContext): number | undefined;
}

export interface WatchFailure {
  ok: false;
  text: string;
  error: WatchError;
}

/** Registers the debugger can read without a hardware slot. */
export const WATCH_REGISTERS: readonly string[] = ['A', 'ACC', 'B', 'SP', 'PC', 'DPTR', 'DPH', 'DPL', 'PSW', 'P0', 'P1', 'P2', 'P3', ...Array.from({ length: 8 }, (_, k) => `R${k}`)];

const sfrByName = new Map(SFR_NAMES.map((s) => [s.name.toUpperCase(), s.addr] as const));
const bitByName = new Map(BIT_NAMES.map((b) => [b.name.toUpperCase(), b.addr] as const));
const isRegister = (name: string): boolean => WATCH_REGISTERS.includes(name);

type Fn = (ctx: WatchContext) => number | undefined;

interface Tok {
  kind: 'num' | 'id' | 'op';
  text: string;
  value?: number;
  at: number;
}

const OPS3 = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||'];

class Fail extends Error {
  constructor(readonly info: WatchError) {
    super(info.code);
  }
}

function lex(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < text.length && /[0-9A-Za-z]/.test(text[j])) j++;
      const raw = text.slice(i, j);
      const lower = raw.toLowerCase();
      let value = Number.NaN;
      if (/^0x[0-9a-f]+$/.test(lower)) value = parseInt(lower.slice(2), 16);
      else if (/^[0-9][0-9a-f]*h$/.test(lower)) value = parseInt(lower.slice(0, -1), 16);
      else if (/^[01]+b$/.test(lower)) value = parseInt(lower.slice(0, -1), 2);
      else if (/^[0-9]+$/.test(lower)) value = parseInt(lower, 10);
      if (Number.isNaN(value)) throw new Fail({ code: 'syntax', token: raw, at: i });
      out.push({ kind: 'num', text: raw, value, at: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_@]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      out.push({ kind: 'id', text: text.slice(i, j).toUpperCase(), at: i });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (OPS3.includes(two)) {
      out.push({ kind: 'op', text: two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/%&|^~!()[]<>.'.includes(c)) {
      out.push({ kind: 'op', text: c, at: i });
      i++;
      continue;
    }
    throw new Fail({ code: 'syntax', token: c, at: i });
  }
  return out;
}

/** Binary operators from the loosest binding to the tightest (C precedence). */
const BINARY: { ops: string[] }[] = [
  { ops: ['||'] },
  { ops: ['&&'] },
  { ops: ['|'] },
  { ops: ['^'] },
  { ops: ['&'] },
  { ops: ['==', '!='] },
  { ops: ['<', '<=', '>', '>='] },
  { ops: ['<<', '>>'] },
  { ops: ['+', '-'] },
  { ops: ['*', '/', '%'] },
];

function apply(op: string, a: number, b: number): number | undefined {
  switch (op) {
    case '||':
      return a !== 0 || b !== 0 ? 1 : 0;
    case '&&':
      return a !== 0 && b !== 0 ? 1 : 0;
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '&':
      return a & b;
    case '==':
      return a === b ? 1 : 0;
    case '!=':
      return a !== b ? 1 : 0;
    case '<':
      return a < b ? 1 : 0;
    case '<=':
      return a <= b ? 1 : 0;
    case '>':
      return a > b ? 1 : 0;
    case '>=':
      return a >= b ? 1 : 0;
    case '<<':
      return a << (b & 31);
    case '>>':
      return a >> (b & 31);
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? undefined : Math.trunc(a / b);
    case '%':
      return b === 0 ? undefined : a % b;
    default:
      return undefined;
  }
}

/** An expression node: its value function and, when it is a constant, the constant. */
interface Node {
  fn: Fn;
  constant?: number;
}

class Parser {
  private pos = 0;
  readonly refs: WatchCell[] = [];

  constructor(private readonly toks: Tok[]) {}

  parse(): Fn {
    const n = this.binary(0);
    if (this.pos < this.toks.length) throw new Fail({ code: 'syntax', token: this.toks[this.pos].text, at: this.toks[this.pos].at });
    return n.fn;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private take(op: string): boolean {
    const t = this.peek();
    if (t?.kind === 'op' && t.text === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(op: string): void {
    if (!this.take(op)) {
      const t = this.peek();
      throw new Fail({ code: 'syntax', token: t?.text ?? '', at: t?.at ?? this.toks[this.toks.length - 1]?.at ?? 0 });
    }
  }

  private binary(level: number): Node {
    if (level >= BINARY.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || !BINARY[level].ops.includes(t.text)) return left;
      this.pos++;
      const right = this.binary(level + 1);
      const op = t.text;
      const a = left;
      left = {
        fn: (ctx) => {
          const x = a.fn(ctx);
          const y = right.fn(ctx);
          return x === undefined || y === undefined ? undefined : apply(op, x, y);
        },
      };
    }
  }

  private unary(): Node {
    const t = this.peek();
    if (t?.kind === 'op' && (t.text === '-' || t.text === '~' || t.text === '!')) {
      this.pos++;
      const inner = this.unary();
      const op = t.text;
      return { fn: (ctx) => { const v = inner.fn(ctx); return v === undefined ? undefined : op === '-' ? -v : op === '~' ? ~v : v === 0 ? 1 : 0; } };
    }
    return this.primary();
  }

  /** A memory read whose address is `addr`; fixed cells are collected for the hardware slots. */
  private cell(space: WatchSpace, addr: Node): Node {
    if (addr.constant !== undefined) {
      const address = space === WATCH_SPACE.pin ? addr.constant & 31 : space === WATCH_SPACE.xram || space === WATCH_SPACE.code ? addr.constant & 0xffff : addr.constant & 0xff;
      if (!this.refs.some((r) => r.space === space && r.address === address)) this.refs.push({ space, address });
      return { fn: (ctx) => ctx.mem(space, address) };
    }
    return {
      fn: (ctx) => {
        const a = addr.fn(ctx);
        return a === undefined ? undefined : ctx.mem(space, a & (space === WATCH_SPACE.xram || space === WATCH_SPACE.code ? 0xffff : 0xff));
      },
    };
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) throw new Fail({ code: 'syntax', token: '', at: this.toks[this.toks.length - 1]?.at ?? 0 });
    if (t.kind === 'num') {
      this.pos++;
      const v = t.value ?? 0;
      return { fn: () => v, constant: v };
    }
    if (t.kind === 'op' && t.text === '(') {
      this.pos++;
      const n = this.binary(0);
      this.expect(')');
      return n;
    }
    if (t.kind === 'op' && t.text === '[') {
      this.pos++;
      const addr = this.binary(0);
      this.expect(']');
      return this.cell(WATCH_SPACE.direct, addr);
    }
    if (t.kind === 'id') {
      this.pos++;
      return this.identifier(t);
    }
    throw new Fail({ code: 'syntax', token: t.text, at: t.at });
  }

  private identifier(t: Tok): Node {
    const name = t.text;
    // @R0 / @R1: internal RAM at the address in the register
    if (name === '@R0' || name === '@R1') {
      const reg = name.slice(1);
      return this.cell(WATCH_SPACE.indirect, { fn: (ctx) => ctx.reg(reg) });
    }
    // RAM[..] IRAM[..] XRAM[..] CODE[..] BIT[..] PIN[..]
    const spaces: Record<string, WatchSpace> = { RAM: WATCH_SPACE.direct, IRAM: WATCH_SPACE.indirect, XRAM: WATCH_SPACE.xram, CODE: WATCH_SPACE.code, BIT: WATCH_SPACE.bit, PIN: WATCH_SPACE.pin };
    if (name in spaces && this.peek()?.kind === 'op' && this.peek()?.text === '[') {
      this.pos++;
      const addr = this.binary(0);
      this.expect(']');
      return this.cell(spaces[name], addr);
    }
    const base = this.named(t);
    // NAME.n : bit n of a register or SFR
    if (this.peek()?.kind === 'op' && this.peek()?.text === '.') {
      const dot = this.peek()!;
      this.pos++;
      const n = this.peek();
      if (!n || n.kind !== 'num' || (n.value ?? 99) > 7) throw new Fail({ code: 'badBit', token: n?.text ?? '', at: n?.at ?? dot.at });
      this.pos++;
      const bit = n.value ?? 0;
      return { fn: (ctx) => { const v = base.fn(ctx); return v === undefined ? undefined : (v >> bit) & 1; } };
    }
    return base;
  }

  /** A register, SFR or bit name. */
  private named(t: Tok): Node {
    const name = t.text;
    if (isRegister(name)) return { fn: (ctx) => ctx.reg(name) };
    const sfr = sfrByName.get(name);
    if (sfr !== undefined) {
      // registers the read-outs publish come from the context; other SFRs are a fixed direct cell
      const cell = this.cell(WATCH_SPACE.direct, { fn: () => sfr, constant: sfr });
      return { fn: (ctx) => ctx.reg(name) ?? cell.fn(ctx) };
    }
    const bit = bitByName.get(name);
    if (bit !== undefined) return this.cell(WATCH_SPACE.bit, { fn: () => bit, constant: bit });
    throw new Fail({ code: 'unknownName', token: name, at: t.at });
  }
}

/** Compile the text of a watch expression. */
export function compileWatch(text: string, maxCells = 8): WatchProgram | WatchFailure {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, text, error: { code: 'empty', at: 0 } };
  try {
    const parser = new Parser(lex(trimmed));
    const fn = parser.parse();
    if (parser.refs.length > maxCells) return { ok: false, text, error: { code: 'tooManyCells', at: 0 } };
    return { ok: true, text, refs: parser.refs, evaluate: fn };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, text, error: e.info };
    throw e;
  }
}

/** Number base a watch value is shown in. */
export type WatchRadix = 'dec' | 'hex' | 'bin' | 'all';

/** Text of a value in the chosen base ("?" when unknown). 'all' gives decimal, hex and binary. */
export function formatWatchValue(value: number | undefined, radix: WatchRadix = 'all'): string {
  if (value === undefined) return '?';
  const v = Math.trunc(value);
  const hex = (v < 0 ? v >>> 0 : v).toString(16).toUpperCase();
  const hexText = `${hex.length % 2 === 1 ? '0' : ''}${hex}h`;
  const bin = (v < 0 ? v >>> 0 : v).toString(2);
  const binText = `${bin.padStart(v >= 0 && v < 256 ? 8 : 0, '0')}b`;
  if (radix === 'dec') return String(v);
  if (radix === 'hex') return hexText;
  if (radix === 'bin') return binText;
  return v >= 0 && v < 256 ? `${v} = ${hexText} = ${binText}` : `${v} = ${hexText}`;
}

/** Address of the SFR whose name is `name`, for the panel's name completion. */
export function sfrAddress(name: string): number | undefined {
  return sfrByName.get(name.toUpperCase());
}


/** One line of the Watch tab. */
export interface WatchItem {
  text: string;
  /** stop the run when a memory cell this expression reads changes */
  stop: boolean;
}

/** The compiled watch list and how its memory cells map to the core's eight hardware slots. */
export interface WatchPlan {
  /** one entry per item: the program or the reason it cannot run */
  programs: (WatchProgram | WatchFailure)[];
  /** the distinct memory cells in slot order (cell k is hardware slot k) */
  cells: WatchCell[];
  /** bit k set = stop when slot k changes (`wbreak` of the core) */
  breakMask: number;
}

/**
 * Compile the watch list and give every distinct memory cell one hardware slot, in order of first
 * use. An expression that would need more slots than are left fails with `tooManyCells` and does
 * not take any.
 */
export function planWatches(items: readonly WatchItem[], maxCells = 8): WatchPlan {
  const cells: WatchCell[] = [];
  const same = (a: WatchCell, b: WatchCell): boolean => a.space === b.space && a.address === b.address;
  const programs = items.map((item) => {
    const p = compileWatch(item.text, maxCells);
    if (!p.ok) return p;
    const fresh = p.refs.filter((r) => !cells.some((c) => same(c, r)));
    if (cells.length + fresh.length > maxCells) return { ok: false, text: item.text, error: { code: 'tooManyCells', at: 0 } } as WatchFailure;
    cells.push(...fresh);
    return p;
  });
  let breakMask = 0;
  items.forEach((item, k) => {
    const p = programs[k];
    if (!item.stop || !p.ok) return;
    for (const r of p.refs) breakMask |= 1 << cells.findIndex((c) => same(c, r));
  });
  return { programs, cells, breakMask };
}
