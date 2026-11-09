/**
 * Integration commands for the shell's menus (registered with registerCommand):
 *   file.examples          sample browser (SampleBrowser.tsx: designs open as documents, SPICE decks run)
 *   file.importSpice       pick a SPICE deck, parse it, run its analyses, show the Grapher
 *   file.exportSpice       write the design's SPICE netlist (.cir)
 *   tools.erc              electrical rules check -> markers, messages and the ERC tab
 *   reports.netlist / bom  show the Netlist / BOM dock tabs
 *   simulate.analysisSettings, simulate.grapher, simulate.postprocessor,
 *   simulate.interactiveSettings, simulate.convergenceAssistant (dialogs in simDialogs.tsx)
 */
import { valuesHidden } from '../../model/restrictions';
import { resolveDeckIncludes } from '../../model/spiceIncludes';
import { includeFetcher } from '../app/spiceIncludeFetch';
import { buildNetlist } from '../../model/netlister';
import { alertDialog, openCustomDialog } from '../common/dialogs';
import { openFloatingWindow, registerCommand, showBottomTab } from '../app/extensions';
import { exportFile, pickTextFile } from '../app/files';
import { actions, getState } from '../store';
import type { SimulationIntegration } from './controller';
import { lastErcCheck } from './ercState';
import { designNetlistText, netlistFileName, netlistWithheld, prepareSpiceDeck } from './reports';
import { t } from '../../i18n';

export const SPICE_EXTENSIONS = ['.cir', '.sp', '.spi', '.spice', '.net', '.ckt', '.txt', '.lib', '.mod'];

/** Dock tab ids registered by the integration. */
export const TAB_IDS = { simulation: 'simulation', erc: 'erc', netlist: 'netlist', bom: 'bom' } as const;

/** Parse a SPICE deck and run it; parse errors are shown in a dialog and stop the run. */
export async function runSpiceText(ctrl: SimulationIntegration, text: string, fileName: string, files?: ReadonlyMap<string, string>): Promise<boolean> {
  const deck = prepareSpiceDeck(text, fileName, files);
  for (const w of deck.warnings) actions.addSimMessage('warning', `${fileName}: ${w}`, 'spice');
  if (deck.errors.length) {
    for (const e of deck.errors) actions.addSimMessage('error', t('integration.commands.spiceLineError', { file: fileName, line: e.line, message: e.message }), 'spice');
    await alertDialog({
      title: t('integration.commands.cannotSimulateTheSpiceDeck'),
      message: (
        <>
          <p>
            {t('integration.commands.filenameLengthErrorS', { fileName: fileName, length: deck.errors.length })}
          </p>
          <ul className="msx-issues">
            {deck.errors.slice(0, 30).map((e, i) => (
              <li key={i}>
                {t('integration.commands.lineLineMessage', { line: e.line, message: e.message })}
              </li>
            ))}
          </ul>
        </>
      ),
    });
    return false;
  }
  actions.addSimMessage('info', t('integration.commands.filenameTitleLengthElementsLength2', { fileName: fileName, title: deck.title, length: deck.netlist.elements.length, length2: deck.netlist.analyses.length }), 'spice');
  await ctrl.runNetlist(deck.netlist, deck.title);
  return true;
}

async function importSpice(ctrl: SimulationIntegration): Promise<void> {
  const f = await pickTextFile(SPICE_EXTENSIONS);
  if (!f) return;
  // .include / .lib files: read next to the deck (desktop) or picked by the user (browser)
  const resolved = await resolveDeckIncludes(f.text, includeFetcher(f), { fileName: f.name });
  if (resolved.missing.length) actions.addSimMessage('warning', t('integration.include.missing', { list: resolved.missing.join(', ') }), 'spice');
  await runSpiceText(ctrl, f.text, f.name, resolved.files);
}

async function exportSpice(): Promise<void> {
  const s = getState();
  if (valuesHidden(s.design)) {
    actions.addSimMessage('warning', t('learn.restricted.export'), 'instructor');
    return;
  }
  if (netlistWithheld(s.design)) {
    actions.addSimMessage('warning', t('learn.restricted.faults'), 'faults');
    return;
  }
  const report = designNetlistText(s.design, 'active');
  if (report.erc.some((m) => m.severity === 'error')) {
    actions.addSimMessage('warning', t('integration.commands.exportedNetlistTheDesignHas'), 'export');
  }
  await exportFile(netlistFileName(s.fileName, s.design.title), report.text, { name: t('integration.panels.spiceNetlist'), extensions: ['cir'] });
}

/** Electrical rules check of the current design. Returns the number of errors. */
export function runErc(): number {
  const design = getState().design;
  const build = buildNetlist(design, { includeAnalysis: false });
  lastErcCheck.setState({ issues: build.erc.length, design });
  const errors = build.erc.filter((m) => m.severity === 'error').length;
  if (build.erc.length) actions.setErcMarkers(build.erc);
  else actions.clearErcMarkers();
  actions.addSimMessage(
    errors ? 'error' : build.erc.length ? 'warning' : 'info',
    build.erc.length ? t('integration.commands.ercSummary', { errors, warnings: build.erc.length - errors }) : t('integration.commands.ercNoProblemsFound'),
    'erc',
  );
  showBottomTab(TAB_IDS.erc);
  return errors;
}

/** Register every integration command; returns a function that unregisters them. */
export function registerIntegrationCommands(ctrl: SimulationIntegration): () => void {
  const offs = [
    registerCommand('file.examples', async () => {
      // the sample browser (topics, previews, texts) loads on first use
      const { SampleBrowser } = await import('./SampleBrowser');
      openCustomDialog((close) => <SampleBrowser ctrl={ctrl} close={close} />);
    }),
    registerCommand('file.importSpice', () => importSpice(ctrl)),
    registerCommand('file.exportSpice', () => exportSpice()),
    registerCommand('tools.erc', () => {
      runErc();
    }),
    registerCommand('reports.netlist', () => showBottomTab(TAB_IDS.netlist)),
    registerCommand('reports.bom', () => showBottomTab(TAB_IDS.bom)),
    registerCommand('simulate.analysisSettings', async () => {
      // the analysis setup dialog (forms, fields) loads on first use
      const { AnalysisSettings } = await import('./analysisSettings');
      openCustomDialog((close) => <AnalysisSettings ctrl={ctrl} close={close} />);
    }),
    registerCommand('simulate.grapher', () => {
      openFloatingWindow('grapher', {});
    }),
    registerCommand('simulate.interactiveSettings', async () => {
      (await import('./simDialogs')).openInteractiveSettingsDialog();
    }),
    registerCommand('simulate.convergenceAssistant', async () => {
      (await import('./simDialogs')).openConvergenceAssistant(ctrl);
    }),
    registerCommand('simulate.postprocessor', () => {
      openFloatingWindow('grapher', { postprocessor: true });
    }),
    registerCommand('simulate.mcuEditor', () => {
      // the code editor loads the 8051 core and the assembler on first use
      openFloatingWindow('mcu', {});
    }),
    registerCommand('tools.pldWizard', async () => {
      const { PldWizard } = await import('../mcu/PldWizard');
      openCustomDialog((close) => <PldWizard close={close} />);
    }),
    registerCommand('simulate.importMeasurement', async () => {
      // the Grapher chunk holds the measurement reader
      const { importMeasurementFlow } = await import('./GrapherWindow');
      if (await importMeasurementFlow(ctrl)) openFloatingWindow('grapher', {});
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
