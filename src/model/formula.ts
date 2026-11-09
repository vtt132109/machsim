/**
 * Formula parser for the description box and lesson theory (`$…$` / `$$…$$` in MachSim markup).
 *
 *   parseFormula('V_{out} = V_{in} \\frac{R_2}{R_1 + R_2}') -> MathNode tree
 *   formulaText(node)                                         -> plain text ("Vout = Vin·R2/(R1 + R2)")
 *
 * A small, original TeX-like subset that covers the formulas of circuit lessons:
 *   letters (identifiers, drawn in italics), numbers (with '.' decimals), operators + - = < > / * ,
 *   superscripts `x^2`, `x^{n+1}`, subscripts `R_1`, `V_{CE}` (both: `x_1^2`),
 *   `\frac{a}{b}`, `\sqrt{x}`, `\text{…}` (upright text), grouping `{…}`, brackets ( ) [ ] |,
 *   Greek letters (`\alpha` … `\omega`, `\Omega`, `\Delta`, `\Phi` …) and symbols
 *   `\cdot \times \div \pm \approx \le \ge \ne \infty \to \parallel \sum \degree \,` (thin space).
 * Unknown commands are kept as their name, unbalanced braces are closed at the end: the parser
 * never throws, so a learner's typo shows up as text instead of an error.
 */

export type MathNode =
  | { k: 'row'; items: MathNode[] }
  /** ident: italic letter(s); num: digits; op: operator / relation; text: upright text; space */
  | { k: 'sym'; text: string; kind: 'ident' | 'num' | 'op' | 'text' | 'space' }
  | { k: 'script'; base: MathNode; sub?: MathNode; sup?: MathNode }
  | { k: 'frac'; num: MathNode; den: MathNode }
  | { k: 'sqrt'; body: MathNode };

/** Greek letters and named symbols: command -> [character, kind]. */
const COMMANDS: Record<string, [string, 'ident' | 'op' | 'text' | 'space']> = {
  alpha: ['α', 'ident'], beta: ['β', 'ident'], gamma: ['γ', 'ident'], delta: ['δ', 'ident'], epsilon: ['ε', 'ident'],
  varepsilon: ['ε', 'ident'], zeta: ['ζ', 'ident'], eta: ['η', 'ident'], theta: ['θ', 'ident'], kappa: ['κ', 'ident'],
  lambda: ['λ', 'ident'], mu: ['μ', 'ident'], nu: ['ν', 'ident'], xi: ['ξ', 'ident'], pi: ['π', 'ident'], rho: ['ρ', 'ident'],
  sigma: ['σ', 'ident'], tau: ['τ', 'ident'], phi: ['φ', 'ident'], varphi: ['φ', 'ident'], chi: ['χ', 'ident'], psi: ['ψ', 'ident'],
  omega: ['ω', 'ident'], Gamma: ['Γ', 'text'], Delta: ['Δ', 'text'], Theta: ['Θ', 'text'], Lambda: ['Λ', 'text'], Pi: ['Π', 'text'],
  Sigma: ['Σ', 'text'], Phi: ['Φ', 'text'], Psi: ['Ψ', 'text'], Omega: ['Ω', 'text'],
  cdot: ['·', 'op'], times: ['×', 'op'], div: ['÷', 'op'], pm: ['±', 'op'], mp: ['∓', 'op'], approx: ['≈', 'op'], le: ['≤', 'op'],
  leq: ['≤', 'op'], ge: ['≥', 'op'], geq: ['≥', 'op'], ne: ['≠', 'op'], neq: ['≠', 'op'], infty: ['∞', 'text'], to: ['→', 'op'],
  rightarrow: ['→', 'op'], leftarrow: ['←', 'op'], parallel: ['∥', 'op'], sum: ['Σ', 'op'], degree: ['°', 'text'], circ: ['°', 'text'],
  lfloor: ['⌊', 'op'], rfloor: ['⌋', 'op'], lceil: ['⌈', 'op'], rceil: ['⌉', 'op'], propto: ['∝', 'op'], equiv: ['≡', 'op'], partial: ['∂', 'ident'], int: ['∫', 'op'], ldots: ['…', 'text'], cdots: ['⋯', 'text'],
  overline: ['', 'text'], ',': [' ', 'space'], ';': [' ', 'space'], quad: [' ', 'space'], ' ': [' ', 'space'],
  '%': ['%', 'text'], '{': ['{', 'op'], '}': ['}', 'op'], '|': ['∥', 'op'], '\\': ['\\', 'text'],
};

const OPS = new Set(['+', '-', '=', '<', '>', '/', '*', ',', '(', ')', '[', ']', '|', '!', ':', ';', '\'']);
const OP_TEXT: Record<string, string> = { '-': '−', '*': '·' };

class FormulaReader {
  private i = 0;
  constructor(private readonly s: string) {}

  /** Read items until end of input or a closing brace (consumed). */
  row(closing = false): MathNode {
    const items: MathNode[] = [];
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === '}') {
        this.i += 1;
        if (closing) break;
        continue; // stray closing brace: ignore
      }
      if (ch === '^' || ch === '_') {
        this.i += 1;
        const arg = this.argument();
        const prev = items.pop() ?? { k: 'row', items: [] };
        const base: Extract<MathNode, { k: 'script' }> = prev.k === 'script' ? prev : { k: 'script', base: prev };
        if (ch === '^') base.sup = arg;
        else base.sub = arg;
        items.push(base);
        continue;
      }
      const atom = this.atom();
      if (atom) items.push(atom);
    }
    return items.length === 1 ? items[0] : { k: 'row', items };
  }

  /** Argument of ^, _, \frac, \sqrt: a {group}, a command or one character. */
  private argument(): MathNode {
    this.skipSpaces();
    if (this.s[this.i] === '{') {
      this.i += 1;
      return this.row(true);
    }
    return this.atom() ?? { k: 'row', items: [] };
  }

  private skipSpaces(): void {
    while (this.s[this.i] === ' ') this.i += 1;
  }

  private atom(): MathNode | null {
    const s = this.s;
    const ch = s[this.i];
    if (ch === undefined) return null;
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      this.i += 1;
      return null;
    }
    if (ch === '{') {
      this.i += 1;
      return this.row(true);
    }
    if (ch === '\\') return this.command();
    if (/[0-9.]/.test(ch)) {
      let j = this.i;
      while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      const text = s.slice(this.i, j);
      this.i = j;
      return { k: 'sym', text, kind: 'num' };
    }
    if (/\p{L}/u.test(ch)) {
      this.i += 1;
      return { k: 'sym', text: ch, kind: 'ident' };
    }
    this.i += 1;
    if (OPS.has(ch)) return { k: 'sym', text: OP_TEXT[ch] ?? ch, kind: 'op' };
    return { k: 'sym', text: ch, kind: 'text' };
  }

  private command(): MathNode {
    const s = this.s;
    this.i += 1; // backslash
    let name: string;
    if (/[A-Za-z]/.test(s[this.i] ?? '')) {
      let j = this.i;
      while (j < s.length && /[A-Za-z]/.test(s[j])) j += 1;
      name = s.slice(this.i, j);
      this.i = j;
    } else {
      name = s[this.i] ?? '';
      this.i += 1;
    }
    if (name === 'frac') {
      const num = this.argument();
      const den = this.argument();
      return { k: 'frac', num, den };
    }
    if (name === 'sqrt') return { k: 'sqrt', body: this.argument() };
    if (name === 'text' || name === 'mathrm' || name === 'textrm') {
      this.skipSpaces();
      if (s[this.i] !== '{') return { k: 'sym', text: '', kind: 'text' };
      let depth = 0;
      let j = this.i;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth += 1;
        else if (s[j] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const text = s.slice(this.i + 1, j);
      this.i = Math.min(s.length, j + 1);
      return { k: 'sym', text, kind: 'text' };
    }
    if (name === 'left' || name === 'right') return this.atom() ?? { k: 'row', items: [] };
    const known = COMMANDS[name];
    if (known) return { k: 'sym', text: known[0], kind: known[1] };
    return { k: 'sym', text: name, kind: 'text' };
  }
}

/** Parse a formula (never throws). */
export function parseFormula(tex: string): MathNode {
  return new FormulaReader(tex).row(false);
}

/** Plain-text form of a formula (copy, print, search, screen readers). */
export function formulaText(node: MathNode): string {
  switch (node.k) {
    case 'row':
      return node.items
        .map((n, i) => {
          const t = formulaText(n);
          const op = n.k === 'sym' && n.kind === 'op' && !['(', ')', '[', ']', '|', ',', '/', '!', '\'', '⌊', '⌋', '⌈', '⌉'].includes(n.text);
          return op && i > 0 ? ` ${t} ` : t;
        })
        .join('')
        .replace(/\s{2,}/g, ' ');
    case 'sym':
      return node.text;
    case 'script': {
      const base = formulaText(node.base);
      const sub = node.sub ? formulaText(node.sub) : '';
      const sup = node.sup ? `^${wrap(node.sup)}` : '';
      return `${base}${sub}${sup}`;
    }
    case 'frac':
      return `${wrap(node.num)}/${wrap(node.den)}`;
    case 'sqrt':
      return `√${wrap(node.body)}`;
  }
}

/** Text of a node, parenthesised when it is more than one symbol. */
function wrap(node: MathNode): string {
  const t = formulaText(node).trim();
  if (node.k === 'sym' || (node.k === 'script' && !node.sup)) return t;
  return (node.k === 'row' && node.items.length > 1) || /[\s+\-−·×/]/.test(t) ? `(${t})` : t;
}
