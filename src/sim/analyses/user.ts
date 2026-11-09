/**
 * User-defined analysis ('user'): SPICE control cards typed by the user, run on the circuit.
 *
 * The text is read by the SPICE parser as the control part of a deck, so every control card the
 * importer understands is accepted: .op .dc .ac .tran .noise .tf .sens .pz .four .disto, .step
 * (element / model / temperature sweeps), .temp, .options, .ic, .nodeset, .save / .probe /
 * .print, and .meas / .measure (evaluated on the results of the analysis cards, see meas.ts).
 * The cards' options, initial conditions and output requests are applied on top of the netlist's
 * own, then every analysis card runs in order; the result is a batch-like family whose runs are
 * labelled with their card ("1: .tran 1u 1m"). Element lines, .param, .model and .subckt are
 * rejected (the circuit comes from the schematic).
 */
import type { AnalysisSpec, MeasDirective, Netlist, SimOptions, UserAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult } from '../results';
import { parseSpice } from '../spice/parser';
import { applyMeasurements } from './meas';
import type { AnalysisContext } from '../engine/analysis-registry';
import { analysisTitle } from '../engine/titles';
import { runSpec } from '../engine/run';
import { childContext } from './util';

export interface UserControls {
  analyses: AnalysisSpec[];
  /** source line of each analysis card (trimmed) */
  cards: string[];
  options: Partial<SimOptions>;
  ic: Record<string, number>;
  nodeset: Record<string, number>;
  saves: string[];
  /** .meas directives, evaluated on the results of the cards' analyses */
  measures: MeasDirective[];
  warnings: string[];
  /** "line N: message" */
  errors: string[];
}

const ANALYSIS_CARD = /^\.(op|dc|ac|tran|noise|tf|sens|pz|four|fourier|disto|step)\b/i;
const FORBIDDEN = /^\.(param|model|subckt|ends|include|inc|lib|func|global|end)\b/i;

/** Parse the control text of a user-defined analysis (never throws). */
export function parseUserControls(text: string): UserControls {
  const errors: string[] = [];
  const cards: string[] = [];
  const kept: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith(';')) {
      kept.push('*');
      return;
    }
    if (line.startsWith('+')) {
      kept.push(raw);
      if (cards.length) cards[cards.length - 1] += ` ${line.slice(1).trim()}`;
      return;
    }
    if (!line.startsWith('.')) {
      errors.push(`line ${i + 1}: '${line}' is not a control card (start every line with a dot, e.g. .tran 1u 1m)`);
      kept.push('*');
      return;
    }
    if (FORBIDDEN.test(line)) {
      errors.push(`line ${i + 1}: ${line.split(/\s/)[0]} is not allowed here (the circuit comes from the schematic)`);
      kept.push('*');
      return;
    }
    if (ANALYSIS_CARD.test(line)) cards.push(line);
    kept.push(raw);
  });
  // the parser reads the first line as the title; line numbers stay aligned with the user text
  const parsed = parseSpice(`* user-defined analysis\n${kept.join('\n')}\n.end`);
  for (const e of parsed.errors) errors.push(`line ${Math.max(1, e.line - 1)}: ${e.message}`);
  const warnings = parsed.warnings.map((w) => w.replace(/^line (\d+)/, (_m, n: string) => `line ${Math.max(1, Number(n) - 1)}`));
  const n = parsed.netlist;
  if (n.elements.length) errors.push('element lines are not allowed in a user-defined analysis');
  return {
    analyses: n.analyses,
    cards: n.analyses.map((_a, k) => cards[k] ?? ''),
    options: n.options,
    ic: n.ic,
    nodeset: n.nodeset,
    saves: n.saves,
    measures: (n.measures ?? []).map((m) => (m.line !== undefined ? { ...m, line: Math.max(1, m.line - 1) } : m)),
    warnings,
    errors,
  };
}

/** Netlist with the user cards' options, initial conditions and output requests applied. */
function withControls(base: Netlist, c: UserControls): Netlist {
  return {
    ...base,
    options: { ...base.options, ...c.options },
    ic: { ...base.ic, ...c.ic },
    nodeset: { ...base.nodeset, ...c.nodeset },
    saves: c.saves.length ? [...c.saves] : base.saves,
    analyses: c.analyses,
  };
}

export function runUserAnalysis(spec: UserAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('user');
  const c = parseUserControls(spec.text ?? '');
  if (c.errors.length) throw new SimulationError(`${what}: ${c.errors.join('; ')}`, 'netlist');
  if (!c.analyses.length) throw new SimulationError(`${what}: no analysis card (.op, .dc, .ac, .tran, ...) in the text`, 'netlist');
  const netlist = withControls(ctx.netlist, c);
  // a `.step param` card re-evaluates the netlist before flattening: it needs the same controls
  // applied to the source netlist, or its runs would lose the cards' options and initial conditions
  const sub: AnalysisContext = ctx.source ? { ...childContext(ctx, netlist), source: withControls(ctx.source, c) } : childContext(ctx, netlist);
  const runs: { label: string; result: AnalysisResult }[] = [];
  c.analyses.forEach((a, i) => {
    ctx.checkAbort();
    ctx.progress(i / c.analyses.length, c.cards[i]);
    const result = runSpec(a, sub);
    runs.push({ label: `${i + 1}: ${c.cards[i] || analysisTitle(a.type)}`, result });
  });
  if (c.measures.length) applyMeasurements(runs.map((r) => r.result), { measures: c.measures, params: ctx.netlist.params });
  const failed = runs.filter((r) => r.result.error).map((r) => r.label);
  const warnings = [...c.warnings];
  if (failed.length) warnings.push(`${what}: ${failed.length} of ${runs.length} analyses failed (${failed.join(', ')})`);
  return { type: 'user', title: what, spec, vectors: [], runs, warnings };
}
