/**
 * High-frequency pointer state kept OUT of the editor store so that mouse moves do not wake every
 * editor subscriber: the cursor position in sheet coordinates (status bar read-out) and the
 * object under the cursor (status bar hint / tooltips). Written by the schematic canvas.
 */
import type { Point } from '../../model/types';
import { createStore } from './createStore';

export interface CursorInfo {
  /** sheet coordinates of the pointer, snapped to the grid; null when the pointer left the canvas */
  pos: Point | null;
  /** short description of the object under the pointer ("R1 pin 2", "wire N$3", ...) */
  hover: string;
}

export const cursorStore = createStore<CursorInfo>({ pos: null, hover: '' });

/** Update the cursor read-out; no notification when nothing changed. */
export function setCursor(pos: Point | null, hover = ''): void {
  const cur = cursorStore.getState();
  const same = cur.hover === hover && (cur.pos === pos || (!!cur.pos && !!pos && cur.pos.x === pos.x && cur.pos.y === pos.y));
  if (!same) cursorStore.setState({ pos, hover });
}
