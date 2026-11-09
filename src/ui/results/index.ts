/**
 * Results module public API (grapher, postprocessor, DSP, plot helpers).
 */

export { Grapher } from './Grapher';
export type { GrapherProps } from './Grapher';
export { PlotView, readPlotColors } from './PlotView';
export type { PlotViewProps } from './PlotView';
export type { PlotViewState, PlotFrame, PaneFrame, PlotColors } from './plotRender';
export { computeFrame, drawPlot, xToPx, pxToX, yToPx, pxToY } from './plotRender';
export { PostprocessorPanel } from './PostprocessorPanel';
export { ResultTableView, StatisticsView, HistogramChart, PoleZeroChart, HarmonicChart, formatNumber } from './ResultTables';
export * from './plotModel';
export * from './postprocessor';
export * from './dsp';
export * from './ticks';
export * from './stats';
export { setupHiDpiCanvas, cssVar, tracePalette, downloadText, downloadBlob, downloadCanvasPng, safeFileName } from './canvas';
export { useElementSize, useLatest, useWheel } from './hooks';
