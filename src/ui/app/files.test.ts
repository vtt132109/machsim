import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_KEY,
  MAX_RECENT_CONTENT,
  MAX_RECENT_PROJECT_CONTENT,
  MAX_RECENT_PROJECTS,
  RECENT_KEY,
  RECENT_PROJECT_KEY,
  baseName,
  clearAutosave,
  ensureExtension,
  fileNameForTitle,
  pushRecent,
  pushRecentProject,
  readAutosave,
  readRecent,
  readRecentProjects,
  writeAutosave,
  writeRecent,
  writeRecentProjects,
  type KeyValueStorage,
  type RecentEntry,
  type RecentProject,
} from './files';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  constructor(private readonly quota = Infinity) {}
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('file names', () => {
  it('adds the design extension once', () => {
    expect(ensureExtension('Amp')).toBe('Amp.msim');
    expect(ensureExtension('Amp.MSIM')).toBe('Amp.MSIM');
    expect(ensureExtension('  ')).toBe('Untitled.msim');
    expect(ensureExtension('plot', '.svg')).toBe('plot.svg');
  });
  it('strips directories and extensions', () => {
    expect(baseName('C:\\work\\Filter v2.msim')).toBe('Filter v2');
    expect(baseName('/home/a/b.tar.gz')).toBe('b.tar');
    expect(baseName('.hidden')).toBe('.hidden');
  });
  it('derives a Windows-safe name from a title', () => {
    expect(fileNameForTitle('Amp: stage 1/2?')).toBe('Amp_ stage 1_2_.msim');
    expect(fileNameForTitle('trailing dots...')).toBe('trailing dots.msim');
    expect(fileNameForTitle('')).toBe('Untitled.msim');
  });
});

describe('recent files', () => {
  const a: RecentEntry = { name: 'a.msim', openedAt: 1, content: '{}' };
  const b: RecentEntry = { name: 'b.msim', path: 'C:\\x\\b.msim', openedAt: 2 };
  it('puts the newest first, removes duplicates and caps the list', () => {
    let list = pushRecent([], a);
    list = pushRecent(list, b);
    list = pushRecent(list, { name: 'A.msim', openedAt: 3, content: '{"v":2}' });
    expect(list.map((e) => [e.name, e.openedAt])).toEqual([
      ['A.msim', 3],
      ['b.msim', 2],
    ]);
    expect(list[0].content).toBe('{"v":2}');
    for (let i = 0; i < 20; i++) list = pushRecent(list, { name: `f${i}.msim`, openedAt: 10 + i }, 5);
    expect(list.map((e) => e.name)).toEqual(['f19.msim', 'f18.msim', 'f17.msim', 'f16.msim', 'f15.msim']);
  });
  it('drops oversized content snapshots without mutating the input', () => {
    const big: RecentEntry = { name: 'big.msim', openedAt: 5, content: 'x'.repeat(MAX_RECENT_CONTENT + 1) };
    const list = pushRecent([], big);
    expect(list[0]).toEqual({ name: 'big.msim', openedAt: 5 });
    expect(big.content).toHaveLength(MAX_RECENT_CONTENT + 1);
  });
  it('round-trips through storage and ignores malformed data', () => {
    const s = new MemoryStorage();
    writeRecent(s, [a, b]);
    expect(readRecent(s)).toEqual([a, b]);
    s.setItem(RECENT_KEY, '{"not":"a list"}');
    expect(readRecent(s)).toEqual([]);
    s.setItem(RECENT_KEY, '[{"name":1},{"name":"ok.msim","openedAt":4},null]');
    expect(readRecent(s)).toEqual([{ name: 'ok.msim', openedAt: 4 }]);
    s.setItem(RECENT_KEY, 'garbage');
    expect(readRecent(s)).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });
  it('retries without content snapshots when storage is full', () => {
    const s = new MemoryStorage(120);
    writeRecent(s, [{ name: 'a.msim', openedAt: 1, content: 'y'.repeat(200) }, b]);
    expect(readRecent(s)).toEqual([{ name: 'a.msim', openedAt: 1 }, b]);
  });
});

describe('autosave records', () => {
  it('writes, reads and clears', () => {
    const s = new MemoryStorage();
    expect(readAutosave(s)).toBeNull();
    expect(writeAutosave(s, { fileName: 'x.msim', savedAt: 42, text: '{"format":"machsim-design"}' })).toBe(true);
    expect(readAutosave(s)).toEqual({ fileName: 'x.msim', savedAt: 42, text: '{"format":"machsim-design"}' });
    clearAutosave(s);
    expect(s.data.has(AUTOSAVE_KEY)).toBe(false);
  });
  it('rejects incomplete records and reports a full storage', () => {
    const s = new MemoryStorage(10);
    expect(writeAutosave(s, { fileName: 'x.msim', savedAt: 1, text: 'too long for the quota' })).toBe(false);
    s.data.set(AUTOSAVE_KEY, '{"fileName":"x","text":"t"}');
    expect(readAutosave(s)).toBeNull();
    expect(writeAutosave(null, { fileName: 'x', savedAt: 1, text: '' })).toBe(false);
  });
});

describe('recent projects (the browser build keeps them itself)', () => {
  const entry = (name: string, size = 10): RecentProject => ({ name, openedAt: 1, project: '{"format":"machsim-project"}', files: { 'a.msim': 'x'.repeat(size) } });

  it('puts the newest first, drops duplicates and caps the list', () => {
    let list: RecentProject[] = [];
    for (const n of ['A', 'B', 'C']) list = pushRecentProject(list, entry(n));
    expect(list.map((e) => e.name)).toEqual(['C', 'B', 'A']);
    list = pushRecentProject(list, entry('A'));
    expect(list.map((e) => e.name)).toEqual(['A', 'C', 'B']);
    for (let i = 0; i < MAX_RECENT_PROJECTS + 3; i++) list = pushRecentProject(list, entry(`P${i}`));
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
    // a desktop entry is identified by its path, not its name
    const byPath = pushRecentProject([], { name: 'P', openedAt: 1, path: 'C:/a/p.msimproj' });
    expect(pushRecentProject(byPath, { name: 'Other name', openedAt: 2, path: 'C:/a/p.msimproj' })).toHaveLength(1);
  });

  it('reads back what it wrote, and survives damaged storage', () => {
    const s = new MemoryStorage();
    expect(readRecentProjects(s)).toEqual([]);
    const list = [entry('A'), entry('B')];
    writeRecentProjects(s, list);
    expect(readRecentProjects(s)).toEqual(list);
    s.data.set(RECENT_PROJECT_KEY, 'not json');
    expect(readRecentProjects(s)).toEqual([]);
    expect(readRecentProjects(null)).toEqual([]);
  });

  it('keeps the newest snapshots under the size cap and the names of the rest', () => {
    const s = new MemoryStorage();
    const big = Math.floor(MAX_RECENT_PROJECT_CONTENT * 0.6);
    writeRecentProjects(s, [entry('new', big), entry('old', big)]);
    const back = readRecentProjects(s);
    expect(back.map((e) => e.name)).toEqual(['new', 'old']);
    expect(back[0].files).toBeDefined();
    // the second one would not fit: it keeps its name so the list is still there
    expect(back[1].files).toBeUndefined();
    expect(back[1].project).toBeUndefined();
  });

  it('drops every snapshot when the browser refuses the write', () => {
    const s = new MemoryStorage(120);
    writeRecentProjects(s, [{ name: 'A', openedAt: 1, path: 'C:/p.msimproj', project: 'x'.repeat(500) }]);
    expect(readRecentProjects(s)).toEqual([{ name: 'A', openedAt: 1, path: 'C:/p.msimproj' }]);
    expect(() => writeRecentProjects(null, [])).not.toThrow();
  });
});
