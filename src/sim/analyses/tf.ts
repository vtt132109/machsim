/**
 * Small-signal DC transfer function ('tf'), as SPICE .TF.
 *
 * The circuit is linearised at its operating point; the DC small-signal matrix is the AC matrix
 * at ω = 0 (capacitors open, inductors short). With every independent source set to zero (V
 * shorted, I opened — automatically the case because only the chosen excitation is placed on the
 * right-hand side):
 *   gain  = output produced by a unit value of the input source `src`
 *           (V/V, A/V, V/A or A/A depending on output and source types);
 *   rin   = resistance seen by the input source: V source: 1 / (current it delivers per volt);
 *           I source: voltage across it per ampere (V(n−) − V(n+), the source pushes into n−);
 *   rout  = output resistance: for V(a,b) the voltage between a and b per ampere injected into a
 *           and drawn from b; for I(X) of an element with a branch unknown the resistance seen by
 *           a voltage inserted in series with X (1 / current per volt). Derived device outputs
 *           (e.g. I(R1)) have no defined output resistance (NaN, with a warning).
 * Infinite values (open input, zero current) are reported as Infinity.
 *
 * Result: scalars { gain, rin, rout }, the same values as one-sample vectors "gain", "rin",
 * "rout", and a table with descriptive rows.
 */
import type { TfAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type VectorUnit } from '../results';
import { AcSystem } from '../engine/ac';
import type { AnalysisContext } from '../engine/analysis-registry';
import { computeOperatingPoint } from '../engine/analyses';
import { analysisTitle } from '../engine/titles';
import { addSourceExcitation, applyOutput, findSource, parseOutput } from './util';

function gainUnit(out: VectorUnit, input: 'V' | 'I'): string {
  if (out === 'A') return input === 'V' ? 'A/V' : 'A/A';
  return input === 'V' ? 'V/V' : 'V/A';
}

function reciprocal(v: number): number {
  return v === 0 ? Infinity : 1 / v;
}

export function runTf(spec: TfAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('tf');
  const circuit = ctx.buildCircuit();
  const sys = computeOperatingPoint(circuit, ctx.signal);
  const output = parseOutput(circuit, spec.output, { allowDevice: true, x0: sys.x, what });
  const src = findSource(circuit, spec.src, what);
  const acs = new AcSystem(circuit, sys.x, sys.states[0]);
  acs.assemble(0);
  acs.factor();
  const n = circuit.size;
  const warnings = [...circuit.warnings];

  // unit input excitation
  const bRe = new Float64Array(n);
  const bIm = new Float64Array(n);
  addSourceExcitation(src, 1, 0, bRe, bIm);
  const x = acs.solve(bRe, bIm).re;
  const gain = applyOutput(output, x);
  let rin: number;
  if (src.type === 'V') {
    rin = reciprocal(-x[src.branch]);
  } else {
    rin = (src.n >= 0 ? x[src.n] : 0) - (src.p >= 0 ? x[src.p] : 0);
  }

  // output resistance
  let rout: number;
  bRe.fill(0);
  if (output.kind === 'voltage') {
    if (output.pos >= 0) bRe[output.pos] += 1;
    if (output.neg >= 0) bRe[output.neg] -= 1;
    const y = acs.solve(bRe, bIm).re;
    rout = (output.pos >= 0 ? y[output.pos] : 0) - (output.neg >= 0 ? y[output.neg] : 0);
  } else if (output.kind === 'branch') {
    bRe[output.branch] = 1;
    const y = acs.solve(bRe, bIm).re;
    rout = reciprocal(-y[output.branch]);
  } else {
    rout = Number.NaN;
    warnings.push(`${what}: output resistance is not defined for the device output ${output.name}`);
  }
  if (!Number.isFinite(gain)) throw new SimulationError(`${what}: transfer function of ${output.name} is not finite`, 'singular');

  const scalars = { gain, rin, rout };
  return {
    type: 'tf',
    title: what,
    spec,
    vectors: [
      { name: 'gain', unit: '', re: Float64Array.of(gain) },
      { name: 'rin', unit: 'Ohm', re: Float64Array.of(rin) },
      { name: 'rout', unit: 'Ohm', re: Float64Array.of(rout) },
    ],
    scalars,
    table: {
      columns: ['Quantity', 'Value', 'Unit'],
      rows: [
        [`Transfer function ${output.name}/${src.name}`, gain, gainUnit(output.unit, src.type)],
        [`Input resistance at ${src.name}`, rin, 'Ohm'],
        [`Output resistance at ${output.name}`, rout, 'Ohm'],
      ],
    },
    warnings,
  };
}
