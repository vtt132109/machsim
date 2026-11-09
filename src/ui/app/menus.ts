/**
 * Menu bar model (pure): File, Edit, View, Place, Simulate, Tools, Reports, Options, Help.
 * Labels come from the i18n catalogue (command labels are `cmd.<command id>`), so the model
 * is in the current language whenever it is rebuilt.
 *
 * Items run commands by id through {@link MenuContext.run}; an item is disabled when no handler
 * is registered for its command (extension commands such as reports.bom stay visibly disabled
 * until the integration layer registers them) or when the current state makes it meaningless
 * (nothing to undo, nothing selected ...). The model is rebuilt whenever a menu opens.
 */
import type { MenuEntry } from '../common/Menu';
import type { AnalysisType } from '../../sim/netlist';
import type { ProbeKind, ShapeKind } from '../../model/types';
import { findSheet } from '../../model/hierarchy';
import type { EditorState, ThemeMode } from '../store/types';
import type { RecentEntry } from './files';
import { shortcutLabel } from './shortcuts';
import { getLang, lazyRecord, LANG_NAMES, LANGS, setLang, t, type MessageKey } from '../../i18n';

const ANALYSIS_TYPES: AnalysisType[] = [
  'op', 'tran', 'ac', 'dc', 'acsingle', 'noise', 'noisefig', 'four', 'disto', 'tf', 'sens', 'pz',
  'paramsweep', 'tempsweep', 'nestedsweep', 'montecarlo', 'worstcase', 'tracewidth', 'batch', 'user',
];

/** Display names of the analysis types (selector, Simulate menu), in the current language. */
export const ANALYSIS_LABELS: Readonly<Record<AnalysisType, string>> = lazyRecord(ANALYSIS_TYPES, (k) => t(`analysis.name.${k}`));

export const ANALYSIS_ORDER: AnalysisType[] = [...ANALYSIS_TYPES];

const PROBE_KINDS: ProbeKind[] = ['voltage', 'current', 'power', 'differential', 'digital', 'reference'];

export const PROBE_KIND_LABELS: Readonly<Record<ProbeKind, string>> = lazyRecord(PROBE_KINDS, (k) => t(`probe.kind.${k}`));

export interface MenuContext {
  state: EditorState;
  /** true when a handler exists for the command id */
  has(id: string): boolean;
  run(id: string): void;
  recent: readonly RecentEntry[];
  openRecent(entry: RecentEntry): void;
  clearRecent(): void;
  /** desktop: project files opened recently (absent / empty in browsers) */
  recentProjects?: readonly string[];
  openRecentProject?(path: string): void;
  setAnalysis(type: AnalysisType): void;
  setTheme(mode: ThemeMode): void;
  setActiveSheet(id: string): void;
  /** make a design variant the active one (Tools › Active variant); absent = the submenu is read-only */
  setVariant?(id: string): void;
  /** true when a real simulation controller is installed */
  simulationConnected: boolean;
  /** the open designs (document tabs), for the Window menu; absent = the menu lists none */
  documents?: readonly { id: string; label: string; dirty: boolean; active: boolean }[];
  switchDocument?(id: string): void;
}

export interface TopMenu {
  id: string;
  label: string;
  items: MenuEntry[];
}

const SEP: MenuEntry = { type: 'separator' };

export function buildMenus(ctx: MenuContext): TopMenu[] {
  const s = ctx.state;
  const item = (id: string, opts: { enabled?: boolean; checked?: boolean; danger?: boolean } = {}, label: string = t(`cmd.${id}` as MessageKey)): MenuEntry => ({
    id,
    label,
    shortcut: shortcutLabel(id),
    disabled: !ctx.has(id) || opts.enabled === false,
    checked: opts.checked,
    danger: opts.danger,
    onSelect: () => ctx.run(id),
  });
  const hasSel = s.selection.length > 0;
  const loc = findSheet(s.design, s.activeSheetId);
  const sheet = loc?.sheet ?? s.design.sheets[0];
  const levelSheets = loc?.child ? loc.child.sheets : s.design.sheets;
  const sheetEmpty = sheet.parts.length + sheet.wires.length + sheet.labels.length + sheet.probes.length + sheet.notes.length + (sheet.shapes?.length ?? 0) === 0;
  const multi = s.selection.length > 1;
  const partSelected = s.selection.some((x) => x.kind === 'part');
  const blockSelected = s.selection.some((x) => x.kind === 'part' && sheet.parts.find((p) => p.id === x.id)?.partId.startsWith('hier:'));
  const annotationSelected = s.selection.some((x) => x.kind === 'shape' || x.kind === 'note');
  const running = s.sim.state === 'running';
  /** analyses the instructor disabled for this design */
  const disabledAnalyses: readonly AnalysisType[] = s.design.restrictions?.disabledAnalyses ?? [];
  const active = s.sim.state === 'running' || s.sim.state === 'paused';

  const recentItems: MenuEntry[] = ctx.recent.length
    ? [
        ...ctx.recent.map(
          (e, i): MenuEntry => ({
            label: `${i + 1}  ${e.name}`,
            disabled: !e.path && e.content === undefined,
            onSelect: () => ctx.openRecent(e),
          }),
        ),
        SEP,
        { label: t('menu.clearRecent'), onSelect: () => ctx.clearRecent() },
      ]
    : [{ label: t('menu.noRecent'), disabled: true, onSelect: () => undefined }];

  const projects = ctx.recentProjects ?? [];
  const recentProjectItems: MenuEntry[] = projects.length
    ? projects.map((p, i): MenuEntry => ({ label: `${i + 1}  ${p.split(/[\\/]/).pop() ?? p}`, onSelect: () => ctx.openRecentProject?.(p) }))
    : [{ label: t('menu.noRecentProjects'), disabled: true, onSelect: () => undefined }];

  const file: MenuEntry[] = [
    item('file.new'),
    item('file.newFromTemplate'),
    item('file.importTemplate'),
    item('file.open'),
    { type: 'submenu', label: t('menu.openRecent'), items: recentItems },
    { type: 'submenu', label: t('menu.recentProjects'), items: recentProjectItems },
    item('file.examples'),
    SEP,
    item('file.close'),
    item('file.closeAll', { enabled: (ctx.documents?.length ?? 1) > 1 || s.design !== s.savedDesign }),
    SEP,
    item('file.save'),
    item('file.saveAs'),
    item('file.saveAll', { enabled: (ctx.documents ?? []).some((d) => d.dirty) }),
    item('file.saveAsTemplate'),
    item('file.exportTemplate'),
    SEP,
    {
      type: 'submenu',
      label: t('menu.snippets'),
      items: [item('file.snippetSave', { enabled: hasSel }), item('file.snippetPlace'), item('file.snippetOpen')],
    },
    {
      type: 'submenu',
      label: t('menu.project'),
      items: [item('file.project'), item('file.packProject'), item('file.unpackProject')],
    },
    SEP,
    item('file.importSpice'),
    item('file.importSpiceSchematic'),
    item('file.importSchematic'),
    item('file.exportSpice'),
    item('file.exportXml'),
    item('file.exportSvg'),
    item('file.exportPng'),
    {
      type: 'submenu',
      label: t('menu.transfer'),
      items: [item('file.transfer.kicad'), item('file.transfer.csv'), SEP, item('file.transfer.forward'), item('file.transfer.backward')],
    },
    SEP,
    item('file.info'),
    item('file.recover'),
    SEP,
    item('file.printSetup'),
    item('file.print'),
    item('file.printInstruments'),
  ];

  const edit: MenuEntry[] = [
    item('edit.undo', { enabled: s.history.past.length > 0 }),
    item('edit.redo', { enabled: s.history.future.length > 0 }),
    SEP,
    item('edit.cut', { enabled: hasSel }),
    item('edit.copy', { enabled: hasSel }),
    item('edit.paste', { enabled: s.clipboardAvailable }),
    {
      type: 'submenu',
      id: 'menu.pasteSpecial',
      label: t('menu.pasteSpecial'),
      items: [item('edit.pasteSpecial.keepNames', { enabled: s.clipboardAvailable }), item('edit.pasteSpecial.values', { enabled: s.clipboardAvailable && partSelected }), item('edit.pasteSpecial.block', { enabled: s.clipboardAvailable })],
    },
    item('edit.duplicate', { enabled: hasSel }),
    item('edit.delete', { enabled: hasSel }),
    item('file.snippetSave', { enabled: hasSel }),
    item('edit.selectAll', { enabled: !sheetEmpty }),
    SEP,
    item('edit.rotateCw', { enabled: hasSel }),
    item('edit.rotateCcw', { enabled: hasSel }),
    item('edit.flipH', { enabled: hasSel }),
    item('edit.flipV', { enabled: hasSel }),
    SEP,
    {
      type: 'submenu',
      label: t('menu.arrange'),
      items: [
        item('edit.align.left', { enabled: multi }),
        item('edit.align.hcenter', { enabled: multi }),
        item('edit.align.right', { enabled: multi }),
        item('edit.align.top', { enabled: multi }),
        item('edit.align.vcenter', { enabled: multi }),
        item('edit.align.bottom', { enabled: multi }),
        SEP,
        item('edit.distribute.h', { enabled: s.selection.length > 2 }),
        item('edit.distribute.v', { enabled: s.selection.length > 2 }),
        SEP,
        item('edit.group', { enabled: multi }),
        item('edit.ungroup', { enabled: hasSel }),
        item('edit.lock', { enabled: hasSel }),
        item('edit.unlock', { enabled: hasSel }),
      ],
    },
    {
      type: 'submenu',
      id: 'menu.order',
      label: t('menu.order'),
      items: [
        item('edit.order.front', { enabled: annotationSelected }),
        item('edit.order.forward', { enabled: annotationSelected }),
        item('edit.order.backward', { enabled: annotationSelected }),
        item('edit.order.back', { enabled: annotationSelected }),
      ],
    },
    item('edit.layers'),
    item('edit.replaceComponent', { enabled: partSelected && !blockSelected }),
    item('edit.editComponent', { enabled: s.selection.length === 1 && partSelected && !blockSelected }),
    item('edit.ncMarker', { enabled: partSelected }),
    // the ladder editor has no schematic canvas to drag a capture rectangle on (Print and Export
    // image do draw a ladder sheet, see src/ui/editor/ladderSvg.ts)
    item('edit.captureArea', { checked: s.tool.kind === 'capture', enabled: sheet.kind !== 'ladder' }),
    SEP,
    item('edit.find'),
    item('edit.findReplace'),
    item('edit.properties', { enabled: s.selection.length === 1 }),
  ];

  const view: MenuEntry[] = [
    item('view.zoomIn'),
    item('view.zoomOut'),
    item('view.zoom100'),
    item('view.fitAll'),
    item('view.fitSelection', { enabled: hasSel }),
    SEP,
    item('view.grid', { checked: s.showGrid }),
    item('view.erc', { checked: s.showErc }),
    SEP,
    item('view.browser', { checked: s.ui.browserOpen }),
    item('view.properties', { checked: s.ui.propertiesOpen }),
    item('view.dock', { checked: s.ui.dockOpen }),
    SEP,
    {
      type: 'submenu',
      label: t('menu.sheet'),
      items: levelSheets.map((sh) => ({ label: sh.name, checked: sh.id === s.activeSheetId, onSelect: () => ctx.setActiveSheet(sh.id) })),
    },
    item('view.nextSheet', { enabled: levelSheets.length > 1 }),
    item('view.prevSheet', { enabled: levelSheets.length > 1 }),
    SEP,
    item('view.designTree'),
    item('view.openBlock', { enabled: blockSelected }),
    item('view.parentSheet', { enabled: !!loc?.child }),
  ];

  const probeKinds = Object.keys(PROBE_KIND_LABELS) as ProbeKind[];
  const labelTool = (k: string) => s.tool.kind === 'label' && (s.tool.labelKind ?? 'label') === k;
  const shapeKinds: ShapeKind[] = ['line', 'polyline', 'rect', 'ellipse', 'arc', 'polygon', 'picture'];
  const place: MenuEntry[] = [
    item('place.component'),
    item('place.wire', { checked: s.tool.kind === 'wire' }),
    item('place.bus', { checked: s.tool.kind === 'bus' }),
    item('place.label', { checked: labelTool('label') }),
    {
      type: 'submenu',
      label: t('menu.connectors'),
      items: [
        item('place.offpage', { checked: labelTool('offpage') }),
        item('place.hierConnector', { checked: labelTool('hier') }),
        item('place.globalConnector', { checked: labelTool('global') }),
        SEP,
        item('place.busEntry', { checked: labelTool('bus-entry') }),
        item('place.busVector', { enabled: partSelected }),
      ],
    },
    {
      type: 'submenu',
      label: t('menu.hierarchy'),
      items: [
        item('place.newSubcircuit'),
        item('place.newHierBlock'),
        item('place.blockFromFile'),
        SEP,
        item('place.replaceBySubcircuit', { enabled: partSelected }),
      ],
    },
    {
      type: 'submenu',
      label: t('menu.probe'),
      items: probeKinds.map((k) => item(`place.probe.${k}`, { checked: s.tool.kind === 'probe' && s.tool.probeKind === k }, PROBE_KIND_LABELS[k])),
    },
    SEP,
    item('place.text', { checked: s.tool.kind === 'text' }),
    item('place.comment', { checked: s.tool.kind === 'comment' }),
    {
      type: 'submenu',
      label: t('menu.graphics'),
      items: shapeKinds.map((k) => item(`place.shape.${k}`, { checked: s.tool.kind === 'shape' && s.tool.shapeKind === k })),
    },
    SEP,
    item('place.sheet'),
    item('place.ladderSheet'),
    item('place.renameSheet'),
    item('place.deleteSheet', { enabled: levelSheets.length > 1, danger: true }),
  ];

  const simulate: MenuEntry[] = [
    item('simulate.run', { enabled: !running }, running ? t('menu.running') : s.sim.state === 'paused' ? t('menu.resume') : t('cmd.simulate.run')),
    item('simulate.pause', { enabled: running }),
    item('simulate.stop', { enabled: active }),
    SEP,
    {
      type: 'submenu',
      label: t('menu.activeAnalysis'),
      items: ANALYSIS_ORDER.map((t) => ({ id: `analysis.${t}`, label: ANALYSIS_LABELS[t], checked: s.design.analysis.active === t, disabled: disabledAnalyses.includes(t), onSelect: () => ctx.setAnalysis(t) })),
    },
    item('simulate.runAnalysis', { enabled: !running && !disabledAnalyses.includes(s.design.analysis.active) }, t('menu.runAnalysis', { analysis: ANALYSIS_LABELS[s.design.analysis.active] })),
    item('simulate.analysisSettings'),
    item('simulate.interactiveSettings'),
    item('simulate.digitalSettings'),
    item('simulate.convergenceAssistant'),
    SEP,
    item('simulate.grapher'),
    item('simulate.postprocessor'),
    item('simulate.importMeasurement'),
    item('simulate.audio'),
    SEP,
    item('simulate.mcuEditor'),
    SEP,
    item('simulate.clearMessages', { enabled: s.simMessages.length > 0 }),
    SEP,
    item('simulate.autoFault'),
    item('simulate.revealFaults', { enabled: !!s.design.autoFault && !s.design.autoFault.revealed }),
    item('simulate.clearFaults', { enabled: s.design.sheets.some((sh) => sh.parts.some((p) => (p.faults?.length ?? 0) > 0)) }),
    ...(ctx.simulationConnected ? [] : [SEP, { label: t('menu.engineNotConnected'), disabled: true, onSelect: () => undefined } satisfies MenuEntry]),
  ];

  const variants = s.design.variants?.list ?? [];
  const activeId = variants.find((v) => v.id === s.design.variants?.active)?.id ?? variants[0]?.id;
  const variantItems: MenuEntry[] = variants.length
    ? variants.map((v) => ({ label: v.name, checked: v.id === activeId, onSelect: () => ctx.setVariant?.(v.id) }))
    : [{ label: t('menu.noVariants'), disabled: true, onSelect: () => undefined }];
  const tools: MenuEntry[] = [
    item('tools.erc'),
    item('tools.clearErc', { enabled: s.ercMarkers.length > 0 }),
    {
      type: 'submenu',
      label: t('menu.ercTools'),
      items: [item('tools.ercOptions'), item('tools.ercReport'), item('tools.clearErcScope', { enabled: s.ercMarkers.length > 0 })],
    },
    SEP,
    item('tools.netSettings', { enabled: hasSel }),
    item('tools.footprints'),
    SEP,
    item('tools.annotate'),
    item('tools.renumber'),
    item('tools.refdesRules'),
    SEP,
    {
      type: 'submenu',
      label: t('menu.componentTools'),
      items: [item('tools.componentWizard'), item('tools.modelMaker'), item('tools.symbolEditor'), SEP, item('tools.databaseManager'), item('tools.importModel')],
    },
    {
      type: 'submenu',
      label: t('menu.circuitWizards'),
      items: [item('tools.wizard.555'), item('tools.wizard.filter'), item('tools.wizard.opamp'), item('tools.wizard.bjt'), SEP, item('tools.wizard.pcb'), SEP, item('tools.pldWizard')],
    },
    {
      type: 'submenu',
      label: t('menu.myLibrary'),
      items: [item('tools.exportLibraryProfile'), item('tools.importLibraryProfile')],
    },
    item('tools.updateComponents'),
    SEP,
    item('tools.variants'),
    { type: 'submenu', id: 'menu.activeVariant', label: t('menu.activeVariant'), items: variantItems },
    SEP,
    item('tools.descriptionBox'),
    SEP,
    item('edit.find'),
  ];

  const reports: MenuEntry[] = [
    item('reports.bom'),
    item('reports.netlist'),
    SEP,
    item('reports.partList'),
    item('reports.netList'),
    SEP,
    item('reports.bomFull'),
    item('reports.componentDetail'),
    item('reports.modelData'),
    item('reports.spareGates'),
    item('reports.crossReference'),
    item('reports.statistics'),
    SEP,
    item('reports.center'),
  ];

  const themes: { mode: ThemeMode; label: string }[] = [
    { mode: 'system', label: t('menu.themeSystem') },
    { mode: 'light', label: t('menu.themeLight') },
    { mode: 'dark', label: t('menu.themeDark') },
  ];
  const options: MenuEntry[] = [
    { type: 'submenu', label: t('menu.theme'), items: themes.map((th) => ({ label: th.label, checked: s.ui.theme === th.mode, onSelect: () => ctx.setTheme(th.mode) })) },
    {
      type: 'submenu',
      label: t('menu.language'),
      items: LANGS.map((l) => ({ label: LANG_NAMES[l], checked: getLang() === l, onSelect: () => setLang(l) })),
    },
    item('view.grid', { checked: s.showGrid }, t('menu.showGrid')),
    item('options.beginnerMode', { checked: s.ui.beginner === true }),
    item('options.autosave', { checked: s.ui.autosave }),
    item('options.fileOptions'),
    item('options.customizeUi'),
    SEP,
    item('options.sheetProperties'),
    item('options.instrumentDefaults'),
    SEP,
    item('options.instructor'),
  ];

  const docs = ctx.documents ?? [];
  const windowMenu: MenuEntry[] = [
    item('window.next', { enabled: docs.length > 1 }),
    item('window.previous', { enabled: docs.length > 1 }),
    item('window.recent', { enabled: docs.length > 1 }),
    SEP,
    ...docs.map((d, i): MenuEntry => ({ label: `${i + 1}  ${d.label}${d.dirty ? '  ●' : ''}`, checked: d.active, onSelect: () => ctx.switchDocument?.(d.id) })),
    SEP,
    item('file.close'),
    item('file.closeAll'),
  ];

  const help: MenuEntry[] = [
    item('help.gettingStarted'),
    item('help.whatsNew'),
    item('help.lessons'),
    item('help.lessonEditor'),
    item('help.context'),
    item('help.topics'),
    item('help.shortcuts'),
    item('help.commandLine'),
    SEP,
    item('help.welcome'),
    item('help.about'),
  ];

  return [
    { id: 'file', label: t('menu.file'), items: file },
    { id: 'edit', label: t('menu.edit'), items: edit },
    { id: 'view', label: t('menu.view'), items: view },
    { id: 'place', label: t('menu.place'), items: place },
    { id: 'simulate', label: t('menu.simulate'), items: simulate },
    { id: 'tools', label: t('menu.tools'), items: tools },
    { id: 'reports', label: t('menu.reports'), items: reports },
    { id: 'options', label: t('menu.options'), items: options },
    { id: 'window', label: t('menu.window'), items: windowMenu },
    { id: 'help', label: t('menu.help'), items: help },
  ];
}
