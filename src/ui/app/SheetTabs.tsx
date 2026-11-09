/**
 * Sheet tabs above the canvas: click / arrow keys switch sheets, double-click renames, the
 * close button (or Delete on the focused tab) deletes, "+" adds a sheet, right-click offers
 * rename / move / delete. The tabs show the sheets of the design level being edited: inside a
 * subcircuit / hierarchical block a breadcrumb (design › HB1 · Amp) and an "Up" button lead back.
 */
import { useMemo } from 'react';
import { actions, getState, useEditor } from '../store';
import { levelPath, levelSheetsOf } from '../store/editorStore';
import { Icon } from '../common/icons';
import { openContextMenu } from '../common/Menu';
import { Tabs } from '../common/Tabs';
import { deleteSheetConfirmed, renameActiveSheet } from './commands';
import { t } from '../../i18n';

function Breadcrumb() {
  const design = useEditor((s) => s.design);
  const activeId = useEditor((s) => s.activeSheetId);
  // levelPath builds new arrays: derive it from the (stable) design and sheet id
  const path = useMemo(() => levelPath({ ...getState(), design, activeSheetId: activeId }), [design, activeId]);
  const title = design.title;
  if (path.length < 2) return null;
  return (
    <nav className="ms-breadcrumb" aria-label={t('schematic.crumb.label')}>
      <button type="button" className="ms-btn ms-btn-small" title={t('schematic.crumb.upTip')} onClick={() => actions.goToParent()}>
        ↑ {t('schematic.crumb.up')}
      </button>
      {path.map((n, i) => (
        <span key={n.path || 'root'} className="ms-crumb">
          {i > 0 ? <span aria-hidden="true"> › </span> : null}
          <button
            type="button"
            className="ms-link-btn"
            title={t('schematic.crumb.openTip')}
            aria-current={i === path.length - 1 ? 'location' : undefined}
            onClick={() => {
              const target = n.sheets[0];
              if (target) actions.setActiveSheet(target.id);
            }}
          >
            {n.child ? `${n.block?.inst.refdes ?? ''} · ${n.child.name}` : title}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function SheetTabs() {
  const sheets = useEditor(levelSheetsOf);
  const activeId = useEditor((s) => s.activeSheetId);
  const items = sheets.map((s) => ({
    id: s.id,
    title: s.name,
    closable: sheets.length > 1,
  }));
  return (
    <div className="ms-sheet-tabs">
      <Breadcrumb />
      <Tabs
        items={items}
        active={activeId}
        ariaLabel={t('app.sheetTabs.sheets')}
        idPrefix="ms-sheet"
        size="small"
        onSelect={(id) => actions.setActiveSheet(id)}
        onClose={(id) => void deleteSheetConfirmed(id)}
        onDoubleClick={(id) => void renameActiveSheet(id)}
        onContextMenu={(id, e) => {
          const idx = sheets.findIndex((s) => s.id === id);
          openContextMenu(
            [
              { label: t('common.rename'), onSelect: () => void renameActiveSheet(id) },
              { label: t('app.sheetTabs.moveLeft'), disabled: idx <= 0, onSelect: () => actions.moveSheet(id, idx - 1) },
              { label: t('app.sheetTabs.moveRight'), disabled: idx >= sheets.length - 1, onSelect: () => actions.moveSheet(id, idx + 1) },
              { type: 'separator' },
              { label: t('app.sheetTabs.newSheet'), onSelect: () => actions.addSheet() },
              { label: t('common.delete'), danger: true, disabled: sheets.length <= 1, onSelect: () => void deleteSheetConfirmed(id) },
            ],
            e.clientX,
            e.clientY,
          );
        }}
        trailing={
          <button type="button" className="ms-icon-btn ms-sheet-add" aria-label={t('app.sheetTabs.addSheet')} title={t('app.sheetTabs.addSheet')} onClick={() => actions.addSheet()}>
            <Icon name="plus" size={12} />
          </button>
        }
      />
    </div>
  );
}
