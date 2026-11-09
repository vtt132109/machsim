/**
 * First-run welcome panel (lazy-loaded): language choice, then three ways to begin — the
 * step-by-step tutorial, the example circuits, or an empty sheet — plus "show on start".
 * Switching the language re-renders the whole application immediately (LanguageRoot).
 */
import { useSyncExternalStore } from 'react';
import { getLang, LANG_NAMES, LANGS, setLang, t } from '../../i18n';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { hasCommand, runCommand } from '../app/extensions';
import { getState } from '../store';
import { focusCanvas } from '../editor/controller';
import { openHelp, welcomePrefs } from './open';
import './help.css';

function WelcomeBody({ close }: { close: () => void }) {
  const prefs = useSyncExternalStore(welcomePrefs.subscribe, welcomePrefs.getState, welcomePrefs.getState);
  const lang = getLang();
  return (
    <div className="ms-welcome">
      <div className="ms-welcome-head">
        <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
          <rect x="2" y="2" width="44" height="44" rx="9" fill="var(--accent)" />
          <path d="M9 30h7l4-12 6 18 4-10h9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>{t('welcome.intro')}</p>
      </div>
      <div className="ms-welcome-lang" role="radiogroup" aria-label={t('welcome.language')}>
        <span>{t('welcome.language')}</span>
        {LANGS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={lang === l} className={`ms-btn ${lang === l ? 'ms-btn-primary' : ''}`} onClick={() => setLang(l)}>
            {LANG_NAMES[l]}
          </button>
        ))}
      </div>
      <div className="ms-welcome-choices">
        <button
          type="button"
          className="ms-welcome-choice"
          data-autofocus
          onClick={() => {
            close();
            void openHelp({ kind: 'start' });
          }}
        >
          <strong>{t('welcome.tutorial')}</strong>
          <span>{t('welcome.tutorialHint')}</span>
        </button>
        <button
          type="button"
          className="ms-welcome-choice"
          disabled={!hasCommand('file.examples')}
          onClick={() => {
            close();
            runCommand('file.examples');
          }}
        >
          <strong>{t('welcome.examples')}</strong>
          <span>{t('welcome.examplesHint')}</span>
        </button>
        <button
          type="button"
          className="ms-welcome-choice"
          onClick={() => {
            close();
            focusCanvas();
          }}
        >
          <strong>{t('welcome.blank')}</strong>
          <span>{t('welcome.blankHint')}</span>
        </button>
      </div>
      {prefs.beginnerAsked ? null : (
        <div className="ms-welcome-offer">
          <strong>{t('beginner.offer.title')}</strong>
          <p>{t('beginner.offer.body')}</p>
          <div className="ms-btn-row">
            <button
              type="button"
              className="ms-btn ms-btn-primary"
              onClick={() => {
                welcomePrefs.setState({ ...welcomePrefs.getState(), beginnerAsked: true });
                if (getState().ui.beginner !== true) runCommand('options.beginnerMode');
              }}
            >
              {t('beginner.offer.accept')}
            </button>
            <button type="button" className="ms-btn" onClick={() => welcomePrefs.setState({ ...welcomePrefs.getState(), beginnerAsked: true })}>
              {t('beginner.offer.decline')}
            </button>
          </div>
        </div>
      )}
      <p className="ms-hint">{t('welcome.f1')}</p>
      <label className="ms-check">
        <input type="checkbox" checked={prefs.showOnStart} onChange={(e) => welcomePrefs.setState({ ...prefs, seen: true, showOnStart: e.target.checked })} />
        <span>{t('welcome.showOnStart')}</span>
      </label>
    </div>
  );
}

/** Show the welcome panel. */
export function showWelcomePanel(): void {
  openCustomDialog((close) => (
    <Dialog title={t('welcome.title')} onClose={close} width="min(620px, 96vw)" className="ms-welcome-dialog">
      <WelcomeBody close={close} />
    </Dialog>
  ));
}
