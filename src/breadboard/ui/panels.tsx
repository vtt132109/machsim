/**
 * Side panels of the breadboard view: parts bin, circuit-check results and assembly guide.
 * Presentational only — the owner (BreadboardView) holds the state and passes callbacks.
 */

import type { BinContents } from '../editing';
import type { BreadboardIssue, CheckResult } from '../compare';
import type { GuideStep } from '../guide';
import { tr, UI, type Lang, type LocalizedText } from '../../i18n/breadboard';
import { partName } from '../../i18n/library';
import { formatValue } from '../markings';
import { parseUserNumber } from '../../util/units';
import { defaultParams } from '../../library';

const UNIT_BY_PREFIX: Record<string, string> = { R: 'Ω', C: 'F', L: 'H' };

function valueText(params: Record<string, string>, prefix: string): string {
  const unit = UNIT_BY_PREFIX[prefix];
  if (!unit || params.value === undefined) return '';
  const v = parseUserNumber(params.value);
  return Number.isFinite(v) ? formatValue(v, unit) : params.value;
}

export interface PartsBinProps {
  lang: Lang;
  bin: BinContents;
  placing: string | null;
  clipping: { refdes: string; pin: string } | null;
  onPlace(refdes: string): void;
  onClip(refdes: string, pin: string): void;
}

export function PartsBin({ lang, bin, placing, clipping, onPlace, onClip }: PartsBinProps) {
  const t = (x: LocalizedText) => tr(x, lang);
  return (
    <nav className="mbb-side" aria-label={t(UI.partsBin)}>
      <h2>{t(UI.partsBin)}</h2>
      {bin.parts.length === 0 ? (
        <p className="mbb-empty">{t(UI.partsBinEmpty)}</p>
      ) : (
        <ul className="mbb-list">
          {bin.parts.map((p) => {
            const v = valueText({ ...defaultParams(p.def), ...p.inst.params }, p.def.prefix);
            return (
              <li key={p.refdes}>
                <button type="button" className="mbb-item" aria-pressed={placing === p.refdes} onClick={() => onPlace(p.refdes)} title={t(UI.placing).replace('{part}', p.refdes)}>
                  <b>{p.refdes}</b> {partName(p.def)}
                  {v && <small>{v}</small>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h2>{t(UI.offBoard)}</h2>
      {bin.offBoard.length === 0 ? (
        <p className="mbb-empty">—</p>
      ) : (
        <ul className="mbb-list">
          {bin.offBoard.map(({ part, pins }) => (
            <li key={part.refdes} className="mbb-item" style={{ cursor: 'default' }}>
              <b>{part.refdes}</b> {partName(part.def)}
              {pins.length > 0 ? (
                <>
                  <small>{t(UI.pickPin)}</small>
                  <div className="mbb-pins">
                    {pins.map((pin) => (
                      <button
                        key={pin}
                        type="button"
                        className="mbb-btn mbb-pin"
                        aria-pressed={clipping?.refdes === part.refdes && clipping.pin === pin}
                        onClick={() => onClip(part.refdes, pin)}
                        title={t(UI.clipping).replace('{part}', part.refdes).replace('{pin}', pin)}
                      >
                        {pin}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <small>✓</small>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------

export interface IssuesPanelProps {
  lang: Lang;
  check: CheckResult;
  active: string | null;
  onActivate(issue: BreadboardIssue): void;
  onClose(): void;
}

function IssueItem({ lang, issue, active, onActivate }: { lang: Lang; issue: BreadboardIssue; active: boolean; onActivate(i: BreadboardIssue): void }) {
  return (
    <li>
      <button type="button" className={`mbb-item mbb-issue mbb-${issue.severity}`} aria-pressed={active} onClick={() => onActivate(issue)}>
        <b>{tr(issue.title, lang)}</b>
        <p>{tr(issue.message, lang)}</p>
        <p className="mbb-fix">→ {tr(issue.fix, lang)}</p>
      </button>
    </li>
  );
}

export function IssuesPanel({ lang, check, active, onActivate, onClose }: IssuesPanelProps) {
  const t = (x: LocalizedText) => tr(x, lang);
  return (
    <aside className="mbb-panel" aria-label={t(UI.issues)}>
      <div className="mbb-panel-head">
        <h2>
          {t(UI.issues)} ({check.counts.errors} {t(UI.errors)}, {check.counts.warnings} {t(UI.warnings)})
        </h2>
        <button type="button" className="mbb-btn" onClick={onClose} aria-label={t(UI.close)}>
          ×
        </button>
      </div>
      <div className="mbb-scroll" aria-live="polite">
        {check.issues.length === 0 && <p className="mbb-empty">{t(UI.noIssues)}</p>}
        <ul className="mbb-list" style={{ padding: 0 }}>
          {check.issues.map((i) => (
            <IssueItem key={i.id} lang={lang} issue={i} active={active === i.id} onActivate={onActivate} />
          ))}
        </ul>
        {check.hints.length > 0 && (
          <>
            <div className="mbb-section-title">{t(UI.hints)}</div>
            <ul className="mbb-list" style={{ padding: 0 }}>
              {check.hints.map((i) => (
                <IssueItem key={i.id} lang={lang} issue={i} active={active === i.id} onActivate={onActivate} />
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------

export interface GuidePanelProps {
  lang: Lang;
  steps: GuideStep[];
  index: number;
  onIndex(i: number): void;
  onClose(): void;
}

export function GuidePanel({ lang, steps, index, onIndex, onClose }: GuidePanelProps) {
  const t = (x: LocalizedText) => tr(x, lang);
  const i = Math.max(0, Math.min(steps.length - 1, index));
  return (
    <aside className="mbb-panel" aria-label={t(UI.guide)}>
      <div className="mbb-panel-head">
        <h2>{t(UI.guide)}</h2>
        <button type="button" className="mbb-btn" onClick={onClose} aria-label={t(UI.close)}>
          ×
        </button>
      </div>
      <div className="mbb-scroll">
        <ol className="mbb-list" style={{ padding: 0 }}>
          {steps.map((s, k) => (
            <li key={s.id}>
              <button type="button" className="mbb-item" aria-current={k === i ? 'step' : undefined} onClick={() => onIndex(k)}>
                <b>
                  {t(UI.step)} {k + 1}. {t(s.title)}
                </b>
                <p className="mbb-step-text">{t(s.text)}</p>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="mbb-guide-nav">
        <button type="button" className="mbb-btn" disabled={i <= 0} onClick={() => onIndex(i - 1)}>
          ← {t(UI.prevStep)}
        </button>
        <span>
          {i + 1}/{steps.length}
        </span>
        <button type="button" className="mbb-btn mbb-primary" disabled={i >= steps.length - 1} onClick={() => onIndex(i + 1)}>
          {t(UI.nextStep)} →
        </button>
      </div>
    </aside>
  );
}
