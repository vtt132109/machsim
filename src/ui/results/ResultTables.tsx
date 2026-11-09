/**
 * Tabular and chart views for non-swept results: OP / TF / sensitivity / pole-zero / Fourier /
 * worst-case tables, Monte Carlo statistics with a histogram, an s-plane pole-zero map and a
 * harmonic bar chart. SVG based (no canvas) so they print and scale cleanly.
 */

import { useMemo, useState } from 'react';
import type { AnalysisResult } from '../../sim/results';
import { formatEng } from '../../util/units';
import { downloadText, safeFileName } from './canvas';
import type { PoleZero, ResultTable } from './plotModel';
import { formatValue, tableToCsv } from './plotModel';
import { describeSamples, histogram } from './stats';
import { linearTicks } from './ticks';
import { t } from '../../i18n';

/** Compact numeric text: 6 significant digits, exponent outside [1e-4, 1e7). */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-4 && a < 1e7) return String(Number(v.toPrecision(6)));
  return v.toExponential(4);
}

function isNameValueTable(t: ResultTable): boolean {
  return t.columns.length === 2 && /^(name|variable)$/i.test(t.columns[0]) && /^value$/i.test(t.columns[1]);
}

export function ResultTableView({ table, fileBase }: { table: ResultTable; fileBase: string }) {
  const nameValue = isNameValueTable(table);
  return (
    <section className="msr-table-block">
      <header className="msr-table-head">
        <h4>{table.title}</h4>
        <button type="button" className="msr-btn msr-btn-small" onClick={() => downloadText(`${safeFileName(`${fileBase}_${table.title}`)}.csv`, tableToCsv(table))}>
          CSV
        </button>
      </header>
      <div className="msr-table-scroll">
        <table className="msr-table">
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={typeof cell === 'number' ? 'msr-num' : undefined}>
                    {typeof cell === 'number' ? (nameValue && c === 1 ? formatValue(String(row[0]), cell) : formatNumber(cell)) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function HistogramChart({ values, bins, label }: { values: number[]; bins?: number; label: string }) {
  const h = useMemo(() => histogram(values, bins), [values, bins]);
  const W = 420;
  const H = 200;
  const m = { l: 40, r: 10, t: 10, b: 34 };
  if (!h.counts.length) return null;
  const maxC = Math.max(...h.counts, 1);
  const x0 = h.edges[0];
  const x1 = h.edges[h.edges.length - 1];
  const sx = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (c: number) => H - m.b - (c / maxC) * (H - m.t - m.b);
  const yt = linearTicks(0, maxC, 4).major.filter((v) => Number.isInteger(v));
  const xt = linearTicks(x0, x1, 4);
  return (
    <svg className="msr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('results.resultTables.histogramOfLabel', { label: label })}>
      {yt.map((v) => (
        <g key={`y${v}`}>
          <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className="msr-chart-grid" />
          <text x={m.l - 4} y={sy(v)} textAnchor="end" dominantBaseline="middle" className="msr-chart-text">
            {v}
          </text>
        </g>
      ))}
      {h.counts.map((c, i) => (
        <rect key={i} x={sx(h.edges[i]) + 0.5} y={sy(c)} width={Math.max(1, sx(h.edges[i + 1]) - sx(h.edges[i]) - 1)} height={H - m.b - sy(c)} className="msr-chart-bar">
          <title>{`${formatNumber(h.edges[i])} … ${formatNumber(h.edges[i + 1])}: ${c}`}</title>
        </rect>
      ))}
      <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="msr-chart-axis" />
      {xt.major.map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - m.b + 14} textAnchor="middle" className="msr-chart-text">
          {formatEng(v, '', 3)}
        </text>
      ))}
      <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" className="msr-chart-text">
        {label}
      </text>
    </svg>
  );
}

export function StatisticsView({ sets }: { sets: { name: string; values: number[] }[] }) {
  const [sel, setSel] = useState(0);
  const [bins, setBins] = useState<number | undefined>(undefined);
  const set = sets[Math.min(sel, sets.length - 1)];
  const st = useMemo(() => (set ? describeSamples(set.values) : null), [set]);
  if (!set || !st) return null;
  const rows: [string, number][] = [
    [t('results.resultTables.samples'), st.n],
    [t('results.resultTables.mean'), st.mean],
    [t('results.resultTables.stdDeviation'), st.std],
    [t('results.resultTables.minimum'), st.min],
    [t('results.resultTables.maximum'), st.max],
    [t('results.resultTables.median'), st.median],
    [t('results.resultTables.n1stQuartile'), st.q1],
    [t('results.resultTables.n3rdQuartile'), st.q3],
  ];
  return (
    <section className="msr-table-block">
      <header className="msr-table-head">
        <h4>{t('results.resultTables.statistics')}</h4>
        <label className="msr-inline">
          {t('results.resultTables.measurement')}{' '}
          <select value={sel} onChange={(e) => setSel(Number(e.target.value))}>
            {sets.map((s, i) => (
              <option key={s.name} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="msr-inline">
          {t('results.resultTables.bins')}{' '}
          <input
            type="number"
            min={1}
            max={200}
            value={bins ?? ''}
            placeholder={t('common.auto')}
            onChange={(e) => setBins(e.target.value ? Math.max(1, Math.min(200, Number(e.target.value))) : undefined)}
            className="msr-input-narrow"
          />
        </label>
      </header>
      <div className="msr-stats">
        <table className="msr-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td className="msr-num">{k === 'Samples' ? v : formatNumber(v)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">{t('results.resultTables.mean')}</th>
              <td className="msr-num">{st.mean !== 0 ? `${formatNumber((100 * st.std) / Math.abs(st.mean))} %` : '—'}</td>
            </tr>
          </tbody>
        </table>
        <HistogramChart values={set.values} bins={bins} label={set.name} />
      </div>
    </section>
  );
}

/** s-plane map of poles (x) and zeros (o). */
export function PoleZeroChart({ points }: { points: PoleZero[] }) {
  const W = 360;
  const H = 260;
  const m = 36;
  if (!points.length) return null;
  const maxRe = Math.max(...points.map((p) => Math.abs(p.re)), 1e-30);
  const maxIm = Math.max(...points.map((p) => Math.abs(p.im)), 1e-30);
  const span = Math.max(maxRe, maxIm) * 1.2;
  const sx = (v: number) => W / 2 + (v / span) * (W / 2 - m);
  const sy = (v: number) => H / 2 - (v / span) * (H / 2 - m / 2);
  return (
    <section className="msr-table-block">
      <header className="msr-table-head">
        <h4>{t('results.resultTables.poleZeroMapSPlane')}</h4>
      </header>
      <svg className="msr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('results.resultTables.poleZeroMap')}>
        <line x1={m / 2} x2={W - m / 2} y1={H / 2} y2={H / 2} className="msr-chart-axis" />
        <line x1={W / 2} x2={W / 2} y1={8} y2={H - 8} className="msr-chart-axis" />
        <text x={W - m / 2} y={H / 2 - 4} textAnchor="end" className="msr-chart-text">
          {t('results.resultTables.npS')}
        </text>
        <text x={W / 2 + 4} y={14} className="msr-chart-text">
          {t('results.resultTables.jRadS')}
        </text>
        <text x={sx(span / 1.2)} y={H / 2 + 14} textAnchor="middle" className="msr-chart-text">
          {formatEng(span / 1.2, '', 3)}
        </text>
        <text x={sx(-span / 1.2)} y={H / 2 + 14} textAnchor="middle" className="msr-chart-text">
          {formatEng(-span / 1.2, '', 3)}
        </text>
        {points.map((p, i) =>
          p.kind === 'pole' ? (
            <g key={i} className="msr-pz-pole">
              <line x1={sx(p.re) - 5} x2={sx(p.re) + 5} y1={sy(p.im) - 5} y2={sy(p.im) + 5} />
              <line x1={sx(p.re) - 5} x2={sx(p.re) + 5} y1={sy(p.im) + 5} y2={sy(p.im) - 5} />
              <title>{t('results.resultTables.poleValueValue2JValue3', { value: formatNumber(p.re), value2: p.im >= 0 ? '+' : '-', value3: formatNumber(Math.abs(p.im)) })}</title>
            </g>
          ) : (
            <circle key={i} cx={sx(p.re)} cy={sy(p.im)} r={5} className="msr-pz-zero">
              <title>{t('results.resultTables.zeroValueValue2JValue3', { value: formatNumber(p.re), value2: p.im >= 0 ? '+' : '-', value3: formatNumber(Math.abs(p.im)) })}</title>
            </circle>
          ),
        )}
      </svg>
    </section>
  );
}

/**
 * Bar chart of harmonic magnitudes for a Fourier result table. Uses the first column whose
 * header contains "harm" (or "freq") as category and the first containing "mag" as value.
 */
export function HarmonicChart({ result }: { result: AnalysisResult }) {
  const tbl = result.table;
  if (!tbl) return null;
  const cols = tbl.columns.map((c) => c.toLowerCase());
  const catIdx = cols.findIndex((c) => c.includes('harm'));
  const fIdx = cols.findIndex((c) => c.includes('freq'));
  const magIdx = cols.findIndex((c) => c.includes('mag') && !c.includes('norm') && !c.includes('db'));
  if (magIdx < 0 || (catIdx < 0 && fIdx < 0)) return null;
  const bars = tbl.rows
    .map((r) => ({ cat: String(r[catIdx >= 0 ? catIdx : fIdx]), v: Number(r[magIdx]) }))
    .filter((b) => Number.isFinite(b.v));
  if (!bars.length) return null;
  const W = 420;
  const H = 200;
  const m = { l: 46, r: 10, t: 10, b: 30 };
  const maxV = Math.max(...bars.map((b) => Math.abs(b.v)), 1e-30);
  const ticks = linearTicks(0, maxV, 4);
  const bw = (W - m.l - m.r) / bars.length;
  const sy = (v: number) => H - m.b - (v / (ticks.major[ticks.major.length - 1] || maxV)) * (H - m.t - m.b);
  return (
    <section className="msr-table-block">
      <header className="msr-table-head">
        <h4>{t('results.resultTables.harmonicMagnitudes')}</h4>
      </header>
      <svg className="msr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('results.resultTables.harmonicMagnitudeChart')}>
        {ticks.major.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className="msr-chart-grid" />
            <text x={m.l - 4} y={sy(v)} textAnchor="end" dominantBaseline="middle" className="msr-chart-text">
              {formatEng(v, '', 3)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => (
          <g key={i}>
            <rect x={m.l + i * bw + bw * 0.15} y={sy(Math.abs(b.v))} width={bw * 0.7} height={H - m.b - sy(Math.abs(b.v))} className="msr-chart-bar">
              <title>{`${b.cat}: ${formatNumber(b.v)}`}</title>
            </rect>
            {bars.length <= 24 && (
              <text x={m.l + (i + 0.5) * bw} y={H - m.b + 13} textAnchor="middle" className="msr-chart-text">
                {b.cat}
              </text>
            )}
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} className="msr-chart-axis" />
      </svg>
    </section>
  );
}
