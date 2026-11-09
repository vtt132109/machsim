/**
 * Interactive multi-pane plot on a HiDPI canvas.
 *
 * Interaction
 * - drag: rubber-band zoom (x and y of the pane; a flat box zooms x only)
 * - drag with the Pan tool, middle button or Shift: pan
 * - wheel: zoom x around the pointer; Shift + wheel zooms y of the pane under the pointer
 * - drag a cursor line: move it; click (no drag) moves the nearest cursor there
 * - double click / Home: reset to autoscale; arrow keys pan; + / - zoom
 *
 * The component is controlled: the parent owns `view` and `cursors`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { cssVar, setupHiDpiCanvas, tracePalette } from './canvas';
import { useElementSize, useLatest, useWheel } from './hooks';
import type { PlotData } from './plotModel';
import type { PlotColors, PlotFrame, PlotViewState } from './plotRender';
import { computeFrame, drawPlot, paneAt, pxToX, pxToY, xToPx } from './plotRender';
import { panRange, zoomRange } from './ticks';
import { t } from '../../i18n';

export interface PlotViewProps {
  data: PlotData;
  hidden?: ReadonlySet<string>;
  view: PlotViewState | null;
  onViewChange: (view: PlotViewState | null) => void;
  cursors?: [number, number] | null;
  onCursorsChange?: (cursors: [number, number]) => void;
  grid?: boolean;
  background?: 'dark' | 'light';
  tool?: 'zoom' | 'pan';
  yLogPanes?: ReadonlySet<number>;
  highlight?: string | null;
  /** CSS height in px (default: fill the parent, min 220) */
  height?: number;
  /** receives the canvas element (for PNG export) */
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
  ariaLabel?: string;
}

type Drag =
  | { kind: 'zoom'; x0: number; y0: number; pane: number }
  | { kind: 'pan'; x0: number; y0: number; pane: number; frame: PlotFrame }
  | { kind: 'cursor'; index: 0 | 1; moved: boolean };

const EMPTY = new Set<string>();

export function readPlotColors(el: Element, background: 'dark' | 'light'): PlotColors {
  const dark = background === 'dark';
  return {
    bg: dark ? cssVar(el, '--plot-bg', '#0f1420') : cssVar(el, '--msr-light-bg', '#ffffff'),
    grid: dark ? cssVar(el, '--plot-grid', '#2a3245') : cssVar(el, '--msr-light-grid', '#cfd5de'),
    gridMinor: dark ? cssVar(el, '--msr-dark-grid-minor', '#1b2131') : cssVar(el, '--msr-light-grid-minor', '#eceff3'),
    text: dark ? cssVar(el, '--plot-text', '#c9d1e3') : cssVar(el, '--msr-light-text', '#39404d'),
    frame: dark ? cssVar(el, '--plot-grid', '#2a3245') : cssVar(el, '--msr-light-frame', '#9aa3b2'),
    cursor1: cssVar(el, '--msr-cursor-1', '#ff8787'),
    cursor2: cssVar(el, '--msr-cursor-2', '#38d9a9'),
    traces: tracePalette(el, background),
  };
}

export function PlotView(props: PlotViewProps) {
  const {
    data,
    hidden = EMPTY,
    view,
    onViewChange,
    cursors = null,
    onCursorsChange,
    grid = true,
    background = 'dark',
    tool = 'zoom',
    yLogPanes,
    highlight = null,
    height,
    onCanvas,
    ariaLabel = t('results.plotView.plot'),
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrapRef);
  const [zoomBox, setZoomBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drag = useRef<Drag | null>(null);

  const frame = useMemo(
    () => computeFrame(data, hidden, view, Math.max(1, size.width), Math.max(1, size.height), yLogPanes),
    [data, hidden, view, size.width, size.height, yLogPanes],
  );
  const frameRef = useLatest(frame);

  useEffect(() => {
    onCanvas?.(canvasRef.current);
    return () => onCanvas?.(null);
  }, [onCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width < 2 || size.height < 2) return;
    const ctx = setupHiDpiCanvas(canvas, size.width, size.height);
    if (!ctx) return;
    drawPlot(ctx, frame, data, hidden, readPlotColors(canvas, background), { grid, cursors, zoomBox, highlight });
  }, [frame, data, hidden, background, grid, cursors, zoomBox, highlight, size.width, size.height]);

  const currentView = (f: PlotFrame): PlotViewState => {
    const y: Record<number, [number, number]> = {};
    for (const p of f.panes) if (view?.y[p.index]) y[p.index] = [p.yMin, p.yMax];
    return { x: [f.xMin, f.xMax], y };
  };

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clampX = (f: PlotFrame, px: number) => pxToX(f, Math.max(f.left, Math.min(f.right, px)));

  useWheel(canvasRef, (e) => {
    const f = frameRef.current;
    const { x, y } = localPoint(e);
    if (x < f.left || x > f.right) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    const base = currentView(f);
    if (e.shiftKey) {
      const p = paneAt(f, y);
      if (!p || p.kind === 'digital') return;
      const [lo, hi] = zoomRange(p.yMin, p.yMax, pxToY(p, y), factor, p.yLog);
      onViewChange({ ...base, y: { ...base.y, [p.index]: [lo, hi] } });
      return;
    }
    const [lo, hi] = zoomRange(f.xMin, f.xMax, pxToX(f, x), factor, f.xLog);
    onViewChange({ ...base, x: [lo, hi] });
  });

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const f = frame;
    const { x, y } = localPoint(e);
    const p = paneAt(f, y);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    if (cursors && onCursorsChange && e.button === 0 && !e.shiftKey) {
      const d0 = Math.abs(xToPx(f, cursors[0]) - x);
      const d1 = Math.abs(xToPx(f, cursors[1]) - x);
      if (Math.min(d0, d1) <= 6) {
        drag.current = { kind: 'cursor', index: d0 <= d1 ? 0 : 1, moved: false };
        return;
      }
    }
    if (!p) {
      drag.current = null;
      return;
    }
    if (tool === 'pan' || e.button === 1 || e.shiftKey) drag.current = { kind: 'pan', x0: x, y0: y, pane: p.index, frame: f };
    else drag.current = { kind: 'zoom', x0: x, y0: y, pane: p.index };
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const { x, y } = localPoint(e);
    const canvas = canvasRef.current;
    if (!d) {
      if (canvas && cursors) {
        const near = Math.min(Math.abs(xToPx(frame, cursors[0]) - x), Math.abs(xToPx(frame, cursors[1]) - x)) <= 6;
        canvas.style.cursor = near ? 'ew-resize' : tool === 'pan' ? 'grab' : 'crosshair';
      }
      return;
    }
    if (d.kind === 'cursor') {
      d.moved = true;
      const next: [number, number] = [...(cursors ?? [0, 0])] as [number, number];
      next[d.index] = clampX(frame, x);
      onCursorsChange?.(next);
      return;
    }
    if (d.kind === 'pan') {
      const f = d.frame;
      const dxFrac = -(x - d.x0) / (f.right - f.left || 1);
      const xr = panRange(f.xMin, f.xMax, dxFrac, f.xLog);
      const p = f.panes[d.pane];
      const base = currentView(f);
      const yOver = { ...base.y };
      if (p && p.kind === 'analog' && Math.abs(y - d.y0) > 2) {
        const dyFrac = (y - d.y0) / (p.h || 1);
        yOver[p.index] = panRange(p.yMin, p.yMax, dyFrac, p.yLog);
      }
      onViewChange({ x: xr, y: yOver });
      return;
    }
    if (d.kind === 'zoom') {
      if (Math.abs(x - d.x0) > 3 || Math.abs(y - d.y0) > 3) setZoomBox({ x0: d.x0, y0: d.y0, x1: x, y1: y });
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const { x, y } = localPoint(e);
    if (!d) return;
    if (d.kind === 'zoom') {
      setZoomBox(null);
      const f = frame;
      const wide = Math.abs(x - d.x0) > 5;
      const tall = Math.abs(y - d.y0) > 5;
      if (!wide && !tall) {
        // plain click: move the nearest cursor
        if (cursors && onCursorsChange) {
          const xv = clampX(f, x);
          const near0 = Math.abs(xToPx(f, cursors[0]) - x) <= Math.abs(xToPx(f, cursors[1]) - x);
          onCursorsChange(near0 ? [xv, cursors[1]] : [cursors[0], xv]);
        }
        return;
      }
      const base = currentView(f);
      const next: PlotViewState = { x: base.x, y: { ...base.y } };
      if (wide) next.x = [clampX(f, Math.min(x, d.x0)), clampX(f, Math.max(x, d.x0))];
      const p = f.panes[d.pane];
      if (tall && p && p.kind === 'analog') {
        const yTop = Math.max(p.y, Math.min(y, d.y0));
        const yBot = Math.min(p.y + p.h, Math.max(y, d.y0));
        next.y[p.index] = [pxToY(p, yBot), pxToY(p, yTop)];
      }
      onViewChange(next);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const f = frame;
    const base = currentView(f);
    switch (e.key) {
      case 'Home':
      case '0':
        onViewChange(null);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        onViewChange({ ...base, x: panRange(f.xMin, f.xMax, e.key === 'ArrowLeft' ? -0.1 : 0.1, f.xLog) });
        break;
      case '+':
      case '=':
      case '-': {
        const mid = f.xLog ? Math.sqrt(f.xMin * f.xMax) : (f.xMin + f.xMax) / 2;
        onViewChange({ ...base, x: zoomRange(f.xMin, f.xMax, mid, e.key === '-' ? 1.25 : 0.8, f.xLog) });
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div ref={wrapRef} className="msr-plotview" style={height ? { height } : undefined}>
      <canvas
        ref={canvasRef}
        className="msr-plotview-canvas"
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setZoomBox(null);
        }}
        onDoubleClick={() => onViewChange(null)}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
