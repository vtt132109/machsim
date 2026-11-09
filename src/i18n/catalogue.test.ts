/**
 * Message catalogue integrity: both languages present for every key, matching placeholders, no
 * duplicate keys between sections, every dynamically built key family complete, and the core
 * helpers (t, plural groups, language switching, lazyRecord) behave.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisType } from '../sim/netlist';
import type { ErcMessage, InstrumentKind } from '../model/types';
import { GROUPS } from '../library';
import { MESSAGES, SECTIONS } from './messages';
import { getLang, hasMessage, interpolate, joinList, lazyRecord, localeTag, setLang, subscribeLang, t, tIn, tr, L } from './index';

const ANALYSES: AnalysisType[] = ['op', 'tran', 'ac', 'dc', 'acsingle', 'noise', 'noisefig', 'four', 'disto', 'tf', 'sens', 'pz', 'paramsweep', 'tempsweep', 'nestedsweep', 'montecarlo', 'worstcase', 'tracewidth', 'batch'];
const INSTRUMENTS: InstrumentKind[] = ['multimeter', 'function-generator', 'oscilloscope', 'oscilloscope-4ch', 'bode-plotter', 'wattmeter', 'frequency-counter', 'iv-analyzer', 'spectrum-analyzer', 'network-analyzer', 'distortion-analyzer', 'logic-analyzer', 'word-generator', 'logic-converter', 'current-clamp', 'bench-generator', 'bench-multimeter', 'bench-scope', 'mixed-signal-scope'];
const ERC_CODES: ErcMessage['code'][] = ['no-ground', 'floating-pin', 'single-pin-net', 'duplicate-refdes', 'unknown-part', 'bad-param', 'voltage-loop', 'current-cutset', 'dangling-wire', 'other'];

/** Placeholder names of a message; an English plural group {n|one|other} counts as {n}. */
function placeholders(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)) names.add(m[1]);
  return [...names].sort();
}

afterEach(() => setLang('vi'));

describe('message catalogue', () => {
  const entries = Object.entries(MESSAGES as Record<string, readonly [string, string]>);

  it('has a large, complete catalogue: every key in Vietnamese and English', () => {
    expect(entries.length).toBeGreaterThan(1500);
    const missing = entries.filter(([, [vi, en]]) => !vi.trim() || !en.trim()).map(([k]) => k);
    expect(missing).toEqual([]);
  });

  it('uses the same placeholders in both languages', () => {
    const bad = entries.filter(([, [vi, en]]) => placeholders(vi).join() !== placeholders(en).join()).map(([k, [vi, en]]) => `${k}: ${vi} | ${en}`);
    expect(bad).toEqual([]);
  });

  it('has no key defined in two sections', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [section, cat] of Object.entries(SECTIONS)) {
      for (const k of Object.keys(cat)) {
        if (seen.has(k)) dup.push(`${k} (${seen.get(k)} and ${section})`);
        seen.set(k, section);
      }
    }
    expect(dup).toEqual([]);
  });

  it('is really translated: most Vietnamese texts differ from the English ones', () => {
    const same = entries.filter(([, [vi, en]]) => vi === en).length;
    expect(same / entries.length).toBeLessThan(0.12);
  });

  it('covers every dynamically built key family', () => {
    const need: string[] = [];
    for (const a of ANALYSES) need.push(`analysis.name.${a}`, `analysis.title.${a}`, `analysis.desc.${a}`, `results.type.${a}`);
    for (const k of INSTRUMENTS) need.push(`instrument.${k}`);
    for (const g of GROUPS) need.push(`group.${g.id}`);
    for (const c of ERC_CODES) need.push(`erc.rule.${c}`);
    for (const p of ['voltage', 'current', 'power', 'differential', 'digital']) need.push(`probe.kind.${p}`);
    for (const s of ['idle', 'running', 'paused', 'error']) need.push(`sim.state.${s}`);
    for (const s of ['engine', 'simulation', 'netlister', 'spice', 'erc', 'annotate', 'examples', 'export', 'shell']) need.push(`sim.source.${s}`);
    for (const s of ['error', 'warning', 'info']) need.push(`erc.severity.${s}`);
    for (const k of ['singularNode', 'singular', 'timestep', 'noconv', 'aborted', 'noGround', 'unsupported', 'notFound', 'badSetting', 'generic'])
      for (const part of ['title', 'why', 'fix']) need.push(`sim.err.${k}.${part}`);
    expect(need.filter((k) => !hasMessage(k))).toEqual([]);
  });

  it('explains every ERC detail id the netlister and ERC produce', () => {
    const src = ['../model/erc.ts', '../model/netlister.ts'].map((f) => readFileSync(join(__dirname, f), 'utf8')).join('\n');
    const ids = new Set<string>();
    for (const m of src.matchAll(/detail\('(\w+)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/detail: \{ id: '(\w+)'/g)) ids.add(m[1]);
    for (const m of src.matchAll(/'(railConflict|elementConflict|shortedInductor|shorted)'/g)) ids.add(m[1]);
    expect(ids.size).toBeGreaterThan(30);
    const missing = [...ids].flatMap((id) => ['title', 'why', 'fix'].map((p) => `erc.${id}.${p}`)).filter((k) => !hasMessage(k));
    expect(missing).toEqual([]);
  });
});

describe('t() and the language state', () => {
  it('defaults to Vietnamese and switches to English', () => {
    expect(getLang()).toBe('vi');
    expect(t('common.close')).toBe('Đóng');
    expect(tIn('en', 'common.close')).toBe('Close');
    setLang('en');
    expect(t('common.close')).toBe('Close');
    expect(t('menu.file')).toBe('File');
  });

  it('fills placeholders and English plural groups', () => {
    expect(t('annotate.done', { n: 3 })).toBe('Đã đặt ký hiệu cho 3 linh kiện.');
    setLang('en');
    expect(t('annotate.done', { n: 1 })).toBe('Annotated 1 part.');
    expect(t('annotate.done', { n: 4 })).toBe('Annotated 4 parts.');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(interpolate('no params {x}')).toBe('no params {x}');
  });

  it('notifies listeners once per real change', () => {
    let calls = 0;
    const off = subscribeLang(() => calls++);
    setLang('vi');
    setLang('en');
    setLang('en');
    setLang('vi');
    off();
    setLang('en');
    expect(calls).toBe(2);
  });

  it('lazyRecord answers in the current language', () => {
    const rec = lazyRecord(['file', 'edit'] as const, (k) => t(`menu.${k}`));
    expect(rec.file).toBe('Tệp');
    setLang('en');
    expect(rec.file).toBe('File');
    expect(Object.keys(rec)).toEqual(['file', 'edit']);
  });

  it('picks one side of a {vi, en} pair and joins lists per language', () => {
    const x = L('xin chào', 'hello');
    expect(tr(x)).toBe('xin chào');
    expect(tr(x, 'en')).toBe('hello');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b và c');
    expect(joinList(['a', 'b'], 'en')).toBe('a and b');
  });

  it('formats dates in the UI language', () => {
    expect(localeTag()).toBe('vi-VN');
    expect(localeTag('en')).toBe('en-US');
    const d = new Date(2026, 10, 8, 21, 6, 18);
    expect(d.toLocaleDateString(localeTag('vi'))).toBe('8/11/2026');
    expect(d.toLocaleDateString(localeTag('en'))).toBe('11/8/2026');
  });

  it('keeps SPICE number formatting in both languages (decimal point, engineering suffixes)', async () => {
    const { formatEng } = await import('../util/units');
    const vi = formatEng(1234.5, 'Ω', 3);
    setLang('en');
    expect(formatEng(1234.5, 'Ω', 3)).toBe(vi);
    expect(vi).toMatch(/^1\.23 kΩ$/);
  });
});
