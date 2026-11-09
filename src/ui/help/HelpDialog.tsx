/**
 * Help browser (lazy-loaded): a topic list on the left — Getting started, keyboard shortcuts,
 * every component group and family, every instrument and every analysis — and the page on the
 * right. Pages explain what the thing is, when to use it and how to read the result, and offer a
 * one-click action (place the part, choose the analysis, open the examples).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { GROUPS, listParts, getPart } from '../../library';
import type { PartDef, PartGroup } from '../../library/types';
import type { AnalysisType } from '../../sim/netlist';
import { t, tr } from '../../i18n';
import { ANALYSIS_HELP, FAMILY_HELP, GETTING_STARTED, GROUP_HELP, INSTRUMENT_HELP, type HelpEntry } from '../../i18n/help';
import { GUIDE_ORDER, GUIDE_PAGES, type GuidePageId } from '../../i18n/helpGuides';
import { PART_HELP } from '../../i18n/partHelp';
import { familyName, groupName, partDescription, partName } from '../../i18n/library';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { actions } from '../store';
import { focusCanvas } from '../editor/controller';
import { hasCommand, runCommand } from '../app/extensions';
import { ANALYSIS_LABELS, ANALYSIS_ORDER } from '../app/menus';
import { SHORTCUT_HELP } from '../app/shortcuts';
import { PANEL_TITLES } from '../instruments/titles';
import { INSTRUMENT_KINDS, type HelpTopic } from './open';
import './help.css';

const topicId = (topic: HelpTopic): string => {
  switch (topic.kind) {
    case 'group':
      return `group:${topic.group}`;
    case 'family':
      return `family:${topic.group}/${topic.family}`;
    case 'part':
      return `part:${topic.partId}`;
    case 'instrument':
      return `instrument:${topic.instrument}`;
    case 'analysis':
      return `analysis:${topic.analysis}`;
    case 'guide':
      return `guide:${topic.page}`;
    default:
      return topic.kind;
  }
};

function familiesOf(group: PartGroup): string[] {
  return Array.from(new Set(listParts().filter((p) => p.group === group).map((p) => p.family || 'General'))).sort((a, b) => familyName(a).localeCompare(familyName(b)));
}

function Entry({ entry }: { entry: HelpEntry | undefined }) {
  if (!entry) return null;
  return (
    <div className="ms-help-entry">
      <section>
        <h4>{t('help.what')}</h4>
        <p>{tr(entry.what)}</p>
      </section>
      <section>
        <h4>{t('help.use')}</h4>
        <p>{tr(entry.use)}</p>
      </section>
      {entry.read ? (
        <section>
          <h4>{t('help.read')}</h4>
          <p>{tr(entry.read)}</p>
        </section>
      ) : null}
      {entry.tip ? (
        <p className="ms-help-tip">
          <strong>{t('help.tip')}</strong> {tr(entry.tip)}
        </p>
      ) : null}
    </div>
  );
}

function placeAndClose(part: PartDef, close: () => void): void {
  actions.startPlacing(part.id);
  close();
  focusCanvas();
}

function GuideView({ page }: { page: GuidePageId }) {
  const g = GUIDE_PAGES[page];
  return (
    <div className="ms-help-page">
      <h3>{tr(g.title)}</h3>
      {g.sections.map((s) => (
        <section key={s.heading.en}>
          <h4>{tr(s.heading)}</h4>
          <p>{tr(s.body)}</p>
        </section>
      ))}
      {g.code ? (
        <pre className="ms-help-code">
          <code>{g.code.join('\n')}</code>
        </pre>
      ) : null}
    </div>
  );
}

function Page({ topic, go, close }: { topic: HelpTopic; go: (t: HelpTopic) => void; close: () => void }): ReactNode {
  switch (topic.kind) {
    case 'guide':
      return <GuideView page={topic.page} />;
    case 'start':
    case 'index':
      return (
        <div className="ms-help-page">
          <h3>{t('help.startTitle')}</h3>
          <p className="ms-hint">{t('help.startIntro')}</p>
          <ol className="ms-help-guide">
            {GETTING_STARTED.map((s) => (
              <li key={s.title.en}>
                <strong>{tr(s.title)}</strong>
                <p>{tr(s.body)}</p>
                {s.action ? <p className="ms-help-try">{tr(s.action)}</p> : null}
              </li>
            ))}
          </ol>
          <div className="ms-btn-row">
            {hasCommand('file.examples') ? (
              <button
                type="button"
                className="ms-btn ms-btn-primary"
                onClick={() => {
                  close();
                  runCommand('file.examples');
                }}
              >
                {t('help.openExamples')}
              </button>
            ) : null}
            <button type="button" className="ms-btn" onClick={() => go({ kind: 'shortcuts' })}>
              {t('cmd.help.shortcuts')}
            </button>
          </div>
        </div>
      );
    case 'shortcuts':
      return (
        <div className="ms-help-page ms-help">
          <h3>{t('cmd.help.shortcuts')}</h3>
          {SHORTCUT_HELP.map((sec) => (
            <section key={sec.section}>
              <h4>{t(sec.section)}</h4>
              <table className="ms-table ms-help-table">
                <tbody>
                  {sec.rows.map((r) => (
                    <tr key={r.keys + r.action}>
                      <td className="ms-help-keys">{r.keys}</td>
                      <td>{t(r.action)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      );
    case 'group': {
      const fams = familiesOf(topic.group);
      return (
        <div className="ms-help-page">
          <h3>{groupName(topic.group)}</h3>
          <Entry entry={GROUP_HELP[topic.group]} />
          <h4>{t('help.families')}</h4>
          <ul className="ms-help-links">
            {fams.map((f) => (
              <li key={f}>
                <button type="button" className="ms-link-btn" onClick={() => go({ kind: 'family', group: topic.group, family: f })}>
                  {familyName(f)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'family': {
      const parts = listParts().filter((p) => p.group === topic.group && (p.family || 'General') === topic.family);
      return (
        <div className="ms-help-page">
          <p className="ms-help-crumb">
            <button type="button" className="ms-link-btn" onClick={() => go({ kind: 'group', group: topic.group })}>
              {groupName(topic.group)}
            </button>{' '}
            ›
          </p>
          <h3>{familyName(topic.family)}</h3>
          <Entry entry={FAMILY_HELP[topic.family]} />
          <h4>{t('help.partsInFamily')}</h4>
          <ul className="ms-help-parts">
            {parts.map((p) => (
              <li key={p.id}>
                <button type="button" className="ms-link-btn" onClick={() => go({ kind: 'part', partId: p.id })}>
                  {partName(p)}
                </button>
                <span className="ms-hint"> — {partDescription(p)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'part': {
      const part = getPart(topic.partId);
      if (!part) return <p className="ms-empty">{t('help.notFound')}</p>;
      if (part.instrument) return <Page topic={{ kind: 'instrument', instrument: part.instrument }} go={go} close={close} />;
      const family = part.family || 'General';
      return (
        <div className="ms-help-page">
          <p className="ms-help-crumb">
            <button type="button" className="ms-link-btn" onClick={() => go({ kind: 'group', group: part.group })}>
              {groupName(part.group)}
            </button>{' '}
            ›{' '}
            <button type="button" className="ms-link-btn" onClick={() => go({ kind: 'family', group: part.group, family })}>
              {familyName(family)}
            </button>
          </p>
          <h3>
            {partName(part)} <span className="ms-hint">({part.prefix})</span>
          </h3>
          <p>{partDescription(part)}</p>
          {PART_HELP[part.id] ? <Entry entry={PART_HELP[part.id]} /> : <Entry entry={FAMILY_HELP[family]} />}
          {part.provenance ? <p className="ms-hint">{t('help.provenance', { text: part.provenance })}</p> : null}
          <div className="ms-btn-row">
            <button type="button" className="ms-btn ms-btn-primary" onClick={() => placeAndClose(part, close)}>
              {t('help.placePart')}
            </button>
          </div>
        </div>
      );
    }
    case 'instrument': {
      const part = listParts().find((p) => p.instrument === topic.instrument);
      return (
        <div className="ms-help-page">
          <p className="ms-help-crumb">
            <button type="button" className="ms-link-btn" onClick={() => go({ kind: 'group', group: 'instruments' })}>
              {groupName('instruments')}
            </button>{' '}
            ›
          </p>
          <h3>{PANEL_TITLES[topic.instrument]}</h3>
          <Entry entry={INSTRUMENT_HELP[topic.instrument]} />
          {part ? (
            <div className="ms-btn-row">
              <button type="button" className="ms-btn ms-btn-primary" onClick={() => placeAndClose(part, close)}>
                {t('help.placeInstrument')}
              </button>
            </div>
          ) : null}
        </div>
      );
    }
    case 'analysis':
      return (
        <div className="ms-help-page">
          <h3>{ANALYSIS_LABELS[topic.analysis]}</h3>
          <Entry entry={ANALYSIS_HELP[topic.analysis]} />
          <div className="ms-btn-row">
            <button
              type="button"
              className="ms-btn ms-btn-primary"
              onClick={() => {
                actions.setActiveAnalysis(topic.analysis);
                close();
                if (hasCommand('simulate.analysisSettings')) runCommand('simulate.analysisSettings');
              }}
            >
              {t('help.useAnalysis')}
            </button>
          </div>
        </div>
      );
  }
}

function HelpBrowser({ initial, close }: { initial: HelpTopic; close: () => void }) {
  const [topic, setTopic] = useState<HelpTopic>(initial.kind === 'index' ? { kind: 'start' } : initial);
  const [openGroup, setOpenGroup] = useState<PartGroup | null>(() => {
    if (initial.kind === 'group' || initial.kind === 'family') return initial.group;
    if (initial.kind === 'part') return getPart(initial.partId)?.group ?? null;
    return null;
  });
  const groups = useMemo(() => GROUPS.filter((g) => listParts().some((p) => p.group === g.id)), []);
  const current = topicId(topic);
  const go = (next: HelpTopic) => {
    setTopic(next);
    if (next.kind === 'group' || next.kind === 'family') setOpenGroup(next.group);
  };
  const item = (target: HelpTopic, label: string, level = 0) => (
    <li key={topicId(target)}>
      <button type="button" className={`ms-help-nav-item lvl-${level} ${topicId(target) === current ? 'is-active' : ''}`} aria-current={topicId(target) === current ? 'page' : undefined} onClick={() => go(target)}>
        {label}
      </button>
    </li>
  );
  return (
    <div className="ms-help-browser">
      <nav className="ms-help-nav" aria-label={t('help.topics')}>
        <ul>
          {item({ kind: 'start' }, t('help.startTitle'))}
          {item({ kind: 'shortcuts' }, t('cmd.help.shortcuts'))}
        </ul>
        <h4>{t('help.navParts')}</h4>
        <ul>
          {groups.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className={`ms-help-nav-item ${current === `group:${g.id}` ? 'is-active' : ''}`}
                aria-expanded={openGroup === g.id}
                onClick={() => {
                  go({ kind: 'group', group: g.id });
                }}
              >
                {groupName(g.id)}
              </button>
              {openGroup === g.id ? <ul>{familiesOf(g.id).map((f) => item({ kind: 'family', group: g.id, family: f }, familyName(f), 1))}</ul> : null}
            </li>
          ))}
        </ul>
        <h4>{t('help.navGuides')}</h4>
        <ul>{GUIDE_ORDER.map((g) => item({ kind: 'guide', page: g }, tr(GUIDE_PAGES[g].title)))}</ul>
        <h4>{t('help.navInstruments')}</h4>
        <ul>{INSTRUMENT_KINDS.map((k) => item({ kind: 'instrument', instrument: k }, PANEL_TITLES[k]))}</ul>
        <h4>{t('help.navAnalyses')}</h4>
        <ul>{ANALYSIS_ORDER.map((a: AnalysisType) => item({ kind: 'analysis', analysis: a }, ANALYSIS_LABELS[a]))}</ul>
      </nav>
      <article className="ms-help-content" aria-live="polite">
        <Page topic={topic} go={go} close={close} />
      </article>
    </div>
  );
}

/** Show the help browser on a topic. */
export function showHelpDialog(topic: HelpTopic): void {
  openCustomDialog((close) => (
    <Dialog
      title={t('help.title')}
      onClose={close}
      width="min(920px, 96vw)"
      className="ms-help-dialog"
      footer={
        <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
          {t('common.close')}
        </button>
      }
    >
      <HelpBrowser initial={topic} close={close} />
    </Dialog>
  ));
}
