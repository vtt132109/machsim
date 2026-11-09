/**
 * Correctness review, round 4: assembly variants (step 4) meet multi-section packages (step 4).
 *
 * The variant manager lists every SECTION of a chip as its own row with its own "Lắp" (fitted)
 * box: sample 73 shows U1A and U1B of one LM358. A section is not a part that can be left off the
 * board on its own — U1A and U1B are the same chip — but nothing stops the learner from clearing
 * U1A's box. The netlister then leaves U1A out of the chip's pin map (sections that do not take
 * part are idle), and because the supply pins V+ / V- were wired on U1A only (the sample says
 * "wiring them on one section is enough"), U1B silently loses its supply: V(OUT) drops from
 * 1.008 V to 0 V with no ERC message, while the BOM still lists U1 as fitted.
 *
 * Reference (sample 73, variant "Độ lợi 2"): Vout = 2 x 0.5 V (+ the LM358's few-mV offset) = 1.008 V.
 * Accepted outcomes: the package is fitted / not fitted as one unit, OR U1B is still powered
 * (Vout = 1.008 V), OR an ERC message names U1.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../helpers';
import { parseDesign } from '../../../src/model/serialize';
import { isFitted, setFitted } from '../../../src/model/variants';
import { buildNetlist } from '../../../src/model/netlister';
import { runAnalyses } from '../../../src/sim';
import type { Design } from '../../../src/model/types';

function vout(d: Design): { v: number; erc: string[] } {
  const b = buildNetlist(d, { includeAnalysis: false });
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  const v = r.vectors.find((x) => x.name === 'V(OUT)');
  return { v: v ? v.re[0] : Number.NaN, erc: b.erc.map((m) => `${m.refdes ?? ''} ${m.message}`) };
}

describe('clearing "fitted" on one section of a dual op-amp', () => {
  const d = parseDesign(readFileSync(EXAMPLES_DIR + '73-dual-opamp-variants.msim', 'utf8'));
  const variant = d.variants!.list[0].id;
  const u1a = d.sheets[0].parts.find((p) => p.partId === 'analog/lm358-dual-a')!;
  const u1b = d.sheets[0].parts.find((p) => p.partId === 'analog/lm358-dual-b')!;

  it('reference: both sections fitted give Vout = 1.008 V', () => {
    expect(vout(d).v).toBeCloseTo(1.008, 2);
  });

  it('leaves the design consistent (whole chip, still powered, or an ERC message)', () => {
    const next = setFitted(d, [u1a.id], variant, false);
    const b = next.sheets[0].parts.find((p) => p.id === u1b.id)!;
    const asUnit = !isFitted(b, variant);
    const r = vout(next);
    const powered = Math.abs(r.v - 1.008) < 0.02;
    const told = r.erc.some((m) => /U1/.test(m));
    expect(asUnit || powered || told, `U1B fitted=${!asUnit}, Vout=${r.v} V, ERC=${JSON.stringify(r.erc)}`).toBe(true);
  });
});
