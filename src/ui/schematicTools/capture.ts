/**
 * Capture screen area (command edit.captureArea): the learner drags a rectangle on the sheet and
 * MachSim renders exactly that area as a picture — copied to the clipboard where the browser or the
 * desktop shell allows it, saved as a PNG file otherwise.
 *
 * The picture comes from the same renderer as File › Export PNG (src/ui/editor/exportImage.ts)
 * with the dragged rectangle as the exported area, so it shows the sheet as it is drawn, including
 * live probe read-outs, and is independent of the window size and the UI theme.
 */
import type { Rect } from '../store/types';
import { actions, getState, partLookup } from '../store';
import { exportFile, fileNameForTitle } from '../app/files';
import { t } from '../../i18n';

/** Scale of the captured picture (2 = a crisp picture on a normal screen). */
export const CAPTURE_SCALE = 2;

/** True when the browser can put a PNG on the clipboard. */
export function canCopyImage(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.clipboard && typeof ClipboardItem === 'function' && typeof navigator.clipboard.write === 'function';
}

/** Render `rect` of the active sheet as a PNG blob. */
export async function captureRect(rect: Rect): Promise<{ blob: Blob; width: number; height: number }> {
  const { sheetToSvg, svgToPngBlob } = await import('../editor/exportImage');
  const s = getState();
  const r = sheetToSvg(s.design, s.activeSheetId, partLookup, { rect, probeValues: s.probeValues, indicatorLevels: s.indicatorLevels });
  const blob = await svgToPngBlob(r.svg, r.width, r.height, CAPTURE_SCALE);
  return { blob, width: r.width, height: r.height };
}

/**
 * Capture the area and hand it to the learner: the clipboard first, a PNG file when the clipboard
 * is not available or refuses. Reports what happened in the Simulation messages.
 */
export async function captureAreaFlow(rect: Rect): Promise<void> {
  const { blob, width, height } = await captureRect(rect);
  const size = { w: Math.round(width), h: Math.round(height) };
  if (canCopyImage()) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      actions.addSimMessage('info', t('schematicTools.captureCopied', { w: size.w, h: size.h }), 'ui');
      return;
    } catch {
      actions.addSimMessage('info', t('schematicTools.captureFailed'), 'ui');
    }
  }
  const name = `${fileNameForTitle(getState().design.title || 'design', '').replace(/\.$/, '') || 'design'}-area.png`;
  if (await exportFile(name, blob, { name: 'PNG', extensions: ['png'] })) {
    actions.addSimMessage('info', t('schematicTools.captureSaved', { name }), 'ui');
  }
}
