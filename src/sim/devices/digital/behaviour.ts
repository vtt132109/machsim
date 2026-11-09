/**
 * Behaviour API of the digital code models ('A' elements).
 *
 * A code model is split in two layers:
 * - the electrical shell (core.ts, {@link CodeModelDevice}): reads input voltages and turns
 *   them into logic values with thresholds / hysteresis, drives every output node through a
 *   Thevenin stage with propagation delay and finite slew, stores the logic state in the
 *   engine state vector and schedules breakpoints;
 * - a behaviour (this file's {@link Behaviour}): a pure logic function from input logic values
 *   (plus edges, internal state and timers) to desired output values.
 *
 * Behaviours never see voltages except through analog input ports (ADC, comparator, display
 * sensing) and never stamp the matrix. Each model type (ModelCard.type, e.g. 'D_NAND') maps to
 * a {@link BehaviourFactory} in registry.ts.
 *
 * Logic values: 0, 1 and {@link Z} (high impedance, outputs only). Inputs are always resolved
 * to 0 / 1 by the shell; there is no X state (see core.ts for the X / Z policy).
 */
import type { ModelCard } from '../../netlist';
import { SimulationError } from '../../results';

/** Logic low. */
export const LO = 0;
/** Logic high. */
export const HI = 1;
/** High impedance (outputs only). */
export const Z = 2;

export type LogicValue = 0 | 1 | 2;

/** Reference-node marker for {@link AnalogOutputSpec.lo} / {@link AnalogOutputSpec.hi}. */
export const REF = -1;

/** A digital output port driven through the Thevenin output stage. */
export interface OutputSpec {
  /** port index (position in the element's node list) */
  port: number;
  /** open-collector / open-drain: a logic 1 releases the pin (high impedance) */
  openDrain?: boolean;
  /** internal pull-up of an open-drain pin, ohms (the released pin is pulled to the high level) */
  pullup?: number;
}

/**
 * An analog output port: Thevenin source whose open-circuit voltage is
 *   V(lo) + s * (V(hi) - V(lo)) + s * span
 * where s is the behaviour's value (ramped). `lo` / `hi` are port indices or {@link REF}.
 * DAC: lo = VREF-, hi = VREF+, span = 0, s = code / 2^n. Display code: lo = hi = REF, span = 1.
 * The load current returns through the reference node (the references are only sensed).
 */
export interface AnalogOutputSpec {
  port: number;
  lo: number;
  hi: number;
  span: number;
  /** value change that takes `slew` seconds (e.g. 1 for a DAC fraction) */
  fullScale: number;
  /** time for a full-scale change of the output value (s, > 0) */
  slew: number;
  /** delay from the input event to the start of the change (s) */
  delay: number;
  /** output resistance (ohms, > 0) */
  rout: number;
}

/** Inputs / state / outputs handed to {@link Behaviour.eval}. */
export interface EvalIO {
  /** true while solving an operating point / DC sweep point: no edges, no timers */
  readonly dc: boolean;
  /** accepted timepoint being processed (0 in DC) */
  readonly now: number;
  /** previous accepted timepoint (equals `now` at the first point) */
  readonly prevTime: number;
  /** event time used to delay output changes (default: latest input crossing); see setTime */
  readonly time: number;
  /** current input logic values (0 / 1), indexed like Behaviour.inputs */
  readonly in: Uint8Array;
  /** input logic values at the previous accepted point (equal to `in` in DC) */
  readonly prev: Uint8Array;
  /** 1 when the input port is connected (0 for XSPICE NULL ports) */
  readonly present: Uint8Array;
  /** threshold-crossing time of each input that changed in this step (-Infinity when unchanged) */
  readonly cross: Float64Array;
  /** analog input voltages relative to the reference node, indexed like Behaviour.analog */
  readonly analog: Float64Array;
  /** analog input voltages at the previous accepted point */
  readonly analogPrev: Float64Array;
  /** internal state (persistent, stored in the engine state vector) */
  readonly st: Float64Array;
  /** desired digital outputs (0 / 1 / Z), prefilled with the previous values */
  readonly out: Uint8Array;
  /** desired analog output values, prefilled with the previous values */
  readonly aout: Float64Array;
  /** a time requested through wake() has been reached */
  readonly timer: boolean;
  /** 0 -> 1 transition of input i in this step */
  rising(i: number): boolean;
  /** 1 -> 0 transition of input i in this step */
  falling(i: number): boolean;
  /** logic value of input i at time t within the current step (value before / after its crossing) */
  at(i: number, t: number): number;
  /** use t (clamped to [prevTime, now]) as the event time of this evaluation */
  setTime(t: number): void;
  /** ask to be evaluated again at time t (transient only; ignored in DC) */
  wake(t: number): void;
}

export interface Behaviour {
  /** port indices read as digital inputs, in `io.in` order */
  inputs: number[];
  /** port indices read as analog voltages, in `io.analog` order */
  analog?: number[];
  /** digital outputs, in `io.out` order (a port may also be an input: bidirectional pin) */
  outputs: OutputSpec[];
  /** analog outputs, in `io.aout` order */
  aoutputs?: AnalogOutputSpec[];
  /** number of internal state slots */
  state: number;
  /** evaluate at every accepted timepoint (behaviours sensing analog inputs) */
  alwaysEval?: boolean;
  /** inputs have hysteresis by default (Schmitt trigger) when vtp / vtn are not given */
  schmitt?: boolean;
  /** model-parameter defaults of this behaviour (e.g. a weak rout for pull-ups) */
  defaults?: Record<string, number>;
  /** initialise the internal state (operating point start) */
  init?(io: EvalIO): void;
  /** compute io.out / io.aout (and update io.st) */
  eval(io: EvalIO): void;
  /**
   * Predicted time of the next analog-input event (e.g. a comparator threshold crossing
   * extrapolated from the last slope), called after each accepted point; the shell places a
   * breakpoint just after it when it falls within the next step.
   */
  predict?(io: EvalIO): number | undefined;
  /**
   * The behaviour wants the interactive simulation held at the present time (the microcontroller
   * debugger stopped at a breakpoint). See Device.holdRequested.
   */
  holdRequested?(): boolean;
  /** extra times the engine must place a timepoint at (the end of a debugger step), ascending */
  wakeTimes?(): number[];
  /** runtime parameter change (interactive simulation); false when the key is unknown */
  setParam?(key: string, value: number): boolean;
  /** current value of a runtime parameter */
  getParam?(key: string): number | undefined;
  /**
   * Internal read-outs published as derived device outputs (`Device.outputs`), so a panel can
   * watch them live and the Grapher can plot them. Keys become vector names `KEY(element)`; start
   * them with a letter the engine does not read as a unit (see engine/outputs.ts `unitForKey`) —
   * the MCU core uses the `M` prefix (`Mpc`, `Ma`, `Mp1` …). The key set must not change after
   * setup, because the engine asks for it once.
   */
  probes?(): Record<string, number>;
}

/** Everything a factory needs to lay out the ports of one element. */
export interface BehaviourContext {
  /** number of port nodes (supply nodes excluded) */
  readonly ports: number;
  /** connected ports (false for XSPICE NULL) */
  readonly present: readonly boolean[];
  readonly p: ParamReader;
  /** element name, for messages */
  readonly name: string;
}

export type BehaviourFactory = (ctx: BehaviourContext) => Behaviour;

// ---------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------

/** XSPICE bridge parameter names accepted as aliases of the MachSim names. */
const ALIASES: Record<string, string[]> = {
  vol: ['out_low'],
  voh: ['out_high'],
  vil: ['in_low'],
  vih: ['in_high'],
  rise_time: ['t_rise'],
  fall_time: ['t_fall'],
};

/**
 * Numeric parameter lookup for one element: instance parameter, then model parameter (both
 * under the name or one of its XSPICE aliases), then the behaviour default, then the caller's
 * default. Keys are lower-case.
 */
export class ParamReader {
  /** behaviour defaults, installed by the shell once the factory returned */
  fallback: Record<string, number> = {};

  constructor(
    private readonly inst: Record<string, number>,
    private readonly card: ModelCard,
    private readonly owner: string,
  ) {}

  private lookup(key: string): number | undefined {
    const names = [key, ...(ALIASES[key] ?? [])];
    for (const src of [this.inst, this.card.params]) {
      for (const k of names) {
        const v = src[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
    }
    const f = this.fallback[key];
    return typeof f === 'number' && Number.isFinite(f) ? f : undefined;
  }

  /** Parameter value or undefined. */
  get(key: string): number | undefined {
    return this.lookup(key);
  }

  num(key: string, def: number): number {
    return this.lookup(key) ?? def;
  }

  /** Non-negative value (throws a netlist error otherwise). */
  nonNeg(key: string, def: number): number {
    const v = this.num(key, def);
    if (!(v >= 0)) throw netlistError(this.owner, `parameter ${key} must be >= 0 (got ${v})`);
    return v;
  }

  /** Strictly positive value (throws a netlist error otherwise). */
  positive(key: string, def: number): number {
    const v = this.num(key, def);
    if (!(v > 0)) throw netlistError(this.owner, `parameter ${key} must be > 0 (got ${v})`);
    return v;
  }

  /** Integer value (rounded). */
  int(key: string, def: number): number {
    return Math.round(this.num(key, def));
  }

  /** Boolean flag: any non-zero value is true. */
  flag(key: string, def = false): boolean {
    const v = this.lookup(key);
    return v === undefined ? def : v !== 0;
  }

  /** Literal (non-numeric) model parameter. */
  text(key: string): string | undefined {
    return this.card.stringParams?.[key];
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers for behaviour authors
// ---------------------------------------------------------------------------------------------

export function netlistError(owner: string, message: string): SimulationError {
  return new SimulationError(`${owner}: ${message}`, 'netlist');
}

/** [start, start+1, ..., start+count-1] */
export function range(start: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => start + i);
}

/** Throw unless the element has exactly `expected` port nodes. */
export function expectPorts(ctx: BehaviourContext, expected: number, layout: string): void {
  if (ctx.ports !== expected) {
    throw netlistError(ctx.name, `expected ${expected} port nodes (${layout}), got ${ctx.ports}`);
  }
}

/** Unsigned integer from inputs start..start+n-1 (LSB first). */
export function word(io: EvalIO, start: number, n: number): number {
  let w = 0;
  for (let k = n - 1; k >= 0; k--) w = w * 2 + io.in[start + k];
  return w;
}

/** Same as {@link word} with each bit taken at time t of the current step. */
export function wordAt(io: EvalIO, start: number, n: number, t: number): number {
  let w = 0;
  for (let k = n - 1; k >= 0; k--) w = w * 2 + io.at(start + k, t);
  return w;
}

/** Write the n low bits of w to outputs start..start+n-1 (LSB first). */
export function setWord(io: EvalIO, start: number, n: number, w: number): void {
  let v = Math.max(0, Math.floor(w));
  for (let k = 0; k < n; k++) {
    io.out[start + k] = v % 2;
    v = Math.floor(v / 2);
  }
}

/** Crossing time of a linear segment (t0, v0) -> (t1, v1) with level `level`. */
export function crossingTime(t0: number, v0: number, t1: number, v1: number, level: number): number {
  if (!(t1 > t0) || v1 === v0) return t1;
  const t = t0 + ((level - v0) / (v1 - v0)) * (t1 - t0);
  return Math.min(t1, Math.max(t0, t));
}
