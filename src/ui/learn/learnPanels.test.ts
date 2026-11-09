/**
 * Server-side renders of the learning and report panels: the Lessons panel (list and lesson page,
 * both languages), the description box (rendered markup, formulas, questions, instructor locks),
 * the instructor dialog and the reports dialog. Every button and input explains itself on hover.
 * Also checks the lazily loaded text tables (same placeholders in Vietnamese and English).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { LessonsPanel, feedbackLine } from './LessonsPanel';
import { DescriptionBoxPanel } from './DescriptionBox';
import { InstructorDialog } from './InstructorDialog';
import { ReportsView } from '../reports/ReportsDialog';
import { actions } from '../store';
import { DesignBuilder } from '../../model/designkit';
import { setLang } from '../../i18n';
import { LEARN_UI } from '../../i18n/learnUi';
import { REPORT_UI } from '../../i18n/reportUi';
import { CLI_TEXT } from '../../i18n/cliText';
import { GUIDE_PAGES } from '../../i18n/helpGuides';
import { LESSONS } from '../../learn/lessons';

afterAll(() => setLang('vi'));

/** Buttons and form inputs without a tooltip (title). */
function untitled(html: string): string[] {
  return [...html.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)].filter((m) => !/\btitle="[^"]*\S/.test(m[2]) && !/type="hidden"/.test(m[2])).map((m) => m[0]);
}

describe('Lessons panel', () => {
  it('lists every lesson by level (Vietnamese)', () => {
    setLang('vi');
    const html = renderToStaticMarkup(createElement(LessonsPanel, {}));
    expect(html).toContain('Mạch điện cơ bản');
    expect(html).toContain('Định luật Ohm');
    expect(html).toContain('ADC và DAC');
    expect((html.match(/class="ms-lesson-row"/g) ?? []).length).toBe(LESSONS.length);
    expect(untitled(html)).toEqual([]);
  });

  it('shows a lesson: goal, theory with formulas, steps, hints and quiz (English)', () => {
    setLang('en');
    const html = renderToStaticMarkup(createElement(LessonsPanel, { lessonId: 'divider' }));
    expect(html).toContain('Use two resistors to get 4 V out of a 12 V source.');
    expect(html).toContain('ms-math-frac');
    expect(html).toContain('Choose R1 and R2 so the meter reads 4 V');
    expect(html).toContain('R1 = R2 with a 10 V source.');
    expect(html).toContain('Start the lesson');
    expect(untitled(html)).toEqual([]);
  });

  it('writes check feedback with values and localized nouns', () => {
    setLang('vi');
    expect(feedbackLine({ id: 'measured', params: { value: '6 V', target: '4 V', tol: 3 } }, 'vi')).toBe('Đo được 6 V; cần 4 V ± 3 %.');
    expect(feedbackLine({ id: 'needPart', params: { part: { noun: 'meter' } } }, 'en')).toBe('There is no multimeter on the schematic yet.');
    expect(feedbackLine({ id: 'note:kcl', params: { main: '5 mA', a: '3 mA', b: '2 mA' } }, 'vi')).toBe('Định luật nút đúng: 5 mA = 3 mA + 2 mA.');
    const erc = JSON.stringify({ severity: 'error', code: 'no-ground', message: 'The circuit has no ground', detail: { id: 'noGround' } });
    expect(feedbackLine({ id: 'ercError', params: { erc } }, 'vi')).toMatch(/^Mạch còn lỗi: /);
  });
});

describe('description box', () => {
  it('renders the markup, the pictures and the questions; the instructor can hide the answers', () => {
    setLang('vi');
    const b = new DesignBuilder('Bài tập');
    b.design.descriptionBox = {
      text: '## Đo cầu phân áp\nTính $V_{out} = \\frac{R_2}{R_1 + R_2} V_{in}$\n![sơ đồ](img:img1)',
      images: [{ id: 'img1', src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'sơ đồ' }],
      questions: [
        { id: 'q1', kind: 'number', prompt: 'Vout = ?', answer: '4', unit: 'V' },
        { id: 'q2', kind: 'choice', prompt: 'R2 nối với?', options: ['đất', 'nguồn'], answer: '0' },
      ],
      answers: { q1: '4,0' },
    };
    actions.loadDesign(b.design, 'bt.msim');
    let html = renderToStaticMarkup(createElement(DescriptionBoxPanel));
    expect(html).toContain('<h4>Đo cầu phân áp</h4>');
    expect(html).toContain('ms-math-frac');
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('value="4,0"');
    expect(html).toContain('Kiểm tra');
    expect(html).toContain('Sửa');
    expect(untitled(html)).toEqual([]);
    actions.loadDesign({ ...b.design, restrictions: { passwordHash: '0'.repeat(64), salt: '0'.repeat(32), iterations: 1000, hideAnswers: true, lockDescription: true } }, 'bt.msim');
    html = renderToStaticMarkup(createElement(DescriptionBoxPanel));
    expect(html).not.toContain('>Kiểm tra<');
    expect(html).not.toContain('>Sửa<');
    expect(html).toContain('Giảng viên đã khoá hộp mô tả');
  });
});

describe('instructor and reports dialogs', () => {
  it('instructor dialog asks for a password and lists the analyses and instruments', () => {
    setLang('en');
    actions.loadDesign(new DesignBuilder('x').design, 'x.msim');
    const html = renderToStaticMarkup(createElement(InstructorDialog, { close: () => {} }));
    expect(html).toContain('type="password"');
    expect(html).toContain('Hide part values');
    expect(html).toContain('Transient');
    expect(html).toContain('Oscilloscope');
    // the dialog frame's own close button is labelled by aria-label
    expect(untitled(html).filter((t) => !t.includes('aria-label='))).toEqual([]);
  });

  it('reports dialog shows the BOM of the open design', () => {
    setLang('en');
    const b = new DesignBuilder('Board');
    b.part('basic/resistor', 'R1', 0, 0, { value: '4.7k' });
    b.part('basic/resistor', 'R2', 100, 0, { value: '4.7k' });
    actions.loadDesign(b.design, 'board.msim');
    const html = renderToStaticMarkup(createElement(ReportsView, { initial: 'bom', close: () => {} }));
    expect(html).toContain('Bill of materials');
    expect(html).toContain('Manufacturer');
    expect(html).toContain('R1, R2');
    expect(html).toContain('Export CSV');
  });
});

describe('lazy text tables', () => {
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  it('every entry has both languages with the same placeholders', () => {
    for (const table of [LEARN_UI, REPORT_UI, CLI_TEXT] as Record<string, readonly [string, string]>[]) {
      for (const [key, [vi, en]] of Object.entries(table)) {
        expect(vi.trim(), key).not.toBe('');
        expect(en.trim(), key).not.toBe('');
        expect(ph(vi), key).toBe(ph(en));
      }
    }
    for (const page of Object.values(GUIDE_PAGES)) for (const s of [page.title, ...page.sections.flatMap((x) => [x.heading, x.body])]) expect(s.vi && s.en && s.vi !== s.en).toBeTruthy();
  });
});
