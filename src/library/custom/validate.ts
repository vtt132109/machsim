/**
 * Structural validation of user-component JSON (design files, `.msimdb` database files,
 * `.msimsym` symbol files). Every problem is reported with a JSON path, the same style as
 * src/model/serialize.ts ("customParts[0].symbol.pins[2].x: expected a finite number").
 *
 *   readCustomPart(raw, path, issues)  -> CustomPartData | null
 *   readSymbol(raw, path, issues)      -> SymbolDef | null
 *   readParamDef(raw, path, issues)    -> ParamDef | null
 * Semantic checks (pin mapping, model text) are in partDef.ts customPartProblems().
 */
import type { ParamDef, PartGroup, PinDef, PinType, SymbolDef, SymbolPrim } from '../types';
import { CUSTOM_PREFIX, PIN_TYPES, isWebLink, type CustomModel, type CustomPartData, type MakerId, type MakerRef } from './types';

type Raw = Record<string, unknown>;

const GROUP_IDS: PartGroup[] = [
  'sources', 'basic', 'diodes', 'transistors', 'analog', 'ttl', 'cmos', 'misc-digital', 'mixed',
  'indicators', 'power', 'misc', 'rf', 'electromechanical', 'connectors', 'instruments',
];
const MAKER_IDS: MakerId[] = ['diode', 'zener', 'led', 'bjt', 'mosfet', 'jfet', 'opamp', 'scr', 'transformer', 'tline', 'acmotor'];
const PARAM_KINDS = ['number', 'text', 'select', 'bool'] as const;
const PARAM_GROUPS = ['value', 'model', 'waveform', 'advanced', 'display'] as const;
const DIRS = ['left', 'right', 'up', 'down'] as const;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

class Reader {
  constructor(readonly issues: string[]) {}
  issue(path: string, msg: string): void {
    this.issues.push(`${path}: ${msg}`);
  }
  obj(v: unknown, path: string): Raw | null {
    if (isObj(v)) return v;
    this.issue(path, 'expected an object');
    return null;
  }
  str(o: Raw, key: string, path: string, def?: string): string {
    const v = o[key];
    if (v === undefined || v === null) {
      if (def === undefined) this.issue(`${path}.${key}`, 'is required');
      return def ?? '';
    }
    if (typeof v === 'number') return String(v);
    if (typeof v !== 'string') {
      this.issue(`${path}.${key}`, `expected text (got ${typeof v})`);
      return def ?? '';
    }
    return v;
  }
  optStr(o: Raw, key: string, path: string): string | undefined {
    return o[key] === undefined || o[key] === null ? undefined : this.str(o, key, path);
  }
  num(o: Raw, key: string, path: string, def?: number): number {
    const v = o[key];
    if (v === undefined || v === null) {
      if (def === undefined) this.issue(`${path}.${key}`, 'is required');
      return def ?? 0;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.issue(`${path}.${key}`, `expected a finite number (got ${JSON.stringify(v)})`);
      return def ?? 0;
    }
    return v;
  }
  optNum(o: Raw, key: string, path: string): number | undefined {
    return o[key] === undefined || o[key] === null ? undefined : this.num(o, key, path);
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
  arr(o: Raw, key: string, path: string, required = false): unknown[] {
    const v = o[key];
    if (v === undefined || v === null) {
      if (required) this.issue(`${path}.${key}`, 'is required');
      return [];
    }
    if (!Array.isArray(v)) {
      this.issue(`${path}.${key}`, 'expected an array');
      return [];
    }
    return v;
  }
  record(o: Raw, key: string, path: string): Record<string, string> | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (!isObj(v)) {
      this.issue(`${path}.${key}`, 'expected an object of text values');
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string') out[k] = val;
      else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
      else this.issue(`${path}.${key}.${k}`, 'expected text');
    }
    return out;
  }
  oneOf<T extends string>(o: Raw, key: string, path: string, allowed: readonly T[], def?: T): T | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (def === undefined) return undefined;
      return def;
    }
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    this.issue(`${path}.${key}`, `must be one of ${allowed.join(', ')} (got ${JSON.stringify(v)})`);
    return def;
  }
}

function fill(r: Reader, o: Raw, path: string): boolean | string | undefined {
  const v = o.fill;
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  r.issue(`${path}.fill`, 'expected true, false or a colour');
  return undefined;
}

function prim(r: Reader, v: unknown, path: string): SymbolPrim | null {
  const o = r.obj(v, path);
  if (!o) return null;
  const n = (k: string) => r.num(o, k, path);
  switch (o.kind) {
    case 'line': {
      const p: SymbolPrim = { kind: 'line', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') };
      const w = r.optNum(o, 'width', path);
      if (w !== undefined) p.width = w;
      return p;
    }
    case 'rect': {
      const p: SymbolPrim = { kind: 'rect', x: n('x'), y: n('y'), w: n('w'), h: n('h') };
      const f = fill(r, o, path);
      if (f !== undefined) p.fill = f;
      const rr = r.optNum(o, 'r', path);
      if (rr !== undefined) p.r = rr;
      return p;
    }
    case 'circle': {
      const p: SymbolPrim = { kind: 'circle', cx: n('cx'), cy: n('cy'), r: n('r') };
      const f = fill(r, o, path);
      if (f !== undefined) p.fill = f;
      return p;
    }
    case 'arc':
      return { kind: 'arc', cx: n('cx'), cy: n('cy'), r: n('r'), start: n('start'), end: n('end') };
    case 'polyline': {
      const pts = r.arr(o, 'points', path, true);
      const points: number[] = [];
      pts.forEach((x, i) => {
        if (typeof x === 'number' && Number.isFinite(x)) points.push(x);
        else r.issue(`${path}.points[${i}]`, 'expected a finite number');
      });
      if (points.length % 2 !== 0 || points.length < 4) r.issue(`${path}.points`, 'needs at least two x, y pairs');
      const p: SymbolPrim = { kind: 'polyline', points };
      const closed = r.bool(o, 'closed', path);
      if (closed !== undefined) p.closed = closed;
      const f = fill(r, o, path);
      if (f !== undefined) p.fill = f;
      return p;
    }
    case 'path': {
      const p: SymbolPrim = { kind: 'path', d: r.str(o, 'd', path) };
      if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/.test(p.d)) r.issue(`${path}.d`, 'contains characters that are not SVG path data');
      const f = fill(r, o, path);
      if (f !== undefined) p.fill = f;
      return p;
    }
    case 'text': {
      const p: SymbolPrim = { kind: 'text', x: n('x'), y: n('y'), text: r.str(o, 'text', path) };
      const size = r.optNum(o, 'size', path);
      if (size !== undefined) p.size = size;
      const anchor = r.oneOf(o, 'anchor', path, ['start', 'middle', 'end'] as const);
      if (anchor) p.anchor = anchor;
      const bold = r.bool(o, 'bold', path);
      if (bold !== undefined) p.bold = bold;
      const upright = r.bool(o, 'upright', path);
      if (upright !== undefined) p.upright = upright;
      return p;
    }
    default:
      r.issue(`${path}.kind`, `unknown shape kind ${JSON.stringify(o.kind)}`);
      return null;
  }
}

function pinDef(r: Reader, v: unknown, path: string): PinDef | null {
  const o = r.obj(v, path);
  if (!o) return null;
  const p: PinDef = { name: r.str(o, 'name', path), x: r.num(o, 'x', path), y: r.num(o, 'y', path) };
  const dir = r.oneOf(o, 'dir', path, DIRS);
  if (dir) p.dir = dir;
  const label = r.optStr(o, 'label', path);
  if (label !== undefined) p.label = label;
  const type = r.oneOf<PinType>(o, 'type', path, PIN_TYPES);
  if (type) p.type = type;
  const number = r.optStr(o, 'number', path);
  if (number !== undefined) p.number = number;
  return p;
}

function point(r: Reader, o: Raw, key: string, path: string): { x: number; y: number } | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  const p = r.obj(v, `${path}.${key}`);
  return p ? { x: r.num(p, 'x', `${path}.${key}`), y: r.num(p, 'y', `${path}.${key}`) } : undefined;
}

/** Validate a SymbolDef. */
export function readSymbol(raw: unknown, path: string, issues: string[]): SymbolDef | null {
  const r = new Reader(issues);
  const o = r.obj(raw, path);
  if (!o) return null;
  const bb = r.obj(o.bbox, `${path}.bbox`);
  const bbox = bb ? { x: r.num(bb, 'x', `${path}.bbox`), y: r.num(bb, 'y', `${path}.bbox`), w: r.num(bb, 'w', `${path}.bbox`), h: r.num(bb, 'h', `${path}.bbox`) } : { x: 0, y: 0, w: 0, h: 0 };
  const prims = r.arr(o, 'prims', path).map((v, i) => prim(r, v, `${path}.prims[${i}]`)).filter((p): p is SymbolPrim => p !== null);
  const pins = r.arr(o, 'pins', path, true).map((v, i) => pinDef(r, v, `${path}.pins[${i}]`)).filter((p): p is PinDef => p !== null);
  const s: SymbolDef = { bbox, prims, pins };
  const refPos = point(r, o, 'refPos', path);
  if (refPos) s.refPos = refPos;
  const valuePos = point(r, o, 'valuePos', path);
  if (valuePos) s.valuePos = valuePos;
  return s;
}

/** Validate a ParamDef. */
export function readParamDef(raw: unknown, path: string, issues: string[]): ParamDef | null {
  const r = new Reader(issues);
  const o = r.obj(raw, path);
  if (!o) return null;
  const p: ParamDef = { key: r.str(o, 'key', path), label: r.str(o, 'label', path, ''), default: r.str(o, 'default', path, ''), kind: r.oneOf(o, 'kind', path, PARAM_KINDS, 'number') ?? 'number' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key)) r.issue(`${path}.key`, 'must be a name of letters, digits and _');
  const unit = r.optStr(o, 'unit', path);
  if (unit !== undefined) p.unit = unit;
  const help = r.optStr(o, 'help', path);
  if (help !== undefined) p.help = help;
  const group = r.oneOf(o, 'group', path, PARAM_GROUPS);
  if (group) p.group = group;
  const min = r.optNum(o, 'min', path);
  if (min !== undefined) p.min = min;
  const max = r.optNum(o, 'max', path);
  if (max !== undefined) p.max = max;
  const show = r.bool(o, 'showOnSchematic', path);
  if (show !== undefined) p.showOnSchematic = show;
  if (o.options !== undefined && o.options !== null) {
    p.options = r
      .arr(o, 'options', path)
      .map((v, i) => {
        const oo = r.obj(v, `${path}.options[${i}]`);
        return oo ? { value: r.str(oo, 'value', `${path}.options[${i}]`), label: r.str(oo, 'label', `${path}.options[${i}]`, '') } : null;
      })
      .filter((x): x is { value: string; label: string } => x !== null);
  }
  return p;
}

function makerRef(r: Reader, v: unknown, path: string): MakerRef | undefined {
  if (v === undefined || v === null) return undefined;
  const o = r.obj(v, path);
  if (!o) return undefined;
  const id = r.oneOf(o, 'id', path, MAKER_IDS);
  if (!id) {
    r.issue(`${path}.id`, 'is required');
    return undefined;
  }
  return { id, input: r.record(o, 'input', path) ?? {} };
}

function model(r: Reader, v: unknown, path: string): CustomModel {
  const o = r.obj(v, path);
  if (!o) return { kind: 'none' };
  switch (o.kind) {
    case 'none':
      return { kind: 'none' };
    case 'builtin': {
      const m: CustomModel = { kind: 'builtin', partId: r.str(o, 'partId', path), pinMap: r.record(o, 'pinMap', path) ?? {} };
      const params = r.record(o, 'params', path);
      if (params) m.params = params;
      const mk = makerRef(r, o.maker, `${path}.maker`);
      if (mk) m.maker = mk;
      return m;
    }
    case 'spice': {
      const pins = r.arr(o, 'pins', path, true).map((x, i) => {
        if (typeof x === 'string') return x;
        r.issue(`${path}.pins[${i}]`, 'expected a pin name');
        return '';
      });
      const m: CustomModel = { kind: 'spice', text: r.str(o, 'text', path), name: r.str(o, 'name', path), pins };
      const mk = makerRef(r, o.maker, `${path}.maker`);
      if (mk) m.maker = mk;
      return m;
    }
    default:
      r.issue(`${path}.kind`, `must be none, builtin or spice (got ${JSON.stringify(o.kind)})`);
      return { kind: 'none' };
  }
}

/** Validate one user component. */
export function readCustomPart(raw: unknown, path: string, issues: string[]): CustomPartData | null {
  const r = new Reader(issues);
  const o = r.obj(raw, path);
  if (!o) return null;
  const id = r.str(o, 'id', path);
  if (!id.startsWith(CUSTOM_PREFIX) || id.length <= CUSTOM_PREFIX.length) r.issue(`${path}.id`, `must start with "${CUSTOM_PREFIX}"`);
  const symbol = readSymbol(o.symbol, `${path}.symbol`, issues);
  const d: CustomPartData = {
    id,
    name: r.str(o, 'name', path),
    group: r.oneOf(o, 'group', path, GROUP_IDS, 'misc') ?? 'misc',
    family: r.str(o, 'family', path, ''),
    description: r.str(o, 'description', path, ''),
    prefix: r.str(o, 'prefix', path, 'U'),
    symbol: symbol ?? { bbox: { x: 0, y: 0, w: 0, h: 0 }, prims: [], pins: [] },
    model: model(r, o.model, `${path}.model`),
  };
  if (o.params !== undefined && o.params !== null) d.params = r.arr(o, 'params', path).map((v, i) => readParamDef(v, `${path}.params[${i}]`, issues)).filter((p): p is ParamDef => p !== null);
  const footprint = r.optStr(o, 'footprint', path);
  if (footprint !== undefined) d.footprint = footprint;
  const hyperlink = r.optStr(o, 'hyperlink', path);
  if (hyperlink !== undefined && hyperlink.trim()) {
    if (isWebLink(hyperlink)) d.hyperlink = hyperlink.trim();
    else r.issue(`${path}.hyperlink`, 'must be an http:// or https:// address');
  }
  if (o.keywords !== undefined && o.keywords !== null) d.keywords = r.arr(o, 'keywords', path).filter((k): k is string => typeof k === 'string');
  const fields = r.record(o, 'fields', path);
  if (fields) d.fields = fields;
  const provenance = r.optStr(o, 'provenance', path);
  if (provenance !== undefined) d.provenance = provenance;
  if (o.indicator !== undefined && o.indicator !== null) {
    const io = r.obj(o.indicator, `${path}.indicator`);
    if (io) {
      if (io.kind !== 'led') r.issue(`${path}.indicator.kind`, 'must be led');
      else d.indicator = { kind: 'led', color: r.str(io, 'color', `${path}.indicator`, 'red') };
    }
  }
  const modified = r.optStr(o, 'modified', path);
  if (modified !== undefined) d.modified = modified;
  const author = r.optStr(o, 'author', path);
  if (author !== undefined) d.author = author;
  // a valid copy keeps the file's own key order, so a loaded design saves back to the same text
  return sameJson(d, o) ? (JSON.parse(JSON.stringify(o)) as CustomPartData) : d;
}

/** Deep equality of JSON values, ignoring object key order. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameJson(x, b[i]));
  }
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameJson(a[k], b[k]));
}
