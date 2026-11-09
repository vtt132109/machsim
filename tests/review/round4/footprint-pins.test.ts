/**
 * Completeness review, round 4 (fixed): no part carries a pin NUMBER higher than the pad count of
 * its footprint. A KiCad netlist or a PCB export passes the numbers through unchanged, so a part
 * with pin 6 on a 5-pad SOT-23-5 gave a netlist the learner's PCB tool rejects or mis-wires.
 *
 * Footprints without pads (DIN-RAIL, BLOCK: mechanical / panel devices) are exempt; so are pins
 * with non-numeric numbers.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { listParts, loadAllGroups } from '../../../src/library';
import { footprintPads, getFootprint } from '../../../src/library/footprints';

beforeAll(async () => {
  await loadAllGroups();
});

describe('pin numbers fit the footprint of every part', () => {
  it('no numeric pin number exceeds the pad count', () => {
    const bad: string[] = [];
    for (const p of listParts()) {
      const fp = p.footprint ? getFootprint(p.footprint) : undefined;
      if (!fp) continue;
      const pads = footprintPads(fp).length;
      if (pads === 0) continue;
      const over = p.symbol.pins.filter((x) => /^\d+$/.test(x.number ?? '') && Number(x.number) > pads);
      if (over.length) bad.push(`${p.id} (${p.footprint}, ${pads} pads): ${over.map((o) => `${o.name}#${o.number}`).join(', ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('the single-amplifier SOT-23-5 parts use the DBV pin-out and the 3-lead references IN 1, OUT 2, GND 3', async () => {
    const { getPart } = await import('../../../src/library');
    const number = (id: string, pin: string) => getPart(id)!.symbol.pins.find((p) => p.name === pin)?.number;
    expect(['OUT', 'V-', 'IN+', 'IN-', 'V+'].map((p) => number('analog/mcp6001', p))).toEqual(['1', '2', '3', '4', '5']);
    expect(['IN', 'OUT', 'GND'].map((p) => number('analog/ref3030', p))).toEqual(['1', '2', '3']);
    expect(getPart('cmos/4049')!.footprint).toBe('DIP-16');
  });
});
