import { describe, expect, it } from 'vitest';
import { BOM_CSV_HEADER, bomToCsv, buildBom, partValue } from './bom';
import { DesignBuilder } from './designkit';
import { getPart } from '../library';

function sample() {
  const b = new DesignBuilder();
  b.part('basic/resistor', 'R10', 0, 0, { value: '1k' });
  b.part('basic/resistor', 'R2', 100, 0, { value: '1000' });
  b.part('basic/resistor', 'R1', 200, 0, { value: '4.7k' });
  b.part('basic/capacitor', 'C1', 300, 0, { value: '100n' });
  b.part('transistors/2n3904', 'Q1', 400, 0);
  b.part('sources/dc-voltage', 'V1', 500, 0);
  b.part('sources/ground', 'GND1', 600, 0);
  b.part('instruments/scope', 'XSC1', 700, 0);
  b.part('basic/resistor', 'R3', 800, 0, { value: '1k' }, { excludeFromBom: true });
  b.addSheet();
  b.part('basic/resistor', 'R4', 0, 0, { value: '1 kΩ' });
  b.part('diodes/1n4148', 'D1', 100, 0);
  return b.design;
}

describe('BOM', () => {
  it('formats values from the schematic parameters', () => {
    expect(partValue(getPart('basic/resistor')!, { value: '4700' })).toBe('4.7 kΩ');
    expect(partValue(getPart('basic/capacitor')!, {})).toBe('1 µF');
    expect(partValue(getPart('transistors/2n3904')!, {})).toBe('2N3904');
    expect(partValue(getPart('instruments/multimeter')!, { mode: 'a' })).toBe('Current');
  });

  it('groups by part and normalised value, skipping virtual / excluded / power parts', () => {
    const rows = buildBom(sample());
    expect(rows.map((r) => [r.item, r.quantity, r.refdes.join(' '), r.value])).toEqual([
      [1, 1, 'C1', '100 nF'],
      [2, 1, 'D1', '1N4148'],
      [3, 1, 'Q1', '2N3904'],
      [4, 1, 'R1', '4.7 kΩ'],
      [5, 3, 'R2 R4 R10', '1 kΩ'],
    ]);
    expect(rows[1]).toMatchObject({ partId: 'diodes/1n4148', footprint: 'DO-35', group: 'diodes' });
    const all = buildBom(sample(), { includeVirtual: true });
    expect(all.map((r) => r.refdes[0])).toEqual(['C1', 'D1', 'Q1', 'R1', 'R2', 'V1', 'XSC1']);
  });

  it('writes RFC 4180 CSV', () => {
    const csv = bomToCsv(buildBom(sample()));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(BOM_CSV_HEADER.join(','));
    expect(lines[5]).toBe('5,3,R2 R4 R10,1 kΩ,5 %,Resistor,Resistor with optional linear / quadratic temperature coefficients,RES-AXIAL-400');
    expect(lines[lines.length - 1]).toBe('');
    const tricky = bomToCsv([
      { item: 1, partId: 'x', name: 'A "quoted", part', value: 'v', tolerance: '', quantity: 1, refdes: ['U1'], description: 'line\nbreak', footprint: '', group: 'misc', family: 'f' },
    ]);
    expect(tricky.split('\r\n')[1]).toBe('1,1,U1,v,,"A ""quoted"", part","line\nbreak",');
  });

  it('lists the tolerance and keeps different tolerances on separate lines', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', 0, 0, { value: '1k', tolerance: '1' });
    b.part('basic/resistor', 'R2', 100, 0, { value: '1000', tolerance: '5' });
    b.part('basic/resistor', 'R3', 200, 0, { value: '1k' }); // default 5 %
    b.part('basic/capacitor', 'C1', 300, 0, { value: '100n' }); // default 10 %
    b.part('diodes/1n4148', 'D1', 400, 0);
    const rows = buildBom(b.design);
    expect(rows.map((r) => [r.refdes.join(' '), r.value, r.tolerance])).toEqual([
      ['C1', '100 nF', '10 %'],
      ['D1', '1N4148', ''],
      ['R1', '1 kΩ', '1 %'],
      ['R2 R3', '1 kΩ', '5 %'],
    ]);
  });
});
