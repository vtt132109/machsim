/**
 * Status bar: simulation state / message / simulated time, the object under the cursor or the
 * selection summary, cursor coordinates (sheet units, grid snapped), zoom and the document state.
 */
import { useSyncExternalStore } from 'react';
import { formatEng } from '../../util/units';
import { cursorStore, isDirty, statusNotice, useEditor } from '../store';
import { DEFAULT_VIEW } from '../store/viewport';
import { actions } from '../store';
import { hasMessage, t, tDynamic } from '../../i18n';
import { displayFileName } from './files';
import { activeVariant } from '../../model/variants';
import { runCommand } from './extensions';

function selectionSummary(sel: { kind: string }[]): string {
  if (sel.length === 0) return '';
  const counts = new Map<string, number>();
  for (const it of sel) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  const items = Array.from(counts.entries()).map(([k, n]) => (hasMessage(`status.kind.${k}`) ? tDynamic(`status.kind.${k}`, { n }) : `${n} ${k}`));
  return t('status.selected', { items: items.join(', ') });
}

const stateText = (state: 'idle' | 'running' | 'paused' | 'error'): string => t(`sim.state.${state}`);

export function StatusBar() {
  const cursor = useSyncExternalStore(cursorStore.subscribe, cursorStore.getState, cursorStore.getState);
  const notice = useSyncExternalStore(statusNotice.subscribe, statusNotice.getState, statusNotice.getState).text;
  const sim = useEditor((s) => s.sim);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => (s.views[s.activeSheetId] ?? DEFAULT_VIEW).zoom);
  const dirty = useEditor(isDirty);
  const fileName = displayFileName(useEditor((s) => s.fileName));
  const sheetName = useEditor((s) => s.design.sheets.find((x) => x.id === s.activeSheetId)?.name ?? '');
  const restricted = useEditor((s) => !!s.design.restrictions);
  const variant = useEditor((s) => activeVariant(s.design)?.name);
  const beginner = useEditor((s) => s.ui.beginner === true);
  const middle = notice || cursor.hover || selectionSummary(selection);
  return (
    <footer className="ms-statusbar" aria-label={t('app.statusBar.statusBar')}>
      <span className={`ms-sb-sim is-${sim.state}`} role="status" aria-live="polite">
        <span className="ms-sb-dot" aria-hidden="true" />
        <span>{stateText(sim.state)}</span>
        {sim.message && sim.message !== stateText(sim.state) ? <span className="ms-sb-msg">{sim.message}</span> : sim.state === 'idle' ? <span className="ms-sb-msg">{t('sim.ready')}</span> : null}
        {sim.simTime > 0 ? <span className="ms-sb-time">t = {formatEng(sim.simTime, 's')}</span> : null}
      </span>
      <span className="ms-sb-middle" role={notice ? 'alert' : undefined}>
        {middle}
      </span>
      <span className="ms-sb-cell" title={t('app.statusBar.cursorPositionSchematicUnits')}>
        {cursor.pos ? `X ${cursor.pos.x}  Y ${cursor.pos.y}` : 'X —  Y —'}
      </span>
      <button type="button" className="ms-sb-cell ms-sb-btn" title={t('app.statusBar.zoomClickFor100')} onClick={() => actions.zoomTo(1)}>
        {Math.round(zoom * 100)}%
      </button>
      {beginner ? (
        <button type="button" className="ms-sb-cell ms-sb-btn" title={t('beginner.statusTip')} onClick={() => void runCommand('options.beginnerMode')}>
          {t('beginner.status')}
        </button>
      ) : null}
      {variant ? (
        <button type="button" className="ms-sb-cell ms-sb-btn" title={t('cmd.tools.variants')} onClick={() => void runCommand('tools.variants')}>
          {t('variant.statusBar', { name: variant })}
        </button>
      ) : null}
      {restricted ? (
        <span className="ms-sb-cell" title={t('learn.restricted.banner')}>
          🔒
        </span>
      ) : null}
      <span className="ms-sb-cell">{sheetName}</span>
      <span className="ms-sb-cell" title={dirty ? t('app.statusBar.unsavedChanges') : t('app.statusBar.saved')}>
        {dirty ? '● ' : ''}
        {fileName}
      </span>
    </footer>
  );
}
