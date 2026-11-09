import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { parseDesign, serializeDesign } from '../../model/serialize';
import type { AnalysisResult } from '../../sim/results';
import type { RunRecord } from './runs';
import { remapPages, runFromSaved, runToSaved, snapshotGrapher, type PageLike } from './savedGrapher';
import { addRun, applySavedPages, emptyDoc, pageResult } from './history';

const tran = (n: number): AnalysisResult => ({
  type: 'tran',
  title: 'Transient',
  scale: { name: 'time', unit: 's', re: Float64Array.from({ length: n }, (_, i) => i * 1e-6) },
  vectors: [
    { name: 'V(out)', unit: 'V', re: Float64Array.from({ length: n }, (_, i) => Math.sin(i / 10)) },
    { name: 'D0', unit: 'V', re: Float64Array.from({ length: n }, (_, i) => (i === 1234 ? 1 : i > 3000 && i < 3002 ? Number.NaN : 0)), digital: true },
  ],
  warnings: [],
});

const run = (id: number, n = 10): RunRecord => ({ id, source: 'analysis', name: 'Transient', time: 1_000 * id, results: [tran(n)] });

describe('Grapher pages kept in the design', () => {
  it('round-trips a run exactly (NaN as null) when it is small', () => {
    const r = run(3);
    r.results[0].vectors[0].re[4] = Number.NaN;
    const back = runFromSaved(runToSaved(r), 7);
    expect(back.id).toBe(7);
    expect(Array.from(back.results[0].scale!.re)).toEqual(Array.from(r.results[0].scale!.re));
    expect(Number.isNaN(back.results[0].vectors[0].re[4])).toBe(true);
    expect(Array.from(back.results[0].vectors[0].re.subarray(5))).toEqual(Array.from(r.results[0].vectors[0].re.subarray(5)));
    expect(back.results[0].vectors[1].digital).toBe(true);
  });

  it('decimates long runs but keeps first / last samples and every digital edge', () => {
    const big = run(1, 20_001);
    const saved = runToSaved(big, 1000);
    const s = saved.results[0];
    expect(s.scale!.re.length).toBeLessThan(1100);
    expect(s.scale!.re[0]).toBe(0);
    expect(s.scale!.re[s.scale!.re.length - 1]).toBe(20_000e-6);
    // the one-sample digital pulse at 1234 survives with both edges
    const d = s.vectors[1].re;
    const at = d.indexOf(1);
    expect(s.scale!.re[at]).toBe(1234 * 1e-6);
    expect(d[at]).toBe(1);
    expect(d[at - 1]).toBe(0);
    expect(s.vectors.every((v) => v.re.length === s.scale!.re.length)).toBe(true);
  });

  it('snapshots only the runs the pages show, newest first limit, and remaps ids on restore', () => {
    const runs = [run(1), run(2), run(3), run(4)];
    const pages: PageLike[] = [
      { id: 'p1', runId: 2, tab: 0, key: 'tran2', overlays: [{ runId: 1, tab: 0, vector: 'V(out)' }], props: { title: 'Mine' }, traces: { 'V(out)': { color: 3 } } },
      { id: 'p2', runId: 4, tab: 0, key: 'tran4', overlays: [], props: {}, traces: {} },
    ];
    const snap = snapshotGrapher(runs, pages, 'p1', { maxRuns: 2 });
    expect(snap.runs.map((r) => r.id)).toEqual([2, 4]);
    expect(snap.pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(snap.pages[0].overlays).toEqual([]);
    expect(snap.active).toBe('p1');
    const re = remapPages(snap.pages, new Map([[2, 11], [4, 12]]));
    expect(re.map((p) => p.runId)).toEqual([11, 12]);
    expect(re[0].props).toEqual({ title: 'Mine' });
  });

  it('is an optional design field that survives save and reload', () => {
    const b = new DesignBuilder('G');
    b.design.grapher = snapshotGrapher([run(1)], [{ id: 'p1', runId: 1, tab: 0, key: 'tran1', overlays: [], props: { grid: false }, traces: {} }], 'p1');
    const text = serializeDesign(b.design);
    const back = parseDesign(text);
    expect(back.grapher).toEqual(b.design.grapher);
    expect(serializeDesign(back)).toBe(text);
    // a page that names a missing run is a format error
    const bad = JSON.parse(text);
    bad.grapher.pages[0].runId = 99;
    expect(() => parseDesign(JSON.stringify(bad))).toThrow(/grapher.pages\[0\].runId/);
  });

  it('restored pages replace the automatic pages of their runs with the saved properties', () => {
    let doc = emptyDoc();
    doc = addRun(doc, run(1));
    const saved = snapshotGrapher(doc.runs, [{ ...doc.pages[0], props: { title: 'Đo thật', grid: false }, traces: { 'V(out)': { color: 2 } } }], doc.pages[0].id);
    // a later session: the run comes back under number 7
    let fresh = emptyDoc();
    fresh = addRun(fresh, runFromSaved(saved.runs[0], 7));
    const pages = remapPages(saved.pages, new Map([[1, 7]]));
    const restored = applySavedPages(fresh, pages, pages[0].id);
    expect(restored.pages).toHaveLength(1);
    expect(restored.pages[0].runId).toBe(7);
    expect(restored.pages[0].props).toEqual({ title: 'Đo thật', grid: false });
    expect(restored.pages[0].traces).toEqual({ 'V(out)': { color: 2 } });
    expect(restored.active).toBe(restored.pages[0].id);
    expect(pageResult(restored, restored.pages[0])?.vectors[0].name).toBe('V(out)');
    // pages of runs the doc does not have are ignored
    expect(applySavedPages(fresh, remapPages(saved.pages, new Map([[1, 99]])))).toBe(fresh);
  });
});
