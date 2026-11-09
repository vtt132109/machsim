/**
 * Shipped samples in the UI language: a sample file opened by any route gets its title and sheet
 * names translated, while a design of the learner's own is never touched — and the sample
 * catalogue is only loaded for a file that is named like a sample.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { newDesign, type Design } from '../../model/types';
import { localizeOpenedSample, localizeSample, localizeSheetName, looksLikeSample, sampleTextKey, sampleTitles } from './sampleLocalize';

/** A design as a shipped sample file stores it: canonical English title, "Sheet 1". */
function sampleDesign(title: string): Design {
  const d = newDesign(title);
  d.sheets[0].name = 'Sheet 1';
  d.sheets.push({ ...d.sheets[0], id: 'sheet2', name: 'Sheet 2' });
  d.children = [{ id: 'c1', kind: 'subcircuit', name: 'Stage', variables: {}, sheets: [{ ...d.sheets[0], id: 'cs1', name: 'Sheet 1' }] }];
  return d;
}

describe('sample localization', () => {
  afterEach(() => setLang('vi'));

  it('translates the default sheet names and leaves the learner own ones', () => {
    setLang('vi');
    expect(localizeSheetName('Sheet 1')).toBe('Trang 1');
    expect(localizeSheetName('Sheet 12')).toBe('Trang 12');
    expect(localizeSheetName('Ladder 1')).toBe('Bậc thang 1');
    expect(localizeSheetName('Khối công suất')).toBe('Khối công suất');
    expect(localizeSheetName('Sheet one')).toBe('Sheet one');
    setLang('en');
    expect(localizeSheetName('Sheet 1')).toBe('Sheet 1');
  });

  it('recognises a sample file name without loading anything', () => {
    expect(looksLikeSample('01-voltage-divider.msim')).toBe(true);
    expect(looksLikeSample('C:\\Users\\me\\examples\\11-ohms-law.msim')).toBe(true);
    expect(looksLikeSample('Untitled.msim')).toBe(false);
    expect(looksLikeSample('Cầu phân áp.msim')).toBe(false);
    expect(looksLikeSample('amplifier-2.msim')).toBe(false);
    expect(looksLikeSample('01-voltage-divider.xml')).toBe(false);
    expect(sampleTextKey('examples/01-voltage-divider.msim')).toBe('01_voltage_divider');
  });

  it('finds the two titles of a shipped sample and nothing for other files', async () => {
    expect(await sampleTitles('01-voltage-divider.msim')).toEqual({ key: '01_voltage_divider', vi: 'Cầu phân áp + đồng hồ vạn năng', en: 'Voltage divider + multimeter' });
    expect((await sampleTitles('C:\\Users\\me\\examples\\11-ohms-law.msim'))?.en).toBe("Ohm's law");
    expect(await sampleTitles('my-own-circuit.msim')).toBeUndefined();
    // a sample-shaped name that is not in the catalogue is left alone
    expect(await sampleTitles('99-not-a-sample.msim')).toBeUndefined();
  });

  it('renames every sheet of the root and of the child designs', () => {
    setLang('vi');
    const out = localizeSample(sampleDesign('Voltage divider + multimeter'), 'Cầu phân áp');
    expect(out.title).toBe('Cầu phân áp');
    expect(out.sheets.map((s) => s.name)).toEqual(['Trang 1', 'Trang 2']);
    expect(out.children?.[0].sheets.map((s) => s.name)).toEqual(['Trang 1']);
  });

  it('localizes a sample opened from a file, in both languages', async () => {
    setLang('vi');
    const vi = await localizeOpenedSample(sampleDesign('Voltage divider + multimeter'), '01-voltage-divider.msim');
    expect(vi.title).toBe('Cầu phân áp + đồng hồ vạn năng');
    expect(vi.sheets.map((s) => s.name)).toEqual(['Trang 1', 'Trang 2']);
    setLang('en');
    const en = await localizeOpenedSample(sampleDesign('Voltage divider + multimeter'), '01-voltage-divider.msim');
    expect(en.title).toBe('Voltage divider + multimeter');
    expect(en.sheets[0].name).toBe('Sheet 1');
  });

  it('leaves a design of the learner own alone, and does no work twice', async () => {
    setLang('vi');
    const own = sampleDesign('Bài tập của em');
    expect(await localizeOpenedSample(own, 'my-work.msim')).toBe(own);
    expect(await localizeOpenedSample(own, 'Untitled.msim')).toBe(own);
    // an already localized sample comes back as the same object (the sample browser localized it)
    const done = localizeSample(sampleDesign('Voltage divider + multimeter'), 'Cầu phân áp + đồng hồ vạn năng');
    expect(await localizeOpenedSample(done, '01-voltage-divider.msim')).toBe(done);
  });
});
