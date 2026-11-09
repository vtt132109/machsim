/**
 * Review round 2: instructor mode "hide part values" (src/model/restrictions.ts) must keep the
 * values of a restricted design out of sight. These tests reproduce two easy ways a student sees
 * them anyway, without touching the .msim JSON:
 *  - copy the parts, open a new document, paste: the pasted design carries no restrictions;
 *  - Edit > Find & replace (Ctrl+H) lists every matching parameter value of every part
 *    (src/ui/app/schematicDialogs.tsx shows FindMatch.text from findInDesign).
 * They fail while the leak exists.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { createRestrictions, valuesHidden } from '../../../src/model/restrictions';
import { findInDesign } from '../../../src/model/findReplace';
import { createEditor } from '../../../src/ui/store/editorStore';
import { partValueText } from '../../../src/ui/store/shapes';
import { getPart } from '../../../src/library';
import { newDesign, type Design } from '../../../src/model/types';

async function restrictedLab(): Promise<Design> {
  const b = new DesignBuilder('Lab');
  b.part('sources/dc-voltage', 'V1', 0, 0, { value: '9' });
  b.part('basic/resistor', 'R1', 100, 0, { value: '4.7k' });
  b.part('basic/resistor', 'R2', 200, 0, { value: '3.3k' });
  const d = b.design;
  d.restrictions = await createRestrictions('thay-giao', { hideValues: true }, d, '00112233445566778899aabbccddeeff');
  return d;
}

describe('instructor mode: hidden part values stay hidden', () => {
  it('control: the restricted design shows "?" for R1', async () => {
    const d = await restrictedLab();
    const r1 = d.sheets[0].parts.find((p) => p.refdes === 'R1')!;
    expect(valuesHidden(d)).toBe(true);
    expect(partValueText(r1, getPart(r1.partId), valuesHidden(d))).toBe('?');
  });

  it('copy → File > New → paste does not reveal the hidden values', async () => {
    const ed = createEditor({ lookup: getPart, design: await restrictedLab() });
    ed.actions.selectAll();
    const copied = ed.actions.copy();
    ed.actions.loadDesign(newDesign('Bai lam'), 'Bai lam.msim');
    const pasted = copied ? ed.actions.paste() : false;
    const d = ed.getState().design;
    const parts = d.sheets[0].parts.filter((p) => p.partId === 'basic/resistor');
    // either the copy is refused, or whatever lands in the new document is still masked
    const shown = parts.map((p) => partValueText(p, getPart(p.partId), valuesHidden(d)));
    // today: pasted = true, shown = ['4.7kΩ', '3.3kΩ'] in an unrestricted design
    expect({ pasted, shown: shown.filter((s) => /\d/.test(s)) }).toEqual({ pasted, shown: [] });
  });

  it('Find & replace does not list the hidden value texts', async () => {
    const d = await restrictedLab();
    const matches = findInDesign(d, 'k', { fields: ['value'] });
    expect(matches.map((m) => m.text)).not.toContain('4.7k');
    expect(matches.map((m) => m.text)).not.toContain('3.3k');
  });
});
