/**
 * Small-signal distortion analysis ('disto'): harmonic distortion HD2 / HD3 and, with
 * f2overf1, intermodulation products, by the Volterra-series (harmonic input) method of SPICE.
 *
 * Inputs: every independent source with DISTOF1 (magnitude, phase°) drives tone f1; with
 * f2overf1 every source with DISTOF2 drives tone f2 = f2overf1·f1 (0 < f2overf1 < 1). When no
 * source has DISTOF1 the AC magnitudes/phases are used instead (warning); when no source has
 * DISTOF2 the f1 sources drive f2 too (warning).
 *
 * With Y(jω) = G + jωC the AC matrix at the operating point and i2, q2, i3, q3 the higher-order
 * forms of the resistive currents and charges (nonlinear.ts), the phasors of the response are
 * (x(t) = Σ Re{X e^{jΩt}}):
 *   single tone, first order   Y(jω) X1 = B1
 *   2nd harmonic (2ω)          Y(j2ω) X2 = −¼·(i2 + j2ω q2)[X1, X1]
 *   3rd harmonic (3ω)          Y(j3ω) X3 = −[½·(i2 + j3ω q2)[X1, X2] + (1/24)·(i3 + j3ω q3)[X1, X1, X1]]
 *   two tones Xa (ω1), Xb (ω2)
 *   sum IM2 (ω1+ω2)            Y X = −½·(i2 + jΩ q2)[Xa, Xb]
 *   difference IM2 (ω1−ω2)     Y X = −½·(i2 + jΩ q2)[Xa, Xb*]
 *   IM3 (2ω1−ω2)               Y X = −[⅛·T[Xa, Xa, Xb*] + ½·B[Xb*, X2a] + ½·B[Xa, Xd]]  (each with i + jΩ q)
 *                              where X2a is the 2ω1 response and Xd the difference response.
 * These are exact for weak nonlinearity (amplitudes small compared with the curvature scale of
 * the devices); they scale as amplitude² (HD2, IM2) and amplitude³ (HD3, IM3).
 *
 * Result (scale "frequency" = f1): for every output o (netlist saves, default node voltages and
 * branch currents) complex phasor vectors
 *   single tone:  F1(o), HD2(o), HD3(o)   and real HD2rel(o) = |HD2|/|F1|, HD3rel(o) = |HD3|/|F1|
 *   two tones:    F1(o), IM2sum(o), IM2diff(o), IM3(o) and the matching ...rel(o) ratios to |F1|
 * Device-derived AC outputs (I(R1), ...) are evaluated at the frequency of each component.
 */
import type { DistoAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type Vector } from '../results';
import { AcSystem, sweepFrequencies } from '../engine/ac';
import type { AnalysisContext } from '../engine/analysis-registry';
import type { Circuit } from '../engine/circuit';
import { computeOperatingPoint } from '../engine/analyses';
import { evaluateComplexProbes, selectProbes, type Probe } from '../engine/outputs';
import { analysisTitle } from '../engine/titles';
import { NonlinearExpansion, conjugate, forcing, type ComplexVec } from './nonlinear';
import { addSourceExcitation, findSource, residualAt, setDcMode } from './util';

/** Excitation vector of the sources driving one tone. */
function toneExcitation(circuit: Circuit, which: 'distof1' | 'distof2'): { b: ComplexVec; count: number } {
  const n = circuit.size;
  const b: ComplexVec = { re: new Float64Array(n), im: new Float64Array(n) };
  let count = 0;
  for (const el of circuit.netlist.elements) {
    if (el.type !== 'V' && el.type !== 'I') continue;
    const d = el.source?.[which];
    if (!d || !Number.isFinite(d[0]) || d[0] === 0) continue;
    const ph = ((Number.isFinite(d[1]) ? d[1] : 0) * Math.PI) / 180;
    addSourceExcitation(findSource(circuit, el.name, analysisTitle('disto')), d[0] * Math.cos(ph), d[0] * Math.sin(ph), b.re, b.im);
    count++;
  }
  return { b, count };
}

function acExcitation(circuit: Circuit): { b: ComplexVec; count: number } {
  const n = circuit.size;
  const b: ComplexVec = { re: new Float64Array(n), im: new Float64Array(n) };
  let count = 0;
  for (const el of circuit.netlist.elements) {
    if (el.type !== 'V' && el.type !== 'I') continue;
    const mag = el.source?.acMag ?? 0;
    if (!Number.isFinite(mag) || mag === 0) continue;
    const ph = ((el.source?.acPhase ?? 0) * Math.PI) / 180;
    addSourceExcitation(findSource(circuit, el.name, analysisTitle('disto')), mag * Math.cos(ph), mag * Math.sin(ph), b.re, b.im);
    count++;
  }
  return { b, count };
}

/** Linear solver Y(jω) X = rhs on the operating-point AC system. */
class AcSolver {
  constructor(private readonly acs: AcSystem) {}

  solve(omega: number, rhs: ComplexVec, negate = false): ComplexVec {
    this.acs.assemble(omega);
    this.acs.factor();
    const s = negate ? -1 : 1;
    const br = rhs.re.map((v) => s * v);
    const bi = rhs.im.map((v) => s * v);
    const x = this.acs.solve(br, bi);
    return { re: x.re.slice(), im: x.im.slice() };
  }
}

/** Collects one complex column per probe for a named component. */
class ComponentRecorder {
  readonly re: Float64Array[];
  readonly im: Float64Array[];
  private readonly tr: Float64Array;
  private readonly ti: Float64Array;

  constructor(
    private readonly probes: Probe[],
    nf: number,
  ) {
    this.re = probes.map(() => new Float64Array(nf));
    this.im = probes.map(() => new Float64Array(nf));
    this.tr = new Float64Array(probes.length);
    this.ti = new Float64Array(probes.length);
  }

  record(k: number, x: ComplexVec, omega: number): void {
    evaluateComplexProbes(this.probes, x.re, x.im, omega, this.tr, this.ti);
    for (let j = 0; j < this.probes.length; j++) {
      this.re[j][k] = this.tr[j];
      this.im[j][k] = this.ti[j];
    }
  }
}

export function runDisto(spec: DistoAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('disto');
  const twoTone = spec.f2overf1 !== undefined;
  const ratio = spec.f2overf1 ?? 0;
  if (twoTone && !(ratio > 0 && ratio < 1)) throw new SimulationError(`${what}: f2overf1 must be between 0 and 1 (got ${ratio})`, 'netlist');
  const freqs = sweepFrequencies(spec.sweep, spec.points, spec.fstart, spec.fstop);
  const nf = freqs.length;
  const circuit = ctx.buildCircuit();
  const sys = computeOperatingPoint(circuit, ctx.signal);
  const x0 = sys.x.slice();
  const warnings = [...circuit.warnings];

  let tone1 = toneExcitation(circuit, 'distof1');
  if (tone1.count === 0) {
    tone1 = acExcitation(circuit);
    if (tone1.count === 0) throw new SimulationError(`${what}: no source has a DISTOF1 or AC specification`, 'netlist');
    warnings.push(`${what}: no source has DISTOF1; the AC magnitudes and phases drive tone f1`);
  }
  let tone2 = tone1;
  if (twoTone) {
    const t2 = toneExcitation(circuit, 'distof2');
    if (t2.count > 0) tone2 = t2;
    else warnings.push(`${what}: no source has DISTOF2; the f1 sources also drive tone f2`);
  }

  // device caches exactly at x0 before the AC system is built
  setDcMode(sys);
  residualAt(sys, x0, new Float64Array(circuit.size));
  const acs = new AcSystem(circuit, x0, sys.states[0]);
  for (const name of acs.missingAcModels) warnings.push(`${name}: no small-signal model, ignored in ${what.toLowerCase()}`);
  const solver = new AcSolver(acs);
  const fmax = Math.max(...freqs);
  const nl = new NonlinearExpansion(sys, x0, 2 * Math.PI * fmax * (twoTone ? 2 : 3));
  if (nl.isLinear) warnings.push(`${what}: the circuit is linear; all distortion products are zero`);

  const sel = selectProbes(circuit, ctx.netlist.saves, { deviceOutputs: false, ac: true });
  warnings.push(...sel.warnings);
  const names = twoTone ? ['F1', 'IM2sum', 'IM2diff', 'IM3'] : ['F1', 'HD2', 'HD3'];
  const recs = names.map(() => new ComponentRecorder(sel.probes, nf));

  freqs.forEach((f, k) => {
    ctx.checkAbort();
    const w1 = 2 * Math.PI * f;
    if (!twoTone) {
      nl.restore();
      const x1 = solver.solve(w1, tone1.b);
      const f2 = forcing(nl.quadratic(x1), 2 * w1, 0.25);
      nl.restore();
      const x2 = solver.solve(2 * w1, f2, true);
      const bl = forcing(nl.bilinear(x1, x2), 3 * w1, 0.5);
      const cu = forcing(nl.cubic(x1), 3 * w1, 1 / 24);
      nl.restore();
      const x3 = solver.solve(3 * w1, { re: bl.re.map((v, i) => v + cu.re[i]), im: bl.im.map((v, i) => v + cu.im[i]) }, true);
      recs[0].record(k, x1, w1);
      recs[1].record(k, x2, 2 * w1);
      recs[2].record(k, x3, 3 * w1);
    } else {
      const w2 = ratio * w1;
      nl.restore();
      const xa = solver.solve(w1, tone1.b);
      const xb = solver.solve(w2, tone2.b);
      const xbc = conjugate(xb);
      const fs = forcing(nl.bilinear(xa, xb), w1 + w2, 0.5);
      const fd = forcing(nl.bilinear(xa, xbc), w1 - w2, 0.5);
      const f2a = forcing(nl.quadratic(xa), 2 * w1, 0.25);
      nl.restore();
      const xs = solver.solve(w1 + w2, fs, true);
      const xd = solver.solve(w1 - w2, fd, true);
      const x2a = solver.solve(2 * w1, f2a, true);
      const w3 = 2 * w1 - w2;
      const t1 = forcing(nl.mixedCubic(xa, xbc), w3, 1 / 8);
      const t2 = forcing(nl.bilinear(xbc, x2a), w3, 0.5);
      const t3 = forcing(nl.bilinear(xa, xd), w3, 0.5);
      nl.restore();
      const x3 = solver.solve(w3, { re: t1.re.map((v, i) => v + t2.re[i] + t3.re[i]), im: t1.im.map((v, i) => v + t2.im[i] + t3.im[i]) }, true);
      recs[0].record(k, xa, w1);
      recs[1].record(k, xs, w1 + w2);
      recs[2].record(k, xd, w1 - w2);
      recs[3].record(k, x3, w3);
    }
    ctx.progress((k + 1) / nf);
  });
  nl.restore();

  const vectors: Vector[] = [];
  sel.probes.forEach((p, j) => {
    names.forEach((name, c) => vectors.push({ name: `${name}(${p.name})`, unit: p.unit, re: recs[c].re[j], im: recs[c].im[j] }));
    const fr = recs[0].re[j];
    const fi = recs[0].im[j];
    for (let c = 1; c < names.length; c++) {
      const rel = new Float64Array(nf);
      for (let k = 0; k < nf; k++) {
        const m1 = Math.hypot(fr[k], fi[k]);
        rel[k] = m1 > 0 ? Math.hypot(recs[c].re[j][k], recs[c].im[j][k]) / m1 : Number.NaN;
      }
      vectors.push({ name: `${names[c]}rel(${p.name})`, unit: '', re: rel });
    }
  });
  return {
    type: 'disto',
    title: what,
    spec,
    scale: { name: 'frequency', unit: 'Hz', re: Float64Array.from(freqs) },
    vectors,
    warnings,
  };
}
