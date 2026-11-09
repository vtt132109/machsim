/**
 * Analysis setup dialog: choose the analysis to run, edit its parameters (every AnalysisSpec
 * type, meta analyses with a nested base analysis), the output variables (optional) and the
 * simulation options, and review a summary.
 *
 *   <AnalysisSetupDialog specs active options availableOutputs availableSources availableElements
 *                        onChange={(specs, active, options) => …} onRun={(spec) => …} onClose={…} />
 *
 * The dialog edits a draft. Save calls onChange(specs, active, options) and onClose(); Run calls
 * onChange(...), then onRun(spec of the active analysis), then onClose(); Cancel / Esc only call
 * onClose(). Errors (from validateSpec / validateOptions) disable Save and Run; warnings do not.
 * When `saves` and `onSavesChange` are given an "Output" tab edits the saved output variables
 * (and, with `onExpressionsChange`, the output expressions); the new lists are passed to
 * onSavesChange / onExpressionsChange before onChange. With `profiles` a profile bar saves and
 * loads simulation profiles (analysis settings, options, outputs and `interactive` settings,
 * whose changes go to onInteractiveChange).
 */

import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AnalysisSpec, AnalysisType, SimOptions } from '../../sim/netlist';
import type { InteractiveSettings } from '../../model/types';
import { OutputTab } from './OutputTab';
import { ProfileBar, type ProfileHost } from './ProfileBar';
import { applyProfile, profileFromSettings, type SimProfile } from '../../model/simProfiles';
import { DEFAULT_OPTIONS } from '../../sim/netlist';
import { Dialog } from '../common/Dialog';
import { canRun, canSave, cleanOptions, draftIssues, ensureSpec, initialDraft, issueCounts } from './dialogModel';
import type { SpecMap } from './dialogModel';
import { Group, IssueList, NumField, SelectField } from './fields';
import { SpecForm } from './forms';
import type { FormContext } from './forms';
import { ANALYSIS_CATALOG, GROUP_TITLES, OPTION_FIELDS, analysisInfo, analysisSummaryLines, hasErrors, issuesAt, optionsSummary, toUserText } from './specs';
import type { AnalysisElementInfo, AnalysisGroup, OptionField, SpecIssue } from './specs';
import './analysis.css';
import { t } from '../../i18n';

export interface AnalysisSetupDialogProps {
  /** saved settings per analysis type (Design.analysis.specs) */
  specs: Partial<Record<AnalysisType, AnalysisSpec>>;
  /** analysis selected for Run (Design.analysis.active) */
  active: AnalysisType;
  /** simulation options (Design.options); missing keys use DEFAULT_OPTIONS */
  options: Partial<SimOptions>;
  /** output expressions of the circuit, e.g. "V(out)", "I(V1)" */
  availableOutputs: readonly string[];
  /** independent source names */
  availableSources: readonly string[];
  /** sweepable / toleranced components and models */
  availableElements: readonly (string | AnalysisElementInfo)[];
  /** global parameters (design variables, `.param`s) a Parameter sweep may step */
  availableVariables?: readonly string[];
  onChange: (specs: Partial<Record<AnalysisType, AnalysisSpec>>, active: AnalysisType, options: Partial<SimOptions>) => void;
  onRun: (spec: AnalysisSpec) => void;
  onClose: () => void;
  /** saved output variables (Netlist.saves); empty = everything */
  saves?: readonly string[];
  onSavesChange?: (saves: string[]) => void;
  /** dialog title (default "Analyses and Simulation") */
  title?: string;
  /** output expressions (AnalysisSettings.expressions) */
  expressions?: readonly string[];
  onExpressionsChange?: (exprs: string[]) => void;
  /** simulation profiles (save / load / import / export) */
  profiles?: ProfileHost;
  /** interactive settings saved with profiles (Design.interactive) */
  interactive?: InteractiveSettings;
  onInteractiveChange?: (it: InteractiveSettings | undefined) => void;
}

type Tab = 'params' | 'output' | 'options' | 'summary';

const GROUP_ORDER: AnalysisGroup[] = ['basic', 'small-signal', 'sweep', 'statistical', 'other'];

// ---------------------------------------------------------------------------
// Options tab
// ---------------------------------------------------------------------------

function defaultText(f: OptionField): string {
  const v = DEFAULT_OPTIONS[f.key];
  return typeof v === 'number' ? toUserText(v) : String(v);
}

export function OptionsForm({ options, onChange, issues }: { options: Partial<SimOptions>; onChange: (o: Partial<SimOptions>) => void; issues: readonly SpecIssue[] }) {
  const groups = ['Global', 'DC', 'Transient', 'Device', 'Advanced'] as const;
  const set = <K extends keyof SimOptions>(key: K, value: SimOptions[K] | undefined) => {
    const next = { ...options };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <div className="msa-options">
      <div className="msa-row">
        <span className="msa-hint">{t('analysis.analysisSetupDialog.blankFieldsUseTheDefault')}</span>
        <button type="button" className="msa-btn" onClick={() => onChange({})} disabled={!Object.keys(options).length}>
          {t('analysis.analysisSetupDialog.restoreDefaults')}
        </button>
      </div>
      {groups.map((g) => (
        <Group key={g} title={t(`analysis.optGroup.${g}`)}>
          <div className="msa-options-grid">
            {OPTION_FIELDS.filter((f) => f.group === g).map((f) =>
              f.kind === 'method' ? (
                <SelectField
                  key={f.key}
                  label={f.label}
                  help={f.help}
                  value={options.method ?? ''}
                  options={[
                    ['', t('analysis.analysisSetupDialog.defaultMethod', { method: DEFAULT_OPTIONS.method === 'gear' ? t('analysis.analysisSetupDialog.gear') : t('analysis.analysisSetupDialog.trapezoidal') })],
                    ['trap', t('analysis.analysisSetupDialog.trapezoidal')],
                    ['gear', t('analysis.analysisSetupDialog.gear')],
                  ]}
                  onChange={(m) => set('method', m === '' ? undefined : m)}
                  issues={issuesAt(issues, f.key)}
                />
              ) : (
                <NumField
                  key={f.key}
                  label={f.label}
                  help={f.help}
                  unit={f.unit}
                  value={options[f.key] as number | undefined}
                  optional
                  integer={f.kind === 'integer'}
                  min={f.min}
                  max={f.max}
                  exclusiveMin={f.exclusiveMin}
                  placeholder={defaultText(f)}
                  onChange={(v) => set(f.key, v as never)}
                  issues={issuesAt(issues, f.key)}
                  size={9}
                />
              ),
            )}
          </div>
        </Group>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output tab
// ---------------------------------------------------------------------------

export function OutputSelector({ available, selected, onChange }: { available: readonly string[]; selected: readonly string[]; onChange: (s: string[]) => void }) {
  const [filter, setFilter] = useState('');
  const [pickLeft, setPickLeft] = useState<string[]>([]);
  const [pickRight, setPickRight] = useState<string[]>([]);
  const isSel = (o: string) => selected.some((s) => s.toLowerCase() === o.toLowerCase());
  const f = filter.trim().toLowerCase();
  const left = available.filter((o) => !isSel(o) && (!f || o.toLowerCase().includes(f)));
  const right = selected.filter((o) => !f || o.toLowerCase().includes(f));
  return (
    <div className="msa-outputsel">
      <div className="msa-row">
        <input className="msa-input" placeholder={t('analysis.analysisSetupDialog.filterVariables')} aria-label={t('analysis.analysisSetupDialog.filterVariables')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="msa-hint">{selected.length ? t('analysis.analysisSetupDialog.lengthVariablesSaved', { length: selected.length }) : t('analysis.analysisSetupDialog.nothingSelectedAllNodeVoltages')}</span>
      </div>
      <div className="msa-dual">
        <label className="msa-dual-col">
          <span className="msa-label">{t('analysis.analysisSetupDialog.variablesInCircuit')}</span>
          <select multiple size={12} className="msa-input msa-mono" value={pickLeft} onChange={(e) => setPickLeft(Array.from(e.target.selectedOptions, (o) => o.value))} onDoubleClick={() => pickLeft.length && onChange([...selected, ...pickLeft])}>
            {left.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <div className="msa-dual-buttons">
          <button
            type="button"
            className="msa-btn"
            disabled={!pickLeft.length}
            onClick={() => {
              onChange([...selected, ...pickLeft.filter((o) => !isSel(o))]);
              setPickLeft([]);
            }}
          >
            {t('analysis.analysisSetupDialog.add')}
          </button>
          <button
            type="button"
            className="msa-btn"
            disabled={!pickRight.length}
            onClick={() => {
              onChange(selected.filter((o) => !pickRight.includes(o)));
              setPickRight([]);
            }}
          >
            {t('analysis.analysisSetupDialog.remove')}
          </button>
          <button type="button" className="msa-btn" disabled={!left.length} onClick={() => onChange([...selected, ...left])}>
            {t('analysis.analysisSetupDialog.addAll')}
          </button>
          <button type="button" className="msa-btn" disabled={!selected.length} onClick={() => onChange([])}>
            {t('analysis.analysisSetupDialog.removeAll')}
          </button>
        </div>
        <label className="msa-dual-col">
          <span className="msa-label">{t('analysis.analysisSetupDialog.selectedForAnalysis')}</span>
          <select multiple size={12} className="msa-input msa-mono" value={pickRight} onChange={(e) => setPickRight(Array.from(e.target.selectedOptions, (o) => o.value))}>
            {right.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function AnalysisSetupDialog(props: AnalysisSetupDialogProps) {
  const { availableOutputs, availableSources, availableElements, availableVariables, onChange, onRun, onClose, saves, onSavesChange } = props;
  const baseCtx = useMemo(() => ({ outputs: availableOutputs, sources: availableSources, elements: availableElements, variables: availableVariables ?? [] }), [availableOutputs, availableSources, availableElements, availableVariables]);
  const [draft, setDraft] = useState<SpecMap>(() => initialDraft(props.specs, props.active, baseCtx));
  const [sel, setSel] = useState<AnalysisType>(props.active);
  const [opts, setOpts] = useState<Partial<SimOptions>>(() => ({ ...props.options }));
  const [savesDraft, setSavesDraft] = useState<string[]>(() => [...(saves ?? [])]);
  const [exprDraft, setExprDraft] = useState<string[]>(() => [...(props.expressions ?? [])]);
  const [interactiveDraft, setInteractiveDraft] = useState<InteractiveSettings | undefined>(() => (props.interactive ? { ...props.interactive } : undefined));
  const [interactiveTouched, setInteractiveTouched] = useState(false);
  const [tab, setTab] = useState<Tab>('params');
  const showOutput = !!saves && !!onSavesChange;

  const issues = useMemo(() => draftIssues(draft, opts, baseCtx), [draft, opts, baseCtx]);
  const spec = draft[sel];
  const specIssues = issues.byType[sel] ?? [];
  const ctx: FormContext = { ...baseCtx, templates: draft };
  const counts = issueCounts(issues);
  const info = analysisInfo(sel);

  const select = (t: AnalysisType) => {
    const r = ensureSpec(draft, t, baseCtx);
    if (r.draft !== draft) setDraft(r.draft);
    setSel(t);
  };

  const commit = () => {
    if (showOutput) onSavesChange?.(savesDraft);
    if (showOutput) props.onExpressionsChange?.(exprDraft);
    if (interactiveTouched) props.onInteractiveChange?.(interactiveDraft);
    onChange(draft, sel, cleanOptions(opts));
  };
  const loadProfile = (p: SimProfile) => {
    const next = applyProfile({ options: opts, analysis: { active: sel, specs: draft, saves: savesDraft, expressions: exprDraft }, interactive: interactiveDraft }, p);
    setOpts({ ...next.options });
    if (p.analysis && next.analysis) {
      const d = initialDraft(next.analysis.specs, next.analysis.active, baseCtx);
      setDraft(d);
      setSel(next.analysis.active);
      setSavesDraft([...(next.analysis.saves ?? [])]);
      setExprDraft([...(next.analysis.expressions ?? [])]);
    }
    if (p.interactive) {
      setInteractiveDraft(next.interactive);
      setInteractiveTouched(true);
    }
  };
  const save = () => {
    if (!canSave(issues)) return;
    commit();
    onClose();
  };
  const run = () => {
    if (!spec || !canRun(draft, sel, issues)) return;
    commit();
    onRun(spec);
    onClose();
  };

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const sorted = GROUP_ORDER.flatMap((g) => ANALYSIS_CATALOG.filter((a) => a.group === g).map((a) => a.type));
    const i = sorted.indexOf(sel);
    const next = sorted[Math.max(0, Math.min(sorted.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    select(next);
    const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-type="${next}"]`);
    el?.focus();
  };

  const tabs: [Tab, string][] = [
    ['params', t('analysis.analysisSetupDialog.analysisParameters')],
    ...(showOutput ? ([['output', t('common.output')]] as [Tab, string][]) : []),
    ['options', t('analysis.analysisSetupDialog.analysisOptions')],
    ['summary', t('analysis.analysisSetupDialog.summary')],
  ];
  const optionErrors = hasErrors(issues.options);

  const footer = (
    <div className="msa-footer">
      <span className={`msa-status${counts.errors ? ' msa-error' : counts.warnings ? ' msa-warning' : ''}`} role="status">
        {counts.errors
          ? t('analysis.analysisSetupDialog.errorsToFix', { n: counts.errors })
          : counts.warnings
            ? t('analysis.analysisSetupDialog.warningsCount', { n: counts.warnings })
            : t('analysis.analysisSetupDialog.readyTitle', { title: info.title })}
      </span>
      <button type="button" className="msa-btn msa-btn-primary" onClick={run} disabled={!canRun(draft, sel, issues)} title={t('analysis.analysisSetupDialog.runTitle', { title: info.title })}>
        {t('common.run')}
      </button>
      <button type="button" className="msa-btn" onClick={save} disabled={!canSave(issues)}>
        {t('common.save')}
      </button>
      <button type="button" className="msa-btn" onClick={onClose}>
        {t('common.cancel')}
      </button>
    </div>
  );

  return (
    <Dialog title={props.title ?? t('analysis.analysisSetupDialog.analysesAndSimulation')} onClose={onClose} width="min(940px, 96vw)" className="msa-dialog" footer={footer}>
      <div className="msa-layout">
        <nav className="msa-nav" aria-label={t('analysis.analysisSetupDialog.analyses')} onKeyDown={onListKey}>
          {GROUP_ORDER.map((g) => (
            <div key={g} className="msa-nav-group" role="group" aria-label={GROUP_TITLES[g]}>
              <div className="msa-nav-title">{GROUP_TITLES[g]}</div>
              {ANALYSIS_CATALOG.filter((a) => a.group === g).map((a) => {
                const bad = hasErrors(issues.byType[a.type] ?? []);
                return (
                  <button
                    key={a.type}
                    type="button"
                    data-type={a.type}
                    data-autofocus={a.type === props.active ? true : undefined}
                    className={`msa-nav-item${a.type === sel ? ' msa-nav-active' : ''}`}
                    aria-current={a.type === sel ? 'true' : undefined}
                    tabIndex={a.type === sel ? 0 : -1}
                    onClick={() => select(a.type)}
                    title={a.description}
                  >
                    <span className="msa-nav-marker" aria-hidden>
                      {a.type === sel ? '▶' : ''}
                    </span>
                    {a.title}
                    {bad && <span className="msa-dot" aria-label={t('analysis.analysisSetupDialog.hasErrors')} />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <section className="msa-main" aria-label={info.title}>
          {props.profiles && (
            <ProfileBar
              host={props.profiles}
              current={() => ({ options: cleanOptions(opts), analysis: { active: sel, specs: draft, saves: savesDraft, expressions: exprDraft }, interactive: interactiveDraft })}
              onLoad={loadProfile}
              make={(name, s) => profileFromSettings(name, s)}
            />
          )}
          <header className="msa-head">
            <h3>{info.title}</h3>
            <p>{info.description}</p>
          </header>
          <div className="msa-tabs" role="tablist" aria-label={info.title}>
            {tabs.map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={`msa-tab${tab === t ? ' msa-tab-active' : ''}${t === 'options' && optionErrors ? ' msa-tab-bad' : ''}`} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <div className="msa-tabpanel" role="tabpanel">
            {tab === 'params' && spec && (
              <>
                <IssueList issues={issuesAt(specIssues, '')} />
                <SpecForm spec={spec} onChange={(s) => setDraft((d) => ({ ...d, [sel]: s }))} ctx={ctx} issues={specIssues} />
              </>
            )}
            {tab === 'output' && showOutput && (
              <OutputTab available={availableOutputs} saves={savesDraft} onSavesChange={setSavesDraft} expressions={exprDraft} onExpressionsChange={props.onExpressionsChange ? setExprDraft : undefined} />
            )}
            {tab === 'options' && <OptionsForm options={opts} onChange={setOpts} issues={issues.options} />}
            {tab === 'summary' && spec && (
              <div className="msa-summary">
                <h4>{t('common.analysis')}</h4>
                <pre>{analysisSummaryLines(spec).join('\n')}</pre>
                <h4>{t('analysis.analysisSetupDialog.simulationOptions')}</h4>
                <pre>{optionsSummary(opts).join('\n') || t('analysis.analysisSetupDialog.allDefaults')}</pre>
                {showOutput && (
                  <>
                    <h4>{t('analysis.analysisSetupDialog.outputVariables')}</h4>
                    <pre>{savesDraft.length ? savesDraft.join('\n') : t('analysis.analysisSetupDialog.allNodeVoltagesAndSource')}</pre>
                    {exprDraft.length > 0 && (
                      <>
                        <h4>{t('analysis.output.expressions')}</h4>
                        <pre>{exprDraft.join('\n')}</pre>
                      </>
                    )}
                  </>
                )}
                {specIssues.length > 0 && (
                  <>
                    <h4>{t('analysis.analysisSetupDialog.problems')}</h4>
                    <ul className="msa-problems">
                      {specIssues.map((i, k) => (
                        <li key={k} className={i.severity === 'error' ? 'msa-error' : 'msa-warning'}>
                          {i.path ? <code>{i.path}</code> : null} {i.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
