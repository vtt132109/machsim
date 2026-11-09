/**
 * BJT model maker (Gummel-Poon `.model <name> NPN|PNP`) from datasheet values.
 *
 * The fit evaluates the SPICE Gummel-Poon DC equations itself (forward transport with base charge
 * qb = q1·(1 + √(1 + 4·cbe/IKF))/2, q1 = 1/(1 − vbc/VAF); base current cbe/BF + ISE·e^(vbe/(NE·Vt)) +
 * cbc/BR) and solves, in an outer fixed-point loop:
 *   IS   so that Ic = IC1 at the terminal VBE(on) (minus the IB·RB + IE·RE drops);
 *   BF, ISE  so that hFE matches at IC1 (and at the low-current point IC3 when given; otherwise the
 *        recombination current is 10 % of IB at IC1);
 *   IKF  so that hFE matches the high-current point IC2 (high injection);
 *   RC, RB  from VCE(sat) / VBE(sat) at the forced IC / IB (internal junctions solved by Newton,
 *        RE = RC/4);
 * then CJC = Cob·(1 + VCB/VJC)^MJC, CJE = Cib·(1 + VEB/VJE)^MJE and TF from
 *   1/(2π·fT) = TF·gd/gm + (Cje + Cjc)/gm + Cjc·(RC + RE)   at the fT test current.
 * Benches: hFE / VBE from a VBE sweep at fixed VCE, VCE(sat) / VBE(sat) with forced currents, fT from
 * the AC current gain at fT/10, Cob / Cib from the AC current at 1 MHz.
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote } from './types';
import { I, R, V, VT, bench, bisect, choice, crossing, header, last, modelCard, need, num, opt, vec, vecIm, scale, sig } from './common';

interface Gp {
  is: number;
  bf: number;
  vaf: number;
  ikf: number;
  ise: number;
  ne: number;
  br: number;
  rb: number;
  re: number;
  rc: number;
}

/** Collector and base current (into the terminals, device polarity) at internal junction voltages. */
function currents(p: Gp, vbe: number, vbc: number): { ic: number; ib: number; cbe: number; qb: number } {
  const cbe = p.is * (Math.exp(vbe / VT) - 1);
  const cbc = p.is * (Math.exp(vbc / VT) - 1);
  const q1 = p.vaf > 0 ? 1 / (1 - vbc / p.vaf) : 1;
  const q2 = p.ikf > 0 ? cbe / p.ikf : 0;
  const qb = (q1 * (1 + Math.sqrt(1 + 4 * Math.max(q2, -0.24)))) / 2;
  const it = (cbe - cbc) / qb;
  const ibe = cbe / p.bf + p.ise * (Math.exp(vbe / (p.ne * VT)) - 1);
  const ibc = cbc / p.br;
  return { ic: it - ibc, ib: ibe + ibc, cbe, qb };
}

/** Internal vbe giving collector current `ic` at terminal VCE (forward active). */
function vbeFor(p: Gp, ic: number, vce: number): number {
  const f = (vbe: number) => {
    let vbc = vbe - vce;
    let r = currents(p, vbe, vbc);
    for (let k = 0; k < 3; k++) {
      // forward active: the collector junction stays reverse biased (huge trial currents would
      // otherwise drive it forward through the RC / RE drops)
      vbc = Math.min(0, vbe - (vce - r.ic * p.rc - (r.ic + r.ib) * p.re));
      r = currents(p, vbe, vbc);
    }
    return Math.log(Math.max(r.ic, 1e-300)) - Math.log(ic);
  };
  const v = bisect(f, 0, 1.6, { iter: 120 });
  if (v === undefined) throw new MakerInputError('bjtFit');
  return v;
}

/** hFE and internal state at collector current ic, terminal VCE. */
function stateAt(p: Gp, ic: number, vce: number) {
  const vbe = vbeFor(p, ic, vce);
  const vbc = vbe - (vce - ic * p.rc);
  const r = currents(p, vbe, vbc);
  return { vbe, vbc, ...r, hfe: r.ic / r.ib };
}

/** Internal junction voltages with forced terminal IB and IC (saturation), by 2-D Newton. */
function saturated(p: Gp, ib: number, ic: number): { vbe: number; vbc: number } {
  let vbe = 0.75;
  let vbc = 0.6;
  for (let k = 0; k < 200; k++) {
    const r = currents(p, vbe, vbc);
    const fe = r.ic - ic;
    const fb = r.ib - ib;
    const h = 1e-7;
    const re1 = currents(p, vbe + h, vbc);
    const rc1 = currents(p, vbe, vbc + h);
    const a = (re1.ic - r.ic) / h;
    const b = (rc1.ic - r.ic) / h;
    const c = (re1.ib - r.ib) / h;
    const d = (rc1.ib - r.ib) / h;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || det === 0) break;
    let dx = (fe * d - b * fb) / det;
    let dy = (a * fb - c * fe) / det;
    const lim = 0.05;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (m > lim) {
      dx *= lim / m;
      dy *= lim / m;
    }
    vbe -= dx;
    vbc -= dy;
    if (m < 1e-12) break;
  }
  return { vbe, vbc };
}

/** SPICE depletion capacitance (FC = 0.5 linear extension). */
function depletion(cj0: number, v: number, vj: number, m: number): number {
  const fc = 0.5;
  if (v < fc * vj) return cj0 / Math.pow(1 - v / vj, m);
  const f2 = Math.pow(1 - fc, 1 + m);
  return (cj0 / f2) * (1 - fc * (1 + m) + (m * v) / vj);
}

const VJ = 0.75;
const MJ = 0.33;

export const bjtMaker: MakerDef = {
  id: 'bjt',
  terminals: ['C', 'B', 'E'],
  template: 'npn',
  prefix: 'Q',
  group: 'transistors',
  family: 'NPN BJT',
  fields: [
    { key: 'type', unit: '', default: 'npn', kind: 'select', options: ['npn', 'pnp'], section: 'basic' },
    { key: 'hfe1', unit: '', default: '200', section: 'basic' },
    { key: 'ic1', unit: 'A', default: '2m', section: 'basic' },
    { key: 'vce', unit: 'V', default: '5', section: 'basic' },
    { key: 'vbe', unit: 'V', default: '0.65', section: 'basic' },
    { key: 'hfe2', unit: '', default: '80', optional: true, section: 'basic' },
    { key: 'ic2', unit: 'A', default: '150m', optional: true, section: 'basic' },
    { key: 'ft', unit: 'Hz', default: '250M', optional: true, section: 'basic' },
    { key: 'icft', unit: 'A', default: '10m', optional: true, section: 'basic' },
    { key: 'cob', unit: 'F', default: '4p', optional: true, section: 'basic' },
    { key: 'vcb', unit: 'V', default: '10', optional: true, positive: false, min: 0, section: 'basic' },
    { key: 'hfe3', unit: '', default: '', optional: true, section: 'advanced' },
    { key: 'ic3', unit: 'A', default: '', optional: true, section: 'advanced' },
    { key: 'vcesat', unit: 'V', default: '0.25', optional: true, section: 'advanced' },
    { key: 'vbesat', unit: 'V', default: '0.9', optional: true, section: 'advanced' },
    { key: 'icsat', unit: 'A', default: '100m', optional: true, section: 'advanced' },
    { key: 'ibsat', unit: 'A', default: '10m', optional: true, section: 'advanced' },
    { key: 'cib', unit: 'F', default: '', optional: true, section: 'advanced' },
    { key: 'veb', unit: 'V', default: '0.5', optional: true, positive: false, min: 0, section: 'advanced' },
    { key: 'va', unit: 'V', default: '100', optional: true, section: 'advanced' },
  ],
  variant: (values) => (choice(values, 'type', 'npn') === 'pnp' ? { template: 'pnp', family: 'PNP BJT' } : { template: 'npn', family: 'NPN BJT' }),
  fit(values, name) {
    const pnp = choice(values, 'type', 'npn') === 'pnp';
    const hfe1 = need(values, 'hfe1');
    const ic1 = need(values, 'ic1');
    const vce = need(values, 'vce');
    const vbeOn = need(values, 'vbe');
    const notes: MakerNote[] = [];
    const ic2 = opt(values, 'ic2');
    const hfe2 = opt(values, 'hfe2');
    const ic3 = opt(values, 'ic3');
    const hfe3 = opt(values, 'hfe3');
    const sat = { ic: opt(values, 'icsat'), ib: opt(values, 'ibsat'), vce: opt(values, 'vcesat'), vbe: opt(values, 'vbesat') };
    const p: Gp = { is: 1e-14, bf: hfe1 * 1.1, vaf: opt(values, 'va') ?? 100, ikf: ic2 && hfe2 ? ic2 : 0, ise: 0, ne: 1.5, br: 3, rb: 10, re: 0, rc: 0 };
    if (opt(values, 'va') === undefined) notes.push({ id: 'earlyTypical', level: 'info' });
    const useIkf = ic2 !== undefined && hfe2 !== undefined;
    if (useIkf && !(ic2 > ic1 && hfe2 < hfe1)) throw new MakerInputError('bjtHighPoint');
    const useLow = ic3 !== undefined && hfe3 !== undefined && ic3 < ic1;

    const fitIs = () => {
      const ib1 = ic1 / hfe1;
      const target = vbeOn - ib1 * p.rb - (ic1 + ib1) * p.re;
      const f = (is: number) => {
        p.is = is;
        return vbeFor(p, ic1, vce) - target;
      };
      const is = bisect(f, 1e-22, 1e-6, { log: true, iter: 150 });
      if (is === undefined) throw new MakerInputError('bjtVbe');
      p.is = is;
    };
    const fitBeta = () => {
      const s1 = stateAt(p, ic1, vce);
      const ib1 = ic1 / hfe1;
      const e1 = Math.exp(s1.vbe / (p.ne * VT)) - 1;
      if (useLow) {
        const s3 = stateAt(p, ic3!, vce);
        const ib3 = ic3! / hfe3!;
        const e3 = Math.exp(s3.vbe / (p.ne * VT)) - 1;
        // ib = cbe·(1/BF) + ISE·e  at both points
        const det = s1.cbe * e3 - s3.cbe * e1;
        const invBf = (ib1 * e3 - ib3 * e1) / det;
        const ise = (s1.cbe * ib3 - s3.cbe * ib1) / det;
        if (invBf > 0 && ise >= 0) {
          p.bf = 1 / invBf;
          p.ise = ise;
          return;
        }
        notes.push({ id: 'lowPointIgnored', level: 'warn' });
      }
      p.ise = (0.1 * ib1) / e1;
      p.bf = s1.cbe / (0.9 * ib1);
    };
    const fitIkf = () => {
      if (!useIkf) return;
      const f = (ikf: number) => {
        p.ikf = ikf;
        return stateAt(p, ic2, vce).hfe - hfe2;
      };
      const ikf = bisect(f, ic2 * 1e-3, ic2 * 1e3, { log: true, iter: 120 });
      if (ikf === undefined) {
        p.ikf = 0;
        notes.push({ id: 'ikfIgnored', level: 'warn' });
      } else p.ikf = ikf;
    };
    const fitSat = () => {
      if (sat.ic === undefined || sat.ib === undefined) return;
      const j = saturated(p, sat.ib, sat.ic);
      if (sat.vce !== undefined) {
        // VCE = vbe − vbc + IC·RC + IE·RE with RE = RC / 4
        const ie = sat.ic + sat.ib;
        const rc = (sat.vce - (j.vbe - j.vbc)) / (sat.ic + ie / 4);
        if (rc >= 0) {
          p.rc = rc;
          p.re = rc / 4;
        } else {
          p.rc = 0;
          p.re = 0;
          notes.push({ id: 'vcesatLow', params: { v: sig(j.vbe - j.vbc) }, level: 'warn' });
        }
      }
      if (sat.vbe !== undefined) {
        const rb = (sat.vbe - j.vbe - (sat.ic + sat.ib) * p.re) / sat.ib;
        if (rb >= 0) p.rb = rb;
        else notes.push({ id: 'vbesatLow', level: 'warn' });
      }
    };
    let prev = 0;
    for (let it = 0; it < 60; it++) {
      fitIs();
      fitBeta();
      fitIkf();
      fitSat();
      const key = p.is * p.bf * (p.ikf || 1) * (1 + p.rc) * (1 + p.rb);
      if (Math.abs(key - prev) <= 1e-10 * Math.abs(key)) break;
      prev = key;
    }
    // capacitances and transit time
    const cob = opt(values, 'cob');
    const vcb = opt(values, 'vcb') ?? 10;
    const cjc = cob !== undefined ? cob * Math.pow(1 + vcb / VJ, MJ) : 2e-12;
    if (cob === undefined) notes.push({ id: 'cobTypical', level: 'info' });
    const cib = opt(values, 'cib');
    const veb = opt(values, 'veb') ?? 0.5;
    const cje = cib !== undefined ? cib * Math.pow(1 + veb / VJ, MJ) : 2 * cjc;
    let tf = 0;
    const ft = opt(values, 'ft');
    if (ft !== undefined) {
      const icft = opt(values, 'icft') ?? ic1;
      const s = stateAt(p, icft, vce);
      const h = 1e-6;
      const up = currents(p, s.vbe + h, s.vbc);
      const gm = (up.ic - s.ic) / h;
      const gd = (up.cbe / up.qb - s.cbe / s.qb) / h;
      const cjeB = depletion(cje, s.vbe, VJ, MJ);
      const cjcB = depletion(cjc, s.vbc, VJ, MJ);
      tf = (1 / (2 * Math.PI * ft) - (cjeB + cjcB) / gm - cjcB * (p.rc + p.re)) / (gd / gm);
      if (!(tf > 0)) {
        tf = 0;
        notes.push({ id: 'ftTooHigh', level: 'warn' });
      }
    } else notes.push({ id: 'noFt', level: 'info' });
    const params: Record<string, number> = {
      is: p.is,
      bf: p.bf,
      nf: 1,
      vaf: p.vaf,
      ikf: p.ikf,
      ise: p.ise,
      ne: p.ne,
      br: p.br,
      nr: 1,
      rb: p.rb,
      re: p.re,
      rc: p.rc,
      cje,
      vje: VJ,
      mje: MJ,
      cjc,
      vjc: VJ,
      mjc: MJ,
      tf,
      tr: Math.max(10 * tf, 10e-9),
      xtb: 1.5,
      eg: 1.11,
      xti: 3,
      fc: 0.5,
    };
    if (!p.ikf) delete params.ikf;
    const text = `${header('bjt', bjtMaker.fields, values)}\n${modelCard(name, pnp ? 'PNP' : 'NPN', params)}\n`;
    return { model: { kind: 'spice', text, name }, fitted: params, notes };
  },
  checks(values, result) {
    const pnp = choice(values, 'type', 'npn') === 'pnp';
    const s = pnp ? -1 : 1;
    const vce = need(values, 'vce');
    const out: MakerCheck[] = [];
    // VBE sweep at fixed VCE (PNP: sources reversed so the sweep variable stays positive)
    const sweep = bench(
      result,
      ['c', 'b', '0'],
      [pnp ? V('VC', '0', 'c', { dc: vce }) : V('VC', 'c', '0', { dc: vce }), pnp ? V('VB', '0', 'b', { dc: 0.3 }) : V('VB', 'b', '0', { dc: 0.3 })],
      [{ type: 'dc', src: 'VB', start: 0.3, stop: 3, step: 0.0005 }],
    );
    const hfeAt = (ic: number) => (r: Parameters<MakerCheck['measure']>[0]) => {
      const x = scale(r, 0);
      const icv = Array.from(vec(r, 0, 'I(VC)'), Math.abs);
      const ibv = Array.from(vec(r, 0, 'I(VB)'), Math.abs);
      const v = crossing(x, icv, ic, true);
      if (v === undefined) throw new Error('collector current not reached');
      const k = x.findIndex((t) => t >= v);
      const w = (v - x[k - 1]) / (x[k] - x[k - 1]);
      const ib = Math.exp(Math.log(ibv[k - 1]) * (1 - w) + Math.log(ibv[k]) * w);
      return ic / ib;
    };
    const ic1 = need(values, 'ic1');
    out.push({ id: 'hfe', params: { i: sig(ic1) }, target: need(values, 'hfe1'), unit: '', tol: 0.03, netlist: sweep, measure: hfeAt(ic1) });
    out.push({
      id: 'vbe',
      params: { i: sig(ic1) },
      target: need(values, 'vbe'),
      unit: 'V',
      tol: 0.01,
      absTol: 0.005,
      netlist: sweep,
      measure: (r) => {
        const v = crossing(scale(r, 0), Array.from(vec(r, 0, 'I(VC)'), Math.abs), ic1, true);
        if (v === undefined) throw new Error('collector current not reached');
        return v;
      },
    });
    for (const [hk, ik] of [['hfe2', 'ic2'], ['hfe3', 'ic3']] as const) {
      const h = opt(values, hk);
      const i = opt(values, ik);
      if (h !== undefined && i !== undefined) out.push({ id: 'hfe', params: { i: sig(i) }, target: h, unit: '', tol: 0.05, netlist: sweep, measure: hfeAt(i) });
    }
    const icsat = opt(values, 'icsat');
    const ibsat = opt(values, 'ibsat');
    if (icsat !== undefined && ibsat !== undefined) {
      const satBench = bench(result, ['c', 'b', '0'], [I('IC', s > 0 ? '0' : 'c', s > 0 ? 'c' : '0', { dc: icsat }), I('IB', s > 0 ? '0' : 'b', s > 0 ? 'b' : '0', { dc: ibsat })], [{ type: 'op' }]);
      const vcesat = opt(values, 'vcesat');
      if (vcesat !== undefined) out.push({ id: 'vcesat', params: { i: sig(icsat), ib: sig(ibsat) }, target: vcesat, unit: 'V', tol: 0.05, absTol: 0.01, netlist: satBench, measure: (r) => Math.abs(last(vec(r, 0, 'V(c)'))) });
      const vbesat = opt(values, 'vbesat');
      if (vbesat !== undefined) out.push({ id: 'vbesat', params: { i: sig(icsat), ib: sig(ibsat) }, target: vbesat, unit: 'V', tol: 0.03, absTol: 0.01, netlist: satBench, measure: (r) => Math.abs(last(vec(r, 0, 'V(b)'))) });
    }
    const ft = opt(values, 'ft');
    if (ft !== undefined) {
      const icft = opt(values, 'icft') ?? ic1;
      // bias the base with the DC current that gives icft (from the fitted hFE), AC current on top
      const bf = result.fitted.bf ?? need(values, 'hfe1');
      const f = ft / 10;
      const acBench = bench(
        result,
        ['c', 'b', '0'],
        [pnp ? V('VC', '0', 'c', { dc: vce }) : V('VC', 'c', '0', { dc: vce }), I('IB', s > 0 ? '0' : 'b', s > 0 ? 'b' : '0', { dc: icft / bf, acMag: 1 })],
        [{ type: 'op' }, { type: 'acsingle', freq: f }],
      );
      out.push({
        id: 'ft',
        params: { i: sig(icft) },
        target: ft,
        unit: 'Hz',
        tol: 0.1,
        netlist: acBench,
        measure: (r) => {
          const re = last(vec(r, 1, 'I(VC)'));
          const im = last(vecIm(r, 1, 'I(VC)'));
          return f * Math.hypot(re, im);
        },
      });
    }
    const cob = opt(values, 'cob');
    if (cob !== undefined) {
      const vcb = opt(values, 'vcb') ?? 10;
      const fc = 1e6;
      out.push({
        id: 'cob',
        params: { v: sig(vcb) },
        target: cob,
        unit: 'F',
        tol: 0.03,
        netlist: bench(result, ['c', '0', 'e'], [V('VC', s > 0 ? 'c' : '0', s > 0 ? '0' : 'c', { dc: vcb, acMag: 1 }), R('RE', 'e', '0', 1e9)], [{ type: 'acsingle', freq: fc }]),
        measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VC)'))) / (2 * Math.PI * fc),
      });
    }
    const cib = opt(values, 'cib');
    if (cib !== undefined) {
      const veb = opt(values, 'veb') ?? 0.5;
      const fc = 1e6;
      out.push({
        id: 'cib',
        params: { v: sig(veb) },
        target: cib,
        unit: 'F',
        tol: 0.03,
        netlist: bench(result, ['c', '0', 'e'], [V('VE', s > 0 ? 'e' : '0', s > 0 ? '0' : 'e', { dc: veb, acMag: 1 }), R('RC', 'c', '0', 1e9)], [{ type: 'acsingle', freq: fc }]),
        measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VE)'))) / (2 * Math.PI * fc),
      });
    }
    return out;
  },
};
