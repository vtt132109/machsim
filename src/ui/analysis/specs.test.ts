import { describe, expect, it } from 'vitest';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import {
  ANALYSIS_CATALOG,
  BASE_TYPES,
  META_TYPES,
  analysisSummary,
  analysisSummaryLines,
  dcPointCount,
  defaultSpec,
  elementParamChoices,
  frequencyPointCount,
  hasErrors,
  isOutputExpression,
  issuesAt,
  issuesUnder,
  nodesFromOutputs,
  optionsSummary,
  paramForTarget,
  sweepUnit,
  sweepValues,
  toUserText,
  validateOptions,
  validateSpec,
} from './specs';
import type { SpecContext } from './specs';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

const ALL_TYPES: AnalysisType[] = [
  'op', 'dc', 'ac', 'acsingle', 'tran', 'noise', 'tf', 'sens', 'pz', 'four', 'disto', 'noisefig',
  'paramsweep', 'tempsweep', 'montecarlo', 'worstcase', 'nestedsweep', 'tracewidth', 'batch', 'user',
];

const ctx: SpecContext = {
  outputs: ['V(in)', 'V(out)', 'I(V1)'],
  sources: ['V1', 'I2'],
  elements: ['R1', 'C1', { name: 'QMOD', model: true, params: ['bf'] }],
};

const paths = (spec: AnalysisSpec, c: SpecContext = ctx) =>
  validateSpec(spec, c)
    .filter((i) => i.severity === 'error')
    .map((i) => i.path);

describe('analysis catalog and defaults', () => {
  it('covers every analysis type of the netlist contract exactly once', () => {
    expect(ANALYSIS_CATALOG.map((a) => a.type).sort()).toEqual([...ALL_TYPES].sort());
    expect([...META_TYPES].sort()).toEqual(['batch', 'montecarlo', 'nestedsweep', 'paramsweep', 'tempsweep', 'tracewidth', 'worstcase']);
    for (const t of BASE_TYPES) expect(META_TYPES.has(t)).toBe(false);
  });

  it('produces a valid default for every type in a typical circuit', () => {
    for (const t of ALL_TYPES) {
      const spec = defaultSpec(t, ctx);
      expect(spec.type).toBe(t);
      expect(paths(spec), t).toEqual([]);
    }
  });

  it('picks circuit names for defaults', () => {
    expect(defaultSpec('dc', ctx)).toMatchObject({ src: 'V1' });
    // V(out) is preferred over the first output (V(in) would measure the input itself)
    expect(defaultSpec('tf', ctx)).toMatchObject({ output: 'V(out)', src: 'V1' });
    expect(defaultSpec('noise', { outputs: ['V(out)'] })).toMatchObject({ output: 'out' });
    expect(defaultSpec('paramsweep', ctx)).toMatchObject({ target: 'R1' });
  });

  it('drives the signal source, not a supply rail, and measures a node other than the input', () => {
    const amp: SpecContext = {
      outputs: ['V(IN)', 'V(VCC)', 'V(C)', 'I(V_PWR_VCC)'],
      sources: ['V_PWR_VCC', 'VS'],
      elements: [
        { name: 'V_PWR_VCC', type: 'V', nodes: ['VCC', '0'], hasValue: true, value: 12, params: [] },
        { name: 'VS', type: 'V', nodes: ['IN', '0'], hasValue: false, signal: true, params: ['vo', 'va', 'freq'] },
        { name: 'R1', type: 'R', nodes: ['VCC', 'C'], hasValue: true, value: 4700, tol: 0.01, params: [] },
        { name: 'C1', type: 'C', nodes: ['IN', 'B'], hasValue: true, value: 1e-6, tol: 0.1, params: [] },
        { name: 'Q1', type: 'Q', nodes: ['C', 'B', '0'], hasValue: false, params: ['area'] },
      ],
    };
    expect(defaultSpec('noisefig', amp)).toMatchObject({ src: 'VS', output: 'C' }); // no "out" net: not the input, not the rail
    expect(defaultSpec('tf', amp)).toMatchObject({ src: 'VS', output: 'V(C)' });
    expect(defaultSpec('pz', amp)).toMatchObject({ inPos: 'IN', outPos: 'C' });
    // sweeps and tolerances use R / C / L around their nominal values and part tolerances
    expect(defaultSpec('paramsweep', amp)).toMatchObject({ target: 'R1', param: 'value', values: [2350, 4700, 9400] });
    const nested = defaultSpec('nestedsweep', amp);
    expect(nested).toMatchObject({ outer: { target: 'R1', values: [4700, 9400] }, inner: { target: 'C1', values: [5e-7, 1e-6, 2e-6] } });
    expect(defaultSpec('montecarlo', amp)).toMatchObject({
      tolerances: [
        { target: 'R1', param: 'value', tol: 0.01 },
        { target: 'C1', param: 'value', tol: 0.1 },
      ],
    });
    expect(defaultSpec('worstcase', amp)).toMatchObject({ measure: { output: 'V(C)' } });
    for (const t of ['noisefig', 'tf', 'pz', 'paramsweep', 'nestedsweep', 'montecarlo', 'worstcase'] as const) {
      expect(validateSpec(defaultSpec(t, amp), amp).filter((i) => i.severity === 'error'), t).toEqual([]);
    }
  });

  it('flags sweep / tolerance parameters the element does not have, and a pole-zero input equal to its output', () => {
    const c: SpecContext = { sources: ['VS'], elements: [{ name: 'VS', type: 'V', hasValue: false, params: ['va', 'freq'] }, { name: 'R1', type: 'R', hasValue: true, params: [] }] };
    const sweep = (target: string, param: string): AnalysisSpec => ({ type: 'paramsweep', target, param, values: [1, 2], base: { type: 'op' } });
    expect(validateSpec(sweep('VS', 'value'), c)).toEqual([expect.objectContaining({ severity: 'error', path: 'param', message: expect.stringMatching(/'value' is not a parameter of VS \(choose va, freq\)/) })]);
    expect(validateSpec(sweep('VS', 'FREQ'), c)).toEqual([]);
    expect(validateSpec(sweep('R1', 'tc1'), c).map((i) => i.path)).toEqual(['param']);
    const mc: AnalysisSpec = { type: 'montecarlo', runs: 3, seed: 1, tolerances: [{ target: 'VS', param: 'value', tol: 0.1, dist: 'uniform' }], base: { type: 'op' } };
    expect(validateSpec(mc, c).map((i) => i.path)).toEqual(['tolerances.0.param']);
    const pz: AnalysisSpec = { type: 'pz', inPos: 'a', inNeg: '0', outPos: 'A', outNeg: '0', transfer: 'vol', find: 'pz' };
    expect(validateSpec(pz).map((i) => `${i.severity}:${i.path}`)).toEqual(['warning:outPos']);
    expect(validateSpec({ ...pz, transfer: 'cur' })).toEqual([]); // driving-point impedance is fine
  });

  it('offers "value" only for elements that have one, and moves the parameter along with the target', () => {
    const vs = { name: 'VS', type: 'V', hasValue: false, params: ['vo', 'va', 'freq'] };
    const r1 = { name: 'R1', type: 'R', hasValue: true, params: ['tc1'] };
    expect(elementParamChoices(vs)).toEqual(['vo', 'va', 'freq']);
    expect(elementParamChoices(r1)).toEqual(['value', 'tc1']);
    expect(elementParamChoices({ name: 'QMOD', model: true, params: ['bf'] }, true)).toEqual(['bf']);
    // switching the row from R1 to the waveform-only source drops "value" for its first parameter
    expect(paramForTarget(vs, 'value')).toBe('vo');
    expect(paramForTarget(vs, 'FREQ')).toBe('FREQ'); // offered (case-insensitive): kept
    expect(paramForTarget(r1, 'freq')).toBe('value');
    // unknown target or nothing known about its parameters: the typed parameter is kept
    expect(paramForTarget(undefined, 'w')).toBe('w');
    expect(paramForTarget({ name: 'M1' }, 'w')).toBe('w');
  });
});

describe('helpers', () => {
  it('extracts node names from outputs', () => {
    expect(nodesFromOutputs(['V(a)', 'v( b , c )', 'I(V1)', 'V(A)'])).toEqual(['a', 'b', 'c']);
  });

  it('recognises output expressions', () => {
    for (const ok of ['V(out)', 'v(a, b)', 'I(V1)', 'Ic(Q1)', ' V( n001 ) ']) expect(isOutputExpression(ok), ok).toBe(true);
    for (const bad of ['out', 'V()', 'I(a,b)', 'V(a', 'X(1)']) expect(isOutputExpression(bad), bad).toBe(false);
  });

  it('formats numbers in the user syntax and round-trips them', () => {
    expect(toUserText(1500)).toBe('1.5k');
    expect(toUserText(2e-6)).toBe('2u');
    expect(toUserText(1e7)).toBe('10M');
    expect(toUserText(-0.25)).toBe('-250m');
    expect(toUserText(10e9)).toBe('10G');
    expect(toUserText(0)).toBe('0');
    expect(toUserText(Number.NaN)).toBe('');
    for (const v of [1, 0.1, 3.3e-12, 47e3, 123456789, 2.2e-9, 1e-15, 999.9999]) {
      expect(parseUserNumber(toUserText(v)), String(v)).toBeCloseTo(v, 12 - Math.round(Math.log10(Math.abs(v))));
    }
  });

  it('generates sweep values', () => {
    expect(sweepValues(0, 1, 5, 'lin')).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(sweepValues(3, 9, 1, 'lin')).toEqual([3]);
    expect(sweepValues(1, 100, 2, 'dec')).toEqual([1, 3.16227766017, 10, 31.6227766017, 100]);
    expect(sweepValues(1, 8, 1, 'oct')).toEqual([1, 2, 4, 8]);
    expect(sweepValues(0, 10, 3, 'dec')).toEqual([]);
  });

  it('counts sweep points', () => {
    expect(dcPointCount(0, 5, 0.1)).toBe(51);
    expect(dcPointCount(5, 0, -0.5)).toBe(11);
    expect(Number.isNaN(dcPointCount(0, 5, -1))).toBe(true);
    expect(frequencyPointCount('dec', 10, 1, 1e6)).toBe(61);
    expect(frequencyPointCount('oct', 4, 100, 1600)).toBe(17);
    expect(frequencyPointCount('lin', 100, 0, 1e3)).toBe(100);
    expect(frequencyPointCount('list', 0, 0, 0, [1, 2, 3])).toBe(3);
  });

  it('infers sweep units', () => {
    expect(sweepUnit('R1', 'value')).toBe('Ω');
    expect(sweepUnit('C3', 'value')).toBe('F');
    expect(sweepUnit('V1', 'dc')).toBe('V');
    expect(sweepUnit('M1', 'w')).toBe('m');
    expect(sweepUnit('QMOD', 'bf', true)).toBe('');
  });
});

describe('spec validation', () => {
  it('DC sweep: source, step sign, point count and nested source', () => {
    expect(paths({ type: 'dc', src: 'V9', start: 0, stop: 1, step: 0.1 })).toEqual(['src']);
    expect(paths({ type: 'dc', src: 'temp', start: 0, stop: 100, step: 10 })).toEqual([]);
    expect(paths({ type: 'dc', src: 'V1', start: 0, stop: 1, step: -0.1 })).toEqual(['step']);
    expect(paths({ type: 'dc', src: 'V1', start: 0, stop: 1, step: 0 })).toEqual(['step']);
    expect(paths({ type: 'dc', src: 'V1', start: 0, stop: 10, step: 1e-6 })).toEqual(['step']);
    expect(paths({ type: 'dc', src: 'V1', start: 0, stop: 1, step: 0.5, src2: { src: 'v1', start: 0, stop: 1, step: 1 } })).toEqual(['src2.src']);
    expect(paths({ type: 'dc', src: 'V1', start: Number.NaN, stop: 1, step: 0.5 })).toEqual(['start']);
  });

  it('AC sweep: frequencies and points', () => {
    expect(paths({ type: 'ac', sweep: 'dec', points: 10, fstart: 0, fstop: 1e6 })).toEqual(['fstart']);
    expect(paths({ type: 'ac', sweep: 'lin', points: 10, fstart: 0, fstop: 1e6 })).toEqual([]);
    expect(paths({ type: 'ac', sweep: 'dec', points: 2.5, fstart: 1, fstop: 1e6 })).toEqual(['points']);
    expect(paths({ type: 'ac', sweep: 'dec', points: 10, fstart: 1e6, fstop: 1 })).toEqual(['fstop']);
    expect(paths({ type: 'ac', sweep: 'list', points: 0, fstart: 0, fstop: 0, list: [] })).toEqual(['list']);
    expect(paths({ type: 'ac', sweep: 'list', points: 0, fstart: 0, fstop: 0, list: [10, -1] })).toEqual(['list']);
    const slow = validateSpec({ type: 'ac', sweep: 'dec', points: 100000, fstart: 1, fstop: 1e9 }, ctx);
    expect(slow.some((i) => i.severity === 'warning' && i.path === 'points')).toBe(true);
  });

  it('transient: times', () => {
    expect(paths({ type: 'tran', tstep: 0, tstop: 1e-3 })).toEqual(['tstep']);
    expect(paths({ type: 'tran', tstep: 1e-2, tstop: 1e-3 })).toEqual(['tstep']);
    expect(paths({ type: 'tran', tstep: 1e-6, tstop: 1e-3, tstart: 2e-3 })).toEqual(['tstart']);
    expect(paths({ type: 'tran', tstep: 1e-6, tstop: 1e-3, tmax: -1 })).toEqual(['tmax']);
    expect(paths({ type: 'tran', tstep: 1e-6, tstop: 1e-3, tstart: 0, tmax: 1e-7, uic: true })).toEqual([]);
  });

  it('small-signal analyses: outputs, nodes and sources', () => {
    expect(paths({ type: 'tf', output: 'out', src: 'V1' })).toEqual(['output']);
    expect(paths({ type: 'tf', output: 'V(out)', src: '' })).toEqual(['src']);
    expect(paths({ type: 'noise', output: 'out', ref: 'out', src: 'V1', sweep: 'dec', points: 10, fstart: 1, fstop: 1e3 })).toEqual(['ref']);
    expect(paths({ type: 'pz', inPos: 'in', inNeg: 'in', outPos: 'out', outNeg: '0', transfer: 'vol', find: 'pz' })).toEqual(['inNeg']);
    expect(paths({ type: 'sens', output: 'V(out)', ac: { sweep: 'dec', points: 10, fstart: -1, fstop: 1e3 } })).toEqual(['ac.fstart']);
    expect(paths({ type: 'noisefig', output: 'out', src: 'V1', rsource: 0, freq: 1e3 })).toEqual(['rsource']);
    expect(paths({ type: 'disto', sweep: 'dec', points: 10, fstart: 1, fstop: 1e3, f2overf1: 1.5 })).toEqual(['f2overf1']);
    expect(paths({ type: 'acsingle', freq: -5 })).toEqual(['freq']);
    // unknown nodes are only warnings (the output list may be partial)
    const w = validateSpec({ type: 'noise', output: 'zzz', src: 'V1', sweep: 'dec', points: 10, fstart: 1, fstop: 1e3 }, ctx);
    expect(w).toEqual([{ path: 'output', message: "Node 'zzz' was not found in the circuit", severity: 'warning' }]);
  });

  it('Fourier: harmonics vs samples and outputs', () => {
    expect(paths({ type: 'four', fundamental: 1e3, harmonics: 20, outputs: ['V(out)'], samples: 32 })).toEqual(['samples']);
    expect(paths({ type: 'four', fundamental: 1e3, harmonics: 9, outputs: [] })).toEqual(['outputs']);
    expect(paths({ type: 'four', fundamental: 0, harmonics: 0, outputs: ['bad'] })).toEqual(['fundamental', 'harmonics', 'outputs.0']);
  });

  it('meta analyses validate their nested base with prefixed paths', () => {
    const ps: AnalysisSpec = { type: 'paramsweep', target: 'R9', param: 'value', values: [], base: { type: 'tran', tstep: 0, tstop: 1 } };
    expect(paths(ps)).toEqual(['target', 'values', 'base.tstep']);
    const nested: AnalysisSpec = { type: 'tempsweep', temps: [27], base: { type: 'montecarlo', runs: 1, seed: 1, tolerances: [], base: { type: 'op' } } };
    expect(paths(nested)).toEqual(['base']);
    const mc: AnalysisSpec = {
      type: 'montecarlo',
      runs: 0,
      seed: 1,
      tolerances: [
        { target: 'R1', param: 'value', tol: 0.05, dist: 'gaussian' },
        { target: 'QMOD', param: 'bf', model: true, tol: 1.5, dist: 'uniform' },
        { target: 'R1', param: 'value', model: true, tol: 0.1, dist: 'uniform' },
      ],
      base: { type: 'op' },
      measure: { output: 'V(out)', func: 'at' },
    };
    expect(paths(mc)).toEqual(['runs', 'tolerances.1.tol', 'tolerances.2.target', 'measure.at']);
    const wc: AnalysisSpec = { type: 'worstcase', tolerances: [], base: { type: 'op' }, measure: { output: 'V(out)', func: 'rise_edge' }, direction: 'high' };
    expect(paths(wc)).toEqual(['tolerances', 'measure.threshold']);
    const ns: AnalysisSpec = { type: 'nestedsweep', outer: { target: 'R1', param: '', values: [1] }, inner: { target: 'C1', param: 'value', values: [] }, base: { type: 'op' } };
    expect(paths(ns)).toEqual(['outer.param', 'inner.values']);
    const tw: AnalysisSpec = { type: 'tracewidth', base: { type: 'tran', tstep: 1e-6, tstop: 1e-3 }, tempRise: 0, copperOz: 2, external: false };
    expect(paths(tw)).toEqual(['tempRise']);
    const batch: AnalysisSpec = { type: 'batch', items: [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 0, fstart: 1, fstop: 10 }, { type: 'batch', items: [] }] };
    expect(paths(batch)).toEqual(['items.1.points', 'items.2']);
    expect(paths({ type: 'batch', items: [] })).toEqual(['items']);
  });

  it('filters issues by path', () => {
    const issues = validateSpec({ type: 'paramsweep', target: 'R1', param: 'value', values: [1], base: { type: 'tran', tstep: 0, tstop: 0 } }, ctx);
    expect(hasErrors(issues)).toBe(true);
    expect(issuesUnder(issues, 'base').map((i) => i.path)).toEqual(['tstep', 'tstop']);
    expect(issuesAt(issues, 'base.tstep')).toHaveLength(1);
  });
});

describe('analysis summaries', () => {
  it('summarises every basic analysis in one line', () => {
    expect(analysisSummary({ type: 'op' })).toBe('DC operating point');
    expect(analysisSummary({ type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.1 })).toBe('DC sweep of V1: 0 V → 5 V, step 100 mV (51 points)');
    expect(analysisSummary({ type: 'dc', src: 'V1', start: 0, stop: 1, step: 1, src2: { src: 'I2', start: 0, stop: 2e-3, step: 1e-3 } })).toBe(
      'DC sweep of V1: 0 V → 1 V, step 1 V (2 points); nested I2: 0 A → 2 mA, step 1 mA (3 curves)',
    );
    expect(analysisSummary({ type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e8 })).toBe('AC sweep: 1 Hz → 100 MHz, decade, 20 points/decade');
    expect(analysisSummary({ type: 'ac', sweep: 'list', points: 0, fstart: 0, fstop: 0, list: [1e3, 1e4] })).toBe('AC sweep: 2 frequencies (1 kHz, 10 kHz)');
    expect(analysisSummary({ type: 'acsingle', freq: 50 })).toBe('Single-frequency AC at 50 Hz');
    expect(analysisSummary({ type: 'tran', tstep: 1e-5, tstop: 1e-2, tmax: 1e-6, uic: true })).toBe('Transient: 0 s → 10 ms, step 10 µs, max step 1 µs, using initial conditions');
    expect(analysisSummary({ type: 'noise', output: 'out', ref: 'ref', src: 'V1', sweep: 'lin', points: 50, fstart: 0, fstop: 1e3 })).toBe(
      'Noise at V(out,ref), input V1: 0 Hz → 1 kHz, linear, 50 points',
    );
    expect(analysisSummary({ type: 'tf', output: 'V(out)', src: 'V1' })).toBe('DC transfer function V(out) / V1');
    expect(analysisSummary({ type: 'sens', output: 'V(out)' })).toBe('DC sensitivity of V(out)');
    expect(analysisSummary({ type: 'pz', inPos: 'in', inNeg: '0', outPos: 'out', outNeg: '0', transfer: 'vol', find: 'pol' })).toBe('Poles of the voltage gain V(out,0) / V(in,0)');
    expect(analysisSummary({ type: 'four', fundamental: 1e3, harmonics: 9, outputs: ['V(out)'], settleCycles: 5 })).toBe('Fourier of V(out) at 1 kHz, 9 harmonics, after 5 settling cycles');
    expect(analysisSummary({ type: 'disto', sweep: 'oct', points: 4, fstart: 100, fstop: 1e4, f2overf1: 0.9 })).toBe('Distortion: 100 Hz → 10 kHz, octave, 4 points/octave, intermodulation f2/f1 = 0.9');
    expect(analysisSummary({ type: 'noisefig', output: 'out', src: 'V1', rsource: 50, freq: 1e6 })).toBe('Noise figure at 1 MHz: output V(out), input V1, Rs = 50 Ω');
  });

  it('summarises meta analyses with their nested base', () => {
    expect(analysisSummary({ type: 'paramsweep', target: 'R1', param: 'value', values: [1e3, 2.2e3], base: { type: 'op' } })).toBe('Parameter sweep of R1 value: 1 kΩ, 2.2 kΩ × [DC operating point]');
    expect(analysisSummary({ type: 'tempsweep', temps: [-40, 0, 27, 85, 125, 150], base: { type: 'acsingle', freq: 1e3 } })).toBe(
      'Temperature sweep: 6 values, -40 °C … 150 °C × [Single-frequency AC at 1 kHz]',
    );
    expect(
      analysisSummary({ type: 'montecarlo', runs: 100, seed: 7, tolerances: [{ target: 'R1', param: 'value', tol: 0.05, dist: 'gaussian' }], base: { type: 'op' }, measure: { output: 'V(out)', func: 'max' } }),
    ).toBe('Monte Carlo: 100 runs (seed 7), 1 tolerance, maximum of V(out) × [DC operating point]');
    expect(
      analysisSummary({ type: 'worstcase', tolerances: [], base: { type: 'op' }, measure: { output: 'V(out)', func: 'at', at: 1e-3 }, direction: 'low' }),
    ).toBe('Worst case (low): V(out) at x = 1 m, 0 tolerances × [DC operating point]');
    expect(analysisSummary({ type: 'worstcase', tolerances: [], base: { type: 'op' }, measure: { output: 'V(out)', func: 'rise_edge', threshold: 2.5 }, direction: 'high' })).toBe(
      'Worst case (high): first rising crossing of V(out) through 2.5, 0 tolerances × [DC operating point]',
    );
    expect(analysisSummary({ type: 'nestedsweep', outer: { target: 'R1', param: 'value', values: [1, 2] }, inner: { target: 'C1', param: 'value', values: [1, 2, 3] }, base: { type: 'op' } })).toBe(
      'Nested sweep: R1 value (2 values) × C1 value (3 values) × [DC operating point]',
    );
    expect(analysisSummary({ type: 'tracewidth', base: { type: 'tran', tstep: 1e-6, tstop: 1e-3 }, tempRise: 10, copperOz: 1, external: true })).toBe(
      'Trace width for 10 °C rise, 1 oz/ft² copper, external layer × [Transient: 0 s → 1 ms, step 1 µs]',
    );
    expect(analysisSummary({ type: 'batch', items: [{ type: 'op' }, { type: 'tran', tstep: 1e-6, tstop: 1e-3 }] })).toBe('Batch of 2 analyses: DC Operating Point; Transient');
  });

  it('lists nested settings line by line', () => {
    const lines = analysisSummaryLines({
      type: 'montecarlo',
      runs: 5,
      seed: 1,
      tolerances: [{ target: 'QMOD', param: 'bf', model: true, tol: 0.1, dist: 'uniform' }],
      base: { type: 'paramsweep', target: 'R1', param: 'value', values: [1], base: { type: 'op' } },
    });
    expect(lines).toEqual([
      'Monte Carlo: 5 runs (seed 1), 1 tolerance',
      '  Tolerance QMOD (model) bf: ±10 % uniform',
      '  Parameter sweep of R1 value: 1 Ω',
      '    DC operating point',
    ]);
  });
});

describe('simulation options', () => {
  it('validates ranges and kinds', () => {
    expect(validateOptions({})).toEqual([]);
    const issues = validateOptions({ reltol: 0, itl1: 2.5, method: 'euler' as never, gmin: -1, maxord: 9, temp: -300 });
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.path).sort()).toEqual(['gmin', 'itl1', 'maxord', 'method', 'reltol', 'temp']);
    expect(validateOptions({ reltol: 0.05 })).toEqual([{ path: 'reltol', message: 'Relative tolerances above 1 % give inaccurate results', severity: 'warning' }]);
    expect(validateOptions({ maxord: 4 }).map((i) => i.severity)).toEqual(['warning']);
    expect(validateOptions({ maxord: 4, method: 'gear' })).toEqual([]);
  });

  it('summarises non-default options', () => {
    expect(optionsSummary({ reltol: 1e-3, temp: 50, abstol: 1e-9, method: 'gear' })).toEqual(['Circuit temperature = 50 °C', 'Absolute current tolerance = 1 nA', 'Integration method = Gear']);
  });
});
