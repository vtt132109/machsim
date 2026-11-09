/**
 * Component browser at Multisim scale: 60,000 synthetic parts (one family alone holds 30,000, like
 * the resistor family of a big commercial database). Search must answer in under 150 ms, the
 * incremental search must work in bounded slices, and the virtualised list must create only the
 * rows in view whatever the number of parts.
 */
import { describe, expect, it } from 'vitest';
import type { GroupDef, PartDef, PartGroup } from '../../library/types';
import { setLang } from '../../i18n';
import { INDEX_BLOCK, ROW_STATS, buildBrowserTree, createSearchJob, familyKey, groupKey, indexParts, listRowModel, searchCatalogue, treeKeyModel, treeRowModel, virtualWindow } from './browserModel';

const GROUPS: GroupDef[] = [
  { id: 'basic', name: 'Basic', order: 1 },
  { id: 'diodes', name: 'Diodes', order: 2 },
  { id: 'transistors', name: 'Transistors', order: 3 },
  { id: 'analog', name: 'Analog', order: 4 },
  { id: 'ttl', name: 'TTL', order: 5 },
  { id: 'connectors', name: 'Connectors', order: 14 },
];

const SYMBOL = { bbox: { x: -30, y: -10, w: 60, h: 20 }, prims: [], pins: [{ name: '1', x: -30, y: 0 }, { name: '2', x: 30, y: 0 }] };
const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const PACKAGES = ['0402', '0603', '0805', '1206', '2512', 'AXIAL'];

/** `n` synthetic parts: half resistors in one family (with values), the rest spread over 29 families. */
function syntheticParts(n: number): PartDef[] {
  const out: PartDef[] = [];
  const resistors = Math.floor(n / 2);
  for (let i = 0; i < resistors; i++) {
    const v = E12[i % 12] * 10 ** (i % 7);
    const pkg = PACKAGES[i % PACKAGES.length];
    out.push({
      id: `basic/syn-r${i}`,
      name: `SR${pkg}-${i}`,
      group: 'basic',
      family: 'Resistor',
      description: `Synthetic chip resistor ${pkg}, ${v} ohm`,
      prefix: 'R',
      symbol: SYMBOL,
      params: [],
      keywords: ['resistor', pkg],
      specs: { resistance: v, package: pkg },
      sortKey: v,
    } as PartDef);
  }
  const groups: PartGroup[] = ['diodes', 'transistors', 'analog', 'ttl', 'connectors'];
  for (let i = resistors; i < n; i++) {
    const g = groups[i % groups.length];
    const fam = `Family ${i % 29}`;
    out.push({ id: `${g}/syn-${i}`, name: `SX${i}`, group: g, family: fam, description: `Synthetic ${g} part number ${i} for scale tests`, prefix: 'U', symbol: SYMBOL, params: [] });
  }
  return out;
}

const PARTS = syntheticParts(60000);

const time = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe('60,000-part catalogue', () => {
  /**
   * Two assertions together bound how long one slice can block the UI, without timing a single
   * slice (this file runs beside 200 other test files, so one slice's wall time says as much about
   * the machine's load as about the code):
   *  - with a clock that advances 1 ms per look, a slice must stop after exactly `budget` blocks,
   *    so it indexes 8 · INDEX_BLOCK = 512 parts and never a part more;
   *  - the whole 60,000-part index must build in under 8 s, so a part costs at most 0.13 ms and a
   *    block of 64 at most 8.5 ms — a slice overruns its 8 ms budget by less than one frame.
   */
  it('builds the search index in bounded slices', () => {
    let fake = 0;
    const clock = () => fake++;
    let pos = 0;
    let slices = 0;
    let worstParts = 0;
    while (pos < PARTS.length) {
      const before = pos;
      pos = indexParts(PARTS, before, 8, clock);
      worstParts = Math.max(worstParts, pos - before);
      slices += 1;
      expect(pos).toBeGreaterThan(before);
    }
    expect(pos).toBe(PARTS.length);
    expect(worstParts).toBe(8 * INDEX_BLOCK);
    expect(slices).toBe(Math.ceil(PARTS.length / (8 * INDEX_BLOCK)));
    // a smaller budget makes smaller slices; a budget of 0 still makes progress (one block)
    expect(indexParts(PARTS, 0, 2, clock)).toBe(2 * INDEX_BLOCK);
    expect(indexParts(PARTS, 0, 0, clock)).toBe(INDEX_BLOCK);
    // throughput of the real index build (the parts above are indexed already: start from scratch)
    const fresh = syntheticParts(60000);
    const total = time(() => {
      let i = 0;
      while (i < fresh.length) i = indexParts(fresh, i, 8);
    });
    expect(total, `indexing 60,000 parts took ${total.toFixed(0)} ms`).toBeLessThan(8000);
  });

  it('keeps the index it built, so a catalogue pack that arrives later only indexes its own parts', () => {
    const pack = syntheticParts(20000);
    const run = () => {
      let i = 0;
      while (i < pack.length) i = indexParts(pack, i, 8);
    };
    const first = time(run);
    const again = time(run);
    // the second pass only looks the index up (both passes run under the same machine load)
    expect(again, `first ${first.toFixed(0)} ms, again ${again.toFixed(0)} ms`).toBeLessThan(first / 4);
  });

  it('searches in under 150 ms', () => {
    setLang('vi');
    const queries = ['sr0805', 'sr1206-2997', '4.7k', 'resistor 0805', 'xyzzy', 'family 12', 'sx59999', 'dien tro', 'synthetic ttl 4200'];
    // warm-up (JIT)
    for (const q of queries) searchCatalogue(PARTS, q);
    // best of three runs (a benchmark: the test machine may be busy with other test files)
    for (const q of queries) {
      const best = Math.min(...[0, 1, 2].map(() => time(() => searchCatalogue(PARTS, q))));
      expect(best, `"${q}" took ${best.toFixed(1)} ms`).toBeLessThan(150);
    }
    // and the answers are right
    expect(searchCatalogue(PARTS, 'sx59999')[0].id).toBe('connectors/syn-59999');
    expect(searchCatalogue(PARTS, 'sr1206-2997')[0].name).toBe('SR1206-2997');
    const k47 = searchCatalogue(PARTS, '4.7k');
    expect(k47.length).toBeGreaterThan(100);
    expect(k47.slice(0, 50).every((p) => (p as { specs?: { resistance?: number } }).specs?.resistance === 4700)).toBe(true);
    expect(searchCatalogue(PARTS, 'xyzzy')).toEqual([]);
  });

  it('the incremental search returns the same results in slices', () => {
    const q = 'resistor 0805';
    const sync = searchCatalogue(PARTS, q);
    let fake = 0;
    // a fake clock that advances 1 ms per look: the job must stop after about `budget` looks
    const job = createSearchJob(PARTS, q, () => fake++);
    let steps = 0;
    let partial = -1;
    while (!job.step(4)) {
      steps += 1;
      if (steps === 1) partial = job.results().length;
      expect(job.progress).toBeGreaterThan(0);
      expect(job.progress).toBeLessThan(1);
    }
    expect(steps).toBeGreaterThan(5);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(sync.length);
    expect(job.done).toBe(true);
    expect(job.results().map((p) => p.id)).toEqual(sync.map((p) => p.id));
    expect(createSearchJob(PARTS, '   ').step()).toBe(true);
  });

  it('the virtualised tree creates only the rows in view, whatever the number of parts', () => {
    const created = (n: number) => {
      const parts = n === PARTS.length ? PARTS : PARTS.slice(0, n);
      const tree = buildBrowserTree(parts, GROUPS);
      const res = tree.find((g) => g.group.id === 'basic')!.families.find((f) => f.name === 'Resistor')!;
      const expanded = new Set([groupKey('basic'), familyKey('basic', 'Resistor'), groupKey('ttl')]);
      const before = ROW_STATS.created;
      const model = treeRowModel(tree, expanded);
      const afterBuild = ROW_STATS.created - before;
      const win = virtualWindow(model.count, 22, 22 * Math.floor(model.count / 2), 440);
      const rows = model.slice(win.start, win.end);
      return { afterBuild, window: ROW_STATS.created - before - afterBuild, rows: rows.length, count: model.count, resistors: res.size };
    };
    const small = created(6000);
    const big = created(60000);
    expect(big.resistors).toBe(30000);
    expect(big.count).toBeGreaterThan(30000);
    // building the model touches no part, the window is the same size for 6,000 and 60,000 parts
    expect(small.afterBuild).toBe(0);
    expect(big.afterBuild).toBe(0);
    expect(big.window).toBe(big.rows);
    expect(big.rows).toBe(small.rows);
    expect(big.rows).toBeLessThan(45);
  });

  it('opens a 30,000-part family and navigates it from the keyboard quickly', () => {
    const tree = buildBrowserTree(PARTS, GROUPS);
    const fam = familyKey('basic', 'Resistor');
    const open = time(() => {
      const model = treeRowModel(tree, new Set([groupKey('basic'), fam]));
      model.slice(0, 40);
    });
    expect(open).toBeLessThan(1500);
    const model = treeRowModel(tree, new Set([groupKey('basic'), fam]));
    const famIdx = model.indexOf(fam);
    const lastIdx = famIdx + 30000;
    const last = model.at(lastIdx)!;
    expect(last.kind).toBe('part');
    expect(model.at(lastIdx + 1)?.kind).toBe('group');
    // the family is sorted by value: the last resistor has the largest value
    const values = model.slice(famIdx + 1, lastIdx + 1).filter((r) => r.kind === 'part').map((r) => ((r.kind === 'part' ? r.part : null) as { sortKey?: number }).sortKey!);
    expect(values[values.length - 1]).toBe(Math.max(...values.slice(-100)));
    const t = time(() => {
      expect(treeKeyModel(model, last.key, 'ArrowUp')?.active).toBe(model.at(lastIdx - 1)!.key);
      expect(treeKeyModel(model, last.key, 'Home')?.active).toBe(groupKey('basic'));
      expect(treeKeyModel(model, fam, 'ArrowLeft')).toEqual({ active: fam, toggle: fam });
    });
    expect(t).toBeLessThan(200);
    // a flat list of 60,000 search results is windowed the same way
    const list = listRowModel(PARTS);
    const before = ROW_STATS.created;
    expect(list.slice(30000, 30030).map((r) => r.key)[0]).toBe(`p:${PARTS[30000].id}`);
    expect(ROW_STATS.created - before).toBe(30);
    expect(list.indexOf(`p:${PARTS[59999].id}`)).toBe(59999);
  });
});
