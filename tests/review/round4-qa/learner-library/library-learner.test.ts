/**
 * Round 4 QA (learner experience and library), failing repro tests for the library findings.
 *
 * QL1  package variants of dual / quad comparator chips are named "LM393 (dual)D", "LM393 (dual)PW" …
 *      (the English "(dual)" glued in front of the package suffix), in Vietnamese and in English.
 * QL2  the Vietnamese description of about 300 package variants reads "Cùng mạch với TL072 (dual)" /
 *      "LM324 (quad)": the English base name leaks into the Vietnamese text (the part browser shows
 *      the base chip as "TL072 (kép)").
 * QL3  a learner who types "điện trở 10k" / "dien tro 10k" in the part browser gets four resistor
 *      networks (SIP-6 … SIP-10, not even 10 kΩ ones) before the plain 10 kΩ resistor.
 * QL4  MachSim.searchParts (Scripts window) is a raw English substring filter: "LED" returns the
 *      controlled sources first (con-troLLED), and Vietnamese queries such as "LED đỏ 5 mm" return
 *      nothing, although the part browser finds them.
 */
import { describe, expect, it } from 'vitest';
import { setLang } from '../../../../src/i18n';
import { partDescription, partName } from '../../../../src/i18n/library';
import { listParts, loadAllGroups, searchParts } from '../../../../src/library';
import { searchCatalogue } from '../../../../src/ui/editor/browserModel';

await loadAllGroups();

describe('QL1 part names of comparator chip package variants', () => {
  it('no part name glues a package suffix after "(dual)" / "(quad)"', () => {
    for (const lang of ['vi', 'en'] as const) {
      setLang(lang);
      const bad = listParts()
        .filter((p) => /\((dual|quad|kép|bốn)\)\S/.test(partName(p)))
        .map((p) => `${p.id}: ${partName(p)}`);
      expect(bad, `${lang}: ${bad.slice(0, 6).join(', ')}`).toEqual([]);
    }
    setLang('vi');
  });
});

describe('QL2 Vietnamese descriptions of package variants', () => {
  it('no Vietnamese part description contains the English "(dual)" or "(quad)"', () => {
    setLang('vi');
    const bad = listParts()
      .filter((p) => /\((dual|quad)\)/.test(partDescription(p)))
      .map((p) => `${p.id}: ${partDescription(p).slice(0, 70)}`);
    expect(bad.length, bad.slice(0, 4).join('\n')).toBe(0);
  });
});

describe('QL3 first search result for a plain resistor value', () => {
  it.each(['điện trở 10k', 'dien tro 10k', 'resistor 10k'])('"%s" starts with a resistor, not a resistor network', (q) => {
    setLang('vi');
    const first = searchCatalogue(listParts(), q)[0];
    expect(first?.family, `${q} -> ${first?.id}`).toBe('Resistor');
  });
});

describe('QL4 MachSim.searchParts (Scripts window)', () => {
  it('"LED" finds an LED first, not a controlled source', () => {
    const first = searchParts('LED')[0];
    expect(first?.id, `first hit ${first?.id}`).toMatch(/led/);
  });

  it('finds the parts the part browser finds for a Vietnamese query', () => {
    setLang('vi');
    expect(searchCatalogue(listParts(), 'LED đỏ 5 mm').length).toBeGreaterThan(0);
    expect(searchParts('LED đỏ 5 mm').length).toBeGreaterThan(0);
  });
});
