/**
 * Correctness review, round 4: a Parameter sweep (or `.step` card) of a DESIGN VARIABLE on a design
 * whose active assembly variant gives that variable its own expression.
 *
 * Two round-4 features meet here: step 3 rebuilds the netlist once per swept value by writing the
 * value into `Design.variables` (src/model/steps.ts `fill`), and step 4 lets a variant override a
 * global parameter (`DesignVariant.variables`), which `variantView` lays OVER `Design.variables`
 * when the netlister runs. The override therefore wins over every swept value: all runs of the
 * sweep are the same circuit, and the learner gets an overlaid "family" whose curves coincide,
 * with no message.
 *
 * Reference: R1 = {Rx}; sweeping Rx over 1 kΩ and 2 kΩ must give R1 = 1000 and 2000 Ω in the two
 * rebuilt netlists (and an RC corner 1/(2πRC) per value), whichever variant is active.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { applySteps } from '../../../src/model/steps';
import { addVariant, setActiveVariant, setVariantVariable } from '../../../src/model/variants';
import type { AnalysisSpec, Netlist } from '../../../src/sim/netlist';
import type { Design } from '../../../src/model/types';

/** V1 -> R1 = {Rx} -> OUT -> C1 = 100 nF -> ground, Rx = 1k; variants "Std" and "Precise" (Rx = 5k). */
function rcWithVariant(): { design: Design; precise: string } {
  const b = new DesignBuilder('RC variants');
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
  b.design.variables = { Rx: '1k' };
  let d = b.design;
  d = addVariant(d, 'Std').design;
  const p = addVariant(d, 'Precise');
  d = setVariantVariable(p.design, p.id, 'Rx', '5k');
  return { design: setActiveVariant(d, p.id), precise: p.id };
}

const r1Of = (n: Netlist): unknown => n.elements.find((e) => e.name === 'R1')?.value;

describe('sweeping a design variable that the active variant overrides', () => {
  it('Parameter sweep of Rx: each rebuilt netlist carries the swept value, not the variant value', () => {
    const { design } = rcWithVariant();
    const spec: AnalysisSpec = { type: 'paramsweep', target: 'Rx', param: 'value', global: true, values: [1000, 2000], base: { type: 'op' } };
    const out = applySteps(design, spec);
    expect(out.errors).toEqual([]);
    const netlists = (out.spec as Extract<AnalysisSpec, { type: 'paramsweep' }>).netlists;
    expect(netlists).toHaveLength(2);
    // today both netlists hold R1 = 5000 (the Precise variant's Rx): the sweep does nothing
    expect(netlists!.map(r1Of)).toEqual([1000, 2000]);
  });

  it('a .step card in the circuit SPICE text sweeps Rx under the active variant too', () => {
    const { design } = rcWithVariant();
    const d: Design = { ...design, customSpice: '.step param Rx list 1k 2k' };
    const out = applySteps(d, { type: 'op' });
    expect(out.errors).toEqual([]);
    expect(out.stepped).toBe(true);
    const netlists = (out.spec as Extract<AnalysisSpec, { type: 'paramsweep' }>).netlists;
    expect(netlists!.map(r1Of)).toEqual([1000, 2000]);
  });
});
