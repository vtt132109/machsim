/**
 * Small-signal AC system: complex MNA matrix linearised at a converged operating point.
 *
 * {@link AcSystem} assembles Y(jω) from every device's acLoad() (source AC excitations land in
 * `rhsRe`/`rhsIm`), factors it with the complex sparse LU (structure reused across
 * frequencies), and solves either Y x = b or the transpose system Yᵀ x = b (adjoint method for
 * noise, transfer functions and sensitivities). Any right-hand side can be supplied.
 *
 * Also exports the frequency-list generator shared by AC-type analyses.
 */
import type { AcContext } from '../device';
import type { SimOptions, SweepType } from '../netlist';
import { SimulationError } from '../results';
import { ComplexSparseLU, ComplexSparseMatrix, SingularMatrixError, growFloat64, type ComplexVector } from '../linalg';
import type { Circuit } from './circuit';
import { singularError } from './system';

class EngineAcContext implements AcContext {
  omega = 0;
  temp: number;
  readonly options: SimOptions;
  readonly state0: Float64Array;

  constructor(private readonly sys: AcSystem) {
    this.options = sys.circuit.options;
    this.temp = sys.circuit.tempK;
    this.state0 = sys.opStates;
  }

  readonly op = (i: number): number => (i < 0 ? 0 : this.sys.opX[i]);

  readonly addMatrix = (row: number, col: number, re: number, im: number): void => {
    this.sys.matrix.add(row, col, re, im);
  };

  readonly addRhs = (row: number, re: number, im: number): void => {
    if (row < 0) return;
    this.sys.rhsRe[row] += re;
    this.sys.rhsIm[row] += im;
  };
}

export class AcSystem {
  readonly circuit: Circuit;
  readonly n: number;
  readonly matrix: ComplexSparseMatrix;
  readonly lu: ComplexSparseLU;
  /** Source excitation of the last assembly. */
  readonly rhsRe: Float64Array;
  readonly rhsIm: Float64Array;
  /** Operating point solution and device states the system is linearised at. */
  readonly opX: Float64Array;
  readonly opStates: Float64Array;
  /** Angular frequency of the last assembly (rad/s). */
  omega = 0;
  /** Names of devices that have no small-signal model (ignored in AC). */
  readonly missingAcModels: string[];
  private readonly ctx: EngineAcContext;
  private readonly diagSlots: Int32Array;

  /**
   * @param op converged operating-point solution (copied)
   * @param opStates device state vector at the operating point (state0 after the OP; copied)
   */
  constructor(circuit: Circuit, op: Float64Array, opStates: Float64Array) {
    this.circuit = circuit;
    this.n = circuit.size;
    this.matrix = new ComplexSparseMatrix(this.n);
    this.lu = new ComplexSparseLU(this.n);
    this.rhsRe = new Float64Array(this.n);
    this.rhsIm = new Float64Array(this.n);
    this.opX = op.slice();
    this.opStates = opStates.slice();
    this.diagSlots = new Int32Array(circuit.numNodes);
    for (let i = 0; i < circuit.numNodes; i++) this.diagSlots[i] = this.matrix.pattern.ensure(i, i);
    this.matrix.re = growFloat64(this.matrix.re, this.matrix.pattern.count);
    this.matrix.im = growFloat64(this.matrix.im, this.matrix.pattern.count);
    this.missingAcModels = circuit.devices.filter((d) => !d.acLoad && d.linear !== true).map((d) => d.name);
    this.ctx = new EngineAcContext(this);
  }

  /** Assemble Y(jω) and the source excitation at angular frequency `omega` (rad/s). */
  assemble(omega: number): void {
    this.omega = omega;
    const m = this.matrix;
    m.clear();
    this.rhsRe.fill(0);
    this.rhsIm.fill(0);
    const ctx = this.ctx;
    ctx.omega = omega;
    ctx.temp = this.circuit.tempK;
    for (const d of this.circuit.devices) d.acLoad?.(ctx);
    const rs = this.circuit.options.rshunt;
    if (rs > 0) {
      const g = 1 / rs;
      for (let i = 0; i < this.diagSlots.length; i++) m.re[this.diagSlots[i]] += g;
    }
  }

  /** Factor the assembled matrix (throws SimulationError 'singular' naming the unknown). */
  factor(): void {
    try {
      this.lu.factor(this.matrix, (i) => this.circuit.describeUnknown(i));
    } catch (e) {
      if (e instanceof SingularMatrixError) {
        const err = singularError(this.circuit, e.unknown);
        throw new SimulationError(`${err.message} (at ${(this.omega / (2 * Math.PI)).toPrecision(6)} Hz)`, 'singular', err.detail);
      }
      throw e;
    }
  }

  /** Solve Y x = b (default b: the assembled source excitation). Call factor() first. */
  solve(bRe: Float64Array = this.rhsRe, bIm: Float64Array = this.rhsIm): ComplexVector {
    return this.lu.solve(bRe, bIm);
  }

  /** Solve Yᵀ x = b (plain transpose: adjoint network). Call factor() first. */
  solveTranspose(bRe: Float64Array, bIm: Float64Array): ComplexVector {
    return this.lu.solveTranspose(bRe, bIm);
  }

  /** assemble + factor + solve with the source excitation. */
  solveAt(omega: number): ComplexVector {
    this.assemble(omega);
    this.factor();
    return this.solve();
  }
}

/**
 * Frequency points of an AC-type sweep.
 * dec/oct: `points` per decade/octave from fstart (geometric, last point <= fstop);
 * lin: `points` equally spaced points including both ends; list: the explicit list.
 */
export function sweepFrequencies(sweep: SweepType, points: number, fstart: number, fstop: number, list?: number[]): number[] {
  if (sweep === 'list') {
    const l = (list ?? []).filter((f) => Number.isFinite(f) && f >= 0);
    if (l.length === 0) throw new SimulationError('AC sweep: empty frequency list', 'netlist');
    return l;
  }
  if (!Number.isFinite(fstart) || !Number.isFinite(fstop)) throw new SimulationError('AC sweep: invalid frequency range', 'netlist');
  const n = Math.max(1, Math.floor(points));
  if (sweep === 'lin') {
    if (n === 1 || fstop === fstart) return [fstart];
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(fstart + ((fstop - fstart) * k) / (n - 1));
    return out;
  }
  if (!(fstart > 0) || !(fstop >= fstart)) {
    throw new SimulationError(`AC ${sweep} sweep needs 0 < fstart <= fstop (got ${fstart}, ${fstop})`, 'netlist');
  }
  const base = sweep === 'oct' ? 2 : 10;
  const span = Math.log(fstop / fstart) / Math.log(base);
  const count = Math.floor(span * n + 1e-9) + 1;
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(fstart * Math.pow(base, k / n));
  if (out[out.length - 1] < fstop * (1 - 1e-9)) out.push(fstop);
  return out;
}
