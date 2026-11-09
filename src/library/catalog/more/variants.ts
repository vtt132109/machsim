/**
 * Package and second-source variants of catalogue parts (round 4, library breadth).
 *
 * A manufacturer sells one die in several packages and under several order codes: the 74HC00 is
 * a DIP-14 "SN74HC00N", a SOIC-14 "SN74HC00D" and a TSSOP-14 "SN74HC00PW"; the LM358 is
 * a DIP-8, a SOIC-8 and a TSSOP-8; a 7805 comes from five makers in TO-220, DPAK and D2PAK. For a
 * schematic they are the same circuit; for the BOM and the board they are different parts. A
 * *variant* is exactly that: a copy of a base part with its own id, name, footprint, package
 * specification and — when the package changes the pin-out (SOT-23-5 op-amps number their pins
 * differently from DIP-8) — its own pin numbers. The model (`toSpice`), the parameters, the pin
 * names, the symbol and the timing are the base part's, unchanged, so a variant behaves exactly
 * like its base (`LibraryPartDef.variantOf` records the link; the catalogue benches test the base
 * and src/library/catalog/more/more.test.ts checks the sharing for every variant).
 *
 * Order codes follow the public naming conventions of each maker (TI "SN74…N / D / PW", Fairchild
 * "DM74…N / M", Harris "CD74…E / M", ST "HCF…BEY", NXP "HEF…BP", ON "MC14…BCP"). The suffix tables
 * only say which package a code stands for; they do not copy any datasheet text.
 */
import type { LibraryPartDef } from '../../partkit';

/** What makes one variant different from its base part. */
export interface VariantSpec {
  /** full library id ('ttl/sn74ls00n') */
  id: string;
  /** part number / order code ('SN74LS00N') */
  name: string;
  /** footprint name (src/library/footprints.ts) */
  footprint: string;
  /** value of the browser's `package` specification ('DIP-14', 'SOIC-14', 'TSSOP-14') */
  pkg: string;
  /** one English / Vietnamese phrase: what this order code is ("SOIC-14 package, Texas Instruments order code") */
  en: string;
  vi: string;
  /** new pin numbers by pin NAME, when the package numbers the pins differently from the base */
  renumber?: Record<string, string>;
  /** extra search words */
  keywords?: string[];
}

/** The id of a variant: the group of the base plus the slug of the order code. */
export function variantId(base: Pick<LibraryPartDef, 'id'>, name: string): string {
  const group = base.id.slice(0, base.id.indexOf('/'));
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${group}/${slug}`;
}

/** A copy of `base` as another package / order code (same model, parameters, symbol and pin names). */
export function repackage(base: LibraryPartDef, v: VariantSpec): LibraryPartDef {
  const pins = v.renumber ? base.symbol.pins.map((p) => (v.renumber![p.name] !== undefined ? { ...p, number: v.renumber![p.name] } : p)) : base.symbol.pins;
  const baseVi = base.textVi?.description;
  // the Vietnamese text names the base chip in Vietnamese ("LM393 (kép)"), not with the English "(dual)"
  const baseNameVi = (base.textVi?.name ?? base.name).replace('(dual)', '(kép)').replace('(quad)', '(bốn)');
  const out: LibraryPartDef = {
    ...base,
    id: v.id,
    name: v.name,
    description: `${v.name}: ${v.en}. Same circuit as ${base.name}. ${base.description}`,
    symbol: v.renumber ? { ...base.symbol, pins } : base.symbol,
    footprint: v.footprint,
    keywords: [v.name.toLowerCase(), base.name.toLowerCase(), ...(base.keywords ?? []), ...(v.keywords ?? []), 'package variant'],
    provenance: `${base.provenance ?? 'MachSim model'}. ${v.name} is ${v.en} of ${base.name}: the same model; only the order code, package and (where the package differs) the pin numbers change`,
    variantOf: base.id,
    textVi: {
      name: v.name,
      description: `${v.name}: ${v.vi}. Cùng mạch với ${baseNameVi}.${baseVi ? ` ${baseVi}` : ''}`,
    },
  };
  if (base.specs) out.specs = { ...base.specs, package: v.pkg };
  return out;
}
