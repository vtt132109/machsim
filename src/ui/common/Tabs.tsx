/**
 * Accessible tab strip (role=tablist) with arrow-key navigation. Optional per-tab close button,
 * double-click (rename) and context menu hooks for sheet tabs.
 */
import type { ReactNode } from 'react';
import { Icon } from './icons';
import './common.css';
import { t as tr } from '../../i18n';

export interface TabItem {
  id: string;
  title: ReactNode;
  /** accessible name when the title is not plain text */
  ariaLabel?: string;
  closable?: boolean;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
  ariaLabel: string;
  /** id prefix used for aria-controls / ids */
  idPrefix?: string;
  className?: string;
  /** extra content after the tabs (e.g. "+" button) */
  trailing?: ReactNode;
  size?: 'normal' | 'small';
}

export function Tabs({ items, active, onSelect, onClose, onDoubleClick, onContextMenu, ariaLabel, idPrefix = 'tab', className, trailing, size = 'normal' }: TabsProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.id === active);
    let next: TabItem | undefined;
    if (e.key === 'ArrowRight') next = enabled[(idx + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    else if (e.key === 'Delete' && onClose) {
      const cur = items.find((t) => t.id === active);
      if (cur?.closable) {
        e.preventDefault();
        onClose(cur.id);
      }
      return;
    }
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(next.id);
      const el = e.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(`${idPrefix}-${next.id}`)}`);
      el?.focus();
    }
  };
  return (
    <div className={`ms-tabs ms-tabs-${size} ${className ?? ''}`}>
      <div role="tablist" aria-label={ariaLabel} className="ms-tablist" onKeyDown={onKeyDown}>
        {items.map((t) => (
          <div
            key={t.id}
            id={`${idPrefix}-${t.id}`}
            role="tab"
            aria-selected={t.id === active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            aria-disabled={t.disabled || undefined}
            aria-label={t.ariaLabel ?? (typeof t.title === 'string' ? t.title : undefined)}
            tabIndex={t.id === active ? 0 : -1}
            className={`ms-tab ${t.id === active ? 'is-active' : ''} ${t.disabled ? 'is-disabled' : ''}`}
            onClick={() => !t.disabled && onSelect(t.id)}
            onDoubleClick={() => onDoubleClick?.(t.id)}
            onContextMenu={(e) => {
              if (onContextMenu) {
                e.preventDefault();
                onContextMenu(t.id, e);
              }
            }}
          >
            <span className="ms-tab-title">{t.title}</span>
            {t.closable && onClose ? (
              <button
                type="button"
                className="ms-tab-close"
                tabIndex={-1}
                aria-label={tr('common.floatingWindow.closeTitle', { title: typeof t.title === 'string' ? t.title : (t.ariaLabel ?? '') })}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
              >
                <Icon name="close" size={10} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {trailing}
    </div>
  );
}
