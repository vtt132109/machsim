/**
 * Incremental transient simulation for interactive mode (src/sim/api.ts TransientStepper).
 *
 * The stepper runs the same {@link TransientEngine} as the .tran analysis with an open-ended
 * stop time, so a run advanced in chunks produces exactly the same accepted timepoints as one
 * long run with the same settings. advance(tUntil) keeps taking accepted steps while the
 * simulated time is below tUntil (the last step may pass tUntil by less than one step; the next
 * call continues from there). The first chunk also contains the initial point at t = 0.
 *
 * setParam(element, param, value) changes a device parameter between chunks (sources: "dc",
 * "acmag", waveform parameters such as "freq", "ampl", "offset", "per"; R/C/L: "value";
 * switches: "value" 1/0 forces the state) and restarts integration at order 1.
 */
import type { CreateTransientStepper, StepperOptions, TransientChunk, TransientStepper } from '../api';
import type { Netlist } from '../netlist';
import { SimulationError } from '../results';
import { flattenNetlist } from '../spice/flatten';
import { Circuit } from './circuit';
import { ProbeEvaluator, Recorder, selectProbes, type Probe } from './outputs';
import { TransientEngine } from './transient';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class InteractiveStepper implements TransientStepper {
  readonly circuit: Circuit;
  readonly engine: TransientEngine;
  /** Warnings from circuit construction and output selection. */
  readonly warnings: string[];
  private readonly probes: Probe[];
  private readonly evaluator: ProbeEvaluator;
  private readonly values: Float64Array;
  private readonly recorder: Recorder;
  private readonly latestValues: Float64Array;
  /** devices that can ask for the simulation to be held (microcontroller debugger) */
  private readonly holdDevices: { holdRequested?(): boolean }[];
  private heldNow = false;

  constructor(netlist: Netlist, opts: StepperOptions) {
    this.circuit = new Circuit(flattenNetlist(netlist));
    this.engine = new TransientEngine(this.circuit, {
      tstep: opts.tstep,
      tstop: Infinity,
      tmax: opts.tmax,
      uic: opts.uic,
    });
    const sel = selectProbes(this.circuit, opts.saves ?? [], { deviceOutputs: false });
    this.probes = sel.probes;
    this.warnings = [...this.circuit.warnings, ...sel.warnings];
    this.evaluator = new ProbeEvaluator(this.probes);
    this.values = new Float64Array(this.probes.length);
    this.latestValues = new Float64Array(this.probes.length);
    this.recorder = new Recorder(this.probes, false, 1024);
    this.holdDevices = this.circuit.devices.filter((d) => typeof d.holdRequested === 'function');
    this.engine.initialize();
    this.record();
  }

  get held(): boolean {
    return this.heldNow;
  }

  get time(): number {
    return this.engine.time;
  }

  private record(): void {
    this.evaluator.evaluate(this.engine.solution, this.values);
    this.latestValues.set(this.values);
    this.recorder.push(this.engine.time, this.values);
  }

  advance(tUntil: number, maxWallMs = Infinity): TransientChunk {
    const t0 = now();
    this.heldNow = false;
    while (this.engine.time < tUntil) {
      if (this.holdDevices.length > 0 && this.holdDevices.some((d) => d.holdRequested?.())) {
        this.heldNow = true;
        break;
      }
      this.engine.step();
      this.record();
      if (now() - t0 >= maxWallMs) break;
    }
    const { scale, cols } = this.recorder.slice(0);
    this.recorder.compact(0);
    const vectors: Record<string, Float64Array> = {};
    this.probes.forEach((p, k) => {
      vectors[p.name] = cols[k];
    });
    return { time: scale, vectors };
  }

  setParam(element: string, param: string, value: number): void {
    const d = this.circuit.findDevice(element);
    if (!d) throw new SimulationError(`setParam: element '${element}' not found`, 'netlist');
    if (!d.setParam) throw new SimulationError(`setParam: element '${d.name}' has no adjustable parameters`, 'unsupported');
    d.setParam(param, value);
    this.engine.discontinuity();
  }

  vectorNames(): string[] {
    return this.probes.map((p) => p.name);
  }

  latest(): Record<string, number> {
    const out: Record<string, number> = {};
    this.probes.forEach((p, k) => {
      out[p.name] = this.latestValues[k];
    });
    return out;
  }
}

export const createTransientStepper: CreateTransientStepper = (netlist: Netlist, opts: StepperOptions) =>
  new InteractiveStepper(netlist, opts);
