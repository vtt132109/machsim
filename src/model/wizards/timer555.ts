/**
 * 555 timer wizard: astable (oscillator) and monostable (one-shot) circuits.
 *
 * Astable, standard circuit (R1 from VCC to DIS, R2 from DIS to THR/TRIG, C to ground). The
 * capacitor swings between VCC/3 and 2·VCC/3:
 *   tH = ln2·(R1 + R2)·C,  tL = ln2·R2·C,  f = 1/(ln2·(R1 + 2R2)·C) ≈ 1.44/((R1 + 2R2)·C),
 *   D = (R1 + R2)/(R1 + 2R2)  (always above 50 %).
 * Duty cycles at or below about 60 % use the diode variant: a 1N4148 across R2 charges C through
 * R1 only, so tH = R1·C·ln((VCC − Vd − VCC/3)/(VCC − Vd − 2VCC/3)) and tL = ln2·R2·C (Vd ≈ 0.6 V).
 * Monostable: a trigger pulse below VCC/3 on TRIG starts a pulse of width T = ln3·R·C ≈ 1.1·R·C.
 *
 * The timing capacitor is picked from the E6 series so that the resistors land near 50 kΩ
 * (between 1 kΩ and 1 MΩ), unless the learner fixes C. Resistors are rounded to the chosen series
 * and the predicted timing is recomputed with the rounded values.
 */
import { seriesValues } from '../../library/series';
import type { Design } from '../types';
import { WizardInputError, WizardSheet, eng, num, p, roundValue, setAnalyses, valueText, type Rounding, type WizardResult, type WizardText } from './common';

export type Astable555Variant = 'auto' | 'standard' | 'diode';

export interface Astable555Spec {
  /** output frequency, Hz */
  freq: number;
  /** duty cycle 0.05 .. 0.95 (fraction of the period the output is high) */
  duty: number;
  vcc: number;
  /** timing capacitor (F); undefined = chosen automatically */
  cap?: number;
  variant?: Astable555Variant;
  rounding?: Rounding;
  /** add a 330 Ω + red LED on the output (default: frequencies up to 20 Hz) */
  led?: boolean;
}

export interface Monostable555Spec {
  /** output pulse width, s */
  width: number;
  vcc: number;
  cap?: number;
  rounding?: Rounding;
  /** trigger period (s); default 3 × width */
  triggerPeriod?: number;
}

/** Rough forward drop of the 1N4148 (first design guess and the minimum-VCC check). */
export const DIODE_DROP_555 = 0.6;
const LN2 = Math.LN2;
const LN3 = Math.log(3);
const R_MIN = 1e3;
const R_MAX = 2e6;
/** 1N4148 library model (MS_1N4148: IS, N, RS) used to predict the diode variant's charge time. */
const D_IS = 3e-9;
const D_N = 1.8;
const D_RS = 0.6;
const VT = 0.025852;

/** Forward voltage of the 1N4148 model at current i. */
export function diodeDrop(i: number): number {
  return D_N * VT * Math.log(1 + Math.max(i, 0) / D_IS) + Math.max(i, 0) * D_RS;
}

/**
 * Charge time of the diode variant from VCC/3 to 2·VCC/3: C charges through R1 and the diode
 * (R2 in parallel with the diode also feeds C), dv/dt = i/C with i = (VCC − v − Vd)/R1 and
 * Vd = diode drop at the diode current i − Vd/R2; integrated numerically.
 */
export function diodeChargeTime(r1: number, r2: number, c: number, vcc: number): number {
  const lo = vcc / 3;
  const hi = (2 * vcc) / 3;
  const steps = 200;
  const dv = (hi - lo) / steps;
  let t = 0;
  for (let k = 0; k < steps; k++) {
    const v = lo + (k + 0.5) * dv;
    let vd = DIODE_DROP_555;
    let i = 0;
    for (let it = 0; it < 30; it++) {
      i = (vcc - v - vd) / r1;
      vd = diodeDrop(i - vd / r2);
    }
    if (!(i > 0)) return Number.POSITIVE_INFINITY;
    t += (c * dv) / i;
  }
  return t;
}

/** Minimum VCC check of the diode variant. */
function checkDiodeVcc(vcc: number): void {
  if (!(vcc - DIODE_DROP_555 - (2 * vcc) / 3 > 0)) throw new WizardInputError('wizard.555.errVccLow', { vmin: num(3 * DIODE_DROP_555 + 0.1, 3) });
}

/** 1-2-5 step at or above v (scope settings). */
export function nice125(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    const c = m * 10 ** e;
    if (c >= v * (1 - 1e-9)) return Number(c.toPrecision(3));
  }
  return 10 ** (e + 1);
}

interface AstableValues {
  r1: number;
  r2: number;
  c: number;
  diode: boolean;
}

function astableResistors(spec: Astable555Spec, c: number, diode: boolean): { r1: number; r2: number } {
  const T = 1 / spec.freq;
  const tH = spec.duty * T;
  const tL = (1 - spec.duty) * T;
  const r2 = tL / (LN2 * c);
  if (!diode) return { r1: tH / (LN2 * c) - r2, r2 };
  checkDiodeVcc(spec.vcc);
  // charge time is nearly proportional to R1: a few secant steps on the diode model
  const k0 = Math.log((spec.vcc - DIODE_DROP_555 - spec.vcc / 3) / (spec.vcc - DIODE_DROP_555 - (2 * spec.vcc) / 3));
  let r1 = tH / (k0 * c);
  for (let it = 0; it < 6; it++) {
    const t = diodeChargeTime(r1, r2, c, spec.vcc);
    if (!Number.isFinite(t) || t <= 0) break;
    r1 *= tH / t;
  }
  return { r1, r2 };
}

function chooseAstable(spec: Astable555Spec, diode: boolean): AstableValues {
  if (spec.cap !== undefined) return { ...astableResistors(spec, spec.cap, diode), c: spec.cap, diode };
  let best: AstableValues | null = null;
  let bestScore = Infinity;
  for (const c of seriesValues('E6', 100e-12, 1000e-6)) {
    const { r1, r2 } = astableResistors(spec, c, diode);
    if (!(r1 >= R_MIN && r2 >= R_MIN && r1 <= R_MAX && r2 <= R_MAX)) continue;
    const score = Math.abs(Math.log((r1 + r2) / 2 / 47e3));
    if (score < bestScore) {
      bestScore = score;
      best = { r1, r2, c, diode };
    }
  }
  if (!best) throw new WizardInputError('wizard.555.errNoCap');
  return best;
}

/** Predicted high time, low time of the astable with the given parts. */
export function astableTiming(r1: number, r2: number, c: number, vcc: number, diode: boolean): { tH: number; tL: number; freq: number; duty: number } {
  const tH = diode ? diodeChargeTime(r1, r2, c, vcc) : LN2 * (r1 + r2) * c;
  const tL = LN2 * r2 * c;
  return { tH, tL, freq: 1 / (tH + tL), duty: tH / (tH + tL) };
}

function validateCommon(vcc: number, rounding: Rounding | undefined): Rounding {
  if (!(vcc >= 4.5 && vcc <= 16)) throw new WizardInputError('wizard.555.errVcc');
  return rounding ?? 'E24';
}

function capPart(c: number): string {
  return c >= 1e-6 ? 'basic/electrolytic' : 'basic/capacitor';
}

/** Supply, 555 body, CTRL decoupling and ground common to both modes; returns the U1 handle. */
function place555(w: WizardSheet, vcc: number) {
  const b = w.b;
  const u1 = b.part('analog/555', 'U1', 400, 300);
  w.rail('VCC', 390, 160, vcc);
  w.wire(p(390, 160), p(480, 160));
  w.wire(w.pin(u1, 'RST'), p(390, 160));
  w.wire(w.pin(u1, 'VCC'), p(410, 160));
  // control-voltage decoupling
  const c2 = w.vpart('basic/capacitor', 'C2', 340, 360, { value: '10n' });
  w.record('C2', '10n', 'wizard.role.ctrlCap');
  w.wire(w.pin(u1, 'CTRL'), p(340, 320), w.pin(c2, '1'));
  w.gnd(340, 420);
  w.wire(w.pin(u1, 'GND'), p(400, 360));
  w.gnd(400, 360);
  return u1;
}

/** Oscilloscope on THR (A) and OUT (B) set up for a few periods. */
function addScope(w: WizardSheet, vcc: number, period: number): void {
  const xsc = w.b.part('instruments/scope', 'XSC1', 760, 160, {
    timebase: valueText(nice125((2.5 * period) / 10)),
    'A.scale': valueText(nice125(vcc / 5)),
    'B.scale': valueText(nice125(vcc / 5)),
    'A.pos': '-3',
    'B.pos': '-3',
    'trig.source': 'B',
    'trig.level': valueText(vcc / 2),
  });
  w.b.labelPin(xsc, 'A+', 'THR');
  w.b.labelPin(xsc, 'B+', 'OUT');
}

/** 555 astable oscillator. */
export function design555Astable(spec: Astable555Spec): WizardResult {
  if (!(spec.freq > 0 && spec.freq <= 200e3)) throw new WizardInputError('wizard.555.errFreq');
  if (!(spec.duty >= 0.05 && spec.duty <= 0.95)) throw new WizardInputError('wizard.555.errDuty');
  const rounding = validateCommon(spec.vcc, spec.rounding);
  const variant = spec.variant ?? 'auto';
  const diode = variant === 'diode' || (variant === 'auto' && spec.duty < 0.6);
  if (!diode && spec.duty <= 0.5) throw new WizardInputError('wizard.555.errDutyStandard');
  const raw = chooseAstable(spec, diode);
  const r1 = roundValue(raw.r1, rounding);
  const r2 = roundValue(raw.r2, rounding);
  const c = raw.c;
  const timing = astableTiming(r1, r2, c, spec.vcc, diode);
  const led = spec.led ?? spec.freq <= 20;

  const w = new WizardSheet(`555 astable ${eng(spec.freq, 'Hz', 3)}`);
  const d = w.design;
  const u1 = place555(w, spec.vcc);
  const r1h = w.resistor('R1', r1, { x: 480, y: 190 }, true, 'wizard.role.555r1');
  w.wire(w.pin(r1h, '1'), p(480, 160));
  const r2h = w.resistor('R2', r2, { x: 480, y: 340 }, true, diode ? 'wizard.role.555r2diode' : 'wizard.role.555r2');
  w.wire(w.pin(r1h, '2'), w.pin(r2h, '1'));
  w.wire(w.pin(u1, 'DIS'), p(480, 310));
  // timing capacitor (electrolytic '+' up towards THR)
  const c1 = w.b.part(capPart(c), 'C1', 300, 550, { value: valueText(c) }, { rotation: 90 });
  w.record('C1', valueText(c), 'wizard.role.555c');
  w.wire(p(300, 280), w.pin(c1, capPart(c) === 'basic/electrolytic' ? '+' : '1'));
  w.wire(w.pin(u1, 'TRIG'), p(300, 280));
  w.wire(w.pin(u1, 'THR'), p(300, 300));
  w.wire(w.pin(r2h, '2'), p(480, 500), p(300, 500));
  w.wire(w.pin(c1, capPart(c) === 'basic/electrolytic' ? '-' : '2'), p(300, 600));
  w.gnd(300, 600);
  w.label('THR', 300, 420);
  if (diode) {
    const d1 = w.vpart('diodes/1n4148', 'D1', 540, 340);
    w.record('D1', '1N4148', 'wizard.role.555diode');
    w.wire(p(480, 340), w.pin(d1, 'A'));
    w.wire(p(480, 400), w.pin(d1, 'K'));
  }
  // output
  if (led) {
    w.wire(w.pin(u1, 'OUT'), p(560, 290));
    const r3 = w.resistor('R3', 330, { x: 560, y: 290 }, false, 'wizard.role.ledResistor');
    const ledh = w.vpart('diodes/led-red', 'LED1', 640, 290);
    w.wire(w.pin(r3, '2'), w.pin(ledh, 'A'));
    w.gnd(640, 350);
  } else {
    w.wire(w.pin(u1, 'OUT'), p(600, 290));
    w.resistor('RL', 10e3, { x: 600, y: 290 }, true, 'wizard.role.load');
    w.gnd(600, 350);
  }
  w.label('OUT', 520, 290);
  addScope(w, spec.vcc, 1 / timing.freq);

  const T = 1 / timing.freq;
  const explain: WizardText[] = [
    { key: 'wizard.555.explainThresholds', params: { lo: num(spec.vcc / 3, 3), hi: num((2 * spec.vcc) / 3, 3) } },
    diode
      ? { key: 'wizard.555.explainDiode', params: { r1: valueText(r1), c: valueText(c), k: num(timing.tH / (r1 * c), 3), th: eng(timing.tH, 's', 3), vd: num(diodeDrop(spec.vcc / 2 / r1), 2) } }
      : { key: 'wizard.555.explainHigh', params: { r1: valueText(r1), r2: valueText(r2), c: valueText(c), th: eng(timing.tH, 's', 3) } },
    { key: 'wizard.555.explainLow', params: { r2: valueText(r2), c: valueText(c), tl: eng(timing.tL, 's', 3) } },
    { key: 'wizard.555.explainFreq', params: { f: eng(timing.freq, 'Hz', 4), duty: num(timing.duty * 100, 3) } },
    { key: 'wizard.555.explainCap', params: { c: valueText(c) } },
  ];
  const warnings: WizardText[] = [];
  if (led && spec.freq > 20) warnings.push({ key: 'wizard.555.warnLedFast' });
  if (Math.abs(timing.freq / spec.freq - 1) > 0.05) warnings.push({ key: 'wizard.warnRounding', params: { pct: num(Math.abs(timing.freq / spec.freq - 1) * 100, 2) } });
  d.description = `${eng(timing.freq, 'Hz', 4)}, ${num(timing.duty * 100, 3)} %`;
  w.noteText(60, 660, 'wizard.555.noteAstable', { f: eng(timing.freq, 'Hz', 3), th: eng(timing.tH, 's', 3), tl: eng(timing.tL, 's', 3) });
  const tstep = T / 200;
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep, tstop: 12 * T, tmax: T / 100 },
  ]);
  return {
    design: d,
    parts: w.parts,
    predicted: [
      { label: 'wizard.fig.freq', value: timing.freq, unit: 'Hz', target: spec.freq },
      { label: 'wizard.fig.duty', value: timing.duty * 100, unit: '%', target: spec.duty * 100 },
      { label: 'wizard.fig.tHigh', value: timing.tH, unit: 's' },
      { label: 'wizard.fig.tLow', value: timing.tL, unit: 's' },
    ],
    explain,
    warnings,
  };
}

/** Pulse width of the monostable with the given parts. */
export function monostableWidth(r: number, c: number): number {
  return LN3 * r * c;
}

/** 555 monostable (one-shot) triggered by a pulse source. */
export function design555Monostable(spec: Monostable555Spec): WizardResult {
  if (!(spec.width >= 10e-6 && spec.width <= 1000)) throw new WizardInputError('wizard.555.errWidth');
  const rounding = validateCommon(spec.vcc, spec.rounding);
  let c = spec.cap;
  let rRaw: number;
  if (c !== undefined) rRaw = spec.width / (LN3 * c);
  else {
    let best: [number, number] | null = null;
    let score = Infinity;
    for (const cc of seriesValues('E6', 100e-12, 1000e-6)) {
      const r = spec.width / (LN3 * cc);
      if (!(r >= R_MIN && r <= R_MAX)) continue;
      const s = Math.abs(Math.log(r / 47e3));
      if (s < score) {
        score = s;
        best = [cc, r];
      }
    }
    if (!best) throw new WizardInputError('wizard.555.errNoCap');
    [c, rRaw] = best;
  }
  if (!(rRaw >= R_MIN && rRaw <= R_MAX)) throw new WizardInputError('wizard.555.errResistorRange', { r: valueText(rRaw, 3) });
  const r = roundValue(rRaw, rounding);
  const width = monostableWidth(r, c);
  const period = spec.triggerPeriod ?? 3 * spec.width;
  if (!(period > width * 1.2)) throw new WizardInputError('wizard.555.errTriggerPeriod');

  const w = new WizardSheet(`555 monostable ${eng(spec.width, 's', 3)}`);
  const d: Design = w.design;
  const u1 = place555(w, spec.vcc);
  const r1 = w.resistor('R1', r, { x: 480, y: 190 }, true, 'wizard.role.555rMono');
  w.wire(w.pin(r1, '1'), p(480, 160));
  w.wire(w.pin(r1, '2'), p(480, 500), p(300, 500));
  w.wire(w.pin(u1, 'DIS'), p(480, 310));
  const c1 = w.b.part(capPart(c), 'C1', 300, 550, { value: valueText(c) }, { rotation: 90 });
  w.record('C1', valueText(c), 'wizard.role.555c');
  w.wire(w.pin(u1, 'THR'), p(300, 300), w.pin(c1, capPart(c) === 'basic/electrolytic' ? '+' : '1'));
  w.wire(w.pin(c1, capPart(c) === 'basic/electrolytic' ? '-' : '2'), p(300, 600));
  w.gnd(300, 600);
  w.label('THR', 300, 420);
  // trigger: idle high, short low pulses
  const trigWidth = Math.min(width / 10, period / 20);
  const vt = w.b.part('sources/pulse-voltage', 'V1', 180, 310, {
    v1: valueText(spec.vcc),
    v2: '0',
    delay: valueText(period / 6),
    rise: valueText(Math.max(1e-9, trigWidth / 100)),
    fall: valueText(Math.max(1e-9, trigWidth / 100)),
    width: valueText(trigWidth),
    period: valueText(period),
  });
  w.record('V1', `${eng(trigWidth, 's', 2)} / ${eng(period, 's', 3)}`, 'wizard.role.trigger');
  w.wire(w.pin(vt, '+'), w.pin(u1, 'TRIG'));
  w.gnd(180, 340);
  w.label('TRIG', 240, 280);
  w.wire(w.pin(u1, 'OUT'), p(600, 290));
  w.resistor('RL', 10e3, { x: 600, y: 290 }, true, 'wizard.role.load');
  w.gnd(600, 350);
  w.label('OUT', 520, 290);
  addScope(w, spec.vcc, period);

  const explain: WizardText[] = [
    { key: 'wizard.555.explainMonoTrigger', params: { lo: num(spec.vcc / 3, 3) } },
    { key: 'wizard.555.explainMonoWidth', params: { r: valueText(r), c: valueText(c), t: eng(width, 's', 4) } },
    { key: 'wizard.555.explainMonoTrigSource', params: { w: eng(trigWidth, 's', 2), p: eng(period, 's', 3) } },
  ];
  const warnings: WizardText[] = [];
  if (Math.abs(width / spec.width - 1) > 0.05) warnings.push({ key: 'wizard.warnRounding', params: { pct: num(Math.abs(width / spec.width - 1) * 100, 2) } });
  d.description = eng(width, 's', 4);
  w.noteText(60, 660, 'wizard.555.noteMono', { t: eng(width, 's', 3) });
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep: period / 400, tstop: 3.2 * period, tmax: Math.min(trigWidth / 4, period / 200) },
  ]);
  return {
    design: d,
    parts: w.parts,
    predicted: [
      { label: 'wizard.fig.width', value: width, unit: 's', target: spec.width },
      { label: 'wizard.fig.trigPeriod', value: period, unit: 's' },
    ],
    explain,
    warnings,
  };
}
