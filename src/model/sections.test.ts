import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { pcbComponents } from './pcb';
import { buildBom } from './bom';
import { spareGates } from './reports';
import {
  packageGroups,
  packageKey,
  packageOf,
  packageParts,
  sectionLabel,
  sectionLetter,
  sectionNumber,
  sectionPartId,
  sectionIssues,
  spareSections,
} from './sections';
import { runAnalyses } from '../sim';
import type { Netlist } from '../sim/netlist';

const section = (letter: string) => getPart(`ttl/7400-${letter.toLowerCase()}`)!;

function op(netlist: Netlist): Record<string, number> {
  const [r] = runAnalyses({ ...netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars ?? {};
}

describe('section parts in the library', () => {
  it('builds one part per gate with the package pin names and numbers', () => {
    const a = section('A');
    expect(a.name).toBe('7400A');
    expect(packageOf(a)).toEqual({ id: 'ttl/7400', section: 'A', sections: ['A', 'B', 'C', 'D'] });
    expect(a.symbol.pins.map((p) => [p.name, p.number, p.label, p.type])).toEqual([
      ['1A', '1', 'A', 'input'],
      ['1B', '2', 'B', 'input'],
      ['1Y', '3', 'Y', 'output'],
    ]);
    expect(section('D').symbol.pins.map((p) => p.name)).toEqual(['4A', '4B', '4Y']);
    expect(getPart('ttl/7404-f')?.symbol.pins.map((p) => p.name)).toEqual(['6A', '6Y']);
  });

  it('keeps the parameters and footprint of the package', () => {
    const pkg = getPart('ttl/7400')!;
    expect(section('C').params).toBe(pkg.params);
    expect(section('C').footprint).toBe(pkg.footprint);
  });

  it('computes section ids, letters and labels', () => {
    expect(sectionLetter(1)).toBe('A');
    expect(sectionLetter(4)).toBe('D');
    expect(sectionNumber('C')).toBe(3);
    expect(sectionNumber('')).toBe(0);
    expect(sectionPartId('ttl/7400', 'B')).toBe('ttl/7400-b');
    expect(sectionLabel('U1', 'B')).toBe('U1B');
    expect(sectionLabel('U1', undefined)).toBe('U1');
  });
});

/** Two NAND sections of one 7400 wired as an inverter chain: U1A inverts IN, U1B inverts its output. */
function twoSections(refdesB = 'U1') {
  const b = new DesignBuilder('Sections');
  const vcc = b.part('sources/vcc', 'VCC1', 300, -140, { value: '5' });
  const ga = b.part('ttl/7400-a', 'U1', 0, 0);
  const gb = b.part('ttl/7400-b', refdesB, 200, 0);
  const src = b.part('sources/logic-switch', 'S1', -160, 0, { state: 'true' });
  const gnd = b.part('sources/ground', 'GND1', -160, 100);
  b.connect(src, 'OUT', ga, '1A');
  b.wire(b.pin(ga, '1A'), b.pin(ga, '1B'));
  b.connect(ga, '1Y', gb, '2A');
  b.wire(b.pin(gb, '2A'), b.pin(gb, '2B'));
  const out = b.pin(gb, '2Y');
  b.label('OUT', out.x, out.y);
  b.wire(b.pin(gb, '2Y'), { x: 300, y: -60 });
  void vcc;
  void gnd;
  return b;
}

describe('multi-section netlisting', () => {
  it('emits one chip for the sections that share a reference designator', () => {
    const build = buildNetlist(twoSections().design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    // the 7400 builds one A element per gate; all four belong to the single chip U1
    const gates = build.netlist.elements.filter((e) => e.type === 'A' && e.name.startsWith('A_U1'));
    expect(gates).toHaveLength(4);
    expect(new Set(gates.map((e) => e.name)).size).toBe(4);
    // the two placed gates reach the schematic nets; the two spare ones sit on private nodes
    const used = build.partNets.U1;
    expect(used['1A']).toBe(used['1B']);
    expect(used['2A']).toBe(used['1Y']);
    // partNets lists the pins the sections really carry; the spare gates keep private nodes
    expect(Object.keys(used).sort()).toEqual(['1A', '1B', '1Y', '2A', '2B', '2Y']);
    expect(used['3A']).toBeUndefined();
    // every private node of a spare gate is tied to ground so the matrix stays regular
    const idle = build.netlist.elements.filter((e) => e.name.startsWith('R_U1_idle_'));
    expect(idle).toHaveLength(6);
    expect(idle.every((e) => e.value === 1e12 && e.nodes[1] === '0')).toBe(true);
  });

  it('simulates the chain: a 1 at the input comes out as a 1 after two NAND inverters', () => {
    const build = buildNetlist(twoSections().design);
    const values = op(build.netlist);
    const out = build.nets.find((n) => n.displayName === 'OUT')!;
    expect(values[`V(${out.name})`]).toBeGreaterThan(3);
  });

  it('reports one 7400 in the BOM and one component in the PCB netlist', () => {
    const design = twoSections().design;
    const bom = buildBom(design).filter((r) => r.refdes.includes('U1'));
    expect(bom).toHaveLength(1);
    expect(bom[0].partId).toBe('ttl/7400');
    expect(bom[0].quantity).toBe(1);
    const comps = pcbComponents(design).filter((c) => c.ref === 'U1');
    expect(comps).toHaveLength(1);
    expect(comps[0].footprint).toBe('DIP-14');
    // all 14 pins of the package, with the wired ones on real nets
    expect(comps[0].pins.map((p) => p.number).sort()).toEqual(['1', '10', '11', '12', '13', '2', '3', '4', '5', '6', '8', '9']);
    // the wired gates reach real nets, the spare gates have none
    expect(comps[0].pins.find((p) => p.number === '3')?.net).toBeTruthy();
    expect(comps[0].pins.find((p) => p.number === '6')?.net).toBe('OUT');
    expect(comps[0].pins.find((p) => p.number === '9')?.net).toBe('');
    expect(comps[0].pins.find((p) => p.number === '11')?.net).toBe('');
  });

  it('lists the sections nobody placed as spare gates', () => {
    const entry = spareGates(twoSections().design).find((e) => e.path === 'U1')!;
    expect(entry.def.id).toBe('ttl/7400');
    expect(entry.used).toBe(2);
    expect(entry.sections.filter((s) => s.spare).map((s) => s.section)).toEqual(['3', '4']);
  });

  it('keeps two chips apart when the sections have different designators', () => {
    const build = buildNetlist(twoSections('U2').design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(build.netlist.elements.filter((e) => e.type === 'A' && e.name.startsWith('A_U1'))).toHaveLength(4);
    expect(build.netlist.elements.filter((e) => e.type === 'A' && e.name.startsWith('A_U2'))).toHaveLength(4);
    expect(pcbComponents(twoSections('U2').design).filter((c) => c.ref === 'U1' || c.ref === 'U2')).toHaveLength(2);
  });

  it('does not report a duplicate designator for sections of one package', () => {
    const build = buildNetlist(twoSections().design);
    expect(build.erc.filter((m) => m.code === 'duplicate-refdes')).toEqual([]);
  });

  it('reports the same section placed twice', () => {
    const b = twoSections();
    b.part('ttl/7400-a', 'U1', 0, 200);
    const build = buildNetlist(b.design);
    const dup = build.erc.filter((m) => m.detail?.id === 'sectionDuplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0].severity).toBe('error');
    expect(dup[0].detail?.params).toMatchObject({ refdes: 'U1', section: 'A', label: 'U1A' });
  });

  it('reports one designator used for two different packages', () => {
    const b = twoSections();
    b.part('ttl/7408-a', 'U1', 0, 200);
    const build = buildNetlist(b.design);
    const bad = build.erc.filter((m) => m.detail?.id === 'sectionPackageConflict');
    expect(bad).toHaveLength(1);
    expect(String(bad[0].detail?.params?.packages)).toContain('ttl/7408');
  });

  it('simulates a lone section on its own', () => {
    const b = new DesignBuilder('Lone');
    const g = b.part('ttl/7400-c', 'U9', 0, 0);
    const s1 = b.part('sources/logic-switch', 'S1', -200, -20, { state: 'true' });
    const s2 = b.part('sources/logic-switch', 'S2', -200, 60, { state: 'true' });
    const gnd = b.part('sources/ground', 'GND1', -200, 160);
    b.connect(s1, 'OUT', g, '3A');
    b.connect(s2, 'OUT', g, '3B');
    const yAt = b.pin(g, '3Y');
    b.label('Y', yAt.x, yAt.y);
    void gnd;
    const build = buildNetlist(b.design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const y = build.nets.find((n) => n.displayName === 'Y')!;
    expect(op(build.netlist)[`V(${y.name})`]).toBeLessThan(1);
  });
});

describe('section helpers', () => {
  const placed = [
    { inst: { refdes: 'U1', partId: 'ttl/7400-a' }, def: section('A'), index: 0 },
    { inst: { refdes: 'U1', partId: 'ttl/7400-c' }, def: section('C'), index: 3 },
    { inst: { refdes: 'R1', partId: 'basic/resistor' }, def: getPart('basic/resistor')!, index: 1 },
  ];

  it('groups the sections of one designator and names the leader', () => {
    const groups = packageGroups(placed);
    expect(groups).toHaveLength(1);
    expect(groups[0].refdes).toBe('U1');
    expect(groups[0].packageId).toBe('ttl/7400');
    expect(groups[0].leader).toBe(0);
    expect(groups[0].placed.map((p) => p.index)).toEqual([0, 3]);
    expect(spareSections(groups[0])).toEqual(['B', 'D']);
  });

  it('takes the first placed section as the leader whatever the order', () => {
    const groups = packageGroups([placed[1], placed[0]]);
    expect(groups[0].leader).toBe(0);
  });

  it('hands the package to the first section that takes part', () => {
    // gate A excluded from the simulation (also how a variant leaves a part out): C carries the chip
    const groups = packageGroups(placed, { active: (p) => p.inst.partId !== 'ttl/7400-a' });
    expect(groups[0].leader).toBe(3);
    expect(groups[0].active).toBe(true);
    // nothing takes part: the group stays, inactive, with the first placed section as leader
    const none = packageGroups(placed, { active: () => false });
    expect(none[0].leader).toBe(0);
    expect(none[0].active).toBe(false);
  });

  it('packageKey is the identity of a chip for the designator tools', () => {
    const a = { refdes: 'U1' };
    expect(packageKey(a, section('A'))).toBe(packageKey({ refdes: 'u1' }, section('B')));
    expect(packageKey(a, section('A'))).not.toBe(packageKey({ refdes: 'U3' }, section('B')));
    expect(packageKey(a, getPart('basic/resistor'))).toBeUndefined();
  });

  it('finds no issue in a well-formed package', () => {
    expect(sectionIssues(placed)).toEqual([]);
  });

  it('collapses placed sections to one package entry', () => {
    const rows = [
      { path: 'U1', def: section('A') },
      { path: 'U1', def: section('C') },
      { path: 'R1', def: getPart('basic/resistor')! },
    ];
    const out = packageParts(rows, getPart);
    expect(out.map((r) => [r.path, r.def.id])).toEqual([
      ['U1', 'ttl/7400'],
      ['R1', 'basic/resistor'],
    ]);
  });
});
