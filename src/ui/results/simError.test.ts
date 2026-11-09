/**
 * Simulator errors read as "what is wrong — how to fix it" in the learner's language, with a
 * button that shows the named part on the schematic.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { actions } from '../store';
import { setLang, tIn } from '../../i18n';
import { SimErrorBox, SimErrorHint } from './SimErrorBox';

afterEach(() => setLang('vi'));

function loadDivider(): void {
  const b = new DesignBuilder('divider');
  b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  actions.loadDesign(b.design, 'divider.msim');
}

describe('simulation error explanations', () => {
  it('explains a singular matrix in Vietnamese and offers to locate the named part', () => {
    loadDivider();
    const msg = 'Singular matrix: no valid pivot for V(N3); check R1 and V1';
    const html = renderToStaticMarkup(createElement(SimErrorHint, { message: msg }));
    const title = tIn('vi', 'sim.err.singularNode.title', { what: 'V(N3)' });
    expect(html).toContain(title.replace(/&/g, '&amp;'));
    expect(html).toContain(tIn('vi', 'sim.err.singularNode.fix', { what: 'V(N3)' }).slice(0, 20));
    // both parts exist on the schematic: one locate button each
    expect(html).toContain(tIn('vi', 'results.grapher.locatePart', { refdes: 'R1' }));
    expect(html).toContain(tIn('vi', 'results.grapher.locatePart', { refdes: 'V1' }));
  });

  it('switches to English and keeps the technical message for reference', () => {
    loadDivider();
    setLang('en');
    const html = renderToStaticMarkup(createElement(SimErrorBox, { message: 'Timestep too small at t = 1.5e-3 s' }));
    expect(html).toContain(tIn('en', 'sim.err.timestep.title', { time: '1.5e-3' }));
    expect(html).toContain('Timestep too small at t = 1.5e-3 s');
    // no part is named: no locate button
    expect(html).not.toContain(tIn('en', 'results.grapher.locatePart', { refdes: 'R1' }));
  });
});
