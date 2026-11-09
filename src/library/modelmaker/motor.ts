/**
 * AC (three-phase induction) motor model maker: nameplate values -> parameters of the library's
 * induction motor (electromechanical/induction-motor-3ph: per-phase equivalent circuit Rs + jX +
 * (jXm ∥ Rr/s) with the slip from the simulated rotor speed).
 *
 * Fit at the rated point (wye, Vph = VL/√3): input power P/η, line current I = P/(3·Vph·η·cosφ), the
 * impedance Z = Vph/I ∠φ. Stator copper takes 40 % of the losses; core, friction and stray losses
 * (not in the equivalent circuit) are carried by the viscous friction b; the air-gap power
 * Pag = (P + Pfriction)·ωs/ωr must flow into the parallel branch: Re(Zp) = Pag/(3·I²), so
 * Rs = Re(Z) − Re(Zp). The remaining unknowns (Xm, Rr/s, X) follow from Re(Zp), Im(Z) and the
 * starting-current ratio Ist/In = Vph/(In·|Z(s = 1)|) (1-D search on Rr/s). Lls = Llr = X/(2ω).
 * Bench (dynamometer): a 3-phase supply with the shaft held at the rated speed by a source on the
 * speed node; the source current is the shaft torque. The model must deliver the rated torque
 * P/ωr and draw the rated line current at the rated speed.
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote, type MakerValues } from './types';
import { bench, bisect, need, num, opt, scale, vec, sig } from './common';

export const MOTOR_PART = 'electromechanical/induction-motor-3ph';

interface Fit {
  rs: number;
  rr: number;
  l: number;
  lm: number;
  b: number;
  tload: number;
  wr: number;
  i: number;
  vph: number;
  f: number;
  poles: number;
  notes: MakerNote[];
}

function fitMotor(values: MakerValues): Fit {
  const p = need(values, 'p');
  const vl = need(values, 'vl');
  const f = need(values, 'f');
  const poles = need(values, 'poles');
  const rpm = need(values, 'rpm');
  const eff = need(values, 'eff') / 100;
  const pf = need(values, 'pf');
  const kist = opt(values, 'kist') ?? 6;
  if (!(Number.isInteger(poles) && poles >= 2 && poles % 2 === 0)) throw new MakerInputError('polesEven');
  if (!(eff > 0 && eff < 1) || !(pf > 0 && pf < 1)) throw new MakerInputError('effPfRange');
  const ns = (120 * f) / poles;
  if (!(rpm < ns && rpm > 0.5 * ns)) throw new MakerInputError('rpmRange', { ns: num(ns) });
  const notes: MakerNote[] = [];
  const w = 2 * Math.PI * f;
  const ws = w / (poles / 2);
  const wr = (rpm * 2 * Math.PI) / 60;
  const s = (ws - wr) / ws;
  const vph = vl / Math.sqrt(3);
  const i = p / eff / (3 * vph * pf);
  const zmag = vph / i;
  const zr = zmag * pf;
  const zi = zmag * Math.sqrt(1 - pf * pf);
  const tload = p / wr;
  // losses: stator copper takes 40 %; core, friction and stray losses (not in the equivalent
  // circuit) are carried by the viscous friction b; the rotor copper loss is s·Pag
  const losses = p / eff - p;
  const k = (s * ws) / wr;
  let pfric = (0.6 * losses - k * p) / (1 + k);
  if (pfric < 0.005 * p) pfric = 0.005 * p;
  const b = pfric / (wr * wr);
  const pag = (tload + b * wr) * ws;
  const rp = pag / (3 * i * i);
  let rs = zr - rp;
  if (rs <= 0) {
    rs = 0.02 * zr;
    notes.push({ id: 'motorLosses', level: 'warn' });
  }
  const rpEff = zr - rs;
  // parallel branch for a given Rr' = Rr/s
  const branch = (rrp: number) => {
    const xm = rrp * Math.sqrt(rpEff / (rrp - rpEff));
    const im = (rrp * rrp * xm) / (rrp * rrp + xm * xm);
    return { xm, x: zi - im };
  };
  const startRatio = (rrp: number) => {
    const { xm, x } = branch(rrp);
    const rr = s * rrp;
    // Z(1) = Rs + jX + (jXm ∥ Rr)
    const d = rr * rr + xm * xm;
    const pr = (rr * xm * xm) / d;
    const pi = (rr * rr * xm) / d;
    return vph / (i * Math.hypot(rs + pr, x + pi));
  };
  // feasible Rr' keeps X >= 0
  const lo = rpEff * (1 + 1e-6);
  const hiX = bisect((rrp) => branch(rrp).x, lo, rpEff * 1e6, { log: true, iter: 200 }) ?? rpEff * 1e6;
  let rrp = bisect((r) => startRatio(r) - kist, lo, hiX * (1 - 1e-9), { log: true, iter: 200 });
  if (rrp === undefined) {
    // closest feasible value
    rrp = Math.abs(startRatio(lo) - kist) < Math.abs(startRatio(hiX * (1 - 1e-9)) - kist) ? lo * 1.001 : hiX * 0.999;
    notes.push({ id: 'startRatio', params: { k: num(startRatio(rrp)) }, level: 'warn' });
  }
  const { xm, x } = branch(rrp);
  return { rs, rr: s * rrp, l: Math.max(x, 1e-9) / w, lm: xm / w, b, tload, wr, i, vph, f, poles, notes };
}

export const acMotorMaker: MakerDef = {
  id: 'acmotor',
  terminals: ['U', 'V', 'W'],
  template: 'motor3',
  prefix: 'M',
  group: 'electromechanical',
  family: 'Motor',
  fields: [
    { key: 'p', unit: 'W', default: '750', section: 'basic' },
    { key: 'vl', unit: 'V', default: '400', section: 'basic' },
    { key: 'f', unit: 'Hz', default: '50', section: 'basic' },
    { key: 'poles', unit: '', default: '4', section: 'basic' },
    { key: 'rpm', unit: 'rpm', default: '1400', section: 'basic' },
    { key: 'eff', unit: '%', default: '78', section: 'basic' },
    { key: 'pf', unit: '', default: '0.78', section: 'basic' },
    { key: 'kist', unit: '', default: '5.5', optional: true, section: 'advanced' },
    { key: 'j', unit: 'kg·m²', default: '2m', optional: true, section: 'advanced' },
  ],
  fit(values) {
    const m = fitMotor(values);
    const params: Record<string, string> = {
      rs: num(m.rs),
      rr: num(m.rr),
      lls: num(m.l / 2),
      llr: num(m.l / 2),
      lm: num(m.lm),
      poles: num(m.poles),
      freq: num(m.f),
      j: num(opt(values, 'j') ?? 2e-3),
      b: num(m.b),
      tload: '0',
    };
    return { model: { kind: 'builtin', partId: MOTOR_PART, params }, fitted: { rs: m.rs, rr: m.rr, lls: m.l / 2, llr: m.l / 2, lm: m.lm, b: m.b, tload: m.tload }, notes: [...m.notes, { id: 'motorLoad', params: { t: num(m.tload) }, level: 'info' }] };
  },
  checks(values, result) {
    const m = fitMotor(values);
    const vpk = m.vph * Math.SQRT2;
    const src = (n: string, node: string, k: number) => ({ type: 'V' as const, name: n, nodes: [node, '0'], params: {}, source: { dc: 0, tran: { type: 'SIN' as const, args: [0, vpk, m.f, 0, 0, -120 * k] } } });
    // dynamometer test: the shaft is held at the rated speed by a source on the speed node, so the
    // source current is the shaft torque (air-gap torque minus friction) and the slip is the rated one
    const tstop = 0.3;
    const nl = bench(result, ['u', 'v', 'w'], [src('VU', 'u', 0), src('VV', 'v', 1), src('VW', 'w', 2), { type: 'V', name: 'VSPD', nodes: ['DUT.w', '0'], params: {}, source: { dc: m.wr } }], [{ type: 'tran', tstep: 1e-4, tstop, tmax: 1e-4 }]);
    const window = (r: Parameters<MakerCheck['measure']>[0], name: string, f: (v: number) => number) => {
      const t = scale(r, 0);
      const y = vec(r, 0, name);
      const t0 = tstop - 4 / m.f;
      let acc = 0;
      let dt = 0;
      for (let k = 1; k < t.length; k++) {
        if (t[k] <= t0) continue;
        const h = t[k] - t[k - 1];
        acc += (f(y[k]) + f(y[k - 1])) * 0.5 * h;
        dt += h;
      }
      return acc / dt;
    };
    return [
      { id: 'torque', params: { rpm: sig(need(values, 'rpm')) }, target: m.tload, unit: 'N·m', tol: 0.03, netlist: nl, measure: (r) => window(r, 'I(VSPD)', (v) => v) },
      { id: 'current', params: { rpm: sig(need(values, 'rpm')) }, target: m.i, unit: 'A', tol: 0.03, netlist: nl, measure: (r) => Math.sqrt(window(r, 'I(VU)', (v) => v * v)) },
    ];
  },
};
