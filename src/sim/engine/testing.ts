/**
 * Netlist builders for tests and examples: compact constructors for flat IR elements.
 *
 *   const n = netlist([vdc('V1', 'in', '0', 5), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 1e3)],
 *                     [{ type: 'op' }]);
 *
 * Only builds plain data (src/sim/netlist.ts types); nothing here is used by the engine itself.
 */
import { emptyNetlist, type AnalysisSpec, type ElementIR, type ModelCard, type Netlist, type SimOptions, type Waveform } from '../netlist';

export function netlist(
  elements: ElementIR[],
  analyses: AnalysisSpec[] = [],
  extra: { models?: ModelCard[]; options?: Partial<SimOptions>; ic?: Record<string, number>; nodeset?: Record<string, number>; saves?: string[] } = {},
): Netlist {
  const n = emptyNetlist('test');
  n.elements = elements;
  n.analyses = analyses;
  for (const m of extra.models ?? []) n.models[m.name.toLowerCase()] = m;
  n.options = extra.options ?? {};
  n.ic = extra.ic ?? {};
  n.nodeset = extra.nodeset ?? {};
  n.saves = extra.saves ?? [];
  return n;
}

function el(type: ElementIR['type'], name: string, nodes: string[], rest: Partial<ElementIR> = {}): ElementIR {
  return { type, name, nodes, params: {}, ...rest };
}

export const res = (name: string, a: string, b: string, ohms: number, params: Record<string, number> = {}): ElementIR =>
  el('R', name, [a, b], { value: ohms, params });
export const cap = (name: string, a: string, b: string, farads: number, params: Record<string, number> = {}): ElementIR =>
  el('C', name, [a, b], { value: farads, params });
export const ind = (name: string, a: string, b: string, henries: number, params: Record<string, number> = {}): ElementIR =>
  el('L', name, [a, b], { value: henries, params });
export const coupling = (name: string, inductors: string[], k: number): ElementIR => el('K', name, [], { value: k, inductors });

export interface SourceOptions {
  dc?: number;
  acMag?: number;
  acPhase?: number;
  tran?: Waveform;
}

export const vsrc = (name: string, p: string, n: string, s: SourceOptions): ElementIR => el('V', name, [p, n], { source: { ...s } });
export const isrc = (name: string, p: string, n: string, s: SourceOptions): ElementIR => el('I', name, [p, n], { source: { ...s } });
export const vdc = (name: string, p: string, n: string, volts: number): ElementIR => vsrc(name, p, n, { dc: volts });
export const idc = (name: string, p: string, n: string, amps: number): ElementIR => isrc(name, p, n, { dc: amps });

export const vcvs = (name: string, p: string, n: string, cp: string, cn: string, gain: number): ElementIR => el('E', name, [p, n, cp, cn], { value: gain });
export const vccs = (name: string, p: string, n: string, cp: string, cn: string, gm: number): ElementIR => el('G', name, [p, n, cp, cn], { value: gm });
export const cccs = (name: string, p: string, n: string, control: string, gain: number): ElementIR => el('F', name, [p, n], { value: gain, control });
export const ccvs = (name: string, p: string, n: string, control: string, r: number): ElementIR => el('H', name, [p, n], { value: r, control });

export const vswitch = (name: string, p: string, n: string, cp: string, cn: string, model: string, params: Record<string, number> = {}): ElementIR =>
  el('S', name, [p, n, cp, cn], { model, params });
export const iswitch = (name: string, p: string, n: string, control: string, model: string, params: Record<string, number> = {}): ElementIR =>
  el('W', name, [p, n], { model, control, params });

export const tline = (name: string, p1: string, n1: string, p2: string, n2: string, params: Record<string, number>): ElementIR =>
  el('T', name, [p1, n1, p2, n2], { params });

export const model = (name: string, type: string, params: Record<string, number>): ModelCard => ({ name, type, params });

/** Linear interpolation of samples (t[], v[]) at time x. */
export function interpolate(t: ArrayLike<number>, v: ArrayLike<number>, x: number): number {
  const n = t.length;
  if (x <= t[0]) return v[0];
  if (x >= t[n - 1]) return v[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid;
  }
  const dt = t[hi] - t[lo];
  return dt > 0 ? v[lo] + ((v[hi] - v[lo]) * (x - t[lo])) / dt : v[hi];
}
