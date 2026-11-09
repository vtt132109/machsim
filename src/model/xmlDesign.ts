/**
 * MachSim XML exchange format (File > Export > MachSim XML, File > Open *.xml): the .msim design
 * written as XML, element for element, so other tools can read and write MachSim designs without
 * a JSON library and a round trip is lossless. The format is documented in docs/xml-format.md.
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <machsim-design xmlns="urn:machsim:design-xml:1" xml-format="1" saved-by="MachSim 0.1.0">
 *     <format>machsim-design</format>
 *     <version type="number">2</version>
 *     <title>RC low-pass</title>
 *     <sheets type="array">
 *       <sheet>
 *         <id>sheet1</id> … <parts type="array"><part> … <params><value>1k</value></params></part></parts>
 *
 * Mapping of every JSON value (the root element is the design object):
 *   object   element whose child elements are its members, in order (`type="object"` when empty)
 *   array    `type="array"`, one child element per item, named after the array (`sheets` → `sheet`,
 *            `children` → `child`, `…ies` → `…y`, otherwise `item`); readers accept any item name
 *   string   text content (no attribute); an empty element is the empty string; text with
 *            characters XML cannot carry (C0 controls, lone surrogates) is `encoding="json"`
 *            holding a JSON string literal
 *   number   `type="number"`, the shortest JavaScript text that reads back to the same double
 *   boolean  `type="boolean"`, true / false
 *   null     `type="null"`
 * Member names that are not XML names (digits first, spaces, a colon, starting with "xml") are
 * written as `<entry key="…">`; an `entry` element without `key` is a member named "entry".
 *
 *   designToXml(design)   XML text
 *   xmlToDesign(text)     validated Design (migrated like a .msim; DesignFormatError on problems)
 *   valueToXml / xmlToValue  the generic mapping (tests, other formats)
 */
import { SAVED_BY } from './appInfo';
import { DesignFormatError, migrateDesign } from './serialize';
import { validateDesignSafely, type SanitizeNote } from './sanitize';
import type { Design } from './types';
import { childElements, escapeAttr, escapeText, isXmlName, parseXml, textOf, XmlError, xmlSafe, type XmlElement } from '../util/xml';

export const XML_NAMESPACE = 'urn:machsim:design-xml:1';
export const XML_ROOT = 'machsim-design';
export const XML_FORMAT_VERSION = 1;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Element name for a member key (or null: write it as <entry key="…">). */
function memberName(key: string): string | null {
  return isXmlName(key) && !key.includes(':') && !/^xml/i.test(key) && key !== 'entry' ? key : null;
}

/** Element name of the items of an array stored under `key`. */
export function itemName(key: string | null): string {
  if (!key) return 'item';
  let n: string;
  if (key === 'children') n = 'child';
  else if (/[^aeiou]ies$/.test(key)) n = `${key.slice(0, -3)}y`;
  else if (/(ss|us)$/.test(key) || !key.endsWith('s') || key.length < 3) return 'item';
  else n = key.slice(0, -1);
  return memberName(n) && n !== 'item' ? n : 'item';
}

/** One JSON value as an element named `name` (attributes `extra` first). */
export function valueToXml(value: Json, name: string, indent = '', extra = '', arrayKey: string | null = null): string {
  const open = `${indent}<${name}${extra}`;
  if (value === null) return `${open} type="null"/>`;
  if (typeof value === 'boolean') return `${open} type="boolean">${value ? 'true' : 'false'}</${name}>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot write the number ${value} in XML`);
    return `${open} type="number">${String(value)}</${name}>`;
  }
  if (typeof value === 'string') {
    if (!xmlSafe(value)) return `${open} encoding="json">${escapeText(JSON.stringify(value).replace(/[￾￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`))}</${name}>`;
    return value === '' ? `${open}/>` : `${open}>${escapeText(value)}</${name}>`;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return `${open} type="array"/>`;
    const item = itemName(arrayKey);
    return `${open} type="array">\n${value.map((v) => valueToXml(v, item, inner, '', null)).join('\n')}\n${indent}</${name}>`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return `${open} type="object"/>`;
  const members = keys.map((k) => {
    const el = memberName(k);
    return el ? valueToXml(value[k], el, inner, '', k) : valueToXml(value[k], 'entry', inner, ` key="${escapeAttr(k)}"`, k);
  });
  return `${open}>\n${members.join('\n')}\n${indent}</${name}>`;
}

function bad(el: XmlElement, msg: string): never {
  throw new XmlError(`<${el.name}>: ${msg}`, el.line);
}

/** The JSON value an element holds (inverse of valueToXml). */
export function xmlToValue(el: XmlElement): Json {
  const type = el.attrs.type;
  const kids = childElements(el);
  const text = textOf(el);
  if (el.attrs.encoding !== undefined) {
    if (el.attrs.encoding !== 'json') bad(el, `unknown encoding "${el.attrs.encoding}"`);
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      bad(el, 'encoding="json" needs a JSON string literal');
    }
    if (typeof v !== 'string') bad(el, 'encoding="json" needs a JSON string literal');
    return v as string;
  }
  const noKids = () => {
    if (kids.length) bad(el, `a ${type} value has no child elements`);
  };
  switch (type) {
    case 'null':
      noKids();
      if (text.trim()) bad(el, 'a null value has no text');
      return null;
    case 'boolean':
      noKids();
      if (text.trim() === 'true') return true;
      if (text.trim() === 'false') return false;
      return bad(el, `expected true or false (got "${text}")`);
    case 'number': {
      noKids();
      const s = text.trim();
      const n = Number(s);
      if (!s || !Number.isFinite(n)) bad(el, `expected a number (got "${text}")`);
      return n;
    }
    case 'string':
      noKids();
      return text;
    case 'array':
      if (text.trim()) bad(el, 'unexpected text in an array');
      return kids.map(xmlToValue);
    case 'object':
    case undefined: {
      if (type === undefined && !kids.length) return text;
      if (text.trim()) bad(el, 'unexpected text between members');
      const out: { [k: string]: Json } = {};
      for (const k of kids) {
        const key = k.name === 'entry' && k.attrs.key !== undefined ? k.attrs.key : k.name;
        if (Object.prototype.hasOwnProperty.call(out, key)) bad(k, `member "${key}" appears twice`);
        out[key] = xmlToValue(k);
      }
      return out;
    }
    default:
      return bad(el, `unknown type "${type}"`);
  }
}

/** The design as MachSim XML text (UTF-8, LF line ends). */
export function designToXml(design: Design, savedBy: string = SAVED_BY): string {
  const json = JSON.parse(JSON.stringify(design)) as Json;
  const attrs = ` xmlns="${XML_NAMESPACE}" xml-format="${XML_FORMAT_VERSION}" saved-by="${escapeAttr(savedBy)}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- MachSim design exchange file (docs/xml-format.md) -->\n${valueToXml(json, XML_ROOT, '', attrs)}\n`;
}

/** The raw design object of a MachSim XML file (not yet migrated or validated). */
export function xmlToRaw(text: string): Record<string, unknown> {
  const root = parseXml(text);
  if (root.name !== XML_ROOT) throw new XmlError(`not a MachSim design XML file (root element <${root.name}>)`, root.line);
  const fmt = root.attrs['xml-format'];
  if (fmt !== undefined && Number(fmt) > XML_FORMAT_VERSION) throw new XmlError(`the file uses a newer MachSim XML format (${fmt})`, root.line);
  // the root's own attributes describe the file, not the design
  const v = xmlToValue({ ...root, attrs: {} });
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new XmlError('the root element holds no design', root.line);
  return v as Record<string, unknown>;
}

/**
 * Parse a MachSim XML design (migrated and validated like a .msim file). Design-scoped references
 * another tool got wrong are repaired by the shared integrity layer and reported in `notes`
 * (src/model/sanitize.ts), so an XML file written by hand opens with a note instead of being
 * refused.
 */
export function xmlToDesignSafely(text: string): { design: Design; notes: SanitizeNote[] } {
  let raw: Record<string, unknown>;
  try {
    raw = xmlToRaw(text);
  } catch (err) {
    if (err instanceof XmlError) throw new DesignFormatError([err.message]);
    throw err;
  }
  return validateDesignSafely(migrateDesign(raw));
}

/** Parse a MachSim XML design; see {@link xmlToDesignSafely} for the repair notes. */
export function xmlToDesign(text: string): Design {
  return xmlToDesignSafely(text).design;
}

/** Quick check: does the text look like a MachSim design XML file? */
export function isDesignXml(text: string): boolean {
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<machsim-design[\s>]/.test(text.replace(/^﻿/, ''));
}
