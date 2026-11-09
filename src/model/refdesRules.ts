/**
 * Reference designator prefix rules (Tools > Reference designator prefixes), pure.
 *
 * A library part has a prefix (R, C, Q, U ...); every placed part is named `<prefix><number>`.
 * Boards and modules that are designed together need their own families of names: board 1 wants
 * U1_1, U1_2 ... for its chips and board 2 wants U2_1 ..., or every part of a power module carries
 * an "A_" in front (A_R1, A_U1). A design therefore stores rules (`Design.refdesRules`):
 *
 *   global : text put in front of every designator             "A_"      R3  ->  A_R3
 *   map    : library prefix -> replacement (upper-case keys)    { U: 'U1_' }   U3 -> U1_3
 *
 * The two combine (`global` first): `{ global: 'A_', map: { U: 'U1_' } }` names a chip "A_U1_3".
 *
 * Rules shape the *next* names (placing, pasting, Annotate, Renumber all) and can be applied to
 * the parts already placed ({@link applyRulesToDesign}), which keeps every number. The netlister
 * and the bill of materials treat a designator as plain text, so a ruled name works there without
 * any special case; this module is the only place that knows how a name is built from a prefix.
 *
 *   effectivePrefix('U', rules)                  'A_U'
 *   libraryPrefixOf('A_U3', rules)               { prefix: 'U', num: 3 }
 *   validateRules(rules, ['R', 'U'])             [] or the problems (readable codes)
 *   applyRulesToDesign(design, rules)            renamed parts, number of changes, collisions
 */
import { childIdOfPart, INNER_SEP } from './hierarchy';
import type { ChildDesign, Design, PartInstance, RefdesRules, Sheet } from './types';

/** Longest text allowed for a rule (a designator has to stay readable on a symbol). */
export const MAX_RULE_TEXT = 12;

export type RuleProblemCode =
  /** characters other than letters, digits and "_", or not starting with a letter / "_" */
  | 'badText'
  /** longer than MAX_RULE_TEXT */
  | 'tooLong'
  /** the resulting prefix ends in a digit, so "U1" + 3 could not be told from "U13" */
  | 'endsInDigit'
  /** two library prefixes would receive the same designator prefix */
  | 'clash';

export interface RuleProblem {
  code: RuleProblemCode;
  /** the library prefix (or "*" for the global text) the problem is about */
  at: string;
  /** the offending text, or the other library prefix of a clash */
  text: string;
}

const RULE_TEXT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True when the rules change at least one designator. */
export function rulesActive(rules: RefdesRules | undefined): boolean {
  return !!rules && (!!rules.global || Object.values(rules.map ?? {}).length > 0);
}

/** Rules without empty entries or entries equal to the library prefix; undefined when nothing is left. */
export function normalizeRules(rules: RefdesRules | undefined): RefdesRules | undefined {
  if (!rules) return undefined;
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(rules.map ?? {})) {
    const key = k.trim().toUpperCase();
    const val = v.trim();
    if (key && val && val !== key) map[key] = val;
  }
  const global = rules.global?.trim() ?? '';
  const out: RefdesRules = {};
  if (global) out.global = global;
  if (Object.keys(map).length) out.map = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  return out.global || out.map ? out : undefined;
}

/** The designator prefix for a library prefix under the rules ("U" -> "A_U"). */
export function effectivePrefix(libraryPrefix: string, rules: RefdesRules | undefined): string {
  const lib = libraryPrefix || 'U';
  if (!rules) return lib;
  const mapped = rules.map?.[lib.toUpperCase()] ?? lib;
  return `${rules.global ?? ''}${mapped}`;
}

/**
 * Split a designator into the library prefix it was built from and its number, undoing the rules:
 * "A_U1_3" under `{ global: 'A_', map: { U: 'U1_' } }` is `{ prefix: 'U', num: 3 }`. A name that
 * does not follow the rules (an older "R3") is read as itself.
 */
export function libraryPrefixOf(refdes: string, rules: RefdesRules | undefined): { prefix: string; num: number | null; ruled: boolean } {
  const text = refdes.trim();
  const m = /^(.*?)(\d+)$/.exec(text);
  const head = m && m[1] !== '' ? m[1] : text.replace(/\?+$/, '');
  const num = m && m[1] !== '' ? Number(m[2]) : null;
  if (!rules) return { prefix: head, num, ruled: false };
  let rest = head;
  const global = rules.global ?? '';
  let ruled = false;
  if (global && rest.toLowerCase().startsWith(global.toLowerCase())) {
    rest = rest.slice(global.length);
    ruled = true;
  } else if (global) return { prefix: head, num, ruled: false };
  // the longest replacement that is a prefix of the rest wins
  const entries = Object.entries(rules.map ?? {}).sort((a, b) => b[1].length - a[1].length);
  for (const [lib, replacement] of entries) {
    if (rest.toLowerCase() === replacement.toLowerCase()) return { prefix: lib, num, ruled: true };
  }
  return { prefix: rest, num, ruled };
}

/** Problems with a set of rules, given the library prefixes of the parts the design uses. */
export function validateRules(rules: RefdesRules | undefined, usedPrefixes: readonly string[] = []): RuleProblem[] {
  const out: RuleProblem[] = [];
  if (!rules) return out;
  const check = (at: string, text: string) => {
    if (!RULE_TEXT.test(text)) out.push({ code: 'badText', at, text });
    else if (text.length > MAX_RULE_TEXT) out.push({ code: 'tooLong', at, text });
  };
  if (rules.global) check('*', rules.global);
  for (const [k, v] of Object.entries(rules.map ?? {})) check(k, v);
  if (out.length) return out;
  // every library prefix that is mapped or used, with the designator prefix it would get
  const libs = new Set<string>([...Object.keys(rules.map ?? {}), ...usedPrefixes.map((p) => p.toUpperCase())]);
  const seen = new Map<string, string>();
  for (const lib of [...libs].sort()) {
    const eff = effectivePrefix(lib, rules);
    if (/\d$/.test(eff)) out.push({ code: 'endsInDigit', at: lib, text: eff });
    const key = eff.toUpperCase();
    const other = seen.get(key);
    if (other !== undefined) out.push({ code: 'clash', at: lib, text: other });
    else seen.set(key, lib);
  }
  return out;
}

/**
 * Prefixes of the parts a design uses (upper-case, without duplicates): the library prefix of each
 * part, plus the letters its designator already carries when those differ (a block copy named
 * "X1" has the library prefix "HB"). Renaming splits the current designator, so a row for the
 * carried letters is what actually renames those parts.
 */
export function usedLibraryPrefixes(design: Design, lookup: (partId: string) => { prefix: string } | undefined, rules: RefdesRules | undefined = design.refdesRules): string[] {
  const out = new Set<string>();
  const visit = (sheets: Sheet[]) => {
    for (const s of sheets) {
      for (const p of s.parts) {
        const split = libraryPrefixOf(p.refdes, rules);
        out.add((lookup(p.partId)?.prefix || split.prefix || 'U').toUpperCase());
        if (split.num !== null && /^[A-Za-z][A-Za-z0-9_]*$/.test(split.prefix)) out.add(split.prefix.toUpperCase());
      }
    }
  };
  visit(design.sheets);
  for (const c of design.children ?? []) visit(c.sheets);
  return [...out].sort();
}

export interface ApplyRulesResult {
  design: Design;
  /** designators that changed */
  changed: number;
  /** designators that would have collided and were kept (the learner renumbers those) */
  skipped: string[];
}

/**
 * `block` with the keys of its `inner` state renamed: a key is a path of designators through the
 * child designs ("R1", or "X2/S1" for a block inside the block), each looked up in its own child.
 */
function renameInnerKeys(block: PartInstance, oldChildren: readonly ChildDesign[], renamed: ReadonlyMap<string, ReadonlyMap<string, string>>): PartInstance {
  const root = childIdOfPart(block.partId);
  if (root === undefined || !block.inner) return block;
  const inner: Record<string, Record<string, string>> = {};
  let changed = false;
  for (const [key, values] of Object.entries(block.inner)) {
    const segments = key.split(INNER_SEP);
    const out: string[] = [];
    let cur: string | undefined = root;
    segments.forEach((seg, i) => {
      const map = cur === undefined ? undefined : renamed.get(cur);
      out.push(map?.get(seg.trim().toUpperCase()) ?? seg);
      if (i === segments.length - 1 || cur === undefined) return;
      // the next level is the child design of the block part this segment names
      const child = oldChildren.find((c) => c.id === cur);
      const nested = child?.sheets.flatMap((s) => s.parts).find((p) => p.refdes.trim().toUpperCase() === seg.trim().toUpperCase());
      cur = nested ? childIdOfPart(nested.partId) : undefined;
    });
    const renamedKey = out.join(INNER_SEP);
    if (renamedKey !== key) changed = true;
    inner[renamedKey] = values;
  }
  return changed ? { ...block, inner } : block;
}

/**
 * Give the design new rules and rename every placed part to follow them, keeping each number
 * ("R3" -> "A_R3", and back again when the rules are removed). Sections of one multi-section
 * package keep sharing one designator. A name that would collide with another part's keeps its
 * old name and is reported in `skipped`. The same object comes back when nothing changes.
 */
export function applyRulesToDesign(design: Design, nextRules: RefdesRules | undefined): ApplyRulesResult {
  const oldRules = design.refdesRules;
  const rules = normalizeRules(nextRules);
  let changed = 0;
  const skipped: string[] = [];
  /** child design id -> (old designator, upper case) -> new designator, for the per-copy state below */
  const renamedIn = new Map<string, Map<string, string>>();
  const renameLevel = (sheets: Sheet[], childId?: string): Sheet[] => {
    const parts = sheets.flatMap((s) => s.parts);
    const fresh = new Map<string, string>();
    const taken = new Set(parts.map((p) => p.refdes.trim().toUpperCase()));
    const target = (p: PartInstance): string => {
      // the letters the name already has (under the old rules) are the library prefix; a name
      // the learner typed by hand ("Rload1") keeps its own letters
      const split = libraryPrefixOf(p.refdes, oldRules);
      return split.num === null ? p.refdes : `${effectivePrefix(split.prefix, rules)}${split.num}`;
    };
    // decide the new names per designator (sections share one)
    const byOld = new Map<string, string>();
    const original = new Map<string, string>();
    for (const p of parts) {
      const key = p.refdes.trim().toUpperCase();
      if (byOld.has(key)) continue;
      original.set(key, p.refdes);
      byOld.set(key, target(p));
    }
    // collisions: two different old names mapping to the same new one, or onto an untouched name
    const claimed = new Map<string, string>();
    for (const [old, want] of byOld) {
      const w = want.toUpperCase();
      const owner = claimed.get(w);
      const occupiedByOther = w !== old && taken.has(w) && !byOld.has(w);
      if ((owner !== undefined && owner !== old) || occupiedByOther) {
        skipped.push(original.get(old) ?? old);
        claimed.set(old, old);
        fresh.set(old, old);
        continue;
      }
      claimed.set(w, old);
      fresh.set(old, want);
    }
    if (childId !== undefined) renamedIn.set(childId, fresh);
    return sheets.map((s) => {
      let touched = false;
      const next = s.parts.map((p) => {
        const to = fresh.get(p.refdes.trim().toUpperCase());
        if (to === undefined || to === p.refdes) return p;
        touched = true;
        changed += 1;
        return { ...p, refdes: to };
      });
      return touched ? { ...s, parts: next } : s;
    });
  };
  const sheets = renameLevel(design.sheets);
  let children = design.children;
  if (children?.length) {
    const mapped = children.map((c) => {
      const cs = renameLevel(c.sheets, c.id);
      return cs.every((s, i) => s === c.sheets[i]) ? c : { ...c, sheets: cs };
    });
    if (mapped.some((c, i) => c !== children![i])) children = mapped;
  }
  // the state of each placed copy of a block is keyed by the designators INSIDE the child design
  // (PartInstance.inner): they follow the rename, or every copy would silently fall back to the
  // block's shared values
  const followInner = (list: Sheet[]): Sheet[] =>
    list.map((s) => {
      if (!s.parts.some((p) => p.inner)) return s;
      return { ...s, parts: s.parts.map((p) => (p.inner ? renameInnerKeys(p, design.children ?? [], renamedIn) : p)) };
    });
  const sheetsKept = children !== design.children ? followInner(sheets) : sheets;
  const same = sheetsKept.every((s, i) => s === design.sheets[i]) && children === design.children;
  const stored = JSON.stringify(rules ?? null) === JSON.stringify(oldRules ?? null);
  if (same && stored) return { design, changed: 0, skipped };
  const next: Design = { ...design, sheets: sheetsKept, ...(children ? { children } : {}) };
  if (rules) next.refdesRules = rules;
  else delete next.refdesRules;
  return { design: next, changed, skipped };
}
