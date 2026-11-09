/**
 * Simulation settings the controller applies to a run (pure, light module):
 *
 * - `effectiveSaves(saves, needed)`: the Output tab's variables plus every vector probes,
 *   instruments, indicators and rated parts need, so selecting a few outputs never silences a
 *   probe; an empty selection keeps "everything" (an empty list).
 * - `resolveInteractive(design)`: the interactive session's step, maximum step, initial conditions
 *   and stop time from Design.interactive, or (when absent) from the transient analysis as before
 *   the setting existed.
 * - `zeroInitialState(netlist)`: the netlist for "start from zero": no .ic / .nodeset values and no
 *   capacitor / inductor ic= parameters (used with UIC).
 */
import type { Design, InteractiveSettings } from '../../model/types';
import type { Netlist, TranAnalysis } from '../../sim/netlist';

/** Union of the user's saved outputs and the vectors the design's live parts need. */
export function effectiveSaves(saves: readonly string[] | undefined, needed: readonly string[]): string[] {
  const user = (saves ?? []).map((s) => s.trim()).filter((s) => s.length);
  if (!user.length || user.some((s) => s.toLowerCase() === 'all')) return [];
  const out = new Map<string, string>();
  for (const s of [...user, ...needed]) if (!out.has(s.toLowerCase())) out.set(s.toLowerCase(), s);
  return [...out.values()];
}

export type InitialConditions = NonNullable<InteractiveSettings['initial']>;

export interface ResolvedInteractive {
  tstep: number;
  tmax?: number;
  uic: boolean;
  initial: InitialConditions;
  /** stop automatically at this simulated time (Infinity = until Stop) */
  tstop: number;
  /** true when the values come from Design.interactive (false: derived from the transient spec) */
  explicit: boolean;
}

/** Default output step of interactive sessions without a transient spec, s. */
export const DEFAULT_INTERACTIVE_STEP = 1e-5;

export function resolveInteractive(design: Pick<Design, 'interactive' | 'analysis'>, tran?: TranAnalysis): ResolvedInteractive {
  const spec = tran ?? (design.analysis.specs.tran?.type === 'tran' ? design.analysis.specs.tran : undefined);
  const it = design.interactive;
  if (!it) {
    return { tstep: spec?.tstep ?? DEFAULT_INTERACTIVE_STEP, tmax: spec?.tmax, uic: !!spec?.uic, initial: spec?.uic ? 'uic' : 'op', tstop: Infinity, explicit: false };
  }
  const initial: InitialConditions = it.initial ?? 'auto';
  return {
    tstep: it.tstep ?? spec?.tstep ?? DEFAULT_INTERACTIVE_STEP,
    tmax: it.tmax,
    uic: initial === 'zero' || initial === 'uic',
    initial,
    tstop: it.tstop !== undefined && it.tstop > 0 ? it.tstop : Infinity,
    explicit: true,
  };
}

/** Netlist without initial-condition values: every node and inductor current starts at zero. */
export function zeroInitialState(netlist: Netlist): Netlist {
  return {
    ...netlist,
    ic: {},
    nodeset: {},
    elements: netlist.elements.map((el) => {
      if ((el.type !== 'C' && el.type !== 'L') || el.params.ic === undefined) return el;
      const params = { ...el.params };
      delete params.ic;
      return { ...el, params };
    }),
  };
}
