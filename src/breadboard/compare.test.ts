import { describe, expect, it } from 'vitest';
import { compareWithSchematic, type CheckResult } from './compare';
import { autoPlace } from './autoplace';
import { DesignBuilder } from '../model/designkit';
import { astable555Circuit, nandLedCircuit, seriesLedCircuit, transistorSwitchCircuit } from './examples';
import type { BreadboardHole, BreadboardLayout, PartPlacement } from './types';

const H = (row: BreadboardHole['row'], col: number, board = 'bb1'): BreadboardHole => ({ board, row, col });

/** Hand-built correct layout of the series LED circuit. */
function ledLayout(): BreadboardLayout {
  return {
    version: 1,
    boards: [{ id: 'bb1', kind: 'full', x: 0, y: 0 }],
    placements: [
      { refdes: 'R1', pins: { '1': H('e', 3), '2': H('e', 7) } },
      { refdes: 'LED1', pins: { A: H('d', 7), K: H('d', 8) } },
    ],
    wires: [
      { id: 'w1', from: H('a', 3), to: H('top+', 3), color: 'red' },
      // column 8 is a gap between rail groups, so the ground jumper goes to top−9
      { id: 'w2', from: H('a', 8), to: H('top-', 9), color: 'black' },
    ],
    clips: [
      { id: 'c1', refdes: 'BAT1', pin: '+', hole: H('top+', 4), color: 'red' },
      { id: 'c2', refdes: 'BAT1', pin: '-', hole: H('top-', 4), color: 'black' },
    ],
  };
}

const kinds = (r: CheckResult) => r.issues.map((i) => i.kind).sort();
const setPins = (l: BreadboardLayout, refdes: string, pins: PartPlacement['pins']): BreadboardLayout => ({
  ...l,
  placements: l.placements.map((p) => (p.refdes === refdes ? { ...p, pins } : p)),
});

describe('compareWithSchematic on the series LED circuit', () => {
  const design = seriesLedCircuit();

  it('accepts a correct layout with no issues', () => {
    const r = compareWithSchematic(design, ledLayout());
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({ errors: 0, warnings: 0, placed: 2, total: 2 });
    expect(r.hints.map((h) => h.kind)).toEqual(['polarity-ok']);
    expect(r.hints[0].message.vi).toContain('chân dài (anode) ở d7');
  });

  it('maps breadboard nets to schematic nets', () => {
    const r = compareWithSchematic(design, ledLayout());
    const id = r.connectivity.stripNet.get('bb1:7:ae')!;
    expect(r.schematicNets.get(id)).toEqual(['N_LED']);
    expect(r.schematicNets.get(r.connectivity.stripNet.get('bb1:top-')!)).toEqual(['0']);
    expect(r.netDisplay.get('0')).toBe('GND');
  });

  it('reports an unplaced part', () => {
    const l = ledLayout();
    const r = compareWithSchematic(design, { ...l, placements: l.placements.filter((p) => p.refdes !== 'LED1') });
    expect(kinds(r)).toEqual(['unplaced-part']);
    expect(r.issues[0].refdes).toEqual(['LED1']);
    expect(r.issues[0].message.vi).toContain('chưa có trên breadboard');
    expect(r.counts.placed).toBe(1);
  });

  it('reports missing clip leads of the battery', () => {
    const r = compareWithSchematic(design, { ...ledLayout(), clips: [] });
    expect(kinds(r)).toEqual(['clip-missing']);
    expect(r.issues[0].message.en).toContain('Pin +, -');
  });

  it('detects a reversed LED and explains it once', () => {
    const r = compareWithSchematic(design, setPins(ledLayout(), 'LED1', { A: H('d', 8), K: H('d', 7) }));
    expect(kinds(r)).toEqual(['polarity']);
    const i = r.issues[0];
    expect(i.severity).toBe('error');
    expect(i.refdes).toEqual(['LED1']);
    expect(i.message.vi).toContain('anode (chân dài)');
    expect(i.holes).toEqual([H('d', 8), H('d', 7)]);
    expect(i.fix.vi).toBe('Xoay LED1 180° để đổi chỗ hai chân: chọn LED1 rồi nhấn Shift+R.');
  });

  it('detects a part shorted by both leads in one strip', () => {
    const r = compareWithSchematic(design, setPins(ledLayout(), 'R1', { '1': H('b', 3), '2': H('e', 3) }));
    expect(kinds(r)).toContain('part-shorted');
    expect(kinds(r)).not.toContain('short');
    const i = r.issues.find((x) => x.kind === 'part-shorted')!;
    expect(i.message.vi).toContain('cột 3, hàng a–e');
    expect(i.nets.sort()).toEqual(['N_LED', 'VBAT']);
  });

  it('detects a short between schematic nets made by a jumper', () => {
    const l = ledLayout();
    const r = compareWithSchematic(design, { ...l, wires: [...l.wires, { id: 'w3', from: H('a', 7), to: H('top-', 7), color: 'black' }] });
    expect(kinds(r)).toEqual(['short']);
    expect(r.issues[0].nets.sort()).toEqual(['0', 'N_LED']);
    expect(r.issues[0].title.vi).toContain('Chập mạch');
  });

  it('detects a missing connection', () => {
    const l = ledLayout();
    const r = compareWithSchematic(design, { ...l, wires: l.wires.filter((w) => w.id !== 'w2') });
    expect(kinds(r)).toEqual(['missing-connection']);
    const i = r.issues[0];
    expect(i.nets).toEqual(['0']);
    expect(i.title.vi).toBe('Thiếu kết nối: GND (đất, 0 V)');
    expect(i.refdes.sort()).toEqual(['BAT1', 'LED1']);
    expect(i.holes).toContainEqual(H('d', 8));
  });

  it('detects two leads in one hole', () => {
    const r = compareWithSchematic(design, setPins(ledLayout(), 'LED1', { A: H('e', 7), K: H('d', 8) }));
    expect(kinds(r)).toEqual(['hole-conflict']);
    expect(r.issues[0].holes).toEqual([H('e', 7)]);
    expect(r.issues[0].refdes.sort()).toEqual(['LED1', 'R1']);
  });

  it('detects leads off the board, missing leads and stale entries', () => {
    const off = compareWithSchematic(design, setPins(ledLayout(), 'R1', { '1': H('e', 3), '2': H('e', 70) }));
    expect(kinds(off)).toEqual(['lead-off-board']);
    const gap = compareWithSchematic(design, setPins(ledLayout(), 'R1', { '1': H('e', 3), '2': H('top+', 8) }));
    expect(kinds(gap)).toContain('lead-off-board');
    const missing = compareWithSchematic(design, setPins(ledLayout(), 'R1', { '1': H('e', 3) }));
    expect(kinds(missing)).toEqual(['lead-missing']);
    const board = compareWithSchematic(design, setPins(ledLayout(), 'R1', { '1': H('e', 3), '2': H('e', 7, 'bbX') }));
    expect(kinds(board)).toEqual(['lead-off-board', 'unknown-board']);
    const l = ledLayout();
    const stale = compareWithSchematic(design, { ...l, placements: [...l.placements, { refdes: 'R9', pins: { '1': H('a', 30), '2': H('a', 34) } }] });
    expect(kinds(stale)).toEqual(['unknown-part']);
    expect(stale.issues[0].severity).toBe('warning');
    const pin = compareWithSchematic(design, { ...l, clips: [...l.clips, { id: 'c3', refdes: 'BAT1', pin: 'X', hole: H('top-', 5), color: 'red' }] });
    expect(kinds(pin)).toEqual(['unknown-pin']);
  });

  it('hints at a jumper that connects nothing', () => {
    const l = ledLayout();
    const r = compareWithSchematic(design, { ...l, wires: [...l.wires, { id: 'w9', from: H('a', 40), to: H('a', 45), color: 'green' }] });
    expect(r.ok).toBe(true);
    expect(r.hints.map((h) => h.kind)).toContain('dangling-wire');
  });
});

describe('compareWithSchematic on other circuits', () => {
  it('detects a transistor with swapped collector and emitter', () => {
    const design = transistorSwitchCircuit();
    const layout = autoPlace(design);
    const q = layout.placements.find((p) => p.refdes === 'Q1')!;
    const swapped = setPins(layout, 'Q1', { E: q.pins.C, B: q.pins.B, C: q.pins.E });
    const r = compareWithSchematic(design, swapped);
    expect(kinds(r)).toEqual(['pins-swapped']);
    expect(r.issues[0].message.vi).toContain('E-B-C');
  });

  it('detects a reversed electrolytic capacitor in the 555 circuit', () => {
    const design = astable555Circuit();
    const layout = autoPlace(design);
    const c = layout.placements.find((p) => p.refdes === 'C1')!;
    const r = compareWithSchematic(design, setPins(layout, 'C1', { '+': c.pins['-'], '-': c.pins['+'] }));
    expect(kinds(r)).toEqual(['polarity']);
    expect(r.issues[0].message.vi).toContain('Tụ hoá');
  });

  it('reports an IC whose hidden VCC pin is not wired', () => {
    const design = nandLedCircuit();
    const layout = autoPlace(design);
    const u = layout.placements.find((p) => p.refdes === 'U1')!;
    const vccStripCol = u.pins['#14'].col;
    const wires = layout.wires.filter((w) => !(w.from.col === vccStripCol && (w.from.row === 'a' || w.from.row === 'b') && w.to.row === 'top+'));
    expect(wires.length).toBe(layout.wires.length - 1);
    const r = compareWithSchematic(design, { ...layout, wires });
    expect(kinds(r)).toEqual(['missing-connection']);
    expect(r.issues[0].nets).toEqual(['VCC']);
    expect(r.issues[0].message.vi).toContain('U1 chân 14');
  });

  it('hints that a logic IC needs a supply when the schematic has no VCC net', () => {
    const b = new DesignBuilder('no vcc');
    const u1 = b.part('ttl/7404', 'U1', 0, 0);
    const r1 = b.part('basic/resistor', 'R1', 300, 0);
    b.labelPin(u1, '1Y', 'OUT');
    b.labelPin(r1, '1', 'OUT');
    b.labelPin(r1, '2', 'GND');
    const design = b.design;
    const r = compareWithSchematic(design, autoPlace(design));
    expect(r.issues).toEqual([]);
    const hint = r.hints.find((h) => h.kind === 'ic-no-supply')!;
    expect(hint.message.vi).toContain('chân 14');
    expect(hint.message.vi).toContain('chân 7');
  });

  it('checks a design without a breadboard as an empty board', () => {
    const r = compareWithSchematic(seriesLedCircuit());
    expect(kinds(r)).toEqual(['clip-missing', 'unplaced-part', 'unplaced-part']);
  });
});
