/**
 * User components inside a design (`Design.customParts`, the design's in-use list).
 *
 *   usedCustomIds(design)                ids of the user components placed anywhere (root + children)
 *   syncCustomParts(design, lookup)      embed the used components that are missing (from `lookup`,
 *                                        normally the part databases) and drop the unused copies;
 *                                        returns the same object when nothing changes
 *   embedCustomPart(design, data)        add or replace one embedded copy
 *   refreshFromDatabase(design, lookup)  replace embedded copies by the database versions
 *                                        ("update components from the database")
 */
import type { Design } from '../../model/types';
import { isCustomPartId, type CustomPartData } from './types';

export type CustomDataLookup = (id: string) => CustomPartData | undefined;

export function usedCustomIds(design: Pick<Design, 'sheets' | 'children'>): Set<string> {
  const out = new Set<string>();
  const visit = (sheets: Design['sheets']) => {
    for (const s of sheets) for (const p of s.parts) if (isCustomPartId(p.partId)) out.add(p.partId);
  };
  visit(design.sheets);
  for (const c of design.children ?? []) visit(c.sheets);
  return out;
}

function withParts(design: Design, parts: CustomPartData[]): Design {
  if (parts.length) return { ...design, customParts: parts };
  const next = { ...design };
  delete next.customParts;
  return next;
}

export function syncCustomParts(design: Design, lookup: CustomDataLookup): Design {
  const used = usedCustomIds(design);
  const current = design.customParts ?? [];
  if (used.size === 0 && current.length === 0) return design;
  const kept = current.filter((c) => used.has(c.id));
  const have = new Set(kept.map((c) => c.id));
  const added: CustomPartData[] = [];
  for (const id of used) {
    if (have.has(id)) continue;
    const data = lookup(id);
    if (data) added.push(data);
  }
  if (added.length === 0 && kept.length === current.length) return design;
  return withParts(design, [...kept, ...added]);
}

export function embedCustomPart(design: Design, data: CustomPartData): Design {
  const current = design.customParts ?? [];
  const i = current.findIndex((c) => c.id === data.id);
  if (i >= 0 && current[i] === data) return design;
  return withParts(design, i < 0 ? [...current, data] : current.map((c, k) => (k === i ? data : c)));
}

/** Replace embedded copies by `lookup`'s versions; lists the ids that changed. */
export function refreshFromDatabase(design: Design, lookup: CustomDataLookup): { design: Design; updated: string[] } {
  const updated: string[] = [];
  const parts = (design.customParts ?? []).map((c) => {
    const fresh = lookup(c.id);
    if (!fresh || JSON.stringify(fresh) === JSON.stringify(c)) return c;
    updated.push(c.id);
    return fresh;
  });
  return { design: updated.length ? { ...design, customParts: parts } : design, updated };
}
