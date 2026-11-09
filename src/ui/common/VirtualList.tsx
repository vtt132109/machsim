/**
 * Virtualised list with fixed-height rows: only the rows in view (plus a small overscan) are
 * rendered, so a list of 60,000 parts costs the same as a list of 60. The caller renders each row
 * (role="option" inside the role="listbox" container, or rows of its own role) and handles the
 * keyboard; the list scrolls the active row into view.
 *
 *   <VirtualList count={n} rowHeight={22} renderRow={(i) => <div …/>} activeIndex={k} ariaLabel="…" />
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { scrollIntoRow, virtualWindow } from '../editor/browserModel';

export interface VirtualListProps {
  count: number;
  /** px; must match the CSS height of a row */
  rowHeight: number;
  renderRow: (index: number) => ReactNode;
  /** row to keep in view (keyboard navigation, selection from outside) */
  activeIndex?: number;
  ariaLabel: string;
  /** id of the active row element (aria-activedescendant) */
  activeId?: string;
  role?: string;
  className?: string;
  /** shown when count is 0 */
  empty?: ReactNode;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** CSS height of the scroll box (default 100%) */
  height?: number | string;
}

export function VirtualList({ count, rowHeight, renderRow, activeIndex, ariaLabel, activeId, role = 'listbox', className, empty, onKeyDown, height }: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(300);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setViewport(el.clientHeight || 300);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight || 300));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the active row visible
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || activeIndex === undefined || activeIndex < 0) return;
    const top = scrollIntoRow(activeIndex, rowHeight, el.scrollTop, el.clientHeight || viewport);
    if (top !== el.scrollTop) {
      el.scrollTop = top;
      setScrollTop(top);
    }
  }, [activeIndex, rowHeight, viewport]);

  // a shorter list (new search) starts at the top
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollTop > count * rowHeight) {
      el.scrollTop = 0;
      setScrollTop(0);
    }
  }, [count, rowHeight]);

  const win = virtualWindow(count, rowHeight, scrollTop, viewport);
  const rows: ReactNode[] = [];
  for (let i = win.start; i < win.end; i++) rows.push(renderRow(i));
  return (
    <div
      ref={ref}
      className={`ms-vlist${className ? ` ${className}` : ''}`}
      style={height !== undefined ? { height } : undefined}
      role={role}
      aria-label={ariaLabel}
      aria-activedescendant={activeId}
      tabIndex={0}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      {count === 0 && empty ? <div className="ms-vlist-empty">{empty}</div> : null}
      <div style={{ height: win.padTop }} aria-hidden="true" />
      {rows}
      <div style={{ height: win.padBottom }} aria-hidden="true" />
    </div>
  );
}
