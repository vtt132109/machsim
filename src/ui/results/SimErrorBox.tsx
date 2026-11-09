/**
 * Beginner-friendly simulation error box: what went wrong, why, how to fix it, the technical
 * message, and "show on the schematic" buttons for the parts the message names.
 * SimErrorHint is the compact one-line form used in the Simulation messages list. Convergence
 * failures (no convergence, singular matrix, timestep too small) also offer the convergence
 * assistant.
 */
import { t } from '../../i18n';
import { explainSimError, mentionedRefdes } from '../../i18n/erc';
import { actions, getState } from '../store';
import { runCommand } from '../app/extensions';
import { classifyFailure } from '../analysis/convergence';

/** "Convergence assistant…" button for convergence-type failures (null otherwise). */
function AssistButton({ message }: { message: string }) {
  if (classifyFailure(message) === 'other') return null;
  return (
    <button type="button" className="ms-btn ms-btn-small" title={t('tip.assist.open')} onClick={() => runCommand('simulate.convergenceAssistant')}>
      {t('sim.assist.open')}
    </button>
  );
}

function partExists(refdes: string): boolean {
  const r = refdes.toUpperCase();
  return getState().design.sheets.some((s) => s.parts.some((p) => p.refdes.toUpperCase() === r));
}

export function SimErrorBox({ message, className = 'msr-error' }: { message: string; className?: string }) {
  const e = explainSimError(message);
  const parts = mentionedRefdes(message).filter(partExists).slice(0, 4);
  return (
    <div className={`${className} ms-sim-error`} role="alert">
      <strong>{e.title}</strong>
      <p>
        <b>{t('erc.why')}</b> {e.why}
      </p>
      <p>
        <b>{t('erc.fix')}:</b> {e.fix}
      </p>
      <p className="ms-btn-row">
        {parts.map((r) => (
          <button key={r} type="button" className="ms-btn ms-btn-small" onClick={() => actions.findAndShow(r)}>
            {t('results.grapher.locatePart', { refdes: r })}
          </button>
        ))}
        <AssistButton message={message} />
      </p>
      {e.detail && e.detail !== e.title ? (
        <details className="ms-tech">
          <summary>{t('erc.technical')}</summary>
          <small className="ms-hint">{e.detail}</small>
        </details>
      ) : null}
    </div>
  );
}

/** Compact explanation under an error line of the messages list (why in the tooltip). */
export function SimErrorHint({ message }: { message: string }) {
  const e = explainSimError(message);
  const parts = mentionedRefdes(message).filter(partExists).slice(0, 3);
  return (
    <div className="ms-msg-explain" title={`${t('erc.why')} ${e.why}`}>
      <b>{e.title}</b> — {e.fix}
      {parts.map((r) => (
        <button key={r} type="button" className="ms-btn ms-btn-small" onClick={() => actions.findAndShow(r)}>
          {t('results.grapher.locatePart', { refdes: r })}
        </button>
      ))}
      <AssistButton message={message} />
    </div>
  );
}
