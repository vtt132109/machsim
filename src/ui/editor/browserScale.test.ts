/**
 * The component browser at catalogue scale: thousands of parts sorted naturally inside their
 * families, fast indexed search, specification filters, the virtualised row window, the
 * standard-value picker and the specification text of the preview.
 */
import { describe, expect, it } from 'vitest';
import { GROUPS, getPart, listParts } from '../../library';
import { applySpecFilter, buildBrowserTree, familyKey, familySpecFields, groupKey, scrollIntoRow, searchCatalogue, virtualWindow, visibleRows } from './browserModel';
import { pickerValues } from './PartExtras';
import { specRows } from './specText';
import { setLang } from '../../i18n';
import { loadAllGroups } from '../../library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const parts = listParts();
const tree = buildBrowserTree(parts, GROUPS);
const family = (group: string, name: string) => tree.find((g) => g.group.id === group)!.families.find((f) => f.name === name)!;
const specOf = (id: string, key: string) => (getPart(id) as { specs?: Record<string, number | string> }).specs?.[key];

describe('catalogue in the browser', () => {
  it('lists the generic part first, then standard values in ascending order', () => {
    const res = family('basic', 'Resistor').parts;
    expect(res[0].id).toBe('basic/resistor');
    const values = res.filter((p) => p.id.startsWith('basic/res-')).map((p) => (p as { sortKey?: number }).sortKey!);
    expect(values.length).toBe(169);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(family('diodes', 'Zener diode').parts.length).toBeGreaterThan(250);
  });

  it('search stays fast over the whole catalogue and finds part numbers and Vietnamese words', () => {
    expect(parts.length).toBeGreaterThan(2500);
    searchCatalogue(parts, 'warm-up');
    const queries = ['bc547', '2n2222', 'tl072', 'zener 5.1', 'diode', 'điện trở', 'dien tro 4.7', 'ldo 3.3', 'irf', 'relay 12', 'xyzzy', 'a'];
    const t0 = performance.now();
    for (let k = 0; k < 3; k++) for (const q of queries) searchCatalogue(parts, q);
    const perQuery = (performance.now() - t0) / (3 * queries.length);
    expect(perQuery).toBeLessThan(60);
    expect(searchCatalogue(parts, 'bc547b')[0].id).toBe('transistors/bc547b');
    expect(searchCatalogue(parts, 'irf3205')[0].id).toBe('transistors/irf3205');
    setLang('vi');
    expect(searchCatalogue(parts, 'dien tro 4.7').some((p) => p.id === 'basic/res-4.7k')).toBe(true);
    expect(searchCatalogue(parts, 'sut ap thap 3.3').some((p) => p.id === 'power/mcp1700-3.3')).toBe(true);
  });

  it('offers specification filters for a family and filters by range and package', () => {
    const npn = family('transistors', 'NPN BJT');
    const fields = familySpecFields(npn.parts);
    expect(fields.map((f) => f.key)).toEqual(expect.arrayContaining(['vceo', 'ic', 'power', 'hfe', 'ft', 'package']));
    const pkg = fields.find((f) => f.key === 'package');
    expect(pkg?.kind === 'text' ? pkg.values : []).toEqual(expect.arrayContaining(['TO-92', 'TO-220', 'SOT-23']));
    const hv = applySpecFilter(npn.parts, { vceo: { min: '300' }, package: { value: 'TO-92' } });
    expect(hv.map((p) => p.id)).toEqual(expect.arrayContaining(['transistors/mpsa42', 'transistors/mje13001']));
    expect(hv.every((p) => (specOf(p.id, 'vceo') as number) >= 300 && specOf(p.id, 'package') === 'TO-92')).toBe(true);
    // user-number syntax with suffixes: IC between 500 mA and 5 A
    const mid = applySpecFilter(npn.parts, { ic: { min: '500m', max: '5' } });
    expect(mid.length).toBeGreaterThan(20);
    expect(mid.every((p) => (specOf(p.id, 'ic') as number) >= 0.5 && (specOf(p.id, 'ic') as number) <= 5)).toBe(true);
    // the filtered family row counts the parts it lists
    const rows = visibleRows(tree, new Set([groupKey('transistors'), npn.key]), new Map([[npn.key, { vceo: { min: '300' } }]]));
    const famRow = rows.find((r) => r.key === npn.key)!;
    const listed = rows.filter((r) => r.kind === 'part' && r.parentKey === npn.key).length;
    expect(famRow.kind === 'family' ? famRow.shown : -1).toBe(listed);
    expect(listed).toBeLessThan(npn.parts.length);
    expect(familyKey('transistors', 'NPN BJT')).toBe(npn.key);
  });

  it('renders only the rows in view', () => {
    expect(virtualWindow(3000, 22, 0, 440)).toEqual({ start: 0, end: 29, padTop: 0, padBottom: (3000 - 29) * 22 });
    const w = virtualWindow(3000, 22, 22 * 1000, 440, 5);
    expect(w.start).toBe(995);
    expect(w.end).toBe(1026);
    expect(w.padTop + (w.end - w.start) * 22 + w.padBottom).toBe(3000 * 22);
    expect(virtualWindow(0, 22, 0, 400)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(scrollIntoRow(100, 22, 0, 440)).toBe(100 * 22 + 22 - 440);
    expect(scrollIntoRow(5, 22, 0, 440)).toBe(0);
    expect(scrollIntoRow(5, 22, 500, 440)).toBe(110);
  });

  it('the value picker offers the series around the present value; specs read in the UI language', () => {
    const def = getPart('basic/res-4.7k')!.params.find((p) => p.key === 'value')!;
    const vals = pickerValues(def, '4.7k');
    expect(vals).toContain(4700);
    expect(vals).toContain(100);
    expect(vals).toContain(91e3);
    expect(vals).toHaveLength(72);
    setLang('en');
    expect(specRows(getPart('transistors/bc337-40')!).map((r) => `${r.label}: ${r.value}`)).toEqual(
      expect.arrayContaining(['Voltage VCEO / VCES: 45 V', 'Collector current IC: 800 mA', 'Current gain hFE: 400', 'Package: TO-92']),
    );
    setLang('vi');
    expect(specRows(getPart('transistors/bc337-40')!)[0].label).toBe('Công suất');
  });
});

describe('search in the words a Vietnamese learner types', () => {
  const ids = (q: string, n = 1) => searchCatalogue(parts, q).slice(0, n).map((p) => p.id);

  it('puts the part named like the whole query first, with or without accents', () => {
    setLang('vi');
    expect(ids('dao động ký')).toEqual(['instruments/scope']);
    expect(ids('dao dong ky')).toEqual(['instruments/scope']);
    expect(ids('đồng hồ vạn năng')).toEqual(['instruments/multimeter']);
    expect(ids('vôn kế')).toEqual(['indicators/voltmeter']);
    expect(ids('dien tro')).toEqual(['basic/resistor']);
    expect(ids('tu dien')).toEqual(['basic/capacitor']);
    expect(ids('đất')).toEqual(['sources/ground']);
    // learner words of a family: "bóng bán dẫn" lists the bipolar transistors, "điốt" the diodes
    expect(searchCatalogue(parts, 'bóng bán dẫn').slice(0, 10).every((p) => /BJT|Darlington|transistor/i.test(p.family))).toBe(true);
    expect(searchCatalogue(parts, 'cuộn dây')[0].id).toBe('basic/inductor');
  });

  it('finds parts by value written with a decimal comma, in RKM form or with a unit', () => {
    expect(ids('4k7')).toEqual(['basic/res-4.7k']);
    expect(ids('điện trở 4,7k')).toEqual(['basic/res-4.7k']);
    expect(ids('1k')).toEqual(['basic/res-1k']);
    expect(ids('tụ 100uF')).toEqual(['basic/ecap-100u']);
    // the generic part of that unit follows the exact values (100 µF exists in several voltage series)
    const hits = searchCatalogue(parts, 'tụ 100uF');
    const exact = hits.findIndex((p) => specOf(p.id, 'capacitance') !== 100e-6);
    expect(exact).toBeGreaterThan(0);
    expect(hits.slice(exact, exact + 3).map((p) => p.id)).toContain('basic/capacitor');
    const zeners = searchCatalogue(parts, 'zener 5,1v');
    expect(zeners.length).toBeGreaterThan(0);
    expect(zeners.every((p) => p.family === 'Zener diode' && (p as { specs?: { vz?: number } }).specs?.vz === 5.1)).toBe(true);
  });

  it('keeps English names first for English queries', () => {
    setLang('en');
    expect(ids('oscilloscope')).toEqual(['instruments/scope']);
    expect(ids('capacitor')).toEqual(['basic/capacitor']);
    expect(ids('ground')).toEqual(['sources/ground']);
  });
});
