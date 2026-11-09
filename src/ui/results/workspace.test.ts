/**
 * Static renders (react-dom/server, no DOM) of the Grapher workspace, its properties / overlay
 * dialogs, the Output tab, the profile bar and the simulation-tools dialogs: they render, show the
 * page / trace data, honour page properties, and every new control has a tooltip.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../sim/results';
import { addOverlay, addRun, emptyDoc, setPageProps, setTraceStyle } from './history';
import { GrapherWorkspace, OverlayDialog, PropertiesDialog, pageLegend } from './GrapherWorkspace';
import { Grapher, decoratePlot } from './Grapher';
import { buildPlotData } from './plotModel';
import { OutputTab, checkExpression, filterOutputs, outputKind } from '../analysis/OutputTab';
import { ProfileBar } from '../analysis/ProfileBar';
import { InteractiveSettingsDialog, ConvergenceDialog } from '../integration/simDialogs';
import { SimulationIntegration } from '../integration/controller';
import { createEditor } from '../store/editorStore';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { setLang } from '../../i18n';
import type { RunRecord } from './runs';

setLang('en');

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => undefined;

function tran(gain: number): AnalysisResult {
  const time = Float64Array.from({ length: 11 }, (_, i) => i * 1e-3);
  return { type: 'tran', title: 'Transient analysis', scale: { name: 'time', unit: 's', re: time }, vectors: [{ name: 'V(out)', unit: 'V', re: time.map((t) => gain * t) }], warnings: [] };
}
const run = (id: number, gain: number): RunRecord => ({ id, source: 'analysis', name: 'Transient', time: Date.UTC(2026, 10, 9, 8, id), results: [tran(gain)] });

/** Buttons, inputs and selects of a markup fragment that have no title attribute. */
function untitled(html: string, ignore: RegExp[] = []): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(button|select|input)\b[^>]*>/g)) {
    const tag = m[0];
    if (/\btitle="/.test(tag) || /type="checkbox"/.test(tag) && /<label[^>]*title=/.test(html.slice(Math.max(0, m.index! - 300), m.index))) continue;
    if (/role="tab"/.test(tag) && /title="/.test(tag)) continue;
    if (ignore.some((r) => r.test(tag))) continue;
    out.push(tag);
  }
  return out;
}

describe('Grapher workspace render', () => {
  let doc = addRun(emptyDoc(), run(1, 1));
  doc = addRun(doc, run(2, 2));
  doc = addOverlay(doc, doc.pages[1].id, { runId: 1, tab: 0, vector: 'V(out)' });

  it('shows the history, the page key and the overlaid trace of the earlier run', () => {
    const html = renderToStaticMarkup(createElement(GrapherWorkspace, { doc, dispatch: noop }));
    const tx = text(html);
    expect(tx).toContain('Run 2');
    expect(tx).toContain('Run 1');
    expect(tx).toContain('(name in expressions: tran2)');
    expect(tx).toMatch(/V\(out\) \(Run 1 · \d\d:\d\d\)/);
    for (const b of ['Properties…', 'Add traces…', 'Add from latest run', 'Duplicate page', 'Delete page', 'Print', 'TXT']) expect(tx).toContain(b);
  });

  it('page properties drive the axis titles, log scale and trace styles', () => {
    let d = setPageProps(doc, doc.pages[1].id, { x: { label: 'Thời gian', log: false }, y: { label: 'Áp ra' } });
    d = setTraceStyle(d, d.pages[1].id, '0:V(out)', { label: 'Lần 2', color: 5, width: 3 });
    const page = d.pages[1];
    const plot = decoratePlot(buildPlotData(tran(2)), page.props, page.traces)!;
    expect(plot.xLabel).toBe('Thời gian');
    expect(plot.panes[0].title).toBe('Áp ra');
    expect(plot.traces[0]).toMatchObject({ label: 'Lần 2', color: 5, width: 3 });
    expect(pageLegend(d, page).map((l) => l.key)).toEqual(['0:V(out)', '1:V(out)']);
  });

  it('properties and overlay dialogs render with tooltips on their controls', () => {
    const props = renderToStaticMarkup(createElement(PropertiesDialog, { doc, page: doc.pages[1], dispatch: noop, close: noop }));
    expect(text(props)).toContain('Horizontal axis (X)');
    expect(text(props)).toContain('Colour 6');
    const missing = untitled(props, [/msr-swatch/, /ms-dialog/, /aria-label="Close"/i]);
    expect(missing.filter((m) => !/type="checkbox"/.test(m) && !/class="ms-btn/.test(m))).toEqual([]);
    const ov = renderToStaticMarkup(createElement(OverlayDialog, { doc, pageId: doc.pages[0].id, dispatch: noop, close: noop }));
    expect(text(ov)).toContain('V(out) — Transient · Run 2');
  });

  it('the plain Grapher keeps working without workspace props', () => {
    const html = renderToStaticMarkup(createElement(Grapher, { results: [tran(1)] }));
    expect(text(html)).toContain('V(out)');
    expect(html).toMatch(/title="[^"]+"[^>]*>TXT</);
  });
});

describe('Output tab', () => {
  const names = ['V(in)', 'V(out)', 'I(V1)', 'P(R1)', 'Ic(Q1)', 'V(LED1.a)', 'I(V_LED1_i)'];

  it('classifies and filters outputs', () => {
    expect(names.map(outputKind)).toEqual(['voltage', 'voltage', 'current', 'power', 'device', 'internal', 'internal']);
    expect(filterOutputs(names, 'out', new Set(['voltage']))).toEqual(['V(out)']);
    expect(filterOutputs(names, '', new Set(['current', 'device']))).toEqual(['I(V1)', 'Ic(Q1)']);
  });

  it('checks expressions against the circuit, allowing other pages', () => {
    expect(checkExpression('V(out)/V(in)', names)).toBeNull();
    expect(checkExpression('db(V(out,in))', names)).toBeNull();
    expect(checkExpression('tran2.V(out) - V(out)', names)).toBeNull();
    expect(checkExpression('V(nowhere)', names)).toMatch(/nowhere/);
    expect(checkExpression('V(out', names)).toBeTruthy();
  });

  it('renders kind filters, both lists and the expression list', () => {
    const html = renderToStaticMarkup(createElement(OutputTab, { available: names, saves: ['V(out)'], onSavesChange: noop, expressions: ['V(out)/V(in)'], onExpressionsChange: noop }));
    const tx = text(html);
    for (const s of ['Node voltages', 'Device values', 'Internal nodes', 'Output expressions', 'V(out)/V(in)']) expect(tx).toContain(s);
    expect(untitled(html, [/type="checkbox"/])).toEqual([]);
  });

  it('the profile bar lists built-in profiles', () => {
    const host = { list: () => [], save: () => [], remove: () => [], exportFile: noop, importFile: async () => null };
    const html = renderToStaticMarkup(createElement(ProfileBar, { host, current: () => ({ options: {} }), onLoad: noop, make: () => ({ format: 'machsim-sim-profile' as const, version: 1 as const, name: 'x', options: {} }) }));
    for (const s of ['SPICE defaults', 'High accuracy', 'Fast', 'Hard-to-converge circuits', 'Save as profile…', 'Import…']) expect(text(html)).toContain(s);
    expect(untitled(html)).toEqual([]);
  });
});

describe('simulation dialogs render', () => {
  it('interactive settings and convergence assistant', () => {
    const it1 = renderToStaticMarkup(createElement(InteractiveSettingsDialog, { close: noop }));
    expect(text(it1)).toContain('Initial conditions');
    expect(text(it1)).toContain('Automatic (DC operating point, from zero if it fails)');
    const ctrl = new SimulationIntegration({ editor: createEditor(), client: new SimClient(() => createInProcessTransport()) });
    const cv = renderToStaticMarkup(createElement(ConvergenceDialog, { ctrl, close: noop }));
    expect(text(cv)).toContain('Try one by one');
    expect(text(cv)).toContain('raising gmin and source stepping to 50 steps');
    ctrl.dispose();
  });
});
