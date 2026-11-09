/**
 * Ladder-diagram co-simulation: the `A_LADDER` code model runs the scan machine of src/ladder
 * inside a transient or interactive run, so the rungs a learner drew really switch the lamps,
 * contactors and motors of the schematic.
 *
 * Element layout
 *   A<name> <channel nodes…> <ref> MS_LADDER_<hash>
 *   The node list is built by the netlister (src/model/ladderBuild.ts) from the input and output
 *   modules placed on the schematic; `LadderIR.ports` (on the model card, together with the
 *   compiled program) says what each node is:
 *     ai  analog input channel — read in volts, compared by a comparison contact (AI0 …)
 *     di  digital input channel — thresholded by the machine itself, with hysteresis, at the scan
 *         boundary (I0.0 …); an unwired channel reads 0 V, that is "off"
 *     q   output channel — driven to `von` while its bit of the output image is 1 (Q0.0 …)
 *     aq  analog output channel — driven to the voltage last written to AQn by a MOV / ADD / …
 *         instruction, limited to ±vmax of the module
 *   `pwr` = 1, so the last node is the common (0 V) of the modules: every channel voltage is read
 *   against it and every output drives against it, exactly like the common terminal of a rack.
 *
 * Why the inputs are analog ports
 *   A controller samples its inputs once per scan, so there is nothing to gain from the shell's
 *   interpolated threshold crossings — and reading the channels as analog voltages lets every
 *   input module keep its OWN threshold and hysteresis (24 V modules next to 5 V ones), which a
 *   single element-wide threshold could not do.
 *
 * Time
 *   Scans run at the fixed period of the program (`LadderIR.scan`): after every scan the model
 *   asks to be woken at the next one (`io.wake`), which the engine turns into a breakpoint, so a
 *   timepoint always falls exactly on a scan boundary and the timers accumulate exact multiples
 *   of the period. In the operating point nothing runs and every output is off, which is the state
 *   of a controller that has not started yet — so every analysis starts the program from scan 1.
 *
 * Read-outs
 *   With `debug` = 1 (the default) the images, timers, counters and the conducting state of every
 *   drawn element are published as derived outputs (src/ladder/probes.ts), which is what the
 *   ladder editor highlights while the simulation runs.
 */
import { LadderMachine } from '../../../ladder/machine';
import { decodeLadderIr, type LadderIR } from '../../../ladder/program';
import { fillLadderProbes, ladderProbeKeys } from '../../../ladder/probes';
import { REF, netlistError, type AnalogOutputSpec, type BehaviourFactory, type EvalIO } from './behaviour';

/** At most this many scans are caught up inside one accepted timestep. */
const MAX_CATCHUP = 2000;

function reached(now: number, t: number): boolean {
  return now >= t - Math.max(1e-15, 1e-9 * Math.abs(t));
}

const ladder: BehaviourFactory = (ctx) => {
  const text = ctx.p.text('prog');
  if (!text) throw netlistError(ctx.name, 'ladder element without a program (model parameter `prog`)');
  let ir: LadderIR;
  try {
    ir = decodeLadderIr(text);
  } catch (e) {
    throw netlistError(ctx.name, e instanceof Error ? e.message : 'ladder program cannot be read');
  }
  if (ir.ports.length !== ctx.ports) throw netlistError(ctx.name, `expected ${ir.ports.length} channel nodes, got ${ctx.ports}`);
  const slew = ctx.p.positive('edge', 1e-6);
  const rout = ctx.p.positive('rout', 1);
  const debug = ctx.p.flag('debug', true);

  const machine = new LadderMachine(ir);
  /** port index -> index in io.analog */
  const analogPorts: number[] = [];
  const aoutputs: AnalogOutputSpec[] = [];
  const outPorts: number[] = [];
  ir.ports.forEach((p, port) => {
    if (p.kind === 'q') {
      outPorts.push(port);
      aoutputs.push({ port, lo: REF, hi: REF, span: 1, fullScale: Math.max(1e-9, Math.abs(p.von)), slew, delay: 0, rout });
    } else if (p.kind === 'aq') {
      // an analog output channel drives its pin to the value last written to AQn (limited to ±vmax)
      outPorts.push(port);
      aoutputs.push({ port, lo: REF, hi: REF, span: 1, fullScale: Math.max(1e-9, 2 * Math.abs(p.vmax)), slew, delay: 0, rout });
    } else analogPorts.push(port);
  });

  let started = false;
  let nextScan = 0;
  const probe: Record<string, number> = {};
  for (const k of ladderProbeKeys(ir)) probe[k] = 0;

  const feed = (io: EvalIO): void => {
    analogPorts.forEach((port, k) => machine.setPortVoltage(port, io.analog[k]));
  };

  const write = (io: EvalIO): void => {
    outPorts.forEach((port, k) => (io.aout[k] = machine.portOutput(port)));
  };

  return {
    inputs: [],
    analog: analogPorts,
    outputs: [],
    aoutputs,
    state: 0,
    // the machine lives in this closure, so it must not be evaluated speculatively: the shell only
    // calls eval() at accepted timepoints in a transient, and the operating point runs no scan
    alwaysEval: false,
    // a real input channel is a few kΩ, not an open circuit: without a load an OPEN switch
    // (1 GΩ off-resistance) would leave the channel sitting at the supply and read "on"
    defaults: { rin: 1e5 },

    init() {
      machine.reset();
      started = false;
      nextScan = 0;
    },

    eval(io) {
      if (io.dc) {
        for (let k = 0; k < aoutputs.length; k++) io.aout[k] = 0;
        return;
      }
      if (!started) {
        started = true;
        nextScan = io.now;
      }
      feed(io);
      let ran = 0;
      let last = io.now;
      while (reached(io.now, nextScan) && ran < MAX_CATCHUP) {
        last = nextScan;
        machine.scan(nextScan);
        nextScan += ir.scan;
        ran++;
      }
      if (ran > 0 && last > io.prevTime && last <= io.now) io.setTime(last);
      // land a timepoint exactly on the next scan boundary
      if (nextScan > io.now) io.wake(nextScan);
      write(io);
    },

    probes: debug
      ? () => {
          fillLadderProbes(machine, probe);
          return probe;
        }
      : undefined,

    setParam(key, value) {
      if (key === 'reset') {
        if (value !== 0) {
          machine.reset();
          started = false;
        }
        return true;
      }
      return false;
    },

    getParam(key) {
      if (key === 'scans') return machine.scans;
      return undefined;
    },
  };
};

export const LADDER_BEHAVIOURS: Record<string, BehaviourFactory> = { A_LADDER: ladder };
