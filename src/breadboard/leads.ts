/**
 * Lead mapping: how a library part sits on a breadboard.
 *
 * `leadMap(def, inst)` classifies a PartDef generically (by footprint, pins, group, indicator)
 * into a physical package and returns a lead template — the position of every lead in grid
 * units (pitches) relative to the first lead, for rotation 0:
 *
 *   axial  (resistor, diode, inductor, fuse)   2 leads along a row, span 4–6 pitches (bendable)
 *   radial (ceramic / electrolytic cap, LED, crystal, LDR, thermistor, lamp)  span 1–2 (bendable)
 *   TO-92  3 leads in adjacent columns, flat face towards the viewer; BJTs E-B-C unless a
 *          per-part override says otherwise (BC547/BC557: C-B-E; 2N7000: S-G-D; …)
 *   TO-220 / TO-126  3 leads, printed face towards the viewer (BJT B-C-E, MOSFET G-D-S,
 *          regulators by pin number: 78xx IN-GND-OUT, 79xx GND-IN-OUT, LM317 ADJ-OUT-IN)
 *   DIP-N  straddles the centre channel, notch to the left: pin 1 is the first lead (row f),
 *          pins 1…N/2 run left → right along row f, pins N/2+1…N run right → left along row e
 *   pot (1-W-2), slide / toggle switches, push button, 7-segment display (10-pin DIP-like),
 *   bar graph (20-pin), buzzer (7.6 mm), headers, terminal blocks, generic box.
 *
 * Placement pin keys (`PartPlacement.pins`):
 *   `<pin>`       a PartDef pin name
 *   `#<n>`        a physical DIP pin without a schematic pin: hidden supply / ground pins of logic
 *                 ICs (described in `hidden`) or not-connected pins
 *   `<pin>~<k>`   an extra physical lead internally tied to `<pin>` (e.g. the second common pin
 *                 of a 7-segment display); the board connectivity joins it with `<pin>`
 *
 * Sources, instruments, meters, probes, motors and transformers are `offboard`: they connect
 * through clip leads. Power / ground symbols and annotation symbols (LibraryPartDef.annotation:
 * test points, signal arrows, IC sockets) are `none`. SIP resistor networks (`SIP-<n>`) sit in one
 * row, pin 1 first.
 */

import type { PartDef } from '../library/types';
import { defaultParams } from '../library';
import type { BoardInstance, BreadboardHole } from './types';
import { gridToHole, holeGrid } from './geometry';

export type Mounting = 'board' | 'offboard' | 'none';

export type BodyKind =
  | 'resistor'
  | 'diode'
  | 'led'
  | 'ceramic-cap'
  | 'electrolytic-cap'
  | 'inductor'
  | 'to92'
  | 'to220'
  | 'dip'
  | 'pot'
  | 'trimmer'
  | 'switch-slide'
  | 'switch-toggle'
  | 'push-button'
  | 'seven-seg'
  | 'bargraph'
  | 'buzzer'
  | 'crystal'
  | 'header'
  | 'lamp'
  | 'ldr'
  | 'thermistor'
  | 'fuse'
  | 'generic'
  // off-board devices
  | 'battery'
  | 'supply'
  | 'instrument'
  | 'device';

export type PolarityKind = 'led' | 'diode' | 'electrolytic' | 'buzzer';

export interface LeadTemplate {
  /** placement pin key (see module comment) */
  key: string;
  /** offset from the first lead in pitches: dx along the columns, dy across the rows (down) */
  dx: number;
  dy: number;
}

export interface HiddenPin {
  role: 'supply' | 'ground' | 'nc';
  /** supply: schematic net name the pin belongs to (e.g. "VCC"); ground: "0" */
  net?: string;
}

export interface LeadMap {
  partId: string;
  mounting: Mounting;
  body: BodyKind;
  /** lead template for rotation 0; the first lead is the anchor at (0, 0) */
  leads: LeadTemplate[];
  /** leads must land within 0.3 pitch of the template (false: bendable leads, 1 pitch) */
  rigid: boolean;
  /** 2-lead parts whose leads can be bent to any span in [min, max] pitches */
  flexible?: { min: number; max: number; preferred: number };
  polarity?: { plus: string; minus: string; kind: PolarityKind };
  /** physical pins without schematic pin (keys '#n') */
  hidden: Record<string, HiddenPin>;
  /** left-to-right logical pin order of inline 3-lead packages (TO-92 / TO-220) */
  pinout?: string[];
  /** part straddles the centre channel (rows e and f) */
  straddle: boolean;
  /** DIP-like body pin count */
  dipPins?: number;
  /** short text printed on the body (part number / value) */
  label: string;
  /** schematic pins of an off-board part (clip-lead candidates) */
  offboardPins: string[];
}

// ---------------------------------------------------------------------------------------------
// pinout overrides

/** TO-92 pin order, flat face towards the viewer, leads down, left → right. */
const TO92_PINOUT: Record<string, string[]> = {
  'transistors/bc547b': ['C', 'B', 'E'],
  'transistors/bc557b': ['C', 'B', 'E'],
  'transistors/2n7000': ['S', 'G', 'D'],
  'transistors/bs170': ['D', 'G', 'S'],
  'transistors/2n5457': ['D', 'S', 'G'],
  'analog/tl431': ['REF', 'A', 'K'],
  'diodes/scr': ['K', 'G', 'A'],
};

/** TO-220 / TO-126 pin order, printed face towards the viewer, left → right. */
const TO220_PINOUT: Record<string, string[]> = {
  'transistors/bd139': ['E', 'C', 'B'],
  'transistors/bd140': ['E', 'C', 'B'],
};

/** Register (or replace) the left-to-right lead order of a 3-lead part, e.g. ['C','B','E']. */
export function registerPinout(partId: string, order: string[], pkg: 'to92' | 'to220' = 'to92'): void {
  (pkg === 'to92' ? TO92_PINOUT : TO220_PINOUT)[partId] = [...order];
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

function numberOrder(def: PartDef): string[] {
  return [...def.symbol.pins].sort((p, q) => Number(p.number ?? 999) - Number(q.number ?? 999)).map((p) => p.name);
}

function to92Order(def: PartDef): string[] {
  const names = def.symbol.pins.map((p) => p.name);
  const o = TO92_PINOUT[def.id];
  if (o && sameSet(o, names)) return o;
  if (sameSet(names, ['C', 'B', 'E'])) return ['E', 'B', 'C'];
  return numberOrder(def);
}

function to220Order(def: PartDef): string[] {
  const names = def.symbol.pins.map((p) => p.name);
  const o = TO220_PINOUT[def.id];
  if (o && sameSet(o, names)) return o;
  if (sameSet(names, ['C', 'B', 'E'])) return def.footprint === 'TO-126' ? ['E', 'C', 'B'] : ['B', 'C', 'E'];
  if (sameSet(names, ['D', 'G', 'S'])) return ['G', 'D', 'S'];
  return numberOrder(def);
}

// ---------------------------------------------------------------------------------------------
// helpers

export function logicalPin(key: string): string {
  const i = key.indexOf('~');
  return i < 0 ? key : key.slice(0, i);
}

const inline = (keys: string[], step = 1): LeadTemplate[] => keys.map((key, i) => ({ key, dx: i * step, dy: 0 }));

/** DIP-style template: keys[i] is physical pin i+1 (missing entries become '#n'). */
function dipTemplate(byNumber: (string | undefined)[], n: number): LeadTemplate[] {
  const half = n / 2;
  const out: LeadTemplate[] = [];
  for (let k = 1; k <= n; k++) {
    const key = byNumber[k] ?? `#${k}`;
    out.push(k <= half ? { key, dx: k - 1, dy: 0 } : { key, dx: n - k, dy: -3 });
  }
  return out;
}

/** Short printed label: "555 Timer" -> "555", "NPN Transistor" -> "NPN", "LM741" -> "LM741". */
export function shortLabel(def: PartDef): string {
  const name = def.name.replace(/\(.*?\)/g, '').trim();
  const first = name.split(/\s+/)[0] ?? name;
  if (/\d/.test(first) || name.split(/\s+/).length === 1) return first;
  return first.length <= 6 ? first.toUpperCase() : first;
}

/** Parse "Hidden power pins (VCC = 14, GND = 7)" from a part description. */
function hiddenPowerPins(def: PartDef): { supply?: number; ground?: number } {
  const m = /Hidden power pins \(([^)]*)\)/i.exec(def.description);
  if (!m) return {};
  const out: { supply?: number; ground?: number } = {};
  for (const part of m[1].split(',')) {
    const pm = /([A-Za-z]+)\s*=\s*(\d+)/.exec(part);
    if (!pm) continue;
    const name = pm[1].toUpperCase();
    const n = Number(pm[2]);
    if (name === 'GND' || name === 'VSS') out.ground = n;
    else out.supply = n;
  }
  return out;
}

const OFFBOARD_GROUPS = new Set(['sources', 'instruments', 'rf']);
const OFFBOARD_FOOTPRINTS = new Set(['MOTOR-2P', 'XFMR-4P', 'XFMR-5P', 'COAX']);

function mountingOf(def: PartDef): Mounting {
  // power / ground symbols and schematic-only annotation symbols / placeholders (test points,
  // signal arrows, IC sockets) have no body on the breadboard
  if (def.globalNet !== undefined || (def as { annotation?: string }).annotation !== undefined) return 'none';
  if (def.instrument || OFFBOARD_GROUPS.has(def.group)) return 'offboard';
  const ind = def.indicator?.kind;
  if (ind === 'voltmeter' || ind === 'ammeter' || ind === 'probe' || ind === 'motor') return 'offboard';
  if (def.footprint && OFFBOARD_FOOTPRINTS.has(def.footprint)) return 'offboard';
  if (def.prefix === 'T' && !def.footprint) return 'offboard';
  return 'board';
}

function offboardBody(def: PartDef): BodyKind {
  if (def.id === 'sources/battery') return 'battery';
  if (def.instrument || def.indicator) return 'instrument';
  if (def.group === 'sources') return 'supply';
  return 'device';
}

const base = (def: PartDef, mounting: Mounting, body: BodyKind, leads: LeadTemplate[], extra: Partial<LeadMap> = {}): LeadMap => ({
  partId: def.id,
  mounting,
  body,
  leads,
  rigid: true,
  hidden: {},
  straddle: false,
  label: shortLabel(def),
  offboardPins: [],
  ...extra,
});

const twoPins = (def: PartDef): [string, string] => [def.symbol.pins[0]?.name ?? '1', def.symbol.pins[1]?.name ?? '2'];

function axial(def: PartDef, body: BodyKind, span: number): LeadMap {
  const [a, b] = twoPins(def);
  return base(def, 'board', body, [{ key: a, dx: 0, dy: 0 }, { key: b, dx: span, dy: 0 }], { rigid: false, flexible: { min: 3, max: 12, preferred: span } });
}

function radial(def: PartDef, body: BodyKind, span: number, keys?: [string, string]): LeadMap {
  const [a, b] = keys ?? twoPins(def);
  return base(def, 'board', body, [{ key: a, dx: 0, dy: 0 }, { key: b, dx: span, dy: 0 }], { rigid: false, flexible: { min: 1, max: 3, preferred: span } });
}

function genericMap(def: PartDef): LeadMap {
  const names = def.symbol.pins.map((p) => p.name);
  if (names.length <= 4) return base(def, 'board', 'generic', inline(names));
  const per = Math.ceil(names.length / 2);
  const byNumber: (string | undefined)[] = [undefined, ...names];
  return base(def, 'board', 'generic', dipTemplate(byNumber, per * 2), { straddle: true, dipPins: per * 2 });
}

/** 7-segment display, common 10-pin layout (top view, decimal point bottom right). */
const SEVEN_SEG_PINS = ['e', 'd', 'COM', 'c', 'dp', 'b', 'a', 'COM~2', 'f', 'g'];

// ---------------------------------------------------------------------------------------------

/** Physical lead map of a part. `params` are the instance params (for hidden supply net names). */
export function leadMap(def: PartDef, params: Record<string, string> = {}): LeadMap {
  const mounting = mountingOf(def);
  if (mounting === 'none') return base(def, 'none', 'generic', []);
  if (mounting === 'offboard') return base(def, 'offboard', offboardBody(def), [], { offboardPins: def.symbol.pins.map((p) => p.name), rigid: false });

  const fp = def.footprint ?? '';
  const names = def.symbol.pins.map((p) => p.name);
  const p = { ...defaultParams(def), ...params };

  // DIP packages ------------------------------------------------------------------------------
  const dip = /^DIP-(\d+)$/.exec(fp);
  if (dip) {
    let maxNum = 0;
    const byNumber: (string | undefined)[] = [];
    for (const pin of def.symbol.pins) {
      const n = Number(pin.number);
      if (Number.isInteger(n) && n > 0) {
        byNumber[n] = pin.name;
        maxNum = Math.max(maxNum, n);
      }
    }
    const power = hiddenPowerPins(def);
    maxNum = Math.max(maxNum, power.supply ?? 0, power.ground ?? 0);
    let n = Math.max(Number(dip[1]), maxNum);
    if (n % 2) n += 1;
    const hidden: Record<string, HiddenPin> = {};
    const supplyNet = (p.vccnet ?? p.vddnet ?? 'VCC').trim() || 'VCC';
    for (let k = 1; k <= n; k++) {
      if (byNumber[k]) continue;
      if (k === power.supply) hidden[`#${k}`] = { role: 'supply', net: supplyNet };
      else if (k === power.ground) hidden[`#${k}`] = { role: 'ground', net: '0' };
      else hidden[`#${k}`] = { role: 'nc' };
    }
    return base(def, 'board', 'dip', dipTemplate(byNumber, n), { hidden, straddle: true, dipPins: n });
  }

  // packages by footprint ---------------------------------------------------------------------
  switch (fp) {
    case 'RES-AXIAL-400': {
      const watts = Number.parseFloat(p.power ?? '0.25');
      return axial(def, 'resistor', watts >= 1 ? 6 : watts >= 0.5 ? 5 : 4);
    }
    case 'DO-35':
    case 'SOD-323':
    case 'SOT-23':
      if (sameSet(names, ['A', 'K'])) return { ...axial(def, 'diode', 4), polarity: { plus: 'A', minus: 'K', kind: 'diode' } };
      break;
    case 'DO-41':
      if (sameSet(names, ['A', 'K'])) return { ...axial(def, 'diode', 5), polarity: { plus: 'A', minus: 'K', kind: 'diode' } };
      break;
    case 'LED-5MM':
      return { ...radial(def, 'led', 1, ['A', 'K']), flexible: { min: 1, max: 3, preferred: 1 }, polarity: { plus: 'A', minus: 'K', kind: 'led' } };
    case 'PD-5MM':
      return { ...radial(def, 'led', 1, ['A', 'K']), polarity: { plus: 'A', minus: 'K', kind: 'diode' } };
    case 'CAP-RADIAL-200':
      return radial(def, 'ceramic-cap', 2);
    case 'CAP-RADIAL-250':
      if (sameSet(names, ['+', '-'])) return { ...radial(def, 'electrolytic-cap', 1, ['+', '-']), polarity: { plus: '+', minus: '-', kind: 'electrolytic' } };
      return radial(def, 'electrolytic-cap', 1);
    case 'CAP-TRIM-3P':
      return radial(def, 'trimmer', 2);
    case 'IND-AXIAL-500':
    case 'IND-VAR':
      return axial(def, 'inductor', 5);
    case 'FUSE-5X20':
      return { ...axial(def, 'fuse', 8), flexible: { min: 7, max: 12, preferred: 8 } };
    case 'RES-RADIAL-100':
      return radial(def, 'thermistor', 1);
    case 'LDR-5MM':
      return radial(def, 'ldr', 2);
    case 'LAMP-2P':
      return { ...radial(def, 'lamp', 2), flexible: { min: 1, max: 4, preferred: 2 } };
    case 'HC-49':
      return radial(def, 'crystal', 2);
    case 'XTAL-TUNING-FORK':
      return radial(def, 'crystal', 1);
    case 'BUZZER-12MM':
      if (sameSet(names, ['+', '-'])) return base(def, 'board', 'buzzer', inline(['+', '-'], 3), { polarity: { plus: '+', minus: '-', kind: 'buzzer' } });
      return base(def, 'board', 'buzzer', inline(names, 3));
    case 'POT-3P':
      if (sameSet(names, ['1', 'W', '2'])) return base(def, 'board', 'pot', inline(['1', 'W', '2']), { pinout: ['1', 'W', '2'] });
      return base(def, 'board', 'pot', inline(names, 2));
    case 'SW-TOGGLE-2P':
      return base(def, 'board', 'switch-toggle', inline(names, 2));
    case 'SW-TOGGLE-3P':
      if (sameSet(names, ['COM', 'A', 'B'])) return base(def, 'board', 'switch-slide', inline(['A', 'COM', 'B']), { pinout: ['A', 'COM', 'B'] });
      break;
    case 'SW-TOGGLE-6P':
      if (sameSet(names, ['COM1', 'A1', 'B1', 'COM2', 'A2', 'B2'])) {
        return base(
          def,
          'board',
          'switch-slide',
          [
            { key: 'A2', dx: 0, dy: 0 },
            { key: 'COM2', dx: 1, dy: 0 },
            { key: 'B2', dx: 2, dy: 0 },
            { key: 'A1', dx: 0, dy: -3 },
            { key: 'COM1', dx: 1, dy: -3 },
            { key: 'B1', dx: 2, dy: -3 },
          ],
          { straddle: true },
        );
      }
      break;
    case 'SW-TACT-6MM':
      return base(def, 'board', 'push-button', inline(names, 2));
    case 'TO-92': {
      const order = to92Order(def);
      return base(def, 'board', 'to92', inline(order), { pinout: order });
    }
    case 'TO-220':
    case 'TO-126':
    case 'TO-3':
    case 'SOT-223': {
      const order = names.length === 3 ? to220Order(def) : numberOrder(def);
      return base(def, 'board', 'to220', inline(order), { pinout: order });
    }
    case 'DISPLAY-7SEG-10P': {
      const common = names.find((n) => n === 'CA' || n === 'CC') ?? 'COM';
      const keys = SEVEN_SEG_PINS.map((k) => (k === 'COM' ? common : k === 'COM~2' ? `${common}~2` : k));
      if (keys.every((k) => names.includes(k.split('~')[0]))) {
        return base(def, 'board', 'seven-seg', dipTemplate([undefined, ...keys], 10), { straddle: true, dipPins: 10 });
      }
      break;
    }
    case 'DISPLAY-HEX':
      return base(def, 'board', 'seven-seg', inline(names));
    case 'BARGRAPH-20P': {
      const anodes = names.filter((n) => /^A\d+$/.test(n));
      const cathodes = names.filter((n) => /^K\d+$/.test(n));
      if (anodes.length === 10 && cathodes.length === 10) {
        const byNumber: (string | undefined)[] = [undefined];
        for (let k = 1; k <= 10; k++) byNumber[k] = `A${k}`;
        for (let k = 1; k <= 10; k++) byNumber[21 - k] = `K${k}`;
        return base(def, 'board', 'bargraph', dipTemplate(byNumber, 20), { straddle: true, dipPins: 20 });
      }
      break;
    }
    default:
      if (/^HDR-1X\d+/.test(fp)) return base(def, 'board', 'header', inline(numberOrder(def)));
      if (/^TB-\d+P/.test(fp)) return base(def, 'board', 'header', inline(numberOrder(def), 2));
      if (/^SIP-\d+$/.test(fp)) return base(def, 'board', 'generic', inline(numberOrder(def)));
  }
  return genericMap(def);
}

// ---------------------------------------------------------------------------------------------
// placing a template on a board

/** Rotate a grid offset clockwise on screen (x right, y down) by a multiple of 90°. */
export function rotateOffset(dx: number, dy: number, rotation: number): { dx: number; dy: number } {
  const r = ((Math.round(rotation / 90) % 4) + 4) % 4;
  // "+ 0" turns -0 into 0
  switch (r) {
    case 1:
      return { dx: -dy + 0, dy: dx + 0 };
    case 2:
      return { dx: -dx + 0, dy: -dy + 0 };
    case 3:
      return { dx: dy + 0, dy: -dx + 0 };
    default:
      return { dx: dx + 0, dy: dy + 0 };
  }
}

export interface PlacedLeads {
  pins: Record<string, BreadboardHole>;
  /** keys whose template position has no hole */
  bad: string[];
  ok: boolean;
}

/**
 * Drop a lead template on a board: the first lead goes into `anchor`, the others follow the
 * rotated template and snap to the nearest hole (0.3 pitch for rigid packages, 1 pitch for
 * bendable leads, so e.g. a resistor rotated across the channel still finds holes).
 */
export function placeLeads(map: LeadMap, board: BoardInstance, anchor: BreadboardHole, rotation = 0): PlacedLeads {
  const pins: Record<string, BreadboardHole> = {};
  const bad: string[] = [];
  const g = holeGrid(board, anchor);
  if (!g || !map.leads.length) return { pins, bad: map.leads.map((l) => l.key), ok: false };
  const tol = map.rigid ? 0.3 : 1.01;
  for (const lead of map.leads) {
    const o = rotateOffset(lead.dx, lead.dy, rotation);
    const h = lead.dx === 0 && lead.dy === 0 ? { ...anchor } : gridToHole(board, g.gx + o.dx, g.gy + o.dy, tol);
    if (h && (lead.dx !== 0 || lead.dy !== 0 || gridToHole(board, g.gx, g.gy, 0.01))) pins[lead.key] = h;
    else bad.push(lead.key);
  }
  return { pins, bad, ok: bad.length === 0 };
}
