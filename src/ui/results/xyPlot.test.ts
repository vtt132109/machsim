/**
 * X-Y plots in the Grapher: the postprocessor function vs(y, x), the plot model that draws such a
 * vector against its own horizontal values, and the B-H loop of a Jiles-Atherton core end to end
 * (library part -> netlist -> transient -> postprocessor -> plot data).
 */
import { describe, expect, it } from 'vitest';
import type { AnalysisResult, Vector } from '../../sim/results';
import { setLang } from '../../i18n';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import { evaluateExpression, magneticUnit, PostprocessorError } from './postprocessor';
import { buildPlotData } from './plotModel';
import { bhCores } from './PostprocessorPanel';

setLang('en');

const vec = (name: string, re: number[], unit: Vector['unit'] = 'V'): Vector => ({ name, unit, re: Float64Array.from(re) });

const circle: AnalysisResult = {
  type: 'tran',
  title: 'Transient',
  scale: vec('time', [0, 1, 2, 3, 4], 's'),
  vectors: [vec('V(x)', [1, 0, -1, 0, 1]), vec('V(y)', [0, 1, 0, -1, 0])],
  warnings: [],
};

describe('postprocessor vs(y, x)', () => {
  it('keeps y and carries x as the horizontal values with its name', () => {
    const out = evaluateExpression('vs(V(y), V(x))', { result: circle });
    expect(Array.from(out.vector.re)).toEqual([0, 1, 0, -1, 0]);
    expect(Array.from(out.vector.xValues!)).toEqual([1, 0, -1, 0, 1]);
    expect(out.vector.xName).toBe('V(x)');
    expect(out.vector.xUnit).toBe('V');
  });

  it('works on computed expressions and rejects scalars', () => {
    const out = evaluateExpression('vs(2*V(y), V(x)+1)', { result: circle });
    expect(Array.from(out.vector.xValues!)).toEqual([2, 1, 0, 1, 2]);
    expect(() => evaluateExpression('vs(V(y), 3)', { result: circle })).toThrow(PostprocessorError);
  });
});

describe('plot model: X-Y traces', () => {
  it('draws the vector against its own x, names the axis after it and does not sort the points', () => {
    const out = evaluateExpression('vs(V(y), V(x))', { result: circle });
    const data = buildPlotData(circle, { extra: [out.vector], showInternal: true })!;
    const xy = data.traces.find((q) => q.vector === 'vs(V(y), V(x))')!;
    expect(Array.from(xy.x)).toEqual([1, 0, -1, 0, 1]);
    expect(Array.from(xy.y)).toEqual([0, 1, 0, -1, 0]);
    // X-Y mode: while the X-Y trace exists the time traces are left out and the axis is named after x
    expect(data.traces.map((q) => q.vector)).toEqual(['vs(V(y), V(x))']);
    expect(data.xLabel).toBe('V(x)');
    expect(data.panes.length).toBe(1);
    // without the X-Y vector the time plot is back
    const timePlot = buildPlotData(circle, { showInternal: true })!;
    expect(timePlot.xLabel).toBe('Time');
    expect(timePlot.traces).toHaveLength(2);
    const only = buildPlotData({ ...circle, vectors: [] }, { extra: [out.vector] })!;
    expect(only.xLabel).toBe('V(x)');
    expect(only.xUnit).toBe('V');
    expect(only.xLog).toBe(false);
  });
});

describe('magnetic units of the core nodes', () => {
  it('V(<ref>.b) is in tesla, V(<ref>.h) and V(<ref>.m) in A/m, V(<ref>.flux) in Wb; other vectors keep their unit', () => {
    expect(magneticUnit('V(L1.b)')).toBe('T');
    expect(magneticUnit('v(T3.H)')).toBe('A/m');
    expect(magneticUnit('V(L1.m)')).toBe('A/m');
    expect(magneticUnit('V(L1.flux)')).toBe('Wb');
    expect(magneticUnit('V(out)')).toBeUndefined();
    expect(magneticUnit('V(L1.mirr)')).toBeUndefined();
    const r: AnalysisResult = { ...circle, vectors: [vec('V(L1.b)', [0, 1, 2, 3, 4]), vec('V(L1.h)', [4, 3, 2, 1, 0])] };
    const out = evaluateExpression('vs(V(L1.b), V(L1.h))', { result: r });
    expect(out.vector.unit).toBe('T');
    expect(out.vector.xUnit).toBe('A/m');
    expect(buildPlotData({ ...r, vectors: [] }, { extra: [out.vector] })!.xUnit).toBe('A/m');
  });
});

describe('B-H loop of a hysteresis core in the Grapher', () => {
  const f = 50;
  const vpk = 2 * Math.PI * f * 100 * 100e-6 * 1.5;
  const b = new DesignBuilder('bh');
  const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: String(vpk), freq: String(f), phase: '90' });
  const l = b.part('basic/inductor-hysteresis', 'L1', 200, 0, { rser: '0', lam: '0' });
  b.labelPin(v, '+', 'a');
  b.labelPin(l, '1', 'a');
  b.labelPin(v, '-', '0');
  b.labelPin(l, '2', '0');
  const build = buildNetlist(b.design, { includeAnalysis: false });
  const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 2e-5, tstop: 3 / f, tmax: 2e-5 }] });

  it('the result holds the core nodes and the panel offers a B-H button for the core', () => {
    expect(res.error).toBeUndefined();
    const names = res.vectors.map((q) => q.name);
    expect(bhCores(names)).toEqual(['L1']);
  });

  it('vs(V(L1.b), V(L1.h)) plots B against H: a closed loop with positive loss area', () => {
    const out = evaluateExpression('vs(V(L1.b), V(L1.h))', { result: res });
    const bs = out.vector.re;
    const hs = out.vector.xValues!;
    expect(hs.length).toBe(bs.length);
    // the last full cycle encloses a positive area (counter-clockwise) of the order of Hc * 4 Bs
    const n = bs.length;
    const start = Math.floor((n * 2) / 3);
    let area = 0;
    for (let i = start + 1; i < n; i++) area += ((hs[i] + hs[i - 1]) / 2) * (bs[i] - bs[i - 1]);
    expect(area).toBeGreaterThan(100);
    expect(area).toBeLessThan(5000);
    const data = buildPlotData({ ...res, vectors: [] }, { extra: [out.vector] })!;
    expect(data.xLabel).toBe('V(L1.h)');
    expect(data.xUnit).toBe('A/m');
    expect(data.traces).toHaveLength(1);
    // with the time traces present the plot switches to the X-Y trace alone
    const mixed = buildPlotData(res, { extra: [out.vector] })!;
    expect(mixed.traces.every((q) => q.ownX)).toBe(true);
    expect(mixed.xUnit).toBe('A/m');
  });
});
