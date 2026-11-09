/**
 * Detail fields, model listings and the Detail report of the Select-a-component dialog.
 */
import { describe, expect, it } from 'vitest';
import { getPart, loadAllGroups, registerRuntimeParts } from './index';
import { modelInfo, partDatabaseOf, partDetailReport, partDetails, partModelText, vendorOf } from './partInfo';
import { customPartDef } from './custom/partDef';
import { boxSymbol } from './symbols';
import type { CustomPartData } from './custom/types';
import { readCustomPart } from './custom/validate';
import { parseSpice } from '../sim/spice/parser';

await loadAllGroups();

const part = (id: string) => {
  const p = getPart(id);
  if (!p) throw new Error(`no part ${id}`);
  return p;
};

const DIVIDER: CustomPartData = {
  id: 'custom:info-divider',
  name: 'Info divider',
  group: 'analog',
  family: 'User',
  description: 'Two-resistor divider for the info test',
  prefix: 'U',
  symbol: boxSymbol({ left: [{ name: 'A' }, { name: 'G' }], right: [{ name: 'Y' }] }),
  model: { kind: 'spice', text: '.subckt DIVX a y g\nR1 a y 1k\nR2 y g 1k\n.ends DIVX', name: 'DIVX', pins: ['A', 'Y', 'G'] },
  footprint: 'SOT-23',
  hyperlink: 'https://example.com/datasheets/divx.pdf',
  fields: { Manufacturer: 'Lab 3 workshop' },
  author: 'Lan',
};

describe('detail fields', () => {
  it('a vendor-published model names its vendor; MachSim fits name MachSim', () => {
    expect(vendorOf('Gummel-Poon parameters following the Philips/NXP published BC547B model')).toBe('Philips/NXP');
    expect(vendorOf('MachSim Gummel-Poon fit to MPSA42 datasheet figures')).toBeUndefined();
    const bc = partDetails(part('transistors/bc547b'));
    expect(bc).toMatchObject({ database: 'master', packageType: 'TO-92', packageManufacturer: '', hyperlink: { kind: 'help' }, prefix: 'Q' });
    expect(bc.model).toMatchObject({ kind: 'model', type: 'NPN', manufacturer: 'Philips/NXP' });
    expect(bc.model.id.length).toBeGreaterThan(0);
    expect(bc.function).toBe(part('transistors/bc547b').description);
    const mpsa = partDetails(part('transistors/mpsa42'));
    expect(mpsa.model.manufacturer).toBe('MachSim');
    expect(mpsa.provenance).toMatch(/MPSA42 datasheet/);
  });

  it('classifies what simulates a part', () => {
    expect(modelInfo(part('basic/resistor'))).toMatchObject({ kind: 'primitive', id: 'R' });
    expect(modelInfo(part('ttl/74ls00')).kind).toBe('code-model');
    expect(['subcircuit', 'model']).toContain(modelInfo(part('analog/lm741')).kind);
    expect(modelInfo(part('instruments/scope'))).toMatchObject({ kind: 'instrument', id: 'oscilloscope' });
    expect(modelInfo(part('basic/test-point'))).toMatchObject({ kind: 'none', id: '' });
    expect(partDetails(part('basic/test-point')).model.manufacturer).toBe('');
  });

  it('a user component: its database, own hyperlink, package maker and editable SPICE text', () => {
    const def = customPartDef(DIVIDER);
    expect(partDatabaseOf(def)).toBe('design');
    registerRuntimeParts('db:user', [def]);
    try {
      expect(partDatabaseOf(def)).toBe('user');
      const d = partDetails(def);
      expect(d.hyperlink).toEqual({ kind: 'url', url: 'https://example.com/datasheets/divx.pdf' });
      expect(d).toMatchObject({ packageType: 'SOT-23', packageManufacturer: 'Lab 3 workshop', database: 'user' });
      expect(d.model).toMatchObject({ kind: 'subcircuit', id: 'DIVX', manufacturer: 'Lan' });
      expect(partModelText(def)).toEqual({ text: DIVIDER.model.kind === 'spice' ? DIVIDER.model.text : '', editable: true, source: 'user' });
    } finally {
      registerRuntimeParts('db:user', []);
    }
  });

  it('only http(s) hyperlinks are accepted in part data', () => {
    const issues: string[] = [];
    readCustomPart({ ...DIVIDER, hyperlink: 'javascript:alert(1)' }, 'part', issues);
    expect(issues.join(' ')).toMatch(/part\.hyperlink: must be an http/);
    const ok: string[] = [];
    expect(readCustomPart({ ...DIVIDER, hyperlink: ' https://example.com/x ' }, 'part', ok)?.hyperlink).toBe('https://example.com/x');
    expect(ok).toEqual([]);
  });
});

describe('model listing (View model)', () => {
  it('lists the cards and the elements with the pin names as nodes, readable by the SPICE reader', () => {
    const m = partModelText(part('diodes/1n4148'));
    expect(m.editable).toBe(false);
    expect(m.source).toBe('listing');
    expect(m.text).toMatch(/^\* 1N4148 \(diodes\/1n4148\)/);
    expect(m.text).toMatch(/\* pins: A=A K=K/);
    expect(m.text).toMatch(/^\.model \S+ D/im);
    expect(m.text).toMatch(/^D\S* A K \S+/m);
    const back = parseSpice(m.text);
    expect(back.errors ?? []).toEqual([]);
    expect(back.netlist.elements.filter((e) => e.type === 'D')).toHaveLength(1);
    // a subcircuit macromodel lists its .subckt body
    expect(partModelText(part('analog/lm741')).text).toMatch(/\.subckt|\.model/i);
    // nothing to list for a drawing-only symbol
    expect(partModelText(part('basic/test-point'))).toEqual({ text: '', editable: false, source: 'none' });
  });
});

describe('detail report', () => {
  it('holds identity, function, model, package, pins, parameters, specifications and the model text', () => {
    const r = partDetailReport(part('transistors/mpsa42'));
    expect(r.details).toMatchObject({ id: 'transistors/mpsa42', name: 'MPSA42', group: 'transistors', family: 'NPN BJT', database: 'master' });
    expect(r.pins.map((p) => p.name)).toEqual(['C', 'B', 'E']);
    expect(r.pins.every((p) => p.number && p.type)).toBe(true);
    expect(r.specs).toEqual(expect.arrayContaining([['vceo', 300], ['package', 'TO-92']]));
    expect(r.series).toBe('BJT high-voltage');
    expect(r.model.text).toMatch(/\.model \S+ NPN/i);
    const res = partDetailReport(part('basic/resistor'));
    const value = res.params.find((p) => p.key === 'value')!;
    expect(value).toMatchObject({ unit: 'Ω', kind: 'number' });
    expect(value.default.length).toBeGreaterThan(0);
    expect(res.model.text).toMatch(/^R\S* p1 p2 /m);
    const sel = partDetailReport(part('basic/rotary-switch-4')).params.find((p) => p.kind === 'select');
    expect(sel?.options.length).toBeGreaterThan(1);
  });
});
