/**
 * Catalogue-scale UI rendered on the server: the component browser (views, virtualised tree,
 * favourites), the part properties with the E-series picker, data-file field and Fault tab, and
 * the burnt-out / hot / fault marks on part glyphs. Every interactive control has a tooltip.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import type { PartInstance } from '../../model/types';
import { newDesign } from '../../model/types';
import { actions, editor } from '../store';
import { ComponentBrowser } from './ComponentBrowser';
import { PartProperties } from './PropertiesPanel';
import { PartGlyph, faultSummary } from './scene';
import { getLibraryPrefs, recordRecent, resetLibraryPrefs, toggleFavourite } from './libraryPrefs';
import { setLang } from '../../i18n';

const inst = (partId: string, refdes: string, extra: Partial<PartInstance> = {}): PartInstance => ({ id: 'p1', partId, refdes, x: 100, y: 100, rotation: 0, mirror: false, params: {}, ...extra });

/** Every input / select / button of the markup has a tooltip, an aria-label or a <label for>. */
function untitledControls(html: string): string[] {
  const labelled = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  return (html.match(/<(input|select|button)\b[^>]*>/g) ?? []).filter((tag) => {
    if (/\b(title|aria-label)="[^"]+"/.test(tag)) return false;
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    return !(id && labelled.has(id));
  });
}

beforeEach(() => setLang('vi'));
afterEach(() => resetLibraryPrefs());

describe('component browser', () => {
  it('renders the library views and a bounded, virtualised tree', () => {
    const html = renderToStaticMarkup(createElement(ComponentBrowser));
    expect(html).toContain('Thư viện');
    expect(html).toContain('Yêu thích (0)');
    expect(html).toContain('Gần đây (0)');
    expect(html).toContain('role="tree"');
    // only the rows in view are rendered, even though the catalogue has thousands of parts
    expect((html.match(/role="treeitem"/g) ?? []).length).toBeLessThan(60);
    expect(untitledControls(html)).toEqual([]);
  });

  it('keeps favourites and recent parts (most recent first, no duplicates)', () => {
    toggleFavourite('transistors/bc547b');
    toggleFavourite('basic/res-4.7k');
    toggleFavourite('transistors/bc547b');
    recordRecent('a');
    recordRecent('b');
    recordRecent('a');
    expect(getLibraryPrefs()).toEqual({ favourites: ['basic/res-4.7k'], recent: ['a', 'b'] });
    const html = renderToStaticMarkup(createElement(ComponentBrowser));
    expect(html).toContain('Yêu thích (1)');
    expect(html).toContain('Gần đây (2)');
  });
});

describe('part properties', () => {
  function show(partId: string, extra: Partial<PartInstance> = {}): string {
    const d = newDesign();
    d.sheets[0].parts.push(inst(partId, 'R1', extra));
    actions.loadDesign(d, 'test.msim');
    return renderToStaticMarkup(createElement(PartProperties, { partId: 'p1' }));
  }

  it('an interactive DC source shows a slider bounded by its own minimum, maximum and increment; moving it changes the value without an undo step', () => {
    const html = show('sources/dc-interactive-voltage', { params: { value: '3', vmin: '1', vmax: '9', step: '0.5' } });
    const range = /<input[^>]*type="range"[^>]*>/.exec(html)?.[0] ?? '';
    expect(range).toMatch(/min="1"/);
    expect(range).toMatch(/max="9"/);
    expect(range).toMatch(/step="0.5"/);
    expect(range).toMatch(/value="3"/);
    expect(range).toMatch(/aria-label="Thanh trượt Điện áp"/);
    expect(untitledControls(html)).toEqual([]);
    const undo = editor.getState().history.past.length;
    expect(actions.setInteractiveParam('R1', 'value', '6.5')).toBe(true);
    expect(editor.getState().design.sheets[0].parts[0].params.value).toBe('6.5');
    expect(editor.getState().history.past.length).toBe(undo);
    // the key steps by the instance increment and stops at the instance maximum
    expect(actions.interact('R1', 'increase')).toBe('7');
    for (let i = 0; i < 10; i++) actions.interact('R1', 'increase');
    expect(editor.getState().design.sheets[0].parts[0].params.value).toBe('9');
    // parts without instance bounds (potentiometer) keep their key-only behaviour
    expect(show('basic/potentiometer')).not.toMatch(/type="range"/);
  });

  it('offers the E24 picker next to the resistance and a Fault tab', () => {
    const html = show('basic/res-4.7k');
    expect(html).toContain('ms-value-picker');
    expect(html).toContain('4.7 kΩ');
    expect(html).toContain('Lỗi giả lập');
    expect(untitledControls(html)).toEqual([]);
  });

  it('a data-file source shows a multi-line field with Open file…', () => {
    const html = show('sources/file-voltage');
    // the data parameter lives on the (first) waveform tab
    expect(html).toContain('Mở file…');
    expect(html).toContain('<textarea');
    expect(html).toContain('1m 1');
    expect(editor.getState().design.sheets[0].parts[0].partId).toBe('sources/file-voltage');
  });

  it('describes visible faults on the glyph and hides auto faults until revealed', () => {
    const def = getPart('basic/resistor')!;
    const shown = inst('basic/resistor', 'R7', { faults: [{ pin: '1', kind: 'short', to: '2' }] });
    expect(faultSummary(shown, {})).toBe('chân 1 chập tới chân 2');
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst: shown, def, faults: faultSummary(shown, {}) })));
    expect(svg).toContain('ms-fault-badge');
    const hidden = inst('basic/resistor', 'R8', { faults: [{ pin: '2', kind: 'open', hidden: true }] });
    expect(faultSummary(hidden, { autoFault: { seed: 1, count: 1 } })).toBeUndefined();
    expect(faultSummary(hidden, { autoFault: { seed: 1, count: 1, revealed: true } })).toBe('chân 2 hở mạch');
  });

  it('marks burnt-out and hot parts with an explanation in the tooltip', () => {
    const def = getPart('basic/rated-resistor')!;
    setLang('en');
    const blown = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst: inst(def.id, 'R1'), def, rating: { state: 'blown', pct: 576 } })));
    expect(blown).toContain('is-blown');
    expect(blown).toContain('ms-blown-mark');
    expect(blown).toContain('R1 burnt out (open). Run the simulation again to fit a new one.');
    const hot = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst: inst(def.id, 'R1'), def, rating: { state: 'hot', pct: 91 } })));
    expect(hot).toContain('ms-hot-mark');
    expect(hot).toContain('R1 is hot: 91 % of its rating');
  });
});
