/**
 * Every text the component tools build from run-time keys exists in the catalogue (both
 * languages): maker titles, help, field labels and tooltips, select options, verification points,
 * notes and errors (read from the maker sources), symbol templates, wizard / part problems.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasMessage } from '../../i18n';
import { MAKERS, defaultMakerInput, runMaker } from '../../library/modelmaker';
import { SYMBOL_TEMPLATES } from '../../library/custom/templates';

const MAKER_DIR = join(__dirname, '../../library/modelmaker');
const sources = readdirSync(MAKER_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => readFileSync(join(MAKER_DIR, f), 'utf8'))
  .join('\n');

describe('component tool texts', () => {
  it('model makers: title, help, every field label / tooltip / option', () => {
    const missing: string[] = [];
    for (const m of MAKERS) {
      for (const k of [`maker.${m.id}.title`, `maker.${m.id}.help`]) if (!hasMessage(k)) missing.push(k);
      for (const f of m.fields) {
        for (const k of [`maker.${m.id}.${f.key}`, `tip.maker.${m.id}.${f.key}`]) if (!hasMessage(k)) missing.push(k);
        for (const o of f.options ?? []) if (!hasMessage(`maker.opt.${o}`)) missing.push(`maker.opt.${o}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('model makers: every check point, note and error id', () => {
    const ids = new Set<string>();
    for (const m of [...sources.matchAll(/\bid: '(\w+)'/g)]) ids.add(m[1]);
    const notes = [...sources.matchAll(/notes?\.push\(\{ id: '(\w+)'/g)].map((m) => m[1]);
    const errors = [...sources.matchAll(/new MakerInputError\('([\w.]+)'/g)].map((m) => m[1]);
    expect(notes.length).toBeGreaterThan(15);
    expect(errors.length).toBeGreaterThan(20);
    const missing = [
      ...notes.filter((n) => !hasMessage(`maker.note.${n}`)).map((n) => `maker.note.${n}`),
      ...errors.filter((e) => !hasMessage(`maker.error.${e}`)).map((e) => `maker.error.${e}`),
    ];
    for (const p of ['required', 'number', 'positive', 'range', 'option']) if (!hasMessage(`maker.error.field.${p}`)) missing.push(`maker.error.field.${p}`);
    // check ids of the default benches of every maker
    for (const m of MAKERS) {
      const { values, result } = runMaker(m, defaultMakerInput(m), 'MTEXT');
      for (const c of m.checks(values, result)) if (!hasMessage(`maker.check.${c.id}`)) missing.push(`maker.check.${c.id}`);
      for (const n of result.notes) if (!hasMessage(`maker.note.${n.id}`)) missing.push(`maker.note.${n.id}`);
    }
    expect([...new Set(missing)]).toEqual([]);
    expect(ids.size).toBeGreaterThan(40);
  });

  it('symbol templates, wizard and part problems', () => {
    const missing: string[] = [];
    for (const tp of SYMBOL_TEMPLATES) if (!hasMessage(`wiz.template.${tp.id}`)) missing.push(tp.id);
    const partSrc = readFileSync(join(__dirname, '../../library/custom/partDef.ts'), 'utf8') + readFileSync(join(__dirname, 'wizardModel.ts'), 'utf8');
    for (const m of partSrc.matchAll(/code: '(\w+)'/g)) if (!hasMessage(`parts.issue.${m[1]}`)) missing.push(`parts.issue.${m[1]}`);
    for (const m of partSrc.matchAll(/\| '(\w+)'/g)) if (/^[a-z]+[A-Z]/.test(m[1]) && !hasMessage(`parts.issue.${m[1]}`)) missing.push(`parts.issue.${m[1]}`);
    expect(missing).toEqual([]);
  });
});
