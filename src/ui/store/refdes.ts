/**
 * Reference designator helpers (auto-annotation).
 *
 * Refdes are unique within one design level — the root design, or one child design (subcircuit /
 * hierarchical block) — and compared case-insensitively: R1 inside a block is a different part
 * from R1 on the top level (its full name is the instance path, e.g. HB1/R1). New parts receive
 * the lowest free number for their prefix ("R1", "R2", ...). Paste/duplicate re-annotates the
 * same way.
 */
import { findSheet } from '../../model/hierarchy';
import type { Design, Sheet } from '../../model/types';
import type { PartLookup } from './types';
import { t } from '../../i18n';

/** Leading non-digit part of a refdes: "XMM12" -> "XMM", "R3" -> "R", "3" -> "". */
export function refdesPrefix(refdes: string): string {
  const m = /^(.*?)(\d+)$/.exec(refdes.trim());
  return m ? m[1] : refdes.trim();
}

/** Sheets of the design level that holds `sheetId` (the root sheets when omitted or unknown). */
export function levelSheets(design: Design, sheetId?: string): Sheet[] {
  if (sheetId === undefined) return design.sheets;
  const loc = findSheet(design, sheetId);
  return loc?.child ? loc.child.sheets : design.sheets;
}

/** Upper-cased set of every refdes used in a design level (the root unless `sheetId` is a child sheet). */
export function collectRefdes(design: Design, sheetId?: string): Set<string> {
  const used = new Set<string>();
  for (const sheet of levelSheets(design, sheetId)) for (const p of sheet.parts) used.add(p.refdes.toUpperCase());
  return used;
}

/** Sheet id of the part with id `partId` (root or child sheets). */
function sheetOfPart(design: Design, partId: string): string | undefined {
  for (const s of design.sheets) if (s.parts.some((p) => p.id === partId)) return s.id;
  for (const c of design.children ?? []) for (const s of c.sheets) if (s.parts.some((p) => p.id === partId)) return s.id;
  return undefined;
}

/**
 * Lowest free refdes for `prefix` ("R" -> "R1" when unused). The returned value is added to `used`
 * so a caller can assign several designators in a row.
 */
export function nextRefdes(prefix: string, used: Set<string>): string {
  const base = prefix || 'U';
  for (let n = 1; ; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate.toUpperCase())) {
      used.add(candidate.toUpperCase());
      return candidate;
    }
  }
}

/** Prefix for a part id from the library (falls back to "U"). */
export function prefixForPart(partId: string, lookup: PartLookup): string {
  return lookup(partId)?.prefix || 'U';
}

/** True when `refdes` is unused by every part other than `exceptPartId`. */
export function isRefdesFree(design: Design, refdes: string, exceptPartId?: string): boolean {
  const key = refdes.trim().toUpperCase();
  const sheets = levelSheets(design, exceptPartId !== undefined ? sheetOfPart(design, exceptPartId) : undefined);
  for (const sheet of sheets) {
    for (const p of sheet.parts) {
      if (p.id !== exceptPartId && p.refdes.toUpperCase() === key) return false;
    }
  }
  return true;
}

/** Validation message for a user-entered refdes, or null when acceptable. */
export function validateRefdes(design: Design, refdes: string, exceptPartId?: string): string | null {
  const txt = refdes.trim();
  if (!txt) return t('store.refdes.referenceDesignatorCannotBeEmpty');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(txt)) return t('store.refdes.useLettersDigitsAndMust');
  if (!isRefdesFree(design, txt, exceptPartId)) return t('store.refdes.tIsAlreadyUsed', { t: txt });
  return null;
}
