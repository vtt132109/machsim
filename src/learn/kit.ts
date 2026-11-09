/**
 * Building blocks of the lesson definitions: part matchers, check results with feedback, value
 * comparisons and the small layout helpers the reference solutions are drawn with.
 */
import { DesignBuilder, type PartHandle } from '../model/designkit';
import type { AnalysisSpec, AnalysisType } from '../sim/netlist';
import type { Design, Point } from '../model/types';
import { formatEng } from '../util/units';
import type { LessonCircuit, PartMatch, PartRef, SimValues } from './circuit';
import { METER_MATCH, SimFailure } from './circuit';
import { logicIds } from './gates';
import type { CheckResult, FeedbackParam, NounId } from './types';

// ---------------------------------------------------------------------------------------------
// part matchers

export const M = {
  dcSource: { ids: ['sources/dc-voltage'] },
  acSource: { ids: ['sources/ac-voltage'], instruments: ['function-generator'] },
  pulseSource: { ids: ['sources/pulse-voltage', 'sources/clock-voltage'] },
  resistor: { families: ['Resistor'], ids: ['basic/rated-resistor'] },
  capacitor: { families: ['Capacitor'], ids: ['basic/rated-capacitor', 'basic/rated-electrolytic'] },
  ground: { ids: ['sources/ground'] },
  meter: METER_MATCH,
  scope: { instruments: ['oscilloscope', 'oscilloscope-4ch', 'bench-scope'] },
  diode: { families: ['Switching diode', 'Rectifier diode', 'Generic diode', 'Schottky diode'] },
  led: { families: ['LED'], ids: ['basic/rated-led'] },
  zener: { families: ['Zener diode'] },
  npn: { families: ['NPN BJT'], ids: ['basic/rated-npn'] },
  opamp: { families: ['Op-amp'] },
  comparator: { families: ['Comparator', 'Op-amp'] },
  timer: { families: ['Timer'] },
  // the teaching symbol AND every real AND package (7408 in all 74 families, the 4081, and the
  // single-gate sections 7408A … 7408D): a learner who used a real IC built the same circuit
  andGate: { prefixes: ['misc-digital/and'], ids: logicIds('08', ['cmos/4081']) },
  probeLight: { families: ['Probe light', 'Probe'] },
  dff: { ids: ['misc-digital/dff', ...logicIds('74', ['cmos/4013'])] },
  clock: { ids: ['sources/digital-clock', 'sources/clock-voltage', 'sources/pulse-voltage'] },
  counter: { pins: ['CKA', 'CKB', 'QA', 'QB', 'QC', 'QD', 'R01', 'R02'] },
  decoder: { pins: ['A', 'B', 'C', 'D', 'SEGA', 'SEGG', 'LT', 'RBI'] },
  display: { families: ['Seven-segment'] },
  adc: { ids: ['mixed/adc8'] },
  dac: { ids: ['mixed/dac8'] },
  mcu: { families: ['Microcontroller'] },
} satisfies Record<string, PartMatch>;

// ---------------------------------------------------------------------------------------------
// results

export const pass = (id?: string, params?: Record<string, FeedbackParam>): CheckResult => ({ ok: true, note: id ? { id, params } : undefined });
export const fail = (id: string, params?: Record<string, FeedbackParam>): CheckResult => ({ ok: false, note: { id, params } });
export const noun = (n: NounId): FeedbackParam => ({ noun: n });

/** Engineering text of a value with unit ("4.21 V"), 3 significant digits. */
export const fmt = (v: number, unit = '', digits = 3): string => formatEng(v, unit, digits);

/**
 * Absolute error a check accepts around a target of **zero**, when nothing else is given.
 *
 * A percentage of zero is zero, so "the voltage across the closed switch is 0 V", "no current
 * flows in the open branch" and "the balanced bridge reads 0 V" could never pass: a closed switch
 * has an on-resistance, an open branch a 1 TΩ leak and the solver its round-off, so the honest
 * answer is a few nanovolts, not exactly zero. One microvolt / microamp is far above that noise
 * and far below anything a learner could mistake for zero.
 */
export const ZERO_TOLERANCE = 1e-6;

/**
 * |v − target| ≤ tol% of |target|, with `absTol` (or {@link ZERO_TOLERANCE} for a target of
 * exactly zero) as the smallest error that is always accepted.
 */
export function near(v: number, target: number, tolPct: number, absTol = 0): boolean {
  if (!Number.isFinite(v)) return false;
  const band = (Math.abs(target) * tolPct) / 100 + 1e-15;
  const floor = absTol > 0 ? absTol : target === 0 ? ZERO_TOLERANCE : 0;
  return Math.abs(v - target) <= Math.max(band, floor);
}

/** Feedback for a measured value against a target ± tol % (see {@link near} for `absTol`). */
export function measured(v: number, target: number, tolPct: number, unit: string, absTol = 0): CheckResult {
  if (near(v, target, tolPct, absTol)) return pass('okValue', { value: fmt(v, unit) });
  const shown = Number.isFinite(v) ? fmt(v, unit) : '—';
  // around zero the tolerance is an absolute band, so say so instead of "0 V ± 5 %"
  const band = absTol > 0 ? absTol : target === 0 ? ZERO_TOLERANCE : 0;
  if (target === 0 || (band > 0 && band >= (Math.abs(target) * tolPct) / 100)) {
    return fail('measuredAbs', { value: shown, target: fmt(target, unit), band: fmt(band, unit) });
  }
  return fail('measured', { value: shown, target: fmt(target, unit), tol: tolPct });
}

/** Feedback for a measured value against a range. */
export function inRange(v: number, min: number, max: number, unit: string): CheckResult {
  return Number.isFinite(v) && v >= min && v <= max
    ? pass('okValue', { value: fmt(v, unit) })
    : fail('range', { value: Number.isFinite(v) ? fmt(v, unit) : '—', min: fmt(min, unit), max: fmt(max, unit) });
}

/**
 * The meter a step should read when several are placed: the first in `mode` ('v' / 'a') that
 * `placed` accepts, else the first in `mode`, else the first meter (the step then reports the
 * wrong mode or position for that one).
 */
export function pickMeter(c: LessonCircuit, meters: readonly PartRef[], mode: 'v' | 'a', placed?: (m: PartRef) => boolean): PartRef {
  const inMode = meters.filter((m) => c.meterMode(m) === mode);
  return inMode.find((m) => !placed || placed(m)) ?? inMode[0] ?? meters[0];
}

/** The first placed part of a kind, or a "place a …" result. */
export function need(c: LessonCircuit, match: PartMatch, what: NounId, count = 1): PartRef[] | CheckResult {
  const found = c.parts(match);
  if (found.length >= count) return found;
  return count === 1 ? fail('needPart', { part: noun(what) }) : fail('needCount', { part: noun(what), n: count, have: found.length });
}

export const isResult = (x: unknown): x is CheckResult => typeof x === 'object' && x !== null && 'ok' in x && !Array.isArray(x);

/**
 * Run a simulation-based check: ERC errors and engine failures become feedback instead of
 * exceptions (an ERC error such as a missing ground is explained to the learner first).
 */
export async function withSim(c: LessonCircuit, run: () => Promise<CheckResult>): Promise<CheckResult> {
  const erc = c.ercErrors();
  // the panel explains the ERC message (src/i18n/erc.ts explainErc) from its JSON
  if (erc.length) return fail('ercError', { erc: JSON.stringify(erc[0]) });
  try {
    return await run();
  } catch (e) {
    if (e instanceof SimFailure) return fail('simFailed', { message: e.message });
    return fail('simFailed', { message: e instanceof Error ? e.message : String(e) });
  }
}

/** A grounded circuit: some part pin sits on ground through a ground symbol or a "0" label. */
export function hasGround(c: LessonCircuit): boolean {
  return Object.values(c.build.partNets).some((pins) => Object.values(pins).includes('0'));
}

/** The net of `ref` other than `node` for a two-terminal part (undefined when neither / both). */
export function otherNet(c: LessonCircuit, ref: PartRef, node: string): string | undefined {
  const nets = c.pinNets(ref).slice(0, 2);
  if (nets[0] === node && nets[1] !== node) return nets[1];
  if (nets[1] === node && nets[0] !== node) return nets[0];
  return undefined;
}

/** Positive terminal net of a source part ('+' pin, or OUT of digital sources). */
export function plusNet(c: LessonCircuit, ref: PartRef): string | undefined {
  return c.net(ref, '+') ?? c.net(ref, 'OUT');
}

/** Voltage of the first DC source (its value parameter), NaN when there is none. */
export function sourceVolts(c: LessonCircuit, ref: PartRef | undefined): number {
  return ref ? c.num(ref, ref.def.id === 'sources/dc-voltage' ? 'value' : 'v2') : NaN;
}

/** OP values (helper for checks that always need the operating point). */
export const opOf = (c: LessonCircuit): Promise<SimValues> => c.op();

// ---------------------------------------------------------------------------------------------
// reference-solution layout helpers

export const p = (x: number, y: number): Point => ({ x, y });

/** Design builder with the lesson title as design title (sheet names are set by the editor). */
export function builder(title: string): DesignBuilder {
  return new DesignBuilder(title);
}

export function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): Design {
  d.analysis = { active, specs: Object.fromEntries(specs.map((s) => [s.type, s])) };
  return d;
}

/** Wire from pin to pin with one corner (horizontal first). */
export function link(b: DesignBuilder, a: PartHandle, pa: string, c: PartHandle, pc: string): void {
  b.connect(a, pa, c, pc);
}

/** Ground symbol right on a pin (a short vertical wire keeps the drawing readable). */
export function groundAt(b: DesignBuilder, h: PartHandle, pin: string, refdes: string, drop = 20): void {
  const at = b.pin(h, pin);
  b.part('sources/ground', refdes, at.x, at.y + drop);
  if (drop) b.wire(at, p(at.x, at.y + drop));
}
