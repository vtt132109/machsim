/**
 * The quick-reference card of the print preview: the same shortcuts as Help > Keyboard shortcuts,
 * the live menus (full interface or beginner mode), both languages, and it paginates on A4.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { PRINT_TEXT } from '../../i18n/printText';
import { beginnerCommand } from '../app/beginner';
import { SHORTCUT_HELP } from '../app/shortcuts';
import { actions } from '../store';
import { DEFAULT_CHOICES, buildContents } from './printSources';
import { buildJob } from './printModel';
import { DEFAULT_PAGE_SETUP, layoutItems } from './printLayout';
import { QUICK_MENU_ITEMS, QUICK_MENU_PURPOSE, menuSummary, menuTable, quickReferenceContents, shortcutTable } from './quickRef';
import { newDesign } from '../../model/types';

afterEach(() => {
  setLang('vi');
  actions.setUi({ beginner: false });
});

describe('quick-reference card', () => {
  it('has the first-circuit steps, every shortcut row of the help page, and the main menus', () => {
    const [start, keys, menus] = quickReferenceContents({ beginner: false });
    expect(start.kind).toBe('doc');
    expect(keys.kind).toBe('table');
    expect(menus.kind).toBe('table');
    if (start.kind !== 'doc' || keys.kind !== 'table' || menus.kind !== 'table') return;
    expect(start.blocks.filter((b) => b.kind === 'bullets').flatMap((b) => (b.kind === 'bullets' ? b.items : []))).toHaveLength(9);
    const rows = SHORTCUT_HELP.reduce((n, sec) => n + sec.rows.length, 0);
    expect(keys.table.rows).toHaveLength(rows);
    for (const r of keys.table.rows) {
      expect(r).toHaveLength(3);
      expect(r.every((c) => c.trim().length > 0)).toBe(true);
    }
    // the words of the card are the learner's: F5 runs, Ctrl+K searches
    const flat = keys.table.rows.flat().join(' ');
    expect(flat).toContain('F5');
    expect(flat).toContain('Ctrl+K');
    expect(menus.table.rows.map((r) => r[0])).toEqual(['Tệp', 'Sửa', 'Xem', 'Đặt', 'Mô phỏng', 'Công cụ', 'Báo cáo', 'Tuỳ chọn', 'Cửa sổ', 'Trợ giúp']);
    for (const r of menus.table.rows) {
      expect(r[1].length, r[0]).toBeGreaterThan(10);
      expect(r[2].length, r[0]).toBeGreaterThan(5);
    }
  });

  it('every top menu has a purpose text in both languages', () => {
    for (const [, key] of QUICK_MENU_PURPOSE) {
      const text = PRINT_TEXT[key];
      expect(text.vi.length).toBeGreaterThan(10);
      expect(text.en.length).toBeGreaterThan(10);
      expect(text.vi).not.toBe(text.en);
    }
  });

  it('follows the interface language', () => {
    setLang('en');
    const menus = menuTable(false);
    expect(menus.table.rows.map((r) => r[0])).toEqual(['File', 'Edit', 'View', 'Place', 'Simulate', 'Tools', 'Reports', 'Options', 'Window', 'Help']);
    expect(menus.table.header).toEqual(['Menu', 'Used for', 'Main commands (shortcut)']);
    expect(shortcutTable().table.title).toBe('Keyboard shortcuts');
  });

  it('in beginner mode lists only the menus and commands the learner has', () => {
    const full = menuTable(false);
    const beginner = menuTable(true);
    expect(beginner.table.subtitle).toContain('Chế độ người mới');
    expect(full.table.subtitle).toBeUndefined();
    expect(beginner.table.rows.length).toBeLessThan(full.table.rows.length);
    // a command beginner mode hides never appears: Tools has Annotate but not the Script window
    const tools = beginner.table.rows.find((r) => r[0] === 'Công cụ');
    expect(tools).toBeDefined();
    expect(tools![2]).not.toContain('Tập lệnh');
    expect(beginnerCommand('tools.script')).toBe(false);
    expect(full.table.rows.find((r) => r[0] === 'Công cụ')![2].length).toBeGreaterThan(0);
  });

  it('puts the commands that have a shortcut first and ends with an ellipsis when it cuts', () => {
    const entry = (label: string, shortcut?: string) => ({ id: `x.${label}`, label, shortcut, onSelect: () => undefined });
    const items = [entry('Một'), entry('Hai'), entry('Ba', 'Ctrl+B'), entry('Bốn'), entry('Năm'), entry('Sáu'), entry('Bảy'), entry('Tám'), entry('Chín'), entry('Mười', 'Ctrl+M')];
    const text = menuSummary(items);
    expect(text.startsWith('Ba (Ctrl+B) · Mười (Ctrl+M) · Một')).toBe(true);
    expect(text.endsWith(' · …')).toBe(true);
    expect(text.split(' · ').length).toBe(QUICK_MENU_ITEMS + 1);
    expect(menuSummary(items.slice(0, 3))).toBe('Ba (Ctrl+B) · Một · Hai');
  });

  it('is built by the print sources when the choice is on, and fits A4 pages', async () => {
    const contents = await buildContents({ design: newDesign('x'), activeSheetId: 'sheet1', selection: [], monochrome: false }, { ...DEFAULT_CHOICES, sheets: false, quickRef: true });
    expect(contents.map((c) => c.id)).toEqual(['quickref:start', 'quickref:keys', 'quickref:menus']);
    const job = buildJob(contents, DEFAULT_PAGE_SETUP);
    const layout = layoutItems(job.items, DEFAULT_PAGE_SETUP);
    // every item is a page of text that fits the printable area; the card is a few pages, not dozens
    expect(layout.pages.length).toBeGreaterThanOrEqual(3);
    expect(layout.pages.length).toBeLessThanOrEqual(6);
    // and the choice is off by default
    const none = await buildContents({ design: newDesign('x'), activeSheetId: 'sheet1', selection: [], monochrome: false }, { ...DEFAULT_CHOICES, sheets: false });
    expect(none).toEqual([]);
  });
});
