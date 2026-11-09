/**
 * Logic converter instrument glue (pure): settings, the input stimulus the integration layer
 * applies for "circuit -> truth table", and reading the table back from the per-row results.
 *
 * Param keys (text):
 *   inputs     number of enabled inputs A.. (1..8, default 3)
 *   table      truth table, one char 0 / 1 / X per row (row 0 = all inputs 0, A = MSB)
 *   expr       Boolean expression in A..H (see logic.ts for the syntax)
 *   vhigh      logic-1 level driven onto the inputs (V, default 5)
 *   threshold  output voltage above which OUT reads 1 (V, default 2.5)
 *
 * Circuit -> truth table: the library part emits one DC source `V_<refdes>_<letter>` per
 * connected input (listed in `binding.drives`). `converterRowAssignments` returns, for every
 * row, the DC value of each of those sources. The integration layer runs one operating point
 * per row and passes the results to the panel as `dc` = { runs: [{ label: String(row), result }] }
 * (runs in row order). `tableFromRuns` turns that into a truth-table string.
 */

import type { InstrumentBinding, SignalRef } from '../../model/types';
import type { AnalysisResult } from '../../sim/results';
import { parseUserNumber } from '../../util/units';
import { LOGIC_VARS, MAX_LOGIC_INPUTS, inputBit, normalizeTable } from './logic';
import { resultSignal } from './signals';

export const LOGIC_CONVERTER_DEFAULTS: Record<string, string> = {
  inputs: '3',
  table: '',
  expr: '',
  vhigh: '5',
  threshold: '2.5',
};

export interface LogicConverterSettings {
  inputs: number;
  /** normalised to 2^inputs characters of 0 / 1 / X */
  table: string;
  expr: string;
  vhigh: number;
  threshold: number;
}

export function parseLogicConverterSettings(params: Record<string, string>): LogicConverterSettings {
  const num = (k: string) => {
    const v = parseUserNumber(params[k] ?? '');
    return Number.isFinite(v) ? v : parseUserNumber(LOGIC_CONVERTER_DEFAULTS[k]);
  };
  const inputs = Math.max(1, Math.min(MAX_LOGIC_INPUTS, Math.round(num('inputs'))));
  return {
    inputs,
    table: normalizeTable(params.table ?? '', inputs),
    expr: params.expr ?? '',
    vhigh: num('vhigh'),
    threshold: num('threshold'),
  };
}

/**
 * Input letter -> driving source name, from `binding.drives` (names ending in "_A" .. "_H",
 * case-insensitive). Inputs that are not wired have no source.
 */
export function converterInputSources(binding: Pick<InstrumentBinding, 'drives'>): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const name of binding.drives) {
    const m = /_([a-h])$/i.exec(name);
    if (m) out[m[1].toUpperCase()] = name;
  }
  return out;
}

/** Number of inputs needed to cover every wired input (highest wired letter + 1, 0 if none). */
export function wiredInputCount(binding: Pick<InstrumentBinding, 'drives'>): number {
  const src = converterInputSources(binding);
  let n = 0;
  LOGIC_VARS.forEach((v, i) => {
    if (src[v]) n = i + 1;
  });
  return n;
}

export interface RowAssignment {
  row: number;
  /** source name -> DC volts */
  values: Record<string, number>;
}

/**
 * Stimulus for "circuit -> truth table": one entry per row of an `inputs`-input table. Each
 * wired input source is set to `vhigh` when its bit is 1 in that row, else 0 V.
 */
export function converterRowAssignments(binding: Pick<InstrumentBinding, 'drives'>, inputs: number, vhigh: number): RowAssignment[] {
  const n = Math.max(1, Math.min(MAX_LOGIC_INPUTS, Math.round(inputs)));
  const src = converterInputSources(binding);
  const rows: RowAssignment[] = [];
  for (let row = 0; row < 1 << n; row++) {
    const values: Record<string, number> = {};
    for (let v = 0; v < n; v++) {
      const name = src[LOGIC_VARS[v]];
      if (name) values[name] = inputBit(row, v, n) ? vhigh : 0;
    }
    rows.push({ row, values });
  }
  return rows;
}

/** Final value of a signal in a (single-point or swept) result, NaN when missing. */
function finalValue(result: AnalysisResult, ref: SignalRef): number {
  const s = resultSignal(result, ref);
  if (!s || !s.re.length) return Number.NaN;
  return s.re[s.re.length - 1];
}

/**
 * Truth table from per-row results (`result.runs`, in row order). Rows whose run failed or lacks
 * the output read 'X'. Returns null when the result has no runs.
 */
export function tableFromRuns(result: AnalysisResult, out: SignalRef, threshold: number, rows: number): string | null {
  const runs = result.runs ?? [];
  if (!runs.length) return null;
  let table = '';
  for (let r = 0; r < rows; r++) {
    const run = runs.find((x) => x.label.trim() === String(r)) ?? runs[r];
    if (!run || run.result.error) {
      table += 'X';
      continue;
    }
    const v = finalValue(run.result, out);
    table += Number.isNaN(v) ? 'X' : v > threshold ? '1' : '0';
  }
  return table;
}

/**
 * Re-dimension a truth table from `from` to `to` inputs keeping the meaning of A, B, ...
 * (A stays the MSB). Added inputs are don't-influence (each old row is repeated for every value
 * of the new low-order inputs); removed inputs are fixed at 0.
 */
export function resizeTable(table: string, from: number, to: number): string {
  const a = Math.max(1, Math.min(MAX_LOGIC_INPUTS, Math.round(from)));
  const b = Math.max(1, Math.min(MAX_LOGIC_INPUTS, Math.round(to)));
  const old = normalizeTable(table, a);
  let out = '';
  for (let row = 0; row < 1 << b; row++) out += old[b >= a ? row >> (b - a) : row << (a - b)];
  return out;
}
