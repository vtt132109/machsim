/**
 * Linear device factories (engine team): R C L K V I E F G H S W T, and O (lossy line, LTRA).
 * Merged into the device registry by src/sim/devices/registry.ts.
 */
import type { DeviceFactoryTable } from '../../device';
import { createCapacitor } from './capacitor';
import { createCccs, createCcvs, createVccs, createVcvs } from './controlled';
import { createInductor, createMutualInductance } from './inductor';
import { createResistor } from './resistor';
import { createCurrentSource, createVoltageSource } from './sources';
import { createCurrentSwitch, createVoltageSwitch } from './switch';
import { createTransmissionLine } from './tline';
import { createLossyLine } from './ltra';
import { createLaplaceSource } from './laplace';
import { createFreqTableSource } from './freqTable';

export const linearFactories: DeviceFactoryTable = {
  R: createResistor,
  C: createCapacitor,
  L: createInductor,
  K: createMutualInductance,
  V: createVoltageSource,
  I: createCurrentSource,
  E: (el) => (el.laplace ? createLaplaceSource(el) : el.freqTable ? createFreqTableSource(el) : createVcvs(el)),
  F: createCccs,
  G: (el) => (el.laplace ? createLaplaceSource(el) : el.freqTable ? createFreqTableSource(el) : createVccs(el)),
  H: createCcvs,
  S: createVoltageSwitch,
  W: createCurrentSwitch,
  T: createTransmissionLine,
  O: createLossyLine,
};

export { Resistor, MIN_RESISTANCE } from './resistor';
export { Capacitor } from './capacitor';
export { Inductor, MutualInductance } from './inductor';
export { VoltageSource, CurrentSource } from './sources';
export { Vcvs, Vccs, Cccs, Ccvs, resolveControlBranch } from './controlled';
export { VoltageSwitch, CurrentSwitch } from './switch';
export { TransmissionLine } from './tline';
export { LossyLine, lineYParams } from './ltra';
export { LaplaceSource } from './laplace';
export { FreqTableSource, freqTableResponse, freqTableDc, freqTableKernel, type FreqTable } from './freqTable';
