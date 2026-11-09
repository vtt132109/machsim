/**
 * `.step` and the Parameter sweep of a design variable on a schematic (round 4 step 3): one engine
 * path (ParamSweepAnalysis with `global`), the netlist rebuilt per value, every analysis type, a
 * legend per value, and the same result from the circuit's own `.step` card.
 *
 * Reference: the corner frequency of an RC low-pass is fc = 1 / (2π R C).
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import type { AnalysisSpec, Netlist } from '../sim/netlist';
import type { AnalysisResult } from '../sim/results';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { applySteps, customStepWrapper, stepCards, sweepsDesignVariable, type StepMessage } from './steps';
import type { Design } from './types';

const C = 100e-9;
const corner = (r: number): number => 1 / (2 * Math.PI * r * C);

/** V1 -> R1 = {Rx} -> OUT -> C1 = 100 nF -> ground. */
function rcDesign(customSpice?: string, source = 'sources/ac-voltage', sourceParams: Record<string, string> = { amplitude: '1', freq: '1k' }): Design {
  const b = new DesignBuilder('RC');
  const v = b.part(source, 'V1', 0, 0, sourceParams);
  const r = b.part('basic/resistor', 'R1', 200, 0, { value: '{Rx}' });
  const c = b.part('basic/capacitor', 'C1', 400, 0, { value: '100n' });
  const g = b.part('sources/ground', 'G1', 200, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r, '1', 'IN');
  b.labelPin(r, '2', 'OUT');
  b.labelPin(c, '1', 'OUT');
  b.labelPin(c, '2', 'GND0');
  b.labelPin(v, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  b.design.variables = { Rx: '1k' };
  if (customSpice) b.design.customSpice = customSpice;
  return b.design;
}

const AC: AnalysisSpec = { type: 'ac', sweep: 'dec', points: 40, fstart: 10, fstop: 1e5 };

function run(design: Design, spec: AnalysisSpec): { result: AnalysisResult; notes: StepMessage[]; errors: StepMessage[]; netlist: Netlist } {
  const build = buildNetlist(design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const out = applySteps(design, spec, (n) => ({ ...n, analyses: [] }));
  const netlist = { ...build.netlist, analyses: [out.spec] };
  const [result] = runAnalyses(netlist);
  return { result, notes: out.notes, errors: out.errors, netlist };
}

/** -3 dB frequency of V(OUT) in an AC run (log interpolation of the 1/sqrt(2) crossing). */
function minus3dB(r: AnalysisResult): number {
  const f = r.scale!.re;
  const v = r.vectors.find((x) => x.name === 'V(OUT)')!;
  const mag = Array.from(f, (_, k) => Math.hypot(v.re[k], v.im![k]));
  const target = mag[0] * Math.SQRT1_2;
  for (let k = 1; k < f.length; k++) {
    if (mag[k] <= target) {
      const w = (mag[k - 1] - target) / (mag[k - 1] - mag[k]);
      return f[k - 1] * Math.pow(f[k] / f[k - 1], w);
    }
  }
  return NaN;
}

describe('Parameter sweep of a design variable', () => {
  it('gives one AC run per value with the analytic RC corner frequencies', () => {
    const d = rcDesign();
    const values = [1000, 2000, 4000, 10000];
    const spec: AnalysisSpec = { type: 'paramsweep', target: 'Rx', param: 'value', global: true, values, base: AC };
    expect(sweepsDesignVariable(d, spec)).toBe(true);
    const { result, errors } = run(d, spec);
    expect(errors).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.runs).toHaveLength(values.length);
    result.runs!.forEach((r, k) => {
      expect(r.label).toBe(`Rx=${values[k]}`);
      expect(r.result.error).toBeUndefined();
      expect(minus3dB(r.result) / corner(values[k])).toBeCloseTo(1, 2);
    });
  });

  it('steps a transient analysis: V(OUT) reaches 63.2 % at t = R·C for each value', () => {
    const d = rcDesign(undefined, 'sources/dc-voltage', { value: '1' });
    const values = [1000, 2000, 4000];
    const spec: AnalysisSpec = { type: 'paramsweep', target: 'Rx', param: 'value', global: true, values, base: { type: 'tran', tstep: 2e-6, tstop: 1e-3, uic: true } };
    const { result } = run(d, spec);
    expect(result.runs).toHaveLength(3);
    values.forEach((r, k) => {
      const tr = result.runs![k].result;
      expect(tr.error).toBeUndefined();
      const t = tr.scale!.re;
      const v = tr.vectors.find((x) => x.name === 'V(OUT)')!.re;
      const tau = r * C;
      const i = t.findIndex((x) => x >= tau);
      const w = (tau - t[i - 1]) / (t[i] - t[i - 1]);
      expect(v[i - 1] + w * (v[i] - v[i - 1])).toBeCloseTo(1 - Math.exp(-1), 2);
    });
  });

  it('steps an operating point into curves over the swept values', () => {
    const b = new DesignBuilder('divider');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
    const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '{Rb}' });
    const g = b.part('sources/ground', 'G1', 200, 200);
    b.labelPin(v, '+', 'IN');
    b.labelPin(r1, '1', 'IN');
    b.labelPin(r1, '2', 'OUT');
    b.labelPin(r2, '1', 'OUT');
    b.labelPin(r2, '2', 'GND0');
    b.labelPin(v, '-', 'GND0');
    b.labelPin(g, '1', 'GND0');
    b.design.variables = { Rb: '1k' };
    const values = [500, 1000, 3000];
    const { result } = run(b.design, { type: 'paramsweep', target: 'rb', param: 'value', global: true, values, base: { type: 'op' } });
    expect(result.scale!.name).toBe('rb');
    const out = result.vectors.find((x) => x.name === 'V(OUT)')!;
    values.forEach((rb, k) => expect(out.re[k]).toBeCloseTo((10 * rb) / (1000 + rb), 6));
  });

  it('reports a value that breaks the circuit instead of running with a stale netlist', () => {
    const d = rcDesign();
    const out = applySteps(d, { type: 'paramsweep', target: 'Rx', param: 'value', global: true, values: [1000, -5], base: AC });
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.errors[0].text).toContain('Rx');
    expect(out.errors[0].code).toBe('valueError');
  });

  it('does not touch an analysis that sweeps no design variable', () => {
    const d = rcDesign();
    const spec: AnalysisSpec = { type: 'paramsweep', target: 'C1', param: 'value', values: [1e-7], base: AC };
    const out = applySteps(d, spec);
    expect(out.spec).toBe(spec);
    expect(out.stepped).toBe(false);
  });
});

describe('.step in the SPICE text of the circuit', () => {
  it('reads the card and wraps the analysis that runs', () => {
    expect(stepCards('* hi\n.step param Rx list 1k\n+ 2k 4k\n.meas ac x find vm(OUT) at=1k')).toEqual(['.step param Rx list 1k 2k 4k']);
    const d = rcDesign('.step param Rx list 1k 2k 4k');
    const w = customStepWrapper(d);
    expect(w.errors).toEqual([]);
    expect(w.wrapper).toMatchObject({ type: 'paramsweep', target: 'Rx', global: true, values: [1000, 2000, 4000] });
    const out = applySteps(d, AC);
    expect(out.spec.type).toBe('paramsweep');
    expect(out.stepped).toBe(true);
  });

  it('gives the same RC corners as the Parameter sweep', () => {
    const d = rcDesign('.step param Rx list 1k 2k 4k');
    const { result, errors } = run(d, AC);
    expect(errors).toEqual([]);
    expect(result.runs).toHaveLength(3);
    [1000, 2000, 4000].forEach((r, k) => expect(minus3dB(result.runs![k].result) / corner(r)).toBeCloseTo(1, 2));
  });

  it('a .meas card is evaluated on every step (corner frequency per value)', () => {
    const d = rcDesign('.step param Rx list 1k 2k 4k\n.meas ac fc WHEN vm(OUT)=0.70710678 FALL=1');
    const { result } = run(d, AC);
    [1000, 2000, 4000].forEach((r, k) => {
      const m = result.runs![k].result.measurements?.find((x) => x.name === 'fc');
      expect(m?.error).toBeUndefined();
      expect(m!.value / corner(r)).toBeCloseTo(1, 2);
    });
  });

  it('steps a linear range, a decade range, an element and the temperature', () => {
    const lin = customStepWrapper(rcDesign('.step param Rx 1k 3k 1k'));
    expect(lin.wrapper).toMatchObject({ values: [1000, 2000, 3000] });
    const dec = customStepWrapper(rcDesign('.step dec param Rx 1k 100k 1'));
    expect((dec.wrapper as { values: number[] }).values.map((v) => Math.round(v))).toEqual([1000, 10000, 100000]);
    const el = customStepWrapper(rcDesign('.step C1 list 100n 200n'));
    expect(el.wrapper).toMatchObject({ type: 'paramsweep', target: 'C1', param: 'value', values: [1e-7, 2e-7] });
    const temp = customStepWrapper(rcDesign('.step temp list 0 27 85'));
    expect(temp.wrapper).toMatchObject({ type: 'tempsweep', temps: [0, 27, 85] });
  });

  it('steps an element of the schematic by its name', () => {
    const d = rcDesign('.step C1 list 100n 200n');
    const { result } = run(d, AC);
    expect(result.runs).toHaveLength(2);
    expect(minus3dB(result.runs![1].result) / (1 / (2 * Math.PI * 1000 * 200e-9))).toBeCloseTo(1, 2);
  });

  it('explains a bad card and keeps going without it', () => {
    const w = customStepWrapper(rcDesign('.step param Nope list 1 2'));
    expect(w.wrapper).toBeUndefined();
    expect(w.errors[0].text).toContain('Nope');
    const two = customStepWrapper(rcDesign('.step param Rx list 1k 2k\n.step temp list 0 50'));
    expect(two.wrapper).toMatchObject({ target: 'Rx' });
    expect(two.notes.map((n) => n.text).join(' ')).toContain('first');
  });

  it('leaves a sweep that already repeats the circuit alone', () => {
    const d = rcDesign('.step param Rx list 1k 2k');
    const spec: AnalysisSpec = { type: 'tempsweep', temps: [0, 50], base: { type: 'op' } };
    const out = applySteps(d, spec);
    expect(out.spec).toBe(spec);
    expect(out.notes.map((n) => n.text).join(' ')).toContain('.step');
  });

  it('steps a .param that only the SPICE text uses, with the source netlist of the run', () => {
    // V2 is a DC source feeding R9 = {Rload} from the text: the stepped value changes the current
    const d = rcDesign('.param Rload=1k\nV9 N9 0 DC 10\nR9 N9 N10 {Rload}\nR10 N10 0 1k\n.step param Rload list 1k 3k');
    const { result, errors } = run(d, { type: 'op' });
    expect(errors).toEqual([]);
    expect(result.runs).toHaveLength(2);
    expect(result.runs![0].label).toBe('Rload=1000');
    const mid = (k: number) => result.runs![k].result.vectors.find((x) => x.name.toLowerCase() === 'v(n10)')!.re[0];
    expect(mid(0)).toBeCloseTo(5, 6);
    expect(mid(1)).toBeCloseTo(2.5, 6);
  });
});
