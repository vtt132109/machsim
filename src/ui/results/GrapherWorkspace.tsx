/**
 * Grapher workspace: the results window over the whole run history (results/history.ts).
 *
 *   <GrapherWorkspace doc dispatch canCapture onCapture initialPostprocessor />
 *
 * - Page navigation: a history list of every page (grouped by run, newest run first) and tabs for
 *   the pages of the active page's run.
 * - Page actions: properties dialog (page title, grid, background, x / y axis title, range and log
 *   scale, and per trace label, colour, width, visibility), overlay traces from earlier runs, "add
 *   traces from latest simulation", duplicate / delete page, capture the interactive session.
 * - The page itself is a Grapher on the page result (own result plus overlaid runs) with the page
 *   properties, trace styles and a resolver for postprocessor references to other pages
 *   (`tran2.V(out)`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { Grapher } from './Grapher';
import {
  addOverlay,
  addTracesFromLatest,
  crossPageResolver,
  duplicatePage,
  findPage,
  overlayCandidates,
  pageResult,
  pageTab,
  pageTitle,
  removeOverlay,
  removePage,
  runLabel,
  setActive,
  setPageProps,
  setTraceStyle,
  type AxisProps,
  type GrapherDoc,
  type GraphPage,
  type PageProps,
  type TraceRef,
  type TraceStyle,
} from './history';
import { buildPlotData } from './plotModel';
import { t } from '../../i18n';

export type DocUpdate = (f: (d: GrapherDoc) => GrapherDoc) => void;

export interface GrapherWorkspaceProps {
  doc: GrapherDoc;
  dispatch: DocUpdate;
  /** true while an interactive session runs (shows the capture button) */
  canCapture?: boolean;
  onCapture?: () => void;
  initialPostprocessor?: boolean;
  className?: string;
  /** extra controls of the host, shown after the page tools (import, keep in file) */
  pageBarExtra?: ReactNode;
}

const legendKeyOf = (key: string) => key.replace(/:(mag|ph)$/, '');

/** Legend entries of a page (one per vector and run): key and default label. */
export function pageLegend(doc: GrapherDoc, page: GraphPage): { key: string; label: string; color: number }[] {
  const r = pageResult(doc, page);
  const plot = r ? buildPlotData(r) : null;
  const out: { key: string; label: string; color: number }[] = [];
  for (const tr of plot?.traces ?? []) {
    const k = legendKeyOf(tr.key);
    if (!out.some((x) => x.key === k)) out.push({ key: k, label: tr.label, color: tr.color });
  }
  return out;
}

function numOrUndef(text: string): number | undefined {
  const v = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(v) ? v : undefined;
}

function AxisFields({ title, axis, onChange }: { title: string; axis: AxisProps; onChange: (a: AxisProps) => void }) {
  return (
    <fieldset className="msr-props-axis">
      <legend>{title}</legend>
      <label title={t('tip.grapher.axisLabel')}>
        {t('grapher.props.axisLabel')} <input className="ms-input" title={t('tip.grapher.axisLabel')} value={axis.label ?? ''} onChange={(e) => onChange({ ...axis, label: e.target.value || undefined })} />
      </label>
      <label title={t('tip.grapher.axisMin')}>
        {t('grapher.props.min')} <input className="ms-input msr-num-input" title={t('tip.grapher.axisMin')} defaultValue={axis.min ?? ''} onChange={(e) => onChange({ ...axis, min: numOrUndef(e.target.value) })} />
      </label>
      <label title={t('tip.grapher.axisMax')}>
        {t('grapher.props.max')} <input className="ms-input msr-num-input" title={t('tip.grapher.axisMax')} defaultValue={axis.max ?? ''} onChange={(e) => onChange({ ...axis, max: numOrUndef(e.target.value) })} />
      </label>
      <label title={t('tip.grapher.axisLog')}>
        <input type="checkbox" title={t('tip.grapher.axisLog')} checked={!!axis.log} onChange={(e) => onChange({ ...axis, log: e.target.checked })} /> {t('grapher.props.log')}
      </label>
    </fieldset>
  );
}

const WIDTHS = [1, 1.5, 2, 3, 4];

export function PropertiesDialog({ doc, page, dispatch, close }: { doc: GrapherDoc; page: GraphPage; dispatch: DocUpdate; close: () => void }) {
  const [props, setProps] = useState<PageProps>(() => ({ ...page.props, x: { ...page.props.x }, y: { ...page.props.y } }));
  const legend = useMemo(() => pageLegend(doc, page), [doc, page]);
  const [styles, setStyles] = useState<Record<string, TraceStyle>>(() => ({ ...page.traces }));
  const setStyle = (key: string, patch: Partial<TraceStyle>) => setStyles((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  const apply = () => {
    dispatch((d) => {
      let next = setPageProps(d, page.id, props);
      for (const [k, s] of Object.entries(styles)) next = setTraceStyle(next, page.id, k, s);
      return next;
    });
    close();
  };
  return (
    <Dialog
      title={t('grapher.props.title')}
      onClose={close}
      width={640}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={apply}>
            {t('grapher.props.apply')}
          </button>
        </>
      }
    >
      <div className="msr-props">
        <label className="msr-props-row" title={t('tip.grapher.pageTitle')}>
          {t('grapher.props.pageTitle')} <input className="ms-input" title={t('tip.grapher.pageTitle')} value={props.title ?? ''} placeholder={pageTitle(doc, { ...page, props: {} })} onChange={(e) => setProps({ ...props, title: e.target.value || undefined })} />
        </label>
        <div className="msr-props-row">
          <label title={t('tip.grapher.grid')}>
            <input type="checkbox" title={t('tip.grapher.grid')} checked={props.grid ?? true} onChange={(e) => setProps({ ...props, grid: e.target.checked })} /> {t('results.grapher.grid')}
          </label>
          <label title={t('tip.grapher.background')}>
            {t('grapher.props.background')}{' '}
            <select className="ms-select" title={t('tip.grapher.background')} value={props.background ?? 'dark'} onChange={(e) => setProps({ ...props, background: e.target.value as 'dark' | 'light' })}>
              <option value="dark">{t('results.grapher.darkBg')}</option>
              <option value="light">{t('results.grapher.lightBg')}</option>
            </select>
          </label>
        </div>
        <AxisFields title={t('grapher.props.xAxis')} axis={props.x ?? {}} onChange={(x) => setProps({ ...props, x })} />
        <AxisFields title={t('grapher.props.yAxis')} axis={props.y ?? {}} onChange={(y) => setProps({ ...props, y })} />
        <table className="msr-table msr-props-traces">
          <thead>
            <tr>
              <th scope="col">{t('results.grapher.trace')}</th>
              <th scope="col">{t('grapher.props.label')}</th>
              <th scope="col">{t('common.colour')}</th>
              <th scope="col">{t('grapher.props.width')}</th>
              <th scope="col">{t('grapher.props.visible')}</th>
            </tr>
          </thead>
          <tbody>
            {legend.map((l) => {
              const s = styles[l.key] ?? {};
              const color = s.color ?? l.color;
              return (
                <tr key={l.key}>
                  <th scope="row">
                    <span className={`msr-swatch msr-c${(color % 8) + 1}`} aria-hidden /> {l.label}
                  </th>
                  <td>
                    <input className="ms-input" title={t('tip.grapher.traceLabel')} value={s.label ?? ''} placeholder={l.label} onChange={(e) => setStyle(l.key, { label: e.target.value || undefined })} />
                  </td>
                  <td>
                    <select className="ms-select" title={t('tip.grapher.traceColor')} value={color % 8} onChange={(e) => setStyle(l.key, { color: Number(e.target.value) })}>
                      {Array.from({ length: 8 }, (_, i) => (
                        <option key={i} value={i}>
                          {t('grapher.props.colorN', { n: i + 1 })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="ms-select" title={t('tip.grapher.traceWidth')} value={s.width ?? 1.5} onChange={(e) => setStyle(l.key, { width: Number(e.target.value) })}>
                      {WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {t('grapher.props.widthPx', { w })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" title={t('tip.grapher.traceVisible')} checked={!s.hidden} onChange={(e) => setStyle(l.key, { hidden: !e.target.checked })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

export function OverlayDialog({ doc, pageId, dispatch, close }: { doc: GrapherDoc; pageId: string; dispatch: DocUpdate; close: () => void }) {
  const page = findPage(doc, pageId);
  const [picked, setPicked] = useState<TraceRef[]>([]);
  const candidates = overlayCandidates(doc, pageId);
  const same = (a: TraceRef, b: TraceRef) => a.runId === b.runId && a.tab === b.tab && a.vector === b.vector;
  const toggle = (r: TraceRef) => setPicked((p) => (p.some((x) => same(x, r)) ? p.filter((x) => !same(x, r)) : [...p, r]));
  const apply = () => {
    dispatch((d) => picked.reduce((acc, r) => addOverlay(acc, pageId, r), d));
    close();
  };
  return (
    <Dialog
      title={t('grapher.overlay.title')}
      onClose={close}
      width={600}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!picked.length} onClick={apply}>
            {t('grapher.overlay.add', { n: picked.length })}
          </button>
        </>
      }
    >
      <div className="msr-overlay">
        <p className="ms-hint">{t('grapher.overlay.intro')}</p>
        {page && page.overlays.length > 0 && (
          <>
            <h4>{t('grapher.overlay.current')}</h4>
            <ul>
              {page.overlays.map((o) => (
                <li key={`${o.runId}:${o.tab}:${o.vector}`}>
                  {o.vector} — {runLabel(doc, o.runId)}{' '}
                  <button type="button" className="ms-btn ms-btn-small" title={t('tip.grapher.removeOverlay')} onClick={() => dispatch((d) => removeOverlay(d, pageId, o))}>
                    {t('grapher.overlay.remove')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <h4>{t('grapher.overlay.available')}</h4>
        {candidates.length ? (
          <ul className="msr-overlay-list">
            {candidates.map((c) => (
              <li key={`${c.ref.runId}:${c.ref.tab}:${c.ref.vector}`}>
                <label>
                  <input type="checkbox" checked={picked.some((x) => same(x, c.ref))} onChange={() => toggle(c.ref)} /> {c.label}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ms-hint">{t('grapher.overlay.none')}</p>
        )}
      </div>
    </Dialog>
  );
}

export function GrapherWorkspace({ doc, dispatch, canCapture, onCapture, initialPostprocessor, className, pageBarExtra }: GrapherWorkspaceProps) {
  const page = findPage(doc, doc.active) ?? doc.pages[doc.pages.length - 1];
  // a status note belongs to the page it was made on
  const [noteState, setNoteState] = useState<{ page: string; text: string } | null>(null);
  const result = useMemo(() => (page ? pageResult(doc, page) : undefined), [doc, page]);
  const results = useMemo(() => (result ? [result] : []), [result]);
  const own = page ? pageTab(doc, page) : undefined;
  const external = useMemo(() => crossPageResolver(doc, own?.result.scale), [doc, own]);
  if (!page || !result) return null;
  const note = noteState && noteState.page === page.id ? noteState.text : null;
  const runPages = doc.pages.filter((p) => p.runId === page.runId);
  const runsNewest = [...doc.runs].reverse();
  const title = pageTitle(doc, page);
  const latest = () => {
    const r = addTracesFromLatest(doc, page.id);
    dispatch(() => r.doc);
    setNoteState({ page: page.id, text: r.added ? t('grapher.latestAdded', { n: r.added }) : t('grapher.latestNone') });
  };
  const extra = (
    <>
      <button type="button" className="msr-btn" title={t('tip.grapher.properties')} onClick={() => openCustomDialog((close) => <PropertiesDialog doc={doc} page={page} dispatch={dispatch} close={close} />)}>
        {t('grapher.properties')}
      </button>
      <button type="button" className="msr-btn" title={t('tip.grapher.overlay')} onClick={() => openCustomDialog((close) => <OverlayDialog doc={doc} pageId={page.id} dispatch={dispatch} close={close} />)}>
        {t('grapher.overlay.button')}
      </button>
      <button type="button" className="msr-btn" title={t('tip.grapher.latest')} onClick={latest}>
        {t('grapher.latest')}
      </button>
    </>
  );
  return (
    <div className={`msr-workspace ${className ?? ''}`}>
      <div className="msr-pagebar">
        <label className="msr-inline" title={t('tip.grapher.history')}>
          {t('grapher.history')}{' '}
          <select className="ms-select msr-history" value={page.id} onChange={(e) => dispatch((d) => setActive(d, e.target.value))}>
            {runsNewest.map((run) => (
              <optgroup key={run.id} label={runLabel(doc, run.id)}>
                {doc.pages
                  .filter((p) => p.runId === run.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {pageTitle(doc, p)} [{p.key}]
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="msr-tabs msr-page-tabs" role="tablist" aria-label={t('grapher.pages')}>
          {runPages.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === page.id} className={`msr-tab${p.id === page.id ? ' msr-tab-active' : ''}`} title={t('tip.grapher.pageKey', { key: p.key })} onClick={() => dispatch((d) => setActive(d, p.id))}>
              {pageTab(doc, p)?.title ?? p.key}
            </button>
          ))}
        </div>
        <span className="msr-spacer" />
        {canCapture && onCapture && (
          <button type="button" className="msr-btn" title={t('tip.grapher.capture')} onClick={onCapture}>
            {t('grapher.capture')}
          </button>
        )}
        <button type="button" className="msr-btn" title={t('tip.grapher.duplicate')} onClick={() => dispatch((d) => duplicatePage(d, page.id))}>
          {t('grapher.duplicate')}
        </button>
        <button type="button" className="msr-btn" title={t('tip.grapher.deletePage')} onClick={() => dispatch((d) => removePage(d, page.id))}>
          {t('grapher.deletePage')}
        </button>
        {pageBarExtra}
      </div>
      <div className="msr-page-title">
        <b>{title}</b> <span className="ms-hint">{t('grapher.keyHint', { key: page.key })}</span>
        {note && (
          <span className="ms-hint" role="status">
            {' '}
            {note}
          </span>
        )}
      </div>
      <Grapher
        key={page.id}
        results={results}
        external={external}
        pageProps={page.props}
        onPagePropsChange={(patch) => dispatch((d) => setPageProps(d, page.id, patch))}
        traceStyles={page.traces}
        onTraceStyleChange={(key, patch) => dispatch((d) => setTraceStyle(d, page.id, key, patch))}
        toolbarExtra={extra}
        exportTitle={title}
        hideSingleTab
        initialPostprocessor={initialPostprocessor}
        className="msx-grapher"
      />
    </div>
  );
}
