import { describe, expect, it } from 'vitest';
import type { InteractiveDef, ParamDef } from '../../library/types';
import type { Design } from '../../model/types';
import { newDesign } from '../../model/types';
import { computeConnectivity } from './connectivity';
import { interactiveKeyMatches, nextInteractiveValue } from './interactive';
import { nextRefdes, refdesPrefix, validateRefdes } from './refdes';
import { partLabelLayout, partValueText } from './shapes';
import { testLookup, TEST_RESISTOR } from './testParts';
import { fitRect, screenToSheet, sheetToScreen, zoomAt } from './viewport';
import { renumberParts, transformOrientation } from './designOps';
import { instancePins } from '../../model/geometry';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

describe('refdes helpers', () => {
  it('extracts prefixes and finds the next free designator', () => {
    expect(refdesPrefix('XMM12')).toBe('XMM');
    expect(refdesPrefix('R3')).toBe('R');
    const used = new Set(['R1', 'R2', 'R4']);
    expect(nextRefdes('R', used)).toBe('R3');
    expect(nextRefdes('R', used)).toBe('R5');
  });
  it('validates against the design', () => {
    const d = newDesign();
    d.sheets[0].parts.push({ id: 'a', partId: 'test/resistor', refdes: 'R1', x: 0, y: 0, rotation: 0, mirror: false, params: {} });
    expect(validateRefdes(d, 'r1')).toMatch(/already used/);
    expect(validateRefdes(d, 'r1', 'a')).toBeNull();
    expect(validateRefdes(d, '  ')).toMatch(/empty/);
  });
});

describe('viewport math', () => {
  it('zooms about the cursor keeping the sheet point fixed', () => {
    const v = { panX: 10, panY: 20, zoom: 1 };
    const cursor = { x: 300, y: 200 };
    const before = screenToSheet(v, cursor);
    const z = zoomAt(v, cursor, 2);
    expect(z.zoom).toBe(2);
    const after = sheetToScreen(z, before);
    expect(after.x).toBeCloseTo(300, 9);
    expect(after.y).toBeCloseTo(200, 9);
  });
  it('fits a rectangle centred with a margin', () => {
    const v = fitRect({ x: 0, y: 0, w: 200, h: 100 }, { w: 480, h: 480 }, 40, 10);
    expect(v.zoom).toBeCloseTo(2, 9);
    expect(sheetToScreen(v, { x: 100, y: 50 })).toEqual({ x: 240, y: 240 });
  });
});

describe('interactive values', () => {
  const sel: ParamDef = { key: 'pos', label: 'Position', default: 'a', kind: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] };
  it('cycles select options for toggles', () => {
    const def: InteractiveDef = { kind: 'toggle', param: 'pos', label: 'x' };
    expect(nextInteractiveValue(def, sel, 'a', 'click')).toBe('b');
    expect(nextInteractiveValue(def, sel, 'c', 'press')).toBe('a');
    expect(nextInteractiveValue(def, sel, 'c', 'release')).toBeNull();
  });
  it('uses press/release values for momentary buttons', () => {
    const def: InteractiveDef = { kind: 'momentary', param: 'on', label: 'x' };
    const b: ParamDef = { key: 'on', label: 'On', default: 'false', kind: 'bool' };
    expect(nextInteractiveValue(def, b, 'false', 'press')).toBe('true');
    expect(nextInteractiveValue(def, b, 'true', 'release')).toBe('false');
    const n: ParamDef = { key: 'on', label: 'On', default: '0', kind: 'number' };
    expect(nextInteractiveValue(def, n, '0', 'press')).toBe('1');
  });
  it('matches keys case-insensitively and Space', () => {
    expect(interactiveKeyMatches('A', 'a')).toBe(true);
    expect(interactiveKeyMatches('Space', ' ')).toBe(true);
    expect(interactiveKeyMatches('A', 'b')).toBe(false);
    expect(interactiveKeyMatches(undefined, 'a')).toBe(false);
  });
});

describe('part labels', () => {
  const inst = { id: 'r', partId: 'test/resistor', refdes: 'R7', x: 100, y: 100, rotation: 0 as const, mirror: false, params: { value: '4.7k' } };
  it('formats the value with its unit', () => {
    expect(partValueText(inst, TEST_RESISTOR)).toBe('4.7kΩ');
    expect(partValueText({ ...inst, params: { value: '220' } }, TEST_RESISTOR)).toBe('220 Ω');
  });
  it('uses symbol positions at 0° and the right side at 90°', () => {
    const [ref, val] = partLabelLayout(inst, TEST_RESISTOR);
    expect([ref.x, ref.y, ref.anchor]).toEqual([100, 86, 'middle']);
    expect([val.x, val.y]).toEqual([100, 120]);
    const [ref90] = partLabelLayout({ ...inst, rotation: 90 }, TEST_RESISTOR);
    expect(ref90.anchor).toBe('start');
    expect(ref90.x).toBe(113);
    const [moved] = partLabelLayout({ ...inst, refOffset: { x: 5, y: -30 } }, TEST_RESISTOR);
    expect([moved.x, moved.y]).toEqual([105, 70]);
  });
});

describe('orientation algebra', () => {
  it('flipH of a rotated part equals mirroring its screen image', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const mirror of [false, true]) {
        const inst = { id: 'x', partId: 'test/resistor', refdes: 'R1', x: 0, y: 0, rotation, mirror, params: {} };
        const o = transformOrientation(rotation, mirror, 'flipH');
        const before = instancePins(inst, TEST_RESISTOR);
        const after = instancePins({ ...inst, ...o }, TEST_RESISTOR);
        after.forEach((p, i) => {
          expect(p.x).toBeCloseTo(-before[i].x, 9);
          expect(p.y).toBeCloseTo(before[i].y, 9);
        });
      }
    }
  });
});

describe('connectivity', () => {
  function design(): Design {
    const d = newDesign();
    const s = d.sheets[0];
    s.parts.push(
      { id: 'a', partId: 'test/resistor', refdes: 'R1', x: 100, y: 100, rotation: 0, mirror: false, params: {} },
      { id: 'b', partId: 'test/resistor', refdes: 'R2', x: 300, y: 100, rotation: 0, mirror: false, params: {} },
      { id: 'g', partId: 'test/ground', refdes: 'GND1', x: 400, y: 200, rotation: 0, mirror: false, params: {} },
    );
    s.wires.push(
      { id: 'w1', points: [{ x: 130, y: 100 }, { x: 270, y: 100 }] },
      { id: 'w2', points: [{ x: 330, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 200 }] },
    );
    // global labels join across sheets (plain labels are local to their sheet since format v2)
    s.labels.push({ id: 'l1', x: 200, y: 100, name: 'MID', rotation: 0, global: true });
    d.sheets.push({ id: 's2', name: 'Two', parts: [{ id: 'c', partId: 'test/capacitor', refdes: 'C1', x: 0, y: 0, rotation: 0, mirror: false, params: {} }], wires: [{ id: 'w3', points: [{ x: 0, y: -20 }, { x: 0, y: -60 }] }], labels: [{ id: 'l2', x: 0, y: -60, name: 'mid', rotation: 0, global: true }], probes: [], notes: [] });
    return d;
  }
  it('groups pins through wires, global labels across sheets and global ground', () => {
    const c = computeConnectivity(design(), testLookup);
    const byName = Object.fromEntries(c.nets.map((n) => [n.name, n.pins.map((p) => `${p.refdes}.${p.pin}`).sort()]));
    expect(byName.GND).toEqual(['GND1.1', 'R2.2']);
    expect(byName.MID).toEqual(['C1.1', 'R1.2', 'R2.1']);
    expect(c.nets.filter((n) => !n.named).map((n) => n.pins.length).sort()).toEqual([1, 1]);
    expect(c.wireNet.get('w1')).toBe(c.wireNet.get('w3'));
  });
  it('keeps local labels on their sheet and joins off-page connectors', () => {
    const d = design();
    delete d.sheets[0].labels[0].global;
    delete d.sheets[1].labels[0].global;
    expect(computeConnectivity(d, testLookup).wireNet.get('w1')).not.toBe(computeConnectivity(d, testLookup).wireNet.get('w3'));
    d.sheets[0].labels[0].kind = 'offpage';
    d.sheets[1].labels[0].kind = 'offpage';
    const c = computeConnectivity(d, testLookup);
    expect(c.wireNet.get('w1')).toBe(c.wireNet.get('w3'));
  });
});

describe('renumber', () => {
  it('numbers parts in reading order', () => {
    const d = newDesign();
    d.sheets[0].parts.push(
      { id: 'a', partId: 'test/resistor', refdes: 'R9', x: 300, y: 0, rotation: 0, mirror: false, params: {} },
      { id: 'b', partId: 'test/resistor', refdes: 'R4', x: 0, y: 0, rotation: 0, mirror: false, params: {} },
      { id: 'c', partId: 'test/resistor', refdes: 'R2', x: 0, y: 200, rotation: 0, mirror: false, params: {} },
    );
    const out = renumberParts(d, testLookup);
    expect(out.sheets[0].parts.map((p) => p.refdes)).toEqual(['R2', 'R1', 'R3']);
  });
});
