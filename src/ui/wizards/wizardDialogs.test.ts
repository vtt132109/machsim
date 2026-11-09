/**
 * Circuit wizard dialogs render (server-side, no DOM) with their default specification: the
 * computed parts, the predicted result, the design steps and a schematic preview appear in the
 * current language, and every form label explains itself on hover.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { BjtWizard, FilterWizard, OpampWizard, Timer555Wizard } from './wizardDialogs';
import { PcbCalculator } from './PcbCalculator';
import { setLang } from '../../i18n';

afterAll(() => setLang('vi'));

const render = (c: (p: { close: () => void }) => ReturnType<typeof Timer555Wizard>) => renderToStaticMarkup(createElement(c, { close: () => {} }));

/** Labels of the wizard forms without a tooltip. */
function untitledLabels(html: string): string[] {
  return [...html.matchAll(/<label([^>]*)>([^<]*)/g)].filter((m) => !/title="[^"]*\S/.test(m[1])).map((m) => m[2]);
}

describe('circuit wizard dialogs', () => {
  it('555 wizard shows the timing parts, the steps and a preview (Vietnamese)', () => {
    setLang('vi');
    const html = render(Timer555Wizard);
    expect(html).toContain('Tụ định thời');
    expect(html).toContain('Mức cao');
    // the schematic preview is drawn after mounting (effect); the parts table is there at once
    expect(html).toContain('R1');
    expect(untitledLabels(html)).toEqual([]);
  });

  it('filter wizard computes the order of the default specification (English)', () => {
    setLang('en');
    const html = render(FilterWizard);
    expect(html).toContain('Butterworth prototype of order n = 4');
    expect(html).toContain('Section 2: second order');
    expect(untitledLabels(html)).toEqual([]);
  });

  it('op-amp and BJT wizards show their predictions', () => {
    setLang('en');
    const op = render(OpampWizard);
    expect(op).toContain('Av = −Rf/R1');
    expect(untitledLabels(op)).toEqual([]);
    const bjt = render(BjtWizard);
    expect(bjt).toContain('Mid-band gain');
    expect(bjt).toContain('stiff divider');
    expect(untitledLabels(bjt)).toEqual([]);
  });

  it('PCB calculator shows Z0 of a 3 mm FR-4 microstrip and solves the 50 Ω width', () => {
    setLang('en');
    const html = renderToStaticMarkup(createElement(PcbCalculator, { close: () => {} }));
    expect(html).toMatch(/Characteristic impedance Z0<\/th><td class="msw-num">5\d\.\d+ Ω/);
    expect(html).toMatch(/Width needed: W = (2\.9|3\.0)\d+ mm/);
    expect(untitledLabels(html)).toEqual([]);
  });
});
