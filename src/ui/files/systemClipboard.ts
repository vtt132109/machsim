/**
 * The circuit on the operating-system clipboard (Edit › Copy to the system clipboard, Paste from it;
 * also what Ctrl+V does when MachSim's own clipboard is empty). Loaded on demand with ./flows.
 *
 *   copyToSystemClipboard()    the selection as a picture + the private circuit format (+ HTML + text)
 *   pasteFromSystemClipboard() read the clipboard, decide what a paste can do, then paste or explain
 *
 * Desktop: the Electron clipboard through the bridge (clipboardWrite / clipboardRead). Browser: the
 * async Clipboard API — `image/png`, `text/html`, `text/plain` and, where the browser allows custom
 * formats, `web application/x-machsim-circuit`. Where a browser cannot write or read what is needed
 * the learner gets the limit explained: at copy time (what will and will not work) and, on paste,
 * BEFORE any paste is attempted (a picture from another program that lost the circuit data is
 * explained, not pasted and then reported as an error). The formats and the decision are in
 * src/model/clipboardCircuit.ts.
 */
import { getDesktopBridge, type DesktopClipboardContent } from '../../desktop/bridge';
import {
  CLIPBOARD_PRIVATE_FORMAT,
  CLIPBOARD_WEB_FORMAT,
  base64ToBytes,
  bytesToBase64,
  circuitHtml,
  circuitText,
  encodeCircuitClipboard,
  judgeClipboard,
  type ClipboardOffer,
} from '../../model/clipboardCircuit';
import { valuesHidden } from '../../model/restrictions';
import { buildSnippet, encodeSnippet, SnippetError } from '../../model/snippet';
import { ft } from '../../i18n/filesText';
import { alertDialog } from '../common/dialogs';
import { actions, getState, partLookup } from '../store';
import { copyItems } from '../store/designOps';
import { fragmentPicture, placeSnippetData, snippetErrorText } from './flows';

/** The async Clipboard API with write support, or null (insecure page, old browser, no document). */
function webClipboard(): Clipboard | null {
  if (typeof navigator === 'undefined' || typeof ClipboardItem === 'undefined') return null;
  const c = navigator.clipboard;
  return c && typeof c.write === 'function' && typeof c.read === 'function' ? c : null;
}

/** Whether this browser accepts the web custom format (ClipboardItem.supports, Chromium 121+). */
function webCustomFormatSupported(): boolean {
  const item = ClipboardItem as unknown as { supports?: (type: string) => boolean };
  return typeof item.supports === 'function' ? item.supports(CLIPBOARD_WEB_FORMAT) : true;
}

const blob = (bytes: Uint8Array | string, type: string): Blob => new Blob([bytes as BlobPart], { type });

function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${bytesToBase64(png)}`;
}

/** Edit › Copy to the system clipboard. Resolves true when something was put there. */
export async function copyToSystemClipboard(): Promise<boolean> {
  const s = getState();
  if (!s.selection.length) {
    await alertDialog({ title: ft('clipboardTitle'), message: ft('snippetNothingSelected') });
    return false;
  }
  if (valuesHidden(s.design)) {
    await alertDialog({ title: ft('clipboardTitle'), message: ft('snippetHidden') });
    return false;
  }
  const frag = copyItems(s.design, s.activeSheetId, s.selection, partLookup);
  if (!frag) return false;
  // MachSim's own clipboard gets it too, so Ctrl+V in this window pastes at the cursor as usual
  actions.copy();
  const data = buildSnippet(s.design, frag);
  const { png } = await fragmentPicture(s.design, data.fragment);
  const picture = encodeSnippet(png, data);
  const counts = { parts: data.fragment.parts.length, wires: data.fragment.wires.length };
  const payload = encodeCircuitClipboard(data);
  const html = circuitHtml(data, pngDataUrl(picture));
  const text = circuitText(data);

  const bridge = getDesktopBridge();
  if (bridge?.clipboardWrite) {
    try {
      const r = await bridge.clipboardWrite({ png: bytesToBase64(picture), text, html, privateFormat: CLIPBOARD_PRIVATE_FORMAT, privateData: bytesToBase64(payload) });
      const hasPrivate = r.formats.includes(CLIPBOARD_PRIVATE_FORMAT);
      actions.addSimMessage(hasPrivate ? 'info' : 'warning', hasPrivate ? ft('clipboardCopied', counts) : ft('clipboardCopiedNoPrivate', counts), 'clipboard');
      return true;
    } catch (err) {
      await alertDialog({ title: ft('clipboardTitle'), message: writeFailure(err) });
      return false;
    }
  }

  const web = webClipboard();
  if (!web) {
    await alertDialog({ title: ft('clipboardTitle'), message: ft('clipboardNoApi') });
    return false;
  }
  const items: Record<string, Blob> = { 'image/png': blob(picture, 'image/png'), 'text/plain': blob(text, 'text/plain'), 'text/html': blob(html, 'text/html') };
  const custom = webCustomFormatSupported();
  try {
    await web.write([new ClipboardItem(custom ? { ...items, [CLIPBOARD_WEB_FORMAT]: blob(payload, CLIPBOARD_PRIVATE_FORMAT) } : items)]);
    actions.addSimMessage(custom ? 'info' : 'warning', custom ? ft('clipboardCopied', counts) : ft('clipboardCopiedPicture', counts), 'clipboard');
    if (!custom) await alertDialog({ title: ft('clipboardTitle'), message: ft('clipboardNoCustom') });
    return true;
  } catch {
    // the browser refused the custom format (or the HTML): the picture alone
    try {
      await web.write([new ClipboardItem({ 'image/png': blob(picture, 'image/png'), 'text/plain': blob(text, 'text/plain') })]);
      actions.addSimMessage('warning', ft('clipboardCopiedPicture', counts), 'clipboard');
      await alertDialog({ title: ft('clipboardTitle'), message: ft('clipboardNoCustom') });
      return true;
    } catch (err) {
      await alertDialog({ title: ft('clipboardTitle'), message: writeFailure(err) });
      return false;
    }
  }
}

/** Why a clipboard WRITE failed, in words a learner can act on (a refused permission is the common case). */
export function writeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return ft('clipboardWriteDenied');
  return ft('clipboardWriteFailed', { reason: err instanceof Error ? err.message : String(err) });
}

const fromBase64 = (v: string | undefined): Uint8Array | undefined => (v ? base64ToBytes(v) : undefined);

/** What is on the clipboard, or 'denied' when the browser will not say. */
async function readOffer(): Promise<ClipboardOffer | 'denied'> {
  const bridge = getDesktopBridge();
  if (bridge?.clipboardRead) {
    const c: DesktopClipboardContent = await bridge.clipboardRead(CLIPBOARD_PRIVATE_FORMAT);
    return { privateBytes: fromBase64(c.privateData), html: c.html, png: fromBase64(c.png), text: c.text };
  }
  const web = webClipboard();
  if (!web) return 'denied';
  try {
    const offer: ClipboardOffer = {};
    for (const item of await web.read()) {
      const get = async (type: string): Promise<Blob | null> => (item.types.includes(type) ? await item.getType(type) : null);
      const priv = await get(CLIPBOARD_WEB_FORMAT);
      if (priv) offer.privateBytes = new Uint8Array(await priv.arrayBuffer());
      const html = await get('text/html');
      if (html) offer.html = await html.text();
      const png = await get('image/png');
      if (png) offer.png = new Uint8Array(await png.arrayBuffer());
      const text = await get('text/plain');
      if (text) offer.text = await text.text();
    }
    return offer;
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return 'denied';
    throw err;
  }
}

/** Edit › Paste from the system clipboard (and Ctrl+V when MachSim's own clipboard is empty). */
export async function pasteFromSystemClipboard(at?: { x: number; y: number }): Promise<boolean> {
  let offer: ClipboardOffer | 'denied';
  try {
    offer = await readOffer();
  } catch (err) {
    await alertDialog({ title: ft('clipboardTitle'), message: ft('clipboardReadFailed', { reason: err instanceof Error ? err.message : String(err) }) });
    return false;
  }
  if (offer === 'denied') {
    await alertDialog({ title: ft('clipboardTitle'), message: ft('clipboardDenied') });
    return false;
  }
  // decide first; nothing is pasted until the clipboard is known to hold a circuit
  const verdict = judgeClipboard(offer);
  switch (verdict.kind) {
    case 'circuit': {
      const ok = await placeSnippetData(verdict.data, at);
      if (ok) actions.addSimMessage('info', ft('pasteFromClipboard'), 'clipboard');
      return ok;
    }
    case 'picture-only':
      await alertDialog({
        title: ft('pasteLostTitle'),
        message: (
          // plain text: two paragraphs
          `${ft('pasteLost')}\n\n${ft('pasteLostHow')}`
        ),
      });
      return false;
    case 'damaged':
      await alertDialog({ title: ft('clipboardTitle'), message: ft('pasteDamaged', { reason: snippetErrorText(verdict.error as SnippetError, '').split('\n')[0] }) });
      return false;
    default:
      actions.addSimMessage('info', ft('pasteNothing'), 'clipboard');
      return false;
  }
}

/**
 * A picture arrived (pasted or dropped) before anything else: say so BEFORE trying to place it when
 * it holds no circuit. Returns the verdict's circuit placement result, or false after explaining.
 */
export async function placePastedPicture(bytes: Uint8Array, name: string, at?: { x: number; y: number }): Promise<boolean> {
  const verdict = judgeClipboard({ png: bytes });
  if (verdict.kind === 'picture-only') {
    await alertDialog({ title: ft('pasteLostTitle'), message: `${ft('pasteLost')}\n\n${ft('pasteLostHow')}` });
    return false;
  }
  if (verdict.kind === 'circuit') return placeSnippetData(verdict.data, at);
  const { placeSnippetBytes } = await import('./flows');
  return placeSnippetBytes(bytes, name, at);
}
