/**
 * Built-in analyses: operating point, DC sweep (nested), AC sweep, single-frequency AC and
 * transient. Registered in analysis-registry.ts.
 *
 * Result layout
 * - op:       one-sample vectors (node voltages, branch currents, every device output) and the
 *             same values in `scalars`.
 * - dc:       scale named after the swept source ("V1", "I2", "temp"); with src2, `runs` holds one
 *             result per outer value (label "V2=1.5") and the top-level vectors are the
 *             concatenation of all runs (scale repeats).
 * - ac:       scale "frequency" (Hz); complex vectors (re/im).
 * - acsingle: like ac with a single frequency.
 * - tran:     scale "time" (s) holding every accepted timepoint from tstart to tstop.
 */
import type { AcAnalysis, AcSingleAnalysis, DcAnalysis, OpAnalysis, TranAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type VectorUnit } from '../results';
import { AcSystem, sweepFrequencies } from './ac';
import type { AnalysisContext } from './analysis-registry';
import type { Circuit } from './circuit';
import { solveOperatingPoint } from './newton';
import { ProbeEvaluator, Recorder, evaluateComplexProbes, selectProbes } from './outputs';
import { RealSystem, type AbortFlag } from './system';
import { analysisTitle } from './titles';
import { TransientEngine } from './transient';

/**
 * Solve the DC operating point of a circuit and return the system holding it
 * (`sys.x` = solution, `sys.states[0]` = device states). Throws SimulationError on failure.
 */
export function computeOperatingPoint(circuit: Circuit, signal?: AbortFlag): RealSystem {
  const sys = new RealSystem(circuit);
  sys.signal = signal;
  solveOperatingPoint(sys, { mode: 'op' });
  return sys;
}

/** Build an AC system linearised at the operating point of `circuit` (solves the OP first). */
export function buildAcSystem(circuit: Circuit, signal?: AbortFlag): AcSystem {
  const sys = computeOperatingPoint(circuit, signal);
  return new AcSystem(circuit, sys.x, sys.states[0]);
}

export function runOp(spec: OpAnalysis, ctx: AnalysisContext): AnalysisResult {
  const circuit = ctx.buildCircuit();
  const sys = computeOperatingPoint(circuit, ctx.signal);
  const sel = selectProbes(circuit, ctx.netlist.saves, { deviceOutputs: true });
  const vals = new Float64Array(sel.probes.length);
  new ProbeEvaluator(sel.probes).evaluate(sys.x, vals);
  const scalars: Record<string, number> = {};
  const vectors = sel.probes.map((p, k) => {
    scalars[p.name] = vals[k];
    return { name: p.name, unit: p.unit, re: Float64Array.of(vals[k]) };
  });
  return { type: 'op', title: analysisTitle('op'), spec, vectors, scalars, warnings: [...circuit.warnings, ...sel.warnings] };
}

/** A swept quantity of a DC analysis. */
export interface SweepTarget {
  /** Scale vector name (the source name as written, or "temp"). */
  name: string;
  unit: VectorUnit;
  set(value: number): void;
  /** Restore the original value. */
  restore(): void;
}

/**
 * Resolve a DC sweep target: an independent V/I source (its "dc" value), "temp" (circuit
 * temperature, °C) or any other element exposing setParam("value").
 */
export function dcSweepTarget(circuit: Circuit, src: string): SweepTarget {
  if (src.trim().toLowerCase() === 'temp') {
    const old = circuit.temperature;
    return {
      name: 'temp',
      unit: 'degC',
      set: (v) => {
        circuit.temperature = v;
      },
      restore: () => {
        circuit.temperature = old;
      },
    };
  }
  const d = circuit.findDevice(src);
  if (!d) throw new SimulationError(`DC sweep: element '${src}' not found`, 'netlist');
  if (!d.setParam) throw new SimulationError(`DC sweep: element '${d.name}' cannot be swept`, 'unsupported');
  const param = d.type === 'V' || d.type === 'I' ? 'dc' : 'value';
  const unit: VectorUnit = d.type === 'V' ? 'V' : d.type === 'I' ? 'A' : '';
  const old = d.getParam?.(param);
  const setter = d.setParam.bind(d);
  return {
    name: d.name,
    unit,
    set: (v) => setter(param, v),
    restore: () => {
      if (old !== undefined) setter(param, old);
    },
  };
}

/** Values of a linear sweep start..stop by step (step sign is corrected; stop included when on the grid). */
export function sweepValues(start: number, stop: number, step: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(step)) {
    throw new SimulationError(`Sweep: invalid range ${start} .. ${stop} step ${step}`, 'netlist');
  }
  if (step === 0 || start === stop) return [start];
  const s = Math.abs(step) * Math.sign(stop - start);
  const n = Math.floor((stop - start) / s + 1e-9) + 1;
  if (n > 1e7) throw new SimulationError(`Sweep: too many points (${n})`, 'netlist');
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(start + k * s);
  return out;
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, '');
}

export function runDc(spec: DcAnalysis, ctx: AnalysisContext): AnalysisResult {
  const circuit = ctx.buildCircuit();
  const sys = new RealSystem(circuit);
  sys.signal = ctx.signal;
  const inner = dcSweepTarget(circuit, spec.src);
  const innerVals = sweepValues(spec.start, spec.stop, spec.step);
  const outer = spec.src2 ? dcSweepTarget(circuit, spec.src2.src) : undefined;
  const outerVals = spec.src2 ? sweepValues(spec.src2.start, spec.src2.stop, spec.src2.step) : [Number.NaN];
  const sel = selectProbes(circuit, ctx.netlist.saves, { deviceOutputs: false });
  const ev = new ProbeEvaluator(sel.probes);
  const vals = new Float64Array(sel.probes.length);
  const all = new Recorder(sel.probes, false, innerVals.length * outerVals.length);
  const runs: { label: string; result: AnalysisResult }[] = [];
  const total = innerVals.length * outerVals.length;
  let done = 0;
  let warm = false;
  try {
    for (const ov of outerVals) {
      if (outer) outer.set(ov);
      const rec = new Recorder(sel.probes, false, innerVals.length);
      for (const v of innerVals) {
        ctx.checkAbort();
        inner.set(v);
        solveOperatingPoint(sys, { mode: 'dc', warmStart: warm });
        warm = true;
        ev.evaluate(sys.x, vals);
        rec.push(v, vals);
        all.push(v, vals);
        done++;
        if ((done & 31) === 0) ctx.progress(done / total);
      }
      if (outer) {
        runs.push({
          label: `${outer.name}=${formatValue(ov)}`,
          result: {
            type: 'dc',
            title: `${analysisTitle('dc')} (${outer.name}=${formatValue(ov)})`,
            spec,
            scale: rec.scaleVector(inner.name, inner.unit),
            vectors: rec.vectors(),
            warnings: [],
          },
        });
      }
    }
  } finally {
    inner.restore();
    outer?.restore();
  }
  const result: AnalysisResult = {
    type: 'dc',
    title: analysisTitle('dc'),
    spec,
    scale: all.scaleVector(inner.name, inner.unit),
    vectors: all.vectors(),
    warnings: [...circuit.warnings, ...sel.warnings],
  };
  if (runs.length > 0) result.runs = runs;
  return result;
}

function acSweep(
  type: 'ac' | 'acsingle',
  spec: AcAnalysis | AcSingleAnalysis,
  freqs: number[],
  ctx: AnalysisContext,
): AnalysisResult {
  const circuit = ctx.buildCircuit();
  const acs = buildAcSystem(circuit, ctx.signal);
  const sel = selectProbes(circuit, ctx.netlist.saves, { deviceOutputs: false, ac: true });
  const rec = new Recorder(sel.probes, true, freqs.length);
  const vr = new Float64Array(sel.probes.length);
  const vi = new Float64Array(sel.probes.length);
  freqs.forEach((f, k) => {
    ctx.checkAbort();
    const omega = 2 * Math.PI * f;
    const sol = acs.solveAt(omega);
    evaluateComplexProbes(sel.probes, sol.re, sol.im, omega, vr, vi);
    rec.push(f, vr, vi);
    if ((k & 15) === 15) ctx.progress((k + 1) / freqs.length);
  });
  const warnings = [...circuit.warnings, ...sel.warnings];
  for (const name of acs.missingAcModels) warnings.push(`${name}: no small-signal model, ignored in AC analysis`);
  return {
    type,
    title: analysisTitle(type),
    spec,
    scale: rec.scaleVector('frequency', 'Hz'),
    vectors: rec.vectors(),
    warnings,
  };
}

export function runAc(spec: AcAnalysis, ctx: AnalysisContext): AnalysisResult {
  return acSweep('ac', spec, sweepFrequencies(spec.sweep, spec.points, spec.fstart, spec.fstop, spec.list), ctx);
}

export function runAcSingle(spec: AcSingleAnalysis, ctx: AnalysisContext): AnalysisResult {
  if (!Number.isFinite(spec.freq) || spec.freq < 0) throw new SimulationError(`Single-frequency AC: invalid frequency ${spec.freq}`, 'netlist');
  return acSweep('acsingle', spec, [spec.freq], ctx);
}

export function runTran(spec: TranAnalysis, ctx: AnalysisContext): AnalysisResult {
  const circuit = ctx.buildCircuit();
  const engine = new TransientEngine(circuit, {
    tstep: spec.tstep,
    tstop: spec.tstop,
    tstart: spec.tstart,
    tmax: spec.tmax,
    uic: spec.uic,
    signal: ctx.signal,
  });
  const sel = selectProbes(circuit, ctx.netlist.saves, { deviceOutputs: false });
  const ev = new ProbeEvaluator(sel.probes);
  const vals = new Float64Array(sel.probes.length);
  const span = engine.tstop - engine.tstart;
  // initial capacity only (the recorder grows by doubling): bounded so long runs with many
  // outputs do not reserve memory up front
  const estimate = Math.min(8192, Math.max(64, Math.ceil(span / engine.maxStep) + 64));
  const rec = new Recorder(sel.probes, false, estimate);
  engine.initialize();
  const tFirst = engine.tstart - engine.minBreak;
  if (engine.time >= tFirst) {
    ev.evaluate(engine.solution, vals);
    rec.push(engine.time, vals);
  }
  let n = 0;
  while (engine.step()) {
    if (engine.time >= tFirst) {
      ev.evaluate(engine.solution, vals);
      rec.push(engine.time, vals);
    }
    if ((++n & 63) === 0) ctx.progress(engine.time / engine.tstop);
  }
  return {
    type: 'tran',
    title: analysisTitle('tran'),
    spec,
    scale: rec.scaleVector('time', 's'),
    vectors: rec.vectors(),
    warnings: [...circuit.warnings, ...sel.warnings],
  };
}
