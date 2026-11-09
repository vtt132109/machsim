/**
 * Catalogue packs: the big part tables load on demand, once, and then join the built-in list.
 *
 * This file must not load the packs before its first test (it checks the start-up state).
 */
import { describe, expect, it } from 'vitest';
import {
  cataloguePacks,
  ensurePartsLoaded,
  getPart,
  groupOfPartId,
  groupState,
  hasPendingPacks,
  isBuiltinPart,
  libraryVersion,
  listParts,
  loadAllGroups,
  loadGroup,
  loadPack,
  pendingPartCount,
  registerCataloguePack,
  subscribeLibrary,
} from './index';
import { ALL_PARTS } from './parts';
import type { PartDef, PartGroup } from './types';

function fakePart(id: string, group: PartGroup, family = 'Fake'): PartDef {
  return {
    id,
    name: id.split('/')[1].toUpperCase(),
    group,
    family,
    description: 'test part',
    prefix: 'U',
    symbol: { bbox: { x: -10, y: -10, w: 20, h: 20 }, prims: [], pins: [{ name: '1', x: -10, y: 0 }] },
    params: [],
  };
}

describe('catalogue packs', () => {
  it('start pending: only the core catalogue is listed at start-up', () => {
    expect(listParts()).toBe(ALL_PARTS);
    expect(hasPendingPacks()).toBe(true);
    expect(groupState('ttl')).toBe('pending');
    expect(getPart('transistors/mpsa42')).toBeUndefined();
    expect(getPart('ttl/74ls00')).toBeUndefined();
    // the generic parts of a lazy group are core parts
    expect(getPart('basic/resistor')).toBeDefined();
    // round 4 library breadth adds 1267 (passives-more) + 90 (sensors-more) basic parts and 2 RF transistors
    expect(pendingPartCount('basic')).toBe(682 + 1267 + 90);
    expect(pendingPartCount('rf')).toBe(25 + 105 + 2);
    expect(pendingPartCount('sources')).toBe(0);
    expect(groupState('sources')).toBe('ready');
  });

  it('a group loads its packs once, even with concurrent opens', async () => {
    let calls = 0;
    let resolve!: (v: PartDef[]) => void;
    registerCataloguePack({
      id: 'test-lazy',
      counts: { 'misc-digital': 2 },
      load: () => {
        calls += 1;
        return new Promise<PartDef[]>((r) => (resolve = r));
      },
    });
    let notified = 0;
    const off = subscribeLibrary(() => notified++);
    const v0 = libraryVersion();
    const a = loadGroup('misc-digital');
    const b = loadGroup('misc-digital');
    const c = ensurePartsLoaded(['misc-digital/fake-a']);
    expect(groupState('misc-digital')).toBe('loading');
    resolve([fakePart('misc-digital/fake-a', 'misc-digital'), fakePart('misc-digital/fake-b', 'misc-digital')]);
    await Promise.all([a, b]);
    expect(await c).toEqual([]);
    await loadGroup('misc-digital');
    await loadPack('test-lazy');
    expect(calls).toBe(1);
    expect(cataloguePacks().find((p) => p.id === 'test-lazy')).toMatchObject({ state: 'ready', loaded: 2, loads: 1 });
    expect(groupState('misc-digital')).toBe('ready');
    expect(getPart('misc-digital/fake-b')?.name).toBe('FAKE-B');
    expect(isBuiltinPart('misc-digital/fake-a')).toBe(true);
    expect(listParts().some((p) => p.id === 'misc-digital/fake-a')).toBe(true);
    expect(libraryVersion()).toBeGreaterThan(v0);
    expect(notified).toBeGreaterThan(0);
    off();
    expect(() => registerCataloguePack({ id: 'test-lazy', counts: {}, load: async () => [] })).toThrow(/already registered/);
  });

  it('a failed load can be retried and duplicates of known ids are dropped', async () => {
    let fail = true;
    registerCataloguePack({
      id: 'test-flaky',
      counts: { mixed: 1 },
      load: async () => {
        if (fail) throw new Error('network down');
        return [fakePart('mixed/flaky', 'mixed'), fakePart('basic/resistor', 'basic')];
      },
    });
    await loadPack('test-flaky');
    expect(cataloguePacks().find((p) => p.id === 'test-flaky')).toMatchObject({ state: 'error', error: 'network down' });
    expect(groupState('mixed')).toBe('error');
    fail = false;
    await loadGroup('mixed');
    const info = cataloguePacks().find((p) => p.id === 'test-flaky')!;
    expect(info).toMatchObject({ state: 'ready', loaded: 1, loads: 2 });
    // the hand-written resistor is never replaced by a pack part
    expect(getPart('basic/resistor')?.description).not.toBe('test part');
  });

  it('ensurePartsLoaded loads the group of an unknown id and reports ids that do not exist', async () => {
    expect(groupOfPartId('diodes/p6ke6.8a')).toBe('diodes');
    expect(groupOfPartId('custom:my-part')).toBeNull();
    expect(groupOfPartId('hier:abc')).toBeNull();
    const tvs = 'diodes/bzx55c5v1';
    expect(getPart(tvs)).toBeUndefined();
    const left = await ensurePartsLoaded([tvs, 'diodes/no-such-diode', 'basic/resistor']);
    expect(left).toEqual(['diodes/no-such-diode']);
    expect(getPart(tvs)?.group).toBe('diodes');
    expect(groupState('diodes')).toBe('ready');
    // other groups stay pending
    expect(groupState('ttl')).toBe('pending');
  });

  it('every real pack adds exactly the parts it declares, in its own groups, with unique ids', async () => {
    await loadAllGroups();
    expect(hasPendingPacks()).toBe(false);
    const ids = listParts().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const real = cataloguePacks().filter((p) => !p.id.startsWith('test-'));
    expect(real.map((p) => p.id)).toEqual(['basic-series', 'diodes', 'transistors', 'rf', 'connectors', 'logic', 'logic-more', 'analog-more', 'discretes-more', 'passives-more', 'sensors-more']);
    for (const pack of real) {
      expect(pack.state, pack.id).toBe('ready');
      expect(pack.loads, pack.id).toBe(1);
    }
    // per-group counts: the declared numbers are the loaded parts (update CATALOGUE_PACKS when a table grows)
    const core = new Set(ALL_PARTS.map((p) => p.id));
    const packParts = listParts().filter((p) => !core.has(p.id) && !p.description.startsWith('test part'));
    const declared: Record<string, number> = {};
    for (const pack of real) for (const [g, n] of Object.entries(pack.counts)) declared[g] = (declared[g] ?? 0) + (n ?? 0);
    const actual: Record<string, number> = {};
    for (const p of packParts) actual[p.group] = (actual[p.group] ?? 0) + 1;
    expect(actual).toEqual(declared);
    expect(packParts.every((p) => p.id.startsWith(`${p.group}/`))).toBe(true);
    expect(real.reduce((n, p) => n + p.loaded, 0)).toBe(packParts.length);
  });
});
