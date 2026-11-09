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
import { internalNode, type LibraryPartDef, type ToSpiceContextExt } from './partkit';
import type { PartDef, SpiceFragment, SymbolDef, ToSpiceContext } from './types';

/** One section of a package to turn into a library part (see {@link makeSectionParts}). */
export interface SectionDraft {
  /** section letter: 'A', 'B', … */
  letter: string;
  /** symbol of the section; its pin NAMES are the package's pin names */
  symbol: SymbolDef;
  /** pins of the package this section places on the schematic (its own signals and the shared supply pins) */
  own: string[];
  /** pins that may stay unconnected without a floating-pin warning */
  optionalPins?: string[];
}

/** What one section is, in both languages ("2-input NAND gate" / "cổng NAND 2 ngõ vào"). */
export interface SectionWhat {
  en: string;
  vi: string;
  /** name the sections are called after when it is not the package name ("TL072" for "TL072 (dual)") */
  nameBase?: string;
}

/**
 * The section parts of one package: `<package id>-a`, `<package id>-b` …, named "<package name>A" …
 * Each carries `pkg` (so the netlister, the BOM, annotation, paste and the spare-section report
 * treat the placed sections as one chip) and a `toSpice` that builds the WHOLE package
 * ({@link packageFragment}); the netlister only calls it for the leading section.
 */
export function makeSectionParts(pkg: LibraryPartDef, drafts: SectionDraft[], what: SectionWhat): LibraryPartDef[] {
  const letters = drafts.map((d) => d.letter);
  const last = letters[letters.length - 1];
  const base = what.nameBase ?? pkg.name;
  return drafts.map((d): LibraryPartDef => {
    const section = d.letter;
    return {
      id: `${pkg.id}-${section.toLowerCase()}`,
      name: `${base}${section}`,
      group: pkg.group,
      family: pkg.family,
      description: `${base} section ${section}: one ${what.en} of the ${base} package. Sections of one package share their reference designator (U1A … U1${last}) and are netlisted as a single chip; unplaced sections are listed as spare gates.`,
      prefix: pkg.prefix,
      symbol: d.symbol,
      params: pkg.params,
      toSpice: (ctx) => packageFragment(pkg, ctx, d.own),
      ...(d.optionalPins?.length ? { optionalPins: d.optionalPins } : {}),
      ...(pkg.footprint !== undefined ? { footprint: pkg.footprint } : {}),
      keywords: [...(pkg.keywords ?? []), `${base.toLowerCase()}${section.toLowerCase()}`, 'section'],
      pkg: { id: pkg.id, section, sections: letters },
      textVi: {
        name: `${base}${section}`,
        description: `${base} phần ${section}: một ${what.vi} của vi mạch ${base}. Các phần của cùng một vi mạch dùng chung tên linh kiện (U1A … U1${last}) và chỉ sinh ra một vi mạch trong netlist; phần chưa dùng được báo trong "Cổng còn trống".`,
      },
      ...(pkg.provenance !== undefined ? { provenance: pkg.provenance } : {}),
    };
  });
}

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
    // '2IN+' and '2IN-' must stay two different elements
    name: ctx.name('R', `idle_${pin.replace(/\+/g, 'p').replace(/-/g, 'n').replace(/[^A-Za-z0-9_]/g, '_')}`),
    nodes: [n, '0'],
    value: SECTION_IDLE_SHUNT,
    params: {},
  }));
  return { ...frag, elements: [...frag.elements, ...shunts] };
}
