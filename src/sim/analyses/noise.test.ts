import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import { BOLTZ, CHARGE, KELVIN } from '../device';
import type { AnalysisSpec, ElementIR } from '../netlist';
import { findVector, type AnalysisResult } from '../results';
import { cap, idc, isrc, model, netlist, res, vcvs, vdc, vsrc } from '../engine/testing';
import { integrateSpectrum } from './noise';

const T = 27 + KELVIN;
const FOUR_KT = 4 * BOLTZ * T;

function run(elements: ElementIR[], spec: AnalysisSpec, models = [] as ReturnType<typeof model>[]): AnalysisResult {
  const [r] = runAnalyses(netlist(elements, [spec], { models }));
  expect(r.error).toBeUndefined();
  return r;
}

function vec(r: AnalysisResult, name: string): Float64Array {
  const v = findVector(r, name);
  expect(v, `vector ${name}`).toBeDefined();
  return (v as { re: Float64Array }).re;
}

describe('noise analysis', () => {
  const divider = [vsrc('V1', 'in', '0', { dc: 1, acMag: 1 }), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 3e3)];
  const spec: AnalysisSpec = { type: 'noise', output: 'out', src: 'V1', sweep: 'dec', points: 5, fstart: 10, fstop: 1e5 };

  it('gives 4kT(R1||R2) at the output of a resistive divider', () => {
    const r = run(divider, spec);
    const psd = vec(r, 'onoise_psd');
    const expected = FOUR_KT * 750;
    for (const v of psd) expect(v / expected - 1).toBeCloseTo(0, 10);
    const dens = vec(r, 'onoise_spectrum');
    expect(dens[0]).toBeCloseTo(Math.sqrt(expected), 18);
    expect(findVector(r, 'onoise_spectrum')?.unit).toBe('V/rtHz');
    // gain and input-referred noise
    for (const g of vec(r, 'gain')) expect(g).toBeCloseTo(0.75, 12);
    const inPsd = vec(r, 'inoise_psd');
    for (const v of inPsd) expect(v / (expected / 0.5625) - 1).toBeCloseTo(0, 10);
    // per-device contributions: R1 75 %, R2 25 %
    const c1 = vec(r, 'onoise(R1)');
    const c2 = vec(r, 'onoise(R2)');
    expect(c1[0] / (FOUR_KT / 1e3) / 750 ** 2 - 1).toBeCloseTo(0, 10);
    expect(c2[0] / (FOUR_KT / 3e3) / 750 ** 2 - 1).toBeCloseTo(0, 10);
    const rows = r.table?.rows ?? [];
    expect(rows[0][0]).toBe('R1');
    expect(rows[0][3] as number).toBeCloseTo(75, 8);
    expect(rows[1][3] as number).toBeCloseTo(25, 8);
    // flat spectrum integrates exactly to S·(fstop − fstart)
    const total = r.scalars?.onoise_total_sq as number;
    expect(total / (expected * (1e5 - 10)) - 1).toBeCloseTo(0, 10);
    expect(r.scalars?.onoise_total).toBeCloseTo(Math.sqrt(total), 20);
    expect(r.scalars?.['onoise_total_sq(R1)'] as number).toBeCloseTo(0.75 * total, 20);
  });

  it('integrates RC noise to kT/C', () => {
    const R = 1e3;
    const C = 1e-9;
    const rc = [vdc('V1', 'in', '0', 0), res('R1', 'in', 'out', R), cap('C1', 'out', '0', C)];
    const r = run(rc, { type: 'noise', output: 'out', src: 'V1', sweep: 'dec', points: 50, fstart: 1, fstop: 1e12 });
    const fc = 1 / (2 * Math.PI * R * C);
    const exact = FOUR_KT * R * fc * (Math.atan(1e12 / fc) - Math.atan(1 / fc));
    const total = r.scalars?.onoise_total_sq as number;
    expect(Math.abs(total / exact - 1)).toBeLessThan(1e-7);
    expect(Math.abs(total / ((BOLTZ * T) / C) - 1)).toBeLessThan(1e-4);
    // low-frequency density is that of the resistor; at fc it is 3 dB down
    const f = r.scale?.re as Float64Array;
    const psd = vec(r, 'onoise_psd');
    expect(psd[0] / (FOUR_KT * R) - 1).toBeCloseTo(0, 8);
    const k = f.findIndex((x) => x >= 1e5);
    expect(psd[k] / (FOUR_KT * R / (1 + (f[k] / fc) ** 2)) - 1).toBeCloseTo(0, 10);
  });

  it('refers noise to a current-source input in A/rtHz', () => {
    const r = run([isrc('I1', '0', 'a', { dc: 0, acMag: 1 }), res('R1', 'a', '0', 2e3)], {
      type: 'noise',
      output: 'V(a)',
      src: 'I1',
      sweep: 'lin',
      points: 3,
      fstart: 100,
      fstop: 300,
    });
    expect(vec(r, 'gain')[1]).toBeCloseTo(2e3, 9);
    expect(findVector(r, 'inoise_spectrum')?.unit).toBe('A/rtHz');
    expect(vec(r, 'inoise_psd')[2] / (FOUR_KT / 2e3) - 1).toBeCloseTo(0, 10);
  });

  it('uses the instance temperature of a resistor', () => {
    const r = run([vdc('V1', 'in', '0', 0), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 1e3, { temp: 127 })], {
      type: 'noise',
      output: 'out',
      src: 'V1',
      sweep: 'lin',
      points: 1,
      fstart: 1e3,
      fstop: 1e3,
    });
    const expected = 4 * BOLTZ * (T / 1e3 + (127 + KELVIN) / 1e3) * 500 ** 2;
    expect(vec(r, 'onoise_psd')[0] / expected - 1).toBeCloseTo(0, 10);
  });

  it('includes diode shot noise from Device.noise()', () => {
    const I = 1e-3;
    const IS = 1e-14;
    const r = run([idc('I1', '0', 'a', I), { type: 'D', name: 'D1', nodes: ['a', '0'], params: {}, model: 'DMOD' }], {
      type: 'noise',
      output: 'a',
      src: 'I1',
      sweep: 'lin',
      points: 1,
      fstart: 1e3,
      fstop: 1e3,
    }, [model('DMOD', 'D', { is: IS, n: 1 })]);
    const vt = (BOLTZ * T) / CHARGE;
    const gd = (I + IS) / vt + 1e-12;
    const expected = (2 * CHARGE * I) / (gd * gd);
    expect(Math.abs(vec(r, 'onoise_psd')[0] / expected - 1)).toBeLessThan(1e-6);
    expect(findVector(r, 'onoise(D1)')).toBeDefined();
  });

  it('reports missing sources and bad outputs as errors', () => {
    const [r] = runAnalyses(netlist(divider, [{ ...spec, src: 'V9' } as AnalysisSpec]));
    expect(r.error).toMatch(/V9/);
    const [r2] = runAnalyses(netlist(divider, [{ ...spec, output: 'nowhere' } as AnalysisSpec]));
    expect(r2.error).toMatch(/nowhere/);
  });
});

describe('spectrum integration', () => {
  it('is exact for 1/f and white spectra', () => {
    const f = [1, 10, 100, 1000];
    expect(integrateSpectrum(f, f.map((x) => 1 / x))).toBeCloseTo(Math.log(1000), 12);
    expect(integrateSpectrum(f, f.map(() => 2))).toBeCloseTo(2 * 999, 10);
    expect(integrateSpectrum(f, f.map((x) => x * x))).toBeCloseTo((1000 ** 3 - 1) / 3, 3);
  });
});

describe('noise figure', () => {
  const amp = (extra: ElementIR[]) => [
    vsrc('V1', 'src', '0', { dc: 0, acMag: 1 }),
    res('RS', 'src', 'in', 50),
    vcvs('E1', 'out', '0', 'in', '0', 10),
    res('RL', 'out', '0', 1e3),
    ...extra,
  ];
  const spec: AnalysisSpec = { type: 'noisefig', output: 'out', src: 'V1', rsource: 50, freq: 1e3 };

  it('is 0 dB for a noiseless amplifier', () => {
    const r = run(amp([]), spec);
    expect(r.scalars?.noise_figure).toBeCloseTo(0, 9);
    expect(r.scalars?.noise_factor).toBeCloseTo(1, 9);
    expect(r.scalars?.gain).toBeCloseTo(10, 10);
    expect(r.warnings.some((w) => /source resistance/.test(w))).toBe(false);
  });

  it('is 3.01 dB for a matched resistive input', () => {
    const r = run(amp([res('RIN', 'in', '0', 50)]), spec);
    expect(r.scalars?.noise_factor).toBeCloseTo(2, 9);
    expect(r.scalars?.noise_figure).toBeCloseTo(10 * Math.log10(2), 9);
    expect(r.scalars?.inoise_density).toBeCloseTo(Math.sqrt(FOUR_KT * 100), 15);
  });

  it('warns when the source resistance is not in the circuit', () => {
    const r = run(amp([]), { ...spec, rsource: 600 } as AnalysisSpec);
    expect(r.warnings.some((w) => /600/.test(w))).toBe(true);
  });
});
