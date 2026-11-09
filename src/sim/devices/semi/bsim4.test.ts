/**
 * BSIM4-class MOSFET (LEVEL 14 / 54): the long-channel limit, the three BSIM4 mobility models, the
 * lateral-doping threshold terms, the capacitance geometry, exact Jacobians and a CMOS inverter
 * (DC sweep with no Newton failures, transient). Reference values are computed here from the
 * published model equations, independently of the device code.
 */
import { describe, expect, it } from 'vitest';
import { EPS_OX } from '../../device';
import type { ModelCard } from '../../netlist';
import { K_OVER_Q, celsiusToKelvin, siliconBandGap } from './common';
import { Bsim3, createBsim3 } from './bsim3';
import { TestCircuit } from './test-harness';
import { parseSpice } from '../../spice';
import { runAnalyses } from '../../engine';

const T27 = celsiusToKelvin(27);
const VT = K_OVER_Q * T27;
const TOXE = 4e-9;
const COX = EPS_OX / TOXE;
const U0 = 0.04; // m^2/Vs
const NCH = 3e17;

/** BSIM4 card with every short-channel, mobility and output-conductance effect switched off. */
const LONG: Record<string, number> = {
  level: 54, toxe: TOXE, ndep: NCH, vth0: 0.45, k1: 0.5, k2: 0, k3: 0, k3b: 0, lpe0: 0, lpeb: 0, dvt0: 0, dvt0w: 0, eta0: 0, etab: 0,
  u0: U0, ua: 0, ub: 0, uc: 0, vsat: 1e12, a0: 0, ags: 0, b0: 0, keta: 0, rdsw: 0, pclm: 0, pdiblc1: 0, pdiblc2: 0,
  pscbe2: 0, voff: 0, cdsc: 0, cit: 0, js: 0, cj: 0, cjsw: 0, kt1: 0, kt2: 0, ute: 0, pvag: 0, prwg: 0,
};
const GEOM = { w: 20e-6, l: 20e-6 };

function phiS(nch = NCH): number {
  const eg = siliconBandGap(T27);
  const ni = 1.45e10 * Math.exp(21.5565981 - eg / (2 * VT));
  return 2 * VT * Math.log(nch / ni);
}

function dev(params: Record<string, number>, geom: Record<string, number> = GEOM, type: 'NMOS' | 'PMOS' = 'NMOS'): Bsim3 {
  const card: ModelCard = { name: 'MM', type, params };
  const c = new TestCircuit({ gmin: 0 }).model(card);
  const d = c.element(createBsim3, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', 'b'], model: 'MM', params: geom }) as Bsim3;
  c.vsource('VG', 'g', '0', 1);
  c.vsource('VD', 'd', '0', 1);
  c.vsource('VB', 'b', '0', 0);
  expect(c.op().converged).toBe(true);
  return d;
}

/** Vbseff of the BSIM3/4 smoothing for K2 >= 0 (Vbc = -30). */
function vbseffOf(vbs: number): number {
  const vbc = -30;
  const t0 = vbs - vbc - 0.001;
  return vbc + 0.5 * (t0 + Math.sqrt(t0 * t0 - 0.004 * vbc));
}

describe('BSIM4 in the long-channel limit', () => {
  const d = dev(LONG);
  const beta = U0 * COX; // W/L = 1

  it('is recognised as BSIM4', () => {
    expect(d.isBsim4).toBe(true);
  });

  it.each([1.2, 1.8, 2.5])('saturation current at Vgs %f V is beta Vgst (Vgst + 2Vt) / 2', (vgs) => {
    const vgst = vgs - 0.45;
    const id = d.evaluateAt(vgs, 4, 0, T27).id;
    expect(id / ((beta * vgst * (vgst + 2 * VT)) / 2)).toBeCloseTo(1, 3);
  });

  it('threshold voltage follows VTH0 + K1 (sqrt(PHIs - Vbs) - sqrt(PHIs)) with the K1ox / TOXM scaling', () => {
    for (const vbs of [0, -0.5, -2]) {
      const phi = phiS();
      const vb = vbseffOf(vbs);
      const expected = 0.45 + 0.5 * (Math.sqrt(phi - vb) - Math.sqrt(phi));
      expect(d.evaluateAt(2, 0.05, vbs, T27).vth).toBeCloseTo(expected, 6);
    }
    // body-effect parameters extracted at a thicker oxide scale with TOXE / TOXM
    const scaled = dev({ ...LONG, toxm: 6e-9 });
    const phi = phiS();
    const k1ox = 0.5 * (TOXE / 6e-9);
    const vb = vbseffOf(-1);
    expect(scaled.evaluateAt(2, 0.05, -1, T27).vth).toBeCloseTo(0.45 + k1ox * Math.sqrt(phi - vb) - 0.5 * Math.sqrt(phi), 6);
  });

  it('PMOS mirrors NMOS', () => {
    const n = d.evaluateAt(2, 1, 0, T27).id;
    const p = dev({ ...LONG, vth0: -0.45 }, GEOM, 'PMOS');
    expect(p.evaluateAt(2, 1, 0, T27).id / n).toBeCloseTo(1, 9);
  });

  it('the BSIM4 defaults replace the BSIM3 ones: U0 0.067 m2/Vs (NMOS) and 0.025 (PMOS), UA 1e-9, UB 1e-19, UC -0.0465e-9', () => {
    const base: Record<string, number> = { ...LONG };
    for (const k of ['u0', 'ua', 'ub', 'uc']) delete base[k];
    const n = dev(base);
    const vgs = 2;
    const vth = n.evaluateAt(vgs, 0.05, 0, T27).vth;
    const e = (vgs - vth + 2 * vth) / TOXE;
    const denom = 1 + (1e-9 + -0.0465e-9 * vbseffOf(0)) * e + 1e-19 * e * e;
    const expected = ((0.067 * COX * (vgs - vth) * (vgs - vth + 2 * VT)) / 2) / denom;
    expect(n.evaluateAt(vgs, 4, 0, T27).id / expected).toBeCloseTo(1, 3);
    const p = dev({ ...base, vth0: -0.45 }, GEOM, 'PMOS');
    const vthp = p.evaluateAt(vgs, 0.05, 0, T27).vth;
    const ep = (vgs - vthp + 2 * vthp) / TOXE;
    const denomp = 1 + (1e-9 + -0.0465e-9 * vbseffOf(0)) * ep + 1e-19 * ep * ep;
    expect(p.evaluateAt(vgs, 4, 0, T27).id / (((0.025 * COX * (vgs - vthp) * (vgs - vthp + 2 * VT)) / 2) / denomp)).toBeCloseTo(1, 3);
  });
});

describe('BSIM4 mobility models', () => {
  const ref = dev(LONG);
  const vgs = 2;
  const vbs = -1;
  const vth = ref.evaluateAt(vgs, 4, vbs, T27).vth;
  const vgsteff = vgs - vth;
  const e1 = (vgsteff + 2 * vth) / TOXE;
  const vb = vbseffOf(vbs);
  const base = ref.evaluateAt(vgs, 4, vbs, T27).id;

  it('mobMod 0: 1 + (UA + UC Vbseff) E + UB E^2 with E = (Vgsteff + 2 Vth) / TOXE', () => {
    const ua = 2e-10;
    const ub = 3e-19;
    const uc = -5e-11;
    const d = dev({ ...LONG, mobmod: 0, ua, ub, uc });
    const denom = 1 + (ua + uc * vb) * e1 + ub * e1 * e1;
    expect(d.evaluateAt(vgs, 4, vbs, T27).id / base).toBeCloseTo(1 / denom, 5);
  });

  it('mobMod 1: 1 + (UA E + UB E^2)(1 + UC Vbseff)', () => {
    const ua = 2e-10;
    const ub = 3e-19;
    const uc = -0.05;
    const d = dev({ ...LONG, mobmod: 1, ua, ub, uc });
    const denom = 1 + (ua * e1 + ub * e1 * e1) * (1 + uc * vb);
    expect(d.evaluateAt(vgs, 4, vbs, T27).id / base).toBeCloseTo(1 / denom, 5);
  });

  it('mobMod 2: 1 + (UA + UC Vbseff) E2^EU with E2 = (Vgsteff + C0 K1ox sqrt(PHI)) / TOXE, C0 = 2 for an NMOS', () => {
    const ua = 3e-15;
    const uc = -1e-16;
    const eu = 1.67;
    const d = dev({ ...LONG, mobmod: 2, ua, uc, eu });
    const e2 = (vgsteff + 2 * 0.5 * Math.sqrt(phiS())) / TOXE;
    const denom = 1 + (ua + uc * vb) * Math.pow(e2, eu);
    expect(d.evaluateAt(vgs, 4, vbs, T27).id / base).toBeCloseTo(1 / denom, 5);
  });

  it('the three models give different currents for the same UA / UB', () => {
    const uc = [-5e-11, -0.05, -5e-17];
    const cur = [0, 1, 2].map((mobmod) => dev({ ...LONG, mobmod, ua: mobmod === 2 ? 2e-15 : 1e-9, ub: 1e-19, uc: uc[mobmod], eu: 1.2 }).evaluateAt(vgs, 4, -1, T27).id);
    expect(new Set(cur.map((c) => c.toPrecision(5))).size).toBe(3);
  });
});

describe('BSIM4 threshold: lateral non-uniform doping and short channel', () => {
  it('LPE0 raises the short-channel threshold by K1 (sqrt(1 + LPE0/Leff) - 1) sqrt(PHI), LPEB scales the body term', () => {
    const phi = phiS();
    for (const l of [0.2e-6, 0.5e-6, 2e-6]) {
      for (const vbs of [0, -1]) {
        const d = dev({ ...LONG, lpe0: 1.74e-7, lpeb: 5e-8 }, { w: 10e-6, l });
        const vb = vbseffOf(vbs);
        const expected = 0.45 + 0.5 * (Math.sqrt(phi - vb) - Math.sqrt(phi)) * Math.sqrt(1 + 5e-8 / l) + 0.5 * (Math.sqrt(1 + 1.74e-7 / l) - 1) * Math.sqrt(phi);
        expect(d.evaluateAt(2, 0.05, vbs, T27).vth).toBeCloseTo(expected, 6);
      }
    }
  });

  it('DIBL and the short-channel roll-off lower the threshold at short L and high VDS (SCE on)', () => {
    const sce = { ...LONG, dvt0: 2.2, dvt1: 0.53, eta0: 0.08, etab: -0.07, lpe0: 0 };
    const long = dev(sce, { w: 10e-6, l: 10e-6 }).evaluateAt(1, 0.05, 0, T27).vth;
    const dShort = dev(sce, { w: 10e-6, l: 0.18e-6 });
    const short = dShort.evaluateAt(1, 0.05, 0, T27).vth;
    expect(short).toBeLessThan(long - 0.02);
    expect(dShort.evaluateAt(1, 1.5, 0, T27).vth).toBeLessThan(short - 0.02);
  });
});

describe('BSIM4 capacitance geometry', () => {
  it('the intrinsic gate capacitance uses Leff,CV = L - 2 DLC and Weff,CV = W - 2 DWC', () => {
    const a = dev({ ...LONG, dlc: 0, dwc: 0 }, { w: 10e-6, l: 1e-6 });
    const b = dev({ ...LONG, dlc: 0.05e-6, dwc: 0.1e-6 }, { w: 10e-6, l: 1e-6 });
    const ca = a.evaluateAt(2.5, 0, 0, T27).cgg;
    const cb = b.evaluateAt(2.5, 0, 0, T27).cgg;
    expect(cb / ca).toBeCloseTo(((1e-6 - 2 * 0.05e-6) * (10e-6 - 2 * 0.1e-6)) / (1e-6 * 10e-6), 2);
    expect(ca / (COX * 10e-6 * 1e-6)).toBeGreaterThan(0.97);
    expect(ca / (COX * 10e-6 * 1e-6)).toBeLessThan(1.03);
  });

  it('CGSO / CGDO default to DLC Cox - CGSL (>= 0) and CF to 2 eps_ox / pi ln(1 + 4e-7 / TOXE)', () => {
    const d = dev({ ...LONG, dlc: 0.02e-6, cgsl: 1e-11, cgdl: 2e-11 }, { w: 10e-6, l: 1e-6 });
    const e = d.evaluateAt(2, 0.5, 0, T27);
    const cf = ((2 * EPS_OX) / Math.PI) * Math.log(1 + 4e-7 / TOXE);
    const weffQ = 10e-6;
    expect(e.cgso / ((0.02e-6 * COX - 1e-11 + cf) * weffQ)).toBeCloseTo(1, 9);
    expect(e.cgdo / ((0.02e-6 * COX - 2e-11 + cf) * weffQ)).toBeCloseTo(1, 9);
    // a negative difference is floored at zero
    const z = dev({ ...LONG, dlc: 1e-9, cgsl: 1e-9, cf: 0 }, { w: 10e-6, l: 1e-6 }).evaluateAt(2, 0.5, 0, T27);
    expect(z.cgso).toBe(0);
  });
});

describe('BSIM4: exact Jacobians', () => {
  const full: Record<string, number> = { level: 54, toxe: 4.1e-9, ndep: 3e17, vth0: 0.42, u0: 0.04, vsat: 9e4, mobmod: 0, rdsw: 150, js: 1e-6, cj: 1e-3, cjsw: 3e-10 };
  it.each([0, 1, 2])('gm, gds, gmbs equal the finite differences of ID with mobMod %i from weak to strong inversion', (mobmod) => {
    const d = dev({ ...full, mobmod, ua: mobmod === 2 ? 1e-15 : 1e-9, uc: mobmod === 1 ? -0.0465 : mobmod === 2 ? -0.0465e-15 : -0.0465e-9 }, { w: 5e-6, l: 0.18e-6, ad: 2e-12, as: 2e-12, pd: 6e-6, ps: 6e-6 });
    const h = 1e-6;
    for (const vgs of [0.1, 0.3, 0.45, 0.6, 1.0, 1.8]) {
      for (const vds of [0.02, 0.3, 1.0, 1.8]) {
        for (const vbs of [0, -0.8]) {
          const e = d.evaluateAt(vgs, vds, vbs, T27);
          const dg = (d.evaluateAt(vgs + h, vds, vbs, T27).id - d.evaluateAt(vgs - h, vds, vbs, T27).id) / (2 * h);
          const dd = (d.evaluateAt(vgs, vds + h, vbs, T27).id - d.evaluateAt(vgs, vds - h, vbs, T27).id) / (2 * h);
          const db = (d.evaluateAt(vgs, vds, vbs + h, T27).id - d.evaluateAt(vgs, vds, vbs - h, T27).id) / (2 * h);
          const tol = (x: number) => 2e-4 * Math.abs(x) + 1e-13;
          expect(Math.abs(e.gm - dg)).toBeLessThan(tol(dg));
          expect(Math.abs(e.gds - dd)).toBeLessThan(tol(dd));
          expect(Math.abs(e.gmbs - db)).toBeLessThan(tol(db));
        }
      }
    }
  });

  it('ID(VDS) is continuous through VDS = 0 and has a continuous slope (no kink at the source/drain swap)', () => {
    const d = dev(full, { w: 5e-6, l: 0.18e-6 });
    const a = d.evaluateAt(1, 1e-7, 0, T27);
    const b = d.evaluateAt(1, -1e-7, 0, T27);
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeLessThan(0);
    expect(Math.abs(a.id + b.id)).toBeLessThan(0.01 * Math.abs(a.id));
    expect(Math.abs(a.gds / b.gds - 1)).toBeLessThan(0.05);
  });
});

describe('BSIM4 CMOS inverter through the engine', () => {
  const card = (type: string, vth: number) => `.model ${type === 'N' ? 'NM' : 'PM'} ${type === 'N' ? 'NMOS' : 'PMOS'} (LEVEL=54 TOXE=4.1n NDEP=3e17 VTH0=${vth} U0=${type === 'N' ? 0.045 : 0.018} VSAT=9e4 RDSW=150 CJ=1e-3 CJSW=3e-10 JS=1e-6 DVT0=2.2 ETA0=0.08 ETAB=-0.07 LPE0=1.74e-7)`;
  const inverter = (vin: string, mobmod = 0) => `BSIM4 inverter
VDD vdd 0 DC 1.8
VIN in 0 ${vin}
MP out in vdd vdd PM W=1.5u L=0.18u AD=0.9p AS=0.9p PD=3.6u PS=3.6u
MN out in 0 0 NM W=0.5u L=0.18u AD=0.3p AS=0.3p PD=2.2u PS=2.2u
CL out 0 10f
${card('N', 0.42).replace('LEVEL=54', `LEVEL=54 MOBMOD=${mobmod}`)}
${card('P', -0.42).replace('LEVEL=54', `LEVEL=54 MOBMOD=${mobmod}`)}
`;

  it.each([0, 1, 2])('the DC transfer curve (mobMod %i) converges at every point, never rises, and swings rail to rail', (mobmod) => {
    const parsed = parseSpice(`${inverter('DC 0', mobmod)}.dc VIN 0 1.8 0.005\n.end\n`);
    expect(parsed.errors).toEqual([]);
    const [r] = runAnalyses(parsed.netlist);
    expect(r.error).toBeUndefined();
    const vin = r.scale!.re;
    const vout = r.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re;
    expect(vin.length).toBeGreaterThan(300);
    expect(vout[0]).toBeGreaterThan(1.79);
    expect(vout[vout.length - 1]).toBeLessThan(0.01);
    for (let i = 1; i < vout.length; i++) expect(vout[i]).toBeLessThanOrEqual(vout[i - 1] + 1e-9);
    // the gain at the switching point is well above 1 (a restoring inverter)
    let gmax = 0;
    for (let i = 1; i < vout.length; i++) gmax = Math.max(gmax, -(vout[i] - vout[i - 1]) / (vin[i] - vin[i - 1]));
    expect(gmax).toBeGreaterThan(3);
  });

  it('a transient switches the output to both rails', () => {
    const text = `${inverter('PULSE(0 1.8 1n 0.1n 0.1n 4n 10n)')}.tran 0.05n 12n\n.end\n`;
    const [r] = runAnalyses(parseSpice(text).netlist);
    expect(r.error).toBeUndefined();
    const t = r.scale!.re;
    const vout = r.vectors.find((v) => v.name.toLowerCase() === 'v(out)')!.re;
    const at = (time: number) => {
      let i = 0;
      while (i < t.length - 1 && t[i] < time) i++;
      return vout[i];
    };
    expect(at(0.9e-9)).toBeGreaterThan(1.7);
    expect(at(4.5e-9)).toBeLessThan(0.15);
    expect(at(9.5e-9)).toBeGreaterThan(1.7);
  });

  it('an AC sweep of the inverter biased at its switching point shows gain well above 1 that rolls off with frequency', () => {
    // bias at the switching point: Vin where the DC transfer curve crosses VDD/2
    const [dc] = runAnalyses(parseSpice(`${inverter('DC 0')}.dc VIN 0 1.8 0.002\n.end\n`).netlist);
    const vin0 = dc.scale!.re;
    const vo = dc.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!.re;
    let vmid = 0.9;
    for (let i = 1; i < vo.length; i++) if (vo[i - 1] >= 0.9 && vo[i] < 0.9) vmid = vin0[i];
    const text = `${inverter(`DC ${vmid} AC 1`)}.ac dec 20 1e3 1e11\n.end\n`;
    const [r] = runAnalyses(parseSpice(text).netlist);
    expect(r.error).toBeUndefined();
    const v = r.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!;
    const f = r.scale!.re;
    const mag = Array.from(v.re, (re, i) => Math.hypot(re, v.im![i]));
    expect(mag[0]).toBeGreaterThan(1);
    // -3 dB corner of the low-frequency gain
    let fc = 0;
    for (let i = 1; i < mag.length; i++) {
      if (mag[i] < mag[0] / Math.SQRT2) {
        fc = f[i - 1] + ((f[i] - f[i - 1]) * (mag[i - 1] - mag[0] / Math.SQRT2)) / (mag[i - 1] - mag[i]);
        break;
      }
    }
    expect(fc).toBeGreaterThan(1e6);
    expect(fc).toBeLessThan(1e11);
  });
});
