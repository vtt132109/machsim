/**
 * Persisted UI preferences (theme, panel visibility and sizes, dock tab, autosave, grid, beginner
 * mode, UI language and the welcome-panel state), stored per browser profile. Loading validates
 * every field so a corrupt or outdated entry can never break start-up.
 */
import type { EditorState, ThemeMode, UiState } from '../store/types';
import { cleanToolbarPrefs } from './customize';
import { UI_PREFS_KEY, type KeyValueStorage } from './files';
import { isLang, type Lang } from '../../i18n';

export interface UiPrefs {
  ui: Partial<UiState>;
  showGrid?: boolean;
  /** UI language (absent until the user picks one; Vietnamese is the default) */
  lang?: Lang;
  /** first-run welcome panel: shown once / show on every start */
  welcome?: { seen: boolean; showOnStart: boolean };
}

export const PANEL_LIMITS = {
  browserWidth: { min: 160, max: 520 },
  propertiesWidth: { min: 200, max: 600 },
  dockHeight: { min: 90, max: 600 },
} as const;

/** Options > File options: autosave interval (s) and number of .bak copies. */
export const FILE_LIMITS = {
  autosaveSeconds: { min: 5, max: 3600 },
  backupCount: { min: 0, max: 9 },
} as const;

const THEMES: ThemeMode[] = ['system', 'light', 'dark'];

function num(v: unknown, lim: { min: number; max: number }): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(lim.max, Math.max(lim.min, v))) : undefined;
}

/** Keep only well-formed preference fields (sizes clamped to the panel limits). */
export function sanitizePrefs(raw: unknown): UiPrefs {
  const out: UiPrefs = { ui: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const ui = (typeof r.ui === 'object' && r.ui !== null ? r.ui : {}) as Record<string, unknown>;
  for (const k of ['browserOpen', 'propertiesOpen', 'dockOpen', 'autosave', 'beginner'] as const) if (typeof ui[k] === 'boolean') out.ui[k] = ui[k] as boolean;
  if (typeof ui.theme === 'string' && (THEMES as string[]).includes(ui.theme)) out.ui.theme = ui.theme as ThemeMode;
  if (typeof ui.dockTab === 'string' && ui.dockTab) out.ui.dockTab = ui.dockTab;
  for (const k of ['browserWidth', 'propertiesWidth', 'dockHeight'] as const) {
    const v = num(ui[k], PANEL_LIMITS[k]);
    if (v !== undefined) out.ui[k] = v;
  }
  for (const k of ['autosaveSeconds', 'backupCount'] as const) {
    const v = num(ui[k], FILE_LIMITS[k]);
    if (v !== undefined) out.ui[k] = v;
  }
  if (typeof ui.shortcuts === 'object' && ui.shortcuts !== null) {
    const keys: Record<string, string> = {};
    for (const [id, chord] of Object.entries(ui.shortcuts as Record<string, unknown>)) if (typeof chord === 'string' && /^[\w.]+$/.test(id)) keys[id] = chord;
    if (Object.keys(keys).length) out.ui.shortcuts = keys;
  }
  const toolbar = cleanToolbarPrefs(ui.toolbar);
  if (Object.keys(toolbar).length) out.ui.toolbar = toolbar;
  if (typeof r.showGrid === 'boolean') out.showGrid = r.showGrid;
  if (isLang(r.lang)) out.lang = r.lang;
  const w = r.welcome as Record<string, unknown> | null | undefined;
  if (typeof w === 'object' && w !== null && typeof w.seen === 'boolean' && typeof w.showOnStart === 'boolean') {
    out.welcome = { seen: w.seen, showOnStart: w.showOnStart, ...(w.beginnerAsked === true ? { beginnerAsked: true } : {}) };
  }
  return out;
}

export function readPrefs(storage: KeyValueStorage | null): UiPrefs {
  if (!storage) return { ui: {} };
  try {
    return sanitizePrefs(JSON.parse(storage.getItem(UI_PREFS_KEY) ?? 'null'));
  } catch {
    return { ui: {} };
  }
}

/** Preferences to persist for an editor state. */
export function prefsOf(s: EditorState): UiPrefs {
  // "new package for each section" is a working mode of this session, not a preference
  const { newPackage: _session, ...ui } = s.ui;
  return { ui, showGrid: s.showGrid };
}

export function writePrefs(storage: KeyValueStorage | null, prefs: UiPrefs): void {
  try {
    storage?.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage full or disabled: preferences are a convenience */
  }
}
