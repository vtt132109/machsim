/**
 * Op-amp stage wizard: inverting, non-inverting, difference, inverting summing, non-inverting
 * summing and scaling (weighted) adder stages with their sources, supplies, load and an
 * oscilloscope (A = first input, B = output).
 *
 * Ideal-op-amp relations (virtual short between the inputs, no input current):
 *   inverting        Vout = −(Rf/R1)·V1
 *   non-inverting    Vout = (1 + Rf/Rg)·V1            (Rf = 0: voltage follower)
 *   difference       Vout = (R2/R1)·(V2 − V1)          with R3 = R1, R4 = R2
 *   summing          Vout = −Rf·Σ Vi/Ri                (equal Ri: −(Rf/R)·ΣVi)
 *   non-inv summing  Vout = (1 + Rf/Rg)·Σ(Vi/Ri)/Σ(1/Ri)
 *   scaling adder    Vout = −Σ wi·Vi with Ri = Rf/wi
 * Each input is a sine source (amplitude, frequency) or a DC source (frequency 0). The coefficients
 * reported in `gains` use the rounded resistor values.
 */
import { WizardInputError, WizardSheet, eng, num, p, roundValue, setAnalyses, valueText, type Rounding, type WizardFigure, type WizardResult, type WizardText } from './common';
import { nice125 } from './timer555';
import type { PartHandle } from '../designkit';

export type OpampStageKind = 'inverting' | 'noninverting' | 'difference' | 'summing' | 'noninvSumming' | 'scaling';
export type OpampModel = 'ideal' | 'lm741' | 'tl081' | 'ne5532' | 'op07' | 'generic';

export const OPAMP_STAGE_KINDS: readonly OpampStageKind[] = ['inverting', 'noninverting', 'difference', 'summing', 'noninvSumming', 'scaling'];
export const OPAMP_MODELS: readonly OpampModel[] = ['ideal', 'lm741', 'tl081', 'ne5532', 'op07', 'generic'];

const MODEL_PART: Record<OpampModel, string> = {
  ideal: 'analog/opamp-ideal-5',
  lm741: 'analog/lm741',
  tl081: 'analog/tl081',
  ne5532: 'analog/ne5532',
  op07: 'analog/op07',
  generic: 'analog/opamp',
};

export interface OpampInput {
  /** peak amplitude (sine) or DC value (V) */
  amplitude: number;
  /** Hz; 0 = DC source */
  freq: number;
}

export interface OpampStageSpec {
  kind: OpampStageKind;
  /** magnitude of the voltage gain (per input for the summers) */
  gain: number;
  /** scaling adder: weight of every input (magnitudes) */
  weights?: number[];
  inputs: OpampInput[];
  /** base input resistance (Ω, default 10 kΩ) */
  rin?: number;
  /** ±supply (V, default 15) */
  supply?: number;
  model?: OpampModel;
  /** load resistance (Ω, default 10 kΩ) */
  rl?: number;
  rounding?: Rounding;
}

export interface OpampStageResult extends WizardResult {
  /** Vout = Σ gains[i]·Vin_i (signed coefficients with the rounded resistors) */
  gains: number[];
}

/** Number of inputs a stage kind uses (summers: 2..4). */
export function stageInputCount(kind: OpampStageKind, requested: number): number {
  if (kind === 'inverting' || kind === 'noninverting') return 1;
  if (kind === 'difference') return 2;
  return Math.max(2, Math.min(4, Math.round(requested)));
}

const OP = { x: 400, y: 300 };
const IN_X = 180;
const R_X = 250;

/** Place input source i with its positive terminal at (IN_X, y); returns the + pin. */
function source(w: WizardSheet, index: number, inp: OpampInput, y: number): void {
  const ref = `V${index + 1}`;
  if (inp.freq > 0) {
    w.b.part('sources/ac-voltage', ref, IN_X, y + 30, { amplitude: valueText(inp.amplitude), freq: valueText(inp.freq), acmag: index === 0 ? '1' : '0' });
    w.record(ref, `${eng(inp.amplitude, 'V', 3)} ${eng(inp.freq, 'Hz', 3)}`, 'wizard.role.source');
  } else {
    w.b.part('sources/dc-voltage', ref, IN_X, y + 30, { value: valueText(inp.amplitude), acmag: index === 0 ? '1' : '0' });
    w.record(ref, eng(inp.amplitude, 'V', 3), 'wizard.role.sourceDc');
  }
  w.gnd(IN_X, y + 60);
  w.label(`IN${index + 1}`, IN_X + 40, y);
}

/** Feedback resistor from the junction (jx, 200) to the output wire. */
function feedback(w: WizardSheet, rf: number, jx: number): void {
  w.wire(p(jx, 200), p(jx + 30, 200));
  w.resistor(w.ref('R'), rf, { x: jx + 30, y: 200 }, false, 'wizard.role.rf');
  w.wire(p(jx + 90, 200), p(470, 200), p(470, 300));
}

/** Design an op-amp stage. */
export function designOpampStage(spec: OpampStageSpec): OpampStageResult {
  const kind = spec.kind;
  const n = stageInputCount(kind, spec.inputs.length);
  if (spec.inputs.length < n) throw new WizardInputError('wizard.opamp.errInputs', { n });
  const inputs = spec.inputs.slice(0, n);
  const rounding = spec.rounding ?? 'E24';
  const rin = roundValue(spec.rin ?? 10e3, rounding);
  if (!(rin >= 100 && rin <= 10e6)) throw new WizardInputError('wizard.opamp.errRin');
  const supply = spec.supply ?? 15;
  if (!(supply >= 2 && supply <= 30)) throw new WizardInputError('wizard.opamp.errSupply');
  const model = spec.model ?? 'ideal';
  const g = spec.gain;
  if (kind !== 'scaling' && !(g > 0 && g <= 1000)) throw new WizardInputError('wizard.opamp.errGain');
  if (kind === 'noninverting' && g < 1) throw new WizardInputError('wizard.opamp.errGainNonInv');
  if (kind === 'noninvSumming' && g * n < 1) throw new WizardInputError('wizard.opamp.errGainNonInvSum', { min: num(1 / n, 3) });
  const weights = kind === 'scaling' ? (spec.weights ?? []).slice(0, n) : [];
  if (kind === 'scaling' && (weights.length < n || weights.some((x) => !(x > 0 && x <= 1000)))) throw new WizardInputError('wizard.opamp.errWeights');

  const w = new WizardSheet(`Op-amp ${kind} stage`);
  const d = w.design;
  // op-amp, supplies, output and load
  const u1: PartHandle = w.b.part(MODEL_PART[model], 'U1', OP.x, OP.y);
  w.record('U1', model === 'ideal' ? 'ideal' : model.toUpperCase(), 'wizard.role.opamp');
  w.rail('VCC', OP.x, 250, supply);
  w.wire(w.pin(u1, 'V+'), p(OP.x, 250));
  w.rail('VEE', OP.x, 350, -supply);
  w.wire(w.pin(u1, 'V-'), p(OP.x, 350));
  w.wire(w.pin(u1, 'OUT'), p(520, 300));
  w.label('OUT', 490, 300);
  const rl = spec.rl ?? 10e3;
  w.resistor('RL', rl, { x: 520, y: 300 }, true, 'wizard.role.load');
  w.gnd(520, 360);

  const gains: number[] = [];
  const explain: WizardText[] = [];
  const rRef = () => w.ref('R');
  switch (kind) {
    case 'inverting':
    case 'summing':
    case 'scaling': {
      const rf = kind === 'scaling' ? roundValue(rin * Math.max(...weights), rounding) : roundValue(g * rin, rounding);
      const rs = inputs.map((_, i) => (kind === 'scaling' ? roundValue(rf / weights[i], rounding) : rin));
      inputs.forEach((inp, i) => {
        const y = 290 + 80 * i;
        source(w, i, inp, y);
        w.wire(p(IN_X, y), p(R_X, y));
        w.resistor(rRef(), rs[i], { x: R_X, y }, false, 'wizard.role.rin', { n: i + 1 });
        if (i === 0) w.wire(p(R_X + 60, y), w.pin(u1, 'IN-'));
        else w.wire(p(R_X + 60, y), p(340, y));
        gains.push(-rf / rs[i]);
      });
      if (n > 1) w.wire(p(340, 290), p(340, 290 + 80 * (n - 1)));
      w.wire(p(340, 290), p(340, 200));
      feedback(w, rf, 340);
      w.wire(w.pin(u1, 'IN+'), p(360, 340));
      w.gnd(360, 340);
      explain.push(kind === 'inverting' ? { key: 'wizard.opamp.explainInverting', params: { rf: valueText(rf), r1: valueText(rs[0]), g: num(rf / rs[0], 4) } } : { key: 'wizard.opamp.explainSumming', params: { rf: valueText(rf) } });
      break;
    }
    case 'noninverting': {
      source(w, 0, inputs[0], 310);
      w.wire(p(IN_X, 310), w.pin(u1, 'IN+'));
      if (Math.abs(g - 1) < 1e-9) {
        w.wire(w.pin(u1, 'IN-'), p(340, 290), p(340, 200), p(470, 200), p(470, 300));
        gains.push(1);
        explain.push({ key: 'wizard.opamp.explainFollower' });
      } else {
        const rg = rin;
        const rf = roundValue((g - 1) * rg, rounding);
        w.wire(w.pin(u1, 'IN-'), p(340, 290), p(340, 200));
        w.resistor(rRef(), rg, { x: 280, y: 200 }, false, 'wizard.role.rg');
        w.wire(p(280, 200), p(260, 200));
        w.gnd(260, 200);
        w.wire(p(340, 200), p(370, 200));
        w.resistor(rRef(), rf, { x: 370, y: 200 }, false, 'wizard.role.rf');
        w.wire(p(430, 200), p(470, 200), p(470, 300));
        gains.push(1 + rf / rg);
        explain.push({ key: 'wizard.opamp.explainNonInverting', params: { rf: valueText(rf), rg: valueText(rg), g: num(1 + rf / rg, 4) } });
      }
      break;
    }
    case 'difference': {
      const r1 = rin;
      const r2 = roundValue(g * rin, rounding);
      source(w, 0, inputs[0], 290);
      w.wire(p(IN_X, 290), p(R_X, 290));
      w.resistor(rRef(), r1, { x: R_X, y: 290 }, false, 'wizard.role.rin', { n: 1 });
      w.wire(p(R_X + 60, 290), w.pin(u1, 'IN-'));
      w.wire(p(340, 290), p(340, 200));
      feedback(w, r2, 340);
      source(w, 1, inputs[1], 370);
      w.wire(p(IN_X, 370), p(R_X, 370));
      w.resistor(rRef(), r1, { x: R_X, y: 370 }, false, 'wizard.role.rin', { n: 2 });
      w.wire(p(R_X + 60, 370), p(350, 370));
      w.wire(p(350, 370), p(350, 310), w.pin(u1, 'IN+'));
      w.resistor(rRef(), r2, { x: 350, y: 370 }, true, 'wizard.role.rdiff');
      w.gnd(350, 430);
      gains.push(-r2 / r1, (r2 / (r1 + r2)) * (1 + r2 / r1));
      explain.push({ key: 'wizard.opamp.explainDifference', params: { r1: valueText(r1), r2: valueText(r2), g: num(r2 / r1, 4) } });
      break;
    }
    case 'noninvSumming': {
      const rg = rin;
      const k = g * n;
      const rf = Math.abs(k - 1) < 1e-9 ? 0 : roundValue((k - 1) * rg, rounding);
      inputs.forEach((inp, i) => {
        const y = 310 + 80 * i;
        source(w, i, inp, y);
        w.wire(p(IN_X, y), p(R_X, y));
        w.resistor(rRef(), rin, { x: R_X, y }, false, 'wizard.role.rin', { n: i + 1 });
        if (i === 0) w.wire(p(R_X + 60, y), w.pin(u1, 'IN+'));
        else w.wire(p(R_X + 60, y), p(340, y));
        gains.push((rf > 0 ? 1 + rf / rg : 1) / n);
      });
      w.wire(p(340, 310), p(340, 310 + 80 * (n - 1)));
      if (rf > 0) {
        w.wire(w.pin(u1, 'IN-'), p(350, 290), p(350, 200));
        w.resistor(rRef(), rg, { x: 290, y: 200 }, false, 'wizard.role.rg');
        w.wire(p(290, 200), p(270, 200));
        w.gnd(270, 200);
        w.wire(p(350, 200), p(370, 200));
        w.resistor(rRef(), rf, { x: 370, y: 200 }, false, 'wizard.role.rf');
        w.wire(p(430, 200), p(470, 200), p(470, 300));
      } else {
        w.wire(w.pin(u1, 'IN-'), p(350, 290), p(350, 200), p(470, 200), p(470, 300));
      }
      explain.push({ key: 'wizard.opamp.explainNonInvSumming', params: { n, k: num(rf > 0 ? 1 + rf / rg : 1, 4) } });
      break;
    }
  }
  gains.forEach((gi, i) => explain.push({ key: 'wizard.opamp.explainCoefficient', params: { i: i + 1, g: num(gi, 4) } }));
  explain.push({ key: 'wizard.opamp.explainVirtualShort' });

  // expected output swing (sine peaks add up in the worst case)
  const peak = inputs.reduce((acc, inp, i) => acc + Math.abs(gains[i] * inp.amplitude), 0);
  const headroom = model === 'ideal' ? supply : supply - 1.5;
  const warnings: WizardText[] = [];
  if (peak > headroom) warnings.push({ key: 'wizard.opamp.warnClipping', params: { peak: num(peak, 3), max: num(headroom, 3) } });
  if (model !== 'ideal' && Math.max(...gains.map(Math.abs)) > 100) warnings.push({ key: 'wizard.opamp.warnBandwidth' });

  const freqs = inputs.map((i) => i.freq).filter((f) => f > 0);
  const fmin = freqs.length ? Math.min(...freqs) : 0;
  const fmax = freqs.length ? Math.max(...freqs) : 0;
  const tstop = fmin > 0 ? 3 / fmin : 10e-3;
  const tstep = fmax > 0 ? 1 / (fmax * 200) : tstop / 200;
  const xsc = w.b.part('instruments/scope', 'XSC1', 720, 160, {
    timebase: valueText(nice125(tstop / 10)),
    'A.scale': valueText(nice125(Math.max(1e-3, Math.abs(inputs[0].amplitude)) / 2)),
    'B.scale': valueText(nice125(Math.max(1e-3, Math.min(peak, headroom)) / 3)),
    'trig.source': 'A',
    'trig.level': '0',
  });
  w.b.labelPin(xsc, 'A+', 'IN1');
  w.b.labelPin(xsc, 'B+', 'OUT');
  w.noteText(60, 300 + 80 * Math.max(n, 2) + 60, 'wizard.opamp.note', { expr: gains.map((gi, i) => `${num(gi, 4)}·V${i + 1}`).join(' + ').replace(/\+ -/g, '− ') });
  d.description = gains.map((gi, i) => `${num(gi, 4)}·V${i + 1}`).join(' + ');
  setAnalyses(d, 'tran', [
    { type: 'op' },
    { type: 'tran', tstep, tstop, tmax: tstep },
    { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 10e6 },
  ]);
  const predicted: WizardFigure[] = gains.map((gi, i) => ({ label: 'wizard.fig.coefficient', value: gi, unit: '', target: targetGain(spec, i, weights) }));
  predicted.push({ label: 'wizard.fig.outPeak', value: peak, unit: 'V' });
  return { design: d, parts: w.parts, predicted, explain, warnings, gains };
}

/** The coefficient the learner asked for (signed). */
function targetGain(spec: OpampStageSpec, i: number, weights: number[]): number {
  switch (spec.kind) {
    case 'inverting':
    case 'summing':
      return -spec.gain;
    case 'noninverting':
      return spec.gain;
    case 'difference':
      return i === 0 ? -spec.gain : spec.gain;
    case 'noninvSumming':
      return spec.gain;
    case 'scaling':
      return -(weights[i] ?? 1);
  }
}
