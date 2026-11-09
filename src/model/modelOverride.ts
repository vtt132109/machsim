/**
 * Per-part SPICE model override (PartInstance.modelOverride, set by Tools › Import SPICE model ›
 * "Use for the selected part"): after a part's toSpice ran, the netlister swaps the model of its
 * device elements for the named card.
 *
 * Rules (`applyModelOverride`):
 *   - a `.subckt` replaces the subcircuit of every X element with the same number of nodes as the
 *     subcircuit has ports;
 *   - a `.model` of a device type (D, NPN / PNP, NMOS / PMOS, NJF / PJF, NMF / PMF) replaces the
 *     model of every element of that element type (D, Q, M, J, Z) whose own model has the same type
 *     (an NPN model never replaces a PNP; elements whose own card is not known are replaced too).
 * No matching element -> 'incompatible'; no such card -> 'unknown'. The fragment is left as it was
 * in both cases (the netlister reports an ERC warning and simulates the part's own model).
 */
import type { SpiceFragment } from '../library/types';
import { DEVICE_TERMINALS } from '../library/custom/spiceModels';
import type { ElementIR, ModelCard, SubcktDef } from '../sim/netlist';

export interface OverrideCards {
  model(name: string): ModelCard | undefined;
  subckt(name: string): SubcktDef | undefined;
}

export interface OverrideResult {
  elements: ElementIR[];
  /** number of elements whose model was replaced */
  replaced: number;
  problem?: 'unknown' | 'incompatible';
}

export function applyModelOverride(frag: SpiceFragment, name: string, cards: OverrideCards): OverrideResult {
  const sub = cards.subckt(name);
  const card = sub ? undefined : cards.model(name);
  if (!sub && !card) return { elements: frag.elements, replaced: 0, problem: 'unknown' };
  const own = new Map<string, ModelCard>();
  for (const m of frag.models ?? []) own.set(m.name.toLowerCase(), m);
  let replaced = 0;
  const elements = frag.elements.map((el) => {
    if (sub) {
      if (el.type !== 'X' || el.nodes.length !== sub.ports.length) return el;
      replaced += 1;
      return { ...el, model: sub.name };
    }
    const dev = DEVICE_TERMINALS[card!.type.toUpperCase()];
    if (!dev || el.type !== dev.element || !el.model) return el;
    const mine = own.get(el.model.toLowerCase()) ?? cards.model(el.model);
    if (mine && mine.type.toUpperCase() !== card!.type.toUpperCase()) return el;
    replaced += 1;
    return { ...el, model: card!.name };
  });
  return replaced ? { elements, replaced } : { elements: frag.elements, replaced: 0, problem: 'incompatible' };
}
