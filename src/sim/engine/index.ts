/**
 * Simulation engine: circuit construction, Newton-Raphson / operating point, AC, transient,
 * analysis registry, interactive stepper. See the module docs of each file.
 */
export { Circuit, resolveOptions, type CircuitBuildOptions, type NodeValue } from './circuit';
export {
  RealSystem,
  EngineLoadContext,
  FORCE_CONDUCTANCE,
  checkAbort,
  singularError,
  type AbortFlag,
  type IntegrationSetup,
} from './system';
export {
  newtonSolve,
  solveOperatingPoint,
  gminStepping,
  sourceStepping,
  convergenceFailure,
  describeFailure,
  type NewtonParams,
  type NewtonResult,
  type OpParams,
  type OpResult,
  type OpStrategy,
} from './newton';
export { AcSystem, sweepFrequencies } from './ac';
export { TransientEngine, type TransientParams, type StepPlan } from './transient';
export {
  selectProbes,
  ProbeEvaluator,
  Recorder,
  evaluateComplexProbes,
  deviceOutputKeys,
  unitForKey,
  type Probe,
  type ProbeKind,
  type ProbeOptions,
  type ProbeSelection,
} from './outputs';
export {
  computeOperatingPoint,
  buildAcSystem,
  dcSweepTarget,
  sweepValues,
  runOp,
  runDc,
  runAc,
  runAcSingle,
  runTran,
  type SweepTarget,
} from './analyses';
export {
  registerAnalysis,
  getAnalysisRunner,
  registeredAnalyses,
  analysisTitle,
  type AnalysisContext,
  type AnalysisRunner,
} from './analysis-registry';
export { runAnalyses, runSpec, createAnalysisContext, errorResult } from './run';
export { createTransientStepper, InteractiveStepper } from './stepper';
export type { AcceptContext, ComplexReader, EngineDevice, EngineDeviceExtensions, TransientSetup } from './hooks';
