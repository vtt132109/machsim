/**
 * Sparse matrix storage used for MNA assembly (real and complex).
 *
 * Devices stamp entries by (row, col) in the same order on every load. The
 * {@link MatrixPattern} maps each structural position to a stable "slot" (an
 * index into a dense value array) and keeps a *stamp tape*: the sequence of
 * slots hit during the previous assembly. On the next assembly the k-th stamp
 * is compared with the tape entry k and, when it matches (the normal case),
 * the slot is found with two integer comparisons instead of a hash lookup.
 *
 * The pattern only ever grows. Every new structural entry bumps
 * {@link MatrixPattern.version}; factorisations compare that number to decide
 * whether their symbolic analysis (ordering, fill pattern) must be redone.
 *
 * Indices are 0-based unknown indices. Negative indices (GROUND = -1) are
 * ignored by {@link SparseMatrix.add}/{@link ComplexSparseMatrix.add}, so
 * devices can stamp blindly.
 */

/** Grow an Int32Array to at least `min` elements (amortised doubling). */
export function growInt32(a: Int32Array, min: number): Int32Array {
  if (a.length >= min) return a;
  let cap = Math.max(16, a.length * 2);
  while (cap < min) cap *= 2;
  const b = new Int32Array(cap);
  b.set(a);
  return b;
}

/** Grow a Float64Array to at least `min` elements (amortised doubling). */
export function growFloat64(a: Float64Array, min: number): Float64Array {
  if (a.length >= min) return a;
  let cap = Math.max(16, a.length * 2);
  while (cap < min) cap *= 2;
  const b = new Float64Array(cap);
  b.set(a);
  return b;
}

/** Structural (pattern) part of a square sparse matrix, shared by real and complex storage. */
export class MatrixPattern {
  /** Matrix dimension. */
  readonly size: number;
  /** Number of structural entries (= number of slots in use). */
  count = 0;
  /** Incremented every time a new structural entry is created. */
  version = 0;
  /** Row of each slot. */
  rowOf: Int32Array;
  /** Column of each slot. */
  colOf: Int32Array;

  private readonly rowMaps: (Map<number, number> | undefined)[];
  private tapeRow: Int32Array;
  private tapeCol: Int32Array;
  private tapeSlot: Int32Array;
  private tapeLen = 0;
  private cursor = 0;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 0) throw new RangeError(`invalid matrix size ${size}`);
    this.size = size;
    this.rowMaps = new Array<Map<number, number> | undefined>(size);
    const cap = Math.max(16, size * 4);
    this.rowOf = new Int32Array(cap);
    this.colOf = new Int32Array(cap);
    this.tapeRow = new Int32Array(cap);
    this.tapeCol = new Int32Array(cap);
    this.tapeSlot = new Int32Array(cap);
  }

  /** Start a new assembly: the next {@link slot} call is compared with tape position 0. */
  rewind(): void {
    this.cursor = 0;
  }

  /** Slot of (row, col) for the next stamp of the current assembly (creates the entry if needed). */
  slot(row: number, col: number): number {
    const k = this.cursor++;
    if (k < this.tapeLen && this.tapeRow[k] === row && this.tapeCol[k] === col) return this.tapeSlot[k];
    return this.slowSlot(k, row, col);
  }

  /** Slot of (row, col) or -1 when the entry is not part of the pattern. Does not touch the tape. */
  find(row: number, col: number): number {
    if (row < 0 || row >= this.size) return -1;
    const m = this.rowMaps[row];
    if (m === undefined) return -1;
    const s = m.get(col);
    return s === undefined ? -1 : s;
  }

  /** Make sure (row, col) is a structural entry (without recording it on the tape); returns its slot. */
  ensure(row: number, col: number): number {
    this.check(row, col);
    const s = this.find(row, col);
    return s >= 0 ? s : this.create(row, col);
  }

  private check(row: number, col: number): void {
    if (!(row >= 0 && row < this.size && col >= 0 && col < this.size) || !Number.isInteger(row) || !Number.isInteger(col)) {
      throw new RangeError(`matrix index (${row}, ${col}) out of range for size ${this.size}`);
    }
  }

  private create(row: number, col: number): number {
    const s = this.count++;
    this.rowOf = growInt32(this.rowOf, s + 1);
    this.colOf = growInt32(this.colOf, s + 1);
    this.rowOf[s] = row;
    this.colOf[s] = col;
    let m = this.rowMaps[row];
    if (m === undefined) {
      m = new Map<number, number>();
      this.rowMaps[row] = m;
    }
    m.set(col, s);
    this.version++;
    return s;
  }

  private slowSlot(k: number, row: number, col: number): number {
    this.check(row, col);
    let s = this.find(row, col);
    if (s < 0) s = this.create(row, col);
    if (k >= this.tapeRow.length) {
      this.tapeRow = growInt32(this.tapeRow, k + 1);
      this.tapeCol = growInt32(this.tapeCol, k + 1);
      this.tapeSlot = growInt32(this.tapeSlot, k + 1);
    }
    this.tapeRow[k] = row;
    this.tapeCol[k] = col;
    this.tapeSlot[k] = s;
    if (k >= this.tapeLen) this.tapeLen = k + 1;
    return s;
  }
}

/** Compressed-sparse-column view of a pattern: entries sorted by column, then row. */
export interface CscStructure {
  n: number;
  /** column pointers, length n + 1 */
  colPtr: Int32Array;
  /** row index of each CSC entry */
  rowIdx: Int32Array;
  /** value slot of each CSC entry */
  slot: Int32Array;
}

/** Build the CSC structure of a pattern (counting sort by column, rows sorted inside each column). */
export function buildCsc(p: MatrixPattern): CscStructure {
  const n = p.size;
  const nnz = p.count;
  const colPtr = new Int32Array(n + 1);
  for (let s = 0; s < nnz; s++) colPtr[p.colOf[s] + 1]++;
  for (let c = 0; c < n; c++) colPtr[c + 1] += colPtr[c];
  const next = colPtr.slice(0, n);
  const rowIdx = new Int32Array(nnz);
  const slot = new Int32Array(nnz);
  for (let s = 0; s < nnz; s++) {
    const c = p.colOf[s];
    const k = next[c]++;
    rowIdx[k] = p.rowOf[s];
    slot[k] = s;
  }
  // insertion sort rows within each column (columns are short in circuit matrices)
  for (let c = 0; c < n; c++) {
    for (let i = colPtr[c] + 1; i < colPtr[c + 1]; i++) {
      const r = rowIdx[i];
      const sl = slot[i];
      let j = i - 1;
      while (j >= colPtr[c] && rowIdx[j] > r) {
        rowIdx[j + 1] = rowIdx[j];
        slot[j + 1] = slot[j];
        j--;
      }
      rowIdx[j + 1] = r;
      slot[j + 1] = sl;
    }
  }
  return { n, colPtr, rowIdx, slot };
}

/** Real sparse matrix: a pattern plus one value per slot. */
export class SparseMatrix {
  readonly pattern: MatrixPattern;
  values: Float64Array;

  constructor(size: number) {
    this.pattern = new MatrixPattern(size);
    this.values = new Float64Array(Math.max(16, size * 4));
  }

  get size(): number {
    return this.pattern.size;
  }

  /** Zero all values and rewind the stamp tape (call before every assembly). */
  clear(): void {
    this.values.fill(0, 0, this.pattern.count);
    this.pattern.rewind();
  }

  /** Accumulate `value` at (row, col). Negative indices (ground) are ignored. */
  add(row: number, col: number, value: number): void {
    if (row < 0 || col < 0) return;
    const s = this.pattern.slot(row, col);
    let v = this.values;
    if (s >= v.length) {
      v = growFloat64(v, s + 1);
      this.values = v;
    }
    v[s] += value;
  }

  /** Value at (row, col) (0 when not structural). */
  get(row: number, col: number): number {
    const s = this.pattern.find(row, col);
    return s < 0 ? 0 : this.values[s];
  }

  /** y = A * x */
  multiply(x: Float64Array, y: Float64Array = new Float64Array(this.size)): Float64Array {
    y.fill(0);
    const p = this.pattern;
    for (let s = 0; s < p.count; s++) y[p.rowOf[s]] += this.values[s] * x[p.colOf[s]];
    return y;
  }

  /** y = A^T * x */
  multiplyTranspose(x: Float64Array, y: Float64Array = new Float64Array(this.size)): Float64Array {
    y.fill(0);
    const p = this.pattern;
    for (let s = 0; s < p.count; s++) y[p.colOf[s]] += this.values[s] * x[p.rowOf[s]];
    return y;
  }
}

/** Complex sparse matrix: a pattern plus real and imaginary parts per slot. */
export class ComplexSparseMatrix {
  readonly pattern: MatrixPattern;
  re: Float64Array;
  im: Float64Array;

  constructor(size: number) {
    this.pattern = new MatrixPattern(size);
    const cap = Math.max(16, size * 4);
    this.re = new Float64Array(cap);
    this.im = new Float64Array(cap);
  }

  get size(): number {
    return this.pattern.size;
  }

  clear(): void {
    const c = this.pattern.count;
    this.re.fill(0, 0, c);
    this.im.fill(0, 0, c);
    this.pattern.rewind();
  }

  /** Accumulate (re + j*im) at (row, col). Negative indices (ground) are ignored. */
  add(row: number, col: number, re: number, im: number): void {
    if (row < 0 || col < 0) return;
    const s = this.pattern.slot(row, col);
    if (s >= this.re.length) {
      this.re = growFloat64(this.re, s + 1);
      this.im = growFloat64(this.im, s + 1);
    }
    this.re[s] += re;
    this.im[s] += im;
  }

  get(row: number, col: number): { re: number; im: number } {
    const s = this.pattern.find(row, col);
    return s < 0 ? { re: 0, im: 0 } : { re: this.re[s], im: this.im[s] };
  }

  /** (yr + j yi) = A * (xr + j xi) */
  multiply(
    xr: Float64Array,
    xi: Float64Array,
    yr: Float64Array = new Float64Array(this.size),
    yi: Float64Array = new Float64Array(this.size),
  ): { re: Float64Array; im: Float64Array } {
    yr.fill(0);
    yi.fill(0);
    const p = this.pattern;
    for (let s = 0; s < p.count; s++) {
      const r = p.rowOf[s];
      const c = p.colOf[s];
      const ar = this.re[s];
      const ai = this.im[s];
      yr[r] += ar * xr[c] - ai * xi[c];
      yi[r] += ar * xi[c] + ai * xr[c];
    }
    return { re: yr, im: yi };
  }
}
