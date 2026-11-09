/**
 * Live rendering of display indicators on the schematic: lit segments of 7 / 14 / 16-segment
 * displays (in the part's colour), lit bars of bar graphs, dot-matrix dots, the screen of a
 * character LCD (characters, cursor, custom CGRAM characters) and coloured logic-probe lights.
 *
 * Values come from the live indicator levels (src/ui/integration/live.ts): the part's refdes
 * carries the segment / bar mask, and multi-cell displays add one value per code signal under
 * `${refdes}#k` (LCD: cells, status, 64 CGRAM rows; dot matrix: one mask per row). Everything is
 * drawn in part-local coordinates inside the part transform, so it follows rotation and mirroring.
 */
import type { ReactElement } from 'react';
import type { PartDef, SymbolPrim } from '../../library/types';
import type { PartInstance } from '../../model/types';
import { DISPLAY_COLORS } from '../../library/catalog/displayParts';
import { partTransform } from './symbolGeometry';

type LinePrim = Extract<SymbolPrim, { kind: 'line' }>;
type CirclePrim = Extract<SymbolPrim, { kind: 'circle' }>;
type RectPrim = Extract<SymbolPrim, { kind: 'rect' }>;

/** Lit colour of a display instance: its 'color' param, else the indicator colour, else red. */
export function litColor(def: PartDef, inst: PartInstance): string {
  const key = (inst.params.color ?? def.params.find((p) => p.key === 'color')?.default ?? '').toLowerCase();
  return DISPLAY_COLORS[key]?.css ?? def.indicator?.color ?? DISPLAY_COLORS.red.css;
}

/** Number of value slots a multi-cell display reads (`${refdes}#k`), 0 for others. */
export function displaySlots(def: PartDef | undefined): number {
  const ind = def?.indicator;
  if (!ind) return 0;
  if (ind.kind === 'lcd') return (ind.cols ?? 16) * (ind.rows ?? 2) + 1 + 64;
  if (ind.kind === 'matrix') return ind.rows ?? 8;
  // a machine publishes one value per pin and per report node (src/library/catalog/mecha.ts)
  if (ind.kind === 'mecha') return ind.slots ?? 0;
  return 0;
}

/** The slot values of a display instance from the live level table (undefined when not live). */
export function displayCells(def: PartDef | undefined, refdes: string, levels: Record<string, number> | undefined): number[] | undefined {
  const n = displaySlots(def);
  if (!n || !levels || levels[`${refdes}#0`] === undefined) return undefined;
  return Array.from({ length: n }, (_, k) => levels[`${refdes}#${k}`] ?? 0);
}

const segmentCache = new WeakMap<PartDef, { segs: LinePrim[]; dp?: CirclePrim } | null>();

/** Segment lines of a display symbol: its first run of N 2-unit-wide lines and the dot after it. */
export function segmentPrims(def: PartDef): { segs: LinePrim[]; dp?: CirclePrim } | null {
  if (segmentCache.has(def)) return segmentCache.get(def) ?? null;
  const n = def.indicator?.kind === 'alnum' ? (def.indicator.segments ?? 14) : 7;
  const prims = def.symbol.prims;
  let found: { segs: LinePrim[]; dp?: CirclePrim } | null = null;
  for (let i = 0; i + n <= prims.length && !found; i++) {
    const run = prims.slice(i, i + n);
    if (run.every((p) => p.kind === 'line' && p.width === 2)) {
      const next = prims[i + n];
      found = { segs: run as LinePrim[], ...(next?.kind === 'circle' ? { dp: next } : {}) };
    }
  }
  segmentCache.set(def, found);
  return found;
}

/** Lit segments of a 7 / 14 / 16-segment indicator; `mask` bit k = segment k, the bit after the segments = dp. */
export function LitSegments({ def, o, mask }: { def: PartDef; o: PartInstance; mask: number }) {
  const g = segmentPrims(def);
  if (!g) return null;
  const color = litColor(def, o);
  const dpBit = g.segs.length === 7 ? 7 : g.segs.length;
  return (
    <g transform={partTransform(o)} className="ms-seg-lit" pointerEvents="none">
      {g.segs.map((s, i) => (Math.floor(mask / 2 ** i) % 2 ? <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={3.2} strokeLinecap="round" /> : null))}
      {g.dp && Math.floor(mask / 2 ** dpBit) % 2 ? <circle cx={g.dp.cx} cy={g.dp.cy} r={g.dp.r + 0.8} fill={color} /> : null}
    </g>
  );
}

/** Lit bars of a bar graph (the symbol's bar rectangles, in order). */
export function LitBars({ def, o, mask }: { def: PartDef; o: PartInstance; mask: number }) {
  const n = def.indicator?.bars ?? 10;
  const rects = def.symbol.prims.filter((p): p is RectPrim => p.kind === 'rect' && p.h === 6 && p.w === 24).slice(0, n);
  const colors = def.indicator?.barColors;
  const one = litColor(def, o);
  return (
    <g transform={partTransform(o)} className="ms-seg-lit" pointerEvents="none">
      {rects.map((r, i) => (Math.floor(mask / 2 ** i) % 2 ? <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={colors?.[i] ?? one} rx={1} /> : null))}
    </g>
  );
}

/** Lit dots of a dot-matrix display; cells[r] = column mask of row r. */
export function MatrixDots({ def, o, cells }: { def: PartDef; o: PartInstance; cells: number[] }) {
  const ind = def.indicator!;
  const cols = ind.cols ?? 8;
  const rows = ind.rows ?? 8;
  const sc = ind.screen ?? { x: -cols * 5, y: -rows * 5, w: cols * 10, h: rows * 10 };
  const color = litColor(def, o);
  const dots: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    const m = Math.round(cells[r] ?? 0);
    for (let c = 0; c < cols; c++) if (Math.floor(m / 2 ** c) % 2) dots.push(<circle key={`${r}.${c}`} cx={sc.x + ((c + 0.5) * sc.w) / cols} cy={sc.y + ((r + 0.5) * sc.h) / rows} r={3.4} fill={color} />);
  }
  return (
    <g transform={partTransform(o)} className="ms-seg-lit" pointerEvents="none">
      {dots}
    </g>
  );
}

/**
 * Character of an HD44780-style ROM code (A00 character set: ASCII 0x20-0x7D with ¥ at 0x5C,
 * arrows at 0x7E / 0x7F and the common Greek / symbol codes; other codes show a box).
 */
export function lcdChar(code: number): string {
  if (code === 0x5c) return '¥';
  if (code === 0x7e) return '→';
  if (code === 0x7f) return '←';
  if (code >= 0x20 && code < 0x7e) return String.fromCharCode(code);
  const special: Record<number, string> = { 0xdf: '°', 0xe0: 'α', 0xe2: 'β', 0xe3: 'ε', 0xe4: 'µ', 0xe5: 'σ', 0xe6: 'ρ', 0xf2: 'θ', 0xf4: 'Ω', 0xf7: 'π', 0xff: '█', 0xa5: '·' };
  return special[code] ?? (code >= 0x80 ? '□' : ' ');
}

const BACKLIGHT: Record<string, { bg: string; fg: string }> = {
  green: { bg: '#9fbf5a', fg: '#1e2a10' },
  blue: { bg: '#2f5fd0', fg: '#f2f6ff' },
  white: { bg: '#e8ecef', fg: '#20242a' },
};

/** Screen of a character LCD: cells[k] = character codes, then status, then 64 CGRAM rows. */
export function LcdScreen({ def, o, cells }: { def: PartDef; o: PartInstance; cells: number[] }) {
  const ind = def.indicator!;
  const cols = ind.cols ?? 16;
  const rows = ind.rows ?? 2;
  const sc = ind.screen!;
  const n = cols * rows;
  const status = Math.round(cells[n] ?? 0);
  const on = status % 2 === 1;
  const cursor = Math.floor(status / 2) % 2 === 1;
  const blink = Math.floor(status / 4) % 2 === 1;
  const curCell = Math.floor(status / 8) - 1;
  const theme = BACKLIGHT[(o.params.backlight ?? 'green').toLowerCase()] ?? BACKLIGHT.green;
  const cw = (sc.w - 8) / cols;
  const ch = (sc.h - 8) / rows;
  const items: ReactElement[] = [];
  if (on) {
    for (let k = 0; k < n; k++) {
      const code = Math.round(cells[k] ?? 32);
      const x = sc.x + 4 + (k % cols) * cw;
      const y = sc.y + 4 + Math.floor(k / cols) * ch;
      if (code < 16) {
        // custom character from CGRAM: 5 x 8 dots
        const j = code % 8;
        for (let r = 0; r < 8; r++) {
          const bitsRow = Math.round(cells[n + 1 + 8 * j + r] ?? 0);
          for (let c = 0; c < 5; c++) if (Math.floor(bitsRow / 2 ** (4 - c)) % 2) items.push(<rect key={`g${k}.${r}.${c}`} x={x + 0.5 + c * ((cw - 1) / 5)} y={y + r * (ch / 8)} width={(cw - 1) / 5 - 0.2} height={ch / 8 - 0.2} fill={theme.fg} />);
        }
      } else if (code !== 32) {
        items.push(
          <text key={`c${k}`} x={x + cw / 2} y={y + ch * 0.82} fontSize={ch * 0.95} fontFamily="ui-monospace, Menlo, Consolas, monospace" textAnchor="middle" fill={theme.fg}>
            {lcdChar(code)}
          </text>,
        );
      }
      if (k === curCell && (cursor || blink)) items.push(<rect key={`cur${k}`} x={x + 0.5} y={blink ? y : y + ch - 1.2} width={cw - 1} height={blink ? ch : 1.2} fill={theme.fg} opacity={blink ? 0.45 : 1} />);
    }
  }
  return (
    <g transform={partTransform(o)} className="ms-lcd-screen" pointerEvents="none">
      <rect x={sc.x} y={sc.y} width={sc.w} height={sc.h} rx={2} fill={on ? theme.bg : '#5b6b45'} />
      {items}
    </g>
  );
}

/** Coloured light of a logic probe (the symbol's filled circle) while it is lit. */
export function ProbeLight({ def, o }: { def: PartDef; o: PartInstance }) {
  const lamp = def.symbol.prims.find((p): p is CirclePrim => p.kind === 'circle' && p.fill !== undefined && p.fill !== false);
  if (!lamp) return null;
  const color = def.indicator?.color ?? (typeof lamp.fill === 'string' ? lamp.fill : DISPLAY_COLORS.red.css);
  return (
    <g transform={partTransform(o)} className="ms-seg-lit" pointerEvents="none">
      <circle cx={lamp.cx} cy={lamp.cy} r={lamp.r + 3} fill={color} opacity={0.35} />
      <circle cx={lamp.cx} cy={lamp.cy} r={lamp.r} fill={color} />
    </g>
  );
}
