/**
 * Update components from library: differences between the placed parts and the current library,
 * one-step updates that keep the wiring, and Replace component keeping the wires.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import { customPartDef } from '../../library/custom/partDef';
import type { CustomPartData } from '../../library/custom/types';
import { partFingerprint } from '../../library/partFingerprint';
import { boxSymbol } from '../../library/symbols';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { parseDesign, serializeDesign } from '../../model/serialize';
import type { Design, Point } from '../../model/types';
import { compareWithLibrary, stampLibraryRefs, stampLibraryRefsAtLoad, updateFromLibrary } from './libraryUpdate';
import { replacePart } from './schematicOps';
import type { PartLookup } from './types';

const noDb = () => undefined;
const lookupIn = (design: Design): PartLookup => (id) => {
  const c = design.customParts?.find((x) => x.id === id);
  return c ? customPartDef(c) : getPart(id);
};

/** Pin nets of a part in the netlist (refdes → pin → node). */
const netsOf = (d: Design, refdes: string) => buildNetlist(d, { includeAnalysis: false }).partNets[refdes];

/**
 * V1 (+ at (0,-30), − at (0,30)) feeding R1 at (200, 0). The wires were drawn when the resistor's
 * pins sat 10 units further out (±40): `stale` keeps that drawing and an "old library" reference.
 */
function staleDesign(): Design {
  const b = new DesignBuilder('Stale');
  b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k', oldtrim: '3' });
  b.part('sources/ground', 'GND1', 0, 100);
  const p = (x: number, y: number): Point => ({ x, y });
  b.wire(p(0, -30), p(0, -80), p(160, -80), p(160, 0));
  b.wire(p(240, 0), p(240, 80), p(0, 80), p(0, 30));
  b.wire(p(0, 30), p(0, 100));
  expect(r.inst.params.oldtrim).toBe('3');
  const def = getPart('basic/resistor')!;
  const defaults = Object.fromEntries(def.params.map((x) => [x.key, x.default]));
  // the old library had an "oldtrim" parameter and pins at ±40
  return { ...b.design, libraryRefs: { 'basic/resistor': { sig: 'old-version', pins: { '1': [-40, 0], '2': [40, 0] }, defaults: { ...defaults, oldtrim: '0' } } } };
}

describe('compare with the library', () => {
  it('lists moved pins and removed parameters of a part whose definition changed', () => {
    const d = staleDesign();
    const diffs = compareWithLibrary(d, getPart, noDb);
    expect(diffs).toHaveLength(1);
    const r = diffs[0];
    expect(r).toMatchObject({ partId: 'basic/resistor', kind: 'builtin', status: 'changed' });
    expect(r.instances.map((i) => i.path)).toEqual(['R1']);
    expect(r.changes).toEqual(expect.arrayContaining([{ kind: 'pinMoved', pin: '1' }, { kind: 'pinMoved', pin: '2' }, { kind: 'paramRemoved', key: 'oldtrim' }]));
    // before the update the resistor touches no wire
    const before = netsOf(d, 'R1');
    expect(before['1']).toMatch(/^NC_/);
    expect(before['2']).toMatch(/^NC_/);
  });

  it('reports invalid choices and parts missing from the library; an up-to-date design has no differences', () => {
    const b = new DesignBuilder('Choices');
    b.part('basic/rotary-switch-4', 'S1', 0, 0, { position: '7' });
    b.part('basic/no-such-part', 'U9', 300, 0);
    const diffs = compareWithLibrary(b.design, getPart, noDb);
    expect(diffs.map((x) => x.status)).toEqual(['changed', 'missing']);
    expect(diffs[0].changes).toEqual([{ kind: 'optionInvalid', key: 'position', value: '7', refdes: ['S1'] }]);
    expect(diffs[1]).toMatchObject({ partId: 'basic/no-such-part', changes: [] });
    // a freshly stamped design matches the library
    const fresh = new DesignBuilder('Fresh');
    fresh.part('basic/resistor', 'R1', 0, 0);
    expect(compareWithLibrary(stampLibraryRefs(fresh.design, getPart), getPart, noDb)).toEqual([]);
  });
});

describe('update from the library', () => {
  it('moves the wires onto the new pins, drops removed parameters and refreshes the reference', () => {
    const d = staleDesign();
    const r = updateFromLibrary(d, ['basic/resistor'], getPart, noDb);
    expect(r).toMatchObject({ parts: 1, instances: 1 });
    const inst = r.design.sheets[0].parts.find((p) => p.refdes === 'R1')!;
    expect(inst.params).toEqual({ value: '1k' });
    expect(r.design.libraryRefs?.['basic/resistor'].sig).toBe(partFingerprint(getPart('basic/resistor')!));
    // the wires now end on the pins: R1 sits between V1+ and the ground net
    const nets = netsOf(r.design, 'R1');
    const v1 = netsOf(r.design, 'V1');
    expect(nets['1']).toBe(v1['+']);
    expect(nets['2']).toBe('0');
    const ends = r.design.sheets[0].wires.flatMap((w) => [w.points[0], w.points[w.points.length - 1]]);
    expect(ends).toEqual(expect.arrayContaining([{ x: 170, y: 0 }, { x: 230, y: 0 }]));
    // nothing left to update; updating again changes nothing
    expect(compareWithLibrary(r.design, getPart, noDb)).toEqual([]);
    expect(updateFromLibrary(r.design, ['basic/zzz'], getPart, noDb).design).toBe(r.design);
    // the design still saves and reads back
    expect(parseDesign(serializeDesign(r.design)).libraryRefs).toEqual(r.design.libraryRefs);
  });

  it('resets invalid choices to the default', () => {
    const b = new DesignBuilder('Choices');
    b.part('basic/rotary-switch-4', 'S1', 0, 0, { position: '7' });
    const r = updateFromLibrary(b.design, ['basic/rotary-switch-4'], getPart, noDb);
    expect(r.design.sheets[0].parts[0].params.position).toBeUndefined();
    expect(compareWithLibrary(r.design, getPart, noDb)).toEqual([]);
  });

  it('replaces an embedded user component by its database copy and keeps it wired', () => {
    const old: CustomPartData = {
      id: 'custom:upd-box',
      name: 'Box',
      group: 'misc',
      family: 'User',
      description: 'test box',
      prefix: 'U',
      symbol: boxSymbol({ left: [{ name: 'A' }], right: [{ name: 'B' }] }),
      model: { kind: 'spice', text: '.subckt BOXR a b\nR1 a b 1k\n.ends', name: 'BOXR', pins: ['A', 'B'] },
    };
    // the database copy: a wider body (pins further out), another resistance, a new footprint
    const fresh: CustomPartData = { ...old, symbol: boxSymbol({ left: [{ name: 'A' }], right: [{ name: 'B' }], w: 100 }), model: { ...old.model, text: '.subckt BOXR a b\nR1 a b 2k\n.ends' } as CustomPartData['model'], footprint: 'SIP-2', modified: '2026-11-09T00:00:00Z' };
    const b = new DesignBuilder('Custom');
    b.design.customParts = [old];
    const u = b.part(old.id, 'U1', 200, 0);
    const pa = b.pin(u, 'A');
    const pb = b.pin(u, 'B');
    b.labelPin(u, 'A', 'IN');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '1' });
    b.labelPin(v, '+', 'IN');
    b.labelPin(v, '-', '0');
    b.wire(pb, { x: pb.x, y: 100 });
    b.part('sources/ground', 'GND1', pb.x, 100);
    const db = (id: string) => (id === old.id ? fresh : undefined);
    const diffs = compareWithLibrary(b.design, lookupIn(b.design), db);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe('custom');
    expect(diffs[0].changes).toEqual(expect.arrayContaining([{ kind: 'pinMoved', pin: 'A' }, { kind: 'pinMoved', pin: 'B' }, { kind: 'modelChanged' }, { kind: 'footprintChanged', from: '', to: 'SIP-2' }]));
    const r = updateFromLibrary(b.design, [old.id], lookupIn(b.design), db);
    expect(r.design.customParts).toEqual([fresh]);
    const nets = buildNetlist(r.design, { includeAnalysis: false });
    expect(nets.partNets.U1.A).toBe('IN');
    expect(nets.partNets.U1.B).toBe('0');
    // the wider body moved pin A: the label that sat on it moved with it
    const oldA = old.symbol.pins.find((p) => p.name === 'A')!;
    const newA = fresh.symbol.pins.find((p) => p.name === 'A')!;
    expect(newA.x).not.toBe(oldA.x);
    expect(pa).toEqual({ x: 200 + oldA.x, y: oldA.y });
    expect(r.design.sheets[0].labels.some((l) => l.name === 'IN' && l.x === 200 + newA.x && l.y === newA.y)).toBe(true);
    expect(compareWithLibrary(r.design, lookupIn(r.design), db)).toEqual([]);
  });

  it('stamps references for new parts on save and drops unused ones', () => {
    const b = new DesignBuilder('Stamp');
    b.part('basic/resistor', 'R1', 0, 0);
    b.part('sources/dc-voltage', 'V1', 200, 0);
    const s1 = stampLibraryRefs(b.design, getPart);
    expect(Object.keys(s1.libraryRefs ?? {})).toEqual(['basic/resistor', 'sources/dc-voltage']);
    expect(s1.libraryRefs?.['basic/resistor'].pins).toEqual({ '1': [-30, 0], '2': [30, 0] });
    expect(stampLibraryRefs(s1, getPart)).toBe(s1);
    const without = { ...s1, sheets: [{ ...s1.sheets[0], parts: s1.sheets[0].parts.filter((p) => p.refdes !== 'V1') }] };
    expect(Object.keys(stampLibraryRefs(without, getPart).libraryRefs ?? {})).toEqual(['basic/resistor']);
    // an old reference is kept until the part is updated
    const stale = staleDesign();
    expect(stampLibraryRefs(stale, getPart).libraryRefs?.['basic/resistor'].sig).toBe('old-version');
  });
});

describe('a teacher’s older file without libraryRefs (round 4 step 5)', () => {
  /** The same circuit as `staleDesign`, but written before `Design.libraryRefs` existed. */
  function oldFile(): Design {
    const d = staleDesign();
    const { libraryRefs: _drop, ...rest } = d;
    return rest as Design;
  }

  it('reports the real difference it can see: a parameter the library no longer declares', () => {
    const d = oldFile();
    expect(d.libraryRefs).toBeUndefined();
    const diffs = compareWithLibrary(d, getPart, noDb);
    // the file stores oldtrim = 3 on R1 and the current resistor has no such parameter
    expect(diffs.map((x) => x.partId)).toEqual(['basic/resistor']);
    expect(diffs[0].changes).toEqual([{ kind: 'paramRemoved', key: 'oldtrim' }]);
    expect(diffs[0].instances.map((i) => i.path)).toEqual(['R1']);
  });

  it('says nothing for an old file whose instance parameters all still exist', () => {
    const b = new DesignBuilder('Clean old file');
    b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
    b.part('sources/dc-voltage', 'V1', 200, 0, { value: '5' });
    expect(compareWithLibrary(b.design, getPart, noDb)).toEqual([]);
  });

  it('stamping at load fills the baseline in memory, and a file that has one is untouched', () => {
    const d = oldFile();
    const stamped = stampLibraryRefsAtLoad(d, getPart);
    expect(Object.keys(stamped.libraryRefs ?? {}).sort()).toEqual(['basic/resistor', 'sources/dc-voltage', 'sources/ground']);
    expect(stamped.libraryRefs?.['basic/resistor'].sig).toBe(partFingerprint(getPart('basic/resistor')!));
    // the stamped file reports only the instance-parameter difference, never a phantom "changed"
    const diffs = compareWithLibrary(stamped, getPart, noDb);
    expect(diffs.map((x) => x.changes)).toEqual([[{ kind: 'paramRemoved', key: 'oldtrim' }]]);
    // a file that already carries references keeps them (the stale reference still reports)
    const stale = staleDesign();
    expect(stampLibraryRefsAtLoad(stale, getPart)).toBe(stale);
    expect(compareWithLibrary(stale, getPart, noDb)[0].changes).toEqual(
      expect.arrayContaining([{ kind: 'pinMoved', pin: '1' }]),
    );
  });

  it('the stamped design saves and reopens', () => {
    const stamped = stampLibraryRefsAtLoad(oldFile(), getPart);
    expect(parseDesign(serializeDesign(stamped)).libraryRefs).toEqual(stamped.libraryRefs);
  });
});

describe('Replace component keeps the wires', () => {
  it('a horizontal resistor replaced by a vertical source stays on the same nets', () => {
    const b = new DesignBuilder('Replace');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '9' });
    const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '1k' });
    b.part('sources/ground', 'GND1', 0, 100);
    b.connect(v, '+', r, '1');
    b.connect(r, '2', r2, '1');
    b.labelPin(r2, '2', '0');
    b.wire(b.pin(v, '-'), { x: 0, y: 100 });
    const before = netsOf(b.design, 'R1');
    const sheet = b.design.sheets[0];
    const next = replacePart(b.design, sheet.id, r.inst.id, 'basic/capacitor', getPart);
    expect(next.sheets[0].parts.find((p) => p.id === r.inst.id)?.partId).toBe('basic/capacitor');
    const after = netsOf(next, next.sheets[0].parts.find((p) => p.id === r.inst.id)!.refdes);
    expect(after).toEqual(before);
    // pins at other places: the wires follow them (a source has vertical pins)
    const vert = replacePart(b.design, sheet.id, r.inst.id, 'sources/dc-voltage', getPart);
    const inst = vert.sheets[0].parts.find((p) => p.id === r.inst.id)!;
    const moved = netsOf(vert, inst.refdes);
    expect([moved['+'], moved['-']]).toEqual([before['1'], before['2']]);
    expect(buildNetlist(vert, { includeAnalysis: false }).erc.filter((m) => m.code === 'floating-pin')).toEqual([]);
  });
});
