/**
 * Application-wide canvas interaction controller bound to the editor store singleton.
 * The app shell installs the host (dialogs, context menu, instrument windows) with
 * `interaction.setHost(...)`; global keyboard handling forwards keys to `interaction.keyDown`.
 */
import { editor } from '../store';
import { CanvasInteraction } from './interaction';

export const interaction = new CanvasInteraction(editor);

/** MIME type used when dragging a library part from the component browser onto the canvas. */
export const PART_DRAG_MIME = 'application/x-machsim-part';

/**
 * Files dropped onto the schematic (snippet pictures, designs): installed by src/ui/files. The
 * handler receives the files and the drop point in sheet coordinates and returns true when it
 * takes the drop.
 */
export const canvasFileDrop: { current: ((files: File[], at: { x: number; y: number }) => boolean) | null } = { current: null };

let focusCanvasImpl: () => void = () => undefined;

/** Registered by the mounted canvas: moves keyboard focus to the schematic. */
export function setCanvasFocusHandler(fn: (() => void) | null): void {
  focusCanvasImpl = fn ?? (() => undefined);
}

/** Give the schematic canvas keyboard focus (e.g. after picking a part in the browser). */
export function focusCanvas(): void {
  focusCanvasImpl();
}
