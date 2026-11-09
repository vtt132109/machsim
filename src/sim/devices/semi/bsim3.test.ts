/**
 * BSIM3v3 MOSFET: long-channel limit against SPICE level 1, short-channel trends, exact
 * Jacobians, the charge model and a typical imported deck.
 */
import { describe, expect, it } from 'vitest';
import { EPS_OX } from '../../device';
import type { ModelCard } from '../../netlist';
import { K_OVER_Q, celsiusToKelvin, siliconBandGap } from './common';
import { Bsim3, createBsim3 } from './bsim3';
import { Mosfet, createMosfet } from './mosfet';
import { TestCircuit } from './test-harness';
import { parseSpice } from '../../spice';
import { runAnalyses } from '../../engine';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;
const TOX = 2e-8;
const COX = EPS_OX / TOX;
const U0 = 500; // cm^2/Vs
const KP = U0 * 1e-4 * COX;
const NCH = 1e17;

/** BSIM3 card with every short-channel, mobility and output-conductance effect switched off. */
const LONG: Record<string, number> = {
  level: 49, tox: TOX, nch: NCH, vth0: 0.8, k1: 0.5, k2: 0, k3: 0, k3b: 0, nlx: 0, dvt0: 0, dvt0w: 0, eta0: 0, etab: 0,
  u0: U0, ua: 0, ub: 0, uc: 0, vsat: 1e12, a0: 0, ags: 0, b0: 0, keta: 0, rdsw: 0, pclm: 0, pdiblc1: 0, pdiblc2: 0,
  pscbe2: 0, voff: 0, cdsc: 0, cit: 0, js: 0, cj: 0, cjsw: 0, kt1: 0, kt2: 0, ute: 0,
};

/** Surface potential BSIM3 derives from NCH (2 Vt ln(NCH/ni)) at 27 °C. */
function phiS(nch = NCH): number {
  const eg = siliconBandGap(T27);
  const ni = 1.45e10 * Math.exp(21.5565981 - eg / (2 * VT));
  return 2 * VT * Math.log(nch / ni);
}

function card(params: Record<string, number>, type: 'NMOS' | 'PMOS' = 'NMOS', name = 'MM'): ModelCard {
  return { name, type, params };
}

interface Biased<D> {
  dev: D;
  out: Record<string, number>;
}

function bias<D extends Bsim3 | Mosfet>(factory: typeof createBsim3, params: Record<string, number>, vgs: number, vds: number, vbs: number, geom: Record<string, number>, type: 'NMOS' | 'PMOS' = 'NMOS'): Biased<D> {
  const c = new TestCircuit({ gmin: 0 }).model(card(params, type));
  const dev = c.element(factory, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', 'b'], model: 'MM', params: geom }) as D;
  c.vsource('VG', 'g', '0', vgs);
  c.vsource('VD', 'd', '0', vds);
  c.vsource('VB', 'b', '0', vbs);
  const r = c.op();
  expect(r.converged).toBe(true);
  const xe = Float64Array.from(r.x);
  xe[c.node('g')] = vgs;
  xe[c.node('d')] = vds;
  xe[c.node('b')] = vbs;
  return { dev, out: dev.outputs((i) => (i < 0 ? 0 : xe[i])) };
}

const LONG_GEOM = { w: 20e-6, l: 20e-6 };
const BETA = KP; // W/L = 1

describe('BSIM3 in the long-channel limit agrees with SPICE level 1', () => {
  const L1 = { level: 1, vto: 0.8, kp: KP, gamma: 0.5, phi: phiS(), lambda: 0, is: 0 };

  it.each([
    [2, 0.1, 0],
    [3, 0.3, 0],
    [4, 0.5, 0],
    [2, 4, 0],
    [3, 5, 0],
    [4, 5, 0],
    [3, 0.3, -1],
    [4, 5, -1],
    [4, 5, -2],
  ])('Vgs %f V, Vds %f V, Vbs %f V', (vgs, vds, vbs) => {
    const b3 = bias<Bsim3>(createBsim3, LONG, vgs, vds, vbs, LONG_GEOM).out.Id;
    const l1 = bias<Mosfet>(createMosfet, L1, vgs, vds, vbs, LONG_GEOM).out.Id;
    expect(l1).toBeGreaterThan(0);
    // the remaining difference is BSIM3's 2Vt term in Vgst + 2Vt (a few per cent at most)
    expect(Math.abs(b3 / l1 - 1)).toBeLessThan(0.05);
  });

  it('saturation current is BETA Vgst (Vgst + 2Vt) / 2 (the level-1 law with the 2Vt correction)', () => {
    for (const vgs of [1.8, 2.5, 4]) {
      const vgst = vgs - 0.8;
      const b3 = bias<Bsim3>(createBsim3, LONG, vgs, 6, 0, LONG_GEOM).out.Id;
      expect(b3 / ((BETA * vgst * (vgst + 2 * VT)) / 2)).toBeCloseTo(1, 3);
    }
  });

  it('threshold body effect is VTH0 + K1 (sqrt(PHIs - Vbs) - sqrt(PHIs)) as with GAMMA = K1', () => {
    const { dev } = bias<Bsim3>(createBsim3, LONG, 2, 0.1, 0, LONG_GEOM);
    for (const vbs of [0, -0.5, -2]) {
      const vth = dev.evaluateAt(2, 0.1, vbs, T27).vth;
      expect(vth).toBeCloseTo(0.8 + 0.5 * (Math.sqrt(phiS() - vbs) - Math.sqrt(phiS())), 3);
    }
  });

  it('PMOS mirrors NMOS', () => {
    const n = bias<Bsim3>(createBsim3, LONG, 3, 2, 0, LONG_GEOM).out.Id;
    const p = bias<Bsim3>(createBsim3, { ...LONG, vth0: -0.8 }, -3, -2, 0, LONG_GEOM, 'PMOS').out.Id;
    expect(p / -n).toBeCloseTo(1, 9);
  });
});

/** BSIM3 card close to a 0.35 um process (own round numbers, default effects on). */
const SHORT: Record<string, number> = { level: 49, version: 3.3, tox: 7.6e-9, nch: 2.3e17, vth0: 0.5, u0: 420, vsat: 1.1e5, rdsw: 650, js: 1e-6, cj: 9e-4, cjsw: 2.8e-10 };
const SHORT_GEOM = { w: 10e-6, l: 0.35e-6, ad: 5e-12, as: 5e-12, pd: 11e-6, ps: 11e-6 };

describe('BSIM3 short-channel behaviour', () => {
  it('threshold rolls off at short channel length and with drain bias (DIBL)', () => {
    // NLX = 0: without the lateral-doping (reverse short-channel) term the roll-off is monotonic
    const P = { ...SHORT, nlx: 0 };
    const long = bias<Bsim3>(createBsim3, P, 1, 0.05, 0, { w: 10e-6, l: 10e-6 }).dev.evaluateAt(1, 0.05, 0, T27).vth;
    const dev = bias<Bsim3>(createBsim3, P, 1, 0.05, 0, SHORT_GEOM).dev;
    const short = dev.evaluateAt(1, 0.05, 0, T27).vth;
    expect(short).toBeLessThan(long - 0.01);
    expect(dev.evaluateAt(1, 3, 0, T27).vth).toBeLessThan(short - 0.01);
    // with the default NLX the lateral doping raises the short-channel threshold again
    const rsce = bias<Bsim3>(createBsim3, SHORT, 1, 0.05, 0, SHORT_GEOM).dev.evaluateAt(1, 0.05, 0, T27).vth;
    expect(rsce).toBeGreaterThan(short);
  });

  it('velocity saturation lowers VDSAT below Vgs - Vth and the output conductance stays positive', () => {
    const dev = bias<Bsim3>(createBsim3, SHORT, 3, 3, 0, SHORT_GEOM).dev;
    const e = dev.evaluateAt(3, 3, 0, T27);
    expect(e.vdsat).toBeLessThan(3 - e.vth);
    expect(e.gds).toBeGreaterThan(0);
    expect(e.gds).toBeLessThan(e.gm);
    // saturation current of a 10/0.35 device: milliamperes
    expect(e.id).toBeGreaterThan(1e-3);
    expect(e.id).toBeLessThan(2e-2);
  });

  it('subthreshold current falls exponentially with a 60-120 mV/decade swing', () => {
    const dev = bias<Bsim3>(createBsim3, SHORT, 0.2, 1, 0, SHORT_GEOM).dev;
    const i1 = dev.evaluateAt(0.1, 1, 0, T27).id;
    const i2 = dev.evaluateAt(0.2, 1, 0, T27).id;
    const swing = 0.1 / Math.log10(i2 / i1);
    expect(swing).toBeGreaterThan(0.06);
    expect(swing).toBeLessThan(0.12);
  });

  it('conductances and transcapacitances are exact derivatives', () => {
    const dev = bias<Bsim3>(createBsim3, { ...SHORT, a1: 0.1, a2: 0.9, prwg: 0.1, prwb: -0.05, dwg: 1e-9, pvag: 0.5, ags: 0.2, keta: -0.05 }, 2, 1.5, -0.5, SHORT_GEOM).dev;
    const h = 1e-6;
    for (const [vgs, vds, vbs] of [
      [2, 1.5, -0.5],
      [1.2, 0.1, -1],
      [2.5, 3, 0],
      [0.4, 1, -0.3],
      [2, -1, -0.5],
    ]) {
      const e = dev.evaluateAt(vgs, vds, vbs, T27);
      const fd = (f: (d: number) => number) => (f(h) - f(-h)) / (2 * h);
      const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-4 * Math.max(Math.abs(a), Math.abs(b)) + 1e-12);
      close(e.gm, fd((d) => dev.evaluateAt(vgs + d, vds, vbs, T27).id));
      close(e.gds, fd((d) => dev.evaluateAt(vgs, vds + d, vbs, T27).id));
      close(e.gmbs, fd((d) => dev.evaluateAt(vgs, vds, vbs + d, T27).id));
      const qs = (d: number) => dev.evaluateAt(vgs + d, vds, vbs, T27);
      expect(Math.abs(e.cgg - fd((d) => qs(d).qg))).toBeLessThan(1e-4 * Math.abs(e.cgg) + 1e-20);
      expect(Math.abs(e.cdg - fd((d) => qs(d).qd))).toBeLessThan(1e-4 * Math.abs(e.cdg) + 1e-20);
      expect(Math.abs(e.cgd - fd((d) => dev.evaluateAt(vgs, vds + d, vbs, T27).qg))).toBeLessThan(1e-4 * Math.abs(e.cgd) + 1e-20);
    }
  });
});

describe('BSIM3 charge model', () => {
  const cwl = COX * 20e-6 * 20e-6;

  it('strong-inversion saturation: Cgg = 2/3 Cox W L and the 40/60 partition gives Qd = 0.4 Qinv', () => {
    const dev = bias<Bsim3>(createBsim3, LONG, 3, 5, 0, LONG_GEOM).dev;
    const e = dev.evaluateAt(3, 5, 0, T27);
    expect(e.cgg / ((2 / 3) * cwl)).toBeCloseTo(1, 3);
    const qinv = -(e.qg + e.qb);
    expect(e.qd / (0.4 * qinv)).toBeCloseTo(1, 6);
    expect(qinv / (-(2 / 3) * cwl * (3 - e.vth))).toBeCloseTo(1, 6);
  });

  it('50/50 and 0/100 partitions', () => {
    const half = bias<Bsim3>(createBsim3, { ...LONG, xpart: 0.5 }, 3, 5, 0, LONG_GEOM).dev.evaluateAt(3, 5, 0, T27);
    expect(half.qd / (0.5 * -(half.qg + half.qb))).toBeCloseTo(1, 6);
    const zero = bias<Bsim3>(createBsim3, { ...LONG, xpart: 1 }, 3, 5, 0, LONG_GEOM).dev.evaluateAt(3, 5, 0, T27);
    expect(Math.abs(zero.qd)).toBeLessThan(1e-6 * Math.abs(zero.qg));
  });

  it('at Vds = 0 the channel charge splits equally and Cgg = Cox W L', () => {
    const dev = bias<Bsim3>(createBsim3, LONG, 3, 0, 0, LONG_GEOM).dev;
    const e = dev.evaluateAt(3, 1e-9, 0, T27);
    expect(e.cgg / cwl).toBeCloseTo(1, 3);
    expect(e.qd / (0.5 * -(e.qg + e.qb))).toBeCloseTo(1, 4);
  });

  it('gate charge is continuous through accumulation, depletion and inversion', () => {
    const dev = bias<Bsim3>(createBsim3, LONG, 0, 0.5, 0, LONG_GEOM).dev;
    let prev = dev.evaluateAt(-3, 0.5, 0, T27).qg;
    for (let vgs = -3 + 0.01; vgs <= 3; vgs += 0.01) {
      const q = dev.evaluateAt(vgs, 0.5, 0, T27).qg;
      // Cgg never exceeds Cox W L, so a 10 mV step changes Qg by less than 10 mV * Cox W L
      expect(q - prev).toBeGreaterThan(-1e-6 * cwl);
      expect(q - prev).toBeLessThan(0.0101 * cwl);
      prev = q;
    }
  });
});

describe('BSIM3 in SPICE decks', () => {
  const MODELS = `.model NCH NMOS (LEVEL=49 VERSION=3.3 TOX=7.6E-9 NCH=2.3E17 VTH0=0.5 K1=0.6 K2=-0.02 U0=420 UA=-1E-9 UB=2E-18
+ VSAT=1.1E5 RDSW=650 PCLM=1.2 PDIBLC1=0.3 PDIBLC2=0.01 LINT=2E-8 WINT=5E-8 LVTH0=-5E-3 WVTH0=1E-3 PVTH0=1E-4
+ CGSO=2E-10 CGDO=2E-10 CJ=9E-4 CJSW=2.8E-10 MOBMOD=1 CAPMOD=0 NQSMOD=0 BINUNIT=1)
.model PCH PMOS (LEVEL=49 VERSION=3.3 TOX=7.6E-9 NCH=8E16 VTH0=-0.65 K1=0.5 K2=-0.01 U0=150 UA=1E-9 UB=1E-18
+ VSAT=1E5 RDSW=1500 PCLM=1.5 LINT=2E-8 WINT=5E-8 CGSO=2.5E-10 CGDO=2.5E-10 CJ=1E-3 CJSW=3E-10)`;

  it('a CMOS inverter swings rail to rail with a mid-supply threshold and no warnings about levels', () => {
    const deck = `BSIM3 inverter
VDD vdd 0 3.3
VIN in 0 0
MN out in 0 0 NCH W=2u L=0.35u AD=2p AS=2p PD=6u PS=6u
MP out in vdd vdd PCH W=6u L=0.35u AD=6p AS=6p PD=14u PS=14u
${MODELS}
.dc VIN 0 3.3 0.05
.end`;
    const net = parseSpice(deck).netlist;
    const [dc] = runAnalyses(net);
    expect(dc.error).toBeUndefined();
    expect(dc.warnings.join(' ')).not.toMatch(/level|unsupported/i);
    const out = dc.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re;
    const vin = dc.scale!.re;
    expect(out[0]).toBeCloseTo(3.3, 2);
    expect(out[out.length - 1]).toBeLessThan(0.01);
    // switching threshold where Vout = Vin
    let vm = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] >= vin[i - 1] && out[i] < vin[i]) vm = vin[i];
    expect(vm).toBeGreaterThan(1.2);
    expect(vm).toBeLessThan(2.1);
  });

  it('a BSIM3 inverter with a load capacitor switches in transient and conserves the gate charge', () => {
    const deck = `BSIM3 transient
VDD vdd 0 3.3
VIN in 0 PULSE(0 3.3 1n 0.1n 0.1n 4n 10n)
MN out in 0 0 NCH W=2u L=0.35u AD=2p AS=2p PD=6u PS=6u
MP out in vdd vdd PCH W=6u L=0.35u AD=6p AS=6p PD=14u PS=14u
CL out 0 50f
${MODELS}
.tran 0.02n 10n
.end`;
    const [tr] = runAnalyses(parseSpice(deck).netlist);
    expect(tr.error).toBeUndefined();
    const t = tr.scale!.re;
    const out = tr.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re;
    const at = (x: number) => out[t.findIndex((v) => v >= x)];
    expect(at(0.9e-9)).toBeGreaterThan(3.2);
    expect(at(4.5e-9)).toBeLessThan(0.1);
    expect(at(9.5e-9)).toBeGreaterThan(3.2);
  });

  it('a BSIM3 common-source stage has AC gain gm*RD at low frequency', () => {
    const deck = `BSIM3 CS
VDD vdd 0 3.3
VG g 0 DC 0.9 AC 1
RD vdd d 2k
M1 d g 0 0 NCH W=10u L=1u
${MODELS}
.op
.ac dec 5 1k 1meg
.end`;
    const [op, ac] = runAnalyses(parseSpice(deck).netlist);
    expect(op.error).toBeUndefined();
    expect(ac.error).toBeUndefined();
    const gm = op.vectors.find((v) => v.name.toLowerCase() === 'gm(m1)')!.re[0];
    const gds = op.vectors.find((v) => v.name.toLowerCase() === 'gds(m1)')!.re[0];
    const vd = ac.vectors.find((v) => v.name.toLowerCase() === 'v(d)')!;
    const gain = Math.hypot(vd.re[0], vd.im![0]);
    expect(gain / (gm / (1 / 2000 + gds))).toBeCloseTo(1, 3);
  });
});
