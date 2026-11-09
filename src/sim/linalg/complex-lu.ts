/**
 * Complex sparse LU factorisation with partial pivoting (left-looking, Gilbert-Peierls).
 *
 * Same algorithm and storage layout as the real {@link SparseLU} (see sparse-lu.ts),
 * with values held as separate real/imaginary arrays. Pivot magnitudes use the
 * 1-norm |re| + |im| (within a factor sqrt(2) of the modulus; cheaper and adequate for
 * threshold pivoting). Used for AC, noise, transfer-function and adjoint solves.
 *
 * {@link ComplexSparseLU.solveTranspose} solves the plain transpose A^T x = b (not the
 * conjugate transpose); for A^H x = b conjugate b, solve with the transpose, and
 * conjugate the result.
 */
import { buildCsc, growFloat64, growInt32, type ComplexSparseMatrix, type CscStructure } from './pattern';
import { minimumDegreeOrdering } from './ordering';
import { NonFiniteMatrixError, SingularMatrixError, type UnknownDescriber } from './errors';

export interface ComplexVector {
  re: Float64Array;
  im: Float64Array;
}

export class ComplexSparseLU {
  readonly n: number;
  pivotThreshold = 1e-3;
  fullFactorizations = 0;
  refactorizations = 0;

  private patternVersion = -1;
  private patternCount = -1;
  private csc: CscStructure | null = null;
  private q: Int32Array;
  private readonly pinv: Int32Array;
  private readonly prow: Int32Array;
  private Lp: Int32Array;
  private Li: Int32Array;
  private Lr: Float64Array;
  private Lim: Float64Array;
  private Up: Int32Array;
  private Ui: Int32Array;
  private Ur: Float64Array;
  private Uim: Float64Array;
  private readonly Dr: Float64Array;
  private readonly Di: Float64Array;
  private readonly xr: Float64Array;
  private readonly xi: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;
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
    this.Lr = new Float64Array(cap);
    this.Lim = new Float64Array(cap);
    this.Ui = new Int32Array(cap);
    this.Ur = new Float64Array(cap);
    this.Uim = new Float64Array(cap);
    this.Dr = new Float64Array(n);
    this.Di = new Float64Array(n);
    this.xr = new Float64Array(n);
    this.xi = new Float64Array(n);
    this.wr = new Float64Array(n);
    this.wi = new Float64Array(n);
    this.mark = new Int32Array(n);
    this.topo = new Int32Array(n);
    this.stackRow = new Int32Array(n);
    this.stackPos = new Int32Array(n);
    this.nonPiv = new Int32Array(n);
  }

  get factored(): boolean {
    return this.valid;
  }

  reset(): void {
    this.patternVersion = -1;
    this.valid = false;
  }

  factor(m: ComplexSparseMatrix, describe?: UnknownDescriber): void {
    if (m.size !== this.n) throw new RangeError(`matrix size ${m.size} does not match LU size ${this.n}`);
    const p = m.pattern;
    this.valid = false;
    if (p.version !== this.patternVersion || p.count !== this.patternCount || this.csc === null) {
      this.csc = buildCsc(p);
      this.q = minimumDegreeOrdering(this.n, this.csc.colPtr, this.csc.rowIdx);
      this.patternVersion = p.version;
      this.patternCount = p.count;
      this.fullFactor(m.re, m.im, describe);
    } else if (!this.refactor(m.re, m.im)) {
      this.fullFactor(m.re, m.im, describe);
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

  private fullFactor(vr: Float64Array, vi: Float64Array, describe?: UnknownDescriber): void {
    this.fullFactorizations++;
    const n = this.n;
    const csc = this.csc as CscStructure;
    const cp = csc.colPtr;
    const ri = csc.rowIdx;
    const slot = csc.slot;
    const q = this.q;
    const pinv = this.pinv;
    const prow = this.prow;
    const xr = this.xr;
    const xi = this.xi;
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
      this.Lr = growFloat64(this.Lr, lnz + cnt);
      this.Lim = growFloat64(this.Lim, lnz + cnt);
      this.Ui = growInt32(this.Ui, unz + (n - top));
      this.Ur = growFloat64(this.Ur, unz + (n - top));
      this.Uim = growFloat64(this.Uim, unz + (n - top));
      const Lp = this.Lp;
      const Li = this.Li;
      const Lr = this.Lr;
      const Lim = this.Lim;
      for (let p = cp[col]; p < cp[col + 1]; p++) {
        const r = ri[p];
        xr[r] = vr[slot[p]];
        xi[r] = vi[slot[p]];
      }
      for (let t = top; t < n; t++) {
        const j = topo[t];
        const rj = prow[j];
        const ar = xr[rj];
        const ai = xi[rj];
        if (ar !== 0 || ai !== 0) {
          for (let p = Lp[j]; p < Lp[j + 1]; p++) {
            const r = Li[p];
            const lr = Lr[p];
            const li = Lim[p];
            xr[r] -= lr * ar - li * ai;
            xi[r] -= lr * ai + li * ar;
          }
        }
      }
      let ipiv = -1;
      let amax = 0;
      let bad = false;
      for (let t = 0; t < cnt; t++) {
        const r = np[t];
        const a = Math.abs(xr[r]) + Math.abs(xi[r]);
        if (a > amax) {
          amax = a;
          ipiv = r;
        } else if (a !== a) bad = true;
      }
      if (bad || amax === Infinity) {
        this.clearWork(top, cnt);
        throw new NonFiniteMatrixError(col, describe);
      }
      if (!(amax > 1e-300)) {
        this.clearWork(top, cnt);
        throw new SingularMatrixError(col, describe);
      }
      if (pinv[col] < 0 && Math.abs(xr[col]) + Math.abs(xi[col]) >= thr * amax) ipiv = col;
      const Ui = this.Ui;
      const Ur = this.Ur;
      const Uim = this.Uim;
      for (let t = top; t < n; t++) {
        const j = topo[t];
        const r = prow[j];
        Ui[unz] = j;
        Ur[unz] = xr[r];
        Uim[unz] = xi[r];
        unz++;
        xr[r] = 0;
        xi[r] = 0;
      }
      const pr = xr[ipiv];
      const pi = xi[ipiv];
      this.Dr[k] = pr;
      this.Di[k] = pi;
      pinv[ipiv] = k;
      prow[k] = ipiv;
      xr[ipiv] = 0;
      xi[ipiv] = 0;
      const den = pr * pr + pi * pi;
      for (let t = 0; t < cnt; t++) {
        const r = np[t];
        if (r === ipiv) continue;
        const ar = xr[r];
        const ai = xi[r];
        Li[lnz] = r;
        Lr[lnz] = (ar * pr + ai * pi) / den;
        Lim[lnz] = (ai * pr - ar * pi) / den;
        lnz++;
        xr[r] = 0;
        xi[r] = 0;
      }
      Lp[k + 1] = lnz;
      this.Up[k + 1] = unz;
    }
  }

  private clearWork(top: number, cnt: number): void {
    for (let t = top; t < this.n; t++) {
      const r = this.prow[this.topo[t]];
      this.xr[r] = 0;
      this.xi[r] = 0;
    }
    for (let t = 0; t < cnt; t++) {
      const r = this.nonPiv[t];
      this.xr[r] = 0;
      this.xi[r] = 0;
    }
  }

  private refactor(vr: Float64Array, vi: Float64Array): boolean {
    const n = this.n;
    const csc = this.csc as CscStructure;
    const cp = csc.colPtr;
    const ri = csc.rowIdx;
    const slot = csc.slot;
    const q = this.q;
    const prow = this.prow;
    const Lp = this.Lp;
    const Li = this.Li;
    const Lr = this.Lr;
    const Lim = this.Lim;
    const Up = this.Up;
    const Ui = this.Ui;
    const Ur = this.Ur;
    const Uim = this.Uim;
    const xr = this.xr;
    const xi = this.xi;
    const thr = this.pivotThreshold;
    for (let k = 0; k < n; k++) {
      const col = q[k];
      for (let p = cp[col]; p < cp[col + 1]; p++) {
        const r = ri[p];
        xr[r] = vr[slot[p]];
        xi[r] = vi[slot[p]];
      }
      for (let t = Up[k]; t < Up[k + 1]; t++) {
        const j = Ui[t];
        const rj = prow[j];
        const ar = xr[rj];
        const ai = xi[rj];
        xr[rj] = 0;
        xi[rj] = 0;
        Ur[t] = ar;
        Uim[t] = ai;
        if (ar !== 0 || ai !== 0) {
          for (let p = Lp[j]; p < Lp[j + 1]; p++) {
            const r = Li[p];
            const lr = Lr[p];
            const li = Lim[p];
            xr[r] -= lr * ar - li * ai;
            xi[r] -= lr * ai + li * ar;
          }
        }
      }
      const rp = prow[k];
      const pr = xr[rp];
      const pi = xi[rp];
      xr[rp] = 0;
      xi[rp] = 0;
      const ap = Math.abs(pr) + Math.abs(pi);
      let amax = ap;
      for (let p = Lp[k]; p < Lp[k + 1]; p++) {
        const r = Li[p];
        const a = Math.abs(xr[r]) + Math.abs(xi[r]);
        if (a > amax) amax = a;
      }
      if (!(ap > 1e-300) || !(ap >= thr * amax) || amax === Infinity) {
        for (let p = Lp[k]; p < Lp[k + 1]; p++) {
          xr[Li[p]] = 0;
          xi[Li[p]] = 0;
        }
        return false;
      }
      this.Dr[k] = pr;
      this.Di[k] = pi;
      const den = pr * pr + pi * pi;
      for (let p = Lp[k]; p < Lp[k + 1]; p++) {
        const r = Li[p];
        const ar = xr[r];
        const ai = xi[r];
        Lr[p] = (ar * pr + ai * pi) / den;
        Lim[p] = (ai * pr - ar * pi) / den;
        xr[r] = 0;
        xi[r] = 0;
      }
    }
    this.refactorizations++;
    return true;
  }

  /** Solve A x = b. Output arrays may alias the inputs. */
  solve(
    br: Float64Array,
    bi: Float64Array,
    outRe: Float64Array = new Float64Array(this.n),
    outIm: Float64Array = new Float64Array(this.n),
  ): ComplexVector {
    if (!this.valid) throw new Error('ComplexSparseLU.solve called before a successful factor()');
    const n = this.n;
    const wr = this.wr;
    const wi = this.wi;
    const yr = this.xr;
    const yi = this.xi;
    const prow = this.prow;
    const Lp = this.Lp;
    const Li = this.Li;
    const Lr = this.Lr;
    const Lim = this.Lim;
    const Up = this.Up;
    const Ui = this.Ui;
    const Ur = this.Ur;
    const Uim = this.Uim;
    const Dr = this.Dr;
    const Di = this.Di;
    wr.set(br);
    wi.set(bi);
    for (let k = 0; k < n; k++) {
      const r = prow[k];
      const ar = wr[r];
      const ai = wi[r];
      if (ar !== 0 || ai !== 0) {
        for (let p = Lp[k]; p < Lp[k + 1]; p++) {
          const s = Li[p];
          wr[s] -= Lr[p] * ar - Lim[p] * ai;
          wi[s] -= Lr[p] * ai + Lim[p] * ar;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      yr[k] = wr[prow[k]];
      yi[k] = wi[prow[k]];
    }
    for (let k = n - 1; k >= 0; k--) {
      const dr = Dr[k];
      const di = Di[k];
      const den = dr * dr + di * di;
      const ar = yr[k];
      const ai = yi[k];
      const zr = (ar * dr + ai * di) / den;
      const zi = (ai * dr - ar * di) / den;
      yr[k] = zr;
      yi[k] = zi;
      if (zr !== 0 || zi !== 0) {
        for (let t = Up[k]; t < Up[k + 1]; t++) {
          const j = Ui[t];
          yr[j] -= Ur[t] * zr - Uim[t] * zi;
          yi[j] -= Ur[t] * zi + Uim[t] * zr;
        }
      }
    }
    const q = this.q;
    for (let k = 0; k < n; k++) {
      outRe[q[k]] = yr[k];
      outIm[q[k]] = yi[k];
    }
    yr.fill(0);
    yi.fill(0);
    return { re: outRe, im: outIm };
  }

  /** Solve A^T x = b (plain transpose). Output arrays may alias the inputs. */
  solveTranspose(
    br: Float64Array,
    bi: Float64Array,
    outRe: Float64Array = new Float64Array(this.n),
    outIm: Float64Array = new Float64Array(this.n),
  ): ComplexVector {
    if (!this.valid) throw new Error('ComplexSparseLU.solveTranspose called before a successful factor()');
    const n = this.n;
    const zr = this.wr;
    const zi = this.wi;
    const q = this.q;
    const pinv = this.pinv;
    const prow = this.prow;
    const Lp = this.Lp;
    const Li = this.Li;
    const Lr = this.Lr;
    const Lim = this.Lim;
    const Up = this.Up;
    const Ui = this.Ui;
    const Ur = this.Ur;
    const Uim = this.Uim;
    const Dr = this.Dr;
    const Di = this.Di;
    for (let k = 0; k < n; k++) {
      zr[k] = br[q[k]];
      zi[k] = bi[q[k]];
    }
    for (let k = 0; k < n; k++) {
      let sr = zr[k];
      let si = zi[k];
      for (let t = Up[k]; t < Up[k + 1]; t++) {
        const j = Ui[t];
        sr -= Ur[t] * zr[j] - Uim[t] * zi[j];
        si -= Ur[t] * zi[j] + Uim[t] * zr[j];
      }
      const dr = Dr[k];
      const di = Di[k];
      const den = dr * dr + di * di;
      zr[k] = (sr * dr + si * di) / den;
      zi[k] = (si * dr - sr * di) / den;
    }
    for (let j = n - 1; j >= 0; j--) {
      let sr = zr[j];
      let si = zi[j];
      for (let p = Lp[j]; p < Lp[j + 1]; p++) {
        const k = pinv[Li[p]];
        sr -= Lr[p] * zr[k] - Lim[p] * zi[k];
        si -= Lr[p] * zi[k] + Lim[p] * zr[k];
      }
      zr[j] = sr;
      zi[j] = si;
    }
    for (let k = 0; k < n; k++) {
      outRe[prow[k]] = zr[k];
      outIm[prow[k]] = zi[k];
    }
    return { re: outRe, im: outIm };
  }
}
