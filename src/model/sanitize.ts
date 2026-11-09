/**
 * Shared integrity layer for everything that enters a design (pure).
 *
 * MachSim has many ways to bring circuit content into the design that is open: paste, a snippet
 * picture, a KiCad / EDIF / MachSim-XML / SPICE import, a template, a project archive, a lesson
 * file, a variant change, Update components from library. Every one of them can carry a
 * **design-scoped reference** — a name or id that only means something inside the design it came
 * from:
 *
 *   | reference                        | where it lives                                   |
 *   |----------------------------------|--------------------------------------------------|
 *   | assembly variant ids             | `PartInstance.notFitted`, `Design.variants`      |
 *   | global parameters                | `PartInstance.params` ("{2*Rload}", "Rbot")      |
 *   | per-net settings                 | `Design.nets` keyed by net name                  |
 *   | user components                  | `partId` "custom:…" → `Design.customParts`       |
 *   | child designs of blocks          | `partId` "hier:…" → `Design.children`            |
 *   | model overrides                  | `PartInstance.modelOverride` → `customSpice`     |
 *   | package designators of sections   | one refdes per chip (src/model/sections.ts)      |
 *   | ERC options                      | `Design.erc.matrix` pin-type pair keys           |
 *   | ladder addresses                 | `Sheet.ladder` I/Q/M/T/C/AI vs the PLC rack      |
 *   | library references               | `Design.libraryRefs` by part id                  |
 *   | reference probes                 | `Probe.refProbe` → a probe of the same level      |
 *
 * An unresolved reference is worse than a missing feature: the paste is accepted, the file saves,
 * and then it never opens again, because `validateDesign` refuses `notFitted` ids that name no
 * variant. This module is the single place that remaps or strips them, so every entry path leaves
 * a design that **saves and reopens**.
 *
 * Three entry shapes, three functions:
 *
 *   sanitizeIncoming(target, fragment, extras)   a FRAGMENT entering an open design (paste,
 *                                                snippet, generated circuit): variant ids are
 *                                                remapped by variant NAME where the target has
 *                                                one and stripped otherwise, and the global
 *                                                parameters / user components / model text / net
 *                                                settings the fragment needs are reported as
 *                                                additions the caller applies in its undo step.
 *   sanitizeDesign(design)                       a WHOLE design entering (import, template,
 *                                                project, lesson, block from file): its internal
 *                                                references are made consistent with itself.
 *   repairRawDesign(raw) / parseDesignSafely     a FILE being loaded: the raw JSON is repaired
 *                                                before validation, so a file with an unknown
 *                                                reference opens with a note instead of being
 *                                                refused. `parseDesignSafely` first tries the
 *                                                strict `parseDesign`, so a healthy file costs
 *                                                nothing and round-trips byte for byte.
 *
 * Every function reports what it changed as {@link SanitizeNote}s — a code, a count and up to
 * {@link NOTE_NAMES} names. The codes are catalogue keys (`sanitize.<code>`, Vietnamese first,
 * src/i18n/messages/files.ts), so the loader can tell the learner "2 phương án lắp ráp không có
 * trong thiết kế này đã được bỏ" instead of failing.
 *
 * Nothing here knows about the component library, React or i18n, so the netlister tests and the
 * desktop batch runner can use it too.
 */
import type { CustomPartData } from '../library/custom/types';
import { isCustomPartId } from '../library/custom/types';
import { ERC_PIN_TYPES, pinPairKey, type ErcLevel } from './ercMatrix';
import { BLOCK_PREFIX, childIdOfPart, isBlockPartId } from './hierarchy';
import { CURRENT_DESIGN_VERSION, DesignFormatError, parseDesign, validateDesign } from './serialize';
import type { ChildDesign, Design, DesignVariants, VariantValues, NetLabel, NetSettings, PartInstance, Point, Probe, Shape, Sheet, TextNote, Wire } from './types';
import { isPlainNumber } from './variables';
import { LADDER_LIMITS, type LadderNode, type LadderRung } from '../ladder/types';

/** How many names a note lists (the rest is only counted). */
export const NOTE_NAMES = 8;

/**
 * What a sanitize step did. Codes are stable: they are catalogue keys `sanitize.<code>` and are
 * written into reports, so only add new ones.
 */
export type SanitizeCode =
  /** `notFitted` named a variant of the source design that the target has under another id */
  | 'variantRemapped'
  /** `notFitted` named a variant nothing declares: dropped (the part is fitted everywhere) */
  | 'variantDropped'
  /** `variants.active` named no variant of the list: the first one is active instead */
  | 'activeVariantReset'
  /** global parameters the incoming values need were added to the design */
  | 'variableAdded'
  /** the design already defines that parameter with another value: its own value wins */
  | 'variableKept'
  /** user components the incoming parts use were embedded */
  | 'customPartAdded'
  /** the design already embeds that user component: its own copy wins */
  | 'customPartKept'
  /** a part refers to a user component nothing carries: the part was removed */
  | 'customPartMissing'
  /** a block refers to a child design nothing carries: the block was removed */
  | 'blockMissing'
  /** `modelOverride` named a model no SPICE text defines: the part uses its own model again */
  | 'modelOverrideDropped'
  /** per-net settings of the incoming nets were added */
  | 'netSettingsAdded'
  /** a net-settings entry without a usable field was dropped */
  | 'netSettingsDropped'
  /** an ERC matrix override with an unknown pin-type pair or level was dropped */
  | 'ercOptionDropped'
  /** a ladder address is outside the addressable range of a MachSim PLC rack */
  | 'ladderAddressOutOfRange'
  /** a library reference for a part id nothing places was dropped */
  | 'libraryRefDropped'
  /** `Probe.refProbe` named no reference probe of the same level: the probe measures to ground */
  | 'probeRefDropped'
  /** a duplicate sheet / item id got a fresh one */
  | 'idRenumbered'
  /** the design's custom SPICE text got the incoming models appended */
  | 'customSpiceAdded';

export interface SanitizeNote {
  code: SanitizeCode;
  /** how many references the step touched */
  count: number;
  /** up to NOTE_NAMES of them, for the message */
  names: string[];
}

/** Collects notes: one per code, counting everything and keeping the first few names. */
export class SanitizeLog {
  private readonly byCode = new Map<SanitizeCode, SanitizeNote>();

  add(code: SanitizeCode, name: string): void {
    let note = this.byCode.get(code);
    if (!note) {
      note = { code, count: 0, names: [] };
      this.byCode.set(code, note);
    }
    note.count += 1;
    if (note.names.length < NOTE_NAMES && !note.names.includes(name)) note.names.push(name);
  }

  /** The notes in the order their codes first appeared. */
  get notes(): SanitizeNote[] {
    return [...this.byCode.values()];
  }

  get empty(): boolean {
    return this.byCode.size === 0;
  }
}

/** True when the notes say nothing was changed. */
export function cleanSanitize(notes: readonly SanitizeNote[]): boolean {
  return notes.length === 0;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const lower = (s: string): string => s.trim().toLowerCase();

// ---------------------------------------------------------------------------------------------
// global parameters: which names a value text refers to
// ---------------------------------------------------------------------------------------------

const IDENTIFIERS = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Global parameter names a parameter text refers to, in the three forms src/model/variables.ts
 * evaluates: the names inside every `{…}` group, and — when the text is neither braced nor a
 * plain user number — the names in the bare text itself ("Rbot", "2*gain"). Matching ignores
 * case (as `resolveDesignVariables` does); the declared spelling of `byLower` is returned.
 *
 * This is the one place that knows the rule: the snippet writer, the paste path and the invariant
 * tests all ask here, so a value that simulated in the source design simulates in the target.
 */
export function referencedVariables(text: string, byLower: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const add = (word: string) => {
    const name = byLower.get(word.toLowerCase());
    if (name !== undefined && !out.includes(name)) out.push(name);
  };
  const t = String(text).trim();
  if (t === '') return out;
  let braced = false;
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    braced = true;
    for (const w of m[1].match(IDENTIFIERS) ?? []) add(w);
  }
  if (!braced && !isPlainNumber(t)) for (const w of t.match(IDENTIFIERS) ?? []) add(w);
  return out;
}

/**
 * Closure of the global parameters a set of parts needs: the names their values refer to, plus
 * the names those definitions refer to in turn. `vars` are the declarations to look in (the source
 * design's `Design.variables`); the result keeps the declared spelling.
 */
export function neededVariables(parts: readonly PartInstance[], vars: Readonly<Record<string, string>>): string[] {
  const names = Object.keys(vars);
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const used = new Set<string>();
  const pending: string[] = [];
  const need = (n: string) => {
    if (used.has(n)) return;
    used.add(n);
    pending.push(n);
  };
  for (const p of parts) for (const v of Object.values(p.params)) for (const n of referencedVariables(v, byLower)) need(n);
  while (pending.length) for (const n of referencedVariables(vars[pending.pop()!] ?? '', byLower)) need(n);
  return names.filter((n) => used.has(n));
}

// ---------------------------------------------------------------------------------------------
// a fragment entering an open design
// ---------------------------------------------------------------------------------------------

/** The schematic items of a fragment (the editor clipboard / snippet shape). */
export interface IncomingFragment {
  parts: PartInstance[];
  wires: Wire[];
  labels: NetLabel[];
  probes: Probe[];
  notes: TextNote[];
  shapes?: Shape[];
  children?: ChildDesign[];
  anchor: Point;
}

/** What the source design carried along with the fragment; every field is optional. */
export interface IncomingExtras {
  /** user components the parts use */
  customParts?: CustomPartData[];
  /** the source design's global parameters (only the needed closure is taken) */
  variables?: Record<string, string>;
  /** the source design's assembly variants (used to remap `notFitted` by name) */
  variants?: DesignVariants;
  /** the source design's custom SPICE text (model overrides need it) */
  customSpice?: string;
  /** the source design's per-net settings (the colour of a copied net follows it) */
  nets?: Record<string, NetSettings>;
}

/** The fragment and the design-level additions the caller applies in one undo step. */
export interface SanitizedIncoming {
  /** the fragment with its design-scoped references remapped or stripped */
  fragment: IncomingFragment;
  /** global parameters to add (the target's own definitions are never overwritten) */
  variables: Record<string, string>;
  /** user components to embed (the target's own copies are never overwritten) */
  customParts: CustomPartData[];
  /** SPICE model text to append, or undefined when the target already has it */
  customSpice?: string;
  /** per-net settings to add for the nets the fragment brings */
  nets: Record<string, NetSettings>;
  notes: SanitizeNote[];
}

/** Every part of a fragment, including the parts inside the child designs it carries. */
function fragmentParts(f: IncomingFragment): PartInstance[] {
  return [...f.parts, ...(f.children ?? []).flatMap((c) => c.sheets.flatMap((s) => s.parts))];
}

/** Net names the fragment's labels and connectors carry (bus entries included). */
export function fragmentNetNames(f: IncomingFragment): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (labels: readonly NetLabel[]) => {
    for (const l of labels) {
      const n = l.name.trim();
      if (!n || seen.has(lower(n))) continue;
      seen.add(lower(n));
      out.push(n);
    }
  };
  take(f.labels);
  for (const c of f.children ?? []) for (const s of c.sheets) take(s.labels);
  return out;
}

/** `.model` / `.subckt` names a SPICE text defines (lower case). */
function modelNames(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = /^\s*\.(?:model|subckt)\s+([^\s(]+)/i.exec(line);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * A fragment entering `target`: every design-scoped reference remapped or stripped, and the
 * design-level additions it needs listed separately so the caller can apply them in the same undo
 * step (`actions.insertSnippet` does exactly that).
 *
 * Variant ids are remapped by **name** first: a snippet from a board whose "Không màn hình"
 * variant is `v2` keeps its meaning in a design where that name is `v1`. Ids that match nothing
 * are dropped, because a design may only name variants it declares (src/model/serialize.ts) —
 * keeping them would make the pasted design unopenable.
 */
export function sanitizeIncoming(
  target: Pick<Design, 'variants' | 'variables' | 'customParts' | 'customSpice' | 'nets'>,
  fragment: IncomingFragment,
  extras: IncomingExtras = {},
): SanitizedIncoming {
  const log = new SanitizeLog();
  const frag = clone(fragment);

  // ---- assembly variants: remap by name, else strip
  const targetVariants = target.variants?.list ?? [];
  const byName = new Map(targetVariants.map((v) => [lower(v.name), v.id]));
  const knownIds = new Set(targetVariants.map((v) => v.id));
  const sourceName = new Map((extras.variants?.list ?? []).map((v) => [v.id, v.name]));
  const mapVariant = (id: string, refdes: string): string | null => {
    const name = sourceName.get(id);
    // the source declared this id with a name: the name decides (the same id can mean another build
    // in another design: "v2" is "Without display" here and "Lab" there); a source that declared
    // nothing is the same design, where the id itself is the answer
    if (knownIds.has(id) && (name === undefined || lower(targetVariants.find((v) => v.id === id)?.name ?? '') === lower(name))) return id;
    const hit = name !== undefined ? byName.get(lower(name)) : undefined;
    if (hit !== undefined) {
      log.add('variantRemapped', `${refdes}: ${name}`);
      return hit;
    }
    log.add('variantDropped', `${refdes}: ${name ?? id}`);
    return null;
  };
  const fixVariants = (p: PartInstance) => {
    if (!p.notFitted?.length && !p.variantValues) return;
    // each variant id of the part is mapped once (notFitted and variantValues may name the same one)
    const mapped = new Map<string, string | null>();
    const to = (id: string): string | null => {
      if (!mapped.has(id)) mapped.set(id, mapVariant(id, p.refdes || p.partId));
      return mapped.get(id) ?? null;
    };
    if (p.notFitted?.length) {
      const keep: string[] = [];
      for (const id of p.notFitted) {
        const t = to(id);
        if (t !== null && !keep.includes(t)) keep.push(t);
      }
      if (keep.length) p.notFitted = keep;
      else delete p.notFitted;
    }
    if (p.variantValues) {
      const values: Record<string, VariantValues> = {};
      for (const [id, vv] of Object.entries(p.variantValues)) {
        const t = to(id);
        if (t !== null && !(t in values)) values[t] = vv;
      }
      if (Object.keys(values).length) p.variantValues = values;
      else delete p.variantValues;
    }
  };
  for (const p of fragmentParts(frag)) fixVariants(p);

  // ---- user components: embed the ones the target lacks, keep the ones it has
  const have = new Map((target.customParts ?? []).map((c) => [c.id, c]));
  const supplied = new Map((extras.customParts ?? []).map((c) => [c.id, c]));
  const customParts: CustomPartData[] = [];
  const addedCustom = new Set<string>();
  for (const p of fragmentParts(frag)) {
    if (!isCustomPartId(p.partId) || addedCustom.has(p.partId)) continue;
    const mine = have.get(p.partId);
    const incoming = supplied.get(p.partId);
    if (mine) {
      if (incoming && JSON.stringify(mine) !== JSON.stringify(incoming)) log.add('customPartKept', p.partId);
      addedCustom.add(p.partId);
      continue;
    }
    if (incoming) {
      customParts.push(clone(incoming));
      addedCustom.add(p.partId);
      log.add('customPartAdded', incoming.name || p.partId);
    }
  }
  // parts whose user component nobody has cannot be drawn or netlisted: leave them out
  const resolvable = (partId: string) => !isCustomPartId(partId) || have.has(partId) || supplied.has(partId);
  const dropUnresolvable = (parts: PartInstance[]): PartInstance[] =>
    parts.filter((p) => {
      if (resolvable(p.partId)) return true;
      log.add('customPartMissing', `${p.refdes || p.partId}`);
      return false;
    });
  frag.parts = dropUnresolvable(frag.parts);
  for (const c of frag.children ?? []) c.sheets = c.sheets.map((s) => ({ ...s, parts: dropUnresolvable(s.parts) }));

  // ---- blocks: a block whose child design is missing cannot be placed
  const childIds = new Set((frag.children ?? []).map((c) => c.id));
  frag.parts = frag.parts.filter((p) => {
    if (!isBlockPartId(p.partId) || childIds.has(childIdOfPart(p.partId) ?? '')) return true;
    log.add('blockMissing', p.refdes || p.partId);
    return false;
  });

  // ---- global parameters: the closure the remaining values need
  const variables: Record<string, string> = {};
  const parts = fragmentParts(frag);
  const mineLower = new Map(Object.keys(target.variables).map((n) => [n.toLowerCase(), n]));
  for (const name of neededVariables(parts, extras.variables ?? {})) {
    const mine = mineLower.get(name.toLowerCase());
    if (mine !== undefined) {
      if (target.variables[mine].trim() !== (extras.variables?.[name] ?? '').trim()) log.add('variableKept', mine);
      continue;
    }
    variables[name] = extras.variables![name];
    log.add('variableAdded', name);
  }

  // ---- model overrides: keep them only while some SPICE text defines the model
  const mineModels = modelNames(target.customSpice);
  const incomingModels = modelNames(extras.customSpice);
  const needsSpice = parts.some((p) => p.modelOverride && !mineModels.has(p.modelOverride.toLowerCase()) && incomingModels.has(p.modelOverride.toLowerCase()));
  for (const p of parts) {
    const name = p.modelOverride?.toLowerCase();
    if (!name) continue;
    if (mineModels.has(name) || incomingModels.has(name)) continue;
    log.add('modelOverrideDropped', `${p.refdes || p.partId}: ${p.modelOverride!}`);
    delete p.modelOverride;
  }
  let customSpice: string | undefined;
  const spice = extras.customSpice?.trim();
  if (needsSpice && spice && !(target.customSpice ?? '').includes(spice)) {
    customSpice = spice;
    log.add('customSpiceAdded', `${incomingModels.size}`);
  }

  // ---- per-net settings: a copied net keeps its colour and PCB properties
  const nets: Record<string, NetSettings> = {};
  if (extras.nets) {
    const mineNets = new Set(Object.keys(target.nets ?? {}).map(lower));
    for (const name of fragmentNetNames(frag)) {
      if (mineNets.has(lower(name))) continue;
      const entry = Object.entries(extras.nets).find(([n]) => lower(n) === lower(name))?.[1];
      if (!entry || !Object.keys(entry).length) continue;
      nets[name] = clone(entry);
      log.add('netSettingsAdded', name);
    }
  }

  // ---- reference probes: a copied probe may point at a reference probe left behind
  const probeIds = new Set(frag.probes.map((p) => p.id));
  for (const p of frag.probes) {
    if (p.refProbe === undefined || probeIds.has(p.refProbe)) continue;
    log.add('probeRefDropped', p.name || p.id);
    delete p.refProbe;
  }

  return { fragment: frag, variables, customParts, ...(customSpice !== undefined ? { customSpice } : {}), nets, notes: log.notes };
}

/** {@link sanitizeIncomingSheets} result: the sheets plus the design-level additions. */
export interface SanitizedSheets extends Omit<SanitizedIncoming, 'fragment'> {
  sheets: Sheet[];
}

/**
 * Whole SHEETS entering an open design: the sheets of a .msim file becoming a hierarchical block,
 * a sheet imported from another design. Same rules as {@link sanitizeIncoming} — a part whose
 * user component or assembly variant does not exist here is repaired, never carried as a dangling
 * reference — but the sheet structure (and the item ids, which the caller renumbers) is kept.
 */
export function sanitizeIncomingSheets(
  target: Pick<Design, 'variants' | 'variables' | 'customParts' | 'customSpice' | 'nets'>,
  sheets: readonly Sheet[],
  extras: IncomingExtras = {},
): SanitizedSheets {
  const fragment: IncomingFragment = {
    parts: sheets.flatMap((s) => s.parts),
    wires: [],
    labels: sheets.flatMap((s) => s.labels),
    probes: sheets.flatMap((s) => s.probes),
    notes: [],
    anchor: { x: 0, y: 0 },
  };
  const safe = sanitizeIncoming(target, fragment, extras);
  const byId = new Map(safe.fragment.parts.map((p) => [p.id, p]));
  const probeById = new Map(safe.fragment.probes.map((p) => [p.id, p]));
  const out = sheets.map((s) => ({
    ...s,
    parts: s.parts.map((p) => byId.get(p.id)).filter((p): p is PartInstance => p !== undefined),
    probes: s.probes.map((p) => probeById.get(p.id) ?? p),
  }));
  const { fragment: _drop, ...rest } = safe;
  return { ...rest, sheets: out };
}

// ---------------------------------------------------------------------------------------------
// a whole design entering
// ---------------------------------------------------------------------------------------------

/** Every sheet of a design (root sheets first, then the sheets of each child design). */
function everySheet(design: Pick<Design, 'sheets' | 'children'>): Sheet[] {
  return [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)];
}

/** Addresses a ladder rung uses, with the slot they sit in (for the note). */
function ladderAddresses(rungs: readonly LadderRung[]): string[] {
  const out: string[] = [];
  const walk = (n: LadderNode | undefined) => {
    if (!n) return;
    if (n.kind === 'contact') out.push(n.address);
    else if (n.kind === 'compare') out.push(n.left, n.right);
    else for (const item of n.items) walk(item);
  };
  for (const r of rungs) {
    walk(r.logic);
    for (const o of r.outputs) out.push(o.address);
  }
  return out;
}

/**
 * True when a ladder address names something a MachSim rack can address. Literals (a number in a
 * comparison) and empty text are not addresses and pass.
 */
export function ladderAddressInRange(text: string): boolean {
  const t = text.trim().toUpperCase();
  if (!t || isPlainNumber(t)) return true;
  let m = /^([IQ])(\d+)\.(\d+)$/.exec(t);
  if (m) return Number(m[2]) < LADDER_LIMITS.ioBytes && Number(m[3]) < 8;
  m = /^M(\d+)\.(\d+)$/.exec(t);
  if (m) return Number(m[1]) < LADDER_LIMITS.memBytes && Number(m[2]) < 8;
  m = /^T(\d+)(\.ET)?$/.exec(t);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= LADDER_LIMITS.timers;
  m = /^C(\d+)(\.CV)?$/.exec(t);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= LADDER_LIMITS.counters;
  m = /^AI(\d+)$/.exec(t);
  if (m) return Number(m[1]) < LADDER_LIMITS.analogInputs;
  // an address shape MachSim does not know at all: the ladder compiler reports it per rung
  return true;
}

/**
 * A whole design entering the program (XML / KiCad / EDIF import, template, project archive,
 * lesson file, a block loaded from a file): its own references made consistent with itself, so it
 * saves and reopens. Returns the same object when nothing had to change.
 *
 * What it fixes: `notFitted` ids and `variants.active` against the variant list; parts whose user
 * component or child design is missing; model overrides naming no model; net-settings entries with
 * nothing in them; ERC matrix overrides with an unknown pin pair or level; `Probe.refProbe`
 * pointing outside its level; library references for parts nothing places. Out-of-range ladder
 * addresses are reported but kept (the rung is the learner's work and the ladder compiler reports
 * the rung itself).
 */
export function sanitizeDesign(design: Design): { design: Design; notes: SanitizeNote[] } {
  const log = new SanitizeLog();
  const d = clone(design);

  // ---- assembly variants
  const ids = new Set((d.variants?.list ?? []).map((v) => v.id));
  for (const s of everySheet(d)) {
    for (const p of s.parts) {
      if (p.notFitted?.length) {
        const keep = p.notFitted.filter((id) => ids.has(id));
        if (keep.length !== p.notFitted.length) {
          for (const id of p.notFitted) if (!ids.has(id)) log.add('variantDropped', `${p.refdes || p.partId}: ${id}`);
          if (keep.length) p.notFitted = keep;
          else delete p.notFitted;
        }
      }
      if (p.variantValues) {
        const gone = Object.keys(p.variantValues).filter((id) => !ids.has(id));
        if (gone.length) {
          for (const id of gone) {
            log.add('variantDropped', `${p.refdes || p.partId}: ${id}`);
            delete p.variantValues[id];
          }
          if (!Object.keys(p.variantValues).length) delete p.variantValues;
        }
      }
    }
  }
  if (d.variants && d.variants.active !== undefined && !ids.has(d.variants.active)) {
    log.add('activeVariantReset', d.variants.active);
    d.variants = { list: d.variants.list, active: d.variants.list[0]?.id };
    if (d.variants.active === undefined) delete d.variants;
  }
  if (d.variants && !d.variants.list.length) delete d.variants;

  // ---- user components and blocks
  const customIds = new Set((d.customParts ?? []).map((c) => c.id));
  const childIds = new Set((d.children ?? []).map((c) => c.id));
  const keepPart = (p: PartInstance): boolean => {
    if (isCustomPartId(p.partId) && !customIds.has(p.partId)) {
      log.add('customPartMissing', p.refdes || p.partId);
      return false;
    }
    if (isBlockPartId(p.partId) && !childIds.has(childIdOfPart(p.partId) ?? '')) {
      log.add('blockMissing', p.refdes || p.partId);
      return false;
    }
    return true;
  };
  const filterSheets = (sheets: Sheet[]): Sheet[] =>
    sheets.map((s) => {
      const parts = s.parts.filter(keepPart);
      return parts.length === s.parts.length ? s : { ...s, parts };
    });
  d.sheets = filterSheets(d.sheets);
  if (d.children) d.children = d.children.map((c) => ({ ...c, sheets: filterSheets(c.sheets) }));

  // ---- model overrides
  const models = modelNames(d.customSpice);
  for (const s of everySheet(d)) {
    for (const p of s.parts) {
      if (!p.modelOverride || models.has(p.modelOverride.toLowerCase())) continue;
      log.add('modelOverrideDropped', `${p.refdes || p.partId}: ${p.modelOverride}`);
      delete p.modelOverride;
    }
  }

  // ---- reference probes: a probe may only measure against a reference probe of its own level
  const fixProbes = (sheets: Sheet[]) => {
    const refs = new Set<string>();
    for (const s of sheets) for (const p of s.probes) if (p.kind === 'reference') refs.add(p.id);
    for (const s of sheets) {
      for (const p of s.probes) {
        if (p.refProbe === undefined || refs.has(p.refProbe)) continue;
        log.add('probeRefDropped', p.name || p.id);
        delete p.refProbe;
      }
    }
  };
  fixProbes(d.sheets);
  for (const c of d.children ?? []) fixProbes(c.sheets);

  // ---- per-net settings
  if (d.nets) {
    const nets: Record<string, NetSettings> = {};
    for (const [name, s] of Object.entries(d.nets)) {
      const kept: NetSettings = {};
      for (const [k, v] of Object.entries(s)) {
        if (v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
        (kept as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(kept).length && name.trim()) nets[name] = kept;
      else log.add('netSettingsDropped', name || '(empty)');
    }
    if (Object.keys(nets).length) d.nets = nets;
    else delete d.nets;
  }

  // ---- ERC options
  if (d.erc?.matrix) {
    const matrix: Record<string, ErcLevel> = {};
    const valid = new Set<string>();
    for (const a of ERC_PIN_TYPES) for (const b of ERC_PIN_TYPES) valid.add(pinPairKey(a, b));
    for (const [pair, level] of Object.entries(d.erc.matrix)) {
      if (valid.has(pair) && (level === 'ok' || level === 'warning' || level === 'error')) matrix[pair] = level;
      else log.add('ercOptionDropped', pair);
    }
    const erc = { ...d.erc };
    if (Object.keys(matrix).length) erc.matrix = matrix;
    else delete erc.matrix;
    d.erc = Object.keys(erc).length ? erc : undefined;
    if (d.erc === undefined) delete d.erc;
  }

  // ---- library references of parts nothing places
  if (d.libraryRefs) {
    const placed = new Set<string>();
    for (const s of everySheet(d)) for (const p of s.parts) placed.add(p.partId);
    const refs: Record<string, (typeof d.libraryRefs)[string]> = {};
    for (const [id, ref] of Object.entries(d.libraryRefs)) {
      if (placed.has(id)) refs[id] = ref;
      else log.add('libraryRefDropped', id);
    }
    if (Object.keys(refs).length) d.libraryRefs = refs;
    else delete d.libraryRefs;
  }

  // ---- ladder addresses (reported, never changed)
  for (const s of everySheet(d)) {
    if (!s.ladder?.length) continue;
    for (const a of ladderAddresses(s.ladder)) if (!ladderAddressInRange(a)) log.add('ladderAddressOutOfRange', a.trim());
  }

  if (log.empty) return { design, notes: [] };
  return { design: d, notes: log.notes };
}

// ---------------------------------------------------------------------------------------------
// a file being loaded
// ---------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const rawArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Sheets of a raw document (root sheets and the sheets of every child), as raw objects. */
function rawSheets(raw: Raw): Raw[] {
  const out: Raw[] = [];
  for (const s of rawArray(raw.sheets)) if (isObj(s)) out.push(s);
  for (const c of rawArray(raw.children)) if (isObj(c)) for (const s of rawArray(c.sheets)) if (isObj(s)) out.push(s);
  return out;
}

/**
 * Repair a raw (already migrated or not) design document so that {@link validateDesign} accepts
 * it: the design-scoped references a hand-edited or hand-merged file can get wrong are dropped.
 * A loader that meets one shows a note instead of refusing the file.
 *
 * Only references are touched. Structural damage (a sheet that is not an object, a rotation of 45°)
 * is still a hard error, because guessing there would quietly change the learner's circuit.
 */
export function repairRawDesign(input: unknown): { raw: unknown; notes: SanitizeNote[] } {
  if (!isObj(input)) return { raw: input, notes: [] };
  const log = new SanitizeLog();
  const raw = clone(input) as Raw;

  // ---- variants: ids of the list, the active one, and every notFitted reference
  const list = rawArray(isObj(raw.variants) ? raw.variants.list : undefined).filter(isObj);
  const ids = new Set(list.map((v) => (typeof v.id === 'string' ? v.id : '')).filter((x) => x !== ''));
  if (isObj(raw.variants)) {
    const active = raw.variants.active;
    if (typeof active === 'string' && !ids.has(active)) {
      log.add('activeVariantReset', active);
      const first = [...ids][0];
      if (first === undefined) delete raw.variants;
      else raw.variants = { ...raw.variants, active: first };
    }
    if (isObj(raw.variants) && !ids.size) {
      log.add('activeVariantReset', '(empty)');
      delete raw.variants;
    }
  }
  for (const sheet of rawSheets(raw)) {
    for (const p of rawArray(sheet.parts)) {
      if (!isObj(p)) continue;
      if (isObj(p.variantValues)) {
        const values = p.variantValues as Record<string, unknown>;
        for (const id of Object.keys(values)) {
          if (ids.has(id)) continue;
          log.add('variantDropped', `${typeof p.refdes === 'string' ? p.refdes : '?'}: ${id}`);
          delete values[id];
        }
        if (!Object.keys(values).length) delete p.variantValues;
      }
      if (!Array.isArray(p.notFitted)) continue;
      const keep = p.notFitted.filter((x) => typeof x === 'string' && ids.has(x));
      if (keep.length === p.notFitted.length) continue;
      for (const x of p.notFitted) if (typeof x !== 'string' || !ids.has(x)) log.add('variantDropped', `${typeof p.refdes === 'string' ? p.refdes : '?'}: ${String(x)}`);
      if (keep.length) p.notFitted = keep;
      else delete p.notFitted;
    }
  }

  // ---- ERC matrix: unknown pin-type pairs / levels would be refused
  if (isObj(raw.erc) && isObj(raw.erc.matrix)) {
    const valid = new Set<string>();
    for (const a of ERC_PIN_TYPES) for (const b of ERC_PIN_TYPES) valid.add(pinPairKey(a, b));
    const matrix: Record<string, unknown> = {};
    for (const [pair, level] of Object.entries(raw.erc.matrix)) {
      if (valid.has(pair) && (level === 'ok' || level === 'warning' || level === 'error')) matrix[pair] = level;
      else log.add('ercOptionDropped', pair);
    }
    const erc: Raw = { ...raw.erc };
    if (Object.keys(matrix).length) erc.matrix = matrix;
    else delete erc.matrix;
    raw.erc = erc;
  }

  // ---- per-net settings: an entry that is not an object, or a field of the wrong type
  if (isObj(raw.nets)) {
    const nets: Record<string, unknown> = {};
    const numberFields = ['traceWidth', 'clearance'];
    const textFields = ['color', 'note', 'layer', 'netClass'];
    for (const [name, value] of Object.entries(raw.nets)) {
      if (!isObj(value) || !name.trim()) {
        log.add('netSettingsDropped', name || '(empty)');
        continue;
      }
      const kept: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (numberFields.includes(k)) {
          if (typeof v === 'number' && Number.isFinite(v)) kept[k] = v;
        } else if (textFields.includes(k)) {
          if (typeof v === 'string' && v !== '') kept[k] = v;
        } else if (k === 'keepName') {
          if (typeof v === 'boolean') kept[k] = v;
        }
      }
      if (Object.keys(kept).length) nets[name] = kept;
      else log.add('netSettingsDropped', name);
    }
    if (Object.keys(nets).length) raw.nets = nets;
    else delete raw.nets;
  }

  // ---- blocks whose child design is missing: the part cannot be drawn at all
  const childIds = new Set(rawArray(raw.children).filter(isObj).map((c) => (typeof c.id === 'string' ? c.id : '')));
  for (const sheet of rawSheets(raw)) {
    if (!Array.isArray(sheet.parts)) continue;
    const parts = sheet.parts.filter((p) => {
      if (!isObj(p) || typeof p.partId !== 'string' || !p.partId.startsWith(BLOCK_PREFIX)) return true;
      if (childIds.has(p.partId.slice(BLOCK_PREFIX.length))) return true;
      log.add('blockMissing', typeof p.refdes === 'string' && p.refdes ? p.refdes : p.partId);
      return false;
    });
    if (parts.length !== sheet.parts.length) sheet.parts = parts;
  }

  // ---- duplicate ids: sheets and items are addressed by id across the whole file
  const seen = new Map<string, Set<string>>();
  const fresh = (kind: string, id: string): string => {
    const used = seen.get(kind)!;
    for (let n = 2; ; n++) {
      const next = `${id}_${n}`;
      if (!used.has(next)) return next;
    }
  };
  const unique = (kind: string, holder: Raw, key = 'id') => {
    if (!seen.has(kind)) seen.set(kind, new Set());
    const used = seen.get(kind)!;
    const id = holder[key];
    if (typeof id !== 'string' || id === '') return;
    if (!used.has(id)) {
      used.add(id);
      return;
    }
    const next = fresh(kind, id);
    log.add('idRenumbered', `${kind} ${id}`);
    holder[key] = next;
    used.add(next);
  };
  const itemKinds: [string, string][] = [
    ['parts', 'part'],
    ['wires', 'wire'],
    ['labels', 'label'],
    ['probes', 'probe'],
    ['notes', 'note'],
    ['shapes', 'shape'],
  ];
  for (const sheet of rawSheets(raw)) {
    unique('sheet', sheet);
    for (const [list, kind] of itemKinds) for (const item of rawArray(sheet[list])) if (isObj(item)) unique(kind, item);
  }

  return { raw, notes: log.notes };
}

/**
 * Validate a raw design document, repairing the design-scoped references when the strict
 * validator refuses it. Throws {@link DesignFormatError} only for damage the repair cannot
 * resolve, so the message the learner sees still says what is wrong with the file.
 */
export function validateDesignSafely(raw: unknown): { design: Design; notes: SanitizeNote[] } {
  try {
    return { design: validateDesign(raw), notes: [] };
  } catch (err) {
    if (!(err instanceof DesignFormatError)) throw err;
    const repaired = repairRawDesign(raw);
    if (!repaired.notes.length) throw err;
    // the repair must produce a valid design; when it does not, report the original problem
    let design: Design;
    try {
      design = validateDesign(repaired.raw);
    } catch {
      throw err;
    }
    return { design, notes: repaired.notes };
  }
}

/**
 * Parse a design file, repairing design-scoped references when needed (File > Open and every
 * other loader). A healthy file takes the strict path, so `serializeDesign(parseDesignSafely(t))`
 * is still `t` for every file MachSim wrote.
 */
export function parseDesignSafely(text: string): { design: Design; notes: SanitizeNote[] } {
  try {
    return { design: parseDesign(text), notes: [] };
  } catch (err) {
    if (!(err instanceof DesignFormatError)) throw err;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw err;
    }
    const repaired = repairRawDesign(raw);
    if (!repaired.notes.length) throw err;
    let design: Design;
    try {
      // the repaired document still needs the migration chain (version 0 / 1 files)
      design = parseDesign(JSON.stringify(repaired.raw));
    } catch {
      throw err;
    }
    return { design, notes: repaired.notes };
  }
}

/** The design version this module writes when it builds a document from a fragment. */
export const SANITIZE_DESIGN_VERSION = CURRENT_DESIGN_VERSION;
