/**
 * Instructor mode dialog (Options > Instructor mode; loaded on first use).
 *
 * Without restrictions: choose a password (twice) and what to restrict, then Apply. With
 * restrictions: the password unlocks the editor of the same options, and "Remove" deletes them.
 * Only a salted PBKDF2 hash of the password is stored (src/model/restrictions.ts).
 */
import { useState } from 'react';
import type { AnalysisType } from '../../sim/netlist';
import type { InstrumentKind } from '../../model/types';
import { createRestrictions, restrictionOptions, updateRestrictions, verifyPassword, type RestrictionOptions } from '../../model/restrictions';
import { actions, getState } from '../store';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { ANALYSIS_LABELS, ANALYSIS_ORDER } from '../app/menus';
import { INSTRUMENT_KINDS, PANEL_TITLES } from '../instruments/titles';
import { lt } from '../../i18n/learnUi';
import './learn.css';

function toggle<T>(list: T[] | undefined, v: T, on: boolean): T[] {
  const s = new Set(list ?? []);
  if (on) s.add(v);
  else s.delete(v);
  return [...s];
}

function OptionsEditor({ opts, onChange }: { opts: RestrictionOptions; onChange: (o: RestrictionOptions) => void }) {
  const flag = (key: 'hideValues' | 'lockParts' | 'lockDescription' | 'hideAnswers', label: string, tip: string) => (
    <label className="ms-inline" title={tip}>
      <input type="checkbox" checked={!!opts[key]} title={tip} onChange={(e) => onChange({ ...opts, [key]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <>
      <fieldset>
        {flag('hideValues', lt('inst.hideValues'), lt('inst.hideValuesTip'))}
        {flag('lockParts', lt('inst.lockParts'), lt('inst.lockPartsTip'))}
        {flag('lockDescription', lt('inst.lockDescription'), lt('inst.lockDescriptionTip'))}
        {flag('hideAnswers', lt('inst.hideAnswers'), lt('inst.hideAnswersTip'))}
      </fieldset>
      <fieldset title={lt('inst.analysesTip')}>
        <legend>{lt('inst.analyses')}</legend>
        <div className="ms-inst-grid">
          {ANALYSIS_ORDER.map((a: AnalysisType) => (
            <label key={a}>
              <input type="checkbox" checked={!!opts.disabledAnalyses?.includes(a)} title={lt('inst.analysesTip')} onChange={(e) => onChange({ ...opts, disabledAnalyses: toggle(opts.disabledAnalyses, a, e.target.checked) })} /> {ANALYSIS_LABELS[a]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset title={lt('inst.instrumentsTip')}>
        <legend>{lt('inst.instruments')}</legend>
        <div className="ms-inst-grid">
          {INSTRUMENT_KINDS.map((k: InstrumentKind) => (
            <label key={k}>
              <input type="checkbox" checked={!!opts.disabledInstruments?.includes(k)} title={lt('inst.instrumentsTip')} onChange={(e) => onChange({ ...opts, disabledInstruments: toggle(opts.disabledInstruments, k, e.target.checked) })} /> {PANEL_TITLES[k]}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export function InstructorDialog({ close }: { close: () => void }) {
  const existing = getState().design.restrictions;
  const [unlocked, setUnlocked] = useState(!existing);
  const [opts, setOpts] = useState<RestrictionOptions>(() => restrictionOptions(existing));
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (!existing) return;
    setBusy(true);
    const ok = await verifyPassword(existing, pw);
    setBusy(false);
    if (ok) {
      setUnlocked(true);
      setError(null);
    } else setError(lt('inst.wrongPassword'));
  };

  const apply = async () => {
    const design = getState().design;
    if (!existing) {
      if (pw.length < 4) return setError(lt('inst.short'));
      if (pw !== pw2) return setError(lt('inst.mismatch'));
      setBusy(true);
      const r = await createRestrictions(pw, opts, design);
      setBusy(false);
      actions.applyDesign((d) => ({ ...d, restrictions: r }));
    } else {
      actions.applyDesign((d) => ({ ...d, restrictions: updateRestrictions(existing, opts, d) }));
    }
    actions.addSimMessage('info', lt('inst.applied'), 'instructor');
    close();
  };

  const remove = () => {
    actions.applyDesign((d) => {
      const next = { ...d };
      delete next.restrictions;
      return next;
    });
    actions.addSimMessage('info', lt('inst.removed'), 'instructor');
    close();
  };

  return (
    <Dialog
      title={lt('inst.title')}
      onClose={close}
      width={560}
      footer={
        <>
          {existing && unlocked ? (
            <button type="button" className="ms-btn ms-btn-danger" title={lt('inst.removeTip')} onClick={remove}>
              {lt('inst.remove')}
            </button>
          ) : null}
          {unlocked ? (
            <button type="button" className="ms-btn ms-btn-primary" disabled={busy} title={lt('inst.applyTip')} onClick={() => void apply()}>
              {busy ? lt('inst.working') : lt('inst.apply')}
            </button>
          ) : (
            <button type="button" className="ms-btn ms-btn-primary" disabled={busy || !pw} title={lt('inst.unlockTip')} onClick={() => void unlock()}>
              {busy ? lt('inst.working') : lt('inst.unlock')}
            </button>
          )}
        </>
      }
    >
      <div className="ms-inst">
        <p>{lt('inst.intro')}</p>
        {existing && !unlocked ? (
          <>
            <p className="ms-inst-note">{lt('inst.active')}</p>
            <label className="ms-inline">
              {lt('inst.unlockPassword')}{' '}
              <input
                type="password"
                autoFocus
                value={pw}
                title={lt('inst.unlockTip')}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void unlock();
                }}
              />
            </label>
          </>
        ) : (
          <>
            {!existing ? (
              <fieldset>
                <label className="ms-inline">
                  {lt('inst.password')} <input type="password" autoFocus value={pw} title={lt('inst.passwordTip')} onChange={(e) => setPw(e.target.value)} />
                </label>
                <label className="ms-inline">
                  {lt('inst.confirm')} <input type="password" value={pw2} title={lt('inst.confirmTip')} onChange={(e) => setPw2(e.target.value)} />
                </label>
              </fieldset>
            ) : null}
            <OptionsEditor opts={opts} onChange={setOpts} />
            {existing?.lockedParts?.length ? <p className="ms-inst-note">{lt('inst.lockedCount', { n: existing.lockedParts.length })}</p> : null}
          </>
        )}
        {error ? <p className="ms-inst-error">{error}</p> : null}
        <p className="ms-inst-note">{lt('inst.honest')}</p>
      </div>
    </Dialog>
  );
}

export function openInstructorDialog(): void {
  openCustomDialog((close) => <InstructorDialog close={close} />);
}
