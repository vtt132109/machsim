/**
 * Small, fixed PartDefs for store unit tests (independent of the evolving library catalogue).
 * Not imported by application code.
 */
import type { PartDef } from '../../library/types';
import type { PartLookup } from './types';

export const TEST_RESISTOR: PartDef = {
  id: 'test/resistor',
  name: 'Resistor',
  group: 'basic',
  family: 'Resistor',
  description: 'test resistor',
  prefix: 'R',
  symbol: {
    bbox: { x: -30, y: -8, w: 60, h: 16 },
    prims: [{ kind: 'line', x1: -30, y1: 0, x2: 30, y2: 0 }],
    pins: [
      { name: '1', x: -30, y: 0, dir: 'left' },
      { name: '2', x: 30, y: 0, dir: 'right' },
    ],
    refPos: { x: 0, y: -14 },
    valuePos: { x: 0, y: 20 },
  },
  params: [{ key: 'value', label: 'Resistance', unit: 'Ω', default: '1k', kind: 'number', showOnSchematic: true, group: 'value' }],
};

export const TEST_GROUND: PartDef = {
  id: 'test/ground',
  name: 'Ground',
  group: 'sources',
  family: 'Power',
  description: 'test ground',
  prefix: 'GND',
  globalNet: '0',
  symbol: {
    bbox: { x: -12, y: 0, w: 24, h: 22 },
    prims: [{ kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
    pins: [{ name: '1', x: 0, y: 0, dir: 'up' }],
  },
  params: [],
};

export const TEST_CAP: PartDef = {
  id: 'test/capacitor',
  name: 'Capacitor',
  group: 'basic',
  family: 'Capacitor',
  description: 'test capacitor (vertical)',
  prefix: 'C',
  symbol: {
    bbox: { x: -10, y: -20, w: 20, h: 40 },
    prims: [],
    pins: [
      { name: '1', x: 0, y: -20, dir: 'up' },
      { name: '2', x: 0, y: 20, dir: 'down' },
    ],
  },
  params: [{ key: 'value', label: 'Capacitance', unit: 'F', default: '1u', kind: 'number', showOnSchematic: true }],
};

export const TEST_SWITCH: PartDef = {
  id: 'test/switch',
  name: 'SPST',
  group: 'basic',
  family: 'Switch',
  description: 'test switch',
  prefix: 'S',
  symbol: {
    bbox: { x: -20, y: -10, w: 40, h: 20 },
    prims: [],
    pins: [
      { name: '1', x: -20, y: 0 },
      { name: '2', x: 20, y: 0 },
    ],
  },
  params: [{ key: 'closed', label: 'Closed', default: 'false', kind: 'bool' }],
  interactive: { kind: 'toggle', param: 'closed', label: 'Toggle', key: 'A' },
};

export const TEST_POT: PartDef = {
  id: 'test/pot',
  name: 'Potentiometer',
  group: 'basic',
  family: 'Potentiometer',
  description: 'test potentiometer',
  prefix: 'R',
  symbol: {
    bbox: { x: -30, y: -10, w: 60, h: 20 },
    prims: [],
    pins: [
      { name: '1', x: -30, y: 0 },
      { name: '2', x: 30, y: 0 },
      { name: 'w', x: 0, y: -10 },
    ],
  },
  params: [
    { key: 'value', label: 'Resistance', default: '10k', kind: 'number' },
    { key: 'setting', label: 'Setting', unit: '%', default: '50', kind: 'number', min: 0, max: 100 },
  ],
  interactive: { kind: 'slider', param: 'setting', label: 'Wiper', key: 'B', step: 10 },
};

const ALL = [TEST_RESISTOR, TEST_GROUND, TEST_CAP, TEST_SWITCH, TEST_POT];
export const testLookup: PartLookup = (id) => ALL.find((p) => p.id === id);
