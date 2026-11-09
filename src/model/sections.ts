/**
 * Multi-section packages (pure): one physical chip whose sections are placed independently.
 *
 * A quad NAND gate is one 14-pin package with four gates. On a schematic the four gates are drawn
 * where they are needed — U1A next to the input, U1D next to the output — and the netlist must
 * still contain exactly **one** 7400. MachSim models this with one library part per section
 * (`ttl/7400-a` … `ttl/7400-d`, built by src/library/catalog/sectionParts.ts) that carries
 * `LibraryPartDef.pkg`:
 *
 *   pkg = { id: 'ttl/7400', section: 'B', sections: ['A','B','C','D'] }
 *
 * The section symbol's pin **names are the package's pin names** ('2A', '2B', '2Y' for section B),
 * so merging the sections of one package gives the package's pin map directly. Sections of one
 * package share their reference designator (all four are "U1"); the editor shows "U1B" and the
 * netlister emits the package once:
 *
 *   packageGroups(parts, opts) the sections placed for each refdes, in placement order
 *   packagePinNodes(group, …) package pin -> node, merged over the placed sections
 *   spareSections(group)      section letters nobody placed (spare-gate report)
 *   sectionIssues(groups)     ERC: a section placed twice, one refdes used for two packages
 *   sectionLabel(refdes, …)   "U1" + "B" -> "U1B"
 *   packageParts(parts, …)    collapse placed sections to one entry per package (BOM / PCB)
 *   packageKey(inst, def)     identity of the package a part belongs to, for the tools that
 *                             (re)assign reference designators — annotate / renumber, paste,
 *                             snippets and find & replace must move the sections of one chip
 *                             together instead of treating the second one as a duplicate
 *
 * The leader of a group is the first placed section that takes part in the simulation: the
 * netlister emits the chip for it. `packageGroups(parts, { active })` tells the module which
 * sections count, so excluding gate A from the simulation (or leaving it out of an assembly
 * variant) hands the chip to gate B instead of removing the whole package.
 *
 * Nothing in the file format changes: a section is an ordinary `PartInstance` whose `partId` is the
 * section part. Older designs keep working because no existing library part has `pkg`.
 */
import { asLibraryPart } from '../library/partkit';
import type { PartDef } from '../library/types';
import type { ErcMessage, PartInstance } from './types';

/** `LibraryPartDef.pkg`: which package and section a part is. */
export interface SectionPackage {
  /** library part id of the whole package (its `toSpice` builds the chip) */
  id: string;
  /** section letter of this part: 'A', 'B', … */
  section: string;
  /** every section letter of the package, in order */
  sections: string[];
}

/** The package info of a part definition, or undefined for an ordinary part. */
export function packageOf(def: PartDef | undefined): SectionPackage | undefined {
  return def ? asLibraryPart(def).pkg : undefined;
}

/** Section letter of section number k (1-based): 1 -> 'A'. */
export function sectionLetter(k: number): string {
  return String.fromCharCode(64 + k);
}

/** Section number of a letter: 'A' -> 1 (0 when the text is not a single letter A…Z). */
export function sectionNumber(letter: string): number {
  const c = letter.trim().toUpperCase();
  return /^[A-Z]$/.test(c) ? c.charCodeAt(0) - 64 : 0;
}

/** Part id of one section of a package: ('ttl/7400', 'B') -> 'ttl/7400-b'. */
export function sectionPartId(packageId: string, section: string): string {
  return `${packageId}-${section.toLowerCase()}`;
}

/** Name shown on the schematic and in reports: "U1" + "B" -> "U1B" (plain refdes without a section). */
export function sectionLabel(refdes: string, section: string | undefined): string {
  return section ? `${refdes}${section}` : refdes;
}

/** One placed section, as the callers of this module describe a part instance. */
export interface PlacedSection<I = PartInstance> {
  inst: I;
  def: PartDef | undefined;
  sheetId?: string;
  /** index in the caller's part list (placement order) */
  index: number;
}

/** The sections of one package placed in a design level. */
export interface PackageGroup<I = PartInstance> {
  /** shared reference designator, as written on the first section */
  refdes: string;
  /** library part id of the package */
  packageId: string;
  /** every section letter the package has */
  sections: string[];
  /** the placed sections, in placement order */
  placed: PlacedSection<I>[];
  /**
   * index of the section that carries the package: the first placed section that takes part
   * (see `packageGroups(parts, { active })`), else the first placed one
   */
  leader: number;
  /** false when no placed section of the group takes part (the whole chip is left out) */
  active: boolean;
}

const refKey = (r: string): string => r.trim().toUpperCase();

/** Options of {@link packageGroups}. */
export interface PackageGroupOptions<I> {
  /**
   * True when a placed section takes part in what the caller is building (the netlister passes
   * `(p) => !p.inst.excludeFromSim`). The leader is the first section for which this holds, so a
   * chip whose gate A is excluded or not fitted is still emitted — by gate B.
   */
  active?: (p: PlacedSection<I>) => boolean;
}

/**
 * Group the placed section parts of one design level by reference designator. Parts without `pkg`
 * are ignored. The group's leader is the first section placed that takes part (`opts.active`,
 * everything by default): the netlister emits the package for it and skips the others.
 */
export function packageGroups<I extends Pick<PartInstance, 'refdes' | 'partId'>>(parts: PlacedSection<I>[], opts: PackageGroupOptions<I> = {}): PackageGroup<I>[] {
  const groups = new Map<string, PackageGroup<I>>();
  const takes = opts.active ?? (() => true);
  for (const p of parts) {
    const pkg = packageOf(p.def);
    if (!pkg) continue;
    const key = `${refKey(p.inst.refdes)}`;
    const on = takes(p);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { refdes: p.inst.refdes, packageId: pkg.id, sections: pkg.sections, placed: [p], leader: p.index, active: on });
      continue;
    }
    g.placed.push(p);
    // an active section always outranks an inactive one; among equals the first placed wins
    if (on && !g.active) {
      g.active = true;
      g.leader = p.index;
    } else if (on === g.active && p.index < g.leader) g.leader = p.index;
  }
  return [...groups.values()];
}

/**
 * Identity of the package a placed part belongs to, for the tools that (re)assign reference
 * designators: every section of one chip answers the same key, an ordinary part answers undefined.
 * The key contains the designator, because that is what makes two sections one package — two 7400
 * sections called U1 and U3 are two chips.
 */
export function packageKey(inst: Pick<PartInstance, 'refdes'>, def: PartDef | undefined): string | undefined {
  const pkg = packageOf(def);
  return pkg ? `${pkg.id}\u0000${refKey(inst.refdes)}` : undefined;
}

/** The group a placed part belongs to, by its index. */
export function groupIndex<I>(groups: PackageGroup<I>[]): Map<number, PackageGroup<I>> {
  const out = new Map<number, PackageGroup<I>>();
  for (const g of groups) for (const p of g.placed) out.set(p.index, g);
  return out;
}

/** Section letters of a package nobody placed (spare gates). */
export function spareSections<I>(group: PackageGroup<I>): string[] {
  const used = new Set(group.placed.map((p) => packageOf(p.def)?.section).filter((s): s is string => !!s));
  return group.sections.filter((s) => !used.has(s));
}

/**
 * Pin map of the whole package: every pin of `packageDef` with the node of the section that carries
 * it. Pins of sections that were not placed (and pins of the package symbol no section carries, such
 * as supply pins nobody wired) get `missing(pin)`, which the netlister answers with a private node.
 */
export function packagePinNodes<I>(
  group: PackageGroup<I>,
  packageDef: PartDef,
  nodeOf: (section: PlacedSection<I>, pin: string) => string | undefined,
  missing: (pin: string) => string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of group.placed) {
    for (const pin of section.def?.symbol.pins ?? []) {
      if (out.has(pin.name)) continue;
      const node = nodeOf(section, pin.name);
      if (node !== undefined) out.set(pin.name, node);
    }
  }
  for (const pin of packageDef.symbol.pins) if (!out.has(pin.name)) out.set(pin.name, missing(pin.name));
  return out;
}

/**
 * ERC findings about the placed sections: the same section placed twice under one refdes, and one
 * refdes used for two different packages. `locate` supplies the message location of a section.
 */
export function sectionIssues<I extends Pick<PartInstance, 'refdes' | 'partId'>>(
  parts: PlacedSection<I>[],
  locate: (p: PlacedSection<I>) => { sheetId?: string; x?: number; y?: number } = () => ({}),
  prefix = '',
): ErcMessage[] {
  const out: ErcMessage[] = [];
  const byRef = new Map<string, PlacedSection<I>[]>();
  for (const p of parts) {
    if (!packageOf(p.def)) continue;
    const k = refKey(p.inst.refdes);
    if (!byRef.has(k)) byRef.set(k, []);
    byRef.get(k)!.push(p);
  }
  for (const list of byRef.values()) {
    const refdes = list[0].inst.refdes;
    const packages = [...new Set(list.map((p) => packageOf(p.def)!.id))];
    if (packages.length > 1) {
      const p = list[list.length - 1];
      out.push({
        severity: 'error',
        code: 'duplicate-refdes',
        message: `${prefix}${refdes} is used by sections of different packages (${packages.join(', ')})`,
        refdes,
        detail: { id: 'sectionPackageConflict', params: { refdes, packages: packages.join(', ') } },
        ...locate(p),
      });
      continue;
    }
    const seen = new Map<string, PlacedSection<I>>();
    for (const p of list) {
      const section = packageOf(p.def)!.section;
      if (seen.has(section)) {
        out.push({
          severity: 'error',
          code: 'duplicate-refdes',
          message: `${prefix}Section ${sectionLabel(refdes, section)} is placed more than once`,
          refdes,
          detail: { id: 'sectionDuplicate', params: { refdes, section, label: sectionLabel(refdes, section) } },
          ...locate(p),
        });
      } else seen.set(section, p);
    }
  }
  return out;
}

/**
 * Collapse placed sections to one entry per package: the first section of each refdes is kept and
 * its definition replaced by the package definition, so the BOM, the PCB netlist and the component
 * reports see one 7400 instead of four gates. Parts without `pkg` pass through unchanged.
 */
export function packageParts<T extends { path: string; def: PartDef }>(parts: T[], lookup: (id: string) => PartDef | undefined): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const pkg = packageOf(p.def);
    if (!pkg) {
      out.push(p);
      continue;
    }
    const key = `${p.path.toUpperCase()}\u0000${pkg.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const def = lookup(pkg.id);
    out.push(def ? { ...p, def } : p);
  }
  return out;
}
