/**
 * Round 4 step 9: the learner help brought up to date.
 *
 *  - Getting started and What's new tell the truth about round 4 (the lesson count in the text is
 *    the real lesson count, the new sections exist in both languages);
 *  - F1 inside the new tool windows (audio, 8051 editor, scripts, lessons, description box) opens
 *    their guide page, and every dialog that offers a help button names a page that exists.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GETTING_STARTED } from '../../../src/i18n/help';
import { GUIDE_ORDER, GUIDE_PAGES } from '../../../src/i18n/helpGuides';
import { LESSONS } from '../../../src/learn/lessons';
import { newDesign } from '../../../src/model/types';
import { closeFloatingWindow, floating, openFloatingWindow } from '../../../src/ui/app/extensions';
import { DESIGN_EXAMPLES } from '../../../src/ui/integration/examples';
import { contextTopic } from '../../../src/ui/help/open';

const text = (l: { vi: string; en: string }): string => `${l.vi}\n${l.en}`;

describe('Getting started and What is new', () => {
  it('walks on to several designs, printing, debugging, sound and scripts', () => {
    expect(GETTING_STARTED.length).toBeGreaterThanOrEqual(18);
    const titles = GETTING_STARTED.map((s) => s.title.vi);
    expect(new Set(titles).size).toBe(titles.length);
    const last = GETTING_STARTED.slice(-2);
    expect(last[0].title.vi).toContain('16.');
    expect(last[1].title.vi).toContain('17.');
    for (const s of last) {
      expect(s.body.vi.length).toBeGreaterThan(200);
      expect(s.body.en.length).toBeGreaterThan(200);
      expect(s.action).toBeDefined();
    }
    const words = last.map((s) => text(s.body)).join(' ');
    for (const w of ['Ctrl+P', 'Thẻ tham khảo nhanh', 'Quick-reference card', 'F11', 'Tập lệnh', 'Scripts']) expect(words).toContain(w);
  });

  it('the lesson count in the texts is the real lesson count', () => {
    const n = String(LESSONS.length);
    const lessons = GETTING_STARTED.find((s) => s.title.vi.startsWith('15.'))!;
    expect(lessons.body.vi).toContain(`có ${n} bài`);
    expect(lessons.body.en).toContain(`has ${n} lessons`);
    const news = GUIDE_PAGES.whatsNew.sections.map((s) => text(s.body)).join('\n');
    expect(news).toContain(`nay có ${n} bài`);
    expect(news).toContain(`now holds ${n} lessons`);
  });

  it('the sample counts in the texts are not more than the shipped samples', () => {
    const news = GUIDE_PAGES.whatsNew.sections.map((s) => s.body.vi).join('\n');
    const m = /(\d+) mạch mẫu cùng (\d+) tệp SPICE/.exec(news);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(DESIGN_EXAMPLES.length);
    expect(Number(m![1])).toBeGreaterThanOrEqual(70);
  });

  it('has five round-4 sections, in both languages, naming the new features', () => {
    const sections = GUIDE_PAGES.whatsNew.sections.filter((s) => s.heading.vi.startsWith('Vòng 4'));
    expect(sections).toHaveLength(5);
    for (const s of sections) {
      expect(s.heading.en.startsWith('Round 4')).toBe(true);
      expect(s.body.vi.length).toBeGreaterThan(300);
      expect(s.body.en.length).toBeGreaterThan(300);
    }
    const all = sections.map((s) => text(s.body)).join('\n');
    for (const w of ['.step', 'KiCad', 'TDMS', 'WAV', 'EKV', 'Jiles', 'I²t', '--script', 'Quick-reference card', 'X2.XMM1']) expect(all, w).toContain(w);
    // the round-4 sections come before the older ones
    expect(GUIDE_PAGES.whatsNew.sections[0].heading.vi.startsWith('Vòng 4')).toBe(true);
    expect(GUIDE_ORDER[0]).toBe('whatsNew');
  });
});

describe('F1 in the new windows and dialogs', () => {
  afterEach(() => {
    for (const w of [...floating.getState().windows]) closeFloatingWindow(w.id);
  });

  const state = { design: newDesign('x'), selection: [] };

  it.each([
    ['audio', 'audio'],
    ['mcu', 'mcu'],
    ['script', 'scripting'],
    ['lessons', 'lessons'],
    ['description', 'description'],
  ])('F1 in the %s window opens the %s guide', (kind, page) => {
    openFloatingWindow(kind, { refdes: 'U1' });
    expect(contextTopic(state)).toEqual({ kind: 'guide', page });
  });

  it('F1 with no window falls back to the help index', () => {
    expect(contextTopic(state)).toEqual({ kind: 'index' });
  });

  it('every guide="…" a dialog passes names a guide page that exists', () => {
    const found: { file: string; page: string }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.tsx')) for (const m of readFileSync(p, 'utf8').matchAll(/\bguide="([A-Za-z]+)"/g)) found.push({ file: p, page: m[1] });
      }
    };
    walk(join(__dirname, '../../../src/ui'));
    // the round-4 dialogs that explain themselves: layers, name prefixes, print preview, WAV export
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const f of found) expect(Object.keys(GUIDE_PAGES), `${f.file}: ${f.page}`).toContain(f.page);
    expect(new Set(found.map((f) => f.page))).toEqual(new Set(['editingTools', 'printing', 'audio']));
  });
});
