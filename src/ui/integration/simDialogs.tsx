/**
 * Simulation-tools dialogs (loaded on first use):
 * - Interactive simulation settings (Simulate menu): initial conditions, output step, maximum step
 *   and automatic stop time, stored in Design.interactive as one undo step ("Follow the transient
 *   analysis" removes them again);
 * - Convergence assistant (Simulate menu, and the button under convergence errors): explains the
 *   last failure, lists the fixes it will try, re-runs the analysis with each (controller
 *   tryConvergenceFixes) and keeps the options of the fix that worked on request.
 */
import { useState } from 'react';
import type { InteractiveSettings } from '../../model/types';
import type { AnalysisType } from '../../sim/netlist';
import { buildNetlist } from '../../model/netlister';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { NumField, SelectField } from '../analysis/fields';
import { classifyFailure, convergenceFixes, seriesTargets, type FixAttempt } from '../analysis/convergence';
import { ANALYSIS_LABELS, ANALYSIS_ORDER } from '../app/menus';
import { actions, getState } from '../store';
import type { SimulationIntegration } from './controller';
import { resolveInteractive } from './simSettings';
import { t, tDynamic } from '../../i18n';
import '../analysis/analysis.css';

// ---------------------------------------------------------------------------------------------
// interactive simulation settings

type Initial = NonNullable<InteractiveSettings['initial']>;
const INITIALS: Initial[] = ['auto', 'op', 'zero', 'uic'];

export function InteractiveSettingsDialog({ close }: { close: () => void }) {
  const design = getState().design;
  const resolved = resolveInteractive(design);
  const [initial, setInitial] = useState<Initial>(design.interactive?.initial ?? 'auto');
  const [tstep, setTstep] = useState<number | undefined>(design.interactive?.tstep ?? resolved.tstep);
  const [tmax, setTmax] = useState<number | undefined>(design.interactive?.tmax);
  const [tstop, setTstop] = useState<number | undefined>(design.interactive?.tstop);
  const apply = () => {
    const next: InteractiveSettings = { initial };
    if (tstep !== undefined) next.tstep = tstep;
    if (tmax !== undefined) next.tmax = tmax;
    if (tstop !== undefined) next.tstop = tstop;
    actions.applyDesign((d) => ({ ...d, interactive: next }));
    actions.addSimMessage('info', t('sim.interactive.applied'), 'simulation');
    close();
  };
  const useTran = () => {
    actions.applyDesign((d) => {
      const out = { ...d };
      delete out.interactive;
      return out;
    });
    actions.addSimMessage('info', t('sim.interactive.cleared'), 'simulation');
    close();
  };
  return (
    <Dialog
      title={t('sim.interactive.title')}
      onClose={close}
      width={560}
      footer={
        <>
          {design.interactive && (
            <button type="button" className="ms-btn" title={t('tip.interactive.useTran')} onClick={useTran}>
              {t('sim.interactive.useTran')}
            </button>
          )}
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={apply}>
            {t('sim.interactive.apply')}
          </button>
        </>
      }
    >
      <div className="msa-sim-dialog">
        <p className="msa-note">{t('sim.interactive.intro')}</p>
        {!design.interactive && <p className="msa-hint">{t('sim.interactive.derived')}</p>}
        <SelectField label={t('sim.interactive.initial')} help={t('tip.interactive.initial')} value={initial} options={INITIALS.map((k) => [k, t(`sim.interactive.initial.${k}`)] as const)} onChange={setInitial} />
        <div className="msa-row">
          <NumField label={t('sim.interactive.tstep')} help={t('tip.interactive.tstep')} unit="s" value={tstep} onChange={setTstep} optional min={0} exclusiveMin placeholder={t('sim.interactive.blankAuto')} size={16} />
          <NumField label={t('sim.interactive.tmax')} help={t('tip.interactive.tmax')} unit="s" value={tmax} onChange={setTmax} optional min={0} exclusiveMin placeholder={t('sim.interactive.blankAuto')} size={16} />
          <NumField label={t('sim.interactive.tstop')} help={t('tip.interactive.tstop')} unit="s" value={tstop} onChange={setTstop} optional min={0} exclusiveMin placeholder={t('sim.interactive.blankNever')} size={22} />
        </div>
      </div>
    </Dialog>
  );
}

export function openInteractiveSettingsDialog(): void {
  openCustomDialog((close) => <InteractiveSettingsDialog close={close} />);
}

// ---------------------------------------------------------------------------------------------
// convergence assistant

/** "RSHUNT = 1e+12, method = gear" for a fix's option changes. */
function optionText(options: Record<string, unknown>): string {
  return Object.entries(options)
    .map(([k, v]) => `${k.toUpperCase()} = ${typeof v === 'number' ? Number(v.toPrecision(4)) : String(v)}`)
    .join(', ');
}

export function ConvergenceDialog({ ctrl, close, initialType }: { ctrl: SimulationIntegration; close: () => void; initialType?: AnalysisType }) {
  const failure = ctrl.live.getState().lastFailure;
  const [type, setType] = useState<AnalysisType>(initialType ?? failure?.type ?? getState().design.analysis.active);
  const [attempts, setAttempts] = useState<FixAttempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<FixAttempt | null | undefined>(undefined);
  const kind = classifyFailure(failure && failure.type === type ? failure.message : '');
  const fixes = convergenceFixes(kind, getState().design.options);
  const run = async () => {
    setBusy(true);
    setAttempts([]);
    setDone(undefined);
    const r = await ctrl.tryConvergenceFixes(type, (a) => setAttempts((list) => [...list, a]));
    setBusy(false);
    setDone(r.fixed ? (r.attempts.find((a) => a.ok) ?? null) : null);
  };
  const keep = () => {
    if (!done) return;
    actions.applyDesign((d) => ({ ...d, options: { ...d.options, ...done.fix.options } }));
    actions.addSimMessage('info', t('sim.assist.kept'), 'simulation');
    close();
  };
  let series = '';
  if (done?.fix.seriesR !== undefined) {
    try {
      series = seriesTargets(buildNetlist(getState().design, { includeAnalysis: false }).netlist).join(', ');
    } catch {
      series = '';
    }
  }
  return (
    <Dialog
      title={t('sim.assist.title')}
      onClose={close}
      width={640}
      footer={
        <>
          {done && Object.keys(done.fix.options).length > 0 && (
            <button type="button" className="ms-btn ms-btn-primary" title={t('tip.assist.keep')} onClick={keep}>
              {t('sim.assist.keep')}
            </button>
          )}
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="msa-sim-dialog">
        <p className="msa-note">{t('sim.assist.intro')}</p>
        {failure ? (
          <div className="msa-assist-error">
            <b>{t('sim.assist.lastError', { analysis: ANALYSIS_LABELS[failure.type] ?? failure.type })}</b>
            <code>{failure.message}</code>
          </div>
        ) : (
          <p className="msa-hint">{t('sim.assist.noFailure')}</p>
        )}
        <p>{tDynamic(`sim.assist.kind.${kind}`)}</p>
        <div className="msa-row">
          <SelectField label={t('sim.assist.analysis')} help={t('tip.assist.analysis')} value={type} options={ANALYSIS_ORDER.map((a) => [a, ANALYSIS_LABELS[a]] as const)} onChange={setType} />
          <button type="button" className="ms-btn ms-btn-primary" title={t('tip.assist.tryAll')} disabled={busy} onClick={() => void run()}>
            {busy ? t('sim.assist.running') : t('sim.assist.tryAll')}
          </button>
        </div>
        <h4>{t('sim.assist.fixes')}</h4>
        <ol className="msa-assist-list">
          {fixes.map((f, i) => {
            const a = attempts[i];
            return (
              <li key={f.id} className={a ? (a.ok ? 'msa-ok' : 'msa-bad') : undefined}>
                <span>{tDynamic(`sim.assist.fix.${f.id}`)}</span>
                {Object.keys(f.options).length > 0 && <code className="msa-hint"> {optionText(f.options)}</code>}
                {a && <b> — {a.ok ? t('sim.assist.attemptOk') : t('sim.assist.attemptFailed')}</b>}
              </li>
            );
          })}
        </ol>
        {done === null && <p className="msa-error-text">{t('sim.assist.none')}</p>}
        {done && <p role="status">{t('sim.assist.worked', { fix: tDynamic(`sim.assist.fix.${done.fix.id}`) })}</p>}
        {done?.fix.seriesR !== undefined && series && <p className="msa-hint">{t('sim.assist.seriesAdvice', { parts: series })}</p>}
      </div>
    </Dialog>
  );
}

export function openConvergenceAssistant(ctrl: SimulationIntegration, type?: AnalysisType): void {
  openCustomDialog((close) => <ConvergenceDialog ctrl={ctrl} close={close} initialType={type} />);
}
