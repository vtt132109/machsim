/**
 * SPICE dialect round 3: .meas (TRAN / AC / DC, every kind), .step param (list / lin / dec / oct,
 * one run per value), E / G FREQ and CHEBYSHEV sources, LTspice parasitics (Rser / Lser / Rpar /
 * Cpar) and PWL pair lists with commas. Numbers are checked against hand formulas.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice, writeSpice } from '.';
import { runAnalyses } from '..';
import type { AnalysisResult, MeasurementResult } from '../results';
import { designChebyshev, cascadeAt, chebyshevOrder } from './chebyshev';
import { freqTableResponse } from '../devices/linear/freqTable';
import { parseMeasCard } from './measure';

function deck(text: string): AnalysisResult[] {
  const r = parseSpice(text);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  const res = runAnalyses(r.netlist);
  for (const x of res) expect(x.error, x.error).toBeUndefined();
  return res;
}
const meas = (r: AnalysisResult, name: string): MeasurementResult => {
  const m = r.measurements?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!m) throw new Error(`no measurement ${name}; have ${(r.measurements ?? []).map((x) => x.name).join(', ')}`);
  return m;
};
const mag = (r: AnalysisResult, name: string, i: number) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase())!;
  return Math.hypot(v.re[i], v.im?.[i] ?? 0);
};

const RC = 1e3 * 1e-6; // 1 ms

describe('.meas', () => {
  it('TRAN rise time of an RC step response: 10 % → 90 % = RC·ln 9', () => {
    const [tr] = deck(`* rise
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 1u 10m
.meas TRAN trise TRIG V(out) VAL=0.1 RISE=1 TARG V(out) VAL=0.9 RISE=1
.meas TRAN t50 WHEN V(out)=0.5
.meas tran v1ms FIND V(out) AT=1m
.meas tran slope DERIV V(out) AT=1m
.end
`);
    expect(meas(tr, 'trise').value).toBeCloseTo(RC * Math.log(9), 6);
    expect(meas(tr, 't50').value).toBeCloseTo(RC * Math.log(2), 6);
    expect(meas(tr, 'v1ms').value).toBeCloseTo(1 - Math.exp(-1), 4);
    // dv/dt = e^{-t/RC}/RC
    expect(meas(tr, 'slope').value / (Math.exp(-1) / RC)).toBeCloseTo(1, 2);
  });

  it('TRAN statistics of a sine: AVG, RMS, MIN, MAX, PP, INTEG over FROM–TO', () => {
    const [tr] = deck(`* sine
V1 a 0 SIN(1 2 1k)
R1 a 0 1k
.tran 2u 3m
.meas tran avg1 AVG V(a) FROM=1m TO=3m
.meas tran rms1 RMS V(a) FROM=1m TO=3m
.meas tran lo MIN V(a)
.meas tran hi MAX V(a) FROM=0 TO=1m
.meas tran swing PP V(a)
.meas tran area INTEG V(a) FROM=0 TO=0.5m
.meas tran ratio PARAM hi/lo
.end
`);
    expect(meas(tr, 'avg1').value).toBeCloseTo(1, 4);
    // RMS of 1 + 2 sin = √(1 + 2²/2) = √3
    expect(meas(tr, 'rms1').value).toBeCloseTo(Math.sqrt(3), 3);
    expect(meas(tr, 'lo').value).toBeCloseTo(-1, 3);
    expect(meas(tr, 'hi').value).toBeCloseTo(3, 3);
    expect(meas(tr, 'hi').at).toBeCloseTo(0.25e-3, 5);
    expect(meas(tr, 'swing').value).toBeCloseTo(4, 3);
    // ∫0^T/2 (1 + 2 sin ωt) dt = T/2 + 2·(2/ω)
    expect(meas(tr, 'area').value).toBeCloseTo(0.5e-3 + (4 / (2 * Math.PI * 1e3)), 7);
    expect(meas(tr, 'ratio').value).toBeCloseTo(-3, 2);
  });

  it('crossing counts: RISE=n, FALL=n, CROSS=n, LAST and TD', () => {
    const [tr] = deck(`* counts
V1 a 0 SIN(0 1 1k)
R1 a 0 1
.tran 1u 3.2m
.meas tran r2 WHEN V(a)=0.5 RISE=2
.meas tran f1 WHEN V(a)=0.5 FALL=1
.meas tran c3 WHEN V(a)=0.5 CROSS=3
.meas tran rl WHEN V(a)=0.5 RISE=LAST
.meas tran rtd WHEN V(a)=0.5 RISE=1 TD=1.5m
.meas tran none WHEN V(a)=5
.end
`);
    const T = 1e-3;
    const up = T / 12; // sin = 0.5 rising
    const dn = T / 2 - T / 12;
    expect(meas(tr, 'r2').value).toBeCloseTo(T + up, 7);
    expect(meas(tr, 'f1').value).toBeCloseTo(dn, 7);
    expect(meas(tr, 'c3').value).toBeCloseTo(T + up, 7);
    expect(meas(tr, 'rl').value).toBeCloseTo(3 * T + up, 7);
    expect(meas(tr, 'rtd').value).toBeCloseTo(2 * T + up, 7);
    const none = meas(tr, 'none');
    expect(Number.isNaN(none.value)).toBe(true);
    expect(none.error).toMatch(/not found/);
  });

  it('AC: the −3 dB frequency of an RC low-pass is 1/(2πRC), gain and phase at a point', () => {
    const [ac] = deck(`* ac
V1 in 0 AC 1
R1 in out 1k
C1 out 0 1u
.ac dec 200 1 100k
.meas AC dc0 FIND vdb(out) AT=1
.meas AC f3 WHEN vdb(out)=dc0-3.0103 FALL=1
.meas AC ph1k FIND vp(out) AT=159.155
.meas AC g FIND V(out)/V(in) AT=1k
.meas AC peak MAX vm(out)
.end
`);
    const fc = 1 / (2 * Math.PI * RC);
    expect(meas(ac, 'dc0').value).toBeCloseTo(0, 3);
    expect(meas(ac, 'f3').value / fc).toBeCloseTo(1, 3);
    expect(meas(ac, 'ph1k').value).toBeCloseTo(-45, 1);
    expect(meas(ac, 'g').value).toBeCloseTo(1 / Math.hypot(1, 1e3 / fc), 3);
    expect(meas(ac, 'peak').value).toBeCloseTo(1, 4);
  });

  it('DC: the input voltage where a divider output reaches 2 V, and the slope', () => {
    const [dc] = deck(`* dc
V1 in 0 0
R1 in out 1k
R2 out 0 3k
.dc V1 0 10 0.5
.meas DC vin2 WHEN V(out)=2
.meas DC k DERIV V(out) AT=5
.meas DC vmax MAX V(out)
.end
`);
    expect(meas(dc, 'vin2').value).toBeCloseTo(2 / 0.75, 6);
    expect(meas(dc, 'k').value).toBeCloseTo(0.75, 6);
    expect(meas(dc, 'vmax').value).toBeCloseTo(7.5, 6);
  });

  it('reads LTspice spellings and writes the cards back', () => {
    const num = (t: string) => Number(t.replace(/m$/, 'e-3'));
    expect(parseMeasCard('.meas TRAN res FIND V(out) AT 5m', num)).toMatchObject({ analysis: 'tran', kind: 'find', expr: 'V(out)', at: 5e-3 });
    expect(parseMeasCard('.measure tran tr TRIG V(out)=0.1 RISE=1 TARG V(out)=0.9 RISE=1', num)).toMatchObject({ kind: 'trigtarg', trig: { expr: 'V(out)', level: '0.1', edge: 'rise', count: 1 } });
    expect(parseMeasCard(".meas tran r param='a/b'", num)).toMatchObject({ kind: 'param', expr: 'a/b' });
    expect(() => parseMeasCard('.meas tran x FIND V(out)', num)).toThrow(/AT= or WHEN/);
    const text = `* rt
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out 1k
C1 out 0 1u
.tran 1u 5m
.meas TRAN trise TRIG V(out) VAL=0.1 RISE=1 TARG V(out) VAL=0.9 RISE=1
.meas TRAN avg1 AVG V(out) FROM=1m TO=2m
.end
`;
    const a = parseSpice(text).netlist;
    const b = parseSpice(writeSpice(a)).netlist;
    expect(b.measures).toEqual(a.measures?.map((m) => ({ ...m, line: b.measures?.find((x) => x.name === m.name)?.line })));
  });
});

describe('.step param', () => {
  it('list: one transient run per value, each with its own time constant (family of curves)', () => {
    const [sw] = deck(`* step
.param rv=1k
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out {rv}
C1 out 0 1u
.tran 2u 10m
.step param rv list 500 1k 2k
.meas TRAN tau WHEN V(out)=0.632120559
.end
`);
    expect(sw.type).toBe('paramsweep');
    expect(sw.runs?.map((r) => r.label)).toEqual(['rv=500', 'rv=1000', 'rv=2000']);
    const taus = sw.runs!.map((r) => meas(r.result, 'tau').value);
    expect(taus[0]).toBeCloseTo(0.5e-3, 6);
    expect(taus[1]).toBeCloseTo(1e-3, 6);
    expect(taus[2]).toBeCloseTo(2e-3, 6);
    // the curves differ: at t = 1 ms, v = 1 − e^{−1ms/τ}
    for (const [k, run] of sw.runs!.entries()) {
      const t = run.result.scale!.re;
      const v = run.result.vectors.find((x) => x.name === 'V(out)')!.re;
      const i = t.findIndex((x) => x >= 1e-3);
      expect(v[i]).toBeCloseTo(1 - Math.exp(-t[i] / taus[k]), 3);
    }
  });

  it('lin / dec / oct value lists and the PSpice keyword order', () => {
    const values = (card: string) => {
      const r = parseSpice(`* s\n.param r=1k\nV1 a 0 1\nR1 a 0 {r}\n.op\n${card}\n.end\n`);
      expect(r.errors).toEqual([]);
      const a = r.netlist.analyses[0];
      return a.type === 'paramsweep' && a.global ? a.values : undefined;
    };
    expect(values('.step param r 1k 3k 1k')).toEqual([1000, 2000, 3000]);
    expect(values('.step lin param r 1k 2k 500')).toEqual([1000, 1500, 2000]);
    const dec = values('.step param r dec 1k 100k 1')!;
    expect(dec.map((v) => Math.round(v))).toEqual([1000, 10000, 100000]);
    expect(values('.step oct param r 1k 4k 1')!.map((v) => Math.round(v))).toEqual([1000, 2000, 4000]);
  });

  it('an OP stepped over a parameter gives the divider output per value; .temp stays inside', () => {
    const [sw] = deck(`* op
.param rb=1k
V1 a 0 10
R1 a b 1k
R2 b 0 {rb}
.op
.step param rb list 1k 3k
.end
`);
    // scalar-only base: aggregated curve V(b) over rb
    const vb = sw.vectors.find((v) => v.name === 'V(b)')!;
    expect(Array.from(vb.re)).toEqual([5, 7.5].map((x) => expect.closeTo(x, 9)) as unknown as number[]);
    const both = parseSpice(`* t\n.param rb=1k\nV1 a 0 10\nR1 a b 1k\nR2 b 0 {rb}\n.op\n.temp 0 50\n.step param rb list 1k 3k\n.end\n`).netlist;
    expect(both.analyses[0]).toMatchObject({ type: 'paramsweep', global: true, base: { type: 'tempsweep' } });
  });

  it('reports a .step of an undefined parameter', () => {
    const r = parseSpice('* s\nV1 a 0 1\nR1 a 0 1k\n.op\n.step param nope list 1 2\n.end\n');
    expect(r.errors[0].message).toMatch(/nope.*not defined/);
  });
});

describe('E / G FREQ tables', () => {
  it('AC follows the table (exact at the points, log-f interpolation between), DC uses 0 Hz', () => {
    const [ac, op] = deck(`* freq
V1 in 0 DC 2 AC 1
E1 out 0 FREQ {V(in)} = (0, 0, 0) (1k, -6, -45) (10k, -20, -90)
R1 out 0 1k
.ac list 1k 10k 3162.2777
.op
.end
`);
    expect(20 * Math.log10(mag(ac, 'V(out)', 0))).toBeCloseTo(-6, 6);
    expect(20 * Math.log10(mag(ac, 'V(out)', 1))).toBeCloseTo(-20, 6);
    // half way in log f: −13 dB, −67.5°
    expect(20 * Math.log10(mag(ac, 'V(out)', 2))).toBeCloseTo(-13, 4);
    const v = ac.vectors.find((x) => x.name === 'V(out)')!;
    expect((Math.atan2(v.im![2], v.re[2]) * 180) / Math.PI).toBeCloseTo(-67.5, 3);
    expect(op.scalars!['V(out)']).toBeCloseTo(2, 9);
  });

  it('MAG / RAD / R_I keywords and DELAY', () => {
    const r = parseSpice('* k\nV1 in 0 AC 1\nG1 0 out FREQ {V(in)} R_I = (1k, 0, -1) DELAY=1u\nR1 out 0 1\n.ac list 1k\n.end\n');
    expect(r.errors).toEqual([]);
    const g = r.netlist.elements.find((e) => e.name === 'G1')!;
    expect(g.freqTable).toEqual({ f: [1000], mag: [1], phase: [-90], delay: 1e-6 });
    const h = freqTableResponse(g.freqTable!, 1e3);
    expect(h.im).toBeCloseTo(-1, 12);
    const [ac] = runAnalyses(r.netlist);
    const v = ac.vectors.find((x) => x.name === 'V(out)')!;
    // −j·e^{−jω·1µs}: phase −90° − 0.36°
    expect((Math.atan2(v.im![0], v.re[0]) * 180) / Math.PI).toBeCloseTo(-90 - 360 * 1e3 * 1e-6, 6);
    const m = parseSpice('* m\nV1 in 0 AC 1\nE1 out 0 FREQ {V(in)} MAG RAD = (0 2 0) (1k 0.5 -1.5707963)\nR1 out 0 1\n.end\n').netlist.elements.find((e) => e.name === 'E1')!;
    expect(m.freqTable!.mag).toEqual([2, 0.5]);
    expect(m.freqTable!.phase[1]).toBeCloseTo(-90, 5);
  });

  it('transient by convolution: a table of 1/(1 + j f/fc) gives the RC step response', () => {
    const fc = 1 / (2 * Math.PI * RC);
    const rows: string[] = [];
    for (let k = 0; k <= 60; k++) {
      const f = k === 0 ? 0 : fc * Math.pow(10, -2 + (5 * (k - 1)) / 59);
      const h = 1 / Math.hypot(1, f / fc);
      rows.push(`(${f}, ${20 * Math.log10(h)}, ${(-Math.atan(f / fc) * 180) / Math.PI})`);
    }
    const [tr] = deck(`* conv
V1 in 0 PULSE(0 1 1m 1n 1n 1 2)
E1 out 0 FREQ {V(in)} = ${rows.join(' ')}
R1 out 0 1k
.tran 10u 8m
.end
`);
    const t = tr.scale!.re;
    const v = tr.vectors.find((x) => x.name === 'V(out)')!.re;
    for (const tq of [1.5e-3, 2e-3, 3e-3, 5e-3]) {
      const i = t.findIndex((x) => x >= tq);
      expect(v[i], `t=${tq}`).toBeCloseTo(1 - Math.exp(-(t[i] - 1e-3) / RC), 2);
    }
    expect(v[v.length - 1]).toBeCloseTo(1, 2);
    expect(v[t.findIndex((x) => x >= 0.9e-3)]).toBeCloseTo(0, 2);
  });
});

describe('CHEBYSHEV sources', () => {
  it('designs the textbook order and meets ripple / attenuation at the edges (LP, HP, BP, BR)', () => {
    // LP 1 kHz pass, 2 kHz stop, 1 dB ripple, 40 dB: n = ⌈acosh(√((10^4−1)/(10^0.1−1)))/acosh(2)⌉ = 5
    expect(chebyshevOrder({ kind: 'LP', edges: [1e3, 2e3], ripple: 1, atten: 40 })).toBe(5);
    const at = (d: ReturnType<typeof designChebyshev>, f: number) => {
      const h = cascadeAt(d.sections, { re: 0, im: 2 * Math.PI * f });
      return 20 * Math.log10(Math.hypot(h.re, h.im));
    };
    const lp = designChebyshev({ kind: 'LP', edges: [1e3, 2e3], ripple: 1, atten: 40 });
    expect(at(lp, 1e3)).toBeCloseTo(-1, 6);
    expect(at(lp, 2e3)).toBeLessThan(-40);
    expect(at(lp, 1)).toBeCloseTo(0, 4); // odd order: 0 dB at DC
    const hp = designChebyshev({ kind: 'HP', edges: [1e3, 500], ripple: 0.5, atten: 30 });
    expect(at(hp, 1e3)).toBeCloseTo(-0.5, 6);
    expect(at(hp, 500)).toBeLessThan(-30);
    const bp = designChebyshev({ kind: 'BP', edges: [800, 1.2e3, 2.6e3, 3e3], ripple: 0.1, atten: 50 });
    expect(at(bp, 1.2e3)).toBeCloseTo(-0.1, 5);
    expect(at(bp, 2.6e3)).toBeCloseTo(-0.1, 5);
    expect(at(bp, 800)).toBeLessThan(-50);
    expect(at(bp, 3e3)).toBeLessThan(-50);
    expect(bp.sections.length).toBe(bp.order);
    const br = designChebyshev({ kind: 'BR', edges: [800, 1.2e3, 2.6e3, 3e3], ripple: 0.1, atten: 30 });
    expect(at(br, 800)).toBeCloseTo(-0.1, 5);
    expect(at(br, 3e3)).toBeCloseTo(-0.1, 5);
    expect(at(br, 1.2e3)).toBeLessThan(-30);
    expect(at(br, Math.sqrt(800 * 3e3))).toBeLessThan(-60);
  });

  it('a CHEBYSHEV card simulates in AC as designed and settles to its DC gain in a transient', () => {
    const r = parseSpice(`* cheb
V1 in 0 DC 0 AC 1 PULSE(0 1 0 1u 1u 1 2)
E1 out 0 CHEBYSHEV {V(in)} = LP 1k 2k 1dB 40dB
R1 out 0 1k
.ac list 1k 2k 1
.tran 10u 20m
.end
`);
    expect(r.errors).toEqual([]);
    // 5th order: 2 second-order stages + 1 first-order stage
    expect(r.netlist.elements.filter((e) => e.laplace).map((e) => e.name)).toEqual(['E1_s1', 'E1_s2', 'E1']);
    const [ac, tr] = runAnalyses(r.netlist);
    expect(20 * Math.log10(mag(ac, 'V(out)', 0))).toBeCloseTo(-1, 4);
    expect(20 * Math.log10(mag(ac, 'V(out)', 1))).toBeLessThan(-40);
    expect(20 * Math.log10(mag(ac, 'V(out)', 2))).toBeCloseTo(0, 3);
    const v = tr.vectors.find((x) => x.name === 'V(out)')!.re;
    expect(v[v.length - 1]).toBeCloseTo(1, 3);
    // a written netlist reads back to the same stages
    const back = parseSpice(writeSpice(r.netlist));
    expect(back.errors).toEqual([]);
    expect(back.netlist.elements.filter((e) => e.laplace).length).toBe(3);
  });

  it('rejects badly ordered band edges', () => {
    expect(parseSpice('* x\nV1 in 0 1\nE1 out 0 CHEBYSHEV {V(in)} = LP 2k 1k 1 40\nR1 out 0 1\n.end\n').errors[0].message).toMatch(/stop frequency must be above/);
    expect(parseSpice('* x\nV1 in 0 1\nE1 out 0 CHEBYSHEV {V(in)} = BP 1k 900 2k 3k 1 40\nR1 out 0 1\n.end\n').errors[0].message).toMatch(/fstop1 < fpass1/);
  });
});

describe('LTspice parasitics and PWL commas', () => {
  it('Rpar on a capacitor leaks at DC; Cpar on an inductor makes it resonate at 1/(2π√(LC))', () => {
    const [op] = deck('* rpar\nV1 a 0 10\nR1 a b 1k\nC1 b 0 1u Rpar=1k\n.op\n.end\n');
    expect(op.scalars!['V(b)']).toBeCloseTo(5, 9);
    const [ac] = deck('* cpar\nI1 0 a AC 1\nL1 a 0 1m Rser=1 Cpar=1u\n.ac lin 3 4.9k 5.1k\n.end\n');
    const f0 = 1 / (2 * Math.PI * Math.sqrt(1e-3 * 1e-6));
    // parallel resonance: |Z| peaks near f0 (≈ 5.03 kHz) and is far above the 1 Ω / ωL branch values
    const z = [0, 1, 2].map((i) => mag(ac, 'V(a)', i));
    expect(z[1]).toBeGreaterThan(z[0]);
    expect(z[1]).toBeGreaterThan(z[2]);
    expect(z[1]).toBeGreaterThan(20);
    expect(f0).toBeGreaterThan(4.9e3);
  });

  it('Lser on a capacitor: series resonance shorts the node at 1/(2π√(L·C))', () => {
    const f0 = 1 / (2 * Math.PI * Math.sqrt(1e-6 * 1e-6));
    const [ac] = deck(`* lser\nV1 in 0 AC 1\nR1 in out 100\nC1 out 0 1u Lser=1u Rser=0.01\n.ac list ${f0} ${f0 / 100}\n.end\n`);
    expect(mag(ac, 'V(out)', 0)).toBeCloseTo(0.01 / 100.01, 5);
    expect(mag(ac, 'V(out)', 1)).toBeGreaterThan(0.5);
    const r = parseSpice('* names\nC1 a 0 1u Rser=1 Lser=1n Rpar=1meg Cpar=1p\nV1 a 0 1 Rser=2 Cpar=3p\n.end\n');
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => /instance parameter/.test(w))).toEqual([]);
    expect(r.netlist.elements.map((e) => `${e.name}:${e.nodes.join(',')}`)).toEqual([
      'C1:C1_lser,0',
      'RC1_rser:a,C1_rser',
      'LC1_lser:C1_rser,C1_lser',
      'RC1_rpar:C1_lser,0',
      'CC1_cpar:a,0',
      'V1:V1_rser,0',
      'RV1_rser:a,V1_rser',
      'CV1_cpar:a,0',
    ]);
  });

  it('PWL pair lists with commas, with or without parentheses', () => {
    for (const w of ['PWL(0,0 1m,5 2m,5)', 'PWL(0, 0, 1m, 5, 2m, 5)', 'PWL 0,0,1m,5,2m,5', 'PWL (0,0) (1m,5) (2m,5)', 'PWL(0 0, 1m 5, 2m 5)']) {
      const r = parseSpice(`* pwl\nV1 a 0 ${w}\nR1 a 0 1\n.end\n`);
      expect(r.errors, w).toEqual([]);
      expect(r.netlist.elements[0].source?.tran, w).toEqual({ type: 'PWL', args: [0, 0, 1e-3, 5, 2e-3, 5] });
    }
  });
});
