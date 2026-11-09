/**
 * Device <-> engine contract (SPICE3-style modified nodal analysis).
 *
 * CONTRACT FILE — implemented by the engine (src/sim/engine) and by every device
 * (src/sim/devices/**). Additive changes only.
 *
 * Unknown vector layout: indices 0..N-1 are node voltages (ground is NOT an unknown and
 * is represented by GROUND = -1), followed by extra branch unknowns (currents of voltage
 * sources, inductors, VCVS, CCVS, ...). Any matrix/rhs access with index GROUND is ignored
 * by the engine, so devices can stamp blindly.
 *
 * Sign conventions
 * - MNA row i of a node is KCL: sum of currents LEAVING the node through devices = 0.
 *   A conductance g between a and b stamps +g at (a,a),(b,b) and -g at (a,b),(b,a).
 *   A current source of value I flowing from a to b *through the device* (i.e. leaving node a)
 *   stamps rhs[a] -= I, rhs[b] += I.
 * - Branch current of a voltage source V (nodes p, n) is positive when it flows INTO the
 *   + terminal from the external circuit, through the source, and out of the − terminal
 *   (SPICE convention: a battery delivering power has a negative branch current).
 *
 * Newton linearisation: for a nonlinear current i(v) with derivative g at the iterate v0,
 * stamp conductance g and a current source ieq = i(v0) - g*v0 (in the i direction).
 */

import type { ElementIR, ElementType, ModelCard, SimOptions } from './netlist';

export const GROUND = -1;

export type IntegrationMethod = 'trap' | 'gear' | 'be';

/** Context given to Device.setup(): allocates unknowns and state slots. */
export interface SetupContext {
  /** Matrix index of a node (creates it on first use). Ground ("0", "gnd") returns GROUND. */
  node(name: string): number;
  /** Allocate an extra branch unknown (e.g. a voltage-source current). `label` is for diagnostics. */
  branch(label: string): number;
  /** Allocate `count` consecutive state slots; returns the base index into state vectors. */
  state(count: number): number;
  /** Look up a model card by (case-insensitive) name. */
  model(name: string): ModelCard | undefined;
  readonly options: SimOptions;
  warn(message: string): void;
}

/** Context given to Device.bind(): runs after every device's setup(). */
export interface BindContext {
  /** Find another device by (case-insensitive) instance name. */
  findDevice(name: string): Device | undefined;
  warn(message: string): void;
}

/** Real-valued load used by OP, DC sweep and transient Newton iterations. */
export interface LoadContext {
  readonly mode: 'op' | 'dc' | 'tran';
  /**
   * First Newton iteration of an operating-point solve started from scratch:
   * junction devices should use their initial-guess voltages (e.g. vcrit, or 0 if OFF)
   * instead of x().
   */
  readonly initJunctions: boolean;
  /** First Newton iteration at a new transient timepoint (x() holds the predicted solution). */
  readonly initTimepoint: boolean;
  /**
   * OP solved as the starting point of a transient analysis. Charge-storage devices must
   * store their charges/fluxes in state0 so the engine can seed the history.
   */
  readonly tranOp: boolean;
  /** Transient with UIC: device initial conditions (params.ic etc.) apply at t=0. */
  readonly uic: boolean;
  /** Current simulation time (0 in OP/DC). */
  readonly time: number;
  /** Current timestep (0 in OP/DC). */
  readonly dt: number;
  readonly method: IntegrationMethod;
  /** Current gmin (may be larger than options.gmin during gmin stepping). */
  readonly gmin: number;
  /** Source stepping factor in [0,1]; independent sources MUST scale their value by it. */
  readonly srcFact: number;
  /** Circuit temperature in kelvin. */
  readonly temp: number;
  readonly options: SimOptions;

  /** Value of unknown i at the current Newton iterate (0 for GROUND). */
  x(i: number): number;
  addMatrix(row: number, col: number, value: number): void;
  addRhs(row: number, value: number): void;

  /** State vectors: state0 = timepoint being solved, state1 = last accepted, state2 = the one before. */
  readonly state0: Float64Array;
  readonly state1: Float64Array;
  readonly state2: Float64Array;

  /**
   * Numerical integration of a charge (or flux) stored in state0[q] (the device writes the charge
   * there before calling). Uses the active method and history state1/state2[q], state1[q+1].
   * Writes the resulting current dq/dt into state0[q+1] and returns it as `i`, together with
   * `geq` = cap * (dI/dq coefficient), where `cap` = dq/dv at the current iterate.
   * Each charge therefore needs TWO consecutive state slots: q and q+1.
   * Typical stamp for a capacitor between a and b with voltage v = x(a)-x(b):
   *   G[a,a]+=geq; G[b,b]+=geq; G[a,b]-=geq; G[b,a]-=geq;
   *   ieq = i - geq*v; rhs[a] -= ieq; rhs[b] += ieq;
   * Only valid when mode === 'tran' and !(tranOp).
   */
  integrate(q: number, cap: number): { geq: number; i: number };

  /** Signal that limiting modified a junction voltage: forces at least one more iteration. */
  noncon(): void;
}

/** Small-signal AC load (complex). Called after a converged operating point. */
export interface AcContext {
  /** angular frequency, rad/s */
  readonly omega: number;
  readonly temp: number;
  readonly options: SimOptions;
  /** DC operating point value of unknown i (0 for GROUND). */
  op(i: number): number;
  addMatrix(row: number, col: number, re: number, im: number): void;
  addRhs(row: number, re: number, im: number): void;
  /** states at the operating point (devices may cache small-signal values there or in fields). */
  readonly state0: Float64Array;
}

/** Local-truncation-error context for timestep control. */
export interface TruncContext {
  /** Max timestep allowed by LTE for the charge stored in state slot q (q+1 holds its current). */
  terr(q: number): number;
  readonly dt: number;
  readonly order: number;
}

export interface NoiseGenerator {
  /** e.g. "thermal", "shot_ic", "flicker" */
  name: string;
  /** owning element name */
  device: string;
  /** current noise injected between these unknowns (GROUND allowed) */
  pos: number;
  neg: number;
  /** one-sided current noise power spectral density [A^2/Hz] at frequency f */
  density(freq: number): number;
}

export interface NoiseContext {
  readonly temp: number;
  readonly options: SimOptions;
  op(i: number): number;
}

export interface Device {
  readonly name: string;
  readonly type: ElementType;
  /** Nodes as given in the IR (for diagnostics/outputs). */
  readonly nodeNames: string[];

  /** Allocate node indices, branch unknowns and state slots; resolve model cards. */
  setup(ctx: SetupContext): void;
  /** Second pass to resolve references to other devices (F, H, W, K). */
  bind?(ctx: BindContext): void;

  /** Real load for OP / DC / transient Newton iterations. */
  load(ctx: LoadContext): void;
  /** Device-level convergence check (in addition to the engine's global check). */
  convTest?(ctx: LoadContext): boolean;

  /** Complex small-signal stamp at the last converged operating point. */
  acLoad?(ctx: AcContext): void;
  /** Max timestep permitted by local truncation error (Infinity if none). */
  truncate?(ctx: TruncContext): number;
  /** Waveform corner times in [0, tstop] that the transient must hit exactly. */
  breakpoints?(tstop: number): number[];
  /** Noise generators at the operating point. */
  noise?(ctx: NoiseContext): NoiseGenerator[];

  /** Index of this device's own branch-current unknown (V, L, E, H ...), or -1. */
  branchIndex?(): number;
  /**
   * Derived outputs at a solution x. Keys become vector names `${key}(${name})`,
   * e.g. { I: 1e-3, P: 2e-3 } -> "I(R1)", "P(R1)"; { Ic: .., Ib: .., Ie: .. } -> "Ic(Q1)".
   * Convention for 2-terminal devices: I = current from first node to second node through the device.
   */
  outputs?(x: (i: number) => number): Record<string, number>;

  /** Change an instance parameter at runtime (interactive simulation, sweeps). "value" = primary value. */
  setParam?(param: string, value: number): void;
  /** Read an instance parameter ("value" = primary value). */
  getParam?(param: string): number | undefined;
  /** Initial condition voltage/current hint for UIC (optional). */
}

/** Creates a device instance from a flat IR element. */
export type DeviceFactory = (el: ElementIR) => Device;

export type DeviceFactoryTable = Partial<Record<ElementType, DeviceFactory>>;

/** Physical constants (SPICE values). */
export const CHARGE = 1.6021918e-19;
export const BOLTZ = 1.3806226e-23;
export const KELVIN = 273.15;
export const EPS_SI = 1.0359431e-10; // 11.7 * eps0
export const EPS_OX = 3.453133e-11; // 3.9 * eps0
export const EPS0 = 8.854214871e-12;

export function thermalVoltage(tempK: number): number {
  return (BOLTZ * tempK) / CHARGE;
}
