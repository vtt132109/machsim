/**
 * Renders the floating tool windows opened with openFloatingWindow (instrument panels, grapher,
 * ...). Each window is draggable, resizable and closable (src/ui/common/FloatingWindow.tsx);
 * its content comes from the kind registered with registerFloatingWindowKind and is isolated by
 * an error boundary.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { FloatingWindow } from '../common/FloatingWindow';
import {
  closeFloatingWindow,
  floating,
  floatingWindowTitle,
  focusFloatingWindow,
  setFloatingWindowGeometry,
  type FloatingWindowKindDef,
  type FloatingWindowState,
} from './extensions';
import { t } from '../../i18n';

function WindowContent({ def, win }: { def: FloatingWindowKindDef | undefined; win: FloatingWindowState }): ReactNode {
  if (!def) {
    return (
      <div className="ms-empty">
        {t('app.floatingWindowHost.noPanelIsRegisteredFor', { kind: win.kind, value: typeof win.props.refdes === 'string' ? ` (${win.props.refdes})` : '' })}
      </div>
    );
  }
  return <>{def.render({ ...win.props, windowId: win.id, close: () => closeFloatingWindow(win.id) })}</>;
}

export function FloatingWindowHost() {
  const state = useSyncExternalStore(floating.subscribe, floating.getState, floating.getState);
  return (
    <div className="ms-float-host">
      {state.windows.map((w) => {
        const def = state.kinds[w.kind];
        const title = floatingWindowTitle(w, def);
        return (
          <FloatingWindow
            key={w.id}
            id={w.id}
            title={title}
            geometry={{ x: w.x, y: w.y, w: w.w, h: w.h }}
            z={w.z}
            minW={def?.minSize?.w}
            minH={def?.minSize?.h}
            active={state.active === w.id}
            onGeometry={(g) => setFloatingWindowGeometry(w.id, g)}
            onClose={() => closeFloatingWindow(w.id)}
            onFocus={() => focusFloatingWindow(w.id)}
          >
            <ErrorBoundary label={title} resetKey={def}>
              <WindowContent def={def} win={w} />
            </ErrorBoundary>
          </FloatingWindow>
        );
      })}
    </div>
  );
}
