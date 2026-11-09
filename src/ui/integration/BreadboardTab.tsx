/**
 * "Breadboard 3D" main view: the virtual breadboard (src/breadboard) bound to the open design.
 *
 * - The layout lives in design.breadboard; every edit is one undo step of the editor.
 * - The part selected on the schematic is highlighted on the board and vice versa.
 * - While an interactive simulation runs, LEDs / lamps / displays glow from its live values.
 * The three.js view is loaded on first use so it does not weigh on start-up.
 */
import { Suspense, lazy, useMemo, useSyncExternalStore } from 'react';
import type { BreadboardLayout } from '../../breadboard/types';
import { actions, getState, useEditor } from '../store';
import { findPartByRefdes } from '../store/designOps';
import type { SimulationIntegration } from './controller';
import { t } from '../../i18n';

const BreadboardView = lazy(() => import('../../breadboard/BreadboardView').then((m) => ({ default: m.BreadboardView })));

/** Select a part on the schematic by refdes (switching sheets), or clear the selection. */
export function selectPartByRefdes(refdes: string | null): void {
  if (!refdes) {
    actions.clearSelection();
    return;
  }
  const f = findPartByRefdes(getState().design, refdes);
  if (!f) return;
  actions.setActiveSheet(f.sheetId);
  actions.select([{ kind: 'part', id: f.part.id }]);
}

export function BreadboardTab({ ctrl }: { ctrl: SimulationIntegration }) {
  const design = useEditor((s) => s.design);
  const selection = useEditor((s) => s.selection);
  const sheetId = useEditor((s) => s.activeSheetId);
  const live = useSyncExternalStore(ctrl.live.subscribe, ctrl.live.getState, ctrl.live.getState);
  const running = live.mode === 'interactive' && live.session !== 'none';
  const selectedRefdes = useMemo(() => {
    if (selection.length !== 1 || selection[0].kind !== 'part') return null;
    const sheet = design.sheets.find((s) => s.id === sheetId);
    return sheet?.parts.find((p) => p.id === selection[0].id)?.refdes ?? null;
  }, [selection, design, sheetId]);
  return (
    <div className="msx-breadboard">
      <Suspense fallback={<div className="ms-empty">{t('integration.breadboardTab.loadingThe3dBreadboard')}</div>}>
        <BreadboardView
          design={design}
          onChange={(layout: BreadboardLayout) => actions.applyDesign((d) => ({ ...d, breadboard: layout }))}
          indicatorLevels={running ? live.breadboardLevels : undefined}
          running={running}
          selectedRefdes={selectedRefdes}
          onSelect={selectPartByRefdes}
          languageSwitch={false}
        />
      </Suspense>
    </div>
  );
}
