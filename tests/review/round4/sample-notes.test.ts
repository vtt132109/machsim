/**
 * Round 4 step 9: the sheet notes of the shipped samples exist in English.
 *
 * The files in examples/ keep their notes in Vietnamese. With the interface in English, opening a
 * sample swaps each note for the text of src/i18n/sampleNotes.ts. This test reads every sample
 * file and checks the table covers every note, in the file's order, with the Vietnamese text
 * exactly as stored, an English text of its own (no Vietnamese left in it) and the same numbers;
 * then it checks the swap itself, including that a note the learner changed stays untouched.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../../src/i18n';
import { SAMPLE_NOTES } from '../../../src/i18n/sampleNotes';
import { SAMPLE_TEXT } from '../../../src/i18n/samples';
import { newDesign, type Design } from '../../../src/model/types';
import { parseDesign } from '../../../src/model/serialize';
import { localizeNotes, localizeOpenedSample, sampleNotePairs, sampleTextKey } from '../../../src/ui/integration/sampleLocalize';

const DIR = fileURLToPath(new URL('../../../examples/', import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.msim')).sort();

/** The notes of a design in the table's order: root sheets, then child designs. */
function notesOf(d: Design): string[] {
  const out = d.sheets.flatMap((s) => s.notes.map((n) => n.text));
  for (const c of d.children ?? []) for (const s of c.sheets) out.push(...s.notes.map((n) => n.text));
  return out;
}

const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** Numbers of a text with decimal commas as points: "1,59 kHz" -> "1.59". */
function numbers(text: string): string[] {
  return (text.replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

describe('every sample note has an English text', () => {
  it('there are samples with notes at all', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(70);
    expect(Object.keys(SAMPLE_NOTES).length).toBeGreaterThanOrEqual(70);
  });

  for (const file of FILES) {
    const key = sampleTextKey(file);
    const design = parseDesign(readFileSync(DIR + file, 'utf8'));
    const notes = notesOf(design);
    if (notes.length === 0) continue;
    it(`${file}: ${notes.length} note(s), Vietnamese as stored, English of its own with the same numbers`, () => {
      const pairs = SAMPLE_NOTES[key];
      expect(pairs, `no entry for ${key}`).toBeDefined();
      expect(pairs.map((p) => p[0])).toEqual(notes);
      pairs.forEach(([vi, en]) => {
        expect(en.trim().length).toBeGreaterThan(10);
        // a note that is only a formula reads the same in both languages
        if (VIETNAMESE.test(vi)) expect(en).not.toBe(vi);
        expect(VIETNAMESE.test(en), `Vietnamese letters left in: ${en}`).toBe(false);
        // every number written in the Vietnamese note is in the English one
        // (a spelled-out "zero" stands for a 0)
        for (const n of numbers(vi).filter((x) => x !== '0')) expect(numbers(en), `${n} missing from: ${en}`).toContain(n);
      });
    });
  }

  it('has no entry for a sample that does not exist', () => {
    const keys = new Set(FILES.map(sampleTextKey));
    expect(Object.keys(SAMPLE_NOTES).filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.keys(SAMPLE_NOTES).filter((k) => !SAMPLE_TEXT[k])).toEqual([]);
  });
});

describe('localizeNotes', () => {
  const pairs = [
    ['Chú thích một', 'First note'],
    ['Chú thích hai', 'Second note'],
  ] as const;

  function design(): Design {
    const d = newDesign('x');
    d.sheets[0].notes = [
      { id: 'n1', x: 0, y: 0, text: 'Chú thích một' },
      { id: 'n2', x: 0, y: 10, text: 'Em tự viết dòng này' },
    ];
    d.children = [{ id: 'c1', kind: 'subcircuit', name: 'C', variables: {}, sheets: [{ ...d.sheets[0], id: 'cs', notes: [{ id: 'n3', x: 0, y: 0, text: 'Chú thích hai' }] }] }];
    return d;
  }

  it('swaps the notes of the table, in the sheets and in the child designs, and nothing else', () => {
    const out = localizeNotes(design(), pairs);
    expect(out.sheets[0].notes.map((n) => n.text)).toEqual(['First note', 'Em tự viết dòng này']);
    expect(out.children![0].sheets[0].notes[0].text).toBe('Second note');
    // ids and positions are kept
    expect(out.sheets[0].notes[0]).toMatchObject({ id: 'n1', x: 0, y: 0 });
  });

  it('returns the same object when there is nothing to swap', () => {
    const d = design();
    expect(localizeNotes(d, undefined)).toBe(d);
    expect(localizeNotes(d, [])).toBe(d);
    expect(localizeNotes(d, [['Không có dòng này', 'x']])).toBe(d);
  });
});

describe('opening a shipped sample', () => {
  afterEach(() => setLang('vi'));

  it('gives the English notes in an English interface and leaves Vietnamese alone', async () => {
    const file = '93-mcu-exact-delay.msim';
    const design = parseDesign(readFileSync(DIR + file, 'utf8'));
    setLang('vi');
    expect(await sampleNotePairs(file)).toBeUndefined();
    expect(notesOf(await localizeOpenedSample(design, file))).toEqual(notesOf(design));
    setLang('en');
    const en = await localizeOpenedSample(design, file);
    expect(notesOf(en)).toEqual(SAMPLE_NOTES['93_mcu_exact_delay'].map((p) => p[1]));
    expect(en.title).toBe('8051 delay loop of exactly 1000 machine cycles');
  });

  it('does not touch a design that merely looks like no sample', async () => {
    setLang('en');
    const d = newDesign('Mạch của em');
    d.sheets[0].notes = [{ id: 'n', x: 0, y: 0, text: 'Chú thích một' }];
    expect(await localizeOpenedSample(d, 'my-circuit.msim')).toBe(d);
    expect(await sampleNotePairs('my-circuit.msim')).toBeUndefined();
  });
});
