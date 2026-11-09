/**
 * Filter wizard: low-pass, high-pass, band-pass and band-stop filters with a Butterworth or
 * Chebyshev (type I) response, realised as a passive doubly terminated LC ladder or as an active
 * cascade of second-order sections. The order is computed from the specification (filterMath.ts)
 * unless the learner fixes it.
 *
 * Realisations (textbook topologies; component formulas derived by nodal analysis, see each cell):
 *   passive      LC ladder, shunt element first; prototype g-values transformed per element
 *                (LP: C/L, HP: L/C, BP: parallel / series LC, BS: series / parallel LC).
 *   sallen-key   unity-gain Sallen-Key sections (LP / HP) plus an RC + follower section for an odd
 *                order, and a non-inverting gain stage (or divider + follower) for the gain.
 *   mfb          multiple-feedback sections (inverting, gain set by component ratios).
 *   band-pass    (active) multiple-feedback band-pass sections, one per pole pair.
 *   band-stop    (active) state-variable (KHN) notch sections: summer, two integrators and an
 *                output summer adding the high-pass and low-pass outputs (zero at the centre).
 *
 * Every wizard result carries `response(f)`, the predicted V(OUT)/V(IN) computed from the ACTUAL
 * (rounded) component values, so the tests compare the simulator with this prediction and with
 * the specification.
 */
import type { ESeriesName } from '../../library/types';
import { nearestSeriesValue } from '../../library/series';
import type { PartHandle } from '../designkit';
import {
  bandEdges,
  cabs,
  cadd,
  cdiv,
  cmul,
  cx,
  filterOrder,
  filterSections,
  ladderValues,
  protoScale,
  prototypePoles,
  referenceGain,
  sectionResponse,
  stopbandRatio,
  type Cx,
  type FilterResponse,
  type FilterType,
  type Section,
} from './filterMath';
import { WizardInputError, WizardSheet, eng, fitPaper, num, p, roundValue, seriesAtLeast, setAnalyses, valueText, type Rounding, type WizardResult, type WizardText } from './common';
import type { MessageKey } from '../../i18n';

export type FilterTopology = 'passive' | 'sallen-key' | 'mfb';
export type FilterOpamp = 'ideal' | 'tl081' | 'lm741' | 'ne5532' | 'op07';

export interface FilterSpec {
  type: FilterType;
  response: FilterResponse;
  topology: FilterTopology;
  /** low-pass / high-pass: pass-band edge and stop-band edge (Hz) */
  fp?: number;
  fs?: number;
  /** band filters: geometric centre (Hz), width between the Ap edges and between the As edges (Hz) */
  f0?: number;
  bw?: number;
  bws?: number;
  /** pass-band edge attenuation / Chebyshev ripple (dB) */
  ap: number;
  /** minimum stop-band attenuation (dB) */
  as: number;
  /** fixed prototype order (overrides the computed one) */
  order?: number;
  /** active: peak pass-band gain (V/V), default 1 */
  gain?: number;
  /** passive: source and load resistance (Ω, default 1 kΩ); active: resistor level (default 10 kΩ) */
  r?: number;
  /** rounding of resistors (active, default E96) or of L and C (passive, default exact) */
  rounding?: Rounding;
  /** capacitor series of the active designs (default E12) */
  capSeries?: ESeriesName;
  opamp?: FilterOpamp;
  /** supply of a real op-amp (±V, default 15) */
  supply?: number;
}

export interface FilterDesignResult extends WizardResult {
  /** prototype order n (band filters have order 2n) */
  order: number;
  sections: Section[];
  /** predicted V(OUT)/V(IN) with the chosen part values */
  response(f: number): Cx;
  /** largest pass-band |H| of the prediction */
  peakGain: number;
  /** pass-band edges (Hz, where the attenuation is Ap) and stop-band edges (As) */
  edges: { pass: number[]; stop: number[] };
}

export const MAX_PASSIVE_ORDER = 10;
export const MAX_ACTIVE_ORDER = 8;

const OPAMP_PART: Record<FilterOpamp, string> = {
  ideal: 'analog/opamp-ideal-3',
  tl081: 'analog/tl081',
  lm741: 'analog/lm741',
  ne5532: 'analog/ne5532',
  op07: 'analog/op07',
};

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------------------------
// validation and order

function check(spec: FilterSpec): { omegaS: number; n: number } {
  const { type } = spec;
  if (!(spec.ap > 0 && spec.ap < 10)) throw new WizardInputError('wizard.filter.errAp');
  if (!(spec.as > spec.ap && spec.as <= 120)) throw new WizardInputError('wizard.filter.errAs');
  if (type === 'lowpass' || type === 'highpass') {
    if (!(spec.fp! > 0 && spec.fs! > 0)) throw new WizardInputError('wizard.filter.errFreq');
    if (type === 'lowpass' && !(spec.fs! > spec.fp!)) throw new WizardInputError('wizard.filter.errLowpassEdges');
    if (type === 'highpass' && !(spec.fs! < spec.fp!)) throw new WizardInputError('wizard.filter.errHighpassEdges');
  } else {
    if (!(spec.f0! > 0 && spec.bw! > 0 && spec.bws! > 0)) throw new WizardInputError('wizard.filter.errFreq');
    if (spec.bw! > 1.5 * spec.f0! || spec.bws! > 1.5 * spec.f0! * (type === 'bandpass' ? 2 : 1)) throw new WizardInputError('wizard.filter.errWide');
    if (type === 'bandpass' && !(spec.bws! > spec.bw!)) throw new WizardInputError('wizard.filter.errBandpassEdges');
    if (type === 'bandstop' && !(spec.bws! < spec.bw!)) throw new WizardInputError('wizard.filter.errBandstopEdges');
  }
  const omegaS = stopbandRatio(type, spec);
  const max = spec.topology === 'passive' ? MAX_PASSIVE_ORDER : type === 'bandpass' || type === 'bandstop' ? MAX_ACTIVE_ORDER / 2 : MAX_ACTIVE_ORDER;
  let n = spec.order ?? filterOrder(spec.response, spec.ap, spec.as, omegaS);
  if (!Number.isFinite(n)) throw new WizardInputError('wizard.filter.errFreq');
  n = Math.round(n);
  if (n < 1) throw new WizardInputError('wizard.filter.errOrder', { max });
  if (n > max) throw new WizardInputError('wizard.filter.errOrderHigh', { n, max });
  return { omegaS, n };
}

// ---------------------------------------------------------------------------------------------
// shared layout context

interface Ctx {
  w: WizardSheet;
  rounding: Rounding;
  capSeries: ESeriesName;
  r0: number;
  opamp: string;
  realOpamp: boolean;
  /** section number shown in the part roles */
  stage: number;
}

function placeOpamp(c: Ctx, x: number, y: number): PartHandle {
  const ref = c.w.ref('U');
  const h = c.w.b.part(c.opamp, ref, x, y);
  if (c.realOpamp) {
    c.w.b.labelPin(h, 'V+', 'VCC');
    c.w.b.labelPin(h, 'V-', 'VEE');
  }
  return h;
}

const R = (c: Ctx, v: number) => roundValue(v, c.rounding);
const C = (c: Ctx, v: number) => nearestSeriesValue(c.capSeries, v);

type Kind = 'R' | 'C' | 'L';

/** Place a two-terminal part of a kind at a position (vertical: first pin on top). */
function part2(c: Ctx, kind: Kind, value: number, x: number, y: number, vertical: boolean, role: MessageKey): void {
  const ref = c.w.ref(kind);
  const params = { stage: c.stage };
  if (kind === 'R') c.w.resistor(ref, value, { x, y }, vertical, role, params);
  else if (kind === 'C') c.w.capacitor(ref, value, { x, y }, vertical, role, params);
  else c.w.inductor(ref, value, { x, y }, vertical, role, params);
}

interface Cell {
  xEnd: number;
  h: (w: number) => Cx;
}

/** Unity-gain Sallen-Key second-order section (LP: R R / C fb, C gnd; HP: C C / R fb, R gnd). */
function cellSallenKey(c: Ctx, x0: number, y0: number, sec: Section): Cell {
  const { w0, q } = sec;
  const lp = sec.kind === 'lowpass';
  let r1: number, r2: number, c1: number, c2: number;
  if (lp) {
    // H = 1/(s²R1R2C1C2 + s·C2(R1+R2) + 1); C1 >= 4Q²C2 makes R1, R2 real
    c2 = C(c, 1 / (2 * q * w0 * c.r0));
    c1 = seriesAtLeast(4 * q * q * c2 * 1.02, c.capSeries);
    const S = 1 / (w0 * c2 * q);
    const P = 1 / (w0 * w0 * c1 * c2);
    const d = Math.sqrt(Math.max(0, S * S - 4 * P));
    r1 = R(c, (S + d) / 2);
    r2 = R(c, (S - d) / 2);
  } else {
    // H = s²/(s² + s(C1+C2)/(R2C1C2) + 1/(R1R2C1C2)); C1 = C2 = C
    c1 = C(c, 1 / (w0 * c.r0));
    c2 = c1;
    r2 = R(c, (2 * q) / (w0 * c1));
    r1 = R(c, 1 / (2 * q * w0 * c1));
  }
  const ser: Kind = lp ? 'R' : 'C';
  const sh: Kind = lp ? 'C' : 'R';
  part2(c, ser, lp ? r1 : c1, x0, y0, false, 'wizard.role.filterSeries');
  c.w.wire(p(x0 + 60, y0), p(x0 + 80, y0));
  c.w.wire(p(x0 + 80, y0), p(x0 + 100, y0));
  part2(c, ser, lp ? r2 : c2, x0 + 100, y0, false, 'wizard.role.filterSeries');
  c.w.wire(p(x0 + 160, y0), p(x0 + 180, y0));
  c.w.wire(p(x0 + 180, y0), p(x0 + 200, y0));
  part2(c, sh, lp ? c2 : r2, x0 + 180, y0, true, 'wizard.role.filterShunt');
  c.w.gnd(x0 + 180, y0 + 60);
  part2(c, sh, lp ? c1 : r1, x0 + 80, y0 - 60, true, 'wizard.role.filterFeedback');
  placeOpamp(c, x0 + 240, y0 - 10);
  c.w.wire(p(x0 + 80, y0 - 60), p(x0 + 80, y0 - 110), p(x0 + 300, y0 - 110), p(x0 + 300, y0 - 10));
  c.w.wire(p(x0 + 280, y0 - 10), p(x0 + 320, y0 - 10), p(x0 + 320, y0));
  c.w.wire(p(x0 + 200, y0 - 20), p(x0 + 190, y0 - 20), p(x0 + 190, y0 - 80), p(x0 + 300, y0 - 80));
  const h = lp
    ? (w: number) => cdiv(cx(1), cadd(cx(1 - w * w * r1 * r2 * c1 * c2), cx(0, w * c2 * (r1 + r2))))
    : (w: number) => {
        const s2 = -w * w;
        return cdiv(cx(s2), cadd(cx(s2 + 1 / (r1 * r2 * c1 * c2)), cx(0, (w * (c1 + c2)) / (r2 * c1 * c2))));
      };
  return { xEnd: x0 + 320, h };
}

/** RC (or divider) section buffered by a voltage follower: series element then shunt element. */
function cellBuffered(c: Ctx, x0: number, y0: number, ser: { kind: Kind; v: number; role: MessageKey }, sh: { kind: Kind; v: number; role: MessageKey }, h: (w: number) => Cx): Cell {
  part2(c, ser.kind, ser.v, x0, y0, false, ser.role);
  c.w.wire(p(x0 + 60, y0), p(x0 + 100, y0));
  c.w.wire(p(x0 + 100, y0), p(x0 + 160, y0));
  part2(c, sh.kind, sh.v, x0 + 100, y0, true, sh.role);
  c.w.gnd(x0 + 100, y0 + 60);
  placeOpamp(c, x0 + 200, y0 - 10);
  c.w.wire(p(x0 + 240, y0 - 10), p(x0 + 280, y0 - 10), p(x0 + 280, y0));
  c.w.wire(p(x0 + 160, y0 - 20), p(x0 + 150, y0 - 20), p(x0 + 150, y0 - 70), p(x0 + 260, y0 - 70), p(x0 + 260, y0 - 10));
  return { xEnd: x0 + 280, h };
}

function cellFirstOrderSk(c: Ctx, x0: number, y0: number, sec: Section): Cell {
  const cap = C(c, 1 / (sec.w0 * c.r0));
  const res = R(c, 1 / (sec.w0 * cap));
  const tau = res * cap;
  if (sec.kind === 'lowpass') {
    return cellBuffered(c, x0, y0, { kind: 'R', v: res, role: 'wizard.role.filterSeries' }, { kind: 'C', v: cap, role: 'wizard.role.filterShunt' }, (w) => cdiv(cx(1), cx(1, w * tau)));
  }
  return cellBuffered(c, x0, y0, { kind: 'C', v: cap, role: 'wizard.role.filterSeries' }, { kind: 'R', v: res, role: 'wizard.role.filterShunt' }, (w) => cdiv(cx(0, w * tau), cx(1, w * tau)));
}

/** Non-inverting gain stage 1 + Rf/Rg. */
function cellGain(c: Ctx, x0: number, y0: number, k: number): Cell {
  const rg = R(c, c.r0);
  const rf = R(c, c.r0 * (k - 1));
  c.w.wire(p(x0, y0), p(x0 + 80, y0));
  placeOpamp(c, x0 + 120, y0 - 10);
  c.w.wire(p(x0 + 80, y0 - 20), p(x0 + 60, y0 - 20), p(x0 + 60, y0 - 90));
  part2(c, 'R', rg, x0, y0 - 90, false, 'wizard.role.gainRg');
  c.w.gnd(x0, y0 - 90);
  c.w.wire(p(x0 + 60, y0 - 90), p(x0 + 80, y0 - 90));
  part2(c, 'R', rf, x0 + 80, y0 - 90, false, 'wizard.role.gainRf');
  c.w.wire(p(x0 + 140, y0 - 90), p(x0 + 180, y0 - 90), p(x0 + 180, y0 - 10));
  c.w.wire(p(x0 + 160, y0 - 10), p(x0 + 200, y0 - 10), p(x0 + 200, y0));
  return { xEnd: x0 + 200, h: () => cx(1 + rf / rg) };
}

/** Divider + follower (gain below 1). */
function cellAttenuator(c: Ctx, x0: number, y0: number, k: number): Cell {
  const rb = R(c, c.r0);
  const ra = R(c, c.r0 * (1 / k - 1));
  return cellBuffered(c, x0, y0, { kind: 'R', v: ra, role: 'wizard.role.dividerTop' }, { kind: 'R', v: rb, role: 'wizard.role.dividerBottom' }, () => cx(rb / (ra + rb)));
}

interface MfbParts {
  series1: { kind: Kind; v: number; role: MessageKey };
  /** series element A -> J, or null for a plain wire */
  series2: { kind: Kind; v: number; role: MessageKey } | null;
  gndA: { kind: Kind; v: number; role: MessageKey } | null;
  fbA: { kind: Kind; v: number; role: MessageKey } | null;
  fbJ: { kind: Kind; v: number; role: MessageKey };
}

/**
 * Multiple-feedback layout: series1 into node A, series2 from A to the inverting input J, an
 * element from A to ground, feedback from A and from J to the output; non-inverting input grounded.
 */
function layoutMfb(c: Ctx, x0: number, y0: number, m: MfbParts): number {
  part2(c, m.series1.kind, m.series1.v, x0, y0, false, m.series1.role);
  c.w.wire(p(x0 + 60, y0), p(x0 + 80, y0));
  if (m.series2) {
    c.w.wire(p(x0 + 80, y0), p(x0 + 100, y0));
    part2(c, m.series2.kind, m.series2.v, x0 + 100, y0, false, m.series2.role);
    c.w.wire(p(x0 + 160, y0), p(x0 + 180, y0));
  } else {
    c.w.wire(p(x0 + 80, y0), p(x0 + 180, y0));
  }
  c.w.wire(p(x0 + 180, y0), p(x0 + 220, y0));
  if (m.gndA) {
    part2(c, m.gndA.kind, m.gndA.v, x0 + 80, y0, true, m.gndA.role);
    c.w.gnd(x0 + 80, y0 + 60);
  }
  placeOpamp(c, x0 + 260, y0 + 10);
  c.w.wire(p(x0 + 300, y0 + 10), p(x0 + 340, y0 + 10), p(x0 + 340, y0));
  if (m.fbA) {
    part2(c, m.fbA.kind, m.fbA.v, x0 + 80, y0 - 60, true, m.fbA.role);
    c.w.wire(p(x0 + 80, y0 - 60), p(x0 + 80, y0 - 110), p(x0 + 330, y0 - 110), p(x0 + 330, y0 + 10));
    part2(c, m.fbJ.kind, m.fbJ.v, x0 + 180, y0 - 60, true, m.fbJ.role);
    c.w.wire(p(x0 + 180, y0 - 60), p(x0 + 180, y0 - 80), p(x0 + 330, y0 - 80));
  } else {
    part2(c, m.fbJ.kind, m.fbJ.v, x0 + 180, y0 - 60, true, m.fbJ.role);
    c.w.wire(p(x0 + 180, y0 - 60), p(x0 + 180, y0 - 80), p(x0 + 330, y0 - 80), p(x0 + 330, y0 + 10));
  }
  c.w.wire(p(x0 + 220, y0 + 20), p(x0 + 210, y0 + 20), p(x0 + 210, y0 + 50));
  c.w.gnd(x0 + 210, y0 + 50);
  return x0 + 340;
}

/** Multiple-feedback low-pass / high-pass second-order section with gain k (inverting). */
function cellMfb2(c: Ctx, x0: number, y0: number, sec: Section, k: number): Cell {
  const { w0, q } = sec;
  if (sec.kind === 'lowpass') {
    // H = −(1/(R1R3C1C2)) / (s² + s(1/C2)(1/R1 + 1/R2 + 1/R3) + 1/(R2R3C1C2)); C1 = J→OUT, C2 = A→gnd
    const c1 = C(c, 1 / (2 * q * w0 * c.r0));
    const c2 = seriesAtLeast(4 * q * q * (1 + k) * c1 * 1.02, c.capSeries);
    const a = w0 * c2;
    const disc = Math.sqrt(Math.max(0, (a * a) / (q * q) - 4 * (1 + k) * w0 * w0 * c1 * c2));
    const roots = [(a / q + disc) / (2 * (1 + k)), (a / q - disc) / (2 * (1 + k))].filter((g) => g > 0);
    // conductance of R2: the root whose resistors sit closest to the resistor level
    const g2 = roots.reduce((best, g) => (Math.abs(Math.log(1 / g / c.r0)) < Math.abs(Math.log(1 / best / c.r0)) ? g : best));
    const r2 = R(c, 1 / g2);
    const r1 = R(c, 1 / g2 / k);
    const r3 = R(c, g2 / (w0 * w0 * c1 * c2));
    const xEnd = layoutMfb(c, x0, y0, {
      series1: { kind: 'R', v: r1, role: 'wizard.role.filterInput' },
      series2: { kind: 'R', v: r3, role: 'wizard.role.filterSeries' },
      gndA: { kind: 'C', v: c2, role: 'wizard.role.filterShunt' },
      fbA: { kind: 'R', v: r2, role: 'wizard.role.filterFeedback' },
      fbJ: { kind: 'C', v: c1, role: 'wizard.role.filterFeedback' },
    });
    const h = (w: number) => cdiv(cx(-1 / (r1 * r3 * c1 * c2)), cadd(cx(1 / (r2 * r3 * c1 * c2) - w * w), cx(0, (w / c2) * (1 / r1 + 1 / r2 + 1 / r3))));
    return { xEnd, h };
  }
  // H = −(Ci/C2)s² / (s² + s(Ci + C2 + C3)/(R2C2C3) + 1/(R1R2C2C3)); Ci = C3 = C, C2 = C/k
  const cap = C(c, 1 / (w0 * c.r0));
  const c2 = C(c, cap / k);
  const r2 = R(c, (q * (2 * cap + c2)) / (w0 * c2 * cap));
  const r1 = R(c, 1 / (w0 * w0 * r2 * c2 * cap));
  const xEnd = layoutMfb(c, x0, y0, {
    series1: { kind: 'C', v: cap, role: 'wizard.role.filterInput' },
    series2: { kind: 'C', v: cap, role: 'wizard.role.filterSeries' },
    gndA: { kind: 'R', v: r1, role: 'wizard.role.filterShunt' },
    fbA: { kind: 'C', v: c2, role: 'wizard.role.filterFeedback' },
    fbJ: { kind: 'R', v: r2, role: 'wizard.role.filterFeedback' },
  });
  const h = (w: number) => {
    const s2 = -w * w;
    return cdiv(cx((-cap / c2) * s2), cadd(cx(s2 + 1 / (r1 * r2 * c2 * cap)), cx(0, (w * (2 * cap + c2)) / (r2 * c2 * cap))));
  };
  return { xEnd, h };
}

/** Multiple-feedback first-order section with gain k (inverting). */
function cellMfb1(c: Ctx, x0: number, y0: number, sec: Section, k: number): Cell {
  const cap = C(c, 1 / (sec.w0 * c.r0));
  if (sec.kind === 'lowpass') {
    // H = −(R2/R1)/(1 + sR2C), feedback R2 ∥ C
    const r2 = R(c, 1 / (sec.w0 * cap));
    const r1 = R(c, r2 / k);
    const xEnd = layoutMfb(c, x0, y0, {
      series1: { kind: 'R', v: r1, role: 'wizard.role.filterInput' },
      series2: null,
      gndA: null,
      fbA: { kind: 'C', v: cap, role: 'wizard.role.filterFeedback' },
      fbJ: { kind: 'R', v: r2, role: 'wizard.role.filterFeedback' },
    });
    return { xEnd, h: (w) => cdiv(cx(-r2 / r1), cx(1, w * r2 * cap)) };
  }
  // H = −sR2C1/(1 + sR1C1): series R1 + C1 input, feedback R2
  const r1 = R(c, 1 / (sec.w0 * cap));
  const r2 = R(c, k * r1);
  const xEnd = layoutMfb(c, x0, y0, {
    series1: { kind: 'R', v: r1, role: 'wizard.role.filterInput' },
    series2: { kind: 'C', v: cap, role: 'wizard.role.filterSeries' },
    gndA: null,
    fbA: null,
    fbJ: { kind: 'R', v: r2, role: 'wizard.role.filterFeedback' },
  });
  return { xEnd, h: (w) => cdiv(cx(0, -w * r2 * cap), cx(1, w * r1 * cap)) };
}

/** Multiple-feedback band-pass section with centre gain k (needs k < 2Q²). */
function cellMfbBandpass(c: Ctx, x0: number, y0: number, sec: Section, k: number): Cell {
  // H = −(s/(R1C1)) / (s² + s(C1 + C2)/(R3C1C2) + (1/R1 + 1/R2)/(R3C1C2)), C1 = C2 = C
  const { w0, q } = sec;
  const cap = C(c, 1 / (w0 * c.r0));
  const r3 = R(c, (2 * q) / (w0 * cap));
  const r1 = R(c, q / (w0 * cap * k));
  const r2 = R(c, q / (w0 * cap * (2 * q * q - k)));
  const xEnd = layoutMfb(c, x0, y0, {
    series1: { kind: 'R', v: r1, role: 'wizard.role.filterInput' },
    series2: { kind: 'C', v: cap, role: 'wizard.role.filterSeries' },
    gndA: { kind: 'R', v: r2, role: 'wizard.role.filterShunt' },
    fbA: { kind: 'C', v: cap, role: 'wizard.role.filterFeedback' },
    fbJ: { kind: 'R', v: r3, role: 'wizard.role.filterFeedback' },
  });
  const h = (w: number) => cdiv(cx(0, -w / (r1 * cap)), cadd(cx((1 / r1 + 1 / r2) / (r3 * cap * cap) - w * w), cx(0, (2 * w) / (r3 * cap))));
  return { xEnd, h };
}

/**
 * State-variable (KHN) notch section: A1 sums −a·Vin − LP + (1/Q)·BP into HP, two inverting
 * integrators (RC = 1/ωp) give BP and LP, A4 outputs −(HP + m·LP), m = (ωz/ωp)², i.e.
 * H = a·(s² + ωz²)/(s² + (ωp/Q)s + ωp²). Internal nodes are joined by net labels N<k>_HP/BP/LP.
 */
function cellNotch(c: Ctx, x0: number, y0: number, sec: Section, a: number, index: number): Cell {
  const { w0: wp, q } = sec;
  const wz = sec.wz ?? wp;
  const m = (wz / wp) ** 2;
  if (!(q * (2 + a) > 1.05)) throw new WizardInputError('wizard.filter.errNotchQ');
  const r0 = R(c, c.r0);
  const rin = R(c, c.r0 / a);
  const rf = r0;
  const rlp = r0;
  const rq2 = r0;
  const rq1 = R(c, c.r0 * (q * (2 + a) - 1));
  const capI = C(c, 1 / (wp * c.r0));
  const ri = R(c, 1 / (wp * capI));
  const r4a = r0;
  const r4f = r0;
  const r4b = R(c, c.r0 / m);
  const HP = `N${index}_HP`;
  const BP = `N${index}_BP`;
  const LP = `N${index}_LP`;
  const w = c.w;
  // A1: input summer
  part2(c, 'R', rin, x0, y0, false, 'wizard.role.filterInput');
  w.wire(p(x0 + 60, y0), p(x0 + 80, y0));
  w.wire(p(x0 + 80, y0), p(x0 + 120, y0));
  part2(c, 'R', rf, x0 + 80, y0 - 60, true, 'wizard.role.filterFeedback');
  part2(c, 'R', rlp, x0 + 80, y0, true, 'wizard.role.notchLp');
  w.label(LP, x0 + 80, y0 + 60);
  placeOpamp(c, x0 + 160, y0 + 10);
  w.wire(p(x0 + 120, y0 + 20), p(x0 + 110, y0 + 20), p(x0 + 110, y0 + 70));
  part2(c, 'R', rq2, x0 + 110, y0 + 70, true, 'wizard.role.notchQ');
  w.gnd(x0 + 110, y0 + 130);
  part2(c, 'R', rq1, x0 + 110, y0 + 70, false, 'wizard.role.notchQ');
  w.label(BP, x0 + 170, y0 + 70);
  w.wire(p(x0 + 80, y0 - 60), p(x0 + 80, y0 - 80), p(x0 + 220, y0 - 80), p(x0 + 220, y0 + 10));
  w.wire(p(x0 + 200, y0 + 10), p(x0 + 240, y0 + 10));
  w.label(HP, x0 + 240, y0 + 10);
  // A2: integrator HP -> BP
  part2(c, 'R', ri, x0 + 240, y0 + 10, false, 'wizard.role.integratorR');
  w.wire(p(x0 + 300, y0 + 10), p(x0 + 320, y0 + 10));
  part2(c, 'C', capI, x0 + 300, y0 - 50, true, 'wizard.role.integratorC');
  placeOpamp(c, x0 + 360, y0 + 20);
  w.wire(p(x0 + 300, y0 - 50), p(x0 + 420, y0 - 50), p(x0 + 420, y0 + 20));
  w.wire(p(x0 + 320, y0 + 30), p(x0 + 310, y0 + 30), p(x0 + 310, y0 + 60));
  w.gnd(x0 + 310, y0 + 60);
  w.wire(p(x0 + 400, y0 + 20), p(x0 + 440, y0 + 20));
  w.label(BP, x0 + 440, y0 + 20);
  // A3: integrator BP -> LP
  part2(c, 'R', ri, x0 + 440, y0 + 20, false, 'wizard.role.integratorR');
  w.wire(p(x0 + 500, y0 + 20), p(x0 + 520, y0 + 20));
  part2(c, 'C', capI, x0 + 500, y0 - 40, true, 'wizard.role.integratorC');
  placeOpamp(c, x0 + 560, y0 + 30);
  w.wire(p(x0 + 500, y0 - 40), p(x0 + 620, y0 - 40), p(x0 + 620, y0 + 30));
  w.wire(p(x0 + 520, y0 + 40), p(x0 + 510, y0 + 40), p(x0 + 510, y0 + 70));
  w.gnd(x0 + 510, y0 + 70);
  w.wire(p(x0 + 600, y0 + 30), p(x0 + 640, y0 + 30));
  w.label(LP, x0 + 640, y0 + 30);
  // A4: output summer −(HP + m·LP)
  part2(c, 'R', r4b, x0 + 640, y0 + 30, false, 'wizard.role.notchMix');
  w.wire(p(x0 + 700, y0 + 30), p(x0 + 720, y0 + 30));
  w.wire(p(x0 + 720, y0 + 30), p(x0 + 740, y0 + 30));
  part2(c, 'R', r4a, x0 + 720, y0 + 30, true, 'wizard.role.notchMix');
  w.label(HP, x0 + 720, y0 + 90);
  part2(c, 'R', r4f, x0 + 720, y0 - 30, true, 'wizard.role.filterFeedback');
  placeOpamp(c, x0 + 780, y0 + 40);
  w.wire(p(x0 + 720, y0 - 30), p(x0 + 720, y0 - 50), p(x0 + 840, y0 - 50), p(x0 + 840, y0 + 40));
  w.wire(p(x0 + 740, y0 + 50), p(x0 + 740, y0 + 100));
  w.gnd(x0 + 740, y0 + 100);
  w.wire(p(x0 + 820, y0 + 40), p(x0 + 860, y0 + 40), p(x0 + 860, y0));
  const cin = rf / rin;
  const clp = rf / rlp;
  const par = (rin * rlp) / (rin + rlp);
  const cbp = (1 + rf / par) * (rq2 / (rq1 + rq2));
  const tau = ri * capI;
  const ka = r4f / r4a;
  const kb = r4f / r4b;
  const h = (wv: number) => {
    const s2t = -wv * wv * tau * tau;
    return cdiv(cx(cin * (ka * s2t + kb)), cadd(cx(s2t + clp), cx(0, cbp * wv * tau)));
  };
  return { xEnd: x0 + 860, h };
}

// ---------------------------------------------------------------------------------------------
// passive ladder

interface LadderElement {
  /** shunt (to ground) or series (in the signal path) */
  position: 'shunt' | 'series';
  /** single part, series LC or parallel LC */
  form: 'single' | 'seriesLC' | 'parallelLC';
  kind?: 'L' | 'C';
  l?: number;
  c?: number;
}

function ladderElements(type: FilterType, g: number[], r: number, wc: number, w0: number, round: (v: number) => number): LadderElement[] {
  return g.map((gk, i) => {
    const shunt = i % 2 === 0;
    const position = shunt ? 'shunt' : 'series';
    switch (type) {
      case 'lowpass':
        return shunt ? { position, form: 'single', kind: 'C', c: round(gk / (r * wc)) } : { position, form: 'single', kind: 'L', l: round((gk * r) / wc) };
      case 'highpass':
        return shunt ? { position, form: 'single', kind: 'L', l: round(r / (gk * wc)) } : { position, form: 'single', kind: 'C', c: round(1 / (gk * r * wc)) };
      case 'bandpass':
        return shunt
          ? { position, form: 'parallelLC', c: round(gk / (r * wc)), l: round((r * wc) / (gk * w0 * w0)) }
          : { position, form: 'seriesLC', l: round((gk * r) / wc), c: round(wc / (gk * r * w0 * w0)) };
      case 'bandstop':
        return shunt
          ? { position, form: 'seriesLC', l: round(r / (gk * wc)), c: round((gk * wc) / (r * w0 * w0)) }
          : { position, form: 'parallelLC', l: round((gk * r * wc) / (w0 * w0)), c: round(1 / (gk * r * wc)) };
    }
  });
}

/** Impedance of an element at angular frequency w. */
function elementZ(e: LadderElement, w: number): Cx {
  const zl = (l: number) => cx(0, w * l);
  const zc = (c: number) => cx(0, -1 / (w * c));
  if (e.form === 'single') return e.kind === 'L' ? zl(e.l!) : zc(e.c!);
  if (e.form === 'seriesLC') return cadd(zl(e.l!), zc(e.c!));
  const a = zl(e.l!);
  const b = zc(e.c!);
  return cdiv(cmul(a, b), cadd(a, b));
}

/** V(load)/V(EMF) of the ladder between rs and rl (ABCD chain). */
function ladderResponse(elements: LadderElement[], rs: number, rl: number, w: number): Cx {
  // [A B; C D] starting with the source resistance
  let A = cx(1);
  let B = cx(rs);
  let Cc = cx(0);
  let D = cx(1);
  for (const e of elements) {
    const z = elementZ(e, w);
    if (e.position === 'series') {
      // [A B; C D]·[1 z; 0 1]
      B = cadd(cmul(A, z), B);
      D = cadd(cmul(Cc, z), D);
    } else {
      const y = cdiv(cx(1), z);
      // [A B; C D]·[1 0; y 1]
      A = cadd(A, cmul(B, y));
      Cc = cadd(Cc, cmul(D, y));
    }
  }
  // V_S = A·V_L + B·I_L with I_L = V_L/rl
  return cdiv(cx(1), cadd(A, cdiv(B, cx(rl))));
}

function placeLadder(w: WizardSheet, elements: LadderElement[], x0: number, y: number): number {
  let x = x0;
  const val = (v: number) => v;
  elements.forEach((e, i) => {
    const stage = { stage: i + 1 };
    if (e.position === 'shunt') {
      if (e.form === 'single') {
        if (e.kind === 'C') w.capacitor(w.ref('C'), val(e.c!), { x, y }, true, 'wizard.role.ladderShunt', stage);
        else w.inductor(w.ref('L'), val(e.l!), { x, y }, true, 'wizard.role.ladderShunt', stage);
        w.gnd(x, y + 60);
      } else if (e.form === 'parallelLC') {
        w.inductor(w.ref('L'), e.l!, { x, y }, true, 'wizard.role.ladderShunt', stage);
        w.gnd(x, y + 60);
        w.wire(p(x, y), p(x + 40, y));
        w.capacitor(w.ref('C'), e.c!, { x: x + 40, y }, true, 'wizard.role.ladderShunt', stage);
        w.gnd(x + 40, y + 60);
        x += 40;
      } else {
        w.inductor(w.ref('L'), e.l!, { x, y }, true, 'wizard.role.ladderShunt', stage);
        w.capacitor(w.ref('C'), e.c!, { x, y: y + 60 }, true, 'wizard.role.ladderShunt', stage);
        w.gnd(x, y + 120);
      }
      // rail to the next element
      w.wire(p(x, y), p(x + 40, y));
      x += 40;
      return;
    }
    if (e.form === 'single') {
      if (e.kind === 'L') w.inductor(w.ref('L'), e.l!, { x, y }, false, 'wizard.role.ladderSeries', stage);
      else w.capacitor(w.ref('C'), e.c!, { x, y }, false, 'wizard.role.ladderSeries', stage);
      x += 60;
    } else if (e.form === 'seriesLC') {
      w.inductor(w.ref('L'), e.l!, { x, y }, false, 'wizard.role.ladderSeries', stage);
      w.capacitor(w.ref('C'), e.c!, { x: x + 60, y }, false, 'wizard.role.ladderSeries', stage);
      x += 120;
    } else {
      // parallel LC in the series arm: L on the rail, C above it
      w.wire(p(x, y), p(x + 20, y));
      w.inductor(w.ref('L'), e.l!, { x: x + 20, y }, false, 'wizard.role.ladderSeries', stage);
      w.wire(p(x + 80, y), p(x + 100, y));
      w.wire(p(x, y), p(x, y - 50), p(x + 20, y - 50));
      w.capacitor(w.ref('C'), e.c!, { x: x + 20, y: y - 50 }, false, 'wizard.role.ladderSeries', stage);
      w.wire(p(x + 80, y - 50), p(x + 100, y - 50), p(x + 100, y));
      x += 100;
    }
    w.wire(p(x, y), p(x + 40, y));
    x += 40;
  });
  return x;
}

// ---------------------------------------------------------------------------------------------
// main entry

function rangeFor(spec: FilterSpec): [number, number] {
  if (spec.type === 'lowpass' || spec.type === 'highpass') {
    const lo = Math.min(spec.fp!, spec.fs!);
    const hi = Math.max(spec.fp!, spec.fs!);
    return [lo / 20, hi * 20];
  }
  const [f1, f2] = bandEdges(spec.f0!, Math.max(spec.bw!, spec.bws!));
  return [Math.max(f1 / 10, spec.f0! / 100), f2 * 10];
}

/** Design a filter. Throws WizardInputError for an impossible specification. */
export function designFilter(spec: FilterSpec): FilterDesignResult {
  const { n } = check(spec);
  const { type, response } = spec;
  const scale = protoScale(response, n, spec.ap);
  const poles = prototypePoles(response, n, spec.ap);
  const band = type === 'bandpass' || type === 'bandstop';
  const w0 = band ? TWO_PI * spec.f0! : 0;
  // prototype scaling: cut-off (LP / HP) or bandwidth (BP / BS)
  let wc: number;
  if (type === 'lowpass') wc = TWO_PI * spec.fp! * scale;
  else if (type === 'highpass') wc = (TWO_PI * spec.fp!) / scale;
  else if (type === 'bandpass') wc = TWO_PI * spec.bw! * scale;
  else wc = (TWO_PI * spec.bw!) / scale;
  const sections = filterSections(type, poles, wc, w0);
  const refGain = referenceGain(response, n, spec.ap);
  const gain = spec.gain ?? 1;
  const active = spec.topology !== 'passive';
  if (active && !(gain > 0 && gain <= 100)) throw new WizardInputError('wizard.filter.errGain');

  const titleKind = `${response === 'butterworth' ? 'Butterworth' : 'Chebyshev'} ${type}`;
  const w = new WizardSheet(`${titleKind} filter (n = ${n})`);
  const d = w.design;
  const y0 = 300;
  // source and input node
  const v1 = w.b.part('sources/ac-voltage', 'V1', 100, y0 + 30, { amplitude: '1', freq: valueText(band ? spec.f0! : spec.fp!), acmag: '1' });
  w.gnd(100, y0 + 60);
  w.record('V1', '1 V', 'wizard.role.source');
  w.wire(w.pin(v1, '+'), p(160, y0));
  w.label('IN', 130, y0);
  let x = 160;
  let h: (wv: number) => Cx;
  const explain: WizardText[] = [];
  const warnings: WizardText[] = [];
  explain.push({ key: 'wizard.filter.explainOrder', params: { n, nb: band ? 2 * n : n, resp: response === 'butterworth' ? 'Butterworth' : 'Chebyshev' } });

  if (!active) {
    const r = spec.r ?? 1000;
    const rounding = spec.rounding ?? 'exact';
    const { g, gLoad } = ladderValues(response, n, spec.ap);
    const elements = ladderElements(type, g, r, wc, w0, (v) => roundValue(v, rounding));
    const rl = n % 2 === 1 ? r * gLoad : r / gLoad;
    w.resistor('RS', r, { x, y: y0 }, false, 'wizard.role.sourceR');
    x += 60;
    w.wire(p(x, y0), p(x + 40, y0));
    x += 40;
    x = placeLadder(w, elements, x, y0);
    w.resistor('RL', rl, { x, y: y0 }, true, 'wizard.role.load');
    w.gnd(x, y0 + 60);
    w.label('OUT', x - 20, y0);
    h = (wv) => ladderResponse(elements, r, rl, wv);
    explain.push({ key: 'wizard.filter.explainLadder', params: { g: g.map((v) => num(v, 4)).join(', '), r: valueText(r) } });
    explain.push({ key: 'wizard.filter.explainPassiveGain', params: { db: num(20 * Math.log10(0.5 * Math.sqrt(rl / r) * refGain), 3) } });
    if (rl !== r) explain.push({ key: 'wizard.filter.explainLoadEven', params: { rl: valueText(rl) } });
  } else {
    const opampKey = spec.opamp ?? 'ideal';
    const c: Ctx = {
      w,
      rounding: spec.rounding ?? 'E96',
      capSeries: spec.capSeries ?? 'E12',
      r0: spec.r ?? 10e3,
      opamp: OPAMP_PART[opampKey],
      realOpamp: opampKey !== 'ideal',
      stage: 1,
    };
    if (c.realOpamp) {
      const vs = spec.supply ?? 15;
      w.rail('VCC', 100, 150, vs);
      w.rail('VEE', 160, 190, -vs);
    }
    const cells: Cell[] = [];
    const total = gain * refGain;
    const add = (cell: Cell) => {
      cells.push(cell);
      x = cell.xEnd;
      c.stage += 1;
    };
    if (type === 'lowpass' || type === 'highpass') {
      const mfb = spec.topology === 'mfb';
      sections.forEach((sec, i) => {
        const k = mfb && i === 0 ? total : 1;
        if (sec.order === 1) add(mfb ? cellMfb1(c, x, y0, sec, k) : cellFirstOrderSk(c, x, y0, sec));
        else add(mfb ? cellMfb2(c, x, y0, sec, k) : cellSallenKey(c, x, y0, sec));
      });
      if (!mfb && Math.abs(total - 1) > 1e-6) add(total > 1 ? cellGain(c, x, y0, total) : cellAttenuator(c, x, y0, total));
      explain.push({ key: mfb ? 'wizard.filter.explainMfb' : 'wizard.filter.explainSk', params: { s: sections.length } });
    } else if (type === 'bandpass') {
      // centre gain shared between the sections (each below 2Q²)
      const at = sections.map((s) => cabs(sectionResponse(s, w0)));
      const need = total / at.reduce((a, b) => a * b, 1);
      const ks = sections.map(() => need ** (1 / sections.length));
      sections.forEach((s, i) => {
        const lim = 1.8 * s.q * s.q;
        if (ks[i] > lim) ks[i] = lim;
      });
      const got = ks.reduce((a, b) => a * b, 1);
      if (got < need * 0.999) {
        // push the rest into the sections that still have room
        let rest = need / got;
        sections.forEach((s, i) => {
          const room = (1.8 * s.q * s.q) / ks[i];
          const f = Math.min(room, rest);
          ks[i] *= f;
          rest /= f;
        });
        if (rest > 1.001) warnings.push({ key: 'wizard.filter.warnGainLimited' });
      }
      sections.forEach((s, i) => add(cellMfbBandpass(c, x, y0, s, ks[i])));
      explain.push({ key: 'wizard.filter.explainBandpass', params: { s: sections.length } });
    } else {
      const a = total ** (1 / sections.length);
      sections.forEach((s, i) => add(cellNotch(c, x, y0, s, a, i + 1)));
      explain.push({ key: 'wizard.filter.explainBandstop', params: { s: sections.length } });
    }
    w.wire(p(x, y0), p(x + 60, y0));
    x += 60;
    w.resistor('RL', 10e3, { x, y: y0 }, true, 'wizard.role.load');
    w.gnd(x, y0 + 60);
    w.label('OUT', x - 30, y0);
    h = (wv) => cells.reduce((acc, cell) => cmul(acc, cell.h(wv)), cx(1));
    const inverting = spec.topology === 'mfb' || type === 'bandpass';
    if (inverting && sections.length % 2 === 1) explain.push({ key: 'wizard.filter.explainInverting' });
  }
  sections.forEach((s, i) =>
    explain.push(
      s.order === 1
        ? { key: 'wizard.filter.explainSection1', params: { i: i + 1, f: eng(s.w0 / TWO_PI, 'Hz', 4) } }
        : { key: 'wizard.filter.explainSection2', params: { i: i + 1, f: eng(s.w0 / TWO_PI, 'Hz', 4), q: num(s.q, 4) } },
    ),
  );

  // Bode plotter on IN / OUT and analyses
  const [fmin, fmax] = rangeFor(spec);
  const xbp = w.b.part('instruments/bode-plotter', 'XBP1', Math.max(400, x - 200), 120, {
    fstart: valueText(fmin, 3),
    fstop: valueText(fmax, 3),
    points: '100',
    mmin: valueText(-Math.max(60, Math.ceil(spec.as / 10) * 10 + 20)),
    mmax: valueText(active ? Math.ceil(20 * Math.log10(Math.max(gain, 1)) / 10) * 10 + 10 : 0),
  });
  w.b.labelPin(xbp, 'IN+', 'IN');
  w.b.labelPin(xbp, 'OUT+', 'OUT');
  setAnalyses(d, 'ac', [
    { type: 'op' },
    { type: 'ac', sweep: 'dec', points: 100, fstart: fmin, fstop: fmax },
    { type: 'tran', tstep: 1 / ((band ? spec.f0! : spec.fp!) * 100), tstop: 10 / (band ? spec.f0! : spec.fp!) },
  ]);
  const edges = filterEdges(spec);
  const predict = (f: number) => h(TWO_PI * f);
  // peak of the pass band (dense log scan of the predicted response)
  let peak = 0;
  const scan = 2000;
  for (let i = 0; i <= scan; i++) {
    const f = fmin * (fmax / fmin) ** (i / scan);
    peak = Math.max(peak, cabs(predict(f)));
  }
  const atten = (f: number) => -20 * Math.log10(cabs(predict(f)) / peak);
  const predicted = [
    ...edges.pass.map((f) => ({ label: 'wizard.fig.attenPass' as MessageKey, value: atten(f), unit: 'dB', target: spec.ap })),
    ...edges.stop.map((f) => ({ label: 'wizard.fig.attenStop' as MessageKey, value: atten(f), unit: 'dB', target: spec.as })),
    { label: 'wizard.fig.peakGain' as MessageKey, value: 20 * Math.log10(peak), unit: 'dB' },
  ];
  if (edges.stop.some((f) => atten(f) < spec.as - 0.5)) warnings.push({ key: 'wizard.filter.warnStopband' });
  d.description = `${titleKind}, n = ${n}`;
  w.noteText(60, y0 + 230, band ? 'wizard.filter.noteBand' : 'wizard.filter.note', {
    f: eng(band ? spec.f0! : spec.fp!, 'Hz', 4),
    n,
    ap: num(spec.ap, 3),
  });
  fitPaper(d);
  return { design: d, parts: w.parts, predicted, explain, warnings, order: n, sections, response: predict, peakGain: peak, edges };
}

/** Pass-band and stop-band edge frequencies of a specification (Hz). */
export function filterEdges(spec: FilterSpec): { pass: number[]; stop: number[] } {
  if (spec.type === 'lowpass' || spec.type === 'highpass') return { pass: [spec.fp!], stop: [spec.fs!] };
  return { pass: bandEdges(spec.f0!, spec.bw!), stop: bandEdges(spec.f0!, spec.bws!) };
}
