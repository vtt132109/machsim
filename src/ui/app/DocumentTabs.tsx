/**
 * Document tabs: one tab per open design, shown under the toolbar once a second design is open
 * (a single design looks exactly as before).
 *
 * Click or the arrow keys switch design (each design keeps its undo history, selection,
 * simulation results and Grapher runs), the × closes it (asking about unsaved changes), a dot marks
 * unsaved changes, "+" opens a new design, the context menu has Close / Close others / Close all /
 * Save. Tabs can be dragged to reorder them, and a selection of the schematic or a part dragged
 * from the component browser can be dropped on a tab to copy it into that design.
 */
import { useSyncExternalStore, useState } from 'react';
import { Icon } from '../common/icons';
import { openContextMenu } from '../common/Menu';
import { PART_DRAG_MIME } from '../editor/controller';
import { runCommand } from './extensions';
import { documents } from './documentSet';
import { displayFileName } from './files';
import { createStore } from '../store/createStore';
import { t } from '../../i18n';

/** Id of the document tab the pointer is over while a selection is being dragged (canvas drag). */
export const dropTargetDocument = createStore<string | null>(null);

const TAB_MIME = 'application/x-machsim-document';

/** The document tab under a screen point, if any. */
export function documentTabAt(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(clientX, clientY)?.closest('[data-doc-id]');
  return el?.getAttribute('data-doc-id') ?? null;
}

const flows = () => import('./documentFlows');

export function DocumentTabs() {
  const view = useSyncExternalStore(documents.view.subscribe, documents.view.getState, documents.view.getState);
  const hot = useSyncExternalStore(dropTargetDocument.subscribe, dropTargetDocument.getState, dropTargetDocument.getState);
  const [overId, setOverId] = useState<string | null>(null);
  if (view.docs.length < 2) return null;

  const close = (id: string) => void flows().then((m) => m.closeDocumentFlow(id));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') void documents.next();
    else if (e.key === 'ArrowLeft') void documents.previous();
    else if (e.key === 'Delete' || (e.key === 'w' && e.ctrlKey)) close(view.activeId);
    else return;
    e.preventDefault();
  };

  return (
    <div className="ms-doc-tabs">
      <div className="ms-doc-tablist" role="tablist" aria-label={t('docs.tabs.label')} onKeyDown={onKeyDown}>
        {view.docs.map((d, i) => {
          const name = displayFileName(d.fileName);
          const active = d.id === view.activeId;
          return (
            <div
              key={d.id}
              role="tab"
              id={`ms-doc-${d.id}`}
              data-doc-id={d.id}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`ms-doc-tab${active ? ' is-active' : ''}${d.dirty ? ' is-dirty' : ''}${hot === d.id || overId === d.id ? ' is-drop' : ''}`}
              title={d.dirty ? t('docs.tab.unsaved', { name }) : name}
              draggable
              onClick={() => void documents.switchTo(d.id)}
              onAuxClick={(e) => {
                if (e.button === 1) close(d.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu(
                  [
                    { id: 'file.close', label: t('cmd.file.close'), onSelect: () => close(d.id) },
                    { label: t('docs.tab.closeOthers'), disabled: view.docs.length < 2, onSelect: () => void flows().then(async (m) => {
                      for (const other of view.docs) if (other.id !== d.id && !(await m.closeDocumentFlow(other.id))) return;
                    }) },
                    { id: 'file.closeAll', label: t('cmd.file.closeAll'), onSelect: () => runCommand('file.closeAll') },
                    { type: 'separator' },
                    { label: t('docs.tab.moveLeft'), disabled: i === 0, onSelect: () => documents.move(d.id, i - 1) },
                    { label: t('docs.tab.moveRight'), disabled: i === view.docs.length - 1, onSelect: () => documents.move(d.id, i + 1) },
                  ],
                  e.clientX,
                  e.clientY,
                );
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, d.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                const types = e.dataTransfer.types;
                if (types.includes(TAB_MIME) || types.includes(PART_DRAG_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = types.includes(TAB_MIME) ? 'move' : 'copy';
                  setOverId(d.id);
                }
              }}
              onDragLeave={() => setOverId((cur) => (cur === d.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setOverId(null);
                const moved = e.dataTransfer.getData(TAB_MIME);
                if (moved) {
                  documents.move(moved, i);
                  return;
                }
                const part = e.dataTransfer.getData(PART_DRAG_MIME);
                if (part) void flows().then((m) => m.placePartInDocument(d.id, part));
              }}
            >
              <span className="ms-doc-name">{name}</span>
              {d.dirty ? <span className="ms-doc-dot" aria-hidden="true">●</span> : null}
              <button
                type="button"
                className="ms-doc-close"
                tabIndex={-1}
                aria-label={t('docs.tab.close', { name })}
                title={t('docs.tab.close', { name })}
                onClick={(e) => {
                  e.stopPropagation();
                  close(d.id);
                }}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          );
        })}
        <button type="button" className="ms-icon-btn ms-doc-add" aria-label={t('docs.tab.new')} title={t('docs.tab.new')} onClick={() => runCommand('file.new')}>
          <Icon name="plus" size={12} />
        </button>
      </div>
    </div>
  );
}
