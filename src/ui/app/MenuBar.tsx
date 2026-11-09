/**
 * Application menu bar (role="menubar") built from the pure menu model in menus.ts.
 *
 * Mouse: click a title to open its menu; while a menu is open, hovering another title switches.
 * Keyboard: F10 (or Alt alone) focuses the bar; ←/→ move between titles, ↓ / Enter / Space open,
 * inside a menu ←/→ switch to the neighbouring menu, Esc closes and returns focus to the title.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { actions, getState, useEditor } from '../store';
import { MenuPopup, type MenuCloseReason } from '../common/Menu';
import { commandRegistry, hasCommand, isSimulationConnected, runCommand } from './extensions';
import { buildMenus, type MenuContext } from './menus';
import { beginnerMenus } from './beginner';
import { clearRecentFiles, openRecentFile, openRecentProject, recentFiles, recentProjectFiles } from './document';
import { documents } from './documentSet';
import { displayFileName } from './files';
import { t } from '../../i18n';
import { setActiveVariant } from '../../model/variants';

let menubarEl: HTMLDivElement | null = null;

/** Focus the first menu title (F10 / Alt). */
export function focusMenuBar(): void {
  menubarEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

export function MenuBar() {
  const state = useEditor((s) => s);
  // re-render when commands are (un)registered or the recent list changes
  useSyncExternalStore(commandRegistry.subscribe, commandRegistry.getState, commandRegistry.getState);
  const recent = useSyncExternalStore(recentFiles.subscribe, recentFiles.getState, recentFiles.getState);
  const recentProjects = useSyncExternalStore(recentProjectFiles.subscribe, recentProjectFiles.getState, recentProjectFiles.getState);
  const docs = useSyncExternalStore(documents.view.subscribe, documents.view.getState, documents.view.getState);
  const [open, setOpen] = useState<{ index: number; keyboard: boolean } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const ctx: MenuContext = {
    state,
    has: hasCommand,
    run: (id) => {
      runCommand(id);
    },
    recent,
    openRecent: (e) => void openRecentFile(e),
    recentProjects,
    openRecentProject: (p) => void openRecentProject(p),
    clearRecent: clearRecentFiles,
    setAnalysis: (t) => actions.setActiveAnalysis(t),
    setVariant: (id) => {
      actions.applyDesign((d) => setActiveVariant(d, id));
      const v = getState().design.variants?.list.find((x) => x.id === id);
      if (v) actions.addSimMessage('info', t('variant.activated', { name: v.name }), 'library');
    },
    setTheme: (mode) => actions.setUi({ theme: mode }),
    setActiveSheet: (id) => actions.setActiveSheet(id),
    simulationConnected: isSimulationConnected(),
    documents: docs.docs.map((d) => ({ id: d.id, label: displayFileName(d.fileName), dirty: d.dirty, active: d.id === docs.activeId })),
    switchDocument: (id) => void documents.switchTo(id),
  };
  const menus = beginnerMenus(buildMenus(ctx), state.ui.beginner === true);

  useEffect(() => {
    menubarEl = barRef.current;
    return () => {
      menubarEl = null;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    const onBlur = () => setOpen(null);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  const focusTitle = (i: number) => btnRefs.current[(i + menus.length) % menus.length]?.focus();

  const onClose = (reason: MenuCloseReason) => {
    const idx = open?.index ?? 0;
    if (reason === 'left' || reason === 'right') {
      const next = (idx + (reason === 'left' ? -1 : 1) + menus.length) % menus.length;
      setOpen({ index: next, keyboard: true });
      focusTitle(next);
      return;
    }
    setOpen(null);
    if (reason === 'escape') focusTitle(idx);
  };

  const anchor = open ? btnRefs.current[open.index]?.getBoundingClientRect() : undefined;

  return (
    <div className="ms-menubar" role="menubar" aria-label={t('app.menuBar.mainMenu')} ref={barRef}>
      {menus.map((m, i) => (
        <button
          key={m.id}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.index === i}
          tabIndex={i === 0 ? 0 : -1}
          className={`ms-menubar-item ${open?.index === i ? 'is-open' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(open?.index === i ? null : { index: i, keyboard: false });
          }}
          onMouseEnter={() => {
            if (open && open.index !== i) setOpen({ index: i, keyboard: false });
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              e.stopPropagation();
              const next = i + (e.key === 'ArrowRight' ? 1 : -1);
              focusTitle(next);
              if (open) setOpen({ index: (next + menus.length) % menus.length, keyboard: true });
            } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setOpen({ index: i, keyboard: true });
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(null);
              (document.activeElement as HTMLElement | null)?.blur();
            }
          }}
        >
          {m.label}
        </button>
      ))}
      {open && anchor ? (
        <MenuPopup
          key={open.index}
          items={menus[open.index].items}
          x={anchor.left}
          y={anchor.bottom}
          ariaLabel={menus[open.index].label}
          autoFocus={open.keyboard}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}
