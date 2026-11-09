/**
 * MachSim markup: the rich text of the description box (Design.descriptionBox.text) and of the
 * lesson theory pages. A deliberately small, Markdown-like syntax a teacher can type by hand:
 *
 *   # Heading 1 / ## Heading 2 / ### Heading 3
 *   **bold**, *italic*, `code`, $inline formula$ (src/model/formula.ts)
 *   - bullet item          (also "* item")
 *   1. numbered item
 *   > note / tip           (a highlighted box)
 *   $$ block formula $$     (on one line, or "$$" lines around several lines)
 *   ![description](img:<id>)  image of DescriptionBox.images (alone on a line = image block)
 *   ---                    horizontal rule
 *   \* \$ \` \\            literal characters
 * A blank line ends a paragraph; a single line break inside a paragraph is kept as a line break.
 *
 *   parseRichText(text) -> RichBlock[]
 *   richTextPlain(blocks) -> plain text (print, CSV, search)
 *   imageRefs(blocks) -> ids of the images the text uses
 * Pure; never throws (unclosed markers are kept as text).
 */
import { formulaText, parseFormula } from './formula';

export type RichInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: RichInline[] }
  | { kind: 'italic'; children: RichInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'math'; tex: string }
  | { kind: 'image'; id: string; alt: string }
  | { kind: 'break' };

export type RichBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: RichInline[] }
  | { kind: 'paragraph'; inlines: RichInline[] }
  | { kind: 'list'; ordered: boolean; items: RichInline[][] }
  | { kind: 'note'; inlines: RichInline[] }
  | { kind: 'math'; tex: string }
  | { kind: 'image'; id: string; alt: string }
  | { kind: 'rule' };

const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(img:([^)\s]+)\)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const ORDERED_RE = /^\d+[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;

/** Parse MachSim markup into blocks. */
export function parseRichText(text: string): RichBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let note: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'paragraph', inlines: inlineLines(para) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map((s) => parseInline(s)) });
    list = null;
  };
  const flushNote = () => {
    if (note.length) blocks.push({ kind: 'note', inlines: inlineLines(note) });
    note = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushNote();
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      flushAll();
      continue;
    }
    // block formula: "$$ … $$" on one line or between "$$" lines
    if (line.startsWith('$$')) {
      flushAll();
      const rest = line.slice(2);
      const close = rest.lastIndexOf('$$');
      if (close >= 0) {
        blocks.push({ kind: 'math', tex: rest.slice(0, close).trim() });
        continue;
      }
      const body: string[] = rest.trim() ? [rest.trim()] : [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j].trim();
        if (l.endsWith('$$')) {
          if (l.length > 2) body.push(l.slice(0, -2).trim());
          break;
        }
        body.push(l);
      }
      blocks.push({ kind: 'math', tex: body.join(' ') });
      i = j;
      continue;
    }
    if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) {
      flushAll();
      blocks.push({ kind: 'rule' });
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      flushAll();
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, inlines: parseInline(h[2]) });
      continue;
    }
    const img = IMAGE_LINE_RE.exec(line);
    if (img) {
      flushAll();
      blocks.push({ kind: 'image', id: img[2], alt: img[1] });
      continue;
    }
    if (line.startsWith('>')) {
      flushPara();
      flushList();
      note.push(line.replace(/^>\s?/, ''));
      continue;
    }
    const b = BULLET_RE.exec(line);
    const o = b ? null : ORDERED_RE.exec(line);
    // "**bold**" at the start of a line is text, not a bullet ("* " needs a space after it)
    if (b || o) {
      flushPara();
      flushNote();
      const ordered = !!o;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((b ?? o)![1]);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) {
      // indented continuation of the last list item
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    flushList();
    flushNote();
    para.push(line);
  }
  flushAll();
  return blocks;
}

/** Inline content of several lines joined by line breaks. */
function inlineLines(lines: string[]): RichInline[] {
  const out: RichInline[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push({ kind: 'break' });
    out.push(...parseInline(l));
  });
  return out;
}

/** Parse inline markup of one line. */
export function parseInline(s: string): RichInline[] {
  return new InlineReader(s).read('');
}

class InlineReader {
  private i = 0;
  constructor(private readonly s: string) {}

  /** Read until `end` (a closing marker, consumed) or the end of the text. */
  read(end: string): RichInline[] {
    const out: RichInline[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push({ kind: 'text', text });
      text = '';
    };
    const s = this.s;
    while (this.i < s.length) {
      if (end && s.startsWith(end, this.i) && !(end === '*' && s.startsWith('**', this.i))) {
        this.i += end.length;
        flush();
        return out;
      }
      const ch = s[this.i];
      if (ch === '\\' && this.i + 1 < s.length && '*$`\\![]'.includes(s[this.i + 1])) {
        text += s[this.i + 1];
        this.i += 2;
        continue;
      }
      if (s.startsWith('**', this.i) && s.indexOf('**', this.i + 2) > this.i + 2) {
        flush();
        this.i += 2;
        out.push({ kind: 'bold', children: this.read('**') });
        continue;
      }
      if (ch === '*' && end !== '*' && this.closes('*', this.i + 1)) {
        flush();
        this.i += 1;
        out.push({ kind: 'italic', children: this.read('*') });
        continue;
      }
      if (ch === '`') {
        const close = s.indexOf('`', this.i + 1);
        if (close > this.i) {
          flush();
          out.push({ kind: 'code', text: s.slice(this.i + 1, close) });
          this.i = close + 1;
          continue;
        }
      }
      if (ch === '$') {
        const close = findClosingDollar(s, this.i + 1);
        if (close > this.i + 1) {
          flush();
          out.push({ kind: 'math', tex: s.slice(this.i + 1, close) });
          this.i = close + 1;
          continue;
        }
      }
      if (ch === '!' && s[this.i + 1] === '[') {
        const m = /^!\[([^\]]*)\]\(img:([^)\s]+)\)/.exec(s.slice(this.i));
        if (m) {
          flush();
          out.push({ kind: 'image', id: m[2], alt: m[1] });
          this.i += m[0].length;
          continue;
        }
      }
      text += ch;
      this.i += 1;
    }
    flush();
    // an unclosed marker: its content is kept, the marker itself was consumed — restore it as text
    if (end) out.unshift({ kind: 'text', text: end });
    return out;
  }

  /**
   * A single-star italic opens only before a non-space character and closes later on the line
   * right after a non-space character, so "5 * 3" stays text (as in Markdown).
   */
  private closes(marker: string, from: number): boolean {
    if (from >= this.s.length || /\s/.test(this.s[from])) return false;
    for (let j = from; j < this.s.length; j++) {
      if (this.s[j] === '\\') {
        j += 1;
        continue;
      }
      if (this.s.startsWith('**', j)) {
        j += 1;
        continue;
      }
      if (this.s[j] === marker && j > from && !/\s/.test(this.s[j - 1])) return true;
    }
    return false;
  }
}

/** Index of the "$" closing an inline formula that starts at `from`, or -1. */
function findClosingDollar(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') {
      j += 1;
      continue;
    }
    if (s[j] === '$') return j;
  }
  return -1;
}

function inlinePlain(items: RichInline[]): string {
  return items
    .map((n) => {
      switch (n.kind) {
        case 'text':
        case 'code':
          return n.text;
        case 'bold':
        case 'italic':
          return inlinePlain(n.children);
        case 'math':
          return formulaText(parseFormula(n.tex));
        case 'image':
          return n.alt ? `[${n.alt}]` : '';
        case 'break':
          return '\n';
      }
    })
    .join('');
}

/** Plain-text rendering of rich text blocks (one block per paragraph, lists with "- " / "1. "). */
export function richTextPlain(blocks: RichBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'heading':
        case 'paragraph':
        case 'note':
          return inlinePlain(b.inlines);
        case 'list':
          return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${inlinePlain(it)}`).join('\n');
        case 'math':
          return formulaText(parseFormula(b.tex));
        case 'image':
          return b.alt ? `[${b.alt}]` : '';
        case 'rule':
          return '———';
      }
    })
    .filter((s) => s !== '')
    .join('\n\n');
}

/** Ids of the images a text refers to (block and inline images), in order of appearance. */
export function imageRefs(blocks: RichBlock[]): string[] {
  const out: string[] = [];
  const visit = (items: RichInline[]) => {
    for (const n of items) {
      if (n.kind === 'image' && !out.includes(n.id)) out.push(n.id);
      if (n.kind === 'bold' || n.kind === 'italic') visit(n.children);
    }
  };
  for (const b of blocks) {
    if (b.kind === 'image' && !out.includes(b.id)) out.push(b.id);
    if (b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'note') visit(b.inlines);
    if (b.kind === 'list') b.items.forEach(visit);
  }
  return out;
}
