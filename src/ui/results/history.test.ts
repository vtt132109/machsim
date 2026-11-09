/**
 * Grapher workspace model: pages per run, history limit, overlays, "add traces from latest",
 * cross-page postprocessor references, Output-tab expressions and the text export.
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../sim/results';
import {
  addOverlay,
  addRun,
  addTracesFromLatest,
  crossPageResolver,
  duplicatePage,
  emptyDoc,
  findPage,
  overlayCandidates,
  pageResult,
  pageTab,
  parseTracesText,
  removePage,
  setPageProps,
  syncRuns,
  tracesToText,
} from './history';
import { buildPlotData } from './plotModel';
import { evaluateExpression } from './postprocessor';
import type { RunRecord } from './runs';

function tran(gain: number, n = 11): AnalysisResult {
  const time = Float64Array.from({ length: n }, (_, i) => i * 1e-3);
  return {
    type: 'tran',
    title: 'Transient analysis',
    scale: { name: 'time', unit: 's', re: time },
    vectors: [
      { name: 'V(in)', unit: 'V', re: time.map((t) => Math.sin(2 * Math.PI * 100 * t)) },
      { name: 'V(out)', unit: 'V', re: time.map((t) => gain * Math.sin(2 * Math.PI * 100 * t)) },
    ],
    warnings: [],
  };
}

function ac(): AnalysisResult {
  const f = Float64Array.of(10, 100, 1000);
  return { type: 'ac', title: 'AC analysis', scale: { name: 'frequency', unit: 'Hz', re: f }, vectors: [{ name: 'V(out)', unit: 'V', re: Float64Array.of(1, 0.7, 0.1), im: Float64Array.of(0, -0.7, -0.99) }], warnings: [] };
}

const run = (id: number, results: AnalysisResult[], extra: Partial<RunRecord> = {}): RunRecord => ({ id, source: 'analysis', name: 'x', time: Date.UTC(2026, 10, 9, 10, id), results, ...extra });

describe('Grapher history', () => {
  it('one page per tab, keyed by analysis type and run number; a batch gives one page per item', () => {
    let d = addRun(emptyDoc(), run(1, [tran(2)]));
    d = addRun(d, run(2, [{ type: 'batch', title: 'Batched analysis', vectors: [], warnings: [], runs: [{ label: '1', result: tran(3) }, { label: '2', result: ac() }] }]));
    expect(d.pages.map((p) => p.key)).toEqual(['tran1', 'tran2', 'ac2']);
    expect(d.active).toBe(d.pages[1].id);
    expect(pageTab(d, d.pages[2])!.result.type).toBe('ac');
    // the same run is not added twice
    expect(syncRuns(d, [run(1, [tran(2)]), run(2, [])]).pages.length).toBe(3);
  });

  it('keeps at most `max` runs and drops their pages and overlays', () => {
    let d = emptyDoc();
    for (let i = 1; i <= 4; i++) d = addRun(d, run(i, [tran(i)]), 3);
    expect(d.runs.map((r) => r.id)).toEqual([2, 3, 4]);
    expect(d.pages.map((p) => p.key)).toEqual(['tran2', 'tran3', 'tran4']);
    d = addOverlay(d, d.pages[2].id, { runId: 2, tab: 0, vector: 'V(out)' });
    d = addRun(d, run(5, [tran(5)]), 3);
    expect(d.pages.find((p) => p.key === 'tran4')!.overlays).toEqual([]);
  });

  it('overlays build a family: own run first, earlier runs with their own samples', () => {
    let d = addRun(emptyDoc(), run(1, [tran(1, 21)]));
    d = addRun(d, run(2, [tran(2)]));
    const page = d.pages[1];
    const cands = overlayCandidates(d, page.id);
    expect(cands.map((c) => c.ref.vector)).toEqual(['V(in)', 'V(out)']);
    d = addOverlay(d, page.id, cands[1].ref);
    const r = pageResult(d, findPage(d, page.id)!)!;
    expect(r.runs!.length).toBe(2);
    expect(r.runs![1].result.scale!.re.length).toBe(21);
    const plot = buildPlotData(r)!;
    // V(in) and V(out) of run 2 plus V(out) of run 1
    expect(plot.traces.length).toBe(3);
    expect(plot.traces[2].label).toMatch(/V\(out\) \(Lần 1|V\(out\) \(Run 1/);
  });

  it('"add traces from latest" takes matching vectors of the newest other run', () => {
    let d = addRun(emptyDoc(), run(1, [tran(1)]));
    d = addRun(d, run(2, [ac()]));
    d = addRun(d, run(3, [tran(3)]));
    const first = d.pages[0];
    const r = addTracesFromLatest(d, first.id);
    expect(r.added).toBe(2);
    expect(findPage(r.doc, first.id)!.overlays.every((o) => o.runId === 3)).toBe(true);
    // an AC page finds no other AC run
    expect(addTracesFromLatest(d, d.pages[1].id).added).toBe(0);
  });

  it('duplicate, rename and remove pages', () => {
    let d = addRun(emptyDoc(), run(1, [tran(1), ac()]));
    d = duplicatePage(d, d.pages[0].id);
    expect(d.pages.map((p) => p.key)).toEqual(['tran1', 'tran1b', 'ac1']);
    d = setPageProps(d, d.pages[1].id, { title: 'So sánh', grid: false, y: { min: -5, max: 5 } });
    expect(d.pages[1].props).toEqual({ title: 'So sánh', grid: false, y: { min: -5, max: 5 } });
    d = removePage(d, d.pages[1].id);
    expect(d.pages.map((p) => p.key)).toEqual(['tran1', 'ac1']);
    expect(d.active).toBe(d.pages[1].id);
  });

  it('postprocessor references other pages across runs and resamples onto this scale', () => {
    let d = addRun(emptyDoc(), run(1, [tran(1, 21)]));
    d = addRun(d, run(2, [tran(3)]));
    const own = pageTab(d, d.pages[1])!.result;
    const ext = crossPageResolver(d, own.scale);
    const out = evaluateExpression('V(out) - 3*tran1.V(out)', { result: own, external: ext });
    for (const v of out.vector.re) expect(Math.abs(v)).toBeLessThan(1e-12);
    // gain of this run against the first one
    const g = evaluateExpression('max(V(out)) / max(tran1.V(out))', { result: own, external: ext });
    expect(g.value).toBeCloseTo(3, 10);
    expect(() => evaluateExpression('ac9.V(out)', { result: own, external: ext })).toThrow(/ac9/);
    const d2 = addRun(d, run(3, [ac()]));
    expect(() => evaluateExpression('V(out) + ac3.V(out)', { result: own, external: crossPageResolver(d2, own.scale) })).toThrow(/frequency/);
  });

  it('Output-tab expressions of a run are added to its results', () => {
    const d = addRun(emptyDoc(), run(1, [tran(2)], { expressions: ['V(out)/V(in)', 'digital(V(out), 0.5)', 'nonsense('] }));
    const r = pageTab(d, d.pages[0])!.result;
    const ratio = r.vectors.find((v) => v.name === 'V(out)/V(in)')!;
    expect(ratio.re[1]).toBeCloseTo(2, 12);
    const dig = r.vectors.find((v) => v.name.startsWith('digital'))!;
    expect(dig.digital).toBe(true);
    expect(r.vectors.length).toBe(4);
  });
});

describe('digitize with thresholds and hysteresis', () => {
  it('applies a single threshold and a hysteresis band', () => {
    const r: AnalysisResult = { type: 'tran', title: 't', scale: { name: 'time', unit: 's', re: Float64Array.of(0, 1, 2, 3, 4, 5) }, vectors: [{ name: 'V(x)', unit: 'V', re: Float64Array.of(0, 2.6, 2.4, 1, 2.4, 3) }], warnings: [] };
    expect(Array.from(evaluateExpression('digital(V(x), 2.5)', { result: r }).vector.re)).toEqual([0, 1, 0, 0, 0, 1]);
    expect(Array.from(evaluateExpression('digital(V(x), 0.8, 2.5)', { result: r }).vector.re)).toEqual([0, 1, 1, 1, 1, 1]);
    expect(() => evaluateExpression('digital(V(x), 3, 1)', { result: r })).toThrow();
  });
});

describe('MachSim measurement text', () => {
  it('writes a header block and a shared x column, and reads back', () => {
    const text = tracesToText(
      [
        { label: 'V(out)', unit: 'V', x: Float64Array.of(0, 1, 2), y: Float64Array.of(0, 10, 20) },
        { label: 'V(in)', unit: 'V', x: Float64Array.of(0, 2), y: Float64Array.of(5, 7) },
      ],
      { title: 'Bộ lọc', xLabel: 'Thời gian', xUnit: 's', date: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
    );
    const lines = text.split('\r\n');
    expect(lines.slice(0, 7)).toEqual([
      'MachSim measurement text\t1',
      'Title\tBộ lọc',
      'Date\t2026-01-02T03:04:05.000Z',
      'X_Label\tThời gian [s]',
      'Channels\t2',
      '***End_of_Header***',
      'X_Value\tV(out) [V]\tV(in) [V]',
    ]);
    // V(in) is interpolated at x = 1
    expect(lines[8]).toBe('1\t10\t6');
    const back = parseTracesText(text);
    expect(back.title).toBe('Bộ lọc');
    expect(back.traces.map((tr) => tr.label)).toEqual(['V(out)', 'V(in)']);
    expect(Array.from(back.traces[1].y)).toEqual([5, 6, 7]);
  });
});
