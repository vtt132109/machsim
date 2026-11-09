/**
 * RF transmission-line model maker (`.subckt <name> P1 N1 P2 N2`): a line of characteristic
 * impedance Z0 and physical length, given directly (Z0 and effective permittivity εeff, e.g. 2.25
 * for PE coax) or from microstrip geometry (strip width w, substrate height h, εr: Hammerstad-Jensen
 * closed forms, src/library/catalog/rf.ts). Delay td = length·√εeff / c.
 * Loss (dB per metre at the reference frequency) is modelled by N = 10 lossless sections with a
 * series resistance r split around each section, r chosen from the cascaded ABCD matrices so that
 * the matched line loses exactly loss·len at the reference frequency.
 * Benches (AC at the reference frequency, or lower so the phase stays within 90°): input impedance
 * with a matched load, delay from the phase of V2/V1, attenuation of the matched line.
 */
import { microstrip } from '../catalog/rf';
import { MakerInputError, type MakerCheck, type MakerDef, type MakerValues } from './types';
import { I, R, bench, bisect, choice, header, last, need, num, opt, vec, vecIm, sig } from './common';

const C0 = 299792458;
const SECTIONS = 10;

function lineOf(values: MakerValues): { z0: number; eeff: number; td: number; len: number; alpha: number } {
  const mode = choice(values, 'mode', 'z0');
  let z0: number;
  let eeff: number;
  if (mode === 'microstrip') {
    const m = microstrip(need(values, 'w'), need(values, 'h'), need(values, 'er'));
    z0 = m.z0;
    eeff = m.eeff;
  } else {
    z0 = need(values, 'z0');
    eeff = opt(values, 'eeff') ?? 1;
  }
  if (!(eeff >= 1)) throw new MakerInputError('eeffBelowOne');
  const len = need(values, 'len');
  const alpha = (opt(values, 'loss') ?? 0) / (20 / Math.LN10);
  return { z0, eeff, td: (len * Math.sqrt(eeff)) / C0, len, alpha };
}

type Cx = [number, number];
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cadd = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]];
type Abcd = [Cx, Cx, Cx, Cx];
const abcdMul = (x: Abcd, y: Abcd): Abcd => [cadd(cmul(x[0], y[0]), cmul(x[1], y[2])), cadd(cmul(x[0], y[1]), cmul(x[1], y[3])), cadd(cmul(x[2], y[0]), cmul(x[3], y[2])), cadd(cmul(x[2], y[1]), cmul(x[3], y[3]))];

/** |V2/V1| in nepers of the R/2–line–R/2 ladder (N sections) terminated in z0 at frequency f. */
function ladderLoss(z0: number, td: number, f: number, r: number): number {
  const th = 2 * Math.PI * f * (td / SECTIONS);
  const series: Abcd = [[1, 0], [r / 2, 0], [0, 0], [1, 0]];
  const line: Abcd = [[Math.cos(th), 0], [0, z0 * Math.sin(th)], [0, Math.sin(th) / z0], [Math.cos(th), 0]];
  const cell = abcdMul(abcdMul(series, line), series);
  let m: Abcd = [[1, 0], [0, 0], [0, 0], [1, 0]];
  for (let k = 0; k < SECTIONS; k++) m = abcdMul(m, cell);
  // V1 = A·V2 + B·I2 with I2 = V2/z0
  const d = cadd(m[0], [m[1][0] / z0, m[1][1] / z0]);
  return Math.log(Math.hypot(d[0], d[1]));
}

/** Section resistance giving `nepers` of loss at f (the loss grows monotonically with r). */
function sectionResistance(z0: number, td: number, f: number, nepers: number): number {
  return bisect((r) => ladderLoss(z0, td, f, r) - nepers, 0, 50 * z0, { iter: 200 }) ?? (2 * z0 * nepers) / SECTIONS;
}

export const tlineMaker: MakerDef = {
  id: 'tline',
  terminals: ['P1', 'N1', 'P2', 'N2'],
  template: 'tline',
  prefix: 'T',
  group: 'rf',
  family: 'Transmission line',
  fields: [
    { key: 'mode', unit: '', default: 'z0', kind: 'select', options: ['z0', 'microstrip'], section: 'basic' },
    { key: 'z0', unit: 'Ω', default: '50', optional: true, section: 'basic' },
    { key: 'eeff', unit: '', default: '2.25', optional: true, section: 'basic' },
    { key: 'w', unit: 'm', default: '3m', optional: true, section: 'basic' },
    { key: 'h', unit: 'm', default: '1.6m', optional: true, section: 'basic' },
    { key: 'er', unit: '', default: '4.4', optional: true, section: 'basic' },
    { key: 'len', unit: 'm', default: '0.5', section: 'basic' },
    { key: 'loss', unit: 'dB/m', default: '0.2', optional: true, positive: false, section: 'advanced' },
    { key: 'f', unit: 'Hz', default: '100M', section: 'advanced' },
  ],
  fit(values, name) {
    const l = lineOf(values);
    const lines = [header('tline', tlineMaker.fields, values), `.subckt ${name} P1 N1 P2 N2`];
    if (l.alpha > 0) {
      // section resistance so that the matched line loses exactly loss·len dB at the reference
      // frequency (cascade of ABCD matrices: R/2 – lossless section – R/2)
      const f = need(values, 'f');
      const r = sectionResistance(l.z0, l.td, f, l.alpha * l.len);
      let a = 'P1';
      let ref = 'N1';
      for (let k = 1; k <= SECTIONS; k++) {
        const outRef = k === SECTIONS ? 'N2' : `r${k}`;
        const outNode = k === SECTIONS ? 'P2' : `x${k}`;
        lines.push(`RA${k} ${a} a${k} ${num(r / 2)}`, `T${k} a${k} ${ref} b${k} ${outRef} Z0=${num(l.z0)} TD=${num(l.td / SECTIONS)}`, `RB${k} b${k} ${outNode} ${num(r / 2)}`);
        // the inner reference nodes need a DC path (a line port only fixes voltage differences)
        if (k < SECTIONS) lines.push(`RR${k} ${outRef} N1 ${num(1e9)}`);
        a = outNode;
        ref = outRef;
      }
    } else {
      lines.push(`T1 P1 N1 P2 N2 Z0=${num(l.z0)} TD=${num(l.td)}`);
    }
    lines.push(`.ends ${name}`, '');
    return { model: { kind: 'spice', text: lines.join('\n'), name }, fitted: { z0: l.z0, eeff: l.eeff, td: l.td, ...(l.alpha > 0 ? { alpha: l.alpha } : {}) }, notes: [] };
  },
  checks(values, result) {
    const l = lineOf(values);
    const fRef = need(values, 'f');
    // keep the phase within a quarter turn so the delay reads without wrapping
    const f = Math.min(fRef, 0.2 / l.td);
    const nodes = ['p1', '0', 'p2', '0'];
    const matched = bench(result, nodes, [I('IS', '0', 'p1', { dc: 0, acMag: 1 }), R('RL', 'p2', '0', l.z0)], [{ type: 'acsingle', freq: f }]);
    const c = (r: Parameters<MakerCheck['measure']>[0], n: string): [number, number] => [last(vec(r, 0, n)), last(vecIm(r, 0, n))];
    const out: MakerCheck[] = [
      { id: 'zin', params: { f: sig(f) }, target: l.z0, unit: 'Ω', tol: 0.02, netlist: matched, measure: (r) => Math.hypot(...c(r, 'V(p1)')) },
      {
        id: 'delay',
        params: { f: sig(f) },
        target: l.td,
        unit: 's',
        tol: 0.02,
        netlist: matched,
        measure: (r) => {
          const [ar, ai] = c(r, 'V(p1)');
          const [br, bi] = c(r, 'V(p2)');
          const ph = Math.atan2(bi, br) - Math.atan2(ai, ar);
          const wrapped = ph > 0 ? ph - 2 * Math.PI : ph;
          return -wrapped / (2 * Math.PI * f);
        },
      },
    ];
    if (l.alpha > 0) {
      out.push({
        id: 'loss',
        params: { f: sig(fRef) },
        target: -(opt(values, 'loss') ?? 0) * l.len,
        unit: 'dB',
        tol: 0.03,
        absTol: 0.005,
        netlist: bench(result, nodes, [I('IS', '0', 'p1', { dc: 0, acMag: 1 }), R('RL', 'p2', '0', l.z0)], [{ type: 'acsingle', freq: fRef }]),
        measure: (r) => 20 * Math.log10(Math.hypot(...c(r, 'V(p2)')) / Math.hypot(...c(r, 'V(p1)'))),
      });
    }
    return out;
  },
};
