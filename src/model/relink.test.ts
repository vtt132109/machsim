/**
 * A contact names its coil by designator: renaming, renumbering and pasting must keep the link
 * (otherwise the ERC says "there is no coil" after an innocent Renumber).
 */
import { describe, expect, it } from 'vitest';
import { getPart, loadAllGroups } from '../library';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { createEditor } from '../ui/store/editorStore';
import { relinkPastedContacts, relinkRenamedCoils } from './relink';
import type { Design } from './types';

await loadAllGroups();

/** coil K1 + K2, contacts naming them, a resistor named K1X that only looks like a coil */
function design(): Design {
  const b = new DesignBuilder('relink');
  b.part('electromechanical/coil-dc-12v', 'K1', 0, 0);
  b.part('electromechanical/coil-dc-12v', 'K2', 200, 0);
  b.part('electromechanical/relay-contact-no', 'KC1', 0, 200, { coil: 'K1' });
  b.part('electromechanical/relay-contact-no', 'KC2', 200, 200, { coil: ' k2 ' });
  b.part('electromechanical/relay-contact-nc', 'KC3', 400, 200, { coil: 'K1' });
  b.part('basic/resistor', 'R1', 400, 0);
  return b.design;
}

const coilOf = (d: Design, refdes: string): string => d.sheets[0].parts.find((p) => p.refdes === refdes)!.params.coil;
const idOf = (d: Design, refdes: string): string => d.sheets[0].parts.find((p) => p.refdes === refdes)!.id;

describe('relinkRenamedCoils', () => {
  it('a renamed coil takes every contact that named it, however the name was written', () => {
    const before = design();
    const after: Design = { ...before, sheets: [{ ...before.sheets[0], parts: before.sheets[0].parts.map((p) => (p.refdes === 'K2' ? { ...p, refdes: 'K7' } : p)) }] };
    const out = relinkRenamedCoils(before, after, getPart);
    expect(coilOf(out, 'KC2')).toBe('K7');
    expect(coilOf(out, 'KC1')).toBe('K1');
  });

  it('two coils that swap names swap their contacts too (no sequential overwrite)', () => {
    const before = design();
    const after: Design = { ...before, sheets: [{ ...before.sheets[0], parts: before.sheets[0].parts.map((p) => (p.refdes === 'K1' ? { ...p, refdes: 'K2' } : p.refdes === 'K2' ? { ...p, refdes: 'K1' } : p)) }] };
    const out = relinkRenamedCoils(before, after, getPart);
    expect(coilOf(out, 'KC1')).toBe('K2');
    expect(coilOf(out, 'KC3')).toBe('K2');
    expect(coilOf(out, 'KC2')).toBe('K1');
  });

  it('renaming something that is not a driver changes nothing, and an unchanged design is returned as it is', () => {
    const before = design();
    const renamed: Design = { ...before, sheets: [{ ...before.sheets[0], parts: before.sheets[0].parts.map((p) => (p.refdes === 'R1' ? { ...p, refdes: 'K1X' } : p)) }] };
    expect(relinkRenamedCoils(before, renamed, getPart)).toBe(renamed);
    expect(relinkRenamedCoils(before, before, getPart)).toBe(before);
  });

  it('the editor store applies it to every way of renaming: the Properties field, Renumber and Annotate', () => {
    const d = design();
    const ed = createEditor({ design: d });
    ed.actions.setRefdes(idOf(d, 'K1'), 'K9');
    expect(coilOf(ed.getState().design, 'KC1')).toBe('K9');
    expect(coilOf(ed.getState().design, 'KC3')).toBe('K9');
    // renumber all: the coils become K1, K2 in schematic order and the contacts follow their own coil
    const nb = buildNetlist(ed.getState().design, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.detail?.id === 'contactNoCoil')).toEqual([]);
    ed.actions.annotate('all');
    const after = ed.getState().design;
    const refs = after.sheets[0].parts.filter((p) => p.partId.includes('coil')).map((p) => `${p.refdes}@${p.x}`).sort();
    expect(refs).toEqual(['K1@0', 'K2@200']);
    // the coil that was K9 (at x = 0) is K1 now, and its contacts say so
    expect(coilOf(after, 'KC1')).toBe('K1');
    expect(buildNetlist(after, { includeAnalysis: false }).erc.filter((m) => m.detail?.id?.startsWith('contact'))).toEqual([]);
  });

  it('undo brings the old names back together with the old design', () => {
    const d = design();
    const ed = createEditor({ design: d });
    ed.actions.setRefdes(idOf(d, 'K1'), 'K9');
    ed.actions.undo();
    expect(coilOf(ed.getState().design, 'KC1')).toBe('K1');
  });
});

describe('pasting a coil with its contacts', () => {
  it('the pasted contacts follow the pasted coil, a pasted contact alone keeps naming the original', () => {
    const d = design();
    const ed = createEditor({ design: d });
    const sel = (refs: string[]) => refs.map((r) => ({ kind: 'part' as const, id: idOf(d, r) }));
    ed.actions.select(sel(['K1', 'KC1', 'KC3']));
    ed.actions.copy();
    ed.actions.paste({ x: 0, y: 400 });
    const parts = ed.getState().design.sheets[0].parts;
    const coils = parts.filter((p) => p.partId.includes('coil-dc')).map((p) => p.refdes);
    expect(coils).toHaveLength(3);
    const newCoil = coils.find((r) => r !== 'K1' && r !== 'K2')!;
    const pastedContacts = parts.filter((p) => p.partId.includes('relay-contact') && !['KC1', 'KC2', 'KC3'].includes(p.refdes));
    expect(pastedContacts).toHaveLength(2);
    for (const c of pastedContacts) expect(c.params.coil).toBe(newCoil);
    // a contact copied without its coil still names the original
    ed.actions.select(sel(['KC2']));
    ed.actions.copy();
    ed.actions.paste({ x: 600, y: 400 });
    const alone = ed.getState().design.sheets[0].parts.filter((p) => p.partId.includes('relay-contact') && p.params.coil === ' k2 ');
    expect(alone.length).toBe(2);
  });

  it('relinkPastedContacts maps by position and leaves other contacts alone', () => {
    const d = design();
    const src = d.sheets[0].parts.filter((p) => ['K1', 'KC1', 'KC2'].includes(p.refdes));
    const pasted = src.map((p) => ({ ...p, id: `n${p.id}`, refdes: p.refdes === 'K1' ? 'K5' : p.refdes === 'KC1' ? 'KC8' : 'KC9' }));
    const out = relinkPastedContacts(pasted, src, getPart);
    expect(out.find((p) => p.refdes === 'KC8')!.params.coil).toBe('K5');
    expect(out.find((p) => p.refdes === 'KC9')!.params.coil).toBe(' k2 ');
    expect(relinkPastedContacts(pasted.slice(1), src.slice(1), getPart)).toEqual(pasted.slice(1));
  });
});
