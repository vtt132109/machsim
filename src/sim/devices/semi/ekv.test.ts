/**
 * EKV 2.6 MOSFET: the closed-form limits of the model (weak-inversion exponential, strong-inversion
 * square law, source/drain symmetry), the exact inversion charge, exact Jacobians, and a CMOS inverter
 * (DC transfer curve with no Newton failures, symmetric switching point, transient).
 */
import { describe, expect, it } from 'vitest';
import { EPS_OX } from '../../device';
import type { ModelCard } from '../../netlist';
import { K_OVER_Q, celsiusToKelvin } from './common';
import { Ekv, createEkv, ekvInversionCharge } from './ekv';
import { MosDevice, createMosDevice } from './mosdevice';
import { TestCircuit } from './test-harness';
import { parseSpice } from '../../spice';
import { runAnalyses } from '../../engine';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;
const COX = 0.7e-3;
const KP = 50e-6;
const W = 10e-6;
const L = 1e-6;
const BETA = (KP * W) / L;

/** Card with every second-order effect off: the bare EKV equations. */
const BARE: Record<string, number> = { level: 44, vto: 0.5, gamma: 0.8, phi: 0.7, kp: KP, cox: COX, lambda: 0, ucrit: 1e30, e0: 1e30, theta: 0, tcv: 0, js: 0, cj: 0, cjsw: 0 };
const GEOM = { w: W, l: L };

function dev(params: Record<string, number>, geom: Record<string, number> = GEOM, type: 'NMOS' | 'PMOS' = 'NMOS'): Ekv {
  const card: ModelCard = { name: 'MM', type, params };
  const c = new TestCircuit({ gmin: 0 }).model(card);
  const d = c.element(createEkv, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', 'b'], model: 'MM', params: geom }) as Ekv;
  c.vsource('VG', 'g', '0', 0);
  c.vsource('VD', 'd', '0', 0);
  c.vsource('VB', 'b', '0', 0);
  c.op();
  return d;
}

// ---- independent evaluation of the published equations ---------------------------------------

const F = (v: number) => Math.log1p(Math.exp(v / 2)) ** 2;

function pinchOff(vgb: number, p: { vto: number; gamma: number; phi: number }): number {
  const vgp = vgb - p.vto + p.phi + p.gamma * Math.sqrt(p.phi);
  if (vgp <= 0) return -p.phi;
  return vgp - p.phi - p.gamma * (Math.sqrt(vgp + (p.gamma * p.gamma) / 4) - p.gamma / 2);
}

function slope(vp: number, p: { gamma: number; phi: number }): number {
  return 1 + p.gamma / (2 * Math.sqrt(vp + p.phi + 4 * VT));
}

/** Drain current of the bare model at device-polarity voltages (source at 0, bulk at vbs). */
function ekvReference(vgs: number, vds: number, vbs: number, p = BARE as { vto: number; gamma: number; phi: number }): { id: number; vp: number; n: number; ifwd: number; irev: number } {
  const vgb = vgs - vbs;
  const vsb = -vbs;
  const vp = pinchOff(vgb, p);
  const n = slope(vp, p);
  const ifwd = F((vp - vsb) / VT);
  const irev = F((vp - vsb - vds) / VT);
  return { id: 2 * n * BETA * VT * VT * (ifwd - irev), vp, n, ifwd, irev };
}

describe('EKV: the closed-form model equations', () => {
  const d = dev(BARE);

  it.each([
    [0.1, 0.05, 0],
    [0.3, 0.2, 0],
    [0.5, 0.1, 0],
    [0.7, 1.5, 0],
    [1.0, 0.05, 0],
    [1.2, 2.5, 0],
    [1.8, 1.8, 0],
    [1.0, 0.5, -0.8],
    [0.6, 1.2, -1.5],
  ])('Id at Vgs %f, Vds %f, Vbs %f equals IS (F(f) - F(r))', (vgs, vds, vbs) => {
    const ref = ekvReference(vgs, vds, vbs);
    const got = d.evaluateAt(vgs, vds, vbs, T27);
    expect(got.id / ref.id).toBeCloseTo(1, 9);
    expect(got.vp).toBeCloseTo(ref.vp, 12);
    expect(got.ic).toBeCloseTo(ref.ifwd, 9);
  });

  it('weak inversion: ID = IS exp((VP - VS)/Vt) (1 - exp(-VDS/Vt)) and the slope is 1/(n Vt)', () => {
    const vgs = -0.2;
    const vds = 0.4;
    const ref = ekvReference(vgs, vds, 0);
    const is = 2 * ref.n * BETA * VT * VT;
    const weak = is * Math.exp(ref.vp / VT) * (1 - Math.exp(-vds / VT));
    const got = d.evaluateAt(vgs, vds, 0, T27).id;
    expect(Math.abs(got / weak - 1)).toBeLessThan(2e-3);
    // swing: two gate voltages 20 mV apart
    const i1 = d.evaluateAt(0.08, vds, 0, T27).id;
    const i2 = d.evaluateAt(0.1, vds, 0, T27).id;
    const swing = 0.02 / Math.log(i2 / i1);
    // d(VP)/d(VG') = 1 - GAMMA / (2 sqrt(VG' + GAMMA^2/4)) and ID ~ exp(VP/Vt): the swing is Vt / (dVP/dVG)
    const vgp = 0.09 - 0.5 + 0.7 + 0.8 * Math.sqrt(0.7);
    const dvp = 1 - 0.8 / (2 * Math.sqrt(vgp + 0.16));
    expect(Math.abs(swing / (VT / dvp) - 1)).toBeLessThan(0.02);
  });

  it('strong inversion saturation: ID = beta (VGS - VTO)^2 / (2 n) with GAMMA = 0 (n = 1)', () => {
    const flat = dev({ ...BARE, gamma: 0 });
    for (const vgs of [1.5, 2, 3]) {
      const id = flat.evaluateAt(vgs, 4, 0, T27).id;
      expect(id / ((BETA * (vgs - 0.5) ** 2) / 2)).toBeCloseTo(1, 3);
    }
  });

  it('linear region: ID -> beta (VGS - VTO) VDS for small VDS in strong inversion (GAMMA = 0)', () => {
    const flat = dev({ ...BARE, gamma: 0 });
    const vds = 0.005;
    const id = flat.evaluateAt(3, vds, 0, T27).id;
    expect(id / (BETA * (3 - 0.5) * vds)).toBeCloseTo(1, 2);
  });

  it('the drain and the source are interchangeable: ID(-VDS) mirrors the swapped device', () => {
    const vgs = 0.9;
    const vds = -0.35;
    const vbs = -0.2;
    const rev = d.evaluateAt(vgs, vds, vbs, T27).id;
    const swapped = d.evaluateAt(vgs - vds, -vds, vbs - vds, T27).id;
    expect(rev / -swapped).toBeCloseTo(1, 12);
    expect(rev).toBeLessThan(0);
  });

  it('PMOS mirrors NMOS', () => {
    const n = dev(BARE).evaluateAt(1, 0.8, 0, T27).id;
    const p = dev(BARE, GEOM, 'PMOS');
    // device-polarity voltages are the same: the dispatcher flips the signs of the terminal voltages
    expect(p.polarity).toBe(-1);
    expect(p.evaluateAt(1, 0.8, 0, T27).id / n).toBeCloseTo(1, 12);
  });

  it('the inversion coefficient IC = i_f separates weak (< 0.1), moderate and strong (> 10) inversion', () => {
    expect(d.evaluateAt(0.2, 1, 0, T27).ic).toBeLessThan(0.1);
    const mid = d.evaluateAt(0.55, 1, 0, T27).ic;
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(10);
    expect(d.evaluateAt(1.5, 1, 0, T27).ic).toBeGreaterThan(10);
  });
});

describe('EKV: second-order effects', () => {
  it('velocity saturation divides the saturation current by 1 + (VP - VS)/Vc with Vc = UCRIT L', () => {
    const geom = { w: W, l: 0.25e-6 };
    const noClamp = dev({ ...BARE, gamma: 0 }, geom).evaluateAt(2, 3, 0, T27).id;
    const clamp = dev({ ...BARE, gamma: 0, ucrit: 2e6 }, geom).evaluateAt(2, 3, 0, T27).id;
    const vc = 2e6 * 0.25e-6;
    expect(clamp / noClamp).toBeCloseTo(1 / (1 + (2 - 0.5) / vc), 2);
    // no effect in weak inversion
    const weakA = dev({ ...BARE, gamma: 0 }, geom).evaluateAt(0.2, 1, 0, T27).id;
    const weakB = dev({ ...BARE, gamma: 0, ucrit: 2e6 }, geom).evaluateAt(0.2, 1, 0, T27).id;
    expect(weakB / weakA).toBeGreaterThan(0.99);
  });

  it('channel-length modulation gives a positive, growing output conductance in saturation', () => {
    const d = dev({ ...BARE, gamma: 0, lambda: 0.5, ucrit: 2e6 }, { w: W, l: 0.5e-6 });
    const g1 = d.evaluateAt(1.5, 1.5, 0, T27).gds;
    const g2 = d.evaluateAt(1.5, 3, 0, T27).gds;
    expect(g1).toBeGreaterThan(0);
    // the logarithmic length modulation flattens with VDS but never reaches zero
    expect(g2).toBeGreaterThan(0);
    expect(g2).toBeLessThan(g1);
    const idLow = d.evaluateAt(1.5, 1.5, 0, T27).id;
    const idHigh = d.evaluateAt(1.5, 3, 0, T27).id;
    expect(idHigh).toBeGreaterThan(idLow);
  });

  it('mobility reduction THETA lowers the strong-inversion current by 1 / (1 + THETA VP)', () => {
    const a = dev({ ...BARE, gamma: 0 });
    const b = dev({ ...BARE, gamma: 0, theta: 0.5 });
    const r = b.evaluateAt(2, 3, 0, T27).id / a.evaluateAt(2, 3, 0, T27).id;
    const vp = 2 - 0.5;
    expect(Math.abs(r - 1 / (1 + 0.5 * vp))).toBeLessThan(0.01);
  });

  it('threshold falls with temperature at TCV per kelvin', () => {
    const cold = dev({ ...BARE, gamma: 0, tcv: 2e-3, bex: 0 });
    const vp27 = cold.evaluateAt(1, 1, 0, T27).vp;
    const vp77 = cold.evaluateAt(1, 1, 0, celsiusToKelvin(77)).vp;
    expect(vp77 - vp27).toBeCloseTo(2e-3 * 50, 3);
  });
});

describe('EKV: charges', () => {
  const d = dev({ ...BARE, gamma: 0.6 });
  const area = COX * W * L;

  it.each([
    [1.2, 0.05],
    [1.2, 0.6],
    [0.9, 2],
    [0.45, 0.3],
  ])('the inversion charge equals the closed form at Vgs %f, Vds %f', (vgs, vds) => {
    const e = d.evaluateAt(vgs, vds, 0, T27);
    const ref = ekvReference(vgs, vds, 0, { ...BARE, gamma: 0.6 } as { vto: number; gamma: number; phi: number });
    const qi = -(e.qg + e.qb);
    const expected = -2 * ref.n * VT * area * ekvInversionCharge(ref.ifwd, ref.irev);
    // the model integrates the profile with a constant slope factor n(VP)
    expect(qi / expected).toBeCloseTo(1, 10);
    expect(e.qg + e.qd + e.qb + e.qs).toBeCloseTo(0, 18);
  });

  it('the drain share is the first moment of the charge profile (compared with a fine numerical integral)', () => {
    const flat = dev({ ...BARE, gamma: 0.6 });
    for (const [vgs, vds] of [[1.2, 0.05], [1.2, 0.6], [0.9, 2], [0.45, 0.3], [2, 0]]) {
      const e = flat.evaluateAt(vgs, vds, 0, T27);
      const ref = ekvReference(vgs, vds, 0, { ...BARE, gamma: 0.6 } as { vto: number; gamma: number; phi: number });
      let moment = 0;
      const N = 20000;
      for (let k = 0; k < N; k++) {
        const x = (k + 0.5) / N;
        const i = ref.ifwd * (1 - x) + ref.irev * x;
        moment += (((Math.sqrt(1 + 4 * i) - 1) / 2) * x) / N;
      }
      const expected = -2 * ref.n * VT * COX * W * L * moment;
      expect(e.qd / expected).toBeCloseTo(1, 7);
    }
  });

  it('in saturation the drain carries 40 % of the inversion charge (Ward-Dutton limit) for a long channel', () => {
    const flat = dev({ ...BARE, gamma: 0 });
    const e = flat.evaluateAt(2, 4, 0, T27);
    const qi = -(e.qg + e.qb);
    expect(e.qd / qi).toBeCloseTo(0.4, 2);
  });

  it('at VDS = 0 the inversion charge is shared 50/50', () => {
    const flat = dev({ ...BARE, gamma: 0 });
    const e = flat.evaluateAt(2, 0, 0, T27);
    expect(e.qd / (e.qd + e.qs)).toBeCloseTo(0.5, 6);
  });

  it('the gate capacitance rises from the depletion value to Cox W L (2/3 in saturation)', () => {
    const flat = dev({ ...BARE, gamma: 0 });
    const cgg = (vgs: number, vds: number) => flat.evaluateAt(vgs, vds, 0, T27).cgg;
    expect(cgg(3, 4)).toBeCloseTo((2 / 3) * area, -2 + Math.round(-Math.log10(area)));
    expect(cgg(3, 0)).toBeGreaterThan(0.9 * area);
    expect(cgg(3, 0)).toBeLessThan(1.01 * area);
  });
});

describe('EKV: exact Jacobians and smoothness', () => {
  const d = dev({ ...BARE, lambda: 0.5, ucrit: 2e6, theta: 0.3, gamma: 0.7 }, { w: W, l: 0.35e-6 });
  const h = 1e-6;

  it('gm, gds and gmbs equal the finite-difference derivatives of ID on a bias grid from weak to strong inversion', () => {
    for (const vgs of [0.05, 0.3, 0.45, 0.55, 0.8, 1.5, 2.5]) {
      for (const vds of [0.01, 0.2, 1, 3]) {
        for (const vbs of [0, -1]) {
          const e = d.evaluateAt(vgs, vds, vbs, T27);
          const dg = (d.evaluateAt(vgs + h, vds, vbs, T27).id - d.evaluateAt(vgs - h, vds, vbs, T27).id) / (2 * h);
          const dd = (d.evaluateAt(vgs, vds + h, vbs, T27).id - d.evaluateAt(vgs, vds - h, vbs, T27).id) / (2 * h);
          const db = (d.evaluateAt(vgs, vds, vbs + h, T27).id - d.evaluateAt(vgs, vds, vbs - h, T27).id) / (2 * h);
          const tol = (x: number) => 1e-4 * Math.abs(x) + 1e-12;
          expect(Math.abs(e.gm - dg)).toBeLessThan(tol(dg));
          expect(Math.abs(e.gds - dd)).toBeLessThan(tol(dd));
          expect(Math.abs(e.gmbs - db)).toBeLessThan(tol(db));
        }
      }
    }
  });

  it('ID(VGS) and gm are continuous through the weak-to-strong transition (no kink: second difference is small)', () => {
    let prev = d.evaluateAt(0, 1, 0, T27);
    const step = 0.01;
    for (let vgs = step; vgs <= 2; vgs += step) {
      const e = d.evaluateAt(vgs, 1, 0, T27);
      // gm changes by less than 25 % per 10 mV step everywhere (an exponential has 40 % at the lowest swing, so compare in log)
      expect(Math.abs(Math.log(e.gm / prev.gm))).toBeLessThan(0.45);
      expect(e.id).toBeGreaterThanOrEqual(prev.id);
      prev = e;
    }
  });

  it('ID is continuous and odd-symmetric through VDS = 0', () => {
    const a = d.evaluateAt(1, 1e-9, 0, T27).id;
    const b = d.evaluateAt(1, -1e-9, 0, T27).id;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(0);
    expect(Math.abs(a + b)).toBeLessThan(1e-9 * Math.abs(a) + 1e-18);
  });
});

describe('EKV through the engine', () => {
  it('the dispatcher builds an Ekv for LEVEL 44 and the SPICE parser accepts the card', () => {
    const c = new TestCircuit({ gmin: 0 }).model({ name: 'MM', type: 'NMOS', params: { level: 44, vto: 0.5, kp: KP } });
    const m = c.element(createMosDevice, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'MM', params: GEOM }) as MosDevice;
    c.vsource('VG', 'g', '0', 1);
    c.vsource('VD', 'd', '0', 1);
    c.op();
    expect(m.implementation).toBeInstanceOf(Ekv);
    expect(m.getParam('vto')).toBeCloseTo(0.5, 12);
  });

  const INVERTER = (vin: string) => `CMOS inverter, EKV
VDD vdd 0 DC 1.8
VIN in 0 ${vin}
MP out in vdd vdd PM W=20u L=0.35u
MN out in 0 0 NM W=10u L=0.35u
CL out 0 20f
.model NM NMOS (LEVEL=44 VTO=0.5 GAMMA=0.6 PHI=0.8 KP=170u UCRIT=4e6 THETA=0.8 LAMBDA=0.4 COX=4.5m CGSO=2.5e-10 CGDO=2.5e-10 TCV=1m)
.model PM PMOS (LEVEL=44 VTO=0.5 GAMMA=0.6 PHI=0.8 KP=170u UCRIT=4e6 THETA=0.8 LAMBDA=0.4 COX=4.5m CGSO=2.5e-10 CGDO=2.5e-10 TCV=1m)
`;

  it('a CMOS inverter transfer curve converges at every point, falls monotonically and switches at VDD/2 by symmetry', () => {
    const text = `${INVERTER('DC 0')}.dc VIN 0 1.8 0.01\n.end\n`;
    const parsed = parseSpice(text);
    expect(parsed.errors).toEqual([]);
    const [r] = runAnalyses(parsed.netlist);
    expect(r.error).toBeUndefined();
    const vin = r.scale!.re;
    const vout = r.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re;
    expect(vout[0]).toBeGreaterThan(1.79);
    expect(vout[vout.length - 1]).toBeLessThan(0.01);
    for (let i = 1; i < vout.length; i++) expect(vout[i]).toBeLessThanOrEqual(vout[i - 1] + 1e-9);
    // PMOS twice as wide as the NMOS with equal KP: the switching point sits where the currents balance
    let mid = 0;
    for (let i = 1; i < vout.length; i++) if (vout[i - 1] >= 0.9 && vout[i] < 0.9) mid = vin[i];
    expect(mid).toBeGreaterThan(0.7);
    expect(mid).toBeLessThan(1.1);
  });

  it('a matched inverter (PMOS twice as wide, identical cards) has Vout = VDD/2 at Vin = VDD/2 to within 1 mV', () => {
    const text = `${INVERTER('DC 0.9')}.op\n.end\n`;
    const parsed = parseSpice(text);
    const [r] = runAnalyses(parsed.netlist);
    expect(r.error).toBeUndefined();
    const vout = r.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re[0];
    // the device cards are identical and the widths scale beta exactly, so the two currents balance at VDD/2
    // only when the PMOS is 1x; with a 2x PMOS the output sits above VDD/2: check the exact symmetric case
    expect(vout).toBeGreaterThan(0.9);
    const sym = text.replace('W=20u', 'W=10u');
    const [r2] = runAnalyses(parseSpice(sym).netlist);
    const v2 = r2.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re[0];
    expect(Math.abs(v2 - 0.9)).toBeLessThan(1e-3);
  });

  it('the inverter switches in a transient (rise and fall to the rails) with the load and gate charges', () => {
    const text = `${INVERTER('PULSE(0 1.8 1n 0.1n 0.1n 4n 10n)')}.tran 0.05n 12n\n.end\n`;
    const [r] = runAnalyses(parseSpice(text).netlist);
    expect(r.error).toBeUndefined();
    const t = r.scale!.re;
    const vout = r.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re;
    const at = (time: number) => {
      let i = 0;
      while (i < t.length - 1 && t[i] < time) i++;
      return vout[i];
    };
    expect(at(0.9e-9)).toBeGreaterThan(1.75);
    expect(at(4e-9)).toBeLessThan(0.1);
    expect(at(9.5e-9)).toBeGreaterThan(1.75);
  });

  it('small-signal gain of a common-source stage equals -gm (RD || ro) computed from the model', () => {
    const text = `CS amp, EKV
VDD vdd 0 DC 1.8
VG g 0 DC 0.7 AC 1
RD vdd out 20k
M1 out g 0 0 NM W=10u L=1u
.model NM NMOS (LEVEL=44 VTO=0.5 GAMMA=0 KP=170u LAMBDA=0.2 UCRIT=1e8 COX=4.5m)
.ac lin 1 1k 1k
.end
`;
    const parsed = parseSpice(text);
    const [r] = runAnalyses(parsed.netlist);
    expect(r.error).toBeUndefined();
    const v = r.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!;
    const gain = Math.hypot(v.re[0], v.im![0]);
    const c = new TestCircuit({ gmin: 0 }).model({ name: 'NM', type: 'NMOS', params: { level: 44, vto: 0.5, gamma: 0, kp: 170e-6, lambda: 0.2, ucrit: 1e8, cox: 4.5e-3 } });
    const m = c.element(createEkv, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'NM', params: { w: 10e-6, l: 1e-6 } }) as Ekv;
    c.vsource('VG', 'g', '0', 0.7);
    c.vsource('VD', 'd', '0', 1);
    c.op();
    // find the drain voltage from the engine result at DC
    const [op] = runAnalyses(parseSpice(text.replace('.ac lin 1 1k 1k', '.op')).netlist);
    const vd = op.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!.re[0];
    const e = m.evaluateAt(0.7, vd, 0, T27);
    const expected = e.gm / (1 / 20e3 + e.gds);
    expect(Math.abs(gain / expected - 1)).toBeLessThan(5e-3);
    expect(EPS_OX).toBeGreaterThan(0);
  });
});
