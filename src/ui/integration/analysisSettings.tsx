/**
 * Simulate > Analysis settings… (lazy-loaded with the analysis setup dialog): edits the design's
 * analysis specs, simulation options (Global / DC / Transient / Device / Advanced), Output tab
 * (saved variables and output expressions) and simulation profiles against the outputs, sources
 * and elements of the current circuit, and can run the selected analysis directly. Save / Run
 * write everything as one undo step.
 */
import { useMemo } from 'react';
import { buildNetlist } from '../../model/netlister';
import type { AnalysisSettings as Settings, InteractiveSettings } from '../../model/types';
import { AnalysisSetupDialog } from '../analysis/AnalysisSetupDialog';
import type { ProfileHost } from '../analysis/ProfileBar';
import { PROFILE_EXTENSION, ProfileStore, parseProfile, serializeProfile } from '../../model/simProfiles';
import { pickTextFile, downloadText } from '../parts/fileIo';
import { actions, getState } from '../store';
import { specContext } from './circuitInfo';
import type { SimulationIntegration } from './controller';

function browserStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Profiles in the browser / Electron localStorage, files through the desktop bridge or downloads. */
export function defaultProfileHost(): ProfileHost {
  const store = new ProfileStore(browserStorage());
  return {
    list: () => store.list(),
    save: (p) => store.save(p),
    remove: (name) => store.remove(name),
    exportFile: (p) => void downloadText(serializeProfile(p), `${p.name.replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'profile'}${PROFILE_EXTENSION}`, 'application/json'),
    importFile: async () => {
      const f = await pickTextFile(`${PROFILE_EXTENSION},.json`);
      return f ? parseProfile(f.text) : null;
    },
  };
}

export function AnalysisSettings({ ctrl, close }: { ctrl: SimulationIntegration; close: () => void }) {
  // the dialog edits a draft of the settings at the time it opened
  const design = useMemo(() => getState().design, []);
  const ctx = useMemo(() => {
    try {
      return specContext(buildNetlist(design, { includeAnalysis: false }));
    } catch {
      return {};
    }
  }, [design]);
  const profiles = useMemo(() => defaultProfileHost(), []);
  // collected by the callbacks that run before onChange, applied in one undo step
  const pending: { saves?: string[]; expressions?: string[]; interactive?: InteractiveSettings | null } = {};
  return (
    <AnalysisSetupDialog
      specs={design.analysis.specs}
      active={design.analysis.active}
      options={design.options}
      availableOutputs={ctx.outputs ?? []}
      availableSources={ctx.sources ?? []}
      availableElements={ctx.elements ?? []}
      saves={design.analysis.saves ?? []}
      onSavesChange={(s) => (pending.saves = s)}
      expressions={design.analysis.expressions ?? []}
      onExpressionsChange={(e) => (pending.expressions = e)}
      interactive={design.interactive}
      onInteractiveChange={(it) => (pending.interactive = it ?? null)}
      profiles={profiles}
      onChange={(specs, active, options) =>
        actions.applyDesign((d) => {
          const analysis: Settings = { active, specs };
          const saves = pending.saves ?? d.analysis.saves;
          const expressions = pending.expressions ?? d.analysis.expressions;
          if (saves?.length) analysis.saves = saves;
          if (expressions?.length) analysis.expressions = expressions;
          const next = { ...d, analysis, options };
          if (pending.interactive === null) delete next.interactive;
          else if (pending.interactive) next.interactive = pending.interactive;
          return next;
        })
      }
      onRun={(spec) => void ctrl.runAnalysis(spec.type)}
      onClose={close}
    />
  );
}
