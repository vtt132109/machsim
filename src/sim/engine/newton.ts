/**
 * Newton-Raphson iteration and DC operating-point strategies.
 *
 * {@link newtonSolve} runs SPICE-style Newton iterations on a {@link RealSystem}:
 * - assemble at the current iterate, factor (structure reused), solve;
 * - convergence when no device reported noncon() during the last load, every unknown satisfies
 *   |x_new - x_old| <= reltol*max(|x_new|, |x_old|) + (vntol for node voltages | abstol for
 *   branch currents), and every device's convTest() passes;
 * - nonlinear circuits always take at least two iterations (the first one runs with the devices'
 *   initial junction guesses / the timepoint predictor); fully linear circuits are solved exactly
 *   by a single factorisation;
 * - optional step damping limits the node-voltage update of each iteration.
 *
 * {@link solveOperatingPoint} chains the classic strategies until one converges:
 * nodeset phase (.nodeset, and .ic for a plain OP) -> plain Newton (itl1) -> gmin stepping
 * (diagonal conductance from 1e-2 down to options.gmin, adaptive step) -> source stepping
 * (srcFact 0..1, adaptive step) -> damped Newton. Failures raise SimulationError naming the
 * offending node / branch / device.
 */
import { SimulationError } from '../results';
import type { NodeValue } from './circuit';
import { checkAbort, type RealSystem } from './system';

export interface NewtonParams {
  /** Iteration limit. */
  maxIter: number;
  /** First iteration uses the devices' initial junction voltages (fresh operating point). */
  initJunctions?: boolean;
  /** First iteration of a new transient timepoint. */
  initTimepoint?: boolean;
  /** Limit the node-voltage change per iteration (damped Newton). */
  damping?: boolean;
}

export interface NewtonResult {
  converged: boolean;
  iterations: number;
  /** Unknown that failed the convergence test in the last iteration (-1 if none). */
  failedUnknown: number;
  /** Device that reported noncon() or failed convTest() in the last iteration. */
  failedDevice?: string;
  /** Error raised by the factorisation (singular / non-finite), if that ended the iteration. */
  error?: SimulationError;
}

/** Index of the first unknown violating the SPICE convergence tolerances, or -1. */
export function convergenceFailure(sys: RealSystem): number {
  const { reltol, vntol, abstol } = sys.circuit.options;
  const x = sys.x;
  const xo = sys.xPrev;
  const nn = sys.circuit.numNodes;
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    const b = xo[i];
    const tol = reltol * Math.max(Math.abs(a), Math.abs(b)) + (i < nn ? vntol : abstol);
    if (!(Math.abs(a - b) <= tol)) return i;
  }
  return -1;
}

function finiteFailure(x: Float64Array): number {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return i;
  return -1;
}

/** Scale the last update so that no node voltage moves by more than ~1 V (+10 % of its value). */
function damp(sys: RealSystem): void {
  const x = sys.x;
  const xo = sys.xPrev;
  const nn = sys.circuit.numNodes;
  let maxd = 0;
  let maxv = 0;
  for (let i = 0; i < nn; i++) {
    const d = Math.abs(x[i] - xo[i]);
    if (d > maxd) maxd = d;
    const v = Math.abs(xo[i]);
    if (v > maxv) maxv = v;
  }
  const limit = 1 + 0.1 * maxv;
  if (maxd > limit) {
    const s = limit / maxd;
    for (let i = 0; i < x.length; i++) x[i] = xo[i] + s * (x[i] - xo[i]);
  }
}

/** Newton-Raphson iteration from the current `sys.x`. Never throws for numerical failures. */
export function newtonSolve(sys: RealSystem, p: NewtonParams): NewtonResult {
  const ctx = sys.ctx;
  const circuit = sys.circuit;
  const linear = circuit.allLinear;
  let failedUnknown = -1;
  let failedDevice: string | undefined;
  for (let iter = 0; iter < p.maxIter; iter++) {
    checkAbort(sys.signal);
    const first = iter === 0;
    ctx.initJunctions = !!p.initJunctions && first;
    ctx.initTimepoint = !!p.initTimepoint && first;
    try {
      sys.assemble();
      sys.solve();
    } catch (e) {
      ctx.initJunctions = false;
      ctx.initTimepoint = false;
      if (e instanceof SimulationError && (e.code === 'singular' || e.code === 'noconv')) {
        return { converged: false, iterations: iter + 1, failedUnknown: -1, error: e };
      }
      throw e;
    }
    const bad = finiteFailure(sys.x);
    if (bad >= 0) {
      ctx.initJunctions = false;
      ctx.initTimepoint = false;
      return { converged: false, iterations: iter + 1, failedUnknown: bad, failedDevice };
    }
    if (linear) {
      // The solution is exact; reload once so charges/fluxes and companion currents stored in
      // the state vector correspond to the solution rather than to the initial guess.
      ctx.initJunctions = false;
      ctx.initTimepoint = false;
      sys.assemble();
      return { converged: true, iterations: iter + 1, failedUnknown: -1 };
    }
    if (p.damping && !first) damp(sys);
    failedDevice = undefined;
    failedUnknown = -1;
    if (first) continue; // at least two iterations for nonlinear circuits
    if (sys.nonconCount > 0) {
      failedDevice = sys.nonconDevice?.name;
      continue;
    }
    failedUnknown = convergenceFailure(sys);
    if (failedUnknown >= 0) continue;
    let devOk = true;
    for (const d of circuit.devices) {
      if (d.convTest && !d.convTest(ctx)) {
        failedDevice = d.name;
        devOk = false;
        break;
      }
    }
    if (devOk) {
      ctx.initJunctions = false;
      ctx.initTimepoint = false;
      return { converged: true, iterations: iter + 1, failedUnknown: -1 };
    }
  }
  ctx.initJunctions = false;
  ctx.initTimepoint = false;
  return { converged: false, iterations: p.maxIter, failedUnknown, failedDevice };
}

/** Describe why a Newton run failed, naming the node / branch / device. */
export function describeFailure(sys: RealSystem, r: NewtonResult): string {
  if (r.error) return r.error.message;
  const parts: string[] = [];
  if (r.failedUnknown >= 0) {
    const i = r.failedUnknown;
    const a = sys.x[i];
    const b = sys.xPrev[i];
    parts.push(`${sys.circuit.describeUnknown(i)} not converging (last value ${fmt(a)}, previous ${fmt(b)})`);
  }
  if (r.failedDevice) parts.push(`device '${r.failedDevice}' not converging`);
  if (parts.length === 0) parts.push('iteration limit reached');
  return parts.join('; ');
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toPrecision(6) : String(v);
}

// ---------------------------------------------------------------------------------------------
// Operating point
// ---------------------------------------------------------------------------------------------

export interface OpParams {
  /** LoadContext mode ('op' for .op / AC / transient OP, 'dc' for DC sweeps). */
  mode: 'op' | 'dc';
  /** Operating point that starts a transient (devices store charges; .ic values are forced). */
  tranOp?: boolean;
  /** Iteration limit of the plain Newton stage (default options.itl1). */
  maxIter?: number;
  /** Try a Newton run from the current sys.x first (DC sweep continuation, limit options.itl2). */
  warmStart?: boolean;
  /** Apply .ic node values as nodesets (initial guesses released before the final solve). Default true when not tranOp. */
  icAsNodeset?: boolean;
}

export type OpStrategy = 'warm' | 'linear' | 'nodeset' | 'newton' | 'gmin' | 'source' | 'damped';

export interface OpResult {
  iterations: number;
  strategy: OpStrategy;
}

interface Snapshot {
  x: Float64Array;
  s0: Float64Array;
}

function snapshot(sys: RealSystem): Snapshot {
  return { x: sys.x.slice(), s0: sys.states[0].slice() };
}

function restore(sys: RealSystem, s: Snapshot): void {
  sys.x.set(s.x);
  sys.xPrev.set(s.x);
  sys.states[0].set(s.s0);
}

/** Reset the iterate to zero plus the given initial guesses. */
function resetGuess(sys: RealSystem, guesses: NodeValue[]): void {
  sys.x.fill(0);
  sys.xPrev.fill(0);
  for (const g of guesses) sys.x[g.index] = g.value;
}

/**
 * Gmin stepping: solve with a large conductance from every node to ground (and a raised device
 * gmin), then reduce it geometrically down to options.gmin and finally remove it. A failed step
 * is retried with a smaller reduction factor. Starts from scratch (junction initial guesses).
 */
export function gminStepping(sys: RealSystem, guesses: NodeValue[] = []): NewtonResult {
  const opts = sys.circuit.options;
  const ctx = sys.ctx;
  const steps = Math.max(1, Math.floor(opts.gminSteps));
  const gTarget = opts.gmin > 0 ? opts.gmin : 1e-12;
  const gStart = Math.max(1e-2, gTarget);
  let factor = Math.max(2, Math.pow(gStart / gTarget, 1 / steps));
  try {
    resetGuess(sys, guesses);
    let g = gStart;
    sys.diagGmin = g;
    ctx.gmin = Math.max(opts.gmin, g);
    let r = newtonSolve(sys, { maxIter: opts.itl1, initJunctions: true });
    if (!r.converged) return r;
    let good = snapshot(sys);
    while (g > gTarget) {
      const gNext = Math.max(g / factor, gTarget);
      sys.diagGmin = gNext;
      ctx.gmin = Math.max(opts.gmin, gNext);
      r = newtonSolve(sys, { maxIter: opts.itl1 });
      if (r.converged) {
        g = gNext;
        good = snapshot(sys);
      } else {
        restore(sys, good);
        factor = Math.sqrt(factor);
        if (factor < 1.00005) return r;
      }
    }
    sys.diagGmin = 0;
    ctx.gmin = opts.gmin;
    return newtonSolve(sys, { maxIter: opts.itl1 });
  } finally {
    sys.diagGmin = 0;
    ctx.gmin = opts.gmin;
  }
}

/**
 * Source stepping: ramp every independent source (LoadContext.srcFact) from 0 to 1, re-solving
 * from the previous solution; the ramp step grows after successes and shrinks after failures.
 */
export function sourceStepping(sys: RealSystem, guesses: NodeValue[] = []): NewtonResult {
  const opts = sys.circuit.options;
  const ctx = sys.ctx;
  const steps = Math.max(1, Math.floor(opts.srcSteps));
  try {
    resetGuess(sys, guesses);
    ctx.srcFact = 0;
    let r = newtonSolve(sys, { maxIter: opts.itl1, initJunctions: true });
    if (!r.converged) return r;
    let good = snapshot(sys);
    let f = 0;
    let step = 1 / steps;
    while (f < 1) {
      const fn = Math.min(1, f + step);
      ctx.srcFact = fn;
      r = newtonSolve(sys, { maxIter: opts.itl1 });
      if (r.converged) {
        f = fn;
        good = snapshot(sys);
        step = Math.min(step * 1.5, 1);
      } else {
        restore(sys, good);
        step /= 4;
        if (step < 1e-7) return r;
      }
    }
    return r;
  } finally {
    ctx.srcFact = 1;
  }
}

/**
 * Solve the DC operating point of the system's circuit, leaving the solution in sys.x and the
 * device states in sys.states[0]. Throws SimulationError ('singular' | 'noconv' | 'aborted').
 */
export function solveOperatingPoint(sys: RealSystem, p: OpParams): OpResult {
  const circuit = sys.circuit;
  const opts = circuit.options;
  const ctx = sys.ctx;
  ctx.mode = p.mode;
  ctx.tranOp = !!p.tranOp;
  ctx.uic = false;
  ctx.time = 0;
  ctx.dt = 0;
  ctx.srcFact = 1;
  ctx.gmin = opts.gmin;
  sys.diagGmin = 0;
  const forcedIc = p.tranOp ? circuit.ic : [];
  const icNodeset = (p.icAsNodeset ?? !p.tranOp) ? circuit.ic : [];
  const forcedIdx = new Set(forcedIc.map((v) => v.index));
  const nodesets = [...circuit.nodeset, ...icNodeset].filter((v) => !forcedIdx.has(v.index));
  const guesses = [...nodesets, ...forcedIc];
  sys.forced = forcedIc;
  const maxIter = p.maxIter ?? opts.itl1;
  let total = 0;

  if (p.warmStart) {
    const r = newtonSolve(sys, { maxIter: opts.itl2 });
    total += r.iterations;
    if (r.converged) return { iterations: total, strategy: 'warm' };
  }

  if (circuit.allLinear) {
    resetGuess(sys, guesses);
    const r = newtonSolve(sys, { maxIter: 1 });
    if (!r.converged) throw r.error ?? new SimulationError(`Operating point failed: ${describeFailure(sys, r)}`, 'noconv');
    return { iterations: total + r.iterations, strategy: 'linear' };
  }

  if (nodesets.length > 0) {
    resetGuess(sys, guesses);
    sys.forced = [...forcedIc, ...nodesets];
    let r = newtonSolve(sys, { maxIter, initJunctions: true });
    total += r.iterations;
    sys.forced = forcedIc;
    if (r.converged) {
      r = newtonSolve(sys, { maxIter });
      total += r.iterations;
      if (r.converged) return { iterations: total, strategy: 'nodeset' };
    }
  }

  resetGuess(sys, guesses);
  const plain = newtonSolve(sys, { maxIter, initJunctions: true });
  total += plain.iterations;
  if (plain.converged) return { iterations: total, strategy: 'newton' };
  const plainWhy = plain.failedUnknown >= 0 || plain.failedDevice || plain.error ? describeFailure(sys, plain) : '';
  let lastWhy = plainWhy;

  if (opts.gminSteps > 0) {
    const r = gminStepping(sys, guesses);
    total += r.iterations;
    if (r.converged) return { iterations: total, strategy: 'gmin' };
    lastWhy = describeFailure(sys, r);
  }
  if (opts.srcSteps > 0) {
    const r = sourceStepping(sys, guesses);
    total += r.iterations;
    if (r.converged) return { iterations: total, strategy: 'source' };
    lastWhy = describeFailure(sys, r);
  }
  resetGuess(sys, guesses);
  const damped = newtonSolve(sys, { maxIter: 4 * Math.max(1, opts.itl1), initJunctions: true, damping: true });
  total += damped.iterations;
  if (damped.converged) return { iterations: total, strategy: 'damped' };

  if (plain.error && plain.error.code === 'singular') throw plain.error;
  const why = plainWhy || lastWhy || describeFailure(sys, damped);
  throw new SimulationError(
    `Operating point did not converge (Newton, gmin stepping and source stepping failed): ${why}`,
    'noconv',
    why,
  );
}
