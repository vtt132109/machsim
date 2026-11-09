/**
 * Virtual instruments public API.
 *
 * Integration in three steps:
 *  1. `createInstrumentStream(binding)` once per instrument instance per run, then
 *     `pushTransientChunk(stream, binding, chunk)` for every TransientStepper chunk.
 *  2. `instrumentNeed(binding, params)` tells whether an AC / DC / per-row OP analysis must be run
 *     for the panel (Bode plotter, network analyzer, IV analyzer, logic converter).
 *  3. Mount `instrumentPanels[binding.kind]` with InstrumentPanelProps; title it with
 *     `panelTitle(kind, refdes)`. Param changes arrive as complete records in onParamsChange.
 */

export { InstrumentStream, INSTRUMENT_CHANNELS, createInstrumentStream, streamChannelsFor } from './types';
export type { InstrumentPanelProps, StreamReadOptions, StreamWindow } from './types';
export { bindingChannel, chunkSignal, pushTransientChunk, resultSignal, signalLabel, signalVectorNames } from './signals';
export type { ComplexSeries } from './signals';
export { instrumentPanels, panelTitle, PANEL_TITLES, PANEL_WIDTHS } from './registry';
export { instrumentNeed } from './needs';
export type { InstrumentNeed } from './needs';

export { BenchGeneratorPanel, BenchMultimeterPanel } from './BenchPanels';
export { BenchScopePanel } from './BenchScopePanel';
export { BodePlotterPanel } from './BodePlotterPanel';
export { FunctionGeneratorPanel } from './FunctionGeneratorPanel';
export { IvAnalyzerPanel } from './IvAnalyzerPanel';
export { LogicAnalyzerPanel } from './LogicAnalyzerPanel';
export { LogicConverterPanel } from './LogicConverterPanel';
export { CurrentClampPanel, DistortionAnalyzerPanel, FrequencyCounterPanel, MultimeterPanel, WattmeterPanel } from './MeterPanels';
export { NetworkAnalyzerPanel } from './NetworkAnalyzerPanel';
export { OscilloscopePanel } from './OscilloscopePanel';
export { SpectrumAnalyzerPanel } from './SpectrumAnalyzerPanel';
export { WordGeneratorPanel } from './WordGeneratorPanel';

// pure instrument models (also usable by the integration layer and tests)
export { BODE_DEFAULTS, bodeAnalysisSpec, bodeFromComplex, bodeTransfer, crossingFrequency, interpolateCurve } from './bode';
export type { BodeData } from './bode';
export { FGEN_DEFAULTS, fgenSample, fgenSettings, fgenSpiceWaveform, validateFgen } from './fgen';
export type { FgenSettings, FgenWaveform } from './fgen';
export { IV_PRESETS, ivAnalysisSpec, ivCurves, ivDevice, ivSweep } from './iv';
export type { IvCurve, IvDevice, IvPreset, IvSweep } from './iv';
export * from './logic';
export { LOGIC_CONVERTER_DEFAULTS, converterInputSources, converterRowAssignments, parseLogicConverterSettings, resizeTable, tableFromRuns, wiredInputCount } from './logicConverter';
export type { LogicConverterSettings, RowAssignment } from './logicConverter';
export * from './logicAnalyzer';
export * from './measure';
export * from './meter';
export * from './network';
export * from './scope';
export * from './wordgen';
export * from './benchDmm';
export * from './benchScope';
export * from './matching';
