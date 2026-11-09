/**
 * Panel splitter (role="separator"): drag with the pointer or focus it and use the arrow keys
 * (Shift = larger steps, Home / End = limits) to resize the adjacent panel.
 *
 * The owner keeps the size; `direction` says how pointer movement maps to size:
 *  - 'right' : moving the pointer right grows the panel (panel is left of the splitter)
 *  - 'left'  : moving left grows it (panel is right of the splitter)
 *  - 'up'    : moving up grows it (panel is below the splitter)
 */
import { useRef, useState } from 'react';
import './common.css';

export interface SplitterProps {
  value: number;
  min: number;
  max: number;
  direction: 'right' | 'left' | 'up';
  onChange: (value: number) => void;
  label: string;
}

export function clampSize(v: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, v)));
}

export function Splitter({ value, min, max, direction, onChange, label }: SplitterProps) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = direction !== 'up';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;

  return (
    <div
      className={`ms-splitter ${vertical ? 'ms-splitter-v' : 'ms-splitter-h'} ${dragging ? 'is-dragging' : ''}`}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: vertical ? e.clientX : e.clientY, value };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const pos = vertical ? e.clientX : e.clientY;
        onChange(clampSize(s.value + sign * (pos - s.pos), min, max));
      }}
      onPointerUp={(e) => {
        start.current = null;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 50 : 10;
        const grow = vertical ? (sign > 0 ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
        const shrink = vertical ? (sign > 0 ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
        let next: number | null = null;
        if (e.key === grow) next = value + step;
        else if (e.key === shrink) next = value - step;
        else if (e.key === 'Home') next = min;
        else if (e.key === 'End') next = max;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(clampSize(next, min, max));
      }}
    />
  );
}
