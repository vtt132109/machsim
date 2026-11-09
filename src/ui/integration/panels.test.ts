/**
 * Server-side renders of the integration panels (no DOM in the test environment): instrument
 * window, Grapher window and the Simulation / ERC / Netlist / BOM dock tabs, bound to the
 * application's editor singleton and a controller on the in-process transport.
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actions, editor } from '../store';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { SimulationIntegration } from './controller';
import { voltageDividerExample } from './exampleDesigns';
import { InstrumentWindow } from './InstrumentWindow';
import { BomTab, ErcTab, GrapherWindow, NetlistTab, SimulationTab } from './panels';
import { runErc } from './commands';
import { setLang } from '../../i18n';
import { preloadInstrumentPanels } from '../instruments/lazyPanels';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

const html = (el: ReactElement) => renderToStaticMarkup(el);

let ctrl: SimulationIntegration;

beforeAll(async () => {
  // the Grapher and the instrument panels are code-split; server-side renders need them loaded
  await Promise.all([GrapherWindow.preload(), preloadInstrumentPanels()]);
  actions.loadDesign(voltageDividerExample(), '01-voltage-divider.msim');
  ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed: 1 });
});

afterAll(() => ctrl.dispose());

describe('integration panels', () => {
  it('shows a hint in the Grapher before any analysis', () => {
    expect(html(createElement(GrapherWindow, { ctrl }))).toContain('No results yet');
  });

  it('renders the multimeter with the operating-point reading and the Grapher with the result', async () => {
    await ctrl.runAnalysis('op');
    const meter = html(createElement(InstrumentWindow, { refdes: 'XMM1', kind: 'multimeter', ctrl }));
    expect(meter).toMatch(/3\.83[67]/);
    const grapher = html(createElement(GrapherWindow, { ctrl }));
    expect(grapher).toContain('Operating point');
    expect(grapher).toContain('V(OUT)');
    expect(grapher).not.toContain('No results yet');
  });

  it('reports a deleted instrument', () => {
    expect(html(createElement(InstrumentWindow, { refdes: 'XSC9', kind: 'oscilloscope', ctrl }))).toContain('XSC9 is no longer part of the design');
  });

  it('lists instruments, speed and results in the Simulation tab', () => {
    const tab = html(createElement(SimulationTab, { ctrl }));
    expect(tab).toContain('Interactive speed');
    expect(tab).toContain('Multimeter – XMM1');
    expect(tab).toContain('1× real time');
    expect(tab).toContain('DC operating point');
  });

  it('shows the SPICE netlist, the BOM and ERC results', () => {
    const net = html(createElement(NetlistTab));
    expect(net).toContain('R1 N1 OUT 10k');
    expect(net).toContain('.end');
    const bom = html(createElement(BomTab));
    expect(bom).toContain('R1');
    expect(bom).toContain('R2');
    expect(bom).not.toContain('XMM1');
    actions.setErcMarkers([{ severity: 'warning', code: 'floating-pin', message: 'R9 pin 2 is not connected', refdes: 'R9', pin: '2' }]);
    const erc = html(createElement(ErcTab));
    expect(erc).toContain('0 error(s), 1 warning(s)');
    expect(erc).toContain('R9 pin 2 is not connected');
    actions.clearErcMarkers();
    expect(html(createElement(ErcTab))).toContain('No ERC results');
  });

  it('tells a clean ERC apart from "not checked yet" and notices later edits', () => {
    // the voltage divider example is clean
    expect(runErc()).toBe(0);
    expect(html(createElement(ErcTab))).toContain('ERC found no problems');
    actions.setDesignInfo({ description: 'edited after the check' });
    expect(html(createElement(ErcTab))).toContain('the circuit has changed since');
  });
});
