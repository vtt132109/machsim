import { describe, expect, it } from 'vitest';
import {
  checkPinTypes,
  DEFAULT_PIN_MATRIX,
  ERC_PIN_TYPES,
  hiddenPowerMode,
  isNcPin,
  ncPinsOf,
  normalizePinType,
  pinPairKey,
  pinPairLevel,
  toggleNcPin,
  type ErcNetPins,
  type ErcPinEntry,
} from './ercMatrix';

const pin = (refdes: string, name: string, type: ErcPinEntry['type'], nc = false): ErcPinEntry => ({ refdes, pin: name, type, ...(nc ? { nc: true } : {}) });
const net = (name: string, pins: ErcPinEntry[], rail = false): ErcNetPins => ({ node: name, name, pins, ...(rail ? { rail: true } : {}) });

describe('pin types', () => {
  it('normalises the legacy and absent types', () => {
    expect(normalizePinType(undefined)).toBe('passive');
    expect(normalizePinType('power')).toBe('power-in');
    expect(normalizePinType('tristate')).toBe('tristate');
    expect(normalizePinType('nc')).toBe('nc');
  });

  it('keys a pair without order and in matrix order', () => {
    expect(pinPairKey('output', 'input')).toBe('input|output');
    expect(pinPairKey('input', 'output')).toBe('input|output');
    expect(pinPairKey('output', 'output')).toBe('output|output');
    // every default key is canonical
    for (const k of Object.keys(DEFAULT_PIN_MATRIX)) {
      const [a, b] = k.split('|') as [ErcPinEntry['type'], ErcPinEntry['type']];
      expect(pinPairKey(a, b)).toBe(k);
    }
  });

  it('has a level for every pair and defaults to ok', () => {
    for (const a of ERC_PIN_TYPES) {
      for (const b of ERC_PIN_TYPES) {
        expect(['ok', 'warning', 'error']).toContain(pinPairLevel(a, b));
        expect(pinPairLevel(a, b)).toBe(pinPairLevel(b, a));
      }
    }
    expect(pinPairLevel('passive', 'passive')).toBe('ok');
    expect(pinPairLevel('input', 'input')).toBe('ok');
    expect(pinPairLevel('input', 'output')).toBe('ok');
  });

  it('flags the combinations that fight on a real board', () => {
    expect(pinPairLevel('output', 'output')).toBe('error');
    expect(pinPairLevel('output', 'power-out')).toBe('error');
    expect(pinPairLevel('power-out', 'power-out')).toBe('error');
    expect(pinPairLevel('output', 'tristate')).toBe('warning');
    expect(pinPairLevel('output', 'open-collector')).toBe('warning');
    expect(pinPairLevel('open-collector', 'open-collector')).toBe('ok');
    expect(pinPairLevel('tristate', 'tristate')).toBe('ok');
    expect(pinPairLevel('power-out', 'power-in')).toBe('ok');
  });

  it('honours an override from the design', () => {
    const overrides = { [pinPairKey('output', 'output')]: 'warning' as const, [pinPairKey('input', 'input')]: 'error' as const };
    expect(pinPairLevel('output', 'output', overrides)).toBe('warning');
    expect(pinPairLevel('input', 'input', overrides)).toBe('error');
    expect(pinPairLevel('passive', 'input', overrides)).toBe('ok');
  });
});

describe('checkPinTypes', () => {
  it('reports two outputs on one net as an error, once per net', () => {
    const msgs = checkPinTypes([net('OUT', [pin('U1', 'Y', 'output'), pin('U2', 'Y', 'output'), pin('R1', '1', 'passive')])]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].severity).toBe('error');
    expect(msgs[0].code).toBe('pin-type');
    expect(msgs[0].detail?.id).toBe('pinTypeClash');
    expect(msgs[0].detail?.params).toMatchObject({ net: 'OUT', a: 'output', b: 'output', left: 'U1.Y', right: 'U2.Y' });
    expect(msgs[0].message).toContain("a 'output' pin (U1.Y) meets a 'output' pin (U2.Y)");
    expect(msgs[0].net).toBe('OUT');
  });

  it('says nothing about an output driving inputs or passive parts', () => {
    expect(checkPinTypes([net('N1', [pin('U1', 'Y', 'output'), pin('U2', 'A', 'input'), pin('U3', 'A', 'input'), pin('R1', '1', 'passive')])])).toEqual([]);
  });

  it('warns about an output on an open-collector or tri-state line', () => {
    const oc = checkPinTypes([net('BUS', [pin('U1', 'Y', 'output'), pin('U2', 'Y', 'open-collector')])]);
    expect(oc.map((m) => m.severity)).toEqual(['warning']);
    const three = checkPinTypes([net('BUS', [pin('U1', 'Y', 'output'), pin('U2', 'Y', 'tristate')])]);
    expect(three.map((m) => m.severity)).toEqual(['warning']);
    expect(checkPinTypes([net('BUS', [pin('U1', 'Y', 'tristate'), pin('U2', 'Y', 'tristate'), pin('U3', 'A', 'input')])])).toEqual([]);
  });

  it('exempts power and ground rails from the matrix', () => {
    const pins = [pin('U1', 'VCC', 'power-out'), pin('U2', 'VCC', 'power-out'), pin('U3', 'VCC', 'power-in')];
    expect(checkPinTypes([net('VCC', pins, true)])).toEqual([]);
    expect(checkPinTypes([net('VCC', pins)])).toHaveLength(1);
  });

  it('reports every clashing pair of a net separately', () => {
    const msgs = checkPinTypes([net('N1', [pin('U1', 'Y', 'output'), pin('U2', 'Y', 'output'), pin('U3', 'Y', 'tristate')])]);
    expect(msgs.map((m) => [m.detail?.params?.a, m.detail?.params?.b])).toEqual([
      ['output', 'output'],
      ['output', 'tristate'],
    ]);
  });

  it('needs two pins of a type before pairing it with itself', () => {
    expect(checkPinTypes([net('N1', [pin('U1', 'Y', 'output'), pin('R1', '1', 'passive')])])).toEqual([]);
  });

  it('can be switched off, and single-pin nets are never checked', () => {
    const nets = [net('N1', [pin('U1', 'Y', 'output'), pin('U2', 'Y', 'output')])];
    expect(checkPinTypes(nets, { settings: { pinTypes: false } })).toEqual([]);
    expect(checkPinTypes([net('N1', [pin('U1', 'Y', 'output')])])).toEqual([]);
  });

  it('names the parts and prefixes messages of a child design', () => {
    const msgs = checkPinTypes([net('N1', [pin('U1', 'Y', 'output'), pin('U2', 'Y', 'output')])], { prefix: 'Amp: ' });
    expect(msgs[0].message).toContain('Amp: ');
    expect(msgs[0].detail?.params?.left).toContain('U1.Y');
    expect(msgs[0].detail?.params?.right).toContain('U2.Y');
  });

  it('abbreviates long pin lists', () => {
    // one type against itself: the first pin is named on its own, every other pin on the far side
    const many = Array.from({ length: 5 }, (_, i) => pin(`U${i + 1}`, 'Y', 'output'));
    const msgs = checkPinTypes([net('N1', many)]);
    expect(msgs[0].detail?.params?.left).toBe('U1.Y');
    expect(String(msgs[0].detail?.params?.right)).toBe('U2.Y, U3.Y, U4.Y, … (4)');
    // two different types: each side lists its own group
    const mixed = checkPinTypes([net('N2', [pin('U9', 'Y', 'output'), ...Array.from({ length: 5 }, (_, i) => pin(`U${i + 1}`, 'Y', 'open-collector'))])]);
    expect(mixed[0].detail?.params?.left).toBe('U9.Y');
    expect(String(mixed[0].detail?.params?.right)).toBe('U1.Y, U2.Y, U3.Y, … (5)');
  });

  it('reports a pin marked NC that is wired anyway', () => {
    const msgs = checkPinTypes([net('N1', [pin('U1', '7', 'passive', true), pin('R1', '1', 'passive')])]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].severity).toBe('error');
    expect(msgs[0].detail?.id).toBe('ncPinConnected');
    expect(msgs[0].detail?.params).toMatchObject({ refdes: 'U1', pin: '7', net: 'N1' });
    expect(checkPinTypes([net('N1', [pin('U1', '7', 'passive', true), pin('R1', '1', 'passive')])], { settings: { ncConnected: false } })).toEqual([]);
  });

  it('treats a pin of type nc like an NC marker and keeps it out of the matrix', () => {
    const msgs = checkPinTypes([net('N1', [pin('U1', '7', 'nc'), pin('U2', 'Y', 'output'), pin('U3', 'Y', 'output')])]);
    expect(msgs.map((m) => m.detail?.id)).toEqual(['ncPinConnected', 'pinTypeClash']);
  });
});

describe('NC markers', () => {
  it('adds, removes and sorts markers', () => {
    expect(ncPinsOf({})).toEqual([]);
    expect(toggleNcPin({}, '7')).toEqual(['7']);
    expect(toggleNcPin({ ncPins: ['7'] }, '7')).toBeUndefined();
    expect(toggleNcPin({ ncPins: ['7'] }, '3')).toEqual(['3', '7']);
    expect(toggleNcPin({ ncPins: ['7'] }, '7', true)).toEqual(['7']);
    expect(toggleNcPin({ ncPins: ['3', '7'] }, '3', false)).toEqual(['7']);
    expect(isNcPin({ ncPins: ['3'] }, '3')).toBe(true);
    expect(isNcPin({ ncPins: ['3'] }, '7')).toBe(false);
    expect(isNcPin({}, '3')).toBe(false);
  });

  it('never stores a duplicate', () => {
    expect(toggleNcPin({ ncPins: ['7', '7'] }, '3')).toEqual(['3', '7']);
  });
});

describe('hiddenPowerMode', () => {
  it('follows the digital simulation mode when the ERC option is auto', () => {
    expect(hiddenPowerMode(undefined, undefined)).toBe('auto');
    expect(hiddenPowerMode({}, { mode: 'auto' })).toBe('auto');
    expect(hiddenPowerMode({}, { mode: 'ideal' })).toBe('ideal');
    expect(hiddenPowerMode({}, { mode: 'real' })).toBe('required');
  });

  it('lets the ERC option override it', () => {
    expect(hiddenPowerMode({ hiddenPower: 'ideal' }, { mode: 'real' })).toBe('ideal');
    expect(hiddenPowerMode({ hiddenPower: 'required' }, { mode: 'ideal' })).toBe('required');
    expect(hiddenPowerMode({ hiddenPower: 'auto' }, undefined)).toBe('auto');
  });
});
