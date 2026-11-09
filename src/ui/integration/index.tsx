/**
 * MachSim application integration: connects the shell (src/ui/app) with the simulation worker,
 * instruments, results, reports, examples and the 3D breadboard.
 *
 *   import { installIntegration } from './ui/integration';
 *   installIntegration();          // once, before the first render (main.tsx)
 *
 * Installs
 *  - the SimulationController (Run / Pause / Stop / Run analysis) backed by a module worker
 *    (falls back to in-process simulation when workers are unavailable);
 *  - a floating-window kind per InstrumentKind plus 'grapher' (props { postprocessor? });
 *  - dock tabs Simulation, ERC, Netlist and BOM; the "Breadboard 3D" main view;
 *  - the extension commands (examples, SPICE import / export, ERC, reports, analysis settings,
 *    grapher, postprocessor).
 * Returns an uninstall function (tests, hot reload).
 */
import { documents } from '../app/documentSet';
import type { InstrumentKind } from '../../model/types';
import { emptyNetlist } from '../../sim/netlist';
import {
  openFloatingWindow,
  registerBottomTab,
  registerFloatingWindowKind,
  registerMainView,
  setSimulationController,
} from '../app/extensions';
import { showSpreadsheet } from '../app/dockState';
import { registerOpenTransform, spiceFileHandler } from '../app/document';
import { localizeOpenedSample } from './sampleLocalize';
import { browserStorage } from '../app/files';
import { PANEL_WIDTHS, panelTitle } from '../instruments/titles';
import { installInstrumentDefaults, instrumentDefaults } from '../instruments/defaults';
import { setPlacementDefaults } from '../store/partDefaults';
import { editor } from '../store';
import { SimClient, createLazyInProcessTransport, createWorkerTransport, type SimTransport } from '../sim/client';
import { BreadboardTab } from './BreadboardTab';
import { TAB_IDS, registerIntegrationCommands, runSpiceText } from './commands';
import { installGrapherPersistence } from './grapherPersist';
import { SimulationIntegration, type DocumentLive } from './controller';
import { InstrumentWindow } from './InstrumentWindow';
import { AudioPanel, BomTab, ErcTab, GrapherWindow, McuPanel, NetlistTab, ScriptPanel, SimulationTab } from './panels';
import { t } from '../../i18n';

export { SimulationIntegration, initialLiveState, rateText, type LiveState } from './controller';
// example builders (exampleDesigns.ts) stay out of the start-up bundle; tests import them directly
export { DESIGN_EXAMPLES } from './examples';
export { exampleCatalog, SPICE_EXAMPLES } from './examples';
export { designBom, designNetlistText, netlistFileName, prepareSpiceDeck } from './reports';
export { liveLevels, neededVectors, needsStreaming, probeText, indicatorReadings, SignalHistory } from './live';
export { circuitElements, circuitOutputs, circuitSources, specContext } from './circuitInfo';

const SPEED_KEY = 'machsim.simspeed.v1';

/** Initial window heights (CSS px) per instrument panel; widths come from PANEL_WIDTHS. */
const PANEL_HEIGHTS: Record<InstrumentKind, number> = {
  multimeter: 330,
  'function-generator': 330,
  oscilloscope: 560,
  'oscilloscope-4ch': 600,
  'bode-plotter': 500,
  wattmeter: 260,
  'frequency-counter': 290,
  'iv-analyzer': 520,
  'spectrum-analyzer': 500,
  'network-analyzer': 560,
  'distortion-analyzer': 360,
  'logic-analyzer': 520,
  'word-generator': 520,
  'logic-converter': 520,
  'current-clamp': 260,
  'bench-generator': 420,
  'bench-multimeter': 440,
  'bench-scope': 640,
  'mixed-signal-scope': 700,
};

function readSpeed(): number {
  try {
    const raw = browserStorage()?.getItem(SPEED_KEY);
    if (raw === 'max') return Infinity;
    const v = raw ? Number(raw) : NaN;
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
}

function writeSpeed(v: number): void {
  try {
    browserStorage()?.setItem(SPEED_KEY, Number.isFinite(v) ? String(v) : 'max');
  } catch {
    /* storage unavailable */
  }
}

/** Module worker when available, otherwise simulation on the UI thread. */
function transportFactory(): SimTransport {
  if (typeof Worker !== 'undefined') {
    try {
      return createWorkerTransport();
    } catch (e) {
      console.warn('Simulation worker unavailable, simulating on the UI thread', e);
    }
  }
  return createLazyInProcessTransport();
}

let uninstall: (() => void) | null = null;
let current: SimulationIntegration | null = null;

/** The installed controller (null before installIntegration). */
export function getIntegration(): SimulationIntegration | null {
  return current;
}

/** Longest time the start-up engine check may take before it is reported as failed. */
export const WARM_UP_TIMEOUT_MS = 10_000;

/**
 * Start the worker and load the engine in the background with a one-resistor operating point,
 * so the first Run does not wait for it; a broken worker / engine is reported right away
 * (console error and a Simulation message) instead of at the first Run.
 */
async function warmUp(client: SimClient): Promise<void> {
  const netlist = emptyNetlist(t('integration.index.engineCheck'));
  netlist.elements = [
    { type: 'V', name: 'V1', nodes: ['a', '0'], params: {}, source: { dc: 1 } },
    { type: 'R', name: 'R1', nodes: ['a', '0'], params: {}, value: 1e3 },
  ];
  netlist.analyses = [{ type: 'op' }];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      client.runOne(netlist),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t('integration.index.noAnswerWithinValueS', { value: WARM_UP_TIMEOUT_MS / 1000 }))), WARM_UP_TIMEOUT_MS);
      }),
    ]);
    const i = results[0]?.vectors.find((v) => v.name === 'I(V1)')?.re[0];
    if (results[0]?.error || i === undefined || Math.abs(i + 1e-3) > 1e-9) throw new Error(results[0]?.error ?? t('integration.index.wrongOperatingPoint'));
  } catch (e) {
    const text = t('integration.index.simulationEngineFailedToStart', { value: e instanceof Error ? e.message : String(e) });
    console.error(text);
    editor.actions.addSimMessage('error', text, 'engine');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function installIntegration(): () => void {
  if (uninstall) return uninstall;
  const client = new SimClient(transportFactory);
  void warmUp(client);
  const ctrl = new SimulationIntegration({
    editor,
    client,
    speed: readSpeed(),
    onResults: () => {
      openFloatingWindow('grapher', {});
    },
    onProblems: () => showSpreadsheet('messages'),
  });
  current = ctrl;
  // default instrument settings: newly placed instruments start with the user's saved settings
  installInstrumentDefaults(browserStorage());
  setPlacementDefaults((part) => (part.instrument ? instrumentDefaults(part.id) : undefined));
  let lastSpeed = ctrl.live.getState().speed;
  const offs: (() => void)[] = [
    ctrl.live.subscribe(() => {
      const s = ctrl.live.getState().speed;
      if (s !== lastSpeed) {
        lastSpeed = s;
        writeSpeed(s);
      }
    }),
    setSimulationController({
      run: () => ctrl.run(),
      pause: () => ctrl.pause(),
      stop: () => ctrl.stop(),
      runAnalysis: (type) => ctrl.runAnalysis(type),
    }),
    registerFloatingWindowKind('grapher', {
      title: (p) => (p.postprocessor ? t('common.postprocessor') : t('integration.index.grapher')),
      render: (p) => <GrapherWindow ctrl={ctrl} postprocessor={p.postprocessor === true} />,
      defaultSize: { w: 880, h: 580 },
      minSize: { w: 420, h: 300 },
    }),
    registerFloatingWindowKind('mcu', {
      title: (p) => (typeof p.refdes === 'string' && p.refdes.length > 0 ? t('mcu.window.title', { refdes: p.refdes }) : t('mcu.window.titleEmpty')),
      render: (p) => <McuPanel ctrl={ctrl} refdes={typeof p.refdes === 'string' ? p.refdes : undefined} />,
      defaultSize: { w: 940, h: 600 },
      minSize: { w: 520, h: 320 },
    }),
    registerFloatingWindowKind('audio', {
      title: () => t('audio.window.title'),
      render: () => <AudioPanel />,
      defaultSize: { w: 460, h: 560 },
      minSize: { w: 320, h: 300 },
    }),
    registerFloatingWindowKind('script', {
      title: () => t('script.window.title'),
      render: () => <ScriptPanel />,
      defaultSize: { w: 980, h: 640 },
      minSize: { w: 560, h: 360 },
    }),
    registerBottomTab({ id: TAB_IDS.simulation, title: t('common.simulation'), render: () => <SimulationTab ctrl={ctrl} />, order: 10 }),
    registerBottomTab({ id: TAB_IDS.erc, title: 'ERC', render: () => <ErcTab />, order: 20 }),
    registerBottomTab({ id: TAB_IDS.netlist, title: t('integration.index.netlist'), render: () => <NetlistTab />, order: 30 }),
    registerBottomTab({ id: TAB_IDS.bom, title: 'BOM', render: () => <BomTab />, order: 40 }),
    registerMainView({ id: 'breadboard', title: t('integration.index.breadboard3d'), render: () => <BreadboardTab ctrl={ctrl} />, order: 10 }),
    registerIntegrationCommands(ctrl),
    // document tabs: every document keeps its own results and Grapher run history, and a running
    // simulation is stopped when another document is shown
    documents.registerExtension({
      id: 'simulation',
      capture: () => ctrl.documentState(),
      restore: (d) => ctrl.restoreDocumentState(d as DocumentLive | undefined),
      beforeLeave: () => ctrl.stopForDocumentSwitch(),
    }),
    // Grapher pages kept in a design file come back when it is opened
    installGrapherPersistence(ctrl),
    // a shipped sample opened from a file gets its title and sheet names in the UI language
    registerOpenTransform(localizeOpenedSample),
  ];
  // SPICE decks opened with File > Open, from Explorer (desktop) or the recent list are simulated
  spiceFileHandler.current = async (text, name) => {
    await runSpiceText(ctrl, text, name);
  };
  offs.push(() => {
    spiceFileHandler.current = null;
  });
  for (const kind of Object.keys(PANEL_HEIGHTS) as InstrumentKind[]) {
    offs.push(
      registerFloatingWindowKind(kind, {
        title: (p) => panelTitle(kind, typeof p.refdes === 'string' ? p.refdes : undefined),
        render: (p) => <InstrumentWindow refdes={String(p.refdes ?? '')} kind={kind} ctrl={ctrl} />,
        defaultSize: { w: (PANEL_WIDTHS[kind] ?? 520) + 24, h: PANEL_HEIGHTS[kind] },
        minSize: { w: 260, h: 200 },
      }),
    );
  }
  offs.push(() => setPlacementDefaults(null));
  uninstall = () => {
    for (const off of offs.splice(0)) off();
    ctrl.dispose();
    current = null;
    uninstall = null;
  };
  return uninstall;
}
