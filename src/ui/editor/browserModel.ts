/**
 * Component browser model (pure): the group → family → part tree built generically from the
 * library catalogue, catalogue search with ranking, parametric (specification) filters per family,
 * the flattened list of visible tree rows, the window of rows a virtualised list renders and
 * keyboard navigation of that list (WAI-ARIA tree pattern).
 *
 * Row keys: groups "g:<groupId>", families "f:<groupId>/<family>", parts "p:<partId>".
 *
 * Scale (the browser must never freeze, even with tens of thousands of parts in one family):
 *  - search works on a per-part index (lower-case fields, the accent-folded Vietnamese text and one
 *    folded "haystack" for a quick reject, computed once per part); results are sorted on integer
 *    keys first and by the collator only inside runs of equal keys;
 *  - `createSearchJob` runs the same search in time slices (incremental search: partial results
 *    after the first slice, the index built along the way), so the UI stays responsive;
 *  - `buildBrowserTree` is one O(n) pass; a family's parts are sorted the first time they are
 *    needed (`FamilyNode.parts` is lazy, `FamilyNode.size` needs no sort);
 *  - the list is virtualised: `treeRowModel` / `listRowModel` know the row count from the groups and
 *    families alone and create row objects only for the window in view (`virtualWindow`), so the
 *    cost of a render does not grow with the number of parts.
 */
import type { GroupDef, PartDef } from '../../library/types';
import { familyNameVi, partNameVi, searchSynonymsVi, searchText } from '../../i18n/library';
import { getLang } from '../../i18n/core';
import { SPEC_DEFS, isSpecKey, partSpecs } from '../../library/specs';
import { setPartSearcher } from '../../library';
import { isPlainUserNumber, parseUserNumber, parseUserNumberParts } from '../../util/units';

/** Lower-case text without Vietnamese diacritics (đ → d) for accent-insensitive search. */
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export interface FamilyNode {
  key: string;
  name: string;
  /** the family's parts in browser order (sorted on first access) */
  readonly parts: PartDef[];
  /** number of parts (no sort needed) */
  size: number;
}

export interface GroupNode {
  key: string;
  group: GroupDef;
  families: FamilyNode[];
  /** number of parts in the group */
  count: number;
  /** parts of catalogue packs not loaded yet (they join the group when it is opened) */
  pending?: number;
}

export type BrowserRow =
  | { kind: 'group'; key: string; level: 1; node: GroupNode; expanded: boolean }
  | { kind: 'family'; key: string; level: 2; node: FamilyNode; parentKey: string; expanded: boolean; shown: number }
  | { kind: 'part'; key: string; level: 1 | 3; part: PartDef; parentKey: string | null };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const sortKeyOf = (p: PartDef): number | undefined => (p as { sortKey?: number }).sortKey;

/**
 * Order inside a family: hand-written (generic) parts first by name, then catalogue parts by their
 * sort key (nominal value, voltage …), then by name.
 */
export function comparePartsInFamily(a: PartDef, b: PartDef): number {
  const ka = sortKeyOf(a);
  const kb = sortKeyOf(b);
  if (ka === undefined && kb !== undefined) return -1;
  if (ka !== undefined && kb === undefined) return 1;
  if (ka !== undefined && kb !== undefined && ka !== kb) return ka - kb;
  return collator.compare(a.name, b.name);
}

export const groupKey = (groupId: string): string => `g:${groupId}`;
export const familyKey = (groupId: string, family: string): string => `f:${groupId}/${family}`;
export const partKey = (partId: string): string => `p:${partId}`;

/**
 * Tree of non-empty groups (in GroupDef.order), families (alphabetical) and parts (alphabetical,
 * numeric-aware). Parts of a group missing from `groups` get a group named after their id.
 * `pending(group)` counts the parts of catalogue packs that are not loaded yet: such a group is
 * listed even while it has no loaded part, with `pending` set.
 */
export function buildBrowserTree(parts: readonly PartDef[], groups: readonly GroupDef[], pending?: (group: string) => number): GroupNode[] {
  const byGroup = new Map<string, Map<string, PartDef[]>>();
  for (const p of parts) {
    let fams = byGroup.get(p.group);
    if (!fams) {
      fams = new Map();
      byGroup.set(p.group, fams);
    }
    const fam = p.family || 'General';
    const list = fams.get(fam);
    if (list) list.push(p);
    else fams.set(fam, [p]);
  }
  const defs = new Map<string, GroupDef>(groups.map((g) => [g.id, g]));
  const out: GroupNode[] = [];
  for (const [gid, fams] of byGroup) {
    const group = defs.get(gid) ?? ({ id: gid, name: gid, order: 1000 } as GroupDef);
    const families: FamilyNode[] = Array.from(fams.entries())
      .sort((a, b) => collator.compare(a[0], b[0]))
      .map(([name, list]) => familyNode(familyKey(gid, name), name, list));
    const waiting = pending?.(gid) ?? 0;
    out.push({ key: groupKey(gid), group, families, count: families.reduce((n, f) => n + f.size, 0), ...(waiting ? { pending: waiting } : {}) });
  }
  if (pending) {
    for (const g of groups) {
      if (byGroup.has(g.id)) continue;
      const waiting = pending(g.id);
      if (waiting) out.push({ key: groupKey(g.id), group: g, families: [], count: 0, pending: waiting });
    }
  }
  return out.sort((a, b) => a.group.order - b.group.order || collator.compare(a.group.name, b.group.name));
}

/** A family whose parts are sorted (comparePartsInFamily) the first time they are read. */
function familyNode(key: string, name: string, list: PartDef[]): FamilyNode {
  let sorted: PartDef[] | null = null;
  return {
    key,
    name,
    size: list.length,
    get parts(): PartDef[] {
      sorted ??= list.slice().sort(comparePartsInFamily);
      return sorted;
    },
  };
}

interface SearchIndex {
  name: string;
  prefix: string;
  /** name and id, joined by a separator that never occurs in a token */
  nameId: string;
  family: string;
  keywords: string;
  description: string;
  /** Vietnamese name, lower case with diacritics ('' when the part has none) and accent-folded */
  viName: string;
  viNameF: string;
  /** Vietnamese family name and the family's learner words ("bóng bán dẫn"), lower case and folded */
  viFamily: string;
  viFamilyF: string;
  /** the same two lists wrapped in SEP (whole-entry tests without building strings per search) */
  viFamilyList: string;
  viFamilyListF: string;
  /** English + Vietnamese text without diacritics */
  folded: string;
  /** main values for value search ("4,7k", "100uF"): resistance / capacitance / ... with unit */
  values: { v: number; unit: string }[];
  /** unit of the part's own "value" parameter (generic R / C / L), '' when none */
  valueUnit: string;
  /** catalogue part (carries datasheet specifications); generic hand-written parts do not */
  catalogue: boolean;
  /** every searchable text folded (lower case, no diacritics): a token not in it cannot match */
  hay: string;
  /** length of the name shown in Vietnamese / English (tie-break: shorter names first) */
  shownVi: number;
  shownEn: number;
  /** name key whose plain string order follows the collator (see naturalKey) */
  nat: string;
}

/**
 * A key whose plain string order follows `collator` (base sensitivity, numeric) for part names:
 * folded lower case, digit runs zero-padded to one width (numeric order), punctuation and spaces
 * moved before digits and letters (as in the Unicode collation order). Sorting thousands of
 * search results on it is many times faster than calling the collator; equal keys fall back to it.
 */
export function naturalKey(name: string): string {
  return foldDiacritics(name)
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, '').padStart(12, '0'))
    .replace(/[^a-z0-9\u00b5-\uffff]/g, (c) => `\u0001${c}`);
}

const SEP = '\u0001';
const INDEX = new WeakMap<PartDef, SearchIndex>();
/** specification keys searched by value, with their unit */
const VALUE_SPECS: readonly [string, string][] = [
  ['resistance', 'Ω'],
  ['capacitance', 'F'],
  ['inductance', 'H'],
  ['vz', 'V'],
  ['vout', 'V'],
];

function indexOf(p: PartDef): SearchIndex {
  let ix = INDEX.get(p);
  if (!ix) {
    const name = p.name.toLowerCase();
    const viName = (partNameVi(p) ?? '').toLowerCase();
    const viFamily = [familyNameVi(p.family) ?? '', ...searchSynonymsVi(p).split(';')].map((w) => w.trim()).filter(Boolean).join(SEP).toLowerCase();
    const specs = partSpecs(p);
    const values: { v: number; unit: string }[] = [];
    for (const [key, unit] of VALUE_SPECS) {
      const v = specs[key];
      if (typeof v === 'number' && Number.isFinite(v)) values.push({ v, unit });
    }
    const valueParam = p.params.find((d) => d.key === 'value' && d.kind === 'number');
    const keywords = (p.keywords ?? []).join(SEP).toLowerCase();
    const description = `${p.description.toLowerCase()}${SEP}${p.group.toLowerCase()}`;
    const viNameF = foldDiacritics(viName);
    const viFamilyF = foldDiacritics(viFamily);
    const folded = foldDiacritics(searchText(p));
    ix = {
      name,
      prefix: p.prefix.toLowerCase(),
      nameId: `${name}${SEP}${p.id.toLowerCase()}`,
      family: p.family.toLowerCase(),
      keywords,
      description,
      viName,
      viNameF,
      viFamily,
      viFamilyF,
      viFamilyList: `${SEP}${viFamily}${SEP}`,
      viFamilyListF: `${SEP}${viFamilyF}${SEP}`,
      folded,
      values,
      valueUnit: valueParam?.unit ?? '',
      catalogue: Object.keys(specs).length > 0,
      hay: [foldDiacritics(`${name}${SEP}${p.id}${SEP}${p.prefix}${SEP}${p.family}${SEP}${keywords}${SEP}${description}`), viNameF, viFamilyF, folded].join(SEP),
      shownVi: (viName || name).length,
      shownEn: name.length,
      nat: naturalKey(p.name),
    };
    INDEX.set(p, ix);
  }
  return ix;
}

/** Characters after which a word starts (space, brackets, dash, slash, list separators). */
const WORD_BREAK = /[\s(\-/,;\u0001]/;

/** True when `needle` starts a word of `hay`. */
function wordStart(hay: string, needle: string): boolean {
  if (!hay || !needle) return false;
  if (hay.startsWith(needle)) return true;
  for (let i = hay.indexOf(needle, 1); i > 0; i = hay.indexOf(needle, i + 1)) {
    if (WORD_BREAK.test(hay.charAt(i - 1))) return true;
  }
  return false;
}

/** True when `needle` is one whole entry of a SEP-joined list wrapped in SEP (a family name or learner word). */
function isEntry(wrapped: string, needle: string): boolean {
  return !!needle && wrapped.includes(`${SEP}${needle}${SEP}`);
}

/**
 * Rank of a part for the WHOLE query (lower-case `q`, accent-folded `qf`), or null: the query is
 * (the start of) the part's English or Vietnamese name, its prefix, or its family / learner word.
 * A Vietnamese name written with the right accents ranks before the accent-folded match.
 */
function phraseRank(ix: SearchIndex, q: string, qf: string): number | null {
  if (ix.name === q || ix.viName === q) return 0;
  if (ix.prefix === q || ix.viNameF === qf) return 1;
  if (ix.name.startsWith(q) || ix.viName.startsWith(q)) return 2;
  if (ix.viNameF.startsWith(qf) || ix.nameId.includes(q) || wordStart(ix.viName, q)) return 3;
  if (wordStart(ix.viNameF, qf)) return 4;
  if (ix.family === q || isEntry(ix.viFamilyList, q)) return 5;
  if (isEntry(ix.viFamilyListF, qf) || ix.family.includes(q) || wordStart(ix.viFamily, q)) return 6;
  if (wordStart(ix.viFamilyF, qf)) return 7;
  return null;
}

/** A search token that is a value ("4,7k", "100uF", "5.1V"): the number and its unit ('' = any). */
interface ValueToken {
  v: number;
  unit: string;
}

/** Unit words of value tokens (after the multiplier), lower case. */
const UNIT_WORDS: Readonly<Record<string, string>> = { '': '', f: 'F', h: 'H', ω: 'Ω', ohm: 'Ω', ohms: 'Ω', r: 'Ω', v: 'V' };

function valueToken(raw: string): ValueToken | null {
  if (!isPlainUserNumber(raw)) return null;
  const r = parseUserNumberParts(raw);
  if (!r || !Number.isFinite(r.value)) return null;
  const unit = UNIT_WORDS[r.rest.trim().toLowerCase()];
  return unit === undefined ? null : { v: r.value, unit };
}

/** Rank for a value token: the part has that value (1), or it is a generic part of that unit (5, 6 without a unit). */
function valueRank(ix: SearchIndex, t: ValueToken): number | null {
  for (const x of ix.values) {
    if ((t.unit === '' || t.unit === x.unit) && Math.abs(x.v - t.v) <= Math.abs(t.v) * 1e-3) return 1;
  }
  if (ix.valueUnit && t.unit === ix.valueUnit) return 5;
  if (ix.valueUnit && t.unit === '' && (ix.valueUnit === 'Ω' || ix.valueUnit === 'F' || ix.valueUnit === 'H')) return 6;
  return null;
}

/** Rank of a part for one lower-case search token (lower is better), or null when it does not match. */
function textRank(ix: SearchIndex, t: string, folded: string): number | null {
  if (ix.name === t) return 0;
  if (ix.prefix === t) return 1;
  if (ix.name.startsWith(t)) return 2;
  if (ix.nameId.includes(t) || wordStart(ix.viName, t) || wordStart(ix.viNameF, folded)) return 3;
  if (ix.family.includes(t) || wordStart(ix.viFamily, t) || wordStart(ix.viFamilyF, folded)) return 4;
  if (ix.keywords.includes(t)) return 5;
  if (ix.description.includes(t)) return 6;
  // Vietnamese descriptions, with or without diacritics ("dien tro" finds "Điện trở")
  if (ix.folded.includes(folded)) return 7;
  return null;
}

function tokenRank(ix: SearchIndex, t: string, folded: string, value: ValueToken | null): number | null {
  const text = textRank(ix, t, folded);
  const byValue = value ? valueRank(ix, value) : null;
  if (byValue === null) return text;
  return text === null ? byValue : Math.min(text, byValue);
}

/** Score offset of token matches: a part matching the whole query as a phrase ranks first. */
const TOKEN_BASE = 10;

/** A search query split into tokens (lower case, folded, value tokens). */
interface PreparedQuery {
  tokens: string[];
  folded: string[];
  values: (ValueToken | null)[];
  phrase: string;
  phraseF: string;
  /** folded text tokens (not values): each must occur in a part's haystack */
  required: string[];
  /** folded value tokens: each must occur in the haystack unless the part has values to match */
  valueTexts: string[];
  /** the text tokens alone as a phrase ("điện trở" of "điện trở 10k"), when the query also has value tokens */
  textPhrase: string;
  textPhraseF: string;
}

function prepareQuery(query: string): PreparedQuery | null {
  const raw = query.trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0) return null;
  const tokens = raw.map((r) => r.toLowerCase());
  const folded = tokens.map(foldDiacritics);
  const values = raw.map(valueToken);
  const hasValue = values.some((v) => v !== null);
  const textTokens = tokens.filter((_t, k) => !values[k]);
  const textFolded = folded.filter((_f, k) => !values[k]);
  return {
    tokens,
    folded,
    values,
    phrase: tokens.join(' '),
    phraseF: folded.join(' '),
    required: folded.filter((_f, k) => !values[k]),
    valueTexts: folded.filter((_f, k) => !!values[k]),
    textPhrase: hasValue ? textTokens.join(' ') : '',
    textPhraseF: hasValue ? textFolded.join(' ') : '',
  };
}

/** Score of one part for a prepared query (lower is better), or null when it does not match. */
function scorePart(ix: SearchIndex, q: PreparedQuery): number | null {
  // quick reject: every text token must occur somewhere in the part's folded texts
  for (const f of q.required) if (!ix.hay.includes(f)) return null;
  // a value token matches by text or by one of the part's values / its value unit
  if (q.valueTexts.length && !ix.values.length && !ix.valueUnit) for (const f of q.valueTexts) if (!ix.hay.includes(f)) return null;
  let whole = phraseRank(ix, q.phrase, q.phraseF);
  // a lone value ("1k", "100uF") ranks the parts with exactly that value like a name match
  if (q.tokens.length === 1 && q.values[0]) {
    const v = valueRank(ix, q.values[0]);
    if (v !== null && (whole === null || v < whole)) whole = v;
  }
  if (whole !== null) return whole;
  // "điện trở 10k": the words name the part's family (resistors), so a part of that family with the
  // value comes before a resistor network that only mentions the words in a longer name
  if (q.textPhrase) {
    const w = phraseRank(ix, q.textPhrase, q.textPhraseF);
    if (w !== null) {
      const named = ix.name === q.textPhrase || ix.viName === q.textPhrase || ix.family === q.textPhrase || isEntry(ix.viFamilyList, q.textPhrase) || isEntry(ix.viFamilyListF, q.textPhraseF);
      let sum = TOKEN_BASE + (named ? 0 : 1);
      let all = true;
      for (let k = 0; k < q.tokens.length && all; k++) {
        const vt = q.values[k];
        if (!vt) continue;
        const r = valueRank(ix, vt);
        if (r === null) all = false;
        else sum += r;
      }
      if (all) return sum;
    }
  }
  let score = TOKEN_BASE;
  for (let k = 0; k < q.tokens.length; k++) {
    const r = tokenRank(ix, q.tokens[k], q.folded[k], q.values[k]);
    if (r === null) return null;
    score += r;
  }
  return score;
}

interface Scored {
  p: PartDef;
  ix: SearchIndex;
  score: number;
}

/**
 * Best matches first. Ties: generic (hand-written) parts before catalogue part numbers, then the
 * shorter name in the UI language ("Công tắc SPST" before "Công tắc tương tự SPDT"), then
 * alphabetical. The integer keys sort first (fast at any size); runs of equal keys are ordered by
 * the precomputed natural key (the collator's order) and the collator only breaks exact key ties.
 * Sorts `scored` in place.
 */
function sortScored(scored: Scored[]): PartDef[] {
  const vi = getLang() === 'vi';
  const shown = vi ? (x: Scored) => x.ix.shownVi : (x: Scored) => x.ix.shownEn;
  scored.sort((a, b) => a.score - b.score || Number(a.ix.catalogue) - Number(b.ix.catalogue) || shown(a) - shown(b));
  for (let i = 0; i < scored.length; ) {
    let j = i + 1;
    while (j < scored.length && scored[j].score === scored[i].score && scored[j].ix.catalogue === scored[i].ix.catalogue && shown(scored[j]) === shown(scored[i])) j++;
    if (j - i > 1) {
      const run = scored.slice(i, j).sort((a, b) => (a.ix.nat < b.ix.nat ? -1 : a.ix.nat > b.ix.nat ? 1 : collator.compare(a.p.name, b.p.name)));
      for (let k = 0; k < run.length; k++) scored[i + k] = run[k];
    }
    i = j;
  }
  return scored.map((x) => x.p);
}

/**
 * Parts matching the query, best matches first. An empty query returns [].
 *
 * A part whose English or Vietnamese name (with or without accents), prefix or family / learner
 * words match the WHOLE query ranks first ("dao động ký" → the oscilloscopes, "dien tro" → the
 * resistor, "bóng bán dẫn" → the transistors). Otherwise every whitespace-separated token must
 * match somewhere (name, prefix, id, family, keywords, description, group, Vietnamese texts) and
 * the token ranks add up. A token that is a value ("4,7k", "100uF", "5.1V") also matches the parts
 * that have that value (catalogue resistors, capacitors, inductors, Zener and regulator voltages)
 * and the generic part of that unit.
 */
export function searchCatalogue(parts: readonly PartDef[], query: string): PartDef[] {
  const q = prepareQuery(query);
  if (!q) return [];
  const scored: Scored[] = [];
  for (const p of parts) {
    const ix = indexOf(p);
    const score = scorePart(ix, q);
    if (score !== null) scored.push({ p, ix, score });
  }
  return sortScored(scored);
}

/** An incremental search over a part list (see createSearchJob). */
export interface SearchJob {
  readonly query: string;
  /** every part has been scanned (results() is final) */
  readonly done: boolean;
  /** fraction of the parts scanned, 0…1 */
  readonly progress: number;
  /** scan parts for about `budgetMs` (at least one block); returns true when the search is done */
  step(budgetMs?: number): boolean;
  /** the matches found so far, best first (the same list as searchCatalogue once done) */
  results(): PartDef[];
}

/** Parts scanned between two looks at the clock. */
const JOB_BLOCK = 512;

/**
 * Incremental search: the same ranking as searchCatalogue, run in time slices so a search over a
 * huge catalogue (and the first build of the search index) never blocks the UI. The caller runs
 * `step()` from a timer / animation frame until it returns true, showing `results()` in between.
 */
export function createSearchJob(parts: readonly PartDef[], query: string, clock: () => number = () => performance.now()): SearchJob {
  const q = prepareQuery(query);
  const scored: Scored[] = [];
  let pos = q ? 0 : parts.length;
  let cache: PartDef[] | null = q ? null : [];
  let cachedAt = -1;
  const job: SearchJob = {
    query,
    get done() {
      return pos >= parts.length;
    },
    get progress() {
      return parts.length ? pos / parts.length : 1;
    },
    step(budgetMs = 8) {
      if (!q || pos >= parts.length) return true;
      const t0 = clock();
      do {
        const end = Math.min(parts.length, pos + JOB_BLOCK);
        for (; pos < end; pos++) {
          const p = parts[pos];
          const ix = indexOf(p);
          const score = scorePart(ix, q);
          if (score !== null) scored.push({ p, ix, score });
        }
      } while (pos < parts.length && clock() - t0 < budgetMs);
      return pos >= parts.length;
    },
    results() {
      if (cache && cachedAt === scored.length) return cache;
      cache = sortScored(scored.slice());
      cachedAt = scored.length;
      return cache;
    },
  };
  return job;
}

/**
 * Parts indexed between two looks at the clock. Building a part's index costs much more than
 * scoring one against a query (it folds the diacritics of every text), so the indexer looks at the
 * clock far more often than the search job: a slice then overruns its budget by at most the cost of
 * one block (well under one animation frame), whatever the catalogue size.
 */
export const INDEX_BLOCK = 64;

/**
 * Build the search index of `parts` in time slices (`budgetMs` per call); returns the index of the
 * first part still to index (= parts.length when the index is ready). Lets the browser index a big
 * catalogue while idle. One slice indexes at most `(budgetMs / block time + 1) · INDEX_BLOCK`
 * parts: it stops as soon as the clock says the budget is spent, and never mid-block.
 */
export function indexParts(parts: readonly PartDef[], from: number, budgetMs = 8, clock: () => number = () => performance.now()): number {
  const t0 = clock();
  let i = from;
  while (i < parts.length) {
    const end = Math.min(parts.length, i + INDEX_BLOCK);
    for (; i < end; i++) indexOf(parts[i]);
    if (clock() - t0 >= budgetMs) break;
  }
  return i;
}

/**
 * Flattened rows of the tree given the expanded row keys; `filters` (family key → filter) limits
 * the parts listed under a family to those matching its specification filter. (Every row at once:
 * the browser itself uses treeRowModel, which creates only the rows in view.)
 */
export function visibleRows(tree: readonly GroupNode[], expanded: ReadonlySet<string>, filters?: ReadonlyMap<string, SpecFilter>): BrowserRow[] {
  const m = treeRowModel(tree, expanded, filters);
  return m.slice(0, m.count);
}

// ---------------------------------------------------------------------------------------------
// row models (virtualised lists)

/** Instrumentation: row objects created by the row models (tests check that only the window is built). */
export const ROW_STATS = { created: 0 };

/** The rows of a virtualised list, created on demand. */
export interface RowModel {
  /** number of rows */
  readonly count: number;
  /** rows [start, end) */
  slice(start: number, end: number): BrowserRow[];
  at(index: number): BrowserRow | undefined;
  /** index of the row with this key, -1 when it is not in the list */
  indexOf(key: string): number;
}

type Segment =
  | { kind: 'group'; start: number; node: GroupNode; expanded: boolean }
  | { kind: 'family'; start: number; node: FamilyNode; parentKey: string; expanded: boolean; shown: number }
  | { kind: 'parts'; start: number; length: number; parentKey: string; list: () => readonly PartDef[]; keys?: Map<string, number> };

function partRow(p: PartDef, level: 1 | 3, parentKey: string | null): BrowserRow {
  ROW_STATS.created += 1;
  return { kind: 'part', key: partKey(p.id), level, part: p, parentKey };
}

function keyIndex(list: readonly PartDef[]): Map<string, number> {
  const m = new Map<string, number>();
  list.forEach((p, i) => {
    const k = partKey(p.id);
    if (!m.has(k)) m.set(k, i);
  });
  return m;
}

/**
 * Row model of the tree: the row count and the position of every group / family follow from the
 * groups and families alone (an expanded family is one segment of `size` rows), so building it does
 * not touch the parts; rows are created only when asked for (the window in view).
 */
export function treeRowModel(tree: readonly GroupNode[], expanded: ReadonlySet<string>, filters?: ReadonlyMap<string, SpecFilter>): RowModel {
  const segs: Segment[] = [];
  let n = 0;
  for (const g of tree) {
    const gOpen = expanded.has(g.key);
    segs.push({ kind: 'group', start: n, node: g, expanded: gOpen });
    n += 1;
    if (!gOpen) continue;
    for (const f of g.families) {
      const fOpen = expanded.has(f.key);
      const filter = filters?.get(f.key);
      const filtered = filter && !isEmptyFilter(filter) ? applySpecFilter(f.parts, filter) : null;
      const shown = filtered ? filtered.length : f.size;
      segs.push({ kind: 'family', start: n, node: f, parentKey: g.key, expanded: fOpen, shown });
      n += 1;
      if (!fOpen || shown === 0) continue;
      segs.push({ kind: 'parts', start: n, length: shown, parentKey: f.key, list: filtered ? () => filtered : () => f.parts });
      n += shown;
    }
  }
  const count = n;
  const segAt = (i: number): Segment | undefined => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= i) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  };
  const at = (i: number): BrowserRow | undefined => {
    if (i < 0 || i >= count) return undefined;
    const sg = segAt(i);
    if (!sg) return undefined;
    switch (sg.kind) {
      case 'group':
        ROW_STATS.created += 1;
        return { kind: 'group', key: sg.node.key, level: 1, node: sg.node, expanded: sg.expanded };
      case 'family':
        ROW_STATS.created += 1;
        return { kind: 'family', key: sg.node.key, level: 2, node: sg.node, parentKey: sg.parentKey, expanded: sg.expanded, shown: sg.shown };
      case 'parts':
        return partRow(sg.list()[i - sg.start], 3, sg.parentKey);
    }
  };
  return {
    count,
    at,
    slice(start, end) {
      const out: BrowserRow[] = [];
      for (let i = Math.max(0, start); i < Math.min(count, end); i++) out.push(at(i)!);
      return out;
    },
    indexOf(key) {
      for (const sg of segs) {
        if (sg.kind === 'parts') {
          if (!key.startsWith('p:')) continue;
          sg.keys ??= keyIndex(sg.list());
          const k = sg.keys.get(key);
          if (k !== undefined) return sg.start + k;
        } else if (sg.node.key === key) return sg.start;
      }
      return -1;
    },
  };
}

/** Row model of a flat part list (search results, favourites, recent parts). */
export function listRowModel(parts: readonly PartDef[]): RowModel {
  let keys: Map<string, number> | null = null;
  const at = (i: number) => (i >= 0 && i < parts.length ? partRow(parts[i], 1, null) : undefined);
  return {
    count: parts.length,
    at,
    slice(start, end) {
      const out: BrowserRow[] = [];
      for (let i = Math.max(0, start); i < Math.min(parts.length, end); i++) out.push(at(i)!);
      return out;
    },
    indexOf(key) {
      keys ??= keyIndex(parts);
      return keys.get(key) ?? -1;
    },
  };
}

/**
 * Flat row model of the parts of several families one after the other (the component dialog's
 * "all families" list): a family's parts are sorted only when its rows come into view.
 */
export function familiesRowModel(families: readonly FamilyNode[]): RowModel {
  const segs = [] as { start: number; f: FamilyNode; keys?: Map<string, number> }[];
  let n = 0;
  for (const f of families) {
    if (!f.size) continue;
    segs.push({ start: n, f });
    n += f.size;
  }
  const count = n;
  const segAt = (i: number) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= i) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  };
  const at = (i: number): BrowserRow | undefined => {
    if (i < 0 || i >= count) return undefined;
    const sg = segAt(i);
    return partRow(sg.f.parts[i - sg.start], 1, sg.f.key);
  };
  return {
    count,
    at,
    slice(start, end) {
      const out: BrowserRow[] = [];
      for (let i = Math.max(0, start); i < Math.min(count, end); i++) out.push(at(i)!);
      return out;
    },
    indexOf(key) {
      for (const sg of segs) {
        sg.keys ??= keyIndex(sg.f.parts);
        const k = sg.keys.get(key);
        if (k !== undefined) return sg.start + k;
      }
      return -1;
    },
  };
}

/** Row model over an array of rows (tests, small lists). */
export function arrayRowModel(rows: readonly BrowserRow[]): RowModel {
  return { count: rows.length, at: (i) => rows[i], slice: (a, b) => rows.slice(a, b), indexOf: (key) => rows.findIndex((r) => r.key === key) };
}

// ---------------------------------------------------------------------------------------------
// specification filters

/** A filterable specification of a family: numeric range or a set of text values. */
export type SpecField = { key: string; kind: 'num'; unit: string; min: number; max: number; count: number } | { key: string; kind: 'text'; values: string[]; count: number };

/** Filter of one family: numeric bounds (user-number text) or a text value per spec key. */
export type SpecFilter = Record<string, { min?: string; max?: string; value?: string }>;

/**
 * Specifications worth filtering on in a set of parts: keys present on at least two parts with at
 * least two different values, in the order of SPEC_DEFS.
 */
export function familySpecFields(parts: readonly PartDef[]): SpecField[] {
  const nums = new Map<string, number[]>();
  const texts = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const p of parts) {
    for (const [k, v] of Object.entries(partSpecs(p))) {
      if (!isSpecKey(k)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (SPEC_DEFS[k].kind === 'num' && typeof v === 'number' && Number.isFinite(v)) {
        const list = nums.get(k);
        if (list) list.push(v);
        else nums.set(k, [v]);
      } else if (SPEC_DEFS[k].kind === 'text' && typeof v === 'string' && v) {
        const set = texts.get(k);
        if (set) set.add(v);
        else texts.set(k, new Set([v]));
      }
    }
  }
  const out: SpecField[] = [];
  for (const k of Object.keys(SPEC_DEFS) as (keyof typeof SPEC_DEFS)[]) {
    const count = counts.get(k) ?? 0;
    if (count < 2) continue;
    const n = nums.get(k);
    if (n && new Set(n).size > 1) out.push({ key: k, kind: 'num', unit: SPEC_DEFS[k].unit, min: Math.min(...n), max: Math.max(...n), count });
    const t = texts.get(k);
    if (t && t.size > 1) out.push({ key: k, kind: 'text', values: [...t].sort((a, b) => collator.compare(a, b)), count });
  }
  return out;
}

export function isEmptyFilter(f: SpecFilter): boolean {
  return Object.values(f).every((c) => !(c.min ?? '').trim() && !(c.max ?? '').trim() && !(c.value ?? ''));
}

/** Parts matching every condition of a filter (parts without a filtered spec are excluded). */
export function applySpecFilter(parts: readonly PartDef[], filter: SpecFilter): PartDef[] {
  const conds = Object.entries(filter)
    .map(([key, c]) => ({
      key,
      min: (c.min ?? '').trim() ? parseUserNumber(c.min!) : NaN,
      max: (c.max ?? '').trim() ? parseUserNumber(c.max!) : NaN,
      value: c.value ?? '',
    }))
    .filter((c) => Number.isFinite(c.min) || Number.isFinite(c.max) || c.value);
  if (!conds.length) return parts.slice();
  return parts.filter((p) => {
    const s = partSpecs(p);
    return conds.every((c) => {
      const v = s[c.key];
      if (c.value) return v === c.value;
      if (typeof v !== 'number') return false;
      // a little slack for rounded catalogue values (e.g. "0.25" against 0.25 W)
      if (Number.isFinite(c.min) && v < c.min * (1 - 1e-9)) return false;
      if (Number.isFinite(c.max) && v > c.max * (1 + 1e-9)) return false;
      return true;
    });
  });
}

// ---------------------------------------------------------------------------------------------
// virtualised list

export interface VirtualWindow {
  /** first and one-past-last row index to render */
  start: number;
  end: number;
  /** spacer heights above and below the rendered rows, px */
  padTop: number;
  padBottom: number;
}

/** Rows a fixed-row-height list renders for a scroll position (plus `overscan` rows each side). */
export function virtualWindow(count: number, rowHeight: number, scrollTop: number, viewport: number, overscan = 8): VirtualWindow {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.min(count - 1, Math.floor(Math.max(0, scrollTop) / rowHeight));
  const visible = Math.ceil(Math.max(viewport, rowHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/** Scroll offset that brings row `index` into view (unchanged when it is already visible). */
export function scrollIntoRow(index: number, rowHeight: number, scrollTop: number, viewport: number): number {
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  if (top + rowHeight > scrollTop + viewport) return Math.max(0, top + rowHeight - viewport);
  return scrollTop;
}


/** Flat result rows for a search. */
export function searchRows(results: readonly PartDef[]): BrowserRow[] {
  return results.map((p) => ({ kind: 'part' as const, key: partKey(p.id), level: 1 as const, part: p, parentKey: null }));
}

/** Keys to expand so that a part becomes visible in the tree. */
export function pathToPart(part: PartDef): string[] {
  return [groupKey(part.group), familyKey(part.group, part.family || 'General')];
}

export interface TreeKeyResult {
  /** new active row */
  active?: string;
  /** row whose expansion flips */
  toggle?: string;
  /** part row activated (Enter) */
  activate?: string;
}

/** Keyboard navigation of the visible rows (null = key not handled). */
export function treeKey(rows: readonly BrowserRow[], activeKey: string | null, key: string): TreeKeyResult | null {
  return treeKeyModel(arrayRowModel(rows), activeKey, key);
}

/** Keyboard navigation of a row model (WAI-ARIA tree pattern; null = key not handled). */
export function treeKeyModel(rows: RowModel, activeKey: string | null, key: string): TreeKeyResult | null {
  if (rows.count === 0) return null;
  const found = activeKey === null ? -1 : rows.indexOf(activeKey);
  const idx = Math.max(0, found);
  const row = (found >= 0 ? rows.at(found) : undefined) ?? rows.at(0)!;
  const keyAt = (i: number) => rows.at(i)!.key;
  switch (key) {
    case 'ArrowDown':
      return { active: keyAt(Math.min(rows.count - 1, activeKey === null ? 0 : idx + 1)) };
    case 'ArrowUp':
      return { active: keyAt(Math.max(0, idx - 1)) };
    case 'Home':
      return { active: keyAt(0) };
    case 'End':
      return { active: keyAt(rows.count - 1) };
    case 'PageDown':
      return { active: keyAt(Math.min(rows.count - 1, idx + 10)) };
    case 'PageUp':
      return { active: keyAt(Math.max(0, idx - 10)) };
    case 'ArrowRight':
      if (row.kind === 'part') return { active: row.key };
      if (!row.expanded) return { active: row.key, toggle: row.key };
      return { active: keyAt(Math.min(rows.count - 1, idx + 1)) };
    case 'ArrowLeft':
      if (row.kind !== 'part' && row.expanded) return { active: row.key, toggle: row.key };
      if (row.kind === 'group') return { active: row.key };
      return { active: row.parentKey ?? row.key };
    case 'Enter':
    case ' ':
      if (row.kind === 'part') return { active: row.key, activate: row.part.id };
      return { active: row.key, toggle: row.key };
    default:
      return null;
  }
}

// the scripting API (MachSim.searchParts) finds parts the way the part browser does
setPartSearcher(searchCatalogue);
