/**
 * Review round 4, step 3: beginner mode filters the CONTEXT menu too.
 *
 * Beginner mode is a filter on the whole interface. The menu bar went through `beginnerMenus`
 * from the start, but the canvas right-click menu did not, so a learner in the simplified
 * interface still found Bus, Off-page connector and Sheet properties there — commands the menus
 * hide and the lessons never mention. The filter works on `MenuEntry.id`, so the entries that run
 * a command must carry one; this test fails when a new entry forgets it.
 */
import { describe, expect, it } from 'vitest';
import { beginnerCommand, beginnerEntries } from '../../../src/ui/app/beginner';
import type { MenuEntry } from '../../../src/ui/common/Menu';

/** Labels of the entries that have one (a separator has none). */
function labelsOf(items: MenuEntry[]): string[] {
  return items.flatMap((e) => (e.type === 'separator' ? [] : [e.label]));
}

/** Every entry of a (possibly nested) list, flattened. */
function flat(items: MenuEntry[]): MenuEntry[] {
  return items.flatMap((e) => (e.type === 'submenu' ? [e, ...flat(e.items)] : [e]));
}

describe('beginnerEntries', () => {
  const items: MenuEntry[] = [
    { id: 'edit.paste', label: 'Dán vào đây', onSelect: () => undefined },
    { id: 'place.component', label: 'Đặt linh kiện…', onSelect: () => undefined },
    { type: 'separator' },
    { id: 'place.bus', label: 'Bus', onSelect: () => undefined },
    { id: 'place.offpage', label: 'Đầu nối sang trang', onSelect: () => undefined },
    { id: 'options.sheetProperties', label: 'Thuộc tính trang…', onSelect: () => undefined },
    { type: 'separator' },
    { label: 'Một mục dựng từ dữ liệu', onSelect: () => undefined },
  ];

  it('drops the hidden commands, keeps the beginner ones and the id-less entries', () => {
    const kept = beginnerEntries(items, true);
    expect(labelsOf(kept)).toEqual(['Dán vào đây', 'Đặt linh kiện…', 'Một mục dựng từ dữ liệu']);
    // and no leading / trailing / doubled separators are left behind
    expect(kept[0].type).not.toBe('separator');
    expect(kept[kept.length - 1].type).not.toBe('separator');
  });

  it('returns the list unchanged in full mode', () => {
    expect(beginnerEntries(items, false)).toBe(items);
  });

  it('a submenu whose every command is hidden goes away, one with a visible command stays', () => {
    const nested: MenuEntry[] = [
      { type: 'submenu', label: 'Chỉ nâng cao', items: [{ id: 'place.bus', label: 'Bus', onSelect: () => undefined }] },
      { type: 'submenu', label: 'Có mục cho người mới', items: [{ id: 'place.wire', label: 'Dây', onSelect: () => undefined }, { id: 'place.bus', label: 'Bus', onSelect: () => undefined }] },
    ];
    const kept = beginnerEntries(nested, true);
    expect(labelsOf(kept)).toEqual(['Có mục cho người mới']);
    expect(labelsOf(flat(kept).filter((e) => e.type !== 'submenu'))).toEqual(['Dây']);
  });
});

describe('the canvas context menu is filterable', () => {
  it('every entry of canvasMenuEntries that runs a command carries its id', async () => {
    // the module pulls in the whole shell, so it is imported lazily and skipped when the
    // environment cannot load it (no DOM); the source-level guarantee below always runs
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../../src/ui/app/canvasHost.ts', import.meta.url), 'utf8'));
    // `cmd(id, …)` is the helper every command entry goes through: it must set `id`
    expect(src).toMatch(/function cmd\([^)]*\): MenuItem \{\s*return \{ id,/);
    // and every entry pushed by hand with a `cmd.`/`place.`/`view.`/`edit.` label keys off an id
    const pushes = [...src.matchAll(/extra\.push\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    const missing = pushes.filter((p) => /label: t\('(cmd|schematic)\./.test(p) && !/\bid: '/.test(p));
    expect(missing, 'a context-menu entry that runs a command without an id would survive the beginner filter').toEqual([]);
  });

  it('the commands that context menu offers are either in the allowlist or filtered', () => {
    // a spot check of the ids the canvas menu uses: the advanced ones are not in the allowlist,
    // so beginnerEntries removes them (the learner meets exactly the simplified interface)
    for (const id of ['edit.paste', 'edit.selectAll', 'place.component', 'place.wire', 'place.label', 'place.text', 'place.probe.voltage', 'view.fitAll', 'view.grid']) {
      expect(beginnerCommand(id), id).toBe(true);
    }
    for (const id of ['place.bus', 'place.offpage', 'options.sheetProperties', 'edit.replaceComponent', 'edit.ncMarker', 'tools.netSettings', 'place.replaceBySubcircuit', 'simulate.mcuEditor']) {
      expect(beginnerCommand(id), id).toBe(false);
    }
  });
});
