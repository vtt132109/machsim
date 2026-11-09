/**
 * Plot layout and canvas drawing for the grapher.
 *
 * `computeFrame` (pure) resolves the visible ranges and pane rectangles for a PlotData;
 * `drawPlot` paints a frame on a 2D context (background, grid, ticks, traces with min/max
 * decimation, digital lanes, cursors and the zoom rubber band). Coordinate helpers convert
 * between data values and CSS pixels and are shared with the interaction code in PlotView.
 */

import type { PlotData, PlotTrace } from './plotModel';
import { decimateMinMax, displayUnit, monotonicity, visibleIndexRange, xExtent, yExtent } from './plotModel';
import { axisFormatter, axisFraction, axisValue, formatLogTick, linearTicks, logTicks, niceRange } from './ticks';

export interface PlotViewState {
  /** x range; null = autoscale */
  x: [number, number] | null;
  /** per-pane y range override (pane index -> range) */
  y: Record<number, [number, number]>;
}

export interface PaneFrame {
  index: number;
  kind: 'analog' | 'digital';
  title: string;
  unit: string;
  x: number;
  y: number;
  w: number;
  h: number;
  yMin: number;
  yMax: number;
  yLog: boolean;
  /** digital lanes: visible trace keys in drawing order */
  lanes: string[];
}

export interface PlotFrame {
  width: number;
  height: number;
  left: number;
  right: number;
  xMin: number;
  xMax: number;
  xLog: boolean;
  panes: PaneFrame[];
}

export const PLOT_MARGIN = { left: 66, right: 14, top: 8, bottom: 38, gap: 12 };

export interface PlotColors {
  bg: string;
  grid: string;
  gridMinor: string;
  text: string;
  frame: string;
  cursor1: string;
  cursor2: string;
  traces: string[];
}

function visibleTraces(data: PlotData, hidden: ReadonlySet<string>): PlotTrace[] {
  return data.traces.filter((t) => !hidden.has(t.key));
}

/** Resolve ranges and pane rectangles. */
export function computeFrame(
  data: PlotData,
  hidden: ReadonlySet<string>,
  view: PlotViewState | null,
  width: number,
  height: number,
  yLogPanes: ReadonlySet<number> = new Set(),
): PlotFrame {
  const vis = visibleTraces(data, hidden);
  const all = vis.length ? vis : data.traces;
  let xr: [number, number];
  if (view?.x) xr = view.x;
  else {
    const ext = xExtent(all, data.xLog) ?? (data.xLog ? [1, 10] : [0, 1]);
    xr = data.xLog ? niceRange(ext[0], ext[1], true) : ext[0] === ext[1] ? niceRange(ext[0], ext[1]) : ext;
  }
  const left = PLOT_MARGIN.left;
  const right = Math.max(left + 10, width - PLOT_MARGIN.right);
  const top = PLOT_MARGIN.top;
  const bottom = Math.max(top + 10, height - PLOT_MARGIN.bottom);
  const total = bottom - top;
  const n = data.panes.length;
  const gaps = PLOT_MARGIN.gap * Math.max(0, n - 1);
  const digitalLanes = data.panes.map((p, i) => (p.kind === 'digital' ? vis.filter((t) => t.pane === i).map((t) => t.key) : []));
  const analogCount = data.panes.filter((p) => p.kind === 'analog').length;
  const heights = data.panes.map((p, i) => {
    if (p.kind !== 'digital') return 0;
    const want = Math.max(1, digitalLanes[i].length) * 26 + 8;
    return analogCount ? Math.min(want, (total - gaps) * 0.45) : (total - gaps) / Math.max(1, n - analogCount);
  });
  const usedDigital = heights.reduce((a, b) => a + b, 0);
  const analogH = analogCount ? (total - gaps - usedDigital) / analogCount : 0;
  let y = top;
  const panes: PaneFrame[] = data.panes.map((p, i) => {
    const h = p.kind === 'digital' ? heights[i] : analogH;
    const yLog = p.kind === 'analog' && yLogPanes.has(i);
    let yr: [number, number];
    if (p.kind === 'digital') yr = [0, 1];
    else if (view?.y[i]) yr = view.y[i];
    else {
      const traces = vis.filter((t) => t.pane === i);
      const ext = yExtent(traces, Math.min(xr[0], xr[1]), Math.max(xr[0], xr[1]), yLog);
      if (!ext) yr = yLog ? [1, 10] : [-1, 1];
      else if (yLog) yr = niceRange(ext[0], ext[1], true);
      else {
        const pad = (ext[1] - ext[0]) * 0.04;
        yr = niceRange(ext[0] - pad, ext[1] + pad);
      }
    }
    const frame: PaneFrame = { index: i, kind: p.kind, title: p.title, unit: p.unit, x: left, y, w: right - left, h, yMin: yr[0], yMax: yr[1], yLog, lanes: digitalLanes[i] };
    y += h + PLOT_MARGIN.gap;
    return frame;
  });
  return { width, height, left, right, xMin: xr[0], xMax: xr[1], xLog: data.xLog, panes };
}

export function xToPx(f: PlotFrame, x: number): number {
  return f.left + axisFraction(x, f.xMin, f.xMax, f.xLog) * (f.right - f.left);
}

export function pxToX(f: PlotFrame, px: number): number {
  return axisValue((px - f.left) / (f.right - f.left || 1), f.xMin, f.xMax, f.xLog);
}

export function yToPx(p: PaneFrame, y: number): number {
  return p.y + p.h - axisFraction(y, p.yMin, p.yMax, p.yLog) * p.h;
}

export function pxToY(p: PaneFrame, py: number): number {
  return axisValue((p.y + p.h - py) / (p.h || 1), p.yMin, p.yMax, p.yLog);
}

/** Pane under a y pixel (or null in a gap / margin). */
export function paneAt(f: PlotFrame, py: number): PaneFrame | null {
  return f.panes.find((p) => py >= p.y && py <= p.y + p.h) ?? null;
}

function simpleFormatter(step: number, unit: string): (v: number) => string {
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step || 1) + 1e-9)));
  return (v) => `${Math.abs(v) < step * 1e-9 ? '0' : v.toFixed(decimals)}${unit}`;
}

function drawXAxis(ctx: CanvasRenderingContext2D, f: PlotFrame, data: PlotData, c: PlotColors, grid: boolean): void {
  const ticks = f.xLog ? logTicks(f.xMin, f.xMax, 8) : linearTicks(f.xMin, f.xMax, Math.max(2, Math.floor((f.right - f.left) / 90)));
  const unit = displayUnit(String(data.xUnit));
  const fmt = f.xLog ? (v: number) => formatLogTick(v, unit) : axisFormatter(ticks.major, ticks.step, unit);
  for (const p of f.panes) {
    if (grid) {
      ctx.strokeStyle = c.gridMinor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const t of ticks.minor) {
        const x = Math.round(xToPx(f, t)) + 0.5;
        ctx.moveTo(x, p.y);
        ctx.lineTo(x, p.y + p.h);
      }
      ctx.stroke();
      ctx.strokeStyle = c.grid;
      ctx.beginPath();
      for (const t of ticks.major) {
        const x = Math.round(xToPx(f, t)) + 0.5;
        ctx.moveTo(x, p.y);
        ctx.lineTo(x, p.y + p.h);
      }
      ctx.stroke();
    }
  }
  const last = f.panes[f.panes.length - 1];
  if (!last) return;
  ctx.fillStyle = c.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let lastRight = -Infinity;
  for (const t of ticks.major) {
    const x = xToPx(f, t);
    const label = fmt(t);
    const w = ctx.measureText(label).width;
    if (x - w / 2 < lastRight + 6) continue;
    ctx.fillText(label, x, last.y + last.h + 4);
    lastRight = x + w / 2;
  }
  ctx.textAlign = 'right';
  ctx.fillText(`${data.xLabel}${unit ? ` (${unit})` : ''}`, f.right, last.y + last.h + 20);
}

function drawYAxis(ctx: CanvasRenderingContext2D, p: PaneFrame, f: PlotFrame, c: PlotColors, grid: boolean): void {
  if (p.kind === 'digital') return;
  const target = Math.max(2, Math.floor(p.h / 40));
  const ticks = p.yLog ? logTicks(p.yMin, p.yMax, target) : linearTicks(p.yMin, p.yMax, target);
  const unit = displayUnit(p.unit);
  const fmt = p.yLog
    ? (v: number) => formatLogTick(v, unit)
    : p.unit === 'dB' || p.unit === 'deg'
      ? simpleFormatter(ticks.step, '')
      : axisFormatter(ticks.major, ticks.step, unit);
  if (grid) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.gridMinor;
    ctx.beginPath();
    for (const t of ticks.minor) {
      const y = Math.round(yToPx(p, t)) + 0.5;
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    for (const t of ticks.major) {
      const y = Math.round(yToPx(p, t)) + 0.5;
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = c.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks.major) {
    const y = yToPx(p, t);
    if (y < p.y - 1 || y > p.y + p.h + 1) continue;
    ctx.fillText(fmt(t), p.x - 6, y);
  }
  // zero line emphasis
  if (!p.yLog && p.yMin < 0 && p.yMax > 0) {
    const y = Math.round(yToPx(p, 0)) + 0.5;
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, y);
    ctx.lineTo(p.x + p.w, y);
    ctx.stroke();
  }
}

function strokeSeries(ctx: CanvasRenderingContext2D, f: PlotFrame, p: PaneFrame, t: PlotTrace): void {
  const asc = monotonicity(t.x) === 1;
  let xs: ArrayLike<number> = t.x;
  let ys: ArrayLike<number> = t.y;
  let i0 = 0;
  let i1 = t.x.length - 1;
  if (asc) {
    [i0, i1] = visibleIndexRange(t.x, Math.min(f.xMin, f.xMax), Math.max(f.xMin, f.xMax));
    if (i1 - i0 > 4 * (f.right - f.left)) {
      const d = decimateMinMax(t.x, t.y, i0, i1, (v) => xToPx(f, v));
      xs = d.x;
      ys = d.y;
      i0 = 0;
      i1 = d.x.length - 1;
    }
  }
  ctx.beginPath();
  let pen = false;
  for (let i = i0; i <= i1; i++) {
    const px = xToPx(f, xs[i]);
    const py = yToPx(p, ys[i]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      pen = false;
      continue;
    }
    // keep coordinates bounded so canvas does not choke on huge values
    const cy = Math.max(-1e5, Math.min(1e5, py));
    if (pen) ctx.lineTo(px, cy);
    else ctx.moveTo(px, cy);
    pen = true;
  }
  ctx.stroke();
}

function strokeDigital(ctx: CanvasRenderingContext2D, f: PlotFrame, laneTop: number, laneH: number, t: PlotTrace, color: string): void {
  const hi = laneTop + 4;
  const lo = laneTop + laneH - 4;
  const mid = (hi + lo) / 2;
  const [i0, i1] = monotonicity(t.x) === 1 ? visibleIndexRange(t.x, f.xMin, f.xMax) : [0, t.x.length - 1];
  let prevY: number | null = null;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let i = i0; i <= i1; i++) {
    const x0 = Math.max(f.left, xToPx(f, t.x[i]));
    const x1 = i < t.x.length - 1 ? Math.min(f.right, xToPx(f, t.x[i + 1])) : f.right;
    if (x1 < f.left || x0 > f.right) continue;
    const v = t.y[i];
    ctx.setLineDash([]);
    if (Number.isNaN(v)) {
      // high impedance
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, mid);
      ctx.lineTo(x1, mid);
      ctx.stroke();
      prevY = null;
      continue;
    }
    if (v > 0.25 && v < 0.75) {
      // unknown: filled band
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x0, hi, Math.max(1, x1 - x0), lo - hi);
      ctx.globalAlpha = 1;
      prevY = null;
      continue;
    }
    const y = v >= 0.5 ? hi : lo;
    ctx.beginPath();
    if (prevY !== null && prevY !== y) {
      ctx.moveTo(x0, prevY);
      ctx.lineTo(x0, y);
    } else ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    prevY = y;
  }
  ctx.setLineDash([]);
}

export interface DrawOptions {
  grid: boolean;
  cursors: [number, number] | null;
  /** rubber band in CSS px */
  zoomBox?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** emphasised trace key (a legend key also matches its ':mag' / ':ph' traces) */
  highlight?: string | null;
}

/** Paint a full plot frame. */
export function drawPlot(ctx: CanvasRenderingContext2D, f: PlotFrame, data: PlotData, hidden: ReadonlySet<string>, c: PlotColors, o: DrawOptions): void {
  ctx.save();
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  drawXAxis(ctx, f, data, c, o.grid);
  const byKey = new Map(data.traces.map((t) => [t.key, t] as const));
  for (const p of f.panes) {
    drawYAxis(ctx, p, f, c, o.grid);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    if (p.kind === 'digital') {
      const laneH = p.lanes.length ? p.h / p.lanes.length : p.h;
      p.lanes.forEach((key, li) => {
        const t = byKey.get(key);
        if (t) strokeDigital(ctx, f, p.y + li * laneH, laneH, t, c.traces[t.color % c.traces.length]);
      });
    } else {
      ctx.lineJoin = 'round';
      for (const t of data.traces) {
        if (t.pane !== p.index || hidden.has(t.key)) continue;
        ctx.strokeStyle = c.traces[t.color % c.traces.length];
        ctx.lineWidth = o.highlight && (t.key === o.highlight || t.key.startsWith(o.highlight + ':')) ? (t.width ?? 1.5) + 1.1 : (t.width ?? 1.5);
        strokeSeries(ctx, f, p, t);
      }
    }
    ctx.restore();
    // frame and title
    ctx.strokeStyle = c.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    if (p.kind === 'digital') {
      const laneH = p.lanes.length ? p.h / p.lanes.length : p.h;
      ctx.fillStyle = c.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      p.lanes.forEach((key, li) => {
        const t = byKey.get(key);
        if (!t) return;
        const label = t.label.length > 10 ? `${t.label.slice(0, 9)}…` : t.label;
        ctx.fillText(label, p.x - 6, p.y + li * laneH + laneH / 2);
      });
    } else if (f.panes.length > 1) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = c.text;
      ctx.globalAlpha = 0.8;
      ctx.fillText(p.title, p.x + 6, p.y + 4);
      ctx.globalAlpha = 1;
    }
  }
  if (o.cursors && f.panes.length) {
    const top = f.panes[0].y;
    const last = f.panes[f.panes.length - 1];
    const bottom = last.y + last.h;
    o.cursors.forEach((cx, i) => {
      const px = Math.round(xToPx(f, cx)) + 0.5;
      if (!(px >= f.left - 1 && px <= f.right + 1)) return;
      const col = i === 0 ? c.cursor1 : c.cursor2;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(px - 6, top);
      ctx.lineTo(px + 6, top);
      ctx.lineTo(px, top + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c.bg;
      ctx.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), px, top);
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    });
  }
  if (o.zoomBox) {
    const { x0, y0, x1, y1 } = o.zoomBox;
    ctx.strokeStyle = c.text;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.fillStyle = c.text;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
  ctx.restore();
}
