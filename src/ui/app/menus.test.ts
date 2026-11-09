import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry } from '../common/Menu';
import { createEditor } from '../store/editorStore';
import { testLookup } from '../store/testParts';
import { EXTENSION_COMMANDS } from './extensions';
import { ANALYSIS_LABELS, buildMenus, type MenuContext } from './menus';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

type Item = Extract<MenuEntry, { onSelect: () => void }>;

function leaves(items: MenuEntry[]): Item[] {
  const out: Item[] = [];
  for (const e of items) {
    if (e.type === 'separator') continue;
    if (e.type === 'submenu') out.push(...leaves(e.items));
    else out.push(e);
  }
  return out;
}

function find(items: MenuEntry[], label: string): Item {
  const hit = leaves(items).find((e) => e.label === label);
  if (!hit) throw new Error(`no menu item "${label}"`);
  return hit;
}

function context(ed: ReturnType<typeof createEditor>, registered: (id: string) => boolean, over: Partial<MenuContext> = {}): MenuContext & { ran: string[] } {
  const ran: string[] = [];
  return {
    state: ed.getState(),
    has: registered,
    run: (id) => ran.push(id),
    recent: [],
    openRecent: vi.fn(),
    clearRecent: vi.fn(),
    setAnalysis: vi.fn(),
    setTheme: vi.fn(),
    setActiveSheet: vi.fn(),
    simulationConnected: false,
    ran,
    ...over,
  };
}

const builtinOnly = (id: string) => !(EXTENSION_COMMANDS as readonly string[]).includes(id);

describe('menu model', () => {
  it('has the nine top-level menus in order', () => {
    const ed = createEditor({ lookup: testLookup });
    expect(buildMenus(context(ed, () => true)).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Place', 'Simulate', 'Tools', 'Reports', 'Options', 'Help']);
  });

  it('keeps extension commands disabled until they are registered', () => {
    const ed = createEditor({ lookup: testLookup });
    const menus = buildMenus(context(ed, builtinOnly));
    const all = menus.flatMap((m) => m.items);
    for (const label of ['Import SPICE netlist…', 'Export SPICE netlist…', 'Open samples…', 'Bill of materials', 'Netlist report', 'Electrical rules check', 'Analysis settings…', 'Grapher', 'Postprocessor']) {
      expect(find(all, label).disabled, label).toBe(true);
    }
    const registered = buildMenus(context(ed, () => true)).flatMap((m) => m.items);
    expect(find(registered, 'Bill of materials').disabled).toBe(false);
    expect(find(registered, 'Grapher').disabled).toBe(false);
  });

  it('reflects editor state: history, selection, clipboard, toggles', () => {
    const ed = createEditor({ lookup: testLookup });
    let items = buildMenus(context(ed, () => true)).flatMap((m) => m.items);
    expect(find(items, 'Undo').disabled).toBe(true);
    expect(find(items, 'Copy').disabled).toBe(true);
    expect(find(items, 'Paste').disabled).toBe(true);
    expect(find(items, 'Select all').disabled).toBe(true);
    expect(find(items, 'Grid').checked).toBe(true);
    const id = ed.actions.placePart('test/resistor', { x: 0, y: 0 })!;
    ed.actions.select([{ kind: 'part', id }]);
    ed.actions.copy();
    ed.actions.setShowGrid(false);
    items = buildMenus(context(ed, () => true)).flatMap((m) => m.items);
    expect(find(items, 'Undo').disabled).toBe(false);
    expect(find(items, 'Redo').disabled).toBe(true);
    expect(find(items, 'Copy').disabled).toBe(false);
    expect(find(items, 'Paste').disabled).toBe(false);
    expect(find(items, 'Properties…').disabled).toBe(false);
    expect(find(items, 'Grid').checked).toBe(false);
    expect(find(items, 'Undo').shortcut).toBe('Ctrl+Z');
  });

  it('runs commands by id and routes submenu choices to callbacks', () => {
    const ed = createEditor({ lookup: testLookup });
    const ctx = context(ed, () => true);
    const items = buildMenus(ctx).flatMap((m) => m.items);
    find(items, 'Save as…').onSelect();
    find(items, 'Wire').onSelect();
    find(items, 'Current').onSelect();
    expect(ctx.ran).toEqual(['file.saveAs', 'place.wire', 'place.probe.current']);
    find(items, ANALYSIS_LABELS.ac).onSelect();
    expect(ctx.setAnalysis).toHaveBeenCalledWith('ac');
    find(items, 'Dark').onSelect();
    expect(ctx.setTheme).toHaveBeenCalledWith('dark');
    expect(find(items, 'Run Transient analysis').disabled).toBe(false);
    expect(find(items, ANALYSIS_LABELS.tran).checked).toBe(true);
  });

  it('shows the simulation state in the Simulate menu', () => {
    const ed = createEditor({ lookup: testLookup });
    let items = buildMenus(context(ed, () => true)).flatMap((m) => m.items);
    expect(find(items, 'Run').disabled).toBe(false);
    expect(find(items, 'Pause').disabled).toBe(true);
    expect(find(items, 'Stop').disabled).toBe(true);
    expect(find(items, 'Simulation engine not connected').disabled).toBe(true);
    ed.actions.setSimStatus({ state: 'running' });
    items = buildMenus(context(ed, () => true, { simulationConnected: true })).flatMap((m) => m.items);
    expect(find(items, 'Running…').disabled).toBe(true);
    expect(find(items, 'Pause').disabled).toBe(false);
    expect(find(items, 'Stop').disabled).toBe(false);
    expect(leaves(items).some((e) => e.label === 'Simulation engine not connected')).toBe(false);
    ed.actions.setSimStatus({ state: 'paused' });
    items = buildMenus(context(ed, () => true)).flatMap((m) => m.items);
    expect(find(items, 'Resume').disabled).toBe(false);
  });

  it('lists recent files and disables entries that cannot be reopened', () => {
    const ed = createEditor({ lookup: testLookup });
    const recent = [
      { name: 'a.msim', openedAt: 2, content: '{}' },
      { name: 'b.msim', openedAt: 1 },
    ];
    const ctx = context(ed, () => true, { recent });
    const file = buildMenus(ctx)[0].items;
    const a = find(file, '1  a.msim');
    expect(a.disabled).toBeFalsy();
    expect(find(file, '2  b.msim').disabled).toBe(true);
    a.onSelect();
    expect(ctx.openRecent).toHaveBeenCalledWith(recent[0]);
    expect(find(buildMenus(context(ed, () => true))[0].items, '(no recent files)').disabled).toBe(true);
  });

  it('lists sheets in the View menu and disables sheet deletion for a single sheet', () => {
    const ed = createEditor({ lookup: testLookup });
    let items = buildMenus(context(ed, () => true)).flatMap((m) => m.items);
    expect(find(items, 'Delete sheet…').disabled).toBe(true);
    const id = ed.actions.addSheet('Power');
    const ctx = context(ed, () => true);
    items = buildMenus(ctx).flatMap((m) => m.items);
    expect(find(items, 'Delete sheet…').disabled).toBe(false);
    expect(find(items, 'Power').checked).toBe(true);
    find(items, 'Sheet 1').onSelect();
    expect(ctx.setActiveSheet).toHaveBeenCalledWith('sheet1');
    expect(id).toBe(ed.getState().activeSheetId);
  });

  it('switches Capture screen area off on a ladder sheet', () => {
    const ed = createEditor({ lookup: testLookup });
    expect(find(buildMenus(context(ed, () => true)).flatMap((m) => m.items), 'Capture screen area').disabled).toBeFalsy();
    ed.actions.addLadderSheet('Ladder 1');
    // a ladder sheet has its own view, with no canvas to drag a capture rectangle on
    expect(find(buildMenus(context(ed, () => true)).flatMap((m) => m.items), 'Capture screen area').disabled).toBe(true);
    ed.actions.setActiveSheet('sheet1');
    expect(find(buildMenus(context(ed, () => true)).flatMap((m) => m.items), 'Capture screen area').disabled).toBeFalsy();
  });
});
