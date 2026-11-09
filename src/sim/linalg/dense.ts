/**
 * Dense LU factorisation with partial pivoting (real and complex), row-major storage.
 *
 * Intended for small systems (N <= ~60): reference solutions in tests, small
 * auxiliary problems in analyses (e.g. pole-zero companion matrices). The circuit
 * engine itself always uses the sparse factorisations.
 */
import { SingularMatrixError, type UnknownDescriber } from './errors';

/** Real dense LU: factor once, solve many right-hand sides. */
export class DenseLU {
  readonly n: number;
  private readonly a: Float64Array;
  private readonly perm: Int32Array;

  /** `matrix` is row-major n*n (copied) or an array of rows. */
  constructor(matrix: Float64Array | number[][], n?: number, describe?: UnknownDescriber) {
    if (Array.isArray(matrix)) {
      this.n = matrix.length;
      this.a = new Float64Array(this.n * this.n);
      for (let i = 0; i < this.n; i++) for (let j = 0; j < this.n; j++) this.a[i * this.n + j] = matrix[i][j];
    } else {
      this.n = n ?? Math.round(Math.sqrt(matrix.length));
      this.a = Float64Array.from(matrix);
    }
    this.perm = new Int32Array(this.n);
    this.decompose(describe);
  }

  private decompose(describe?: UnknownDescriber): void {
    const n = this.n;
    const a = this.a;
    for (let i = 0; i < n; i++) this.perm[i] = i;
    for (let k = 0; k < n; k++) {
      let piv = k;
      let amax = Math.abs(a[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(a[i * n + k]);
        if (v > amax) {
          amax = v;
          piv = i;
        }
      }
      if (!(amax > 1e-300)) throw new SingularMatrixError(k, describe);
      if (piv !== k) {
        for (let j = 0; j < n; j++) {
          const t = a[k * n + j];
          a[k * n + j] = a[piv * n + j];
          a[piv * n + j] = t;
        }
        const t = this.perm[k];
        this.perm[k] = this.perm[piv];
        this.perm[piv] = t;
      }
      const d = a[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = (a[i * n + k] /= d);
        if (f !== 0) for (let j = k + 1; j < n; j++) a[i * n + j] -= f * a[k * n + j];
      }
    }
  }

  solve(b: ArrayLike<number>): Float64Array {
    const n = this.n;
    const a = this.a;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = b[this.perm[i]];
    for (let i = 0; i < n; i++) {
      let s = x[i];
      for (let j = 0; j < i; j++) s -= a[i * n + j] * x[j];
      x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = x[i];
      for (let j = i + 1; j < n; j++) s -= a[i * n + j] * x[j];
      x[i] = s / a[i * n + i];
    }
    return x;
  }
}

/** Complex dense LU (separate real/imaginary row-major arrays). */
export class DenseComplexLU {
  readonly n: number;
  private readonly ar: Float64Array;
  private readonly ai: Float64Array;
  private readonly perm: Int32Array;

  constructor(re: Float64Array, im: Float64Array, n: number, describe?: UnknownDescriber) {
    this.n = n;
    this.ar = Float64Array.from(re);
    this.ai = Float64Array.from(im);
    this.perm = new Int32Array(n);
    this.decompose(describe);
  }

  private decompose(describe?: UnknownDescriber): void {
    const n = this.n;
    const ar = this.ar;
    const ai = this.ai;
    for (let i = 0; i < n; i++) this.perm[i] = i;
    for (let k = 0; k < n; k++) {
      let piv = k;
      let amax = Math.hypot(ar[k * n + k], ai[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.hypot(ar[i * n + k], ai[i * n + k]);
        if (v > amax) {
          amax = v;
          piv = i;
        }
      }
      if (!(amax > 1e-300)) throw new SingularMatrixError(k, describe);
      if (piv !== k) {
        for (let j = 0; j < n; j++) {
          let t = ar[k * n + j];
          ar[k * n + j] = ar[piv * n + j];
          ar[piv * n + j] = t;
          t = ai[k * n + j];
          ai[k * n + j] = ai[piv * n + j];
          ai[piv * n + j] = t;
        }
        const t = this.perm[k];
        this.perm[k] = this.perm[piv];
        this.perm[piv] = t;
      }
      const dr = ar[k * n + k];
      const di = ai[k * n + k];
      const den = dr * dr + di * di;
      for (let i = k + 1; i < n; i++) {
        const xr = ar[i * n + k];
        const xi = ai[i * n + k];
        const fr = (xr * dr + xi * di) / den;
        const fi = (xi * dr - xr * di) / den;
        ar[i * n + k] = fr;
        ai[i * n + k] = fi;
        if (fr === 0 && fi === 0) continue;
        for (let j = k + 1; j < n; j++) {
          const ur = ar[k * n + j];
          const ui = ai[k * n + j];
          ar[i * n + j] -= fr * ur - fi * ui;
          ai[i * n + j] -= fr * ui + fi * ur;
        }
      }
    }
  }

  solve(br: ArrayLike<number>, bi: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
    const n = this.n;
    const ar = this.ar;
    const ai = this.ai;
    const xr = new Float64Array(n);
    const xi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xr[i] = br[this.perm[i]];
      xi[i] = bi[this.perm[i]];
    }
    for (let i = 0; i < n; i++) {
      let sr = xr[i];
      let si = xi[i];
      for (let j = 0; j < i; j++) {
        const lr = ar[i * n + j];
        const li = ai[i * n + j];
        sr -= lr * xr[j] - li * xi[j];
        si -= lr * xi[j] + li * xr[j];
      }
      xr[i] = sr;
      xi[i] = si;
    }
    for (let i = n - 1; i >= 0; i--) {
      let sr = xr[i];
      let si = xi[i];
      for (let j = i + 1; j < n; j++) {
        const ur = ar[i * n + j];
        const ui = ai[i * n + j];
        sr -= ur * xr[j] - ui * xi[j];
        si -= ur * xi[j] + ui * xr[j];
      }
      const dr = ar[i * n + i];
      const di = ai[i * n + i];
      const den = dr * dr + di * di;
      xr[i] = (sr * dr + si * di) / den;
      xi[i] = (si * dr - sr * di) / den;
    }
    return { re: xr, im: xi };
  }
}
