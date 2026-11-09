/**
 * Model makers (datasheet values -> SPICE model + verification benches). See types.ts.
 *
 *   MAKERS / getMaker(id)                 the eleven makers
 *   runMaker(def, input, name)            fit (verify.ts)
 *   verifyMaker(def.checks(values, result), runAnalyses)   simulate every datasheet point
 */
import type { MakerId } from '../custom/types';
import { acMotorMaker } from './motor';
import { bjtMaker } from './bjt';
import { diodeMaker, ledMaker, zenerMaker } from './diodes';
import { jfetMaker } from './jfet';
import { mosfetMaker } from './mosfet';
import { opampMaker } from './opamp';
import { scrMaker } from './scr';
import { tlineMaker } from './tline';
import { transformerMaker } from './transformer';
import type { MakerDef } from './types';

export const MAKERS: readonly MakerDef[] = [diodeMaker, zenerMaker, ledMaker, bjtMaker, mosfetMaker, jfetMaker, opampMaker, scrMaker, transformerMaker, tlineMaker, acMotorMaker];

/** Provenance text of a part whose model a maker fitted (stored with the part, technical English). */
export function makerProvenance(id: MakerId, input: Record<string, string>): string {
  const given = getMaker(id)
    .fields.filter((f) => (input[f.key] ?? '').trim())
    .map((f) => `${f.key}=${input[f.key]}`)
    .join(', ');
  return `MachSim model maker (${id}) fitted from datasheet values: ${given}`;
}

/** Provenance text of a part using an imported SPICE model. */
export function importProvenance(modelName: string): string {
  return `SPICE model ${modelName} (user import)`;
}

export function getMaker(id: MakerId): MakerDef {
  const m = MAKERS.find((x) => x.id === id);
  if (!m) throw new Error(`no model maker ${id}`);
  return m;
}

export * from './types';
export { defaultMakerInput, readMakerInput, runMaker, verifyMaker, verifyMakerAsync, type InputProblem } from './verify';
export { LED_MAKER_COLORS } from './diodes';
export { MOTOR_PART } from './motor';
