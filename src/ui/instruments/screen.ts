/**
 * Canvas drawing helpers for instrument screens (DOM-only, called from effects).
 *
 * - `readScreenColors`: screen palette from CSS custom properties (msi- tokens with theme
 *   fallbacks), normal or reverse (white) background.
 * - `drawGraticule`: divided oscilloscope-style grid with centre-line tick marks.
 * - `drawAxes`: labelled x/y axes (linear or log) with engineering tick labels; returns the
 *   data -> pixel mapping used to draw curves into the same rectangle.
 * - `strokeCurve`: polyline with NaN gaps, clipped to a rectangle.
 */

import { cssVar, tracePalette } from '../results/canvas';
import { axisFormatter, axisFraction, formatLogTick, linearTicks, logTicks } from '../results/ticks';

export interface ScreenColors {
  bg: string;
  grid: string;
  gridMajor: string;
  text: string;
  frame: string;
  traces: string[];
  cursor1: string;
  cursor2: string;
  marker: string;
}

export function readScreenColors(el: Element, reverse = false): ScreenColors {
  if (reverse) {
    return {
      bg: cssVar(el, '--msi-screen-rev-bg', '#ffffff'),
      grid: cssVar(el, '--msi-screen-rev-grid', '#d3d8e0'),
      gridMajor: cssVar(el, '--msi-screen-rev-grid-major', '#9aa3b2'),
      text: cssVar(el, '--msi-screen-rev-text', '#39404d'),
      frame: cssVar(el, '--msi-screen-rev-grid-major', '#9aa3b2'),
      traces: tracePalette(el, 'light'),
      cursor1: cssVar(el, '--msi-cursor-1-rev', '#e03131'),
      cursor2: cssVar(el, '--msi-cursor-2-rev', '#1971c2'),
      marker: cssVar(el, '--msi-marker-rev', '#c2255c'),
    };
  }
  return {
    bg: cssVar(el, '--msi-screen-bg', cssVar(el, '--plot-bg', '#0f1420')),
    grid: cssVar(el, '--msi-screen-grid', cssVar(el, '--plot-grid', '#2a3245')),
    gridMajor: cssVar(el, '--msi-screen-grid-major', '#46516a'),
    text: cssVar(el, '--msi-screen-text', cssVar(el, '--plot-text', '#c9d1e3')),
    frame: cssVar(el, '--msi-screen-grid-major', '#46516a'),
    traces: tracePalette(el, 'dark'),
    cursor1: cssVar(el, '--msi-cursor-1', '#ff8787'),
    cursor2: cssVar(el, '--msi-cursor-2', '#74c0fc'),
    marker: cssVar(el, '--msi-marker', '#f783ac'),
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fill the background and draw a divX x divY graticule with minor ticks on the centre lines. */
export function drawGraticule(ctx: CanvasRenderingContext2D, r: Rect, divX: number, divY: number, c: ScreenColors): void {
  ctx.fillStyle = c.bg;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.grid;
  ctx.beginPath();
  for (let i = 1; i < divX; i++) {
    const x = Math.round(r.x + (i * r.w) / divX) + 0.5;
    ctx.moveTo(x, r.y);
    ctx.lineTo(x, r.y + r.h);
  }
  for (let j = 1; j < divY; j++) {
    const y = Math.round(r.y + (j * r.h) / divY) + 0.5;
    ctx.moveTo(r.x, y);
    ctx.lineTo(r.x + r.w, y);
  }
  ctx.stroke();
  // centre axes with 5 minor ticks per division
  ctx.strokeStyle = c.gridMajor;
  const cx = Math.round(r.x + r.w / 2) + 0.5;
  const cy = Math.round(r.y + r.h / 2) + 0.5;
  ctx.beginPath();
  ctx.moveTo(r.x, cy);
  ctx.lineTo(r.x + r.w, cy);
  ctx.moveTo(cx, r.y);
  ctx.lineTo(cx, r.y + r.h);
  for (let i = 0; i <= divX * 5; i++) {
    const x = Math.round(r.x + (i * r.w) / (divX * 5)) + 0.5;
    ctx.moveTo(x, cy - 3);
    ctx.lineTo(x, cy + 3);
  }
  for (let j = 0; j <= divY * 5; j++) {
    const y = Math.round(r.y + (j * r.h) / (divY * 5)) + 0.5;
    ctx.moveTo(cx - 3, y);
    ctx.lineTo(cx + 3, y);
  }
  ctx.stroke();
  ctx.strokeStyle = c.frame;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

/** Polyline through pixel coordinates; non-finite points break the line. Clipped to `clip`. */
export function strokeCurve(ctx: CanvasRenderingContext2D, xs: ArrayLike<number>, ys: ArrayLike<number>, color: string, clip: Rect, width = 1.5): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    const yy = Math.max(-1e5, Math.min(1e5, y));
    if (pen) ctx.lineTo(x, yy);
    else ctx.moveTo(x, yy);
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

/** Vertical dashed cursor with a numbered flag. */
export function drawCursor(ctx: CanvasRenderingContext2D, x: number, r: Rect, color: string, label: string): void {
  if (!(x >= r.x - 1 && x <= r.x + r.w + 1)) return;
  const px = Math.round(x) + 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(px, r.y);
  ctx.lineTo(px, r.y + r.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px - 7, r.y);
  ctx.lineTo(px + 7, r.y);
  ctx.lineTo(px + 7, r.y + 10);
  ctx.lineTo(px, r.y + 15);
  ctx.lineTo(px - 7, r.y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 9px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, px, r.y + 1);
  ctx.restore();
}

export interface AxisSpec {
  min: number;
  max: number;
  log: boolean;
  unit: string;
  /** plain numeric labels without engineering prefixes (dB, degrees) */
  plain?: boolean;
  label?: string;
}

export interface AxesMapping {
  /** plot area inside the margins */
  area: Rect;
  x(v: number): number;
  y(v: number): number;
  /** inverse of x() */
  xValue(px: number): number;
}

function plainFormatter(step: number): (v: number) => string {
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step || 1) + 1e-9)));
  return (v) => (Math.abs(v) < step * 1e-9 ? '0' : v.toFixed(decimals));
}

/**
 * Draw background, grid and tick labels for an x/y plot inside `outer` and return the mapping.
 * Margins: 54 px left, 8 right, 6 top, 30 bottom (x label row).
 */
export function drawAxes(ctx: CanvasRenderingContext2D, outer: Rect, xs: AxisSpec, ys: AxisSpec, c: ScreenColors): AxesMapping {
  const area: Rect = { x: outer.x + 54, y: outer.y + 6, w: Math.max(10, outer.w - 62), h: Math.max(10, outer.h - 36) };
  const fx = (v: number) => area.x + axisFraction(v, xs.min, xs.max, xs.log) * area.w;
  const fy = (v: number) => area.y + area.h - axisFraction(v, ys.min, ys.max, ys.log) * area.h;
  ctx.fillStyle = c.bg;
  ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
  ctx.font = '10px "Segoe UI", system-ui, sans-serif';
  const xt = xs.log ? logTicks(xs.min, xs.max, 8) : linearTicks(xs.min, xs.max, Math.max(2, Math.floor(area.w / 80)));
  const yt = ys.log ? logTicks(ys.min, ys.max, 6) : linearTicks(ys.min, ys.max, Math.max(2, Math.floor(area.h / 36)));
  const fmtX = xs.log ? (v: number) => formatLogTick(v, xs.unit) : xs.plain ? plainFormatter(xt.step) : axisFormatter(xt.major, xt.step, xs.unit);
  const fmtY = ys.log ? (v: number) => formatLogTick(v, ys.unit) : ys.plain ? plainFormatter(yt.step) : axisFormatter(yt.major, yt.step, ys.unit);
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.grid;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (const t of xt.minor) {
    const x = Math.round(fx(t)) + 0.5;
    ctx.moveTo(x, area.y);
    ctx.lineTo(x, area.y + area.h);
  }
  for (const t of yt.minor) {
    const y = Math.round(fy(t)) + 0.5;
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (const t of xt.major) {
    const x = Math.round(fx(t)) + 0.5;
    ctx.moveTo(x, area.y);
    ctx.lineTo(x, area.y + area.h);
  }
  for (const t of yt.major) {
    const y = Math.round(fy(t)) + 0.5;
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
  }
  ctx.stroke();
  ctx.strokeStyle = c.frame;
  ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1);
  ctx.fillStyle = c.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yt.major) {
    const y = fy(t);
    if (y < area.y - 1 || y > area.y + area.h + 1) continue;
    ctx.fillText(fmtY(t), area.x - 4, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let lastRight = -Infinity;
  for (const t of xt.major) {
    const x = fx(t);
    const label = fmtX(t);
    const w = ctx.measureText(label).width;
    if (x - w / 2 < lastRight + 4) continue;
    ctx.fillText(label, x, area.y + area.h + 3);
    lastRight = x + w / 2;
  }
  if (xs.label) {
    ctx.textAlign = 'right';
    ctx.fillText(xs.label, area.x + area.w, area.y + area.h + 16);
  }
  if (ys.label) {
    ctx.save();
    ctx.translate(outer.x + 9, area.y + area.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ys.label, 0, 0);
    ctx.restore();
  }
  return {
    area,
    x: fx,
    y: fy,
    xValue: (px: number) => {
      const f = (px - area.x) / (area.w || 1);
      return xs.log ? 10 ** (Math.log10(xs.min) + f * (Math.log10(xs.max) - Math.log10(xs.min))) : xs.min + f * (xs.max - xs.min);
    },
  };
}

/** Draw text with a translucent backing box (marker / status labels on screens). */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, bg: string, align: CanvasTextAlign = 'left'): void {
  ctx.save();
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = bg;
  ctx.fillRect(x0, y, w, 16);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + 4, y + 8);
  ctx.restore();
}
