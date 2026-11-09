/**
 * Round-4 QA, second fix pass: texts that stayed in the wrong language.
 *  - QE7: the BOM tab "Giá trị" column of a push button read the English part name;
 *  - QE10: the multi-selection summary named a drawn shape "shape" in the Vietnamese UI;
 *  - QL16: part faces drawn in Vietnamese (tank, junction, lift, PLC modules) in the English UI.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../../src/model/designkit';
import { actions } from '../../../../src/ui/store';
import { BomTab } from '../../../../src/ui/integration/panels';
import { getLang, hasMessage, setLang, tDynamic } from '../../../../src/i18n';
import { faceText } from '../../../../src/i18n/library';
import { loadAllGroups, listParts } from '../../../../src/library';

function inLang<T>(lang: 'vi' | 'en', fn: () => T): T {
  const before = getLang();
  setLang(lang);
  try {
    return fn();
  } finally {
    setLang(before);
  }
}

describe('QE7: BOM tab value column in the Vietnamese UI', () => {
  it('shows the Vietnamese name for a part whose value is its own name', () => {
    const b = new DesignBuilder();
    b.part('basic/push-button', 'S1', 0, 0);
    actions.loadDesign(b.design, 'bom-push-button.msim');
    const html = inLang('vi', () => renderToStaticMarkup(createElement(BomTab)));
    expect(html).toContain('Nút nhấn');
    expect(html).not.toContain('Push Button');
    // English keeps the English name
    const en = inLang('en', () => renderToStaticMarkup(createElement(BomTab)));
    expect(en).toContain('Push Button');
  });
});

describe('QE10: selection summary names every item kind', () => {
  it('has a Vietnamese and an English text for a drawn shape', () => {
    expect(hasMessage('status.kind.shape')).toBe(true);
    expect(inLang('vi', () => tDynamic('status.kind.shape', { n: 1 }))).toBe('1 hình vẽ');
    expect(inLang('en', () => tDynamic('status.kind.shape', { n: 1 }))).toBe('1 shape');
    expect(inLang('en', () => tDynamic('status.kind.shape', { n: 2 }))).toBe('2 shapes');
  });
});

describe('QL16: part-face texts follow the UI language', () => {
  it('translates the Vietnamese face words in the English UI and leaves the Vietnamese UI alone', () => {
    expect(inLang('en', () => faceText('BỒN NƯỚC'))).toBe('TANK');
    expect(inLang('en', () => faceText('BƠM'))).toBe('PUMP');
    expect(inLang('en', () => faceText('VAN XẢ'))).toBe('DRAIN');
    expect(inLang('en', () => faceText('VÀO 8'))).toBe('IN 8');
    expect(inLang('en', () => faceText('RA 4'))).toBe('OUT 4');
    expect(inLang('en', () => faceText('Đ–T đỏ'))).toBe('E–W red');
    expect(inLang('en', () => faceText('LOW'))).toBe('LOW');
    expect(inLang('vi', () => faceText('BỒN NƯỚC'))).toBe('BỒN NƯỚC');
    expect(inLang('vi', () => faceText('VÀO 8'))).toBe('VÀO 8');
  });

  it('covers every Vietnamese symbol text and pin label of the library', async () => {
    await loadAllGroups();
    const VI = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯàáâãèéêìíòóôõùúăđĩũơưẠ-ỹ]/;
    const missing: string[] = [];
    inLang('en', () => {
      for (const p of listParts()) {
        const texts = [...p.symbol.prims.flatMap((pr) => (pr.kind === 'text' ? [pr.text] : [])), ...p.symbol.pins.flatMap((pin) => (pin.label ? [pin.label] : []))];
        for (const s of texts) if (VI.test(faceText(s))) missing.push(`${p.id}: ${s}`);
      }
    });
    expect(missing).toEqual([]);
  }, 60000);
});
