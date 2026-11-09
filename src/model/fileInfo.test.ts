import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { DesignBuilder } from './designkit';
import { designInfo, utf8Size } from './fileInfo';
import { parseDesign } from './serialize';
import { newDesign } from './types';

const EXAMPLES = fileURLToPath(new URL('../../examples/', import.meta.url));

describe('File information', () => {
  it('counts the voltage-divider example exactly', () => {
    const d = parseDesign(readFileSync(EXAMPLES + '01-voltage-divider.msim', 'utf8'));
    const info = designInfo(d, getPart);
    // V1, R1, R2, GND1, XMM1
    expect(info.parts.total).toBe(5);
    expect(info.parts.instruments).toBe(1);
    expect(info.instrumentKinds).toEqual(['multimeter']);
    expect(info.parts.symbols).toBe(1);
    expect(info.parts.components).toBe(3);
    expect(info.parts.byFamily.find((f) => f.group === 'basic')?.count).toBe(2);
    expect(info.parts.byFamily.reduce((n, f) => n + f.count, 0)).toBe(5);
    expect(info.wires).toBe(d.sheets[0].wires.length);
    expect(info.labels).toBe(1);
    // nets: supply node, OUT and ground
    expect(info.nets).toBe(3);
    expect(info.sheets).toEqual({ root: 1, child: 0, total: 1 });
    expect(info.simulation.active).toBe('tran');
    expect(info.simulation.analyses).toEqual(['tran', 'op', 'dc']);
    expect(info.restrictions.present).toBe(false);
  });

  it('counts blocks, child sheets, buses, connectors, variables and restrictions', () => {
    const b = new DesignBuilder('Hier');
    const c = b.child('Stage', { kind: 'hierarchical', variables: { G: '2' } });
    const r = b.part('basic/resistor', 'R1', 100, 100);
    b.labelPin(r, '1', 'A', { kind: 'hier' });
    b.labelPin(r, '2', 'B', { kind: 'hier' });
    b.root();
    b.block(c, 'HB1', 300, 200);
    b.block(c, 'HB2', 500, 200);
    b.bus('D[0..3]', { x: 0, y: 400 }, { x: 200, y: 400 });
    b.label('X', 0, 0, { kind: 'offpage' });
    b.addSheet('Trang 2');
    b.part('basic/capacitor', 'C1', 100, 100);
    const d = b.design;
    d.variables = { Rload: '1k', f0: '1k' };
    d.customSpice = '.model DX D(is=1n)\n.subckt AMP a b\nR1 a b 1k\n.ends\n';
    d.restrictions = { passwordHash: 'x', salt: 'y', iterations: 1, hideValues: true, disabledAnalyses: ['ac'], lockedParts: ['p1', 'p2'], lockParts: true };
    d.meta = { created: '2026-01-02T03:04:05.000Z', savedBy: 'MachSim 0.1.0' };
    const info = designInfo(d, getPart);
    expect(info.sheets).toEqual({ root: 2, child: 1, total: 3 });
    expect(info.childDesigns).toEqual({ subcircuits: 0, hierarchical: 1 });
    expect(info.parts.blocks).toBe(2);
    expect(info.parts.total).toBe(4);
    expect(info.buses).toBe(1);
    expect(info.connectors).toBe(3);
    expect(info.variables).toBe(2);
    expect(info.customModels).toBe(2);
    expect(info.restrictions).toMatchObject({ present: true, hideValues: true, lockParts: true, lockedParts: 2, disabledAnalyses: ['ac'] });
    expect(info.meta.savedBy).toBe('MachSim 0.1.0');
  });

  it('counts the rungs and the rung elements of the ladder sheets', () => {
    const d = newDesign('PLC');
    d.sheets.push({
      id: 's2',
      name: 'Ladder 1',
      kind: 'ladder',
      parts: [],
      wires: [],
      labels: [],
      probes: [],
      notes: [],
      ladder: [
        {
          id: 'r1',
          // (I0.0 OR M0.0) AND NOT I0.1  →  Q0.0 and a TON
          logic: {
            kind: 'series',
            items: [
              { kind: 'parallel', items: [{ kind: 'contact', type: 'no', address: 'I0.0' }, { kind: 'contact', type: 'no', address: 'M0.0' }] },
              { kind: 'contact', type: 'nc', address: 'I0.1' },
            ],
          },
          outputs: [{ kind: 'coil', address: 'Q0.0' }, { kind: 'ton', address: 'T1', preset: '2' }],
        },
        { id: 'r2', disabled: true, logic: { kind: 'compare', op: 'ge', left: 'T1.ET', right: '1.5' }, outputs: [{ kind: 'coil', address: 'Q0.1' }] },
      ],
    });
    d.sheets.push({ id: 's3', name: 'Ladder 2', kind: 'ladder', parts: [], wires: [], labels: [], probes: [], notes: [], ladder: [] });
    const info = designInfo(d, getPart);
    expect(info.ladder).toEqual({ sheets: 2, rungs: 2, disabled: 1, contacts: 4, outputs: 3, addresses: 6 });
    // a design with no ladder sheet reports zeros, not undefined
    expect(designInfo(newDesign('Plain'), getPart).ladder).toEqual({ sheets: 0, rungs: 0, disabled: 0, contacts: 0, outputs: 0, addresses: 0 });
  });

  it('measures UTF-8 sizes', () => {
    expect(utf8Size('abc')).toBe(3);
    expect(utf8Size('Điện')).toBe(new TextEncoder().encode('Điện').length);
    expect(utf8Size('Ω😀')).toBe(2 + 4);
  });
});
