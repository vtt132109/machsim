/**
 * Entry points of the learner help system (small module; the dialogs themselves are
 * lazy-loaded so the help text does not weigh on the initial bundle).
 *
 *   openHelp({ kind: 'start' })                    // step-by-step tutorial
 *   openHelp(topicForPart(def))                    // "What is this?" for a part
 *   openHelp({ kind: 'instrument', instrument: 'oscilloscope' })
 *   openHelp(contextTopic(getState()))             // F1: explain the selection
 *   openWelcome()                                  // first-run welcome panel
 *
 * The welcome state (seen / show on start) is persisted with the UI preferences.
 */
import type { PartDef, PartGroup } from '../../library/types';
import type { InstrumentKind } from '../../model/types';
import type { AnalysisType } from '../../sim/netlist';
import { createStore } from '../store/createStore';
import type { EditorState } from '../store/types';
import { partLookup } from '../store';
import { floating } from '../app/extensions';
import { INSTRUMENT_KINDS } from '../instruments/titles';
import type { GuidePageId } from '../../i18n/helpGuides';
import { loadAllGroups } from '../../library';
import { setDialogHelpOpener } from '../common/Dialog';

export type HelpTopic =
  | { kind: 'start' }
  | { kind: 'index' }
  | { kind: 'shortcuts' }
  | { kind: 'group'; group: PartGroup }
  | { kind: 'family'; group: PartGroup; family: string }
  | { kind: 'part'; partId: string }
  | { kind: 'instrument'; instrument: InstrumentKind }
  | { kind: 'analysis'; analysis: AnalysisType }
  /** guide pages of the learning / interop tools (src/i18n/helpGuides.ts) */
  | { kind: 'guide'; page: GuidePageId };

export { INSTRUMENT_KINDS };

const isInstrumentKind = (k: string): k is InstrumentKind => (INSTRUMENT_KINDS as readonly string[]).includes(k);

/** Guide page that F1 opens for a floating window of this kind (the instruments have their own pages). */
const WINDOW_GUIDES: Record<string, GuidePageId> = {
  script: 'scripting',
  audio: 'audio',
  mcu: 'mcu',
  lessons: 'lessons',
  description: 'description',
};

/** Help page of a part: instruments open their instrument page, other parts their part page. */
export function topicForPart(part: Pick<PartDef, 'id' | 'instrument'>): HelpTopic {
  return part.instrument ? { kind: 'instrument', instrument: part.instrument } : { kind: 'part', partId: part.id };
}

type FocusHelpProvider = () => HelpTopic | null;
let focusHelp: FocusHelpProvider | null = null;

/**
 * Let the UI element that has the keyboard focus answer F1 (the component browser explains the
 * group, family or part of its active row). Returns the unregister function.
 */
export function setFocusHelp(provider: FocusHelpProvider): () => void {
  focusHelp = provider;
  return () => {
    if (focusHelp === provider) focusHelp = null;
  };
}

/**
 * Contextual help (F1): the focused element's topic (component browser row), else the selected
 * part, else the focused instrument window, else the help index.
 */
export function contextTopic(state: Pick<EditorState, 'selection' | 'design'>): HelpTopic {
  const focused = focusHelp?.();
  if (focused) return focused;
  if (state.selection.length === 1 && state.selection[0].kind === 'part') {
    const id = state.selection[0].id;
    for (const sheet of state.design.sheets) {
      const inst = sheet.parts.find((p) => p.id === id);
      if (inst) {
        const def = partLookup(inst.partId);
        if (def) return topicForPart(def);
      }
    }
  }
  const f = floating.getState();
  const win = f.windows.find((w) => w.id === f.active);
  if (win && isInstrumentKind(win.kind)) return { kind: 'instrument', instrument: win.kind };
  // the windows of the tools explain themselves (F1 / What is this?)
  const guide = win ? WINDOW_GUIDES[win.kind] : undefined;
  if (guide) return { kind: 'guide', page: guide };
  return { kind: 'index' };
}

/** Open the help browser on a topic (the dialog module loads on first use). */
export function openHelp(topic: HelpTopic): Promise<void> {
  // group / family pages list the parts of the whole catalogue: the packs load with the dialog
  return Promise.all([import('./HelpDialog'), loadAllGroups()]).then(([m]) => m.showHelpDialog(topic));
}

// a dialog with a `guide` prop (src/ui/common/Dialog.tsx) opens its guide page through this
setDialogHelpOpener((page) => void openHelp({ kind: 'guide', page }));

// ---------------------------------------------------------------------------------------------
// welcome panel

export interface WelcomePrefs {
  /** the panel has been shown once */
  seen: boolean;
  /** show it on every start */
  showOnStart: boolean;
  /** beginner mode has been offered once (the offer is a first-run question, asked only once) */
  beginnerAsked?: boolean;
}

export const welcomePrefs = createStore<WelcomePrefs>({ seen: false, showOnStart: false });

export function openWelcome(): Promise<void> {
  welcomePrefs.setState((w) => (w.seen ? w : { ...w, seen: true }));
  return import('./WelcomePanel').then((m) => m.showWelcomePanel());
}

/** Show the welcome panel at start-up on the first run (and later when the user asked for it). */
export function maybeShowWelcome(): Promise<void> | undefined {
  const w = welcomePrefs.getState();
  if (!w.seen || w.showOnStart) return openWelcome();
  return undefined;
}
