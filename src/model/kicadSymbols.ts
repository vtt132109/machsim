/**
 * KiCad symbol libraries as MachSim user parts, and back.
 *
 *   parseKicadSym(text)                  .kicad_sym (KiCad 6 and later, s-expressions) -> KSymbol[]
 *   parseLegacyLib(text)                 .lib (KiCad 5 and earlier, line based)         -> KSymbol[]
 *   symbolsToParts(symbols, opts)        KSymbol[] -> CustomPartData[] for the User database
 *   importKicadSymbols(text, opts)       either library text -> { parts, families, notes }
 *   partsToKicadSym(parts, opts)         user parts -> .kicad_sym text (+ the SPICE models they use)
 *   kicadLibSymbolsSexpr(symbols)        KSymbol[] as the `lib_symbols` list of a .kicad_sch
 *
 * Read from the public file-format descriptions of both generations. A symbol is kept in KiCad's own
 * terms first (`KSymbol`: millimetres, y up, a pin is a connection point plus the direction it
 * points into the body and a length), which is what lets one converter serve both formats and
 * the schematic importers (kicadImport.ts / kicadLegacy.ts) share the pin geometry.
 *
 * What becomes what
 *   - body graphics: rectangle, polyline, circle, arc, bezier (flattened) and text become the
 *     matching symbol shapes; fill "none" stays open, "outline" and "background" are filled with the
 *     symbol colour; stroke widths and colours are dropped;
 *   - pins: connection point (snapped to the 10-unit grid) + a stub line to the body, the KiCad name
 *     as the label, the number as the physical number, the electrical type mapped to the closest
 *     MachSim pin type; hidden pins are kept but not labelled; "inverted" pins get a small circle;
 *   - units: a symbol with several units becomes one part per unit (A, B …), each with the shapes
 *     and pins common to all units; the De Morgan alternative body style is not imported;
 *   - `extends`: a derived symbol takes the body of its base;
 *   - fields: Reference gives the prefix, Footprint the footprint (the library nickname is dropped),
 *     Datasheet a web link, ki_description / ki_keywords the description and keywords, every other
 *     field is kept as a user field;
 *   - SPICE fields (KiCad 8 `Sim.*`, KiCad 6/7 `Spice_*`): R / C / L / V / I reuse the library part
 *     with the value, D / Q / J / M with `.model` parameters become a SPICE model, a part named by
 *     value ("2N3904") reuses the MachSim part of that name, a subcircuit is embedded when the
 *     library file is supplied. Anything else is imported without a model and said so in the notes.
 * Power symbols have no part form (a net name does the job in MachSim) and are left out.
 */
import { getPart } from '../library';
import { cloneSymbol } from '../library/custom/templates';
import { cardsText } from './spiceSchematic';
import { uniquePartId } from '../library/custom/database';
import { DEVICE_TERMINALS, findModelCard, findSubckt, modelDependencies, parseModelLibrary } from '../library/custom/spiceModels';
import { CUSTOM_PREFIX, isWebLink, type CustomModel, type CustomPartData } from '../library/custom/types';
import type { PartGroup, PinDef, PinType, SymbolDef, SymbolPrim } from '../library/types';
import { atom, child, children, head, parseSexpr, type SNode } from '../util/sexpr';
import { parseUserNumber } from '../util/units';
import { partsNamed } from './importSchematic';

/** MachSim symbol units per millimetre (1.27 mm = 10 units, the schematic grid). */
export const KICAD_UNITS_PER_MM = 10 / 1.27;
const MIL_TO_MM = 0.0254;

export type KPinType = 'input' | 'output' | 'bidirectional' | 'tri_state' | 'passive' | 'free' | 'unspecified' | 'power_in' | 'power_out' | 'open_collector' | 'open_emitter' | 'no_connect';

export interface KPin {
  number: string;
  name: string;
  /** connection point, mm, y up */
  x: number;
  y: number;
  /** direction from the connection point into the body, degrees (0 right, 90 up, 180 left, 270 down) */
  angle: number;
  length: number;
  type: KPinType;
  /** graphic style: line, inverted, clock, inverted_clock, input_low, clock_low, output_low, edge_clock_high, non_logic */
  style: string;
  hidden: boolean;
  /** 0 = common to every unit */
  unit: number;
}

export type KFill = 'none' | 'outline' | 'background';

export type KGraphic =
  | { kind: 'rect'; x1: number; y1: number; x2: number; y2: number; fill: KFill; unit: number }
  | { kind: 'poly'; pts: number[]; fill: KFill; unit: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: KFill; unit: number }
  /** arc drawn counter-clockwise (y up) from `a1` to `a2` degrees */
  | { kind: 'arc'; cx: number; cy: number; r: number; a1: number; a2: number; fill: KFill; unit: number }
  | { kind: 'text'; text: string; x: number; y: number; size: number; angle: number; unit: number };

export interface KSymbol {
  name: string;
  extends?: string;
  props: Record<string, string>;
  power: boolean;
  /** number of units (1 for a plain symbol) */
  units: number;
  pins: KPin[];
  graphics: KGraphic[];
  hidePinNumbers: boolean;
  hidePinNames: boolean;
  /** body styles other than the normal one were present and skipped */
  deMorgan: boolean;
}

export type KicadSymbolNote =
  | { code: 'powerSkipped'; name: string }
  | { code: 'pinOffGrid'; name: string; count: number }
  | { code: 'units'; name: string; units: number }
  | { code: 'deMorgan'; name: string }
  | { code: 'extendsMissing'; name: string; base: string }
  | { code: 'noModel'; name: string }
  | { code: 'modelLibraryMissing'; name: string; file: string }
  | { code: 'modelUnsupported'; name: string; device: string }
  | { code: 'modelFromValue'; name: string; part: string }
  | { code: 'noPins'; name: string }
  | { code: 'duplicatePins'; name: string };

export class KicadSymbolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KicadSymbolError';
  }
}

const num = (n: SNode | undefined, fallback = 0): number => {
  const v = Number(atom(n));
  return Number.isFinite(v) ? v : fallback;
};

const normDeg = (a: number): number => ((a % 360) + 360) % 360;

// ---------------------------------------------------------------------------------------------
// .kicad_sym

function fillOf(node: SNode[]): KFill {
  const t = atom(child(child(node, 'fill'), 'type')?.[1]);
  return t === 'outline' ? 'outline' : t === 'background' ? 'background' : 'none';
}

function isHidden(node: SNode[]): boolean {
  return node.some((x) => atom(x) === 'hide') || atom(child(node, 'hide')?.[1]) === 'yes';
}

/** Arc through three points (KiCad 7 form) as centre + counter-clockwise angles; null for collinear points. */
function arcFromThreePoints(s: [number, number], m: [number, number], e: [number, number]): { cx: number; cy: number; r: number; a1: number; a2: number } | null {
  const [ax, ay] = s;
  const [bx, by] = m;
  const [cx, cy] = e;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const ang = (x: number, y: number) => normDeg((Math.atan2(y - uy, x - ux) * 180) / Math.PI);
  const as = ang(ax, ay);
  const am = ang(bx, by);
  const ae = ang(cx, cy);
  // counter-clockwise from s to e passes through m?
  const span = (from: number, to: number) => normDeg(to - from);
  if (span(as, am) <= span(as, ae)) return { cx: ux, cy: uy, r, a1: as, a2: ae };
  return { cx: ux, cy: uy, r, a1: ae, a2: as };
}

function sampleBezier(p: number[], steps = 12): number[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
  return out;
}

const PIN_TYPES_IN: readonly KPinType[] = ['input', 'output', 'bidirectional', 'tri_state', 'passive', 'free', 'unspecified', 'power_in', 'power_out', 'open_collector', 'open_emitter', 'no_connect'];

/** Read one `(symbol ...)` list of a library (units included). */
function readSymbolNode(node: SNode[], parentName?: string): KSymbol {
  const name = atom(node[1]);
  const props: Record<string, string> = {};
  for (const p of children(node, 'property')) props[atom(p[1])] = atom(p[2]);
  const pinNames = child(node, 'pin_names');
  const sym: KSymbol = {
    name,
    props,
    power: !!child(node, 'power'),
    units: 1,
    pins: [],
    graphics: [],
    hidePinNumbers: isHidden(child(node, 'pin_numbers') ?? []),
    hidePinNames: pinNames ? isHidden(pinNames) : false,
    deMorgan: false,
  };
  const ext = atom(child(node, 'extends')?.[1]);
  if (ext) sym.extends = ext;
  const collect = (list: SNode[], unit: number) => {
    for (const g of list) {
      if (!Array.isArray(g)) continue;
      switch (head(g)) {
        case 'rectangle': {
          const s = child(g, 'start');
          const e = child(g, 'end');
          sym.graphics.push({ kind: 'rect', x1: num(s?.[1]), y1: num(s?.[2]), x2: num(e?.[1]), y2: num(e?.[2]), fill: fillOf(g), unit });
          break;
        }
        case 'polyline': {
          const pts: number[] = [];
          for (const xy of children(child(g, 'pts'), 'xy')) pts.push(num(xy[1]), num(xy[2]));
          if (pts.length >= 4) sym.graphics.push({ kind: 'poly', pts, fill: fillOf(g), unit });
          break;
        }
        case 'bezier': {
          const pts: number[] = [];
          for (const xy of children(child(g, 'pts'), 'xy')) pts.push(num(xy[1]), num(xy[2]));
          if (pts.length === 8) sym.graphics.push({ kind: 'poly', pts: sampleBezier(pts), fill: fillOf(g), unit });
          else if (pts.length >= 4) sym.graphics.push({ kind: 'poly', pts, fill: fillOf(g), unit });
          break;
        }
        case 'circle': {
          const c = child(g, 'center');
          sym.graphics.push({ kind: 'circle', cx: num(c?.[1]), cy: num(c?.[2]), r: num(child(g, 'radius')?.[1]), fill: fillOf(g), unit });
          break;
        }
        case 'arc': {
          const s = child(g, 'start');
          const m = child(g, 'mid');
          const e = child(g, 'end');
          const rad = child(g, 'radius');
          if (m && s && e) {
            const a = arcFromThreePoints([num(s[1]), num(s[2])], [num(m[1]), num(m[2])], [num(e[1]), num(e[2])]);
            if (a) sym.graphics.push({ kind: 'arc', ...a, fill: fillOf(g), unit });
          } else if (rad) {
            // KiCad 6.0: (radius (at cx cy) (length r) (angles a1 a2)); angles in tenths of a degree in 6.0 files
            const at = child(rad, 'at');
            const angles = child(rad, 'angles');
            const raw1 = num(angles?.[1]);
            const raw2 = num(angles?.[2]);
            const tenth = Math.abs(raw1) > 360 || Math.abs(raw2) > 360;
            sym.graphics.push({ kind: 'arc', cx: num(at?.[1]), cy: num(at?.[2]), r: num(child(rad, 'length')?.[1]), a1: normDeg(tenth ? raw1 / 10 : raw1), a2: normDeg(tenth ? raw2 / 10 : raw2), fill: fillOf(g), unit });
          }
          break;
        }
        case 'text': {
          const at = child(g, 'at');
          const size = num(child(child(child(g, 'effects'), 'font'), 'size')?.[1], 1.27);
          sym.graphics.push({ kind: 'text', text: atom(g[1]), x: num(at?.[1]), y: num(at?.[2]), size, angle: num(at?.[3]), unit });
          break;
        }
        case 'pin': {
          const at = child(g, 'at');
          const type = atom(g[1]) as KPinType;
          sym.pins.push({
            type: PIN_TYPES_IN.includes(type) ? type : 'unspecified',
            style: atom(g[2]) || 'line',
            x: num(at?.[1]),
            y: num(at?.[2]),
            angle: normDeg(num(at?.[3])),
            length: num(child(g, 'length')?.[1]),
            name: atom(child(g, 'name')?.[1]),
            number: atom(child(g, 'number')?.[1]),
            hidden: isHidden(g),
            unit,
          });
          break;
        }
      }
    }
  };
  collect(node, 0);
  let maxUnit = 1;
  for (const sub of children(node, 'symbol')) {
    // "R_1_1": unit 1, body style 1; unit 0 holds what every unit shares; style 2 is the De Morgan body
    const subName = atom(sub[1]);
    const m = /_(\d+)_(\d+)$/.exec(subName);
    const base = parentName ?? name;
    const unit = m ? Number(m[1]) : 0;
    const style = m ? Number(m[2]) : 1;
    if (!subName.startsWith(base) && !m) continue;
    if (style > 1) {
      sym.deMorgan = true;
      continue;
    }
    maxUnit = Math.max(maxUnit, unit);
    collect(sub, unit);
  }
  sym.units = maxUnit;
  return sym;
}

/** Read a `.kicad_sym` library; derived symbols (`extends`) are resolved. */
export function parseKicadSym(text: string): { symbols: KSymbol[]; notes: KicadSymbolNote[] } {
  let root: SNode[];
  try {
    root = parseSexpr(text);
  } catch (e) {
    throw new KicadSymbolError(e instanceof Error ? e.message : String(e));
  }
  if (head(root) !== 'kicad_symbol_lib') throw new KicadSymbolError(`not a KiCad symbol library (the file starts with "${head(root) || '?'}", expected kicad_symbol_lib)`);
  const notes: KicadSymbolNote[] = [];
  const list = children(root, 'symbol').map((n) => readSymbolNode(n));
  const byName = new Map(list.map((s) => [s.name, s]));
  for (const s of list) {
    if (!s.extends) continue;
    const base = byName.get(s.extends);
    if (!base) {
      notes.push({ code: 'extendsMissing', name: s.name, base: s.extends });
      continue;
    }
    // the derived symbol draws the body of its base under its own fields
    s.pins = base.pins.map((p) => ({ ...p }));
    s.graphics = base.graphics.map((g) => ({ ...g }));
    s.units = base.units;
    s.hidePinNumbers = base.hidePinNumbers;
    s.hidePinNames = base.hidePinNames;
    s.deMorgan = base.deMorgan;
    s.power = s.power || base.power;
    for (const [k, v] of Object.entries(base.props)) if (!(k in s.props) && !k.startsWith('ki_')) s.props[k] = v;
  }
  return { symbols: list, notes };
}

// ---------------------------------------------------------------------------------------------
// legacy .lib

const LEGACY_PIN: Record<string, KPinType> = { I: 'input', O: 'output', B: 'bidirectional', T: 'tri_state', P: 'passive', U: 'unspecified', W: 'power_in', w: 'power_out', C: 'open_collector', E: 'open_emitter', N: 'no_connect' };
const LEGACY_ORIENT: Record<string, number> = { R: 0, U: 90, L: 180, D: 270 };

/** Split a legacy line into tokens, keeping "quoted text" together. */
function legacyTokens(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  return out;
}

const legacyFill = (t: string | undefined): KFill => (t === 'F' ? 'outline' : t === 'f' ? 'background' : 'none');

/** Read a legacy `.lib` (KiCad 5 and earlier). */
export function parseLegacyLib(text: string): { symbols: KSymbol[]; notes: KicadSymbolNote[] } {
  const lines = text.replace(/^﻿/, '').split(/\r\n?|\n/);
  if (!/^EESchema-LIBRARY/i.test(lines[0] ?? '')) throw new KicadSymbolError('not a KiCad component library (the file does not start with EESchema-LIBRARY)');
  const symbols: KSymbol[] = [];
  const notes: KicadSymbolNote[] = [];
  let cur: KSymbol | null = null;
  let inDraw = false;
  const mm = (v: string | undefined) => (Number(v) || 0) * MIL_TO_MM;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const t = legacyTokens(line);
    const key = t[0];
    if (key === 'DEF' && !cur) {
      const name = (t[1] ?? '').replace(/^~/, '');
      cur = {
        name,
        props: { Reference: t[2] ?? 'U', Value: name },
        power: t[10] === 'P' || t[9] === 'P',
        units: Math.max(1, Number(t[7]) || 1),
        pins: [],
        graphics: [],
        hidePinNumbers: t[5] === 'N',
        hidePinNames: t[6] === 'N',
        deMorgan: false,
      };
      continue;
    }
    if (!cur) continue;
    if (key === 'ENDDEF') {
      symbols.push(cur);
      cur = null;
      inDraw = false;
      continue;
    }
    if (key === 'DRAW') {
      inDraw = true;
      continue;
    }
    if (key === 'ENDDRAW') {
      inDraw = false;
      continue;
    }
    if (/^F\d+$/.test(key)) {
      const n = Number(key.slice(1));
      const value = t[1] ?? '';
      if (n === 0) cur.props.Reference = value;
      else if (n === 1) cur.props.Value = value || cur.name;
      else if (n === 2) cur.props.Footprint = value;
      else if (n === 3) cur.props.Datasheet = value;
      else if (t[t.length - 1] && n >= 4) cur.props[t[t.length - 1]] = value;
      continue;
    }
    if (key === 'ALIAS') continue;
    if (key === '$FPLIST' || key === '$ENDFPLIST') continue;
    if (!inDraw) continue;
    const part = (v: string | undefined) => Number(v) || 0;
    const convert = (v: string | undefined) => Number(v) || 0;
    switch (key) {
      case 'S': {
        if (convert(t[6]) > 1) {
          cur.deMorgan = true;
          break;
        }
        cur.graphics.push({ kind: 'rect', x1: mm(t[1]), y1: mm(t[2]), x2: mm(t[3]), y2: mm(t[4]), fill: legacyFill(t[8]), unit: part(t[5]) });
        break;
      }
      case 'C': {
        if (convert(t[5]) > 1) {
          cur.deMorgan = true;
          break;
        }
        cur.graphics.push({ kind: 'circle', cx: mm(t[1]), cy: mm(t[2]), r: mm(t[3]), fill: legacyFill(t[7]), unit: part(t[4]) });
        break;
      }
      case 'A': {
        if (convert(t[7]) > 1) {
          cur.deMorgan = true;
          break;
        }
        const a1 = normDeg(Number(t[4]) / 10);
        const a2 = normDeg(Number(t[5]) / 10);
        cur.graphics.push({ kind: 'arc', cx: mm(t[1]), cy: mm(t[2]), r: mm(t[3]), a1, a2, fill: legacyFill(t[9]), unit: part(t[6]) });
        break;
      }
      case 'P':
      case 'B': {
        const count = Number(t[1]) || 0;
        if (convert(t[3]) > 1) {
          cur.deMorgan = true;
          break;
        }
        const pts: number[] = [];
        for (let i = 0; i < count; i++) pts.push(mm(t[5 + i * 2]), mm(t[6 + i * 2]));
        const fill = legacyFill(t[5 + count * 2]);
        if (pts.length >= 4) cur.graphics.push({ kind: 'poly', pts: key === 'B' && pts.length === 8 ? sampleBezier(pts) : pts, fill, unit: part(t[2]) });
        break;
      }
      case 'T': {
        if (convert(t[7]) > 1) {
          cur.deMorgan = true;
          break;
        }
        const textValue = (t[8] ?? '').replace(/~/g, ' ');
        // orientation 900 = vertical text
        cur.graphics.push({ kind: 'text', text: textValue, x: mm(t[2]), y: mm(t[3]), size: mm(t[4]), angle: Number(t[1]) === 900 ? 90 : 0, unit: part(t[6]) });
        break;
      }
      case 'X': {
        if (convert(t[10]) > 1) {
          cur.deMorgan = true;
          break;
        }
        const shape = t[12] ?? '';
        const style = shape.includes('I') && shape.includes('C') ? 'inverted_clock' : shape.includes('I') ? 'inverted' : shape.includes('C') ? 'clock' : 'line';
        cur.pins.push({
          name: t[1] === '~' ? '' : (t[1] ?? ''),
          number: t[2] ?? '',
          x: mm(t[3]),
          y: mm(t[4]),
          length: mm(t[5]),
          angle: LEGACY_ORIENT[t[6]] ?? 0,
          unit: part(t[9]),
          type: LEGACY_PIN[t[11]] ?? 'unspecified',
          style,
          hidden: shape.startsWith('N'),
        });
        break;
      }
    }
  }
  return { symbols, notes };
}

// ---------------------------------------------------------------------------------------------
// KSymbol -> user parts

const MACHSIM_PIN: Record<KPinType, PinType> = {
  input: 'input',
  output: 'output',
  bidirectional: 'bidir',
  tri_state: 'tristate',
  passive: 'passive',
  free: 'passive',
  unspecified: 'passive',
  power_in: 'power-in',
  power_out: 'power-out',
  open_collector: 'open-collector',
  open_emitter: 'output',
  no_connect: 'nc',
};

// `|| 0` turns a negative zero into a plain 0 (a flipped y of 0 must not print as -0)
const u = (mm: number): number => Math.round(mm * KICAD_UNITS_PER_MM * 2) / 2 || 0;
const snap10 = (v: number): number => Math.round(v / 10) * 10 || 0;
const fillStyle = (f: KFill): boolean | undefined => (f === 'none' ? undefined : true);

function graphicPrims(g: KGraphic): SymbolPrim[] {
  switch (g.kind) {
    case 'rect': {
      const x = u(Math.min(g.x1, g.x2));
      const y = u(-Math.max(g.y1, g.y2));
      const f = fillStyle(g.fill);
      return [{ kind: 'rect', x, y, w: Math.abs(u(g.x2) - u(g.x1)), h: Math.abs(u(g.y2) - u(g.y1)), ...(f ? { fill: f } : {}) }];
    }
    case 'poly': {
      const points: number[] = [];
      for (let i = 0; i + 1 < g.pts.length; i += 2) points.push(u(g.pts[i]), u(-g.pts[i + 1]));
      const closed = points.length >= 6 && points[0] === points[points.length - 2] && points[1] === points[points.length - 1];
      const f = fillStyle(g.fill);
      return [{ kind: 'polyline', points: closed ? points.slice(0, -2) : points, ...(closed || f ? { closed: true } : {}), ...(f ? { fill: f } : {}) }];
    }
    case 'circle': {
      const f = fillStyle(g.fill);
      return [{ kind: 'circle', cx: u(g.cx), cy: u(-g.cy), r: u(g.r), ...(f ? { fill: f } : {}) }];
    }
    case 'arc': {
      // counter-clockwise (y up) from a1 to a2 is clockwise on screen from -a2 to -a1
      const start = normDeg(-g.a2);
      const end = normDeg(-g.a1);
      return [{ kind: 'arc', cx: u(g.cx), cy: u(-g.cy), r: u(g.r), start, end: end === start ? start + 360 : end }];
    }
    case 'text':
      if (!g.text.trim()) return [];
      return [{ kind: 'text', x: u(g.x), y: u(-g.y), text: g.text, size: Math.max(6, Math.round(g.size * KICAD_UNITS_PER_MM * 0.9)), anchor: 'middle' }];
  }
}

const SIDE: Record<number, NonNullable<PinDef['dir']>> = { 0: 'left', 90: 'down', 180: 'right', 270: 'up' };

/** Shapes and pin of one KiCad pin: a stub line to the body, an inversion circle, the MachSim pin. */
function pinParts(p: KPin, name: string): { pin: PinDef; prims: SymbolPrim[]; offGrid: boolean } {
  const x = u(p.x);
  const y = u(-p.y);
  const px = snap10(x);
  const py = snap10(y);
  const a = (p.angle * Math.PI) / 180;
  const len = u(p.length);
  const bx = px + len * Math.cos(a);
  const by = py - len * Math.sin(a);
  const prims: SymbolPrim[] = [];
  // `|| 0` turns a negative zero (cos of 90 degrees times a negative number) into a plain 0
  if (len > 0) prims.push({ kind: 'line', x1: px, y1: py, x2: Math.round(bx * 2) / 2 || 0, y2: Math.round(by * 2) / 2 || 0 });
  if (p.style === 'inverted' || p.style === 'inverted_clock') {
    prims.push({ kind: 'circle', cx: Math.round((bx - Math.cos(a) * 3) * 2) / 2, cy: Math.round((by + Math.sin(a) * 3) * 2) / 2, r: 3 });
  }
  if (p.style === 'clock' || p.style === 'inverted_clock' || p.style === 'edge_clock_high') {
    // a small triangle on the body edge
    const nx = -Math.sin(a);
    const ny = -Math.cos(a);
    const s = 4;
    prims.push({ kind: 'polyline', points: [bx + nx * s, by + ny * s, bx + Math.cos(a) * s * 1.5, by - Math.sin(a) * s * 1.5, bx - nx * s, by - ny * s] });
  }
  const label = p.name && p.name !== '~' && !p.hidden ? p.name : undefined;
  const pin: PinDef = { name, x: px, y: py, dir: SIDE[Math.round(p.angle / 90) * 90 % 360] ?? 'left', type: MACHSIM_PIN[p.type], ...(label ? { label } : {}), ...(p.number ? { number: p.number } : {}) };
  return { pin, prims, offGrid: Math.abs(px - x) > 0.51 || Math.abs(py - y) > 0.51 };
}

function boundsOf(prims: SymbolPrim[], pins: PinDef[]): SymbolDef['bbox'] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const p of prims) {
    switch (p.kind) {
      case 'line':
        add(p.x1, p.y1);
        add(p.x2, p.y2);
        break;
      case 'rect':
        add(p.x, p.y);
        add(p.x + p.w, p.y + p.h);
        break;
      case 'circle':
      case 'arc':
        add(p.cx - p.r, p.cy - p.r);
        add(p.cx + p.r, p.cy + p.r);
        break;
      case 'polyline':
        for (let i = 0; i + 1 < p.points.length; i += 2) add(p.points[i], p.points[i + 1]);
        break;
      case 'text':
        add(p.x, p.y);
        break;
      case 'path':
        break;
    }
  }
  for (const p of pins) add(p.x, p.y);
  if (!Number.isFinite(x0)) return { x: -10, y: -10, w: 20, h: 20 };
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** The symbol of one unit (0 = common only) as a MachSim symbol. */
function unitSymbol(sym: KSymbol, unit: number): { symbol: SymbolDef; offGrid: number; duplicate: boolean } {
  const prims: SymbolPrim[] = [];
  for (const g of sym.graphics) if (g.unit === 0 || g.unit === unit) prims.push(...graphicPrims(g));
  const pins: PinDef[] = [];
  const used = new Set<string>();
  let offGrid = 0;
  let duplicate = false;
  for (const p of sym.pins) {
    if (p.unit !== 0 && p.unit !== unit) continue;
    // the pin name used to connect models is its number; two pins with one number get a suffix
    let name = p.number || p.name || String(pins.length + 1);
    if (used.has(name)) {
      duplicate = true;
      let k = 2;
      while (used.has(`${name}_${k}`)) k++;
      name = `${name}_${k}`;
    }
    used.add(name);
    const r = pinParts(p, name);
    if (r.offGrid) offGrid++;
    prims.push(...r.prims);
    pins.push(r.pin);
  }
  const bbox = boundsOf(prims, pins);
  const cx = bbox.x + bbox.w / 2;
  return { symbol: { bbox, prims, pins, refPos: { x: Math.round(cx), y: Math.round(bbox.y - 6) }, valuePos: { x: Math.round(cx), y: Math.round(bbox.y + bbox.h + 14) } }, offGrid, duplicate };
}

const GROUP_BY_PREFIX: Record<string, PartGroup> = { R: 'basic', RV: 'basic', C: 'basic', L: 'basic', D: 'diodes', LED: 'diodes', Q: 'transistors', U: 'misc', IC: 'misc' };

function groupFor(prefix: string, device: string): PartGroup {
  if (['D', 'LED'].includes(device) || device === 'D') return 'diodes';
  if (['NPN', 'PNP', 'NMOS', 'PMOS', 'NJFET', 'PJFET', 'Q', 'M', 'J'].includes(device)) return 'transistors';
  if (['R', 'C', 'L'].includes(device)) return 'basic';
  if (['V', 'I'].includes(device)) return 'sources';
  return GROUP_BY_PREFIX[prefix.toUpperCase()] ?? 'misc';
}

export interface SymbolImportOptions {
  /** library file name (provenance, family) */
  fileName?: string;
  /** family of the User database the parts are listed under (default "KiCad") */
  family?: string;
  /** ids already used in the target database (new ids avoid them) */
  takenIds?: ReadonlySet<string>;
  /** SPICE model files by lower-case base name, for symbols whose `Sim.Library` / `Spice_Lib_File` names one */
  libraries?: ReadonlyMap<string, string>;
}

export interface SymbolImportResult {
  parts: CustomPartData[];
  /** (group, family) pairs to add to the target database */
  families: { group: PartGroup; name: string }[];
  notes: KicadSymbolNote[];
}

const baseName = (path: string): string => (path.split(/[\\/]/).pop() ?? path).toLowerCase();

/** Pin numbers of a symbol in order (numeric where possible). */
function sortedNumbers(pins: readonly PinDef[]): string[] {
  return pins.map((p) => p.name).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

/** "1=C 2=B 3=E" → { 1: 'C', … }. */
function pinRoles(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (text ?? '').matchAll(/(\S+?)\s*=\s*(\S+)/g)) out[m[1]] = m[2];
  return out;
}

function paramText(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (text ?? '').matchAll(/([A-Za-z_][\w.]*)\s*=\s*"?([^\s"]+)"?/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

const DEVICE_ALIAS: Record<string, string> = { R: 'R', C: 'C', L: 'L', V: 'V', I: 'I', D: 'D', NPN: 'NPN', PNP: 'PNP', NMOS: 'NMOS', PMOS: 'PMOS', NJFET: 'NJF', PJFET: 'PJF', NJF: 'NJF', PJF: 'PJF', SUBCKT: 'SUBCKT', X: 'SUBCKT', SPICE: 'SUBCKT' };

/**
 * The simulation model of a symbol from its SPICE fields. `pinNames` are the names of the MachSim
 * pins (the KiCad pin numbers). Returns the model, the SPICE device it stands for and notes.
 */
function modelFromFields(sym: KSymbol, symbol: SymbolDef, opts: SymbolImportOptions, notes: KicadSymbolNote[], partName: string): { model: CustomModel; device: string; params?: undefined } {
  const f = sym.props;
  const enabled = (f.Spice_Netlist_Enabled ?? 'Y').toUpperCase() !== 'N' && (f['Sim.Enable'] ?? '1') !== '0';
  const primitive = (f.Spice_Primitive ?? '').toUpperCase();
  let device = (f['Sim.Device'] ?? '').toUpperCase();
  if (!device && primitive) {
    device = primitive === 'Q' ? ((f.Sim_Type ?? f['Sim.Type'] ?? '').toUpperCase() === 'PNP' ? 'PNP' : 'NPN') : primitive === 'M' ? 'NMOS' : primitive === 'J' ? 'NJF' : primitive;
  }
  if (!device || !enabled) return { model: { kind: 'none' }, device: '' };
  const dev = DEVICE_ALIAS[device] ?? device;
  const roles = pinRoles(f['Sim.Pins']);
  const sequence = (f.Spice_Node_Sequence ?? '').split(/\s+/).filter(Boolean);
  const numbers = sortedNumbers(symbol.pins);
  const params = paramText(f['Sim.Params']);
  const value = (f.Spice_Model ?? '').trim() || f.Value || '';
  // the symbol pin for a model role name (A, K, C, B, E …), else by the node sequence, else by number order
  const pinFor = (role: string, index: number): string => {
    const hit = Object.entries(roles).find(([, r]) => r.toLowerCase() === role.toLowerCase());
    if (hit && numbers.includes(hit[0])) return hit[0];
    if (sequence[index] && numbers.includes(sequence[index])) return sequence[index];
    return numbers[index] ?? '';
  };

  if (dev === 'R' || dev === 'C' || dev === 'L') {
    const text = params[dev.toLowerCase()] ?? params.value ?? (/^[\d.]/.test(value) ? value : '');
    const partId = dev === 'R' ? 'basic/resistor' : dev === 'C' ? 'basic/capacitor' : 'basic/inductor';
    const lib = getPart(partId);
    if (!lib || numbers.length < 2) return { model: { kind: 'none' }, device: dev };
    const pinMap: Record<string, string> = {};
    lib.symbol.pins.forEach((p, i) => (pinMap[p.name] = pinFor(String(i + 1), i)));
    const v = text && Number.isFinite(parseUserNumber(text)) ? text : undefined;
    return { model: { kind: 'builtin', partId, pinMap, ...(v ? { params: { value: v } } : {}) }, device: dev };
  }
  if (dev === 'V' || dev === 'I') {
    const type = (f['Sim.Type'] ?? 'DC').toUpperCase();
    const dc = params.dc ?? (/^[\d.]/.test(value) ? value : '');
    if (type !== 'DC' && type !== '') {
      notes.push({ code: 'modelUnsupported', name: partName, device: `${dev} ${type}` });
      return { model: { kind: 'none' }, device: dev };
    }
    const lib = getPart(dev === 'V' ? 'sources/dc-voltage' : 'sources/dc-current');
    if (!lib || numbers.length < 2) return { model: { kind: 'none' }, device: dev };
    const pinMap: Record<string, string> = {};
    lib.symbol.pins.forEach((p, i) => (pinMap[p.name] = pinFor(p.name === '+' ? '+' : '-', i)));
    const v = dc && Number.isFinite(parseUserNumber(dc)) ? dc : undefined;
    return { model: { kind: 'builtin', partId: lib.id, pinMap, ...(v ? { params: { value: v } } : {}) }, device: dev };
  }

  // a model library file the part names (SUBCKT, or a named .model of a semiconductor)
  const libFile = f['Sim.Library'] ?? f.Spice_Lib_File ?? '';
  const modelName = (f['Sim.Name'] ?? '').trim() || value;
  const libText = libFile ? opts.libraries?.get(baseName(libFile)) : undefined;
  if (libText) {
    const lib = parseModelLibrary(libText);
    const sub = findSubckt(lib, modelName);
    const card = findModelCard(lib, modelName);
    if (sub || card) {
      const deps = modelDependencies(lib, modelName);
      const text = cardsText(deps.models, deps.subckts);
      const terminals = sub ? [...sub.ports] : [...(DEVICE_TERMINALS[card!.type.toUpperCase()]?.terminals ?? [])];
      const pins = terminals.map((role, i) => pinFor(role, i));
      return { model: { kind: 'spice', text, name: (sub ?? card)!.name, pins }, device: dev };
    }
  }
  if (libFile && !libText && (dev === 'SUBCKT' || primitive === 'X')) {
    notes.push({ code: 'modelLibraryMissing', name: partName, file: libFile });
    return { model: { kind: 'none' }, device: dev };
  }

  // a MachSim part of that name ("2N3904", "1N4148") with the same pins
  const named = value ? partsNamed(value) : [];
  const same = named.find((d) => d.symbol.pins.length === symbol.pins.length);
  if (same) {
    const pinMap: Record<string, string> = {};
    same.symbol.pins.forEach((p, i) => (pinMap[p.name] = pinFor(p.name, i)));
    notes.push({ code: 'modelFromValue', name: partName, part: same.id });
    return { model: { kind: 'builtin', partId: same.id, pinMap }, device: dev };
  }

  // a semiconductor with .model parameters: build the card
  const cardType = dev === 'D' ? 'D' : dev === 'NPN' || dev === 'PNP' ? dev : dev === 'NMOS' || dev === 'PMOS' ? dev : dev === 'NJF' || dev === 'PJF' ? dev : '';
  if (cardType && Object.keys(params).length) {
    const terminals = DEVICE_TERMINALS[cardType]?.terminals ?? [];
    const name = partName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24) || 'KMODEL';
    const body = Object.entries(params)
      .filter(([k]) => !['type', 'device', 'value'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    return { model: { kind: 'spice', text: `.model ${name} ${cardType}(${body})`, name, pins: terminals.map((role, i) => pinFor(role, i)) }, device: dev };
  }
  notes.push({ code: 'modelUnsupported', name: partName, device: dev });
  return { model: { kind: 'none' }, device: dev };
}

/** Strip the library nickname and a trailing ? from a field. */
const prefixOf = (reference: string): string => {
  const letters = /^[A-Za-z]+/.exec(reference.replace(/\?+$/, '').trim())?.[0];
  return (letters ?? 'U').toUpperCase();
};

/** Convert symbols to user parts (one per unit for a multi-unit symbol). */
export function symbolsToParts(symbols: readonly KSymbol[], opts: SymbolImportOptions = {}): SymbolImportResult {
  const notes: KicadSymbolNote[] = [];
  const parts: CustomPartData[] = [];
  const taken = new Set<string>(opts.takenIds ?? []);
  const family = opts.family ?? 'KiCad';
  const families = new Map<string, { group: PartGroup; name: string }>();
  const provenance = `KiCad symbol library${opts.fileName ? ` ${opts.fileName}` : ''}`;
  for (const sym of symbols) {
    const baseName0 = sym.name.split(':').pop() ?? sym.name;
    if (sym.power || (sym.props.Reference ?? '').startsWith('#')) {
      notes.push({ code: 'powerSkipped', name: baseName0 });
      continue;
    }
    if (sym.pins.length === 0) {
      notes.push({ code: 'noPins', name: baseName0 });
      continue;
    }
    if (sym.deMorgan) notes.push({ code: 'deMorgan', name: baseName0 });
    const units = Math.max(1, sym.units);
    if (units > 1) notes.push({ code: 'units', name: baseName0, units });
    for (let unit = 1; unit <= units; unit++) {
      const label = units > 1 ? `${baseName0} ${String.fromCharCode(64 + unit)}` : baseName0;
      const built = unitSymbol(sym, unit);
      if (built.symbol.pins.length === 0) continue;
      if (built.offGrid) notes.push({ code: 'pinOffGrid', name: label, count: built.offGrid });
      if (built.duplicate) notes.push({ code: 'duplicatePins', name: label });
      const prefix = prefixOf(sym.props.Reference ?? 'U');
      // a unit of a multi-unit symbol has no model: its pins are part of a bigger package
      const m = units > 1 ? { model: { kind: 'none' } as CustomModel, device: '' } : modelFromFields(sym, built.symbol, opts, notes, label);
      const id = uniquePartId(label, taken);
      taken.add(id);
      const part: CustomPartData = {
        id,
        name: label,
        group: groupFor(prefix, m.device),
        family,
        description: (sym.props.ki_description || sym.props.Description || sym.props.Value || label).trim(),
        prefix,
        symbol: built.symbol,
        model: m.model,
        provenance,
      };
      const fp = (sym.props.Footprint ?? '').trim();
      if (fp) part.footprint = fp.includes(':') ? fp.slice(fp.indexOf(':') + 1) : fp;
      const ds = (sym.props.Datasheet ?? '').trim();
      if (ds && ds !== '~' && isWebLink(ds)) part.hyperlink = ds;
      const kw = (sym.props.ki_keywords ?? '').split(/\s+/).filter(Boolean);
      if (kw.length) part.keywords = kw;
      const skip = new Set(['Reference', 'Value', 'Footprint', 'Datasheet', 'Description', 'ki_description', 'ki_keywords', 'ki_fp_filters', 'Spice_Primitive', 'Spice_Model', 'Spice_Node_Sequence', 'Spice_Netlist_Enabled', 'Spice_Lib_File']);
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(sym.props)) if (!skip.has(k) && !k.startsWith('Sim.') && v.trim() && !/^(ki_|Sim_)/.test(k)) fields[k] = v;
      if (Object.keys(fields).length) part.fields = fields;
      if (m.model.kind === 'none' && m.device === '' && !Object.keys(sym.props).some((k) => /^(Sim\.|Spice_)/.test(k))) notes.push({ code: 'noModel', name: label });
      parts.push(part);
      families.set(`${part.group}|${family}`, { group: part.group, name: family });
    }
  }
  return { parts, families: [...families.values()], notes };
}

/** Import a symbol library of either generation, told apart by its first characters. */
export function importKicadSymbols(text: string, opts: SymbolImportOptions = {}): SymbolImportResult {
  const legacy = /^\s*EESchema-LIBRARY/i.test(text.replace(/^﻿/, ''));
  const parsed = legacy ? parseLegacyLib(text) : parseKicadSym(text);
  const r = symbolsToParts(parsed.symbols, opts);
  return { ...r, notes: [...parsed.notes, ...r.notes] };
}

// ---------------------------------------------------------------------------------------------
// user parts -> .kicad_sym

const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
const fmt = (v: number): string => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const mmOf = (units: number): number => units / KICAD_UNITS_PER_MM;
const KICAD_PIN: Record<PinType, KPinType> = {
  passive: 'passive',
  input: 'input',
  output: 'output',
  bidir: 'bidirectional',
  power: 'power_in',
  nc: 'no_connect',
  tristate: 'tri_state',
  'open-collector': 'open_collector',
  'power-in': 'power_in',
  'power-out': 'power_out',
};
const ANGLE_FOR_DIR: Record<NonNullable<PinDef['dir']>, number> = { left: 0, down: 90, right: 180, up: 270 };

/** Length of the stub a pin has in the drawing: the line that starts at the pin and heads into the body. */
function stubLength(sym: SymbolDef, pin: PinDef): number {
  const dir = pin.dir ?? 'left';
  const dx = dir === 'left' ? 1 : dir === 'right' ? -1 : 0;
  const dy = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
  for (const p of sym.prims) {
    if (p.kind !== 'line') continue;
    const ends: [number, number, number, number][] = [
      [p.x1, p.y1, p.x2, p.y2],
      [p.x2, p.y2, p.x1, p.y1],
    ];
    for (const [ax, ay, bx, by] of ends) {
      if (Math.abs(ax - pin.x) < 0.01 && Math.abs(ay - pin.y) < 0.01) {
        const l = (bx - ax) * dx + (by - ay) * dy;
        const side = Math.abs((bx - ax) * dy) + Math.abs((by - ay) * dx);
        if (l > 0 && side < 0.01) return l;
      }
    }
  }
  return 10;
}

/** Flatten SVG path data (M L H V Z, curves sampled) into point lists. */
function flattenPath(d: string): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = '';
  const n = () => Number(tokens[i++]);
  const flush = () => {
    if (cur.length >= 4) out.push(cur);
    cur = [];
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        flush();
        const nx = n();
        const ny = n();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        sx = x;
        sy = y;
        cur = [x, y];
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const nx = n();
        const ny = n();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        cur.push(x, y);
        break;
      }
      case 'H': {
        const nx = n();
        x = rel ? x + nx : nx;
        cur.push(x, y);
        break;
      }
      case 'V': {
        const ny = n();
        y = rel ? y + ny : ny;
        cur.push(x, y);
        break;
      }
      case 'C': {
        const p = [n(), n(), n(), n(), n(), n()].map((v, k) => (rel ? v + (k % 2 === 0 ? x : y) : v));
        cur.push(...sampleBezier([x, y, ...p]).slice(2));
        x = p[4];
        y = p[5];
        break;
      }
      case 'Q': {
        const p = [n(), n(), n(), n()].map((v, k) => (rel ? v + (k % 2 === 0 ? x : y) : v));
        // a quadratic as a cubic
        const c1x = x + (2 / 3) * (p[0] - x);
        const c1y = y + (2 / 3) * (p[1] - y);
        const c2x = p[2] + (2 / 3) * (p[0] - p[2]);
        const c2y = p[3] + (2 / 3) * (p[1] - p[3]);
        cur.push(...sampleBezier([x, y, c1x, c1y, c2x, c2y, p[2], p[3]]).slice(2));
        x = p[2];
        y = p[3];
        break;
      }
      case 'A': {
        n();
        n();
        n();
        n();
        n();
        const nx = n();
        const ny = n();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        cur.push(x, y);
        break;
      }
      case 'Z':
        cur.push(sx, sy);
        x = sx;
        y = sy;
        break;
      default:
        i++;
    }
  }
  flush();
  return out;
}

function sexprGraphics(prims: readonly SymbolPrim[]): string[] {
  const stroke = '(stroke (width 0.254) (type default))';
  const lines: string[] = [];
  const pt = (x: number, y: number) => `(xy ${fmt(mmOf(x))} ${fmt(-mmOf(y))})`;
  const fillOf = (f: unknown) => `(fill (type ${f === true || typeof f === 'string' ? 'outline' : 'none'}))`;
  for (const p of prims) {
    switch (p.kind) {
      case 'line':
        lines.push(`(polyline (pts ${pt(p.x1, p.y1)} ${pt(p.x2, p.y2)}) ${stroke} (fill (type none)))`);
        break;
      case 'rect':
        lines.push(`(rectangle (start ${fmt(mmOf(p.x))} ${fmt(-mmOf(p.y))}) (end ${fmt(mmOf(p.x + p.w))} ${fmt(-mmOf(p.y + p.h))}) ${stroke} ${fillOf(p.fill)})`);
        break;
      case 'circle':
        lines.push(`(circle (center ${fmt(mmOf(p.cx))} ${fmt(-mmOf(p.cy))}) (radius ${fmt(mmOf(p.r))}) ${stroke} ${fillOf(p.fill)})`);
        break;
      case 'arc': {
        // clockwise on screen from start to end = counter-clockwise (y up) from -end to -start
        const a1 = (-p.end * Math.PI) / 180;
        const a2 = (-p.start * Math.PI) / 180;
        let sweep = a2 - a1;
        if (sweep <= 0) sweep += 2 * Math.PI;
        const r = mmOf(p.r);
        const cx = mmOf(p.cx);
        const cy = -mmOf(p.cy);
        const at = (a: number) => `${fmt(cx + r * Math.cos(a))} ${fmt(cy + r * Math.sin(a))}`;
        lines.push(`(arc (start ${at(a1)}) (mid ${at(a1 + sweep / 2)}) (end ${at(a2)}) ${stroke} (fill (type none)))`);
        break;
      }
      case 'polyline': {
        const pts: string[] = [];
        for (let i = 0; i + 1 < p.points.length; i += 2) pts.push(pt(p.points[i], p.points[i + 1]));
        if (p.closed) pts.push(pt(p.points[0], p.points[1]));
        lines.push(`(polyline (pts ${pts.join(' ')}) ${stroke} ${fillOf(p.fill)})`);
        break;
      }
      case 'path':
        for (const flat of flattenPath(p.d)) {
          const pts: string[] = [];
          for (let i = 0; i + 1 < flat.length; i += 2) pts.push(pt(flat[i], flat[i + 1]));
          lines.push(`(polyline (pts ${pts.join(' ')}) ${stroke} ${fillOf(p.fill)})`);
        }
        break;
      case 'text':
        lines.push(`(text ${quote(p.text)} (at ${fmt(mmOf(p.x))} ${fmt(-mmOf(p.y))} 0) (effects (font (size ${fmt(Math.max(0.5, mmOf((p.size ?? 10) / 0.9)))} ${fmt(Math.max(0.5, mmOf((p.size ?? 10) / 0.9)))}))))`);
        break;
    }
  }
  return lines;
}

export interface KicadSymExport {
  /** the .kicad_sym text */
  text: string;
  /** SPICE text of the models the parts use ('' when none), to save next to the library */
  models: string;
  /** file name the symbols name in `Sim.Library` when `models` is not empty */
  modelFile: string;
}

/** User parts as a KiCad 6+ symbol library; `libraryName` names the SPICE model file the symbols point at. */
export function partsToKicadSym(parts: readonly CustomPartData[], opts: { libraryName?: string } = {}): KicadSymExport {
  const lib = (opts.libraryName ?? 'machsim').replace(/[^A-Za-z0-9_.-]/g, '_') || 'machsim';
  const modelFile = `${lib}.lib`;
  const models: string[] = [];
  const out: string[] = ['(kicad_symbol_lib (version 20220914) (generator machsim)'];
  for (const part of parts) {
    const sym = part.symbol;
    const name = part.name.replace(/[\s/\\:"]+/g, '_') || part.id.replace(CUSTOM_PREFIX, '');
    const cx = sym.bbox.x + sym.bbox.w / 2;
    const top = sym.bbox.y;
    const bottom = sym.bbox.y + sym.bbox.h;
    const hasNumbers = sym.pins.some((p) => p.number);
    const props: [string, string, boolean][] = [
      ['Reference', part.prefix || 'U', false],
      ['Value', name, false],
      ['Footprint', part.footprint ?? '', true],
      ['Datasheet', part.hyperlink ?? '~', true],
    ];
    if (part.description) props.push(['ki_description', part.description, true]);
    if (part.keywords?.length) props.push(['ki_keywords', part.keywords.join(' '), true]);
    for (const [k, v] of Object.entries(part.fields ?? {})) props.push([k, v, true]);
    if (part.model.kind === 'spice') {
      models.push(part.model.text.trim());
      const roles = part.model.pins.map((pinName, i) => {
        const p = sym.pins.find((q) => q.name === pinName);
        return p ? `${p.number || p.name}=${i + 1}` : '';
      });
      props.push(['Sim.Device', 'SUBCKT', true], ['Sim.Library', modelFile, true], ['Sim.Name', part.model.name, true], ['Sim.Pins', roles.filter(Boolean).join(' '), true]);
    } else if (part.model.kind === 'builtin') {
      const base = getPart(part.model.partId);
      const dev = part.model.partId === 'basic/resistor' ? 'R' : part.model.partId === 'basic/capacitor' ? 'C' : part.model.partId === 'basic/inductor' ? 'L' : part.model.partId === 'sources/dc-voltage' ? 'V' : part.model.partId === 'sources/dc-current' ? 'I' : '';
      if (dev && base) {
        const v = part.model.params?.value ?? base.params.find((p) => p.key === 'value')?.default ?? '';
        props.push(['Sim.Device', dev, true], ['Sim.Params', dev === 'V' || dev === 'I' ? `dc=${v}` : `${dev.toLowerCase()}=${v}`, true]);
        const pins = base.symbol.pins.map((bp, i) => {
          const sp = part.model.kind === 'builtin' ? part.model.pinMap[bp.name] : '';
          const found = sym.pins.find((q) => q.name === sp);
          return found ? `${found.number || found.name}=${dev === 'V' || dev === 'I' ? bp.name : String(i + 1)}` : '';
        });
        props.push(['Sim.Pins', pins.filter(Boolean).join(' '), true]);
      }
    }
    out.push(`  (symbol ${quote(name)} ${hasNumbers ? '' : '(pin_numbers hide) '}(pin_names (offset 1.016)) (in_bom yes) (on_board yes)`);
    props.forEach(([k, v, hide], i) => {
      const y = i === 0 ? top - 6 : i === 1 ? bottom + 14 : bottom + 30 + i * 8;
      out.push(`    (property ${quote(k)} ${quote(v)} (id ${i}) (at ${fmt(mmOf(cx))} ${fmt(-mmOf(y))} 0) (effects (font (size 1.27 1.27))${hide ? ' hide' : ''}))`);
    });
    out.push(`    (symbol ${quote(`${name}_0_1`)}`);
    for (const g of sexprGraphics(sym.prims)) out.push(`      ${g}`);
    out.push('    )');
    out.push(`    (symbol ${quote(`${name}_1_1`)}`);
    for (const p of sym.pins) {
      const dir = p.dir ?? 'left';
      const angle = ANGLE_FOR_DIR[dir];
      const len = stubLength(sym, p);
      const label = p.label ?? '~';
      out.push(
        `      (pin ${KICAD_PIN[p.type ?? 'passive']} line (at ${fmt(mmOf(p.x))} ${fmt(-mmOf(p.y))} ${angle}) (length ${fmt(mmOf(len))}) (name ${quote(label)} (effects (font (size 1.27 1.27)))) (number ${quote(p.number || p.name)} (effects (font (size 1.27 1.27)))))`,
      );
    }
    out.push('    )');
    out.push('  )');
  }
  out.push(')');
  return { text: `${out.join('\n')}\n`, models: [...new Set(models)].join('\n\n'), modelFile };
}

// ---------------------------------------------------------------------------------------------
// KSymbol -> lib_symbols of a .kicad_sch (the schematic importers read pins and the power flag)

/** The `(lib_symbols …)` list for symbols used by a schematic, as KiCad 6 text (only what the importer reads). */
export function kicadLibSymbolsSexpr(symbols: readonly KSymbol[]): string {
  const out: string[] = ['(lib_symbols'];
  for (const s of symbols) {
    out.push(`  (symbol ${quote(s.name)}${s.power ? ' (power)' : ''}`);
    const byUnit = new Map<number, KPin[]>();
    for (const p of s.pins) byUnit.set(p.unit, [...(byUnit.get(p.unit) ?? []), p]);
    for (const [unit, pins] of [...byUnit.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(`    (symbol ${quote(`${s.name.split(':').pop()}_${unit}_1`)}`);
      for (const p of pins) {
        out.push(`      (pin ${p.type} line (at ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.angle)}) (length ${fmt(p.length)})${p.hidden ? ' hide' : ''} (name ${quote(p.name || '~')}) (number ${quote(p.number)}))`);
      }
      out.push('    )');
    }
    out.push('  )');
  }
  out.push(')');
  return out.join('\n');
}

/** Clone helper for tests and callers that edit an imported part's symbol. */
export function cloneImported(part: CustomPartData): CustomPartData {
  return { ...part, symbol: cloneSymbol(part.symbol) };
}
