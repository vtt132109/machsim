/**
 * Every user-visible string of the component library has a Vietnamese translation: families,
 * parameter labels, help texts, option labels, interactive labels, part descriptions and the
 * names of generic parts. New parts fail here until their texts are added to library.vi.ts /
 * partDescriptions.vi.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GROUPS, listParts, getPart } from '../library';
import { setLang } from './core';
import { familyName, groupName, libraryStrings, optionLabel, paramHelp, paramLabel, partDescription, partDescriptionVi, partName, partNameVi } from './library';
import { LIB_TEXT_VI, PART_NAME_VI } from './library.vi';
import { PART_DESC_VI } from './partDescriptions.vi';
import { searchCatalogue } from '../ui/editor/browserModel';
import { loadAllGroups } from '../library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

/** Text that reads as words (not a pure token like "DC", "Y/T" or "COM–A"). */
const prose = (s: string) => /[a-z]{3,}/.test(s);

afterEach(() => setLang('vi'));

describe('library translations', () => {
  it('translates every family, label, help, option and interactive label', () => {
    const missing = new Set<string>();
    for (const p of listParts()) for (const s of libraryStrings(p)) if (prose(s.text) && !(s.text in LIB_TEXT_VI)) missing.add(`${s.kind}: ${s.text}`);
    expect([...missing]).toEqual([]);
  });

  it('has a Vietnamese description for every part and a name for every generic part', () => {
    const parts = listParts();
    expect(parts.length).toBeGreaterThan(250);
    // hand-written parts are translated in partDescriptions.vi.ts; generated catalogue parts carry their own text
    expect(parts.filter((p) => !partDescriptionVi(p)).map((p) => p.id)).toEqual([]);
    // names with ordinary words ("Resistor", "Pulse Voltage Source") need a translation; part numbers do not
    const generic = parts.filter((p) => /[a-z]{3,}/.test(p.name) && !/^(LED|AND|OR|NAND|NOR|XOR|XNOR|NOT|BUF|D FF|JK FF|T FF)\b/.test(p.name));
    expect(generic.filter((p) => !partNameVi(p)).map((p) => `${p.id} (${p.name})`)).toEqual([]);
    expect(Object.keys(PART_NAME_VI).filter((id) => !getPart(id))).toEqual([]);
    expect(Object.keys(PART_DESC_VI).filter((id) => !getPart(id))).toEqual([]);
  });

  it('answers in the current language', () => {
    const r = getPart('basic/resistor')!;
    const label = r.params.find((d) => d.key === 'value')!;
    expect(partName(r)).toBe('Điện trở');
    expect(paramLabel(label)).toBe('Điện trở');
    expect(familyName(r.family)).toBe('Điện trở');
    expect(groupName('basic')).toBe('Linh kiện cơ bản');
    expect(partDescription(getPart('ttl/7400')!)).toBe('Bốn cổng NAND 2 đầu vào. Y = ~(A·B). Chân nguồn ẩn (VCC = 14, GND = 7) nối vào net VCC.');
    setLang('en');
    expect(partName(r)).toBe('Resistor');
    expect(paramLabel(label)).toBe(label.label);
    expect(groupName('basic')).toBe(GROUPS.find((g) => g.id === 'basic')!.name);
    expect(partDescription(getPart('ttl/7400')!)).toBe(getPart('ttl/7400')!.description);
    expect(optionLabel('Normally open')).toBe('Normally open');
    expect(paramHelp({ help: undefined })).toBeUndefined();
  });

  it('finds parts by their Vietnamese name, with or without diacritics', () => {
    expect(searchCatalogue(listParts(), 'điện trở').some((p) => p.id === 'basic/resistor')).toBe(true);
    expect(searchCatalogue(listParts(), 'dien tro').some((p) => p.id === 'basic/resistor')).toBe(true);
    expect(searchCatalogue(listParts(), 'dao dong ky').some((p) => p.id === 'instruments/scope')).toBe(true);
  });
});
