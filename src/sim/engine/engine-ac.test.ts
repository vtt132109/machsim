import { describe, expect, it } from 'vitest';
import { findVector, type AnalysisResult } from '../results';
import { sweepFrequencies } from './ac';
import { buildAcSystem } from './analyses';
import { Circuit } from './circuit';
import { runAnalyses } from './run';
import { cap, coupling, ind, netlist, res, tline, vccs, vsrc } from './testing';

interface C {
  re: number;
  im: number;
}
const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cadd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const cabs = (a: C) => Math.hypot(a.re, a.im);
const relC = (a: C, b: C) => cabs({ re: a.re - b.re, im: a.im - b.im }) / cabs(b);

function phasor(r: AnalysisResult, name: string, k: number): C {
  const v = findVector(r, name);
  if (!v || !v.im) throw new Error(`missing complex vector ${name}`);
  return { re: v.re[k], im: v.im[k] };
}

describe('AC frequency grids', () => {
  it('decade, octave, linear and list sweeps', () => {
    const dec = sweepFrequencies('dec', 10, 1, 1e6);
    expect(dec.length).toBe(61);
    expect(dec[10]).toBeCloseTo(10, 10);
    expect(dec[60]).toBeCloseTo(1e6, 4);
    const oct = sweepFrequencies('oct', 2, 100, 1600);
    expect(oct.length).toBe(9);
    expect(oct[2]).toBeCloseTo(200, 10);
    expect(sweepFrequencies('lin', 5, 0, 100)).toEqual([0, 25, 50, 75, 100]);
    expect(sweepFrequencies('list', 0, 0, 0, [3, 1, 2])).toEqual([3, 1, 2]);
    // fstop not on the grid is appended
    const odd = sweepFrequencies('dec', 1, 1, 50);
    expect(odd).toEqual([1, 10, 50]);
    expect(() => sweepFrequencies('dec', 10, 0, 100)).toThrow(/fstart/);
  });
});

describe('AC analysis', () => {
  it('RC low-pass magnitude and phase at many frequencies', () => {
    const R = 1e3;
    const Cv = 1e-6;
    const [r] = runAnalyses(
      netlist([vsrc('V1', 'in', '0', { dc: 0, acMag: 1 }), res('R1', 'in', 'out', R), cap('C1', 'out', '0', Cv)], [
        { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e6 },
      ]),
    );
    expect(r.error).toBeUndefined();
    expect(r.scale?.name).toBe('frequency');
    expect(r.scale?.unit).toBe('Hz');
    const f = r.scale?.re as Float64Array;
    expect(f.length).toBe(121);
    for (let k = 0; k < f.length; k++) {
      const w = 2 * Math.PI * f[k];
      const h = cdiv({ re: 1, im: 0 }, { re: 1, im: w * R * Cv });
      const v = phasor(r, 'V(out)', k);
      expect(relC(v, h)).toBeLessThan(1e-9);
      expect(Math.abs(Math.atan2(v.im, v.re) - -Math.atan(w * R * Cv))).toBeLessThan(1e-9);
    }
    // the -3 dB point
    const fc = 1 / (2 * Math.PI * R * Cv);
    const [rc] = runAnalyses(
      netlist([vsrc('V1', 'in', '0', { acMag: 1 }), res('R1', 'in', 'out', R), cap('C1', 'out', '0', Cv)], [{ type: 'acsingle', freq: fc }]),
    );
    expect(rc.type).toBe('acsingle');
    expect(cabs(phasor(rc, 'V(out)', 0))).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('series RLC resonates at 1/(2π√LC) with current V/R and phase 0', () => {
    const R = 10;
    const L = 1e-3;
    const Cv = 1e-6;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * Cv));
    const freqs = [f0 / 3, f0 / 1.1, f0, f0 * 1.1, f0 * 3];
    const [r] = runAnalyses(
      netlist([vsrc('V1', 'in', '0', { acMag: 1 }), res('R1', 'in', 'a', R), ind('L1', 'a', 'b', L), cap('C1', 'b', '0', Cv)], [
        { type: 'ac', sweep: 'list', points: 0, fstart: 0, fstop: 0, list: freqs },
      ]),
    );
    expect(r.error).toBeUndefined();
    freqs.forEach((f, k) => {
      const w = 2 * Math.PI * f;
      const z = { re: R, im: w * L - 1 / (w * Cv) };
      // SPICE sign: the source delivers the current, I(V1) = -V/Z
      const i = cdiv({ re: -1, im: 0 }, z);
      expect(relC(phasor(r, 'I(V1)', k), i)).toBeLessThan(1e-9);
      expect(relC(phasor(r, 'I(L1)', k), cmul(i, { re: -1, im: 0 }))).toBeLessThan(1e-9);
    });
    const at = phasor(r, 'I(V1)', 2);
    expect(at.re).toBeCloseTo(-1 / R, 12);
    expect(Math.abs(at.im)).toBeLessThan(1e-12);
    // capacitor voltage magnification Q = (1/R) sqrt(L/C)
    expect(cabs(phasor(r, 'V(b)', 2))).toBeCloseTo(Math.sqrt(L / Cv) / R, 9);
    // a fine linear sweep peaks next to f0
    const [fine] = runAnalyses(
      netlist([vsrc('V1', 'in', '0', { acMag: 1 }), res('R1', 'in', 'a', R), ind('L1', 'a', 'b', L), cap('C1', 'b', '0', Cv)], [
        { type: 'ac', sweep: 'lin', points: 2001, fstart: 4000, fstop: 6000 },
      ]),
    );
    const fs = fine.scale?.re as Float64Array;
    const iv = findVector(fine, 'I(V1)');
    let best = 0;
    for (let k = 0; k < fs.length; k++) {
      if (Math.hypot(iv!.re[k], iv!.im![k]) > Math.hypot(iv!.re[best], iv!.im![best])) best = k;
    }
    expect(Math.abs(fs[best] - f0)).toBeLessThanOrEqual(0.5);
  });

  it('coupled inductors (K = 0.999) transform by k·sqrt(L2/L1)', () => {
    const L1 = 1e-3;
    const L2 = 100e-3;
    const k = 0.999;
    const RL = 1e9;
    const Rp = 1e-3; // a source directly across L1 would be a DC voltage-source/inductor loop
    const f = 1e3;
    const [r] = runAnalyses(
      netlist(
        [
          vsrc('V1', 'v', '0', { acMag: 1 }),
          res('Rp', 'v', 'p', Rp),
          ind('L1', 'p', '0', L1),
          ind('L2', 's', '0', L2),
          coupling('K1', ['L1', 'L2'], k),
          res('RL', 's', '0', RL),
        ],
        [{ type: 'acsingle', freq: f }],
      ),
    );
    expect(r.error).toBeUndefined();
    const w = 2 * Math.PI * f;
    const M = k * Math.sqrt(L1 * L2);
    // V2/V1 = RL*jωM / ((jωL2 + RL)*(Rp + jωL1) + ω²M²)
    const num = { re: 0, im: RL * w * M };
    const den = cadd(cmul({ re: RL, im: w * L2 }, { re: Rp, im: w * L1 }), { re: w * w * M * M, im: 0 });
    const ratio = phasor(r, 'V(s)', 0);
    expect(relC(ratio, cdiv(num, den))).toBeLessThan(1e-9);
    expect(Math.abs(cabs(ratio) - k * Math.sqrt(L2 / L1)) / (k * Math.sqrt(L2 / L1))).toBeLessThan(1e-3);
    expect(Math.abs(cabs(ratio) - Math.sqrt(L2 / L1)) / Math.sqrt(L2 / L1)).toBeLessThan(1.1e-3);
  });

  it('uses the source AC phase', () => {
    const [r] = runAnalyses(
      netlist([vsrc('V1', 'in', '0', { acMag: 2, acPhase: 30 }), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 1e3)], [
        { type: 'acsingle', freq: 50 },
      ]),
    );
    const v = phasor(r, 'V(out)', 0);
    expect(v.re).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(v.im).toBeCloseTo(Math.sin(Math.PI / 6), 12);
  });

  it('matched lossless line delays the phase by ω·td', () => {
    const z0 = 50;
    const td = 1e-9;
    const f = 123e6;
    const [r] = runAnalyses(
      netlist(
        [vsrc('V1', 's', '0', { acMag: 1 }), res('Rs', 's', 'in', z0), tline('T1', 'in', '0', 'out', '0', { z0, td }), res('RL', 'out', '0', z0)],
        [{ type: 'acsingle', freq: f }],
      ),
    );
    expect(r.error).toBeUndefined();
    const vin = phasor(r, 'V(in)', 0);
    const vout = phasor(r, 'V(out)', 0);
    expect(relC(vin, { re: 0.5, im: 0 })).toBeLessThan(1e-12);
    const wt = 2 * Math.PI * f * td;
    expect(relC(vout, { re: 0.5 * Math.cos(wt), im: -0.5 * Math.sin(wt) })).toBeLessThan(1e-12);
  });

  it('adjoint (transpose) solve gives the same transfer function as the forward solve', () => {
    const elements = [
      vsrc('V1', 'in', '0', { acMag: 1 }),
      res('R1', 'in', 'a', 1e3),
      cap('C1', 'a', '0', 1e-7),
      vccs('G1', 'b', '0', 'a', '0', 5e-3),
      res('R2', 'b', '0', 2e3),
      cap('C2', 'b', 'a', 1e-9),
      ind('L1', 'b', 'out', 1e-3),
      res('R3', 'out', '0', 300),
    ];
    const circuit = new Circuit(netlist(elements));
    const acs = buildAcSystem(circuit);
    const out = circuit.nodeIndex('out') as number;
    const w = 2 * Math.PI * 7.3e3;
    acs.assemble(w);
    acs.factor();
    const fwd = acs.solve();
    const n = circuit.size;
    const eRe = new Float64Array(n);
    const eIm = new Float64Array(n);
    eRe[out] = 1;
    const adj = acs.solveTranspose(eRe, eIm);
    // H = e_out^T A^{-1} b = (A^{-T} e_out)^T b
    let hr = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      hr += adj.re[i] * acs.rhsRe[i] - adj.im[i] * acs.rhsIm[i];
      hi += adj.re[i] * acs.rhsIm[i] + adj.im[i] * acs.rhsRe[i];
    }
    expect(relC({ re: hr, im: hi }, { re: fwd.re[out], im: fwd.im[out] })).toBeLessThan(1e-10);
  });
});
