/**
 * Menus: a data model ({@link MenuEntry}), a keyboard-navigable popup ({@link MenuPopup}) with
 * nested submenus, and a global context menu ({@link openContextMenu} + <ContextMenuHost />).
 *
 * Keyboard: ↑/↓ move, Home/End, Enter/Space activate, → opens a submenu, ← / Esc close it.
 * At the top level ←/→ are reported to the owner (the menu bar switches menus).
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createStore } from '../store/createStore';
import { Icon } from './icons';
import './common.css';
import { t } from '../../i18n';

export type MenuEntry =
  | {
      type?: 'item';
      /**
       * Command id (or another stable key) of the entry. Set by the menu model for every item
       * that runs a command, so a filter can work on the model — beginner mode hides the advanced
       * entries this way (src/ui/app/beginner.ts). Entries built from data (recent files, sheets,
       * themes) have no id.
       */
      id?: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      /** shows a check mark (toggle items) */
      checked?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator' }
  | { type: 'submenu'; id?: string; label: string; items: MenuEntry[]; disabled?: boolean };

export type MenuCloseReason = 'select' | 'escape' | 'left' | 'right' | 'tab';

export interface MenuPopupProps {
  items: MenuEntry[];
  x: number;
  y: number;
  onClose: (reason: MenuCloseReason) => void;
  ariaLabel?: string;
  /** focus the first item when opened (keyboard activation) */
  autoFocus?: boolean;
  /** nested level (0 = top) */
  level?: number;
}

function isEnabled(e: MenuEntry): boolean {
  return e.type !== 'separator' && !e.disabled;
}

export function MenuPopup({ items, x, y, onClose, ariaLabel, autoFocus = true, level = 0 }: MenuPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [openSub, setOpenSub] = useState<{ index: number; x: number; y: number; focus: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + r.width > vw - 4) nx = Math.max(4, level > 0 ? x - r.width - (el.parentElement?.getBoundingClientRect().width ?? 0) : vw - r.width - 4);
    if (ny + r.height > vh - 4) ny = Math.max(4, vh - r.height - 4);
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    if (!autoFocus) return;
    const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [autoFocus]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]') ?? []);

  const openSubmenu = (index: number, el: HTMLElement, focus: boolean) => {
    const r = el.getBoundingClientRect();
    setOpenSub({ index, x: r.right - 2, y: r.top - 4, focus });
  };

  const activate = (entry: MenuEntry, index: number, el: HTMLElement) => {
    if (!isEnabled(entry)) return;
    if (entry.type === 'submenu') {
      openSubmenu(index, el, true);
      return;
    }
    if (entry.type === 'separator') return;
    onClose('select');
    entry.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = focusables();
    const idx = list.indexOf(document.activeElement as HTMLElement);
    const move = (delta: number) => {
      if (list.length === 0) return;
      for (let i = 1; i <= list.length; i++) {
        const cand = list[(idx + delta * i + list.length * 4) % list.length];
        if (cand.getAttribute('aria-disabled') !== 'true') {
          cand.focus();
          return;
        }
      }
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        list.find((el) => el.getAttribute('aria-disabled') !== 'true')?.focus();
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        [...list].reverse().find((el) => el.getAttribute('aria-disabled') !== 'true')?.focus();
        break;
      case 'ArrowRight': {
        e.preventDefault();
        e.stopPropagation();
        const el = document.activeElement as HTMLElement;
        const i = Number(el?.dataset.index);
        const entry = items[i];
        if (entry && entry.type === 'submenu' && !entry.disabled) openSubmenu(i, el, true);
        else if (level === 0) onClose('right');
        break;
      }
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        onClose(level === 0 ? 'left' : 'escape');
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose('escape');
        break;
      case 'Tab':
        e.preventDefault();
        onClose('tab');
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={ref}
      className="ms-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((entry, i) => {
        if (entry.type === 'separator') return <div key={i} className="ms-menu-sep" role="separator" />;
        const disabled = !!entry.disabled;
        const isSub = entry.type === 'submenu';
        const checked = !isSub && entry.checked !== undefined ? entry.checked : undefined;
        return (
          <div
            key={i}
            data-index={i}
            role={checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            aria-haspopup={isSub ? 'menu' : undefined}
            aria-expanded={isSub ? openSub?.index === i : undefined}
            tabIndex={-1}
            className={`ms-menu-item ${disabled ? 'is-disabled' : ''} ${!isSub && entry.danger ? 'is-danger' : ''} ${openSub?.index === i ? 'is-open' : ''}`}
            onClick={(e) => activate(entry, i, e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                activate(entry, i, e.currentTarget);
              }
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.focus();
              window.clearTimeout(hoverTimer.current);
              if (isSub && !disabled) hoverTimer.current = window.setTimeout(() => openSubmenu(i, el, false), 150);
              else if (openSub) hoverTimer.current = window.setTimeout(() => setOpenSub(null), 200);
            }}
          >
            <span className="ms-menu-check" aria-hidden="true">
              {checked ? '✓' : ''}
            </span>
            <span className="ms-menu-label">{entry.label}</span>
            {!isSub && entry.shortcut ? <span className="ms-menu-shortcut">{entry.shortcut}</span> : null}
            {isSub ? (
              <span className="ms-menu-arrow" aria-hidden="true">
                <Icon name="chevronRight" size={12} />
              </span>
            ) : null}
          </div>
        );
      })}
      {openSub && items[openSub.index]?.type === 'submenu' ? (
        <MenuPopup
          items={(items[openSub.index] as Extract<MenuEntry, { type: 'submenu' }>).items}
          x={openSub.x}
          y={openSub.y}
          level={level + 1}
          autoFocus={openSub.focus}
          onClose={(reason) => {
            const idx = openSub.index;
            setOpenSub(null);
            if (reason === 'select' || reason === 'tab') onClose(reason);
            else ref.current?.querySelector<HTMLElement>(`[data-index="${idx}"]`)?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// global context menu
// ---------------------------------------------------------------------------

interface ContextMenuState {
  items: MenuEntry[];
  x: number;
  y: number;
  keyboard: boolean;
  /** performance.now() when opened: the mouse events of the opening click must not close it */
  openedAt: number;
}

const ctx = createStore<ContextMenuState | null>(null);

/** Show a context menu at viewport coordinates. */
export function openContextMenu(items: MenuEntry[], x: number, y: number, keyboard = false): void {
  ctx.setState({ items, x, y, keyboard, openedAt: typeof performance !== 'undefined' ? performance.now() : 0 });
}

export function closeContextMenu(): void {
  ctx.setState(null);
}

export function ContextMenuHost() {
  const state = useSyncExternalStore(ctx.subscribe, ctx.getState, ctx.getState);
  useEffect(() => {
    if (!state) return;
    const openedAt = state.openedAt;
    const onDown = (e: MouseEvent) => {
      // ignore the mousedown that belongs to the pointer press which opened the menu
      if (e.timeStamp <= openedAt) return;
      closeContextMenu();
    };
    const onBlur = () => closeContextMenu();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [state]);
  if (!state) return null;
  return <MenuPopup items={state.items} x={state.x} y={state.y} autoFocus ariaLabel={t('common.menu.contextMenu')} onClose={() => closeContextMenu()} />;
}
