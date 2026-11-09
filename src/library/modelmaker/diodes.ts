/**
 * Diode, Zener and LED model makers.
 *
 * Diode (`.model <name> D`): forward points (IF, VF) obey VF = N·Vt·ln(IF/IS) + IF·RS, which is
 * linear in (N·Vt, −N·Vt·ln IS, RS); three points give IS, N and RS exactly (two points: RS = 0).
 * Breakdown: BV at IBV (the SPICE diode conducts IBV at −BV). Junction capacitance CT at reverse
 * VR: CJO = CT·(1 + VR/VJ)^M. Reverse recovery: TT = trr / ln 2 (charge control with IF = IR).
 *
 * Zener (`.subckt <name> A K`): forward diode DF (N = 1, RS from the forward point), and a reverse
 * branch RZ + breakdown diode DR + source VZ (K -> A) with
 *   ZZT = N_r·Vt/IZT + RZ,   VZ = VBR + N_r·Vt·ln(IZT/IS_r) + IZT·RZ   (IS_r = 1 fA, passive at 0 V),
 * and the reverse leakage IR at VR as a shunt resistor VR/IR.
 *
 * LED (`.model <name> D`): N by colour (typical LED ideality factors), RS from a second point (or a
 * typical value), IS from (IF, VF); reverse breakdown BV; the part glows (LED indicator).
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote, type MakerResult, type MakerValues } from './types';
import { I, V, VT, bench, choice, header, last, modelCard, num, opt, need, vec, vecIm, sig } from './common';

// ---------------------------------------------------------------------------------------------
// forward fit

export interface ForwardFit {
  is: number;
  n: number;
  rs: number;
  notes: MakerNote[];
}

/** IS, N, RS through 2 or 3 (IF, VF) points (sorted by current). */
export function fitForward(points: { i: number; v: number }[], nFixed?: number): ForwardFit {
  const p = [...points].sort((a, b) => a.i - b.i);
  const notes: MakerNote[] = [];
  for (let k = 1; k < p.length; k++) {
    if (!(p[k].i > p[k - 1].i) || !(p[k].v > p[k - 1].v)) throw new MakerInputError('forwardOrder');
  }
  const two = (a: { i: number; v: number }, b: { i: number; v: number }) => {
    const nvt = (b.v - a.v) / Math.log(b.i / a.i);
    return { nvt, bterm: a.v - nvt * Math.log(a.i) };
  };
  let nvt: number;
  let bterm: number;
  let rs = 0;
  if (nFixed !== undefined) {
    nvt = nFixed * VT;
    if (p.length >= 2) {
      const a = p[0];
      const b = p[p.length - 1];
      rs = (b.v - a.v - nvt * Math.log(b.i / a.i)) / (b.i - a.i);
      if (rs < 0) {
        rs = 0;
        nvt = (b.v - a.v) / Math.log(b.i / a.i);
        notes.push({ id: 'nAdjusted', params: { n: num(nvt / VT) }, level: 'info' });
      }
    }
    bterm = p[0].v - p[0].i * rs - nvt * Math.log(p[0].i);
  } else if (p.length >= 3) {
    // VF = nvt·ln(I) + bterm + RS·I through three points (the outer two and the middle one)
    const [a, b, c] = [p[0], p[Math.floor(p.length / 2)], p[p.length - 1]];
    const l1 = Math.log(b.i / a.i);
    const l2 = Math.log(c.i / b.i);
    const d1 = b.v - a.v;
    const d2 = c.v - b.v;
    // d1 = nvt·l1 + RS·(b.i − a.i);  d2 = nvt·l2 + RS·(c.i − b.i)
    const det = l1 * (c.i - b.i) - l2 * (b.i - a.i);
    nvt = (d1 * (c.i - b.i) - d2 * (b.i - a.i)) / det;
    rs = (l1 * d2 - l2 * d1) / det;
    if (!(rs >= 0) || !(nvt > 0)) {
      notes.push({ id: 'rsNegative', level: 'warn' });
      rs = 0;
      ({ nvt, bterm } = two(a, b));
    } else bterm = a.v - nvt * Math.log(a.i) - rs * a.i;
  } else {
    ({ nvt, bterm } = two(p[0], p[1]));
  }
  const n = nvt / VT;
  if (n < 0.5 || n > 6) notes.push({ id: 'nUnusual', params: { n: num(n) }, level: 'warn' });
  const is = Math.exp(-bterm / nvt);
  if (!(is > 0) || !Number.isFinite(is)) throw new MakerInputError('forwardFit');
  return { is, n, rs, notes };
}

const forwardPoints = (values: MakerValues, keys: [string, string][]) =>
  keys.filter(([i, v]) => opt(values, i) !== undefined && opt(values, v) !== undefined).map(([i, v]) => ({ i: need(values, i), v: need(values, v) }));

/** VF bench: current source IF into the anode, cathode grounded. */
function vfCheck(result: MakerResult, i: number, vf: number, nodes: (a: string, k: string) => string[] = (a, k) => [a, k]): MakerCheck {
  return {
    id: 'vf',
    params: { i: sig(i) },
    target: vf,
    unit: 'V',
    tol: 0.01,
    absTol: 0.005,
    netlist: bench(result, nodes('a', '0'), [I('IF', '0', 'a', { dc: i })], [{ type: 'op' }]),
    measure: (r) => last(vec(r, 0, 'V(a)')),
  };
}

/** Breakdown bench: reverse current IBV forced into the cathode. */
function bvCheck(result: MakerResult, ibv: number, bv: number, id = 'bv', tol = 0.01): MakerCheck {
  return {
    id,
    params: { i: sig(ibv) },
    target: bv,
    unit: 'V',
    tol,
    netlist: bench(result, ['0', 'k'], [I('IR', '0', 'k', { dc: ibv })], [{ type: 'op' }]),
    measure: (r) => last(vec(r, 0, 'V(k)')),
  };
}

/** Junction capacitance at reverse VR from the AC current at 1 MHz. */
function ctCheck(result: MakerResult, vr: number, ct: number): MakerCheck {
  const f = 1e6;
  return {
    id: 'ct',
    params: { v: sig(vr) },
    target: ct,
    unit: 'F',
    tol: 0.03,
    netlist: bench(result, ['0', 'k'], [V('VR', 'k', '0', { dc: vr, acMag: 1 })], [{ type: 'acsingle', freq: f }]),
    measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VR)'))) / (2 * Math.PI * f),
  };
}

// ---------------------------------------------------------------------------------------------
// diode

export const diodeMaker: MakerDef = {
  id: 'diode',
  terminals: ['A', 'K'],
  template: 'diode',
  prefix: 'D',
  group: 'diodes',
  family: 'Generic diode',
  fields: [
    { key: 'if1', unit: 'A', default: '10m', section: 'basic' },
    { key: 'vf1', unit: 'V', default: '0.72', section: 'basic' },
    { key: 'if2', unit: 'A', default: '100m', section: 'basic' },
    { key: 'vf2', unit: 'V', default: '0.83', section: 'basic' },
    { key: 'if3', unit: 'A', default: '1', optional: true, section: 'basic' },
    { key: 'vf3', unit: 'V', default: '1.0', optional: true, section: 'basic' },
    { key: 'bv', unit: 'V', default: '1000', optional: true, section: 'advanced' },
    { key: 'ibv', unit: 'A', default: '5u', optional: true, section: 'advanced' },
    { key: 'ct', unit: 'F', default: '15p', optional: true, section: 'advanced' },
    { key: 'vrct', unit: 'V', default: '4', optional: true, positive: false, min: 0, section: 'advanced' },
    { key: 'trr', unit: 's', default: '2u', optional: true, section: 'advanced' },
  ],
  fit(values, name) {
    const pts = forwardPoints(values, [['if1', 'vf1'], ['if2', 'vf2'], ['if3', 'vf3']]);
    if (pts.length < 2) throw new MakerInputError('twoPoints');
    const f = fitForward(pts);
    const notes = [...f.notes];
    const params: Record<string, number> = { is: f.is, n: f.n, rs: f.rs };
    const vj = 0.7;
    const m = 0.5;
    const trr = opt(values, 'trr');
    if (trr !== undefined) params.tt = trr / Math.LN2;
    const ct = opt(values, 'ct');
    if (ct !== undefined) {
      const vr = opt(values, 'vrct') ?? 0;
      // the measured CT also holds the diffusion capacitance TT·gd (noticeable near 0 V)
      const diffusion = ((params.tt ?? 0) * f.is * Math.exp(-vr / (f.n * VT))) / (f.n * VT);
      params.cjo = Math.max(0, ct - diffusion) * Math.pow(1 + vr / vj, m);
      params.vj = vj;
      params.m = m;
    }
    const bv = opt(values, 'bv');
    if (bv !== undefined) {
      params.bv = bv;
      params.ibv = opt(values, 'ibv') ?? 1e-6;
    } else notes.push({ id: 'noBreakdown', level: 'info' });
    const text = `${header('diode', diodeMaker.fields, values)}\n${modelCard(name, 'D', params)}\n`;
    return { model: { kind: 'spice', text, name }, fitted: params, notes };
  },
  checks(values, result) {
    const out: MakerCheck[] = [];
    for (const [ik, vk] of [['if1', 'vf1'], ['if2', 'vf2'], ['if3', 'vf3']] as const) {
      const i = opt(values, ik);
      const vf = opt(values, vk);
      if (i !== undefined && vf !== undefined) out.push(vfCheck(result, i, vf));
    }
    const bv = opt(values, 'bv');
    if (bv !== undefined) out.push(bvCheck(result, opt(values, 'ibv') ?? 1e-6, bv));
    const ct = opt(values, 'ct');
    if (ct !== undefined) out.push(ctCheck(result, opt(values, 'vrct') ?? 0, ct));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// zener

const IS_BREAKDOWN = 1e-15;

export const zenerMaker: MakerDef = {
  id: 'zener',
  terminals: ['A', 'K'],
  template: 'zener',
  prefix: 'D',
  group: 'diodes',
  family: 'Zener diode',
  fields: [
    { key: 'vz', unit: 'V', default: '5.1', section: 'basic' },
    { key: 'izt', unit: 'A', default: '49m', section: 'basic' },
    { key: 'zzt', unit: 'Ω', default: '7', section: 'basic' },
    { key: 'ir', unit: 'A', default: '10u', optional: true, section: 'advanced' },
    { key: 'vr', unit: 'V', default: '1', optional: true, section: 'advanced' },
    { key: 'vf', unit: 'V', default: '1.2', optional: true, section: 'advanced' },
    { key: 'if', unit: 'A', default: '200m', optional: true, section: 'advanced' },
    { key: 'ct', unit: 'F', default: '', optional: true, section: 'advanced' },
  ],
  fit(values, name) {
    const vz = need(values, 'vz');
    const izt = need(values, 'izt');
    const zzt = need(values, 'zzt');
    const notes: MakerNote[] = [];
    // breakdown branch: ideality so that RZ keeps at least 10 % of ZZT
    const nr = Math.min(1, (0.9 * zzt * izt) / VT);
    const rz = zzt - (nr * VT) / izt;
    const vbr = vz - nr * VT * Math.log(izt / IS_BREAKDOWN + 1) - izt * rz;
    if (!(vbr > 0.2)) throw new MakerInputError('zenerTooLow');
    // forward diode
    const vf = opt(values, 'vf') ?? 0.9;
    const ifw = opt(values, 'if') ?? 10e-3;
    if (opt(values, 'vf') === undefined) notes.push({ id: 'forwardTypical', level: 'info' });
    const rsf = vf > 0.75 ? (vf - 0.75) / ifw : 0;
    const isf = ifw / Math.exp((vf - ifw * rsf) / VT);
    const df: Record<string, number> = { is: isf, n: 1, rs: rsf };
    const ct = opt(values, 'ct');
    if (ct !== undefined) Object.assign(df, { cjo: ct, vj: 0.75, m: 0.33 });
    const lines = [header('zener', zenerMaker.fields, values), `.subckt ${name} A K`, `DF A K ${name}_F`, `RZ K 1 ${num(rz)}`, `DR 1 2 ${name}_R`, `VZ 2 A DC ${num(vbr)}`];
    const ir = opt(values, 'ir');
    const vr = opt(values, 'vr');
    let rleak = 0;
    if (ir !== undefined && vr !== undefined) {
      if (vr >= vz * 0.95) throw new MakerInputError('leakAboveVz');
      // below VZ the breakdown branch carries only ≈ IS_r (1 fA): the shunt is the leakage
      rleak = vr / ir;
      lines.push(`RL K A ${num(rleak)}`);
    }
    lines.push(modelCard(`${name}_F`, 'D', df), modelCard(`${name}_R`, 'D', { is: IS_BREAKDOWN, n: nr }), `.ends ${name}`, '');
    const fitted: Record<string, number> = { vbr, rz, nr, isf, rsf };
    if (rleak) fitted.rleak = rleak;
    return { model: { kind: 'spice', text: lines.join('\n'), name }, fitted, notes };
  },
  checks(values, result) {
    const vz = need(values, 'vz');
    const izt = need(values, 'izt');
    const out: MakerCheck[] = [bvCheck(result, izt, vz, 'vz')];
    // dynamic impedance from ±10 % around IZT
    const lo = izt * 0.9;
    const hi = izt * 1.1;
    out.push({
      id: 'zzt',
      params: { i: sig(izt) },
      target: need(values, 'zzt'),
      unit: 'Ω',
      tol: 0.05,
      netlist: bench(result, ['0', 'k'], [I('IR', '0', 'k', { dc: lo })], [{ type: 'dc', src: 'IR', start: lo, stop: hi, step: (hi - lo) / 20 }]),
      measure: (r) => {
        const v = vec(r, 0, 'V(k)');
        return (v[v.length - 1] - v[0]) / (hi - lo);
      },
    });
    const ir = opt(values, 'ir');
    const vr = opt(values, 'vr');
    if (ir !== undefined && vr !== undefined) {
      out.push({
        id: 'ir',
        params: { v: sig(vr) },
        target: ir,
        unit: 'A',
        tol: 0.05,
        netlist: bench(result, ['0', 'k'], [V('VR', 'k', '0', { dc: vr })], [{ type: 'op' }]),
        measure: (r) => Math.abs(last(vec(r, 0, 'I(VR)'))),
      });
    }
    const vf = opt(values, 'vf');
    const ifw = opt(values, 'if');
    if (vf !== undefined && ifw !== undefined) out.push(vfCheck(result, ifw, vf));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// LED

/** Typical ideality factor and series resistance of LEDs by colour (when only one point is given). */
const LED_TYPICAL: Record<string, { n: number; rs: number; bv: number }> = {
  infrared: { n: 1.5, rs: 1, bv: 5 },
  red: { n: 2, rs: 3, bv: 5 },
  orange: { n: 2, rs: 3, bv: 5 },
  yellow: { n: 2, rs: 3, bv: 5 },
  green: { n: 2.2, rs: 4, bv: 5 },
  blue: { n: 2.6, rs: 8, bv: 5 },
  white: { n: 2.6, rs: 8, bv: 5 },
};

export const LED_MAKER_COLORS = Object.keys(LED_TYPICAL);

export const ledMaker: MakerDef = {
  id: 'led',
  terminals: ['A', 'K'],
  template: 'led',
  prefix: 'LED',
  group: 'diodes',
  family: 'LED',
  fields: [
    { key: 'color', unit: '', default: 'red', kind: 'select', options: LED_MAKER_COLORS, section: 'basic' },
    { key: 'vf', unit: 'V', default: '1.9', section: 'basic' },
    { key: 'if', unit: 'A', default: '20m', section: 'basic' },
    { key: 'vf2', unit: 'V', default: '', optional: true, section: 'advanced' },
    { key: 'if2', unit: 'A', default: '', optional: true, section: 'advanced' },
    { key: 'bv', unit: 'V', default: '5', optional: true, section: 'advanced' },
    { key: 'ct', unit: 'F', default: '', optional: true, section: 'advanced' },
  ],
  fit(values, name) {
    const color = choice(values, 'color', 'red');
    const typ = LED_TYPICAL[color] ?? LED_TYPICAL.red;
    const vf = need(values, 'vf');
    const ifw = need(values, 'if');
    const notes: MakerNote[] = [];
    let n = typ.n;
    let rs = typ.rs;
    const vf2 = opt(values, 'vf2');
    const if2 = opt(values, 'if2');
    if (vf2 !== undefined && if2 !== undefined) {
      const f = fitForward([{ i: ifw, v: vf }, { i: if2, v: vf2 }], typ.n);
      n = f.n;
      rs = f.rs;
      notes.push(...f.notes);
    } else notes.push({ id: 'ledTypical', params: { n: num(n), rs: num(rs) }, level: 'info' });
    if (vf - ifw * rs <= 0) rs = (0.5 * vf) / ifw;
    const is = ifw / Math.exp((vf - ifw * rs) / (n * VT));
    const params: Record<string, number> = { is, n, rs, bv: opt(values, 'bv') ?? typ.bv, ibv: 10e-6 };
    const ct = opt(values, 'ct');
    params.cjo = ct ?? 20e-12;
    params.vj = 1.8;
    params.m = 0.4;
    params.tt = 20e-9;
    const text = `${header('led', ledMaker.fields, values)}\n${modelCard(name, 'D', params)}\n`;
    return { model: { kind: 'spice', text, name }, fitted: params, notes };
  },
  checks(values, result) {
    const out = [vfCheck(result, need(values, 'if'), need(values, 'vf'))];
    const vf2 = opt(values, 'vf2');
    const if2 = opt(values, 'if2');
    if (vf2 !== undefined && if2 !== undefined) out.push(vfCheck(result, if2, vf2));
    const bv = opt(values, 'bv');
    if (bv !== undefined) out.push(bvCheck(result, 10e-6, bv));
    return out;
  },
};
