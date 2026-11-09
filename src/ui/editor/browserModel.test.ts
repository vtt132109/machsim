import { describe, expect, it } from 'vitest';
import type { GroupDef, PartDef } from '../../library/types';
import { TEST_CAP, TEST_GROUND, TEST_POT, TEST_RESISTOR, TEST_SWITCH } from '../store/testParts';
import { buildBrowserTree, familyKey, groupKey, partKey, pathToPart, searchCatalogue, searchRows, treeKey, visibleRows } from './browserModel';

const GROUPS: GroupDef[] = [
  { id: 'sources', name: 'Sources', order: 0 },
  { id: 'basic', name: 'Basic', order: 1 },
  { id: 'diodes', name: 'Diodes', order: 2 },
];

const R10: PartDef = { ...TEST_RESISTOR, id: 'test/r10', name: 'Resistor 10' };
const R2: PartDef = { ...TEST_RESISTOR, id: 'test/r2', name: 'Resistor 2', keywords: ['carbon film'] };
const ORPHAN: PartDef = { ...TEST_RESISTOR, id: 'x/orphan', name: 'Orphan', group: 'rf', family: '' };
const PARTS = [TEST_RESISTOR, R10, R2, TEST_CAP, TEST_GROUND, TEST_SWITCH, TEST_POT];

describe('buildBrowserTree', () => {
  it('groups by order, families and parts alphabetically (numeric aware), skipping empty groups', () => {
    const tree = buildBrowserTree(PARTS, GROUPS);
    expect(tree.map((g) => g.group.id)).toEqual(['sources', 'basic']);
    const basic = tree[1];
    expect(basic.count).toBe(6);
    expect(basic.families.map((f) => f.name)).toEqual(['Capacitor', 'Potentiometer', 'Resistor', 'Switch']);
    expect(basic.families[2].parts.map((p) => p.name)).toEqual(['Resistor', 'Resistor 2', 'Resistor 10']);
    expect(basic.families[2].key).toBe('f:basic/Resistor');
  });
  it('puts parts of unknown groups last and names empty families "General"', () => {
    const tree = buildBrowserTree([...PARTS, ORPHAN], GROUPS);
    const last = tree[tree.length - 1];
    expect(last.group).toMatchObject({ id: 'rf', name: 'rf' });
    expect(last.families[0].name).toBe('General');
    expect(pathToPart(ORPHAN)).toEqual(['g:rf', 'f:rf/General']);
  });
});

describe('searchCatalogue', () => {
  it('ranks exact names and prefixes before partial matches', () => {
    expect(searchCatalogue(PARTS, 'resistor').map((p) => p.id)).toEqual(['test/resistor', 'test/r2', 'test/r10']);
    // "c" is the capacitor prefix (rank 1) and also a substring of other names / families
    expect(searchCatalogue(PARTS, 'c')[0].id).toBe('test/capacitor');
  });
  it('requires every token and searches keywords and descriptions', () => {
    expect(searchCatalogue(PARTS, 'carbon').map((p) => p.id)).toEqual(['test/r2']);
    expect(searchCatalogue(PARTS, 'resistor carbon').map((p) => p.id)).toEqual(['test/r2']);
    expect(searchCatalogue(PARTS, 'test switch').map((p) => p.id)).toEqual(['test/switch']);
    expect(searchCatalogue(PARTS, 'zzz')).toEqual([]);
    expect(searchCatalogue(PARTS, '   ')).toEqual([]);
  });
});

describe('visible rows and keyboard navigation', () => {
  const tree = buildBrowserTree(PARTS, GROUPS);
  it('shows children of expanded nodes only', () => {
    expect(visibleRows(tree, new Set()).map((r) => r.key)).toEqual(['g:sources', 'g:basic']);
    const rows = visibleRows(tree, new Set([groupKey('basic'), familyKey('basic', 'Switch')]));
    expect(rows.map((r) => r.key)).toEqual(['g:sources', 'g:basic', 'f:basic/Capacitor', 'f:basic/Potentiometer', 'f:basic/Resistor', 'f:basic/Switch', 'p:test/switch']);
    expect(rows[6]).toMatchObject({ kind: 'part', level: 3, parentKey: 'f:basic/Switch' });
  });
  it('implements the tree keyboard pattern', () => {
    const collapsed = visibleRows(tree, new Set());
    expect(treeKey(collapsed, null, 'ArrowDown')).toEqual({ active: 'g:sources' });
    expect(treeKey(collapsed, 'g:sources', 'ArrowDown')).toEqual({ active: 'g:basic' });
    expect(treeKey(collapsed, 'g:basic', 'ArrowDown')).toEqual({ active: 'g:basic' });
    expect(treeKey(collapsed, 'g:basic', 'ArrowRight')).toEqual({ active: 'g:basic', toggle: 'g:basic' });
    expect(treeKey(collapsed, 'g:basic', 'Enter')).toEqual({ active: 'g:basic', toggle: 'g:basic' });
    const open = visibleRows(tree, new Set(['g:basic', 'f:basic/Switch']));
    expect(treeKey(open, 'g:basic', 'ArrowRight')).toEqual({ active: 'f:basic/Capacitor' });
    expect(treeKey(open, 'g:basic', 'ArrowLeft')).toEqual({ active: 'g:basic', toggle: 'g:basic' });
    expect(treeKey(open, 'p:test/switch', 'ArrowLeft')).toEqual({ active: 'f:basic/Switch' });
    expect(treeKey(open, 'f:basic/Capacitor', 'ArrowLeft')).toEqual({ active: 'g:basic' });
    expect(treeKey(open, 'p:test/switch', 'Enter')).toEqual({ active: 'p:test/switch', activate: 'test/switch' });
    expect(treeKey(open, 'p:test/switch', 'Home')).toEqual({ active: 'g:sources' });
    expect(treeKey(open, 'g:sources', 'End')).toEqual({ active: 'p:test/switch' });
    expect(treeKey(open, 'g:sources', 'x')).toBeNull();
  });
  it('search rows are flat part rows', () => {
    const rows = searchRows(searchCatalogue(PARTS, 'switch'));
    expect(rows).toEqual([{ kind: 'part', key: partKey('test/switch'), level: 1, part: TEST_SWITCH, parentKey: null }]);
    expect(treeKey(rows, partKey('test/switch'), 'ArrowLeft')).toEqual({ active: partKey('test/switch') });
  });
});
