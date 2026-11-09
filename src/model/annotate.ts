/**
 * Reference-designator annotation.
 *
 *   splitRefdes('R12')            -> { prefix: 'R', num: 12 }   ('XMM1' -> 'XMM', 1; 'R?' -> 'R', null)
 *   nextRefdes(design, 'R')       -> smallest unused 'R<n>' (n >= 1, case-insensitive) in the design
 *   annotateDesign(design, opts)  -> new Design with designators assigned
 *       mode 'missing' (default): only parts whose refdes is empty, has no number ('R', 'R?'), or
 *                                 repeats an earlier one get the next free number
 *       mode 'all':               renumber every part from 1 per prefix
 *       order 'position' (default): sheet order, then top-to-bottom, left-to-right (rows of 10 units)
 *       order 'placement':           sheet order, then the order parts were placed
 * The prefix of a part is its library PartDef.prefix (or the letters of its current refdes when
 * the part id is unknown). Power / ground symbols are annotated like any other part. The input
 * design is never modified.
 *
 * Multi-section packages (src/model/sections.ts): the sections of one chip are one package only
 * because they share one designator, so they are annotated as ONE part — U1A and U1B both keep (or
 * both receive) U1. Without that, 'missing' would read the second section as a duplicate designator
 * and 'all' would number it separately, and the learner's single 7400 would become two chips in the
 * netlist and the bill of materials.
 */

import { getPart } from '../library';
import { packageKey } from './sections';
import type { Design, PartInstance } from './types';

export interface RefdesParts {
  prefix: string;
  num: number | null;
}

export function splitRefdes(refdes: string): RefdesParts {
  const t = refdes.trim();
  const m = /^(.*?)(\d+)$/.exec(t);
  if (m && m[1] !== '') return { prefix: m[1], num: Number(m[2]) };
  return { prefix: t.replace(/\?+$/, ''), num: null };
}

function prefixOf(inst: PartInstance): string {
  const def = getPart(inst.partId);
  if (def) return def.prefix;
  const p = splitRefdes(inst.refdes).prefix;
  return p || 'U';
}

function usedNumbers(design: Design, prefix: string, skip?: Set<PartInstance>): Set<number> {
  const used = new Set<number>();
  const pl = prefix.toLowerCase();
  for (const sh of design.sheets) {
    for (const p of sh.parts) {
      if (skip?.has(p)) continue;
      const s = splitRefdes(p.refdes);
      if (s.num !== null && s.prefix.toLowerCase() === pl) used.add(s.num);
    }
  }
  return used;
}

/** Smallest unused designator for a prefix. */
export function nextRefdes(design: Design, prefix: string): string {
  const used = usedNumbers(design, prefix);
  let n = 1;
  while (used.has(n)) n++;
  return `${prefix}${n}`;
}

export interface AnnotateOptions {
  mode?: 'missing' | 'all';
  order?: 'position' | 'placement';
}

export interface AnnotateResult {
  design: Design;
  /** part instance id -> new refdes, for every part whose designator changed */
  changes: Record<string, string>;
}

function ordered(parts: PartInstance[], order: 'position' | 'placement'): PartInstance[] {
  if (order === 'placement') return [...parts];
  return [...parts].sort((a, b) => Math.round(a.y / 10) - Math.round(b.y / 10) || a.x - b.x);
}

/**
 * The parts in annotation order, grouped: every entry is one designator to assign. The sections of
 * one multi-section package form one entry; every other part forms an entry of its own.
 */
function units(sequence: PartInstance[]): PartInstance[][] {
  const out: PartInstance[][] = [];
  const byPackage = new Map<string, PartInstance[]>();
  for (const p of sequence) {
    const key = packageKey(p, getPart(p.partId));
    if (key === undefined) {
      out.push([p]);
      continue;
    }
    const group = byPackage.get(key);
    if (group) group.push(p);
    else {
      const fresh = [p];
      byPackage.set(key, fresh);
      out.push(fresh);
    }
  }
  return out;
}

export function annotateDesign(design: Design, opts: AnnotateOptions = {}): AnnotateResult {
  const mode = opts.mode ?? 'missing';
  const order = opts.order ?? 'position';
  const copy: Design = { ...design, sheets: design.sheets.map((s) => ({ ...s, parts: s.parts.map((p) => ({ ...p })) })) };
  const changes: Record<string, string> = {};
  const sequence: PartInstance[] = copy.sheets.flatMap((s) => ordered(s.parts, order));
  const groups = units(sequence);
  const assign = (group: PartInstance[], ref: string) => {
    for (const p of group) {
      if (ref !== p.refdes) changes[p.id] = ref;
      p.refdes = ref;
    }
  };

  if (mode === 'all') {
    const counters = new Map<string, number>();
    for (const group of groups) {
      const prefix = prefixOf(group[0]);
      const k = prefix.toLowerCase();
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      assign(group, `${prefix}${n}`);
    }
    return { design: copy, changes };
  }

  // 'missing': keep valid, unique designators; renumber the rest with the next free numbers
  const seen = new Set<string>();
  const needs: PartInstance[][] = [];
  for (const group of groups) {
    const s = splitRefdes(group[0].refdes);
    const k = group[0].refdes.trim().toLowerCase();
    if (s.num === null || seen.has(k)) needs.push(group);
    else seen.add(k);
  }
  const pending = new Set(needs.flat());
  const usedByPrefix = new Map<string, Set<number>>();
  for (const group of needs) {
    const prefix = prefixOf(group[0]);
    const k = prefix.toLowerCase();
    let used = usedByPrefix.get(k);
    if (!used) {
      used = usedNumbers(copy, prefix, pending);
      usedByPrefix.set(k, used);
    }
    let n = 1;
    while (used.has(n)) n++;
    used.add(n);
    assign(group, `${prefix}${n}`);
  }
  return { design: copy, changes };
}
