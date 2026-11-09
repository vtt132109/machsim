/**
 * Design tree ("Cây thiết kế"): the root design's sheets, every placed block (subcircuit /
 * hierarchical block) with its child design's sheets and nested blocks, and child designs that
 * are not placed anywhere. Clicking a sheet opens it; buttons create new child designs.
 * Also the left side panel that switches between the component browser and this tree.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { hierarchyTree, type HierarchyNode } from '../../model/hierarchy';
import { actions, useEditor } from '../store';
import { createStore } from '../store/createStore';
import { childUseCount } from '../store/hierarchyOps';
import { ComponentBrowser } from '../editor/ComponentBrowser';
import { Tabs } from '../common/Tabs';
import { confirmDialog } from '../common/dialogs';
/** The child-design flows live with the other schematic dialogs (loaded on first use). */
const dialogs = () => import('./schematicDialogs');
import { t } from '../../i18n';

/** Which tab the left panel shows ('parts' = component browser, 'tree' = design tree). */
export const leftPanelTab = createStore<'parts' | 'tree'>('parts');

export function showDesignTree(): void {
  leftPanelTab.setState('tree');
}

function SheetRow({ id, name, active, depth }: { id: string; name: string; active: boolean; depth: number }) {
  return (
    <button
      type="button"
      className={`ms-tree-row ms-tree-sheet${active ? ' is-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={t('schematic.tree.openSheetTip', { name })}
      aria-current={active ? 'page' : undefined}
      onClick={() => actions.setActiveSheet(id)}
    >
      <span aria-hidden="true">▤</span> {name}
    </button>
  );
}

function NodeRows({ node, depth, activeSheet }: { node: HierarchyNode; depth: number; activeSheet: string }) {
  const [open, setOpen] = useState(true);
  const label = node.child ? `${node.block?.inst.refdes ?? ''} · ${node.child.name}` : '';
  return (
    <>
      {node.child ? (
        <div className="ms-tree-node" style={{ paddingLeft: 8 + (depth - 1) * 14 }}>
          <button type="button" className="ms-tree-toggle" aria-expanded={open} title={open ? t('schematic.tree.collapse') : t('schematic.tree.expand')} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className="ms-tree-row ms-tree-block"
            title={node.cyclic ? t('schematic.tree.cyclicTip') : t('schematic.tree.blockTip', { path: node.path })}
            onClick={() => node.child && actions.openChild(node.child.id)}
          >
            <span aria-hidden="true">{node.child.kind === 'hierarchical' ? '▣' : '▢'}</span> {label}
            {node.cyclic ? <span className="ms-tree-warn"> ⚠</span> : null}
          </button>
        </div>
      ) : null}
      {open && !node.cyclic ? (
        <>
          {node.sheets.map((s) => (
            <SheetRow key={`${node.path}/${s.id}`} id={s.id} name={s.name} active={s.id === activeSheet} depth={depth} />
          ))}
          {node.children.map((c) => (
            <NodeRows key={c.path} node={c} depth={depth + 1} activeSheet={activeSheet} />
          ))}
        </>
      ) : null}
    </>
  );
}

export function DesignTree() {
  const design = useEditor((s) => s.design);
  const activeSheet = useEditor((s) => s.activeSheetId);
  const tree = useMemo(() => hierarchyTree(design), [design]);
  const unused = (design.children ?? []).filter((c) => childUseCount(design, c.id) === 0);
  return (
    <div className="ms-tree" role="tree" aria-label={t('schematic.tree.title')}>
      <div className="ms-tree-actions">
        <button type="button" className="ms-btn ms-btn-small" title={t('schematic.tree.newSCTip')} onClick={() => void dialogs().then((m) => m.newChildFlow('subcircuit'))}>
          {t('schematic.tree.newSC')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={t('schematic.tree.newHBTip')} onClick={() => void dialogs().then((m) => m.newChildFlow('hierarchical'))}>
          {t('schematic.tree.newHB')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={t('schematic.tree.fromFileTip')} onClick={() => void dialogs().then((m) => m.blockFromFileFlow())}>
          {t('schematic.tree.fromFile')}
        </button>
      </div>
      <div className="ms-tree-root">
        <strong title={t('schematic.tree.rootTip')}>{design.title}</strong>
      </div>
      <NodeRows node={tree} depth={0} activeSheet={activeSheet} />
      {unused.length ? (
        <>
          <div className="ms-tree-root">
            <strong>{t('schematic.tree.unused')}</strong>
          </div>
          {unused.map((c) => (
            <div key={c.id} className="ms-tree-node" style={{ paddingLeft: 8 }}>
              <button type="button" className="ms-tree-row ms-tree-block" title={t('schematic.tree.unusedTip')} onClick={() => actions.openChild(c.id)}>
                <span aria-hidden="true">{c.kind === 'hierarchical' ? '▣' : '▢'}</span> {c.name}
              </button>
              <button type="button" className="ms-btn ms-btn-small" title={t('schematic.tree.placeTip')} onClick={() => actions.startPlacing(`hier:${c.id}`)}>
                {t('schematic.tree.place')}
              </button>
              <button
                type="button"
                className="ms-btn ms-btn-small"
                title={t('schematic.tree.deleteTip')}
                onClick={async () => {
                  const ok = await confirmDialog({ title: t('schematic.tree.deleteTitle'), message: t('schematic.tree.deleteMsg', { name: c.name }), okLabel: t('common.delete'), danger: true });
                  if (ok) actions.deleteChild(c.id);
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          ))}
        </>
      ) : null}
      <p className="ms-hint ms-tree-hint">{t('schematic.tree.hint')}</p>
    </div>
  );
}

/** Left side panel: component browser or design tree. */
export function LeftPanel() {
  const tab = useSyncExternalStore(leftPanelTab.subscribe, leftPanelTab.getState, leftPanelTab.getState);
  return (
    <div className="ms-left-panel">
      <Tabs
        items={[
          { id: 'parts', title: t('schematic.tree.tabParts') },
          { id: 'tree', title: t('schematic.tree.tabTree') },
        ]}
        active={tab}
        onSelect={(id) => leftPanelTab.setState(id as 'parts' | 'tree')}
        ariaLabel={t('schematic.tree.panel')}
        idPrefix="ms-left"
        size="small"
      />
      <div className="ms-left-body" role="tabpanel" id={`ms-left-panel-${tab}`} aria-labelledby={`ms-left-${tab}`}>
        {tab === 'parts' ? <ComponentBrowser /> : <DesignTree />}
      </div>
    </div>
  );
}
