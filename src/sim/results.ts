/**
 * Simulation result types.
 *
 * CONTRACT FILE — produced by src/sim, consumed by the UI (grapher, instruments, tables).
 *
 * Vector naming (case as given in the netlist):
 *   V(node)            node voltage (vs ground)
 *   I(Vname)           branch current of a voltage source / inductor / E / H (SPICE sign)
 *   I(R1), P(R1)       derived device outputs (see Device.outputs), Ic(Q1), Id(M1), ...
 *   inoise_spectrum, onoise_spectrum (noise), etc.
 * Scale vectors: "time" (s), "frequency" (Hz), or the swept source/parameter name.
 */

import type { AnalysisSpec, AnalysisType } from './netlist';

export type VectorUnit =
  | 'V'
  | 'A'
  | 'W'
  | 's'
  | 'Hz'
  | 'Ohm'
  | 'S'
  | 'degC'
  | 'dB'
  | 'deg'
  | 'V^2/Hz'
  | 'A^2/Hz'
  | 'V/rtHz'
  | 'A/rtHz'
  /** magnetic nodes of the hysteresis cores: <ref>.b (tesla), <ref>.h / <ref>.m (A/m), <ref>.flux (weber-turns) */
  | 'T'
  | 'A/m'
  | 'Wb'
  | '';

export interface Vector {
  name: string;
  unit: VectorUnit;
  /** real part (or the value for real vectors) */
  re: Float64Array;
  /** imaginary part for complex (AC) vectors */
  im?: Float64Array;
  /** digital vectors: 0/1/X(=0.5)/Z(=NaN) samples aligned with the scale */
  digital?: boolean;
  /**
   * X-Y plots (postprocessor `vs(y, x)`): the vector is drawn against these values instead of the
   * result's scale (same length as `re`), with the axis name / unit of the x quantity.
   */
  xValues?: Float64Array;
  xName?: string;
  xUnit?: VectorUnit;
}

export interface AnalysisResult {
  type: AnalysisType;
  /** human readable title, e.g. "Transient analysis" */
  title: string;
  /** the analysis that produced this result */
  spec?: AnalysisSpec;
  /** independent variable: time, frequency, or swept value. Absent for OP / TF / SENS / PZ. */
  scale?: Vector;
  vectors: Vector[];
  /** families of curves (param/temp sweep, monte carlo, nested sweep, batch) */
  runs?: { label: string; result: AnalysisResult }[];
  /** scalar results (OP values, TF gain/impedances, fourier THD, ...) */
  scalars?: Record<string, number>;
  /** tabular results (sensitivity, pole-zero, fourier harmonics, worst-case report) */
  table?: { columns: string[]; rows: (string | number)[][] };
  /** values of the netlist's `.meas` directives for this result (src/sim/analyses/meas.ts) */
  measurements?: MeasurementResult[];
  warnings: string[];
  error?: string;
  elapsedMs?: number;
}

/** Value of one `.meas` directive on one result. */
export interface MeasurementResult {
  name: string;
  /** analysis the directive applies to */
  analysis: 'tran' | 'ac' | 'dc' | 'op' | 'noise' | 'tf';
  /** the measured value (NaN when it could not be measured, see `error`) */
  value: number;
  /** x position (time / frequency / sweep value) the value was taken at, when there is one */
  at?: number;
  /** why there is no value (condition never met, unknown vector, empty range ...) */
  error?: string;
}

export type SimulationErrorCode =
  | 'singular'
  | 'noconv'
  | 'timestep'
  | 'netlist'
  | 'aborted'
  | 'unsupported'
  | 'internal';

export class SimulationError extends Error {
  readonly code: SimulationErrorCode;
  readonly detail?: string;
  constructor(message: string, code: SimulationErrorCode, detail?: string) {
    super(message);
    this.name = 'SimulationError';
    this.code = code;
    this.detail = detail;
  }
}

export function findVector(result: AnalysisResult, name: string): Vector | undefined {
  const key = name.trim().toLowerCase();
  return result.vectors.find((v) => v.name.toLowerCase() === key);
}
