/**
 * SCR (thyristor) model maker: two-transistor model `.subckt <name> A K G`
 *   RT  A  A1        on-state slope resistance
 *   Q1  G  N1 A1     PNP (collector = gate, base = N1, emitter = anode)
 *   Q2  N1 G  K      NPN (collector = N1, base = gate, emitter = cathode)
 *   RGK G  K         gate-cathode shunt
 *
 * Fit (Ebers-Moll in the active region, gate node KCL  IG = vg/RGK + IS2·e^(vg/Vt)·(1/BF2 − BF1)):
 *   the trigger point is the maximum of IG(vg): IGT = (VGT − Vt)/RGK, IS2·(BF1 − 1/BF2) = Vt/(RGK·e^(VGT/Vt));
 *   the holding point (gate open) is the upper root x of IS2·(BF1 − 1/BF2)·e^(x/Vt) = x/RGK, with
 *   IH = x·(BF1 + 1)/(RGK·(BF1 − 1/BF2)), which gives BF1 for BF2 = 100;
 *   VTM at ITM: an on-state junction estimate plus ITM·RT.
 * `refine` (with the simulator) then corrects BF1 and RT on the holding / on-state benches, because the
 * holding point lies in the saturated region the active-region formulas do not cover.
 * Benches: a DC gate-current sweep with the anode at 12 V through a load (IGT, VGT at the jump),
 * a transient that triggers the SCR and ramps the anode current down (IH = device current just
 * before it turns off), and the on-state voltage at ITM.
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote, type MakerResult, type MakerValues } from './types';
import { I, R, V, VT, bench, bisect, header, last, modelCard, need, num, opt, scale, vec, sig } from './common';

const BF2 = 100;
const BR = 1;

/** Subcircuit text for the fitted values (IS1 = IS2 = K/(BF1 − 1/BF2)). */
export function scrModel(values: MakerValues, name: string, p: { rgk: number; k: number; bf1: number; rt: number }, notes: MakerNote[]): MakerResult {
  const is2 = p.k / (p.bf1 - 1 / BF2);
  const lines = [
    header('scr', scrMaker.fields, values),
    `.subckt ${name} A K G`,
    `RT A A1 ${num(p.rt)}`,
    `Q1 G N1 A1 ${name}_P`,
    `Q2 N1 G K ${name}_N`,
    `RGK G K ${num(p.rgk)}`,
    modelCard(`${name}_P`, 'PNP', { is: is2, bf: p.bf1, br: BR, tf: 1e-7, tr: 1e-6 }),
    modelCard(`${name}_N`, 'NPN', { is: is2, bf: BF2, br: BR, tf: 1e-7, tr: 1e-6 }),
    `.ends ${name}`,
    '',
  ];
  return { model: { kind: 'spice', text: lines.join('\n'), name }, fitted: { rgk: p.rgk, rt: p.rt, k: p.k, is1: is2, is2, bf1: p.bf1, bf2: BF2 }, notes };
}

export const scrMaker: MakerDef = {
  id: 'scr',
  terminals: ['A', 'K', 'G'],
  template: 'scr',
  prefix: 'D',
  group: 'diodes',
  family: 'Thyristor',
  fields: [
    { key: 'igt', unit: 'A', default: '200u', section: 'basic' },
    { key: 'vgt', unit: 'V', default: '0.8', section: 'basic' },
    { key: 'ih', unit: 'A', default: '5m', section: 'basic' },
    { key: 'vtm', unit: 'V', default: '1.7', section: 'basic' },
    { key: 'itm', unit: 'A', default: '1.2', section: 'basic' },
    { key: 'vdrm', unit: 'V', default: '200', optional: true, section: 'advanced' },
  ],
  fit(values, name) {
    const igt = need(values, 'igt');
    const vgt = need(values, 'vgt');
    const ih = need(values, 'ih');
    const vtm = need(values, 'vtm');
    const itm = need(values, 'itm');
    const notes: MakerNote[] = [];
    if (!(vgt > 4 * VT && vgt < 2)) throw new MakerInputError('vgtRange');
    const rgk = (vgt - VT) / igt;
    const k = VT / (rgk * Math.exp(vgt / VT));
    // upper root of k·e^(x/Vt) = x/RGK
    const x = bisect((v) => k * Math.exp(v / VT) - v / rgk, vgt, vgt + 60 * VT, { iter: 200 });
    if (x === undefined) throw new MakerInputError('scrFit');
    const r = (ih * rgk) / x;
    if (!(r > 1.05)) throw new MakerInputError('ihTooLow', { min: num((1.05 * x) / rgk) });
    const bf1 = (1 + r / BF2) / (r - 1);
    if (!(bf1 * BF2 > 1.2)) throw new MakerInputError('scrFit');
    // on-state estimate: PNP emitter junction at ITM plus a saturated NPN (refined by simulation)
    const is2 = k / (bf1 - 1 / BF2);
    const va0 = VT * Math.log(itm / (is2 * (1 + 1 / bf1))) + 0.1;
    let rt = (vtm - va0) / itm;
    if (rt <= 0) {
      rt = 1e-6;
      notes.push({ id: 'vtmLow', params: { v: sig(va0) }, level: 'warn' });
    }
    const vdrm = opt(values, 'vdrm');
    if (vdrm !== undefined) notes.push({ id: 'vdrmInfo', params: { v: sig(vdrm) }, level: 'info' });
    return scrModel(values, name, { rgk, k, bf1, rt }, notes);
  },
  /**
   * The active-region formulas set IGT / VGT exactly, but the on-state near the holding point is
   * saturated: simulate the holding and on-state benches and correct BF1 (IH) and RT (VTM), keeping
   * IS2·(BF1 − 1/BF2) (so IGT / VGT stay put).
   */
  refine(values, result, run) {
    const ih = need(values, 'ih');
    const vtm = need(values, 'vtm');
    const itm = need(values, 'itm');
    const name = result.model.kind === 'spice' ? result.model.name : 'SCR';
    const base = { rgk: result.fitted.rgk, k: result.fitted.k };
    const measure = (id: 'ih' | 'vtm', r: MakerResult): number | undefined => {
      const c = scrMaker.checks(values, r).find((x) => x.id === id)!;
      try {
        return c.measure(run(c.netlist));
      } catch {
        return undefined;
      }
    };
    // IH falls monotonically as BF1 grows: bracket log(IH/target) in log(BF1), then bisect
    const err = (bf1: number): number | undefined => {
      const v = measure('ih', scrModel(values, name, { ...base, bf1, rt: result.fitted.rt }, result.notes));
      return v === undefined ? undefined : Math.log(v / ih);
    };
    let lo = result.fitted.bf1;
    let elo = err(lo);
    let bf1 = lo;
    let ok = false;
    if (elo !== undefined) {
      let hi = lo;
      let ehi: number | undefined = elo;
      // step by 1.4× towards the target until the sign changes (IH too high -> larger BF1)
      const up = elo > 0;
      for (let k = 0; k < 12 && ehi !== undefined && (ehi > 0) === up; k++) {
        lo = hi;
        elo = ehi;
        hi = up ? hi * 1.4 : hi / 1.4;
        if (hi < 1.5 / BF2 || hi > 50) break;
        ehi = err(hi);
      }
      if (ehi !== undefined && elo !== undefined && (ehi > 0) !== (elo > 0)) {
        for (let k = 0; k < 14; k++) {
          const mid = Math.sqrt(lo * hi);
          const em = err(mid);
          if (em === undefined) break;
          if ((em > 0) === (elo > 0)) {
            lo = mid;
            elo = em;
          } else {
            hi = mid;
            ehi = em;
          }
          if (Math.abs(em) < 0.003) {
            lo = mid;
            elo = em;
            break;
          }
        }
        bf1 = Math.abs(elo) <= Math.abs(ehi) ? lo : hi;
        ok = Math.min(Math.abs(elo), Math.abs(ehi)) < 0.02;
      }
    }
    // on-state slope resistance: VTM is linear in RT at the forced current ITM
    let rt = result.fitted.rt;
    for (let k = 0; k < 3; k++) {
      const v = measure('vtm', scrModel(values, name, { ...base, bf1, rt }, result.notes));
      if (v === undefined) break;
      rt = Math.max(1e-6, rt + (vtm - v) / itm);
    }
    const out = scrModel(values, name, { ...base, bf1, rt }, result.notes);
    return ok ? out : { ...out, notes: [...out.notes, { id: 'ihApprox', level: 'warn' }] };
  },
  checks(values, result) {
    const igt = need(values, 'igt');
    const ih = need(values, 'ih');
    const out: MakerCheck[] = [];
    // gate trigger: anode 12 V through a load that gives ~4·IH (and at least 20 mA) once on
    const ion = Math.max(4 * ih, 20e-3);
    const rl = 12 / ion;
    const trig = bench(result, ['a', '0', 'g'], [V('VAA', 's', '0', { dc: 12 }), R('RL', 's', 'a', rl), I('IG', '0', 'g', { dc: 0 })], [{ type: 'dc', src: 'IG', start: 0, stop: 3 * igt, step: igt / 400 }]);
    const jump = (r: Parameters<MakerCheck['measure']>[0]) => {
      const x = scale(r, 0);
      const ia = vec(r, 0, 'I(VAA)');
      const k = Array.from(ia).findIndex((v) => Math.abs(v) > ion / 2);
      if (k <= 0) throw new Error('the SCR did not trigger');
      return k;
    };
    out.push({ id: 'igt', params: {}, target: igt, unit: 'A', tol: 0.1, netlist: trig, measure: (r) => scale(r, 0)[jump(r) - 1] });
    out.push({ id: 'vgt', params: {}, target: need(values, 'vgt'), unit: 'V', tol: 0.05, netlist: trig, measure: (r) => vec(r, 0, 'V(g)')[jump(r) - 1] });
    // holding: anode fed by a current that starts at 4·IH and ramps down to 0 (1 kΩ in parallel
    // gives the blocking state somewhere to go); a gate pulse turns the SCR on first. IH is the
    // device current just before the anode voltage jumps up (turn-off).
    const i0 = 4 * ih;
    const t1 = 200e-6;
    const t2 = t1 + 2e-3;
    const rp = 1e3;
    const iForced = (t: number) => (t <= t1 ? i0 : t >= t2 ? 0 : i0 * (1 - (t - t1) / (t2 - t1)));
    out.push({
      id: 'ih',
      params: {},
      target: ih,
      unit: 'A',
      tol: 0.1,
      netlist: bench(
        result,
        ['a', '0', 'g'],
        [
          { type: 'I', name: 'IA', nodes: ['0', 'a'], params: {}, source: { dc: i0, tran: { type: 'PWL', args: [0, i0, t1, i0, t2, 0, t2 + 1e-4, 0] } } },
          R('RP', 'a', '0', rp),
          { type: 'I', name: 'IG', nodes: ['0', 'g'], params: {}, source: { dc: 0, tran: { type: 'PULSE', args: [0, 3 * igt, 10e-6, 1e-6, 1e-6, 80e-6, 1] } } },
        ],
        [{ type: 'tran', tstep: 1e-6, tstop: t2 + 5e-5, tmax: 1e-6 }],
      ),
      measure: (r) => {
        const t = scale(r, 0);
        const va = vec(r, 0, 'V(a)');
        let on = false;
        for (let i = 1; i < t.length; i++) {
          if (!on && t[i] > 100e-6 && va[i] < 3) on = true;
          if (on && t[i] > t1 && va[i] > 3) return iForced(t[i - 1]) - va[i - 1] / rp;
        }
        throw new Error(on ? 'the SCR did not turn off' : 'the SCR did not trigger');
      },
    });
    const itm = need(values, 'itm');
    out.push({
      id: 'vtm',
      params: { i: sig(itm) },
      target: need(values, 'vtm'),
      unit: 'V',
      tol: 0.03,
      netlist: bench(result, ['a', '0', 'g'], [I('IA', '0', 'a', { dc: itm }), I('IG', '0', 'g', { dc: 5 * igt })], [{ type: 'op' }]),
      measure: (r) => last(vec(r, 0, 'V(a)')),
    });
    return out;
  },
};
