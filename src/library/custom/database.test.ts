/**
 * Part databases: file round trip, validation with JSON paths, families, user fields, merge
 * policies, moving parts, copying a master part, ids from (Vietnamese) names.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../index';
import {
  addField,
  addFamily,
  databaseFamilies,
  DatabaseFormatError,
  mergeDatabases,
  movePart,
  newDatabase,
  parseDatabase,
  partFromLibrary,
  removeFamily,
  removeField,
  removePart,
  renameFamily,
  serializeDatabase,
  setPartField,
  slugify,
  templateSymbol,
  uniquePartId,
  upsertPart,
  type CustomPartData,
} from './index';

function part(id: string, name: string, family = 'Mine', modified?: string): CustomPartData {
  return {
    id,
    name,
    group: 'diodes',
    family,
    description: '',
    prefix: 'D',
    symbol: templateSymbol('diode'),
    model: { kind: 'spice', text: '.model DX D(IS=1n)', name: 'DX', pins: ['A', 'K'] },
    ...(modified ? { modified } : {}),
  };
}

describe('part database', () => {
  it('round-trips through its file format', () => {
    let db = newDatabase('user', 'Lớp 12A');
    db = addFamily(db, 'diodes', 'Mine');
    db = addField(db, 'Manufacturer');
    db = upsertPart(db, part('custom:d1', 'D1'), '2026-01-01T00:00:00.000Z');
    db = setPartField(db, 'custom:d1', 'Manufacturer', 'ACME', '2026-01-02T00:00:00.000Z');
    const text = serializeDatabase(db);
    const back = parseDatabase(text);
    expect(back).toEqual(db);
    expect(back.parts[0].fields).toEqual({ Manufacturer: 'ACME' });
    expect(back.parts[0].modified).toBe('2026-01-02T00:00:00.000Z');
    expect(serializeDatabase(back)).toBe(text);
  });

  it('reports invalid files with JSON paths', () => {
    expect(() => parseDatabase('{')).toThrow(DatabaseFormatError);
    expect(() => parseDatabase('{"format":"machsim-design"}')).toThrow(/not a MachSim part database/);
    const bad = JSON.parse(serializeDatabase(upsertPart(upsertPart(newDatabase('user'), part('custom:a', 'A')), part('custom:b', 'B'))));
    bad.parts[1].id = 'custom:a';
    bad.parts[0].symbol.prims[0].kind = 'blob';
    bad.parts[0].model.pins = 'A K';
    try {
      parseDatabase(JSON.stringify(bad));
      expect.unreachable();
    } catch (e) {
      const issues = (e as DatabaseFormatError).issues;
      expect(issues).toContain('parts[1].id: duplicate id "custom:a"');
      expect(issues.some((i) => i.startsWith('parts[0].symbol.prims[0].kind'))).toBe(true);
      expect(issues).toContain('parts[0].model.pins: expected an array');
    }
  });

  it('families: add, rename (parts follow), remove only when empty', () => {
    let db = upsertPart(newDatabase('user'), part('custom:a', 'A', 'Old'));
    db = addFamily(db, 'diodes', 'Old');
    db = addFamily(db, 'diodes', 'old'); // case-insensitive duplicate
    expect(db.families).toHaveLength(1);
    db = renameFamily(db, 'diodes', 'Old', 'New');
    expect(db.parts[0].family).toBe('New');
    expect(databaseFamilies(db).map((f) => f.name)).toEqual(['New']);
    expect(removeFamily(db, 'diodes', 'New').blocked).toBe(1);
    db = removePart(db, 'custom:a');
    const r = removeFamily(db, 'diodes', 'New');
    expect(r.blocked).toBe(0);
    expect(r.db.families).toEqual([]);
  });

  it('user fields: removing a field clears its values', () => {
    let db = addField(upsertPart(newDatabase('user'), part('custom:a', 'A')), 'Price');
    db = setPartField(db, 'custom:a', 'Price', '0.12');
    db = removeField(db, 'Price');
    expect(db.fields).toEqual([]);
    expect(db.parts[0].fields).toEqual({});
  });

  it('merges: newer / replace / keep', () => {
    const mine = upsertPart(upsertPart(newDatabase('user'), part('custom:a', 'A old'), '2026-01-01T00:00:00.000Z'), part('custom:b', 'B'), '2026-01-01T00:00:00.000Z');
    const theirs = addField(addFamily(upsertPart(upsertPart(newDatabase('corporate'), part('custom:a', 'A new'), '2026-02-01T00:00:00.000Z'), part('custom:c', 'C'), '2026-02-01T00:00:00.000Z'), 'diodes', 'Shared'), 'Supplier');
    const newer = mergeDatabases(mine, theirs, 'newer');
    expect([newer.added, newer.updated, newer.skipped]).toEqual([1, 1, 0]);
    expect(newer.db.parts.find((p) => p.id === 'custom:a')?.name).toBe('A new');
    expect(newer.db.families.map((f) => f.name)).toEqual(['Shared']);
    expect(newer.db.fields).toEqual(['Supplier']);
    expect(newer.db.kind).toBe('user');
    const keep = mergeDatabases(mine, theirs, 'keep');
    expect(keep.db.parts.find((p) => p.id === 'custom:a')?.name).toBe('A old');
    expect([keep.added, keep.updated, keep.skipped]).toEqual([1, 0, 1]);
    // an older incoming copy never replaces with 'newer', always with 'replace'
    const older = upsertPart(newDatabase('user'), part('custom:a', 'A ancient'), '2025-01-01T00:00:00.000Z');
    expect(mergeDatabases(mine, older, 'newer').updated).toBe(0);
    expect(mergeDatabases(mine, older, 'replace').db.parts[0].name).toBe('A ancient');
  });

  it('moves and copies parts between databases', () => {
    const user = upsertPart(newDatabase('user'), part('custom:a', 'A'));
    const corp = newDatabase('corporate');
    const copied = movePart(user, corp, 'custom:a', true);
    expect(copied.from.parts).toHaveLength(1);
    expect(copied.to.parts.map((p) => p.id)).toEqual(['custom:a']);
    const moved = movePart(user, corp, 'custom:a');
    expect(moved.from.parts).toHaveLength(0);
    expect(moved.to.parts[0].id).toBe('custom:a');
  });

  it('ids from names: ASCII slugs, unique', () => {
    expect(slugify('Điốt Zener 5,6V')).toBe('diot-zener-5-6v');
    expect(slugify('***')).toBe('part');
    const taken = new Set(['custom:my-part', 'custom:my-part-2']);
    expect(uniquePartId('My part', taken)).toBe('custom:my-part-3');
  });

  it('copies a master part as a user component with the instance values as defaults', () => {
    const lib = getPart('basic/resistor')!;
    const c = partFromLibrary(lib, { name: 'R tải', params: { value: '4.7k' } });
    expect(c.id).toBe('custom:r-tai');
    expect(c.model).toEqual({ kind: 'builtin', partId: 'basic/resistor', pinMap: { '1': '1', '2': '2' }, params: { value: '4.7k' } });
    expect(c.symbol).toEqual(lib.symbol);
    expect(c.symbol).not.toBe(lib.symbol);
  });
});
