/**
 * Sensitivity analysis ('sens'): derivatives of one output with respect to every element value,
 * instance parameter and model parameter, at the DC operating point and optionally over an AC
 * sweep.
 *
 * DC method (adjoint, as SPICE3): at the operating point x0 the residual F(x, p) = 0 (KCL and
 * branch equations, see util.residualAt). For a parameter p,
 *     dx0/dp = −J⁻¹ ∂F/∂p,   dy/dp = ∂y/∂p − zᵀ ∂F/∂p,   with Jᵀ z = c (one adjoint solve),
 * where J is the Newton Jacobian at x0 and c the output functional. ∂F/∂p is obtained by central
 * differences of the residual evaluated at the fixed solution x0 with the parameter perturbed by
 * ±1e-5 relative (±1e-6 absolute for zero-valued sources): one device load per evaluation instead
 * of a full Newton solve, and exact up to O(δ²) for any device model. ∂y/∂p is non-zero only for
 * derived device outputs such as I(R1).
 *
 * AC method (spec.ac): with y(ω) = cᵀ x(ω), Y(ω) x = b,
 *     dy/dp = −z(ω)ᵀ · d[Y(ω; x0(p), p) x − b]/dp,   Y(ω)ᵀ z(ω) = c,
 * the total derivative including the shift of the operating point: the AC matrix is re-assembled
 * with the devices linearised at x0 ± δ·dx0/dp and the parameter at p ± δ. Only voltage and
 * branch-current outputs are allowed for AC sensitivities.
 *
 * Parameters analysed: the primary value of R, C, L, K, E, F, G, H; the DC value of V and I
 * sources (also when zero); every non-zero numeric instance parameter of the netlist element
 * (except flags, initial conditions and temperatures); every non-zero numeric parameter of each
 * model card that the devices using it accept through getParam/setParam (perturbed on all of them
 * together: the sensitivity to the shared model value). Model parameters left at their defaults
 * (not on the card) are not analysed.
 *
 * Result: table ['Kind', 'Element', 'Parameter', 'Value', 'Sensitivity', 'Normalized (per %)']
 * where Normalized = dy/dp · p / 100 (output change per percent change of p, as SPICE); scalars
 * "ELEMENT:param" (e.g. "R1:value", "V1:dc", "QMOD:bf") = dy/dp, plus "output" = y at the OP.
 * With spec.ac: scale "frequency", the complex output vector, and one complex vector per
 * parameter (named like the scalars) holding dy/dp over frequency.
 */
import type { SensAnalysis } from '../netlist';
import { SimulationError, type AnalysisResult, type Vector, type VectorUnit } from '../results';
import { AcSystem, sweepFrequencies } from '../engine/ac';
import type { AnalysisContext } from '../engine/analysis-registry';
import type { Circuit } from '../engine/circuit';
import { computeOperatingPoint } from '../engine/analyses';
import type { EngineDevice } from '../engine/hooks';
import { analysisTitle } from '../engine/titles';
import { findModel } from './modify';
import { outputVector, parseOutput, residualAt, setDcMode } from './util';

/** One parameter analysed by the sensitivity analysis. */
export interface SensParameter {
  kind: 'element' | 'model';
  /** Element or model name. */
  owner: string;
  /** Parameter key passed to setParam ("value", "dc", "area", "bf", ...). */
  param: string;
  /** Result key: "R1:value", "QMOD:bf". */
  label: string;
  nominal: number;
  devices: EngineDevice[];
}

const VALUE_TYPES = new Set(['R', 'C', 'L', 'K', 'E', 'F', 'G', 'H']);
const SKIP_PARAM = /^(off|on|state|ic|ic_.*|icv.*|temp|dtemp|level|tnom)$/;

function finiteNonZero(v: number | undefined): v is number {
  return v !== undefined && Number.isFinite(v) && v !== 0;
}

/** Parameters of a circuit that the sensitivity analysis perturbs (see module doc). */
export function sensitivityParameters(circuit: Circuit): SensParameter[] {
  const out: SensParameter[] = [];
  const elements = circuit.netlist.elements;
  const elementNames = new Set(circuit.devices.map((d) => d.name.toLowerCase()));
  circuit.devices.forEach((d, k) => {
    const el = elements[k];
    if (!d.setParam || !d.getParam || !el) return;
    const seen = new Set<string>();
    const add = (param: string, nominal: number) => {
      seen.add(param);
      out.push({ kind: 'element', owner: d.name, param, label: `${d.name}:${param}`, nominal, devices: [d] });
    };
    if (d.type === 'V' || d.type === 'I') {
      const v = d.getParam('dc');
      if (v !== undefined && Number.isFinite(v)) add('dc', v);
      seen.add('value');
    } else if (VALUE_TYPES.has(d.type)) {
      const v = d.getParam('value');
      if (finiteNonZero(v)) add('value', v);
    }
    for (const raw of Object.keys(el.params)) {
      const key = raw.toLowerCase();
      if (seen.has(key) || SKIP_PARAM.test(key) || key === 'value') continue;
      const v = d.getParam(key);
      if (finiteNonZero(v)) add(key, v);
    }
  });

  const users = new Map<string, EngineDevice[]>();
  circuit.devices.forEach((d, k) => {
    const m = elements[k]?.model;
    if (!m || !d.setParam || !d.getParam) return;
    const key = m.trim().toLowerCase();
    const list = users.get(key);
    if (list) list.push(d);
    else users.set(key, [d]);
  });
  for (const [key, devs] of users) {
    const card = findModel(circuit.netlist, key);
    if (!card) continue;
    const owner = card.name;
    const prefix = elementNames.has(owner.toLowerCase()) ? `model ${owner}` : owner;
    for (const [rawKey, value] of Object.entries(card.params)) {
      const pk = rawKey.toLowerCase();
      if (SKIP_PARAM.test(pk) || !finiteNonZero(value)) continue;
      const vals = devs.map((d) => d.getParam?.(pk));
      if (!vals.every((v) => v !== undefined && Number.isFinite(v))) continue;
      const nominal = vals[0] as number;
      if (nominal === 0) continue;
      out.push({ kind: 'model', owner, param: pk, label: `${prefix}:${pk}`, nominal, devices: devs });
    }
  }
  return out;
}

function setAll(p: SensParameter, value: number): void {
  for (const d of p.devices) d.setParam?.(p.param, value);
}

function stepOf(p: SensParameter): number {
  return p.nominal !== 0 ? Math.abs(p.nominal) * 1e-5 : 1e-6;
}

export function runSens(spec: SensAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('sens');
  const circuit = ctx.buildCircuit();
  const sys = computeOperatingPoint(circuit, ctx.signal);
  const x0 = sys.x.slice();
  const n = circuit.size;
  const output = parseOutput(circuit, spec.output, { allowDevice: true, x0, what });
  const warnings = [...circuit.warnings];

  setDcMode(sys);
  const work = new Float64Array(n);
  residualAt(sys, x0, work);
  sys.factor();
  const z = sys.lu.solveTranspose(outputVector(output, n));
  const y0 = output.value(x0);
  const params = sensitivityParameters(circuit);
  const rp = new Float64Array(n);
  const rm = new Float64Array(n);
  const dF: Float64Array[] = [];
  const sens = new Float64Array(params.length);
  params.forEach((p, j) => {
    ctx.checkAbort();
    const h = stepOf(p);
    setAll(p, p.nominal + h);
    residualAt(sys, x0, rp);
    const yp = output.kind === 'device' ? output.value(x0) : 0;
    setAll(p, p.nominal - h);
    residualAt(sys, x0, rm);
    const ym = output.kind === 'device' ? output.value(x0) : 0;
    setAll(p, p.nominal);
    const d = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      d[i] = (rp[i] - rm[i]) / (2 * h);
      s -= z[i] * d[i];
    }
    if (output.kind === 'device') s += (yp - ym) / (2 * h);
    dF.push(d);
    sens[j] = s;
    if ((j & 7) === 7) ctx.progress((0.5 * (j + 1)) / Math.max(1, params.length));
  });
  residualAt(sys, x0, work);

  const scalars: Record<string, number> = { output: y0 };
  const rows: (string | number)[][] = [];
  params.forEach((p, j) => {
    scalars[p.label] = sens[j];
    rows.push([p.kind, p.owner, p.param, p.nominal, sens[j], (sens[j] * p.nominal) / 100]);
  });

  const result: AnalysisResult = {
    type: 'sens',
    title: what,
    spec,
    vectors: [],
    scalars,
    table: { columns: ['Kind', 'Element', 'Parameter', 'Value', 'Sensitivity', 'Normalized (per %)'], rows },
    warnings,
  };
  if (params.length === 0) warnings.push(`${what}: the circuit has no parameters to analyse`);

  if (spec.ac) {
    if (output.kind === 'device') {
      warnings.push(`${what}: AC sensitivities need a node voltage or a branch current output; ${output.name} skipped`);
    } else {
      acSensitivity(spec, ctx, circuit, sys, x0, output.name, output.unit, outputVector(output, n), params, dF, result);
    }
  }
  return result;
}

function acSensitivity(
  spec: SensAnalysis,
  ctx: AnalysisContext,
  circuit: Circuit,
  sys: ReturnType<typeof computeOperatingPoint>,
  x0: Float64Array,
  outputName: string,
  outputUnit: VectorUnit,
  c: Float64Array,
  params: SensParameter[],
  dF: Float64Array[],
  result: AnalysisResult,
): void {
  const ac = spec.ac;
  if (!ac) return;
  const n = circuit.size;
  const freqs = sweepFrequencies(ac.sweep, ac.points, ac.fstart, ac.fstop);
  const nf = freqs.length;
  const work = new Float64Array(n);
  residualAt(sys, x0, work);
  const acs = new AcSystem(circuit, x0, sys.states[0]);
  for (const name of acs.missingAcModels) result.warnings.push(`${name}: no small-signal model, ignored in AC sensitivity`);
  const cIm = new Float64Array(n);
  const xs: { re: Float64Array; im: Float64Array }[] = [];
  const zs: { re: Float64Array; im: Float64Array }[] = [];
  const yRe = new Float64Array(nf);
  const yIm = new Float64Array(nf);
  freqs.forEach((f, k) => {
    acs.assemble(2 * Math.PI * f);
    acs.factor();
    const sol = acs.solve();
    const x = { re: sol.re.slice(), im: sol.im.slice() };
    const zz = acs.solveTranspose(c, cIm);
    zs.push({ re: zz.re.slice(), im: zz.im.slice() });
    xs.push(x);
    let r = 0;
    let i = 0;
    for (let q = 0; q < n; q++) {
      r += c[q] * x.re[q];
      i += c[q] * x.im[q];
    }
    yRe[k] = r;
    yIm[k] = i;
  });

  const vectors: Vector[] = [{ name: outputName, unit: outputUnit, re: yRe, im: yIm }];
  const tr = new Float64Array(n);
  const ti = new Float64Array(n);
  const xp = new Float64Array(n);
  params.forEach((p, j) => {
    ctx.checkAbort();
    const h = stepOf(p);
    const dx = sys.lu.solve(dF[j]);
    const res: { re: Float64Array; im: Float64Array }[][] = [[], []];
    [1, -1].forEach((sign, si) => {
      setAll(p, p.nominal + sign * h);
      for (let i = 0; i < n; i++) xp[i] = x0[i] - sign * h * dx[i];
      residualAt(sys, xp, work);
      const pert = new AcSystem(circuit, xp, sys.states[0]);
      freqs.forEach((f, k) => {
        pert.assemble(2 * Math.PI * f);
        pert.matrix.multiply(xs[k].re, xs[k].im, tr, ti);
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          re[i] = tr[i] - pert.rhsRe[i];
          im[i] = ti[i] - pert.rhsIm[i];
        }
        res[si].push({ re, im });
      });
    });
    setAll(p, p.nominal);
    const sRe = new Float64Array(nf);
    const sIm = new Float64Array(nf);
    for (let k = 0; k < nf; k++) {
      const a = res[0][k];
      const b = res[1][k];
      const z = zs[k];
      let sr = 0;
      let sim = 0;
      for (let i = 0; i < n; i++) {
        const dr = (a.re[i] - b.re[i]) / (2 * h);
        const di = (a.im[i] - b.im[i]) / (2 * h);
        sr -= z.re[i] * dr - z.im[i] * di;
        sim -= z.re[i] * di + z.im[i] * dr;
      }
      sRe[k] = sr;
      sIm[k] = sim;
    }
    vectors.push({ name: p.label, unit: '', re: sRe, im: sIm });
    ctx.progress(0.5 + (0.5 * (j + 1)) / Math.max(1, params.length));
  });
  residualAt(sys, x0, work);
  if (!Number.isFinite(yRe[0])) throw new SimulationError(`${analysisTitle('sens')}: AC solution is not finite`, 'singular');
  result.scale = { name: 'frequency', unit: 'Hz', re: Float64Array.from(freqs) };
  result.vectors = vectors;
}
