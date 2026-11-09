/**
 * Circuit snippets: a PNG picture of selected parts and wires that carries the circuit itself
 * (Edit > Save selection as snippet; File > Snippets). Any PNG viewer shows the picture; MachSim
 * reads the circuit back from a PNG text chunk and places it again.
 *
 * Storage: one uncompressed iTXt chunk (src/util/png.ts) with keyword SNIPPET_KEYWORD
 * ("MachSim-snippet") holding UTF-8 JSON:
 *
 *   { "format": "machsim-snippet", "version": 1, "savedBy": "MachSim 0.1.0",
 *     "created": "<ISO 8601>", "title": "<design title>",
 *     "fragment": { parts, wires, labels, probes, notes, shapes?, children?, anchor },
 *     "customParts"?: [...], "variables"?: { name: expr }, "variants"?: { list, active? },
 *     "customSpice"?: "<.model / .subckt text>", "nets"?: { "<net>": { color, … } } }
 *
 * The fragment has the shape of the editor clipboard (coordinates as on the source sheet, anchor =
 * grid-snapped top-left corner). `children` are the child designs of copied hierarchical blocks,
 * `customParts` the user components the parts use, `variables` the global parameters their values
 * refer to, `variants` the assembly variants the copied parts are not fitted in (otherwise the
 * `PartInstance.notFitted` ids would name variants nothing declares, and the snippet would not
 * load) and `customSpice` the design's model text when a part has a model override.
 * The PNG chunk CRC-32 is checked on reading; the fragment is validated with the design-file
 * validator (src/model/serialize.ts), so a snippet can never load what a .msim could not.
 *
 * Which variables a value refers to is decided exactly as src/model/variables.ts evaluates it:
 * names are matched case-insensitively, a NUMBER parameter may be the bare name of a variable (or
 * a bare expression), and a variable that is defined through other variables brings those along.
 * Anything less and the snippet would fail ERC with "undefined parameter" where the design it came
 * from simulated.
 *
 *   buildSnippet(design, fragment, now)    SnippetData for a copied fragment
 *   encodeSnippet(png, data)               PNG bytes with the snippet chunk
 *   decodeSnippet(bytes)                   SnippetData, or SnippetError (code says why)
 *   snippetDesign(data, title, sheetName)  a whole design holding the snippet (open as new design)
 */
import type { CustomPartData } from '../library/custom/types';
import { isCustomPartId } from '../library/custom/types';
import { isPng, pngTexts, PngError, readPngChunks, withTextChunk } from '../util/png';
import { SAVED_BY } from './appInfo';
import { BLOCK_PREFIX } from './hierarchy';
import { CURRENT_DESIGN_VERSION, DesignFormatError, validateDesign } from './serialize';
import type { ChildDesign, Design, DesignVariants, NetLabel, NetSettings, PartInstance, Point, Probe, Shape, TextNote, Wire } from './types';
import { newDesign } from './types';
import { fragmentNetNames, neededVariables } from './sanitize';
import { netSettings } from './netSettings';

export const SNIPPET_KEYWORD = 'MachSim-snippet';
export const SNIPPET_FORMAT = 'machsim-snippet';
export const SNIPPET_VERSION = 1;

/** Copied schematic items (the editor's Clipboard shape). */
export interface SnippetFragment {
  parts: PartInstance[];
  wires: Wire[];
  labels: NetLabel[];
  probes: Probe[];
  notes: TextNote[];
  shapes?: Shape[];
  children?: ChildDesign[];
  anchor: Point;
}

export interface SnippetData {
  format: typeof SNIPPET_FORMAT;
  version: number;
  savedBy: string;
  created: string;
  title: string;
  fragment: SnippetFragment;
  customParts?: CustomPartData[];
  variables?: Record<string, string>;
  /** assembly variants the copied parts refer to through `PartInstance.notFitted` */
  variants?: DesignVariants;
  customSpice?: string;
  /** per-net settings (colour, PCB properties) of the nets the copied labels name */
  nets?: Record<string, NetSettings>;
}

export type SnippetErrorCode = 'not-png' | 'no-data' | 'damaged' | 'newer' | 'invalid';

export class SnippetError extends Error {
  readonly code: SnippetErrorCode;
  readonly issues: string[];
  constructor(code: SnippetErrorCode, message: string, issues: string[] = []) {
    super(message);
    this.name = 'SnippetError';
    this.code = code;
    this.issues = issues;
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Snippet data for a copied fragment of `design`: the user components and child designs the
 * parts use, the global parameters their values refer to and (when a part overrides its model)
 * the design's custom SPICE text. Hidden practice faults are left out (they would give the
 * answer away).
 */
export function buildSnippet(design: Design, fragment: SnippetFragment, now: Date = new Date()): SnippetData {
  const frag = clone(fragment);
  // the editor clipboard carries the source design's references with it (Clipboard.extras); the
  // snippet writes them as its own top-level fields instead, so the chunk holds them only once
  delete (frag as { extras?: unknown }).extras;
  for (const p of frag.parts) {
    if (p.faults) {
      const shown = p.faults.filter((f) => !f.hidden);
      if (shown.length) p.faults = shown;
      else delete p.faults;
    }
  }
  const all: PartInstance[] = [...frag.parts, ...(frag.children ?? []).flatMap((c) => c.sheets.flatMap((s) => s.parts))];
  const customIds = new Set(all.filter((p) => isCustomPartId(p.partId)).map((p) => p.partId));
  const customParts = (design.customParts ?? []).filter((c) => customIds.has(c.id)).map(clone);
  // the global parameters the copied values need, closed over the definitions they use
  // (src/model/sanitize.ts owns that rule, so paste and snippets answer the same)
  const used = neededVariables(all, design.variables);
  const data: SnippetData = {
    format: SNIPPET_FORMAT,
    version: SNIPPET_VERSION,
    savedBy: SAVED_BY,
    created: now.toISOString(),
    title: design.title,
    fragment: frag,
  };
  if (customParts.length) data.customParts = customParts;
  if (used.length) data.variables = Object.fromEntries(used.map((n) => [n, design.variables[n]]));
  // assembly variants: a copied part that is "not fitted" names variant ids, so the snippet has to
  // declare them (a part may only name variants its design has — src/model/serialize.ts)
  const notFitted = new Set<string>();
  for (const p of all) for (const id of p.notFitted ?? []) notFitted.add(id);
  const list = (design.variants?.list ?? []).filter((v) => notFitted.has(v.id)).map(clone);
  if (list.length) {
    const active = design.variants?.active;
    data.variants = { list, ...(active !== undefined && list.some((v) => v.id === active) ? { active } : {}) };
  } else if (notFitted.size) {
    // ids nobody declares (a design edited by hand): drop them instead of writing a broken snippet
    for (const p of frag.parts) delete p.notFitted;
    for (const c of frag.children ?? []) for (const s of c.sheets) for (const p of s.parts) delete p.notFitted;
  }
  if (design.customSpice?.trim() && all.some((p) => p.modelOverride)) data.customSpice = design.customSpice;
  // per-net settings: a copied net keeps its colour and PCB properties where it is placed again
  const nets: Record<string, NetSettings> = {};
  for (const name of fragmentNetNames(frag)) {
    const s = netSettings(design, name);
    if (s && Object.keys(s).length) nets[name] = clone(s);
  }
  if (Object.keys(nets).length) data.nets = nets;
  return data;
}

/** The snippet chunk text (JSON). */
export function snippetText(data: SnippetData): string {
  return JSON.stringify(data);
}

/** PNG bytes with the snippet embedded (an existing snippet chunk is replaced). */
export function encodeSnippet(png: Uint8Array, data: SnippetData): Uint8Array {
  return withTextChunk(png, SNIPPET_KEYWORD, snippetText(data));
}

/**
 * Validate a raw snippet object: the fragment is checked as the only sheet of a design (ids,
 * points, parameters, child designs, user components…) and returned with the validator's defaults.
 */
export function readSnippet(raw: unknown): SnippetData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnippetError('invalid', 'the snippet is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (o.format !== SNIPPET_FORMAT) throw new SnippetError('invalid', `not a MachSim snippet (format ${JSON.stringify(o.format)})`);
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) throw new SnippetError('invalid', `bad snippet version ${JSON.stringify(o.version)}`);
  if (o.version > SNIPPET_VERSION) throw new SnippetError('newer', `the snippet was written by a newer MachSim (snippet version ${o.version})`);
  const f = o.fragment as Record<string, unknown> | undefined;
  if (typeof f !== 'object' || f === null) throw new SnippetError('invalid', 'the snippet has no circuit fragment');
  const anchor = f.anchor as Record<string, unknown> | undefined;
  if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number' || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) throw new SnippetError('invalid', 'the snippet fragment has no anchor point');
  const variables = (typeof o.variables === 'object' && o.variables !== null ? o.variables : {}) as Record<string, unknown>;
  let checked: Design;
  try {
    checked = validateDesign({
      format: 'machsim-design',
      version: CURRENT_DESIGN_VERSION,
      title: typeof o.title === 'string' ? o.title : '',
      sheets: [{ id: '__snippet__', name: 'snippet', parts: f.parts, wires: f.wires, labels: f.labels, probes: f.probes, notes: f.notes, ...(f.shapes !== undefined ? { shapes: f.shapes } : {}) }],
      analysis: undefined,
      options: undefined,
      variables,
      ...(o.variants !== undefined ? { variants: o.variants } : {}),
      ...(o.nets !== undefined ? { nets: o.nets } : {}),
      ...(f.children !== undefined ? { children: f.children } : {}),
      ...(o.customParts !== undefined ? { customParts: o.customParts } : {}),
      ...(typeof o.customSpice === 'string' ? { customSpice: o.customSpice } : {}),
    });
  } catch (err) {
    if (err instanceof DesignFormatError) throw new SnippetError('invalid', 'the snippet circuit is damaged', err.issues.map((i) => i.replace(/^sheets\[0\]\./, 'fragment.')));
    throw err;
  }
  const sheet = checked.sheets[0];
  const fragment: SnippetFragment = { parts: sheet.parts, wires: sheet.wires, labels: sheet.labels, probes: sheet.probes, notes: sheet.notes, anchor: { x: anchor.x, y: anchor.y } };
  if (sheet.shapes?.length) fragment.shapes = sheet.shapes;
  if (checked.children?.length) fragment.children = checked.children;
  // every block of the fragment needs its child design
  const childIds = new Set((checked.children ?? []).map((c) => c.id));
  for (const p of [...sheet.parts, ...(checked.children ?? []).flatMap((c) => c.sheets.flatMap((s) => s.parts))]) {
    if (p.partId.startsWith(BLOCK_PREFIX) && !childIds.has(p.partId.slice(BLOCK_PREFIX.length))) throw new SnippetError('invalid', `block ${p.refdes} has no child design in the snippet`);
  }
  const data: SnippetData = {
    format: SNIPPET_FORMAT,
    version: o.version,
    savedBy: typeof o.savedBy === 'string' ? o.savedBy : '',
    created: typeof o.created === 'string' ? o.created : '',
    title: checked.title,
    fragment,
  };
  if (checked.customParts?.length) data.customParts = checked.customParts;
  if (Object.keys(checked.variables).length) data.variables = checked.variables;
  if (checked.variants?.list.length) data.variants = checked.variants;
  if (checked.customSpice) data.customSpice = checked.customSpice;
  if (checked.nets && Object.keys(checked.nets).length) data.nets = checked.nets;
  return data;
}

/**
 * The snippet carried by a PNG file. Errors: 'not-png' (not a PNG at all), 'damaged' (truncated or
 * a CRC mismatch), 'no-data' (a PNG without MachSim data, e.g. a screenshot), 'newer' (written by
 * a newer MachSim), 'invalid' (the circuit data does not validate).
 */
export function decodeSnippet(bytes: Uint8Array): SnippetData {
  if (!isPng(bytes)) throw new SnippetError('not-png', 'not a PNG file');
  let chunks;
  try {
    chunks = readPngChunks(bytes);
  } catch (err) {
    if (err instanceof PngError) throw new SnippetError('damaged', err.message);
    throw err;
  }
  const text = pngTexts(chunks).find((x) => x.keyword === SNIPPET_KEYWORD)?.text;
  if (text === undefined) throw new SnippetError('no-data', 'the picture holds no MachSim circuit');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SnippetError('damaged', `the snippet data is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  return readSnippet(raw);
}

/** True when the PNG carries a MachSim snippet chunk (without validating it). */
export function hasSnippet(bytes: Uint8Array): boolean {
  try {
    return pngTexts(readPngChunks(bytes)).some((x) => x.keyword === SNIPPET_KEYWORD);
  } catch {
    return false;
  }
}

/** A new design whose first sheet holds the snippet as saved (File > Snippets > Open as design). */
export function snippetDesign(data: SnippetData, title: string, sheetName: string): Design {
  const d = newDesign(title);
  const sheet = d.sheets[0];
  sheet.name = sheetName;
  const f = clone(data.fragment);
  sheet.parts = f.parts;
  sheet.wires = f.wires;
  sheet.labels = f.labels;
  sheet.probes = f.probes;
  sheet.notes = f.notes;
  if (f.shapes?.length) sheet.shapes = f.shapes;
  if (f.children?.length) d.children = f.children;
  if (data.customParts?.length) d.customParts = clone(data.customParts);
  if (data.variables) d.variables = { ...data.variables };
  if (data.variants?.list.length) d.variants = clone(data.variants);
  if (data.customSpice) d.customSpice = data.customSpice;
  if (data.nets && Object.keys(data.nets).length) d.nets = clone(data.nets);
  // validated again as a whole design (ids of the fragment are unique by construction)
  return validateDesign(JSON.parse(JSON.stringify(d)));
}

/** Snippet file name for a design title: "<title> - snippet.png" (Windows-safe). */
export function snippetFileName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (title.trim() || 'snippet').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return `${base || 'snippet'} - snippet.png`;
}
