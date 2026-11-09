/**
 * Review round 2: hierarchy (src/model/netlister.ts). An instrument placed inside a subcircuit /
 * hierarchical block gets the ERC warning `instrumentInBlock`, because it cannot work there.
 * LEDs, 7-segment displays and interactive parts (switch with a key, potentiometer, push button)
 * inside a block do not work either — the LED never lights, the key does nothing — but nothing
 * tells the learner. A learner who turns a working LED + switch circuit into a subcircuit with
 * "Replace selection by subcircuit" sees it silently go dark.
 *
 * Expected: ERC warns about indicators and interactive parts inside blocks, as it does for
 * instruments. Fails while the build is silent.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import { getPart } from '../../../src/library';

function blockWith(partId: string, refdes: string, params: Record<string, string> = {}) {
  const b = new DesignBuilder('Block with a live part');
  const childId = b.child('LIGHT', { kind: 'subcircuit' });
  // the block's port IN (hierarchical connector) and the same name on R1.1 form one net
  b.label('IN', -100, 0, { kind: 'hier' });
  const r = b.part('basic/resistor', 'R1', 100, 0, { value: '330' });
  b.labelPin(r, '1', 'IN');
  const pins = getPart(partId)!.symbol.pins.map((x) => x.name);
  const p = b.part(partId, refdes, 300, 0, params);
  b.labelPin(r, '2', 'MID');
  b.labelPin(p, pins[0], 'MID');
  const g = b.part('sources/ground', 'G1', 400, 200);
  b.labelPin(p, pins[1], 'GND0');
  b.labelPin(g, '1', 'GND0');
  b.root();
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const gnd = b.part('sources/ground', 'G0', 0, 200);
  const blk = b.block(childId, 'SC1', 300, 0);
  b.labelPin(v, '+', 'VIN');
  b.labelPin(blk, 'IN', 'VIN');
  b.labelPin(v, '-', 'G');
  b.labelPin(gnd, '1', 'G');
  return b.design;
}

describe('live parts inside a block are reported', () => {
  it('control: an instrument inside a block gets the instrumentInBlock warning', () => {
    const b = new DesignBuilder('meter in block');
    b.child('M', { kind: 'subcircuit' });
    b.label('IN', 0, 0, { kind: 'hier' });
    b.part('instruments/multimeter', 'XMM1', 100, 0);
    b.root();
    b.block(b.design.children![0].id, 'SC1', 300, 0);
    const ids = buildNetlist(b.design).erc.map((m) => m.detail?.id);
    expect(ids).toContain('instrumentInBlock');
  });

  for (const [partId, refdes, params] of [
    ['diodes/led-red', 'LED1', {}],
    ['basic/switch-spst', 'S1', { key: 'A' }],
  ] as const) {
    it(`${partId} inside a block gets an ERC warning (it is not live there)`, () => {
      const build = buildNetlist(blockWith(partId, refdes, params));
      const forPart = build.erc.filter((m) => m.refdes === refdes);
      expect(forPart.length).toBeGreaterThan(0);
    });
  }
});
