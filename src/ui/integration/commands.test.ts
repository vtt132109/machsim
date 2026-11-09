/**
 * Integration commands against the application's editor singleton: SPICE decks run through the
 * controller, ERC fills markers / messages, SPICE files reaching the document loader are routed
 * to the importer, and registered commands enable the shell's extension menu items.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasCommand } from '../app/extensions';
import { loadDesignText, spiceFileHandler } from '../app/document';
import { actions, editor, getState } from '../store';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { DesignBuilder } from '../../model/designkit';
import { serializeDesign } from '../../model/serialize';
import { TAB_IDS, registerIntegrationCommands, runErc, runSpiceText } from './commands';
import { SimulationIntegration } from './controller';
import { exampleCatalog } from './examples';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

let ctrl: SimulationIntegration;
let off: () => void;

beforeAll(() => {
  ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()) });
  off = registerIntegrationCommands(ctrl);
});

afterAll(() => {
  off();
  ctrl.dispose();
});

describe('integration commands', () => {
  it('registers every extension command of the menus', () => {
    for (const id of ['file.examples', 'file.importSpice', 'file.exportSpice', 'tools.erc', 'reports.netlist', 'reports.bom', 'simulate.analysisSettings', 'simulate.grapher', 'simulate.postprocessor']) {
      expect(hasCommand(id), id).toBe(true);
    }
  });

  it('runs an example SPICE deck and keeps its results for the Grapher', async () => {
    const deck = exampleCatalog().find((e) => e.file === 'spice/rlc-bandpass.cir')!;
    expect(await runSpiceText(ctrl, await deck.load(), 'rlc-bandpass.cir')).toBe(true);
    const [r] = ctrl.live.getState().results;
    expect(r.type).toBe('ac');
    expect(r.error).toBeUndefined();
    expect(getState().sim.message).toMatch(/^Done: AC/);
    expect(getState().simMessages.some((m) => m.source === 'spice' && /RLC band-pass filter/.test(m.text))).toBe(true);
  });

  it('routes SPICE files opened as documents to the importer', async () => {
    const calls: string[] = [];
    spiceFileHandler.current = async (_text, name) => {
      calls.push(name);
    };
    const before = getState().design;
    expect(await loadDesignText('Deck\nV1 a 0 1\nR1 a 0 1k\n.end\n', 'deck.cir', null)).toBe(true);
    expect(calls).toEqual(['deck.cir']);
    expect(getState().design).toBe(before); // the open design is untouched
    spiceFileHandler.current = null;
  });

  it('opens an example design through the document loader', async () => {
    const ex = exampleCatalog().find((e) => e.file === '06-555-led-flasher.msim')!;
    expect(await loadDesignText(await ex.load(), ex.file, null, true)).toBe(true);
    expect(getState().design.title).toBe('555 astable LED flasher');
    expect(getState().fileName).toBe('06-555-led-flasher.msim');
  });

  it('ERC marks problems on the canvas and shows the ERC tab', async () => {
    const b = new DesignBuilder('floating');
    b.part('basic/resistor', 'R1', 100, 100);
    b.part('sources/ground', 'GND1', 300, 300);
    await loadDesignText(serializeDesign(b.design), 'floating.msim', null, true);
    const errors = runErc();
    const markers = getState().ercMarkers;
    expect(markers.some((m) => m.code === 'floating-pin' && m.refdes === 'R1')).toBe(true);
    expect(errors).toBe(markers.filter((m) => m.severity === 'error').length);
    expect(getState().ui.dockTab).toBe(TAB_IDS.erc);
    expect(getState().simMessages[getState().simMessages.length - 1].text).toMatch(/^ERC: /);
    actions.clearErcMarkers();
  });
});
