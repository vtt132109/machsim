/**
 * A line plot as SVG text (pure): what `MachSim.plot()` produces. The Scripts window shows it and
 * a script can save it (`MachSim.saveText('gain.svg', svg)`). White background, axes with 1-2-5
 * ticks (linear or logarithmic), one coloured line per series and a legend; non-finite values break
 * the line instead of drawing a stray segment.
 *
 *   plotToSvg({ title, xLabel, yLabel, x, series: [{ name, y }], logX, logY }) -> '<svg ...>'
 */
import { axisFormatter, axisFraction, formatLogTick, linearTicks, logTicks, niceRange } from '../ui/results/ticks';
import type { ScriptPlot } from './protocol';

const COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#17becf'];
const W = 640;
const H = 400;
const M = { left: 72, right: 20, top: 40, bottom: 56 };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number): string => (Math.round(v * 100) / 100).toString();

export function plotToSvg(plot: ScriptPlot): string {
  const lines = plot.series.map((s) => {
    const xs = s.x ?? plot.x;
    return { name: s.name, x: xs, y: s.y };
  });
  // data ranges (positive values only on a logarithmic axis)
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const l of lines) {
    const n = Math.min(l.x.length, l.y.length);
    for (let i = 0; i < n; i++) {
      const x = l.x[i];
      const y = l.y[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if ((plot.logX && x <= 0) || (plot.logY && y <= 0)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0)) {
    x0 = plot.logX ? 1 : 0;
    x1 = plot.logX ? 10 : 1;
    y0 = plot.logY ? 1 : 0;
    y1 = plot.logY ? 10 : 1;
  }
  if (x0 === x1) {
    x0 -= plot.logX ? x0 / 2 : 0.5;
    x1 += plot.logX ? x1 : 0.5;
  }
  if (y0 === y1) {
    y0 -= plot.logY ? y0 / 2 : 0.5;
    y1 += plot.logY ? y1 : 0.5;
  }
  const [xa, xb] = niceRange(x0, x1, plot.logX);
  const [ya, yb] = niceRange(y0, y1, plot.logY);
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const px = (v: number) => M.left + axisFraction(v, xa, xb, plot.logX) * pw;
  const py = (v: number) => M.top + (1 - axisFraction(v, ya, yb, plot.logY)) * ph;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif" font-size="12">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  if (plot.title) out.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#222">${esc(plot.title)}</text>`);

  const xt = plot.logX ? logTicks(xa, xb) : linearTicks(xa, xb);
  const yt = plot.logY ? logTicks(ya, yb) : linearTicks(ya, yb);
  const xf = plot.logX ? (v: number) => formatLogTick(v) : axisFormatter(xt.major, xt.step);
  const yf = plot.logY ? (v: number) => formatLogTick(v) : axisFormatter(yt.major, yt.step);
  for (const v of xt.minor) out.push(`<line x1="${num(px(v))}" y1="${M.top}" x2="${num(px(v))}" y2="${M.top + ph}" stroke="#eee"/>`);
  for (const v of yt.minor) out.push(`<line x1="${M.left}" y1="${num(py(v))}" x2="${M.left + pw}" y2="${num(py(v))}" stroke="#eee"/>`);
  for (const v of xt.major) {
    out.push(`<line x1="${num(px(v))}" y1="${M.top}" x2="${num(px(v))}" y2="${M.top + ph}" stroke="#d8d8d8"/>`);
    out.push(`<text x="${num(px(v))}" y="${M.top + ph + 18}" text-anchor="middle" fill="#444">${esc(xf(v))}</text>`);
  }
  for (const v of yt.major) {
    out.push(`<line x1="${M.left}" y1="${num(py(v))}" x2="${M.left + pw}" y2="${num(py(v))}" stroke="#d8d8d8"/>`);
    out.push(`<text x="${M.left - 8}" y="${num(py(v) + 4)}" text-anchor="end" fill="#444">${esc(yf(v))}</text>`);
  }
  out.push(`<rect x="${M.left}" y="${M.top}" width="${pw}" height="${ph}" fill="none" stroke="#888"/>`);
  if (plot.xLabel) out.push(`<text x="${M.left + pw / 2}" y="${H - 12}" text-anchor="middle" fill="#222">${esc(plot.xLabel)}</text>`);
  if (plot.yLabel) out.push(`<text transform="translate(16 ${M.top + ph / 2}) rotate(-90)" text-anchor="middle" fill="#222">${esc(plot.yLabel)}</text>`);

  out.push(`<clipPath id="plotArea"><rect x="${M.left}" y="${M.top}" width="${pw}" height="${ph}"/></clipPath>`);
  lines.forEach((l, k) => {
    const color = COLORS[k % COLORS.length];
    let d = '';
    let pen = false;
    const n = Math.min(l.x.length, l.y.length);
    for (let i = 0; i < n; i++) {
      const x = l.x[i];
      const y = l.y[i];
      const bad = !Number.isFinite(x) || !Number.isFinite(y) || (plot.logX && x <= 0) || (plot.logY && y <= 0);
      if (bad) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${num(px(x))} ${num(py(y))}`;
      pen = true;
    }
    if (d) out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" clip-path="url(#plotArea)"/>`);
    if (n === 1 || (n > 0 && n <= 30)) {
      for (let i = 0; i < n; i++) {
        if (Number.isFinite(l.x[i]) && Number.isFinite(l.y[i])) out.push(`<circle cx="${num(px(l.x[i]))}" cy="${num(py(l.y[i]))}" r="2.6" fill="${color}"/>`);
      }
    }
  });
  // legend
  if (lines.length > 1 || (lines[0] && lines[0].name)) {
    lines.forEach((l, k) => {
      const y = M.top + 14 + k * 16;
      out.push(`<line x1="${M.left + pw - 150}" y1="${y - 4}" x2="${M.left + pw - 128}" y2="${y - 4}" stroke="${COLORS[k % COLORS.length]}" stroke-width="2"/>`);
      out.push(`<text x="${M.left + pw - 122}" y="${y}" fill="#222">${esc(l.name)}</text>`);
    });
  }
  out.push('</svg>');
  return out.join('');
}
