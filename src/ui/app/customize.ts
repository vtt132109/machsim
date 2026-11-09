/**
 * Customizing the user interface (pure): the learner's own keyboard shortcuts and which toolbar
 * groups are shown (Options › Customize user interface).
 *
 * A shortcut is written the way it is shown: "Ctrl+S", "Shift+F5", "Alt+Enter", "Del", "G". The
 * dialog stores one chord per command — the whole table is `UserShortcuts`:
 *
 *   { "edit.delete": "Ctrl+Del", "view.grid": "" }
 *
 * An entry with a chord replaces the built-in shortcuts of that command; an empty entry switches
 * them off. Commands that are not listed keep what they always had, so a preferences file written
 * by an older version keeps working and a reset is simply an empty table.
 *
 *   parseChord(text)                 "Ctrl+Shift+S" -> { key: 's', ctrl: true, shift: true }
 *   formatChord(chord)               the canonical text again
 *   chordKey(chord)                  comparison key ("ctrl+shift+s")
 *   shortcutRows(user)               one row per command: its chord, where it comes from, conflicts
 *   shortcutConflicts(user)          chords used by more than one command in the same scope
 *   applyUserShortcuts(user)         install the table in src/ui/app/shortcuts.ts
 *   TOOLBAR_GROUPS / toolbarVisible  which groups of the main toolbar are shown
 */
import { DEFAULT_BINDINGS, KEY_NAMES, chordText, normalizeKey, setUserBindings, type Binding, type KeyChord, type Scope } from './shortcuts';

/** The learner's table: command id -> chord text ('' switches the built-in shortcut off). */
export type UserShortcuts = Record<string, string>;

/** Modifier-less keys that may be used alone without stealing typing (named keys and F-keys). */
const NAMED_KEYS = ['Delete', 'Backspace', 'Enter', 'Escape', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

const ALIASES: Record<string, string> = {
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  ins: 'Insert',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
  tab: 'Tab',
  space: 'Space',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/** Read a chord written as the UI shows it; null when it cannot be read. */
export function parseChord(text: string): KeyChord | null {
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (!parts.length) return null;
  const chord: KeyChord = { key: '' };
  // every part but the last one is a modifier; the last part is the key
  for (const part of parts.slice(0, -1)) {
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control') chord.ctrl = true;
    else if (low === 'shift') chord.shift = true;
    else if (low === 'alt') chord.alt = true;
    else return null;
  }
  const keyText = parts[parts.length - 1];
  const low = keyText.toLowerCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(keyText)) chord.key = keyText.toUpperCase();
  else if (ALIASES[low]) chord.key = ALIASES[low];
  else if (NAMED_KEYS.some((k) => k.toLowerCase() === low)) chord.key = NAMED_KEYS.find((k) => k.toLowerCase() === low)!;
  else if (keyText.length === 1) chord.key = normalizeKey(keyText);
  else return null;
  return chord;
}

/** The canonical text of a chord ("Ctrl+Shift+S"). */
export function formatChord(chord: KeyChord): string {
  const out: string[] = [];
  if (chord.ctrl) out.push('Ctrl');
  if (chord.alt) out.push('Alt');
  if (chord.shift) out.push('Shift');
  out.push(KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return out.join('+');
}

/** Comparison key of a chord (two texts of the same chord give the same key). */
export function chordKey(chord: KeyChord): string {
  return [chord.ctrl ? 'ctrl' : '', chord.alt ? 'alt' : '', chord.shift ? 'shift' : '', normalizeKey(chord.key)].filter(Boolean).join('+');
}

/** Why a chord cannot be used. */
export type ChordProblem = 'unreadable' | 'bareLetter' | 'reserved';

/** 'ok' or the reason a chord is refused ('' means "no shortcut", which is always allowed). */
export function checkChord(text: string): 'ok' | ChordProblem {
  if (text.trim() === '') return 'ok';
  const chord = parseChord(text);
  if (!chord) return 'unreadable';
  // a letter or digit on its own would fire while typing in a field, so it needs a modifier;
  // function keys and named keys (Del, Enter …) are fine on their own
  const bare = !chord.ctrl && !chord.alt;
  if (bare && chord.key.length === 1) return 'bareLetter';
  // Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z must stay what every program does
  if (RESERVED.includes(chordKey(chord))) return 'reserved';
  return 'ok';
}

/** Chords a learner may not take over (the clipboard and undo keys of every program). */
export const RESERVED = ['ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+a', 'ctrl+z'];

/** The built-in chords of a command, primary first. */
export function defaultChords(id: string): string[] {
  return DEFAULT_BINDINGS.filter((b) => b.id === id).map((b) => chordText(b));
}

/**
 * Every command the dialog can rebind: the ones the built-in table binds (with their scope),
 * followed by `extra` — commands that have no shortcut yet (the dialog passes the registered
 * command ids, so a learner can give any menu command a key). Extra commands get the 'app' scope:
 * they work everywhere except inside a text field.
 */
export function customizableCommands(extra: readonly string[] = []): { id: string; scope: Scope }[] {
  const out: { id: string; scope: Scope }[] = [];
  for (const b of DEFAULT_BINDINGS) if (!out.some((x) => x.id === b.id)) out.push({ id: b.id, scope: b.scope });
  for (const id of extra) if (!out.some((x) => x.id === id)) out.push({ id, scope: 'app' });
  return out;
}

export interface ShortcutRow {
  id: string;
  /** the chord in use ('' = the command has no shortcut) */
  chord: string;
  /** the built-in chord, for the "reset" button */
  original: string;
  /** 'default' = unchanged, 'user' = rebound, 'off' = the built-in shortcut was switched off */
  source: 'default' | 'user' | 'off';
  scope: Scope;
  /** ids of the other commands that use the same chord in a scope that overlaps */
  conflicts: string[];
  /** why the chord cannot be used ('ok' when it can) */
  problem: 'ok' | ChordProblem;
}

/** Scopes overlap when a key pressed on the canvas could reach both. */
function scopesOverlap(a: Scope, b: Scope): boolean {
  if (a === b) return true;
  // 'any' works everywhere, so it overlaps both others; 'app' includes the canvas
  return a === 'any' || b === 'any' || a === 'app' || b === 'app';
}

/** One row per command: the chord in use, where it comes from and which commands clash with it. */
export function shortcutRows(user: UserShortcuts = {}, extra: readonly string[] = []): ShortcutRow[] {
  const rows: ShortcutRow[] = customizableCommands([...extra, ...Object.keys(user)]).map(({ id, scope }) => {
    const original = defaultChords(id)[0] ?? '';
    const custom = user[id];
    const chord = custom === undefined ? original : custom.trim();
    const source = custom === undefined ? 'default' : chord === '' ? 'off' : 'user';
    return { id, chord, original, source, scope, conflicts: [], problem: custom === undefined ? 'ok' : checkChord(custom) };
  });
  const byChord = new Map<string, ShortcutRow[]>();
  for (const r of rows) {
    if (!r.chord) continue;
    const chord = parseChord(r.chord);
    if (!chord) continue;
    const k = chordKey(chord);
    if (!byChord.has(k)) byChord.set(k, []);
    byChord.get(k)!.push(r);
  }
  for (const group of byChord.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.conflicts = group.filter((o) => o !== r && scopesOverlap(r.scope, o.scope)).map((o) => o.id);
  }
  return rows;
}

export interface ShortcutConflict {
  chord: string;
  /** the commands that share it */
  ids: string[];
}

/** The chords more than one command would answer to. */
export function shortcutConflicts(user: UserShortcuts = {}, extra: readonly string[] = []): ShortcutConflict[] {
  const out = new Map<string, Set<string>>();
  for (const r of shortcutRows(user, extra)) {
    if (!r.conflicts.length) continue;
    const k = r.chord;
    if (!out.has(k)) out.set(k, new Set());
    out.get(k)!.add(r.id);
    for (const id of r.conflicts) out.get(k)!.add(id);
  }
  return [...out.entries()].map(([chord, ids]) => ({ chord, ids: [...ids].sort() })).sort((a, b) => a.chord.localeCompare(b.chord));
}

/** Keep only the entries that change something and can be used (what the dialog saves). */
export function cleanUserShortcuts(user: UserShortcuts, extra: readonly string[] = []): UserShortcuts {
  const out: UserShortcuts = {};
  const known = new Set(customizableCommands(extra).map((c) => c.id));
  for (const [id, text] of Object.entries(user)) {
    if (!known.has(id)) continue;
    const chord = text.trim();
    if (chord !== '' && checkChord(chord) !== 'ok') continue;
    const canon = chord === '' ? '' : formatChord(parseChord(chord)!);
    if (canon === (defaultChords(id)[0] ?? '')) continue;
    out[id] = canon;
  }
  return out;
}

/** Install the table in the key handler (src/ui/app/shortcuts.ts). */
export function applyUserShortcuts(user: UserShortcuts, extra: readonly string[] = []): void {
  const bindings: Binding[] = [];
  const cleared: string[] = [];
  const commands = customizableCommands(extra);
  for (const [id, text] of Object.entries(cleanUserShortcuts(user, extra))) {
    const scope = commands.find((c) => c.id === id)?.scope ?? 'app';
    if (text === '') {
      cleared.push(id);
      continue;
    }
    const chord = parseChord(text);
    if (!chord) continue;
    cleared.push(id);
    bindings.push({ id, key: chord.key, scope, ...(chord.ctrl ? { ctrl: true } : {}), ...(chord.alt ? { alt: true } : {}), shift: chord.shift === true });
  }
  setUserBindings(bindings, cleared);
}

// ---------------------------------------------------------------------------------------------
// toolbar groups
// ---------------------------------------------------------------------------------------------

/** The groups of the main toolbar, in the order they are drawn. */
export const TOOLBAR_GROUPS = ['file', 'history', 'clipboard', 'tools', 'transform', 'zoom', 'view', 'simulate'] as const;
export type ToolbarGroup = (typeof TOOLBAR_GROUPS)[number];

/** Which toolbar groups are shown; a missing entry means "shown". */
export type ToolbarPrefs = Partial<Record<ToolbarGroup, boolean>>;

export function toolbarVisible(prefs: ToolbarPrefs | undefined, group: ToolbarGroup): boolean {
  return prefs?.[group] !== false;
}

/** Keep only the well-formed entries of a stored toolbar table. */
export function cleanToolbarPrefs(raw: unknown): ToolbarPrefs {
  const out: ToolbarPrefs = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const g of TOOLBAR_GROUPS) {
    const v = (raw as Record<string, unknown>)[g];
    if (typeof v === 'boolean' && !v) out[g] = false;
  }
  return out;
}
