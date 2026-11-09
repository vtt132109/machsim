/**
 * SPICE card-level lexing: physical -> logical lines and card tokenisation.
 *
 * Logical lines
 *   - "*" lines are comments; "*@machsim ..." lines are MachSim pragmas (kept, see writer.ts).
 *   - Lines starting with "//" or ";" are comments.
 *   - Inline comments: ";" anywhere, "$" when preceded by whitespace and followed by whitespace
 *     or end of line (so PSpice node names such as "$G_DPWR" survive), "//" after whitespace.
 *     Comment characters inside {braces} or quotes are kept.
 *   - A line starting with "+" continues the previous card; comment and blank lines between
 *     continuation lines are skipped.
 *
 * Tokens
 *   word    any run of characters other than whitespace and  = ( ) , [ ] { } ' "
 *   brace   {expr}  (content without braces; nesting allowed)
 *   quote   'expr'  (content without quotes; SPICE/HSPICE expression delimiter)
 *   string  "text"  (content without quotes; file names, literal strings)
 *   punct   = ( ) , [ ]
 */

import { parseSpiceNumberExact } from './numbers';

export interface LogicalLine {
  /** card text with comments removed and continuations joined */
  text: string;
  /** 1-based physical line number of the card's first line */
  line: number;
  /** source file (undefined = main text) */
  file?: string;
  /** "*@machsim" pragma line (text holds everything after the marker) */
  pragma?: boolean;
}

export type TokKind = 'word' | 'brace' | 'quote' | 'string' | '=' | '(' | ')' | ',' | '[' | ']';

export interface Tok {
  t: TokKind;
  /** text (content without delimiters for brace/quote/string) */
  v: string;
  /** offset of the token start in the card text */
  pos: number;
  /** offset just past the token */
  end: number;
}

export const PRAGMA_PREFIX = '*@machsim';

/** Error raised while lexing or parsing a card (converted to a line-numbered parse error). */
export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardError';
  }
}

/** Remove an inline comment, honouring quotes and braces. */
export function stripInlineComment(s: string): string {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    const prevSpace = i === 0 || /\s/.test(s[i - 1]);
    if (c === ';') return s.slice(0, i);
    if (c === '$' && prevSpace && (i + 1 >= s.length || /\s/.test(s[i + 1]))) return s.slice(0, i);
    if (c === '/' && s[i + 1] === '/' && prevSpace) return s.slice(0, i);
  }
  return s;
}

/**
 * Split text into logical lines. When `hasTitle` is true the first physical line is returned as
 * the title (SPICE rule) and never parsed as a card.
 */
export function splitLogicalLines(
  text: string,
  file: string | undefined,
  hasTitle: boolean,
  onError: (line: number, message: string) => void,
): { title?: string; lines: LogicalLine[] } {
  const physical = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const lines: LogicalLine[] = [];
  let title: string | undefined;
  let start = 0;
  if (hasTitle && physical.length > 0) {
    title = physical[0].trim();
    start = 1;
  }
  let current: LogicalLine | undefined;
  for (let i = start; i < physical.length; i++) {
    const raw = physical[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.toLowerCase().startsWith(PRAGMA_PREFIX)) {
      current = undefined;
      lines.push({ text: trimmed.slice(PRAGMA_PREFIX.length).trim(), line: lineNo, file, pragma: true });
      continue;
    }
    if (trimmed[0] === '*' || trimmed.startsWith('//') || trimmed[0] === ';') continue;
    const body = stripInlineComment(trimmed).trim();
    if (body === '') continue;
    if (body[0] === '+') {
      if (!current) {
        onError(lineNo, 'continuation line without a preceding card');
        continue;
      }
      current.text += ' ' + body.slice(1).trim();
      continue;
    }
    current = { text: body, line: lineNo, file };
    lines.push(current);
  }
  return { title, lines };
}

const PUNCT = new Set(['=', '(', ')', ',', '[', ']']);
const WORD_BREAK = new Set(['=', '(', ')', ',', '[', ']', '{', '}', "'", '"']);

/** Tokenise one card. Throws CardError on unbalanced braces or quotes. */
export function tokenizeCard(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = i;
    if (c === '{') {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= n) throw new CardError("unbalanced '{' in expression");
      out.push({ t: 'brace', v: s.slice(i + 1, j).trim(), pos, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const j = s.indexOf(c, i + 1);
      if (j < 0) throw new CardError(`unbalanced ${c} quote`);
      out.push({ t: c === "'" ? 'quote' : 'string', v: s.slice(i + 1, j).trim(), pos, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '}') throw new CardError("unbalanced '}'");
    if (PUNCT.has(c)) {
      out.push({ t: c as TokKind, v: c, pos, end: i + 1 });
      i++;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(s[j]) && !WORD_BREAK.has(s[j])) j++;
    out.push({ t: 'word', v: s.slice(i, j), pos, end: j });
    i = j;
  }
  return out;
}

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[A-Za-zµμΩ%]*$/;
const RKM_RE = /^([+-]?\d{1,3})(meg|[tgkmunpfr])(\d{1,3})([A-Za-zΩ]*)$/i;
/** RKM letter -> power of ten. */
const RKM_EXP: Record<string, number> = {
  meg: 6,
  t: 12,
  g: 9,
  k: 3,
  m: -3,
  u: -6,
  n: -9,
  p: -12,
  f: -15,
  r: 0,
};

/**
 * Parse a numeric word: SPICE number with optional suffix/unit ("1k", "2.2uF", "1MEG", "5V"),
 * or (when `rkm` is true) RKM notation used by LTspice and IEC 60062 ("4k7" = 4.7k, "2R2" = 2.2,
 * at most three digits on either side of the letter, so part names like "2N2222" stay words).
 * Returns undefined when the word is not a number (e.g. a parameter name or "2N2222").
 */
export function parseNumberWord(word: string, rkm = true): number | undefined {
  if (NUMBER_RE.test(word)) {
    const v = parseSpiceNumberExact(word);
    return Number.isNaN(v) ? undefined : v;
  }
  if (!rkm) return undefined;
  const m = RKM_RE.exec(word);
  if (m) {
    return Number(`${m[1]}.${m[3]}e${RKM_EXP[m[2].toLowerCase()]}`);
  }
  return undefined;
}

/** True when the word is a plain SPICE number (used by the writer to avoid braces). */
export function isNumberWord(word: string): boolean {
  return parseNumberWord(word) !== undefined;
}

/** A value token interpreted: number, or expression text (from {..}, '..' or a non-numeric word). */
export type ValueText = { num: number; expr?: undefined } | { num?: undefined; expr: string };

/** Interpret a token as a value. Braced/quoted text is always an expression. */
export function tokenValue(tok: Tok): ValueText | undefined {
  if (tok.t === 'brace' || tok.t === 'quote') {
    if (tok.v === '') throw new CardError('empty expression');
    return { expr: tok.v };
  }
  if (tok.t !== 'word') return undefined;
  const n = parseNumberWord(tok.v);
  return n !== undefined ? { num: n } : { expr: tok.v };
}
