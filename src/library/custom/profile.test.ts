/**
 * "My library" profile: favourites, recent parts and the user database in one file.
 */
import { describe, expect, it } from 'vitest';
import { buildProfile, mergeProfile, parseProfile, ProfileFormatError, serializeProfile, PROFILE_FORMAT } from './profile';
import { newDatabase } from './database';
import { boxSymbol } from '../symbols';
import type { CustomPartData, PartDatabase } from './types';

const part = (id: string, name: string, modified: string): CustomPartData => ({
  id,
  name,
  group: 'misc',
  family: 'User',
  description: `${name} for the profile test`,
  prefix: 'U',
  symbol: boxSymbol({ left: [{ name: 'A' }], right: [{ name: 'B' }] }),
  model: { kind: 'none' },
  modified,
});

const db = (...parts: CustomPartData[]): PartDatabase => ({ ...newDatabase('user'), parts });

describe('library profile', () => {
  it('writes and reads back favourites, recent parts and the user database', () => {
    const user = db(part('custom:lab-amp', 'Lab amp', '2026-10-01T00:00:00.000Z'));
    const p = buildProfile({ favourites: ['basic/resistor', 'diodes/1n4148', 'basic/resistor'], recent: ['transistors/bc547b'], user, savedBy: 'MachSim test', now: new Date('2026-11-09T08:00:00Z') });
    expect(p).toMatchObject({ format: PROFILE_FORMAT, version: 1, favourites: ['basic/resistor', 'diodes/1n4148'], created: '2026-11-09T08:00:00.000Z', savedBy: 'MachSim test' });
    const back = parseProfile(serializeProfile(p));
    expect(back).toEqual(p);
    expect(back.user?.parts.map((x) => x.id)).toEqual(['custom:lab-amp']);
    expect(back.corporate).toBeUndefined();
  });

  it('rejects other files and reports damaged contents with their paths', () => {
    expect(() => parseProfile('{nope')).toThrow(ProfileFormatError);
    expect(() => parseProfile(JSON.stringify({ format: 'machsim-partdb', version: 1 }))).toThrow(/not a MachSim library profile/);
    expect(() => parseProfile(JSON.stringify({ format: PROFILE_FORMAT, version: 99 }))).toThrow(/version/);
    try {
      parseProfile(JSON.stringify({ format: PROFILE_FORMAT, version: 1, favourites: ['ok', 3], user: { format: 'machsim-partdb', version: 1, parts: [{ id: 'custom:x' }] } }));
      throw new Error('should fail');
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileFormatError);
      const issues = (e as ProfileFormatError).issues.join('\n');
      expect(issues).toMatch(/favourites\[1\]/);
      expect(issues).toMatch(/^user: parts\[0\]/m);
    }
  });

  it('merges into the lists and the database of another computer', () => {
    const mine = db(part('custom:a', 'A (mine, newer)', '2026-11-01T00:00:00.000Z'), part('custom:b', 'B', '2026-01-01T00:00:00.000Z'));
    const theirs = db(part('custom:a', 'A (older)', '2026-10-01T00:00:00.000Z'), part('custom:c', 'C', '2026-10-05T00:00:00.000Z'));
    const incoming = buildProfile({ favourites: ['x/2', 'x/1'], recent: ['r/9', 'r/1'], user: theirs });
    const m = mergeProfile({ favourites: ['x/1'], recent: ['r/1', 'r/2'], user: mine, corporate: newDatabase('corporate') }, incoming, 'newer', 3);
    expect(m.favourites).toEqual(['x/1', 'x/2']);
    expect(m.addedFavourites).toBe(1);
    expect(m.recent).toEqual(['r/9', 'r/1', 'r/2']);
    expect(m.user).toMatchObject({ added: 1, updated: 0, skipped: 1 });
    expect(m.user!.db.parts.find((p) => p.id === 'custom:a')!.name).toBe('A (mine, newer)');
    expect(m.corporate).toBeUndefined();
    // "replace" takes the imported copy
    const r = mergeProfile({ favourites: [], recent: [], user: mine, corporate: newDatabase('corporate') }, incoming, 'replace');
    expect(r.user!.db.parts.find((p) => p.id === 'custom:a')!.name).toBe('A (older)');
  });
});
