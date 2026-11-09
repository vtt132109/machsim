/**
 * LAPLACE controlled sources against analytic transfer functions: first-order low-pass (AC, step
 * response, DC gain), a second-order band-pass, a G output into a resistor, the SPICE text round
 * trip and the parser's error messages.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice, writeSpice } from '../../spice';
import { formatTransform, laplaceInput, rationalTransform } from '../../spice/laplace';
import { runAnalyses } from '../../engine';
import type { AnalysisResult } from '../../results';

function run(deck: string): AnalysisResult[] {
  const { netlist, errors } = parseSpice(deck);
  expect(errors).toEqual([]);
  return runAnalyses(netlist);
}
const vec = (r: AnalysisResult, n: string) => r.vectors.find((v) => v.name.toLowerCase() === n.toLowerCase())!;

describe('LAPLACE transform parsing', () => {
  it('reads rational functions of s and normalises the denominator', () => {
    expect(rationalTransform('1/(1 + s*1m)')).toEqual({ num: [1000], den: [1000, 1] });
    const bp = rationalTransform('(s*2k)/(s^2 + s*100 + 1e6)');
    expect(bp.num).toEqual([0, 2000]);
    expect(bp.den).toEqual([1e6, 100, 1]);
    // constants and functions of constants are evaluated
    expect(rationalTransform('2*pi*1k/(s + 2*pi*1k)').num[0]).toBeCloseTo(2 * Math.PI * 1e3, 9);
    expect(rationalTransform('1/(1+s)^2').den).toEqual([1, 2, 1]);
    expect(() => rationalTransform('s^2/(1+s)')).toThrow(/proper/);
    expect(() => rationalTransform('k/(1+s)')).toThrow(/unknown name 'k'/);
    expect(laplaceInput('V(a)')).toEqual({ pos: 'a', neg: '0', gain: 1 });
    expect(laplaceInput('V(a)-V(b)')).toEqual({ pos: 'a', neg: 'b', gain: 1 });
    expect(laplaceInput('-2*V(a,b)')).toEqual({ pos: 'a', neg: 'b', gain: -2 });
    expect(() => laplaceInput('V(a)*V(b)')).toThrow(/LAPLACE input/);
    expect(formatTransform([1000], [1000, 1])).toBe('(1000)/(1000 + 1*s)');
  });

  it('reports unsupported cards as parse errors', () => {
    const r = parseSpice('x\nE1 o 0 LAPLACE {V(i)*V(j)} = {1/(1+s)}\n.end');
    expect(r.errors[0].message).toMatch(/LAPLACE input/);
    // FREQ tables are read since round 3 (freqTable.ts); their input follows the LAPLACE rules
    expect(parseSpice('x\nE1 o 0 FREQ {V(i)} = (0,0,0)\n.end').errors).toEqual([]);
    expect(parseSpice('x\nE1 o 0 FREQ {V(i)*V(j)} = (0,0,0)\n.end').errors[0].message).toMatch(/FREQ input/);
  });
});

describe('LAPLACE sources in analyses', () => {
  const LP = `lp
V1 in 0 PULSE(0 1 0 1n 1n 1 1) AC 1
E1 out 0 LAPLACE {V(in)} = {1/(1 + s*1m)}
R1 out 0 1k
`;

  it('first-order low-pass: AC magnitude / phase, step response and DC gain', () => {
    const [ac, tran, op] = run(`${LP}.ac dec 10 1 100k\n.tran 10u 5m\n.op\n.end`);
    const f = ac.scale!.re;
    const v = vec(ac, 'V(out)');
    for (let i = 0; i < f.length; i++) {
      const wt = 2 * Math.PI * f[i] * 1e-3;
      expect(Math.hypot(v.re[i], v.im![i]) / (1 / Math.hypot(1, wt))).toBeCloseTo(1, 9);
      expect(Math.atan2(v.im![i], v.re[i])).toBeCloseTo(-Math.atan(wt), 9);
    }
    const t = tran.scale!.re;
    const y = vec(tran, 'V(out)').re;
    for (let i = 0; i < t.length; i += 25) expect(Math.abs(y[i] - (1 - Math.exp(-t[i] / 1e-3)))).toBeLessThan(2e-3);
    // DC: the pulse is 0 at t = 0
    expect(vec(op, 'V(out)').re[0]).toBeCloseTo(0, 12);
  });

  it('second-order band-pass peaks at w0 with gain K/(w0/Q)', () => {
    // H = 2k s / (s^2 + 100 s + 1e6): w0 = 1000 rad/s, peak gain 2000/100 = 20
    const [ac] = run(`bp\nV1 in 0 AC 1\nE1 out 0 LAPLACE {V(in)} = {(s*2k)/(s^2 + s*100 + 1e6)}\nR1 out 0 1k\n.ac lin 201 100 220\n.end`);
    const f = ac.scale!.re;
    const v = vec(ac, 'V(out)');
    let best = 0;
    let at = 0;
    for (let i = 0; i < f.length; i++) {
      const m = Math.hypot(v.re[i], v.im![i]);
      if (m > best) {
        best = m;
        at = f[i];
      }
      const s = { re: 0, im: 2 * Math.PI * f[i] };
      const den = { re: 1e6 - s.im * s.im, im: 100 * s.im };
      expect(m / ((2000 * s.im) / Math.hypot(den.re, den.im))).toBeCloseTo(1, 9);
    }
    // the 0.6 Hz grid misses the exact peak by less than 0.05 %
    expect(best).toBeCloseTo(20, 1);
    expect(at).toBeCloseTo(1000 / (2 * Math.PI), 0);
  });

  it('a G-type LAPLACE source drives its transfer function as a current', () => {
    const [op, ac] = run(`g\nV1 in 0 DC 2 AC 1\nG1 0 out LAPLACE {V(in)} = {1m/(1 + s*1u)}\nR1 out 0 1k\n.op\n.ac lin 1 159.155k 159.155k\n.end`);
    // DC: 1 mS * 2 V into 1 kOhm = 2 V
    expect(vec(op, 'V(out)').re[0]).toBeCloseTo(2, 9);
    // at w = 1/tau: |H| = 1/sqrt(2)
    const v = vec(ac, 'V(out)');
    expect(Math.hypot(v.re[0], v.im![0])).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('writes back as a LAPLACE card that reads to the same transfer function', () => {
    const { netlist } = parseSpice(`${LP}.end`);
    const text = writeSpice(netlist);
    expect(text).toMatch(/E1 out 0 LAPLACE \{V\(in,0\)\} = \{\(1000\)\/\(1000 \+ 1\*s\)\}/);
    const back = parseSpice(text).netlist.elements.find((e) => e.name === 'E1')!;
    expect(back.laplace).toEqual({ num: [1000], den: [1000, 1] });
  });
});
