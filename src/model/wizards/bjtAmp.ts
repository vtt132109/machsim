/**
 * BJT common-emitter amplifier wizard (voltage-divider bias, partly bypassed emitter resistor).
 *
 * Design steps (classic textbook procedure):
 *   1. VE = 10 % of VCC (at least 1 V); RE = VE / IE, IE = IC·(1 + 1/β).
 *   2. VC halfway between VE and VCC (largest symmetric swing): RC = (VCC − VC) / IC.
 *   3. re = VT / IC; unbypassed RE1 = (RC ∥ RL)/|Av| − re sets the gain, RE2 = RE − RE1 is
 *      bypassed by CE.
 *   4. Stiff divider: I(R2) = 10·IB, VB = VE + VBE, R2 = VB / (10·IB), R1 = (VCC − VB)/(11·IB).
 *   5. Coupling capacitors: CE puts the dominant low-frequency pole at fL; CIN and COUT poles go
 *      to fL/10 (driven from a low-impedance generator, CE sees RE2 ∥ (re + RE1)).
 * After rounding to the chosen series the bias point is recomputed from the Thevenin equivalent
 * of the divider and the gain from the hybrid-π model Av = −β(RC ∥ RL)/(rπ + (β + 1)RE1).
 */
import { WizardInputError, WizardSheet, VT_27C, eng, num, p, roundValue, seriesAtLeast, setAnalyses, valueText, type Rounding, type WizardResult, type WizardText } from './common';
import { nice125 } from './timer555';

export interface BjtChoice {
  partId: string;
  /** typical small-signal current gain at 1 mA (the library model) */
  beta: number;
  vbe: number;
}

/** Transistors offered by the wizard (β from the library models at IC ≈ 1 mA, VCE ≈ 5 V). */
export const CE_TRANSISTORS: Record<string, BjtChoice> = {
  '2n3904': { partId: 'transistors/2n3904', beta: 170, vbe: 0.65 },
  '2n2222a': { partId: 'transistors/2n2222a', beta: 160, vbe: 0.62 },
  bc547b: { partId: 'transistors/bc547b', beta: 280, vbe: 0.63 },
};

export interface CommonEmitterSpec {
  vcc: number;
  /** collector quiescent current (A) */
  ic: number;
  /** magnitude of the mid-band voltage gain with the load */
  gain: number;
  /** load resistance (Ω) */
  rl: number;
  /** lower −3 dB frequency (Hz) */
  flow: number;
  transistor?: keyof typeof CE_TRANSISTORS | string;
  rounding?: Rounding;
}

export interface CommonEmitterValues {
  r1: number;
  r2: number;
  rc: number;
  re1: number;
  re2: number;
  cin: number;
  cout: number;
  ce: number;
}

export interface CommonEmitterPrediction {
  ic: number;
  vce: number;
  vb: number;
  ve: number;
  gain: number;
  rin: number;
}

export interface CommonEmitterResult extends WizardResult {
  values: CommonEmitterValues;
  prediction: CommonEmitterPrediction;
}

/** Bias point and mid-band gain of a built amplifier. */
export function predictCommonEmitter(v: CommonEmitterValues, vcc: number, rl: number, t: BjtChoice): CommonEmitterPrediction {
  const vth = (vcc * v.r2) / (v.r1 + v.r2);
  const rth = (v.r1 * v.r2) / (v.r1 + v.r2);
  const re = v.re1 + v.re2;
  const ie = (vth - t.vbe) / (re + rth / (t.beta + 1));
  const ic = (ie * t.beta) / (t.beta + 1);
  const ve = ie * re;
  const vc = vcc - ic * v.rc;
  const rpi = (t.beta * VT_27C) / ic;
  const rload = (v.rc * rl) / (v.rc + rl);
  const gain = -(t.beta * rload) / (rpi + (t.beta + 1) * v.re1);
  const rb = rpi + (t.beta + 1) * v.re1;
  const rin = 1 / (1 / v.r1 + 1 / v.r2 + 1 / rb);
  return { ic, vce: vc - ve, vb: ve + t.vbe, ve, gain, rin };
}

/** Design the amplifier. */
export function designCommonEmitter(spec: CommonEmitterSpec): CommonEmitterResult {
  const t = CE_TRANSISTORS[spec.transistor ?? '2n3904'] ?? CE_TRANSISTORS['2n3904'];
  const { vcc, ic, rl, flow } = spec;
  const av = Math.abs(spec.gain);
  if (!(vcc >= 5 && vcc <= 30)) throw new WizardInputError('wizard.bjt.errVcc');
  if (!(ic >= 50e-6 && ic <= 20e-3)) throw new WizardInputError('wizard.bjt.errIc');
  if (!(av >= 1 && av <= 500)) throw new WizardInputError('wizard.bjt.errGain');
  if (!(rl >= 100)) throw new WizardInputError('wizard.bjt.errRl');
  if (!(flow >= 1 && flow <= 100e3)) throw new WizardInputError('wizard.bjt.errFlow');
  const rounding = spec.rounding ?? 'E24';
  const warnings: WizardText[] = [];
  const ib = ic / t.beta;
  const ie = ic + ib;
  const veT = Math.max(1, 0.1 * vcc);
  const reT = veT / ie;
  const vcT = veT + (vcc - veT) / 2;
  const rcRaw = (vcc - vcT) / ic;
  const rc = roundValue(rcRaw, rounding);
  const re0 = VT_27C / ic;
  const rload = (rc * rl) / (rc + rl);
  const maxGain = rload / re0;
  let re1Raw = rload / av - re0;
  if (re1Raw < 0) {
    warnings.push({ key: 'wizard.bjt.warnGainHigh', params: { max: num(maxGain, 3) } });
    re1Raw = 0;
  }
  let re2Raw = reT - re1Raw;
  if (re2Raw < 0.05 * reT) {
    // the gain needs (almost) the whole emitter resistance unbypassed
    re1Raw = reT;
    re2Raw = 0;
    warnings.push({ key: 'wizard.bjt.warnGainLow' });
  }
  const re1 = re1Raw > 0 ? roundValue(re1Raw, rounding) : 0;
  const re2 = re2Raw > 0 ? roundValue(re2Raw, rounding) : 0;
  const vbT = veT + t.vbe;
  const idiv = 10 * ib;
  const r2 = roundValue(vbT / idiv, rounding);
  const r1 = roundValue((vcc - vbT) / (idiv + ib), rounding);
  // capacitors from the rounded resistors
  const rpi = (t.beta * VT_27C) / ic;
  const rin = 1 / (1 / r1 + 1 / r2 + 1 / (rpi + (t.beta + 1) * re1));
  const ceNeeded = re2 > 0;
  // the generator is (nearly) ideal: the base sees ~0 Ω, so the emitter looks back into re + RE1
  const reff = ceNeeded ? 1 / (1 / re2 + 1 / (re1 + rpi / (t.beta + 1))) : 0;
  const ce = ceNeeded ? seriesAtLeast(1 / (2 * Math.PI * flow * reff), 'E6') : 0;
  const cin = seriesAtLeast(10 / (2 * Math.PI * flow * rin), 'E6');
  const cout = seriesAtLeast(10 / (2 * Math.PI * flow * (rc + rl)), 'E6');
  const values: CommonEmitterValues = { r1, r2, rc, re1, re2, cin, cout, ce };
  const pr = predictCommonEmitter(values, vcc, rl, t);
  if (pr.vce < 1) warnings.push({ key: 'wizard.bjt.warnSaturation', params: { vce: num(pr.vce, 3) } });

  // ------------------------------------------------------------------ schematic
  const w = new WizardSheet(`Common-emitter amplifier |Av| = ${num(av, 3)}`);
  const d = w.design;
  w.rail('VCC', 300, 140, vcc);
  w.rail('VCC', 410, 140, vcc);
  const r1h = w.resistor('R1', r1, { x: 300, y: 170 }, true, 'wizard.role.biasTop');
  const r2h = w.resistor('R2', r2, { x: 300, y: 370 }, true, 'wizard.role.biasBottom');
  const rch = w.resistor('RC', rc, { x: 410, y: 170 }, true, 'wizard.role.collector');
  const q1 = w.b.part(t.partId, 'Q1', 400, 300);
  w.record('Q1', t.partId.split('/')[1].toUpperCase(), 'wizard.role.transistor');
  w.wire(p(300, 140), w.pin(r1h, '1'));
  w.wire(p(410, 140), w.pin(rch, '1'));
  w.wire(w.pin(r1h, '2'), w.pin(r2h, '1'));
  w.wire(w.pin(rch, '2'), w.pin(q1, 'C'));
  // CIN: '+' faces the base (higher DC level)
  const cinh = w.b.part('basic/electrolytic', 'CIN', 230, 300, { value: valueText(cin) }, { mirror: true });
  w.record('CIN', valueText(cin), 'wizard.role.cin');
  w.wire(w.pin(cinh, '+'), p(300, 300));
  w.wire(p(300, 300), w.pin(q1, 'B'));
  // emitter network
  if (re1 > 0) {
    const re1h = w.resistor('RE1', re1, { x: 410, y: 360 }, true, 'wizard.role.re1');
    w.wire(w.pin(q1, 'E'), w.pin(re1h, '1'));
    if (re2 > 0) {
      const re2h = w.resistor('RE2', re2, { x: 410, y: 460 }, true, 'wizard.role.re2');
      w.wire(w.pin(re1h, '2'), w.pin(re2h, '1'));
      w.wire(w.pin(re2h, '2'), p(410, 560));
    } else {
      w.wire(w.pin(re1h, '2'), p(410, 560));
    }
  } else {
    const re2h = w.resistor('RE2', re2, { x: 410, y: 460 }, true, 'wizard.role.re2');
    w.wire(w.pin(q1, 'E'), w.pin(re2h, '1'));
    w.wire(w.pin(re2h, '2'), p(410, 560));
  }
  if (ceNeeded) {
    const ceh = w.b.part('basic/electrolytic', 'CE', 480, 490, { value: valueText(ce) }, { rotation: 90 });
    w.record('CE', valueText(ce), 'wizard.role.ce');
    w.wire(p(410, 440), p(480, 440), w.pin(ceh, '+'));
    w.wire(w.pin(ceh, '-'), p(480, 560));
  }
  // ground rail, output and load
  w.wire(w.pin(r2h, '2'), p(300, 560));
  w.wire(p(300, 560), p(600, 560));
  w.gnd(300, 560);
  const couth = w.b.part('basic/electrolytic', 'COUT', 520, 250, { value: valueText(cout) });
  w.record('COUT', valueText(cout), 'wizard.role.cout');
  w.wire(p(410, 250), w.pin(couth, '+'));
  const rlh = w.resistor('RL', rl, { x: 600, y: 290 }, true, 'wizard.role.load');
  w.wire(w.pin(couth, '-'), p(600, 250), w.pin(rlh, '1'));
  w.wire(w.pin(rlh, '2'), p(600, 560));
  // signal generator: output about 1 V peak
  const vin = Math.min(0.1, 1 / av);
  const xfg = w.b.part('instruments/function-generator', 'XFG1', 120, 200, { waveform: 'sine', freq: valueText(Math.max(1000, 10 * flow)), amplitude: valueText(Number(vin.toPrecision(2))) });
  w.gnd(120, 250);
  w.wire(w.pin(xfg, '+'), p(100, 300), w.pin(cinh, '-'));
  w.wire(w.pin(xfg, 'COM'), p(120, 250));
  w.label('IN', 150, 300);
  w.label('OUT', 600, 270);
  const fsig = Math.max(1000, 10 * flow);
  const xsc = w.b.part('instruments/scope', 'XSC1', 760, 200, {
    timebase: valueText(nice125(2 / fsig / 10)),
    'A.scale': valueText(nice125(vin / 2)),
    'B.scale': valueText(nice125(Math.abs(pr.gain) * vin / 2)),
    'trig.source': 'A',
    'trig.level': '0',
  });
  w.b.labelPin(xsc, 'A+', 'IN');
  w.b.labelPin(xsc, 'B+', 'OUT');
  w.noteText(60, 620, 'wizard.bjt.note', { ic: eng(pr.ic, 'A', 3), vce: num(pr.vce, 3), av: num(pr.gain, 3) });
  d.description = `Av ≈ ${num(pr.gain, 3)}, IC ≈ ${eng(pr.ic, 'A', 3)}`;
  setAnalyses(d, 'ac', [
    { type: 'op' },
    { type: 'ac', sweep: 'dec', points: 20, fstart: Math.max(0.1, flow / 100), fstop: 100e6 },
    { type: 'tran', tstep: 1 / (fsig * 100), tstop: 5 / fsig },
  ]);
  const explain: WizardText[] = [
    { key: 'wizard.bjt.explainVe', params: { ve: num(veT, 3), re: valueText(re1 + re2) } },
    { key: 'wizard.bjt.explainRc', params: { vc: num(vcT, 3), rc: valueText(rc) } },
    { key: 'wizard.bjt.explainRe1', params: { re: num(re0, 3), re1: valueText(re1), av: num(av, 3) } },
    { key: 'wizard.bjt.explainDivider', params: { vb: num(vbT, 3), r1: valueText(r1), r2: valueText(r2), beta: t.beta } },
    { key: 'wizard.bjt.explainCaps', params: { cin: valueText(cin), cout: valueText(cout), ce: ceNeeded ? valueText(ce) : '—', fl: eng(flow, 'Hz', 3) } },
    { key: 'wizard.bjt.explainResult', params: { ic: eng(pr.ic, 'A', 3), vce: num(pr.vce, 3), av: num(pr.gain, 3), rin: valueText(pr.rin, 3) } },
  ];
  return {
    design: d,
    parts: w.parts,
    predicted: [
      { label: 'wizard.fig.gain', value: pr.gain, unit: '', target: -av },
      { label: 'wizard.fig.ic', value: pr.ic, unit: 'A', target: ic },
      { label: 'wizard.fig.vce', value: pr.vce, unit: 'V' },
      { label: 'wizard.fig.rin', value: pr.rin, unit: 'Ω' },
    ],
    explain,
    warnings,
    values,
    prediction: pr,
  };
}
