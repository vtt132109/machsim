/**
 * A circuit on the operating-system clipboard (Edit › Copy to the system clipboard / Paste from it).
 *
 * A copied selection is put there in up to four forms, so that every program that receives it can
 * use what it understands:
 *
 *   1. a picture (image/png) of the selection, which any program can paste;
 *   2. a PRIVATE FORMAT carrying the circuit itself — `application/x-machsim-circuit` — a registered
 *      format of the desktop clipboard (Electron) and, in browsers that allow custom clipboard
 *      formats, the web custom format `web application/x-machsim-circuit` of the async Clipboard API.
 *      Other programs ignore it; MachSim pastes the circuit, not the picture;
 *   3. HTML in which the picture carries the same circuit in a `data-machsim-circuit` attribute —
 *      a standard format that survives where a custom one cannot be written next to the others;
 *   4. plain text: a one-line description of what was copied.
 * The picture is the snippet PNG of src/model/snippet.ts (it also holds the circuit in a text
 * chunk), but a clipboard usually re-encodes pictures and drops such chunks — that is the whole
 * reason for the private format. {@link judgeClipboard} therefore says, from what is on the
 * clipboard, what a paste can do BEFORE any paste is attempted: paste the circuit, or explain that
 * the clipboard only holds a picture whose circuit data was lost on the way.
 *
 *   encodeCircuitClipboard(data)    bytes of the private format
 *   decodeCircuitClipboard(bytes)   SnippetData (SnippetError when it is not a circuit / damaged / newer)
 *   circuitHtml(data, png?)         the HTML form; circuitFromHtml(html) reads it back
 *   judgeClipboard(offer)           what a paste would find: a circuit (and where from), only a
 *                                   picture, a damaged circuit, or nothing
 *
 * Pure module: no DOM, no Electron. The real clipboards are touched by src/ui/files/systemClipboard.ts.
 */
import { SnippetError, hasSnippet, decodeSnippet, readSnippet, type SnippetData } from './snippet';

/** Name of the private format on the desktop clipboard. */
export const CLIPBOARD_PRIVATE_FORMAT = 'application/x-machsim-circuit';
/** The same format as a web custom format of the async Clipboard API. */
export const CLIPBOARD_WEB_FORMAT = 'web application/x-machsim-circuit';
/** Attribute of the `<img>` in the HTML form that holds the circuit (base64 of the private format). */
export const CLIPBOARD_HTML_ATTRIBUTE = 'data-machsim-circuit';
/** First line of the private format. */
export const CLIPBOARD_MAGIC = 'machsim-circuit-clipboard 1';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The private format: the magic line, then the snippet JSON (UTF-8). */
export function encodeCircuitClipboard(data: SnippetData): Uint8Array {
  return encoder.encode(`${CLIPBOARD_MAGIC}\n${JSON.stringify(data)}`);
}

/** Read the private format back; throws {@link SnippetError} ('no-data', 'damaged', 'newer' or 'invalid'). */
export function decodeCircuitClipboard(input: Uint8Array | string): SnippetData {
  const text = typeof input === 'string' ? input : decoder.decode(input);
  const body = text.replace(/^﻿/, '');
  if (!body.startsWith(CLIPBOARD_MAGIC)) throw new SnippetError('no-data', 'the clipboard data is not a MachSim circuit');
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(CLIPBOARD_MAGIC.length).trim());
  } catch (err) {
    throw new SnippetError('damaged', `the clipboard circuit is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  return readSnippet(raw);
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The HTML form: an `<img>` of the picture (when given as a data URL) with the circuit in the
 * `data-machsim-circuit` attribute. A rich-text program shows the picture, MachSim finds the circuit.
 */
export function circuitHtml(data: SnippetData, pngDataUrl?: string): string {
  const payload = bytesToBase64(encodeCircuitClipboard(data));
  const alt = `MachSim: ${data.fragment.parts.length} parts, ${data.fragment.wires.length} wires`;
  return `<meta charset="utf-8"><img ${CLIPBOARD_HTML_ATTRIBUTE}="${payload}" alt="${escapeAttr(alt)}"${pngDataUrl ? ` src="${escapeAttr(pngDataUrl)}"` : ''}>`;
}

/** The circuit an HTML clipboard fragment carries, or null when it carries none. */
export function circuitFromHtml(html: string): SnippetData | null {
  const m = new RegExp(`${CLIPBOARD_HTML_ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(html);
  if (!m) return null;
  try {
    return decodeCircuitClipboard(base64ToBytes(m[1]));
  } catch {
    return null;
  }
}

/** What is on the clipboard, as far as MachSim can tell without pasting. */
export interface ClipboardOffer {
  /** the private format (desktop clipboard or web custom format) */
  privateBytes?: Uint8Array;
  html?: string;
  /** the picture on the clipboard, as PNG bytes */
  png?: Uint8Array;
  text?: string;
}

export type ClipboardVerdict =
  /** a circuit can be pasted */
  | { kind: 'circuit'; data: SnippetData; via: 'private' | 'html' | 'picture' | 'text' }
  /** there is a picture but no circuit in it: the data was lost on the way (or the picture never had any) */
  | { kind: 'picture-only' }
  /** MachSim's data is there but cannot be used */
  | { kind: 'damaged'; error: SnippetError }
  | { kind: 'nothing' };

/**
 * Decide, before anything is pasted, what a paste can do. Order of preference: the private format,
 * the circuit in the HTML, the circuit in the PNG chunk of the picture, a circuit written out as
 * text. A picture with none of them is `picture-only`; a MachSim data block that cannot be read is
 * `damaged` (it names the reason), and only when no other form works.
 */
export function judgeClipboard(offer: ClipboardOffer): ClipboardVerdict {
  let damaged: SnippetError | null = null;
  const attempt = (via: 'private' | 'html' | 'picture' | 'text', read: () => SnippetData | null): ClipboardVerdict | null => {
    try {
      const data = read();
      return data ? { kind: 'circuit', data, via } : null;
    } catch (err) {
      if (err instanceof SnippetError && err.code !== 'no-data' && err.code !== 'not-png') damaged ??= err;
      return null;
    }
  };
  if (offer.privateBytes?.length) {
    const r = attempt('private', () => decodeCircuitClipboard(offer.privateBytes!));
    if (r) return r;
  }
  if (offer.html) {
    const r = attempt('html', () => circuitFromHtml(offer.html!));
    if (r) return r;
  }
  if (offer.png?.length) {
    const r = attempt('picture', () => (hasSnippet(offer.png!) ? decodeSnippet(offer.png!) : null));
    if (r) return r;
  }
  if (offer.text?.startsWith(CLIPBOARD_MAGIC)) {
    const r = attempt('text', () => decodeCircuitClipboard(offer.text!));
    if (r) return r;
  }
  if (damaged) return { kind: 'damaged', error: damaged };
  if (offer.png?.length) return { kind: 'picture-only' };
  return { kind: 'nothing' };
}

/** The one-line plain-text form of a copied circuit. */
export function circuitText(data: SnippetData): string {
  return `MachSim circuit: ${data.fragment.parts.length} parts, ${data.fragment.wires.length} wires${data.title ? ` (${data.title})` : ''}`;
}
