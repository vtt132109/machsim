/**
 * Advanced and meta analyses. Importing this module registers their runners in the engine's
 * analysis registry (src/sim/engine/analysis-registry.ts); src/sim/index.ts imports it once.
 *
 *   noise        noise.ts       output / input-referred noise spectra, per-device contributions
 *   noisefig     noise.ts       noise figure at one frequency
 *   tf           tf.ts          DC small-signal gain, input and output resistance
 *   sens         sens.ts        DC (and optional AC) sensitivities to element / model parameters
 *   pz           pz.ts          poles and zeros of a transfer function (eigen.ts)
 *   four         fourier.ts     harmonic analysis of transient outputs (THD)
 *   disto        disto.ts       HD2/HD3 and intermodulation (Volterra method, nonlinear.ts)
 *   paramsweep   sweeps.ts      base analysis over values of one parameter
 *   nestedsweep  sweeps.ts      base analysis over two parameters
 *   tempsweep    sweeps.ts      base analysis over temperatures
 *   batch        sweeps.ts      list of analyses
 *   montecarlo   montecarlo.ts  randomised tolerances (seeded), statistics of a measurement
 *   worstcase    montecarlo.ts  sensitivity-directed worst case of a measurement
 *   tracewidth   tracewidth.ts  IPC-2221 trace widths from transient currents
 *   user         user.ts        user-defined analysis: SPICE control cards run as a batch
 *
 * Helpers for other modules: netlist modification (modify.ts), measurements (measure.ts), the
 * seeded PRNG (prng.ts) and output functionals / source excitations (util.ts).
 */
import { registerAnalysis } from '../engine/analysis-registry';
import { runDisto } from './disto';
import { runFourier } from './fourier';
import { runMonteCarlo, runWorstCase } from './montecarlo';
import { runNoise, runNoiseFigure } from './noise';
import { runPz } from './pz';
import { runSens } from './sens';
import { runBatch, runNestedSweep, runParamSweep, runTempSweep } from './sweeps';
import { runTf } from './tf';
import { runTraceWidth } from './tracewidth';
import { runUserAnalysis } from './user';

registerAnalysis('noise', runNoise);
registerAnalysis('noisefig', runNoiseFigure);
registerAnalysis('tf', runTf);
registerAnalysis('sens', runSens);
registerAnalysis('pz', runPz);
registerAnalysis('four', runFourier);
registerAnalysis('disto', runDisto);
registerAnalysis('paramsweep', runParamSweep);
registerAnalysis('nestedsweep', runNestedSweep);
registerAnalysis('tempsweep', runTempSweep);
registerAnalysis('batch', runBatch);
registerAnalysis('montecarlo', runMonteCarlo);
registerAnalysis('worstcase', runWorstCase);
registerAnalysis('tracewidth', runTraceWidth);
registerAnalysis('user', runUserAnalysis);

export { runNoise, runNoiseFigure, collectNoiseGenerators, integrateSpectrum, NoiseEvaluator, type NoisePoint } from './noise';
export { runTf } from './tf';
export { runSens, sensitivityParameters, type SensParameter } from './sens';
export { runPz, pencilRoots, type Complex } from './pz';
export { runFourier, harmonicSpectrum, resampleUniform, type HarmonicSpectrum } from './fourier';
export { runDisto } from './disto';
export { NonlinearExpansion, forcing, conjugate, type ComplexVec, type IQ } from './nonlinear';
export { complexEigenvalues, realEigenvalues, type ComplexArray } from './eigen';
export { runParamSweep, runNestedSweep, runTempSweep, runBatch, aggregateScalarRuns, type SweepRun } from './sweeps';
export { runMonteCarlo, runWorstCase, drawTolerances } from './montecarlo';
export { runTraceWidth, ipc2221Width, MIL_PER_OZ } from './tracewidth';
export { runUserAnalysis, parseUserControls, type UserControls } from './user';
export {
  cloneNetlist,
  findElement,
  findModel,
  getParamValue,
  setParamValue,
  modifyNetlist,
  withTemperature,
  withSaves,
  paramLabel,
  valueLabel,
  type Modification,
} from './modify';
export { measureResult, measureName } from './measure';
export { Random } from './prng';
export {
  parseOutput,
  outputVector,
  applyOutput,
  findSource,
  addSourceExcitation,
  sourceGainFromAdjoint,
  residualAt,
  setDcMode,
  childContext,
  runNested,
  formatNumber,
  magnitudes,
  weightedStats,
  elementOf,
  deviceNodes,
  type OutputFunctional,
  type OutputKind,
  type ParseOutputOptions,
  type SourceRef,
} from './util';
