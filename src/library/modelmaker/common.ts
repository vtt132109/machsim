/**
 * Shared helpers of the model makers: thermal voltage, SPICE card text, 1-D solvers, bench
 * netlists around the device under test (DUT) and vector look-ups on analysis results.
 */
import { BOLTZ, CHARGE, KELVIN } from '../../sim/device';
import { emptyNetlist, type AnalysisSpec, type ElementIR, type Netlist, type SourceSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { formatSpiceNumber } from '../../sim/spice/numbers';
import { parseModelLibrary, findSubckt, findModelCard, DEVICE_TERMINALS } from '../custom/spiceModels';
import { getPart } from '../index';
import { elementName } from '../partkit';
import { parseUserNumber } from '../../util/units';
import type { MakerField, MakerModel, MakerResult, MakerValues } from './types';
import { MakerInputError } from './types';

/** Thermal voltage at the default circuit temperature (27 °C), with the simulator's constants. */
export const VT = (BOLTZ * (27 + KELVIN)) / CHARGE;

/** Round to `digits` significant digits (what the model text stores). */
export function sig(x: number, digits = 5): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(digits));
}

/** SPICE number text of a value rounded to 5 significant digits. */
export function num(x: number): string {
  return formatSpiceNumber(sig(x));
}

/** `.model NAME TYPE(K=V ...)` with the values rounded as in `num`. */
export function modelCard(name: string, type: string, params: Record<string, number>): string {
  const body = Object.entries(params)
    .filter(([, v]) => Number.isFinite(v))
    .map(([k, v]) => `${k.toUpperCase()}=${num(v)}`)
    .join(' ');
  return `.model ${name} ${type}(${body})`;
}

/** Comment block listing the datasheet values a model was made from. */
export function header(maker: string, fields: readonly MakerField[], values: MakerValues): string {
  const given = fields
    .filter((f) => values[f.key] !== undefined)
    .map((f) => {
      const v = values[f.key]!;
      return `${f.key}=${typeof v === 'number' ? num(v) : v}${f.unit && typeof v === 'number' ? ` ${f.unit}` : ''}`;
    });
  const lines = [`* MachSim model maker (${maker}): fitted from datasheet values`];
  for (let i = 0; i < given.length; i += 6) lines.push(`*   ${given.slice(i, i + 6).join('  ')}`);
  return lines.join('\n');
}

/** Bisection for f(x) = 0 on [lo, hi] (f(lo), f(hi) of opposite sign); `log` bisects in log space. */
export function bisect(f: (x: number) => number, lo: number, hi: number, opts: { log?: boolean; iter?: number; tol?: number } = {}): number | undefined {
  let a = lo;
  let b = hi;
  let fa = f(a);
  const fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return undefined;
  if (fa === 0) return a;
  if (fb === 0) return b;
  const iter = opts.iter ?? 200;
  const tol = opts.tol ?? 1e-12;
  for (let i = 0; i < iter; i++) {
    const m = opts.log ? Math.sqrt(a * b) : (a + b) / 2;
    const fm = f(m);
    if (fm === 0) return m;
    if (fm * fa < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
    if (Math.abs(b - a) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300)) break;
  }
  return opts.log ? Math.sqrt(a * b) : (a + b) / 2;
}

export function need(values: MakerValues, key: string): number {
  const v = values[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MakerInputError('missing', { field: key });
  return v;
}

export function opt(values: MakerValues, key: string): number | undefined {
  const v = values[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function choice(values: MakerValues, key: string, def: string): string {
  const v = values[key];
  return typeof v === 'string' && v ? v : def;
}

// ---------------------------------------------------------------------------------------------
// benches

export const V = (name: string, p: string, n: string, source: SourceSpec): ElementIR => ({ type: 'V', name, nodes: [p, n], params: {}, source });
export const I = (name: string, p: string, n: string, source: SourceSpec): ElementIR => ({ type: 'I', name, nodes: [p, n], params: {}, source });
export const R = (name: string, a: string, b: string, value: number): ElementIR => ({ type: 'R', name, nodes: [a, b], value, params: {} });

/**
 * Elements, models and subcircuits of the DUT with its terminals on `nodes` (model terminal order).
 * 'spice' results are read back from their text, so the bench simulates exactly what is saved.
 */
export function dutNetlist(model: MakerModel, nodes: string[], refdes = 'DUT', params: Record<string, string> = {}): Netlist {
  const nl = emptyNetlist(`model maker bench ${refdes}`);
  if (model.kind === 'spice') {
    const lib = parseModelLibrary(model.text);
    if (lib.errors.length) throw new Error(`model text line ${lib.errors[0].line}: ${lib.errors[0].message}`);
    for (const m of lib.models) nl.models[m.name.toLowerCase()] = m;
    for (const s of lib.subckts) nl.subckts[s.name.toLowerCase()] = s;
    const sub = findSubckt(lib, model.name);
    if (sub) {
      nl.elements.push({ type: 'X', name: `X${refdes}`, nodes, model: sub.name, params: {} });
    } else {
      const card = findModelCard(lib, model.name);
      const dev = card ? DEVICE_TERMINALS[card.type.toUpperCase()] : undefined;
      if (!card || !dev) throw new Error(`model ${model.name} missing`);
      const n = dev.element === 'M' && nodes.length === 3 ? [...nodes, nodes[2]] : nodes;
      nl.elements.push({ type: dev.element, name: `${dev.element}${refdes}`, nodes: n, model: card.name, params: {} });
    }
    return nl;
  }
  const def = getPart(model.partId);
  if (!def?.toSpice) throw new Error(`library part ${model.partId} missing`);
  const pins = def.symbol.pins.map((p) => p.name);
  const merged: Record<string, string> = {};
  for (const p of def.params) merged[p.key] = p.default;
  Object.assign(merged, model.params, params);
  const frag = def.toSpice({
    refdes,
    params: merged,
    node: (pin) => nodes[pins.indexOf(pin)] ?? `${refdes}.nc_${pin}`,
    num: (key) => {
      const x = parseUserNumber(merged[key] ?? '');
      if (!Number.isFinite(x)) throw new Error(`bad value for ${key}`);
      return x;
    },
    name: (type, suffix) => elementName(type, refdes, suffix),
  });
  nl.elements.push(...frag.elements);
  for (const m of frag.models ?? []) nl.models[m.name.toLowerCase()] = m;
  for (const s of frag.subckts ?? []) nl.subckts[s.name.toLowerCase()] = s;
  return nl;
}

/** A complete bench: DUT + extra elements + analyses. */
export function bench(result: MakerResult, nodes: string[], extra: ElementIR[], analyses: AnalysisSpec[], params?: Record<string, string>): Netlist {
  const nl = dutNetlist(result.model, nodes, 'DUT', params);
  nl.elements.push(...extra);
  nl.analyses = analyses;
  return nl;
}

// ---------------------------------------------------------------------------------------------
// result helpers

/** Real samples of a vector (case-insensitive name). Throws when missing or the analysis failed. */
export function vec(results: AnalysisResult[], index: number, name: string): Float64Array {
  const r = results[index];
  if (!r) throw new Error(`analysis ${index} missing`);
  if (r.error) throw new Error(r.error);
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
}

/** Imaginary samples (AC). */
export function vecIm(results: AnalysisResult[], index: number, name: string): Float64Array {
  const r = results[index];
  if (r?.error) throw new Error(r.error);
  const v = r?.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no vector ${name}`);
  return v.im ?? new Float64Array(v.re.length);
}

export function scale(results: AnalysisResult[], index: number): Float64Array {
  const r = results[index];
  if (r?.error) throw new Error(r.error);
  if (!r?.scale) throw new Error('no scale');
  return r.scale.re;
}

export const last = (a: Float64Array): number => a[a.length - 1];

/**
 * x where y(x) first crosses `target` (linear interpolation; `logY` interpolates log|y|, for
 * exponential currents). undefined when y never reaches the target.
 */
export function crossing(xs: ArrayLike<number>, ys: ArrayLike<number>, target: number, logY = false): number | undefined {
  const f = (y: number) => (logY ? Math.log(Math.abs(y) || 1e-300) : y);
  const t = f(target);
  for (let i = 1; i < xs.length; i++) {
    const a = f(ys[i - 1]) - t;
    const b = f(ys[i]) - t;
    if (a === 0) return xs[i - 1];
    if (a * b <= 0 && a !== b) return xs[i - 1] + ((xs[i] - xs[i - 1]) * a) / (a - b);
  }
  return undefined;
}

/** Value of y at x (linear interpolation; xs increasing). */
export function at(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[xs.length - 1];
}
