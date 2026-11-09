/**
 * MachSim application shell.
 *
 *   ┌ menu bar ─────────────────────────────────────────────────────────┐
 *   ├ toolbar ──────────────────────────────────────────────────────────┤
 *   │ component  │ view tabs (Schematic | extension views)  │ properties │
 *   │ browser    │ sheet tabs                               │ panel      │
 *   │            │ schematic canvas (or the active view)    │            │
 *   ├────────────┴──────────────────────────────────────────┴────────────┤
 *   │ bottom dock (Spreadsheet + extension tabs)                         │
 *   ├ status bar ───────────────────────────────────────────────────────┤
 *   floating windows, context menu and modal dialogs are layered on top.
 *
 * The shell owns global keyboard handling (see shortcuts.ts for the precedence rules), theme
 * application, the UI language (src/i18n; the whole tree is remounted by LanguageRoot when it
 * changes), persisted preferences, autosave / recovery, the first-run welcome panel and the
 * desktop-bridge integration.
 * Integration code extends it through src/ui/app/extensions.ts.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { actions, getState, partLookup, subscribe, useEditor } from '../store';
import { newLocalizedDesign } from '../store/editorStore';
import { ContextMenuHost } from '../common/Menu';
import { DialogHost, isDialogOpen } from '../common/dialogs';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { Splitter } from '../common/Splitter';
import { Tabs } from '../common/Tabs';
import { LeftPanel } from './DesignTree';
import { PropertiesPanel } from '../editor/PropertiesPanel';
import { SchematicCanvas } from '../editor/SchematicCanvas';
import { lazyComponent } from '../common/lazy';
import { getSheet } from '../store/designOps';
import { interaction } from '../editor/controller';
import { BottomDock } from './BottomDock';
import { FloatingWindowHost } from './FloatingWindowHost';
import { MenuBar, focusMenuBar } from './MenuBar';
import { SheetTabs } from './SheetTabs';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { installCanvasHost } from './canvasHost';
import { arrowKey, BUILTIN_COMMANDS, installBuiltinCommands } from './commands';
import { installAutosave, installDocumentChrome, offerRecovery, onDocumentLoaded, registerOpenTransform, registerSaveTransform } from './document';
import { SCHEMATIC_VIEW_ID, activeMainView, hasCommand, isSchematicViewActive, mainViews, runCommand, showMainView } from './extensions';
import { browserStorage } from './files';
import { PANEL_LIMITS, prefsOf, readPrefs, writePrefs, type UiPrefs } from './prefs';
import { applyUserShortcuts } from './customize';
import { fitDockHeight, fitSidePanels } from './layout';
import { getDesktopBridge } from '../../desktop/bridge';
import { getLang, setLang, subscribeLang } from '../../i18n';
import { maybeShowWelcome, welcomePrefs } from '../help/open';
import { resolveShortcut, shortcutLabel, type KeyChord } from './shortcuts';
import { beginnerCommand } from './beginner';
import { findUserPart, installDesignLink, installPartDatabases } from '../parts/partDatabases';
import { compareWithLibrary, stampLibraryRefs, stampLibraryRefsAtLoad } from '../store/libraryUpdate';
import { installLearn } from '../learn/install';
import { installReports } from '../reports/install';
import { installFileFeatures } from '../files/install';
import { installLibraryAutoload } from '../../model/libraryLoad';
import './app.css';
import { t, tDynamic } from '../../i18n';

installBuiltinCommands();
installCanvasHost();
// lessons, description box, instructor mode, reports, PCB transfer and SPICE-to-schematic import
installLearn();
installReports();
// snippets (drop / paste), XML / KiCad / EDIF / closed formats in File > Open
installFileFeatures();
// user / corporate part databases: listed in the browser once loaded; the open design's embedded
// components stay registered so getPart() finds them everywhere
void installPartDatabases();
installDesignLink(subscribe, { getDesign: () => getState().design, applyDesign: (fn) => actions.applyDesign(fn) });
// catalogue packs load on demand: a design that uses parts of a pack not loaded yet loads it
installLibraryAutoload(subscribe, () => getState().design);
// every save records the library definition of the placed parts (Update components from library),
// and opening a design whose parts differ from the current library says so
registerSaveTransform((d) => stampLibraryRefs(d, partLookup));
// a file written before libraryRefs existed (a teacher's older design) gets its baseline stamped
// in memory at load, so the comparison reports real differences instead of nothing at all
registerOpenTransform((d) => stampLibraryRefsAtLoad(d, partLookup));
onDocumentLoaded((d) => {
  const n = compareWithLibrary(d, partLookup, (id) => findUserPart(id)?.part).length;
  if (n) actions.addSimMessage('info', t('update.openNotice', { n }), 'library');
});

// apply stored preferences before the first render (no layout flicker)
{
  const prefs = readPrefs(browserStorage());
  actions.setUi(prefs.ui);
  // the learner's own keyboard shortcuts (Options > Customize user interface)
  if (prefs.ui.shortcuts) applyUserShortcuts(prefs.ui.shortcuts, BUILTIN_COMMANDS as unknown as string[]);
  if (prefs.showGrid !== undefined) actions.setShowGrid(prefs.showGrid);
  setLang(prefs.lang ?? 'vi');
  // the start-up document was created before the language was known: name its sheet in it
  const s0 = getState();
  if (s0.design === s0.savedDesign && s0.design.sheets.length === 1 && s0.design.sheets[0].parts.length === 0) actions.loadDesign(newLocalizedDesign(), s0.fileName);
  if (prefs.welcome) welcomePrefs.setState(prefs.welcome);
  if (typeof document !== 'undefined') document.documentElement.lang = getLang();
}

/** Everything persisted: editor UI state, language and the welcome-panel state. */
function allPrefs(): UiPrefs {
  return { ...prefsOf(getState()), lang: getLang(), welcome: welcomePrefs.getState() };
}

/** Tell the desktop shell the UI language (native dialogs follow it). */
function syncDesktopLanguage(): void {
  getDesktopBridge()?.setLanguage?.(getLang());
}

let started = false;

/** Start-up services: preference persistence, autosave, document chrome, recovery prompt (once). */
function startShell(): () => void {
  const storage = browserStorage();
  let last = JSON.stringify(allPrefs());
  const save = () => {
    const next = JSON.stringify(allPrefs());
    if (next !== last) {
      last = next;
      writePrefs(storage, allPrefs());
    }
  };
  const unsubPrefs = subscribe(save);
  const unsubWelcome = welcomePrefs.subscribe(save);
  const unsubLang = subscribeLang(() => {
    save();
    syncDesktopLanguage();
  });
  syncDesktopLanguage();
  const stopAutosave = installAutosave();
  const stopChrome = installDocumentChrome();
  if (!started) {
    started = true;
    void offerRecovery().then(() => maybeShowWelcome());
  }
  return () => {
    unsubPrefs();
    unsubWelcome();
    unsubLang();
    stopAutosave();
    stopChrome();
  };
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file'].includes(type);
  }
  return false;
}

/** Focus is on the schematic or on no particular control. */
function inCanvasScope(el: Element | null): boolean {
  if (!el || el === document.body || el === document.documentElement) return true;
  return !!el.closest('.ms-canvas');
}

function chord(e: KeyboardEvent): KeyChord & { repeat: boolean } {
  return { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat };
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || isDialogOpen()) return;
  const target = document.activeElement;
  const inField = isEditable(target);
  // canvas shortcuts (Delete, R, arrows, interactive part keys) act only while the schematic is shown
  // a ladder sheet has its own editor: the canvas keys (Delete, R, arrows) must not reach the
  // schematic selection behind it
  const ladderSheet = getSheet(getState().design, getState().activeSheetId)?.kind === 'ladder';
  const canvasScope = !inField && !ladderSheet && inCanvasScope(target) && isSchematicViewActive();
  const k = chord(e);
  if (e.key === 'F10' && !k.ctrl && !k.shift && !k.alt) {
    e.preventDefault();
    focusMenuBar();
    return;
  }
  const s = getState();
  if (canvasScope) {
    if (interaction.keyDown(k)) {
      e.preventDefault();
      return;
    }
    if (s.tool.kind === 'select' && interaction.interactiveKey(k, 'down')) {
      e.preventDefault();
      return;
    }
    if (!k.ctrl && !k.alt && arrowKey(e.key, e.shiftKey)) {
      e.preventDefault();
      return;
    }
  }
  const id = resolveShortcut(k, { tool: s.tool.kind, hasSelection: s.selection.length > 0, inField, canvasScope });
  // Ctrl+V with MachSim's own clipboard empty: let the browser deliver its paste event, which may
  // carry a snippet picture copied in the file manager (src/ui/files/install.ts)
  if (id === 'edit.paste' && !s.clipboardAvailable) return;
  if (id && hasCommand(id)) {
    e.preventDefault();
    if (!beginnerShortcutAllowed(id)) return;
    runCommand(id);
  }
}

/**
 * Beginner mode is a filter on the WHOLE interface, not only on the menus: a shortcut of a hidden
 * command does not silently open a dialog the simplified interface never mentions. Instead the
 * learner is told which command it was and how to get the full interface back — the message names
 * Options › Chế độ người mới and the status-bar cell, both one click away.
 */
function beginnerShortcutAllowed(id: string): boolean {
  if (getState().ui.beginner !== true || beginnerCommand(id)) return true;
  const keys = shortcutLabel(id);
  actions.addSimMessage('info', t('beginner.hiddenCommand', { command: tDynamic(`cmd.${id}`, undefined, id), keys: keys ?? '' }), t('sim.source.beginner'));
  return false;
}

function onKeyUp(e: KeyboardEvent): void {
  if (isDialogOpen()) return;
  const target = document.activeElement;
  if (isEditable(target) || !inCanvasScope(target) || !isSchematicViewActive()) return;
  if (getState().tool.kind === 'select' && interaction.interactiveKey(chord(e), 'up')) e.preventDefault();
}

/** Calls a view's render function inside its own component so the error boundary catches it. */
function RenderView({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

/**
 * Centre area: the schematic (sheet tabs + canvas) or an extension view registered with
 * registerMainView (e.g. the 3D breadboard). The view tab strip appears once a view exists;
 * the schematic canvas unmounts while another view is shown.
 */
/** Ladder diagrams are their own kind of sheet: the editor loads with its own chunk. */
const LadderSheetView = lazyComponent(() => import('../ladder/LadderSheetView').then((m) => m.LadderSheetView));

/** The drawing of the active sheet: the schematic canvas, or the ladder editor. */
function SheetBody() {
  const kind = useEditor((s) => getSheet(s.design, s.activeSheetId)?.kind);
  return kind === 'ladder' ? <LadderSheetView /> : <SchematicCanvas />;
}

function MainArea() {
  const views = useSyncExternalStore(mainViews.subscribe, mainViews.getState, mainViews.getState);
  const activeId = useSyncExternalStore(activeMainView.subscribe, activeMainView.getState, activeMainView.getState);
  const active = views.find((v) => v.id === activeId);
  const schematic = !active;
  return (
    <>
      {views.length ? (
        <div className="ms-view-tabs">
          <Tabs
            items={[{ id: SCHEMATIC_VIEW_ID, title: t('app.app.schematic') }, ...views.map((v) => ({ id: v.id, title: v.title }))]}
            active={schematic ? SCHEMATIC_VIEW_ID : active.id}
            onSelect={showMainView}
            ariaLabel={t('app.app.mainViews')}
            idPrefix="ms-view"
            size="small"
          />
        </div>
      ) : null}
      {schematic ? (
        <>
          <SheetTabs />
          <SheetBody />
        </>
      ) : (
        <div className="ms-view-body" role="tabpanel" id={`ms-view-panel-${active.id}`} aria-labelledby={`ms-view-${active.id}`}>
          <ErrorBoundary label={t('app.app.titleView', { title: active.title })} resetKey={active}>
            <RenderView render={active.render} />
          </ErrorBoundary>
        </div>
      )}
    </>
  );
}

function useTheme(): void {
  const theme = useEditor((s) => s.ui.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

/** Window size, updated on resize (drives the responsive side panels). */
function useWindowSize(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 800 }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/** Slim vertical button standing in for a collapsed side panel; shows the panel as an overlay. */
function SideRail({ side, label, open, onToggle }: { side: 'left' | 'right'; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`ms-rail ms-rail-${side}${open ? ' is-open' : ''}`} aria-expanded={open} title={t('app.app.railHint', { panel: label })} onClick={onToggle}>
      <span>{label}</span>
    </button>
  );
}

export default function App() {
  const ui = useEditor((s) => s.ui);
  useTheme();
  const size = useWindowSize();
  const activeView = useSyncExternalStore(activeMainView.subscribe, activeMainView.getState, activeMainView.getState);
  const viewKind = activeView === SCHEMATIC_VIEW_ID ? 'schematic' : 'other';
  const layout = fitSidePanels(size.w, ui, viewKind);
  const dockHeight = fitDockHeight(size.h, ui.dockHeight, viewKind);
  const [overlay, setOverlay] = useState<'browser' | 'properties' | null>(null);
  // an overlay only exists while its panel is collapsed to a rail
  const shown = overlay === 'browser' && layout.browser === 'rail' ? 'browser' : overlay === 'properties' && layout.properties === 'rail' ? 'properties' : null;

  useEffect(() => startShell(), []);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown]);

  return (
    <div className="ms-app">
      <header className="ms-app-head">
        <MenuBar />
        <Toolbar />
      </header>
      <div className="ms-main">
        {layout.browser === 'open' ? (
          <>
            <div className="ms-side ms-side-left" style={{ width: layout.browserWidth }}>
              <LeftPanel />
            </div>
            <Splitter
              label={t('app.app.resizeComponentBrowser')}
              direction="right"
              value={layout.browserWidth}
              min={PANEL_LIMITS.browserWidth.min}
              max={PANEL_LIMITS.browserWidth.max}
              onChange={(v) => actions.setUi({ browserWidth: v })}
            />
          </>
        ) : layout.browser === 'rail' ? (
          <SideRail side="left" label={t('cmd.view.browser')} open={shown === 'browser'} onToggle={() => setOverlay(shown === 'browser' ? null : 'browser')} />
        ) : null}
        <main className="ms-center" aria-label={t('app.app.schematic')}>
          <MainArea />
          {shown === 'browser' ? (
            <div className="ms-side-overlay ms-side-overlay-left" style={{ width: Math.min(ui.browserWidth, Math.max(200, layout.center - 40)) }}>
              <LeftPanel />
            </div>
          ) : null}
          {shown === 'properties' ? (
            <div className="ms-side-overlay ms-side-overlay-right" style={{ width: Math.min(ui.propertiesWidth, Math.max(220, layout.center - 40)) }}>
              <PropertiesPanel />
            </div>
          ) : null}
        </main>
        {layout.properties === 'open' ? (
          <>
            <Splitter
              label={t('app.app.resizePropertiesPanel')}
              direction="left"
              value={layout.propertiesWidth}
              min={PANEL_LIMITS.propertiesWidth.min}
              max={PANEL_LIMITS.propertiesWidth.max}
              onChange={(v) => actions.setUi({ propertiesWidth: v })}
            />
            <div className="ms-side ms-side-right" style={{ width: layout.propertiesWidth }}>
              <PropertiesPanel />
            </div>
          </>
        ) : layout.properties === 'rail' ? (
          <SideRail side="right" label={t('cmd.view.properties')} open={shown === 'properties'} onToggle={() => setOverlay(shown === 'properties' ? null : 'properties')} />
        ) : null}
      </div>
      {ui.dockOpen ? (
        <>
          <Splitter
            label={t('app.app.resizeDock')}
            direction="up"
            value={dockHeight}
            min={PANEL_LIMITS.dockHeight.min}
            max={PANEL_LIMITS.dockHeight.max}
            onChange={(v) => actions.setUi({ dockHeight: v })}
          />
          <div className="ms-bottom" style={{ height: dockHeight }}>
            <BottomDock />
          </div>
        </>
      ) : null}
      <StatusBar />
      <FloatingWindowHost />
      <ContextMenuHost />
      <DialogHost />
    </div>
  );
}
