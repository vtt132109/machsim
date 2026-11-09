import { afterEach, describe, expect, it } from 'vitest';
import {
  applyUserShortcuts,
  checkChord,
  chordKey,
  cleanToolbarPrefs,
  cleanUserShortcuts,
  customizableCommands,
  defaultChords,
  formatChord,
  parseChord,
  RESERVED,
  shortcutConflicts,
  shortcutRows,
  TOOLBAR_GROUPS,
  toolbarVisible,
} from './customize';
import { resolveShortcut, setUserBindings, shortcutLabel, type ShortcutContext } from './shortcuts';

const ctx = (over: Partial<ShortcutContext> = {}): ShortcutContext => ({ tool: 'select', hasSelection: false, inField: false, canvasScope: true, ...over });

afterEach(() => setUserBindings([], []));

describe('chord text', () => {
  it('reads the forms the UI shows', () => {
    expect(parseChord('Ctrl+S')).toEqual({ key: 's', ctrl: true });
    expect(parseChord('ctrl+shift+s')).toEqual({ key: 's', ctrl: true, shift: true });
    expect(parseChord('Alt+Enter')).toEqual({ key: 'Enter', alt: true });
    expect(parseChord('F5')).toEqual({ key: 'F5' });
    expect(parseChord('Shift+F5')).toEqual({ key: 'F5', shift: true });
    expect(parseChord('Del')).toEqual({ key: 'Delete' });
    expect(parseChord('PgDn')).toEqual({ key: 'PageDown' });
    expect(parseChord('g')).toEqual({ key: 'g' });
    expect(parseChord(' Ctrl + K ')).toEqual({ key: 'k', ctrl: true });
  });

  it('refuses a chord that is only a modifier', () => {
    expect(parseChord('Shift')).toBeNull();
    expect(parseChord('Ctrl+Alt')).toBeNull();
  });

  it('refuses nonsense', () => {
    expect(parseChord('')).toBeNull();
    expect(parseChord('+')).toBeNull();
    expect(parseChord('Ctrl+')).toBeNull();
    expect(parseChord('Ctrl+A+B')).toBeNull();
    expect(parseChord('Ctrl+Nope')).toBeNull();
  });

  it('writes the canonical text back', () => {
    expect(formatChord(parseChord('ctrl+shift+s')!)).toBe('Ctrl+Shift+S');
    expect(formatChord(parseChord('alt+enter')!)).toBe('Alt+Enter');
    expect(formatChord(parseChord('del')!)).toBe('Del');
    expect(formatChord(parseChord('F6')!)).toBe('F6');
  });

  it('compares two spellings of one chord', () => {
    expect(chordKey(parseChord('Ctrl+Shift+S')!)).toBe(chordKey(parseChord('shift+ctrl+s')!));
    expect(chordKey(parseChord('Ctrl+S')!)).not.toBe(chordKey(parseChord('Ctrl+Shift+S')!));
  });
});

describe('which chords may be used', () => {
  it('accepts an empty entry (no shortcut) and a modified key', () => {
    expect(checkChord('')).toBe('ok');
    expect(checkChord('Ctrl+Q')).toBe('ok');
    expect(checkChord('Alt+G')).toBe('ok');
    expect(checkChord('F9')).toBe('ok');
    expect(checkChord('Shift+F9')).toBe('ok');
    expect(checkChord('Del')).toBe('ok');
  });

  it('refuses a bare letter or digit (it would fire while typing)', () => {
    expect(checkChord('Q')).toBe('bareLetter');
    expect(checkChord('Shift+Q')).toBe('bareLetter');
    expect(checkChord('7')).toBe('bareLetter');
  });

  it('refuses the clipboard and undo keys', () => {
    for (const k of RESERVED) expect(checkChord(k.replace('ctrl+', 'Ctrl+').toUpperCase().replace('CTRL+', 'Ctrl+'))).toBe('reserved');
    expect(checkChord('Ctrl+C')).toBe('reserved');
  });

  it('refuses text it cannot read', () => {
    expect(checkChord('Ctrl+Nope')).toBe('unreadable');
  });
});

describe('the shortcut table of the dialog', () => {
  it('lists every command of the built-in table once, with its chord', () => {
    const rows = shortcutRows();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(customizableCommands().map((c) => c.id));
    const save = rows.find((r) => r.id === 'file.save')!;
    expect(save.chord).toBe('Ctrl+S');
    expect(save.source).toBe('default');
    expect(save.conflicts).toEqual([]);
    expect(defaultChords('edit.delete')).toEqual(['Del', 'Backspace']);
  });

  it('shows a rebound and a switched-off command', () => {
    const rows = shortcutRows({ 'view.grid': 'Ctrl+G', 'view.fitAll': '' });
    expect(rows.find((r) => r.id === 'view.grid')).toMatchObject({ chord: 'Ctrl+G', source: 'user', original: 'G', problem: 'ok' });
    expect(rows.find((r) => r.id === 'view.fitAll')).toMatchObject({ chord: '', source: 'off' });
  });

  it('marks a bad chord without losing the row', () => {
    const rows = shortcutRows({ 'view.grid': 'Ctrl+C' });
    expect(rows.find((r) => r.id === 'view.grid')).toMatchObject({ problem: 'reserved' });
  });
});

describe('conflict detection', () => {
  it('finds two commands that would answer to one chord', () => {
    const conflicts = shortcutConflicts({ 'view.grid': 'Ctrl+P' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].chord).toBe('Ctrl+P');
    expect(conflicts[0].ids).toEqual(['file.print', 'view.grid']);
    const rows = shortcutRows({ 'view.grid': 'Ctrl+P' });
    expect(rows.find((r) => r.id === 'view.grid')!.conflicts).toEqual(['file.print']);
    expect(rows.find((r) => r.id === 'file.print')!.conflicts).toEqual(['view.grid']);
  });

  it('sees no conflict when a command keeps its own built-in chord', () => {
    expect(shortcutConflicts({ 'file.print': 'Ctrl+P' })).toEqual([]);
  });

  it('sees no conflict once the other command is moved away', () => {
    expect(shortcutConflicts({ 'view.grid': 'Ctrl+P', 'file.print': 'Ctrl+Shift+P' })).toEqual([]);
  });

  it('counts a chord that is free as free', () => {
    expect(shortcutConflicts({ 'view.grid': 'Ctrl+Alt+G' })).toEqual([]);
    expect(shortcutConflicts()).toEqual([]);
  });

  it('reports every command sharing one chord', () => {
    const conflicts = shortcutConflicts({ 'view.grid': 'Ctrl+Q', 'place.wire': 'Ctrl+Q', 'view.fitAll': 'Ctrl+Q' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ids).toEqual(['place.wire', 'view.fitAll', 'view.grid']);
  });

  it('ignores a switched-off command', () => {
    expect(shortcutConflicts({ 'view.grid': '', 'view.zoom100': '' })).toEqual([]);
  });
});

describe('saving and installing', () => {
  it('drops entries that change nothing, are unknown or cannot be used', () => {
    expect(cleanUserShortcuts({ 'file.save': 'Ctrl+S' })).toEqual({});
    expect(cleanUserShortcuts({ 'not.a.command': 'Ctrl+Q' })).toEqual({});
    // a command with no built-in shortcut can be given one when the dialog lists it
    expect(cleanUserShortcuts({ 'tools.erc': 'Ctrl+Alt+E' }, ['tools.erc'])).toEqual({ 'tools.erc': 'Ctrl+Alt+E' });
    expect(cleanUserShortcuts({ 'view.grid': 'Ctrl+C' })).toEqual({});
    expect(cleanUserShortcuts({ 'view.grid': 'ctrl+alt+g' })).toEqual({ 'view.grid': 'Ctrl+Alt+G' });
    expect(cleanUserShortcuts({ 'view.grid': '' })).toEqual({ 'view.grid': '' });
  });

  it('makes the key handler answer to the new chord and forget the old one', () => {
    expect(resolveShortcut({ key: 'g' }, ctx())).toBe('view.grid');
    applyUserShortcuts({ 'view.grid': 'Ctrl+Alt+G' });
    expect(resolveShortcut({ key: 'g' }, ctx())).toBeNull();
    expect(resolveShortcut({ key: 'g', ctrl: true, alt: true }, ctx())).toBe('view.grid');
    expect(shortcutLabel('view.grid')).toBe('Ctrl+Alt+G');
    // other commands are untouched
    expect(resolveShortcut({ key: 's', ctrl: true }, ctx())).toBe('file.save');
  });

  it('gives a command that had no shortcut one', () => {
    expect(resolveShortcut({ key: 'e', ctrl: true, alt: true }, ctx())).toBeNull();
    applyUserShortcuts({ 'tools.erc': 'Ctrl+Alt+E' }, ['tools.erc']);
    expect(resolveShortcut({ key: 'e', ctrl: true, alt: true }, ctx())).toBe('tools.erc');
  });

  it('switches a shortcut off', () => {
    applyUserShortcuts({ 'view.grid': '' });
    expect(resolveShortcut({ key: 'g' }, ctx())).toBeNull();
    expect(shortcutLabel('view.grid')).toBeUndefined();
  });

  it('comes back to the built-in table on reset', () => {
    applyUserShortcuts({ 'view.grid': 'Ctrl+Alt+G' });
    applyUserShortcuts({});
    expect(resolveShortcut({ key: 'g' }, ctx())).toBe('view.grid');
    expect(shortcutLabel('view.grid')).toBe('G');
  });

  it('keeps the scope of the command it rebinds', () => {
    // view.grid is a canvas shortcut: it must not fire while typing in a field
    applyUserShortcuts({ 'view.grid': 'Ctrl+Alt+G' });
    expect(resolveShortcut({ key: 'g', ctrl: true, alt: true }, ctx({ inField: true }))).toBeNull();
    // file.save works everywhere
    applyUserShortcuts({ 'file.save': 'Ctrl+Alt+S' });
    expect(resolveShortcut({ key: 's', ctrl: true, alt: true }, ctx({ inField: true }))).toBe('file.save');
  });
});

describe('toolbar groups', () => {
  it('shows every group unless it is switched off', () => {
    expect(TOOLBAR_GROUPS.length).toBeGreaterThan(4);
    for (const g of TOOLBAR_GROUPS) expect(toolbarVisible(undefined, g)).toBe(true);
    expect(toolbarVisible({ zoom: false }, 'zoom')).toBe(false);
    expect(toolbarVisible({ zoom: false }, 'file')).toBe(true);
  });

  it('keeps only the hidden groups of a stored table', () => {
    expect(cleanToolbarPrefs({ zoom: false, file: true, nonsense: false, other: 'x' })).toEqual({ zoom: false });
    expect(cleanToolbarPrefs(null)).toEqual({});
    expect(cleanToolbarPrefs('x')).toEqual({});
  });
});
