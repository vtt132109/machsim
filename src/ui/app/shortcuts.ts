/**
 * Keyboard shortcut table of the application shell (pure).
 *
 * One table drives the key handler ({@link resolveShortcut}), the shortcut hints in the menus
 * ({@link shortcutLabel}) and the Help > Keyboard shortcuts list ({@link SHORTCUT_HELP}).
 *
 * Scopes
 *  - 'any'    : works everywhere, even while typing in a text field (Save, Run ...)
 *  - 'app'    : everywhere except text fields (Undo, Copy ...)
 *  - 'canvas' : only while the schematic (or nothing in particular) has focus — single letters,
 *               Delete, arrows — so they never interfere with lists, trees or fields
 *
 * Precedence on the canvas (implemented by the shell): the active tool's own keys (Esc, R/X/Y
 * while placing, '/' and Backspace while drawing a wire) → keys of interactive parts in the
 * design (switch / potentiometer keys) → this table.
 */
import type { ToolState } from '../store/types';
import type { MessageKey } from '../../i18n';

export interface KeyChord {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutContext {
  tool: ToolState['kind'];
  hasSelection: boolean;
  /** focus is in an editable field */
  inField: boolean;
  /** focus is on the canvas or on no particular control */
  canvasScope: boolean;
}

export type Scope = 'any' | 'app' | 'canvas';

export interface Binding {
  id: string;
  key: string;
  ctrl?: boolean;
  /** true / false / 'any' (default false) */
  shift?: boolean | 'any';
  alt?: boolean;
  scope: Scope;
  /** extra condition */
  when?: (ctx: ShortcutContext) => boolean;
  /** text shown in menus / help (default derived from the chord) */
  label?: string;
  /** hidden duplicates are not listed in help / menus */
  alias?: boolean;
}

const selecting = (c: ShortcutContext) => c.tool === 'select' && c.hasSelection;
const notPlacing = (c: ShortcutContext) => c.tool !== 'place';

const BINDINGS: Binding[] = [
  // file
  { id: 'file.new', key: 'n', ctrl: true, scope: 'any' },
  { id: 'file.open', key: 'o', ctrl: true, scope: 'any' },
  { id: 'file.save', key: 's', ctrl: true, scope: 'any' },
  { id: 'file.saveAs', key: 's', ctrl: true, shift: true, scope: 'any' },
  { id: 'file.print', key: 'p', ctrl: true, scope: 'any' },
  // several designs open at once (document tabs)
  { id: 'file.close', key: 'F4', ctrl: true, scope: 'any' },
  { id: 'file.close', key: 'w', ctrl: true, scope: 'any', alias: true },
  { id: 'window.next', key: 'Tab', ctrl: true, scope: 'any' },
  { id: 'window.previous', key: 'Tab', ctrl: true, shift: true, scope: 'any' },
  // edit
  { id: 'edit.undo', key: 'z', ctrl: true, scope: 'app' },
  { id: 'edit.redo', key: 'y', ctrl: true, scope: 'app' },
  { id: 'edit.redo', key: 'z', ctrl: true, shift: true, scope: 'app', alias: true },
  { id: 'edit.cut', key: 'x', ctrl: true, scope: 'app' },
  { id: 'edit.copy', key: 'c', ctrl: true, scope: 'app' },
  { id: 'edit.paste', key: 'v', ctrl: true, scope: 'app' },
  { id: 'edit.duplicate', key: 'd', ctrl: true, scope: 'app' },
  { id: 'edit.selectAll', key: 'a', ctrl: true, scope: 'app' },
  { id: 'edit.delete', key: 'Delete', scope: 'canvas', label: 'Del' },
  { id: 'edit.delete', key: 'Backspace', scope: 'canvas', alias: true },
  { id: 'edit.find', key: 'f', ctrl: true, scope: 'any' },
  { id: 'edit.rotateCw', key: 'r', ctrl: true, scope: 'app', when: notPlacing },
  { id: 'edit.rotateCcw', key: 'r', ctrl: true, shift: true, scope: 'app', when: notPlacing },
  { id: 'edit.rotateCw', key: 'r', scope: 'canvas', when: selecting, alias: true },
  { id: 'edit.rotateCcw', key: 'r', shift: true, scope: 'canvas', when: selecting, alias: true },
  { id: 'edit.flipH', key: 'x', alt: true, scope: 'app', when: notPlacing },
  { id: 'edit.flipV', key: 'y', alt: true, scope: 'app', when: notPlacing },
  { id: 'edit.flipH', key: 'x', scope: 'canvas', when: selecting, alias: true },
  { id: 'edit.flipV', key: 'y', scope: 'canvas', when: selecting, alias: true },
  { id: 'edit.properties', key: 'Enter', alt: true, scope: 'app' },
  { id: 'edit.properties', key: 'Enter', scope: 'canvas', when: selecting, alias: true },
  // view
  { id: 'view.zoomIn', key: '=', ctrl: true, shift: 'any', scope: 'app', label: 'Ctrl++' },
  { id: 'view.zoomIn', key: '+', ctrl: true, shift: 'any', scope: 'app', alias: true },
  { id: 'view.zoomIn', key: '+', shift: 'any', scope: 'canvas', alias: true },
  { id: 'view.zoomIn', key: '=', scope: 'canvas', alias: true },
  { id: 'view.zoomOut', key: '-', ctrl: true, scope: 'app', label: 'Ctrl+−' },
  { id: 'view.zoomOut', key: '-', scope: 'canvas', alias: true },
  { id: 'view.fitAll', key: '0', ctrl: true, scope: 'app' },
  { id: 'view.fitAll', key: 'f', scope: 'canvas', alias: true },
  { id: 'view.fitSelection', key: 'f', shift: true, scope: 'canvas' },
  { id: 'view.grid', key: 'g', scope: 'canvas' },
  { id: 'view.nextSheet', key: 'PageDown', alt: true, scope: 'app' },
  { id: 'view.prevSheet', key: 'PageUp', alt: true, scope: 'app' },
  // place
  { id: 'place.component', key: 'k', ctrl: true, scope: 'any' },
  { id: 'place.wire', key: 'w', scope: 'canvas' },
  { id: 'place.label', key: 'l', scope: 'canvas' },
  { id: 'place.text', key: 't', scope: 'canvas' },
  { id: 'place.probe.voltage', key: 'p', scope: 'canvas' },
  { id: 'place.bus', key: 'b', scope: 'canvas' },
  { id: 'edit.findReplace', key: 'h', ctrl: true, scope: 'app' },
  // simulate
  { id: 'simulate.run', key: 'F5', scope: 'any' },
  { id: 'simulate.pause', key: 'F6', scope: 'any' },
  { id: 'simulate.stop', key: 'F5', shift: true, scope: 'any' },
  // help: F1 explains the selection (or opens the help index), Ctrl+/ lists the shortcuts
  { id: 'help.context', key: 'F1', scope: 'any' },
  { id: 'help.shortcuts', key: '/', ctrl: true, shift: 'any', scope: 'any' },
];

/** The built-in table (read-only): the shortcuts a fresh installation has. */
export const DEFAULT_BINDINGS: readonly Binding[] = BINDINGS;

/**
 * The learner's own shortcuts (Options › Customize user interface, src/ui/app/customize.ts).
 * Installed once at start-up from the preferences and whenever the dialog applies a change; an
 * empty table means "use the defaults only".
 */
let userBindings: readonly Binding[] = [];
/** Command ids whose built-in shortcuts the learner switched off. */
let userCleared: ReadonlySet<string> = new Set();

/** Replace the user shortcut layer (does not touch the built-in table). */
export function setUserBindings(bindings: readonly Binding[], cleared: Iterable<string> = []): void {
  userBindings = bindings;
  userCleared = new Set(cleared);
}

/** The table the key handler uses: the user's bindings first, then the built-in ones. */
export function activeBindings(): readonly Binding[] {
  if (!userBindings.length && !userCleared.size) return BINDINGS;
  return [...userBindings, ...BINDINGS.filter((b) => !userCleared.has(b.id) && !userBindings.some((u) => u.id === b.id))];
}

/** Canonical key text: single characters lower-cased, named keys unchanged. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function matches(b: Binding, k: KeyChord): boolean {
  if (normalizeKey(k.key) !== normalizeKey(b.key)) return false;
  if (!!k.ctrl !== !!b.ctrl || !!k.alt !== !!b.alt) return false;
  if (b.shift === 'any') return true;
  return !!k.shift === !!b.shift;
}

function inScope(scope: Scope, ctx: ShortcutContext): boolean {
  switch (scope) {
    case 'any':
      return true;
    case 'app':
      return !ctx.inField;
    case 'canvas':
      return !ctx.inField && ctx.canvasScope;
  }
}

/** Command id bound to a key chord in the given context, or null. */
export function resolveShortcut(k: KeyChord, ctx: ShortcutContext): string | null {
  for (const b of activeBindings()) {
    if (matches(b, k) && inScope(b.scope, ctx) && (!b.when || b.when(ctx))) return b.id;
  }
  return null;
}

export const KEY_NAMES: Record<string, string> = { Delete: 'Del', Backspace: 'Backspace', PageDown: 'PgDn', PageUp: 'PgUp', Enter: 'Enter' };

export function chordText(b: Binding): string {
  if (b.label) return b.label;
  const parts: string[] = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.alt) parts.push('Alt');
  if (b.shift === true) parts.push('Shift');
  parts.push(KEY_NAMES[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key));
  return parts.join('+');
}

/** Primary shortcut text of a command for menus ("Ctrl+Shift+S"), or undefined. */
export function shortcutLabel(id: string): string | undefined {
  const b = activeBindings().find((x) => x.id === id && !x.alias);
  return b ? chordText(b) : undefined;
}

/** Every shortcut of a command, primary first (help dialog). */
export function shortcutLabels(id: string): string[] {
  const out: string[] = [];
  for (const b of activeBindings()) if (b.id === id) out.push(chordText(b));
  return Array.from(new Set(out));
}

/** Rows of the Help > Keyboard shortcuts sheet: key text and the catalogue key of its explanation. */
export interface ShortcutHelpRow {
  keys: string;
  action: MessageKey;
}

export interface ShortcutHelpSection {
  section: MessageKey;
  rows: ShortcutHelpRow[];
}

/** The keyboard-shortcut sheet (texts are catalogue keys: resolve them with t() when rendering). */
export const SHORTCUT_HELP: ShortcutHelpSection[] = [
  {
    section: 'keys.section.file',
    rows: [
      { keys: 'Ctrl+N', action: 'keys.file.new' },
      { keys: 'Ctrl+O', action: 'keys.file.open' },
      { keys: 'Ctrl+S / Ctrl+Shift+S', action: 'keys.file.save' },
      { keys: 'Ctrl+P', action: 'keys.file.print' },
    ],
  },
  {
    section: 'keys.section.edit',
    rows: [
      { keys: 'Ctrl+Z / Ctrl+Y', action: 'keys.edit.undo' },
      { keys: 'Ctrl+X / Ctrl+C / Ctrl+V', action: 'keys.edit.clipboard' },
      { keys: 'Ctrl+D', action: 'keys.edit.duplicate' },
      { keys: 'Ctrl+A', action: 'keys.edit.selectAll' },
      { keys: 'Del / Backspace', action: 'keys.edit.delete' },
      { keys: '← ↑ → ↓', action: 'keys.edit.nudge' },
      { keys: 'Ctrl+R / Ctrl+Shift+R (R / Shift+R)', action: 'keys.edit.rotate' },
      { keys: 'Alt+X / Alt+Y (X / Y)', action: 'keys.edit.flip' },
      { keys: 'Enter / Alt+Enter', action: 'keys.edit.properties' },
      { keys: 'Ctrl+F', action: 'keys.edit.find' },
      { keys: 'Shift+🖱 / Ctrl+🖱', action: 'keys.edit.addToSelection' },
      { keys: '🖱 → / 🖱 ←', action: 'keys.edit.boxSelect' },
    ],
  },
  {
    section: 'keys.section.place',
    rows: [
      { keys: 'Ctrl+K', action: 'keys.place.search' },
      { keys: 'R / Ctrl+R, Shift+R', action: 'keys.place.rotate' },
      { keys: 'X / Y', action: 'keys.place.mirror' },
      { keys: 'W', action: 'keys.place.wire' },
      { keys: 'L / T / P', action: 'keys.place.tools' },
      { keys: 'B', action: 'keys.place.bus' },
      { keys: 'Ctrl+H', action: 'keys.edit.findReplace' },
      { keys: 'Esc', action: 'keys.place.escape' },
    ],
  },
  {
    section: 'keys.section.view',
    rows: [
      { keys: '🖱', action: 'keys.view.wheel' },
      { keys: '🖱 / Space + 🖱', action: 'keys.view.pan' },
      { keys: 'Ctrl++ / Ctrl+− (+ / −)', action: 'keys.view.zoom' },
      { keys: 'F, Ctrl+0 / Shift+F', action: 'keys.view.fit' },
      { keys: 'G', action: 'keys.view.grid' },
      { keys: 'Alt+PgDn / Alt+PgUp', action: 'keys.view.sheets' },
    ],
  },
  {
    section: 'keys.section.simulate',
    rows: [
      { keys: 'F5 / F6 / Shift+F5', action: 'keys.sim.run' },
      { keys: 'Space, A …', action: 'keys.sim.partKeys' },
      { keys: '🖱', action: 'keys.sim.click' },
    ],
  },
  {
    section: 'keys.section.help',
    rows: [
      { keys: 'F1', action: 'keys.help.context' },
      { keys: 'Ctrl+/', action: 'keys.help.shortcuts' },
      { keys: 'F10 / Alt', action: 'keys.help.menu' },
    ],
  },
];
