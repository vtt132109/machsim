/**
 * PCB transfer: KiCad and CSV netlists, reading an earlier export back, forward annotation of the
 * changes since, and back annotation from a PCB tool's file.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { annotationText, applyBackAnnotation, csvNetlist, forwardAnnotation, kicadNetlist, parseAnnotation, pcbComponents, pcbNets, readNetlistSnapshot } from './pcb';
import type { Design } from './types';

function board(): Design {
  const b = new DesignBuilder('Board');
  const r1 = b.part('basic/resistor', 'R1', 100, 100, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 200, 100, { value: '2.2k' });
  const c1 = b.part('basic/capacitor', 'C1', 300, 100, { value: '100n' });
  const v1 = b.part('sources/dc-voltage', 'V1', 0, 100, { value: '5' });
  b.part('sources/ground', 'GND1', 0, 200);
  b.part('instruments/multimeter', 'XMM1', 400, 100);
  b.labelPin(v1, '+', 'VIN');
  b.labelPin(v1, '-', '0');
  b.labelPin(r1, '1', 'VIN');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r2, '1', 'OUT');
  b.labelPin(r2, '2', '0');
  b.labelPin(c1, '1', 'OUT');
  b.labelPin(c1, '2', '0');
  b.design.sheets[0].parts.find((p) => p.refdes === 'C1')!.fields = { footprint: 'C_0805' };
  return b.design;
}

describe('PCB netlists', () => {
  it('transfers only physical parts, with footprints, uids and pin nets', () => {
    const comps = pcbComponents(board());
    expect(comps.map((c) => [c.ref, c.value, c.footprint])).toEqual([
      ['R1', '1 kΩ', 'RES-AXIAL-400'],
      ['R2', '2.2 kΩ', 'RES-AXIAL-400'],
      ['C1', '100 nF', 'C_0805'],
    ]);
    expect(comps[0].pins).toEqual([
      { number: '1', name: '1', net: 'VIN' },
      { number: '2', name: '2', net: 'OUT' },
    ]);
    expect(comps[1].pins[1].net).toBe('GND');
    expect(pcbNets(comps).map((n) => [n.name, n.nodes.length])).toEqual([
      ['GND', 2],
      ['OUT', 3],
      ['VIN', 1],
    ]);
  });

  it('writes a KiCad netlist that reads back to the same components and nets', () => {
    const d = board();
    const text = kicadNetlist(d, { source: 'board.msim', date: '2026-11-09', tool: 'MachSim' });
    expect(text.startsWith('(export (version "E")')).toBe(true);
    expect(text).toContain('(comp (ref "C1")');
    expect(text).toContain('(footprint "C_0805")');
    expect(text).toContain('(net (code "2") (name "/OUT")');
    expect(text).toContain('(node (ref "R1") (pin "2"))');
    // balanced parentheses
    let depth = 0;
    for (const ch of text.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    const snap = readNetlistSnapshot(text);
    expect(snap.components.map((c) => c.ref)).toEqual(['R1', 'R2', 'C1']);
    expect(snap.components[0].uid).toBe(d.sheets[0].parts[0].id);
    expect(snap.pinNets.get(`${snap.components[0].uid}#2`)).toBe('OUT');
    expect(forwardAnnotation(snap, d)).toEqual([]);
  });

  it('writes a CSV pin list that reads back too', () => {
    const csv = csvNetlist(board());
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Reference,Value,Footprint,Pin,PinName,Net,Uid');
    expect(lines).toHaveLength(7);
    expect(lines[1].startsWith('R1,1 kΩ,RES-AXIAL-400,1,1,VIN,')).toBe(true);
    expect(forwardAnnotation(readNetlistSnapshot(csv), board())).toEqual([]);
  });
});

describe('annotation', () => {
  it('forward: renames, values, footprints, added / removed parts and moved pins', () => {
    const d = board();
    const old = readNetlistSnapshot(kicadNetlist(d, { source: '', date: '', tool: '' }));
    const parts = d.sheets[0].parts;
    parts.find((p) => p.refdes === 'R1')!.refdes = 'R10';
    parts.find((p) => p.refdes === 'R2')!.params.value = '4.7k';
    parts.find((p) => p.refdes === 'C1')!.fields = { footprint: 'C_1206' };
    const b = new DesignBuilder('x');
    const r9 = b.part('basic/resistor', 'R9', 500, 500, { value: '10k' });
    d.sheets[0].parts.push({ ...r9.inst, id: 'added-r9' });
    const changes = forwardAnnotation(old, d);
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: 'rename', from: 'R1', to: 'R10' },
        { kind: 'value', ref: 'R2', from: '2.2 kΩ', to: '4.7 kΩ' },
        { kind: 'footprint', ref: 'C1', from: 'C_0805', to: 'C_1206' },
        { kind: 'add', ref: 'R9', value: '10 kΩ', footprint: 'RES-AXIAL-400' },
      ]),
    );
    const text = annotationText(changes, 'forward', '2026-11-09');
    expect(text.split('\r\n')[0]).toBe('MachSim annotation\t1');
    // the file reads back into the same changes
    expect(parseAnnotation(text).commands.map((c) => c.change)).toEqual(changes.map((c) => (c.kind === 'net' ? c : c)));
  });

  it('back annotation: swaps, values and footprints; PCB-only lines and unknown parts are skipped', () => {
    const d = board();
    const parsed = parseAnnotation(['# from the board', 'R1 R2', 'R2 R1', 'value C1 220n', 'footprint R1 R_0603', 'remove R2', 'rename R7 R8', 'garbage line here'].join('\n'));
    expect(parsed.errors).toEqual([8]);
    const r = applyBackAnnotation(d, parsed.commands);
    const refs = r.design.sheets[0].parts.map((p) => `${p.id}:${p.refdes}`);
    const [id1, id2] = [d.sheets[0].parts[0].id, d.sheets[0].parts[1].id];
    expect(refs).toContain(`${id1}:R2`);
    expect(refs).toContain(`${id2}:R1`);
    expect(r.design.sheets[0].parts.find((p) => p.refdes === 'C1')!.params.value).toBe('220n');
    expect(r.design.sheets[0].parts.find((p) => p.id === id1)!.fields?.footprint).toBe('R_0603');
    expect(r.applied).toBe(4);
    expect(r.skipped.map((s) => s.reason)).toEqual(['unsupported', 'unknownRef']);
    // a rename onto a taken reference is refused
    const clash = applyBackAnnotation(board(), parseAnnotation('rename R1 C1').commands);
    expect(clash.applied).toBe(0);
    expect(clash.skipped[0].reason).toBe('refTaken');
  });
});
