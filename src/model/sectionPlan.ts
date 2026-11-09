/**
 * Which sections of a multi-section package are taken (pure): the rules behind "place the next
 * section into a package that still has a free one" and the package panel of the Properties tab.
 *
 *   packageUses(sheets, lookup)             every package placed on a design level: its designator,
 *                                           the sections placed and the free ones
 *   joinableRefdes(sheets, def, lookup, o)  the designator a newly placed section joins: the
 *                                           lowest-numbered package of the same chip whose section
 *                                           letter is free (undefined = start a new package)
 *   sectionChoices(use, inst, lookup)       the letters a placed section can move to inside its package
 *   joinTargets(uses, inst, lookup)         the other packages of the same chip a placed section could join
 *
 * Sections of one chip share a reference designator (src/model/sections.ts); a package is "the
 * parts of one design level with that designator and that chip". Nothing here changes a design:
 * src/ui/store/designOps.ts applies the choice (`placePart`, `setSection`, `moveToNewPackage`,
 * `moveToPackage`).
 */
import type { PartDef } from '../library/types';
import { packageOf, sectionPartId } from './sections';
import type { PartInstance, Sheet } from './types';

type Lookup = (partId: string) => PartDef | undefined;

/** One package placed on a design level. */
export interface PackageUse {
  /** shared reference designator, as written on the first section */
  refdes: string;
  /** library part id of the whole package */
  packageId: string;
  /** every section letter of the chip */
  sections: string[];
  /** the placed sections in placement order: letter and part instance id */
  placed: { letter: string; instId: string; sheetId: string }[];
  /** section letters nobody placed */
  free: string[];
}

const keyOf = (refdes: string): string => refdes.trim().toUpperCase();
const numberOf = (refdes: string): number => Number(/\d+$/.exec(refdes)?.[0] ?? 0) || 0;

/** Every package placed on the sheets of one design level, ordered by the number of its designator. */
export function packageUses(sheets: readonly Sheet[], lookup: Lookup): PackageUse[] {
  const map = new Map<string, PackageUse>();
  for (const sheet of sheets) {
    for (const inst of sheet.parts) {
      const pkg = packageOf(lookup(inst.partId));
      if (!pkg) continue;
      const key = `${pkg.id}\u0000${keyOf(inst.refdes)}`;
      let use = map.get(key);
      if (!use) {
        use = { refdes: inst.refdes, packageId: pkg.id, sections: pkg.sections, placed: [], free: [] };
        map.set(key, use);
      }
      use.placed.push({ letter: pkg.section.toUpperCase(), instId: inst.id, sheetId: sheet.id });
    }
  }
  const out = [...map.values()];
  for (const use of out) {
    const taken = new Set(use.placed.map((p) => p.letter));
    use.free = use.sections.filter((s) => !taken.has(s.toUpperCase()));
  }
  return out.sort((a, b) => numberOf(a.refdes) - numberOf(b.refdes) || a.refdes.localeCompare(b.refdes));
}

/** Options of {@link joinableRefdes}. */
export interface JoinOptions {
  /** start a new package even when an existing one has this section free */
  newPackage?: boolean;
}

/**
 * Designator a newly placed section joins: the lowest-numbered package of the same chip on this
 * design level whose section letter is still free. Placing 7400A then 7400B therefore gives both
 * U1. Undefined for an ordinary part, with `newPackage`, or when every placed package already uses
 * that section (then the next free designator starts a new chip).
 */
export function joinableRefdes(sheets: readonly Sheet[], part: PartDef, lookup: Lookup, opts: JoinOptions = {}): string | undefined {
  const pkg = packageOf(part);
  if (!pkg || opts.newPackage) return undefined;
  const letter = pkg.section.toUpperCase();
  return packageUses(sheets, lookup).find((u) => u.packageId === pkg.id && !u.placed.some((p) => p.letter === letter))?.refdes;
}

/** A section a placed part could be changed to. */
export interface SectionChoice {
  letter: string;
  /** library part id of that section */
  partId: string;
  /** this is the part's own section */
  current: boolean;
  /** nobody else in the package uses it */
  free: boolean;
}

/** The sections of the package of `inst`: its own, the free ones, and the taken ones (not selectable). */
export function sectionChoices(use: PackageUse, inst: Pick<PartInstance, 'id'>, lookup: Lookup): SectionChoice[] {
  const own = use.placed.find((p) => p.instId === inst.id)?.letter;
  return use.sections
    .map((letter) => {
      const partId = sectionPartId(use.packageId, letter);
      const taken = use.placed.some((p) => p.letter === letter.toUpperCase() && p.instId !== inst.id);
      return { letter, partId, current: letter.toUpperCase() === own, free: !taken };
    })
    .filter((c) => lookup(c.partId) !== undefined);
}

/** Other packages of the same chip in which the section of `inst` would fit (its letter is free there). */
export function joinTargets(uses: readonly PackageUse[], inst: Pick<PartInstance, 'id' | 'refdes'>, lookup: Lookup, partId: string): PackageUse[] {
  const pkg = packageOf(lookup(partId));
  if (!pkg) return [];
  const letter = pkg.section.toUpperCase();
  return uses.filter((u) => u.packageId === pkg.id && keyOf(u.refdes) !== keyOf(inst.refdes) && !u.placed.some((p) => p.letter === letter));
}
