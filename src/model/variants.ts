/**
 * Design variants (Tools › Variant manager): named builds of one schematic in which some parts are
 * not fitted ("Full", "Basic without the display" …) or have other values ("1 kΩ" in the cheap
 * build, "4.7 kΩ" in the precise one). Pure functions; every edit returns a new Design (or the
 * same object when nothing changes).
 *
 *   activeVariant(design)                  the active variant (Design.variants.active, else the first)
 *   isFitted(inst, variantId)              false when the variant is in PartInstance.notFitted
 *   variantView(design)                    the design as the active variant builds it: not-fitted parts
 *                                          get excludeFromSim + excludeFromBom, fitted parts get the
 *                                          variant's parameter values and BOM fields
 *                                          (PartInstance.variantValues) and the design gets the
 *                                          variant's global parameters (DesignVariant.variables), so
 *                                          the netlister, simulation, BOM, reports and PCB exports
 *                                          all see the build (memoised per design object)
 *   effectiveInstance(inst, variantId)     one part with a variant's values applied (same object when
 *                                          it has none): the canvas labels use it
 *   addVariant / renameVariant / removeVariant / setActiveVariant / setFitted / setFittedWhere
 *   setVariantParam / setVariantField / clearVariantValues / setVariantVariable   per-variant values
 *   variantChanges(design, variantId)      what a variant changes against the saved design
 *   notFittedCount(design, variantId)      parts not fitted in a variant (root and child designs)
 *
 * Parts inside a subcircuit / hierarchical block keep one status for every placed copy of the
 * block; a block instance that is not fitted leaves out its whole contents.
 *
 * Format: `variantValues` and `DesignVariant.variables` are optional fields added to format
 * version 2. A file written before them has neither, loads unchanged and means "same values in
 * every variant", which is exactly what it always did (no version bump needed; see serialize.ts).
 */
import type { ChildDesign, Design, DesignVariant, DesignVariants, PartFields, PartInstance, Sheet, VariantValues } from './types';

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

/** Values of a part in a variant, or undefined when it has none. */
export function variantValuesOf(inst: Pick<PartInstance, 'variantValues'>, variantId: string | undefined): VariantValues | undefined {
  if (!variantId) return undefined;
  const vv = inst.variantValues?.[variantId];
  if (!vv) return undefined;
  const hasParams = !!vv.params && Object.keys(vv.params).length > 0;
  const hasFields = !!vv.fields && Object.keys(vv.fields).length > 0;
  return hasParams || hasFields ? vv : undefined;
}

/**
 * The part as a variant builds it: the variant's parameter values and BOM fields laid over the
 * saved ones. Returns `inst` itself when the variant changes nothing for it (so memoised canvas
 * glyphs keep their identity).
 */
export function effectiveInstance(inst: PartInstance, variantId: string | undefined): PartInstance {
  const vv = variantValuesOf(inst, variantId);
  if (!vv) return inst;
  const out: PartInstance = { ...inst };
  if (vv.params && Object.keys(vv.params).length) out.params = { ...inst.params, ...vv.params };
  if (vv.fields && Object.keys(vv.fields).length) out.fields = { ...inst.fields, ...vv.fields };
  return out;
}

/** The global parameters as a variant builds them (the saved ones with the variant's expressions on top). */
export function effectiveVariables(design: Pick<Design, 'variables' | 'variants'>, variantId?: string): Record<string, string> {
  const v = variantId === undefined ? activeVariant(design) : design.variants?.list.find((x) => x.id === variantId);
  return v?.variables && Object.keys(v.variables).length ? { ...design.variables, ...v.variables } : design.variables;
}

/**
 * The part with the variant "baked in": its values and BOM fields are the variant's, every variant
 * mark is gone, and a part the variant does not fit becomes excludeFromSim + excludeFromBom. Used by
 * snippets that are saved "as the active variant builds them".
 */
export function bakeVariant(inst: PartInstance, variantId: string): PartInstance {
  const fitted = isFitted(inst, variantId);
  const q = effectiveInstance(inst, variantId);
  const out: PartInstance = q === inst ? { ...inst } : q;
  delete out.variantValues;
  delete out.notFitted;
  if (!fitted) {
    out.excludeFromSim = true;
    out.excludeFromBom = true;
  }
  return out;
}

/** True when some part in the list has anything variant-specific (not fitted somewhere, or other values). */
export function hasVariantData(parts: Iterable<PartInstance>): boolean {
  for (const p of parts) if (p.notFitted?.length || (p.variantValues && Object.keys(p.variantValues).length)) return true;
  return false;
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
  const touched = (p: PartInstance) => !isFitted(p, v.id) || !!variantValuesOf(p, v.id);
  const build = (p: PartInstance): PartInstance => {
    const e = effectiveInstance(p, v.id);
    return isFitted(p, v.id) ? e : { ...e, excludeFromSim: true, excludeFromBom: true };
  };
  const mark = (sheets: Sheet[]): Sheet[] => {
    let changed = false;
    const next = sheets.map((s) => {
      if (!s.parts.some(touched)) return s;
      changed = true;
      return { ...s, parts: s.parts.map((p) => (touched(p) ? build(p) : p)) };
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
  const variables = v.variables && Object.keys(v.variables).length ? { ...design.variables, ...v.variables } : design.variables;
  const out = sheets === design.sheets && !childChanged && variables === design.variables ? design : { ...design, sheets, variables, ...(children ? { children } : {}) };
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
  const source = copyFrom ? design.variants?.list.find((x) => x.id === copyFrom) : undefined;
  if (source?.variables && Object.keys(source.variables).length) list[list.length - 1] = { ...list[list.length - 1], variables: { ...source.variables } };
  let next = withVariants(design, { ...(design.variants ?? { list: [] }), list, active: design.variants?.active ?? list[0].id });
  if (copyFrom) {
    next = mapParts(next, (p) => {
      let q = p;
      if (p.notFitted?.includes(copyFrom)) q = { ...q, notFitted: [...(q.notFitted ?? []), id] };
      const vv = p.variantValues?.[copyFrom];
      if (vv) q = { ...q, variantValues: { ...q.variantValues, [id]: cloneValues(vv) } };
      return q;
    });
  }
  return { design: next, id };
}

function cloneValues(v: VariantValues): VariantValues {
  const out: VariantValues = {};
  if (v.params) out.params = { ...v.params };
  if (v.fields) out.fields = { ...v.fields };
  return out;
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
      if (x.variables) next.variables = x.variables;
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
    if (!p.notFitted?.includes(id) && !p.variantValues?.[id]) return p;
    const q = { ...p };
    if (p.notFitted?.includes(id)) {
      const rest = p.notFitted.filter((x) => x !== id);
      if (rest.length) q.notFitted = rest;
      else delete q.notFitted;
    }
    if (p.variantValues?.[id]) {
      const { [id]: _gone, ...rest } = p.variantValues;
      if (Object.keys(rest).length) q.variantValues = rest;
      else delete q.variantValues;
    }
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

// ---------------------------------------------------------------------------------------------
// Per-variant values

/** Store `vv` as the values of `inst` in a variant (an empty entry removes the variant's key). */
function withValues(inst: PartInstance, variantId: string, vv: VariantValues): PartInstance {
  const q = { ...inst };
  const clean: VariantValues = {};
  if (vv.params && Object.keys(vv.params).length) clean.params = vv.params;
  if (vv.fields && Object.keys(vv.fields).length) clean.fields = vv.fields;
  const all = { ...inst.variantValues };
  if (clean.params || clean.fields) all[variantId] = clean;
  else delete all[variantId];
  if (Object.keys(all).length) q.variantValues = all;
  else delete q.variantValues;
  return q;
}

/**
 * Give a part another parameter value in a variant. `value` undefined, empty, or equal to the saved
 * value removes the variant's value (the part follows the saved one again). No-op for unknown
 * variants or parts.
 */
export function setVariantParam(design: Design, instId: string, variantId: string, key: string, value: string | undefined): Design {
  if (!design.variants?.list.some((x) => x.id === variantId)) return design;
  return mapParts(design, (p) => {
    if (p.id !== instId) return p;
    const cur = p.variantValues?.[variantId];
    const params = { ...cur?.params };
    const v = value?.trim();
    const same = v === undefined || v === '' || v === (p.params[key] ?? undefined);
    if (same ? !(key in params) : params[key] === v) return p;
    if (same) delete params[key];
    else params[key] = v;
    return withValues(p, variantId, { ...cur, params });
  });
}

/** Give a part another BOM / PCB field (manufacturer, part number, supplier, footprint) in a variant. */
export function setVariantField(design: Design, instId: string, variantId: string, field: keyof PartFields, value: string | undefined): Design {
  if (!design.variants?.list.some((x) => x.id === variantId)) return design;
  return mapParts(design, (p) => {
    if (p.id !== instId) return p;
    const cur = p.variantValues?.[variantId];
    const fields: PartFields = { ...cur?.fields };
    const v = value?.trim();
    const same = v === undefined || v === '' || v === p.fields?.[field];
    if (same ? fields[field] === undefined : fields[field] === v) return p;
    if (same) delete fields[field];
    else fields[field] = v;
    return withValues(p, variantId, { ...cur, fields });
  });
}

/** Remove every value the parts `instIds` have in a variant. */
export function clearVariantValues(design: Design, instIds: Iterable<string>, variantId: string): Design {
  const ids = new Set(instIds);
  return mapParts(design, (p) => (ids.has(p.id) && p.variantValues?.[variantId] ? withValues(p, variantId, {}) : p));
}

/** Give a global parameter another expression in a variant (undefined / empty / equal to the saved one removes it). */
export function setVariantVariable(design: Design, variantId: string, name: string, expr: string | undefined): Design {
  const v = design.variants;
  const n = name.trim();
  if (!v || !n || !v.list.some((x) => x.id === variantId)) return design;
  const e = expr?.trim();
  return withVariants(design, {
    ...v,
    list: v.list.map((x) => {
      if (x.id !== variantId) return x;
      const vars = { ...x.variables };
      if (e === undefined || e === '' || e === design.variables[n]) delete vars[n];
      else vars[n] = e;
      const next: DesignVariant = { id: x.id, name: x.name };
      if (x.description !== undefined) next.description = x.description;
      if (Object.keys(vars).length) next.variables = vars;
      return next;
    }),
  });
}

/** One difference a variant makes against the saved design. */
export interface VariantChange {
  kind: 'notFitted' | 'param' | 'field' | 'variable';
  /** reference designator path (empty for a global parameter) */
  path: string;
  /** parameter key, field name or variable name (empty for notFitted) */
  key: string;
  /** saved value */
  from: string;
  /** value in the variant */
  to: string;
}

/** Everything a variant changes against the saved design, in part order (every level). */
export function variantChanges(design: Pick<Design, 'sheets' | 'children' | 'variants' | 'variables'>, variantId: string): VariantChange[] {
  const out: VariantChange[] = [];
  const visit = (sheets: Sheet[], prefix: string) => {
    for (const s of sheets) {
      for (const p of s.parts) {
        const path = `${prefix}${p.refdes}`;
        if (!isFitted(p, variantId)) out.push({ kind: 'notFitted', path, key: '', from: '', to: '' });
        const vv = p.variantValues?.[variantId];
        for (const [key, to] of Object.entries(vv?.params ?? {})) out.push({ kind: 'param', path, key, from: p.params[key] ?? '', to });
        for (const [key, to] of Object.entries(vv?.fields ?? {})) out.push({ kind: 'field', path, key, from: p.fields?.[key as keyof PartFields] ?? '', to: to ?? '' });
      }
    }
  };
  visit(design.sheets, '');
  for (const c of design.children ?? []) visit(c.sheets, `${c.name}/`);
  const v = design.variants?.list.find((x) => x.id === variantId);
  for (const [key, to] of Object.entries(v?.variables ?? {})) out.push({ kind: 'variable', path: '', key, from: design.variables[key] ?? '', to });
  return out;
}

/** Parts not fitted in a variant (every level). */
export function notFittedCount(design: Pick<Design, 'sheets' | 'children'>, variantId: string): number {
  let n = 0;
  for (const s of [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)]) for (const p of s.parts) if (!isFitted(p, variantId)) n += 1;
  return n;
}
