/**
 * Bottom dock: the built-in Spreadsheet tab plus tabs registered by extensions
 * (registerBottomTab). The active tab id lives in the editor store (ui.dockTab).
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { actions, useEditor } from '../store';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { Icon } from '../common/icons';
import { Tabs } from '../common/Tabs';
import { bottomTabs, type BottomTabDef } from './extensions';
import { SPREADSHEET_TAB_ID } from './dockState';
import { Spreadsheet } from './Spreadsheet';
import { t } from '../../i18n';

/** Calls the tab's render function inside its own component so the error boundary catches it. */
function RenderTab({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

const BUILTIN: BottomTabDef = {
  id: SPREADSHEET_TAB_ID,
  get title() {
    return t('dock.spreadsheet');
  },
  render: () => <Spreadsheet />,
  order: 0,
};

export function BottomDock() {
  const registered = useSyncExternalStore(bottomTabs.subscribe, bottomTabs.getState, bottomTabs.getState);
  const activeId = useEditor((s) => s.ui.dockTab);
  const tabs = [BUILTIN, ...registered.filter((t) => t.id !== SPREADSHEET_TAB_ID)].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const active = tabs.find((t) => t.id === activeId) ?? BUILTIN;
  return (
    <section className="ms-dock" aria-label={t('app.bottomDock.dock')}>
      <div className="ms-dock-head">
        <Tabs
          items={tabs.map((t) => ({ id: t.id, title: t.title }))}
          active={active.id}
          onSelect={(id) => actions.setUi({ dockTab: id })}
          ariaLabel={t('app.bottomDock.dockTabs')}
          idPrefix="ms-dock"
          size="small"
        />
        <button type="button" className="ms-icon-btn ms-dock-close" aria-label={t('app.bottomDock.hideDock')} title={t('app.bottomDock.hideDock')} onClick={() => actions.setUi({ dockOpen: false })}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="ms-dock-body" role="tabpanel" id={`ms-dock-panel-${active.id}`} aria-labelledby={`ms-dock-${active.id}`}>
        <ErrorBoundary label={t('app.bottomDock.titleTab', { title: active.title })} resetKey={active}>
          <RenderTab render={active.render} />
        </ErrorBoundary>
      </div>
    </section>
  );
}
