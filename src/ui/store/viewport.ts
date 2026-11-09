/**
 * Viewport math (pure). A view maps sheet coordinates to canvas pixels:
 *   screen = sheet * zoom + pan
 */
import type { Point } from '../../model/types';
import type { Rect, ViewState } from './types';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_VIEW: ViewState = { panX: 60, panY: 60, zoom: 1.5 };
/** Discrete zoom steps used by zoom in/out commands. */
export const ZOOM_STEP = 1.25;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function screenToSheet(view: ViewState, p: Point): Point {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom };
}

export function sheetToScreen(view: ViewState, p: Point): Point {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY };
}

/** Zoom by `factor` keeping the sheet point under `screenPt` fixed. */
export function zoomAt(view: ViewState, screenPt: Point, factor: number): ViewState {
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const s = screenToSheet(view, screenPt);
  return { zoom, panX: screenPt.x - s.x * zoom, panY: screenPt.y - s.y * zoom };
}

/** View that shows `rect` centred in a viewport of `size`, with a pixel margin. */
export function fitRect(rect: Rect, size: { w: number; h: number }, margin = 40, maxZoom = 3): ViewState {
  const w = Math.max(rect.w, 1);
  const h = Math.max(rect.h, 1);
  const availW = Math.max(size.w - 2 * margin, 50);
  const availH = Math.max(size.h - 2 * margin, 50);
  const zoom = clampZoom(Math.min(availW / w, availH / h, maxZoom));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return { zoom, panX: size.w / 2 - cx * zoom, panY: size.h / 2 - cy * zoom };
}

/** Same zoom, pan so that sheet point `p` is in the centre of the viewport. */
export function centerOn(view: ViewState, p: Point, size: { w: number; h: number }): ViewState {
  return { zoom: view.zoom, panX: size.w / 2 - p.x * view.zoom, panY: size.h / 2 - p.y * view.zoom };
}

/** Visible sheet rectangle. */
export function visibleRect(view: ViewState, size: { w: number; h: number }): Rect {
  const a = screenToSheet(view, { x: 0, y: 0 });
  return { x: a.x, y: a.y, w: size.w / view.zoom, h: size.h / view.zoom };
}
