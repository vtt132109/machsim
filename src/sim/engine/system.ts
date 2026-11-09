/**
 * Real MNA system: matrix assembly, factorisation and the device LoadContext.
 *
 * A {@link RealSystem} owns everything a Newton iteration needs for one circuit:
 * - the sparse matrix and its LU (symbolic structure reused across iterations; numeric
 *   refactorisation is skipped entirely when the assembled values did not change, which makes
 *   fixed-step linear transients cost one triangular solve per timepoint),
 * - the right-hand side, the current iterate `x` and the previous iterate `xPrev`,
 * - four state vectors (state0 = point being solved, state1/state2 = accepted history,
 *   state3 = extra history used only by the truncation-error estimate),
 * - the {@link EngineLoadContext} handed to Device.load(), including charge integration
 *   (backward Euler, trapezoidal, variable-step Gear-2),
 * - extra diagonal stamps: gmin stepping conductance (`diagGmin`), `rshunt`, and forced node
 *   values (.ic / .nodeset) applied through a large conductance to ground.
 */
import { GROUND, type IntegrationMethod, type LoadContext } from '../device';
import type { SimOptions } from '../netlist';
import { SimulationError } from '../results';
import { SingularMatrixError, SparseLU, SparseMatrix, growFloat64 } from '../linalg';
import type { Circuit, NodeValue } from './circuit';
import type { EngineDevice } from './hooks';

/** Conductance used to force .ic / .nodeset node values (SPICE uses the same magnitude). */
export const FORCE_CONDUCTANCE = 1e10;

/** Cooperative cancellation flag (RunOptions.signal). */
export interface AbortFlag {
  readonly aborted: boolean;
}

export function checkAbort(signal: AbortFlag | undefined): void {
  if (signal?.aborted) throw new SimulationError('Simulation aborted', 'aborted');
}

/** Integration settings of the timepoint being solved. */
export interface IntegrationSetup {
  /** 1 = backward Euler, 2 = trapezoidal / Gear-2. */
  order: number;
  method: 'trap' | 'gear';
  /** Step to the timepoint being solved. */
  dt: number;
  /** Previous step (Gear-2 variable-step coefficients). */
  dtPrev: number;
}

/** LoadContext implementation shared by every device of a circuit. */
export class EngineLoadContext implements LoadContext {
  mode: 'op' | 'dc' | 'tran' = 'op';
  initJunctions = false;
  initTimepoint = false;
  tranOp = false;
  uic = false;
  time = 0;
  dt = 0;
  method: IntegrationMethod = 'trap';
  gmin: number;
  srcFact = 1;
  temp: number;
  readonly options: SimOptions;
  state0: Float64Array;
  state1: Float64Array;
  state2: Float64Array;
  /** Integration order of the current timepoint (1 or 2). */
  order = 1;
  /** Integration coefficients: i = ag0*q0 + ag1*q1 + ag2*q2 (Gear) / ag0 = dI/dq. */
  ag0 = 0;
  ag1 = 0;
  ag2 = 0;
  private gearMode = false;
  private trapMode = false;

  constructor(private readonly sys: RealSystem) {
    this.options = sys.circuit.options;
    this.gmin = this.options.gmin;
    this.temp = sys.circuit.tempK;
    this.state0 = sys.states[0];
    this.state1 = sys.states[1];
    this.state2 = sys.states[2];
  }

  /** Configure integration for the next timepoint. */
  setIntegration(s: IntegrationSetup): void {
    this.order = s.order;
    this.dt = s.dt;
    if (s.order <= 1) {
      this.method = 'be';
      this.ag0 = 1 / s.dt;
      this.ag1 = -this.ag0;
      this.ag2 = 0;
      this.gearMode = false;
      this.trapMode = false;
    } else if (s.method === 'gear') {
      const h = s.dt;
      const r = s.dtPrev > 0 ? h / s.dtPrev : 1;
      this.method = 'gear';
      this.ag0 = (1 + 2 * r) / (h * (1 + r));
      this.ag1 = -(1 + r) / h;
      this.ag2 = (r * r) / (h * (1 + r));
      this.gearMode = true;
      this.trapMode = false;
    } else {
      this.method = 'trap';
      this.ag0 = 2 / s.dt;
      this.ag1 = -this.ag0;
      this.ag2 = 0;
      this.gearMode = false;
      this.trapMode = true;
    }
  }

  readonly x = (i: number): number => (i < 0 ? 0 : this.sys.x[i]);

  readonly addMatrix = (row: number, col: number, value: number): void => {
    this.sys.matrix.add(row, col, value);
  };

  readonly addRhs = (row: number, value: number): void => {
    if (row >= 0) this.sys.rhs[row] += value;
  };

  readonly integrate = (q: number, cap: number): { geq: number; i: number } => {
    if (this.mode !== 'tran' || this.tranOp || !(this.dt > 0)) return { geq: 0, i: 0 };
    const s0 = this.state0;
    const s1 = this.state1;
    let i: number;
    if (this.gearMode) i = this.ag0 * s0[q] + this.ag1 * s1[q] + this.ag2 * this.state2[q];
    else if (this.trapMode) i = this.ag0 * (s0[q] - s1[q]) - s1[q + 1];
    else i = this.ag0 * (s0[q] - s1[q]);
    s0[q + 1] = i;
    return { geq: cap * this.ag0, i };
  };

  readonly noncon = (): void => {
    this.sys.nonconCount++;
    if (this.sys.nonconDevice === undefined) this.sys.nonconDevice = this.sys.loadingDevice;
  };
}

export class RealSystem {
  readonly circuit: Circuit;
  readonly n: number;
  readonly matrix: SparseMatrix;
  readonly lu: SparseLU;
  readonly rhs: Float64Array;
  /** Current iterate (after a solve: the new solution). */
  x: Float64Array;
  /** Previous iterate. */
  xPrev: Float64Array;
  /** [state0, state1, state2, state3]. */
  states: Float64Array[];
  readonly ctx: EngineLoadContext;
  /** Extra conductance from every node to ground (gmin stepping). */
  diagGmin = 0;
  /** Node values forced through {@link FORCE_CONDUCTANCE} (.ic during the transient OP, .nodeset). */
  forced: NodeValue[] = [];
  /** Cancellation flag checked between iterations. */
  signal: AbortFlag | undefined;
  /** Number of noncon() calls during the last assembly. */
  nonconCount = 0;
  /** First device that called noncon() during the last assembly. */
  nonconDevice: EngineDevice | undefined;
  /** Device whose load() is running (diagnostics). */
  loadingDevice: EngineDevice | undefined;
  /** Numeric factorisations actually performed (diagnostics / tests). */
  factorCount = 0;

  private readonly diagSlots: Int32Array;
  private lastValues: Float64Array = new Float64Array(0);
  private lastVersion = -1;
  private lastCount = -1;

  constructor(circuit: Circuit) {
    this.circuit = circuit;
    const n = circuit.size;
    this.n = n;
    this.matrix = new SparseMatrix(n);
    this.lu = new SparseLU(n);
    this.rhs = new Float64Array(n);
    this.x = new Float64Array(n);
    this.xPrev = new Float64Array(n);
    const ns = Math.max(1, circuit.numStates);
    this.states = [new Float64Array(ns), new Float64Array(ns), new Float64Array(ns), new Float64Array(ns)];
    this.diagSlots = new Int32Array(circuit.numNodes);
    for (let i = 0; i < circuit.numNodes; i++) this.diagSlots[i] = this.matrix.pattern.ensure(i, i);
    this.matrix.values = growFloat64(this.matrix.values, this.matrix.pattern.count);
    this.ctx = new EngineLoadContext(this);
  }

  /** Load every device at the current iterate and add the engine's own diagonal stamps. */
  assemble(): void {
    const m = this.matrix;
    m.clear();
    this.rhs.fill(0);
    this.nonconCount = 0;
    this.nonconDevice = undefined;
    const ctx = this.ctx;
    ctx.temp = this.circuit.tempK;
    for (const d of this.circuit.devices) {
      this.loadingDevice = d;
      d.load(ctx);
    }
    this.loadingDevice = undefined;
    const vals = m.values;
    const rs = this.circuit.options.rshunt;
    const g = this.diagGmin + (rs > 0 ? 1 / rs : 0);
    if (g > 0) {
      const slots = this.diagSlots;
      for (let i = 0; i < slots.length; i++) vals[slots[i]] += g;
    }
    for (const f of this.forced) {
      vals[this.diagSlots[f.index]] += FORCE_CONDUCTANCE;
      this.rhs[f.index] += FORCE_CONDUCTANCE * f.value;
    }
  }

  /** Factor the assembled matrix unless it is numerically identical to the last factored one. */
  factor(): void {
    const m = this.matrix;
    const p = m.pattern;
    const cnt = p.count;
    const vals = m.values;
    if (this.lu.factored && p.version === this.lastVersion && cnt === this.lastCount) {
      const last = this.lastValues;
      let same = true;
      for (let s = 0; s < cnt; s++) {
        if (vals[s] !== last[s]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    try {
      this.lu.factor(m, (i) => this.circuit.describeUnknown(i));
    } catch (e) {
      this.lastVersion = -1;
      if (e instanceof SingularMatrixError) throw singularError(this.circuit, e.unknown);
      throw e;
    }
    this.factorCount++;
    if (this.lastValues.length < cnt) this.lastValues = new Float64Array(Math.max(cnt, 2 * this.lastValues.length));
    this.lastValues.set(vals.subarray(0, cnt));
    this.lastVersion = p.version;
    this.lastCount = cnt;
  }

  /**
   * Factor (if needed) and solve the assembled system. The solution becomes `x`, the old
   * iterate moves to `xPrev`.
   */
  solve(): void {
    this.factor();
    const out = this.xPrev;
    this.lu.solve(this.rhs, out);
    this.xPrev = this.x;
    this.x = out;
  }

  /** Discard cached factorisation values (forces a numeric factorisation on the next solve). */
  invalidateFactorization(): void {
    this.lastVersion = -1;
  }

  /** Rotate state vectors after an accepted timepoint: state_k+1 <- state_k, state0 <- copy of state1. */
  rotateStates(): void {
    const s = this.states;
    const oldest = s[3];
    s[3] = s[2];
    s[2] = s[1];
    s[1] = s[0];
    oldest.set(s[1]);
    s[0] = oldest;
    this.syncStateRefs();
  }

  /** Copy state0 into every history vector (start of a transient). */
  seedHistory(): void {
    const s = this.states;
    s[1].set(s[0]);
    s[2].set(s[0]);
    s[3].set(s[0]);
  }

  syncStateRefs(): void {
    this.ctx.state0 = this.states[0];
    this.ctx.state1 = this.states[1];
    this.ctx.state2 = this.states[2];
  }
}

/** SimulationError for a singular MNA matrix, with a hint about the usual causes. */
export function singularError(circuit: Circuit, unknown: number): SimulationError {
  const what = circuit.describeUnknown(unknown);
  const hint = circuit.isNode(unknown)
    ? 'the node may be floating: it has no DC path to ground (connected only through capacitors, current sources or open switches)'
    : 'check for a loop of voltage sources and/or inductors, or a voltage source / inductor whose terminals are shorted';
  return new SimulationError(`Singular matrix: no valid pivot for ${what}; ${hint}`, 'singular', what);
}

export { GROUND };
