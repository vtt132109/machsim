/**
 * Flows over several open documents (lazy chunk): File > Close, Close all, Save all, the quit
 * question of the desktop window, and moving content from one document to another (drag a
 * selection or a library part onto a document tab).
 *
 * The rules (what is asked, in which order, what happens on Cancel) are in documents.ts and tested
 * there; this module only supplies the dialogs and the Save function.
 */
import { getDesktopBridge } from '../../desktop/bridge';
import { choiceDialog } from '../common/dialogs';
import { actions, getState } from '../store';
import { visibleRect } from '../store/viewport';
import { dt } from '../../i18n/docsText';
import { t } from '../../i18n';
import { displayFileName } from './files';
import { saveDocument, syncRecovery } from './document';
import { documents } from './documentSet';
import type { CloseHost, DocumentInfo, UnsavedChoice } from './documents';

const names = (docs: readonly DocumentInfo[]): string => docs.map((d) => `•  ${displayFileName(d.fileName)}`).join('\n');

/** The dialogs of the close flows. */
export const closeHost: CloseHost = {
  async askUnsaved(docs, why): Promise<UnsavedChoice> {
    const many = docs.length > 1;
    const title = why === 'quit' ? dt('quitTitle') : why === 'closeAll' ? dt('closeAllTitle') : dt('closeTitle');
    let message: string;
    if (why === 'quit') message = many ? `${dt('quitMany', { n: docs.length })}\n\n${names(docs)}` : dt('quitOne', { name: displayFileName(docs[0].fileName) });
    else if (many) message = `${dt('closeMany', { n: docs.length })}\n\n${names(docs)}`;
    else message = dt('closeOne', { name: displayFileName(docs[0].fileName) });
    const choice = await choiceDialog({
      title,
      message,
      choices: [
        { id: 'cancel', label: dt('cancel') },
        { id: 'discard', label: dt('dontSave'), danger: true },
        { id: 'save', label: many ? dt('saveAll') : dt('save'), primary: true },
      ],
    });
    return choice === 'save' || choice === 'discard' ? choice : 'cancel';
  },
  saveActive: () => saveDocument(),
};

/** File > Close: the current document (or the one named), asking about unsaved changes. */
export async function closeDocumentFlow(id: string = documents.activeId()): Promise<boolean> {
  const ok = await documents.close(id, closeHost);
  if (ok) syncRecovery();
  return ok;
}

/** File > Close all. */
export async function closeAllFlow(): Promise<boolean> {
  const ok = await documents.closeAll(closeHost, 'closeAll');
  if (ok) syncRecovery();
  return ok;
}

/** File > Save all. */
export async function saveAllFlow(): Promise<boolean> {
  const dirty = documents.dirtyDocuments().length;
  if (!dirty) {
    actions.addSimMessage('info', dt('nothingToSave'), t('sim.source.documents'));
    return true;
  }
  const ok = await documents.saveAll(closeHost);
  if (ok) actions.addSimMessage('info', dt('savedAll', { n: dirty }), t('sim.source.documents'));
  return ok;
}

/** The desktop window is closing: ONE question lists the unsaved documents, then the shell quits. */
export async function quitFlow(): Promise<void> {
  if (await documents.closeAll(closeHost, 'quit')) getDesktopBridge()?.confirmQuit?.();
}

// ---------------------------------------------------------------------------
// between documents
// ---------------------------------------------------------------------------

function nameOf(id: string): string {
  const info = documents.list().find((d) => d.id === id);
  return info ? displayFileName(info.fileName) : '';
}

/** Where in the current view new content goes: a little inside the top-left corner of what is shown. */
function viewCorner(): { x: number; y: number } {
  const s = getState();
  const view = s.views[s.activeSheetId] ?? { panX: 0, panY: 0, zoom: 1 };
  const r = visibleRect(view, s.viewportSize);
  return { x: r.x + 40, y: r.y + 40 };
}

/**
 * Copy the selection into another open document and show that document. The clipboard keeps the
 * copy, so the same content can be pasted into more documents; references that only mean something
 * in the source design (global parameters, assembly variants, user components) travel with it
 * (src/model/sanitize.ts).
 */
export async function copySelectionToDocument(id: string): Promise<boolean> {
  if (id === documents.activeId() || !getState().selection.length) return false;
  const count = getState().selection.length;
  if (!actions.copy()) return false;
  if (!(await documents.switchTo(id))) return false;
  const corner = viewCorner();
  if (!actions.paste(corner)) {
    actions.addSimMessage('warning', dt('dropFailed'), t('sim.source.documents'));
    return false;
  }
  actions.addSimMessage('info', dt('copiedTo', { n: count, name: nameOf(id) }), t('sim.source.documents'));
  return true;
}

/** Place a library part (dragged from the component browser) into another open document. */
export async function placePartInDocument(id: string, partId: string): Promise<boolean> {
  if (id === documents.activeId()) return false;
  if (!(await documents.switchTo(id))) return false;
  const placed = actions.placePart(partId, viewCorner());
  if (!placed) {
    actions.addSimMessage('warning', dt('dropFailed'), t('sim.source.documents'));
    return false;
  }
  actions.addSimMessage('info', dt('placedIn', { name: nameOf(id) }), t('sim.source.documents'));
  return true;
}
