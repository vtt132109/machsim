/**
 * Review round 2: component browser search (src/ui/editor/browserModel.ts searchCatalogue) in the
 * DEFAULT UI language. English queries rank well ("oscilloscope" → the oscilloscope first), but a
 * Vietnamese query only ever matches the folded Vietnamese text at rank 7, the same rank as any
 * word in any Vietnamese description. All Vietnamese hits then tie and are sorted by English
 * name, so digital ICs whose descriptions mention the words come first:
 *   "dao động ký"      → 74ALS04, 74ALS05, … (the oscilloscope is not in the top 4)
 *   "công tắc"         → 74AC163, 74ACT163, …
 *   "vôn kế"           → 4046, Buzzer, … (the voltmeter is not first)
 *   "đất"              → 74AC74, 74AC151, … (Ground is not first)
 *   "động cơ"          → 7-segment displays first
 *   "đồng hồ vạn năng" → 74ALS194 before the multimeter
 * Expected: a part whose Vietnamese name contains the query outranks parts that only match in a
 * description, as English names do.
 */
import { describe, expect, it } from 'vitest';
import { listParts } from '../../../src/library';
import { searchCatalogue, foldDiacritics } from '../../../src/ui/editor/browserModel';
import { partNameVi } from '../../../src/i18n/library';
import { loadAllGroups } from '../../../src/library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const parts = listParts();
const top = (q: string) => searchCatalogue(parts, q)[0];

describe('Vietnamese search puts parts named like the query first', () => {
  it('control: English names rank first ("oscilloscope", "ground", "voltmeter")', () => {
    expect(top('oscilloscope').id).toBe('instruments/scope');
    expect(top('ground').id).toBe('sources/ground');
    expect(top('voltmeter').id).toBe('indicators/voltmeter');
  });

  // the divider lesson's hint says: "Ctrl+K rồi gõ “dien tro”" — today the top hits are the BLDC
  // motor and current-controlled sources; no resistor is among the first four
  it('"dien tro" (the lesson hint) and "tu dien" list a resistor / capacitor first', () => {
    expect(top('dien tro').family).toBe('Resistor');
    expect(top('tu dien').family).toBe('Capacitor');
  });

  for (const q of ['dao động ký', 'đồng hồ vạn năng', 'công tắc', 'vôn kế', 'đất', 'động cơ', 'dao dong ky', 'cong tac']) {
    it(`"${q}": the first result has "${q}" in its Vietnamese name`, () => {
      const first = top(q);
      expect(first).toBeDefined();
      const vi = foldDiacritics((partNameVi(first) ?? '').toLowerCase());
      expect({ id: first.id, matches: vi.includes(foldDiacritics(q.toLowerCase())) }).toEqual({ id: first.id, matches: true });
    });
  }
});
