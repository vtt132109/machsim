/**
 * React panels of the simulation integration: the Grapher window and the bottom-dock tabs
 * Simulation (speed, instruments, live readings, last results), ERC, Netlist (SPICE text) and BOM.
 */
import { maskValue, valuesHidden } from '../../model/restrictions';
import { hierarchyTree, type HierarchyNode } from '../../model/hierarchy';
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from 'react';
import type { ErcMessage, InstrumentKind } from '../../model/types';
import { formatEng } from '../../util/units';
import { openFloatingWindow, runCommand } from '../app/extensions';
import { exportFile } from '../app/files';
import { panelTitle } from '../instruments/titles';
import { lazyComponent } from '../common/lazy';
import { actions, partLookup, useEditor } from '../store';
import type { SimulationIntegration } from './controller';
import { designBom, designNetlistText, netlistFileName, netlistWithheld } from './reports';
import { lastErcCheck } from './ercState';
import './integration.css';
import { t } from '../../i18n';
import { localizeResultTitle } from '../results/titles';
import { explainErc, ruleText, severityText } from '../../i18n/erc';
import { partDescription, partName } from '../../i18n/library';

function useLive(ctrl: SimulationIntegration) {
  return useSyncExternalStore(ctrl.live.subscribe, ctrl.live.getState, ctrl.live.getState);
}

// ---------------------------------------------------------------------------
// Grapher window
// ---------------------------------------------------------------------------

/** The Grapher and its postprocessor load with the first results window (GrapherWindow.tsx). */
export const GrapherWindow = lazyComponent(() => import('./GrapherWindow').then((m) => m.GrapherWindow));
/** MCU code editor: the 8051 core, the assembler and the debugger views load with it. */
export const McuPanel = lazyComponent(() => import('../mcu/McuPanel').then((m) => m.McuPanel));
/** The Audio window (Simulate › Audio) loads on first use. */
export const AudioPanel = lazyComponent(() => import('./AudioPanel').then((m) => m.AudioPanel));
export const ScriptPanel = lazyComponent(() => import('../script/ScriptPanel').then((m) => m.ScriptPanel));

// ---------------------------------------------------------------------------
// Simulation tab
// ---------------------------------------------------------------------------

/** Streaming speeds offered in the Simulation tab (simulated seconds per wall second). */
export const SPEED_CHOICES: readonly { value: number; readonly label: string }[] = [
  { value: 1e-3, get label() { return t('integration.panels.speedSlow'); } },
  { value: 1e-2, label: '0.01×' },
  { value: 0.1, label: '0.1×' },
  { value: 1, get label() { return t('integration.panels.speedRealTime'); } },
  { value: 10, label: '10×' },
  { value: 100, label: '100×' },
  { value: 1000, label: '1000×' },
  { value: Infinity, get label() { return t('integration.panels.speedMax'); } },
];

const speedKey = (v: number) => (Number.isFinite(v) ? String(v) : 'max');

export function SimulationTab({ ctrl }: { ctrl: SimulationIntegration }) {
  const live = useLive(ctrl);
  const sim = useEditor((s) => s.sim);
  const design = useEditor((s) => s.design);
  const instruments = useMemo(() => {
    const out: { refdes: string; kind: InstrumentKind }[] = [];
    for (const sh of design.sheets) {
      for (const p of sh.parts) {
        const kind = partKind(p.partId);
        if (kind) out.push({ refdes: p.refdes, kind });
      }
    }
    // instruments inside blocks: one entry per placed copy, named by its path ("X2.XMM1")
    if (design.children?.length) {
      const walk = (n: HierarchyNode, path: string[]) => {
        for (const c of n.children) {
          const here = [...path, c.block?.inst.refdes ?? ''];
          for (const sh of c.sheets) for (const p of sh.parts) {
            const kind = partKind(p.partId);
            if (kind) out.push({ refdes: [...here, p.refdes].join('.'), kind });
          }
          if (!c.cyclic) walk(c, here);
        }
      };
      walk(hierarchyTree(design), []);
    }
    return out;
  }, [design]);
  return (
    <div className="msx-simtab">
      <section className="msx-col">
        <div className="msx-row">
          <button type="button" className="ms-btn ms-btn-small ms-btn-primary" onClick={() => runCommand('simulate.run')} disabled={sim.state === 'running'}>
            {sim.state === 'paused' ? t('integration.panels.resume') : t('common.run')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('simulate.pause')} disabled={live.session !== 'running'}>
            {t('common.pause')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('simulate.stop')} disabled={!ctrl.active}>
            {t('common.stop')}
          </button>
        </div>
        <label className="msx-field">
          <span>{t('integration.panels.interactiveSpeed')}</span>
          <select className="ms-select" value={speedKey(live.speed)} onChange={(e) => ctrl.setSpeed(e.target.value === 'max' ? Infinity : Number(e.target.value))}>
            {SPEED_CHOICES.map((c) => (
              <option key={speedKey(c.value)} value={speedKey(c.value)}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <dl className="msx-facts">
          <dt>{t('common.mode')}</dt>
          <dd>{live.mode === 'interactive' ? t('integration.panels.interactiveSession', { session: live.session }) : live.mode === 'analysis' ? t('integration.panels.analysisRunning') : t('integration.panels.idle')}</dd>
          <dt>{t('integration.panels.simulatedTime')}</dt>
          <dd>{formatEng(live.simTime, 's', 5)}</dd>
          <dt>{t('integration.panels.achievedRate')}</dt>
          <dd>{live.mode === 'interactive' && live.rate > 0 ? `${Number(live.rate.toPrecision(3))} s/s` : '—'}</dd>
        </dl>
      </section>
      <section className="msx-col">
        <h4>{t('integration.panels.instruments')}</h4>
        {instruments.length ? (
          <table className="ms-table">
            <tbody>
              {instruments.map((i) => (
                <tr key={i.refdes}>
                  <td>{panelTitle(i.kind, i.refdes)}</td>
                  <td className="ms-wrap msx-dim">{live.needStatus[i.refdes] ?? (live.streams[i.refdes]?.length ? t('integration.panels.lengthSamples', { length: live.streams[i.refdes].length }) : '')}</td>
                  <td>
                    <button type="button" className="ms-btn ms-btn-small" onClick={() => openFloatingWindow(i.kind, { refdes: i.refdes })}>
                      {t('integration.panels.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="msx-dim">{t('integration.panels.noInstrumentsInTheDesign')}</p>
        )}
      </section>
      <section className="msx-col">
        <h4>{t('integration.panels.liveReadings')}</h4>
        {live.readings.length ? (
          <table className="ms-table">
            <tbody>
              {live.readings.map((r) => (
                <tr key={r.refdes}>
                  <td>
                    <button type="button" className="msx-link" onClick={() => actions.findAndShow(r.refdes)}>
                      {r.refdes}
                    </button>
                  </td>
                  <td className="msx-dim">{r.kind}</td>
                  <td className="msx-mono">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="msx-dim">{t('integration.panels.ledsLampsMetersAndDisplays')}</p>
        )}
      </section>
      <section className="msx-col">
        <h4>{t('integration.panels.lastResults')}</h4>
        {live.results.length ? (
          <>
            <table className="ms-table">
              <tbody>
                {live.results.map((r, i) => (
                  <tr key={i} className={r.error ? 'ms-msg-error' : undefined}>
                    <td>{localizeResultTitle(r.title, r.type)}</td>
                    <td className="ms-wrap">{r.error ?? (r.scale ? t('integration.panels.vectorsPoints', { n: r.vectors.length, points: r.scale.re.length }) : t('integration.panels.vectors', { n: r.vectors.length }))}</td>
                    <td className="msx-dim">{r.elapsedMs !== undefined ? `${Math.round(r.elapsedMs)} ms` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('simulate.grapher')}>
              {t('integration.panels.openGrapher')}
            </button>
          </>
        ) : (
          <p className="msx-dim">{t('integration.panels.oneShotAnalysesDcAc')}</p>
        )}
      </section>
    </div>
  );
}

function partKind(partId: string): InstrumentKind | undefined {
  return partLookup(partId)?.instrument;
}

// ---------------------------------------------------------------------------
// ERC tab
// ---------------------------------------------------------------------------

function locate(m: ErcMessage): void {
  if (m.refdes && actions.findAndShow(m.refdes)) return;
  if (m.sheetId) actions.setActiveSheet(m.sheetId);
}

export function ErcTab() {
  const last = useSyncExternalStore(lastErcCheck.subscribe, lastErcCheck.getState, lastErcCheck.getState);
  const design = useEditor((st) => st.design);
  const markers = useEditor((s) => s.ercMarkers);
  const errors = markers.filter((m) => m.severity === 'error').length;
  return (
    <div className="ms-messages">
      <div className="ms-messages-bar">
        <span>
          {markers.length
            ? t('integration.panels.errorsErrorSValueWarning', { errors: errors, value: markers.length - errors })
            : last && last.issues === 0
              ? last.design === design
                ? t('integration.panels.ercClean')
                : t('integration.panels.ercCleanStale')
              : t('integration.panels.noErcResultsRunThe')}
        </span>
        <span className="msx-row">
          <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('tools.erc')}>
            {t('integration.panels.runErc')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => actions.clearErcMarkers()} disabled={!markers.length}>
            {t('common.clear')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('tools.clearErcScope')} disabled={!markers.length} title={t('cmd.tools.clearErcScope')}>
            {t('cmd.tools.clearErcScope')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('tools.ercReport')} title={t('cmd.tools.ercReport')}>
            {t('cmd.tools.ercReport')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => runCommand('tools.ercOptions')} title={t('cmd.tools.ercOptions')}>
            {t('cmd.tools.ercOptions')}
          </button>
        </span>
      </div>
      {markers.length ? (
        <ul className="msx-erc-list">
          {markers.map((m, i) => {
            const e = explainErc(m);
            const canLocate = !!(m.refdes || m.sheetId);
            return (
              <li key={i} className={`msx-erc-item ${m.severity === 'error' ? 'is-error' : 'is-warning'}`}>
                <div className="msx-erc-head">
                  <span className={`msx-erc-badge ${m.severity}`}>{severityText(m.severity)}</span>
                  <span className="msx-erc-rule">{ruleText(m.code)}</span>
                  <strong className="msx-erc-title">{e.title}</strong>
                </div>
                <p className="msx-erc-why">
                  <b>{t('erc.why')}</b> {e.why}
                </p>
                <p className="msx-erc-fix">
                  <b>{t('erc.fix')}:</b> {e.fix}
                </p>
                <div className="msx-erc-foot">
                  {canLocate ? (
                    <button type="button" className="ms-btn ms-btn-small" onClick={() => locate(m)} title={t('integration.panels.showOnTheSchematic')}>
                      {t('erc.locate')}
                    </button>
                  ) : null}
                  {e.detail && e.detail !== e.title ? (
                    <details className="ms-tech">
                      <summary>{t('erc.technical')}</summary>
                      <small className="msx-dim">{e.detail}</small>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Netlist tab
// ---------------------------------------------------------------------------

export function NetlistTab() {
  const design = useDeferredValue(useEditor((s) => s.design));
  const fileName = useEditor((s) => s.fileName);
  const [scope, setScope] = useState<'active' | 'all' | 'none'>('active');
  const report = useMemo(() => {
    try {
      // the listing shows 6 significant digits; Copy / Export write the exact netlist
      return { ok: true as const, ...designNetlistText(design, scope, { digits: 6 }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [design, scope]);
  const [copied, setCopied] = useState(false);
  if (valuesHidden(design)) return <p className="ms-empty">{t('learn.restricted.values')}</p>;
  if (netlistWithheld(design)) return <p className="ms-empty">{t('learn.restricted.faults')}</p>;
  return (
    <div className="ms-messages">
      <div className="ms-messages-bar">
        <label className="msx-field msx-inline">
          <span>{t('integration.panels.analyses')}</span>
          <select className="ms-select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="active">{t('common.activeAnalysis')}</option>
            <option value="all">{t('integration.panels.allSavedAnalyses')}</option>
            <option value="none">{t('common.none')}</option>
          </select>
        </label>
        <span className="msx-row">
          {report.ok && report.erc.length ? <span className="msx-dim">{t('integration.panels.lengthErcMessageS', { length: report.erc.length })}</span> : null}
          <button
            type="button"
            className="ms-btn ms-btn-small"
            disabled={!report.ok}
            onClick={() => {
              if (!report.ok) return;
              void navigator.clipboard?.writeText(designNetlistText(design, scope).text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? t('integration.panels.copied') : t('common.copy')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" disabled={!report.ok} onClick={() => report.ok && void exportFile(netlistFileName(fileName, design.title), designNetlistText(design, scope).text, { name: t('integration.panels.spiceNetlist'), extensions: ['cir'] })}>
            {t('integration.panels.export')}
          </button>
        </span>
      </div>
      {report.ok ? <pre className="msx-pre">{report.text}</pre> : <div className="ms-error-panel">{report.error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BOM tab
// ---------------------------------------------------------------------------

export function BomTab() {
  const design = useDeferredValue(useEditor((s) => s.design));
  const fileName = useEditor((s) => s.fileName);
  const [virtual, setVirtual] = useState(false);
  const bom = useMemo(() => designBom(design, virtual), [design, virtual]);
  return (
    <div className="ms-messages">
      <div className="ms-messages-bar">
        <label className="msx-inline">
          <input type="checkbox" checked={virtual} onChange={(e) => setVirtual(e.target.checked)} />{' '}{t('integration.panels.includeVirtualPartsIdealSources')}
        </label>
        <button
          type="button"
          className="ms-btn ms-btn-small"
          disabled={!bom.rows.length}
          onClick={() => void exportFile(netlistFileName(fileName, design.title).replace(/\.cir$/, ' BOM.csv'), bom.csv, { name: 'CSV', extensions: ['csv'] })}
        >
          {t('integration.panels.exportCsv')}
        </button>
      </div>
      {bom.rows.length ? (
        <table className="ms-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('integration.panels.qty')}</th>
              <th>{t('integration.panels.reference')}</th>
              <th>{t('common.value')}</th>
              <th>{t('integration.panels.tolerance')}</th>
              <th>{t('common.part')}</th>
              <th>{t('integration.panels.footprint')}</th>
              <th>{t('common.description')}</th>
            </tr>
          </thead>
          <tbody>
            {bom.rows.map((r) => (
              <tr key={r.item}>
                <td>{r.item}</td>
                <td>{r.quantity}</td>
                <td className="ms-wrap">{r.refdes.join(', ')}</td>
                <td>{maskValue(design, r.value)}</td>
                <td>{r.tolerance}</td>
                <td>{partName({ id: r.partId, name: r.name })}</td>
                <td>{r.footprint}</td>
                <td className="ms-wrap">{partDescription({ id: r.partId, description: r.description })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ms-empty">{t('integration.panels.noPhysicalPartsInThe', { value: virtual ? '' : ' (virtual parts are hidden)' })}</p>
      )}
    </div>
  );
}
