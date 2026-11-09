/**
 * The component-tool dialogs render (server-side, both languages) at every wizard step and for
 * every model source, the database manager in each view and the SPICE import and symbol editor:
 * every input, select, textarea and button explains itself (title, or an accessible name inside a
 * titled element), and the main texts are in the chosen language.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { newDatabase, upsertPart, addField } from '../../library/custom/database';
import { templateSymbol } from '../../library/custom/templates';
import { ComponentWizard } from './ComponentWizard';
import { DatabaseManager } from './DatabaseManager';
import { SpiceImportDialog } from './SpiceImportDialog';
import { SymbolEditor } from './SymbolEditor';
import { commitDatabase, installPartDatabases, memoryDbStorage, resetPartDatabases } from './partDatabases';
import { WIZARD_STEPS, newWizard, setBuiltin, setModelSource, setSpice } from './wizardModel';

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'col', 'area', 'source', 'wbr']);
const CONTROLS = new Set(['input', 'select', 'textarea', 'button']);

/** Controls with neither a title nor an aria-label of their own or of an enclosing element. */
function unexplained(html: string): string[] {
  const stack: { tag: string; titled: boolean }[] = [];
  const out: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, close, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const titled = /\s(title|aria-label)="[^"]*\S[^"]*"/.test(attrs);
    if (CONTROLS.has(tag) && !titled && !stack.some((e) => e.titled) && !/type="hidden"/.test(attrs)) out.push(`<${tag}${attrs.slice(0, 80)}>`);
    if (!VOID.has(tag) && !attrs.endsWith('/')) stack.push({ tag, titled });
  }
  return out;
}

const close = () => undefined;

afterEach(() => resetPartDatabases());
afterAll(() => setLang('vi'));

describe('component wizard renders', () => {
  for (const lang of ['vi', 'en'] as const) {
    it(`every step and model source (${lang})`, () => {
      setLang(lang);
      const states = [
        newWizard(),
        { ...newWizard({ maker: 'bjt' }), name: 'Q test' },
        { ...setSpice(setModelSource(newWizard(), 'spice'), '.subckt A x y\nR1 x y 1k\n.ends', 'A'), name: 'Sub' },
        { ...setBuiltin(setModelSource(newWizard(), 'builtin'), 'basic/resistor'), name: 'R' },
      ];
      for (const base of states) {
        for (let step = 0; step < WIZARD_STEPS.length; step++) {
          const html = renderToStaticMarkup(createElement(ComponentWizard, { init: { ...base, step }, close }));
          expect(unexplained(html), `step ${WIZARD_STEPS[step]} source ${base.source}`).toEqual([]);
          expect(html).toContain(lang === 'vi' ? 'Trình tạo linh kiện' : 'Component wizard');
        }
      }
      const maker = renderToStaticMarkup(createElement(ComponentWizard, { init: { ...newWizard({ maker: 'opamp' }), step: 4 }, close }));
      expect(maker).toContain(lang === 'vi' ? 'Tích độ lợi–băng thông GBW' : 'Gain-bandwidth product GBW');
      expect(maker).toContain(lang === 'vi' ? 'Tính mô hình' : 'Fit the model');
    });
  }
});

describe('database manager, SPICE import and symbol editor render', () => {
  it('database manager: master, corporate and user views with fields', async () => {
    await installPartDatabases(memoryDbStorage());
    const part = { id: 'custom:x', name: 'X part', group: 'diodes' as const, family: 'Mine', description: 'd', prefix: 'D', symbol: templateSymbol('diode'), model: { kind: 'none' as const } };
    await commitDatabase('user', addField(upsertPart(newDatabase('user'), part), 'Manufacturer'));
    for (const lang of ['vi', 'en'] as const) {
      setLang(lang);
      const html = renderToStaticMarkup(createElement(DatabaseManager, { close }));
      expect(unexplained(html)).toEqual([]);
      expect(html).toContain('X part');
      expect(html).toContain('Manufacturer');
      expect(html).toContain(lang === 'vi' ? 'Quản lý cơ sở dữ liệu linh kiện' : 'Database manager');
    }
  });

  it('SPICE import with models and errors', () => {
    for (const lang of ['vi', 'en'] as const) {
      setLang(lang);
      const html = renderToStaticMarkup(createElement(SpiceImportDialog, { close, initialText: '.model D1 D(IS=1n)\n.subckt S a b\nR1 a b 1k\n.ends\n.include missing.lib\n' }));
      expect(unexplained(html)).toEqual([]);
      expect(html).toContain('missing.lib');
      expect(html).toContain(lang === 'vi' ? 'Mạch con' : 'Subcircuit');
    }
  });

  it('symbol editor', () => {
    for (const lang of ['vi', 'en'] as const) {
      setLang(lang);
      const html = renderToStaticMarkup(createElement(SymbolEditor, { initial: templateSymbol('npn'), name: 'NPN', close, onDone: () => undefined }));
      expect(unexplained(html)).toEqual([]);
      expect(html).toContain(lang === 'vi' ? 'Chữ nhật' : 'Rectangle');
      // the three pins of the template are drawn and named
      for (const p of ['C', 'B', 'E']) expect(html).toContain(`>${p}</text>`);
    }
  });
});
