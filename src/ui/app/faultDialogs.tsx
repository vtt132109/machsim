/**
 * Troubleshooting practice (loaded on first use from Simulate › Auto fault / Reveal faults /
 * Clear all faults):
 * - Auto fault: number of faults, allowed kinds and a seed (the same seed and circuit give the
 *   same exercise, so a teacher can hand one out to a class); places hidden faults on random parts.
 * - Reveal faults: shows every fault (and keeps them in the circuit) so the learner can check
 *   the answer.
 * - Clear all faults: removes every injected fault after a confirmation.
 */
import { useState } from 'react';
import { FAULT_KINDS, clearFaults, listFaults, placeAutoFaults, revealFaults, type FaultKind } from '../../model/faults';
import { actions, getState, partLookup } from '../store';
import { Dialog } from '../common/Dialog';
import { alertDialog, confirmDialog, openCustomDialog } from '../common/dialogs';
import { CheckField } from '../common/Field';
import { describeFault } from '../editor/faultText';
import { t } from '../../i18n';

function AutoFaultDialog({ close }: { close: () => void }) {
  const [count, setCount] = useState('1');
  const [seed, setSeed] = useState(() => String(1 + Math.floor(Math.random() * 9999)));
  const [kinds, setKinds] = useState<Set<FaultKind>>(() => new Set(FAULT_KINDS));
  const apply = () => {
    const n = Math.max(1, Math.min(20, Math.round(Number(count)) || 1));
    const s = Math.max(0, Math.round(Number(seed)) || 0);
    let placed = 0;
    actions.applyDesign((d) => {
      const r = placeAutoFaults(d, partLookup, { count: n, kinds: [...kinds], seed: s });
      placed = r.placed.length;
      return r.design;
    });
    close();
    if (!placed) void alertDialog({ title: t('fault.auto.title'), message: t('fault.auto.none') });
    else actions.addSimMessage('info', t('fault.auto.done', { n: placed }), 'simulation');
  };
  return (
    <Dialog
      title={t('fault.auto.title')}
      onClose={close}
      width={440}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={kinds.size === 0} onClick={apply}>
            {t('fault.auto.apply')}
          </button>
        </>
      }
    >
      <div className="ms-prop-section">
        <p className="ms-hint">{t('fault.auto.intro')}</p>
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{t('fault.auto.count')}</span>
          <input className="ms-input" type="number" min={1} max={20} value={count} title={t('tip.fault.autoCount')} onChange={(e) => setCount(e.target.value)} />
        </label>
        <div className="ms-cfield">
          <span className="ms-cfield-label">{t('fault.auto.kinds')}</span>
          {FAULT_KINDS.map((k) => (
            <CheckField
              key={k}
              label={t(`fault.${k}`)}
              checked={kinds.has(k)}
              onChange={(v) =>
                setKinds((prev) => {
                  const next = new Set(prev);
                  if (v) next.add(k);
                  else next.delete(k);
                  return next;
                })
              }
            />
          ))}
        </div>
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{t('fault.auto.seed')}</span>
          <input className="ms-input" type="number" min={0} value={seed} title={t('tip.fault.autoSeed')} onChange={(e) => setSeed(e.target.value)} />
        </label>
      </div>
    </Dialog>
  );
}

export function openAutoFaultDialog(): void {
  openCustomDialog((close) => <AutoFaultDialog close={close} />);
}

/** Reveal every fault of the design and list them. */
export function revealFaultsFlow(): void {
  actions.applyDesign((d) => revealFaults(d));
  const faults = listFaults(getState().design);
  void alertDialog({
    title: t('fault.reveal.title'),
    message: faults.length ? (
      <ul className="ms-fault-list">
        {faults.map((f, i) => (
          <li key={i}>{t('fault.reveal.item', { refdes: f.refdes, what: describeFault(f.fault) })}</li>
        ))}
      </ul>
    ) : (
      t('fault.reveal.empty')
    ),
  });
}

/** Remove every injected fault after a confirmation. */
export async function clearFaultsFlow(): Promise<void> {
  const n = listFaults(getState().design).length;
  if (!n) {
    await alertDialog({ title: t('cmd.simulate.clearFaults'), message: t('fault.reveal.empty') });
    return;
  }
  const ok = await confirmDialog({ title: t('cmd.simulate.clearFaults'), message: t('fault.cleared', { n }), danger: true });
  if (!ok) return;
  actions.applyDesign((d) => clearFaults(d));
  actions.addSimMessage('info', t('fault.cleared', { n }), 'simulation');
}
