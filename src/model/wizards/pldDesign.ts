/**
 * PLD wizard: turns a truth table or a set of Boolean equations written with the learner's own
 * signal names into a ready programmable-logic block on a schematic, and into the module that
 * src/model/hdl.ts exports as VHDL or Verilog.
 *
 * It reuses what is already there instead of building a parallel feature:
 *  - the logic itself is compiled by `src/sim/devices/digital/logicExpr.ts`, the same compiler the
 *    PLD code model (`D_PLD`) runs and the logic converter uses, so what the wizard checks and
 *    what the simulation does cannot drift apart;
 *  - the part placed on the sheet is one of the catalogue PLD blocks (`misc-digital/pld-<n>x<m>`):
 *    the wizard picks the smallest block whose pin count fits and leaves the spare pins open.
 *
 * The learner writes `Q = A & B`, not `O0 = I0 & I1`: {@link translateNames} rewrites the names
 * into the index form the block's `program` parameter expects (and reports a name that is neither
 * an input nor an output). The generated sheet carries a net label on every used pin, named after
 * the learner's signal, plus a voltage probe on each output, so the block is wired into the
 * schematic by name as soon as it is placed.
 */
import { compileLogicProgram, isTruthTable, type LogicProgram } from '../../sim/devices/digital/logicExpr';
import { hdlModule, type HdlModule } from '../hdl';
import { DesignBuilder } from '../designkit';
import type { Design } from '../types';

/** Pin counts of the PLD blocks in the catalogue, smallest first. */
export const PLD_SIZES: readonly { inputs: number; outputs: number }[] = [
  { inputs: 2, outputs: 2 },
  { inputs: 4, outputs: 4 },
  { inputs: 8, outputs: 8 },
  { inputs: 16, outputs: 8 },
];

/** Largest block the wizard can fill. */
export const PLD_MAX_INPUTS = 16;
export const PLD_MAX_OUTPUTS = 8;

/** Part id of the smallest block that fits, or null when nothing does. */
export function pldPartFor(nIn: number, nOut: number): string | null {
  const fit = PLD_SIZES.find((s) => s.inputs >= nIn && s.outputs >= nOut);
  return fit ? `misc-digital/pld-${fit.inputs}x${fit.outputs}` : null;
}

/** Words the logic compiler reads as operators, so they cannot be signal names. */
const RESERVED = new Set(['AND', 'OR', 'XOR', 'NOT', 'OE', 'C']);

export interface TranslateResult {
  /** program text in `I<k>` / `O<k>` form */
  text: string;
  /** names that are neither an input nor an output, in the order they appeared */
  unknown: string[];
  /** problems with the given signal names (not with the program) */
  nameErrors: { name: string; reason: 'reserved' | 'duplicate' | 'empty' | 'syntax' }[];
}

/** Check the signal names and rewrite a program written with them into index form. */
export function translateNames(text: string, inputs: readonly string[], outputs: readonly string[]): TranslateResult {
  const nameErrors: TranslateResult['nameErrors'] = [];
  const map = new Map<string, string>();
  const seen = new Set<string>();
  const check = (raw: string, replacement: string): void => {
    const name = (raw ?? '').trim();
    const up = name.toUpperCase();
    if (name.length === 0) {
      nameErrors.push({ name, reason: 'empty' });
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      nameErrors.push({ name, reason: 'syntax' });
      return;
    }
    if (RESERVED.has(up)) {
      nameErrors.push({ name, reason: 'reserved' });
      return;
    }
    if (seen.has(up)) {
      nameErrors.push({ name, reason: 'duplicate' });
      return;
    }
    seen.add(up);
    map.set(up, replacement);
  };
  inputs.forEach((n, k) => check(n, `I${k}`));
  outputs.forEach((n, k) => check(n, `O${k}`));
  if (nameErrors.length > 0) return { text: '', unknown: [], nameErrors };
  const unknown: string[] = [];
  // rewrite identifiers; anything that is not a name, an operator or a number is left alone
  const out = text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => {
    const up = word.toUpperCase();
    const hit = map.get(up);
    if (hit) return hit;
    if (RESERVED.has(up) || up === 'OE') return word;
    if (!unknown.includes(word)) unknown.push(word);
    return word;
  });
  return { text: out, unknown, nameErrors };
}

export interface PldSpec {
  /** input signal names, in pin order */
  inputs: string[];
  /** output signal names, in pin order */
  outputs: string[];
  /** truth table or Boolean equations written with the names above */
  program: string;
  /** block name (used for the HDL entity / module and the sheet title) */
  name?: string;
  /** logic high level of the block (V) */
  vhigh?: number;
  /** propagation delay of the block (user-number text) */
  delay?: string;
  /** header comment lines of the exported HDL */
  comment?: string[];
}

export interface PldBuild {
  /** part id of the chosen block (null when the signal counts do not fit any block) */
  partId: string | null;
  /** pin counts of the chosen block */
  size: { inputs: number; outputs: number } | null;
  /** the program as the block's `program` parameter wants it */
  blockProgram: string;
  /** the compiled program (empty outputs when it did not compile) */
  compiled: LogicProgram;
  /** problems: name errors first, then the compiler's messages (with line numbers) */
  errors: string[];
  nameErrors: TranslateResult['nameErrors'];
  unknown: string[];
  /** true when the program uses `:=`, so the block needs its clock */
  clocked: boolean;
  /** true when some output has an enable expression */
  triState: boolean;
  /** module for the VHDL / Verilog export (null when nothing compiled) */
  hdl: HdlModule | null;
}

/** Compile and check a PLD specification without building a schematic. */
export function buildPld(spec: PldSpec): PldBuild {
  const inputs = spec.inputs.map((s) => s.trim()).filter((s) => s.length > 0);
  const outputs = spec.outputs.map((s) => s.trim()).filter((s) => s.length > 0);
  const size = PLD_SIZES.find((s) => s.inputs >= inputs.length && s.outputs >= outputs.length) ?? null;
  const tr = translateNames(spec.program, inputs, outputs);
  const errors: string[] = [];
  if (inputs.length === 0) errors.push('no inputs');
  if (outputs.length === 0) errors.push('no outputs');
  if (!size) errors.push(`no PLD block has ${inputs.length} inputs and ${outputs.length} outputs`);
  for (const n of tr.unknown) errors.push(`unknown signal '${n}'`);
  const nIn = Math.max(1, size?.inputs ?? inputs.length);
  const nOut = Math.max(1, size?.outputs ?? outputs.length);
  const compiled = tr.nameErrors.length > 0 ? { outputs: [], errors: [], kind: 'empty' as const } : compileLogicProgram(tr.text, nIn, nOut);
  errors.push(...compiled.errors);
  const clocked = compiled.outputs.some((o) => o.registered);
  const triState = compiled.outputs.some((o) => o.oe !== undefined);
  const blockProgram = compiled.outputs.length > 0 && errors.length === 0 ? tr.text : '';
  const hdl =
    compiled.outputs.length > 0 && tr.nameErrors.length === 0
      ? hdlModule(compiled, inputs.length, outputs.length, {
          name: spec.name ?? 'machsim_pld',
          inputs,
          outputs,
          comment: spec.comment,
        })
      : null;
  return {
    partId: size ? `misc-digital/pld-${size.inputs}x${size.outputs}` : null,
    size,
    blockProgram,
    compiled,
    errors,
    nameErrors: tr.nameErrors,
    unknown: tr.unknown,
    clocked,
    triState,
    hdl,
  };
}

export interface PldDesignResult extends PldBuild {
  /** a one-sheet design with the block, its net labels and output probes */
  design: Design;
}

/**
 * Build a one-sheet design with the chosen PLD block: a net label named after each signal on every
 * used pin (plus CLK when the program has registered outputs) and a voltage probe on each output.
 * The design is complete and simulates; the caller either opens it or inserts its sheet as a
 * fragment into the design being edited.
 */
export function pldDesign(spec: PldSpec): PldDesignResult {
  const build = buildPld(spec);
  const b = new DesignBuilder(spec.name && spec.name.trim().length > 0 ? spec.name.trim() : 'PLD');
  const inputs = spec.inputs.map((s) => s.trim()).filter((s) => s.length > 0);
  const outputs = spec.outputs.map((s) => s.trim()).filter((s) => s.length > 0);
  if (build.partId) {
    const params: Record<string, string> = { program: build.blockProgram || spec.program };
    if (spec.vhigh !== undefined) params.vhigh = String(spec.vhigh);
    if (spec.delay !== undefined) params.delay = spec.delay;
    const h = b.part(build.partId, 'U1', 300, 200, params);
    inputs.forEach((name, k) => {
      b.labelPin(h, `I${k}`, name);
    });
    outputs.forEach((name, k) => {
      b.labelPin(h, `O${k}`, name);
      const p = b.pin(h, `O${k}`);
      b.probe('voltage', p.x + 20, p.y, name);
    });
    if (build.clocked) b.labelPin(h, 'CLK', 'CLK');
  }
  b.design.analysis = {
    ...b.design.analysis,
    active: 'tran',
    specs: { ...b.design.analysis.specs, tran: { type: 'tran', tstep: 1e-6, tstop: 1e-3 } },
  };
  return { ...build, design: b.design };
}
