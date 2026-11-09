/**
 * Properties-field validation of number parameters: the Vietnamese decimal comma and the RKM code
 * are read as the value they mean, text with an unread rest is refused with a message that says
 * what MachSim would otherwise have used, and the preview never shows a cut-short value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import { setLang } from '../../i18n';
import { paramPreview, validateParamText } from './paramFields';

const value = getPart('basic/resistor')!.params.find((p) => p.key === 'value')!;

describe('number parameters', () => {
  afterEach(() => setLang('vi'));

  it('read "4,7k", "4k7" and "4R7" as the values they mean', () => {
    for (const [text, shown] of [
      ['4,7k', '4.7 kΩ'],
      ['4k7', '4.7 kΩ'],
      ['4R7', '4.7 Ω'],
      ['2M2', '2.2 MΩ'],
      ['0,5', '500 mΩ'],
    ]) {
      expect(validateParamText(value, text)).toBeNull();
      expect(paramPreview(value, text)).toBe(shown);
    }
  });

  it('refuse text with an unread rest instead of cutting it short', () => {
    setLang('vi');
    const msg = validateParamText(value, '4.7.3k');
    expect(msg).toContain('“.3k”');
    expect(msg).toContain('4.7 Ω');
    expect(paramPreview(value, '4.7.3k')).toBe('');
    expect(validateParamText(value, '1,2,3')).not.toBeNull();
    setLang('en');
    expect(validateParamText(value, '4k7k7')).toMatch(/cannot be read/);
    // expressions and plain numbers with unit words stay valid
    expect(validateParamText(value, '{2*Rload}')).toBeNull();
    expect(validateParamText(value, '10 kOhm')).toBeNull();
  });
});
