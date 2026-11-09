/**
 * Grapher pages as pictures for the print preview (browser only: they are drawn on a canvas).
 *
 * Every page of the run the Grapher shows is drawn off screen with the page's own properties
 * (axis ranges, grid, trace styles, hidden traces) on a white background, so a printout does not
 * depend on the dark plot theme, and handed to the preview as a picture of known size.
 */
import { pageResult, runLabel, pageTitle, type GrapherDoc } from './history';
import { axisView, decoratePlot } from './Grapher';
import { buildPlotData, buildTabs } from './plotModel';
import { computeFrame, drawPlot, type PlotColors } from './plotRender';
import type { ImageContent } from '../print/printModel';

/** Size of the drawing in CSS pixels; the picture is printed 250 mm wide. */
const PLOT_PX = { w: 1400, h: 780 };
const TITLE_PX = 34;
const PRINT_WIDTH_MM = 250;

const COLOUR: PlotColors = {
  bg: '#ffffff',
  grid: '#c9ced8',
  gridMinor: '#eceff3',
  text: '#222831',
  frame: '#6b7280',
  cursor1: '#c92a2a',
  cursor2: '#087f5b',
  traces: ['#1c7ed6', '#e03131', '#2f9e44', '#f08c00', '#7048e8', '#0c8599', '#c2255c', '#5c940d'],
};

const MONO: PlotColors = { ...COLOUR, traces: ['#000000', '#444444', '#777777', '#222222', '#555555', '#111111', '#666666', '#333333'] };

/** The pages of the run `doc.active` belongs to (all pages when nothing is active), drawn for printing. */
export function renderGraphPages(doc: GrapherDoc, opts: { monochrome: boolean }): ImageContent[] {
  const active = doc.pages.find((p) => p.id === doc.active) ?? doc.pages[doc.pages.length - 1];
  const pages = active ? doc.pages.filter((p) => p.runId === active.runId) : doc.pages;
  const out: ImageContent[] = [];
  for (const page of pages) {
    const result = pageResult(doc, page);
    const tab = result ? buildTabs([result])[0] : undefined;
    if (!tab || tab.result.error) continue;
    const plot = decoratePlot(buildPlotData(tab.result, { magnitude: 'db', showInternal: false }), page.props, page.traces);
    if (!plot) continue;
    const hidden = new Set(plot.traces.filter((t) => page.traces[t.key.replace(/:(mag|ph)$/, '')]?.hidden).map((t) => t.key));
    const frame = computeFrame(plot, hidden, axisView(plot, page.props), PLOT_PX.w, PLOT_PX.h - TITLE_PX);
    const canvas = document.createElement('canvas');
    const ratio = 2;
    canvas.width = PLOT_PX.w * ratio;
    canvas.height = PLOT_PX.h * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PLOT_PX.w, PLOT_PX.h);
    const title = `${pageTitle(doc, page)} — ${runLabel(doc, page.runId)}`;
    ctx.fillStyle = '#222831';
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 12, TITLE_PX / 2);
    ctx.translate(0, TITLE_PX);
    drawPlot(ctx, frame, plot, hidden, opts.monochrome ? MONO : COLOUR, { grid: page.props.grid ?? true, cursors: null });
    out.push({
      kind: 'image',
      id: `graph:${page.id}`,
      label: title,
      caption: title,
      url: canvas.toDataURL('image/png'),
      widthMm: PRINT_WIDTH_MM,
      heightMm: Math.round((PRINT_WIDTH_MM * PLOT_PX.h) / PLOT_PX.w * 10) / 10,
    });
  }
  return out;
}
