/**
 * Review round 4, step 1: the cross-feature invariant layer.
 *
 * Each feature of MachSim keeps its own house in order; what used to break was a feature meeting
 * another one. A snippet taken from a design with assembly variants pasted into a design with
 * different variants, then renumbered, then saved: every step is fine on its own, and the file
 * cannot be opened again.
 *
 * So this is a property test: start from every shipped sample and every lesson solution, apply a
 * deterministic random sequence of the operations that bring content into a design or rename
 * things in it —
 *
 *   paste (copy a selection and paste it back)      snippet round trip (write + read the chunk)
 *   MachSim XML round trip                           variant change (add / fit / activate)
 *   annotate (missing) / renumber (all)              find & replace on designators and labels
 *   exclude from simulation
 *
 * — and after EVERY step check the invariants a saved design must have:
 *
 *   1. serialise → parse again: the strict validator accepts it and nothing is lost;
 *   2. the netlister builds a netlist (it may report ERC findings, it may not throw);
 *   3. reference designators are unique per PACKAGE: two parts may share one only when they are
 *      different sections of the same multi-section chip (src/model/sections.ts);
 *   4. no dangling reference: `notFitted` names a declared variant, a `custom:` part has its
 *      data, a `hier:` block has its child design, `Probe.refProbe` points at a reference probe
 *      of the same level, and every sheet / item id is unique in the whole design.
 *
 * The seeds are fixed, so a failure is reproducible: the message names the sample, the seed and
 * the operation sequence that produced it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../helpers';
import { parseDesignSafely } from '../../../src/model/sanitize';
import { parseDesign, serializeDesign } from '../../../src/model/serialize';
import { buildNetlist } from '../../../src/model/netlister';
import { designToXml, xmlToDesignSafely } from '../../../src/model/xmlDesign';
import { buildSnippet, readSnippet, snippetText } from '../../../src/model/snippet';
import { annotateDesign } from '../../../src/model/annotate';
import { findInDesign, replaceInDesign } from '../../../src/model/findReplace';
import { addVariant, setActiveVariant, setFitted } from '../../../src/model/variants';
import { packageKey, packageOf } from '../../../src/model/sections';
import { childIdOfPart, isBlockPartId } from '../../../src/model/hierarchy';
import { isCustomPartId } from '../../../src/library/custom/types';
import { getPart } from '../../../src/library';
import type { Design, PartInstance, Sheet } from '../../../src/model/types';
import { EXAMPLES } from '../../../src/ui/integration/exampleDesigns';
import { LESSONS } from '../../../src/learn/lessons';
import { copyItems, pasteItems } from '../../../src/ui/store/designOps';
import { partLookup } from '../../../src/ui/store';
import type { SelItem } from '../../../src/ui/store/types';

// ---------------------------------------------------------------------------------------------
// deterministic randomness

/** mulberry32: a tiny, fully deterministic 32-bit PRNG (same seed → same sequence, everywhere). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

// ---------------------------------------------------------------------------------------------
// the invariants

const everySheet = (d: Design): Sheet[] => [...d.sheets, ...(d.children ?? []).flatMap((c) => c.sheets)];

/** Reference designators that two different packages share (the empty list is the invariant). */
function refdesClashes(d: Design): string[] {
  const out: string[] = [];
  const levels: Sheet[][] = [d.sheets, ...(d.children ?? []).map((c) => c.sheets)];
  for (const sheets of levels) {
    const byRef = new Map<string, PartInstance[]>();
    for (const s of sheets) {
      for (const p of s.parts) {
        const k = p.refdes.trim().toUpperCase();
        if (!k) continue;
        byRef.set(k, [...(byRef.get(k) ?? []), p]);
      }
    }
    for (const [ref, parts] of byRef) {
      if (parts.length < 2) continue;
      const keys = new Set(parts.map((p) => packageKey(p, lookupOf(d, p.partId))));
      // one designator for several parts is right only for the sections of ONE package …
      if (keys.size !== 1 || [...keys][0] === undefined) {
        out.push(`${ref}: ${parts.map((p) => p.partId).join(' + ')}`);
        continue;
      }
      // … and each section may be placed once
      const sections = parts.map((p) => packageOf(lookupOf(d, p.partId))?.section ?? '');
      if (new Set(sections).size !== sections.length) out.push(`${ref}: section placed twice (${sections.join(',')})`);
    }
  }
  return out;
}

function lookupOf(d: Design, partId: string) {
  if (isCustomPartId(partId)) return undefined;
  return getPart(partId);
}

/** References that point at nothing (the empty list is the invariant). */
function dangling(d: Design): string[] {
  const out: string[] = [];
  const variantIds = new Set((d.variants?.list ?? []).map((v) => v.id));
  const customIds = new Set((d.customParts ?? []).map((c) => c.id));
  const childIds = new Set((d.children ?? []).map((c) => c.id));
  if (d.variants?.active !== undefined && !variantIds.has(d.variants.active)) out.push(`variants.active=${d.variants.active}`);
  for (const s of everySheet(d)) {
    for (const p of s.parts) {
      for (const id of p.notFitted ?? []) if (!variantIds.has(id)) out.push(`${p.refdes}.notFitted=${id}`);
      if (isCustomPartId(p.partId) && !customIds.has(p.partId)) out.push(`${p.refdes}: no data for ${p.partId}`);
      if (isBlockPartId(p.partId) && !childIds.has(childIdOfPart(p.partId) ?? '')) out.push(`${p.refdes}: no child for ${p.partId}`);
    }
  }
  const levels: Sheet[][] = [d.sheets, ...(d.children ?? []).map((c) => c.sheets)];
  for (const sheets of levels) {
    const refs = new Set<string>();
    for (const s of sheets) for (const p of s.probes) if (p.kind === 'reference') refs.add(p.id);
    for (const s of sheets) for (const p of s.probes) if (p.refProbe !== undefined && !refs.has(p.refProbe)) out.push(`probe ${p.name}: refProbe=${p.refProbe}`);
  }
  // ids are addressed across the whole design (src/model/serialize.ts)
  const seen = new Map<string, Set<string>>();
  const unique = (kind: string, id: string) => {
    if (!seen.has(kind)) seen.set(kind, new Set());
    const used = seen.get(kind)!;
    if (used.has(id)) out.push(`duplicate ${kind} id ${id}`);
    used.add(id);
  };
  for (const s of everySheet(d)) {
    unique('sheet', s.id);
    for (const p of s.parts) unique('part', p.id);
    for (const w of s.wires) unique('wire', w.id);
    for (const l of s.labels) unique('label', l.id);
    for (const p of s.probes) unique('probe', p.id);
    for (const n of s.notes) unique('note', n.id);
    for (const x of s.shapes ?? []) unique('shape', x.id);
  }
  return out;
}

/** Every invariant of a saved design; returns the design as it comes back from the file. */
function checkInvariants(d: Design, where: string): Design {
  let text: string;
  let back: Design;
  try {
    text = serializeDesign(d);
    back = parseDesign(text);
  } catch (err) {
    throw new Error(`${where}: the design does not save and reopen — ${err instanceof Error ? err.message : String(err)}`);
  }
  // nothing is lost on the way through the file: the validator normalises the key order once,
  // and the SECOND round trip has to be the identity (anything else means data is being dropped)
  const again = serializeDesign(back);
  expect(serializeDesign(parseDesign(again)), `${where}: the file is not stable across round trips`).toBe(again);
  expect(again.length, `${where}: the round trip emptied the design`).toBeGreaterThan(text.length / 2);
  expect(refdesClashes(back), `${where}: reference designators`).toEqual([]);
  expect(dangling(back), `${where}: dangling references`).toEqual([]);
  try {
    buildNetlist(back, { includeAnalysis: false });
  } catch (err) {
    throw new Error(`${where}: the netlister threw — ${err instanceof Error ? err.message : String(err)}`);
  }
  return back;
}

// ---------------------------------------------------------------------------------------------
// the operations

type Op = { name: string; apply: (d: Design, r: () => number) => Design };

/** Every part of the root sheets, with its sheet. */
function rootParts(d: Design): { sheet: Sheet; part: PartInstance }[] {
  return d.sheets.flatMap((s) => s.parts.map((part) => ({ sheet: s, part })));
}

const OPS: Op[] = [
  {
    name: 'paste',
    apply: (d, r) => {
      const all = rootParts(d);
      if (!all.length) return d;
      const sheet = pick(r, d.sheets.filter((s) => s.parts.length > 0));
      if (!sheet) return d;
      const n = 1 + Math.floor(r() * Math.min(3, sheet.parts.length));
      const start = Math.floor(r() * sheet.parts.length);
      const sel: SelItem[] = Array.from({ length: n }, (_, i) => ({ kind: 'part' as const, id: sheet.parts[(start + i) % sheet.parts.length].id }));
      const clip = copyItems(d, sheet.id, sel, partLookup);
      if (!clip) return d;
      return pasteItems(d, sheet.id, clip, { x: 200 + Math.floor(r() * 100), y: 200 }, partLookup).design;
    },
  },
  {
    name: 'snippet round trip',
    apply: (d, r) => {
      const sheet = d.sheets.find((s) => s.parts.length > 0);
      if (!sheet) return d;
      const sel: SelItem[] = sheet.parts.slice(0, 1 + Math.floor(r() * 2)).map((p) => ({ kind: 'part' as const, id: p.id }));
      const clip = copyItems(d, sheet.id, sel, partLookup);
      if (!clip) return d;
      const data = readSnippet(JSON.parse(snippetText(buildSnippet(d, clip, new Date(0)))));
      // placed back into the design it came from, as the Snippets flow does
      return pasteItems(d, sheet.id, { ...clip, ...data.fragment }, { x: 300, y: 300 }, partLookup, {
        keepRefdes: true,
        extras: { customParts: data.customParts, variables: data.variables, variants: data.variants, customSpice: data.customSpice, nets: data.nets },
      }).design;
    },
  },
  {
    name: 'xml round trip',
    apply: (d) => {
      const r = xmlToDesignSafely(designToXml(d));
      expect(r.notes, 'a design MachSim just wrote needs no XML repair').toEqual([]);
      return r.design;
    },
  },
  {
    name: 'variant change',
    apply: (d, r) => {
      let next = d;
      if (!next.variants?.list.length) next = addVariant(next, 'Đầy đủ').design;
      const added = addVariant(next, `Phương án ${Math.floor(r() * 90) + 10}`);
      next = added.design;
      const all = rootParts(next);
      if (all.length) {
        const victim = pick(r, all).part;
        next = setFitted(next, [victim.id], added.id, false);
      }
      return setActiveVariant(next, r() < 0.5 ? added.id : (next.variants?.list[0].id ?? added.id));
    },
  },
  { name: 'annotate missing', apply: (d) => annotateDesign(d, { mode: 'missing' }).design },
  { name: 'renumber all', apply: (d) => annotateDesign(d, { mode: 'all' }).design },
  {
    name: 'find & replace label',
    apply: (d, r) => {
      const matches = findInDesign(d, r() < 0.5 ? 'R' : 'N', { fields: ['refdes', 'label'] });
      if (!matches.length) return d;
      return replaceInDesign(d, r() < 0.5 ? 'R' : 'N', 'Z', { fields: ['refdes', 'label'] }).design;
    },
  },
  {
    name: 'exclude from simulation',
    apply: (d, r) => {
      const all = rootParts(d);
      if (!all.length) return d;
      const victim = pick(r, all);
      return {
        ...d,
        sheets: d.sheets.map((s) => (s.id === victim.sheet.id ? { ...s, parts: s.parts.map((p) => (p.id === victim.part.id ? { ...p, excludeFromSim: !p.excludeFromSim } : p)) } : s)),
      };
    },
  },
];

// ---------------------------------------------------------------------------------------------
// the designs under test

/** Every shipped sample design, read from examples/. */
function sampleDesigns(): { name: string; design: Design }[] {
  return EXAMPLES.map((e) => ({ name: e.file, design: parseDesignSafely(readFileSync(EXAMPLES_DIR + e.file, 'utf8')).design }));
}

/** Every lesson solution (and starter circuit) a shipped lesson carries. */
function lessonDesigns(): { name: string; design: Design }[] {
  const out: { name: string; design: Design }[] = [];
  for (const lesson of LESSONS) {
    for (const [kind, fn] of [
      ['solution', lesson.solution],
      ['starter', lesson.starter],
    ] as const) {
      if (!fn) continue;
      const d = fn();
      if (d.sheets.some((s) => s.parts.length > 0)) out.push({ name: `${lesson.id} ${kind}`, design: d });
    }
  }
  return out;
}

const SEEDS = [1, 7, 20250418];
const STEPS = 6;

describe('the invariant check itself catches what it is for', () => {
  it('a part naming a variant the design does not declare fails', () => {
    const d = parseDesignSafely(readFileSync(EXAMPLES_DIR + EXAMPLES[0].file, 'utf8')).design;
    const broken: Design = { ...d, sheets: d.sheets.map((s, i) => (i === 0 ? { ...s, parts: s.parts.map((p, k) => (k === 0 ? { ...p, notFitted: ['vGhost'] } : p)) } : s)) };
    expect(() => checkInvariants(broken, 'self test')).toThrow(/does not save and reopen/);
  });

  it('two different parts sharing one reference designator fail', () => {
    const d = parseDesignSafely(readFileSync(EXAMPLES_DIR + EXAMPLES[0].file, 'utf8')).design;
    const parts = d.sheets[0].parts;
    expect(parts.length).toBeGreaterThan(1);
    const broken: Design = { ...d, sheets: d.sheets.map((s, i) => (i === 0 ? { ...s, parts: s.parts.map((p) => ({ ...p, refdes: parts[0].refdes })) } : s)) };
    expect(() => checkInvariants(broken, 'self test')).toThrow();
  });

  it('a duplicate item id fails', () => {
    const d = parseDesignSafely(readFileSync(EXAMPLES_DIR + EXAMPLES[0].file, 'utf8')).design;
    const broken: Design = { ...d, sheets: d.sheets.map((s, i) => (i === 0 ? { ...s, parts: s.parts.map((p) => ({ ...p, id: s.parts[0].id })) } : s)) };
    expect(() => checkInvariants(broken, 'self test')).toThrow();
  });
});

describe('cross-feature invariants: the samples survive random sequences of the entry paths', () => {
  const designs = sampleDesigns();

  it('every sample is read', () => {
    expect(designs.length).toBeGreaterThanOrEqual(57);
  });

  for (const { name, design } of designs) {
    it(`${name}`, () => {
      for (const seed of SEEDS) {
        const r = rng(seed);
        let d = checkInvariants(design, `${name} seed ${seed} (as shipped)`);
        const trail: string[] = [];
        for (let step = 0; step < STEPS; step++) {
          const op = pick(r, OPS);
          trail.push(op.name);
          d = op.apply(d, r);
          d = checkInvariants(d, `${name} seed ${seed} after [${trail.join(' → ')}]`);
        }
      }
    });
  }
});

describe('cross-feature invariants: the lesson solutions survive the same sequences', () => {
  const designs = lessonDesigns();

  it('every shipped lesson with a solution is covered', () => {
    expect(designs.length).toBeGreaterThanOrEqual(25);
  });

  for (const { name, design } of designs) {
    it(`${name}`, () => {
      for (const seed of SEEDS) {
        const r = rng(seed);
        let d = checkInvariants(design, `${name} seed ${seed} (as built)`);
        const trail: string[] = [];
        for (let step = 0; step < STEPS; step++) {
          const op = pick(r, OPS);
          trail.push(op.name);
          d = op.apply(d, r);
          d = checkInvariants(d, `${name} seed ${seed} after [${trail.join(' → ')}]`);
        }
      }
    });
  }
});
