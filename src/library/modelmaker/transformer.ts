/**
 * Power transformer model maker (`.subckt <name> P1 P2 S1 S2`) from nameplate values: rated primary
 * and full-load secondary voltage, rated power S, frequency, no-load current i0 (% of rated primary
 * current), short-circuit voltage uk (%), copper loss Pk and core loss P0.
 *
 * Equivalent circuit (referred to the primary, T-network):
 *   Rk = Pk/I1n²  split R1 = R2' = Rk/2;   Xk = √((uk·V1/I1n)² − Rk²)  split X1 = X2' = Xk/2;
 *   Lm = V1/(ω·I0) (∥ Rc = V1²/P0);   ideal transformer n:1 by a VCVS and a CCCS
 *   (E: Vsec = Vprim/n,  F: Iprim = Isec/n), so the model also works in transient and at DC (where
 *   Lm shorts the primary, like a real transformer).
 * The turns ratio n is solved with the phasor circuit so that the secondary gives V2 at the rated
 * resistive load V2²/S. Benches (AC at the rated frequency): full-load V2, no-load current, the
 * short-circuit test (uk and Pk).
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote, type MakerValues } from './types';
import { R, V, bench, bisect, header, last, need, num, opt, vec, vecIm } from './common';

type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const par = (a: C, b: C): C => div(mul(a, b), add(a, b));
const abs = (a: C) => Math.hypot(a[0], a[1]);

function equivalent(values: MakerValues) {
  const v1 = need(values, 'v1');
  const v2 = need(values, 'v2');
  const s = need(values, 's');
  const f = need(values, 'f');
  const i0 = need(values, 'i0') / 100;
  const uk = need(values, 'uk') / 100;
  const w = 2 * Math.PI * f;
  const i1n = s / v1;
  const pk = opt(values, 'pk') ?? 0.5 * uk * s;
  const rk = pk / (i1n * i1n);
  const zk = (uk * v1) / i1n;
  const notes: MakerNote[] = [];
  if (opt(values, 'pk') === undefined) notes.push({ id: 'pkTypical', params: { w: num(pk) }, level: 'info' });
  let xk = zk * zk - rk * rk;
  if (xk <= 0) {
    notes.push({ id: 'ukTooLow', level: 'warn' });
    xk = (0.05 * zk) ** 2;
  }
  const x = Math.sqrt(xk);
  const p0 = opt(values, 'p0');
  // the no-load current has a magnetising part (Lm) and a core-loss part (Rc) in quadrature
  const ic = p0 !== undefined ? p0 / v1 : 0;
  const imag2 = (i0 * i1n) ** 2 - ic * ic;
  if (!(imag2 > 0)) throw new MakerInputError('coreLossHigh');
  const lm = v1 / (w * Math.sqrt(imag2));
  const rc = p0 !== undefined ? (v1 * v1) / p0 : undefined;
  return { v1, v2, s, f, w, i1n, i0, uk, pk, r1: rk / 2, r2p: rk / 2, x1: x / 2, x2p: x / 2, lm, rc, notes };
}

export const transformerMaker: MakerDef = {
  id: 'transformer',
  terminals: ['P1', 'P2', 'S1', 'S2'],
  template: 'transformer',
  prefix: 'T',
  group: 'basic',
  family: 'Transformer',
  fields: [
    { key: 'v1', unit: 'V', default: '230', section: 'basic' },
    { key: 'v2', unit: 'V', default: '12', section: 'basic' },
    { key: 's', unit: 'VA', default: '24', section: 'basic' },
    { key: 'f', unit: 'Hz', default: '50', section: 'basic' },
    { key: 'i0', unit: '%', default: '8', section: 'advanced' },
    { key: 'uk', unit: '%', default: '10', section: 'advanced' },
    { key: 'pk', unit: 'W', default: '1.5', optional: true, section: 'advanced' },
    { key: 'p0', unit: 'W', default: '', optional: true, section: 'advanced' },
  ],
  fit(values, name) {
    const e = equivalent(values);
    if (e.uk >= 1 || e.i0 >= 1) throw new MakerInputError('percentRange');
    const zl = (e.v2 * e.v2) / e.s;
    const z1: C = [e.r1, e.x1];
    const zm: C = e.rc !== undefined ? par([0, e.w * e.lm], [e.rc, 0]) : [0, e.w * e.lm];
    const v2At = (n: number) => {
      const zload: C = [e.r2p + n * n * zl, e.x2p];
      const zp = par(zm, zload);
      const vm = div(mul([e.v1, 0], zp), add(z1, zp));
      const v2p = mul(vm, div([n * n * zl, 0], zload));
      return abs(v2p) / n;
    };
    const n0 = e.v1 / e.v2;
    const n = bisect((x) => v2At(x) - e.v2, n0 * 0.3, n0 * 1.0, { iter: 200 });
    if (n === undefined) throw new MakerInputError('transformerFit');
    const r2 = e.r2p / (n * n);
    const l2 = e.x2p / e.w / (n * n);
    const l1 = e.x1 / e.w;
    const lines = [
      header('transformer', transformerMaker.fields, values),
      `.subckt ${name} P1 P2 S1 S2`,
      `R1 P1 1 ${num(e.r1)}`,
      `L1 1 2 ${num(l1)}`,
      `LM 2 P2 ${num(e.lm)}`,
      ...(e.rc !== undefined ? [`RC 2 P2 ${num(e.rc)}`] : []),
      `E2 3 S2 2 P2 ${num(1 / n)}`,
      `VSN 3 4 DC 0`,
      `F1 2 P2 VSN ${num(1 / n)}`,
      `R2 4 5 ${num(r2)}`,
      `L2 5 S1 ${num(l2)}`,
      `.ends ${name}`,
      '',
    ];
    return { model: { kind: 'spice', text: lines.join('\n'), name }, fitted: { n, r1: e.r1, l1, lm: e.lm, r2, l2, ...(e.rc !== undefined ? { rc: e.rc } : {}) }, notes: e.notes };
  },
  checks(values, result) {
    const e = equivalent(values);
    const zl = (e.v2 * e.v2) / e.s;
    const nodes = ['p', '0', 's', '0'];
    const ac = [{ type: 'acsingle' as const, freq: e.f }];
    const mag = (r: Parameters<MakerCheck['measure']>[0], name: string) => Math.hypot(last(vec(r, 0, name)), last(vecIm(r, 0, name)));
    const out: MakerCheck[] = [
      { id: 'v2load', params: {}, target: e.v2, unit: 'V', tol: 0.01, netlist: bench(result, nodes, [V('V1', 'p', '0', { dc: 0, acMag: e.v1 }), R('RL', 's', '0', zl)], ac), measure: (r) => mag(r, 'V(s)') },
      { id: 'i0', params: {}, target: e.i0 * e.i1n, unit: 'A', tol: 0.03, netlist: bench(result, nodes, [V('V1', 'p', '0', { dc: 0, acMag: e.v1 }), R('RL', 's', '0', 1e9)], ac), measure: (r) => mag(r, 'I(V1)') },
    ];
    const short = bench(result, nodes, [V('V1', 'p', '0', { dc: 0, acMag: e.uk * e.v1 }), R('RL', 's', '0', 1e-6)], ac);
    out.push({ id: 'uk', params: {}, target: e.uk * 100, unit: '%', tol: 0.03, netlist: short, measure: (r) => (100 * e.uk * e.i1n) / mag(r, 'I(V1)') });
    if (opt(values, 'pk') !== undefined) {
      out.push({
        id: 'pk',
        params: {},
        target: e.pk,
        unit: 'W',
        tol: 0.05,
        netlist: short,
        measure: (r) => {
          // real power at the short-circuit test, scaled to the rated current
          const ir = last(vec(r, 0, 'I(V1)'));
          const ii = last(vecIm(r, 0, 'I(V1)'));
          const i = Math.hypot(ir, ii);
          const p = Math.abs(e.uk * e.v1 * ir);
          return (p * (e.i1n / i) ** 2);
        },
      });
    }
    return out;
  },
};
