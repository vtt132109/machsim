/**
 * Grapher: the results window.
 *
 * <Grapher results={AnalysisResult[]} /> shows one tab per result (batch results flattened,
 * run families overlaid). Each tab has an interactive plot (linear / log axes, autoscale with
 * engineering ticks, legend with per-trace toggles, magnitude dB/linear + phase panes for
 * complex vectors, digital lanes), two measurement cursors with a readout table, zoom box,
 * wheel zoom, pan, reset, grid and background toggles, CSV / PNG export, a postprocessor for
 * derived vectors, and tables / statistics / charts for OP, TF, sensitivity, pole-zero,
 * Fourier, worst-case and Monte Carlo results. Errors and warnings are listed per tab.
 *
 * Props-driven and self-contained: per-tab view state lives inside the component. The Grapher
 * workspace (GrapherWorkspace.tsx) additionally controls the page properties (grid, background,
 * axis titles / ranges / log scales), trace styles (label, colour, width, visibility), extra
 * toolbar buttons and the resolver for postprocessor references to other pages. Exports: CSV,
 * MachSim measurement text (src/util/measurementText.ts), PNG and Print (plot image plus the cursor
 * table in a print window).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { PageProps, TraceStyle } from './history';
import { tracesToText } from '../../util/measurementText';
import type { AnalysisResult, Vector } from '../../sim/results';
import { formatEng } from '../../util/units';
import { downloadCanvasPng, downloadText, safeFileName } from './canvas';
import type { GraphTab, MagnitudeMode, PlotData, PlotTrace } from './plotModel';
import { buildPlotData, buildTabs, cursorReadout, displayUnit, internalVectorCount, poleZeroPoints, resultTables, sampleSets, tracesToCsv, xExtent } from './plotModel';
import type { PlotViewState } from './plotRender';
import { PlotView } from './PlotView';
import { PostprocessorPanel } from './PostprocessorPanel';
import { availableVectorNames, evaluateExpression } from './postprocessor';
import { HarmonicChart, PoleZeroChart, ResultTableView, StatisticsView, formatNumber } from './ResultTables';
import './results.css';
import { t } from '../../i18n';
import { SimErrorBox } from './SimErrorBox';

export interface GrapherProps {
  results: AnalysisResult[];
  className?: string;
  /** plot height in CSS px (default 380) */
  plotHeight?: number;
  /** tab shown first (default 0) */
  initialTab?: number;
  /** open with the postprocessor panel shown (default false) */
  initialPostprocessor?: boolean;
  /** resolver for `<page>.<vector>` references in postprocessor expressions (workspace) */
  external?: (page: string, name: string) => Vector | undefined;
  /** controlled page properties (workspace); absent = internal grid / background state */
  pageProps?: PageProps;
  onPagePropsChange?: (patch: Partial<PageProps>) => void;
  /** trace styles by legend key (workspace) */
  traceStyles?: Readonly<Record<string, TraceStyle>>;
  onTraceStyleChange?: (key: string, patch: Partial<TraceStyle>) => void;
  /** extra toolbar buttons (workspace) */
  toolbarExtra?: ReactNode;
  /** title of exported / printed files (default: the tab title) */
  exportTitle?: string;
  /** hide the tab bar when there is only one tab */
  hideSingleTab?: boolean;
}

interface TabState {
  hidden: string[];
  view: PlotViewState | null;
  cursors: [number, number] | null;
  magnitude: MagnitudeMode;
  exprs: string[];
  yLog: number[];
}

const DEFAULT_TAB_STATE: TabState = { hidden: [], view: null, cursors: null, magnitude: 'db', exprs: [], yLog: [] };

/** Legend key shared by the magnitude and phase traces of one complex vector. */
const legendKey = (t: PlotTrace) => t.key.replace(/:(mag|ph)$/, '');

function invUnit(u: string): string {
  if (u === 's') return 'Hz';
  if (u === 'Hz') return 's';
  return '';
}

function fmt(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '—';
  if (unit === 'dB' || unit === 'deg') return `${Number(v.toPrecision(5))} ${displayUnit(unit)}`;
  return formatEng(v, displayUnit(unit), 5);
}

interface Evaluated {
  result: AnalysisResult;
  exprs: { text: string; error?: string; scalar?: string }[];
}

function evaluateTab(tab: GraphTab, exprs: string[], external?: GrapherProps['external']): Evaluated {
  const info = exprs.map((text) => ({ text, error: undefined as string | undefined, scalar: undefined as string | undefined }));
  if (!exprs.length) return { result: tab.result, exprs: info };
  const augment = (r: AnalysisResult): AnalysisResult => {
    const extra: Vector[] = [];
    exprs.forEach((text, i) => {
      try {
        const out = evaluateExpression(text, { result: r, extra, external });
        extra.push(out.vector);
        if (out.scalar && out.value !== undefined && info[i].scalar === undefined) {
          info[i].scalar = out.valueIm ? `${formatNumber(out.value)} ${out.valueIm < 0 ? '-' : '+'} j${formatNumber(Math.abs(out.valueIm))}` : formatNumber(out.value);
        }
      } catch (e) {
        info[i].error ??= e instanceof Error ? e.message : String(e);
      }
    });
    return { ...r, vectors: [...r.vectors, ...extra] };
  };
  const result =
    tab.family && tab.result.runs
      ? { ...tab.result, runs: tab.result.runs.map((run) => ({ label: run.label, result: augment(run.result) })) }
      : augment(tab.result);
  return { result, exprs: info };
}

function defaultCursors(data: PlotData, view: PlotViewState | null, hidden: ReadonlySet<string>): [number, number] {
  const vis = data.traces.filter((t) => !hidden.has(t.key));
  const ext = view?.x ?? xExtent(vis.length ? vis : data.traces, data.xLog) ?? [0, 1];
  const [lo, hi] = ext;
  if (data.xLog && lo > 0 && hi > 0) {
    const a = Math.log10(lo);
    const b = Math.log10(hi);
    return [Math.pow(10, a + (b - a) / 3), Math.pow(10, a + (2 * (b - a)) / 3)];
  }
  return [lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3];
}

/** Apply page axis properties and trace styles to built plot data. */
export function decoratePlot(plot: PlotData | null, page: PageProps | undefined, styles: Readonly<Record<string, TraceStyle>> | undefined): PlotData | null {
  if (!plot) return plot;
  let out = plot;
  if (page?.x?.label || page?.y?.label || page?.x?.log !== undefined) {
    const firstAnalog = plot.panes.findIndex((p) => p.kind === 'analog');
    const xPositive = plot.traces.every((t) => Array.prototype.every.call(t.x, (v: number) => v > 0));
    out = {
      ...plot,
      xLabel: page.x?.label || plot.xLabel,
      xLog: page.x?.log !== undefined ? page.x.log && xPositive : plot.xLog,
      panes: plot.panes.map((p, i) => (i === firstAnalog && page.y?.label ? { ...p, title: page.y.label } : p)),
    };
  }
  if (styles && Object.keys(styles).length) {
    out = {
      ...out,
      traces: out.traces.map((t) => {
        const s = styles[legendKey(t)];
        if (!s) return t;
        return { ...t, label: s.label || t.label, color: s.color ?? t.color, width: s.width ?? t.width };
      }),
    };
  }
  return out;
}

/** Initial view from manual axis ranges of the page (null when the page has none). */
export function axisView(plot: PlotData | null, page: PageProps | undefined): PlotViewState | null {
  if (!plot || !page) return null;
  const x = page.x?.min !== undefined && page.x?.max !== undefined && page.x.max > page.x.min ? ([page.x.min, page.x.max] as [number, number]) : null;
  const firstAnalog = plot.panes.findIndex((p) => p.kind === 'analog');
  const y: Record<number, [number, number]> = {};
  if (firstAnalog >= 0 && page.y?.min !== undefined && page.y?.max !== undefined && page.y.max > page.y.min) y[firstAnalog] = [page.y.min, page.y.max];
  return x || Object.keys(y).length ? { x, y } : null;
}

export function Grapher({ results, className, plotHeight = 380, initialTab = 0, initialPostprocessor = false, external, pageProps, onPagePropsChange, traceStyles, onTraceStyleChange, toolbarExtra, exportTitle, hideSingleTab }: GrapherProps) {
  const tabs = useMemo(() => buildTabs(results), [results]);
  const [active, setActive] = useState(initialTab);
  const [states, setStates] = useState<Record<string, TabState>>({});
  const [gridState, setGridState] = useState(true);
  const [backgroundState, setBackgroundState] = useState<'dark' | 'light'>('dark');
  const grid = pageProps?.grid ?? gridState;
  const background = pageProps?.background ?? backgroundState;
  const setGrid = (g: boolean) => (onPagePropsChange ? onPagePropsChange({ grid: g }) : setGridState(g));
  const setBackground = (b: 'dark' | 'light') => (onPagePropsChange ? onPagePropsChange({ background: b }) : setBackgroundState(b));
  const cursorTableRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<'zoom' | 'pan'>('zoom');
  const [showPost, setShowPost] = useState(initialPostprocessor);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCanvas = useCallback((c: HTMLCanvasElement | null) => {
    canvasRef.current = c;
  }, []);

  const idx = Math.max(0, Math.min(active, tabs.length - 1));
  const tab: GraphTab | undefined = tabs[idx];
  const st = (tab && states[tab.id]) || DEFAULT_TAB_STATE;
  const patch = (p: Partial<TabState>) => {
    if (!tab) return;
    setStates((s) => ({ ...s, [tab.id]: { ...(s[tab.id] ?? DEFAULT_TAB_STATE), ...p } }));
  };

  const evaluated = useMemo(() => (tab ? evaluateTab(tab, st.exprs, external) : null), [tab, st.exprs, external]);
  const plot = useMemo(
    () => decoratePlot(evaluated ? buildPlotData(evaluated.result, { magnitude: st.magnitude, showInternal }) : null, pageProps, traceStyles),
    [evaluated, st.magnitude, showInternal, pageProps, traceStyles],
  );
  const hiddenList = useMemo(() => [...st.hidden, ...Object.entries(traceStyles ?? {}).filter(([, s]) => s.hidden).map(([k]) => k)], [st.hidden, traceStyles]);
  const hiddenKeys = useMemo(() => {
    const h = new Set(hiddenList);
    return new Set((plot?.traces ?? []).filter((t) => h.has(legendKey(t))).map((t) => t.key));
  }, [plot, hiddenList]);
  const yLogPanes = useMemo(() => {
    if (pageProps?.y?.log !== undefined && plot) {
      const first = plot.panes.findIndex((p) => p.kind === 'analog' && p.unit !== 'dB' && p.unit !== 'deg');
      return new Set(pageProps.y.log && first >= 0 ? [first] : []);
    }
    return new Set(st.yLog);
  }, [st.yLog, pageProps, plot]);
  const view = st.view ?? axisView(plot, pageProps);
  const tables = useMemo(() => (tab ? resultTables(tab.result, { showInternal }) : []), [tab, showInternal]);
  const internalCount = useMemo(() => (tab ? internalVectorCount(tab.result) : 0), [tab]);
  const sets = useMemo(() => (tab && (tab.result.type === 'montecarlo' || tab.result.type === 'worstcase') ? sampleSets(tab.result) : []), [tab]);
  const pz = useMemo(() => (tab?.result.type === 'pz' ? poleZeroPoints(tab.result) : []), [tab]);
  const hasComplex = !!plot?.panes.some((p) => p.id === 'phase');
  const visibleTraces = plot ? plot.traces.filter((t) => !hiddenKeys.has(t.key)) : [];
  const readout = plot && st.cursors ? cursorReadout(visibleTraces, st.cursors[0], st.cursors[1]) : null;

  if (!tab) {
    return (
      <div className={`msr-grapher ${className ?? ''}`}>
        <div className="msr-empty">{t('results.grapher.noSimulationResultsYetRun')}</div>
      </div>
    );
  }

  const legend: { key: string; label: string; color: number; digital?: boolean }[] = [];
  for (const t of plot?.traces ?? []) {
    const k = legendKey(t);
    if (!legend.some((l) => l.key === k)) legend.push({ key: k, label: t.label, color: t.color, digital: t.digital });
  }

  const traceLabel = (t: PlotTrace) => {
    if (!plot) return t.label;
    const pane = plot.panes[t.pane];
    return pane && (pane.id === 'phase' || pane.id.startsWith('mag')) ? `${t.label} ${pane.id === 'phase' ? 'phase' : 'mag'}` : t.label;
  };

  const exportCsv = () => {
    if (!plot) return;
    const csv = tracesToCsv(
      visibleTraces.map((t) => ({ ...t, label: traceLabel(t) })),
      `${plot.xLabel}${plot.xUnit ? ` [${plot.xUnit}]` : ''}`,
    );
    downloadText(`${safeFileName(fileTitle)}.csv`, csv);
  };

  const fileTitle = exportTitle ?? tab.title;

  const exportText = () => {
    if (!plot) return;
    const text = tracesToText(
      visibleTraces.map((t) => ({ label: traceLabel(t), unit: String(t.unit), x: t.x, y: t.y })),
      { title: fileTitle, xLabel: plot.xLabel, xUnit: String(plot.xUnit) },
    );
    downloadText(`${safeFileName(fileTitle)}.txt`, text, 'text/plain;charset=utf-8');
  };

  const exportPng = () => {
    if (canvasRef.current) downloadCanvasPng(canvasRef.current, `${safeFileName(fileTitle)}.png`);
  };

  // printing goes through the print preview (paper, margins, scale, page range ...)
  const print = () => void import('../print/PrintPreview').then((m) => m.openPrintPreview({ sheets: false, grapher: true }));

  const toggleCursors = () => {
    if (!plot) return;
    patch({ cursors: st.cursors ? null : defaultCursors(plot, view, hiddenKeys) });
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') setActive((i) => Math.min(tabs.length - 1, i + 1));
    else if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, i - 1));
  };

  const runErrors = (tab.result.runs ?? []).filter((r) => r.result.error).map((r) => `${r.label}: ${r.result.error}`);
  const warnings = [...tab.result.warnings, ...(tab.result.runs ?? []).flatMap((r) => r.result.warnings.map((w) => `${r.label}: ${w}`))];
  const xUnit = plot ? String(plot.xUnit) : '';

  return (
    <div className={`msr-grapher${background === 'light' ? ' msr-bg-light' : ''} ${className ?? ''}`}>
      {!(hideSingleTab && tabs.length === 1) && (
      <div className="msr-tabs" role="tablist" aria-label={t('results.grapher.results')} onKeyDown={onTabKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={i === idx}
            tabIndex={i === idx ? 0 : -1}
            className={`msr-tab${i === idx ? ' msr-tab-active' : ''}${t.result.error ? ' msr-tab-error' : ''}`}
            onClick={() => setActive(i)}
            title={t.result.error ?? t.title}
          >
            {t.title}
          </button>
        ))}
      </div>
      )}

      {plot && (
        <div className="msr-toolbar" role="toolbar" aria-label={t('results.grapher.graphTools')}>
          <div className="msr-seg" role="group" aria-label={t('results.grapher.mouseTool')}>
            <button type="button" className={tool === 'zoom' ? 'msr-on' : ''} aria-pressed={tool === 'zoom'} onClick={() => setTool('zoom')} title={t('results.grapher.dragToZoomARegion')}>
              {t('results.grapher.zoom')}
            </button>
            <button type="button" className={tool === 'pan' ? 'msr-on' : ''} aria-pressed={tool === 'pan'} onClick={() => setTool('pan')} title={t('results.grapher.dragToPan')}>
              {t('results.grapher.pan')}
            </button>
          </div>
          <button type="button" className="msr-btn" onClick={() => (patch({ view: null }), pageProps && onPagePropsChange?.({ x: { ...pageProps.x, min: undefined, max: undefined }, y: { ...pageProps.y, min: undefined, max: undefined } }))} title={t('results.grapher.autoscaleDoubleClickThePlot')}>
            {t('common.reset')}
          </button>
          <button type="button" className={`msr-btn${grid ? ' msr-on' : ''}`} aria-pressed={grid} title={t('tip.grapher.grid')} onClick={() => setGrid(!grid)}>
            {t('results.grapher.grid')}
          </button>
          <button type="button" className={`msr-btn${st.cursors ? ' msr-on' : ''}`} aria-pressed={!!st.cursors} title={t('tip.grapher.cursors')} onClick={toggleCursors}>
            {t('results.grapher.cursors')}
          </button>
          <button type="button" className="msr-btn" onClick={() => setBackground(background === 'dark' ? 'light' : 'dark')} title={t('results.grapher.togglePlotBackground')}>
            {background === 'dark' ? t('results.grapher.lightBg') : t('results.grapher.darkBg')}
          </button>
          {hasComplex && (
            <div className="msr-seg" role="group" aria-label={t('results.grapher.magnitudeScale')}>
              <button type="button" className={st.magnitude === 'db' ? 'msr-on' : ''} aria-pressed={st.magnitude === 'db'} onClick={() => patch({ magnitude: 'db', view: null })}>
                dB
              </button>
              <button type="button" className={st.magnitude === 'linear' ? 'msr-on' : ''} aria-pressed={st.magnitude === 'linear'} onClick={() => patch({ magnitude: 'linear', view: null })}>
                {t('common.linear')}
              </button>
            </div>
          )}
          {plot.panes.some((p, i) => p.kind === 'analog' && p.unit !== 'dB' && p.unit !== 'deg' && i >= 0) && (
            <label className="msr-inline" title={t('results.grapher.logarithmicYAxisForThe')}>
              <input
                type="checkbox"
                checked={yLogPanes.size > 0}
                onChange={(e) => {
                  const target = plot.panes.findIndex((p) => p.kind === 'analog' && p.unit !== 'dB' && p.unit !== 'deg');
                  if (pageProps && onPagePropsChange) onPagePropsChange({ y: { ...pageProps.y, log: e.target.checked } });
                  patch({ yLog: e.target.checked && target >= 0 ? [target] : [], view: null });
                }}
              />{' '}
              Log Y
            </label>
          )}
          <span className="msr-spacer" />
          {toolbarExtra}
          <button type="button" className={`msr-btn${showPost ? ' msr-on' : ''}`} aria-pressed={showPost} title={t('tip.grapher.postprocessor')} onClick={() => setShowPost(!showPost)}>
            {t('common.postprocessor')}
          </button>
          <button type="button" className="msr-btn" title={t('tip.grapher.csv')} onClick={exportCsv}>
            CSV
          </button>
          <button type="button" className="msr-btn" title={t('tip.grapher.text')} onClick={exportText}>
            {t('grapher.textButton')}
          </button>
          <button type="button" className="msr-btn" title={t('tip.grapher.png')} onClick={exportPng}>
            PNG
          </button>
          <button type="button" className="msr-btn" title={t('tip.grapher.print')} onClick={print}>
            {t('grapher.print')}
          </button>
        </div>
      )}

      {tab.result.error && <SimErrorBox message={tab.result.error} />}
      {runErrors.length > 0 && (
        <div className="msr-error" role="alert">
          <strong>{t('results.grapher.lengthRunSFailed', { length: runErrors.length })}</strong>
          <ul>
            {runErrors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="msr-body">
        {plot && (
          <div className="msr-plot-area">
            <PlotView
              data={plot}
              hidden={hiddenKeys}
              view={view}
              onViewChange={(v) => patch({ view: v })}
              cursors={st.cursors}
              onCursorsChange={(cursors) => patch({ cursors })}
              grid={grid}
              background={background}
              tool={tool}
              yLogPanes={yLogPanes}
              highlight={highlight}
              height={plotHeight}
              onCanvas={onCanvas}
              ariaLabel={t('results.grapher.graphOf', { title: tab.title })}
            />
            <ul className="msr-legend" aria-label={t('results.grapher.traces')}>
              {legend.map((l) => {
                const hidden = hiddenList.includes(l.key);
                return (
                  <li key={l.key} onMouseEnter={() => setHighlight(l.key)} onMouseLeave={() => setHighlight(null)}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => (onTraceStyleChange ? onTraceStyleChange(l.key, { hidden: !hidden }) : patch({ hidden: hidden ? st.hidden.filter((k) => k !== l.key) : [...st.hidden, l.key] }))}
                      />
                      <span className={`msr-swatch msr-c${(l.color % 8) + 1}`} aria-hidden />
                      <span className="msr-legend-label" title={l.label}>
                        {l.label}
                      </span>
                    </label>
                  </li>
                );
              })}
              {legend.length > 1 && (
                <li className="msr-legend-actions">
                  <button type="button" className="msr-btn msr-btn-small" onClick={() => (onTraceStyleChange ? legend.forEach((l) => onTraceStyleChange(l.key, { hidden: false })) : patch({ hidden: [] }))}>
                    {t('results.grapher.all')}
                  </button>
                  <button type="button" className="msr-btn msr-btn-small" onClick={() => (onTraceStyleChange ? legend.forEach((l) => onTraceStyleChange(l.key, { hidden: true })) : patch({ hidden: legend.map((l) => l.key) }))}>
                    {t('common.none')}
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}

        {readout && (
          <div className="msr-cursor-table" ref={cursorTableRef}>
            <div className="msr-cursor-x">
              <span>
                <b className="msr-cur1">x1</b> {fmt(readout.x1, xUnit)}
              </span>
              <span>
                <b className="msr-cur2">x2</b> {fmt(readout.x2, xUnit)}
              </span>
              <span>
                <b>{t('results.grapher.dx')}</b> {fmt(readout.dx, xUnit)}
              </span>
              <span>
                <b>{t('results.grapher.n1Dx')}</b> {fmt(readout.invDx, invUnit(xUnit))}
              </span>
            </div>
            <table className="msr-table">
              <thead>
                <tr>
                  <th scope="col">{t('results.grapher.trace')}</th>
                  <th scope="col">y1</th>
                  <th scope="col">y2</th>
                  <th scope="col">{t('results.grapher.dy')}</th>
                  <th scope="col">{t('results.grapher.minX1X2')}</th>
                  <th scope="col">{t('results.grapher.maxX1X2')}</th>
                </tr>
              </thead>
              <tbody>
                {readout.rows.map((r, i) => {
                  const t = visibleTraces[i];
                  return (
                    <tr key={r.key}>
                      <th scope="row">
                        <span className={`msr-swatch msr-c${(t.color % 8) + 1}`} aria-hidden /> {traceLabel(t)}
                      </th>
                      <td className="msr-num">{t.digital ? (r.y1 >= 0.5 ? '1' : '0') : fmt(r.y1, r.unit)}</td>
                      <td className="msr-num">{t.digital ? (r.y2 >= 0.5 ? '1' : '0') : fmt(r.y2, r.unit)}</td>
                      <td className="msr-num">{t.digital ? '' : fmt(r.dy, r.unit)}</td>
                      <td className="msr-num">{t.digital ? '' : fmt(r.min, r.unit)}</td>
                      <td className="msr-num">{t.digital ? '' : fmt(r.max, r.unit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showPost && evaluated && (
          <PostprocessorPanel
            names={availableVectorNames(tab.family && tab.result.runs?.length ? tab.result.runs[0].result : tab.result)}
            expressions={evaluated.exprs}
            onAdd={(text) => patch({ exprs: [...st.exprs, text] })}
            onRemove={(i) => patch({ exprs: st.exprs.filter((_, k) => k !== i) })}
          />
        )}
        {!plot && !showPost && (tab.result.vectors.length > 0 || tab.result.scalars) && (
          <div className="msr-toolbar">
            <span className="msr-spacer" />
            <button type="button" className="msr-btn" onClick={() => setShowPost(true)}>
              {t('common.postprocessor')}
            </button>
          </div>
        )}

        {internalCount > 0 && (
          <label className="msr-inline msr-internal" title={t('results.grapher.internalHint')}>
            <input type="checkbox" checked={showInternal} onChange={(e) => setShowInternal(e.target.checked)} /> {t('results.grapher.showInternal', { n: internalCount })}
          </label>
        )}
        {tab.result.type === 'four' && <HarmonicChart result={tab.result} />}
        {pz.length > 0 && <PoleZeroChart points={pz} />}
        {tables.map((t, i) => (
          <ResultTableView key={`${t.title}-${i}`} table={t} fileBase={tab.title} />
        ))}
        {sets.length > 0 && <StatisticsView sets={sets} />}

        {!plot && !tables.length && !tab.result.error && <div className="msr-empty">{t('results.grapher.thisAnalysisProducedNoPlottable')}</div>}

        {warnings.length > 0 && (
          <details className="msr-warnings">
            <summary>{t('results.grapher.warningsCount', { n: warnings.length })}</summary>
            <ul>
              {warnings.slice(0, 200).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        {tab.result.elapsedMs !== undefined && <div className="msr-status">{t('results.grapher.completedInValue', { value: formatEng(tab.result.elapsedMs / 1000, 's', 3) })}</div>}
      </div>
    </div>
  );
}
