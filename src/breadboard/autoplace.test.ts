import { describe, expect, it } from 'vitest';
import { autoPlace, autoPlaceDetailed, detectSupplies } from './autoplace';
import { compareWithSchematic, physicalParts } from './compare';
import { buildNetlist } from '../model/netlister';
import { astable555Circuit, dividerCircuit, EXAMPLE_CIRCUITS, invertingAmpCircuit, ledArrayCircuit, nandLedCircuit, seriesLedCircuit, transistorSwitchCircuit } from './examples';
import { holeKey, isValidHole, stripIdOf } from './geometry';
import type { BreadboardLayout } from './types';

function describeIssues(layout: BreadboardLayout, design: ReturnType<typeof seriesLedCircuit>): string {
  return compareWithSchematic(design, layout)
    .issues.map((i) => `${i.kind}: ${i.message.en}`)
    .join('\n');
}

function uniqueHoles(layout: BreadboardLayout): boolean {
  const seen = new Set<string>();
  const solid = [...layout.placements.flatMap((p) => Object.values(p.pins)), ...layout.wires.flatMap((w) => [w.from, w.to])];
  for (const h of solid) {
    const k = holeKey(h);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

describe('autoPlace', () => {
  for (const { id, build } of EXAMPLE_CIRCUITS) {
    it(`gives a zero-issue layout for ${id}`, () => {
      const design = build();
      const res = autoPlaceDetailed(design);
      expect(res.unplaced).toEqual([]);
      expect(describeIssues(res.layout, design)).toBe('');
      expect(res.issueCount).toBe(0);
      expect(uniqueHoles(res.layout)).toBe(true);
      const boards = new Map(res.layout.boards.map((b) => [b.id, b]));
      for (const p of res.layout.placements) for (const h of Object.values(p.pins)) expect(isValidHole(boards.get(h.board)!, h.row, h.col)).toBe(true);
    });
  }

  it('series LED: resistor and LED share the middle strip, supply on the rails', () => {
    const design = seriesLedCircuit();
    const layout = autoPlace(design);
    const board = layout.boards[0];
    const r1 = layout.placements.find((p) => p.refdes === 'R1')!;
    const led = layout.placements.find((p) => p.refdes === 'LED1')!;
    expect(stripIdOf(board, r1.pins['2'].row, r1.pins['2'].col)).toBe(stripIdOf(board, led.pins.A.row, led.pins.A.col));
    expect(layout.clips.map((c) => `${c.refdes}.${c.pin}:${c.hole.row}`).sort()).toEqual(['BAT1.+:top+', 'BAT1.-:top-']);
    // two rail jumpers (VBAT strip -> top+, GND strip -> top-)
    expect(layout.wires).toHaveLength(2);
    expect(layout.wires.map((w) => w.to.row).sort()).toEqual(['top+', 'top-']);
  });

  it('divider: two resistors with a shared output strip', () => {
    const design = dividerCircuit();
    const layout = autoPlace(design);
    const board = layout.boards[0];
    const r1 = layout.placements.find((p) => p.refdes === 'R1')!;
    const r2 = layout.placements.find((p) => p.refdes === 'R2')!;
    expect(stripIdOf(board, r1.pins['2'].row, r1.pins['2'].col)).toBe(stripIdOf(board, r2.pins['1'].row, r2.pins['1'].col));
  });

  it('transistor switch: TO-92 leads in three adjacent strips in E-B-C order', () => {
    const layout = autoPlace(transistorSwitchCircuit());
    const q = layout.placements.find((p) => p.refdes === 'Q1')!;
    expect(q.pins.E.row).toBe(q.pins.B.row);
    expect(q.pins.B.col - q.pins.E.col).toBe(1);
    expect(q.pins.C.col - q.pins.B.col).toBe(1);
  });

  it('555: the DIP straddles the channel with pin 1 in row f and pin 8 above it in row e', () => {
    const layout = autoPlace(astable555Circuit());
    const u = layout.placements.find((p) => p.refdes === 'U1')!;
    expect(u.pins.GND.row).toBe('f');
    expect(u.pins.VCC.row).toBe('e');
    expect(u.pins.VCC.col).toBe(u.pins.GND.col);
    expect(u.pins.OUT.col - u.pins.GND.col).toBe(2);
    expect(u.pins.DIS.row).toBe('e');
    expect(u.pins.DIS.col - u.pins.GND.col).toBe(1);
  });

  it('dual supply: positive on top+, negative on bot-, ground on top- and bot+', () => {
    const design = invertingAmpCircuit();
    const build = buildNetlist(design, { includeAnalysis: false });
    const s = detectSupplies(design, build, physicalParts(design));
    expect(s).toEqual({ ground: '0', positive: 'VP', negative: 'VN' });
    const layout = autoPlace(design);
    const clip = (pin: string, ref: string) => layout.clips.find((c) => c.refdes === ref && c.pin === pin)!;
    expect(clip('+', 'V1').hole.row).toBe('top+');
    expect(clip('-', 'V2').hole.row).toBe('bot-');
    expect(clip('-', 'V1').hole.row).toBe('top-');
  });

  it('logic IC: hidden VCC (pin 14) and GND (pin 7) reach the rails', () => {
    const design = nandLedCircuit();
    const layout = autoPlace(design);
    const u = layout.placements.find((p) => p.refdes === 'U1')!;
    expect(u.pins['#14'].row).toBe('e');
    expect(u.pins['#7'].row).toBe('f');
    const check = compareWithSchematic(design, layout);
    const net14 = check.connectivity.stripNet.get(stripIdOf(layout.boards[0], u.pins['#14'].row, u.pins['#14'].col)!)!;
    expect(check.schematicNets.get(net14)).toEqual(['VCC']);
  });

  it('uses more boards when one half-size board is too small', () => {
    const design = astable555Circuit();
    const res = autoPlaceDetailed(design, { kind: 'mini', maxBoards: 3 });
    expect(res.issueCount).toBe(0);
    expect(res.layout.boards.every((b) => b.kind === 'mini')).toBe(true);
  });

  it('lays out 120 parts over several boards without issues', () => {
    const design = ledArrayCircuit(60);
    const res = autoPlaceDetailed(design);
    expect(res.unplaced).toEqual([]);
    expect(res.issueCount).toBe(0);
    expect(res.layout.placements).toHaveLength(120);
    expect(res.layout.boards.length).toBeGreaterThan(1);
    expect(uniqueHoles(res.layout)).toBe(true);
  });

  it('bridges split rails when both halves are used', () => {
    const design = astable555Circuit();
    const res = autoPlaceDetailed(design, { splitRails: true });
    expect(res.issueCount).toBe(0);
  });
});
