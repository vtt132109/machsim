/**
 * Application-wide editor store (singleton) and React bindings.
 *
 *   import { getState, subscribe, actions, useEditor } from '../store';
 *   const sheet = useEditor((s) => activeSheet(s));   // selector must return stable references
 *
 * See editorStore.ts for the action list and types.ts for the state shape.
 */
import { useSyncExternalStore } from 'react';
import { createEditor } from './editorStore';
import type { EditorState } from './types';

export const editor = createEditor();

export const getState = editor.getState;
export const subscribe = editor.subscribe;
export const actions = editor.actions;
export const partLookup = editor.lookup;

/**
 * Subscribe a component to a slice of editor state. The selector must return a value that is
 * referentially stable while the underlying state is unchanged (pick existing objects or
 * primitives; derive new objects with useMemo in the component).
 */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(
    editor.subscribe,
    () => selector(editor.getState()),
    () => selector(editor.getState()),
  );
}

export * from './types';
export {
  activeSheet,
  createEditor,
  initialEditorState,
  isDirty,
  isSelected,
  pruneSelection,
  viewOf,
  HISTORY_LIMIT,
  NUDGE_COALESCE_MS,
  type CommitOptions,
  type Editor,
  type EditorActions,
  type EditorOptions,
  type InteractiveListener,
} from './editorStore';
export * as designOps from './designOps';
export { computeConnectivity, type Connectivity, type EditorNet } from './connectivity';
export { hitTest, itemsInRect, nearestPin, nearestWire, wireAtPoint, type HitResult, type HitOptions } from './hitTest';
export { junctionPoints, normalizeWires, pointKey, splitWireAt } from './wireOps';
export { draftPoints, routeL, rubberBandPoints, simplifyPoints, pinStubHorizontal, snapToGrid } from './routing';
export { nextInteractiveValue, interactiveKeyMatches, type InteractionPhase } from './interactive';
export * from './viewport';
export * from './shapes';
export { collectRefdes, nextRefdes, refdesPrefix, validateRefdes } from './refdes';
export { newId } from './ids';
export { cursorStore, setCursor, showStatusNotice, statusNotice, type CursorInfo } from './cursor';
export { createStore, type Store } from './createStore';
