/**
 * Parameter stepping on a schematic: `.step` and the Parameter sweep analysis of a DESIGN VARIABLE
 * (a global parameter, Design.variables) share ONE engine path, `ParamSweepAnalysis` with
 * `global: true` (src/sim/analyses/sweeps.ts), so every analysis type can be stepped and every
 * step comes back as one run of an overlaid family with a legend per value ("Rx=1e3").
 *
 * The schematic netlister writes part values as numbers, so a variable cannot stay symbolic inside
 * ONE netlist; the netlist is REBUILT per value instead: {@link applySteps} sets the variable in a
 * copy of the design, builds its netlist and hands the list to the sweep (`netlists`). A SPICE deck
 * does not need this (the engine re-evaluates its `.param` expressions per value), and neither does
 * a `.param` that only the design's custom SPICE text uses.
 *
 * Two sources of steps are handled here:
 *  - the active analysis is a Parameter sweep whose target is a design variable (`global`);
 *  - the design's custom SPICE text holds a `.step` card (`.step param Rx list 1k 2k 5k`,
 *    `.step dec param C 1n 1u 5`, `.step temp -40 125 55`, `.step R1 list 1k 2k` ...). The card
 *    wraps the analysis that is about to run (any analysis that is not itself a sweep); the first
 *    card is used, the others are reported. The card is read by the SPICE parser, with the design
 *    variables and the text's own `.param`s declared, so `.step param` accepts both kinds of names.
 *
 * Pure (no UI); the controller calls it before a one-shot run and the command line tool before a
 * batch run.
 */
import type { AnalysisSpec, Netlist, ParamSweepAnalysis, TempSweepAnalysis } from '../sim/netlist';
import { parseSpice } from '../sim/spice/parser';
import { stepCards } from '../sim/spice/stepcards';
import { buildNetlist } from './netlister';
import type { Design } from './types';
import { resolveDesignVariables } from './variables';

/** Analyses a `.step` card may wrap (the ones that are not themselves a sweep or a family). */
const WRAPPABLE = new Set<string>(['op', 'dc', 'ac', 'acsingle', 'tran', 'noise', 'tf', 'sens', 'pz', 'four', 'disto', 'noisefig']);

export { stepCards } from '../sim/spice/stepcards';

/**
 * A remark or problem about stepping. `code` + `params` are what the UI localises (`stepMessage`
 * in src/i18n/steps.ts); `text` is the English fallback used by tests and the command line.
 */
export interface StepMessage {
  code: 'extraCard' | 'sweepAlready' | 'cardError' | 'notUsable' | 'valueError';
  params: Record<string, string | number>;
  text: string;
}

export interface StepOutcome {
  /** the analysis to run (the given one, wrapped and filled when steps apply) */
  spec: AnalysisSpec;
  /** remarks for the learner (a second `.step` card is ignored, a card on a sweep is ignored ...) */
  notes: StepMessage[];
  /** problems that stop the run (a bad `.step` card, a value that breaks the circuit) */
  errors: StepMessage[];
  /** true when the result differs from the given analysis */
  stepped: boolean;
}

/** A value of a design variable as text the variable parser reads back exactly. */
export function variableText(v: number): string {
  return String(v);
}

/** Names (and numeric values) a `.step param` may refer to: design variables and the text's `.param`s. */
function knownParams(design: Design): Record<string, number> {
  const names: Record<string, number> = {};
  for (const [k, v] of resolveDesignVariables(design.variables).values) names[k] = v;
  if (design.customSpice?.trim()) {
    try {
      const parsed = parseSpice(design.customSpice, { hasTitle: false, fileName: 'custom SPICE' });
      for (const [k, v] of Object.entries(parsed.netlist.params)) {
        if (k.includes('(') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
        names[k.toLowerCase()] ??= typeof v === 'number' && Number.isFinite(v) ? v : 1;
      }
    } catch {
      // the netlister reports a broken custom SPICE text itself
    }
  }
  return names;
}

/** The sweep a design's `.step` card describes, around a placeholder operating point. */
export function customStepWrapper(design: Design): { wrapper?: ParamSweepAnalysis | TempSweepAnalysis; notes: StepMessage[]; errors: StepMessage[] } {
  const cards = stepCards(design.customSpice);
  if (!cards.length) return { notes: [], errors: [] };
  const notes: StepMessage[] = [];
  if (cards.length > 1) notes.push({ code: 'extraCard', params: { n: cards.length - 1 }, text: `only the first .step card is used (${cards.length - 1} more ignored)` });
  const params = Object.entries(knownParams(design))
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => `.param ${k}=${v}`);
  const parsed = parseSpice(['* steps', ...params, cards[0], '.end'].join('\n'));
  const errors: StepMessage[] = parsed.errors.map((e) => ({ code: 'cardError', params: { card: cards[0], message: e.message }, text: `${cards[0]}: ${e.message}` }));
  const wrapper = parsed.netlist.analyses[0];
  if (!wrapper || (wrapper.type !== 'paramsweep' && wrapper.type !== 'tempsweep')) return { notes, errors: errors.length ? errors : [{ code: 'notUsable', params: { card: cards[0] }, text: `${cards[0]}: not a usable .step card` }] };
  return { wrapper, notes, errors };
}

/** `wrapper` with the innermost placeholder analysis replaced by `base`. */
function around(wrapper: ParamSweepAnalysis | TempSweepAnalysis, base: AnalysisSpec): AnalysisSpec {
  return { ...wrapper, base };
}

/**
 * The analysis to run for `spec` on `design`: the design's `.step` card wrapped around it, and the
 * netlists of every sweep of a design variable filled in. `finish` post-processes each rebuilt
 * netlist the same way the caller treats the main one (saves, options); default: no analyses.
 */
export function applySteps(design: Design, spec: AnalysisSpec, finish: (n: Netlist) => Netlist = (n) => ({ ...n, analyses: [] })): StepOutcome {
  const notes: StepMessage[] = [];
  const errors: StepMessage[] = [];
  let out = spec;
  const custom = customStepWrapper(design);
  notes.push(...custom.notes);
  errors.push(...custom.errors);
  if (custom.wrapper) {
    if (WRAPPABLE.has(spec.type)) out = around(custom.wrapper, spec);
    else notes.push({ code: 'sweepAlready', params: { analysis: spec.type }, text: `the .step card of the circuit's SPICE text is not applied: the ${spec.type} analysis already repeats the circuit` });
  }
  out = fill(design, out, finish, errors);
  return { spec: out, notes, errors, stepped: out !== spec };
}

/** True when the spec (or one it repeats) sweeps a design variable. */
export function sweepsDesignVariable(design: Design, spec: AnalysisSpec): boolean {
  if (spec.type === 'paramsweep' && spec.global && variableKey(design, spec.target) !== undefined) return true;
  return children(spec).some((c) => sweepsDesignVariable(design, c));
}

function variableKey(design: Design, name: string): string | undefined {
  const k = name.trim().toLowerCase();
  return Object.keys(design.variables ?? {}).find((v) => v.toLowerCase() === k);
}

function children(spec: AnalysisSpec): AnalysisSpec[] {
  switch (spec.type) {
    case 'paramsweep':
    case 'tempsweep':
    case 'montecarlo':
    case 'worstcase':
    case 'nestedsweep':
    case 'tracewidth':
      return [spec.base];
    case 'batch':
      return spec.items;
    default:
      return [];
  }
}

/** Copy of `spec` in which every design-variable sweep carries its rebuilt netlists. */
function fill(design: Design, spec: AnalysisSpec, finish: (n: Netlist) => Netlist, errors: StepMessage[]): AnalysisSpec {
  let next: AnalysisSpec = spec;
  switch (spec.type) {
    case 'paramsweep': {
      const key = spec.global ? variableKey(design, spec.target) : undefined;
      const base = fill(design, spec.base, finish, errors);
      if (key === undefined || spec.netlists !== undefined) {
        next = base === spec.base ? spec : { ...spec, base };
        break;
      }
      const netlists: Netlist[] = [];
      for (const v of spec.values) {
        const built = buildNetlist({ ...design, variables: { ...design.variables, [key]: variableText(v) } }, { includeAnalysis: false });
        const bad = built.erc.find((m) => m.severity === 'error');
        if (bad) {
          errors.push({ code: 'valueError', params: { name: key, value: variableText(v), message: bad.message }, text: `${key} = ${variableText(v)}: ${bad.message}` });
          break;
        }
        netlists.push(finish(built.netlist));
      }
      next = netlists.length === spec.values.length ? { ...spec, base, netlists } : { ...spec, base };
      break;
    }
    case 'tempsweep':
    case 'montecarlo':
    case 'worstcase':
    case 'nestedsweep':
    case 'tracewidth': {
      const base = fill(design, spec.base, finish, errors);
      if (base !== spec.base) next = { ...spec, base } as AnalysisSpec;
      break;
    }
    case 'batch': {
      const items = spec.items.map((i) => fill(design, i, finish, errors));
      if (items.some((i, k) => i !== spec.items[k])) next = { ...spec, items };
      break;
    }
    default:
      break;
  }
  return next;
}
