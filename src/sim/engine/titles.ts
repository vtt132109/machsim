/** Human-readable titles of analysis results, keyed by AnalysisSpec['type']. */
const TITLES: Record<string, string> = {
  op: 'Operating point',
  dc: 'DC sweep',
  ac: 'AC analysis',
  acsingle: 'Single-frequency AC analysis',
  tran: 'Transient analysis',
  noise: 'Noise analysis',
  tf: 'Transfer function',
  sens: 'Sensitivity analysis',
  pz: 'Pole-zero analysis',
  four: 'Fourier analysis',
  disto: 'Distortion analysis',
  noisefig: 'Noise figure analysis',
  paramsweep: 'Parameter sweep',
  tempsweep: 'Temperature sweep',
  montecarlo: 'Monte Carlo analysis',
  worstcase: 'Worst case analysis',
  nestedsweep: 'Nested sweep',
  tracewidth: 'Trace width analysis',
  batch: 'Batched analysis',
  user: 'User-defined analysis',
};

/** Title of an analysis type ("<type> analysis" for unknown types). */
export function analysisTitle(type: string): string {
  return TITLES[type] ?? `${type} analysis`;
}
