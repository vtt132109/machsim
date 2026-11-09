import { describe, expect, it } from 'vitest';
import { normalizeKey, resolveShortcut, shortcutLabel, shortcutLabels, type ShortcutContext } from './shortcuts';

const canvas: ShortcutContext = { tool: 'select', hasSelection: false, inField: false, canvasScope: true };
const selected: ShortcutContext = { ...canvas, hasSelection: true };
const field: ShortcutContext = { ...canvas, inField: true, canvasScope: false };
const panel: ShortcutContext = { ...canvas, canvasScope: false };

describe('resolveShortcut', () => {
  it('maps Ctrl chords regardless of letter case', () => {
    expect(resolveShortcut({ key: 's', ctrl: true }, canvas)).toBe('file.save');
    expect(resolveShortcut({ key: 'S', ctrl: true, shift: true }, canvas)).toBe('file.saveAs');
    expect(resolveShortcut({ key: 'z', ctrl: true }, canvas)).toBe('edit.undo');
    expect(resolveShortcut({ key: 'Z', ctrl: true, shift: true }, canvas)).toBe('edit.redo');
    expect(resolveShortcut({ key: 'y', ctrl: true }, canvas)).toBe('edit.redo');
    expect(resolveShortcut({ key: 'q', ctrl: true }, canvas)).toBeNull();
  });
  it('keeps text-editing chords for fields but lets Save / Run through', () => {
    expect(resolveShortcut({ key: 'z', ctrl: true }, field)).toBeNull();
    expect(resolveShortcut({ key: 'c', ctrl: true }, field)).toBeNull();
    expect(resolveShortcut({ key: 'a', ctrl: true }, field)).toBeNull();
    expect(resolveShortcut({ key: 's', ctrl: true }, field)).toBe('file.save');
    expect(resolveShortcut({ key: 'F5' }, field)).toBe('simulate.run');
    expect(resolveShortcut({ key: 'F5', shift: true }, field)).toBe('simulate.stop');
  });
  it('limits single letters and Delete to the canvas scope', () => {
    expect(resolveShortcut({ key: 'w' }, canvas)).toBe('place.wire');
    expect(resolveShortcut({ key: 'w' }, panel)).toBeNull();
    expect(resolveShortcut({ key: 'Delete' }, canvas)).toBe('edit.delete');
    expect(resolveShortcut({ key: 'Delete' }, panel)).toBeNull();
    expect(resolveShortcut({ key: 'g' }, field)).toBeNull();
    // Ctrl chords still work while a panel has focus
    expect(resolveShortcut({ key: 'c', ctrl: true }, panel)).toBe('edit.copy');
  });
  it('uses plain R / X / Y only with a selection in the select tool', () => {
    expect(resolveShortcut({ key: 'r' }, canvas)).toBeNull();
    expect(resolveShortcut({ key: 'r' }, selected)).toBe('edit.rotateCw');
    expect(resolveShortcut({ key: 'R', shift: true }, selected)).toBe('edit.rotateCcw');
    expect(resolveShortcut({ key: 'x' }, selected)).toBe('edit.flipH');
    expect(resolveShortcut({ key: 'x', alt: true }, canvas)).toBe('edit.flipH');
    expect(resolveShortcut({ key: 'r', ctrl: true }, { ...selected, tool: 'place' })).toBeNull();
    expect(resolveShortcut({ key: 'Enter' }, selected)).toBe('edit.properties');
    expect(resolveShortcut({ key: 'Enter' }, canvas)).toBeNull();
  });
  it('accepts zoom keys with or without Shift', () => {
    expect(resolveShortcut({ key: '=', ctrl: true }, canvas)).toBe('view.zoomIn');
    expect(resolveShortcut({ key: '+', ctrl: true, shift: true }, canvas)).toBe('view.zoomIn');
    expect(resolveShortcut({ key: '+', shift: true }, canvas)).toBe('view.zoomIn');
    expect(resolveShortcut({ key: '-' }, canvas)).toBe('view.zoomOut');
    expect(resolveShortcut({ key: 'f' }, canvas)).toBe('view.fitAll');
    expect(resolveShortcut({ key: 'F', shift: true }, canvas)).toBe('view.fitSelection');
  });
});

describe('labels', () => {
  it('formats the primary chord for menus', () => {
    expect(shortcutLabel('file.saveAs')).toBe('Ctrl+Shift+S');
    expect(shortcutLabel('edit.redo')).toBe('Ctrl+Y');
    expect(shortcutLabel('edit.delete')).toBe('Del');
    expect(shortcutLabel('view.zoomIn')).toBe('Ctrl++');
    expect(shortcutLabel('view.nextSheet')).toBe('Alt+PgDn');
    expect(shortcutLabel('simulate.stop')).toBe('Shift+F5');
    expect(shortcutLabel('unknown.command')).toBeUndefined();
  });
  it('lists every binding of a command', () => {
    expect(shortcutLabels('edit.rotateCw')).toEqual(['Ctrl+R', 'R']);
    expect(shortcutLabels('edit.delete')).toEqual(['Del', 'Backspace']);
  });
  it('normalises keys', () => {
    expect(normalizeKey('A')).toBe('a');
    expect(normalizeKey('Enter')).toBe('Enter');
  });
});
