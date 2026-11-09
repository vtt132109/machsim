/**
 * Grapher pages kept in the design file (Design.grapher), integration side (light: runs at
 * start-up without the Grapher chunk).
 *
 *   installGrapherPersistence(ctrl)  when a document with Design.grapher is opened, its runs join
 *                                    the run history under fresh numbers (ctrl.adoptRuns) and its
 *                                    pages wait in `pendingGrapherPages` until the Grapher window
 *                                    applies them (history.applySavedPages)
 *
 * The Grapher window (GrapherWindow.tsx) owns the "Keep in file" toggle and registers the save
 * transform that refreshes Design.grapher from the current pages on every save.
 */
import type { SavedPage } from '../../model/types';
import { onDocumentLoaded } from '../app/document';
import { createStore } from '../store/createStore';
import { actions } from '../store';
import { remapPages, runFromSaved } from '../results/savedGrapher';
import type { SimulationIntegration } from './controller';
import { t } from '../../i18n';

/** Saved pages of the document just opened, waiting for the Grapher window. */
export const pendingGrapherPages = createStore<{ pages: SavedPage[]; active?: string } | null>(null);

export function installGrapherPersistence(ctrl: SimulationIntegration): () => void {
  return onDocumentLoaded((design) => {
    pendingGrapherPages.setState(null);
    const g = design.grapher;
    if (!g?.runs.length) return;
    const map = ctrl.adoptRuns(g.runs.map((r) => runFromSaved(r)));
    const pages = remapPages(g.pages, map);
    const active = g.active ? g.active : undefined;
    pendingGrapherPages.setState({ pages, active });
    actions.addSimMessage('info', t('grapher.pagesRestored', { n: pages.length }), 'grapher');
  });
}
