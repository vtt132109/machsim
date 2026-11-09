/**
 * Floating tool window frame: draggable by its title bar, resizable from the right edge, bottom
 * edge and corner, closable, raised on focus. Geometry is controlled by the owner.
 * Keyboard: when the title bar is focused, arrow keys move the window (Shift = resize).
 */
import { useRef, type ReactNode } from 'react';
import { Icon } from './icons';
import './common.css';
import { t } from '../../i18n';

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingWindowProps {
  id: string;
  title: string;
  geometry: WindowGeometry;
  z: number;
  minW?: number;
  minH?: number;
  active?: boolean;
  onGeometry: (g: WindowGeometry) => void;
  onClose: () => void;
  onFocus: () => void;
  children: ReactNode;
}

type DragMode = 'move' | 'e' | 's' | 'se';

export function FloatingWindow({ id, title, geometry, z, minW = 200, minH = 120, active, onGeometry, onClose, onFocus, children }: FloatingWindowProps) {
  const drag = useRef<{ mode: DragMode; sx: number; sy: number; g: WindowGeometry } | null>(null);

  const start = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, g: geometry };
    onFocus();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const g = { ...d.g };
    if (d.mode === 'move') {
      g.x = Math.min(Math.max(d.g.x + dx, -g.w + 80), window.innerWidth - 80);
      g.y = Math.min(Math.max(d.g.y + dy, 0), window.innerHeight - 30);
    }
    if (d.mode === 'e' || d.mode === 'se') g.w = Math.max(minW, d.g.w + dx);
    if (d.mode === 's' || d.mode === 'se') g.h = Math.max(minH, d.g.h + dy);
    onGeometry(g);
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const onTitleKey = (e: React.KeyboardEvent) => {
    const step = 10;
    const g = { ...geometry };
    const resize = e.shiftKey;
    switch (e.key) {
      case 'ArrowLeft':
        if (resize) g.w = Math.max(minW, g.w - step);
        else g.x -= step;
        break;
      case 'ArrowRight':
        if (resize) g.w += step;
        else g.x += step;
        break;
      case 'ArrowUp':
        if (resize) g.h = Math.max(minH, g.h - step);
        else g.y = Math.max(0, g.y - step);
        break;
      case 'ArrowDown':
        if (resize) g.h += step;
        else g.y += step;
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    onGeometry(g);
  };

  return (
    <section
      className={`ms-float ${active ? 'is-active' : ''}`}
      style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h, zIndex: z }}
      role="dialog"
      aria-label={title}
      data-window-id={id}
      onPointerDownCapture={onFocus}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header
        className="ms-float-title"
        tabIndex={0}
        aria-label={t('common.floatingWindow.titleWindowTitleArrowKeys', { title: title })}
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onTitleKey}
      >
        <Icon name="window" size={14} />
        <span className="ms-float-name">{title}</span>
        <button
          type="button"
          className="ms-icon-btn"
          aria-label={t('common.floatingWindow.closeTitle', { title: title })}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      <div className="ms-float-body">{children}</div>
      <div className="ms-float-grip-e" onPointerDown={start('e')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true" />
      <div className="ms-float-grip-s" onPointerDown={start('s')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true" />
      <div className="ms-float-grip-se" onPointerDown={start('se')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true" />
    </section>
  );
}
