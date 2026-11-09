/**
 * Mechatronics co-simulation: the `A_MECHA` code model puts one model of src/mecha (conveyor
 * belt, signalled junction, liquid tank, garage door, lift) around the electrical shell of
 * core.ts, so the circuit drives a machine and reads its sensors.
 *
 * Element layout
 *   A<name> <input pins…> <sensor pins…> <report nodes…> <ref> MS_MECHA_<kind>_<hash>
 *   - the input pins are ordinary digital inputs of the shell (threshold `vth`, hysteresis
 *     `vhys`, and a load `rin` so a lamp pin really draws current from its driver);
 *   - every sensor pin is an analog output stage: 0 V or `vout` for a switch, and `vref` × the
 *     measured fraction for an analog sensor (the tank's level transmitter);
 *   - the report nodes carry the state the schematic drawing animates (1 V per unit of the
 *     model: % of travel, litres, item positions in m …). They are internal nodes of the part,
 *     so they also plot in the Grapher.
 *   - `pwr` = 1: the last node is the common the whole part is referred to.
 *
 * Time
 *   A machine is continuous, so the model is advanced at every accepted timepoint by the time
 *   since the previous one and asks for a wake-up `tmax` seconds later (default 10 ms), which
 *   keeps the integration error small and makes a sensor switch on time. In the operating point
 *   nothing moves: the model shows its starting state, which is what the circuit sees before the
 *   simulation starts.
 */
import { createMecha, mechaNodeCount, type MechaModel } from '../../../mecha/models';
import { REF, netlistError, range, type AnalogOutputSpec, type BehaviourFactory } from './behaviour';

const mecha: BehaviourFactory = (ctx) => {
  const kind = (ctx.p.text('kind') ?? '').trim();
  const p = ctx.p;
  const model: MechaModel | undefined = createMecha(kind, (key, def) => p.num(key, def));
  if (!model) throw netlistError(ctx.name, `unknown mechatronics model '${kind}'`);
  const spec = model.spec;
  const nIn = spec.inputs.length;
  const nOut = spec.outputs.length;
  const nRep = spec.reports.length;
  if (ctx.ports !== mechaNodeCount(spec)) {
    throw netlistError(ctx.name, `expected ${mechaNodeCount(spec)} nodes (${[...spec.inputs, ...spec.outputs.map((o) => o.name), ...spec.reports].join(' ')}), got ${ctx.ports}`);
  }
  const vout = p.num('vout', 24);
  const vref = p.num('vref', 10);
  const slew = p.positive('edge', 1e-4);
  const rout = p.positive('rout', 10);
  const rrep = p.positive('rrep', 1e3);
  const tmax = p.positive('tmax', 0.01);

  const scaleOf = (k: number): number => (spec.outputs[k].analog ? vref : vout);
  const aoutputs: AnalogOutputSpec[] = [
    ...spec.outputs.map((_o, k) => ({ port: nIn + k, lo: REF, hi: REF, span: 1, fullScale: Math.max(1e-9, Math.abs(scaleOf(k))), slew, delay: 0, rout })),
    ...spec.reports.map((_r, k) => ({ port: nIn + nOut + k, lo: REF, hi: REF, span: 1, fullScale: 100, slew, delay: 0, rout: rrep })),
  ];

  /** time of the last integration step (-1 before the transient started) */
  let last = -1;
  /** time the model asked to be woken at; only one wake-up is ever outstanding */
  let nextWake = -1;
  const write = (aout: Float64Array): void => {
    for (let k = 0; k < nOut; k++) aout[k] = model.out(k) * scaleOf(k);
    for (let k = 0; k < nRep; k++) aout[nOut + k] = model.report(k);
  };

  return {
    inputs: range(0, nIn),
    outputs: [],
    aoutputs,
    state: 0,
    // a machine moves whether or not an input changed
    alwaysEval: true,
    defaults: { vth: vout / 2, vhys: vout / 10, rin: 1e6 },

    init() {
      model.reset();
      last = -1;
      nextWake = -1;
    },

    eval(io) {
      if (io.dc) {
        write(io.aout);
        return;
      }
      if (last < 0) last = io.now;
      const dt = io.now - last;
      // the shell may evaluate twice at one timepoint (a wake-up in the same step): only the
      // first evaluation advances time
      if (dt > 0) {
        model.step(dt, io.in);
        last = io.now;
      }
      // keep exactly one wake-up outstanding, so the machine is advanced at least every `tmax`
      // without filling the engine's breakpoint list
      if (nextWake < 0 || io.now >= nextWake - 1e-12) {
        nextWake = io.now + tmax;
        io.wake(nextWake);
      }
      write(io.aout);
    },

    setParam(key, value) {
      if (key === 'reset') {
        if (value !== 0) {
          model.reset();
          last = -1;
        }
        return true;
      }
      return false;
    },
  };
};

export const MECHA_BEHAVIOURS: Record<string, BehaviourFactory> = { A_MECHA: mecha };
