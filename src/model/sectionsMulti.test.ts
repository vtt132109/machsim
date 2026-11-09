/**
 * Sections beyond gates (round 4 step 4): dual / quad op-amps (LM358, LM324, TL072, TL074 and their
 * library variants), dual flip-flops (7474, 74LS74, 4013), dual timers (556) and quad analog
 * switches (4066) as parts with sections and shared supply pins; free-section placement with an
 * option to start a new package; the spare-section report; annotate / renumber / paste keeping the
 * sections of a chip together.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPart, loadAllGroups } from '../library';
import type { LibraryPartDef } from '../library/partkit';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { buildBom } from './bom';
import { pcbComponents } from './pcb';
import { spareGates } from './reports';
import { annotateDesign } from './annotate';
import { replaceInDesign } from './findReplace';
import { packageOf } from './sections';
import { joinTargets, joinableRefdes, packageUses, sectionChoices } from './sectionPlan';
import { parseDesign, serializeDesign } from './serialize';
import { runAnalyses } from '../sim';
import type { Netlist } from '../sim/netlist';
import type { Design } from './types';
import { copyItems, moveToNewPackage, moveToPackage, pasteItems, placePart, setSection } from '../ui/store/designOps';
import { partLookup } from '../ui/store';

beforeAll(async () => {
  await loadAllGroups();
});

const lookup = (id: string) => getPart(id);

function op(netlist: Netlist): Record<string, number> {
  const [r] = runAnalyses({ ...netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars ?? {};
}

describe('section parts of the analog packages', () => {
  it('builds the whole dual / quad chip and one part per amplifier with the datasheet pinout', () => {
    const pkg = getPart('analog/lm358-dual')!;
    expect(pkg.name).toBe('LM358 (dual)');
    expect(pkg.symbol.pins.map((p) => [p.name, p.number])).toEqual(
      expect.arrayContaining([['1OUT', '1'], ['1IN-', '2'], ['1IN+', '3'], ['V-', '4'], ['2IN+', '5'], ['2IN-', '6'], ['2OUT', '7'], ['V+', '8']]),
    );
    const a = getPart('analog/lm358-dual-a')!;
    const b = getPart('analog/lm358-dual-b')!;
    expect(a.name).toBe('LM358A');
    expect(packageOf(b)).toEqual({ id: 'analog/lm358-dual', section: 'B', sections: ['A', 'B'] });
    expect(a.symbol.pins.map((p) => [p.name, p.number, p.type])).toEqual([
      ['1IN-', '2', 'input'],
      ['1IN+', '3', 'input'],
      ['1OUT', '1', 'output'],
      ['V+', '8', 'power'],
      ['V-', '4', 'power'],
    ]);
    expect(b.symbol.pins.map((p) => p.name)).toEqual(['2IN-', '2IN+', '2OUT', 'V+', 'V-']);
    // the sections are drawn exactly like the single op-amp: same pin positions
    const single = getPart('analog/lm358')!;
    expect(a.symbol.pins.map((p) => [p.x, p.y])).toEqual(single.symbol.pins.map((p) => [p.x, p.y]));
    // the quad
    const quad = getPart('analog/lm324-quad')!;
    expect(quad.symbol.pins.find((p) => p.name === 'V+')?.number).toBe('4');
    expect(quad.symbol.pins.find((p) => p.name === 'V-')?.number).toBe('11');
    expect(packageOf(getPart('analog/lm324-quad-d'))?.sections).toEqual(['A', 'B', 'C', 'D']);
    expect(getPart('analog/lm324-quad-d')!.symbol.pins.find((p) => p.name === '4OUT')?.number).toBe('14');
  });

  it('covers the library variants of the dual and quad op-amps', () => {
    for (const id of ['analog/tl072-dual-b', 'analog/tl074-quad-c', 'analog/lm2904-dual-a', 'analog/lm2902-quad-d', 'analog/ne5532-dual-a', 'analog/opa2134-dual-b', 'analog/lmv324-quad-a', 'analog/rc4558-dual-b', 'analog/tlc274-quad-d']) {
      expect(getPart(id), id).toBeDefined();
    }
    // every dual / quad type has its whole chip and as many sections as amplifiers
    const quad = getPart('analog/tl074-quad')!;
    expect(quad.footprint).toBe('DIP-14');
    expect((quad as LibraryPartDef).textVi?.name).toContain('bốn');
    expect((getPart('analog/tl072-dual') as LibraryPartDef).textVi?.description).toContain('kép');
  });

  it('builds flip-flop, switch and timer sections with the package pin names', () => {
    expect(getPart('ttl/74ls74-b')!.symbol.pins.map((p) => [p.name, p.number])).toEqual(
      expect.arrayContaining([['2D', '12'], ['2CLK', '11'], ['2Q', '9'], ['2QN', '8']]),
    );
    expect(packageOf(getPart('cmos/4013-b'))?.sections).toEqual(['A', 'B']);
    expect(getPart('ttl/7474-a')!.name).toBe('7474A');
    expect(getPart('cmos/74hc74-a')).toBeDefined();
    expect(getPart('ttl/7476-b')).toBeDefined();
    const sw = getPart('cmos/4066-c')!;
    expect(sw.symbol.pins.map((p) => p.name).sort()).toEqual(['3A', '3B', '3C']);
    expect(getPart('cmos/74hc4066-d')).toBeDefined();
    expect(getPart('cmos/4016-a')).toBeDefined();
    const t = getPart('analog/ne556-b')!;
    expect(t.symbol.pins.map((p) => [p.name, p.number])).toEqual(
      expect.arrayContaining([['TRIG2', '8'], ['THR2', '12'], ['OUT2', '9'], ['VCC', '14'], ['GND', '7']]),
    );
    expect(packageOf(t)?.id).toBe('analog/ne556');
    expect(getPart('analog/tlc556-a')).toBeDefined();
  });
});

/**
 * One LM358: section A is a voltage follower of 2.5 V, section B a non-inverting amplifier of gain 2
 * of 1 V. `supply` says on which section the V+ / V- pins are wired.
 */
function dualAmp(supply: 'A' | 'B' | 'both' = 'A', refdesB = 'U1'): { b: DesignBuilder; build: ReturnType<typeof buildNetlist> } {
  const b = new DesignBuilder('Dual op-amp');
  const a = b.part('analog/lm358-dual-a', 'U1', 0, 0);
  const bb = b.part('analog/lm358-dual-b', refdesB, 300, 0);
  const vcc = b.part('sources/dc-voltage', 'V1', -200, -200, { value: '12' });
  const in1 = b.part('sources/dc-voltage', 'V2', -200, 0, { value: '2.5' });
  const in2 = b.part('sources/dc-voltage', 'V3', 100, 120, { value: '1' });
  const rf = b.part('basic/resistor', 'R1', 380, 80, { value: '10k' });
  const rg = b.part('basic/resistor', 'R2', 380, 160, { value: '10k' });
  b.part('sources/ground', 'GND1', -200, 100);
  // follower: V2 -> 1IN+, 1IN- <- 1OUT
  b.labelPin(in1, '+', 'IN1');
  b.labelPin(in1, '-', '0');
  b.labelPin(a, '1IN+', 'IN1');
  b.labelPin(a, '1IN-', 'OUT1');
  b.labelPin(a, '1OUT', 'OUT1');
  // gain of 2: V3 -> 2IN+, 2IN- <- divider from 2OUT
  b.labelPin(in2, '+', 'IN2');
  b.labelPin(in2, '-', '0');
  b.labelPin(bb, '2IN+', 'IN2');
  b.labelPin(bb, '2IN-', 'FB');
  b.labelPin(bb, '2OUT', 'OUT2');
  b.labelPin(rf, '1', 'OUT2');
  b.labelPin(rf, '2', 'FB');
  b.labelPin(rg, '1', 'FB');
  b.labelPin(rg, '2', '0');
  b.labelPin(vcc, '+', 'VCC');
  b.labelPin(vcc, '-', '0');
  if (supply === 'A' || supply === 'both') {
    b.labelPin(a, 'V+', 'VCC');
    b.labelPin(a, 'V-', '0');
  }
  if (supply === 'B' || supply === 'both') {
    b.labelPin(bb, 'V+', 'VCC');
    b.labelPin(bb, 'V-', '0');
  }
  return { b, build: buildNetlist(b.design) };
}

const outV = (build: ReturnType<typeof buildNetlist>, name: string): number => {
  const net = build.nets.find((n) => n.displayName === name)!;
  return op(build.netlist)[`V(${net.name})`];
};

describe('dual op-amp netlisting with shared supply pins', () => {
  it('simulates both amplifiers of one chip, the supply wired on the first section only', () => {
    const { build } = dualAmp('A');
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    // one chip with two amplifiers
    expect(build.netlist.elements.filter((e) => e.type === 'X')).toHaveLength(2);
    expect(outV(build, 'OUT1')).toBeCloseTo(2.5, 1);
    expect(outV(build, 'OUT2')).toBeCloseTo(2.0, 1);
    // a supply pin wired once is not a floating pin of the other section
    expect(build.erc.filter((m) => m.code === 'floating-pin')).toEqual([]);
    // no idle node: every pin of the chip is on a real net
    expect(build.netlist.elements.filter((e) => e.name.startsWith('R_U1_idle_'))).toHaveLength(0);
  });

  it('takes the supply from the section that wires it, whichever section was placed first', () => {
    const { build } = dualAmp('B');
    expect(build.erc.filter((m) => m.severity === 'error' || m.code === 'floating-pin')).toEqual([]);
    expect(outV(build, 'OUT1')).toBeCloseTo(2.5, 1);
    expect(outV(build, 'OUT2')).toBeCloseTo(2.0, 1);
  });

  it('accepts the supply wired on both sections to the same net', () => {
    const { build } = dualAmp('both');
    expect(build.erc.filter((m) => m.detail?.id === 'sectionPinConflict')).toEqual([]);
    expect(outV(build, 'OUT2')).toBeCloseTo(2.0, 1);
  });

  it('reports a shared supply pin wired to two different nets', () => {
    const { b } = dualAmp('A');
    const bb = b.design.sheets[0].parts.find((p) => p.partId === 'analog/lm358-dual-b')!;
    const handle = { sheet: b.design.sheets[0], inst: bb };
    b.labelPin(handle, 'V+', 'OTHER');
    b.labelPin(handle, 'V-', '0');
    const build = buildNetlist(b.design);
    const bad = build.erc.filter((m) => m.detail?.id === 'sectionPinConflict');
    expect(bad).toHaveLength(1);
    expect(bad[0].severity).toBe('error');
    expect(bad[0].detail?.params).toMatchObject({ pin: 'V+', a: 'U1A', b: 'U1B' });
  });

  it('keeps two chips apart when the sections have different designators, each with its own supply', () => {
    const { b } = dualAmp('A', 'U2');
    const bb = b.design.sheets[0].parts.find((p) => p.refdes === 'U2')!;
    b.labelPin({ sheet: b.design.sheets[0], inst: bb }, 'V+', 'VCC');
    b.labelPin({ sheet: b.design.sheets[0], inst: bb }, 'V-', '0');
    const build = buildNetlist(b.design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(build.netlist.elements.filter((e) => e.type === 'X')).toHaveLength(4);
    // each chip has an unplaced second channel / first channel on idle nodes
    expect(build.netlist.elements.filter((e) => e.name.startsWith('R_U1_idle_'))).toHaveLength(3);
    expect(outV(build, 'OUT2')).toBeCloseTo(2.0, 1);
  });

  it('reports one LM358 in the BOM and the PCB netlist, with all eight pins', () => {
    const { b } = dualAmp('A');
    const bom = buildBom(b.design).filter((r) => r.refdes.includes('U1'));
    expect(bom).toHaveLength(1);
    expect(bom[0].partId).toBe('analog/lm358-dual');
    expect(bom[0].quantity).toBe(1);
    const comp = pcbComponents(b.design).filter((c) => c.ref === 'U1');
    expect(comp).toHaveLength(1);
    expect(comp[0].pins.map((p) => p.number).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(comp[0].pins.find((p) => p.number === '8')?.net).toBe('VCC');
    expect(comp[0].pins.find((p) => p.number === '7')?.net).toBe('OUT2');
  });

  it('saves and reopens a design with sections', () => {
    const { b } = dualAmp('A');
    const text = serializeDesign(b.design);
    expect(serializeDesign(parseDesign(text))).toBe(text);
  });
});

describe('spare sections', () => {
  it('lists an unplaced op-amp as spare and counts a signal amplifier as used', () => {
    const b = new DesignBuilder('Spare');
    const a = b.part('analog/tl072-dual-a', 'U1', 0, 0);
    const v = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '1' });
    b.labelPin(v, '+', 'IN');
    b.labelPin(v, '-', '0');
    b.labelPin(a, '1IN+', 'IN');
    b.labelPin(a, '1IN-', 'OUT');
    b.labelPin(a, '1OUT', 'OUT');
    const entry = spareGates(b.design).find((e) => e.path === 'U1')!;
    expect(entry.def.id).toBe('analog/tl072-dual');
    expect(entry.used).toBe(1);
    expect(entry.sections.filter((s) => s.spare).map((s) => s.section)).toEqual(['2']);
    expect(entry.sections.find((s) => s.section === '2')?.pins).toEqual(['2IN+', '2IN-', '2OUT']);
  });

  it('counts an unused amplifier tied off as a follower to ground as spare', () => {
    const b = new DesignBuilder('Tied off');
    const bb = b.part('analog/tl072-dual-b', 'U1', 0, 0);
    b.labelPin(bb, '2IN+', '0');
    b.labelPin(bb, '2IN-', 'SELF');
    b.labelPin(bb, '2OUT', 'SELF');
    const entry = spareGates(b.design).find((e) => e.path === 'U1')!;
    expect(entry.sections.find((s) => s.section === '2')?.spare).toBe(true);
    expect(entry.sections.find((s) => s.section === '1')?.spare).toBe(true);
    expect(entry.used).toBe(0);
  });

  it('knows the sections of a 556 from its section parts', () => {
    const b = new DesignBuilder('Timers');
    const t = b.part('analog/ne556-a', 'U1', 0, 0);
    b.labelPin(t, 'OUT1', 'Q1');
    b.labelPin(t, 'DIS1', 'D1');
    b.labelPin(t, 'THR1', 'D1');
    b.labelPin(t, 'TRIG1', 'D1');
    const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    b.labelPin(r, '1', 'Q1');
    b.labelPin(r, '2', '0');
    const entry = spareGates(b.design).find((e) => e.path === 'U1')!;
    expect(entry.def.id).toBe('analog/ne556');
    expect(entry.sections.map((s) => [s.section, s.spare])).toEqual([['A', false], ['B', true]]);
  });

  it('reports the unplaced flip-flop of a 74LS74', () => {
    const b = new DesignBuilder('FF');
    const ff = b.part('ttl/74ls74-a', 'U1', 0, 0);
    const s = b.part('sources/logic-switch', 'S1', -200, 0, { state: 'true' });
    b.connect(s, 'OUT', ff, '1D');
    const entry = spareGates(b.design).find((e) => e.path === 'U1')!;
    expect(entry.def.id).toBe('ttl/74ls74');
    expect(entry.sections.filter((x) => x.spare).map((x) => x.section)).toEqual(['2']);
  });
});

describe('flip-flop, switch and timer sections in the netlist', () => {
  it('builds one 7474 from two placed flip-flop sections and idles the rest', () => {
    const b = new DesignBuilder('Two FFs');
    const a = b.part('ttl/74ls74-a', 'U1', 0, 0);
    const c = b.part('ttl/74ls74-b', 'U1', 300, 0);
    b.labelPin(a, '1Q', 'Q1');
    b.labelPin(c, '2D', 'Q1');
    const build = buildNetlist(b.design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const ffs = build.netlist.elements.filter((e) => e.type === 'A' && e.name.startsWith('A_U1'));
    expect(ffs).toHaveLength(2);
    expect(build.partNets.U1['1Q']).toBe(build.partNets.U1['2D']);
    expect(buildBom(b.design).filter((r) => r.refdes.includes('U1'))).toHaveLength(1);
    expect(pcbComponents(b.design).filter((x) => x.ref === 'U1')).toHaveLength(1);
  });

  it('a 4066 section conducts between its two pins while its control input is high', () => {
    const b = new DesignBuilder('Switch');
    const sw = b.part('cmos/74hc4066-b', 'U1', 0, 0);
    const v = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '3' });
    const ctl = b.part('sources/logic-switch', 'S1', -200, 120, { state: 'true' });
    const r = b.part('basic/resistor', 'R1', 200, 0, { value: '10k' });
    b.part('sources/ground', 'GND1', -200, 220);
    b.labelPin(v, '+', 'IN');
    b.labelPin(v, '-', '0');
    b.labelPin(sw, '2A', 'IN');
    b.labelPin(sw, '2B', 'OUT');
    b.labelPin(ctl, 'OUT', 'CTL');
    b.labelPin(sw, '2C', 'CTL');
    b.labelPin(r, '1', 'OUT');
    b.labelPin(r, '2', '0');
    const build = buildNetlist(b.design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    // 40 ohm on-resistance against 10 kOhm: almost all of the 3 V
    expect(outV(build, 'OUT')).toBeGreaterThan(2.9);
  });
});

describe('placing sections', () => {
  const place = (d: Design, partId: string, x: number, opts = {}) => {
    const r = placePart(d, d.sheets[0].id, partId, { x, y: 0 }, 0, false, partLookup, opts);
    return { design: r.design, inst: r.design.sheets[0].parts.find((p) => p.id === r.id)! };
  };

  it('joins the lowest-numbered package that has the section free', () => {
    let d = new DesignBuilder('Place').design;
    const a1 = place(d, 'analog/lm358-dual-a', 0);
    d = a1.design;
    const b1 = place(d, 'analog/lm358-dual-b', 200);
    d = b1.design;
    // A and B share U1
    expect(a1.inst.refdes).toBe('U1');
    expect(b1.inst.refdes).toBe('U1');
    // a second A has no free A in U1: a new chip
    const a2 = place(d, 'analog/lm358-dual-a', 400);
    d = a2.design;
    expect(a2.inst.refdes).toBe('U2');
    // the next B joins U2, whose B is free
    const b2 = place(d, 'analog/lm358-dual-b', 600);
    expect(b2.inst.refdes).toBe('U2');
    // an ordinary part never joins a package
    expect(place(b2.design, 'basic/resistor', 800).inst.refdes).toBe('R1');
  });

  it('starts a new package on request even when a section is free', () => {
    let d = new DesignBuilder('New').design;
    d = place(d, 'ttl/74ls74-a', 0).design;
    const forced = place(d, 'ttl/74ls74-b', 200, { newPackage: true });
    expect(forced.inst.refdes).toBe('U2');
    expect(joinableRefdes(d.sheets, partLookup('ttl/74ls74-b')!, partLookup)).toBe('U1');
    expect(joinableRefdes(d.sheets, partLookup('ttl/74ls74-b')!, partLookup, { newPackage: true })).toBeUndefined();
  });

  it('describes a package and moves sections between packages', () => {
    let d = new DesignBuilder('Move').design;
    d = place(d, 'ttl/74ls74-a', 0).design;
    d = place(d, 'ttl/74ls74-b', 200).design;
    const [a, b] = d.sheets[0].parts;
    const uses = packageUses(d.sheets, partLookup);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ refdes: 'U1', packageId: 'ttl/74ls74', free: [] });
    // B cannot become A: A is taken
    expect(setSection(d, b.id, 'A', partLookup)).toBe(d);
    // B can leave for a new chip: it becomes U2B
    const split = moveToNewPackage(d, b.id, partLookup);
    expect(split.sheets[0].parts.find((p) => p.id === b.id)?.refdes).toBe('U2');
    expect(split.sheets[0].parts.find((p) => p.id === a.id)?.refdes).toBe('U1');
    // now A may switch to the free section B inside U1 ...
    const switched = setSection(split, a.id, 'B', partLookup);
    expect(switched.sheets[0].parts.find((p) => p.id === a.id)?.partId).toBe('ttl/74ls74-b');
    // ... and B (of U2) may join U1 only if its letter is free there
    const usesSplit = packageUses(split.sheets, partLookup);
    const choices = sectionChoices(usesSplit.find((u) => u.refdes === 'U1')!, a, partLookup);
    expect(choices.map((c) => [c.letter, c.current, c.free])).toEqual([['A', true, true], ['B', false, true]]);
    const bNow = split.sheets[0].parts.find((p) => p.id === b.id)!;
    expect(joinTargets(usesSplit, bNow, partLookup, bNow.partId).map((u) => u.refdes)).toEqual(['U1']);
    const joined = moveToPackage(split, b.id, 'U1', partLookup);
    expect(joined.sheets[0].parts.find((p) => p.id === b.id)?.refdes).toBe('U1');
    // a package whose section is taken is refused
    expect(moveToPackage(d, b.id, 'U1', partLookup)).toBe(d);
  });
});

describe('designators of sections stay together', () => {
  function chips(): Design {
    const b = new DesignBuilder('Chips');
    b.part('analog/tl074-quad-a', 'U7', 0, 0);
    b.part('analog/tl074-quad-b', 'U7', 200, 0);
    b.part('ttl/74ls74-a', 'U3', 400, 0);
    b.part('ttl/74ls74-b', 'U3', 600, 0);
    b.part('basic/resistor', 'R5', 0, 200, { value: '1k' });
    return b.design;
  }

  it('annotate and renumber give the sections of a chip one designator', () => {
    const d = chips();
    const all = annotateDesign(d, { mode: 'all' }).design.sheets[0].parts;
    expect(all.map((p) => p.refdes)).toEqual(['U1', 'U1', 'U2', 'U2', 'R1']);
    // missing: valid, unique designators are kept; the sections of one chip are not duplicates of each other
    const missing = annotateDesign(d, { mode: 'missing' });
    expect(missing.design.sheets[0].parts.map((p) => p.refdes)).toEqual(['U7', 'U7', 'U3', 'U3', 'R5']);
    expect(missing.changes).toEqual({});
  });

  it('find and replace renames the sections of a chip together', () => {
    const d = chips();
    const out = replaceInDesign(d, 'U7', 'U9', { fields: ['refdes'] }).design;
    expect(out.sheets[0].parts.map((p) => p.refdes)).toEqual(['U9', 'U9', 'U3', 'U3', 'R5']);
  });

  it('paste keeps the copied sections together and gives them a fresh designator', () => {
    const d = chips();
    const sheet = d.sheets[0];
    const clip = copyItems(d, sheet.id, [{ kind: 'part', id: sheet.parts[2].id }, { kind: 'part', id: sheet.parts[3].id }], partLookup)!;
    const out = pasteItems(d, sheet.id, clip, { x: 0, y: 300 }, partLookup).design;
    const pasted = out.sheets[0].parts.slice(5);
    expect(pasted).toHaveLength(2);
    expect(new Set(pasted.map((p) => p.refdes)).size).toBe(1);
    expect(['U3', 'U7']).not.toContain(pasted[0].refdes);
    // the netlist sees three chips
    const build = buildNetlist(out);
    expect(build.erc.filter((m) => m.detail?.id === 'sectionDuplicate' || m.detail?.id === 'sectionPackageConflict')).toEqual([]);
  });
});
