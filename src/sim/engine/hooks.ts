/**
 * Engine-side extensions of the device contract.
 *
 * The contract in src/sim/device.ts covers what every device must or may implement. The
 * optional members below are engine features that devices MAY additionally implement; the
 * engine detects them at runtime (duck typing), so devices from other modules keep working
 * without them. The linear devices (src/sim/devices/linear) use all of them.
 */
import type { Device } from '../device';
import type { SimOptions } from '../netlist';

/** Context passed to {@link EngineDeviceExtensions.accept} after a transient timepoint is accepted. */
export interface AcceptContext {
  /** Time of the accepted point (s). */
  readonly time: number;
  /** Step that led to it (0 for the initial point at t = 0). */
  readonly dt: number;
  /** Accepted solution value of unknown i (0 for GROUND). */
  x(i: number): number;
  /** State vector of the accepted point. */
  readonly state0: Float64Array;
  readonly options: SimOptions;
  /** Ask the engine to land exactly on time t (> current time) later in this run. */
  addBreakpoint(t: number): void;
}

/** Timing of the transient analysis a device is about to take part in. */
export interface TransientSetup {
  /** Nominal output step (s): default for waveform rise/fall times. */
  readonly tstep: number;
  /** Stop time (s), Infinity for open-ended interactive simulation. */
  readonly tstop: number;
}

/** Complex reader used by {@link EngineDeviceExtensions.acOutputs}. */
export type ComplexReader = (i: number) => { re: number; im: number };

export interface EngineDeviceExtensions {
  /**
   * True when load() stamps a matrix and right-hand side that do not depend on the Newton
   * iterate (linear devices). When every device is linear the engine solves each operating
   * point / timepoint with a single factorisation.
   */
  readonly linear?: boolean;
  /** Called before every transient run (reset history, resolve waveform defaults). */
  beginTransient?(setup: TransientSetup): void;
  /** Called for every accepted transient timepoint, including the initial point at t = 0. */
  accept?(ctx: AcceptContext): void;
  /** Upper bound on the transient timestep imposed by the device (Infinity if none). */
  maxTimestep?(): number;
  /**
   * Breakpoints in the half-open window (from, to], ascending. Preferred over
   * Device.breakpoints() by the open-ended interactive stepper, which asks for successive
   * windows instead of the whole run (periodic sources would otherwise produce ever longer lists).
   */
  breakpointsBetween?(from: number, to: number): number[];
  /**
   * True while the device wants the interactive simulation held at the present time (a debugger
   * stop of the microcontroller). The stepper stops after the timepoint that set it; the circuit
   * time is then exactly the time the device asked for.
   */
  holdRequested?(): boolean;
  /**
   * Initial values for the unknown vector before a UIC transient (e.g. inductor ic= sets its
   * branch current). Called after .ic node voltages have been applied.
   */
  initialConditions?(set: (index: number, value: number) => void): void;
  /**
   * Node voltages implied by a device's own initial condition in a UIC transient (capacitor
   * ic=). Called AFTER the initial charges / fluxes have been stored (which, as in SPICE, use the
   * .ic node voltages only), so these values only seed the reported t = 0 point and the first
   * Newton guess. `get` returns the value of an unknown that is already determined — ground
   * (index < 0) is 0, a .ic node, or a node set by an earlier device — and undefined otherwise;
   * `set` ignores unknowns that are already determined.
   */
  initialVoltages?(set: (index: number, value: number) => void, get: (index: number) => number | undefined): void;
  /** Complex small-signal versions of `outputs()` (AC analysis), keyed like outputs(). */
  acOutputs?(x: ComplexReader, omega: number): Record<string, { re: number; im: number }>;
}

/** A device as seen by the engine: contract members plus optional engine extensions. */
export type EngineDevice = Device & EngineDeviceExtensions;
