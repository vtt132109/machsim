/**
 * Correctness review, round 4: Tools › Reference designator prefixes (step 2) meets the per-copy
 * state of hierarchical blocks (step 3).
 *
 * A setting changed inside ONE copy of a block (a switch, a meter mode, a value) is stored on the
 * top-level block instance as `PartInstance.inner`, keyed by the part's designator inside the child
 * design ("R1", "XMM1"). "Rename existing parts" of the prefix rules (`applyRulesToDesign`) renames
 * the parts of the child designs too (R1 -> A_R1) but leaves the `inner` keys as they were, so every
 * per-copy setting silently falls back to the shared value of the block design.
 *
 * Reference: sample 91 (two copies of a 1k / {RB} divider fed with 5 V). Copy X2 gets its own
 * R1 = 5k: V(MID) of X2 = 5 · 3k / (5k + 3k) = 1.875 V. After renaming with the prefix "A_" the copy
 * (now A_X2) must still have R1 = 5k.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../helpers';
import { parseDesign, serializeDesign } from '../../../src/model/serialize';
import { applyRulesToDesign } from '../../../src/model/refdesRules';
import { liveParams, resolveLivePart, withLiveParam } from '../../../src/model/hierarchy';
import { buildNetlist } from '../../../src/model/netlister';
import { runAnalyses } from '../../../src/sim';
import type { Design } from '../../../src/model/types';

const sample = (): Design => parseDesign(readFileSync(EXAMPLES_DIR + '91-block-meters.msim', 'utf8'));

function midOf(d: Design, block: string): number {
  const b = buildNetlist(d, { includeAnalysis: false });
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  const v = r.vectors.find((x) => x.name.toUpperCase() === `V(${block.toUpperCase()}.MID)`);
  if (!v) throw new Error(`no V(${block}.MID) in ${r.vectors.map((x) => x.name).join(', ')}`);
  return v.re[0];
}

describe('prefix rules keep the per-copy state of a block', () => {
  it('X2 with its own R1 = 5k reads 1.875 V (reference)', () => {
    const d0 = sample();
    const ref = resolveLivePart(d0, ['X2'], 'R1')!;
    const d = withLiveParam(d0, ref, 'value', '5k');
    expect(midOf(d, 'X2')).toBeCloseTo(1.875, 3);
    expect(midOf(d, 'X1')).toBeCloseTo(2.5, 3);
  });

  it('after renaming with the prefix "A_" the copy still has R1 = 5k', () => {
    const d0 = sample();
    const d = withLiveParam(d0, resolveLivePart(d0, ['X2'], 'R1')!, 'value', '5k');
    const renamed = applyRulesToDesign(d, { global: 'A_' }).design;
    // the design still saves and reopens
    const back = parseDesign(serializeDesign(renamed));
    const ref = resolveLivePart(back, ['A_X2'], 'A_R1');
    expect(ref).not.toBeNull();
    expect(liveParams(ref!).value).toBe('5k');
    expect(midOf(back, 'A_X2')).toBeCloseTo(1.875, 3);
  });
});
