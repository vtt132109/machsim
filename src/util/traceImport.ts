/**
 * Measurement files → Grapher traces (Grapher > Import measurement…).
 *
 *   parseMeasurement(text, fileName) -> MeasurementData
 *   measurementResult(data, title)   -> AnalysisResult the Grapher shows as a page
 *
 * Accepted text layouts (one X column, then one column per trace):
 *   - MachSim measurement text (src/util/measurementText.ts, round trip of the Grapher export);
 *   - text with header blocks ending in `***End_of_Header***` (tab-separated measurement text as
 *     written by common data-acquisition software): everything up to the last such line is skipped;
 *   - CSV / TSV / semicolon- or space-separated columns from oscilloscopes, spreadsheets and other
 *     simulators. The separator is the one that splits the data lines into the same number (≥ 2) of
 *     numeric fields; a decimal comma ("1,5") is read when the separator is not a comma. Lines
 *     starting with #, %, * or // are comments; a non-numeric line before the data is the header.
 * The X column is time when its header says so (time, t, thời gian, "[s]", "(s)"), frequency for
 * freq / f / Hz / tần số (plotted on a log axis when every value is positive), otherwise a swept
 * quantity (DC sweep page). Units in headers ("V(out) [V]", "I (mA)", "time (us)") are recognised;
 * a prefixed unit (mV, µs, kHz) scales the values to the base unit.
 */
import type { AnalysisResult, Vector, VectorUnit } from '../sim/results';
import { parseTracesText, type TextTrace } from './measurementText';

export type MeasurementXKind = 'time' | 'frequency' | 'sweep';

export interface MeasurementData {
  title: string;
  xKind: MeasurementXKind;
  xLabel: string;
  xUnit: string;
  traces: TextTrace[];
  /** lines that could not be read (1-based line numbers), at most 20 kept */
  skipped: number[];
}

export class MeasurementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurementError';
  }
}

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
const BASE_UNITS: VectorUnit[] = ['V', 'A', 'W', 's', 'Hz', 'Ohm', 'S', 'dB', 'deg'];

/** Unit text → base unit and multiplier ("mV" → V ×1e-3, "kHz" → Hz ×1e3, "Ω" → Ohm). */
export function unitScale(unit: string): { unit: VectorUnit; factor: number } {
  const u = unit.trim().replace(/^ohms?$/i, 'Ohm').replace(/Ω$/, 'Ohm').replace(/°$/, 'deg').replace(/^sec$/i, 's');
  if ((BASE_UNITS as string[]).includes(u)) return { unit: u as VectorUnit, factor: 1 };
  if (/^dbv?$/i.test(u)) return { unit: 'dB', factor: 1 };
  const p = u[0];
  const rest = u.slice(1);
  if (p in PREFIX && (BASE_UNITS as string[]).includes(rest) && rest !== 'dB') return { unit: rest as VectorUnit, factor: PREFIX[p] };
  return { unit: '', factor: 1 };
}

/** Column header → name and unit text: "V(out) [V]" → V(out), V; "time (us)" → time, us. */
export function splitHeader(h: string): { name: string; unit: string } {
  const t = h.trim().replace(/^"|"$/g, '');
  const m = /^(.*?)\s*[[(]([^\])]{0,8})[\])]\s*$/.exec(t);
  // "V(out)" is a vector name, not a unit: only short unit-like texts count
  if (m && m[1] && (unitScale(m[2]).unit !== '' || /^(u|µ|m|n|k)?s$/i.test(m[2]))) return { name: m[1].trim(), unit: m[2].trim() };
  return { name: t, unit: '' };
}

function xKindOf(name: string, unit: string): MeasurementXKind {
  const n = name.trim().toLowerCase();
  const u = unitScale(unit).unit;
  if (u === 's' || /^(t|time|times|thời gian|thoi gian|x_value|sec|seconds?)$/.test(n) || /time|thời gian/.test(n)) return u === 'Hz' ? 'frequency' : 'time';
  if (u === 'Hz' || /^(f|freq|frequency|tần số|tan so)$/.test(n) || /freq|tần số/.test(n)) return 'frequency';
  return 'sweep';
}

const COMMENT = /^\s*(#|%|\*(?!\*\*End_of_Header)|\/\/)/;

/** Fields of a line for a separator ('ws' = runs of spaces / tabs). */
function fields(line: string, sep: string): string[] {
  const t = line.trim();
  if (sep === 'ws') return t.split(/\s+/);
  return t.split(sep).map((f) => f.trim().replace(/^"|"$/g, ''));
}

function readNumber(s: string, decimalComma: boolean): number {
  const t = s.trim();
  if (!t) return Number.NaN;
  const n = Number(decimalComma ? t.replace(',', '.') : t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Read a measurement file (see the module comment). Throws MeasurementError when it holds no columns of numbers. */
export function parseMeasurement(text: string, fileName = ''): MeasurementData {
  const title = fileName.replace(/\.[^.]+$/, '') || 'measurement';
  if (/^﻿?MachSim measurement text/.test(text)) {
    const r = parseTracesText(text.replace(/^﻿/, ''));
    const x = splitHeader(r.xLabel);
    return { title: r.title || title, xKind: xKindOf(x.name, x.unit), xLabel: x.name, xUnit: unitScale(x.unit).unit, traces: r.traces, skipped: [] };
  }
  let lines = text.replace(/^﻿/, '').split(/\r\n?|\n/);
  const end = lines.map((l) => l.trim()).lastIndexOf('***End_of_Header***');
  let lineOffset = 0;
  if (end >= 0) {
    lineOffset = end + 1;
    lines = lines.slice(end + 1);
  }
  const body = lines.map((l, i) => ({ l, n: i + 1 + lineOffset })).filter((x) => x.l.trim() && !COMMENT.test(x.l));
  if (!body.length) throw new MeasurementError('the file has no data lines');
  // the separator that gives the same field count (≥ 2) on most lines, all numeric
  const candidates = ['\t', ';', ',', 'ws'];
  let best: { sep: string; count: number; comma: boolean; score: number } | null = null;
  for (const sep of candidates) {
    for (const comma of sep === ',' ? [false] : [false, true]) {
      const counts = new Map<number, number>();
      let numericLines = 0;
      for (const { l } of body.slice(0, 200)) {
        const f = fields(l, sep);
        if (f.length < 2) continue;
        if (f.every((x) => Number.isFinite(readNumber(x, comma)))) {
          numericLines++;
          counts.set(f.length, (counts.get(f.length) ?? 0) + 1);
        }
      }
      const [count, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
      const score = n * 10 + count - (comma ? 0.5 : 0);
      if (numericLines && (!best || score > best.score)) best = { sep, count, comma, score };
    }
  }
  if (!best) throw new MeasurementError('no columns of numbers found (expected an X column and at least one value column)');
  const { sep, count, comma } = best;
  // header: the last non-numeric line with `count` fields before the first data line
  let header: string[] | null = null;
  const rows: number[][] = [];
  const skipped: number[] = [];
  for (const { l, n } of body) {
    const f = fields(l, sep);
    const nums = f.map((x) => readNumber(x, comma));
    if (f.length >= 2 && nums.slice(0, count).every((x, i) => Number.isFinite(x) || (i > 0 && f[i] === ''))) {
      if (f.length < count) {
        if (skipped.length < 20) skipped.push(n);
        continue;
      }
      rows.push(nums.slice(0, count));
    } else if (!rows.length && f.length >= count) header = f.slice(0, count);
    else if (skipped.length < 20) skipped.push(n);
  }
  if (!rows.length) throw new MeasurementError('no data rows found');
  const heads = header ?? ['x', ...Array.from({ length: count - 1 }, (_, i) => `y${i + 1}`)];
  const x = splitHeader(heads[0]);
  const xs = unitScale(x.unit);
  const order = rows.map((_, i) => i);
  // samples in ascending x (a file may list them from high to low)
  if (rows.length > 1 && rows[0][0] > rows[rows.length - 1][0]) order.reverse();
  const traces: TextTrace[] = [];
  for (let c = 1; c < count; c++) {
    const h = splitHeader(heads[c] || `y${c}`);
    const us = unitScale(h.unit);
    const tx: number[] = [];
    const ty: number[] = [];
    for (const i of order) {
      const v = rows[i][c];
      if (!Number.isFinite(v)) continue;
      tx.push(rows[i][0] * xs.factor);
      ty.push(v * us.factor);
    }
    if (tx.length) traces.push({ label: h.name || `y${c}`, unit: us.unit || h.unit, x: Float64Array.from(tx), y: Float64Array.from(ty) });
  }
  if (!traces.length) throw new MeasurementError('the value columns are empty');
  return { title, xKind: xKindOf(x.name, x.unit), xLabel: x.name, xUnit: xs.unit || x.unit, traces, skipped };
}

/**
 * The data as an analysis result: 'tran' for time, 'ac' for frequency (real-valued traces), 'dc'
 * for anything else. Traces on different x samples are resampled onto the union of all x values
 * (linear interpolation; NaN outside a trace's own range), so one result holds them all.
 */
export function measurementResult(data: MeasurementData, title: string): AnalysisResult {
  const xs = [...new Set(data.traces.flatMap((t) => Array.from(t.x)))].sort((a, b) => a - b);
  const same = data.traces.every((t) => t.x.length === xs.length && Array.from(t.x).every((v, i) => v === xs[i]));
  const scaleName = data.xKind === 'time' ? 'time' : data.xKind === 'frequency' ? 'frequency' : data.xLabel || 'x';
  const scaleUnit = (data.xKind === 'time' ? 's' : data.xKind === 'frequency' ? 'Hz' : unitScale(data.xUnit).unit) as VectorUnit;
  const scale: Vector = { name: scaleName, unit: scaleUnit, re: Float64Array.from(xs) };
  const vectors: Vector[] = data.traces.map((t) => {
    let y: Float64Array;
    if (same) y = Float64Array.from(t.y);
    else {
      y = new Float64Array(xs.length);
      let j = 0;
      for (let i = 0; i < xs.length; i++) {
        const q = xs[i];
        while (j + 1 < t.x.length && t.x[j + 1] <= q) j++;
        if (q < t.x[0] || q > t.x[t.x.length - 1]) y[i] = Number.NaN;
        else if (t.x[j] === q || j + 1 >= t.x.length) y[i] = t.y[j];
        else y[i] = t.y[j] + ((q - t.x[j]) / (t.x[j + 1] - t.x[j])) * (t.y[j + 1] - t.y[j]);
      }
    }
    return { name: t.label, unit: unitScale(t.unit).unit, re: y };
  });
  const type = data.xKind === 'time' ? 'tran' : data.xKind === 'frequency' ? 'ac' : 'dc';
  return { type, title, scale, vectors, warnings: [] };
}
