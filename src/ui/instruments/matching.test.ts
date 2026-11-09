/**
 * Matching-network designer: textbook amplifier-design examples (stability circles, conjugate
 * match, unilateral gain circles), the defining properties of every result, and L-section
 * networks verified by an AC simulation of the matched load.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../sim';
import type { ElementIR, Netlist } from '../../sim/netlist';
import { emptyNetlist } from '../../sim/netlist';
import { c, cabs, cadd, cargDeg, cdiv, cmul, csub, gammaToZ, powerGains, type Complex, type TwoPort } from './network';
import {
  circlePoints,
  conj,
  conjugateMatch,
  gammaIn,
  gammaOut,
  lMatch,
  matchToGamma,
  networkInputImpedance,
  stabilityCircles,
  transducerGain,
  unilateralFigure,
  unilateralGainCircle,
  unilateralMax,
  unilateralSectionGain,
  type LNetwork,
} from './matching';

const polar = (m: number, deg: number): Complex => ({ re: m * Math.cos((deg * Math.PI) / 180), im: m * Math.sin((deg * Math.PI) / 180) });

/** GaAs FET at 2 GHz (stability example of the standard microwave textbook). */
const FET: TwoPort = { p11: polar(0.894, -60.6), p21: polar(3.122, 123.6), p12: polar(0.02, 62.4), p22: polar(0.781, -27.6) };
/** Unconditionally stable device at 4 GHz (conjugate-match example). */
const AMP: TwoPort = { p11: polar(0.72, -116), p21: polar(2.6, 76), p12: polar(0.03, 57), p22: polar(0.73, -54) };
/** Unilateral device at 4 GHz (gain-circle example). */
const UNI: TwoPort = { p11: polar(0.75, -120), p21: polar(2.5, 80), p12: c(0), p22: polar(0.6, -70) };

describe('stability circles', () => {
  it('reproduce the textbook GaAs FET example', () => {
    const st = stabilityCircles(FET);
    expect(st.k).toBeCloseTo(0.607, 2);
    expect(st.delta).toBeCloseTo(0.696, 2);
    expect(st.unconditional).toBe(false);
    expect(cabs(st.load.center)).toBeCloseTo(1.361, 2);
    expect(cargDeg(st.load.center)).toBeCloseTo(47, 0);
    expect(st.load.radius).toBeCloseTo(0.5, 2);
    expect(cabs(st.source.center)).toBeCloseTo(1.132, 2);
    expect(cargDeg(st.source.center)).toBeCloseTo(68, 0);
    expect(st.source.radius).toBeCloseTo(0.199, 2);
    // |S11| < 1 and the origin lies outside the load circle: outside is stable
    expect(st.load.stableInside).toBe(false);
  });

  it('every point of the load (source) circle gives |Γin| = 1 (|Γout| = 1)', () => {
    const st = stabilityCircles(FET);
    for (const g of circlePoints(st.load, 24)) expect(cabs(gammaIn(FET, g))).toBeCloseTo(1, 9);
    for (const g of circlePoints(st.source, 24)) expect(cabs(gammaOut(FET, g))).toBeCloseTo(1, 9);
  });

  it('μ > 1 exactly for the unconditionally stable device', () => {
    expect(stabilityCircles(AMP).unconditional).toBe(true);
    expect(stabilityCircles(AMP).k).toBeCloseTo(1.195, 2);
  });
});

describe('simultaneous conjugate match', () => {
  it('reproduces the textbook design and its gain', () => {
    const m = conjugateMatch(AMP)!;
    expect(cabs(m.gs)).toBeCloseTo(0.872, 2);
    expect(cargDeg(m.gs)).toBeCloseTo(123, 0);
    expect(cabs(m.gl)).toBeCloseTo(0.876, 2);
    expect(cargDeg(m.gl)).toBeCloseTo(61, 0);
    expect(10 * Math.log10(m.gain)).toBeCloseTo(16.7, 1);
  });

  it('is a conjugate match on both sides with the maximum available gain', () => {
    const m = conjugateMatch(AMP)!;
    const gin = gammaIn(AMP, m.gl);
    const gout = gammaOut(AMP, m.gs);
    expect(gin.re).toBeCloseTo(m.gs.re, 9);
    expect(gin.im).toBeCloseTo(-m.gs.im, 9);
    expect(gout.re).toBeCloseTo(m.gl.re, 9);
    expect(gout.im).toBeCloseTo(-m.gl.im, 9);
    expect(m.gain).toBeCloseTo(powerGains(AMP).mag, 9);
    expect(transducerGain(AMP, m.gs, m.gl)).toBeCloseTo(m.gain, 12);
  });

  it('is refused for a potentially unstable device', () => {
    expect(conjugateMatch(FET)).toBeNull();
  });
});

describe('unilateral gain circles', () => {
  it('reproduce the textbook circles', () => {
    expect(10 * Math.log10(unilateralMax(UNI.p11))).toBeCloseTo(3.6, 1);
    expect(10 * Math.log10(unilateralMax(UNI.p22))).toBeCloseTo(1.9, 1);
    const s3 = unilateralGainCircle(UNI.p11, 10 ** 0.3)!;
    expect(cabs(s3.center)).toBeCloseTo(0.706, 2);
    expect(cargDeg(s3.center)).toBeCloseTo(120, 6);
    expect(s3.radius).toBeCloseTo(0.166, 2);
    const s2 = unilateralGainCircle(UNI.p11, 10 ** 0.2)!;
    expect(cabs(s2.center)).toBeCloseTo(0.627, 2);
    expect(s2.radius).toBeCloseTo(0.294, 2);
    const l0 = unilateralGainCircle(UNI.p22, 1)!;
    expect(cabs(l0.center)).toBeCloseTo(0.44, 2);
    expect(l0.radius).toBeCloseTo(0.44, 2);
  });

  it('every point of a circle has the circle’s gain; the maximum is a single point', () => {
    const circle = unilateralGainCircle(UNI.p11, 2)!;
    for (const g of circlePoints(circle, 36)) expect(unilateralSectionGain(UNI.p11, g)).toBeCloseTo(2, 9);
    const top = unilateralGainCircle(UNI.p11, unilateralMax(UNI.p11))!;
    expect(top.radius).toBeCloseTo(0, 9);
    expect(unilateralGainCircle(UNI.p11, unilateralMax(UNI.p11) * 1.01)).toBeNull();
  });

  it('U is 0 for a unilateral device and bounds the error otherwise', () => {
    expect(unilateralFigure(UNI).u).toBe(0);
    const f = unilateralFigure(AMP);
    expect(f.u).toBeGreaterThan(0);
    expect(f.lowDb).toBeLessThan(0);
    expect(f.highDb).toBeGreaterThan(0);
  });
});

/** Input impedance of a lumped network + load from an AC simulation at frequency f. */
function simulatedZin(net: LNetwork, zl: Complex, f: number): Complex {
  const w = 2 * Math.PI * f;
  const netlist: Netlist = emptyNetlist('L match');
  // a micro-ohm source resistance and 1 TΩ to ground at every node keep the DC operating point regular
  const els: ElementIR[] = [
    { type: 'V', name: 'V1', nodes: ['src', '0'], params: {}, source: { dc: 0, acMag: 1 } },
    { type: 'R', name: 'RS', nodes: ['src', 'n0'], params: {}, value: 1e-6 },
  ];
  // build from the R0 side towards the load: the elements are listed load-first
  let node = 'n0';
  let k = 0;
  const parts = [...net.elements].reverse();
  for (const e of parts) {
    k++;
    const value = e.value;
    if (e.position === 'series') {
      const next = `n${k}`;
      els.push(e.kind === 'L' ? { type: 'L', name: `L${k}`, nodes: [node, next], params: {}, value } : { type: 'C', name: `C${k}`, nodes: [node, next], params: {}, value });
      node = next;
    } else {
      els.push(e.kind === 'L' ? { type: 'L', name: `L${k}`, nodes: [node, '0'], params: {}, value } : { type: 'C', name: `C${k}`, nodes: [node, '0'], params: {}, value });
    }
  }
  // load: R + reactance
  els.push({ type: 'R', name: 'RL', nodes: [node, 'nl'], params: {}, value: zl.re });
  if (zl.im > 0) els.push({ type: 'L', name: 'LL', nodes: ['nl', '0'], params: {}, value: zl.im / w });
  else if (zl.im < 0) els.push({ type: 'C', name: 'CL', nodes: ['nl', '0'], params: {}, value: -1 / (w * zl.im) });
  else els.push({ type: 'R', name: 'RX', nodes: ['nl', '0'], params: {}, value: 1e-9 });
  const nodes = new Set(els.flatMap((e) => e.nodes).filter((n) => n !== '0'));
  for (const n of nodes) els.push({ type: 'R', name: `RG_${n}`, nodes: [n, '0'], params: {}, value: 1e12 });
  netlist.elements = els;
  netlist.analyses = [{ type: 'ac', sweep: 'list', points: 1, fstart: f, fstop: f, list: [f] }];
  const [r] = runAnalyses(netlist);
  if (r.error) throw new Error(r.error);
  const v = r.vectors.find((x) => x.name === 'V(N0)' || x.name === 'V(n0)')!;
  const i = r.vectors.find((x) => x.name.toUpperCase() === 'I(V1)')!;
  // I(V1) flows into + through the source: the network current is −I(V1)
  return cdiv(c(v.re[0], v.im![0]), c(-i.re[0], -i.im![0]));
}

describe('L-section matching', () => {
  const cases: [string, Complex][] = [
    ['RL > R0 with inductive load', c(200, 100)],
    ['RL < R0 with capacitive load', c(10, -15)],
    ['RL < R0 resistive', c(12.5, 0)],
  ];
  for (const [name, zl] of cases) {
    it(`${name}: both solutions present 50 Ω, also in simulation`, () => {
      const f = 100e6;
      const nets = lMatch(zl, 50, f);
      expect(nets).toHaveLength(2);
      for (const net of nets) {
        const z = networkInputImpedance(net, zl, f);
        expect(z.re).toBeCloseTo(50, 6);
        expect(Math.abs(z.im)).toBeLessThan(1e-6);
        const sim = simulatedZin(net, zl, f);
        expect(Math.abs(sim.re / 50 - 1)).toBeLessThan(1e-4);
        expect(Math.abs(sim.im)).toBeLessThan(1e-3);
      }
    });
  }

  it('networks for a source reflection coefficient present Z(Γ) to the device', () => {
    const m = conjugateMatch(AMP)!;
    const f = 4e9;
    for (const net of matchToGamma(m.gs, 50, f)) {
      // seen from the device: the network fed by a 50 Ω source looks like Z(ΓS)
      // equivalently the conjugate load is matched to 50 Ω
      const zl = conj(gammaToZ(m.gs, 50));
      const z = networkInputImpedance(net, zl, f);
      expect(z.re).toBeCloseTo(50, 6);
      expect(Math.abs(z.im)).toBeLessThan(1e-6);
    }
  });

  it('a matched load needs no network', () => {
    expect(lMatch(c(50), 50, 1e6)).toEqual([{ elements: [], topology: 'series-first' }]);
    expect(lMatch(c(-5, 0), 50, 1e6)).toEqual([]);
  });

  it('complex helpers stay consistent', () => {
    const a = c(1, 2);
    const b = c(-0.5, 0.25);
    const q = cdiv(cmul(a, b), b);
    expect(q.re).toBeCloseTo(1, 12);
    expect(q.im).toBeCloseTo(2, 12);
    expect(cabs(csub(cadd(a, b), b))).toBeCloseTo(cabs(a), 12);
  });
});
