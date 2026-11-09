import { describe, expect, it } from 'vitest';
import type { AnalysisSpec } from '../../sim/netlist';
import { canRun, canSave, cleanOptions, draftIssues, ensureSpec, initialDraft, issueCounts } from './dialogModel';
import { parseFieldText, parseNumberList } from './fields';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

describe('analysis dialog model', () => {
  const tran: AnalysisSpec = { type: 'tran', tstep: 1e-5, tstop: 1e-2 };

  it('deep-copies the settings and adds a spec for the active analysis', () => {
    const specs = { tran, ac: { type: 'tran', tstep: 1, tstop: 2 } as AnalysisSpec };
    const d = initialDraft(specs, 'dc', { sources: ['V5'] });
    expect(d.tran).toEqual(tran);
    expect(d.tran).not.toBe(tran);
    // a spec stored under the wrong key is dropped
    expect(d.ac).toBeUndefined();
    expect(d.dc).toMatchObject({ type: 'dc', src: 'V5' });
  });

  it('creates missing specs on demand without touching existing ones', () => {
    const d = initialDraft({ tran }, 'tran');
    const same = ensureSpec(d, 'tran');
    expect(same.draft).toBe(d);
    const added = ensureSpec(d, 'noise', { outputs: ['V(o)'], sources: ['V1'] });
    expect(added.spec).toMatchObject({ type: 'noise', output: 'o', src: 'V1' });
    expect(added.draft.tran).toBe(d.tran);
    expect(d.noise).toBeUndefined();
  });

  it('gates Save and Run on errors but not on warnings', () => {
    const good = initialDraft({ tran }, 'tran');
    const okIssues = draftIssues(good, {});
    expect(canSave(okIssues)).toBe(true);
    expect(canRun(good, 'tran', okIssues)).toBe(true);
    expect(canRun(good, 'ac', okIssues)).toBe(false);

    const bad = { ...good, ac: { type: 'ac', sweep: 'dec', points: 0, fstart: 1, fstop: 10 } as AnalysisSpec };
    const badIssues = draftIssues(bad, {});
    expect(canSave(badIssues)).toBe(false);
    expect(issueCounts(badIssues)).toEqual({ errors: 1, warnings: 0 });

    const warnOnly = draftIssues(good, { reltol: 0.05 });
    expect(canSave(warnOnly)).toBe(true);
    expect(issueCounts(warnOnly)).toEqual({ errors: 0, warnings: 1 });
    expect(canSave(draftIssues(good, { itl1: 0 }))).toBe(false);
  });

  it('drops unset options', () => {
    expect(cleanOptions({ temp: 50, reltol: undefined, gmin: Number.NaN, method: 'gear' })).toEqual({ temp: 50, method: 'gear' });
  });
});

describe('dialog field parsing', () => {
  it('parses numbers with units, bounds and percent', () => {
    expect(parseFieldText('10k', {})).toEqual({ value: 1e4 });
    expect(parseFieldText('2.2 uF', {})).toEqual({ value: 2.2e-6 });
    expect(parseFieldText('1M', {})).toEqual({ value: 1e6 });
    expect(parseFieldText('', { optional: true })).toEqual({ value: undefined });
    expect(parseFieldText('', {})).toEqual({ error: 'Required' });
    expect(parseFieldText('abc', {})).toEqual({ error: 'Not a number' });
    expect(parseFieldText('2.5', { integer: true })).toEqual({ error: 'Must be a whole number' });
    expect(parseFieldText('0', { min: 0, exclusiveMin: true })).toEqual({ error: 'Must be greater than 0' });
    expect(parseFieldText('150', { max: 100 })).toEqual({ error: 'Must be at most 100' });
    expect(parseFieldText('5%', { percent: true })).toEqual({ value: 0.05 });
    expect(parseFieldText('120', { percent: true, max: 0.999999 })).toEqual({ error: 'Must be at most 99.9999' });
  });

  it('parses value lists', () => {
    expect(parseNumberList('1k, 2.2k 4.7k;10k')).toEqual({ values: [1e3, 2.2e3, 4.7e3, 1e4] });
    expect(parseNumberList('1, x, 3')).toEqual({ values: [1], error: "'x' is not a number" });
    expect(parseNumberList('  ')).toEqual({ values: [] });
  });
});
