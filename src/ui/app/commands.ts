/**
 * Built-in commands of the shell (menu items, toolbar buttons and shortcuts run these by id via
 * runCommand). Extensions may override any of them with registerCommand(id, handler); the
 * extension-only ids (EXTENSION_COMMANDS in extensions.ts) have no built-in implementation.
 */
import type { LabelKind, ProbeKind, ShapeKind } from '../../model/types';
import { GRID } from '../../model/types';
import { actions, cursorStore, getState } from '../store';
import { activeSheet, viewOf } from '../store/editorStore';
import { getSheet } from '../store/designOps';
import { levelSheets } from '../store/refdes';
import { confirmDialog, promptText } from '../common/dialogs';
import { focusCanvas, interaction } from '../editor/controller';
import { defineBuiltinCommand, simulation, type CommandHandler } from './extensions';
import {
  exportSheetPng,
  exportSheetSvg,
  newDocument,
  openDocument,
  printDesign,
  recoverAutosaved,
  saveDocument,
  saveDocumentAs,
} from './document';
import { openAboutDialog, openFindDialog, openPropertiesDialog, openShortcutsDialog } from './appDialogs';
import { showDesignTree } from './DesignTree';
import type { AlignMode } from '../store/schematicOps';

/** Dialogs of the schematic-capture round and the project manager load on first use. */
const dialogs = () => import('./schematicDialogs');
const projects = () => import('./projectDialogs');
/** Troubleshooting-practice dialogs (auto fault, reveal, clear) load on first use. */
const faults = () => import('./faultDialogs');
const digital = () => import('./digitalDialogs');
/** Component tools (wizard, symbol editor, database manager, SPICE import) load on first use. */
const partsUi = () => import('../parts/partDialogs');
/** Circuit wizards (555, filters, op-amp stages, BJT amplifier, PCB impedance) load on first use. */
const wizards = () => import('../wizards/wizardDialogs');
/** Instrument defaults dialog and printing of instrument faces load on first use. */
const instrumentUi = () => import('../integration/instrumentDialogs');
/** snippets, File information, File options, XML / KiCad / EDIF, template files (lazy chunk) */
const filesUi = () => import('../files/flows');
/** Select a component dialog (database / group / family / component, details, detail report) */
const placeUi = () => import('../parts/PlaceComponentDialog');
/** Update components from library, variant manager, library profile (lazy chunk) */
const libraryUi = () => import('../parts/libraryTools');
/** ERC options / report, net settings, capture area, customize UI, footprint manager (lazy chunk) */
const schematicTools = () => import('../schematicTools/flows');
/** Lesson authoring (teachers write their own lessons) loads on first use. */
const lessonUi = () => import('../learn/lessonFlows');
import { contextTopic, openHelp, openWelcome } from '../help/open';
import { showSpreadsheet } from './dockState';
import { ZOOM_STEP } from '../store/viewport';
import { t } from '../../i18n';

const PROBE_KINDS: ProbeKind[] = ['voltage', 'current', 'power', 'differential', 'digital', 'reference'];
export const SHAPE_KINDS: ShapeKind[] = ['line', 'polyline', 'rect', 'ellipse', 'arc', 'polygon', 'picture'];
const ALIGN_MODES: AlignMode[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
/** Connector tools: command id suffix -> label kind. */
const CONNECTORS: [string, LabelKind][] = [
  ['offpage', 'offpage'],
  ['hierConnector', 'hier'],
  ['globalConnector', 'global'],
  ['busEntry', 'bus-entry'],
];

/** Every command id implemented by the shell. */
export const BUILTIN_COMMANDS = [
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.exportSvg',
  'file.exportPng',
  'file.print',
  'file.printSetup',
  'file.newFromTemplate',
  'file.saveAsTemplate',
  'file.project',
  'file.packProject',
  'file.unpackProject',
  'file.snippetSave',
  'file.snippetPlace',
  'file.snippetOpen',
  'file.info',
  'file.exportXml',
  'file.importSchematic',
  'file.exportTemplate',
  'file.importTemplate',
  'file.recover',
  'options.fileOptions',
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'edit.delete',
  'edit.selectAll',
  'edit.rotateCw',
  'edit.rotateCcw',
  'edit.flipH',
  'edit.flipV',
  'edit.find',
  'edit.findReplace',
  'edit.properties',
  'edit.replaceComponent',
  'edit.editComponent',
  ...ALIGN_MODES.map((m) => `edit.align.${m}`),
  'edit.distribute.h',
  'edit.distribute.v',
  'edit.group',
  'edit.ungroup',
  'edit.lock',
  'edit.unlock',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoom100',
  'view.fitAll',
  'view.fitSelection',
  'view.grid',
  'view.erc',
  'view.browser',
  'view.properties',
  'view.dock',
  'view.nextSheet',
  'view.prevSheet',
  'view.designTree',
  'view.openBlock',
  'view.parentSheet',
  'place.component',
  'place.wire',
  'place.label',
  'place.text',
  ...PROBE_KINDS.map((k) => `place.probe.${k}`),
  'place.bus',
  ...CONNECTORS.map(([id]) => `place.${id}`),
  'place.busVector',
  'place.comment',
  ...SHAPE_KINDS.map((k) => `place.shape.${k}`),
  'place.newSubcircuit',
  'place.newHierBlock',
  'place.blockFromFile',
  'place.replaceBySubcircuit',
  'place.sheet',
  'place.ladderSheet',
  'place.renameSheet',
  'place.deleteSheet',
  'simulate.run',
  'simulate.pause',
  'simulate.stop',
  'simulate.runAnalysis',
  'simulate.clearMessages',
  'simulate.autoFault',
  'simulate.digitalSettings',
  'simulate.revealFaults',
  'simulate.clearFaults',
  'tools.clearErc',
  'tools.clearErcScope',
  'tools.ercOptions',
  'tools.ercReport',
  'tools.netSettings',
  'tools.footprints',
  'edit.captureArea',
  'edit.ncMarker',
  'options.customizeUi',
  'tools.annotate',
  'tools.renumber',
  'tools.componentWizard',
  'tools.modelMaker',
  'tools.symbolEditor',
  'tools.databaseManager',
  'tools.importModel',
  'tools.updateComponents',
  'tools.variants',
  'tools.exportLibraryProfile',
  'tools.importLibraryProfile',
  'tools.wizard.555',
  'tools.wizard.filter',
  'tools.wizard.opamp',
  'tools.wizard.bjt',
  'tools.wizard.pcb',
  'tools.pldWizard',
  'simulate.mcuEditor',
  'simulate.audio',
  'reports.partList',
  'reports.netList',
  'options.autosave',
  'options.beginnerMode',
  'options.sheetProperties',
  'options.instrumentDefaults',
  'file.printInstruments',
  'help.shortcuts',
  'help.gettingStarted',
  'help.whatsNew',
  'help.lessonEditor',
  'help.topics',
  'help.context',
  'help.welcome',
  'help.about',
] as const;

/** Rename the active sheet (prompt). */
export async function renameActiveSheet(sheetId = getState().activeSheetId): Promise<void> {
  const sheet = getSheet(getState().design, sheetId);
  if (!sheet) return;
  const name = await promptText({ title: t('app.commands.renameSheet'), label: t('app.commands.sheetName'), initial: sheet.name, validate: (v) => (v.trim() ? null : t('sheet.enterName')) });
  if (name !== null) actions.renameSheet(sheetId, name);
}

/** Delete a sheet after confirmation when it is not empty. */
export async function deleteSheetConfirmed(sheetId = getState().activeSheetId): Promise<void> {
  const s = getState();
  const sheet = getSheet(s.design, sheetId);
  if (!sheet || levelSheets(s.design, sheetId).length <= 1) return;
  const count = sheet.parts.length + sheet.wires.length + sheet.labels.length + sheet.probes.length + sheet.notes.length + (sheet.shapes?.length ?? 0);
  if (count > 0) {
    const ok = await confirmDialog({
      title: t('app.commands.deleteSheet'),
      message: t('app.commands.deleteNameAndItsCount', { name: sheet.name, count: count }),
      okLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
  }
  actions.deleteSheet(sheetId);
}

function cycleSheet(delta: number): void {
  const s = getState();
  const sheets = levelSheets(s.design, s.activeSheetId);
  const i = sheets.findIndex((x) => x.id === s.activeSheetId);
  const n = sheets.length;
  actions.setActiveSheet(sheets[(i + delta + n) % n].id);
}

function tool(fn: () => void): CommandHandler {
  return () => {
    fn();
    focusCanvas();
  };
}

let installed = false;

/** Define the built-in command handlers (idempotent). */
export function installBuiltinCommands(): void {
  if (installed) return;
  installed = true;
  const def = defineBuiltinCommand;

  // file
  def('file.new', () => newDocument());
  def('file.open', () => openDocument());
  def('file.save', async () => {
    await saveDocument();
  });
  def('file.saveAs', async () => {
    await saveDocumentAs();
  });
  def('file.exportSvg', () => exportSheetSvg());
  def('file.exportPng', () => exportSheetPng());
  def('file.print', () => printDesign());
  def('file.printSetup', async () => (await dialogs()).openPrintSetupDialog(() => void printDesign()));
  def('file.newFromTemplate', async () => (await dialogs()).openNewFromTemplateDialog());
  def('file.saveAsTemplate', async () => (await dialogs()).saveAsTemplateFlow());
  def('file.project', async () => (await projects()).openProjectDialog());
  def('file.packProject', async () => (await projects()).packCurrentProject());
  def('file.unpackProject', async () => (await projects()).unpackProjectFlow());
  def('file.snippetSave', async () => (await filesUi()).saveSnippetFlow());
  def('file.snippetPlace', async () => (await filesUi()).placeSnippetFromFileFlow());
  def('file.snippetOpen', async () => (await filesUi()).openSnippetFileFlow());
  def('file.info', async () => (await filesUi()).openFileInfoDialog());
  def('file.exportXml', async () => (await filesUi()).exportXmlFlow());
  def('file.importSchematic', async () => (await filesUi()).importSchematicFlow());
  def('file.exportTemplate', async () => (await filesUi()).exportTemplateFileFlow());
  def('file.importTemplate', async () => (await filesUi()).newFromTemplateFileFlow());
  def('file.recover', () => recoverAutosaved());
  def('options.fileOptions', async () => (await filesUi()).openFileOptionsDialog());

  // edit
  def('edit.undo', () => {
    interaction.escape();
    actions.undo();
  });
  def('edit.redo', () => {
    actions.redo();
  });
  def('edit.cut', () => actions.cut());
  def('edit.copy', () => {
    actions.copy();
  });
  def('edit.paste', () => {
    const at = cursorStore.getState().pos;
    actions.paste(at ?? undefined);
  });
  def('edit.duplicate', () => {
    actions.duplicate();
  });
  def('edit.delete', () => actions.deleteSelection());
  def('edit.selectAll', () => actions.selectAll());
  def('edit.rotateCw', () => actions.rotateSelection('cw'));
  def('edit.rotateCcw', () => actions.rotateSelection('ccw'));
  def('edit.flipH', () => actions.flipSelection('h'));
  def('edit.flipV', () => actions.flipSelection('v'));
  def('edit.find', () => openFindDialog());
  def('edit.findReplace', async () => (await dialogs()).openFindReplaceDialog());
  def('edit.replaceComponent', async () => (await dialogs()).openReplacePartDialog());
  def('edit.editComponent', async () => (await partsUi()).editSelectedComponent());
  for (const m of ALIGN_MODES) def(`edit.align.${m}`, () => actions.alignSelection(m));
  def('edit.distribute.h', () => actions.distributeSelection('h'));
  def('edit.distribute.v', () => actions.distributeSelection('v'));
  def('edit.group', () => {
    actions.groupSelection();
  });
  def('edit.ungroup', () => actions.ungroupSelection());
  def('edit.lock', () => actions.setLocked(true));
  def('edit.unlock', () => actions.setLocked(false));
  def('edit.properties', () => {
    const sel = getState().selection;
    if (sel.length === 1) openPropertiesDialog(sel[0]);
  });

  // view
  def('view.zoomIn', () => actions.zoomBy(ZOOM_STEP));
  def('view.zoomOut', () => actions.zoomBy(1 / ZOOM_STEP));
  def('view.zoom100', () => actions.zoomTo(1));
  def('view.fitAll', () => actions.fitAll());
  def('view.fitSelection', () => actions.fitSelection());
  def('view.grid', () => actions.setShowGrid(!getState().showGrid));
  def('view.erc', () => actions.setShowErc(!getState().showErc));
  def('view.browser', () => actions.setUi({ browserOpen: !getState().ui.browserOpen }));
  def('view.properties', () => actions.setUi({ propertiesOpen: !getState().ui.propertiesOpen }));
  def('view.dock', () => actions.setUi({ dockOpen: !getState().ui.dockOpen }));
  def('view.nextSheet', () => cycleSheet(1));
  def('view.prevSheet', () => cycleSheet(-1));
  def('view.designTree', () => {
    if (!getState().ui.browserOpen) actions.setUi({ browserOpen: true });
    showDesignTree();
  });
  def('view.openBlock', async () => {
    (await dialogs()).openSelectedBlock();
  });
  def('view.parentSheet', () => {
    actions.goToParent();
  });

  // place
  def('place.component', async () => (await placeUi()).openPlaceComponentDialog());
  def('place.wire', tool(() => actions.setTool({ kind: 'wire' })));
  def('place.label', tool(() => actions.setTool({ kind: 'label' })));
  def('place.text', tool(() => actions.setTool({ kind: 'text' })));
  for (const k of PROBE_KINDS) def(`place.probe.${k}`, tool(() => actions.setTool({ kind: 'probe', probeKind: k })));
  def('place.bus', tool(() => actions.setTool({ kind: 'bus' })));
  for (const [id, kind] of CONNECTORS) def(`place.${id}`, tool(() => actions.setTool({ kind: 'label', labelKind: kind })));
  def('place.busVector', async () => (await dialogs()).busVectorFlow());
  def('place.comment', tool(() => actions.setTool({ kind: 'comment' })));
  for (const k of SHAPE_KINDS) def(`place.shape.${k}`, tool(() => actions.setTool({ kind: 'shape', shapeKind: k })));
  def('place.newSubcircuit', async () => (await dialogs()).newChildFlow('subcircuit'));
  def('place.newHierBlock', async () => (await dialogs()).newChildFlow('hierarchical'));
  def('place.blockFromFile', async () => (await dialogs()).blockFromFileFlow());
  def('place.replaceBySubcircuit', async () => (await dialogs()).replaceBySubcircuitFlow());
  def('place.sheet', () => {
    actions.addSheet();
  });
  def('place.ladderSheet', () => {
    actions.addLadderSheet();
    actions.addSimMessage('info', t('ladder.added'), 'ladder');
  });
  def('place.renameSheet', () => renameActiveSheet());
  def('place.deleteSheet', () => deleteSheetConfirmed());

  // simulate
  def('simulate.run', () => simulation.run());
  def('simulate.pause', () => simulation.pause());
  def('simulate.stop', () => simulation.stop());
  def('simulate.runAnalysis', () => simulation.runAnalysis(getState().design.analysis.active));
  def('simulate.clearMessages', () => actions.clearSimMessages());
  def('simulate.autoFault', async () => (await faults()).openAutoFaultDialog());
  def('simulate.digitalSettings', async () => (await digital()).openDigitalSettingsDialog());
  def('simulate.revealFaults', async () => (await faults()).revealFaultsFlow());
  def('simulate.clearFaults', async () => (await faults()).clearFaultsFlow());

  // tools
  def('tools.clearErc', () => actions.clearErcMarkers());
  def('tools.clearErcScope', async () => (await schematicTools()).openClearErcDialog());
  def('tools.ercOptions', async () => (await schematicTools()).openErcOptionsDialog());
  def('tools.ercReport', async () => (await schematicTools()).exportErcReportDialog());
  def('tools.netSettings', async () => (await schematicTools()).openNetSettingsDialog());
  def('tools.footprints', async () => (await schematicTools()).openFootprintManager());
  def('edit.captureArea', tool(() => actions.setTool({ kind: 'capture' })));
  def('edit.ncMarker', async () => (await schematicTools()).openNcMarkerDialog());
  def('tools.annotate', () => {
    const n = actions.annotate('missing');
    actions.addSimMessage('info', n ? t('annotate.done', { n }) : t('annotate.none'), 'annotate');
  });
  def('tools.renumber', async () => {
    const ok = await confirmDialog({ title: t('app.commands.renumberAllParts'), message: t('app.commands.renumberEveryReferenceDesignatorPer'), okLabel: t('app.commands.renumber') });
    if (ok) actions.annotate('all');
  });

  def('tools.componentWizard', async () => (await partsUi()).openComponentWizard());
  def('tools.modelMaker', async () => (await partsUi()).openModelMaker());
  def('tools.symbolEditor', async () => (await partsUi()).openSymbolEditor());
  def('tools.databaseManager', async () => (await partsUi()).openDatabaseManager());
  def('tools.importModel', async () => (await partsUi()).openSpiceImport());
  def('tools.updateComponents', async () => (await libraryUi()).openUpdateComponentsDialog());
  def('tools.variants', async () => (await libraryUi()).openVariantManager());
  def('tools.exportLibraryProfile', async () => (await libraryUi()).exportLibraryProfileFlow());
  def('tools.importLibraryProfile', async () => (await libraryUi()).importLibraryProfileFlow());
  for (const k of ['555', 'filter', 'opamp', 'bjt', 'pcb'] as const) def(`tools.wizard.${k}`, async () => (await wizards()).openCircuitWizard(k));

  // reports
  def('reports.partList', () => showSpreadsheet('parts'));
  def('reports.netList', () => showSpreadsheet('nets'));

  // options
  def('options.autosave', () => actions.setUi({ autosave: !getState().ui.autosave }));
  def('options.beginnerMode', () => {
    const on = getState().ui.beginner !== true;
    actions.setUi({ beginner: on });
    actions.addSimMessage('info', on ? t('beginner.turnedOn') : t('beginner.turnedOff'), 'beginner');
  });
  def('options.customizeUi', async () => (await schematicTools()).openCustomizeDialog());
  def('options.sheetProperties', async () => (await dialogs()).openSheetSetupDialog());
  def('options.instrumentDefaults', async () => (await instrumentUi()).openInstrumentDefaultsDialog());
  def('file.printInstruments', async () => (await instrumentUi()).printInstrumentFaces());

  // help
  def('help.shortcuts', () => openShortcutsDialog());
  def('help.gettingStarted', () => openHelp({ kind: 'start' }));
  def('help.whatsNew', () => openHelp({ kind: 'guide', page: 'whatsNew' }));
  def('help.lessonEditor', async () => (await lessonUi()).openLessonEditor());
  def('help.topics', () => openHelp({ kind: 'index' }));
  def('help.context', () => openHelp(contextTopic(getState())));
  def('help.welcome', () => openWelcome());
  def('help.about', () => openAboutDialog());
}

/** Arrow keys on the canvas: nudge the selection (Shift = 5 grid steps) or pan the view. */
export function arrowKey(key: string, shift: boolean): boolean {
  const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = dir[key];
  if (!d) return false;
  const s = getState();
  if (s.selection.length > 0 && s.tool.kind === 'select') {
    const step = GRID * (shift ? 5 : 1);
    actions.nudge(d[0] * step, d[1] * step);
  } else {
    const view = viewOf(s);
    const px = shift ? 200 : 60;
    actions.setView(s.activeSheetId, { ...view, panX: view.panX - d[0] * px, panY: view.panY - d[1] * px });
  }
  return true;
}

/** Sheet currently shown (convenience for components). */
export const currentSheet = () => activeSheet(getState());
