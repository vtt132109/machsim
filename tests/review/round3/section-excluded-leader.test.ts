/**
 * Review round 3: multi-section packages (step 7, src/model/sections.ts) meet "exclude from
 * simulation" and assembly variants (step 4, src/model/variants.ts variantView).
 *
 * packageGroups() picks the group's leader as the LOWEST placed index, whether or not that section
 * takes part in the simulation. buildNetlist() then skips the leader at the top of its loop when
 * `excludeFromSim` is set (which is exactly how variantView() removes a part that the active
 * variant does not fit), and every other section skips itself because it is not the leader. So
 * when gate A of a 7400 is excluded / not fitted, the WHOLE chip vanishes from the netlist, and
 * gate B — fitted, wired and expected to work — produces no output at all.
 *
 * Expected: with U1A excluded, U1B (an inverter fed with logic 1) still drives OUT low; with U1A
 * included, the chain gives OUT high. The excluded case fails today.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import { runAnalyses } from '../../../src/sim';

/** U1A and U1B of one 7400; U1B is a NAND wired as an inverter fed from a logic-1 switch. */
function design(excludeA: boolean) {
  const b = new DesignBuilder('Sections');
  b.part('sources/vcc', 'VCC1', 300, -140, { value: '5' });
  const ga = b.part('ttl/7400-a', 'U1', 0, 200);
  const gb = b.part('ttl/7400-b', 'U1', 200, 0);
  const src = b.part('sources/logic-switch', 'S1', -160, 0, { state: 'true' });
  b.part('sources/ground', 'GND1', -160, 100);
  b.connect(src, 'OUT', gb, '2A');
  b.wire(b.pin(gb, '2A'), b.pin(gb, '2B'));
  const out = b.pin(gb, '2Y');
  b.label('OUT', out.x, out.y);
  // gate A: its own inputs tied to the switch too, output unused
  b.connect(src, 'OUT', ga, '1A');
  b.wire(b.pin(ga, '1A'), b.pin(ga, '1B'));
  const inst = b.design.sheets[0].parts.find((p) => p.partId === 'ttl/7400-a')!;
  if (excludeA) inst.excludeFromSim = true;
  return b.design;
}

function outVolts(excludeA: boolean): number {
  const build = buildNetlist(design(excludeA));
  const chips = build.netlist.elements.filter((e) => e.name.toUpperCase().includes('U1'));
  expect(chips.length).toBeGreaterThan(0);
  const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars!['V(OUT)'];
}

describe('a 7400 whose first-placed section is excluded from the simulation', () => {
  it('control: with both sections included, NAND(1,1) = low', () => {
    expect(outVolts(false)).toBeLessThan(0.8);
  });
  it('with U1A excluded, U1B is still in the netlist and drives OUT low', () => {
    expect(outVolts(true)).toBeLessThan(0.8);
  });
});
