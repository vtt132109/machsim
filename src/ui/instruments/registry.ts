/**
 * Instrument panel registry: InstrumentKind -> panel component (titles and widths live in the
 * light titles.ts module so shell code can use them without loading every panel).
 * Every kind of InstrumentKind has a panel; the record is typed Partial so integration code
 * can fall back gracefully for kinds added to the contract later.
 */

import type { ComponentType } from 'react';
import type { InstrumentKind } from '../../model/types';
import { BenchGeneratorPanel, BenchMultimeterPanel } from './BenchPanels';
import { BenchScopePanel } from './BenchScopePanel';
import { BodePlotterPanel } from './BodePlotterPanel';
import { FunctionGeneratorPanel } from './FunctionGeneratorPanel';
import { IvAnalyzerPanel } from './IvAnalyzerPanel';
import { LogicAnalyzerPanel } from './LogicAnalyzerPanel';
import { LogicConverterPanel } from './LogicConverterPanel';
import { CurrentClampPanel, DistortionAnalyzerPanel, FrequencyCounterPanel, MultimeterPanel, WattmeterPanel } from './MeterPanels';
import { NetworkAnalyzerPanel } from './NetworkAnalyzerPanel';
import { OscilloscopePanel } from './OscilloscopePanel';
import { SpectrumAnalyzerPanel } from './SpectrumAnalyzerPanel';
import type { InstrumentPanelProps } from './types';
import { WordGeneratorPanel } from './WordGeneratorPanel';

export const instrumentPanels: Partial<Record<InstrumentKind, ComponentType<InstrumentPanelProps>>> = {
  multimeter: MultimeterPanel,
  'function-generator': FunctionGeneratorPanel,
  oscilloscope: OscilloscopePanel,
  'oscilloscope-4ch': OscilloscopePanel,
  'bode-plotter': BodePlotterPanel,
  wattmeter: WattmeterPanel,
  'frequency-counter': FrequencyCounterPanel,
  'iv-analyzer': IvAnalyzerPanel,
  'spectrum-analyzer': SpectrumAnalyzerPanel,
  'network-analyzer': NetworkAnalyzerPanel,
  'distortion-analyzer': DistortionAnalyzerPanel,
  'logic-analyzer': LogicAnalyzerPanel,
  'word-generator': WordGeneratorPanel,
  'logic-converter': LogicConverterPanel,
  'current-clamp': CurrentClampPanel,
  'bench-generator': BenchGeneratorPanel,
  'bench-multimeter': BenchMultimeterPanel,
  'bench-scope': BenchScopePanel,
  'mixed-signal-scope': BenchScopePanel,
};

export { INSTRUMENT_KINDS, PANEL_TITLES, PANEL_WIDTHS, panelTitle } from './titles';
