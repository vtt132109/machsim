/**
 * Beginner mode: which commands, menus, submenus, analyses and toolbar groups the simplified
 * interface keeps, and that full mode is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { newDesign } from '../../model/types';
import { initialEditorState } from '../store/editorStore';
import type { EditorState } from '../store/types';
import type { MenuEntry } from '../common/Menu';
import { buildMenus, type MenuContext } from './menus';
import { BEGINNER_COMMANDS, beginnerAnalyses, beginnerCommand, beginnerMenus, beginnerToolbar, BEGINNER_ANALYSIS_TYPES } from './beginner';
import { TOOLBAR_GROUPS } from './customize';
import { BUILTIN_COMMANDS } from './commands';
import { EXTENSION_COMMANDS } from './extensions';
import { ANALYSIS_ORDER } from './menus';

function state(beginner: boolean): EditorState {
  const s = initialEditorState(newDesign('T'));
  return { ...s, ui: { ...s.ui, beginner } };
}

function context(s: EditorState): MenuContext {
  return {
    state: s,
    has: () => true,
    run: () => undefined,
    recent: [],
    openRecent: () => undefined,
    clearRecent: () => undefined,
    setAnalysis: () => undefined,
    setTheme: () => undefined,
    setActiveSheet: () => undefined,
    setVariant: () => undefined,
    simulationConnected: true,
  };
}

/** Every entry of a menu tree, flattened (submenu items included). */
function flat(items: MenuEntry[]): MenuEntry[] {
  return items.flatMap((e) => (e.type === 'submenu' ? [e, ...flat(e.items)] : [e]));
}

const idsOf = (items: MenuEntry[]): string[] => flat(items).flatMap((e) => (e.type !== 'separator' && e.id ? [e.id] : []));

describe('beginner command list', () => {
  it('keeps the commands a first circuit needs and hides the professional ones', () => {
    for (const id of ['file.new', 'file.save', 'place.component', 'place.wire', 'simulate.run', 'tools.erc', 'help.lessons', 'options.beginnerMode']) {
      expect(beginnerCommand(id), id).toBe(true);
    }
    // the commands the shipped lessons tell the learner to open are part of the beginner interface
    for (const id of ['place.ladderSheet', 'file.snippetSave', 'tools.variants', 'reports.spareGates']) {
      expect(beginnerCommand(id), id).toBe(true);
    }
    for (const id of ['file.exportXml', 'file.transfer.kicad', 'tools.pldWizard', 'tools.footprints', 'edit.captureArea', 'reports.bom', 'simulate.autoFault', 'options.customizeUi']) {
      expect(beginnerCommand(id), id).toBe(false);
    }
  });

  it('lists only command ids that exist (built-in or a known extension command)', () => {
    // registered by the learning panels (src/ui/learn/install.ts) rather than by the shell
    const panels = new Set(['tools.descriptionBox', 'help.lessons', 'reports.spareGates']);
    for (const id of BEGINNER_COMMANDS) {
      const known = (BUILTIN_COMMANDS as readonly string[]).includes(id) || (EXTENSION_COMMANDS as readonly string[]).includes(id) || panels.has(id);
      expect(known, id).toBe(true);
    }
    expect(new Set(BEGINNER_COMMANDS).size).toBe(BEGINNER_COMMANDS.length);
  });
});

describe('beginner menu bar', () => {
  it('keeps the lesson commands and drops the advanced items, and keeps the rest usable', () => {
    const full = buildMenus(context(state(false)));
    const simple = beginnerMenus(full, true);
    expect(full.map((m) => m.id)).toContain('reports');
    // Reports is listed for the one report a lesson uses; everything else in it is filtered out
    expect(simple.map((m) => m.id)).toEqual(['file', 'edit', 'view', 'place', 'simulate', 'tools', 'reports', 'options', 'help']);
    expect(idsOf(simple.find((m) => m.id === 'reports')!.items)).toEqual(['reports.spareGates']);
    const ids = idsOf(simple.flatMap((m) => m.items));
    // the beginner essentials survive
    for (const id of ['file.new', 'file.save', 'edit.undo', 'view.fitAll', 'place.component', 'place.wire', 'simulate.run', 'tools.erc', 'help.lessons']) {
      expect(ids, id).toContain(id);
    }
    // every id left is a beginner command (nothing leaks through a submenu); 'menu.*' ids belong to
    // submenus built from data (sheets, themes, variants), not to commands
    for (const id of ids) expect(id.startsWith('analysis.') || id.startsWith('menu.') || beginnerCommand(id), id).toBe(true);
    // and nothing beyond the list got in
    expect(ids).not.toContain('file.exportXml');
    expect(ids).not.toContain('tools.componentWizard');
  });

  it('removes submenus whose items are all hidden but keeps the data-built ones', () => {
    const simple = beginnerMenus(buildMenus(context(state(true))), true);
    const subs = flat(simple.flatMap((m) => m.items)).filter((e) => e.type === 'submenu');
    const labels = subs.map((e) => (e.type === 'submenu' ? e.label : ''));
    // Transfer to PCB, Component tools, Circuit wizards, Hierarchy, Graphics … are gone, but the
    // submenus the lessons name (Snippets, Active variant) stay
    const ids = idsOf(simple.flatMap((m) => m.items));
    expect(ids).toContain('file.snippetSave');
    expect(ids).not.toContain('tools.footprints');
    expect(subs.some((e) => e.type === 'submenu' && e.id === 'menu.activeVariant')).toBe(true);
    // the recent-files, sheet, theme and language submenus are built from data and stay
    for (const id of ['menu.openRecent', 'menu.sheet', 'menu.theme', 'menu.language']) {
      expect(subs.length, id).toBeGreaterThan(0);
    }
    expect(labels.length).toBeGreaterThanOrEqual(4);
  });

  it('never leaves a leading, doubled or trailing separator', () => {
    const simple = beginnerMenus(buildMenus(context(state(true))), true);
    for (const m of [...simple, ...flat(simple.flatMap((x) => x.items)).flatMap((e) => (e.type === 'submenu' ? [{ id: e.label, label: e.label, items: e.items }] : []))]) {
      const kinds = m.items.map((e) => e.type ?? 'item');
      expect(kinds[0], m.id).not.toBe('separator');
      expect(kinds[kinds.length - 1], m.id).not.toBe('separator');
      for (let i = 1; i < kinds.length; i++) expect(kinds[i] === 'separator' && kinds[i - 1] === 'separator', `${m.id} ${i}`).toBe(false);
    }
  });

  it('leaves the full menu model untouched when the mode is off', () => {
    const full = buildMenus(context(state(false)));
    expect(beginnerMenus(full, false)).toBe(full);
  });

  it('keeps the design own analysis in the list even when it is an advanced one', () => {
    const s = state(true);
    const advanced: EditorState = { ...s, design: { ...s.design, analysis: { active: 'montecarlo', specs: {} } } };
    const ids = idsOf(beginnerMenus(buildMenus(context(advanced)), true).flatMap((m) => m.items)).filter((x) => x.startsWith('analysis.'));
    expect(ids).toEqual(['analysis.op', 'analysis.tran', 'analysis.ac', 'analysis.dc', 'analysis.acsingle', 'analysis.montecarlo']);
  });
});

describe('beginner analyses and toolbar', () => {
  it('offers five analyses, plus the design own one', () => {
    expect(beginnerAnalyses(ANALYSIS_ORDER, true)).toEqual([...BEGINNER_ANALYSIS_TYPES]);
    expect(beginnerAnalyses(ANALYSIS_ORDER, true, 'noise')).toEqual(['op', 'tran', 'ac', 'dc', 'acsingle', 'noise']);
    expect(beginnerAnalyses(ANALYSIS_ORDER, true, 'tran')).toEqual(['op', 'tran', 'ac', 'dc', 'acsingle']);
    expect(beginnerAnalyses(ANALYSIS_ORDER, false)).toEqual([...ANALYSIS_ORDER]);
  });

  it('switches the advanced toolbar groups off without changing the stored preferences', () => {
    const prefs = { file: false } as const;
    const out = beginnerToolbar(prefs, true);
    expect(out.file).toBe(false);
    expect(out.tools).toBe(false);
    expect(out.transform).toBe(false);
    expect(out.view).toBe(false);
    expect(out.simulate).toBeUndefined();
    expect(out.zoom).toBeUndefined();
    expect(prefs).toEqual({ file: false });
    expect(beginnerToolbar(prefs, false)).toBe(prefs);
    // every group is either kept or hidden, none forgotten
    for (const g of TOOLBAR_GROUPS) expect(out[g] === false || out[g] === undefined, g).toBe(true);
  });
});

describe('several designs, printing and the editing commands in beginner mode', () => {
  it('the Window menu is hidden, but closing a design and moving between designs stay available', () => {
    const menus = beginnerMenus(buildMenus(context(state(true))), true);
    expect(menus.map((m) => m.id)).not.toContain('window');
    expect(buildMenus(context(state(false))).map((m) => m.id)).toContain('window');
    for (const id of ['file.close', 'window.next', 'window.previous', 'file.print']) expect(beginnerCommand(id), id).toBe(true);
    for (const id of ['file.closeAll', 'file.saveAll', 'window.recent']) expect(beginnerCommand(id), id).toBe(false);
  });

  it('layer settings, drawing order, paste special and name prefixes are professional tools (full mode only)', () => {
    const ids = [
      'edit.layers',
      'edit.order.front',
      'edit.order.back',
      'edit.order.forward',
      'edit.order.backward',
      'edit.pasteSpecial.keepNames',
      'edit.pasteSpecial.values',
      'edit.pasteSpecial.block',
      'tools.refdesRules',
    ];
    for (const id of ids) expect(beginnerCommand(id), id).toBe(false);
    const beginnerIds = idsOf(beginnerMenus(buildMenus(context(state(true))), true).flatMap((m) => m.items));
    for (const id of ids) expect(beginnerIds, id).not.toContain(id);
    const fullIds = idsOf(buildMenus(context(state(false))).flatMap((m) => m.items));
    for (const id of ids) expect(fullIds, id).toContain(id);
  });

  it('the Paste special and Order submenus disappear from the beginner Edit menu as a whole', () => {
    const edit = beginnerMenus(buildMenus(context(state(true))), true).find((m) => m.id === 'edit')!;
    expect(flat(edit.items).some((e) => e.type === 'submenu' && (e.id === 'menu.pasteSpecial' || e.id === 'menu.order'))).toBe(false);
  });
});

