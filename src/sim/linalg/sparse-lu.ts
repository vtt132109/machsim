/**
 * Real sparse LU factorisation with partial pivoting (left-looking, Gilbert-Peierls).
 *
 * Factorisation: P * A * Q = L * U, where
 * - Q is a fill-reducing column order (minimum degree on A + A^T, see ordering.ts),
 * - P is chosen numerically column by column (threshold partial pivoting that prefers
 *   the diagonal entry when |a_kk| >= pivotThreshold * max|column|),
 * - L is unit lower triangular (stored without its diagonal, by original row index),
 * - U is upper triangular (off-diagonal entries stored by pivot step, diagonal apart).
 *
 * Each column is computed by a sparse triangular solve whose non-zero pattern comes
 * from a depth-first search over the graph of L ("reach"), so the work is proportional
 * to the arithmetic actually needed.
 *
 * Reuse across Newton iterations: once a full factorisation has fixed the pivot
 * sequence and the L/U patterns, later calls to {@link SparseLU.factor} with the same
 * matrix pattern (unchanged {@link MatrixPattern.version}) only recompute numeric values
 * along the stored patterns ("refactor"). If a reused pivot becomes too small relative to
 * its column, the code falls back to a full factorisation with fresh pivoting.
 *
 * Solves: {@link SparseLU.solve} (A x = b) and {@link SparseLU.solveTranspose} (A^T x = b).
 */
import { buildCsc, growFloat64, growInt32, type CscStructure, type SparseMatrix } from './pattern';
import { minimumDegreeOrdering } from './ordering';
import { NonFiniteMatrixError, SingularMatrixError, type UnknownDescriber } from './errors';

export class SparseLU {
  readonly n: number;
  /** Relative threshold for partial pivoting (diagonal preference). */
  pivotThreshold = 1e-3;
  /** Number of full (pivoting) factorisations performed. */
  fullFactorizations = 0;
  /** Number of numeric-only refactorisations performed. */
  refactorizations = 0;

  private patternVersion = -1;
  private patternCount = -1;
  private csc: CscStructure | null = null;
  private q: Int32Array;
  private readonly pinv: Int32Array;
  private readonly prow: Int32Array;
  private Lp: Int32Array;
  private Li: Int32Array;
  private Lx: Float64Array;
  private Up: Int32Array;
  private Ui: Int32Array;
  private Ux: Float64Array;
  private readonly Ud: Float64Array;
  private readonly x: Float64Array;
  private readonly w: Float64Array;
  private readonly mark: Int32Array;
  private stamp = 0;
  private readonly topo: Int32Array;
  private readonly stackRow: Int32Array;
  private readonly stackPos: Int32Array;
  private readonly nonPiv: Int32Array;
  private nonPivCount = 0;
  private valid = false;

  constructor(n: number) {
    this.n = n;
    this.q = new Int32Array(n);
    this.pinv = new Int32Array(n);
    this.prow = new Int32Array(n);
    this.Lp = new Int32Array(n + 1);
    this.Up = new Int32Array(n + 1);
    const cap = Math.max(16, 4 * n);
    this.Li = new Int32Array(cap);
    this.Lx = new Float64Array(cap);
    this.Ui = new Int32Array(cap);
    this.Ux = new Float64Array(cap);
    this.Ud = new Float64Array(n);
    this.x = new Float64Array(n);
    this.w = new Float64Array(n);
    this.mark = new Int32Array(n);
    this.topo = new Int32Array(n);
    this.stackRow = new Int32Array(n);
    this.stackPos = new Int32Array(n);
    this.nonPiv = new Int32Array(n);
  }

  /** True after a successful factorisation. */
  get factored(): boolean {
    return this.valid;
  }

  /** Number of stored entries in L and U (including U's diagonal). */
  get factorNonzeros(): number {
    return this.Lp[this.n] + this.Up[this.n] + this.n;
  }

  /** Discard the symbolic analysis (the next factor() re-orders and re-pivots). */
  reset(): void {
    this.patternVersion = -1;
    this.valid = false;
  }

  /**
   * Factor the matrix. Throws {@link SingularMatrixError} when a column has no non-zero
   * pivot candidate and {@link NonFiniteMatrixError} when the matrix holds NaN/Infinity.
   */
  factor(m: SparseMatrix, describe?: UnknownDescriber): void {
    if (m.size !== this.n) throw new RangeError(`matrix size ${m.size} does not match LU size ${this.n}`);
    const p = m.pattern;
    this.valid = false;
    if (p.version !== this.patternVersion || p.count !== this.patternCount || this.csc === null) {
      this.csc = buildCsc(p);
      this.q = minimumDegreeOrdering(this.n, this.csc.colPtr, this.csc.rowIdx);
      this.patternVersion = p.version;
      this.patternCount = p.count;
      this.fullFactor(m.values, describe);
    } else if (!this.refactor(m.values)) {
      this.fullFactor(m.values, describe);
    }
    this.valid = true;
  }

  private nextStamp(): number {
    if (this.stamp >= 0x7ffffff0) {
      this.mark.fill(0);
      this.stamp = 0;
    }
    return ++this.stamp;
  }

  /** DFS reach of column `col` through the graph of L. Fills topo[top..n-1] and nonPiv; returns top. */
  private reach(col: number, cp: Int32Array, ri: Int32Array): number {
    const n = this.n;
    const pinv = this.pinv;
    const Lp = this.Lp;
    const Li = this.Li;
    const mark = this.mark;
    const topo = this.topo;
    const sr = this.stackRow;
    const sp = this.stackPos;
    const np = this.nonPiv;
    const stamp = this.nextStamp();
    let top = n;
    let cnt = 0;
    for (let p = cp[col]; p < cp[col + 1]; p++) {
      const r0 = ri[p];
      if (mark[r0] === stamp) continue;
      let head = 0;
      sr[0] = r0;
      while (head >= 0) {
        const r = sr[head];
        const j = pinv[r];
        if (mark[r] !== stamp) {
          mark[r] = stamp;
          if (j < 0) {
            np[cnt++] = r;
            head--;
            continue;
          }
          sp[head] = Lp[j];
        }
        const end = Lp[j + 1];
        let pos = sp[head];
        let pushed = false;
        while (pos < end) {
          const r2 = Li[pos++];
          if (mark[r2] !== stamp) {
            sp[head] = pos;
            sr[++head] = r2;
            pushed = true;
            break;
          }
        }
        if (!pushed) {
          head--;
          topo[--top] = j;
        }
      }
    }
    this.nonPivCount = cnt;
    return top;
  }

  private fullFactor(vals: Float64Array, describe?: UnknownDescriber): void {
    this.fullFactorizations++;
    const n = this.n;
    const csc = this.csc as CscStructure;
    const cp = csc.colPtr;
    const ri = csc.rowIdx;
    const slot = csc.slot;
    const q = this.q;
    const pinv = this.pinv;
    const prow = this.prow;
    const Ud = this.Ud;
    const x = this.x;
    const topo = this.topo;
    const np = this.nonPiv;
    const thr = this.pivotThreshold;
    pinv.fill(-1);
    let lnz = 0;
    let unz = 0;
    this.Lp[0] = 0;
    this.Up[0] = 0;
    for (let k = 0; k < n; k++) {
      const col = q[k];
      const top = this.reach(col, cp, ri);
      const cnt = this.nonPivCount;
      this.Li = growInt32(this.Li, lnz + cnt);
      this.Lx = growFloat64(this.Lx, lnz + cnt);
      this.Ui = growInt32(this.Ui, unz + (n - top));
      this.Ux = growFloat64(this.Ux, unz + (n - top));
      const Lp = this.Lp;
      const Li = this.Li;
      const Lx = this.Lx;
      const Ui = this.Ui;
      const Ux = this.Ux;
      for (let p = cp[col]; p < cp[col + 1]; p++) x[ri[p]] = vals[slot[p]];
      for (let t = top; t < n; t++) {
        const j = topo[t];
        const xj = x[prow[j]];
        if (xj !== 0) for (let p = Lp[j]; p < Lp[j + 1]; p++) x[Li[p]] -= Lx[p] * xj;
      }
      let ipiv = -1;
      let amax = 0;
      let bad = false;
      for (let t = 0; t < cnt; t++) {
        const r = np[t];
        const a = Math.abs(x[r]);
        if (a > amax) {
          amax = a;
          ipiv = r;
        } else if (a !== a) bad = true;
      }
      for (let t = top; t < n && !bad; t++) if (x[prow[topo[t]]] !== x[prow[topo[t]]]) bad = true;
      if (bad || amax === Infinity) {
        this.clearWork(top, cnt);
        throw new NonFiniteMatrixError(col, describe);
      }
      if (!(amax > 1e-300)) {
        this.clearWork(top, cnt);
        throw new SingularMatrixError(col, describe);
      }
      if (pinv[col] < 0 && Math.abs(x[col]) >= thr * amax) ipiv = col;
      for (let t = top; t < n; t++) {
        const j = topo[t];
        const r = prow[j];
        Ui[unz] = j;
        Ux[unz] = x[r];
        unz++;
        x[r] = 0;
      }
      const pivot = x[ipiv];
      Ud[k] = pivot;
      pinv[ipiv] = k;
      prow[k] = ipiv;
      x[ipiv] = 0;
      for (let t = 0; t < cnt; t++) {
        const r = np[t];
        if (r === ipiv) continue;
        Li[lnz] = r;
        Lx[lnz] = x[r] / pivot;
        lnz++;
        x[r] = 0;
      }
      Lp[k + 1] = lnz;
      this.Up[k + 1] = unz;
    }
  }

  private clearWork(top: number, cnt: number): void {
    const x = this.x;
    for (let t = top; t < this.n; t++) x[this.prow[this.topo[t]]] = 0;
    for (let t = 0; t < cnt; t++) x[this.nonPiv[t]] = 0;
  }

  /** Numeric refactorisation along the stored patterns. Returns false if a pivot became unacceptable. */
  private refactor(vals: Float64Array): boolean {
    const n = this.n;
    const csc = this.csc as CscStructure;
    const cp = csc.colPtr;
    const ri = csc.rowIdx;
    const slot = csc.slot;
    const q = this.q;
    const prow = this.prow;
    const Lp = this.Lp;
    const Li = this.Li;
    const Lx = this.Lx;
    const Up = this.Up;
    const Ui = this.Ui;
    const Ux = this.Ux;
    const Ud = this.Ud;
    const x = this.x;
    const thr = this.pivotThreshold;
    for (let k = 0; k < n; k++) {
      const col = q[k];
      for (let p = cp[col]; p < cp[col + 1]; p++) x[ri[p]] = vals[slot[p]];
      for (let t = Up[k]; t < Up[k + 1]; t++) {
        const j = Ui[t];
        const r = prow[j];
        const xj = x[r];
        x[r] = 0;
        Ux[t] = xj;
        if (xj !== 0) for (let p = Lp[j]; p < Lp[j + 1]; p++) x[Li[p]] -= Lx[p] * xj;
      }
      const rp = prow[k];
      const pivot = x[rp];
      x[rp] = 0;
      const ap = Math.abs(pivot);
      let amax = ap;
      for (let p = Lp[k]; p < Lp[k + 1]; p++) {
        const a = Math.abs(x[Li[p]]);
        if (a > amax) amax = a;
      }
      if (!(ap > 1e-300) || !(ap >= thr * amax) || amax === Infinity) {
        for (let p = Lp[k]; p < Lp[k + 1]; p++) x[Li[p]] = 0;
        return false;
      }
      Ud[k] = pivot;
      for (let p = Lp[k]; p < Lp[k + 1]; p++) {
        const r = Li[p];
        Lx[p] = x[r] / pivot;
        x[r] = 0;
      }
    }
    this.refactorizations++;
    return true;
  }

  /** Solve A x = b. `out` may alias `b`. */
  solve(b: Float64Array, out: Float64Array = new Float64Array(this.n)): Float64Array {
    if (!this.valid) throw new Error('SparseLU.solve called before a successful factor()');
    const n = this.n;
    const w = this.w;
    const y = this.x; // work vector, zero outside factor()
    const prow = this.prow;
    const Lp = this.Lp;
    const Li = this.Li;
    const Lx = this.Lx;
    const Up = this.Up;
    const Ui = this.Ui;
    const Ux = this.Ux;
    const Ud = this.Ud;
    w.set(b);
    for (let k = 0; k < n; k++) {
      const wk = w[prow[k]];
      if (wk !== 0) for (let p = Lp[k]; p < Lp[k + 1]; p++) w[Li[p]] -= Lx[p] * wk;
    }
    for (let k = 0; k < n; k++) y[k] = w[prow[k]];
    for (let k = n - 1; k >= 0; k--) {
      const yk = y[k] / Ud[k];
      y[k] = yk;
      if (yk !== 0) for (let t = Up[k]; t < Up[k + 1]; t++) y[Ui[t]] -= Ux[t] * yk;
    }
    const q = this.q;
    for (let k = 0; k < n; k++) out[q[k]] = y[k];
    y.fill(0);
    return out;
  }

  /** Solve A^T x = b. `out` may alias `b`. */
  solveTranspose(b: Float64Array, out: Float64Array = new Float64Array(this.n)): Float64Array {
    if (!this.valid) throw new Error('SparseLU.solveTranspose called before a successful factor()');
    const n = this.n;
    const z = this.w;
    const q = this.q;
    const pinv = this.pinv;
    const prow = this.prow;
    const Lp = this.Lp;
    const Li = this.Li;
    const Lx = this.Lx;
    const Up = this.Up;
    const Ui = this.Ui;
    const Ux = this.Ux;
    const Ud = this.Ud;
    for (let k = 0; k < n; k++) z[k] = b[q[k]];
    for (let k = 0; k < n; k++) {
      let s = z[k];
      for (let t = Up[k]; t < Up[k + 1]; t++) s -= Ux[t] * z[Ui[t]];
      z[k] = s / Ud[k];
    }
    for (let j = n - 1; j >= 0; j--) {
      let s = z[j];
      for (let p = Lp[j]; p < Lp[j + 1]; p++) s -= Lx[p] * z[pinv[Li[p]]];
      z[j] = s;
    }
    for (let k = 0; k < n; k++) out[prow[k]] = z[k];
    return out;
  }
}
