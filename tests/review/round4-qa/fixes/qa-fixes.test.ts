/**
 * Round-4 QA fixes: tests for the defects that did not come with a repro test of their own.
 * (The repro tests of the testers live next to this folder.)
 *
 * QD1  Properties shows the value the active design variant uses, and edits go to the variant
 * QD3  printed instrument settings and the component-detail report use the learner's words
 * QD4  "Dán giữ nguyên tên" does not count renamed parts as kept
 * QD6  instrument windows follow their own design tab
 * QD8  inside a placed block copy Properties and the canvas show that copy's own settings
 * QD10 variant names are unique
 * QE3  stop-on-change on a port pin stops right after the instruction that changed it
 * QE5  "Một dòng" over a call is reported as a step, not as "reached the cursor"
 * QE8  a refused clipboard write is explained, not shown as a raw English error
 * QE10 the multi-selection summary is in Vietnamese
 * QL15 the quick-reference card does not list hidden shortcuts in beginner mode
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadExample } from '../../../helpers';
import { setLang } from '../../../../src/i18n';
import { getPart, loadAllGroups } from '../../../../src/library';
import { Cpu8051 } from '../../../../src/mcu/cpu8051';
import { CoreDebugger, DEBUG_REASON, WATCH_SPACE, encodeWatch } from '../../../../src/mcu/debugger';
import { copyStateOf, sheetAsCopy } from '../../../../src/model/hierarchy';
import { addVariant, renameVariant, setActiveVariant, variantNameTaken } from '../../../../src/model/variants';
import { newDesign } from '../../../../src/model/types';
import { pasteKeepMessage } from '../../../../src/ui/app/editingDialogs';
import { documents } from '../../../../src/ui/app/documentSet';
import { floating, openFloatingWindow } from '../../../../src/ui/app/extensions';
import { paramDisplay } from '../../../../src/ui/editor/paramFields';
import { PartProperties, PropertiesPanel } from '../../../../src/ui/editor/PropertiesPanel';
import { writeFailure } from '../../../../src/ui/files/systemClipboard';
import { instrumentWindowsExtension } from '../../../../src/ui/integration/instrumentWindowDoc';
import { shortcutTable } from '../../../../src/ui/print/quickRef';
import { actions, getState } from '../../../../src/ui/store';

beforeAll(async () => {
  await loadAllGroups();
  setLang('vi');
});

describe('QD4 paste keeping names', () => {
  it('counts only the parts that really kept their name', () => {
    expect(pasteKeepMessage(1, 1)).toContain('Đã dán 0 linh kiện giữ nguyên tên; 1 linh kiện đổi tên');
    expect(pasteKeepMessage(3, 1)).toContain('Đã dán 2 linh kiện giữ nguyên tên; 1 linh kiện đổi tên');
    expect(pasteKeepMessage(2, 0)).not.toContain('đổi tên');
  });
});

describe('QD10 variant names', () => {
  it('refuses a rename onto another variant name, ignoring case', () => {
    const a = addVariant(newDesign('x'), 'Đầy đủ');
    const b = addVariant(a.design, 'Rút gọn');
    expect(variantNameTaken(b.design, ' đầy đủ ', b.id)).toBe(true);
    expect(variantNameTaken(b.design, 'Đầy đủ', a.id)).toBe(false);
    expect(renameVariant(b.design, b.id, 'ĐẦY ĐỦ')).toBe(b.design);
    expect(renameVariant(b.design, b.id, 'Mỏng').variants?.list[1].name).toBe('Mỏng');
  });

  it('a new variant never takes a name that is already used', () => {
    const a = addVariant(newDesign('x'), 'Độ lợi');
    const b = addVariant(a.design, 'Độ lợi');
    const c = addVariant(b.design, 'độ lợi');
    expect(c.design.variants?.list.map((v) => v.name)).toEqual(['Độ lợi', 'Độ lợi 2', 'độ lợi 3']);
  });
});

describe('QD1 Properties and the active variant', () => {
  it('shows the value the active variant gives a field and says so', () => {
    actions.loadDesign(loadExample('73-dual-opamp-variants.msim'), '73-dual-opamp-variants.msim');
    actions.applyDesign((d) => setActiveVariant(d, 'v2'));
    const r2 = getState().design.sheets.flatMap((s) => s.parts).find((p) => p.refdes === 'R2')!;
    expect(r2.params.value).not.toBe('100k');
    const html = renderToStaticMarkup(createElement(PartProperties, { partId: r2.id }));
    expect(html).toContain('value="100k"');
    expect(html).toContain('đang dùng giá trị riêng 100k');
    // the other variant does not override R2: the saved value is shown, with no note
    actions.applyDesign((d) => setActiveVariant(d, 'v1'));
    const plain = renderToStaticMarkup(createElement(PartProperties, { partId: r2.id }));
    expect(plain).not.toContain('đang dùng giá trị riêng');
  });
});

describe('QD8 inside a placed block copy', () => {
  it('Properties and the canvas show the settings of the copy that is open', () => {
    const d = loadExample('91-block-meters.msim');
    actions.loadDesign(d, '91-block-meters.msim');
    expect(actions.setInteractiveParam('XMM1', 'mode', 'a', ['X2'])).toBe(true);
    const root = getState().design;
    const x2 = root.sheets[0].parts.find((p) => p.refdes === 'X2')!;
    expect(copyStateOf(root, ['X2'], 'XMM1')).toEqual({ mode: 'a' });
    expect(copyStateOf(root, ['X1'], 'XMM1')).toBeUndefined();
    // the drawing of the block, as copy X2 sees it, has the ammeter setting
    const childSheet = root.children![0].sheets[0];
    const meterOf = (sheet: typeof childSheet) => sheet.parts.find((p) => p.refdes === 'XMM1')!;
    expect(meterOf(sheetAsCopy(root, ['X2'], childSheet)).params.mode).toBe('a');
    expect(meterOf(sheetAsCopy(root, ['X1'], childSheet)).params.mode).not.toBe('a');
    expect(meterOf(childSheet).params.mode).not.toBe('a');
    // open copy X2 and select its meter: the Properties field reads the copy's setting
    expect(actions.openBlock(x2.id)).toBe(true);
    const meter = getState().design.children![0].sheets[0].parts.find((p) => p.refdes === 'XMM1')!;
    const html = renderToStaticMarkup(createElement(PartProperties, { partId: meter.id }));
    expect(html).toMatch(/<option value="a" selected="">Dòng điện/);
    expect(html).toContain('bản X2');
  });
});

describe('QD6 instrument windows follow their design', () => {
  it('closes the windows when another design is shown and brings them back with their own', () => {
    const ext = instrumentWindowsExtension((k) => k === 'multimeter');
    const open = () => floating.getState().windows.filter((w) => w.kind === 'multimeter');
    for (const w of open()) floating.setState((s) => ({ ...s, windows: s.windows.filter((x) => x.id !== w.id) }));
    openFloatingWindow('multimeter', { refdes: 'X1.XMM1' });
    openFloatingWindow('multimeter', { refdes: 'X2.XMM1' });
    openFloatingWindow('grapher', {});
    const saved = ext.capture();
    // another design: a new tab has nothing recorded
    ext.restore(undefined);
    expect(open()).toHaveLength(0);
    expect(floating.getState().windows.some((w) => w.kind === 'grapher')).toBe(true);
    // back to the first design
    ext.restore(saved);
    expect(open().map((w) => w.props.refdes).sort()).toEqual(['X1.XMM1', 'X2.XMM1']);
    ext.restore(undefined);
    expect(documents.count()).toBeGreaterThan(0);
  });
});

describe('QD3 printed values in the learner\'s words', () => {
  it('names the chosen option of a list and formats numbers with their unit', () => {
    const scope = getPart('instruments/scope')!;
    const edge = scope.params.find((p) => p.kind === 'select' && p.options?.some((o) => o.value === 'rising'));
    expect(edge).toBeTruthy();
    expect(paramDisplay(edge!, 'rising')).not.toBe('rising');
    const cap = getPart('basic/capacitor')!.params.find((p) => p.kind === 'number')!;
    expect(paramDisplay(cap, '159n')).toBe('159 nF');
    expect(paramDisplay(cap, '{Cx}')).toBe(`{Cx} ${cap.unit}`);
  });
});

describe('QE3 stop on change of a port', () => {
  it('stops right after the instruction that changed the pin, not one instruction later', () => {
    const cpu = new Cpu8051();
    cpu.loadCode([0xb2, 0x90, 0x00, 0x00, 0x00]); // CPL P1.0 ; NOP ; NOP ; NOP
    const dbg = new CoreDebugger(cpu, 1e-6);
    dbg.setWatch(0, encodeWatch(WATCH_SPACE.direct, 0x90));
    dbg.watchBreak = 1;
    let applied = false;
    const hooks = {
      // the circuit follows the latch and puts the new level on the pin before the next instruction
      before: () => {
        if (cpu.pc === 2 && !applied) {
          cpu.pinIn[8] = 0;
          applied = true;
        }
      },
      after: () => {},
    };
    dbg.advance(100, hooks);
    expect(dbg.held).toBe(true);
    expect(dbg.reason).toBe(DEBUG_REASON.watch);
    expect(cpu.pc).toBe(2);
    expect(cpu.cycles).toBe(1);
  });
});

describe('QE5 stepping over a call', () => {
  it('reports the step, not "reached the cursor line"', () => {
    const cpu = new Cpu8051();
    // 0000 LCALL 0008 ; 0003 NOP ... 0008 NOP ; 0009 RET
    cpu.loadCode([0x12, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x22]);
    const dbg = new CoreDebugger(cpu, 1e-6);
    dbg.stepOver();
    dbg.advance(1000, { before: () => {}, after: () => {} });
    expect(dbg.held).toBe(true);
    expect(cpu.pc).toBe(3);
    expect(dbg.reason).toBe(DEBUG_REASON.stepOver);
  });
});

describe('QE8 clipboard write refused', () => {
  it('explains a permission error in Vietnamese and points to the snippet file', () => {
    const msg = writeFailure(new DOMException("Failed to execute 'write' on 'Clipboard': Write permission denied.", 'NotAllowedError'));
    expect(msg).not.toMatch(/Failed to execute/);
    expect(msg).toContain('snippet');
    expect(writeFailure(new Error('boom'))).toContain('boom');
    expect(writeFailure(new Error('boom'))).toMatch(/Không ghi được/);
  });
});

describe('QE10 multi-selection summary', () => {
  it('is in Vietnamese, like the status bar', () => {
    actions.loadDesign(loadExample('98-measurement-replay.msim'), '98-measurement-replay.msim');
    actions.selectAll();
    const html = renderToStaticMarkup(createElement(PropertiesPanel));
    expect(html).not.toMatch(/\d+ parts?\b/);
    expect(html).toContain('linh kiện');
  });
});

describe('QL15 quick-reference card in beginner mode', () => {
  it('does not list the shortcuts of hidden commands', () => {
    const keys = (beginner: boolean) => shortcutTable(beginner).table.rows.map((r) => r[1]);
    expect(keys(false)).toContain('Ctrl+H');
    expect(keys(false)).toContain('B');
    expect(keys(true)).not.toContain('Ctrl+H');
    expect(keys(true)).not.toContain('B');
  });
});

describe('texts of the fixed examples', () => {
  it('sample 01 note is Vietnamese; the scripts print a positive current and sweep from 10 Hz', () => {
    expect(readFileSync(new URL('../../../../examples/01-voltage-divider.msim', import.meta.url), 'utf8')).not.toContain('DC volts).');
    const scripts = readFileSync(new URL('../../../../src/i18n/scriptText.ts', import.meta.url), 'utf8');
    expect(scripts).toContain("Math.abs(op.get('I(V1)')[0])");
    expect(scripts).not.toContain("fstart: '100', fstop: '10k'");
  });
});
