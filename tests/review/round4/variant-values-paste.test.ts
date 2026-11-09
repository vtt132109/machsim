/**
 * Correctness review, round 4: global parameters that only a VARIANT value refers to.
 *
 * Step 1 made paste and snippets carry the closure of global parameters the copied parts need
 * (`neededVariables` in src/model/sanitize.ts), and step 4 let a variant give a part its own
 * parameter values (`PartInstance.variantValues`) and give a global parameter its own expression
 * (`DesignVariant.variables`). `neededVariables` only reads `PartInstance.params`, so:
 *
 *  1. a part whose value is "1k" in one variant and "{Rp}" in another arrives in the target
 *     without Rp: the design saves, but the netlist of that variant fails with
 *     "undefined parameter 'Rp'" and the paste report says nothing;
 *  2. the same holds for a snippet written from that selection;
 *  3. a variant's own expression of a global parameter (Precise: Rx = 2k) is not carried at all,
 *     so the pasted circuit builds with Rx = 1k in the target's Precise variant, silently.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { addVariant, setActiveVariant, setVariantParam, setVariantVariable, variantView } from '../../../src/model/variants';
import { buildNetlist } from '../../../src/model/netlister';
import { buildSnippet } from '../../../src/model/snippet';
import { copyItems, pasteItems } from '../../../src/ui/store/designOps';
import { partLookup } from '../../../src/ui/store';
import type { Design } from '../../../src/model/types';
import type { SelItem } from '../../../src/ui/store/types';

/** V1 (5 V) across R1; R1 = 1k, but {Rp} (= 2.2k) in the variant "Precise". */
function source(): { design: Design; precise: string } {
  const b = new DesignBuilder('Source');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const g = b.part('sources/ground', 'G1', 200, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r, '1', 'IN');
  b.labelPin(r, '2', 'GND0');
  b.labelPin(v, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  b.design.variables = { Rp: '2.2k' };
  let d = b.design;
  d = addVariant(d, 'Std').design;
  const p = addVariant(d, 'Precise');
  d = p.design;
  const rid = d.sheets[0].parts.find((x) => x.refdes === 'R1')!.id;
  d = setVariantParam(d, rid, p.id, 'value', '{Rp}');
  return { design: d, precise: p.id };
}

/** A target with the same two variant names. */
function target(): { design: Design; precise: string } {
  let d = new DesignBuilder('Target').design;
  d = addVariant(d, 'Std').design;
  const p = addVariant(d, 'Precise');
  return { design: p.design, precise: p.id };
}

const selectAll = (d: Design): SelItem[] => [
  ...d.sheets[0].parts.map((p) => ({ kind: 'part' as const, id: p.id })),
  ...d.sheets[0].labels.map((l) => ({ kind: 'label' as const, id: l.id })),
];

const errorsOf = (d: Design): string[] => buildNetlist(d).erc.filter((m) => m.severity === 'error').map((m) => m.message);

describe('a variant value that refers to a global parameter', () => {
  it('the source design builds in its Precise variant (reference)', () => {
    const { design, precise } = source();
    expect(errorsOf(setActiveVariant(design, precise))).toEqual([]);
  });

  it('paste into another design brings the parameter along, so the Precise variant still builds', () => {
    const src = source();
    const clip = copyItems(src.design, src.design.sheets[0].id, selectAll(src.design), partLookup)!;
    const tgt = target();
    const res = pasteItems(tgt.design, tgt.design.sheets[0].id, clip, { x: 0, y: 0 }, partLookup);
    // the variant id was remapped by name: R1 keeps '{Rp}' in Precise
    const r1 = res.design.sheets[0].parts.find((p) => p.refdes === 'R1')!;
    expect(r1.variantValues?.[tgt.precise]?.params?.value).toBe('{Rp}');
    // ... so Rp must have come along (today: variables {} and no note)
    expect(res.design.variables).toHaveProperty('Rp', '2.2k');
    expect(errorsOf(setActiveVariant(res.design, tgt.precise))).toEqual([]);
  });

  it('a snippet of that selection carries the parameter', () => {
    const src = source();
    const clip = copyItems(src.design, src.design.sheets[0].id, selectAll(src.design), partLookup)!;
    const snip = buildSnippet(src.design, clip, new Date('2026-11-10T00:00:00Z'));
    expect(snip.variables ?? {}).toHaveProperty('Rp', '2.2k');
  });
});

describe("a variant's own expression of a global parameter", () => {
  it('pasting R1 = {Rx} keeps the Precise build at Rx = 2k (or says it could not)', () => {
    const b = new DesignBuilder('Source');
    b.part('basic/resistor', 'R1', 0, 0, { value: '{Rx}' });
    b.design.variables = { Rx: '1k' };
    let a = addVariant(b.design, 'Std').design;
    const p = addVariant(a, 'Precise');
    a = setVariantVariable(p.design, p.id, 'Rx', '2k');
    expect(variantView(setActiveVariant(a, p.id)).variables.Rx).toBe('2k');

    const clip = copyItems(a, a.sheets[0].id, [{ kind: 'part', id: a.sheets[0].parts[0].id }], partLookup)!;
    const tgt = target();
    const res = pasteItems(tgt.design, tgt.design.sheets[0].id, clip, { x: 0, y: 0 }, partLookup);
    const precise = variantView(setActiveVariant(res.design, tgt.precise)).variables.Rx;
    // either the variant expression came along, or the paste report names what was left behind
    const reported = res.notes.some((n) => n.names.some((x) => /Rx/.test(x) && /Precise/i.test(x)) || /variantVariable/i.test(n.code));
    expect(precise === '2k' || reported, `Precise Rx in the target = ${precise}; notes ${JSON.stringify(res.notes)}`).toBe(true);
  });
});
