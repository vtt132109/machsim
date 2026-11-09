/**
 * Sending a print job to paper or to a PDF file.
 *
 * The pages are mounted (with the same React component the preview uses) into a print-only
 * container at the end of the document, together with an `@page` rule for the chosen paper and
 * no page margin (the margins are part of the page boxes). Then
 *  - desktop: the shell prints that page with the system print dialog (`printPage`) or writes a PDF
 *    (`printToPdf`, asks where to save), so both use the options chosen in the preview;
 *  - browser: `window.print()` shows the browser's print dialog, which also offers "Save as PDF".
 * The container is removed again when printing has finished.
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement } from 'react';
import { getDesktopBridge, type DesktopSaved } from '../../desktop/bridge';
import { PrintPages, type PrintPagesProps } from './PrintPages';

export interface PrintOutcome {
  ok: boolean;
  /** the file written by "Save as PDF" */
  saved?: DesktopSaved;
  /** why it failed (desktop) */
  error?: string;
}

/** The `@page` rule of a layout. */
export function pageRule(paperMm: { w: number; h: number }): string {
  return `@page { size: ${paperMm.w}mm ${paperMm.h}mm; margin: 0; }`;
}

interface Mounted {
  done: () => void;
}

async function mount(props: PrintPagesProps): Promise<Mounted> {
  document.querySelector('.ms-print-area')?.remove();
  document.getElementById('ms-print-page-style')?.remove();
  const style = document.createElement('style');
  style.id = 'ms-print-page-style';
  style.textContent = pageRule(props.layout.paperMm);
  document.head.appendChild(style);
  const host = document.createElement('div');
  host.className = 'ms-print-area';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(PrintPages, props)));
  // every picture has to be decoded before the page is handed to the printer
  await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));
  return {
    done: () => {
      root.unmount();
      host.remove();
      style.remove();
    },
  };
}

/** Print the pages (system print dialog on the desktop, the browser's print dialog otherwise). */
export async function printPages(props: PrintPagesProps): Promise<PrintOutcome> {
  const m = await mount(props);
  const bridge = getDesktopBridge();
  const o = { widthMm: props.layout.paperMm.w, heightMm: props.layout.paperMm.h, landscape: props.layout.paperMm.w > props.layout.paperMm.h, color: !props.setup.monochrome };
  try {
    if (bridge?.printPage) {
      const r = await bridge.printPage(o);
      return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
    }
    await new Promise<void>((resolve) => {
      const after = () => {
        window.removeEventListener('afterprint', after);
        resolve();
      };
      window.addEventListener('afterprint', after);
      window.print();
      // a browser that never fires afterprint must not keep the pages mounted forever
      setTimeout(after, 120_000);
    });
    return { ok: true };
  } finally {
    m.done();
  }
}

/** True when this build can write a PDF itself (the desktop shell). */
export function canSavePdf(): boolean {
  return typeof getDesktopBridge()?.printToPdf === 'function';
}

/** Save the pages as a PDF through the desktop shell's save dialog; ok false when cancelled. */
export async function savePagesAsPdf(props: PrintPagesProps, suggestedName: string): Promise<PrintOutcome> {
  const bridge = getDesktopBridge();
  if (!bridge?.printToPdf) return { ok: false, error: 'no PDF support' };
  const m = await mount(props);
  try {
    const saved = await bridge.printToPdf({ widthMm: props.layout.paperMm.w, heightMm: props.layout.paperMm.h, landscape: props.layout.paperMm.w > props.layout.paperMm.h, color: !props.setup.monochrome, suggestedName });
    return saved ? { ok: true, saved } : { ok: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    m.done();
  }
}
