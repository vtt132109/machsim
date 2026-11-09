/**
 * Eigenvalues of dense complex matrices (used by the pole-zero analysis).
 *
 * Algorithm (standard numerical linear algebra, implemented from the textbook description):
 * 1. Balancing: diagonal similarity D⁻¹AD with powers of two so that row and column norms are
 *    comparable (Parlett–Reinsch). MNA-derived matrices mix volts, amperes and seconds and are
 *    badly scaled without it.
 * 2. Reduction to upper Hessenberg form with complex Householder reflectors.
 * 3. Shifted QR iteration on the Hessenberg matrix: Wilkinson shift from the trailing 2×2 block,
 *    one QR step done with complex Givens rotations, deflation when a subdiagonal entry becomes
 *    negligible (|h[k,k−1]| ≤ ε(|h[k−1,k−1]| + |h[k,k]|)), exceptional shifts after 10 and 20
 *    iterations without deflation. Only the active block is updated (eigenvalues only).
 *
 * Matrices are row-major: element (i, j) at index i*n + j.
 */
import { SimulationError } from '../results';

export interface ComplexArray {
  re: Float64Array;
  im: Float64Array;
}

const EPS = Number.EPSILON;

function cabs(re: number, im: number): number {
  return Math.hypot(re, im);
}

/** Principal square root of (re + j·im). */
function csqrt(re: number, im: number): [number, number] {
  const m = Math.hypot(re, im);
  if (m === 0) return [0, 0];
  const r = Math.sqrt((m + Math.abs(re)) / 2);
  if (re >= 0) return [r, im / (2 * r)];
  return [Math.abs(im) / (2 * r), im >= 0 ? r : -r];
}

/** Balance a complex matrix in place (radix-2 diagonal similarity). */
function balance(n: number, ar: Float64Array, ai: Float64Array): void {
  let changed = true;
  let sweeps = 0;
  while (changed && sweeps++ < 100) {
    changed = false;
    for (let i = 0; i < n; i++) {
      let c = 0;
      let r = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        c += Math.abs(ar[j * n + i]) + Math.abs(ai[j * n + i]);
        r += Math.abs(ar[i * n + j]) + Math.abs(ai[i * n + j]);
      }
      if (c === 0 || r === 0) continue;
      const f = Math.pow(2, Math.round(Math.log2(r / c) / 2));
      if (f === 1) continue;
      if (c * f + r / f >= 0.95 * (c + r)) continue;
      changed = true;
      // column i *= f, row i /= f
      for (let j = 0; j < n; j++) {
        ar[j * n + i] *= f;
        ai[j * n + i] *= f;
        ar[i * n + j] /= f;
        ai[i * n + j] /= f;
      }
    }
  }
}

/** Reduce to upper Hessenberg form in place (Householder similarity transforms). */
function hessenberg(n: number, ar: Float64Array, ai: Float64Array): void {
  const vr = new Float64Array(n);
  const vi = new Float64Array(n);
  for (let k = 0; k < n - 2; k++) {
    let norm2 = 0;
    for (let i = k + 1; i < n; i++) norm2 += ar[i * n + k] ** 2 + ai[i * n + k] ** 2;
    if (norm2 === 0) continue;
    const norm = Math.sqrt(norm2);
    const x0r = ar[(k + 1) * n + k];
    const x0i = ai[(k + 1) * n + k];
    const x0m = cabs(x0r, x0i);
    // phase of the first element (1 when it is zero)
    const pr = x0m > 0 ? x0r / x0m : 1;
    const pi = x0m > 0 ? x0i / x0m : 0;
    // v = x + phase*||x|| e1 (avoids cancellation)
    for (let i = k + 1; i < n; i++) {
      vr[i] = ar[i * n + k];
      vi[i] = ai[i * n + k];
    }
    vr[k + 1] += pr * norm;
    vi[k + 1] += pi * norm;
    let vnorm2 = 0;
    for (let i = k + 1; i < n; i++) vnorm2 += vr[i] * vr[i] + vi[i] * vi[i];
    if (vnorm2 === 0) continue;
    const beta = 2 / vnorm2;
    // left: A = (I - beta v v^H) A on rows k+1.., columns k..
    for (let j = k; j < n; j++) {
      let sr = 0;
      let si = 0;
      for (let i = k + 1; i < n; i++) {
        const a = ar[i * n + j];
        const b = ai[i * n + j];
        // conj(v_i) * a_ij
        sr += vr[i] * a + vi[i] * b;
        si += vr[i] * b - vi[i] * a;
      }
      sr *= beta;
      si *= beta;
      for (let i = k + 1; i < n; i++) {
        ar[i * n + j] -= vr[i] * sr - vi[i] * si;
        ai[i * n + j] -= vr[i] * si + vi[i] * sr;
      }
    }
    // right: A = A (I - beta v v^H) on all rows, columns k+1..
    for (let i = 0; i < n; i++) {
      let sr = 0;
      let si = 0;
      for (let j = k + 1; j < n; j++) {
        const a = ar[i * n + j];
        const b = ai[i * n + j];
        sr += a * vr[j] - b * vi[j];
        si += a * vi[j] + b * vr[j];
      }
      sr *= beta;
      si *= beta;
      for (let j = k + 1; j < n; j++) {
        // s * conj(v_j)
        ar[i * n + j] -= sr * vr[j] + si * vi[j];
        ai[i * n + j] -= si * vr[j] - sr * vi[j];
      }
    }
    for (let i = k + 2; i < n; i++) {
      ar[i * n + k] = 0;
      ai[i * n + k] = 0;
    }
  }
}

/**
 * Eigenvalues of the n×n complex matrix (re, im), row-major. Inputs are not modified.
 * Throws SimulationError('noconv') if the QR iteration fails to converge.
 */
export function complexEigenvalues(re: Float64Array, im: Float64Array, n: number): ComplexArray {
  const out: ComplexArray = { re: new Float64Array(n), im: new Float64Array(n) };
  if (n === 0) return out;
  const hr = Float64Array.from(re.subarray(0, n * n));
  const hi = Float64Array.from(im.subarray(0, n * n));
  for (let k = 0; k < n * n; k++) {
    if (!Number.isFinite(hr[k]) || !Number.isFinite(hi[k])) throw new SimulationError('Eigenvalue solver: matrix has non-finite entries', 'singular');
  }
  balance(n, hr, hi);
  hessenberg(n, hr, hi);
  let anorm = 0;
  for (let k = 0; k < n * n; k++) anorm = Math.max(anorm, cabs(hr[k], hi[k]));
  const at = (i: number, j: number) => i * n + j;
  const cs = new Float64Array(n);
  const snr = new Float64Array(n);
  const sni = new Float64Array(n);

  let hiIdx = n - 1;
  let iter = 0;
  let totalIter = 0;
  const maxTotal = 100 * n;
  while (hiIdx >= 0) {
    // find the start of the active unreduced block
    let l = hiIdx;
    while (l > 0) {
      const s0 = cabs(hr[at(l - 1, l - 1)], hi[at(l - 1, l - 1)]) + cabs(hr[at(l, l)], hi[at(l, l)]);
      const s = s0 === 0 ? anorm : s0;
      if (cabs(hr[at(l, l - 1)], hi[at(l, l - 1)]) <= EPS * s) {
        hr[at(l, l - 1)] = 0;
        hi[at(l, l - 1)] = 0;
        break;
      }
      l--;
    }
    if (l === hiIdx) {
      out.re[hiIdx] = hr[at(hiIdx, hiIdx)];
      out.im[hiIdx] = hi[at(hiIdx, hiIdx)];
      hiIdx--;
      iter = 0;
      continue;
    }
    if (++totalIter > maxTotal) throw new SimulationError('Eigenvalue solver: QR iteration did not converge', 'noconv');
    iter++;
    // shift
    let mur: number;
    let mui: number;
    if (iter === 10 || iter === 20) {
      // exceptional shift
      const a = cabs(hr[at(hiIdx, hiIdx - 1)], hi[at(hiIdx, hiIdx - 1)]);
      const b = hiIdx >= 2 ? cabs(hr[at(hiIdx - 1, hiIdx - 2)], hi[at(hiIdx - 1, hiIdx - 2)]) : 0;
      mur = hr[at(hiIdx, hiIdx)] + 0.75 * (a + b);
      mui = hi[at(hiIdx, hiIdx)];
    } else {
      const ar = hr[at(hiIdx - 1, hiIdx - 1)];
      const ai = hi[at(hiIdx - 1, hiIdx - 1)];
      const br = hr[at(hiIdx - 1, hiIdx)];
      const bi = hi[at(hiIdx - 1, hiIdx)];
      const cr = hr[at(hiIdx, hiIdx - 1)];
      const ci = hi[at(hiIdx, hiIdx - 1)];
      const dr = hr[at(hiIdx, hiIdx)];
      const di = hi[at(hiIdx, hiIdx)];
      // eigenvalues of [[a b][c d]]: m ± sqrt(q), m = (a+d)/2, q = ((a-d)/2)^2 + b c
      const mr = (ar + dr) / 2;
      const mi = (ai + di) / 2;
      const hr2 = (ar - dr) / 2;
      const hi2 = (ai - di) / 2;
      const qr = hr2 * hr2 - hi2 * hi2 + (br * cr - bi * ci);
      const qi = 2 * hr2 * hi2 + (br * ci + bi * cr);
      const [sr, si] = csqrt(qr, qi);
      const l1r = mr + sr;
      const l1i = mi + si;
      const l2r = mr - sr;
      const l2i = mi - si;
      if (cabs(l1r - dr, l1i - di) <= cabs(l2r - dr, l2i - di)) {
        mur = l1r;
        mui = l1i;
      } else {
        mur = l2r;
        mui = l2i;
      }
    }
    // QR step on the active block [l, hiIdx]
    for (let k = l; k <= hiIdx; k++) {
      hr[at(k, k)] -= mur;
      hi[at(k, k)] -= mui;
    }
    for (let k = l; k < hiIdx; k++) {
      const ar = hr[at(k, k)];
      const ai = hi[at(k, k)];
      const br = hr[at(k + 1, k)];
      const bi = hi[at(k + 1, k)];
      const am = cabs(ar, ai);
      const bm = cabs(br, bi);
      let c: number;
      let sr: number;
      let si: number;
      if (bm === 0) {
        c = 1;
        sr = 0;
        si = 0;
      } else if (am === 0) {
        c = 0;
        // s = conj(b)/|b|
        sr = br / bm;
        si = -bi / bm;
      } else {
        const r = Math.hypot(am, bm);
        c = am / r;
        // s = (a/|a|) * conj(b) / r
        const ur = ar / am;
        const ui = ai / am;
        sr = (ur * br + ui * bi) / r;
        si = (ui * br - ur * bi) / r;
      }
      cs[k] = c;
      snr[k] = sr;
      sni[k] = si;
      // rows k, k+1: [c s; -conj(s) c]
      for (let j = k; j <= hiIdx; j++) {
        const t1r = hr[at(k, j)];
        const t1i = hi[at(k, j)];
        const t2r = hr[at(k + 1, j)];
        const t2i = hi[at(k + 1, j)];
        hr[at(k, j)] = c * t1r + (sr * t2r - si * t2i);
        hi[at(k, j)] = c * t1i + (sr * t2i + si * t2r);
        // -conj(s) t1 + c t2
        hr[at(k + 1, j)] = -(sr * t1r + si * t1i) + c * t2r;
        hi[at(k + 1, j)] = -(sr * t1i - si * t1r) + c * t2i;
      }
    }
    for (let k = l; k < hiIdx; k++) {
      const c = cs[k];
      const sr = snr[k];
      const si = sni[k];
      // columns k, k+1 times G^H = [c -s; conj(s) c]
      const rowEnd = Math.min(k + 1, hiIdx);
      for (let i = l; i <= rowEnd; i++) {
        const t1r = hr[at(i, k)];
        const t1i = hi[at(i, k)];
        const t2r = hr[at(i, k + 1)];
        const t2i = hi[at(i, k + 1)];
        // c t1 + conj(s) t2
        hr[at(i, k)] = c * t1r + (sr * t2r + si * t2i);
        hi[at(i, k)] = c * t1i + (sr * t2i - si * t2r);
        // -s t1 + c t2
        hr[at(i, k + 1)] = -(sr * t1r - si * t1i) + c * t2r;
        hi[at(i, k + 1)] = -(sr * t1i + si * t1r) + c * t2i;
      }
    }
    for (let k = l; k <= hiIdx; k++) {
      hr[at(k, k)] += mur;
      hi[at(k, k)] += mui;
    }
  }
  return out;
}

/** Eigenvalues of a real n×n matrix (row-major). */
export function realEigenvalues(a: Float64Array, n: number): ComplexArray {
  return complexEigenvalues(a, new Float64Array(n * n), n);
}
