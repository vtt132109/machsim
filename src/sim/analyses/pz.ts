/**
 * Pole-zero analysis ('pz') of a small-signal transfer function.
 *
 * The circuit is linearised at its operating point and its MNA matrix is written as the pencil
 * Y(s) = G + s·C (G = AC matrix at ω = 0, C = imaginary part of the AC matrix at ω = 1 rad/s;
 * every linear R/L/C/controlled-source stamp is of this form). The input port (inPos, inNeg) and
 * output port (outPos, outNeg) define:
 *   transfer 'vol'  H(s) = V(out)/V(in). When an independent voltage source is connected directly
 *                   across the input port it is the drive (unit value): H = cᵀ Y⁻¹ e_branch;
 *                   otherwise the port is driven by a current and H = (cᵀY⁻¹b)/(c_inᵀY⁻¹b).
 *   transfer 'cur'  H(s) = V(out)/I(in), current b injected into inPos and drawn from inNeg. A
 *                   voltage source connected across the input port would short the drive and is
 *                   removed (opened) for this analysis, with a warning.
 * Independent sources are zero (V shorted, I open), as in any small-signal analysis.
 *
 * Roots: for H = cᵀY⁻¹b, the zeros are the roots of det [[Y(s), b], [cᵀ, 0]] (bordered matrix)
 * and the poles the roots of det Y(s) (for the current-driven 'vol' case, the roots of the
 * bordered determinant with c_in). Each determinant det(A0 + s·A1) is solved as a generalised
 * eigenvalue problem by shift-and-invert: with K = A0 + σA1 non-singular, its finite roots are
 * s = σ − 1/μ for the non-zero eigenvalues μ of K⁻¹A1. Only the columns where A1 is non-zero
 * (capacitive node voltages, inductor currents) carry dynamics, so the eigenproblem is reduced
 * to that block (exact: the remaining columns of K⁻¹A1 are zero). The eigenvalues come from the
 * dense complex QR algorithm (eigen.ts). The computation is repeated with a second shift and only
 * roots found by both runs are kept (relative agreement 1e-4), which removes spurious roots that
 * index-2 structures (capacitor/voltage-source loops, inductor/current-source cut sets) produce
 * from rounding. Pole-zero pairs that coincide (relative 1e-6) are uncontrollable or unobservable
 * modes and are cancelled (reported in a warning). Conjugate pairs are made exactly symmetric and
 * imaginary parts below 1e-10·|s| are set to zero.
 *
 * Result: table ['Type', 'Real (1/s)', 'Imaginary (rad/s)', 'Magnitude (Hz)', 'Damping ratio'],
 * complex vectors "pole" and "zero" (rad/s), scalars { poles, zeros, gain_constant } where
 * H(s) = gain_constant · Π(s − z)/Π(s − p). Transmission lines (T, O) are not supported: their
 * delay is not rational in s.
 */
import type { PzAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type Vector } from '../results';
import { DenseComplexLU, SingularMatrixError } from '../linalg';
import { AcSystem } from '../engine/ac';
import type { AnalysisContext } from '../engine/analysis-registry';
import type { Circuit } from '../engine/circuit';
import { computeOperatingPoint } from '../engine/analyses';
import { analysisTitle } from '../engine/titles';
import { complexEigenvalues } from './eigen';
import { deviceNodes } from './util';

export interface Complex {
  re: number;
  im: number;
}

/** det(A0 + s·A1) = 0 problem, dense row-major m×m (real A0 / A1 parts; complex allowed). */
interface Pencil {
  m: number;
  a0: Float64Array;
  a1: Float64Array;
}

const MAX_UNKNOWNS = 1500;

function cmul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cdiv(a: Complex, b: Complex): Complex {
  const m = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / m, im: (a.im * b.re - a.re * b.im) / m };
}

function cabs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

/** Finite roots of det(A0 + s·A1) using one complex shift; undefined when A0 + σA1 is singular. */
function rootsWithShift(p: Pencil, shift: Complex): Complex[] | undefined {
  const m = p.m;
  const cols: number[] = [];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      if (p.a1[i * m + j] !== 0) {
        cols.push(j);
        break;
      }
    }
  }
  if (cols.length === 0) return [];
  const kr = new Float64Array(m * m);
  const ki = new Float64Array(m * m);
  for (let k = 0; k < m * m; k++) {
    kr[k] = p.a0[k] + shift.re * p.a1[k];
    ki[k] = shift.im * p.a1[k];
  }
  let lu: DenseComplexLU;
  try {
    lu = new DenseComplexLU(kr, ki, m);
  } catch (e) {
    if (e instanceof SingularMatrixError) return undefined;
    throw e;
  }
  // reject numerically singular shifts: ||K||·||K⁻¹·1|| / ||1|| estimates the condition number
  {
    const y = lu.solve(new Float64Array(m).fill(1), new Float64Array(m));
    let ymax = 0;
    for (let i = 0; i < m; i++) ymax = Math.max(ymax, Math.hypot(y.re[i], y.im[i]));
    let knorm = 0;
    for (let i = 0; i < m; i++) {
      let row = 0;
      for (let j = 0; j < m; j++) row += Math.hypot(kr[i * m + j], ki[i * m + j]);
      knorm = Math.max(knorm, row);
    }
    if (!(ymax * knorm < 1e14)) return undefined;
  }
  const q = cols.length;
  const mr = new Float64Array(q * q);
  const mi = new Float64Array(q * q);
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  cols.forEach((j, jj) => {
    for (let i = 0; i < m; i++) br[i] = p.a1[i * m + j];
    const y = lu.solve(br, bi);
    cols.forEach((i, ii) => {
      mr[ii * q + jj] = y.re[i];
      mi[ii * q + jj] = y.im[i];
    });
  });
  for (let k = 0; k < q * q; k++) if (!Number.isFinite(mr[k]) || !Number.isFinite(mi[k])) return undefined;
  const e = complexEigenvalues(mr, mi, q);
  let muMax = 0;
  for (let k = 0; k < q; k++) muMax = Math.max(muMax, Math.hypot(e.re[k], e.im[k]));
  const roots: Complex[] = [];
  if (muMax === 0) return roots;
  for (let k = 0; k < q; k++) {
    const mu = { re: e.re[k], im: e.im[k] };
    if (cabs(mu) <= 1e-12 * muMax) continue;
    const inv = cdiv({ re: 1, im: 0 }, mu);
    roots.push({ re: shift.re - inv.re, im: shift.im - inv.im });
  }
  return roots;
}

/** Roots present in both lists (within tolerance), averaged. */
function matchRoots(a: Complex[], b: Complex[], absTol: number, relTol: number): Complex[] {
  const used = new Uint8Array(b.length);
  const out: Complex[] = [];
  for (const r of a) {
    let best = -1;
    let bestD = Infinity;
    b.forEach((s, j) => {
      if (used[j]) return;
      const d = Math.hypot(r.re - s.re, r.im - s.im);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    if (best < 0) continue;
    const s = b[best];
    if (bestD <= relTol * Math.max(cabs(r), cabs(s)) + absTol) {
      used[best] = 1;
      out.push({ re: (r.re + s.re) / 2, im: (r.im + s.im) / 2 });
    }
  }
  return out;
}

/** Snap tiny values, symmetrise conjugate pairs and sort by magnitude. */
function cleanRoots(roots: Complex[], scale: number): Complex[] {
  const rs = roots.map((r) => {
    let { re, im } = r;
    if (Math.hypot(re, im) <= 1e-12 * scale) return { re: 0, im: 0 };
    if (Math.abs(im) <= 1e-10 * Math.hypot(re, im)) im = 0;
    if (Math.abs(re) <= 1e-12 * Math.hypot(re, im)) re = 0;
    return { re, im };
  });
  const paired = new Uint8Array(rs.length);
  for (let i = 0; i < rs.length; i++) {
    if (paired[i] || rs[i].im <= 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < rs.length; j++) {
      if (j === i || paired[j] || rs[j].im >= 0) continue;
      const d = Math.hypot(rs[i].re - rs[j].re, rs[i].im + rs[j].im);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0 && bestD <= 1e-6 * cabs(rs[i]) + 1e-12 * scale) {
      const re = (rs[i].re + rs[best].re) / 2;
      const im = (rs[i].im - rs[best].im) / 2;
      rs[i] = { re, im };
      rs[best] = { re, im: -im };
      paired[i] = 1;
      paired[best] = 1;
    }
  }
  return rs.sort((a, b) => cabs(a) - cabs(b) || a.re - b.re || b.im - a.im);
}

/** Finite roots of det(A0 + s·A1), robust to spurious roots (two shifts must agree). */
export function pencilRoots(a0: Float64Array, a1: Float64Array, m: number, scale: number): Complex[] {
  const p: Pencil = { m, a0, a1 };
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const shifts: Complex[] = [
    { re: s * Math.cos(Math.PI / 5), im: s * Math.sin(Math.PI / 5) },
    { re: 2.3 * s * Math.cos(-Math.PI / 3), im: 2.3 * s * Math.sin(-Math.PI / 3) },
    { re: 0.41 * s * Math.cos((3 * Math.PI) / 7), im: 0.41 * s * Math.sin((3 * Math.PI) / 7) },
    { re: 5.7 * s, im: 0.9 * s },
  ];
  const results: Complex[][] = [];
  for (const sh of shifts) {
    const r = rootsWithShift(p, sh);
    if (r) results.push(r);
    if (results.length === 2) break;
  }
  if (results.length < 2) throw new SimulationError('Pole-zero analysis: the MNA pencil is singular for every shift', 'singular');
  return cleanRoots(matchRoots(results[0], results[1], 1e-10 * s, 1e-4), s);
}

/** Remove pole-zero pairs that coincide; returns the number of cancelled pairs. */
function cancelPairs(poles: Complex[], zeros: Complex[], scale: number): number {
  let count = 0;
  for (let i = poles.length - 1; i >= 0; i--) {
    const p = poles[i];
    const j = zeros.findIndex((z) => Math.hypot(p.re - z.re, p.im - z.im) <= 1e-6 * Math.max(cabs(p), cabs(z)) + 1e-12 * scale);
    if (j >= 0) {
      poles.splice(i, 1);
      zeros.splice(j, 1);
      count++;
    }
  }
  return count;
}

function nodeIndexOrThrow(circuit: Circuit, name: string): number {
  const i = circuit.nodeIndex(name);
  if (i === undefined) throw new SimulationError(`${analysisTitle('pz')}: unknown node '${name}'`, 'netlist');
  return i;
}

/** Dense G and C of the small-signal pencil, with a check that the AC stamps are affine in ω. */
function extractPencil(acs: AcSystem, n: number, warnings: string[]): { g: Float64Array; c: Float64Array } {
  const g = new Float64Array(n * n);
  const c = new Float64Array(n * n);
  const fill = (omega: number, target: Float64Array, part: 're' | 'im') => {
    acs.assemble(omega);
    const pat = acs.matrix.pattern;
    const vals = acs.matrix[part];
    target.fill(0);
    for (let s = 0; s < pat.count; s++) target[pat.rowOf[s] * n + pat.colOf[s]] += vals[s];
  };
  fill(0, g, 're');
  fill(1, c, 'im');
  // affine-in-omega check at a second frequency
  const wt = 1e3;
  const gt = new Float64Array(n * n);
  const ct = new Float64Array(n * n);
  fill(wt, gt, 're');
  fill(wt, ct, 'im');
  let gmax = 0;
  let cmax = 0;
  let dg = 0;
  let dc = 0;
  for (let k = 0; k < n * n; k++) {
    gmax = Math.max(gmax, Math.abs(g[k]));
    cmax = Math.max(cmax, Math.abs(c[k]));
    dg = Math.max(dg, Math.abs(gt[k] - g[k]));
    dc = Math.max(dc, Math.abs(ct[k] - wt * c[k]));
  }
  if (dg > 1e-9 * gmax + 1e-300 || dc > 1e-9 * wt * cmax + 1e-300) {
    warnings.push(`${analysisTitle('pz')}: some small-signal stamps are not of the form G + sC (e.g. excess phase); poles and zeros are approximate`);
  }
  return { g, c };
}

/** Scale for shifts: geometric mean of |G_jj / C_jj| over dynamic diagonals (fallback: norm ratio). */
function pencilScale(g: Float64Array, c: Float64Array, n: number): number {
  let logSum = 0;
  let count = 0;
  for (let j = 0; j < n; j++) {
    const gj = Math.abs(g[j * n + j]);
    const cj = Math.abs(c[j * n + j]);
    if (gj > 0 && cj > 0) {
      logSum += Math.log(gj / cj);
      count++;
    }
  }
  if (count > 0) return Math.exp(logSum / count);
  let gn = 0;
  let cn = 0;
  for (let k = 0; k < n * n; k++) {
    gn += g[k] * g[k];
    cn += c[k] * c[k];
  }
  return cn > 0 && gn > 0 ? Math.sqrt(gn / cn) : 1;
}

/** [[A, b], [cᵀ, 0]] of size (n+1) from n×n A. */
function bordered(a: Float64Array, n: number, b: Float64Array | undefined, c: Float64Array | undefined): Float64Array {
  const m = n + 1;
  const out = new Float64Array(m * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * m + j] = a[i * n + j];
  if (b) for (let i = 0; i < n; i++) out[i * m + n] = b[i];
  if (c) for (let j = 0; j < n; j++) out[n * m + j] = c[j];
  return out;
}

function portVector(n: number, p: number, q: number): Float64Array {
  const v = new Float64Array(n);
  if (p >= 0) v[p] += 1;
  if (q >= 0) v[q] -= 1;
  return v;
}

/**
 * Gain constant K of H(s) = K·Π(s − z)/Π(s − p), from H evaluated directly at the test point
 * st: H = cᵀ x / sign (or / c_inᵀ x) with (G + st·C) x = b. Undefined if that matrix is singular.
 */
function gainConstantAt(
  st: Complex,
  g: Float64Array,
  c: Float64Array,
  n: number,
  b: Float64Array,
  cOut: Float64Array,
  cIn: Float64Array | undefined,
  sign: number,
  poles: Complex[],
  zeros: Complex[],
): Complex | undefined {
  const yr = new Float64Array(n * n);
  const yi = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) {
    yr[k] = g[k] + st.re * c[k];
    yi[k] = st.im * c[k];
  }
  let x: { re: Float64Array; im: Float64Array };
  try {
    x = new DenseComplexLU(yr, yi, n).solve(b, new Float64Array(n));
  } catch (e) {
    if (e instanceof SingularMatrixError) return undefined;
    throw e;
  }
  const dot = (v: Float64Array): Complex => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += v[i] * x.re[i];
      im += v[i] * x.im[i];
    }
    return { re, im };
  };
  let h = dot(cOut);
  if (cIn) h = cdiv(h, dot(cIn));
  else h = { re: h.re / sign, im: h.im / sign };
  let k: Complex = h;
  for (const p of poles) k = cmul(k, { re: st.re - p.re, im: st.im - p.im });
  for (const z of zeros) k = cdiv(k, { re: st.re - z.re, im: st.im - z.im });
  return k;
}

export function runPz(spec: PzAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('pz');
  const circuit = ctx.buildCircuit();
  const tl = circuit.devices.find((d) => d.type === 'T' || d.type === 'O');
  if (tl) throw new SimulationError(`${what}: transmission line ${tl.name} is not supported (its delay is not rational in s)`, 'unsupported');
  const n = circuit.size;
  if (n > MAX_UNKNOWNS) throw new SimulationError(`${what}: circuit too large (${n} unknowns, limit ${MAX_UNKNOWNS})`, 'unsupported');
  const sys = computeOperatingPoint(circuit, ctx.signal);
  const acs = new AcSystem(circuit, sys.x, sys.states[0]);
  const warnings = [...circuit.warnings];
  for (const name of acs.missingAcModels) warnings.push(`${name}: no small-signal model, ignored in ${what.toLowerCase()}`);
  const { g, c } = extractPencil(acs, n, warnings);

  const inP = nodeIndexOrThrow(circuit, spec.inPos);
  const inN = nodeIndexOrThrow(circuit, spec.inNeg);
  const outP = nodeIndexOrThrow(circuit, spec.outPos);
  const outN = nodeIndexOrThrow(circuit, spec.outNeg);
  if (inP === inN) throw new SimulationError(`${what}: input nodes are the same`, 'netlist');
  if (outP === outN) throw new SimulationError(`${what}: output nodes are the same`, 'netlist');
  const cOut = portVector(n, outP, outN);
  const cIn = portVector(n, inP, inN);

  // independent voltage source directly across the input port
  let vin: { branch: number; sign: number; name: string } | undefined;
  for (const d of circuit.devices) {
    if (d.type !== 'V') continue;
    const [p, q] = deviceNodes(circuit, d);
    const br = d.branchIndex ? d.branchIndex() : -1;
    if (br < 0) continue;
    if (p === inP && q === inN) vin = { branch: br, sign: 1, name: d.name };
    else if (p === inN && q === inP) vin = { branch: br, sign: -1, name: d.name };
    if (vin) break;
  }

  const gy = g.slice();
  let b: Float64Array;
  let denomC: Float64Array | undefined; // undefined: poles = roots of det Y
  let gainDiv: 'sign' | 'cin' | 'none' = 'none';
  if (spec.transfer === 'vol') {
    if (vin) {
      b = new Float64Array(n);
      b[vin.branch] = 1;
      gainDiv = 'sign';
    } else {
      b = portVector(n, inP, inN);
      denomC = cIn;
      gainDiv = 'cin';
    }
  } else {
    b = portVector(n, inP, inN);
    if (vin) {
      // open the source: its branch equation becomes i = 0
      for (let j = 0; j < n; j++) gy[vin.branch * n + j] = 0;
      gy[vin.branch * n + vin.branch] = 1;
      warnings.push(`${what}: voltage source ${vin.name} across the input port is removed for the current-driven transfer function`);
    }
  }

  const scale = pencilScale(gy, c, n);
  ctx.checkAbort();
  const c1 = bordered(c, n, undefined, undefined);
  let zeros: Complex[];
  let zeroTransfer = false;
  try {
    zeros = pencilRoots(bordered(gy, n, b, cOut), c1, n + 1, scale);
  } catch (e) {
    if (!(e instanceof SimulationError) || e.code !== 'singular') throw e;
    // det [[Y, b], [cᵀ, 0]] ≡ 0: the output does not depend on the input
    zeros = [];
    zeroTransfer = true;
    warnings.push(`${what}: the transfer function is identically zero (the output does not depend on the input)`);
  }
  ctx.progress(0.5);
  ctx.checkAbort();
  const poles = denomC ? pencilRoots(bordered(gy, n, b, denomC), c1, n + 1, scale) : pencilRoots(gy, c, n, scale);
  const cancelled = cancelPairs(poles, zeros, scale);
  if (cancelled > 0) warnings.push(`${what}: ${cancelled} coinciding pole-zero pair(s) cancelled (uncontrollable or unobservable modes)`);

  let gainConstant = 0;
  if (!zeroTransfer) {
    const k = gainConstantAt({ re: 0.7 * scale, im: 0.9 * scale }, gy, c, n, b, cOut, gainDiv === 'cin' ? cIn : undefined, gainDiv === 'sign' && vin ? vin.sign : 1, poles, zeros);
    gainConstant = k ? k.re : Number.NaN;
    if (k && Math.abs(k.im) > 1e-6 * cabs(k)) warnings.push(`${what}: gain constant has an imaginary part (${k.im.toPrecision(4)})`);
  }

  const wantPoles = spec.find === 'pol' || spec.find === 'pz';
  const wantZeros = spec.find === 'zer' || spec.find === 'pz';
  const rows: (string | number)[][] = [];
  const row = (type: string, r: Complex) => {
    const mag = cabs(r);
    rows.push([type, r.re, r.im, mag / (2 * Math.PI), mag > 0 ? -r.re / mag : Number.NaN]);
  };
  if (wantPoles) poles.forEach((p) => row('pole', p));
  if (wantZeros) zeros.forEach((z) => row('zero', z));
  const vec = (name: string, list: Complex[]): Vector => ({
    name,
    unit: '',
    re: Float64Array.from(list.map((r) => r.re)),
    im: Float64Array.from(list.map((r) => r.im)),
  });
  const vectors: Vector[] = [];
  if (wantPoles) vectors.push(vec('pole', poles));
  if (wantZeros) vectors.push(vec('zero', zeros));
  const scalars: Record<string, number> = { gain_constant: gainConstant };
  if (wantPoles) scalars.poles = poles.length;
  if (wantZeros) scalars.zeros = zeros.length;
  return {
    type: 'pz',
    title: what,
    spec,
    vectors,
    scalars,
    table: { columns: ['Type', 'Real (1/s)', 'Imaginary (rad/s)', 'Magnitude (Hz)', 'Damping ratio'], rows },
    warnings,
  };
}
