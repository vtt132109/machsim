/**
 * State helpers of the analysis setup dialog (pure).
 *
 * The dialog edits a draft copy of the design's analysis settings; nothing reaches the caller
 * until Save / Run. `initialDraft` deep-copies the settings and guarantees a spec for the active
 * analysis; `draftIssues` validates every edited spec plus the options; `canSave` / `canRun`
 * gate the buttons (errors block, warnings do not); `cleanOptions` drops unset option keys.
 */

import type { AnalysisSpec, AnalysisType, SimOptions } from '../../sim/netlist';
import { defaultSpec, hasErrors, validateOptions, validateSpec } from './specs';
import type { SpecContext, SpecIssue } from './specs';

export type SpecMap = Partial<Record<AnalysisType, AnalysisSpec>>;

/** Deep copy of the settings, with a spec for `active` (default when missing or mistyped). */
export function initialDraft(specs: SpecMap, active: AnalysisType, ctx: SpecContext = {}): SpecMap {
  const out: SpecMap = {};
  for (const [k, v] of Object.entries(specs) as [AnalysisType, AnalysisSpec | undefined][]) {
    // a stored spec must match its key; anything else is replaced by a default
    if (v && v.type === k) out[k] = JSON.parse(JSON.stringify(v)) as AnalysisSpec;
  }
  if (!out[active]) out[active] = defaultSpec(active, ctx);
  return out;
}

/** Spec for `type` from the draft, creating a default one when it does not exist yet. */
export function ensureSpec(draft: SpecMap, type: AnalysisType, ctx: SpecContext = {}): { draft: SpecMap; spec: AnalysisSpec } {
  const existing = draft[type];
  if (existing) return { draft, spec: existing };
  const spec = defaultSpec(type, ctx);
  return { draft: { ...draft, [type]: spec }, spec };
}

export interface DraftIssues {
  byType: Partial<Record<AnalysisType, SpecIssue[]>>;
  options: SpecIssue[];
}

export function draftIssues(draft: SpecMap, options: Partial<SimOptions>, ctx: SpecContext = {}): DraftIssues {
  const byType: Partial<Record<AnalysisType, SpecIssue[]>> = {};
  for (const [k, v] of Object.entries(draft) as [AnalysisType, AnalysisSpec | undefined][]) {
    if (v) byType[k] = validateSpec(v, ctx);
  }
  return { byType, options: validateOptions(options) };
}

/** Save is allowed when no edited spec and no option has an error. */
export function canSave(issues: DraftIssues): boolean {
  return !hasErrors(issues.options) && Object.values(issues.byType).every((list) => !list || !hasErrors(list));
}

/** Run additionally needs a valid spec for the active analysis. */
export function canRun(draft: SpecMap, active: AnalysisType, issues: DraftIssues): boolean {
  return !!draft[active] && canSave(issues);
}

/** Copy of `options` without undefined / non-finite numeric entries. */
export function cleanOptions(options: Partial<SimOptions>): Partial<SimOptions> {
  const out: Partial<SimOptions> = {};
  for (const [k, v] of Object.entries(options) as [keyof SimOptions, SimOptions[keyof SimOptions] | undefined][]) {
    if (v === undefined) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Total error / warning counts of a draft (status line). */
export function issueCounts(issues: DraftIssues): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  const count = (list: readonly SpecIssue[]) => {
    for (const i of list) {
      if (i.severity === 'error') errors++;
      else warnings++;
    }
  };
  count(issues.options);
  for (const list of Object.values(issues.byType)) if (list) count(list);
  return { errors, warnings };
}
