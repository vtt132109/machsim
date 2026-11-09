/**
 * Small-signal noise analysis ('noise') and noise figure ('noisefig').
 *
 * Method (adjoint network, as in SPICE): at every frequency the AC matrix Y(jω) linearised at the
 * operating point is factored once and the transpose system Yᵀ z = c is solved, where c selects
 * the output (V(out) − V(ref), or a branch current). A noise current generator of PSD S [A²/Hz]
 * injected between unknowns (pos, neg) then reaches the output with transfer z[pos] − z[neg], so
 * its output PSD is |z[pos] − z[neg]|²·S. The transfer from the input source is zᵀb for the
 * source's unit excitation b (z[branch] for a V source), and the input-referred PSD is
 * S_out / |H_in|².
 *
 * Generators come from Device.noise() (semiconductors). Devices without noise() that are
 * physically noisy get the standard thermal generator here: resistors 4kT/R (at their instance
 * temperature when they have one) and switches 4kT/R_on|off. Controlled and independent sources,
 * capacitors and inductors are noiseless.
 *
 * Result of 'noise' (scale "frequency", Hz):
 *   onoise_spectrum  √S_out (V/rtHz; A/rtHz for a current output)   onoise_psd  S_out (V²/Hz)
 *   inoise_spectrum  √S_in  (V/rtHz for a V input source, A/rtHz for an I source)   inoise_psd
 *   gain             |H_in| (output per unit input)
 *   onoise(DEV)      output PSD contributed by device DEV (V²/Hz), all its generators summed
 *   onoise(DEV:GEN)  per generator, for devices with more than one generator
 * Scalars (integrated over [fstart, fstop]): onoise_total / inoise_total (rms), onoise_total_sq /
 * inoise_total_sq (V² or A²) and onoise_total_sq(DEV) per device. The integration assumes a
 * power law between adjacent frequency points (exact for white and 1/f spectra; the usual SPICE
 * approach on logarithmic sweeps). Table: per-generator integrated contributions and shares.
 *
 * 'noisefig' evaluates the same quantities at one frequency and reports the noise factor
 * F = S_in / S_src, NF = 10·log10(F) [dB], where S_src = 4kT·rsource (V input) or 4kT/rsource
 * (I input) is the thermal noise of the source resistance at the circuit temperature. The source
 * resistance must be part of the circuit (its own noise is then included in S_in, so a noiseless
 * amplifier gives 0 dB); a warning is issued when no resistor of that value touches the source.
 */
import { BOLTZ, KELVIN, type NoiseContext, type NoiseGenerator } from '../device';
import type { NoiseAnalysis, NoiseFigureAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type Vector, type VectorUnit } from '../results';
import { AcSystem, sweepFrequencies } from '../engine/ac';
import type { AnalysisContext } from '../engine/analysis-registry';
import type { Circuit } from '../engine/circuit';
import { computeOperatingPoint } from '../engine/analyses';
import type { EngineDevice } from '../engine/hooks';
import { analysisTitle } from '../engine/titles';
import { deviceNodes, findSource, outputVector, parseOutput, sourceGainFromAdjoint, type OutputFunctional, type SourceRef } from './util';

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

interface ConductanceDevice {
  conductance(tempK: number): number;
}

function hasConductance(d: EngineDevice): d is EngineDevice & ConductanceDevice {
  return typeof (d as Partial<ConductanceDevice>).conductance === 'function';
}

/** Thermal generator of a two-terminal conductance g at temperature tempK. */
function thermalGenerator(device: EngineDevice, pos: number, neg: number, g: number, tempK: number): NoiseGenerator {
  const s = 4 * BOLTZ * tempK * Math.abs(g);
  return { name: 'thermal', device: device.name, pos, neg, density: () => s };
}

/**
 * Noise generators of every device at the operating point `opX`: Device.noise() where
 * implemented, plus thermal noise of resistors and switches (which do not implement it).
 */
export function collectNoiseGenerators(circuit: Circuit, opX: Float64Array): NoiseGenerator[] {
  const ctx: NoiseContext = {
    temp: circuit.tempK,
    options: circuit.options,
    op: (i: number) => (i < 0 ? 0 : opX[i]),
  };
  const gens: NoiseGenerator[] = [];
  for (const d of circuit.devices) {
    if (typeof d.noise === 'function') {
      gens.push(...d.noise(ctx));
      continue;
    }
    const nodes = deviceNodes(circuit, d);
    if (d.type === 'R' && hasConductance(d)) {
      const instTemp = d.getParam?.('temp');
      const tK = instTemp !== undefined && Number.isFinite(instTemp) ? instTemp + KELVIN : circuit.tempK;
      gens.push(thermalGenerator(d, nodes[0], nodes[1], d.conductance(circuit.tempK), tK));
    } else if (d.type === 'S' || d.type === 'W') {
      const on = d.getParam?.('value') === 1;
      const r = d.getParam?.(on ? 'ron' : 'roff');
      if (r !== undefined && r > 0) gens.push(thermalGenerator(d, nodes[0], nodes[1], 1 / r, circuit.tempK));
    }
  }
  return gens;
}

// ---------------------------------------------------------------------------------------------
// Spectrum integration
// ---------------------------------------------------------------------------------------------

/**
 * ∫ S(f) df over the sampled band.
 *
 * Each interval is integrated assuming S varies as a power law between its end points
 * (S = S1·(f/f1)^a, i.e. ln S linear in u = ln f), which is exact for white and 1/f spectra.
 * A curvature correction makes the rule higher order for smooth spectra: if ln S has second
 * derivative g'' in u (estimated from second divided differences with the neighbouring points),
 * the exact integral differs from the power-law one by the factor ≈ 1 − g''·Δu²/12. The
 * correction is skipped where the grid is too coarse for it to be reliable (|g''Δu²/12| > 0.1).
 * Intervals where a power law is undefined (zero / negative values or f = 0) use the trapezoidal
 * rule.
 */
export function integrateSpectrum(freqs: ArrayLike<number>, psd: ArrayLike<number>): number {
  const n = freqs.length;
  const logOk = (k: number) => freqs[k] > 0 && psd[k] > 0;
  // second derivative of ln S with respect to ln f at interior points
  const curv = new Float64Array(n).fill(Number.NaN);
  for (let k = 1; k < n - 1; k++) {
    if (!logOk(k - 1) || !logOk(k) || !logOk(k + 1)) continue;
    const u0 = Math.log(freqs[k - 1]);
    const u1 = Math.log(freqs[k]);
    const u2 = Math.log(freqs[k + 1]);
    if (!(u1 > u0) || !(u2 > u1)) continue;
    const g0 = Math.log(psd[k - 1]);
    const g1 = Math.log(psd[k]);
    const g2 = Math.log(psd[k + 1]);
    curv[k] = (2 * ((g2 - g1) / (u2 - u1) - (g1 - g0) / (u1 - u0))) / (u2 - u0);
  }
  const curvAt = (k: number): number => {
    if (Number.isFinite(curv[k])) return curv[k];
    if (k === 0 && n > 2 && Number.isFinite(curv[1])) return curv[1];
    if (k === n - 1 && n > 2 && Number.isFinite(curv[n - 2])) return curv[n - 2];
    return Number.NaN;
  };
  let total = 0;
  for (let k = 1; k < n; k++) {
    const f1 = freqs[k - 1];
    const f2 = freqs[k];
    const s1 = psd[k - 1];
    const s2 = psd[k];
    if (!(f2 > f1)) continue;
    if (f1 > 0 && s1 > 0 && s2 > 0) {
      const r = f2 / f1;
      const du = Math.log(r);
      const a = Math.log(s2 / s1) / du;
      const e = a + 1;
      let part = Math.abs(e) < 1e-9 ? s1 * f1 * du : (s1 * f1 * (Math.pow(r, e) - 1)) / e;
      const ca = curvAt(k - 1);
      const cb = curvAt(k);
      const c = Number.isFinite(ca) && Number.isFinite(cb) ? (ca + cb) / 2 : Number.isFinite(ca) ? ca : cb;
      if (Number.isFinite(c)) {
        const corr = (c * du * du) / 12;
        if (Math.abs(corr) <= 0.1) part *= 1 - corr;
      }
      total += part;
    } else {
      total += 0.5 * (f2 - f1) * (s1 + s2);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------------------------

/** Noise quantities at one frequency. */
export interface NoisePoint {
  /** Output PSD (V²/Hz or A²/Hz). */
  onoise: number;
  /** |output / input| transfer. */
  gain: number;
  /** Input-referred PSD (NaN when the gain is zero). */
  inoise: number;
  /** Output PSD of every generator, in generator order. */
  contributions: Float64Array;
}

/** Factored small-signal system plus output, input and generators of a noise analysis. */
export class NoiseEvaluator {
  readonly circuit: Circuit;
  readonly acs: AcSystem;
  readonly output: OutputFunctional;
  readonly input: SourceRef;
  readonly generators: NoiseGenerator[];
  readonly warnings: string[];
  private readonly cRe: Float64Array;
  private readonly cIm: Float64Array;

  constructor(ctx: AnalysisContext, output: string, ref: string | undefined, src: string, what: string) {
    const circuit = ctx.buildCircuit();
    this.circuit = circuit;
    const sys = computeOperatingPoint(circuit, ctx.signal);
    this.acs = new AcSystem(circuit, sys.x, sys.states[0]);
    this.output = noiseOutput(circuit, output, ref, what);
    this.input = findSource(circuit, src, what);
    this.generators = collectNoiseGenerators(circuit, sys.x);
    this.warnings = [...circuit.warnings];
    for (const name of this.acs.missingAcModels) this.warnings.push(`${name}: no small-signal model, ignored in ${what.toLowerCase()}`);
    this.cRe = outputVector(this.output, circuit.size);
    this.cIm = new Float64Array(circuit.size);
  }

  /** Noise quantities at frequency f (Hz). */
  at(f: number): NoisePoint {
    const acs = this.acs;
    acs.assemble(2 * Math.PI * f);
    acs.factor();
    const z = acs.solveTranspose(this.cRe, this.cIm);
    const zr = z.re;
    const zi = z.im;
    const contributions = new Float64Array(this.generators.length);
    let onoise = 0;
    this.generators.forEach((g, k) => {
      const hr = (g.pos >= 0 ? zr[g.pos] : 0) - (g.neg >= 0 ? zr[g.neg] : 0);
      const hi = (g.pos >= 0 ? zi[g.pos] : 0) - (g.neg >= 0 ? zi[g.neg] : 0);
      const s = (hr * hr + hi * hi) * g.density(f);
      contributions[k] = s;
      onoise += s;
    });
    const h = sourceGainFromAdjoint(this.input, zr, zi);
    const gain = Math.hypot(h.re, h.im);
    return { onoise, gain, inoise: gain > 0 ? onoise / (gain * gain) : Number.NaN, contributions };
  }

  /** Unit of the output PSD. */
  get outputPsdUnit(): VectorUnit {
    return this.output.unit === 'A' ? 'A^2/Hz' : 'V^2/Hz';
  }

  get outputDensityUnit(): VectorUnit {
    return this.output.unit === 'A' ? 'A/rtHz' : 'V/rtHz';
  }

  get inputPsdUnit(): VectorUnit {
    return this.input.type === 'I' ? 'A^2/Hz' : 'V^2/Hz';
  }

  get inputDensityUnit(): VectorUnit {
    return this.input.type === 'I' ? 'A/rtHz' : 'V/rtHz';
  }
}

/** Output functional of a noise analysis: node `output` (or "V(a[,b])", "I(Vx)") minus `ref`. */
function noiseOutput(circuit: Circuit, output: string, ref: string | undefined, what: string): OutputFunctional {
  const refName = ref?.trim();
  const hasRef = refName !== undefined && refName.length > 0 && refName !== '0' && refName.toLowerCase() !== 'gnd';
  const text = /\(/.test(output) ? output : hasRef ? `V(${output.trim()},${refName})` : output;
  const o = parseOutput(circuit, text, { what });
  if (hasRef && /\(/.test(output)) {
    if (o.kind !== 'voltage' || o.neg >= 0) throw new SimulationError(`${what}: reference node '${refName}' cannot be combined with output '${output}'`, 'netlist');
    return parseOutput(circuit, `V(${circuit.unknownName(o.pos)},${refName})`, { what });
  }
  return o;
}

// ---------------------------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------------------------

export function runNoise(spec: NoiseAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('noise');
  const ev = new NoiseEvaluator(ctx, spec.output, spec.ref, spec.src, what);
  const freqs = sweepFrequencies(spec.sweep, spec.points, spec.fstart, spec.fstop);
  const nf = freqs.length;
  const gens = ev.generators;
  const onoise = new Float64Array(nf);
  const inoise = new Float64Array(nf);
  const gain = new Float64Array(nf);
  const contrib = gens.map(() => new Float64Array(nf));
  let zeroGain = false;
  for (let k = 0; k < nf; k++) {
    ctx.checkAbort();
    const p = ev.at(freqs[k]);
    onoise[k] = p.onoise;
    inoise[k] = p.inoise;
    gain[k] = p.gain;
    if (!(p.gain > 0)) zeroGain = true;
    for (let g = 0; g < gens.length; g++) contrib[g][k] = p.contributions[g];
    if ((k & 7) === 7) ctx.progress((k + 1) / nf);
  }

  // group generators by device (in circuit order of first appearance)
  const byDevice = new Map<string, number[]>();
  gens.forEach((g, k) => {
    const list = byDevice.get(g.device);
    if (list) list.push(k);
    else byDevice.set(g.device, [k]);
  });

  const sqrtOf = (a: Float64Array) => a.map((v) => (v >= 0 ? Math.sqrt(v) : Number.NaN));
  const vectors: Vector[] = [
    { name: 'onoise_spectrum', unit: ev.outputDensityUnit, re: sqrtOf(onoise) },
    { name: 'onoise_psd', unit: ev.outputPsdUnit, re: onoise },
    { name: 'inoise_spectrum', unit: ev.inputDensityUnit, re: sqrtOf(inoise) },
    { name: 'inoise_psd', unit: ev.inputPsdUnit, re: inoise },
    { name: 'gain', unit: '', re: gain },
  ];
  const scalars: Record<string, number> = {};
  const onTotal = integrateSpectrum(freqs, onoise);
  const inTotal = zeroGain ? Number.NaN : integrateSpectrum(freqs, inoise);
  scalars.onoise_total_sq = onTotal;
  scalars.onoise_total = Math.sqrt(onTotal);
  scalars.inoise_total_sq = inTotal;
  scalars.inoise_total = Math.sqrt(inTotal);

  const rows: (string | number)[][] = [];
  for (const [device, idx] of byDevice) {
    const sum = new Float64Array(nf);
    for (const g of idx) for (let k = 0; k < nf; k++) sum[k] += contrib[g][k];
    vectors.push({ name: `onoise(${device})`, unit: ev.outputPsdUnit, re: sum });
    scalars[`onoise_total_sq(${device})`] = integrateSpectrum(freqs, sum);
    for (const g of idx) {
      const total = integrateSpectrum(freqs, contrib[g]);
      if (idx.length > 1) vectors.push({ name: `onoise(${device}:${gens[g].name})`, unit: ev.outputPsdUnit, re: contrib[g] });
      rows.push([device, gens[g].name, total, onTotal > 0 ? (100 * total) / onTotal : 0]);
    }
  }
  rows.sort((a, b) => (b[2] as number) - (a[2] as number));

  const warnings = [...ev.warnings];
  if (gens.length === 0) warnings.push('Noise analysis: the circuit contains no noise sources');
  if (zeroGain) warnings.push(`Noise analysis: the transfer from ${ev.input.name} to ${ev.output.name} is zero at some frequencies; input noise is undefined there`);
  const totalUnit = ev.output.unit === 'A' ? 'A^2' : 'V^2';
  return {
    type: 'noise',
    title: what,
    spec,
    scale: { name: 'frequency', unit: 'Hz', re: Float64Array.from(freqs) },
    vectors,
    scalars,
    table: { columns: ['Device', 'Generator', `Integrated output noise (${totalUnit})`, 'Share (%)'], rows },
    warnings,
  };
}

/** True when some resistor of value r (±1e-6 relative) shares a non-ground node with the source. */
function hasSourceResistor(ev: NoiseEvaluator, r: number): boolean {
  const srcNodes = new Set([ev.input.p, ev.input.n].filter((i) => i >= 0));
  for (const d of ev.circuit.devices) {
    if (d.type !== 'R') continue;
    const v = d.getParam?.('value');
    if (v === undefined || Math.abs(v - r) > 1e-6 * Math.abs(r)) continue;
    if (deviceNodes(ev.circuit, d).some((i) => srcNodes.has(i))) return true;
  }
  return false;
}

export function runNoiseFigure(spec: NoiseFigureAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('noisefig');
  if (!(spec.rsource > 0) || !Number.isFinite(spec.rsource)) {
    throw new SimulationError(`${what}: source resistance must be positive (got ${spec.rsource})`, 'netlist');
  }
  if (!(spec.freq > 0) || !Number.isFinite(spec.freq)) throw new SimulationError(`${what}: invalid frequency ${spec.freq}`, 'netlist');
  const ev = new NoiseEvaluator(ctx, spec.output, spec.ref, spec.src, what);
  const p = ev.at(spec.freq);
  if (!(p.gain > 0)) throw new SimulationError(`${what}: the transfer from ${ev.input.name} to ${ev.output.name} is zero`, 'netlist');
  const T = ev.circuit.tempK;
  const sSrc = ev.input.type === 'V' ? 4 * BOLTZ * T * spec.rsource : (4 * BOLTZ * T) / spec.rsource;
  const factor = p.inoise / sSrc;
  const nfDb = 10 * Math.log10(factor);
  const warnings = [...ev.warnings];
  if (!hasSourceResistor(ev, spec.rsource)) {
    warnings.push(
      `${what}: no ${spec.rsource} Ω resistor is connected to ${ev.input.name}; the noise figure assumes the source resistance is part of the circuit`,
    );
  }
  const scalars: Record<string, number> = {
    noise_figure: nfDb,
    noise_factor: factor,
    inoise_density: Math.sqrt(p.inoise),
    onoise_density: Math.sqrt(p.onoise),
    source_noise_density: Math.sqrt(sSrc),
    gain: p.gain,
    frequency: spec.freq,
  };
  return {
    type: 'noisefig',
    title: what,
    spec,
    vectors: [],
    scalars,
    table: {
      columns: ['Quantity', 'Value', 'Unit'],
      rows: [
        ['Noise figure', nfDb, 'dB'],
        ['Noise factor', factor, ''],
        ['Input-referred noise', Math.sqrt(p.inoise), ev.inputDensityUnit],
        ['Source resistance noise', Math.sqrt(sSrc), ev.inputDensityUnit],
        ['Output noise', Math.sqrt(p.onoise), ev.outputDensityUnit],
        ['Gain', p.gain, ''],
        ['Frequency', spec.freq, 'Hz'],
      ],
    },
    warnings,
  };
}
