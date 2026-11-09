/**
 * Floating "Grapher" window content (lazy-loaded with the Grapher and postprocessor chunk): the
 * Grapher workspace over the run history of the session (LiveState.runs), or a hint to run the
 * simulation first.
 *
 * The workspace document (pages, overlays, page / trace properties) lives in a module-level store
 * so it survives closing and reopening the window; new runs of the controller are added to it as
 * they arrive (history.syncRuns), and the pages a design file kept (Design.grapher, restored by
 * grapherPersist.ts) replace the automatic pages of their runs.
 *
 * Page-bar extras: "Import measurement…" (CSV / TXT / measurement text → a page, see
 * src/util/traceImport.ts) and "Keep in file" (Design.grapher on / off). While it is on, every Save
 * refreshes Design.grapher from the current pages (save transform registered below).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Grapher } from '../results/Grapher';
import { GrapherWorkspace } from '../results/GrapherWorkspace';
import { applySavedPages, emptyDoc, syncRuns, type GrapherDoc } from '../results/history';
import { snapshotGrapher } from '../results/savedGrapher';
import { createStore } from '../store/createStore';
import { actions, useEditor } from '../store';
import { registerSaveTransform } from '../app/document';
import { documents } from '../app/documentSet';
import { pickTextFile } from '../app/files';
import { alertDialog } from '../common/dialogs';
import { measurementResult, MeasurementError, parseMeasurement } from '../../util/traceImport';
import type { SimulationIntegration } from './controller';
import { pendingGrapherPages } from './grapherPersist';
import { registerPrintContribution } from '../print/printSources';
import { renderGraphPages } from '../results/printPage';
import { ft } from '../../i18n/filesText';
import { t } from '../../i18n';

/** The session's Grapher workspace (shared by every Grapher window). */
export const grapherDoc = createStore<GrapherDoc>(emptyDoc());

let controller: SimulationIntegration | null = null;

// document tabs: each document keeps its own Grapher pages (page / axis / trace properties); the
// runs themselves are kept per document by the simulation controller
documents.registerExtension({
  id: 'grapher',
  capture: () => grapherDoc.getState(),
  restore: (d) => {
    grapherDoc.setState((d as GrapherDoc | undefined) ?? emptyDoc());
    pendingGrapherPages.setState(null);
  },
});

/** The workspace brought up to date: new runs added, pages saved in the open file applied. */
function currentDoc(): GrapherDoc {
  let doc = controller ? syncRuns(grapherDoc.getState(), controller.live.getState().runs) : grapherDoc.getState();
  const pending = pendingGrapherPages.getState();
  if (pending) {
    doc = applySavedPages(doc, pending.pages, pending.active);
    pendingGrapherPages.setState(null);
  }
  if (doc !== grapherDoc.getState()) grapherDoc.setState(doc);
  return doc;
}

// While "Keep in file" is on (Design.grapher present), Save writes the current pages.
registerSaveTransform((d) => {
  if (!d.grapher) return d;
  const doc = currentDoc();
  if (!doc.pages.length) return d;
  return { ...d, grapher: snapshotGrapher(doc.runs, doc.pages, doc.active) };
});

// the print preview offers the Grapher pages of the run on show
registerPrintContribution({
  id: 'grapher',
  available: () => grapherDoc.getState().pages.length > 0 || (controller?.live.getState().runs.length ?? 0) > 0,
  pages: async ({ monochrome }) => renderGraphPages(currentDoc(), { monochrome }),
});

/** Grapher > Import measurement…: a CSV / text file becomes a page of its own. */
export async function importMeasurementFlow(ctrl: SimulationIntegration): Promise<boolean> {
  const f = await pickTextFile(['.csv', '.txt', '.tsv', '.dat', '.lvm', '.prn']);
  if (!f) return false;
  try {
    const data = parseMeasurement(f.text, f.name);
    ctrl.importRun(f.name, [measurementResult(data, f.name)]);
    const points = data.traces.reduce((n, tr) => n + tr.x.length, 0);
    actions.addSimMessage('info', ft('measureDone', { name: f.name, n: data.traces.length, points }), 'grapher');
    if (data.skipped.length) actions.addSimMessage('warning', ft('measureSkipped', { n: data.skipped.length, lines: data.skipped.join(', ') }), 'grapher');
    return true;
  } catch (err) {
    await alertDialog({ title: ft('measureTitle'), message: err instanceof MeasurementError ? ft('measureFailed', { name: f.name }) : err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** "Keep in file" on: Design.grapher = the current pages (one undo step); off: removed. */
function setKeepPages(on: boolean): void {
  const doc = currentDoc();
  actions.applyDesign((d) => {
    if (!on) {
      const next = { ...d };
      delete next.grapher;
      return next;
    }
    return { ...d, grapher: snapshotGrapher(doc.runs, doc.pages, doc.active) };
  });
}

function PageBarExtra({ ctrl }: { ctrl: SimulationIntegration }) {
  const keep = useEditor((s) => !!s.design.grapher);
  return (
    <>
      <button type="button" className="msr-btn" title={ft('measureFilter')} onClick={() => void importMeasurementFlow(ctrl)}>
        {t('grapher.importMeasurement')}
      </button>
      <label className="msr-inline" title={ft('keepPagesTip')}>
        <input type="checkbox" checked={keep} onChange={(e) => setKeepPages(e.target.checked)} /> {t('grapher.keepPages')}
      </label>
    </>
  );
}

export function GrapherWindow({ ctrl, postprocessor = false }: { ctrl: SimulationIntegration; postprocessor?: boolean }) {
  controller = ctrl;
  const live = useSyncExternalStore(ctrl.live.subscribe, ctrl.live.getState, ctrl.live.getState);
  const doc = useSyncExternalStore(grapherDoc.subscribe, grapherDoc.getState, grapherDoc.getState);
  const pending = useSyncExternalStore(pendingGrapherPages.subscribe, pendingGrapherPages.getState, pendingGrapherPages.getState);
  const base = syncRuns(doc, live.runs);
  const synced = pending ? applySavedPages(base, pending.pages, pending.active) : base;
  useEffect(() => {
    if (synced !== grapherDoc.getState()) grapherDoc.setState(synced);
    if (pending) pendingGrapherPages.setState(null);
  }, [synced, pending]);
  if (synced.pages.length) {
    return (
      <GrapherWorkspace
        doc={synced}
        dispatch={(f) => grapherDoc.setState((d) => f(syncRuns(d, ctrl.live.getState().runs)))}
        canCapture={live.mode === 'interactive'}
        onCapture={() => ctrl.captureInteractive()}
        initialPostprocessor={postprocessor}
        pageBarExtra={<PageBarExtra ctrl={ctrl} />}
      />
    );
  }
  // results that never went through the run history (kept for callers that set them directly)
  if (live.results.length) return <Grapher key={live.resultsVersion} results={[...live.results]} initialPostprocessor={postprocessor} className="msx-grapher" />;
  return (
    <div className="ms-empty msx-empty">
      {t('integration.panels.noResultsBefore')} <b>{t('common.run')}</b> {t('integration.panels.noResultsAfter')}
      <p>
        <button type="button" className="ms-btn" title={ft('measureFilter')} onClick={() => void importMeasurementFlow(ctrl)}>
          {t('grapher.importMeasurement')}
        </button>
      </p>
    </div>
  );
}
