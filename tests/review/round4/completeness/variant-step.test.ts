/**
 * Completeness review round 4 — two round-4 features that are each claimed "implemented" do not
 * work together: assembly variants with their own global-parameter values (step 4,
 * `DesignVariant.variables`, applied by `variantView` in src/model/variants.ts) and the Parameter
 * sweep / `.step` of a design variable on a schematic (step 3, `applySteps` in src/model/steps.ts).
 *
 * `applySteps` rebuilds the netlist per value by writing the value into `design.variables`, but
 * `buildNetlist` then runs `variantView`, which merges the ACTIVE variant's own expression for the
 * same name over it (`{ ...design.variables, ...v.variables }`). As soon as the active variant gives
 * the swept variable its own value (exactly the "two gain variants" situation of sample 73 and the
 * step-sweep lesson), every run of the sweep silently uses the variant's value: the learner sees N
 * identical curves labelled Rx=1000, Rx=4700, … and no message.
 *
 * Expected (textbook): fc = 1 / (2π·Rx·C) for each swept value, whatever variant is active — the
 * sweep value is the most specific setting, as it is without variants.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../../src/model/designkit';
import { buildNetlist } from '../../../../src/model/netlister';
import { applySteps } from '../../../../src/model/steps';
import type { Design } from '../../../../src/model/types';
import { runAnalyses } from '../../../../src/sim';
import type { AnalysisSpec } from '../../../../src/sim/netlist';
import type { AnalysisResult } from '../../../../src/sim/results';

const C = 100e-9;
const corner = (r: number): number => 1 / (2 * Math.PI * r * C);
const AC: AnalysisSpec = { type: 'ac', sweep: 'dec', points: 40, fstart: 10, fstop: 1e5 };

/** V1 (AC 1 V) -> R1 = {Rx} -> OUT -> C1 = 100 nF -> ground; Rx = 1k, variant "Cao" gives Rx = 2k. */
function rcWithVariant(active: 'v1' | 'v2', customSpice?: string): Design {
  const b = new DesignBuilder('RC + phương án');
  const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '1', freq: '1k' });
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
  const d = b.design;
  d.variables = { Rx: '1k' };
  d.variants = { list: [{ id: 'v1', name: 'Thường' }, { id: 'v2', name: 'Cao', variables: { Rx: '2k' } }], active };
  if (customSpice) d.customSpice = customSpice;
  return d;
}

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

function sweep(d: Design, spec: AnalysisSpec): AnalysisResult {
  const build = buildNetlist(d, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const out = applySteps(d, spec, (n) => ({ ...n, analyses: [] }));
  expect(out.errors).toEqual([]);
  const [result] = runAnalyses({ ...build.netlist, analyses: [out.spec] });
  expect(result.error).toBeUndefined();
  return result;
}

const values = [1000, 4700];
const spec: AnalysisSpec = { type: 'paramsweep', target: 'Rx', param: 'value', global: true, values, base: AC };

describe('Parameter sweep of a design variable while an assembly variant is active', () => {
  it('control: with the default variant active (no own value) each run has fc = 1/(2π·Rx·C)', () => {
    const r = sweep(rcWithVariant('v1'), spec);
    expect(r.runs).toHaveLength(2);
    r.runs!.forEach((run, k) => expect(minus3dB(run.result) / corner(values[k])).toBeCloseTo(1, 2));
  });

  it('control: the active variant\'s own Rx = 2k is what a plain AC run uses', () => {
    const d = rcWithVariant('v2');
    const build = buildNetlist(d, { includeAnalysis: false });
    const [r] = runAnalyses({ ...build.netlist, analyses: [AC] });
    expect(minus3dB(r) / corner(2000)).toBeCloseTo(1, 2);
  });

  it('with variant "Cao" (Rx = 2k) active, sweeping Rx over 1k and 4.7k still gives fc = 1/(2π·Rx·C) per run', () => {
    const r = sweep(rcWithVariant('v2'), spec);
    expect(r.runs).toHaveLength(2);
    // today both runs report fc = 796 Hz (Rx = 2k): the variant's expression replaces the swept value
    r.runs!.forEach((run, k) => expect(minus3dB(run.result) / corner(values[k])).toBeCloseTo(1, 2));
  });

  it('the same through the circuit\'s own `.step param Rx list 1k 4.7k` card', () => {
    const d = rcWithVariant('v2', '.step param Rx list 1k 4.7k');
    const r = sweep(d, AC);
    expect(r.runs).toHaveLength(2);
    r.runs!.forEach((run, k) => expect(minus3dB(run.result) / corner(values[k])).toBeCloseTo(1, 2));
  });
});
