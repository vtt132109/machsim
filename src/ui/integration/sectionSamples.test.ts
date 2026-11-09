/**
 * Sample 73: one LM358 in two sections with two assembly variants. The output follows the active
 * variant: gain 1 + R2/R1 = 2 (R2 = 10k) and 11 (R2 = 100k) on a 0.5 V input.
 */
import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../../model/netlister';
import { activeVariant, setActiveVariant } from '../../model/variants';
import { spareGates } from '../../model/reports';
import { runAnalyses } from '../../sim';
import { dualOpampVariantsSample } from './sectionSamples';
import type { Design } from '../../model/types';

const vout = (d: Design): number => {
  const nb = buildNetlist(d, { includeAnalysis: false });
  expect(nb.erc.filter((m) => m.severity === 'error' || m.severity === 'warning')).toEqual([]);
  const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
  const net = nb.nets.find((n) => n.displayName === 'OUT')!;
  return op.vectors.find((v) => v.name.toLowerCase() === `v(${net.name})`.toLowerCase())!.re[0];
};

describe('dual op-amp sample with variants', () => {
  it('has one chip U1 with both sections and two variants', () => {
    const d = dualOpampVariantsSample();
    expect(d.variants?.list.map((v) => v.name)).toEqual(['Độ lợi 2', 'Độ lợi 11']);
    expect(d.sheets[0].parts.filter((p) => p.refdes === 'U1').map((p) => p.partId)).toEqual(['analog/lm358-dual-a', 'analog/lm358-dual-b']);
    // the supply is wired on section A only and nothing is reported
    const entry = spareGates(d).find((e) => e.path === 'U1')!;
    expect(entry.used).toBe(2);
  });

  it('the output follows the active variant: 1 V and 5.5 V', () => {
    const d = dualOpampVariantsSample();
    expect(activeVariant(d)?.name).toBe('Độ lợi 2');
    // 0.5 V x (1 + 10k/10k) = 1 V, plus the 2 mV input offset of the model amplified by the two stages
    expect(Math.abs(vout(d) - 1.0)).toBeLessThan(0.02);
    const second = setActiveVariant(d, d.variants!.list[1].id);
    expect(Math.abs(vout(second) - 5.5)).toBeLessThan(0.1);
    // the saved design still has the 10k value
    expect(d.sheets[0].parts.find((p) => p.refdes === 'R2')?.params.value).toBe('10k');
  });
});
