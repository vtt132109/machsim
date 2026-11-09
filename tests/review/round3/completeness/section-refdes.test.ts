/**
 * Completeness review round 3 — "Ký hiệu nhiều phần" (multi-section symbols, step 7) is claimed
 * implemented, but every tool that (re)assigns reference designators treats the sections of ONE
 * package as duplicate designators and splits the chip.
 *
 * A multi-section package exists only because its sections share one refdes (src/model/sections.ts
 * groups by refdes). The learner flow the help page describes is: place 7400A, place 7400B, give
 * both the designator U1. Then:
 *
 *  1. Tools › Annotate (`annotateDesign`, mode 'missing' — also in the beginner allowlist) keeps the
 *     first U1 and renumbers the other section as a "duplicate" → U1 + U2 = two 7400 chips.
 *  2. Tools › Renumber (`annotateDesign`, mode 'all') numbers every section separately → two chips.
 *  3. Copy + Paste of both sections (`pasteItems`) gives them U2 and U3 → two chips again
 *     (Multisim pastes them as one new package, U2A/U2B). Placing a snippet goes through the same
 *     `pasteItems(…, { keepRefdes: true })` and splits the same way.
 *  4. Edit › Find & replace (refdes U1 → U7) renames the first section and SKIPS the second as
 *     "already used" → U7 + U1, two chips.
 *
 * The observable consequence is a bill of materials (and a netlist / PCB netlist) with two 7400
 * packages where the learner drew one. Expected: sections of one package keep sharing one
 * designator through all four operations.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../../../src/library';
import { annotateDesign } from '../../../../src/model/annotate';
import { buildBom } from '../../../../src/model/bom';
import { DesignBuilder } from '../../../../src/model/designkit';
import { replaceInDesign } from '../../../../src/model/findReplace';
import type { Design } from '../../../../src/model/types';
import { copyItems, pasteItems } from '../../../../src/ui/store/designOps';

/** Gate A and gate B of ONE 7400 (both designated U1), plus an ordinary resistor R1. */
function oneChip(): Design {
  const b = new DesignBuilder('Một vi mạch 7400');
  b.part('ttl/7400-a', 'U1', 0, 200);
  b.part('ttl/7400-b', 'U1', 200, 0);
  b.part('basic/resistor', 'R1', 400, 0, { value: '1k' });
  return b.design;
}

const sectionRefs = (d: Design): string[] =>
  d.sheets.flatMap((s) => s.parts).filter((p) => p.partId.startsWith('ttl/7400-')).map((p) => p.refdes);

/** number of 7400 packages the bill of materials lists */
const chips = (d: Design): number => buildBom(d).filter((r) => r.partId.startsWith('ttl/7400')).reduce((n, r) => n + r.quantity, 0);

describe('sections of one package keep one designator', () => {
  it('control: the drawn design is ONE 7400 in the BOM', () => {
    const d = oneChip();
    expect(sectionRefs(d)).toEqual(['U1', 'U1']);
    expect(chips(d)).toBe(1);
  });

  it('Tools › Annotate (missing designators only) leaves U1A / U1B together', () => {
    const d = annotateDesign(oneChip()).design;
    expect(new Set(sectionRefs(d)).size).toBe(1);
    expect(chips(d)).toBe(1);
  });

  it('Tools › Renumber (all) gives both sections the same new designator', () => {
    const d = annotateDesign(oneChip(), { mode: 'all' }).design;
    expect(new Set(sectionRefs(d)).size).toBe(1);
    expect(chips(d)).toBe(1);
  });

  for (const keepRefdes of [false, true]) {
    it(`${keepRefdes ? 'placing a snippet of' : 'copy + paste of'} both sections makes ONE new package`, () => {
      const d = oneChip();
      const s = d.sheets[0];
      const sel = s.parts.filter((p) => p.partId.startsWith('ttl/7400-')).map((p) => ({ kind: 'part' as const, id: p.id }));
      const clip = copyItems(d, s.id, sel, getPart)!;
      const pasted = pasteItems(d, s.id, clip, { x: 0, y: 400 }, getPart, { keepRefdes }).design;
      const refs = sectionRefs(pasted);
      expect(refs.length).toBe(4);
      expect(new Set(refs.slice(2)).size).toBe(1);
      expect(chips(pasted)).toBe(2);
    });
  }

  it('Edit › Find & replace U1 → U7 renames the whole package', () => {
    const r = replaceInDesign(oneChip(), 'U1', 'U7', { fields: ['refdes'], wholeField: true });
    expect(r.skipped).toEqual([]);
    expect(sectionRefs(r.design)).toEqual(['U7', 'U7']);
    expect(chips(r.design)).toBe(1);
  });
});
