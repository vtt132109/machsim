import { describe, expect, it } from 'vitest';
import { CURRENT_DESIGN_VERSION, DesignFormatError, MIGRATIONS, migrateDesign, parseDesign, serializeDesign, validateDesign } from './serialize';
import { DesignBuilder } from './designkit';
import { newDesign } from './types';
import { emptyBreadboard } from '../breadboard/types';

function sample() {
  const b = new DesignBuilder('Round trip');
  b.part('basic/resistor', 'R1', 10, 20, { value: '2.2k' }, { rotation: 90, mirror: true });
  b.wire({ x: 0, y: 0 }, { x: 40, y: 0 });
  b.label('OUT', 40, 0);
  b.probe('differential', 20, 0, 'P1', { x: 0, y: 0 });
  b.design.sheets[0].notes.push({ id: 'n1', x: 5, y: 5, text: 'hello', size: 12 });
  b.design.variables = { gain: '3', rload: '1k' };
  b.design.customSpice = '.model D1 D(IS=1e-14)';
  b.design.description = 'test design';
  b.design.breadboard = emptyBreadboard();
  b.design.options = { temp: 50, method: 'gear' };
  return b.design;
}

function issues(text: string): string[] {
  try {
    parseDesign(text);
  } catch (e) {
    expect(e).toBeInstanceOf(DesignFormatError);
    return (e as DesignFormatError).issues;
  }
  throw new Error('expected a DesignFormatError');
}

describe('serialize / parse', () => {
  it('round-trips a design exactly', () => {
    const d = sample();
    const text = serializeDesign(d);
    expect(parseDesign(text)).toEqual(d);
    const normalised = serializeDesign(parseDesign(text));
    expect(serializeDesign(parseDesign(normalised))).toBe(normalised);
  });

  it('fills defaults for optional fields', () => {
    const minimal = {
      format: 'machsim-design',
      version: 1,
      sheets: [{ id: 's1', parts: [{ id: 'p1', partId: 'basic/resistor', x: 0, y: 0, params: { value: 1000 } }], wires: [{ id: 'w', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], probes: [{ id: 'pr', kind: 'current', x: 5, y: 0 }] }],
    };
    const d = parseDesign(JSON.stringify(minimal));
    expect(d.title).toBe('Untitled');
    expect(d.analysis).toEqual(newDesign().analysis);
    expect(d.options).toEqual({});
    expect(d.variables).toEqual({});
    expect(d.sheets[0]).toMatchObject({ name: 'Sheet 1', labels: [], notes: [] });
    expect(d.sheets[0].parts[0]).toEqual({ id: 'p1', partId: 'basic/resistor', refdes: '', x: 0, y: 0, rotation: 0, mirror: false, params: { value: '1000' } });
    expect(d.sheets[0].probes[0]).toEqual({ id: 'pr', kind: 'current', x: 5, y: 0, name: '', color: '#e53935' });
  });

  it('normalises rotations and rejects invalid ones', () => {
    const base = newDesign();
    base.sheets[0].parts.push({ id: 'p', partId: 'basic/resistor', refdes: 'R1', x: 0, y: 0, rotation: 0, mirror: false, params: {} });
    const raw = JSON.parse(serializeDesign(base));
    raw.sheets[0].parts[0].rotation = -90;
    expect(parseDesign(JSON.stringify(raw)).sheets[0].parts[0].rotation).toBe(270);
    raw.sheets[0].parts[0].rotation = 45;
    expect(issues(JSON.stringify(raw))).toEqual(['sheets[0].parts[0].rotation: must be 0, 90, 180 or 270 (got 45)']);
  });

  it('reports every problem with its JSON path', () => {
    const bad = {
      format: 'machsim-design',
      version: 1,
      title: 7,
      sheets: [
        {
          id: 's1',
          parts: [{ id: 'p1', partId: 'basic/resistor', x: 'a', y: 0, mirror: 'no' }, { id: 'p1', partId: 'basic/resistor', x: 0, y: 0 }],
          wires: [{ id: 'w1', points: [{ x: 0, y: 0 }] }],
          probes: [{ id: 'q', kind: 'magic', x: 0, y: 0 }],
          labels: 'nope',
        },
      ],
      options: { temp: 'hot' },
      variables: { k: null },
    };
    const list = issues(JSON.stringify(bad));
    // a numeric title is accepted as text ("7"); everything else is reported in document order
    expect(list).toEqual([
      'sheets[0].parts[0].x: expected a finite number (got "a")',
      'sheets[0].parts[0].mirror: expected true or false (got "no")',
      'sheets[0].wires[0].points: a wire needs at least 2 points (got 1)',
      'sheets[0].labels: expected an array',
      'sheets[0].probes[0].kind: must be one of voltage, current, power, differential, digital, reference (got "magic")',
      'sheets[0].parts: duplicate id "p1"',
      'options.temp: expected a finite number (got "hot")',
      '(root).variables.k: expected text (got null)',
    ]);
  });

  it('requires item ids to be unique across all sheets (the editor looks items up design-wide)', () => {
    const b = new DesignBuilder('dups');
    b.part('basic/resistor', 'R1', 0, 0);
    b.label('A', 0, 0);
    b.addSheet('Second');
    b.part('basic/resistor', 'R2', 0, 0);
    b.label('B', 0, 0);
    b.label('C', 50, 0);
    const raw = JSON.parse(serializeDesign(b.design));
    expect(parseDesign(JSON.stringify(raw)).sheets).toHaveLength(2); // distinct ids load fine
    raw.sheets[1].parts[0].id = raw.sheets[0].parts[0].id;
    raw.sheets[1].labels[1].id = raw.sheets[1].labels[0].id;
    const pid = JSON.stringify(raw.sheets[0].parts[0].id);
    const lid = JSON.stringify(raw.sheets[1].labels[0].id);
    expect(issues(JSON.stringify(raw))).toEqual([
      `sheets[1].parts: id ${pid} is already used on sheets[0] (ids must be unique in the whole design)`,
      `sheets[1].labels: duplicate id ${lid}`,
    ]);
  });

  it('rejects files that are not MachSim designs or come from a newer version', () => {
    expect(issues('{ nope')[0]).toMatch(/not valid JSON/);
    expect(issues('[1,2]')[0]).toMatch(/JSON object/);
    expect(issues(JSON.stringify({ format: 'other', version: 1, sheets: [] }))[0]).toMatch(/Not a MachSim design file/);
    expect(issues(JSON.stringify({ format: 'machsim-design', version: CURRENT_DESIGN_VERSION + 1, sheets: [] }))[0]).toMatch(/newer MachSim/);
    expect(issues(JSON.stringify({ format: 'machsim-design', version: 1, sheets: [] }))).toEqual(['sheets: a design needs at least one sheet']);
    expect(() => validateDesign(null)).toThrow(DesignFormatError);
  });

  it('migrates version-0 (header-less) documents', () => {
    const legacy = { title: 'Old', sheets: [{ id: 's', name: 'Main', parts: [], wires: [] }] };
    expect(MIGRATIONS[0]).toBeTypeOf('function');
    // version 0 -> 1 -> 2 (the current format)
    expect(migrateDesign(legacy)).toMatchObject({ format: 'machsim-design', version: CURRENT_DESIGN_VERSION, title: 'Old' });
    const d = parseDesign(JSON.stringify(legacy));
    expect(d.title).toBe('Old');
    expect(d.sheets[0]).toEqual({ id: 's', name: 'Main', parts: [], wires: [], labels: [], probes: [], notes: [] });
  });
});
