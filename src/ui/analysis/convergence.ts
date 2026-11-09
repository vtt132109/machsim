/**
 * Convergence assistant (pure): diagnoses a failed simulation from its error message and proposes
 * fixes, in the order a SPICE user would try them.
 *
 *   classifyFailure(message)          'noconv' | 'singular' | 'timestep' | 'other'
 *   convergenceFixes(kind, options)   Fix[] — option patches (gmin / source stepping, iteration
 *                                     limits, RSHUNT, Gear integration, looser tolerances) and a
 *                                     netlist change (small series resistance in voltage sources
 *                                     and inductors, for loops of ideal sources / inductors)
 *   applyFixToNetlist(netlist, fix)   the netlist a fix is tried on (options merged, series R added)
 *
 * The controller (tryConvergenceFixes) runs the failed analysis once per fix until one succeeds;
 * the dialog shows what was tried and lets the user keep the option changes of the fix that
 * worked. Series resistance cannot be stored as an option, so for that fix the assistant names
 * the parts that need a small resistor on the schematic.
 */
import type { ElementIR, Netlist, SimOptions } from '../../sim/netlist';
import { DEFAULT_OPTIONS } from '../../sim/netlist';

export type FailureKind = 'noconv' | 'singular' | 'timestep' | 'other';

export function classifyFailure(message: string): FailureKind {
  if (/singular/i.test(message)) return 'singular';
  if (/timestep too small/i.test(message)) return 'timestep';
  if (/did not converge|not converg|operating point failed|iteration limit/i.test(message)) return 'noconv';
  return 'other';
}

export type FixId = 'stepping' | 'iterations' | 'rshunt' | 'gear' | 'tolerances' | 'gmin' | 'seriesR' | 'combined';

export interface Fix {
  id: FixId;
  /** option changes (merged over the design's options) */
  options: Partial<SimOptions>;
  /** series resistance added to every independent voltage source and inductor, ohms */
  seriesR?: number;
}

/** Series resistance the assistant inserts, ohms. */
export const ASSIST_SERIES_R = 1e-3;

/**
 * Fixes worth trying for a failure kind, cheapest / least intrusive first, given the current
 * options (a fix that would not change anything is left out). The last one combines them.
 */
export function convergenceFixes(kind: FailureKind, current: Partial<SimOptions> = {}): Fix[] {
  const o = { ...DEFAULT_OPTIONS, ...current };
  const all: Record<FixId, Fix> = {
    stepping: { id: 'stepping', options: { gminSteps: Math.max(o.gminSteps, 50), srcSteps: Math.max(o.srcSteps, 50) } },
    iterations: { id: 'iterations', options: { itl1: Math.max(o.itl1, 500), itl2: Math.max(o.itl2, 200), itl4: Math.max(o.itl4, 50) } },
    rshunt: { id: 'rshunt', options: { rshunt: o.rshunt > 0 ? Math.min(o.rshunt, 1e9) : 1e12 } },
    gear: { id: 'gear', options: { method: 'gear', maxord: 2 } },
    tolerances: { id: 'tolerances', options: { reltol: Math.max(o.reltol, 1e-2), vntol: Math.max(o.vntol, 1e-4), abstol: Math.max(o.abstol, 1e-9), chgtol: Math.max(o.chgtol, 1e-12) } },
    gmin: { id: 'gmin', options: { gmin: Math.max(o.gmin, 1e-9) } },
    seriesR: { id: 'seriesR', options: {}, seriesR: ASSIST_SERIES_R },
    combined: {
      id: 'combined',
      options: {
        gminSteps: Math.max(o.gminSteps, 50),
        srcSteps: Math.max(o.srcSteps, 50),
        itl1: Math.max(o.itl1, 500),
        itl2: Math.max(o.itl2, 200),
        itl4: Math.max(o.itl4, 50),
        rshunt: o.rshunt > 0 ? o.rshunt : 1e12,
        reltol: Math.max(o.reltol, 1e-2),
        vntol: Math.max(o.vntol, 1e-4),
        abstol: Math.max(o.abstol, 1e-9),
        method: 'gear',
      },
      seriesR: ASSIST_SERIES_R,
    },
  };
  const order: Record<FailureKind, FixId[]> = {
    noconv: ['stepping', 'iterations', 'rshunt', 'tolerances', 'gmin', 'seriesR', 'combined'],
    singular: ['rshunt', 'seriesR', 'gmin', 'combined'],
    timestep: ['gear', 'tolerances', 'iterations', 'seriesR', 'rshunt', 'combined'],
    other: ['stepping', 'rshunt', 'gear', 'tolerances', 'combined'],
  };
  return order[kind].map((id) => all[id]).filter((f) => f.seriesR !== undefined || Object.entries(f.options).some(([k, v]) => (o as unknown as Record<string, unknown>)[k] !== v));
}

/** Option values after applying a fix to the design's options (only changed keys are kept). */
export function fixedOptions(current: Partial<SimOptions>, fix: Fix): Partial<SimOptions> {
  return { ...current, ...fix.options };
}

/** Elements a series-resistance fix changes: independent voltage sources and inductors. */
export function seriesTargets(netlist: Netlist): string[] {
  return netlist.elements.filter((e) => e.type === 'V' || e.type === 'L').map((e) => e.name);
}

/**
 * The netlist with a small resistor in series with every independent voltage source and
 * inductor: the element's first node moves to a new internal node `<name>#rs`, joined to the
 * original node by the resistor. Current-sense sources keep their branch current.
 */
export function withSeriesResistance(netlist: Netlist, r: number): Netlist {
  const elements: ElementIR[] = [];
  for (const el of netlist.elements) {
    if ((el.type !== 'V' && el.type !== 'L') || el.nodes.length < 2) {
      elements.push(el);
      continue;
    }
    const mid = `${el.name}#rs`;
    elements.push({ ...el, nodes: [mid, ...el.nodes.slice(1)] });
    elements.push({ type: 'R', name: `R_${el.name}_assist`, nodes: [el.nodes[0], mid], value: r, params: {} });
  }
  return { ...netlist, elements };
}

/** The netlist a fix is tried on. */
export function applyFixToNetlist(netlist: Netlist, fix: Fix): Netlist {
  const n = { ...netlist, options: { ...netlist.options, ...fix.options } };
  return fix.seriesR !== undefined ? withSeriesResistance(n, fix.seriesR) : n;
}

export interface FixAttempt {
  fix: Fix;
  ok: boolean;
  /** first error when it failed */
  error?: string;
}
