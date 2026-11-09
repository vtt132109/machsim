/**
 * Building the simulation fragment of a multi-section package (quad gate, dual / quad op-amp).
 *
 * A section part (`LibraryPartDef.pkg`, src/model/sections.ts) is drawn and placed on its own but
 * belongs to one chip. Its `toSpice` therefore does not build a gate: it builds the **whole
 * package** with `packageFragment`, wiring
 *   - the pins of the sections that are placed to their schematic nodes, and
 *   - every other package pin (the gates nobody placed, supply pins nobody wired) to a private node
 *     with a 1 TΩ resistor to ground, exactly as the netlister does for an unconnected pin, so the
 *     matrix stays regular and an unused gate simply sits idle.
 *
 * Which pins count as "placed" depends on who calls:
 *   - the netlister gives the leading section a `ToSpiceContextExt.packagePins(pin)` resolver that
 *     answers for every pin of every placed section of that reference designator, and emits nothing
 *     for the other sections (so the chip appears once in the netlist);
 *   - without that resolver (a lone section, the catalogue test benches) the section's own pins are
 *     used and the rest of the chip is idle.
 */
import type { ElementIR } from '../sim/netlist';
import { internalNode, type ToSpiceContextExt } from './partkit';
import type { PartDef, SpiceFragment, ToSpiceContext } from './types';

/** Resistance from a private node of an unused package pin to ground. */
export const SECTION_IDLE_SHUNT = 1e12;

/**
 * Fragment of the whole package `pkgDef`, with the pins of `ownPins` (or of every placed section,
 * when the netlister supplied `ctx.packagePins`) on their schematic nodes.
 */
export function packageFragment(pkgDef: PartDef, ctx: ToSpiceContext, ownPins: readonly string[]): SpiceFragment {
  if (!pkgDef.toSpice) return { elements: [] };
  const ext = ctx as ToSpiceContextExt;
  const own = new Set(ownPins);
  const resolver = typeof ext.packagePins === 'function' ? ext.packagePins.bind(ext) : undefined;
  const idle = new Map<string, string>();
  const privateNode = (pin: string): string => {
    const have = idle.get(pin);
    if (have !== undefined) return have;
    const node = internalNode(ctx, `nc_${pin.replace(/\+/g, 'p').replace(/-/g, 'n')}`);
    idle.set(pin, node);
    return node;
  };
  const node = (pin: string): string => {
    if (resolver) {
      const n = resolver(pin);
      return n === undefined ? privateNode(pin) : n;
    }
    return own.has(pin) ? ctx.node(pin) : privateNode(pin);
  };
  const inner: ToSpiceContextExt = {
    ...ext,
    node,
    connected: (pin) => {
      if (resolver) return resolver(pin) !== undefined && (ext.connected?.(pin) ?? true);
      return own.has(pin) && (ext.connected?.(pin) ?? true);
    },
  };
  const frag = pkgDef.toSpice(inner);
  if (!idle.size) return frag;
  const shunts: ElementIR[] = [...idle.entries()].map(([pin, n]) => ({
    type: 'R',
    name: ctx.name('R', `idle_${pin.replace(/[^A-Za-z0-9_]/g, '_')}`),
    nodes: [n, '0'],
    value: SECTION_IDLE_SHUNT,
    params: {},
  }));
  return { ...frag, elements: [...frag.elements, ...shunts] };
}
