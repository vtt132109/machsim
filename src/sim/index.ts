/**
 * Public simulation API (see src/sim/api.ts for the contract types).
 *
 *   runAnalyses(netlist, opts?)            -> AnalysisResult[]   (one per netlist.analyses entry)
 *   createTransientStepper(netlist, opts)  -> TransientStepper   (interactive simulation)
 *
 * Engine classes are re-exported for modules that build analyses on top of the core
 * (registerAnalysis, Circuit, RealSystem, AcSystem, TransientEngine, ...).
 */
import type { CreateTransientStepper, RunAnalyses } from './api';
import { createTransientStepper as createStepperImpl, runAnalyses as runAnalysesImpl } from './engine';
import './analyses';

export const runAnalyses: RunAnalyses = runAnalysesImpl;
export const createTransientStepper: CreateTransientStepper = createStepperImpl;

export type { RunAnalyses, CreateTransientStepper, RunOptions, StepperOptions, TransientChunk, TransientStepper } from './api';
export {
  Circuit,
  RealSystem,
  AcSystem,
  TransientEngine,
  InteractiveStepper,
  solveOperatingPoint,
  newtonSolve,
  computeOperatingPoint,
  buildAcSystem,
  sweepFrequencies,
  sweepValues,
  dcSweepTarget,
  selectProbes,
  ProbeEvaluator,
  Recorder,
  evaluateComplexProbes,
  registerAnalysis,
  getAnalysisRunner,
  registeredAnalyses,
  analysisTitle,
  runSpec,
  createAnalysisContext,
  errorResult,
  type AnalysisContext,
  type AnalysisRunner,
  type EngineDevice,
  type Probe,
} from './engine';
export { linearFactories } from './devices/linear';
export { getDeviceFactory, registerDeviceFactory, supportedElementTypes } from './devices/registry';
export { SimulationError, findVector, type AnalysisResult, type Vector } from './results';
