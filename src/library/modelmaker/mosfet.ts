/**
 * MOSFET model maker (`.model <name> NMOS|PMOS`, SPICE level 1 or level 3) from datasheet values.
 *
 * Equations (device polarity, W = L = 100 µm defaults so BETA = KP; Vov = VGS' − VTO):
 *   saturation  ID = KP/2·Vov²·(1 + λ·VDS) / (1 + θ·Vov)
 *   triode      ID = KP·(Vov − VDS'/2)·VDS'·(1 + λ·VDS) / (1 + θ·Vov)
 * (level 1: θ = 0; level 3 with THETA and no NSUB / VMAX / ETA: λ = 0), with VGS' = VGS − ID·RS and
 * VDS' = VDS − ID·(RS + RD). Fit, in order of importance:
 *   VTO  from VGS(th) at ID(th) with drain tied to gate;
 *   KP   with the forward transconductance gfs at ID(g) and RDS(on) at VGS(on), ID(on):
 *        level 1 — if the channel resistance implied by gfs is below RDS(on), RS = 0 and RD carries
 *        the rest (typical power MOSFET); otherwise RD = 0 and RS degenerates gm (gfs = gm/(1 + gm·RS));
 *        level 3 — mobility degradation THETA takes the role of RD when possible;
 *        without gfs: KP from RDS(on) alone;
 *   CGDO = Crss/W, CGSO = (Ciss − Crss)/W, CBD = (Coss − Crss)·(1 + VDS/PB)^MJ at the test VDS.
 * Benches: VGS(th) sweep (diode-connected), RDS(on) with a forced drain current, gfs as the slope of
 * a VGS sweep at fixed VDS, Ciss / Crss / Coss from AC currents at 1 MHz.
 */
import { MakerInputError, type MakerCheck, type MakerDef, type MakerNote } from './types';
import { I, V, bench, bisect, choice, crossing, header, last, modelCard, need, num, opt, scale, vec, vecIm, sig } from './common';

const W = 100e-6;
const PB = 0.8;
const MJ = 0.5;

interface Mos {
  kp: number;
  vto: number;
  theta: number;
  lambda: number;
  rs: number;
  rd: number;
}

/** Overdrive Vov at saturation current `id` (internal; g = 1 + λ·VDS'). */
function vovSat(p: Mos, id: number, g: number): number {
  const a = (p.kp * g) / 2;
  return (id * p.theta + Math.sqrt(id * id * p.theta * p.theta + 4 * a * id)) / (2 * a);
}

/** VTO from VGS(th) at ID(th) with drain tied to gate (saturation). */
function vtoFor(p: Mos, vth: number, idth: number): number {
  const vdsInt = vth - idth * (p.rs + p.rd);
  return vth - idth * p.rs - vovSat(p, idth, 1 + p.lambda * vdsInt);
}

/** Model drain current at terminal VGS / VDS (triode) for the RDS(on) point, minus the target. */
function ronResidual(p: Mos, vgs: number, id: number, rdson: number): number {
  const vds = id * rdson;
  const vdsInt = vds - id * (p.rs + p.rd);
  if (vdsInt <= 0) return -id;
  const vov = vgs - id * p.rs - p.vto;
  if (vov <= 0) return -id;
  const x = Math.min(vdsInt, vov);
  const model = (p.kp * (vov - x / 2) * x * (1 + p.lambda * vdsInt)) / (1 + p.theta * vov);
  return model - id;
}

/** Terminal transconductance at saturation current `id`, terminal VDS. */
function gfsModel(p: Mos, id: number, vds: number): number {
  const g = 1 + p.lambda * (vds - id * (p.rs + p.rd));
  const vov = vovSat(p, id, g);
  const gm = (p.kp * g * vov * (2 + p.theta * vov)) / (2 * (1 + p.theta * vov) ** 2);
  return gm / (1 + gm * p.rs);
}

export const mosfetMaker: MakerDef = {
  id: 'mosfet',
  terminals: ['D', 'G', 'S', 'B'],
  template: 'nmos',
  prefix: 'Q',
  group: 'transistors',
  family: 'N-channel MOSFET',
  fields: [
    { key: 'type', unit: '', default: 'nmos', kind: 'select', options: ['nmos', 'pmos'], section: 'basic' },
    { key: 'level', unit: '', default: '1', kind: 'select', options: ['1', '3'], section: 'basic' },
    { key: 'vth', unit: 'V', default: '2.1', section: 'basic' },
    { key: 'idth', unit: 'A', default: '250u', section: 'basic' },
    { key: 'rdson', unit: 'Ω', default: '1.2', section: 'basic' },
    { key: 'vgson', unit: 'V', default: '10', section: 'basic' },
    { key: 'idon', unit: 'A', default: '500m', section: 'basic' },
    { key: 'gfs', unit: 'S', default: '0.3', optional: true, section: 'basic' },
    { key: 'idg', unit: 'A', default: '200m', optional: true, section: 'basic' },
    { key: 'vdsg', unit: 'V', default: '10', optional: true, section: 'basic' },
    { key: 'ciss', unit: 'F', default: '50p', optional: true, section: 'advanced' },
    { key: 'coss', unit: 'F', default: '25p', optional: true, section: 'advanced' },
    { key: 'crss', unit: 'F', default: '5p', optional: true, section: 'advanced' },
    { key: 'vdsc', unit: 'V', default: '25', optional: true, section: 'advanced' },
    { key: 'lambda', unit: '1/V', default: '0.01', optional: true, positive: false, section: 'advanced' },
  ],
  variant: (values) => (choice(values, 'type', 'nmos') === 'pmos' ? { template: 'pmos', family: 'P-channel MOSFET' } : { template: 'nmos', family: 'N-channel MOSFET' }),
  fit(values, name) {
    const pch = choice(values, 'type', 'nmos') === 'pmos';
    const level = choice(values, 'level', '1') === '3' ? 3 : 1;
    const vth = need(values, 'vth');
    const idth = need(values, 'idth');
    const rdson = need(values, 'rdson');
    const vgson = need(values, 'vgson');
    const idon = need(values, 'idon');
    if (vgson <= vth) throw new MakerInputError('vgsBelowVth');
    const gfs = opt(values, 'gfs');
    const idg = opt(values, 'idg');
    const vdsg = opt(values, 'vdsg') ?? 10;
    const notes: MakerNote[] = [];
    const p: Mos = { kp: 1, vto: vth, theta: 0, lambda: level === 3 ? 0 : (opt(values, 'lambda') ?? 0), rs: 0, rd: 0 };
    const setVto = () => {
      p.vto = vtoFor(p, vth, idth);
    };
    /** KP so that RDS(on) matches with the current RS / RD / θ (VTO follows VGS(th)). */
    const kpFromRon = (): boolean => {
      const f = (kp: number) => {
        p.kp = kp;
        setVto();
        return ronResidual(p, vgson, idon, rdson);
      };
      const kp = bisect(f, 1e-6, 1e6, { log: true, iter: 200 });
      if (kp === undefined) return false;
      p.kp = kp;
      setVto();
      return true;
    };
    let gfsFitted = false;
    if (gfs !== undefined && idg !== undefined) {
      if (level === 3) {
        // θ in place of RD: KP from RDS(on) for each θ, θ so that gfs matches
        const f = (theta: number) => {
          p.theta = theta;
          return kpFromRon() ? gfsModel(p, idg, vdsg) - gfs : NaN;
        };
        if (f(0) < 0) {
          const th = bisect(f, 0, 20, { iter: 150 });
          if (th !== undefined) {
            p.theta = th;
            gfsFitted = kpFromRon();
          }
        }
        if (!gfsFitted) p.theta = 0;
      }
      if (!gfsFitted) {
        // case A: channel KP from gfs (RS = 0), RD makes up the rest of RDS(on)
        p.rs = 0;
        p.rd = 0;
        const fa = (kp: number) => {
          p.kp = kp;
          setVto();
          return gfsModel(p, idg, vdsg) - gfs;
        };
        const kpA = bisect(fa, 1e-6, 1e6, { log: true, iter: 200 });
        if (kpA !== undefined) {
          p.kp = kpA;
          setVto();
          // channel alone conducts more than RDS(on) asks for: series RD
          if (ronResidual(p, vgson, idon, rdson) >= 0) {
            const fr = (rd: number) => {
              p.rd = rd;
              setVto();
              return ronResidual(p, vgson, idon, rdson);
            };
            const rd = bisect(fr, 0, rdson, { iter: 200 });
            if (rd !== undefined) {
              p.rd = rd;
              setVto();
              gfsFitted = true;
            }
          }
        }
      }
      if (!gfsFitted) {
        // case B: RD = 0, RS degenerates gm (gfs = gm / (1 + gm·RS))
        p.rd = 0;
        const fb = (rs: number) => {
          p.rs = rs;
          return kpFromRon() ? gfsModel(p, idg, vdsg) - gfs : NaN;
        };
        const rs = fb(0) > 0 ? bisect(fb, 0, Math.min(rdson * 0.999, 1 / gfs), { iter: 150 }) : undefined;
        if (rs !== undefined) {
          p.rs = rs;
          gfsFitted = kpFromRon();
        }
        if (!gfsFitted) {
          p.rs = 0;
          if (!kpFromRon()) throw new MakerInputError('rdsonFit');
          notes.push({ id: 'gfsIgnored', params: { gfs: num(gfsModel(p, idg, vdsg)) }, level: 'warn' });
        }
      }
    } else {
      if (!kpFromRon()) throw new MakerInputError('rdsonFit');
      notes.push({ id: 'noGfs', level: 'info' });
    }
    const params: Record<string, number> = { level, vto: pch ? -p.vto : p.vto, kp: p.kp };
    if (level === 1) params.lambda = p.lambda;
    if (level === 3) {
      params.theta = p.theta;
      // level 3 defaults TOX to 100 nm (Meyer gate capacitance): a thick oxide leaves only the
      // datasheet capacitances below, KP is given explicitly
      params.tox = 1e-4;
    }
    if (p.rd > 0) params.rd = p.rd;
    if (p.rs > 0) params.rs = p.rs;
    const ciss = opt(values, 'ciss');
    const crss = opt(values, 'crss');
    const coss = opt(values, 'coss');
    const vdsc = opt(values, 'vdsc') ?? 25;
    if (crss !== undefined) params.cgdo = crss / W;
    if (ciss !== undefined) params.cgso = Math.max(0, ciss - (crss ?? 0)) / W;
    if (coss !== undefined) {
      params.cbd = Math.max(0, coss - (crss ?? 0)) * Math.pow(1 + vdsc / PB, MJ);
      params.pb = PB;
      params.mj = MJ;
    }
    params.is = 1e-14;
    const text = `${header('mosfet', mosfetMaker.fields, values)}\n${modelCard(name, pch ? 'PMOS' : 'NMOS', params)}\n`;
    return { model: { kind: 'spice', text, name }, fitted: params, notes };
  },
  checks(values, result) {
    const pch = choice(values, 'type', 'nmos') === 'pmos';
    const s = pch ? -1 : 1;
    // sources are reversed for P-channel so every swept value stays positive
    const vsrc = (n: string, node: string, dc: number, ac?: number) => (pch ? V(n, '0', node, { dc, ...(ac ? { acMag: ac } : {}) }) : V(n, node, '0', { dc, ...(ac ? { acMag: ac } : {}) }));
    const out: MakerCheck[] = [];
    const vth = need(values, 'vth');
    const idth = need(values, 'idth');
    out.push({
      id: 'vth',
      params: { i: sig(idth) },
      target: vth,
      unit: 'V',
      tol: 0.02,
      absTol: 0.01,
      netlist: bench(result, ['g', 'g', '0', '0'], [vsrc('VG', 'g', 0)], [{ type: 'dc', src: 'VG', start: 0, stop: vth + 3, step: 0.0005 }]),
      measure: (r) => {
        const v = crossing(scale(r, 0), Array.from(vec(r, 0, 'I(VG)'), Math.abs), idth);
        if (v === undefined) throw new Error('threshold current not reached');
        return v;
      },
    });
    const rdson = need(values, 'rdson');
    const idon = need(values, 'idon');
    out.push({
      id: 'rdson',
      params: { v: sig(need(values, 'vgson')), i: sig(idon) },
      target: rdson,
      unit: 'Ω',
      tol: 0.03,
      netlist: bench(result, ['d', 'g', '0', '0'], [vsrc('VG', 'g', need(values, 'vgson')), I('ID', s > 0 ? '0' : 'd', s > 0 ? 'd' : '0', { dc: idon })], [{ type: 'op' }]),
      measure: (r) => Math.abs(last(vec(r, 0, 'V(d)'))) / idon,
    });
    const gfs = opt(values, 'gfs');
    const idg = opt(values, 'idg');
    if (gfs !== undefined && idg !== undefined && !result.notes.some((n) => n.id === 'gfsIgnored')) {
      const vdsg = opt(values, 'vdsg') ?? 10;
      out.push({
        id: 'gfs',
        params: { i: sig(idg) },
        target: gfs,
        unit: 'S',
        tol: 0.05,
        netlist: bench(result, ['d', 'g', '0', '0'], [vsrc('VD', 'd', vdsg), vsrc('VG', 'g', 0)], [{ type: 'dc', src: 'VG', start: 0, stop: vth + 20, step: 0.0005 }]),
        measure: (r) => {
          const x = scale(r, 0);
          const id = Array.from(vec(r, 0, 'I(VD)'), Math.abs);
          const v = crossing(x, id, idg);
          if (v === undefined) throw new Error('drain current not reached');
          const k = x.findIndex((t) => t >= v);
          return (id[k] - id[k - 1]) / (x[k] - x[k - 1]);
        },
      });
    }
    const vdsc = opt(values, 'vdsc') ?? 25;
    const f = 1e6;
    const w = 2 * Math.PI * f;
    const ciss = opt(values, 'ciss');
    const crss = opt(values, 'crss');
    const coss = opt(values, 'coss');
    if (ciss !== undefined)
      out.push({ id: 'ciss', params: { v: sig(vdsc) }, target: ciss, unit: 'F', tol: 0.03, netlist: bench(result, ['d', 'g', '0', '0'], [vsrc('VD', 'd', vdsc), vsrc('VG', 'g', 0, 1)], [{ type: 'acsingle', freq: f }]), measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VG)'))) / w });
    if (crss !== undefined)
      out.push({ id: 'crss', params: { v: sig(vdsc) }, target: crss, unit: 'F', tol: 0.03, netlist: bench(result, ['d', 'g', '0', '0'], [vsrc('VD', 'd', vdsc, 1), vsrc('VG', 'g', 0)], [{ type: 'acsingle', freq: f }]), measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VG)'))) / w });
    if (coss !== undefined)
      out.push({ id: 'coss', params: { v: sig(vdsc) }, target: coss, unit: 'F', tol: 0.03, netlist: bench(result, ['d', 'g', '0', '0'], [vsrc('VD', 'd', vdsc, 1), vsrc('VG', 'g', 0)], [{ type: 'acsingle', freq: f }]), measure: (r) => Math.abs(last(vecIm(r, 0, 'I(VD)'))) / w });
    return out;
  },
};
