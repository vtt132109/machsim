import { describe, expect, it } from 'vitest';
import { computeBreadboardConnectivity, netOfHole, netOfPin } from './connectivity';
import type { BreadboardHole, BreadboardLayout } from './types';

const H = (row: BreadboardHole['row'], col: number, board = 'bb1'): BreadboardHole => ({ board, row, col });

function layout(partial: Partial<BreadboardLayout>): BreadboardLayout {
  return { version: 1, boards: [{ id: 'bb1', kind: 'full', x: 0, y: 0 }], placements: [], wires: [], clips: [], ...partial };
}

describe('breadboard connectivity', () => {
  it('joins leads in one strip and keeps neighbouring strips apart', () => {
    const conn = computeBreadboardConnectivity(
      layout({
        placements: [
          { refdes: 'R1', pins: { '1': H('a', 5), '2': H('a', 9) } },
          { refdes: 'R2', pins: { '1': H('e', 9), '2': H('f', 9) } },
        ],
      }),
    );
    expect(netOfPin(conn, 'R1', '2')).toBe(netOfPin(conn, 'R2', '1'));
    expect(netOfPin(conn, 'R1', '1')).not.toBe(netOfPin(conn, 'R1', '2'));
    // e9 and f9 are on opposite sides of the channel
    expect(netOfPin(conn, 'R2', '2')).not.toBe(netOfPin(conn, 'R2', '1'));
    expect(conn.nets).toHaveLength(3);
    expect(netOfHole(conn, H('c', 9))).toBe(netOfPin(conn, 'R1', '2'));
    expect(netOfHole(conn, H('c', 30))).toBeUndefined();
  });

  it('joins strips through jumpers and rails, and attaches clips', () => {
    const conn = computeBreadboardConnectivity(
      layout({
        placements: [{ refdes: 'R1', pins: { '1': H('a', 5), '2': H('a', 9) } }],
        wires: [
          { id: 'w1', from: H('b', 5), to: H('top+', 4), color: 'red' },
          { id: 'w2', from: H('b', 9), to: H('g', 20), color: 'yellow' },
        ],
        clips: [{ id: 'c1', refdes: 'V1', pin: '+', hole: H('top+', 60), color: 'red' }],
      }),
    );
    expect(netOfPin(conn, 'V1', '+')).toBe(netOfPin(conn, 'R1', '1'));
    expect(netOfHole(conn, H('j', 20))).toBe(netOfPin(conn, 'R1', '2'));
    const railNet = conn.nets[netOfPin(conn, 'V1', '+')!];
    expect(railNet.strips.sort()).toEqual(['bb1:5:ae', 'bb1:top+']);
    expect(railNet.leads.map((l) => l.kind).sort()).toEqual(['clip', 'part', 'wire', 'wire']);
  });

  it('keeps split rail halves apart until bridged', () => {
    const base = layout({
      boards: [{ id: 'bb1', kind: 'full', x: 0, y: 0, splitRails: true }],
      clips: [
        { id: 'c1', refdes: 'V1', pin: '+', hole: H('top+', 3), color: 'red' },
        { id: 'c2', refdes: 'V2', pin: '+', hole: H('top+', 61), color: 'red' },
      ],
    });
    const a = computeBreadboardConnectivity(base);
    expect(netOfPin(a, 'V1', '+')).not.toBe(netOfPin(a, 'V2', '+'));
    const b = computeBreadboardConnectivity({ ...base, wires: [{ id: 'w1', from: H('top+', 31), to: H('top+', 33), color: 'red' }] });
    expect(netOfPin(b, 'V1', '+')).toBe(netOfPin(b, 'V2', '+'));
  });

  it('ties extra physical leads of one pin together', () => {
    const conn = computeBreadboardConnectivity(
      layout({
        placements: [
          { refdes: 'U1', pins: { CC: H('f', 12), 'CC~2': H('e', 12) } },
          { refdes: 'R1', pins: { '1': H('a', 12), '2': H('a', 20) } },
        ],
      }),
    );
    expect(netOfHole(conn, H('j', 12))).toBe(netOfPin(conn, 'R1', '1'));
    expect(netOfPin(conn, 'U1', 'CC')).toBe(netOfPin(conn, 'R1', '1'));
  });

  it('reports leads in holes that do not exist and indexes hole occupancy', () => {
    const conn = computeBreadboardConnectivity(
      layout({
        placements: [
          { refdes: 'R1', pins: { '1': H('a', 70), '2': H('top+', 8) } },
          { refdes: 'R2', pins: { '1': H('c', 4), '2': H('c', 8, 'bb9') } },
        ],
        wires: [{ id: 'w1', from: H('c', 4), to: H('c', 10), color: 'blue' }],
      }),
    );
    expect(conn.offBoard.map((l) => (l.kind === 'part' ? `${l.refdes}.${l.key}` : l.kind))).toEqual(['R1.1', 'R1.2', 'R2.2']);
    expect(conn.holeLeads.get('bb1:c:4')).toHaveLength(2);
  });
});
