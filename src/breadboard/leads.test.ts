import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { leadMap, logicalPin, placeLeads, registerPinout, rotateOffset, shortLabel, type LeadMap } from './leads';
import type { BoardInstance } from './types';

const map = (id: string, params: Record<string, string> = {}): LeadMap => {
  const def = getPart(id);
  if (!def) throw new Error(`no part ${id}`);
  return leadMap(def, params);
};
const offsets = (m: LeadMap) => Object.fromEntries(m.leads.map((l) => [l.key, [l.dx, l.dy]]));
const board: BoardInstance = { id: 'bb1', kind: 'full', x: 0, y: 0 };

describe('two-lead packages', () => {
  it('maps a 1/4 W resistor as an axial part spanning 4 holes', () => {
    const m = map('basic/resistor');
    expect(m.body).toBe('resistor');
    expect(offsets(m)).toEqual({ '1': [0, 0], '2': [4, 0] });
    expect(m.flexible).toEqual({ min: 3, max: 12, preferred: 4 });
    expect(m.rigid).toBe(false);
    expect(offsets(map('basic/resistor', { power: '1' }))['2']).toEqual([6, 0]);
  });

  it('marks polarised parts', () => {
    expect(map('diodes/led-red').polarity).toEqual({ plus: 'A', minus: 'K', kind: 'led' });
    expect(offsets(map('diodes/led-red'))).toEqual({ A: [0, 0], K: [1, 0] });
    expect(map('diodes/1n4148').polarity?.kind).toBe('diode');
    expect(offsets(map('diodes/1n4007'))['K']).toEqual([5, 0]);
    expect(map('basic/electrolytic').polarity).toEqual({ plus: '+', minus: '-', kind: 'electrolytic' });
    expect(map('basic/capacitor').polarity).toBeUndefined();
    expect(map('basic/capacitor').body).toBe('ceramic-cap');
    const bz = map('indicators/buzzer');
    expect(bz.body).toBe('buzzer');
    expect(offsets(bz)).toEqual({ '+': [0, 0], '-': [3, 0] });
    expect(bz.polarity?.kind).toBe('buzzer');
  });

  it('maps crystals, inductors and sensors', () => {
    expect(map('misc/crystal').body).toBe('crystal');
    expect(offsets(map('misc/crystal'))['2']).toEqual([2, 0]);
    expect(map('basic/inductor').body).toBe('inductor');
    expect(map('basic/ldr').body).toBe('ldr');
    expect(map('basic/ntc-thermistor').body).toBe('thermistor');
  });
});

describe('transistors and regulators', () => {
  it('uses E-B-C for TO-92 BJTs with per-part overrides', () => {
    const q = map('transistors/2n3904');
    expect(q.body).toBe('to92');
    expect(q.pinout).toEqual(['E', 'B', 'C']);
    expect(offsets(q)).toEqual({ E: [0, 0], B: [1, 0], C: [2, 0] });
    expect(map('transistors/bc547b').pinout).toEqual(['C', 'B', 'E']);
    expect(map('transistors/2n7000').pinout).toEqual(['S', 'G', 'D']);
    expect(map('analog/tl431').pinout).toEqual(['REF', 'A', 'K']);
  });

  it('uses the TO-220 conventions', () => {
    expect(map('transistors/tip31c').pinout).toEqual(['B', 'C', 'E']);
    expect(map('transistors/irf540n').pinout).toEqual(['G', 'D', 'S']);
    expect(map('transistors/bd139').pinout).toEqual(['E', 'C', 'B']);
    expect(map('power/7805').pinout).toEqual(['IN', 'GND', 'OUT']);
    expect(map('power/7905').pinout).toEqual(['GND', 'IN', 'OUT']);
    expect(map('power/lm317').pinout).toEqual(['ADJ', 'OUT', 'IN']);
    expect(map('power/7805').body).toBe('to220');
  });

  it('accepts registered pinout overrides', () => {
    registerPinout('transistors/2n2222a', ['C', 'B', 'E']);
    expect(map('transistors/2n2222a').pinout).toEqual(['C', 'B', 'E']);
    registerPinout('transistors/2n2222a', ['E', 'B', 'C']);
    expect(map('transistors/2n2222a').pinout).toEqual(['E', 'B', 'C']);
  });
});

describe('DIP and multi-pin packages', () => {
  it('numbers a DIP-8 counter-clockwise from pin 1 in row f', () => {
    const m = map('analog/555');
    expect(m.body).toBe('dip');
    expect(m.dipPins).toBe(8);
    expect(m.straddle).toBe(true);
    const o = offsets(m);
    expect(o.GND).toEqual([0, 0]);
    expect(o.TRIG).toEqual([1, 0]);
    expect(o.RST).toEqual([3, 0]);
    expect(o.CTRL).toEqual([3, -3]);
    expect(o.VCC).toEqual([0, -3]);
    expect(m.leads[0].key).toBe('GND');
  });

  it('adds #n keys for not-connected op-amp pins', () => {
    const m = map('analog/lm741');
    expect(Object.keys(m.hidden).sort()).toEqual(['#1', '#5', '#8']);
    expect(m.hidden['#1'].role).toBe('nc');
    expect(offsets(m)['#8']).toEqual([0, -3]);
  });

  it('describes hidden logic supply pins with the supply net name', () => {
    const m = map('ttl/7400');
    expect(m.dipPins).toBe(14);
    expect(m.hidden['#14']).toEqual({ role: 'supply', net: 'VCC' });
    expect(m.hidden['#7']).toEqual({ role: 'ground', net: '0' });
    expect(offsets(m)['#14']).toEqual([0, -3]);
    expect(offsets(m)['#7']).toEqual([6, 0]);
    expect(map('ttl/7400', { vccnet: 'V5' }).hidden['#14'].net).toBe('V5');
    expect(map('cmos/4011').hidden['#14']).toEqual({ role: 'supply', net: 'VDD' });
    const inv = map('cmos/4049');
    expect(inv.dipPins).toBe(16);
    expect(inv.hidden['#1']).toEqual({ role: 'supply', net: 'VDD' });
    expect(inv.hidden['#8'].role).toBe('ground');
    expect(inv.hidden['#16'].role).toBe('nc');
  });

  it('lays out a 10-pin 7-segment display with its second common pin', () => {
    const m = map('indicators/seven-seg-cc');
    expect(m.body).toBe('seven-seg');
    const o = offsets(m);
    expect(o.e).toEqual([0, 0]);
    expect(o.CC).toEqual([2, 0]);
    expect(o.dp).toEqual([4, 0]);
    expect(o.b).toEqual([4, -3]);
    expect(o.a).toEqual([3, -3]);
    expect(o['CC~2']).toEqual([2, -3]);
    expect(o.g).toEqual([0, -3]);
    expect(logicalPin('CC~2')).toBe('CC');
  });

  it('maps the bar graph with cathode k opposite anode k', () => {
    const o = offsets(map('indicators/bargraph'));
    expect(o.A1).toEqual([0, 0]);
    expect(o.K1).toEqual([0, -3]);
    expect(o.A10).toEqual([9, 0]);
    expect(o.K10).toEqual([9, -3]);
  });

  it('maps pots, switches and headers inline', () => {
    expect(offsets(map('basic/potentiometer'))).toEqual({ '1': [0, 0], W: [1, 0], '2': [2, 0] });
    expect(map('basic/switch-spdt').pinout).toEqual(['A', 'COM', 'B']);
    expect(map('basic/switch-dpdt').straddle).toBe(true);
    expect(map('basic/push-button').body).toBe('push-button');
    expect(offsets(map('connectors/header-3'))).toEqual({ '1': [0, 0], '2': [1, 0], '3': [2, 0] });
    expect(offsets(map('connectors/terminal-2'))['2']).toEqual([2, 0]);
  });

  it('falls back to a generic inline or straddling box', () => {
    const g = map('misc-digital/and2');
    expect(g.body).toBe('generic');
    expect(offsets(g)).toEqual({ A: [0, 0], B: [1, 0], Y: [2, 0] });
    const adc = map('mixed/adc8');
    expect(adc.straddle).toBe(true);
    expect(adc.dipPins).toBe(14);
    expect(map('electromechanical/relay-spdt').straddle).toBe(true);
  });
});

describe('mounting', () => {
  it('puts sources and instruments off the board and skips power symbols', () => {
    expect(map('sources/battery').mounting).toBe('offboard');
    expect(map('sources/battery').body).toBe('battery');
    expect(map('sources/battery').offboardPins).toEqual(['+', '-']);
    expect(map('sources/dc-voltage').body).toBe('supply');
    expect(map('instruments/multimeter').mounting).toBe('offboard');
    expect(map('instruments/multimeter').body).toBe('instrument');
    expect(map('indicators/voltmeter').mounting).toBe('offboard');
    expect(map('basic/transformer').mounting).toBe('offboard');
    expect(map('sources/ground').mounting).toBe('none');
    expect(map('sources/vcc').mounting).toBe('none');
  });

  it('prints short part labels', () => {
    expect(shortLabel(getPart('analog/555')!)).toBe('555');
    expect(shortLabel(getPart('transistors/npn')!)).toBe('NPN');
    expect(shortLabel(getPart('transistors/2n3904')!)).toBe('2N3904');
  });
});

describe('placing templates', () => {
  it('rotates offsets clockwise on screen', () => {
    expect(rotateOffset(1, 0, 90)).toStrictEqual({ dx: 0, dy: 1 });
    expect(rotateOffset(1, 0, 180)).toStrictEqual({ dx: -1, dy: 0 });
    expect(rotateOffset(1, 0, 270)).toEqual({ dx: 0, dy: -1 });
    expect(rotateOffset(2, -3, 360)).toEqual({ dx: 2, dy: -3 });
  });

  it('drops a DIP across the channel', () => {
    const r = placeLeads(map('analog/555'), board, { board: 'bb1', row: 'f', col: 10 });
    expect(r.ok).toBe(true);
    expect(r.pins.GND).toEqual({ board: 'bb1', row: 'f', col: 10 });
    expect(r.pins.VCC).toEqual({ board: 'bb1', row: 'e', col: 10 });
    expect(r.pins.CTRL).toEqual({ board: 'bb1', row: 'e', col: 13 });
  });

  it('bends axial leads onto the nearest hole and rejects leads off the board', () => {
    const res = map('basic/resistor');
    const across = placeLeads(res, board, { board: 'bb1', row: 'e', col: 5 }, 90);
    expect(across.pins['2']).toEqual({ board: 'bb1', row: 'g', col: 5 });
    const sameStrip = placeLeads(res, board, { board: 'bb1', row: 'a', col: 5 }, 90);
    expect(sameStrip.pins['2']).toEqual({ board: 'bb1', row: 'e', col: 5 });
    const off = placeLeads(res, board, { board: 'bb1', row: 'a', col: 61 });
    expect(off.ok).toBe(false);
    expect(off.bad).toEqual(['2']);
    const led = placeLeads(map('diodes/led-red'), board, { board: 'bb1', row: 'd', col: 6 }, 180);
    expect(led.pins.K).toEqual({ board: 'bb1', row: 'd', col: 5 });
  });
});
