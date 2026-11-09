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
  it('has the ten top-level menus in order (Window sits before Help)', () => {
    const ed = createEditor({ lookup: testLookup });
    expect(buildMenus(context(ed, () => true)).map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Place', 'Simulate', 'Tools', 'Reports', 'Options', 'Window', 'Help']);
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

  it('has a Window menu that lists the open designs, marks the current one and switches', () => {
    const ed = createEditor({ lookup: testLookup });
    const single = context(ed, () => true, { documents: [{ id: 'd1', label: 'one.msim', dirty: false, active: true }] });
    const window1 = buildMenus(single).find((m) => m.id === 'window')!;
    expect(window1.label).toBe('Window');
    expect(find(window1.items, 'Next design').disabled).toBe(true);
    expect(find(window1.items, 'Last used design').disabled).toBe(true);
    const many = context(ed, () => true, {
      documents: [
        { id: 'd1', label: 'one.msim', dirty: false, active: false },
        { id: 'd2', label: 'two.msim', dirty: true, active: true },
      ],
      switchDocument: vi.fn(),
    });
    const w = buildMenus(many).find((m) => m.id === 'window')!;
    expect(find(w.items, 'Next design').disabled).toBe(false);
    expect(find(w.items, '1  one.msim').checked).toBe(false);
    const current = find(w.items, '2  two.msim  ●');
    expect(current.checked).toBe(true);
    find(w.items, '1  one.msim').onSelect();
    expect(many.switchDocument).toHaveBeenCalledWith('d1');
  });

  it('File has Close, Close all and Save all; Save all waits for an unsaved design', () => {
    const ed = createEditor({ lookup: testLookup });
    const file = (docs: NonNullable<MenuContext['documents']>) => buildMenus(context(ed, () => true, { documents: docs }))[0].items;
    const clean = file([{ id: 'd1', label: 'a', dirty: false, active: true }]);
    expect(find(clean, 'Close design').disabled).toBe(false);
    expect(find(clean, 'Save all designs').disabled).toBe(true);
    expect(find(clean, 'Close all designs').disabled).toBe(true);
    const dirty = file([
      { id: 'd1', label: 'a', dirty: true, active: true },
      { id: 'd2', label: 'b', dirty: false, active: false },
    ]);
    expect(find(dirty, 'Save all designs').disabled).toBe(false);
    expect(find(dirty, 'Close all designs').disabled).toBe(false);
  });

  it('Edit has Order (graphics and text only), Layer settings and Paste special', () => {
    const ed = createEditor({ lookup: testLookup });
    const edit = () => buildMenus(context(ed, () => true))[1].items;
    expect(find(edit(), 'Bring to front').disabled).toBe(true);
    expect(find(edit(), 'Layer settings…').disabled).toBe(false);
    expect(find(edit(), 'Paste without renaming').disabled).toBe(true);
    const n = ed.actions.addNote({ x: 0, y: 0 }, 'x')!;
    ed.actions.select([{ kind: 'note', id: n }]);
    expect(find(edit(), 'Bring to front').disabled).toBe(false);
    expect(find(edit(), 'Send to back').disabled).toBe(false);
    const r = ed.actions.placePart('test/resistor', { x: 0, y: 100 })!;
    ed.actions.select([{ kind: 'part', id: r }]);
    ed.actions.copy();
    expect(find(edit(), 'Paste without renaming').disabled).toBe(false);
    expect(find(edit(), 'Paste values only').disabled).toBe(false);
    expect(find(edit(), 'Bring to front').disabled).toBe(true);
  });

  it('Tools has the reference designator prefixes', () => {
    const ed = createEditor({ lookup: testLookup });
    expect(find(buildMenus(context(ed, () => true))[5].items, 'Reference designator prefixes…').disabled).toBe(false);
  });
});
