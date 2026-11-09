/**
 * Start-up wiring of the file features (light; the flows load on first use from ./flows):
 *   - File > Open of non-.msim formats goes to flows.handleOtherFormat (document.ts
 *     otherFormatHandler);
 *   - a snippet picture dropped onto the schematic is placed where it was dropped; a design /
 *     exchange file dropped anywhere on the window is opened (browsers would otherwise navigate to
 *     the file); a snippet dropped outside the schematic is placed in the middle of the view;
 *   - pasting a copied snippet file (Ctrl+V after copying the .png in the file manager) places it.
 * The keyboard handler (App.tsx) lets Ctrl+V reach the browser's paste event when MachSim's own
 * clipboard is empty, so the paste listener below sees files from the system clipboard.
 */
import { confirmDiscardChanges, openOpenedFile, otherFormatHandler } from '../app/document';
import { openedFromFile } from '../app/files';
import { canvasFileDrop } from '../editor/controller';
import { actions, getState } from '../store';
import { t } from '../../i18n';

const flows = () => import('./flows');

/** Files File > Open understands (dropped on the window). */
const OPENABLE = /\.(msim|json|xml|kicad_sch|edf|edif|edn|edo|cir|sp|spi|spice|net|ckt|bak\d*|dsn|ms\d{1,2}|utsch|msmx|mp14|mpzip|prz|mst1[34]|oecl|mspc|pcb3?)$/i;

const isPng = (f: File) => f.type === 'image/png' || /\.png$/i.test(f.name);

async function placeFile(file: File, at?: { x: number; y: number }): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await (await flows()).placeSnippetBytes(bytes, file.name, at);
}

/** Closed formats of other programs: opening them only explains how to export (nothing is replaced). */
const EXPLAIN_ONLY = /\.(dsn|ms\d{1,2}|msm|utsch|msmx|mp14|mpzip|prz|mst1[34]|oecl|mspc|pcb3?)$/i;

async function openFile(file: File): Promise<void> {
  if (!EXPLAIN_ONLY.test(file.name) && !(await confirmDiscardChanges(t('app.document.openAnotherDesign')))) return;
  await openOpenedFile(await openedFromFile(file));
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT';
}

let installed: (() => void) | null = null;

/** Install the handlers (idempotent); returns the uninstall function. */
export function installFileFeatures(): () => void {
  if (installed) return installed;
  otherFormatHandler.current = async (f) => (await flows()).handleOtherFormat(f);
  canvasFileDrop.current = (files, at) => {
    const png = files.find(isPng);
    if (png) {
      void placeFile(png, at);
      return true;
    }
    const doc = files.find((f) => OPENABLE.test(f.name));
    if (doc) {
      void openFile(doc);
      return true;
    }
    return false;
  };
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  };
  const onDrop = (e: DragEvent) => {
    if (e.defaultPrevented || !e.dataTransfer?.files.length) return;
    const files = Array.from(e.dataTransfer.files);
    const doc = files.find((f) => OPENABLE.test(f.name));
    const png = files.find(isPng);
    if (!doc && !png) return;
    e.preventDefault();
    if (doc) void openFile(doc);
    else if (png) void placeFile(png);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isEditable(document.activeElement)) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    const png = files.find(isPng);
    if (png) {
      e.preventDefault();
      void placeFile(png);
      return;
    }
    if (!getState().clipboardAvailable && !files.length) {
      void flows().then((m) => actions.addSimMessage('info', m.pasteNothingText(), 'snippet'));
    }
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  document.addEventListener('paste', onPaste);
  installed = () => {
    otherFormatHandler.current = null;
    canvasFileDrop.current = null;
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
    document.removeEventListener('paste', onPaste);
    installed = null;
  };
  return installed;
}
