/**
 * S-expression reader shared by the KiCad schematic (.kicad_sch) and EDIF 2 0 0 importers.
 *
 *   parseSexpr(text)   -> SNode (the first top-level list)
 *
 * Atoms are strings; lists are arrays. Quoted strings keep their content (KiCad escapes \" \\ \n;
 * EDIF writes %nn% for ASCII codes inside strings, decoded when `edifEscapes` is set). Comments
 * are not part of either format. Helpers find child lists by head keyword (case-insensitive for
 * EDIF, whose keywords may be written in any case).
 */

export type SNode = string | SNode[];

export class SexprError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'SexprError';
    this.line = line;
  }
}

export interface SexprOptions {
  /** decode EDIF %nn% character escapes inside quoted strings */
  edifEscapes?: boolean;
}

/** Parse the first top-level list of the text. */
export function parseSexpr(text: string, opts: SexprOptions = {}): SNode[] {
  let p = 0;
  let line = 1;
  const n = text.length;
  const stack: SNode[][] = [];
  let root: SNode[] | null = null;
  while (p < n) {
    const c = text[p];
    if (c === '\n') {
      line++;
      p++;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f') p++;
    else if (c === '(') {
      const list: SNode[] = [];
      if (stack.length) stack[stack.length - 1].push(list);
      else if (root) break;
      else root = list;
      stack.push(list);
      p++;
    } else if (c === ')') {
      if (!stack.length) throw new SexprError('unexpected ")"', line);
      stack.pop();
      p++;
      if (!stack.length && root) break;
    } else if (c === '"') {
      p++;
      let s = '';
      for (;;) {
        if (p >= n) throw new SexprError('unterminated string', line);
        const ch = text[p];
        if (ch === '"') {
          p++;
          break;
        }
        if (ch === '\\' && !opts.edifEscapes && p + 1 < n) {
          const e = text[p + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          p += 2;
          continue;
        }
        if (ch === '%' && opts.edifEscapes) {
          const end = text.indexOf('%', p + 1);
          const codes = end > p ? text.slice(p + 1, end) : '';
          if (end > p && /^[\s\d]+$/.test(codes)) {
            for (const code of codes.trim().split(/\s+/)) s += String.fromCharCode(Number(code));
            p = end + 1;
            continue;
          }
        }
        if (ch === '\n') line++;
        s += ch;
        p++;
      }
      if (!stack.length) throw new SexprError('text outside a list', line);
      stack[stack.length - 1].push(s);
    } else {
      const start = p;
      while (p < n && !/[\s()"]/.test(text[p])) p++;
      if (!stack.length) throw new SexprError(`text outside a list: ${text.slice(start, p)}`, line);
      stack[stack.length - 1].push(text.slice(start, p));
    }
  }
  if (stack.length) throw new SexprError('unbalanced parentheses: a list is not closed', line);
  if (!root) throw new SexprError('no s-expression found', line);
  return root;
}

/** The atom as a plain string ('' for lists). */
export function atom(node: SNode | undefined): string {
  return node === undefined || Array.isArray(node) ? '' : node;
}

/** Head keyword of a list ('' for atoms). */
export function head(node: SNode | undefined): string {
  return Array.isArray(node) ? atom(node[0]) : '';
}

/** Child lists of `list` whose head is `name` (case-insensitive when `ci`). */
export function children(list: SNode | undefined, name: string, ci = false): SNode[][] {
  if (!Array.isArray(list)) return [];
  const want = ci ? name.toLowerCase() : name;
  return list.filter((c): c is SNode[] => Array.isArray(c) && (ci ? head(c).toLowerCase() : head(c)) === want);
}

/** First child list named `name`. */
export function child(list: SNode | undefined, name: string, ci = false): SNode[] | undefined {
  return children(list, name, ci)[0];
}

/** Every list below `list` (depth first) whose head is `name`. */
export function descendants(list: SNode | undefined, name: string, ci = false, out: SNode[][] = []): SNode[][] {
  if (!Array.isArray(list)) return out;
  const want = ci ? name.toLowerCase() : name;
  for (const c of list) {
    if (!Array.isArray(c)) continue;
    if ((ci ? head(c).toLowerCase() : head(c)) === want) out.push(c);
    descendants(c, name, ci, out);
  }
  return out;
}
