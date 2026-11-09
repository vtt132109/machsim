import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { forwardAnnotation, kicadNetlist, pcbComponents, readNetlistSnapshot } from './pcb';
import {
  applyNetColor,
  isEmptyNetSettings,
  NET_CLASS_PRESETS,
  netClassOf,
  netSettings,
  pcbNetLookup,
  pcbNetProperties,
  renameNetSettings,
  setNetSettings,
} from './netSettings';
import { validateDesign } from './serialize';
import type { Design } from './types';

/** VIN - R1 - OUT - R2 - ground, with named nets. */
function board(): Design {
  const b = new DesignBuilder('Board');
  const r1 = b.part('basic/resistor', 'R1', 0, 0);
  const r2 = b.part('basic/resistor', 'R2', 120, 60, {}, { rotation: 90 });
  const gnd = b.part('sources/ground', 'GND1', 120, 160);
  const v1 = b.part('sources/dc-voltage', 'V1', -140, 60, { value: '5' });
  const gnd2 = b.part('sources/ground', 'GND2', -140, 160);
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.connect(r2, '2', gnd, '1');
  b.connect(v1, '+', r1, '1');
  b.connect(v1, '-', gnd2, '1');
  b.label('VIN', b.pin(r1, '1').x, b.pin(r1, '1').y);
  b.label('OUT', b.pin(r1, '2').x, b.pin(r1, '2').y);
  return b.design;
}

describe('net settings storage', () => {
  it('writes, merges and finds an entry without case', () => {
    let d = setNetSettings(board(), 'OUT', { traceWidth: 0.4 });
    expect(netSettings(d, 'out')).toEqual({ traceWidth: 0.4 });
    d = setNetSettings(d, 'out', { clearance: 0.25, layer: 'top' });
    expect(netSettings(d, 'OUT')).toEqual({ traceWidth: 0.4, clearance: 0.25, layer: 'top' });
    expect(Object.keys(d.nets ?? {})).toEqual(['OUT']);
  });

  it('removes a field and the whole entry again', () => {
    let d = setNetSettings(board(), 'OUT', { traceWidth: 0.4, note: 'power' });
    d = setNetSettings(d, 'OUT', { note: '' });
    expect(netSettings(d, 'OUT')).toEqual({ traceWidth: 0.4 });
    d = setNetSettings(d, 'OUT', { traceWidth: undefined });
    expect(d.nets).toBeUndefined();
    expect(isEmptyNetSettings(undefined)).toBe(true);
    expect(isEmptyNetSettings({ layer: '' })).toBe(true);
    expect(isEmptyNetSettings({ layer: 'top' })).toBe(false);
  });

  it('leaves a design without settings exactly as it was', () => {
    const d = board();
    expect(setNetSettings(d, 'OUT', {})).toBe(d);
    expect(netSettings(d, 'OUT')).toBeUndefined();
  });

  it('follows a rename', () => {
    let d = setNetSettings(board(), 'OUT', { color: '#ff0000' });
    d = renameNetSettings(d, 'OUT', 'MID');
    expect(netSettings(d, 'OUT')).toBeUndefined();
    expect(netSettings(d, 'MID')).toEqual({ color: '#ff0000' });
    // renaming a net with no settings changes nothing
    expect(renameNetSettings(d, 'VIN', 'IN')).toBe(d);
  });

  it('paints the wires of a net and clears them again', () => {
    const d = board();
    const wireId = d.sheets[0].wires[0].id;
    const painted = applyNetColor(d, [{ sheetId: 'sheet1', wireId }], '#00a000');
    expect(painted.sheets[0].wires.find((w) => w.id === wireId)?.color).toBe('#00a000');
    expect(painted.sheets[0].wires[1].color).toBeUndefined();
    const cleared = applyNetColor(painted, [{ sheetId: 'sheet1', wireId }], undefined);
    expect(cleared.sheets[0].wires.find((w) => w.id === wireId)).not.toHaveProperty('color');
    // nothing to do: the same design object comes back
    expect(applyNetColor(d, [], '#123456')).toBe(d);
    expect(applyNetColor(cleared, [{ sheetId: 'sheet1', wireId }], undefined)).toBe(cleared);
  });

  it('fills width and clearance from a net class, and lets the net override them', () => {
    expect(netClassOf('power')).toEqual({ id: 'power', width: 0.8, clearance: 0.3 });
    expect(netClassOf(undefined)).toBeUndefined();
    expect(netClassOf('nope')).toBeUndefined();
    expect(NET_CLASS_PRESETS.map((c) => c.id)).toEqual(['signal', 'bus', 'power', 'highVoltage']);
    const d = setNetSettings(setNetSettings(board(), 'VIN', { netClass: 'power' }), 'OUT', { netClass: 'power', traceWidth: 1.2 });
    const props = pcbNetProperties(d);
    expect(props.get('VIN')).toEqual({ width: 0.8, clearance: 0.3, netClass: 'power' });
    expect(props.get('OUT')).toEqual({ width: 1.2, clearance: 0.3, netClass: 'power' });
    expect(pcbNetLookup(d)('vin')?.width).toBe(0.8);
    expect(pcbNetLookup(d)('nothing')).toBeUndefined();
  });

  it('keeps a net entry that only carries a colour out of the PCB properties', () => {
    const d = setNetSettings(board(), 'OUT', { color: '#ff0000', note: 'hello' });
    expect(pcbNetProperties(d).size).toBe(0);
  });

  it('survives a save / load round trip', () => {
    const d = setNetSettings(board(), 'OUT', { traceWidth: 0.4, clearance: 0.25, layer: 'top', netClass: 'power', color: '#ff0000', note: 'n', keepName: true });
    const back = validateDesign(JSON.parse(JSON.stringify(d)));
    expect(back.nets).toEqual(d.nets);
  });

  it('rejects a malformed entry when loading', () => {
    const d = board() as unknown as Record<string, unknown>;
    d.nets = { OUT: { traceWidth: 'wide' } };
    expect(() => validateDesign(d)).toThrow(/traceWidth/);
  });
});

describe('net settings in the PCB exports', () => {
  it('writes class, width, clearance and layer into the KiCad netlist', () => {
    let d = board();
    d = setNetSettings(d, 'OUT', { traceWidth: 0.5, clearance: 0.25, layer: 'bottom' });
    d = setNetSettings(d, 'VIN', { netClass: 'power' });
    const text = kicadNetlist(d, { source: 'board.msim', date: '2026-01-01', tool: 'MachSim' });
    const net = (name: string) => text.slice(text.indexOf(`(name "${name}")`)).split('(net ')[0];
    expect(net('/OUT')).toContain('(width "0.5")');
    expect(net('/OUT')).toContain('(clearance "0.25")');
    expect(net('/OUT')).toContain('(layer "bottom")');
    expect(net('/VIN')).toContain('(class "power")');
    expect(net('/VIN')).toContain('(width "0.8")');
    // a net without settings keeps the plain form
    expect(net('GND')).not.toContain('(width');
    // the parentheses still balance and the nodes are still there
    let depth = 0;
    for (const ch of text.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(net('/OUT')).toContain('(node (ref "R1") (pin "2"))');
  });

  it('can carry the settings of the ground net too', () => {
    const d = setNetSettings(board(), '0', { traceWidth: 1.5 });
    const text = kicadNetlist(d, { source: '', date: '', tool: '' });
    expect(text.slice(text.indexOf('(name "GND")'))).toContain('(width "1.5")');
  });

  it('still reads back as a netlist snapshot (forward annotation keeps working)', () => {
    const d = setNetSettings(setNetSettings(board(), 'OUT', { traceWidth: 0.5, layer: 'top' }), 'VIN', { netClass: 'power' });
    const text = kicadNetlist(d, { source: '', date: '', tool: '' });
    const snap = readNetlistSnapshot(text);
    expect(snap.components.map((c) => c.ref)).toEqual(['R1', 'R2']);
    expect(snap.pinNets.get(`${d.sheets[0].parts[0].id}#2`)).toBe('OUT');
    expect(forwardAnnotation(snap, d)).toEqual([]);
  });

  it('does not change the component list', () => {
    const plain = pcbComponents(board());
    const withNets = pcbComponents(setNetSettings(board(), 'OUT', { traceWidth: 0.5 }));
    expect(withNets.map((c) => c.ref)).toEqual(plain.map((c) => c.ref));
  });
});
