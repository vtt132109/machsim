/**
 * Design reports and their formats: component detail, model data, spare gates, cross-reference,
 * statistics, BOM with manufacturer / tolerance, CSV and HTML output, hidden values.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { componentDetails, crossReference, gateSections, modelData, placedParts, schematicStatistics, sheetZone, spareGates } from './reports';
import { buildBom } from './bom';
import { tablesToCsv, tablesToHtml } from './reportFormat';
import { getPart } from '../library';
import type { Design } from './types';

function lab(): Design {
  const b = new DesignBuilder('Lab');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '5' });
  const r1 = b.part('basic/resistor', 'R1', 250, 130, { value: '1k', tolerance: '1' });
  const r2 = b.part('basic/resistor', 'R2', 250, 270, { value: '1k' });
  const q1 = b.part('transistors/2n3904', 'Q1', 400, 300);
  const u1 = b.part('ttl/7400', 'U1', 700, 300);
  b.part('sources/ground', 'GND1', 100, 330);
  b.labelPin(v1, '+', 'VCC5');
  b.labelPin(v1, '-', '0');
  b.labelPin(r1, '1', 'VCC5');
  b.labelPin(r1, '2', 'B');
  b.labelPin(r2, '1', 'B');
  b.labelPin(r2, '2', '0');
  b.labelPin(q1, 'B', 'B');
  b.labelPin(q1, 'C', 'VCC5');
  b.labelPin(q1, 'E', '0');
  // gate 1 used (inputs from B, output to R3), gate 2 inputs tied low (spare), gates 3 and 4 open
  b.labelPin(u1, '1A', 'B');
  b.labelPin(u1, '1B', 'B');
  b.labelPin(u1, '1Y', 'Y');
  const r3 = b.part('basic/resistor', 'R3', 900, 200, { value: '10k' });
  b.labelPin(r3, '1', 'Y');
  b.labelPin(r3, '2', '0');
  b.labelPin(u1, '2A', '0');
  b.labelPin(u1, '2B', '0');
  b.part('instruments/multimeter', 'XMM1', 500, 100);
  b.design.sheets[0].parts.find((p) => p.refdes === 'R2')!.fields = { manufacturer: 'Yageo', partNumber: 'MFR-25FBF52-1K', footprint: '0603' };
  return b.design;
}

describe('reports', () => {
  it('lists every part with parameters, pins and nets', () => {
    const d = componentDetails(lab());
    expect(d.map((x) => x.path)).toEqual(['Q1', 'R1', 'R2', 'R3', 'U1', 'V1', 'XMM1']);
    const r1 = d.find((x) => x.path === 'R1')!;
    expect(r1.value).toBe('1 kΩ');
    expect(r1.tolerance).toBe('1 %');
    expect(r1.params.find((p) => p.def.key === 'tolerance')).toMatchObject({ value: '1', modified: true });
    expect(r1.pins).toEqual([
      { name: '1', number: '1', type: 'passive', net: 'VCC5' },
      { name: '2', number: '2', type: 'passive', net: 'B' },
    ]);
    const q1 = d.find((x) => x.path === 'Q1')!;
    expect(q1.models.length).toBe(1);
    expect(q1.provenance).not.toBe('');
    expect(d.find((x) => x.path === 'R2')!.fields).toEqual({ manufacturer: 'Yageo', partNumber: 'MFR-25FBF52-1K', supplier: '', footprint: '0603' });
  });

  it('lists the model cards with their parameters and users', () => {
    const models = modelData(lab());
    const npn = models.find((m) => m.kind === 'model' && m.type === 'NPN')!;
    expect(npn.usedBy).toEqual(['Q1']);
    expect(npn.params.some(([k]) => k === 'bf')).toBe(true);
    expect(models.filter((m) => m.kind === 'model').every((m) => m.usedBy.length > 0)).toBe(true);
  });

  it('finds the spare sections of a multi-gate IC', () => {
    const def = getPart('ttl/7400')!;
    expect([...gateSections(def).keys()]).toEqual(['1', '2', '3', '4']);
    expect(gateSections(getPart('basic/resistor')!).size).toBe(0);
    const [u1] = spareGates(lab());
    expect(u1.path).toBe('U1');
    expect(u1.sections.map((s) => [s.section, s.spare])).toEqual([
      ['1', false],
      ['2', true],
      ['3', true],
      ['4', true],
    ]);
    expect(u1.used).toBe(1);
  });

  it('gives drawing zones and net cross-references', () => {
    const d = lab();
    const sheet = d.sheets[0];
    expect(sheetZone(sheet, 0, 0)).toBe('A1');
    expect(sheetZone(sheet, 1199, 849)).toBe('F8');
    const x = crossReference(d);
    expect(x.parts.find((p) => p.path === 'R1')).toMatchObject({ sheet: sheet.name, zone: sheetZone(sheet, 250, 130) });
    const b = x.nets.find((n) => n.name === 'B')!;
    expect(b.pins).toEqual(['Q1.B', 'R1.2', 'R2.1', 'U1.1A', 'U1.1B']);
    expect(b.sheets).toEqual([sheet.name]);
  });

  it('counts the schematic', () => {
    const s = schematicStatistics(lab());
    expect(s).toMatchObject({ sheets: 1, parts: 8, components: 5, instruments: 1, powerSymbols: 1, wires: 0, nets: expect.any(Number) });
    expect(s.byGroup.basic).toBe(3);
    expect(s.virtualParts).toBe(1); // the ideal DC source
    expect(s.labels).toBeGreaterThan(10);
  });

  it('BOM: manufacturer and part number split the lines, tolerance too', () => {
    const rows = buildBom(lab());
    const res = rows.filter((r) => r.partId === 'basic/resistor');
    expect(res.map((r) => [r.refdes.join(' '), r.tolerance, r.manufacturer, r.footprint])).toEqual([
      ['R1', '1 %', '', 'RES-AXIAL-400'],
      ['R2', '5 %', 'Yageo', '0603'],
      ['R3', '5 %', '', 'RES-AXIAL-400'],
    ]);
  });

  it('hides values in every report while the instructor hides them', () => {
    const d = lab();
    d.restrictions = { passwordHash: '0'.repeat(64), salt: '0'.repeat(32), iterations: 1000, hideValues: true };
    expect(componentDetails(d).find((x) => x.path === 'R1')!.value).toBe('?');
    expect(componentDetails(d).find((x) => x.path === 'R1')!.params.every((p) => p.value === '?')).toBe(true);
    expect(crossReference(d).parts.find((p) => p.path === 'R1')!.value).toBe('?');
    expect(modelData(d).every((m) => m.params.every(([, v]) => v === '?'))).toBe(true);
  });

  it('includes the parts inside blocks with their paths', () => {
    const b = new DesignBuilder('H');
    const child = b.child('Div', { variables: { RV: '2k' } });
    b.part('basic/resistor', 'R1', 0, 0, { value: '{RV}' });
    b.root();
    b.block(child, 'HB1', 300, 300, { RV: '3k' });
    const parts = placedParts(b.design);
    expect(parts.map((p) => p.path)).toEqual(['HB1/R1']);
    // the block's parameter is evaluated into the part value
    expect(Number(parts[0].params.value)).toBe(3000);
  });
});

describe('report formats', () => {
  const tables = [
    { title: 'Bảng 1', columns: ['A', 'B, c'], rows: [[1, 'x "y"'], [2.5, ' lead']] },
    { title: 'Two', columns: ['k'], rows: [['<b>&']] },
  ];
  it('CSV quotes what needs quoting and separates tables', () => {
    expect(tablesToCsv(tables)).toBe('Bảng 1\r\nA,"B, c"\r\n1,"x ""y"""\r\n2.5," lead"\r\n\r\nTwo\r\nk\r\n<b>&\r\n');
    expect(tablesToCsv([tables[1]])).toBe('k\r\n<b>&\r\n');
  });

  it('HTML is a standalone, escaped document', () => {
    const html = tablesToHtml('Báo cáo <1>', tables, { lang: 'vi', lines: ['Thiết kế: X & Y'] });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain('<title>Báo cáo &lt;1&gt;</title>');
    expect(html).toContain('<td>&lt;b&gt;&amp;</td>');
    expect(html).toContain('<td class="num">2.5</td>');
    expect(html).toContain('Thiết kế: X &amp; Y');
  });
});
