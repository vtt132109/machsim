/**
 * Running a model maker: read the datasheet fields, fit, and verify the fit by simulation.
 *
 *   readMakerInput(def, input)       -> { values, errors } (user number syntax; blank optional fields)
 *   runMaker(def, input, name)       -> { values, result } (throws MakerInputError for bad input)
 *   verifyMaker(checks, run)         -> CheckOutcome[] (each bench simulated with `run`)
 * `run` is the simulator's runAnalyses (in-process in tests; the UI passes the same function
 * loaded on demand, or a worker-backed batch runner through `verifyMakerAsync`).
 */
import type { AnalysisResult } from '../../sim/results';
import type { Netlist } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { MakerInputError, type CheckOutcome, type MakerCheck, type MakerDef, type MakerResult, type MakerValues } from './types';

export interface InputProblem {
  key: string;
  /** 'required' | 'number' | 'range' | 'positive' | 'option' */
  problem: string;
}

/** Parse the datasheet fields of a maker. */
export function readMakerInput(def: MakerDef, input: Record<string, string>): { values: MakerValues; errors: InputProblem[] } {
  const values: MakerValues = {};
  const errors: InputProblem[] = [];
  for (const f of def.fields) {
    const text = (input[f.key] ?? f.default).trim();
    if (f.kind === 'select') {
      const v = text || f.default;
      if (f.options && !f.options.includes(v)) errors.push({ key: f.key, problem: 'option' });
      values[f.key] = v;
      continue;
    }
    if (!text) {
      if (!f.optional) errors.push({ key: f.key, problem: 'required' });
      values[f.key] = undefined;
      continue;
    }
    const x = parseUserNumber(text);
    if (!Number.isFinite(x)) {
      errors.push({ key: f.key, problem: 'number' });
      continue;
    }
    if ((f.positive ?? true) && !(x > 0)) errors.push({ key: f.key, problem: 'positive' });
    else if ((f.min !== undefined && x < f.min) || (f.max !== undefined && x > f.max)) errors.push({ key: f.key, problem: 'range' });
    values[f.key] = x;
  }
  return { values, errors };
}

/** Default input texts of a maker (the form's initial state). */
export function defaultMakerInput(def: MakerDef): Record<string, string> {
  return Object.fromEntries(def.fields.map((f) => [f.key, f.default]));
}

/**
 * Fit a model; throws MakerInputError when a field is invalid or the data cannot be fitted. With
 * `run` (the simulator), makers that have a simulation-based refinement apply it.
 */
export function runMaker(def: MakerDef, input: Record<string, string>, name: string, run?: (netlist: Netlist) => AnalysisResult[]): { values: MakerValues; result: MakerResult } {
  const { values, errors } = readMakerInput(def, input);
  if (errors.length) throw new MakerInputError(`field.${errors[0].problem}`, { field: errors[0].key });
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new MakerInputError('badName', { name });
  const fitted = def.fit(values, name);
  return { values, result: run && def.refine ? def.refine(values, fitted, run) : fitted };
}

function outcome(c: MakerCheck, measured: number, failure?: string): CheckOutcome {
  const error = Number.isFinite(measured) ? (measured - c.target) / (Math.abs(c.target) || 1) : NaN;
  const allowed = Math.max(c.tol * Math.abs(c.target), c.absTol ?? 0);
  const pass = Number.isFinite(measured) && Math.abs(measured - c.target) <= allowed;
  const o: CheckOutcome = { id: c.id, target: c.target, unit: c.unit, measured, error, pass };
  if (c.params) o.params = c.params;
  if (failure) o.failure = failure;
  return o;
}

function measure(c: MakerCheck, results: AnalysisResult[]): CheckOutcome {
  try {
    const failed = results.find((r) => r.error);
    if (failed) return outcome(c, NaN, failed.error);
    return outcome(c, c.measure(results));
  } catch (e) {
    return outcome(c, NaN, e instanceof Error ? e.message : String(e));
  }
}

/** Simulate every check bench and compare with its datasheet value. */
export function verifyMaker(checks: MakerCheck[], run: (netlist: Netlist) => AnalysisResult[]): CheckOutcome[] {
  return checks.map((c) => {
    let results: AnalysisResult[];
    try {
      results = run(c.netlist);
    } catch (e) {
      return outcome(c, NaN, e instanceof Error ? e.message : String(e));
    }
    return measure(c, results);
  });
}

/** Same as verifyMaker with a batch runner (one call for every bench, e.g. the simulation worker). */
export async function verifyMakerAsync(checks: MakerCheck[], runBatch: (netlists: Netlist[]) => Promise<AnalysisResult[][]>): Promise<CheckOutcome[]> {
  const all = await runBatch(checks.map((c) => c.netlist));
  return checks.map((c, i) => measure(c, all[i] ?? []));
}
