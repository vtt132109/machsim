/**
 * JFET model maker (`.model <name> NJF|PJF`, Shichman-Hodges with B = 1) from datasheet values.
 *
 * Saturation (device polarity): ID = BETA·(1 + λ·VDS)·(VGS' − VTO)², VGS' = VGS − ID·RS.
 *   IDSS at VGS = 0 and the cut-off VGS(off) (where ID falls to the datasheet's test current, e.g.
 *   1 nA) give BETA and VTO; a datasheet gfs (at VGS = 0) below the square-law value 2·IDSS/|VTO|
 *   is matched with source / drain resistance RS = RD (gfs = gm/(1 + gm·RS)).
 *   CGS = Ciss − Crss (VGS = 0), CGD = Crss·(1 + VDS/PB)^M (M = 0.5, PB = 1) at the test VDS.
 * Benches: IDSS (VGS = 0), VGS(off) from a VGS sweep, gfs as the slope at VGS = 0, Ciss / Crss from
 * AC currents at 1 MHz.
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote } from './types';
import { V, bench, bisect, choice, crossing, header, last, modelCard, need, num, opt, scale, vec, vecIm, sig } from './common';

const PB = 1;
const M = 0.5;

interface Jf {
  beta: number;
  vto: number;
  lambda: number;
  rs: number;
}

/** Saturation drain current at terminal VGS (RS feedback solved in closed form). */
function idSat(p: Jf, vgs: number, vds: number): number {
  // ID = k·(vgs − ID·RS − VTO)²,  k = BETA(1 + λ VDS)
  const k = p.beta * (1 + p.lambda * vds);
  const u = vgs - p.vto;
  if (u <= 0) return 0;
  if (p.rs === 0) return k * u * u;
  // k·RS²·ID² − (2k·RS·u + 1)·ID + k·u² = 0, smaller root
  const a = k * p.rs * p.rs;
  const b = -(2 * k * p.rs * u + 1);
  const c = k * u * u;
  return (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export const jfetMaker: MakerDef = {
  id: 'jfet',
  terminals: ['D', 'G', 'S'],
  template: 'njfet',
  prefix: 'J',
  group: 'transistors',
  family: 'N-channel JFET',
  fields: [
    { key: 'type', unit: '', default: 'njf', kind: 'select', options: ['njf', 'pjf'], section: 'basic' },
    { key: 'idss', unit: 'A', default: '6m', section: 'basic' },
    { key: 'vds', unit: 'V', default: '15', section: 'basic' },
    { key: 'vgsoff', unit: 'V', default: '2.5', section: 'basic' },
    { key: 'idoff', unit: 'A', default: '1n', section: 'advanced' },
    { key: 'gfs', unit: 'S', default: '4m', optional: true, section: 'basic' },
    { key: 'ciss', unit: 'F', default: '5p', optional: true, section: 'advanced' },
    { key: 'crss', unit: 'F', default: '2p', optional: true, section: 'advanced' },
    { key: 'vdsc', unit: 'V', default: '15', optional: true, section: 'advanced' },
    { key: 'lambda', unit: '1/V', default: '0.005', optional: true, positive: false, section: 'advanced' },
  ],
  variant: (values) => (choice(values, 'type', 'njf') === 'pjf' ? { template: 'pjfet', family: 'P-channel JFET' } : { template: 'njfet', family: 'N-channel JFET' }),
  fit(values, name) {
    const pch = choice(values, 'type', 'njf') === 'pjf';
    const idss = need(values, 'idss');
    const vds = need(values, 'vds');
    const voff = need(values, 'vgsoff');
    const idoff = need(values, 'idoff');
    if (idoff >= idss / 10) throw new MakerInputError('idoffHigh');
    const notes: MakerNote[] = [];
    const p: Jf = { beta: idss / (voff * voff), vto: -voff, lambda: opt(values, 'lambda') ?? 0, rs: 0 };
    /** BETA and VTO so that IDSS and ID(off) at VGS(off) match, for the current RS. */
    const solve = () => {
      for (let i = 0; i < 200; i++) {
        const k = 1 + p.lambda * vds;
        // at VGS = −voff the RS drop is negligible: (−voff − VTO)² = idoff / (BETA·k)
        const vto = -voff - Math.sqrt(idoff / (p.beta * k));
        const f = (beta: number) => idSat({ ...p, beta, vto }, 0, vds) - idss;
        const beta = bisect(f, 1e-9, 10, { log: true, iter: 200 });
        if (beta === undefined) throw new MakerInputError('jfetFit');
        const done = Math.abs(beta - p.beta) <= 1e-12 * beta && Math.abs(vto - p.vto) <= 1e-12;
        p.beta = beta;
        p.vto = vto;
        if (done) break;
      }
    };
    const gfsAt0 = () => {
      const h = 1e-5;
      return (idSat(p, h, vds) - idSat(p, -h, vds)) / (2 * h);
    };
    solve();
    const gfs = opt(values, 'gfs');
    if (gfs !== undefined) {
      const ideal = gfsAt0();
      if (gfs < ideal) {
        const f = (rs: number) => {
          p.rs = rs;
          try {
            solve();
          } catch {
            return NaN;
          }
          return gfsAt0() - gfs;
        };
        // the IDSS·RS drop must stay well inside the pinch-off voltage
        const rs = bisect(f, 0, (0.5 * voff) / idss, { iter: 150 });
        if (rs !== undefined) {
          p.rs = rs;
          solve();
        } else {
          p.rs = 0;
          solve();
          notes.push({ id: 'gfsIgnored', params: { gfs: num(ideal) }, level: 'warn' });
        }
      } else if (gfs > ideal * 1.001) {
        notes.push({ id: 'gfsSquareLaw', params: { gfs: num(ideal) }, level: 'warn' });
      }
    }
    // SPICE writes VTO negative for both N- and P-channel (depletion) JFETs
    const params: Record<string, number> = { vto: p.vto, beta: p.beta, lambda: p.lambda };
    if (p.rs > 0) {
      params.rs = p.rs;
      params.rd = p.rs;
    }
    const ciss = opt(values, 'ciss');
    const crss = opt(values, 'crss');
    const vdsc = opt(values, 'vdsc') ?? vds;
    // junction biases at the capacitance test (VGS = 0, VDS = vdsc): RS / RD drops shift them
    const idc = idSat(p, 0, vdsc);
    const vgsJ = -idc * p.rs;
    const vgdJ = vgsJ - (vdsc - 2 * idc * p.rs);
    if (crss !== undefined) params.cgd = crss * Math.pow(1 - vgdJ / PB, M);
    // a gate signal also drives the channel current gm·vgs through RS and RD: the source follows
    // (Cgs is seen as Cgs/(1 + gm·RS)) and the drain moves the other way (Cgd is seen larger):
    //   Ciss = Cgs/(1 + gm·RS) + Cgd·(1 + gm·RD/(1 + gm·RS));  Crss = Cgd
    const gmInt = 2 * p.beta * (1 + p.lambda * (vdsc - 2 * idc * p.rs)) * Math.max(0, vgsJ - p.vto);
    const deg = 1 + gmInt * p.rs;
    if (ciss !== undefined) {
      const cgdSeen = (crss ?? 0) * (1 + (gmInt * p.rs) / deg);
      params.cgs = Math.max(0, ciss - cgdSeen) * deg * Math.pow(1 - vgsJ / PB, M);
    }
    Object.assign(params, { pb: PB, m: M, is: 1e-14, b: 1 });
    const text = `${header('jfet', jfetMaker.fields, values)}\n${modelCard(name, pch ? 'PJF' : 'NJF', params)}\n`;
    return { model: { kind: 'spice', text, name }, fitted: params, notes };
  },
  checks(values, result) {
    const pch = choice(values, 'type', 'njf') === 'pjf';
    // N-channel: VDS > 0, VGS swept negative; P-channel mirrored (sources written so swept values stay positive)
    const vdsSrc = (dc: number, ac?: number) => (pch ? V('VD', '0', 'd', { dc, ...(ac ? { acMag: ac } : {}) }) : V('VD', 'd', '0', { dc, ...(ac ? { acMag: ac } : {}) }));
    const vgsOff = (dc: number, ac?: number) => (pch ? V('VG', 'g', '0', { dc, ...(ac ? { acMag: ac } : {}) }) : V('VG', '0', 'g', { dc, ...(ac ? { acMag: ac } : {}) }));
    const vds = need(values, 'vds');
    const voff = need(values, 'vgsoff');
    const out: MakerCheck[] = [];
    out.push({ id: 'idss', params: { v: sig(vds) }, target: need(values, 'idss'), unit: 'A', tol: 0.02, netlist: bench(result, ['d', 'g', '0'], [vdsSrc(vds), vgsOff(0)], [{ type: 'op' }]), measure: (r) => Math.abs(last(vec(r, 0, 'I(VD)'))) });
    const sweep = bench(result, ['d', 'g', '0'], [vdsSrc(vds), vgsOff(0)], [{ type: 'dc', src: 'VG', start: 0, stop: voff * 1.5, step: voff / 3000 }]);
    const idoff = need(values, 'idoff');
    out.push({
      id: 'vgsoff',
      params: { i: sig(idoff) },
      target: voff,
      unit: 'V',
      tol: 0.03,
      absTol: 0.02,
      netlist: sweep,
      measure: (r) => {
        const v = crossing(scale(r, 0), Array.from(vec(r, 0, 'I(VD)'), Math.abs), idoff, true);
        if (v === undefined) throw new Error('cut-off current not reached');
        return v;
      },
    });
    const gfs = opt(values, 'gfs');
    if (gfs !== undefined && !result.notes.some((n) => n.id === 'gfsIgnored' || n.id === 'gfsSquareLaw')) {
      out.push({
        id: 'gfs',
        params: {},
        target: gfs,
        unit: 'S',
        tol: 0.05,
        netlist: sweep,
        measure: (r) => {
          const x = scale(r, 0);
          const id = vec(r, 0, 'I(VD)');
          return Math.abs((id[1] - id[0]) / (x[1] - x[0]));
        },
      });
    }
    const vdsc = opt(values, 'vdsc') ?? vds;
    const f = 1e6;
    const w = 2 * Math.PI * f;
    const ciss = opt(values, 'ciss');
    const crss = opt(values, 'crss');
    if (ciss !== undefined) out.push({ id: 'ciss', params: { v: sig(vdsc) }, target: ciss, unit: 'F', tol: 0.03, netlist: bench(result, ['d', 'g', '0'], [vdsSrc(vdsc), vgsOff(0, 1)], [{ type: 'acsingle', freq: f }]), measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VG)'))) / w });
    if (crss !== undefined) out.push({ id: 'crss', params: { v: sig(vdsc) }, target: crss, unit: 'F', tol: 0.03, netlist: bench(result, ['d', 'g', '0'], [vdsSrc(vdsc, 1), vgsOff(0)], [{ type: 'acsingle', freq: f }]), measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VG)'))) / w });
    return out;
  },
};
