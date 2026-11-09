import { describe, expect, it } from 'vitest';
import { initialEditorState } from '../store/editorStore';
import { UI_PREFS_KEY } from './files';
import { PANEL_LIMITS, prefsOf, readPrefs, sanitizePrefs, writePrefs } from './prefs';

describe('UI preferences', () => {
  it('keeps valid fields and clamps panel sizes', () => {
    const p = sanitizePrefs({
      ui: { theme: 'dark', browserOpen: false, dockTab: 'grapher', browserWidth: 5000, dockHeight: 10, propertiesWidth: 333.6, autosave: false },
      showGrid: false,
    });
    expect(p).toEqual({
      ui: { theme: 'dark', browserOpen: false, autosave: false, dockTab: 'grapher', browserWidth: PANEL_LIMITS.browserWidth.max, propertiesWidth: 334, dockHeight: PANEL_LIMITS.dockHeight.min },
      showGrid: false,
    });
  });
  it('drops malformed fields', () => {
    expect(sanitizePrefs({ ui: { theme: 'purple', browserOpen: 'yes', browserWidth: Number.NaN, dockTab: '' }, showGrid: 1 })).toEqual({ ui: {} });
    expect(sanitizePrefs(null)).toEqual({ ui: {} });
    expect(sanitizePrefs('x')).toEqual({ ui: {} });
    expect(sanitizePrefs({ ui: 7 })).toEqual({ ui: {} });
  });
  it('round-trips the editor UI state through storage', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    const s = initialEditorState();
    const state = { ...s, showGrid: false, ui: { ...s.ui, theme: 'light' as const, dockHeight: 240 } };
    writePrefs(storage, prefsOf(state));
    expect(readPrefs(storage)).toEqual({ ui: state.ui, showGrid: false });
    data.set(UI_PREFS_KEY, '{broken');
    expect(readPrefs(storage)).toEqual({ ui: {} });
    expect(readPrefs(null)).toEqual({ ui: {} });
  });
});
