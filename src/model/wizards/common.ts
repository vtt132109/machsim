/**
 * Shared pieces of the circuit wizards (src/model/wizards):
 *
 * - {@link WizardResult}: what every wizard returns — a complete, ready-to-simulate design, the
 *   computed part values for the results table, the predicted performance with the chosen
 *   (rounded) values, learner explanations and warnings. Texts are i18n message keys with
 *   parameters, so the dialog shows them in the current language.
 * - Standard-value rounding ({@link roundValue}) on the E series of src/library/series.ts.
 * - {@link WizardSheet}: a thin layout helper over DesignBuilder for two-terminal parts placed
 *   between grid points, supply symbols, grounds and notes.
 *
 * Wiring rule used by every wizard (it matches src/model/connectivity.ts): wires connect only at
 * their END points (to pins, coincident ends, or the interior of another wire). A part pin lying
 * on a wire corner or segment interior is NOT connected, so every junction is made by ending all
 * wires that meet there on the same point.
 */
import { nearestSeriesValue, seriesValues } from '../../library/series';
import type { ESeriesName } from '../../library/types';
import type { AnalysisSpec, AnalysisType } from '../../sim/netlist';
import { DesignBuilder, type PartHandle } from '../designkit';
import type { Design, Point } from '../types';
import { t, type MessageKey, type MessageParams } from '../../i18n';

/** Value rounding of computed parts: exact (4 significant digits) or a standard E series. */
export type Rounding = 'exact' | ESeriesName;

/** A translated text: message key plus parameters (numbers already formatted). */
export interface WizardText {
  key: MessageKey;
  params?: MessageParams;
}

/** One computed part for the results table. */
export interface WizardPart {
  refdes: string;
  /** value text in user syntax ("4.7k", "10n") */
  value: string;
  /** what the part does (message key) */
  role: MessageKey;
  roleParams?: MessageParams;
}

/** A predicted figure of the generated circuit (with the rounded values). */
export interface WizardFigure {
  label: MessageKey;
  value: number;
  unit: string;
  /** the requested value, when the figure is a design target */
  target?: number;
}

export interface WizardResult {
  design: Design;
  parts: WizardPart[];
  predicted: WizardFigure[];
  /** formulas and design steps, in order */
  explain: WizardText[];
  warnings: WizardText[];
}

/** Thrown for impossible specifications (the dialog shows the translated text). */
export class WizardInputError extends Error {
  readonly text: WizardText;
  constructor(key: MessageKey, params?: MessageParams) {
    super(String(key));
    this.text = { key, params };
  }
}

/** Round a computed value: 'exact' keeps 4 significant digits, otherwise the nearest E value. */
export function roundValue(v: number, rounding: Rounding): number {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  if (rounding === 'exact') return Number(v.toPrecision(4));
  return nearestSeriesValue(rounding, v);
}

/** Smallest standard value >= v (capacitors chosen so a pole lands at or below its target). */
export function seriesAtLeast(v: number, series: ESeriesName): number {
  if (!(v > 0)) return v;
  const list = seriesValues(series, v / 1.0000001, v * 20);
  return list.find((x) => x >= v * (1 - 1e-9)) ?? nearestSeriesValue(series, v);
}

const USER_PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'u'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

/** Value text in the user number syntax (M = mega): 4700 -> "4.7k", 1e-8 -> "10n". */
export function valueText(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  for (const [mul, suf] of USER_PREFIXES) {
    if (a >= mul * 0.9999999) return `${Number((v / mul).toPrecision(digits))}${suf}`;
  }
  return v.toPrecision(digits);
}

/** Significant-digit text of a number for explanation parameters ("1.592"). */
export function num(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(digits)));
}

/** Engineering text with a unit for explanation parameters ("1.59 kHz"). */
export function eng(v: number, unit: string, digits = 4): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return `0 ${unit}`;
  const a = Math.abs(v);
  const pre: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  for (const [mul, suf] of pre) {
    if (a >= mul * 0.9999999) return `${Number((v / mul).toPrecision(digits))} ${suf}${unit}`;
  }
  return `${v.toPrecision(digits)} ${unit}`;
}

/** Set the analyses of a design (first entry of `specs` of each type wins). */
export function setAnalyses(d: Design, active: AnalysisType, specs: AnalysisSpec[]): void {
  d.analysis = { active, specs: Object.fromEntries(specs.map((s) => [s.type, s])) };
}

/** Thermal voltage kT/q at 27 °C (V). */
export const VT_27C = 0.025852;

/**
 * Layout helper over DesignBuilder: refdes counters per prefix, two-terminal parts placed by
 * their pin positions, grounds, supply symbols, wires and notes.
 */
export class WizardSheet {
  readonly b: DesignBuilder;
  private counters = new Map<string, number>();
  readonly parts: WizardPart[] = [];

  constructor(title: string) {
    this.b = new DesignBuilder(title);
    // the first sheet is named in the UI language, like a new document
    this.b.design.sheets[0].name = t('sheet.default', { n: 1 });
  }

  get design(): Design {
    return this.b.design;
  }

  /** Next reference designator with `prefix` (R1, R2 …). */
  ref(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }

  /** Record a computed part for the results table. */
  record(refdes: string, value: string, role: MessageKey, roleParams?: MessageParams): void {
    this.parts.push({ refdes, value, role, ...(roleParams ? { roleParams } : {}) });
  }

  /** Vertical two-terminal part: first pin at (x, yTop), second at (x, yTop + 60). */
  vpart(partId: string, refdes: string, x: number, yTop: number, params: Record<string, string> = {}): PartHandle {
    return this.b.part(partId, refdes, x, yTop + 30, params, { rotation: 90 });
  }

  /** Vertical part with the second pin on top (electrolytic '+' at the bottom and so on). */
  vpartUp(partId: string, refdes: string, x: number, yTop: number, params: Record<string, string> = {}): PartHandle {
    return this.b.part(partId, refdes, x, yTop + 30, params, { rotation: 270 });
  }

  /** Horizontal two-terminal part: first pin at (xLeft, y), second at (xLeft + 60, y). */
  hpart(partId: string, refdes: string, xLeft: number, y: number, params: Record<string, string> = {}): PartHandle {
    return this.b.part(partId, refdes, xLeft + 30, y, params);
  }

  /** Horizontal part with the second pin on the left. */
  hpartRev(partId: string, refdes: string, xLeft: number, y: number, params: Record<string, string> = {}): PartHandle {
    return this.b.part(partId, refdes, xLeft + 30, y, params, { mirror: true });
  }

  /** Resistor (vertical / horizontal) with a recorded value. */
  resistor(refdes: string, value: number, at: { x: number; y: number }, vertical: boolean, role: MessageKey, roleParams?: MessageParams): PartHandle {
    const v = valueText(value);
    this.record(refdes, v, role, roleParams);
    return vertical ? this.vpart('basic/resistor', refdes, at.x, at.y, { value: v }) : this.hpart('basic/resistor', refdes, at.x, at.y, { value: v });
  }

  /** Capacitor (vertical / horizontal) with a recorded value. */
  capacitor(refdes: string, value: number, at: { x: number; y: number }, vertical: boolean, role: MessageKey, roleParams?: MessageParams): PartHandle {
    const v = valueText(value);
    this.record(refdes, v, role, roleParams);
    return vertical ? this.vpart('basic/capacitor', refdes, at.x, at.y, { value: v }) : this.hpart('basic/capacitor', refdes, at.x, at.y, { value: v });
  }

  /** Inductor (vertical / horizontal) with a recorded value. */
  inductor(refdes: string, value: number, at: { x: number; y: number }, vertical: boolean, role: MessageKey, roleParams?: MessageParams): PartHandle {
    const v = valueText(value);
    this.record(refdes, v, role, roleParams);
    return vertical ? this.vpart('basic/inductor', refdes, at.x, at.y, { value: v }) : this.hpart('basic/inductor', refdes, at.x, at.y, { value: v });
  }

  /** Ground symbol whose pin is at (x, y). */
  gnd(x: number, y: number): PartHandle {
    return this.b.part('sources/ground', this.ref('GND'), x, y);
  }

  /** Supply rail symbol (VCC / VEE / VDD) whose pin is at (x, y). */
  rail(net: 'VCC' | 'VEE' | 'VDD', x: number, y: number, volts: number): PartHandle {
    return this.b.part(`sources/${net.toLowerCase()}`, this.ref(net), x, y, { voltage: valueText(volts) });
  }

  wire(...points: Point[]): void {
    this.b.wire(...points);
  }

  pin(h: PartHandle, name: string): Point {
    return this.b.pin(h, name);
  }

  label(name: string, x: number, y: number): void {
    this.b.label(name, x, y);
  }

  /** Text note on the sheet. */
  note(x: number, y: number, text: string, size = 11): void {
    const sheet = this.b.sheet;
    sheet.notes.push({ id: `n${sheet.notes.length + 1}`, x, y, text, size });
  }

  /** Text note from a message key (current language). */
  noteText(x: number, y: number, key: MessageKey, params?: MessageParams, size = 11): void {
    this.note(x, y, t(key, params), size);
  }
}

export const p = (x: number, y: number): Point => ({ x, y });

/**
 * Give the first sheet a paper size that holds everything placed on it (wide filter cascades):
 * the default frame (1200 × 850) when it fits, else A3 / A2 / A1 landscape.
 */
export function fitPaper(d: Design): void {
  const sheet = d.sheets[0];
  let maxX = 0;
  let maxY = 0;
  for (const part of sheet.parts) {
    maxX = Math.max(maxX, part.x + 80);
    maxY = Math.max(maxY, part.y + 80);
  }
  for (const w of sheet.wires) for (const pt of w.points) {
    maxX = Math.max(maxX, pt.x + 20);
    maxY = Math.max(maxY, pt.y + 20);
  }
  for (const n of sheet.notes) maxY = Math.max(maxY, n.y + 40);
  if (maxX <= 1150 && maxY <= 800) return;
  const sizes: [NonNullable<NonNullable<Design['sheets'][0]['props']>['paper']>, number, number][] = [
    ['A3', 1680, 1188],
    ['A2', 2376, 1680],
    ['A1', 3364, 2376],
    ['A0', 4756, 3364],
  ];
  const pick = sizes.find(([, w, h]) => maxX <= w - 40 && maxY <= h - 140) ?? sizes[sizes.length - 1];
  sheet.props = { ...(sheet.props ?? {}), paper: pick[0], orientation: 'landscape' };
}
