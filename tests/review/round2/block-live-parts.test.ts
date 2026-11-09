/**
 * Review round 2 (R2-8), superseded by round 4 step 3: instruments, LEDs, displays and interactive
 * parts (switch with a key, potentiometer, push button) inside a subcircuit / hierarchical block
 * used not to work, so the netlister warned about them (`instrumentInBlock`, `indicatorInBlock`,
 * `interactiveInBlock`). They work now (src/model/blockLive.test.ts): every placed copy has its own
 * bindings, named by path, so those warnings are gone. This test keeps the scenario and asserts
 * the new behaviour: no warning, and the part is bound.
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

describe('live parts inside a block work and are no longer reported', () => {
  it('an instrument inside a block is bound under its path and raises no warning', () => {
    const b = new DesignBuilder('meter in block');
    b.child('M', { kind: 'subcircuit' });
    b.label('IN', 0, 0, { kind: 'hier' });
    b.part('instruments/multimeter', 'XMM1', 100, 0);
    b.root();
    b.block(b.design.children![0].id, 'SC1', 300, 0);
    const build = buildNetlist(b.design);
    expect(build.erc.map((m) => m.detail?.id)).not.toContain('instrumentInBlock');
    expect(build.instruments.map((i) => i.refdes)).toEqual(['SC1.XMM1']);
  });

  for (const [partId, refdes, params] of [
    ['diodes/led-red', 'LED1', {}],
    ['basic/switch-spst', 'S1', { key: 'A' }],
  ] as const) {
    it(`${partId} inside a block raises no "not live" warning`, () => {
      const build = buildNetlist(blockWith(partId, refdes, params));
      const ids = build.erc.map((m) => m.detail?.id);
      expect(ids).not.toContain('indicatorInBlock');
      expect(ids).not.toContain('interactiveInBlock');
      if (partId === 'diodes/led-red') expect(build.indicators.map((i) => i.refdes)).toEqual(['SC1.LED1']);
    });
  }
});
