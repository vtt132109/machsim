/**
 * Native dialog texts of the Electron shell: one JSON source with both languages, and
 * desktop/main.cjs takes every dialog string from it (no hard-coded prose).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import strings from './desktop-strings.json';

const MAIN = readFileSync(join(__dirname, '..', '..', 'desktop', 'main.cjs'), 'utf8');
const PRELOAD = readFileSync(join(__dirname, '..', '..', 'desktop', 'preload.cjs'), 'utf8');
const SYNC = readFileSync(join(__dirname, '..', '..', 'desktop', 'scripts', 'sync-app.cjs'), 'utf8');

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

describe('desktop native dialog strings', () => {
  it('has the same keys and placeholders in Vietnamese and English', () => {
    expect(Object.keys(strings.vi).sort()).toEqual(Object.keys(strings.en).sort());
    for (const k of Object.keys(strings.vi) as (keyof typeof strings.vi)[]) {
      expect(strings.vi[k].trim(), k).not.toBe('');
      expect(holes(strings.vi[k]), k).toBe(holes(strings.en[k]));
    }
  });

  it('main.cjs uses only known keys and no hard-coded dialog prose', () => {
    const used = [...MAIN.matchAll(/\bs\('(\w+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((k) => !(k in strings.vi))).toEqual([]);
    // Vietnamese letters in a string literal would mean a hard-coded dialog text
    const literals = [...MAIN.matchAll(/'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
    expect(literals.filter((l) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(l))).toEqual([]);
    for (const title of ["buttons: [s('quitWithoutSaving'), s('cancel')]", "message: s('unsavedMessage')"]) expect(MAIN).toContain(title);
  });

  it('the renderer can report its language and the sync step ships the strings', () => {
    expect(PRELOAD).toContain("setLanguage: (lang) => ipcRenderer.send('machsim:set-language'");
    expect(MAIN).toContain("ipcMain.on('machsim:set-language'");
    expect(SYNC).toContain("'desktop-strings.json'");
    expect(SYNC).toContain("'i18n-desktop.json'");
  });
});
