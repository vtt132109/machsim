/**
 * Design variants (Tools › Variant manager): named builds of one schematic in which some parts are
 * not fitted ("Full", "Basic without the display" …). Pure functions; every edit returns a new
 * Design (or the same object when nothing changes).
 *
 *   activeVariant(design)                  the active variant (Design.variants.active, else the first)
 *   isFitted(inst, variantId)              false when the variant is in PartInstance.notFitted
 *   variantView(design)                    the design as the active variant builds it: not-fitted parts
 *                                          get excludeFromSim + excludeFromBom, so the netlister,
 *                                          simulation, BOM, reports and PCB exports leave them out
 *                                          (memoised per design object)
 *   addVariant / renameVariant / removeVariant / setActiveVariant / setFitted / setFittedWhere
 *   notFittedCount(design, variantId)      parts not fitted in a variant (root and child designs)
 *
 * Parts inside a subcircuit / hierarchical block keep one status for every placed copy of the
 * block; a block instance that is not fitted leaves out its whole contents.
 */
import type { ChildDesign, Design, DesignVariant, DesignVariants, PartInstance, Sheet } from './types';

/** The active variant, or undefined for a design without variants. */
export function activeVariant(design: Pick<Design, 'variants'>): DesignVariant | undefined {
  const v = design.variants;
  if (!v?.list.length) return undefined;
  return v.list.find((x) => x.id === v.active) ?? v.list[0];
}

export function isFitted(inst: Pick<PartInstance, 'notFitted'>, variantId: string | undefined): boolean {
  return !variantId || !inst.notFitted?.includes(variantId);
}

/** True when the part is not fitted in the design's active variant. */
export function notFittedNow(design: Pick<Design, 'variants'>, inst: Pick<PartInstance, 'notFitted'>): boolean {
  const v = activeVariant(design);
  return !!v && !isFitted(inst, v.id);
}

const views = new WeakMap<Design, Design>();

/**
 * The design as its active variant builds it (see the module header). Designs without variants,
 * or whose active variant fits every part, are returned unchanged.
 */
export function variantView(design: Design): Design {
  const v = activeVariant(design);
  if (!v) return design;
  const hit = views.get(design);
  if (hit) return hit;
  const mark = (sheets: Sheet[]): Sheet[] => {
    let changed = false;
    const next = sheets.map((s) => {
      if (!s.parts.some((p) => !isFitted(p, v.id))) return s;
      changed = true;
      return { ...s, parts: s.parts.map((p) => (isFitted(p, v.id) ? p : { ...p, excludeFromSim: true, excludeFromBom: true })) };
    });
    return changed ? next : sheets;
  };
  const sheets = mark(design.sheets);
  let childChanged = false;
  const children = design.children?.map((c): ChildDesign => {
    const s = mark(c.sheets);
    if (s === c.sheets) return c;
    childChanged = true;
    return { ...c, sheets: s };
  });
  const out = sheets === design.sheets && !childChanged ? design : { ...design, sheets, ...(children ? { children } : {}) };
  views.set(design, out);
  return out;
}

function withVariants(design: Design, variants: DesignVariants | undefined): Design {
  const next = { ...design };
  if (variants && variants.list.length) next.variants = variants;
  else delete next.variants;
  return next;
}

/** Apply `fn` to every placed part (root and child designs); unchanged lists keep their identity. */
function mapParts(design: Design, fn: (p: PartInstance, sheet: Sheet) => PartInstance): Design {
  const visit = (sheets: Sheet[]): Sheet[] => {
    let changed = false;
    const out = sheets.map((s) => {
      let local = false;
      const parts = s.parts.map((p) => {
        const q = fn(p, s);
        if (q !== p) local = true;
        return q;
      });
      if (!local) return s;
      changed = true;
      return { ...s, parts };
    });
    return changed ? out : sheets;
  };
  const sheets = visit(design.sheets);
  let childChanged = false;
  const children = design.children?.map((c) => {
    const s = visit(c.sheets);
    if (s === c.sheets) return c;
    childChanged = true;
    return { ...c, sheets: s };
  });
  return sheets !== design.sheets || childChanged ? { ...design, sheets, ...(children ? { children } : {}) } : design;
}

/** A new variant id not used by the design ("v1", "v2" …). */
function newVariantId(design: Pick<Design, 'variants'>): string {
  const used = new Set((design.variants?.list ?? []).map((v) => v.id));
  for (let k = 1; ; k++) if (!used.has(`v${k}`)) return `v${k}`;
}

/** Add a variant (fitted parts = those of `copyFrom`, else every part); returns its id. */
export function addVariant(design: Design, name: string, copyFrom?: string): { design: Design; id: string } {
  const id = newVariantId(design);
  const list = [...(design.variants?.list ?? []), { id, name: name.trim() || id }];
  let next = withVariants(design, { ...(design.variants ?? { list: [] }), list, active: design.variants?.active ?? list[0].id });
  if (copyFrom) next = mapParts(next, (p) => (p.notFitted?.includes(copyFrom) ? { ...p, notFitted: [...p.notFitted, id] } : p));
  return { design: next, id };
}

export function renameVariant(design: Design, id: string, name: string): Design {
  const v = design.variants;
  const n = name.trim();
  if (!v || !n || !v.list.some((x) => x.id === id && x.name !== n)) return design;
  return withVariants(design, { ...v, list: v.list.map((x) => (x.id === id ? { ...x, name: n } : x)) });
}

export function setVariantDescription(design: Design, id: string, description: string): Design {
  const v = design.variants;
  if (!v) return design;
  const d = description.trim();
  return withVariants(design, {
    ...v,
    list: v.list.map((x) => {
      if (x.id !== id) return x;
      const next: DesignVariant = { id: x.id, name: x.name };
      if (d) next.description = d;
      return next;
    }),
  });
}

/** Remove a variant (and its id from every part); removing the last one removes the variants. */
export function removeVariant(design: Design, id: string): Design {
  const v = design.variants;
  if (!v || !v.list.some((x) => x.id === id)) return design;
  const list = v.list.filter((x) => x.id !== id);
  const stripped = mapParts(design, (p) => {
    if (!p.notFitted?.includes(id)) return p;
    const rest = p.notFitted.filter((x) => x !== id);
    const q = { ...p };
    if (rest.length) q.notFitted = rest;
    else delete q.notFitted;
    return q;
  });
  if (!list.length) return withVariants(stripped, undefined);
  return withVariants(stripped, { list, ...(v.active && v.active !== id ? { active: v.active } : { active: list[0].id }) });
}

export function setActiveVariant(design: Design, id: string): Design {
  const v = design.variants;
  if (!v || !v.list.some((x) => x.id === id) || activeVariant(design)?.id === id) return design;
  return withVariants(design, { ...v, active: id });
}

/** Fit (or leave out) the parts `instIds` (any sheet, any level) in variant `variantId`. */
export function setFitted(design: Design, instIds: Iterable<string>, variantId: string, fitted: boolean): Design {
  if (!design.variants?.list.some((x) => x.id === variantId)) return design;
  const ids = new Set(instIds);
  return mapParts(design, (p) => {
    if (!ids.has(p.id)) return p;
    const has = !!p.notFitted?.includes(variantId);
    if (fitted !== has) return p;
    const rest = fitted ? (p.notFitted ?? []).filter((x) => x !== variantId) : [...(p.notFitted ?? []), variantId];
    const q = { ...p };
    if (rest.length) q.notFitted = rest;
    else delete q.notFitted;
    return q;
  });
}

/** Parts not fitted in a variant (every level). */
export function notFittedCount(design: Pick<Design, 'sheets' | 'children'>, variantId: string): number {
  let n = 0;
  for (const s of [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)]) for (const p of s.parts) if (!isFitted(p, variantId)) n += 1;
  return n;
}
