/**
 * Model makers: original fitting code that turns datasheet values into a SPICE model, plus test
 * benches that simulate the model at the entered datasheet points (the learner sees "datasheet /
 * simulated / error" for every point).
 *
 * A maker (`MakerDef`) declares
 *   - `fields`: the datasheet values it asks for (key, unit, default, optional, range, section),
 *     labelled in the UI by the i18n keys `maker.<maker>.<key>` and `tip.maker.<maker>.<key>`;
 *   - `terminals`: model terminals in SPICE order and the symbol template that fits them;
 *   - `fit(values, name)`: the fitted model (SPICE `.model` / `.subckt` text, or a built-in part
 *     with fitted parameters), the fitted parameter values and notes (i18n `maker.note.<id>`);
 *   - `checks(values, result)`: benches (complete netlists) with the target value, a tolerance and
 *     a `measure` function on the analysis results.
 * Numbers are SI; text inputs use the user number syntax (k, m, µ, M = mega, ...).
 */
import type { MakerId } from '../custom/types';
import type { SymbolTemplateId } from '../custom/templates';
import type { PartGroup } from '../types';
import type { Netlist } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';

export interface MakerField {
  key: string;
  /** display unit ('' for none) */
  unit: string;
  /** default value text (user number syntax) or select value */
  default: string;
  kind?: 'number' | 'select';
  /** select values (labels: i18n `maker.<maker>.<key>.<value>`) */
  options?: string[];
  /** may be left blank (the maker then uses a typical value and says so in a note) */
  optional?: boolean;
  /** allowed range of the SI value */
  min?: number;
  max?: number;
  /** values must be > 0 (default true for number fields) */
  positive?: boolean;
  /** 'basic' fields are shown first; 'advanced' ones are folded away for beginners */
  section?: 'basic' | 'advanced';
}

/** Parsed field values: numbers (SI) for number fields, text for selects, undefined when blank. */
export type MakerValues = Record<string, number | string | undefined>;

/** A remark about the fit (i18n `maker.note.<id>` with params). */
export interface MakerNote {
  id: string;
  params?: Record<string, string | number>;
  /** 'warn' when a datasheet value could not be matched */
  level?: 'info' | 'warn';
}

export type MakerModel =
  | { kind: 'spice'; text: string; name: string }
  | { kind: 'builtin'; partId: string; params: Record<string, string> };

export interface MakerResult {
  model: MakerModel;
  /** fitted model parameters for display (SPICE parameter name -> SI value) */
  fitted: Record<string, number>;
  notes: MakerNote[];
}

export interface MakerCheck {
  /** i18n `maker.check.<id>` (with params) */
  id: string;
  params?: Record<string, string | number>;
  target: number;
  unit: string;
  /** relative tolerance (0.03 = 3 %) */
  tol: number;
  /** absolute tolerance (in `unit`), used when larger than tol·|target| */
  absTol?: number;
  netlist: Netlist;
  measure(results: AnalysisResult[]): number;
}

export interface CheckOutcome {
  id: string;
  params?: Record<string, string | number>;
  target: number;
  unit: string;
  measured: number;
  /** relative error (measured - target) / |target| (NaN when the bench failed) */
  error: number;
  pass: boolean;
  /** bench failure message (simulator error) */
  failure?: string;
}

export interface MakerDef {
  id: MakerId;
  /** model terminals in SPICE order (device terminals or subcircuit ports) */
  terminals: string[];
  template: SymbolTemplateId;
  prefix: string;
  group: PartGroup;
  family: string;
  fields: MakerField[];
  /** symbol template and family for the chosen polarity (e.g. PNP), when they depend on the inputs */
  variant?(values: MakerValues): { template: SymbolTemplateId; family: string };
  fit(values: MakerValues, name: string): MakerResult;
  /**
   * Optional simulation-based correction of the analytic fit (the SCR's holding current lies where
   * the closed forms do not hold). `run` is the simulator (runAnalyses).
   */
  refine?(values: MakerValues, result: MakerResult, run: (netlist: Netlist) => AnalysisResult[]): MakerResult;
  checks(values: MakerValues, result: MakerResult): MakerCheck[];
}

/** Invalid maker input (i18n `maker.error.<code>`). */
export class MakerInputError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(`${code} ${JSON.stringify(params)}`);
    this.name = 'MakerInputError';
  }
}
