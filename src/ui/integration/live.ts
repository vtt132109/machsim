/**
 * Live simulation read-outs (pure): which vectors a design needs while streaming, probe texts,
 * indicator brightness for the schematic and the breadboard, and indicator readings.
 *
 * All functions take a snapshot of simulation vectors keyed "V(node)" / "I(element)" (the
 * TransientStepper.latest() record or one sample of an analysis result); names are matched
 * case-insensitively and ground is 0 V.
 */
import type { IndicatorBinding, NetlistBuildEx } from '../../model/netlister';
import { mcuVectorNames } from '../../mcu/probes';
import type { Design, ProbeBinding, SignalRef } from '../../model/types';
import type { PartLookup } from '../store/types';
import { indicatorLevels } from '../../breadboard/indicators';
import { ladderVectorNames } from '../../ladder/probes';
import { createMecha } from '../../mecha/models';
import { signalVectorNames } from '../instruments/signals';
import { formatEng } from '../../util/units';
import { formatReading } from '../instruments/resolution';
import { t } from '../../i18n';
import { getPart } from '../../library';
import { lcdChar } from '../editor/displayGlyphs';
import { variantView } from '../../model/variants';
import { liveKey } from '../../model/hierarchy';

export { signalValue } from '../../breadboard/indicators';

/** Lower-case lookup table of a vector snapshot. */
export function lowerValues(values: Record<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(values)) m.set(k.toLowerCase(), v);
  return m;
}

/** Value of a signal in a lower-cased snapshot (undefined when a vector is missing). */
export function readSignal(ref: SignalRef, values: Map<string, number>): number | undefined {
  if (ref.kind === 'current') return values.get(`i(${ref.element.toLowerCase()})`);
  const v = (n: string): number | undefined => (n === '0' || n.toLowerCase() === 'gnd' ? 0 : values.get(`v(${n.toLowerCase()})`));
  const a = v(ref.pos);
  const b = v(ref.neg);
  return a === undefined || b === undefined ? undefined : a - b;
}

/**
 * Vectors the interactive run must record: every instrument channel, probe and indicator
 * signal. An empty list means "record everything" (nothing live in the design).
 */
export function neededVectors(build: Pick<NetlistBuildEx, 'instruments' | 'probes' | 'indicators' | 'ratings' | 'mcus' | 'ladder' | 'ladders'>): string[] {
  const out = new Map<string, string>();
  const add = (ref: SignalRef | undefined) => {
    if (!ref) return;
    for (const n of signalVectorNames(ref)) if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), n);
  };
  for (const b of build.instruments) for (const ref of Object.values(b.channels)) add(ref);
  for (const p of build.probes) {
    add(p.signal);
    add(p.current);
  }
  for (const i of build.indicators) {
    add(i.signal);
    add(i.current);
    for (const ref of i.signals ?? []) add(ref);
  }
  for (const r of build.ratings ?? []) for (const term of r.terms) add(term.signal);
  // microcontrollers: the register / RAM read-outs the code editor panel shows
  for (const m of build.mcus ?? []) {
    if (!m.debug) continue;
    for (const n of mcuVectorNames(m.element)) if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), n);
  }
  // ladder diagram: the images, timers, counters and element states the ladder editor lights up
  for (const lad of [build.ladder, ...(build.ladders ?? [])]) {
    if (!lad?.debug) continue;
    for (const n of ladderVectorNames(lad.element, lad.ir)) if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), n);
  }
  return [...out.values()];
}

/**
 * True when some placed part is interactive (switch, potentiometer, key-operated part), at the top
 * level or inside a block that is placed somewhere.
 */
export function hasInteractiveParts(design: Design, lookup: PartLookup): boolean {
  const view = variantView(design);
  const any = (sheets: Design['sheets']) => sheets.some((s) => s.parts.some((p) => !p.excludeFromSim && !!lookup(p.partId)?.interactive));
  if (any(view.sheets)) return true;
  return (view.children ?? []).some((c) => any(c.sheets));
}

/** Key of an indicator in the live-level maps: the part's refdes, or `X2/LED1` for a part inside a block copy. */
export function indicatorKey(b: Pick<IndicatorBinding, 'refdes' | 'scope'>): string {
  return b.scope ? liveKey(b.scope.path, b.scope.local) : b.refdes;
}

/** Key of a probe in `probeValues`: its id, or `X2/<id>` for a probe inside a block copy. */
export function probeKey(p: Pick<ProbeBinding, 'probeId' | 'path'>): string {
  return liveKey(p.path, p.probeId);
}

/**
 * Whether Run should start the streaming (interactive) transient instead of a one-shot
 * analysis: instruments, indicators, rated parts (burn-out) or interactive parts need live values.
 */
export function needsStreaming(build: Pick<NetlistBuildEx, 'instruments' | 'indicators' | 'ratings' | 'mcus' | 'ladder' | 'ladders'>, design: Design, lookup: PartLookup): boolean {
  return (
    build.instruments.length > 0 ||
    build.indicators.length > 0 ||
    (build.ratings?.length ?? 0) > 0 ||
    (build.mcus?.length ?? 0) > 0 ||
    build.ladder !== undefined ||
    (build.ladders?.length ?? 0) > 0 ||
    hasInteractiveParts(design, lookup)
  );
}

// ---------------------------------------------------------------------------
// probe read-outs
// ---------------------------------------------------------------------------

/** Statistics of a signal over a recent window. */
export interface SignalStats {
  min: number;
  max: number;
  rms: number;
  mean: number;
  count: number;
}

/**
 * Bounded history of one signal (time-ordered), for the p-p / RMS line of probe read-outs.
 * A sample older than the newest one restarts the history (simulation restart).
 */
export class SignalHistory {
  private t: Float64Array;
  private v: Float64Array;
  private head = 0;
  private n = 0;

  constructor(readonly capacity = 4096) {
    this.t = new Float64Array(capacity);
    this.v = new Float64Array(capacity);
  }

  get length(): number {
    return this.n;
  }

  clear(): void {
    this.head = 0;
    this.n = 0;
  }

  push(time: number, value: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(value)) return;
    if (this.n && time < this.t[(this.head + this.n - 1) % this.capacity]) this.clear();
    const slot = (this.head + this.n) % this.capacity;
    this.t[slot] = time;
    this.v[slot] = value;
    if (this.n < this.capacity) this.n++;
    else this.head = (this.head + 1) % this.capacity;
  }

  /**
   * Frequency of the signal over the last `window` seconds from its rising crossings of the mean
   * (with a 10 % hysteresis band of the peak-to-peak value); null without two full periods.
   */
  frequency(window: number): number | null {
    const st = this.stats(window);
    if (!st || !(st.max - st.min > 0)) return null;
    const hi = st.mean + 0.05 * (st.max - st.min);
    const lo = st.mean - 0.05 * (st.max - st.min);
    const last = (this.head + this.n - 1) % this.capacity;
    const tEnd = this.t[last];
    const ups: number[] = [];
    let armed = false;
    let prevT = Number.NaN;
    let prevV = 0;
    for (let k = 0; k < this.n; k++) {
      const i = (this.head + k) % this.capacity;
      const time = this.t[i];
      if (time < tEnd - window) continue;
      const v = this.v[i];
      if (v < lo) armed = true;
      if (armed && v >= hi && !Number.isNaN(prevT)) {
        // interpolate the crossing of the upper threshold
        const f = v !== prevV ? (hi - prevV) / (v - prevV) : 0;
        ups.push(prevT + f * (time - prevT));
        armed = false;
      }
      prevT = time;
      prevV = v;
    }
    if (ups.length < 3) return null;
    return (ups.length - 1) / (ups[ups.length - 1] - ups[0]);
  }

  /** Time-weighted statistics of the samples in the last `window` seconds (null below 3 samples). */
  stats(window: number): SignalStats | null {
    if (this.n < 3) return null;
    const last = (this.head + this.n - 1) % this.capacity;
    const tEnd = this.t[last];
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let sum2 = 0;
    let span = 0;
    let count = 0;
    let prevT = Number.NaN;
    let prevV = 0;
    for (let k = 0; k < this.n; k++) {
      const i = (this.head + k) % this.capacity;
      if (this.t[i] < tEnd - window) continue;
      const x = this.v[i];
      min = Math.min(min, x);
      max = Math.max(max, x);
      if (!Number.isNaN(prevT)) {
        const dt = this.t[i] - prevT;
        // trapezoidal mean of v and v²
        sum += (dt * (x + prevV)) / 2;
        sum2 += (dt * (x * x + prevV * prevV)) / 2;
        span += dt;
      }
      prevT = this.t[i];
      prevV = x;
      count++;
    }
    if (count < 3 || !(span > 0)) return null;
    return { min, max, mean: sum / span, rms: Math.sqrt(Math.max(0, sum2 / span)), count };
  }
}

/** Seconds of simulated time the probe statistics look back. */
export const PROBE_STATS_WINDOW = 0.1;

const UNIT: Record<string, string> = { voltage: 'V', current: 'A', power: 'W', differential: 'V', digital: 'V', reference: 'V' };
const SYMBOL: Record<string, string> = { voltage: 'V', current: 'I', power: 'P', differential: 'V', digital: 'V', reference: 'V' };

/** Value of a probe (power probes: V·I) or undefined when a vector is missing. */
export function probeValue(p: ProbeBinding, values: Map<string, number>): number | undefined {
  const s = readSignal(p.signal, values);
  if (s === undefined) return undefined;
  if (p.kind === 'power') {
    const i = p.current ? readSignal(p.current, values) : undefined;
    return i === undefined ? undefined : s * i;
  }
  return s;
}

/**
 * Text drawn under a probe flag: the instantaneous value and, when a history with a varying
 * signal is given, its peak-to-peak and RMS values ("\n" separates the lines).
 * Digital probes show the logic level (threshold 2.5 V) and the voltage.
 */
export function probeText(p: ProbeBinding, values: Map<string, number>, history?: SignalHistory): string {
  const v = probeValue(p, values);
  const sym = p.refName ? `${SYMBOL[p.kind]}(–${p.refName})` : SYMBOL[p.kind];
  if (v === undefined) return `${sym}: —`;
  const unit = UNIT[p.kind];
  if (p.kind === 'digital') return `${v >= 2.5 ? '1' : '0'} (${formatReading(v, 'V', 3)})`;
  const st = history?.stats(PROBE_STATS_WINDOW);
  const varying = !!st && st.max - st.min > 1e-9 * Math.max(1, Math.abs(st.max));
  if (!p.show) {
    const lines = [`${sym}: ${formatReading(v, unit, 4)}`];
    if (st && varying) lines.push(`${SYMBOL[p.kind]}pp: ${formatReading(st.max - st.min, unit, 3)}  rms: ${formatReading(st.rms, unit, 3)}`);
    return lines.join('\n');
  }
  const parts: string[] = [];
  for (const r of p.show) {
    if (r === 'value') parts.push(`${sym}: ${formatReading(v, unit, 4)}`);
    else if (r === 'pp') parts.push(`${SYMBOL[p.kind]}pp: ${st ? formatReading(st.max - st.min, unit, 3) : '—'}`);
    else if (r === 'rms') parts.push(`rms: ${st ? formatReading(st.rms, unit, 3) : '—'}`);
    else if (r === 'dc') parts.push(`dc: ${st ? formatReading(st.mean, unit, 3) : formatReading(v, unit, 3)}`);
    else if (r === 'freq') {
      const f = varying ? history?.frequency(PROBE_STATS_WINDOW) : null;
      parts.push(`f: ${f ? formatEng(f, 'Hz', 4) : '—'}`);
    }
  }
  // two readings per line
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 2) lines.push(parts.slice(i, i + 2).join('  '));
  return lines.join('\n') || `${sym}: ${formatReading(v, unit, 4)}`;
}

// ---------------------------------------------------------------------------
// indicators
// ---------------------------------------------------------------------------

export const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;

export interface LiveLevels {
  /**
   * refdes -> level for the schematic (> 0 glows; segment displays and bar graphs: the lit mask);
   * multi-cell displays (LCD, dot matrix) add `${refdes}#k` = value of their k-th code signal
   */
  schematic: Record<string, number>;
  /** keys for <BreadboardView indicatorLevels> (refdes, `${refdes}.a` … `.dp`, `${refdes}.1` … `.10`) */
  breadboard: Record<string, number>;
}

/** Indicator brightness from a vector snapshot. */
export function liveLevels(indicators: readonly IndicatorBinding[], values: Record<string, number>): LiveLevels {
  const schematic: Record<string, number> = {};
  const breadboard: Record<string, number> = {};
  const lower = lowerValues(values);
  // a part inside a block copy is keyed by its path (`X2/LED1`), so two copies glow on their own
  const analogue = indicators.filter((b) => b.kind === 'led' || b.kind === 'lamp' || b.kind === 'buzzer' || b.kind === 'probe').map((b) => ({ ...b, refdes: indicatorKey(b) }));
  for (const [k, v] of Object.entries(indicatorLevels(analogue, values))) {
    schematic[k] = v;
    breadboard[k] = v;
  }
  for (const b of indicators) {
    const key = indicatorKey(b);
    if (b.kind === 'lcd' || b.kind === 'matrix' || b.kind === 'mecha') {
      let any = false;
      (b.signals ?? [b.signal]).forEach((ref, k) => {
        const v = readSignal(ref, lower);
        if (v === undefined) return;
        // a machine's values are continuous (level, position, item places): keep them as they are
        schematic[`${key}#${k}`] = b.kind === 'mecha' ? v : Math.round(v);
        any = true;
      });
      if (any) {
        schematic[key] = 1;
        breadboard[key] = 1;
      }
      continue;
    }
    if (b.kind !== 'seven-seg' && b.kind !== 'bargraph' && b.kind !== 'alnum') continue;
    const s = readSignal(b.signal, lower);
    if (s === undefined) continue;
    const mask = Math.max(0, Math.round(s));
    schematic[key] = mask;
    breadboard[key] = mask > 0 ? 1 : 0;
    if (b.kind === 'seven-seg') SEGMENT_NAMES.forEach((seg, i) => (breadboard[`${key}.${seg}`] = (mask >> i) & 1));
    else for (let k = 1; k <= 24; k++) breadboard[`${key}.${k}`] = Math.floor(mask / 2 ** (k - 1)) % 2;
  }
  return { schematic, breadboard };
}

/** Text of a character LCD's visible lines ("line 1 | line 2"), or "display off". */
function lcdReading(b: IndicatorBinding, values: Map<string, number>): string {
  const ind = getPart(b.partId)?.indicator;
  const cols = ind?.cols ?? 16;
  const rows = ind?.rows ?? 2;
  const sig = b.signals ?? [];
  const status = Math.round(readSignal(sig[cols * rows] ?? b.signal, values) ?? 0);
  if (status % 2 === 0) return t('integration.live.lcdOff');
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const code = Math.round(readSignal(sig[r * cols + c] ?? b.signal, values) ?? 32);
      line += code < 16 ? '▒' : lcdChar(code);
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return t('integration.live.lcdText', { text: lines.join(' | ') });
}

/**
 * One line about a machine for the Simulation tab, from its report nodes. The signal order of a
 * mechatronics part is inputs, sensor pins, report nodes (src/library/catalog/mecha.ts), so the
 * model's own pin list says where the reports start.
 */
function mechaReading(b: IndicatorBinding, values: Map<string, number>): string {
  const scene = getPart(b.partId)?.indicator?.scene ?? '';
  const spec = createMecha(scene, (_k, d) => d)?.spec;
  if (!spec) return '—';
  const base = spec.inputs.length + spec.outputs.length;
  const sig = b.signals ?? [];
  const rep = (k: number): number => readSignal(sig[base + k] ?? b.signal, values) ?? 0;
  const n = (v: number, digits = 0): string => v.toFixed(digits);
  switch (scene) {
    case 'conveyor':
      return t('ladder.mecha.conveyor', { n: n(rep(2)), passed: n(rep(1)) });
    case 'junction':
      return t('ladder.mecha.junction', { faults: n(rep(0)), t: n(rep(1), 1) });
    case 'tank':
      return t('ladder.mecha.tank', { pct: n(rep(0)), l: n(rep(1), 2) });
    case 'door':
      return t('ladder.mecha.door', { pct: n(rep(0)) });
    case 'lift':
      return t('ladder.mecha.lift', { floor: n(rep(0), 2), door: n(rep(1)) });
    default:
      return '—';
  }
}

export interface IndicatorReading {
  refdes: string;
  kind: IndicatorBinding['kind'];
  text: string;
}

/** Human-readable value of every indicator (meters, LEDs, displays) for the Simulation tab. */
export function indicatorReadings(indicators: readonly IndicatorBinding[], values: Record<string, number>): IndicatorReading[] {
  const lower = lowerValues(values);
  const out: IndicatorReading[] = [];
  for (const b of indicators) {
    const s = readSignal(b.signal, lower);
    const i = b.current ? readSignal(b.current, lower) : undefined;
    let text: string;
    if (s === undefined) text = '—';
    else if (b.kind === 'lcd') text = lcdReading(b, lower);
    else if (b.kind === 'mecha') text = mechaReading(b, lower);
    else if (b.kind === 'matrix') {
      let dots = 0;
      for (const ref of b.signals ?? [b.signal]) {
        let m = Math.max(0, Math.round(readSignal(ref, lower) ?? 0));
        while (m > 0) {
          dots += m % 2;
          m = Math.floor(m / 2);
        }
      }
      text = dots ? t('integration.live.dotsLit', { n: dots }) : t('integration.live.allOff');
    } else if (b.kind === 'seven-seg' || b.kind === 'bargraph' || b.kind === 'alnum') {
      const mask = Math.max(0, Math.round(s));
      const width = b.kind === 'seven-seg' ? 8 : 24;
      const lit = b.kind === 'seven-seg' ? SEGMENT_NAMES.filter((_, k) => (mask >> k) & 1) : Array.from({ length: width }, (_, k) => String(k + 1)).filter((_, k) => Math.floor(mask / 2 ** k) % 2);
      text = lit.length ? t('integration.live.segmentsLit', { list: lit.join(' ') }) : t('integration.live.allOff');
    } else if (b.kind === 'motor') text = `ω = ${formatEng(s, 'rad/s', 4)}${i !== undefined ? `, I = ${formatEng(i, 'A', 3)}` : ''}`;
    else if (b.signal.kind === 'current') text = formatReading(s, 'A', 4);
    else text = formatReading(s, 'V', 4) + (i !== undefined ? `, ${formatReading(i, 'A', 3)}` : '');
    out.push({ refdes: b.refdes, kind: b.kind, text });
  }
  return out;
}
