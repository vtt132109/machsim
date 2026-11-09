/**
 * Contacts name their coil by reference designator (src/library/catalog/relays.ts, the `coil`
 * parameter), so renaming a coil must carry its contacts along or the link silently breaks. Two
 * entry points keep the names consistent (pure, no UI):
 *
 *   relinkRenamedCoils(before, after, lookup)   every edit goes through the editor store's commit:
 *                                               a driver (coil, overload relay) whose designator
 *                                               changed (Renumber, Annotate, Find & Replace, the
 *                                               Properties field) takes the contacts of its level
 *                                               that named the old designator
 *   relinkPastedContacts(pasted, source, lookup) a pasted group brings its own coil: contacts that
 *                                               named a coil which was pasted with them name the
 *                                               pasted copy instead of the original
 *
 * A contact only follows drivers of its own design level (the root sheets, or one child design).
 * Both functions return their input unchanged (same object) when there is nothing to do.
 */
import type { PartDef } from '../library/types';
import { asLibraryPart } from '../library/partkit';
import type { Design, PartInstance, Sheet } from './types';

type Lookup = (partId: string) => PartDef | undefined;

const norm = (s: string): string => s.trim().toLowerCase();

const contactParam = (def: PartDef | undefined): string | undefined => {
  const link = def ? asLibraryPart(def).contactLink : undefined;
  return link && link.role === 'contact' ? link.param : undefined;
};

const isDriver = (def: PartDef | undefined): boolean => (def ? asLibraryPart(def).contactLink?.role === 'driver' : false);

/** Apply `renames` (lower-case old designator → new designator) to the contacts of `parts`. */
function renameContacts(parts: PartInstance[], renames: ReadonlyMap<string, string>, lookup: Lookup): PartInstance[] {
  let changed = false;
  const out = parts.map((p) => {
    const key = contactParam(lookup(p.partId));
    if (key === undefined) return p;
    const named = p.params[key];
    const to = named === undefined ? undefined : renames.get(norm(named));
    if (to === undefined || to === named) return p;
    changed = true;
    return { ...p, params: { ...p.params, [key]: to } };
  });
  return changed ? out : parts;
}

function relinkLevel(before: Sheet[], after: Sheet[], lookup: Lookup): Sheet[] {
  if (before === after) return after;
  // only sheets that were edited are compared (an untouched sheet is the same object)
  const was = new Map(before.map((s) => [s.id, s]));
  const old = new Map<string, string>();
  const renames = new Map<string, string>();
  for (const s of after) {
    const b = was.get(s.id);
    if (b === s) continue;
    if (b) for (const p of b.parts) old.set(p.id, p.refdes);
    for (const p of s.parts) {
      const prev = old.get(p.id);
      if (prev === undefined || norm(prev) === norm(p.refdes) || !isDriver(lookup(p.partId))) continue;
      renames.set(norm(prev), p.refdes);
    }
  }
  if (renames.size === 0) return after;
  let changed = false;
  const out = after.map((s) => {
    const parts = renameContacts(s.parts, renames, lookup);
    if (parts === s.parts) return s;
    changed = true;
    return { ...s, parts };
  });
  return changed ? out : after;
}

/** `after` with the contacts of every renamed driver pointing at its new designator. */
export function relinkRenamedCoils(before: Design, after: Design, lookup: Lookup): Design {
  if (before === after) return after;
  const sheets = relinkLevel(before.sheets, after.sheets, lookup);
  let children = after.children;
  if (after.children && before.children) {
    const prev = new Map(before.children.map((c) => [c.id, c]));
    let any = false;
    const next = after.children.map((c) => {
      const b = prev.get(c.id);
      if (!b) return c;
      const s = relinkLevel(b.sheets, c.sheets, lookup);
      if (s === c.sheets) return c;
      any = true;
      return { ...c, sheets: s };
    });
    if (any) children = next;
  }
  return sheets === after.sheets && children === after.children ? after : { ...after, sheets, ...(children ? { children } : {}) };
}

/**
 * Pasted parts (already given their new designators, in the order of `source`) whose contacts name
 * a coil that was pasted together with them: the contact names the new coil.
 */
export function relinkPastedContacts(pasted: PartInstance[], source: readonly PartInstance[], lookup: Lookup): PartInstance[] {
  const renames = new Map<string, string>();
  source.forEach((s, i) => {
    const p = pasted[i];
    if (p && isDriver(lookup(p.partId)) && norm(s.refdes) !== norm(p.refdes)) renames.set(norm(s.refdes), p.refdes);
  });
  return renames.size === 0 ? pasted : renameContacts(pasted, renames, lookup);
}
