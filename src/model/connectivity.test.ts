import { describe, expect, it } from 'vitest';
import { computeConnectivity, pinKey, type PlacedPartInfo } from './connectivity';
import { DesignBuilder } from './designkit';
import { instancePins } from './geometry';
import { getPart } from '../library';
import type { Design } from './types';

function placed(design: Design): PlacedPartInfo[] {
  const out: PlacedPartInfo[] = [];
  for (const sheet of design.sheets) {
    for (const inst of sheet.parts) {
      const def = getPart(inst.partId);
      out.push({ index: out.length, sheetId: sheet.id, inst, def, pins: def ? instancePins(inst, def) : [] });
    }
  }
  return out;
}

describe('computeConnectivity', () => {
  it('numbers nets by first appearance and records members', () => {
    const b = new DesignBuilder();
    const r1 = b.part('basic/resistor', 'R1', 0, 0); // (-30,0) (30,0)
    const r2 = b.part('basic/resistor', 'R2', 120, 0); // (90,0) (150,0)
    b.part('sources/ground', 'G1', 150, 0);
    const w = b.wire({ x: 30, y: 0 }, { x: 90, y: 0 });
    b.label('MID', 60, 0);
    b.labelPin(r1, '1', 'vcc');
    b.part('sources/vcc', 'VCC1', -30, 0);
    const parts = placed(b.design);
    const c = computeConnectivity(b.design, parts, []);
    expect(c.pinNet.get(pinKey(0, '1'))).toBe(0);
    expect(c.pinNet.get(pinKey(0, '2'))).toBe(1);
    expect(c.pinNet.get(pinKey(1, '1'))).toBe(1);
    const mid = c.nets[1];
    expect(mid.wires).toEqual([{ sheetId: 'sheet1', wireId: w }]);
    expect(mid.labels.map((l) => l.name)).toEqual(['MID']);
    expect(c.nets[0].globals).toEqual(['VCC']);
    expect(c.nets[0].labels.map((l) => l.name)).toEqual(['vcc']);
    expect(c.nets[c.pinNet.get(pinKey(1, '2'))!].ground).toBe(true);
    expect(c.netAt('sheet1', { x: 60, y: 0 })).toBe(1);
    expect(c.netAt('sheet1', b.pin(r2, '2'))).toBe(c.pinNet.get(pinKey(1, '2')));
    expect(c.netAt('sheet1', { x: 500, y: 500 })).toBeUndefined();
    expect(c.dangling).toEqual([]);
  });

  it('splits a wire for a probe cut and keeps both sides apart', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', 0, 0);
    b.part('basic/resistor', 'R2', 120, 0);
    b.wire({ x: 30, y: 0 }, { x: 60, y: 0 }, { x: 90, y: 0 });
    b.wire({ x: 60, y: 0 }, { x: 60, y: 40 }); // T-junction at the vertex: stays on side A
    const c = computeConnectivity(b.design, placed(b.design), [
      { probeId: 'p', sheetId: 'sheet1', x: 60, y: 0 },
      { probeId: 'off', sheetId: 'sheet1', x: 400, y: 0 },
    ]);
    const s = c.splits.get('p')!;
    expect(s.netA).toBe(c.pinNet.get(pinKey(0, '2')));
    expect(s.netB).toBe(c.pinNet.get(pinKey(1, '1')));
    expect(s.netA).not.toBe(s.netB);
    expect(c.unplacedCuts).toEqual(['off']);
    // the T branch joined side A; its free end (60,40) is the only dangling end
    expect(c.dangling).toEqual([{ sheetId: 'sheet1', wireId: expect.any(String), x: 60, y: 40 }]);
    expect(c.netAt('sheet1', { x: 60, y: 20 })).toBe(s.netA);
  });

  it('several cuts on one wire chain in series, in any order and at the same point', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', 0, 0); // pin 2 at (30,0)
    b.part('basic/resistor', 'R2', 200, 0); // pin 1 at (170,0)
    b.wire({ x: 30, y: 0 }, { x: 100, y: 0 }, { x: 170, y: 0 });
    // cut order deliberately not the order along the wire; q2 and q3 share a point
    const c = computeConnectivity(b.design, placed(b.design), [
      { probeId: 'q1', sheetId: 'sheet1', x: 120, y: 0 },
      { probeId: 'q2', sheetId: 'sheet1', x: 60, y: 0 },
      { probeId: 'q3', sheetId: 'sheet1', x: 60, y: 0 },
      { probeId: 'q4', sheetId: 'sheet1', x: 100, y: 0 },
    ]);
    const left = c.pinNet.get(pinKey(0, '2'))!;
    const right = c.pinNet.get(pinKey(1, '1'))!;
    const s = (id: string) => c.splits.get(id)!;
    // walk the chain from R1.2 to R2.1: every side is shared by exactly two neighbouring probes
    const chain: string[] = [];
    let at = left;
    for (let guard = 0; guard < 10 && at !== right; guard++) {
      const next = ['q1', 'q2', 'q3', 'q4'].find((id) => !chain.includes(id) && s(id).netA === at);
      expect(next, `no probe leaves net ${at}`).toBeDefined();
      chain.push(next!);
      at = s(next!).netB;
    }
    expect(at).toBe(right);
    expect(chain).toHaveLength(4);
    expect(chain.slice(2)).toEqual(['q4', 'q1']); // position 100 before position 120
    expect(new Set(chain.slice(0, 2))).toEqual(new Set(['q2', 'q3']));
    for (const id of chain) expect(s(id).netA).not.toBe(s(id).netB);
    expect(c.unplacedCuts).toEqual([]);
  });

  it('reports pins a wire passes over and does not connect them', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', 100, 0); // pins (70,0) (130,0)
    b.wire({ x: 0, y: 0 }, { x: 200, y: 0 });
    const c = computeConnectivity(b.design, placed(b.design), []);
    expect(c.pinNet.get(pinKey(0, '1'))).not.toBe(c.pinNet.get(pinKey(0, '2')));
    expect(c.pinsOnWire.map((o) => [o.pin, o.x, o.y])).toEqual([
      ['1', 70, 0],
      ['2', 130, 0],
    ]);
  });
});
