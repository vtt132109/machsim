/**
 * Messages shown when a design file cannot be opened: a plain-language summary in the UI
 * language comes before the validator's technical list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { parseDesign, DesignFormatError } from '../../model/serialize';
import { designErrorSummary, designForSave, registerSaveTransform, unsavedChangesMessage } from './document';
import { newDesign } from '../../model/types';
import { serializeDesign } from '../../model/serialize';
import { displayFileName, UNTITLED_FILE_NAME } from './files';

function issuesOf(text: string): string[] {
  try {
    parseDesign(text);
  } catch (e) {
    if (e instanceof DesignFormatError) return e.issues;
  }
  throw new Error('parsed');
}

describe('open errors in the UI language', () => {
  afterEach(() => setLang('vi'));

  it('explains a damaged file, a non-design file and a file from a newer version', () => {
    setLang('vi');
    expect(designErrorSummary(issuesOf('{"format": "machsim-design", "version": 2, "sheets": ['))).toMatch(/^Tệp bị hỏng/);
    expect(designErrorSummary(issuesOf('{"hello": 1}'))).toMatch(/^Đây không phải tệp thiết kế MachSim/);
    expect(designErrorSummary(issuesOf('{"format": "machsim-design", "version": 999, "sheets": []}'))).toContain('định dạng 999');
    setLang('en');
    expect(designErrorSummary(['sheets[0].parts[2].x: expected a number'])).toBe('The design file has 1 problem(s), so it cannot be opened. It may have been edited by hand or damaged.');
  });

  it('shows a new document under its name in the UI language', () => {
    setLang('vi');
    expect(displayFileName(UNTITLED_FILE_NAME)).toBe('Chưa đặt tên.msim');
    setLang('en');
    expect(displayFileName(UNTITLED_FILE_NAME)).toBe('Untitled.msim');
    expect(displayFileName('Amp.msim')).toBe('Amp.msim');
  });

  it('names an unsaved new document the same way in the prompt as in the title bar', () => {
    setLang('vi');
    const vi = unsavedChangesMessage(UNTITLED_FILE_NAME, 'mở thiết kế khác');
    expect(vi).toBe('“Chưa đặt tên.msim” có thay đổi chưa lưu. Lưu lại trước khi mở thiết kế khác?');
    expect(vi).not.toContain('Untitled');
    // the default action is translated too (no raw English "continue")
    expect(unsavedChangesMessage(UNTITLED_FILE_NAME)).toContain('tiếp tục');
    setLang('en');
    expect(unsavedChangesMessage(UNTITLED_FILE_NAME, 'open another design')).toBe('“Untitled.msim” has unsaved changes. Save them before you open another design?');
    expect(unsavedChangesMessage('Amp.msim')).toContain('Amp.msim');
  });
});

describe('what Save writes', () => {
  it('stamps created / modified / savedBy and keeps the first creation time', () => {
    const first = designForSave(newDesign('A'), new Date('2026-11-01T08:00:00Z'));
    expect(first.meta).toEqual({ created: '2026-11-01T08:00:00.000Z', modified: '2026-11-01T08:00:00.000Z', savedBy: expect.stringMatching(/^MachSim \d+\.\d+\.\d+$/) });
    const again = designForSave(first, new Date('2026-11-09T09:30:00Z'));
    expect(again.meta?.created).toBe('2026-11-01T08:00:00.000Z');
    expect(again.meta?.modified).toBe('2026-11-09T09:30:00.000Z');
    // the stamp survives the file format
    expect(parseDesign(serializeDesign(again)).meta).toEqual(again.meta);
  });

  it('applies registered save transforms (e.g. Grapher pages) before stamping', () => {
    const off = registerSaveTransform((d) => ({ ...d, description: 'kept by a transform' }));
    try {
      expect(designForSave(newDesign('B')).description).toBe('kept by a transform');
    } finally {
      off();
    }
    expect(designForSave(newDesign('B')).description).toBeUndefined();
  });
});
