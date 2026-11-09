/**
 * Digital / mixed-signal device family: XSPICE-like code models as 'A' elements.
 *
 *   A1 in1 in2 out          nand_ls      (.model nand_ls D_NAND (rise_delay=9n fall_delay=10n ...))
 *   A2 d clk null null q qn dff1         (NULL = unconnected port)
 *   A3 a b y vcc 0 and_hc  pwr=2         (outputs track V(vcc), see core.ts)
 *
 * core.ts documents the electrical model (thresholds, Thevenin outputs, delays, supply nodes,
 * X / Z policy); behaviour.ts the behaviour API; gates.ts, sequential.ts, msi.ts, msi2.ts,
 * memory.ts, pld.ts, mixed.ts, mixed2.ts and displays.ts the port layouts and parameters of every
 * model type (digitalModelTypes() lists them); memimage.ts and logicExpr.ts are the pure parsers
 * of memory images and PLD programs shared with the library.
 */
import type { DeviceFactoryTable } from '../../device';
import { CodeModelDevice } from './core';

export const digitalFactories: DeviceFactoryTable = {
  A: (el) => new CodeModelDevice(el),
};

export { CodeModelDevice, invertedPorts } from './core';
export { digitalModelTypes, getBehaviourFactory, registerBehaviour } from './registry';
export { SEGMENT_FONTS } from './msi';
export { parseHexWords } from './mixed';
export { parseMemoryImage, formatMemoryImage, wordDigits, type MemoryImageResult } from './memimage';
export { compileLogicProgram, truthTableToEquations, isTruthTable, programText, type LogicProgram, type CompiledOutput } from './logicExpr';
export { alu181 } from './msi2';
export { lcdPowerOn, lcdInstruction, lcdWrite, lcdCellAddress, type LcdState } from './displays';
export { Pwl, MIN_RAMP } from './pwl';
export {
  HI,
  LO,
  REF,
  Z,
  ParamReader,
  type AnalogOutputSpec,
  type Behaviour,
  type BehaviourContext,
  type BehaviourFactory,
  type EvalIO,
  type LogicValue,
  type OutputSpec,
} from './behaviour';
