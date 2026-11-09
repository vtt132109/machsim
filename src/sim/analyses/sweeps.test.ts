import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import { BOLTZ, CHARGE, KELVIN } from '../device';
import type { AnalysisSpec, ElementIR, ModelCard } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { cap, idc, model, netlist, res, vdc, vsrc } from '../engine/testing';

function run(elements: ElementIR[], spec: AnalysisSpec, models: ModelCard[] = [], saves: string[] = []): AnalysisResult {
  const [r] = runAnalyses(netlist(elements, [spec], { models, saves }));
  expect(r.error).toBeUndefined();
  return r;
}

const V = 5;
const divider = [vdc('V1', 'in', '0', V), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 3e3)];
const diode = (name: string, a: string, b: string, m: string): ElementIR => ({ type: 'D', name, nodes: [a, b], params: {}, model: m });

/** SPICE3 diode voltage at current I and temperature tC (°C), TNOM 27 °C, EG 1.11, XTI 3, N 1. */
function diodeVoltage(I: number, IS: number, tC: number): number {
  const T = tC + KELVIN;
  const Tn = 27 + KELVIN;
  const vt = (BOLTZ * T) / CHARGE;
  const isT = IS * Math.exp(((T / Tn - 1) * 1.11) / vt + 3 * Math.log(T / Tn));
  // solve I = isT (e^{v/vt} - 1) + gmin v
  let lo = 0;
  let hi = 2;
  for (let k = 0; k < 200; k++) {
    const v = (lo + hi) / 2;
    if (isT * (Math.exp(v / vt) - 1) + 1e-12 * v < I) lo = v;
    else hi = v;
  }
  return lo;
}

describe('parameter sweep', () => {
  it('sweeps an element value and aggregates operating points into curves', () => {
    const values = [1e3, 2e3, 3e3, 4e3];
    const r = run(divider, { type: 'paramsweep', target: 'R2', param: 'value', values, base: { type: 'op' } });
    expect(r.runs?.map((x) => x.label)).toEqual(['R2=1000', 'R2=2000', 'R2=3000', 'R2=4000']);
    expect(r.scale?.name).toBe('R2');
    expect(Array.from(r.scale?.re ?? [])).toEqual(values);
    const vout = findVector(r, 'V(out)');
    expect(vout?.unit).toBe('V');
    values.forEach((r2, k) => expect(vout?.re[k]).toBeCloseTo((V * r2) / (1e3 + r2), 12));
    // the input netlist is untouched: a plain OP still gives the nominal value
    const [op] = runAnalyses(netlist(divider, [{ type: 'op' }]));
    expect(op.scalars?.['V(out)']).toBeCloseTo(3.75, 12);
  });

  it('keeps per-run curves for swept AC analyses', () => {
    const els = [vsrc('V1', 'in', '0', { dc: 0, acMag: 1 }), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)];
    const r = run(els, {
      type: 'paramsweep',
      target: 'C1',
      param: 'value',
      values: [1e-6, 2e-6],
      base: { type: 'ac', sweep: 'lin', points: 1, fstart: 159.15494309189535, fstop: 159.15494309189535 },
    });
    expect(r.scale).toBeUndefined();
    expect(r.runs).toHaveLength(2);
    const h = (k: number) => {
      const v = findVector(r.runs?.[k].result as AnalysisResult, 'V(out)');
      return Math.hypot(v?.re[0] as number, v?.im?.[0] as number);
    };
    expect(h(0)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(h(1)).toBeCloseTo(1 / Math.sqrt(5), 9);
  });

  it('sweeps a model parameter', () => {
    const r = run([idc('I1', '0', 'a', 1e-3), diode('D1', 'a', '0', 'DM')], {
      type: 'paramsweep',
      target: 'DM',
      param: 'is',
      model: true,
      values: [1e-15, 1e-14, 1e-13],
      base: { type: 'op' },
    }, [model('DM', 'D', { is: 1e-14 })]);
    expect(r.scale?.name).toBe('DM:is');
    const va = findVector(r, 'V(a)')?.re as Float64Array;
    [1e-15, 1e-14, 1e-13].forEach((is, k) => expect(Math.abs(va[k] - diodeVoltage(1e-3, is, 27))).toBeLessThan(1e-7));
    // decade of IS = vt ln 10
    expect(va[0] - va[1]).toBeCloseTo(((BOLTZ * (27 + KELVIN)) / CHARGE) * Math.log(10), 6);
  });

  it('reports unknown targets as errors', () => {
    const [a, b] = runAnalyses(
      netlist(divider, [
        { type: 'paramsweep', target: 'R9', param: 'value', values: [1], base: { type: 'op' } },
        { type: 'paramsweep', target: 'R1', param: 'value', values: [], base: { type: 'op' } },
      ]),
    );
    expect(a.error).toMatch(/R9/);
    expect(b.error).toMatch(/no sweep values/);
  });

  it('keeps going when a run fails', () => {
    const r = run(divider, { type: 'paramsweep', target: 'R2', param: 'value', values: [3e3, 1e3], base: { type: 'tf', output: 'V(out)', src: 'VX' } });
    expect(r.runs?.every((x) => x.result.error !== undefined)).toBe(true);
    expect(r.warnings[0]).toMatch(/2 of 2 runs failed/);
  });
});

describe('temperature sweep', () => {
  it('gives the diode forward-voltage temperature coefficient of about -2 mV/°C', () => {
    const temps = [0, 25, 50, 75, 100];
    const r = run([idc('I1', '0', 'a', 1e-3), diode('D1', 'a', '0', 'DM')], { type: 'tempsweep', temps, base: { type: 'op' } }, [
      model('DM', 'D', { is: 1e-14 }),
    ]);
    expect(r.scale?.name).toBe('temp');
    expect(r.scale?.unit).toBe('degC');
    const va = findVector(r, 'V(a)')?.re as Float64Array;
    temps.forEach((t, k) => expect(Math.abs(va[k] - diodeVoltage(1e-3, 1e-14, t))).toBeLessThan(1e-6));
    for (let k = 1; k < temps.length; k++) {
      const slope = (va[k] - va[k - 1]) / (temps[k] - temps[k - 1]);
      expect(slope).toBeLessThan(-1.6e-3);
      expect(slope).toBeGreaterThan(-2.4e-3);
    }
    expect(r.runs?.[0].label).toBe('temp=0');
  });
});

describe('nested sweep', () => {
  it('builds one curve per outer value for operating-point bases', () => {
    const r = run(divider, {
      type: 'nestedsweep',
      outer: { target: 'R1', param: 'value', values: [1e3, 2e3] },
      inner: { target: 'R2', param: 'value', values: [1e3, 2e3, 3e3] },
      base: { type: 'op' },
    });
    expect(r.runs).toHaveLength(2);
    expect(r.runs?.[1].label).toBe('R1=2000');
    const curve = r.runs?.[1].result as AnalysisResult;
    expect(curve.scale?.name).toBe('R2');
    const v = findVector(curve, 'V(out)')?.re as Float64Array;
    [1e3, 2e3, 3e3].forEach((r2, k) => expect(v[k]).toBeCloseTo((V * r2) / (2e3 + r2), 12));
    expect(r.table?.rows).toHaveLength(6);
    expect(r.table?.columns.slice(0, 2)).toEqual(['R1', 'R2']);
    const outCol = r.table?.columns.indexOf('V(out)') as number;
    expect(r.table?.rows[5][outCol] as number).toBeCloseTo((V * 3e3) / 5e3, 12);
  });

  it('returns one run per combination for swept-curve bases', () => {
    const r = run(divider, {
      type: 'nestedsweep',
      outer: { target: 'R1', param: 'value', values: [1e3, 2e3] },
      inner: { target: 'R2', param: 'value', values: [1e3, 3e3] },
      base: { type: 'dc', src: 'V1', start: 0, stop: 1, step: 0.5 },
    });
    expect(r.runs?.map((x) => x.label)).toEqual(['R1=1000, R2=1000', 'R1=1000, R2=3000', 'R1=2000, R2=1000', 'R1=2000, R2=3000']);
    const last = findVector(r.runs?.[3].result as AnalysisResult, 'V(out)')?.re as Float64Array;
    expect(last[2]).toBeCloseTo(0.6, 12);
  });
});

describe('batch', () => {
  it('runs every item and keeps failures local', () => {
    const r = run(divider, {
      type: 'batch',
      items: [{ type: 'op' }, { type: 'tf', output: 'V(out)', src: 'V1' }, { type: 'tf', output: 'V(nope)', src: 'V1' }],
    });
    expect(r.runs?.map((x) => x.label)).toEqual(['1: Operating point', '2: Transfer function', '3: Transfer function']);
    expect(r.runs?.[0].result.scalars?.['V(out)']).toBeCloseTo(3.75, 12);
    expect(r.runs?.[1].result.scalars?.gain).toBeCloseTo(0.75, 12);
    expect(r.runs?.[2].result.error).toMatch(/nope/);
    expect(r.warnings[0]).toMatch(/1 of 3 runs failed/);
  });

  it('reports progress monotonically across nested runs', () => {
    const seen: number[] = [];
    runAnalyses(
      netlist(divider, [{ type: 'paramsweep', target: 'R2', param: 'value', values: [1e3, 2e3, 3e3, 4e3], base: { type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.01 } }]),
      { onProgress: (f) => seen.push(f) },
    );
    expect(seen.length).toBeGreaterThan(4);
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1] - 1e-12);
    expect(seen[seen.length - 1]).toBe(1);
  });
});
