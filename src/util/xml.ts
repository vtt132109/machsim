/**
 * Small XML 1.0 reader and writer helpers (no DOM needed, so they work in the simulation worker,
 * the desktop batch renderer and the Node tests).
 *
 *   parseXml(text)        -> root XmlElement (elements, attributes, text; comments, processing
 *                            instructions and the DOCTYPE are skipped; CDATA sections are text)
 *   escapeText / escapeAttr  for writing (CR, TAB and LF in attributes become character references,
 *                            so a reader never normalises them away)
 *
 * Entities: the five predefined ones and decimal / hexadecimal character references. Line ends
 * are normalised (CR LF / CR -> LF) like any conforming parser; a literal CR survives only as
 * `&#13;`. Namespaces are not interpreted (prefixed names are kept as written).
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  /** child elements and text runs in document order */
  children: (XmlElement | string)[];
  /** 1-based line of the start tag (error messages) */
  line: number;
}

export class XmlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`XML line ${line}: ${message}`);
    this.name = 'XmlError';
    this.line = line;
  }
}

const NAME_START = /[A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_CHAR = /[-.0-9·̀-ͯ‿-⁀A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;

/** True for a valid XML element / attribute name (no namespace prefix checks). */
export function isXmlName(name: string): boolean {
  if (!name || !NAME_START.test(name[0])) return false;
  for (let i = 1; i < name.length; i++) if (!NAME_CHAR.test(name[i])) return false;
  return true;
}

/** Characters XML 1.0 allows in a document (also as character references). */
export function isXmlChar(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

/** True when every code point of `s` may appear in an XML document (no lone surrogates, no C0 controls). */
export function xmlSafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false;
    if (!isXmlChar(c)) return false;
  }
  return true;
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Parse an XML document and return its root element. Throws XmlError for malformed input. */
export function parseXml(input: string): XmlElement {
  // a byte-order mark and line-end normalisation (XML 1.0 §2.11)
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let p = 0;
  let line = 1;
  const fail = (msg: string): never => {
    throw new XmlError(msg, line);
  };
  const advance = (n: number) => {
    for (let i = 0; i < n; i++) if (text.charCodeAt(p + i) === 10) line++;
    p += n;
  };
  const skipWs = () => {
    while (p < text.length && /\s/.test(text[p])) advance(1);
  };
  const decode = (raw: string): string =>
    raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);|&/g, (all, ref: string | undefined) => {
      if (!ref) return fail('a bare "&" must be written as &amp;');
      if (ref[0] === '#') {
        const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        if (!isXmlChar(code)) return fail(`character reference ${all} is not allowed in XML`);
        return String.fromCodePoint(code);
      }
      const v = PREDEFINED[ref];
      return v ?? fail(`unknown entity ${all}`);
    });
  const readName = (): string => {
    const start = p;
    if (p >= text.length || !NAME_START.test(text[p])) fail('expected a name');
    while (p < text.length && NAME_CHAR.test(text[p])) p++;
    return text.slice(start, p);
  };
  const skipMisc = () => {
    for (;;) {
      skipWs();
      if (text.startsWith('<?', p)) {
        const end = text.indexOf('?>', p);
        if (end < 0) fail('unterminated processing instruction');
        advance(end + 2 - p);
      } else if (text.startsWith('<!--', p)) {
        const end = text.indexOf('-->', p);
        if (end < 0) fail('unterminated comment');
        advance(end + 3 - p);
      } else if (text.startsWith('<!DOCTYPE', p)) {
        // internal subsets are not supported; skip to the matching '>'
        let depth = 0;
        while (p < text.length) {
          const ch = text[p];
          if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '>' && depth <= 0) break;
          advance(1);
        }
        advance(1);
      } else return;
    }
  };
  const element = (): XmlElement => {
    const startLine = line;
    if (text[p] !== '<') fail('expected an element');
    p++;
    const name = readName();
    const attrs: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (text.startsWith('/>', p)) {
        p += 2;
        return { name, attrs, children: [], line: startLine };
      }
      if (text[p] === '>') {
        p++;
        break;
      }
      const an = readName();
      skipWs();
      if (text[p] !== '=') fail(`attribute ${an} has no value`);
      p++;
      skipWs();
      const q = text[p];
      if (q !== '"' && q !== "'") fail(`attribute ${an}: value must be quoted`);
      const end = text.indexOf(q, p + 1);
      if (end < 0) fail(`attribute ${an}: unterminated value`);
      const raw = text.slice(p + 1, end);
      if (raw.includes('<')) fail(`attribute ${an}: "<" is not allowed in a value`);
      if (an in attrs) fail(`duplicate attribute ${an}`);
      // attribute-value normalisation: literal white space becomes a space, references are kept
      attrs[an] = decode(raw.replace(/[\t\n]/g, ' '));
      advance(end + 1 - p);
    }
    const children: (XmlElement | string)[] = [];
    let buf = '';
    const flush = () => {
      if (buf) children.push(buf);
      buf = '';
    };
    for (;;) {
      if (p >= text.length) fail(`element <${name}> is not closed`);
      if (text.startsWith('</', p)) {
        p += 2;
        const close = readName();
        if (close !== name) fail(`</${close}> closes <${name}>`);
        skipWs();
        if (text[p] !== '>') fail(`malformed end tag </${close}>`);
        p++;
        flush();
        return { name, attrs, children, line: startLine };
      }
      if (text.startsWith('<!--', p)) {
        const end = text.indexOf('-->', p);
        if (end < 0) fail('unterminated comment');
        advance(end + 3 - p);
        continue;
      }
      if (text.startsWith('<![CDATA[', p)) {
        const end = text.indexOf(']]>', p);
        if (end < 0) fail('unterminated CDATA section');
        buf += text.slice(p + 9, end);
        advance(end + 3 - p);
        continue;
      }
      if (text.startsWith('<?', p)) {
        const end = text.indexOf('?>', p);
        if (end < 0) fail('unterminated processing instruction');
        advance(end + 2 - p);
        continue;
      }
      if (text[p] === '<') {
        flush();
        children.push(element());
        continue;
      }
      const next = text.indexOf('<', p);
      const end = next < 0 ? text.length : next;
      buf += decode(text.slice(p, end));
      advance(end - p);
    }
  };
  skipMisc();
  if (p >= text.length) fail('the document has no root element');
  const root = element();
  skipMisc();
  if (p < text.length) fail('content after the root element');
  return root;
}

/** Child elements of an element (text runs skipped). */
export function childElements(el: XmlElement): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== 'string');
}

/** Concatenated text content of an element's direct text runs. */
export function textOf(el: XmlElement): string {
  return el.children.filter((c): c is string => typeof c === 'string').join('');
}
