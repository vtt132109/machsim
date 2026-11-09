/**
 * Lazily loaded text tables of the file features and the sample browser: every entry in both
 * languages with the same {placeholders}, and the help guides of the file features present.
 */
import { describe, expect, it } from 'vitest';
import { FILES_TEXT, ft } from './filesText';
import { SAMPLE_TEXT, SAMPLE_TOPIC_TEXT, SAMPLE_UI } from './samples';
import { GUIDE_ORDER, GUIDE_PAGES } from './helpGuides';
import { setLang } from './core';
import type { LocalizedText } from './core';

const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function check(name: string, text: LocalizedText): void {
  expect(text.vi.trim(), name).not.toBe('');
  expect(text.en.trim(), name).not.toBe('');
  expect(ph(text.vi), name).toBe(ph(text.en));
}

describe('file feature texts', () => {
  it('has both languages with the same placeholders', () => {
    for (const [k, v] of Object.entries(FILES_TEXT)) check(k, v);
    for (const [k, v] of Object.entries(SAMPLE_UI)) check(k, v);
    for (const [k, v] of Object.entries(SAMPLE_TOPIC_TEXT)) {
      check(`${k}.title`, v.title);
      check(`${k}.desc`, v.desc);
    }
    for (const [k, v] of Object.entries(SAMPLE_TEXT)) {
      check(`${k}.title`, v.title);
      check(`${k}.summary`, v.summary);
    }
  });

  it('fills placeholders in the UI language', () => {
    setLang('en');
    expect(ft('snippetPlaced', { n: 3, w: 4 })).toBe('Placed the snippet: 3 parts, 4 wires.');
    setLang('vi');
    expect(ft('snippetPlaced', { n: 3, w: 4 })).toBe('Đã đặt snippet: 3 linh kiện, 4 dây.');
  });

  it('documents every file feature in the help guides', () => {
    for (const id of ['samples', 'snippets', 'fileSafety', 'exchange', 'measurements'] as const) {
      expect(GUIDE_ORDER).toContain(id);
      expect(GUIDE_PAGES[id].sections.length).toBeGreaterThan(0);
    }
  });
});
