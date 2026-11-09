/**
 * Schematic symbol builders for the MachSim catalogue (original line-art, generic ANSI/IEC
 * shapes drawn from scratch — no artwork is taken from any commercial product).
 *
 * Geometry rules every builder follows (part-local coordinates, y grows downward):
 * - Pins lie on the 10-unit grid. Every pin has a 10-unit stub ("lead") from the body to the pin.
 * - Two-terminal passive / semiconductor parts are horizontal with pins at (-30, 0) and (30, 0)
 *   (60 units pin-to-pin); the body occupies -20..20 (or less).
 * - Independent sources are drawn upright (conventional orientation) with '+' at (0, -30) and
 *   '-' at (0, 30) — also 60 units pin-to-pin; users rotate them as needed.
 * - Boxed ICs / instruments place pins 20 units apart on the box sides (see `boxSymbol`).
 * - Text uses sizes 7..12 so it stays readable at zoom 1.
 * The bounding box is computed from the primitives and pins (`makeSymbol`).
 */

import type { Point } from '../model/types';
import type { FillStyle, PinDef, PinType, SymbolDef, SymbolPrim } from './types';

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

const r2 = (v: number): number => Math.round(v * 100) / 100;

export function line(x1: number, y1: number, x2: number, y2: number, width?: number): SymbolPrim {
  const p: SymbolPrim = { kind: 'line', x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2) };
  if (width !== undefined) p.width = width;
  return p;
}

export function rect(x: number, y: number, w: number, h: number, fill?: FillStyle, r?: number): SymbolPrim {
  const p: SymbolPrim = { kind: 'rect', x, y, w, h };
  if (fill !== undefined) p.fill = fill;
  if (r !== undefined) p.r = r;
  return p;
}

export function circle(cx: number, cy: number, r: number, fill?: FillStyle): SymbolPrim {
  const p: SymbolPrim = { kind: 'circle', cx, cy, r };
  if (fill !== undefined) p.fill = fill;
  return p;
}

/** Arc from `start` to `end` degrees, clockwise on screen from +x (0 = right, 90 = down). */
export function arc(cx: number, cy: number, r: number, start: number, end: number): SymbolPrim {
  return { kind: 'arc', cx: r2(cx), cy: r2(cy), r: r2(r), start, end };
}

export function poly(points: number[], closed = false, fill?: FillStyle): SymbolPrim {
  const p: SymbolPrim = { kind: 'polyline', points: points.map(r2) };
  if (closed) p.closed = true;
  if (fill !== undefined) p.fill = fill;
  return p;
}

/** SVG path using absolute M / L / Q / C commands only (so the bbox can be estimated). */
export function path(d: string, fill?: FillStyle): SymbolPrim {
  const p: SymbolPrim = { kind: 'path', d };
  if (fill !== undefined) p.fill = fill;
  return p;
}

export function text(x: number, y: number, t: string, size = 9, anchor: 'start' | 'middle' | 'end' = 'middle', bold = false): SymbolPrim {
  const p: SymbolPrim = { kind: 'text', x, y, text: t, size, anchor };
  if (bold) p.bold = true;
  return p;
}

/** Filled arrow head with its tip at (x, y) pointing in direction `deg` (0 = right, 90 = down). */
export function arrowHead(x: number, y: number, deg: number, len = 5, half = 2.5): SymbolPrim {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const bx = x - len * ux;
  const by = y - len * uy;
  return poly([x, y, bx - half * uy, by + half * ux, bx + half * uy, by - half * ux], true, true);
}

/** Line from (x1, y1) to (x2, y2) with an arrow head at the second point. */
export function arrow(x1: number, y1: number, x2: number, y2: number, len = 4): SymbolPrim[] {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return [line(x1, y1, x2, y2), arrowHead(x2, y2, deg, len, len / 2)];
}

/** Zigzag polyline points from x0 to x1 at height y (resistor body). */
export function zigzag(x0: number, x1: number, y = 0, amp = 6, peaks = 6): number[] {
  const pts = [x0, y];
  const step = (x1 - x0) / peaks;
  for (let i = 0; i < peaks; i++) pts.push(x0 + (i + 0.5) * step, y + (i % 2 === 0 ? -amp : amp));
  pts.push(x1, y);
  return pts;
}

/** Inductor humps (upper half circles) from x0 to x1 at height y. `up` = humps above the axis. */
export function humps(x0: number, x1: number, y = 0, n = 4, up = true): SymbolPrim[] {
  const r = (x1 - x0) / (2 * n);
  const out: SymbolPrim[] = [];
  for (let i = 0; i < n; i++) out.push(up ? arc(x0 + r * (2 * i + 1), y, r, 180, 360) : arc(x0 + r * (2 * i + 1), y, r, 0, 180));
  return out;
}

/** Vertical inductor humps from y0 to y1 at x, bulging to the right (`right`) or left. */
export function humpsV(y0: number, y1: number, x = 0, n = 4, right = true): SymbolPrim[] {
  const r = (y1 - y0) / (2 * n);
  const out: SymbolPrim[] = [];
  for (let i = 0; i < n; i++) out.push(right ? arc(x, y0 + r * (2 * i + 1), r, 270, 450) : arc(x, y0 + r * (2 * i + 1), r, 90, 270));
  return out;
}

/** Small sine glyph centred on (cx, cy). */
export function sineGlyph(cx: number, cy: number, w = 18, h = 10): SymbolPrim {
  const x0 = cx - w / 2;
  const q = w / 4;
  return path(`M ${r2(x0)} ${cy} Q ${r2(x0 + q)} ${r2(cy - h)} ${r2(x0 + 2 * q)} ${cy} Q ${r2(x0 + 3 * q)} ${r2(cy + h)} ${r2(x0 + 4 * q)} ${cy}`);
}

// ---------------------------------------------------------------------------
// Pins and symbol assembly
// ---------------------------------------------------------------------------

export type PinDir = 'left' | 'right' | 'up' | 'down';

export interface PinOpts {
  label?: string;
  type?: PinType;
  number?: string;
}

export function pin(name: string, x: number, y: number, dir: PinDir, opts: PinOpts = {}): PinDef {
  const p: PinDef = { name, x, y, dir, type: opts.type ?? 'passive' };
  if (opts.label !== undefined) p.label = opts.label;
  if (opts.number !== undefined) p.number = opts.number;
  return p;
}

function primPoints(p: SymbolPrim): Point[] {
  switch (p.kind) {
    case 'line':
      return [
        { x: p.x1, y: p.y1 },
        { x: p.x2, y: p.y2 },
      ];
    case 'rect':
      return [
        { x: p.x, y: p.y },
        { x: p.x + p.w, y: p.y + p.h },
      ];
    case 'circle':
    case 'arc':
      return [
        { x: p.cx - p.r, y: p.cy - p.r },
        { x: p.cx + p.r, y: p.cy + p.r },
      ];
    case 'polyline': {
      const out: Point[] = [];
      for (let i = 0; i + 1 < p.points.length; i += 2) out.push({ x: p.points[i], y: p.points[i + 1] });
      return out;
    }
    case 'path': {
      const nums = (p.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      const out: Point[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
      return out;
    }
    case 'text': {
      const size = p.size ?? 10;
      const w = 0.6 * size * p.text.length;
      const x0 = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - w : p.x - w / 2;
      return [
        { x: x0, y: p.y - size * 0.8 },
        { x: x0 + w, y: p.y + size * 0.2 },
      ];
    }
  }
}

export interface SymbolOpts {
  refPos?: Point;
  valuePos?: Point;
  /** extra padding around the computed bounding box (default 2) */
  pad?: number;
}

/** Assemble a SymbolDef; the bounding box covers every primitive and pin. */
export function makeSymbol(prims: SymbolPrim[], pins: PinDef[], opts: SymbolOpts = {}): SymbolDef {
  const pts: Point[] = [...prims.flatMap(primPoints), ...pins.map((p) => ({ x: p.x, y: p.y }))];
  const pad = opts.pad ?? 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) {
    x0 = -10;
    y0 = -10;
    x1 = 10;
    y1 = 10;
  }
  const bbox = { x: r2(x0 - pad), y: r2(y0 - pad), w: r2(x1 - x0 + 2 * pad), h: r2(y1 - y0 + 2 * pad) };
  const cx = r2((x0 + x1) / 2);
  return {
    bbox,
    prims,
    pins,
    refPos: opts.refPos ?? { x: cx, y: r2(y0 - 6) },
    valuePos: opts.valuePos ?? { x: cx, y: r2(y1 + 14) },
  };
}

// ---------------------------------------------------------------------------
// Two-terminal horizontal parts
// ---------------------------------------------------------------------------

export interface TwoPinOpts {
  names?: [string, string];
  labels?: [string | undefined, string | undefined];
  types?: [PinType, PinType];
  /** half-width of the body; leads run from ±30 to ±bodyHalf */
  bodyHalf?: number;
  refPos?: Point;
  valuePos?: Point;
}

/** Horizontal 2-terminal symbol: pins at (-30,0) and (30,0), leads to ±bodyHalf. */
export function twoPinH(body: SymbolPrim[], o: TwoPinOpts = {}): SymbolDef {
  const [n1, n2] = o.names ?? ['1', '2'];
  const half = o.bodyHalf ?? 20;
  const prims = [line(-30, 0, -half, 0), line(half, 0, 30, 0), ...body];
  const pins = [
    pin(n1, -30, 0, 'left', { label: o.labels?.[0], type: o.types?.[0], number: '1' }),
    pin(n2, 30, 0, 'right', { label: o.labels?.[1], type: o.types?.[1], number: '2' }),
  ];
  return makeSymbol(prims, pins, { refPos: o.refPos ?? { x: 0, y: -14 }, valuePos: o.valuePos ?? { x: 0, y: 22 } });
}

export function resistorBody(): SymbolPrim[] {
  return [poly(zigzag(-20, 20))];
}

export function capacitorBody(polar = false): SymbolPrim[] {
  const out: SymbolPrim[] = [line(-20, 0, -3, 0), line(3, 0, 20, 0), line(-3, -11, -3, 11, 2)];
  if (polar) {
    out.push(arc(11, 0, 10, 135, 225), text(-11, -8, '+', 10));
    out[1] = line(1, 0, 20, 0);
  } else {
    out.push(line(3, -11, 3, 11, 2));
  }
  return out;
}

export function inductorBody(core = false): SymbolPrim[] {
  const out = [...humps(-20, 20, 0, 4)];
  if (core) out.push(line(-20, -9, 20, -9), line(-20, -12, 20, -12));
  return out;
}

/** Diagonal "variable" arrow across a body. */
export function variableArrow(): SymbolPrim[] {
  return arrow(-14, 12, 14, -14, 5);
}

/** Diode glyph (anode left, cathode right) between x=-8 and x=8. */
export function diodeBody(kind: 'plain' | 'zener' | 'schottky' | 'led' | 'photo' | 'varactor' | 'tvs' = 'plain'): SymbolPrim[] {
  const out: SymbolPrim[] = [line(-20, 0, -8, 0), poly([-8, -8, -8, 8, 8, 0], true)];
  switch (kind) {
    case 'zener':
      out.push(poly([4, -11, 8, -8, 8, 8, 12, 11]), line(8, 0, 20, 0));
      break;
    case 'tvs':
      out.push(poly([4, -11, 8, -8, 8, 8, 12, 11]), line(8, 0, 20, 0));
      break;
    case 'schottky':
      out.push(poly([12, -5, 12, -8, 8, -8, 8, 8, 4, 8, 4, 5]), line(8, 0, 20, 0));
      break;
    case 'varactor':
      out.push(line(8, -8, 8, 8), line(12, -8, 12, 8), line(12, 0, 20, 0));
      break;
    default:
      out.push(line(8, -8, 8, 8), line(8, 0, 20, 0));
  }
  if (kind === 'led') out.push(...arrow(0, -11, 7, -18), ...arrow(6, -9, 13, -16));
  if (kind === 'photo') out.push(...arrow(14, -20, 6, -12), ...arrow(20, -16, 12, -8));
  return out;
}

// ---------------------------------------------------------------------------
// Sources (upright, '+' on top)
// ---------------------------------------------------------------------------

export type SourceGlyph = 'dc' | 'ac' | 'current' | 'ac-current' | 'pulse' | 'clock' | 'pwl' | 'exp' | 'fm' | 'am' | 'expr';

export function sourceGlyph(g: SourceGlyph): SymbolPrim[] {
  switch (g) {
    case 'dc':
      return [line(-4, -7, 4, -7), line(0, -11, 0, -3), line(-4, 7, 4, 7)];
    case 'ac':
      return [sineGlyph(0, 0, 18, 8)];
    case 'current':
      return arrow(0, 10, 0, -10, 5);
    case 'ac-current':
      return [...arrow(-3, 10, -3, -10, 5), sineGlyph(6, 0, 8, 4)];
    case 'pulse':
      return [poly([-10, 5, -4, 5, -4, -5, 4, -5, 4, 5, 10, 5])];
    case 'clock':
      return [poly([-10, 5, -6, 5, -6, -5, -1, -5, -1, 5, 4, 5, 4, -5, 9, -5, 9, 0])];
    case 'pwl':
      return [poly([-10, 6, -5, -3, 0, 2, 4, -7, 10, -1])];
    case 'exp':
      return [path('M -10 6 Q -6 6 -3 -2 Q 0 -8 4 -8 L 10 -8')];
    case 'fm':
      return [path('M -10 2 Q -8 -6 -6 2 Q -5 8 -3 2 Q -2 -6 -1 2 Q 0 8 1 2'), text(5, 4, 'FM', 7, 'start')];
    case 'am':
      return [path('M -10 0 Q -8 -3 -6 0 Q -4 3 -2 0 Q 0 -8 2 0'), text(4, 4, 'AM', 7, 'start')];
    case 'expr':
      return [text(0, 4, 'f(x)', 9)];
  }
}

export interface SourceOpts {
  names?: [string, string];
  /** draw a diamond (controlled / behavioral source) instead of a circle */
  diamond?: boolean;
  extra?: SymbolPrim[];
  extraPins?: PinDef[];
}

/** Upright source: '+' pin at (0,-30), '-' pin at (0,30), circle (or diamond) body of radius 15. */
export function sourceSymbol(glyph: SourceGlyph, o: SourceOpts = {}): SymbolDef {
  const [np, nn] = o.names ?? ['+', '-'];
  const body = o.diamond ? poly([0, -15, 15, 0, 0, 15, -15, 0], true) : circle(0, 0, 15);
  const prims = [line(0, -30, 0, -15), line(0, 15, 0, 30), body, ...sourceGlyph(glyph), ...(o.extra ?? [])];
  const pins = [pin(np, 0, -30, 'up', { number: '1' }), pin(nn, 0, 30, 'down', { number: '2' }), ...(o.extraPins ?? [])];
  return makeSymbol(prims, pins, { refPos: { x: 20, y: -6 }, valuePos: { x: 20, y: 8 } });
}

/**
 * Controlled source: diamond output (pins `out+` (0,-30) / `out-` (0,30)) with control
 * terminals `in+` (-40,-20) / `in-` (-40,20). `currentControlled` draws the sensing path
 * through the part (the control current flows in+ -> in-).
 */
export function controlledSourceSymbol(output: 'voltage' | 'current', currentControlled: boolean): SymbolDef {
  const glyph: SymbolPrim[] = output === 'voltage' ? sourceGlyph('dc') : sourceGlyph('current');
  const ctl: SymbolPrim[] = currentControlled
    ? [poly([-40, -20, -25, -20, -25, 20, -40, 20]), arrowHead(-25, 4, 90, 5, 2.5)]
    : [line(-40, -20, -24, -20), line(-40, 20, -24, 20), circle(-24, -20, 1.5, true), circle(-24, 20, 1.5, true)];
  const prims = [line(0, -30, 0, -15), line(0, 15, 0, 30), poly([0, -15, 15, 0, 0, 15, -15, 0], true), ...glyph, ...ctl];
  const pins = [
    pin('out+', 0, -30, 'up', { number: '1' }),
    pin('out-', 0, 30, 'down', { number: '2' }),
    pin('in+', -40, -20, 'left', { label: currentControlled ? undefined : '+', number: '3' }),
    pin('in-', -40, 20, 'left', { label: currentControlled ? undefined : '−', number: '4' }),
  ];
  return makeSymbol(prims, pins, { refPos: { x: 20, y: -6 }, valuePos: { x: 20, y: 8 } });
}

// ---------------------------------------------------------------------------
// Power symbols
// ---------------------------------------------------------------------------

export function groundSymbol(): SymbolDef {
  return makeSymbol(
    [line(0, 0, 0, 10), line(-12, 10, 12, 10), line(-7, 15, 7, 15), line(-2, 20, 2, 20)],
    [pin('1', 0, 0, 'up', { type: 'power' })],
    { refPos: { x: 16, y: 8 }, valuePos: { x: 16, y: 20 } },
  );
}

/** Supply rail symbol: `up` = bar above the pin (VCC/VDD), else below (VEE/VSS). */
export function railSymbol(name: string, up: boolean): SymbolDef {
  const prims = up
    ? [line(0, 0, 0, -10), line(-10, -10, 10, -10, 2), text(0, -14, name, 9)]
    : [line(0, 0, 0, 10), poly([-8, 10, 8, 10, 0, 18], true), text(0, 30, name, 9)];
  return makeSymbol(prims, [pin('1', 0, 0, up ? 'down' : 'up', { type: 'power' })], {
    refPos: { x: 14, y: up ? -4 : 6 },
    valuePos: { x: 14, y: up ? 8 : 18 },
  });
}

// ---------------------------------------------------------------------------
// Transistors
// ---------------------------------------------------------------------------

/** BJT: B (-30,0), C (10,-30), E (10,30). */
export function bjtSymbol(pnp: boolean, opts: { darlington?: boolean } = {}): SymbolDef {
  const prims: SymbolPrim[] = [
    circle(2, 0, 18),
    line(-30, 0, -6, 0),
    line(-6, -12, -6, 12, 2),
    line(-6, -6, 10, -16),
    line(10, -16, 10, -30),
    line(-6, 6, 10, 16),
    line(10, 16, 10, 30),
  ];
  if (pnp) prims.push(arrowHead(-1.2, 9, 212, 6, 3));
  else prims.push(arrowHead(7, 14.1, 32, 6, 3));
  if (opts.darlington) prims.push(line(-12, -8, -12, 8), text(-14, -20, '2×', 7, 'end'));
  return makeSymbol(
    prims,
    [pin('C', 10, -30, 'up', { number: '1' }), pin('B', -30, 0, 'left', { number: '2' }), pin('E', 10, 30, 'down', { number: '3' })],
    { refPos: { x: 24, y: -6 }, valuePos: { x: 24, y: 8 } },
  );
}

/** JFET: G (-30,0), D (10,-30), S (10,30). */
export function jfetSymbol(pch: boolean): SymbolDef {
  const prims: SymbolPrim[] = [
    circle(4, 0, 18),
    line(0, -14, 0, 14, 2),
    line(0, -10, 10, -10),
    line(10, -10, 10, -30),
    line(0, 10, 10, 10),
    line(10, 10, 10, 30),
    line(-30, 0, 0, 0),
    pch ? arrowHead(-14, 0, 180, 6, 3) : arrowHead(-1, 0, 0, 6, 3),
  ];
  return makeSymbol(
    prims,
    [pin('D', 10, -30, 'up', { number: '1' }), pin('G', -30, 0, 'left', { number: '2' }), pin('S', 10, 30, 'down', { number: '3' })],
    { refPos: { x: 26, y: -6 }, valuePos: { x: 26, y: 8 } },
  );
}

/**
 * MOSFET: G (-30,0), D (10,-30), S (10,30), and B (30,0) when `fourTerminal`.
 * `bodyDiode` adds the drain-source body diode glyph (power MOSFETs, 3-terminal only).
 */
export function mosfetSymbol(pch: boolean, o: { fourTerminal?: boolean; depletion?: boolean; bodyDiode?: boolean } = {}): SymbolDef {
  const prims: SymbolPrim[] = [line(-30, 0, -10, 0), line(-10, -11, -10, 11, 2)];
  if (o.depletion) prims.push(line(-4, -14, -4, 14, 2));
  else prims.push(line(-4, -14, -4, -7, 2), line(-4, -3, -4, 3, 2), line(-4, 7, -4, 14, 2));
  prims.push(line(-4, -11, 10, -11), line(10, -11, 10, -30), line(-4, 11, 10, 11), line(10, 11, 10, 30));
  if (o.fourTerminal) {
    prims.push(line(-4, 0, 30, 0));
    prims.push(pch ? arrowHead(8, 0, 0, 6, 3) : arrowHead(-3, 0, 180, 6, 3));
  } else {
    prims.push(line(-4, 0, 10, 0), line(10, 0, 10, 11));
    prims.push(pch ? arrowHead(8, 0, 0, 6, 3) : arrowHead(-3, 0, 180, 6, 3));
  }
  if (o.bodyDiode && !o.fourTerminal) {
    prims.push(line(10, -11, 20, -11), line(10, 11, 20, 11));
    if (pch) prims.push(line(20, -11, 20, -4), poly([16, -4, 24, -4, 20, 4], true), line(16, 4, 24, 4), line(20, 4, 20, 11));
    else prims.push(line(20, 11, 20, 4), poly([16, 4, 24, 4, 20, -4], true), line(16, -4, 24, -4), line(20, -4, 20, -11));
  }
  const pins = [pin('D', 10, -30, 'up', { number: '1' }), pin('G', -30, 0, 'left', { number: '2' }), pin('S', 10, 30, 'down', { number: '3' })];
  if (o.fourTerminal) pins.push(pin('B', 30, 0, 'right', { number: '4' }));
  return makeSymbol(prims, pins, { refPos: { x: 28, y: -12 }, valuePos: { x: 28, y: 20 } });
}

// ---------------------------------------------------------------------------
// Amplifier triangle
// ---------------------------------------------------------------------------

export interface AmpOpts {
  /** include V+ (0,-30) and V- (0,30) supply pins */
  supplies?: boolean;
  /** text drawn inside the triangle */
  label?: string;
  /** extra pins / prims */
  extraPins?: PinDef[];
  extra?: SymbolPrim[];
  /** swap input order (IN+ on top) */
  plusOnTop?: boolean;
}

/** Amplifier triangle: IN- (-40,-10), IN+ (-40,10), OUT (40,0); optional V+ (0,-30), V- (0,30). */
export function ampSymbol(o: AmpOpts = {}): SymbolDef {
  const top = o.plusOnTop ? 'IN+' : 'IN-';
  const bottom = o.plusOnTop ? 'IN-' : 'IN+';
  const prims: SymbolPrim[] = [
    poly([-30, -30, -30, 30, 30, 0], true),
    line(-40, -10, -30, -10),
    line(-40, 10, -30, 10),
    line(30, 0, 40, 0),
    text(-24, -6.5, top === 'IN-' ? '−' : '+', 11, 'middle'),
    text(-24, 13.5, bottom === 'IN-' ? '−' : '+', 11, 'middle'),
  ];
  const pins: PinDef[] = [
    pin(top, -40, -10, 'left', { type: 'input', number: top === 'IN-' ? '2' : '3' }),
    pin(bottom, -40, 10, 'left', { type: 'input', number: bottom === 'IN-' ? '2' : '3' }),
    pin('OUT', 40, 0, 'right', { type: 'output', number: '6' }),
  ];
  if (o.supplies) {
    prims.push(line(0, -15, 0, -30), line(0, 15, 0, 30), text(4, -20, 'V+', 7, 'start'), text(4, 26, 'V−', 7, 'start'));
    pins.push(pin('V+', 0, -30, 'up', { type: 'power', number: '7' }), pin('V-', 0, 30, 'down', { type: 'power', number: '4' }));
  }
  if (o.label) prims.push(text(-6, 4, o.label, 8, 'middle'));
  prims.push(...(o.extra ?? []));
  pins.push(...(o.extraPins ?? []));
  return makeSymbol(prims, pins, { refPos: { x: 12, y: -26 }, valuePos: { x: 12, y: 36 } });
}

// ---------------------------------------------------------------------------
// Boxes (ICs, blocks, instruments)
// ---------------------------------------------------------------------------

export interface BoxPin {
  name: string;
  /** label drawn inside the box (default: the pin name) — empty string for none */
  label?: string;
  type?: PinType;
  number?: string;
}

export interface BoxOpts {
  /** body width / height (multiples of 20 recommended so pins stay on the grid) */
  w?: number;
  h?: number;
  left?: BoxPin[];
  right?: BoxPin[];
  top?: BoxPin[];
  bottom?: BoxPin[];
  title?: string;
  titleSize?: number;
  /** title position (default centre of the box) */
  titlePos?: Point;
  extra?: SymbolPrim[];
  /** rounded corners (instruments) */
  rounded?: boolean;
}

function sidePositions(n: number): number[] {
  return Array.from({ length: n }, (_, i) => -(n - 1) * 10 + 20 * i);
}

/**
 * Rectangular body centred on the origin with 10-unit pin stubs. Pins on each side are spaced
 * 20 units apart and centred on the side, so they land on the grid when the half-sizes are
 * multiples of 10.
 */
export function boxSymbol(o: BoxOpts): SymbolDef {
  const left = o.left ?? [];
  const right = o.right ?? [];
  const top = o.top ?? [];
  const bottom = o.bottom ?? [];
  const h = o.h ?? Math.max(40, 20 * Math.max(left.length, right.length));
  const w = o.w ?? Math.max(60, 20 * Math.max(top.length, bottom.length) + 20);
  const hw = w / 2;
  const hh = h / 2;
  const prims: SymbolPrim[] = [rect(-hw, -hh, w, h, undefined, o.rounded ? 4 : undefined)];
  const pins: PinDef[] = [];
  const add = (bp: BoxPin, x: number, y: number, dir: PinDir, x2: number, y2: number) => {
    prims.push(line(x, y, x2, y2));
    const label = bp.label === undefined ? bp.name : bp.label;
    pins.push(pin(bp.name, x, y, dir, { label: label === '' ? undefined : label, type: bp.type, number: bp.number }));
  };
  sidePositions(left.length).forEach((y, i) => add(left[i], -hw - 10, y, 'left', -hw, y));
  sidePositions(right.length).forEach((y, i) => add(right[i], hw + 10, y, 'right', hw, y));
  sidePositions(top.length).forEach((x, i) => add(top[i], x, -hh - 10, 'up', x, -hh));
  sidePositions(bottom.length).forEach((x, i) => add(bottom[i], x, hh + 10, 'down', x, hh));
  if (o.title) {
    const tp = o.titlePos ?? { x: 0, y: 4 };
    prims.push(text(tp.x, tp.y, o.title, o.titleSize ?? 10, 'middle', true));
  }
  prims.push(...(o.extra ?? []));
  return makeSymbol(prims, pins, { refPos: { x: 0, y: -hh - 14 }, valuePos: { x: 0, y: hh + 24 } });
}

/** Round-meter body (voltmeter, ammeter, lamp-style) as a horizontal 2-pin part. */
export function meterSymbol(letter: string, names: [string, string] = ['+', '-']): SymbolDef {
  return twoPinH([circle(0, 0, 14), text(0, 5, letter, 14, 'middle', true)], {
    names,
    labels: [names[0] === '+' ? '+' : undefined, names[1] === '-' ? '−' : undefined],
    bodyHalf: 14,
  });
}
