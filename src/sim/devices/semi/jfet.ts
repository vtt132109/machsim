/**
 * Junction field-effect transistor — element 'J', model types NJF / PJF (SPICE level 1,
 * Shichman-Hodges with the "B" doping-tail extension). Shared FET machinery: fet.ts.
 *
 * Nodes: [drain, gate, source]. Instance params: area (1), m (parallel count, multiplies
 * area), off, ic_vds / ic_vgs (UIC, aliases icvds / icvgs), temp (°C), dtemp (°C).
 *
 * Model parameters (SPICE3 defaults): VTO(VT0) -2, BETA 1e-4, LAMBDA 0, RD 0, RS 0, CGS 0,
 * CGD 0, PB 1, IS 1e-14, B 1, KF 0, AF 1, FC 0.5, TNOM;
 * extensions: N 1 (gate emission coefficient), M 0.5 (gate junction grading), EG 1.11, XTI 0
 * (SPICE3 has no XTI term), VTOTC 0 / TCV 0 (VTO(T) = VTO + (VTOTC - TCV)*(T - Tnom)),
 * BETATCE 0 (BETA(T) = BETA*1.01^(BETATCE*(T-Tnom))), BEX 0 (BETA*(T/Tnom)^BEX).
 *
 * Channel current (device polarity, vgst = vgs - VTO, normal mode vds >= 0):
 *   vgst <= 0             Id = 0
 *   0 < vds <= vgst       Id = BETA(1+LAMBDA vds) * vds*(vds*(Bf*vds - B) + vgst*(2B + 3Bf(vgst - vds)))
 *   vds > vgst            Id = BETA(1+LAMBDA vds) * vgst^2 * (B + Bf*vgst)
 *   with Bf = (1 - B)/(PB - VTO); B = 1 gives the classic BETA*vgst^2 law.
 * Gate junctions: IS (N), CGS / CGD depletion charges with grading M and FC.
 * Temperature: IS (EG, XTI, N), PB / CGS / CGD (SPICE3 junction formulas), VTO, BETA.
 * Internal nodes "<name>#d" / "<name>#s" when RD / RS > 0.
 * Outputs: Id, Ig, Is (currents INTO the terminals), P.
 */

import type { Device } from '../../device';
import type { ElementIR } from '../../netlist';
import { GateJunctionFet, type ChannelOut, type FetFlavor, type FetTemp } from './fet';
import { K_OVER_Q, depletionCoeffs, junctionTemperature, junctionVcrit, satCurrentFactor } from './common';

export const JFET_DEFAULTS = {
  vto: -2,
  beta: 1e-4,
  lambda: 0,
  rd: 0,
  rs: 0,
  cgs: 0,
  cgd: 0,
  pb: 1,
  is: 1e-14,
  n: 1,
  b: 1,
  m: 0.5,
  kf: 0,
  af: 1,
  fc: 0.5,
  eg: 1.11,
  xti: 0,
  vtotc: 0,
  tcv: 0,
  betatce: 0,
  bex: 0,
  tnom: Number.NaN,
} as const;

export type JfetParam = keyof typeof JFET_DEFAULTS;

export const JFET_ALIASES: Readonly<Record<string, JfetParam>> = {
  vt0: 'vto',
  tref: 'tnom',
  t_measured: 'tnom',
};

/** Normal-mode JFET channel law (see module comment). */
export function jfetChannel(vgst: number, vds: number, t: FetTemp, out: ChannelOut): void {
  if (vgst <= 0) {
    out.i = 0;
    out.dg = 0;
    out.dd = 0;
    return;
  }
  const B = t.b;
  const betap = t.beta * (1 + t.lambda * vds);
  if (vgst >= vds) {
    const apart = 2 * B + 3 * t.bfac * (vgst - vds);
    const cpart = vds * (vds * (t.bfac * vds - B) + vgst * apart);
    out.i = betap * cpart;
    out.dg = betap * vds * (apart + 3 * t.bfac * vgst);
    out.dd = betap * (vgst - vds) * apart + t.beta * t.lambda * cpart;
  } else {
    const bf = vgst * t.bfac;
    const cpart = vgst * vgst * (B + bf);
    out.i = betap * cpart;
    out.dg = betap * vgst * (2 * B + 3 * bf);
    out.dd = t.lambda * t.beta * cpart;
  }
}

export const JFET_FLAVOR: FetFlavor<JfetParam> = {
  elementType: 'J',
  label: 'JFET',
  modelTypes: ['NJF', 'PJF'],
  defaults: JFET_DEFAULTS,
  aliases: JFET_ALIASES,
  ignored: new Set(['level', 't_abs', 't_rel_global', 't_rel_local']),
  temps(p, T, tnom, area): FetTemp {
    const vt = K_OVER_Q * T;
    const n = p.n > 0 ? p.n : 1;
    const dT = T - tnom;
    const pb = p.pb > 0 ? p.pb : 1;
    const jt = junctionTemperature(pb, p.m, tnom, T);
    const isat = p.is * satCurrentFactor(T, tnom, p.eg, p.xti, n) * area;
    return {
      T,
      vt,
      nvt: n * vt,
      isat,
      vto: p.vto + (p.vtotc - p.tcv) * dT,
      gd: p.rd > 0 ? area / p.rd : 0,
      gs: p.rs > 0 ? area / p.rs : 0,
      depGs: depletionCoeffs(p.cgs * jt.capFactor * area, jt.pot, p.m, p.fc),
      depGd: depletionCoeffs(p.cgd * jt.capFactor * area, jt.pot, p.m, p.fc),
      vcrit: junctionVcrit(n * vt, isat),
      beta: p.beta * Math.pow(1.01, p.betatce * dT) * Math.pow(T / tnom, p.bex) * area,
      lambda: p.lambda,
      b: p.b,
      // doping-tail factor from the nominal PB and VTO (model-level constant)
      bfac: Math.abs(pb - p.vto) > 1e-12 ? (1 - p.b) / (pb - p.vto) : 0,
      alpha: 0,
    };
  },
  channel: jfetChannel,
};

export class Jfet extends GateJunctionFet<JfetParam> {
  constructor(el: ElementIR) {
    super(el, JFET_FLAVOR);
  }
}

export function createJfet(el: ElementIR): Device {
  return new Jfet(el);
}
