/**
 * Round-3 Basic-group parts through the whole path (library part → netlister → engine), each in a
 * small bench, against circuit theory: the self-resonance of the non-ideal R / L / C equals
 * 1/(2π√(L·C)) with the impedance the equivalent circuit predicts there, Z loads give exactly
 * R + jX at their frequency, resistor packs / DIP switches / rotary switches / keypads connect the
 * right pins, sockets and annotation symbols do not change the circuit, multi-winding
 * transformers keep their turns ratios, three coupled inductors their mutual inductances, the
 * saturating core its magnetising current and knee, and the 3D parts simulate like their
 * generic parts.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '..';
import { asLibraryPart } from '../partkit';
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { buildBom } from '../../model/bom';
import { runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { BASIC_EXTRA_CATALOG, bandColors, coreFit, keypadParam } from './basicExtras';

class Bench {
  readonly b = new DesignBuilder('bench');
  private x = 0;
  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string>): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }
  build() {
    return buildNetlist(this.b.design, { includeAnalysis: false });
  }
  run(...analyses: AnalysisSpec[]): AnalysisResult[] {
    const build = this.build();
    expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
    const res = runAnalyses({ ...build.netlist, analyses });
    for (const r of res) expect(r.error, r.error).toBeUndefined();
    return res;
  }
}

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
};
const re = (r: AnalysisResult, name: string, i: number) => vec(r, name).re[i];
const im = (r: AnalysisResult, name: string, i: number) => vec(r, name).im?.[i] ?? 0;
const mag = (r: AnalysisResult, name: string, i: number) => Math.hypot(re(r, name, i), im(r, name, i));
const op = (r: AnalysisResult, name: string) => r.scalars![name];

/** Complex arithmetic for the reference impedances. */
type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const par = (a: C, b: C): C => div(mul(a, b), add(a, b));
const abs = (a: C) => Math.hypot(a[0], a[1]);

/**
 * Impedance of a part driven by a 1 V AC source through a 1 Ω sense resistor (so neither a DC
 * short nor a DC-blocking load upsets the operating point): the result's vector "Z" holds
 * Z = V(z) / I with I = (V(in) − V(z)) / 1 Ω.
 */
function impedance(id: string, params: Record<string, string>, freqs: number[], pins: [string, string] = ['1', '2']): AnalysisResult {
  const k = new Bench();
  k.part('sources/ac-voltage', 'V1', { amplitude: '0', acmag: '1' }, { '+': 'in', '-': '0' });
  k.part('basic/resistor', 'RSENSE', { value: '1' }, { '1': 'in', '2': 'z' });
  k.part(id, 'X1', params, { [pins[0]]: 'z', [pins[1]]: '0' });
  const r = k.run({ type: 'ac', sweep: 'list', points: freqs.length, fstart: freqs[0], fstop: freqs[freqs.length - 1], list: freqs })[0];
  const vin = vec(r, 'V(in)');
  const vz = vec(r, 'V(z)');
  const zr = new Float64Array(freqs.length);
  const zi = new Float64Array(freqs.length);
  freqs.forEach((_, n) => {
    const v: C = [vz.re[n], vz.im?.[n] ?? 0];
    const [a, b] = div(v, [vin.re[n] - v[0], (vin.im?.[n] ?? 0) - v[1]]);
    zr[n] = a;
    zi[n] = b;
  });
  return { ...r, vectors: [...r.vectors, { ...vz, name: 'Z', re: zr, im: zi }] };
}

/** Log-spaced frequencies around f0 (±span decades). */
const around = (f0: number, span = 0.3, n = 241) => Array.from({ length: n }, (_, i) => f0 * Math.pow(10, -span + (2 * span * i) / (n - 1)));

describe('non-ideal RLC', () => {
  it('capacitor: self-resonance at 1/(2π√(ESL·C)) with |Z| = ESR there, capacitive below and inductive above', () => {
    const c = 100e-9;
    const esl = 2e-9;
    const esr = 30e-3;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(esl * c));
    const fs = around(f0);
    const r = impedance('basic/nonideal-capacitor', {}, fs);
    const zs = fs.map((_, i) => mag(r, 'Z', i));
    const iMin = zs.indexOf(Math.min(...zs));
    expect(fs[iMin] / f0).toBeGreaterThan(0.995);
    expect(fs[iMin] / f0).toBeLessThan(1.005);
    // exact reference: ESR + jωESL + (1/jωC ∥ Rleak)
    fs.forEach((f, i) => {
      const w = 2 * Math.PI * f;
      const z = add([esr, w * esl], par([0, -1 / (w * c)], [1e9, 0]));
      expect(zs[i] / abs(z), `f=${f}`).toBeCloseTo(1, 6);
    });
    const [at] = [impedance('basic/nonideal-capacitor', {}, [f0])];
    expect(mag(at, 'Z', 0)).toBeCloseTo(esr, 4);
    // well below: capacitive (−90°), well above: inductive (+90°)
    const lohi = impedance('basic/nonideal-capacitor', {}, [f0 / 100, f0 * 100]);
    expect(Math.atan2(im(lohi, 'Z', 0), re(lohi, 'Z', 0)) * (180 / Math.PI)).toBeLessThan(-89);
    expect(Math.atan2(im(lohi, 'Z', 1), re(lohi, 'Z', 1)) * (180 / Math.PI)).toBeGreaterThan(89);
  });

  it('inductor: impedance peak at 1/(2π√(L·Cp)) equal to the equivalent-circuit value', () => {
    const l = 100e-6;
    const cp = 5e-12;
    const rs = 0.2;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(l * cp));
    const fs = around(f0, 0.2, 201);
    const r = impedance('basic/nonideal-inductor', {}, fs);
    const zs = fs.map((_, i) => mag(r, 'Z', i));
    const iMax = zs.indexOf(Math.max(...zs));
    expect(fs[iMax] / f0).toBeGreaterThan(0.995);
    expect(fs[iMax] / f0).toBeLessThan(1.005);
    const w0 = 2 * Math.PI * f0;
    const zf0 = par([rs, w0 * l], [0, -1 / (w0 * cp)]);
    const exact = impedance('basic/nonideal-inductor', {}, [f0]);
    expect(mag(exact, 'Z', 0) / abs(zf0)).toBeCloseTo(1, 6);
    // the peak is about Q²·Rs = (ω0·L)²/Rs
    expect(abs(zf0) / ((w0 * l) ** 2 / rs)).toBeCloseTo(1, 2);
    // a core-loss resistance caps the peak
    const lossy = impedance('basic/nonideal-inductor', { rpar: '10k' }, [f0]);
    expect(mag(lossy, 'Z', 0)).toBeLessThan(10e3);
    expect(mag(lossy, 'Z', 0)).toBeGreaterThan(9e3);
  });

  it('resistor: R at low frequency, the (R + jωLs) ∥ Cp impedance at high frequency', () => {
    const fs = [1e3, 10e6, 100e6, 1e9];
    const r = impedance('basic/nonideal-resistor', { value: '10k', ls: '15n', cp: '0.3p' }, fs);
    fs.forEach((f, i) => {
      const w = 2 * Math.PI * f;
      const z = par([10e3, w * 15e-9], [0, -1 / (w * 0.3e-12)]);
      expect(mag(r, 'Z', i) / abs(z), `f=${f}`).toBeCloseTo(1, 6);
    });
    expect(mag(r, 'Z', 0)).toBeCloseTo(10e3, 0);
    // a 10 kΩ resistor reads only ~ 1/(ωCp) ≈ 530 Ω at 1 GHz
    expect(mag(r, 'Z', 3)).toBeLessThan(600);
  });

  it('electrolytic: the impedance floor is the ESR at the self-resonance', () => {
    const f0 = 1 / (2 * Math.PI * Math.sqrt(10e-9 * 100e-6));
    const r = impedance('basic/nonideal-electrolytic', {}, [100, f0], ['+', '-']);
    expect(mag(r, 'Z', 1)).toBeCloseTo(0.15, 3);
    expect(mag(r, 'Z', 0)).toBeCloseTo(Math.hypot(0.15, 1 / (2 * Math.PI * 100 * 100e-6)), 2);
  });
});

describe('Z load', () => {
  it('R + jX at its frequency, for both forms and both equivalent circuits', () => {
    for (const topology of ['series', 'parallel']) {
      for (const [x, label] of [
        ['25', 'inductive'],
        ['-40', 'capacitive'],
      ]) {
        const r = impedance('basic/z-load-rx', { r: '50', x, freq: '1k', topology }, [1e3]);
        expect(re(r, 'Z', 0), `${topology} ${label}`).toBeCloseTo(50, 6);
        expect(im(r, 'Z', 0), `${topology} ${label}`).toBeCloseTo(Number(x), 6);
      }
    }
    const p = impedance('basic/z-load-polar', { mag: '100', phase: '-30', freq: '2k' }, [2e3]);
    expect(re(p, 'Z', 0)).toBeCloseTo(100 * Math.cos(Math.PI / 6), 6);
    expect(im(p, 'Z', 0)).toBeCloseTo(-50, 6);
    expect(mag(p, 'Z', 0)).toBeCloseTo(100, 6);
  });

  it('behaves like its R-L / R-C pair away from the design frequency', () => {
    // series 50 + j25 at 1 kHz is 50 Ω + 3.979 mH: at 2 kHz X doubles
    const ind = impedance('basic/z-load-rx', { r: '50', x: '25', freq: '1k' }, [2e3]);
    expect(im(ind, 'Z', 0)).toBeCloseTo(50, 6);
    // series 50 − j40 is 50 Ω + 3.979 µF: at 2 kHz X halves
    const cap = impedance('basic/z-load-rx', { r: '50', x: '-40', freq: '1k' }, [2e3]);
    expect(im(cap, 'Z', 0)).toBeCloseTo(-20, 6);
    // pure reactance (R = 0) and a zero impedance
    const pure = impedance('basic/z-load-polar', { mag: '10', phase: '90', freq: '1k' }, [1e3]);
    expect(re(pure, 'Z', 0)).toBeCloseTo(0, 9);
    expect(im(pure, 'Z', 0)).toBeCloseTo(10, 6);
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '1' }, { '+': 'a', '-': '0' });
    k.part('basic/z-load-rx', 'Z1', { r: '0', x: '0' }, { '1': 'a', '2': '0' });
    expect(k.build().erc.find((m) => m.severity === 'error')?.message).toMatch(/must not be zero/);
  });
});

describe('resistor packs', () => {
  it('bussed SIP: every pin to the common pin', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    const pins: Record<string, string> = { '1': 'vcc' };
    for (let p = 2; p <= 9; p++) pins[String(p)] = '0';
    k.part('basic/rpack-sip9-bussed-10k', 'RN1', {}, pins);
    const [r] = k.run({ type: 'op' });
    // 8 × 10 kΩ in parallel from 5 V
    expect(-op(r, 'I(V1)')).toBeCloseTo((8 * 5) / 10e3, 9);
  });

  it('isolated DIP: resistor k between pin k and pin n+1−k only', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '1' }, { '+': 'a', '-': '0' });
    k.part('basic/rpack-dip16-isolated', 'RN1', { value: '1k' }, { '3': 'a', '14': '0', '2': 'b', '15': 'c' });
    k.part('basic/resistor', 'R9', { value: '1k' }, { '1': 'b', '2': '0' });
    k.part('basic/resistor', 'R10', { value: '1k' }, { '1': 'c', '2': '0' });
    const [r] = k.run({ type: 'op' });
    expect(-op(r, 'I(V1)')).toBeCloseTo(1e-3, 9);
    expect(op(r, 'V(b)')).toBeCloseTo(0, 9);
  });

  it('dual terminator: Thevenin V·R2/(R1 + R2) behind R1 ∥ R2', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    k.part('basic/rpack-sip10-terminator', 'RN1', {}, { V: 'vcc', G: '0', L1: 'l1', L2: 'l2' });
    k.part('basic/resistor', 'RL', { value: '132' }, { '1': 'l2', '2': '0' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(l1)')).toBeCloseTo((5 * 330) / 550, 9);
    // loaded by R1 ∥ R2 = 132 Ω the line drops to half its open voltage
    expect(op(r, 'V(l2)')).toBeCloseTo((5 * 330) / 550 / 2, 9);
  });
});

describe('sockets and annotation symbols', () => {
  it('a socket passes each net through and is listed in the BOM; markers do not simulate', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    k.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'vcc', '2': 'mid' });
    k.part('basic/socket-dip8', 'XS1', {}, { '3': 'mid', '6': 'other' });
    k.part('basic/resistor', 'R2', { value: '1k' }, { '1': 'mid', '2': '0' });
    k.part('basic/resistor', 'R3', { value: '1k' }, { '1': 'other', '2': '0' });
    // chassis / earth markers and a test point on "mid": still 2.5 V (they never join ground)
    k.part('basic/earth-marker', 'PE1', {}, { '1': 'mid' });
    k.part('basic/chassis-marker', 'CH1', {}, { '1': 'mid' });
    k.part('basic/test-point', 'TP1', {}, { '1': 'mid' });
    k.part('basic/antenna', 'ANT1', {}, { '1': 'other' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(mid)')).toBeCloseTo(2.5, 9);
    expect(op(r, 'V(other)')).toBeCloseTo(0, 9);
    const bom = buildBom(k.b.design).map((row) => row.refdes.join(','));
    expect(bom.some((x) => x.includes('XS1'))).toBe(true);
    expect(bom.some((x) => x.includes('TP1'))).toBe(true);
    expect(bom.some((x) => x.includes('PE1') || x.includes('CH1'))).toBe(false);
    for (const p of BASIC_EXTRA_CATALOG.filter((x) => asLibraryPart(x).annotation)) expect(p.toSpice, p.id).toBeUndefined();
    expect(BASIC_EXTRA_CATALOG.filter((x) => asLibraryPart(x).annotation).length).toBe(16);
  });

  it('the no-connect mark silences the floating-pin warning', () => {
    const open = new Bench();
    open.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    open.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'vcc' });
    expect(open.build().erc.some((m) => m.code === 'floating-pin' && m.refdes === 'R1')).toBe(true);
    const marked = new Bench();
    marked.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    const r = marked.part('basic/resistor', 'R1', { value: '1k' }, { '1': 'vcc' });
    const nc = marked.b.part('basic/no-connect', 'NC1', 2000, 2000);
    marked.b.connect(r, '2', nc, '1');
    expect(marked.build().erc.filter((m) => m.code === 'floating-pin' || m.code === 'single-pin-net')).toEqual([]);
  });
});

describe('switches', () => {
  it('DIP switch: only the closed positions conduct', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    const pins: Record<string, string> = {};
    for (let i = 1; i <= 4; i++) {
      pins[`A${i}`] = 'vcc';
      pins[`B${i}`] = `o${i}`;
      k.part('basic/resistor', `RL${i}`, { value: '1k' }, { '1': `o${i}`, '2': '0' });
    }
    k.part('basic/dip-switch-4', 'S1', { s2: 'true', s4: 'true' }, pins);
    const [r] = k.run({ type: 'op' });
    expect([1, 2, 3, 4].map((i) => Math.round(op(r, `V(o${i})`) * 1000) / 1000)).toEqual([0, 5, 0, 5]);
  });

  it('rotary switch: COM reaches the selected position only', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    const pins: Record<string, string> = { COM: 'vcc' };
    for (let i = 1; i <= 6; i++) {
      pins[`P${i}`] = `p${i}`;
      k.part('basic/resistor', `RL${i}`, { value: '1k' }, { '1': `p${i}`, '2': '0' });
    }
    k.part('basic/rotary-switch-6', 'S1', { position: '3' }, pins);
    const [r] = k.run({ type: 'op' });
    expect([1, 2, 3, 4, 5, 6].map((i) => Math.round(op(r, `V(p${i})`) * 1000) / 1000)).toEqual([0, 0, 5, 0, 0, 0]);
  });

  it('keypad: a pressed key joins its row to its column', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    const pins: Record<string, string> = {};
    for (let i = 1; i <= 4; i++) {
      pins[`R${i}`] = i === 2 ? 'vcc' : `r${i}`;
      pins[`C${i}`] = `c${i}`;
      k.part('basic/resistor', `RC${i}`, { value: '10k' }, { '1': `c${i}`, '2': '0' });
      if (i !== 2) k.part('basic/resistor', `RR${i}`, { value: '10k' }, { '1': `r${i}`, '2': '0' });
    }
    // key "6" is row 2, column 3
    k.part('basic/keypad-4x4', 'S1', { [keypadParam('6')]: 'true' }, pins);
    const [r] = k.run({ type: 'op' });
    // (the open keys leak 100 MΩ each)
    expect(op(r, 'V(c3)')).toBeCloseTo((5 * 10e3) / (10e3 + 10), 4);
    expect(op(r, 'V(c2)')).toBeLessThan(1e-3);
    expect(keypadParam('*')).toBe('kstar');
    expect(keypadParam('#')).toBe('khash');
    expect(getPart('basic/keypad-4x4')!.interactive!.controls!.map((c) => c.key).join('')).toBe('123A456B789C*0#D');
  });
});

describe('magnetics', () => {
  it('multi-winding transformers keep their turns ratios', () => {
    const k = new Bench();
    k.part('sources/ac-voltage', 'V1', { amplitude: '0', acmag: '100' }, { '+': 'p', '-': '0' });
    k.part('basic/transformer-1p2s', 'T1', { n1: '10', n2: '4' }, { P1: 'p', P2: '0', S1: 'a', S2: '0', S3: 'b', S4: '0' });
    k.part('basic/resistor', 'RA', { value: '1Meg' }, { '1': 'a', '2': '0' });
    k.part('basic/resistor', 'RB', { value: '1Meg' }, { '1': 'b', '2': '0' });
    k.part('sources/ac-voltage', 'V2', { amplitude: '0', acmag: '230' }, { '+': 'q', '-': '0' });
    // dual primary in series (P2 to P3), two secondaries 20:1 each
    k.part('basic/transformer-2p2s', 'T2', { n1: '20', n2: '20' }, { P1: 'q', P2: 'm', P3: 'm', P4: '0', S1: 'c', S2: '0', S3: 'd', S4: '0' });
    k.part('basic/resistor', 'RC', { value: '1Meg' }, { '1': 'c', '2': '0' });
    k.part('basic/resistor', 'RD', { value: '1Meg' }, { '1': 'd', '2': '0' });
    const [r] = k.run({ type: 'ac', sweep: 'list', points: 1, fstart: 50, fstop: 50, list: [50] });
    expect(mag(r, 'V(a)', 0)).toBeCloseTo(10, 1);
    expect(mag(r, 'V(b)', 0)).toBeCloseTo(25, 1);
    // each 20:1 secondary sees half the series primary voltage
    expect(mag(r, 'V(c)', 0)).toBeCloseTo(230 / 2 / 20, 1);
    expect(mag(r, 'V(d)', 0)).toBeCloseTo(230 / 2 / 20, 1);
    expect(mag(r, 'V(m)', 0)).toBeCloseTo(115, 0);
  });

  it('three coupled inductors: open-circuit voltages ω·k·√(L1·Lx)·I1', () => {
    const k = new Bench();
    k.part('sources/ac-current', 'I1', { amplitude: '0', acmag: '1' }, { '+': 'l1', '-': '0' });
    k.part('basic/coupled-inductors-3', 'T1', { l1: '1m', l2: '4m', l3: '9m', k12: '0.9', k13: '0.5', k23: '0.3' }, { 'L1+': 'l1', 'L1-': '0', 'L2+': 'l2', 'L2-': '0', 'L3+': 'l3', 'L3-': '0' });
    k.part('basic/resistor', 'R2', { value: '1G' }, { '1': 'l2', '2': '0' });
    k.part('basic/resistor', 'R3', { value: '1G' }, { '1': 'l3', '2': '0' });
    const f = 1e3;
    const w = 2 * Math.PI * f;
    const [r] = k.run({ type: 'ac', sweep: 'list', points: 1, fstart: f, fstop: f, list: [f] });
    expect(mag(r, 'V(l1)', 0)).toBeCloseTo(w * 1e-3, 6);
    expect(mag(r, 'V(l2)', 0)).toBeCloseTo(w * 0.9 * Math.sqrt(1e-3 * 4e-3), 6);
    expect(mag(r, 'V(l3)', 0)).toBeCloseTo(w * 0.5 * Math.sqrt(1e-3 * 9e-3), 6);
    const bad = new Bench();
    bad.part('sources/ac-current', 'I1', { amplitude: '0', acmag: '1' }, { '+': 'l1', '-': '0' });
    bad.part('basic/coupled-inductors-3', 'T1', { k12: '0.99', k13: '0.99', k23: '0' }, { 'L1+': 'l1', 'L1-': '0', 'L2+': '0', 'L2-': '0', 'L3+': '0', 'L3-': '0' });
    expect(bad.build().erc.find((m) => m.severity === 'error')?.message).toMatch(/not physically possible/);
  });

  it('saturating transformer: exact ratio, rated magnetising current, sharp rise above the knee', () => {
    const run = (scale: number) => {
      const k = new Bench();
      // cosine drive from zero initial state (uic): λ = Vpk/ω·sin(ωt), no DC flux offset (no inrush)
      k.part('sources/ac-voltage', 'V1', { amplitude: String(scale * 230 * Math.SQRT2), freq: '50', phase: '90' }, { '+': 'in', '-': '0' });
      k.part('basic/resistor', 'RS', { value: '0.1' }, { '1': 'in', '2': 'p' });
      k.part('basic/transformer-saturating', 'T1', {}, { P1: 'p', P2: '0', S1: 's', S2: '0' });
      k.part('basic/resistor', 'RL', { value: '1Meg' }, { '1': 's', '2': '0' });
      const [tr] = k.run({ type: 'tran', tstep: 20e-6, tstop: 60e-3, tmax: 20e-6, uic: true });
      const t = tr.scale!.re;
      const a = vec(tr, 'V(in)').re;
      const b = vec(tr, 'V(p)').re;
      const s = vec(tr, 'V(s)').re;
      let ipk = 0;
      let vpk = 0;
      let spk = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] < 40e-3) continue;
        ipk = Math.max(ipk, Math.abs((a[i] - b[i]) / 0.1));
        vpk = Math.max(vpk, Math.abs(b[i]));
        spk = Math.max(spk, Math.abs(s[i]));
      }
      return { ipk, ratio: vpk / spk };
    };
    const rated = run(1);
    expect(rated.ratio).toBeCloseTo(10, 1);
    expect(rated.ipk / (20e-3 * Math.SQRT2)).toBeGreaterThan(0.95);
    expect(rated.ipk / (20e-3 * Math.SQRT2)).toBeLessThan(1.05);
    const over = run(1.5);
    // linear core: 1.5×; this core: the model's own curve i(1.5·λr)/i(λr)
    const x = 1.5 / 1.3;
    const expected = (1.5 * (1 + x ** 8)) / (1 + (1 / 1.3) ** 8);
    expect(over.ipk / rated.ipk).toBeGreaterThan(0.95 * expected);
    expect(over.ipk / rated.ipk).toBeLessThan(1.05 * expected);
    expect(over.ipk / rated.ipk).toBeGreaterThan(4);
    const fit = coreFit(230, 50, 20e-3, 1.3);
    expect(fit.lrated).toBeCloseTo((230 * Math.SQRT2) / (2 * Math.PI * 50), 9);
  });

  it('saturating inductor: L below the knee, L/10 incremental at Isat', () => {
    const k = new Bench();
    // 0 → 2 A in 1 ms through 1 mH / Isat = 1 A
    k.part('sources/pulse-current', 'I1', { v1: '0', v2: '2', delay: '0', rise: '1m', fall: '1m', width: '1', period: '3' }, { '+': 'a', '-': '0' });
    k.part('basic/inductor-saturating', 'L1', { value: '1m', isat: '1', rser: '0' }, { '1': 'a', '2': '0' });
    const [tr] = k.run({ type: 'tran', tstep: 1e-6, tstop: 0.9e-3, tmax: 1e-6 });
    const t = tr.scale!.re;
    const v = vec(tr, 'V(a)').re;
    const slope = 2 / 1e-3;
    const near = (tt: number) => v[t.findIndex((x) => x >= tt)];
    expect(near(0.05e-3) / (1e-3 * slope)).toBeCloseTo(1, 2);
    // i = Isat at t = 0.5 ms: λ = λsat, di/dλ = 10/L
    expect(near(0.5e-3) / ((1e-3 / 10) * slope)).toBeGreaterThan(0.95);
    expect(near(0.5e-3) / ((1e-3 / 10) * slope)).toBeLessThan(1.05);
  });
});

describe('voltage-controlled R, C, L', () => {
  it('R = R0 + kr·V(c), C = C0 + kc·V(c) (i = C·dv/dt), L = L0 + kl·V(c) (X = ωL)', () => {
    const k = new Bench();
    k.part('sources/dc-voltage', 'VC', { value: '2' }, { '+': 'ctl', '-': '0' });
    k.part('sources/dc-voltage', 'V1', { value: '1' }, { '+': 'a', '-': '0' });
    k.part('basic/vc-resistor', 'R1', { r0: '1k', kr: '500' }, { '1': 'a', '2': '0', 'C+': 'ctl', 'C-': '0' });
    const [r] = k.run({ type: 'op' });
    expect(-op(r, 'I(V1)')).toBeCloseTo(1 / 2000, 9);
    // the minimum clamps a negative control: R = max(1k − 5k, 10 Ω)
    const m = new Bench();
    m.part('sources/dc-voltage', 'VC', { value: '-5' }, { '+': 'ctl', '-': '0' });
    m.part('sources/dc-voltage', 'V1', { value: '1' }, { '+': 'a', '-': '0' });
    m.part('basic/vc-resistor', 'R1', { r0: '1k', kr: '1k', rmin: '10' }, { '1': 'a', '2': '0', 'C+': 'ctl', 'C-': '0' });
    expect(-op(m.run({ type: 'op' })[0], 'I(V1)')).toBeCloseTo(0.1, 6);
    // 1 mA into C = 1 µ + 1 µ/V · 1 V = 2 µF: dV/dt = 500 V/s
    const c = new Bench();
    c.part('sources/dc-voltage', 'VC', { value: '1' }, { '+': 'ctl', '-': '0' });
    c.part('sources/pulse-current', 'I1', { v1: '0', v2: '1m', delay: '0', rise: '1n', fall: '1n', width: '1', period: '2' }, { '+': 'a', '-': '0' });
    c.part('basic/vc-capacitor', 'C1', { c0: '1u', kc: '1u' }, { '1': 'a', '2': '0', 'C+': 'ctl', 'C-': '0' });
    const [tr] = c.run({ type: 'tran', tstep: 1e-5, tstop: 2e-3 });
    const t = tr.scale!.re;
    const va = vec(tr, 'V(a)').re;
    expect(va[va.length - 1] / t[t.length - 1]).toBeCloseTo(500, 0);
    const l = new Bench();
    l.part('sources/dc-voltage', 'VC', { value: '10' }, { '+': 'ctl', '-': '0' });
    l.part('sources/ac-voltage', 'V1', { amplitude: '0', acmag: '1' }, { '+': 'in', '-': '0' });
    l.part('basic/resistor', 'RS', { value: '1' }, { '1': 'in', '2': 'z' });
    l.part('basic/vc-inductor', 'L1', { l0: '1m', kl: '100u' }, { '1': 'z', '2': '0', 'C+': 'ctl', 'C-': '0' });
    const [ac] = l.run({ type: 'ac', sweep: 'list', points: 1, fstart: 1e3, fstop: 1e3, list: [1e3] });
    const vz: C = [re(ac, 'V(z)', 0), im(ac, 'V(z)', 0)];
    const z = div(vz, [1 - vz[0], -vz[1]]);
    expect(z[0]).toBeCloseTo(0, 6);
    expect(z[1]).toBeCloseTo(2 * Math.PI * 1e3 * 2e-3, 6);
  });
});

describe('3D learner parts', () => {
  it('colour bands follow IEC 60062 and the parts simulate like the generic ones', () => {
    expect(bandColors(4.7e3)).toEqual(['#f4d21f', '#7a3db8', '#d42a1f', '#c9a23a']);
    expect(bandColors(220)).toEqual(['#d42a1f', '#d42a1f', '#6b3a1e', '#c9a23a']);
    expect(bandColors(100e3)[2]).toBe('#f4d21f');
    const k = new Bench();
    k.part('sources/dc-voltage', 'V1', { value: '5' }, { '+': 'vcc', '-': '0' });
    k.part('basic/3d-resistor-330', 'R1', {}, { '1': 'vcc', '2': 'a' });
    k.part('basic/3d-led-red', 'LED1', {}, { A: 'a', K: '0' });
    k.part('basic/resistor', 'R2', { value: '330' }, { '1': 'vcc', '2': 'b' });
    k.part('diodes/led-red', 'LED2', {}, { A: 'b', K: '0' });
    k.part('basic/3d-npn-2n3904', 'Q1', {}, { C: 'vcc', B: 'bb', E: 'e' });
    k.part('transistors/2n3904', 'Q2', {}, { C: 'vcc', B: 'bb', E: 'e2' });
    k.part('basic/resistor', 'RB', { value: '100k' }, { '1': 'vcc', '2': 'bb' });
    k.part('basic/resistor', 'RE1', { value: '1k' }, { '1': 'e', '2': '0' });
    k.part('basic/resistor', 'RE2', { value: '1k' }, { '1': 'e2', '2': '0' });
    const [r] = k.run({ type: 'op' });
    expect(op(r, 'V(a)')).toBeCloseTo(op(r, 'V(b)'), 9);
    expect(op(r, 'V(e)')).toBeCloseTo(op(r, 'V(e2)'), 9);
    for (const p of BASIC_EXTRA_CATALOG.filter((x) => x.family === '3D learner parts')) {
      expect(p.symbol.prims.some((x) => (x.kind === 'rect' || x.kind === 'circle' || x.kind === 'path') && typeof x.fill === 'string'), p.id).toBe(true);
      expect(p.toSpice, p.id).toBeDefined();
    }
  });
});
