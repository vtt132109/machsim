/**
 * Instructor mode "hide part values" in the editor: copy / paste keeps the values inside the
 * restricted design, Find & replace skips them, a block saved as its own file keeps the
 * restrictions, and the helpers that decide it (restrictions.ts) behave as documented.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import { DesignBuilder } from '../../model/designkit';
import { findInDesign, replaceInDesign, searchableFields } from '../../model/findReplace';
import { clipboardRestrictionKey, createRestrictions, partValuesHidden, pasteAllowed, valuesHidden } from '../../model/restrictions';
import { newDesign, type Design } from '../../model/types';
import { createEditor } from './editorStore';
import { childAsDesign, createChild } from './hierarchyOps';

const SALT = '00112233445566778899aabbccddeeff';

async function lab(hideValues = true, password = 'thay-giao'): Promise<Design> {
  const b = new DesignBuilder('Lab');
  b.part('sources/dc-voltage', 'V1', 0, 0, { value: '9' });
  b.part('basic/resistor', 'R1', 100, 0, { value: '4.7k' });
  b.part('instruments/multimeter', 'XMM1', 200, 0);
  const d = b.design;
  d.restrictions = await createRestrictions(password, { hideValues }, d, SALT);
  return d;
}

describe('restriction helpers', () => {
  it('a clipboard from a hidden-values design only pastes under the same restrictions', async () => {
    const hidden = await lab();
    const key = clipboardRestrictionKey(hidden);
    expect(key).not.toBeNull();
    expect(pasteAllowed(key, hidden)).toBe(true);
    expect(pasteAllowed(key, newDesign('free'))).toBe(false);
    expect(pasteAllowed(key, await lab(true, 'other password'))).toBe(false);
    // nothing hidden: pasting is always allowed
    expect(clipboardRestrictionKey(await lab(false))).toBeNull();
    expect(pasteAllowed(null, newDesign('free'))).toBe(true);
  });

  it('hides the values of components, not the settings of instruments and power symbols', async () => {
    const d = await lab();
    expect(partValuesHidden(d, getPart('basic/resistor'))).toBe(true);
    expect(partValuesHidden(d, getPart('instruments/multimeter'))).toBe(false);
    expect(partValuesHidden(d, getPart('sources/ground'))).toBe(false);
    expect(partValuesHidden(newDesign('x'), getPart('basic/resistor'))).toBe(false);
  });
});

describe('copy and paste', () => {
  it('works inside the restricted design (values stay masked there)', async () => {
    const ed = createEditor({ lookup: getPart, design: await lab() });
    ed.actions.selectAll();
    expect(ed.actions.copy()).toBe(true);
    expect(ed.actions.paste()).toBe(true);
    const d = ed.getState().design;
    expect(d.sheets[0].parts.filter((p) => p.partId === 'basic/resistor').length).toBe(2);
    expect(valuesHidden(d)).toBe(true);
  });

  it('is refused in another document, with a message saying why', async () => {
    const ed = createEditor({ lookup: getPart, design: await lab() });
    ed.actions.selectAll();
    ed.actions.copy();
    ed.actions.loadDesign(newDesign('Bai lam'), 'Bai lam.msim');
    expect(ed.actions.paste()).toBe(false);
    expect(ed.getState().design.sheets[0].parts).toEqual([]);
    const last = ed.getState().simMessages.at(-1);
    expect(last).toMatchObject({ severity: 'warning', source: 'instructor' });
  });

  it('a clipboard from an unrestricted design pastes anywhere', async () => {
    const ed = createEditor({ lookup: getPart, design: await lab(false) });
    ed.actions.selectAll();
    ed.actions.copy();
    ed.actions.loadDesign(newDesign('Other'), 'Other.msim');
    expect(ed.actions.paste()).toBe(true);
    expect(ed.getState().design.sheets[0].parts.length).toBe(3);
  });
});

describe('find & replace and saved blocks', () => {
  it('does not search or replace hidden values (other fields still work)', async () => {
    const d = await lab();
    expect(searchableFields(d).has('value')).toBe(false);
    expect(findInDesign(d, '4.7k')).toEqual([]);
    expect(findInDesign(d, 'R1').map((m) => m.field)).toEqual(['refdes']);
    const r = replaceInDesign(d, '4.7k', '1k', { fields: ['value'] });
    expect(r.count).toBe(0);
    expect(r.design.sheets[0].parts.find((p) => p.refdes === 'R1')!.params.value).toBe('4.7k');
    // without restrictions the value is found
    expect(findInDesign(await lab(false), '4.7k').map((m) => m.text)).toEqual(['4.7k']);
  });

  it('a block saved as its own file keeps the instructor restrictions', async () => {
    const d = await lab();
    const { design, childId } = createChild(d, { kind: 'subcircuit', name: 'BLK' });
    const own = childAsDesign(design, childId)!;
    expect(own.restrictions).toEqual(d.restrictions);
    expect(valuesHidden(own)).toBe(true);
  });
});
