/**
 * GaAs MESFET — element 'Z', model types NMF / PMF (Statz et al. model, SPICE3 level 1).
 * Shared FET machinery (gate junctions, series resistances, limiting, charges): fet.ts.
 *
 * Nodes: [drain, gate, source]. Instance params: area (1), m, off, ic_vds / ic_vgs, temp, dtemp.
 * Model parameters (SPICE3 defaults): VTO -2, BETA 2.5e-3, B 0.3, ALPHA 2, LAMBDA 0, RD 0, RS 0,
 * CGS 0, CGD 0, PB 1, IS 1e-14, FC 0.5, KF 0, AF 1, TNOM; extensions N 1 (gate emission
 * coefficient), M 0.5 (gate junction grading).
 *
 * Channel current (device polarity, vgst = vgs - VTO, normal mode vds >= 0):
 *   vgst <= 0           Id = 0
 *   vds <  3/ALPHA      Id = BETA(1+LAMBDA vds) vgst^2/(1 + B vgst) * (1 - (1 - ALPHA vds/3)^3)
 *   vds >= 3/ALPHA      Id = BETA(1+LAMBDA vds) vgst^2/(1 + B vgst)
 * As in SPICE3 the model has no temperature dependence apart from the thermal voltage of the
 * gate junctions.
 * Internal nodes "<name>#d" / "<name>#s" when RD / RS > 0.
 * Outputs: Id, Ig, Is (currents INTO the terminals), P.
 */

import type { Device } from '../../device';
import type { ElementIR } from '../../netlist';
import { GateJunctionFet, type ChannelOut, type FetFlavor, type FetTemp } from './fet';
import { K_OVER_Q, depletionCoeffs, junctionVcrit } from './common';

export const MESFET_DEFAULTS = {
  vto: -2,
  beta: 2.5e-3,
  b: 0.3,
  alpha: 2,
  lambda: 0,
  rd: 0,
  rs: 0,
  cgs: 0,
  cgd: 0,
  pb: 1,
  is: 1e-14,
  n: 1,
  m: 0.5,
  fc: 0.5,
  kf: 0,
  af: 1,
  tnom: Number.NaN,
} as const;

export type MesfetParam = keyof typeof MESFET_DEFAULTS;

export const MESFET_ALIASES: Readonly<Record<string, MesfetParam>> = {
  vt0: 'vto',
  tref: 'tnom',
};

/** Normal-mode Statz channel law (see module comment). */
export function statzChannel(vgst: number, vds: number, t: FetTemp, out: ChannelOut): void {
  if (vgst <= 0) {
    out.i = 0;
    out.dg = 0;
    out.dd = 0;
    return;
  }
  const prod = 1 + t.lambda * vds;
  const betap = t.beta * prod;
  const denom = 1 + t.b * vgst;
  const inv = 1 / denom;
  const core = vgst * vgst * inv;
  const dcore = vgst * (1 + denom) * inv * inv;
  if (t.alpha <= 0 || vds >= 3 / t.alpha) {
    out.i = betap * core;
    out.dg = betap * dcore;
    out.dd = t.lambda * t.beta * core;
  } else {
    const afact = 1 - (t.alpha * vds) / 3;
    const lfact = 1 - afact * afact * afact;
    out.i = betap * core * lfact;
    out.dg = betap * dcore * lfact;
    out.dd = t.beta * core * (t.alpha * afact * afact * prod + lfact * t.lambda);
  }
}

export const MESFET_FLAVOR: FetFlavor<MesfetParam> = {
  elementType: 'Z',
  label: 'MESFET',
  modelTypes: ['NMF', 'PMF'],
  defaults: MESFET_DEFAULTS,
  aliases: MESFET_ALIASES,
  ignored: new Set(['level']),
  temps(p, T, _tnom, area): FetTemp {
    const vt = K_OVER_Q * T;
    const n = p.n > 0 ? p.n : 1;
    const pb = p.pb > 0 ? p.pb : 1;
    const isat = p.is * area;
    return {
      T,
      vt,
      nvt: n * vt,
      isat,
      vto: p.vto,
      gd: p.rd > 0 ? area / p.rd : 0,
      gs: p.rs > 0 ? area / p.rs : 0,
      depGs: depletionCoeffs(p.cgs * area, pb, p.m, p.fc),
      depGd: depletionCoeffs(p.cgd * area, pb, p.m, p.fc),
      vcrit: junctionVcrit(n * vt, isat),
      beta: p.beta * area,
      lambda: p.lambda,
      b: Math.max(p.b, 0),
      bfac: 0,
      alpha: p.alpha,
    };
  },
  channel: statzChannel,
};

export class Mesfet extends GateJunctionFet<MesfetParam> {
  constructor(el: ElementIR) {
    super(el, MESFET_FLAVOR);
  }
}

export function createMesfet(el: ElementIR): Device {
  return new Mesfet(el);
}
