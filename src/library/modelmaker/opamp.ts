/**
 * Op-amp macro-model maker (`.subckt <name> INP INN OUT VP VN`), an original single-pole design:
 *
 *   input     RIN between the inputs; bias currents IB ± IOS/2 into each input; the error voltage
 *             vd = V(INP,INN) + VOS + (Vcm − Vmid)/CMRR drives the gain stage (Vmid = (VP + VN)/2);
 *   gain      a transconductance Imax·tanh(gm·vd/Imax) into node N1 (R1 ∥ C1 to Vmid):
 *               AOL = gm·R1,  GBW = gm/(2π·C1),  slew rate SR = Imax/C1   (C1 = 1 nF);
 *   swing     N1 is clamped (1 S beyond the limit) to VP − ΔH … VN + ΔL, the output swing;
 *   output    a current-limited output resistance: Iout = Isc·tanh((V(N1) − V(OUT))/(Rout·Isc)),
 *             drawn from VP when sourcing and returned to VN when sinking;
 *   supply    quiescent current IQ from VP to VN.
 * Benches (±VS supplies): open-loop gain and GBW from a unity-gain follower in AC (A = vout/(vin −
 * vout)), slew rate from a large follower step, VOS and bias currents from the follower at 0 V,
 * CMRR from the error change between −Vcm and +Vcm, output swing open-loop, short-circuit current,
 * supply current.
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote, type MakerValues } from './types';
import { R, V, bench, header, last, need, num, opt, scale, vec, vecIm, sig } from './common';

const C1 = 1e-9;

function design(values: MakerValues) {
  const aol = Math.pow(10, need(values, 'aol') / 20);
  const gbw = need(values, 'gbw');
  const sr = need(values, 'sr') * 1e6;
  const gm = 2 * Math.PI * gbw * C1;
  const r1 = aol / gm;
  const imax = sr * C1;
  const cmrr = Math.pow(10, (opt(values, 'cmrr') ?? 90) / 20);
  return { aol, gbw, sr, gm, r1, imax, cmrr };
}

export const opampMaker: MakerDef = {
  id: 'opamp',
  terminals: ['INP', 'INN', 'OUT', 'VP', 'VN'],
  template: 'opamp',
  prefix: 'U',
  group: 'analog',
  family: 'Op-amp',
  fields: [
    { key: 'aol', unit: 'dB', default: '106', section: 'basic', min: 20, max: 200 },
    { key: 'gbw', unit: 'Hz', default: '1M', section: 'basic' },
    { key: 'sr', unit: 'V/µs', default: '0.5', section: 'basic' },
    { key: 'vos', unit: 'V', default: '1m', optional: true, positive: false, section: 'basic' },
    { key: 'ib', unit: 'A', default: '80n', optional: true, section: 'basic' },
    { key: 'ios', unit: 'A', default: '20n', optional: true, positive: false, section: 'advanced' },
    { key: 'cmrr', unit: 'dB', default: '90', optional: true, section: 'advanced', min: 20, max: 200 },
    { key: 'rin', unit: 'Ω', default: '2M', optional: true, section: 'advanced' },
    { key: 'rout', unit: 'Ω', default: '75', optional: true, section: 'advanced' },
    { key: 'isc', unit: 'A', default: '25m', optional: true, section: 'advanced' },
    { key: 'iq', unit: 'A', default: '1.7m', optional: true, section: 'advanced' },
    { key: 'hdrhi', unit: 'V', default: '1.5', optional: true, positive: false, section: 'advanced' },
    { key: 'hdrlo', unit: 'V', default: '1.5', optional: true, positive: false, section: 'advanced' },
    { key: 'vs', unit: 'V', default: '15', section: 'advanced' },
  ],
  fit(values, name) {
    const d = design(values);
    const notes: MakerNote[] = [];
    const vos = opt(values, 'vos') ?? 0;
    const ib = opt(values, 'ib') ?? 0;
    const ios = opt(values, 'ios') ?? 0;
    if (Math.abs(ios) > 2 * ib && ib > 0) throw new MakerInputError('iosAboveIb');
    const rin = opt(values, 'rin') ?? 1e12;
    const rout = opt(values, 'rout') ?? 50;
    const isc = opt(values, 'isc') ?? 25e-3;
    const iq = opt(values, 'iq') ?? 0;
    const hh = opt(values, 'hdrhi') ?? 1.5;
    const hl = opt(values, 'hdrlo') ?? 1.5;
    const vs = need(values, 'vs');
    if (hh + hl >= 2 * vs) throw new MakerInputError('swingNone');
    const vd = `(V(INP,INN)+${num(vos)}+((V(INP)+V(INN))/2-V(MID))*${num(1 / d.cmrr)})`;
    const iout = `${num(isc)}*tanh((V(N1)-V(OUT))*${num(1 / (rout * isc))})`;
    const lines = [
      header('opamp', opampMaker.fields, values),
      `.subckt ${name} INP INN OUT VP VN`,
      `RIN INP INN ${num(rin)}`,
      `IBP INP 0 DC ${num(ib + ios / 2)}`,
      `IBN INN 0 DC ${num(ib - ios / 2)}`,
      `BMID MID 0 V=(V(VP)+V(VN))/2`,
      `BG MID N1 I=${num(d.imax)}*tanh(${vd}*${num(d.gm / d.imax)})`,
      `R1 N1 MID ${num(d.r1)}`,
      `C1 N1 MID ${num(C1)}`,
      `BCL N1 0 I=uramp(V(N1)-V(VP)+${num(hh)})-uramp(V(VN)+${num(hl)}-V(N1))`,
      // output current from VP when sourcing, into VN when sinking (smooth split: both branches
      // keep a small conductance at zero current, so an unloaded output is never floating)
      `BOP VP OUT I=0.5*((${iout})+sqrt((${iout})*(${iout})+1e-14))`,
      `BON OUT VN I=0.5*(sqrt((${iout})*(${iout})+1e-14)-(${iout}))`,
      ...(iq > 0 ? [`IQ VP VN DC ${num(iq)}`] : []),
      `.ends ${name}`,
      '',
    ];
    if (opt(values, 'cmrr') === undefined) notes.push({ id: 'cmrrTypical', level: 'info' });
    return {
      model: { kind: 'spice', text: lines.join('\n'), name },
      fitted: { gm: d.gm, r1: d.r1, c1: C1, imax: d.imax, rin, rout, isc, iq, vos, ibp: ib + ios / 2, ibn: ib - ios / 2 },
      notes,
    };
  },
  checks(values, result) {
    const d = design(values);
    const vs = need(values, 'vs');
    const supplies = [V('VSP', 'vp', '0', { dc: vs }), V('VSN', 'vn', '0', { dc: -vs })];
    const follower = (vin: number, ac = 0) => [...supplies, V('VIN', 'in', '0', { dc: vin, ...(ac ? { acMag: ac } : {}) }), V('VF', 'o', 'n', { dc: 0 })];
    const nodes = ['in', 'n', 'o', 'vp', 'vn'];
    /** open-loop gain from an inverting gain −1 stage (inputs near 0 V, so CMRR does not enter): |vout / v(INN)| */
    const inverting = (prefix: string, acNode: string) => [V(`VA${prefix}`, acNode, '0', { dc: 0, acMag: 1 }), R(`RI${prefix}`, acNode, `${prefix}n`, 10e3), R(`RF${prefix}`, `${prefix}o`, `${prefix}n`, 10e3)];
    const gainOf = (idx: number, prefix: string) => (r: Parameters<MakerCheck['measure']>[0]) => {
      const o = Math.hypot(last(vec(r, idx, `V(${prefix}o)`)), last(vecIm(r, idx, `V(${prefix}o)`)));
      const n = Math.hypot(last(vec(r, idx, `V(${prefix}n)`)), last(vecIm(r, idx, `V(${prefix}n)`)));
      return o / n;
    };
    const invNodes = ['0', 'gn', 'go', 'vp', 'vn'];
    const fLow = d.gbw / d.aol / 20;
    const fHigh = d.gbw / 20;
    const out: MakerCheck[] = [
      { id: 'aol', params: {}, target: need(values, 'aol'), unit: 'dB', tol: 0, absTol: 0.5, netlist: bench(result, invNodes, [...supplies, ...inverting('g', 'gi')], [{ type: 'acsingle', freq: fLow }]), measure: (r) => 20 * Math.log10(gainOf(0, 'g')(r)) },
      { id: 'gbw', params: {}, target: d.gbw, unit: 'Hz', tol: 0.05, netlist: bench(result, invNodes, [...supplies, ...inverting('g', 'gi')], [{ type: 'acsingle', freq: fHigh }]), measure: (r) => gainOf(0, 'g')(r) * fHigh },
    ];
    // slew rate: a follower step of ±(swing − 1 V)
    const hh = opt(values, 'hdrhi') ?? 1.5;
    const hl = opt(values, 'hdrlo') ?? 1.5;
    const step = Math.max(0.5, Math.min(vs - hh, vs - hl) - 1);
    const tSlew = (2 * step) / d.sr;
    const tstop = 3 * tSlew + 10 / d.gbw;
    out.push({
      id: 'sr',
      params: {},
      target: need(values, 'sr'),
      unit: 'V/µs',
      tol: 0.1,
      netlist: bench(
        result,
        nodes,
        [...supplies, { type: 'V', name: 'VIN', nodes: ['in', '0'], params: {}, source: { dc: -step, tran: { type: 'PULSE', args: [-step, step, tstop / 10, tSlew / 1000, tSlew / 1000, tstop, 2 * tstop] } } }, V('VF', 'o', 'n', { dc: 0 })],
        [{ type: 'tran', tstep: tstop / 4000, tstop, tmax: tstop / 4000 }],
      ),
      measure: (r) => {
        const t = scale(r, 0);
        const vo = vec(r, 0, 'V(o)');
        let best = 0;
        for (let i = 2; i < t.length; i++) best = Math.max(best, (vo[i] - vo[i - 2]) / (t[i] - t[i - 2]));
        return best / 1e6;
      },
    });
    const dc0 = bench(result, nodes, follower(0), [{ type: 'op' }]);
    const vos = opt(values, 'vos');
    if (vos !== undefined) out.push({ id: 'vos', params: {}, target: vos, unit: 'V', tol: 0.05, absTol: 20e-6, netlist: dc0, measure: (r) => last(vec(r, 0, 'V(o)')) - last(vec(r, 0, 'V(in)')) });
    const ib = opt(values, 'ib');
    if (ib !== undefined) {
      // both inputs held at 0 V by their own sources (no voltage across RIN); the output may saturate
      const shorted = bench(result, ['ip', 'inn', 'o', 'vp', 'vn'], [...supplies, V('VP0', 'ip', '0', { dc: 0 }), V('VN0', 'inn', '0', { dc: 0 })], [{ type: 'op' }]);
      // current into a pin = −I(source) (SPICE: I(V) flows from + through the source to −)
      const ip = (r: Parameters<MakerCheck['measure']>[0]) => -last(vec(r, 0, 'I(VP0)'));
      const inn = (r: Parameters<MakerCheck['measure']>[0]) => -last(vec(r, 0, 'I(VN0)'));
      out.push({ id: 'ib', params: {}, target: ib, unit: 'A', tol: 0.03, netlist: shorted, measure: (r) => (ip(r) + inn(r)) / 2 });
      const ios = opt(values, 'ios');
      if (ios !== undefined) out.push({ id: 'ios', params: {}, target: ios, unit: 'A', tol: 0.03, absTol: 1e-15, netlist: shorted, measure: (r) => ip(r) - inn(r) });
    }
    const cmrr = opt(values, 'cmrr');
    if (cmrr !== undefined) {
      const vcm = Math.max(0.5, Math.min(5, Math.min(vs - hh, vs - hl) - 1));
      out.push({
        id: 'cmrr',
        params: { v: sig(vcm) },
        target: cmrr,
        unit: 'dB',
        tol: 0,
        absTol: 1.5,
        // follower for the common-mode step, plus a second instance (inverting) for the open-loop gain
        netlist: (() => {
          const nl = bench(result, nodes, [...follower(-vcm), ...inverting('g', 'gi')], [{ type: 'dc', src: 'VIN', start: -vcm, stop: vcm, step: vcm }, { type: 'acsingle', freq: fLow }]);
          nl.elements.push({ type: 'X', name: 'XDUT2', nodes: invNodes, model: result.model.kind === 'spice' ? result.model.name : '', params: {} });
          return nl;
        })(),
        measure: (r) => {
          const vin = vec(r, 0, 'V(in)');
          const vo = vec(r, 0, 'V(o)');
          const e = (k: number) => vo[k] - vin[k];
          const n = vin.length - 1;
          const de = e(n) - e(0);
          const dvin = vin[n] - vin[0];
          const dvcm = (vin[n] + vo[n] - vin[0] - vo[0]) / 2;
          const a = gainOf(1, 'g')(r);
          const inv = (de * (1 + a) + dvin) / (a * dvcm);
          return 20 * Math.log10(1 / Math.abs(inv));
        },
      });
    }
    out.push(
      { id: 'voh', params: {}, target: vs - hh, unit: 'V', tol: 0, absTol: 0.02, netlist: bench(result, nodes, [...supplies, V('VIP', 'in', '0', { dc: 0.1 }), V('VIN2', 'n', '0', { dc: 0 })], [{ type: 'op' }]), measure: (r) => last(vec(r, 0, 'V(o)')) },
      { id: 'vol', params: {}, target: -vs + hl, unit: 'V', tol: 0, absTol: 0.02, netlist: bench(result, nodes, [...supplies, V('VIP', 'in', '0', { dc: -0.1 }), V('VIN2', 'n', '0', { dc: 0 })], [{ type: 'op' }]), measure: (r) => last(vec(r, 0, 'V(o)')) },
    );
    const isc = opt(values, 'isc');
    if (isc !== undefined) out.push({ id: 'isc', params: {}, target: isc, unit: 'A', tol: 0.02, netlist: bench(result, nodes, [...supplies, V('VIP', 'in', '0', { dc: 0.1 }), V('VIN2', 'n', '0', { dc: 0 }), V('VSC', 'o', '0', { dc: 0 })], [{ type: 'op' }]), measure: (r) => Math.abs(last(vec(r, 0, 'I(VSC)'))) });
    const iq = opt(values, 'iq');
    if (iq !== undefined) out.push({ id: 'iq', params: {}, target: iq, unit: 'A', tol: 0.03, netlist: dc0, measure: (r) => Math.abs(last(vec(r, 0, 'I(VSP)'))) });
    return out;
  },
};
