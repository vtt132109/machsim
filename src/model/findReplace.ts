/**
 * Find and replace in a design: reference designators, part values (parameter texts), net label
 * / connector names, bus names and note / comment texts, on every sheet of the root design and
 * of its child designs.
 *
 *   findInDesign(design, query, opts)          -> matches (sheet, item, field, text)
 *   replaceInDesign(design, query, by, opts)   -> { design, count } (input never modified)
 *
 * Matching is a plain substring (case-insensitive unless `matchCase`), or the whole field with
 * `wholeField`. Replacing a refdes keeps it unique within its design level: a replacement that
 * would clash (or is not a valid designator) is skipped and reported in `skipped`. The sections of
 * one multi-section package (src/model/sections.ts) share one designator and are therefore renamed
 * together — renaming only the first one would split the learner's single 7400 into two chips.
 *
 * While the instructor hides part values (Design.restrictions.hideValues) the 'value' field is
 * neither searched nor replaced: listing the matches would show the hidden values.
 */
import { getPart } from '../library';
import { valuesHidden } from './restrictions';
import { packageKey } from './sections';
import type { Design, PartInstance, Sheet } from './types';

export type FindField = 'refdes' | 'value' | 'label' | 'bus' | 'text';

export interface FindOptions {
  fields?: FindField[];
  matchCase?: boolean;
  wholeField?: boolean;
  /** only these sheet ids (default: all sheets of the design and its children) */
  sheets?: string[];
}

export interface FindMatch {
  sheetId: string;
  kind: 'part' | 'label' | 'wire' | 'note';
  id: string;
  field: FindField;
  /** parameter key for field 'value' */
  key?: string;
  text: string;
}

export const ALL_FIND_FIELDS: FindField[] = ['refdes', 'value', 'label', 'bus', 'text'];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null;
  const flags = opts.matchCase ? 'g' : 'gi';
  return new RegExp(opts.wholeField ? `^${escapeRe(query)}$` : escapeRe(query), flags);
}

/** The fields searched in `design`: the requested ones, without 'value' while values are hidden. */
export function searchableFields(design: Pick<Design, 'restrictions'>, opts: Pick<FindOptions, 'fields'> = {}): Set<FindField> {
  const fields = new Set(opts.fields ?? ALL_FIND_FIELDS);
  if (valuesHidden(design)) fields.delete('value');
  return fields;
}

interface Level {
  sheets: Sheet[];
}

function levels(design: Design): Level[] {
  return [{ sheets: design.sheets }, ...(design.children ?? []).map((c) => ({ sheets: c.sheets }))];
}

/** Every match of `query` (see module header). */
export function findInDesign(design: Design, query: string, opts: FindOptions = {}): FindMatch[] {
  const re = matcher(query, opts);
  if (!re) return [];
  const fields = searchableFields(design, opts);
  const only = opts.sheets ? new Set(opts.sheets) : null;
  const test = (s: string) => {
    re.lastIndex = 0;
    return re.test(s);
  };
  const out: FindMatch[] = [];
  for (const lv of levels(design)) {
    for (const sheet of lv.sheets) {
      if (only && !only.has(sheet.id)) continue;
      for (const p of sheet.parts) {
        if (fields.has('refdes') && test(p.refdes)) out.push({ sheetId: sheet.id, kind: 'part', id: p.id, field: 'refdes', text: p.refdes });
        if (fields.has('value')) for (const [k, v] of Object.entries(p.params)) if (test(v)) out.push({ sheetId: sheet.id, kind: 'part', id: p.id, field: 'value', key: k, text: v });
      }
      if (fields.has('label')) for (const l of sheet.labels) if (test(l.name)) out.push({ sheetId: sheet.id, kind: 'label', id: l.id, field: 'label', text: l.name });
      if (fields.has('bus')) for (const w of sheet.wires) if (w.bus && w.busName && test(w.busName)) out.push({ sheetId: sheet.id, kind: 'wire', id: w.id, field: 'bus', text: w.busName });
      if (fields.has('text')) for (const n of sheet.notes) if (test(n.text)) out.push({ sheetId: sheet.id, kind: 'note', id: n.id, field: 'text', text: n.text });
    }
  }
  return out;
}

export interface ReplaceResult {
  design: Design;
  /** number of fields changed */
  count: number;
  /** refdes replacements skipped (clash / invalid), as "old -> new" */
  skipped: string[];
}

const REFDES_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Replace every match (or only `only`, a list of matches from findInDesign) by `by`. `$&` in
 * `by` is NOT special: the replacement is literal.
 */
export function replaceInDesign(design: Design, query: string, by: string, opts: FindOptions = {}, only?: FindMatch[]): ReplaceResult {
  const re = matcher(query, opts);
  if (!re) return { design, count: 0, skipped: [] };
  const fields = searchableFields(design, opts);
  const sheetsFilter = opts.sheets ? new Set(opts.sheets) : null;
  const wanted = only ? new Set(only.map((m) => `${m.kind}\u0000${m.id}\u0000${m.field}\u0000${m.key ?? ''}`)) : null;
  const allowed = (kind: string, id: string, field: FindField, key = '') => !wanted || wanted.has(`${kind}\u0000${id}\u0000${field}\u0000${key}`);
  const sub = (s: string) => {
    re.lastIndex = 0;
    return s.replace(re, () => by);
  };
  let count = 0;
  const skipped: string[] = [];
  /**
   * The new designator of every part of a level whose refdes is replaced (by part instance id).
   * Decided per *package*: the sections of one chip move together, and a clash is judged against
   * the designators the level really uses, counting one package once.
   */
  const refdesPlan = (sheets: Sheet[]): Map<string, string> => {
    const plan = new Map<string, string>();
    if (!fields.has('refdes')) return plan;
    // one entry per designator in use: the sections of a package, or a single part
    const groups: PartInstance[][] = [];
    const byPackage = new Map<string, PartInstance[]>();
    const inScope = new Set<string>();
    for (const sheet of sheets) {
      for (const p of sheet.parts) {
        if (!sheetsFilter || sheetsFilter.has(sheet.id)) inScope.add(p.id);
        const key = packageKey(p, getPart(p.partId));
        const group = key !== undefined ? byPackage.get(key) : undefined;
        if (group) group.push(p);
        else {
          const fresh = [p];
          if (key !== undefined) byPackage.set(key, fresh);
          groups.push(fresh);
        }
      }
    }
    const used = new Set(groups.map((g) => g[0].refdes.toUpperCase()));
    for (const group of groups) {
      const target = group.find((p) => inScope.has(p.id) && allowed('part', p.id, 'refdes'));
      if (!target) continue;
      re.lastIndex = 0;
      if (!re.test(target.refdes)) continue;
      const next = sub(target.refdes);
      if (next === target.refdes) continue;
      if (!REFDES_RE.test(next) || (used.has(next.toUpperCase()) && next.toUpperCase() !== target.refdes.toUpperCase())) {
        skipped.push(`${target.refdes} -> ${next}`);
        continue;
      }
      used.delete(target.refdes.toUpperCase());
      used.add(next.toUpperCase());
      for (const p of group) if (inScope.has(p.id)) plan.set(p.id, next);
    }
    return plan;
  };
  const doSheets = (sheets: Sheet[]): Sheet[] => {
    const plan = refdesPlan(sheets);
    let changed = false;
    const out = sheets.map((sheet) => {
      if (sheetsFilter && !sheetsFilter.has(sheet.id)) return sheet;
      let sc = false;
      const parts = sheet.parts.map((p) => {
        let np = p;
        const planned = plan.get(p.id);
        if (planned !== undefined && planned !== p.refdes) {
          np = { ...np, refdes: planned };
          count++;
        }
        if (fields.has('value')) {
          let params = np.params;
          for (const [k, v] of Object.entries(np.params)) {
            if (!allowed('part', p.id, 'value', k)) continue;
            re.lastIndex = 0;
            if (!re.test(v)) continue;
            const next = sub(v);
            if (next === v) continue;
            if (params === np.params) params = { ...np.params };
            params[k] = next;
            count++;
          }
          if (params !== np.params) np = { ...np, params };
        }
        if (np !== p) sc = true;
        return np;
      });
      const labels = sheet.labels.map((l) => {
        if (!fields.has('label') || !allowed('label', l.id, 'label')) return l;
        re.lastIndex = 0;
        if (!re.test(l.name)) return l;
        const next = sub(l.name).trim();
        if (!next || next === l.name) return l;
        sc = true;
        count++;
        return { ...l, name: next };
      });
      const wires = sheet.wires.map((w) => {
        if (!fields.has('bus') || !w.bus || !w.busName || !allowed('wire', w.id, 'bus')) return w;
        re.lastIndex = 0;
        if (!re.test(w.busName)) return w;
        const next = sub(w.busName).trim();
        if (next === w.busName) return w;
        sc = true;
        count++;
        return { ...w, busName: next };
      });
      const notes = sheet.notes.map((n) => {
        if (!fields.has('text') || !allowed('note', n.id, 'text')) return n;
        re.lastIndex = 0;
        if (!re.test(n.text)) return n;
        const next = sub(n.text);
        if (next === n.text || !next.trim()) return n;
        sc = true;
        count++;
        return { ...n, text: next };
      });
      if (!sc) return sheet;
      changed = true;
      return { ...sheet, parts, labels, wires, notes };
    });
    return changed ? out : sheets;
  };
  let next = design;
  const rootSheets = doSheets(design.sheets);
  if (rootSheets !== design.sheets) next = { ...next, sheets: rootSheets };
  if (design.children?.length) {
    let childChanged = false;
    const children = design.children.map((c) => {
      const s = doSheets(c.sheets);
      if (s === c.sheets) return c;
      childChanged = true;
      return { ...c, sheets: s };
    });
    if (childChanged) next = { ...next, children };
  }
  return { design: next, count, skipped };
}
