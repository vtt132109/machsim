import { describe, expect, it } from 'vitest';
import type { AnalysisResult, Vector } from '../../sim/results';
import {
  buildPlotData,
  buildTabs,
  cursorReadout,
  decimateMinMax,
  interpolateAt,
  monotonicity,
  poleZeroPoints,
  rangeExtrema,
  resultTables,
  sampleSets,
  tableToCsv,
  tracesToCsv,
  unitForName,
  visibleIndexRange,
  yExtent,
} from './plotModel';
import { describeSamples, histogram } from './stats';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

const f64 = (a: number[]) => Float64Array.from(a);
const vec = (name: string, re: number[], unit: Vector['unit'] = 'V', im?: number[], digital?: boolean): Vector => ({
  name,
  unit,
  re: f64(re),
  ...(im ? { im: f64(im) } : {}),
  ...(digital ? { digital } : {}),
});

const tran: AnalysisResult = {
  type: 'tran',
  title: 'Transient analysis',
  spec: { type: 'tran', tstep: 1e-3, tstop: 4e-3 },
  scale: vec('time', [0, 1e-3, 2e-3, 3e-3, 4e-3], 's'),
  vectors: [vec('V(out)', [0, 1, 4, 9, 16]), vec('I(V1)', [0, -1, -2, -3, -4], 'A'), vec('D(q)', [0, 1, 1, 0, 0.5], 'V', undefined, true)],
  warnings: [],
};

const ac: AnalysisResult = {
  type: 'ac',
  title: 'AC analysis',
  spec: { type: 'ac', sweep: 'dec', points: 10, fstart: 10, fstop: 1000 },
  scale: vec('frequency', [10, 100, 1000], 'Hz'),
  vectors: [vec('V(out)', [1, 0, -0.1], 'V', [0, -1, 0.01])],
  warnings: [],
};

describe('buildTabs', () => {
  it('creates one tab per result, flattens batch runs and numbers duplicates', () => {
    const batch: AnalysisResult = {
      type: 'batch',
      title: 'Batch',
      vectors: [],
      warnings: [],
      runs: [
        { label: 'item 1', result: tran },
        { label: 'item 2', result: ac },
      ],
    };
    const sweep: AnalysisResult = { type: 'paramsweep', title: 'Parameter sweep', vectors: [], warnings: [], runs: [{ label: 'R1=1k', result: tran }] };
    const tabs = buildTabs([tran, batch, sweep]);
    // engine titles are shown as the localized analysis names
    expect(tabs.map((t) => t.title)).toEqual(['Transient', 'Transient (2)', 'AC sweep', 'Parameter sweep']);
    expect(tabs.map((t) => t.family)).toEqual([false, false, false, true]);
  });
});

describe('buildPlotData', () => {
  it('groups real traces by unit and puts digital traces in their own pane', () => {
    const p = buildPlotData(tran)!;
    expect(p.xLabel).toBe('Time');
    expect(p.xLog).toBe(false);
    expect(p.panes.map((x) => x.title)).toEqual(['Voltage (V)', 'Current (A)', 'Digital']);
    expect(p.traces.map((t) => [t.label, t.pane, t.color])).toEqual([
      ['V(out)', 0, 0],
      ['I(V1)', 1, 1],
      ['D(q)', 2, 2],
    ]);
    expect(p.traces[2].digital).toBe(true);
  });

  it('splits complex vectors into magnitude (dB / linear) and phase panes on a log axis', () => {
    const p = buildPlotData(ac)!;
    expect(p.xLog).toBe(true);
    expect(p.panes.map((x) => x.id)).toEqual(['mag-db', 'phase']);
    const [mag, ph] = p.traces;
    expect(mag.y[0]).toBeCloseTo(0, 12);
    expect(mag.y[1]).toBeCloseTo(0, 12);
    expect(mag.y[2]).toBeCloseTo(20 * Math.log10(Math.hypot(0.1, 0.01)), 12);
    expect(ph.y[1]).toBeCloseTo(-90, 12);
    // unwrapped: -90 -> 174.3 would jump by +264; unwrapping keeps it continuous (-185.7)
    expect(ph.y[2]).toBeCloseTo((Math.atan2(0.01, -0.1) * 180) / Math.PI - 360, 9);
    const lin = buildPlotData(ac, { magnitude: 'linear', unwrapPhase: false })!;
    expect(lin.traces[0].y[2]).toBeCloseTo(Math.hypot(0.1, 0.01), 12);
    expect(lin.traces[1].y[2]).toBeCloseTo((Math.atan2(0.01, -0.1) * 180) / Math.PI, 9);
    const linSweep = buildPlotData({ ...ac, spec: { type: 'ac', sweep: 'lin', points: 3, fstart: 10, fstop: 1000 } })!;
    expect(linSweep.xLog).toBe(false);
  });

  it('overlays run families with one colour per run', () => {
    const fam: AnalysisResult = {
      type: 'paramsweep',
      title: 'Parameter sweep',
      vectors: [],
      warnings: [],
      runs: [1, 2, 3].map((k) => ({
        label: `R1=${k}k`,
        result: { ...tran, vectors: [vec('V(out)', [0, k, 2 * k, 3 * k, 4 * k])] },
      })),
    };
    const p = buildPlotData(fam)!;
    expect(p.traces.map((t) => t.label)).toEqual(['V(out) (R1=1k)', 'V(out) (R1=2k)', 'V(out) (R1=3k)']);
    expect(p.traces.map((t) => t.color)).toEqual([0, 1, 2]);
    expect(p.traces.map((t) => t.key)).toEqual(['0:V(out)', '1:V(out)', '2:V(out)']);
  });

  it('adds postprocessor vectors and returns null when nothing is plottable', () => {
    const p = buildPlotData(tran, { extra: [vec('V(out)*2', [0, 2, 8, 18, 32])] })!;
    expect(p.traces.some((t) => t.label === 'V(out)*2')).toBe(true);
    expect(buildPlotData({ type: 'op', title: 'OP', vectors: [vec('V(a)', [1])], warnings: [] })).toBeNull();
  });
});

describe('tables', () => {
  it('lists .meas values of a result and per run of a family', () => {
    const tr: AnalysisResult = {
      type: 'tran',
      title: 'Transient',
      scale: vec('time', [0, 1e-3], 's'),
      vectors: [vec('V(out)', [0, 1])],
      warnings: [],
      measurements: [
        { name: 'trise', analysis: 'tran', value: 2.197e-3, at: 2.3e-3 },
        { name: 'never', analysis: 'tran', value: Number.NaN, error: 'V(out) = 7: crossing #1 not found (0 found)' },
      ],
    };
    const m = resultTables(tr).find((x) => x.title === 'Measurements (.meas)')!;
    expect(m.columns).toEqual(['Name', 'Value', 'At x', 'Note']);
    expect(m.rows).toEqual([
      ['trise', 2.197e-3, 2.3e-3, ''],
      ['never', '—', '', 'V(out) = 7: crossing #1 not found (0 found)'],
    ]);
    const fam: AnalysisResult = { type: 'paramsweep', title: 'Parameter sweep', vectors: [], warnings: [], runs: [{ label: 'rv=1000', result: tr }, { label: 'rv=2000', result: { ...tr, measurements: [{ name: 'trise', analysis: 'tran', value: 4.39e-3 }] } }] };
    const per = resultTables(fam).find((x) => x.title === 'Measurements (.meas) per run')!;
    expect(per.columns).toEqual(['Run', 'trise', 'never']);
    expect(per.rows).toEqual([
      ['rv=1000', 2.197e-3, '—'],
      ['rv=2000', 4.39e-3, '—'],
    ]);
  });

  it('builds OP, scalar and run tables', () => {
    const op: AnalysisResult = { type: 'op', title: 'OP', vectors: [vec('V(a)', [1.5]), vec('I(V1)', [-2e-3], 'A')], warnings: [] };
    const t = resultTables(op);
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe('Operating point');
    expect(t[0].rows).toEqual([
      ['V(a)', 1.5],
      ['I(V1)', -2e-3],
    ]);
    const four: AnalysisResult = {
      type: 'four',
      title: 'Fourier',
      vectors: [],
      warnings: [],
      scalars: { THD: 0.05 },
      table: { columns: ['Harmonic', 'Frequency', 'Magnitude'], rows: [[1, 1000, 1], [2, 2000, 0.05]] },
    };
    expect(resultTables(four).map((x) => x.title)).toEqual(['Fourier components', 'Values']);
    const fam: AnalysisResult = {
      type: 'tempsweep',
      title: 'Temperature sweep',
      vectors: [],
      warnings: [],
      runs: [
        { label: 'T=27', result: { ...op } },
        { label: 'T=85', result: { ...op, vectors: [vec('V(a)', [1.4]), vec('I(V1)', [-2.1e-3], 'A')] } },
      ],
    };
    const runs = resultTables(fam).find((x) => x.title === 'Runs')!;
    expect(runs.columns).toEqual(['Run', 'V(a)', 'I(V1)']);
    expect(runs.rows[1]).toEqual(['T=85', 1.4, -2.1e-3]);
  });

  it('collects Monte Carlo sample sets and statistics', () => {
    const mc: AnalysisResult = {
      type: 'montecarlo',
      title: 'Monte Carlo',
      vectors: [],
      warnings: [],
      table: { columns: ['Run', 'max(V(out))'], rows: [[1, 1.0], [2, 1.2], [3, 0.8], [4, 1.1], [5, 0.9]] },
    };
    const sets = sampleSets(mc);
    expect(sets.map((s) => s.name)).toEqual(['max(V(out))']);
    const st = describeSamples(sets[0].values);
    expect(st.n).toBe(5);
    expect(st.mean).toBeCloseTo(1, 12);
    expect(st.std).toBeCloseTo(Math.sqrt(0.1 / 4), 12);
    expect(st.median).toBeCloseTo(1, 12);
    expect(st.q1).toBeCloseTo(0.9, 12);
    const h = histogram(sets[0].values, 4);
    expect(h.counts).toEqual([1, 1, 1, 2]);
    expect(h.edges[0]).toBeCloseTo(0.8, 12);
    expect(h.edges[4]).toBeCloseTo(1.2, 12);
    expect(histogram([1, 2, 3, 4, 5, 6, 7, 8]).counts).toHaveLength(4); // Sturges: 3 + 1
  });

  it('extracts poles and zeros', () => {
    const pz: AnalysisResult = {
      type: 'pz',
      title: 'Pole-zero',
      vectors: [],
      warnings: [],
      table: { columns: ['Type', 'Real', 'Imaginary'], rows: [['Pole 1', -1000, 0], ['Zero 1', 0, 500], ['junk', 1, 1]] },
    };
    expect(poleZeroPoints(pz)).toEqual([
      { kind: 'pole', re: -1000, im: 0 },
      { kind: 'zero', re: 0, im: 500 },
    ]);
  });
});

describe('cursor math', () => {
  it('interpolates on ascending, descending and non-monotonic x', () => {
    expect(interpolateAt([0, 1, 2], [0, 10, 40], 1.5)).toBe(25);
    expect(interpolateAt([2, 1, 0], [40, 10, 0], 0.5)).toBe(5);
    expect(interpolateAt([0, 2, 1], [0, 2, 1], 1.5)).toBe(1.5);
    expect(interpolateAt([0, 1], [0, 1], 2)).toBeNaN();
    expect(monotonicity([0, 1, 1, 2])).toBe(1);
    expect(monotonicity([3, 2, 1])).toBe(-1);
    expect(monotonicity([0, 2, 1])).toBe(0);
  });

  it('finds extrema between cursors including interpolated end points', () => {
    const e = rangeExtrema([0, 1, 2, 3], [0, 5, -3, 1], 0.5, 2.5);
    expect(e.max).toBe(5);
    expect(e.xAtMax).toBe(1);
    expect(e.min).toBe(-3);
    expect(e.xAtMin).toBe(2);
    const ends = rangeExtrema([0, 10], [0, 10], 2, 3);
    expect([ends.min, ends.max]).toEqual([2, 3]);
  });

  it('produces cursor readouts (y per trace, dx, 1/dx, dy, min/max)', () => {
    const p = buildPlotData(tran)!;
    const r = cursorReadout(p.traces.slice(0, 1), 1e-3, 3e-3);
    expect(r.dx).toBeCloseTo(2e-3, 15);
    expect(r.invDx).toBeCloseTo(500, 9);
    expect(r.rows[0]).toMatchObject({ y1: 1, y2: 9, dy: 8, min: 1, max: 9 });
  });
});

describe('decimation and extents', () => {
  it('visible range widens by one sample', () => {
    const x = [0, 1, 2, 3, 4, 5];
    expect(visibleIndexRange(x, 1.5, 3.5)).toEqual([1, 4]);
    expect(visibleIndexRange(x, -10, 10)).toEqual([0, 5]);
  });

  it('keeps peaks when decimating into pixel columns', () => {
    const n = 10000;
    const x = Float64Array.from({ length: n }, (_, i) => i);
    const y = Float64Array.from({ length: n }, (_, i) => (i === 4321 ? 100 : i === 7000 ? -50 : Math.sin(i / 50)));
    const d = decimateMinMax(x, y, 0, n - 1, (v) => (v / n) * 100); // 100 columns
    expect(d.x.length).toBeLessThanOrEqual(400);
    expect(Math.max(...d.y)).toBe(100);
    expect(Math.min(...d.y)).toBe(-50);
    // output stays in x order
    for (let i = 1; i < d.x.length; i++) expect(d.x[i]).toBeGreaterThan(d.x[i - 1]);
  });

  it('y extent over the visible x window', () => {
    const t = { x: f64([0, 1, 2, 3]), y: f64([0, 10, -5, 7]) };
    // edges interpolate to 5 (x=0.5) and 2.5 (x=1.5); the sample at x=1 is 10
    expect(yExtent([t], 0.5, 1.5)).toEqual([2.5, 10]);
    expect(yExtent([t], 0, 3)).toEqual([-5, 10]);
    expect(yExtent([{ x: f64([1, 2]), y: f64([-1, 100]) }], 1, 2, true)).toEqual([100, 100]);
  });
});

describe('CSV export', () => {
  it('shares one x column when traces share samples', () => {
    const p = buildPlotData(tran)!;
    const csv = tracesToCsv(p.traces.slice(0, 2), 'time');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('time,V(out) [V],I(V1) [A]');
    expect(lines[2]).toBe('0.001,1,-1');
    expect(lines).toHaveLength(6);
  });

  it('uses x/y pairs for traces with different samples and quotes labels', () => {
    const csv = tracesToCsv(
      [
        { label: 'a,b', unit: '', x: f64([0, 1]), y: f64([1, 2]) },
        { label: 'c', unit: 'V', x: f64([0]), y: f64([5]) },
      ],
      'x',
    );
    expect(csv.split('\r\n')[0]).toBe('x (a,b),"a,b",x (c),c [V]'.replace('x (a,b)', '"x (a,b)"'));
    expect(csv.split('\r\n')[2]).toBe('1,2,,');
    expect(tableToCsv({ title: 't', columns: ['k', 'v'], rows: [['x"y', 1]] })).toBe('k,v\r\n"x""y",1\r\n');
  });

  it('infers units from output names', () => {
    expect(unitForName('V(out)')).toBe('V');
    expect(unitForName('Ic(Q1)')).toBe('A');
    expect(unitForName('P(R1)')).toBe('W');
    expect(unitForName('vdb(out)')).toBe('');
    expect(unitForName('onoise_spectrum')).toBe('V/rtHz');
  });
});
