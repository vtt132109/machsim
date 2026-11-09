/**
 * Design file (.msim, JSON) serialisation (CONTRACT API, owned by the library/netlister team).
 *
 *   serializeDesign(design) -> pretty-printed JSON text
 *   parseDesign(text)       -> Design (migrated to the current format version, validated, with
 *                              defaults filled in for optional fields)
 *
 * Validation reports every problem it finds with a JSON path, e.g.
 *   "sheets[0].parts[2].rotation: must be 0, 90, 180 or 270 (got 45)"
 * and throws a DesignFormatError (message = summary, `issues` = full list). Sheet ids, and the
 * ids of parts, wires, labels, probes and notes (per kind), must be unique in the whole design.
 *
 * Defaults: title 'Untitled'; sheet name 'Sheet <n>'; empty parts / wires / labels / probes / notes;
 * part rotation 0, mirror false, params {}, refdes ''; label rotation 0; probe name '' and colour
 * '#e53935'; analysis settings / options / variables as in newDesign(). Numeric parameter values are
 * converted to text. Rotations that are multiples of 90 are normalised into 0..270.
 *
 * Migration hook: MIGRATIONS[n] converts a version-n document into version n + 1. Version 0 is
 * the pre-header layout (a bare { title, sheets, ... } object without "format" / "version").
 * Version 1 -> 2: net labels became local to their sheet (v2 adds connectors, buses, hierarchy,
 * annotations, sheet properties, title block and print setup), so every version-1 label is
 * marked `global: true`, which keeps its old "same name on every sheet" behaviour.
 * Files written by a newer MachSim (version > CURRENT_DESIGN_VERSION) are rejected.
 *
 * Version-2 fields are optional and only written when present, so a design that uses none of
 * them round-trips to the same JSON. Later optional fields follow the same rule: user components
 * (`customParts`, validated by src/library/custom/validate.ts), per-part `modelOverride` and BOM /
 * PCB `fields`, the description box (`descriptionBox`: rich text, images, student questions and
 * answers), the instructor `restrictions` (password hash, never the password), the save history
 * `meta` (created / modified / savedBy, File > File information) and the Grapher pages kept with
 * the design (`grapher`: runs with their plotted vectors, pages and their properties), the design
 * variants (`variants` + per-part `notFitted`; a part may only name variants the design has) and
 * the library references of placed parts (`libraryRefs`, Update components from library). Sheet
 * ids and item ids must be unique across the root sheets and the sheets of every child design.
 */

import type { BreadboardLayout } from '../breadboard/types';
import type {
  AnalysisSettings,
  AutoFaultInfo,
  ChildDesign,
  Design,
  LabelKind,
  NetLabel,
  PaperSize,
  PartInstance,
  Point,
  PrintSetup,
  PinFault,
  Probe,
  ProbeKind,
  Rotation,
  Shape,
  ShapeKind,
  Sheet,
  SheetColors,
  SheetProps,
  TextNote,
  TextStyle,
  TitleBlockFields,
  Wire,
  DigitalSimSettings,
  InteractiveSettings,
  PartFields,
  DescriptionBox,
  DescriptionImage,
  StudentQuestion,
  QuestionKind,
  DesignRestrictions,
  DesignMeta,
  SavedGrapher,
  SavedPage,
  SavedResult,
  SavedRun,
  SavedVector,
  DesignVariant,
  DesignVariants,
  VariantValues,
  PartLibraryRef,
  NetSettings,
  RefdesRules,
  SheetLayers,
} from './types';
import { newDesign } from './types';
import type { LadderBlock, LadderContactKind, LadderCompareOp, LadderNode, LadderOutput, LadderOutputKind, LadderRung } from '../ladder/types';
import { ERC_PIN_TYPES, pinPairKey, type ErcLevel, type ErcPinType, type ErcSettings, type HiddenPowerMode } from './ercMatrix';
import type { CustomPartData } from '../library/custom/types';
import { readCustomPart } from '../library/custom/validate';

export const CURRENT_DESIGN_VERSION = 2;

export class DesignFormatError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    const head = issues.slice(0, 5).join('; ');
    super(`Invalid MachSim design file: ${head}${issues.length > 5 ? ` (and ${issues.length - 5} more)` : ''}`);
    this.name = 'DesignFormatError';
    this.issues = issues;
  }
}

type Raw = Record<string, unknown>;
export type DesignMigration = (raw: Raw) => Raw;

/** Version 1 -> 2: every label keeps its version-1 global behaviour. */
function migrateV1Labels(raw: Raw): Raw {
  if (!Array.isArray(raw.sheets)) return { ...raw, version: 2 };
  const sheets = raw.sheets.map((s: unknown) => {
    if (!isObj(s) || !Array.isArray(s.labels)) return s;
    return { ...s, labels: s.labels.map((l: unknown) => (isObj(l) && l.kind === undefined && l.global === undefined ? { ...l, global: true } : l)) };
  });
  return { ...raw, sheets, version: 2 };
}

export const MIGRATIONS: Record<number, DesignMigration> = {
  0: (raw) => ({ ...raw, format: 'machsim-design', version: 1 }),
  1: migrateV1Labels,
};

export function serializeDesign(design: Design): string {
  return JSON.stringify(design, null, 2);
}

export function parseDesign(text: string): Design {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new DesignFormatError([`not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  return validateDesign(migrateDesign(raw));
}

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bring a raw document up to CURRENT_DESIGN_VERSION (throws for unknown formats / newer versions). */
export function migrateDesign(input: unknown): Raw {
  if (!isObj(input)) throw new DesignFormatError(['the file does not contain a JSON object']);
  let raw: Raw = input;
  if (raw.format === undefined && raw.version === undefined) {
    if (!Array.isArray(raw.sheets)) throw new DesignFormatError(['Not a MachSim design file (no "format" header and no sheets)']);
    raw = { ...raw, version: 0 };
  } else if (raw.format !== 'machsim-design') {
    throw new DesignFormatError([`Not a MachSim design file (format is ${JSON.stringify(raw.format)})`]);
  }
  const declared = raw.version;
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 0) throw new DesignFormatError([`version: expected a non-negative integer (got ${JSON.stringify(declared)})`]);
  let version: number = declared;
  if (version > CURRENT_DESIGN_VERSION) {
    throw new DesignFormatError([`the file was written by a newer MachSim (format version ${version}); this version reads up to ${CURRENT_DESIGN_VERSION}`]);
  }
  while (version < CURRENT_DESIGN_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new DesignFormatError([`no migration from format version ${version}`]);
    raw = step(raw);
    const next = raw.version;
    if (typeof next !== 'number' || next <= version) throw new DesignFormatError([`migration from version ${version} did not advance the version`]);
    version = next;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PROBE_KINDS: ProbeKind[] = ['voltage', 'current', 'power', 'differential', 'digital', 'reference'];
const PROBE_READINGS = ['value', 'pp', 'rms', 'dc', 'freq'];

class Checker {
  readonly issues: string[] = [];

  issue(path: string, msg: string): void {
    this.issues.push(`${path}: ${msg}`);
  }

  str(o: Raw, key: string, path: string, def?: string): string {
    const v = o[key];
    if (v === undefined || v === null) {
      if (def !== undefined) return def;
      this.issue(`${path}.${key}`, 'is required');
      return '';
    }
    if (typeof v === 'number') return String(v);
    if (typeof v !== 'string') {
      this.issue(`${path}.${key}`, `expected text (got ${typeof v})`);
      return def ?? '';
    }
    return v;
  }

  num(o: Raw, key: string, path: string, def?: number): number {
    const v = o[key];
    if (v === undefined || v === null) {
      if (def !== undefined) return def;
      this.issue(`${path}.${key}`, 'is required');
      return 0;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.issue(`${path}.${key}`, `expected a finite number (got ${JSON.stringify(v)})`);
      return def ?? 0;
    }
    return v;
  }

  bool(o: Raw, key: string, path: string): boolean | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'boolean') {
      this.issue(`${path}.${key}`, `expected true or false (got ${JSON.stringify(v)})`);
      return undefined;
    }
    return v;
  }

  rotation(o: Raw, key: string, path: string): Rotation {
    const v = o[key];
    if (v === undefined || v === null) return 0;
    if (typeof v !== 'number' || !Number.isFinite(v) || v % 90 !== 0) {
      this.issue(`${path}.${key}`, `must be 0, 90, 180 or 270 (got ${JSON.stringify(v)})`);
      return 0;
    }
    return ((((v % 360) + 360) % 360) as Rotation);
  }

  point(v: unknown, path: string): Point | null {
    if (!isObj(v)) {
      this.issue(path, 'expected a point { x, y }');
      return null;
    }
    return { x: this.num(v, 'x', path), y: this.num(v, 'y', path) };
  }

  array(o: Raw, key: string, path: string): unknown[] {
    const v = o[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      this.issue(`${path}.${key}`, 'expected an array');
      return [];
    }
    return v;
  }

  record(o: Raw, key: string, path: string): Record<string, string> {
    const v = o[key];
    if (v === undefined || v === null) return {};
    if (!isObj(v)) {
      this.issue(`${path}.${key}`, 'expected an object of text values');
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string') out[k] = val;
      else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
      else this.issue(`${path}.${key}.${k}`, `expected text (got ${val === null ? 'null' : typeof val})`);
    }
    return out;
  }

  obj(v: unknown, path: string): Raw | null {
    if (!isObj(v)) {
      this.issue(path, 'expected an object');
      return null;
    }
    return v;
  }
}

function part(c: Checker, v: unknown, path: string): PartInstance | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const p: PartInstance = {
    id: c.str(o, 'id', path),
    partId: c.str(o, 'partId', path),
    refdes: c.str(o, 'refdes', path, ''),
    x: c.num(o, 'x', path),
    y: c.num(o, 'y', path),
    rotation: c.rotation(o, 'rotation', path),
    mirror: c.bool(o, 'mirror', path) ?? false,
    params: c.record(o, 'params', path),
  };
  for (const k of ['refOffset', 'valueOffset'] as const) {
    if (o[k] !== undefined) {
      const pt = c.point(o[k], `${path}.${k}`);
      if (pt) p[k] = pt;
    }
  }
  for (const k of ['hideRef', 'hideValue', 'excludeFromSim', 'excludeFromBom'] as const) {
    const b = c.bool(o, k, path);
    if (b !== undefined) p[k] = b;
  }
  editable(c, o, path, p);
  if (o.modelOverride !== undefined && o.modelOverride !== null) {
    const m = c.str(o, 'modelOverride', path);
    if (m.trim()) p.modelOverride = m;
  }
  if (o.faults !== undefined && o.faults !== null) {
    const faults = c
      .array(o, 'faults', path)
      .map((v, i) => pinFault(c, v, `${path}.faults[${i}]`))
      .filter((f): f is PinFault => f !== null);
    if (faults.length) p.faults = faults;
  }
  if (o.notFitted !== undefined && o.notFitted !== null) {
    const ids = c.array(o, 'notFitted', path).filter((x, i): x is string => {
      if (typeof x === 'string' && x) return true;
      c.issue(`${path}.notFitted[${i}]`, 'expected a variant id');
      return false;
    });
    if (ids.length) p.notFitted = [...new Set(ids)];
  }
  if (o.ncPins !== undefined && o.ncPins !== null) {
    const pins = c.array(o, 'ncPins', path).filter((x, i): x is string => {
      if (typeof x === 'string' && x.trim()) return true;
      c.issue(`${path}.ncPins[${i}]`, 'expected a pin name');
      return false;
    });
    if (pins.length) p.ncPins = [...new Set(pins)].sort();
  }
  if (o.inner !== undefined && o.inner !== null) {
    const io = c.obj(o.inner, `${path}.inner`);
    if (io) {
      const inner: Record<string, Record<string, string>> = {};
      for (const key of Object.keys(io)) {
        const rec = c.record(io, key, `${path}.inner`);
        if (key.trim() && Object.keys(rec).length) inner[key] = rec;
      }
      if (Object.keys(inner).length) p.inner = inner;
    }
  }
  if (o.fields !== undefined && o.fields !== null) {
    const fo = c.obj(o.fields, `${path}.fields`);
    if (fo) {
      const f: PartFields = {};
      for (const k of PART_FIELD_KEYS) if (fo[k] !== undefined && fo[k] !== null) f[k] = c.str(fo, k, `${path}.fields`);
      for (const k of Object.keys(fo)) if (!(PART_FIELD_KEYS as readonly string[]).includes(k)) c.issue(`${path}.fields.${k}`, `unknown field (expected ${PART_FIELD_KEYS.join(', ')})`);
      p.fields = f;
    }
  }
  if (o.variantValues !== undefined && o.variantValues !== null) {
    const vo = c.obj(o.variantValues, `${path}.variantValues`);
    if (vo) {
      const values: Record<string, VariantValues> = {};
      for (const id of Object.keys(vo)) {
        const where = `${path}.variantValues.${id}`;
        const e = c.obj(vo[id], where);
        if (!e) continue;
        const entry: VariantValues = {};
        const params = c.record(e, 'params', where);
        if (Object.keys(params).length) entry.params = params;
        if (e.fields !== undefined && e.fields !== null) {
          const fo = c.obj(e.fields, `${where}.fields`);
          if (fo) {
            const f: PartFields = {};
            for (const k of PART_FIELD_KEYS) if (fo[k] !== undefined && fo[k] !== null) f[k] = c.str(fo, k, `${where}.fields`);
            for (const k of Object.keys(fo)) if (!(PART_FIELD_KEYS as readonly string[]).includes(k)) c.issue(`${where}.fields.${k}`, `unknown field (expected ${PART_FIELD_KEYS.join(', ')})`);
            if (Object.keys(f).length) entry.fields = f;
          }
        }
        for (const k of Object.keys(e)) if (k !== 'params' && k !== 'fields') c.issue(`${where}.${k}`, 'unknown entry (expected params, fields)');
        if (entry.params || entry.fields) values[id] = entry;
      }
      if (Object.keys(values).length) p.variantValues = values;
    }
  }
  return p;
}

const PART_FIELD_KEYS = ['manufacturer', 'partNumber', 'supplier', 'footprint'] as const;

/** One injected pin fault (PartInstance.faults). */
function pinFault(c: Checker, v: unknown, path: string): PinFault | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const kind = oneOf(c, o, 'kind', path, ['open', 'short', 'leak'] as const);
  if (!kind) {
    if (o.kind === undefined) c.issue(`${path}.kind`, 'is required');
    return null;
  }
  const f: PinFault = { pin: c.str(o, 'pin', path), kind };
  if (o.to !== undefined && o.to !== null) f.to = c.str(o, 'to', path);
  if (o.r !== undefined && o.r !== null) {
    const r = c.num(o, 'r', path);
    if (!(r > 0)) c.issue(`${path}.r`, 'must be > 0');
    else f.r = r;
  }
  if (kind !== 'open' && f.to === undefined) c.issue(`${path}.to`, `is required for a ${kind} fault`);
  const hidden = c.bool(o, 'hidden', path);
  if (hidden !== undefined) f.hidden = hidden;
  return f;
}

/** Optional `locked` / `group` of any editable item (v2). */
function editable(c: Checker, o: Raw, path: string, target: { locked?: boolean; group?: string }): void {
  const locked = c.bool(o, 'locked', path);
  if (locked !== undefined) target.locked = locked;
  if (o.group !== undefined && o.group !== null) target.group = c.str(o, 'group', path);
}

function oneOf<T extends string>(c: Checker, o: Raw, key: string, path: string, allowed: readonly T[]): T | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    c.issue(`${path}.${key}`, `must be one of ${allowed.join(', ')} (got ${JSON.stringify(v)})`);
    return undefined;
  }
  return v as T;
}

function wire(c: Checker, v: unknown, path: string): Wire | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const pts = c.array(o, 'points', path);
  if (pts.length < 2) c.issue(`${path}.points`, `a wire needs at least 2 points (got ${pts.length})`);
  const points = pts.map((p, i) => c.point(p, `${path}.points[${i}]`)).filter((p): p is Point => p !== null);
  const w: Wire = { id: c.str(o, 'id', path), points };
  if (o.color !== undefined) w.color = c.str(o, 'color', path);
  const bus = c.bool(o, 'bus', path);
  if (bus !== undefined) w.bus = bus;
  if (o.busName !== undefined && o.busName !== null) w.busName = c.str(o, 'busName', path);
  editable(c, o, path, w);
  return w;
}

const LABEL_KINDS: LabelKind[] = ['label', 'offpage', 'hier', 'global', 'bus-entry'];

function label(c: Checker, v: unknown, path: string): NetLabel | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const l: NetLabel = { id: c.str(o, 'id', path), x: c.num(o, 'x', path), y: c.num(o, 'y', path), name: c.str(o, 'name', path), rotation: c.rotation(o, 'rotation', path) };
  const kind = oneOf(c, o, 'kind', path, LABEL_KINDS);
  if (kind !== undefined) l.kind = kind;
  const global = c.bool(o, 'global', path);
  if (global !== undefined) l.global = global;
  editable(c, o, path, l);
  return l;
}

function probe(c: Checker, v: unknown, path: string): Probe | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const kind = c.str(o, 'kind', path, 'voltage') as ProbeKind;
  if (!PROBE_KINDS.includes(kind)) c.issue(`${path}.kind`, `must be one of ${PROBE_KINDS.join(', ')} (got ${JSON.stringify(kind)})`);
  const p: Probe = { id: c.str(o, 'id', path), kind, x: c.num(o, 'x', path), y: c.num(o, 'y', path), name: c.str(o, 'name', path, ''), color: c.str(o, 'color', path, '#e53935') };
  if (o.ref !== undefined) {
    const r = c.point(o.ref, `${path}.ref`);
    if (r) p.ref = r;
  }
  if (o.refProbe !== undefined && o.refProbe !== null) p.refProbe = c.str(o, 'refProbe', path);
  if (o.show !== undefined && o.show !== null) {
    if (Array.isArray(o.show) && o.show.every((x) => typeof x === 'string' && PROBE_READINGS.includes(x))) p.show = o.show as Probe['show'];
    else c.issue(`${path}.show`, `expected a list of ${PROBE_READINGS.join(', ')}`);
  }
  return p;
}

/** Optional drawing order (Edit > Order) of a note or shape: a finite integer. */
function drawOrder(c: Checker, o: Raw, path: string): number | undefined {
  if (o.z === undefined || o.z === null) return undefined;
  const z = c.num(o, 'z', path);
  if (!Number.isInteger(z)) {
    c.issue(`${path}.z`, `must be a whole number (got ${z})`);
    return undefined;
  }
  return z;
}

const LAYER_KEYS = ['grid', 'refdes', 'values', 'labels', 'netNames', 'pinNumbers', 'comments', 'graphics'] as const;

/** Sheet.layers: only the keys that differ from the defaults are kept (src/model/layers.ts). */
function sheetLayers(c: Checker, v: unknown, path: string): SheetLayers | undefined {
  const o = c.obj(v, path);
  if (!o) return undefined;
  const out: SheetLayers = {};
  for (const k of Object.keys(o)) if (!(LAYER_KEYS as readonly string[]).includes(k)) c.issue(`${path}.${k}`, `unknown layer (expected ${LAYER_KEYS.join(', ')})`);
  for (const k of LAYER_KEYS) {
    const b = c.bool(o, k, path);
    if (b !== undefined) out[k] = b;
  }
  return out;
}

/** Design.refdesRules: texts only (letters, digits, "_"); whether they make sense is src/model/refdesRules.ts. */
function refdesRules(c: Checker, v: unknown): RefdesRules | undefined {
  const o = c.obj(v, 'refdesRules');
  if (!o) return undefined;
  const out: RefdesRules = {};
  if (o.global !== undefined && o.global !== null) {
    const g = c.str(o, 'global', 'refdesRules');
    if (g) out.global = g;
  }
  if (o.map !== undefined && o.map !== null) {
    const map = c.record(o, 'map', 'refdesRules');
    if (Object.keys(map).length) out.map = map;
  }
  return out.global || out.map ? out : undefined;
}

function note(c: Checker, v: unknown, path: string): TextNote | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const n: TextNote = { id: c.str(o, 'id', path), x: c.num(o, 'x', path), y: c.num(o, 'y', path), text: c.str(o, 'text', path, '') };
  if (o.size !== undefined) n.size = c.num(o, 'size', path);
  if (o.style !== undefined && o.style !== null) {
    const so = c.obj(o.style, `${path}.style`);
    if (so) {
      const st: TextStyle = {};
      const font = oneOf(c, so, 'font', `${path}.style`, ['sans', 'serif', 'mono'] as const);
      if (font) st.font = font;
      for (const k of ['bold', 'italic', 'underline'] as const) {
        const b = c.bool(so, k, `${path}.style`);
        if (b !== undefined) st[k] = b;
      }
      if (so.color !== undefined && so.color !== null) st.color = c.str(so, 'color', `${path}.style`);
      const align = oneOf(c, so, 'align', `${path}.style`, ['start', 'middle', 'end'] as const);
      if (align) st.align = align;
      n.style = st;
    }
  }
  for (const k of ['comment', 'collapsed'] as const) {
    const b = c.bool(o, k, path);
    if (b !== undefined) n[k] = b;
  }
  for (const k of ['author', 'created'] as const) if (o[k] !== undefined && o[k] !== null) n[k] = c.str(o, k, path);
  editable(c, o, path, n);
  const z = drawOrder(c, o, path);
  if (z !== undefined) n.z = z;
  return n;
}

const SHAPE_KINDS: ShapeKind[] = ['line', 'polyline', 'rect', 'ellipse', 'arc', 'polygon', 'picture'];

function shape(c: Checker, v: unknown, path: string): Shape | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const kind = oneOf(c, o, 'kind', path, SHAPE_KINDS);
  if (kind === undefined && o.kind === undefined) c.issue(`${path}.kind`, 'is required');
  const pts = c.array(o, 'points', path);
  const points = pts.map((p, i) => c.point(p, `${path}.points[${i}]`)).filter((p): p is Point => p !== null);
  const min = kind === 'polygon' ? 3 : 2;
  if (pts.length < min) c.issue(`${path}.points`, `a ${kind ?? 'shape'} needs at least ${min} points (got ${pts.length})`);
  const sh: Shape = { id: c.str(o, 'id', path), kind: kind ?? 'line', points };
  for (const k of ['stroke', 'fill'] as const) if (o[k] !== undefined && o[k] !== null) sh[k] = c.str(o, k, path);
  for (const k of ['strokeWidth', 'start', 'end'] as const) if (o[k] !== undefined && o[k] !== null) sh[k] = c.num(o, k, path);
  const dash = oneOf(c, o, 'dash', path, ['solid', 'dash', 'dot'] as const);
  if (dash) sh.dash = dash;
  if (o.src !== undefined && o.src !== null) {
    const src = c.str(o, 'src', path);
    if (!/^data:image\/(png|jpeg|gif|svg\+xml|webp)[;,]/i.test(src)) c.issue(`${path}.src`, 'must be a data:image/... URL (PNG, JPEG, GIF, SVG or WebP)');
    sh.src = src;
  }
  editable(c, o, path, sh);
  const z = drawOrder(c, o, path);
  if (z !== undefined) sh.z = z;
  return sh;
}

const PAPER_SIZES: PaperSize[] = ['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Legal', 'Tabloid', 'Custom'];

function sheetProps(c: Checker, v: unknown, path: string): SheetProps | undefined {
  const o = c.obj(v, path);
  if (!o) return undefined;
  const p: SheetProps = {};
  const paper = oneOf(c, o, 'paper', path, PAPER_SIZES);
  if (paper) p.paper = paper;
  const orientation = oneOf(c, o, 'orientation', path, ['landscape', 'portrait'] as const);
  if (orientation) p.orientation = orientation;
  for (const k of ['width', 'height'] as const) {
    if (o[k] === undefined || o[k] === null) continue;
    const n = c.num(o, k, path);
    if (n < 100 || n > 20000) c.issue(`${path}.${k}`, `must be between 100 and 20000 units (got ${n})`);
    p[k] = n;
  }
  for (const k of ['border', 'titleBlock'] as const) {
    const b = c.bool(o, k, path);
    if (b !== undefined) p[k] = b;
  }
  const grid = oneOf(c, o, 'grid', path, ['dots', 'lines'] as const);
  if (grid) p.grid = grid;
  if (o.colors !== undefined && o.colors !== null) {
    const co = c.obj(o.colors, `${path}.colors`);
    if (co) {
      const scheme = oneOf(c, co, 'scheme', `${path}.colors`, ['default', 'white', 'black', 'custom'] as const) ?? 'default';
      const colors: SheetColors = { scheme };
      for (const k of ['background', 'wire', 'component', 'text', 'bus'] as const) if (co[k] !== undefined && co[k] !== null) colors[k] = c.str(co, k, `${path}.colors`);
      p.colors = colors;
    }
  }
  return p;
}

function list<T>(c: Checker, o: Raw, key: string, path: string, f: (c: Checker, v: unknown, path: string) => T | null): T[] {
  const out: T[] = [];
  c.array(o, key, path).forEach((v, i) => {
    const r = f(c, v, `${path}.${key}[${i}]`);
    if (r) out.push(r);
  });
  return out;
}

function uniqueIds(c: Checker, items: { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) c.issue(path, `duplicate id ${JSON.stringify(it.id)}`);
    seen.add(it.id);
  }
}

/**
 * Item ids are design-global: the editor finds parts, wires, labels, probes and notes by id across
 * all sheets (selection, findItem, live edits) and the netlister keys labels by id, so an id may
 * occur only once per item kind in the whole design.
 */
function uniqueItemIds(c: Checker, sheets: Sheet[], paths: string[] = sheets.map((_s, i) => `sheets[${i}]`)): void {
  const kinds = ['parts', 'wires', 'labels', 'probes', 'notes', 'shapes'] as const;
  for (const kind of kinds) {
    const firstAt = new Map<string, number>();
    sheets.forEach((s, i) => {
      for (const it of s[kind] ?? []) {
        const prev = firstAt.get(it.id);
        if (prev === undefined) firstAt.set(it.id, i);
        else if (prev === i) c.issue(`${paths[i]}.${kind}`, `duplicate id ${JSON.stringify(it.id)}`);
        else c.issue(`${paths[i]}.${kind}`, `id ${JSON.stringify(it.id)} is already used on ${paths[prev]} (ids must be unique in the whole design)`);
      }
    });
  }
}

const CONTACT_KINDS: LadderContactKind[] = ['no', 'nc', 'rising', 'falling'];
const COMPARE_OPS: LadderCompareOp[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];
const OUTPUT_KINDS: LadderOutputKind[] = ['coil', 'coil-not', 'set', 'reset', 'ton', 'tof', 'ctu', 'ctd', 'creset', 'mov', 'add', 'sub', 'mul', 'div', 'call'];

/** One element of a rung's logic (a contact, a comparison or a group). */
function ladderNode(c: Checker, v: unknown, path: string, depth = 0): LadderNode | null {
  const o = c.obj(v, path);
  if (!o) return null;
  if (depth > 12) {
    c.issue(path, 'the logic of a rung is nested too deeply');
    return null;
  }
  const kind = oneOf(c, o, 'kind', path, ['contact', 'compare', 'series', 'parallel'] as const);
  if (kind === undefined) {
    if (o.kind === undefined) c.issue(`${path}.kind`, 'is required');
    return null;
  }
  if (kind === 'contact') {
    const type = oneOf(c, o, 'type', path, CONTACT_KINDS) ?? 'no';
    const node: LadderNode = { kind: 'contact', type, address: c.str(o, 'address', path) };
    if (o.comment !== undefined && o.comment !== null) node.comment = c.str(o, 'comment', path);
    return node;
  }
  if (kind === 'compare') {
    const op = oneOf(c, o, 'op', path, COMPARE_OPS) ?? 'eq';
    const node: LadderNode = { kind: 'compare', op, left: c.str(o, 'left', path), right: c.str(o, 'right', path) };
    if (o.comment !== undefined && o.comment !== null) node.comment = c.str(o, 'comment', path);
    return node;
  }
  const raw = c.array(o, 'items', path);
  if (raw.length === 0) c.issue(`${path}.items`, 'a group needs at least one item');
  const items = raw.map((x, i) => ladderNode(c, x, `${path}.items[${i}]`, depth + 1)).filter((x): x is LadderNode => x !== null);
  return { kind, items };
}

function ladderRung(c: Checker, v: unknown, path: string): LadderRung | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const id = c.str(o, 'id', path);
  const comment = o.comment !== undefined && o.comment !== null ? c.str(o, 'comment', path) : undefined;
  const logic = o.logic !== undefined && o.logic !== null ? ladderNode(c, o.logic, `${path}.logic`) : null;
  const outs = c.array(o, 'outputs', path);
  if (outs.length === 0) c.issue(`${path}.outputs`, 'a rung needs at least one coil');
  // the key order is the one of LadderRung, so a file written by the editor round-trips byte for byte
  const rung: LadderRung = { id, ...(comment !== undefined ? { comment } : {}), ...(logic ? { logic } : {}), outputs: [] };
  rung.outputs = outs
    .map((x, i) => {
      const p = `${path}.outputs[${i}]`;
      const oo = c.obj(x, p);
      if (!oo) return null;
      const kind = oneOf(c, oo, 'kind', p, OUTPUT_KINDS);
      if (kind === undefined) {
        if (oo.kind === undefined) c.issue(`${p}.kind`, 'is required');
        return null;
      }
      const out: LadderOutput = { kind, address: c.str(oo, 'address', p) };
      if (oo.preset !== undefined && oo.preset !== null) out.preset = c.str(oo, 'preset', p);
      if (oo.a !== undefined && oo.a !== null) out.a = c.str(oo, 'a', p);
      if (oo.b !== undefined && oo.b !== null) out.b = c.str(oo, 'b', p);
      if (oo.block !== undefined && oo.block !== null) out.block = c.str(oo, 'block', p);
      if (oo.args !== undefined && oo.args !== null) {
        const args = c.record(oo, 'args', p);
        if (args) out.args = args;
      }
      if (oo.comment !== undefined && oo.comment !== null) out.comment = c.str(oo, 'comment', p);
      return out;
    })
    .filter((x): x is LadderOutput => x !== null);
  const disabled = c.bool(o, 'disabled', path);
  if (disabled !== undefined) rung.disabled = disabled;
  return rung;
}

/** Design.ladderBlocks: the user function blocks of the ladder program (src/ladder/blocks.ts). */
function ladderBlocks(c: Checker, v: unknown): LadderBlock[] | undefined {
  if (!Array.isArray(v)) {
    c.issue('ladderBlocks', 'expected a list');
    return undefined;
  }
  const out: LadderBlock[] = [];
  v.forEach((x, i) => {
    const path = `ladderBlocks[${i}]`;
    const o = c.obj(x, path);
    if (!o) return;
    // key order of LadderBlock, so a file written by the editor round-trips byte for byte
    const block: LadderBlock = { id: c.str(o, 'id', path), name: c.str(o, 'name', path), ...(o.comment !== undefined && o.comment !== null ? { comment: c.str(o, 'comment', path) } : {}), inputs: [], outputs: [], rungs: [] };
    const names = (key: 'inputs' | 'outputs'): string[] =>
      c.array(o, key, path).map((n, k) => {
        if (typeof n === 'string') return n;
        c.issue(`${path}.${key}[${k}]`, 'expected a name');
        return '';
      });
    block.inputs = names('inputs');
    block.outputs = names('outputs');
    block.rungs = c
      .array(o, 'rungs', path)
      .map((r, k) => ladderRung(c, r, `${path}.rungs[${k}]`))
      .filter((r): r is LadderRung => r !== null);
    out.push(block);
  });
  return out;
}

function sheet(c: Checker, v: unknown, path: string, index: number): Sheet | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const s: Sheet = {
    id: c.str(o, 'id', path),
    name: c.str(o, 'name', path, `Sheet ${index + 1}`),
    parts: list(c, o, 'parts', path, part),
    wires: list(c, o, 'wires', path, wire),
    labels: list(c, o, 'labels', path, label),
    probes: list(c, o, 'probes', path, probe),
    notes: list(c, o, 'notes', path, note),
  };
  if (o.shapes !== undefined && o.shapes !== null) s.shapes = list(c, o, 'shapes', path, shape);
  if (o.props !== undefined && o.props !== null) {
    const props = sheetProps(c, o.props, `${path}.props`);
    if (props) s.props = props;
  }
  const kind = oneOf(c, o, 'kind', path, ['schematic', 'ladder'] as const);
  if (kind !== undefined && kind !== 'schematic') s.kind = kind;
  if (o.ladder !== undefined && o.ladder !== null) {
    const rungs = c
      .array(o, 'ladder', path)
      .map((x, i) => ladderRung(c, x, `${path}.ladder[${i}]`))
      .filter((x): x is LadderRung => x !== null);
    s.ladder = rungs;
    if (s.kind !== 'ladder') c.issue(`${path}.kind`, 'a sheet with rungs must have kind "ladder"');
  }
  if (o.layers !== undefined && o.layers !== null) {
    const layers = sheetLayers(c, o.layers, `${path}.layers`);
    if (layers && Object.keys(layers).length) s.layers = layers;
  }
  return s;
}

function child(c: Checker, v: unknown, path: string): ChildDesign | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const kind = oneOf(c, o, 'kind', path, ['subcircuit', 'hierarchical'] as const);
  if (kind === undefined && o.kind === undefined) c.issue(`${path}.kind`, 'is required');
  const sheetsRaw = c.array(o, 'sheets', path);
  if (sheetsRaw.length === 0) c.issue(`${path}.sheets`, 'a child design needs at least one sheet');
  const ch: ChildDesign = {
    id: c.str(o, 'id', path),
    kind: kind ?? 'subcircuit',
    name: c.str(o, 'name', path),
    sheets: sheetsRaw.map((sv, i) => sheet(c, sv, `${path}.sheets[${i}]`, i)).filter((x): x is Sheet => x !== null),
    variables: c.record(o, 'variables', path),
  };
  if (o.description !== undefined && o.description !== null) ch.description = c.str(o, 'description', path);
  if (o.sourceFile !== undefined && o.sourceFile !== null) ch.sourceFile = c.str(o, 'sourceFile', path);
  if (o.portOrder !== undefined && o.portOrder !== null) {
    const arr = c.array(o, 'portOrder', path);
    ch.portOrder = arr.map((x, i) => {
      if (typeof x !== 'string') c.issue(`${path}.portOrder[${i}]`, 'expected text');
      return String(x);
    });
  }
  return ch;
}

const TITLE_FIELDS: (keyof TitleBlockFields)[] = ['title', 'description', 'company', 'designedBy', 'checkedBy', 'approvedBy', 'documentNo', 'revision', 'date'];

function titleBlock(c: Checker, v: unknown): TitleBlockFields | undefined {
  const o = c.obj(v, 'titleBlock');
  if (!o) return undefined;
  const out: TitleBlockFields = {};
  for (const k of Object.keys(o)) {
    if (!(TITLE_FIELDS as string[]).includes(k)) c.issue(`titleBlock.${k}`, `unknown field (allowed: ${TITLE_FIELDS.join(', ')})`);
  }
  for (const k of TITLE_FIELDS) if (o[k] !== undefined && o[k] !== null) out[k] = c.str(o, k, 'titleBlock');
  return out;
}

function printSetup(c: Checker, v: unknown): PrintSetup | undefined {
  const o = c.obj(v, 'printSetup');
  if (!o) return undefined;
  const p: PrintSetup = {};
  const paper = oneOf(c, o, 'paper', 'printSetup', PAPER_SIZES);
  if (paper) p.paper = paper;
  const orientation = oneOf(c, o, 'orientation', 'printSetup', ['landscape', 'portrait'] as const);
  if (orientation) p.orientation = orientation;
  if (o.scale !== undefined && o.scale !== null) {
    if (o.scale === 'fit') p.scale = 'fit';
    else {
      const n = c.num(o, 'scale', 'printSetup');
      if (n < 5 || n > 1000) c.issue('printSetup.scale', `must be 'fit' or a percentage between 5 and 1000 (got ${n})`);
      p.scale = n;
    }
  }
  if (o.sheets !== undefined && o.sheets !== null) {
    if (o.sheets === 'all' || o.sheets === 'active') p.sheets = o.sheets;
    else if (Array.isArray(o.sheets) && o.sheets.every((x) => typeof x === 'string')) p.sheets = o.sheets as string[];
    else c.issue('printSetup.sheets', "must be 'all', 'active' or a list of sheet ids");
  }
  for (const k of ['includeChildren', 'includeInstruments', 'monochrome', 'tile', 'footer'] as const) {
    const b = c.bool(o, k, 'printSetup');
    if (b !== undefined) p[k] = b;
  }
  if (o.marginMm !== undefined && o.marginMm !== null) {
    const n = c.num(o, 'marginMm', 'printSetup');
    if (n < 0 || n > 50) c.issue('printSetup.marginMm', `must be between 0 and 50 mm (got ${n})`);
    p.marginMm = n;
  }
  if (o.pageRange !== undefined && o.pageRange !== null) p.pageRange = c.str(o, 'pageRange', 'printSetup');
  if (o.customMm !== undefined && o.customMm !== null) {
    const co = c.obj(o.customMm, 'printSetup.customMm');
    if (co) {
      const w = c.num(co, 'w', 'printSetup.customMm');
      const h = c.num(co, 'h', 'printSetup.customMm');
      if (w < 50 || h < 50 || w > 2000 || h > 2000) c.issue('printSetup.customMm', 'each side must be between 50 and 2000 mm');
      p.customMm = { w, h };
    }
  }
  return p;
}

function analysis(c: Checker, v: unknown): AnalysisSettings {
  const def = newDesign().analysis;
  if (v === undefined || v === null) return def;
  const o = c.obj(v, 'analysis');
  if (!o) return def;
  const active = c.str(o, 'active', 'analysis', def.active) as AnalysisSettings['active'];
  const specs: AnalysisSettings['specs'] = {};
  if (o.specs !== undefined) {
    const so = c.obj(o.specs, 'analysis.specs');
    if (so) {
      for (const [k, spec] of Object.entries(so)) {
        if (!isObj(spec) || typeof spec.type !== 'string') c.issue(`analysis.specs.${k}`, 'expected an analysis spec with a "type"');
        else (specs as Record<string, unknown>)[k] = spec;
      }
    }
  }
  const out: AnalysisSettings = { active, specs: Object.keys(specs).length || o.specs !== undefined ? specs : def.specs };
  for (const key of ['saves', 'expressions'] as const) {
    const list = o[key];
    if (list === undefined || list === null) continue;
    if (Array.isArray(list) && list.every((x) => typeof x === 'string')) out[key] = list as string[];
    else c.issue(`analysis.${key}`, 'expected a list of strings');
  }
  return out;
}

const INTERACTIVE_INITIAL = ['auto', 'op', 'zero', 'uic'];

function interactive(c: Checker, v: unknown): InteractiveSettings | undefined {
  const o = c.obj(v, 'interactive');
  if (!o) return undefined;
  const st: InteractiveSettings = {};
  if (o.initial !== undefined) {
    if (typeof o.initial === 'string' && INTERACTIVE_INITIAL.includes(o.initial)) st.initial = o.initial as InteractiveSettings['initial'];
    else c.issue('interactive.initial', `must be auto, op, zero or uic (got ${JSON.stringify(o.initial)})`);
  }
  for (const key of ['tstep', 'tmax', 'tstop'] as const) {
    const n = o[key];
    if (n === undefined || n === null) continue;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) st[key] = n;
    else c.issue(`interactive.${key}`, `expected a positive number (got ${JSON.stringify(n)})`);
  }
  return st;
}

function breadboard(c: Checker, v: unknown): BreadboardLayout | undefined {
  if (v === undefined || v === null) return undefined;
  const o = c.obj(v, 'breadboard');
  if (!o) return undefined;
  if (o.version !== 1) c.issue('breadboard.version', `expected 1 (got ${JSON.stringify(o.version)})`);
  for (const k of ['boards', 'placements', 'wires', 'clips']) if (!Array.isArray(o[k])) c.issue(`breadboard.${k}`, 'expected an array');
  return o as unknown as BreadboardLayout;
}

/** Validate a (migrated) raw document and return a Design with defaults filled in. */
export function validateDesign(input: unknown): Design {
  const c = new Checker();
  const o = c.obj(input, '(root)');
  if (!o) throw new DesignFormatError(c.issues);
  if (o.format !== 'machsim-design') c.issue('format', `expected "machsim-design" (got ${JSON.stringify(o.format)})`);
  if (o.version !== CURRENT_DESIGN_VERSION) c.issue('version', `expected ${CURRENT_DESIGN_VERSION} (got ${JSON.stringify(o.version)})`);
  const sheetsRaw = c.array(o, 'sheets', '(root)');
  if (!Array.isArray(o.sheets)) c.issue('sheets', 'is required');
  else if (sheetsRaw.length === 0) c.issue('sheets', 'a design needs at least one sheet');
  const sheets = sheetsRaw.map((s, i) => sheet(c, s, `sheets[${i}]`, i)).filter((s): s is Sheet => s !== null);
  const children =
    o.children !== undefined && o.children !== null
      ? c
          .array(o, 'children', '(root)')
          .map((v, i) => child(c, v, `children[${i}]`))
          .filter((x): x is ChildDesign => x !== null)
      : undefined;
  if (children) {
    uniqueIds(c, children, 'children');
    // sheets and items are addressed by id across the root and every child
    const every = [...sheets];
    const paths = sheets.map((_s, i) => `sheets[${i}]`);
    children.forEach((ch, ci) =>
      ch.sheets.forEach((s, si) => {
        every.push(s);
        paths.push(`children[${ci}].sheets[${si}]`);
      }),
    );
    uniqueIds(c, every, 'sheets');
    uniqueItemIds(c, every, paths);
  } else {
    uniqueIds(c, sheets, 'sheets');
    uniqueItemIds(c, sheets);
  }

  const optionsRaw = o.options;
  let options: Design['options'] = {};
  if (optionsRaw !== undefined && optionsRaw !== null) {
    const oo = c.obj(optionsRaw, 'options');
    if (oo) {
      for (const [k, val] of Object.entries(oo)) {
        if (k === 'method') {
          if (val !== 'trap' && val !== 'gear') c.issue('options.method', `must be "trap" or "gear" (got ${JSON.stringify(val)})`);
        } else if (typeof val !== 'number' || !Number.isFinite(val)) c.issue(`options.${k}`, `expected a finite number (got ${JSON.stringify(val)})`);
      }
      options = oo as Design['options'];
    }
  }

  const design: Design = {
    format: 'machsim-design',
    version: CURRENT_DESIGN_VERSION,
    title: c.str(o, 'title', '(root)', 'Untitled'),
    sheets,
    analysis: analysis(c, o.analysis),
    options,
    variables: c.record(o, 'variables', '(root)'),
  };
  if (o.description !== undefined && o.description !== null) design.description = c.str(o, 'description', '(root)');
  if (o.customSpice !== undefined && o.customSpice !== null) design.customSpice = c.str(o, 'customSpice', '(root)');
  const bb = breadboard(c, o.breadboard);
  if (bb) design.breadboard = bb;
  if (children) design.children = children;
  if (o.titleBlock !== undefined && o.titleBlock !== null) {
    const tb = titleBlock(c, o.titleBlock);
    if (tb) design.titleBlock = tb;
  }
  if (o.printSetup !== undefined && o.printSetup !== null) {
    const ps = printSetup(c, o.printSetup);
    if (ps) design.printSetup = ps;
  }
  if (o.autoFault !== undefined && o.autoFault !== null) {
    const af = c.obj(o.autoFault, 'autoFault');
    if (af) {
      const info: AutoFaultInfo = { seed: c.num(af, 'seed', 'autoFault', 0), count: c.num(af, 'count', 'autoFault', 0) };
      const revealed = c.bool(af, 'revealed', 'autoFault');
      if (revealed !== undefined) info.revealed = revealed;
      design.autoFault = info;
    }
  }
  if (o.digital !== undefined && o.digital !== null) {
    const dg = c.obj(o.digital, 'digital');
    if (dg) {
      const st: DigitalSimSettings = {};
      const mode = dg.mode;
      if (mode !== undefined) {
        if (mode === 'auto' || mode === 'ideal' || mode === 'real') st.mode = mode;
        else c.issue('digital.mode', `must be auto, ideal or real (got ${JSON.stringify(mode)})`);
      }
      const timing = dg.timing;
      if (timing !== undefined) {
        if (timing === 'typical' || timing === 'max' || timing === 'zero') st.timing = timing;
        else c.issue('digital.timing', `must be typical, max or zero (got ${JSON.stringify(timing)})`);
      }
      design.digital = st;
    }
  }
  if (o.interactive !== undefined && o.interactive !== null) {
    const it = interactive(c, o.interactive);
    if (it) design.interactive = it;
  }
  if (o.customParts !== undefined && o.customParts !== null) {
    const list = c
      .array(o, 'customParts', '(root)')
      .map((v, i) => readCustomPart(v, `customParts[${i}]`, c.issues))
      .filter((x): x is CustomPartData => x !== null);
    uniqueIds(c, list, 'customParts');
    if (list.length) design.customParts = list;
  }
  if (o.descriptionBox !== undefined && o.descriptionBox !== null) {
    const db = descriptionBox(c, o.descriptionBox);
    if (db) design.descriptionBox = db;
  }
  if (o.restrictions !== undefined && o.restrictions !== null) {
    const r = restrictions(c, o.restrictions);
    if (r) design.restrictions = r;
  }
  if (o.meta !== undefined && o.meta !== null) {
    const m = c.obj(o.meta, 'meta');
    if (m) {
      const meta: DesignMeta = {};
      for (const k of ['created', 'modified', 'savedBy'] as const) if (m[k] !== undefined && m[k] !== null) meta[k] = c.str(m, k, 'meta');
      design.meta = meta;
    }
  }
  if (o.grapher !== undefined && o.grapher !== null) {
    const g = savedGrapher(c, o.grapher);
    if (g) design.grapher = g;
  }
  if (o.variants !== undefined && o.variants !== null) {
    const v = designVariants(c, o.variants);
    if (v) design.variants = v;
  }
  // every notFitted id must name a variant of the design
  {
    const known = new Set((design.variants?.list ?? []).map((v) => v.id));
    const check = (list: Sheet[], base: string) =>
      list.forEach((s, si) =>
        s.parts.forEach((p, pi) =>
          [...(p.notFitted ?? []), ...Object.keys(p.variantValues ?? {})].forEach((id, k) => {
            if (!known.has(id)) c.issue(`${base}[${si}].parts[${pi}].${k < (p.notFitted?.length ?? 0) ? 'notFitted' : 'variantValues'}`, `unknown variant id ${JSON.stringify(id)}`);
          }),
        ),
      );
    check(design.sheets, 'sheets');
    (design.children ?? []).forEach((ch, ci) => check(ch.sheets, `children[${ci}].sheets`));
  }
  if (o.libraryRefs !== undefined && o.libraryRefs !== null) {
    const refs = libraryRefs(c, o.libraryRefs);
    if (refs) design.libraryRefs = refs;
  }
  if (o.erc !== undefined && o.erc !== null) {
    const e = ercSettings(c, o.erc);
    if (e) design.erc = e;
  }
  if (o.nets !== undefined && o.nets !== null) {
    const n = netSettingsMap(c, o.nets);
    if (n) design.nets = n;
  }
  if (o.refdesRules !== undefined && o.refdesRules !== null) {
    const rr = refdesRules(c, o.refdesRules);
    if (rr) design.refdesRules = rr;
  }
  if (o.ladderBlocks !== undefined && o.ladderBlocks !== null) {
    const lb = ladderBlocks(c, o.ladderBlocks);
    if (lb && lb.length) design.ladderBlocks = lb;
  }
  if (c.issues.length) throw new DesignFormatError(c.issues);
  return design;
}

/** ERC options (Design.erc): the pin-type matrix overrides and the hidden-power behaviour. */
function ercSettings(c: Checker, v: unknown): ErcSettings | null {
  const o = c.obj(v, 'erc');
  if (!o) return null;
  const out: ErcSettings = {};
  for (const k of ['pinTypes', 'ncConnected', 'undrivenInputs'] as const) {
    const b = c.bool(o, k, 'erc');
    if (b !== undefined) out[k] = b;
  }
  if (o.hiddenPower !== undefined && o.hiddenPower !== null) {
    const m = oneOf<HiddenPowerMode>(c, o, 'hiddenPower', 'erc', ['auto', 'ideal', 'required']);
    if (m) out.hiddenPower = m;
  }
  if (o.matrix !== undefined && o.matrix !== null) {
    const m = c.obj(o.matrix, 'erc.matrix');
    if (m) {
      const matrix: Record<string, ErcLevel> = {};
      for (const [pair, level] of Object.entries(m)) {
        const [a, b] = pair.split('|');
        if (!ERC_PIN_TYPES.includes(a as ErcPinType) || !ERC_PIN_TYPES.includes(b as ErcPinType) || pinPairKey(a as ErcPinType, b as ErcPinType) !== pair) {
          c.issue(`erc.matrix.${pair}`, `expected a pin-type pair such as ${pinPairKey('input', 'output')}`);
          continue;
        }
        if (level !== 'ok' && level !== 'warning' && level !== 'error') {
          c.issue(`erc.matrix.${pair}`, 'expected ok, warning or error');
          continue;
        }
        matrix[pair] = level;
      }
      if (Object.keys(matrix).length) out.matrix = matrix;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Per-net settings (Design.nets), keyed by the net's user-visible name. */
function netSettingsMap(c: Checker, v: unknown): Record<string, NetSettings> | null {
  const o = c.obj(v, 'nets');
  if (!o) return null;
  const out: Record<string, NetSettings> = {};
  for (const [name, raw] of Object.entries(o)) {
    const path = `nets.${name}`;
    if (!name.trim()) {
      c.issue(path, 'a net name cannot be empty');
      continue;
    }
    const e = c.obj(raw, path);
    if (!e) continue;
    const s: NetSettings = {};
    for (const k of ['color', 'note', 'layer', 'netClass'] as const) if (e[k] !== undefined && e[k] !== null) s[k] = c.str(e, k, path);
    for (const k of ['traceWidth', 'clearance'] as const) {
      if (e[k] === undefined || e[k] === null) continue;
      const n = c.num(e, k, path);
      if (Number.isFinite(n) && n >= 0) s[k] = n;
      else c.issue(`${path}.${k}`, 'expected a width in mm (0 or more)');
    }
    const keep = c.bool(e, 'keepName', path);
    if (keep !== undefined) s.keepName = keep;
    for (const k of Object.keys(e)) {
      if (!NET_SETTING_KEYS.includes(k as (typeof NET_SETTING_KEYS)[number])) c.issue(`${path}.${k}`, `unknown field (expected ${NET_SETTING_KEYS.join(', ')})`);
    }
    if (Object.keys(s).length) out[name] = s;
  }
  return Object.keys(out).length ? out : null;
}

const NET_SETTING_KEYS = ['color', 'note', 'keepName', 'traceWidth', 'clearance', 'layer', 'netClass'] as const;

/** Design variants (Tools › Variant manager): unique ids, names, the active id among them. */
function designVariants(c: Checker, v: unknown): DesignVariants | null {
  const o = c.obj(v, 'variants');
  if (!o) return null;
  const list: DesignVariant[] = [];
  c.array(o, 'list', 'variants').forEach((x, i) => {
    const path = `variants.list[${i}]`;
    const e = c.obj(x, path);
    if (!e) return;
    const item: DesignVariant = { id: c.str(e, 'id', path), name: c.str(e, 'name', path) };
    if (!item.id) c.issue(`${path}.id`, 'is required');
    if (e.description !== undefined && e.description !== null) item.description = c.str(e, 'description', path);
    if (e.variables !== undefined && e.variables !== null) {
      const vars = c.record(e, 'variables', path);
      if (Object.keys(vars).length) item.variables = vars;
    }
    list.push(item);
  });
  if (!list.length) {
    c.issue('variants.list', 'a design with variants needs at least one');
    return null;
  }
  uniqueIds(c, list, 'variants.list');
  const out: DesignVariants = { list };
  if (o.active !== undefined && o.active !== null) {
    const a = c.str(o, 'active', 'variants');
    if (!list.some((x) => x.id === a)) c.issue('variants.active', `unknown variant id ${JSON.stringify(a)}`);
    else out.active = a;
  }
  return out;
}

/** Library references of placed parts (Design.libraryRefs). */
function libraryRefs(c: Checker, v: unknown): Record<string, PartLibraryRef> | null {
  const o = c.obj(v, 'libraryRefs');
  if (!o) return null;
  const out: Record<string, PartLibraryRef> = {};
  for (const [id, raw] of Object.entries(o)) {
    const path = `libraryRefs.${id}`;
    const e = c.obj(raw, path);
    if (!e) continue;
    const pins: Record<string, [number, number]> = {};
    const po = e.pins === undefined || e.pins === null ? {} : c.obj(e.pins, `${path}.pins`);
    for (const [pin, xy] of Object.entries(po ?? {})) {
      if (Array.isArray(xy) && xy.length === 2 && xy.every((n) => typeof n === 'number' && Number.isFinite(n))) pins[pin] = [xy[0], xy[1]];
      else c.issue(`${path}.pins.${pin}`, 'expected [x, y]');
    }
    out[id] = { sig: c.str(e, 'sig', path), pins, defaults: c.record(e, 'defaults', path) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grapher pages kept with a design

function samples(c: Checker, v: unknown, path: string): (number | null)[] {
  if (!Array.isArray(v)) {
    c.issue(path, 'expected an array of numbers');
    return [];
  }
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x !== null && (typeof x !== 'number' || !Number.isFinite(x))) {
      c.issue(`${path}[${i}]`, `expected a number or null (got ${JSON.stringify(x)})`);
      return [];
    }
  }
  return v as (number | null)[];
}

function savedVector(c: Checker, v: unknown, path: string): SavedVector | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const out: SavedVector = { name: c.str(o, 'name', path), unit: c.str(o, 'unit', path, ''), re: samples(c, o.re, `${path}.re`) };
  if (o.im !== undefined && o.im !== null) {
    out.im = samples(c, o.im, `${path}.im`);
    if (out.im.length !== out.re.length) c.issue(`${path}.im`, 'must have as many samples as re');
  }
  if (c.bool(o, 'digital', path)) out.digital = true;
  return out;
}

function savedResult(c: Checker, v: unknown, path: string, depth = 0): SavedResult | null {
  const o = c.obj(v, path);
  if (!o) return null;
  const type = o.type;
  if (typeof type !== 'string' || !ANALYSIS_TYPE_NAMES.has(type)) {
    c.issue(`${path}.type`, `unknown analysis type ${JSON.stringify(type)}`);
    return null;
  }
  const out: SavedResult = { type: type as SavedResult['type'], title: c.str(o, 'title', path, ''), vectors: [] };
  if (o.scale !== undefined && o.scale !== null) {
    const s = savedVector(c, o.scale, `${path}.scale`);
    if (s) out.scale = s;
  }
  out.vectors = c
    .array(o, 'vectors', path)
    .map((x, i) => savedVector(c, x, `${path}.vectors[${i}]`))
    .filter((x): x is SavedVector => x !== null);
  if (out.scale) for (const [i, vec] of out.vectors.entries()) if (vec.re.length !== out.scale.re.length) c.issue(`${path}.vectors[${i}]`, 'must have as many samples as the scale');
  if (o.runs !== undefined && o.runs !== null) {
    if (depth > 2) c.issue(`${path}.runs`, 'nested too deeply');
    else
      out.runs = c
        .array(o, 'runs', path)
        .map((x, i) => {
          const r = c.obj(x, `${path}.runs[${i}]`);
          if (!r) return null;
          const res = savedResult(c, r.result, `${path}.runs[${i}].result`, depth + 1);
          return res ? { label: c.str(r, 'label', `${path}.runs[${i}]`, ''), result: res } : null;
        })
        .filter((x): x is { label: string; result: SavedResult } => x !== null);
  }
  if (o.scalars !== undefined && o.scalars !== null) {
    const s = c.obj(o.scalars, `${path}.scalars`);
    if (s) {
      const scalars: Record<string, number> = {};
      for (const [k, x] of Object.entries(s)) {
        if (typeof x === 'number' && Number.isFinite(x)) scalars[k] = x;
        else c.issue(`${path}.scalars.${k}`, 'expected a finite number');
      }
      out.scalars = scalars;
    }
  }
  if (o.table !== undefined && o.table !== null) {
    const tb = c.obj(o.table, `${path}.table`);
    if (tb) {
      const columns = c.array(tb, 'columns', `${path}.table`).map(String);
      const rows = c.array(tb, 'rows', `${path}.table`).map((r) => (Array.isArray(r) ? r.map((x) => (typeof x === 'number' ? x : String(x))) : []));
      out.table = { columns, rows };
    }
  }
  return out;
}

function savedGrapher(c: Checker, v: unknown): SavedGrapher | null {
  const o = c.obj(v, 'grapher');
  if (!o) return null;
  if (o.version !== 1) {
    c.issue('grapher.version', `expected 1 (got ${JSON.stringify(o.version)})`);
    return null;
  }
  const runs: SavedRun[] = [];
  c.array(o, 'runs', 'grapher').forEach((x, i) => {
    const path = `grapher.runs[${i}]`;
    const r = c.obj(x, path);
    if (!r) return;
    const run: SavedRun = {
      id: c.num(r, 'id', path),
      source: c.str(r, 'source', path, 'analysis'),
      name: c.str(r, 'name', path, ''),
      time: c.num(r, 'time', path, 0),
      results: c
        .array(r, 'results', path)
        .map((y, k) => savedResult(c, y, `${path}.results[${k}]`))
        .filter((y): y is SavedResult => y !== null),
    };
    if (r.expressions !== undefined && r.expressions !== null) run.expressions = c.array(r, 'expressions', path).map(String);
    runs.push(run);
  });
  const runIds = new Set(runs.map((r) => r.id));
  if (runIds.size !== runs.length) c.issue('grapher.runs', 'run ids must be unique');
  const pages: SavedPage[] = [];
  c.array(o, 'pages', 'grapher').forEach((x, i) => {
    const path = `grapher.pages[${i}]`;
    const p = c.obj(x, path);
    if (!p) return;
    const runId = c.num(p, 'runId', path);
    if (!runIds.has(runId)) c.issue(`${path}.runId`, `no run ${runId}`);
    const overlays = c
      .array(p, 'overlays', path)
      .map((y, k) => {
        const ov = c.obj(y, `${path}.overlays[${k}]`);
        return ov ? { runId: c.num(ov, 'runId', `${path}.overlays[${k}]`), tab: c.num(ov, 'tab', `${path}.overlays[${k}]`, 0), vector: c.str(ov, 'vector', `${path}.overlays[${k}]`) } : null;
      })
      .filter((y): y is SavedPage['overlays'][number] => y !== null);
    const props = p.props === undefined || p.props === null ? {} : c.obj(p.props, `${path}.props`) ?? {};
    const tracesRaw = p.traces === undefined || p.traces === null ? {} : c.obj(p.traces, `${path}.traces`) ?? {};
    const traces: Record<string, Record<string, unknown>> = {};
    for (const [k, t] of Object.entries(tracesRaw)) {
      const st = c.obj(t, `${path}.traces.${k}`);
      if (st) traces[k] = st;
    }
    pages.push({ id: c.str(p, 'id', path), runId, tab: c.num(p, 'tab', path, 0), key: c.str(p, 'key', path, ''), overlays, props, traces });
  });
  const out: SavedGrapher = { version: 1, runs, pages };
  if (o.active !== undefined && o.active !== null) out.active = c.str(o, 'active', 'grapher');
  return out;
}

const QUESTION_KINDS: QuestionKind[] = ['choice', 'number', 'text'];
const IMAGE_SRC_RE = /^data:image\/(png|jpeg|gif|svg\+xml|webp)[;,]/i;

/** Design.descriptionBox: rich text, images, questions and the student's answers. */
function descriptionBox(c: Checker, v: unknown): DescriptionBox | undefined {
  const o = c.obj(v, 'descriptionBox');
  if (!o) return undefined;
  const box: DescriptionBox = { text: c.str(o, 'text', 'descriptionBox', '') };
  if (o.images !== undefined && o.images !== null) {
    const images: DescriptionImage[] = [];
    c.array(o, 'images', 'descriptionBox').forEach((iv, i) => {
      const path = `descriptionBox.images[${i}]`;
      const io = c.obj(iv, path);
      if (!io) return;
      const img: DescriptionImage = { id: c.str(io, 'id', path), src: c.str(io, 'src', path) };
      if (!IMAGE_SRC_RE.test(img.src)) c.issue(`${path}.src`, 'must be a data:image/... URL (PNG, JPEG, GIF, SVG or WebP)');
      if (io.alt !== undefined && io.alt !== null) img.alt = c.str(io, 'alt', path);
      images.push(img);
    });
    uniqueIds(c, images, 'descriptionBox.images');
    box.images = images;
  }
  if (o.questions !== undefined && o.questions !== null) {
    const qs: StudentQuestion[] = [];
    c.array(o, 'questions', 'descriptionBox').forEach((qv, i) => {
      const path = `descriptionBox.questions[${i}]`;
      const qo = c.obj(qv, path);
      if (!qo) return;
      const kind = oneOf(c, qo, 'kind', path, QUESTION_KINDS);
      if (kind === undefined && qo.kind === undefined) c.issue(`${path}.kind`, 'is required');
      const q: StudentQuestion = { id: c.str(qo, 'id', path), kind: kind ?? 'text', prompt: c.str(qo, 'prompt', path, '') };
      if (qo.options !== undefined && qo.options !== null) {
        if (Array.isArray(qo.options) && qo.options.every((x) => typeof x === 'string')) q.options = [...(qo.options as string[])];
        else c.issue(`${path}.options`, 'expected a list of strings');
      }
      for (const k of ['answer', 'unit', 'explanation'] as const) if (qo[k] !== undefined && qo[k] !== null) q[k] = c.str(qo, k, path);
      if (qo.tolerance !== undefined && qo.tolerance !== null) {
        const tol = c.num(qo, 'tolerance', path);
        if (!(tol >= 0)) c.issue(`${path}.tolerance`, 'must be >= 0');
        else q.tolerance = tol;
      }
      if (q.kind === 'choice') {
        const n = q.options?.length ?? 0;
        if (n < 2) c.issue(`${path}.options`, 'a choice question needs at least 2 options');
        if (q.answer !== undefined && !(/^\d+$/.test(q.answer) && Number(q.answer) < n)) c.issue(`${path}.answer`, `must be an option index 0..${Math.max(0, n - 1)} (got ${JSON.stringify(q.answer)})`);
      }
      qs.push(q);
    });
    uniqueIds(c, qs, 'descriptionBox.questions');
    box.questions = qs;
  }
  if (o.answers !== undefined && o.answers !== null) box.answers = c.record(o, 'answers', 'descriptionBox');
  const show = c.bool(o, 'showOnOpen', 'descriptionBox');
  if (show !== undefined) box.showOnOpen = show;
  return box;
}

const ANALYSIS_TYPE_NAMES = new Set<string>(['op', 'dc', 'ac', 'acsingle', 'tran', 'noise', 'tf', 'sens', 'pz', 'four', 'disto', 'noisefig', 'paramsweep', 'tempsweep', 'montecarlo', 'worstcase', 'nestedsweep', 'tracewidth', 'batch', 'user']);

/** Design.restrictions: the password hash and the restrictions it protects. */
function restrictions(c: Checker, v: unknown): DesignRestrictions | undefined {
  const o = c.obj(v, 'restrictions');
  if (!o) return undefined;
  const r: DesignRestrictions = {
    passwordHash: c.str(o, 'passwordHash', 'restrictions'),
    salt: c.str(o, 'salt', 'restrictions'),
    iterations: c.num(o, 'iterations', 'restrictions', 0),
  };
  if (!/^[0-9a-f]{64}$/.test(r.passwordHash)) c.issue('restrictions.passwordHash', 'expected a 64-digit lower-case hex SHA-256 hash');
  if (!/^[0-9a-f]{16,128}$/.test(r.salt)) c.issue('restrictions.salt', 'expected 16..128 lower-case hex digits');
  if (!(Number.isInteger(r.iterations) && r.iterations >= 1000)) c.issue('restrictions.iterations', `expected an integer >= 1000 (got ${JSON.stringify(o.iterations)})`);
  for (const k of ['hideValues', 'lockParts', 'lockDescription', 'hideAnswers'] as const) {
    const b = c.bool(o, k, 'restrictions');
    if (b !== undefined) r[k] = b;
  }
  const strList = (key: 'lockedParts' | 'disabledAnalyses' | 'disabledInstruments'): string[] | undefined => {
    if (o[key] === undefined || o[key] === null) return undefined;
    const raw = o[key];
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
      c.issue(`restrictions.${key}`, 'expected a list of strings');
      return undefined;
    }
    return [...(raw as string[])];
  };
  const locked = strList('lockedParts');
  if (locked) r.lockedParts = locked;
  const analyses = strList('disabledAnalyses');
  if (analyses) {
    for (const a of analyses) if (!ANALYSIS_TYPE_NAMES.has(a)) c.issue('restrictions.disabledAnalyses', `unknown analysis type ${JSON.stringify(a)}`);
    r.disabledAnalyses = analyses.filter((a) => ANALYSIS_TYPE_NAMES.has(a)) as DesignRestrictions['disabledAnalyses'];
  }
  const instruments = strList('disabledInstruments');
  if (instruments) r.disabledInstruments = instruments as DesignRestrictions['disabledInstruments'];
  return r;
}
